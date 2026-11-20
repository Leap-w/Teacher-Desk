/**
 * Display-only seat view mapping.
 *
 * Mirrors TeacherDesk `src/utils/seatView.ts` (v3.3.0+):
 * - physical row is unchanged in both views;
 * - student view mirrors columns only: col -> cols + 1 - col;
 * - teacher view renders rows 7..1 top-to-bottom with podium at the bottom;
 * - student view renders rows 1..7 top-to-bottom with podium at the top.
 *
 * No Seat object is copied, reordered or mutated here. Physical seat IDs stay r{row}c{col}.
 */
export type SeatView = 'teacher' | 'student'

export function seatIdOf(row: number, col: number): string {
  return `r${row}c${col}`
}

export function mirrorSeatPosition(
  row: number,
  col: number,
  cols: number,
): { row: number; col: number } {
  return { row, col: cols + 1 - col }
}

export function viewPositionOf(
  row: number,
  col: number,
  view: SeatView,
  cols: number,
): { row: number; col: number } {
  return view === 'student' ? mirrorSeatPosition(row, col, cols) : { row, col }
}

export function positionAtViewSlot(
  slotRow: number,
  slotCol: number,
  view: SeatView,
  cols: number,
): { row: number; col: number } {
  return view === 'student'
    ? mirrorSeatPosition(slotRow, slotCol, cols)
    : { row: slotRow, col: slotCol }
}

export function viewRowOrder(rows: number, view: SeatView): number[] {
  const ascending = Array.from({ length: rows }, (_, i) => i + 1)
  return view === 'teacher' ? ascending.reverse() : ascending
}

export function viewColOrder(view: SeatView, cols: number): number[] {
  const ascending = Array.from({ length: cols }, (_, i) => i + 1)
  return view === 'student' ? ascending.reverse() : ascending
}

/**
 * Column groups in display order. Each group contains display-slot column numbers;
 * resolve them with positionAtViewSlot() to get the physical seat.
 */
export function viewBlockGroups(view: SeatView, blocks: readonly number[]): number[][] {
  const cols = blocks.reduce((sum, size) => sum + size, 0)
  const order = viewColOrder(view, cols)
  const widths = view === 'teacher' ? [...blocks] : [...blocks].reverse()
  const groups: number[][] = []
  let offset = 0
  for (const width of widths) {
    groups.push(order.slice(offset, offset + width))
    offset += width
  }
  return groups
}
