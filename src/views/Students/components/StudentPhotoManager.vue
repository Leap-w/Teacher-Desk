<script setup lang="ts">
/**
 * 学生个人照片管理（Phase 2 UI）。
 *
 * 三个视图：证件照 / 生活照 / 全部照片；顶部单独展示"当前证件照"。
 * 上传 / 批量上传 / 删除 / 设为当前证件照 / 大图查看全部调用 Phase 1B 的 Store：
 * 图片处理、IndexedDB、云端上传、逻辑删除、状态派生都在数据层完成，组件不重复实现。
 */
import { computed, ref, watch } from 'vue'

import { AppBadge, AppButton, AppModal, AppSegmented } from '@/components/ui'
import { usePhotoThumbUrls } from '@/composables/usePhotoThumbUrls'
import { useToast } from '@/composables/useToast'
import { useStudentPhotoStore } from '@/stores/studentPhoto'
import { useStudentStore } from '@/stores/student'
import { formatStudentShortName } from '@/utils/student'
import {
  PHOTO_BACKUP_NOTICE,
  PHOTO_CATEGORY_FILTER_OPTIONS,
  canUploadLocalPhoto,
  filterStudentPhotos,
  formatPhotoUploadedAt,
  photoCategoryText,
  photoCountSummary,
  photoStatusView,
  runPhotoUploadBatch,
  summarizePhotoUploadBatch,
  toPhotoUploadItems,
  type PhotoCategoryFilter,
  type PhotoUploadBatchResult,
} from '@/utils/photoUi'
import StudentPhotoTile from './StudentPhotoTile.vue'
import StudentPhotoViewer from './StudentPhotoViewer.vue'
import type { Student } from '@/types'
import type { StudentPhoto, StudentPhotoCategory } from '@/types/studentPhoto'

const props = defineProps<{ modelValue: boolean; student: Student }>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  changed: []
}>()

const photoStore = useStudentPhotoStore()
const studentStore = useStudentStore()
const toast = useToast()
const { ensure, urlOf, hasFailed, releaseAll } = usePhotoThumbUrls()

const displayName = computed(() => formatStudentShortName(props.student, studentStore.nameCounts))
const studentPhotos = computed(() => photoStore.listStudentPhotos(props.student.id))
const currentPhoto = computed(() => photoStore.currentIdPhoto(props.student.id))
const view = ref<PhotoCategoryFilter>('id-photo')
const filteredPhotos = computed(() => filterStudentPhotos(studentPhotos.value, view.value))
const counts = computed(() => ({
  'id-photo': studentPhotos.value.filter((photo) => photo.category === 'id-photo').length,
  'life-photo': studentPhotos.value.filter((photo) => photo.category === 'life-photo').length,
  all: studentPhotos.value.length,
}))
const viewOptions = computed(() =>
  PHOTO_CATEGORY_FILTER_OPTIONS.map((option) => ({
    value: option.value,
    label: `${option.label}（${counts.value[option.value]}）`,
  })),
)
const isDeletedStudent = computed(() => Boolean(props.student.deletedAt))

function statusOf(photo: StudentPhoto) {
  return photoStatusView(photoStore.stateOf(photo.id), photoStore.lastErrorOf(photo.id))
}

function refreshThumbs(): void {
  const ids = filteredPhotos.value.map((photo) => photo.id)
  if (currentPhoto.value) ids.push(currentPhoto.value.id)
  void ensure(ids)
}

watch(
  () => filteredPhotos.value.map((photo) => photo.id).join('|'),
  () => refreshThumbs(),
  { immediate: true },
)

watch(
  () => currentPhoto.value?.id,
  () => refreshThumbs(),
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) {
      releaseAll()
      return
    }
    void photoStore.refreshLocalPresence()
    refreshThumbs()
  },
)

/* ---------- 上传 ---------- */

const fileInput = ref<HTMLInputElement>()
const uploadCategory = ref<StudentPhotoCategory>('id-photo')
const uploadCategoryOptions = [
  { value: 'id-photo', label: '证件照' },
  { value: 'life-photo', label: '生活照' },
] as const
const uploading = ref<{ active: boolean; done: number; total: number }>({
  active: false,
  done: 0,
  total: 0,
})
const cancelRequested = ref(false)
const lastBatch = ref<PhotoUploadBatchResult | undefined>(undefined)
const lastBatchSummary = computed(() =>
  lastBatch.value ? summarizePhotoUploadBatch(lastBatch.value) : undefined,
)

function pickFiles(): void {
  fileInput.value?.click()
}

function onFilesPicked(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = input.files ? [...input.files] : []
  input.value = ''
  if (files.length === 0) return
  void startUpload(files)
}

