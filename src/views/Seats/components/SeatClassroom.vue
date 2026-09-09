<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import { seatAccentOf, formatStudentDisplayName } from '@/utils/student'
import { seatIdOf, seatOrdinal } from '@/utils/seat'
import type { ClassroomConfig } from '@/types/classroom'
import type { Seat } from '@/types/seat'
import type { Student } from '@/types'
import SeatQuickCard from './SeatQuickCard.vue'

/** 判定“移动”与“点击”的指针位移阈值（px）：超过即视为拖拽 */
const DRAG_SLOP = 6
/** 长按弹出信息卡的时长（PC 按住不动 400ms，需求约定） */
const LONG_PRESS_MS = 400

interface Props {
  config: ClassroomConfig
  seats: Seat[]
  /** 学生查询表（id → Student）；已删除学生查不到时按空位展示 */
  students: Map<string, Student>
  /** 视角：老师（站在讲台面向全班）/ 学生（从座位望向讲台） */
  view: 'teacher' | 'student'
  /** 当前选中座位 id（切换视角时保持不变，仅改变排布顺序） */
  selectedId?: string
  /** “点击换座”模式的源座位 id（长按卡「开始换座」触发）；空 = 未在换座模式 */
  pickSourceId?: string
}

const props = withDefaults(defineProps<Props>(), {
  selectedId: undefined,
  pickSourceId: undefined,
})

const emit = defineEmits<{
  select: [seatId: string]
  /** 拖拽落下：from 已有学生 → to 为有效落点（已就座 = 交换 / 空位 = 移动） */
  change: [fromId: string, toId: string]
  quickDetail: [seatId: string]
  quickSwap: [seatId: string]
}>()

/** 排布单元：视角只改变这些单元的上下顺序，不重建座位数据 */
type RoomItem =
  | { key: string; kind: 'row'; row: number }
  | { key: string; kind: 'podium' }
  | { key: string; kind: 'door-front' }
  | { key: string; kind: 'door-back' }

/** 单排布局单元（判别联合）：过道与列块位置来自 config.blocks，不写死 */
type ResolvedRowUnit =
  { key: string; kind: 'block'; seats: Seat[] } | { key: string; kind: 'aisle' }

/**
 * 解析某排的渲染布局：按过道切分三个列块，座位即时从 seatsById 解析（复用同一批 Seat 引用）。
 * 每一排调一次；63 个座位全程只读引用，不重建数据。
 */
function rowLayout(row: number): ResolvedRowUnit[] {
  const layout: ResolvedRowUnit[] = []
  let offset = 0
  props.config.blocks.forEach((width, index) => {
    const seats: Seat[] = []
    for (let i = 0; i < width; i++) {
      const seat = seatsById.value.get(seatIdOf(row, offset + i + 1))
      if (seat) seats.push(seat)
    }
    layout.push({ key: `block-${index}`, kind: 'block', seats })
    offset += width
    if (index < props.config.blocks.length - 1)
      layout.push({ key: `aisle-${index}`, kind: 'aisle' })
  })
  return layout
}

/**
 * 双视角显示顺序（computed 生成，不复制座位）：
 * - 学生视角：讲台在顶，第 1 排紧随其后 … 第 7 排收底；
 * - 老师视角：后门（教室尾部）在顶，第 7 排 → 第 1 排，前门贴近讲台沉底。
 */
const roomItems = computed<RoomItem[]>(() => {
  const rows: RoomItem[] = []
  for (let row = 1; row <= props.config.rows; row++) {
    rows.push({ key: `row-${row}`, kind: 'row', row })
  }
  const podium: RoomItem = { key: 'podium', kind: 'podium' }
  const doorFront: RoomItem = { key: 'door-front', kind: 'door-front' }
  const doorBack: RoomItem = { key: 'door-back', kind: 'door-back' }
  if (props.view === 'teacher') return [doorBack, ...rows.reverse(), doorFront, podium]
  return [podium, doorFront, ...rows, doorBack]
})

/** 座位查表：同一批 63 个 Seat 引用，视角切换零数据变更 */
const seatsById = computed(() => new Map(props.seats.map((seat) => [seat.id, seat])))

function occupantOf(seat: Seat): Student | undefined {
  return seat.studentId ? props.students.get(seat.studentId) : undefined
}

function occupantChar(seat: Seat): string {
  return occupantOf(seat)?.name.charAt(0) ?? ''
}

function occupantName(seat: Seat): string {
  return occupantOf(seat)?.name ?? ''
}

function seatClass(seat: Seat): Record<string, boolean> {
  const student = occupantOf(seat)
  const accent = student ? seatAccentOf(student) : undefined
  return {
    'is-empty': !student,
    'is-selected': props.selectedId === seat.id,
    'is-pick-source': props.pickSourceId === seat.id,
    'is-drop-target': dropCandidate.value === seat.id,
    'is-drag-source': drag.value?.fromId === seat.id,
    'is-cadre': accent === 'cadre',
    'is-tall': accent === 'tall',
    'is-tag': accent === 'tag',
  }
}

