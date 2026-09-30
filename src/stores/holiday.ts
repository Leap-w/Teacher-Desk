import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { useNow } from '@/composables/useToday'
import { holidayRepository } from '@/repositories/holiday/holidayRepository'
import { holidayRecordRepository } from '@/repositories/holiday/holidayRecordRepository'
import { useStudentStore } from '@/stores/student'
import { useWeekendStore } from '@/stores/weekend'
import { formatDateKey, isDateKey } from '@/utils/date'
import {
  buildHolidayEntries,
  buildStatusIndex,
  countHomeInScope,
  countStatuses,
  isWeekendHolidayId,
  pickCurrentEntry,
  recordPairKey,
  reviveHolidayRecords,
  reviveHolidays,
  statusOf,
  weekendHolidayId,
  weekendKeyOfHolidayId,
} from '@/utils/holiday'
import { OUTSIDE_CHANGDU_SCOPE, isEmptyPlan, planStatusChange } from '@/utils/holidayQuery'
import { createId } from '@/utils/id'
import { formatStudentShortName, refreshStudentNames } from '@/utils/student'
import type { Holiday, HolidayInput, HolidayRecord, HolidayStatus } from '@/types/holiday'
import type { Student } from '@/types'

/**
 * 姓名快照维护走公共件（与请假 / 周末返家同一份口径，见 `utils/student.ts`），
 * 这里只做一次类型收窄。
 */
function withStudentNames(records: HolidayRecord[], students: Student[]): HolidayRecord[] {
  return refreshStudentNames(records, students)
}

/**
 * 假期管理（v3.6.2）：**假期与假期登记的唯一读写入口**。
 *
 * 三份数据、三个键，合成一个 store：
 * - `teacherdesk:holidays`        自定义假期
 * - `teacherdesk:holidayRecords`  假期登记（含 v3.6.2 的学生级备注）
 * - `teacherdesk:weekendReturns`  **周末的离校记录（老键，本模块只读不写形状）**
 *
 * 为什么不是一个「HolidayStore + WeekendStore + HolidayRecordStore」的三件套：三者在同一个页面、
 * 同一份名单上被同时使用（一个学生的去向要同时看新键与老键），拆开就要互相 import 对方的 state
 * 才能回答「这个学生现在算什么」，反而把「一个口径一个来源」拆成三处。值日与班费同样是一个 store
 * 装多份数据。
 *
 * ## 周末为什么是两个键
 *
 * 周末在家列表里是一个**虚拟假期**（`id = 'weekend:<周六键>'`，由日期派生，不落库）。
 * 但它的记录**分两处装**：离校进老键，留校 / 备注进新键。理由见 `types/holiday.ts` 顶部的说明——
 * 老键的形状一旦被新字段污染，混合版本期间可能整批丢数据。由此带来本模块的两条读法：
 *
 * - **离校优先**：周末的某一期，老键里有这个学生的记录就是「离校」，哪怕新键里还有一条
 *   留校 / 备注影子。影子记录只被**遮蔽**（派生层忽略），不会自动清掉——教师没点按钮，数据就不该动。
 * - 老键的写入仍然只经 `weekendStore.addReturns` / `removeReturn`，本模块不碰它的形状。
 *
 * ## 二态（离校 / 留校）
 *
 * v3.6.2 删掉了 v3.6.1 的第三态「未登记」：**有离校记录就是离校，没有就是留校**
 * （`utils/holiday.ts` 的 `statusOf`）。于是「学生总数 = 离校 + 留校」恒成立，
 * 旧数据里那些「未登记」的学生升级后直接算留校，不迁移、不弹确认。
 *
 * 「留校」**不需要**一条记录（`setStatuses` 把某人设为留校时只删他的离校事实，不建新记录）：
 * 新键里那些 `returnHome: false` 的记录只有两个来源——**学生级备注**（备注必须挂在一条记录上，
 * 见 `setNote`），以及 v3.6.1 留下的存量记录（本版不做迁移去删它们）。
 *
 * **所有计数一律只算在读学生**（与请假 / 周末同一条纪律）：分母是 `activeStudents`，
 * 已退档学生的记录仍能读出来（历史不该被抹掉，页面用 stale 计数说出来），但不进任何人数。
 */
