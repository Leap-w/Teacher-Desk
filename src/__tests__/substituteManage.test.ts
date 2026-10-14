/**
 * v3.7.5 §6「代课管理」自检：增删改 / 必填校验 / 日期范围筛选 / 三档统计 /
 * 与课程表·换课的彻底隔离 / 老数据不迁移 / 导航入口。
 *
 * 这一版最要紧的不是「表单能不能填」，而是三条**错了不会当场报错**的事：
 *
 *  ① **隔离（§6.3）**：代课台账与课程表、换课记录各存各的键。接错一处，教师改课表顺手
 *     改掉代课统计（或反过来）——两边都还「能跑」，只是数字悄悄变了对不上。所以这里
 *     两个方向都钉：登记 / 编辑 / 删除代课时课表与换课的**盘上原文逐字节不变、写入计数为 0**；
 *     改课表 / 换课 / 清空课表时台账原文同样不变。源码级再钉一层：没人在代课模块之外
 *     读写这个 store。
 *  ② **不猜测性迁移（§6.5）**：`Lesson.type === 'substitute'` 是旧写法（只有星期、没有日期），
 *     无法可靠还原成带日期的台账记录。它必须**原样留在课表里**，台账保持空的——
 *     「顺手迁一下」会让教师的课表记录凭空多出一批对不上日期的代课。
 *  ③ **统计与列表同一份数据（§6.4）**：总节数 / 按实际代课教师 / 按被代课教师三档，
 *     全部由同一份筛选后的列表实时算出。数字硬编码或口径不一致，界面上看不出来，
 *     但它就是错的。这里用「列表条数 === 总节数」「分组计数之和 === 总节数」钉死。
 *
 * 写盘挂在 Vue 的 `watch`（pre-flush）上：**改完 store 必须先 `await nextTick()` 才读得到盘**。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { syncedKeys } from '@/services/sync'
import { useSubstituteStore } from '@/stores/substitute'
import { useTimetableStore } from '@/stores/timetable'
import { classIdOf } from '@/utils/timetable'
import type { LessonInput } from '@/types/timetable'
import type { SubstituteInput } from '@/types/substitute'

const prefix = appConfig.storageKeyPrefix
/** 代课台账：独立一键（§6.3 的隔离就落在这三个键互不相干上） */
const SUBSTITUTES_KEY = `${prefix}:substitutes`
const LESSONS_KEY = `${prefix}:timetable`
const EXCHANGES_KEY = `${prefix}:timetable:exchanges`

const CLASS_NAME = '高一9班'

let browser: FakeBrowser

beforeEach(() => {
  browser = installFakeBrowser()
  setActivePinia(createPinia())
})

/** 一次合法的表单内容（用例只改需要改的那几项） */
function input(overrides: Partial<SubstituteInput> = {}): SubstituteInput {
  return {
    date: '2026-10-12',
    periodId: 'p2',
    originalTeacher: '李老师',
    substituteTeacher: '王老师',
    subject: '数学',
    ...overrides,
  }
}

/** 盘上原文（**不经过被测代码读**，避免「用被测对象验证自己」） */
function diskText(key: string): string | null {
  return browser.localStorage.getItem(key)
}

/** 盘上那份代课台账（解析后的数组） */
function diskRecords(): Array<Record<string, unknown>> {
  return JSON.parse(diskText(SUBSTITUTES_KEY) ?? 'null') as Array<Record<string, unknown>>
}

/* ==================== ① §6.1 / §6.2 增删改与落库 ==================== */

