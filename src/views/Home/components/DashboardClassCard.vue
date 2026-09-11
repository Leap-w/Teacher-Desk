<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { SchoolOutline } from '@vicons/ionicons5'

import { AppCard } from '@/components/ui'
import { describeDutyDay, dutyTodayState, nextDutyDay } from '@/utils/duty'
import type { DutyGroup } from '@/types/duty'
import type { DutyDay } from '@/utils/duty'

/**
 * 工作台「班级概况」卡片（Phase 8）：三行回答「这个班现在什么情况」——
 * 在读人数 / 今日值日 / 本周末留校，点哪一行就进哪个模块。
 *
 * **三行都只算在读学生**（§9.18）：在读人数是分母，留校 = 在读人数 − 这一期仍在读的返家人数；
 * 已退档的学生既不算人数也不算留校（他们已不是这个班的人），但卡片要把他们**说出来**
 * （第 1 行的小字）——退档学生在界面上没有别的入口（档案页只列在读学生、没有回收站），
 * 不说，教师只看到人数比记忆里少，却找不到少的是谁（Phase 8 审查修正：
 * 原注释写的是「档案页里他们还列着」，与实现相反）。
 * 口径一律由各 store 给出，卡片只负责摆出来——工作台上这几张卡挨着显示，
 * 数字一旦在卡片里再算一遍就会互相打架（§11.1）。
 *
 * 跳转在卡片内部完成（同「快捷入口」卡片）：三个入口各配一个 emit 不值当，
 * 而且目标路由是这张卡片自己的语义，不是页面需要知道的事。
 * 派生值仍由页面算好经 props 下传（与今日值日 / 周末返家两张卡片一致）。
 */

interface Props {
  /** 在读学生数（档案里未退档的学生） */
  studentCount: number
  /** 已退档的学生数：不在上面那个数里，界面上也不再出现（无回收站），只用小字说出来 */
  removedStudentCount: number
  /** 今天值日的组；今天不值日（周末不排）或还没排班时为 undefined */
  dutyGroup?: DutyGroup
  /** 今天按设置不值日（周末不排）且有值日组 */
  dutyWeekendSkipped: boolean
  /** 有值日组但还没设轮换起点 */
  dutyNeedsSetup: boolean
  /** 从今天起连续几天的安排（找「下一次值日」用，与今日值日卡片同源） */
  upcoming: DutyDay[]
  todayKey: string
  /** 这一期的说法，如「本周末」（与周末返家卡片同源，跨零点才不会一块翻篇一块不翻） */
  weekendLabel: string
  /** 本期留校人数（派生：在读人数 − 这一期仍在读的返家人数） */
  stayCount: number
  /** 本期返家人数（只算在读学生） */
  returnedCount: number
}

const props = defineProps<Props>()

const router = useRouter()

/** 三个入口的目标路由都在卡片自己身上（同「快捷入口」卡片） */
function open(path: string): void {
  void router.push(path)
}

/**
 * 今天值日的状态：与今日值日卡片共用同一个判定阶梯（`dutyTodayState`）——
 * 两张卡挨着显示，若各写一套顺序，同一个周末会一张说「还没设置轮换起点」、
 * 另一张说「今天不值日」（§11.1）。
 */
const todayState = computed(() =>
  dutyTodayState(props.dutyGroup, {
    weekendSkipped: props.dutyWeekendSkipped,
    needsSetup: props.dutyNeedsSetup,
  }),
)

/** 值日那一行的主文：有组就是组名，其余状态给一个短说法（原因写在下行小字里） */
const dutyValue = computed(() => {
  if (props.dutyGroup) return props.dutyGroup.name
  return todayState.value === 'weekend-skipped' ? '今天不值日' : '未排班'
})

/** 值日那一行的说明：先答「为什么没排」，排上了就答「下一次是谁」（文案与今日值日卡片同源） */
const dutyNote = computed(() => {
  if (todayState.value === 'needs-setup') return '还没设置轮换起点'
  if (todayState.value === 'no-groups') return '还没有值日组'
  const nextDay = describeDutyDay(nextDutyDay(props.upcoming, props.todayKey), props.todayKey)
  return nextDay ? `接下来：${nextDay}` : ''
})

/** 人数那一行的小字：新班级提示去建档，有退档的就说明他们不在这个数里 */
const studentNote = computed(() => {
  if (props.studentCount === 0) return '还没有学生档案，去添加'
  if (props.removedStudentCount) return `另有 ${props.removedStudentCount} 位已退档，不计入`
  return ''
})
</script>

<template>
  <AppCard title="班级概况">
    <template #actions>
      <span class="card-chip" aria-hidden="true">
        <SchoolOutline />
      </span>
    </template>

    <div class="overview-list">
      <button type="button" class="overview-row" @click="open('/students')">
        <span class="row-head">
          <span class="row-label">在读人数</span>
          <span class="row-value">{{ studentCount }} 人</span>
        </span>
        <span v-if="studentNote" class="row-note">{{ studentNote }}</span>
      </button>

      <button type="button" class="overview-row" @click="open('/duty')">
        <span class="row-head">
          <span class="row-label">今日值日</span>
          <span class="row-value">{{ dutyValue }}</span>
        </span>
        <span v-if="dutyNote" class="row-note">{{ dutyNote }}</span>
      </button>

      <button type="button" class="overview-row" @click="open('/weekend')">
        <span class="row-head">
          <span class="row-label">{{ weekendLabel }}留校</span>
          <span class="row-value">{{ stayCount }} 人</span>
        </span>
        <span class="row-note">返家 {{ returnedCount }} 人</span>
      </button>
    </div>
  </AppCard>
</template>

<style scoped>
.overview-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.overview-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.overview-row:hover {
  background: var(--color-primary-soft);
}

.overview-row:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.row-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.row-label {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.row-value {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--color-text);
}

.row-note {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

.card-chip {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.card-chip :deep(svg) {
  width: 18px;
  height: 18px;
}
</style>
