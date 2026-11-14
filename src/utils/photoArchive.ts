/**
 * 照片完整备份（ZIP 容器）—— v3.8.1 · Phase 1。
 *
 * ## 与 JSON 备份的关系（两者必须分清）
 *
 * - **原有 JSON 备份**（`utils/backup.ts`）继续原样存在：只含照片**元数据**，不含照片文件。
 *   旧备份文件照常导入，schema 仍是 1，本模块**不改动**它。
 * - **完整备份 ZIP**（本文件）是**追加的第二种格式**：ZIP 内放
 *   `backup.json`（与 JSON 备份完全同构）+ `photos/<photoId>.<ext>` + `photo-manifest.json`。
 *   图片与元数据只靠稳定 `photoId` 关联（**绝不用姓名/文件名猜**）。
 *
 * 因此：**JSON 里永远不会有 Blob / Base64 / 签名 URL**；照片二进制只出现在 ZIP 的独立
 * 条目里。教师不会因为「导出过 JSON」就误以为照片文件也备份了——界面文案与导出清单
 * 都会把两者分开说（`PHOTO_BACKUP_NOTICE` / `Toolbox` 的两行入口）。
 *
 * ## 数据安全纪律
 *
 * ① **导出不伪造**：本机与云端都取不到的照片，清单里标 `missing-local`；云端有 `fileId`
 *    但当前未登录 / 未配置时标 `remote-unavailable`（**不尝试下载**，符合「只在现有合法
 *    认证与下载机制可用时才尝试获取」）；下载失败标 `download-failed`；字节不是受支持
 *    图片格式标 `invalid-binary`。这些照片**不进 ZIP**，也绝不写成成功。
 * ② **导入先全量校验**：ZIP 结构 → 内嵌备份 → 清单汇总 → 每个 included 照片的
 *    photoId / studentId / category / 长度 / CRC / 图片签名 → 与备份元数据交叉比对。
 *    全部通过后才进入写盘阶段。
 * ③ **写盘可回滚**：先写照片二进制（记录哪些是本次新建的），再原子合并 JSON；任一步
 *    失败都把本次新建的照片文件删掉、`applyWrites` 自行回滚 localStorage——原有数据不变。
 * ④ 纯逻辑：本文件不碰 DOM / IndexedDB / 网络。二进制来源、缩略图生成、localStorage
 *    写入全部由调用方以依赖注入方式提供，因此 node 自检可直接跑完整导出/导入流程。
 */
import { formatDateKey } from '@/utils/date'
import { isPlainObject } from '@/utils/object'
import { isStudentPhotoCategory } from '@/utils/studentPhoto'
import {
  STUDENT_PHOTO_KEY,
  applyWrites,
  parseBackup,
  type BackupFile,
  type CommitOutcome,
} from '@/utils/backup'
import { crc32, decodeZipStore, encodeZipStore, ZipFormatError } from '@/utils/zip'
import type { StoragePort } from '@/services/storage'
import type { StudentPhoto, StudentPhotoCategory } from '@/types/studentPhoto'

/* ==================== 常量 ==================== */

export const PHOTO_ARCHIVE_KIND = 'teacherdesk-photo-archive'
export const PHOTO_ARCHIVE_VERSION = 1 as const
/** ZIP 内固定条目名（缺任何一个都按「不是完整照片备份」拒绝） */
export const PHOTO_ARCHIVE_BACKUP_ENTRY = 'backup.json'
export const PHOTO_ARCHIVE_MANIFEST_ENTRY = 'photo-manifest.json'
export const PHOTO_ARCHIVE_README_ENTRY = 'README.txt'
export const PHOTO_ARCHIVE_PHOTO_DIR = 'photos'

/** 完整备份文件扩展名（`.zip` 让系统与解压工具都能识别；应用内按内容识别，不只看扩展名） */
export const PHOTO_ARCHIVE_EXTENSION = '.zip'

/** 归档里允许出现的图片类型（与图片处理管线的输出能力一致） */
export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp'

export const SUPPORTED_IMAGE_MIME_TYPES: readonly SupportedImageMime[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
]

/* ==================== 图片签名 ==================== */

