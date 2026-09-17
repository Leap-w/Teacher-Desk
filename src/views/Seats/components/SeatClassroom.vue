<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import { buildNameCounts, formatStudentShortName, seatAccentOf } from '@/utils/student'
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
import type { SeatStageEls } from '@/composables/useSeatStage'
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
  /**
   * 视角：老师（讲台在下）/ 学生（讲台在上）。两个视角是同一间教室的正反两面，
   * **排号 / 座位号 / 座位数据都是物理号，不随视角改变**，只有画面顺序跟着讲台翻。
   */
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
  /**
   * v3.4.0 应用内全屏（铺满视口）：本组件挂 `.is-fullscreen`，
   * 由 `useSeatStage` 驱动。**只改这一层的外观，不改任何座位尺寸**——
   * 缩放仍由 `.room-stage` 的 transform 负责，两件事互不干扰。
   */
  fullscreen?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  selectedId: undefined,
  pickSourceId: undefined,
  flashSeatIds: undefined,
  changedStudentIds: undefined,
  interactive: true,
  fullscreen: false,
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

/*
  ========== v3.4.0：三层缩放结构的三个把手 ==========
  几何全部由 `useSeatStage` 命令式写内联样式（测量 → 算比例 → 写尺寸），
  本组件只负责把元素交出去。三层各管一件事，**不能合并**：

    · viewport（.room-viewport）—— 滚动/平移容器，也是**可用空间的量尺**
      （它的 clientWidth / clientHeight 就是「一屏」的边界）；
    · spacer（.room-spacer）—— 显式尺寸 = 自然尺寸 × k。缩放后视觉占位由它撑起，
      没有它 `.room-stage` 是绝对定位、父级高度会塌成 0，座位图下面的说明文字
      会跑到图上面去；`margin-inline: auto` 顺手负责「缩小时居中」。
    · stage（.room-stage）—— **唯一**被 transform 的一层。只包 `.room-scroll`，
      绝不包拖拽幽灵（见模板里的说明）。
*/
const viewportEl = ref<HTMLElement>()
const spacerEl = ref<HTMLElement>()
const stageEl = ref<HTMLElement>()
/** `.room-scroll`：量「内容真正需要多宽」的唯一出处（窄窗口下座位挤不下时用它兜底） */
const scrollEl = ref<HTMLElement>()

/** 座位查表：同一批 63 个 Seat 引用，视角切换零数据变更、零重建 */
const seatsById = computed(() => new Map(props.seats.map((seat) => [seat.id, seat])))

/**
 * 双视角显示顺序（computed 生成，不复制座位）——**与导出图共用同一份实现**
 * （`utils/seatView.ts`，V1.1.2 Phase 1 起的唯一事实来源）：
 * - 老师视角：后门 → 列号 → 第 7 排 … 第 1 排 → 前门 → 讲台（讲台在下，第 1 排紧挨它）；
 * - 学生视角：讲台 → 前门 → 列号 → 第 1 排 … 第 7 排 → 后门（讲台在上，第 1 排紧挨它）。
 *
 * 两个视角里**紧挨讲台的都是第 1 排**：排序列跟着讲台走，排号本身仍是物理号。
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

/**
 * 座位格上显示的姓名（v3.3.1）：走**全站唯一**的重名规则——不重名只有姓名，
 * 重名且填了身份证尾号显示「旦增卓玛（3287）」。座位图是这条规则用得最多的地方：
 * 教师站在讲台上要找的就是「哪一个旦增卓玛」，格子里不写尾号等于没写。
 * 计数取自 `props.students`（当前方案里的学生），与导出图同源。
 */
const nameCounts = computed(() => buildNameCounts([...props.students.values()]))

function occupantName(seat: Seat): string {
  const student = occupantOf(seat)
  return student ? formatStudentShortName(student, nameCounts.value) : ''
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
    // 女生底条（v3.3.2）：空座位与性别未填都落到 false——不臆造性别。
    // 与顶部条分列两端，班委 / 高个与女生两个标记可以同时成立（见 SeatCard 的说明）。
    'is-girl': student?.gender === 'female',
  }
}

function seatTitle(seat: Seat): string {
  const student = occupantOf(seat)
  if (!student) return '空位'
  const extra = [student.cadreRole, ...(student.tags ?? [])].filter(Boolean).join(' · ')
  const name = formatStudentShortName(student, nameCounts.value)
  return extra ? `${name} · ${extra}` : name
}

