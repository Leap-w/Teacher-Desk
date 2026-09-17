/**
 * 座位图舞台（v3.4.0）——「一屏装下」的**唯一算术出处**：缩放比例的拟合与步进、
 * 百分比文案、浏览器全屏 API 的三态探测。
 *
 * **为什么要有这个模块**：座位图实高约 847px（7 排 × 90 + 行距 + 列号行 + 讲台行 +
 * 各级内边距），13 寸笔记本的视口高约 800px——**物理上放不下**。需求方因此提出
 * 「一屏显示 + 全屏」。做法不是把座位改小（那会撞上 `.col-no` 与 `.seat` 的
 * `max-width` 承重耦合，见 SeatClassroom 里的说明），而是**整块等比缩放到可用空间**。
 *
 * 本模块只做纯计算：**不摸 DOM、不写样式、不存状态**。测量与写入在
 * `composables/useSeatStage.ts`，这里的东西因此可以在 Node 里直接单测
 * （见 `__tests__/seatStage.test.ts`）。
 */

/**
 * 缩放下限（50%）。
 *
 * 这不是布局下限，是**可读性下限**：座位格里的姓名是 12px，缩到 0.5 就是 6px，
 * 已经在「看得出有字、读不出是谁」的区间。再往下缩没有意义——宁可让图超出屏幕、
 * 用滚动看，也不能给出一张「一屏装下了但没人名认得出」的图。
 *
 * 目标机（MacBook Air 13"）上自适应拟合的实测值在 0.65~0.75 之间，
 * 这正是**全屏不可替代**的原因：全屏能再多出 90~120px 可用高，比例回到 0.85~0.95。
 */
export const MIN_SEAT_SCALE = 0.5

/** 缩放上限（200%）：座位格自然尺寸 126×90，放大到两倍已足够看清任何一格 */
export const MAX_SEAT_SCALE = 2

/** 手动缩放每按一次的步长 */
export const SEAT_SCALE_STEP = 0.1

/**
 * 非全屏时，座位图**上方**要预留的高度（px）= 全局顶栏 72（`--nav-height`）+ 8 呼吸。
 *
 * 顶栏是 `position: fixed`（覆盖在内容之上），所以「一屏看得见座位图」的量尺
 * 必须从它下沿起算；那 8px 是让它不贴着顶栏边。全屏时不用这个常数——
 * 全屏容器已经铺满视口，直接量它的实际位置即可。
 */
export const SEAT_STAGE_TOP_RESERVE = 80

/** 拟合用的四个尺寸（全部是**布局值**，不受 transform 影响，因此测量稳定、不会来回震荡） */
export interface SeatFitInput {
  /** 可用高度：视口高 − 上方保留 − 座位图以下的一切（说明文字 / 状态栏 / 页面下留白） */
  availH: number
  /** 座位图自然高（未缩放） */
  natH: number
  /** 可用宽度：舞台容器的宽度 */
  availW: number
  /**
   * 座位图自然宽。取 `scrollWidth` 而不是 `clientWidth`：窄窗口下座位图比容器宽、
   * 要靠横向滚动才看得全，那部分也是「一屏」必须装下的量。
   */
  natW: number
}

/** 一个数能不能参与拟合（0 / 负数 / NaN / Infinity 一律不算） */
function isUsable(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/** 把比例夹进 `[MIN, MAX]`；非有限数回 1（**绝不能把 NaN / Infinity 写进 style**，见 fitSeatScale） */
function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(MAX_SEAT_SCALE, Math.max(MIN_SEAT_SCALE, scale))
}

/**
 * 自适应比例：**只缩不放**，把整张座位图装进可用空间。
 *
 * 三条规矩，每条都对应一个真实会出的事故：
 *
 * 1. **上限恒为 1**——空间富裕时也不放大。座位卡是按 126×90 设计的，放大只会让
 *    姓名发虚、并排的过道比例失真；「自适应」的语义是「装得下」，不是「铺满」。
 * 2. **高宽取更小者**——高度吃紧就按高度缩，宽度吃紧（窄窗口）就按宽度缩。
 * 3. **坏值必须回 1**——`natH` 为 0 时 `availH / natH` 是 `Infinity`，
 *    写进 `transform: scale()` 会让整张图**塌成 0 高**；而界面上的表现只是
 *    「座位图不见了」，排查起来毫无线索。宁可回 1（图超出屏幕但看得见），
 *    也不回一个会让它消失的数。
 *
 * 结果再夹到 `[MIN_SEAT_SCALE, MAX_SEAT_SCALE]`：可用空间小到极限时夹在下限上，
 * 此时图会超出视口——那是**有意的**，超出还能滚，缩到读不出等于没有。
 */
