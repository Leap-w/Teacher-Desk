import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { useNow } from '@/composables/useToday'
import { dutyRepository } from '@/repositories/duty/dutyRepository'
import { useStudentStore } from '@/stores/student'
import { formatDateKey } from '@/utils/date'
import { createId } from '@/utils/id'
import { formatStudentShortName } from '@/utils/student'
import {
  DEFAULT_DUTY_SETTINGS,
  describeRotation,
  dutyDaysFrom,
  dutyGroupFor,
  isDutyDateKey,
  isDutyGroup,
  isDutySettings,
  normalizeStudentIds,
} from '@/utils/duty'
import type { DutyGroup, DutyMember, DutyRecord, DutySettings } from '@/types/duty'
import type { DutyArrangeImportPlan, DutyGroupImportPlan } from '@/services/dutyImport'

/** 分组导入落库结果（失败时数据一个字节都不改） */
export type DutyGroupImportOutcome =
  { ok: true; updated: number; created: number; members: number } | { ok: false; reason: string }

/** 安排导入落库结果（失败时数据一个字节都不改） */
export type DutyArrangeImportOutcome =
  { ok: true; startDate: string; days: number } | { ok: false; reason: string }

/**
 * 值日安排（Phase 6）：值日组与轮换设置的唯一读写入口。
 * 数据源：`teacherdesk:duty`（Pinia → localStorage，§3.2）——**两个实体同存一个数组**
 * （见 types/duty.ts 顶部说明：备份 / 合并 / 清空 / 概览因此都能直接复用）。
 *
 * 与请假的一处关键差异：**学生被删除时不改动编排**（请假是保留姓名快照、
 * 座位是释放）。值日组是「打算怎么排」，学生转学 / 被删后教师需要知道
 * 「这个组少了一个人」并自己决定，因此页面照常显示该成员并标注已不在档案。
 */
