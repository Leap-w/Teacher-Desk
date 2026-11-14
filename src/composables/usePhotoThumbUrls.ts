/**
 * 照片缩略图 objectURL 管理（Phase 2 UI）。
 *
 * 缩略图由 Phase 1B 的 `store.getPhotoThumbnail()` 给出 Blob；组件只负责把它变成
 * 可渲染的 objectURL，并在组件卸载时 revoke，避免内存泄漏。
 *
 * 同一 photoId 只加载一次；加载失败记下来，界面显示"缩略图加载失败"占位，
 * 不阻塞其它照片。
 */
import { onScopeDispose, ref } from 'vue'

import { useStudentPhotoStore } from '@/stores/studentPhoto'

export function usePhotoThumbUrls() {
  const store = useStudentPhotoStore()
  const urls = ref<Record<string, string>>({})
  const failedIds = ref<Set<string>>(new Set())
  const cache = new Map<string, string>()
  const pending = new Set<string>()

  async function ensure(photoIds: readonly string[]): Promise<void> {
    const ids = [...new Set(photoIds)].filter(
      (id) => !cache.has(id) && !pending.has(id) && !failedIds.value.has(id),
    )
    for (const photoId of ids) {
      pending.add(photoId)
      try {
        const blob = await store.getPhotoThumbnail(photoId)
        const url = URL.createObjectURL(blob)
        cache.set(photoId, url)
        urls.value = { ...urls.value, [photoId]: url }
      } catch {
        const next = new Set(failedIds.value)
        next.add(photoId)
        failedIds.value = next
      } finally {
        pending.delete(photoId)
      }
    }
  }

  function urlOf(photoId: string): string | undefined {
    return urls.value[photoId]
  }

  function hasFailed(photoId: string): boolean {
    return failedIds.value.has(photoId)
  }

  function releaseAll(): void {
    for (const url of cache.values()) URL.revokeObjectURL(url)
    cache.clear()
    urls.value = {}
    failedIds.value = new Set()
  }

  onScopeDispose(releaseAll)

  return { ensure, urlOf, hasFailed, releaseAll }
}
