/**
 * 代课记录领域类型（v3.7.5）。
 *
 * **这是「事实台账」，不是课表**：一条代课记录说的是「某天某节，某某老师的课由某某老师上」。
 * 它与 `Lesson`（课程表）**完全隔离**——不生成 `Lesson`、不生成 `CourseExchange`、
 * 不出现在课程表页、删改互不影响（见 store 顶部注释）。
 *
 * 之所以独立成模块而不是挂在 `Lesson` 上：`Lesson` 是**长期固定的周课表**（只有`weekday`、
 * 没有具体日期），代课却天然带**具体某一天**——两者混在一起，任何一次课表调整都会顺手
 * 改掉代课台账，反过来也一样。分开存之后，各自的数据互不越界。
 *
 * 历史数据说明：`Lesson.type === 'substitute'` 是 v3.7.5 之前表达代课的老写法，
 * 它**没有日期**（只有星期），无法可靠地还原成一条带日期的代课记录，
 * 因此**不做迁移**、原样留在课表里（不丢弃、不猜测转换、不重复迁移）。
 */
import type { CoursePeriodId } from './timetable'

/** 一条代课记录 */
export interface SubstituteRecord {
  id: string
  /** 代课日期（YYYY-MM-DD）：具体哪一天，不是星期 */
  date: string
  /** 节次（复用课程表的 10 个时段，`COURSE_PERIODS`） */
  periodId: CoursePeriodId
  /** 被代课教师：原任课教师（课原本是他的） */
  originalTeacher: string
  /** 实际代课教师：实际去上课的人 */
  substituteTeacher: string
  /** 科目，如「数学」 */
  subject: string
  /** 备注（选填）：如「原教师病假」 */
  remark?: string
  /** 建档时刻（ISO 字符串；只用于内部排序与排错，界面不展示） */
  createdAt: string
}

/** 新增 / 编辑代课记录时的可写字段（`id` / `createdAt` 由 store 生成） */
export type SubstituteInput = Omit<SubstituteRecord, 'id' | 'createdAt'>

/** 统计的一句话口径：某位教师在筛选范围内代课了多少节 */
export interface SubstituteTeacherCount {
  /** 教师名（按名聚合，不做花名册匹配——教师不是学生，项目里没有教师实体） */
  name: string
  /** 节数 */
  count: number
}

/**
 * 筛选范围内的代课统计（界面实时算，不落库、不缓存——数字必须跟当前记录一致）。
 * `bySubstituteTeacher` / `byOriginalTeacher` 均按节数降序、同数按姓名拼音升序。
 */
export interface SubstituteSummary {
  /** 代课总节数（= 筛选范围内的记录条数，一条记录就是一节） */
  total: number
  /** 按实际代课教师分组 */
  bySubstituteTeacher: SubstituteTeacherCount[]
  /** 按被代课教师分组 */
  byOriginalTeacher: SubstituteTeacherCount[]
}
