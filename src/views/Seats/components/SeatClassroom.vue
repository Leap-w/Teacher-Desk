<script setup lang="ts">
import { computed } from 'vue'

import { seatAccentOf, formatStudentDisplayName } from '@/utils/student'
import { seatIdOf, seatOrdinal } from '@/utils/seat'
import type { ClassroomConfig } from '@/types/classroom'
import type { Seat } from '@/types/seat'
import type { Student } from '@/types'

interface Props {
  config: ClassroomConfig
  seats: Seat[]
  /** 学生查询表（id → Student）；已删除学生查不到时按空位展示 */
  students: Map<string, Student>
  /** 视角：老师（站在讲台面向全班）/ 学生（从座位望向讲台） */
  view: 'teacher' | 'student'
  /** 当前选中座位 id（切换视角时保持不变，仅改变排布顺序） */
  selectedId?: string
}

const props = withDefaults(defineProps<Props>(), {
  selectedId: undefined,
})

const emit = defineEmits<{
  select: [seatId: string]
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

function pick(seatId: string) {
  emit('select', seatId)
}
</script>

<template>
  <div class="seat-classroom">
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
                      :title="seatTitle(seat)"
                      @click="pick(seat.id)"
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

    <p class="room-note">
      第 {{ config.totalSeats }} 号座位（末排末尾）固定留空；就座按学生档案座位号 1–{{
        config.occupiedSeats
      }}
      自动对应。
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
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    background var(--transition-fast);
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

.room-note {
  margin-top: var(--space-3);
  text-align: center;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
</style>
