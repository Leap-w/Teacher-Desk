import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  // 页脚/关于页显示的应用版本：随 package.json 单一来源走，不再手工同步
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify(`v${pkg.version}`),
  },
  plugins: [
    vue(),
    UnoCSS(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'TeacherDesk · 班主任工作台',
        short_name: 'TeacherDesk',
        description: '面向高中班主任的综合工作台：学生档案、座位、课程表、请假、值日与周末管理。',
        lang: 'zh-CN',
        start_url: '/',
        display: 'standalone',
        theme_color: '#2F8F83',
        background_color: '#F8FAFB', /* 与 --bg-page 一致（Polish-1 对齐） */
        // 官方图标（docs/图标.png）等比导出，见 public/icons/；maskable 版带 80% 安全区留白
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-256.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // png 必须显式列出：图标进不了 precache 的话，离线启动会掉图标
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
})
