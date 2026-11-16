<script setup lang="ts">
/**
 * 班级照片墙（独立页面 · v3.8.1 Phase 1）。
 *
 * 由 v3.8.0 的 `StudentPhotoWallModal`（弹窗）改为 `/class/photos` 独立页面：
 * - 导航落在「班级管理」的既有二级导航里（追加在最后，原有六个位置不动）；
 * - **数据能力一行未改**：学生名册来自 student Store，照片来自 studentPhoto Store，
 *   缩略图走 `usePhotoThumbUrls`（内部仍调用 Store 的 Blob 能力），
 *   单名学生的上传 / 更换 / 删除 / 大图继续复用 `StudentPhotoManager`；
 * - 不放任何人脸识别 / 自动身份匹配；照片只按稳定 `Student.id` 关联。
 *
 * 页面本身只负责「集体视图」：每名在读学生一张卡，展示当前证件照或统一占位，
 * 点卡片进入该学生的照片管理。已退档学生不进入在读照片墙（其历史照片仍可从档案/违纪页查看）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { Check, Search } from 'lucide-vue-next'

import { AppButton, AppCard, AppInput, AppModal } from '@/components/ui'
import { usePhotoBatchManage } from '@/composables/usePhotoBatchManage'
import { usePhotoThumbPosition } from '@/composables/usePhotoThumbPosition'
import { usePhotoThumbUrls } from '@/composables/usePhotoThumbUrls'
import { useToast } from '@/composables/useToast'
import { useStudentStore } from '@/stores/student'
import { useStudentPhotoStore } from '@/stores/studentPhoto'
import { formatStudentShortName } from '@/utils/student'
import { PHOTO_BACKUP_NOTICE, buildClassPhotoWall, photoCountSummary } from '@/utils/photoUi'
import PhotoImportModal from './components/PhotoImportModal.vue'
import StudentPhotoManager from '@/views/Students/components/StudentPhotoManager.vue'
import type { Student } from '@/types'

const studentStore = useStudentStore()
const photoStore = useStudentPhotoStore()
const toast = useToast()
const { ensure, urlOf, hasFailed } = usePhotoThumbUrls()
const { objectPositionOf } = usePhotoThumbPosition()

const keyword = ref('')

const allRows = computed(() => buildClassPhotoWall(studentStore.activeStudents, photoStore.photos))

const wallRows = computed(() => {
  const rows = allRows.value
  const query = keyword.value.trim().toLowerCase()
  if (!query) return rows
  return rows.filter((row) => {
    const haystack = [row.student.name, row.student.studentNo, row.student.idCardSuffix ?? '']
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  })
})

/**
 * 当前屏幕上真正可见的照片（搜索过滤之后）。
 * 批量选择只允许落在这些照片上：被筛掉的会被自动取消选择，删除也只会作用于可见项。
 */
const visiblePhotoIds = computed(() =>
  wallRows.value.map((row) => row.currentPhoto?.id).filter((id): id is string => Boolean(id)),
)

const {
  managing,
  deleting,
  selectedCount,
  hasSelection,
  isSelected,
  enter: enterManage,
  exit: exitManage,
  toggle: toggleSelection,
  removeSelected,
} = usePhotoBatchManage(() => visiblePhotoIds.value)

const withCurrentCount = computed(
  () => allRows.value.filter((row) => Boolean(row.currentPhoto)).length,
)

const pendingUploadCount = computed(() => photoStore.pendingUploadCount)

function ensureThumbs(): void {
  const ids = wallRows.value
    .map((row) => row.currentPhoto?.id)
    .filter((id): id is string => Boolean(id))
  if (ids.length) void ensure(ids)
}

onMounted(() => {
  // 页面可能被直接刷新/深链打开：先按本机媒体库的实际存在性重算状态再取缩略图
  void photoStore.refreshLocalPresence().then(ensureThumbs)
})

