<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Armchair,
  ClipboardList,
  Cloud,
  Database,
  Info,
  Luggage,
  NotebookPen,
  Paintbrush,
  Palette,
  UserRound,
  type LucideIcon,
} from 'lucide-vue-next'

import {
  AppBadge,
  AppButton,
  AppDrawer,
  AppField,
  AppInput,
  AppModal,
  AppSection,
} from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useDashboardStore } from '@/stores/dashboard'
import { useLeaveStore } from '@/stores/leave'
import { useStudentStore } from '@/stores/student'
import { useUserStore } from '@/stores/user'
import { appConfig } from '@/config'
import type { UserProfileInput } from '@/types/user'

/**
 * 「我的」个人中心（V1.3.0，昌都记忆双栏版）：
 * 左侧竖版渐变信息卡（头像 / 姓名 / 身份 / 学校 / 两枚胶囊），
 * 右侧工作时光（三张统计卡 + 渐变进度条 + 时间轴）→ 工作数据（四宫格）→ 功能菜单。
 * 业务逻辑（头像上传 / 资料编辑 / 路由跳转 / 关于弹窗）与 V1.1.6 完全一致。
 */
const router = useRouter()
const toast = useToast()
const userStore = useUserStore()
const studentStore = useStudentStore()
const leaveStore = useLeaveStore()
const dashboardStore = useDashboardStore()

const profile = computed(() => userStore.profile)

/* ---------- 工作时光（视图层口径：学期起止写死在常量，不改 Store） ---------- */

/** 学期口径（视图层展示用）：2026 秋季学期 2026-09-01 开学，2027-01-24 期末 */
const TERM_START = new Date('2026-09-01T00:00:00')
const TERM_END = new Date('2027-01-24T00:00:00')

const now = ref(new Date())
const dayMs = 1000 * 60 * 60 * 24

