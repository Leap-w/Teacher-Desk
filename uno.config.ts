import { defineConfig, presetWind3 } from 'unocss'

export default defineConfig({
  presets: [presetWind3()],
  theme: {
    colors: {
      primary: 'var(--color-primary)',
      secondary: 'var(--color-secondary)',
      surface: 'var(--color-surface)',
      canvas: 'var(--bg-main)',
      ink: {
        DEFAULT: 'var(--color-text)',
        secondary: 'var(--color-text-secondary)',
      },
    },
  },
})
