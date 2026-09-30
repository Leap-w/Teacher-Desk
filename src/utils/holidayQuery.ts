/**
 * 假期名单的筛选与批量登记计划（v3.6.2）——纯函数，node 环境可直接喂数组跑测试。
 *
 * 两件事都在这里，因为它们是同一个承诺的两面：**「批量只改选中的学生」**。
 * `filterRoster` 决定教师在屏幕上看到谁，`planStatusChange` 决定点下按钮后到底动了谁——
 * 后者只认传入的学生，看不见的学生一个都不会被碰到（这是 v3.6.1 规格第 5 节的硬要求，
 * 也是最容易在实现里悄悄破掉的一条）。
 *
 * ## v3.6.2 的两处变化
 *
 * ① **筛选多了「统计卡片」这一组**（`card`）：三张卡片是**快捷筛选入口**，
 *    点一下就只显示那一批人。它仍然只是「一条 AND 条件」，不发明「全部」这个取值——
 *    `undefined` 就是「不加限制」，连点两次当前卡片即回到 `undefined`（见页面）。
 * ② **去向只剩两个**（离校 / 留校）。「未登记」已从筛选、计划、确认文案里彻底删除。
 */
import { queryStudents } from '@/utils/studentQuery'
import type { FamilyScope, Gender, Student } from '@/types'
import type { HolidayStatus } from '@/types/holiday'

/**
 * 「昌都市外」这个返家范围的字面值（`FamilyScope` 的既有取值之一）。
 *
 * 第三张统计卡片与它的筛选都按它取数。**不修改 `FamilyScope` 的定义**（规格第 8 节），
 * 这里只是给它一个带名字的引用，别在几处各写一遍字符串字面量。
 */
export const OUTSIDE_CHANGDU_SCOPE: FamilyScope = 'outside-changdu'

/**
 * 顶部三张统计卡片对应的快捷筛选。
 *
 * 注意 `'outside'` **不是第三种状态**：它是「离校 ∩ 昌都市外」，是离校里的一维。
 */
export type HolidayCardFilter = 'home' | 'stay' | 'outside'

/**
 * 名单筛选条件（五组，**全部 AND 组合**）。
 *
 * 每一组「不选」就是 `undefined`，而不是某个「全部」的取值——「全部」是一个界面概念，
 * 落到数据上就是「这条不加限制」，不需要第六个枚举值参与比较。
 *
 * 与 v3.6.1 规格的一处**故意收窄**：这里没有「假期」这一组。假期由页面上下文决定
 * （正在看哪个假期就筛哪个），把它放进筛选条件会让「当前名单」出现第二个来源。
 *
 * v3.6.2 把原来的 `status` 换成了 `card`：去向的筛选入口统一收进顶部三张卡片，
 * 筛选抽屉里不再有第二套「登记状态」（两套状态筛选并存时，教师会看不出名单到底被谁筛过）。
 */
export interface HolidayRosterFilters {
  /** 姓名（也含学号、电话、备注等，走 `queryStudents` 的全字段搜索） */
  keyword: string
  gender?: Gender
  /** 家庭所在地（学生档案的返家范围） */
  scope?: FamilyScope
  /** 昌都市内亲属：true = 有，false = 无，undefined = 不限 */
  relative?: boolean
  /** 统计卡片快捷筛选；undefined = 全部学生 */
  card?: HolidayCardFilter
}

/** 名单里的一行：学生 + 他在当前假期的去向 + 学生级假期备注 */
export interface HolidayRosterRow {
  student: Student
  status: HolidayStatus
  /** 该生在当前假期的备注（trim 过；没有备注就是空串） */
  note: string
}

/** 一条条件是否命中（`card` 的三档判断只有这一处） */
function matchesCard(
  student: Student,
  status: HolidayStatus,
  card: HolidayCardFilter | undefined,
): boolean {
  if (card === undefined) return true
  if (card === 'stay') return status === 'stay'
  if (card === 'outside') {
    return status === 'home' && student.familyLocation?.scope === OUTSIDE_CHANGDU_SCOPE
  }
  return status === 'home'
}

