/**
 * 座位图 .xlsx 的结构化数据格式（v3.7.6）。
 *
 * ## 为什么导出文件里要再放一份「机器可读」的数据
 *
 * 座位图导出的两张工作表（`学生视角` / `老师视角`）是**给人看和打印的**：
 * 格子里只有「张伟（3287）」这样的显示名，没有学号，也没有行列布局的说明。
 * 想把它重新导回系统，只能靠 OCR 或按模板坐标逐格猜——前者不可靠，后者一改模板就错。
 *
 * 所以从 v3.7.6 起，导出的 .xlsx 在**不影响原有版面的前提下**多带一张**隐藏工作表**
 * （`TeacherDesk座位数据`）：里面是完整的 63 个物理座位、学生学号 / 姓名 / 导出时显示名、
 * 行列布局、固定空位、方案信息和数据版本。导入时优先读它；旧版导出文件没有这张表，
 * 才退回按可视化版面识别。
 *
 * ## 为什么是「一张表」而不是塞进单元格批注 / 自定义属性
 *
 * 隐藏工作表在 Excel / WPS / Numbers 里都能原样保存，SheetJS 与 exceljs 也都能读；
 * 批注和自定义属性在「另存为」时各家实现不一，且更难人工核对。隐藏表还可以被教师
 * 临时取消隐藏后逐行查看——**它不是黑盒**。
 *
 * ## 版本纪律
 *
 * `SEAT_EXPORT_VERSION` 只描述这份隐藏数据的结构。将来字段变了就升版本，
 * 导入端遇到不认识的版本要**明确报错**，绝不猜着读。可视化版面与其它导出能力不受影响。
 */

/** 隐藏数据工作表的名字（Excel 工作表名上限 31 字符，这里 16 字符） */
export const SEAT_EXPORT_SHEET = 'TeacherDesk座位数据'

/**
 * 隐藏数据表的格式标识。
 *
 * 不能只看工作表名：教师可能自己建一张同名表。导入端要求这张表里的
 * `格式` 键恰好等于这个值，才按结构化数据解析。
 */
export const SEAT_EXPORT_FORMAT = 'teacherdesk-seat-plan'

/** 隐藏数据表的结构版本（与 package.json 的应用版本无关） */
export const SEAT_EXPORT_VERSION = 1

/** 可视化工作表名（按模板顺序；导入时两张都会用于交叉校验） */
export const SEAT_VISUAL_SHEETS = ['学生视角', '老师视角'] as const

/** 隐藏数据表里座位区表头（顺序即导出列序） */
export const SEAT_DATA_SEAT_HEADERS = ['排', '列', '学号', '姓名', '显示名'] as const

/**
 * 隐藏数据表里约束区表头。
 *
 * 约束引用学生时**只写学号与姓名**，不写学生 id：id 只在本机有效，换一台设备
 * （或清空数据后重导）就对不上；学号才是跨设备的身份依据，没有学号时再按姓名匹配，
 * 重名一律拦下——与现有行列导入同一条规则。
 */
export const SEAT_DATA_CONSTRAINT_HEADERS = [
  '约束类型',
  '学生1学号',
  '学生1姓名',
  '学生2学号',
  '学生2姓名',
  '学生3学号',
  '学生3姓名',
] as const

/** 约束区的四种类型文案（导出与导入共用一份，避免改一处漏一处） */
export const SEAT_DATA_CONSTRAINT_KINDS = {
  sameDesk: '不能同桌',
  adjacent: '三人不能相邻',
  front: '前排学生',
  back: '后排学生',
} as const

/** 列块数组 → 隐藏数据表里的 `3-3-3` 写法 */
export function blocksText(blocks: readonly number[]): string {
  return blocks.join('-')
}

/**
 * `3-3-3` → `[3, 3, 3]`。
 *
 * 只接受整数用非数字字符分隔的写法；`333` 这种会被当成一个 333，随后与列数对不上，
 * 导入端会给出「布局不一致」的明确错误，而不是悄悄按错误的块宽去排座。
 */
export function parseBlocksText(text: string): number[] | undefined {
  const parts = text
    .trim()
    .split(/[^0-9]+/)
    .filter(Boolean)
  if (parts.length === 0) return undefined
  const blocks = parts.map((part) => Number.parseInt(part, 10))
  if (blocks.some((value) => !Number.isInteger(value) || value <= 0)) return undefined
  return blocks
}
