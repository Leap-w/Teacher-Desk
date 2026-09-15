/**
 * 时光中心（v3.1.0）自检：时间的唯一容器。
 *
 * 三件事一起验，因为它们必须同时对：
 * ① **结构**——内置三项与自定义项合成一张列表，内置项的日期直接来自学期 / 支教字段
 *    （只有一份，不许在 `countdowns` 里再存一遍）；
 * ② **迁移**——v3.0.x 摊在 `settings` 最外层的三个日期与 `countdownTarget`
 *    折进 `timeCenter`，教师升级后不必重填；
 * ③ **首页选择**——`heroCountdownId` 永远指得着一个真实存在的项（自定义项被删了就回默认），
 *    首页 Hero 因此不会变空白。
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { DEFAULT_APP_SETTINGS } from '@/repositories/settings/appSettingsRepository'
import { listCountdowns, resolveHeroCountdown } from '@/utils/timeCenter'
import type { TimeCenter } from '@/types/appSettings'

const prefix = appConfig.storageKeyPrefix
const SETTINGS_KEY = `${prefix}:settings`
const COUNTDOWN_KEY = `${prefix}:countdown`

/** 造一份时光中心（只给关心的字段，其余用默认） */
function makeTimeCenter(patch: Partial<TimeCenter> = {}): TimeCenter {
  return { ...DEFAULT_APP_SETTINGS.timeCenter, ...patch }
}

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

/* ========== ① 列表结构 ========== */

describe('倒计时列表（内置三项 + 自定义）', () => {
  it('内置三项排在最前，日期直接来自三个日期字段（不另存一份）', () => {
    const timeCenter = makeTimeCenter({
      serviceStart: '2026-09-01',
      semesterStart: '2026-09-01',
      semesterEnd: '2027-01-24',
    })
    const list = listCountdowns(timeCenter)

    expect(list.map((item) => item.name)).toEqual(['距离期末', '距离开学', '距离出发'])
    expect(list.every((item) => item.builtin)).toBe(true)
    // 日期就是字段本身——改日期，列表立刻跟着变，不存在第二份
    expect(list[0]!.date).toBe('2027-01-24')
    expect(list[1]!.date).toBe('2026-09-01')
    expect(list[2]!.date).toBe('2026-09-01')
  })

  it('自定义项接在内置项之后，且不自带 builtin 标记', () => {
    const list = listCountdowns(
      makeTimeCenter({
        countdowns: [{ id: 'c-1', name: '距离国庆放假', date: '2026-10-01' }],
      }),
    )
    expect(list).toHaveLength(4)
    expect(list[3]).toMatchObject({
      id: 'c-1',
      name: '距离国庆放假',
      date: '2026-10-01',
      builtin: false,
    })
  })

  it('改学期日期，内置项日期当场跟着走（同一份事实）', () => {
    const before = listCountdowns(makeTimeCenter({ semesterEnd: '2027-01-24' }))
    const after = listCountdowns(makeTimeCenter({ semesterEnd: '2027-02-28' }))
    expect(before[0]!.date).toBe('2027-01-24')
    expect(after[0]!.date).toBe('2027-02-28')
  })
})

/* ========== 首页显示哪一项 ========== */

describe('首页倒计时解析', () => {
  it('按 heroCountdownId 取；内置与自定义一视同仁', () => {
    const timeCenter = makeTimeCenter({
      countdowns: [{ id: 'c-1', name: '距离国庆放假', date: '2026-10-01' }],
      heroCountdownId: 'c-1',
    })
    expect(resolveHeroCountdown(timeCenter).name).toBe('距离国庆放假')

    expect(resolveHeroCountdown(makeTimeCenter({ heroCountdownId: 'serviceStart' })).name).toBe(
      '距离出发',
    )
  })

  it('heroCountdownId 悬空（自定义项没了）时回内置默认，绝不返回空', () => {
    const orphan = makeTimeCenter({ countdowns: [], heroCountdownId: 'c-已删除' })
    const resolved = resolveHeroCountdown(orphan)
    expect(resolved.id).toBe('semesterEnd')
    expect(resolved.name).toBe('距离期末')
  })
})

