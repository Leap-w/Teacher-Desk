<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Monitor, Moon, Sun, UserRound } from 'lucide-vue-next'

import {
  AppButton,
  AppDrawer,
  AppField,
  AppInput,
  AppSection,
  AppSwitch,
  AppSegmented,
} from '@/components/ui'
import { useCountdownSettings, HERO_BACKGROUNDS } from '@/composables/useCountdownSettings'
import { useLoginModal } from '@/composables/useLoginModal'
import { useToast } from '@/composables/useToast'
import { useTheme } from '@/composables/useTheme'
import { useCloudSync } from '@/composables/useCloudSync'
import { COURSE_PERIODS } from '@/types/timetable'
import { useUserStore } from '@/stores/user'
import AboutCard from './components/AboutCard.vue'
import ProfileHero from './components/ProfileHero.vue'
import WorkTimeCard from './components/WorkTimeCard.vue'
import SettingsCell from './components/SettingsCell.vue'
import SettingsSection from './components/SettingsSection.vue'
import type { UserProfileInput } from '@/types/user'

/**
 * 我的（v3.0.2-rc 重做）——单页四区：
 * ① 个人信息（登录态驱动：已登录 = Hero + 编辑；未登录 = 空状态 + 立即登录）
 * ② 工作时光（一张大卡：支教天数 / 学期进度）
 * ③ 偏好设置（只放个人偏好：深色模式 / 首页倒计时与 Hero 背景 / 课程时间 / 默认视图）
 * ④ 关于
 * 数据管理 / 云同步 / 工具箱入口全部迁出（数据与同步在工具箱页，课堂工具有独立页）。
 */
const toast = useToast()
const userStore = useUserStore()
const countdown = useCountdownSettings()
const { theme, effective, setTheme } = useTheme()
const { signedIn } = useCloudSync()
const loginModal = useLoginModal()

const profile = computed(() => userStore.profile)
const appVersion = import.meta.env.APP_VERSION

const THEME_OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
] as const

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

/* ---------- 偏好设置 ---------- */

const courseTimeValue = computed(
  () => `${COURSE_PERIODS.length} 个时间段 · ${COURSE_PERIODS[0]!.startTime} 首课`,
)

function soonRow(): void {
  toast.info('这个设置还在开发中，敬请期待')
}

/* ---------- 关于 ---------- */

function checkUpdate(): void {
  toast.info(`当前已是最新版本 ${appVersion}`)
}

onMounted(() => {
  // 占位：保持 onMounted 生命周期显式（头像 input ref 由模板持有）
})
</script>

<template>
  <div class="my-page">
    <div class="page-head">
      <h1 class="page-head__title">我的</h1>
      <p class="page-head__sub">班主任的个人工作中心与控制中心</p>
    </div>

    <!-- ===== 第一部分：个人信息（登录态驱动） ===== -->
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

      <!-- 未登录：空状态（默认头像 + 立即登录；编辑入口全部隐藏） -->
      <div v-else class="guest-card">
        <span class="guest-card__avatar" aria-hidden="true">
          <UserRound :size="30" :stroke-width="1.8" />
        </span>
        <div class="guest-card__main">
          <p class="guest-card__title">尚未登录</p>
          <p class="guest-card__hint">登录后同步 TeacherDesk 数据</p>
        </div>
        <AppButton type="button" @click="openLogin">立即登录</AppButton>
      </div>
    </AppSection>

    <!-- ===== 第二部分：工作时光（一张大卡） ===== -->
    <AppSection title="工作时光">
      <WorkTimeCard />
    </AppSection>

    <!-- ===== 第三部分：偏好设置（只放个人偏好） ===== -->
    <AppSection title="偏好设置">
      <SettingsSection title="外观">
        <div class="pref-row">
          <span class="pref-row__label">深色模式</span>
          <!-- 不用 v-model：显式走 setTheme（落盘 + 应用一次完成） -->
          <AppSegmented
            :model-value="theme"
            :options="[...THEME_OPTIONS]"
            label="深色模式偏好"
            @update:model-value="setTheme($event)"
          />
        </div>
        <p class="pref-row__hint">
          <component
            :is="theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor"
            :size="14"
            :stroke-width="2"
            aria-hidden="true"
          />
          <span v-if="theme === 'system'">
            跟随系统：系统切换深浅时应用实时跟随（当前{{
              effective === 'dark' ? '深色' : '浅色'
            }}）</span
          >
          <span v-else>已固定为{{ theme === 'dark' ? '深色' : '浅色' }}主题，无需刷新</span>
        </p>
      </SettingsSection>

      <SettingsSection title="首页">
        <SettingsCell title="课程时间设置" :subtitle="courseTimeValue" />
        <SettingsCell title="首页默认视图" badge-text="开发中" @click="soonRow" />
        <SettingsCell title="座位图默认视角" badge-text="开发中" @click="soonRow" />
        <div class="time-form">
          <AppField label="倒计时标题">
            <AppInput
              :model-value="countdown.settings.value.title"
              placeholder="如 距离期末考试"
              @update:model-value="countdown.update({ title: $event })"
            />
          </AppField>
          <div class="time-form__dates">
            <AppField label="开始日期">
              <AppInput
                type="date"
                :model-value="countdown.settings.value.startDate"
                @update:model-value="countdown.update({ startDate: String($event) })"
              />
            </AppField>
            <AppField label="目标日期">
              <AppInput
                type="date"
                :model-value="countdown.settings.value.targetDate"
                @update:model-value="countdown.update({ targetDate: String($event) })"
              />
            </AppField>
          </div>

          <AppField label="Hero 背景">
            <div class="bg-presets">
              <button
                v-for="preset in HERO_BACKGROUNDS"
                :key="preset.id"
                type="button"
                class="bg-presets__item"
                :class="{ 'is-active': countdown.settings.value.background === preset.url }"
                @click="countdown.update({ background: preset.url })"
              >
                <img class="bg-presets__thumb" :src="preset.url" alt="" />
                <span class="bg-presets__label">{{ preset.label }}</span>
              </button>
            </div>
            <AppInput
              class="bg-custom"
              :model-value="
                HERO_BACKGROUNDS.some((p) => p.url === countdown.settings.value.background)
                  ? ''
                  : countdown.settings.value.background
              "
              placeholder="自定义背景图 URL（可选）"
              @update:model-value="countdown.update({ background: String($event) })"
            />
          </AppField>

          <div class="time-form__switch">
            <span class="time-form__switch-label">显示进度与百分比</span>
            <AppSwitch
              :model-value="countdown.settings.value.showProgress"
              label="显示进度"
              @update:model-value="countdown.update({ showProgress: $event })"
            />
          </div>
          <p class="time-form__hint">
            已过去 {{ countdown.daysPassed.value }} 天 · 剩余 {{ countdown.daysRemaining.value }} 天
            · 完成 {{ countdown.progress.value }}%（自动计算，无需手动修改）
          </p>
        </div>
      </SettingsSection>

      <!-- ===== 第四部分：关于 ===== -->
      <div class="my-page__about">
        <AboutCard @check-update="checkUpdate" />
      </div>
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

