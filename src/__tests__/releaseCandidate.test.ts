/**
 * Phase RC-1 发布候选验证（v2.3.1-rc）。
 *
 * 覆盖四条 P0 修复的可测部分：
 * - **RC-01 操作锁**：`OperationLock` 的嵌套 / 记账 / 解锁通知，以及锁住期间自动同步真的不推；
 * - **RC-02 导入后自动同步**：解锁即补推（含「队列空则什么都不做」这条安全边界）；
 * - **RC-03 防连点**：`canTrigger` / `canTriggerControl` 的窗口口径 + 组件确实调了它；
 * - **RC-04 后台恢复**：`elapsedSince` 用时间戳算，后台跨过整段时间也对得上。
 *
 * 三条纪律（与 `cloudTransport.test.ts` 同源）：不连真 CloudBase（`@/services/cloudbase`
 * 整个换成内存假云端）、时间可控（假时钟 + 显式推进）、断言从盘上/云端读而不是只信内存。
 */
import { ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import {
  CONTROL_DEBOUNCE_MS,
  DRAW_COOLDOWN_MS,
  PICK_ROLL_MS,
  canTrigger,
  canTriggerControl,
  elapsedSince,
} from '@/utils/classroom'

const cloud = vi.hoisted(() => ({
  configured: true,
  signedIn: false,
  docs: new Map<string, { key: string; payload: unknown[]; updatedAt: number }>(),
  pushes: [] as { key: string; payload: unknown[]; updatedAt: number }[],
}))

vi.mock('@/services/cloudbase', () => ({
  isCloudConfigured: () => cloud.configured,
  currentUser: async () =>
    cloud.signedIn ? { uid: 'u-1', username: 'teacher', email: 'teacher@example.com' } : null,
  createCloudBaseRemote: () => ({
    pull: async () => [...cloud.docs.values()].map((doc) => ({ ...doc })),
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
  signInWithEmail: async () => {
    cloud.signedIn = true
  },
  signOutCloud: async () => {
    cloud.signedIn = false
  },
}))

const prefix = appConfig.storageKeyPrefix
const KEY = `${prefix}:students`
const T0 = 1_800_000_000_000

let browser: FakeBrowser

/* ---------- 测试基建 ---------- */

async function installFreshPinia(): Promise<void> {
  const pinia = await import('pinia')
  pinia.setActivePinia(pinia.createPinia())
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 25; index += 1) await Promise.resolve()
}

/** 推进防抖窗口，让自动同步排下的那一轮真的跑起来 */
async function settleScheduled(): Promise<void> {
  const { SYNC_DEBOUNCE_MS } = await import('@/services/cloudSync')
  await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS + 200)
  await flushMicrotasks()
}

/** 与 store 同一条注册路径：一个键接进同步（返回可写的响应式源） */
async function registerKey(key: string, initial: unknown[] = []): Promise<Ref<unknown[]>> {
  const sync = await import('@/services/sync')
  const source = ref<unknown[]>(initial)
  sync.syncPersisted(key, source, (raw) => raw)
  return source
}

/** 已登录 + 会话已确认 + 自动同步已启动（走真实流程，不直接改内部状态） */
async function bootAutoSync(): Promise<void> {
  cloud.signedIn = true
  const { createCloudTransport } = await import('@/sync/CloudTransport')
  const transport = createCloudTransport()
  await transport.sync()
  await flushMicrotasks()

  const { startAutoSync } = await import('@/sync/autoSync')
  startAutoSync()
  await flushMicrotasks()
}

function pushesFor(key: string): number {
  return cloud.pushes.filter((doc) => doc.key === key).length
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
  cloud.pushes = []
})

afterEach(async () => {
  const { resetAutoSyncForTest } = await import('@/sync/autoSync')
  resetAutoSyncForTest()
  const { operationLock } = await import('@/sync/operationLock')
  operationLock.reset()
  vi.useRealTimers()
})

/* ==================== RC-01 操作锁（纯逻辑） ==================== */

