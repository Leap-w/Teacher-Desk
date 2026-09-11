import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { appConfig } from '@/config'
import { readList, writeSeedJSON } from '@/services/storage'
import { syncPersisted } from '@/services/sync'
import { createId } from '@/utils/id'
import {
  buildSeatGrid,
  createSeatPlan,
  normalizeSeatPlan,
  seatOrdinal,
  seatPositionShort,
} from '@/utils/seat'
import { formatStudentShortName } from '@/utils/student'
import { useStudentStore } from '@/stores/student'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { ClassroomConfig } from '@/types/classroom'
import type { Seat, SeatChangeLog, SeatPlan } from '@/types/seat'
import type { Student } from '@/types'

const STORAGE_KEY = `${appConfig.storageKeyPrefix}:seatPlans`

/**
 * 求解器结果 → 座位号映射（createPlanFromSeats / replacePlanSeats 共用）。
 * **不信任传入的座位数组**：按行列重算座位号（与传入的 id / 顺序无关），
 * 同一学生只保留序号最小的座位，末排尾座固定留空（§2.4）。
 */
function occupantsFromSeats(
  seats: Array<Pick<Seat, 'row' | 'col' | 'studentId'>>,
  config: ClassroomConfig,
): Map<number, string> {
  const candidates: Array<{ ordinal: number; studentId: string }> = []
  for (const seat of seats) {
    if (!seat.studentId) continue
    const { row, col } = seat
    if (!Number.isInteger(row) || row < 1 || row > config.rows) continue
    if (!Number.isInteger(col) || col < 1 || col > config.cols) continue
    candidates.push({ ordinal: seatOrdinal(row, col, config), studentId: seat.studentId })
  }
  // 按座位号升序去重：结果与传入数组的顺序无关（同一学生只保留序号最小者）。
  // 同座位出现两名学生（求解器不会产出，纯防御）时按学生 id 定序，同样与传入顺序无关。
  candidates.sort((a, b) => a.ordinal - b.ordinal || a.studentId.localeCompare(b.studentId))
  const occupants = new Map<number, string>()
  const placed = new Set<string>()
  for (const item of candidates) {
    if (item.ordinal === config.totalSeats) continue
    if (placed.has(item.studentId)) continue
    placed.add(item.studentId)
    occupants.set(item.ordinal, item.studentId)
  }
  return occupants
}

/** 活跃学生的最小档案投影（供自动就座；只依赖既有字段，学生仍只经由 student store 写入） */
function studentProfiles() {
  return useStudentStore().activeStudents.map((item) => ({
    id: item.id,
    studentNo: item.studentNo,
    seatNumber: item.seatNumber,
  }))
}

/**
 * 首次启动（键不存在）：建一个「开学初」当前方案，学生按 seatNumber 自动就座。
 *
 * 走 `writeSeedJSON` 记下基线（Phase 9C）：这一份是**应用自己生成的初始状态**，
 * 不是教师排出来的——首次同步时它该被云端那份真方案换掉，而不是让教师去回答
 * 「本机与云端都有座位方案，保留哪一份」。教师一旦动过这张表（拖拽 / 换方案），
 * 盘上原文就与基线不同，保护立即生效。
 */
function seedPlans(): SeatPlan[] {
  const plan: SeatPlan = { ...createSeatPlan('开学初', studentProfiles()), isCurrent: true }
  writeSeedJSON(STORAGE_KEY, [plan])
  return [plan]
}

/** 同屏至多一个当前方案：无 isCurrent 则首个补位，多个则仅保留第一个 */
function ensureSingleCurrent(plans: SeatPlan[]): SeatPlan[] {
  if (plans.length === 0) return plans
  const firstCurrent = plans.findIndex((plan) => plan.isCurrent)
  return plans.map((plan, index) => {
    const shouldBeCurrent = firstCurrent === -1 ? index === 0 : index === firstCurrent
    return plan.isCurrent === shouldBeCurrent ? plan : { ...plan, isCurrent: shouldBeCurrent }
  })
}

/** 把盘上的原始列表规范成内存里的座位方案表（**首屏加载与跨标签页同步共用**，§11.1） */
function reviveSeatPlans(raw: unknown[]): SeatPlan[] {
  return ensureSingleCurrent(
    raw
      .filter((item): item is SeatPlan => Boolean(item) && typeof item === 'object')
      .map((item) => normalizeSeatPlan(item as Partial<SeatPlan>)),
  )
}

/** 从本地存储读取座位方案；守卫与升级策略同 student store（§3.2 数据安全保护） */
function loadSeatPlans(): SeatPlan[] {
  const stored = readList(STORAGE_KEY)
  if (stored === null) return seedPlans()
  return reviveSeatPlans(stored)
}