// 照片变化 / 学生改名或进退档后重新取缩略图（与 v3.8.0 弹窗行为一致）
watch(
  () => wallRows.value.map((row) => row.currentPhoto?.id ?? '').join('|'),
  () => ensureThumbs(),
)
watch(
  () => studentStore.activeStudents.map((student) => `${student.id}|${student.name}`).join('|'),
  () => ensureThumbs(),
)

/* ---------- 单名学生照片管理（复用既有弹窗，不重写一套） ---------- */

const managerOpen = ref(false)
const managerStudent = ref<Student>()

function openStudent(student: Student): void {
  managerStudent.value = student
  managerOpen.value = true
}

/* ---------- 批量管理（v3.8.3 调整：原独立「批量导入」入口升级为统一管理模式） ---------- */
const deleteOpen = ref(false)

/** 卡片点击：浏览态进该生照片管理；管理态只切换这张**照片**的选中状态 */
function onCardClick(student: Student, photoId: string | undefined): void {
  if (!managing.value) {
    openStudent(student)
    return
  }
  if (photoId) toggleSelection(photoId)
}

function askDelete(): void {
  if (!hasSelection.value || deleting.value) return
  deleteOpen.value = true
}

async function confirmDelete(): Promise<void> {
  if (deleting.value) return
  const result = await removeSelected()
  deleteOpen.value = false
  // store 是响应式的，这里补一次取缩略图（与导入后的处理一致）
  ensureThumbs()
  if (result.requested === 0) {
    toast.info('所选照片已不存在或已删除，选择已更新')
    return
  }
  // 三档结果各自计数：成功只数 removed，skipped 绝不能并进成功数
  if (!result.removed.length && !result.failed.length) {
    toast.info(`这 ${result.skipped.length} 张照片已在其他标签页或设备删除`)
    return
  }
  if (!result.failed.length) {
    toast.success(`已永久删除 ${result.removed.length} 张照片`)
    if (result.skipped.length) {
      toast.info(`另有 ${result.skipped.length} 张照片已在其他标签页或设备删除`)
    }
  } else if (!result.removed.length && !result.skipped.length) {
    toast.danger(
      `删除失败：${result.failed.length} 张照片都没有删掉（${result.failed[0].message}）`,
    )
  } else {
    const parts = [`成功 ${result.removed.length} 张`, `失败 ${result.failed.length} 张`]
    if (result.skipped.length) parts.push(`已在别处删除 ${result.skipped.length} 张`)
    toast.danger(`部分删除失败：${parts.join('，')}（${result.failed[0].message}）`)
  }
  if (!result.positionCleaned) {
    toast.danger('照片已删除，但本机缩略图位置配置未清理干净，可稍后重试')
  }
}

/* ---------- 批量导入（v3.8.2 能力，入口收进批量管理模式） ---------- */
const importOpen = ref(false)

function onImportChanged(): void {
  // 导入新增照片后重算缩略图（Store 是响应式的，wallRows 会自动更新；这里补拉缩略图）
  ensureThumbs()
}
</script>

