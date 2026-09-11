/**
 * 云端同步的队列与首次同步保护（Phase 9C §七 / §八）。
 *
 * 这里测的是**数据安全**，不是界面：断网期间改成的东西会不会丢、网回来了会不会自己补上、
 * 刷新之后待同步的部分还在不在、第一次在某台设备上登录会不会把本机那份真实数据静默换掉。
 *
 * 三条自检纪律（§七）：
 * - **不连真 CloudBase**：`@/services/cloudbase` 整个换成内存假云端（`vi.mock`），
 *   真 SDK、真账号、真集合一个都不碰（§十五）；
 * - **时间可控**：vitest 的假时钟，时刻由用例显式推进——「最后写入胜出」这类判定
 *   靠真实时钟去等会变成随机结果；
 * - **触发时机手动驱动**：去抖窗口由用例推进，不真的等 1.5 秒（慢测试 + 随机失败）。
 *
 * 本文件不断言 UI 文案（那是 `composables/useCloudSync.ts` 的 surface），只断言
 * 「盘上是什么、云端是什么、记账里记了什么」——出事时能直接指出坏的是哪一条不变量。
 */
import { ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { readRaw } from '@/services/storage'

/**
 * 内存假云端。**在 `vi.mock` 之前建好**（`vi.hoisted`），因为 mock 工厂要用它——
 * 工厂是在模块图里跑起来的，普通顶层变量那时还没初始化。
 * 它是跨 `vi.resetModules()` 存活的：模块重载模拟「刷新」，而云端当然不会跟着刷新。
 */
const cloud = vi.hoisted(() => ({
  configured: true,
  signedIn: false,
  docs: new Map<string, { key: string; payload: unknown[]; updatedAt: number }>(),
  /** 让下一轮 `pull` / `push` 抛这个错（扮演断网、被拒） */
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
/** 一个存储键＝一份云端文档（同步的粒度，见 services/remote.ts） */
const KEY = `${prefix}:students`
const META_KEY = `${prefix}:cloud:meta`

/** 假时钟的起点：所有时刻都由这里推出去，判定里不会出现「恰好现在」 */
const T0 = 1_700_000_000_000

const LOCAL_LIST = [{ id: 'a' }]
const LOCAL_TEXT = JSON.stringify(LOCAL_LIST)
const LATER_LIST = [{ id: 'a' }, { id: 'b' }]
const LATER_TEXT = JSON.stringify(LATER_LIST)

/** 教师自己录的学生（字段形状与 normalizeStudent 一致，读回来不会被改写） */
const LOCAL_STUDENTS = JSON.stringify([
  { id: 'local-1', name: '本机的学生', studentNo: '0002', familyAddress: '' },
])
const REMOTE_STUDENTS: unknown[] = [
  { id: 'remote-1', name: '云端的学生', studentNo: '0001', familyAddress: '' },
]

let browser: FakeBrowser

interface MetaEntry {
  seen: string | null
  syncedAt: number
  localUpdatedAt: number
}

/** 盘上的对齐记账（从盘上读，不经过被测模块的内存状态） */
function diskMeta(): Record<string, MetaEntry> {
  const raw = readRaw(META_KEY)
  return raw === null ? {} : (JSON.parse(raw) as Record<string, MetaEntry>)
}

/** 盘上塞一份原文（扮演「这个键此前写过的内容」），不经过存储层，也就不触发任何写盘登记 */
function seedDisk(key: string, text: string): void {
  browser.localStorage.seed(key, text)
}

/** 把一个键接进同步（与八个 store 用的是同一个 `syncPersisted`），返回它内存里那份 */
async function registerKey(key: string, initial: unknown[] = []): Promise<Ref<unknown[]>> {
  const sync = await import('@/services/sync')
  const source = ref<unknown[]>(initial)
  sync.syncPersisted(key, source, (raw) => raw)
  return source
}

/** 把挂起的微任务跑干净：同步链里几处 `await`（nextTick / 归一化写盘）不是定时器 */
async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

/**
 * 推进去抖窗口，让**自动触发**（启动 / 联网 / 回到前台）排下的那一轮真的跑起来。
 * 不直接调 `syncNow()`：那样测的就不是「网回来了自己补上」这条路径了。
 */
async function settleScheduled(): Promise<void> {
  const { SYNC_DEBOUNCE_MS } = await import('@/services/cloudSync')
  await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS + 100)
  await flushMicrotasks()
}

/**
 * 装上本次模块图里的 Pinia。
 *
 * 必须**动态** import：用例之间会 `vi.resetModules()` 模拟刷新，而「当前 Pinia 实例」记在
 * pinia 自己的模块作用域里——用文件顶部静态 import 的那一份去激活，之后动态 import 进来的
 * store 看到的是另一个模块实例，会直接报「没有 activePinia」。
 */
async function installFreshPinia(): Promise<void> {
  const pinia = await import('pinia')
  pinia.setActivePinia(pinia.createPinia())
}

beforeEach(async () => {
  browser = installFakeBrowser()
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  vi.resetModules()
  await installFreshPinia()

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

describe('断网与恢复：本地磁盘就是待发队列（§七）', () => {
  it('断网时同步跑不动：本机数据一字未动，云端没收到，也不记「已对齐」', async () => {
    cloud.signedIn = true
    browser.setOnline(false)
    cloud.pullError = new Error('Failed to fetch')
    seedDisk(KEY, LOCAL_TEXT)
    await registerKey(KEY, LOCAL_LIST)

    const { cloudSyncState, syncNow } = await import('@/services/cloudSync')
    await syncNow()

    expect(cloudSyncState.value.status).toBe('offline')
    // 盘上这份是教师唯一的一份：一个字节都不能动
    expect(readRaw(KEY)).toBe(LOCAL_TEXT)
    expect(cloud.pushes).toEqual([])
    // 记账里没有这个键 ＝ 下一轮还会把它带上；记了就会把这次失败当成「已同步」
    expect(diskMeta()).toEqual({})
  })

  it('连上了但被拒（权限 / 集合不存在）：报「错误」而不是「连不上」，本机同样不动', async () => {
    cloud.signedIn = true
    cloud.pullError = new Error('permission denied')
    seedDisk(KEY, LOCAL_TEXT)
    await registerKey(KEY, LOCAL_LIST)

    const { cloudSyncState, syncNow } = await import('@/services/cloudSync')
    await syncNow()

    // 「连不上」会自己好，「被拒」要教师去处理——两者混成一个，教师就会一直等它自己恢复
    expect(cloudSyncState.value.status).toBe('error')
    expect(cloudSyncState.value.error).toContain('permission denied')
    expect(readRaw(KEY)).toBe(LOCAL_TEXT)
    expect(diskMeta()).toEqual({})
  })

  it('网络回来：自动补发积压，并把这份原文记进对齐记账', async () => {
    cloud.signedIn = true
    browser.setOnline(false)
    cloud.pullError = new Error('Failed to fetch')
    seedDisk(KEY, LOCAL_TEXT)
    await registerKey(KEY, LOCAL_LIST)

    const { cloudSyncState, startCloudSync } = await import('@/services/cloudSync')
    startCloudSync()
    await settleScheduled()
    // 启动那一轮跑过了，也确实因为断网失败了（不是「压根没跑」）
    expect(cloud.pulls).toBe(1)
    expect(cloudSyncState.value.status).toBe('offline')
    expect(cloud.docs.has(KEY)).toBe(false)

    cloud.pullError = null
    browser.setOnline(true)
    await settleScheduled()

    // `online` 事件自己排的那一轮把它补上了（没有谁去点「立即同步」）
    expect(cloud.pulls).toBe(2)
    expect(cloudSyncState.value.status).toBe('idle')
    expect(cloud.docs.get(KEY)?.payload).toEqual(LOCAL_LIST)
    // 记账记的是**盘上那份原文**：下一轮据此认出「这份已经对齐过」，不会重复推
    expect(diskMeta()[KEY]?.seen).toBe(LOCAL_TEXT)
  })

  it('刷新（模块重载）之后：盘上的改动与记账都还在，下一轮补上，且不重推', async () => {
    cloud.signedIn = true
    seedDisk(KEY, LOCAL_TEXT)
    await registerKey(KEY, LOCAL_LIST)

    const first = await import('@/services/cloudSync')
    await first.syncNow()
    expect(cloud.docs.get(KEY)?.payload).toEqual(LOCAL_LIST)
    const pushesAfterFirst = cloud.pushes.length

    // 教师又改了一份，这一轮同步还没跑起来就刷新了（关标签页 / 断电都算）
    vi.setSystemTime(T0 + 60_000)
    seedDisk(KEY, LATER_TEXT)

    vi.resetModules() // ← 刷新
    await registerKey(KEY, LATER_LIST) // 刷新后 store 重新接进同步
    const second = await import('@/services/cloudSync')
    await second.syncNow()

    // 「待同步」这件事存在盘上（原文 + 记账的差），不靠内存里的队列：刷新不会把它弄丢
    expect(cloud.docs.get(KEY)?.payload).toEqual(LATER_LIST)
    expect(diskMeta()[KEY]?.seen).toBe(LATER_TEXT)
    expect(cloud.pushes.length).toBe(pushesAfterFirst + 1)

    await second.syncNow()
    // 已经对齐过就不再推：每开一次应用都重推一遍会让两台设备之间多出无谓的写入
    expect(cloud.pushes.length).toBe(pushesAfterFirst + 1)
  })

  it('云端那份不在了（被误删 / 从没同步过）时：不当成删除指令，本机这份原样留着', async () => {
    cloud.signedIn = true
    seedDisk(KEY, LOCAL_TEXT)
    // 记账说「这份已与云端对齐过」，而本地此后一个字没改
    seedDisk(
      META_KEY,
      JSON.stringify({ [KEY]: { seen: LOCAL_TEXT, syncedAt: T0, localUpdatedAt: T0 } }),
    )
    await registerKey(KEY, LOCAL_LIST)

    const { cloudSyncState, syncNow } = await import('@/services/cloudSync')
    await syncNow()

    expect(readRaw(KEY)).toBe(LOCAL_TEXT)
    // 也不因此把它重新推上去：两边都没变，什么都不该发生
    expect(cloud.pushes).toEqual([])
    expect(cloudSyncState.value.status).toBe('idle')
  })
})

describe('首次同步：本机有真实数据时不静默覆盖（§八）', () => {
  /** 载入学生档案 store（真实 store：口径与首屏加载完全一致） */
  async function loadStudents() {
    const { useStudentStore } = await import('@/stores/student')
    return useStudentStore()
  }

  it('新设备装上就登录：本机只有播种的示例数据 → 以云端为准，示例不推上去', async () => {
    cloud.signedIn = true
    const store = await loadStudents()
    // 首次打开学生档案 → 播种示例数据，并记下播种基线（判定「本机有没有真实数据」靠它）
    expect(store.students.length).toBeGreaterThan(0)

    cloud.docs.set(KEY, { key: KEY, payload: REMOTE_STUDENTS, updatedAt: T0 })

    const { syncNow } = await import('@/services/cloudSync')
    await syncNow()

    expect(store.students.map((item) => item.id)).toEqual(['remote-1'])
    expect(JSON.parse(readRaw(KEY) ?? 'null')).toEqual(REMOTE_STUDENTS)
    // 示例数据没有被当成「本机的数据」推上去盖掉云端那份
    expect(cloud.pushes).toEqual([])
    // 记账里的 seen 就是盘上那份原文（两者不一致的话下一轮会把这次采纳当成本地改动再推一次）
    expect(diskMeta()[KEY]?.seen).toBe(readRaw(KEY))
  })

  it('本机已录入数据、云端也有 → 两边一字未动，只报出待裁决的键', async () => {
    cloud.signedIn = true
    seedDisk(KEY, LOCAL_STUDENTS)
    const store = await loadStudents()
    cloud.docs.set(KEY, { key: KEY, payload: REMOTE_STUDENTS, updatedAt: T0 })

    const { cloudSyncState, syncNow } = await import('@/services/cloudSync')
    await syncNow()

    // 报出来，等教师裁决——这是 Phase 9C 收紧的那一条（9B 时这里直接采纳云端）
    expect(cloudSyncState.value.conflicts).toEqual([KEY])
    // 本机这份（盘上 + 内存）与云端那份都原样留着：丢哪一份都不是同步能替教师做的决定
    expect(readRaw(KEY)).toBe(LOCAL_STUDENTS)
    expect(store.students.map((item) => item.id)).toEqual(['local-1'])
    expect(cloud.docs.get(KEY)?.payload).toEqual(REMOTE_STUDENTS)
    expect(cloud.pushes).toEqual([])
    // 冲突不是「同步失败」：其余键照常同步，通不通由 status 说
    expect(cloudSyncState.value.status).toBe('idle')
  })

  it('教师选「保留本机数据」→ 本机这份推上云，冲突消解且不复发', async () => {
    cloud.signedIn = true
    seedDisk(KEY, LOCAL_STUDENTS)
    await loadStudents()
    cloud.docs.set(KEY, { key: KEY, payload: REMOTE_STUDENTS, updatedAt: T0 })

    const { cloudSyncState, resolveConflicts, syncNow } = await import('@/services/cloudSync')
    await syncNow()
    expect(cloudSyncState.value.conflicts).toEqual([KEY])

    vi.setSystemTime(T0 + 60_000)
    await resolveConflicts('local')

    expect(cloud.docs.get(KEY)?.payload).toEqual(JSON.parse(LOCAL_STUDENTS))
    expect(readRaw(KEY)).toBe(LOCAL_STUDENTS)
    expect(cloudSyncState.value.conflicts).toEqual([])
    expect(diskMeta()[KEY]?.seen).toBe(LOCAL_STUDENTS)

    // 处置过就算对齐了：下一轮不再把它报成冲突，也不再重复推
    const pushesAfter = cloud.pushes.length
    await syncNow()
    expect(cloudSyncState.value.conflicts).toEqual([])
    expect(cloud.pushes.length).toBe(pushesAfter)
  })

  it('教师选「保留云端数据」→ 本机盘上与内存都换成云端那份，且不上传', async () => {
    cloud.signedIn = true
    seedDisk(KEY, LOCAL_STUDENTS)
    const store = await loadStudents()
    cloud.docs.set(KEY, { key: KEY, payload: REMOTE_STUDENTS, updatedAt: T0 })

    const { cloudSyncState, resolveConflicts, syncNow } = await import('@/services/cloudSync')
    await syncNow()
    expect(cloudSyncState.value.conflicts).toEqual([KEY])
    const pushesAfter = cloud.pushes.length

    await resolveConflicts('remote')

    expect(JSON.parse(readRaw(KEY) ?? 'null')).toEqual(REMOTE_STUDENTS)
    expect(store.students.map((item) => item.id)).toEqual(['remote-1'])
    expect(cloudSyncState.value.conflicts).toEqual([])
    expect(diskMeta()[KEY]?.seen).toBe(readRaw(KEY))
    // 采纳不上传：采纳之后又推一轮会让另一台设备上的同一次冲突白问一遍
    expect(cloud.pushes.length).toBe(pushesAfter)
  })

  it('云端没有这个键 → 首次同步照常把本机这份推上去（不是冲突）', async () => {
    cloud.signedIn = true
    seedDisk(KEY, LOCAL_STUDENTS)
    await loadStudents()

    const { cloudSyncState, syncNow } = await import('@/services/cloudSync')
    await syncNow()

    expect(cloud.docs.get(KEY)?.payload).toEqual(JSON.parse(LOCAL_STUDENTS))
    expect(cloudSyncState.value.conflicts).toEqual([])
    expect(readRaw(KEY)).toBe(LOCAL_STUDENTS)
  })
})
