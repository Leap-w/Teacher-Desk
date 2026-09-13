import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { useNow } from '@/composables/useToday'
import { weekendRepository, reviveReturns } from '@/repositories/weekend/weekendRepository'
import { useStudentStore } from '@/stores/student'
import { addDaysToDateKey, formatDateKey } from '@/utils/date'
import { createId } from '@/utils/id'
import { formatStudentShortName, refreshStudentNames } from '@/utils/student'
import { currentWeekendKey, isWeekendKey, sortWeekendReturns } from '@/utils/weekend'
import type { Student } from '@/types'
import type { WeekendReturnRecord } from '@/types/weekend'

/**
 * 姓名快照维护已抽到公共件（Phase 7B：与请假记录共用同一份口径，
 * 见 `utils/student.ts` 的 `refreshStudentNames`）——本模块只做一次类型收窄。
 */
function withStudentNames(
  records: WeekendReturnRecord[],
  students: Student[],
): WeekendReturnRecord[] {
  return refreshStudentNames(records, students)
}

/**
 * 周末返家（Phase 7B）：返家记录的唯一读写入口。
 * 数据源：`teacherdesk:weekendReturns`（Pinia → localStorage，§3.2）。
 *
 * 边界（§2.2）：这里存的是**某个周末的行为结果**（谁返家），
 * 不是「谁可以返家」——能否返家从不落库，也不由学生档案的返家范围推导。
 *
 * 与请假的差异（Phase 7B 需求方拍板）：**不设审批**（记录建了就是定了）、
 * **不记时长与离校 / 返校时间**。留校不落库——「本周末留校 M 人」由
 * 「在读学生数 − 这一期仍在读的返家人数」派生，**减的是仍在读的人而不是记录条数**：
 * 已从档案删除的学生记录会保留（历史不该被抹掉），但他不算班里的在校生。
 *
 * **所有计数一律「只算在读学生」**（Phase 8 统一）：返家人数、切换条上每期的人数、
 * 本周末人数、本月人次都只数在 `activeStudents` 里的记录；已退档学生的记录**仍列在名单里**
 * （周末页会标注「已不在档案」）但**不计入任何数**。这条口径只能有一份实现——
 * 工作台的「班级概况」卡片会把在读人数与留校人数挨着显示，若两张卡各按各的口径算，
 * 教师会看到「在读 5 人 / 留校 4 人」与「本周末返家 2 人」这种加起来超过班级人数的画面。
 * 因此留校派生进本 store（Phase 7B 时它只在周末页里算，Phase 8 出现第二个消费方后上收）。
 *
 * 与请假一致的两处：学生被删除时记录保留（姓名快照冻结）；同一学生同一周末只有一条记录。
 */
