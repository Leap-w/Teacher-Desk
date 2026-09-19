<script setup lang="ts">
import type { ImportActionMeta, ImportPreviewColumn, ImportPreviewRow } from './importUi'

/**
 * ImportPreviewTable — 逐行预览表（v3.5.0，样式取自座位导入弹窗）。
 *
 * **数据驱动的，不留插槽**：五个模块的行形状完全不同（座位有「变化」、课程有「覆盖了什么」、
 * 工作有「已存在」），统一做法是各弹窗把行**映射**成
 * `{ rowNumber, action, cells, errors, warnings }`，表格本身只管画。
 * 这样 `.preview-table` 只有一份样式，也不会因为插槽内容的 scoped 样式穿不过来而破相。
 *
 * 「行」列固定在最左（教师回 Excel 核对就按这个数字找）、「状态」列固定在最右
 * （徽标 + 拦截原因 + 提示），中间各列由调用方给。
 */
defineProps<{
  columns: readonly ImportPreviewColumn[]
  rows: readonly ImportPreviewRow[]
  /** action → 徽标文案与色调；未登记的 action 按中性处理 */
  actions: Record<string, ImportActionMeta>
}>()

function metaOf(actions: Record<string, ImportActionMeta>, action: string): ImportActionMeta {
  return actions[action] ?? { label: action, tone: 'info' }
}
</script>

<template>
  <div class="preview-scroll">
    <table class="preview-table">
      <thead>
        <tr>
          <th class="col-no">行</th>
          <th v-for="column in columns" :key="column.key" :class="{ 'is-wrap': column.wrap }">
            {{ column.label }}
          </th>
          <th class="col-status">
            <div class="status-body">状态</div>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.rowNumber"
          :class="{ 'is-blocked': metaOf(actions, row.action).tone === 'bad' }"
        >
          <td class="col-no">{{ row.rowNumber }}</td>
          <td v-for="column in columns" :key="column.key" :class="{ 'is-wrap': column.wrap }">
            {{ row.cells[column.key] || '—' }}
          </td>
          <td class="col-status">
            <div class="status-body">
              <span class="status" :class="`is-${metaOf(actions, row.action).tone}`">
                {{ metaOf(actions, row.action).label }}
              </span>
              <span v-for="text in row.errors" :key="text" class="note is-error">{{ text }}</span>
              <span v-for="text in row.warnings" :key="text" class="note">{{ text }}</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.preview-scroll {
  /* 300px 是「一屏能看见十来行、又不把弹窗顶到屏幕外」的量；列多时横向滚动 */
  margin-top: var(--space-4);
  max-height: 300px;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-xs);
}

.preview-table th,
.preview-table td {
  padding: var(--space-2) var(--space-3);
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}

.preview-table th.is-wrap,
.preview-table td.is-wrap {
  white-space: normal;
  min-width: 120px;
}

.preview-table thead th {
  position: sticky;
  top: 0;
  /* 表头要压住正文里那些 sticky 的单元格（正文 col-status 是 z-index 1） */
  z-index: 2;
  background: var(--color-surface);
  font-weight: 600;
  color: var(--color-text-secondary);
}

.preview-table tbody tr:last-child td {
  border-bottom: none;
}

.preview-table tr.is-blocked {
  background: var(--color-danger-soft);
}

.col-no {
  width: 40px;
  color: var(--color-text-faint);
  font-variant-numeric: tabular-nums;
}

/*
 * 状态列要装「徽标 + 若干条说明」，必须能换行。
 *
 * **选择器要写到 `.preview-table th.col-status` 这一级**：上面那条
 * `.preview-table th, .preview-table td { white-space: nowrap }` 特异性是 (0,1,1)，
 * 只写 `.col-status`（0,1,0）根本压不过它——`white-space: normal` 从未生效过。
 * 后果不是「换行没生效」这么轻：一整条长错误文案被当成一行渲染、横向溢出单元格，
 * 而这层溢出**照样算进容器的可滚动区**。实测一张表宽正好等于容器（730 / 730）的表，
 * `scrollWidth` 是 980——凭空多出 250px 空白可滚区，滚过去是一片空。
 * 同样的副作用也让 `position: sticky` 冻结列方案出局，所以这里不用 sticky；
 * 「横滚时也想看见被拦原因」改由 `importUi.ts` 的 `blockedHint()` 解决（写进表上方提示条）。
 */
.preview-table th.col-status,
.preview-table td.col-status {
  white-space: normal;
  padding: 0;
  width: 240px;
  min-width: 240px;
}

.status-body {
  box-sizing: border-box;
  width: 240px;
  padding: var(--space-2) var(--space-3);
}

.status {
  display: inline-block;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  font-weight: 600;
}

.status.is-ok {
  background: var(--color-success-soft);
  color: var(--color-success-strong);
}

.status.is-info {
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.status.is-warn {
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
}

.status.is-bad {
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
}

.note {
  display: block;
  margin-top: 2px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.note.is-error {
  color: var(--color-danger-strong);
}
</style>
