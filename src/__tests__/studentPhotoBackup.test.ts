/**
 * 照片元数据备份 / 恢复自检（Phase 1B）。
 *
 * 明确的**产品范围**：JSON 备份只包含照片**元数据**，不包含照片文件。
 * 这里验证：
 * - 导出包含元数据（含当前证件照标记、逻辑删除墓碑、fileId、上传时间）；
 * - 导出**不含** Blob / Base64 / 签名 URL / outbox；
 * - 导入恢复元数据、旧备份兼容、现有模块不受影响；
 * - 恢复后照片状态按"实际媒体是否存在"派生（不会因为元数据回来了就假装 ready）；
 * - 本版本不实现 ZIP / 照片二进制恢复。
 */
import { nextTick } from 'vue'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import {
  installPhotoTestDoubles,
  resetPhotoTestDoubles,
  type PhotoTestDoubles,
} from './helpers/photoDoubles'
import { appConfig } from '@/config'
import { STUDENT_PHOTOS_KEY } from '@/repositories'
import { localStoragePort } from '@/services/storage'
import { enqueuePhotoUpload } from '@/services/photoOutbox'
import { useStudentPhotoStore } from '@/stores/studentPhoto'
import {
  BACKUP_KIND,
  BACKUP_MODULES,
  BACKUP_SCHEMA_VERSION,
  applyWrites,
  createBackup,
  parseBackup,
  planMerge,
} from '@/utils/backup'
import type { Student } from '@/types'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`

let browser: FakeBrowser
let doubles: PhotoTestDoubles

const read = (key: string): string | null => browser.localStorage.getItem(key)

function student(id: string, name: string): Student {
  return { id, name, studentNo: '', gender: 'male' }
}

function seedStudents(): void {
  browser.localStorage.seed(STUDENTS_KEY, JSON.stringify([student('s1', '安琪')]))
}

function photoFile(): File {
  return new File([new Uint8Array(1024)], 'photo.jpg', { type: 'image/jpeg' })
}

function rawRecord(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    studentId: 's1',
    studentName: '安琪',
    category: 'id-photo',
    storagePath: `student-photos/s1/${id}.jpg`,
    mimeType: 'image/jpeg',
    width: 1600,
    height: 1200,
    size: 1024,
    uploadedAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  browser = installFakeBrowser()
  setActivePinia(createPinia())
  doubles = installPhotoTestDoubles()
})

afterEach(() => {
  resetPhotoTestDoubles()
  vi.restoreAllMocks()
})

/* ==================== 登记与导出 ==================== */

describe('备份登记与导出', () => {
  it('照片元数据登记进 BACKUP_MODULES，schema 版本不变', () => {
    const hit = BACKUP_MODULES.find((module) => module.key === STUDENT_PHOTOS_KEY)
    expect(hit).toMatchObject({ label: '学生照片', unit: '张' })
    expect(BACKUP_SCHEMA_VERSION).toBe(1)
  })

  it('真实新增 / 指定当前证件照 / 逻辑删除后导出：元数据完整、墓碑与标记都在', async () => {
    seedStudents()
    doubles.cloud.setAvailable(false)
    const store = useStudentPhotoStore()
    const photoA = await store.addPhoto('s1', photoFile(), 'id-photo')
    const photoB = await store.addPhoto('s1', photoFile(), 'id-photo')
    const photoC = await store.addPhoto('s1', photoFile(), 'life-photo')
    await store.setCurrentIdPhoto('s1', photoB.id)
    await store.removePhoto(photoC.id)
    await nextTick()

    const { backup } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    const rows = backup.data[STUDENT_PHOTOS_KEY] as Record<string, unknown>[]
    expect(rows).toHaveLength(3)
    expect(rows.find((row) => row.id === photoB.id)?.isCurrentIdPhoto).toBe(true)
    expect(rows.find((row) => row.id === photoC.id)?.deletedAt).toMatch(/Z$/)
    expect(rows.find((row) => row.id === photoA.id)?.uploadedAt).toBe(photoA.uploadedAt)

    // 明确排除：图片二进制 / Base64 / 签名 URL / outbox
    const json = JSON.stringify(backup)
    expect(json).not.toContain('data:image')
    expect(json).not.toContain('base64')
    expect(json).not.toContain('blob:')
    expect(json).not.toContain('https://')
    expect(json).not.toContain(`${prefix}:photoOutbox`)
    // 台账：备份里只有元数据字段，没有二进制字段
    for (const row of rows) {
      expect(Object.keys(row)).not.toEqual(
        expect.arrayContaining(['blob', 'arrayBuffer', 'signedUrl', 'dataUrl']),
      )
    }
  })

  it('未来版本未知字段随元数据一起导出（不丢跨版本信息）', () => {
    browser.localStorage.seed(
      STUDENT_PHOTOS_KEY,
      JSON.stringify([rawRecord('future', { futureField: 'keep-me', futureNested: { level: 2 } })]),
    )
    const { backup } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    const rows = backup.data[STUDENT_PHOTOS_KEY] as Record<string, unknown>[]
    expect(rows[0]).toMatchObject({ futureField: 'keep-me', futureNested: { level: 2 } })
  })

  it('outbox 不进入备份（即使盘上有待上传任务）', () => {
    enqueuePhotoUpload('p-pending', 1)
    const { backup } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    expect(Object.keys(backup.data).some((key) => key.endsWith(':photoOutbox'))).toBe(false)
    expect(JSON.stringify(backup)).not.toContain('p-pending')
  })
})

/* ==================== 解析 / 合并 ==================== */

describe('备份解析与合并恢复', () => {
  it('导出 → 解析 → 合并到空库：元数据原样写回（含墓碑 / 当前标记）', () => {
    browser.localStorage.seed(
      STUDENT_PHOTOS_KEY,
      JSON.stringify([
        rawRecord('a', { isCurrentIdPhoto: true, fileId: 'cloud://a' }),
        rawRecord('b', { deletedAt: '2026-11-10T00:00:00.000Z' }),
      ]),
    )
    const { backup } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    const parsed = parseBackup(JSON.stringify(backup))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const plan = planMerge({}, parsed.backup)
    const written = JSON.parse(plan.writes[STUDENT_PHOTOS_KEY]!) as Record<string, unknown>[]
    expect(written).toHaveLength(2)
    expect(written.find((row) => row.id === 'a')?.isCurrentIdPhoto).toBe(true)
    expect(written.find((row) => row.id === 'b')?.deletedAt).toBe('2026-11-10T00:00:00.000Z')
    expect(plan.stats.find((stat) => stat.label === '学生照片')).toMatchObject({
      added: 2,
      replaced: 0,
    })
  })

  it('导入合并：同一 id 用备份版本覆盖、备份独有的追加、本机独有的保留', () => {
    browser.localStorage.seed(
      STUDENT_PHOTOS_KEY,
      JSON.stringify([rawRecord('both', { size: 999 }), rawRecord('backup-only')]),
    )
    const { backup } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    const parsed = parseBackup(JSON.stringify(backup))
    if (!parsed.ok) throw new Error(parsed.error)

    const current = {
      [STUDENT_PHOTOS_KEY]: [rawRecord('both', { size: 1 }), rawRecord('local-only')],
    }
    const plan = planMerge(current, parsed.backup)
    const merged = JSON.parse(plan.writes[STUDENT_PHOTOS_KEY]!) as Record<string, unknown>[]
    expect(merged.map((row) => row.id)).toEqual(['both', 'local-only', 'backup-only'])
    expect(merged.find((row) => row.id === 'both')?.size).toBe(999)
  })
})

/* ==================== 恢复后的媒体状态 ==================== */

describe('恢复后状态按真实媒体派生（不伪造 ready）', () => {
  it('恢复元数据后：有 fileId 无本地 → remote-only；无 fileId 无本地 → missing；墓碑 → deleted', async () => {
    seedStudents()
    browser.localStorage.seed(
      STUDENT_PHOTOS_KEY,
      JSON.stringify([
        rawRecord('remote', {
          fileId: 'cloud://fake-env/student-photos/s1/remote.jpg',
          uploadedAt: '2026-11-02T00:00:00.000Z',
        }),
        rawRecord('lost'),
        rawRecord('tomb', { deletedAt: '2026-11-10T00:00:00.000Z' }),
      ]),
    )
    const { backup } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    const parsed = parseBackup(JSON.stringify(backup))
    if (!parsed.ok) throw new Error(parsed.error)

    // 模拟"换一台设备恢复"：本机只有学生档案，没有照片媒体
    browser.localStorage.removeItem(STUDENT_PHOTOS_KEY)
    const plan = planMerge({}, parsed.backup)
    const outcome = applyWrites(plan.writes, localStoragePort)
    expect(outcome.ok).toBe(true)

    setActivePinia(createPinia())
    const store = useStudentPhotoStore()
    await store.refreshLocalPresence()

    expect(store.findPhoto('remote')).toBeDefined()
    expect(store.stateOf('remote')).toBe('remote-only')
    expect(store.stateOf('lost')).toBe('missing')
    expect(store.stateOf('tomb')).toBe('deleted')
    expect(store.listStudentPhotos('s1').map((photo) => photo.id)).toEqual(['remote', 'lost'])

    // 恢复**不伪造**媒体：没有写任何本地文件
    expect(doubles.media.files.size).toBe(0)
  })

  it('恢复后的真实可用路径：remote-only → 下载后 ready', async () => {
    seedStudents()
    const fileId = 'cloud://fake-env/student-photos/s1/remote2.jpg'
    doubles.cloud.files.set(fileId, new Blob(['remote'], { type: 'image/jpeg' }))
    browser.localStorage.seed(
      STUDENT_PHOTOS_KEY,
      JSON.stringify([rawRecord('remote2', { fileId })]),
    )
    setActivePinia(createPinia())
    const store = useStudentPhotoStore()
    await store.refreshLocalPresence()
    expect(store.stateOf('remote2')).toBe('remote-only')
    await store.getPhotoBlob('remote2')
    expect(store.stateOf('remote2')).toBe('ready')
  })
})

/* ==================== 旧备份兼容 ==================== */

describe('旧备份兼容与现有模块隔离', () => {
  it('没有照片模块的旧备份：正常解析，且不写照片键', () => {
    const legacy = {
      app: appConfig.name,
      kind: BACKUP_KIND,
      schemaVersion: 1,
      appVersion: '3.7.8',
      exportedAt: '2026-11-01T00:00:00.000Z',
      data: { [STUDENTS_KEY]: [{ id: 's1', name: '安琪' }] },
    }
    const parsed = parseBackup(JSON.stringify(legacy))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const plan = planMerge({}, parsed.backup)
    expect(STUDENT_PHOTOS_KEY in plan.writes).toBe(false)
    expect(plan.stats.some((stat) => stat.label === '学生照片')).toBe(false)
  })

  it('含照片的备份不影响其它模块（学生档案等照常）', () => {
    browser.localStorage.seed(STUDENTS_KEY, JSON.stringify([student('s1', '安琪')]))
    browser.localStorage.seed(STUDENT_PHOTOS_KEY, JSON.stringify([rawRecord('a')]))
    const { backup } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    expect(backup.data[STUDENTS_KEY]).toHaveLength(1)
    expect(backup.data[STUDENT_PHOTOS_KEY]).toHaveLength(1)
    const parsed = parseBackup(JSON.stringify(backup))
    expect(parsed.ok).toBe(true)
  })

  it('JSON 备份仍不含照片二进制：完整照片备份是独立的 ZIP 格式（范围保护）', () => {
    browser.localStorage.seed(STUDENT_PHOTOS_KEY, JSON.stringify([rawRecord('a')]))
    const { backup } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    // v3.8.1 新增的「完整备份（含照片）」是 ZIP 容器；原有 JSON 备份结构一个字节不改
    expect(JSON.stringify(backup)).not.toContain('mediaPackage')
    expect(JSON.stringify(backup)).not.toContain('schemaVersion":2')
    expect(BACKUP_SCHEMA_VERSION).toBe(1)
  })
})

/* ==================== 损坏隔离 ==================== */

describe('照片块损坏不拖累其它模块', () => {
  it('照片元数据损坏时：备份跳过该块并回报，学生档案照常导出', () => {
    browser.localStorage.seed(STUDENTS_KEY, JSON.stringify([student('s1', '安琪')]))
    browser.localStorage.seed(STUDENT_PHOTOS_KEY, '{broken json')
    const { backup, broken } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    expect(broken).toContain('学生照片')
    expect(backup.data[STUDENTS_KEY]).toHaveLength(1)
    expect(STUDENT_PHOTOS_KEY in backup.data).toBe(false)
    // 其它块正常，整份备份仍可被解析（不会因为一个坏块整份失效）
    expect(parseBackup(JSON.stringify(backup)).ok).toBe(true)
  })
})

/* ==================== 二进制/敏感字段边界（Phase 3 实测发现并修复） ==================== */

describe('照片元数据的二进制 / 敏感字段绝不进入备份（导出与导入两侧都净化）', () => {
  const dirtyRecord = (): Record<string, unknown> =>
    rawRecord('guard', {
      fileId: 'cloud://fake-env/student-photos/s1/guard.jpg',
      signedUrl: 'https://signed.example.test/secret?sign=abc',
      base64: 'data:image/jpeg;base64,AAAA',
      dataUrl: 'data:image/jpeg;base64,BBBB',
      blob: { type: 'Blob', size: 10 },
      localObjectUrl: 'blob:http://localhost/123',
      futureField: 'keep-me',
      futureNested: { level: 2 },
    })

  it('导出：剔除签名 URL / Base64 / data URL / Blob / 本地 objectURL，保留 fileId 与未来字段', () => {
    browser.localStorage.seed(STUDENT_PHOTOS_KEY, JSON.stringify([dirtyRecord()]))
    const { backup } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    const rows = backup.data[STUDENT_PHOTOS_KEY] as Record<string, unknown>[]
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row).toMatchObject({
      id: 'guard',
      fileId: 'cloud://fake-env/student-photos/s1/guard.jpg',
      futureField: 'keep-me',
      futureNested: { level: 2 },
    })
    for (const key of ['signedUrl', 'base64', 'dataUrl', 'blob', 'localObjectUrl']) {
      expect(row, `备份不应含 ${key}`).not.toHaveProperty(key)
    }
    const text = JSON.stringify(backup)
    for (const needle of ['signed.example', 'base64', 'data:image', 'blob:', 'localObjectUrl']) {
      expect(text).not.toContain(needle)
    }
  })

  it('导入：备份里夹带的二进制/签名 URL 字段不会写回本机', () => {
    const legacy = {
      app: appConfig.name,
      kind: BACKUP_KIND,
      schemaVersion: 1,
      appVersion: '3.7.8',
      exportedAt: '2026-11-01T00:00:00.000Z',
      data: { [STUDENT_PHOTOS_KEY]: [dirtyRecord()] },
    }
    const parsed = parseBackup(JSON.stringify(legacy))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const plan = planMerge({}, parsed.backup)
    const written = JSON.parse(plan.writes[STUDENT_PHOTOS_KEY]!) as Record<string, unknown>[]
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ id: 'guard', futureField: 'keep-me' })
    for (const key of ['signedUrl', 'base64', 'dataUrl', 'blob', 'localObjectUrl']) {
      expect(written[0], `导入不应写回 ${key}`).not.toHaveProperty(key)
    }
  })

  it('净化不丢合法照片：有效记录（含墓碑与当前标记）原样保留', () => {
    browser.localStorage.seed(
      STUDENT_PHOTOS_KEY,
      JSON.stringify([
        rawRecord('current', { isCurrentIdPhoto: true, fileId: 'cloud://a' }),
        rawRecord('tomb', { deletedAt: '2026-11-10T00:00:00.000Z' }),
      ]),
    )
    const { backup } = createBackup(read, new Date('2026-11-13T10:00:00.000Z'))
    const rows = backup.data[STUDENT_PHOTOS_KEY] as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.id === 'current')?.isCurrentIdPhoto).toBe(true)
    expect(rows.find((row) => row.id === 'tomb')?.deletedAt).toBe('2026-11-10T00:00:00.000Z')
  })
})
