/**
 * 缩略图展示位置自检（v3.8.3 Phase 1）。
 *
 * 测三件事：
 * 1. 纯函数的钳制 / 解析 / 合并 / 删除（不碰浏览器）；
 * 2. 落盘层用 `services/storage.ts` 单键读写，非法数据能安全回退；
 * 3. composable 的共享状态：同一 photoId 在两处调用拿到同一份结果，
 *    写失败时不更新内存、不假装成功。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { usePhotoThumbPosition } from '@/composables/usePhotoThumbPosition'
import {
  loadPhotoThumbPositions,
  removePhotoThumbPosition,
  savePhotoThumbPosition,
} from '@/services/photoThumbPositionStorage'
import {
  clampPercent,
  coverSlackOf,
  cssPositionOf,
  DEFAULT_PHOTO_THUMB_POSITION,
  normalizePosition,
  parsePositionMap,
  PHOTO_THUMB_POSITION_KEY,
  positionAfterDrag,
  positionOf,
} from '@/utils/photoThumbPosition'

let browser: FakeBrowser

beforeEach(() => {
  browser = installFakeBrowser()
  // 共享 ref 是模块级的；每次从新盘重读，避免用例之间串味
  usePhotoThumbPosition().reload()
})

describe('纯函数：默认值与钳制', () => {
  it('默认位置是偏上的 50% 30%，无配置时一律回退到它', () => {
    expect(DEFAULT_PHOTO_THUMB_POSITION).toEqual({ x: 50, y: 30 })
    expect(positionOf({}, 'p1')).toEqual({ x: 50, y: 30 })
    expect(cssPositionOf(DEFAULT_PHOTO_THUMB_POSITION)).toBe('50% 30%')
  })

  it('x / y 都钳到 0–100；负数、超界、NaN、字符串一律处理正确', () => {
    expect(clampPercent(-20)).toBe(0)
    expect(clampPercent(150)).toBe(100)
    expect(clampPercent(42.5)).toBe(42.5)
    expect(clampPercent(Number.NaN)).toBeNull()
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBeNull()
    expect(clampPercent('50')).toBeNull()
    expect(normalizePosition({ x: -1, y: 999 })).toEqual({ x: 0, y: 100 })
    expect(normalizePosition({ x: 10 })).toBeNull()
    expect(normalizePosition('nope')).toBeNull()
  })
})

describe('解析盘上原文：坏数据不崩溃', () => {
  it('非法 JSON / 非对象 / 数组全部当作没有配置', () => {
    expect(parsePositionMap('not json')).toEqual({})
    expect(parsePositionMap('null')).toEqual({})
    expect(parsePositionMap('[]')).toEqual({})
    expect(parsePositionMap(null)).toEqual({})
  })

  it('个别条目坏掉只丢那几条，好条目原样保留并钳制', () => {
    const parsed = parsePositionMap(
      JSON.stringify({
        good: { x: 12, y: 34 },
        tooFar: { x: 300, y: -5 },
        missingY: { x: 10 },
        textX: { x: '50', y: 20 },
        nope: null,
      }),
    )
    expect(parsed).toEqual({ good: { x: 12, y: 34 }, tooFar: { x: 100, y: 0 } })
  })
})

describe('落盘层：独立键、单张隔离、恢复默认', () => {
  it('保存后能从独立键读回；不写进照片业务键', () => {
    expect(savePhotoThumbPosition('p1', { x: 70, y: 20 })).toBe(true)
    expect(loadPhotoThumbPositions()).toEqual({ p1: { x: 70, y: 20 } })
    expect(JSON.parse(browser.localStorage.getItem(PHOTO_THUMB_POSITION_KEY) ?? '{}')).toEqual({
      p1: { x: 70, y: 20 },
    })
    expect(browser.localStorage.getItem('teacherdesk:studentPhotos')).toBeNull()
  })

  it('每张照片互不影响；恢复默认只删这一张', () => {
    savePhotoThumbPosition('p1', { x: 10, y: 20 })
    savePhotoThumbPosition('p2', { x: 80, y: 60 })
    expect(removePhotoThumbPosition('p1')).toBe(true)
    expect(loadPhotoThumbPositions()).toEqual({ p2: { x: 80, y: 60 } })
    // 重复删除是无害空操作
    expect(removePhotoThumbPosition('p1')).toBe(true)
    expect(loadPhotoThumbPositions()).toEqual({ p2: { x: 80, y: 60 } })
  })

  it('读取坏 JSON 时界面拿到默认，不抛异常', () => {
    browser.localStorage.seed(PHOTO_THUMB_POSITION_KEY, '{broken')
    const api = usePhotoThumbPosition()
    api.reload()
    expect(api.positionOfPhoto('p1')).toEqual({ x: 50, y: 30 })
    expect(api.objectPositionOf('p1')).toBe('50% 30%')
  })
})

describe('composable：共享状态与失败反馈', () => {
  it('两个调用点共享同一份配置（照片墙与管理弹窗一致）', () => {
    const wall = usePhotoThumbPosition()
    const manager = usePhotoThumbPosition()
    expect(wall.setPosition('p1', 30, 40)).toBe(true)
    expect(manager.positionOfPhoto('p1')).toEqual({ x: 30, y: 40 })
    expect(manager.objectPositionOf('p1')).toBe('30% 40%')
    expect(manager.resetPosition('p1')).toBe(true)
    expect(wall.positionOfPhoto('p1')).toEqual({ x: 50, y: 30 })
  })

  it('保存失败时返回 false，且内存不更新（不假装保存成功）', () => {
    // 先有一条真实配置，才能保证「恢复默认」确实需要写盘（否则空操作本就该成功）
    browser.localStorage.seed(PHOTO_THUMB_POSITION_KEY, JSON.stringify({ p1: { x: 10, y: 20 } }))
    const api = usePhotoThumbPosition()
    api.reload()
    expect(api.positionOfPhoto('p1')).toEqual({ x: 10, y: 20 })
    // 保留读、让写抛异常：模拟配额耗尽 / 隐私模式
    const original = browser.localStorage
    Object.defineProperty(browser.window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => original.getItem(key),
        setItem: () => {
          throw new Error('quota exceeded')
        },
        removeItem: () => {
          throw new Error('quota exceeded')
        },
      },
    })
    try {
      expect(api.setPosition('p1', 90, 10)).toBe(false)
      expect(api.positionOfPhoto('p1')).toEqual({ x: 10, y: 20 })
      expect(api.resetPosition('p1')).toBe(false)
      expect(api.positionOfPhoto('p1')).toEqual({ x: 10, y: 20 })
    } finally {
      Object.defineProperty(browser.window, 'localStorage', {
        configurable: true,
        value: original,
      })
    }
  })

  it('localStorage 完全不可用时读回默认、写返回 false', () => {
    Object.defineProperty(browser.window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('blocked')
        },
      },
    })
    const api = usePhotoThumbPosition()
    api.reload()
    expect(api.positionOfPhoto('p1')).toEqual({ x: 50, y: 30 })
    expect(api.setPosition('p1', 10, 20)).toBe(false)
  })
})

/**
 * 拖动换算（v3.8.3 从调整面板抽出的纯逻辑）。
 *
 * 期望值不是「照着实现写的」：Phase 2 已在真实 Chrome 里用双色图量过分界像素，
 * 确认 offset = -slack × P/100（300×400 框、800×400 图，X=50% 时分界正好在 150 列；
 * Y=0/30/100% 时分别在 300/240/100 行）。这里用同一关系推期望值。
 */
