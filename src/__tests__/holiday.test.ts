/**
 * 假期管理的纯逻辑自检（v3.6.2）。
 *
 * 这里盯的都是「错了不会报错、只会给出一个看着正常的错结果」的那几类事：
 *
 * ① **虚拟周末的 id 由日期派生**。它不是库里的记录，两台设备各算各的必须得出同一个值，
 *    否则同一期在两端会变成两个假期，登记各记各的。
 * ② **二态由事实推导**：有离校记录 → 离校，**没有记录 → 留校**（v3.6.1 的第三态
 *    「未登记」已被 v3.6.2 删除，旧数据直接按「没有登记回家」算留校）。
 *    三张统计卡片的关系也钉在这里：离校 + 留校 = 全班，昌都市外离校 ≤ 离校。
 * ③ **批量只改选中的学生**。这是规格第 5 节的核心承诺，也是最容易在实现里悄悄破掉的一条：
 *    函数签名里根本没有「取全班」的入口，断言就照这一点写。
 * ④ **幂等**。已是目标状态的人不进任何一侧 —— 否则每点一次按钮就把两个键各推一次云，
 *    把跨端冲突面白白放大一轮。全班留校时「设为留校」必须是零写盘。
 * ⑤ 姓名比对的 locale 必须写在代码里（同 `weekend.test.ts` 的那条源码钉子）：
 *    不写时本机 `zh-CN` 走拼音、CI 的 Linux runner 落回 `en-US` 退化成码点序，本机绿、CI 红。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  HOLIDAY_STATUS_LABELS,
  buildHolidayEntries,
  buildStatusIndex,
  buildWeekendHoliday,
  countHomeInScope,
  countStatuses,
  describeHoliday,
  formatHolidayRange,
  holidayCoversDate,
  isWeekendHolidayId,
  normalizeHoliday,
  normalizeHolidayRecord,
  pickCurrentEntry,
  reviveHolidayRecords,
  reviveHolidays,
  sortHolidayRecords,
  sortHolidays,
  statusOf,
  weekendHolidayId,
  weekendKeyOfHolidayId,
} from '@/utils/holiday'
import {
  isEmptyPlan,
  planStatusChange,
  filterRoster,
  selectAllState,
  toggleSelectAll,
} from '@/utils/holidayQuery'
import type { Holiday, HolidayRecord } from '@/types/holiday'
import type { Student } from '@/types'

const SAT = '2026-09-19'
const SUN = '2026-09-20'
const WED = '2026-09-16'

/* ==================== 造数据的小工具 ==================== */

function holiday(partial: Partial<Holiday> = {}): Holiday {
  return {
    id: 'h1',
    name: '国庆',
    startDate: '2026-10-01',
    endDate: '2026-10-07',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  }
}

function record(partial: Partial<HolidayRecord> = {}): HolidayRecord {
  return {
    id: 'r1',
    holidayId: 'h1',
    studentId: 's1',
    studentName: '张三',
    date: '2026-10-01',
    returnHome: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...partial,
  }
}

function student(id: string, name: string, extra: Partial<Student> = {}): Student {
  return { id, name, studentNo: '', gender: 'female', ...extra }
}

/* ==================== 虚拟周末假期 ==================== */

describe('虚拟周末假期：身份由周六日期键派生，不落库', () => {
  it('id 是前缀 + 周六键，两台设备各算各的必然一致', () => {
    expect(weekendHolidayId(SAT)).toBe('weekend:2026-09-19')
    expect(isWeekendHolidayId('weekend:2026-09-19')).toBe(true)
    // 前缀像但不是（UUID 不含冒号，两者永远不会撞车）
    expect(isWeekendHolidayId('h1')).toBe(false)
    expect(isWeekendHolidayId(null)).toBe(false)
    expect(weekendKeyOfHolidayId('weekend:2026-09-19')).toBe(SAT)
  })

  it('**前缀对但日期坏**一律当作不认识——否则会冒出一个没有日期的假期', () => {
    expect(weekendKeyOfHolidayId('weekend:2026-09-20')).toBeUndefined() // 周日不是周末键
    expect(weekendKeyOfHolidayId('weekend:2026-02-31')).toBeUndefined() // 不存在的日期
    expect(weekendKeyOfHolidayId('weekend:')).toBeUndefined()
    expect(weekendKeyOfHolidayId('h1')).toBeUndefined()
  })

  it('虚拟假期是「周六 – 周日」两天，名字就是「周末」', () => {
    const built = buildWeekendHoliday(SAT)
    expect(built).toMatchObject({
      id: 'weekend:2026-09-19',
      name: '周末',
      startDate: SAT,
      endDate: SUN,
    })
  })
})

/* ==================== 复活 ==================== */

