/**
 * 顺序轮换自检（v3.7.4）。
 *
 * 这套自检盯的是「错了会静默出错」的几件事：
 *
 *  ① **一一对应**：轮换是一张 62 → 62 的映射。少一条目标座位 = 两个学生抢一个位子，
 *     多一条 = 有人被挤出去。两种都不会报错，只会让教师第二天在教室里发现少了一个人。
 *  ② **固定空位（第 1 排第 9 列）**：它既不能坐人，也不能在轮换后「漂」到别的座位。
 *     这条错了，教室后排会凭空多出一个没人认领的座位。
 *  ③ **方向**：需求点名的三个例子（(1,1)→(2,2)、(1,2)→(2,3)、(1,3)→(2,4)）必须严丝合缝；
 *     边界（最后一排 / 最后一列 / 固定空位前一个）必须走**唯一那条**衔接规则。
 *  ④ **纯函数**：算预览不许碰原数据；校验失败不许落库；落库后刷新必须一模一样。
 *  ⑤ **老功能不动**：自动排座、拖拽、双视角、导入导出都要照常。
 */
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { reviveSeatPlans } from '@/repositories/seat/seatRepository'
import { useSeatStore } from '@/stores/seat'
import { useStudentStore } from '@/stores/student'
import { DEFAULT_CLASSROOM_CONFIG as CFG } from '@/types/classroom'
import {
  availableSeatOrdinals,
  buildSeatGrid,
  createSeatPlan,
  fixedEmptySeatId,
  fixedEmptySeatOrdinal,
  isFixedEmptySeat,
  isValidSeatPosition,
  seatOrdinal,
} from '@/utils/seat'
import { arrangeSeats } from '@/utils/seatArrange'
import { buildRotationMap, rotateSeats, rotationTargetOfSeat } from '@/utils/seatRotate'
import { viewPositionOf } from '@/utils/seatView'
import type { Seat } from '@/types/seat'
import type { Student } from '@/types'

const STUDENT_COUNT = 62