function extensionOfMime(mime: SupportedImageMime): 'jpg' | 'png' | 'webp' {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

/**
 * 按文件头判断图片类型；认不出返回 `undefined`。
 *
 * 为什么不只信元数据里的 `mimeType`：ZIP 可能被中间环节改坏、或被别的工具重新打包，
 * 二进制与元数据必须各自都对上，才能证明「这张图确实属于这条照片记录」。
 */
export function imageMimeOfBytes(bytes: Uint8Array): SupportedImageMime | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte)) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return 'image/webp'
  }
  return undefined
}

export function isSupportedImageMime(value: unknown): value is SupportedImageMime {
  return (
    typeof value === 'string' && (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(value)
  )
}

/* ==================== 清单类型 ==================== */

/**
 * 一张照片在导出清单里的结局。
 * - `included`：成功打进 ZIP；
 * - `missing-local`：本机与云端都没有文件（元数据在、照片不在）；
 * - `remote-unavailable`：云端有 fileId，但当前未登录 / 未配置，按规则**不尝试下载**；
 * - `download-failed`：尝试下载但失败；
 * - `invalid-binary`：取到了字节，但不是受支持的图片格式（不写进 ZIP）；
 * - `deleted`：逻辑删除的墓碑记录（不参与导出）。
 */
export type PhotoArchivePhotoStatus =
  | 'included'
  | 'missing-local'
  | 'remote-unavailable'
  | 'download-failed'
  | 'invalid-binary'
  | 'deleted'

export interface PhotoArchiveTotals {
  /** 清单内照片记录总数（含墓碑） */
  photos: number
  included: number
  missing: number
  failed: number
  unavailable: number
  deleted: number
}

export interface PhotoArchiveManifestPhoto {
  photoId: string
  studentId: string
  /** 姓名快照（只用于人类核对清单，不参与关联） */
  studentName: string
  category: StudentPhotoCategory
  status: PhotoArchivePhotoStatus
  /** `status === 'included'` 时必有：ZIP 内路径 */
  path?: string
  /** `status === 'included'` 时必有：原始字节数 */
  bytes?: number
  /** `status === 'included'` 时必有：字节 CRC-32（与 ZIP 自身的 CRC 相互印证） */
  crc32?: number
  /** `status === 'included'` 时必有：按文件头识别出的图片类型 */
  mimeType?: SupportedImageMime
  /** 未导出的可读原因（给人看） */
  reason?: string
  uploadedAt?: string
}

export interface PhotoArchiveManifest {
  kind: typeof PHOTO_ARCHIVE_KIND
  version: number
  appVersion: string
  exportedAt: string
  totals: PhotoArchiveTotals
  photos: PhotoArchiveManifestPhoto[]
}

/* ==================== 导出 ==================== */

/** 单张照片二进制的取用结果（由调用方注入本地 / 云端策略） */
export type PhotoBinaryResolution =
  | { ok: true; blob: Blob }
  | {
      ok: false
      status: 'missing-local' | 'remote-unavailable' | 'download-failed'
      reason: string
    }

export interface PhotoArchiveBuildInput {
  /** 与 JSON 备份完全同构的序列化文本（由 `createBackup` 产出） */
  backupJson: string
  appVersion: string
  exportedAt: string
  /** 全部照片元数据（含墓碑；墓碑在清单里标 `deleted` 但不导出） */
  photos: readonly StudentPhoto[]
  /** 取一张照片的二进制；**调用方负责**本地优先、云端可用性判断与错误分类 */
  resolveBinary: (photo: StudentPhoto) => Promise<PhotoBinaryResolution>
}

export interface PhotoArchiveBuildResult {
  blob: Blob
  manifest: PhotoArchiveManifest
  zipBytes: Uint8Array
}

function emptyTotals(): PhotoArchiveTotals {
  return { photos: 0, included: 0, missing: 0, failed: 0, unavailable: 0, deleted: 0 }
}

function countStatus(totals: PhotoArchiveTotals, status: PhotoArchivePhotoStatus): void {
  switch (status) {
    case 'included':
      totals.included += 1
      break
    case 'missing-local':
      totals.missing += 1
      break
    case 'download-failed':
    case 'invalid-binary':
      totals.failed += 1
      break
    case 'remote-unavailable':
      totals.unavailable += 1
      break
    case 'deleted':
      totals.deleted += 1
      break
  }
}

function photoEntryPath(photoId: string, mime: SupportedImageMime): string {
  return `${PHOTO_ARCHIVE_PHOTO_DIR}/${photoId}.${extensionOfMime(mime)}`
}

function archiveReadme(manifest: PhotoArchiveManifest): string {
  return [
    'TeacherDesk 完整备份（含学生照片文件）',
    '',
    `应用版本：${manifest.appVersion}`,
    `导出时间：${manifest.exportedAt}`,
    `照片：清单 ${manifest.totals.photos} 张，已包含 ${manifest.totals.included} 张，` +
      `缺失 ${manifest.totals.missing} 张，失败 ${manifest.totals.failed} 张，` +
      `云端不可用未获取 ${manifest.totals.unavailable} 张，已删除 ${manifest.totals.deleted} 张。`,
    '',
    '目录说明：',
    `- ${PHOTO_ARCHIVE_BACKUP_ENTRY}：业务数据（结构与「导出数据（JSON）」完全相同）`,
    `- ${PHOTO_ARCHIVE_MANIFEST_ENTRY}：照片清单（photoId → ZIP 内文件 / 状态 / CRC）`,
    `- ${PHOTO_ARCHIVE_PHOTO_DIR}/<photoId>.<ext>：照片二进制，文件名就是稳定 photoId`,
    '',
    '请勿解压后重新压缩：本应用导出的是 stored（不压缩）ZIP，重新压缩会导致无法导入。',
    '本文件含学生照片，属于未成年人个人信息，请妥善保管，不要公开分享。',
  ].join('\n')
}

/**
 * 生成完整备份 ZIP（纯逻辑 + 注入的二进制解析）。
 *
 * 导出顺序固定（README → backup.json → 清单 → 照片按 photoId 排序），
 * 同一份输入每次产出的 ZIP 字节一致（CRC 与固定 DOS 时间都确定），便于自检与差分。
 */
export async function buildPhotoArchive(
  input: PhotoArchiveBuildInput,
): Promise<PhotoArchiveBuildResult> {
  const totals = emptyTotals()
  const photos = [...input.photos].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const manifestPhotos: PhotoArchiveManifestPhoto[] = []
  const photoEntries: { path: string; bytes: Uint8Array }[] = []

  for (const photo of photos) {
    totals.photos += 1
    const base: PhotoArchiveManifestPhoto = {
      photoId: photo.id,
      studentId: photo.studentId,
      studentName: photo.studentName,
      category: photo.category,
      status: 'missing-local',
      ...(photo.uploadedAt ? { uploadedAt: photo.uploadedAt } : {}),
    }
    if (photo.deletedAt) {
      base.status = 'deleted'
      countStatus(totals, 'deleted')
      manifestPhotos.push(base)
      continue
    }

    let resolved: PhotoBinaryResolution
    try {
      resolved = await input.resolveBinary(photo)
    } catch (error) {
      resolved = {
        ok: false,
        status: 'download-failed',
        reason: error instanceof Error && error.message ? error.message : '读取照片失败',
      }
    }
    if (!resolved.ok) {
      base.status = resolved.status
      base.reason = resolved.reason
      countStatus(totals, resolved.status)
      manifestPhotos.push(base)
      continue
    }

    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await resolved.blob.arrayBuffer())
    } catch {
      base.status = 'invalid-binary'
      base.reason = '照片内容读不出来'
      countStatus(totals, 'invalid-binary')
      manifestPhotos.push(base)
      continue
    }
    const mime = imageMimeOfBytes(bytes)
    if (!mime) {
      base.status = 'invalid-binary'
      base.reason = '照片内容不是受支持的图片格式（JPEG / PNG / WebP）'
      countStatus(totals, 'invalid-binary')
      manifestPhotos.push(base)
      continue
    }

    const path = photoEntryPath(photo.id, mime)
    base.status = 'included'
    base.path = path
    base.bytes = bytes.length
    base.crc32 = crc32(bytes)
    base.mimeType = mime
    countStatus(totals, 'included')
    manifestPhotos.push(base)
    photoEntries.push({ path, bytes })
  }

  const manifest: PhotoArchiveManifest = {
    kind: PHOTO_ARCHIVE_KIND,
    version: PHOTO_ARCHIVE_VERSION,
    appVersion: input.appVersion,
    exportedAt: input.exportedAt,
    totals,
    photos: manifestPhotos,
  }

  const encoder = new TextEncoder()
  const entries = [
    { name: PHOTO_ARCHIVE_README_ENTRY, data: encoder.encode(archiveReadme(manifest)) },
    { name: PHOTO_ARCHIVE_BACKUP_ENTRY, data: encoder.encode(input.backupJson) },
    {
      name: PHOTO_ARCHIVE_MANIFEST_ENTRY,
      data: encoder.encode(JSON.stringify(manifest, null, 2)),
    },
    ...photoEntries.map((entry) => ({ name: entry.path, data: entry.bytes })),
  ]
  const zipBytes = encodeZipStore(entries)
  // 复制到独立 ArrayBuffer 再包 Blob：不假设 Uint8Array 的底层缓冲恰好等于它的长度
  const buffer = new ArrayBuffer(zipBytes.byteLength)
  new Uint8Array(buffer).set(zipBytes)
  return { blob: new Blob([buffer], { type: 'application/zip' }), manifest, zipBytes }
}

