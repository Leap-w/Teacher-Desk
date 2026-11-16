/**
 * 照片墙「批量管理」的编排（v3.8.3 界面调整，版本号不变）。
 *
 * 只做三件事：管理模式的开关、多选、批量永久删除的串行编排。
 *
 * ## 边界（都不在这里越层）
 * - **选择对象是照片记录的 `StudentPhoto.id`，不是学生**：删的只是照片，学生档案
 *   与同一学生的其它照片一行不动。
 * - 删除只调 `studentPhotoStore.removePhoto`（项目唯一的删除入口）：墓碑先落盘 → 清本机
 *   Blob / 上传队列 → 由 Store 的整键写入触发既有同步链路。本文件**不碰**
 *   `localStorage` / IndexedDB / CloudBase，也不新增任何删除协议。
 * - 删除成功后才清理这批 id 在 `teacherdesk:photoWall:display` 里的缩略图位置配置；
 *   清理失败单独回报（`positionCleaned=false`），不据此把照片判成删除失败。
 * - **选择状态与 `photoStore.activePhotos` 实时对账**：其他标签页 / 其他设备删掉照片后，
 *   选择里的幽灵 id 会自动剔除，选中数量永远等于「仍然存在且被选中的照片数」。
 * - 没有回收站、没有恢复入口：删除后照片不再出现在照片墙与照片管理里。
 */
import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

import { usePhotoThumbPosition } from '@/composables/usePhotoThumbPosition'
import { useStudentPhotoStore } from '@/stores/studentPhoto'

export interface BatchDeleteFailure {
  photoId: string
  message: string
}

export interface BatchDeleteResult {
  /** 本次请求删除的张数（已剔除失效选择） */
  requested: number
  /** 确认删除成功的照片 id */
  removed: string[]
  /** 失败项与原因（部分失败时如实回报） */
  failed: BatchDeleteFailure[]
  /**
   * 并没有被这次操作删除、但已经不存在的照片 id。
   * 典型来源：确认前被另一个标签页 / 另一台设备删掉了。
   * 既不算成功也不算失败——不能把 `removePhoto` 返回 false 一律当成删除成功。
   */
  skipped: string[]
  /** 本机缩略图位置配置是否清理成功（与照片删除结果相互独立） */
  positionCleaned: boolean
}

