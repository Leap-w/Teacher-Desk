/**
 * 座位图舞台（v3.4.0）——「一屏装下」的算术与全屏能力探测。
 *
 * 这一版把座位图整块等比缩放进可用空间（约 847px 高的图要塞进 13 寸屏的 ~800px 视口），
 * 算法本身只有一条除法，但**每一个坏值都对应一种「图看起来没了」的界面事故**：
 *
 *  ① **越界放大**。自适应如果允许放大，空间富裕的机器上会把 126px 的座位格拉到发虚；
 *     上限必须恒为 1（手动缩放才用得上 2 倍）。
 *  ② **比例算成 Infinity / NaN**。自然高量成 0（元素还没挂载 / 被 `display:none`）时
 *     `availH / 0 = Infinity`，写进 `transform: scale()` 会让整张图塌成 0 高——
 *     而界面上的表现只是「座位图不见了」，看上去像渲染崩了，实际是这里算出来的。
 *  ③ **下限不夹**。可用空间极小时若让它继续缩，姓名（12px）会缩到 3~4px：
 *     一屏是装下了，可一个人名也读不出来。宁可超出屏幕用滚动看。
 *  ④ **全屏能力探测分错侧**。`enabled`/`exit`/`element` 在 **document** 上，
 *     `request` 在**元素**上（`el.requestFullscreen()`）。写反的后果不是报错，
 *     而是**点了没反应**——正是 v3.3.1 修过的那类 P0 症状。iPhone Safari 没有
 *     元素级全屏，探测必须回 `undefined` 让按钮**不渲染**，而不是给一个假入口。
 *
 * 纯函数、不摸 DOM，所以这些全部能在 Node 里直接测（仓库不用 jsdom）。
 */
import { describe, expect, it, vi } from 'vitest'

import {
  MAX_SEAT_SCALE,
  MIN_SEAT_SCALE,
  formatScalePercent,
  fitSeatScale,
  resolveFullscreenApi,
  stepSeatScale,
} from '@/utils/seatStage'
import type { FullscreenHost, FullscreenTarget } from '@/utils/seatStage'

/** 目标机上的真实量级：座位图自然高 ~847、自然宽 ~1230，13 寸视口可用的高度约 700 */
const NAT_H = 847
const NAT_W = 1230

describe('自适应比例：只缩不放', () => {
  it('空间富裕时不放大（座位卡是按 126×90 设计的，放大只会发虚）', () => {
    expect(fitSeatScale({ availH: 1200, natH: NAT_H, availW: 1600, natW: NAT_W })).toBe(1)
  })

  it('高度吃紧时按高度缩，且结果真的装得下', () => {
    const scale = fitSeatScale({ availH: 700, natH: NAT_H, availW: 1600, natW: NAT_W })

    expect(scale).toBeCloseTo(700 / NAT_H, 5)
    expect(scale * NAT_H).toBeLessThanOrEqual(700)
  })

  it('宽度吃紧时按宽度缩（窄窗口下座位图比容器宽，那部分也要算进「一屏」）', () => {
    const scale = fitSeatScale({ availH: 1200, natH: NAT_H, availW: 700, natW: NAT_W })

    expect(scale).toBeCloseTo(700 / NAT_W, 5)
    expect(scale).toBeLessThan(1)
  })

  it('高宽同时吃紧取更小的那个', () => {
    const scale = fitSeatScale({
      availH: NAT_H * 0.9,
      natH: NAT_H,
      availW: NAT_W * 0.7,
      natW: NAT_W,
    })

    expect(scale).toBeCloseTo(0.7, 5)
  })
})

describe('自适应比例：坏值一律回 1（绝不能让图塌掉）', () => {
  /**
   * 这几条是同一类事故的不同入口：**任何**一个尺寸量成 0 / 负数 / NaN，
   * 比例都会变成 Infinity 或 NaN，而写进 style 的表现是整张图消失。
   * 回 1 的代价是「图超出屏幕」（还能滚），回 Infinity 的代价是「图没了」。
   */
  it('自然高为 0 时回 1（availH / 0 = Infinity）', () => {
    expect(fitSeatScale({ availH: 700, natH: 0, availW: 1600, natW: NAT_W })).toBe(1)
  })

  it('自然高 / 自然宽是 NaN 或负数时回 1', () => {
    expect(fitSeatScale({ availH: 700, natH: NaN, availW: 1600, natW: NAT_W })).toBe(1)
    expect(fitSeatScale({ availH: 700, natH: NAT_H, availW: 1600, natW: -5 })).toBe(1)
  })

  it('可用空间量成 0 / NaN / Infinity 时回 1', () => {
    expect(fitSeatScale({ availH: 0, natH: NAT_H, availW: 1600, natW: NAT_W })).toBe(1)
    expect(fitSeatScale({ availH: NaN, natH: NAT_H, availW: 1600, natW: NAT_W })).toBe(1)
    expect(fitSeatScale({ availH: Infinity, natH: NAT_H, availW: 1600, natW: NAT_W })).toBe(1)
  })
})

