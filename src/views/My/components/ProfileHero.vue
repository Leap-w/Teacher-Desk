<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PencilLine, User, X } from 'lucide-vue-next'

import type { UserProfile } from '@/types/user'

/**
 * ProfileHero — 个人身份 Hero（v3.0.3-rc · 对齐 Changdu-Memory `Profile.vue` 的 profile-hero）。
 *
 * **DOM 与视觉层级与昌都记忆「我的档案」首卡一一对应**：
 * `div.profile-hero`（夜空渐变卡）→ 雪山线稿纹理 SVG → `div.profile-hero__content`
 * → `div.profile-hero__profile`（渐变环头像 + 姓名 + 身份行 + 签名行）
 * → `div.profile-hero__attrs`（两项属性简徽：学校 / 学科）。
 * 只替换内容来源：姓名 = 昵称，身份行 = 班级 · 班主任，属性 = 学校 / 任教学科。
 *
 * 头像上传 / 删除逻辑仍经事件上抛（与既有版本一致，不碰 Store 与数据结构）；
 * 未登录时本组件不会被渲染（由页面换成登录空状态卡）。
 */
const props = defineProps<{
  profile: UserProfile
  initial: string
}>()

const emit = defineEmits<{
  edit: []
  'pick-avatar': []
  'remove-avatar': []
}>()

const entered = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    entered.value = true
  })
})

const displayName = computed(() => props.profile.nickname.trim() || '尚未设置资料')

/** 身份行：班级 · 班主任（班级为空时只说班主任） */
const roleLine = computed(() =>
  props.profile.className.trim() ? `${props.profile.className.trim()} · 班主任` : '班主任',
)

/** 属性简徽：字段为空显示「待设置」，不渲染半截身份 */
const school = computed(() => props.profile.school.trim() || '待设置')
const subject = computed(() => props.profile.subject.trim() || '待设置')

/** 资料填过任一身份字段才显示「已认证」勾选，避免空资料上挂一个假徽标 */
const verified = computed(
  () =>
    props.profile.nickname.trim() !== '' ||
    props.profile.school.trim() !== '' ||
    props.profile.className.trim() !== '' ||
    props.profile.subject.trim() !== '',
)
</script>

<template>
  <section class="profile-hero" :class="{ 'is-entered': entered }">
    <!-- 背景雪山线稿纹理（与昌都记忆同一形状、同一透明度） -->
    <svg class="profile-hero__texture" viewBox="0 0 500 150" fill="none" aria-hidden="true">
      <path d="M0 150L120 40L200 110L320 10L500 150H0Z" fill="currentColor" />
    </svg>

    <div class="profile-hero__content">
      <div class="profile-hero__profile">
        <div class="profile-hero__avatar-wrap">
          <button
            type="button"
            class="profile-hero__avatar-ring"
            :aria-label="props.profile.avatar ? '更换头像' : '上传头像'"
            @click="emit('pick-avatar')"
          >
            <img v-if="props.profile.avatar" :src="props.profile.avatar" alt="我的头像" />
            <span v-else-if="props.initial" class="avatar-fallback" aria-hidden="true">{{
              props.initial
            }}</span>
            <User v-else class="avatar-guest" :size="34" :stroke-width="1.8" aria-hidden="true" />
          </button>
          <button
            v-if="props.profile.avatar"
            type="button"
            class="profile-hero__avatar-remove"
            aria-label="删除头像"
            @click="emit('remove-avatar')"
          >
            <X :size="12" :stroke-width="2" aria-hidden="true" />
          </button>
          <span v-if="verified" class="profile-hero__verified" aria-hidden="true">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <slot name="avatar-input" />
        </div>

        <div class="profile-hero__name-wrap">
          <h2 class="profile-hero__name">{{ displayName }}</h2>
          <p class="profile-hero__sub">{{ roleLine }}</p>
        </div>
      </div>

      <!-- 个人属性简徽 -->
      <div class="profile-hero__attrs">
        <div class="profile-hero__attr">
          <span class="profile-hero__attr-label">学校</span>
          <span class="profile-hero__attr-value">{{ school }}</span>
        </div>
        <div class="profile-hero__attr">
          <span class="profile-hero__attr-label">任教学科</span>
          <span class="profile-hero__attr-value">{{ subject }}</span>
        </div>
      </div>

      <button type="button" class="profile-hero__edit" @click="emit('edit')">
        <PencilLine :size="14" :stroke-width="2" aria-hidden="true" />
        编辑资料
      </button>
    </div>
  </section>
