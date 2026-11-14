/**
 * 最小 ZIP 读写（stored，不压缩）—— v3.8.1 · Phase 1（照片完整备份）。
 *
 * ## 为什么自己写
 *
 * 完整照片备份要把「JSON 元数据 + 照片二进制」装进一个文件。本仓库**不新增依赖**，
 * 而 ZIP 里我们只需要 stored（method 0）这一种存储方式：
 * - 照片本身已经是 JPEG（压缩过），再 deflate 收益极小，却要多一整个压缩实现；
 * - 写侧要字节级确定（自检可比对），stored 的产物与输入一一对应，最容易验证。
 *
 * 实现思路沿用本仓库 `v3.3.2` 座位图导出里那套手写 stored ZIP（该文件在 `v3.5.1` 随
 * Excel 改模板驱动而删除，代码仍在 git 历史中）。**读侧是新写的**：解析中央目录、
 * 校验 CRC / 长度 / 名称，并明确拒绝 ZIP64、加密与压缩条目——遇到不是本应用导出的
 * ZIP（例如被解压后重新压缩过）时给出可读错误，而不是解析出一堆坏数据。
 *
 * ## 边界
 *
 * - 纯函数：不碰 DOM / localStorage / 网络，node 自检可直接跑；
 * - 只支持 32 位经典 ZIP；条目数、总大小有上限（防解压炸弹 / 内存打爆）；
 * - 路径只作为 ZIP 内的名字使用，**绝不落地到文件系统**；同时拒绝 `..` 与控制字符。
 */

/** ZIP 条目（写侧输入） */
export interface ZipStoreEntry {
  /** ZIP 内名称（UTF-8，使用 `/` 分隔；不允许以 `/` 开头或含 `..`） */
  name: string
  data: Uint8Array
}

/** ZIP 条目（读侧输出；`data` 是输入字节的视图，不复制整份归档） */
export interface ZipReadEntry {
  name: string
  data: Uint8Array
  /** ZIP 里记录的 CRC-32（已与解出的数据核对过） */
  crc32: number
}

export type ZipErrorCode =
  | 'not-zip'
  | 'unsupported-method'
  | 'unsupported-zip64'
  | 'unsupported-multidisk'
  | 'encrypted'
  | 'corrupt'
  | 'duplicate-name'
  | 'invalid-name'
  | 'too-large'

/** ZIP 读写错误（`message` 可直接给教师看；`code` 供调用方分类） */
export class ZipFormatError extends Error {
  readonly code: ZipErrorCode

  constructor(code: ZipErrorCode, message: string) {
    super(message)
    this.name = 'ZipFormatError'
    this.code = code
  }
}

/* ==================== CRC-32（IEEE 802.3） ==================== */

/** 查表只建一次；ZIP 每个条目都要带 CRC，校验不过说明文件损坏 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/* ==================== 通用 ==================== */

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const UTF8_FLAG = 0x0800
const DOS_DATE_1980 = 0x21
const MAX_ENTRIES = 10_000
/** 解压后总量上限（2 GB）：照片备份远达不到，超过即视为异常文件 */
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
const MAX_NAME_BYTES = 512

function toBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input)
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** ZIP 内名称的安全校验：只允许相对路径，拒绝控制字符与 `..` 段 */
function assertSafeZipName(name: string): void {
  if (!name || name.length > MAX_NAME_BYTES) {
    throw new ZipFormatError('invalid-name', 'ZIP 里有文件名长度异常，无法作为备份读取。')
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new ZipFormatError('invalid-name', 'ZIP 里有文件名包含控制字符，无法作为备份读取。')
  }
  if (name.startsWith('/') || name.includes('\\')) {
    throw new ZipFormatError('invalid-name', 'ZIP 里有不安全的路径，无法作为备份读取。')
  }
  if (name.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw new ZipFormatError('invalid-name', 'ZIP 里有不安全的路径，无法作为备份读取。')
  }
}

/* ==================== 写：stored ZIP ==================== */

