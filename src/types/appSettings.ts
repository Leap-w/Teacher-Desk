/**
 * 应用设置（v3.0.4-rc 新增 · **v3.1.0 收敛为「时光中心」一个嵌套块**）。
 *
 * 这是**一套统一的时间与外观设置**，首页 Hero 与「我的 → 工作时光」共用它——
 * 此前 Hero 的倒计时与工作时光各读一份（`composables/useCountdownSettings.ts`
 * 的 `teacherdesk:countdown`），改一处另一处不动，口径迟早分叉。
 *
 * **时间的唯一容器是 `timeCenter`**（v3.1.0）：
 * ```
 * timeCenter: {
 *   serviceStart, semesterStart, semesterEnd,   // 三个日期，一组事实
 *   countdowns[],                                // 只有自定义项（内置三项由日期派生）
 *   heroCountdownId,                             // 首页 Hero 显示哪一项
 * }
 * ```
 * 首页 Hero、工作时光、时光中心设置页全部读它，**不存在第二份日期或第二份选择**。
 *
 * 其余字段与用途一一对应：
 * - `heroBackground` Hero 背景 → **首页**
 * - `heroSubtitle`   Hero 副标题（问候与日期之下的一行说明，空则不显示）→ **首页**
 * - `showProgress`   是否显示进度条与百分比（V1.3.1 起的开关）→ **首页 / 工作时光**
 *
 * **v3.1.0 删除的字段**（规格第五节：连同字段一起删除）：
 * - `defaultHomeView`——「默认首页」整项撤下，启动改道逻辑同步拆掉（`App.vue`）。
 * - `heroTitle`——倒计时卡的标题**改为取所选倒计时自己的名称**（内置项名称固定、
 *   自定义项在时光中心里填），再留一个 `heroTitle` 就是同一行字的第二个来源。
 * - `countdownTarget`——由 `timeCenter.heroCountdownId` 取代。语义从「三选一」扩成
 *   「内置三项 + 任意自定义项」，取值也从日期字段名变成了倒计时 id。
 *
 * 持久化形状是**单元素数组**（对齐备份模块「一个键 = 一个数组」的硬约束，
 * 与 `types/user.ts` 的个人资料同一处置）。
 */
import type { SeatView } from '@/types/seat'
import type { CoursePeriodId } from '@/types/timetable'

/** 内置倒计时的 id：**即 `TimeCenter` 的日期字段名**，取日期时直接 `timeCenter[id]` */
export type BuiltinCountdownId = 'serviceStart' | 'semesterStart' | 'semesterEnd'

/**
 * 内置三项（v3.1.0）。
 *
 * **名称固定、日期由上面三个日期字段驱动、不可删**——所以它们**不进 `countdowns`**：
 * 再存一份日期就等于同一个日子有两个来源，改一处另一处不动（正是 v3.0.4-rc 之前
 * Hero 与工作时光对不上的老毛病）。每一项只在首页那个「首页显示」的单选上竞争。
 */
export const BUILTIN_COUNTDOWNS: {
  id: BuiltinCountdownId
  /** 列表与 Hero 卡片上的名称（固定，不可编辑） */
  name: string
  /** Hero 角标上的短名，如「期末 2027-01-24」 */
  short: string
  /** 列表行下方的一句说明，点明它跟着哪个日期字段走 */
  hint: string
}[] = [
  { id: 'semesterEnd', name: '距离期末', short: '期末', hint: '跟着「期末日期」走' },
  { id: 'semesterStart', name: '距离开学', short: '开学', hint: '跟着「开学日期」走' },
  { id: 'serviceStart', name: '距离出发', short: '出发', hint: '跟着「支教开始日期」走' },
]

/** 默认的「首页显示」项——与 v3.0.5-rc 的默认目标一致（距离期末） */
export const DEFAULT_HERO_COUNTDOWN_ID: BuiltinCountdownId = 'semesterEnd'