/* ==================== 导入：结构 / 关联 / 完整性校验 ==================== */

export interface PhotoArchiveFileEntry {
  photoId: string
  blob: Blob
  bytes: number
  crc32: number
  mimeType: SupportedImageMime
}

export interface PhotoArchiveContents {
  /** 内嵌 JSON 备份（已按现有 `parseBackup` 校验过） */
  backup: BackupFile
  /** 备份里本应用不认识的数据块（与 JSON 导入同一口径：提示后忽略） */
  unknownModules: string[]
  /** 备份里缺 id 的条目（按块计数） */
  idless: { label: string; count: number }[]
  manifest: PhotoArchiveManifest
  /** 已通过全部校验、等待写回本机的照片文件 */
  photos: PhotoArchiveFileEntry[]
  warnings: string[]
}

export type PhotoArchiveParseResult =
  { ok: true; contents: PhotoArchiveContents } | { ok: false; error: string }

function fail(error: string): PhotoArchiveParseResult {
  return { ok: false, error }
}

const KNOWN_ARCHIVE_ENTRIES = new Set([
  PHOTO_ARCHIVE_README_ENTRY,
  PHOTO_ARCHIVE_BACKUP_ENTRY,
  PHOTO_ARCHIVE_MANIFEST_ENTRY,
])

