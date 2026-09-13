<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { AppBadge, AppButton, EmptyState } from '@/components/ui'
import { CalendarDays, Moon, Paintbrush } from 'lucide-vue-next'
import type { DutyGroup, DutyMember } from '@/types/duty'

/**
 * DutyHero — 今日值日 Hero（V2.0.6-alpha · Phase UI-4D，Today First 视觉中心）：
 * 日期 + 今日组名 + 组员胶囊 + 轮换状态；极轻渐变、进入 200ms 渐入。
 * 周末不排 / 待设起点 / 未建组三种空态各自把「下一步」说清楚。
 */
const props = defineProps<{
  group?: DutyGroup
  members: DutyMember[]
  dateLabel: string
  weekdayLabel: string
  weekendSkipped: boolean
  needsSetup: boolean
}>()

const emit = defineEmits<{
  create: []
}>()

const entered = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    entered.value = true
  })
})

const hasGroup = () => Boolean(props.group)
</script>

<template>
  <div class="duty-hero" :class="{ 'is-entered': entered }">
    <template v-if="hasGroup()">
      <div class="hero-main">
        <div class="hero-date-row">
          <span class="hero-date">{{ dateLabel }}</span>
          <AppBadge variant="primary" size="sm">今日值日</AppBadge>
        </div>
        <h2 class="hero-group">{{ group?.name }}</h2>
        <ul v-if="members.length" class="hero-members">
          <li v-for="member in members" :key="member.id" class="hero-member">
            {{ member.name }}
            <span v-if="!member.active" class="member-gone">已不在档案</span>
          </li>
        </ul>
        <p v-else class="hero-empty-hint">这个组还没有组员，去下方「值日组」里加人。</p>
      </div>
      <span class="hero-decor" aria-hidden="true"
        ><Paintbrush :size="44" :stroke-width="1.6"
      /></span>
    </template>

    <EmptyState
      v-else-if="needsSetup"
      :icon="CalendarDays"
      title="还没设置轮换起点"
      description="在下方「轮换设置」里选好起点日期和起点组，排班就会自动排开。"
    />

    <EmptyState
      v-else-if="weekendSkipped"
      :icon="Moon"
      title="今天不值日"
      description="当前设置为周末不排值日，周一继续轮到下一组。"
    />

    <EmptyState
      v-else
      :icon="Paintbrush"
      title="还没有值日组"
      description="值日组就是轮换的单位：建好组、把同学分进去，轮换会自动按天推进。"
    >
      <AppButton size="sm" @click="emit('create')">新建值日组</AppButton>
    </EmptyState>
  </div>
</template>

<style scoped>
.duty-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: 180px;
  padding: var(--spacing-lg) var(--spacing-xl);
  border-radius: var(--radius-xl);
  background: linear-gradient(
    120deg,
    var(--color-primary-bg) 0%,
    rgba(111, 168, 220, 0.08) 55%,
    transparent 100%
  );
  border: 1px solid var(--color-border-light);
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.duty-hero.is-entered {
  opacity: 1;
  transform: translateY(0);
}

.hero-main {
  min-width: 0;
}

.hero-date-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.hero-date {
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

.hero-group {
  margin-top: var(--space-2);
  font-size: 30px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.02em;
  line-height: var(--leading-tight);
  color: var(--color-text-primary);
}

.hero-members {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
}

.hero-member {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  background: var(--glass-bg);
  border: 1px solid var(--color-border-light);
  font-size: var(--font-secondary);
  color: var(--color-text-primary);
}

.member-gone {
  font-size: var(--font-caption);
  color: var(--color-warning-strong);
}

.hero-empty-hint {
  margin-top: var(--space-3);
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.hero-decor {
  flex-shrink: 0;
  color: var(--color-primary);
  opacity: 0.35;
}

@media (max-width: 640px) {
  .duty-hero {
    flex-direction: column;
    align-items: flex-start;
    min-height: 0;
    padding: var(--spacing-card);
  }

  .hero-group {
    font-size: var(--text-xl);
  }

  .hero-decor {
    display: none;
  }
}
</style>
