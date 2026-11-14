/**
 * 违纪数据层纯函数自检（v3.8.1 · Phase 3：取消分类 / 兼容旧 category / 预设来源）。
 *
 * 这一层盯的是「错了不会报错、只会算出一个看着正常的值」的那几类事：
 *
 * ① **读路径不丢事实**：一条已经发生的违纪不能被 normalize 静默吃掉；
 *    只有「少了它就不再是违纪事实」的字段（学生 / 日期 / 时间段 / 行为文本）缺失才丢弃。
 * ② **写路径不猜**：教师提交的草稿不合法就整条拒绝，绝不悄悄改成别的值。
 * ③ **预设清单是唯一来源**：24 条系统事件 / 默认严重程度 / 不含「多次迟到」这类结论，全部钉在这。
 * ④ **旧 category 读时兼容、写时收敛**：读入旧记录不因缺分类被丢弃；重建对象不再输出 category。
 * ⑤ **时间段复用课表**；**排序确定**（日期倒序 → 创建时间倒序 → id 兜底）。
 */
import { describe, expect, it, vi } from 'vitest'

import {
  LEGACY_CUSTOM_PRESET_ID,
  VIOLATION_PRESETS,
  defaultSeverityOfPreset,
  findViolationPreset,
} from '@/config/violationPresets'
import {
  KNOWN_VIOLATION_SEVERITIES,
  KNOWN_VIOLATION_TIME_SLOT_KINDS,
  VIOLATION_SEVERITY_LABELS,
  VIOLATION_TIME_SLOT_LABELS,
  cleanViolationDraft,
  draftOfViolation,
  findViolationPresetById,
  formatViolationOccurredAt,
  formatViolationTimeSlot,
  isLegacyCustomPresetEvent,
  isQuarantinedViolationRecord,
  isViolationEvent,
  isViolationPresetKind,
  isViolationSeverity,
  isViolationTimeSlotKind,
  isValidViolationDate,
  parseViolationRecord,
  presetKindOfEvent,
  refreshViolationStudentNames,
  reviveViolationRecords,
  sortViolationEvents,
} from '@/utils/violation'
import type { Student } from '@/types'
import type { ViolationEvent } from '@/types/violation'

/* ========== 夹具 ========== */

/** 一条完整、合法的盘上记录（可选字段都在，方便逐项覆盖测试） */
function rawEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'v-1',
    studentId: 's1',
    studentName: '旦增卓玛',
    date: '2026-11-03',
    timeSlotKind: 'forenoon',
    behaviorLabel: '迟到',
    severity: 'minor',
    createdAt: '2026-11-03T01:00:00.000Z',
    updatedAt: '2026-11-03T01:00:00.000Z',
    ...overrides,
  }
}

/** 断言「这条记录能被安全规范化为合法事件」并取出来（读路径的正向用例共用） */
function parseEvent(raw: unknown): ViolationEvent {
  const parsed = parseViolationRecord(raw)
  if (parsed.kind !== 'event') {
    throw new Error(`期望解析成合法事件，实际是「${parsed.kind}」`)
  }
  return parsed.event
}

/** 断言「这条记录被判定为不可用」（既不是事件、也不是需要隔离的记录） */
function expectInvalid(raw: unknown): void {
  const parsed = parseViolationRecord(raw)
  expect(parsed.kind, `期望 invalid，实际是「${parsed.kind}」`).toBe('invalid')
}

/** 合法记录 → 已 normalize 的事件（供排序 / 快照测试用） */
function event(overrides: Record<string, unknown> = {}): ViolationEvent {
  return parseEvent(rawEvent(overrides))
}

function student(id: string, name: string, extra: Partial<Student> = {}): Student {
  return { id, name, studentNo: '', gender: 'male', ...extra }
}

/* ==================== 预设清单（唯一来源） ==================== */

