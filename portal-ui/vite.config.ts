import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * 班级门户展示页（并入 TeacherDesk 的 UI 源码）的独立构建配置。
 *
 * 刻意不复用仓库根的 vite.config.ts：那边挂着 UnoCSS 与 PWA，而这份 UI 自带设计令牌，
 * 导出的单文件 HTML 也必须零外链。这里的产物只供 scripts/build-portal-assets.cjs
 * 内联成 portalAssets.ts，不参与主应用构建、不部署。
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue()],
  build: {
    outDir: '.build',
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
        entryFileNames: 'portal.js',
        assetFileNames: 'portal.[ext]',
      },
    },
  },
})
