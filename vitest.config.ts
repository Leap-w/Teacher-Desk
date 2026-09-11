import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * 常驻自检配置（Phase 9C）。
 *
 * **刻意与 `vite.config.ts` 分开**：那边挂着 UnoCSS 与 PWA 两件套，而自检跑的是
 * 纯函数 / 数据层 / 同步核心，用不上它们，加载进来只是让每次 `npm run test` 多等几秒。
 * 两边需要一致的东西只有一样——`@` 别名（`src` 目录），所以只有它在这里重复了一遍。
 *
 * 环境用默认的 `node`，**不装 jsdom**：受测的是同步判定、写盘幂等、数据 normalize 与
 * 同步队列，全是纯逻辑。碰到的浏览器 API（`localStorage` / `BroadcastChannel` /
 * `navigator.onLine`）在 `src/__tests__/helpers/env.ts` 里换成内存替身——比拖进一整个
 * DOM 实现更快，而且能精确控制「断网」「另一个标签页发来消息」这些真实浏览器里
 * 造不出来的处境。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // 只跑 `src/` 下的自检文件：`dist/`、工作树副本都不在范围内（与 eslint 的 ignores 同一口径）
    include: ['src/**/*.test.ts'],
  },
})
