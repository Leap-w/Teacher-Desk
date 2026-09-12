<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import { AppBadge, AppButton, AppDrawer, AppField, AppInput, AppModal } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useUserStore, identityLineOf } from '@/stores/user'
import { appConfig } from '@/config'
import type { UserProfileInput } from '@/types/user'

/**
 * 「我的」个人中心（V1.1.6）：顶部身份卡 + 四组功能卡（个人信息 / 工作设置 / 工具 / 系统）。
 * 工具箱整页迁到 /my/tools（本页的「工具箱」项只是入口）；设置统一在 /my/settings，
 * 各功能页右上角的 ⚙ 也跳过去——设置页面只有一套。
 */
const router = useRouter()
const toast = useToast()
const userStore = useUserStore()

const profile = computed(() => userStore.profile)
const identityLine = computed(() => identityLineOf(profile.value))

/* ---------- 头像 ---------- */

const avatarInput = ref<HTMLInputElement>()
const MAX_AVATAR_BYTES = 1024 * 1024 // 与 store 的 dataURL 上限同口径

function pickAvatar(): void {
  avatarInput.value?.click()
}

function onAvatarPicked(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 选同一个文件两次也要能触发 change
  if (!file) return
  if (!file.type.startsWith('image/')) {
    toast.danger('请选择图片文件')
    return
  }
  if (file.size > MAX_AVATAR_BYTES) {
    toast.danger('图片太大（超过 1MB），请换一张小一点的')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : ''
    const outcome = userStore.setAvatar(result)
    if (!outcome.ok) {
      toast.danger(outcome.reason)
      return
    }
    toast.success('头像已更新')
  }
  reader.onerror = () => toast.danger('图片读取失败，请重试')
  reader.readAsDataURL(file)
}

function removeAvatar(): void {
  userStore.removeAvatar()
  toast.success('已删除头像')
}

/* ---------- 编辑资料抽屉 ---------- */

const drawerOpen = ref(false)
const form = ref<UserProfileInput>({ nickname: '', school: '', className: '', subject: '' })

function openProfileEditor(): void {
  form.value = {
    nickname: profile.value.nickname,
    school: profile.value.school,
    className: profile.value.className,
    subject: profile.value.subject,
  }
  drawerOpen.value = true
}

function submitProfile(): void {
  const outcome = userStore.updateProfile(form.value)
  if (!outcome.ok) {
    toast.danger(outcome.reason)
    return
  }
  drawerOpen.value = false
  toast.success('资料已更新')
}

/* ---------- 功能分组 ---------- */

interface Row {
  key: string
  icon: string
  label: string
  value?: string
  /** 点击行为：跳路由；placeholder 行无跳转（开发中） */
  to?: string
  soon?: boolean
}

const settingRows: Row[] = [
  {
    key: 'work',
    icon: '📋',
    label: '课程表设置',
    value: '课程时间 · 默认视图',
    to: '/my/settings?module=work',
  },
  {
    key: 'seats',
    icon: '🪑',
    label: '座位管理设置',
    value: '教室布局 · 导出视角',
    to: '/my/settings?module=seats',
  },
  {
    key: 'leave',
    icon: '📝',
    label: '请假管理设置',
    value: '默认返校时间 · 显示方式',
    to: '/my/settings?module=leave',
  },
  {
    key: 'duty',
    icon: '🧹',
    label: '值日管理设置',
    value: '默认分组 · 默认循环',
    to: '/my/settings?module=duty',
  },
  {
    key: 'weekend',
    icon: '🧳',
    label: '周末管理设置',
    value: '返校提醒',
    to: '/my/settings?module=weekend',
  },
]

const systemRows: Row[] = [
  { key: 'theme', icon: '🎨', label: '主题', value: '松石青 · 浅色', soon: true },
  { key: 'sync', icon: '☁️', label: '数据同步', value: '云端同步 · 本机缓存', to: '/my/tools' },
  { key: 'backup', icon: '💾', label: '备份与恢复', value: '导出 · 导入 · 合并', to: '/my/tools' },
  {
    key: 'about',
    icon: 'ℹ️',
    label: '关于 TeacherDesk',
    value: `v${appConfig.version}`,
    to: 'about',
  },
]

