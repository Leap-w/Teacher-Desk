/**
 * v3.4.0 §六：座位页「一屏装下 + 两种全屏」的**接缝**断言。
 *
 * 这一版的风险不在「某个函数算错了」（那是 `seatStage.test.ts` 里纯函数的活），
 * 而在三处**结构挪一下就静默失效**的地方：
 *
 * 1. `transform` 会给 `position: fixed` 的后代重认包含块——拖拽幽灵一旦变成
 *    `.room-stage` 的后代，就会被再叠一次左上角偏移。落点判定走 `elementFromPoint`
 *    （视口坐标，本来就正确），于是表现成「幽灵不跟手、位置却拖得对」，极难反查；
 * 2. 座位格尺寸与 `.col-no` 的 `max-width` 是**承重耦合**，两边不等时列号与座位
 *    逐列错开（差一格就是「3 号下面坐着 4 号」）——这条在全仓此前**零断言保护**；
 * 3. 长按信息卡的主人要经「座位 id → 座位 → 学生」两步才找得到。少一步（v3.4.0
 *    修掉的 P0，自 `cf5ef49` 起一直是坏的）会让查看详情 / 开始换座 / 座位约束
 *    三个入口**全部静默失效**，且纯逻辑测试与字符串顺序断言都碰不到。
 *
 * 这些都不是逻辑而是**接线**，所以照 `v331Linkage.test.ts` 的惯用法做源码级断言。
 * 唯一升级的是父子关系：改用 `vue/compiler-sfc` 的 `parse()` 读真 AST 的祖先链——
 * 源码里幽灵就排在座位图**后面**，光看字符串顺序根本分不出「兄弟」与「后代」。
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'

/* ==================== 被断言的文件 ==================== */

const CLASSROOM = 'src/views/Seats/components/SeatClassroom.vue'
const TOOLBAR = 'src/views/Seats/components/SeatToolbar.vue'
const SEAT_CARD = 'src/views/Seats/components/SeatCard.vue'
const QUICK_CARD = 'src/views/Seats/components/SeatQuickCard.vue'
const ZOOM_BAR = 'src/views/Seats/components/SeatZoomBar.vue'
const STAGE = 'src/composables/useSeatStage.ts'
const PAGE = 'src/views/Seats/index.vue'
const THEME = 'src/styles/theme.css'

const read = (path: string) => readFileSync(path, 'utf8')

/**
 * 读样式表并**剥掉注释**。
 *
 * 必须剥：本仓的注释里写满了「原先 `position: sticky`」「不许出现 transform」
 * 这类**反例描述**——不剥的话，断言会被自己的注释骗成假通过（而且改代码删了声明、
 * 留下注释时依然绿）。
 */
const css = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * 从 `marker` 之后的第一个 `{` 起，返回与之配对的那个 `}` 里的内容。
 *
 * 不能图省事找「行首的 `}`」：`run()` 这类函数体里有嵌套块，会被提前截断；
 * 也不能只数大括号：字符串与注释里的花括号会骗过计数。
 */
function bracedAfter(text: string, marker: string): string {
  const at = text.indexOf(marker)
  expect(at, `源码里找不到 ${marker}`).toBeGreaterThan(-1)
  const open = text.indexOf('{', at)
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === '/' && next === '/') {
      const lineEnd = text.indexOf('\n', i)
      if (lineEnd === -1) break
      i = lineEnd
      continue
    }
    if (ch === '/' && next === '*') {
      const commentEnd = text.indexOf('*/', i + 2)
      if (commentEnd === -1) break
      i = commentEnd + 1
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      // 够用即可：本仓没有「反引号里再套同类引号」的模板串
      const quoteEnd = text.indexOf(ch, i + 1)
      if (quoteEnd === -1) break
      i = quoteEnd
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  throw new Error(`${marker} 的 {} 没配对上`)
}

/** 取一条 CSS 规则的声明块（选择器写全，含 `{`） */
const ruleBody = (source: string, selector: string) => bracedAfter(source, `${selector} {`)

/** 取一个顶层函数的函数体（`function xxx(` → 配对的 `}` 之间） */
const bodyOf = (source: string, name: string) => bracedAfter(source, `function ${name}(`)