function seatTitle(seat: Seat): string {
  const student = occupantOf(seat)
  if (!student) return '空位'
  const extra = [student.cadreRole, ...(student.tags ?? [])].filter(Boolean).join(' · ')
  return extra
    ? `${formatStudentDisplayName(student)} · ${extra}`
    : formatStudentDisplayName(student)
}

/* ========== Phase 3B：拖拽换座（Pointer Events，无第三方库） ========== */

/** 拖拽幽灵（显示在指针上方；drag 为 null 表示未在拖拽） */
const drag = ref<{ fromId: string; name: string; char: string; x: number; y: number } | null>(null)
/** 当前指针下的有效落点座位 id（用于高亮；无有效落点为 undefined） */
const dropCandidate = ref<string | undefined>(undefined)

/** 长按信息卡：锚点 + 座位；student 由 studentMap 即时解析（被删则自动收起） */
const quickSeat = ref<{ seatId: string; x: number; y: number } | undefined>(undefined)

const quickStudent = computed(() =>
  quickSeat.value ? props.students.get(quickSeat.value.seatId) : undefined,
)

/**
 * 一次手势的进行态（非响应式，仅指针回调内部使用）：
 * 按下 → （位移 ≤ DRAG_SLOP 时）计时长按 / 释放视为点击；位移超阈值则转为拖拽。
 */
let gesture:
  | {
      seatId: string
      x: number
      y: number
      timer: ReturnType<typeof setTimeout> | undefined
      longFired: boolean
    }
  | undefined

/** 手势被拖拽 / 长按消费后，抑制随后派发的 click（避免误触发选中） */
let suppressClick = false

/** 有效落点：与源不同座；目标为已就座座位（交换）或空位（移动）均可，落回原位自动排除 */
function isDropTarget(fromId: string, targetId: string): boolean {
  if (fromId === targetId) return false
  const target = seatsById.value.get(targetId)
  if (!target) return false
  return true
}

/** 指针坐标 → 其下座位 id（未命中任何座位返回 undefined） */
function seatIdAt(clientX: number, clientY: number): string | undefined {
  const element = document.elementFromPoint(clientX, clientY)
  const holder = element?.closest?.('[data-seat-id]') as HTMLElement | null
  return holder?.dataset.seatId
}

function clearGestureTimer() {
  if (gesture?.timer !== undefined) {
    clearTimeout(gesture.timer)
    gesture.timer = undefined
  }
}

function closeQuickCard() {
  quickSeat.value = undefined
}

function cancelGesture() {
  if (!gesture) return
  clearGestureTimer()
  gesture = undefined
  drag.value = null
  dropCandidate.value = undefined
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
}

