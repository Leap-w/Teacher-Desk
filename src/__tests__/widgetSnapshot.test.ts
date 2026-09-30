/**
 * Widget 快照生成器的自检（v3.7.0）。
 *
 * 这一层盯的是**「Widget 上少了一节课、多了一节课、或者顺序不对」**这类错——
 * 它们不会报错，屏幕上也不会异常，只有把桌面上的小组件与课程页对着看才发现：
 *
 * ① **顺序**必须与课程页自上而下一致（按时段的 `order`，不是按数组原序）；
 *   ①b **主信息是班级**（v3.7.1）：数学老师每节的科目都一样，「哪个班」才是要看的；
 * ② **只读投影**：时段 / 星期名一律来自 `COURSE_PERIODS` 与 `WEEKDAY_LABELS`，
 *    快照里不许出现 Swift 侧自己拼的第二种说法；
 * ③ **空**（某天没课 / 某节没课）在快照里就是「没有这条」，不是补一条空科目；
 * ④ **不烘「今天」**：快照里没有 today 字段——它必须是一份「谁在哪天第几节上什么」的事实。
 */
import { describe, expect, it } from 'vitest'

import { buildWidgetSnapshot, serializeWidgetSnapshot } from '@/utils/widgetSnapshot'
import { WIDGET_SNAPSHOT_SCHEMA_VERSION } from '@/types/widget'
import { COURSE_PERIODS } from '@/types/timetable'
import type { CoursePeriod, Lesson, Weekday } from '@/types/timetable'

const NOW = new Date(2026, 8, 30, 14, 5, 0) // 2026-09-30 14:05 本地

function lesson(weekday: Weekday, periodId: Lesson['periodId'], subject: string): Lesson {
  return {
    id: `${weekday}-${periodId}`,
    weekday,
    periodId,
    subject,
    className: '高一9班',
    classId: 'gaoyi-9',
    teacher: '我',
    type: 'normal',
  }
}

function build(lessons: Lesson[], periods: readonly CoursePeriod[] = COURSE_PERIODS) {
  return buildWidgetSnapshot({
    periods,
    lessons,
    pwaBaseUrl: 'https://teacher-desk.example.com',
    className: '高一9班',
    now: NOW,
  })
}