/**
 * 打包成 ZIP。**全部用 stored（method 0，不压缩）**：
 * - 文件名用 UTF-8（通用标志位 `0x0800`）；
 * - 修改时间固定为 1980-01-01（DOS 日期不能为 0；也不需要真实时间，归档里另有 exportedAt）；
 * - 返回字节数组，调用方自行包 Blob。
 */
export function encodeZipStore(entries: readonly ZipStoreEntry[]): Uint8Array {
  if (entries.length > MAX_ENTRIES) {
    throw new ZipFormatError('too-large', '要打包的文件太多了，无法生成 ZIP。')
  }
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  const seen = new Set<string>()
  let offset = 0
  let totalBytes = 0

  for (const entry of entries) {
    assertSafeZipName(entry.name)
    if (seen.has(entry.name)) {
      throw new ZipFormatError('duplicate-name', 'ZIP 里有重名文件，无法生成。')
    }
    seen.add(entry.name)

    const nameBytes = encoder.encode(entry.name)
    const data = toBytes(entry.data)
    const crc = crc32(data)
    const size = data.length
    totalBytes += size
    if (totalBytes > MAX_TOTAL_BYTES || offset + 30 + nameBytes.length + size > 0xffffffff) {
      throw new ZipFormatError('too-large', '备份内容过大，无法生成 ZIP。')
    }

    const local = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, LOCAL_SIG, true) // 本地文件头签名
    localView.setUint16(4, 20, true) // 解压所需版本 2.0
    localView.setUint16(6, UTF8_FLAG, true) // 通用标志位：文件名为 UTF-8
    localView.setUint16(8, 0, true) // 压缩方法：stored
    localView.setUint16(10, 0, true) // 修改时间
    localView.setUint16(12, DOS_DATE_1980, true) // 修改日期 = 1980-01-01
    localView.setUint32(14, crc, true)
    localView.setUint32(18, size, true) // 压缩后大小 = 原始大小
    localView.setUint32(22, size, true)
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true) // 扩展字段长度
    local.set(nameBytes, 30)
    parts.push(local, data)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, CENTRAL_SIG, true) // 中央目录签名
    centralView.setUint16(4, 20, true) // 创建版本
    centralView.setUint16(6, 20, true) // 解压所需版本
    centralView.setUint16(8, UTF8_FLAG, true)
    centralView.setUint16(10, 0, true) // 压缩方法
    centralView.setUint16(12, 0, true) // 修改时间
    centralView.setUint16(14, DOS_DATE_1980, true) // 修改日期
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, size, true)
    centralView.setUint32(24, size, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint16(30, 0, true) // 扩展字段
    centralView.setUint16(32, 0, true) // 注释
    centralView.setUint16(34, 0, true) // 起始磁盘号
    centralView.setUint16(36, 0, true) // 内部属性
    centralView.setUint32(38, 0, true) // 外部属性
    centralView.setUint32(42, offset, true) // 本地文件头偏移
    central.set(nameBytes, 46)
    centralParts.push(central)

    offset += local.length + size
  }

  const centralSize = centralParts.reduce((sum, chunk) => sum + chunk.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, EOCD_SIG, true) // 中央目录结束记录
  endView.setUint16(4, 0, true) // 当前磁盘号
  endView.setUint16(6, 0, true) // 中央目录起始磁盘号
  endView.setUint16(8, entries.length, true) // 本磁盘条目数
  endView.setUint16(10, entries.length, true) // 总条目数
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  endView.setUint16(20, 0, true) // 注释长度

  return concatChunks([...parts, ...centralParts, end])
}

/* ==================== 读：stored ZIP ==================== */

function findEocd(bytes: Uint8Array, view: DataView): number {
  const min = Math.max(0, bytes.length - (22 + 0xffff))
  for (let index = bytes.length - 22; index >= min; index -= 1) {
    if (view.getUint32(index, true) !== EOCD_SIG) continue
    const commentLength = view.getUint16(index + 20, true)
    if (index + 22 + commentLength === bytes.length) return index
  }
  throw new ZipFormatError('not-zip', '这不是有效的 ZIP 文件（找不到中央目录）。')
}