function parseManifest(raw: unknown): PhotoArchiveManifest | string {
  if (!isPlainObject(raw)) return '照片清单格式不对，无法作为完整备份读取。'
  if (raw.kind !== PHOTO_ARCHIVE_KIND) return '这不是 TeacherDesk 的照片完整备份。'
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    return '照片清单缺少版本信息，无法作为完整备份读取。'
  }
  if (raw.version > PHOTO_ARCHIVE_VERSION) {
    return `照片备份来自更新版本的应用（清单版本 ${raw.version}），请升级后再导入。`
  }
  if (!Array.isArray(raw.photos)) return '照片清单内容读不出来（照片列表格式不对）。'
  if (!isPlainObject(raw.totals)) return '照片清单缺少汇总信息，无法校验完整性。'

  const totals: PhotoArchiveTotals = {
    photos: 0,
    included: 0,
    missing: 0,
    failed: 0,
    unavailable: 0,
    deleted: 0,
  }
  const photos: PhotoArchiveManifestPhoto[] = []
  const seenPhotoIds = new Set<string>()
  for (const item of raw.photos) {
    if (!isPlainObject(item)) return '照片清单里有无法识别的条目。'
    const photoId = typeof item.photoId === 'string' ? item.photoId.trim() : ''
    const studentId = typeof item.studentId === 'string' ? item.studentId.trim() : ''
    if (!photoId || !studentId) return '照片清单里有条目缺少 photoId / studentId，无法校验关联。'
    // 同一 photoId 出现两次会让「覆盖 / 新建」的归属与回滚快照无法判断，直接拒绝
    if (seenPhotoIds.has(photoId)) {
      return `照片清单里的 photoId 重复（${photoId}），无法安全恢复。`
    }
    seenPhotoIds.add(photoId)
    if (!isStudentPhotoCategory(item.category)) return `照片清单里的分类不合法（${photoId}）。`
    const status = item.status
    if (
      status !== 'included' &&
      status !== 'missing-local' &&
      status !== 'remote-unavailable' &&
      status !== 'download-failed' &&
      status !== 'invalid-binary' &&
      status !== 'deleted'
    ) {
      return `照片清单里的状态不合法（${photoId}）。`
    }
    const entry: PhotoArchiveManifestPhoto = {
      photoId,
      studentId,
      studentName: typeof item.studentName === 'string' ? item.studentName : '',
      category: item.category,
      status,
    }
    if (typeof item.reason === 'string' && item.reason.trim()) entry.reason = item.reason.trim()
    if (typeof item.uploadedAt === 'string' && item.uploadedAt.trim()) {
      entry.uploadedAt = item.uploadedAt.trim()
    }
    if (status === 'included') {
      const path = typeof item.path === 'string' ? item.path.trim() : ''
      if (!path.startsWith(`${PHOTO_ARCHIVE_PHOTO_DIR}/`)) {
        return `照片清单里的文件路径不合法（${photoId}）。`
      }
      if (
        typeof item.bytes !== 'number' ||
        !Number.isInteger(item.bytes) ||
        item.bytes <= 0 ||
        typeof item.crc32 !== 'number' ||
        !Number.isInteger(item.crc32)
      ) {
        return `照片清单里的文件信息不完整（${photoId}）。`
      }
      if (!isSupportedImageMime(item.mimeType)) {
        return `照片清单里的图片类型不受支持（${photoId}）。`
      }
      entry.path = path
      entry.bytes = item.bytes
      entry.crc32 = item.crc32
      entry.mimeType = item.mimeType
    } else if (item.path !== undefined) {
      return `照片清单里的未导出条目不应带文件路径（${photoId}）。`
    }
    photos.push(entry)
    totals.photos += 1
    countStatus(totals, status)
  }

  const declared = raw.totals
  const same = (key: keyof PhotoArchiveTotals): boolean => declared[key] === totals[key]
  if (
    !same('photos') ||
    !same('included') ||
    !same('missing') ||
    !same('failed') ||
    !same('unavailable') ||
    !same('deleted')
  ) {
    return '照片清单的汇总与明细对不上，文件可能已损坏。'
  }

  return {
    kind: PHOTO_ARCHIVE_KIND,
    version: raw.version,
    appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : '',
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    totals,
    photos,
  }
}

