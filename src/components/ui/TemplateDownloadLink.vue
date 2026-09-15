<script setup lang="ts">
import { ref } from 'vue'

import { useToast } from '@/composables/useToast'
import { downloadXlsxTemplate } from '@/utils/xlsxTemplate'

/**
 * 导入弹窗里的「下载模板」链接（v3.3.1）。
 *
 * 之前课程表 / 工作清单 / 值日各自抄了一份「拼 CSV → Blob → a.click()」，
 * 而那份 CSV **导入器根本收不了**（`readSheetRows` 按文件头认格式，CSV 过不了）。
 * 现在生成的是真正的 .xlsx，五处共用这一个组件：按钮、样式、成败提示都只有一份。
 *
 * 生成期间禁用按钮并换文案——xlsx 是动态加载的，首次点击要等一会儿，
 * 不换文案的话教师会以为没点着而连点。
 */
interface Props {
  /** 文件名，不必带扩展名 */
  filename: string
  /** 表头（第一行）。**请传解析器认的那一份**，别在这里另抄一套 */
  headers: readonly string[]
  /** 示例行 */
  sample?: readonly (readonly string[])[]
  /** 工作表名 */
  sheetName?: string
  label?: string
}

const props = withDefaults(defineProps<Props>(), {
  sample: () => [],
  sheetName: '导入模板',
  label: '下载模板（Excel）',
})

const toast = useToast()
const busy = ref(false)

async function onDownload(): Promise<void> {
  if (busy.value) return
  busy.value = true
  const ok = await downloadXlsxTemplate({
    filename: props.filename,
    sheetName: props.sheetName,
    headers: props.headers,
    sample: props.sample,
  })
  busy.value = false
  if (!ok) toast.danger('模板下载失败，请检查网络后重试')
}
</script>

<template>
  <button type="button" class="download-link" :disabled="busy" @click="onDownload">
    {{ busy ? '正在生成…' : label }}
  </button>
</template>

<style scoped>
/* 样式与并入前的 `.download-link` 保持一致（三个老弹窗的观感不变），
   只补了生成期间的禁用态——xlsx 是动态加载的，首次点击要等一会儿 */
.download-link {
  border: none;
  background: transparent;
  font: inherit;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-primary-strong);
  cursor: pointer;
  white-space: nowrap;
}

.download-link:hover:not(:disabled) {
  color: var(--color-primary);
}

.download-link:disabled {
  color: var(--color-text-tertiary);
  cursor: default;
}
</style>
