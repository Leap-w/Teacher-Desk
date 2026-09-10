import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { appConfig } from '@/config'
import { createSeedLessons } from '@/services/mock'
import { createId } from '@/utils/id'
import { sortLessons } from '@/utils/timetable'
import type { Lesson, Weekday } from '@/types/timetable'

const STORAGE_KEY = `${appConfig.storageKeyPrefix}:timetable:lessons`

/**
 * 单条课程数据的健壮化（load 时逐条调用）：星期 / 节次非法、科目或班级为空即丢弃该条
 * ——课表条目的四个必填字段缺一即失去意义，不做「补默认值」的臆造（§11.3）。
 * 字段一律用 `typeof` 严格判定（不做 `Number()` 强转）：外部篡改写入的 `true` / `"1"`
 * 不是合法的星期与节次，应当丢弃而不是被当成周一第 1 节（同 normalizeSeatPlan 口径）。
 */
function normalizeLesson(raw: Partial<Lesson>): Lesson | null {
  const { weekday, period } = raw
  if (typeof weekday !== 'number' || !Number.isInteger(weekday)) return null
  if (weekday < 1 || weekday > 7) return null
  if (typeof period !== 'number' || !Number.isInteger(period) || period < 1) return null
  const subject = typeof raw.subject === 'string' ? raw.subject.trim() : ''
  const className = typeof raw.className === 'string' ? raw.className.trim() : ''
  if (!subject || !className) return null
  const location = typeof raw.location === 'string' ? raw.location.trim() : ''
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    weekday: weekday as Weekday,
    period,
    subject,
    className,
    location: location || undefined,
  }
}

/** 从 localStorage 读取；首次启动（无缓存）时写入示例课表 */
function loadLessons(): Lesson[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      const seed = createSeedLessons()
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
      return seed
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      console.warn('[timetable] localStorage 数据格式异常，已重置为空课表')
      return []
    }
    // 同一 id 只保留首条：外部篡改可能造出重复 id，会让课程列表的 v-for key 冲突
    const seen = new Set<string>()
    return parsed
      .filter((item): item is Partial<Lesson> => Boolean(item) && typeof item === 'object')
      .map((item) => normalizeLesson(item))
      .filter((item): item is Lesson => item !== null)
      .filter((lesson) => {
        if (seen.has(lesson.id)) return false
        seen.add(lesson.id)
        return true
      })
  } catch (error) {
    console.warn('[timetable] 读取 localStorage 失败：', error)
    return []
  }
}

export const useTimetableStore = defineStore('timetable', () => {
  /** 全部课程（本阶段只读：数据来自 mock 与 localStorage，页面不提供编辑入口） */
  const lessons = ref<Lesson[]>(loadLessons())

  watch(
    lessons,
    (value) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      } catch (error) {
        console.warn('[timetable] 写入 localStorage 失败：', error)
      }
    },
    { deep: true },
  )

  /**
   * 本周课时数。本地课表是「按周循环」的固定课表，全部条目即一周的课，
   * 因此直接取条数；接入真实学期周次后此处改为按周筛选（§9.6 未实现）。
   */
  const weekLessonCount = computed(() => lessons.value.length)

  /** 某天的课程（节次升序）；周末通常为空数组 → 今日课程卡片显示空态 */
  function lessonsOf(weekday: Weekday): Lesson[] {
    return sortLessons(lessons.value.filter((lesson) => lesson.weekday === weekday))
  }

  return { lessons, weekLessonCount, lessonsOf }
})
