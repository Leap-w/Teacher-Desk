import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { appConfig } from '@/config'
import { createSeatPlan, normalizeSeatPlan } from '@/utils/seat'
import { useStudentStore } from '@/stores/student'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { Seat, SeatPlan } from '@/types/seat'

const STORAGE_KEY = `${appConfig.storageKeyPrefix}:seatPlans`

/** 活跃学生的最小档案投影（供自动就座；只依赖既有字段，学生仍只经由 student store 写入） */
function studentProfiles() {
  return useStudentStore().activeStudents.map((item) => ({
    id: item.id,
    studentNo: item.studentNo,
    seatNumber: item.seatNumber,
  }))
}

function persist(value: SeatPlan[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch (error) {
    // 存储配额耗尽 / 隐私模式等写入失败时不应中断应用运行（同 student store）
    console.warn('[seat] 写入 localStorage 失败：', error)
  }
}

/** 首次启动（键不存在）：建一个「开学初」当前方案，学生按 seatNumber 自动就座 */
function seedPlans(): SeatPlan[] {
  const plan: SeatPlan = { ...createSeatPlan('开学初', studentProfiles()), isCurrent: true }
  persist([plan])
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

/** 从 localStorage 读取座位方案；守卫与升级策略同 student store（§3.2 数据安全保护） */
function loadSeatPlans(): SeatPlan[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return seedPlans()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      console.warn('[seat] localStorage 座位方案数据格式异常，已重置为空')
      return []
    }
    return ensureSingleCurrent(
      parsed
        .filter((item): item is SeatPlan => Boolean(item) && typeof item === 'object')
        .map((item) => normalizeSeatPlan(item as Partial<SeatPlan>)),
    )
  } catch (error) {
    console.warn('[seat] 读取 localStorage 失败：', error)
    return []
  }
}

export const useSeatStore = defineStore('seat', () => {
  /** 教室固定配置（唯一事实来源；组件一律经 store 读取，不另写教室参数） */
  const config = DEFAULT_CLASSROOM_CONFIG

  /** 全部座位方案（含历史方案；数组顺序即创建顺序） */
  const plans = ref<SeatPlan[]>(loadSeatPlans())

  watch(
    plans,
    (value) => {
      persist(value)
    },
    { deep: true },
  )

  /** 当前方案（方案切换后唯一 isCurrent）；无方案时为 undefined */
  const currentPlan = computed(() => plans.value.find((plan) => plan.isCurrent))

  /** 当前方案全部座位（63 个，含空位）：同一批 Seat 对象，切换视角只改显示顺序 */
  const currentSeats = computed<Seat[]>(() => currentPlan.value?.seats ?? [])

  /** 已就座数量（按 studentId 计数；学生被删除后可能悬空，Phase 3B 统一清理） */
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
    return { ...plan, isCurrent: true }
  }

  /** 切换当前方案；目标不存在或已是当前时返回 false */
  function switchPlan(id: string): boolean {
    const target = plans.value.find((plan) => plan.id === id)
    if (!target || target.isCurrent) return false
    plans.value = plans.value.map((plan) => ({ ...plan, isCurrent: plan.id === id }))
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

  return {
    config,
    plans,
    currentPlan,
    currentSeats,
    occupiedCount,
    createPlan,
    switchPlan,
    renamePlan,
    removePlan,
  }
})
