<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge, AppButton, AppDrawer } from '@/components/ui'
import {
  LESSON_TYPE_LABELS,
  WEEKDAY_LABELS,
  periodFullTextOf,
  periodLabelOf,
} from '@/utils/timetable'
import type { CourseExchange, Lesson } from '@/types/timetable'

/**
 * 课程详情抽屉（V1.1.3）：点课程卡片先看详情，再从这里选「编辑 / 换课 / 代课 / 删除」。
 * 需求明确不在卡片上直接编辑全部字段——换课尤其不能靠改字段，它有原时间 → 新时间的完整记录。
 */
interface Props {
  modelValue: boolean
  lesson?: Lesson
  /** 该课由哪次换课调过来（没有则为 undefined） */
  exchange?: CourseExchange
  /** 同一晚自习组的其他节（三节晚自习共享一个组 id） */
  eveningSiblings?: Lesson[]
}

const props = withDefaults(defineProps<Props>(), {
  lesson: undefined,
  exchange: undefined,
  eveningSiblings: () => [],
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  edit: []
  exchange: []
  substitute: []
  remove: []
  /** 撤销这次换课（恢复原时间的课程） */
  undo: []
}>()

const badgeText = computed(() =>
  props.lesson && props.lesson.type !== 'normal'
    ? LESSON_TYPE_LABELS[props.lesson.type]
    : undefined,
)

const badgeVariant = computed(() => (props.lesson?.type === 'substitute' ? 'warning' : 'neutral'))

/** 「调整自 周一 第5节」文案：让教师知道这节课为什么不在原来的时间 */
const exchangeNote = computed(() => {
  const exchange = props.exchange
  if (!exchange) return ''
  return `调整自 ${WEEKDAY_LABELS[exchange.from.weekday]} ${periodLabelOf(exchange.from.periodId)}`
})

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppDrawer :model-value="modelValue" title="课程详情" :width="440" @update:model-value="close">
    <div v-if="lesson" class="detail">
      <div class="detail-head">
        <span class="detail-subject">{{ lesson.subject }}</span>
        <AppBadge v-if="badgeText" :variant="badgeVariant" size="sm">{{ badgeText }}</AppBadge>
      </div>

      <dl class="detail-list">
        <div class="detail-row">
          <dt>时间</dt>
          <dd>{{ WEEKDAY_LABELS[lesson.weekday] }} · {{ periodFullTextOf(lesson.periodId) }}</dd>
        </div>
        <div class="detail-row">
          <dt>班级</dt>
          <dd>{{ lesson.className }}</dd>
        </div>
        <div v-if="lesson.originalTeacher" class="detail-row">
          <dt>原授课教师</dt>
          <dd>{{ lesson.originalTeacher }}</dd>
        </div>
        <div v-if="lesson.courseGroupId" class="detail-row">
          <dt>晚自习组</dt>
          <dd>
            与另外 {{ eveningSiblings.length }} 节同属一组（{{
              eveningSiblings.map((item) => periodLabelOf(item.periodId)).join('、') || '——'
            }}），可整组换课
          </dd>
        </div>
        <div v-if="exchangeNote" class="detail-row">
          <dt>换课</dt>
          <dd>
            {{ exchangeNote }}
            <button type="button" class="undo-link" @click="emit('undo')">撤销这次换课</button>
          </dd>
        </div>
      </dl>

      <p class="detail-tip">
        要改时间请用「换课」——它会保留原时间与新时间的对应关系；直接编辑适合改科目 / 班级这类内容。
      </p>
    </div>

    <template #footer>
      <AppButton variant="ghost" @click="emit('remove')">删除</AppButton>
      <AppButton variant="ghost" @click="emit('substitute')">代课</AppButton>
      <AppButton variant="secondary" @click="emit('edit')">编辑</AppButton>
      <AppButton @click="emit('exchange')">换课</AppButton>
    </template>
  </AppDrawer>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.detail-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.detail-subject {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--color-text);
}

.detail-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.detail-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}

.detail-row dt {
  flex-shrink: 0;
  width: 84px;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.detail-row dd {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--color-text);
  line-height: 1.6;
}

.undo-link {
  margin-left: var(--space-2);
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-danger-strong);
  cursor: pointer;
}

.detail-tip {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-fill-disabled);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-text-secondary);
}
</style>
