/**
 * 最小 stored ZIP 读写自检（v3.8.1 · Phase 1）。
 *
 * 照片完整备份依赖这个 ZIP 实现，所以这里钉住四类事：
 * 1. **往返一致**：写进去的名字 / 字节 / CRC 能原样读回来（含中文名、二进制、空归档）；
 * 2. **产物确定**：同一份输入编码两次字节完全一致（导出可复现）；
 * 3. **拒绝坏输入**：非 ZIP / 截断 / CRC 不符 / 压缩条目 / 加密 / 不安全路径 / 重名，
 *    全部给出可读错误，**绝不部分读取**；
 * 4. **不新增依赖**：本文件只用 `utils/zip.ts` 自己的实现。
 */
import { describe, expect, it } from 'vitest'

import {
  ZipFormatError,
  crc32,
  decodeZipStore,
  encodeZipStore,
  type ZipStoreEntry,
} from '@/utils/zip'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function entry(name: string, text: string): ZipStoreEntry {
  return { name, data: encoder.encode(text) }
}

function bytesOf(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

/** 把 ZIP 的中央目录与本地头里的「压缩方法」都改成 8（deflate），模拟第三方重新压缩 */
function patchCompressionMethod(zip: Uint8Array, method: number): Uint8Array {
  const copy = new Uint8Array(zip)
  const view = new DataView(copy.buffer)
  // 本地文件头在 0；中央目录从 EOCD 的 16 字节偏移读出
  view.setUint16(8, method, true)
  const eocd = copy.length - 22
  const centralOffset = view.getUint32(eocd + 16, true)
  view.setUint16(centralOffset + 10, method, true)
  return copy
}

describe('ZIP 写入 / 读取往返', () => {
  it('ASCII + 中文文件名、二进制内容都能原样读回', () => {
    const entries: ZipStoreEntry[] = [
      entry('backup.json', '{"kind":"teacherdesk-backup"}'),
      entry('photo-manifest.json', '{"photos":[]}'),
      { name: 'photos/照片-1.jpg', data: bytesOf(0xff, 0xd8, 0xff, 0x00, 0x01, 0x02) },
    ]
    const zip = encodeZipStore(entries)
    const decoded = decodeZipStore(zip)
    expect(decoded.map((item) => item.name)).toEqual(entries.map((item) => item.name))
    for (let index = 0; index < entries.length; index += 1) {
      expect(decoder.decode(decoded[index]!.data)).toBe(decoder.decode(entries[index]!.data))
      expect(decoded[index]!.crc32).toBe(crc32(entries[index]!.data))
    }
  })

  it('同一份输入编码两次，字节完全一致（导出可复现）', () => {
    const entries = [entry('a.txt', 'hello'), entry('目录/b.txt', '世界')]
    expect(encodeZipStore(entries)).toEqual(encodeZipStore(entries))
  })

  it('空归档：写出后能读出 0 个条目', () => {
    expect(decodeZipStore(encodeZipStore([]))).toEqual([])
  })

  it('ArrayBuffer 与 Uint8Array 两种入参等价', () => {
    const zip = encodeZipStore([entry('x.json', '{}')])
    const fromBuffer = decodeZipStore(zip.buffer as ArrayBuffer)
    const fromBytes = decodeZipStore(zip)
    expect(fromBytes.map((item) => item.name)).toEqual(fromBuffer.map((item) => item.name))
  })
})

describe('ZIP 拒绝坏输入（不部分读取）', () => {
  it('非 ZIP 字节 / 空内容', () => {
    expect(() => decodeZipStore(new Uint8Array(0))).toThrow(ZipFormatError)
    expect(() => decodeZipStore(encoder.encode('not a zip at all, just text'))).toThrow(
      ZipFormatError,
    )
  })

  it('截断的 ZIP：读取失败而不是返回半份数据', () => {
    const zip = encodeZipStore([entry('a.txt', 'hello world')])
    expect(() => decodeZipStore(zip.subarray(0, zip.length - 10))).toThrow(ZipFormatError)
  })

  it('数据被篡改：CRC 校验失败', () => {
    const zip = encodeZipStore([entry('a.txt', 'hello world')])
    const nameLength = zip[26]! | (zip[27]! << 8)
    const dataStart = 30 + nameLength
    zip[dataStart] = zip[dataStart]! ^ 0xff
    expect(() => decodeZipStore(zip)).toThrow(/校验失败/)
  })

  it('压缩条目：明确提示不要解压后重新压缩', () => {
    const zip = encodeZipStore([entry('a.txt', 'hello')])
    const patched = patchCompressionMethod(zip, 8)
    expect(() => decodeZipStore(patched)).toThrow(/压缩存储/)
  })

  it('加密条目：拒绝读取', () => {
    const zip = encodeZipStore([entry('a.txt', 'hello')])
    const copy = new Uint8Array(zip)
    const view = new DataView(copy.buffer)
    view.setUint16(6, view.getUint16(6, true) | 0x0001, true)
    const eocd = copy.length - 22
    const centralOffset = view.getUint32(eocd + 16, true)
    view.setUint16(centralOffset + 8, view.getUint16(centralOffset + 8, true) | 0x0001, true)
    expect(() => decodeZipStore(copy)).toThrow(/密码保护/)
  })

  it('写侧拒绝重名与不安全路径', () => {
    expect(() => encodeZipStore([entry('a.txt', '1'), entry('a.txt', '2')])).toThrow(/重名/)
    expect(() => encodeZipStore([entry('../escape.txt', 'x')])).toThrow(/不安全/)
    expect(() => encodeZipStore([entry('/absolute.txt', 'x')])).toThrow(/不安全/)
    expect(() => encodeZipStore([entry('a\\b.txt', 'x')])).toThrow(/不安全/)
  })
})
