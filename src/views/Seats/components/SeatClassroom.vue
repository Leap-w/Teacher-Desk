<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import { seatAccentOf, formatStudentDisplayName } from '@/utils/student'
import { seatOrdinal } from '@/utils/seat'
import {
  doorSidesOf,
  viewColUnits,
  viewRoomItems,
  viewRowUnits,
  windowSideOf,
  VIEW_NOTES,
} from '@/utils/seatView'
import type { ColUnit } from '@/utils/seatView'
import type { RowUnit } from '@/utils/seatView'
import type { ClassroomConfig } from '@/types/classroom'
import type { Seat, SeatView } from '@/types/seat'
import type { Student } from '@/types'
import SeatCard from './SeatCard.vue'
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
  /** 视角：老师（讲台在下）/ 学生（讲台在上）。**排号与座位数据两视角一致**，只左右镜像 */
  view: SeatView
  /** 当前选中座位 id（切换视角时保持不变，仅改变排布顺序） */
  selectedId?: string
  /** “点击换座”模式的源座位 id（长按卡「开始换座」触发）；空 = 未在换座模式 */
  pickSourceId?: string
  /** 需闪烁定位的座位 id 集合（学生定位 / 约束检查定位用；约 3 次由 CSS 动画完成） */
  flashSeatIds?: Set<string>
  /** 方案对比变化高亮：座位上的学生 id 在此集合内 → 琥珀色描边（不覆盖强调标记） */
  changedStudentIds?: Set<string>
  /** 只读模式（方案对比查看中）：禁止拖拽 / 长按弹卡，普通点击选中保留 */
  interactive?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  selectedId: undefined,
  pickSourceId: undefined,
  flashSeatIds: undefined,
  changedStudentIds: undefined,
  interactive: true,
})

const emit = defineEmits<{
  select: [seatId: string]
  /** 拖拽落下：from 已有学生 → to 为有效落点（已就座 = 交换 / 空位 = 移动） */
  change: [fromId: string, toId: string]
  quickDetail: [seatId: string]
  quickSwap: [seatId: string]
  /** 信息卡「座位约束」：打开为当前学生添加约束的弹窗 */
  quickConstraint: [seatId: string]
}>()

/** 组件根节点（定位滚动 / 信息卡锚点换算用） */
const classroomRoot = ref<HTMLElement>()

/** 座位查表：同一批 63 个 Seat 引用，视角切换零数据变更、零重建 */
const seatsById = computed(() => new Map(props.seats.map((seat) => [seat.id, seat])))

/**
 * 双视角显示顺序（computed 生成，不复制座位）——**与导出图共用同一份实现**
 * （`utils/seatView.ts`，V1.1.2 Phase 1 起的唯一事实来源）：
 * - 老师视角：后门 → 列号 → 第 7 排 … 第 1 排 → 前门 → 讲台（讲台在下）；
 * - 学生视角：讲台 → 前门 → 列号 → 第 7 排 … 第 1 排 → 后门（**排序列不变**，只把讲台 / 门换到另一端）。
 */
const roomItems = computed(() => viewRoomItems(props.view, props.config))

/**
 * 解析某一**显示排**的渲染布局（列块 + 过道按视角排列）：
 * 座位即时从 seatsById 解析，63 个座位全程只读引用，不重建数据。
 */
function rowUnits(row: number): RowUnit[] {
  return viewRowUnits(row, props.view, props.config, seatsById.value)
}

/**
 * 顶部列号行的渲染布局（v3.2.0）：与座位行共用同一次列块切分，
 * 列号因此永远压在它所标的座位正上方、过道位置也逐列对齐。
 */
const colUnits = computed<ColUnit[]>(() => viewColUnits(props.view, props.config))

/** 门 / 窗挂哪面墙：老师视角取教室配置原值，学生视角换到另一面墙（v3.3.0：只有墙面对调，排号不变） */
const doorSides = computed(() => doorSidesOf(props.view, props.config))
const windowsSide = computed(() => windowSideOf(props.view, props.config))

/** 当前视角的一句话说明（图下提示，讲清切换后画面到底怎么变） */
const viewNote = computed(() => VIEW_NOTES[props.view])

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
    'is-flashing': props.flashSeatIds?.has(seat.id) ?? false,
    'is-changed': seat.studentId ? (props.changedStudentIds?.has(seat.studentId) ?? false) : false,
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
  if (!props.interactive) return // 只读模式（方案对比查看中）：拖拽 / 长按全部停用
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

function onQuickConstraint(seatId: string) {
  closeQuickCard()
  emit('quickConstraint', seatId)
}

/* ========== Phase 3C：对外暴露的定位能力（学生搜索 / 约束检查点击定位） ========== */

/** 取某座位在页面中的元素（用于滚动与卡锚点） */
function seatElement(seatId: string): HTMLElement | undefined {
  const holder = classroomRoot.value?.querySelector<HTMLElement>(`[data-seat-id="${seatId}"]`)
  return holder ?? undefined
}

