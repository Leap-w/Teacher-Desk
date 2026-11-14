<script setup lang="ts">
import { Check } from 'lucide-vue-next'

import { AppButton, AppModal } from '@/components/ui'
import {
  currentReleaseDate,
  currentReleaseHighlights,
  currentVersionLabel,
} from '@/config/releaseNotes'

/**
 * VersionModal — 版本信息窗口（v3.7.7）。
 *
 * 「我的」页品牌卡片右下角的「检查更新」打开它。**这不是真的联网检查**：
 * 本应用没有更新服务端，也不接 GitHub API / Releases，弹窗里的「已经是最新版本」
 * 是产品文案，不是一次版本比对的结果。更新日志来自本地 `config/releaseNotes.ts`，
 * 与当前 package.json 版本按版本号对齐；当前版本没有记录时只显示版本号，不编造内容。
 *
 * 交互全部复用 AppModal：遮罩点击 / ESC 关闭、打开时锁背景滚动、焦点循环与关闭后
 * 还原焦点。这里只负责排版，不另写一套弹层逻辑。
 */
defineProps<{ modelValue: boolean }>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const highlights = currentReleaseHighlights()
const releaseDate = currentReleaseDate()

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    :width="440"
    aria-label="版本信息"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="version-dialog">
      <span class="version-dialog__icon" aria-hidden="true">
        <Check :size="32" :stroke-width="3" />
      </span>

      <h2 class="version-dialog__title">已经是最新版本</h2>
      <p class="version-dialog__version">当前版本 {{ currentVersionLabel }}</p>
      <p v-if="releaseDate" class="version-dialog__date">更新于 {{ releaseDate }}</p>
      <p class="version-dialog__desc">您的 TeacherDesk 已经是最新版本，暂时不需要更新。</p>

      <section v-if="highlights.length" class="version-dialog__notes">
        <h3>本次更新内容</h3>
        <ul>
          <li v-for="(item, index) in highlights" :key="index">{{ item }}</li>
        </ul>
      </section>
    </div>

    <template #footer>
      <AppButton class="version-dialog__ok" @click="close">好的</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.version-dialog {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.version-dialog__icon {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: var(--radius-full);
  color: var(--color-text-inverse);
  /* 松石青 → 深一档的同色系，沿用现有主色令牌，不引入第二套品牌色 */
  background: linear-gradient(145deg, var(--color-primary) 0%, var(--color-primary-active) 100%);
  box-shadow: var(--shadow-primary-glow);
}

.version-dialog__title {
  margin: 18px 0 0;
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
}

.version-dialog__version {
  margin: 6px 0 0;
  font-size: var(--font-content);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--color-primary-strong);
}

.version-dialog__date {
  margin: 4px 0 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.version-dialog__desc {
  max-width: 320px;
  margin: 12px 0 0;
  font-size: var(--font-secondary);
  line-height: var(--leading-normal);
  color: var(--color-text-secondary);
}

.version-dialog__notes {
  width: 100%;
  margin-top: 20px;
  padding: 16px 18px;
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-primary-bg);
  text-align: left;
}

.version-dialog__notes h3 {
  margin: 0 0 10px;
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.version-dialog__notes ul {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.version-dialog__notes li {
  position: relative;
  padding-left: 16px;
  font-size: var(--font-secondary);
  line-height: var(--leading-normal);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

/* 小圆点随正文首行对齐，不抢「更新内容」本身的注意力 */
.version-dialog__notes li::before {
  content: '';
  position: absolute;
  top: 0.62em;
  left: 2px;
  width: 5px;
  height: 5px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
}

.version-dialog__ok {
  width: 100%;
}
</style>