describe('§6.1 / §6.2 记录的增删改：字段原样落库，非法输入一律拒绝', () => {
  it('新增：六个字段原样写进台账，id 与建档时间由 store 生成', async () => {
    const store = useSubstituteStore()
    const created = store.add(input({ remark: '原教师病假' }))

    expect(created).toBeDefined()
    expect(created?.id).toBeTruthy()
    expect(created?.createdAt).toBeTruthy()
    await nextTick()

    expect(diskRecords()).toHaveLength(1)
    expect(diskRecords()[0]).toMatchObject({
      date: '2026-10-12',
      periodId: 'p2',
      originalTeacher: '李老师',
      substituteTeacher: '王老师',
      subject: '数学',
      remark: '原教师病假',
    })
  })

  it('备注留空 → 盘上不写这个字段（`remark: ""` 与「没有备注」是两种数据）', async () => {
    const store = useSubstituteStore()
    store.add(input())
    await nextTick()

    expect(diskRecords()[0]).not.toHaveProperty('remark')
  })

  it('编辑：id 与建档时间不变，改的是内容', async () => {
    const store = useSubstituteStore()
    const created = store.add(input())!
    await nextTick()

    const updated = store.update(created.id, { periodId: 'p5', substituteTeacher: '赵老师' })
    await nextTick()

    expect(updated?.id).toBe(created.id)
    expect(updated?.createdAt).toBe(created.createdAt)
    expect(updated?.periodId).toBe('p5')
    expect(store.count).toBe(1)
    expect(diskRecords()).toHaveLength(1)
    expect(diskRecords()[0]).toMatchObject({ periodId: 'p5', substituteTeacher: '赵老师' })
  })

  it('编辑不存在的记录 → 返回 undefined，不动盘（不新建、不报错刷屏）', async () => {
    const store = useSubstituteStore()
    store.add(input())
    await nextTick()
    const before = diskText(SUBSTITUTES_KEY)
    browser.localStorage.resetCounters()

    expect(store.update('no-such-id', { subject: '英语' })).toBeUndefined()
    await nextTick()

    expect(diskText(SUBSTITUTES_KEY)).toBe(before)
    expect(browser.localStorage.writesFor(SUBSTITUTES_KEY)).toBe(0)
  })

  it('删除：盘上真少了那一条；同一条删两次，第二次如实地返回 false', async () => {
    const store = useSubstituteStore()
    const first = store.add(input())!
    store.add(input({ date: '2026-10-13' }))
    await nextTick()

    expect(store.remove(first.id)).toBe(true)
    await nextTick()

    expect(store.count).toBe(1)
    expect(diskRecords()).toHaveLength(1)
    expect(diskRecords()[0]?.date).toBe('2026-10-13')
    expect(store.remove(first.id)).toBe(false)
  })

  it('必填缺一即拒：日期 / 节次 / 两位教师 / 科目，各试一遍都不落库', async () => {
    const store = useSubstituteStore()
    browser.localStorage.resetCounters()

    const invalid: Partial<SubstituteInput>[] = [
      { date: '' },
      { date: '2026-2-3' }, // 形状不对
      { date: '2026-02-31' }, // 这一天不存在（isDateKey 的回读校验）
      { periodId: 'p99' as SubstituteInput['periodId'] },
      { originalTeacher: '  ' },
      { substituteTeacher: '' },
      { subject: '   ' },
    ]
    for (const patch of invalid) {
      expect(store.add(input(patch))).toBeUndefined()
    }
    await nextTick()

    expect(store.count).toBe(0)
    // 一个字节都没写盘：键在盘上仍然「不存在」（云同步据此走「本地无此键 → 采纳云端」）
    expect(diskText(SUBSTITUTES_KEY)).toBeNull()
    expect(browser.localStorage.writesFor(SUBSTITUTES_KEY)).toBe(0)
  })

  it('超长文本按上限截断而不是丢弃整条（截断只损失末尾几个字）', async () => {
    const store = useSubstituteStore()
    const created = store.add(
      input({
        originalTeacher: '甲'.repeat(50),
        substituteTeacher: '乙'.repeat(50),
        subject: '丙'.repeat(50),
      }),
    )

    expect(created?.originalTeacher).toHaveLength(20)
    expect(created?.substituteTeacher).toHaveLength(20)
    expect(created?.subject).toHaveLength(20)
  })
})

/* ==================== ② §6.4 日期范围筛选与三档统计 ==================== */

/**
 * 六条记录，横跨 10 月与 11 月、两位被代课教师 / 两位实际代课教师：
 *   10-12 p2 李老师 → 王老师 数学
 *   10-12 p3 李老师 → 王老师 语文
 *   10-14 p5 李老师 → 王老师 数学
 *   10-15 p2 张老师 → 赵老师 英语
 *   10-20 p3 张老师 → 王老师 英语
 *   11-02 早自习 李老师 → 赵老师 数学
 * 于是全量的口径：王老师代 4 节、赵老师代 2 节；李老师被代 4 节、张老师被代 2 节。
 */
function seedRecords(): void {
  const store = useSubstituteStore()
  store.add(input({ date: '2026-10-12', periodId: 'p2' }))
  store.add(input({ date: '2026-10-12', periodId: 'p3', subject: '语文' }))
  store.add(input({ date: '2026-10-14', periodId: 'p5' }))
  store.add(
    input({
      date: '2026-10-15',
      periodId: 'p2',
      originalTeacher: '张老师',
      substituteTeacher: '赵老师',
      subject: '英语',
    }),
  )
  store.add(
    input({
      date: '2026-10-20',
      periodId: 'p3',
      originalTeacher: '张老师',
      subject: '英语',
    }),
  )
  store.add(input({ date: '2026-11-02', periodId: 'morning', substituteTeacher: '赵老师' }))
}