export const useWeekendStore = defineStore('weekend', () => {
  /** 学生 store 同步实例化：供姓名快照刷新与新增时取学生用 */
  const studentStore = useStudentStore()
  const now = useNow()

  /** 在读学生 id 集合：本 store 所有计数的唯一分母（顶部说明的那条口径就落在这里） */
  const activeIdSet = computed(() => new Set(studentStore.activeStudents.map((item) => item.id)))

  const records = ref<WeekendReturnRecord[]>(
    withStudentNames(weekendRepository.load(studentStore.students), studentStore.students),
  )

  // 写盘 + 跨标签页同步（Phase 9A）：本页改动写盘后广播键名，别的入口改了则重读并规范化。
  // 归一化里带上姓名快照刷新，与首屏加载那条路径**给出一致的结果**（同 `stores/leave.ts` 的说明）
  weekendRepository.bind(records, (raw) =>
    withStudentNames(reviveReturns(raw), studentStore.students),
  )

  /** 今天（日期键）、本周末与下周末（周六键），与工作台 / 课表同一个共享时钟 */
  const todayKey = computed(() => formatDateKey(now.value))
  const currentWeekend = computed(() => currentWeekendKey(todayKey.value))
  const nextWeekend = computed(() => addDaysToDateKey(currentWeekend.value, 7))

  /**
   * 某个周末**仍在读**的返家人数：切换条每期的人数、页头「本周末返家 N 人」、工作台卡片都用它。
   * 已退档学生的记录仍列在名单里（历史不该被抹掉），但**不计入任何人数**——
   * 留校是「在读学生数 − 这一期仍在读的返家人数」，把退档的记录算进来会让两者超过班级人数。
   *
   * 从「各周末人数表」改成一期一问：表与函数各数一遍，迟早会在「退档算不算」上分叉（§11.1）。
   * 调用点最多是切换条那一排（十来项 × 每条几十条记录），不值得为此再建一张表。
   */
  function returnedCountOf(weekendKey: string): number {
    const active = activeIdSet.value
    return records.value.filter(
      (item) => item.weekendDate === weekendKey && active.has(item.studentId),
    ).length
  }

  /**
   * 某个周末的留校人数（**派生，永不落库**）：在读学生数 − 这一期仍在读的返家人数。
   * 只有「返家」是行为事实（§2.2），留校是它在这个班里的补集。
   *
   * 不必夹 `Math.max(0, …)`：同一学生同一周末只有一条记录（load 时按「学生 + 周末」去重、
   * `addReturns` 跳过已登记的），所以仍在读的返家人数不会超过在读学生数。
   * 应用内唯一的旁路写入是工具箱的「合并导入」，它写盘后必定整页 reload——重复项
   * 会在那一次 load 的去重里清掉，不会留到计数这一步。
   */
  function stayCountOf(weekendKey: string): number {
    return studentStore.activeStudents.length - returnedCountOf(weekendKey)
  }

  /**
   * 某个周末**已不在档案**的返家登记条数。
   * 这些记录照常列在名单里并标注「已不在档案」，但不在任何人数里；
   * 页面把条数说出来，教师才不会以为记录丢了（§11.1「界面口径别比实现乐观」）。
   */
  function staleCountOf(weekendKey: string): number {
    return (
      records.value.filter((item) => item.weekendDate === weekendKey).length -
      returnedCountOf(weekendKey)
    )
  }

  /**
   * 页面可切换的周末：**所有已有记录的周末 ∪ 本周末 ∪ 下周末**，按时间倒序（近的在前）。
   * 不做「前后 N 周」的固定窗口：窗口之外的记录会变成翻不到的孤儿，
   * 而这样列出来的每一项要么有数据、要么是教师接下来真要登记的那两个周末。
   */
  const weekendKeys = computed(() => {
    const keys = new Set<string>(records.value.map((item) => item.weekendDate))
    keys.add(currentWeekend.value)
    keys.add(nextWeekend.value)
    return [...keys].sort((a, b) => b.localeCompare(a))
  })

  /**
   * 某个周末的**完整**返家名单（按姓名升序），含已退档学生的历史记录。
   * 周末页的名单与撤销入口都用它——历史要看得见；**人数一律走 `returnedCountOf`**，
   * 谁需要「N 人 + 名字对得上」就用 `currentReturns`（在读子集）。
   */
  function listReturns(weekendKey: string): WeekendReturnRecord[] {
    return sortWeekendReturns(records.value.filter((item) => item.weekendDate === weekendKey))
  }

  /**
   * 某个周末**已登记过的学生 id**。
   * 「一个学生一个周末只有一条记录」这条口径的唯一来源：登记抽屉用它把已登记的人
   * 显示成已勾选且不可再选，`addReturns` 用它跳过重复登记——两处同源，不会一边放开一边拒绝。
   */
  function registeredIdsOf(weekendKey: string): Set<string> {
    return new Set(
      records.value.filter((item) => item.weekendDate === weekendKey).map((item) => item.studentId),
    )
  }

  /**
   * 本周末**计入人数**的返家名单（工作台卡片用）：只含仍在读的学生。
   * 与 `listReturns` 的分工——那个是**完整名单**（周末页要把已退档的历史记录也列出来并标注），
   * 这个只服务「N 人」与后面的名字必须对得上的地方：卡片上徽标数了几个人，
   * 下面的名字就该有几个，否则同一张卡自己跟自己打架。
   */
  const currentReturns = computed(() =>
    listReturns(currentWeekend.value).filter((item) => activeIdSet.value.has(item.studentId)),
  )

  /** 本周末返家人数（周末页页头与工作台卡片共用；与 `currentReturns` 同源，不会一个算退档一个不算） */
  const currentCount = computed(() => currentReturns.value.length)

  /** 本周末留校人数（派生）：与上面那个数同源——「留校 + 返家 = 在读人数」，工作台两块卡片才不会互相打脸 */
  const currentStayCount = computed(() => stayCountOf(currentWeekend.value))

  /**
   * 本月返家人次：**周末落在本月、且学生仍在读**的记录数（按周末的周六日期键归月，
   * 跨月的那一周算在周六所在的月）。与请假的「本月已批准 N 人次」同口径：
   * 同一个人本月返家两次记两人次。
   */
  const monthReturnCount = computed(() => {
    const monthPrefix = formatDateKey(now.value).slice(0, 7)
    const active = activeIdSet.value
    return records.value.filter(
      (item) => item.weekendDate.startsWith(monthPrefix) && active.has(item.studentId),
    ).length
  })

  // 学生改名 / 补学号后同步快照（只监听姓名与学号，换座位之类的改动不触发）
  watch(
    () => studentStore.students.map((item) => `${item.id}|${item.name}|${item.studentNo}`),
    () => {
      records.value = withStudentNames(records.value, studentStore.students)
    },
  )

  /**
   * 批量登记返家：为若干学生在某个周末各建一条记录，返回**实际新增的条数**（0 = 一条也没加）。
   *
   * 只加不删：已登记过的学生直接跳过（同一学生同一周末**永远只有一条记录**，判定见 registeredIdsOf），
   * 不在档案里的学生跳过（表单只列在读学生，此处防其他写入入口绕过，§8 审查口径）。
   * 想撤销某条登记由页面上的删除按钮负责——不做「勾选即同步」的覆盖式写入：
   * 那会把「学生已被删除、档案里选不到」的历史记录一并抹掉（与请假保留快照的口径冲突）。
   *
   * 返回值说明：这是**计数型批量写**，不是单个写入的 `undefined` / `false` 契约（§3.1）——
   * 批量登记没有「被拒」这一说，跳过若干人后其余照常写入。因此 `0` 只表示「这次一条也没加」，
   * **不含原因**：既可能是都登记过了，也可能是名单里混进了已删除的学生。提示文案不要替它断言
   * 是哪一个（本项目已三次复发「界面口径比实现乐观」，§11.1）。
   */
  function addReturns(weekendKey: string, studentIds: string[]): number {
    if (!isWeekendKey(weekendKey)) return 0
    const registered = registeredIdsOf(weekendKey)
    const added: WeekendReturnRecord[] = []
    const createdAt = new Date().toISOString()
    for (const id of studentIds) {
      if (typeof id !== 'string' || !id || registered.has(id)) continue
      const student = studentStore.activeStudents.find((item) => item.id === id)
      if (!student) continue
      registered.add(id)
      added.push({
        id: createId(),
        studentId: student.id,
        studentName: formatStudentShortName(student),
        weekendDate: weekendKey,
        createdAt,
      })
    }
    if (added.length === 0) return 0
    records.value = [...records.value, ...added]
    return added.length
  }

  /** 撤销一条返家登记（本地单人数据，无软删 / 回收站，与请假删除同口径）；目标不存在返回 false */
  function removeReturn(id: string): boolean {
    const index = records.value.findIndex((item) => item.id === id)
    if (index === -1) return false
    records.value = [...records.value.slice(0, index), ...records.value.slice(index + 1)]
    return true
  }

  return {
    records,
    todayKey,
    currentWeekend,
    nextWeekend,
    weekendKeys,
    listReturns,
    returnedCountOf,
    stayCountOf,
    staleCountOf,
    registeredIdsOf,
    currentReturns,
    currentCount,
    currentStayCount,
    monthReturnCount,
    addReturns,
    removeReturn,
  }
})