describe('假期的健壮化', () => {
  it('名字或任一日期缺失/非法 → 丢弃该条（不补臆造默认值）', () => {
    expect(normalizeHoliday(null)).toBeNull()
    expect(normalizeHoliday('x')).toBeNull()
    expect(normalizeHoliday({ startDate: '2026-10-01', endDate: '2026-10-07' })).toBeNull()
    expect(
      normalizeHoliday({ name: '   ', startDate: '2026-10-01', endDate: '2026-10-07' }),
    ).toBeNull()
    expect(normalizeHoliday({ name: '国庆', startDate: '2026-10-01' })).toBeNull()
    expect(
      normalizeHoliday({ name: '国庆', startDate: '2026-10-01', endDate: '2026-2-31' }),
    ).toBeNull()
  })

  it('起止填反 → **交换**而不是丢弃（那条假期仍是他想建的那个）', () => {
    const fixed = normalizeHoliday({ name: '国庆', startDate: '2026-10-07', endDate: '2026-10-01' })
    expect(fixed).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-07' })
  })

  it('**不要求周六**：任意日期都是合法的假期（这正是与老键最大的区别）', () => {
    const midweek = normalizeHoliday({ name: '州庆', startDate: WED, endDate: WED })
    expect(midweek).toMatchObject({ name: '州庆', startDate: WED, endDate: WED })
  })

  it('空备注不写这个字段（与「有备注」在展示与云端比对里是两回事）', () => {
    expect(normalizeHoliday({ name: '国庆', startDate: WED, endDate: WED })).not.toHaveProperty(
      'note',
    )
    expect(
      normalizeHoliday({ name: '国庆', startDate: WED, endDate: WED, note: '   ' }),
    ).not.toHaveProperty('note')
    expect(
      normalizeHoliday({ name: '国庆', startDate: WED, endDate: WED, note: ' 带作业 ' }),
    ).toMatchObject({
      note: '带作业',
    })
  })

  it('按 id 去重，只留首条', () => {
    const revived = reviveHolidays([
      { id: 'h1', name: '国庆', startDate: '2026-10-01', endDate: '2026-10-07' },
      { id: 'h1', name: '国庆（重复）', startDate: '2026-10-01', endDate: '2026-10-07' },
      { id: 'h2', name: '州庆', startDate: WED, endDate: WED },
    ])
    expect(revived.map((item) => item.name)).toEqual(['国庆', '州庆'])
  })
})

describe('假期登记的健壮化', () => {
  it('`returnHome` 缺失或非布尔 → **丢弃该条**（补 false 会把坏数据变成「留校」这个事实）', () => {
    const base = { holidayId: 'h1', studentId: 's1', date: '2026-10-01' }
    expect(normalizeHolidayRecord(base)).toBeNull()
    expect(normalizeHolidayRecord({ ...base, returnHome: 'true' })).toBeNull()
    expect(normalizeHolidayRecord({ ...base, returnHome: 1 })).toBeNull()
    expect(normalizeHolidayRecord({ ...base, returnHome: false })).toMatchObject({
      returnHome: false,
    })
  })

  it('假期 id / 学生 id / 代表日缺一即丢失意义 → 丢弃', () => {
    expect(
      normalizeHolidayRecord({ studentId: 's1', date: '2026-10-01', returnHome: true }),
    ).toBeNull()
    expect(
      normalizeHolidayRecord({ holidayId: 'h1', date: '2026-10-01', returnHome: true }),
    ).toBeNull()
    expect(
      normalizeHolidayRecord({ holidayId: 'h1', studentId: 's1', returnHome: true }),
    ).toBeNull()
    expect(
      normalizeHolidayRecord({
        holidayId: 'h1',
        studentId: 's1',
        date: '2026-2-31',
        returnHome: true,
      }),
    ).toBeNull()
  })

  it('**不校验 holidayId 的日期部分**：假期可能还没同步到本机，那不是这条记录的问题', () => {
    const ok = normalizeHolidayRecord({
      holidayId: 'weekend:2099-01-03',
      studentId: 's1',
      date: '2099-01-03',
      returnHome: false,
    })
    expect(ok).toMatchObject({ holidayId: 'weekend:2099-01-03', returnHome: false })
  })

  it('两重去重：同一 id；同一「学生 + 假期」——后者是本模块二态的前提', () => {
    const revived = reviveHolidayRecords([
      record({ id: 'r1', studentId: 's1', returnHome: true }),
      record({ id: 'r1', studentId: 's2' }),
      record({ id: 'r2', studentId: 's1', returnHome: false }),
      record({ id: 'r3', studentId: 's3', returnHome: true }),
    ])
    expect(revived.map((item) => item.id)).toEqual(['r1', 'r3'])
    expect(revived[0]).toMatchObject({ studentId: 's1', returnHome: true })
  })

  it('**学生级备注（v3.6.2）**：trim 后保留；空 / 非字符串一律不写这个字段', () => {
    const base = { holidayId: 'h1', studentId: 's1', date: '2026-10-01', returnHome: true }
    expect(normalizeHolidayRecord({ ...base, note: ' 由姐姐接回 ' })).toMatchObject({
      note: '由姐姐接回',
    })
    expect(normalizeHolidayRecord({ ...base, note: '   ' })).not.toHaveProperty('note')
    expect(normalizeHolidayRecord({ ...base, note: 42 })).not.toHaveProperty('note')
    expect(normalizeHolidayRecord(base)).not.toHaveProperty('note')
  })
})