/* ========== ② 迁移 ========== */

describe('设置迁移（v3.0.x 扁平结构 → timeCenter）', () => {
  beforeEach(freshEnvironment)

  it('盘上还是老结构时，三个日期与 countdownTarget 全部折进 timeCenter', async () => {
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify([
        {
          heroBackground: 'https://example.com/a.jpg',
          heroTitle: '距离期末考试',
          heroSubtitle: '支教一年的高原记录',
          semesterStart: '2026-08-25',
          semesterEnd: '2027-01-10',
          serviceStart: '2026-08-20',
          countdownTarget: 'serviceStart',
          defaultHomeView: '/students',
          showProgress: false,
        },
      ]),
    )
    const { appSettingsRepository } = await import('@/repositories/settings/appSettingsRepository')
    const settings = appSettingsRepository.readSettings()

    expect(settings.timeCenter.semesterStart).toBe('2026-08-25')
    expect(settings.timeCenter.semesterEnd).toBe('2027-01-10')
    expect(settings.timeCenter.serviceStart).toBe('2026-08-20')
    // 旧的 countdownTarget 就是新的 heroCountdownId（取值空间完全一致）
    expect(settings.timeCenter.heroCountdownId).toBe('serviceStart')
    // 外观字段一并留下
    expect(settings.heroSubtitle).toBe('支教一年的高原记录')
    expect(settings.showProgress).toBe(false)
    // 已撤下的字段不再出现在结果里
    expect('defaultHomeView' in settings).toBe(false)
    expect('heroTitle' in settings).toBe(false)
  })

  it('悬空的 heroCountdownId 在读取时就被拉回默认（不留一个指不着的新选择）', async () => {
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify([{ timeCenter: { heroCountdownId: 'c-不存在' } }]),
    )
    const { appSettingsRepository } = await import('@/repositories/settings/appSettingsRepository')
    expect(appSettingsRepository.readSettings().timeCenter.heroCountdownId).toBe('semesterEnd')
  })

  it('自定义列表：坏的整项丢掉（缺 id / 缺名称 / 日期不合法 / id 重复）', async () => {
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify([
        {
          timeCenter: {
            countdowns: [
              { id: 'c-1', name: '好的', date: '2026-10-01' },
              { id: '', name: '缺 id', date: '2026-10-01' },
              { id: 'c-2', name: '   ', date: '2026-10-01' },
              { id: 'c-3', name: '日期不合法', date: '2026/10/01' },
              { id: 'c-1', name: '重复 id', date: '2026-11-01' },
              '不是对象',
            ],
          },
        },
      ]),
    )
    const { appSettingsRepository } = await import('@/repositories/settings/appSettingsRepository')
    const countdowns = appSettingsRepository.readSettings().timeCenter.countdowns
    expect(countdowns).toEqual([{ id: 'c-1', name: '好的', date: '2026-10-01' }])
  })

  it('旧键 teacherdesk:countdown 仍然能迁进来（V1.3.1 的设备升级两次也不丢）', async () => {
    window.localStorage.setItem(
      COUNTDOWN_KEY,
      JSON.stringify({ startDate: '2026-08-01', targetDate: '2027-01-05' }),
    )
    const { appSettingsRepository } = await import('@/repositories/settings/appSettingsRepository')
    const settings = appSettingsRepository.readSettings()
    expect(settings.timeCenter.semesterStart).toBe('2026-08-01')
    expect(settings.timeCenter.semesterEnd).toBe('2027-01-05')
  })
})

/* ========== ③ Store 的读写 ========== */

