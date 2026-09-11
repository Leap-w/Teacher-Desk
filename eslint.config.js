import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

export default defineConfigWithVueTs(
  {
    name: 'teacherdesk/ignores',
    // `.tmp-*` 是交付前自检的临时脚本与产物（§11.4 要求交付前删除）：
    // 它们跑在 Node 里，本来就会踩到「no-undef」这类浏览器侧规则，与源码无关
    ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'docs/**', '.tmp-*'],
  },
  js.configs.recommended,
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  skipFormatting,
  {
    name: 'teacherdesk/rules',
    files: ['**/*.{js,mjs,cjs,ts,mts,vue}'],
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
)
