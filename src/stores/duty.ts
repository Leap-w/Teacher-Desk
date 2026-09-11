import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { appConfig } from '@/config'
import { useNow } from '@/composables/useToday'
import { createSeedDuty } from '@/services/mock'
import { readList, writeJSON } from '@/services/storage'
import { syncPersisted } from '@/services/sync'
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
  normalizeDutyRecord,
  normalizeStudentIds,
} from '@/utils/duty'
import type { DutyGroup, DutyMember, DutyRecord, DutySettings } from '@/types/duty'
import type { Student } from '@/types'

const STORAGE_KEY = `${appConfig.storageKeyPrefix}:duty`

/**
 * 把盘上的原始列表规范成内存里的值日记录（**首屏加载与跨标签页同步共用**，§11.1）。
 * 两重唯一性：同一 id 只保留首条（重复 id 会让列表的 v-for key 冲突）；设置记录也只认第一条
 * （settings 是单例，重复会让轮换口径分叉）。丢弃条目时告警，但缓存原文保留。
 *
 * 末尾保证数组里有设置记录（不写盘，只在内存里补）：少了它，后面所有读取路径
 * （settings 计算属性 / removeGroup / updateGroup）都以为「设置不在数组里」，
 * 写完一轮才把设置补进去，中间那一步是两套状态（§11.3）。
 */
function reviveDutyRecords(raw: unknown[]): DutyRecord[] {
  const seen = new Set<string>()
  const records = raw
    .map((item) => normalizeDutyRecord(item))
    .filter((item): item is DutyRecord => item !== null)
    .filter((record) => {
      if (seen.has(record.id)) return false
      seen.add(record.id)
      return true
    })
  let settingsSeen = false
  const unique = records.filter((record) => {
    if (!isDutySettings(record)) return true
    if (settingsSeen) return false
    settingsSeen = true
    return true
  })
  if (unique.length < raw.length) {
    console.warn(`[duty] 丢弃 ${raw.length - unique.length} 条不合法的值日记录（缓存原文保留）`)
  }
  return withSettings(unique)
}

/**
 * 从 localStorage 读取值与设置；首次启动（无缓存）时写入示例值日安排。
 *
 * 播种条件比学生 / 课表严一档（同请假）：值日组引用学生主键，
 * 只在示例学生**都还在读**时才播种——否则从 v0.9.0 升级上来的教师
 * 会凭空多出三个自己班上没有的学生的值日组（§11.3）。不播种时不写盘。
 *
 * 缓存损坏（非 JSON / 非数组）时降级为空、**不重播示例**：编排可编辑后
 * 示例数据不再是唯一来源，重播会盖掉教师自己排的值日表（§3.2）。
 */
function loadRecords(students: Student[]): DutyRecord[] {
  const stored = readList(STORAGE_KEY)
  if (stored === null) {
    const seed = createSeedDuty()
    // 「档案里还在」= **在读**：软删除的学生仍留在 `students` 数组里（同 §9.17 周末管理的修复）
    const inSchoolIds = new Set(students.filter((item) => !item.deletedAt).map((item) => item.id))
    const referenced = seed.flatMap((record) => (isDutyGroup(record) ? record.studentIds : []))
    if (!referenced.every((id) => inSchoolIds.has(id))) return []
    writeJSON(STORAGE_KEY, seed)
    return seed
  }
  return reviveDutyRecords(stored)
}

/** 保证数组里有设置记录（缺失时补一条默认的，可带起点）——轮换口径始终只有一处 */
function withSettings(records: DutyRecord[], fallback?: Partial<DutySettings>): DutyRecord[] {
  if (records.some(isDutySettings)) return records
  return [...records, { ...DEFAULT_DUTY_SETTINGS, ...fallback }]
}

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

  const records = ref<DutyRecord[]>(loadRecords(studentStore.students))

  // 写盘 + 跨标签页同步（Phase 9A）：本页改动写盘后广播键名，别的入口改了则重读并规范化
  syncPersisted(STORAGE_KEY, records, reviveDutyRecords)

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
        name: student ? formatStudentShortName(student) : '未知学生',
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
    const appended = withSettings([...records.value, group], anchor)
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
    records.value = withSettings(records.value).map((record) =>
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
  }
})
