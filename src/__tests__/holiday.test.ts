/**
 * 假期管理的纯逻辑自检（v3.6.1）。
 *
 * 这里盯的都是「错了不会报错、只会给出一个看着正常的错结果」的那几类事：
 *
 * ① **虚拟周末的 id 由日期派生**。它不是库里的记录，两台设备各算各的必须得出同一个值，
 *    否则同一期在两端会变成两个假期，登记各记各的。
 * ② **「回家优先」与「未登记 ≠ 留校」**。v3.6.1 废掉了「留校 = 在读 − 已回家」那条补集口径，
 *    它把「还没问」也算成「留校」。这里把新口径钉死：**没有任何记录才是未登记**。
 * ③ **批量只改选中的学生**。这是规格第 5 节的核心承诺，也是最容易在实现里悄悄破掉的一条：
 *    函数签名里根本没有「取全班」的入口，断言就照这一点写。
 * ④ **幂等**。已是目标状态的人不进任何一侧 —— 否则每点一次按钮就把两个键各推一次云，
 *    把跨端冲突面白白放大一轮。
 * ⑤ 姓名比对的 locale 必须写在代码里（同 `weekend.test.ts` 的那条源码钉子）：
 *    不写时本机 `zh-CN` 走拼音、CI 的 Linux runner 落回 `en-US` 退化成码点序，本机绿、CI 红。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  HOLIDAY_STATUS_LABELS,
  buildHolidayEntries,
  buildStatusIndex,
  buildWeekendHoliday,
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
import { isEmptyPlan, planStatusChange, filterRoster } from '@/utils/holidayQuery'
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

  it('两重去重：同一 id；同一「学生 + 假期」——后者是本模块三态的前提', () => {
    const revived = reviveHolidayRecords([
      record({ id: 'r1', studentId: 's1', returnHome: true }),
      record({ id: 'r1', studentId: 's2' }),
      record({ id: 'r2', studentId: 's1', returnHome: false }),
      record({ id: 'r3', studentId: 's3', returnHome: true }),
    ])
    expect(revived.map((item) => item.id)).toEqual(['r1', 'r3'])
    expect(revived[0]).toMatchObject({ studentId: 's1', returnHome: true })
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

/* ==================== 三态 ==================== */

