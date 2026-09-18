/**
 * 写盘快通道 · 单键对齐（v3.4.1）。
 *
 * 这一份是**两个真事故的回归自检**，它们都出在同一条路上：同步引擎把脏键交给
 * `CloudTransport.push` 之后，通道以前是「读本机原文 → 直接 set 上云」，不拉、不比对，
 * 于是绕过了 `decideKey` 里全部的保护（播种基线 / 首次同步冲突 / 最后写入胜出）：
 *
 * ① **播种数据盖掉云端真实数据**：本机这个键缺失时（换设备 / 清过数据 / iOS 的 Safari
 *    与主屏 PWA 是两个存储分区），store 一被打开就播种示例数据，注册触发的脏事件经快通道
 *    把示例推上云。线上 `teacherdesk:seatPlans` 就是这样变成一份空的「开学初」的。
 * ② **待裁决的冲突被静默抹掉**：某个键已经判成「需要确认」，教师在本机一改，快通道照样
 *    把本机那份推上去，云端那份在教师按下裁决之前就没了。
 *
 * 现在快通道与整轮对账共用同一个 `decideKey`：推 / 采纳 / 报冲突都由裁决说了算，
 * 拉不到云端就不推。这一份把这几条钉住。
 *
 * 纪律与 `cloudTransport.test.ts` 同源：不连真 CloudBase（`@/services/cloudbase`
 * 换成内存假云端）、时间可控（假时钟）、断言看盘上与云端的事实而不是内存对象。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { readRaw, writeSeedJSON } from '@/services/storage'

const cloud = vi.hoisted(() => ({
  configured: true,
  signedIn: false,
  docs: new Map<string, { key: string; payload: unknown[]; updatedAt: number }>(),
  pullError: null as Error | null,
  pushError: null as Error | null,
  pulls: 0,
  pushes: [] as { key: string; payload: unknown[]; updatedAt: number }[],
}))

vi.mock('@/services/cloudbase', () => ({
  isCloudConfigured: () => cloud.configured,
  currentUser: async () => (cloud.signedIn ? { uid: 'u-1', username: 'teacher' } : null),
  createCloudBaseRemote: () => ({
    pull: async () => {
      cloud.pulls += 1
      if (cloud.pullError) throw cloud.pullError
      return [...cloud.docs.values()].map((doc) => ({ ...doc }))
    },
    push: async (doc: { key: string; payload: unknown[]; updatedAt: number }) => {
      if (cloud.pushError) throw cloud.pushError
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
const SEAT_KEY = `${prefix}:seatPlans`
const KEY = `${prefix}:students`

const T0 = 1_800_000_000_000

/** 教师的真实方案（云端那份） */
const REAL_PLANS = [{ id: 'real-1', name: '期中调整后', isCurrent: true, seats: [] }]
/** 应用播种的示例方案（新设备一打开座位页就是这个） */
const SEED_PLANS = [{ id: 'seed-1', name: '开学初', isCurrent: true, seats: [] }]
const LOCAL_PLANS = [{ id: 'local-1', name: '本机自己排的', isCurrent: true, seats: [] }]
const EDITED_PLANS = [{ id: 'local-1', name: '本机自己排的（改过）', isCurrent: true, seats: [] }]
const LOCAL = JSON.stringify([{ id: 's-1', name: '本机学生', studentNo: '0002' }])
const NEWER = [{ id: 's-2', name: '另一台设备加的学生', studentNo: '0003' }]

let browser: FakeBrowser

/* ---------- 测试基建 ---------- */

function seedDisk(key: string, text: string): void {
  browser.localStorage.seed(key, text)
}

function diskOf(key: string): unknown[] {
  const raw = readRaw(key)
  return raw === null ? [] : (JSON.parse(raw) as unknown[])
}

/** 与 store 同一条注册路径：一个键接进同步 */
async function registerKey(key: string, initial: unknown[] = []): Promise<void> {
  const sync = await import('@/services/sync')
  const { ref } = await import('vue')
  sync.syncPersisted(key, ref<unknown[]>(initial), (raw) => raw)
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 25; index += 1) await Promise.resolve()
}

/** 已登录且会话就绪（checked + account 都由真实的同步流程产生） */
async function signInReady() {
  cloud.signedIn = true
  const { createCloudTransport } = await import('@/sync/CloudTransport')
  const transport = createCloudTransport()
  await transport.sync()
  await flushMicrotasks()
  return transport
}

/** 引擎队列里一个脏键的处置（生产里由 autoSync → SyncEngine.flush 走到这里） */
function pushTask(key: string) {
  return { id: 1, key, op: 'push' as const, enqueuedAt: T0, attempts: 0 }
}

function cloudPayload(key: string): unknown[] | undefined {
  return cloud.docs.get(key)?.payload
}

function cloudPushesOf(key: string): number {
  return cloud.pushes.filter((doc) => doc.key === key).length
}