<template>
  <div class="photo-wall-page">
    <AppCard padding="none">
      <div class="wall">
        <div class="wall-toolbar">
          <label class="wall-search">
            <Search :size="16" :stroke-width="2" aria-hidden="true" />
            <AppInput v-model="keyword" placeholder="按姓名 / 学号搜索" size="sm" clearable />
          </label>
          <div class="wall-toolbar__right">
            <p class="wall-summary">
              在读 {{ studentStore.activeStudents.length }} 人 · 已设置当前证件照
              {{ withCurrentCount }} 人
            </p>
            <template v-if="managing">
              <p class="wall-selected" aria-live="polite">已选 {{ selectedCount }} 张照片</p>
              <AppButton size="sm" variant="secondary" @click="importOpen = true">
                批量导入
              </AppButton>
              <AppButton
                size="sm"
                variant="danger"
                :disabled="!hasSelection || deleting"
                @click="askDelete"
              >
                批量删除
              </AppButton>
              <AppButton size="sm" variant="ghost" @click="exitManage">退出管理</AppButton>
            </template>
            <AppButton v-else size="sm" variant="secondary" @click="enterManage">
              批量管理
            </AppButton>
          </div>
        </div>

        <p v-if="pendingUploadCount > 0" class="wall-pending">
          本机还有 {{ pendingUploadCount }} 张照片待上传云端；照片已安全保存在本机。
        </p>
        <p v-if="withCurrentCount === 0 && allRows.length > 0" class="wall-empty-hint">
          还没有学生设置证件照。点击下方学生卡片即可上传照片，或把某张证件照设为「当前证件照」。
        </p>

        <div v-if="wallRows.length" class="wall-grid">
          <div v-for="row in wallRows" :key="row.student.id" class="wall-cell">
            <button
              type="button"
              class="wall-card"
              :class="{
                'is-managing': managing,
                'is-selected': managing && !!row.currentPhoto && isSelected(row.currentPhoto.id),
                'is-static': managing && !row.currentPhoto,
              }"
              :aria-label="
                managing
                  ? row.currentPhoto
                    ? `${isSelected(row.currentPhoto.id) ? '取消选中' : '选中'} ${row.student.name} 的证件照`
                    : `${row.student.name} 还没有可选的照片`
                  : `打开 ${row.student.name} 的照片管理`
              "
              :aria-pressed="
                managing && row.currentPhoto ? isSelected(row.currentPhoto.id) : undefined
              "
              :aria-disabled="managing && !row.currentPhoto ? 'true' : undefined"
              @click="onCardClick(row.student, row.currentPhoto?.id)"
            >
              <span class="wall-media">
                <img
                  v-if="row.currentPhoto && urlOf(row.currentPhoto.id)"
                  :src="urlOf(row.currentPhoto.id)"
                  alt=""
                  class="wall-img"
                  :style="{ objectPosition: objectPositionOf(row.currentPhoto.id) }"
                  loading="lazy"
                />
                <span v-else class="wall-placeholder">
                  <span class="wall-initial">{{ row.student.name.charAt(0) }}</span>
                  <span class="wall-placeholder-text">{{
                    row.currentPhoto
                      ? hasFailed(row.currentPhoto.id)
                        ? '证件照加载失败'
                        : '证件照加载中…'
                      : '未设置证件照'
                  }}</span>
                </span>
                <!-- 管理模式的选中指示：选择对象是这张照片，不是学生 -->
                <span v-if="managing && row.currentPhoto" class="wall-check" aria-hidden="true">
                  <Check v-if="isSelected(row.currentPhoto.id)" :size="14" :stroke-width="3" />
                </span>
              </span>
              <span class="wall-info">
                <span class="wall-name">
                  {{ formatStudentShortName(row.student, studentStore.nameCounts) }}
                </span>
                <span class="wall-count">{{
                  photoCountSummary(photoStore.listStudentPhotos(row.student.id))
                }}</span>
              </span>
            </button>
          </div>
        </div>
        <p v-else class="wall-empty">
          {{ keyword.trim() ? '没有匹配的学生。' : '暂无在读学生。' }}
        </p>

        <p class="backup-notice">{{ PHOTO_BACKUP_NOTICE }}</p>
        <p class="privacy-notice">
          学生照片属于未成年人个人信息：默认只保存在本机，请勿公开分享；删除后照片会从照片墙与照片管理中
          永久移除，本机缓存一并清理，应用内不提供恢复；云端文件暂按现有策略保留。
        </p>
      </div>
    </AppCard>

    <StudentPhotoManager v-if="managerStudent" v-model="managerOpen" :student="managerStudent" />
    <PhotoImportModal v-model="importOpen" @changed="onImportChanged" />

    <!-- 批量永久删除确认：没有回收站，删掉就不再出现在照片墙与照片管理里 -->
    <AppModal v-model="deleteOpen" title="批量删除照片" :width="440">
      <p class="confirm-text">
        即将永久删除已选中的 <strong>{{ selectedCount }}</strong> 张照片。
      </p>
      <p class="confirm-text">
        删除后不可恢复：照片会从照片墙与该学生的照片管理中永久移除，本机缓存的图片文件一并清理，
        应用内不提供恢复入口。
      </p>
      <p class="confirm-text">
        已上传到云端的文件暂时保留（本次不会删除云端文件），但不会再出现在任何界面。
        学生档案与未选中的照片不受影响。
      </p>
      <template #footer>
        <AppButton variant="ghost" :disabled="deleting" @click="deleteOpen = false">取消</AppButton>
        <AppButton variant="danger" :loading="deleting" @click="confirmDelete">
          {{ deleting ? '正在删除…' : `永久删除 ${selectedCount} 张` }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.photo-wall-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.wall {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--spacing-card);
}

