<script setup lang="ts">
import { computed } from 'vue'

import { AppButton, AppModal } from '@/components/ui'
import { buildNameCounts, formatStudentShortName } from '@/utils/student'
import { isFixedEmptySeat, seatOrdinal, seatPositionLong } from '@/utils/seat'
import { rotateSeats } from '@/utils/seatRotate'
import { viewColUnits, viewRoomItems, viewRowUnits } from '@/utils/seatView'
import type { ColUnit, RowUnit } from '@/utils/seatView'
import type { ClassroomConfig } from '@/types/classroom'
import type { Seat, SeatView } from '@/types/seat'
import type { Student } from '@/types'

/**
 * 顺序轮换弹窗（v3.7.4）。
 *
 * **预览先于落库**：本组件打开时只调一次纯函数 `rotateSeats()`，把结果渲染成座位图给教师看；
 * 「确认应用」才把那份座位数组 emit 给页面落库，「取消」/ 关闭则什么都不做——
 * 因此「取消后当前座位必须保持不变」是**结构上**成立的，不靠额外的回滚代码。
 *
 * 校验失败（人数与可用座位不一致、同一学生占两个座位…）时：显示 `reason`，
 * 「确认应用」保持禁用，座位图不渲染——宁可不给入口，也不让教师以为已经换好了。
 *
 * 座位图**复用 `utils/seatView.ts` 的视角逻辑**（`viewRoomItems` / `viewRowUnits` /
 * `viewColUnits`），所以预览里的排序列、列块顺序、过道位置与页面上的座位图逐格一致；
 * 各画一套迟早出现「预览是学生视角、应用后是老师视角」这种对不上的事。
 *
 * 固定空位（第 1 排第 9 列）在预览里写「固定空位」并用实线底纹区分于普通空座的「空」，
 * 让教师在按下「确认应用」之前就看见它没有被占用、也没有被挪走。
 */
interface Props {
  modelValue: boolean
  /** 当前方案的座位（只读；本组件不改它） */
  seats: Seat[]
  /** 学生查询表（id → Student），用于显示姓名 */
  students: ReadonlyMap<string, Student>
  config: ClassroomConfig
  /** 与页面当前视角保持一致（预览不另立一套视角） */
  view: SeatView
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  /** 确认应用：把轮换后的座位数组交给页面落库 */
  apply: [seats: Seat[]]
}>()

/** 轮换结果（纯计算，不改任何数据） */
const rotation = computed(() => rotateSeats({ seats: props.seats, config: props.config }))

const previewSeats = computed<Seat[]>(() => (rotation.value.ok ? rotation.value.seats : []))

const seatsById = computed(() => new Map(previewSeats.value.map((seat) => [seat.id, seat])))

const nameCounts = computed(() => buildNameCounts([...props.students.values()]))

const viewLabel = computed(() => (props.view === 'teacher' ? '老师视角' : '学生视角'))

/** 固定空位文案（如「第1排第9列（9 号）」） */
const fixedEmptyLabel = computed(() => {
  const { row, col } = props.config.fixedEmptySeat
  return `${seatPositionLong(row, col)}（${seatOrdinal(row, col, props.config)} 号）`
})

/** 参与轮换的学生数（失败时退回「当前就座人数」，摘要里也说得通） */
const studentCount = computed(() =>
  rotation.value.ok
    ? rotation.value.movedCount
    : props.seats.filter((seat) => seat.studentId).length,
)

/** 渲染块：把视角单元（讲台 / 后门 / 列号行 / 座位行）摊平成模板里好写的一串 */
type PreviewBlock =
  | { key: string; kind: 'podium' }
  | { key: string; kind: 'door' }
  | { key: string; kind: 'cols'; units: ColUnit[] }
  | { key: string; kind: 'row'; row: number; units: RowUnit[] }

