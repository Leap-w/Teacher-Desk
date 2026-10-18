/**
 * 按天指定值日组（v3.7.5 引入；v3.7.6 起指定会衔接后续自动轮换）。
 *
 * 规则一句话：**指定优先；指定日之后的自动轮换从指定组继续向后衔接**，
 * 直到遇到下一条按天指定。指定不改轮换起点、不改组序、不改指定日之前的日期。
 * 这里钉住这条线的每一段：当天固定、次日衔接、跨周末、跨月 / 跨年、多个指定
 * 依次衔接、取消后重算、刷新后仍有效。
 *
 * 落库走的是与其它领域完全相同的一条路（`teacherdesk:duty` 一个数组 → 仓储 →
 * 同步），所以这里额外守两条纪律：**非法日期 / 不存在的组一律拒绝且一个字节都不写**；
 * **读回来的脏数据（同一天两条、缺字段）按「当天最后一条」收敛，且不动盘上原文**。
 */
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { readRaw } from '@/services/storage'
import { useNow } from '@/composables/useToday'
import { useDutyStore } from '@/stores/duty'
import { dutyAutoGroupForDay, dutyGroupForDay, findDayAssignment } from '@/utils/duty'
import type { DutyDayAssignment, DutyGroup, DutySettings } from '@/types/duty'

const DUTY_KEY = `${appConfig.storageKeyPrefix}:duty`

/** 2026-09-14 是星期一（同一份日历在 v331Linkage.test.ts 里也用过） */
const MONDAY = new Date('2026-09-14T09:00:00')
const TUESDAY = new Date('2026-09-15T09:00:00')
const SATURDAY = new Date('2026-09-19T09:00:00')

let browser: FakeBrowser

beforeEach(() => {
  browser = installFakeBrowser()
  setActivePinia(createPinia())
  seedDuty()
  // 时钟是全应用共用的那一个 ref（useNow）：把「今天」钉在周一，日期断言才有意义
  useNow().value = MONDAY
})

/**
 * 三个组 + 起点 2026-09-14（周一）起 g1 值日、周末不排。
 * 于是基线轮换是：9/14 g1、9/15 g2、9/16 g3、9/17 g1、9/18 g2，
 * 9/19–9/20 不值日（周末），9/21 周一 g3、9/22 g1、9/23 g2……（下面的断言全按这条线读）
 */
function seedDuty(): void {
  browser.localStorage.seed(
    DUTY_KEY,
    JSON.stringify([
      { id: 'g1', kind: 'group', name: '第 1 组', studentIds: [] },
      { id: 'g2', kind: 'group', name: '第 2 组', studentIds: [] },
      { id: 'g3', kind: 'group', name: '第 3 组', studentIds: [] },
      {
        id: 'duty-settings',
        kind: 'settings',
        startDate: '2026-09-14',
        startGroupId: 'g1',
        includeWeekend: false,
      },
    ]),
  )
}

/**
 * 盘上现在有哪些记录（不经过被测代码读，避免「用被测对象验证自己」）。
 * 读之前**必须先 `await nextTick()`**：写盘挂在 Vue 的 `watch` 上（默认 pre-flush），
 * 改完 store 要等一个 tick 才真的落到 localStorage。
 */
function stored(): Array<Record<string, unknown>> {
  return JSON.parse(readRaw(DUTY_KEY) ?? '[]') as Array<Record<string, unknown>>
}

/** 盘上的「按天指定」记录 */
function storedDays(): Array<Record<string, unknown>> {
  return stored().filter((item) => item.kind === 'day')
}

