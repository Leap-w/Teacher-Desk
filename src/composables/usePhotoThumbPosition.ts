/**
 * 缩略图展示位置的 **composable 口子**（v3.8.3 Phase 1）。
 *
 * 页面 / 组件只认这里，不碰 localStorage，也不直接引 services。
 * 状态是**模块级共享**的：照片墙与照片管理弹窗拿到同一份 ref，
 * 同一个 photoId 改一次，本机所有缩略图展示区域立刻一致。
 */
import { ref, type Ref } from 'vue'

import {
  loadPhotoThumbPositions,
  removePhotoThumbPosition,
  savePhotoThumbPosition,
} from '@/services/photoThumbPositionStorage'
import {
  cssPositionOf,
  normalizePosition,
  positionOf,
  withoutPosition,
  withPosition,
  type PhotoThumbPosition,
  type PhotoThumbPositionMap,
} from '@/utils/photoThumbPosition'

let shared: Ref<PhotoThumbPositionMap> | null = null

function state(): Ref<PhotoThumbPositionMap> {
  if (!shared) shared = ref(loadPhotoThumbPositions())
  return shared
}

export function usePhotoThumbPosition() {
  const positions = state()

  function positionOfPhoto(photoId: string): PhotoThumbPosition {
    return positionOf(positions.value, photoId)
  }

  /** 直接绑到 img 的 inline 样式；无配置时为系统默认 50% 30% */
  function objectPositionOf(photoId: string): string {
    return cssPositionOf(positionOfPhoto(photoId))
  }

  /** 保存成功返回 true；盘上写失败返回 false（内存也不改，界面据此提示） */
  function setPosition(photoId: string, x: number, y: number): boolean {
    const normalized = normalizePosition({ x, y })
    if (!normalized) return false
    if (!savePhotoThumbPosition(photoId, normalized)) return false
    positions.value = withPosition(positions.value, photoId, normalized)
    return true
  }

  /** 恢复默认 = 删除这张的配置；返回 false 表示没删掉 */
  function resetPosition(photoId: string): boolean {
    if (!removePhotoThumbPosition(photoId)) return false
    positions.value = withoutPosition(positions.value, photoId)
    return true
  }

  /** 重新从盘上读（测试与未来跨标签页刷新用） */
  function reload(): void {
    positions.value = loadPhotoThumbPositions()
  }

  return { positions, positionOfPhoto, objectPositionOf, setPosition, resetPosition, reload }
}
