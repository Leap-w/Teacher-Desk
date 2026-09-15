<script setup lang="ts">
import { computed } from 'vue'

import { seatAccentOf } from '@/utils/student'
import { seatOrdinal } from '@/utils/seat'
import {
  doorSidesOf,
  viewColUnits,
  viewRoomItems,
  viewRowUnits,
  windowSideOf,
} from '@/utils/seatView'
import type { ColUnit, RoomItem, RowUnit } from '@/utils/seatView'
import type { ClassroomConfig } from '@/types/classroom'
import type { Seat, SeatView } from '@/types/seat'
import type { Student } from '@/types'

/**
 * 导出用静态座位图（纯展示、无交互，与页面 SeatClassroom 同一份 Seat 数据）。
 * 与页面差异：固定 A4 友好尺寸、无编辑控件 / 按钮 / 拖拽手势，供 html-to-image 快照。
 */

interface Props {
  config: ClassroomConfig
  seats: Seat[]
  /** 学生查询表（id → Student）：只读引用，不创建副本 */
  students: Map<string, Student>
  view: SeatView
  /** 大标题（默认「高一9班 座位表」，由页面按导出场景传入） */
  title: string
  /** 副标题行：当前方案名 · 导出日期 · 视角，自动拼接 */
  subtitle: string
  /** 需高亮（方案对比变化）的学生 id 集合；缺省不高亮 */
  changedStudentIds?: Set<string>
  /** 有高亮时追加在副标题下的说明行 */
  highlightNote?: string
}

const props = withDefaults(defineProps<Props>(), {
  changedStudentIds: undefined,
  highlightNote: undefined,
})

const seatsById = computed(() => new Map(props.seats.map((seat) => [seat.id, seat])))

function occupantOf(seat: Seat): Student | undefined {
  return seat.studentId ? props.students.get(seat.studentId) : undefined
}

type ExportItem = RoomItem

/**
 * 与页面**同一份**视角逻辑（`utils/seatView.ts`，V1.1.2 Phase 1；v3.2.0 定死纵向朝向）：
 * 老师视角讲台在下、第 1 排紧挨讲台；学生视角讲台在上、左右镜像（**排号与排序列不变**）。
 * 两处共用实现，导出与页面不可能再对不上。
 */
const items = computed<ExportItem[]>(() => viewRoomItems(props.view, props.config))

/** 顶部列号行（v3.2.0）：与页面同一份切分，导出图上的列号不会与座位错位 */
const colUnits = computed<ColUnit[]>(() => viewColUnits(props.view, props.config))

/** 门 / 窗挂哪面墙（学生视角镜像） */
const doorSides = computed(() => doorSidesOf(props.view, props.config))
const windowsSide = computed(() => windowSideOf(props.view, props.config))

function seatChanged(seat: Seat): boolean {
  return Boolean(seat.studentId && props.changedStudentIds?.has(seat.studentId))
}

/** 座位附加类：强调标记（同页面图例）+ 对比变化高亮 */
function exSeatClass(seat: Seat): Record<string, boolean> {
  const student = occupantOf(seat)
  const accent = student ? seatAccentOf(student) : undefined
  return {
    'is-empty': !student,
    'is-changed': seatChanged(seat),
    'is-cadre': accent === 'cadre',
    'is-tall': accent === 'tall',
    'is-tag': accent === 'tag',
  }
}

/** 某一显示排的列块与过道：按视角排列（与页面 seat 布局同源） */
function rowUnits(row: number): RowUnit[] {
  return viewRowUnits(row, props.view, props.config, seatsById.value)
}
</script>

<template>
  <div class="ex-graphic theme-force-light">
    <header class="ex-header">
      <h3 class="ex-title">{{ title }}</h3>
      <p class="ex-meta">{{ subtitle }}</p>
      <p v-if="highlightNote" class="ex-meta is-note">{{ highlightNote }}</p>
      <ul class="ex-legend" aria-label="图例">
        <li><i class="ex-swatch is-cadre"></i>班委</li>
        <li><i class="ex-swatch is-tall"></i>高个</li>
        <li><i class="ex-swatch is-tag"></i>其他标签</li>
      </ul>
    </header>

    <div class="ex-room">
      <span class="ex-windows" :class="`is-${windowsSide}`" aria-hidden="true"><em>窗</em></span>
      <template v-for="item in items" :key="item.key">
        <div v-if="item.kind === 'podium'" class="ex-podium">讲台</div>
        <div
          v-else-if="item.kind === 'door-front'"
          class="ex-door is-front"
          :class="`is-${doorSides.front}`"
        ></div>
        <div
          v-else-if="item.kind === 'door-back'"
          class="ex-door is-back"
          :class="`is-${doorSides.back}`"
        ></div>
        <!-- 顶部列号行（v3.2.0）：与座位行逐列对齐，左侧空出与行号同宽的位置 -->
        <div v-else-if="item.kind === 'cols'" class="ex-row is-cols">
          <span class="ex-row-label"></span>
          <template v-for="unit in colUnits" :key="unit.key">
            <span v-if="unit.kind === 'aisle'" class="ex-aisle"></span>
            <span v-else class="ex-block">
              <span v-for="col in unit.cols" :key="col" class="ex-col-no">{{ col }}</span>
            </span>
          </template>
        </div>
        <div v-else-if="item.kind === 'row' && item.row !== undefined" class="ex-row">
          <span class="ex-row-label">{{ item.row }}</span>
          <template v-for="unit in rowUnits(item.row)" :key="unit.key">
            <span v-if="unit.kind === 'aisle'" class="ex-aisle" aria-hidden="true"></span>
            <span v-else class="ex-block">
              <template v-for="seat in unit.seats" :key="seat.id">
                <div v-if="occupantOf(seat)" class="ex-seat" :class="exSeatClass(seat)">
                  <i class="ex-avatar" aria-hidden="true">{{ occupantOf(seat)?.name.charAt(0) }}</i>
                  <span class="ex-name">{{ occupantOf(seat)?.name }}</span>
                </div>
                <div v-else class="ex-seat is-empty">
                  <span class="ex-plus" aria-hidden="true">＋</span>
                  <span class="ex-ordinal">{{ seatOrdinal(seat.row, seat.col, config) }}</span>
                </div>
              </template>
            </span>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ex-graphic {
  width: fit-content;
  padding: 0 0 12px;
  background: var(--bg-card);
  color: var(--color-text);
}