function openRow(row: Row): void {
  if (row.soon || !row.to) {
    toast.info('这个设置还在开发中，敬请期待')
    return
  }
  if (row.to === 'about') {
    aboutOpen.value = true
    return
  }
  router.push(row.to)
}

/* ---------- 关于 ---------- */

const aboutOpen = ref(false)
</script>

<template>
  <div class="my-page">
    <!-- 顶部身份卡：渐变松石青 + 圆头像 -->
    <header class="profile-hero">
      <div class="avatar-wrap">
        <button
          type="button"
          class="avatar-button"
          :aria-label="profile.avatar ? '更换头像' : '上传头像'"
          @click="pickAvatar"
        >
          <img v-if="profile.avatar" :src="profile.avatar" alt="我的头像" class="avatar-img" />
          <span v-else class="avatar-fallback" aria-hidden="true">{{ userStore.initial }}</span>
          <span class="avatar-edit-hint" aria-hidden="true">📷</span>
        </button>
        <button
          v-if="profile.avatar"
          type="button"
          class="avatar-remove"
          aria-label="删除头像"
          @click="removeAvatar"
        >
          ✕
        </button>
        <input
          ref="avatarInput"
          type="file"
          accept="image/*"
          class="avatar-input"
          @change="onAvatarPicked"
        />
      </div>

      <p class="profile-name">{{ profile.nickname }}</p>
      <p class="profile-identity">{{ identityLine }}</p>
      <p class="profile-school">{{ profile.school }}</p>

      <AppButton variant="secondary" size="sm" class="edit-button" @click="openProfileEditor">
        ✏️ 编辑资料
      </AppButton>
    </header>

    <!-- 分组功能卡 -->
    <div class="group-stack">
      <section class="group-card">
        <h2 class="group-title">个人信息</h2>
        <button type="button" class="profile-row" @click="openProfileEditor">
          <span class="row-icon" aria-hidden="true">👤</span>
          <span class="row-main">
            <span class="row-label">昵称 · 学校 · 班级 · 任教学科</span>
            <span class="row-value"
              >{{ profile.nickname }} · {{ profile.className }} · {{ profile.subject }}</span
            >
          </span>
          <span class="row-chevron" aria-hidden="true">›</span>
        </button>
      </section>

      <section class="group-card">
        <h2 class="group-title">工作设置</h2>
        <button
          v-for="row in settingRows"
          :key="row.key"
          type="button"
          class="profile-row"
          @click="openRow(row)"
        >
          <span class="row-icon" aria-hidden="true">{{ row.icon }}</span>
          <span class="row-main">
            <span class="row-label">{{ row.label }}</span>
            <span class="row-value">{{ row.value }}</span>
          </span>
          <span class="row-chevron" aria-hidden="true">›</span>
        </button>
      </section>

      <section class="group-card">
        <h2 class="group-title">工具</h2>
        <button type="button" class="profile-row" @click="router.push('/my/tools')">
          <span class="row-icon" aria-hidden="true">🧰</span>
          <span class="row-main">
            <span class="row-label">工具箱</span>
            <span class="row-value">备份恢复 · 数据同步 · 清空数据</span>
          </span>
          <span class="row-chevron" aria-hidden="true">›</span>
        </button>
      </section>

      <section class="group-card">
        <h2 class="group-title">系统</h2>
        <button
          v-for="row in systemRows"
          :key="row.key"
          type="button"
          class="profile-row"
          @click="openRow(row)"
        >
          <span class="row-icon" aria-hidden="true">{{ row.icon }}</span>
          <span class="row-main">
            <span class="row-label">{{ row.label }}</span>
            <span class="row-value">{{ row.value }}</span>
            <AppBadge v-if="row.soon" variant="neutral" size="sm">开发中</AppBadge>
          </span>
          <span class="row-chevron" aria-hidden="true">›</span>
        </button>
      </section>
    </div>

    <!-- 编辑资料抽屉 -->
    <AppDrawer v-model="drawerOpen" title="编辑资料" :width="420">
      <form id="profile-form" class="profile-form" @submit.prevent="submitProfile">
        <AppField label="昵称" required hint="页面上这样称呼你">
          <AppInput v-model="form.nickname" placeholder="如 王老师" />
        </AppField>
        <AppField label="学校">
          <AppInput v-model="form.school" placeholder="如 昌都市第三高级中学" />
        </AppField>
        <AppField label="当前班级" hint="只影响「我的」页展示，不影响学生档案">
          <AppInput v-model="form.className" placeholder="如 高一9班" />
        </AppField>
        <AppField label="任教学科" hint="只影响展示，不影响课程表">
          <AppInput v-model="form.subject" placeholder="如 数学" />
        </AppField>
      </form>
      <template #footer>
        <AppButton variant="ghost" @click="drawerOpen = false">取消</AppButton>
        <AppButton type="submit" form="profile-form">保存</AppButton>
      </template>
    </AppDrawer>

    <!-- 关于 -->
    <AppModal v-model="aboutOpen" title="关于 TeacherDesk" :width="380">
      <div class="about-body">
        <p class="about-name">{{ appConfig.name }}</p>
        <p class="about-version">版本 v{{ appConfig.version }}</p>
        <p class="about-text">
          高中班主任的工作台：学生档案、座位、课表、值日、请假与周末管理，数据保存在本机。
        </p>
      </div>
      <template #footer>
        <AppButton @click="aboutOpen = false">好的</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.my-page {
  max-width: 640px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* ---- 顶部身份卡 ---- */
.profile-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-7) var(--space-4) var(--space-6);
  border-radius: var(--radius-lg);
  background: linear-gradient(160deg, var(--color-primary) 0%, var(--color-primary-strong) 100%);
  color: #ffffff;
  box-shadow: var(--shadow-md);
}

