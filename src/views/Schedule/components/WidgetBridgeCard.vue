<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Copy, Download, FolderOpen, RefreshCw } from 'lucide-vue-next'

import { AppButton } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import {
  WIDGET_SNAPSHOT_PATH,
  WIDGET_STATUS_LABELS,
  openWidgetHostRefresh,
  useWidgetSnapshot,
} from '@/composables/useWidgetSnapshot'

/**
 * WidgetBridgeCard — 课程页上的 **macOS 小组件快照**入口（v3.7.0）。
 *
 * 它只做一件事：把课程表变成桌面小组件能读的那份快照（`widget-snapshot.json`）。
 * **本版唯一的「非自动」动作是首次连接**——浏览器规定选目录必须由用户手势触发，
 * 所以这里有一颗按钮；连上之后，课程表一变就会自动重写（含应用启动时那一次）。
 *
 * 为什么放在课程页：快照就是这份课表的投影，教师在这里改课表，也在这里看「小组件跟上了没有」。
 * 它不新增页面、不新增路由（规格 §二十九：不要一上来就大规模铺文件）。
 */
const toast = useToast()
const widget = useWidgetSnapshot()

const pathCopied = ref(false)

const statusText = computed(() => WIDGET_STATUS_LABELS[widget.status.value])
const connected = computed(() => widget.status.value === 'connected')
const unsupported = computed(() => widget.status.value === 'unsupported')

const lastSyncText = computed(() =>
  widget.lastWrittenAt.value
    ? new Date(widget.lastWrittenAt.value).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : undefined,
)

async function onConnect(): Promise<void> {
  const outcome = await widget.connect()
  if (outcome.ok) toast.success(outcome.message)
  else if (outcome.message !== '已取消') toast.warning(outcome.message)
}

async function onSync(): Promise<void> {
  const result = await widget.syncNow()
  if (result === 'written') toast.success('快照已更新')
  else if (result === 'unconnected') toast.warning('还没连接快照目录，先点「连接小组件」')
  else if (result === 'needs-permission') toast.warning('权限已失效，请重新连接一次')
  else if (result === 'unsupported') toast.warning('这个浏览器不支持自动同步，请用「下载快照」')
  else toast.danger('写入失败：请确认那台 Mac 上装了 TeacherDesk 小组件，并重新连接')
}

/** 「同步 + 立刻刷新」：跳一次 `teacherdesk://refresh` 让宿主 App 叫 WidgetKit 重画 */
async function onSyncAndRefresh(): Promise<void> {
  const result = await widget.syncNow()
  if (result !== 'written') {
    await onSync()
    return
  }
  toast.success('快照已更新，正在通知小组件刷新')
  openWidgetHostRefresh()
}

function onDownload(): void {
  if (widget.download()) toast.success('快照已下载，见 macOS 侧「Tools/install-snapshot.sh」')
  else toast.danger('下载失败：请刷新后重试')
}

async function onCopyPath(): Promise<void> {
  try {
    await navigator.clipboard.writeText(WIDGET_SNAPSHOT_PATH)
    pathCopied.value = true
    toast.success('路径已复制')
    window.setTimeout(() => (pathCopied.value = false), 2000)
  } catch {
    toast.warning('复制失败：请手动记下下面的路径')
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
      <template v-else-if="!connected">
        在宿主机上装好 TeacherDesk 小组件后，点「连接小组件」，在系统选择框里按
        <kbd>⌘</kbd><kbd>⇧</kbd><kbd>G</kbd> 粘贴下面的路径并选中它。只需做一次。
      </template>
      <template v-else>
        课程表改动后会自动更新快照；点击小组件会打开 TeacherDesk。
        「同步并刷新」会立刻让桌面上的小组件重画（其余时候系统在 15 分钟内自动刷新）。
      </template>
    </p>

    <div class="widget-path">
      <code>{{ WIDGET_SNAPSHOT_PATH }}</code>
      <button type="button" class="path-copy" :aria-label="`复制快照路径`" @click="onCopyPath">
        <Check v-if="pathCopied" :size="14" :stroke-width="2" aria-hidden="true" />
        <Copy v-else :size="14" :stroke-width="2" aria-hidden="true" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.widget-card {
  margin-top: var(--spacing-md);
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
.widget-path code {
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