describe('基线轮换：完全不指定时不发生任何变化', () => {
  it('今天、后续日期都按原轮换走，盘上没有任何「按天指定」记录', () => {
    const store = useDutyStore()

    expect(store.todayGroup?.id).toBe('g1')
    expect(store.todayAssigned).toBe(false)
    expect(store.dayAssignments).toHaveLength(0)
    expect(store.dayGroup('2026-09-16')?.id).toBe('g3')
    expect(store.dayGroup('2026-09-21')?.id).toBe('g3')
    expect(storedDays()).toHaveLength(0)
  })

  it('近 7 天时间轴与基线完全一致', () => {
    const store = useDutyStore()

    expect(store.upcomingDays.map((day) => day.dateKey)).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ])
    expect(store.upcomingDays.map((day) => day.group?.id)).toEqual([
      'g1',
      'g2',
      'g3',
      'g1',
      'g2',
      undefined,
      undefined,
    ])
    expect(store.upcomingDays.every((day) => !day.assigned)).toBe(true)
  })
})

describe('按天指定：当天固定，后续从指定组继续衔接', () => {
  it('指定某一天：这一天按指定的组，记录落盘（kind=day）', async () => {
    const store = useDutyStore()

    expect(store.setDayGroup('2026-09-15', 'g3')).toBe(true)
    await nextTick()

    expect(store.hasDayAssignment('2026-09-15')).toBe(true)
    expect(store.dayGroup('2026-09-15')?.id).toBe('g3')
    const days = storedDays()
    expect(days).toHaveLength(1)
    expect(days[0]).toMatchObject({ kind: 'day', dateKey: '2026-09-15', groupId: 'g3' })
  })

  it('指定后：次日从指定组往后衔接，之前的日期、轮换起点与组序都不动', async () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-15', 'g3')
    await nextTick()

    // 起点与组序原样（指定不是「改起点」，更不是「改组序」）
    expect(store.settings.startDate).toBe('2026-09-14')
    expect(store.settings.startGroupId).toBe('g1')
    expect(store.groups.map((group) => group.id)).toEqual(['g1', 'g2', 'g3'])
    // 指定日之前完全不受影响
    expect(store.dayGroup('2026-09-14')?.id).toBe('g1')
    // 指定日固定 g3；之后从 g3 继续：9/16 g1、9/17 g2、9/18 g3、跨周末后 9/21 g1
    expect(store.dayGroup('2026-09-15')?.id).toBe('g3')
    expect(store.dayGroup('2026-09-16')?.id).toBe('g1')
    expect(store.dayGroup('2026-09-17')?.id).toBe('g2')
    expect(store.dayGroup('2026-09-18')?.id).toBe('g3')
    expect(store.dayGroup('2026-09-21')?.id).toBe('g1')
    // 盘上也确实只多出那一条
    expect(storedDays()).toHaveLength(1)
  })

  it('指定第 5 组后，下一自动日期衔接第 6 组；最后一组之后回到第一组', () => {
    // 六个组的场景与需求示例一致：9/14 g1、9/15 基线 g2
    browser.localStorage.seed(
      DUTY_KEY,
      JSON.stringify([
        ...['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((id, index) => ({
          id,
          kind: 'group',
          name: `第 ${index + 1} 组`,
          studentIds: [],
        })),
        {
          id: 'duty-settings',
          kind: 'settings',
          startDate: '2026-09-14',
          startGroupId: 'g1',
          includeWeekend: false,
        },
      ]),
    )
    setActivePinia(createPinia())
    const store = useDutyStore()

    expect(store.dayGroup('2026-09-15')?.id).toBe('g2')
    store.setDayGroup('2026-09-15', 'g5')

    expect(store.dayGroup('2026-09-15')?.id).toBe('g5')
    expect(store.dayGroup('2026-09-16')?.id).toBe('g6')
    expect(store.dayGroup('2026-09-17')?.id).toBe('g1') // 最后一组之后循环回第一组
    expect(store.dayGroup('2026-09-18')?.id).toBe('g2')
  })

  it('时间轴把指定日标出来，后续日期按指定组衔接', () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-17', 'g2')

    const days = store.upcomingDays
    expect(days.filter((day) => day.assigned).map((day) => day.dateKey)).toEqual(['2026-09-17'])
    expect(days.map((day) => day.group?.id)).toEqual([
      'g1',
      'g2',
      'g3',
      'g2', // 9/17：指定为 g2（轮换本来轮到 g1）
      'g3', // 9/18：从指定组 g2 往后衔接
      undefined, // 周末不排
      undefined,
    ])
  })

  it('多个指定依次衔接：后一个指定优先，其后的自动日期从它继续', () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-15', 'g3')
    store.setDayGroup('2026-09-17', 'g2')

    expect(store.dayGroup('2026-09-15')?.id).toBe('g3')
    expect(store.dayGroup('2026-09-16')?.id).toBe('g1') // 从 9/15 的 g3 往后一组
    expect(store.dayGroup('2026-09-17')?.id).toBe('g2') // 后一个指定优先
    expect(store.dayGroup('2026-09-18')?.id).toBe('g3') // 从 9/17 的 g2 往后一组
    expect(store.dayGroup('2026-09-21')?.id).toBe('g1') // 跨周末继续衔接
    expect(store.dayGroup('2026-09-22')?.id).toBe('g2')
  })

  it('过去日期不受今天指定影响', () => {
    useNow().value = TUESDAY
    const store = useDutyStore()
    const before = store.dayGroup('2026-09-14')?.id

    store.setDayGroup('2026-09-15', 'g3')

    expect(before).toBe('g1')
    expect(store.dayGroup('2026-09-14')?.id).toBe('g1') // 昨天仍是昨天的轮换结果
    expect(store.dayGroup('2026-09-15')?.id).toBe('g3') // 今天固定
    expect(store.dayGroup('2026-09-16')?.id).toBe('g1') // 明天从今天指定组往后一组
  })

  it('显式指定的周末照指定排，并从指定组衔接下一个值日日', () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-19', 'g1')

    useNow().value = SATURDAY
    expect(store.todayGroup?.id).toBe('g1')
    expect(store.todayAssigned).toBe(true)
    // 星期天没被指定，仍然是不值日
    expect(store.dayGroup('2026-09-20')).toBeUndefined()
    // 周六指定了 g1（占一个轮换位），周一从 g2 继续——而不是基线里的 g3
    expect(store.dayGroup('2026-09-21')?.id).toBe('g2')
  })

  it('跨月、跨周与组序循环都正确', () => {
    useNow().value = new Date('2026-09-30T09:00:00')
    const store = useDutyStore()

    // 基线：9/30 g1；指定为 g2 后，10/1 g3、10/2 g1（循环回第一组）
    expect(store.dayGroup('2026-09-30')?.id).toBe('g1')
    store.setDayGroup('2026-09-30', 'g2')

    expect(store.upcomingDays.map((day) => day.dateKey)).toEqual([
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
    ])
    expect(store.upcomingDays.map((day) => day.group?.id)).toEqual([
      'g2', // 指定
      'g3',
      'g1', // 最后一组之后回到第一组
      undefined,
      undefined,
      'g2', // 跨周末继续
      'g3',
    ])
  })

  it('跨年衔接正确（12/31 指定后，次年 1/1 从指定组往后轮）', () => {
    const groups: DutyGroup[] = ['g1', 'g2', 'g3'].map((id, index) => ({
      id,
      kind: 'group',
      name: `第 ${index + 1} 组`,
      studentIds: [],
    }))
    const settings: DutySettings = {
      id: 'duty-settings',
      kind: 'settings',
      startDate: '2026-12-28',
      startGroupId: 'g1',
      includeWeekend: false,
    }
    const assignments: DutyDayAssignment[] = [
      { id: 'd1', kind: 'day', dateKey: '2026-12-31', groupId: 'g3', createdAt: '' },
    ]

    expect(dutyGroupForDay('2026-12-31', groups, settings, assignments)?.id).toBe('g3')
    expect(dutyGroupForDay('2027-01-01', groups, settings, assignments)?.id).toBe('g1')
    expect(dutyGroupForDay('2027-01-04', groups, settings, assignments)?.id).toBe('g2')
    expect(dutyGroupForDay('2027-01-05', groups, settings, assignments)?.id).toBe('g3')
  })

  it('同一天再指定一次 = 覆盖：盘上只留一条，后一次为准，后续按新指定衔接', async () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-15', 'g3')
    store.setDayGroup('2026-09-15', 'g1')
    await nextTick()

    expect(store.dayAssignments).toHaveLength(1)
    expect(store.dayGroup('2026-09-15')?.id).toBe('g1')
    expect(store.dayGroup('2026-09-16')?.id).toBe('g2') // 从后一次指定的 g1 往后一组
    const days = storedDays()
    expect(days).toHaveLength(1)
    expect(days[0]).toMatchObject({ dateKey: '2026-09-15', groupId: 'g1' })
  })

  it('刷新 / 重开应用后仍然有效，后续衔接也保持', async () => {
    useDutyStore().setDayGroup('2026-09-15', 'g3')
    await nextTick()

    // 「刷新」＝重新建一个 Pinia 实例，store 从盘上重新读一遍
    setActivePinia(createPinia())
    useNow().value = TUESDAY
    const revived = useDutyStore()

    expect(revived.dayAssignments).toHaveLength(1)
    expect(revived.todayGroup?.id).toBe('g3')
    expect(revived.todayAssigned).toBe(true)
    expect(revived.dayGroup('2026-09-16')?.id).toBe('g1')
    expect(revived.dayGroup('2026-09-17')?.id).toBe('g2')
  })

  it('指定的组被删除后：这一天及后续回落到轮换，不会空着（记录留着，教师可改派或取消）', async () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-15', 'g3')

    expect(store.removeGroup('g3')).toBe(true)
    await nextTick()

    // 剩下 g1 / g2：9/14 g1、9/15 g2、9/16 g1、9/17 g2（失效指定不参与衔接）
    expect(store.dayGroup('2026-09-15')?.id).toBe('g2')
    expect(store.dayGroup('2026-09-16')?.id).toBe('g1')
    expect(store.dayGroup('2026-09-17')?.id).toBe('g2')
    expect(store.hasDayAssignment('2026-09-15')).toBe(true)
    expect(storedDays()).toHaveLength(1)
  })
})

