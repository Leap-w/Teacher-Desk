<script setup lang="ts">
/**
 * 单张照片缩略图展示位置调整（v3.8.3 Phase 1）。
 *
 * 只做一件事：拖动照片，改变它在 3:4 缩略图里的 `object-position`。
 * - 不裁图、不重新生成缩略图、不碰原图 Blob，也不影响大图预览；
 * - 保存进 `usePhotoThumbPosition`（本机独立键），不进学生照片业务数据与云同步；
 * - **没有任何人脸 / 主体识别**，文案与图标都只说「显示位置」。
 */
import { computed, ref, watch } from 'vue'
import { Move } from 'lucide-vue-next'

import { AppButton, AppModal } from '@/components/ui'
import { usePhotoThumbPosition } from '@/composables/usePhotoThumbPosition'
import { useToast } from '@/composables/useToast'
import {
  clampPercent,
  coverSlackOf,
  cssPositionOf,
  DEFAULT_PHOTO_THUMB_POSITION,
  positionAfterDrag,
} from '@/utils/photoThumbPosition'
import type { CoverSlack, PhotoThumbPosition } from '@/utils/photoThumbPosition'
import type { StudentPhoto } from '@/types/studentPhoto'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    photo: StudentPhoto
    /** 父组件已经拿到的缩略图 objectURL（大图预览不走这里） */
    thumbUrl?: string
  }>(),
  { thumbUrl: undefined },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const toast = useToast()
const { positionOfPhoto, setPosition, resetPosition } = usePhotoThumbPosition()

const draft = ref<{ x: number; y: number }>({ ...DEFAULT_PHOTO_THUMB_POSITION })
const stageRef = ref<HTMLElement>()
const dragging = ref(false)

/** 图片按 cover 放大后，在两个方向上各有多少像素可被挪动；为 0 的轴拖动无效 */
let dragStart = {
  clientX: 0,
  clientY: 0,
  position: { ...DEFAULT_PHOTO_THUMB_POSITION } as PhotoThumbPosition,
  slack: { x: 0, y: 0 } as CoverSlack,
}

const previewStyle = computed(() => ({
  objectPosition: cssPositionOf(draft.value),
}))

/** 当前容器下的真实可移动余量（容器尺寸 × 照片宽高，换算见 utils） */
function currentSlack(): CoverSlack {
  const stage = stageRef.value
  if (!stage) return { x: 0, y: 0 }
  return coverSlackOf(stage.clientWidth, stage.clientHeight, props.photo.width, props.photo.height)
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) draft.value = { ...positionOfPhoto(props.photo.id) }
  },
  { immediate: true },
)

function onPointerDown(event: PointerEvent): void {
  if (!props.thumbUrl) return
  const slack = currentSlack()
  if (slack.x <= 0 && slack.y <= 0) return
  dragging.value = true
  dragStart = {
    clientX: event.clientX,
    clientY: event.clientY,
    position: { ...draft.value },
    slack,
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  // 换算在 utils 里：posX 越小图片越靠右，所以往右拖是减 x（详见 positionAfterDrag）
  draft.value = positionAfterDrag(
    dragStart.position,
    { dx: event.clientX - dragStart.clientX, dy: event.clientY - dragStart.clientY },
    dragStart.slack,
  )
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return
  dragging.value = false
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
}

/** 键盘微调，无障碍且便于精确落位 */
function onKeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? 10 : 2
  const delta: Record<string, [number, number]> = {
    ArrowLeft: [step, 0],
    ArrowRight: [-step, 0],
    ArrowUp: [0, step],
    ArrowDown: [0, -step],
  }
  const move = delta[event.key]
  if (!move) return
  event.preventDefault()
  draft.value = {
    x: clampPercent(draft.value.x + move[0]) ?? draft.value.x,
    y: clampPercent(draft.value.y + move[1]) ?? draft.value.y,
  }
}

function close(): void {
  emit('update:modelValue', false)
}

function save(): void {
  if (!setPosition(props.photo.id, draft.value.x, draft.value.y)) {
    toast.danger('保存失败：本机存储不可用，请稍后重试')
    return
  }
  toast.success('已保存这张照片的显示位置')
  close()
}

function reset(): void {
  if (!resetPosition(props.photo.id)) {
    toast.danger('恢复默认失败：本机存储不可用，请稍后重试')
    return
  }
  draft.value = { ...DEFAULT_PHOTO_THUMB_POSITION }
  toast.info('已恢复默认显示位置')
  close()
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    title="调整照片显示位置"
    :width="440"
    @update:model-value="close"
  >
    <div class="position-editor">
      <div
        ref="stageRef"
        class="editor-stage"
        :class="{ 'is-dragging': dragging }"
        role="img"
        tabindex="0"
        aria-label="拖动或使用方向键调整照片在缩略图中的显示位置"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @keydown="onKeydown"
      >
        <img v-if="thumbUrl" :src="thumbUrl" alt="" class="editor-image" :style="previewStyle" />
        <span v-else class="editor-placeholder">缩略图暂不可用</span>
      </div>

      <p class="editor-hint">
        <Move :size="14" :stroke-width="2" aria-hidden="true" />
        拖动照片调整它在缩略图中显示的部分；方向键可微调。
      </p>
      <p class="editor-readout">
        水平 {{ Math.round(draft.x) }}% · 垂直 {{ Math.round(draft.y) }}%
      </p>
      <p class="editor-note">只影响这台设备上的缩略图显示，不会修改原图或大图预览。</p>
    </div>

    <template #footer>
      <AppButton variant="ghost" size="sm" @click="reset">恢复默认</AppButton>
      <AppButton variant="secondary" size="sm" @click="close">取消</AppButton>
      <AppButton size="sm" @click="save">保存</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.position-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* 与实际缩略图共用同一比例令牌；touch-action 防止拖动被当成页面滚动。
   v3.8.3：宽度同时受「容器宽 / 300px / 60vh 换算出的宽」三者约束——只用 max-height
   的话高度先被夹、宽度不回缩，3:4 会失真（横屏手机实测 300×234，比例 1.28）。 */
.editor-stage {
  position: relative;
  width: min(100%, 300px, calc(60vh * 3 / 4));
  margin: 0 auto;
  aspect-ratio: var(--photo-thumb-ratio);
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
  cursor: grab;
  touch-action: none;
  user-select: none;
  outline: none;
}

.editor-stage.is-dragging {
  cursor: grabbing;
}

.editor-stage:focus-visible {
  box-shadow: var(--ring-focus);
}

.editor-image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  pointer-events: none;
}

.editor-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.editor-hint {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}

.editor-readout {
  font-size: var(--font-caption);
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.editor-note {
  font-size: var(--font-caption);
  line-height: var(--leading-relaxed);
  color: var(--color-text-tertiary);
}
</style>
