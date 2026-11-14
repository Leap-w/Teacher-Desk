import { computed, nextTick, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { PHOTO_SOFT_WARNING_BYTES } from '@/config/photo'
import { studentPhotoRepository } from '@/repositories'
import { getMediaStore, MediaStoreError, type MediaBinaryBundle } from '@/services/mediaStore'
import { getPhotoProcessor, getPhotoThumbnailGenerator } from '@/services/imagePipeline'
import { getPhotoCloud, PhotoCloudError } from '@/services/photoCloud'
import { cloudSyncState } from '@/services/cloudSync'
import {
  enqueuePhotoUpload,
  readPhotoOutbox,
  recordPhotoUploadAttempt,
  removePhotoUpload,
  type PhotoUploadTask,
} from '@/services/photoOutbox'
import { useStudentStore } from '@/stores/student'
import { createId } from '@/utils/id'
import { formatStudentShortName } from '@/utils/student'
import {
  buildPhotoStoragePath,
  currentIdPhotoOf,
  deriveStudentPhotoState,
  isPhotoActive,
  isStudentPhotoCategory,
  photosOfStudent,
  refreshPhotoStudentNames,
  reviveStudentPhotos,
  totalActivePhotoBytes,
} from '@/utils/studentPhoto'
import type {
  StudentPhoto,
  StudentPhotoCategory,
  StudentPhotoMediaState,
} from '@/types/studentPhoto'

/** 照片 Store 的可读错误码（UI 后续据此给不同提示） */
export type StudentPhotoStoreErrorCode =
  | 'student-not-found'
  | 'invalid-photo'
  | 'current-photo-invalid'
  | 'metadata-not-saved'
  | 'media-save-failed'
  | 'media-read-failed'
  | 'media-unavailable'
  | 'photo-missing'
  | 'download-failed'
  | 'signed-url-failed'

export class StudentPhotoStoreError extends Error {
  readonly code: StudentPhotoStoreErrorCode

  constructor(code: StudentPhotoStoreErrorCode, message: string) {
    super(message)
    this.name = 'StudentPhotoStoreError'
    this.code = code
  }
}

function errorMessageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

/** 上传队列一次冲刷的结果 */
export interface PhotoFlushResult {
  uploaded: number
  failed: number
  skipped: number
}

/**
 * 学生照片状态（v3.8.0 · Phase 1B）：照片元数据 + 本机媒体 + 云端上传的**唯一读写入口**。
 *
 * ## 数据分层（不混淆）
 *
 * ```
 * 元数据：teacherdesk:studentPhotos（localStorage，随现有同步/备份走）
 *    ↕ bind（写盘 + 跨标签页广播 + 云同步）
 * 二进制：IndexedDB `teacherdesk-media`（本机）  +  CloudBase 云存储（按需）
 * 上传队列：teacherdesk:photoOutbox（仅本机，不参与同步/备份）
 * ```
 *
 * ## 三条硬纪律
 *
 * 1. **本地优先**：先处理图片 + 写 IndexedDB，成功后才写元数据；元数据写盘失败会
 *    回滚刚写入的本地媒体（不留"无法追踪的孤儿"），并抛可读错误。
 * 2. **状态靠派生，不靠布尔值**：`states` 由「元数据 + 本机媒体实际存在性 + 上传中集合」
 *    实时算；`fileId` 只说明"云端有过一份"，不代表本机有图。
 * 3. **逻辑删除 + 后删本地文件**：墓碑必须先**真的落盘**，之后才清理本地 Blob；
 *    云端文件本阶段一律保留（没有跨设备删除确认）。
 */
export const useStudentPhotoStore = defineStore('studentPhoto', () => {
  const studentStore = useStudentStore()

  /** 全部照片元数据（含逻辑删除的墓碑；展示层用 `activePhotos` / `photosOfStudent`） */
  const photos = ref<StudentPhoto[]>(
    refreshPhotoStudentNames(studentPhotoRepository.load(), studentStore.students),
  )

  /** 本机 IndexedDB 里**真实存在**的照片 id 集合（状态派生用，不落盘） */
  const localPhotoIds = ref<Set<string>>(new Set())
  /** 正在上传的照片 id（仅内存） */
  const uploadingIds = ref<Set<string>>(new Set())
  /** 本机媒体库是否可用（打不开 / 隐私模式时为 false，UI 可提示） */
  const mediaAvailable = ref(true)
  /** 待上传队列（本机事实；reactive 副本由 outbox 模块的盘上内容同步） */
  const initialOutbox = readPhotoOutbox()
  /**
   * 每张照片最近一次本机错误（不落盘、不进同步；成功动作会清除）。
   *
   * 启动时从本机 outbox 的 `lastError` 回填：否则应用重启/刷新后"上传失败"会退化成
   * "仅本机保存"，单张重试入口在界面上消失（Phase 3 浏览器验收发现）。
   */
  const lastErrors = ref<Map<string, string>>(
    new Map(
      initialOutbox.flatMap((task) =>
        task.lastError ? ([[task.photoId, task.lastError]] as [string, string][]) : [],
      ),
    ),
  )
  const outbox = ref<PhotoUploadTask[]>(initialOutbox)

  // 写盘 + 跨标签页广播 + 云端同步（与其余模块同一套机制，一行接入）。
  // 复活时保留未来版本未知字段、刷新姓名快照，并异步刷新本机媒体存在性。
  studentPhotoRepository.bind(photos, (raw) => {
    const next = refreshPhotoStudentNames(reviveStudentPhotos(raw), studentStore.students)
    void refreshLocalPresence()
    return next
  })

  // 学生改名 / 补学号后刷新照片上的姓名快照（照片与学生仍只靠 studentId 关联）
  watch(
    () => studentStore.students.map((item) => `${item.id}|${item.name}|${item.studentNo}`),
    () => {
      photos.value = refreshPhotoStudentNames(photos.value, studentStore.students)
    },
  )

  void refreshLocalPresence()

  /* ==================== 本机媒体存在性 ==================== */

  /** 重新读取本机媒体库的 id 集合（启动 / 同步采纳 / 删除后调用） */
  async function refreshLocalPresence(): Promise<void> {
    try {
      const ids = await getMediaStore().listIds()
      localPhotoIds.value = new Set(ids)
      mediaAvailable.value = true
    } catch (error) {
      mediaAvailable.value = false
      console.warn('[photo] 读取本机照片库失败（状态按"本机无图"处理）：', error)
    }
  }

  function hasLocalMedia(photoId: string): boolean {
    return localPhotoIds.value.has(photoId)
  }

  function isUploading(photoId: string): boolean {
    return uploadingIds.value.has(photoId)
  }

  function markUploading(photoId: string, uploading: boolean): void {
    const next = new Set(uploadingIds.value)
    if (uploading) next.add(photoId)
    else next.delete(photoId)
    uploadingIds.value = next
  }

  function setPhotoError(photoId: string, message: string | undefined): void {
    const next = new Map(lastErrors.value)
    if (message) next.set(photoId, message)
    else next.delete(photoId)
    lastErrors.value = next
  }

  function lastErrorOf(photoId: string): string | undefined {
    return lastErrors.value.get(photoId)
  }

  /* ==================== 派生 ==================== */

  /** 有效照片（不含墓碑） */
  const activePhotos = computed(() => photos.value.filter(isPhotoActive))

  /**
   * 每张照片的派生状态（含墓碑 → `deleted`）。
   * 展示层读这一份，不要自己拿 `fileId` 猜。
   */
  const states = computed<Map<string, StudentPhotoMediaState>>(() => {
    const map = new Map<string, StudentPhotoMediaState>()
    for (const photo of photos.value) {
      map.set(
        photo.id,
        deriveStudentPhotoState(photo, {
          hasLocal: localPhotoIds.value.has(photo.id),
          uploading: uploadingIds.value.has(photo.id),
        }),
      )
    }
    return map
  })

  /** 待上传数量（不是"未安全保存"的总数——本地照片本来就算安全保存） */
  const pendingUploadCount = computed(() => outbox.value.length)

  /** 本机缓存占用（有效照片的压缩后大小之和；仅提示用，不强制限制） */
  const cachedPhotoBytes = computed(() => totalActivePhotoBytes(activePhotos.value))
  const softWarningReached = computed(() => cachedPhotoBytes.value >= PHOTO_SOFT_WARNING_BYTES)

  function stateOf(photoId: string): StudentPhotoMediaState {
    return states.value.get(photoId) ?? 'missing'
  }

  function findPhoto(photoId: string): StudentPhoto | undefined {
    return photos.value.find((photo) => photo.id === photoId)
  }

  /** 某学生的有效照片（按"当前证件照优先 → 上传时间倒序"排好） */
  function listStudentPhotos(studentId: string, category?: StudentPhotoCategory): StudentPhoto[] {
    return photosOfStudent(photos.value, studentId, category)
  }

  /** 某学生当前证件照（无则 undefined） */
  function currentIdPhoto(studentId: string): StudentPhoto | undefined {
    return currentIdPhotoOf(photos.value, studentId)
  }

  /** 某学生已逻辑删除的照片（墓碑；诊断/后续"回收站"可用） */
  function deletedPhotosOfStudent(studentId: string): StudentPhoto[] {
    return photos.value.filter((photo) => photo.studentId === studentId && Boolean(photo.deletedAt))
  }

  /* ==================== 元数据落盘校验 ==================== */

  function readPersistedPhotos(): StudentPhoto[] {
    try {
      return studentPhotoRepository.load()
    } catch (error) {
      console.warn('[photo] 校验元数据落盘时读盘失败：', error)
      return []
    }
  }

  /** 等一次写盘 watch 跑完后，从盘上确认记录确实写进去了 */
  async function verifyPersisted(
    photoId: string,
    check: (saved: StudentPhoto) => boolean,
  ): Promise<boolean> {
    await nextTick()
    const saved = readPersistedPhotos().find((photo) => photo.id === photoId)
    return saved ? check(saved) : false
  }

  function metadataNotSavedError(): StudentPhotoStoreError {
    return new StudentPhotoStoreError(
      'metadata-not-saved',
      '照片信息没能保存到本机（浏览器存储可能已满或被禁用），本次操作已取消。',
    )
  }

  function toMediaStoreError(error: unknown): StudentPhotoStoreError {
    if (error instanceof MediaStoreError) {
      if (error.code === 'unavailable') {
        return new StudentPhotoStoreError('media-unavailable', error.message)
      }
      if (error.code === 'read-failed') {
        return new StudentPhotoStoreError('media-read-failed', error.message)
      }
      return new StudentPhotoStoreError('media-save-failed', error.message)
    }
    return new StudentPhotoStoreError(
      'media-save-failed',
      errorMessageOf(error, '保存照片到本机失败。'),
    )
  }

  /* ==================== 新增照片 ==================== */

  /**
   * 新增一张照片（本地优先）：
   * 1. 校验学生仍在读名册；
   * 2. 图片处理（压缩原图 + 缩略图）；
   * 3. **同一事务**写入 IndexedDB（原图 + 缩略图）；
   * 4. 写元数据并**从盘上确认**；
   * 5. 失败回滚本地媒体；成功则入队等待上传（联网且已登录时立即尝试）。
   *
   * 新上传的证件照**不会自动成为当前证件照**——必须教师之后手动指定。
   */
  async function addPhoto(
    studentId: string,
    file: Blob,
    category: StudentPhotoCategory,
  ): Promise<StudentPhoto> {
    const student = studentStore.activeStudents.find((item) => item.id === studentId)
    if (!student) {
      throw new StudentPhotoStoreError('student-not-found', '这名学生不在读名册中，未保存照片。')
    }
    if (!isStudentPhotoCategory(category)) {
      throw new StudentPhotoStoreError('invalid-photo', '照片分类不合法（只能是证件照或生活照）。')
    }

    // 图片处理失败直接抛 PhotoProcessingError（带可读 code/message）
    const processed = await getPhotoProcessor()(file)

    const id = createId()
    const nowIso = new Date().toISOString()
    const storagePath = buildPhotoStoragePath(studentId, id, processed.mimeType)
    const media: MediaBinaryBundle = { full: processed.full, thumb: processed.thumb }

    try {
      await getMediaStore().save(id, media)
    } catch (error) {
      throw toMediaStoreError(error)
    }

    const photo: StudentPhoto = {
      id,
      studentId,
      studentName: formatStudentShortName(student, studentStore.nameCounts),
      category,
      storagePath,
      mimeType: processed.mimeType,
      width: processed.width,
      height: processed.height,
      size: processed.size,
      uploadedAt: nowIso,
      updatedAt: nowIso,
      createdAt: nowIso,
    }

    photos.value = [...photos.value, photo]
    const persisted = await verifyPersisted(id, (saved) => !saved.deletedAt)
    if (!persisted) {
      // 补偿：元数据没落盘 → 删掉刚写的本地媒体，避免"无法追踪的媒体孤儿"
      photos.value = photos.value.filter((item) => item.id !== id)
      try {
        await getMediaStore().remove(id)
      } catch (error) {
        console.warn(
          '[photo] 元数据未保存，清理刚写入的本地照片也失败（可能留下孤儿文件）：',
          error,
        )
      }
      throw metadataNotSavedError()
    }

    localPhotoIds.value = new Set([...localPhotoIds.value, id])
    mediaAvailable.value = true
    outbox.value = enqueuePhotoUpload(id)
    // 不 await：本地保存已完成，上传是后台补传；失败会留在 outbox 里重试
    void flushPhotoUploads()
    return photo
  }

  /* ==================== 当前证件照 ==================== */

  /**
   * 指定当前证件照（手动；每生至多一张）。
   * 原当前证件照**继续保留在历史照片里**，只是去掉标记。
   */
  async function setCurrentIdPhoto(studentId: string, photoId: string): Promise<StudentPhoto> {
    const target = findPhoto(photoId)
    if (
      !target ||
      target.studentId !== studentId ||
      target.category !== 'id-photo' ||
      target.deletedAt
    ) {
      throw new StudentPhotoStoreError(
        'current-photo-invalid',
        '只能把该学生一张**未删除的证件照**设为当前证件照。',
      )
    }
    if (target.isCurrentIdPhoto) return target

    const previous = photos.value
    const nowIso = new Date().toISOString()
    photos.value = photos.value.map((photo) => {
      if (photo.studentId !== studentId || photo.category !== 'id-photo') return photo
      if (photo.id === photoId) {
        return { ...photo, isCurrentIdPhoto: true, updatedAt: nowIso }
      }
      if (photo.isCurrentIdPhoto) {
        const copy: StudentPhoto = { ...photo }
        delete copy.isCurrentIdPhoto
        return copy
      }
      return photo
    })

    const persisted = await verifyPersisted(photoId, (saved) => saved.isCurrentIdPhoto === true)
    if (!persisted) {
      photos.value = previous
      throw metadataNotSavedError()
    }
    return findPhoto(photoId)!
  }

  /** 取消某学生的当前证件照指定（历史照片全部保留） */
  async function clearCurrentIdPhoto(studentId: string): Promise<void> {
    const previous = photos.value
    const nowIso = new Date().toISOString()
    let changed = false
    photos.value = photos.value.map((photo) => {
      if (photo.studentId !== studentId || !photo.isCurrentIdPhoto) return photo
      changed = true
      const copy: StudentPhoto = { ...photo, updatedAt: nowIso }
      delete copy.isCurrentIdPhoto
      return copy
    })
    if (!changed) return
    await nextTick()
    const stillCurrent = readPersistedPhotos().some(
      (photo) => photo.studentId === studentId && photo.isCurrentIdPhoto === true,
    )
    if (stillCurrent) {
      photos.value = previous
      throw metadataNotSavedError()
    }
  }

  /* ==================== 逻辑删除 ==================== */

  /**
   * 逻辑删除一张照片（墓碑）。
   *
   * 顺序**不能颠倒**：
   * 1. 先写墓碑（`deletedAt` + `updatedAt`，保留 fileId / storagePath / uploadedAt）；
   * 2. **从盘上确认墓碑真的落盘**；
   * 3. 才清本地 Blob / 出队（清理失败不影响删除结果；云端文件本阶段一律保留）。
   *
   * 删除当前证件照时，标记随墓碑一起清掉——不会留下"指向已删除照片的当前状态"。
   */
  async function removePhoto(photoId: string): Promise<boolean> {
    const target = findPhoto(photoId)
    if (!target || target.deletedAt) return false

    const previous = photos.value
    const nowIso = new Date().toISOString()
    photos.value = photos.value.map((photo) => {
      if (photo.id !== photoId) return photo
      const tombstone: StudentPhoto = { ...photo, deletedAt: nowIso, updatedAt: nowIso }
      delete tombstone.isCurrentIdPhoto
      return tombstone
    })

    const persisted = await verifyPersisted(photoId, (saved) => Boolean(saved.deletedAt))
    if (!persisted) {
      photos.value = previous
      throw metadataNotSavedError()
    }

    outbox.value = removePhotoUpload(photoId)
    setPhotoError(photoId, undefined)

    try {
      await getMediaStore().remove(photoId)
      localPhotoIds.value = new Set([...localPhotoIds.value].filter((id) => id !== photoId))
    } catch (error) {
      // 墓碑已经落盘，删除结果有效；本地清理失败只影响占空间，不影响业务状态
      console.warn('[photo] 删除本地照片文件失败（元数据已标记删除，云端文件保留）：', error)
    }
    return true
  }

  /* ==================== 读取 / 下载 ==================== */

  /**
   * 取本机原图；本机没有但有 `fileId` 时**下载并落库**（下载失败抛可读错误）。
   * 这是"本机媒体存在性以实际读取为准"的唯一出口。
   */
  async function getPhotoBlob(photoId: string): Promise<Blob> {
    const photo = findPhoto(photoId)
    if (!photo) {
      throw new StudentPhotoStoreError('photo-missing', '这张照片的记录不存在。')
    }
    if (photo.deletedAt) {
      throw new StudentPhotoStoreError('photo-missing', '这张照片已删除，不再提供查看。')
    }
    try {
      const local = await getMediaStore().readFull(photoId)
      if (local) {
        localPhotoIds.value = new Set([...localPhotoIds.value, photoId])
        return local
      }
    } catch (error) {
      throw toMediaStoreError(error)
    }

    if (!photo.fileId) {
      setPhotoError(photoId, '本机照片文件找不到了，云端也没有备份。')
      throw new StudentPhotoStoreError(
        'photo-missing',
        '这张照片的本机文件找不到了，云端也没有备份。',
      )
    }
    return downloadPhotoToLocal(photo)
  }

  /** 取缩略图；没有就现场生成（并尽量补写本地） */
  async function getPhotoThumbnail(photoId: string): Promise<Blob> {
    try {
      const localThumb = await getMediaStore().readThumb(photoId)
      if (localThumb) return localThumb
    } catch (error) {
      throw toMediaStoreError(error)
    }
    const full = await getPhotoBlob(photoId)
    let thumb: Blob
    try {
      thumb = await getPhotoThumbnailGenerator()(full)
    } catch (error) {
      throw new StudentPhotoStoreError(
        'media-read-failed',
        errorMessageOf(error, '生成照片缩略图失败。'),
      )
    }
    try {
      await getMediaStore().save(photoId, { full, thumb })
      localPhotoIds.value = new Set([...localPhotoIds.value, photoId])
    } catch (error) {
      // 缩略图没写进去不影响本次返回；下次会重新生成
      console.warn('[photo] 补写缩略图失败（不影响本次显示）：', error)
    }
    return thumb
  }

  /** 从云端下载并写入本机（同时生成缩略图） */
  async function downloadPhotoToLocal(photo: StudentPhoto): Promise<Blob> {
    if (!photo.fileId) {
      throw new StudentPhotoStoreError('photo-missing', '这张照片没有云端备份，无法下载。')
    }
    try {
      const blob = await getPhotoCloud().download(photo.fileId)
      const thumb = await getPhotoThumbnailGenerator()(blob)
      await getMediaStore().save(photo.id, { full: blob, thumb })
      localPhotoIds.value = new Set([...localPhotoIds.value, photo.id])
      mediaAvailable.value = true
      setPhotoError(photo.id, undefined)
      return blob
    } catch (error) {
      const message = errorMessageOf(error, '下载云端照片失败。')
      setPhotoError(photo.id, message)
      if (error instanceof MediaStoreError) throw toMediaStoreError(error)
      if (error instanceof PhotoCloudError) {
        throw new StudentPhotoStoreError('download-failed', message)
      }
      throw new StudentPhotoStoreError('download-failed', `下载这张照片失败：${message}`)
    }
  }

  /**
   * 取这张照片的**临时**访问地址（私有文件）。
   * 返回值只供本次运行使用，**绝不持久化**：签名 URL 会过期，过期后重新调用即可。
   */
  async function getPhotoSignedUrl(photoId: string): Promise<string> {
    const photo = findPhoto(photoId)
    if (photo?.deletedAt) {
      throw new StudentPhotoStoreError('signed-url-failed', '这张照片已删除，不再提供访问地址。')
    }
    if (!photo?.fileId) {
      throw new StudentPhotoStoreError(
        'signed-url-failed',
        '这张照片还没有上传到云端，暂时无法生成访问地址。',
      )
    }
    try {
      return await getPhotoCloud().createSignedUrl(photo.fileId)
    } catch (error) {
      const message = errorMessageOf(error, '获取照片访问地址失败。')
      setPhotoError(photoId, message)
      throw new StudentPhotoStoreError('signed-url-failed', message)
    }
  }

  /* ==================== 上传队列 ==================== */

  let flushPromise: Promise<PhotoFlushResult> | null = null

  /**
   * 冲刷上传队列（幂等：同一时刻只有一个冲刷在跑；重复调用会等同一个结果）。
   * - 逐张串行上传（移动端带宽/内存友好），路径由照片 id 决定，**重试不会产生重复云端文件**；
   * - 上传成功 → 写 `fileId` 并**从盘上确认**后才出队；
   * - 上传失败 → 记录尝试次数与脱敏原因，照片**留在本地**，下次再试；
   * - 未登录 / 断网 → 直接跳过，队列原样保留。
   */
  function flushPhotoUploads(): Promise<PhotoFlushResult> {
    if (flushPromise) return flushPromise
    flushPromise = runPhotoFlush().finally(() => {
      flushPromise = null
    })
    return flushPromise
  }

  async function runPhotoFlush(): Promise<PhotoFlushResult> {
    outbox.value = readPhotoOutbox()
    if (outbox.value.length === 0) return { uploaded: 0, failed: 0, skipped: 0 }

    const cloud = getPhotoCloud()
    if (!cloud.isAvailable()) {
      return { uploaded: 0, failed: 0, skipped: outbox.value.length }
    }

    const media = getMediaStore()
    let uploaded = 0
    let failed = 0
    let skipped = 0

    // 快照遍历：冲刷过程中 outbox 会被改写，不能直接迭代可变来源
    for (const task of [...outbox.value]) {
      const current = photos.value.find((photo) => photo.id === task.photoId)
      if (!current || current.deletedAt) {
        outbox.value = removePhotoUpload(task.photoId)
        continue
      }
      if (current.fileId) {
        // 已经传过（例如上一次元数据没存上，但云端其实成功了）→ 只出队，不重复上传
        outbox.value = removePhotoUpload(task.photoId)
        continue
      }

      let full: Blob | undefined
      try {
        full = await media.readFull(current.id)
      } catch (error) {
        outbox.value = recordPhotoUploadAttempt(current.id, error)
        setPhotoError(current.id, errorMessageOf(error, '读取本机照片失败，上传未完成。'))
        failed += 1
        continue
      }
      if (!full) {
        // 本机文件都没了，重试也传不上去：出队并留下诊断（照片进入 missing 状态）
        outbox.value = removePhotoUpload(current.id)
        setPhotoError(current.id, '本机照片文件不存在，无法上传到云端。')
        skipped += 1
        continue
      }

      markUploading(current.id, true)
      try {
        const { fileId } = await cloud.upload(current.storagePath, full, current.mimeType)
        const previous = photos.value
        const nowIso = new Date().toISOString()
        photos.value = photos.value.map((photo) =>
          photo.id === current.id ? { ...photo, fileId, updatedAt: nowIso } : photo,
        )
        const persisted = await verifyPersisted(current.id, (saved) => saved.fileId === fileId)
        if (!persisted) {
          photos.value = previous
          const reason = '上传成功，但照片信息没能保存到本机'
          outbox.value = recordPhotoUploadAttempt(current.id, reason)
          setPhotoError(current.id, reason)
          failed += 1
          continue
        }
        outbox.value = removePhotoUpload(current.id)
        setPhotoError(current.id, undefined)
        uploaded += 1
      } catch (error) {
        outbox.value = recordPhotoUploadAttempt(current.id, error)
        setPhotoError(current.id, errorMessageOf(error, '上传照片到云端失败。'))
        failed += 1
      } finally {
        markUploading(current.id, false)
      }
    }

    return { uploaded, failed, skipped }
  }

  /** 把一张照片重新排进上传队列（UI 的"重试上传"以后用） */
  function queuePhotoUpload(photoId: string): void {
    const photo = findPhoto(photoId)
    if (!photo || photo.deletedAt) return
    outbox.value = enqueuePhotoUpload(photoId)
    void flushPhotoUploads()
  }

  return {
    photos,
    activePhotos,
    states,
    mediaAvailable,
    pendingUploadCount,
    cachedPhotoBytes,
    softWarningReached,
    stateOf,
    findPhoto,
    listStudentPhotos,
    currentIdPhoto,
    deletedPhotosOfStudent,
    hasLocalMedia,
    isUploading,
    lastErrorOf,
    addPhoto,
    setCurrentIdPhoto,
    clearCurrentIdPhoto,
    removePhoto,
    getPhotoBlob,
    getPhotoThumbnail,
    getPhotoSignedUrl,
    flushPhotoUploads,
    queuePhotoUpload,
    refreshLocalPresence,
  }
})

/**
 * 启动时恢复待上传任务并注册自动补传（应用入口调用一次）。
 *
 * 触发时机与现有同步一致：启动 / 网络恢复 / 回到前台。
 * 幂等：重复调用只注册一次监听。
 */
let autoRetryStarted = false

export function startStudentPhotoAutoRetry(): void {
  if (autoRetryStarted) return
  autoRetryStarted = true
  const store = useStudentPhotoStore()
  void store.refreshLocalPresence()
  void store.flushPhotoUploads()
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      void store.refreshLocalPresence()
      void store.flushPhotoUploads()
    })
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void store.flushPhotoUploads()
    })
  }
  // 登录成功 / 同步完成也会让「云端可用」从 false 变 true：这时补传一次离线照片。
  // 只监听云同步状态的既有只读快照，不碰 SyncEngine 内部。
  if (typeof window !== 'undefined') {
    watch(
      () => `${cloudSyncState.value.status}|${cloudSyncState.value.account ?? ''}`,
      (next, previous) => {
        if (next !== previous) void store.flushPhotoUploads()
      },
    )
  }
}
