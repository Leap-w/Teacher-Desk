<script setup lang="ts">
/**
 * 照片大图查看（Phase 2 UI）。
 *
 * 图片来自 Phase 1B Store：本机有就读本机，只有云端就按需下载后展示；
 * **不拼接、不持久化任何签名 URL**（`getPhotoBlob` 内部处理云端取数并落本地缓存）。
 * 支持上一张 / 下一张（首尾循环）、显示分类 / 上传时间 / 当前证件照标记 / 媒体状态。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { AppBadge, AppButton, AppModal } from '@/components/ui'
import { useStudentPhotoStore } from '@/stores/studentPhoto'
import {
  formatPhotoUploadedAt,
  photoCategoryText,
  photoStatusView,
  stepPhotoViewer,
} from '@/utils/photoUi'
import type { StudentPhoto } from '@/types/studentPhoto'

const props = withDefaults(
  defineProps<{ modelValue: boolean; photos: StudentPhoto[]; initialId?: string }>(),
  { initialId: undefined },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const store = useStudentPhotoStore()

const index = ref(0)
const loading = ref(false)
const errorText = ref('')
const objectUrl = ref<string | undefined>(undefined)

const current = computed<StudentPhoto | undefined>(() => props.photos[index.value])
const currentId = computed(() => current.value?.id ?? '')
const status = computed(() =>
  current.value
    ? photoStatusView(store.stateOf(current.value.id), store.lastErrorOf(current.value.id))
    : undefined,
)
const uploadedAt = computed(() =>
  current.value ? formatPhotoUploadedAt(current.value.uploadedAt) : '',
)
const isCurrent = computed(
  () => current.value?.category === 'id-photo' && current.value?.isCurrentIdPhoto === true,
)

function revokeUrl(): void {
  if (objectUrl.value) {
    URL.revokeObjectURL(objectUrl.value)
    objectUrl.value = undefined
  }
}

async function loadCurrent(): Promise<void> {
  const photo = current.value
  revokeUrl()
  errorText.value = ''
  if (!photo) return
  loading.value = true
  try {
    const blob = await store.getPhotoBlob(photo.id)
    if (current.value?.id === photo.id) objectUrl.value = URL.createObjectURL(blob)
  } catch (error) {
    errorText.value = error instanceof Error && error.message ? error.message : '照片加载失败'
  } finally {
    loading.value = false
  }
}

function syncIndex(): void {
  if (!props.photos.length) {
    index.value = 0
    return
  }
  const found = props.initialId
    ? props.photos.findIndex((photo) => photo.id === props.initialId)
    : -1
  index.value = found >= 0 ? found : 0
}

function step(delta: number): void {
  if (!current.value || props.photos.length <= 1) return
  const nextId = stepPhotoViewer(props.photos, current.value.id, delta)
  const nextIndex = props.photos.findIndex((photo) => photo.id === nextId)
  if (nextIndex >= 0) index.value = nextIndex
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    step(-1)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    step(1)
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      syncIndex()
      void loadCurrent()
      window.addEventListener('keydown', onKeydown)
    } else {
      window.removeEventListener('keydown', onKeydown)
      revokeUrl()
    }
  },
)

watch(currentId, () => {
  if (props.modelValue) void loadCurrent()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  revokeUrl()
})

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <AppModal :model-value="modelValue" title="照片查看" :width="880" @update:model-value="close">
    <div class="viewer">
      <div class="viewer-stage">
        <img
          v-if="objectUrl"
          :src="objectUrl"
          :alt="current ? `${photoCategoryText(current.category)}，上传于 ${uploadedAt}` : '照片'"
          class="viewer-image"
        />
        <div v-else class="viewer-placeholder">
          <p v-if="loading">照片加载中…</p>
          <p v-else-if="errorText" class="viewer-error">{{ errorText }}</p>
          <p v-else>没有可显示的照片。</p>
        </div>

        <button
          v-if="photos.length > 1"
          type="button"
          class="viewer-nav viewer-nav--prev"
          aria-label="上一张"
          @click="step(-1)"
        >
          ‹
        </button>
        <button
          v-if="photos.length > 1"
          type="button"
          class="viewer-nav viewer-nav--next"
          aria-label="下一张"
          @click="step(1)"
        >
          ›
        </button>
      </div>

      <div v-if="current" class="viewer-meta">
        <div class="viewer-badges">
          <AppBadge variant="neutral">{{ photoCategoryText(current.category) }}</AppBadge>
          <AppBadge v-if="isCurrent" variant="primary">当前证件照</AppBadge>
          <AppBadge
            v-if="status"
            :variant="
              status.tone === 'danger'
                ? 'danger'
                : status.tone === 'warning'
                  ? 'warning'
                  : status.tone === 'success'
                    ? 'success'
                    : 'neutral'
            "
          >
            {{ status.label }}
          </AppBadge>
        </div>
        <p class="viewer-time">上传时间：{{ uploadedAt }}</p>
        <p v-if="status && status.kind !== 'ready'" class="viewer-desc">
          {{ status.description }}
        </p>
        <p class="viewer-position">{{ index + 1 }} / {{ photos.length }}</p>
      </div>
    </div>

    <template #footer>
      <AppButton variant="secondary" :disabled="photos.length <= 1" @click="step(-1)">
        上一张
      </AppButton>
      <AppButton variant="secondary" :disabled="photos.length <= 1" @click="step(1)">
        下一张
      </AppButton>
      <AppButton @click="close">关闭</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.viewer {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.viewer-stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
  max-height: 60vh;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.viewer-image {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
  display: block;
}

.viewer-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
  padding: var(--space-4);
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
  text-align: center;
}

.viewer-error {
  color: var(--color-danger-strong);
}

.viewer-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: rgba(16, 24, 32, 0.45);
  color: #fff;
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.viewer-nav:hover {
  background: rgba(16, 24, 32, 0.6);
}

.viewer-nav:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.viewer-nav--prev {
  left: var(--space-2);
}

.viewer-nav--next {
  right: var(--space-2);
}

.viewer-meta {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.viewer-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.viewer-time,
.viewer-desc,
.viewer-position {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.viewer-desc {
  line-height: var(--leading-relaxed);
  color: var(--color-text-secondary);
}

.viewer-position {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
