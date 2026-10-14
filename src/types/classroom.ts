/**
 * 真实教室固定配置（高一9班 · 7 排 × 9 列 · 3-3-3 · 63 座、占用 62）。
 * 字段类型使用字面量锁定：教室不是自由画布，编译期即禁止改列数 / 过道位置；
 * 布局代码统一从 DEFAULT_CLASSROOM_CONFIG 读取，禁止把教室参数硬编码进组件。
 *
 * **v3.7.4 起「固定空位」= 第 1 排第 9 列**（此前实现为「末排尾座」= 第 7 排第 9 列）。
 * 固定空位是**教室本身**的属性（永久留空、不安排任何学生、换座后也不移动），
 * 因此放在本文件而不是某个功能模块里；「自动排座」与「顺序轮换」共用同一份定义。
 */

/** 讲台方位（固定：前方中央） */
export type PodiumPosition = 'front-center'

/** 前门方位（固定：左前） */
export type FrontDoorPosition = 'left-front'

/**
 * 后门方位（v3.2.0：固定左后——与座位图参考图一致，前门 / 后门同在**左墙**，
 * 学生视角下镜像到右墙）。
 *
 * 注：v1.1.2–v3.1.0 曾把两门标在右墙。v3.2.0 的座位图参考图里门窗是对墙的
 * （窗在右、两门在左），按「参考图是唯一标准」改到左墙；**只动了这两条方位常量，
 * 座位数据与方案结构一行未改**。视角切换时门窗按各自视角的方位挂墙（不靠旋转画布），
 * 排号 / 座位号始终是物理号——见 `utils/seatView.ts` 与开发手册 §9.62 / §9.63。
 */
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
  /** 可安排学生的座位数（= totalSeats − 1，扣掉 fixedEmptySeat 那一个固定空位） */
  occupiedSeats: 62
  /**
   * 固定空位：物理坐标（v3.7.4 起 = 第 1 排第 9 列）。
   * **永久留空**：所有自动排布（新建方案的就座 / 自动排座 / 顺序轮换）都不占用它，
   * 顺序轮换还会在结果里保证它为空（输入里若被手动拖入过学生，会先挪走并回报）。
   * 由 `utils/seat.ts` 的 `isFixedEmptySeat` / `availableSeatOrdinals` 统一消费。
   */
  fixedEmptySeat: { readonly row: 1; readonly col: 9 }
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
  fixedEmptySeat: { row: 1, col: 9 },
  podium: 'front-center',
  frontDoor: 'left-front',
  backDoor: 'left-back',
  windows: 'right',
} as const satisfies ClassroomConfig
