<script setup lang="ts">
/**
 * 单张照片缩略图卡片（照片墙 / 管理页共用）。
 *
 * 只展示：缩略图（或加载/失败占位）、上传时间、分类、"当前证件照"标记、媒体状态文字。
 * 点击交给父组件决定打开大图还是管理页。
 */
import { computed } from 'vue'

import { AppBadge } from '@/components/ui'
import { formatPhotoUploadedAt, photoCategoryText, photoStatusView } from '@/utils/photoUi'
import type { StudentPhoto } from '@/types/studentPhoto'

const props = withDefaults(
  defineProps<{
    photo: StudentPhoto
    thumbUrl?: string
    /** 数据层派生状态 */
    state: Parameters<typeof photoStatusView>[0]
    lastError?: string
    /** 是否显示分类徽标 */
    showCategory?: boolean
    /** 缩略图是否加载失败（失败时显示"预览不可用"，不一直显示"加载中"） */
    thumbFailed?: boolean
  }>(),
  { thumbUrl: undefined, lastError: undefined, showCategory: true, thumbFailed: false },
)

const emit = defineEmits<{ open: [photo: StudentPhoto] }>()

const status = computed(() => photoStatusView(props.state, props.lastError))
const isCurrent = computed(
  () => props.photo.category === 'id-photo' && props.photo.isCurrentIdPhoto === true,
)
const uploadedAt = computed(() => formatPhotoUploadedAt(props.photo.uploadedAt))
</script>

<template>
  <button
    type="button"
    class="photo-tile"
    :aria-label="`查看${photoCategoryText(photo.category)}（上传于 ${uploadedAt}）`"
    @click="emit('open', photo)"
  >
    <span class="photo-tile__media">
      <img v-if="thumbUrl" :src="thumbUrl" alt="" class="photo-tile__img" loading="lazy" />
      <span v-else class="photo-tile__placeholder">{{
        thumbFailed ? '预览不可用' : '加载中…'
      }}</span>
      <span v-if="isCurrent" class="photo-tile__current">当前证件照</span>
    </span>
    <span class="photo-tile__meta">
      <span class="photo-tile__time">{{ uploadedAt }}</span>
      <span class="photo-tile__badges">
        <AppBadge v-if="showCategory" variant="neutral" size="sm">
          {{ photoCategoryText(photo.category) }}
        </AppBadge>
        <AppBadge
          :variant="
            status.tone === 'danger'
              ? 'danger'
              : status.tone === 'warning'
                ? 'warning'
                : status.tone === 'success'
                  ? 'success'
                  : 'neutral'
          "
          size="sm"
        >
          {{ status.label }}
        </AppBadge>
      </span>
    </span>
  </button>
</template>

<style scoped>
.photo-tile {
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

.photo-tile:hover {
  border-color: var(--color-border-medium);
  box-shadow: var(--shadow-sm);
}

.photo-tile:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.photo-tile__media {
  position: relative;
  display: block;
  aspect-ratio: 4 / 3;
  background: var(--color-bg-subtle);
}

.photo-tile__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.photo-tile__placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.photo-tile__current {
  position: absolute;
  top: var(--space-1);
  left: var(--space-1);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-text-inverse);
  font-size: var(--font-small);
  font-weight: var(--font-weight-semibold);
}

.photo-tile__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--space-1) var(--space-2) var(--space-2);
}

.photo-tile__time {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.photo-tile__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
