import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import {
  availableSeatOrdinals,
  buildSeatGrid,
  fixedEmptySeatId,
  fixedEmptySeatOrdinal,
  isFixedEmptySeat,
  isValidSeatPosition,
  seatIdOf,
  seatOrdinal,
  seatPositionLong,
  seatPositionShort,
} from '@/utils/seat'
import type { ClassroomConfig } from '@/types/classroom'
import type { Seat } from '@/types/seat'

/**
 * 顺序轮换（v3.7.4）——**确定性整体换座**，与「自动排座」完全独立的一路。
 *
 * ## 它不是什么
 *
 * 不是重新随机分配，也不是重新打乱名单：**学生名单、学生 id 一个都不动**，
 * 变的只是「谁坐在哪个座位」。同一条命令跑多少次，结果完全一样（纯函数、无随机、无时间）。
 *
 * ## 它是什么：把「右后方」做成 63 格的循环，再把固定空位从循环里摘掉
 *
 * 目标方向由需求给定：原第 1 排第 1 列 → 第 2 排第 2 列，第 1 排第 2 列 → 第 2 排第 3 列……
 * 即**每名学生向「后一排、右一列」移动一格**（+1 行、+1 列）。
 *
 * 教室是 7 排 × 9 列。**行、列的最大公约数是 1（gcd(7, 9) = 1）**，所以
 * 「(+1 行, +1 列) 各自回绕」这个平移，把 63 个格子串成**唯一一个 63 长的循环**：
 *
 *     (1,1) → (2,2) → (3,3) → … → (7,7) → (1,8) → (2,9) → (3,1) → … → (7,8) → (1,9) → (2,1) → (1,1)
 *
 * 沿这个循环往前挪一格，就是「整体向右后方移动」：教室边界自然回绕
 * （最后一排 → 第一排、最后一列 → 第一列），不需要任何特判。
 *
 * ## 固定空位（第 1 排第 9 列）：从循环里摘掉，前后接起来
 *
 * 固定空位**永久不许坐人**，而它在循环里正好是 `(7,8)` 的下一个 ——
 * 直接照搬循环会把 `(7,8)` 那名学生送进固定空位，破坏硬规则。
 *
 * 做法是把这个格子**从循环里摘除**：让它的前驱直接指向它的后继。
 *
 *     循环：  … → (7,8) → [(1,9)] → (2,1) → …
 *     摘除后：… → (7,8) ──────────→ (2,1) → …
 *
 * 也就是：
 *   - `(7,8)` 的学生改坐到 `(2,1)`（固定空位在循环里的后继）；
 *   - 其余 61 个可用座位**一律**沿循环走一步（+1 行 +1 列，含各自的回绕）；
 *   - `(1,9)` 既不在定义域、也不在值域 —— 它永远空着，也永远不会被人「顺路」占到。
 *
 * 摘除后仍然是一个**完整的 62 长循环**（`(1,1)` 出发走 62 步回到 `(1,1)`），
 * 所以映射是一一对应的：62 名学生 → 62 个可用座位，不重不漏。
 *
 * ## 为什么不是「行列分别取模」
 *
 * 「(+1,+1) 各自回绕」这个平移本身**就是**行列取模，但它作用在**63 格**上。
 * 需求里禁止的是**把它直接当答案**：那样 `(7,8)` 会落进固定空位。
 * 本模块的差别全在「摘除 + 拼接」这一步，其余 61 个座位与朴素平移完全一致。
 *
 * ## 衔接规则一览（优先级：固定空位 > 完整唯一 > 方向 > 确定性衔接）
 *
 * | 情形 | 目标 | 说明 |
 * |---|---|---|
 * | 一般座位（行 < 7 且列 < 9） | `(row+1, col+1)` | 目标方向，无特判 |
 * | 最后一列（列 = 9，行 < 7） | `(row+1, 1)` | 列回绕到第 1 列，行照常 +1 |
 * | 最后一排（行 = 7，列 ≠ 8） | `(1, col+1)` | 行回绕到第 1 排，列照常 +1 |
 * | 末排末列 `(7,9)` | `(1,1)` | 行列同时回绕 |
 * | 末排第 8 列 `(7,8)` | `(2,1)` | **唯一特例**：原目标 `(1,9)` 是固定空位 → 摘除拼接 |
 * | 固定空位 `(1,9)` | —— | 不参与（无学生、也不接收学生） |
 *
 * 「特例只有一个」是刻意的：特例越多越难验证，而这里的特例是**从循环结构里必然推出来的**
 * （固定空位的循环前驱只有一个），不是补丁。
 *
 * ## 输入脏数据怎么办
 *
 * 本模块**不猜、不兜底、不静默丢人**：就座人数不是 62、同一学生占两个座位、
 * 坐标越界，一律 `ok: false` 并给出可直接展示给教师的原因，由页面阻止「确认应用」。
 * 唯一的例外是「固定空位上坐着人」——那是既有数据在旧规则（末排尾座留空）下产生的，
 * 属于可确定修复的情形：把这个人挪到**唯一**的空位（62 人 / 62 可用座位 ⇒ 空位唯一），
 * 再整体轮换，并在结果里用 `repaired` 标记出来，页面上明说。
 */

