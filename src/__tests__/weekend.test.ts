/**
 * 周末返家自检（Phase 7B 的口径 + **v3.2.0 的命名收敛**）。
 *
 * 这里盯的是**教师真正读到的那几个词**：本周末 / 上周末 / 下周末，
 * 再远的一律换成日期（「8月16日周末」这类说法）。
 * 命名错了不会报错、不会崩，只会让教师在脑子里做两次减法还不确定——
 * 所以「不许再出现『上上周末』」这条必须由测试守着，不能只写在注释里。
 *
 * 另一条同样静默的规矩：**周末的标识永远是那个周六**。周日不是另一个周末，
 * 周一到周五根本没有可归属的周末（登记到错的那一期，返家名单就整份偏了）。
 */
import { describe, expect, it } from 'vitest'

import {
  currentWeekendKey,
  describeWeekend,
  formatWeekendLabel,
  isWeekendKey,
  normalizeWeekendReturn,
  sortWeekendReturns,
  weekendKeyOf,
} from '@/utils/weekend'
import { addDaysToDateKey } from '@/utils/date'
import type { WeekendReturnRecord } from '@/types/weekend'

/** 周三（工作日：可归属的周末还没到，取即将到来的那个周六 9/19） */
const WED = '2026-09-16'
const SAT = '2026-09-19'
const SUN = '2026-09-20'

/* ========== 本期归属 ========== */

describe('周末键：永远是那个周六，周日归到前一天', () => {
  it('周六是它自己；周日归到昨天那个周六（周日不是另一个周末）', () => {
    expect(weekendKeyOf(SAT)).toBe(SAT)
    expect(weekendKeyOf(SUN)).toBe(SAT)
    expect(weekendKeyOf(`${SUN}`)).toBe('2026-09-19')
  })

  it('周一到周五没有可归属的周末 → undefined（不猜「下个周六」）', () => {
    // 猜错一次就是把返家记录写到了错误的周末上，宁可让调用方拒绝这次输入
    for (const day of ['2026-09-14', '2026-09-15', WED, '2026-09-17', '2026-09-18']) {
      expect(weekendKeyOf(day)).toBeUndefined()
    }
  })

  it('非法日期键一律 undefined（不抛、不猜）', () => {
    expect(weekendKeyOf('')).toBeUndefined()
    expect(weekendKeyOf('2026-9-19')).toBeUndefined()
    expect(weekendKeyOf('2026-02-31')).toBeUndefined()
  })

  it('isWeekendKey 只认周六（周日归一后再校验，故周日键不算合法键）', () => {
    expect(isWeekendKey(SAT)).toBe(true)
    expect(isWeekendKey(SUN)).toBe(false)
    expect(isWeekendKey('2026-09-16')).toBe(false)
    expect(isWeekendKey(42)).toBe(false)
  })

  it('currentWeekendKey：工作日取即将到来的周六；周末当天取它自己', () => {
    expect(currentWeekendKey(WED)).toBe(SAT)
    expect(currentWeekendKey(SAT)).toBe(SAT)
    expect(currentWeekendKey(SUN)).toBe(SAT)
    // 周一（9/21）眼里的「本周末」是即将到来的 9/26——刚过去的 9/19 已经是「上周末」了
    expect(currentWeekendKey('2026-09-21')).toBe('2026-09-26')
    expect(describeWeekend(SAT, '2026-09-21')).toBe('上周末')
  })

  it('formatWeekendLabel 仍是「周六 – 周日」的完整区间（弹窗 / 删除确认用）', () => {
    expect(formatWeekendLabel(SAT)).toBe('9月19日 – 9月20日')
  })
})

/* ========== v3.2.0：命名收敛 ========== */

