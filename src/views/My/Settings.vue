<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Armchair,
  CalendarClock,
  ClipboardList,
  Luggage,
  NotebookPen,
  Paintbrush,
  Settings,
  type LucideIcon,
} from 'lucide-vue-next'

import { AppBadge, AppInput, AppModal, AppSwitch } from '@/components/ui'
import { useCountdownSettings, HERO_BACKGROUNDS } from '@/composables/useCountdownSettings'
import { useToast } from '@/composables/useToast'
import { appConfig } from '@/config'
import { COURSE_PERIODS } from '@/types/timetable'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'

/**
 * 统一设置页（V1.1.6 核心）：**全应用只有这一套设置**。
 * 「我的 → 设置」与各功能页右上角的 ⚙（`/my/settings?module=xxx`）进入的都是本页；
 * 目标模块分组会滚动定位并高亮一下。
 *
 * 已存在的真实设置直接给出（值 / 跳转），尚未开发的保留占位行（标「开发中」）——
 * 不提前造半成品逻辑。
 */
const route = useRoute()
const router = useRouter()
const toast = useToast()

interface Row {
  key: string
  label: string
  /** 当前值（只读展示） */
  value?: string
  /** 点击跳转（如真实设置所在的功能页 / 工具箱） */
  to?: string
  soon?: boolean
}

interface Section {
  id: string
  title: string
  icon: LucideIcon
  rows: Row[]
}

const courseTimeValue = computed(
  () => `${COURSE_PERIODS.length} 个时间段 · ${COURSE_PERIODS[0]!.startTime} 首课`,
)

const seatLayoutValue = computed(
  () =>
    `${DEFAULT_CLASSROOM_CONFIG.rows} 排 × ${DEFAULT_CLASSROOM_CONFIG.cols} 列 · ${DEFAULT_CLASSROOM_CONFIG.blocks.length} 区 · ${DEFAULT_CLASSROOM_CONFIG.blocks.length - 1} 条过道`,
)

const SECTIONS: Section[] = [
  {
    // V1.3.1：Hero 倒计时设置（表单控件渲染在本组卡片内，见模板 time-form 区块）
    id: 'time',
    title: '时间设置',
    icon: CalendarClock,
    rows: [],
  },
  {
    id: 'work',
    title: '工作管理',
    icon: ClipboardList,
    rows: [
      { key: 'periods', label: '课程时间', value: courseTimeValue.value },
      { key: 'view', label: '默认视图', soon: true },
    ],
  },
  {
    id: 'seats',
    title: '座位管理',
    icon: Armchair,
    rows: [
      { key: 'layout', label: '教室布局', value: `${seatLayoutValue.value}（固定）` },
      { key: 'export-view', label: '导出默认视角', soon: true },
      { key: 'default-plan', label: '默认方案', soon: true },
    ],
  },
  {
    id: 'leave',
    title: '请假管理',
    icon: NotebookPen,
    rows: [
      { key: 'back-time', label: '默认返校时间', soon: true },
      { key: 'display', label: '显示方式', soon: true },
    ],
  },
  {
    id: 'duty',
    title: '值日管理',
    icon: Paintbrush,
    rows: [
      {
        key: 'rotation',
        label: '轮换设置',
        value: '起点日期 · 起点组 · 周末开关（在值日管理页内）',
        to: '/class/duty',
      },
      { key: 'default-group', label: '默认分组', soon: true },
    ],
  },
  {
    id: 'weekend',
    title: '周末管理',
    icon: Luggage,
    rows: [{ key: 'remind', label: '默认返校提醒', soon: true }],
  },
  {
    id: 'system',
    title: '系统',
    icon: Settings,
    rows: [
      { key: 'theme', label: '主题', value: '高原青 · 浅色', soon: true },
      { key: 'data', label: '数据与备份', value: '备份恢复 · 同步 · 清空', to: '/my/tools' },
      { key: 'about', label: '关于 TeacherDesk', value: `v${appConfig.version}`, to: 'about' },
    ],
  },
]

/* ---------- 目标模块定位（?module=xxx）：滚动 + 闪烁 ---------- */

const flashId = ref('')

