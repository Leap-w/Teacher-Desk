/*
 * TeacherDesk 体检脚本（V3.0.0 起入库；判定标准见 docs/release-checklist.md §11）。
 *
 * 用法：在仓库根目录执行  node scripts/audit/<文件名>.cjs
 * 输出：一份清单；**清单为空 = 这一项干净**。
 *
 * 为什么入库而不是留成一次性脚本：这些检查是「发布前必须过一遍」的固定动作，
 * 每次重写一遍必然分叉（§11.1 的老规矩）——CLAUDE.md 里那条「不写临时脚本」同理。
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = require('node:path').resolve(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src')

function walk(dir, filter, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) walk(full, filter, out)
    else if (!filter || filter(full)) out.push(full)
  }
  return out
}

const srcFiles = walk(SRC, (f) => /\.(ts|vue)$/.test(f) && !f.endsWith('.d.ts'))
const allText = new Map()
for (const f of srcFiles) allText.set(f, fs.readFileSync(f, 'utf8'))
// 测试文件与配置文件也要算「引用方」
const testFiles = walk(path.join(SRC, '__tests__'), (f) => /\.(ts|vue)$/.test(f))
for (const f of testFiles) allText.set(f, fs.readFileSync(f, 'utf8'))
for (const extra of ['vite.config.ts', 'uno.config.ts', 'package.json']) {
  const full = path.join(ROOT, extra)
  if (fs.existsSync(full)) allText.set(full, fs.readFileSync(full, 'utf8'))
}

/* ---------- ① 未被引用的源文件 ---------- */
const entryHints = new Set(['main.ts', 'App.vue', 'vite-env.d.ts'])
const importedFiles = new Set()
for (const [file, text] of allText) {
  for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    let spec = m[1]
    if (!spec.startsWith('.') && !spec.startsWith('@/')) continue
    let base
    if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2))
    else base = path.resolve(path.dirname(file), spec)
    for (const cand of [base, base + '.ts', base + '.vue', path.join(base, 'index.ts')]) {
      if (fs.existsSync(cand)) importedFiles.add(cand)
    }
  }
  // 动态 import
  for (const m of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    let spec = m[1]
    if (!spec.startsWith('.') && !spec.startsWith('@/')) continue
    let base = spec.startsWith('@/')
      ? path.join(SRC, spec.slice(2))
      : path.resolve(path.dirname(file), spec)
    for (const cand of [base, base + '.ts', base + '.vue', path.join(base, 'index.ts')]) {
      if (fs.existsSync(cand)) importedFiles.add(cand)
    }
  }
}
const orphanFiles = srcFiles.filter(
  (f) => !importedFiles.has(f) && !entryHints.has(path.basename(f)) && !f.includes('/__tests__/'),
)
console.log('=== ① 疑似未被引用的源文件 ===')
if (orphanFiles.length === 0) console.log('（无）')
orphanFiles.forEach((f) => console.log('  ' + path.relative(ROOT, f)))

/* 组件是否被模板当标签用（<StudentCard /> 不必 import 路径匹配，这里再兜一层） */
const vueTags = new Set()
for (const [, text] of allText) {
  for (const m of text.matchAll(/<([A-Z][A-Za-z0-9]+)[\s/>]/g)) vueTags.add(m[1])
}
console.log('  —— 其中可能是模板标签的（排除）：')
orphanFiles.forEach((f) => {
  const name = path.basename(f, '.vue').replace(/\.\w+$/, '')
  if (vueTags.has(name)) console.log('    （模板里出现过）' + path.relative(ROOT, f))
})

/* ---------- ② 未被引用的导出 ---------- */
console.log('\n=== ② 疑似未被引用的导出（src 内 + 测试内都没用到）===')
const exportRe =
  /export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z_$][\w$]*)|export\s*\{\s*([^}]+)\}/g
const unusedExports = []
for (const f of srcFiles) {
  const text = allText.get(f)
  const names = new Set()
  for (const m of text.matchAll(exportRe)) {
    if (m[1]) names.add(m[1])
    if (m[2]) {
      for (const part of m[2].split(',')) {
        const name = part
          .trim()
          .split(/\s+as\s+/)
          .pop()
          .trim()
        if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
      }
    }
  }
  for (const name of names) {
    let used = false
    for (const [file, other] of allText) {
      if (file === f) continue
      if (new RegExp(`\\b${name}\\b`).test(other)) {
        used = true
        break
      }
    }
    if (!used) unusedExports.push(`${path.relative(ROOT, f)} :: ${name}`)
  }
}
if (unusedExports.length === 0) console.log('（无）')
unusedExports.forEach((line) => console.log('  ' + line))