describe('违纪预设清单', () => {
  it('扁平清单共 24 条：原有 22 条真实事件 + 私藏手机 + 宿舍卫生脏乱', () => {
    expect(VIOLATION_PRESETS).toHaveLength(24)
    // 取消分类后不再按分类分组
    expect('category' in (VIOLATION_PRESETS[0] as unknown as Record<string, unknown>)).toBe(false)
    expect(VIOLATION_PRESETS.map((preset) => preset.label)).toEqual(
      expect.arrayContaining(['私藏手机', '宿舍卫生脏乱']),
    )
  })

  it('预设 id 全局唯一（id 会长期落在历史记录里，撞车会让预设关联错乱）', () => {
    const ids = VIOLATION_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('「其他自定义事件」哨兵已从系统预设移除，但仍能识别历史 other-custom id', () => {
    expect(VIOLATION_PRESETS.some((preset) => preset.id === LEGACY_CUSTOM_PRESET_ID)).toBe(false)
    expect(findViolationPreset(LEGACY_CUSTOM_PRESET_ID)).toBeUndefined()
    expect(isLegacyCustomPresetEvent({ presetId: LEGACY_CUSTOM_PRESET_ID })).toBe(true)
    expect(isLegacyCustomPresetEvent({ presetId: 'routine-late' })).toBe(false)
  })

  it('默认严重程度与需求给定映射逐条一致（含新增两项）', () => {
    const expected: Record<string, string> = {
      迟到: 'minor',
      上课说话: 'minor',
      上课睡觉: 'minor',
      不按时休息: 'minor',
      个人卫生不达标: 'minor',
      集合不及时: 'minor',
      不带学习用品: 'minor',
      旷课: 'moderate',
      旷操: 'moderate',
      集合迟到: 'moderate',
      卫生脏乱: 'moderate',
      值日未完成: 'moderate',
      早退: 'moderate',
      擅自离校: 'moderate',
      宿舍喧哗: 'moderate',
      熄灯后使用手机: 'moderate',
      擅自离开规定活动区域: 'moderate',
      不服从合理的集体管理安排: 'moderate',
      课堂扰乱秩序: 'moderate',
      打架: 'severe',
      欺凌同学: 'severe',
      故意损坏公共财物: 'severe',
      私藏手机: 'moderate',
      宿舍卫生脏乱: 'moderate',
    }
    for (const [label, severity] of Object.entries(expected)) {
      const preset = VIOLATION_PRESETS.find((item) => item.label === label)
      expect(preset, `预设「${label}」缺失`).toBeDefined()
      expect(preset?.defaultSeverity, `预设「${label}」等级`).toBe(severity)
    }
    // 映射表里的行为必须都在清单里（反向兜底：清单多了没登记的项会被上面的循环漏掉）
    expect(VIOLATION_PRESETS).toHaveLength(Object.keys(expected).length)
  })

  it('原有 22 条事件 id 保持不变（历史 presetId 仍能关联）', () => {
    const originalIds = [
      'routine-late',
      'routine-truancy',
      'routine-talk',
      'routine-sleep',
      'routine-rest',
      'collective-skip-exercise',
      'collective-late',
      'collective-slow',
      'hygiene-messy',
      'hygiene-personal',
      'hygiene-duty',
      'dormitory-noise',
      'dormitory-phone',
      'other-leave-early',
      'other-leave-school',
      'other-supplies',
      'other-disrupt-class',
      'other-off-area',
      'other-disobey',
      'other-fight',
      'other-bully',
      'other-damage',
    ]
    for (const id of originalIds) expect(findViolationPreset(id), `预设 ${id} 缺失`).toBeDefined()
  })

  it('「多次迟到」「卫生脏乱且多次提醒不改」不是独立事件类型', () => {
    const labels = VIOLATION_PRESETS.map((preset) => preset.label)
    expect(labels).not.toContain('多次迟到')
    expect(labels).not.toContain('卫生脏乱且多次提醒不改')
  })

  it('查找函数：命中 / 未命中 / 历史上下线 id 都安全', () => {
    expect(findViolationPreset('routine-late')?.label).toBe('迟到')
    expect(defaultSeverityOfPreset('other-fight')).toBe('severe')
    expect(findViolationPreset('removed-preset')).toBeUndefined()
    expect(findViolationPreset(undefined)).toBeUndefined()
    expect(findViolationPreset('')).toBeUndefined()
    expect(defaultSeverityOfPreset('removed-preset')).toBeUndefined()
    // utils 层也暴露同一份查找（页面不必直接 import config）
    expect(findViolationPresetById('routine-talk')?.label).toBe('上课说话')
  })
})

/* ==================== 类型守卫 / 标签 ==================== */

describe('类型守卫与标签表', () => {
  it('严重程度 / 时间段 / 预设来源枚举与标签表覆盖全部取值', () => {
    for (const severity of KNOWN_VIOLATION_SEVERITIES) {
      expect(isViolationSeverity(severity)).toBe(true)
      expect(VIOLATION_SEVERITY_LABELS[severity]).toBeTruthy()
    }
    for (const kind of KNOWN_VIOLATION_TIME_SLOT_KINDS) {
      expect(isViolationTimeSlotKind(kind)).toBe(true)
      expect(VIOLATION_TIME_SLOT_LABELS[kind]).toBeTruthy()
    }
    expect(isViolationPresetKind('system')).toBe(true)
    expect(isViolationPresetKind('custom')).toBe(true)
    expect(isViolationPresetKind('other')).toBe(false)
    expect(isViolationSeverity('critical')).toBe(false)
    expect(isViolationTimeSlotKind('')).toBe(false)
    expect(isViolationTimeSlotKind(undefined)).toBe(false)
  })

  it('日期校验：只认真实存在的 YYYY-MM-DD', () => {
    expect(isValidViolationDate('2026-11-03')).toBe(true)
    expect(isValidViolationDate('2026-02-30')).toBe(false)
    expect(isValidViolationDate('2026-13-01')).toBe(false)
    expect(isValidViolationDate('2026-1-3')).toBe(false)
    expect(isValidViolationDate('')).toBe(false)
    expect(isValidViolationDate(20261103)).toBe(false)
  })
})

/* ==================== parseViolationRecord：读路径三分 ==================== */

describe('parseViolationRecord：读路径不丢事实', () => {
  it('完整合法记录原样保留（含全部可选字段）', () => {
    const result = parseEvent(
      rawEvent({
        timeSlotKind: 'period',
        periodId: 'p3',
        periodLabel: '第3节',
        subject: '数学',
        presetId: 'routine-late',
        description: '早读迟到 10 分钟',
        teacherNote: '已当面提醒',
        parentNote: '家长表示会督促',
      }),
    )
    expect(result).toMatchObject({
      id: 'v-1',
      studentId: 's1',
      studentName: '旦增卓玛',
      date: '2026-11-03',
      timeSlotKind: 'period',
      behaviorLabel: '迟到',
      severity: 'minor',
      periodId: 'p3',
      periodLabel: '第3节',
      subject: '数学',
      presetId: 'routine-late',
      description: '早读迟到 10 分钟',
      teacherNote: '已当面提醒',
      parentNote: '家长表示会督促',
    })
  })

  it('缺可选字段时不臆造：可选键根本不出现', () => {
    const result = parseEvent(rawEvent())
    for (const key of [
      'periodId',
      'periodLabel',
      'subject',
      'customTimeText',
      'presetId',
      'description',
      'teacherNote',
      'parentNote',
    ]) {
      expect(key in result, `${key} 不该出现`).toBe(false)
    }
  })

  it('可选字段是空串 / 只有空白时同样不写键（空串与「没填」只留一种状态）', () => {
    const result = parseEvent(rawEvent({ description: '   ', teacherNote: '', parentNote: '\n\t' }))
    expect('description' in result).toBe(false)
    expect('teacherNote' in result).toBe(false)
    expect('parentNote' in result).toBe(false)
  })

  it('正文与备注自动去首尾空白', () => {
    const result = parseEvent(
      rawEvent({ behaviorLabel: '  迟到  ', description: ' 描述 ', parentNote: ' 家长意见 ' }),
    )
    expect(result.behaviorLabel).toBe('迟到')
    expect(result.description).toBe('描述')
    expect(result.parentNote).toBe('家长意见')
  })

  it('未知严重程度：**不折算**成已知等级，整条隔离并原样保留', () => {
    const raw = rawEvent({ severity: 'critical', presetId: 'other-fight' })
    const parsed = parseViolationRecord(raw)
    expect(parsed.kind).toBe('quarantined')
    if (parsed.kind !== 'quarantined') return
    expect(parsed.reason).toBe('unknown-severity')
    // 原对象本身保留（不克隆、不包装）：后续写盘才会逐字段不变
    expect(parsed.raw).toBe(raw)
    expect(parsed.raw.severity).toBe('critical')
    // 关键：没有变成预设默认（other-fight → severe），也没有变成 minor
    expect(parsed.raw.severity).not.toBe('severe')
    expect(parsed.raw.severity).not.toBe('minor')
  })

  it('未知严重程度的几种形态都隔离：新枚举值 / 非字符串 / 空串 / 缺失', () => {
    for (const severity of ['critical', 'severe-plus', 123, '', undefined]) {
      const parsed = parseViolationRecord(rawEvent({ severity }))
      expect(parsed.kind, `severity=${String(severity)}`).toBe('quarantined')
    }
    // 连 id 都没有的记录无法参与按 id 的合并与追溯 → 只能判为不可用
    expectInvalid(rawEvent({ severity: 'critical', id: undefined }))
  })

  it('未知严重程度 + 其它字段也认不出 → 仍然隔离（旧版本无权丢弃未知版本的数据）', () => {
    const parsed = parseViolationRecord(
      rawEvent({ severity: 'critical', category: 'future-category', date: '未来日期' }),
    )
    expect(parsed.kind).toBe('quarantined')
  })

  it('非法日期 → 丢弃（没有发生日期的记录不再是一次可以定位的事实）', () => {
    expectInvalid(rawEvent({ date: '2026-02-30' }))
    expectInvalid(rawEvent({ date: '' }))
    expectInvalid(rawEvent({ date: undefined }))
  })

  it('必填项缺失逐项丢弃：学生 / 时间段 / 行为文本（分类已取消，缺 category 合法）', () => {
    expectInvalid(rawEvent({ studentId: '' }))
    expectInvalid(rawEvent({ studentId: 42 }))
    expectInvalid(rawEvent({ timeSlotKind: '' }))
    expectInvalid(rawEvent({ behaviorLabel: '  ' }))
    expectInvalid(null)
    expectInvalid('x')
    expectInvalid([])
  })

  it('旧 category 读时兼容、写时收敛：保留事实、重建对象不再输出 category', () => {
    // v3.8.0 旧记录带 category；缺失 category 的合法记录也必须能读
    const oldWithCategory = parseEvent(rawEvent({ category: 'routine' }))
    const withoutCategory = parseEvent(rawEvent())
    expect('category' in oldWithCategory).toBe(false)
    expect('category' in withoutCategory).toBe(false)
    expect(oldWithCategory.behaviorLabel).toBe('迟到')
    expect(oldWithCategory.severity).toBe('minor')
    // 未来/未知分类值同样不影响读取
    expect(parseEvent(rawEvent({ category: 'future-category' })).behaviorLabel).toBe('迟到')
  })

  it('presetKind 可选；给了非法值 → 拒绝写入（不做猜测）', () => {
    expect(parseEvent(rawEvent({ presetId: 'routine-late' })).presetKind).toBeUndefined()
    expect(parseEvent(rawEvent({ presetId: 'custom-x', presetKind: 'custom' })).presetKind).toBe(
      'custom',
    )
    expectInvalid(rawEvent({ presetId: 'routine-late', presetKind: 'other' }))
    // 历史记录缺 presetKind 时按 presetId 推断来源；other-custom 归为 custom
    expect(presetKindOfEvent({ presetId: 'routine-late' })).toBe('system')
    expect(presetKindOfEvent({ presetId: 'custom-x' })).toBe('custom')
    expect(presetKindOfEvent({ presetId: LEGACY_CUSTOM_PRESET_ID })).toBe('custom')
    expect(presetKindOfEvent({})).toBeUndefined()
  })

  it('id 缺失时补一个新的稳定 id（同一份数据只补一次，不会每次读都变）', () => {
    const first = parseEvent(rawEvent({ id: undefined }))
    const second = parseEvent(rawEvent({ id: undefined }))
    expect(first.id).toBeTruthy()
    expect(second.id).toBeTruthy()
    expect(first.id).not.toBe(second.id)
    // 已有 id 原样保留（导入 / 跨端同步要按 id 对齐）
    expect(parseEvent(rawEvent({ id: 'keep-me' })).id).toBe('keep-me')
  })

  it('时间戳缺失时按创建时刻补齐，且 updatedAt 不早于 createdAt', () => {
    const result = parseEvent(rawEvent({ createdAt: undefined, updatedAt: undefined }))
    expect(result.createdAt).toBeTruthy()
    expect(result.updatedAt).toBe(result.createdAt)
    const onlyCreated = parseEvent(
      rawEvent({ createdAt: '2026-01-01T00:00:00.000Z', updatedAt: undefined }),
    )
    expect(onlyCreated.updatedAt).toBe(onlyCreated.createdAt)
  })
})

/* ==================== 时间段（复用课表） ==================== */

describe('时间段：第 X 节课复用课表、自定义必须有文本', () => {
  it('period：合法节次 → 名称快照缺失时由课表定义派生', () => {
    const result = parseEvent(
      rawEvent({ timeSlotKind: 'period', periodId: 'p2', periodLabel: undefined }),
    )
    expect(result.timeSlotKind).toBe('period')
    expect(result.periodId).toBe('p2')
    expect(result.periodLabel).toBe('第2节')
  })

  it('period：已有名称快照优先（历史口径不被课表改动改写）', () => {
    const result = parseEvent(
      rawEvent({
        timeSlotKind: 'period',
        periodId: 'morning',
        periodLabel: '早读',
        subject: '语文',
      }),
    )
    expect(result.periodLabel).toBe('早读')
    expect(result.subject).toBe('语文')
  })

  it('period：节次 id 认不出但教师填了名称 → 保留名称、丢掉坏 id', () => {
    const result = parseEvent(
      rawEvent({ timeSlotKind: 'period', periodId: 'p99', periodLabel: '第五节' }),
    )
    expect(result.periodLabel).toBe('第五节')
    expect('periodId' in result).toBe(false)
  })

  it('period：节次与名称都没有 → 丢弃（没有时间段的记录等于没有发生时间）', () => {
    expectInvalid(rawEvent({ timeSlotKind: 'period', periodId: 'p99' }))
  })

  it('custom：必须有自定义时间文本', () => {
    expectInvalid(rawEvent({ timeSlotKind: 'custom', customTimeText: '' }))
    const result = parseEvent(rawEvent({ timeSlotKind: 'custom', customTimeText: '午休期间' }))
    expect(result.customTimeText).toBe('午休期间')
  })

  it('事实枚举类时间段不携带 periodId / 科目 / 自定义文本（剔除自相矛盾的脏数据）', () => {
    const result = parseEvent(
      rawEvent({
        timeSlotKind: 'morning',
        periodId: 'p3',
        periodLabel: '第3节',
        subject: '数学',
        customTimeText: '午休',
      }),
    )
    expect('periodId' in result).toBe(false)
    expect('periodLabel' in result).toBe(false)
    expect('subject' in result).toBe(false)
    expect('customTimeText' in result).toBe(false)
  })

  it('时间段展示文本：三种形态各自读法', () => {
    expect(formatViolationTimeSlot(event({ timeSlotKind: 'lights-out' }))).toBe('熄灯后')
    expect(
      formatViolationTimeSlot(event({ timeSlotKind: 'period', periodId: 'p3', subject: '数学' })),
    ).toBe('第3节 · 数学')
    expect(
      formatViolationTimeSlot(
        event({ timeSlotKind: 'period', periodId: 'p3', periodLabel: '第三节' }),
      ),
    ).toBe('第三节')
    expect(
      formatViolationTimeSlot(event({ timeSlotKind: 'custom', customTimeText: '午休期间' })),
    ).toBe('午休期间')
    expect(formatViolationOccurredAt(event({ date: '2026-11-03' }))).toBe('11月3日 上午')
  })
})

/* ==================== cleanViolationDraft：写路径严格 ==================== */

describe('cleanViolationDraft：写路径不猜', () => {
  const valid = {
    studentId: 's1',
    date: '2026-11-03',
    timeSlotKind: 'forenoon',
    behaviorLabel: '迟到',
    severity: 'minor',
  }

  it('合法草稿通过，并去掉可选字段的空白', () => {
    const draft = cleanViolationDraft({
      ...valid,
      behaviorLabel: ' 迟到 ',
      description: ' 描述 ',
      parentNote: '   ',
    })
    expect(draft).toMatchObject({ studentId: 's1', behaviorLabel: '迟到', description: '描述' })
    expect('parentNote' in draft!).toBe(false)
  })

  it('非法严重程度 → 整条拒绝（写路径不回落，不能悄悄改教师选的等级）', () => {
    expect(cleanViolationDraft({ ...valid, severity: 'critical' })).toBeNull()
    expect(cleanViolationDraft({ ...valid, severity: undefined })).toBeNull()
  })

  it('行为文本为空 → 拒绝（不拿预设名顶上）', () => {
    expect(cleanViolationDraft({ ...valid, behaviorLabel: '   ' })).toBeNull()
  })

  it('学生 / 日期 / 时间段不合法 → 拒绝（分类已取消，不再参与校验）', () => {
    expect(cleanViolationDraft({ ...valid, studentId: '' })).toBeNull()
    expect(cleanViolationDraft({ ...valid, date: '2026-2-30' })).toBeNull()
    expect(cleanViolationDraft({ ...valid, timeSlotKind: 'dawn' })).toBeNull()
    expect(cleanViolationDraft(null)).toBeNull()
  })

  it('可选的 presetKind：缺省合法，非法值拒绝', () => {
    expect(cleanViolationDraft(valid)).not.toBeNull()
    expect(cleanViolationDraft({ ...valid, presetKind: 'other' })).toBeNull()
    expect(
      cleanViolationDraft({ ...valid, presetId: 'routine-late', presetKind: 'system' }),
    ).toMatchObject({ presetId: 'routine-late', presetKind: 'system' })
  })

  it('draftOfViolation 与 normalize 互逆：事件 → 草稿 → 再校验仍是同一条', () => {
    const original = event({ timeSlotKind: 'period', periodId: 'p4', subject: '英语' })
    const draft = draftOfViolation(original)
    expect(cleanViolationDraft(draft)).toEqual(draft)
    expect(draft).toMatchObject({ periodId: 'p4', periodLabel: '第4节', subject: '英语' })
  })
})

/* ==================== revive：合法事件 + 隔离记录 + 丢弃统计 ==================== */

describe('reviveViolationRecords（混合数组）', () => {
  it('重复 id 的合法事件只保留首条（重复会让统计多数一次、v-for key 冲突）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const revived = reviveViolationRecords([
      rawEvent({ id: 'dup', behaviorLabel: '迟到' }),
      rawEvent({ id: 'dup', behaviorLabel: '旷课' }),
    ])
    const events = revived.filter(isViolationEvent)
    expect(events).toHaveLength(1)
    expect(events[0]?.behaviorLabel).toBe('迟到')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('混合脏数据：合法事件留下、未知严重程度被隔离、其余非法丢弃、不抛异常', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const unknownSeverity = rawEvent({ id: 'ok-2', severity: 'weird', presetId: 'routine-late' })
    const revived = reviveViolationRecords([
      rawEvent({ id: 'ok-1' }),
      null,
      rawEvent({ id: 'bad-date', date: '2026-13-40' }),
      'not-an-object',
      unknownSeverity,
    ])
    expect(revived).toHaveLength(2)
    expect(isViolationEvent(revived[0])).toBe(true)
    expect(isQuarantinedViolationRecord(revived[1])).toBe(true)
    // 隔离的原对象**原样**保留：severity 仍是 'weird'，没被折算成 minor / 预设默认
    expect(revived[1]).toBe(unknownSeverity)
    expect(isViolationEvent(revived[1])).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('不修改传入的原始数组（盘上原文留着人工找回）', () => {
    const raw = [rawEvent({ id: 'a' }), rawEvent({ id: 'b' })]
    const snapshot = JSON.parse(JSON.stringify(raw)) as unknown
    reviveViolationRecords(raw)
    expect(raw).toEqual(snapshot)
  })
})

/* ==================== 排序 ==================== */

describe('sortViolationEvents', () => {
  it('日期倒序 → 同日创建时间倒序 → id 兜底', () => {
    const sorted = sortViolationEvents([
      event({ id: 'v-a', date: '2026-11-01', createdAt: '2026-11-01T01:00:00.000Z' }),
      event({ id: 'v-b', date: '2026-11-03', createdAt: '2026-11-03T01:00:00.000Z' }),
      event({ id: 'v-c', date: '2026-11-03', createdAt: '2026-11-03T02:00:00.000Z' }),
      event({ id: 'v-d', date: '2026-11-03', createdAt: '2026-11-03T02:00:00.000Z' }),
    ])
    expect(sorted.map((item) => item.id)).toEqual(['v-c', 'v-d', 'v-b', 'v-a'])
  })

  it('不修改入参顺序', () => {
    const input = [event({ id: 'x', date: '2026-11-01' }), event({ id: 'y', date: '2026-11-05' })]
    const before = input.map((item) => item.id)
    sortViolationEvents(input)
    expect(input.map((item) => item.id)).toEqual(before)
  })
})

/* ==================== 姓名快照刷新 ==================== */

describe('姓名快照刷新（关联只认 studentId）', () => {
  it('学生改名后，历史记录的姓名快照跟着刷新', () => {
    const records = [event({ id: 'v-1', studentId: 's1', studentName: '旧名字' })]
    const refreshed = refreshViolationStudentNames(records, [student('s1', '新名字')])
    expect(refreshed[0]?.studentName).toBe('新名字')
    expect(refreshed[0]?.studentId).toBe('s1')
  })

  it('学生软删除后：记录不丢失、仍按原学生关联、快照保留', () => {
    const records = [event({ id: 'v-1', studentId: 's1', studentName: '旦增卓玛' })]
    const deleted = student('s1', '旦增卓玛', { deletedAt: '2026-11-10T00:00:00.000Z' })
    const refreshed = refreshViolationStudentNames(records, [deleted])
    expect(refreshed).toHaveLength(1)
    expect(refreshed[0]?.studentId).toBe('s1')
    expect(refreshed[0]?.studentName).toBe('旦增卓玛')
  })

  it('学生从档案里彻底消失时，保留记录自带的快照（历史不能凭空消失）', () => {
    const records = [event({ id: 'v-1', studentId: 'gone', studentName: '已转学同学' })]
    const refreshed = refreshViolationStudentNames(records, [student('s1', '别人')])
    expect(refreshed).toHaveLength(1)
    expect(refreshed[0]?.studentName).toBe('已转学同学')
  })

  it('同名学生的快照带身份证尾号（与全站消歧规则一致）', () => {
    const records = [event({ id: 'v-1', studentId: 's1', studentName: '旦增卓玛' })]
    const students = [
      student('s1', '旦增卓玛', { idCardSuffix: '3287' }),
      student('s2', '旦增卓玛', { idCardSuffix: '1245' }),
    ]
    const refreshed = refreshViolationStudentNames(records, students)
    expect(refreshed[0]?.studentName).toBe('旦增卓玛（3287）')
  })
})
