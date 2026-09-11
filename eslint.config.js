import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

export default defineConfigWithVueTs(
  {
    name: 'teacherdesk/ignores',
    // `.tmp-*` 是交付前自检的临时脚本与产物（§11.4 要求交付前删除）：
    // 它们跑在 Node 里，本来就会踩到「no-undef」这类浏览器侧规则，与源码无关
    // `.claude/**` 是工作树（agent 用的仓库副本），里面有一整份 src 与 dist：
    // 不排除的话 `npm run lint` 会把副本里的每个文件都报一遍，真源码的问题淹没在里面
    ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'docs/**', '.tmp-*', '.claude/**'],
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
