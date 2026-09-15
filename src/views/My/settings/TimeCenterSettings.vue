<script setup lang="ts">
import { computed, ref } from 'vue'
import { Pencil, Plus, Trash2 } from 'lucide-vue-next'

import { AppButton, AppField, AppInput, AppModal, AppSwitch } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { HERO_BACKGROUNDS } from '@/types/appSettings'
import type { CountdownEntry } from '@/utils/timeCenter'
import { useAppSettingsStore } from '@/stores/appSettings'
import SettingsPage from '../components/SettingsPage.vue'
import SettingsSection from '../components/SettingsSection.vue'
import SettingsField from '../components/SettingsField.vue'

/**
 * 时光中心（v3.0.4-rc 建页为「学期与倒计时」· **v3.1.0 改版为时光中心**）。
 *
 * **首页 Hero 与「我的 → 工作时光」共用的那一套时间的唯一入口**，四组：
 * ① 学期时间（开学 / 期末）② 支教时间（开始）③ 倒计时（内置三项 + 自定义，每行一个
 * 「首页显示」单选）④ 首页 Hero 外观（背景 / 副标题 / 进度开关）。
 *
 * 版式沿用 Changdu-Memory 的设置页（大标题 + 分组卡 + 一行一控件），
 * **不是后台管理那一套**：没有表格、没有批量操作、没有「保存」按钮——
 * 每一项改完即时生效、即时落盘（`teacherdesk:settings` 里的 `timeCenter`）。
 *
 * **倒计时列表的口径**（v3.1.0）：内置三项的名称固定、日期直接跟着上面两个日期字段走、
 * 不可删不可改（它们**不在** `countdowns` 里存第二份，见 `utils/timeCenter.ts`）；
 * 自定义项由教师新建 / 编辑 / 删除。两类的「首页显示」是**同一个单选**——
 * 选中即写 `heroCountdownId`，首页 Hero 立刻换成那一项。
 */
const appSettings = useAppSettingsStore()
const toast = useToast()

const timeCenter = computed(() => appSettings.timeCenter)
const entries = computed(() => appSettings.countdownEntries)
const heroCountdownId = computed(() => timeCenter.value.heroCountdownId)

const daysWorked = computed(() => appSettings.daysWorked)
const termProgress = computed(() => appSettings.termProgress)

/** 学期起止倒置时如实提醒（不拦输入，也不悄悄改教师的日期） */
const termRangeInvalid = computed(
  () => timeCenter.value.semesterEnd < timeCenter.value.semesterStart,
)

function updateTimeCenter(patch: Parameters<typeof appSettings.updateTimeCenter>[0]): void {
  appSettings.updateTimeCenter(patch)
}

/** 把某一项设为「首页显示」 */
function selectHero(entry: CountdownEntry): void {
  if (entry.id === heroCountdownId.value) return
  if (!appSettings.setHeroCountdown(entry.id)) return
  toast.success(`首页倒计时已换成「${entry.name}」`)
}

/* ---------- 自定义倒计时：新建 / 编辑 ---------- */

const formOpen = ref(false)
/** 正在编辑的自定义项；null = 新建 */
const editingId = ref<string | null>(null)
const formName = ref('')
const formDate = ref('')

const isEditing = computed(() => editingId.value !== null)