/* ========== Phase 3B：拖拽换座（Pointer Events，无第三方库） ========== */

/** 拖拽幽灵（显示在指针上方；drag 为 null 表示未在拖拽） */
const drag = ref<{ fromId: string; name: string; char: string; x: number; y: number } | null>(null)
/** 当前指针下的有效落点座位 id（用于高亮；无有效落点为 undefined） */
const dropCandidate = ref<string | undefined>(undefined)

/** 长按信息卡：锚点 + 座位；student 由 studentMap 即时解析（被删则自动收起） */
const quickSeat = ref<{ seatId: string; x: number; y: number } | undefined>(undefined)

/**
 * 长按信息卡的主人：**座位 id → 座位 → studentId → 学生**，两步都不能省。
 *
 * `props.students` 是 `Map<学生 id, Student>`（如 `s1`），而 `quickSeat.seatId` 是
 * 座位 id（如 `r2c6`）——拿座位 id 直接查永远得到 undefined，`v-if` 不成立，
 * **长按信息卡从不渲染**。更隐蔽的是：松手时 `longFired` 已置位、`suppressClick`
 * 把随后的 click 也吞掉了，所以表现是「长按毫无反应，连选中都没有」，
 * 而这条链路正是「点击换座」「座位约束」「查看详情」三个入口的唯一出处。
 *
 * 这个写法从 Phase 3B 就在（`cf5ef49`），2026-09-17 由真机探针（无头 Chrome 里
 * 派发真实的 pointerdown / pointerup）发现并改正——纯逻辑测试与字符串断言都碰不到它。
 */
const quickStudent = computed(() => {
  const seat = quickSeat.value ? seatsById.value.get(quickSeat.value.seatId) : undefined
  return seat ? occupantOf(seat) : undefined
})

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
        // 拖拽幽灵上的姓名也走重名规则（跟着手指走的那个名字和格子里必须一致）
        name: formatStudentShortName(student, nameCounts.value),
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

/**
 * v3.4.0：把三层结构的元素交给页面编排层（`useSeatStage` 的唯一入口）。
 *
 * **为什么是函数而不是三个 ref**：`useSeatStage` 只在需要测量时才要这些元素，
 * 而模板 ref 是 `ref` 对象——交出去等于把「什么时候有值」这件事散到两边。
 * 这里一次性打包，未挂载时回 `undefined`（调用方据此跳过，不要把半截结构喂给测量）。
 */
function stageEls(): SeatStageEls | undefined {
  const root = classroomRoot.value
  const viewport = viewportEl.value
  const spacer = spacerEl.value
  const stage = stageEl.value
  const scroll = scrollEl.value
  if (!root || !viewport || !spacer || !stage || !scroll) return undefined
  return { root, viewport, spacer, stage, scroll }
}

defineExpose({ revealSeat, openQuickCard, stageEls })
</script>

