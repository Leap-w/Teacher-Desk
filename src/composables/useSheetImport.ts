/**
 * Excel 导入的文件读取管道（v3.5.0）。
 *
 * 五个导入弹窗（学生 / 座位 / 课程表 / 工作清单 / 值日）**比长得像更重复的是这一段**：
 * `fileInput` ref、体积上限、文件名与工作表说明、整体性错误的落点、以及
 * 「input 选文件」与「拖入上传卡的文件」两条入口走同一条解析路径——
 * v3.5.0 之前这四十来行在五个文件里各抄一份，连 `pickFile` 都是逐字节相同的
 * （§11 的体检脚本会把它们逐个点名）。
 *
 * 分界线：**本层只管「文件 → 行」，不认识任何业务**。
 * 「行 → 计划」由各弹窗通过 `parse` 回调自己算——因为它们的形状不一样：
 * 座位 / 学生要的是 **computed**（依赖 store，别处改了数据预览数字得跟着重算），
 * 课程 / 工作 / 值日要的是「读一次算一次」的 ref。把它们硬塞进同一个形状，
 * 就得在通用层里塞一个 `reactive` 开关，比重复更难懂。
 */
import { ref } from 'vue'
import type { Ref } from 'vue'

import { readSheetRows, readWorkbookSheets } from '@/services/studentImport'
import type { ReadWorkbookResult } from '@/services/studentImport'

/** 一份名单 / 座位表撑死几百行，超过这个体积的多半是选错了文件 */
const MAX_FILE_BYTES = 5 * 1024 * 1024

/** `parse` 回调的返回值：`ok: false` 表示整体性问题，不进预览 */
export interface SheetParseOutcome {
  ok: boolean
  /** 整体性错误文案（表头缺列 / 表里没有数据行） */
  error?: string
  /** 表头识别到的列，预览上方显示「识别到 N 列」 */
  columns?: readonly string[]
  /**
   * 覆盖默认的「已读取第一个工作表「X」」说明。
   *
   * v3.7.6：座位图导出文件的结构化数据在**隐藏工作表**里，读的不是第一个工作表，
   * 默认说明会误导教师。解析器可以在这里说明「读到的是哪种数据」。
   */
  sheetNote?: string
}

export interface UseSheetImportOptions {
  /**
   * 隐藏 file input 的模板 ref，**由弹窗自己声明**。
   * 不由本层创建：那样弹窗只能写成 `const fileInput = sheet.fileInput`，
   * 而 `<script setup>` 的模板 ref 绑定要靠编译器静态识别「这是个 ref」——
   * 从函数返回值里拿到的绑定它认不出来，`ref="fileInput"` 会静默失效（点了没反应）。
   */
  fileInput: Ref<HTMLInputElement | undefined>
  /** 体积超限提示里的宾语（「请确认选的是**班级名单**」） */
  noun: string
  /** 解析 + 计算计划；**自己把结果写进弹窗的 ref**，本层不关心计划长什么样 */
  parse: (rows: unknown[][]) => SheetParseOutcome
  /**
   * 先按整个工作簿识别（v3.7.6，座位图导出文件用）。
   *
   * 返回 `undefined` = 「这不是我这层要的特殊格式」，本层继续拿第一个工作表交给 `parse`，
   * 老的行列列表导入行为不变。返回 outcome = 已识别（成功或失败），不再走 `parse`。
   *
   * 设置为回调后本层会读整个工作簿（含隐藏表）；没设置的四个导入弹窗仍然只读第一个
   * 工作表——不为用不到的能力多付一次全表解析。
   */
  parseWorkbook?: (workbook: ReadWorkbookResult) => SheetParseOutcome | undefined
  /** 每次读文件前与关弹窗时清场（各弹窗清掉自己的计划与预览状态） */
  reset?: () => void
}