/* ---- 页面头 ---- */
.page-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0 4px var(--spacing-lg);
  border-bottom: var(--border-hairline-width) solid var(--color-border);
}

.page-head__title {
  font-size: var(--font-page-title);
  font-weight: var(--font-weight-semibold);
  line-height: var(--leading-tight);
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
}

.page-head__sub {
  font-size: var(--font-content);
  color: var(--color-text-secondary);
}

/* ---- 次级导航（我的 ｜ 功能设置；与 ModuleLayout tabs 同款） ---- */
.my-tabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  margin: var(--spacing-lg) 0 var(--spacing-xl);
  background: var(--color-border-light);
  border-radius: var(--radius-full);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  align-self: flex-start;
}

.my-tabs--sub {
  margin: 0 0 var(--spacing-lg);
}

.my-tab {
  padding: 7px 18px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
  user-select: none;
  font-family: inherit;
  font-size: inherit;
  font-weight: inherit;
}

.my-tab:hover:not(.is-active) {
  color: var(--color-text-primary);
  background: var(--bg-hover);
}

.my-tab.is-active {
  background: var(--bg-card);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-xs);
  font-weight: var(--font-weight-semibold);
}

.my-tab:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

/* ---- Control Center 布局：桌面双列（主列层级高，侧列放低频） ---- */
.cc-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
}

.cc-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.cc-side {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  align-content: start;
}

@media (min-width: 960px) {
  .cc-layout {
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    align-items: start;
  }
}

.avatar-input {
  display: none;
}

/* ---- 功能设置 Tab ---- */
.settings-pane {
  display: flex;
  flex-direction: column;
}

.settings-card {
  padding: var(--space-2) 0;
  background: var(--bg-card);
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}

/* 时间设置表单 */
.time-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-card);
  padding: var(--space-3);
}

.time-form__dates {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--spacing-card);
}

.bg-presets {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-bottom: var(--space-2);
}

.bg-presets__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border: 2px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  transition: border-color var(--transition-fast);
}

.bg-presets__item.is-active {
  border-color: var(--color-primary);
}

.bg-presets__thumb {
  width: 88px;
  height: 52px;
  object-fit: cover;
  border-radius: var(--radius-xs);
  display: block;
}

.bg-presets__label {
  font-size: var(--font-caption);
  color: var(--color-text-secondary);
}

.bg-custom {
  margin-top: var(--space-2);
}

.time-form__switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--color-fill-disabled);
  border-radius: var(--radius-md);
}

.time-form__switch-label {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.time-form__hint {
  margin: 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* 编辑资料抽屉表单 */
.profile-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-card);
}

/* ---- 外观（深色模式） ---- */
.appearance-pane {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.appearance-pane__hint {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-tertiary);
}

.appearance-pane__hint svg {
  flex-shrink: 0;
}

/* ---- 未登录空状态卡（v3.0.2-rc） ---- */
.guest-card {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  background: var(--bg-card);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
}

.guest-card__avatar {
  width: 56px;
  height: 56px;
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
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.guest-card__hint {
  margin: 4px 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-tertiary);
}

/* ---- 偏好行 ---- */
.pref-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.pref-row__label {
  font-size: var(--text-md);
  color: var(--color-text-primary);
}

.pref-row__hint {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-tertiary);
}

.my-page__about {
  margin-top: var(--spacing-md);
}
</style>