export function usePhotoBatchManage(
  /**
   * 「当前界面上真正可见」的照片 id（页面把搜索 / 筛选后的结果传进来）。
   * 不传 = 不过滤（测试与无筛选场景按全部有效照片处理）。
   * 可见集合一旦变小（搜索、切换学生范围等），被隐藏的选择会被自动取消。
   */
  visiblePhotoIds?: MaybeRefOrGetter<readonly string[] | undefined>,
) {
  const photoStore = useStudentPhotoStore()
  const { forgetPositions } = usePhotoThumbPosition()

  const managing = ref(false)
  const selectedIds = ref<string[]>([])
  const deleting = ref(false)

  /**
   * 当前真实存在、未被删除的照片 id 集合（元数据变化即重算）。
   *
   * 选择状态必须跟它对齐：其他标签页 / 其他设备删除照片后，Store 的
   * `activePhotos` 会先更新（跨标签页广播 / 云端采纳都走这里），
   * 选择里那些「幽灵 id」就该立刻失效。
   */
  const activeIds = computed(() => new Set(photoStore.activePhotos.map((photo) => photo.id)))

  /** 可见照片集合；`null` = 没有传可见来源，按「全部有效照片」处理 */
  const visibleIds = computed(() => {
    const source = visiblePhotoIds === undefined ? undefined : toValue(visiblePhotoIds)
    return source ? new Set(source) : null
  })

  function isVisible(photoId: string): boolean {
    const visible = visibleIds.value
    return visible === null || visible.has(photoId)
  }

  /** 有效选择 = 既没被删、又仍然可见的选中项（对外一律用这个口径） */
  const effectiveSelectedIds = computed(() =>
    selectedIds.value.filter((id) => activeIds.value.has(id) && isVisible(id)),
  )
  const selectedSet = computed(() => new Set(effectiveSelectedIds.value))

  const selectedCount = computed(() => effectiveSelectedIds.value.length)
  const hasSelection = computed(() => effectiveSelectedIds.value.length > 0)

  /**
   * 把已经失效的 id 从选择里真正剔掉（不只是计算时过滤）。
   *
   * 两个触发源：照片集合变化（外部删除 / 同步）与可见集合变化（搜索、切换范围）。
   * 只在它们变化时跑一次，不做深度 watch —— 两者每次都是新 Set/新引用。
   */
  watch([activeIds, visibleIds], ([ids, visible]) => {
    if (!selectedIds.value.length) return
    const next = selectedIds.value.filter(
      (id) => ids.has(id) && (visible === null || visible.has(id)),
    )
    if (next.length !== selectedIds.value.length) selectedIds.value = next
  })

  function isSelected(photoId: string): boolean {
    return selectedSet.value.has(photoId)
  }

  /** 进入管理模式：从空选择开始，避免上次残留 */
  function enter(): void {
    selectedIds.value = []
    managing.value = true
  }

  /** 退出管理模式：一律清空选择 */
  function exit(): void {
    managing.value = false
    selectedIds.value = []
  }

  /** 选中 / 取消选中一张照片（只认仍然存在、未删除、当前可见的照片 id） */
  function toggle(photoId: string): void {
    if (!photoId || !activeIds.value.has(photoId) || !isVisible(photoId)) return
    selectedIds.value = isSelected(photoId)
      ? selectedIds.value.filter((id) => id !== photoId)
      : [...selectedIds.value, photoId]
  }

  function clearSelection(): void {
    selectedIds.value = []
  }

  /**
   * 删除**之后**的真实状态：`true` 仍在、`false` 已不存在、`null` 查不出来。
   *
   * 分类只认这个，不认 `removePhoto` 的返回值：返回 false 既可能是「别处已经删掉了」，
   * 也可能是「写入没生效、照片还在」。查询本身失败时也不能猜，交给调用方按失败处理。
   */
  function aliveAfter(photoId: string): boolean | null {
    try {
      const record = photoStore.findPhoto(photoId)
      return Boolean(record && !record.deletedAt)
    } catch {
      return null
    }
  }

  /**
   * 串行删除当前选中的照片。
   *
   * 串行是刻意的：`removePhoto` 每次都会整体重写照片数组并校验落盘，并发写同一键会互相覆盖。
   * 每项独立处理 —— 单张失败不影响其余，最后如实汇总。
   *
   * **分类以删除后的真实数据状态为准**（见 `aliveAfter`）：
   * | removePhoto | 删除后状态 | 分类 |
   * |---|---|---|
   * | true  | 已不存在 | removed |
   * | false | 已不存在 | skipped（别处删的，不算本次成功也不算失败） |
   * | false / true / 抛异常 | 仍存在 | failed |
   * | 任意  | 查不出来 | failed（不猜，绝不宣称成功或已在别处删除） |
   */
  async function removeSelected(): Promise<BatchDeleteResult> {
    // 只拿「此刻仍然存在」的选择：外部删掉的不会进入本次删除
    const ids = [...effectiveSelectedIds.value]
    const result: BatchDeleteResult = {
      requested: ids.length,
      removed: [],
      failed: [],
      skipped: [],
      positionCleaned: true,
    }
    if (!ids.length) return result

    deleting.value = true
    try {
      for (const photoId of ids) {
        // 进入循环时就已不存在（快照到执行之间被别处删掉）：直接算 skipped
        if (aliveAfter(photoId) === false) {
          result.skipped.push(photoId)
          continue
        }

        let reported = false
        let thrown: unknown = null
        try {
          reported = await photoStore.removePhoto(photoId)
        } catch (error) {
          thrown = error
        }

        // 关键：看删除之后的真实状态，而不是返回值 / 是否抛异常
        const alive = aliveAfter(photoId)
        if (alive === null) {
          result.failed.push({
            photoId,
            message: '无法确认删除结果，请刷新后重试',
          })
          continue
        }
        if (!alive) {
          // 确实没了：本次删掉的算 removed，本来就没了的算 skipped
          if (reported) result.removed.push(photoId)
          else result.skipped.push(photoId)
          continue
        }
        // 仍然存在 = 删除没有生效（无论返回值是 true / false 还是抛了异常）
        result.failed.push({
          photoId,
          message:
            thrown instanceof Error && thrown.message
              ? thrown.message
              : '删除没有生效：照片仍然存在',
        })
      }
    } finally {
      deleting.value = false
    }

    // 只清这批确认删除成功的位置配置；失败只影响本机偏好，不改变删除结论
    result.positionCleaned = forgetPositions(result.removed)
    // 已删除 / 已不存在的从选择里移出；失败项保留选中，方便教师重试
    const settled = new Set([...result.removed, ...result.skipped])
    selectedIds.value = selectedIds.value.filter((id) => !settled.has(id))
    return result
  }

  return {
    managing,
    selectedIds,
    deleting,
    selectedCount,
    hasSelection,
    isSelected,
    enter,
    exit,
    toggle,
    clearSelection,
    removeSelected,
  }
}