function dayKey(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** 工作第 X 天（自学期首日起算，含首日） */
const daysWorked = computed(() => {
  const diff = Math.floor((dayKey(now.value) - dayKey(TERM_START)) / dayMs) + 1
  return Math.max(1, diff)
})

/** 本学期第 X 周 */
const termWeek = computed(() => Math.ceil(daysWorked.value / 7))

/** 距离期末 X 天 */
const daysToTermEnd = computed(() =>
  Math.max(0, Math.ceil((dayKey(TERM_END) - dayKey(now.value)) / dayMs)),
)

/** 学期进度百分比（进度条 + 时间轴） */
const termProgress = computed(() => {
  const total = dayKey(TERM_END) - dayKey(TERM_START)
  if (total <= 0) return 100
  const passed = Math.min(Math.max(dayKey(now.value) - dayKey(TERM_START), 0), total)
  return Math.round((passed / total) * 100)
})

const fmtDate = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`

/* ---------- 工作数据（四宫格，全部来自既有 Store 计算属性） ---------- */

const statCards = computed(() => [
  { label: '学生人数', value: String(studentStore.activeStudents.length), to: '/students' },
  {
    label: '班级干部',
    value: String(studentStore.activeStudents.filter((s) => s.cadreRole).length),
    to: '/students',
  },
  { label: '请假记录', value: String(leaveStore.leaves.length), to: '/class/leave' },
  {
    label: '待办事项',
    value: String(dashboardStore.todos.filter((t) => !t.done).length),
    to: '/',
  },
])

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
  icon: LucideIcon
  label: string
  value?: string
  /** 点击行为：跳路由；placeholder 行无跳转（开发中） */
  to?: string
  soon?: boolean
}

const settingRows: Row[] = [
  {
    key: 'work',
    icon: ClipboardList,
    label: '课程表设置',
    value: '课程时间 · 默认视图',
    to: '/my/settings?module=work',
  },
  {
    key: 'seats',
    icon: Armchair,
    label: '座位管理设置',
    value: '教室布局 · 导出视角',
    to: '/my/settings?module=seats',
  },
  {
    key: 'leave',
    icon: NotebookPen,
    label: '请假管理设置',
    value: '默认返校时间 · 显示方式',
    to: '/my/settings?module=leave',
  },
  {
    key: 'duty',
    icon: Paintbrush,
    label: '值日管理设置',
    value: '默认分组 · 默认循环',
    to: '/my/settings?module=duty',
  },
  {
    key: 'weekend',
    icon: Luggage,
    label: '周末管理设置',
    value: '返校提醒',
    to: '/my/settings?module=weekend',
  },
]

const systemRows: Row[] = [
  { key: 'theme', icon: Palette, label: '主题', value: '高原青 · 浅色', soon: true },
  { key: 'sync', icon: Cloud, label: '数据同步', value: '云端同步 · 本机缓存', to: '/my/tools' },
  {
    key: 'backup',
    icon: Database,
    label: '备份与恢复',
    value: '导出 · 导入 · 合并',
    to: '/my/tools',
  },
  {
    key: 'about',
    icon: Info,
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
    <div class="page-head">
      <h1 class="page-head__title">我的</h1>
      <p class="page-head__sub">班主任的个人中心 · 资料、设置与工具</p>
    </div>

    <div class="my-columns">
      <!-- ===== 左：竖版渐变信息卡（昌都记忆 profile-info 同款） ===== -->
      <aside class="profile-card">
        <svg class="profile-card__texture" viewBox="0 0 500 150" fill="none" aria-hidden="true">
          <path d="M0 150L120 40L200 110L320 10L500 150H0Z" fill="currentColor" />
        </svg>
        <div class="profile-card__content">
          <button
            type="button"
            class="profile-card__avatar"
            :aria-label="profile.avatar ? '更换头像' : '上传头像'"
            @click="pickAvatar"
          >
            <img v-if="profile.avatar" :src="profile.avatar" alt="我的头像" class="avatar-img" />
            <span v-else class="avatar-fallback" aria-hidden="true">{{ userStore.initial }}</span>
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

          <h2 class="profile-card__name">{{ profile.nickname }}</h2>
          <p class="profile-card__line">{{ profile.className }} 班主任</p>
          <p class="profile-card__line">{{ profile.subject }}教师</p>
          <p class="profile-card__school">{{ profile.school }}</p>

          <div class="profile-card__pills">
            <span class="pill">
              <span class="pill__dot" aria-hidden="true"></span>
              服务学校
            </span>
            <span class="pill">
              <span class="pill__dot pill__dot--gold" aria-hidden="true"></span>
              任教学科
            </span>
          </div>
        </div>
      </aside>

      <!-- ===== 右：工作时光 → 工作数据 → 功能菜单 ===== -->
      <div class="my-main">
        <AppSection title="工作时光" class="my-section">
          <div class="time-cards">
            <div class="time-card">
              <span class="time-card__num">{{ daysWorked }}</span>
              <span class="time-card__label">工作第 X 天</span>
            </div>
            <div class="time-card">
              <span class="time-card__num">{{ termWeek }}</span>
              <span class="time-card__label">本学期第 X 周</span>
            </div>
            <div class="time-card">
              <span class="time-card__num">{{ daysToTermEnd }}</span>
              <span class="time-card__label">距离期末 X 天</span>
            </div>
          </div>

          <!-- 渐变进度条 + 时间轴 -->
          <div class="term-progress">
            <div class="term-progress__track">
              <div class="term-progress__fill" :style="{ width: termProgress + '%' }"></div>
            </div>
            <div class="term-progress__axis">
              <span class="axis-node">
                <span class="axis-dot" aria-hidden="true"></span>
                开学 · {{ fmtDate(TERM_START) }}
              </span>
              <span class="axis-node axis-node--now">今天 · {{ termProgress }}%</span>
              <span class="axis-node">
                期末 · {{ fmtDate(TERM_END) }}
                <span class="axis-dot axis-dot--end" aria-hidden="true"></span>
              </span>
            </div>
          </div>
        </AppSection>

        <AppSection title="工作数据" class="my-section">
          <div class="stat-grid">
            <RouterLink v-for="stat in statCards" :key="stat.label" :to="stat.to" class="stat-card">
              <span class="stat-card__num">{{ stat.value }}</span>
              <span class="stat-card__label">{{ stat.label }}</span>
            </RouterLink>
          </div>
        </AppSection>

        <AppSection title="个人信息" class="my-section">
          <section class="menu-card">
            <button type="button" class="menu-row" @click="openProfileEditor">
              <span class="menu-row__icon" aria-hidden="true"><UserRound :size="18" /></span>
              <span class="menu-row__main">
                <span class="menu-row__label">昵称 · 学校 · 班级 · 任教学科</span>
                <span class="menu-row__value"
                  >{{ profile.nickname }} · {{ profile.className }} · {{ profile.subject }}</span
                >
              </span>
              <span class="menu-row__chevron" aria-hidden="true">›</span>
            </button>
          </section>
        </AppSection>

        <AppSection title="系统设置" class="my-section">
          <section class="menu-card">
            <button
              v-for="row in settingRows"
              :key="row.key"
              type="button"
              class="menu-row"
              @click="openRow(row)"
            >
              <span class="menu-row__icon" aria-hidden="true"
                ><component :is="row.icon" :size="18"
              /></span>
              <span class="menu-row__main">
                <span class="menu-row__label">{{ row.label }}</span>
                <span class="menu-row__value">{{ row.value }}</span>
              </span>
              <span class="menu-row__chevron" aria-hidden="true">›</span>
            </button>
            <button
              v-for="row in systemRows"
              :key="row.key"
              type="button"
              class="menu-row"
              @click="openRow(row)"
            >
              <span class="menu-row__icon" aria-hidden="true"
                ><component :is="row.icon" :size="18"
              /></span>
              <span class="menu-row__main">
                <span class="menu-row__label">{{ row.label }}</span>
                <span class="menu-row__value">{{ row.value }}</span>
                <AppBadge v-if="row.soon" variant="neutral" size="sm">开发中</AppBadge>
              </span>
              <span class="menu-row__chevron" aria-hidden="true">›</span>
            </button>
          </section>
        </AppSection>

        <AppSection title="工具箱" class="my-section">
          <section class="menu-card">
            <button type="button" class="menu-row" @click="router.push('/my/tools')">
              <span class="menu-row__icon" aria-hidden="true"><Database :size="18" /></span>
              <span class="menu-row__main">
                <span class="menu-row__label">工具箱</span>
                <span class="menu-row__value">备份恢复 · 数据同步 · 清空数据</span>
              </span>
              <span class="menu-row__chevron" aria-hidden="true">›</span>
            </button>
          </section>
        </AppSection>
      </div>
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
  max-width: var(--page-max-width);
  margin: 0 auto;
}

/* ---- 页面头（V5.2：56–64px 标题 + 16px 副标题 + 分割线） ---- */
.page-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0 4px var(--spacing-lg);
  margin-bottom: var(--spacing-xl);
  border-bottom: 1px solid var(--color-border);
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

/* ---- 双栏布局 ---- */
.my-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--card-gap);
}

@media (min-width: 960px) {
  .my-columns {
    grid-template-columns: 320px minmax(0, 1fr);
    align-items: start;
  }
}

/* ---- 左：竖版渐变信息卡 ---- */
.profile-card {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: linear-gradient(160deg, #101820 0%, #1f343a 45%, var(--color-primary) 100%);
  box-shadow: var(--shadow-card);
  color: #ffffff;
}

.profile-card__texture {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 150px;
  opacity: 0.1;
  color: currentColor;
  pointer-events: none;
}

.profile-card__content {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: var(--spacing-page);
  text-align: center;
}

.profile-card__avatar {
  position: relative;
  width: 96px;
  height: 96px;
  padding: 4px;
  border: none;
  border-radius: 50%;
  /* 渐变头像环：日照金 → 天空蓝 → 高原青 */
  background: linear-gradient(135deg, var(--color-gold), var(--color-sky), var(--color-primary));
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.2);
  cursor: pointer;
  margin-bottom: var(--space-3);
  transition: transform var(--transition-fast);
}

.profile-card__avatar:hover {
  transform: scale(1.04);
}

.profile-card__avatar:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}

.avatar-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: linear-gradient(145deg, #1f343a, var(--color-primary-dark));
  font-size: 36px;
  font-weight: var(--font-weight-bold);
  color: #ffffff;
}

.avatar-remove {
  position: absolute;
  top: calc(var(--spacing-page) - 4px);
  right: calc(var(--spacing-page) - 4px);
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: var(--color-danger);
  color: #ffffff;
  font-size: 12px;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
}

.avatar-input {
  display: none;
}

.profile-card__name {
  margin: 0;
  font-size: 28px;
  font-weight: var(--font-weight-extrabold);
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.profile-card__line {
  margin: 0;
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: rgba(204, 255, 250, 0.92);
}

.profile-card__school {
  margin: var(--space-1) 0 0;
  font-size: var(--font-caption);
  font-style: italic;
  color: rgba(203, 213, 225, 0.7);
}

/* 底部两枚胶囊 */
.profile-card__pills {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin-top: var(--spacing-card);
}

.pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.16);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: rgba(255, 255, 255, 0.92);
}

.pill__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-sky);
  flex-shrink: 0;
}

.pill__dot--gold {
  background: var(--color-gold);
}

/* ---- 右栏 ---- */
.my-section {
  margin-bottom: var(--section-gap);
}

/* 工作时光：三张统计卡 */
.time-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--card-gap);
}

.time-card {
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  padding: var(--spacing-card);
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-shadow: var(--shadow-xs);
}

.time-card__num {
  font-size: 32px;
  font-weight: var(--font-weight-extrabold);
  line-height: 1.1;
  color: var(--color-primary-dark);
  font-variant-numeric: tabular-nums;
}

.time-card__label {
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

/* 渐变进度条 + 时间轴 */
.term-progress {
  margin-top: var(--spacing-card);
}

.term-progress__track {
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-bg-subtle);
  overflow: hidden;
}

.term-progress__fill {
  height: 100%;
  border-radius: var(--radius-full);
  /* 渐变进度条：日照金 → 天空蓝 → 高原青 */
  background: linear-gradient(90deg, var(--color-gold), var(--color-sky), var(--color-primary));
  transition: width 600ms var(--ease-spring);
}

.term-progress__axis {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: var(--space-2);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.axis-node {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.axis-node--now {
  color: var(--color-primary-dark);
  font-weight: var(--font-weight-semibold);
}

.axis-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary);
}

.axis-dot--end {
  background: var(--color-gold);
}

/* 工作数据：四宫格 */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--card-gap);
}

@media (min-width: 640px) {
  .stat-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--spacing-card);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  text-decoration: none;
  transition:
    transform var(--transition-spring),
    box-shadow var(--transition-spring);
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-hover);
}

.stat-card:active {
  transform: scale(0.98);
}

.stat-card__num {
  font-size: 28px;
  font-weight: var(--font-weight-extrabold);
  line-height: 1.1;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.stat-card__label {
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

/* 菜单卡（CDL：毛玻璃 + 24px 圆角 + Lucide 图标行） */
.menu-card {
  background: var(--glass-bg-card);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.menu-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: 14px 18px;
  border: none;
  border-bottom: 1px solid var(--color-border-light);
  border-radius: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.menu-row:last-child {
  border-bottom: none;
}

@media (hover: hover) {
  .menu-row:hover {
    background: var(--color-bg-subtle);
  }
}

.menu-row:active {
  background: var(--color-bg-subtle);
}

.menu-row:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--color-primary);
}

.menu-row__icon {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--color-primary-bg);
  color: var(--color-primary-dark);
}

.menu-row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.menu-row__label {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.menu-row__value {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-row__chevron {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  font-size: var(--text-lg);
  line-height: 1;
  opacity: 0.4;
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
  font-size: var(--font-card-title);
  font-weight: var(--font-weight-bold);
  color: var(--color-primary-dark);
}

.about-version {
  margin: 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.about-text {
  margin: var(--space-2) 0 0;
  font-size: var(--font-secondary);
  line-height: 1.7;
  color: var(--color-text-secondary);
}
</style>
