/**
 * 课程表领域类型（Phase 4 引入，Phase 5 扩展为「课程中心」，V1.1.3 升级为「工作管理 · 课程表」）。
 * **全项目只有这一个 Lesson 模型**：工作台「今日课程」与 `/schedule` 周课表共用同一份数据与同一套类型。
 *
 * V1.1.3 的两处结构性变化：
 * 1. 节次从「第 1~8 节」（数字）改为**固定的 10 个时间段**（`periodId`），时间定义集中在
 *    本文件的 `COURSE_PERIODS`——页面、导入、校验、统计全部从这里读（要求「时间定义必须集中管理」）；
 * 2. 课程增加**类型**（正常 / 代课 / 调课）与**换课记录**（`CourseExchange`），
 *    课程与换课记录分键存放（`teacherdesk:timetable` / `teacherdesk:timetable:exchanges`）。
 *
 * **不设上课地点**：`Lesson.location` 只作为历史字段兼容读取（load 时不丢弃、但不再展示、
 * 不参与导入模板、新功能一律不依赖它）。
 */

/** 星期（1 = 周一 … 7 = 周日；与 JS `Date.getDay()` 的 0 = 周日不同，见 `weekdayOf`） */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/* ========== 时间段（唯一时间配置） ========== */

/**
 * 时间段 id。**共 10 个**：第一个是「早自习及第一节」（07:40–09:05，**不拆成两段**），
 * 后面是第 2~7 节与三节晚自习（**三节独立**，可分别换课与统计）。
 */
export type CoursePeriodId =
  'morning' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6' | 'p7' | 'evening1' | 'evening2' | 'evening3'

/** 时段归属（用于分组展示：上午 / 白天 / 晚自习） */
export type CoursePeriodGroup = 'morning' | 'day' | 'evening'

export interface CoursePeriod {
  id: CoursePeriodId
  /** 完整名称，如「早自习及第一节」 */
  label: string
  /** 窄空间用的短名，如「早自习」「第2节」「晚自习1」 */
  shortLabel: string
  /** 开始时间 HH:mm */
  startTime: string
  /** 结束时间 HH:mm */
  endTime: string
  /** 顺序（1 起，升序即课程表自上而下的顺序） */
  order: number
  group: CoursePeriodGroup
}

/**
 * **唯一的时间定义**（要求「不要在组件中散落 07:40 / 09:05 …」）：
 * 页面渲染、Excel 导入校验、冲突判定、课时统计全部读它。改上课时间只改这里。
 */
export const COURSE_PERIODS: readonly CoursePeriod[] = [
  {
    id: 'morning',
    label: '早自习及第一节',
    shortLabel: '早自习',
    startTime: '07:40',
    endTime: '09:05',
    order: 1,
    group: 'morning',
  },
  {
    id: 'p2',
    label: '第2节',
    shortLabel: '第2节',
    startTime: '09:20',
    endTime: '10:00',
    order: 2,
    group: 'day',
  },
  {
    id: 'p3',
    label: '第3节',
    shortLabel: '第3节',
    startTime: '10:30',
    endTime: '11:10',
    order: 3,
    group: 'day',
  },
  {
    id: 'p4',
    label: '第4节',
    shortLabel: '第4节',
    startTime: '11:25',
    endTime: '12:05',
    order: 4,
    group: 'day',
  },
  {
    id: 'p5',
    label: '第5节',
    shortLabel: '第5节',
    startTime: '15:00',
    endTime: '15:40',
    order: 5,
    group: 'day',
  },
  {
    id: 'p6',
    label: '第6节',
    shortLabel: '第6节',
    startTime: '16:00',
    endTime: '16:40',
    order: 6,
    group: 'day',
  },
  {
    id: 'p7',
    label: '第7节',
    shortLabel: '第7节',
    startTime: '16:55',
    endTime: '17:35',
    order: 7,
    group: 'day',
  },
  {
    id: 'evening1',
    label: '晚自习1',
    shortLabel: '晚自习1',
    startTime: '19:30',
    endTime: '20:10',
    order: 8,
    group: 'evening',
  },
  {
    id: 'evening2',
    label: '晚自习2',
    shortLabel: '晚自习2',
    startTime: '20:20',
    endTime: '21:00',
    order: 9,
    group: 'evening',
  },
  {
    id: 'evening3',
    label: '晚自习3',
    shortLabel: '晚自习3',
    startTime: '21:10',
    endTime: '21:50',
    order: 10,
    group: 'evening',
  },
]

