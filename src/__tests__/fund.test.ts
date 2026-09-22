/**
 * 班费管理自检（v3.6.0）。
 *
 * 受测的是 `utils/fund.ts` 的纯逻辑与 `stores/fund.ts` 的写入口。班费是**钱**——
 * 这里盯的都是「错了不会报错、只会算出一个看着正常的错数」的那几类事：
 *
 *  ① **按分求和**。`0.1 + 0.2 !== 0.3` 在账目里不是学术问题：余额差一分，教师会怀疑整本账。
 *     所有求和先转整数分（`toCents`），62 人 × 50 元这种乘法也必须一分不差。
 *  ② **余额由流水实时算、分类存名字快照**（规格第四、五节的两条模型约定）。
 *     「盘上不该有余额字段」这件事由源码级钉子守着——它不是能测出来的行为，
 *     是「不许写下来」的形状。
 *  ③ **批次的名单当场派生**：新转来的学生一定会出现在名单里（未交），
 *     已退档但交过钱的学生**留在名单里**（他那一笔钱还在班费里躺着）。
 *     照抄一份名单快照的实现会把这两种人都弄错，且账面当场对不上。
 *  ④ **一键全部未交不碰已退档学生**：UI 的确认文案（「另有 N 名已退档学生保留已交」）
 *     就是照这条行为写的，文案与行为必须一起被钉住。
 *  ⑤ **空账本不写盘**。键不存在 = 这台设备还没有班费数据，云同步据此走「采纳云端」。
 *     加载时顺手写一个 `[]` 进去，新设备就变成「有一份空账本」，与云端那份真实数据
 *     撞成首次同步冲突。这条与其余六个模块的行为**相反**（它们会播种示例数据）。
 */
import { nextTick } from 'vue'
import { readFileSync } from 'node:fs'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeBroadcastChannel, installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { useFundStore } from '@/stores/fund'
import { useStudentStore } from '@/stores/student'
import { BACKUP_MODULES } from '@/utils/backup'
import {
  buildFundFlowEntries,
  categoryIcon,
  categoryOptions,
  collectionIncome,
  collectionPaidCount,
  collectionProgress,
  collectionRoster,
  collectionToFlowEntry,
  filterByRange,
  flowEntrySourceId,
  formatAmount,
  formatFlowAmount,
  formatFundDate,
  formatMoney,
  fromCents,
  isInFundRange,
  isPresetName,
  normalizeFundCategory,
  normalizeFundCollection,
  normalizeFundRecord,
  parseAmount,
  presetCategories,
  reviveFundCategories,
  reviveFundRecords,
  toCents,
  totalsOf,
} from '@/utils/fund'
import { queryStudents } from '@/utils/studentQuery'
import type { FundCategory, FundCollection, FundFlowEntry, FundRecord } from '@/types/fund'
import type { Student } from '@/types'

const RECORDS_KEY = `${appConfig.storageKeyPrefix}:fund:records`
const COLLECTIONS_KEY = `${appConfig.storageKeyPrefix}:fund:collections`
const CATEGORIES_KEY = `${appConfig.storageKeyPrefix}:fund:expenseCategories`
const STUDENTS_KEY = `${appConfig.storageKeyPrefix}:students`

/* ==================== 造数据的小工具 ==================== */

function student(id: string, name: string, studentNo = '', extra: Partial<Student> = {}): Student {
  return { id, name, studentNo, gender: 'female', ...extra }
}

function record(partial: Partial<FundRecord> = {}): FundRecord {
  return {
    id: 'r1',
    type: 'income',
    title: '收班费',
    amount: 100,
    date: '2026-09-01',
    category: '班费',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  }
}

function collection(partial: Partial<FundCollection> = {}): FundCollection {
  return {
    id: 'c1',
    title: '第一次班费',
    amountPerStudent: 50,
    date: '2026-09-01',
    records: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  }
}

/** 一批学生：`s1`…`sN`，学号 01、02…（学号补零，排序用例要它） */
function squad(count: number): Student[] {
  return Array.from({ length: count }, (_, index) =>
    student(`s${index + 1}`, `学生${index + 1}`, String(index + 1).padStart(2, '0')),
  )
}

/** 简易流水行（`totalsOf` / `filterByRange` 只读得到日期、类型、金额） */
function flow(id: string, type: 'income' | 'expense', amount: number, date: string): FundFlowEntry {
  return { id, kind: 'record', type, title: id, amount, date, category: '班费', createdAt: date }
}