/** 教师名 → 节数的对照（tie 的先后交给纯函数测试，这里只核对数字） */
function counts(list: { name: string; count: number }[]): Record<string, number> {
  return Object.fromEntries(list.map((item) => [item.name, item.count]))
}

describe('§6.4 日期范围筛选与三档统计', () => {
  it('列表按日期倒序、同一天按节次先后升序（刷新后顺序不变）', () => {
    seedRecords()
    const store = useSubstituteStore()

    expect(store.sorted.map((item) => `${item.date} ${item.periodId}`)).toEqual([
      '2026-11-02 morning',
      '2026-10-20 p3',
      '2026-10-15 p2',
      '2026-10-14 p5',
      '2026-10-12 p2',
      '2026-10-12 p3',
    ])
  })

  it('范围筛选：两端都含；任一端留空即该端不限', () => {
    seedRecords()
    const store = useSubstituteStore()

    expect(store.listIn('', '')).toHaveLength(6) // 不限
    expect(store.listIn('2026-10-14', '2026-10-20').map((item) => item.date)).toEqual([
      '2026-10-20',
      '2026-10-15',
      '2026-10-14',
    ])
    expect(store.listIn('2026-10-15', '')).toHaveLength(3) // 只填开始
    expect(store.listIn('', '2026-10-12')).toHaveLength(2) // 只填结束
    expect(store.listIn('2026-10-16', '2026-10-14')).toHaveLength(0) // 填反了 → 空（界面会点名）
  })

  it('总节数 = 筛选范围内列表的条数（一条记录 = 一节代课）', () => {
    seedRecords()
    const store = useSubstituteStore()

    const ranges: [string, string][] = [
      ['', ''],
      ['2026-10-14', '2026-10-20'],
      ['2026-10-12', '2026-10-12'],
    ]
    for (const [from, to] of ranges) {
      expect(store.summaryIn(from, to).total).toBe(store.listIn(from, to).length)
    }
    expect(store.summaryIn('', '').total).toBe(6)
    expect(store.summaryIn('2026-10-14', '2026-10-20').total).toBe(3)
  })

  it('按实际代课教师统计：全量 王老师 4 / 赵老师 2，节数降序', () => {
    seedRecords()
    const summary = useSubstituteStore().summaryIn('', '')

    expect(counts(summary.bySubstituteTeacher)).toEqual({ 王老师: 4, 赵老师: 2 })
    expect(summary.bySubstituteTeacher.map((item) => item.name)).toEqual(['王老师', '赵老师'])
  })

  it('按被代课教师统计：全量 李老师 4 / 张老师 2（与「谁去上的」是两笔账）', () => {
    seedRecords()
    const summary = useSubstituteStore().summaryIn('', '')

    expect(counts(summary.byOriginalTeacher)).toEqual({ 李老师: 4, 张老师: 2 })
    expect(summary.byOriginalTeacher.map((item) => item.name)).toEqual(['李老师', '张老师'])
  })

  it('改一条记录之后，筛选范围里的三档统计跟着变（实时算，不缓存、不硬编码）', () => {
    seedRecords()
    const store = useSubstituteStore()
    const target = store.sorted.find((item) => item.date === '2026-10-20')!

    store.update(target.id, { substituteTeacher: '钱老师' })
    const summary = store.summaryIn('2026-10-14', '2026-10-20')

    expect(counts(summary.bySubstituteTeacher)).toEqual({ 王老师: 1, 赵老师: 1, 钱老师: 1 })
    expect(summary.total).toBe(3)
    // 分组计数之和必须等于总节数——差一条就说明有记录落进了没人认领的口袋
    const sum = (list: { count: number }[]) => list.reduce((total, item) => total + item.count, 0)
    expect(sum(summary.bySubstituteTeacher)).toBe(summary.total)
    expect(sum(summary.byOriginalTeacher)).toBe(summary.total)
  })
})

/* ==================== ③ §6.6 刷新后数据保留 ==================== */

