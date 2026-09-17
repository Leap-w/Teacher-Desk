<script setup lang="ts">
import { computed } from 'vue'
import { Expand, Maximize2, Minimize2, Shrink, ZoomIn, ZoomOut } from 'lucide-vue-next'

import { AppButton } from '@/components/ui'

/**
 * SeatZoomBar — 座位图控制条（v3.4.0）：缩放 / 适应 / 铺满 / 浏览器全屏 + 左侧状态位。
 *
 * **纯展示组件**：一份状态都不持有，动作全部 emit 给页面编排层（`useSeatStage`）。
 * 与 SeatToolbar 同一个口径——判断逻辑不进组件，组件只负责「长什么样、点了说什么」。
 *
 * 它必须挂在 `SeatClassroom` 内部（页面经 `#controls` 插槽注入），**不能放进 SeatToolbar**：
 * 应用内全屏时座位图铺满整个视口，SeatToolbar 被整块盖住——按钮若在那边，
 * 进去就再也点不到「退出」，那是「进去了出不来」。
 *
 * 两个全屏按钮并存（需求方 2026-09-17 拍板「两个都做」），分工写在 title 里：
 * · 铺满 = 只铺满浏览器视口（不动窗口），任何设备都有；
 * · 全屏 = 浏览器全屏（连地址栏 / 标签栏一起让出，13 寸上多约 90px 高），
 *   设备不支持时（iPhone Safari 没有元素级全屏）**整个按钮不渲染**——
 *   渲染一个点了没反应的入口，正是 v3.3.1 修过的那类 P0 症状。
 *
 * 视觉权重低于座位图（UI-4B）：无卡片底、无阴影，只用一条细线与图分开（线在 SeatClassroom 里）。
 */
const props = defineProps<{
  /** 比例文案（如 `73%`） */
  scaleLabel: string
  /** 是否已到缩放下限 / 上限（按不动时按钮置灰，而不是按了没反应） */
  atMin: boolean
  atMax: boolean
  /** `fit` = 自动拟合；`manual` = 用户按过加减号 */
  mode: 'fit' | 'manual'
  /** 铺满视口（浏览器全屏与应用内全屏共用的视觉态） */
  fullscreen: boolean
  /** 是否正由浏览器全屏（按钮要显示「退出全屏」） */
  browserFullscreen: boolean
  /** 本设备是否支持浏览器全屏；false 时「全屏」按钮不渲染 */
  fullscreenSupported: boolean
  /**
   * 左侧状态位文案（换座中 / 对比只读），空则不占位。
   * 这是**应用内全屏时唯一可见的操作提示**——页面里的 hint 条会被铺满层盖住。
   */
  statusNote?: string
  /** 状态位是否为「进行中」（换座中）：用强调色，与普通提示区分 */
  statusActive?: boolean
}>()

const emit = defineEmits<{
  'zoom-in': []
  'zoom-out': []
  fit: []
  /** 应用内全屏（铺满）开关 */
  'toggle-overlay': []
  /** 浏览器全屏开关 */
  'toggle-fullscreen': []
}>()

/** 两个全屏按钮的图标随状态翻转（同一个按钮表示「进去」与「出来」） */
const overlayIcon = computed(() => (props.fullscreen ? Shrink : Expand))
const browserIcon = computed(() => (props.browserFullscreen ? Minimize2 : Maximize2))

const scaleHint = computed(() =>
  props.mode === 'manual' ? '手动缩放中（点「适应」回到自动适配）' : '已按可用空间自动适配',
)
</script>

<template>
  <div class="zoom-bar">
    <span v-if="statusNote" class="zoom-status" :class="{ 'is-active': statusActive }">
      <i class="zoom-status-dot" aria-hidden="true"></i>{{ statusNote }}
    </span>

    <div class="zoom-group" role="group" aria-label="座位图缩放">
      <AppButton
        size="sm"
        variant="ghost"
        :disabled="atMin"
        aria-label="缩小座位图"
        title="缩小（最小 50%）"
        @click="emit('zoom-out')"
      >
        <ZoomOut :size="15" :stroke-width="2" aria-hidden="true" />
      </AppButton>

      <span class="zoom-value" :title="scaleHint">{{ scaleLabel }}</span>

      <AppButton
        size="sm"
        variant="ghost"
        :disabled="atMax"
        aria-label="放大座位图"
        title="放大（最大 200%）"
        @click="emit('zoom-in')"
      >
        <ZoomIn :size="15" :stroke-width="2" aria-hidden="true" />
      </AppButton>

      <AppButton
        size="sm"
        variant="secondary"
        title="按可用空间自动适配，并把座位图滚到顶栏下方"
        @click="emit('fit')"
      >
        适应
      </AppButton>

      <span class="zoom-divider" aria-hidden="true"></span>

      <AppButton
        size="sm"
        variant="secondary"
        :title="fullscreen ? '退出铺满，回到页面滚动' : '只把座位图铺满浏览器视口（不改窗口）'"
        @click="emit('toggle-overlay')"
      >
        <component :is="overlayIcon" :size="14" :stroke-width="2" aria-hidden="true" />
        {{ fullscreen ? '退出铺满' : '铺满' }}
      </AppButton>

      <AppButton
        v-if="fullscreenSupported"
        size="sm"
        variant="primary"
        :title="
          browserFullscreen
            ? '退出浏览器全屏'
            : '浏览器全屏（隐藏地址栏与标签栏，13 寸屏上可多出约 90px 高度）'
        "
        @click="emit('toggle-fullscreen')"
      >
        <component :is="browserIcon" :size="14" :stroke-width="2" aria-hidden="true" />
        {{ browserFullscreen ? '退出全屏' : '全屏' }}
      </AppButton>
    </div>
  </div>
</template>

<style scoped>
.zoom-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  width: 100%;
  min-width: 0;
}

/* 状态位：换座中 / 对比只读。应用内全屏时它是唯一可见的提示，所以给足对比度 */
.zoom-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  white-space: nowrap;
}

.zoom-status.is-active {
  color: var(--color-primary-strong);
  font-weight: var(--font-weight-semibold);
}

.zoom-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.7;
}

.zoom-group {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto; /* 控件组靠右；状态位单独占左侧 */
}

/* 比例数字：等宽数字（缩放时宽度不跳），固定最小宽度让加减号不会左右晃 */
.zoom-value {
  min-width: 44px;
  text-align: center;
  font-size: var(--font-caption);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
  user-select: none;
}

.zoom-divider {
  width: 1px;
  height: 18px;
  background: var(--color-border-light);
}

/* 窄屏：控件组不再强行靠右（换行后靠右会看起来像错位） */
@media (max-width: 640px) {
  .zoom-group {
    margin-left: 0;
  }
}
</style>