/* ==================== ① 金额 ==================== */

describe('金额：一律按分算', () => {
  it('0.1 + 0.2 这类尾数不会把余额算歪（浮点求和会得到 0.30000000000000004）', () => {
    const totals = totalsOf([
      flow('a', 'income', 0.1, '2026-09-01'),
      flow('b', 'income', 0.2, '2026-09-01'),
    ])
    expect(totals.balance).toBe(0.3)
    expect(totals.income).toBe(0.3)
  })

  it('收支相抵时余额是精确的 0，不是 ±1e-13', () => {
    const totals = totalsOf([
      flow('a', 'income', 3100.55, '2026-09-01'),
      flow('b', 'expense', 3100.55, '2026-09-02'),
    ])
    expect(totals.balance).toBe(0)
  })

  it('toCents / fromCents 是互逆的整数分换算', () => {
    expect(toCents(86.5)).toBe(8650)
    expect(fromCents(8650)).toBe(86.5)
    expect(toCents(0.07)).toBe(7)
  })

  it('parseAmount 拒绝 0、负数、认不出的输入（不替教师四舍五入成 0）', () => {
    for (const raw of ['', '  ', '0', '0.00', '-5', 'abc', 'Infinity', 'NaN']) {
      expect(parseAmount(raw), `「${raw}」不该被当成合法金额`).toBeNull()
    }
  })

  it('parseAmount 收敛到两位小数并接受边界值', () => {
    expect(parseAmount('3100')).toBe(3100)
    expect(parseAmount('86.5')).toBe(86.5)
    expect(parseAmount('0.01')).toBe(0.01)
    expect(parseAmount('10.005')).toBe(10.01)
    expect(parseAmount(50)).toBe(50)
    // 上限之上一律拒绝：防的是「多按了几个 0」，不是真实业务
    expect(parseAmount('100000001')).toBeNull()
  })

  it('formatAmount：整数不带小数点，有角分保留两位，千分位分段', () => {
    expect(formatAmount(3100)).toBe('3,100')
    expect(formatAmount(86.5)).toBe('86.50')
    expect(formatAmount(1234567.89)).toBe('1,234,567.89')
    expect(formatAmount(0)).toBe('0')
  })

  it('formatMoney 的负号在 ¥ 前，与流水行的 + / - 是同一个口径', () => {
    expect(formatMoney(3100)).toBe('¥3,100')
    expect(formatMoney(-50)).toBe('-¥50')
    expect(formatFlowAmount({ type: 'income', amount: 3100 })).toBe('+¥3,100')
    expect(formatFlowAmount({ type: 'expense', amount: 86 })).toBe('-¥86')
  })
})

/* ==================== ② 统计 ==================== */

describe('统计：收入 / 支出 / 余额 / 笔数', () => {
  it('余额 = 收入 − 支出，笔数把两个方向都算上', () => {
    const totals = totalsOf([
      flow('a', 'income', 3000, '2026-09-01'),
      flow('b', 'expense', 86.5, '2026-09-02'),
      flow('c', 'expense', 13.5, '2026-09-03'),
    ])
    expect(totals).toEqual({ income: 3000, expense: 100, balance: 2900, count: 3 })
  })

  it('支出超过收入时余额为负（这是个会出现的真实处境，不是异常）', () => {
    expect(totalsOf([flow('a', 'expense', 120, '2026-09-01')]).balance).toBe(-120)
  })

  it('没有流水时四个指标全是 0（不返回 undefined、不返回 null）', () => {
    expect(totalsOf([])).toEqual({ income: 0, expense: 0, balance: 0, count: 0 })
  })
})

