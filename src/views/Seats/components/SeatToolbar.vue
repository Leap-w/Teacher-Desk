<script setup lang="ts">
import SeatSchemeSelector from './SeatSchemeSelector.vue'
import type { SeatSchemeOption } from './SeatSchemeSelector.vue'
import SeatViewToggle from './SeatViewToggle.vue'

/**
 * SeatToolbar — 座位页页头（v3.3.0 重构为**三层**）。
 *
 * v3.2.0 之前这里是一条塞满按钮的浮动胶囊：方案 / 人数 / 状态 / 视角 / 搜索 /
 * 设置 / 保存 / 自动排座 / 方案对比 / 导入 / 约束 / 导出挤在一排，谁也看不出主次。
 * 现在按职责分层，一层只说一件事：
 *
 *   ① 我在看哪个方案、它存好了没            → 方案 + 人数（左） / 状态 + 视角（右）
 *   ② 我要找某个学生坐在哪                  → 搜索独占一整行（输入框要够长才好用）
 *   ③ 我要对这个班做什么                    → 工具（左） / 数据进出（右）
 *
 * **判断依据是「这一行解决什么问题」，不是「按钮有多宽」**——把搜索塞进按钮群里时，
 * 输入框被压到 160px，输一个三个字的名字就得左右看，这是本次重构最早要修的毛病。
 *
 * 三层之间用通栏细线分隔，整块贴在页面顶部（sticky）；视觉权重仍低于座位图
 * （UI-4B 规范：座位图优先于工具栏）。
 *
 * 业务逻辑一概不进本组件：所有动作由页面编排层通过插槽注入。
 */
defineProps<{
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
  /** v3.2.0：打开「方案管理」弹窗（右侧方案卡片撤下后的入口） */
  'scheme-manage': []
}>()
</script>

<template>
  <header class="seat-bar">
    <!-- ========== 第一层：方案 + 就座人数 + 保存状态 + 视角 ========== -->
    <div class="bar-row bar-row--head">
      <div class="bar-side">
        <SeatSchemeSelector
          :options="schemeOptions"
          :model-value="schemeId"
          :disabled="schemeDisabled"
          @update:model-value="emit('update:schemeId', $event)"
          @create="emit('scheme-create')"
          @manage="emit('scheme-manage')"
        />
        <span class="occupancy">{{ occupancy }}</span>
      </div>

      <div class="bar-side bar-side--end">
        <span class="state" :class="{ 'is-editing': pendingCount > 0 }">
          {{ pendingCount > 0 ? `编辑中 · ${pendingCount} 条未保存` : '已保存' }}
        </span>
        <!-- 页面注入的保存按钮（有未保存调整时才出现） -->
        <slot name="state" />
        <span class="view-note">{{ viewNote }}</span>
        <SeatViewToggle
          :model-value="view"
          :disabled="schemeDisabled"
          @update:model-value="emit('update:view', $event)"
        />
      </div>
    </div>

    <!-- ========== 第二层：学生定位（独占一行，输入框够长） ========== -->
    <div class="bar-row bar-row--search">
      <slot name="search" />
    </div>

    <!-- ========== 第三层：工具（左） / 数据进出（右） ========== -->
    <div class="bar-row bar-row--actions">
      <div class="bar-side">
        <slot name="tools" />
      </div>
      <div class="bar-side bar-side--end">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.seat-bar {
  position: sticky;
  top: calc(var(--nav-height) + var(--space-3));
  z-index: var(--z-sticky);
  margin-bottom: var(--space-4);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--glass-bg);
  backdrop-filter: blur(var(--nav-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--nav-blur)) saturate(150%);
  box-shadow: var(--shadow-sm);
  overflow: hidden; /* 让首尾两层贴住圆角 */
}

/* 层与层之间的通栏细线（最后一层没有线） */
.bar-row + .bar-row {
  border-top: 1px solid var(--color-border-light);
}

.bar-row {
  display: flex;
  align-items: center;
  gap: var(--space-3) var(--space-4);
  padding: var(--space-3) var(--space-4);
}

.bar-row--search {
  padding: var(--space-2) var(--space-4);
}

.bar-side {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

/* 靠右那一侧：占满剩余宽度并右对齐，两层的右缘因此对齐同一条线 */
.bar-side--end {
  margin-left: auto;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.occupancy {
  font-size: var(--font-caption);
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.state {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  white-space: nowrap;
}

.state.is-editing {
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
}

.view-note {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 平板：视角说明先让位（它只是解释，不该挤掉控件） */
@media (max-width: 1240px) {
  .view-note {
    display: none;
  }
}

/* 手机：每层各自换行，不横向压缩控件 */
@media (max-width: 900px) {
  .bar-row {
    flex-wrap: wrap;
  }

  .bar-side--end {
    margin-left: 0;
    justify-content: flex-start;
  }
}
</style>
