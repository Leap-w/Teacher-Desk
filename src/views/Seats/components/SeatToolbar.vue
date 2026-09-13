<script setup lang="ts">
import SeatSchemeSelector from './SeatSchemeSelector.vue'
import type { SeatSchemeOption } from './SeatSchemeSelector.vue'
import SeatViewToggle from './SeatViewToggle.vue'

/**
 * SeatToolbar — 浮动工具栏（V2.0.4-alpha · Phase UI-4B）：
 * 左 = 方案切换器（当前方案 / 人数 / 编辑状态）；中 = 双视角 Segmented；
 * 右 = 动作插槽（导入 / 导出菜单 / 更多，由页面编排层注入，逻辑不进本组件）。
 * 玻璃拟态 + sticky 悬浮；视觉权重低于画布（UI-4B 产品规范：座位图优先于工具栏）。
 */
defineProps<{
  planName: string
  /** 就座人数文案，如「62/63」 */
  occupancy: string
  /** 未保存调整条数；>0 显示「编辑中」状态 */
  pendingCount: number
  view: 'teacher' | 'student'
  /** 视角说明文案（切换提示） */
  viewNote: string
  schemeOptions: SeatSchemeOption[]
  schemeId: string
  schemeDisabled?: boolean
}>()

const emit = defineEmits<{
  'update:view': [view: 'teacher' | 'student']
  'update:schemeId': [id: string]
  'scheme-create': []
}>()
</script>

<template>
  <div class="seat-toolbar">
    <div class="seat-toolbar__left">
      <SeatSchemeSelector
        :options="schemeOptions"
        :model-value="schemeId"
        :disabled="schemeDisabled"
        @update:model-value="emit('update:schemeId', $event)"
        @create="emit('scheme-create')"
      />
      <span class="seat-toolbar__meta">
        <span class="meta-occupancy">{{ occupancy }}</span>
        <span v-if="pendingCount > 0" class="meta-editing">
          编辑中 · {{ pendingCount }} 条未保存
        </span>
        <span v-else class="meta-saved">已保存</span>
      </span>
    </div>

    <div class="seat-toolbar__center">
      <SeatViewToggle
        :model-value="view"
        :disabled="schemeDisabled"
        @update:model-value="emit('update:view', $event)"
      />
      <span class="view-note">{{ viewNote }}</span>
    </div>

    <div class="seat-toolbar__right">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.seat-toolbar {
  position: sticky;
  top: calc(var(--nav-height) + var(--space-3));
  z-index: var(--z-sticky);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--glass-bg);
  backdrop-filter: blur(var(--nav-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--nav-blur)) saturate(150%);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

.seat-toolbar__left {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.seat-toolbar__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-caption);
  white-space: nowrap;
}

.meta-occupancy {
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.meta-editing {
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
}

.meta-saved {
  color: var(--color-text-tertiary);
}

.seat-toolbar__center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin: 0 auto;
}

.view-note {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  max-width: 340px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seat-toolbar__right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  flex-shrink: 1;
  justify-content: flex-end;
  margin-left: auto;
}

/* 平板：说明文字藏起，工具栏保持一行 */
@media (max-width: 1180px) {
  .view-note {
    display: none;
  }
}

/* 手机：两行布局（左信息+中切换 / 右动作换行），不压缩座位 */
@media (max-width: 900px) {
  .seat-toolbar {
    flex-wrap: wrap;
    row-gap: var(--space-2);
  }

  .seat-toolbar__center {
    order: 3;
    flex-basis: 100%;
    flex-direction: row;
    justify-content: center;
  }

  .seat-toolbar__right {
    margin-left: auto;
  }
}
</style>