describe('统计范围：全部 / 本月 / 本学期', () => {
  const TERM = { start: '2026-09-01', end: '2027-01-20' }
  const TODAY = '2026-09-23'

  it('「全部」不筛任何一条', () => {
    expect(isInFundRange('2019-01-01', 'all', TODAY, TERM)).toBe(true)
  })

  it('「本月」只认同一个年月（跨年的 12 月 / 1 月不会混）', () => {
    expect(isInFundRange('2026-09-01', 'month', TODAY, TERM)).toBe(true)
    expect(isInFundRange('2026-09-30', 'month', TODAY, TERM)).toBe(true)
    expect(isInFundRange('2026-08-31', 'month', TODAY, TERM)).toBe(false)
    expect(isInFundRange('2025-09-23', 'month', TODAY, TERM)).toBe(false)
  })

  it('「本学期」两端都含（起止当天那两笔算数）', () => {
    expect(isInFundRange('2026-09-01', 'term', TODAY, TERM)).toBe(true)
    expect(isInFundRange('2027-01-20', 'term', TODAY, TERM)).toBe(true)
    expect(isInFundRange('2026-08-31', 'term', TODAY, TERM)).toBe(false)
    expect(isInFundRange('2027-01-21', 'term', TODAY, TERM)).toBe(false)
  })

  it('学期日期没设过时不筛——而不是筛成空列表', () => {
    // 筛成空列表的话，教师会以为账本里的记录丢了
    expect(isInFundRange('2019-01-01', 'term', TODAY, { start: '', end: '' })).toBe(true)
    // 只设了一头（比如只填了开学日）时，只按设了的那一头卡
    expect(isInFundRange('2019-01-01', 'term', TODAY, { start: '2026-09-01', end: '' })).toBe(false)
  })

  it('filterByRange 返回的是子集，不改顺序', () => {
    const entries = [
      flow('a', 'income', 100, '2026-09-20'),
      flow('b', 'income', 100, '2026-08-20'),
      flow('c', 'income', 100, '2026-09-10'),
    ]
    expect(filterByRange(entries, 'month', TODAY, TERM).map((item) => item.id)).toEqual(['a', 'c'])
    expect(filterByRange(entries, 'all', TODAY, TERM)).toHaveLength(3)
  })
})

/* ==================== ③ 收费批次 ==================== */

describe('收费批次：名单当场派生', () => {
  it('已交人数 × 每人金额，按分算（62 人 × 50 元 = 3100）', () => {
    const target = collection({
      records: squad(62).map((item, index) => ({ studentId: item.id, paid: index < 61 })),
    })
    expect(collectionPaidCount(target)).toBe(61)
    expect(collectionIncome(target)).toBe(3050)
  })

  it('一角一分的单价也不掉精度（7 人 × 0.07 元 = 0.49）', () => {
    const target = collection({
      amountPerStudent: 0.07,
      records: squad(7).map((item) => ({ studentId: item.id, paid: true })),
    })
    expect(collectionIncome(target)).toBe(0.49)
  })

  it('一个人都没交时收入是 0（不是 null、不是 NaN）', () => {
    expect(collectionIncome(collection())).toBe(0)
  })

  it('**建档时还没来的学生也在名单里**：转来的人当场出现，且是未交', () => {
    const before = squad(2)
    const target = collection({ records: [{ studentId: 's1', paid: true }] })
    // 建批次之后班里转来一个 s3
    const after = [...before, student('s3', '新生', '03')]
    const rows = collectionRoster(target, after)
    expect(rows.map((row) => row.studentId)).toEqual(['s1', 's2', 's3'])
    expect(rows.find((row) => row.studentId === 's3')?.paid).toBe(false)
    // 应缴人数随之从 2 变 3——照抄名单快照的实现会一直显示 2
    expect(collectionProgress(target, after)).toEqual({ paid: 1, total: 3 })
  })

  it('**已退档但交过钱的学生留在名单里**，他那一笔仍算进批次收入', () => {
    const target = collection({ records: [{ studentId: 's1', paid: true }] })
    const roster = [student('s1', '张三', '01', { deletedAt: '2026-09-10T00:00:00.000Z' })]
    const rows = collectionRoster(target, roster)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ studentId: 's1', paid: true, active: false })
    // 名单上抹掉他，批次金额就会跟着少 50，账面当场对不上
    expect(collectionIncome(target)).toBe(50)
  })

  it('档案里彻底找不到的学生不编名字，给占位文案', () => {
    const target = collection({ records: [{ studentId: 'ghost', paid: true }] })
    const rows = collectionRoster(target, [])
    expect(rows[0]).toMatchObject({ studentId: 'ghost', name: '已退档学生', active: false })
  })

  it('名单顺序借学生档案的排序（空学号垫底），不另立一套', () => {
    // 顺序与「学生档案」页必须一致：名单是拿着纸去核对的
    const target = collection()
    const roster = [student('s3', '丙', ''), student('s1', '甲', '10'), student('s2', '乙', '2')]
    expect(collectionRoster(target, roster).map((row) => row.studentId)).toEqual([
      's1', // 学号 10
      's2', // 学号 2
      's3', // 空学号垫底（空串按文字排会顶到最前，那是反的）
    ])
  })

  it('档案里的排序口径就是别人的口径：与 queryStudents 的结果逐位相同', () => {
    const roster = [student('s3', '丙', ''), student('s1', '甲', '10'), student('s2', '乙', '2')]
    expect(collectionRoster(collection(), roster).map((row) => row.studentId)).toEqual(
      queryStudents(roster).map((item) => item.id),
    )
  })

  it('同一个学生在 records 里出现两次时只算一个勾、只算一个人的钱', () => {
    // 正常写入路径产不出这种数据（revive 按 id 去重、togglePaid 命中即改），
    // 但「多算一个人的钱」是不会报错的那种错，所以这一层也兜一次
    const target = collection({
      records: [
        { studentId: 's1', paid: true },
        { studentId: 's1', paid: true },
      ],
    })
    expect(collectionPaidCount(target)).toBe(1)
    expect(collectionIncome(target)).toBe(50)
  })
})

