<script setup lang="ts">
import { ref } from 'vue'
import { Activity, ChevronDown } from 'lucide-vue-next'

import { AppBadge } from '@/components/ui'
import { useSyncDiagnostics } from '@/composables/useSyncDiagnostics'

/**
 * SyncDiagnosticsCard — 同步诊断（V2.2.3-alpha · Phase Cloud-4）。
 *
 * 位置：我的 → 工具箱。**Observable Sync 规范**的落点：状态 / 队列长度 / 待同步键 /
 * 最近同步时间 / 最近错误 / 当前通道，一屏可读。
 * 开发模式默认展开详情，正式版默认折叠（折叠时也有一行摘要）。
 */
const {
  state,
  pending,
  pendingKeys,
  outbox,
  lastSyncedText,
  lastError,
  succeeded,
  failed,
  transport,
  connected,
  account,
  queueKey,
  isDev,
  summary,
} = useSyncDiagnostics()

const expanded = ref<boolean>(isDev)

function toggle(): void {
  expanded.value = !expanded.value
}
</script>

<template>
  <section class="diag-card">
    <button type="button" class="diag-head" :aria-expanded="expanded" @click="toggle">
      <span class="diag-icon" aria-hidden="true"><Activity :size="18" :stroke-width="2" /></span>
      <span class="diag-main">
        <span class="diag-title">同步诊断</span>
        <span class="diag-sub">{{ summary }}</span>
      </span>
      <AppBadge
        :variant="state === 'error' ? 'danger' : pending > 0 ? 'warning' : 'neutral'"
        size="sm"
      >
        {{ state }}
      </AppBadge>
      <ChevronDown
        class="diag-chevron"
        :class="{ 'is-open': expanded }"
        :size="16"
        aria-hidden="true"
      />
    </button>

    <dl v-if="expanded" class="diag-body">
      <div class="diag-row">
        <dt>当前状态</dt>
        <dd>
          {{ state }}<span v-if="pending > 0"> · 队列 {{ pending }} 项</span>
        </dd>
      </div>
      <div class="diag-row">
        <dt>队列长度</dt>
        <dd>{{ pending }}</dd>
      </div>
      <div class="diag-row">
        <dt>待同步 Key</dt>
        <dd class="diag-keys">
          <template v-if="pendingKeys.length > 0">
            <code v-for="key in pendingKeys" :key="key">{{ key }}</code>
          </template>
          <span v-else>（空）</span>
        </dd>
      </div>
      <div class="diag-row">
        <dt>最近同步</dt>
        <dd>{{ lastSyncedText ?? '还没同步过' }}</dd>
      </div>
      <div class="diag-row">
        <dt>最近错误</dt>
        <dd :class="{ 'is-error': lastError }">{{ lastError ?? '（无）' }}</dd>
      </div>
      <div class="diag-row">
        <dt>当前通道</dt>
        <dd>
          {{ transport }}
          <span v-if="connected"> · 已接入</span>
          <span v-if="account"> · {{ account }}</span>
        </dd>
      </div>
      <div class="diag-row">
        <dt>累计</dt>
        <dd>成功 {{ succeeded }} · 失败 {{ failed }}</dd>
      </div>
      <div class="diag-row">
        <dt>Outbox</dt>
        <dd>
          <template v-if="outbox.length > 0">
            <code v-for="entry in outbox" :key="entry.key">
              {{ entry.key }} ×{{ entry.attempts }}
            </code>
          </template>
          <span v-else>（空）</span>
        </dd>
      </div>
      <div class="diag-row">
        <dt>队列存储键</dt>
        <dd>
          <code>{{ queueKey }}</code
          >（刷新 / 重启后据此续传）
        </dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.diag-card {
  background: var(--bg-card);
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}

.diag-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background var(--duration-base) var(--ease-out);
}

.diag-head:hover {
  background: var(--bg-hover);
}

.diag-head:focus-visible {
  outline: none;
  box-shadow: inset var(--ring-focus);
}

.diag-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.diag-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.diag-title {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.diag-sub {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.diag-chevron {
  color: var(--color-text-tertiary);
  transition: transform var(--duration-base) var(--ease-out);
}

.diag-chevron.is-open {
  transform: rotate(180deg);
}

.diag-body {
  margin: 0;
  padding: var(--space-3) var(--space-4) var(--space-4);
  border-top: var(--border-hairline-width) solid var(--color-border-light);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.diag-row {
  display: flex;
  gap: var(--space-3);
  font-size: var(--font-caption);
  line-height: var(--leading-normal);
}

.diag-row dt {
  flex-shrink: 0;
  width: 88px;
  color: var(--color-text-tertiary);
}

.diag-row dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--color-text-secondary);
  word-break: break-all;
}

.diag-row dd.is-error {
  color: var(--color-danger-strong);
}

.diag-keys,
.diag-row dd {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.diag-row code {
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  background: var(--color-fill-disabled);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
</style>
