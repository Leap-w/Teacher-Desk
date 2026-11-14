/**
 * 照片云端通道自检（Phase 1B）。
 *
 * 分两层：
 * 1. `createCloudFileApi`（`services/cloudbase.ts`）——把 SDK 的 `{data,error}` 形状
 *    归一成「失败必抛」，并取到 fileID / 签名 URL / Blob；
 * 2. `createCloudbasePhotoCloud`（`services/photoCloud.ts`）——未登录/断网/权限错误的分类，
 *    以及 3600 秒签名有效期、重复签发（过期后重新获取）、不缓存 URL。
 *
 * 全部用注入的假存储客户端，**不连真实云端**。
 */
import { describe, expect, it } from 'vitest'

import { CloudError, createCloudFileApi, type CloudFileApi } from '@/services/cloudbase'
import {
  createCloudbasePhotoCloud,
  getPhotoCloud,
  PhotoCloudError,
  setPhotoCloud,
} from '@/services/photoCloud'

/* ==================== 适配层：SDK 形状归一 ==================== */

interface FakeStorageOptions {
  uploadResult?: unknown
  signedResult?: unknown
  downloadResult?: unknown
  existsResult?: unknown
}

function createFakeClassicStorage(options: FakeStorageOptions = {}) {
  const calls = {
    upload: [] as { path: string; contentType?: string }[],
    createSignedUrl: [] as { fileId: string; expiresIn: number }[],
    download: [] as string[],
    exists: [] as string[],
  }
  const storage = {
    async upload(path: string, _body: unknown, init?: { contentType?: string }) {
      calls.upload.push({ path, contentType: init?.contentType })
      return (
        options.uploadResult ?? {
          data: { id: `cloud://fake-env/${path}`, path, fullPath: path },
          error: null,
        }
      )
    },
    async createSignedUrl(fileId: string, expiresIn: number) {
      calls.createSignedUrl.push({ fileId, expiresIn })
      return (
        options.signedResult ?? {
          data: {
            signedUrl: `https://signed.example.test/${encodeURIComponent(fileId)}?e=${expiresIn}`,
          },
          error: null,
        }
      )
    },
    async download(fileId: string) {
      calls.download.push(fileId)
      return (
        options.downloadResult ?? { data: new Blob(['img'], { type: 'image/jpeg' }), error: null }
      )
    },
    async exists(fileId: string) {
      calls.exists.push(fileId)
      return options.existsResult ?? { data: true, error: null }
    },
  }
  return { storage, calls }
}

describe('createCloudFileApi：上传 / 签名 / 下载 / 存在性', () => {
  it('上传返回 fileID（并传 contentType）', async () => {
    const { storage, calls } = createFakeClassicStorage()
    const api = createCloudFileApi(storage)
    const result = await api.upload('student-photos/s1/p1.jpg', new Blob(['x']), 'image/jpeg')
    expect(result.fileId).toBe('cloud://fake-env/student-photos/s1/p1.jpg')
    expect(calls.upload[0]).toMatchObject({
      path: 'student-photos/s1/p1.jpg',
      contentType: 'image/jpeg',
    })
  })

  it('上传成功但云端没给 fileID → 抛 CloudError（不静默当成功）', async () => {
    const { storage } = createFakeClassicStorage({
      uploadResult: { data: { path: 'x' }, error: null },
    })
    const api = createCloudFileApi(storage)
    await expect(api.upload('x', new Blob(['x']), 'image/jpeg')).rejects.toBeInstanceOf(CloudError)
  })

  it('SDK 返回 { error } → 抛 CloudError（失败必抛）', async () => {
    const { storage } = createFakeClassicStorage({
      uploadResult: { data: null, error: { code: 'PERMISSION_DENIED', message: 'denied' } },
    })
    const api = createCloudFileApi(storage)
    const error = (await api
      .upload('x', new Blob(['x']), 'image/jpeg')
      .catch((caught: unknown) => caught)) as CloudError
    expect(error).toBeInstanceOf(CloudError)
    expect(error.message).toContain('denied')
  })

  it('签名 URL：传 expiresIn、返回字符串', async () => {
    const { storage, calls } = createFakeClassicStorage()
    const api = createCloudFileApi(storage)
    const url = await api.createSignedUrl('cloud://a', 3600)
    expect(url).toContain('signed.example.test')
    expect(calls.createSignedUrl[0]).toEqual({ fileId: 'cloud://a', expiresIn: 3600 })
  })

  it('签名 URL 缺失 → 抛 CloudError', async () => {
    const { storage } = createFakeClassicStorage({
      signedResult: { data: { signedUrl: '' }, error: null },
    })
    const api = createCloudFileApi(storage)
    await expect(api.createSignedUrl('cloud://a', 3600)).rejects.toBeInstanceOf(CloudError)
  })

  it('下载返回 Blob；拿到非 Blob → 抛 CloudError', async () => {
    const { storage } = createFakeClassicStorage()
    const api = createCloudFileApi(storage)
    expect(await api.download('cloud://a')).toBeInstanceOf(Blob)

    const broken = createFakeClassicStorage({ downloadResult: { data: null, error: null } })
    await expect(createCloudFileApi(broken.storage).download('cloud://a')).rejects.toBeInstanceOf(
      CloudError,
    )
  })

  it('存在性：true / false', async () => {
    const yes = createFakeClassicStorage()
    expect(await createCloudFileApi(yes.storage).exists('cloud://a')).toBe(true)
    const no = createFakeClassicStorage({ existsResult: { data: false, error: null } })
    expect(await createCloudFileApi(no.storage).exists('cloud://a')).toBe(false)
  })
})

