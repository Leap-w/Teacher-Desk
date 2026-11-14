/**
 * 违纪管理 UI 逻辑自检（v3.8.0 · Phase 2）。
 *
 * 分两层：
 * 1. `utils/violationUi.ts` 纯函数：选项来源、时间段与课程表联动、选择器排序 / 搜索 /
 *    快捷选择、筛选换算；
 * 2. 真实 `useViolationStore()` + `useStudentStore()` + 假浏览器 localStorage 联调：
 *    批量新增 N 人 = N 条独立事件、编辑、家长意见、删除、排行、软删除学生历史。
 *
 * node 环境不渲染 DOM；组件模板的交互入口由这些被组件直接调用的函数与 Store 行为覆盖。
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { COURSE_PERIODS } from '@/types/timetable'
import { useStudentStore } from '@/stores/student'
import { useViolationStore } from '@/stores/violation'
import {
  DEFAULT_VIOLATION_LIST_FILTER,
  addStudentsByDormitory,
  addStudentsByGender,
  addStudentsToSelection,
  buildDormitoryQuickOptions,
  buildViolationPickerRows,
  clearStudentSelection,
  defaultSeverityOfPresetId,
  findTimetableSubject,
  isViolationFilterActive,
  severityBadgeVariant,
  suggestSubjectFor,
  timeSlotDraftForKind,
  toViolationQuery,
  toggleStudentSelection,
  VIOLATION_PERIOD_OPTIONS,
  VIOLATION_SEVERITY_OPTIONS,
  VIOLATION_SYSTEM_PRESET_OPTIONS,
  VIOLATION_TIME_SLOT_OPTIONS,
  buildViolationEventOptions,
  selectionForEditingEvent,
  weekdayOfDateKey,
} from '@/utils/violationUi'
import type { Lesson } from '@/types/timetable'
import type { Student } from '@/types'
import type { ViolationBatchDraft, ViolationCustomPreset, ViolationEvent } from '@/types/violation'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`

let browser: FakeBrowser

function student(id: string, name: string, extra: Partial<Student> = {}): Student {
  return { id, name, studentNo: '', gender: 'male', ...extra }
}

function seedStudents(roster: Student[]): void {
  browser.localStorage.seed(STUDENTS_KEY, JSON.stringify(roster))
}

function openStores(roster: Student[]) {
  seedStudents(roster)
  const studentStore = useStudentStore()
  const violationStore = useViolationStore()
  return { studentStore, violationStore }
}

function batchDraft(overrides: Partial<ViolationBatchDraft> = {}): ViolationBatchDraft {
  return {
    date: '2026-11-03',
    timeSlotKind: 'forenoon',
    behaviorLabel: '迟到',
    severity: 'minor',
    ...overrides,
  }
}

function lesson(weekday: Lesson['weekday'], periodId: Lesson['periodId'], subject: string): Lesson {
  return {
    id: `lesson-${weekday}-${periodId}`,
    weekday,
    periodId,
    subject,
    classId: 'class-1',
    className: '高一9班',
    teacher: '我',
    type: 'normal',
  }
}

beforeEach(() => {
  browser = installFakeBrowser()
  setActivePinia(createPinia())
})

/* ==================== 选项来源 ==================== */