/* ==================== ④ 流水（记录 + 批次合成一张） ==================== */

describe('流水列表', () => {
  it('批次是一个「虚拟行」：金额当场算，方向恒为收入，分类恒为班费', () => {
    const target = collection({ records: [{ studentId: 's1', paid: true }] })
    const entry = collectionToFlowEntry(target, [student('s1', '甲', '01')])
    expect(entry).toMatchObject({
      id: 'collection:c1',
      kind: 'collection',
      type: 'income',
      amount: 50,
      category: '班费',
      date: '2026-09-01',
      paidCount: 1,
      totalCount: 1,
    })
    expect(entry.note).toContain('已交 1/1')
    expect(entry.note).toContain('¥50')
  })

  it('id 前缀把两种来源分开（记录 `record:`，批次 `collection:`）', () => {
    const entry = collectionToFlowEntry(collection({ id: 'xyz' }), [])
    expect(flowEntrySourceId(entry)).toBe('xyz')
    expect(flowEntrySourceId({ id: 'record:abc' })).toBe('abc')
  })

  it('按日期倒序；同一天按录入时间倒序；排不出先后时按 id——**必须是全序**', () => {
    const entries = buildFundFlowEntries(
      [
        record({ id: 'a', date: '2026-09-10', createdAt: '2026-09-10T08:00:00.000Z' }),
        record({ id: 'b', date: '2026-09-12', createdAt: '2026-09-12T08:00:00.000Z' }),
        // 与 a 同一天、同一时刻：只有 id 能决定先后
        record({ id: 'c', date: '2026-09-10', createdAt: '2026-09-10T08:00:00.000Z' }),
      ],
      [],
      [],
    )
    expect(entries.map((item) => item.id)).toEqual(['record:b', 'record:c', 'record:a'])
  })

  it('批次行与手记行混在同一张表里按日期排序', () => {
    const entries = buildFundFlowEntries(
      [record({ id: 'a', date: '2026-09-05' })],
      [collection({ id: 'c1', date: '2026-09-08' })],
      [],
    )
    expect(entries.map((item) => item.id)).toEqual(['collection:c1', 'record:a'])
  })
})

/* ==================== ⑤ 分类 ==================== */

describe('分类：存名字、按方向隔离', () => {
  const custom: FundCategory[] = [
    { id: 'k1', name: '扫把', type: 'expense', createdAt: '' },
    { id: 'k2', name: '班服', type: 'income', createdAt: '' },
  ]

  it('预设逐条照规格第六节（九个支出类型）', () => {
    expect(presetCategories('expense').map((item) => item.name)).toEqual([
      '卫生用品',
      '学习用品',
      '打印复印',
      '奖品奖励',
      '班级活动',
      '清洁用品',
      '饮用水',
      '办公用品',
      '其他支出',
    ])
    expect(presetCategories('income').map((item) => item.name)).toEqual([
      '班费',
      '补缴',
      '退款',
      '其他收入',
    ])
  })

  it('**自建分类不跨方向**：支出自建项不出现在收入的选择里', () => {
    expect(categoryOptions('income', custom)).not.toContain('扫把')
    expect(categoryOptions('expense', custom)).not.toContain('班服')
    expect(categoryOptions('income', custom)).toContain('班服')
    expect(categoryOptions('expense', custom)).toContain('扫把')
  })

  it('keep：分类被删掉之后，编辑那笔流水时它仍在选项里', () => {
    // 否则一打开编辑就发现自己的分类变成了「未选择」，一保存就把它改掉了
    expect(categoryOptions('expense', [], '扫把')).toContain('扫把')
    expect(categoryOptions('expense', custom, '扫把')).toContain('扫把')
  })

  it('预设名判重按方向走（「班费」是收入预设，在支出方向不是）', () => {
    expect(isPresetName('班费', 'income')).toBe(true)
    expect(isPresetName('班费', 'expense')).toBe(false)
    expect(isPresetName('扫把', 'expense')).toBe(false)
  })

  it('预设分类有 emoji 图标，自建分类没有（界面按纯文字渲染）', () => {
    expect(categoryIcon('卫生用品', 'expense')).toBe('🧹')
    expect(categoryIcon('扫把', 'expense')).toBe('')
    // 方向不对时也不该借到对面的图标
    expect(categoryIcon('班费', 'expense')).toBe('')
  })
})

