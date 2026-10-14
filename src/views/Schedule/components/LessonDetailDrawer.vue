<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge, AppButton, AppDrawer } from '@/components/ui'
import { describeExchangeWeeks, isWeeklyExchange } from '@/utils/exchange'
import {
  LESSON_TYPE_LABELS,
  WEEKDAY_LABELS,
  periodFullTextOf,
  periodLabelOf,
} from '@/utils/timetable'
import type { CourseExchange, Lesson } from '@/types/timetable'

/**
 * 课程详情抽屉（V1.1.3；v3.7.5 增加教学周次说明）：点课程卡片先看详情，
 * 再从这里选「编辑 / 换课 / 代课 / 删除」。
 * 需求明确不在卡片上直接编辑全部字段——换课尤其不能靠改字段，它有原时间 → 新时间的完整记录。
 *
 * **v3.7.5 的新情况**：看到的可能是「某一周换课叠加出来的课」（`overlayWeek`）。
 * 那一节课**只存在于那一周的视图里**，基础课程表里的原课还在原时间——因此
 * 编辑 / 删除 / 再换课这些作用在基础课表上的入口一律不出现（避免教师以为在改「这一周的课」，
 * 结果把基础课表改了）；这条路径只给「撤销这次换课」。
 */
interface Props {
  modelValue: boolean
  lesson?: Lesson
  /** 该课由哪次换课调过来（没有则为 undefined） */
  exchange?: CourseExchange
  /** 同一晚自习组的其他节（三节晚自习共享一个组 id） */
  eveningSiblings?: Lesson[]
  /** 这节课是「第 N 周换课叠加出来的」（不是基础课表里那一节）时传 N */
  overlayWeek?: number
  /** 本周把这一节调走的换课记录（v3.7.5 周次级；可能多条：不同周次分别调了它） */
  weekExchanges?: CourseExchange[]
  /** 学期总周数（周次文案用：「全部 20 周」） */
  weekCount?: number
}

const props = withDefaults(defineProps<Props>(), {
  lesson: undefined,
  exchange: undefined,
  eveningSiblings: () => [],
  overlayWeek: undefined,
  weekExchanges: () => [],
  weekCount: 0,
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
  const base = `调整自 ${WEEKDAY_LABELS[exchange.from.weekday]} ${periodLabelOf(exchange.from.periodId)}`
  if (!isWeeklyExchange(exchange)) return base
  return `${base}（${describeExchangeWeeks(exchange.weeks ?? [], props.weekCount)}生效）`
})

/** 本周调走的换课（周次级）：说清「这周这节课去哪了」 */
const weekOutgoing = computed(() => props.weekExchanges.filter(isWeeklyExchange))

/** 展示的可能是叠加层里那一节：此时不给编辑 / 删除 / 再换课入口 */
const isOverlay = computed(() => props.overlayWeek !== undefined)

/** 叠加层那一节的原位置（基础课表里它还在那儿） */
const overlaySourceText = computed(() => {
  const exchange = props.exchange
  if (!exchange) return ''
  return `${WEEKDAY_LABELS[exchange.from.weekday]} ${periodFullTextOf(exchange.from.periodId)}`
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

        <!-- v3.7.5：本周把这一节调走的换课（周次级）——原位置也能看清「这周它去哪了」 -->
        <div v-for="move in weekOutgoing" :key="move.id" class="detail-row">
          <dt>本周换课</dt>
          <dd>
            调到 {{ WEEKDAY_LABELS[move.to.weekday] }} {{ periodLabelOf(move.to.periodId) }}（{{
              describeExchangeWeeks(move.weeks ?? [], weekCount)
            }}生效）
            <button type="button" class="undo-link" @click="emit('undo')">撤销这次换课</button>
          </dd>
        </div>
      </dl>

      <p v-if="isOverlay" class="detail-tip">
        这是第 {{ overlayWeek }} 周的换课结果：基础课程表里这节课仍然在
        <strong>{{ overlaySourceText }}</strong> ，编辑 / 删除请到那一节上操作；
        想让这一周恢复原样，点下面的「撤销这次换课」。
      </p>
      <p v-else class="detail-tip">
        要改时间请用「换课」——它会保留原时间与新时间的对应关系；直接编辑适合改科目 / 班级这类内容。
      </p>
    </div>

    <template #footer>
      <template v-if="isOverlay">
        <AppButton variant="ghost" @click="close">关闭</AppButton>
        <AppButton variant="danger" @click="emit('undo')">撤销这次换课</AppButton>
      </template>
      <template v-else>
        <AppButton variant="ghost" @click="emit('remove')">删除</AppButton>
        <AppButton variant="ghost" @click="emit('substitute')">代课</AppButton>
        <AppButton variant="secondary" @click="emit('edit')">编辑</AppButton>
        <AppButton @click="emit('exchange')">换课</AppButton>
      </template>
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
  font-weight: var(--font-weight-semibold);
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