describe('缩放的上下限', () => {
  it('可用空间极小时夹在下限上（超出屏幕还能滚，缩到读不出等于没有）', () => {
    expect(fitSeatScale({ availH: 100, natH: NAT_H, availW: 1600, natW: NAT_W })).toBe(
      MIN_SEAT_SCALE,
    )
  })

  it('手动放大最多到 200%，再按也上不去', () => {
    expect(stepSeatScale(1.95, 1)).toBe(MAX_SEAT_SCALE)
    expect(stepSeatScale(MAX_SEAT_SCALE, 1)).toBe(MAX_SEAT_SCALE)
  })

  it('手动缩小到底同样夹住，不会一路缩到 0', () => {
    expect(stepSeatScale(MIN_SEAT_SCALE, -1)).toBe(MIN_SEAT_SCALE)
  })

  it('步进是精确的两位小数，连续按不会漂成 0.7000000000000001', () => {
    // 「按十次回到起点」这类判断靠它成立；漂了就会出现显示 70% 却不等于 0.7 的怪事
    expect(stepSeatScale(0.7, 1)).toBe(0.8)
    expect(stepSeatScale(0.8, -1)).toBe(0.7)

    let scale = MIN_SEAT_SCALE
    for (let i = 0; i < 10; i++) scale = stepSeatScale(scale, 1)
    expect(scale).toBe(1.5)
  })

  it('步进收到坏值也回得到有限数（NaN 进 → 1 出，而不是把 NaN 传到 style 里）', () => {
    expect(stepSeatScale(NaN, 1)).toBe(1)
  })

  it('百分比文案四舍五入到整数', () => {
    expect(formatScalePercent(0.734)).toBe('73%')
    expect(formatScalePercent(0.7)).toBe('70%')
    expect(formatScalePercent(1)).toBe('100%')
  })
})

describe('浏览器全屏探测：三种形态', () => {
  /**
   * 假 document / 假元素都只是普通对象——本函数**刻意不依赖 DOM 类型**，
   * 为的就是这几条能在 Node 里测。
   */
  function standardDoc(overrides: Partial<FullscreenHost> = {}): FullscreenHost {
    return {
      fullscreenEnabled: true,
      fullscreenElement: null,
      exitFullscreen: vi.fn(),
      ...overrides,
    }
  }

  it('没有全屏能力时返回 undefined（iPhone Safari：按钮不渲染，而不是点了没反应）', () => {
    expect(resolveFullscreenApi({})).toBeUndefined()
    expect(resolveFullscreenApi(undefined)).toBeUndefined()
  })

  it('能力位为 false 时不认（有方法也不算数）', () => {
    expect(resolveFullscreenApi(standardDoc({ fullscreenEnabled: false }))).toBeUndefined()
  })

  it('标准 API 在时用标准那一支', () => {
    const element = { tagName: 'HTML' } as unknown as Element
    const exitFullscreen = vi.fn()
    const api = resolveFullscreenApi(standardDoc({ exitFullscreen, fullscreenElement: element }))

    expect(api?.element()).toBe(element)
    api?.exit()
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
  })

  it('只有 webkit 前缀时走前缀那一支（老 Safari）', () => {
    const exitFullscreen = vi.fn()
    const api = resolveFullscreenApi({
      webkitFullscreenEnabled: true,
      webkitFullscreenElement: null,
      webkitExitFullscreen: exitFullscreen,
    })

    expect(api).toBeDefined()
    api?.exit()
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
  })

  it('**请求全屏调的是元素上的方法，不是 document 上的**（写反 = 点了没反应）', () => {
    const exitFullscreen = vi.fn()
    const requestOnElement = vi.fn()
    // document 上放一个同名方法：若实现调错侧，这个 spy 会亮，而这正是要防的写法
    const docRequestOnDocument = vi.fn()
    const doc = { ...standardDoc({ exitFullscreen }), requestFullscreen: docRequestOnDocument }
    const target: FullscreenTarget = { requestFullscreen: requestOnElement }

    resolveFullscreenApi(doc)?.request(target)

    expect(requestOnElement).toHaveBeenCalledTimes(1)
    expect(docRequestOnDocument).not.toHaveBeenCalled()
  })

  it('webkit 分支同样调元素上的前缀方法', () => {
    const requestOnElement = vi.fn()
    const api = resolveFullscreenApi({
      webkitFullscreenEnabled: true,
      webkitExitFullscreen: vi.fn(),
    })

    api?.request({ webkitRequestFullscreen: requestOnElement })
    expect(requestOnElement).toHaveBeenCalledTimes(1)
  })

  it('元素上没有对应方法时 reject（调用方据此回落到应用内全屏，而不是假装成功）', async () => {
    const api = resolveFullscreenApi(standardDoc())

    await expect(api?.request({})).rejects.toThrow()
    await expect(
      resolveFullscreenApi({
        webkitFullscreenEnabled: true,
        webkitExitFullscreen: vi.fn(),
      })?.request({}),
    ).rejects.toThrow()
  })
})