/**
 * 解析并**完整校验**一份完整备份 ZIP。任何一项不通过都返回 `{ ok: false }`，
 * 调用方据此在**不写盘**的前提下告诉教师原因。
 */
export function parsePhotoArchive(input: ArrayBuffer | Uint8Array): PhotoArchiveParseResult {
  let entries: ReturnType<typeof decodeZipStore>
  try {
    entries = decodeZipStore(input)
  } catch (error) {
    if (error instanceof ZipFormatError) return fail(error.message)
    return fail('读取 ZIP 失败，文件可能已损坏。')
  }

  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  const backupEntry = byName.get(PHOTO_ARCHIVE_BACKUP_ENTRY)
  const manifestEntry = byName.get(PHOTO_ARCHIVE_MANIFEST_ENTRY)
  if (!backupEntry) return fail('ZIP 里缺少 backup.json，不是完整的照片备份。')
  if (!manifestEntry) return fail('ZIP 里缺少照片清单，不是完整的照片备份。')

  const decoder = new TextDecoder('utf-8')
  const parsedBackup = parseBackup(decoder.decode(backupEntry.data))
  if (!parsedBackup.ok) return fail(`ZIP 里的数据备份无效：${parsedBackup.error}`)

  let manifestRaw: unknown
  try {
    manifestRaw = JSON.parse(decoder.decode(manifestEntry.data))
  } catch {
    return fail('ZIP 里的照片清单不是有效 JSON，文件可能已损坏。')
  }
  const manifest = parseManifest(manifestRaw)
  if (typeof manifest === 'string') return fail(manifest)

  const metadataValue = parsedBackup.backup.data[STUDENT_PHOTO_KEY]
  const metadataById = new Map<string, Record<string, unknown>>()
  if (Array.isArray(metadataValue)) {
    for (const item of metadataValue) {
      if (!isPlainObject(item)) continue
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      if (id) metadataById.set(id, item)
    }
  }

  const warnings: string[] = []
  const referencedPaths = new Set<string>()
  const photos: PhotoArchiveFileEntry[] = []

  for (const item of manifest.photos) {
    if (item.status !== 'included') continue
    const path = item.path
    const expectedBytes = item.bytes
    const expectedCrc = item.crc32
    const expectedMime = item.mimeType
    if (!path || expectedBytes === undefined || expectedCrc === undefined || !expectedMime) {
      return fail(`照片清单里的文件信息不完整（${item.photoId}）。`)
    }

    const record = metadataById.get(item.photoId)
    if (!record) {
      return fail(`照片清单与数据备份对不上：photoId「${item.photoId}」在照片元数据里不存在。`)
    }
    if (record.studentId !== item.studentId) {
      return fail(`照片「${item.photoId}」的学生关联与元数据不一致，无法安全恢复。`)
    }
    if (record.category !== item.category) {
      return fail(`照片「${item.photoId}」的分类与元数据不一致，无法安全恢复。`)
    }

    const entry = byName.get(path)
    if (!entry) return fail(`ZIP 里缺少照片文件「${path}」，备份不完整。`)
    if (entry.data.length !== expectedBytes) {
      return fail(`照片文件「${path}」大小与清单不一致，备份可能已损坏。`)
    }
    if (crc32(entry.data) !== expectedCrc) {
      return fail(`照片文件「${path}」校验失败，备份可能已损坏。`)
    }
    const detected = imageMimeOfBytes(entry.data)
    if (!detected) return fail(`照片文件「${path}」不是受支持的图片格式。`)
    if (detected !== expectedMime) {
      return fail(`照片文件「${path}」的实际类型与清单不一致，备份可能已损坏。`)
    }

    referencedPaths.add(path)
    photos.push({
      photoId: item.photoId,
      blob: new Blob([entry.data], { type: detected }),
      bytes: entry.data.length,
      crc32: expectedCrc,
      mimeType: detected,
    })
  }

  for (const entry of entries) {
    if (KNOWN_ARCHIVE_ENTRIES.has(entry.name)) continue
    if (entry.name.startsWith(`${PHOTO_ARCHIVE_PHOTO_DIR}/`)) {
      if (!referencedPaths.has(entry.name)) {
        warnings.push(`ZIP 里有清单未引用的文件「${entry.name}」，已忽略。`)
      }
      continue
    }
    warnings.push(`ZIP 里有无法识别的文件「${entry.name}」，已忽略。`)
  }
  if (photos.length !== manifest.totals.included) {
    return fail('照片清单与 ZIP 内的照片文件数量对不上，备份不完整。')
  }
  const manifestIds = new Set(manifest.photos.map((item) => item.photoId))
  for (const id of metadataById.keys()) {
    if (!manifestIds.has(id)) warnings.push(`照片「${id}」在清单里没有记录，按未导出处理。`)
  }

  return {
    ok: true,
    contents: {
      backup: parsedBackup.backup,
      unknownModules: parsedBackup.unknownModules,
      idless: parsedBackup.idless,
      manifest,
      photos,
      warnings,
    },
  }
}