describe('§6.6 刷新（重开应用）后台账还在', () => {
  it('重开应用读的是同一份台账：条数、内容、顺序都不变', async () => {
    seedRecords()
    await nextTick()
    const before = useSubstituteStore().sorted.map((item) => `${item.date} ${item.periodId}`)

    // 刷新＝整张模块图重建（本仓库的既有做法，见 cloudSync.test.ts 的说明）
    vi.resetModules()
    const freshPinia = await import('pinia')
    freshPinia.setActivePinia(freshPinia.createPinia())
    const { useSubstituteStore: freshUseSubstituteStore } = await import('@/stores/substitute')
    const reloaded = freshUseSubstituteStore()

    expect(reloaded.count).toBe(6)
    expect(reloaded.sorted.map((item) => `${item.date} ${item.periodId}`)).toEqual(before)

    // 复位：把「当前 Pinia」还给本文件顶部静态 import 的那一份模块实例，
    // 否则后面的用例会拿到「没有 activePinia」
    setActivePinia(createPinia())
  })

  it('键不存在的设备（还没记过）→ 空台账且一个字节都不写盘', async () => {
    const store = useSubstituteStore()
    browser.localStorage.resetCounters()

    expect(store.count).toBe(0)
    expect(store.summaryIn('', '').total).toBe(0)
    await nextTick()

    expect(diskText(SUBSTITUTES_KEY)).toBeNull()
    expect(browser.localStorage.writesFor(SUBSTITUTES_KEY)).toBe(0)
  })

  it('台账走的是与其它模块同一条同步路（同一个 syncPersisted 注册表）', () => {
    useSubstituteStore()
    expect(syncedKeys()).toContain(SUBSTITUTES_KEY)
  })
})

/* ==================== ④ §6.3 与课程表 / 换课彻底隔离 ==================== */

/** 两节正常课 + 空的换课记录（盘上原文，供「逐字节不变」断言用） */
function seedTimetable(): void {
  const lesson = (
    id: string,
    weekday: LessonInput['weekday'],
    periodId: LessonInput['periodId'],
  ) => ({
    id,
    weekday,
    periodId,
    subject: '语文',
    classId: classIdOf(CLASS_NAME),
    className: CLASS_NAME,
    teacher: '我',
    type: 'normal',
  })
  browser.localStorage.seed(
    LESSONS_KEY,
    JSON.stringify([lesson('l1', 1, 'p2'), lesson('l2', 2, 'p3')]),
  )
  browser.localStorage.seed(EXCHANGES_KEY, JSON.stringify([]))
}

describe('§6.3 与课程表、换课彻底隔离（两个方向都验）', () => {
  it('登记 / 编辑 / 删除代课：课表与换课记录的盘上原文逐字节不变，写入计数为 0', async () => {
    seedTimetable()
    const lessonsBefore = diskText(LESSONS_KEY)
    const exchangesBefore = diskText(EXCHANGES_KEY)
    browser.localStorage.resetCounters()

    const store = useSubstituteStore()
    const created = store.add(input())!
    store.update(created.id, { periodId: 'p5' })
    store.remove(created.id)
    await nextTick()

    expect(diskText(LESSONS_KEY)).toBe(lessonsBefore)
    expect(diskText(EXCHANGES_KEY)).toBe(exchangesBefore)
    expect(browser.localStorage.writesFor(LESSONS_KEY)).toBe(0)
    expect(browser.localStorage.writesFor(EXCHANGES_KEY)).toBe(0)
    // 同时确认这一串操作真的写过台账（否则上面的「没动」可能只是什么都发生）
    expect(browser.localStorage.writesFor(SUBSTITUTES_KEY)).toBeGreaterThan(0)
  })

  it('反方向：加课 / 清空课表之后，代课台账的盘上原文一个字节都不动', async () => {
    seedTimetable()
    const store = useSubstituteStore()
    const created = store.add(input())!
    await nextTick()
    const substitutesBefore = diskText(SUBSTITUTES_KEY)
    browser.localStorage.resetCounters()

    const timetable = useTimetableStore()
    timetable.addLesson({
      weekday: 3,
      periodId: 'p4',
      subject: '英语',
      classId: classIdOf(CLASS_NAME),
      className: CLASS_NAME,
      teacher: '我',
      type: 'normal',
    })
    timetable.clearLessons()
    await nextTick()

    expect(diskText(SUBSTITUTES_KEY)).toBe(substitutesBefore)
    expect(browser.localStorage.writesFor(SUBSTITUTES_KEY)).toBe(0)
    expect(store.records.map((item) => item.id)).toEqual([created.id])
    // 课表那边确实动过（这条测试不是空转）
    expect(browser.localStorage.writesFor(LESSONS_KEY)).toBeGreaterThan(0)
  })

  it('§6.3-1/2：代课台账不生成换课记录——换课键始终是空数组', async () => {
    seedTimetable()
    const store = useSubstituteStore()
    store.add(input())
    store.add(input({ date: '2026-10-13', periodId: 'p5' }))
    await nextTick()

    // 换课记录另有自己的 store 与键（`teacherdesk:timetable:exchanges`）：
    // 代课根本不碰它，所以它还是开机时那个 []
    expect(JSON.parse(diskText(EXCHANGES_KEY) ?? 'null')).toEqual([])
    expect(useTimetableStore().exchanges).toHaveLength(0)
  })

  it('台账 store 只在代课管理页被读写（源码级：没有第二处入口，也就没有隐式副作用）', () => {
    const importers = sourceFiles('src')
      .filter((file) => !file.startsWith('src/views/Substitutes/'))
      .filter((file) => readFileSync(file, 'utf8').includes('@/stores/substitute'))
      .sort()

    expect(importers).toEqual([])
  })

  it('台账 store 不 import 课程表 store（数据隔离的那一半靠这条守住）', () => {
    const source = readFileSync('src/stores/substitute.ts', 'utf8')
    expect(source).toContain('SubstituteRecord')
    expect(source).not.toContain('stores/timetable')
  })
})

