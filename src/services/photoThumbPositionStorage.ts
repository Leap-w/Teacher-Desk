/**
 * 缩略图展示位置的**落盘层**（v3.8.3 Phase 1）。
 *
 * 只走全应用唯一的 localStorage 出口 `services/storage.ts`，并且**不注册
 * syncPersisted**（`utils/studentViewPrefs.ts` 的同一口径）：这个键不会进入
 * 跨标签页业务广播、不会进 CloudBase 整键 LWW、不会进 JSON 备份。
 *
 * 写失败必须让调用方知道——`writeJSON` 的 `false` 同时表示「内容没变（幂等，
 * 其实是成功）」和「写不进去」，这里先用盘上原文区分这两种情况，再把真实结果
 * 返回给 composable，由界面给出提示，绝不假装保存成功。
 */
import { readRaw, writeJSON } from '@/services/storage'
import {
  PHOTO_THUMB_POSITION_KEY,
  parsePositionMap,
  serializePositionMap,
  withPosition,
  withoutPosition,
  type PhotoThumbPosition,
  type PhotoThumbPositionMap,
} from '@/utils/photoThumbPosition'

/** 读整份配置；读不到 / 解析失败都按「没有配置」处理，不抛 */
export function loadPhotoThumbPositions(): PhotoThumbPositionMap {
  try {
    return parsePositionMap(readRaw(PHOTO_THUMB_POSITION_KEY))
  } catch {
    return {}
  }
}

/** 返回 false 唯一含义：盘上没有写进去（内存也不该更新） */
function commit(map: PhotoThumbPositionMap): boolean {
  let diskRaw: string | null = null
  try {
    diskRaw = readRaw(PHOTO_THUMB_POSITION_KEY)
  } catch {
    // 读不出来时按「写失败」处理，宁可不改内存也不假装成功
    return false
  }
  const text = serializePositionMap(map)
  if (diskRaw === text) return true
  // 没有配置且盘上本来就没有这个键：不需要为了「恢复默认」凭空造一个 {}
  if (Object.keys(map).length === 0 && diskRaw === null) return true
  return writeJSON(PHOTO_THUMB_POSITION_KEY, map)
}

/** 保存一张照片的位置 */
export function savePhotoThumbPosition(
  photoId: string,
  position: Readonly<PhotoThumbPosition>,
): boolean {
  return commit(withPosition(loadPhotoThumbPositions(), photoId, position))
}

/** 删除一张照片的位置配置（恢复默认） */
export function removePhotoThumbPosition(photoId: string): boolean {
  return commit(withoutPosition(loadPhotoThumbPositions(), photoId))
}

/**
 * 批量删除多张照片的位置配置（照片被永久删除后清理，避免无效条目长期积累）。
 *
 * 一次读、一次写：批量操作不该为每张照片各写一遍盘。
 * 只删传入的 id，其余条目原样保留；本来就没有则视为成功（无写入）。
 */
export function removePhotoThumbPositions(photoIds: readonly string[]): boolean {
  const before = loadPhotoThumbPositions()
  let next = before
  for (const photoId of photoIds) next = withoutPosition(next, photoId)
  if (next === before) return true
  return commit(next)
}
