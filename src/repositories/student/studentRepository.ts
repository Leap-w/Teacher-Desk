/**
 * 学生档案仓储（V2.2.0-alpha · Phase Cloud-1）。
 *
 * 数据源：`teacherdesk:students`（键名不变，老数据自动可用）。
 * 复活规则（`reviveStudents`）自 stores/student.ts 原样迁入——
 * **首屏加载与跨标签页同步共用这一份**（§11.1），迁移不改任何行为。
 */
import { appConfig } from '@/config'
import { createSeedStudents } from '@/services/mock'
import { normalizeStudent } from '@/utils/student'
import type { Student } from '@/types'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const STUDENTS_KEY = `${appConfig.storageKeyPrefix}:students`

/**
 * 把盘上的原始列表规范成内存里的学生表：丢弃非对象条目，逐条 normalize 补齐
 * 旧数据缺的家庭信息等字段。
 */
export function reviveStudents(raw: unknown[]): Student[] {
  return raw
    .filter((item): item is Student => Boolean(item) && typeof item === 'object')
    .map((item) => normalizeStudent(item))
}

const repository = createCollectionRepository<Student[]>({
  key: STUDENTS_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveStudents,
})

export const studentRepository = {
  ...repository,

  /** 读学生表；首次启动（键不存在）时播种示例数据并登记基线（Phase 9C 口径不变） */
  load(): Student[] {
    const stored = repository.load()
    if (stored !== null) return stored
    return repository.writeSeed(createSeedStudents())
  },
}
