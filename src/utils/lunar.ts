// =============================================
// 农历（阴历）换算工具 — 阳历 → 农历
// =============================================
// 采用经典「农历数据表」算法（1900–2100 年），数据表每个 16 进制整数编码
// 当年信息：低 4 位 = 闰月月份（0 表示无闰月）；第 17 位 = 闰月是否大月；
// 其余高位依次表示正月到腊月（含闰月）的大小月（30 天 / 29 天）。
// 该数据表与广泛验证过的 lunar-javascript 一致。

/** 农历年份数据表（1900–2100，共 201 项，index = 年份 - 1900） */
const LUNAR_INFO = [
  0x04bd8,
  0x04ae0,
  0x0a570,
  0x054d5,
  0x0d260,
  0x0d950,
  0x16554,
  0x056a0,
  0x09ad0,
  0x055d2, // 1900-1909
  0x04ae0,
  0x0a5b6,
  0x0a4d0,
  0x0d250,
  0x1d255,
  0x0b540,
  0x0d6a0,
  0x0ada2,
  0x095b0,
  0x14977, // 1910-1919
  0x04970,
  0x0a4b0,
  0x0b4b5,
  0x06a50,
  0x06d40,
  0x1ab54,
  0x02b60,
  0x09570,
  0x052f2,
  0x04970, // 1920-1929
  0x06566,
  0x0d4a0,
  0x0ea50,
  0x06e95,
  0x05ad0,
  0x02b60,
  0x186e3,
  0x092e0,
  0x1c8d7,
  0x0c950, // 1930-1939
  0x0d4a0,
  0x1d8a6,
  0x0b550,
  0x056a0,
  0x1a5b4,
  0x025d0,
  0x092d0,
  0x0d2b2,
  0x0a950,
  0x0b557, // 1940-1949
  0x06ca0,
  0x0b550,
  0x15355,
  0x04da0,
  0x0a5b0,
  0x14573,
  0x052b0,
  0x0a9a8,
  0x0e950,
  0x06aa0, // 1950-1959
  0x0aea6,
  0x0ab50,
  0x04b60,
  0x0aae4,
  0x0a570,
  0x05260,
  0x0f263,
  0x0d950,
  0x05b57,
  0x056a0, // 1960-1969
  0x096d0,
  0x04dd5,
  0x04ad0,
  0x0a4d0,
  0x0d4d4,
  0x0d250,
  0x0d558,
  0x0b540,
  0x0b5a0,
  0x195a6, // 1970-1979
  0x095b0,
  0x049b0,
  0x0a974,
  0x0a4b0,
  0x0b27a,
  0x06a50,
  0x06d40,
  0x0af46,
  0x0ab60,
  0x09570, // 1980-1989
  0x04af5,
  0x04970,
  0x064b0,
  0x074a3,
  0x0ea50,
  0x06b58,
  0x05ac0,
  0x0ab60,
  0x096d5,
  0x092e0, // 1990-1999
  0x0c960,
  0x0d954,
  0x0d4a0,
  0x0da50,
  0x07552,
  0x056a0,
  0x0abb7,
  0x025d0,
  0x092d0,
  0x0cab5, // 2000-2009
  0x0a950,
  0x0b4a0,
  0x0baa4,
  0x0ad50,
  0x055d9,
  0x04ba0,
  0x0a5b0,
  0x15176,
  0x052b0,
  0x0a930, // 2010-2019
  0x07954,
  0x06aa0,
  0x0ad50,
  0x05b52,
  0x04b60,
  0x0a6e6,
  0x0a4e0,
  0x0d260,
  0x0ea65,
  0x0d530, // 2020-2029
  0x05aa0,
  0x076a3,
  0x096d0,
  0x04afb,
  0x04ad0,
  0x0a4d0,
  0x1d0b6,
  0x0d250,
  0x0d520,
  0x0dd45, // 2030-2039
  0x0b5a0,
  0x056d0,
  0x055b2,
  0x049b0,
  0x0a577,
  0x0a4b0,
  0x0aa50,
  0x1b255,
  0x06d20,
  0x0ada0, // 2040-2049
  0x14b63,
  0x09370,
  0x049f8,
  0x04970,
  0x064b0,
  0x168a6,
  0x0ea50,
  0x06b20,
  0x1a6c4,
  0x0aae0, // 2050-2059
  0x092e0,
  0x0d2e3,
  0x0c960,
  0x0d557,
  0x0d4a0,
  0x0da50,
  0x05d55,
  0x056a0,
  0x0a6d0,
  0x055d4, // 2060-2069
  0x052d0,
  0x0a9b8,
  0x0a950,
  0x0b4a0,
  0x0b6a6,
  0x0ad50,
  0x055a0,
  0x0aba4,
  0x0a5b0,
  0x052b0, // 2070-2079
  0x0b273,
  0x06930,
  0x07337,
  0x06aa0,
  0x0ad50,
  0x14b55,
  0x04b60,
  0x0a570,
  0x054e4,
  0x0d160, // 2080-2089
  0x0e968,
  0x0d520,
  0x0daa0,
  0x16aa6,
  0x056d0,
  0x04ae0,
  0x0a9d4,
  0x0a2d0,
  0x0d150,
  0x0f252, // 2090-2099
  0x0d520, // 2100
]

