/**
 * 真实教室固定配置（高一9班 · 7 排 × 9 列 · 3-3-3 · 63 座、占用 62）。
 * 字段类型使用字面量锁定：教室不是自由画布，编译期即禁止改列数 / 过道位置；
 * 布局代码统一从 DEFAULT_CLASSROOM_CONFIG 读取，禁止把教室参数硬编码进组件。
 */

/** 讲台方位（固定：前方中央） */
export type PodiumPosition = 'front-center'

/** 前门方位（固定：右前） */
export type FrontDoorPosition = 'right-front'

/** 后门方位（固定：左后） */
export type BackDoorPosition = 'left-back'

/** 窗户方位（固定：右侧） */
export type WindowSide = 'right'

/** 教室配置 */
export interface ClassroomConfig {
  /** 班级名 */
  name: string
  /** 座位排数（前后方向） */
  rows: 7
  /** 每排列数（左右方向） */
  cols: 9
  /** 过道切分：从左到右每个列块的宽度（左 3｜中 3｜右 3，两条过道） */
  blocks: readonly [3, 3, 3]
  /** 座位总数（rows × cols） */
  totalSeats: 63
  /** 可安排学生的座位数（末排尾座固定留空） */
  occupiedSeats: 62
  podium: PodiumPosition
  frontDoor: FrontDoorPosition
  backDoor: BackDoorPosition
  windows: WindowSide
}

/** 默认教室配置（唯一事实来源；代码不得另写教室参数） */
export const DEFAULT_CLASSROOM_CONFIG = {
  name: '高一9班',
  rows: 7,
  cols: 9,
  blocks: [3, 3, 3],
  totalSeats: 63,
  occupiedSeats: 62,
  podium: 'front-center',
  frontDoor: 'right-front',
  backDoor: 'left-back',
  windows: 'right',
} as const satisfies ClassroomConfig
