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

function walk(dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    if (n === 'node_modules' || n === '.git') continue
    const f = path.join(dir, n)
    if (fs.statSync(f).isDirectory()) walk(f, out)
    else if (/\.(ts|vue)$/.test(f) && !f.endsWith('.d.ts')) out.push(f)
  }
  return out
}
const files = walk(SRC)
const rel = (f) => path.relative(ROOT, f)
const read = (f) => fs.readFileSync(f, 'utf8')

console.log('=== ① 定时器 / 事件监听是否成对清理 ===')
for (const f of files) {
  const t = read(f)
  const setInt = (t.match(/setInterval\(/g) || []).length
  const setTmo = (t.match(/setTimeout\(/g) || []).length
  const clrInt = (t.match(/clearInterval\(/g) || []).length
  const clrTmo = (t.match(/clearTimeout\(/g) || []).length
  const addEv = (t.match(/addEventListener\(/g) || []).length
  const rmEv = (t.match(/removeEventListener\(/g) || []).length
  const onUnmount = t.includes('onBeforeUnmount')
  const issues = []
  if (setInt > 0 && clrInt === 0) issues.push(`setInterval×${setInt} 无 clearInterval`)
  if (setTmo > clrTmo) issues.push(`setTimeout×${setTmo} > clearTimeout×${clrTmo}`)
  if (addEv > 0 && rmEv < addEv) issues.push(`addEventListener×${addEv} > remove×${rmEv}`)
  if ((setInt > 0 || addEv > 0) && !onUnmount) issues.push('无 onBeforeUnmount')
  if (issues.length && !f.includes('__tests__')) console.log(`  ${rel(f)}  → ${issues.join('；')}`)
}

console.log('\n=== ② 架构纪律：谁在直连底层 ===')
for (const f of files) {
  if (f.includes('__tests__')) continue
  const r = rel(f)
  const t = read(f)
  const hits = []
  if (t.includes("from '@/services/storage'") && /^src\/(stores|views|components)\//.test(r))
    hits.push('import services/storage')
  if (t.includes("from '@/services/sync'") && /^src\/(views|components)\//.test(r))
    hits.push('import services/sync')
  if (t.includes("from '@/services/cloudbase'") && /^src\/(views|components)\//.test(r))
    hits.push('import services/cloudbase')
  if (t.includes("from '@/sync/autoSync'") && /^src\/(views|components)\//.test(r))
    hits.push('import sync/autoSync（会拖云 SDK 进页面）')
  if (
    /\blocalStorage\.(getItem|setItem|removeItem|clear)\(/.test(t) &&
    !/^src\/(services|repositories)\//.test(r)
  )
    hits.push('直接操作 localStorage')
  if (hits.length) console.log(`  ${r}  → ${hits.join('；')}`)
}

console.log('\n=== ③ JSON.parse 未包 try（可能整页崩）===')
for (const f of files) {
  if (f.includes('__tests__')) continue
  const lines = read(f).split('\n')
  lines.forEach((l, i) => {
    if (/JSON\.parse\(/.test(l) && !/try|catch|safeParse|catch\s*\{/.test(l)) {
      const around = lines.slice(Math.max(0, i - 6), i + 1).join('\n')
      if (!/try\s*\{/.test(around) && !/function safe/.test(around))
        console.log(`  ${rel(f)}:${i + 1}  ${l.trim().slice(0, 100)}`)
    }
  })
}

console.log('\n=== ④ v-for 缺 key ===')
for (const f of files.filter((x) => x.endsWith('.vue'))) {
  const t = read(f)
  const tags = t.match(/<[a-zA-Z][^>]*v-for[^>]*>/g) || []
  tags.forEach((tag) => {
    if (!/:key=|v-bind:key=/.test(tag))
      console.log(`  ${rel(f)}  ${tag.replace(/\s+/g, ' ').slice(0, 110)}`)
  })
}

console.log('\n=== ⑤ <img> 缺 alt ===')
for (const f of files.filter((x) => x.endsWith('.vue'))) {
  const tags = read(f).match(/<img[^>]*>/g) || []
  tags.forEach((tag) => {
    if (!/alt=/.test(tag)) console.log(`  ${rel(f)}  ${tag.slice(0, 100)}`)
  })
}

console.log('\n=== ⑥ 可疑非空断言（!）出现次数（>3 的文件）===')
for (const f of files) {
  if (f.includes('__tests__')) continue
  const t = read(f)
  const n = (t.match(/[A-Za-z0-9_\)\]]!(\.|\[|\)|,|;)/g) || []).length
  if (n > 3) console.log(`  ${rel(f)}  ${n} 处`)
}

console.log('\n=== ⑦ 完全相同的函数体（跨文件重复实现嫌疑）===')
const bodies = new Map()
for (const f of files) {
  if (f.includes('__tests__')) continue
  const t = read(f)
  for (const m of t.matchAll(
    /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)[^{]*\{([\s\S]{40,400}?)\n\}/g,
  )) {
    const norm = m[2].replace(/\s+/g, ' ').trim()
    const list = bodies.get(norm) || []
    list.push(`${rel(f)}::${m[1]}`)
    bodies.set(norm, list)
  }
}
let dup = 0
for (const [, list] of bodies) {
  const names = new Set(list.map((x) => x.split('::')[1]))
  if (list.length > 1 && names.size === 1) {
    console.log('  ' + list.join('  ==  '))
    dup += 1
  }
}
if (dup === 0) console.log('（无同名同体函数）')