/**
 * 按条件筛出名单（**在读学生**，学号升序）。
 *
 * 姓名/性别两组直接复用 `queryStudents`——它是全应用唯一一份搜索与排序口径，
 * 假期名单自己再写一遍 `includes` 迟早会与「我的学生」页搜出不一样的结果（§11.1）。
 * 其余几组是假期名单特有的，在这里叠加；叠加顺序不影响结果（AND 可交换），
 * 按「界面上的顺序」写只是为了对着筛选抽屉能逐条核过去。
 *
 * 每次都调一次 `statusOf` 而不是让调用方先建表：命中率在几十人的量级上不是问题，
 * 而少一层「调用方得先准备好表」的隐式约定，就少一个调用点忘了准备的机会。
 * `noteOf` 同理（缺省没有备注），页面把 store 的备注查表递进来即可。
 */
export function filterRoster(
  students: readonly Student[],
  filters: HolidayRosterFilters,
  statusOf: (studentId: string) => HolidayStatus,
  noteOf: (studentId: string) => string = () => '',
): HolidayRosterRow[] {
  const matched = queryStudents(students, { keyword: filters.keyword, gender: filters.gender })
  return matched
    .filter((student) => (filters.scope ? student.familyLocation?.scope === filters.scope : true))
    .filter((student) =>
      filters.relative === undefined ? true : student.hasChangduRelative === filters.relative,
    )
    .filter((student) => matchesCard(student, statusOf(student.id), filters.card))
    .map((student) => ({ student, status: statusOf(student.id), note: noteOf(student.id) }))
}

/* ---------- 全选（规格第 10–13 节） ---------- */

/**
 * 全选复选框的三态：未选 / 部分选中 / 全部选中。
 * 判据永远是**当前筛选结果**（`visibleIds`），不是全班。
 */
export type SelectAllState = 'none' | 'partial' | 'all'

/**
 * 三态判定。`visibleIds` 为空（当前筛选没有人）时返回 `none`——
 * 这时「全选」没有可作用的对象，勾选框就该是空的。
 */
export function selectAllState(
  visibleIds: readonly string[],
  selectedIds: ReadonlySet<string>,
): SelectAllState {
  if (visibleIds.length === 0) return 'none'
  let hit = 0
  for (const id of visibleIds) if (selectedIds.has(id)) hit += 1
  if (hit === 0) return 'none'
  return hit === visibleIds.length ? 'all' : 'partial'
}

/**
 * 点「全选 / 取消全选」之后的新选中集合。
 *
 * - 全部选中 → 只把**当前筛选结果**里的那些 id 移除（选中跨筛选保留，
 *   看不见的那批不该被这一次点击顺手清掉）；
 * - 否则 → 把当前筛选结果整个并进来（**只作用于当前结果**，不碰其他批次）。
 *
 * 返回新集合而不是原地改，调用方一句 `selectedIds.value = ...` 就落定（同其余多选动作）。
 */
export function toggleSelectAll(
  visibleIds: readonly string[],
  selectedIds: ReadonlySet<string>,
): Set<string> {
  const next = new Set(selectedIds)
  const all = selectAllState(visibleIds, selectedIds) === 'all'
  for (const id of visibleIds) {
    if (all) next.delete(id)
    else next.add(id)
  }
  return next
}

/* ---------- 批量登记计划 ---------- */

/** 计划里一个学生当前的处境（由 store 从二态与本模块的两份记录表里取出来） */
export interface StatusPlanInput {
  studentId: string
  /** 该生**当前**在这个假期里的去向 */
  status: HolidayStatus
  /** 老键（`teacherdesk:weekendReturns`）里该生该周末那条**离校**记录的 id；不是周末 / 没有时为 undefined */
  weekendRecordId?: string
  /** 新键里该生在该假期的那条记录 id（周末的只可能是留校 / 备注影子） */
  holidayRecordId?: string
  /** 那条新键记录上的学生级备注（改向时要跟着人走，不能因为改状态就丢掉） */
  note?: string
}

