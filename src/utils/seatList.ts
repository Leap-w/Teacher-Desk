/**
 * 座位「行列列表」的导出格式。
 *
 * 与座位图导出（`utils/seatTemplateXlsx.ts`）是两种东西：
 *   - 座位图是**给人看 / 打印**的版面，重新导入要靠隐藏数据表或版面识别；
 *   - 行列列表是**纯数据表**，四列「行 / 列 / 学号 / 姓名」，一行一个物理座位，
 *     导出后可以被座位导入弹窗原样读回。
 *
 * 所以这里始终导出**全部物理座位**（7 排 × 9 列 = 63 行），空座只填行列、学生两列留空；
 * 导入端把这种行识别为「空座」跳过，不报错也不清空现有座位。
 *
 * 本文件只做二维数组，不碰 xlsx / DOM / store——可以在 node 测试里直接跑。
 */
import { getSeatKey } from '@/utils/seat'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { ClassroomConfig } from '@/types/classroom'
import type { Seat } from '@/types/seat'
import type { Student } from '@/types'

/**
 * 行列列表的表头。**唯一字面量**：导出用它写第一行，导入用它识别列。
 * `services/seatImport.ts` 以 `SEAT_IMPORT_HEADERS` 的名字 re-export，两处永远同源。
 */
export const SEAT_LIST_HEADERS = ['行', '列', '学号', '姓名'] as const

/** 一行：物理坐标 + 学生身份（空座时后两项为空串） */
export type SeatListRow = [number, number, string, string]

/**
 * 当前座位 → 行列列表数据行（排优先：1排1列、1排2列……7排9列，共 rows × cols 行）。
 *
 * - **姓名写原始 `student.name`**，不写重名消歧后的「姓名（尾号）」：导入端按学号优先匹配，
 *   没有学号时才按姓名匹配；把显示后缀写回去会让姓名对不上学生档案。
 * - 空座、悬空 studentId（学生已删 / 名单里找不到）→ 学生两列留空。
 * - 固定空位正常没有学生，自然导出为空行；若该格确实有人（手工拖拽或列表导入可造成），
 *   照实导出——导出端的职责是把当前排法完整写出来，不能静默丢掉一个学生。
 */
export function buildSeatListRows(
  seats: readonly Pick<Seat, 'row' | 'col' | 'studentId'>[],
  students: readonly Pick<Student, 'id' | 'studentNo' | 'name'>[],
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): SeatListRow[] {
  const studentIdAtSeat = new Map<string, string>()
  for (const seat of seats) {
    if (!seat.studentId) continue
    studentIdAtSeat.set(getSeatKey(seat.row, seat.col), seat.studentId)
  }
  const studentById = new Map(students.map((student) => [student.id, student]))

  const rows: SeatListRow[] = []
  for (let row = 1; row <= config.rows; row += 1) {
    for (let col = 1; col <= config.cols; col += 1) {
      const studentId = studentIdAtSeat.get(getSeatKey(row, col))
      const student = studentId ? studentById.get(studentId) : undefined
      rows.push([row, col, student?.studentNo?.trim() ?? '', student?.name ?? ''])
    }
  }
  return rows
}
