import { defineConfig, presetWind3 } from 'unocss'

/**
 * UnoCSS Theme ↔ CSS Variables 一一对应（Phase UI-1）：
 * 颜色 / 圆角 / 阴影全部引用 theme.css 令牌，禁止在 Uno 层再养一套数值。
 */
export default defineConfig({
  presets: [presetWind3()],
  theme: {
    colors: {
      primary: 'var(--color-primary)',
      'primary-hover': 'var(--color-primary-hover)',
      'primary-active': 'var(--color-primary-active)',
      secondary: 'var(--color-secondary)',
      accent: 'var(--color-accent)',
      sky: 'var(--color-sky)',
      gold: 'var(--color-gold)',
      surface: 'var(--color-surface)',
      canvas: 'var(--bg-main)',
      page: 'var(--bg-page)',
      success: 'var(--color-success)',
      warning: 'var(--color-warning)',
      danger: 'var(--color-danger)',
      info: 'var(--color-info)',
      ink: {
        DEFAULT: 'var(--color-text)',
        secondary: 'var(--color-text-secondary)',
        tertiary: 'var(--color-text-tertiary)',
        disabled: 'var(--color-text-disabled)',
      },
    },
    // rounded-* 与 --radius-* 刻度一致（xs=8 / sm=12 / md=16 / lg=20 / xl=24）
    borderRadius: {
      DEFAULT: 'var(--radius-sm)',
      xs: 'var(--radius-xs)',
      sm: 'var(--radius-sm)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
      xl: 'var(--radius-xl)',
      '2xl': 'var(--radius-2xl)',
      full: 'var(--radius-full)',
    },
    boxShadow: {
      DEFAULT: 'var(--shadow-sm)',
      xs: 'var(--shadow-xs)',
      sm: 'var(--shadow-sm)',
      md: 'var(--shadow-md)',
      lg: 'var(--shadow-lg)',
      xl: 'var(--shadow-xl)',
      card: 'var(--shadow-card)',
      hover: 'var(--shadow-hover)',
    },
  },
})