/**
 * 解出 ZIP 条目。**只接受 stored（不压缩）条目**：
 * - 每个条目都用中央目录里的 CRC / 大小核对一遍，任何一条不符整份拒绝；
 * - 加密、ZIP64、多磁盘、压缩条目 → 明确报错（不猜测、不部分读取）；
 * - 条目名做安全校验（拒绝绝对路径 / `..` / 控制字符）。
 */
export function decodeZipStore(input: ArrayBuffer | Uint8Array): ZipReadEntry[] {
  const bytes = toBytes(input)
  if (bytes.length < 22) {
    throw new ZipFormatError('not-zip', '这不是有效的 ZIP 文件（内容太短）。')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEocd(bytes, view)

  const diskNumber = view.getUint16(eocd + 4, true)
  const centralDisk = view.getUint16(eocd + 6, true)
  if (diskNumber !== 0 || centralDisk !== 0) {
    throw new ZipFormatError('unsupported-multidisk', '这个 ZIP 是分卷压缩包，暂不支持读取。')
  }
  const entryCount = view.getUint16(eocd + 10, true)
  const centralSize = view.getUint32(eocd + 12, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new ZipFormatError('unsupported-zip64', '这个 ZIP 使用了 ZIP64 格式，暂不支持读取。')
  }
  if (entryCount > MAX_ENTRIES) {
    throw new ZipFormatError('too-large', '这个 ZIP 里的文件太多了，无法作为备份读取。')
  }
  if (centralOffset + centralSize > bytes.length || centralOffset > eocd) {
    throw new ZipFormatError('corrupt', 'ZIP 的中央目录位置不对，文件可能已损坏。')
  }

  const decoder = new TextDecoder('utf-8')
  const seen = new Set<string>()
  const entries: ZipReadEntry[] = []
  let cursor = centralOffset
  let totalBytes = 0

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL_SIG) {
      throw new ZipFormatError('corrupt', 'ZIP 的中央目录损坏，无法读取。')
    }
    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const crc = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const next = cursor + 46 + nameLength + extraLength + commentLength
    if (next > bytes.length || cursor + 46 + nameLength > bytes.length) {
      throw new ZipFormatError('corrupt', 'ZIP 的中央目录损坏，无法读取。')
    }
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    cursor = next

    if (flags & 0x0001) {
      throw new ZipFormatError('encrypted', '这个 ZIP 有密码保护，无法作为备份读取。')
    }
    if (method !== 0) {
      throw new ZipFormatError(
        'unsupported-method',
        '这个 ZIP 使用了压缩存储。请直接使用 TeacherDesk 导出的完整备份文件，不要解压后重新压缩。',
      )
    }
    if (compressedSize !== uncompressedSize) {
      throw new ZipFormatError('corrupt', 'ZIP 条目大小不一致，文件可能已损坏。')
    }
    assertSafeZipName(name)
    if (seen.has(name)) {
      throw new ZipFormatError('duplicate-name', 'ZIP 里有重名文件，无法作为备份读取。')
    }
    seen.add(name)
    totalBytes += uncompressedSize
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new ZipFormatError('too-large', 'ZIP 内容过大，无法作为备份读取。')
    }

    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL_SIG) {
      throw new ZipFormatError('corrupt', 'ZIP 的本地文件头损坏，无法读取。')
    }
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > bytes.length) {
      throw new ZipFormatError('corrupt', 'ZIP 文件内容不完整，无法读取。')
    }
    const data = bytes.subarray(dataStart, dataEnd)
    if (crc32(data) !== crc) {
      throw new ZipFormatError('corrupt', `ZIP 里的「${name}」校验失败，文件可能已损坏。`)
    }
    entries.push({ name, data, crc32: crc })
  }

  return entries
}