const previewBlocks = computed<PreviewBlock[]>(() =>
  viewRoomItems(props.view, props.config).map((item) => {
    if (item.kind === 'front-line') return { key: item.key, kind: 'podium' as const }
    if (item.kind === 'door-back') return { key: item.key, kind: 'door' as const }
    if (item.kind === 'cols') {
      return { key: item.key, kind: 'cols' as const, units: viewColUnits(props.view, props.config) }
    }
    return {
      key: item.key,
      kind: 'row' as const,
      row: item.row,
      units: viewRowUnits(item.row, props.view, props.config, seatsById.value),
    }
  }),
)

/** 该座位是否是固定空位（教室属性，与有没有人坐无关） */
function isFixed(seat: Seat): boolean {
  return isFixedEmptySeat(seat.row, seat.col, props.config)
}

/** 座位格上显示的姓名（与页面、导出图同一个重名规则） */
function nameOf(seat: Seat): string {
  const student = seat.studentId ? props.students.get(seat.studentId) : undefined
  return student ? formatStudentShortName(student, nameCounts.value) : ''
}

/** 格内文案：有人 → 姓名；固定空位 → 「固定空位」；其余空位 → 「空」 */
function cellText(seat: Seat): string {
  if (seat.studentId) return nameOf(seat)
  return isFixed(seat) ? '固定空位' : '空'
}

function cellTitle(seat: Seat): string {
  const position = seatPositionLong(seat.row, seat.col)
  if (seat.studentId) return `${position} · ${nameOf(seat)}`
  return isFixed(seat) ? `${position} · 固定空位（永久留空）` : `${position} · 空位`
}

function close() {
  emit('update:modelValue', false)
}

function confirm() {
  if (!rotation.value.ok) return
  emit('apply', previewSeats.value)
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal :model-value="modelValue" title="顺序轮换" width="900" @update:model-value="close">
    <p class="rotate-intro">
      按固定规律<strong>整体</strong>换座：每名学生向后一排、右一列移动一格，边界回绕到教室另一端。
      学生名单与分组一个都不动，也不随机抽取——同一份座位表算多少次，结果都一样。
    </p>

    <ul class="rotate-summary">
      <li>
        <span>参与轮换</span>
        <strong>{{ studentCount }} 人</strong>
      </li>
      <li>
        <span>可用座位</span>
        <strong>{{ config.occupiedSeats }} 个（共 {{ config.totalSeats }} 座）</strong>
      </li>
      <li>
        <span>固定空位</span>
        <strong>{{ fixedEmptyLabel }}</strong>
      </li>
    </ul>

    <div v-if="!rotation.ok" class="rotate-error" role="alert">
      <p class="rotate-error-title">本次不能轮换，已取消：</p>
      <p class="rotate-error-reason">{{ rotation.reason }}</p>
      <p class="rotate-error-tip">
        座位表没有被改动。「确认应用」已禁用——先按上面的提示把数据对齐，再回来试。
      </p>
    </div>

    <template v-else>
      <p v-if="rotation.repaired" class="rotate-warn">
        注意：固定空位（{{
          fixedEmptyLabel
        }}）上原本坐着学生（旧版把「末排尾座」当留空位时留下的排布）。
        本次已先把他挪到教室里唯一的空位，再整体轮换——请在下图确认他的新位置。
      </p>

      <p class="rotate-preview-title">轮换后预览 · {{ viewLabel }}</p>

      <div class="rotate-preview">
        <template v-for="block in previewBlocks" :key="block.key">
          <div v-if="block.kind === 'podium'" class="pv-line">
            <span class="pv-tag">讲台</span>
          </div>
          <div v-else-if="block.kind === 'door'" class="pv-line">
            <span class="pv-tag pv-tag--plain">后门</span>
          </div>
          <div v-else-if="block.kind === 'cols'" class="pv-row pv-row--cols" aria-hidden="true">
            <span class="pv-label"></span>
            <template v-for="unit in block.units" :key="unit.key">
              <span v-if="unit.kind === 'aisle'" class="pv-aisle"></span>
              <span v-else class="pv-block">
                <span v-for="col in unit.cols" :key="col" class="pv-colno">{{ col }}</span>
              </span>
            </template>
          </div>
          <div v-else class="pv-row">
            <span class="pv-label">{{ block.row }}</span>
            <template v-for="unit in block.units" :key="unit.key">
              <span v-if="unit.kind === 'aisle'" class="pv-aisle"></span>
              <span v-else class="pv-block">
                <span
                  v-for="seat in unit.seats"
                  :key="seat.id"
                  class="pv-seat"
                  :class="{
                    'is-empty': !seat.studentId,
                    'is-fixed': isFixed(seat) && !seat.studentId,
                  }"
                  :title="cellTitle(seat)"
                >
                  {{ cellText(seat) }}
                </span>
              </span>
            </template>
          </div>
        </template>
      </div>

      <p class="rotate-legend">
        <span class="pv-seat is-fixed is-legend">固定空位</span>
        = {{ fixedEmptyLabel }}，永久留空：轮换后仍留在原位，任何学生都不会被排到这里。
      </p>
      <p class="rotate-note">
        轮换只在当前方案上生效（不新建方案，方案名与约束不变）。确认后可在座位图上继续拖拽微调。
      </p>
    </template>

    <template #footer>
      <AppButton variant="ghost" @click="close">取消</AppButton>
      <AppButton :disabled="!rotation.ok" @click="confirm">确认应用</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.rotate-intro {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.rotate-summary {
  display: grid;
  gap: var(--space-1);
  list-style: none;
  margin: var(--space-4) 0;
}

.rotate-summary li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--color-fill-disabled);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.rotate-summary strong {
  flex-shrink: 0;
  color: var(--color-text);
}