describe('选项全部来自数据层（不在 UI 里硬编码第二份）', () => {
  it('严重程度三档、分类五档、时间段八种', () => {
    expect(VIOLATION_SEVERITY_OPTIONS.map((item) => item.value)).toEqual([
      'minor',
      'moderate',
      'severe',
    ])
    expect(VIOLATION_SEVERITY_OPTIONS.map((item) => item.label)).toEqual([
      '一般违纪',
      '较严重违纪',
      '严重违纪',
    ])
    expect(VIOLATION_TIME_SLOT_OPTIONS.map((item) => item.value)).toEqual([
      'morning',
      'forenoon',
      'noon',
      'afternoon',
      'evening',
      'lights-out',
      'period',
      'custom',
    ])
    expect(VIOLATION_TIME_SLOT_OPTIONS.some((item) => item.value === 'period')).toBe(true)
    expect(VIOLATION_TIME_SLOT_OPTIONS.some((item) => item.value === 'custom')).toBe(true)
  })

  it('课表节次直接复用 COURSE_PERIODS', () => {
    expect(VIOLATION_PERIOD_OPTIONS).toHaveLength(COURSE_PERIODS.length)
    expect(VIOLATION_PERIOD_OPTIONS[0]?.value).toBe(COURSE_PERIODS[0]?.id)
  })

  it('系统预设扁平选项（24 条）默认严重程度来自预设；自定义事件追加在末尾', () => {
    expect(VIOLATION_SYSTEM_PRESET_OPTIONS).toHaveLength(24)
    expect(VIOLATION_SYSTEM_PRESET_OPTIONS.some((item) => item.value === 'routine-late')).toBe(true)
    expect(VIOLATION_SYSTEM_PRESET_OPTIONS.some((item) => item.value === 'other-fight')).toBe(true)
    expect(VIOLATION_SYSTEM_PRESET_OPTIONS.some((item) => item.value === 'other-custom')).toBe(
      false,
    )

    expect(defaultSeverityOfPresetId('other-fight')).toBe('severe')
    expect(defaultSeverityOfPresetId('routine-late')).toBe('minor')
    // 未知 / 已下线的预设 id 兜底为一般违纪（仍允许教师上调）
    expect(defaultSeverityOfPresetId('no-such-preset')).toBe('minor')
    expect(defaultSeverityOfPresetId(undefined)).toBe('minor')

    const options = buildViolationEventOptions([
      {
        id: 'custom-1',
        label: '课堂上擅自离开座位',
        labelKey: '课堂上擅自离开座位',
        defaultSeverity: 'moderate',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
    ])
    expect(options).toHaveLength(26)
    expect(options[24]).toEqual({ value: 'custom-1', label: '课堂上擅自离开座位' })
    expect(options[25]?.label).toContain('自定义事件')
  })

  it('严重程度只用于色调，界面同时显示文字', () => {
    expect(severityBadgeVariant('minor')).toBe('neutral')
    expect(severityBadgeVariant('moderate')).toBe('warning')
    expect(severityBadgeVariant('severe')).toBe('danger')
  })
})

/* ==================== 时间段 / 课表 ==================== */

describe('时间段与课程表联动（第 X 节课 / 自定义）', () => {
  it('日期键 → 星期几；非法日期返回 undefined', () => {
    expect(weekdayOfDateKey('2026-11-03')).toBe(
      (((new Date(2026, 10, 3).getDay() + 6) % 7) + 1) as never,
    )
    expect(weekdayOfDateKey('2026-13-01')).toBeUndefined()
    expect(weekdayOfDateKey('')).toBeUndefined()
  })

  it('能从课表带出科目；没课返回 undefined（允许手填）', () => {
    const weekday = weekdayOfDateKey('2026-11-03')!
    const lessons = [lesson(weekday, COURSE_PERIODS[0]!.id, '数学')]
    expect(findTimetableSubject(lessons, weekday, COURSE_PERIODS[0]!.id)).toBe('数学')
    expect(findTimetableSubject(lessons, weekday, COURSE_PERIODS[1]!.id)).toBeUndefined()
    expect(suggestSubjectFor(lessons, '2026-11-03', COURSE_PERIODS[0]!.id)).toBe('数学')
  })

  it('切换时间段类型会清掉无关字段（不产生"早上 · 数学"这种矛盾组合）', () => {
    const period = timeSlotDraftForKind('period', {
      timeSlotKind: 'period',
      periodId: COURSE_PERIODS[0]!.id,
      subject: '数学',
    })
    expect(period).toMatchObject({ timeSlotKind: 'period', subject: '数学' })

    const morning = timeSlotDraftForKind('morning', period)
    expect(morning).toEqual({ timeSlotKind: 'morning' })

    const custom = timeSlotDraftForKind('custom', {
      timeSlotKind: 'custom',
      customTimeText: '午休期间',
    })
    expect(custom).toEqual({ timeSlotKind: 'custom', customTimeText: '午休期间' })
  })
})

/* ==================== 学生选择器 ==================== */

const roster: Student[] = [
  student('s1', '白玛', { gender: 'female', dormitory: '301' }),
  student('s2', '安琪', { gender: 'female', dormitory: '301' }),
  student('s3', '扎西', { gender: 'male', dormitory: '201' }),
  student('s4', '次仁', { gender: 'male', studentNo: '2026001', idCardSuffix: '3287' }),
]

const counts = new Map([
  ['s1', 5],
  ['s2', 0],
  ['s3', 2],
  ['s4', 2],
])

describe('学生选择器：搜索 / 排序 / 快捷选择 / 组合', () => {
  it('默认按累计次数降序 → 姓名升序 → id 兜底', () => {
    const rows = buildViolationPickerRows(roster, counts)
    // Intl.Collator('zh-Hans-CN') 下：安(ān) < 次(cì) < 白(bái)？——以运行结果为准，
    // 这里只断言规则本身：次数降序，次数相同按拼音序
    expect(rows.map((row) => row.count)).toEqual([5, 2, 2, 0])
    expect(rows[0]?.student.id).toBe('s1')
    expect(rows[1]?.count).toBe(2)
    expect(rows[2]?.count).toBe(2)
    // 次数相同时姓名升序：扎西 vs 次仁 → 扎西（zhā）在 次仁（cì）之前？
    // 按 Intl.Collator('zh-Hans-CN') 的拼音序：次(c) < 扎(z)，故次仁应在扎西前
    const tied = rows.filter((row) => row.count === 2).map((row) => row.student.name)
    expect(tied).toEqual([...tied].sort((a, b) => new Intl.Collator('zh-Hans-CN').compare(a, b)))
  })

  it('按姓名 / 学号 / 身份证尾号搜索', () => {
    expect(
      buildViolationPickerRows(roster, counts, { keyword: '白玛' }).map((row) => row.student.id),
    ).toEqual(['s1'])
    expect(
      buildViolationPickerRows(roster, counts, { keyword: '2026001' }).map((row) => row.student.id),
    ).toEqual(['s4'])
    expect(
      buildViolationPickerRows(roster, counts, { keyword: '3287' }).map((row) => row.student.id),
    ).toEqual(['s4'])
  })

  it('性别筛选与行信息（性别 / 宿舍 / 次数）', () => {
    const maleRows = buildViolationPickerRows(roster, counts, { gender: 'male' })
    expect(maleRows.map((row) => row.student.id).sort()).toEqual(['s3', 's4'])
    expect(maleRows.find((row) => row.student.id === 's3')).toMatchObject({
      genderLabel: '男',
      dormitoryLabel: '201',
    })
    const noDorm = buildViolationPickerRows(roster, counts).find((row) => row.student.id === 's4')
    expect(noDorm?.dormitoryLabel).toBe('未分配')
  })

  it('全选男生 / 全选女生 / 宿舍 / 未分配 可叠加，且可取消与清空', () => {
    let selection = new Set<string>()
    selection = addStudentsByGender(selection, roster, 'female')
    expect([...selection].sort()).toEqual(['s1', 's2'])

    selection = addStudentsByDormitory(selection, roster, '201')
    expect([...selection].sort()).toEqual(['s1', 's2', 's3'])

    selection = addStudentsToSelection(
      selection,
      roster.filter((item) => item.id === 's4'),
    )
    expect(selection.size).toBe(4)

    selection = toggleStudentSelection(selection, 's1')
    expect(selection.has('s1')).toBe(false)
    selection = toggleStudentSelection(selection, 's1')
    expect(selection.has('s1')).toBe(true)

    expect([...clearStudentSelection()]).toEqual([])

    const unassigned = addStudentsByDormitory(new Set<string>(), roster, '')
    expect([...unassigned]).toEqual(['s4'])
  })

  it('宿舍快捷选项只列实际出现过的宿舍 + 未分配人数', () => {
    const options = buildDormitoryQuickOptions(roster)
    expect(options[0]).toEqual({ value: '', label: '未分配宿舍', count: 1 })
    expect(options.some((item) => item.value === '301' && item.count === 2)).toBe(true)
    expect(options.some((item) => item.value === '201' && item.count === 1)).toBe(true)
    expect(options.length).toBe(3)
  })
})

/* ==================== 编辑回填（历史兼容） ==================== */

describe('编辑回填：系统 / 自定义 / other-custom / 无预设', () => {
  const custom: ViolationCustomPreset = {
    id: 'custom-1',
    label: '课堂上擅自离开座位',
    labelKey: '课堂上擅自离开座位',
    defaultSeverity: 'minor',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  }

  function event(overrides: Partial<ViolationEvent> = {}): ViolationEvent {
    return {
      id: 'v1',
      studentId: 's1',
      studentName: '安琪',
      date: '2026-11-03',
      timeSlotKind: 'forenoon',
      behaviorLabel: '迟到',
      severity: 'minor',
      createdAt: '2026-11-03T01:00:00.000Z',
      updatedAt: '2026-11-03T01:00:00.000Z',
      ...overrides,
    }
  }

  it('系统预设事件：回填系统 id，严重程度取历史值（不回算预设默认）', () => {
    const selection = selectionForEditingEvent(
      event({ presetId: 'routine-late', presetKind: 'system', severity: 'severe' }),
      [custom],
    )
    expect(selection).toEqual({
      presetId: 'routine-late',
      customBehavior: '',
      severity: 'severe',
    })
  })

  it('仍存在的自定义预设：回填自定义 id 与其默认严重程度无关（取历史 severity）', () => {
    const selection = selectionForEditingEvent(
      event({
        presetId: custom.id,
        presetKind: 'custom',
        behaviorLabel: custom.label,
        severity: 'severe',
      }),
      [custom],
    )
    expect(selection).toEqual({
      presetId: custom.id,
      customBehavior: '',
      severity: 'severe',
    })
  })

  it('旧 other-custom：回填自定义输入框 + 原始 behaviorLabel，绝不显示「其他自定义事件」', () => {
    const selection = selectionForEditingEvent(
      event({
        presetId: 'other-custom',
        behaviorLabel: '课堂上擅自离开座位',
        severity: 'moderate',
      }),
      [],
    )
    expect(selection.presetId).toBe('__custom_event__')
    expect(selection.customBehavior).toBe('课堂上擅自离开座位')
    expect(selection.severity).toBe('moderate')
  })

  it('无预设 / 已下线预设 / 历史缺 presetKind：都回填原始 behaviorLabel', () => {
    for (const presetId of [undefined, 'removed-preset']) {
      const selection = selectionForEditingEvent(
        event({ presetId, behaviorLabel: '旧版本事件名', severity: 'severe' }),
        [custom],
      )
      expect(selection.presetId).toBe('__custom_event__')
      expect(selection.customBehavior).toBe('旧版本事件名')
      expect(selection.severity).toBe('severe')
    }
  })
})

/* ==================== 筛选换算 ==================== */

describe('列表筛选换算', () => {
  it('关键字去空白；全部 = 不传条件；单选项翻译为单元素数组（无分类条件）', () => {
    expect(toViolationQuery(DEFAULT_VIOLATION_LIST_FILTER)).toEqual({})
    expect(toViolationQuery({ keyword: ' 迟到 ', severity: 'severe' })).toEqual({
      keyword: '迟到',
      severities: ['severe'],
    })
  })

  it('是否处于筛选状态（空状态文案据此区分）', () => {
    expect(isViolationFilterActive(DEFAULT_VIOLATION_LIST_FILTER)).toBe(false)
    expect(isViolationFilterActive({ ...DEFAULT_VIOLATION_LIST_FILTER, keyword: '  ' })).toBe(false)
    expect(isViolationFilterActive({ ...DEFAULT_VIOLATION_LIST_FILTER, severity: 'minor' })).toBe(
      true,
    )
  })
})

/* ==================== 与真实 Store 联调 ==================== */

describe('批量新增：N 名学生 → N 条独立事件，关联正确', () => {
  it('每人独立 ID / studentId / 姓名快照，且只写一次', () => {
    const { violationStore } = openStores(roster)
    const created = violationStore.addViolationsForStudents(['s1', 's2', 's3'], batchDraft())

    expect(created).toHaveLength(3)
    expect(new Set(created.map((event) => event.id)).size).toBe(3)
    expect(created.map((event) => event.studentId).sort()).toEqual(['s1', 's2', 's3'])
    expect(created.every((event) => event.behaviorLabel === '迟到')).toBe(true)
    expect(created.every((event) => event.date === '2026-11-03')).toBe(true)

    // 姓名快照与自己关联的学生一致（不是所有人都是第一名学生）
    const byId = new Map(created.map((event) => [event.studentId, event.studentName]))
    expect(byId.get('s1')).toContain('白玛')
    expect(byId.get('s2')).toContain('安琪')
    expect(byId.get('s3')).toContain('扎西')

    expect(violationStore.events).toHaveLength(3)
    expect(violationStore.countByStudent.get('s1')).toBe(1)
  })

  it('第 X 节课保存 periodId / periodLabel / subject 快照', () => {
    const { violationStore } = openStores(roster)
    const [event] = violationStore.addViolationsForStudents(
      ['s1'],
      batchDraft({
        timeSlotKind: 'period',
        periodId: COURSE_PERIODS[0]!.id,
        periodLabel: COURSE_PERIODS[0]!.label,
        subject: '数学',
      }),
    )
    expect(event).toMatchObject({
      timeSlotKind: 'period',
      periodId: COURSE_PERIODS[0]!.id,
      subject: '数学',
    })
    expect(event?.periodLabel).toBe(COURSE_PERIODS[0]!.label)
  })

  it('八种时间段都能按各自字段落库（表单选项与数据层一致）', () => {
    const { violationStore } = openStores(roster)
    const kinds = VIOLATION_TIME_SLOT_OPTIONS.map((option) => option.value)
    for (const timeSlotKind of kinds) {
      const [event] = violationStore.addViolationsForStudents(
        ['s1'],
        batchDraft({
          timeSlotKind,
          ...(timeSlotKind === 'period'
            ? { periodId: COURSE_PERIODS[0]!.id, periodLabel: COURSE_PERIODS[0]!.label }
            : {}),
          ...(timeSlotKind === 'custom' ? { customTimeText: '午休期间' } : {}),
        }),
      )
      expect(event?.timeSlotKind).toBe(timeSlotKind)
    }
    expect(violationStore.events).toHaveLength(kinds.length)
  })

  it('自定义时间段保存文本；日期独立保存', () => {
    const { violationStore } = openStores(roster)
    const [event] = violationStore.addViolationsForStudents(
      ['s1'],
      batchDraft({ timeSlotKind: 'custom', customTimeText: '午休期间', date: '2026-10-30' }),
    )
    expect(event).toMatchObject({
      timeSlotKind: 'custom',
      customTimeText: '午休期间',
      date: '2026-10-30',
    })
  })
})

describe('编辑 / 删除 / 家长处理意见', () => {
  it('教师备注与家长处理意见分开保存，均允许为空', () => {
    const { violationStore } = openStores(roster)
    const [event] = violationStore.addViolationsForStudents(
      ['s1'],
      batchDraft({ teacherNote: '已提醒', parentNote: '家长已知悉' }),
    )
    expect(event).toMatchObject({ teacherNote: '已提醒', parentNote: '家长已知悉' })

    // 只填教师备注时，家长处理意见必须保持为空（不允许自动复制）
    const teacherOnly = violationStore.addViolationsForStudents(
      ['s1'],
      batchDraft({ teacherNote: '仅教师备注' }),
    )[0]
    expect(teacherOnly?.parentNote).toBeUndefined()

    const updated = violationStore.updateViolation(event!.id, { teacherNote: '再次提醒' })
    expect(updated).toMatchObject({ teacherNote: '再次提醒', parentNote: '家长已知悉' })

    // 家长意见清空后不再显示（UI 显示「暂未填写」而不是虚构内容）
    const cleared = violationStore.updateViolation(event!.id, { parentNote: '' })
    expect(cleared?.parentNote).toBeUndefined()
    expect(violationStore.events[0]?.parentNote).toBeUndefined()
  })

  it('编辑保留事件 ID；改学生关联时 studentId 与姓名快照一起变', () => {
    const { violationStore } = openStores(roster)
    const [event] = violationStore.addViolationsForStudents(['s1'], batchDraft())
    const updated = violationStore.updateViolation(event!.id, {
      studentId: 's2',
      severity: 'severe',
    })
    expect(updated?.id).toBe(event!.id)
    expect(updated?.studentId).toBe('s2')
    expect(updated?.studentName).toContain('安琪')
    expect(updated?.severity).toBe('severe')
    expect(violationStore.events).toHaveLength(1)
  })

  it('删除一条事件不影响其它事件', () => {
    const { violationStore } = openStores(roster)
    const created = violationStore.addViolationsForStudents(['s1', 's2'], batchDraft())
    expect(violationStore.removeViolation(created[0]!.id)).toBe(true)
    expect(violationStore.events).toHaveLength(1)
    expect(violationStore.events[0]?.studentId).toBe('s2')
  })
})

describe('概览 / 排行 / 经常违纪 / 严重事件 / 软删除学生', () => {
  function seedScenarios() {
    const stores = openStores(roster)
    const { violationStore } = stores
    // 白玛 3 次（含 1 次严重）；扎西 2 次；安琪 1 次；次仁 1 次
    violationStore.addViolationsForStudents(['s1'], batchDraft({ severity: 'minor' }))
    violationStore.addViolationsForStudents(['s1'], batchDraft({ severity: 'severe' }))
    violationStore.addViolationsForStudents(['s1'], batchDraft({ severity: 'moderate' }))
    violationStore.addViolationsForStudents(['s3'], batchDraft({ severity: 'moderate' }))
    violationStore.addViolationsForStudents(['s3'], batchDraft({ severity: 'minor' }))
    violationStore.addViolationsForStudents(['s2'], batchDraft({ behaviorLabel: '宿舍喧哗' }))
    violationStore.addViolationsForStudents(['s4'], batchDraft({ behaviorLabel: '卫生脏乱' }))
    return stores
  }

  it('统计数字与排行顺序', () => {
    const { violationStore } = seedScenarios()
    expect(violationStore.overview).toMatchObject({
      total: 7,
      studentCount: 4,
      severity: { minor: 4, moderate: 2, severe: 1 },
    })
    expect(violationStore.ranking.map((row) => row.studentId)).toEqual(['s1', 's3', 's2', 's4'])
    expect(violationStore.ranking[0]?.count).toBe(3)
  })

  it('经常违纪阈值：累计 ≥3，最多 10 名，排序一致', () => {
    const { violationStore } = seedScenarios()
    expect(violationStore.frequentStudents.map((row) => row.studentId)).toEqual(['s1'])
    expect(violationStore.frequentStudents.every((row) => row.count >= 3)).toBe(true)
    expect(violationStore.frequentStudents.length).toBeLessThanOrEqual(10)
  })

  it('严重事件有独立列表', () => {
    const { violationStore } = seedScenarios()
    expect(violationStore.severeEvents).toHaveLength(1)
    expect(violationStore.severeEvents.every((event) => event.severity === 'severe')).toBe(true)
  })

  it('软删除学生：不进入在读人数 / 排行 / 经常违纪，但历史仍可查', () => {
    const { violationStore, studentStore } = seedScenarios()
    studentStore.removeStudent('s1')

    expect(violationStore.overview.studentCount).toBe(3)
    expect(violationStore.ranking.some((row) => row.studentId === 's1')).toBe(false)
    expect(violationStore.frequentStudents.some((row) => row.studentId === 's1')).toBe(false)

    // 历史事件与个人档案仍可查看（个人档案页面按 studentId 查）
    expect(violationStore.eventsOfStudent('s1')).toHaveLength(3)
    expect(violationStore.statsOfStudent('s1')).toMatchObject({
      total: 3,
      severity: { minor: 1, moderate: 1, severe: 1 },
    })
    expect(violationStore.listEvents({ keyword: '白玛' })).toHaveLength(3)

    // 全部事件仍包含退档学生的历史，总数不因退档改变
    expect(violationStore.overview.total).toBe(7)
  })

  it('严重程度 / 关键字筛选与界面查询参数一致（取消分类筛选）', () => {
    const { violationStore } = seedScenarios()
    expect(
      violationStore.listEvents(toViolationQuery({ keyword: '', severity: 'severe' })),
    ).toHaveLength(1)
    expect(
      violationStore.listEvents(toViolationQuery({ keyword: '迟到', severity: 'all' })),
    ).toHaveLength(5)
    expect(
      violationStore.listEvents(toViolationQuery({ keyword: '不存在的人', severity: 'all' })),
    ).toHaveLength(0)
  })
})
