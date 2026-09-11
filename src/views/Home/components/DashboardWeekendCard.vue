<script setup lang="ts">
import { computed } from 'vue'

import { AppBadge, AppButton, AppCard, EmptyState } from '@/components/ui'
import type { WeekendReturnRecord } from '@/types/weekend'

/**
 * 工作台「周末返家」卡片（Phase 7B）：本周末谁回家，一眼看全。
 *
 * 与请假卡片的分工：请假卡回答「有没有待批的假」，本卡回答「这个周末谁不在学校」——
 * 两者都是班主任在周五最需要先看到的信息，因此都放在工作台上，但各自独立成卡。
 * 卡片不管跳转（`emit('open')` 由页面 push），派生值由页面算好经 props 下传。
 *
 * **`returns` 只含仍在读的学生**（Phase 8 起由 store 的 `currentReturns` 给出）：
 * 徽标数的就是它，所以下面列出的名字必然与徽标对得上。已退档学生的历史记录
 * 不在这里列（他们已不是这个班的人），但条数经 `staleCount` 说出来。
 *
 * **空态与「已不在档案」的小字是互斥的**（Phase 8 审查修复）：本期一条在读登记都没有、
 * 却留着退档学生的历史登记时，卡片既不能说「还没有登记返家」（明明有登记），
 * 也不能把那几个名字列出来（不计入人数）——于是给一句专门的说法，
 * 按钮也跟着改成「去周末管理」而不是「登记返家」。原先只加了小字、没改空态：
 * 「另有 1 条已不在档案的登记」与「还没有登记返家」同屏，卡片自己说反话（§11.1）。
 */

interface Props {
  /** 这一期的说法，如「本周末」 */
  weekendLabel: string
  /** 本期**在读**学生的返家记录：卡片只用 `id` 作 key、用姓名快照展示，不需要其它字段 */
  returns: WeekendReturnRecord[]
  /** 本月累计返家人次 */
  monthCount: number
  /** 本期已不在档案的登记条数：不进徽标也不列名字，但要说出来（不是 0 时卡片多一行小字） */
  staleCount: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** 请求打开周末管理页（由页面跳转，卡片不管路由） */
  open: []
}>()

/** 卡片篇幅有限：最多列 8 个名字，其余折叠成一行提示 */
const MAX_CHIPS = 8

const shown = computed(() => props.returns.slice(0, MAX_CHIPS))
const restCount = computed(() => Math.max(0, props.returns.length - MAX_CHIPS))

/** 本期只有已不在档案的历史登记：既不列名字、也不能说「还没有登记返家」 */
const staleOnly = computed(() => props.returns.length === 0 && props.staleCount > 0)

/** 本期有登记可看（在读的，或只剩历史登记）：空态与「登记返家」按钮都据此让位 */
const hasRecords = computed(() => props.returns.length > 0 || props.staleCount > 0)
</script>

<template>
  <AppCard title="周末返家">
    <template #actions>
      <AppBadge :variant="returns.length > 0 ? 'primary' : 'neutral'" size="sm">
        {{ weekendLabel }} {{ returns.length }} 人
      </AppBadge>
    </template>

    <ul v-if="shown.length > 0" class="return-chips">
      <!-- key 用记录 id：姓名快照是「姓名（学号后四位）」，同名且学号后四位相同就会撞 key -->
      <li v-for="item in shown" :key="item.id" class="return-chip">{{ item.studentName }}</li>
      <li v-if="restCount" class="return-chip is-rest">还有 {{ restCount }} 人</li>
    </ul>

    <!-- 只有历史登记：说清「有登记但不算人」，既不是空态也不列名字（见脚本区的说明） -->
    <p v-else-if="staleOnly" class="stale-note">
      {{ weekendLabel }}只有 {{ staleCount }} 条已不在档案的登记，不计入人数
    </p>

    <!-- 空态跟着 props 的期次说法走，不写死「本周末」：卡片今天是只服务本周末，
         但文案与徽标用同一个 weekendLabel 才不会在换个期次时自相矛盾 -->
    <EmptyState
      v-else
      icon="🧳"
      :title="`${weekendLabel}还没有登记返家`"
      description="登记之后，这个周末谁不在学校一眼就能看到。"
    />

    <!-- 退档学生的登记不计入人数、也不列名字，但得让教师知道它在（周末管理页仍列得出来）；
         上面那句「只有…」已经把这几个数说全了，不再重复 -->
    <p v-if="staleCount && !staleOnly" class="stale-note">
      另有 {{ staleCount }} 条已不在档案的登记，不计入人数
    </p>

    <div class="card-foot">
      <p class="foot-note">本月累计 {{ monthCount }} 人次</p>
      <AppButton size="sm" variant="secondary" @click="emit('open')">
        {{ hasRecords ? '去周末管理' : '登记返家' }}
      </AppButton>
    </div>
  </AppCard>
</template>

<style scoped>
.return-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: 0;
  margin: 0;
  list-style: none;
}

.return-chip {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  border-radius: 999px;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-size: var(--text-sm);
}

.return-chip.is-rest {
  background: var(--color-fill-disabled);
  color: var(--color-text-secondary);
}

.stale-note {
  margin-top: var(--space-3);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
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
