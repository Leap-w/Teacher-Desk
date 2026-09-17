<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { AppButton } from '@/components/ui'
import { popLayer, pushLayer } from '@/components/ui/layers'
import { familyScopeLabel, formatStudentShortName } from '@/utils/student'
import type { Student } from '@/types'

/** 卡片预估尺寸（定位越界保护用；含「座位约束」整行按钮后高度增加） */
const CARD_WIDTH = 232
const CARD_HEIGHT = 292
const MARGIN = 12

interface Props {
  /** 卡片所属座位 id（由父级在长按 / 就座学生变化时决定展示与收起） */
  seatId: string
  /** 锚点坐标（长按处指针位置，client 系）；卡片默认落在锚点右下方，贴近视口边缘时自动翻转 */
  anchor: { x: number; y: number }
  student: Student
  /**
   * 姓名 → 同名人数（v3.3.1）。**必填**：卡片上的姓名走全站统一的重名规则，
   * 少传一份计数就会让「哪一个旦增卓玛」在这张卡上失焦，而这正是长按卡片要回答的问题。
   */
  nameCounts: ReadonlyMap<string, number>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  detail: [seatId: string]
  swap: [seatId: string]
  /** 为当前座位学生添加座位约束（双人型硬约束 / 单人型软规则） */
  constraint: [seatId: string]
}>()

const root = ref<HTMLElement>()

/** 卡片定位：优先锚点右下；空间不足时翻到上方 / 收进视口，避免溢出被裁切 */
const positionStyle = computed(() => {
  const { x, y } = props.anchor
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = Math.min(x + MARGIN, vw - CARD_WIDTH - MARGIN)
  left = Math.max(MARGIN, left)
  let top = y + MARGIN
  if (top + CARD_HEIGHT + MARGIN > vh) top = y - MARGIN - CARD_HEIGHT
  top = Math.max(MARGIN, top)
  return { left: `${left}px`, top: `${top}px` }
})

const scopeText = computed(() => familyScopeLabel(props.student.familyLocation) ?? '—')

/** 所在地文案：地区 · 县区（信息缺失显示 —） */
const locationText = computed(() => {
  const location = props.student.familyLocation
  const parts = [location?.prefecture, location?.county].filter((part): part is string =>
    Boolean(part),
  )
  return parts.length > 0 ? parts.join(' · ') : '—'
})

function close() {
  emit('close')
}

/** 点击卡片外部任意处（含其他座位）或按 Esc 收起 */
function onDocumentPointerDown(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) close()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

/**
 * 层级栈令牌（v3.4.0 补）。卡片开着时占一层，**不开滚动锁**——它只是张浮卡，
 * 页面该能滚（与弹窗不同）。
 *
 * 为什么必须占这一层：座位页的 Esc 链在捕获阶段先跑（见 index.vue 的说明），
 * 它靠 `isTopLayer` 判断「这次 Esc 该不该归我」。卡片不在栈里的话，卡片开着时
 * 那一步会认为「我是最上层」而**退出铺满**，紧接着卡片自己的 Esc 又把它收起——
 * 一次 Esc 关两样东西。占了层，语义就与弹窗一致了：谁在最上面谁关。
 */
const layerToken = Symbol('seat-quick-card')

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  document.addEventListener('keydown', onDocumentKeydown)
  pushLayer(layerToken)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  document.removeEventListener('keydown', onDocumentKeydown)
  popLayer(layerToken)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      class="quick-card"
      role="dialog"
      aria-label="座位学生信息卡"
      :style="positionStyle"
      @pointerdown.stop
    >
      <header class="quick-head">
        <h4 class="quick-name">{{ formatStudentShortName(student, nameCounts) }}</h4>
        <span v-if="student.cadreRole" class="quick-role">{{ student.cadreRole }}</span>
      </header>

      <dl class="quick-list">
        <div class="quick-item">
          <dt>学号</dt>
          <dd>{{ student.studentNo }}</dd>
        </div>
        <div class="quick-item">
          <dt>宿舍</dt>
          <dd>{{ student.dormitory || '—' }}</dd>
        </div>
        <div class="quick-item">
          <dt>班委</dt>
          <dd>{{ student.cadreRole || '—' }}</dd>
        </div>
        <div class="quick-item">
          <dt>标签</dt>
          <dd>{{ (student.tags ?? []).join('、') || '—' }}</dd>
        </div>
        <div class="quick-item">
          <dt>返家范围</dt>
          <dd>{{ scopeText }}</dd>
        </div>
        <div class="quick-item">
          <dt>所在地</dt>
          <dd>{{ locationText }}</dd>
        </div>
      </dl>

      <footer class="quick-actions">
        <div class="quick-actions-row">
          <AppButton size="sm" variant="ghost" @click="emit('detail', seatId)">查看详情</AppButton>
          <AppButton size="sm" @click="emit('swap', seatId)">开始换座</AppButton>
        </div>
        <button
          class="quick-constraint"
          type="button"
          title="添加座位约束（不能同桌 / 不能相邻 / 坐后排 / 坐前排 / 同区块）"
          @click="emit('constraint', seatId)"
        >
          ＋ 座位约束
        </button>
      </footer>
    </div>
  </Teleport>
</template>

<style scoped>
.quick-card {
  position: fixed;
  width: 232px;
  z-index: 920; /* 高于页面内容、低于弹窗（--z-modal: 1000）与通知层 */
  padding: var(--space-3);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  animation: quick-pop-in var(--duration-fast) var(--ease-standard);
}

@keyframes quick-pop-in {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(-4px);
  }
}

.quick-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.quick-name {
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-role {
  flex-shrink: 0;
  max-width: 96px;
  font-size: var(--text-xs);
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  border-radius: var(--radius-full);
  padding: 2px 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-list {
  display: grid;
  gap: var(--space-1);
  margin-top: var(--space-2);
}

.quick-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.quick-item dt {
  flex-shrink: 0;
  width: 52px;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.quick-item dd {
  font-size: var(--text-xs);
  color: var(--color-text);
  line-height: 1.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.quick-actions-row {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.quick-constraint {
  width: 100%;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  padding: 5px 0;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    color var(--transition-fast),
    background var(--transition-fast);
}

.quick-constraint:hover {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.quick-constraint:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}
</style>
