/**
 * 教学设置（v3.3.0）自检：**「课程时间」与「座位图默认视角」真的驱动了别处**。
 *
 * 这一版的核心指控是「设置页里有假按钮」——点了只弹一句「开发中」。所以这里验的不是
 * 「控件能点」，而是**改完之后别处读到的值真的变了**：
 *
 * ① 生效时段表 = 默认作息 + 覆盖（`resolvePeriods`），且 `id / label / order` 一个不动；
 * ② 三条护栏（形状 / 先后 / 不重叠）——放过去一条，课表会在某一段**静默失灵**
 *    （同一时刻两节课都「正在进行」，或某一节永远既不 ongoing 也不 next）；
 * ③ 只存被改过的节：没动的节不写盘，学校改了作息、应用升级带了新默认值时才不会被旧拷贝盖住；
 * ④ 默认视角落盘并回读，且**只认 teacher / student**（盘上被写坏的字符串必须回退）。
 */
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { DEFAULT_APP_SETTINGS } from '@/repositories/settings/appSettingsRepository'
import { COURSE_PERIODS } from '@/types/timetable'
import { countPeriodOverrides, resolvePeriods } from '@/utils/timetable'

const SETTINGS_KEY = `${appConfig.storageKeyPrefix}:settings`

/** 装好假浏览器并清盘；每个 describe 各自调 */
function freshEnvironment(): void {
  installFakeBrowser()
  window.localStorage.clear()
  vi.resetModules()
  setActivePinia(createPinia())
}

async function freshStore() {
  const { useAppSettingsStore } = await import('@/stores/appSettings')
  return useAppSettingsStore()
}

/** 把一份设置直接写进盘（模拟「上一次打开的教师改过」） */
function seedSettings(patch: Record<string, unknown>): void {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify([{ ...DEFAULT_APP_SETTINGS, ...patch }]))
}

/* ========== ① 生效时段表 ========== */

describe('生效时段表（默认作息 + 覆盖）', () => {
  it('没有覆盖时，就是默认作息本身（逐条相等）', () => {
    expect(resolvePeriods()).toEqual([...COURSE_PERIODS])
  })

  it('覆盖只换时间，节数 / 顺序 / 名称 / 分组一个不动', () => {
    const periods = resolvePeriods({ p2: { start: '09:30', end: '10:10' } })
    expect(periods).toHaveLength(COURSE_PERIODS.length)
    periods.forEach((period, index) => {
      const base = COURSE_PERIODS[index]!
      expect(period.id).toBe(base.id)
      expect(period.label).toBe(base.label)
      expect(period.shortLabel).toBe(base.shortLabel)
      expect(period.order).toBe(base.order)
      expect(period.group).toBe(base.group)
    })
  })

  it('改过的那一节取新时间，其余各节保持原值', () => {
    const periods = resolvePeriods({ p3: { start: '10:40', end: '11:20' } })
    const changed = periods.find((period) => period.id === 'p3')!
    expect(changed.startTime).toBe('10:40')
    expect(changed.endTime).toBe('11:20')
    // 邻居不受影响（改一节不该牵动别节，否则「只存差异」就没有意义）
    expect(periods.find((period) => period.id === 'p2')!.startTime).toBe('09:20')
    expect(periods.find((period) => period.id === 'p4')!.startTime).toBe('11:25')
  })

  it('`countPeriodOverrides` 数的是真正改过的节数', () => {
    expect(countPeriodOverrides({})).toBe(0)
    expect(countPeriodOverrides({ p2: { start: '09:30', end: '10:10' } })).toBe(1)
    expect(
      countPeriodOverrides({
        p2: { start: '09:30', end: '10:10' },
        p3: { start: '10:20', end: '11:00' },
      }),
    ).toBe(2)
  })
})

/* ========== ② 三条护栏 ========== */

