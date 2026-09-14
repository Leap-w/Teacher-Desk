/**
 * 云端动作的唯一入口（V3.0 起）。
 *
 * **为什么要包一层**：分层规则（`docs/ARCHITECTURE.md`）规定页面只认识 stores 与
 * composables——`src/sync/autoSync.ts` 会 import 云 SDK，页面直接引它等于把云模块拖进
 * 页面依赖图，将来做首屏拆包时会连带把 SDK 打进主包。这里把「登录 / 登出 / 立即同步 /
 * 首次初始化」四件事收在一处，页面（控制中心的同步面板）只认识这个 composable。
 *
 * 与 `composables/useCloudSync.ts` 的分工：
 * - 本文件包的是 **Cloud-3 之后的同步引擎链路**（`src/sync/autoSync.ts` → SyncEngine → CloudTransport），
 *   控制中心的同步面板用它；
 * - `useCloudSync.ts` 包的是工具箱那张卡的既有通道（`services/cloudSync.ts`）。
 *
 * 两者共用同一套底层（同一个 `services/cloudbase` 会话），所以登录状态是一致的；
 * 分成两个 composable 是因为两条入口的文案与动作语义不同（双入口不迁移，见开发手册 §9.48）。
 */
import { isCloudConfigured } from '@/services/cloudbase'
import { cloudSyncState } from '@/services/cloudSync'
import { cloudTransport, signInAndSync, signOutAndReset, syncNowManual } from '@/sync/autoSync'

export function useCloudActions() {
  return {
    /** 通道侧状态（账号 / 最近同步时间 / 错误 / 待裁决）——只读 */
    state: cloudSyncState,

    /** 没配环境 ID 时整块不出现（界面的显隐依据） */
    configured: isCloudConfigured(),

    /**
     * 立即同步一次（整轮对账）。不抛异常：失败会记进状态，由调用方看状态说话。
     */
    syncNow: syncNowManual,

    /**
     * 邮箱 + 密码登录，并立刻对齐一次。
     * **失败会抛出**（登录是教师主动发起的动作，必须让他看到原因），调用方负责提示。
     */
    signIn: signInAndSync,

    /** 登出：清队列与对齐记账、回本地模式（云端数据不动） */
    signOut: signOutAndReset,

    /**
     * 云通道。首次初始化的四态判定（`firstSyncSituation`）与
     * 「用本机数据初始化云端」（`initializeFromLocal`）都从它拿。
     * 未接入时为 `null`——界面据此整块不显示。
     */
    channel: cloudTransport,
  }
}
