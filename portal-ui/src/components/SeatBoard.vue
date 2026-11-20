<script setup lang="ts">
import { computed } from 'vue'
import { portalData } from '../data'
import type { Seat } from '../data'
import { seatIdOf, viewBlockGroups, viewRowOrder, type SeatView } from '../utils/seatView'

const props = withDefaults(
  defineProps<{
    seats: readonly Seat[]
    blocks: readonly number[]
    rows: number
    view?: SeatView
    fullscreen?: boolean
    selectedKey?: string | null
  }>(),
  { view: 'teacher', fullscreen: false, selectedKey: null },
)

const emit = defineEmits<{ select: [seat: Seat] }>()

// Groups contain physical column numbers in display order, exactly like TeacherDesk's
// displayColumnGroups(): teacher 1..9, student 9..1. No second mirror here.
const rowNumbers = computed(() => viewRowOrder(props.rows, props.view))
const columnGroups = computed(() => viewBlockGroups(props.view, props.blocks))
const keyOf = (row: number, col: number) => `${row}-${col}`

function seatAtSlot(row: number, physicalCol: number): Seat | undefined {
  return props.seats.find((seat) => seat.row === row && seat.col === physicalCol)
}

function studentOf(seat: Seat | undefined) {
  return seat?.studentId ? portalData.studentById(seat.studentId) : undefined
}
</script>

<template>
  <div class="seat-board" :class="{ 'is-fullscreen': fullscreen }" :data-view="view">
    <div v-if="view === 'student'" class="podium">
      <span>{{ portalData.classroom.podiumLabel }}</span>
    </div>

    <div class="rows">
      <div v-for="row in rowNumbers" :key="row" class="row" :data-view-row="row">
        <span class="row-num">{{ row }}</span>
        <template v-for="(group, blockIndex) in columnGroups" :key="blockIndex">
          <div
            class="block"
            :style="{ gridTemplateColumns: `repeat(${group.length}, var(--seat-size))` }"
          >
            <button
              v-for="physicalCol in group"
              :key="physicalCol"
              type="button"
              class="seat"
              :class="{
                empty: !seatAtSlot(row, physicalCol)?.studentId,
                selected:
                  selectedKey && seatAtSlot(row, physicalCol)
                    ? selectedKey === keyOf(row, physicalCol)
                    : false,
              }"
              :data-seat-id="seatAtSlot(row, physicalCol) ? seatIdOf(row, physicalCol) : ''"
              :data-view-col="physicalCol"
              :title="studentOf(seatAtSlot(row, physicalCol))?.name ?? '空位'"
              :aria-label="`第${row}排第${physicalCol}列 ${studentOf(seatAtSlot(row, physicalCol))?.name ?? '空位'}`"
              @click="seatAtSlot(row, physicalCol) && emit('select', seatAtSlot(row, physicalCol)!)"
            >
              <!-- 姓名完整显示：允许按字换行，不截断、不缩写、不裁剪 -->
              <span class="seat-name">{{
                studentOf(seatAtSlot(row, physicalCol))?.name ?? '空'
              }}</span>
            </button>
          </div>
        </template>
      </div>
    </div>

    <div v-if="view === 'teacher'" class="podium bottom">
      <span>{{ portalData.classroom.podiumLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.seat-board {
  --seat-size: 46px;
  --aisle: 18px;
  --row-gap: 8px;
  width: max-content;
}

.podium {
  display: grid;
  place-items: center;
  width: 100%;
  height: 34px;
  margin-bottom: 12px;
  border-radius: var(--radius-sm);
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.12em;
}

.podium.bottom {
  margin-bottom: 0;
  margin-top: 12px;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: var(--row-gap);
}

.row {
  display: flex;
  align-items: center;
}

.row-num {
  flex: none;
  width: 20px;
  text-align: center;
  color: var(--text-sub);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.block {
  display: grid;
  gap: 4px;
}

.block + .block {
  margin-left: var(--aisle);
}

.seat {
  display: grid;
  place-items: center;
  width: var(--seat-size);
  height: var(--seat-size);
  padding: 2px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-main);
  line-height: 1.1;
  transition:
    background 150ms ease,
    border-color 150ms ease;
}

/* v3.9.1：姓名一律完整展示。按字节折行（中文一字一行也算完整），不省略、不裁剪。 */
.seat .seat-name {
  display: block;
  width: 100%;
  overflow-wrap: anywhere;
  word-break: break-all;
  white-space: normal;
  text-align: center;
  font-size: clamp(10px, calc(var(--seat-size) * 0.22), 13px);
  line-height: 1.15;
}

.seat.empty {
  border-style: dashed;
  background: transparent;
  color: var(--text-sub);
}

.seat.selected {
  border-color: var(--primary);
  background: var(--primary);
  color: var(--text-inverse);
}

/*
 * v3.9.1：全屏尺寸同时受视口宽与高约束。
 * 9 列 + 3 条过道 + 行号要放得下，7 排 + 讲台也要放得下；
 * 只按 vh 算会在窄屏溢出，被 .fs-stage 的 overflow:hidden 裁掉。
 */
.seat-board.is-fullscreen {
  --seat-size: clamp(30px, min(9.4vw, 9vh), 52px);
  --aisle: clamp(8px, 2vw, 22px);
  --row-gap: clamp(4px, 0.9vh, 10px);
}

/*
 * 横屏全屏的座格只有 30–40px，普通视图的 10px 字号下限会把 8–9 字姓名
 * 排成 4 行（约 46px）并溢出座格，被相邻一排遮住。
 * 全屏专用更小的字号 / 行高，按座格等比缩放：3 字一行、3 行排完 9 字，
 * 总高度仍小于座格内框。普通视图（桌面 / 平板 / 手机竖屏）保持原规格不变。
 */
.seat-board.is-fullscreen .seat .seat-name {
  font-size: clamp(7px, calc(var(--seat-size) * 0.23), 11px);
  line-height: 1.05;
}

.is-fullscreen .podium {
  height: clamp(24px, 5vh, 34px);
  margin-bottom: clamp(6px, 1.4vh, 12px);
  font-size: 11px;
}

.is-fullscreen .podium.bottom {
  margin-bottom: 0;
  margin-top: clamp(6px, 1.4vh, 12px);
}

.is-fullscreen .row-num {
  width: 18px;
  font-size: 10px;
}
</style>