/** 全部时段 id（升序）：遍历 / 下拉 / 校验共用 */
export const COURSE_PERIOD_IDS: readonly CoursePeriodId[] = COURSE_PERIODS.map(
  (period) => period.id,
)

/**
 * 三节晚自习的 id（顺序固定）。
 * **数据层仍是三个独立时段**（可分别换课、分别统计），只是允许共享 `courseGroupId`
 * 表达「同一科目的连续晚自习」——不要合并成 19:30–21:50 的一段。
 */
export const EVENING_PERIOD_IDS: readonly CoursePeriodId[] = ['evening1', 'evening2', 'evening3']

/**
 * 旧数据迁移表（V1.1.3 前 `Lesson.period` 是数字 1~8）：
 * 按顺序落到新时段的前 8 个 —— 第 1 节 → 早自习及第一节，第 8 节 → 晚自习1。
 * **确定性、可重放**，不丢任何一条课程（教师可在界面上再调整）。
 */
export const LEGACY_PERIOD_MIGRATION: Record<number, CoursePeriodId> = {
  1: 'morning',
  2: 'p2',
  3: 'p3',
  4: 'p4',
  5: 'p5',
  6: 'p6',
  7: 'p7',
  8: 'evening1',
}

/* ========== 课程 ========== */

/** 课程类型：正常 / 代课 / 调课（换课后的新位置标为 adjusted） */
export type LessonType = 'normal' | 'substitute' | 'adjusted'

/** 一节课（本班 / 任教班级的某天某个时段） */
export interface Lesson {
  id: string
  weekday: Weekday
  /** 时段 id（见 `COURSE_PERIODS`）；V1.1.2 及更早是 `period: number`，load 时自动迁移 */
  periodId: CoursePeriodId
  /** 科目，如「数学」 */
  subject: string
  /**
   * 班级标识。项目尚无「班级」实体（学生档案里只有班级名），
   * 由班级名确定性派生（`classIdOf`）；接入班级实体后替换为真实 id，字段语义不变。
   */
  classId: string
  /** 上课班级名，如「高一9班」 */
  className: string
  /** 任课教师：本人课表为「我」，代课时填实际授课教师 */
  teacher: string
  /** 课程类型（缺省视为 normal，兼容旧数据） */
  type: LessonType
  /** 代课时的原授课教师（`type === 'substitute'` 时必填），如「张老师」 */
  originalTeacher?: string
  /** 调课标记：指向 `CourseExchange.id`（本课是由某次换课调整过来的） */
  exchangeId?: string
  /** 晚自习组 id：同一科目连续三节晚自习共享它（三节仍是独立课程） */
  courseGroupId?: string
  /** V1.1.2 及更早的代课标记；load 时并入 `type`，新数据不再写入 */
  isTemporary?: boolean
  /** **历史字段**：上课地点。V1.1.3 起不再展示、不导入、新功能不依赖（兼容读取不丢数据） */
  location?: string
}

/** 新增 / 编辑课程时的可写字段（`id` 由 store 生成） */
export type LessonInput = Omit<Lesson, 'id'>

/** 课程的可复原快照（换课记录里存一份，撤销时用它把原课程放回去） */
export type LessonSnapshot = Omit<Lesson, 'id' | 'weekday' | 'periodId'>

/* ========== 换课 ========== */

/** 一个课程位置（换课记录的两端） */
export interface CourseSlot {
  weekday: Weekday
  periodId: CoursePeriodId
  className: string
  subject: string
}

/**
 * 换课记录：**原课程 → 调整后课程**。
 *
 * 换课不是「改科目」，因此不复用编辑：原位置的课程被移走（原时间由本记录渲染「调课」标记），
 * 目标位置生成一条 `type: 'adjusted'` 的新课程（`exchangeId` 指回本记录）；
 * `fromLesson` 存原课程快照，撤销时原样放回。
 */
export interface CourseExchange {
  id: string
  from: CourseSlot
  to: CourseSlot
  /** 原课程快照（撤销换课时复原用） */
  fromLesson: LessonSnapshot
  /** 是否属于「整组晚自习一起调」 */
  group: boolean
  createdAt: string
}
