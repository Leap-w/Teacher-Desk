/// <reference types="vite/client" />

declare module 'virtual:uno.css'

/**
 * 构建期变量（Phase 9B）：只在需要临时换云环境时用，
 * 例如 `VITE_CLOUD_ENV_ID=xxx npm run dev`。不填则用 `src/config/index.ts` 里的默认环境。
 */
interface ImportMetaEnv {
  readonly VITE_CLOUD_ENV_ID?: string
  /** 应用版本（vite.config.ts define 注入，来自 package.json version） */
  readonly APP_VERSION: string
}