export function fitSeatScale(input: SeatFitInput): number {
  const { availH, natH, availW, natW } = input
  if (!isUsable(availH) || !isUsable(natH) || !isUsable(availW) || !isUsable(natW)) return 1
  return clampScale(Math.min(1, availH / natH, availW / natW))
}

/**
 * 手动缩放一步（`direction` = -1 缩小 / +1 放大），夹在上限内。
 *
 * 先夹再回两位小数：连续按十次不该出现 `0.7000000000000001` 这种值——
 * 它会被显示成「70%」但与原值 `!==`，于是「按十次回到起点」这类判断会莫名其妙地不成立。
 */
export function stepSeatScale(current: number, direction: -1 | 1): number {
  return Math.round(clampScale(current + direction * SEAT_SCALE_STEP) * 100) / 100
}

/** 比例文案（`0.734` → `'73%'`；控制条上显示用） */
export function formatScalePercent(scale: number): string {
  return `${Math.round(scale * 100)}%`
}

/**
 * 浏览器全屏 API 的**两侧**最小接口。**故意不用 DOM 类型**：`webkit` 前缀那几个成员
 * 不在标准类型里，而单测要能传普通对象进来（仓库风格：不用 jsdom）。
 *
 * 注意**能力在哪一侧**：`enabled` / `element` / `exit` 在 **document** 上，
 * `request` 在**元素**上（`el.requestFullscreen()`）——写反了就是「点了没反应」。
 */
export interface FullscreenHost {
  fullscreenEnabled?: boolean
  fullscreenElement?: Element | null
  exitFullscreen?: () => Promise<void> | void
  webkitFullscreenEnabled?: boolean
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

/** 可以请求全屏的元素（`<html>` 也在这个形状里） */
export interface FullscreenTarget {
  requestFullscreen?: () => Promise<void> | void
  webkitRequestFullscreen?: () => Promise<void> | void
}

/** 探测结果：三种形态（标准 / webkit 前缀 / 不可用）收敛成同一组调用 */
export interface FullscreenApi {
  /** 请求把某个元素切到全屏；元素上缺方法时 **reject**（调用方据此回落，见下） */
  request(target: FullscreenTarget): Promise<void>
  exit(): Promise<void>
  /** 当前处于全屏的元素（null = 不在全屏）——用于把「用户按 Esc 退出」同步回界面状态 */
  element(): Element | null
}

/**
 * 探测浏览器全屏能力（标准 → webkit 前缀 → 不可用）。
 *
 * 返回 `undefined` 表示**这台设备根本不支持元素级全屏**（iPhone Safari：只有 video
 * 能全屏）——调用方据此**不渲染**「全屏」按钮，而不是渲染一个点了没反应的按钮。
 * 老 Safari 走 webkit 前缀那一支，能力位也跟着读前缀版本。
 *
 * 元素上缺对应方法时 `request` 走 reject 而不是静默成功：调用方（`useSeatStage`）
 * 会 **回落到应用内全屏**，用户仍然拿到「更大」的结果——静默成功会让界面显示
 * 「已全屏」而屏幕毫无变化，那是最难排查的一种。
 */
export function resolveFullscreenApi(
  doc: FullscreenHost | undefined = globalThis.document as FullscreenHost | undefined,
): FullscreenApi | undefined {
  if (!doc) return undefined

  if (doc.fullscreenEnabled === true && typeof doc.exitFullscreen === 'function') {
    return {
      request: (target) =>
        typeof target.requestFullscreen === 'function'
          ? Promise.resolve(target.requestFullscreen())
          : Promise.reject(new Error('元素不支持 requestFullscreen')),
      exit: () => Promise.resolve(doc.exitFullscreen?.call(doc)),
      element: () => doc.fullscreenElement ?? null,
    }
  }

  if (doc.webkitFullscreenEnabled === true && typeof doc.webkitExitFullscreen === 'function') {
    return {
      request: (target) =>
        typeof target.webkitRequestFullscreen === 'function'
          ? Promise.resolve(target.webkitRequestFullscreen())
          : Promise.reject(new Error('元素不支持 webkitRequestFullscreen')),
      exit: () => Promise.resolve(doc.webkitExitFullscreen?.call(doc)),
      element: () => doc.webkitFullscreenElement ?? null,
    }
  }

  return undefined
}