/** 基准日：1900-01-31（农历 1900 年正月初一） */
const BASE_DATE = new Date(1900, 0, 31)
const DAY_MS = 24 * 60 * 60 * 1000

/** 该农历年天数 */
function lunarYearDays(year: number): number {
  let sum = 348
  const info = LUNAR_INFO[year - 1900]
  for (let i = 0x8000; i > 0x8; i >>= 1) {
    if (info & i) sum += 1
  }
  return sum + leapDays(year)
}

/** 该农历年闰月月份（0 = 无闰月） */
function leapMonth(year: number): number {
  return LUNAR_INFO[year - 1900] & 0xf
}

/** 该农历年闰月天数（0 = 无闰月） */
function leapDays(year: number): number {
  if (leapMonth(year)) {
    return LUNAR_INFO[year - 1900] & 0x10000 ? 30 : 29
  }
  return 0
}

/** 农历某年某月的天数（m 为 1–12，含闰月按正常月序传入） */
function monthDays(year: number, month: number): number {
  return LUNAR_INFO[year - 1900] & (0x10000 >> month) ? 30 : 29
}

interface LunarDate {
  year: number
  month: number
  day: number
  /** 该月是否为闰月 */
  isLeap: boolean
}

/** 阳历（公历）转农历 */
function solarToLunar(year: number, month: number, day: number): LunarDate {
  const objDate = new Date(year, month - 1, day)
  let offset = Math.round((objDate.getTime() - BASE_DATE.getTime()) / DAY_MS)

  // 确定农历年份
  let i = 1900
  let temp = 0
  for (; i < 2101 && offset > 0; i++) {
    temp = lunarYearDays(i)
    offset -= temp
  }
  if (offset < 0) {
    offset += temp
    i--
  }
  const lunarYear = i

  const leap = leapMonth(lunarYear)
  let isLeap = false

  // 确定农历月份
  let j = 1
  for (; j < 13 && offset > 0; j++) {
    // 遇到闰月：插在正常月之后，闰月当月循环不增加 j
    if (leap > 0 && j === leap + 1 && !isLeap) {
      --j
      isLeap = true
      temp = leapDays(lunarYear)
    } else {
      temp = monthDays(lunarYear, j)
    }
    if (isLeap && j === leap + 1) isLeap = false
    offset -= temp
  }

  // 修正：恰好落在闰月月首或月初边界
  if (offset === 0 && leap > 0 && j === leap + 1) {
    if (isLeap) isLeap = false
    else {
      isLeap = true
      --j
    }
  }
  if (offset < 0) {
    offset += temp
    --j
  }

  return { year: lunarYear, month: j, day: offset + 1, isLeap }
}

const MONTH_CN = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']
const DAY_UNIT_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 农历月份中文（含闰月前缀） */
function lunarMonthText(lunar: LunarDate): string {
  const prefix = lunar.isLeap ? '闰' : ''
  return `${prefix}${MONTH_CN[lunar.month - 1]}月`
}

/** 农历日期中文（初一 ~ 三十） */
function lunarDayText(day: number): string {
  if (day === 10) return '初十'
  if (day === 20) return '二十'
  if (day === 30) return '三十'
  const tens = Math.floor(day / 10) // 0 = 初, 1 = 十, 2 = 廿
  const unit = DAY_UNIT_CN[(day % 10) - 1]
  if (tens === 0) return `初${unit}`
  if (tens === 1) return `十${unit}`
  return `廿${unit}`
}

/** 农历完整中文（如「六月廿八」） */
function lunarText(lunar: LunarDate): string {
  return `${lunarMonthText(lunar)}${lunarDayText(lunar.day)}`
}

/** 快捷：给定阳历日期返回农历中文（默认今天） */
export function getLunarText(year?: number, month?: number, day?: number): string {
  const d = new Date()
  const y = year ?? d.getFullYear()
  const m = month ?? d.getMonth() + 1
  const dd = day ?? d.getDate()
  return lunarText(solarToLunar(y, m, dd))
}
