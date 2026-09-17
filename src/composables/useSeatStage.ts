/**
 * 座位图舞台（v3.4.0）——「一屏装下 + 两种全屏」这套几何的**唯一持有者**。
 *
 * 需求背景：座位图自然高约 847px，13 寸笔记本的视口高约 800px，**物理上放不下**。
 * 做法是整块等比缩放到可用空间（`utils/seatStage.ts` 算比例，这里负责测量与写入），
 * 再把「铺满视口」做成两种实现：浏览器全屏（`<html>` 交出去）与应用内全屏（CSS 铺满）。
 *
 * 三条不变量，改这个文件之前先读：
 *
 * 1. **读写分离**。每个 rAF 里先把要读的量全部读完（可用空间、自然尺寸），再统一写样式。
 *    交错读写会一帧内触发多次强制重排——拖窗口时肉眼可见地卡。
 * 2. **测量只用布局值**（`clientWidth` / `offsetHeight` / `scrollWidth`）。
 *    它们不受 transform 影响，所以测量稳定、不会「量到一半变的数」而反复震荡。
 * 3. **几何写内联样式、状态走 Vue**。类名（`.is-fullscreen`）由 prop 驱动，
 *    尺寸与 transform 由这里命令式写——两套东西混在一起就会出现「解绑了但样式还留着」。
 *
 * 为什么不用 `CSS zoom`：它会进布局，而缩放下的 `offsetWidth` 各引擎取值不一致
 * （本组件同时用像素宽度与百分比宽度，三条全占），测量契约一崩，这套算法就没有地基了。
 */
import { computed, onBeforeUnmount, ref } from 'vue'

import { isTopLayer, lockScroll, popLayer, pushLayer, unlockScroll } from '@/components/ui/layers'
import { useToast } from '@/composables/useToast'
import {
  MAX_SEAT_SCALE,
  MIN_SEAT_SCALE,
  SEAT_STAGE_TOP_RESERVE,
  fitSeatScale,
  formatScalePercent,
  resolveFullscreenApi,
  stepSeatScale,
} from '@/utils/seatStage'
import type { FullscreenApi } from '@/utils/seatStage'

/**
 * 三层缩放结构的元素（由 `SeatClassroom` 的 `stageEls()` 交出）。
 * 四个都要，少一个就有一步量不出来：
 * `scroll` 是量「内容真正需要多宽」的唯一出处（窄窗口下座位挤不下，
 * 那部分宽度也得算进「一屏」，见 `natW` 的取法）。
 */
export interface SeatStageEls {
  root: HTMLElement
  /** 滚动 / 平移容器，也是可用空间的量尺 */
  viewport: HTMLElement
  /** 缩放后的视觉占位（宽高 = 自然尺寸 × k） */
  spacer: HTMLElement
  /** 唯一被 transform 的一层 */
  stage: HTMLElement
  /** `.room-scroll`：量自然宽用 */
  scroll: HTMLElement
}

export interface UseSeatStageOptions {
  /**
   * 座位图**以下**、又在组件之外的固定占高（px）：纸张下内边距 + 页面间距 + 状态栏 + 壳层下留白。
   * **只在非全屏时扣**——全屏时那些元素都被铺满层盖住了，再扣一遍等于白扔一百多像素高度。
   */
  belowReserve?: () => number
}

