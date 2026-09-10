/**
 * 课程表领域类型（Phase 4 引入，Phase 5 扩展为「课程中心」）。
 * **全项目只有这一个 Lesson 模型**：工作台「今日课程」与 `/schedule` 周课表共用同一份数据与同一套类型
 * （Phase 5 要求「不兼容两套 Lesson」）。
 */

/** 星期（1 = 周一 … 7 = 周日；与 JS `Date.getDay()` 的 0 = 周日不同，见 `weekdayOf`） */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** 一节课（本班 / 任教班级的某天某个节次） */
export interface Lesson {
  id: string
  weekday: Weekday
  /** 节次（第几节，从 1 起；可录入范围见 `LESSON_PERIODS`） */
  period: number
  /** 科目，如「数学」 */
  subject: string
  /**
   * 班级标识。Phase 5 尚无「班级」实体（学生档案里只有班级名），
   * 由班级名确定性派生（`classIdOf`）；接入班级实体后替换为真实 id，字段语义不变。
   */
  classId: string
  /** 上课班级名，如「高一9班」 */
  className: string
  /** 任课教师：本人课表为「我」，代课时填实际授课教师 */
  teacher: string
  /** 上课地点（可选），如「A 栋 302」 */
  location?: string
  /** 是否临时代课；为 true 时课表卡片显示「代课」标签 */
  isTemporary?: boolean
}

/** 新增 / 编辑课程时的可写字段（`id` 由 store 生成） */
export type LessonInput = Omit<Lesson, 'id'>