describe('与轮换起点重设的兼容：旧指定不会抵消新起点', () => {
  /** 三个组的纯函数夹具：起点 2026-09-14（周一）g1、周末不排 */
  const groups: DutyGroup[] = ['g1', 'g2', 'g3'].map((id, index) => ({
    id,
    kind: 'group',
    name: `第 ${index + 1} 组`,
    studentIds: [],
  }))
  const settings: DutySettings = {
    id: 'duty-settings',
    kind: 'settings',
    startDate: '2026-09-14',
    startGroupId: 'g1',
    includeWeekend: false,
  }

  it('轮换起点之前的指定：当天仍生效，但不向后衔接', () => {
    const assignments: DutyDayAssignment[] = [
      { id: 'd1', kind: 'day', dateKey: '2026-09-10', groupId: 'g1', createdAt: '' },
    ]

    // 指定当天仍然按指定组
    expect(dutyGroupForDay('2026-09-10', groups, settings, assignments)?.id).toBe('g1')
    // 起点之后按轮换基线：9/15 是 g2（若旧指定参与衔接，会算成 g1）
    expect(dutyGroupForDay('2026-09-15', groups, settings, assignments)?.id).toBe('g2')
    expect(dutyGroupForDay('2026-09-16', groups, settings, assignments)?.id).toBe('g3')
  })

  it('重设起点后：起点之前的旧指定不再影响新起点之后的日期', () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-10', 'g1') // 旧指定（在新起点之前）
    expect(store.setRotation({ startDate: '2026-09-14', startGroupId: 'g2' })).toBe(true)

    expect(store.dayGroup('2026-09-14')?.id).toBe('g2')
    expect(store.dayGroup('2026-09-15')?.id).toBe('g3') // 新起点 + 1，而不是旧指定的 g1
    expect(store.dayGroup('2026-09-16')?.id).toBe('g1')
    // 旧指定本身仍然留着，自己的那一天照常显示
    expect(store.dayGroup('2026-09-10')?.id).toBe('g1')
    expect(store.hasDayAssignment('2026-09-10')).toBe(true)
  })
})

