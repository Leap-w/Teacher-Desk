import { appConfig } from '@/config'

/**
 * 版本更新日志（v3.7.7 起，**唯一维护位置**）。
 *
 * 每次版本升级：在 `RELEASE_NOTES` **最前面**加一条本版记录，`version` 与
 * `package.json` 的 `version` 完全一致（不带 `v`），`date` 写发布日期，`highlights` 写 2～4 条
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
  /** 应用版本号，不带 `v`（如 `3.8.1`） */
  version: string
  /** 发布日期（YYYY-MM-DD）；缺省时不显示日期，历史记录可保持原样 */
  date?: string
  /** 2～4 条用户能理解的更新内容 */
  highlights: readonly string[]
}

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: '3.8.1',
    date: '2026-11-14',
    highlights: [
      '「照片墙」改为班级管理中的独立页面，可按学生查看、上传照片、设置当前证件照和查看大图；照片仍默认保存在本机。',
      '新增「导出完整备份（含照片）」ZIP，可把文字数据与照片文件一起备份并在换设备后恢复；原来的 JSON 备份继续保留，但它只包含照片信息、不包含照片文件。',
      '学生档案新增宿舍管理：内置八项常用宿舍，也可输入任意自定义宿舍；支持批量修改和 Excel 导入，历史宿舍值会原样保留，修改性别不会影响宿舍。',
      '违纪管理改为更直接的事件记录：24 项系统预设、支持自定义事件与默认严重程度；取消类型分类，历史违纪记录、家长处理意见和个人违纪档案继续保留。',
    ],
  },
  {
    version: '3.8.0',
    highlights: [
      '新增「违纪管理」：按学生记录违纪事件，支持一次给多名学生批量登记、三级严重程度、学生违纪排行、经常违纪与严重事件查看，以及每名学生的个人违纪档案。',
      '新增「学生照片管理」：证件照与生活照分类、班级照片墙、大图查看，并可以把某张证件照设为当前证件照；已退档学生的历史照片仍可查看。',
      '照片默认保存在这台设备的本机；登录后会尝试同步到云端，照片卡片会如实显示「仅本机」「仅云端」「照片缺失」等状态（云端上传/下载链路尚需真实环境验收）。',
      '数据备份新增学生照片信息（分类、时间等），但备份文件不包含照片本身；更换设备后照片文件仍需从原云端重新获取。',
    ],
  },
  {
    version: '3.7.8',
    highlights: [
      '修复 macOS 桌面小组件连接失败的问题：连接时请选中 TeacherDesk 文件夹本身，选对后课程表会立即写入快照。',
      '修复桌面小组件数据不更新的问题：确认快照写入成功后才通知小组件刷新，改完课程表桌面会跟着变。',
      '已连接过的设备不用每次重选文件夹：浏览器重启后点一次「连接小组件」即可恢复授权。',
      '连接失败的提示更清楚了：会分别说明「没有授权」「选错了文件夹」和「写入失败」，并给出对应的处理办法。',
    ],
  },
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

/** 弹窗里展示的版本号文案：`V3.8.1` */
export const currentVersionLabel = `V${currentAppVersion.replace(/^v/i, '')}`

/** 当前版本对应的更新内容；没有配置记录时返回空数组（不编造内容） */
export function currentReleaseHighlights(): readonly string[] {
  return currentReleaseNote()?.highlights ?? []
}

/** 当前版本对应的更新记录；没有配置时返回 undefined（不编造内容） */
export function currentReleaseNote(): ReleaseNote | undefined {
  return RELEASE_NOTES.find((note) => note.version === currentAppVersion)
}

/** 当前版本发布日期；没有记录 / 旧记录没有 date 时返回 undefined */
export function currentReleaseDate(): string | undefined {
  return currentReleaseNote()?.date
}