export function useSheetImport(options: UseSheetImportOptions) {
  const fileInput = options.fileInput
  /** 读取 / 解析中（按钮禁用、上传卡显示「读取中…」） */
  const busy = ref(false)
  const filename = ref('')
  /** 工作表说明（文件里有多个工作表时要说清读了哪一个） */
  const sheetNote = ref('')
  /** 整体性错误：文件读不了、表头缺列、表里没有数据行——这些情况下不进预览 */
  const error = ref('')
  /** 识别到的列（预览上方「识别到 N 列」） */
  const columns = ref<string[]>([])

  function pickFile(): void {
    fileInput.value?.click()
  }

  /** 选同一个文件两次也要能触发 change，所以每次读完都把 input 清空 */
  async function onFilePicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    await readFile(file)
  }

  /** 默认的工作表说明：文件里有多个表时要说清「读了哪一个」 */
  function noteOfFirstSheetCount(sheetCount: number, sheetName: string): string {
    return sheetCount > 1
      ? `已读取第一个工作表「${sheetName}」，文件共 ${sheetCount} 个工作表`
      : `工作表「${sheetName}」`
  }

  /** UI-4B：拖入上传卡的文件与 input 选出的文件走同一条解析路径 */
  async function readFile(file: File): Promise<void> {
    clear()
    if (file.size > MAX_FILE_BYTES) {
      error.value = `文件超过 ${MAX_FILE_BYTES / 1024 / 1024} MB，请确认选的是${options.noun}`
      return
    }

    busy.value = true
    try {
      const buffer = await file.arrayBuffer()

      /*
       * v3.7.6：座位导入要先看整个工作簿（结构化数据在隐藏表里）。
       * 只有显式提供 `parseWorkbook` 的弹窗走这条；其余四个仍走 `readSheetRows`，
       * 行为与开销都没有变化。
       */
      if (options.parseWorkbook) {
        const read = await readWorkbookSheets(buffer)
        if (!read.ok) {
          error.value = read.error
          return
        }
        const { sheetNames, sheets } = read.workbook
        const firstSheet = sheetNames[0] ?? ''
        const defaultNote = noteOfFirstSheetCount(sheetNames.length, firstSheet)
        filename.value = file.name

        const workbookOutcome = options.parseWorkbook(read.workbook)
        if (workbookOutcome) {
          sheetNote.value = workbookOutcome.sheetNote ?? defaultNote
          if (!workbookOutcome.ok) {
            error.value = workbookOutcome.error ?? '表格内容无法识别'
            return
          }
          columns.value = [...(workbookOutcome.columns ?? [])]
          return
        }

        // 不是导出文件 → 按原来的行列列表口径读第一个工作表
        sheetNote.value = defaultNote
        const outcome = options.parse(sheets.get(firstSheet) ?? [])
        if (!outcome.ok) {
          error.value = outcome.error ?? '表格内容无法识别'
          return
        }
        columns.value = [...(outcome.columns ?? [])]
        return
      }

      const sheet = await readSheetRows(buffer)
      if (!sheet.ok) {
        error.value = sheet.error
        return
      }
      filename.value = file.name
      sheetNote.value = noteOfFirstSheetCount(sheet.sheetCount, sheet.sheetName)

      const outcome = options.parse(sheet.rows)
      if (!outcome.ok) {
        error.value = outcome.error ?? '表格内容无法识别'
        return
      }
      columns.value = [...(outcome.columns ?? [])]
    } catch (caught) {
      error.value =
        caught instanceof Error && caught.message ? caught.message : '读取文件失败，请重试'
    } finally {
      busy.value = false
    }
  }

  /** 清场：下次打开是一张干净的表，也不残留上次的预览结论 */
  function clear(): void {
    filename.value = ''
    sheetNote.value = ''
    error.value = ''
    columns.value = []
    if (fileInput.value) fileInput.value.value = ''
    options.reset?.()
  }

  return {
    fileInput,
    busy,
    filename,
    sheetNote,
    error,
    columns,
    pickFile,
    onFilePicked,
    readFile,
    clear,
  }
}
