/**
 * 照片展示层自检（v3.8.3 Phase 1）。
 *
 * 项目不装 jsdom，组件的实际 CSS 无法在 node 里渲染；这里用**源码级断言**
 * 钉住那些「改动一行就静默回退」的约定：三处缩略图统一走 3:4 令牌 + cover，
 * 大图仍用 contain 且不读位置配置，位置配置不进业务数据 / 同步。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

function sourceOf(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8')
}

/**
 * 源码级断言先剥注释：注释里提到关键词会误伤 not.toContain。
 * 块注释起始符前面必须是行首或空白——否则模板里的 `accept="image/*"` 会被当成
 * 注释开头，一路吞到后面真正的注释结尾，把整段模板（含被测的绑定）吃掉。
 */
function stripComments(source: string): string {
  return source.replace(/(^|\s)\/\*[\s\S]*?\*\//g, '$1').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const WALL = stripComments(sourceOf('views/Photos/index.vue'))
const TILE = stripComments(sourceOf('views/Students/components/StudentPhotoTile.vue'))
const MANAGER = stripComments(sourceOf('views/Students/components/StudentPhotoManager.vue'))
const VIEWER = stripComments(sourceOf('views/Students/components/StudentPhotoViewer.vue'))
const EDITOR = stripComments(sourceOf('components/PhotoPositionEditor.vue'))
const THEME = stripComments(sourceOf('styles/theme.css'))
const PHOTO_TYPE = stripComments(sourceOf('types/studentPhoto.ts'))
const POSITION_UTIL = stripComments(sourceOf('utils/photoThumbPosition.ts'))
const POSITION_STORAGE = stripComments(sourceOf('services/photoThumbPositionStorage.ts'))
const POSITION_COMPOSABLE = stripComments(sourceOf('composables/usePhotoThumbPosition.ts'))

describe('统一 3:4：三处缩略图共用同一令牌', () => {
  it('令牌本体就是 3:4 + 偏上取景', () => {
    expect(THEME).toContain('--photo-thumb-ratio: 3 / 4')
    expect(THEME).toContain('--photo-thumb-position: 50% 30%')
  })

  it('照片墙、管理弹窗卡片、当前证件照缩略图都引用共享比例令牌', () => {
    for (const [name, src] of [
      ['照片墙', WALL],
      ['照片卡片', TILE],
      ['当前证件照', MANAGER],
    ] as const) {
      expect(src, name).toContain('aspect-ratio: var(--photo-thumb-ratio)')
      expect(src, name).toContain('object-fit: cover')
      expect(src, name).toContain('object-position: var(--photo-thumb-position)')
    }
  })

  it('当前证件照不再写死 96×120', () => {
    expect(MANAGER).not.toContain('height: 120px')
  })

  it('缩略图卡片的比例 / 取景没有第二份硬编码', () => {
    expect(TILE).not.toContain('4 / 3')
    expect(WALL).not.toContain('aspect-ratio: 3 / 4')
  })

  it('卡片占满各自网格列（button 的 width:auto 会按 fit-content 收缩）', () => {
    // v3.8.3：无照片的占位卡片曾缩到 105px，与有照片的 157px 参差
    expect(WALL, '照片墙 .wall-card').toMatch(/\.wall-card\s*\{[^}]*width:\s*100%/)
    expect(TILE, '卡片 .photo-tile').toMatch(/\.photo-tile\s*\{[^}]*width:\s*100%/)
  })

  it('调整面板的预览框宽度同时受高度约束，不会把 3:4 压扁', () => {
    // 只写 max-height 时高度先被夹、宽度不回缩；横屏手机实测比例 1.28
    expect(EDITOR).toContain('calc(60vh * 3 / 4)')
    expect(EDITOR).not.toContain('max-height: 60vh')
  })
})

/**
 * 按选择器取出某条 CSS 规则的声明块，供逐条断言。
 * 只写 `aspect-ratio: 3 / 4` 是不够的（v3.8.3 Phase 4 实测：比例 < 0.75 的照片
 * 会把媒体区顶高），所以必须能单独检查「同一个规则块里还有没有别的约束」。
 */
function ruleOf(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source)?.[1]
  expect(block, `找不到 ${selector} 的规则块`).toBeTruthy()
  return (block ?? '').replace(/\s+/g, ' ')
}

describe('瘦长图不再撑开媒体区（比例必须靠自身约束守住）', () => {
  it('照片墙媒体区同时有 3:4 与「切断内容撑高」的约束', () => {
    const rule = ruleOf(WALL, '.wall-media')
    expect(rule).toContain('aspect-ratio: var(--photo-thumb-ratio)')
    expect(rule).toContain('overflow: hidden')
  })

  it('照片卡片媒体区同样同时具备两条约束', () => {
    const rule = ruleOf(TILE, '.photo-tile__media')
    expect(rule).toContain('aspect-ratio: var(--photo-thumb-ratio)')
    expect(rule).toContain('overflow: hidden')
  })

  it('三处媒体区口径一致：当前证件照与调整面板同样是 3:4 + overflow 切断', () => {
    expect(ruleOf(MANAGER, '.current-thumb')).toContain('overflow: hidden')
    expect(ruleOf(EDITOR, '.editor-stage')).toContain('overflow: hidden')
  })

  it('图片本身仍按 cover 裁切，未被改成 contain / 固定尺寸', () => {
    expect(ruleOf(WALL, '.wall-img')).toContain('object-fit: cover')
    expect(ruleOf(TILE, '.photo-tile__img')).toContain('object-fit: cover')
  })
})

describe('手动位置配置：接线完整且范围可控', () => {
  it('三处缩略图都按 photoId 应用 object-position', () => {
    expect(WALL).toContain('objectPositionOf(row.currentPhoto.id)')
    expect(TILE).toContain('objectPosition ? { objectPosition } : undefined')
    expect(MANAGER).toContain('objectPositionOf(currentPhoto.id)')
    expect(MANAGER).toContain(':object-position="objectPositionOf(photo.id)"')
  })

  it('照片墙卡片不再有「调整位置」入口（v3.8.3 调整：已迁到照片详情页）', () => {
    expect(WALL).not.toContain('class="wall-adjust"')
    expect(WALL).not.toContain('openPosition(')
    expect(WALL).not.toContain('<PhotoPositionEditor')
  })

  it('照片详情页提供「调整缩略图位置」，复用同一个编辑面板', () => {
    expect(VIEWER).toContain('调整缩略图位置')
    expect(VIEWER).toContain('<PhotoPositionEditor')
    expect(VIEWER).toContain('@click="openPosition"')
    expect(VIEWER).toContain(':photo="editorPhoto"')
    expect(VIEWER).toContain(':thumb-url="editorUrl"')
  })

  it('详情页的编辑状态可被安全丢弃：切换照片 / 关闭 / 卸载都会重置', () => {
    // 三处 resetEditor：currentId 变化、modelValue 关闭、onBeforeUnmount
    expect(VIEWER.match(/resetEditor\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(VIEWER).toContain('watch(currentId')
    // 面板关闭后清掉编辑对象，下一张照片不会串用
    expect(VIEWER).toContain('watch(editorOpen')
  })

  it('详情页不直接读写本机位置存储，编辑面板是唯一写入口', () => {
    expect(VIEWER).not.toContain('localStorage')
    expect(VIEWER).not.toContain('photoWall:display')
    expect(VIEWER).not.toContain('usePhotoThumbPosition')
  })

  it('照片墙入口改为「批量管理」，导入与删除都收进管理模式', () => {
    expect(WALL).toContain('批量管理')
    expect(WALL).toContain('批量删除')
    expect(WALL).toContain('退出管理')
    expect(WALL).toContain('已选 {{ selectedCount }} 张照片')
    expect(WALL).toContain('usePhotoBatchManage')
    expect(WALL).toContain(':disabled="!hasSelection || deleting"')
    // 批量导入能力原样复用，只是入口搬进管理模式
    expect(WALL).toContain('PhotoImportModal')
  })

  it('批量选择只落在当前可见的照片上（搜索过滤后自动取消）', () => {
    expect(WALL).toContain('const visiblePhotoIds = computed')
    expect(WALL).toContain('usePhotoBatchManage(() => visiblePhotoIds.value)')
  })

  it('删除文案：不写「逻辑删除」，明确云端文件暂时保留、应用内不提供恢复', () => {
    expect(WALL).not.toContain('逻辑删除')
    expect(WALL).toContain('应用内不提供恢复')
    expect(WALL).toContain('本次不会删除云端文件')
  })

  it('批量删除的提示按「成功 / 已在别处删除 / 失败」分开计数', () => {
    // skipped 绝不能并进成功数：成功文案只读 result.removed
    expect(WALL).toContain('已永久删除 ${result.removed.length} 张照片')
    expect(WALL).toContain('已在其他标签页或设备删除')
    expect(WALL).toContain('部分删除失败：${parts.join')
    expect(WALL).not.toContain('已永久删除 ${result.skipped')
  })

  it('调整面板提供拖动、保存、取消、恢复默认，但没有任何图像改写 / 识别', () => {
    for (const token of [
      '@pointerdown',
      '@pointermove',
      '@pointerup',
      'setPosition(props.photo.id',
      'resetPosition(props.photo.id)',
      '>保存</AppButton>',
      '>取消</AppButton>',
      '>恢复默认</AppButton>',
      'touch-action: none',
    ]) {
      expect(EDITOR, token).toContain(token)
    }
    expect(EDITOR).not.toContain('canvas')
    expect(EDITOR).not.toContain('createObjectURL')
    expect(EDITOR).not.toContain('FaceDetector')
    expect(EDITOR).not.toContain('getUserMedia')
    // 位移换算必须走 utils 的纯函数，别在组件里再写一份（那份无法单测）
    expect(EDITOR).toContain('positionAfterDrag')
    expect(EDITOR).toContain('coverSlackOf')
  })

  it('全链路不出现人脸识别 / 自动身份匹配', () => {
    const forbidden =
      /FaceDetector|getUserMedia|detectFace|人脸识别|人脸检测|人脸定位|主体识别|自动识别/is
    for (const [name, src] of [
      ['照片墙', WALL],
      ['卡片', TILE],
      ['管理弹窗', MANAGER],
      ['调整面板', EDITOR],
      ['位置工具', POSITION_UTIL],
    ] as const) {
      expect(src, name).not.toMatch(forbidden)
    }
  })
})

describe('边界：位置配置不进入业务数据与同步', () => {
  it('独立键独立于 studentPhotos，且不注册同步', () => {
    const all = POSITION_UTIL + POSITION_STORAGE + POSITION_COMPOSABLE
    expect(POSITION_UTIL).toContain(':photoWall:display')
    expect(all).not.toContain('teacherdesk:studentPhotos')
    expect(all).not.toContain('syncPersisted')
    expect(all).not.toContain('CloudBase')
    expect(all).not.toContain('localStorage.setItem')
  })

  it('StudentPhoto 数据结构没有被加展示字段', () => {
    expect(PHOTO_TYPE).not.toContain('objectPosition')
    expect(PHOTO_TYPE).not.toContain('thumbPosition')
    expect(PHOTO_TYPE).not.toContain('crop')
  })

  it('大图预览仍是原图 contain，且完全不读位置配置', () => {
    expect(VIEWER).toContain('object-fit: contain')
    expect(VIEWER).toContain('store.getPhotoBlob(photo.id)')
    expect(VIEWER).not.toContain('object-position')
    expect(VIEWER).not.toContain('usePhotoThumbPosition')
    expect(VIEWER).not.toContain('objectPosition')
  })
})
