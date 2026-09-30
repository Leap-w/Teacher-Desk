/**
 * Widget 快照同步的**接线**（v3.7.0）。
 *
 * 三个触发时机（规格 §二十 / §二十一）：
 *
 * 1. **应用启动**：`startWidgetSnapshotSync()` 在 `main.ts` 里挂一次。只做两件事——
 *    查一次桥状态；**已经连上**就重新生成并写一份快照。没连上什么都不做（零副作用）。
 * 2. **课程表变化**：监听 Pinia 里的课表状态，防抖后重写一份。换课 / 导入 / 增删改都会走到。
 * 3. **教师手点**：课程页那张卡片上的「立即同步」（以及「同步并让小组件立刻刷新」）。
 *
 * ## 为什么不直接 `useTimetableStore()`
 *
 * 课表 Store 是**懒加载**的，而且它的仓储在键不存在时会**首次播种示例课表**
 * （`scheduleRepository.loadLessons()` 的 `writeSeed`）。启动时为了给小组件生成快照
 * 而把它实例化，等于把「第一次打开课程表时播种」变成「一开机就播种」——而播种时机是
 * 数据安全的一环（§9.21：示例数据必须落在同步引擎看得见的时刻）。所以这里：
 *
 * · 数据一律走**只读仓储**（`scheduleRepository.peekLessons()` / `appSettingsRepository.readSettings()`
 *   / `userProfileRepository.readProfile()`）——读盘、绝不写盘、绝不放种子；
 * · 变化监听用 `pinia.state.value.timetable` 这个**已经存在才有的**状态，不主动创建它。
 */
import { ref, watch, type Ref } from 'vue'
import type { Pinia } from 'pinia'

import { appConfig } from '@/config'
import { appSettingsRepository } from '@/repositories/settings/appSettingsRepository'
import { scheduleRepository } from '@/repositories/schedule/scheduleRepository'
import { userProfileRepository } from '@/repositories/user/userProfileRepository'
import {
  widgetBridge,
  type WidgetBridge,
  type WidgetBridgeStatus,
  type WidgetWriteResult,
} from '@/services/widgetBridge'
import { resolvePeriods } from '@/utils/timetable'
import { buildWidgetSnapshot, serializeWidgetSnapshot } from '@/utils/widgetSnapshot'
import type { WidgetSnapshot } from '@/types/widget'

/** 课程表变化后的防抖时长：换课 / 导入会连着写几次盘，没必要每次都落一遍快照 */
const DEBOUNCE_MS = 1500

/**
 * 用**只读入口**攒一份快照。
 *
 * 三条数据各自的出处写在下面——它们与课程页读的是同一份数据、同一套口径
 * （生效率的时段表、既有 `Lesson` 模型、档案里的班级名），只是全部走「不写盘」的那条读法。
 */
export function readWidgetSnapshotSources(): WidgetSnapshot {
  const settings = appSettingsRepository.readSettings()
  const profile = userProfileRepository.readProfile()
  return buildWidgetSnapshot({
    // 生效作息：默认作息 + 教师在教学设置里改过的时段（与课程页 `appSettings.periods` 同源）
    periods: resolvePeriods(settings.teaching.periodTimes),
    // 全部课程：换课 / 代课的结果已经落在课程数组里，这里读到的就是最终课表
    lessons: scheduleRepository.peekLessons(),
    pwaBaseUrl: typeof window === 'undefined' ? '' : window.location.origin,
    className: profile.className ?? '',
    now: new Date(),
  })
}

/** 生成 + 序列化（页面与自动同步共用这一句，保证写出的一定是同一份字节） */
export function currentWidgetSnapshotText(): string {
  return serializeWidgetSnapshot(readWidgetSnapshotSources())
}

/** 桥状态的中文说法（界面与 toast 共用一份文案） */
export const WIDGET_STATUS_LABELS: Record<WidgetBridgeStatus, string> = {
  unsupported: '当前浏览器不支持自动同步',
  unconnected: '未连接',
  'needs-permission': '需要重新授权',
  connected: '已连接',
}

/**
 * 课程页那张卡片用的状态机（**手动操作**都在这里）。
 *
 * 与自动同步共用同一个 `widgetBridge` 单例：卡片上连上之后，后台的自动同步立刻就能静默写。
 */
