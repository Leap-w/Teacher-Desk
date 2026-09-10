/**
 * 弹层（AppModal / AppDrawer）共用的三件事：页面滚动锁、层级顺序、焦点循环。
 *
 * 为什么要共用而不是各自记一份（Phase 5 抽出）：课程编辑抽屉里会再叠一个
 * 「删除确认」AppModal —— 两层各记各的计数时，先关闭的那层会把滚动锁提前释放
 * （抽屉还开着、页面却能滚），一次 ESC 也会同时关掉两层。
 * 层级顺序保证**只有最上层响应 ESC**。
 */

/** 已打开的弹层数：由最后一个关闭者释放滚动锁 */
let openCount = 0

export function lockScroll(): void {
  openCount += 1
  if (openCount === 1) document.body.style.overflow = 'hidden'
}

export function unlockScroll(): void {
  openCount = Math.max(0, openCount - 1)
  if (openCount === 0) document.body.style.overflow = ''
}

const stack: symbol[] = []

/** 打开一层（token 由各组件在 setup 时创建，保持实例唯一） */
export function pushLayer(token: symbol): void {
  stack.push(token)
}

/** 关闭一层 */
export function popLayer(token: symbol): void {
  const index = stack.lastIndexOf(token)
  if (index !== -1) stack.splice(index, 1)
}

/** 该层是否在最上面（只有最上层响应 ESC / 接管键盘） */
export function isTopLayer(token: symbol): boolean {
  return stack[stack.length - 1] === token
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** Tab / Shift+Tab 在弹层内循环（键盘用户不会 Tab 到背后的页面） */
export function handleFocusTrap(panel: HTMLElement, event: KeyboardEvent): void {
  const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null,
  )
  if (focusables.length === 0) {
    event.preventDefault()
    return
  }
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || active === panel)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}