/* ==================== 导入：写盘（可回滚） ==================== */

export interface PhotoArchiveRestoreDeps {
  /** localStorage 端口（合并写入走既有的原子写盘） */
  storage: StoragePort
  /** 已算好的合并结果（由调用方用 `planMerge` 得出；含所有数据块） */
  writes: Record<string, string>
  /**
   * 读取本机同 id 照片的**完整媒体快照**（原图 + 缩略图）；没有则 `null`。
   *
   * **必须在覆盖写入之前调用**：一旦覆盖，原图与缩略图就没了；只有先留快照，
   * 后续失败时才能原样还原。读取失败必须抛错——调用方据此在**未写入这张照片前**中止，
   * 不允许「读不出来就当作没有」然后覆盖掉原有媒体。
   */
  readPhotoSnapshot: (photoId: string) => Promise<PhotoArchiveMediaSnapshot | null>
  /** 写入一张照片（原图 + 缩略图；由调用方实现） */
  savePhoto: (photoId: string, blob: Blob, mimeType: SupportedImageMime) => Promise<void>
  /** 把快照原样写回（覆盖回滚用） */
  restorePhotoSnapshot: (photoId: string, snapshot: PhotoArchiveMediaSnapshot) => Promise<void>
  /** 删除一张本机照片（回滚本次新建的文件用） */
  removePhoto: (photoId: string) => Promise<void>
  onProgress?: (done: number, total: number) => void
}