.wall-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.wall-search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 200px;
  max-width: 320px;
  flex: 1;
  color: var(--color-text-tertiary);
}

.wall-search :deep(.app-input) {
  flex: 1;
}

.wall-toolbar__right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.wall-summary {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.wall-pending {
  font-size: var(--font-caption);
  color: var(--color-warning-strong);
}

.wall-empty-hint {
  font-size: var(--font-caption);
  line-height: var(--leading-relaxed);
  color: var(--color-text-secondary);
}

.wall-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--space-3);
}

/* 批量管理模式：卡片本身成为「照片选择项」，选择对象是这张照片，不是学生 */
.wall-cell {
  position: relative;
  min-width: 0;
}

.wall-selected {
  font-size: var(--font-caption);
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.wall-card.is-selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-soft);
}

/* 没有照片的卡片在管理模式里不可选，但保留占位尺寸 */
.wall-card.is-static {
  cursor: default;
  opacity: 0.6;
}

.wall-check {
  position: absolute;
  top: var(--space-1);
  left: var(--space-1);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1.5px solid var(--color-border-medium);
  border-radius: var(--radius-full);
  background: var(--color-bg-white);
  color: var(--color-text-inverse);
}

.wall-card.is-selected .wall-check {
  border-color: var(--color-primary);
  background: var(--color-primary);
}

.wall-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  /* v3.8.3：button 的 width:auto 在 Chrome 下按 fit-content 算，
     无照片的占位卡片会缩到 105px（有照片的撑满 157px），同排参差 */
  width: 100%;
  padding: 0;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-bg-white);
  overflow: hidden;
  cursor: pointer;
  text-align: left;
  color: inherit;
}

.wall-card:hover {
  border-color: var(--color-border-medium);
  box-shadow: var(--shadow-sm);
}

.wall-card:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.wall-media {
  position: relative;
  display: block;
  /* v3.8.3：比例与默认取景改由共享令牌给出（原来写死 3 / 4） */
  aspect-ratio: var(--photo-thumb-ratio);
  /* v3.8.3 修复：本元素是纵向 flex 子项，`min-height: auto` 会取内容的固有高度，
     瘦长图（1:2、9:16、一寸照）会把媒体区顶高、3:4 失效；
     overflow 非 visible 时自动最小尺寸归零，比例才真正生效（与 .current-thumb 同法） */
  overflow: hidden;
  background: var(--color-bg-subtle);
}

.wall-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: var(--photo-thumb-position);
  display: block;
}

.wall-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  width: 100%;
  height: 100%;
  color: var(--color-text-tertiary);
}

.wall-initial {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
}

.wall-placeholder-text {
  font-size: var(--font-small);
}

.wall-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-1) var(--space-2) var(--space-2);
  min-width: 0;
}

.wall-name {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
}

.wall-count {
  font-size: var(--font-small);
  color: var(--color-text-tertiary);
}

.wall-empty {
  padding: var(--space-6) 0;
  text-align: center;
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.backup-notice,
.privacy-notice {
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
  font-weight: var(--font-weight-semibold);
}

@media (max-width: 640px) {
  .wall {
    padding: var(--spacing-card) var(--space-3);
  }

  .wall-grid {
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  }
}
</style>
