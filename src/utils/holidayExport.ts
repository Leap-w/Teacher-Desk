/**
 * 假期名单导出（v3.6.2，规格第 7 节）——**纯函数**，与 `fundExport.ts` 沿同一条切法：
 * 本文件只负责「名单 → 表格行」，不碰 DOM、不碰 store，因此能在 node 自检里直接喂数组跑；
 * 「字节 → 下载」那一半留到页面（`HolidayDetail.vue` 的 `runExport`）。
 *
 * 合起来写就只能在浏览器里点着试，而「未填的亲属栏到底写不写『无』」这类错，
 * 恰恰是点不出来的——屏幕上看着都是空白。
 */
import { HOLIDAY_STATUS_LABELS } from '@/utils/holiday'
import type { HolidayRosterRow } from '@/utils/holidayQuery'
import { familyScopeLabel, formatStudentShortName, hasChangduRelativeLabel } from '@/utils/student'
import type { XlsxSheetInput } from '@/utils/xlsxBook'

/** 导出的两种口径：当前筛选结果 / 该假期全部在读学生 */
export type HolidayExportScope = 'current' | 'all'

/**
 * 表头（列序即此序）。
 *
 * 「家庭所在地」写的是**返家范围**（昌都市区 / 其他县 / 市外），不是家庭地址全文：
 * 地址全文能长到三四十字，一列塞进 Excel 会把别的列全挤没，而班主任要按它分组时
 * 看的就是那个范围。要看全文请在档案里看。
 */
export const HOLIDAY_EXPORT_HEADERS = [
  '序号',
  '姓名',
  '性别',
  '学号',
  '家庭所在地',
  '昌都市内亲属',
  '亲戚关系',
  '假期去向',
  '备注',
] as const

/**
 * 名单 → 工作表。
 *
 * 三处空值口径，逐条都有测试钉着（`holidayExport.test.ts`）：
 * - **昌都市内亲属**：`undefined` 写空串，**绝不写「无」**。教师扫一眼这一列，
 *   空格 = 还没问过、要去问，「无」= 问过了、确实没有。写成「无」等于替他回答了没问过的问题。
 * - **亲戚关系**：只在 `hasChangduRelative === true` 时写。数据层已保证「无」时该字段不存在
 *   （`normalizeStudent` 的收敛），这里再挡一次是为了**导出这条路径本身**也不依赖那条不变式——
 *   导出的表可能会被打印、发给别人，自相矛盾的数据一旦印出来就收不回了。
 * - **假期去向**：二态全写（离校 / 留校）。v3.6.2 之后**不存在第三种去向**：
 *   没有登记回家的学生就是留校，表里照写「留校」，不再有「未登记」这一格。
 *
 * **「备注」这一列写的是学生档案里的备注（`Student.remark`），不是 v3.6.2 新增的
 * 学生级假期备注**：列序是 v3.6.1 定下的九列，本版只做必要的口径适配，不新增 / 不调列。
 * 假期备注在名单上逐行显示（`HolidayRosterList`），要随身带走请用名单本身。
 *
 * 姓名用短名（重名带身份证尾号），与页面上看到的**逐字一致**：教师拿纸质表点名时,
 * 表上的名字和屏幕上的名字对不上是最容易出错的地方。规则直接复用
 * `formatStudentShortName`（全站唯一那一份），重名表由调用方给——它决定「谁算重名」，
 * 与档案页同一个依据。
 */
export function buildHolidayRosterSheet(
  holidayName: string,
  rows: readonly HolidayRosterRow[],
  nameCounts: ReadonlyMap<string, number>,
): XlsxSheetInput {
  return {
    sheetName: holidayName,
    headers: HOLIDAY_EXPORT_HEADERS,
    rows: rows.map((row, index) => {
      const student = row.student
      return [
        index + 1,
        formatStudentShortName(student, nameCounts),
        student.gender === 'male' ? '男' : student.gender === 'female' ? '女' : '',
        student.studentNo,
        familyScopeLabel(student.familyLocation) ?? '',
        hasChangduRelativeLabel(student),
        student.hasChangduRelative === true ? (student.changduRelativeRelation ?? '') : '',
        HOLIDAY_STATUS_LABELS[row.status],
        student.remark ?? '',
      ]
    }),
  }
}

/**
 * 文件名：`高一9班_国庆假期名单_2026-09-29.xlsx`。
 *
 * 班级名为空时不拼一个假的班级名（同 `fundExportFilename`），直接叫「国庆假期名单」。
 * 假期名里可能带 `/`（教师真会写成「国庆 / 中秋」），文件名里那个字符在有的系统上
 * 会被当成路径分隔符，所以统一换成 `·`——**只动文件名，工作表名仍交给
 * `buildXlsxBook` 的 `sheetNameOf` 处理**（它按 Excel 的规则换非法字符，两处规则不同）。
 */
export function holidayExportFilename(
  className: string,
  holidayName: string,
  dateStamp: string,
): string {
  const clean = (text: string) => text.trim().replace(/[/\\:*?"<>|]/g, '·')
  const holiday = clean(holidayName) || '假期'
  return [clean(className), `${holiday}假期名单`, dateStamp].filter(Boolean).join('_') + '.xlsx'
}
