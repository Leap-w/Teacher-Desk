<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  CalendarClock,
  CalendarRange,
  Cloud,
  Palette,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-vue-next'

import { AppButton, AppDrawer, AppField, AppInput, AppSection } from '@/components/ui'
import { useLoginModal } from '@/composables/useLoginModal'
import { useToast } from '@/composables/useToast'
import { useCloudSync } from '@/composables/useCloudSync'
import { useUserStore } from '@/stores/user'
import AboutCard from './components/AboutCard.vue'
import ProfileHero from './components/ProfileHero.vue'
import WorkTimeCard from './components/WorkTimeCard.vue'
import SettingsCell from './components/SettingsCell.vue'
import SettingsSection from './components/SettingsSection.vue'
import type { UserProfileInput } from '@/types/user'

/**
 * 我的（v3.0.4-rc · 对齐 Changdu-Memory `Profile.vue` 的排布）。
 *
 * **四块，自上而下**：
 * ① 个人信息（登录态驱动：已登录 = Profile Hero + 编辑；未登录 = 默认头像 + 尚未登录 + 登录按钮）
 * ② 工作时光（与首页 Hero 读同一份设置）
 * ③ 设置（**每一项都是一个入口，点进对应的二级设置页**——不再就地展开）
 * ④ 关于（页面底部：当前版本 / GitHub / 检查更新）
 *
 * 设置分组（v3.0.4-rc）：显示设置 / 教学设置 / 班级设置 / 学期与倒计时；
 * 原有设置项一项未删，只是从「就地展开」改成「一页一组」。
 * 数据与同步仍是单独一块的**一个入口**（云同步 / 导出 / 导入在那一页）。
 */
const toast = useToast()
const router = useRouter()
const userStore = useUserStore()
const { signedIn } = useCloudSync()
const loginModal = useLoginModal()

const profile = computed(() => userStore.profile)
const appVersion = import.meta.env.APP_VERSION

/** 设置入口（每一项 → 一个二级设置页） */
interface SettingEntry {
  key: string
  icon: LucideIcon
  title: string
  subtitle: string
  to: string
}

const settingEntries: SettingEntry[] = [
  {
    key: 'display',
    icon: Palette,
    title: '显示设置',
    subtitle: '深色模式 · 默认首页',
    to: '/my/settings/display',
  },
  {
    key: 'teaching',
    icon: CalendarClock,
    title: '教学设置',
    subtitle: '课程时间 · 座位图默认视角',
    to: '/my/settings/teaching',
  },
  {
    key: 'class',
    icon: UsersRound,
    title: '班级设置',
    subtitle: '请假 · 值日 · 周末返校',
    to: '/my/settings/class',
  },
  {
    key: 'term',
    icon: CalendarRange,
    title: '学期与倒计时',
    subtitle: '支教日期 · 学期起止 · Hero 背景与文案',
    to: '/my/settings/term',
  },
]

/* ---------- 头像（仅登录后可见入口） ---------- */

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
    if (typeof reader.result !== 'string') return
    const outcome = userStore.setAvatar(reader.result)
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

/* ---------- 编辑资料抽屉（登录后才有入口） ---------- */

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

/* ---------- 未登录 ---------- */

function openLogin(): void {
  loginModal.show()
}

/* ---------- 关于 ---------- */

function checkUpdate(): void {
  toast.info(`当前已是最新版本 ${appVersion}`)
}
</script>

<template>
  <div class="my-page">
    <header class="page-head">
      <h1 class="page-head__title">我的</h1>
      <p class="page-head__sub">班主任的个人工作中心</p>
    </header>

    <!-- ===== ① 个人信息（登录态驱动） ===== -->
    <AppSection title="个人信息">
      <ProfileHero
        v-if="signedIn"
        :profile="profile"
        :initial="userStore.initial"
        @edit="openProfileEditor"
        @pick-avatar="pickAvatar"
        @remove-avatar="removeAvatar"
      >
        <template #avatar-input>
          <input
            ref="avatarInput"
            type="file"
            accept="image/*"
            class="avatar-input"
            @change="onAvatarPicked"
          />
        </template>
      </ProfileHero>

      <!-- 未登录：默认头像 + 尚未登录 + 登录按钮（编辑入口全部隐藏） -->
      <div v-else class="guest-card">
        <span class="guest-card__avatar" aria-hidden="true">
          <UserRound :size="30" :stroke-width="1.8" />
        </span>
        <div class="guest-card__main">
          <p class="guest-card__title">尚未登录</p>
          <p class="guest-card__hint">登录后同步 TeacherDesk 数据</p>
        </div>
        <AppButton type="button" @click="openLogin">登录</AppButton>
      </div>
    </AppSection>

    <!-- ===== ② 工作时光（与首页 Hero 同一份数据） ===== -->
    <AppSection>
      <WorkTimeCard />
    </AppSection>

    <!-- ===== ③ 设置（每项一个入口，点进二级设置页） ===== -->
    <AppSection title="设置">
      <div class="settings-stack">
        <SettingsSection title="设置">
          <SettingsCell
            v-for="entry in settingEntries"
            :key="entry.key"
            :icon="entry.icon"
            :title="entry.title"
            :subtitle="entry.subtitle"
            @click="router.push(entry.to)"
          />
        </SettingsSection>

        <!-- 数据与同步：唯一入口（云同步 / 导出 / 导入在那一页） -->
        <SettingsSection title="数据与同步">
          <SettingsCell
            :icon="Cloud"
            icon-tone="neutral"
            title="数据与同步"
            subtitle="云同步 · 导出数据 · 导入数据"
            @click="router.push('/my/tools')"
          />
        </SettingsSection>
      </div>
    </AppSection>

    <!-- ===== ④ 关于（页面底部） ===== -->
    <AppSection title="关于" class="my-page__about">
      <AboutCard @check-update="checkUpdate" />
    </AppSection>

    <!-- 编辑资料抽屉（登录后） -->
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
  </div>
</template>

<style scoped>
.my-page {
  max-width: var(--page-max-width);
  margin: 0 auto;
}

/* ---- 页面头（与昌都记忆 profile__header 同一层级：32px + 分割线） ---- */
.page-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0 4px var(--spacing-lg);
  border-bottom: var(--border-hairline-width) solid var(--color-border);
}

.page-head__title {
  font-size: var(--font-page-title);
  font-weight: var(--font-weight-bold);
  line-height: var(--leading-tight);
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
}

.page-head__sub {
  font-size: var(--font-content);
  color: var(--color-text-secondary);
}

.avatar-input {
  display: none;
}

/* ---- 设置栈：分组之间统一留白（昌都记忆 Settings 列表间距） ---- */
.settings-stack {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

/* 编辑资料抽屉表单 */
.profile-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-card);
}

/* ---- 未登录空状态卡 ---- */
.guest-card {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  background: var(--color-bg-white);
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
}

.guest-card__avatar {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--color-sky-light);
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.guest-card__main {
  flex: 1;
  min-width: 0;
}

.guest-card__title {
  margin: 0;
  font-size: var(--font-section-title);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.guest-card__hint {
  margin: 4px 0 0;
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.my-page__about {
  margin-bottom: 0;
}
</style>
