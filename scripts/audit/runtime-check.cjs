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

const ROUTES = [
  { path: '/', name: 'home' },
  { path: '/students', name: 'students' },
  { path: '/class/seats', name: 'seats' },
  { path: '/class/leave', name: 'leave' },
  { path: '/class/duty', name: 'duty' },
  { path: '/class/weekend', name: 'weekend' },
  { path: '/work/schedule', name: 'schedule' },
  { path: '/work/works', name: 'works' },
  { path: '/my', name: 'my' },
  { path: '/my/tools', name: 'tools' },
  { path: '/my/classroom', name: 'classroom' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const problems = []
  const list = await fetch('http://127.0.0.1:9333/json/list').then((r) => r.json())
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))

  let id = 0
  const call = (method, params) =>
    new Promise((resolve) => {
      const myId = ++id
      const handler = (event) => {
        const data = JSON.parse(event.data)
        if (data.id !== myId) return
        ws.removeEventListener('message', handler)
        resolve(data.result)
      }
      ws.addEventListener('message', handler)
      ws.send(JSON.stringify({ id: myId, method, params: params || {} }))
    })

  const consoleMsgs = []
  const exceptions = []
  const failed = []
  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data)
    if (data.method === 'Runtime.consoleAPICalled') {
      const type = data.params.type
      if (type === 'error' || type === 'warning') {
        consoleMsgs.push(
          `${type}: ` +
            data.params.args
              .map((a) => a.value ?? a.description ?? a.type)
              .join(' ')
              .slice(0, 220),
        )
      }
    }
    if (data.method === 'Runtime.exceptionThrown') {
      exceptions.push(
        (
          data.params.exceptionDetails.exception?.description ||
          data.params.exceptionDetails.text ||
          ''
        ).slice(0, 300),
      )
    }
    if (data.method === 'Network.loadingFailed') {
      failed.push(`${data.params.type} ${data.params.errorText}`)
    }
    if (data.method === 'Network.responseReceived' && data.params.response.status >= 400) {
      failed.push(`HTTP ${data.params.response.status} ${data.params.response.url.slice(-70)}`)
    }
  })

  await call('Runtime.enable')
  await call('Network.enable')
  await call('Log.enable')
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })

  for (const route of ROUTES) {
    consoleMsgs.length = 0
    exceptions.length = 0
    failed.length = 0
    await call('Page.navigate', { url: 'http://localhost:5199' + route.path })
    await sleep(1500)
    const marks = []
    if (exceptions.length) marks.push(`异常×${exceptions.length}`)
    if (consoleMsgs.length) marks.push(`console×${consoleMsgs.length}`)
    if (failed.length) marks.push(`请求失败×${failed.length}`)
    console.log(`${marks.length ? '✗' : '✓'} ${route.name.padEnd(10)} ${marks.join(' ')}`)
    if (exceptions.length) exceptions.forEach((e) => problems.push(`${route.name} 异常：${e}`))
    if (consoleMsgs.length)
      consoleMsgs.slice(0, 4).forEach((m) => problems.push(`${route.name} ${m}`))
    if (failed.length) failed.slice(0, 4).forEach((f) => problems.push(`${route.name} ${f}`))
  }

  /* 基础可访问性抽查（首页 + 座位 + 课堂，覆盖弹窗与表单之外的主要交互） */
  console.log('\n=== 可访问性抽查 ===')
  for (const route of ['/', '/class/seats', '/work/works', '/my/classroom']) {
    await call('Page.navigate', { url: 'http://localhost:5199' + route })
    await sleep(1500)
    const r = await call('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const out = { namelessButtons: [], namelessInputs: [], dupIds: [], tinyTargets: 0 };
        for (const b of document.querySelectorAll('button, [role=button]')) {
          const text = (b.textContent || '').trim();
          const label = b.getAttribute('aria-label') || b.getAttribute('title') || '';
          if (!text && !label && !b.querySelector('[aria-label]')) out.namelessButtons.push(b.className || b.outerHTML.slice(0, 60));
        }
        for (const el of document.querySelectorAll('input, select, textarea')) {
          const id = el.id;
          const hasLabel = id && document.querySelector('label[for="' + id + '"]');
          const aria = el.getAttribute('aria-label') || el.getAttribute('placeholder');
          if (!hasLabel && !aria) out.namelessInputs.push(el.outerHTML.slice(0, 70));
        }
        const seen = new Set();
        for (const el of document.querySelectorAll('[id]')) {
          if (seen.has(el.id)) out.dupIds.push(el.id);
          seen.add(el.id);
        }
        return JSON.stringify(out);
      })()`,
    })
    const a11y = JSON.parse(r.result.value)
    const ok =
      a11y.namelessButtons.length === 0 &&
      a11y.namelessInputs.length === 0 &&
      a11y.dupIds.length === 0
    console.log(
      `${ok ? '✓' : '✗'} ${route}  无名按钮 ${a11y.namelessButtons.length} / 无标签输入 ${a11y.namelessInputs.length} / 重复 id ${a11y.dupIds.length}`,
    )
    if (!ok) problems.push(`${route} 可访问性：${JSON.stringify(a11y).slice(0, 220)}`)
  }

  ws.close()
  console.log('\n=== 问题清单 ===')
  if (problems.length === 0) console.log('（无）')
  else problems.forEach((p) => console.log('- ' + p))
  process.exit(problems.length === 0 ? 0 : 1)
})().catch((error) => {
  console.error('脚本异常:', error)
  process.exit(2)
})
void fs