.avatar-wrap {
  position: relative;
  margin-bottom: var(--space-2);
}

.avatar-button {
  position: relative;
  width: 120px;
  height: 120px;
  padding: 0;
  border: 3px solid rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  box-shadow: var(--shadow-md);
  cursor: pointer;
  overflow: hidden;
  transition:
    transform var(--transition-fast),
    box-shadow var(--transition-fast);
}

.avatar-button:hover {
  transform: scale(1.04);
  box-shadow: var(--shadow-lg);
}

.avatar-button:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.avatar-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 44px;
  font-weight: 700;
  color: #ffffff;
}

.avatar-edit-hint {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  font-size: 14px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.avatar-button:hover .avatar-edit-hint {
  opacity: 1;
}

.avatar-remove {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: var(--color-danger-strong);
  color: #ffffff;
  font-size: 12px;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
}

.avatar-input {
  display: none;
}

.profile-name {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: -0.3px;
}

.profile-identity {
  margin: 0;
  font-size: var(--text-sm);
  opacity: 0.92;
}

.profile-school {
  margin: 0;
  font-size: var(--text-xs);
  opacity: 0.78;
}

.edit-button {
  margin-top: var(--space-3);
}

/* ---- 分组功能卡 ---- */
.group-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.group-card {
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.group-title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-faint);
}

.profile-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.profile-row:hover {
  background: var(--color-fill-disabled);
}

.profile-row:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.row-icon {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--color-primary-soft);
  font-size: 16px;
}

.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.row-value {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-chevron {
  flex-shrink: 0;
  color: var(--color-text-faint);
  font-size: var(--text-lg);
  line-height: 1;
}

/* ---- 关于 ---- */
.about-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  text-align: center;
  padding: var(--space-3) 0;
}

.about-name {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--color-primary-strong);
}

.about-version {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

.about-text {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

/* ---- 移动端：头像 96px ---- */
@media (max-width: 759.98px) {
  .avatar-button {
    width: 96px;
    height: 96px;
  }

  .avatar-fallback {
    font-size: 36px;
  }
}
</style>
