<script setup lang="ts">
/**
 * 违纪概览：统计 / 按违纪事件统计 / 排行 / 经常违纪 / 严重事件。
 *
 * 所有数字由统计纯函数实时派生（`stores/violation.ts` 的 computed），组件只展示。
 * v3.8.1 取消违纪分类后，原来的「按类型统计」替换为「按违纪事件统计」。
 */
import { computed } from 'vue'

import { AppBadge, AppCard } from '@/components/ui'
import { formatMonthDay } from '@/utils/date'
import type { ViolationEvent } from '@/types/violation'
import type {
  StudentViolationRank,
  ViolationBehaviorCount,
  ViolationOverview,
} from '@/utils/violationStats'

const props = defineProps<{
  overview: ViolationOverview
  ranking: StudentViolationRank[]
  frequentStudents: StudentViolationRank[]
  severeEvents: ViolationEvent[]
  /** 按具体事件（behaviorLabel）统计；只列出现过的 */
  behaviorCounts: ViolationBehaviorCount[]
  /** 排名最多展示多少条（超出时提示总数） */
  rankingLimit?: number
}>()

const emit = defineEmits<{
  profile: [studentId: string]
  viewEvent: [event: ViolationEvent]
}>()

const rankingLimit = computed(() => props.rankingLimit ?? 10)
const visibleRanking = computed(() => props.ranking.slice(0, rankingLimit.value))
/** 概览只展示前 8 个事件，避免长尾把卡片撑得太高 */
const visibleBehaviors = computed(() => props.behaviorCounts.slice(0, 8))
const maxBehaviorCount = computed(() =>
  Math.max(1, ...visibleBehaviors.value.map((row) => row.count)),
)

const stats = computed(() => [
  { key: 'total', label: '违纪事件总数', value: props.overview.total },
  { key: 'students', label: '涉及学生人数', value: props.overview.studentCount },
  { key: 'minor', label: '一般违纪', value: props.overview.severity.minor },
  { key: 'moderate', label: '较严重违纪', value: props.overview.severity.moderate },
  { key: 'severe', label: '严重违纪', value: props.overview.severity.severe },
  { key: 'frequent', label: '经常违纪学生', value: props.frequentStudents.length },
])
</script>