/** 一张本机照片的完整媒体快照（原图 + 缩略图） */
export interface PhotoArchiveMediaSnapshot {
  full: Blob
  thumb: Blob
}

/** 回滚时未能完成的动作（**精确到文件**，界面据此报告哪些照片没恢复原状） */
export interface PhotoArchiveRollbackFailure {
  photoId: string
  /** `restore-overwritten`：覆盖前有原图、回滚写回失败；`remove-new`：本次新建、回滚删除失败 */
  action: 'restore-overwritten' | 'remove-new'
  error: string
}

export type PhotoArchiveRestoreResult =
  | {
      ok: true
      restoredPhotos: number
      /** 本次覆盖了多少张本机已有的同 id 照片（成功后以 ZIP 内的版本为准） */
      overwrittenPhotos: number
      commit: { count: number }
    }
  | {
      ok: false
      /** 失败发生在哪一阶段：照片写盘 / 业务数据写盘 */
      phase: 'photos' | 'data'
      /** 回滚动作是否全部成功（false 时看 `photoRollbackFailures` 的具体文件） */
      rolledBackPhotos: boolean
      /** 未能还原 / 未能删除的具体照片（空数组 = 回滚干净） */
      photoRollbackFailures: PhotoArchiveRollbackFailure[]
      /** 业务数据是否已回滚（`applyWrites` 的结论） */
      rolledBackData: boolean
      error: string
    }

function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * 把已通过校验的完整备份写回本机。
 *
 * ## 顺序与回滚（v3.8.1 Phase 1.1 修正）
 *
 * 1. **写每张照片前先读快照**：若本机已有同 `photoId`，把原图 + 缩略图留在内存里；
 * 2. 写入 ZIP 版本（同 id 时是**覆盖**）；
 * 3. 全部照片写完后，才用 `applyWrites` 原子合并业务数据；
 * 4. 任一阶段失败：
 *    - 被覆盖的照片 → 用快照**原样写回**原图与缩略图；
 *    - 本次新建的照片 → 删除；
 *    - 读取快照就失败的那张 → 当时尚未写入，**一个字节都不动**；
 *    - 写盘抛错的那张 → 视为可能已写入，按「有快照还原 / 无快照删除」处理。
 *
 * 因此失败时原有照片与原有业务数据都保持原样；唯一不可逆的情况是**回滚本身也失败**，
 * 此时返回值用 `photoRollbackFailures` 精确列出没恢复的文件，界面必须如实展示。
 */