/* ==================== ⑥ 复活（normalize / revive） ==================== */

describe('复活：形状不对就丢那一条，不丢整块', () => {
  it('normalizeFundRecord 认形状（金额必须 > 0、日期必须是日期键、方向必须是两者之一）', () => {
    expect(normalizeFundRecord(record())).toMatchObject({ id: 'r1', amount: 100 })
    // 金额 0 / 负数 / 字符串一律丢
    expect(normalizeFundRecord(record({ amount: 0 }))).toBeNull()
    expect(normalizeFundRecord(record({ amount: -5 }))).toBeNull()
    expect(normalizeFundRecord({ ...record(), amount: '100' })).toBeNull()
    expect(normalizeFundRecord(record({ date: '2026-9-1' }))).toBeNull()
    expect(normalizeFundRecord({ ...record(), type: 'transfer' })).toBeNull()
    expect(normalizeFundRecord({ ...record(), title: '  ' })).toBeNull()
    expect(normalizeFundRecord(null)).toBeNull()
    expect(normalizeFundRecord('r1')).toBeNull()
  })

  it('空备注不写这个字段（`note: ""` 与「没有备注」在导出与云端比对里是两回事）', () => {
    expect(normalizeFundRecord(record())).not.toHaveProperty('note')
    expect(normalizeFundRecord(record({ note: '  ' }))).not.toHaveProperty('note')
    expect(normalizeFundRecord(record({ note: '买了扫把' }))).toHaveProperty('note', '买了扫把')
  })

  it('normalizeFundCollection 丢掉坏条目但留下整个批次', () => {
    const revived = normalizeFundCollection({
      ...collection(),
      records: [
        { studentId: 's1', paid: true },
        { studentId: 's1', paid: false }, // 重复 id：只留首条
        { studentId: '', paid: true }, // 空 id：丢
        { paid: true }, // 没有 studentId：丢
        'nonsense',
      ],
    })
    expect(revived?.records).toEqual([{ studentId: 's1', paid: true }])
  })

  it('批次的每人金额是必需项（认不出就丢整条，不默认成 0 元）', () => {
    expect(normalizeFundCollection({ ...collection(), amountPerStudent: 0 })).toBeNull()
    expect(normalizeFundCollection({ ...collection(), amountPerStudent: undefined })).toBeNull()
  })

  it('自定义分类：旧数据没有 type 字段时按支出认（键名原本只提支出）', () => {
    expect(normalizeFundCategory({ id: 'k1', name: '扫把' })).toMatchObject({ type: 'expense' })
    expect(normalizeFundCategory({ id: 'k1', name: '班服', type: 'income' })).toMatchObject({
      type: 'income',
    })
    // 认不出的 type 一律退回支出，不丢掉这一条
    expect(normalizeFundCategory({ id: 'k1', name: '杂物', type: 'weird' })).toMatchObject({
      type: 'expense',
    })
  })

  it('reviveFundRecords 同 id 只留首条（重复 id 会让 v-for key 冲突）', () => {
    const list = reviveFundRecords([
      record({ id: 'x', title: '首条' }),
      record({ id: 'x', title: '次条' }),
    ])
    expect(list).toHaveLength(1)
    expect(list[0]?.title).toBe('首条')
  })

  it('reviveFundCategories 同方向同名只留首条（重名选项在表单里无法区分）', () => {
    const list = reviveFundCategories([
      { id: 'k1', name: '扫把', type: 'expense' },
      { id: 'k2', name: '扫把', type: 'expense' }, // 同名同向：丢
      { id: 'k3', name: '扫把', type: 'income' }, // 同名异向：留
    ])
    expect(list.map((item) => item.id)).toEqual(['k1', 'k3'])
  })

  it('日期文案带年（账本会跨年，「9月3日」读不出是哪一年）', () => {
    expect(formatFundDate('2026-09-03')).toBe('2026年9月3日')
    expect(formatFundDate('2026-12-25')).toBe('2026年12月25日')
  })
})