describe('三态：回家 / 留校 / 未登记（v3.6.1 废掉补集口径）', () => {
  const index = buildStatusIndex([
    record({ id: 'r1', studentId: 's1', returnHome: true }),
    record({ id: 'r2', studentId: 's2', returnHome: false }),
  ])

  it('**没有记录才是未登记**——不再拿「在读人数 − 已回家」当留校', () => {
    expect(statusOf('h1', 's1', index)).toBe('home')
    expect(statusOf('h1', 's2', index)).toBe('stay')
    expect(statusOf('h1', 's3', index)).toBe('unregistered')
  })

  it('回家优先：老键里有记录就是回家，哪怕新键还留着一条同期的留校影子', () => {
    // 影子只被**遮蔽**（派生层忽略），不在这里顺手清掉——教师没点按钮，数据就不该动
    expect(statusOf('h1', 's1', index, new Set(['s1']))).toBe('home')
  })

  it('老键的旁路只在周末生效：自定义假期传进来也不该被它改写', () => {
    // 调用方（store）只在周末把老键的集合递进来；这条断言守的是「递进来也改变不了结果」的语义——
    // s2 在新键里是留校，老键里没有他，仍是留校
    expect(statusOf('h1', 's2', index, new Set(['s1']))).toBe('stay')
  })

  it('三数之和恒等于分母（谁都不许漏、不许重）', () => {
    const counts = countStatuses('h1', ['s1', 's2', 's3', 's4'], index)
    expect(counts).toEqual({ home: 1, stay: 1, unregistered: 2 })
    expect(counts.home + counts.stay + counts.unregistered).toBe(4)
  })

  it('三态标签只有这三个词（导出名单的「假期去向」列与页面徽标同源）', () => {
    expect(HOLIDAY_STATUS_LABELS).toEqual({ home: '回家', stay: '留校', unregistered: '未登记' })
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
      status: 'unregistered' as const,
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
    expect(plan.fromCounts).toEqual({ home: 0, stay: 0, unregistered: 0 })
  })

  it('**周末的回家走老键**（addWeekend），周末的留校与自定义假期的两种去向都进新键', () => {
    const weekendPlan = planStatusChange([{ studentId: 's1', status: 'unregistered' }], 'home', {
      isWeekend: true,
    })
    expect(weekendPlan.addWeekend).toEqual(['s1'])
    expect(weekendPlan.create).toEqual([])

    const weekendStay = planStatusChange([{ studentId: 's1', status: 'unregistered' }], 'stay', {
      isWeekend: true,
    })
    expect(weekendStay.addWeekend).toEqual([])
    expect(weekendStay.create).toEqual([{ studentId: 's1', returnHome: false }])

    // 自定义假期的「回家」也进新键：老键装的是「周末」，一个任意日期塞不进去
    const customHome = planStatusChange([{ studentId: 's1', status: 'unregistered' }], 'home', {
      isWeekend: false,
    })
    expect(customHome.addWeekend).toEqual([])
    expect(customHome.create).toEqual([{ studentId: 's1', returnHome: true }])
  })

  it('改向时**先删干净再建**：回家→留校删老键那条，留校→回家删新键那条', () => {
    const homeToStay = planStatusChange(
      [{ studentId: 's1', status: 'home', weekendRecordId: 'w1' }],
      'stay',
      { isWeekend: true },
    )
    expect(homeToStay.remove).toEqual([{ recordId: 'w1', source: 'weekend' }])
    expect(homeToStay.create).toEqual([{ studentId: 's1', returnHome: false }])

    const stayToHome = planStatusChange(
      [{ studentId: 's1', status: 'stay', holidayRecordId: 'n1' }],
      'home',
      { isWeekend: true },
    )
    expect(stayToHome.remove).toEqual([{ recordId: 'n1', source: 'holiday' }])
    expect(stayToHome.addWeekend).toEqual(['s1'])

    // 自定义假期的家↔校互转：两条都在新键里
    const customFlip = planStatusChange(
      [{ studentId: 's1', status: 'home', holidayRecordId: 'n1' }],
      'stay',
      { isWeekend: false },
    )
    expect(customFlip.remove).toEqual([{ recordId: 'n1', source: 'holiday' }])
    expect(customFlip.create).toEqual([{ studentId: 's1', returnHome: false }])
  })

  it('设为「未登记」：两处的记录都删掉，且不建新的', () => {
    const plan = planStatusChange(
      [{ studentId: 's1', status: 'home', weekendRecordId: 'w1', holidayRecordId: 'n1' }],
      'unregistered',
      { isWeekend: true },
    )
    expect(plan.remove).toEqual([
      { recordId: 'w1', source: 'weekend' },
      { recordId: 'n1', source: 'holiday' },
    ])
    expect(plan.create).toEqual([])
    expect(plan.addWeekend).toEqual([])
  })

  it('fromCounts 说的是「原来各是什么状态」——确认文案「其中 3 人原为回家」照它写', () => {
    const plan = planStatusChange(
      [
        { studentId: 's1', status: 'home', weekendRecordId: 'w1' },
        { studentId: 's2', status: 'home', weekendRecordId: 'w2' },
        { studentId: 's3', status: 'unregistered' },
        { studentId: 's4', status: 'stay', holidayRecordId: 'n4' },
      ],
      'stay',
      { isWeekend: true },
    )
    expect(plan.fromCounts).toEqual({ home: 2, stay: 0, unregistered: 1 })
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
  const statusMap: Record<string, 'home' | 'stay' | 'unregistered'> = {
    s1: 'home',
    s2: 'stay',
    s3: 'unregistered',
  }
  const statusOf = (id: string) => statusMap[id] ?? 'unregistered'

  it('不给条件就是全班（学号升序）', () => {
    const rows = filterRoster(students, { keyword: '' }, statusOf)
    expect(rows.map((row) => row.student.id)).toEqual(['s1', 's2', 's3'])
    expect(rows.map((row) => row.status)).toEqual(['home', 'stay', 'unregistered'])
  })

  it('五组条件逐条生效，且叠加时是 AND（不是 OR）', () => {
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
    expect(
      filterRoster(students, { keyword: '', status: 'home' }, statusOf).map((r) => r.student.id),
    ).toEqual(['s1'])

    // AND：男性 且 昌都市区 且 有亲属 且 已回家 —— 只有 s1 同时满足
    expect(
      filterRoster(
        students,
        { keyword: '', gender: 'male', scope: 'changdu-city', relative: true, status: 'home' },
        statusOf,
      ).map((r) => r.student.id),
    ).toEqual(['s1'])
    // 换成 female 就一个都不剩（AND 不是 OR）
    expect(
      filterRoster(students, { keyword: '', gender: 'female', status: 'home' }, statusOf),
    ).toEqual([])
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