async function startUpload(files: File[]): Promise<void> {
  if (uploading.value.active) return
  const items = toPhotoUploadItems(files)
  const category = uploadCategory.value
  uploading.value = { active: true, done: 0, total: items.length }
  cancelRequested.value = false
  lastBatch.value = undefined

  const result = await runPhotoUploadBatch(
    items,
    async (item) => {
      const photo = await photoStore.addPhoto(props.student.id, item.file, category)
      return { photoId: photo.id }
    },
    {
      shouldCancel: () => cancelRequested.value,
      onProgress: (done, total) => {
        uploading.value = { active: true, done, total }
      },
    },
  )

  uploading.value = { active: false, done: result.results.length, total: items.length }
  lastBatch.value = result
  const summary = summarizePhotoUploadBatch(result)
  // 注意：addPhoto 成功只代表"已保存到本机 + 已排队上传"。
  // 真实云端链路尚未验证，因此这里不承诺"云端已上传成功"——每张照片的实际状态由状态徽标展示。
  if (summary.failed === 0 && summary.success > 0) {
    toast.success(
      `已保存 ${summary.success} 张${photoCategoryText(category)}到本机` +
        (photoStore.pendingUploadCount > 0 ? '，云端补传会自动进行' : ''),
    )
  } else if (summary.success > 0) {
    toast.warning(`已保存 ${summary.success} 张到本机，${summary.failed} 张保存失败`)
  } else if (summary.success === 0 && summary.failed > 0) {
    toast.danger('照片保存失败，请查看失败原因')
  }
  if (summary.cancelled) toast.info('已取消尚未开始上传的照片')

  await photoStore.refreshLocalPresence()
  refreshThumbs()
  emit('changed')
}

function cancelUpload(): void {
  cancelRequested.value = true
}

/* ---------- 设为当前证件照 ---------- */

const currentTarget = ref<StudentPhoto>()
const currentConfirmOpen = ref(false)

function askSetCurrent(photo: StudentPhoto): void {
  if (photo.category !== 'id-photo' || photo.isCurrentIdPhoto) return
  currentTarget.value = photo
  currentConfirmOpen.value = true
}

async function confirmSetCurrent(): Promise<void> {
  const target = currentTarget.value
  if (!target) return
  try {
    await photoStore.setCurrentIdPhoto(props.student.id, target.id)
    currentConfirmOpen.value = false
    currentTarget.value = undefined
    toast.success('已设为当前证件照，原证件照保留为历史照片')
    refreshThumbs()
    emit('changed')
  } catch (error) {
    toast.danger(error instanceof Error ? error.message : '设置当前证件照失败')
  }
}

/* ---------- 删除 ---------- */

const deleteTarget = ref<StudentPhoto>()
const deleteConfirmOpen = ref(false)

function askDelete(photo: StudentPhoto): void {
  deleteTarget.value = photo
  deleteConfirmOpen.value = true
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value
  if (!target) return
  try {
    const removed = await photoStore.removePhoto(target.id)
    deleteConfirmOpen.value = false
    deleteTarget.value = undefined
    if (removed) {
      toast.success('已删除这张照片（记录已标记删除；云端文件按当前策略保留）')
    } else {
      toast.danger('删除失败：照片可能已不存在')
    }
    emit('changed')
  } catch (error) {
    toast.danger(error instanceof Error ? error.message : '删除照片失败')
  }
}

/* ---------- 重试上传 / 补传本机照片 ---------- */

/**
 * 「上传到云端」：用于**只有本机、云端还没有**的照片（v3.8.1 Phase 1.1）。
 *
 * 最典型的来源是「从完整备份 ZIP 恢复」——恢复只写本机媒体与元数据，不重建上传队列；
 * 这类照片派生状态是 `local-only`，此前界面上没有任何可点的上传入口。
 * 这里只调用既有 `queuePhotoUpload()`（outbox + flush），不新增自动队列、不改协议。
 */
function uploadLocalPhoto(photo: StudentPhoto): void {
  photoStore.queuePhotoUpload(photo.id)
  toast.info('已加入上传队列；登录并联网后会自动补传')
}

function retryUpload(photo: StudentPhoto): void {
  photoStore.queuePhotoUpload(photo.id)
  toast.info('已重新排队上传，联网后会自动补传')
}

function retryAll(): void {
  void photoStore.flushPhotoUploads()
  toast.info('正在尝试补传本机照片')
}

/* ---------- 大图 ---------- */

const viewerOpen = ref(false)
const viewerInitialId = ref<string>()