function openCreate(): void {
  editingId.value = null
  formName.value = ''
  // 默认给一个离今天一个月左右的日期：日期控件不会停在 1970，教师少点几下
  const soon = new Date()
  soon.setMonth(soon.getMonth() + 1)
  formDate.value = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`
  formOpen.value = true
}

function openEdit(entry: CountdownEntry): void {
  editingId.value = entry.id
  formName.value = entry.name
  formDate.value = entry.date
  formOpen.value = true
}

/** 名称与日期都齐了才能提交（缺一个按钮就是灰的，不让教师点了才发现） */
const canSubmit = computed(() => formName.value.trim().length > 0 && Boolean(formDate.value))

function submitForm(): void {
  if (!canSubmit.value) return
  if (editingId.value) {
    if (
      !appSettings.updateCountdown(editingId.value, { name: formName.value, date: formDate.value })
    ) {
      toast.danger('这一项不是自定义倒计时，不能改')
      return
    }
    toast.success('倒计时已更新')
  } else {
    const created = appSettings.addCountdown(formName.value, formDate.value)
    if (!created) {
      toast.danger('名称与日期都要填，请检查后再试')
      return
    }
    toast.success(`已新建「${created.name}」，并设为首页显示`)
  }
  formOpen.value = false
}

/* ---------- 自定义倒计时：删除 ---------- */

const removing = ref<CountdownEntry | null>(null)

function askRemove(entry: CountdownEntry): void {
  removing.value = entry
}

function confirmRemove(): void {
  const target = removing.value
  removing.value = null
  if (!target) return
  if (!appSettings.removeCountdown(target.id)) {
    toast.danger('删除失败：这一项可能已经不在了')
    return
  }
  // 删掉的正好是首页那一项时，store 已把「首页显示」拉回内置默认——顺手说清楚
  toast.success(
    target.id === heroCountdownId.value
      ? `已删除「${target.name}」，首页倒计时回到默认项`
      : `已删除「${target.name}」`,
  )
}

/* ---------- 首页 Hero 外观（沿用 v3.0.4-rc，未删除） ---------- */

const settings = computed(() => appSettings.settings)

/** 当前背景是否命中某个预设（命中则自定义输入框留空） */
const isPresetBackground = computed(() =>
  HERO_BACKGROUNDS.some((preset) => preset.url === settings.value.heroBackground),
)

/** 行下方那句「还剩 N 天 / 已过 N 天」——与首页 Hero 卡同一个算法 */
function daysText(entry: CountdownEntry): string {
  const days = appSettings.daysUntil(entry.date)
  if (days > 0) return `还剩 ${days} 天`
  if (days === 0) return '就是今天'
  return `已过 ${Math.abs(days)} 天`
}
</script>

<template>
  <SettingsPage
    title="时光中心"
    subtitle="首页 Hero 与「我的 → 工作时光」共用这一套时间，改一处两边同步"
  >
    <!-- ① 学期时间 -->
    <SettingsSection title="学期时间">
      <SettingsField label="开学日期" hint="学期进度的起点（首页与工作时光的进度条按它算）。">
        <template #control>
          <AppInput
            type="date"
            :model-value="timeCenter.semesterStart"
            @update:model-value="updateTimeCenter({ semesterStart: String($event) })"
          />
        </template>
      </SettingsField>

      <SettingsField label="期末日期" hint="学期进度的终点，也是内置倒计时「距离期末」的目标日期。">
        <template #control>
          <AppInput
            type="date"
            :model-value="timeCenter.semesterEnd"
            @update:model-value="updateTimeCenter({ semesterEnd: String($event) })"
          />
        </template>
      </SettingsField>

      <p v-if="termRangeInvalid" class="warn">
        期末日期早于开学日期，学期进度会一直显示 100%。请把两个日期调成正确的前后顺序。
      </p>
    </SettingsSection>

    <!-- ② 支教时间 -->
    <SettingsSection title="支教时间">
      <SettingsField
        label="支教开始日期"
        hint="决定首页 Hero 的「第 X 天」与工作时光的「支教天数」（含首日），也是内置倒计时「距离出发」的目标日期。"
      >
        <template #control>
          <AppInput
            type="date"
            :model-value="timeCenter.serviceStart"
            @update:model-value="updateTimeCenter({ serviceStart: String($event) })"
          />
        </template>
      </SettingsField>
    </SettingsSection>

    <!-- ③ 倒计时（内置三项 + 自定义，共用一个「首页显示」单选） -->
    <SettingsSection title="倒计时">
      <!-- radiogroup：每个圆点都是一个 role="radio" 的按钮，箭头键能在组内走 -->
      <div class="cd-list" role="radiogroup" aria-label="首页显示哪一项倒计时">
        <div
          v-for="entry in entries"
          :key="entry.id"
          class="cd-card"
          :class="{ 'is-hero': entry.id === heroCountdownId }"
        >
          <div class="cd-card__inner">
            <button
              type="button"
              class="cd-card__pick"
              role="radio"
              :aria-checked="entry.id === heroCountdownId"
              :aria-label="`把「${entry.name}」设为首页显示`"
              @click="selectHero(entry)"
            >
              <span class="cd-card__dot" :class="{ 'is-on': entry.id === heroCountdownId }" />
            </button>

            <div class="cd-card__body">
              <div class="cd-card__top">
                <span class="cd-card__title">{{ entry.name }}</span>
                <span v-if="entry.builtin" class="cd-card__tag">内置</span>
              </div>
              <span class="cd-card__date">
                {{ entry.date }}
                <template v-if="entry.hint">· {{ entry.hint }}</template>
              </span>
            </div>

            <div class="cd-card__right">
              <span
                class="cd-card__count"
                :class="{ 'is-past': appSettings.daysUntil(entry.date) < 0 }"
              >
                {{ daysText(entry) }}
              </span>
              <!-- 内置项不可删不可改：名称与日期都由上面的字段决定，这里就不给按钮 -->
              <div v-if="!entry.builtin" class="cd-card__actions">
                <button type="button" class="cd-card__act" @click="openEdit(entry)">
                  <Pencil :size="12" :stroke-width="2" aria-hidden="true" />
                  编辑
                </button>
                <button
                  type="button"
                  class="cd-card__act cd-card__act--del"
                  @click="askRemove(entry)"
                >
                  <Trash2 :size="12" :stroke-width="2" aria-hidden="true" />
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="cd-foot">
        <button type="button" class="cd-add" @click="openCreate">
          <Plus :size="14" :stroke-width="2" aria-hidden="true" />
          新建倒计时
        </button>
        <p class="cd-foot__hint">
          上面三项跟着学期 / 支教日期走，不用单独填；自己加的可以改名称与日期。
          右边选中的那一项就是首页 Hero 正在显示的那一项。
        </p>
      </div>
    </SettingsSection>

    <!-- ④ 首页 Hero 外观 -->
    <SettingsSection title="首页 Hero">
      <SettingsField label="副标题" hint="问候与日期下面的一行小字。留空则首页不显示这一行。">
        <template #control>
          <AppInput
            :model-value="settings.heroSubtitle"
            placeholder="如 支教一年的高原记录 · 昌都"
            @update:model-value="appSettings.update({ heroSubtitle: String($event) })"
          />
        </template>
      </SettingsField>

      <SettingsField label="背景图" stack>
        <div class="bg-presets">
          <button
            v-for="preset in HERO_BACKGROUNDS"
            :key="preset.id"
            type="button"
            class="bg-presets__item"
            :class="{ 'is-active': settings.heroBackground === preset.url }"
            @click="appSettings.update({ heroBackground: preset.url })"
          >
            <img class="bg-presets__thumb" :src="preset.url" alt="" />
            <span class="bg-presets__label">{{ preset.label }}</span>
          </button>
        </div>
        <AppField label="自定义背景图 URL">
          <AppInput
            :model-value="isPresetBackground ? '' : settings.heroBackground"
            placeholder="https://…（留空则用上面选中的预设）"
            @update:model-value="appSettings.update({ heroBackground: String($event) })"
          />
        </AppField>
        <p class="field-hint">留空或填错时，Hero 会退回默认底色，不会白屏。</p>
      </SettingsField>

      <SettingsField label="显示进度与百分比" hint="关掉后 Hero 倒计时卡只显示剩余天数。">
        <template #control>
          <AppSwitch
            :model-value="settings.showProgress"
            label="显示进度"
            @update:model-value="appSettings.update({ showProgress: $event })"
          />
        </template>
      </SettingsField>
    </SettingsSection>

    <!-- 实时预览：改完日期扫一眼，和首页对不对得上 -->
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
          <span class="preview__value">{{ appSettings.countdownMagnitude }}</span>
          <span class="preview__label">
            {{ appSettings.countdownIsPast ? '已过（天）' : '还剩（天）' }}·
            {{ appSettings.countdownTitle }}
          </span>
        </div>
      </div>
      <p class="preview__hint">改上面的日期，这里与首页 Hero、工作时光会同时更新。</p>
    </SettingsSection>

    <!-- 新建 / 编辑自定义倒计时 -->
    <AppModal v-model="formOpen" :title="isEditing ? '编辑倒计时' : '新建倒计时'" :width="420">
      <form id="cd-form" class="cd-form" @submit.prevent="submitForm">
        <AppField label="倒计时名称" required hint="会显示在首页 Hero 的倒计时卡上。">
          <AppInput v-model="formName" placeholder="如 距离国庆放假" />
        </AppField>
        <AppField label="目标日期" required hint="倒数到这一天；已经过去的日期也可以填。">
          <AppInput v-model="formDate" type="date" />
        </AppField>
      </form>
      <template #footer>
        <AppButton variant="ghost" @click="formOpen = false">取消</AppButton>
        <AppButton type="submit" form="cd-form" :disabled="!canSubmit">
          {{ isEditing ? '保存' : '新建并显示在首页' }}
        </AppButton>
      </template>
    </AppModal>

    <!-- 删除确认 -->
    <AppModal
      :model-value="Boolean(removing)"
      title="删除倒计时"
      :width="380"
      @update:model-value="removing = null"
    >
      <p class="confirm-text">
        确定删除倒计时
        <strong>{{ removing?.name ?? '' }}</strong>
        吗？此操作无法撤销。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="removing = null">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemove">删除</AppButton>
      </template>
    </AppModal>
  </SettingsPage>
</template>

<style scoped>
/* ==========================================
   倒计时列表（对齐 Changdu-Memory TimeCenter 的 tc-cd-* 一套）
   ========================================== */
.cd-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: var(--space-3) var(--space-4);
}

.cd-card {
  border: var(--border-hairline-width) solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  transition:
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

/* 当前设为「首页显示」的那一项：描边点亮（参考版 tc-cd-card--pinned） */
.cd-card.is-hero {
  border-color: var(--color-primary);
}

@media (hover: hover) {
  .cd-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-card);
  }
}

.cd-card__inner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
}

/* 单选点：整块可点，直径 18px 的圆点（自绘，ui/ 里没有单选件） */
.cd-card__pick {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}

.cd-card__dot {
  width: 18px;
  height: 18px;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-full);
  transition:
    border-color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.cd-card__dot.is-on {
  border-color: var(--color-primary);
  background: var(--color-primary);
  /* 内嵌白点：外圈实心 + 内圈留白，一眼看出选中 */
  box-shadow: inset 0 0 0 3px var(--bg-card);
}

.cd-card__pick:focus-visible {
  outline: none;
}

.cd-card__pick:focus-visible .cd-card__dot {
  box-shadow: var(--ring-focus);
}

.cd-card__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cd-card__top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cd-card__title {
  font-size: var(--font-content);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

/* 「内置」小标签：点明这一行不可删、日期跟着上面的字段走 */
.cd-card__tag {
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: var(--color-primary-bg);
  color: var(--color-primary-strong);
  font-size: 11px;
  font-weight: var(--font-weight-medium);
}

.cd-card__date {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.cd-card__right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.cd-card__count {
  font-size: var(--text-md);
  font-weight: var(--font-weight-bold);
  color: var(--color-primary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.cd-card__count.is-past {
  color: var(--color-text-tertiary);
}

.cd-card__actions {
  display: flex;
  gap: 4px;
}

.cd-card__act {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text-tertiary);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out);
}

.cd-card__act:hover {
  color: var(--color-primary);
  background: var(--color-primary-bg);
}

.cd-card__act--del:hover {
  color: var(--color-danger-strong);
  background: rgba(194, 103, 106, 0.08);
}

.cd-foot {
  padding: 0 var(--space-4) var(--space-3);
}

/* 「新建倒计时」：次按钮（参考版 tc__add-btn），不抢主视觉 */
.cd-add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  border: var(--border-hairline-width) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--bg-card);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: var(--font-caption);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.cd-add:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.cd-add:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.cd-foot__hint {
  margin: var(--space-2) 0 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  line-height: var(--leading-normal);
}

.cd-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.confirm-text {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.confirm-text strong {
  color: var(--color-text);
}

/* ==========================================
   首页 Hero 外观（沿用 v3.0.4-rc）
   ========================================== */
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
  transition: border-color var(--duration-fast) var(--ease-out);
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

/* ==========================================
   实时预览
   ========================================== */
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

.warn {
  margin: 0;
  padding: var(--space-2) var(--space-4) var(--space-3);
  font-size: var(--font-caption);
  color: var(--color-danger-strong);
  line-height: var(--leading-normal);
}

/* 窄屏：天数与操作换到下一行，避免把名称挤成一列单字 */
@media (max-width: 500px) {
  .cd-card__inner {
    flex-direction: column;
    gap: 10px;
  }

  .cd-card__right {
    width: 100%;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}
</style>
