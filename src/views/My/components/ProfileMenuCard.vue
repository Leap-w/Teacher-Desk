<script lang="ts">
import type { LucideIcon } from 'lucide-vue-next'

/** 图标底色（与昌都记忆「我的档案」菜单行的色块同一套高原自然色系） */
export type ProfileMenuTone = 'display' | 'teaching' | 'class' | 'term' | 'data' | 'about'

/** 对外类型：调用方 import 后喂 items */
export interface ProfileMenuItem {
  key: string
  label: string
  /** 行尾的灰色说明（昌都记忆的 `profile__menu-desc`） */
  desc: string
  icon: LucideIcon
  tone: ProfileMenuTone
  /** 点这一行去哪（路由路径） */
  to: string
}
</script>

<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'

/**
 * ProfileMenuCard — 「我的」页的功能入口卡（v3.0.5-rc 新增组件）。
 *
 * **DOM 与视觉与昌都记忆 `Profile.vue` 的 `.profile__menu-card` 一一对应**：
 * 卡内标题 → 若干 `.profile__menu-row`（34px 圆角色块图标 + 主标签 + 行尾说明 + 右箭头），
 * 行与行之间是通栏细线，最后一行没有线，整卡 `overflow: hidden` 让首尾行贴圆角。
 *
 * 与 `SettingsCell` / `SettingsSection`（Apple 设置那种「图标 + 标题 + 副标题 + 值」的行）
 * **不是同一套样式**：那套留给数据与同步页和三个设置子页用，这一套只属于「我的」页。
 * 两套并存是刻意的——昌都记忆里它们本来就长得不一样，混用会让「我的」页失去原样。
 *
 * 行是 `<button>`（与参考版一致）：点整行都算，不只有文字可点。
 */
defineProps<{
  title: string
  items: ProfileMenuItem[]
}>()

const emit = defineEmits<{
  select: [item: ProfileMenuItem]
}>()
</script>

<template>
  <div class="profile__menu-card">
    <h2 class="profile__menu-card-title">{{ title }}</h2>
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="profile__menu-row"
      @click="emit('select', item)"
    >
      <div class="profile__menu-icon" :class="`profile__menu-icon--${item.tone}`">
        <component :is="item.icon" :size="18" :stroke-width="2" aria-hidden="true" />
      </div>
      <span class="profile__menu-label">{{ item.label }}</span>
      <span class="profile__menu-desc">{{ item.desc }}</span>
      <ChevronRight class="profile__menu-arrow" :size="14" :stroke-width="2" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
/* ==========================================
   Menu card（对齐 Changdu-Memory .profile__menu-card / .profile__menu-row）
   ========================================== */
.profile__menu-card {
  background: var(--glass-bg-card);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.profile__menu-card-title {
  margin: 0;
  padding: 20px 24px 4px;
  font-size: 20px;
  line-height: 1.3;
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.profile__menu-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 18px;
  border: none;
  border-bottom: var(--border-hairline-width) solid var(--color-border-light);
  background: transparent;
  cursor: pointer;
  transition: background var(--transition-fast);
  font-family: inherit;
  text-align: left;
}

.profile__menu-row:last-child {
  border-bottom: none;
}

/* 触摸按压反馈：按下时高亮，松开自动结束 */
.profile__menu-row:active {
  background: var(--color-bg-subtle);
}

/* 仅支持 hover 的设备（鼠标）才应用 hover，避免移动端点击后背景残留 */
@media (hover: hover) {
  .profile__menu-row:hover {
    background: var(--color-bg-subtle);
  }
}

.profile__menu-row:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.profile__menu-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* 色块底色与昌都记忆同一套路数（低透明度底 + 同色系前景） */
.profile__menu-icon--display {
  background: rgba(142, 124, 181, 0.12);
  color: #8e7cb5;
}

.profile__menu-icon--teaching {
  background: rgba(111, 168, 220, 0.12);
  color: var(--color-sky);
}

.profile__menu-icon--class {
  background: rgba(208, 135, 112, 0.1);
  color: #d08770;
}

.profile__menu-icon--term {
  background: var(--color-gold-light);
  color: var(--color-gold);
}

.profile__menu-icon--data {
  background: rgba(75, 143, 140, 0.1);
  color: var(--color-primary);
}

.profile__menu-icon--about {
  background: rgba(107, 123, 141, 0.12);
  color: var(--color-text-secondary);
}

.profile__menu-label {
  flex: 1;
  font-size: var(--font-content);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
  min-width: 0;
}

.profile__menu-desc {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile__menu-arrow {
  color: var(--color-text-tertiary);
  opacity: 0.4;
  flex-shrink: 0;
}
</style>