describe('RC-01 · 统一操作锁', () => {
  async function newLock() {
    const { OperationLock } = await import('@/sync/operationLock')
    return new OperationLock()
  }

  it('1. 空闲时未锁，begin 后立刻上锁', async () => {
    const lock = await newLock()
    expect(lock.locked).toBe(false)
    lock.begin('seat-import')
    expect(lock.locked).toBe(true)
    expect(lock.names).toEqual(['seat-import'])
  })

  it('2. 同名重复 begin 按计数嵌套，第一个 end 不解锁', async () => {
    const lock = await newLock()
    expect(lock.begin('seat-import')).toBe(1)
    expect(lock.begin('seat-import')).toBe(2)
    expect(lock.end('seat-import')).toBe(false)
    expect(lock.locked).toBe(true)
    expect(lock.end('seat-import')).toBe(true)
    expect(lock.locked).toBe(false)
  })

  it('3. 不同名操作互相独立，最后一个 end 才解锁', async () => {
    const lock = await newLock()
    lock.begin('seat-import')
    lock.begin('student-batch')
    expect(lock.names).toEqual(['seat-import', 'student-batch'])
    expect(lock.end('seat-import')).toBe(false)
    expect(lock.locked).toBe(true)
    expect(lock.end('student-batch')).toBe(true)
  })

  it('4. 锁住时 deferKey 接管脏键（去重且保持首次出现顺序），未锁时交还给调用方', async () => {
    const lock = await newLock()
    expect(lock.deferKey(`${prefix}:students`)).toBe(false) // 未锁 → 走原来的快通道

    lock.begin('seat-import')
    expect(lock.deferKey(`${prefix}:seatPlans`)).toBe(true)
    expect(lock.deferKey(`${prefix}:students`)).toBe(true)
    expect(lock.deferKey(`${prefix}:seatPlans`)).toBe(true) // 重复不叠加
    expect(lock.deferredKeys).toEqual([`${prefix}:seatPlans`, `${prefix}:students`])
  })

  it('5. 完全解锁时把待补推键交给订阅者，并清空记账', async () => {
    const lock = await newLock()
    const seen: string[][] = []
    lock.onUnlock((keys) => seen.push(keys))

    lock.begin('seat-import')
    lock.deferKey(`${prefix}:seatPlans`)
    lock.end('seat-import')

    expect(seen).toEqual([[`${prefix}:seatPlans`]])
    expect(lock.deferredKeys).toEqual([])

    // 嵌套时第一次 end 不通知
    lock.begin('a')
    lock.begin('a')
    lock.deferKey('k1')
    lock.end('a')
    expect(seen).toHaveLength(1)
  })

  it('6. 对没锁过的名字 end 是幂等的：不抛错也不通知订阅者', async () => {
    const lock = await newLock()
    const seen: string[][] = []
    lock.onUnlock((keys) => seen.push(keys))
    expect(() => lock.end('never-began')).not.toThrow()
    expect(lock.locked).toBe(false)
    expect(seen).toEqual([])
  })

  it('7. reset 清空锁与订阅（用例之间不串味）', async () => {
    const lock = await newLock()
    lock.begin('seat-import')
    lock.deferKey('k')
    lock.reset()
    expect(lock.locked).toBe(false)
    expect(lock.deferredKeys).toEqual([])
    expect(lock.names).toEqual([])
  })
})

/* ==================== RC-01 / RC-02 与自动同步的接线 ==================== */