<template>
  <div
    ref="classroomRoot"
    class="seat-classroom"
    :class="{ 'is-dragging': drag, 'is-fullscreen': fullscreen }"
  >
    <!--
      ========== v3.4.0：控制条（页面经 #controls 插槽注入） ==========
      **必须在 `.seat-classroom` 里面**：应用内全屏时本组件 `position: fixed` 铺满视口，
      页面上的工具栏（SeatToolbar）会被整块盖住——缩放 / 全屏的按钮若放在外面，
      进全屏之后就再也点不到了，那是「进去了出不来」。
      没插槽时整条不渲染（导出图等场景复用本组件时不出现空条）。
    -->
    <header v-if="$slots.controls" class="stage-bar">
      <slot name="controls" />
    </header>

    <!--
      ========== v3.4.0：缩放三层结构（viewport → spacer → stage） ==========
      缩放走 `transform: scale`（唯一被变换的是 `.room-stage`），不缩放座位本身：
      座位尺寸（126 / 48 / 90）与 `.col-no` 的 `max-width` 是承重耦合，动一处坏一片。

      三条铁律，改这个结构前先读：

      ① **stage 只包 `.room-scroll`，绝不包拖拽幽灵。** `transform` 会给
         `position: fixed` 的后代重新认一个包含块——幽灵是按**指针的视口坐标**写
         `left/top` 的（`drag.x/y = event.clientX/clientY`），一旦变成 stage 的后代，
         它会被再叠一次左上角偏移，表现为「幽灵不跟手」，而座位落点判定用的是
         `elementFromPoint`（视口坐标，本来就正确）→ 拖对了位置却看着没对准。
      ② **只在一层做 transform。** 两层各缩一半，比例就不是 `useSeatStage` 算的那个数了，
         而且 `.col-no` 与座位列的逐列对齐会被两份舍入误差拆开。
      ③ **`.seat-classroom` / `.seats-page` 上不许出现 `transform` / `filter` /
         `backdrop-filter`。** 这三者同样会抢 `position: fixed` 的包含块，后果同 ①。
         （这也是 `.drag-ghost` 与本组件根之间必须保持「无变换祖先」的原因。）
    -->
    <div ref="viewportEl" class="room-viewport">
      <div ref="spacerEl" class="room-spacer">
        <div ref="stageEl" class="room-stage">
          <div ref="scrollEl" class="room-scroll">
            <div class="room">
              <!-- 窗：整条灰色竖条（老师视角在右墙，学生视角换到左墙） -->
              <span class="windows" :class="`is-${windowsSide}`" aria-hidden="true">
                <em class="windows-text">窗</em>
              </span>

              <TransitionGroup tag="div" name="room-flip" class="room-flip">
                <div v-for="item in roomItems" :key="item.key" class="room-item">
                  <!--
              讲台 + 前门（v3.3.1）：**同一水平线**——前门贴墙、讲台居中。
              此前前门是独立的零高单元、标签骑在两块之间，正好压住第 1 排。
            -->
                  <div
                    v-if="item.kind === 'front-line'"
                    class="front-line"
                    :class="`is-${doorSides.front}`"
                  >
                    <span class="door">前门</span>
                    <div class="podium">
                      <span class="podium-name">讲台</span>
                      <span class="podium-sub">前方中央</span>
                    </div>
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
        </div>
      </div>
    </div>

    <!--
      拖拽幽灵：固定于指针上方，pointer-events 不拦截落点判定。
      **它必须是 `.seat-classroom` 的直接子节点、绝不能被挪进 `.room-stage`**
      ——理由见上面结构注释的 ①（transform 会抢 fixed 的包含块，幽灵就不跟手了）。
      下面这几行代码看着可以「顺手」挪进去，那正是本组件最容易坏的一处。
    -->
    <div v-if="drag" class="drag-ghost" :style="{ left: `${drag.x}px`, top: `${drag.y}px` }">
      <span class="drag-ghost-avatar" aria-hidden="true">{{ drag.char }}</span>
      <span class="drag-ghost-name">{{ drag.name }}</span>
    </div>

    <SeatQuickCard
      v-if="quickSeat && quickStudent"
      :seat-id="quickSeat.seatId"
      :anchor="{ x: quickSeat.x, y: quickSeat.y }"
      :student="quickStudent"
      :name-counts="nameCounts"
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
  /*
    v3.4.0：改成纵向 flex。控制条 / 视口 / 两条说明之间的间距统一由 gap 给——
    原先只有 `.room-note` 自带 `margin-top`，加上控制条与视口之后，
    「谁跟谁隔多少」靠各家 margin 拼会各说各话（间距还会随 flex 换行漂）。
  */
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-2) var(--space-3);
}

/* ========== v3.4.0：控制条（缩放 / 全屏；页面经 #controls 插槽注入） ========== */
.stage-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  padding-bottom: var(--space-2);
  /* 视觉权重低于座位图（UI-4B）：无卡片底、无阴影，只用一条细线与图分开 */
  border-bottom: 1px solid var(--color-border-light);
}

/* ========== v3.4.0：缩放三层结构（viewport → spacer → stage） ========== */