describe('拖动换算：cover 余量', () => {
  it('横图 800×400 放进 300×400：只有横向余量 500，纵向为 0', () => {
    expect(coverSlackOf(300, 400, 800, 400)).toEqual({ x: 500, y: 0 })
  })

  it('竖图 400×800 放进 300×400：只有纵向余量 200', () => {
    expect(coverSlackOf(300, 400, 400, 800)).toEqual({ x: 0, y: 200 })
  })

  it('方图 1000×1000 放进 3:4 的 300×400：只有横向余量 100', () => {
    expect(coverSlackOf(300, 400, 1000, 1000)).toEqual({ x: 100, y: 0 })
  })

  it('本身 3:4 的图放进 3:4 的框：两个方向都没有余量', () => {
    expect(coverSlackOf(300, 400, 900, 1200)).toEqual({ x: 0, y: 0 })
  })

  it('尺寸非法（0 / 负数 / NaN）时余量为 0，不会算出 NaN 或 Infinity', () => {
    expect(coverSlackOf(0, 400, 800, 400)).toEqual({ x: 0, y: 0 })
    expect(coverSlackOf(300, 400, 0, 0)).toEqual({ x: 0, y: 0 })
    expect(coverSlackOf(Number.NaN, 400, 800, 400)).toEqual({ x: 0, y: 0 })
  })
})

