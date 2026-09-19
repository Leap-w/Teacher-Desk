<script setup lang="ts">
import AppButton from './AppButton.vue'

/**
 * ImportFileRow — 已选文件那一行（v3.5.0）。
 *
 * 「文件名 + 工作表说明 + 重新选择」加一行「识别到 N 列」，五个导入弹窗一模一样，
 * 之前五份 CSS 也一模一样（§11 体检会把这类重复点名）。抽出来之后，
 * 改这行的观感只用改一处。
 */
withDefaults(
  defineProps<{
    /** 已选文件名 */
    filename: string
    /** 工作表说明（如「工作表「学生名单」」） */
    sheetNote?: string
    /** 表头识别到的列名 */
    columns?: readonly string[]
    reselectLabel?: string
  }>(),
  {
    sheetNote: '',
    columns: () => [],
    reselectLabel: '重新选择',
  },
)

const emit = defineEmits<{ reselect: [] }>()
</script>

<template>
  <!-- 单根：多根节点（fragment）会让父级传下来的 class 无处可落，Vue 也会警告 -->
  <div>
    <div class="file-row">
      <div class="file-meta">
        <strong class="file-name">{{ filename }}</strong>
        <span v-if="sheetNote" class="file-sheet">{{ sheetNote }}</span>
      </div>
      <AppButton size="sm" variant="ghost" @click="emit('reselect')">{{ reselectLabel }}</AppButton>
    </div>

    <p v-if="columns.length" class="columns-note">
      识别到 {{ columns.length }} 列：{{ columns.join('、') }}
    </p>
  </div>
</template>

<style scoped>
.file-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.file-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.file-name {
  font-size: var(--text-sm);
  color: var(--color-text);
  overflow-wrap: anywhere;
}

.file-sheet {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.columns-note {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}
</style>