/** 声明块里的某个属性值（`min-width: 48px` → `48px`） */
function declaration(body: string, prop: string): string {
  const match = body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`))
  expect(match, `声明块里找不到 ${prop}`).toBeTruthy()
  return match![1]!.trim().replace(/\s+/g, ' ')
}

interface TplProp {
  name?: string
  arg?: { content?: string }
  value?: { content?: string } | string | null
  exp?: { content?: string }
}

interface TplNode {
  type: number
  tag?: string
  props?: TplProp[]
  children?: TplNode[]
}

/** 解析 SFC 模板，拿真 AST（解析报错直接炸，不让断言跑在半个树上） */
function templateAst(path: string): TplNode {
  const { descriptor, errors } = parse(read(path))
  expect(errors, `${path} 模板应当能解析`).toEqual([])
  const ast = descriptor.template?.ast as unknown as TplNode | undefined
  expect(ast, `${path} 应当有模板`).toBeTruthy()
  return ast as TplNode
}

/** 元素上的类名文本（静态 `class` 与动态 `:class` 一起收） */
function classText(node: TplNode): string {
  return (node.props ?? [])
    .map((prop) => {
      const name = prop.name ?? prop.arg?.content
      if (name !== 'class') return ''
      if (typeof prop.value === 'string') return prop.value
      return prop.value?.content ?? prop.exp?.content ?? ''
    })
    .join(' ')
}

/** 按**整词**认类名：`drag-ghost` 不该把 `drag-ghost-avatar` 也算进来 */
function hasClass(node: TplNode, name: string): boolean {
  const text = classText(node)
  return (
    text.split(/\s+/).includes(name) || text.includes(`'${name}'`) || text.includes(`"${name}"`)
  )
}

/** 深度优先收集元素节点，**携带祖先链**（父子关系就是这么验的） */
function elements(
  root: TplNode,
  ancestors: TplNode[] = [],
  out: Array<{ node: TplNode; ancestors: TplNode[] }> = [],
): Array<{ node: TplNode; ancestors: TplNode[] }> {
  for (const child of root.children ?? []) {
    if (child.type !== 1) continue
    out.push({ node: child, ancestors })
    elements(child, [...ancestors, child], out)
  }
  return out
}

/** 取唯一的某个类名元素（不是恰好一个就立刻炸，不让断言悄悄落在 undefined 上） */
function oneWithClass(root: TplNode, name: string) {
  const hits = elements(root).filter((item) => hasClass(item.node, name))
  expect(hits.length, `模板里 .${name} 应当恰好出现一次`).toBe(1)
  return hits[0]!
}

/* ==================== ① 缩放三层结构 ==================== */

describe('缩放三层结构：只有一层做 transform，且绝不包住拖拽幽灵', () => {
  it('嵌套顺序是 .room-viewport → .room-spacer → .room-stage → .room-scroll', () => {
    const all = elements(templateAst(CLASSROOM))
    const chain = ['room-viewport', 'room-spacer', 'room-stage', 'room-scroll']
    const found = chain.map((name) => {
      const hits = all.filter((item) => hasClass(item.node, name))
      expect(hits.length, `.${name} 应当恰好出现一次`).toBe(1)
      return hits[0]!
    })
    for (let i = 1; i < found.length; i += 1) {
      expect(
        found[i]!.ancestors.includes(found[i - 1]!.node),
        `.${chain[i]} 应当是 .${chain[i - 1]} 的后代`,
      ).toBe(true)
    }
  })

  it('拖拽幽灵是 .seat-classroom 的直接子节点，祖先链里没有 .room-stage', () => {
    const ghost = oneWithClass(templateAst(CLASSROOM), 'drag-ghost')
    const parent = ghost.ancestors[ghost.ancestors.length - 1]
    expect(parent !== undefined && hasClass(parent, 'seat-classroom')).toBe(true)
    expect(
      ghost.ancestors.some((node) => hasClass(node, 'room-stage')),
      '幽灵落进 .room-stage 就会被再叠一次左上角偏移（transform 抢了 fixed 的包含块）',
    ).toBe(false)
  })

  it('.seat-classroom / .room-scroll / 铺满态都没有 transform、filter、backdrop-filter', () => {
    const source = css(CLASSROOM)
    for (const selector of ['.seat-classroom', '.room-scroll', '.seat-classroom.is-fullscreen']) {
      const body = ruleBody(source, selector)
      for (const banned of ['transform:', 'filter:', 'backdrop-filter:']) {
        expect(
          body.includes(banned),
          `${selector} 里不该出现 ${banned}（会抢掉 .drag-ghost 的包含块）`,
        ).toBe(false)
      }
    }
  })

  it('.room-stage 的 transform-origin 取 top left（取 top center 时放大后左半张永远滚不到）', () => {
    expect(ruleBody(css(CLASSROOM), '.room-stage')).toContain('transform-origin: top left')
  })

  it('.room-viewport 有 min-height: 0（flex 子项默认 min-height:auto，全屏时地图会滚不动）', () => {
    expect(ruleBody(css(CLASSROOM), '.room-viewport')).toContain('min-height: 0')
  })

  it('控制条 .stage-bar 在 .seat-classroom 内部（进铺满后按钮还得点得到）', () => {
    const bar = oneWithClass(templateAst(CLASSROOM), 'stage-bar')
    expect(bar.ancestors.some((node) => hasClass(node, 'seat-classroom'))).toBe(true)
  })

  it('页面把 SeatZoomBar 注入座位图组件内部（#controls 插槽），并把铺满态传下去', () => {
    const source = read(PAGE)
    expect(source).toContain('<template #controls>')
    expect(source).toContain('<SeatZoomBar')
    expect(source).toContain(':fullscreen="seatFullscreen"')
  })
})

/* ==================== ② 取消吸顶（需求点名的「菜单栏遮挡座位图」） ==================== */

describe('座位页页头不再吸顶，但下拉仍要压住座位图', () => {
  it('.seat-bar 不是 sticky、没有吸顶偏移，但保留 position: relative 与 z-index', () => {
    const body = ruleBody(css(TOOLBAR), '.seat-bar')
    expect(body).not.toMatch(/position:\s*sticky/)
    expect(body).not.toMatch(/^\s*top:/m)
    // 取消吸顶**不等于**交出层级：两个下拉（更多 / 导出座位图）靠它压住座位图，
    // 而 z-index 要生效需要定位——`relative` 让这件事不再依赖「父级是 flex」
    expect(body).toContain('position: relative')
    expect(body).toContain('z-index: var(--z-sticky)')
    // v3.3.1 的两个 P0（「更多」「导出座位图」点了没反应）就是被它会剪掉下拉
    expect(body).not.toMatch(/overflow:\s*hidden/)
  })

  it('页面里那条专为吸顶写的 margin-bottom 补丁已撤（留着间距会翻倍）', () => {
    // 断言的是「这条规则不在」，而**撤掉它的地方留着一段说明为什么撤的注释**——
    // 不剥注释的话，注释里的规则名会把这条断言骗成永远失败（反向同理：真把规则加回来、
    // 只留原注释，也会骗成通过）。凡是断言「不存在」，都必须剥注释。
    expect(css(PAGE)).not.toContain('.seats-page > .seat-bar')
  })
})

/* ==================== ③ 两种全屏 ==================== */

describe('两种全屏：目标元素、层级、退出与卸载', () => {
  it('浏览器全屏请求的是 <html>，不是组件根（Teleport 到 body 的长按卡才渲染得出来）', () => {
    const source = read(STAGE)
    expect(source).toContain('api.request(document.documentElement)')
    expect(source).not.toMatch(/request\(\s*els/)
  })

  it('全屏状态只有一个出处：fullscreenchange（含 webkit 前缀，增删两侧成对）', () => {
    const source = read(STAGE)
    for (const event of ['fullscreenchange', 'webkitfullscreenchange']) {
      expect(source).toContain(`document.addEventListener('${event}', onFullscreenChange)`)
      expect(source).toContain(`document.removeEventListener('${event}', onFullscreenChange)`)
    }
  })

  it('层级顺序：导航 < 铺满 < 弹窗 < 通知（铺满要盖住固定顶栏，又不能盖住弹窗）', () => {
    const source = read(THEME)
    const token = (name: string) => {
      const match = source.match(new RegExp(`--${name}:\\s*(\\d+)`))
      expect(match, `theme.css 里应有 --${name}`).toBeTruthy()
      return Number(match![1])
    }
    expect(token('z-nav')).toBeLessThan(token('z-fullscreen'))
    expect(token('z-fullscreen')).toBeLessThan(token('z-modal'))
    expect(token('z-fullscreen')).toBeLessThan(token('z-toast'))
    // 铺满层用令牌，不写死数字（新浮层只该改一处）
    expect(ruleBody(css(CLASSROOM), '.seat-classroom.is-fullscreen')).toContain(
      'z-index: var(--z-fullscreen)',
    )
  })

  it('进铺满：锁滚动 + 占层级栈；退出与卸载都必须成对解开', () => {
    const source = read(STAGE)
    const enter = bodyOf(source, 'enterOverlay')
    expect(enter).toContain('lockScroll()')
    expect(enter).toContain('pushLayer(token)')
    const exit = bodyOf(source, 'exitOverlay')
    expect(exit).toContain('unlockScroll()')
    expect(exit).toContain('popLayer(token)')
    // 卸载三连：全屏元素是 <html>，浏览器**不会**因为我们换页而自动退；
    // 不解锁滚动 = 整个应用再也滚不动；不弹栈 = 全站 Esc 从此失效
    const unmount = bracedAfter(source, 'onBeforeUnmount(() => {')
    expect(unmount).toContain('fullscreenApi?.exit()')
    expect(unmount).toContain('unlockScroll()')
    expect(unmount).toContain('popLayer(token)')
  })

  it('Esc 只在「我是最上层」且非浏览器全屏时退出铺满', () => {
    const body = bodyOf(read(STAGE), 'handleEscape')
    expect(body).toContain('isTopLayer(token)')
    expect(body).toContain('browserFullscreen.value')
  })

  it('长按卡也占一层（否则一次 Esc 会同时关卡片和退出铺满）', () => {
    const source = read(QUICK_CARD)
    expect(bracedAfter(source, 'onMounted(() => {')).toContain('pushLayer(layerToken)')
    expect(bracedAfter(source, 'onBeforeUnmount(() => {')).toContain('popLayer(layerToken)')
  })

  it('页面的 Esc 链在**捕获阶段**注册——否则弹窗会在 window 冒泡里先关掉、守卫失效', () => {
    const source = read(PAGE)
    expect(source).toContain("window.addEventListener('keydown', onWindowKeydown, true)")
    // 第三个参数必须两侧一致：删的时候漏掉 `true`，监听器就留在 window 上不走了
    expect(source).toContain("window.removeEventListener('keydown', onWindowKeydown, true)")
    expect(source).toContain('stage.handleEscape()')
  })

  it('设备不支持浏览器全屏时「全屏」按钮整个不渲染（不给点了没反应的假入口）', () => {
    const source = read(ZOOM_BAR)
    expect(source).toContain('v-if="fullscreenSupported"')
    expect(read(STAGE)).toContain("toast.warning('本设备不支持浏览器全屏，已改为铺满显示')")
  })
})

/* ==================== ④ 承重耦合（此前零断言） ==================== */

describe('座位格与列号逐列对齐靠的是同一套 flex 参数', () => {
  it('.col-no 与 .seat 的 flex / min-width / max-width 三项必须相同', () => {
    const colNo = ruleBody(css(CLASSROOM), '.col-no')
    const seat = ruleBody(css(SEAT_CARD), '.seat')
    for (const prop of ['flex', 'min-width', 'max-width']) {
      expect(
        declaration(colNo, prop),
        `${prop} 不一致：列号与座位会逐列错开（「3 号下面坐着 4 号」）`,
      ).toBe(declaration(seat, prop))
    }
  })
})

/* ==================== ⑤ 长按信息卡的主人（P0 回归钉） ==================== */

describe('长按信息卡的主人：座位 id → 座位 → 学生，两步都不能省', () => {
  it('quickStudent 经 seatsById 解析，不再拿座位 id 去查 props.students', () => {
    const body = bracedAfter(read(CLASSROOM), 'const quickStudent = computed(')
    expect(body).toContain('seatsById.value.get(')
    // `props.students` 是 Map<学生 id, Student>，用座位 id（r2c6）查永远是 undefined：
    // 卡片不该渲染 → 松手时 click 又被吞掉 → 「长按毫无反应，连选中都没有」
    expect(body).not.toContain('props.students.get')
  })
})
