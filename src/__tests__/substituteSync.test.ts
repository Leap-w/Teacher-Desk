/**
 * v3.7.5 §6.6「云端同步后数据一致」自检（代课台账那一份）。
 *
 * 三条要守住的事：
 *  ① **登记之后云端拿到的就是盘上那份**（同一份 JSON：id / createdAt / 备注全都带着），
 *     换一台设备打开时读回来的是同一批记录；
 *  ② **新设备（本机还没有这个键）以云端为准**：重装 / 换机登录后不是空台账，
 *     也不会把「本机没有」当成「云端那份被删了」；
 *  ③ **只推代课这一个键**：改台账不带动课程表——隔离（§6.3）在同步层同样成立。
 *
 * **不连真 CloudBase**：`@/services/cloudbase` 整个换成内存假云端（同 cloudSync.test.ts 的
 * 既有纪律）。因此这里验的是**同步链路**，不是真实云端环境——真实云端的验证范围见交付报告。
 */
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'

/**
 * 内存假云端。**在 `vi.mock` 之前建好**（`vi.hoisted`）：mock 工厂是在模块图里跑起来的，
 * 普通顶层变量那时还没初始化。它跨 `vi.resetModules()` 存活（模拟「刷新」）。
 */
const cloud = vi.hoisted(() => ({
  configured: true,
  signedIn: false,
  docs: new Map<string, { key: string; payload: unknown[]; updatedAt: number }>(),
  pulls: 0,
  pushes: [] as { key: string; payload: unknown[]; updatedAt: number }[],
}))

vi.mock('@/services/cloudbase', () => ({
  isCloudConfigured: () => cloud.configured,
  currentUser: async () => (cloud.signedIn ? { uid: 'u-1', username: 'teacher' } : null),
  createCloudBaseRemote: () => ({
    pull: async () => {
      cloud.pulls += 1
      return [...cloud.docs.values()].map((doc) => ({ ...doc }))
    },
    push: async (doc: { key: string; payload: unknown[]; updatedAt: number }) => {
      cloud.pushes.push({ ...doc })
      cloud.docs.set(doc.key, { ...doc })
    },
    remove: async (key: string) => {
      cloud.docs.delete(key)
    },
  }),
  signInWithUsername: async () => {
    cloud.signedIn = true
  },
  signOutCloud: async () => {
    cloud.signedIn = false
  },
}))

const prefix = appConfig.storageKeyPrefix
/** 一个存储键＝一份云端文档（同步的粒度，见 services/remote.ts） */
const SUBSTITUTES_KEY = `${prefix}:substitutes`
const LESSONS_KEY = `${prefix}:timetable`
const EXCHANGES_KEY = `${prefix}:timetable:exchanges`

/** 假时钟的起点：所有时刻都由这里推出去，判定里不会出现「恰好现在」 */
const T0 = 1_700_000_000_000

/** 另一台设备登记过的一条代课（形状与真实记录一致，读回来不会被规范化改写） */
const REMOTE_RECORD = {
  id: 'remote-sub-1',
  date: '2026-10-15',
  periodId: 'p2',
  originalTeacher: '李老师',
  substituteTeacher: '王老师',
  subject: '数学',
  remark: '原教师病假',
  createdAt: '2026-10-15T01:00:00.000Z',
}

let browser: FakeBrowser

/** 装上本次模块图里的 Pinia（必须动态 import：用例之间会 resetModules，见 cloudSync.test.ts） */
async function installFreshPinia(): Promise<void> {
  const pinia = await import('pinia')
  pinia.setActivePinia(pinia.createPinia())
}

async function loadSubstitutes() {
  const { useSubstituteStore } = await import('@/stores/substitute')
  return useSubstituteStore()
}

beforeEach(async () => {
  browser = installFakeBrowser()
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  vi.resetModules()
  await installFreshPinia()

  cloud.docs.clear()
  cloud.pushes.length = 0
  cloud.pulls = 0
  cloud.configured = true
  cloud.signedIn = true
})

afterEach(() => {
  vi.useRealTimers()
})

describe('§6.6 代课台账的云端往返', () => {
  it('本机登记的记录推上云：云端那份与盘上那份逐字段一致', async () => {
    const store = await loadSubstitutes()
    const created = store.add({
      date: '2026-10-12',
      periodId: 'p3',
      originalTeacher: '李老师',
      substituteTeacher: '王老师',
      subject: '数学',
      remark: '原教师病假',
    })!
    await nextTick()

    const { syncNow } = await import('@/services/cloudSync')
    await syncNow()

    const remote = cloud.docs.get(SUBSTITUTES_KEY)
    expect(remote?.payload).toEqual(JSON.parse(browser.localStorage.getItem(SUBSTITUTES_KEY)!))
    expect(remote?.payload).toEqual([created])
  })

  it('新设备（本机还没有这个键）→ 采纳云端台账，不覆盖、不报冲突', async () => {
    cloud.docs.set(SUBSTITUTES_KEY, {
      key: SUBSTITUTES_KEY,
      payload: [REMOTE_RECORD],
      updatedAt: T0 + 1_000,
    })

    const store = await loadSubstitutes()
    expect(store.count).toBe(0) // 本机确实还没有台账

    const { cloudSyncState, syncNow } = await import('@/services/cloudSync')
    await syncNow()
    await nextTick()

    // 内存与盘上都是云端那份，且没有把「本机为空」推上去盖掉它
    expect(store.records).toEqual([REMOTE_RECORD])
    expect(browser.localStorage.getItem(SUBSTITUTES_KEY)).toBe(JSON.stringify([REMOTE_RECORD]))
    expect(cloud.pushes.map((push) => push.key)).not.toContain(SUBSTITUTES_KEY)
    expect(cloudSyncState.value.conflicts).toEqual([])
  })

  it('只推代课这一个键：改台账不动课程表那份文档', async () => {
    // 两份键都先落定（课表也接进同步，代表「另一个模块」）
    browser.localStorage.seed(LESSONS_KEY, JSON.stringify([]))
    browser.localStorage.seed(EXCHANGES_KEY, JSON.stringify([]))
    const { useTimetableStore } = await import('@/stores/timetable')
    useTimetableStore()
    const store = await loadSubstitutes()

    const { syncNow } = await import('@/services/cloudSync')
    await syncNow()
    const lessonsDoc = cloud.docs.get(LESSONS_KEY)
    cloud.pushes.length = 0

    store.add({
      date: '2026-10-13',
      periodId: 'p5',
      originalTeacher: '张老师',
      substituteTeacher: '赵老师',
      subject: '英语',
    })
    await nextTick()
    await syncNow()

    expect(cloud.pushes.map((push) => push.key)).toEqual([SUBSTITUTES_KEY])
    expect(cloud.docs.get(LESSONS_KEY)).toEqual(lessonsDoc)
  })
})