</template>

<style scoped>
/* ==========================================
   Personal Hero Card（对齐 Changdu-Memory .profile-hero）
   ========================================== */
.profile-hero {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: linear-gradient(145deg, #101820 0%, #1f343a 40%, var(--color-primary) 100%);
  box-shadow: 0 20px 40px -15px rgba(16, 24, 32, 0.3);
  color: #ffffff;
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.profile-hero.is-entered {
  opacity: 1;
  transform: translateY(0);
}

.profile-hero__texture {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 160px;
  opacity: 0.1;
  color: currentColor;
  pointer-events: none;
}

.profile-hero__content {
  position: relative;
  z-index: 2;
  padding: var(--spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

@media (min-width: 768px) {
  .profile-hero__content {
    padding: var(--spacing-xl);
  }
}

/* ---- 头像与姓名信息 ---- */
.profile-hero__profile {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
}

.profile-hero__avatar-wrap {
  position: relative;
}

/* 渐变环头像（金 → 天空蓝 → 高原青） */
.profile-hero__avatar-ring {
  width: 96px;
  height: 96px;
  padding: 4px;
  border: none;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-gold), var(--color-sky), var(--color-primary));
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.2);
  cursor: pointer;
  display: block;
  transition: transform var(--duration-base) var(--ease-out);
}

@media (hover: hover) {
  .profile-hero__avatar-ring:hover {
    transform: scale(1.04);
  }
}

.profile-hero__avatar-ring:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 3px;
}

.profile-hero__avatar-ring img,
.avatar-fallback,
.avatar-guest {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-fallback {
  background: rgba(16, 24, 32, 0.55);
  font-size: var(--font-num-lg);
  font-weight: var(--font-weight-semibold);
  color: #ffffff;
}

.avatar-guest {
  background: rgba(16, 24, 32, 0.4);
  color: rgba(226, 232, 240, 0.8);
}

/* 右下角认证勾选 */
.profile-hero__verified {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-primary);
  border: 2px solid #101820;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
}

.profile-hero__avatar-remove {
  position: absolute;
  top: 0;
  left: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: var(--color-danger);
  color: #ffffff;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
}

.profile-hero__name-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.profile-hero__name {
  margin: 0;
  font-size: 32px;
  line-height: 1.2;
  font-weight: var(--font-weight-extrabold);
  letter-spacing: -0.02em;
  color: #ffffff;
  word-break: break-word;
}

.profile-hero__sub {
  margin: 0;
  font-size: var(--font-caption);
  font-weight: var(--font-weight-medium);
  color: rgba(204, 255, 250, 0.9);
}

/* ---- 个人属性简徽 ---- */
.profile-hero__attrs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  text-align: center;
}

.profile-hero__attr {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 10px 8px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.profile-hero__attr-label {
  font-size: 11px;
  color: rgba(148, 163, 184, 0.9);
}

.profile-hero__attr-value {
  font-size: var(--font-caption);
  font-weight: var(--font-weight-semibold);
  color: rgba(226, 232, 240, 0.95);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 编辑资料 ---- */
.profile-hero__edit {
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.1);
  font-family: inherit;
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: #ffffff;
  cursor: pointer;
  transition: background var(--transition-fast);
}

@media (hover: hover) {
  .profile-hero__edit:hover {
    background: rgba(255, 255, 255, 0.18);
  }
}

.profile-hero__edit:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
}
</style>
