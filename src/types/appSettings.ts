/**
 * 应用设置（v3.0.4-rc 新增）。
 *
 * 这是**一套统一的时间与外观设置**，首页 Hero 与「我的 → 工作时光」共用它——
 * 此前 Hero 的倒计时与工作时光各读一份（`composables/useCountdownSettings.ts`
 * 的 `teacherdesk:countdown`），改一处另一处不动，口径迟早分叉。
 *
 * 字段与用途一一对应（**任何一处改日期，两个地方同步更新**）：
 * - `serviceStart` 支教开始日期 → **工作天数**（首页「第 X 天」/ 工作时光「支教天数」）
 * - `semesterStart` 开学日期 → **学期进度**（工作时光进度条 / 首页进度条）
 * - `semesterEnd`   期末日期 → **学期倒计时**（首页 Hero 倒计时卡）
 * - `heroBackground` Hero 背景 → **首页**
 * - `heroTitle`     Hero 文案（倒计时标题）→ **首页**
 * - `defaultHomeView` 打开应用时默认落在哪一页
 *
 * 持久化形状是**单元素数组**（对齐备份模块「一个键 = 一个数组」的硬约束，
 * 与 `types/user.ts` 的个人资料同一处置）。
 */

/** 一份应用设置 */
export interface AppSettings {
  /** 首页 Hero 背景图 URL（预设或自定义） */
  heroBackground: string
  /** 首页 Hero 倒计时卡的标题文案，如「距离期末考试」 */
  heroTitle: string
  /** 学期开学日期（`YYYY-MM-DD`）——学期进度的起点 */
  semesterStart: string
  /** 学期期末日期（`YYYY-MM-DD`）——学期倒计时的终点 */
  semesterEnd: string
  /** 支教开始日期（`YYYY-MM-DD`）——工作天数的起点 */
  serviceStart: string
  /** 打开应用时默认视图（路由路径；`/` = 首页） */
  defaultHomeView: string
  /** 是否显示进度条与百分比（沿用 V1.3.1 的开关，未删除） */
  showProgress: boolean
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

/** 「默认首页」可选视图（第一项为默认；值即路由路径） */
export const HOME_VIEW_OPTIONS: { value: string; label: string }[] = [
  { value: '/', label: '首页' },
  { value: '/work/schedule', label: '课程表' },
  { value: '/students', label: '学生档案' },
  { value: '/class/seats', label: '座位管理' },
  { value: '/my', label: '我的' },
]
