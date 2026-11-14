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
import { Search } from 'lucide-vue-next'

import { AppCard, AppInput } from '@/components/ui'
import { usePhotoThumbUrls } from '@/composables/usePhotoThumbUrls'
import { useStudentStore } from '@/stores/student'
import { useStudentPhotoStore } from '@/stores/studentPhoto'
import { formatStudentShortName } from '@/utils/student'
import { PHOTO_BACKUP_NOTICE, buildClassPhotoWall, photoCountSummary } from '@/utils/photoUi'
import StudentPhotoManager from '@/views/Students/components/StudentPhotoManager.vue'
import type { Student } from '@/types'

const studentStore = useStudentStore()
const photoStore = useStudentPhotoStore()
const { ensure, urlOf, hasFailed } = usePhotoThumbUrls()

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
          <p class="wall-summary">
            在读 {{ studentStore.activeStudents.length }} 人 · 已设置当前证件照
            {{ withCurrentCount }} 人
          </p>
        </div>

        <p v-if="pendingUploadCount > 0" class="wall-pending">
          本机还有 {{ pendingUploadCount }} 张照片待上传云端；照片已安全保存在本机。
        </p>
        <p v-if="withCurrentCount === 0 && allRows.length > 0" class="wall-empty-hint">
          还没有学生设置证件照。点击下方学生卡片即可上传照片，或把某张证件照设为「当前证件照」。
        </p>

        <div v-if="wallRows.length" class="wall-grid">
          <button
            v-for="row in wallRows"
            :key="row.student.id"
            type="button"
            class="wall-card"
            :aria-label="`打开 ${row.student.name} 的照片管理`"
            @click="openStudent(row.student)"
          >
            <span class="wall-media">
              <img
                v-if="row.currentPhoto && urlOf(row.currentPhoto.id)"
                :src="urlOf(row.currentPhoto.id)"
                alt=""
                class="wall-img"
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
        <p v-else class="wall-empty">
          {{ keyword.trim() ? '没有匹配的学生。' : '暂无在读学生。' }}
        </p>

        <p class="backup-notice">{{ PHOTO_BACKUP_NOTICE }}</p>
        <p class="privacy-notice">
          学生照片属于未成年人个人信息：默认只保存在本机，请勿公开分享；删除为逻辑删除，云端文件按当前策略保留。
        </p>
      </div>
    </AppCard>

    <StudentPhotoManager v-if="managerStudent" v-model="managerOpen" :student="managerStudent" />
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

.wall-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
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
  display: block;
  aspect-ratio: 3 / 4;
  background: var(--color-bg-subtle);
}

.wall-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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

@media (max-width: 640px) {
  .wall {
    padding: var(--spacing-card) var(--space-3);
  }

  .wall-grid {
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  }
}
</style>
