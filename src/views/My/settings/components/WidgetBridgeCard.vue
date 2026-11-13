<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Copy, Download, FolderOpen, RefreshCw } from 'lucide-vue-next'

import { AppButton } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import {
  WIDGET_CANCELLED_MESSAGE,
  WIDGET_CONTAINER_DIR,
  WIDGET_SNAPSHOT_PATH,
  WIDGET_STATUS_LABELS,
  useWidgetSnapshot,
} from '@/composables/useWidgetSnapshot'
import { describeWriteOutcome } from '@/services/widgetBridgeFeedback'

/**
 * WidgetBridgeCard — **设置 → 教学设置 → 桌面小组件** 页上的快照入口
 * （v3.7.0；v3.7.6 从课程表页整体移入设置；v3.7.8 修授权与提示）。
 *
 * 它只做一件事：把课程表变成桌面小组件能读的那份快照（`widget-snapshot.json`）。
 * **唯一的「非自动」动作是首次连接**——浏览器规定选目录必须由用户手势触发，
 * 所以这里有一颗按钮；连上之后，课程表一变就会自动重写（含应用启动时那一次）。
 *
 * ## v3.7.8 改了什么（2026-11-13）
 *
 * ① 卡片上给出、并被「复制」的是**目录**（`WIDGET_CONTAINER_DIR`），不再是快照文件路径——
 *    旧版把文件路径当"要粘贴的路径"给教师，于是选择框里选中的是 `widget-snapshot.json`，
 *    句柄成了文件句柄，之后每次写入都抛 `TypeMismatchError`，界面却只说「没有拿到写入权限」。
 * ② 三种失败分开说：没授权 / 选错文件夹 / 真的写失败（带 `error.name`）。
 * ③ 「同步并刷新」只在**快照确实写进去**之后才请求刷新，并且不说"桌面已更新"。
 */
const toast = useToast()
const widget = useWidgetSnapshot()

const pathCopied = ref(false)

const statusText = computed(() => WIDGET_STATUS_LABELS[widget.status.value])
const connected = computed(() => widget.status.value === 'connected')
const unsupported = computed(() => widget.status.value === 'unsupported')
/** 存着的句柄指向了文件（v3.7.8 之前留下的坏句柄）→ 提示重选，但不用先断开 */
const wrongFolder = computed(() => widget.status.value === 'wrong-folder')

const lastSyncText = computed(() =>
  widget.lastWrittenAt.value
    ? new Date(widget.lastWrittenAt.value).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : undefined,
)

async function onConnect(): Promise<void> {
  const feedback = await widget.connect()
  if (feedback.ok) toast.success(feedback.message)
  else if (feedback.message !== WIDGET_CANCELLED_MESSAGE) toast.warning(feedback.message)
}

async function onSync(): Promise<void> {
  const outcome = await widget.syncNow()
  const feedback = describeWriteOutcome(outcome)
  if (feedback.ok) toast.success(feedback.message)
  else if (outcome.result === 'failed') toast.danger(feedback.message)
  else toast.warning(feedback.message)
}

/** 「同步 + 立刻刷新」：**写入成功后**才跳 `teacherdesk://refresh` 让宿主 App 叫 WidgetKit 重画 */
async function onSyncAndRefresh(): Promise<void> {
  const outcome = await widget.syncAndRefresh()
  const feedback = describeWriteOutcome(outcome)
  if (!feedback.ok) {
    if (outcome.result === 'failed') toast.danger(feedback.message)
    else toast.warning(feedback.message)
    return
  }
  // 只说「已请求」：深链交给系统，桌面何时重画由 WidgetKit 决定
  toast.success('快照已写入，已请求小组件刷新（桌面通常几秒内重画）')
}

function onDownload(): void {
  if (widget.download()) toast.success('快照已下载，见 macOS 侧「Tools/install-snapshot.sh」')
  else toast.danger('下载失败：请刷新后重试')
}

/** 复制的是**目录**——选择框要的就是它 */
async function onCopyPath(): Promise<void> {
  try {
    await navigator.clipboard.writeText(WIDGET_CONTAINER_DIR)
    pathCopied.value = true
    toast.success('目录路径已复制')
    window.setTimeout(() => (pathCopied.value = false), 2000)
  } catch {
    toast.warning('复制失败：请手动记下下面的目录')
  }
}

async function onDisconnect(): Promise<void> {
  await widget.disconnect()
  toast.info('已断开。盘上那份快照保留着，小组件继续显示上一次的数据')
}
</script>

