import { computed, ref } from 'vue'

import { useToast } from '@/composables/useToast'
import { cloudSyncState, syncNow } from '@/services/cloudSync'
import { formatClock, formatDateOnly } from '@/utils/date'

/**
 * 云端同步的**界面层**：把 `services/cloudSync.ts` 的状态翻译成中文，把点击翻译成动作。
 *
 * 同步的规则（谁新谁旧、该推还是该采纳）不在这一层，在 `services/cloudSync.ts`；
 * 这一层只回答两个问题——「现在该怎么跟教师说」和「点了按钮要发生什么」。
 *
 * **顶栏与工具箱共用这一份。** 这不是为了少写几行：此前顶栏挂着一份 Phase 0 的假同步
 * （`stores/app.ts` 里一个 `setTimeout`，1.2 秒后显示「已同步 09:41」），和工具箱里的
 * 真同步同屏并存——同一屏上顶栏说已同步、工具箱说未登录，教师无从判断哪句是真的。
 * 两份文案只要各写各的，就迟早会再分叉一次；共用一份是让它们**没有分叉的机会**。
 */

/** 状态点的配色。颜色只是辅助，句子本身要能读懂（色盲、打印、截图都还得看） */
export type CloudTone = 'ok' | 'warn' | 'danger' | 'muted'

/**
 * 云端操作进行中（登录 / 登出 / 同步）。
 *
 * 刻意放在模块级而不是 `useCloudSync()` 内部：顶栏和工具箱各调一次这个函数，函数内
 * 声明的 ref 会各造一份，两处就会各转各的圈。云端只有一条链路，进行态也只该有一个。
 */
const busy = ref(false)

export function useCloudSync() {
  const toast = useToast()

  /** 状态本身（只读展示用；要改状态只能通过下面的动作，或 `services/cloudSync.ts`） */
  const state = cloudSyncState

  /** 没配环境 ID 时整块不出现：顶栏的按钮、工具箱的卡片都据此隐藏 */
  const enabled = computed(() => state.value.status !== 'disabled')

  /** 这一轮同步正在跑（引擎给的事实，不是界面的猜测——谁触发的都对） */
  const syncing = computed(() => state.value.status === 'syncing')

  const statusView = computed<{ text: string; tone: CloudTone }>(() => {
    switch (state.value.status) {
      case 'syncing':
        return { text: '正在同步…', tone: 'muted' }
      case 'idle':
        return { text: '已同步', tone: 'ok' }
      case 'offline':
        return { text: '连不上云端', tone: 'warn' }
      case 'error':
        return { text: '同步出错', tone: 'danger' }
      case 'signedOut':
        return { text: '未登录', tone: 'muted' }
      default:
        return { text: '未启用', tone: 'muted' }
    }
  })

  /** 上次同步成功的完整时刻（工具箱那行小字用） */
  const lastSyncedText = computed(() => {
    const date = toDate(state.value.lastSyncedAt)
    if (date === null) return '本次打开还没有同步过。'
    return `上次同步：${formatDateOnly(date)} ${formatClock(date)}`
  })

  /** 只要钟点（顶栏那行「已同步 09:41」用）；从没成功过为 `null`，界面据此整行不显示 */
  const lastSyncedClock = computed(() => {
    const date = toDate(state.value.lastSyncedAt)
    return date === null ? null : formatClock(date)
  })

  /**
   * 立即同步，并把这一轮的结果用一句话报出来。
   *
   * `syncNow` 自己吞掉失败并记进状态（它还要给自动同步用，不能抛异常），所以这里
   * **看状态说话，而不是等异常**——只 catch 的话，同步失败会被静默吞掉。
   *
   * 返回 `void` 而不是抛错：调用方（顶栏按钮、工具箱按钮）都只关心「报给教师什么」，
   * 而这个函数已经报完了；再抛一次会让调用方以为要自己处理。
   */
  async function syncWithFeedback(): Promise<void> {
    busy.value = true
    try {
      await syncNow()
      const now = state.value
      if (now.status === 'idle') {
        const parts: string[] = []
        if (now.pushedCount > 0) parts.push(`上传 ${now.pushedCount} 个模块`)
        if (now.adoptedCount > 0) parts.push(`取回 ${now.adoptedCount} 个模块`)
        toast.success(
          parts.length > 0 ? `同步完成：${parts.join('，')}` : '同步完成，云上和本机一致',
        )
      } else if (now.status === 'syncing') {
        // 跑完的这一轮又被新的一轮接上了（期间又有人写盘）：这不是失败，只是还没轮到它
        // 出结果。报红字会让教师以为同步坏了，而它下一拍就会自己变成「已同步」。
        toast.info('同步还在进行，稍后看状态。')
      } else if (now.status === 'signedOut') {
        // 会话失效（云端清了会话、浏览器换了配置）：这不是「同步失败」，是得重新登录。
        // 单独报一句，别让教师对着「原因未知」去猜出了什么事。
        toast.danger('登录状态已失效，请重新登录后再同步。')
      } else {
        toast.danger(`同步没成：${now.error ?? '原因未知'}`)
      }
    } finally {
      busy.value = false
    }
  }

  return {
    state,
    enabled,
    syncing,
    busy,
    statusView,
    lastSyncedText,
    lastSyncedClock,
    syncWithFeedback,
  }
}

/** 时间戳 → Date；空的、非法的一律当「没有」处理，不让 `Invalid Date` 漏到界面上 */
function toDate(at: number | null): Date | null {
  if (at === null) return null
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? null : date
}
