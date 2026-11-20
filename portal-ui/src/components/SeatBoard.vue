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
              :aria-label="`第${row}排第${physicalCol}列 ${studentOf(seatAtSlot(row, physicalCol))?.name ?? '空位'}`"
              @click="seatAtSlot(row, physicalCol) && emit('select', seatAtSlot(row, physicalCol)!)"
            >
              <span>{{ studentOf(seatAtSlot(row, physicalCol))?.name.slice(0, 3) ?? '空' }}</span>
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
  padding: 0 2px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-main);
  line-height: 1.1;
  transition:
    background 150ms ease,
    border-color 150ms ease;
}

.seat span {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: calc(var(--seat-size) * 0.25);
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

.seat-board.is-fullscreen {
  --seat-size: clamp(26px, 7.2vh, 44px);
  --aisle: clamp(10px, 2.5vw, 26px);
  --row-gap: clamp(4px, 0.9vh, 9px);
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