<template>
  <section class="widget-card" aria-label="macOS 桌面小组件">
    <div class="widget-head">
      <div class="widget-title">
        <span class="widget-name">macOS 桌面小组件</span>
        <span class="widget-state" :class="`is-${widget.status.value}`">{{ statusText }}</span>
        <span v-if="lastSyncText" class="widget-time">今天 {{ lastSyncText }} 已同步</span>
      </div>
      <div class="widget-actions">
        <AppButton
          v-if="!connected && !unsupported"
          size="sm"
          :loading="widget.busy.value"
          @click="onConnect"
        >
          <FolderOpen :size="14" :stroke-width="2" aria-hidden="true" />
          连接小组件
        </AppButton>
        <template v-else-if="connected">
          <AppButton size="sm" :loading="widget.busy.value" @click="onSyncAndRefresh">
            <RefreshCw :size="14" :stroke-width="2" aria-hidden="true" />
            同步并刷新
          </AppButton>
          <AppButton variant="ghost" size="sm" :disabled="widget.busy.value" @click="onSync">
            仅同步
          </AppButton>
          <AppButton variant="ghost" size="sm" :disabled="widget.busy.value" @click="onDisconnect">
            断开
          </AppButton>
        </template>
        <AppButton v-else variant="secondary" size="sm" @click="onDownload">
          <Download :size="14" :stroke-width="2" aria-hidden="true" />
          下载快照
        </AppButton>
      </div>
    </div>

    <p class="widget-hint">
      <template v-if="unsupported">
        这个浏览器不支持自动写入文件（Safari 尚未开放该能力）。请点「下载快照」， 再在 Mac 上运行
        <code>macos/Tools/install-snapshot.sh</code> 把它放进小组件的容器目录。
      </template>
      <template v-else-if="wrongFolder">
        上次保存的目录指向的是快照文件本身，所以一直写不进去。点「连接小组件」重新选中
        <strong>TeacherDesk 这个文件夹</strong>即可，不用先断开。
      </template>
      <template v-else-if="!connected">
        在宿主机上装好 TeacherDesk 小组件后，点「连接小组件」，在系统选择框里按
        <kbd>⌘</kbd><kbd>⇧</kbd><kbd>G</kbd> 粘贴下面的<strong>目录</strong>路径，选中
        <strong>TeacherDesk 这个文件夹本身</strong> —— 不要点开它去选里面的
        <code>widget-snapshot.json</code>。
      </template>
      <template v-else>
        课程表改动后会自动更新快照；点击小组件会打开 TeacherDesk。
        「同步并刷新」会立刻请求系统重画桌面小组件（其余时候系统在 15 分钟内自动刷新）。
      </template>
    </p>

    <div class="widget-path">
      <span class="widget-path-label">目录</span>
      <code>{{ WIDGET_CONTAINER_DIR }}</code>
      <button type="button" class="path-copy" :aria-label="`复制快照目录`" @click="onCopyPath">
        <Check v-if="pathCopied" :size="14" :stroke-width="2" aria-hidden="true" />
        <Copy v-else :size="14" :stroke-width="2" aria-hidden="true" />
      </button>
    </div>
    <p class="widget-path-note">
      快照文件：<code>{{ WIDGET_SNAPSHOT_PATH }}</code> ——
      由网页写入，只用于核对，不要在选择框里选它。
    </p>
  </section>
</template>

<style scoped>
.widget-card {
  padding: var(--spacing-card);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
}

.widget-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.widget-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.widget-name {
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.widget-state {
  padding: 1px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-fill-disabled);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.widget-state.is-connected {
  background: var(--color-success-soft);
  color: var(--color-success-strong);
}

.widget-state.is-needs-permission {
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
}

/* v3.7.8：句柄指向文件（选错了）/ 真写失败，各给一种说法，不再都装成「需要重新授权」 */
.widget-state.is-wrong-folder {
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
}

.widget-state.is-failed {
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
}

.widget-time {
  font-size: var(--font-caption);
  color: var(--color-text-faint);
}

.widget-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.widget-hint {
  margin-top: var(--space-3);
  font-size: var(--font-caption);
  line-height: 1.7;
  color: var(--color-text-tertiary);
}

.widget-hint code,
.widget-path code,
.widget-path-note code {
  padding: 1px 4px;
  border-radius: var(--radius-xs);
  background: var(--color-fill-disabled);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
}

.widget-hint kbd {
  padding: 0 4px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-xs);
  background: var(--color-bg-white);
  font-size: 11px;
}

.widget-path {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.widget-path-label {
  flex-shrink: 0;
  font-size: var(--font-caption);
  color: var(--color-text-faint);
}

.widget-path-note {
  margin-top: var(--space-2);
  font-size: 11px;
  line-height: 1.7;
  color: var(--color-text-faint);
  word-break: break-all;
}

.widget-path code {
  flex: 1;
  min-width: 0;
  padding: var(--space-2);
  overflow-x: auto;
  white-space: nowrap;
  color: var(--color-text-secondary);
}

.path-copy {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-button);
  background: var(--color-bg-white);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.path-copy:hover {
  background: var(--bg-hover);
}

.path-copy:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}
</style>
