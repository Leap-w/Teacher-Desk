/**
 * 导入弹窗共用 UI 的数据形状（v3.5.0）。
 *
 * 为什么单独一个 .ts 而不是写在组件里：`<script setup>` **不允许 ES 模块导出**，
 * 类型放进去就得再拆一个 `<script>` 块；而五个弹窗都要引用这几个类型，
 * 与其每个组件导一遍，不如像 `layers.ts` 那样集中放一处。
 *
 * 这五个组件（ImportFileCard / ImportIntro / ImportStats / ImportHints / ImportPreviewTable）
 * 就是「导入弹窗长什么样」的唯一定义。座位导入是基准样式，其余四个弹窗照它对齐；
 * 新增第六个弹窗时直接用这几个组件，**不要**再抄一套 `.stat` / `.preview-table` 的样式——
 * v3.5.0 之前正是抄了五份，于是「统一样式」变成了改五遍。
 */

/** 一个统计格（值 + 标签，可选好/坏色调） */
export interface ImportStat {
  value: number | string
  label: string
  /** 好 = 绿（可导入）、坏 = 红（被拦 / 错误）；不传为中性色 */
  tone?: 'ok' | 'bad'
}

/**
 * 一条预览提示。warning = 需要教师动手，info = 只是告知，danger = 整体性失败
 * （文件读不了 / 表头缺列 / 表里没有数据行——这几种情况根本不进预览）。
 */
export interface ImportHint {
  tone: 'warning' | 'info' | 'danger'
  text: string
}

/** 预览表的一列 */
export interface ImportPreviewColumn {
  /** 对应 `ImportPreviewRow.cells` 里的键 */
  key: string
  label: string
  /** 允许换行（长文本列，如备注 / 状态说明）。默认所有列都不换行，横向滚动 */
  wrap?: boolean
}

/** 预览表的一行 */
export interface ImportPreviewRow {
  /** Excel 里的实际行号（含表头，1 起）——教师回表里核对时就按这个数字找 */
  rowNumber: number
  /** 与 `ImportPreviewTable` 的 actions 表对应，决定徽标文案与色调 */
  action: string
  /** 各列的显示文本。缺键或空串统一显示「—」 */
  cells: Record<string, string>
  /** 拦截原因 */
  errors: string[]
  /** 不拦截、只提示 */
  warnings: string[]
}

/** 每种 action 的徽标文案与色调 */
export interface ImportActionMeta {
  label: string
  /** ok = 绿、info = 主色、warn = 橙、bad = 红（同时决定整行是否标红） */
  tone: 'ok' | 'info' | 'warn' | 'bad'
}

/**
 * 「N 行被拦下」提示，**前几条直接点名**（行号 + 原因）。
 *
 * 为什么要有它：预览表的「状态」列在最右边，学生名单 12 列时表格必然横向滚动，
 * 于是「为什么这几行导不进来」正好落在看不见的地方。把前几条原因提到表**上方**的
 * 提示条里，教师不用横滚就知道该回 Excel 改哪几行。
 *
 * 参数刻意只要三个字段，好让**服务层的预览行**（`*ImportPreviewRow`）与
 * 本文件的 `ImportPreviewRow` 都能直接传进来，各弹窗不必先做一次映射。
 *
 * 超过 `max` 条只说总数——提示条不是错误清单，逐行明细在下面的表里。
 */
export function blockedHint(rows: readonly ImportErrorRow[], max = 3): ImportHint | undefined {
  const blocked = rows.filter((row) => row.action === 'blocked')
  if (blocked.length === 0) return undefined

  const head = blocked
    .slice(0, max)
    .map(
      (row) => `第 ${row.rowNumber} 行${row.errors.length ? `（${row.errors.join('、')}）` : ''}`,
    )
    .join('、')
  const more = blocked.length > max ? `，其余 ${blocked.length - max} 行见下表「状态」列` : ''

  return {
    tone: 'warning',
    text: `${blocked.length} 行被拦下不会导入：${head}${more}`,
  }
}

/** `blockedHint` 认的最小形状：预览行与解析行都满足 */
export interface ImportErrorRow {
  rowNumber: number
  action: string
  errors: readonly string[]
}
