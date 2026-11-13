/**
 * Widget 快照桥的**界面反馈**（v3.7.8）
 *
 * 为什么要单独一层：v3.7.8 之前这段映射写在 `useWidgetSnapshot.connect()` 里，
 * 而那里连着仓储层（`scheduleRepository` / `appSettingsRepository` …），
 * 想单测一句文案就得先把整个存储链路拖进 node。抽成纯函数后：
 *
 * · 状态 → 文案的映射可以逐条断言（`src/__tests__/widgetBridge.test.ts`）；
 * · 「写入成功才通知宿主刷新」这条顺序也在这里，能被一个假的桥直接测。
 *
 * 四条说法必须分得开（v3.7.8 的核心诉求，旧版全折成一句「没有拿到写入权限」）：
 *
 *   needs-permission → 没授权，点一下并在弹窗里选「允许」
 *   wrong-folder     → 选的是 JSON 文件 / 别的文件夹，要选中 TeacherDesk 文件夹本身
 *   failed           → 真写了但失败，把 `TypeMismatchError` 这类真实错误名说出来
 *   written          → 快照确实落盘了（**唯一可以报成功的情况**）
 */
import type { WidgetBridge, WidgetConnectOutcome, WidgetWriteOutcome } from './widgetBridge'

/** 给 toast 用的一句话（`ok` 决定是成功色还是警告色） */
export interface WidgetFeedback {
  ok: boolean
  message: string
}

/** 取消选择不是错误，卡片不该弹任何提示 */
export const WIDGET_CANCELLED_MESSAGE = '已取消'

/** 把一次「连接」的结果翻成人话 */
export function describeConnectOutcome(outcome: WidgetConnectOutcome): WidgetFeedback {
  if (outcome.wrote) {
    return {
      ok: true,
      message: outcome.reused ? '已恢复授权，课程表已写入快照' : '已连接，课程表已写入快照',
    }
  }
  if (outcome.cancelled) return { ok: false, message: WIDGET_CANCELLED_MESSAGE }
  if (outcome.status === 'unsupported') {
    return { ok: false, message: '这个浏览器不支持自动同步，请用「下载快照」' }
  }
  if (outcome.wrongFolder) {
    const { kind, picked, expected } = outcome.wrongFolder
    return {
      ok: false,
      message:
        kind === 'file'
          ? `你选的是快照文件「${picked}」，需要选中它所在的「${expected}」文件夹本身`
          : `你选的是「${picked}」，需要选中「${expected}」文件夹`,
    }
  }
  if (outcome.status === 'wrong-folder') {
    return {
      ok: false,
      message: '保存的目录指向的不是「TeacherDesk」文件夹：请重新点「连接小组件」选中它',
    }
  }
  if (outcome.error) {
    return {
      ok: false,
      message: `写入失败（${outcome.error.name}）：${outcome.error.message}。请确认「TeacherDesk」文件夹还在且可写`,
    }
  }
  return {
    ok: false,
    message: '没有拿到「TeacherDesk」文件夹的访问授权：请再点一次，在系统弹窗里选择「允许」',
  }
}

/** 把一次「静默写入」的结果翻成人话（手动「仅同步」用） */
export function describeWriteOutcome(outcome: WidgetWriteOutcome): WidgetFeedback {
  switch (outcome.result) {
    case 'written':
      return { ok: true, message: '快照已更新' }
    case 'unsupported':
      return { ok: false, message: '这个浏览器不支持自动同步，请用「下载快照」' }
    case 'unconnected':
      return { ok: false, message: '还没连接快照目录，先点「连接小组件」' }
    case 'needs-permission':
      return { ok: false, message: '授权已失效：点「连接小组件」重新授权一次（不用重选目录）' }
    case 'wrong-folder':
      return {
        ok: false,
        message: '保存的目录指向了快照文件本身：点「连接小组件」重新选中「TeacherDesk」文件夹',
      }
    case 'failed':
      return {
        ok: false,
        message: `写入失败（${outcome.error?.name ?? 'Error'}）：${
          outcome.error?.message ?? '未知错误'
        }`,
      }
  }
}

/**
 * 「先写、写成功了再通知宿主刷新」（v3.7.8 Phase 5）。
 *
 * 顺序为什么不能反：刷新只是让 WidgetKit **重读文件**，文件没写进去就通知，
 * 等于让小组件把同一份旧数据再画一遍——教师看到的是「点了没反应」。
 *
 * 也刻意**不**把 `notify()` 的结果当成「桌面已更新」：深链只保证「请求已交给系统」，
 * WidgetKit 何时真正重画由系统决定（卡片文案因此只说「已请求刷新」）。
 */
export async function syncThenNotify(
  bridge: Pick<WidgetBridge, 'write'>,
  text: string,
  notify: () => void,
): Promise<WidgetWriteOutcome> {
  const outcome = await bridge.write(text)
  if (outcome.result === 'written') notify()
  return outcome
}