/** 一步换座的方向：后一排、右一列 */
export const ROTATE_STEP = { row: 1, col: 1 } as const

/** 物理坐标（只在本模块内部流转，不对外暴露新类型） */
interface Position {
  row: number
  col: number
}

/** 座位号 → 物理坐标（行优先，1 起；`seatOrdinal` 的逆运算） */
function positionOfOrdinal(ordinal: number, config: ClassroomConfig): Position {
  return {
    row: Math.floor((ordinal - 1) / config.cols) + 1,
    col: ((ordinal - 1) % config.cols) + 1,
  }
}

/**
 * 循环平移一步：(+1 行, +1 列)，行 / 列各自回绕。
 * 只在「63 格全网格」上有意义——固定空位的摘除在 `rotationTargetOf` 里处理。
 */
function cycleNext(position: Position, config: ClassroomConfig): Position {
  return {
    row: (position.row % config.rows) + 1,
    col: (position.col % config.cols) + 1,
  }
}

/**
 * 某可用座位的轮换目标：循环下一步；若下一步是固定空位（只可能是 `(7,8)`），
 * 则改接固定空位在循环里的后继（`(1,9)` → `(2,1)`）。
 */
function rotationTargetOf(position: Position, config: ClassroomConfig): Position {
  const next = cycleNext(position, config)
  if (isFixedEmptySeat(next.row, next.col, config)) {
    // 固定空位的循环后继：从固定空位再走一步
    return cycleNext(config.fixedEmptySeat, config)
  }
  return next
}

/** 一个座位的轮换目标（按座位 id 查；供预览 / 测试与文档核对） */
export function rotationTargetOfSeat(
  row: number,
  col: number,
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): Position | undefined {
  if (!isValidSeatPosition(row, col, config)) return undefined
  if (isFixedEmptySeat(row, col, config)) return undefined
  return rotationTargetOf({ row, col }, config)
}

/**
 * 完整的轮换映射：**可用座位 id → 目标坐标**（62 条，固定空位不在其中）。
 * 确定性：同一份 config 永远得到同一张表。
 */
export function buildRotationMap(
  config: ClassroomConfig = DEFAULT_CLASSROOM_CONFIG,
): Map<string, Position> {
  const map = new Map<string, Position>()
  for (let row = 1; row <= config.rows; row++) {
    for (let col = 1; col <= config.cols; col++) {
      if (isFixedEmptySeat(row, col, config)) continue
      map.set(seatIdOf(row, col), rotationTargetOf({ row, col }, config))
    }
  }
  return map
}

/** 单条换座：某学生从哪个座位换到哪个座位（位置文案为短格式，如「2排3列」） */
export interface SeatRotationMove {
  studentId: string
  /** 源座位 id（如 `r1c1`） */
  from: string
  /** 目标座位 id */
  to: string
  /** 源位置短文案（如「1排1列」） */
  fromLabel: string
  /** 目标位置短文案 */
  toLabel: string
}

export type RotateSeatsResult =
  | {
      ok: true
      /** 轮换后的完整网格（恒 rows × cols 座；固定空位为空位） */
      seats: Seat[]
      /** 逐条换座记录（按源座位号升序，确定性） */
      moves: SeatRotationMove[]
      /** 实际换位的座位数（= 参与轮换的学生数） */
      movedCount: number
      /** 固定空位座位 id（界面标识用） */
      fixedEmptySeatId: string
      /**
       * 是否发生过「固定空位修正」：输入里固定空位上坐着人（旧规则遗留），
       * 已先把他挪到唯一空位再整体轮换。页面对此要明说，不要静默。
       */
      repaired: boolean
    }
  | {
      ok: false
      /** 面向用户的原因（页面直接展示，并禁止「确认应用」） */
      reason: string
    }

/**
 * 计算一次顺序轮换的结果（**纯函数**：不改动传入的 `seats`，也不读写 store）。
 *
 * 调用方拿到 `ok: true` 后才由页面把 `seats` 交给 store 落库；`ok: false` 时页面
 * 只展示 `reason`，「确认应用」保持禁用——这样「取消 / 校验失败」两条路径都不可能改动座位。
 */