/** 批量登记的落库计划：先删后建，每一侧各是一次数组替换 */
export interface StatusPlan {
  /**
   * 要经老键「设为离校」的学生。**只有周末的离校走这条**——
   * 周末的离校记录继续住在老键里（v3.6.1 的结构性决定，见 types/holiday.ts 顶部说明），
   * 于是 `weekendStore.addReturns` 那条既有路径原样复用，旧版本客户端在混合期也仍读得对。
   */
  addWeekend: string[]
  /** 要在新键新建的记录（自定义假期的两种去向、周末的留校 / 备注影子） */
  create: { studentId: string; returnHome: boolean; note?: string }[]
  /** 要删除的既有记录 */
  remove: { recordId: string; source: 'weekend' | 'holiday' }[]
  /** 被改动的学生「原来」各是什么状态——确认文案「其中 3 人原为离校」用它，不在页面上再数一遍 */
  fromCounts: Record<HolidayStatus, number>
}

/**
 * 把「若干学生 → 某个去向」摊成一次可执行的增删清单。
 *
 * 三条不变量，逐条都有测试钉着：
 *
 * 1. **只认传进来的学生**。函数不知道「全班有多少人」，也没有任何按班级取数的入口，
 *    所以它不可能改到名单之外的人。
 * 2. **已是目标状态的人不进任何一侧**（开头的 `continue`）。同一个人重复点同一个按钮，
 *    计划恒为空 → 零写盘、零广播：批量动作因此是幂等的，不会每点一次就把两个键
 *    各推一次云、把跨端冲突面放大一轮。
 * 3. **先删后建**，且删得干净——因为已经排除了「状态相同」的人，此刻他名下**任何**
 *    既有记录都必然与目标不符，一律删除；留下的空缺由最后一步补上。
 *    由此「既离校又留校」这种影子状态在一名学生身上不可能被制造出来。
 *
 * **「留校」不写任何记录**（v3.6.2）：目标为留校时只会删掉他的离校事实，
 * 不会为了显示「留校」再建一条 `returnHome: false` 的记录——没有记录就是留校
 * （`utils/holiday.ts` 的 `statusOf`）。新键里唯一会为留校学生建的记录是**备注载体**
 * （`note` 非空时），它不参与状态推导。
 *
 * **学生级备注跟着人走**：改向时那条旧备注会原样落进新建 / 保留的记录里，
 * 不会因为「离校改留校」就把教师写的「由姐姐接回」丢掉。
 *
 * 「离校优先」的遮蔽规则（见 `utils/holiday.ts` 的 `statusOf`）不在这里处理：
 * 影子记录只被派生层忽略，不会被本函数顺手清掉——教师没点这个按钮，数据就不该动。
 */
export function planStatusChange(
  inputs: StatusPlanInput[],
  target: HolidayStatus,
  options: { isWeekend: boolean },
): StatusPlan {
  const plan: StatusPlan = {
    addWeekend: [],
    create: [],
    remove: [],
    fromCounts: { home: 0, stay: 0 },
  }

  for (const input of inputs) {
    if (input.status === target) continue
    plan.fromCounts[input.status] += 1

    const note = typeof input.note === 'string' ? input.note.trim() : ''
    if (input.weekendRecordId) {
      plan.remove.push({ recordId: input.weekendRecordId, source: 'weekend' })
    }
    if (input.holidayRecordId) {
      plan.remove.push({ recordId: input.holidayRecordId, source: 'holiday' })
    }

    if (options.isWeekend) {
      // 周末的离校事实只住在老键里；新键那条只为装备注
      if (target === 'home') plan.addWeekend.push(input.studentId)
      if (note) plan.create.push({ studentId: input.studentId, returnHome: false, note })
    } else {
      // 自定义假期：离校是一条落在新键上的事实；留校不需要记录，只有备注才落一条
      if (target === 'home') {
        plan.create.push({
          studentId: input.studentId,
          returnHome: true,
          ...(note ? { note } : {}),
        })
      } else if (note) {
        plan.create.push({ studentId: input.studentId, returnHome: false, note })
      }
    }
  }

  return plan
}

/** 计划是否什么都不做（幂等的判定出口，页面据此跳过确认弹窗与提示） */
export function isEmptyPlan(plan: StatusPlan): boolean {
  return plan.addWeekend.length === 0 && plan.create.length === 0 && plan.remove.length === 0
}