describe('取消指定：按原有轮换与其他仍有效的指定重新衔接', () => {
  it('取消唯一的指定：这一天及其之后完全回到基线轮换', async () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-15', 'g3')
    await nextTick()
    // 先立一条前置条件：指定真的落了盘，不然下面的「盘上没有」是白说的
    expect(storedDays()).toHaveLength(1)

    expect(store.clearDayGroup('2026-09-15')).toBe(true)
    await nextTick()

    expect(store.hasDayAssignment('2026-09-15')).toBe(false)
    expect(store.dayGroup('2026-09-15')?.id).toBe('g2') // 回到轮换
    expect(store.dayGroup('2026-09-16')?.id).toBe('g3')
    expect(store.dayGroup('2026-09-17')?.id).toBe('g1')
    expect(store.dayGroup('2026-09-18')?.id).toBe('g2')
    expect(storedDays()).toHaveLength(0)
    // 组与设置一条没少
    expect(store.groups).toHaveLength(3)
  })

  it('取消其中一个指定：另一个指定仍优先，其后的轮换从它继续衔接', async () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-15', 'g3')
    store.setDayGroup('2026-09-17', 'g2')
    await nextTick()

    expect(store.clearDayGroup('2026-09-15')).toBe(true)
    await nextTick()

    expect(store.dayGroup('2026-09-15')?.id).toBe('g2') // 回到基线
    expect(store.dayGroup('2026-09-16')?.id).toBe('g3')
    expect(store.dayGroup('2026-09-17')?.id).toBe('g2') // 另一个指定一条都没动
    expect(store.dayGroup('2026-09-18')?.id).toBe('g3') // 从仍有效的 9/17 指定衔接
    expect(store.dayGroup('2026-09-21')?.id).toBe('g1')
    expect(storedDays()).toHaveLength(1)
    expect(storedDays()[0]).toMatchObject({ dateKey: '2026-09-17', groupId: 'g2' })
  })

  it('取消指定不会改动组序与轮换起点', () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-16', 'g1')
    store.clearDayGroup('2026-09-16')

    expect(store.groups.map((group) => group.id)).toEqual(['g1', 'g2', 'g3'])
    expect(store.settings.startDate).toBe('2026-09-14')
    expect(store.settings.startGroupId).toBe('g1')
  })

  it('「不指定时自动轮到哪组」与取消后的结果同源（忽略当天自己的指定，考虑之前的指定）', () => {
    const groups: DutyGroup[] = ['g1', 'g2', 'g3'].map((id, index) => ({
      id,
      kind: 'group',
      name: `第 ${index + 1} 组`,
      studentIds: [],
    }))
    const settings: DutySettings = {
      id: 'duty-settings',
      kind: 'settings',
      startDate: '2026-09-14',
      startGroupId: 'g1',
      includeWeekend: false,
    }
    const assignments: DutyDayAssignment[] = [
      { id: 'd1', kind: 'day', dateKey: '2026-09-15', groupId: 'g3', createdAt: '' },
      { id: 'd2', kind: 'day', dateKey: '2026-09-17', groupId: 'g2', createdAt: '' },
    ]

    // 9/17 自己的指定是 g2；忽略它、只看之前的 9/15 g3 → 9/17 自动轮到 g2（碰巧相同）
    expect(dutyAutoGroupForDay('2026-09-17', groups, settings, assignments)?.id).toBe('g2')
    // 9/16 只看 9/15 的指定：g3 的下一组 g1
    expect(dutyAutoGroupForDay('2026-09-16', groups, settings, assignments)?.id).toBe('g1')
    // 指定当天仍以指定为准
    expect(dutyGroupForDay('2026-09-15', groups, settings, assignments)?.id).toBe('g3')
  })
})

