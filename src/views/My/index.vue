<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Armchair,
  CalendarClock,
  ClipboardList,
  Cloud,
  Database,
  Luggage,
  Moon,
  NotebookPen,
  Paintbrush,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-vue-next'

import {
  AppBadge,
  AppButton,
  AppDrawer,
  AppField,
  AppInput,
  AppSection,
  AppSwitch,
} from '@/components/ui'
import { useCountdownSettings, HERO_BACKGROUNDS } from '@/composables/useCountdownSettings'
import { useToast } from '@/composables/useToast'
import { useUserStore } from '@/stores/user'
import { appConfig } from '@/config'
import { COURSE_PERIODS } from '@/types/timetable'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { UserProfileInput } from '@/types/user'

/**
 * 「我的」个人中心 + 设置中心（V1.3.2，昌都记忆我的1.3 版）：
 * 顶部次级 Tab：我的 ｜ 功能设置（与班级管理同款交互，设置不再弹窗/跳页）。
 * 「我的」Tab = 左三卡（教师信息卡 / 系统管理 / About）+ 右两卡（工作时光 / 功能设置入口）。
 * 「功能设置」Tab = 分组胶囊（课程表｜座位｜请假｜值日｜周末｜时间）+ 当前组设置。
 * 业务逻辑（头像上传 / 资料编辑抽屉 / 跳转）与既有版本一致，不碰 Store 与数据结构。
 */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const userStore = useUserStore()
const countdown = useCountdownSettings()

const profile = computed(() => userStore.profile)

/* ---------- 顶部次级 Tab ---------- */

type TopTab = 'profile' | 'settings'
type SettingGroup = 'work' | 'seats' | 'leave' | 'duty' | 'weekend' | 'time'

const topTab = ref<TopTab>('profile')
const activeGroup = ref<SettingGroup>('work')

const GROUP_TABS: { id: SettingGroup; label: string }[] = [
  { id: 'work', label: '课程表' },
  { id: 'seats', label: '座位' },
  { id: 'leave', label: '请假' },
  { id: 'duty', label: '值日' },
  { id: 'weekend', label: '周末' },
  { id: 'time', label: '时间' },
]

/** 旧入口兼容：/my/settings?module=xxx → 功能设置 Tab 对应分组（各功能页 ⚙ 与旧书签都走这里） */
function applyModuleQuery(module: unknown): void {
  if (typeof module !== 'string') return
  if (GROUP_TABS.some((g) => g.id === module)) {
    topTab.value = 'settings'
    activeGroup.value = module as SettingGroup
  }
}

onMounted(() => applyModuleQuery(route.query.module))
watch(
  () => route.query.module,
  (module) => applyModuleQuery(module),
)

function openSettings(group: SettingGroup): void {
  topTab.value = 'settings'
  activeGroup.value = group
}

/* ---------- 工作时光（与首页 Hero 共用倒计时设置数据） ---------- */

const daysWorked = computed(() => countdown.daysPassed.value)
const termWeek = computed(() => Math.ceil(countdown.daysPassed.value / 7))
const daysToTermEnd = computed(() => countdown.daysRemaining.value)
const termProgress = computed(() => countdown.progress.value)
const termStart = computed(() => countdown.settings.value.startDate)
const termEnd = computed(() => countdown.settings.value.targetDate)

const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? iso
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

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

/* ---------- 系统管理卡（左栏） ---------- */

function onDarkMode(): void {
  toast.info('深色模式还在开发中，敬请期待')
}

function onDataManagement(): void {
  router.push('/my/tools')
}

/* ---------- 功能设置（各分组行） ---------- */

interface Row {
  key: string
  label: string
  value?: string
  to?: string
  soon?: boolean
}

