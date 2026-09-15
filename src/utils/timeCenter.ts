import {
  BUILTIN_COUNTDOWNS,
  DEFAULT_HERO_COUNTDOWN_ID,
  type CustomCountdown,
  type TimeCenter,
} from '@/types/appSettings'

/**
 * 时光中心（v3.1.0）：内置项与自定义项**合成同一张列表**，以及「首页显示哪一项」的解析。
 *
 * 全站只有这一个地方做这件事——设置页的列表、首页 Hero 的标题与天数、
 * 工作时光的日期，全都从这里出去。页面里不许再写一遍 `countdowns.find(...)`
 * （同一口径只有一个来源，§11.1）。
 *
 * **内置三项不进 `timeCenter.countdowns`**：它们的日期就是 `timeCenter` 上那三个
 * 日期字段本身，存两份必然会分叉。这里把它们**当场拼出来**，UI 因此不必分「内置 / 自定义」
 * 两种行——除了 `builtin` 这个标记（决定能不能删、名称能不能改）。
 */

/** 列表里的一行；内置与自定义同形，UI 一套模板渲染 */
export interface CountdownEntry {
  id: string
  /** 名称：内置项固定，自定义项由教师填写 */
  name: string
  /** 目标日期（`YYYY-MM-DD`） */
  date: string
  /** 内置项：不可删、不可改名，日期跟着学期 / 支教日期走 */
  builtin: boolean
  /** 角标短名（如「期末」）；自定义项回落到名称本身 */
  short: string
  /** 行下方说明；自定义项为空 */
  hint: string
}

/** 内置三项 + 自定义项，按「内置在前、自定义按建立顺序在后」拼成一张列表 */
export function listCountdowns(timeCenter: TimeCenter): CountdownEntry[] {
  const builtin: CountdownEntry[] = BUILTIN_COUNTDOWNS.map((item) => ({
    id: item.id,
    name: item.name,
    // id 即日期字段名，所以直接取——这一句就是「内置项日期只有一份」的兑现处
    date: timeCenter[item.id],
    builtin: true,
    short: item.short,
    hint: item.hint,
  }))
  const custom: CountdownEntry[] = timeCenter.countdowns.map((item) => ({
    id: item.id,
    name: item.name,
    date: item.date,
    builtin: false,
    // 自定义项没有短名，角标就用名称本身（「国庆放假 2026-10-01」也读得通）
    short: item.name,
    hint: '',
  }))
  return [...builtin, ...custom]
}

/** 按 id 取一项；认不出返回 null */
export function findCountdown(timeCenter: TimeCenter, id: string): CountdownEntry | null {
  return listCountdowns(timeCenter).find((item) => item.id === id) ?? null
}

/**
 * 首页 Hero 该显示的那一项。
 *
 * **一定返回一项**：`heroCountdownId` 认不出（自定义项被删了、盘上是旧值）就回内置第一项，
 * 让 Hero 永远有东西可显示——悬空的选择不该让卡片变空白，那看起来像是坏了。
 * 仓储在写入前也会把悬空的 id 拉回默认值，这里是读取侧的第二道兜底。
 */
export function resolveHeroCountdown(timeCenter: TimeCenter): CountdownEntry {
  return (
    findCountdown(timeCenter, timeCenter.heroCountdownId) ??
    findCountdown(timeCenter, DEFAULT_HERO_COUNTDOWN_ID) ??
    listCountdowns(timeCenter)[0]!
  )
}

/** 新建一项自定义倒计时；id 要稳定且不撞——时间戳 + 随机后缀，与其余 store 同一套路数 */
export function createCountdownId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 造一项自定义倒计时（id 由本函数生成；调用方只需给名称与日期） */
export function makeCustomCountdown(name: string, date: string): CustomCountdown {
  return { id: createCountdownId(), name, date }
}

/** 这一项是不是内置（按 id 判，不看对象——设置页要拦「删除内置项」） */
export function isBuiltinCountdown(id: string): boolean {
  return BUILTIN_COUNTDOWNS.some((item) => item.id === id)
}
