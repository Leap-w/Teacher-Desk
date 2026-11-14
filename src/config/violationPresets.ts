/**
 * 系统违纪事件预设（v3.8.1 · Phase 3）。
 *
 * **唯一来源**：表单选系统事件、默认严重程度、测试断言全部从这里读；
 * 页面里**禁止**再抄一份清单。
 *
 * ## v3.8.1 的变化
 *
 * - **取消分类**：不再有 routine / collective / hygiene / dormitory / other 分组，
 *   选择列表是一份扁平清单。
 * - **移除 `other-custom` 哨兵**：它原本只是「显示自定义输入框」的 UI 哨兵，不是真实事件。
 *   现在自定义事件由正式的自定义预设机制承载（`types/violation.ts` 的
 *   `ViolationCustomPreset`），历史记录里的 `presetId: 'other-custom'` 由
 *   `LEGACY_CUSTOM_PRESET_ID` 识别并保留其 `behaviorLabel`。
 * - **新增两条**：`dormitory-private-phone`（私藏手机）、`dormitory-hygiene-messy`（宿舍卫生脏乱），
 *   默认严重程度均为 `moderate`。
 *
 * ## 数据不变量
 *
 * - 原有 22 条真实事件的 **id / label / defaultSeverity 一字未改**；
 * - id 用「来源 + 语义」而不是序号（`presetId` 要长期落在历史记录里）；
 * - 系统预设由系统维护，教师不能改其默认严重程度（只能改单条事件）。
 *
 * ## 刻意不放进预设的两项
 *
 * 「多次迟到」「卫生脏乱且多次提醒不改」不是独立事件类型——它们是「迟到 / 卫生脏乱」
 * 这两个事实加上累计次数与教师判断后的结果；做成独立预设等于在数据层替教师下结论。
 */
import type { ViolationPreset, ViolationSeverity } from '@/types/violation'

/**
 * v3.8.0 的「其他自定义事件」哨兵 id。
 *
 * **不再出现在系统预设列表里**，但历史记录可能仍是这个 id：
 * - 读取：保留原 `behaviorLabel`（绝不替换成「其他自定义事件」）；
 * - 编辑：回填为自定义事件输入框的原文；
 * - 保存：按新规则归到自定义预设（若同名已存在则复用）。
 */
export const LEGACY_CUSTOM_PRESET_ID = 'other-custom'

/** 系统预设清单（顺序即表单里的展示顺序；新增事件追加在末尾，避免打乱既有位置） */
export const VIOLATION_PRESETS: readonly ViolationPreset[] = [
  { id: 'routine-late', label: '迟到', defaultSeverity: 'minor' },
  { id: 'routine-truancy', label: '旷课', defaultSeverity: 'moderate' },
  { id: 'routine-talk', label: '上课说话', defaultSeverity: 'minor' },
  { id: 'routine-sleep', label: '上课睡觉', defaultSeverity: 'minor' },
  { id: 'routine-rest', label: '不按时休息', defaultSeverity: 'minor' },

  { id: 'collective-skip-exercise', label: '旷操', defaultSeverity: 'moderate' },
  { id: 'collective-late', label: '集合迟到', defaultSeverity: 'moderate' },
  { id: 'collective-slow', label: '集合不及时', defaultSeverity: 'minor' },

  { id: 'hygiene-messy', label: '卫生脏乱', defaultSeverity: 'moderate' },
  { id: 'hygiene-personal', label: '个人卫生不达标', defaultSeverity: 'minor' },
  { id: 'hygiene-duty', label: '值日未完成', defaultSeverity: 'moderate' },

  { id: 'dormitory-noise', label: '宿舍喧哗', defaultSeverity: 'moderate' },
  { id: 'dormitory-phone', label: '熄灯后使用手机', defaultSeverity: 'moderate' },

  { id: 'other-leave-early', label: '早退', defaultSeverity: 'moderate' },
  { id: 'other-leave-school', label: '擅自离校', defaultSeverity: 'moderate' },
  { id: 'other-supplies', label: '不带学习用品', defaultSeverity: 'minor' },
  { id: 'other-disrupt-class', label: '课堂扰乱秩序', defaultSeverity: 'moderate' },
  { id: 'other-off-area', label: '擅自离开规定活动区域', defaultSeverity: 'moderate' },
  { id: 'other-disobey', label: '不服从合理的集体管理安排', defaultSeverity: 'moderate' },
  { id: 'other-fight', label: '打架', defaultSeverity: 'severe' },
  { id: 'other-bully', label: '欺凌同学', defaultSeverity: 'severe' },
  { id: 'other-damage', label: '故意损坏公共财物', defaultSeverity: 'severe' },

  // ── v3.8.1 新增（默认严重程度按既有标准：手机违规 / 卫生问题与同类事件同档） ──
  { id: 'dormitory-private-phone', label: '私藏手机', defaultSeverity: 'moderate' },
  { id: 'dormitory-hygiene-messy', label: '宿舍卫生脏乱', defaultSeverity: 'moderate' },
]

/** id → 预设（`Map` 查一次 O(1)；启动时建一次，之后只读） */
export const VIOLATION_PRESET_BY_ID: ReadonlyMap<string, ViolationPreset> = new Map(
  VIOLATION_PRESETS.map((preset) => [preset.id, preset]),
)

/**
 * 按 id 找系统预设；找不到（含 `undefined` / 空串 / 历史已下线 id / 自定义预设 id）
 * 返回 `undefined`。调用方必须能处理 `undefined`。
 */
export function findViolationPreset(id: string | undefined): ViolationPreset | undefined {
  if (!id) return undefined
  return VIOLATION_PRESET_BY_ID.get(id)
}

/** 系统预设的初始严重程度；找不到返回 `undefined`（由调用方决定兜底值） */
export function defaultSeverityOfPreset(id: string | undefined): ViolationSeverity | undefined {
  return findViolationPreset(id)?.defaultSeverity
}