export const useHolidayStore = defineStore('holiday', () => {
  const studentStore = useStudentStore()
  const weekendStore = useWeekendStore()
  const now = useNow()

  const holidays = ref<Holiday[]>(holidayRepository.load())
  const records = ref<HolidayRecord[]>(
    withStudentNames(holidayRecordRepository.load(), studentStore.students),
  )

  // 写盘 + 跨标签页同步 + 云端同步（两个键各注册一次，与其余模块同一套纪律）
  holidayRepository.bind(holidays, reviveHolidays)
  holidayRecordRepository.bind(records, (raw) =>
    withStudentNames(reviveHolidayRecords(raw), studentStore.students),
  )

  /** 今天（共享时钟，跨零点自动翻篇） */
  const todayKey = computed(() => formatDateKey(now.value))

  /** 名单的分母：在读学生。已退档学生的记录照常读出，但**不进任何人数** */
  const activeStudents = computed(() => studentStore.activeStudents)
  const activeIdSet = computed(() => new Set(activeStudents.value.map((item) => item.id)))

  /**
   * 列表里要出现的周末：**老键有记录的 ∪ 新键有登记的 ∪ 本周末 ∪ 下周末**。
   *
   * 前两项缺一不可——只取老键那份（`weekendStore.weekendKeys`），一个「全员留校、
   * 无一人离校」的周末就会因为没有离校记录而从列表里消失，而它恰恰是教师刚登记过的那一期。
   */
  const weekendKeys = computed(() => {
    const keys = new Set<string>(weekendStore.weekendKeys)
    for (const record of records.value) {
      const weekendKey = weekendKeyOfHolidayId(record.holidayId)
      if (weekendKey) keys.add(weekendKey)
    }
    return [...keys].sort((a, b) => b.localeCompare(a))
  })

  /** 页面列表：自定义假期 ∪ 虚拟周末，按对今天的相关性排序（正在放 → 还没到 → 已过去） */
  const entries = computed(() =>
    buildHolidayEntries(holidays.value, weekendKeys.value, todayKey.value),
  )

  /** 打开页面时的默认项：今天落在哪个自定义假期就看它，否则本周末 */
  const currentEntry = computed(() => pickCurrentEntry(entries.value, todayKey.value))

  /** 新键登记的状态查表（`学生 + 假期` → 是否离校），每次改动后重算一次 */
  const statusIndex = computed(() => buildStatusIndex(records.value))

  /** 学生级备注查表（`学生 + 假期` → 备注），名单逐行取用时不必各自 find 一遍 */
  const noteIndex = computed(() => {
    const index = new Map<string, string>()
    for (const record of records.value) {
      if (record.note) index.set(recordPairKey(record.holidayId, record.studentId), record.note)
    }
    return index
  })

  /** 列表里所有假期的 id（含虚拟周末）——孤儿判定用 */
  const knownHolidayIds = computed(() => new Set(entries.value.map((entry) => entry.holiday.id)))

  /* ---------- 二态 ---------- */

  /** 周末专属：老键里这一期已离校的学生 id；自定义假期返回 undefined（老键只在周末参与判定） */
  function weekendRegisteredOf(holidayId: string): Set<string> | undefined {
    const weekendKey = weekendKeyOfHolidayId(holidayId)
    return weekendKey ? weekendStore.registeredIdsOf(weekendKey) : undefined
  }

  /**
   * 某个学生在某个假期里的去向。**全应用唯一的判定出口**——名单、计数、导出、
   * 首页卡片都走它，不各自拼一遍「先查这个键再查那个键」（§11.1）。
   */
  function statusIn(holidayId: string, studentId: string): HolidayStatus {
    return statusOf(holidayId, studentId, statusIndex.value, weekendRegisteredOf(holidayId))
  }

  /**
   * 某个学生的二态人数。分母一律在读学生，两数之和恒等于在读人数。
   */
  function countsOf(holidayId: string): Record<HolidayStatus, number> {
    return countStatuses(
      holidayId,
      activeStudents.value.map((item) => item.id),
      statusIndex.value,
      weekendRegisteredOf(holidayId),
    )
  }

  /**
   * 第三张统计卡片的人数：**离校 ∩ 昌都市外**（规格第 7 节）。
   *
   * 它不是第三种状态，只是「离校」里的一个筛选维度，所以这里复用同一个
   * `statusOf` 出口（`countHomeInScope`），不另写一套判定。
   */
  function outsideHomeCountOf(holidayId: string): number {
    return countHomeInScope(
      holidayId,
      activeStudents.value,
      statusIndex.value,
      OUTSIDE_CHANGDU_SCOPE,
      weekendRegisteredOf(holidayId),
    )
  }

  /** 某个学生在这个假期里的备注（没有就是空串） */
  function noteIn(holidayId: string, studentId: string): string {
    return noteIndex.value.get(recordPairKey(holidayId, studentId)) ?? ''
  }

  /**
   * 这个假期有没有任何登记（含老键里的周末离校）。
   * 首页那张卡片用它区分「教师已经登记过这一期」与「这一期一个人都没动过」——
   * 计数现在是「离校 + 留校 = 全班」，光看数字分不出这两种情况。
   */
  function hasRegistrationsOf(holidayId: string): boolean {
    if (records.value.some((item) => item.holidayId === holidayId)) return true
    const weekendKey = weekendKeyOfHolidayId(holidayId)
    if (!weekendKey) return false
    return weekendStore.records.some((item) => item.weekendDate === weekendKey)
  }

  /**
   * 某个假期下**已不在档案**的登记条数（老键与新键都算）。
   * 页面把它说出来，教师才不会以为记录丢了（§11.1「界面口径别比实现乐观」）。
   */
  function staleCountOf(holidayId: string): number {
    const active = activeIdSet.value
    let count = records.value.filter(
      (item) => item.holidayId === holidayId && !active.has(item.studentId),
    ).length
    const weekendKey = weekendKeyOfHolidayId(holidayId)
    if (weekendKey) {
      count += weekendStore.records.filter(
        (item) => item.weekendDate === weekendKey && !active.has(item.studentId),
      ).length
    }
    return count
  }

  /**
   * 本月**离校**人次：老键里周末落在本月的离校记录 ＋ 新键里 `returnHome` 且代表日在本月的记录，
   * 都只算在读学生，最后按「学生 + 假期」去重。
   *
   * 为什么要去重：正常情况下同一个学生同一个假期只可能在一处有记录（写入动作保证互斥），
   * 但跨版本 / 跨端合并期间可能两边各留一条。不去重的话，一次合并就会让本月人次凭空多出一截。
   */
  const monthHomeCount = computed(() => {
    const monthPrefix = todayKey.value.slice(0, 7)
    const active = activeIdSet.value
    const seen = new Set<string>()
    let count = 0
    for (const record of weekendStore.records) {
      if (!active.has(record.studentId) || !record.weekendDate.startsWith(monthPrefix)) continue
      const pair = recordPairKey(weekendHolidayId(record.weekendDate), record.studentId)
      if (seen.has(pair)) continue
      seen.add(pair)
      count += 1
    }
    for (const record of records.value) {
      if (!record.returnHome || !active.has(record.studentId)) continue
      if (!record.date.startsWith(monthPrefix)) continue
      const pair = recordPairKey(record.holidayId, record.studentId)
      if (seen.has(pair)) continue
      seen.add(pair)
      count += 1
    }
    return count
  })

  // 学生改名 / 补学号后同步快照（只监听姓名与学号，其余改动不触发）
  watch(
    () => studentStore.students.map((item) => `${item.id}|${item.name}|${item.studentNo}`),
    () => {
      records.value = withStudentNames(records.value, studentStore.students)
    },
  )

  /* ---------- 假期的增删改 ---------- */

  /** 表单入参 → 可落库的形状；任何一项不合法就返回 null（拒绝写入，§11.4 的数据层兜底） */
  function cleanHolidayInput(
    input: HolidayInput,
  ): Omit<Holiday, 'id' | 'createdAt' | 'updatedAt'> | null {
    if (!input || typeof input !== 'object') return null
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name) return null
    if (!isDateKey(input.startDate) || !isDateKey(input.endDate)) return null
    const [startDate, endDate] =
      input.startDate <= input.endDate
        ? [input.startDate, input.endDate]
        : [input.endDate, input.startDate]
    const note = typeof input.note === 'string' ? input.note.trim() : ''
    return { name, startDate, endDate, ...(note ? { note } : {}) }
  }

  function createHoliday(input: HolidayInput): Holiday | undefined {
    const clean = cleanHolidayInput(input)
    if (!clean) return undefined
    const timestamp = new Date().toISOString()
    const holiday: Holiday = {
      id: createId(),
      ...clean,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    holidays.value = [...holidays.value, holiday]
    return holiday
  }

  function updateHoliday(id: string, patch: Partial<HolidayInput>): Holiday | undefined {
    // 虚拟周末不可编辑：它的日期由日历决定，改了就与「那一期」对不上了
    if (isWeekendHolidayId(id)) return undefined
    const index = holidays.value.findIndex((item) => item.id === id)
    if (index === -1) return undefined
    const current = holidays.value[index]
    if (!current) return undefined
    const clean = cleanHolidayInput({
      name: patch.name ?? current.name,
      startDate: patch.startDate ?? current.startDate,
      endDate: patch.endDate ?? current.endDate,
      note: patch.note ?? current.note,
    })
    if (!clean) return undefined
    const next: Holiday = {
      id: current.id,
      ...clean,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    }
    holidays.value = [...holidays.value.slice(0, index), next, ...holidays.value.slice(index + 1)]
    return next
  }

  /**
   * 删除假期会连带的登记数（确认文案用，删除前问）。
   * 只数新键：自定义假期的登记全在新键里，老键不属于任何一个可删的假期。
   *
   * 注意它数的是**记录条数**，不是学生人数：留校学生可以没有任何记录（没有记录就是留校），
   * 所以「全班 62 人、40 人离校」的假期被删时，这里报的是那 40 条离校记录加上显式点过
   * 「设为留校」/ 写过备注的那几条。文案里写的也是「条登记记录」，不是「人」。
   */
  function cascadeCountOf(id: string): { total: number; home: number; stay: number } {
    let home = 0
    let stay = 0
    for (const record of records.value) {
      if (record.holidayId !== id) continue
      if (record.returnHome) home += 1
      else stay += 1
    }
    return { total: home + stay, home, stay }
  }

  /**
   * 删除一个自定义假期，**连带删掉它名下的全部登记**（v3.6.1 规格第 9 节，页面必须先弹确认）。
   *
   * 两个键各写一次，中间没有事务——云端可能只到达前一半，那时这些登记就成了「孤儿」，
   * 由列表底部的提示兜底（可手动清理）。这是**可恢复的中间态，不是错误态**，
   * 所以不做「先删登记再删假期」这种把顺序变成正确性前提的设计。
   *
   * 虚拟周末不是可删对象：它的「日期」由日历决定，删掉它下次刷新还会回来。
   * 要清掉某一期的登记，请在那一期里改学生的去向。
   */
  function removeHoliday(id: string): boolean {
    if (isWeekendHolidayId(id)) return false
    const index = holidays.value.findIndex((item) => item.id === id)
    if (index === -1) return false
    holidays.value = [...holidays.value.slice(0, index), ...holidays.value.slice(index + 1)]
    const remaining = records.value.filter((item) => item.holidayId !== id)
    if (remaining.length !== records.value.length) records.value = remaining
    return true
  }

  /* ---------- 学生级备注 ---------- */

  /**
   * 写入 / 清空某个学生在这个假期里的备注（v3.6.2 规格第 15–20 节），返回是否真的改了。
   *
   * 三件事值得说明：
   * - **备注与去向无关**：留校学生照样能写（没有记录时就为它建一条 `returnHome: false` 的
   *   记录来装备注——这条记录不参与状态推导，`statusOf` 本来就把「没有记录」当留校）。
   * - **清空备注**：自定义假期那条记录还可能是「离校」的事实所在（`returnHome: true`），
   *   那就只摘备注字段、留记录；要是它本来就只为装备注而生（`returnHome: false`），
   *   整条删掉——「有记录 ⇔ 有离校事实或有备注」这条不变量由此保持干净。
   * - **幂等**：内容没变就一个字节都不写（同批量登记的纪律），返回 false。
   *
   * 调用方（页面）必须把它包在 `runLockedOperation` 里：它有可能是「写一个键」的短动作，
   * 也可能顺带建 / 删一条记录，与批量登记同一套上云纪律。
   */
  function setNote(holidayId: string, studentId: string, note: string): boolean {
    const weekendKey = weekendKeyOfHolidayId(holidayId)
    const holiday = weekendKey ? undefined : holidays.value.find((item) => item.id === holidayId)
    // 假期已被别处删掉（或 id 根本不存在）时拒绝写入：这时候连「代表日」都定不下来
    if (!weekendKey && !holiday) return false

    const student = activeStudents.value.find((row) => row.id === studentId)
    if (!student) return false

    const clean = typeof note === 'string' ? note.trim() : ''
    const index = records.value.findIndex(
      (item) => item.holidayId === holidayId && item.studentId === studentId,
    )
    const current = index === -1 ? undefined : records.value[index]
    if ((current?.note ?? '') === clean) return false

    if (current && index !== -1) {
      // 清空一条「只为备注而生」的记录（自定义假期的留校、周末的影子）→ 整条删掉
      if (!clean && !current.returnHome) {
        records.value = records.value.filter((_, i) => i !== index)
        return true
      }
      const next: HolidayRecord = { ...current }
      if (clean) next.note = clean
      else delete next.note
      records.value = [...records.value.slice(0, index), next, ...records.value.slice(index + 1)]
      return true
    }

    // 没有记录、也没有要写的备注 → 什么都不做（不给留校学生凭空造记录）
    if (!clean) return false

    const date = weekendKey ?? holiday?.startDate
    if (!date || !isDateKey(date)) return false
    records.value = [
      ...records.value,
      {
        id: createId(),
        holidayId,
        studentId: student.id,
        studentName: formatStudentShortName(student, studentStore.nameCounts),
        date,
        // 只承载备注的记录：自定义假期里「没有回家记录 = 留校」，这里不额外声明什么
        returnHome: false,
        note: clean,
        createdAt: new Date().toISOString(),
      },
    ]
    return true
  }

  /* ---------- 批量登记 ---------- */

  /**
   * 把若干学生的当前处境摊成一次可执行的增删清单（**只读，不写盘**）。
   * 页面用它写确认文案（「其中 3 人原为离校」），确认之后再调 `setStatuses` 真正落库。
   */
  function previewStatusChange(holidayId: string, studentIds: string[], target: HolidayStatus) {
    const weekendKey = weekendKeyOfHolidayId(holidayId)
    // 老键的「学生 + 这一期」记录表：只有周末才需要，且只在这里建一次
    const weekendRecordIdByStudent = new Map<string, string>()
    if (weekendKey) {
      for (const record of weekendStore.records) {
        if (record.weekendDate === weekendKey)
          weekendRecordIdByStudent.set(record.studentId, record.id)
      }
    }
    const holidayRecordByStudent = new Map<string, HolidayRecord>()
    for (const record of records.value) {
      if (record.holidayId === holidayId) holidayRecordByStudent.set(record.studentId, record)
    }
    const inputs = studentIds.map((studentId) => {
      const weekendRecordId = weekendRecordIdByStudent.get(studentId)
      const holidayRecord = holidayRecordByStudent.get(studentId)
      return {
        studentId,
        status: statusIn(holidayId, studentId),
        ...(weekendRecordId ? { weekendRecordId } : {}),
        ...(holidayRecord ? { holidayRecordId: holidayRecord.id } : {}),
        // 改向时备注跟着人走：离校改留校不该把教师写的备注顺手丢掉
        ...(holidayRecord?.note ? { note: holidayRecord.note } : {}),
      }
    })
    return planStatusChange(inputs, target, { isWeekend: weekendKey !== undefined })
  }

  /**
   * 批量设置去向，返回**实际被改动的人数**（0 = 一个也没动，含「本来就都是这个状态」）。
   *
   * `studentIds` 就是这条承诺的全部范围：函数没有任何「取全班」的入口，
   * 看不见的学生不可能被碰到（v3.6.1 规格第 5 节）。
   * 全是目标状态时计划为空，这里直接返回 0——**零写盘、零广播**，批量动作因此可以放心连点。
   *
   * 调用方（页面）必须把它包在 `runLockedOperation` 里：这是「一次写很多键」的长事务，
   * 中途上云会让别的设备看到改到一半的名单（见 docs/ARCHITECTURE.md 的长事务一节）。
   */
  function setStatuses(holidayId: string, studentIds: string[], target: HolidayStatus): number {
    const weekendKey = weekendKeyOfHolidayId(holidayId)
    const holiday = weekendKey ? undefined : holidays.value.find((item) => item.id === holidayId)
    // 假期已被别处删掉（或 id 根本不存在）时拒绝写入：这时候连「代表日」都定不下来
    if (!weekendKey && !holiday) return 0
    const date = weekendKey ?? holiday?.startDate
    if (!date || !isDateKey(date)) return 0

    const plan = previewStatusChange(holidayId, studentIds, target)
    if (isEmptyPlan(plan)) return 0

    // 1) 先删：此刻他名下任何既有记录都与目标不符（状态相同的人在计划里已被跳过）
    const holidayRemovals = new Set(
      plan.remove.filter((item) => item.source === 'holiday').map((item) => item.recordId),
    )
    const weekendRemovals = plan.remove.filter((item) => item.source === 'weekend')
    if (holidayRemovals.size) {
      records.value = records.value.filter((item) => !holidayRemovals.has(item.id))
    }
    for (const item of weekendRemovals) weekendStore.removeReturn(item.recordId)

    // 2) 再建：周末的离校仍走老键那条既有路径，其余进新键
    if (plan.addWeekend.length && weekendKey) {
      weekendStore.addReturns(weekendKey, plan.addWeekend)
    }
    if (plan.create.length && date) {
      const createdAt = new Date().toISOString()
      const added: HolidayRecord[] = []
      for (const item of plan.create) {
        const student = activeStudents.value.find((row) => row.id === item.studentId)
        if (!student) continue
        added.push({
          id: createId(),
          holidayId,
          studentId: student.id,
          studentName: formatStudentShortName(student, studentStore.nameCounts),
          date,
          returnHome: item.returnHome,
          ...(item.note ? { note: item.note } : {}),
          createdAt,
        })
      }
      if (added.length) records.value = [...records.value, ...added]
    }

    return countFrom(plan.fromCounts)
  }

  /* ---------- 孤儿登记 ---------- */

  /**
   * 引用了「不在列表里的假期」的登记。
   *
   * 只可能来自两处：云端 / 备份只到达了 `holidayRecords` 那一份，或某条假期在 `normalizeHoliday`
   * 里被判废而它的登记活了下来。**虚拟周末不产生孤儿**——「有登记的周末」本身就在列表的派生条件里。
   *
   * 为什么不自动删：假期「不在列表里」最常见的原因恰恰是**它还没同步到这台设备**，
   * 自动删等于把对方的合法数据当垃圾清掉。所以只提示、只提供手动清理。
   */
  const orphanRecords = computed(() =>
    records.value.filter((item) => !knownHolidayIds.value.has(item.holidayId)),
  )
  const orphanCount = computed(() => orphanRecords.value.length)

  /** 清掉孤儿登记，返回清理条数（本地单人数据，无回收站，与其余模块同口径） */
  function clearOrphans(): number {
    const orphans = orphanRecords.value
    if (!orphans.length) return 0
    const ids = new Set(orphans.map((item) => item.id))
    records.value = records.value.filter((item) => !ids.has(item.id))
    return ids.size
  }

  return {
    holidays,
    records,
    todayKey,
    activeStudents,
    entries,
    currentEntry,
    monthHomeCount,
    orphanCount,
    orphanRecords,
    statusIn,
    countsOf,
    outsideHomeCountOf,
    noteIn,
    hasRegistrationsOf,
    staleCountOf,
    previewStatusChange,
    setStatuses,
    setNote,
    createHoliday,
    updateHoliday,
    removeHoliday,
    cascadeCountOf,
    clearOrphans,
  }
})

/** 计划里「原来的二态」各有多少人 → 总改动人数 */
function countFrom(counts: Record<HolidayStatus, number>): number {
  return counts.home + counts.stay
}