onMounted(() => {
  const target = typeof route.query.module === 'string' ? route.query.module : ''
  if (!target) return
  if (!SECTIONS.some((section) => section.id === target)) return
  // 等一帧再滚：懒渲染的路由组件此刻刚挂载
  requestAnimationFrame(() => {
    const el = document.getElementById(`settings-${target}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    flashId.value = target
    window.setTimeout(() => {
      flashId.value = ''
    }, 1600)
  })
})

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

/* ---------- 时间设置（V1.3.1 Hero 倒计时） ---------- */

const countdown = useCountdownSettings()
</script>

<template>
  <div class="settings-page">
    <header class="page-head">
      <h1 class="page-title">设置</h1>
      <p class="page-subtitle">所有模块的设置都在这一页；功能页右上角的 ⚙ 也跳到这里。</p>
    </header>

    <section
      v-for="section in SECTIONS"
      :id="`settings-${section.id}`"
      :key="section.id"
      class="settings-group"
      :class="{ 'is-flash': flashId === section.id }"
    >
      <h2 class="group-title">
        <span class="group-icon" aria-hidden="true"
          ><component :is="section.icon" :size="18"
        /></span>
        {{ section.title }}
      </h2>
      <div class="row-list">
        <button
          v-for="row in section.rows"
          :key="row.key"
          type="button"
          class="setting-row"
          :disabled="row.soon && !row.to"
          @click="openRow(row)"
        >
          <span class="row-label">{{ row.label }}</span>
          <span class="row-side">
            <AppBadge v-if="row.soon" variant="neutral" size="sm">开发中</AppBadge>
            <span v-else-if="row.value" class="row-value">{{ row.value }}</span>
            <span v-if="row.to" class="row-chevron" aria-hidden="true">›</span>
          </span>
        </button>
      </div>

      <!-- V1.3.1 时间设置：Hero 倒计时的全部配置项（改动即自动保存） -->
      <div v-if="section.id === 'time'" class="time-form">
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
          已过去 {{ countdown.daysPassed.value }} 天 · 剩余 {{ countdown.daysRemaining.value }} 天 ·
          完成 {{ countdown.progress.value }}%（自动计算，无需手动修改）
        </p>
      </div>
    </section>

    <AppModal v-model="aboutOpen" title="关于 TeacherDesk" :width="380">
      <div class="about-body">
        <p class="about-name">{{ appConfig.name }}</p>
        <p class="about-version">版本 v{{ appConfig.version }}</p>
        <p class="about-text">高中班主任的工作台，数据保存在本机；备份与云同步在「数据与备份」。</p>
      </div>
      <template #footer>
        <button type="button" class="about-close" @click="aboutOpen = false">好的</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 640px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

.page-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 4px 14px;
  margin-bottom: var(--space-1);
  border-bottom: 1px solid var(--color-border);
}

.page-title {
  margin: 0;
  font-size: var(--font-page-title, 32px);
  font-weight: var(--font-weight-extrabold);
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
  line-height: 1.2;
}

.page-subtitle {
  margin: 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

/* CDL 菜单卡：毛玻璃 + 24px 圆角 + 卡内标题 */
.settings-group {
  background: var(--glass-bg-card);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  transition:
    box-shadow var(--transition-fast),
    border-color var(--transition-fast);
}

/* 从功能页 ⚙ 跳来时的定位高亮 */
.settings-group.is-flash {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-bg);
}

.group-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--spacing-lg) var(--spacing-page) var(--space-1);
  font-size: var(--font-section-title, 20px);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.group-icon {
  font-size: 17px;
}

.row-list {
  display: flex;
  flex-direction: column;
  padding: var(--space-2) var(--spacing-md) var(--spacing-md);
}

/* ---- V1.3.1 时间设置表单 ---- */
.time-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-card);
  padding: var(--space-2) var(--spacing-md) var(--spacing-md);
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

.setting-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.setting-row:hover:not(:disabled) {
  background: var(--color-bg-subtle);
}

.setting-row:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.setting-row:disabled {
  cursor: default;
}

.row-label {
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.row-side {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.row-value {
  font-size: var(--text-sm);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-chevron {
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
  font-size: var(--font-card-title, 18px);
  font-weight: var(--font-weight-bold);
  color: var(--color-primary-dark);
}

.about-version {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
}

.about-text {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.about-close {
  padding: 6px 16px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: #ffffff;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
}
</style>