describe('拖动换算：位移 → 新位置', () => {
  const wide = coverSlackOf(300, 400, 800, 400)
  const tall = coverSlackOf(300, 400, 400, 800)
  const square = coverSlackOf(300, 400, 1000, 1000)

  it('横图向右拖半个余量（250px）：x 减 50，图片跟着手指往右；y 不受影响', () => {
    expect(positionAfterDrag({ x: 50, y: 30 }, { dx: 250, dy: 999 }, wide)).toEqual({ x: 0, y: 30 })
  })

  it('横图向左拖 100px：x 加 20（反方向同样正确）', () => {
    expect(positionAfterDrag({ x: 40, y: 30 }, { dx: -100, dy: -999 }, wide)).toEqual({
      x: 60,
      y: 30,
    })
  })

  it('竖图向下拖半个余量（100px）：y 减 50，x 不受影响', () => {
    expect(positionAfterDrag({ x: 50, y: 80 }, { dx: 500, dy: 100 }, tall)).toEqual({
      x: 50,
      y: 30,
    })
  })

  it('竖图向上拖 100px：y 加 50', () => {
    expect(positionAfterDrag({ x: 50, y: 20 }, { dx: 0, dy: -100 }, tall)).toEqual({ x: 50, y: 70 })
  })

  it('方图只能横向动：拖 50px 等于半个余量', () => {
    expect(positionAfterDrag({ x: 50, y: 30 }, { dx: 50, dy: 300 }, square)).toEqual({
      x: 0,
      y: 30,
    })
  })

  it('起始位置不是 50% 时按同一公式换算（80% 右拖 100px → 60%）', () => {
    expect(positionAfterDrag({ x: 80, y: 30 }, { dx: 100, dy: 0 }, wide)).toEqual({ x: 60, y: 30 })
  })

  it('零余量轴原样保留，不会除零', () => {
    expect(positionAfterDrag({ x: 33, y: 77 }, { dx: 500, dy: -500 }, { x: 0, y: 0 })).toEqual({
      x: 33,
      y: 77,
    })
  })

  it('拖出边界时钳在 0–100', () => {
    expect(positionAfterDrag({ x: 90, y: 30 }, { dx: -1000, dy: 0 }, wide)).toEqual({
      x: 100,
      y: 30,
    })
    expect(positionAfterDrag({ x: 10, y: 30 }, { dx: 1000, dy: 0 }, wide)).toEqual({ x: 0, y: 30 })
  })

  it('位移不是有限值时退回起始位置', () => {
    expect(positionAfterDrag({ x: 50, y: 30 }, { dx: Number.NaN, dy: 0 }, wide)).toEqual({
      x: 50,
      y: 30,
    })
  })
})

describe('特殊键安全：__proto__ 不污染原型', () => {
  it('盘上出现 "__proto__" 时得到的是无原型对象，且不污染 Object.prototype', () => {
    const parsed = parsePositionMap('{"__proto__":{"x":11,"y":22},"p1":{"x":60,"y":40}}')
    expect(Object.getPrototypeOf(parsed)).toBeNull()
    expect(parsed.p1).toEqual({ x: 60, y: 40 })
    // 全局原型没有被写入
    expect(({} as Record<string, unknown>).x).toBeUndefined()
    expect(Object.keys(parsed).sort()).toEqual(['__proto__', 'p1'])
  })

  it('查 constructor / toString / __proto__ 不会顺着原型链取到东西', () => {
    const map = parsePositionMap(JSON.stringify({ p1: { x: 10, y: 20 } }))
    expect(positionOf(map, 'constructor')).toEqual({ x: 50, y: 30 })
    expect(positionOf(map, 'toString')).toEqual({ x: 50, y: 30 })
    expect(positionOf(map, '__proto__')).toEqual({ x: 50, y: 30 })
  })

  it('带 __proto__ 的盘上数据不会影响其他照片的读写', () => {
    browser.localStorage.seed(
      PHOTO_THUMB_POSITION_KEY,
      '{"__proto__":{"x":11,"y":22},"p2":{"x":70,"y":10}}',
    )
    const api = usePhotoThumbPosition()
    api.reload()
    expect(api.positionOfPhoto('p2')).toEqual({ x: 70, y: 10 })
    expect(api.setPosition('p3', 20, 80)).toBe(true)
    const after = loadPhotoThumbPositions()
    expect(after.p2).toEqual({ x: 70, y: 10 })
    expect(after.p3).toEqual({ x: 20, y: 80 })
  })
})
