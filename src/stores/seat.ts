import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { seatRepository } from '@/repositories/seat/seatRepository'
import { createId } from '@/utils/id'
import {
  buildSeatGrid,
  compareSeatPlans,
  createEmptySeatPlanConstraints,
  createSeatPlan,
  getSeatKey,
  isFixedEmptySeat,
  isValidSeatPosition,
  normalizeSeatPlanConstraints,
  seatOrdinal,
  seatPositionShort,
} from '@/utils/seat'
import { validateSeatPlanConstraints } from '@/utils/seatPlanConstraint'
import { formatStudentShortName } from '@/utils/student'
import { useStudentStore } from '@/stores/student'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { ClassroomConfig } from '@/types/classroom'
import type { Seat, SeatChangeLog, SeatPlan, SeatPlanConstraints } from '@/types/seat'
import type { SeatImportAssignment } from '@/services/seatImport'
import type { SeatPlanConstraintReport } from '@/utils/seatPlanConstraint'
import type { Student } from '@/types'

/** Excel 座位导入结果：失败时**当前方案完全不改变** */
export interface SeatImportOutcome {
  ok: boolean
  /** 实际安排的座位数 */
  applied: number
  /** 座位发生变动的学生数 */
  relocated: number
  /** 失败原因（页面直接 toast 出来） */
  reason?: string
}

/**
 * 座位图 → **新建一张座位表**的落库参数。
 *
 * 与 `applySeatImport` 的逐条语义不同：座位图描述的是一整张表，
 * 所以落库是新建方案（现有方案原样保留），而不是往当前方案上打补丁。
 */
export interface SeatMapImportInput {
  /** 新座位表名称（通常取自 Excel 文件名）；重名会自动加序号 */
  baseName?: string
  assignments: ReadonlyArray<SeatImportAssignment>
  /** 隐藏数据里的排座约束；`undefined` = 可见图来源，新表用空约束 */
  constraints?: SeatPlanConstraints
}

/** 新建座位表的结果：失败时**现有方案与数据一个字节都不改** */
export interface SeatMapImportOutcome {
  ok: boolean
  /** 新建并切换过去的方案 */
  planId?: string
  planName?: string
  /** 实际安排的座位数 */
  applied: number
  /** 失败原因（页面直接 toast 出来） */
  reason?: string
}