export function rotateSeats(input: { seats: Seat[]; config?: ClassroomConfig }): RotateSeatsResult {
  const config = input.config ?? DEFAULT_CLASSROOM_CONFIG
  const expected = config.occupiedSeats

  /* ---- ① 收集当前就座情况（学生 → 座位），顺带查重与坐标合法性 ---- */
  const studentSeat = new Map<string, Seat>()
  for (const seat of input.seats) {
    if (!seat.studentId) continue
    if (!isValidSeatPosition(seat.row, seat.col, config)) {
      return {
        ok: false,
        reason: `座位 ${seat.id} 的行列坐标不在教室范围内，数据异常，已取消本次轮换`,
      }
    }
    const previous = studentSeat.get(seat.studentId)
    if (previous) {
      return {
        ok: false,
        reason: `同一名学生被排在多个座位上（${seatPositionLong(
          previous.row,
          previous.col,
        )} 与 ${seatPositionLong(seat.row, seat.col)}），数据异常，已取消本次轮换`,
      }
    }
    studentSeat.set(seat.studentId, seat)
  }

  /* ---- ② 人数必须与教室可用座位数一致：不一致就明说，不硬做 ---- */
  if (studentSeat.size !== expected) {
    return {
      ok: false,
      reason:
        `当前就座 ${studentSeat.size} 人，与教室可用座位 ${expected} 个（共 ${config.totalSeats} 座，` +
        `固定空位 ${seatPositionLong(config.fixedEmptySeat.row, config.fixedEmptySeat.col)} 除外）不一致，` +
        '已取消本次轮换。请先在「学生」里核对名单，或把座位补齐后再试。',
    }
  }

  /* ---- ③ 起始排布：可用座位号 → 学生；固定空位上若有人，先挪到唯一空位 ---- */
  const placement = new Map<number, string>()
  for (const [studentId, seat] of studentSeat) {
    if (isFixedEmptySeat(seat.row, seat.col, config)) continue
    placement.set(seatOrdinal(seat.row, seat.col, config), studentId)
  }

  // 旧规则（末排尾座留空）留下的排布里，固定空位上可能坐着人。这是**可确定修复**的情形：
  // 62 名学生 / 62 个可用座位 ⇒ 可用座位里恰好空着一个，把人挪过去即可，不需要教师做选择。
  const fixedOccupant = [...studentSeat.entries()].find(([, seat]) =>
    isFixedEmptySeat(seat.row, seat.col, config),
  )
  let repaired = false
  if (fixedOccupant) {
    const vacant = availableSeatOrdinals(config).find((ordinal) => !placement.has(ordinal))
    if (vacant === undefined) {
      return {
        ok: false,
        reason:
          `固定空位（${seatPositionLong(config.fixedEmptySeat.row, config.fixedEmptySeat.col)}）上坐着学生，` +
          '但可用座位里没有空位可以安置，已取消本次轮换',
      }
    }
    placement.set(vacant, fixedOccupant[0])
    repaired = true
  }

  /* ---- ④ 沿循环整体前移一步（固定空位已从循环中摘除） ---- */
  const map = buildRotationMap(config)
  const next = new Map<number, string>()
  for (const [ordinal, studentId] of placement) {
    const from = positionOfOrdinal(ordinal, config)
    const target = map.get(seatIdOf(from.row, from.col))
    if (!target) {
      return {
        ok: false,
        reason: `座位 ${seatIdOf(from.row, from.col)} 不在可用座位集合内，已取消本次轮换`,
      }
    }
    next.set(seatOrdinal(target.row, target.col, config), studentId)
  }

  /* ---- ⑤ 落地前的自检：宁可报错，也不产出一份「少了人」的座位表 ---- */
  if (next.has(fixedEmptySeatOrdinal(config))) {
    return { ok: false, reason: '内部校验失败：轮换结果占用了固定空位，已取消本次轮换' }
  }
  if (next.size !== placement.size) {
    return {
      ok: false,
      reason: `内部校验失败：轮换后学生数（${next.size}）与轮换前（${placement.size}）不一致，已取消本次轮换`,
    }
  }

  /* ---- ⑥ 产出（新建 Seat 对象，绝不复用 / 修改输入里的对象） ---- */
  const moves: SeatRotationMove[] = []
  for (const [ordinal, studentId] of placement) {
    const from = positionOfOrdinal(ordinal, config)
    const to = map.get(seatIdOf(from.row, from.col))
    if (!to) continue
    moves.push({
      studentId,
      from: seatIdOf(from.row, from.col),
      to: seatIdOf(to.row, to.col),
      fromLabel: seatPositionShort(from.row, from.col),
      toLabel: seatPositionShort(to.row, to.col),
    })
  }
  moves.sort((a, b) => seatOrdinalOfId(a.from, config) - seatOrdinalOfId(b.from, config))

  return {
    ok: true,
    seats: buildSeatGrid(next, config),
    moves,
    movedCount: placement.size,
    fixedEmptySeatId: fixedEmptySeatId(config),
    repaired,
  }
}

/** 座位 id（`r{row}c{col}`）→ 座位号；只在本模块内部用于稳定排序 */
function seatOrdinalOfId(seatId: string, config: ClassroomConfig): number {
  const matched = /^r(\d+)c(\d+)$/.exec(seatId)
  if (!matched) return Number.MAX_SAFE_INTEGER
  return seatOrdinal(Number(matched[1]), Number(matched[2]), config)
}