const courseTimeValue = computed(
  () => `${COURSE_PERIODS.length} 个时间段 · ${COURSE_PERIODS[0]!.startTime} 首课`,
)
const seatLayoutValue = computed(
  () =>
    `${DEFAULT_CLASSROOM_CONFIG.rows} 排 × ${DEFAULT_CLASSROOM_CONFIG.cols} 列 · ${DEFAULT_CLASSROOM_CONFIG.blocks.length} 区 · ${DEFAULT_CLASSROOM_CONFIG.blocks.length - 1} 条过道`,
)

const GROUP_ROWS: Record<Exclude<SettingGroup, 'time'>, Row[]> = {
  work: [
    { key: 'periods', label: '课程时间', value: courseTimeValue.value },
    { key: 'view', label: '默认视图', soon: true },
  ],
  seats: [
    { key: 'layout', label: '教室布局', value: `${seatLayoutValue.value}（固定）` },
    { key: 'export-view', label: '导出默认视角', soon: true },
    { key: 'default-plan', label: '默认方案', soon: true },
  ],
  leave: [
    { key: 'back-time', label: '默认返校时间', soon: true },
    { key: 'display', label: '显示方式', soon: true },
  ],
  duty: [
    {
      key: 'rotation',
      label: '轮换设置',
      value: '起点日期 · 起点组 · 周末开关（在值日管理页内）',
      to: '/class/duty',
    },
    { key: 'default-group', label: '默认分组', soon: true },
  ],
  weekend: [{ key: 'remind', label: '默认返校提醒', soon: true }],
}

function openRow(row: Row): void {
  if (row.soon || !row.to) {
    toast.info('这个设置还在开发中，敬请期待')
    return
  }
  router.push(row.to)
}

/* ---------- 功能设置入口（我的 Tab 右栏卡） ---------- */

interface Entry {
  key: string
  icon: LucideIcon
  label: string
  desc: string
  group?: SettingGroup
  to?: string
}

const settingEntries: Entry[] = [
  {
    key: 'work',
    icon: ClipboardList,
    label: '课程表设置',
    desc: '课程时间 · 默认视图',
    group: 'work',
  },
  {
    key: 'seats',
    icon: Armchair,
    label: '座位管理设置',
    desc: '教室布局 · 导出视角',
    group: 'seats',
  },
  {
    key: 'leave',
    icon: NotebookPen,
    label: '请假管理设置',
    desc: '默认返校时间 · 显示方式',
    group: 'leave',
  },
  {
    key: 'duty',
    icon: Paintbrush,
    label: '值日管理设置',
    desc: '默认分组 · 默认循环',
    group: 'duty',
  },
  { key: 'weekend', icon: Luggage, label: '周末管理设置', desc: '返校提醒', group: 'weekend' },
  {
    key: 'time',
    icon: CalendarClock,
    label: '时间设置',
    desc: '首页倒计时 · Hero 背景',
    group: 'time',
  },
  { key: 'sync', icon: Cloud, label: '数据同步', desc: '云端同步 · 本机缓存', to: '/my/tools' },
  {
    key: 'backup',
    icon: Database,
    label: '备份与恢复',
    desc: '导出 · 导入 · 合并',
    to: '/my/tools',
  },
]

function openEntry(entry: Entry): void {
  if (entry.group) {
    openSettings(entry.group)
    return
  }
  if (entry.to) router.push(entry.to)
}

/* ---------- About 卡 ---------- */

function checkUpdate(): void {
  toast.info(`当前已是最新版本 v${appConfig.version}`)
}
</script>

