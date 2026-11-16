/**
 * 学生照片缩略图展示位置 —— **纯逻辑**（v3.8.3 Phase 1）。
 *
 * 边界（与 `utils/studentViewPrefs.ts` 同一口径）：
 * - 这是「这台设备上的观看方式」，**不是教师业务数据**：不进 `StudentPhoto`、
 *   不进 `teacherdesk:studentPhotos`、不注册 `syncPersisted`（因此不进 CloudBase
 *   整键 LWW）、不进 JSON 备份。
 * - 本文件只有纯函数：解析 / 钳制 / 合并 / 删除 / CSS 取值，不碰 localStorage；
 *   落盘在 `services/photoThumbPositionStorage.ts`，页面统一走
 *   `composables/usePhotoThumbPosition.ts`。
 * - 只调 CSS `object-position`：**不裁图、不改 Blob、不重新生成缩略图**，
 *   也没有任何人脸 / 主体识别。
 */
import { appConfig } from '@/config'

/** 单张照片的展示位置（object-position 的百分比） */
export interface PhotoThumbPosition {
  x: number
  y: number
}

/** 整本机配置：photoId → 位置 */
export type PhotoThumbPositionMap = Record<string, PhotoThumbPosition>

/** 独立本地键；与业务键 `teacherdesk:studentPhotos` 无任何关系 */
export const PHOTO_THUMB_POSITION_KEY = `${appConfig.storageKeyPrefix}:photoWall:display`

/** 默认偏上取景：证件照的头肩通常在上半部 */
export const DEFAULT_PHOTO_THUMB_POSITION: Readonly<PhotoThumbPosition> = { x: 50, y: 30 }

/** 数值合法时钳到 0–100；非 number / NaN / Infinity 一律判非法 */
export function clampPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, value))
}

/** 把任意输入规整成合法位置；缺字段 / 非法数值返回 null（由调用方回退默认值） */
export function normalizePosition(value: unknown): PhotoThumbPosition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const x = clampPercent(record.x)
  const y = clampPercent(record.y)
  return x === null || y === null ? null : { x, y }
}

/** 取某张照片的位置；没有配置就用默认值（每次返回新对象，避免调用方改到常量） */
export function positionOf(
  map: Readonly<PhotoThumbPositionMap>,
  photoId: string,
): PhotoThumbPosition {
  // 只认自有属性：`__proto__` / `constructor` 这类键不能顺着原型链取到东西
  const found = Object.prototype.hasOwnProperty.call(map, photoId) ? map[photoId] : undefined
  return found
    ? (normalizePosition(found) ?? { ...DEFAULT_PHOTO_THUMB_POSITION })
    : { ...DEFAULT_PHOTO_THUMB_POSITION }
}

/** 转成 CSS object-position 值 */
export function cssPositionOf(position: Readonly<PhotoThumbPosition>): string {
  return `${position.x}% ${position.y}%`
}

/* ---------- 拖动换算（v3.8.3：从调整面板抽出的纯逻辑） ---------- */

/** `object-fit: cover` 放大后，图片在两个方向上各有多少像素可被挪动；0 = 该轴无可动空间 */
export interface CoverSlack {
  x: number
  y: number
}

/**
 * 算 cover 下的可挪动余量。
 *
 * cover 的放大量 = max(框宽/图宽, 框高/图高)，放大后超出框的部分才允许通过
 * `object-position` 平移出来。任一边长非正（图还没解码出来 / 容器未布局）时返回 0，
 * 让调用方把拖动判为「无效」而不是算出 NaN。
 */
export function coverSlackOf(
  boxWidth: number,
  boxHeight: number,
  imageWidth: number,
  imageHeight: number,
): CoverSlack {
  if (!(boxWidth > 0) || !(boxHeight > 0) || !(imageWidth > 0) || !(imageHeight > 0)) {
    return { x: 0, y: 0 }
  }
  const scale = Math.max(boxWidth / imageWidth, boxHeight / imageHeight)
  return {
    x: Math.max(0, imageWidth * scale - boxWidth),
    y: Math.max(0, imageHeight * scale - boxHeight),
  }
}

/**
 * 指针移动 (dx, dy) 之后的新位置。
 *
 * 方向：`object-position` 百分比越大，图片越往**左上**走（偏移量 = -slack × P/100），
 * 所以「把照片往右拖」必须**减小** x，图片才会跟着手指一起往右。往回推即
 * `P' = P - dx / slack × 100`；余量为 0 的轴原样保留（不除零）。
 * 结果钳到 0–100；非有限值退回起始值。
 */
export function positionAfterDrag(
  start: Readonly<PhotoThumbPosition>,
  delta: Readonly<{ dx: number; dy: number }>,
  slack: Readonly<CoverSlack>,
): PhotoThumbPosition {
  const nextX = slack.x > 0 ? start.x - (delta.dx / slack.x) * 100 : start.x
  const nextY = slack.y > 0 ? start.y - (delta.dy / slack.y) * 100 : start.y
  return {
    x: clampPercent(nextX) ?? start.x,
    y: clampPercent(nextY) ?? start.y,
  }
}

/**
 * 解析盘上原文：非法 JSON / 非对象 / 个别条目坏掉都只丢坏的那几条，
 * 好条目全部保留，**任何情况下都不抛**。
 *
 * 结果用 `Object.create(null)`：盘上的键名不可信，`"__proto__": {...}` 若往普通
 * 对象上赋值会改掉它的原型（拿不到本该有的条目），无原型对象直接当普通键处理。
 */
export function parsePositionMap(raw: string | null): PhotoThumbPositionMap {
  const result = Object.create(null) as PhotoThumbPositionMap
  if (!raw) return result
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result
    for (const [photoId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!photoId) continue
      const position = normalizePosition(value)
      if (position) result[photoId] = position
    }
  } catch {
    // 坏 JSON 当作「没有配置」——界面偏好坏掉不该让照片墙打不开
  }
  return result
}

export function serializePositionMap(map: Readonly<PhotoThumbPositionMap>): string {
  return JSON.stringify(map)
}

/** 增改一张（不可变更新） */
export function withPosition(
  map: Readonly<PhotoThumbPositionMap>,
  photoId: string,
  position: Readonly<PhotoThumbPosition>,
): PhotoThumbPositionMap {
  return { ...map, [photoId]: { x: position.x, y: position.y } }
}

/** 删除一张；本来就没有则原样返回（不制造无谓写入） */
export function withoutPosition(
  map: Readonly<PhotoThumbPositionMap>,
  photoId: string,
): PhotoThumbPositionMap {
  if (!Object.prototype.hasOwnProperty.call(map, photoId)) return map
  const next: PhotoThumbPositionMap = { ...map }
  delete next[photoId]
  return next
}