describe('describeWeekend（v3.2.0：±1 周用自然语言，再远用日期）', () => {
  it('本周末 / 下周末 / 上周末——只有这三个词', () => {
    expect(describeWeekend(SAT, WED)).toBe('本周末')
    expect(describeWeekend(addDaysToDateKey(SAT, 7), WED)).toBe('下周末')
    expect(describeWeekend(addDaysToDateKey(SAT, -7), WED)).toBe('上周末')
  })

  it('超过 ±1 周的周末改用日期：「8月29日周末」「9月5日周末」', () => {
    expect(describeWeekend(addDaysToDateKey(SAT, -14), WED)).toBe('9月5日周末')
    expect(describeWeekend(addDaysToDateKey(SAT, -21), WED)).toBe('8月29日周末')
    expect(describeWeekend(addDaysToDateKey(SAT, 14), WED)).toBe('10月3日周末')
    expect(describeWeekend(addDaysToDateKey(SAT, 21), WED)).toBe('10月10日周末')
  })

  it('跨月 / 跨年也要落在真实的周六上（不补零、不带年份）', () => {
    // 站在 2026-11-18（周三，本周末 = 11/21）看 2027-01-02 那一期：+42 天，早超出自然语言了
    expect(describeWeekend('2027-01-02', '2026-11-18')).toBe('1月2日周末')
    // 站在 2027-01-06（周三，本周末 = 1/9）回看 2026-12-19：−21 天，同样用日期
    expect(describeWeekend('2026-12-19', '2027-01-06')).toBe('12月19日周末')
  })

  it('「上上周末 / 下下周末」这类叠加说法彻底消失', () => {
    const labels: string[] = []
    for (let offset = -70; offset <= 70; offset += 7) {
      labels.push(describeWeekend(addDaysToDateKey(SAT, offset), WED))
    }
    expect(labels.some((label) => label.includes('上上') || label.includes('下下'))).toBe(false)
    // 旧接口的「超出范围返回空串」也一并取消：任何合法周末键都有话可说
    expect(labels.every((label) => label.length > 0)).toBe(true)
  })

  it('今天就在周末里也说得对：周六 / 周日看到的「本周末」是同一期', () => {
    expect(describeWeekend(SAT, SAT)).toBe('本周末')
    expect(describeWeekend(SAT, SUN)).toBe('本周末')
    expect(describeWeekend(addDaysToDateKey(SAT, -7), SUN)).toBe('上周末')
  })

  it('日期文案里的那一天真的是周六（说法与事实必须对得上）', () => {
    const key = addDaysToDateKey(SAT, -21)
    const label = describeWeekend(key, WED)
    // 「8月29日周末」→ 抽回 8 / 29，拼成日期键后必须仍是那个周六键
    const [, month, day] = /^(\d+)月(\d+)日周末$/.exec(label) ?? []
    expect(month).toBeDefined()
    expect(key).toBe(`2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
    expect(weekendKeyOf(key)).toBe(key)
  })
})

/* ========== 记录健壮化与排序 ========== */

function mkRecord(overrides: Partial<WeekendReturnRecord>): WeekendReturnRecord {
  return {
    id: 'x',
    studentId: 's1',
    studentName: '张三 0001',
    weekendDate: SAT,
    createdAt: '2026-09-14T08:00:00.000Z',
    ...overrides,
  }
}

describe('周末返家记录的健壮化与排序', () => {
  it('normalizeWeekendReturn：学生与周末键缺一即丢弃；补 id / 时间戳', () => {
    expect(normalizeWeekendReturn(null)).toBeNull()
    expect(normalizeWeekendReturn('x')).toBeNull()
    expect(normalizeWeekendReturn({ weekendDate: SAT })).toBeNull()
    expect(normalizeWeekendReturn({ studentId: 's1' })).toBeNull()
    // 周日键不是合法周末键
    expect(normalizeWeekendReturn({ studentId: 's1', weekendDate: SUN })).toBeNull()

    const ok = normalizeWeekendReturn({
      studentId: 's1',
      studentName: '  张三  ',
      weekendDate: SAT,
    })
    expect(ok).toMatchObject({ studentId: 's1', studentName: '张三', weekendDate: SAT })
    expect(ok?.id).toBeTruthy()
    expect(ok?.createdAt).toBeTruthy()
  })

  it('排序：周末倒序（越新的越靠前），同一周末内按姓名快照升序', () => {
    const sorted = sortWeekendReturns([
      mkRecord({ id: 'a', studentName: '李四', weekendDate: '2026-09-12' }),
      mkRecord({ id: 'b', studentName: '张三', weekendDate: '2026-09-19' }),
      mkRecord({ id: 'c', studentName: '王五', weekendDate: '2026-09-19' }),
    ])
    // 9/19 那一期在前，其中「王五」按拼音（wáng < zhāng）排在「张三」前面；
    // 9/12 那一期整体垫底——周末倒序优先于姓名升序
    expect(sorted.map((item) => item.id)).toEqual(['c', 'b', 'a'])
  })
})
