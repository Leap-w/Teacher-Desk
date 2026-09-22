<script setup lang="ts">
/**
 * FundExportSheet — 导出账页的纸面（v3.6.0）。
 *
 * 一张 297×210mm 的横向 A4 纸，按 96dpi 折算成 1122×794 CSS 像素——
 * `utils/seatExport.ts` 的 `embedPdfImage` 会按比例缩放进 A4 横向页并居中，
 * 页面尺寸与纸张比例一致时，缩放系数对宽高是同一个数，版面不会被拉变形。
 *
 * 挂 `.theme-force-light`：这是**发给别人的纸**，深色模式下也必须按浅色渲染
 * （令牌还原见 styles/theme.css 第 17 节）。
 *
 * 本组件只管纸面（标题 / 副标题 / 页脚 / 留白），内容由调用方放进默认插槽。
 */
defineProps<{
  title: string
  subtitle: string
  /** 页脚左侧的一行说明 */
  footnote: string
  /** 页脚右侧页码，如 `第 1 页 / 共 2 页` */
  pageLabel: string
}>()
</script>

<template>
  <div class="ex-sheet theme-force-light">
    <header class="ex-head">
      <div class="ex-head-text">
        <h1 class="ex-title">{{ title }}</h1>
        <p class="ex-subtitle">{{ subtitle }}</p>
      </div>
    </header>

    <div class="ex-body">
      <slot />
    </div>

    <footer class="ex-foot">
      <span>{{ footnote }}</span>
      <span>{{ pageLabel }}</span>
    </footer>
  </div>
</template>

<style scoped>
.ex-sheet {
  /* A4 横向 @96dpi（297mm × 210mm） */
  width: 1122px;
  height: 794px;
  padding: 34px 40px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: var(--color-bg-white);
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.ex-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.ex-title {
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
}

.ex-subtitle {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.ex-body {
  flex: 1;
  min-height: 0;
}

.ex-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  border-top: 1px solid var(--color-border-divider);
  font-size: 11px;
  color: var(--color-text-tertiary);
}
</style>