beforeEach(async () => {
  browser = installFakeBrowser()
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  vi.resetModules()
  const pinia = await import('pinia')
  pinia.setActivePinia(pinia.createPinia())

  cloud.configured = true
  cloud.signedIn = false
  cloud.docs.clear()
  cloud.pullError = null
  cloud.pushError = null
  cloud.pulls = 0
  cloud.pushes = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('① 播种数据不得盖掉云端真实数据（线上事故的回归）', () => {
  it('本机缺这个键、云端有真实方案：打开座位页（播种 + 注册）不把示例推上云', async () => {
    // 云端：教师真正的座位方案（另一台设备用过的）
    cloud.docs.set(SEAT_KEY, { key: SEAT_KEY, payload: REAL_PLANS, updatedAt: T0 - 60_000 })
    // 会话先就绪：此刻座位 store 还没被打开，这个键没注册、盘上也没有——
    // 整轮对账因此看不见它（这正是事故现场的形状）
    const transport = await signInReady()

    // 教师之后才点进座位页：store 载入 → 播种示例方案（记下播种基线）→ 注册
    writeSeedJSON(SEAT_KEY, SEED_PLANS)
    await registerKey(SEAT_KEY, SEED_PLANS)

    // 注册触发的脏事件 → 引擎队列 → 快通道
    const outcome = await transport.push(pushTask(SEAT_KEY))

    expect(outcome.ok).toBe(true)
    expect(cloudPayload(SEAT_KEY)).toEqual(REAL_PLANS) // 云端一字未动
    expect(diskOf(SEAT_KEY)).toEqual(REAL_PLANS) // 本机换成云端那份
    expect(cloudPushesOf(SEAT_KEY)).toBe(0) // 播种的那份根本没上云
  })

  it('云端没有这个键时：本机播种的那份照推（新账号的第一份数据不能丢）', async () => {
    const transport = await signInReady()
    writeSeedJSON(SEAT_KEY, SEED_PLANS)
    await registerKey(SEAT_KEY, SEED_PLANS)

    const outcome = await transport.push(pushTask(SEAT_KEY))

    expect(outcome.ok).toBe(true)
    expect(cloudPayload(SEAT_KEY)).toEqual(SEED_PLANS)
  })
})

describe('② 待裁决的冲突不得被一次本地编辑静默抹掉', () => {
  it('判成「需要确认」之后教师改动本机：不推、云端仍在、冲突仍挂着', async () => {
    // 本机：教师自己排的方案；云端：另一台设备推的（两边都是真的）→ 首次同步判成冲突
    seedDisk(SEAT_KEY, JSON.stringify(LOCAL_PLANS))
    await registerKey(SEAT_KEY, LOCAL_PLANS)
    cloud.docs.set(SEAT_KEY, { key: SEAT_KEY, payload: REAL_PLANS, updatedAt: T0 - 60_000 })
    const transport = await signInReady()

    const { cloudSyncState } = await import('@/services/cloudSync')
    expect([...cloudSyncState.value.conflicts]).toContain(SEAT_KEY)

    // 教师没先裁决，继续在本机改了方案
    seedDisk(SEAT_KEY, JSON.stringify(EDITED_PLANS))
    const outcome = await transport.push(pushTask(SEAT_KEY))

    expect(outcome.ok).toBe(true)
    expect(cloudPayload(SEAT_KEY)).toEqual(REAL_PLANS) // 云端那份没被删
    expect(diskOf(SEAT_KEY)).toEqual(EDITED_PLANS) // 本机那份也没被换掉
    expect([...cloudSyncState.value.conflicts]).toContain(SEAT_KEY) // 冲突还等着教师
  })

  it('裁决之后（保留本机）照常推：冲突不会把改动永久扣在本机', async () => {
    seedDisk(SEAT_KEY, JSON.stringify(LOCAL_PLANS))
    await registerKey(SEAT_KEY, LOCAL_PLANS)
    cloud.docs.set(SEAT_KEY, { key: SEAT_KEY, payload: REAL_PLANS, updatedAt: T0 - 60_000 })
    await signInReady()

    const { resolveConflicts } = await import('@/services/cloudSync')
    await resolveConflicts('local')
    await flushMicrotasks()

    expect(cloudPayload(SEAT_KEY)).toEqual(LOCAL_PLANS)
  })
})

describe('③ 其余三条快通道口径', () => {
  it('云端更新过、本机没改：采纳云端，不把本机那份盖回去', async () => {
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))
    const transport = await signInReady() // 云端没有 → 推上去，两边对齐
    expect(cloudPayload(KEY)).toEqual(JSON.parse(LOCAL))

    // 另一台设备推了更新的版本
    cloud.docs.set(KEY, { key: KEY, payload: NEWER, updatedAt: T0 + 5000 })
    const outcome = await transport.push(pushTask(KEY))

    expect(outcome.ok).toBe(true)
    expect(cloudPayload(KEY)).toEqual(NEWER) // 云端那份没被本机的旧版盖掉
    expect(diskOf(KEY)).toEqual(NEWER) // 本机采纳
  })

  it('两边的确不一样时照推（快通道没被改瘸）', async () => {
    const transport = await signInReady()
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))

    const outcome = await transport.push(pushTask(KEY))

    expect(outcome.ok).toBe(true)
    expect(cloudPayload(KEY)).toEqual(JSON.parse(LOCAL))
  })

  it('拉不到云端就不推：不知道云端是什么，就不拿本机那份去盖（可重试）', async () => {
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))
    const transport = await signInReady()
    cloud.docs.delete(KEY) // 云端这份「看不见了」（下面让拉取直接失败）
    cloud.pullError = new Error('Failed to fetch')

    const outcome = await transport.push(pushTask(KEY))

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.retryable).toBe(true)
    expect(cloud.docs.has(KEY)).toBe(false) // 没有偷偷推上去
    expect(diskOf(KEY)).toEqual(JSON.parse(LOCAL)) // 本机那份原样留着
  })

  it('已经对齐、两边都没变：不再重复上传（省一次无谓的写入）', async () => {
    seedDisk(KEY, LOCAL)
    await registerKey(KEY, JSON.parse(LOCAL))
    const transport = await signInReady()
    const before = cloudPushesOf(KEY)

    const outcome = await transport.push(pushTask(KEY))

    expect(outcome.ok).toBe(true)
    expect(cloudPushesOf(KEY)).toBe(before)
  })
})