describe('按天指定：写入前的把关（宁可不写，也不留下一颗错数据）', () => {
  it('非法日期 / 不存在的组一律拒绝，盘上原文一个字不动', () => {
    const store = useDutyStore()
    const before = readRaw(DUTY_KEY)
    browser.localStorage.resetCounters()

    expect(store.setDayGroup('2026-13-01', 'g1')).toBe(false) // 认不出的日期
    expect(store.setDayGroup('1999-12-31', 'g1')).toBe(false) // 年份超出 2000–2099
    expect(store.setDayGroup('2026-09-15', '不存在的组')).toBe(false)
    expect(store.setDayGroup('2026-09-15', '')).toBe(false)

    expect(store.dayAssignments).toHaveLength(0)
    expect(readRaw(DUTY_KEY)).toBe(before)
    expect(browser.localStorage.writesFor(DUTY_KEY)).toBe(0)
  })

  it('取消一天没指定过的日期：返回 false，同样不写盘', () => {
    const store = useDutyStore()
    browser.localStorage.resetCounters()

    expect(store.clearDayGroup('2026-09-16')).toBe(false)

    expect(browser.localStorage.writesFor(DUTY_KEY)).toBe(0)
  })
})

describe('读取路径：按天指定记录的健壮化', () => {
  it('同一天有两条指定 → 只留 createdAt 最晚的那条（后一次才是教师的意思）', () => {
    const raw = stored()
    browser.localStorage.seed(
      DUTY_KEY,
      JSON.stringify([
        ...raw,
        {
          id: 'd-old',
          kind: 'day',
          dateKey: '2026-09-15',
          groupId: 'g2',
          createdAt: '2026-09-10T08:00:00.000Z',
        },
        {
          id: 'd-new',
          kind: 'day',
          dateKey: '2026-09-15',
          groupId: 'g3',
          createdAt: '2026-09-11T08:00:00.000Z',
        },
      ]),
    )

    const store = useDutyStore()

    expect(store.dayAssignments).toHaveLength(1)
    expect(store.dayAssignments[0]!.id).toBe('d-new')
    expect(store.dayGroup('2026-09-15')?.id).toBe('g3')
    // 后续衔接也按留下来的那条
    expect(store.dayGroup('2026-09-16')?.id).toBe('g1')
  })

  it('日期认不出 / 缺组 id 的记录丢弃，且盘上原文保留、一次都不写', () => {
    const before = JSON.stringify([
      { id: 'g1', kind: 'group', name: '第 1 组', studentIds: [] },
      { id: 'd1', kind: 'day', dateKey: '不是日期', groupId: 'g1' },
      { id: 'd2', kind: 'day', dateKey: '2026-09-16' },
      { id: 'd3', kind: 'day', dateKey: '2026-09-16', groupId: '' },
    ])
    browser.localStorage.seed(DUTY_KEY, before)

    const store = useDutyStore()

    expect(store.dayAssignments).toHaveLength(0)
    // 半条指定既说不上是哪天、也说不上是哪一组，留着只会显示一个空的指定
    expect(store.dayGroup('2026-09-16')).toBeUndefined() // 没有起点设置 → 不编造排班
    expect(readRaw(DUTY_KEY)).toBe(before)
    expect(browser.localStorage.writesFor(DUTY_KEY)).toBe(0)
  })

  it('指定记录也能被纯函数直接查询（页面与工作台卡片共用同一口径）', () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-15', 'g3')

    const hit = findDayAssignment(store.dayAssignments, '2026-09-15')
    expect(hit?.groupId).toBe('g3')
    expect(findDayAssignment(store.dayAssignments, '2026-09-16')).toBeUndefined()
  })
})
