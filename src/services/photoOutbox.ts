/**
 * 本地照片上传 outbox（v3.8.0 · Phase 1B）。
 *
 * ## 它是什么、不是什么
 *
 * - 它只记「**这台设备**上还有哪张照片没上传 + 试过几次 + 上次为什么失败」；
 * - **不注册 `syncPersisted`**、不参与云同步（别的设备不需要知道本机的上传队列）；
 * - **不进 `BACKUP_MODULES`**、不参与 JSON 备份（备份只保业务元数据）；
 * - 存的只是照片 id 之类的小对象，图片二进制永远在 IndexedDB / 云端。
 *
 * 因此它和 `utils/studentViewPrefs.ts` 是同一类"本机事实"：只有读写、没有登记。
 *
 * ## 幂等
 *
 * 同一张照片在队列里最多一条。上传本身也幂等：云端路径由 `photoId` 决定，
 * 重试永远是覆盖同一个对象，不会产生重复文件。
 *
 * ## 错误文本
 *
 * 只存脱敏后的短文本（去掉 URL、截断），避免把签名地址之类写进盘上或日志。
 */
import { appConfig } from '@/config'
import { readRaw, writeJSON } from '@/services/storage'
import { isPlainObject } from '@/utils/object'

/** 一条待上传任务 */
export interface PhotoUploadTask {
  photoId: string
  attempts: number
  enqueuedAt: number
  /** 上一次失败的脱敏原因（成功/未尝试时不存在） */
  lastError?: string
}

/** outbox 的存储键（不是教师数据，不进同步/备份） */
export const PHOTO_OUTBOX_KEY = `${appConfig.storageKeyPrefix}:photoOutbox`

const MAX_ERROR_LENGTH = 160

/** 错误文本脱敏：去掉 URL、压成一行、截断 */
export function sanitizePhotoUploadError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const oneLine = raw
    .replace(/\s+/g, ' ')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .trim()
  if (!oneLine) return '上传失败'
  return oneLine.length > MAX_ERROR_LENGTH ? `${oneLine.slice(0, MAX_ERROR_LENGTH)}…` : oneLine
}

function normalizeTask(raw: unknown): PhotoUploadTask | null {
  if (!isPlainObject(raw)) return null
  const photoId = typeof raw.photoId === 'string' ? raw.photoId.trim() : ''
  if (!photoId) return null
  const attempts =
    typeof raw.attempts === 'number' && Number.isFinite(raw.attempts) && raw.attempts >= 0
      ? Math.floor(raw.attempts)
      : 0
  const enqueuedAt =
    typeof raw.enqueuedAt === 'number' && Number.isFinite(raw.enqueuedAt) && raw.enqueuedAt > 0
      ? raw.enqueuedAt
      : Date.now()
  const lastError =
    typeof raw.lastError === 'string' && raw.lastError.trim()
      ? sanitizePhotoUploadError(raw.lastError)
      : undefined
  return { photoId, attempts, enqueuedAt, ...(lastError ? { lastError } : {}) }
}

/**
 * 读 outbox（应用重启后从这里恢复待上传任务）。
 * 损坏 / 读不出来 → 空队列并告警：丢了队列只是不自动补传，**本地照片不受影响**。
 */
export function readPhotoOutbox(): PhotoUploadTask[] {
  let raw: string | null
  try {
    raw = readRaw(PHOTO_OUTBOX_KEY)
  } catch (error) {
    console.warn('[photo] 读取待上传队列失败，本次按空队列处理：', error)
    return []
  }
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.warn('[photo] 待上传队列内容损坏，本次按空队列处理（原文件保留）：', error)
    return []
  }
  if (!Array.isArray(parsed)) {
    console.warn('[photo] 待上传队列不是数组，本次按空队列处理（原文件保留）')
    return []
  }
  const seen = new Set<string>()
  const tasks: PhotoUploadTask[] = []
  for (const item of parsed) {
    const task = normalizeTask(item)
    if (!task || seen.has(task.photoId)) continue
    seen.add(task.photoId)
    tasks.push(task)
  }
  return tasks.sort((a, b) => a.enqueuedAt - b.enqueuedAt || a.photoId.localeCompare(b.photoId))
}

/** 写 outbox（幂等写；写不进去只告警——照片本身已经在本地） */
export function writePhotoOutbox(tasks: PhotoUploadTask[]): void {
  writeJSON(PHOTO_OUTBOX_KEY, tasks)
}

/** 入队（已存在则原样返回，不重复入队） */
export function enqueuePhotoUpload(photoId: string, now: number = Date.now()): PhotoUploadTask[] {
  const tasks = readPhotoOutbox()
  if (!photoId || tasks.some((task) => task.photoId === photoId)) return tasks
  const next = [...tasks, { photoId, attempts: 0, enqueuedAt: now }]
  writePhotoOutbox(next)
  return next
}

/** 出队（上传成功 / 照片已删除 / 无法再上传时） */
export function removePhotoUpload(photoId: string): PhotoUploadTask[] {
  const tasks = readPhotoOutbox()
  const next = tasks.filter((task) => task.photoId !== photoId)
  if (next.length !== tasks.length) writePhotoOutbox(next)
  return next
}

/** 记一次失败尝试（attempts+1、留脱敏原因） */
export function recordPhotoUploadAttempt(photoId: string, error?: unknown): PhotoUploadTask[] {
  const tasks = readPhotoOutbox()
  const next = tasks.map((task) => {
    if (task.photoId !== photoId) return task
    const lastError = error === undefined ? undefined : sanitizePhotoUploadError(error)
    return {
      photoId: task.photoId,
      attempts: task.attempts + 1,
      enqueuedAt: task.enqueuedAt,
      ...(lastError ? { lastError } : {}),
    }
  })
  writePhotoOutbox(next)
  return next
}
