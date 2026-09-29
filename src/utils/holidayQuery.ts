/**
 * 假期名单的筛选与批量登记计划（v3.6.1）——纯函数，node 环境可直接喂数组跑测试。
 *
 * 两件事都在这里，因为它们是同一个承诺的两面：**「批量只改选中的学生」**。
 * `filterRoster` 决定教师在屏幕上看到谁，`planStatusChange` 决定点下按钮后到底动了谁——
 * 后者只认传入的学生，看不见的学生一个都不会被碰到（这是 v3.6.1 规格第 5 节的硬要求，
 * 也是最容易在实现里悄悄破掉的一条）。
 */
import { queryStudents } from '@/utils/studentQuery'
import type { Gender, Student } from '@/types'
import type { FamilyScope } from '@/types'
import type { HolidayStatus } from '@/types/holiday'

/**
 * 名单筛选条件（五组，**全部 AND 组合**）。
 *
 * 每一组「不选」就是 `undefined`，而不是某个「全部」的取值——「全部」是一个界面概念，
 * 落到数据上就是「这条不加限制」，不需要第六个枚举值参与比较。
 *
 * 与 v3.6.1 规格的一处**故意收窄**：这里没有「假期」这一组。假期由页面上下文决定
 * （正在看哪个假期就筛哪个），把它放进筛选条件会让「当前名单」出现第二个来源。
 */
export interface HolidayRosterFilters {
  /** 姓名（也含学号、电话、备注等，走 `queryStudents` 的全字段搜索） */
  keyword: string
  gender?: Gender
  /** 家庭所在地（学生档案的返家范围） */
  scope?: FamilyScope
  /** 昌都市内亲属：true = 有，false = 无，undefined = 不限 */
  relative?: boolean
  /** 登记状态：home / stay / unregistered，undefined = 全部 */
  status?: HolidayStatus
}

/** 名单里的一行：学生 + 他在当前假期的去向 */
export interface HolidayRosterRow {
  student: Student
  status: HolidayStatus
}

/**
 * 按条件筛出名单（**在读学生**，学号升序）。
 *
 * 姓名/性别两组直接复用 `queryStudents`——它是全应用唯一一份搜索与排序口径，
 * 假期名单自己再写一遍 `includes` 迟早会与「我的学生」页搜出不一样的结果（§11.1）。
 * 其余三组是假期名单特有的，在这里叠加；叠加顺序不影响结果（AND 可交换），
 * 按「界面上的顺序」写只是为了对着筛选抽屉能逐条核过去。
 *
 * 每次都调一次 `statusOf` 而不是让调用方先建表：命中率在几十人的量级上不是问题，
 * 而少一层「调用方得先准备好表」的隐式约定，就少一个调用点忘了准备的机会。
 */
export function filterRoster(
  students: readonly Student[],
  filters: HolidayRosterFilters,
  statusOf: (studentId: string) => HolidayStatus,
): HolidayRosterRow[] {
  const matched = queryStudents(students, { keyword: filters.keyword, gender: filters.gender })
  return matched
    .filter((student) => (filters.scope ? student.familyLocation?.scope === filters.scope : true))
    .filter((student) =>
      filters.relative === undefined ? true : student.hasChangduRelative === filters.relative,
    )
    .filter((student) => (filters.status ? statusOf(student.id) === filters.status : true))
    .map((student) => ({ student, status: statusOf(student.id) }))
}

/* ---------- 批量登记计划 ---------- */

/** 计划里一个学生当前的处境（由 store 从三态与本模块的两份记录表里取出来） */
export interface StatusPlanInput {
  studentId: string
  /** 该生**当前**在这个假期里的去向 */
  status: HolidayStatus
  /** 老键（`teacherdesk:weekendReturns`）里该生该周末那条**回家**记录的 id；不是周末 / 没有时为 undefined */
  weekendRecordId?: string
  /** 新键里该生在该假期的那条记录 id（周末只可能是留校那条） */
  holidayRecordId?: string
}

/** 批量登记的落库计划：先删后建，每一侧各是一次数组替换 */
export interface StatusPlan {
  /**
   * 要经老键「设为回家」的学生。**只有周末的回家走这条**——
   * 周末的回家记录继续住在老键里（v3.6.1 的结构性决定，见 types/holiday.ts 顶部说明），
   * 于是 `weekendStore.addReturns` 那条既有路径原样复用，旧版本客户端在混合期也仍读得对。
   */
  addWeekend: string[]
  /** 要在新键新建的记录（自定义假期的回家与留校、周末的留校） */
  create: { studentId: string; returnHome: boolean }[]
  /** 要删除的既有记录 */
  remove: { recordId: string; source: 'weekend' | 'holiday' }[]
  /** 被改动的学生「原来」各是什么状态——确认文案「其中 3 人原为回家」用它，不在页面上再数一遍 */
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
 *    由此「既回家又留校」这种影子状态在一名学生身上不可能被制造出来。
 *
 * 「回家优先」的遮蔽规则（见 `utils/holiday.ts` 的 `statusOf`）不在这里处理：
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
    fromCounts: { home: 0, stay: 0, unregistered: 0 },
  }

  for (const input of inputs) {
    if (input.status === target) continue
    plan.fromCounts[input.status] += 1

    if (input.weekendRecordId) {
      plan.remove.push({ recordId: input.weekendRecordId, source: 'weekend' })
    }
    if (input.holidayRecordId) {
      plan.remove.push({ recordId: input.holidayRecordId, source: 'holiday' })
    }
    if (target === 'unregistered') continue

    if (options.isWeekend && target === 'home') {
      plan.addWeekend.push(input.studentId)
    } else {
      plan.create.push({ studentId: input.studentId, returnHome: target === 'home' })
    }
  }

  return plan
}

/** 计划是否什么都不做（幂等的判定出口，页面据此跳过确认弹窗与提示） */
export function isEmptyPlan(plan: StatusPlan): boolean {
  return plan.addWeekend.length === 0 && plan.create.length === 0 && plan.remove.length === 0
}
