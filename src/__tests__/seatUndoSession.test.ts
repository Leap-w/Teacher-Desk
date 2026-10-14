/**
 * v3.7.5 §4 座位管理升级自检：撤销修改（§4.1）/ 顺序轮换生成独立座位表（§4.2）/
 * 座位图展示精简（§4.3）/ 导入导出明确当前座位表（§4.4）。
 *
 * 这一版盯的是三件「错了很难当场看出来」的事：
 *
 *  ① **撤销撤的是「本轮」，不是「上一次拖拽」**（§4.1）。教师拖了七八个座位之后按撤销，
 *     想要的是一张回到动手之前的表；只退一步的话，他得连按七八次，而且中途每一次都看不出
 *     自己退到哪了。这里用「连续三次操作 → 一次撤销 → 与开场快照逐格相等」钉死这个口径。
 *  ② **撤销的结果必须已经落盘**（§4.1）：座位整表 + 更新时间 + 换座记录**一次赋值写完**，
 *     于是只写一次盘、只广播一次；重开应用看到的是撤销后的布局。
 *  ③ **顺序轮换不许覆盖原表**（§4.2）：v3.7.4 那版是整表替换当前方案，这一版改成
 *     **新建一张独立座位表**——两张表各自有 id / 名称 / 座位 / 约束，改哪张都不动另一张，
 *     刷新后两张都在。轮换是「生成」而不是「就地改写」，这条错了教师会丢掉原来那张表。
 *
 * 另有两条**源码级钉子**（§4.3 / §4.4）：座位卡上不再画高个与其他标签（学生档案里的标签
 * 一个字段都没删，只是不上座位图），以及导入 / 导出各自说清操作的是哪一张座位表。
 * 展示与文案这类东西没有可断言的运行期形态，钉在源码上至少能挡住「悄悄改回去」。
 *
 * 写盘挂在 Vue 的 `watch`（pre-flush）上，**改完 store 必须先 `await nextTick()` 才读得到盘**。
 */
import { readFileSync } from 'node:fs'

