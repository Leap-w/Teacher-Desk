<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge, AppButton, AppCard } from '@/components/ui'
import { addDaysToDateKey } from '@/utils/date'
import { WEEKDAY_LABELS } from '@/utils/timetable'
import type { DutyGroup, DutyMember } from '@/types/duty'
import type { DutyDay } from '@/utils/duty'

interface Props {
  /** 今天值日的组；不值日（周末不排）或还没有组时为 undefined */
  group?: DutyGroup
  /** 该组成员（含已不在档案的） */
  members: DutyMember[]
  /** 今天的星期文案（与工作台其他卡片同源） */
  weekdayLabel: string
  /** 今天是周末且「周末值日」未开启（且已经有值日组） */
  weekendSkipped: boolean
  /** 有值日组但还没设轮换起点：要去值日管理补一步，而不是去建组 */
  needsSetup: boolean
  /** 从今天起连续几天的安排（找「下一次值日」用） */
  upcoming: DutyDay[]
  todayKey: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** 请求打开值日管理页（由页面跳转，卡片不管路由） */
  open: []
}>()

/** 组员标签最多显示几个：一个组六十来人时，这条横条不能长到把别的卡片挤走 */
const MAX_CHIPS = 8

const shownMembers = computed(() => props.members.slice(0, MAX_CHIPS))

const restCount = computed(() => Math.max(0, props.members.length - MAX_CHIPS))

/**
 * 下一次值日（跳过今天与不值日的日子）。周末不排时它能直接回答
 * 教师最关心的问题——「今天不值日，那下次是谁？」，而不用再跑一趟值日页。
 */
const nextDay = computed(() =>
  props.upcoming.find((day) => day.dateKey !== props.todayKey && day.group),
)

const nextText = computed(() => {
  const day = nextDay.value
  if (!day || !day.group) return ''
  const when =
    day.dateKey === addDaysToDateKey(props.todayKey, 1) ? '明天' : WEEKDAY_LABELS[day.weekday]
  return `${when}由「${day.group.name}」值日`
})

const footNote = computed(() => {
  // 今天有组、或今天按设置不值日时，都把「下一次是谁」摆在页脚；
  // 「还没设起点」与「还没有组」分成两句——后者让教师去建组，前者建的组已经在了
  if (props.group || props.weekendSkipped) {
    return nextText.value ? `接下来：${nextText.value}` : '值日组与轮换设置都在值日管理页。'
  }
  if (props.needsSetup) return '设好起点日期和起点组，每天的值日会自动排出来。'
  return '建好值日组，轮换会自动按天排起来。'
})
</script>

<template>
  <AppCard title="今日值日">
    <template #actions>
      <AppBadge variant="neutral" size="sm">今天 {{ weekdayLabel }}</AppBadge>
    </template>

    <div v-if="group" class="duty-band">
      <div class="band-head">
        <p class="band-group">{{ group.name }}</p>
        <AppBadge variant="primary" size="sm">共 {{ members.length }} 人</AppBadge>
      </div>
      <ul v-if="members.length" class="member-chips">
        <li v-for="member in shownMembers" :key="member.id" class="member-chip">
          {{ member.name }}
          <span v-if="!member.active" class="member-gone">已不在档案</span>
        </li>
        <li v-if="restCount" class="member-chip is-rest">还有 {{ restCount }} 人</li>
      </ul>
      <p v-else class="band-note">这个组还没有组员，去值日管理把同学加进来。</p>
    </div>

    <p v-else-if="needsSetup" class="band-note">
      🗓️ 还没设置轮换起点，去值日管理设好就会自动排班。
    </p>

    <p v-else-if="weekendSkipped" class="band-note">🌙 今天不值日（当前设置为周末不排）。</p>

    <p v-else class="band-note">🧹 还没有值日组，去值日管理建好组就能自动轮换。</p>

    <div class="card-foot">
      <p class="foot-note">{{ footNote }}</p>
      <AppButton size="sm" variant="secondary" @click="emit('open')">去值日管理</AppButton>
    </div>
  </AppCard>
</template>

<style scoped>
.duty-band {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.band-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.band-group {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--color-text);
}

.member-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: 0;
  margin: 0;
  list-style: none;
}

.member-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  border-radius: 999px;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-size: var(--text-sm);
}

.member-gone {
  font-size: var(--text-xs);
  color: var(--color-warning-strong);
}

.member-chip.is-rest {
  background: var(--color-fill-disabled);
  color: var(--color-text-secondary);
}

.band-note {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.foot-note {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
</style>