/* ---- 标题区 ---- */
.ex-header {
  padding: 14px 0 10px;
  text-align: center;
  border-bottom: 2px solid var(--color-border);
}

.ex-title {
  margin: 0;
  font-size: 20px;
  font-weight: var(--font-weight-semibold);
  letter-spacing: 2px;
  color: var(--color-text);
}

.ex-meta {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}

.ex-meta.is-note {
  color: var(--color-warning-strong);
}

.ex-legend {
  display: flex;
  justify-content: center;
  gap: 14px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  font-size: 10px;
  color: var(--color-text-secondary);
}

.ex-legend li {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ex-swatch {
  display: inline-block;
  width: 16px;
  height: 2px;
  border-radius: var(--radius-full);
}

.ex-swatch.is-cadre {
  background: var(--color-primary-strong);
}

.ex-swatch.is-tall {
  background: var(--color-warning);
}

.ex-swatch.is-tag {
  width: 5px;
  height: 5px;
  background: var(--color-text-secondary);
}

/* ---- 教室区 ---- */
.ex-room {
  position: relative;
  width: fit-content;
  margin: 0 auto;
  /* 同页面：左右留出墙面装饰的位置（学生视角下窗户在左，避免压住排号） */
  padding: 10px 20px 6px;
}

/* 窗：整条灰色竖条 + 一个「窗」字（v3.2.0 参考图口径，与页面同款） */
.ex-windows {
  position: absolute;
  top: 10px;
  bottom: 6px;
  width: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-xs);
  background: var(--color-fill-disabled);
}

.ex-windows.is-right {
  right: 0;
}

.ex-windows.is-left {
  left: 0;
}

.ex-windows em {
  writing-mode: vertical-rl;
  font-style: normal;
  font-size: 9px;
  color: var(--color-text-faint);
}

.ex-podium {
  display: grid;
  place-items: center;
  width: 180px;
  height: 32px;
  margin: 0 auto;
  border: 1px dashed var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-primary-soft);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary-strong);
}

.ex-door {
  position: relative;
  height: 22px;
}

/* 门签：浅灰矩形标签（v3.2.0 参考图口径，与页面同款） */
.ex-door::after {
  content: '';
  position: absolute;
  top: 1px;
  padding: 2px 10px;
  border-radius: var(--radius-xs);
  background: var(--color-fill-disabled);
  font-size: 10px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

/* 门签文案与挂墙分开写：文案只看前 / 后，位置只看左 / 右（学生视角镜像） */
.ex-door.is-front::after {
  content: '前门';
}

.ex-door.is-back::after {
  content: '后门';
}

.ex-door.is-right::after {
  right: 2px;
}

.ex-door.is-left::after {
  left: 2px;
}

/* ---- 座位排 ---- */
/* align-items: stretch 让过道条撑满整排高度——过道是「一条通道」，不是两个座位之间的空隙 */
.ex-row {
  display: flex;
  align-items: stretch;
  justify-content: center;
  width: fit-content;
  margin: 0 auto;
  padding: 3px 0;
}

.ex-row-label {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  width: 44px;
  flex-shrink: 0;
  padding-right: 8px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-tertiary);
}

.ex-block {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* 过道：灰色竖条（v3.2.0 参考图口径，与页面同款） */
.ex-aisle {
  width: 8px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--color-fill-disabled);
}

/* 顶部列号行：每个列号占的宽度与一个座位一致（.ex-seat 的 50px） */
.ex-row.is-cols {
  align-items: center;
  padding-bottom: 0;
}

.ex-col-no {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 50px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-tertiary);
}

/* ---- 座位单元（窄列：头像 + 姓名） ---- */
.ex-seat {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: 50px;
  height: 52px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  background: var(--color-surface);
  overflow: hidden;
}

.ex-seat.is-empty {
  border-style: dashed;
  background: transparent;
}

.ex-seat.is-changed {
  border-color: var(--color-warning-strong);
  outline: 2px solid var(--color-warning);
  outline-offset: 1px;
}

.ex-avatar {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
}

.ex-name {
  max-width: 100%;
  padding: 0 2px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ex-plus {
  font-size: 14px;
  font-weight: 300;
  color: var(--color-text-faint);
  line-height: 1;
}

.ex-ordinal {
  font-size: 8px;
  color: var(--color-text-faint);
  line-height: 1;
}

/* 强调标记（同页面图例）：班委 = 顶条主色，高个 = 顶条琥珀 */
.ex-seat.is-cadre::before,
.ex-seat.is-tall::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
}

.ex-seat.is-cadre::before {
  background: var(--color-primary-strong);
}

.ex-seat.is-tall::before {
  background: var(--color-warning);
}

.ex-seat.is-cadre .ex-avatar {
  background: var(--color-primary);
  color: var(--color-text-inverse);
}
</style>