export const useSeatStore = defineStore('seat', () => {
  /** 教室固定配置（唯一事实来源；组件一律经 store 读取，不另写教室参数） */
  const config = DEFAULT_CLASSROOM_CONFIG

  /**
   * 学生 store 在 setup 内同步实例化（loadStudents 为同步读取）：
   * 启动清扫即可拿到完整学生表；后续删除监听也复用该实例。
   */
  const studentStore = useStudentStore()

  /** 全部座位方案（含历史方案；数组顺序即创建顺序） */
  const plans = ref<SeatPlan[]>(loadSeatPlans())

  // 写盘 + 跨标签页同步（Phase 9A）：本页改动写盘后广播键名，别的入口改了则重读并规范化
  syncPersisted(STORAGE_KEY, plans, reviveSeatPlans)

  // 同步路径**不重新清扫悬空座位**（`sweepDanglingSeats` 只在启动时与删除学生时跑）：
  // 清扫的输入是**学生**（另一个键），而这里收到的是座位方案的变更。实测这个缺口进不来——
  // 能改座位方案的入口只有两类：本页的排座操作（写入前自己先清扫），
  // 以及导入备份 / 清空数据（走 `broadcastReload` 整页重载，重载后启动清扫照跑）。
  // 真正会留下悬空座位的路径是「A 页删学生、B 页同时排座」，那需要 B 页在**没有座位广播**的
  // 情况下自己发起写入——而排座操作本身就会先清扫一次。把清扫挂到这里反而更糟：
  // 学生键的变更会触发全体座位方案的写盘广播（座位上本没有任何变化）。

  /** 当前方案（方案切换后唯一 isCurrent）；无方案时为 undefined */
  const currentPlan = computed(() => plans.value.find((plan) => plan.isCurrent))

  /** 当前方案全部座位（63 个，含空位）：同一批 Seat 对象，切换视角只改显示顺序 */
  const currentSeats = computed<Seat[]>(() => currentPlan.value?.seats ?? [])

  /** 已就座数量（studentId 计数；悬空座位已由启动清扫与删除监听清理，Phase 3B 起不悬空） */
  const occupiedCount = computed(() => currentSeats.value.filter((seat) => seat.studentId).length)

  /** 新方案默认名：座位方案 N（取不与现有方案重名的最小正整数） */
  function nextPlanName(): string {
    let n = 1
    while (plans.value.some((plan) => plan.name === `座位方案 ${n}`)) n++
    return `座位方案 ${n}`
  }

  /** 新建方案并切换为当前：学生按 seatNumber 自动就座（前 62 号，63 号尾座留空） */
  function createPlan(name?: string): SeatPlan {
    const plan = createSeatPlan(name?.trim() || nextPlanName(), studentProfiles())
    plans.value = plans.value
      .map((item) => (item.isCurrent ? { ...item, isCurrent: false } : item))
      .concat({ ...plan, isCurrent: true })
    clearCurrentLogs()
    return { ...plan, isCurrent: true }
  }

  /** 自动排座方案默认名：自动排座 N（与「座位方案 N」同样的最小不重名序号） */
  function nextArrangeName(): string {
    let n = 1
    while (plans.value.some((plan) => plan.name === `自动排座 ${n}`)) n++
    return `自动排座 ${n}`
  }

  /**
   * 用求解器结果新建方案并切换为当前（Phase 3D）。
   * 座位经 occupantsFromSeats 清洗后由 buildSeatGrid 整表重建（恒 rows × cols 座，id / block 由行列重算）。
   * 与 createPlan 的差别：不经 buildOccupantMap（不是按学生档案 seatNumber 就座）。
   */
  function createPlanFromSeats(
    seats: Array<Pick<Seat, 'row' | 'col' | 'studentId'>>,
    name?: string,
  ): SeatPlan {
    const now = new Date().toISOString()
    const plan: SeatPlan = {
      id: createId(),
      name: name?.trim() || nextArrangeName(),
      createdAt: now,
      updatedAt: now,
      isCurrent: true,
      seats: buildSeatGrid(occupantsFromSeats(seats, config), config),
      changeLogs: [],
    }
    plans.value = plans.value
      .map((item) => (item.isCurrent ? { ...item, isCurrent: false } : item))
      .concat(plan)
    clearCurrentLogs()
    return { ...plan }
  }

  /**
   * 用求解器结果替换既有方案的座位（Phase 3D「换一种排法」；方案名与 changeLogs 历史不变）。
   * 与其余方案编辑一致更新 updatedAt；目标为当前方案时清空「本次调整」待提交记录
   * （待提交记录描述的是替换前的排法）。方案不存在返回 false。
   */
  function replacePlanSeats(
    planId: string,
    seats: Array<Pick<Seat, 'row' | 'col' | 'studentId'>>,
  ): boolean {
    const target = plans.value.find((plan) => plan.id === planId)
    if (!target) return false
    const nextSeats = buildSeatGrid(occupantsFromSeats(seats, config), config)
    plans.value = plans.value.map((plan) =>
      plan.id === planId
        ? { ...plan, updatedAt: new Date().toISOString(), seats: nextSeats }
        : plan,
    )
    if (target.isCurrent) clearCurrentLogs()
    return true
  }

  /** 切换当前方案；目标不存在或已是当前时返回 false */
  function switchPlan(id: string): boolean {
    const target = plans.value.find((plan) => plan.id === id)
    if (!target || target.isCurrent) return false
    plans.value = plans.value.map((plan) => ({ ...plan, isCurrent: plan.id === id }))
    clearCurrentLogs()
    return true
  }

  /** 重命名（自动去首尾空白）；名称为空或目标不存在返回 false */
  function renamePlan(id: string, name: string): boolean {
    const trimmed = name.trim()
    if (!trimmed) return false
    const target = plans.value.find((plan) => plan.id === id)
    if (!target) return false
    if (target.name === trimmed) return true
    plans.value = plans.value.map((plan) =>
      plan.id === id ? { ...plan, name: trimmed, updatedAt: new Date().toISOString() } : plan,
    )
    return true
  }

  /** 删除历史方案；当前方案或仅剩一个方案时拒绝（返回 false） */
  function removePlan(id: string): boolean {
    const target = plans.value.find((plan) => plan.id === id)
    if (!target || target.isCurrent || plans.value.length <= 1) return false
    plans.value = plans.value.filter((plan) => plan.id !== id)
    return true
  }

  /* ========== Phase 3B：换座 / 换座日志 / 学生删除后的座位释放 ========== */

  /** 「本次调整」待提交日志（会话内暂存，不入 localStorage；保存 / 切换方案 / 新建方案后清空） */
  const pendingLogs = ref<SeatChangeLog[]>([])

  /** 待提交日志条数（页面据此显示「保存本次调整」入口） */
  const pendingLogsCount = computed(() => pendingLogs.value.length)

  function findActiveStudent(id: string): Student | undefined {
    return studentStore.activeStudents.find((item) => item.id === id)
  }

  function seatOf(plan: SeatPlan, seatId: string) {
    return plan.seats.find((seat) => seat.id === seatId)
  }

  /**
   * 追加一条换座记录到「本次调整」（UUID / ISO / 与当前方案绑定，数据层守卫关键字段）。
   * from / to 为位置短文案（如「2排3列」），由调用方格式化。
   */
  function appendSeatChangeLog(entry: Omit<SeatChangeLog, 'id' | 'planId' | 'changedAt'>): boolean {
    const plan = currentPlan.value
    if (!plan || !entry.studentId || !entry.studentName || !entry.from || !entry.to) return false
    pendingLogs.value = [
      ...pendingLogs.value,
      {
        ...entry,
        id: createId(),
        planId: plan.id,
        changedAt: new Date().toISOString(),
      },
    ]
    return true
  }

  /** 记录一条换座（内部）：学生名快照与位置文案统一在此格式化 */
  function logSeatChange(student: Student, fromSeat: Seat, toSeat: Seat): void {
    appendSeatChangeLog({
      studentId: student.id,
      studentName: formatStudentShortName(student),
      from: seatPositionShort(fromSeat.row, fromSeat.col),
      to: seatPositionShort(toSeat.row, toSeat.col),
    })
  }

  /**
   * 交换两个已就座座位的学生（Seat.id 不变，只交换 studentId）。
   * 交换成功记两条日志（每名学生一条）；座位不变 / 缺座 / 空源等非法输入返回 false。
   */
  function swapSeats(fromId: string, toId: string): boolean {
    const plan = currentPlan.value
    if (!plan || fromId === toId) return false
    const fromSeat = seatOf(plan, fromId)
    const toSeat = seatOf(plan, toId)
    if (!fromSeat || !toSeat || !fromSeat.studentId || !toSeat.studentId) return false
    const studentA = findActiveStudent(fromSeat.studentId)
    const studentB = findActiveStudent(toSeat.studentId)
    if (!studentA || !studentB) return false
    const now = new Date().toISOString()
    plans.value = plans.value.map((item) => {
      if (item.id !== plan.id) return item
      return {
        ...item,
        updatedAt: now,
        seats: item.seats.map((seat) =>
          seat.id === fromId
            ? { ...seat, studentId: toSeat.studentId }
            : seat.id === toId
              ? { ...seat, studentId: fromSeat.studentId }
              : seat,
        ),
      }
    })
    logSeatChange(studentA, fromSeat, toSeat)
    logSeatChange(studentB, toSeat, fromSeat)
    return true
  }

  /** 把学生从已就座座位移到空位（源必须有学生、目标必须为空）；成功记一条日志 */
  function moveStudent(fromId: string, toId: string): boolean {
    const plan = currentPlan.value
    if (!plan || fromId === toId) return false
    const fromSeat = seatOf(plan, fromId)
    const toSeat = seatOf(plan, toId)
    if (!fromSeat || !toSeat || !fromSeat.studentId || toSeat.studentId) return false
    const student = findActiveStudent(fromSeat.studentId)
    if (!student) return false
    const now = new Date().toISOString()
    plans.value = plans.value.map((item) => {
      if (item.id !== plan.id) return item
      return {
        ...item,
        updatedAt: now,
        seats: item.seats.map((seat) =>
          seat.id === fromId
            ? { ...seat, studentId: undefined }
            : seat.id === toId
              ? { ...seat, studentId: fromSeat.studentId }
              : seat,
        ),
      }
    })
    logSeatChange(student, fromSeat, toSeat)
    return true
  }

  /**
   * 学生被删除后释放其在全部方案中的座位（自动释放、不写换座日志），
   * 并剔除其「本次调整」待提交记录；历史 changeLogs 留档不改写。返回释放的座位总数。
   */
  function clearSeatByStudent(studentId: string): number {
    if (!studentId) return 0
    let released = 0
    let touched = false
    const next = plans.value.map((item) => {
      const now = new Date().toISOString()
      let planTouched = false
      const seats = item.seats.map((seat) => {
        if (seat.studentId !== studentId) return seat
        planTouched = true
        released += 1
        return { ...seat, studentId: undefined }
      })
      if (!planTouched) return item
      touched = true
      return { ...item, updatedAt: now, seats }
    })
    if (touched) {
      plans.value = next
      pendingLogs.value = pendingLogs.value.filter((log) => log.studentId !== studentId)
    }
    return released
  }

  /** 启动清扫：student store 已在本 setup 同步加载完成，据此释放历史遗留的悬空 studentId */
  function sweepDanglingSeats(): void {
    let touched = false
    const next = plans.value.map((item) => {
      let planTouched = false
      const seats = item.seats.map((seat) => {
        if (!seat.studentId || activeStudentIds.has(seat.studentId)) return seat
        planTouched = true
        return { ...seat, studentId: undefined }
      })
      if (!planTouched) return item
      touched = true
      return { ...item, updatedAt: new Date().toISOString(), seats }
    })
    if (touched) plans.value = next
  }

  /** 已加载的活跃学生 id 快照：与后续活跃列表对比，检测「学生被删除」事件 */
  const activeStudentIds = new Set(studentStore.activeStudents.map((item) => item.id))
  sweepDanglingSeats()

  /** 学生被删除 → 自动释放其在全部方案中的座位（含当前方案，双视角即时可见空位「＋」） */
  watch(
    () => studentStore.activeStudents.map((item) => item.id),
    (ids) => {
      const next = new Set(ids)
      for (const id of activeStudentIds) {
        if (!next.has(id)) clearSeatByStudent(id)
      }
      activeStudentIds.clear()
      for (const id of next) activeStudentIds.add(id)
    },
  )

  /** 把「本次调整」归档进当前方案 changeLogs 并清空待提交；返回刚归档的记录（供摘要展示） */
  function commitPendingLogs(): SeatChangeLog[] {
    const plan = currentPlan.value
    if (!plan || pendingLogs.value.length === 0) return []
    const committed = pendingLogs.value
    const now = new Date().toISOString()
    plans.value = plans.value.map((item) =>
      item.id === plan.id
        ? { ...item, updatedAt: now, changeLogs: [...item.changeLogs, ...committed] }
        : item,
    )
    pendingLogs.value = []
    return committed
  }

  /** 清空「本次调整」待提交记录（保存后 / 切换方案 / 新建方案时调用） */
  function clearCurrentLogs(): void {
    pendingLogs.value = []
  }

  return {
    config,
    plans,
    currentPlan,
    currentSeats,
    occupiedCount,
    pendingLogsCount,
    createPlan,
    createPlanFromSeats,
    replacePlanSeats,
    switchPlan,
    renamePlan,
    removePlan,
    swapSeats,
    moveStudent,
    clearSeatByStudent,
    appendSeatChangeLog,
    clearCurrentLogs,
    commitPendingLogs,
  }
})
