/**
 * 照片上传 outbox 自检（Phase 1B）。
 *
 * outbox 是**设备级**队列：只记"哪张还没传"，不参与同步、不进备份。
 * 这里验证：入队去重、落盘/重启恢复、失败尝试计数、错误脱敏、损坏数据安全降级。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { readRaw, writeJSON } from '@/services/storage'
import {
  enqueuePhotoUpload,
  PHOTO_OUTBOX_KEY,
  readPhotoOutbox,
  recordPhotoUploadAttempt,
  removePhotoUpload,
  sanitizePhotoUploadError,
} from '@/services/photoOutbox'
import { syncedKeys } from '@/services/sync'
import { BACKUP_MODULES } from '@/utils/backup'

let browser: FakeBrowser

beforeEach(() => {
  browser = installFakeBrowser()
})

describe('outbox：入队 / 去重 / 出队 / 持久化', () => {
  it('入队写入盘上（应用重启后能读回来）', () => {
    enqueuePhotoUpload('p1', 1000)
    expect(readRaw(PHOTO_OUTBOX_KEY)).toBeTruthy()
    expect(readPhotoOutbox()).toEqual([{ photoId: 'p1', attempts: 0, enqueuedAt: 1000 }])
  })

  it('同一张照片最多一条（重复入队幂等）', () => {
    enqueuePhotoUpload('p1', 1000)
    enqueuePhotoUpload('p1', 2000)
    expect(readPhotoOutbox()).toHaveLength(1)
    expect(readPhotoOutbox()[0]?.enqueuedAt).toBe(1000)
  })

  it('出队只删指定照片', () => {
    enqueuePhotoUpload('p1', 1)
    enqueuePhotoUpload('p2', 2)
    expect(removePhotoUpload('p1').map((task) => task.photoId)).toEqual(['p2'])
    expect(readPhotoOutbox().map((task) => task.photoId)).toEqual(['p2'])
    expect(removePhotoUpload('nope')).toHaveLength(1)
  })

  it('读取时按入队时间稳定排序，并丢弃坏条目', () => {
    writeJSON(PHOTO_OUTBOX_KEY, [
      { photoId: 'later', attempts: 0, enqueuedAt: 20 },
      { photoId: '', attempts: 0, enqueuedAt: 1 },
      { photoId: 'earlier', attempts: 2, enqueuedAt: 10, lastError: '失败' },
      'nope',
      { photoId: 'earlier', attempts: 9, enqueuedAt: 99 },
    ])
    expect(readPhotoOutbox()).toEqual([
      { photoId: 'earlier', attempts: 2, enqueuedAt: 10, lastError: '失败' },
      { photoId: 'later', attempts: 0, enqueuedAt: 20 },
    ])
  })

  it('盘上内容损坏 / 不是数组 → 安全降级为空队列（不抛错、不删原文）', () => {
    browser.localStorage.seed(PHOTO_OUTBOX_KEY, '{broken json')
    expect(readPhotoOutbox()).toEqual([])
    expect(readRaw(PHOTO_OUTBOX_KEY)).toBe('{broken json')

    writeJSON(PHOTO_OUTBOX_KEY, { not: 'array' })
    expect(readPhotoOutbox()).toEqual([])
  })
})

describe('outbox：失败尝试与错误脱敏', () => {
  it('记录尝试次数与脱敏原因', () => {
    enqueuePhotoUpload('p1', 1)
    const tasks = recordPhotoUploadAttempt(
      'p1',
      new Error('network failed https://signed.example.test/a?sign=abc'),
    )
    expect(tasks[0]).toMatchObject({ photoId: 'p1', attempts: 1 })
    expect(tasks[0]?.lastError).not.toContain('https://signed.example.test')
    expect(tasks[0]?.lastError).toContain('[url]')

    const again = recordPhotoUploadAttempt('p1', new Error('again'))
    expect(again[0]?.attempts).toBe(2)
  })

  it('脱敏：去 URL、压成一行、截断超长文本', () => {
    expect(sanitizePhotoUploadError('a\nb  https://x.test/y  c')).toBe('a b [url] c')
    const long = sanitizePhotoUploadError(new Error('x'.repeat(500)))
    expect(long.length).toBeLessThanOrEqual(161)
    expect(long.endsWith('…')).toBe(true)
    expect(sanitizePhotoUploadError(null)).toBe('上传失败')
  })

  it('对不存在的任务记尝试不会新增条目', () => {
    enqueuePhotoUpload('p1', 1)
    expect(recordPhotoUploadAttempt('other', new Error('x'))).toHaveLength(1)
  })
})

describe('outbox：与同步 / 备份隔离', () => {
  it('不注册云同步、不进备份模块表', () => {
    enqueuePhotoUpload('p1', 1)
    expect(syncedKeys()).not.toContain(PHOTO_OUTBOX_KEY)
    expect(BACKUP_MODULES.some((module) => module.key === PHOTO_OUTBOX_KEY)).toBe(false)
  })

  it('outbox 键带应用前缀（清空本机数据时会被前缀扫描带走）', () => {
    expect(PHOTO_OUTBOX_KEY.startsWith(`${appConfig.storageKeyPrefix}:`)).toBe(true)
  })
})
