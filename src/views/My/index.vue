<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Database } from 'lucide-vue-next'

import { AppButton, AppDrawer, AppField, AppInput, AppSwitch } from '@/components/ui'
import { useCountdownSettings, HERO_BACKGROUNDS } from '@/composables/useCountdownSettings'
import { useToast } from '@/composables/useToast'
import { useStudentStore } from '@/stores/student'
import { useTimetableStore } from '@/stores/timetable'
import { useUserStore } from '@/stores/user'
import { COURSE_PERIODS } from '@/types/timetable'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { UserProfileInput } from '@/types/user'
import AboutCard from './components/AboutCard.vue'
import ControlCenter from './components/ControlCenter.vue'
import ProfileHero from './components/ProfileHero.vue'
import ProfileStats from './components/ProfileStats.vue'
import SettingsCell from './components/SettingsCell.vue'
import SettingsSection from './components/SettingsSection.vue'
import WorkTimeCard from './components/WorkTimeCard.vue'

/**
 * 「我的」= Control Center 个人工作中心（V2.1.0-beta · Phase UI-5C）：
 * 五层结构：Profile Hero（身份）→ 工作时光 → 控制中心（同步/工具箱/偏好设置）
 * → 数据管理（Apple Settings Cell，操作在工具箱页保留）→ 关于（__APP_VERSION__）。
 * 顶部次级 Tab「功能设置」保留（各模块设置的第一入口，双入口不迁移）；
 * 头像上传 / 资料编辑抽屉 / 时间表单等业务逻辑与既有版本一致，不碰 Store 与数据结构。
 */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const userStore = useUserStore()
const studentStore = useStudentStore()
const timetableStore = useTimetableStore()
const countdown = useCountdownSettings()

const profile = computed(() => userStore.profile)

const appVersion = import.meta.env.APP_VERSION

/* ---------- Hero 工作信息（真实数据） ---------- */

const studentCount = computed(() => studentStore.activeStudents.length)
const weekLessons = computed(() => timetableStore.weekLessonCount)

/* ---------- 顶部次级 Tab（功能设置：各模块设置第一入口，保留） ---------- */

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

/* ---------- 数据管理（Layer 4：操作在工具箱页，这里统一入口） ---------- */

function openTools(): void {
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

/* ---------- About ---------- */

function checkUpdate(): void {
  toast.info(`当前已是最新版本 ${appVersion}`)
}
</script>

<template>
  <div class="my-page">
    <div class="page-head">
      <h1 class="page-head__title">我的</h1>
      <p class="page-head__sub">班主任的个人工作中心与控制中心</p>
    </div>

    <!-- 次级导航：我的 ｜ 功能设置（各模块设置第一入口，保留） -->
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

    <!-- ================= Tab 1：Control Center 五层 ================= -->
    <div v-if="topTab === 'profile'" class="cc-layout">
      <div class="cc-main">
        <!-- Layer 1：Profile Hero -->
        <ProfileHero
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
        <ProfileStats
          :student-count="studentCount"
          :week-lessons="weekLessons"
          :version="appVersion"
        />

        <!-- Layer 2：工作时光 -->
        <WorkTimeCard />

        <!-- Layer 3：控制中心 -->
        <ControlCenter @open-settings="openSettings" @open-tools="openTools" />
      </div>

      <div class="cc-side">
        <!-- Layer 4：数据管理（统一入口；导出/导入/重置逻辑在工具箱页保留） -->
        <SettingsSection title="数据管理">
          <SettingsCell
            :icon="Database"
            icon-tone="neutral"
            title="备份与恢复"
            subtitle="导出 · 导入 · 合并（工具箱）"
            @click="openTools"
          />
          <SettingsCell
            :icon="Database"
            icon-tone="danger"
            title="重置数据"
            subtitle="清空示例数据 · 清空全部（工具箱）"
            @click="openTools"
          />
        </SettingsSection>

        <!-- Layer 5：关于 -->
        <AboutCard @check-update="checkUpdate" />
      </div>
    </div>

    <!-- ================= Tab 2：功能设置（第一入口，保留） ================= -->
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

      <div class="settings-card">
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

        <!-- 其余分组：Settings Cell 行 -->
        <template v-else>
          <SettingsCell
            v-for="row in GROUP_ROWS[activeGroup]"
            :key="row.key"
            :title="row.label"
            :subtitle="row.value"
            :chevron="Boolean(row.to)"
            :badge-text="row.soon ? '开发中' : undefined"
            @click="openRow(row)"
          />
        </template>
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
</style>
