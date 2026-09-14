<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PencilLine, User, X } from 'lucide-vue-next'

import type { UserProfile } from '@/types/user'

/**
 * ProfileHero — 个人身份 Hero（V2.1.0-beta · Phase UI-5C）：
 * Control Center 第一层：头像（上传/删除逻辑经事件上抛，原逻辑不变）+
 * 姓名 + 身份（班级班主任 / 学科教师 / 学校）。不放设置按钮。
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

/** 身份行：字段为空就整行不显示——绝不渲染「 · 班主任」这种半截身份 */
const roleLine = computed(() =>
  props.profile.className.trim() ? `${props.profile.className} · 班主任` : '',
)
const subjectLine = computed(() =>
  props.profile.subject.trim() ? `${props.profile.subject} · 教师` : '',
)
</script>

<template>
  <section class="profile-hero" :class="{ 'is-entered': entered }">
    <div class="hero-avatar-wrap">
      <button
        type="button"
        class="hero-avatar"
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
        class="avatar-remove"
        aria-label="删除头像"
        @click="emit('remove-avatar')"
      >
        <X :size="12" :stroke-width="2" aria-hidden="true" />
      </button>
      <slot name="avatar-input" />
    </div>

    <div class="hero-main">
      <h2 class="hero-name">
        {{ props.profile.nickname.trim() || '尚未设置资料' }}
      </h2>
      <p v-if="roleLine || subjectLine" class="hero-roles">
        <span v-if="roleLine" class="role-chip is-primary">{{ roleLine }}</span>
        <span v-if="subjectLine" class="role-chip">{{ subjectLine }}</span>
      </p>
      <p v-if="props.profile.school" class="hero-school">{{ props.profile.school }}</p>
      <p v-if="!props.profile.nickname.trim()" class="hero-hint">
        填写称呼、学校与任教学科，让各页面正确称呼你
      </p>
    </div>

    <button type="button" class="hero-edit" @click="emit('edit')">
      <PencilLine :size="14" :stroke-width="2" aria-hidden="true" />
      编辑资料
    </button>
  </section>
</template>

<style scoped>
.profile-hero {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-5) var(--space-6);
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-xl);
  background: linear-gradient(135deg, var(--color-primary-bg) 0%, var(--bg-card) 60%);
  box-shadow: var(--shadow-xs);
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

.hero-avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.hero-avatar {
  width: 84px;
  height: 84px;
  padding: 3px;
  border: none;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-gold), var(--color-sky), var(--color-primary));
  box-shadow: var(--shadow-md);
  cursor: pointer;
  transition: transform var(--duration-base) var(--ease-out);
}

.hero-avatar:hover {
  transform: scale(1.04);
}

.hero-avatar:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.hero-avatar img,
.avatar-fallback {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}

.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    145deg,
    color-mix(in srgb, var(--color-primary-dark) 82%, var(--color-text-primary)),
    var(--color-primary-dark)
  );
  font-size: var(--font-num-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-inverse);
}

.avatar-remove {
  position: absolute;
  top: 0;
  right: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: var(--color-danger);
  color: var(--color-text-inverse);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
}

.hero-main {
  flex: 1;
  min-width: 0;
}

.hero-name {
  margin: 0 0 var(--space-1);
  font-size: 28px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
}

.hero-roles {
  margin: 0;
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.role-chip {
  padding: 4px 12px;
  border-radius: var(--radius-full);
  background: var(--color-fill-disabled);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.role-chip.is-primary {
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
}

.hero-school {
  margin: var(--space-2) 0 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.hero-edit {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: var(--border-hairline-width) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--bg-card);
  font-family: inherit;
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast),
    transform var(--duration-base) var(--ease-out);
}

.hero-edit:hover {
  background: var(--bg-hover);
  color: var(--color-text-primary);
  transform: translateY(-1px);
}

.hero-edit:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

@media (max-width: 640px) {
  .profile-hero {
    flex-direction: column;
    text-align: center;
    padding: var(--space-5) var(--space-4);
  }

  .hero-roles {
    justify-content: center;
  }
}

/* 未设置资料的引导行（浅色 tertiary，不抢「编辑资料」的注意力） */
.hero-hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-tertiary);
}

/* 无头像且无昵称首字时的用户图标占位 */
.avatar-guest {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
}
</style>