export function useWidgetSnapshot() {
  const bridge: WidgetBridge = widgetBridge
  const status = ref<WidgetBridgeStatus>('unconnected')
  const busy = ref(false)
  const lastWrittenAt = ref<string | undefined>(undefined)

  async function refreshStatus(): Promise<void> {
    status.value = await bridge.status()
  }

  void refreshStatus()

  /** 连接（必须在点击事件里调用：系统选择框与授权都需要用户手势） */
  async function connect(): Promise<{ ok: boolean; message: string; warning?: string }> {
    busy.value = true
    try {
      const outcome = await bridge.connect(currentWidgetSnapshotText())
      status.value = outcome.status
      if (outcome.wrote) {
        lastWrittenAt.value = new Date().toISOString()
        return {
          ok: true,
          message: '已连接，课程表已写入快照',
          // 「写成功了但选错文件夹」是唯一一种「网页说成功、小组件没变」的成因，必须说出来
          ...(outcome.folderWarning ? { warning: outcome.folderWarning } : {}),
        }
      }
      if (outcome.status === 'unsupported') {
        return { ok: false, message: '这个浏览器不支持自动同步，请用「下载快照」' }
      }
      if (outcome.status === 'needs-permission') {
        return { ok: false, message: '没有拿到写入权限，再点一次并选择「允许」' }
      }
      return { ok: false, message: '已取消' }
    } finally {
      busy.value = false
    }
  }

  /** 立即同步一次（静默写；返回结果让页面决定提示什么） */
  async function syncNow(): Promise<WidgetWriteResult> {
    busy.value = true
    try {
      const result = await bridge.write(currentWidgetSnapshotText())
      status.value = await bridge.status()
      if (result === 'written') lastWrittenAt.value = new Date().toISOString()
      return result
    } finally {
      busy.value = false
    }
  }

  /** 断开：只清句柄，盘上那份快照留着（Widget 继续显示上一次的数据） */
  async function disconnect(): Promise<void> {
    busy.value = true
    try {
      await bridge.disconnect()
      status.value = await bridge.status()
    } finally {
      busy.value = false
    }
  }

  /** 兜底：把快照下载成一个 JSON 文件（Safari 等不支持 FS API 的浏览器） */
  function download(): boolean {
    return bridge.download(currentWidgetSnapshotText())
  }

  return {
    bridge,
    status,
    busy,
    lastWrittenAt,
    refreshStatus,
    connect,
    syncNow,
    disconnect,
    download,
  }
}

/**
 * 启动自动同步（`main.ts` 调用一次）。
 *
 * 返回一个 dispose 函数（测试与热更新用；应用里不需要调用）。
 */
export function startWidgetSnapshotSync(pinia?: Pinia): () => void {
  let timer: number | undefined
  let stopped = false

  /** 只在「已经连上」时才写：未连接 / 需要授权都不该在后台反复尝试（只会白刷日志） */
  async function syncIfConnected(): Promise<void> {
    if (stopped) return
    const result = await widgetBridge.write(currentWidgetSnapshotText())
    if (result !== 'written') {
      console.warn(`[widget] 自动同步跳过：${result}`)
    }
  }

  // 1) 启动即对一次（规格 §二十一）
  void syncIfConnected()

  // 2) 课表变化（防抖）。**不主动创建 store**：`pinia.state.value.timetable` 只有在
  //    教师打开过课程表之后才存在，那时它的每次变更都会被这里看到。
  const state = pinia?.state as Ref<Record<string, unknown>> | undefined
  const stopWatch = watch(
    () => {
      const timetable = state?.value?.timetable as
        { lessons?: unknown; exchanges?: unknown } | undefined
      if (!timetable) return undefined
      // 两个数组都是「整批替换」写法（每次写入换新数组），浅比较足够
      return [timetable.lessons, timetable.exchanges] as const
    },
    (next, previous) => {
      if (!next || !previous) return
      if (next[0] === previous[0] && next[1] === previous[1]) return
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = undefined
        void syncIfConnected()
      }, DEBOUNCE_MS)
    },
  )

  return () => {
    stopped = true
    if (timer !== undefined) window.clearTimeout(timer)
    stopWatch()
  }
}

/** 给宿主 App / 小组件用的深链（在用户手势里跳转，浏览器才允许拉起外部协议） */
export function openWidgetHostRefresh(): void {
  if (typeof window === 'undefined') return
  window.location.href = `teacherdesk://refresh`
}

/** 快照文件路径（界面展示 + 复制；不含开发机绝对路径，`~` 开头由配置给） */
export const WIDGET_SNAPSHOT_PATH = `${appConfig.widget.containerDir.replace(/\/+$/, '')}/${appConfig.widget.snapshotFileName}`