/* ==================== 业务端口：可用性 / 错误分类 / 有效期 ==================== */

interface PortDeps {
  fileApi?: CloudFileApi
  ready?: boolean
  configured?: boolean
}

function createTestPort(deps: PortDeps = {}) {
  const calls = {
    upload: [] as { storagePath: string; mimeType: string; size: number }[],
    signedUrl: [] as { fileId: string; expiresIn: number }[],
    download: [] as string[],
    exists: [] as string[],
  }
  let signedUrlSeq = 0
  const fileApi: CloudFileApi = deps.fileApi ?? {
    async upload(storagePath, content, mimeType) {
      calls.upload.push({ storagePath, mimeType, size: content.size })
      return { fileId: `cloud://fake-env/${storagePath}` }
    },
    async createSignedUrl(fileId, expiresIn) {
      calls.signedUrl.push({ fileId, expiresIn })
      signedUrlSeq += 1
      return `https://signed.example.test/${encodeURIComponent(fileId)}?e=${expiresIn}&n=${signedUrlSeq}`
    },
    async download(fileId) {
      calls.download.push(fileId)
      return new Blob(['img'])
    },
    async exists(fileId) {
      calls.exists.push(fileId)
      return true
    },
  }
  const port = createCloudbasePhotoCloud({
    fileApi,
    isReady: () => deps.ready ?? true,
    isConfigured: () => deps.configured ?? true,
  })
  return { port, calls }
}