/* ==================== 排序 ==================== */

describe('排序确定性（刷新不变、跨机器一致）', () => {
  it('假期：正在放的 → 还没到的（近的在前）→ 已过去的（近的在前）', () => {
    const sorted = sortHolidays(
      [
        holiday({ id: 'done', startDate: '2026-08-01', endDate: '2026-08-03' }),
        holiday({ id: 'later', startDate: '2026-10-01', endDate: '2026-10-07' }),
        holiday({ id: 'soon', startDate: '2026-09-25', endDate: '2026-09-26' }),
        holiday({ id: 'now', startDate: '2026-09-15', endDate: '2026-09-20' }),
        holiday({ id: 'recent', startDate: '2026-09-10', endDate: '2026-09-12' }),
      ],
      WED,
    )
    expect(sorted.map((item) => item.id)).toEqual(['now', 'soon', 'later', 'recent', 'done'])
  })

  it('同一档内起始日相同时按建立时间倒序，末位用 id 兜底', () => {
    const sorted = sortHolidays(
      [
        holiday({
          id: 'a',
          startDate: '2026-10-01',
          endDate: '2026-10-07',
          createdAt: '2026-09-01T00:00:00.000Z',
        }),
        holiday({
          id: 'c',
          startDate: '2026-10-01',
          endDate: '2026-10-07',
          createdAt: '2026-09-02T00:00:00.000Z',
        }),
        holiday({
          id: 'b',
          startDate: '2026-10-01',
          endDate: '2026-10-07',
          createdAt: '2026-09-02T00:00:00.000Z',
        }),
      ],
      WED,
    )
    // 建立时间晚的在前（c 与 b 同为 09-02），同一时间用 id 升序兜底
    expect(sorted.map((item) => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('登记：日期倒序 → 姓名拼音升序 → 登记时间 → id', () => {
    const sorted = sortHolidayRecords([
      record({ id: 'a', studentName: '李四', date: '2026-09-19' }),
      record({ id: 'b', studentName: '张三', date: '2026-10-01' }),
      record({ id: 'c', studentName: '王五', date: '2026-10-01' }),
    ])
    // 10/01 那两条在前，其中「王五」按拼音（wáng < zhāng）在「张三」前面
    expect(sorted.map((item) => item.id)).toEqual(['c', 'b', 'a'])
  })

  /**
   * 同 `weekend.test.ts` 的那条源码钉子：本机默认 locale 是 zh-CN（走拼音）永远绿，
   * 而 CI 的 Linux runner `LANG` 未设会退化成码点序。名字比对的 locale 必须写在代码里。
   */
  it('姓名比对写明拼音 locale（不写 = 排序跟着测机默认 locale 变）', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../utils/holiday.ts', import.meta.url)),
      'utf8',
    )
    expect(source).toContain("studentName.localeCompare(b.studentName, 'zh-Hans-CN')")
  })
})

/* ==================== 二态 ==================== */

describe('二态：离校 / 留校（v3.6.2 删掉第三态「未登记」）', () => {
  const index = buildStatusIndex([
    record({ id: 'r1', studentId: 's1', returnHome: true }),
    record({ id: 'r2', studentId: 's2', returnHome: false }),
  ])

  it('**没有记录就是留校**——旧「未登记」的数据升级后直接算留校，不迁移、不弹确认', () => {
    expect(statusOf('h1', 's1', index)).toBe('home')
    expect(statusOf('h1', 's2', index)).toBe('stay')
    expect(statusOf('h1', 's3', index)).toBe('stay')
  })

  it('离校优先：老键里有记录就是离校，哪怕新键还留着一条同期的留校影子', () => {
    // 影子只被**遮蔽**（派生层忽略），不在这里顺手清掉——教师没点按钮，数据就不该动
    expect(statusOf('h1', 's1', index, new Set(['s1']))).toBe('home')
  })

  it('老键的旁路只在周末生效：自定义假期传进来也不该被它改写', () => {
    // 调用方（store）只在周末把老键的集合递进来；这条断言守的是「递进来也改变不了结果」的语义——
    // s2 在新键里是留校，老键里没有他，仍是留校
    expect(statusOf('h1', 's2', index, new Set(['s1']))).toBe('stay')
  })

  it('两数之和恒等于分母（谁都不许漏、不许重）', () => {
    const counts = countStatuses('h1', ['s1', 's2', 's3', 's4'], index)
    expect(counts).toEqual({ home: 1, stay: 3 })
    expect(counts.home + counts.stay).toBe(4)
  })

  it('标签只有这两个词，且 home 的文案是「离校」（导出名单与页面徽标同源）', () => {
    expect(HOLIDAY_STATUS_LABELS).toEqual({ home: '离校', stay: '留校' })
  })
})

/* ==================== 昌都市外离校（第三张卡片） ==================== */

describe('countHomeInScope：离校 ∩ 昌都市外', () => {
  const students = [
    student('s1', '甲', {
      familyLocation: { prefecture: '拉萨市', county: '城关区', scope: 'outside-changdu' },
    }),
    student('s2', '乙', {
      familyLocation: { prefecture: '拉萨市', county: '堆龙德庆区', scope: 'outside-changdu' },
    }),
    student('s3', '丙', {
      familyLocation: { prefecture: '昌都市', county: '卡若区', scope: 'changdu-city' },
    }),
    student('s4', '丁'), // 家庭所在地没填
  ]
  const index = buildStatusIndex([
    record({ id: 'r1', studentId: 's1', returnHome: true }), // 市外 + 离校 ✔
    record({ id: 'r2', studentId: 's2', returnHome: false }), // 市外但留校 ✘
    record({ id: 'r3', studentId: 's3', returnHome: true }), // 离校但市区 ✘
  ])

  it('只数「离校 且 市外」——留校的市外学生与没填所在地的都不算', () => {
    expect(countHomeInScope('h1', students, index, 'outside-changdu')).toBe(1)
  })

  it('**它不是第三种状态**：恒 ≤ 离校人数，且留校 + 离校 = 全班', () => {
    const counts = countStatuses(
      'h1',
      students.map((item) => item.id),
      index,
    )
    const outside = countHomeInScope('h1', students, index, 'outside-changdu')
    expect(outside).toBeLessThanOrEqual(counts.home)
    expect(counts.home + counts.stay).toBe(students.length)
  })

  it('周末也走同一个出口：老键里的离校记录算数', () => {
    // s2 在老键里有这一期的离校记录 → 他变成「市外离校」，数字从 1 变 2
    expect(countHomeInScope('h1', students, index, 'outside-changdu', new Set(['s2']))).toBe(2)
  })

  it('没有市外学生时是 0（页面据此显示空状态），不是 NaN / undefined', () => {
    expect(countHomeInScope('h1', students.slice(2), index, 'outside-changdu')).toBe(0)
  })
})

/* ==================== 列表与当前项 ==================== */

describe('列表与默认项', () => {
  it('自定义假期 ∪ 给定的周末；还没到的按日期升序（近的在前）', () => {
    const entries = buildHolidayEntries(
      [holiday({ id: 'h1', startDate: '2026-10-01', endDate: '2026-10-07' })],
      [SAT, '2026-09-26'],
      WED,
    )
    expect(entries.map((entry) => entry.holiday.id)).toEqual([
      'weekend:2026-09-19',
      'weekend:2026-09-26',
      'h1',
    ])
    expect(entries[1]).toMatchObject({ kind: 'weekend', weekendKey: '2026-09-26' })
  })

  /**
   * 这条钉的是一个**看起来对、其实错**的排序：本周末与下周末是恒定存在的虚拟项，
   * 日期总在未来，所以「起始日一律倒序」会把还没到的周末排在**正在放着的假期**上面——
   * 教师正过着国庆，国庆却不在列表首位。
   */
  it('正在放的假期排在还没到的周末之上（相关优先于日期）', () => {
    const today = '2026-10-03' // 国庆假期中间
    const entries = buildHolidayEntries(
      [holiday({ id: 'national', startDate: '2026-10-01', endDate: '2026-10-07' })],
      ['2026-09-19', '2026-10-10'],
      today,
    )
    expect(entries.map((entry) => entry.holiday.id)).toEqual([
      'national', // 正在放
      'weekend:2026-10-10', // 还没到
      'weekend:2026-09-19', // 已经过去
    ])
  })

  it('pickCurrentEntry：今天落在自定义假期里就看它（重叠时取起始日最晚的那个）', () => {
    const entries = buildHolidayEntries(
      [
        holiday({ id: 'long', startDate: '2026-09-01', endDate: '2026-10-31' }),
        holiday({ id: 'short', startDate: '2026-09-15', endDate: '2026-09-20' }),
      ],
      [SAT, '2026-09-26'],
      WED,
    )
    expect(pickCurrentEntry(entries, WED)?.holiday.id).toBe('short')
  })

  it('pickCurrentEntry：不在任何假期里 → 本周末', () => {
    const entries = buildHolidayEntries([holiday({ id: 'h1' })], [SAT, '2026-09-26'], WED)
    expect(pickCurrentEntry(entries, WED)?.weekendKey).toBe(SAT)
    // 站在周一（9/21）看，本周末是即将到来的 9/26
    expect(pickCurrentEntry(entries, '2026-09-21')?.weekendKey).toBe('2026-09-26')
  })

  it('假期区间含首尾；单日假期与跨天假期的文案不同', () => {
    const single = holiday({ startDate: WED, endDate: WED })
    const span = holiday({ startDate: '2026-10-01', endDate: '2026-10-07' })
    expect(holidayCoversDate(span, '2026-10-01')).toBe(true)
    expect(holidayCoversDate(span, '2026-10-07')).toBe(true)
    expect(holidayCoversDate(span, '2026-10-08')).toBe(false)
    expect(formatHolidayRange(single)).toBe('9月16日')
    expect(formatHolidayRange(span)).toBe('10月1日 – 10月7日')
  })

  it('相对今天的说法（天数按整日算，不受时分秒与时区影响）', () => {
    const span = holiday({ startDate: '2026-10-01', endDate: '2026-10-07' })
    expect(describeHoliday(span, '2026-09-30')).toBe('还有 1 天')
    expect(describeHoliday(span, '2026-10-01')).toBe('进行中')
    expect(describeHoliday(span, '2026-10-07')).toBe('进行中')
    expect(describeHoliday(span, '2026-10-08')).toBe('已结束 1 天')
  })
})

/* ==================== 批量计划 ==================== */

describe('planStatusChange：只改传进来的学生（规格第 5 节的核心承诺）', () => {
  it('**函数里根本没有「取全班」的入口**：给 5 个人就只动这 5 个', () => {
    const inputs = Array.from({ length: 5 }, (_, i) => ({
      studentId: `picked${i}`,
      status: 'stay' as const,
    }))
    const plan = planStatusChange(inputs, 'home', { isWeekend: false })
    expect(plan.create.map((item) => item.studentId)).toEqual([
      'picked0',
      'picked1',
      'picked2',
      'picked3',
      'picked4',
    ])
    expect(plan.remove).toEqual([])
  })

  it('幂等：已是目标状态的人不进任何一侧（零写盘、零广播）', () => {
    const plan = planStatusChange(
      [
        { studentId: 's1', status: 'home' },
        { studentId: 's2', status: 'home' },
      ],
      'home',
      { isWeekend: false },
    )
    expect(isEmptyPlan(plan)).toBe(true)
    expect(plan.fromCounts).toEqual({ home: 0, stay: 0 })
  })

  it('**62 人全班留校时「设为留校」是零写盘**：没有记录就是留校，不凭空造 62 条记录', () => {
    const inputs = Array.from({ length: 62 }, (_, index) => ({
      studentId: `s${index + 1}`,
      status: 'stay' as const,
    }))
    const plan = planStatusChange(inputs, 'stay', { isWeekend: false })
    expect(isEmptyPlan(plan)).toBe(true)
  })

  it('**周末的离校走老键**（addWeekend），周末的留校与自定义假期的两种去向都进新键', () => {
    const weekendPlan = planStatusChange([{ studentId: 's1', status: 'stay' }], 'home', {
      isWeekend: true,
    })
    expect(weekendPlan.addWeekend).toEqual(['s1'])
    // 没有备注就不建新键记录：周末的离校事实本来就住在老键里
    expect(weekendPlan.create).toEqual([])

    const weekendStay = planStatusChange(
      [{ studentId: 's1', status: 'home', weekendRecordId: 'w1' }],
      'stay',
      { isWeekend: true },
    )
    expect(weekendStay.addWeekend).toEqual([])
    // 留校不需要记录：只把老键那条离校删掉
    expect(weekendStay.create).toEqual([])

    // 自定义假期的「离校」也进新键：老键装的是「周末」，一个任意日期塞不进去
    const customHome = planStatusChange([{ studentId: 's1', status: 'stay' }], 'home', {
      isWeekend: false,
    })
    expect(customHome.addWeekend).toEqual([])
    expect(customHome.create).toEqual([{ studentId: 's1', returnHome: true }])
  })

  it('改向时**先删干净再建**：离校→留校删老键那条，留校→离校删新键那条', () => {
    const homeToStay = planStatusChange(
      [{ studentId: 's1', status: 'home', weekendRecordId: 'w1' }],
      'stay',
      { isWeekend: true },
    )
    expect(homeToStay.remove).toEqual([{ recordId: 'w1', source: 'weekend' }])
    expect(homeToStay.create).toEqual([])

    const stayToHome = planStatusChange(
      [{ studentId: 's1', status: 'stay', holidayRecordId: 'n1' }],
      'home',
      { isWeekend: true },
    )
    expect(stayToHome.remove).toEqual([{ recordId: 'n1', source: 'holiday' }])
    expect(stayToHome.addWeekend).toEqual(['s1'])

    // 自定义假期的离校→留校：删掉离校那条事实记录就完事，**不建「留校记录」**
    const customFlip = planStatusChange(
      [{ studentId: 's1', status: 'home', holidayRecordId: 'n1' }],
      'stay',
      { isWeekend: false },
    )
    expect(customFlip.remove).toEqual([{ recordId: 'n1', source: 'holiday' }])
    expect(customFlip.create).toEqual([])
    expect(isEmptyPlan(customFlip)).toBe(false)
  })

  it('**「留校」不写记录**：自定义假期也一样——删掉离校事实，状态靠「没有记录」推导', () => {
    const plan = planStatusChange(
      [{ studentId: 's1', status: 'home', holidayRecordId: 'n1' }],
      'stay',
      { isWeekend: false },
    )
    expect(plan.create).toEqual([])
    expect(plan.addWeekend).toEqual([])
    expect(plan.remove).toEqual([{ recordId: 'n1', source: 'holiday' }])

    // 周末同理：离校事实在老键，撤掉它，新键也不补一条留校
    const weekend = planStatusChange(
      [{ studentId: 's1', status: 'home', weekendRecordId: 'w1' }],
      'stay',
      { isWeekend: true },
    )
    expect(weekend.create).toEqual([])
    expect(weekend.addWeekend).toEqual([])
    expect(weekend.remove).toEqual([{ recordId: 'w1', source: 'weekend' }])
  })

  it('**学生级备注跟着人走**：改向不会把教师写的备注丢掉', () => {
    const custom = planStatusChange(
      [{ studentId: 's1', status: 'home', holidayRecordId: 'n1', note: ' 由姐姐接回 ' }],
      'stay',
      { isWeekend: false },
    )
    // 留校 + 备注 → 落一条只为装备注的记录（returnHome: false，不参与状态推导）
    expect(custom.create).toEqual([{ studentId: 's1', returnHome: false, note: '由姐姐接回' }])

    // 周末的离校事实在老键；备注落到新键那条影子上（returnHome 保持 false：它不参与状态推导）
    const weekend = planStatusChange(
      [{ studentId: 's1', status: 'stay', holidayRecordId: 'n1', note: '家长到校接送' }],
      'home',
      { isWeekend: true },
    )
    expect(weekend.addWeekend).toEqual(['s1'])
    expect(weekend.create).toEqual([{ studentId: 's1', returnHome: false, note: '家长到校接送' }])
  })

  it('fromCounts 说的是「原来各是什么状态」——确认文案「其中 3 人原为离校」照它写', () => {
    const plan = planStatusChange(
      [
        { studentId: 's1', status: 'home', weekendRecordId: 'w1' },
        { studentId: 's2', status: 'home', weekendRecordId: 'w2' },
        { studentId: 's3', status: 'stay' },
        { studentId: 's4', status: 'stay', holidayRecordId: 'n4' },
      ],
      'stay',
      { isWeekend: true },
    )
    expect(plan.fromCounts).toEqual({ home: 2, stay: 0 })
  })
})

/* ==================== 全选三态（规格第 10–13 节） ==================== */

describe('全选：三态 + 只作用于当前筛选结果', () => {
  const visible = ['a', 'b', 'c', 'd', 'e', 'f']

  it('未选 / 部分选中 / 全部选中', () => {
    expect(selectAllState(visible, new Set())).toBe('none')
    expect(selectAllState(visible, new Set(['a', 'c']))).toBe('partial')
    expect(selectAllState(visible, new Set(visible))).toBe('all')
    // 当前筛选结果为空（筛没了）时是「未选」，不是一个假的「全选」
    expect(selectAllState([], new Set(['a']))).toBe('none')
  })

  it('**选中但不在当前筛选结果里的，不算数**：三态只看眼前这份名单', () => {
    // 全班 6 人里选了 3 人，眼前这份名单只有 d/e/f —— 一个都没选中
    const selected = new Set(['a', 'b', 'c'])
    expect(selectAllState(['d', 'e', 'f'], selected)).toBe('none')
    // 眼前这份里选了一半就是 partial
    expect(selectAllState(['c', 'd', 'e'], selected)).toBe('partial')
  })

  it('点全选 = 把**当前筛选结果**并进选中，不动看不见的那些', () => {
    const selected = new Set(['a'])
    const next = toggleSelectAll(['d', 'e'], selected)
    expect([...next].sort()).toEqual(['a', 'd', 'e'])
    // 入参没有被改（纯函数）
    expect([...selected]).toEqual(['a'])
  })

  it('再点一次 = 只把眼前这份名单移出选中，其他批次原样保留', () => {
    const selected = new Set(['a', 'd', 'e'])
    const next = toggleSelectAll(['d', 'e'], selected)
    expect([...next]).toEqual(['a'])
    expect(selectAllState(['d', 'e'], next)).toBe('none')
  })

  /**
   * 规格第 13 节的现场：全班 62 人 → 离校 45 / 留校 17 / 昌都市外离校 12。
   * 在「昌都市外离校」里全选 12 人，再切到「留校」——那 17 人必须**一个都没被继承为选中**，
   * 而原来那 12 人的选择数据也不能被切换筛选这件事改掉。
   */
  it('筛「昌都市外离校」全选 12 人 → 切到「留校」：三态回到未选，选中数据仍是那 12 人', () => {
    const outside = Array.from({ length: 12 }, (_, i) => `out${i}`)
    const stay = Array.from({ length: 17 }, (_, i) => `stay${i}`)

    // 1) 昌都市外离校：点全选
    let selected = toggleSelectAll(outside, new Set())
    expect(selected.size).toBe(12)
    expect(selectAllState(outside, selected)).toBe('all')

    // 2) 切到留校：一个都没选中（**不继承「全选当前筛选」的视觉状态**）
    expect(selectAllState(stay, selected)).toBe('none')

    // 3) 选中数据没有被切换筛选改掉
    expect(selected.size).toBe(12)
    expect([...selected]).toEqual(outside)

    // 4) 在留校里点全选：17 人与原来那 12 人同时选中（跨筛选保留）
    selected = toggleSelectAll(stay, selected)
    expect(selected.size).toBe(29)
    expect(selectAllState(stay, selected)).toBe('all')
    expect(selectAllState(outside, selected)).toBe('all')
  })
})

/* ==================== 筛选 ==================== */

describe('filterRoster：五组条件全部 AND 组合', () => {
  const students = [
    student('s1', '张三', {
      gender: 'male',
      studentNo: '01',
      familyLocation: { prefecture: '昌都市', county: '卡若区', scope: 'changdu-city' },
      hasChangduRelative: true,
    }),
    student('s2', '李四', {
      gender: 'female',
      studentNo: '02',
      familyLocation: { prefecture: '昌都市', county: '江达县', scope: 'changdu-county' },
      hasChangduRelative: false,
    }),
    student('s3', '王五', {
      gender: 'male',
      studentNo: '03',
      familyLocation: { prefecture: '拉萨市', county: '城关区', scope: 'outside-changdu' },
    }),
  ]
  const statusMap: Record<string, 'home' | 'stay'> = {
    s1: 'home',
    s2: 'stay',
    s3: 'home',
  }
  const statusOf = (id: string) => statusMap[id] ?? 'stay'
  const notes = new Map([['s3', '由姐姐接回']])
  const noteOf = (id: string) => notes.get(id) ?? ''

  it('不给条件就是全班（学号升序），行上带着去向与备注', () => {
    const rows = filterRoster(students, { keyword: '' }, statusOf, noteOf)
    expect(rows.map((row) => row.student.id)).toEqual(['s1', 's2', 's3'])
    expect(rows.map((row) => row.status)).toEqual(['home', 'stay', 'home'])
    expect(rows.map((row) => row.note)).toEqual(['', '', '由姐姐接回'])
  })

  it('四组条件逐条生效，且叠加时是 AND（不是 OR）', () => {
    expect(
      filterRoster(students, { keyword: '', gender: 'male' }, statusOf).map((r) => r.student.id),
    ).toEqual(['s1', 's3'])
    expect(
      filterRoster(students, { keyword: '', scope: 'changdu-city' }, statusOf).map(
        (r) => r.student.id,
      ),
    ).toEqual(['s1'])
    expect(
      filterRoster(students, { keyword: '', relative: true }, statusOf).map((r) => r.student.id),
    ).toEqual(['s1'])
    // relative: false 只命中「明确没有」，未填的 s3 不算「无」
    expect(
      filterRoster(students, { keyword: '', relative: false }, statusOf).map((r) => r.student.id),
    ).toEqual(['s2'])

    // AND：男性 且 昌都市区 且 有亲属 且 卡片「离校」—— 只有 s1 同时满足
    expect(
      filterRoster(
        students,
        { keyword: '', gender: 'male', scope: 'changdu-city', relative: true, card: 'home' },
        statusOf,
      ).map((r) => r.student.id),
    ).toEqual(['s1'])
    // 换成 female 就一个都不剩（AND 不是 OR）
    expect(
      filterRoster(students, { keyword: '', gender: 'female', card: 'home' }, statusOf),
    ).toEqual([])
  })

  it('卡片筛选三档：离校 / 留校 / 昌都市外离校', () => {
    expect(
      filterRoster(students, { keyword: '', card: 'home' }, statusOf).map((r) => r.student.id),
    ).toEqual(['s1', 's3'])
    expect(
      filterRoster(students, { keyword: '', card: 'stay' }, statusOf).map((r) => r.student.id),
    ).toEqual(['s2'])
    expect(
      filterRoster(students, { keyword: '', card: 'outside' }, statusOf).map((r) => r.student.id),
    ).toEqual(['s3'])
  })

  it('**卡片是筛选不是状态**：`undefined` 就是全部，且离校 + 留校 = 全班', () => {
    const all = filterRoster(students, { keyword: '' }, statusOf)
    const home = filterRoster(students, { keyword: '', card: 'home' }, statusOf)
    const stay = filterRoster(students, { keyword: '', card: 'stay' }, statusOf)
    const outside = filterRoster(students, { keyword: '', card: 'outside' }, statusOf)
    expect(all).toHaveLength(students.length)
    expect(home.length + stay.length).toBe(all.length)
    expect(outside.length).toBeLessThanOrEqual(home.length)
  })

  it('姓名搜索走全应用同一份口径（`queryStudents`），搜学号也找得到', () => {
    expect(filterRoster(students, { keyword: '李四' }, statusOf).map((r) => r.student.id)).toEqual([
      's2',
    ])
    expect(filterRoster(students, { keyword: '03' }, statusOf).map((r) => r.student.id)).toEqual([
      's3',
    ])
  })
})

/* ==================== 源码哨兵（v3.6.2） ==================== */

/**
 * 三条靠人守的纪律，钉在**源码文本**上——它们错了都不会让任何一条行为断言变红：
 *
 * ① **「未登记」这个状态被彻底删掉**（规格第 5 节）。行为测试只能证明「今天算出来是两态」，
 *    挡不住以后有人图省事把 `unregistered` 加回类型里、或把「未登记」写成一句界面文案。
 * ② **部分选中必须用原生 `input.indeterminate` 属性**。它是 DOM **属性**不是 attribute：
 *    写成模板里的 `:indeterminate="..."` 会静默失效（Vue 会当成普通属性设上，
 *    但浏览器读的是 property），界面上「部分选中」就永远不显示——**没有任何报错**。
 * ③ 「编辑 / 删除」必须排在名单之前的那一段结构里（规格第 14 节）：62 人的名单会把它们推到
 *    页面底部，这正是本版要修的那件事。
 */
describe('源码哨兵（v3.6.2）', () => {
  const root = fileURLToPath(new URL('../', import.meta.url))

  function holidaySources(): { name: string; source: string }[] {
    const files = [
      'types/holiday.ts',
      'stores/holiday.ts',
      'utils/holiday.ts',
      'utils/holidayQuery.ts',
      'utils/holidayExport.ts',
      'views/Holiday/index.vue',
      ...readdirSync(fileURLToPath(new URL('../views/Holiday/components', import.meta.url)))
        .filter((name) => name.endsWith('.vue'))
        .map((name) => `views/Holiday/components/${name}`),
    ]
    return files.map((name) => ({ name, source: readFileSync(`${root}${name}`, 'utf8') }))
  }

  it('假期管理代码里不许再出现 `unregistered`（类型 / Store / 筛选 / 统计 / 导出一起扫）', () => {
    for (const { name, source } of holidaySources()) {
      expect(source, `${name} 里还有 unregistered`).not.toContain('unregistered')
    }
  })

  it('不许把「未登记」写成界面文案或取值（带引号的那种；注释里说明「已删除」不算）', () => {
    for (const { name, source } of holidaySources()) {
      expect(source, `${name} 里还有「未登记」文案`).not.toContain("'未登记'")
      expect(source, `${name} 里还有「未登记」文案`).not.toContain('"未登记"')
      expect(source, `${name} 里还有「未登记」文案`).not.toContain('>未登记<')
    }
  })

  it('部分选中用原生 `input.indeterminate` 属性，不是模板上的 `:indeterminate`', () => {
    const source = readFileSync(
      fileURLToPath(
        new URL('../views/Holiday/components/HolidaySelectAllBar.vue', import.meta.url),
      ),
      'utf8',
    )
    expect(source).toContain('.indeterminate = ')
    expect(source).not.toContain(':indeterminate')
  })

  it('「编辑 / 删除」在学生名单**之前**（结构哨兵：名单再长也推不下去）', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../views/Holiday/components/HolidayDetail.vue', import.meta.url)),
      'utf8',
    )
    const actionRow = source.indexOf('class="action-row"')
    const statCards = source.indexOf('<HolidayStatCards')
    const roster = source.indexOf('<HolidayRosterList')
    expect(actionRow).toBeGreaterThan(-1)
    expect(statCards).toBeGreaterThan(-1)
    expect(roster).toBeGreaterThan(-1)
    expect(actionRow).toBeLessThan(statCards)
    expect(statCards).toBeLessThan(roster)
  })
})
