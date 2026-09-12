/**
 * 「我的」个人资料（V1.1.6）。
 *
 * 这是**教师本人**的资料（称呼 / 学校 / 班级 / 学科 / 头像），与学生档案、课程表等
 * 业务数据完全独立——改这里的班级名不会动 Student Store，改学科也不会动课程表。
 * 头像以 dataURL 形式存本地（不上云、不进备份模块——备份模块只认「一个键 = 一个数组」，
 * 见 utils/backup.ts；个人资料单对象另立一页，接入备份/云同步留待后续阶段）。
 */

/** 一份教师个人资料 */
export interface UserProfile {
  /** 头像（dataURL；空 = 未设置，显示昵称首字） */
  avatar?: string
  /** 昵称 / 称呼 */
  nickname: string
  /** 学校 */
  school: string
  /** 当前班级（如「高一9班」） */
  className: string
  /** 任教学科（如「数学」） */
  subject: string
}

/** 新增 / 编辑资料时的可写字段（avatar 单独走 setAvatar / removeAvatar） */
export type UserProfileInput = Omit<UserProfile, 'avatar'>

/** 头像 dataURL 的体积上限：base64 后写 localStorage，超限会挤占教师业务数据的配额 */
export const AVATAR_MAX_BYTES = 1024 * 1024

/** 头像 dataURL 的合法前缀（只收图片） */
export const AVATAR_DATA_PREFIX = 'data:image/'