/* ==================== ⑦ store：写入口与「空账本不写盘」 ==================== */

describe('store：写入口', () => {
  let browser: FakeBrowser

  beforeEach(() => {
    browser = installFakeBrowser()
    setActivePinia(createPinia())
    // 广播数不在本文件断言，但通道要装上（store 的 bind 会注册它）
    vi.spyOn(FakeBroadcastChannel.prototype, 'postMessage').mockImplementation(() => {})
  })

  /** 播种一份名单再开 store：store 在创建时读盘，顺序不能反 */
  function openFund(roster: Student[] = squad(2)) {
    browser.localStorage.seed(STUDENTS_KEY, JSON.stringify(roster))
    return useFundStore()
  }

  it('**空账本一个字节都不写盘**：键不存在 = 这台设备还没有班费数据', () => {
    const store = openFund()
    expect(store.records).toEqual([])
    expect(store.collections).toEqual([])
    // 写一个 `[]` 进去，新设备就变成「有一份空账本」，与云端那份真实数据撞成首次同步冲突
    expect(browser.localStorage.writesFor(RECORDS_KEY)).toBe(0)
    expect(browser.localStorage.writesFor(COLLECTIONS_KEY)).toBe(0)
    expect(browser.localStorage.writesFor(CATEGORIES_KEY)).toBe(0)
    expect(browser.localStorage.getItem(RECORDS_KEY)).toBeNull()
  })

  it('addRecord 接受合法输入并落盘，余额当场跟着变', async () => {
    const store = openFund()
    const created = store.addRecord({
      type: 'income',
      title: '收班费',
      amount: 3100,
      date: '2026-09-01',
      category: '班费',
    })
    expect(created).toBeDefined()
    await nextTick()
    expect(store.balance).toBe(3100)
    expect(JSON.parse(browser.localStorage.getItem(RECORDS_KEY) ?? '[]')).toHaveLength(1)
  })

  it('addRecord 拒绝非法输入（金额 0 / 标题空 / 坏日期 / 没分类）且不写盘', async () => {
    const store = openFund()
    const bad = [
      { type: 'income' as const, title: '收班费', amount: 0, date: '2026-09-01', category: '班费' },
      { type: 'income' as const, title: '  ', amount: 50, date: '2026-09-01', category: '班费' },
      {
        type: 'income' as const,
        title: '收班费',
        amount: 50,
        date: '2026-09-31',
        category: '班费',
      },
      { type: 'income' as const, title: '收班费', amount: 50, date: '2026-09-01', category: ' ' },
    ]
    for (const input of bad) {
      expect(store.addRecord(input), `${JSON.stringify(input)} 不该被写进账本`).toBeUndefined()
    }
    await nextTick()
    expect(store.records).toHaveLength(0)
    expect(browser.localStorage.getItem(RECORDS_KEY)).toBeNull()
  })

  it('金额在写入口收敛到两位小数（`0.1 + 0.2` 那类尾数不落进账本）', () => {
    const store = openFund()
    const created = store.addRecord({
      type: 'income',
      title: '补缴',
      amount: 10.005,
      date: '2026-09-01',
      category: '补缴',
    })
    expect(created?.amount).toBe(10.01)
  })

  it('removeRecord 把那一笔拿掉，余额回退', async () => {
    const store = openFund()
    const created = store.addRecord({
      type: 'income',
      title: '收班费',
      amount: 3100,
      date: '2026-09-01',
      category: '班费',
    })
    expect(store.balance).toBe(3100)
    expect(store.removeRecord(created?.id ?? '')).toBe(true)
    await nextTick()
    expect(store.balance).toBe(0)
    // 不存在的 id：返回 false，不抛
    expect(store.removeRecord('nope')).toBe(false)
  })

  it('updateRecord 允许改方向（记成支出但其实是收入，改过来就是）', () => {
    const store = openFund()
    const created = store.addRecord({
      type: 'expense',
      title: '买扫把',
      amount: 86,
      date: '2026-09-01',
      category: '卫生用品',
    })
    const updated = store.updateRecord(created?.id ?? '', { type: 'income', category: '班费' })
    expect(updated).toMatchObject({ type: 'income', category: '班费' })
    expect(store.balance).toBe(86)
  })

  it('批次：勾一个学生，收入与余额当场变；勾不存在的批次返回 false', async () => {
    const store = openFund()
    const batch = store.addCollection({
      title: '第一次班费',
      amountPerStudent: 50,
      date: '2026-09-01',
    })
    expect(batch).toBeDefined()
    const id = batch?.id ?? ''
    expect(store.incomeOf(id)).toBe(0)

    expect(store.togglePaid(id, 's1')).toBe(true)
    await nextTick()
    expect(store.incomeOf(id)).toBe(50)
    expect(store.balance).toBe(50)
    expect(store.progressOf(id)).toEqual({ paid: 1, total: 2 })

    // 再点一次 = 取消
    store.togglePaid(id, 's1')
    expect(store.incomeOf(id)).toBe(0)

    expect(store.togglePaid('nope', 's1')).toBe(false)
    expect(store.setAllPaid('nope', true)).toBe(false)
  })

  it('**一键全部未交不碰已退档学生**：他们那笔钱确实收过', () => {
    // UI 的确认文案就是照这条行为写的（「另有 N 名已退档学生保留已交」）
    const roster = [student('s1', '甲', '01'), student('s2', '乙', '02')]
    const store = openFund(roster)
    const batch = store.addCollection({
      title: '第一次班费',
      amountPerStudent: 50,
      date: '2026-09-01',
    })
    const id = batch?.id ?? ''
    store.setAllPaid(id, true)
    expect(store.progressOf(id).paid).toBe(2)

    // s2 转学走（软删）
    const studentStore = useStudentStore()
    studentStore.removeStudent('s2')

    expect(store.setAllPaid(id, false)).toBe(true)
    expect(store.progressOf(id).paid).toBe(1)
    // 收入不会归零：s2 那 50 元仍然在账上
    expect(store.incomeOf(id)).toBe(50)
  })

  it('名单里的姓名带重名消歧（与屏幕、导出的 PDF 是同一份）', () => {
    const roster = [
      student('s1', '张伟', '01', { idCardSuffix: '3287' }),
      student('s2', '张伟', '02', { idCardSuffix: '3288' }),
    ]
    const store = openFund(roster)
    const batch = store.addCollection({
      title: '第一次班费',
      amountPerStudent: 50,
      date: '2026-09-01',
    })
    const names = store.rosterOf(batch?.id ?? '').map((row) => row.name)
    expect(names).toEqual(['张伟（3287）', '张伟（3288）'])
  })

  it('删批次：流水里那一行随之消失，余额回退', () => {
    const store = openFund()
    const batch = store.addCollection({
      title: '第一次班费',
      amountPerStudent: 50,
      date: '2026-09-01',
    })
    const id = batch?.id ?? ''
    store.togglePaid(id, 's1')
    expect(store.balance).toBe(50)
    expect(store.removeCollection(id)).toBe(true)
    expect(store.balance).toBe(0)
    expect(store.flowEntries).toHaveLength(0)
  })

  it('addCategory 拒绝与预设同名、也拒绝同方向重名', () => {
    const store = openFund()
    // 与预设同名：表单里会出现两个一模一样的选项
    expect(store.addCategory('卫生用品', 'expense')).toBeUndefined()
    expect(store.addCategory('班费', 'income')).toBeUndefined()
    const created = store.addCategory('扫把', 'expense')
    expect(created).toBeDefined()
    expect(store.addCategory('扫把', 'expense')).toBeUndefined()
    // 同名但换一个方向：允许（两个方向各有各的选项表）
    expect(store.addCategory('扫把', 'income')).toBeDefined()
    expect(store.addCategory('   ', 'expense')).toBeUndefined()
  })

  it('删自定义分类：已经用过它的流水一字不改（分类名是记在那笔流水上的事实）', () => {
    const store = openFund()
    const created = store.addCategory('扫把', 'expense')
    store.addRecord({
      type: 'expense',
      title: '买扫把',
      amount: 20,
      date: '2026-09-01',
      category: '扫把',
    })
    expect(store.categoryUsage('扫把')).toBe(1)

    expect(store.removeCategory(created?.id ?? '')).toBe(true)
    expect(store.categories).toHaveLength(0)
    // 历史流水仍写着「扫把」，且它仍出现在编辑那笔流水的选项里
    expect(store.records[0]?.category).toBe('扫把')
    expect(store.categoryNamesOf('expense', '扫把')).toContain('扫把')
  })

  it('自定义分类落盘在规格指定的那个键上', async () => {
    const store = openFund()
    store.addCategory('扫把', 'expense')
    await nextTick()
    const saved = JSON.parse(browser.localStorage.getItem(CATEGORIES_KEY) ?? '[]')
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ name: '扫把', type: 'expense' })
  })
})