/** 自定义倒计时（时光中心里新建 / 编辑 / 删除的那些） */
export interface CustomCountdown {
  /** 本机生成的稳定 id（`c-<时间戳>-<随机>`），Hero 用它指认 */
  id: string
  /** 名称，如「距离国庆放假」（不可为空） */
  name: string
  /** 目标日期（`YYYY-MM-DD`） */
  date: string
}

/**
 * 时光中心（v3.1.0）：时间的唯一容器。
 *
 * 三组内容与设置页的三组一一对应：学期时间（开学 / 期末）、支教时间（开始）、
 * 自定义倒计时（列表 + 哪一项进 Hero）。
 */
export interface TimeCenter {
  /** 支教开始日期（`YYYY-MM-DD`）——工作天数的起点 */
  serviceStart: string
  /** 学期开学日期（`YYYY-MM-DD`）——学期进度的起点 */
  semesterStart: string
  /** 学期期末日期（`YYYY-MM-DD`）——学期进度的终点 */
  semesterEnd: string
  /** **只放自定义项**；内置三项由上面三个日期派生，见 `BUILTIN_COUNTDOWNS` */
  countdowns: CustomCountdown[]
  /** 首页 Hero 显示哪一项：内置 id 或自定义 id；认不出回 `DEFAULT_HERO_COUNTDOWN_ID` */
  heroCountdownId: string
}

/** 一份应用设置 */
export interface AppSettings {
  /** 首页 Hero 背景图 URL（预设或自定义） */
  heroBackground: string
  /** 首页 Hero 副标题（问候与日期之下的一行说明；空字符串 = 不显示这一行） */
  heroSubtitle: string
  /** 时间设置（学期 / 支教 / 倒计时）——首页 Hero 与工作时光的唯一来源 */
  timeCenter: TimeCenter
  /** 是否显示进度条与百分比（沿用 V1.3.1 的开关，未删除） */
  showProgress: boolean
  /** 教学设置（v3.3.0）：课程时间与座位图默认视角 */
  teaching: TeachingSettings
}

/* ========== 教学设置（v3.3.0） ========== */

/**
 * 一个时段的上下课时间（`HH:mm`，24 小时制）。
 *
 * **教师只能改这两个时间**：`id / label / order / group` 是课表的骨架，
 * 改它们等于换一套时段模型，牵动导入模板、换课约束与统计口径——不在设置范围内。
 */
export interface PeriodTime {
  start: string
  end: string
}

/**
 * 课程时间的自定义覆盖：**只存被改过的时段**，其余走 `COURSE_PERIODS` 的原值。
 *
 * 存「差异」而不是存整份 10 条：默认课表是全校统一的作息，教师通常只微调一两节；
 * 存整份会让「学校改了作息、应用升级带了新默认值」这件事永远生效不了
 * （盘上那份旧拷贝会把新默认值整体盖住）。
 */
export type PeriodTimes = Partial<Record<CoursePeriodId, PeriodTime>>

/** 教学设置（v3.3.0）：本机偏好，不进备份与云端同步（与其余设置同一口径） */
export interface TeachingSettings {
  /** 打开座位表时的默认视角；教师仍可在座位页临时切换（那次切换不写盘） */
  seatDefaultView: SeatView
  /** 课程时间的自定义覆盖（空对象 = 全部走默认课表） */
  periodTimes: PeriodTimes
}

/** 首页 Hero 背景预设（与昌都记忆同源的高原图；也可填自定义 URL） */
export const HERO_BACKGROUNDS: { id: string; label: string; url: string }[] = [
  {
    id: 'snow',
    label: '昌都雪山',
    url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1600&auto=format&fit=crop&q=80',
  },
  {
    id: 'starry',
    label: '高原星夜',
    url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1600&auto=format&fit=crop&q=80',
  },
  {
    id: 'ridge',
    label: '群山远眺',
    url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600&auto=format&fit=crop&q=80',
  },
]

/** 日期字段的合法形状（仓储与界面共用同一份，避免两处正则各写各的） */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 时段时间的合法形状：`HH:mm`，24 小时制（同上，一处定义两处用） */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
