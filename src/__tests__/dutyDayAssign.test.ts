/**
 * v3.7.5「按天指定值日组」：教师给**某一天**单独指定值日组。
 *
 * 这一版的规则只有一句话——**指定优先，没指定就按轮换**（utils/duty.ts 的
 * `dutyGroupForDay`）。这里钉住的正是这条线的两头：指定过的那天按指定走；
 * **没指定过的日子一天都不能动**（轮换起点、组序、其他日期都不受影响）。
 * 接错一处，教师看到的是「我给周二换了人，结果整周都串了」——
 * 轮换本身还在跑，页面上很难当场看出是错的。
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
import { findDayAssignment } from '@/utils/duty'

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
 * 于是轮换是：9/14 g1、9/15 g2、9/16 g3、9/17 g1、9/18 g2，9/19–9/20 不值日（周末），
 * 9/21 周一 g3……（下面的断言全部按这条线读）
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

describe('按天指定：指定优先，其余照旧按轮换', () => {
  it('还没指定时一天都不多：今天按轮换，盘上没有任何「按天指定」记录', () => {
    const store = useDutyStore()

    expect(store.todayGroup?.id).toBe('g1')
    expect(store.todayAssigned).toBe(false)
    expect(store.dayAssignments).toHaveLength(0)
    expect(store.dayGroup('2026-09-16')?.id).toBe('g3')
    expect(storedDays()).toHaveLength(0)
  })

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

  it('只改这一天：轮换起点、组序、其他日期一个都不动', async () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-15', 'g3')
    await nextTick()

    // 起点与组序原样（指定不是「改起点」，更不是「改组序」）
    expect(store.settings.startDate).toBe('2026-09-14')
    expect(store.settings.startGroupId).toBe('g1')
    expect(store.groups.map((group) => group.id)).toEqual(['g1', 'g2', 'g3'])
    // 指定日之前、之后都还是轮换推算出来的那几组（9/15 被改成 g3 不改动别人的步进）
    expect(store.dayGroup('2026-09-14')?.id).toBe('g1')
    expect(store.dayGroup('2026-09-16')?.id).toBe('g3')
    expect(store.dayGroup('2026-09-17')?.id).toBe('g1')
    expect(store.dayGroup('2026-09-18')?.id).toBe('g2')
    // 盘上也确实只多出那一条
    expect(storedDays()).toHaveLength(1)
  })

  it('指定过的那天会标出来，「近 7 天」里其余日子照旧', () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-17', 'g2')

    const days = store.upcomingDays
    expect(days.map((day) => day.dateKey)).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ])
    expect(days.filter((day) => day.assigned).map((day) => day.dateKey)).toEqual(['2026-09-17'])
    expect(days.map((day) => day.group?.id)).toEqual([
      'g1',
      'g2',
      'g3',
      'g2', // 9/17：指定为 g2（轮换本来轮到 g1）
      'g2',
      undefined, // 周末不排
      undefined,
    ])
  })

  it('刷新 / 重开应用后仍然有效（读回来还是指定的那组）', async () => {
    useDutyStore().setDayGroup('2026-09-15', 'g3')
    await nextTick()

    // 「刷新」＝重新建一个 Pinia 实例，store 从盘上重新读一遍
    setActivePinia(createPinia())
    useNow().value = TUESDAY
    const revived = useDutyStore()

    expect(revived.dayAssignments).toHaveLength(1)
    expect(revived.todayGroup?.id).toBe('g3')
    expect(revived.todayAssigned).toBe(true)
    // 后一天没被指定，照旧按轮换
    expect(revived.dayGroup('2026-09-16')?.id).toBe('g3')
    expect(revived.dayGroup('2026-09-17')?.id).toBe('g1')
  })

  it('同一天再指定一次 = 覆盖：盘上只留一条，后一次为准', async () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-15', 'g3')
    store.setDayGroup('2026-09-15', 'g1')
    await nextTick()

    expect(store.dayAssignments).toHaveLength(1)
    expect(store.dayGroup('2026-09-15')?.id).toBe('g1')
    const days = storedDays()
    expect(days).toHaveLength(1)
    expect(days[0]).toMatchObject({ dateKey: '2026-09-15', groupId: 'g1' })
  })

  it('取消指定：这一天回到轮换，盘上的记录被删掉', async () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-15', 'g3')
    await nextTick()
    // 先立一条前置条件：指定真的落了盘，不然下面的「盘上没有」是白说的
    expect(storedDays()).toHaveLength(1)

    expect(store.clearDayGroup('2026-09-15')).toBe(true)
    await nextTick()

    expect(store.hasDayAssignment('2026-09-15')).toBe(false)
    expect(store.dayGroup('2026-09-15')?.id).toBe('g2') // 回到轮换
    expect(storedDays()).toHaveLength(0)
    // 组与设置一条没少
    expect(store.groups).toHaveLength(3)
  })

  it('显式指定的周末照指定排（指定优先于「周末不排」），没指定的周末照旧空着', () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-19', 'g2')

    useNow().value = SATURDAY
    expect(store.todayGroup?.id).toBe('g2')
    expect(store.todayAssigned).toBe(true)
    // 星期天没被指定，仍然是不值日
    expect(store.dayGroup('2026-09-20')).toBeUndefined()
  })

  it('指定的组被删除后：这一天回落到轮换，不会空着（记录留着，教师可改派或取消）', async () => {
    const store = useDutyStore()
    store.setDayGroup('2026-09-15', 'g3')

    expect(store.removeGroup('g3')).toBe(true)
    await nextTick()

    expect(store.dayGroup('2026-09-15')?.id).toBe('g2') // 剩下 g1 / g2，9/15 轮换到 g2
    expect(store.hasDayAssignment('2026-09-15')).toBe(true)
    expect(storedDays()).toHaveLength(1)
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
    // 半条指定既说不上是哪天、也说不上哪一组，留着只会显示一个空的指定
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