function onSeatPointerDown(seat: Seat, event: PointerEvent) {
  if (gesture) return // 多点触控 / 手势进行中，忽略后续指针
  suppressClick = false
  gesture = {
    seatId: seat.id,
    x: event.clientX,
    y: event.clientY,
    timer: undefined,
    longFired: false,
  }
  // 长按（400ms 不动）：弹出信息卡（班主任模式）；仅已就座座位有意义
  if (occupantOf(seat)) {
    gesture.timer = setTimeout(() => {
      const current = gesture
      if (!current || drag.value) return
      current.longFired = true
      quickSeat.value = { seatId: current.seatId, x: current.x, y: current.y }
    }, LONG_PRESS_MS)
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
}

function onPointerMove(event: PointerEvent) {
  const current = gesture
  if (!current) return
  const dx = event.clientX - current.x
  const dy = event.clientY - current.y
  const moved = Math.hypot(dx, dy)
  if (!drag.value) {
    // 超过阈值即视为拖拽（长按计时随之取消，避免误弹信息卡）
    if (moved > DRAG_SLOP) {
      clearGestureTimer()
      const seat = seatsById.value.get(current.seatId)
      const student = seat ? occupantOf(seat) : undefined
      if (!seat || !student) {
        // 空位 / 数据异常：不进入拖拽，手势作废并抑制本次点击
        suppressClick = true
        cancelGesture()
        return
      }
      drag.value = {
        fromId: seat.id,
        name: student.name,
        char: student.name.charAt(0),
        x: event.clientX,
        y: event.clientY,
      }
      closeQuickCard()
    }
    return
  }
  // 拖拽中：跟随指针 + 高亮当前有效落点
  drag.value.x = event.clientX
  drag.value.y = event.clientY
  const targetId = seatIdAt(event.clientX, event.clientY)
  dropCandidate.value = targetId && isDropTarget(drag.value.fromId, targetId) ? targetId : undefined
}

function onPointerUp(event: PointerEvent) {
  const current = gesture
  if (!current) return
  if (drag.value) {
    const targetId = seatIdAt(event.clientX, event.clientY)
    const toId = targetId && isDropTarget(drag.value.fromId, targetId) ? targetId : undefined
    if (toId) emit('change', drag.value.fromId, toId)
    suppressClick = true // 拖拽后即使落回源座位也不触发点击选中
  } else if (current.longFired) {
    suppressClick = true // 长按已弹卡：本次释放不视为点击
  }
  cancelGesture()
}

function onPointerCancel() {
  cancelGesture()
}

function pick(seatId: string) {
  // 拖拽 / 长按消费后的残余 click 在此被吞掉一次；点击换座模式下由页面编排层判定语义
  if (suppressClick) {
    suppressClick = false
    return
  }
  emit('select', seatId)
}

onBeforeUnmount(() => {
  if (gesture) cancelGesture()
})

/* ========== 长按卡动作（转发给页面编排层） ========== */

function onQuickDetail(seatId: string) {
  closeQuickCard()
  emit('quickDetail', seatId)
}

function onQuickSwap(seatId: string) {
  closeQuickCard()
  emit('quickSwap', seatId)
}
</script>

<template>
  <div class="seat-classroom" :class="{ 'is-dragging': drag }">
    <div class="room-scroll">
      <div class="room">
        <span class="windows" aria-hidden="true">
          <i class="windows-bar"></i>
          <em class="windows-text">窗户</em>
        </span>

        <TransitionGroup tag="div" name="room-flip" class="room-flip">
          <div v-for="item in roomItems" :key="item.key" class="room-item">
            <div v-if="item.kind === 'podium'" class="podium">
              <span class="podium-name">讲台</span>
              <span class="podium-sub">前方中央</span>
            </div>

            <div v-else-if="item.kind === 'door-front'" class="doorline is-front">
              <span class="door">前门</span>
            </div>

            <div v-else-if="item.kind === 'door-back'" class="doorline is-back">
              <span class="door">后门</span>
            </div>

            <div v-else-if="item.kind === 'row' && item.row !== undefined" class="room-row">
              <span class="row-label">第 {{ item.row }} 排</span>
              <template v-for="unit in rowLayout(item.row)" :key="unit.key">
                <span v-if="unit.kind === 'aisle'" class="aisle" aria-hidden="true"></span>
                <span v-else class="seat-block">
                  <template v-for="seat in unit.seats" :key="seat.id">
                    <button
                      type="button"
                      class="seat"
                      :class="seatClass(seat)"
                      :data-seat-id="seat.id"
                      :title="seatTitle(seat)"
                      @click="pick(seat.id)"
                      @pointerdown="onSeatPointerDown(seat, $event)"
                    >
                      <template v-if="occupantOf(seat)">
                        <span class="seat-avatar" aria-hidden="true">{{ occupantChar(seat) }}</span>
                        <span class="seat-name">{{ occupantName(seat) }}</span>
                        <span class="seat-no"
                          >{{ seatOrdinal(seat.row, seat.col, config) }} 号</span
                        >
                      </template>
                      <span v-else class="seat-plus" aria-hidden="true">＋</span>
                    </button>
                  </template>
                </span>
              </template>
            </div>
          </div>
        </TransitionGroup>
      </div>
    </div>

    <!-- 拖拽幽灵：固定于指针上方，pointer-events 不拦截落点判定 -->
    <div v-if="drag" class="drag-ghost" :style="{ left: `${drag.x}px`, top: `${drag.y}px` }">
      <span class="drag-ghost-avatar" aria-hidden="true">{{ drag.char }}</span>
      <span class="drag-ghost-name">{{ drag.name }}</span>
    </div>

    <SeatQuickCard
      v-if="quickSeat && quickStudent"
      :seat-id="quickSeat.seatId"
      :anchor="{ x: quickSeat.x, y: quickSeat.y }"
      :student="quickStudent"
      @close="closeQuickCard"
      @detail="onQuickDetail"
      @swap="onQuickSwap"
    />

    <p class="room-note">
      第 {{ config.totalSeats }} 号座位（末排末尾）默认留空，自动就座不占此座，可手动拖入。
      拖动已就座学生可交换 / 移入空位；长按（约 0.4 秒）查看学生信息。
    </p>
  </div>
</template>

<style scoped>
.seat-classroom {
  padding: var(--space-4) var(--space-5) var(--space-3);
}

.room-scroll {
  overflow-x: auto;
}

.room {
  position: relative;
  width: fit-content;
  margin: 0 auto;
  padding: var(--space-4) var(--space-4);
}

/* 右墙窗户：细窗条 + 纵向文字（静态装饰，两视角都在右侧） */
.windows {
  position: absolute;
  top: 50%;
  right: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  transform: translateY(-50%);
}

.windows-bar {
  flex: 1;
  width: 3px;
  border-radius: 999px;
  background: var(--color-border-strong);
}

.windows-text {
  writing-mode: vertical-rl;
  font-style: normal;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

/* 翻转容器：单元重排时由 Vue TransitionGroup 的 move 过渡驱动（FLIP） */
.room-flip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}

.room-flip-move {
  transition: transform var(--duration-flip) var(--ease-standard);
}

.room-item {
  width: 100%;
}

/* 讲台 */
.podium {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 200px;
  height: 46px;
  margin: 0 auto;
  border: 1px dashed var(--color-primary);
  border-radius: var(--radius-md);
  background: var(--color-primary-soft);
}

.podium-name {
  font-size: var(--text-md);
  font-weight: 700;
  color: var(--color-primary-strong);
}

.podium-sub {
  margin-top: 1px;
  font-size: var(--text-xs);
  color: var(--color-primary);
}

/* 前 / 后门：零高单元（is-front / is-back）随排布顺序 FLIP 平移，门签挂在对应墙侧 */
.doorline {
  position: relative;
  height: 0;
  align-self: stretch;
}

.door {
  position: absolute;
  top: 0;
  padding: 2px 10px;
  border: 1px solid var(--color-border-strong);
  border-radius: 999px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  white-space: nowrap;
  transform: translateY(-50%);
}

/* 前门挂右墙（与窗户同侧），后门挂左墙 */
.doorline.is-front .door {
  right: 4px;
}

.doorline.is-back .door {
  left: 4px;
}

/* ---- 座位排 ---- */
.room-row {
  display: flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  margin: 0 auto;
}

.row-label {
  width: 52px;
  flex-shrink: 0;
  padding-right: var(--space-2);
  text-align: right;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.seat-block {
  display: inline-flex;
  gap: 6px;
}

.aisle {
  width: var(--space-3);
  flex-shrink: 0;
}

/* ---- 座位（窄列纵向布局：首字头像 / 姓名 / 座位号） ---- */
.seat {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: clamp(54px, 5.4vw, 62px);
  height: 70px;
  padding: 6px 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font: inherit;
  text-align: center;
  cursor: pointer;
  overflow: hidden;
  user-select: none; /* 防拖拽过程中选中文字产生原生拖影 */
  -webkit-user-select: none;
  touch-action: pan-y; /* 保留页面纵向滚动，拖拽方向判定在 pointermove 内完成 */
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    background var(--transition-fast),
    opacity var(--transition-fast);
}

.seat:hover {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-sm);
}

.seat:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.seat.is-selected {
  border-color: var(--color-primary);
  box-shadow: var(--ring-focus);
}

.seat.is-empty {
  background: var(--color-fill-disabled);
  border-style: dashed;
  cursor: default;
}

.seat-plus {
  font-size: var(--text-lg);
  font-weight: 300;
  color: var(--color-text-faint);
  line-height: 1;
  user-select: none;
}

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
  font-weight: 700;
}