/** 滚动到可见区域（跨 .room-scroll 与页面两级滚动），座位不存在返回 false */
function revealSeat(seatId: string): boolean {
  const element = seatElement(seatId)
  if (!element) return false
  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  return true
}

/** 以座位为中心弹出信息卡（搜索定位用）；只读模式 / 空位 / 缺座返回 false */
function openQuickCard(seatId: string): boolean {
  if (!props.interactive) return false
  const element = seatElement(seatId)
  const seat = seatsById.value.get(seatId)
  if (!element || !seat || !occupantOf(seat)) return false
  const rect = element.getBoundingClientRect()
  quickSeat.value = {
    seatId,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
  return true
}

defineExpose({ revealSeat, openQuickCard })
</script>

<template>
  <div ref="classroomRoot" class="seat-classroom" :class="{ 'is-dragging': drag }">
    <div class="room-scroll">
      <div class="room">
        <!-- 窗：整条灰色竖条（老师视角在右墙，学生视角换到左墙） -->
        <span class="windows" :class="`is-${windowsSide}`" aria-hidden="true">
          <em class="windows-text">窗</em>
        </span>

        <TransitionGroup tag="div" name="room-flip" class="room-flip">
          <div v-for="item in roomItems" :key="item.key" class="room-item">
            <div v-if="item.kind === 'podium'" class="podium">
              <span class="podium-name">讲台</span>
              <span class="podium-sub">前方中央</span>
            </div>

            <div
              v-else-if="item.kind === 'door-front'"
              class="doorline is-front"
              :class="`is-${doorSides.front}`"
            >
              <span class="door">前门</span>
            </div>

            <div
              v-else-if="item.kind === 'door-back'"
              class="doorline is-back"
              :class="`is-${doorSides.back}`"
            >
              <span class="door">后门</span>
            </div>

            <!--
              顶部列号行：老师视角 1 2 3 | 4 5 6 | 7 8 9、
              学生视角 9 8 7 | 6 5 4 | 3 2 1，与座位行逐列对齐。
              左侧留出与行号同宽的空位，列号才压在它所标的座位正上方。
            -->
            <div v-else-if="item.kind === 'cols'" class="room-row is-cols" aria-hidden="true">
              <span class="row-label"></span>
              <template v-for="unit in colUnits" :key="unit.key">
                <span v-if="unit.kind === 'aisle'" class="aisle"></span>
                <span v-else class="seat-block">
                  <span v-for="col in unit.cols" :key="col" class="col-no">{{ col }}</span>
                </span>
              </template>
            </div>

            <div v-else-if="item.kind === 'row' && item.row !== undefined" class="room-row">
              <span class="row-label">{{ item.row }}</span>
              <template v-for="unit in rowUnits(item.row)" :key="unit.key">
                <span v-if="unit.kind === 'aisle'" class="aisle" aria-hidden="true"></span>
                <span v-else class="seat-block">
                  <!--
                    UI-4B：座位块抽为 SeatCard 纯展示组件（统一样式 / Hover / 空座态）。
                    点击与拖拽处理仍在本组件：原生事件穿透 + data-seat-id 落到根按钮，
                    拖拽落点判定 `closest('[data-seat-id]')` 不受影响，Pointer 逻辑零改动。
                  -->
                  <SeatCard
                    v-for="seat in unit.seats"
                    :key="seat.id"
                    :data-seat-id="seat.id"
                    :title="seatTitle(seat)"
                    :empty="!occupantOf(seat)"
                    :name="occupantName(seat)"
                    :char="occupantChar(seat)"
                    :ordinal="`${seatOrdinal(seat.row, seat.col, config)} 号`"
                    :classes="seatClass(seat)"
                    @click="pick(seat.id)"
                    @pointerdown="onSeatPointerDown(seat, $event)"
                  />
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
      @constraint="onQuickConstraint"
    />

    <p class="room-note">{{ viewNote }}</p>
    <p class="room-note">
      第 {{ config.totalSeats }} 号座位（末排末尾）默认留空，自动就座不占此座，可手动拖入。
      拖动已就座学生可交换 / 移入空位；长按（约 0.4 秒）查看学生信息。
    </p>
  </div>
</template>

<style scoped>
/* v3.3.0：左右内边距收到 8px，宽度优先让给座位（这一层只是防座位贴到纸面边） */
.seat-classroom {
  padding: var(--space-4) var(--space-2) var(--space-3);
}

.room-scroll {
  overflow-x: auto;
}

.room {
  position: relative;
  /* v3.3.0：铺满可用宽度。此前是 `width: fit-content`——整间教室缩成
     「9 列 × 固定 64px」的一条，窗口再宽也只有 60% 被用上，两侧全空着。
     现在宽度由容器给，座位等分它（见 SeatCard 的 flex 说明）。 */
  width: 100%;
  margin: 0 auto;
  /* 左右各留出墙面装饰（窗户 / 门签）的位置：学生视角下窗户换到左墙，
     若不留白，纵向的「窗户」二字会压在第 N 排的排号上 */
  padding: var(--space-4) 24px;
}

/* 右墙 / 左墙的窗：整条灰色竖条 + 居中一个「窗」字（v3.2.0 参考图口径）。
   静态装饰，但挂哪面墙随视角对调——老师视角在右、学生视角在左。 */
.windows {
  position: absolute;
  top: var(--space-4);
  bottom: var(--space-4);
  width: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--color-fill-disabled);
}