describe('快照的骨架', () => {
  it('头部字段：格式版本 / 生成者 / 写入时刻与中文标签 / 地址 / 班级名', () => {
    const snapshot = build([])
    expect(snapshot.schemaVersion).toBe(WIDGET_SNAPSHOT_SCHEMA_VERSION)
    expect(snapshot.generator).toBe('teacherdesk-web')
    expect(snapshot.updatedAt).toBe(NOW.toISOString())
    expect(snapshot.updatedAtLabel).toBe('9月30日 14:05')
    expect(snapshot.pwaBaseUrl).toBe('https://teacher-desk.example.com')
    expect(snapshot.className).toBe('高一9班')
  })

  it('**不烘「今天」**：快照里没有任何以「今天」为准的字段', () => {
    const serialized = serializeWidgetSnapshot(build([]))
    expect(serialized).not.toContain('today')
    expect(serialized).not.toContain('今日')
  })

  it('时段表原样来自课程表定义（10 节，顺序与文案都不另写一套）', () => {
    const snapshot = build([])
    expect(snapshot.periods.map((period) => period.id)).toEqual(
      COURSE_PERIODS.map((period) => period.id),
    )
    expect(snapshot.periods[0]).toEqual({
      id: 'morning',
      label: '早自习及第一节',
      shortLabel: '早自习',
      startTime: '07:40',
      endTime: '09:05',
      order: 1,
      group: 'morning',
    })
    expect(snapshot.periods).toHaveLength(10)
    // 顺序必须按 order 升序：调用方给乱序也照样对
    const shuffled = build([], [...COURSE_PERIODS].reverse())
    expect(shuffled.periods.map((period) => period.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('一周恒 7 天，星期名来自项目的星期定义', () => {
    const snapshot = build([])
    expect(snapshot.week.map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(snapshot.week.map((day) => day.label)).toEqual([
      '星期一',
      '星期二',
      '星期三',
      '星期四',
      '星期五',
      '星期六',
      '星期日',
    ])
    expect(snapshot.week.map((day) => day.shortLabel)).toEqual([
      '周一',
      '周二',
      '周三',
      '周四',
      '周五',
      '周六',
      '周日',
    ])
  })
})

describe('课程投影', () => {
  it('按天分好，且**按节次顺序**排（与课程页自上而下一致）', () => {
    const snapshot = build([
      lesson(2, 'evening1', '数学'),
      lesson(2, 'p2', '英语'),
      lesson(2, 'morning', '语文'),
      lesson(1, 'p3', '物理'),
    ])
    const tuesday = snapshot.week[1]!
    expect(tuesday.lessons).toEqual([
      { periodId: 'morning', className: '高一9班', subject: '语文' },
      { periodId: 'p2', className: '高一9班', subject: '英语' },
      { periodId: 'evening1', className: '高一9班', subject: '数学' },
    ])
    expect(snapshot.week[0]!.lessons).toEqual([
      { periodId: 'p3', className: '高一9班', subject: '物理' },
    ])
  })

  it('**没课的时段不占位**：不补空科目、不补「—」', () => {
    const snapshot = build([lesson(3, 'p5', '体育')])
    const wednesday = snapshot.week[2]!
    expect(wednesday.lessons).toHaveLength(1)
    expect(wednesday.lessons[0]).toEqual({
      periodId: 'p5',
      className: '高一9班',
      subject: '体育',
    })
    // 其余六天一条都没有（Widget 那边画「—」是它的事，快照不替它编内容）
    expect(snapshot.week.filter((day) => day.lessons.length === 0)).toHaveLength(6)
  })

  it('科目名原样带过去，不截断不改写（过长由 Widget 决定怎么省略）', () => {
    const long = '数学（竞赛班·走班课·实验楼三层）'
    const snapshot = build([lesson(1, 'p2', long)])
    expect(snapshot.week[0]!.lessons[0]!.subject).toBe(long)
  })

  it('同一位置两条脏数据：保留先出现的那条，不让 Widget 一格两行', () => {
    const snapshot = build([lesson(1, 'p2', '先到的'), lesson(1, 'p2', '后到的')])
    expect(snapshot.week[0]!.lessons).toEqual([
      { periodId: 'p2', className: '高一9班', subject: '先到的' },
    ])
  })

  it('不认识的时段（旧数据 / 未来新增）跳过，而不是猜一个位置', () => {
    const stray = { ...lesson(1, 'p2', '幽灵课'), periodId: 'p99' as Lesson['periodId'] }
    const snapshot = build([lesson(1, 'p2', '真课'), stray])
    expect(snapshot.week[0]!.lessons).toEqual([
      { periodId: 'p2', className: '高一9班', subject: '真课' },
    ])
  })
})

describe('主信息是**班级**（v3.7.1）', () => {
  it('每节课都带上班级名——数学老师十节课都是数学，班级才是要看的', () => {
    const snapshot = build([
      lesson(1, 'morning', '数学'),
      lesson(1, 'p2', '数学'),
      lesson(2, 'morning', '数学'),
    ])
    // 三个不同班级、同一科目：主信息必须能区分它们
    const classes = snapshot.week.flatMap((day) => day.lessons).map((item) => item.className)
    expect(classes).toEqual(['高一9班', '高一9班', '高一9班'])
    expect(snapshot.week[0]!.lessons.map((item) => item.subject)).toEqual(['数学', '数学'])
  })

  it('科目不同时班级照旧是主信息，两者都在快照里（界面只画班级）', () => {
    const other: Lesson = { ...lesson(3, 'p3', '物理'), className: '高一10班' }
    const snapshot = build([lesson(3, 'p3', '数学'), other])
    // 同一位置只留一条 → 这里换成两天各一条
    const snapshot2 = build([lesson(3, 'p3', '数学'), { ...other, weekday: 4 }])
    expect(snapshot.week[2]!.lessons[0]!.subject).toBe('数学')
    expect(snapshot2.week[3]!.lessons[0]!.className).toBe('高一10班')
  })
})

describe('文件内容', () => {
  it('缩进 2 空格的 JSON + 结尾换行（教师能直接 `cat` 出来核对）', () => {
    const text = serializeWidgetSnapshot(build([lesson(1, 'morning', '数学')]))
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain(`\n  "schemaVersion": ${WIDGET_SNAPSHOT_SCHEMA_VERSION},`)
    expect(text).toContain('"subject": "数学"')
    // 缩进确实是 2 空格一层（不是一行压扁的 JSON）
    expect(text).toMatch(/\n {2}"week": \[/)
    expect(JSON.parse(text)).toMatchObject({ schemaVersion: WIDGET_SNAPSHOT_SCHEMA_VERSION })
  })

  it('同样的输入给出**逐字节相同**的内容（除了调用方给的时间）', () => {
    const first = serializeWidgetSnapshot(build([lesson(4, 'p6', '化学')]))
    const second = serializeWidgetSnapshot(build([lesson(4, 'p6', '化学')]))
    expect(second).toBe(first)
  })
})
