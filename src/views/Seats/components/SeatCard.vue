<script setup lang="ts">
/**
 * SeatCard — 座位卡（V2.0.4-alpha · Phase UI-4B）：
 * Apple Classroom 风的统一座位块——上：首字头像 + 姓名；中：座位号；边缘：强调标记
 * （班委顶条 / 高个顶条 / 标签角点，颜色一律来自 theme.css）。
 * 纯展示组件：交互（点击 / 拖拽）由父级通过原生事件穿透绑定，data-seat-id 也由
 * 父级传入后落到根按钮（拖拽落点判定 `closest('[data-seat-id]')` 依赖它）。
 */
withDefaults(
  defineProps<{
    /** 姓名（空位为空） */
    name?: string
    /** 姓名首字（头像占位） */
    char?: string
    /** 座位号文案，如「12 号」 */
    ordinal: string
    /** 空位 */
    empty?: boolean
    /** 状态类（is-selected / is-flashing / is-changed / is-cadre…由父级 seatClass 计算） */
    classes?: Record<string, boolean>
    /** 原生 title（悬停信息） */
    title?: string
  }>(),
  {
    name: '',
    char: '',
    empty: false,
    classes: () => ({}),
    title: '',
  },
)
</script>

<template>
  <button type="button" class="seat" :class="classes" :title="title">
    <template v-if="!empty">
      <span class="seat-avatar" aria-hidden="true">{{ char }}</span>
      <span class="seat-name">{{ name }}</span>
      <span class="seat-no">{{ ordinal }}</span>
    </template>
    <template v-else>
      <svg
        class="seat-empty-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M7 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
        <path d="M7 17v2M17 17v2" />
      </svg>
      <span class="seat-empty-text">空</span>
    </template>
  </button>
</template>

<style scoped>
/* ---- 统一 Seat Card：固定尺寸，不长短不一 ---- */
.seat {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: clamp(56px, 5.6vw, 64px);
  height: 72px;
  padding: 6px 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  box-shadow: var(--shadow-xs);
  font: inherit;
  text-align: center;
  cursor: pointer;
  overflow: hidden;
  user-select: none; /* 防拖拽过程中选中文字产生原生拖影 */
  -webkit-user-select: none;
  touch-action: pan-y; /* 保留页面纵向滚动，拖拽方向判定在父级 pointermove 内完成 */
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    background var(--transition-fast),
    opacity var(--transition-fast),
    transform var(--transition-fast);
}

/* Hover：2px 微抬升 + 主色边框高亮 */
@media (hover: hover) {
  .seat:hover:not(.is-empty) {
    transform: translateY(-2px);
    border-color: var(--color-primary);
    box-shadow: var(--shadow-sm);
  }
}

.seat:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

/* 对比变化高亮 = 琥珀描边（先于选中态声明，选中环仍可覆盖） */
.seat.is-changed {
  border-color: var(--color-warning-strong);
  box-shadow: var(--ring-warning-soft);
}

/* 定位闪烁（3 次约 1.5s，父级定时清类以支持重放） */
.seat.is-flashing {
  animation: seat-flash 0.5s ease-in-out 3;
}

@keyframes seat-flash {
  0%,
  100% {
    border-color: var(--color-border);
    box-shadow: none;
  }

  45% {
    border-color: var(--color-warning-strong);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-warning) 55%, transparent);
  }
}

.seat.is-selected {
  border-color: var(--color-primary);
  box-shadow: var(--ring-focus);
}

/* ---- 空座：统一 Empty Seat（虚线 + 空座插画），不是普通空白 ---- */
.seat.is-empty {
  background: var(--color-bg-subtle);
  border-style: dashed;
  cursor: default;
}

.seat-empty-icon {
  width: 20px;
  height: 20px;
  color: var(--color-text-faint);
  opacity: 0.7;
}

.seat-empty-text {
  font-size: var(--font-caption);
  color: var(--color-text-faint);
  line-height: 1;
}

.seat.is-drop-target.is-empty {
  border-style: solid;
}

/* ---- 内容 ---- */
.seat-avatar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
}

.seat-name {
  width: 100%;
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seat-no {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  line-height: 1.2;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* ---- 强调标记：班委 = 顶条主色，高个 = 顶条琥珀，其他标签 = 角点 ---- */
.seat.is-cadre::before,
.seat.is-tall::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}

.seat.is-cadre::before {
  background: var(--color-primary-strong);
}

.seat.is-tall::before {
  background: var(--color-warning);
}

.seat.is-tag::after {
  content: '';
  position: absolute;
  top: 3px;
  right: 3px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-text-secondary);
}

/* ---- 拖拽 / 换座模式反馈（状态类由父级计算，样式归卡片） ---- */
/* 拖拽源：压暗 */
.seat.is-drag-source {
  opacity: 0.45;
  border-color: var(--color-primary);
  transform: none;
}

/* 有效落点：松石青边框 + Glow（突然交换被 FLIP / 状态提示取代，不闪跳） */
.seat.is-drop-target {
  border-color: var(--color-primary-strong);
  box-shadow:
    0 0 0 4px var(--color-primary-soft-strong),
    0 0 14px rgba(74, 140, 148, 0.35);
}

/* 点击换座模式源座位（长按卡「开始换座」）：虚线框 + 选中环 */
.seat.is-pick-source {
  border-color: var(--color-primary-strong);
  outline: 2px dashed var(--color-primary);
  outline-offset: 2px;
  box-shadow: var(--ring-focus);
}
</style>
