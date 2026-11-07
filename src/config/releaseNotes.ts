import { appConfig } from '@/config'

/**
 * 版本更新日志（v3.7.7 起，**唯一维护位置**）。
 *
 * 每次版本升级：在 `RELEASE_NOTES` **最前面**加一条本版记录，`version` 与
 * `package.json` 的 `version` 完全一致（不带 `v`），`highlights` 写 2～4 条
 * 普通教师能感知的变化——新增功能、重要优化、可感知的体验改进。
 *
 * **不写实现细节**：代码重构、文件改动、依赖升级都不属于用户看到的更新日志。
 * 弹窗只读这里，组件内不写死任何一条文案；当前版本没有对应记录时返回空数组，
 * 照常显示版本号但不虚构更新内容。
 *
 * 版本号本身仍以 `package.json` 为单一来源（vite 构建期读取），这里只按版本号
 * 查找对应的更新日志，不另存一份版本号。
 */
export interface ReleaseNote {
  /** 应用版本号，不带 `v`（如 `3.7.7`） */
  version: string
  /** 2～4 条用户能理解的更新内容 */
  highlights: readonly string[]
}

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: '3.7.7',
    highlights: [
      '新增版本信息展示功能，可在「我的」页面查看当前版本及本次更新内容。',
      '优化座位图导出文件命名，支持使用座位方案名称作为文件名。',
      '优化部分界面交互及细节体验。',
    ],
  },
]

/** 当前版本号（package.json 单一来源，不带 `v`） */
export const currentAppVersion = appConfig.version

/** 弹窗里展示的版本号文案：`V3.7.7` */
export const currentVersionLabel = `V${currentAppVersion.replace(/^v/i, '')}`

/** 当前版本对应的更新内容；没有配置记录时返回空数组（不编造内容） */
export function currentReleaseHighlights(): readonly string[] {
  return RELEASE_NOTES.find((note) => note.version === currentAppVersion)?.highlights ?? []
}
