<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight, Ellipsis } from 'lucide-vue-next'

import { AppBadge, AppCard } from '@/components/ui'
import type { Student } from '@/types'
import StudentAvatar from './StudentAvatar.vue'
import StudentCardMeta from './StudentCardMeta.vue'

const props = withDefaults(
  defineProps<{
    student: Student
    /** 批量管理模式下卡片可勾选（Phase 5B）：点卡片 = 勾选，而不是打开详情 */
    selectable?: boolean
    selected?: boolean
    /** 同名学生总数；>1 时显示重名徽章并在姓名后带消歧 */
    duplicateCount?: number
    /** 重名消歧文案（值日组优先，回落学号后四位） */
    disambiguator?: string
    /** 家庭地区短文案（县区优先） */
    region?: string
    /** 值日组名（来自值日 Store，只读展示） */
    dutyGroup?: string
  }>(),
  {
    selectable: false,
    selected: false,
    duplicateCount: undefined,
    disambiguator: undefined,
    region: undefined,
    dutyGroup: undefined,
  },
)

const emit = defineEmits<{
  open: [student: Student]
  toggle: [student: Student]
}>()

/**
 * 点击 / 回车的分流。批量模式下卡片是「选择器」而不是「入口」——
 * 否则教师想勾一个人，却每次都弹出详情弹窗，得先关掉才能继续选。
 */
function activate() {
  if (props.selectable) {
    emit('toggle', props.student)
    return
  }
  emit('open', props.student)
}

/**
 * 信息优先级（UI-4A 产品规范）：姓名最醒目 → 身份标签 → 辅助信息 → 操作。
 * 重名徽章只在真正重名时出现，不给大多数卡片添噪。
 */
const isDuplicate = computed(() => (props.duplicateCount ?? 1) > 1)
</script>

<template>
  <AppCard
    class="student-card"
    :class="{ 'is-selectable': selectable, 'is-selected': selected }"
    :hoverable="false"
    :role="selectable ? undefined : 'button'"
    :tabindex="selectable ? undefined : 0"
    @click="activate"
    @keydown.enter="activate"
  >
    <label v-if="selectable" class="picker" @click.stop>
      <input
        type="checkbox"
        class="picker-input"
        :checked="selected"
        :aria-label="`选择 ${student.name}`"
        @change="emit('toggle', student)"
      />
    </label>

    <!-- 顶部：头像 + 姓名（22px，第一优先级，独占整行） -->
    <div class="card-top">
      <StudentAvatar :name="student.name" />
      <div class="who">
        <h3 class="name">
          {{ student.name
          }}<span v-if="isDuplicate && disambiguator" class="name-disamb"
            >（{{ disambiguator }}）</span
          >
        </h3>
        <!-- 学号自 Phase 5A 起可选，空值按 §2.3 显示占位符 -->
        <p class="student-no">{{ student.studentNo || '—' }}</p>
      </div>
    </div>

    <!-- 身份徽章：性别 / 重名 / 班委 / 标签（不与姓名争宽度） -->
    <div class="badges">
      <AppBadge :variant="student.gender === 'male' ? 'primary' : 'neutral'">
        {{ student.gender === 'male' ? '男' : '女' }}
      </AppBadge>
      <AppBadge v-if="isDuplicate" variant="warning"> 同名 {{ duplicateCount }} 人 </AppBadge>
      <AppBadge v-if="student.cadreRole" variant="success">{{ student.cadreRole }}</AppBadge>
      <AppBadge v-for="tag in student.tags ?? []" :key="tag" variant="neutral">{{ tag }}</AppBadge>
    </div>

    <!-- 辅助信息：值日组 / 家庭地区 / 宿舍 / 电话（空值整块隐藏） -->
    <StudentCardMeta
      :duty-group="dutyGroup"
      :region="region"
      :dormitory="student.dormitory"
      :phone="student.phone"
    />

    <!-- 底部：查看档案（操作最后）；更多操作预留 -->
    <div v-if="!selectable" class="card-foot" aria-hidden="true">
      <span class="foot-label">查看档案</span>
      <span class="foot-icons">
        <Ellipsis :size="16" :stroke-width="2" />
        <ChevronRight :size="16" :stroke-width="2" />
      </span>
    </div>
  </AppCard>
</template>

<style scoped>
.student-card {
  cursor: pointer;
}

/* Contacts 风 Hover：2px 微抬升 + 克制阴影（UI-1 Motion） */
@media (hover: hover) {
  .student-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }
}

.student-card {
  transition:
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out),
    background var(--duration-base) var(--ease-out),
    border-color var(--duration-base) var(--ease-out);
}

.student-card.is-selectable {
  position: relative;
}

.student-card.is-selected,
.student-card.is-selected:hover {
  background: var(--color-primary-soft);
  border-color: var(--color-primary);
  box-shadow: var(--ring-focus);
  transform: none;
}

.student-card:active {
  transform: translateY(1px);
}

.student-card:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.picker {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  display: inline-flex;
  padding: var(--space-1);
  cursor: pointer;
}

.picker-input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--color-primary);
  cursor: pointer;
}

.card-top {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}

.who {
  flex: 1;
  min-width: 0;
}

.name {
  font-size: 22px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  line-height: var(--leading-tight);
  color: var(--color-text-primary);
  /* 姓名是第一信息优先级：放不下时换行（最多两行），绝不把姓名截成「旦…」 */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.name-disamb {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-tertiary);
}

.student-no {
  margin-top: 2px;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.badges :deep(.app-badge) {
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}

/* 底部操作暗示：轻到不与信息争层级 */
.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: var(--border-hairline-width) solid var(--color-border-divider);
  color: var(--color-text-tertiary);
  font-size: var(--font-caption);
}

.foot-icons {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  opacity: 0.7;
}
</style>