describe('RC-01 + RC-02 · 长事务与自动同步', () => {
  it('8. 上锁期间写盘不入队、不推云（导入中途不把半成品推上去）', async () => {
    await bootAutoSync()
    const source = await registerKey(KEY)
    // 注册时的首轮写盘先跑完，基线才是干净的（否则量的是注册那一笔）
    await settleScheduled()

    const { operationLock } = await import('@/sync/operationLock')
    const { syncEngine } = await import('@/sync')

    const baselinePushes = pushesFor(KEY)
    const baselinePending = syncEngine.pending
    operationLock.begin('seat-import')
    source.value = [{ id: 's-1', name: '导入中的学生' }]
    await flushMicrotasks()
    await settleScheduled()

    expect(pushesFor(KEY)).toBe(baselinePushes) // 一个字节都没上云
    expect(syncEngine.pending).toBe(baselinePending) // 也没新增入队——记账在锁里
    expect(operationLock.deferredKeys).toEqual([KEY])
    // 但本机已经真的写进去了：锁只挡同步，不挡写入
    expect(browser.localStorage.getItem(KEY)).toContain('导入中的学生')
  })

  it('9. 解锁即自动补推（RC-02：导入完成不需要教师手动同步）', async () => {
    await bootAutoSync()
    const source = await registerKey(KEY)
    await settleScheduled()

    const { operationLock } = await import('@/sync/operationLock')

    const baseline = pushesFor(KEY)
    operationLock.begin('seat-import')
    source.value = [{ id: 's-1', name: '导入完成的学生' }]
    await flushMicrotasks()
    expect(pushesFor(KEY)).toBe(baseline)

    operationLock.end('seat-import')
    await settleScheduled()

    expect(pushesFor(KEY)).toBe(baseline + 1)
    expect(cloud.docs.get(KEY)?.payload).toEqual([{ id: 's-1', name: '导入完成的学生' }])
  })

  it('10. 未登录时解锁不补推（本地模式没有云端可推，也不报错）', async () => {
    // 配了环境但没登录：脏键在入口就被 isCloudReady() 挡掉，走不到操作锁
    const { startAutoSync } = await import('@/sync/autoSync')
    startAutoSync()
    const source = await registerKey(KEY)
    const { syncEngine } = await import('@/sync')

    source.value = [{ id: 's-1' }]
    await flushMicrotasks()
    await settleScheduled()

    expect(cloud.pushes).toHaveLength(0)
    expect(syncEngine.pending).toBe(0)
  })

  it('11. 队列为空时 flushAfterOperation 什么都不做（本地模式不会被误标「已同步」）', async () => {
    const { syncEngine, flushAfterOperation } = await import('@/sync')
    const before = syncEngine.state
    const outcome = await flushAfterOperation()
    expect(outcome).toEqual({ succeeded: 0, failed: 0, remaining: 0 })
    expect(syncEngine.state).toBe(before)
  })

  it('12. runLockedOperation 返回 action 的结果并在结束后解锁', async () => {
    const { runLockedOperation } = await import('@/composables/useOperationLock')
    const { operationLock } = await import('@/sync/operationLock')

    const result = await runLockedOperation('seat-import', () => ({ ok: true, applied: 42 }))
    expect(result).toEqual({ ok: true, applied: 42 })
    expect(operationLock.locked).toBe(false)
  })

  it('13. action 抛错也一定解锁（不留死锁把自动同步永久停掉）', async () => {
    const { runLockedOperation } = await import('@/composables/useOperationLock')
    const { operationLock } = await import('@/sync/operationLock')

    await expect(
      runLockedOperation('seat-import', () => {
        throw new Error('导入写入失败')
      }),
    ).rejects.toThrow('导入写入失败')
    expect(operationLock.locked).toBe(false)
  })
})

/* ==================== RC-03 防连点 ==================== */