export function useSeatStage(options: UseSeatStageOptions = {}) {
  /**
   * 浏览器全屏能力：**一次探测，实例生命周期内不再变**。
   * `undefined` = 本设备没有元素级全屏（iPhone Safari 只有 video 能全屏）——
   * 此时「全屏」按钮**不渲染**，而不是给一个点了没反应的假入口。
   */
  const fullscreenApi: FullscreenApi | undefined = resolveFullscreenApi()
  /** 层级栈令牌：Esc 与滚动锁和其他弹层共用一个栈（见 components/ui/layers.ts） */
  const token = Symbol('seat-stage')
  const toast = useToast()

  /** 缩放比例（1 = 自然尺寸）；写进 `.room-stage` 的 transform */
  const scale = ref(1)
  /** 比例文案（`73%`），控制条显示用 */
  const scaleLabel = computed(() => formatScalePercent(scale.value))
  /**
   * `fit` = 跟随可用空间自动拟合；`manual` = 用户按过加减号，
   * **此后窗口 resize 只保持他定的比例**（再自动重拟合等于把用户的操作撤销掉）。
   */
  const mode = ref<'fit' | 'manual'>('fit')
  /** 铺满视口：浏览器全屏与应用内全屏**共用的视觉态**（两者视觉一致，测试面收敛成一条） */
  const fullscreen = ref(false)
  /** 是否正由**浏览器**全屏（此时 Esc 归浏览器，我们不抢——见 handleEscape） */
  const browserFullscreen = ref(false)
  /** 本设备是否支持浏览器全屏（不支持则「全屏」按钮不渲染） */
  const fullscreenSupported = fullscreenApi !== undefined

  const atMin = computed(() => scale.value <= MIN_SEAT_SCALE)
  const atMax = computed(() => scale.value >= MAX_SEAT_SCALE)

  let els: SeatStageEls | undefined
  /**
   * 上一轮**真正写进 DOM** 的几何值。ResizeObserver 会因为我们自己改尺寸而再次回调，
   * 这份记账就是收敛点：算出来还是同一组值就什么都不写，回调链自然不会继续。
   */
  let applied: { k: number; natW: number; natH: number; overlay: boolean } | undefined
  /** rAF 句柄（0 = 没有待执行的帧） */
  let frame = 0
  let observer: ResizeObserver | undefined
  /** 进全屏前的页面滚动位置：滚动锁期间浏览器可能把页面顶回页首，退出时要还原 */
  let savedScrollY = 0
  let restoreFrame = 0

  /* ========== 测量与写入 ========== */

  /**
   * 可用高度：视口高 − 上方保留 − 座位图以下的一切。
   *
   * **非全屏时上方用常数（`SEAT_STAGE_TOP_RESERVE` 80），不用实测的 `rect.top`**：
   * 座位图会随页面滚动，实测值随滚动位置变，拟合结果就会跟着抖（往上滚一点图变大一点）。
   * 取常数的语义是「从顶栏下沿算起的一屏」——点「适应」把图滚到那里，看到的就正好是全部；
   * 而重拟合**绝不滚动页面**（只有用户主动点「适应」才滚）。
   *
   * `belowInside` 用两个 rect 相减：它是组件内部说明文字与下内边距的高度，
   * 与 k 无关（那两条说明不缩放），所以测量稳定。
   */
  function availableHeight(root: HTMLElement, viewport: HTMLElement): number {
    const viewportRect = viewport.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    const belowInside = Math.max(0, rootRect.bottom - viewportRect.bottom)
    if (fullscreen.value) {
      // 铺满层已经贴在视口上，上方只需量它自己的实测位置（安全区内边距 + 控制条）
      return window.innerHeight - viewportRect.top - belowInside
    }
    return (
      window.innerHeight - SEAT_STAGE_TOP_RESERVE - belowInside - (options.belowReserve?.() ?? 0)
    )
  }

  /** 手动缩放只改比例，自然尺寸不动——直接按上一轮的记账重写几何即可 */
  function applyScale(k: number) {
    if (!els || !applied) {
      schedule()
      return
    }
    els.stage.style.transform = `scale(${k})`
    els.spacer.style.width = `${applied.natW * k}px`
    els.spacer.style.height = `${applied.natH * k}px`
    applied = { ...applied, k }
  }

  /** 一个 rAF 里做完「测量 → 算比例 → 写样式」（读写分离见文件头不变量 1） */
  function run() {
    if (!els) return
    const { root, viewport, spacer, stage, scroll } = els

    /* ---- 读：可用空间 ---- */
    const availW = viewport.clientWidth
    const availH = availableHeight(root, viewport)

    /*
      ---- 写 → 读：自然尺寸 ----
      先把舞台摆成「容器宽度」再量，是因为 `.room` 是 `width: 100%`：
      自然宽本来就是容器给的，只是窄窗口下座位的最小宽度会把它顶宽，
      那部分（`scroll.scrollWidth`）也得算进「一屏」，否则横向会被切掉一块。
      `offsetHeight` / `scrollWidth` 是布局值，**不受已有 transform 影响**，
      所以这里不必先清掉上一轮的 scale——这正是当初选 transform 而不是 zoom 的原因。
    */
    stage.style.position = 'absolute'
    stage.style.width = `${availW}px`
    const natW = Math.max(availW, scroll.scrollWidth)
    stage.style.width = `${natW}px`
    const natH = stage.offsetHeight

    /* ---- 算 ---- */
    const k = mode.value === 'fit' ? fitSeatScale({ availH, natH, availW, natW }) : scale.value

    if (
      applied &&
      applied.k === k &&
      applied.natW === natW &&
      applied.natH === natH &&
      applied.overlay === fullscreen.value
    ) {
      // 收敛点：算出来与上一轮写进去的完全一致，DOM 已经是这个样子了
      return
    }

    /* ---- 写 ---- */
    scale.value = k
    // transform-origin 不在这里写：它属于 `.room-stage` 的 CSS（top left 是承重的，
    // 取 top center 会让放大后的左半张图永远滚不到，见 SeatClassroom 的说明）
    stage.style.transform = `scale(${k})`
    spacer.style.width = `${natW * k}px`
    spacer.style.height = `${natH * k}px`
    applied = { k, natW, natH, overlay: fullscreen.value }
  }

  function schedule() {
    if (frame !== 0) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      run()
    })
  }

  /* ========== 绑定 / 解绑 ========== */

  function teardown() {
    observer?.disconnect()
    observer = undefined
    window.removeEventListener('resize', schedule)
  }

  /**
   * 绑定三层结构（页面在 `SeatClassroom` 挂载后调用）。
   *
   * **同时听两处，少一处就有一种「图不对」**：
   * · `window.resize` —— 拖窗口 / F11 / 转屏；
   * · `ResizeObserver(viewport)` —— 容器尺寸变化（侧栏折叠、浏览器缩放、全屏进出），
   *   这些**不触发** `window.resize`。
   *
   * **刻意不用防抖**：拖窗口时 100ms 的延迟会让图一顿一顿地跳；rAF 合并已经够省，
   * 一帧最多算一次，而且算完就收敛（见 `run` 里的收敛点）。
   */
  function bindEls(next: SeatStageEls | undefined) {
    if (els === next) return
    els = next
    applied = undefined // 换了元素，上一轮的记账作废
    teardown()
    if (!els) return

    window.addEventListener('resize', schedule)
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule)
      observer.observe(els.viewport)
    }
    schedule()
  }

  /* ========== 缩放 ========== */

  /** 手动缩放一档（`direction`：-1 缩小 / +1 放大）；按过就切到 `manual` */
  function zoom(direction: -1 | 1) {
    mode.value = 'manual'
    scale.value = stepSeatScale(scale.value, direction)
    applyScale(scale.value)
  }

  const zoomIn = () => zoom(1)
  const zoomOut = () => zoom(-1)

  /**
   * 「适应」：回到自动拟合，并**把座位图滚到顶栏下面**（`scroll-margin-top` 在
   * `.room-viewport` 上给了这个余量）。
   *
   * 滚**只在这里**发生——重拟合（resize / 全屏进出）绝不滚动页面，
   * 否则用户正在看第 3 排，窗口一变就被拽回页首。
   */
  function resetFit() {
    mode.value = 'fit'
    run() // 先把几何写好再滚：平滑滚动追一个还在变的目标会停偏
    els?.viewport.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /* ========== 全屏 ========== */

  /**
   * 进铺满态（应用内全屏）。**滚动锁与层级栈必须成对**：
   * 只锁不解 = 退出后整站滚不动；只弹不推 = Esc 永远失效。
   */
  function enterOverlay() {
    if (fullscreen.value) return
    fullscreen.value = true
    savedScrollY = window.scrollY
    lockScroll()
    pushLayer(token)
    schedule() // 容器尺寸整体变了，重拟合
  }

  function exitOverlay() {
    if (!fullscreen.value) return
    fullscreen.value = false
    unlockScroll()
    popLayer(token)
    // 还原进全屏前的页面位置（滚动锁期间浏览器可能把页面顶回页首）
    if (restoreFrame !== 0) window.cancelAnimationFrame(restoreFrame)
    restoreFrame = window.requestAnimationFrame(() => {
      restoreFrame = 0
      window.scrollTo({ top: savedScrollY })
    })
    schedule()
  }

  /** 应用内全屏的开 / 关（「铺满」按钮） */
  function toggleOverlay() {
    if (fullscreen.value) exitOverlay()
    else enterOverlay()
  }

  /**
   * 浏览器全屏的开 / 关（「全屏」按钮；设备不支持时不该有入口）。
   *
   * **目标元素必须是 `document.documentElement`，不能是座位图组件根**：
   * 全屏时浏览器**只渲染全屏元素的子树**，而长按信息卡 `SeatQuickCard` 是
   * `Teleport to="body"`——取组件根会让它根本不渲染（教师看到「长按没反应」，
   * 正是 v3.3.1 修过的那类症状）。取 `<html>` 之后 teleport 的卡片、弹窗、
   * Toast 全在子树内照常工作，而「只看座位图」的视觉由 `.is-fullscreen` 铺满层负责。
   */
  async function toggleBrowserFullscreen() {
    const api = fullscreenApi
    if (!api) return
    if (browserFullscreen.value) {
      await api.exit() // 退出由 fullscreenchange 统一收尾（状态只有一个出处）
      return
    }
    try {
      await api.request(document.documentElement)
      browserFullscreen.value = true
      enterOverlay()
    } catch {
      /*
        元素上缺方法 / 被浏览器策略拒绝：**回落应用内全屏**，用户仍然拿到「更大」的结果。
        这条分支不写，界面就会显示「已全屏」而屏幕毫无变化——最难排查的一种。
      */
      toast.warning('本设备不支持浏览器全屏，已改为铺满显示')
      enterOverlay()
    }
  }

  /**
   * 全屏状态同步：**唯一出处**。
   * 用户按 Esc / 系统手势 / 切到别的应用退出浏览器全屏时，`fullscreenchange` 是
   * 我们知道这件事的唯一途径；不同步的话界面会停在「铺满却不是全屏」的半截状态。
   */
  function onFullscreenChange() {
    if (fullscreenApi?.element() != null) {
      browserFullscreen.value = true
      enterOverlay()
      return
    }
    browserFullscreen.value = false
    exitOverlay()
  }

  /**
   * Esc 链上的一档（页面在换座模式 / 对比视图**之后**调用它）。
   * 返回 `true` = 这次 Esc 归本舞台消费，调用方不要再做别的动作。
   */
  function handleEscape(): boolean {
    if (!fullscreen.value) return false
    /*
      浏览器全屏时**不抢**：那个 Esc 由浏览器接管（拦不住，也不该拦），
      状态靠 `fullscreenchange` 同步回来。文档与验收清单里如实记了这一条：
      浏览器全屏下「弹窗开着按 Esc」会同时退全屏与关弹窗。
    */
    if (browserFullscreen.value) return false
    // 只接最上层那一档：弹窗 / 长按卡开着时 Esc 归它们（见 layers.ts）
    if (!isTopLayer(token)) return false
    exitOverlay()
    return true
  }

  /* ========== 生命周期 ========== */

  if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('webkitfullscreenchange', onFullscreenChange)
  }

  onBeforeUnmount(() => {
    if (frame !== 0) window.cancelAnimationFrame(frame)
    if (restoreFrame !== 0) window.cancelAnimationFrame(restoreFrame)
    teardown()
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
    /*
      卸载三连，少一条都会留下「切了页还…」的痕迹：
      ① 退浏览器全屏——全屏元素是 `<html>`，**浏览器不会因为我们换页而自动退**；
      ② 解滚动锁——不解的话整个应用再也滚不动（P0 级手感问题）；
      ③ 弹层级栈——不弹的话最上层永远是本舞台，全站 Esc 从此失效。
    */
    if (browserFullscreen.value) {
      browserFullscreen.value = false
      void fullscreenApi?.exit()
    }
    if (fullscreen.value) {
      fullscreen.value = false
      unlockScroll()
      popLayer(token)
    }
  })

  return {
    scale,
    scaleLabel,
    mode,
    fullscreen,
    browserFullscreen,
    fullscreenSupported,
    atMin,
    atMax,
    bindEls,
    zoomIn,
    zoomOut,
    resetFit,
    toggleOverlay,
    toggleBrowserFullscreen,
    handleEscape,
  }
}
