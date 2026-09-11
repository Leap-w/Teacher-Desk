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
 */

interface Props {
  /** 这一期的说法，如「本周末」 */
  weekendLabel: string
  /** 本期返家记录：卡片只用 `id` 作 key、用姓名快照展示，不需要其它字段 */
  returns: WeekendReturnRecord[]
  /** 本月累计返家人次 */
  monthCount: number
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

    <!-- 空态跟着 props 的期次说法走，不写死「本周末」：卡片今天是只服务本周末，
         但文案与徽标用同一个 weekendLabel 才不会在换个期次时自相矛盾 -->
    <EmptyState
      v-else
      icon="🧳"
      :title="`${weekendLabel}还没有登记返家`"
      description="登记之后，这个周末谁不在学校一眼就能看到。"
    />

    <div class="card-foot">
      <p class="foot-note">本月累计 {{ monthCount }} 人次</p>
      <AppButton size="sm" variant="secondary" @click="emit('open')">
        {{ returns.length > 0 ? '去周末管理' : '登记返家' }}
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
