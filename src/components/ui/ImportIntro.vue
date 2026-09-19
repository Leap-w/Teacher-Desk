<script setup lang="ts">
import TemplateDownloadLink from './TemplateDownloadLink.vue'

/**
 * ImportIntro — 导入弹窗的首屏说明区（v3.5.0，样式取自座位导入弹窗）。
 *
 * 未选文件时**先讲清楚表格该怎么摆**：教师回去改表，比在弹窗里来回试快得多。
 * 四段从上到下：一句导语 + 「下载模板」、必填 / 选填清单（默认插槽）、示例表、
 * 一行脚注（把示例读成人话）。
 *
 * 表头与示例**必须传解析器认的那一份**（服务层导出的 `*_IMPORT_HEADERS` / `*_IMPORT_SAMPLE`）：
 * 组件里再抄一份，就会出现「模板上写着 A、识别器只认 B」那种自家模板导不进自家系统的事故。
 */
defineProps<{
  /** 导语：说明选什么文件、第一行是什么 */
  lead: string
  /** 下载文件名（不必带扩展名） */
  filename: string
  /** 表头，传解析器认的那一份 */
  headers: readonly string[]
  /** 示例行 */
  sample?: readonly (readonly string[])[]
  /** 工作表名 */
  sheetName?: string
  /** 脚注：把示例读成一句人话 */
  note?: string
}>()
</script>

<template>
  <div class="intro">
    <header class="intro-hint">
      <p class="intro-lead">{{ lead }}</p>
      <TemplateDownloadLink
        :filename="filename"
        :sheet-name="sheetName"
        :headers="headers"
        :sample="sample"
      />
    </header>

    <ul v-if="$slots.default" class="intro-list">
      <slot />
    </ul>

    <template v-if="sample && sample.length">
      <div class="intro-sample-scroll">
        <table class="intro-sample">
          <thead>
            <tr>
              <th v-for="header in headers" :key="header">{{ header }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in sample" :key="index">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="note" class="intro-note">{{ note }}</p>
    </template>
  </div>
</template>

<style scoped>
.intro-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.intro-lead {
  font-size: var(--text-sm);
  color: var(--color-text);
}

.intro-list {
  margin-top: var(--space-3);
  padding-left: 1.2em;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.intro-list strong {
  color: var(--color-text);
}

/* 示例表可能十几列（学生名单 13 列），窄弹窗里横向滚动，
   而不是把弹窗撑破或把示例压成两行看不清 */
.intro-sample-scroll {
  margin-top: var(--space-4);
  overflow-x: auto;
}

.intro-sample {
  border-collapse: collapse;
  font-size: var(--text-xs);
}

.intro-sample th,
.intro-sample td {
  padding: 4px 14px 4px 0;
  text-align: left;
  white-space: nowrap;
  color: var(--color-text-secondary);
}

.intro-sample th {
  font-weight: 600;
  color: var(--color-text);
}

.intro-note {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
</style>