<template>
  <div class="overview">
    <!-- 统计卡 -->
    <section class="stat-grid" aria-label="违纪统计">
      <div v-for="item in stats" :key="item.key" class="stat-card">
        <p class="stat-value">{{ item.value }}</p>
        <p class="stat-label">{{ item.label }}</p>
      </div>
    </section>

    <div class="overview-columns">
      <div class="overview-main">
        <!-- 按类型统计 -->
        <AppCard title="按违纪事件统计" subtitle="只列出现过的具体事件，展示前 8 个">
          <ul v-if="visibleBehaviors.length" class="behavior-list">
            <li v-for="row in visibleBehaviors" :key="row.behaviorLabel" class="behavior-row">
              <span class="behavior-label">{{ row.behaviorLabel }}</span>
              <span class="behavior-bar" aria-hidden="true">
                <span
                  class="behavior-bar-fill"
                  :style="{ width: `${(row.count / maxBehaviorCount) * 100}%` }"
                />
              </span>
              <span class="behavior-count">{{ row.count }} 次</span>
            </li>
          </ul>
          <p v-else class="empty-hint">暂无违纪事件。</p>
        </AppCard>

        <!-- 严重违纪 -->
        <AppCard title="严重违纪事件" subtitle="按严重程度独立展示，点击查看详情">
          <ul v-if="severeEvents.length" class="severe-list">
            <li v-for="event in severeEvents" :key="event.id">
              <button type="button" class="severe-item" @click="emit('viewEvent', event)">
                <AppBadge variant="danger">严重违纪</AppBadge>
                <span class="severe-name">{{ event.studentName }}</span>
                <span class="severe-behavior">{{ event.behaviorLabel }}</span>
                <span class="severe-date">{{ formatMonthDay(event.date) }}</span>
              </button>
            </li>
          </ul>
          <p v-else class="empty-hint">暂无严重违纪事件。</p>
        </AppCard>
      </div>

      <div class="overview-side">
        <!-- 学生排行 -->
        <AppCard title="学生违纪次数排行" subtitle="次数降序 · 同次数按姓名升序">
          <ol v-if="visibleRanking.length" class="rank-list">
            <li v-for="(row, index) in visibleRanking" :key="row.studentId">
              <button type="button" class="rank-item" @click="emit('profile', row.studentId)">
                <span class="rank-index">{{ index + 1 }}</span>
                <span class="rank-name">{{ row.studentName }}</span>
                <AppBadge variant="neutral">{{ row.count }} 次</AppBadge>
              </button>
            </li>
          </ol>
          <p v-else class="empty-hint">暂无违纪记录。</p>
          <p v-if="ranking.length > visibleRanking.length" class="more-hint">
            共 {{ ranking.length }} 名有违纪记录的学生，此处显示前 {{ visibleRanking.length }} 名。
          </p>
        </AppCard>

        <!-- 经常违纪（≥3 次，最多 10 名） -->
        <AppCard title="经常违纪学生" subtitle="累计 ≥3 次，最多展示前 10 名">
          <ul v-if="frequentStudents.length" class="rank-list">
            <li v-for="row in frequentStudents" :key="row.studentId">
              <button type="button" class="rank-item" @click="emit('profile', row.studentId)">
                <span class="rank-name">{{ row.studentName }}</span>
                <span class="frequent-count">{{ row.count }} 次</span>
              </button>
            </li>
          </ul>
          <p v-else class="empty-hint">暂无累计 ≥3 次的学生。</p>
        </AppCard>

        <AppCard title="说明">
          <p class="note-text">
            每条违纪事件独立计数；严重程度只作标签，不折算次数、不扣分、不自动处分。
          </p>
          <p class="note-text">
            统计范围为全部历史有效记录；涉及人数与排行只统计在读学生，已退档学生的历史记录仍可查看。
          </p>
        </AppCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overview {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--space-3);
}

.stat-card {
  padding: var(--space-4);
  background: var(--color-bg-white);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
}

.stat-value {
  font-size: var(--font-num-md);
  font-weight: var(--font-weight-semibold);
  line-height: 1.1;
  color: var(--color-text-primary);
}

.stat-label {
  margin-top: var(--space-1);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.overview-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
}

@media (min-width: 1024px) {
  .overview-columns {
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  }
}

.overview-main,
.overview-side {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.behavior-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.behavior-row {
  display: grid;
  grid-template-columns: minmax(96px, 34%) minmax(0, 1fr) 56px;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-secondary);
}

.behavior-label {
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.behavior-bar {
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-bg-subtle);
  overflow: hidden;
}

.behavior-bar-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--color-primary);
}

.behavior-count {
  text-align: right;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.rank-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rank-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 40px;
  padding: var(--space-1) var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.rank-item:hover {
  background: var(--color-primary-bg);
}

.rank-item:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.rank-index {
  width: 20px;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.rank-name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-secondary);
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
}

.frequent-count {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  color: var(--color-danger-strong);
  font-variant-numeric: tabular-nums;
}

.severe-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.severe-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  width: 100%;
  min-height: 40px;
  padding: var(--space-1) var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.severe-item:hover {
  background: var(--color-danger-soft);
}

.severe-item:focus-visible {
  outline: none;
  box-shadow: var(--ring-danger);
}

.severe-name {
  font-size: var(--font-secondary);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
}

.severe-behavior {
  flex: 1;
  min-width: 0;
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.severe-date {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.empty-hint {
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.more-hint {
  margin-top: var(--space-2);
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.note-text {
  font-size: var(--font-caption);
  line-height: var(--leading-relaxed);
  color: var(--color-text-secondary);
}

.note-text + .note-text {
  margin-top: var(--space-1);
}
</style>
