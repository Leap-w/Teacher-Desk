import { computed, ref } from 'vue'

import { useToast } from '@/composables/useToast'
import {
  cloudSyncState,
  resolveConflicts,
  signInAndSync,
  signOutAndStop,
  syncNow,
} from '@/services/cloudSync'
import type { ConflictChoice } from '@/services/cloudSync'
import { keyLabel } from '@/services/storage'
import { BACKUP_MODULES } from '@/utils/backup'
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

  /**
   * 当前**已登录**云端（查过会话且账号在场）。顶栏的同步按钮据此显隐：
   * 未配置环境 / 未登录都算「本地模式」——同步是登录之后才有意义的动作，
   * 未登录时挂一个同步按钮只会让教师点进去看「未登录」三个字。
   */
  const signedIn = computed(() => state.value.checked && state.value.account !== null)

  /** 这一轮同步正在跑（引擎给的事实，不是界面的猜测——谁触发的都对） */
  const syncing = computed(() => state.value.status === 'syncing')

  /** 等教师裁决的模块名（Phase 9C；空数组 = 没有这回事，界面整块不显示） */
  const conflictLabels = computed(() => state.value.conflicts.map(labelOfKey))

  const statusView = computed<{ text: string; tone: CloudTone }>(() => {
    // 等教师裁决的事优先说：`status` 讲的是「通不通」，这一位讲的是「只有你能决定」。
    // 不这么做的话，冲突会以「已同步」+ 一个绿点出现在顶栏上——教师看到一个「没事」的信号，
    // 而实际上有一个模块卡在半路（Phase 9C）。
    if (state.value.conflicts.length > 0) return { text: '需要确认', tone: 'warn' }
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
      if (now.conflicts.length > 0) {
        // 冲突＝这一轮**卡在这儿了**，不是失败也不是完成：两边都是真实数据，只有教师知道留哪一份。
        // 报成「同步完成」会让他以为已经对齐，报成「同步没成」又会让他以为出了故障。
        toast.info(
          `本机与云端都有数据的模块：${conflictLabels.value.join('、')}。请先确认保留哪一份。`,
        )
        return
      }
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

  /**
   * 处置首次同步的冲突（Phase 9C）：`local` = 留本机这份并推上云，`remote` = 留云端那份并覆盖本机。
   *
   * **只有教师按了按钮才会走到这里。** 冲突的两边都是真实数据（本机这份可能是断网期间录的，
   * 云端那份可能是另一台设备上的），界面不替教师做这个决定，同步流程自己也不做。
   */
  async function resolveConflict(choice: ConflictChoice): Promise<void> {
    busy.value = true
    try {
      await resolveConflicts(choice)
      const left = state.value.conflicts.length
      if (left > 0) {
        // 没处置干净的键留在列表里，教师可以再按一次（断网时就是这样：
        // 选择没有被执行，但也**没有被执行一半**）
        toast.danger(`还有 ${left} 个模块没能处置：${state.value.error ?? '原因未知'}`)
        return
      }
      toast.success(
        choice === 'local' ? '已保留本机数据，并上传到云端。' : '已保留云端数据，本机已更新。',
      )
    } finally {
      busy.value = false
    }
  }

  /**
   * 用用户名 + 密码登录并立刻对齐一次（工具箱那张卡走这条）。
   *
   * **本函数不做提示、不吞异常**：登录的成败要结合「本地有几份数据、云端有没有」才有意义
   * （首次同步的四种处境），那句判断与提示留在页面里——放在这里就会逼着页面去解析状态。
   * 邮箱登录在控制中心的同步面板（`useCloudActions`），两条入口各自保留（双入口不迁移）。
   */
  async function signIn(username: string, password: string): Promise<void> {
    await signInAndSync(username, password)
  }

  /** 登出并停止同步（清队列与对齐记账；云端数据不动） */
  async function signOut(): Promise<void> {
    await signOutAndStop()
  }

  return {
    state,
    enabled,
    signedIn,
    syncing,
    busy,
    conflictLabels,
    statusView,
    lastSyncedText,
    lastSyncedClock,
    syncWithFeedback,
    resolveConflict,
    signIn,
    signOut,
  }
}

/** 冲突裁决的口径：页面从本 composable 取类型，不必认识 services 层 */
export type { ConflictChoice } from '@/services/cloudSync'

/** 存储键 → 教师看得懂的名字：八个数据块的中文名（备份模块那张表），不在册的退回键名尾段 */
function labelOfKey(key: string): string {
  return BACKUP_MODULES.find((module) => module.key === key)?.label ?? keyLabel(key)
}

/** 时间戳 → Date；空的、非法的一律当「没有」处理，不让 `Invalid Date` 漏到界面上 */
function toDate(at: number | null): Date | null {
  if (at === null) return null
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? null : date
}