export async function restorePhotoArchive(
  contents: PhotoArchiveContents,
  deps: PhotoArchiveRestoreDeps,
): Promise<PhotoArchiveRestoreResult> {
  const total = contents.photos.length
  /** 本次新建（覆盖前本机没有） */
  const newlyWritten: string[] = []
  /** 被覆盖的照片 → 覆盖前快照 */
  const overwritten = new Map<string, PhotoArchiveMediaSnapshot>()
  /** 正在写的那一张（save 抛错时它可能已经写进去了，回滚要带上） */
  let pending: {
    photoId: string
    snapshot: PhotoArchiveMediaSnapshot | null
    attempted: boolean
  } | null = null
  let done = 0

  async function rollbackPhotos(): Promise<PhotoArchiveRollbackFailure[]> {
    const failures: PhotoArchiveRollbackFailure[] = []
    // 先处理「写盘抛错的那张」：有快照就还原，没有就按新建删除
    if (pending?.attempted) {
      const { photoId, snapshot } = pending
      if (snapshot) {
        try {
          await deps.restorePhotoSnapshot(photoId, snapshot)
        } catch (error) {
          failures.push({
            photoId,
            action: 'restore-overwritten',
            error: errorMessageOf(error, '写回原图失败'),
          })
        }
      } else {
        try {
          await deps.removePhoto(photoId)
        } catch (error) {
          failures.push({
            photoId,
            action: 'remove-new',
            error: errorMessageOf(error, '删除本次写入失败'),
          })
        }
      }
    }
    // 再倒序还原已经被覆盖的（后覆盖的先还原）
    for (const [photoId, snapshot] of [...overwritten.entries()].reverse()) {
      try {
        await deps.restorePhotoSnapshot(photoId, snapshot)
      } catch (error) {
        failures.push({
          photoId,
          action: 'restore-overwritten',
          error: errorMessageOf(error, '写回原图失败'),
        })
      }
    }
    for (const photoId of newlyWritten) {
      try {
        await deps.removePhoto(photoId)
      } catch (error) {
        failures.push({
          photoId,
          action: 'remove-new',
          error: errorMessageOf(error, '删除本次新建照片失败'),
        })
      }
    }
    return failures
  }

  try {
    for (const photo of contents.photos) {
      // 先留快照：读失败会抛错，此时这张还没写，原有媒体不会被覆盖
      const snapshot = await deps.readPhotoSnapshot(photo.photoId)
      pending = { photoId: photo.photoId, snapshot, attempted: false }
      pending.attempted = true
      await deps.savePhoto(photo.photoId, photo.blob, photo.mimeType)
      if (snapshot) overwritten.set(photo.photoId, snapshot)
      else newlyWritten.push(photo.photoId)
      pending = null
      done += 1
      deps.onProgress?.(done, total)
    }
  } catch (error) {
    const failures = await rollbackPhotos()
    return {
      ok: false,
      phase: 'photos',
      rolledBackPhotos: failures.length === 0,
      photoRollbackFailures: failures,
      rolledBackData: true,
      error: errorMessageOf(error, '写入照片文件失败'),
    }
  }

  const outcome: CommitOutcome = applyWrites(deps.writes, deps.storage)
  if (!outcome.ok) {
    const failures = await rollbackPhotos()
    return {
      ok: false,
      phase: 'data',
      rolledBackPhotos: failures.length === 0,
      photoRollbackFailures: failures,
      rolledBackData: outcome.rolledBack,
      error: '业务数据写入失败',
    }
  }

  return {
    ok: true,
    restoredPhotos: contents.photos.length,
    overwrittenPhotos: overwritten.size,
    commit: { count: outcome.count },
  }
}

/* ==================== 界面辅助（纯函数） ==================== */

/** 完整备份文件名：`teacherdesk-complete-backup-YYYY-MM-DD.zip` */
export function photoArchiveFileName(date: Date): string {
  return `teacherdesk-complete-backup-${formatDateKey(date)}${PHOTO_ARCHIVE_EXTENSION}`
}

export interface PhotoArchiveProblem {
  photoId: string
  studentName: string
  status: PhotoArchivePhotoStatus
  reason?: string
}

/** 导出后需要如实告诉教师的「没进 ZIP 的照片」清单 */
export function photoArchiveProblems(manifest: PhotoArchiveManifest): PhotoArchiveProblem[] {
  return manifest.photos
    .filter((item) => item.status !== 'included' && item.status !== 'deleted')
    .map((item) => ({
      photoId: item.photoId,
      studentName: item.studentName,
      status: item.status,
      ...(item.reason ? { reason: item.reason } : {}),
    }))
}

/** 清单状态 → 中文文案（导出结果弹窗与测试共用） */
export function photoArchiveStatusLabel(status: PhotoArchivePhotoStatus): string {
  switch (status) {
    case 'included':
      return '已包含'
    case 'missing-local':
      return '缺失'
    case 'remote-unavailable':
      return '云端不可用，未获取'
    case 'download-failed':
      return '下载失败'
    case 'invalid-binary':
      return '图片格式不支持'
    case 'deleted':
      return '已删除'
  }
}

/** 触发浏览器下载（与 `downloadJson` 同一手法，失败必须让调用方说出来） */
export function downloadPhotoArchive(blob: Blob, filename: string): boolean {
  try {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    // 立刻 revoke 有概率打断下载，放到下一个宏任务再回收
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    return true
  } catch {
    return false
  }
}