describe('RC-03 · 课堂工具防连点', () => {
  it('14. 从未触发过（null）允许触发，窗口内拒绝、到点恢复', () => {
    expect(canTrigger(null, T0)).toBe(true)
    expect(canTrigger(T0, T0 + DRAW_COOLDOWN_MS - 1)).toBe(false)
    expect(canTrigger(T0, T0 + DRAW_COOLDOWN_MS)).toBe(true)
    expect(canTrigger(T0, T0 + DRAW_COOLDOWN_MS + 500)).toBe(true)
  })

  it('15. 防连点窗口与滚动动画同长（动画期间禁止再次触发，动画结束恢复）', () => {
    expect(DRAW_COOLDOWN_MS).toBe(PICK_ROLL_MS)
    // 动画进行中（第 500ms）再点 → 拒绝；动画刚结束（第 1000ms）→ 可以再点
    expect(canTrigger(T0, T0 + Math.round(PICK_ROLL_MS / 2))).toBe(false)
    expect(canTrigger(T0, T0 + PICK_ROLL_MS)).toBe(true)
  })

  it('16. 计时器按钮防抖窗口比防连点短得多（300ms，双击不会读成「开始 → 暂停」）', () => {
    expect(CONTROL_DEBOUNCE_MS).toBeLessThan(DRAW_COOLDOWN_MS)
    expect(canTriggerControl(null, T0)).toBe(true)
    expect(canTriggerControl(T0, T0 + CONTROL_DEBOUNCE_MS - 1)).toBe(false)
    expect(canTriggerControl(T0, T0 + CONTROL_DEBOUNCE_MS)).toBe(true)
  })

  it('17. 防连点不改变抽取口径：窗口内的拒绝发生在调用方，抽取逻辑本身照旧可注入 rng', async () => {
    const { pickRandomGroup, pickRandom } = await import('@/utils/classroom')
    const groups = [
      { id: 'g1', name: '第1组', memberCount: 2 },
      { id: 'g2', name: '第2组', memberCount: 3 },
    ]
    expect(pickRandomGroup(groups, () => 0)?.name).toBe('第1组')
    expect(pickRandomGroup(groups, () => 0.99)?.name).toBe('第2组')
    expect(pickRandom([], () => 0)).toBeUndefined()
  })

  it('18. 点名与抽签都走同一份 canTrigger（源码级守约，防止将来只改一处）', async () => {
    const { readFileSync } = await import('node:fs')
    const picker = readFileSync('src/views/Classroom/components/RandomPicker.vue', 'utf8')
    const lottery = readFileSync('src/views/Classroom/components/GroupPicker.vue', 'utf8')
    expect(picker).toContain('canTrigger')
    expect(lottery).toContain('canTrigger')
    expect(picker).not.toContain('Date.now() - lastDrawnAt')
    expect(lottery).not.toContain('Date.now() - lastDrawnAt')
  })

  it('19. 抽签滚动期间值日组按钮被禁用（点了也只是改显示，和「抽签中」打架）', async () => {
    const { readFileSync } = await import('node:fs')
    const lottery = readFileSync('src/views/Classroom/components/GroupPicker.vue', 'utf8')
    expect(lottery).toContain(':disabled="rolling"')
    // 离开页面要把定时器收干净（否则切走还在后台换名字）
    expect(lottery).toContain('onBeforeUnmount(clearTimers)')
  })
})

/* ==================== RC-04 计时器后台恢复 ==================== */

describe('RC-04 · 计时器时间戳口径', () => {
  it('20. 后台跨过 90 秒回来仍然准确（不靠 tick 累加）', () => {
    const startedAt = T0
    const total = 5 * 60_000
    // 后台期间 setInterval 被浏览器压慢，只有两次回调；回到前台时用时间戳重算
    expect(elapsedSince(startedAt, T0 + 90_000, total)).toBe(90_000)
    expect(elapsedSince(startedAt, T0 + 300_000, total)).toBe(300_000)
  })

  it('21. 已计时被夹在 0~总时长之间（到点为满、不出现负数）', () => {
    const total = 60_000
    expect(elapsedSince(T0, T0 - 5_000, total)).toBe(0)
    expect(elapsedSince(T0, T0 + 60_000, total)).toBe(total)
    expect(elapsedSince(T0, T0 + 999_999, total)).toBe(total)
  })

  it('22. 暂停后继续以「已累计」为基准（startedAt = now − elapsed）', () => {
    const total = 10 * 60_000
    const elapsedAtPause = 30_000
    // 暂停 10 分钟后继续：起跑时刻被回推，恢复 1 秒后是 31 秒而不是 601 秒
    const resumedAt = T0 + 600_000
    const startedAt = resumedAt - elapsedAtPause
    expect(elapsedSince(startedAt, resumedAt + 1_000, total)).toBe(31_000)
  })

  it('23. TimerCard 不累加 tick，并在回前台时立刻对账（源码级守约）', async () => {
    const { readFileSync } = await import('node:fs')
    const timer = readFileSync('src/views/Classroom/components/TimerCard.vue', 'utf8')
    expect(timer).toContain('elapsedSince')
    expect(timer).not.toContain('elapsed.value +=')
    expect(timer).toContain('visibilitychange')
    expect(timer).toContain('removeEventListener')
  })
})