describe('改时间的三条护栏', () => {
  beforeEach(freshEnvironment)

  it('合法改动写盘，且立刻反映到 store 的 periods 上', async () => {
    const store = await freshStore()
    expect(store.updatePeriodTime('p2', { start: '09:30' })).toBe(true)
    const period = store.periods.find((item) => item.id === 'p2')!
    expect(period.startTime).toBe('09:30')
    // 只给了 start，end 保持原值（局部改不会把另一半清掉）
    expect(period.endTime).toBe('10:00')
    expect(store.periodOverrideCount).toBe(1)
  })

  it('下课早于上课：拒绝（那一节会永远判不出发生在什么时候）', async () => {
    const store = await freshStore()
    expect(store.updatePeriodTime('p3', { start: '11:10', end: '10:30' })).toBe(false)
    expect(store.periodOverrideCount).toBe(0)
  })

  it('形状不合法（`9:30`、`25:00`、空串）：拒绝', async () => {
    const store = await freshStore()
    for (const bad of ['9:30', '25:00', '09:60', '', '早上九点']) {
      expect(store.updatePeriodTime('p3', { start: bad })).toBe(false)
    }
    expect(store.periodOverrideCount).toBe(0)
  })

  it('与别的时段重叠：拒绝（否则同一时刻两节课都「正在进行」）', async () => {
    const store = await freshStore()
    // 第 3 节默认 10:30–11:10；把它拉到 09:50 起，就压住了第 2 节（09:20–10:00）
    expect(store.updatePeriodTime('p3', { start: '09:50' })).toBe(false)
    expect(store.periodOverrideCount).toBe(0)
  })

  it('**碰到边界不算重叠**：紧接前一节下课（10:00 起）是合法的', async () => {
    const store = await freshStore()
    expect(store.updatePeriodTime('p3', { start: '10:00' })).toBe(true)
    expect(store.periods.find((item) => item.id === 'p3')!.startTime).toBe('10:00')
  })

  it('认不出的时段 id：拒绝（不新建一节，也不静默丢弃）', async () => {
    const store = await freshStore()
    expect(store.updatePeriodTime('p99' as never, { start: '09:00' })).toBe(false)
    expect(store.periodOverrideCount).toBe(0)
  })

  it('恢复默认：覆盖清空，回到原始作息', async () => {
    const store = await freshStore()
    store.updatePeriodTime('p2', { start: '09:30' })
    store.resetPeriodTimes()
    expect(store.periodOverrideCount).toBe(0)
    expect(store.periods.find((item) => item.id === 'p2')!.startTime).toBe('09:20')
  })
})

/* ========== ③ 只存差异（盘上形状 + 健壮化） ========== */

describe('只存被改过的节（盘上形状）', () => {
  beforeEach(freshEnvironment)

  it('改一节只写这一节，其余九节不出现在盘上', async () => {
    const store = await freshStore()
    store.updatePeriodTime('p2', { start: '09:30' })
    // 写盘是 watch 驱动的（`syncPersisted`，默认 flush: 'pre'），比赋值晚一拍。
    // 这里要看的正是**盘上的形状**，所以必须等那一拍过去再读——读内存里的
    // `settings` 只能验「算对了」，验不了「存进去的是什么」。
    await nextTick()
    const [saved] = JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!) as [
      { teaching: { periodTimes: Record<string, unknown> } },
    ]
    expect(Object.keys(saved.teaching.periodTimes)).toEqual(['p2'])
  })

  it('盘上有坏的覆盖项（起点晚于终点 / 时间形状不对）：整条丢掉，回退默认', async () => {
    seedSettings({
      teaching: {
        seatDefaultView: 'teacher',
        periodTimes: {
          p2: { start: '10:00', end: '09:00' },
          p3: { start: '9:3', end: '11:10' },
        },
      },
    })
    const store = await freshStore()
    expect(store.periodOverrideCount).toBe(0)
    expect(store.periods.find((item) => item.id === 'p2')!.startTime).toBe('09:20')
  })

  it('盘上有好的覆盖项：原样读回（刷新后保持）', async () => {
    seedSettings({
      teaching: {
        seatDefaultView: 'teacher',
        periodTimes: { p2: { start: '09:30', end: '10:10' } },
      },
    })
    const store = await freshStore()
    expect(store.periods.find((item) => item.id === 'p2')!.startTime).toBe('09:30')
    expect(store.periodOverrideCount).toBe(1)
  })

  it('盘上完全没有 teaching 块（老版本写的）：回默认，不报错', async () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify([{ heroBackground: 'x' }]))
    const store = await freshStore()
    expect(store.periodOverrideCount).toBe(0)
    expect(store.seatDefaultView).toBe('teacher')
  })
})

/* ========== ④ 座位图默认视角 ========== */

describe('座位图默认视角', () => {
  beforeEach(freshEnvironment)

  it('默认是老师视角', async () => {
    const store = await freshStore()
    expect(store.seatDefaultView).toBe('teacher')
  })

  it('改成学生视角后落盘，重开一次仍是学生视角', async () => {
    const first = await freshStore()
    first.setSeatDefaultView('student')
    expect(first.seatDefaultView).toBe('student')

    // 重新装一个 store（= 刷新页面）：读到的是盘上那份
    vi.resetModules()
    setActivePinia(createPinia())
    const second = await freshStore()
    expect(second.seatDefaultView).toBe('student')
  })

  it('盘上是被写坏的字符串：回退老师视角（不把未知值当学生视角）', async () => {
    seedSettings({ teaching: { seatDefaultView: 'studentt', periodTimes: {} } })
    const store = await freshStore()
    expect(store.seatDefaultView).toBe('teacher')
  })
})