<template>
  <div class="my-page">
    <div class="page-head">
      <h1 class="page-head__title">我的</h1>
      <p class="page-head__sub">班主任的个人中心与设置中心</p>
    </div>

    <!-- 次级导航：我的 ｜ 功能设置（与班级管理同款交互） -->
    <nav class="my-tabs" aria-label="我的页次级导航">
      <button
        type="button"
        class="my-tab"
        :class="{ 'is-active': topTab === 'profile' }"
        @click="topTab = 'profile'"
      >
        我的
      </button>
      <button
        type="button"
        class="my-tab"
        :class="{ 'is-active': topTab === 'settings' }"
        @click="topTab = 'settings'"
      >
        功能设置
      </button>
    </nav>

    <!-- ================= Tab 1：我的（左三卡 + 右两卡） ================= -->
    <div v-if="topTab === 'profile'" class="my-columns">
      <!-- 左栏 -->
      <div class="my-left">
        <!-- ① 教师信息卡 -->
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
              <X :size="12" :stroke-width="2" aria-hidden="true" />
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

            <button type="button" class="profile-card__edit" @click="openProfileEditor">
              <UserRound :size="14" aria-hidden="true" />
              编辑资料
            </button>
          </div>
        </aside>

        <!-- ② 系统管理 -->
        <section class="side-card">
          <h3 class="side-card__title">系统管理</h3>
          <button type="button" class="menu-row" @click="onDarkMode">
            <span class="menu-row__icon" aria-hidden="true"><Moon :size="18" /></span>
            <span class="menu-row__main">
              <span class="menu-row__label">深色模式</span>
              <span class="menu-row__value">即将推出</span>
            </span>
            <AppBadge size="sm" variant="neutral">开发中</AppBadge>
          </button>
          <button type="button" class="menu-row" @click="onDataManagement">
            <span class="menu-row__icon" aria-hidden="true"><Database :size="18" /></span>
            <span class="menu-row__main">
              <span class="menu-row__label">数据管理</span>
              <span class="menu-row__value">备份恢复 · 同步 · 清空</span>
            </span>
            <span class="menu-row__chevron" aria-hidden="true">›</span>
          </button>
        </section>

        <!-- ③ About（独立卡片，复刻昌都记忆） -->
        <section class="about-card">
          <img class="about-card__logo" src="/icons/icon-192.png" alt="TeacherDesk" />
          <div class="about-card__info">
            <h3 class="about-card__name">TeacherDesk</h3>
            <p class="about-card__desc">班主任工作台 · 高中班级管理工作台</p>
          </div>
          <div class="about-card__foot">
            <span class="about-card__version">当前版本 v{{ appConfig.version }}</span>
            <span
              class="about-card__update"
              role="button"
              tabindex="0"
              @click="checkUpdate"
              @keydown.enter="checkUpdate"
              >检查更新</span
            >
          </div>
        </section>
      </div>

      <!-- 右栏 -->
      <div class="my-main">
        <!-- 工作时光（与首页 Hero 共用时间设置数据） -->
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

          <div class="term-progress">
            <div class="term-progress__track">
              <div class="term-progress__fill" :style="{ width: termProgress + '%' }"></div>
            </div>
            <div class="term-progress__axis">
              <span class="axis-node">
                <span class="axis-dot" aria-hidden="true"></span>
                开学 · {{ fmtDate(termStart) }}
              </span>
              <span class="axis-node axis-node--now">今天 · {{ termProgress }}%</span>
              <span class="axis-node">
                期末 · {{ fmtDate(termEnd) }}
                <span class="axis-dot axis-dot--end" aria-hidden="true"></span>
              </span>
            </div>
          </div>
        </AppSection>

        <!-- 功能设置入口卡 -->
        <AppSection title="功能设置" class="my-section my-section--last">
          <section class="menu-card">
            <button
              v-for="entry in settingEntries"
              :key="entry.key"
              type="button"
              class="menu-row"
              @click="openEntry(entry)"
            >
              <span class="menu-row__icon" aria-hidden="true"
                ><component :is="entry.icon" :size="18"
              /></span>
              <span class="menu-row__main">
                <span class="menu-row__label">{{ entry.label }}</span>
                <span class="menu-row__value">{{ entry.desc }}</span>
              </span>
              <span class="menu-row__chevron" aria-hidden="true">›</span>
            </button>
          </section>
        </AppSection>
      </div>
    </div>

    <!-- ================= Tab 2：功能设置 ================= -->
    <div v-else class="settings-pane">
      <nav class="my-tabs my-tabs--sub" aria-label="设置分组">
        <button
          v-for="group in GROUP_TABS"
          :key="group.id"
          type="button"
          class="my-tab"
          :class="{ 'is-active': activeGroup === group.id }"
          @click="activeGroup = group.id"
        >
          {{ group.label }}
        </button>
      </nav>

      <section class="menu-card settings-card">
        <!-- 时间组：表单（与首页 Hero 共用数据，改动即自动保存） -->
        <template v-if="activeGroup === 'time'">
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
              已过去 {{ countdown.daysPassed.value }} 天 · 剩余
              {{ countdown.daysRemaining.value }} 天 · 完成
              {{ countdown.progress.value }}%（自动计算，无需手动修改）
            </p>
          </div>
        </template>

        <!-- 其余分组：设置行 -->
        <template v-else>
          <button
            v-for="row in GROUP_ROWS[activeGroup]"
            :key="row.key"
            type="button"
            class="menu-row"
            @click="openRow(row)"
          >
            <span class="menu-row__main">
              <span class="menu-row__label">{{ row.label }}</span>
              <span v-if="row.value" class="menu-row__value">{{ row.value }}</span>
            </span>
            <span class="menu-row__side">
              <AppBadge v-if="row.soon" variant="neutral" size="sm">开发中</AppBadge>
              <span v-if="row.to" class="menu-row__chevron" aria-hidden="true">›</span>
            </span>
          </button>
        </template>
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
  background: rgba(15, 23, 42, 0.04);
}

