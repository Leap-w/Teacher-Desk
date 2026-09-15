/**
 * 登录入口守约（v3.0.4-rc 新增）。
 *
 * 背景：v3.0.4-rc 交付后需求方反馈「点头像 / 点立即登录 / 点数据同步里的登录，
 * 都没有任何反应」。查下来是 `LoginModal.vue` 里 `<form class="login-form">` **没有 `id`**，
 * 而底部按钮写的是 `<AppButton type="submit" form="login-form">`——`form` 属性按 **id** 查表单，
 * 查不到就等于这个按钮**不属于任何表单**，`type="submit"` 无处可提交：
 * 在输入框里**回车能登录**，**用鼠标点按钮毫无反应**，控制台也不报错。
 * 三个入口唤起的是同一个弹窗（`useLoginModal` 全局一份），所以三处表现完全一致。
 *
 * 这里守两件事，都是**源码级**的（与 `releaseCandidate.test.ts` 的 RC-03 同一手法）：
 *
 * 1. **表单关联**：`src/` 下的 .vue 里凡是出现 `form="X"` 的，同一个文件里必须有 `id="X"`。
 *    这类漏写在运行时是静默的——没有异常、没有日志，只有「点了没反应」，只能靠测试挡。
 * 2. **入口收敛**：三个登录入口必须都走 `useLoginModal()`，不许各自 `ref` 一份开关
 *    （两份开关会让「从这里点开、在别处关掉」失灵，同 `useCloudSync` 的 busy 那条纪律）。
 *
 * **扫描前先剥注释**：本仓库的注释密度很高，注释里举例写 `form="x"`、`type="email"`
 * 是常事，不剥的话守卫会把「说明文字」当成「真的代码」——第一次跑就是这么红的。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 剥掉 HTML 注释与 JS 块注释 / 整行行注释，只留会被浏览器执行的代码。
 * `//` 只认整行注释：行内 `//` 在 URL（`https://`）里很常见，一起剥会把属性值啃掉。
 */
function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 递归收集 `src/` 下的全部 .vue 文件（相对仓库根，与 vitest 的 cwd 一致） */
function collectVueFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) collectVueFiles(path, found)
    else if (entry.endsWith('.vue')) found.push(path)
  }
  return found
}

const VUE_FILES = collectVueFiles('src')

/** 读一份 .vue 的可执行部分（注释已剥） */
function codeOf(file: string): string {
  return stripComments(readFileSync(file, 'utf8'))
}

describe('表单关联：form="X" 必须能查到 id="X"', () => {
  it('src/ 下每个 form="X" 都有对应的 id="X"', () => {
    const offenders: string[] = []

    for (const file of VUE_FILES) {
      const source = codeOf(file)
      for (const match of source.matchAll(/\bform="([^"]+)"/g)) {
        const id = match[1]!
        // 同文件里必须有 id="<同一个值>"；查不到就是静默失效的那一类
        if (!source.includes(`id="${id}"`)) offenders.push(`${file} → form="${id}"`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('登录弹窗的表单确实带着 id（这条断言直接守住本次故障）', () => {
    const source = codeOf('src/components/layout/LoginModal.vue')
    expect(source).toContain('form="login-form"')
    expect(source).toContain('id="login-form"')
  })

  it('登录输入框不是 type="email"（会被浏览器原生校验挡在提交之前）', () => {
    const source = codeOf('src/components/layout/LoginModal.vue')
    expect(source).toContain('type="text"')
    expect(source).toContain('autocomplete="username"')
    expect(source).not.toContain('type="email"')
  })
})

describe('入口收敛：三个登录入口唤起同一个弹窗', () => {
  /** 三个入口：顶部头像 / 「我的」页未登录卡 / 数据与同步页 */
  const ENTRIES = [
    { label: '顶部头像', file: 'src/components/layout/AppHeader.vue' },
    { label: '「我的」未登录卡', file: 'src/views/My/index.vue' },
    { label: '数据与同步页', file: 'src/views/Toolbox/index.vue' },
  ]

  for (const entry of ENTRIES) {
    it(`${entry.label}走 useLoginModal（不自己造一份开关）`, () => {
      const source = codeOf(entry.file)
      expect(source).toContain('useLoginModal')
      expect(source).toContain('loginModal.show()')
    })
  }

  it('弹窗开关是模块级单例（两处各 ref 一份就会出现「点了不开」）', () => {
    const source = codeOf('src/composables/useLoginModal.ts')
    // ref 声明在 useLoginModal() 函数**之外**：函数内声明会每次调用各造一份
    const outside = source.slice(0, source.indexOf('export function useLoginModal'))
    expect(outside).toContain('ref(false)')
  })

  it('登录弹窗只挂在壳层一份（叠两份会出现「关不掉的第二个弹窗」）', () => {
    const app = codeOf('src/App.vue')
    expect(app).toContain('<LoginModal')

    const mountedElsewhere = VUE_FILES.filter(
      (file) =>
        file !== 'src/App.vue' &&
        file !== 'src/components/layout/LoginModal.vue' &&
        codeOf(file).includes('<LoginModal'),
    )
    expect(mountedElsewhere).toEqual([])
  })
})