/* ==================== ⑧ 源码级钉子 ==================== */

describe('源码级钉子：模型约定的形状', () => {
  /** 去掉注释后的实现源码——注释里正好会讨论「不存余额」，别被自己绊倒 */
  function codeOf(path: string): string {
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
  }

  /** 取出一个 interface 的声明正文（到第一个 `}` 为止；这几个接口里都没有嵌套字面量） */
  function interfaceBody(source: string, name: string): string {
    const start = source.indexOf(`interface ${name} {`)
    expect(start, `找不到 interface ${name}——这条钉子该跟着类型一起改`).toBeGreaterThan(-1)
    return source.slice(start, source.indexOf('}', start))
  }

  it('**落库的两个接口里不存在余额类字段**（规格第四、八节）', () => {
    // 一旦余额被存下来，它与流水就必然分叉——而分叉之后谁对谁错无人能判断。
    // 注意范围：FundTotals 里那个 `balance` 是**算出来的结果**（不落库），
    // 下面只钉真正写进 localStorage 的形状：FundRecord 与 FundCollection。
    const types = codeOf('src/types/fund.ts')
    for (const name of ['FundRecord', 'FundCollection', 'FundCollectionEntry']) {
      const body = interfaceBody(types, name)
      expect(body, `${name} 不该存余额`).not.toMatch(/\bbalance\b/)
      expect(body, `${name} 不该存合计`).not.toMatch(/\b(total|sum)[A-Za-z]*\s*[?:]/)
    }
    // 批次的收入由「已交人数 × 每人金额」当场算，不存第二份金额——
    // 存了就会与 records 分叉（勾了人、金额没跟上）
    const collectionBody = interfaceBody(types, 'FundCollection')
    expect(collectionBody).not.toMatch(/\bamount\s*[?:]/)
    // 名单里的每一行（派生结果）也不存金额：只记「交没交」
    expect(interfaceBody(types, 'FundCollectionEntry')).not.toMatch(/\bamount\b/)
  })

  it('三个存储键与规格第十一节逐字一致（键名是云同步与备份的接口）', () => {
    const sources = [
      'fundRepository.ts',
      'fundCollectionRepository.ts',
      'fundCategoryRepository.ts',
    ]
      .map((file) => codeOf(`src/repositories/fund/${file}`))
      .join('\n')
    for (const key of ['fund:records', 'fund:collections', 'fund:expenseCategories']) {
      expect(sources, `${key} 没有对应的仓储`).toContain(`:${key}\``)
    }
  })

  it('三个键都登记在备份模块里（漏登记的表现是「这个模块不参与备份」，界面上看不出来）', () => {
    for (const [key, label, unit] of [
      ['fund:records', '班费流水', '笔'],
      ['fund:collections', '收费批次', '个'],
      ['fund:expenseCategories', '自定义支出类型', '个'],
    ]) {
      const hit = BACKUP_MODULES.find(
        (module) => module.key === `${appConfig.storageKeyPrefix}:${key}`,
      )
      expect(hit, `${key} 没登记进 BACKUP_MODULES`).toMatchObject({ label, unit })
    }
  })

  it('页面不直接 import 仓储或同步层（分层纪律，§9.2）', () => {
    for (const file of [
      'src/views/Fund/index.vue',
      'src/views/Fund/components/FundCollectionDetail.vue',
      'src/views/Fund/components/FundRecordDrawer.vue',
    ]) {
      const code = codeOf(file)
      expect(code, `${file} 不该直接 import 仓储`).not.toMatch(/from '@\/repositories/)
      expect(code, `${file} 不该直接 import 同步层`).not.toMatch(/from '@\/sync/)
      expect(code, `${file} 不该直接 import 服务层`).not.toMatch(/from '@\/services/)
    }
  })
})