function openViewer(photo: StudentPhoto): void {
  viewerInitialId.value = photo.id
  viewerOpen.value = true
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    :title="`学生照片 · ${displayName}`"
    :width="880"
    @update:model-value="close"
  >
    <div class="manager">
      <!-- 当前证件照 -->
      <section v-if="currentPhoto" class="current-block">
        <div class="current-thumb">
          <img
            v-if="urlOf(currentPhoto.id)"
            :src="urlOf(currentPhoto.id)"
            alt="当前证件照"
            class="current-thumb__img"
          />
          <span v-else class="current-thumb__placeholder">{{
            hasFailed(currentPhoto.id) ? '预览不可用' : '加载中…'
          }}</span>
        </div>
        <div class="current-info">
          <p class="current-title">
            当前证件照
            <AppBadge variant="primary" size="sm">当前</AppBadge>
          </p>
          <p class="current-meta">上传时间：{{ formatPhotoUploadedAt(currentPhoto.uploadedAt) }}</p>
          <p class="current-meta">状态：{{ statusOf(currentPhoto).label }}</p>
          <p class="current-meta">{{ photoCountSummary(studentPhotos) }}</p>
        </div>
        <div class="current-actions">
          <AppButton size="sm" variant="secondary" @click="openViewer(currentPhoto)">
            查看大图
          </AppButton>
        </div>
      </section>
      <p v-else class="current-empty">
        <template v-if="isDeletedStudent">该学生没有证件照。已退档学生不能新增照片。</template>
        <template v-else>
          当前还没有指定证件照。上传证件照后，可在下方列表里手动「设为当前证件照」。
        </template>
      </p>

      <p class="backup-notice">{{ PHOTO_BACKUP_NOTICE }}</p>

      <!-- 上传 -->
      <section v-if="!isDeletedStudent" class="upload-block">
        <div class="upload-category">
          <AppSegmented
            v-model="uploadCategory"
            :options="[...uploadCategoryOptions]"
            label="上传照片分类"
          />
        </div>
        <div class="upload-actions">
          <AppButton :disabled="uploading.active" @click="pickFiles">
            上传{{ photoCategoryText(uploadCategory) }}
          </AppButton>
          <input
            ref="fileInput"
            class="file-input"
            type="file"
            accept="image/*"
            multiple
            @change="onFilesPicked"
          />
          <p class="upload-hint">
            <template v-if="uploadCategory === 'id-photo'">
              支持一次选择多张；新上传的证件照不会自动成为当前证件照，需要手动指定。
            </template>
            <template v-else>
              支持一次选择多张；生活照只作为生活照保存，不能设为当前证件照。
            </template>
          </p>
        </div>
        <div v-if="uploading.active" class="upload-progress" role="status">
          <span>正在处理并保存 {{ uploading.done }} / {{ uploading.total }} 张…</span>
          <AppButton size="sm" variant="ghost" @click="cancelUpload">取消剩余</AppButton>
        </div>
        <div
          v-else-if="lastBatchSummary && lastBatchSummary.failed > 0"
          class="upload-failures"
          role="alert"
        >
          <p class="upload-failures__title">
            有 {{ lastBatchSummary.failed }} 张保存失败（成功的照片已保留）：
          </p>
          <ul class="upload-failures__list">
            <li v-for="item in lastBatchSummary.failedFiles.slice(0, 5)" :key="item.fileName">
              {{ item.fileName }}：{{ item.error }}
            </li>
          </ul>
          <AppButton size="sm" variant="ghost" @click="lastBatch = undefined">知道了</AppButton>
        </div>
        <div v-if="photoStore.pendingUploadCount > 0" class="upload-pending">
          <span>本机还有 {{ photoStore.pendingUploadCount }} 张照片待上传云端。</span>
          <AppButton size="sm" variant="secondary" @click="retryAll">重试上传</AppButton>
        </div>
      </section>
      <p v-else class="deleted-note">该学生已退档：可以查看历史照片，但不能新增照片。</p>

      <!-- 三视图 -->
      <section class="gallery">
        <div class="gallery-head">
          <AppSegmented v-model="view" :options="viewOptions" label="照片分类视图" />
        </div>

        <div v-if="filteredPhotos.length" class="photo-grid">
          <div v-for="photo in filteredPhotos" :key="photo.id" class="photo-cell">
            <StudentPhotoTile
              :photo="photo"
              :thumb-url="urlOf(photo.id)"
              :state="photoStore.stateOf(photo.id)"
              :last-error="photoStore.lastErrorOf(photo.id)"
              :thumb-failed="hasFailed(photo.id)"
              @open="openViewer"
            />
            <div class="photo-cell__actions">
              <AppButton
                v-if="photo.category === 'id-photo' && !photo.isCurrentIdPhoto"
                size="sm"
                variant="ghost"
                @click="askSetCurrent(photo)"
              >
                设为当前
              </AppButton>
              <AppButton
                v-if="statusOf(photo).kind === 'upload-failed'"
                size="sm"
                variant="ghost"
                @click="retryUpload(photo)"
              >
                重试上传
              </AppButton>
              <!-- 只有本机、云端还没有（含 ZIP 恢复出来的照片）：给一个可点的上传入口 -->
              <AppButton
                v-else-if="canUploadLocalPhoto(photoStore.stateOf(photo.id))"
                size="sm"
                variant="ghost"
                @click="uploadLocalPhoto(photo)"
              >
                上传到云端
              </AppButton>
              <AppButton size="sm" variant="ghost" @click="openViewer(photo)">查看</AppButton>
              <AppButton size="sm" variant="ghost" @click="askDelete(photo)">删除</AppButton>
            </div>
          </div>
        </div>
        <div v-else class="gallery-empty">
          <p>{{ view === 'all' ? '还没有照片。' : `还没有${photoCategoryText(view)}。` }}</p>
        </div>
      </section>
    </div>

    <template #footer>
      <AppButton @click="close">关闭</AppButton>
    </template>
  </AppModal>

  <!-- 设为当前证件照确认 -->
  <AppModal v-model="currentConfirmOpen" title="设为当前证件照" :width="420">
    <p class="confirm-text">
      <template v-if="currentPhoto">
        当前证件照上传于
        <strong>{{ formatPhotoUploadedAt(currentPhoto.uploadedAt) }}</strong>
        ，确定用
        <strong>{{ currentTarget ? formatPhotoUploadedAt(currentTarget.uploadedAt) : '' }}</strong>
        这张替换吗？
      </template>
      <template v-else>确定把这张照片设为当前证件照吗？</template>
    </p>
    <p class="confirm-text">原证件照会保留在历史照片中，不会被删除。</p>
    <template #footer>
      <AppButton variant="ghost" @click="currentConfirmOpen = false">取消</AppButton>
      <AppButton @click="confirmSetCurrent">设为当前证件照</AppButton>
    </template>
  </AppModal>

  <!-- 删除确认 -->
  <AppModal v-model="deleteConfirmOpen" title="删除照片" :width="420">
    <p class="confirm-text">
      确定删除这张
      <strong>{{ deleteTarget ? photoCategoryText(deleteTarget.category) : '' }}</strong>
      （上传于 {{ deleteTarget ? formatPhotoUploadedAt(deleteTarget.uploadedAt) : '' }}）吗？
    </p>
    <p class="confirm-text">
      删除后照片记录会被标记删除、本机缓存会清理；云端已有文件按当前版本策略保留，不会自动删除。
    </p>
    <template #footer>
      <AppButton variant="ghost" @click="deleteConfirmOpen = false">取消</AppButton>
      <AppButton variant="danger" @click="confirmDelete">删除照片</AppButton>
    </template>
  </AppModal>

  <!-- 大图 -->
  <StudentPhotoViewer v-model="viewerOpen" :photos="filteredPhotos" :initial-id="viewerInitialId" />
</template>

<style scoped>
.manager {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.current-block {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
}

.current-thumb {
  width: 96px;
  height: 120px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--color-bg-white);
}

.current-thumb__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.current-thumb__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.current-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.current-title {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.current-meta {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.current-actions {
  flex-shrink: 0;
}

.current-empty {
  padding: var(--space-3);
  border: 1px dashed var(--color-border-medium);
  border-radius: var(--radius-md);
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.upload-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
}

.upload-category {
  max-width: 320px;
}

.upload-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.file-input {
  display: none;
}

.upload-hint {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
  line-height: var(--leading-relaxed);
}

.upload-progress {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

.upload-failures {
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-danger-soft);
}

.upload-failures__title {
  font-size: var(--font-caption);
  color: var(--color-danger-strong);
}

.upload-failures__list {
  margin: var(--space-1) 0;
  font-size: var(--font-caption);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.upload-pending {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-caption);
  color: var(--color-text-secondary);
}

.deleted-note {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-warning-soft);
  font-size: var(--font-secondary);
  color: var(--color-warning-strong);
}

.gallery {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.gallery-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--space-3);
}

.photo-cell {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.photo-cell__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

.photo-cell__error {
  font-size: var(--font-small);
  color: var(--color-danger-strong);
}

.gallery-empty {
  padding: var(--space-6) 0;
  text-align: center;
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.backup-notice {
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  font-size: var(--font-caption);
  line-height: var(--leading-relaxed);
  color: var(--color-text-secondary);
}

.confirm-text {
  font-size: var(--font-secondary);
  line-height: var(--leading-relaxed);
  color: var(--color-text-secondary);
}

.confirm-text + .confirm-text {
  margin-top: var(--space-2);
}

.confirm-text strong {
  color: var(--color-text-primary);
}

@media (max-width: 640px) {
  .current-block {
    flex-direction: column;
    align-items: flex-start;
  }

  .photo-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }

  /* 待上传提示在窄屏上分行，避免「重试上传」按钮被压成竖排两行 */
  .upload-pending {
    flex-direction: column;
    align-items: flex-start;
  }

  .upload-pending .app-button {
    white-space: nowrap;
  }
}
</style>