import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { readRaw } from '@/services/storage'
import { useSeatStore } from '@/stores/seat'
import { useStudentStore } from '@/stores/student'
import { DEFAULT_CLASSROOM_CONFIG as CFG } from '@/types/classroom'
import { buildSeatGrid, createEmptySeatPlanConstraints, isFixedEmptySeat } from '@/utils/seat'
import { rotateSeats } from '@/utils/seatRotate'
import type { Seat } from '@/types/seat'
import type { Student } from '@/types'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`
const SEAT_KEY = `${prefix}:seatPlans`

/** 座位排布的可比较快照（用于「有没有被改动」的断言） */
function snapshot(seats: readonly Seat[]): string {
  return seats.map((seat) => `${seat.id}=${seat.studentId ?? ''}`).join('|')
}

/** 当前方案里某个座位上的学生（空位返回 undefined） */
function seatedAt(store: ReturnType<typeof useSeatStore>, seatId: string): string | undefined {
  return store.currentSeats.find((seat) => seat.id === seatId)?.studentId
}

/* ==================== ① 撤销修改（§4.1） ==================== */

describe('撤销修改：一次撤到本轮开始之前', () => {
  let browser: FakeBrowser

  /** 一张 63 座的空表，按 placement 指名谁坐在哪 */
  function planWith(
    id: string,
    name: string,
    placement: Record<string, string>,
    isCurrent: boolean,
  ) {
    const seats = buildSeatGrid()
    for (const [seatId, studentId] of Object.entries(placement)) {
      const seat = seats.find((item) => item.id === seatId)
      if (!seat) throw new Error(`测试用例写错了座位号：${seatId}`)
      seat.studentId = studentId
    }
    return {
      id,
      name,
      createdAt: '',
      updatedAt: '',
      isCurrent,
      seats,
      changeLogs: [],
      constraints: createEmptySeatPlanConstraints(),
    }
  }

  const PLAN2_PLACEMENT: Record<string, string> = { r5c1: 's1', r5c2: 's2', r6c1: 's3' }

  beforeEach(() => {
    browser = installFakeBrowser()
    setActivePinia(createPinia())
    browser.localStorage.seed(
      STUDENTS_KEY,
      JSON.stringify([
        // seatNumber 决定「新建方案」时的自动就座位置（1 → 第 1 排第 1 列）
        { id: 's1', name: '甲', studentNo: '0101', gender: 'female', seatNumber: 1 },
        { id: 's2', name: '乙', studentNo: '0102', gender: 'female', seatNumber: 2 },
        { id: 's3', name: '丙', studentNo: '0103', gender: 'female', seatNumber: 3 },
        { id: 's4', name: '丁', studentNo: '0104', gender: 'female', seatNumber: 4 },
      ] satisfies Student[]),
    )
    browser.localStorage.seed(
      SEAT_KEY,
      JSON.stringify([
        planWith('plan1', '开学初', { r1c1: 's1', r1c2: 's2', r2c1: 's3', r2c2: 's4' }, true),
        planWith('plan2', '备选方案', PLAN2_PLACEMENT, false),
      ]),
    )
  })

  it('拖动多个学生后撤销：一次回到本轮开始之前的完整布局（不是只撤最后一次）', () => {
    const store = useSeatStore()
    const before = snapshot(store.currentSeats)

    // 三次换座：交换两名学生 → 把第三名移到空位 → 再交换一次
    expect(store.swapSeats('r1c1', 'r1c2')).toBe(true)
    expect(store.moveStudent('r2c1', 'r3c1')).toBe(true)
    expect(store.swapSeats('r1c2', 'r2c2')).toBe(true)
    // 前置条件：布局确实已经变了——否则下面的「恢复原样」是白说的
    expect(seatedAt(store, 'r1c1')).toBe('s2')
    expect(seatedAt(store, 'r3c1')).toBe('s3')

    expect(store.canUndoSession).toBe(true)
    // 四名学生都动过（撤销确认弹窗里的「N 名学生回到原位」）
    expect(store.sessionChangedStudentIds.size).toBe(4)

    expect(store.undoSession()).toBe(true)

    expect(snapshot(store.currentSeats)).toBe(before)
    // 一轮只撤一次：再按一次不会撤到更早（那也不是教师的意思）
    expect(store.canUndoSession).toBe(false)
    expect(store.undoSession()).toBe(false)
  })

  it('撤销后刷新：盘上就是撤销后的布局（不会再弹回去）', async () => {
    const store = useSeatStore()
    const before = snapshot(store.currentSeats)

    store.swapSeats('r1c1', 'r1c2')
    store.undoSession()
    await nextTick()

    // 「刷新」＝重新建一个 Pinia 实例，store 从盘上重新读一遍
    setActivePinia(createPinia())
    const revived = useSeatStore()

    expect(snapshot(revived.currentSeats)).toBe(before)
    // 「还能再撤一次」不写进盘：重开应用是一张平静的表，不是一段还没走完的历史
    expect(revived.canUndoSession).toBe(false)
  })

  it('撤销立刻落盘（一次赋值只写一次盘），学生档案一个字段都不动', async () => {
    const store = useSeatStore()
    const studentStore = useStudentStore()
    const studentsRaw = readRaw(STUDENTS_KEY)
    const before = snapshot(store.currentSeats)

    store.swapSeats('r1c1', 'r1c2')
    store.moveStudent('r2c1', 'r3c1')
    await nextTick()
    browser.localStorage.resetCounters()

    expect(store.undoSession()).toBe(true)
    await nextTick()

    expect(snapshot(store.currentSeats)).toBe(before)
    // 座位整表 + 更新时间 + 换座记录一次写完 ⇒ 一次写盘（不是「先改座位再改记录」两次）
    expect(browser.localStorage.writesFor(SEAT_KEY)).toBe(1)
    // 学生档案：盘上原文一个字没动，也一次都没写
    expect(readRaw(STUDENTS_KEY)).toBe(studentsRaw)
    expect(browser.localStorage.writesFor(STUDENTS_KEY)).toBe(0)
    expect(studentStore.students.map((item) => item.id)).toEqual(['s1', 's2', 's3', 's4'])
  })

  it('没有可撤销内容时：禁用态成立、调用返回 false，且一个字节都不写', () => {
    const store = useSeatStore()
    const raw = readRaw(SEAT_KEY)
    browser.localStorage.resetCounters()

    expect(store.canUndoSession).toBe(false)
    expect(store.sessionChangedStudentIds.size).toBe(0)
    expect(store.undoSession()).toBe(false)

    expect(readRaw(SEAT_KEY)).toBe(raw)
    expect(browser.localStorage.writesFor(SEAT_KEY)).toBe(0)
  })

  it('「保存本次调整」不是本轮边界：撤销把本轮归档的换座记录一并收回', async () => {
    const store = useSeatStore()
    const before = snapshot(store.currentSeats)

    store.swapSeats('r1c1', 'r1c2')
    expect(store.commitPendingLogs()).toHaveLength(2)
    expect(store.currentPlan?.changeLogs).toHaveLength(2)
    // 保存把记录归了档，但座位没变——教师要回到的仍是「本轮开始之前」
    expect(store.canUndoSession).toBe(true)

    expect(store.undoSession()).toBe(true)
    await nextTick()

    expect(snapshot(store.currentSeats)).toBe(before)
    // 座位回到原点、记录却还留着，两边就对不上了——所以记录跟着一起回退
    expect(store.currentPlan?.changeLogs).toHaveLength(0)
    expect(store.pendingLogsCount).toBe(0)
  })

  it('切换方案后不可撤：绝不会把快照撤到另一张表上', () => {
    const store = useSeatStore()
    store.swapSeats('r1c1', 'r1c2')
    const otherBefore = snapshot(store.plans.find((plan) => plan.id === 'plan2')!.seats)

    expect(store.switchPlan('plan2')).toBe(true)
    expect(store.canUndoSession).toBe(false)
    expect(store.undoSession()).toBe(false)

    expect(snapshot(store.currentSeats)).toBe(otherBefore)
  })

  it('整表替换（换一种排法）后不可撤：不会把刚生成的那张表悄悄抹掉', () => {
    const store = useSeatStore()
    store.swapSeats('r1c1', 'r1c2')

    const replacement: Seat[] = store.currentSeats.map((seat) => ({
      ...seat,
      studentId: undefined,
    }))
    replacement.find((seat) => seat.id === 'r7c1')!.studentId = 's1'
    expect(store.replacePlanSeats('plan1', replacement)).toBe(true)
    const after = snapshot(store.currentSeats)

    expect(store.canUndoSession).toBe(false)
    expect(store.undoSession()).toBe(false)
    expect(snapshot(store.currentSeats)).toBe(after)
  })

  it('新建方案后不可撤（新表一开局没有「上一轮」可回）', () => {
    const store = useSeatStore()
    store.swapSeats('r1c1', 'r1c2')

    const created = store.createPlan('期末')

    expect(store.canUndoSession).toBe(false)
    expect(store.undoSession()).toBe(false)
    expect(store.currentPlan?.id).toBe(created.id)
    // 新表按学生档案的座位号自动就座，与上一张表的改动无关
    expect(seatedAt(store, 'r1c1')).toBe('s1')
  })

  it('删除学生后撤销：不会把他放回座位（快照里的他也一并清掉）', async () => {
    const store = useSeatStore()
    const studentStore = useStudentStore()

    store.swapSeats('r1c1', 'r1c2') // 让本轮有一份快照
    expect(studentStore.removeStudent('s3')).toBe(true)
    await nextTick() // 座位 store 的「学生被删除」监听在下一个 tick 才跑

    expect(store.currentSeats.filter((seat) => seat.studentId === 's3')).toHaveLength(0)

    expect(store.undoSession()).toBe(true)

    // 撤销之后 s3 也不能出现在任何座位上——那会是一张「看不见的占座」：
    // 座位卡按空位渲染（学生档案里已经查不到他），却谁也拖不进去
    expect(store.currentSeats.filter((seat) => seat.studentId === 's3')).toHaveLength(0)
    expect(seatedAt(store, 'r2c1')).toBeUndefined()
  })

  it('撤销只作用于当前方案：其他座位表一份都不动', async () => {
    const store = useSeatStore()
    store.swapSeats('r1c1', 'r1c2')
    store.undoSession()
    await nextTick()

    const raw = JSON.parse(readRaw(SEAT_KEY)!) as Array<{ id: string; seats: Seat[] }>
    const other = raw.find((item) => item.id === 'plan2')!
    expect(snapshot(other.seats)).toBe(snapshot(plan2Baseline()))
  })

  it('撤销后仍是完整的 63 座，固定空位依旧留空', () => {
    const store = useSeatStore()
    store.swapSeats('r1c1', 'r1c2')
    store.undoSession()

    const seats = store.currentSeats
    expect(seats).toHaveLength(CFG.totalSeats)
    const fixed = seats.find((seat) => isFixedEmptySeat(seat.row, seat.col, CFG))!
    expect(fixed.studentId).toBeUndefined()
  })

  /** 第二张表在种子里的样子（与 beforeEach 用同一份 placement 算出来） */
  function plan2Baseline(): Seat[] {
    const seats = buildSeatGrid()
    for (const [seatId, studentId] of Object.entries(PLAN2_PLACEMENT)) {
      seats.find((item) => item.id === seatId)!.studentId = studentId
    }
    return seats
  }
})

/* ==================== ② 顺序轮换生成独立座位表（§4.2） ==================== */

describe('顺序轮换：生成一张独立保存的座位表', () => {
  let browser: FakeBrowser

  /** 62 名学生（学号 0001…0062，座位号 1…62）——轮换要求「就座人数 = 可用座位数」 */
  function studentProfiles(count = 62) {
    return Array.from({ length: count }, (_, index) => ({
      id: `s${index + 1}`,
      name: `学生${index + 1}`,
      studentNo: String(index + 1).padStart(4, '0'),
      seatNumber: index + 1,
      gender: 'female' as const,
    }))
  }

  beforeEach(() => {
    browser = installFakeBrowser()
    setActivePinia(createPinia())
    // 键不存在 → store 自建「开学初」并按座位号自动就座（62 人全部有座）
    browser.localStorage.seed(STUDENTS_KEY, JSON.stringify(studentProfiles()))
  })

  /**
   * 页面 `applyRotate` 的那两行：纯函数算轮换结果 → **新建**一张座位表落库。
   * 这里照抄同一条调用顺序，页面那边由下面的源码钉子守着。
   */
  function rotateIntoNewPlan(store: ReturnType<typeof useSeatStore>) {
    const result = rotateSeats({ seats: store.currentSeats, config: CFG })
    if (!result.ok) throw new Error(`预期轮换成功，实际失败：${result.reason}`)
    return store.createPlanFromSeats(result.seats, store.nextRotateName())
  }

  it('轮换生成新表：原表一字未改、仍是原来那张 name/id，新表为当前', async () => {
    const store = useSeatStore()
    const source = store.currentPlan!
    const sourceBefore = snapshot(source.seats)

    browser.localStorage.resetCounters()
    const created = rotateIntoNewPlan(store)
    await nextTick()

    expect(store.plans).toHaveLength(2)
    expect(created.name).toBe('顺序轮换 1')
    expect(store.currentPlan?.id).toBe(created.id)
    // 轮换确实换了座（不是复制了一份原样的表）
    expect(snapshot(created.seats)).not.toBe(sourceBefore)

    const kept = store.plans.find((plan) => plan.id === source.id)!
    expect(kept.name).toBe('开学初')
    expect(kept.isCurrent).toBe(false)
    expect(snapshot(kept.seats)).toBe(sourceBefore)
    // 新建一张表 = 一次写盘（不是「先覆盖原表、再补一张新表」两次）
    expect(browser.localStorage.writesFor(SEAT_KEY)).toBe(1)
  })

  it('刷新后两张表都在，各是各的', async () => {
    const store = useSeatStore()
    const sourceBefore = snapshot(store.currentSeats)
    const created = rotateIntoNewPlan(store)
    const createdBefore = snapshot(created.seats)
    await nextTick()

    setActivePinia(createPinia())
    const revived = useSeatStore()

    expect(revived.plans).toHaveLength(2)
    expect(revived.currentPlan?.name).toBe('顺序轮换 1')
    expect(snapshot(revived.plans.find((plan) => plan.name === '顺序轮换 1')!.seats)).toBe(
      createdBefore,
    )
    expect(snapshot(revived.plans.find((plan) => plan.name === '开学初')!.seats)).toBe(sourceBefore)
  })

  it('改新表不影响旧表，改旧表不影响新表', () => {
    const store = useSeatStore()
    const source = store.currentPlan!
    const sourceBefore = snapshot(source.seats)
    const created = rotateIntoNewPlan(store)
    const createdBefore = snapshot(created.seats)

    // 在新表上换一次座：新表确实变了，旧表一动不动
    expect(store.swapSeats('r1c1', 'r1c2')).toBe(true)
    const createdAfterOwnEdit = snapshot(store.plans.find((plan) => plan.id === created.id)!.seats)
    expect(createdAfterOwnEdit).not.toBe(createdBefore)
    expect(snapshot(store.plans.find((plan) => plan.id === source.id)!.seats)).toBe(sourceBefore)

    // 切回旧表再改一次：旧表变了，新表（含它自己刚被改过的样子）同样一动不动
    expect(store.switchPlan(source.id)).toBe(true)
    expect(store.swapSeats('r1c1', 'r1c2')).toBe(true)
    expect(snapshot(store.plans.find((plan) => plan.id === source.id)!.seats)).not.toBe(
      sourceBefore,
    )
    expect(snapshot(store.plans.find((plan) => plan.id === created.id)!.seats)).toBe(
      createdAfterOwnEdit,
    )
  })

  it('连续轮换两次：先保存的那张表不会被后来者覆盖', () => {
    const store = useSeatStore()
    const firstBefore = snapshot(store.currentSeats)

    const second = rotateIntoNewPlan(store)
    const secondBefore = snapshot(second.seats)
    const third = rotateIntoNewPlan(store)

    expect(store.plans).toHaveLength(3)
    expect(second.name).toBe('顺序轮换 1')
    expect(third.name).toBe('顺序轮换 2')
    expect(snapshot(store.plans.find((plan) => plan.id === second.id)!.seats)).toBe(secondBefore)
    expect(snapshot(store.plans.find((plan) => plan.name === '开学初')!.seats)).toBe(firstBefore)
  })

  it('轮换前的那一轮修改不跨表生效：「撤销修改」不会把新表抹掉', () => {
    const store = useSeatStore()
    expect(store.swapSeats('r1c1', 'r1c2')).toBe(true)
    expect(store.canUndoSession).toBe(true)

    const created = rotateIntoNewPlan(store)

    expect(store.canUndoSession).toBe(false)
    expect(store.undoSession()).toBe(false)
    expect(snapshot(store.currentSeats)).toBe(snapshot(created.seats))
  })

  it('轮换出来的新表不带原表的约束（约束属于方案，不跟着座位走）', () => {
    const store = useSeatStore()
    const created = rotateIntoNewPlan(store)

    expect(created.constraints).toEqual(createEmptySeatPlanConstraints())
  })
})

/* ==================== ③ 展示精简与「当前座位表」的源码钉子（§4.3 / §4.4） ==================== */

describe('座位图展示精简与导入导出定位（源码级）', () => {
  const read = (path: string) => readFileSync(path, 'utf8')

  it('座位卡上不再画「高个」与「其他标签」（只剩姓名 / 性别 / 班委）', () => {
    const card = read('src/views/Seats/components/SeatCard.vue')
    for (const gone of ['is-tall', 'is-tag']) {
      expect(card, `座位卡不该再画 ${gone}`).not.toContain(gone)
    }
    // 剩下的两个标记：班委（顶条）+ 女生（底条）
    expect(card).toContain('.seat.is-cadre::before')
    expect(card).toContain('seat-gender-bar')

    const room = read('src/views/Seats/components/SeatClassroom.vue')
    for (const gone of ['is-tall', 'is-tag', 'seatAccentOf', 'student.tags']) {
      expect(room, `座位图不该再出现 ${gone}`).not.toContain(gone)
    }
    expect(room).toContain("'is-cadre'")
    expect(room).toContain("'is-girl'")
  })

  it('图例跟着收敛：只剩「班委」与「女生」', () => {
    const page = read('src/views/Seats/index.vue')
    expect(page).not.toContain('is-tall')
    expect(page).not.toContain('is-tag')
    expect(page).toContain("{ key: 'cadre', label: '班委', cls: 'is-cadre' }")
    expect(page).toContain("{ key: 'girl', label: '女生', cls: 'is-girl' }")
    expect(page).toContain('--color-gender-female')
  })

  it('学生档案里的标签与备注一个字段都没删，「高个」的排座偏好照旧生效', () => {
    // 座位图不再画它们 ≠ 数据没了：档案里照旧编辑，自动排座与检查器照旧读「高个」
    expect(read('src/types/index.ts')).toContain('tags?: string[]')
    expect(read('src/utils/seatArrange.ts')).toContain("const TALL_TAG = '高个'")
    expect(read('src/utils/constraint.ts')).toContain("const TALL_TAG = '高个'")
  })

  it('「撤销修改」常驻页头、按 store 的 canUndoSession 决定灰亮', () => {
    const page = read('src/views/Seats/index.vue')
    expect(page).toContain('canUndoSession')
    expect(page).toContain('undoSession()')
    expect(page).toContain('撤销修改')
    // 撤销后与其它改动座位位置的操作一样要退出点击换座模式与闪烁定位
    expect(page).toContain('function confirmUndoSession')
  })

  it('「顺序轮换」落库走新建方案，不再整表替换当前方案', () => {
    const page = read('src/views/Seats/index.vue')
    const start = page.indexOf('function applyRotate')
    expect(start).toBeGreaterThan(-1)
    const block = page.slice(start, start + 1500)
    expect(block).toContain('createPlanFromSeats')
    expect(block).toContain('nextRotateName')
    // 覆盖既有方案的那条路必须从轮换里彻底消失
    expect(block).not.toContain('replacePlanSeats')
  })

  it('导入 / 导出各自说清操作的是哪一张座位表', () => {
    const page = read('src/views/Seats/index.vue')
    expect(page).toContain('plan-name')
    expect(read('src/views/Seats/components/SeatExportMenu.vue')).toContain('planName')
    expect(read('src/views/Seats/components/SeatExportMenu.vue')).toContain('当前座位表')
    expect(read('src/views/Seats/components/SeatImportModal.vue')).toContain('导入到当前座位表')
  })
})