/**
 * 求解器结果 → 座位号映射（createPlanFromSeats / replacePlanSeats 共用）。
 * **不信任传入的座位数组**：按行列重算座位号（与传入的 id / 顺序无关），
 * 同一学生只保留序号最小的座位，固定空位（第 1 排第 9 列，v3.7.4 起）强制留空。
 *
 * 这里必须用 `isFixedEmptySeat(row, col)` 而不是「跳过最后一个座位号」：固定空位是
 * **坐标**上的一个格子，用位置猜（旧写法 `ordinal === config.totalSeats`）会在空位换角
 * 之后把真正该留空的那个座位排上人，同时把原本坐那儿的学生整条丢掉。
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
    if (isFixedEmptySeat(row, col, config)) continue
    candidates.push({ ordinal: seatOrdinal(row, col, config), studentId: seat.studentId })
  }
  // 按座位号升序去重：结果与传入数组的顺序无关（同一学生只保留序号最小者）。
  // 同座位出现两名学生（求解器不会产出，纯防御）时按学生 id 定序，同样与传入顺序无关。
  candidates.sort((a, b) => a.ordinal - b.ordinal || a.studentId.localeCompare(b.studentId))
  const occupants = new Map<number, string>()
  const placed = new Set<string>()
  for (const item of candidates) {
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
function buildSeedPlans(): SeatPlan[] {
  const plan: SeatPlan = { ...createSeatPlan('开学初', studentProfiles()), isCurrent: true }
  return [plan]
}

export const useSeatStore = defineStore('seat', () => {
  /** 教室固定配置（唯一事实来源；组件一律经 store 读取，不另写教室参数） */
  const config = DEFAULT_CLASSROOM_CONFIG

  /**
   * 学生 store 在 setup 内同步实例化（loadStudents 为同步读取）：
   * 启动清扫即可拿到完整学生表；后续删除监听也复用该实例。
   */
  const studentStore = useStudentStore()

  /** 全部座位方案（含历史方案；数组顺序即创建顺序）；首次启动播种「开学初」并写基线 */
  const plans = ref<SeatPlan[]>(seatRepository.load() ?? seatRepository.writeSeed(buildSeedPlans()))

  // 写盘 + 跨标签页同步（Phase 9A）：本页改动写盘后广播键名，别的入口改了则重读并规范化
  seatRepository.bind(plans)

  // 同步路径**不重新清扫悬空座位**（`sweepDanglingSeats` 只在启动时与删除学生时跑）：
  // 清扫的输入是**学生**（另一个键），而这里收到的是座位方案的变更。实测这个缺口进不来——
  // 能改座位方案的入口只有两类：本页的排座操作（写入前自己先清扫），
  // 以及导入备份 / 清空数据（走 `broadcastReload` 整页重载，重载后启动清扫照跑）。
  // 真正会留下悬空座位的路径是「A 页删学生、B 页同时排座」，那需要 B 页在**没有座位广播**的
  // 情况下自己发起写入——而排座操作本身就会先清扫一次。把清扫挂到这里反而更糟：
  // 学生键的变更会触发全体座位方案的写盘广播（座位上本没有任何变化）。

  /** 当前方案（方案切换后唯一 isCurrent）；无方案时为 undefined */
  const currentPlan = computed(() => plans.value.find((plan) => plan.isCurrent))

  /** 当前方案全部座位（63 个，含空位与固定空位）：同一批 Seat 对象，切换视角只改显示顺序 */
  const currentSeats = computed<Seat[]>(() => currentPlan.value?.seats ?? [])

  /** 已就座数量（studentId 计数；悬空座位已由启动清扫与删除监听清理，Phase 3B 起不悬空） */
  const occupiedCount = computed(() => currentSeats.value.filter((seat) => seat.studentId).length)

  /** 新方案默认名：座位方案 N（取不与现有方案重名的最小正整数） */
  function nextPlanName(): string {
    let n = 1
    while (plans.value.some((plan) => plan.name === `座位方案 ${n}`)) n++
    return `座位方案 ${n}`
  }

  /**
   * 指定一个可用的方案名：`base` 为空 → 座位方案 N；与现有方案重名 → `base 2`、`base 3`…
   * 座位图导入用它把 Excel 文件名变成新表名（同一个文件反复导入不会互相覆盖）。
   */
  function nextUniquePlanName(base: string): string {
    const trimmed = base.trim()
    if (!trimmed) return nextPlanName()
    if (!plans.value.some((plan) => plan.name === trimmed)) return trimmed
    let n = 2
    while (plans.value.some((plan) => plan.name === `${trimmed} ${n}`)) n += 1
    return `${trimmed} ${n}`
  }

  /** 新建方案并切换为当前：学生按 seatNumber 自动就座（62 个可用座位，固定空位 第1排第9列 留空） */
  function createPlan(name?: string): SeatPlan {
    const plan = createSeatPlan(name?.trim() || nextPlanName(), studentProfiles())
    plans.value = plans.value
      .map((item) => (item.isCurrent ? { ...item, isCurrent: false } : item))
      .concat({ ...plan, isCurrent: true })
    clearCurrentLogs()
    endSession()
    return { ...plan, isCurrent: true }
  }

  /** 自动排座方案默认名：自动排座 N（与「座位方案 N」同样的最小不重名序号） */
  function nextArrangeName(): string {
    let n = 1
    while (plans.value.some((plan) => plan.name === `自动排座 ${n}`)) n++
    return `自动排座 ${n}`
  }

  /**
   * 顺序轮换方案默认名：顺序轮换 N（v3.7.5 起轮换**新建**一张独立座位表，见 §4.2；
   * v3.7.4 那版是覆盖当前方案，不产生新名字）。命名规则与另外两处一致。
   */
  function nextRotateName(): string {
    let n = 1
    while (plans.value.some((plan) => plan.name === `顺序轮换 ${n}`)) n++
    return `顺序轮换 ${n}`
  }

  /**
   * 按一份座位安排新建方案并切换为当前（自动排座 / 轮换 / 复制 / 座位图导入共用）。
   * 座位经 occupantsFromSeats 清洗后由 buildSeatGrid 整表重建（恒 rows × cols 座，id / block 由行列重算）。
   * 与 createPlan 的差别：不经 buildOccupantMap（不是按学生档案 seatNumber 就座）。
   *
   * @param constraints 座位图导入可带回导出文件里的排座约束；不传 = 空约束（其余调用方）。
   */
  function createPlanFromSeats(
    seats: Array<Pick<Seat, 'row' | 'col' | 'studentId'>>,
    name?: string,
    constraints?: SeatPlanConstraints,
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
      constraints: constraints
        ? normalizeSeatPlanConstraints(constraints)
        : createEmptySeatPlanConstraints(),
    }
    plans.value = plans.value
      .map((item) => (item.isCurrent ? { ...item, isCurrent: false } : item))
      .concat(plan)
    clearCurrentLogs()
    endSession()
    return { ...plan }
  }

  /**
   * 用求解器结果替换既有方案的座位（Phase 3D「换一种排法」；方案名与 changeLogs 历史不变）。
   * 与其余方案编辑一致更新 updatedAt；目标为当前方案时清空「本次调整」待提交记录
   * （待提交记录描述的是替换前的排法）。方案不存在返回 false。
   *
   * v3.7.5：目标为当前方案时同样结束「本轮修改」（撤销快照作废）——整表改写是另起一轮，
   * 保留旧快照会让「撤销修改」把教师刚生成的那张表悄悄抹掉。
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
    if (target.isCurrent) {
      clearCurrentLogs()
      endSession()
    }
    return true
  }

  /** 切换当前方案；目标不存在或已是当前时返回 false */
  function switchPlan(id: string): boolean {
    const target = plans.value.find((plan) => plan.id === id)
    if (!target || target.isCurrent) return false
    plans.value = plans.value.map((plan) => ({ ...plan, isCurrent: plan.id === id }))
    clearCurrentLogs()
    endSession()
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
    // 撤销快照指向的就是这一份（正常走不到：切方案时已经结束本轮），留着只会指向一张没了的表
    if (sessionBaseline.value?.planId === id) endSession()
    return true
  }

  /* ========== v3.7.5（§4.1）：撤销「本轮修改」（会话内轻量快照，不写 localStorage） ========== */

  /**
   * 「本轮修改」开始前的座位布局快照（当前方案的完整座位）。
   *
   * **只放在内存里**：刷新后要保住的是**撤销的结果**（座位已经写盘、重开就是撤销后的布局），
   * 而不是「撤销按钮还能再按一次」；把快照也写进 localStorage 等于再养一份可能与学生表、
   * 方案表分叉的座位数据，反而制造新的出错点（§4.1 也明确「优先使用轻量快照方案」）。
   *
   * 「本轮」＝从第一次换座起，到撤销、或换/新建/整表替换方案为止。**「保存本次调整」不算边界**：
   * 它归档的是换座记录，座位本身没有变化，教师按下撤销时想回到的仍是「这一轮开始之前」，
   * 所以撤销会连同本轮归档的记录一起收回（见 undoSession）。
   */
  const sessionBaseline = ref<
    | {
        planId: string
        seats: Seat[]
        logCount: number
      }
    | undefined
  >(undefined)

  /**
   * 记下本轮起点：**只在第一次真正改动座位之前拍一次**，之后不再覆盖——
   * 每次换座都重拍的话，撤销就退化成「撤销最后一次拖拽」，正是 §4.1 明确不要的做法。
   *
   * 快照只含座位与换座记录条数：约束编辑不在撤销范围内（座位图导入也不再改当前方案的约束——
   * 它是新建方案）。
   */
  function captureSessionBaseline(): void {
    const plan = currentPlan.value
    if (!plan) return
    const baseline = sessionBaseline.value

    // 已有快照且指向同一方案：本轮已经在进行中，保持最初那一份
    if (baseline?.planId === plan.id) return

    sessionBaseline.value = {
      planId: plan.id,
      seats: plan.seats.map((seat) => ({ ...seat })),
      logCount: plan.changeLogs.length,
    }
  }

  /** 结束本轮：快照作废，之后的改动算新一轮 */
  function endSession(): void {
    sessionBaseline.value = undefined
  }

  /** 本轮是否还有可撤销的改动（页面据此启用「撤销修改」；没有可撤销内容时按钮灰着） */
  const canUndoSession = computed(() => {
    const baseline = sessionBaseline.value
    return Boolean(baseline && currentPlan.value?.id === baseline.planId)
  })

  /**
   * 本轮改动涉及的学生（撤销确认弹窗里的「N 名学生回到原位」）：
   * 复用方案对比的既有口径（`compareSeatPlans`）——相对本轮起点换了座位、或从没有座位
   * 变成有座位的算一名，不另写一套「谁算变了」的判断。
   */
  const sessionChangedStudentIds = computed<ReadonlySet<string>>(() => {
    const baseline = sessionBaseline.value
    const plan = currentPlan.value
    if (!baseline || !plan || plan.id !== baseline.planId) return new Set<string>()
    const students = new Map(studentStore.activeStudents.map((item) => [item.id, item]))
    return compareSeatPlans({ ...plan, seats: baseline.seats }, plan, students).changedStudentIds
  })

  /**
   * 撤销本轮修改（§4.1）：把当前方案的座位整表恢复成**本轮第一次换座之前**的样子，
   * 而不是只撤销最近一次拖拽。
   *
   * - 座位经与整表替换同一条管道重建（`occupantsFromSeats` + `buildSeatGrid`：按行列重算座位号、
   *   固定空位强制留空），**一次赋值写全**（座位 + updatedAt + 换座记录），因此只写一次盘、
   *   只广播一次，**撤销后的布局立即持久化**，刷新 / 重开后仍是撤销后的样子；
   * - 本轮归档的换座记录一并收回（座位回到原点、记录却还留着，两边就对不上了）；
   * - 学生档案一个字段都不动：这里只写 seats，不碰 students；
   * - 快照为空 / 方案已变（换了方案、方案被删）时返回 false，绝不错撤到另一份方案上。
   */
  function undoSession(): boolean {
    const baseline = sessionBaseline.value
    const plan = currentPlan.value
    if (!baseline || !plan || plan.id !== baseline.planId) return false
    const seats = buildSeatGrid(occupantsFromSeats(baseline.seats, config), config)
    sessionBaseline.value = undefined
    // 「本次调整」待提交记录描述的是已经被撤掉的那些改动，一起清空
    pendingLogs.value = []
    plans.value = plans.value.map((item) =>
      item.id === plan.id
        ? {
            ...item,
            updatedAt: new Date().toISOString(),
            seats,
            // 换座记录回退到本轮开始时的条数（commitPendingLogs 追加式入档，截断即收回本轮）
            changeLogs: item.changeLogs.slice(0, baseline.logCount),
          }
        : item,
    )
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
      studentName: formatStudentShortName(student, studentStore.nameCounts),
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
    // 校验都过了、马上要真的改座位：本轮若是第一次换座，先把「换之前」的样子拍下来
    captureSessionBaseline()
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
    // 同 swapSeats：真的改动之前拍下本轮起点
    captureSessionBaseline()
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
      // 撤销快照里也要去掉这名学生：撤销时把一个已经不在档案的学生放回座位，
      // 留下的是一张「看不见的占座」——座位卡当作空位显示，却谁也拖不进去
      const baseline = sessionBaseline.value
      if (baseline) {
        sessionBaseline.value = {
          ...baseline,
          seats: baseline.seats.map((seat) =>
            seat.studentId === studentId ? { ...seat, studentId: undefined } : seat,
          ),
        }
      }
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
    // 排座约束里的学生引用同样要清（示例数据清理会整批删学生，不留脏引用）
    pruneDanglingConstraints(activeStudentIds)
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
      pruneDanglingConstraints(activeStudentIds)
    },
  )

  /* ========== V1.1.2 Phase 1：方案级排座约束（不能同桌 / 三人不能相邻 / 前排 / 后排） ========== */

  /** 当前方案的排座约束（无方案时回空约束，只读消费方不必判空） */
  const currentConstraints = computed<SeatPlanConstraints>(
    () => currentPlan.value?.constraints ?? createEmptySeatPlanConstraints(),
  )

  /** 学生查询表（检查结论要显示姓名；只依赖 activeStudents，学生表变化即重算） */
  const studentMap = computed(
    () => new Map(studentStore.activeStudents.map((item) => [item.id, item])),
  )

  /**
   * 排座约束检查结论（实时的 computed：约束 / 座位 / 学生任一变化即重算）。
   * **只检查，不改座位**；错误（不能同桌 / 三人相邻）与警告（前排 / 后排）都由页面提示。
   */
  const constraintReport = computed<SeatPlanConstraintReport>(() =>
    validateSeatPlanConstraints(currentPlan.value, studentMap.value),
  )

  /** 约束变更结果：失败时给出可读原因（页面直接 toast 出来） */
  type ConstraintMutation = { ok: true } | { ok: false; reason: string }

  /**
   * 把新的约束写回当前方案（**唯一写入口**：一次赋值 = 一次写盘 + 一次广播）。
   * 写入前统一规范化（去重、剔除自相约束、前后排互斥），保证盘上的数据与检查器口径一致。
   */
  function writeConstraints(next: SeatPlanConstraints): boolean {
    const plan = currentPlan.value
    if (!plan) return false
    const normalized = normalizeSeatPlanConstraints(next)
    const now = new Date().toISOString()
    plans.value = plans.value.map((item) =>
      item.id === plan.id ? { ...item, updatedAt: now, constraints: normalized } : item,
    )
    return true
  }

  /** 新增「不能同桌」（同一对学生不计方向，重复即拒绝） */
  function addSameDeskForbidden(studentA: string, studentB: string): ConstraintMutation {
    const plan = currentPlan.value
    if (!plan) return { ok: false, reason: '当前没有座位方案' }
    if (!studentA || !studentB) return { ok: false, reason: '请选择两名学生' }
    if (studentA === studentB) return { ok: false, reason: '请选择两名不同的学生' }
    const exists = plan.constraints.sameDeskForbidden.some(
      (rule) =>
        (rule.studentA === studentA && rule.studentB === studentB) ||
        (rule.studentA === studentB && rule.studentB === studentA),
    )
    if (exists) return { ok: false, reason: '这两名学生已在「不能同桌」中' }
    return writeConstraints({
      ...plan.constraints,
      sameDeskForbidden: [
        ...plan.constraints.sameDeskForbidden,
        { id: createId(), studentA, studentB },
      ],
    })
      ? { ok: true }
      : { ok: false, reason: '写入失败：方案已变化，请刷新后重试' }
  }

  /** 删除一条「不能同桌」 */
  function removeSameDeskForbidden(ruleId: string): boolean {
    const plan = currentPlan.value
    if (!plan) return false
    const list = plan.constraints.sameDeskForbidden
    if (!list.some((rule) => rule.id === ruleId)) return false
    return writeConstraints({
      ...plan.constraints,
      sameDeskForbidden: list.filter((rule) => rule.id !== ruleId),
    })
  }

  /** 新增「三人不能相邻组」（必须三名互异学生；同一组不计顺序，重复即拒绝） */
  function addAdjacentGroupForbidden(students: readonly string[]): ConstraintMutation {
    const plan = currentPlan.value
    if (!plan) return { ok: false, reason: '当前没有座位方案' }
    const ids = [...new Set(students.filter(Boolean))]
    if (ids.length !== 3) return { ok: false, reason: '请选择三名不同的学生' }
    const key = [...ids].sort().join('|')
    const exists = plan.constraints.adjacentGroupForbidden.some(
      (rule) => [...rule.students].sort().join('|') === key,
    )
    if (exists) return { ok: false, reason: '这组学生已在「三人不能相邻」中' }
    return writeConstraints({
      ...plan.constraints,
      adjacentGroupForbidden: [
        ...plan.constraints.adjacentGroupForbidden,
        { id: createId(), students: [ids[0]!, ids[1]!, ids[2]!] },
      ],
    })
      ? { ok: true }
      : { ok: false, reason: '写入失败：方案已变化，请刷新后重试' }
  }

  /** 删除一条「三人不能相邻组」 */
  function removeAdjacentGroupForbidden(ruleId: string): boolean {
    const plan = currentPlan.value
    if (!plan) return false
    const list = plan.constraints.adjacentGroupForbidden
    if (!list.some((rule) => rule.id === ruleId)) return false
    return writeConstraints({
      ...plan.constraints,
      adjacentGroupForbidden: list.filter((rule) => rule.id !== ruleId),
    })
  }

  /**
   * 批量设置前排 / 后排标记（**一次写入**，不分学生逐条写）：
   * - `front` / `back`：把这些学生标到该名单，并**从另一份名单移除**（互斥）；
   * - `clear`：从两份名单一起移除（批量取消）。
   * 返回实际处理的学生数。前排 / 后排只是排座偏好，**不会自动移动任何学生**。
   */
  function setRowPreference(
    studentIds: readonly string[],
    target: 'front' | 'back' | 'clear',
  ): number {
    const plan = currentPlan.value
    if (!plan) return 0
    const ids = [...new Set(studentIds.filter(Boolean))]
    if (ids.length === 0) return 0
    const targetSet = new Set(ids)
    let front = plan.constraints.frontRowStudents.filter((id) => !targetSet.has(id))
    let back = plan.constraints.backRowStudents.filter((id) => !targetSet.has(id))
    if (target === 'front') front = [...front, ...ids]
    if (target === 'back') back = [...back, ...ids]
    return writeConstraints({ ...plan.constraints, frontRowStudents: front, backRowStudents: back })
      ? ids.length
      : 0
  }

  /**
   * 剔除约束里指向「已不存在的学生」的条目（方案级约束随学生删除 / 示例数据清理同步收敛，
   * 与座位释放同一策略：不留脏引用，检查器也就不必替它们兜底）。
   * 返回被剔除的条目数。
   */
  function pruneDanglingConstraints(validIds: ReadonlySet<string>): number {
    let removed = 0
    let touched = false
    const next = plans.value.map((plan) => {
      const constraints = plan.constraints
      if (!constraints) return plan
      const sameDeskForbidden = constraints.sameDeskForbidden.filter(
        (rule) => validIds.has(rule.studentA) && validIds.has(rule.studentB),
      )
      const adjacentGroupForbidden = constraints.adjacentGroupForbidden.filter((rule) =>
        rule.students.every((id) => validIds.has(id)),
      )
      const frontRowStudents = constraints.frontRowStudents.filter((id) => validIds.has(id))
      const backRowStudents = constraints.backRowStudents.filter((id) => validIds.has(id))
      const dropped =
        constraints.sameDeskForbidden.length -
        sameDeskForbidden.length +
        (constraints.adjacentGroupForbidden.length - adjacentGroupForbidden.length) +
        (constraints.frontRowStudents.length - frontRowStudents.length) +
        (constraints.backRowStudents.length - backRowStudents.length)
      if (dropped === 0) return plan
      removed += dropped
      touched = true
      return {
        ...plan,
        updatedAt: new Date().toISOString(),
        constraints: {
          sameDeskForbidden,
          adjacentGroupForbidden,
          frontRowStudents,
          backRowStudents,
        },
      }
    })
    if (touched) plans.value = next
    return removed
  }

  /* ========== V1.1.2 Phase 1：Excel 座位导入（唯一落库入口） ========== */

  /**
   * 应用一次 Excel 座位导入（**组件不得自行改 `seats`、不得直接 `localStorage.setItem`**）。
   *
   * 语义：逐条应用表格里的「学生 → 座位」指派——被指派的学生先离开原座位，再坐到目标座位；
   * 表格未提到的座位保持原样。**整批只赋值一次 `plans`**，因此只有一次写盘 + 一次广播。
   *
   * 数据层兜底校验（组件已经校验过一遍，这里防其他入口绕过）：坐标非法 / 学生不存在 → 丢弃该条；
   * 整批内坐标或学生自相冲突 → **整批拒绝**，不改动任何数据。**失败一律不改数据。**
   */
  function applySeatImport(assignments: ReadonlyArray<SeatImportAssignment>): SeatImportOutcome {
    const plan = currentPlan.value
    if (!plan) return { ok: false, applied: 0, relocated: 0, reason: '当前没有座位方案' }

    const valid: SeatImportAssignment[] = []
    const seatsTaken = new Set<string>()
    const studentsTaken = new Set<string>()
    for (const item of assignments) {
      if (!isValidSeatPosition(item.row, item.col, config)) continue
      if (!item.studentId || !activeStudentIds.has(item.studentId)) continue
      const seatKey = getSeatKey(item.row, item.col)
      if (seatsTaken.has(seatKey) || studentsTaken.has(item.studentId)) {
        return { ok: false, applied: 0, relocated: 0, reason: '导入数据自相冲突，已取消本次导入' }
      }
      seatsTaken.add(seatKey)
      studentsTaken.add(item.studentId)
      valid.push(item)
    }
    if (valid.length === 0) {
      return { ok: false, applied: 0, relocated: 0, reason: '没有可应用的座位' }
    }

    /** 目标座位 id → 学生；以及本次被指派的学生集合（用于释放他们原来的座位） */
    const assignmentBySeat = new Map<string, string>()
    for (const item of valid) assignmentBySeat.set(getSeatKey(item.row, item.col), item.studentId)
    const assignedStudents = new Set(valid.map((item) => item.studentId))

    /** 导入前的「学生 → 座位」快照：用于统计真正换了座位的人数 */
    const before = new Map<string, string>()
    for (const seat of plan.seats) {
      if (seat.studentId && !before.has(seat.studentId)) before.set(seat.studentId, seat.id)
    }

    const seats = plan.seats.map((seat) => {
      const nextStudentId = assignmentBySeat.get(seat.id)
      if (nextStudentId !== undefined) {
        return seat.studentId === nextStudentId ? seat : { ...seat, studentId: nextStudentId }
      }
      // 未在导入范围内的座位：其上的学生本次被安排到了别处 → 释放原座位
      if (seat.studentId && assignedStudents.has(seat.studentId)) {
        return { ...seat, studentId: undefined }
      }
      return seat
    })

    const relocated = valid.filter(
      (item) => before.get(item.studentId) !== getSeatKey(item.row, item.col),
    ).length
    // 导入同样改变座位位置（§4.1：其他会改变座位位置的操作都属于本轮修改），
    // 校验通过、整批应用之前拍下本轮起点
    captureSessionBaseline()
    const now = new Date().toISOString()
    plans.value = plans.value.map((item) =>
      item.id === plan.id ? { ...item, updatedAt: now, seats } : item,
    )
    // 导入是整表改写，与「本次调整」（描述导入前的排法）不再相关，清掉避免误存
    clearCurrentLogs()
    return { ok: true, applied: valid.length, relocated }
  }

  /** 约束条目总数（恢复时用于发现 normalize 静默丢掉的非法条目） */
  function constraintCountOf(constraints: SeatPlanConstraints): number {
    return (
      constraints.sameDeskForbidden.length +
      constraints.adjacentGroupForbidden.length +
      constraints.frontRowStudents.length +
      constraints.backRowStudents.length
    )
  }

  /**
   * 按一份 Excel 座位图**新建座位表并切换过去**（唯一落库入口）。
   *
   * 与 `applySeatImport` 的区别：座位图描述的是一整张表，所以不往当前方案上打补丁，
   * 而是新建方案——**现有所有座位表原样保留**，当前方案为哪一张都不影响导入。
   * 新表名取自 Excel 文件名（`baseName`），与现有方案重名时由 `nextUniquePlanName` 加序号。
   *
   * 数据层兜底校验（弹窗已经用 `planSeatMapImport` 校验过一遍，这里防其他入口绕过）：
   * 坐标越界 / 固定空位有人 / 学生不在名单 / 坐标或学生重复 / 约束引用失效 →
   * **整批拒绝，不改动任何数据**。允许零名学生（整张空座位表也是合法状态）。
   */
  function createPlanFromSeatMap(input: SeatMapImportInput): SeatMapImportOutcome {
    const reject = (reason: string): SeatMapImportOutcome => ({ ok: false, applied: 0, reason })

    const valid: SeatImportAssignment[] = []
    const seatsTaken = new Set<string>()
    const studentsTaken = new Set<string>()
    for (const item of input.assignments) {
      if (!isValidSeatPosition(item.row, item.col, config)) {
        return reject(`座位图包含越界座位（第 ${item.row} 排第 ${item.col} 列），已取消本次导入`)
      }
      if (isFixedEmptySeat(item.row, item.col, config)) {
        return reject(
          `座位图把学生安排在固定空位（第 ${item.row} 排第 ${item.col} 列），已取消本次导入`,
        )
      }
      if (!item.studentId || !activeStudentIds.has(item.studentId)) {
        return reject('座位图包含不在学生名单中的学生，已取消本次导入')
      }
      const seatKey = getSeatKey(item.row, item.col)
      if (seatsTaken.has(seatKey) || studentsTaken.has(item.studentId)) {
        return reject('座位图自相冲突（座位或学生重复），已取消本次导入')
      }
      seatsTaken.add(seatKey)
      studentsTaken.add(item.studentId)
      valid.push(item)
    }

    let constraints: SeatPlanConstraints | undefined
    if (input.constraints !== undefined) {
      constraints = normalizeSeatPlanConstraints(input.constraints)
      if (constraintCountOf(constraints) !== constraintCountOf(input.constraints)) {
        return reject('座位图里的排座约束包含无效条目，已取消本次导入')
      }
      const refsValid =
        constraints.sameDeskForbidden.every(
          (rule) => activeStudentIds.has(rule.studentA) && activeStudentIds.has(rule.studentB),
        ) &&
        constraints.adjacentGroupForbidden.every((rule) =>
          rule.students.every((id) => activeStudentIds.has(id)),
        ) &&
        constraints.frontRowStudents.every((id) => activeStudentIds.has(id)) &&
        constraints.backRowStudents.every((id) => activeStudentIds.has(id))
      if (!refsValid) {
        return reject('座位图里的排座约束引用了不在学生名单中的学生，已取消本次导入')
      }
    }

    const created = createPlanFromSeats(
      valid,
      nextUniquePlanName(input.baseName ?? ''),
      constraints,
    )
    return {
      ok: true,
      planId: created.id,
      planName: created.name,
      applied: valid.length,
    }
  }

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
    // V1.1.2 Phase 1：方案级排座约束 + Excel 座位导入
    currentConstraints,
    constraintReport,
    /**
     * 整份约束写回当前方案（v3.3.1 起对外）：座位页「更多 → 复制方案」要把原方案的
     * 约束一次性搬到副本上，逐条走 addSameDeskForbidden / setRowPreference 会产生
     * N 次写盘与 N 次广播。单条增删仍走下面的细分 action（它们自带去重与可读原因）。
     */
    writeConstraints,
    addSameDeskForbidden,
    removeSameDeskForbidden,
    addAdjacentGroupForbidden,
    removeAdjacentGroupForbidden,
    setRowPreference,
    applySeatImport,
    // 座位图 → 新建座位表并切换（现有方案原样保留）
    createPlanFromSeatMap,
    createPlan,
    createPlanFromSeats,
    nextUniquePlanName,
    nextRotateName,
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
    // v3.7.5（§4.1）：撤销「本轮修改」——快照只读暴露给页面确认弹窗数人数
    canUndoSession,
    sessionChangedStudentIds,
    undoSession,
  }
})