.rotate-error {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-danger-soft);
}

.rotate-error-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-danger-strong);
}

.rotate-error-reason {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-danger-strong);
}

.rotate-error-tip {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.rotate-warn {
  margin-bottom: var(--space-3);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--color-warning-soft);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-warning-strong);
}

.rotate-preview-title {
  margin-bottom: var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
}

/* ---- 预览座位图：紧凑版，逐列与页面座位图对齐（同一套视角逻辑） ---- */
.rotate-preview {
  display: grid;
  gap: 3px;
  padding: var(--space-3);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
}

.pv-row,
.pv-line {
  display: flex;
  align-items: center;
  gap: 2px;
}

.pv-line {
  justify-content: center;
}

.pv-label {
  flex: 0 0 18px;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.pv-block {
  display: flex;
  flex: 1 1 0;
  gap: 2px;
  min-width: 0;
}

.pv-aisle {
  flex: 0 0 10px;
}

.pv-seat {
  display: flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 28px;
  padding: 3px 3px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font-size: 11px;
  line-height: 1.2;
  color: var(--color-text);
  text-align: center;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.pv-seat.is-empty {
  background: var(--color-bg-subtle);
  border-style: dashed;
  color: var(--color-text-faint);
}

/* 固定空位：实线 + 斜纹底，与普通空座的虚线区分开（与 SeatCard 同一套标记语言） */
.pv-seat.is-fixed {
  border-style: solid;
  border-color: var(--color-border-medium);
  color: var(--color-text-secondary);
  background: repeating-linear-gradient(
    45deg,
    var(--color-bg-subtle) 0,
    var(--color-bg-subtle) 5px,
    var(--color-fill-disabled) 5px,
    var(--color-fill-disabled) 10px
  );
}

.pv-colno {
  flex: 1 1 0;
  min-width: 0;
  font-size: 10px;
  color: var(--color-text-faint);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.pv-tag {
  padding: 2px 10px;
  border-radius: var(--radius-full);
  background: var(--color-fill-disabled);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.pv-tag--plain {
  color: var(--color-text-faint);
}

.rotate-legend {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

/* 图例里那一个小方块：不参与 flex 拉伸，固定尺寸 */
.pv-seat.is-legend {
  flex: 0 0 auto;
  min-height: 0;
  padding: 2px 8px;
  white-space: nowrap;
}

.rotate-note {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-text-faint);
}
</style>