export const useDutyStore = defineStore('duty', () => {
  /** 学生 store 同步实例化：供组员姓名与「是否还在档案」判定用 */
  const studentStore = useStudentStore()
  const now = useNow()

  const records = ref<DutyRecord[]>(dutyRepository.load(studentStore.students))

  // 写盘 + 跨标签页同步（Phase 9A）：本页改动写盘后广播键名，别的入口改了则重读并规范化
  dutyRepository.bind(records)

  /** 值日组（数组顺序即轮换顺序，也是页面展示顺序） */
  const groups = computed(() => records.value.filter(isDutyGroup))

  /** 轮换设置（单例；数组里没有时用默认值兜底，页面据此提示「还没设置起点」） */
  const settings = computed(
    () => records.value.find(isDutySettings) ?? { ...DEFAULT_DUTY_SETTINGS },
  )

  /** 今天（日期键），与工作台 / 课表同一个共享时钟 */
  const todayKey = computed(() => formatDateKey(now.value))

  /** 今天值日的组；不值日（周末不排）或还没有组时为 undefined */
  const todayGroup = computed(() => dutyGroupFor(todayKey.value, groups.value, settings.value))

  /** 接下来 7 天的值日安排（含今天） */
  const upcomingDays = computed(() => dutyDaysFrom(todayKey.value, 7, groups.value, settings.value))

  /**
   * 起点组已失效（指定的那个组被删 / 被清空示例数据删掉）：
   * 轮换仍会按第一个组推进，但页面必须提示教师重设起点，不能装作没这回事。
   */
  const rotationMisaligned = computed(() => {
    const anchor = settings.value.startGroupId
    if (!anchor || groups.value.length === 0) return false
    return !groups.value.some((group) => group.id === anchor)
  })

  /** 轮换说明文案（设置面板与工作台卡片共用；口径只有 utils/duty.ts 一处） */
  const rotationSummary = computed(() => describeRotation(settings.value, groups.value))

  /** 组员展示信息（姓名 + 是否还在档案），值日页与工作台卡片共用 */
  function membersOf(group: DutyGroup): DutyMember[] {
    const archived = new Map(studentStore.students.map((item) => [item.id, item]))
    const active = new Set(studentStore.activeStudents.map((item) => item.id))
    return group.studentIds.map((id) => {
      const student = archived.get(id)
      return {
        id,
        name: student ? formatStudentShortName(student, studentStore.nameCounts) : '未知学生',
        active: active.has(id),
      }
    })
  }

  /**
   * 新建值日组；组名为空时拒绝（返回 undefined）。
   * **第一个组自动成为轮换起点**（起点日期 = 今天）：此前一个组都没有时，设置里的旧起点
   * 指不到任何组，让新组顶上最符合教师预期——否则面板会一直挂着「起点组已被删除」的红字，
   * 而这时候教师刚建完组，正等着看排班。已经有组时绝不抢起点（新组只是排到队尾）。
   */
  function addGroup(name: string, studentIds: string[] = []): DutyGroup | undefined {
    const trimmed = name.trim()
    if (!trimmed) return undefined
    // 组员 id 与读取同口径清洗：写入端放行重复 id 的话，下次启动读回来又会被悄悄去掉
    const group: DutyGroup = {
      id: createId(),
      kind: 'group',
      name: trimmed,
      studentIds: normalizeStudentIds(studentIds),
    }
    const isFirst = groups.value.length === 0
    const anchor: Partial<DutySettings> = { startDate: todayKey.value, startGroupId: group.id }
    const appended = dutyRepository.ensureSettings([...records.value, group], anchor)
    records.value = isFirst
      ? appended.map((record) => (isDutySettings(record) ? { ...record, ...anchor } : record))
      : appended
    return group
  }

  /** 改名 / 改组员；组名清空或目标不存在时返回 undefined（保持原样，不写半截） */
  function updateGroup(
    id: string,
    patch: { name?: string; studentIds?: string[] },
  ): DutyGroup | undefined {
    const index = records.value.findIndex((record) => isDutyGroup(record) && record.id === id)
    if (index === -1) return undefined
    const current = records.value[index]
    if (!current || !isDutyGroup(current)) return undefined
    const name = patch.name === undefined ? current.name : patch.name.trim()
    if (!name) return undefined
    const next: DutyGroup = {
      ...current,
      name,
      studentIds:
        patch.studentIds === undefined ? current.studentIds : normalizeStudentIds(patch.studentIds),
    }
    records.value = [...records.value.slice(0, index), next, ...records.value.slice(index + 1)]
    return next
  }

  /**
   * 删除某个组之后，轮换起点会顺延到哪个组（删掉它后面的那一组；它本来就是最后一个则回到第一个）。
   * 只读查询：确认弹窗要在教师按下删除**之前**说清后果，与 removeGroup 的实际行为同源。
   */
  function rotationSuccessorOf(id: string): DutyGroup | undefined {
    const index = groups.value.findIndex((group) => group.id === id)
    if (index === -1) return undefined
    const remaining = groups.value.filter((group) => group.id !== id)
    return remaining[index] ?? remaining[0]
  }

  /**
   * 删除值日组：目标不存在返回 false。
   * 删掉的若是**当前轮换起点组**，起点顺延到它后面的那一组（没有后面就用第一个）——
   * 「这一组没了，后面那组顶上」是教师期望的结果；不这么做的话轮换会悄悄退回第一个组，
   * 与教师排的顺序对不上。
   */
  function removeGroup(id: string): boolean {
    const index = groups.value.findIndex((group) => group.id === id)
    if (index === -1) return false
    const successor = rotationSuccessorOf(id)
    records.value = records.value.filter((record) => !(isDutyGroup(record) && record.id === id))
    if (settings.value.startGroupId === id) {
      records.value = records.value.map((record) =>
        isDutySettings(record)
          ? { ...record, startGroupId: successor ? successor.id : '' }
          : record,
      )
    }
    return true
  }

  /**
   * 改轮换设置（起点日期 / 起点组 / 周末开关）。
   * 起点日期必须是真实存在、且年份在 2000–2099 的日期（`''` = 教师清空了，视为
   * 「还没设置」，允许）、起点组必须是现有组，否则拒绝返回 false——一个不存在的日期
   * 会让整张值日表错位，一个 9999 年的日期会让逐日推进走到页面卡死，宁可不写。
   */
  function setRotation(patch: Partial<Omit<DutySettings, 'id' | 'kind'>>): boolean {
    if (
      patch.startDate !== undefined &&
      patch.startDate !== '' &&
      !isDutyDateKey(patch.startDate)
    ) {
      return false
    }
    if (
      patch.startGroupId !== undefined &&
      patch.startGroupId !== '' &&
      !groups.value.some((group) => group.id === patch.startGroupId)
    ) {
      return false
    }
    records.value = dutyRepository.ensureSettings(records.value).map((record) =>
      isDutySettings(record)
        ? {
            ...record,
            startDate: patch.startDate ?? record.startDate,
            startGroupId: patch.startGroupId ?? record.startGroupId,
            includeWeekend: patch.includeWeekend ?? record.includeWeekend,
          }
        : record,
    )
    return true
  }

  /* ========== V1.1.5：Excel 批量导入（唯一落库入口，失败整批拒绝） ========== */

  /**
   * 应用分组导入计划：**按 Excel 更新 / 写入提到的组，未涉及的组保持不变**（不整班清空）。
   * 兜底校验：更新目标必须存在、新建组名非空、同一学生只进一个组——导入层已校验，
   * 这里防其他入口绕过。整批一次赋值 = 一次写盘 + 一次广播；首个组自动成为轮换起点
   * （与 addGroup 同一口径，正常用不到：有组的班级导入不会走到这一支）。
   */
  function applyDutyGroupImport(plan: DutyGroupImportPlan): DutyGroupImportOutcome {
    const seenStudent = new Set<string>()
    for (const update of plan.updates) {
      if (!records.value.some((record) => isDutyGroup(record) && record.id === update.id)) {
        return { ok: false, reason: `要更新的组不存在（${update.name}）` }
      }
      for (const id of update.studentIds) {
        if (seenStudent.has(id)) return { ok: false, reason: '同一学生被安排进了多个组' }
        seenStudent.add(id)
      }
    }
    for (const create of plan.creates) {
      if (!create.name.trim()) return { ok: false, reason: '新组组名不能为空' }
      for (const id of create.studentIds) {
        if (seenStudent.has(id)) return { ok: false, reason: '同一学生被安排进了多个组' }
        seenStudent.add(id)
      }
    }

    let updated = 0
    let created = 0
    let members = 0
    let next = records.value.map((record) => {
      if (!isDutyGroup(record)) return record
      const hit = plan.updates.find((update) => update.id === record.id)
      if (!hit) return record
      updated += 1
      members += hit.studentIds.length
      return { ...record, studentIds: normalizeStudentIds(hit.studentIds) }
    })
    for (const create of plan.creates) {
      next = [
        ...next,
        {
          id: createId(),
          kind: 'group',
          name: create.name.trim(),
          studentIds: normalizeStudentIds(create.studentIds),
        } satisfies DutyGroup,
      ]
      created += 1
      members += create.studentIds.length
    }
    // 首次建组的班级导入后立即有轮换起点（与 addGroup 同一口径）；已有组时不动起点
    const isFirst = groups.value.length === 0
    const anchor: Partial<DutySettings> = {
      startDate: todayKey.value,
      startGroupId: plan.updates[0]?.id ?? '',
    }
    next = isFirst
      ? dutyRepository.ensureSettings(next, anchor)
      : dutyRepository.ensureSettings(next)
    records.value = next
    return { ok: true, updated, created, members }
  }

  /**
   * 应用安排导入计划：把「日期 → 组」表翻译成轮换的**起点 + 组顺序**。
   * 组顺序 = 表序在前、未提到的组保持相对顺序排在其后；改组序会改变整条轮换的走向，
   * 预览里已明确说明。组序变更与起点更新合并为一次赋值 = 一次写盘 + 一次广播。
   */
  function applyDutyArrangeImport(plan: DutyArrangeImportPlan): DutyArrangeImportOutcome {
    if (!plan.startDate || !plan.startGroupId) {
      return { ok: false, reason: '导入计划缺少轮换起点' }
    }
    if (!isDutyDateKey(plan.startDate)) {
      return { ok: false, reason: `起点日期不合法（${plan.startDate}）` }
    }
    const orderIds = plan.order.filter((id) => groups.value.some((group) => group.id === id))
    if (orderIds.length !== groups.value.length || !orderIds.includes(plan.startGroupId)) {
      return { ok: false, reason: '导入的组顺序与现有组对不上，请刷新后重试' }
    }

    const groupById = new Map(
      records.value.filter(isDutyGroup).map((group) => [group.id, group] as const),
    )
    const reordered = orderIds.map((id) => groupById.get(id)).filter((group) => group !== undefined)
    const reorderedIds = new Set(reordered.map((group) => group.id))
    // 组卡按新顺序重排；设置记录原地更新起点；其余记录（不会有的）保持
    const merged: DutyRecord[] = [...reordered]
    for (const record of records.value) {
      if (isDutyGroup(record) && reorderedIds.has(record.id)) continue
      merged.push(
        isDutySettings(record)
          ? { ...record, startDate: plan.startDate, startGroupId: plan.startGroupId }
          : record,
      )
    }
    records.value = merged
    return { ok: true, startDate: plan.startDate, days: orderIds.length }
  }

  return {
    records,
    groups,
    settings,
    todayKey,
    todayGroup,
    upcomingDays,
    rotationMisaligned,
    rotationSummary,
    membersOf,
    addGroup,
    updateGroup,
    removeGroup,
    rotationSuccessorOf,
    setRotation,
    applyDutyGroupImport,
    applyDutyArrangeImport,
  }
})