/*
  滚动 / 平移容器，同时也是「一屏」的量尺：它的 clientWidth / clientHeight
  就是 `useSeatStage` 算比例时的可用空间。两种模式共用它，只有高度来源不同——
  常规模式是内容高（图随页面滚），全屏模式由下面的 `flex: 1` 撑满。
*/
.room-viewport {
  overflow: auto;
  /*
    **flex 子项默认 `min-height: auto`，不写这条全屏时地图滚不动**：
    内容撑到 847px 高时容器不肯低于内容，于是它顶破视口、页面又已经锁了滚动——
    「一屏装不下又滚不了」是最坏的一种。写法上 `min-height: 0` 是必须的，
    只在全屏（flex:1）下生效，常规模式下它对自动高的块级盒子没有影响。
  */
  min-height: 0;
  /*
    点「适应」时把座位图滚到顶栏（fixed，--nav-height 72）下面。
    没有这条 `scroll-margin-top`，`scrollIntoView({block:'start'})` 会把图滚到
    顶栏底下被盖住——一屏装下了，可最上面那排看不见。
    数值口径与 utils/seatStage.ts 的 SEAT_STAGE_TOP_RESERVE 一致（72 + 8 呼吸）。
  */
  scroll-margin-top: 80px;
}

/*
  缩放后的视觉占位：宽高由 `useSeatStage` 写成内联样式（自然尺寸 × k）。
  没有它，绝对定位的 `.room-stage` 不会给父级任何高度——下面的说明文字会跑到图上。
*/
.room-spacer {
  /* 给绝对定位的 `.room-stage` 当包含块 */
  position: relative;
  /*
    居中在**这里**做，不靠 `transform-origin`：origin 必须取 `top left`，
    放大（k>1）时图才还能往右滚——取 `top center` 时左右各溢出一半，
    而 LTR 下**左溢是 ink overflow、滚不过去**，左半张图永远看不到。
  */
  margin-inline: auto;
}

/* 唯一被施加 transform 的一层（为什么只能有一层，见模板里的三条铁律） */
.room-stage {
  /*
    **这里刻意不写 `position`**：首帧（还没测量时）它就在文档流里、按自然尺寸渲染，
    也就是这一版之前的样子；挂载后的第一帧由 `useSeatStage` 改成 `absolute` 并施加
    `scale`。若在这里就写 `absolute`，首帧会因为没有显式宽度而塌成 0 宽——
    图会先「消失」一下再出现。测量逻辑正是靠「先改回 static 量一次」拿到自然尺寸的。
  */
  top: 0;
  left: 0;
  transform-origin: top left;
}

.room-scroll {
  /*
    v3.4.0 起它基本不再自己横向滚动：`.room-stage` 的宽度恒等于自然宽，
    横向滚动交给外面的 `.room-viewport`（只有一条横向滚动条，不会两条打架）。
    保留本条是兜底——万一将来宽度算错，图仍然能滚着看全，而不是被剪掉。
  */
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

/* 右墙 / 左墙的窗：**天蓝底 + 窗棂线 + 一个「窗」字**（2026-09-15 加强）。
   此前是 4% 灰底、灰字，与过道、门签一起糊在纸面上，一眼看不出哪是墙哪是座位。
   静态装饰，但挂哪面墙随视角对调——老师视角在右、学生视角在左。 */
.windows {
  position: absolute;
  top: var(--space-4);
  bottom: var(--space-4);
  width: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-sky);
  border-radius: var(--radius-sm);
  background-color: var(--color-sky-light);
  /* 每 13px 一道横线 = 窗棂，读起来是一排窗户而不是一根竖条 */
  background-image: repeating-linear-gradient(
    180deg,
    transparent 0 12px,
    rgba(111, 168, 220, 0.45) 12px 13px
  );
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
  font-weight: var(--font-weight-semibold);
  /* 天蓝在浅蓝底上不够读，字用中性深色——颜色靠底色和窗棂交代，字只负责说清是「窗」 */
  color: var(--color-text-secondary);
}

/* 翻转容器：单元重排时由 Vue TransitionGroup 的 move 过渡驱动（FLIP）。
   180ms / ease-out——2026-09-15 起排序列随讲台翻，切换视角时整间教室（含 7 排座位）
   一起「绕中心转过去」，不再是只有讲台与两个门签换端。 */
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

/*
  讲台 + 前门（v3.3.1）：同一行——前门贴墙、讲台居中。
  这一行的高度就是讲台的高度，门签靠 `top: 50%` 与它对齐（沿用 .door 的
  translateY(-50%)，所以门签中心正好落在这一行的中线上）。
*/
.front-line {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
}

.front-line .door {
  top: 50%;
}

.front-line.is-left .door {
  left: 0;
}