/* ---------- ③ 未使用的依赖 ---------- */
console.log('\n=== ③ 依赖使用情况（package.json 声明但源码里找不到）===')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
const repoSources = walk(ROOT, (f) => /\.(ts|vue|js|cjs|mjs|json|md|yml|yaml)$/.test(f)).filter(
  (f) => !f.includes('/node_modules/') && !f.includes('/dist/') && !f.includes('/docs/昌都记忆/'),
)
for (const dep of Object.keys(deps)) {
  const bare = dep.replace(/^@[^/]+\//, '').split('/')[0]
  const hit = repoSources.some((f) => {
    const text = fs.readFileSync(f, 'utf8')
    return text.includes(`'${dep}'`) || text.includes(`"${dep}"`)
  })
  if (!hit) console.log(`  ${dep}  ${deps[dep]}`)
}

/* ---------- ④⑤⑥ 代码卫生 ---------- */
function scan(label, pattern) {
  console.log(`\n=== ${label} ===`)
  let count = 0
  for (const f of srcFiles) {
    const lines = allText.get(f).split('\n')
    lines.forEach((line, i) => {
      if (pattern.test(line)) {
        count += 1
        if (count <= 30)
          console.log(`  ${path.relative(ROOT, f)}:${i + 1}  ${line.trim().slice(0, 120)}`)
      }
    })
  }
  if (count === 0) console.log('（无）')
  else if (count > 30) console.log(`  …… 共 ${count} 处`)
}
scan('④ TODO / FIXME / HACK / XXX', /\b(TODO|FIXME|HACK|XXX)\b/)
scan('⑤ console.* 残留', /console\.(log|debug|info)\(/)
scan('⑥ ts-ignore / eslint-disable / any 断言', /@ts-ignore|@ts-expect-error|as any\b/)

/* ---------- ⑦ 临时 / 可疑文件 ---------- */
console.log('\n=== ⑦ 临时文件 / 可疑目录（git 已跟踪）===')
const tracked = require('node:child_process')
  .execSync('git -C "' + ROOT + '" ls-files', { encoding: 'utf8' })
  .trim()
  .split('\n')
const suspicious = tracked.filter((f) =>
  /\.tmp-|\.bak$|\.orig$|~$|\.DS_Store|node_modules\/|^dist\/|\.log$/.test(f),
)
if (suspicious.length === 0) console.log('（无）')
suspicious.slice(0, 20).forEach((f) => console.log('  ' + f))
if (suspicious.length > 20) console.log(`  …… 共 ${suspicious.length}`)

console.log('\n=== ⑦b 体积最大的已跟踪文件（前 15）===')
const sizes = tracked
  .filter((f) => fs.existsSync(path.join(ROOT, f)))
  .map((f) => ({ f, size: fs.statSync(path.join(ROOT, f)).size }))
  .sort((a, b) => b.size - a.size)
  .slice(0, 15)
sizes.forEach((s) => console.log(`  ${(s.size / 1024).toFixed(1).padStart(9)} KB  ${s.f}`))

/* ---------- ⑧ theme.css 未使用的 CSS 变量 ---------- */
console.log('\n=== ⑧ theme.css 中未被任何源文件使用的 CSS 变量 ===')
const theme = fs.readFileSync(path.join(ROOT, 'src/styles/theme.css'), 'utf8')
const defined = [...theme.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1])
const allSrcText = [...allText.values()].join('\n')
const publicCss = walk(path.join(SRC, 'styles'), (f) => f.endsWith('.css'))
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n')
const unusedVars = defined.filter((v) => {
  if (v.endsWith('-rgb') || v.endsWith('-hsl')) return false
  const users = (allSrcText + publicCss).split(v).length - 1
  return users <= 1 // 只在自己定义处出现
})
if (unusedVars.length === 0) console.log('（无）')
unusedVars.forEach((v) => console.log('  ' + v))

/* ---------- ⑨ public 资源引用 ---------- */
console.log('\n=== ⑨ public/ 中未被引用的资源 ===')
const publicDir = path.join(ROOT, 'public')
if (fs.existsSync(publicDir)) {
  for (const f of walk(publicDir)) {
    const rel = '/' + path.relative(publicDir, f)
    const name = path.basename(f)
    const referenced =
      allSrcText.includes(rel) ||
      allSrcText.includes(name) ||
      fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8').includes(name) ||
      fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').includes(rel)
    if (!referenced) console.log('  ' + rel)
  }
}