describe('时光中心 store：自定义倒计时的增删改', () => {
  beforeEach(freshEnvironment)

  it('新建一项会直接设为首页显示', async () => {
    const store = await freshStore()
    const created = store.addCountdown('距离国庆放假', '2026-10-01')
    expect(created).not.toBeNull()
    expect(store.timeCenter.countdowns).toHaveLength(1)
    expect(store.timeCenter.heroCountdownId).toBe(created!.id)
    expect(store.countdownTitle).toBe('距离国庆放假')
  })

  it('名称空或日期不合法时拒绝新建（不写半条记录进盘）', async () => {
    const store = await freshStore()
    expect(store.addCountdown('   ', '2026-10-01')).toBeNull()
    expect(store.addCountdown('国庆', '2026/10/01')).toBeNull()
    expect(store.timeCenter.countdowns).toHaveLength(0)
  })

  it('内置三项不能改、不能删', async () => {
    const store = await freshStore()
    expect(store.updateCountdown('semesterEnd', { name: '改名试试' })).toBe(false)
    expect(store.removeCountdown('semesterEnd')).toBe(false)
    expect(store.heroCountdown.name).toBe('距离期末')
  })

  it('改自定义项的名称与日期，首页那行字跟着变', async () => {
    const store = await freshStore()
    const created = store.addCountdown('距离国庆放假', '2026-10-01')!
    expect(store.updateCountdown(created.id, { name: '距离放假', date: '2026-10-05' })).toBe(true)
    expect(store.countdownEntries.find((item) => item.id === created.id)).toMatchObject({
      name: '距离放假',
      date: '2026-10-05',
    })
    expect(store.countdownTitle).toBe('距离放假')
  })

  it('删掉首页那一项时，首页显示拉回内置默认（不留悬空选择）', async () => {
    const store = await freshStore()
    const created = store.addCountdown('距离国庆放假', '2026-10-01')!
    expect(store.timeCenter.heroCountdownId).toBe(created.id)

    expect(store.removeCountdown(created.id)).toBe(true)
    expect(store.timeCenter.countdowns).toHaveLength(0)
    expect(store.timeCenter.heroCountdownId).toBe('semesterEnd')
    expect(store.heroCountdown.name).toBe('距离期末')
  })

  it('删掉不是首页那一项时，首页显示不动', async () => {
    const store = await freshStore()
    const first = store.addCountdown('第一个', '2026-10-01')!
    const second = store.addCountdown('第二个', '2026-11-01')!
    expect(store.timeCenter.heroCountdownId).toBe(second.id)

    expect(store.removeCountdown(first.id)).toBe(true)
    expect(store.timeCenter.heroCountdownId).toBe(second.id)
  })

  it('setHeroCountdown：内置项也能选；认不出的 id 拒绝', async () => {
    const store = await freshStore()
    expect(store.setHeroCountdown('serviceStart')).toBe(true)
    expect(store.heroCountdown.name).toBe('距离出发')
    expect(store.setHeroCountdown('c-不存在')).toBe(false)
    expect(store.heroCountdown.name).toBe('距离出发')
  })

  it('写入落盘：刷新一次仍在（键里存单元素数组）', async () => {
    const store = await freshStore()
    store.addCountdown('距离国庆放假', '2026-10-01')
    await Promise.resolve()

    const raw = window.localStorage.getItem(SETTINGS_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as unknown[]
    expect(Array.isArray(parsed)).toBe(true)
    const timeCenter = (parsed[0] as { timeCenter: TimeCenter }).timeCenter
    expect(timeCenter.countdowns).toHaveLength(1)
    expect(timeCenter.countdowns[0]!.name).toBe('距离国庆放假')
  })

  it('首页天数与列表同一算法：daysUntil 给出的就是卡片上那个数', async () => {
    const store = await freshStore()
    const created = store.addCountdown('今天', todayISO())!
    expect(store.daysUntil(created.date)).toBe(0)
    expect(store.countdownMagnitude).toBe(0)
    expect(store.countdownIsPast).toBe(false)
  })
})

/** 今天的 `YYYY-MM-DD`（本地日历日） */
function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