.seat-name {
  width: 100%;
  font-size: var(--text-xs);
  font-weight: 500;
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
}

/* 强调标记（颜色一律来自 theme.css，见页面图例）：班委 = 顶条主色，高个 = 顶条琥珀，其他标签 = 角点 */
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

/* ---- Phase 3B 拖拽与换座模式反馈 ---- */
/* 拖拽源座位：压暗，弱化“学生已随指针离开” */
.seat.is-drag-source {
  opacity: 0.45;
  border-color: var(--color-primary);
}

/* 指针下的有效落点：已就座（将交换）与空位（将移入）同样高亮 */
.seat.is-drop-target {
  border-color: var(--color-primary-strong);
  box-shadow: var(--ring-focus);
}

.seat.is-drop-target.is-empty {
  border-style: solid;
}

/* 点击换座模式源座位（长按卡「开始换座」）：虚线框 + 选中环 */
.seat.is-pick-source {
  border-color: var(--color-primary-strong);
  outline: 2px dashed var(--color-primary);
  outline-offset: 2px;
  box-shadow: var(--ring-focus);
}

.seat-classroom.is-dragging .seat {
  cursor: grabbing;
}

/* 拖拽幽灵：浮于指针上方的小胶囊（头像 + 姓名），不参与命中测试 */
.drag-ghost {
  position: fixed;
  z-index: 910; /* 高于页面内容，低于信息卡（920）/ 弹窗（1000） */
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 4px;
  border: 1px solid var(--color-primary);
  border-radius: 999px;
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
  pointer-events: none;
  transform: translate(-50%, calc(-100% - 12px));
  max-width: 168px;
}

.drag-ghost-avatar {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-size: var(--text-sm);
  font-weight: 700;
}

.drag-ghost-name {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.room-note {
  margin-top: var(--space-3);
  text-align: center;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
</style>
