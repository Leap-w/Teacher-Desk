/**
 * Widget 快照的**纯函数生成器**（v3.7.0）。
 *
 * 它是 Web 侧唯一的「课程表 → 快照」实现：输入是**只读的**课程数组 + 生效时段表，
 * 输出是 `WidgetSnapshot`。不碰 Vue、不碰存储、不碰浏览器 API——所以能在 node 自检里
 * 直接喂数组跑（`src/__tests__/widgetSnapshot.test.ts`）。
 *
 * 为什么要把「今天」排除在外：快照是**事实层**，不是「此刻的画面」。Widget 的渲染时机
 * 由系统决定（可能拿的是几小时前写的那份），把 `today` 烘进去就会出现「今天显示昨天的课」。
 * 这一点与 `types/widget.ts` 顶部的说明同源。
 */
import { formatClock, formatDateKey, formatMonthDay } from '@/utils/date'
import { WEEKDAY_LABELS, WEEKDAY_SHORT_LABELS, WEEKDAYS } from '@/utils/timetable'
import {
  WIDGET_SNAPSHOT_SCHEMA_VERSION,
  type WidgetSnapshot,
  type WidgetSnapshotDay,
  type WidgetSnapshotLesson,
  type WidgetSnapshotPeriod,
} from '@/types/widget'
import type { CoursePeriod, Lesson } from '@/types/timetable'

/** 生成快照需要的全部输入（都由调用方从**只读**入口取，页面与仓储共用同一份数据） */
export interface WidgetSnapshotSources {
  /** **生效**时段表（`appSettings.periods`：默认作息叠加教师在教学设置里的覆盖） */
  periods: readonly CoursePeriod[]
  /** 全部课程（换课 / 代课已经在数据层落定，这里读到的就是最终课表） */
  lessons: readonly Lesson[]
  /** TeacherDesk 的地址（`window.location.origin`） */
  pwaBaseUrl: string
  /** 班级名；拿不到给空串 */
  className: string
  /** 写入时刻（由调用方注入，便于自检钉住时间与文案） */
  now: Date
}

/** 一次快照里「学生 / 教师」看不到的东西一个都不放：这里的投影只保留 Widget 真会画的字段 */
function periodOf(period: CoursePeriod): WidgetSnapshotPeriod {
  return {
    id: period.id,
    label: period.label,
    shortLabel: period.shortLabel,
    startTime: period.startTime,
    endTime: period.endTime,
    order: period.order,
    group: period.group,
  }
}

/**
 * 把课程按天摊开。
 *
 * 两条边界值得说明：
 * - **同一位置出现两节课**（手改 localStorage / 跨端合并的脏数据）时保留**先出现的那条**，
 *   而不是把两条都写进快照——那会让 Widget 画出一格两行、把行高顶掉；数据层本就有
 *   「同一教师同一时段只能一节课」的不变式（`findSlotConflict`），这里只做兜底。
 * - 排序一律走时段表的 `order`：不依赖课程数组的原始顺序（导入 / 换课都会打乱它）。
 */
function dayOf(
  weekday: number,
  label: string,
  shortLabel: string,
  lessons: readonly Lesson[],
  orderOf: ReadonlyMap<string, number>,
): WidgetSnapshotDay {
  const seen = new Set<string>()
  const picked: { periodId: string; subject: string; order: number }[] = []
  for (const lesson of lessons) {
    if (lesson.weekday !== weekday) continue
    if (seen.has(lesson.periodId)) continue
    seen.add(lesson.periodId)
    // 不认识的时段（旧数据 / 未来新增）：跳过而不是猜一个位置——排序键都没有，
    // 硬塞进来只会让这一天的顺序莫名其妙
    const order = orderOf.get(lesson.periodId)
    if (order === undefined) continue
    picked.push({ periodId: lesson.periodId, subject: lesson.subject, order })
  }
  picked.sort((a, b) => a.order - b.order)
  const mapped: WidgetSnapshotLesson[] = picked.map((item) => ({
    periodId: item.periodId,
    subject: item.subject,
  }))
  return { weekday, label, shortLabel, lessons: mapped }
}

/**
 * 生成快照。**纯函数**：同样的输入必然得到同样的输出（`now` 也由调用方给）。
 */
export function buildWidgetSnapshot(sources: WidgetSnapshotSources): WidgetSnapshot {
  const periods = [...sources.periods].sort((a, b) => a.order - b.order)
  const orderOf = new Map(periods.map((period) => [period.id as string, period.order]))

  const week: WidgetSnapshotDay[] = WEEKDAYS.map((weekday) =>
    dayOf(
      weekday,
      WEEKDAY_LABELS[weekday],
      WEEKDAY_SHORT_LABELS[weekday],
      sources.lessons,
      orderOf,
    ),
  )

  return {
    schemaVersion: WIDGET_SNAPSHOT_SCHEMA_VERSION,
    generator: 'teacherdesk-web',
    updatedAt: sources.now.toISOString(),
    updatedAtLabel: formatStamp(sources.now),
    pwaBaseUrl: sources.pwaBaseUrl,
    className: sources.className,
    periods: periods.map(periodOf),
    week,
  }
}

/**
 * 快照文件的内容（**缩进过的 JSON**）。
 *
 * 为什么不留成一行压缩：这个文件是**可以被人直接 `cat` 的**——排查「Widget 怎么不更新」
 * 时，第一件事就是看盘上那份快照对不对（宿主 App 里也有「打开快照所在文件夹」）。
 * 缩进只有几百字节的代价，换的是「肉眼能核对」。
 *
 * 末尾带换行：它是文件，不是网络载荷；不带换行的 JSON 在 `cat` 时会和 shell 提示符粘在一起。
 */
export function serializeWidgetSnapshot(snapshot: WidgetSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`
}

/** 快照文件里显示的写入时刻（「9月30日 14:05」）——复用日期工具，不另写一套格式化 */
function formatStamp(date: Date): string {
  return `${formatMonthDay(formatDateKey(date))} ${formatClock(date)}`
}
