<script setup lang="ts">
import { computed } from 'vue'
import { AppField, AppInput, AppSwitch } from '@/components/ui'
import { HERO_BACKGROUNDS } from '@/types/appSettings'
import { useAppSettingsStore } from '@/stores/appSettings'
import SettingsPage from '../components/SettingsPage.vue'
import SettingsSection from '../components/SettingsSection.vue'
import SettingsField from '../components/SettingsField.vue'

/**
 * 学期与倒计时（v3.0.4-rc · 二级页，新增整理而非新增功能）。
 *
 * **统一管理首页 Hero 与「我的 → 工作时光」共用的那一套时间**——此前 Hero 的倒计时
 * 与工作时光各读一份设置，改一处另一处不动。现在这一页是这套时间的唯一入口：
 * - 支教开始日期 → 工作天数（首页「第 X 天」/ 工作时光「支教天数」）
 * - 学期开学日期 → 学期进度（首页进度条 / 工作时光进度条）
 * - 学期期末日期 → 学期倒计时（首页 Hero 倒计时卡）
 * - Hero 文案 / Hero 背景 / 进度开关 → 首页 Hero 外观
 *
 * 改动**即时生效、即时落盘**（`teacherdesk:settings`），刷新与重开都不丢；
 * 不做「恢复默认」——设置是教师自己填的事实，不给一个会覆盖它的按钮。
 */
const appSettings = useAppSettingsStore()

const settings = computed(() => appSettings.settings)

const daysWorked = computed(() => appSettings.daysWorked)
const termProgress = computed(() => appSettings.termProgress)
const termDaysRemaining = computed(() => appSettings.termDaysRemaining)
const termIsOver = computed(() => appSettings.termIsOver)

/** 学期起止倒置时如实提醒（不拦输入，也不悄悄改教师的日期） */
const termRangeInvalid = computed(() => settings.value.semesterEnd < settings.value.semesterStart)

/** 当前背景是否命中某个预设（命中则自定义输入框留空） */
const isPresetBackground = computed(() =>
  HERO_BACKGROUNDS.some((preset) => preset.url === settings.value.heroBackground),
)

function update(patch: Parameters<typeof appSettings.update>[0]): void {
  appSettings.update(patch)
}
</script>

<template>
  <SettingsPage
    title="学期与倒计时"
    subtitle="首页 Hero 与「我的 → 工作时光」共用这一套时间，改一处两边同步"
  >
    <SettingsSection title="时间">
      <SettingsField
        label="支教开始日期"
        hint="决定首页 Hero 的「第 X 天」与工作时光的「支教天数」（含首日）。"
      >
        <template #control>
          <AppInput
            type="date"
            :model-value="settings.serviceStart"
            @update:model-value="update({ serviceStart: String($event) })"
          />
        </template>
      </SettingsField>

      <SettingsField label="学期开学日期" hint="学期进度的起点（工作时光的进度条按它算）。">
        <template #control>
          <AppInput
            type="date"
            :model-value="settings.semesterStart"
            @update:model-value="update({ semesterStart: String($event) })"
          />
        </template>
      </SettingsField>

      <SettingsField
        label="学期期末日期"
        hint="首页 Hero 倒计时的终点；期末之后 Hero 显示「学期已结束」。"
      >
        <template #control>
          <AppInput
            type="date"
            :model-value="settings.semesterEnd"
            @update:model-value="update({ semesterEnd: String($event) })"
          />
        </template>
      </SettingsField>

      <p v-if="termRangeInvalid" class="warn">
        期末日期早于开学日期，学期进度会一直显示 100%。请把两个日期调成正确的前后顺序。
      </p>
    </SettingsSection>

    <SettingsSection title="实时预览">
      <div class="preview">
        <div class="preview__item">
          <span class="preview__value">{{ daysWorked }}</span>
          <span class="preview__label">支教第 X 天</span>
        </div>
        <div class="preview__item">
          <span class="preview__value">{{ termProgress }}<i>%</i></span>
          <span class="preview__label">学期进度</span>
        </div>
        <div class="preview__item">
          <span class="preview__value">{{ termIsOver ? '已结束' : termDaysRemaining }}</span>
          <span class="preview__label">距期末（天）</span>
        </div>
      </div>
      <p class="preview__hint">改上面的日期，这里与首页 Hero、工作时光会同时更新。</p>
    </SettingsSection>

    <SettingsSection title="首页 Hero">
      <SettingsField label="Hero 文案" hint="倒计时卡片上的标题，如「距离期末考试」。">
        <template #control>
          <AppInput
            :model-value="settings.heroTitle"
            placeholder="如 距离期末考试"
            @update:model-value="update({ heroTitle: String($event) })"
          />
        </template>
      </SettingsField>

      <SettingsField label="Hero 背景" stack>
        <div class="bg-presets">
          <button
            v-for="preset in HERO_BACKGROUNDS"
            :key="preset.id"
            type="button"
            class="bg-presets__item"
            :class="{ 'is-active': settings.heroBackground === preset.url }"
            @click="update({ heroBackground: preset.url })"
          >
            <img class="bg-presets__thumb" :src="preset.url" alt="" />
            <span class="bg-presets__label">{{ preset.label }}</span>
          </button>
        </div>
        <AppField label="自定义背景图 URL">
          <AppInput
            :model-value="isPresetBackground ? '' : settings.heroBackground"
            placeholder="https://…（留空则用上面选中的预设）"
            @update:model-value="update({ heroBackground: String($event) })"
          />
        </AppField>
        <p class="field-hint">留空或填错时，Hero 会退回默认底色，不会白屏。</p>
      </SettingsField>

      <SettingsField label="显示进度与百分比" hint="关掉后 Hero 倒计时卡只显示剩余天数。">
        <template #control>
          <AppSwitch
            :model-value="settings.showProgress"
            label="显示进度"
            @update:model-value="update({ showProgress: $event })"
          />
        </template>
      </SettingsField>
    </SettingsSection>
  </SettingsPage>
</template>

<style scoped>
.preview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}

.preview__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-primary-bg);
}

.preview__value {
  font-size: var(--font-num-lg);
  font-weight: var(--font-weight-semibold);
  line-height: 1.1;
  color: var(--color-primary-strong);
  font-variant-numeric: tabular-nums;
}

.preview__value i {
  font-style: normal;
  font-size: var(--text-md);
  margin-left: 2px;
}

.preview__label {
  font-size: var(--font-caption);
  color: var(--color-text-secondary);
}

.preview__hint {
  margin: 0;
  padding: 0 var(--space-4) var(--space-3);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.bg-presets {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
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

.bg-presets__item:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.bg-presets__thumb {
  width: 120px;
  height: 68px;
  object-fit: cover;
  border-radius: var(--radius-xs);
  display: block;
}

.bg-presets__label {
  font-size: var(--font-caption);
  color: var(--color-text-secondary);
}

.field-hint {
  margin: 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.warn {
  margin: 0;
  padding: var(--space-2) var(--space-4) var(--space-3);
  font-size: var(--font-caption);
  color: var(--color-danger-strong);
  line-height: var(--leading-normal);
}
</style>
