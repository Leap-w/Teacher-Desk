import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { semesterRepository } from '@/repositories/semester/semesterRepository'
import type { SemesterSettings, SemesterWeek } from '@/types/semester'
import {
  DEFAULT_SEMESTER,
  SEMESTER_MAX_WEEKS,
  endDateMismatch,
  isSemesterDateKey,
  normalizeSemester,
  semesterWeeks,
  weekIndexOfDate,
} from '@/utils/semester'

/** 更新学期设置的返回契约：`{ ok: false, reason }` 里的原因直接展示给教师 */
export type SemesterUpdateOutcome = { ok: true } | { ok: false; reason: string }

/**
 * 学期设置（v3.7.5）：教学周次的统一来源。
 *
 * 数据源 `teacherdesk:semester`（单元素数组），首次编辑才落盘。**它只提供配置与周次，
 * 不反向引用任何业务 store**——换课 / 值日等模块从这里读周次，不各留一份。
 */
export const useSemesterStore = defineStore('semester', () => {
  const list = ref<SemesterSettings[]>(semesterRepository.load())

  semesterRepository.bind(list)

  /** 当前学期设置（键里只有这一条；读不动时已是默认值） */
  const settings = computed<SemesterSettings>(() => list.value[0] ?? { ...DEFAULT_SEMESTER })

  /** 教学周次表：第 1 周 = 开学日期起，每 7 天一周——全项目唯一来源 */
  const weeks = computed<SemesterWeek[]>(() => semesterWeeks(settings.value))

  /** 周数（= weeks.length，便捷读数） */
  const weekCount = computed(() => settings.value.totalWeeks)

  /** 结束日期与按周数推算的最后一周结束日不一致（界面提示用，不自动改配置） */
  const endMismatch = computed(() => endDateMismatch(settings.value))

  /** 某日期是第几教学周；学期范围外 → undefined（不猜最近的周次） */
  function weekOf(dateKey: string): number | undefined {
    return weekIndexOfDate(settings.value, dateKey)
  }

  /**
   * 更新学期设置：逐字段校验，任一不合法整笔拒绝（不写半截）。
   * 总分周数变化后，调用方应自行检查依赖周次的记录（换课）是否超范围并给出提示——
   * **本 action 不删任何业务数据**。
   */
  function update(patch: Partial<Omit<SemesterSettings, 'id'>>): SemesterUpdateOutcome {
    const next: SemesterSettings = { ...settings.value, ...patch, id: settings.value.id }
    if (typeof next.name !== 'string' || next.name.trim() === '') {
      return { ok: false, reason: '学期名称不能为空' }
    }
    if (!isSemesterDateKey(next.startDate)) {
      return { ok: false, reason: '开学日期不合法' }
    }
    if (
      !Number.isInteger(next.totalWeeks) ||
      next.totalWeeks < 1 ||
      next.totalWeeks > SEMESTER_MAX_WEEKS
    ) {
      return { ok: false, reason: `学期总周数需在 1–${SEMESTER_MAX_WEEKS} 之间` }
    }
    if (next.endDate !== '' && !isSemesterDateKey(next.endDate)) {
      return { ok: false, reason: '学期结束日期不合法' }
    }
    list.value = [normalizeSemester(next)]
    return { ok: true }
  }

  return {
    settings,
    weeks,
    weekCount,
    endMismatch,
    weekOf,
    update,
  }
})
