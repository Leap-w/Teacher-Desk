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
    const st = fs.statSync(full)
    if (st.isDirectory()) walk(full, filter, out)
    else if (!filter || filter(full)) out.push(full)
  }
  return out
}

const files = walk(SRC, (f) => /\.(ts|vue)$/.test(f) && !f.endsWith('.d.ts'))
const text = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]))

/** 该文件是否为「纯 barrel」：去掉注释与 export-from 行后没有别的语句 */
const isBarrel = (f, t) => {
  const body = t
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/export\s+(type\s+)?\{[^}]*\}\s*from\s*['"][^'"]+['"]/g, '')
    .replace(/export\s+\*\s+from\s*['"][^'"]+['"]/g, '')
    .trim()
  return body === ''
}
const barrels = new Set(files.filter((f) => isBarrel(f, text.get(f))))

const exportRe =
  /export\s+(?:async\s+)?(?:function|const|class|let|interface|type)\s+([A-Za-z_$][\w$]*)/g
const names = new Map() // name -> Set(files)
for (const f of files) {
  for (const m of text.get(f).matchAll(exportRe)) {
    if (!names.has(m[1])) names.set(m[1], new Set())
    names.get(m[1]).add(f)
  }
}

console.log('=== 完全没人用（除自身与 barrel 外无任何引用）的导出 ===')
const dead = []
for (const [name, defs] of names) {
  let live = false
  for (const [f, t] of text) {
    if (defs.has(f)) continue
    if (barrels.has(f)) {
      // barrel 里出现但只是再导出 → 不算活；但如果 barrel 用别名再导出也给不算
      continue
    }
    if (new RegExp(`\\b${name}\\b`).test(t)) {
      live = true
      break
    }
  }
  if (!live) {
    // 再看自身文件里除声明外有没有用到（内部用 → 只是多写了 export）
    const own = [...defs][0]
    const t = text.get(own)
    const uses = (t.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length
    dead.push({ name, file: path.relative(ROOT, own), internalOnly: uses > 1 })
  }
}
dead
  .sort((a, b) => a.file.localeCompare(b.file))
  .forEach((d) =>
    console.log(`  ${d.internalOnly ? '·内部用' : '✗彻底死 '} ${d.file} :: ${d.name}`),
  )

console.log('\n=== 纯 barrel 文件（只有 export-from）===')
;[...barrels].forEach((f) => console.log('  ' + path.relative(ROOT, f)))

console.log('\n=== barrel 里再导出的名字，若无外部使用者则同属死码 ===')
for (const f of barrels) {
  const t = text.get(f)
  const re = /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
  const reExported = []
  for (const m of t.matchAll(re)) {
    for (const part of m[1].split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        .trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) reExported.push(name)
    }
  }
  for (const name of reExported) {
    let live = false
    for (const [g, gt] of text) {
      if (g === f || barrels.has(g)) continue
      if (new RegExp(`\\b${name}\\b`).test(gt)) {
        live = true
        break
      }
    }
    if (!live) console.log(`  ✗ ${path.relative(ROOT, f)} 再导出但无人用：${name}`)
  }
}
