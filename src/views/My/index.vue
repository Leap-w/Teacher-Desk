<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CalendarClock, CalendarRange, Cloud, Palette, UsersRound } from 'lucide-vue-next'

import { AppButton, AppDrawer, AppField, AppInput } from '@/components/ui'
import { useLoginModal } from '@/composables/useLoginModal'
import { useToast } from '@/composables/useToast'
import { useCloudSync } from '@/composables/useCloudSync'
import { useUserStore } from '@/stores/user'
import AboutCard from './components/AboutCard.vue'
import ProfileHero from './components/ProfileHero.vue'
import ProfileMenuCard from './components/ProfileMenuCard.vue'
import WorkTimeCard from './components/WorkTimeCard.vue'
import type { ProfileMenuItem } from './components/ProfileMenuCard.vue'
import type { UserProfileInput } from '@/types/user'

/**
 * 我的（v3.0.4-rc 起；**v3.0.5-rc 按 Changdu-Memory `Profile.vue` 重排**）。
 *
 * **页面骨架与昌都记忆「我的档案」一一对应**（不再自己排版）：
 * `div.profile` → `div.profile__header`（大标题 + 说明 + 底部细线）
 * → `div.profile__grid`（`grid-template-areas` 排布，桌面 `4fr 8fr` 两列）
 * → 四张卡：Hero / 工作时光 / 功能入口 / 关于。
 *
 * 桌面排布（照参考版把左列卡片与右列卡片的底边对齐）：
 * ```
 * 'hero  time'
 * 'hero  menu'
 * 'about menu'
 * ```
 * 移动端单列，顺序就是需求里的 ① Hero → ② 工作时光 → ③ 功能入口 → ④ 关于。
 *
 * **设置不再就地展开**：所有开关与日期都在各自的二级页里（显示 / 教学 / 班级 /
 * 学期与倒计时 / 数据与同步），这一页只负责把它们摆成入口。
 *
 * 未登录时页面**不换成另一张卡**：Hero 还是那张深色卡，只是卡里放
 * 默认头像 / 尚未登录 / 登录按钮（点它唤起全局登录弹窗，不跳空页面）。
 */
const toast = useToast()
const router = useRouter()
const userStore = useUserStore()
const { signedIn } = useCloudSync()
const loginModal = useLoginModal()

const profile = computed(() => userStore.profile)
const appVersion = import.meta.env.APP_VERSION

/** 功能入口（每一项 → 一个独立页面，卡内一行） */
const menuItems: ProfileMenuItem[] = [
  {
    key: 'display',
    label: '显示设置',
    desc: '深色模式 · 默认首页',
    icon: Palette,
    tone: 'display',
    to: '/my/settings/display',
  },
  {
    key: 'teaching',
    label: '教学设置',
    desc: '课程时间 · 座位图默认视角',
    icon: CalendarClock,
    tone: 'teaching',
    to: '/my/settings/teaching',
  },
  {
    key: 'class',
    label: '班级设置',
    desc: '请假 · 值日 · 周末返校',
    icon: UsersRound,
    tone: 'class',
    to: '/my/settings/class',
  },
  {
    key: 'term',
    label: '学期与倒计时',
    desc: '日期 · Hero 背景与文案',
    icon: CalendarRange,
    tone: 'term',
    to: '/my/settings/term',
  },
  {
    key: 'data',
    label: '数据与同步',
    desc: '云同步 · 导出 · 导入',
    icon: Cloud,
    tone: 'data',
    to: '/my/tools',
  },
]

function onMenuSelect(item: ProfileMenuItem): void {
  void router.push(item.to)
}

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

/* ---------- 未登录：唤起全局登录弹窗（不跳路由） ---------- */

function openLogin(): void {
  loginModal.show()
}

/* ---------- 关于 ---------- */

function checkUpdate(): void {
  toast.info(`当前已是最新版本 ${appVersion}`)
}
</script>

<template>
  <div class="profile">
    <!-- ====== 页面头（与昌都记忆 profile__header 同一层级） ====== -->
    <div class="profile__header">
      <div class="profile__header-titles">
        <h1 class="profile__header-title">我的</h1>
        <p class="profile__header-sub">班主任的个人工作中心</p>
      </div>
    </div>

    <!-- ====== 桌面两列 / 移动单列（grid-template-areas） ====== -->
    <div class="profile__grid">
      <!-- ① 个人身份 Hero（登录 / 未登录共用这一张深色卡） -->
      <ProfileHero
        class="profile-hero-area"
        :signed-in="signedIn"
        :profile="profile"
        :initial="userStore.initial"
        @edit="openProfileEditor"
        @pick-avatar="pickAvatar"
        @remove-avatar="removeAvatar"
        @login="openLogin"
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

      <!-- ② 工作时光（与首页 Hero 同一份数据） -->
      <WorkTimeCard class="time-area" />

      <!-- ③ 功能入口（每一项进独立页面，卡内一行） -->
      <ProfileMenuCard
        class="menu-area"
        title="功能入口"
        :items="menuItems"
        @select="onMenuSelect"
      />

      <!-- ④ 关于（页面最底部：当前版本 / GitHub / 检查更新） -->
      <AboutCard class="about-area" @check-update="checkUpdate" />
    </div>

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
/* ================================================
   我的 — 骨架对齐 Changdu-Memory Profile.vue
   ================================================ */
.profile {
  max-width: var(--page-max-width);
  margin: 0 auto;
}

/* ---- 页面头 ---- */
.profile__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 0 4px 14px;
  margin-bottom: var(--spacing-xl);
  border-bottom: var(--border-hairline-width) solid var(--color-border);
}

.profile__header-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.profile__header-title {
  margin: 0;
  font-size: var(--font-page-title);
  font-weight: var(--font-weight-extrabold);
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
}

.profile__header-sub {
  margin: 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

/* ==========================================
   Layout grid
   ========================================== */
.profile__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--spacing-xl);
  /* 移动端（默认）卡片顺序：Hero → 工作时光 → 功能入口 → 关于
     用 grid-template-areas 而非 display:contents，兼容性更好（移动浏览器 / 内置 WebView 也生效） */
  grid-template-areas:
    'hero'
    'time'
    'menu'
    'about';
}

.profile-hero-area {
  grid-area: hero;
}

.time-area {
  grid-area: time;
}

.menu-area {
  grid-area: menu;
}

.about-area {
  grid-area: about;
}

@media (min-width: 1024px) {
  .profile__grid {
    /* 左列（4fr）：Hero + 关于；右列（8fr）：工作时光 + 功能入口
       hero 跨 1-2 行、menu 跨 2-3 行，让「关于」的底边与「功能入口」的底边对齐
       （参考版是 'about features'，同一个手法） */
    grid-template-columns: 4fr 8fr;
    grid-template-areas:
      'hero time'
      'hero menu'
      'about menu';
    align-items: stretch;
  }
}

.avatar-input {
  display: none;
}

/* 编辑资料抽屉表单 */
.profile-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-card);
}
</style>
