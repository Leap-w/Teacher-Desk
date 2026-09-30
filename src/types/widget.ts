/**
 * macOS 桌面小组件的**只读快照契约**（v3.7.0）。
 *
 * 这个文件只说一件事：**Web 侧交给 Widget 的字节长什么样**。它不含任何业务判定，
 * 也没有第二套课程表模型——快照里的每一条都是从 `Schedule Store / Repository`
 * 与 `types/timetable.ts` 的时段定义里原样搬过来的（规格 §三：现有课程表是唯一数据源）。
 *
 * ## 三条纪律
 *
 * 1. **单向**。快照只有 Web → Widget 一个方向（`src/services/widgetBridge.ts` 只写不读业务数据）。
 *    Widget 既不回写课程表，也不写任何业务键（规格 §二十二）。
 * 2. **数据是事实，不是「今天」**。快照里没有 `today` 字段——今天该看哪一列由 Widget
 *    按**它自己的系统日期**算（`SnapshotDerive`）。包进「今天」的话，一份昨晚写的快照
 *    在今天早上会继续显示昨天的课（规格 §十五要的正是「按当前星期高亮」）。
 * 3. **文案由 Web 定**。星期名、节次名、时间都来自 `COURSE_PERIODS` / `WEEKDAY_LABELS`，
 *    随快照一起带过去；Swift 侧不重新拼一套「第2节」或「星期一」——那样两边迟早不一致
 *    （规格 §十三：以项目实际数据结构为准，不要硬编码旧版本节次）。
 */

/**
 * 快照格式版本。
 *
 * v2（v3.7.1）：每节课多了 `className` —— 小组件的主信息从**科目**改成**班级**
 * （数学老师一天十节都是数学，「数学」重复十遍没有信息量，「哪个班」才是要看的）。
 * v1 的快照仍能解码：班级缺席时 Widget 退回显示科目，所以这个 +1 不是硬墙，
 * 它保证「快照比小组件新」时能明确提示更新。
 *
 * **加字段必须一起加它**（只在语义变化时 +1）：
 * Widget 侧解码时按它判断「这份快照我认不认得」，不认得就显示「请更新 TeacherDesk」，
 * 而不是猜着读一半、渲染出一张看着正常的错课表。
 */
export const WIDGET_SNAPSHOT_SCHEMA_VERSION = 2

/** 快照里的一条时段定义（`COURSE_PERIODS` 的只读投影） */
export interface WidgetSnapshotPeriod {
  /** `CoursePeriodId`，如 `morning` / `p2` / `evening1` */
  id: string
  /** 完整名，如「早自习及第一节」 */
  label: string
  /** 窄空间短名，如「早自习」「第2节」「晚自习1」 */
  shortLabel: string
  /** 开始时间 `HH:mm`（**生效作息**：教师在教学设置里改过的以改过的为准） */
  startTime: string
  /** 结束时间 `HH:mm` */
  endTime: string
  /** 顺序（1 起，升序即课表自上而下） */
  order: number
  /** 归属分组：上午 / 白天 / 晚自习 */
  group: 'morning' | 'day' | 'evening'
}

/**
 * 快照里的一节课。
 *
 * 三个字段，都是 Widget 真会画的（规格 §十 / §二十六 明确不要教室、完成状态、倒计时……）：
 *
 * - `className` 是**主信息**（v3.7.1 起）：教师看的是「下一节去哪个班」。
 * - `subject` 仍带在快照里：**本版小组件不显示它**（教师的主科每行都一样，重复写是噪声），
 *   留着是为了将来做「代课 / 跨科」标记以及宿主面板的诊断——数据在手上，界面不喧哗。
 * - `periodId` 对应 `periods[].id`，决定这一节排在哪一行。
 */
export interface WidgetSnapshotLesson {
  /** 时段 id（对应 `periods[].id`） */
  periodId: string
  /** 班级名，如「高一9班」（过长由 Widget 缩排/截断，快照不做加工） */
  className: string
  /** 科目名，如「数学」（本版小组件不显示，见上） */
  subject: string
}

/** 快照里的一天 */
export interface WidgetSnapshotDay {
  /** 1 = 周一 … 7 = 周日（与 `Weekday` 同口径，不用 JS 的 0 = 周日） */
  weekday: number
  /** 完整星期名（「星期一」） */
  label: string
  /** 短星期名（「周一」，周视图列头用它） */
  shortLabel: string
  /** 当天的课（按时段升序；没课的时段**不占位**，Widget 自己画「—」） */
  lessons: WidgetSnapshotLesson[]
}

/** `teacherdesk:widget-snapshot.json` 的完整形状 */
export interface WidgetSnapshot {
  /** 格式版本，见 `WIDGET_SNAPSHOT_SCHEMA_VERSION` */
  schemaVersion: number
  /** 谁写的（诊断用；目前永远是 `teacherdesk-web`） */
  generator: string
  /** 写入时刻（ISO 8601，带毫秒与 Z） */
  updatedAt: string
  /** 同一时刻的中文标签（「9月30日 14:05」），Widget 直接显示，不再自己格式化 */
  updatedAtLabel: string
  /**
   * TeacherDesk 的地址（`window.location.origin`）。Widget 点击时用它拼目标页；
   * 写在快照里而不是写死在 Swift 里：换域名 / 本机 dev 都不用改 Widget 源码。
   */
  pwaBaseUrl: string
  /** 教师本人的班级名（班主任那张班；拿不到就是空串；宿主 App 的诊断面板显示它） */
  className: string
  /** 生效的时段表（10 条，顺序即课表顺序） */
  periods: WidgetSnapshotPeriod[]
  /** 一周七天（恒 7 条，周一→周日） */
  week: WidgetSnapshotDay[]
}