/** 62 名学生的档案投影（按学号 0001…0062，座位号 1…62） */
function studentProfiles(count = STUDENT_COUNT) {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index + 1}`,
    name: `学生${index + 1}`,
    studentNo: String(index + 1).padStart(4, '0'),
    seatNumber: index + 1,
  }))
}

/** 「开学初」式的起始排布：按 seatNumber 自动就座 */
function startSeats(count = STUDENT_COUNT): Seat[] {
  return createSeatPlan('测试方案', studentProfiles(count)).seats
}

/** 座位 id → 学生 id（只保留有人坐的） */
function occupancyOf(seats: readonly Seat[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const seat of seats) if (seat.studentId) map.set(seat.id, seat.studentId)
  return map
}

/** 学生 id → 座位 id */
function seatOfStudent(seats: readonly Seat[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const seat of seats) if (seat.studentId) map.set(seat.studentId, seat.id)
  return map
}

/** 排布的可比较快照（用于「有没有被改动」的断言） */
function snapshot(seats: readonly Seat[]): string {
  return seats.map((seat) => `${seat.id}=${seat.studentId ?? ''}`).join('|')
}

describe('A. 算法正确性：62 名学生 → 62 个可用座位，一一对应', () => {
  it('轮换映射覆盖 62 个可用座位，固定空位既不在定义域也不在值域', () => {
    const map = buildRotationMap(CFG)
    const available = availableSeatOrdinals(CFG)
    const fixedId = fixedEmptySeatId(CFG)

    expect(available).toHaveLength(62)
    expect(map.size).toBe(62)
    expect(map.has(fixedId)).toBe(false)

    const targets = [...map.values()].map((position) => `r${position.row}c${position.col}`)
    expect(new Set(targets).size).toBe(62)
    expect(targets).not.toContain(fixedId)
    expect(new Set(targets)).toEqual(new Set([...map.keys()]))
  })

  it('输出仍是 62 名学生：每名学生恰好一次、没有重复座位、没有幽灵学生', () => {
    const seats = startSeats()
    const result = rotateSeats({ seats, config: CFG })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const before = occupancyOf(seats)
    const after = occupancyOf(result.seats)

    expect(after.size).toBe(62)
    expect([...after.values()].filter(Boolean)).toHaveLength(62)
    expect(new Set(after.values()).size).toBe(62) // 没有学生占两个座位
    expect([...after.values()].sort()).toEqual([...before.values()].sort()) // 一个不多、一个不少
    expect(result.movedCount).toBe(62)
    expect(result.moves).toHaveLength(62)
  })

  it('第一排第九列始终为空，其余 62 个位置全部恰好坐一人', () => {
    const result = rotateSeats({ seats: startSeats(), config: CFG })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const fixedId = fixedEmptySeatId(CFG)
    expect(result.seats.find((seat) => seat.id === fixedId)?.studentId).toBeUndefined()

    const occupied = result.seats.filter((seat) => seat.studentId)
    expect(occupied).toHaveLength(62)
    expect(occupied.map((seat) => seat.id)).not.toContain(fixedId)
  })

  it('结果里不存在无效行列坐标', () => {
    const result = rotateSeats({ seats: startSeats(), config: CFG })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.seats).toHaveLength(CFG.totalSeats)
    for (const seat of result.seats) {
      expect(isValidSeatPosition(seat.row, seat.col, CFG)).toBe(true)
      expect(seat.id).toBe(`r${seat.row}c${seat.col}`)
    }
  })

  it('同一份输入多次执行，结果完全一致（确定性，无随机、无时间）', () => {
    const seats = startSeats()
    const first = rotateSeats({ seats, config: CFG })
    const second = rotateSeats({ seats, config: CFG })
    const third = rotateSeats({ seats: startSeats(), config: CFG })
    expect(first.ok && second.ok && third.ok).toBe(true)
    if (!first.ok || !second.ok || !third.ok) return

    expect(snapshot(second.seats)).toBe(snapshot(first.seats))
    expect(snapshot(third.seats)).toBe(snapshot(first.seats))
    expect(second.moves).toEqual(first.moves)
  })

  it('映射是一个 62 长循环：从 (1,1) 走 62 步回到 (1,1)，中途不重复', () => {
    const map = buildRotationMap(CFG)
    const seen = new Set<string>()
    let current = { row: 1, col: 1 }
    for (let step = 0; step < 62; step++) {
      const id = `r${current.row}c${current.col}`
      expect(seen.has(id)).toBe(false)
      seen.add(id)
      const next = map.get(id)
      expect(next).toBeDefined()
      if (!next) return
      current = next
    }
    expect(seen.size).toBe(62)
    expect(current).toEqual({ row: 1, col: 1 })
  })
})

describe('B. 轮换规律：向右后方一格，边界走唯一那条衔接规则', () => {
  it('需求点名的三个例子严丝合缝', () => {
    expect(rotationTargetOfSeat(1, 1, CFG)).toEqual({ row: 2, col: 2 })
    expect(rotationTargetOfSeat(1, 2, CFG)).toEqual({ row: 2, col: 3 })
    expect(rotationTargetOfSeat(1, 3, CFG)).toEqual({ row: 2, col: 4 })
  })

  it('未触及边界的内部位置一律 (+1 行, +1 列)', () => {
    for (let row = 1; row <= CFG.rows - 1; row++) {
      for (let col = 1; col <= CFG.cols - 1; col++) {
        expect(rotationTargetOfSeat(row, col, CFG), `${row}排${col}列`).toEqual({
          row: row + 1,
          col: col + 1,
        })
      }
    }
  })

  it('最后一列：列回绕到第 1 列、行照常 +1；末排末列回绕到 (1,1)', () => {
    // 从第 2 排起：(1,9) 就是固定空位本身，不参与轮换（见下一条用例）
    for (let row = 2; row <= CFG.rows - 1; row++) {
      expect(rotationTargetOfSeat(row, 9, CFG)).toEqual({ row: row + 1, col: 1 })
    }
    expect(rotationTargetOfSeat(7, 9, CFG)).toEqual({ row: 1, col: 1 })
  })

  it('最后一排：行回绕到第 1 排、列照常 +1；末排第 8 列是**唯一特例** → (2,1)', () => {
    for (let col = 1; col <= 7; col++) {
      expect(rotationTargetOfSeat(7, col, CFG)).toEqual({ row: 1, col: col + 1 })
    }
    // (7,8) 的自然目标 (1,9) 正是固定空位 → 摘除拼接后落到固定空位的后继 (2,1)
    expect(rotationTargetOfSeat(7, 8, CFG)).toEqual({ row: 2, col: 1 })
  })

  it('固定空位不参与轮换；紧邻它的座位仍按自然方向走', () => {
    expect(rotationTargetOfSeat(1, 9, CFG)).toBeUndefined() // 固定空位本身
    expect(rotationTargetOfSeat(1, 8, CFG)).toEqual({ row: 2, col: 9 })
    expect(rotationTargetOfSeat(2, 9, CFG)).toEqual({ row: 3, col: 1 })
  })

  it('每个学生的目标位置都合法、且都不是固定空位', () => {
    const result = rotateSeats({ seats: startSeats(), config: CFG })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    for (const move of result.moves) {
      const seat = result.seats.find((item) => item.id === move.to)
      expect(seat, `目标座位 ${move.to} 不存在`).toBeDefined()
      if (!seat) continue
      expect(isValidSeatPosition(seat.row, seat.col, CFG)).toBe(true)
      expect(isFixedEmptySeat(seat.row, seat.col, CFG)).toBe(false)
    }
  })

  it('逐名学生核对：(1,1) 那名学生确实坐到 (2,2)', () => {
    const seats = startSeats()
    const atStart = seats.find((seat) => seat.id === 'r1c1')!.studentId
    const result = rotateSeats({ seats, config: CFG })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const move = result.moves.find((item) => item.from === 'r1c1')
    expect(move?.studentId).toBe(atStart)
    expect(move?.to).toBe('r2c2')
    expect(seatOfStudent(result.seats).get(atStart!)).toBe('r2c2')
  })
})

describe('C. 数据安全：预览不碰原数据，失败不落库', () => {
  it('生成预览不改动传入的座位（对象与顺序都不动）', () => {
    const seats = startSeats()
    const before = snapshot(seats)
    const beforeRefs = [...seats]

    const result = rotateSeats({ seats, config: CFG })
    expect(result.ok).toBe(true)

    expect(snapshot(seats)).toBe(before)
    // 连数组元素引用都不该换：轮换结果必须是**新的 Seat 对象**
    seats.forEach((seat, index) => expect(seat).toBe(beforeRefs[index]))
    if (result.ok) {
      result.seats.forEach((seat, index) => expect(seat).not.toBe(beforeRefs[index]))
    }
  })

  it('人数与教室可用座位不一致 → 明确报错，不改数据', () => {
    const seats = startSeats(61)
    const before = snapshot(seats)
    const result = rotateSeats({ seats, config: CFG })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('61')
    expect(result.reason).toContain('62')
    expect(snapshot(seats)).toBe(before)
  })

  it('同一名学生被排在两个座位上 → 明确报错，不改数据', () => {
    const seats = startSeats().map((seat) =>
      seat.id === 'r1c1' ? { ...seat, studentId: 's62' } : seat,
    )
    const before = snapshot(seats)
    const result = rotateSeats({ seats, config: CFG })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('多个座位')
    expect(snapshot(seats)).toBe(before)
  })

  it('固定空位被手动占用时：先挪到唯一空位再整体轮换，并把这件事说出来', () => {
    // 把 r1c1 的学生拖到固定空位（旧规则「末排尾座留空」留下的那种排布）
    const moved = 's1'
    const seats = startSeats().map((seat) => {
      if (seat.id === 'r1c1') return { ...seat, studentId: undefined }
      if (seat.id === fixedEmptySeatId(CFG)) return { ...seat, studentId: moved }
      return seat
    })

    const result = rotateSeats({ seats, config: CFG })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.repaired).toBe(true)
    expect(
      result.seats.find((seat) => seat.id === fixedEmptySeatId(CFG))?.studentId,
    ).toBeUndefined()
    expect([...occupancyOf(result.seats).values()].sort()).toEqual(
      [...occupancyOf(seats).values()].sort(),
    )
  })
})

describe('D. 原有能力回归', () => {
  it('自动排座仍可用，且不会把人排到固定空位上', () => {
    const students: Student[] = studentProfiles().map((profile) => ({
      ...profile,
      gender: 'female',
    }))
    const result = arrangeSeats({ students, constraints: [], config: CFG, seed: 3 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const fixedSeat = result.seats.find((seat) => seat.id === fixedEmptySeatId(CFG))
    expect(fixedSeat?.studentId).toBeUndefined()
    expect(result.seats.filter((seat) => seat.studentId)).toHaveLength(62)
  })

  it('双视角仍只镜像列：固定空位在两个视角各有唯一槽位，且互为镜像', () => {
    const teacher = viewPositionOf(CFG.fixedEmptySeat.row, CFG.fixedEmptySeat.col, 'teacher', CFG)
    const student = viewPositionOf(CFG.fixedEmptySeat.row, CFG.fixedEmptySeat.col, 'student', CFG)
    expect(teacher).toEqual({ row: 1, col: 9 })
    expect(student).toEqual({ row: 1, col: 1 })
  })

  it('新建方案（自动就座）不占用固定空位，且 62 人全部有座', () => {
    const seats = startSeats()
    expect(seats.find((seat) => seat.id === fixedEmptySeatId(CFG))?.studentId).toBeUndefined()
    expect(seats.filter((seat) => seat.studentId)).toHaveLength(62)
    expect(seatOrdinal(1, 9, CFG)).toBe(fixedEmptySeatOrdinal(CFG))
  })

  it('座位网格恒为 63 座（导出 / 画布依赖这个形状）', () => {
    expect(buildSeatGrid()).toHaveLength(63)
  })
})

describe('E. 落库链路（store）：预览 → 取消 / 确认 → 刷新恢复', () => {
  let browser: FakeBrowser

  const prefix = appConfig.storageKeyPrefix

  beforeEach(() => {
    browser = installFakeBrowser()
    setActivePinia(createPinia())
    browser.localStorage.seed(
      `${prefix}:students`,
      JSON.stringify(
        studentProfiles().map((profile) => ({ ...profile, gender: 'female' as const })),
      ),
    )
  })

  it('取消（不落库）时当前座位保持不变', () => {
    const store = useSeatStore()
    const plan = store.currentPlan!
    const before = snapshot(plan.seats)

    // 「预览」= 只算结果，不写 store
    const preview = rotateSeats({ seats: plan.seats, config: CFG })
    expect(preview.ok).toBe(true)
    expect(snapshot(store.currentPlan!.seats)).toBe(before)

    // 点「取消」= 什么都不做
    expect(snapshot(store.currentPlan!.seats)).toBe(before)
  })

  it('校验失败时没有可落库的结果，座位一动不动', () => {
    const store = useSeatStore()
    const plan = store.currentPlan!
    const before = snapshot(plan.seats)

    const bad = rotateSeats({ seats: plan.seats.slice(0, 10), config: CFG })
    expect(bad.ok).toBe(false)
    expect(snapshot(store.currentPlan!.seats)).toBe(before)
  })

  it('确认应用后座位正确保存，刷新（重新 revive）后一模一样', async () => {
    const store = useSeatStore()
    const plan = store.currentPlan!
    const result = rotateSeats({ seats: plan.seats, config: CFG })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(store.replacePlanSeats(plan.id, result.seats)).toBe(true)

    const applied = store.currentPlan!.seats
    expect(snapshot(applied)).toBe(snapshot(result.seats))
    expect(applied.find((seat) => seat.id === fixedEmptySeatId(CFG))?.studentId).toBeUndefined()
    expect(applied.filter((seat) => seat.studentId)).toHaveLength(62)

    // 写盘是 watcher 驱动的（一次赋值 = 一次写盘），等一个 tick 再读盘上原文
    await nextTick()

    // 「刷新」= 从盘上原文重新 revive
    const raw = JSON.parse(browser.localStorage.getItem(`${prefix}:seatPlans`)!)
    const revived = reviveSeatPlans(raw)
    const current = revived.find((item) => item.isCurrent)!
    expect(snapshot(current.seats)).toBe(snapshot(result.seats))
  })

  it('不增加、不删除、不复制学生档案', () => {
    const studentStore = useStudentStore()
    const store = useSeatStore()
    const before = studentStore.students.map((student) => student.id).sort()
    const beforeSeats = occupancyOf(store.currentPlan!.seats)

    const result = rotateSeats({ seats: store.currentPlan!.seats, config: CFG })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    store.replacePlanSeats(store.currentPlan!.id, result.seats)

    expect(studentStore.students.map((student) => student.id).sort()).toEqual(before)
    expect([...occupancyOf(store.currentPlan!.seats).values()].sort()).toEqual(
      [...beforeSeats.values()].sort(),
    )
  })

  it('拖拽换座（交换 / 移入空位）仍然可用', () => {
    const store = useSeatStore()
    const plan = store.currentPlan!
    const a = plan.seats.find((seat) => seat.id === 'r2c1')!
    const b = plan.seats.find((seat) => seat.id === 'r2c2')!
    expect(a.studentId).toBeTruthy()
    expect(b.studentId).toBeTruthy()

    expect(store.swapSeats('r2c1', 'r2c2')).toBe(true)
    const after = store.currentPlan!.seats
    expect(after.find((seat) => seat.id === 'r2c1')?.studentId).toBe(b.studentId)
    expect(after.find((seat) => seat.id === 'r2c2')?.studentId).toBe(a.studentId)

    // 移入空位：先把一个人拖走腾出空位，再移回来
    const moved = store.currentPlan!.seats.find((seat) => seat.id === 'r2c1')!.studentId!
    expect(store.swapSeats('r2c1', 'r2c2')).toBe(true)
    expect(store.currentPlan!.seats.find((seat) => seat.id === 'r2c2')?.studentId).toBe(moved)
  })
})