/* ==================== ⑤ §6.5 历史数据不迁移 ==================== */

describe('§6.5 课表里旧写法的「代课」课：原样留着，不猜测性迁移', () => {
  it('不搬进台账、不丢弃、不改写原记录', async () => {
    const legacy = [
      {
        id: 'legacy-sub',
        weekday: 2,
        periodId: 'p3',
        subject: '数学',
        classId: classIdOf(CLASS_NAME),
        className: CLASS_NAME,
        teacher: '王老师',
        type: 'substitute',
        originalTeacher: '李老师',
      },
    ]
    browser.localStorage.seed(LESSONS_KEY, JSON.stringify(legacy))
    browser.localStorage.seed(EXCHANGES_KEY, JSON.stringify([]))
    const lessonsBefore = diskText(LESSONS_KEY)
    browser.localStorage.resetCounters()

    const substitutes = useSubstituteStore()
    const timetable = useTimetableStore()
    await nextTick()

    // 旧写法**没有具体日期**（只有星期），还原不出带日期的台账记录——
    // 台账保持空的，绝不能让教师的台账里凭空多出一批猜出来的记录
    expect(substitutes.count).toBe(0)
    expect(diskText(SUBSTITUTES_KEY)).toBeNull()
    // 而课表那条原样留着（既不丢弃，也不改写）：读得回来，且盘上原文一字未动
    expect(timetable.lessons.some((lesson) => lesson.type === 'substitute')).toBe(true)
    expect(diskText(LESSONS_KEY)).toBe(lessonsBefore)
    expect(browser.localStorage.writesFor(LESSONS_KEY)).toBe(0)
  })
})

/* ==================== ⑥ §9.10 导航入口（源码级钉子） ==================== */

describe('§9.10 入口挂在「工作管理」下，与课程表 / 工作清单同一级', () => {
  it('路由表：三个子页依次是 课程表 → 工作清单 → 代课管理', () => {
    const routes = readFileSync('src/router/routes.ts', 'utf8')
    expect(routes).toContain("path: 'substitutes'")
    expect(routes).toContain("meta: { title: '代课管理' }")
    expect(routes).toContain("import('@/views/Substitutes/index.vue')")

    // 二级导航的顺序由路由表的 children 顺序决定——插在中间会把教师已经习惯的位置挪走
    const schedule = routes.indexOf("path: 'schedule'")
    const works = routes.indexOf("path: 'works'")
    const substitutes = routes.indexOf("path: 'substitutes'")
    expect(schedule).toBeGreaterThan(-1)
    expect(schedule).toBeLessThan(works)
    expect(works).toBeLessThan(substitutes)
  })

  it('「上次看的 Tab」认得它：在代课管理页刷新不会被弹回课程表', () => {
    expect(readFileSync('src/utils/workTab.ts', 'utf8')).toContain("'/work/substitutes'")
  })

  it('页面接的是 store 的真数据（列表 / 统计各走哪条路，不是只有一层壳）', () => {
    const page = readFileSync('src/views/Substitutes/index.vue', 'utf8')
    expect(page).toContain('useSubstituteStore')
    expect(page).toContain('substituteStore.listIn')
    expect(page).toContain('summaryIn')

    const stats = readFileSync('src/views/Substitutes/components/SubstituteStats.vue', 'utf8')
    expect(stats).toContain('summary.bySubstituteTeacher')
    expect(stats).toContain('summary.byOriginalTeacher')
    expect(stats).toContain('summary.total')
  })
})

/** 递归收集源码文件（沿用 v331Linkage.test.ts 的做法：只看 src 下的 .ts / .vue） */
function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      found.push(...sourceFiles(path))
      continue
    }
    if (!/\.(ts|vue)$/.test(entry)) continue
    if (entry.endsWith('.d.ts')) continue
    found.push(path)
  }
  return found
}