.front-line.is-right .door {
  right: 0;
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

/* 后门：零高单元（is-back）随排布顺序 FLIP 平移，门签骑在教室顶部那条分界线上（左上 / 右上）。
   前门自 v3.3.1 起不再走这套——它挪到 .front-line 里与讲台同行（见上）。
   门签仍是**矩形标签**（v3.2.0 参考图口径，不是胶囊），但 2026-09-15 起描边 + 着色，
   并在**贴墙那一侧**描一道粗边当门轴，与浅色座位卡片明确区分开。 */
.doorline {
  position: relative;
  height: 0;
  align-self: stretch;
}

.door {
  position: absolute;
  top: 0;
  padding: 4px 12px;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-primary-light);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-primary-strong);
  white-space: nowrap;
  transform: translateY(-50%);
  box-shadow: var(--shadow-xs);
}

/* 两个门同在教室「左墙」（配置 frontDoor/backDoor 同侧），学生视角镜像到右墙 */
.doorline.is-right .door {
  right: 0;
  /* 粗边朝墙：门轴贴在墙上那一侧 */
  border-right-width: 4px;
}

.doorline.is-left .door {
  left: 0;
  border-left-width: 4px;
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
  gap: 8px;
  flex: 1 1 0;
  min-width: 0;
}

/* 过道：**淡青底 + 一条虚线中线**（2026-09-15 加强）。
   宽度与列号行的同名单元一致，两侧座位因此严格分块；
   中线是虚线，与「座位之间那道窄缝」区分开——过道是一条能走人的通道。
   v3.3.1：12 → 24px（**加宽一倍**，需求点名的一条）。两条过道把 9 列切成
   3 组三人之后，组与组之间要「看得出是一条路」，而不是两排座位挨得紧一点。
   腾出来的宽度靠座位缩一号（见 SeatCard 的 max-width）——总宽不变。 */
.aisle {
  width: var(--space-6);
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background-color: var(--color-primary-bg);
  background-image: repeating-linear-gradient(
    180deg,
    var(--color-primary) 0 5px,
    transparent 5px 11px
  );
  background-size: 2px 100%;
  background-position: center;
  background-repeat: no-repeat;
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
  /* 必须与 SeatCard 里 .seat 的 max-width 相同（v3.3.1：126px）——见该文件说明 */
  max-width: 126px;
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
  /* v3.4.0：间距改由 `.seat-classroom` 的 flex gap 给；留 margin 会与 gap 叠加 */
  margin: 0;
  text-align: center;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

/*
  ========== v3.4.0：应用内全屏（铺满视口） ==========

  **浏览器全屏与应用内全屏共用这一个类**：前者把 `<html>` 整个交给浏览器全屏
  （见 `useSeatStage`：目标元素必须是 `document.documentElement`，取本组件根会让
  Teleport 到 body 的长按信息卡在全屏下根本不渲染），后者靠下面这组固定定位铺满视口。
  两者视觉一致，测试面因此收敛成一条。

  注意本类只改「这块放在哪」，**不改任何座位尺寸**——缩放仍归 `.room-stage` 的 transform。
  新增 `transform` / `filter` / `backdrop-filter` 到这里会抢掉 `.drag-ghost` 的包含块
  （幽灵是 `position: fixed` 且按视口坐标定位，见模板铁律 ①）。
*/
.seat-classroom.is-fullscreen {
  position: fixed;
  inset: 0;
  z-index: var(--z-fullscreen);
  /*
    底色必须用**不透明**的 `--color-bg`：全屏时后面就是页面本身（同一张座位图），
    用 `--glass-bg` 会透出自己那层残影。
  */
  background: var(--color-bg);
  /*
    安全区四边：座位页的浮层一律不接安全区（浮层在设计稿上是贴边的），
    全屏是**唯一例外**——它铺到屏幕物理边缘，不躲开刘海/圆角，
    左上角的「适应」「全屏」按钮就会被压住甚至点不到。
  */
  padding: calc(var(--space-4) + env(safe-area-inset-top))
    calc(var(--space-4) + env(safe-area-inset-right))
    calc(var(--space-3) + env(safe-area-inset-bottom))
    calc(var(--space-4) + env(safe-area-inset-left));
}

/* 全屏：视口吃掉控制条与说明之外的全部高度（min-height:0 见 .room-viewport 的说明） */
.seat-classroom.is-fullscreen .room-viewport {
  flex: 1;
  min-height: 0;
}
</style>