describe('createCloudbasePhotoCloud：上传 / 下载 / 签名 / 权限', () => {
  it('未登录 → 不上传，给可读的 unavailable 错误（照片仍在本地）', async () => {
    const { port, calls } = createTestPort({ ready: false })
    expect(port.isAvailable()).toBe(false)
    await expect(port.upload('p', new Blob(['x']), 'image/jpeg')).rejects.toMatchObject({
      name: 'PhotoCloudError',
      code: 'unavailable',
    })
    expect(calls.upload).toHaveLength(0)
  })

  it('未配置云环境 → unavailable', async () => {
    const { port } = createTestPort({ configured: false })
    expect(port.isAvailable()).toBe(false)
    await expect(port.upload('p', new Blob(['x']), 'image/jpeg')).rejects.toMatchObject({
      code: 'unavailable',
    })
  })

  it('上传成功返回 fileID；签名 URL 有效期固定 3600 秒', async () => {
    const { port, calls } = createTestPort()
    const uploaded = await port.upload('student-photos/s1/p1.jpg', new Blob(['x']), 'image/jpeg')
    expect(uploaded.fileId).toContain('student-photos/s1/p1.jpg')
    expect(calls.upload[0]?.mimeType).toBe('image/jpeg')

    await port.createSignedUrl(uploaded.fileId)
    expect(calls.signedUrl[0]).toEqual({ fileId: uploaded.fileId, expiresIn: 3600 })
  })

  it('签名 URL 每次重新签发（过期后重新获取，不缓存旧地址）', async () => {
    const { port, calls } = createTestPort()
    const first = await port.createSignedUrl('cloud://a')
    const second = await port.createSignedUrl('cloud://a')
    expect(first).not.toBe(second)
    expect(calls.signedUrl).toHaveLength(2)
  })

  it('权限错误被分类为 permission-denied，且提示可读', async () => {
    const permissionFileApi: CloudFileApi = {
      async upload() {
        throw new CloudError('STORAGE_EXCEED_AUTHORITY: no permission', 'STORAGE_EXCEED_AUTHORITY')
      },
      async createSignedUrl() {
        throw new CloudError('PERMISSION_DENIED', 'PERMISSION_DENIED')
      },
      async download() {
        throw new CloudError('PERMISSION_DENIED', 'PERMISSION_DENIED')
      },
      async exists() {
        return true
      },
    }
    const { port } = createTestPort({ fileApi: permissionFileApi })
    await expect(port.upload('p', new Blob(['x']), 'image/jpeg')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    await expect(port.createSignedUrl('cloud://a')).rejects.toMatchObject({
      code: 'permission-denied',
    })
  })

  it('网络 / 普通失败被分类为 upload-failed / download-failed / signed-url-failed', async () => {
    const failingFileApi: CloudFileApi = {
      async upload() {
        throw new Error('network timeout')
      },
      async createSignedUrl() {
        throw new Error('network timeout')
      },
      async download() {
        throw new Error('network timeout')
      },
      async exists() {
        throw new Error('network timeout')
      },
    }
    const { port } = createTestPort({ fileApi: failingFileApi })
    await expect(port.upload('p', new Blob(['x']), 'image/jpeg')).rejects.toMatchObject({
      code: 'upload-failed',
    })
    await expect(port.createSignedUrl('cloud://a')).rejects.toMatchObject({
      code: 'signed-url-failed',
    })
    await expect(port.download('cloud://a')).rejects.toMatchObject({ code: 'download-failed' })
    await expect(port.exists('cloud://a')).rejects.toMatchObject({ code: 'check-failed' })
  })

  it('云端文件不存在 → check-failed', async () => {
    const missingFileApi: CloudFileApi = {
      async upload() {
        return { fileId: 'x' }
      },
      async createSignedUrl() {
        throw new CloudError('STORAGE_FILE_NONEXIST', 'STORAGE_FILE_NONEXIST')
      },
      async download() {
        throw new CloudError('STORAGE_FILE_NONEXIST', 'STORAGE_FILE_NONEXIST')
      },
      async exists() {
        return false
      },
    }
    const { port } = createTestPort({ fileApi: missingFileApi })
    await expect(port.createSignedUrl('cloud://a')).rejects.toMatchObject({ code: 'check-failed' })
    expect(await port.exists('cloud://a')).toBe(false)
  })

  it('错误信息里不出现签名 URL（脱敏）', async () => {
    const urlLeakingFileApi: CloudFileApi = {
      async upload() {
        throw new Error('failed while calling https://signed.example.test/secret?sign=abc')
      },
      async createSignedUrl() {
        throw new Error('failed https://signed.example.test/secret?sign=abc')
      },
      async download() {
        throw new Error('failed https://signed.example.test/secret?sign=abc')
      },
      async exists() {
        return true
      },
    }
    const { port } = createTestPort({ fileApi: urlLeakingFileApi })
    const error = (await port
      .upload('p', new Blob(['x']), 'image/jpeg')
      .catch((caught: unknown) => caught)) as PhotoCloudError
    expect(error.message).not.toContain('https://signed.example.test')
  })
})

/* ==================== 注册表 ==================== */

describe('照片云端注册表', () => {
  it('可替换为测试端口，复位后回到生产实现', () => {
    const { port } = createTestPort()
    setPhotoCloud(port)
    expect(getPhotoCloud()).toBe(port)
    setPhotoCloud(null)
    expect(getPhotoCloud()).not.toBe(port)
    expect(typeof getPhotoCloud().isAvailable).toBe('function')
  })
})