.windows.is-right {
  right: 0;
}

.windows.is-left {
  left: 0;
}

.windows-text {
  writing-mode: vertical-rl;
  font-style: normal;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

/* 翻转容器：单元重排时由 Vue TransitionGroup 的 move 过渡驱动（FLIP）。
   180ms / ease-out——v3.3.0 后排队列不再重排，实际只有讲台与两个门签换端时「挪过去」。 */
.room-flip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}

.room-flip-move {
  transition: transform var(--duration-fast) var(--ease-out);
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
  /* 与中间那一区（3 个座位 + 两条块内间隙）等宽，视觉上「讲台对着中间一列」 */
  width: min(30%, 320px);
  min-width: 180px;
  height: 46px;
  margin: 0 auto;
  border: 1px dashed var(--color-primary);
  border-radius: var(--radius-md);
  background: var(--color-primary-soft);
}

.podium-name {
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-primary-strong);
}

.podium-sub {
  margin-top: 1px;
  font-size: var(--text-xs);
  color: var(--color-primary);
}

/* 前 / 后门：零高单元（is-front / is-back）随排布顺序 FLIP 平移，门签挂在对应墙侧。
   门签是**浅灰矩形标签**（v3.2.0 参考图口径），不是胶囊。 */
.doorline {
  position: relative;
  height: 0;
  align-self: stretch;
}

.door {
  position: absolute;
  top: 0;
  padding: 4px 14px;
  border-radius: var(--radius-sm);
  background: var(--color-fill-disabled);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  white-space: nowrap;
  transform: translateY(-50%);
}

/* 两个门同在教室「左墙」（配置 frontDoor/backDoor 同侧），学生视角镜像到右墙 */
.doorline.is-right .door {
  right: 0;
}

.doorline.is-left .door {
  left: 0;
}

/* ---- 座位排 ---- */
/*
  align-items: stretch 让过道条撑满整排高度——过道是「一条通道」，不是两个座位之间的空隙。
  v3.3.0：整行宽度 100%（原 `fit-content`），三个列块各占 1/3，块内座位再等分。
*/
.room-row {
  display: flex;
  align-items: stretch;
  justify-content: center;
  width: 100%;
}

/* 行号只写一位数，不需要 52px——腾出来的宽度全部给座位 */
.row-label {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  width: 28px;
  flex-shrink: 0;
  padding-right: var(--space-2);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-tertiary);
}

/*
  列块：三个块等分整行（`flex: 1 1 0`）。每排的结构都是 3/3/3，
  所以三个块等宽 ⇒ 跨排逐列对齐；块内座位同样等分，9 列因此整整齐齐。
  `min-width: 0` 是必须的：否则块的 min-content（3 个座位的地板宽）
  会把整行顶出容器，flex 再也压不下去。
*/
.seat-block {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 0;
  min-width: 0;
}

/* 过道：灰色竖条（参考图口径）。宽度与列号行的同名单元一致，两侧座位因此严格分块 */
.aisle {
  width: var(--space-3);
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--color-fill-disabled);
}

/* ---- 顶部列号行 ---- */
.room-row.is-cols {
  margin-bottom: calc(var(--space-1) * -1);
}

/*
  每个列号与一个座位**完全同宽**：座位现在由 flex 等分（SeatCard 里的
  `flex: 1 1 0`），列号就用同一套规则——同父容器、同 flex 参数、同 gap，
  分配结果必然逐列相同。写死一个 clamp 宽度就会随视口不同而慢慢错位，
  差一格就是「3 号下面坐着 4 号」这种最伤信任的 bug。
*/
.col-no {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0;
  min-width: 48px;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-tertiary);
}

/* UI-4B：座位样式已整体抽到 SeatCard.vue（统一尺寸 / Hover / 拖拽态 / 空座态） */
.seat-classroom.is-dragging :deep(.seat) {
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
  border-radius: var(--radius-full);
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
  pointer-events: none;
  /* 拖拽中放大 3%（UI-4B 动效规范） */
  transform: translate(-50%, calc(-100% - 12px)) scale(1.03);
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
  font-weight: var(--font-weight-semibold);
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