.my-tab.is-active {
  background: var(--color-bg-white);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-xs);
  font-weight: var(--font-weight-semibold);
}

.my-tab:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
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

.my-left {
  display: flex;
  flex-direction: column;
  gap: var(--card-gap);
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

/* 底部两枚胶囊 + 编辑按钮 */
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

.profile-card__edit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-2);
  padding: 7px 16px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  font-family: inherit;
  font-size: var(--font-caption);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.profile-card__edit:hover {
  background: rgba(255, 255, 255, 0.2);
}

.profile-card__edit:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
}

/* ---- 左：系统管理卡 ---- */
.side-card {
  background: var(--glass-bg-card);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.side-card__title {
  font-size: var(--font-section-title);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  margin: 0;
  padding: var(--spacing-lg) var(--spacing-page) var(--space-1);
}

/* ---- 左：About 卡（复刻昌都记忆 profile__about-card） ---- */
.about-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: var(--spacing-page);
  border-radius: var(--radius-card);
  background: var(--glass-bg-card);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-card);
  text-align: center;
  transition:
    transform var(--transition-spring),
    box-shadow var(--transition-spring);
}

@media (hover: hover) {
  .about-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-hover);
  }
}

.about-card__logo {
  width: 48px;
  height: 48px;
  border-radius: 16px;
  display: block;
  object-fit: cover;
  box-shadow: var(--shadow-sm);
}

.about-card__name {
  margin: 0;
  font-size: var(--font-card-title);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.about-card__desc {
  margin: 4px 0 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.about-card__info {
  display: flex;
  flex-direction: column;
}

.about-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-top: 14px;
  border-top: 1px solid var(--color-border-light);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.about-card__update {
  color: var(--color-primary);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  transition: opacity var(--transition-fast);
}

.about-card__update:hover {
  opacity: 0.8;
}

/* ---- 右栏 ---- */
.my-section {
  margin-bottom: var(--section-gap);
}

.my-section--last {
  margin-bottom: 0;
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

/* ---- 菜单卡（毛玻璃 + Lucide 图标行） ---- */
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

.menu-row__side {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.menu-row__chevron {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  font-size: var(--text-lg);
  line-height: 1;
  opacity: 0.4;
}

/* ---- 功能设置 Tab ---- */
.settings-pane {
  display: flex;
  flex-direction: column;
}

.settings-card {
  padding: var(--spacing-md);
}

/* 时间设置表单 */
.time-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-card);
  padding: var(--space-2);
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
  border-radius: 8px;
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
  background: var(--color-bg-subtle);
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
</style>
