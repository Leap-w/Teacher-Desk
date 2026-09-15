/**
 * 各领域读取路径的健壮化（Phase 9C §六）。
 *
 * 首屏加载与跨标签页同步共用同一份 `reviveXxx` / `normalizeXxx`（§11.1），所以这里断言
 * 的是**内存里最终是什么样子**，不是某个内部函数的返回值——被测的正是教师会遇到的那条路。
 *
 * 最要紧的一条：**缓存损坏时不重新播种示例数据**。九个阶段里这条被改坏过（把「读不出来」
 * 与「键不存在」混成一个 `null`），后果是教师真正的档案被一份示例数据覆盖——
 * 而界面上看起来只是「数据变回示例了」，再刷新一次就没了，根本来不及反应。
 * 所以这里的断言是双重的：内存里是空的，**且盘上原文一个字都没动**。
 *
 * 第二条：**不给历史数据擅自加业务默认值**。缺的字段留空、认不出的条目丢弃，
 * 不做「帮他补一个看起来合理的值」——教师看到一条自己没录过的记录比看到空列表更糟。
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { createSeedLessons } from '@/services/mock'
import { readRaw } from '@/services/storage'
import { useConstraintStore } from '@/stores/constraint'
import { useDutyStore } from '@/stores/duty'
import { useLeaveStore } from '@/stores/leave'
import { useSeatStore } from '@/stores/seat'
import { useStudentStore } from '@/stores/student'
import { useTimetableStore } from '@/stores/timetable'
import { useWeekendStore } from '@/stores/weekend'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`

let browser: FakeBrowser

interface Domain {
  label: string
  key: string
  /** 载入这个域（触发首屏读取 + 规范化） */
  load: () => void
  /** 内存里的**业务记录**条数（不含规范化时补出来的结构性默认项） */
  count: () => number
  /** 键不存在时会不会播种示例数据（各域既有口径，见各 store 顶部说明） */
  seedsWhenMissing: boolean
}

/**
 * 八个模块的读取路径。`seedsWhenMissing` 是**如实记录现状**而不是理想：
 * 座位约束和座位方案都引用学生主键，播种条件因此各不相同
 *（请假的注释里写着为什么它比学生 / 课表严一档）。
 */
const DOMAINS: Domain[] = [
  {
    label: '学生档案',
    key: STUDENTS_KEY,
    load: () => void useStudentStore(),
    count: () => useStudentStore().students.length,
    seedsWhenMissing: true,
  },
  {
    label: '座位方案',
    key: `${prefix}:seatPlans`,
    load: () => void useSeatStore(),
    count: () => useSeatStore().plans.length,
    seedsWhenMissing: true,
  },
  {
    label: '座位约束',
    key: `${prefix}:seatConstraints`,
    load: () => void useConstraintStore(),
    count: () => useConstraintStore().items.length,
    seedsWhenMissing: false,
  },
  {
    label: '课程表',
    key: `${prefix}:timetable`,
    load: () => void useTimetableStore(),
    count: () => useTimetableStore().lessons.length,
    seedsWhenMissing: true,
  },
  {
    label: '请假记录',
    key: `${prefix}:leaves`,
    load: () => void useLeaveStore(),
    count: () => useLeaveStore().leaves.length,
    seedsWhenMissing: true,
  },
  {
    label: '值日安排',
    key: `${prefix}:duty`,
    load: () => void useDutyStore(),
    // 只数组数：设置记录在内存里一定会被补齐（缺了它所有读取路径都会以为「设置不在数组里」）
    count: () => useDutyStore().groups.length,
    seedsWhenMissing: true,
  },
  {
    label: '周末返家',
    key: `${prefix}:weekendReturns`,
    load: () => void useWeekendStore(),
    count: () => useWeekendStore().records.length,
    seedsWhenMissing: true,
  },
]

beforeEach(() => {
  browser = installFakeBrowser()
  setActivePinia(createPinia())
})

describe('缓存损坏：内存里是空的，且**不写盘**（盘上原文保留，示例数据不重播）', () => {
  it.each(DOMAINS)('$label：缓存不是 JSON → 空 + 原文保留 + 一次都不写', ({ key, load, count }) => {
    browser.localStorage.seed(key, '{这不是 JSON')

    load()

    expect(count()).toBe(0)
    expect(readRaw(key)).toBe('{这不是 JSON')
    expect(browser.localStorage.writesFor(key)).toBe(0)
  })

  it.each(DOMAINS)(
    '$label：缓存是 JSON 但不是列表 → 空 + 原文保留 + 一次都不写',
    ({ key, load, count }) => {
      browser.localStorage.seed(key, '{"students":[]}')

      load()

      expect(count()).toBe(0)
      expect(readRaw(key)).toBe('{"students":[]}')
      expect(browser.localStorage.writesFor(key)).toBe(0)
    },
  )

  it('课程表：旧键（Phase 4）损坏时既不迁移也不删旧键（原文留着人工找回）', () => {
    browser.localStorage.seed(`${prefix}:timetable:lessons`, '坏掉的旧课表')

    const lessons = useTimetableStore().lessons

    // 迁移是单向的：旧键原文一个字都不能动，否则教师那份真课表就再也找不回来了
    expect(readRaw(`${prefix}:timetable:lessons`)).toBe('坏掉的旧课表')
    // 本次先用示例课表顶上（既有口径），并记下播种基线
    expect(lessons).toEqual(createSeedLessons())
    expect(readRaw(`${prefix}:seedText`)).toContain(`${prefix}:timetable`)
  })

  it('课程表：旧键（Phase 4）完好时迁移到新键并删旧键（在旧版本的机器上升级）', () => {
    const legacy = [
      { id: 'l1', weekday: 1, period: 1, subject: '语文', className: '高一(1)班', teacher: '我' },
    ]
    browser.localStorage.seed(`${prefix}:timetable:lessons`, JSON.stringify(legacy))

    const lessons = useTimetableStore().lessons

    expect(lessons.map((item) => item.id)).toEqual(['l1'])
    expect(readRaw(`${prefix}:timetable`)).not.toBeNull()
    expect(readRaw(`${prefix}:timetable:lessons`)).toBeNull()
    // 迁移出来的是教师自己的课表，**不记播种基线**（记了首次同步就会当成「本机只有示例」采纳云端）
    expect(readRaw(`${prefix}:seedText`) ?? '').not.toContain(`${prefix}:timetable`)
  })
})

describe('键不存在（第一次打开）：按各域既有口径播种或不播种', () => {
  it.each(DOMAINS)(
    '$label：$label 的播种口径与文档一致',
    ({ key, load, count, seedsWhenMissing }) => {
      load()

      if (seedsWhenMissing) {
        expect(count()).toBeGreaterThan(0)
        // 播种要写盘，且写下的是「这是应用生成的初始内容」的基线（首次同步据此认出本机没有真实数据）
        expect(readRaw(key)).not.toBeNull()
        expect(readRaw(`${prefix}:seedText`)).toContain(key)
        return
      }
      expect(count()).toBe(0)
      expect(readRaw(key)).toBeNull()
    },
  )
})

describe('逐域最小规范化：认得出的留下，认不出的丢弃，缺的字段不臆造', () => {
  it('学生：非对象条目丢弃；缺姓名 / 缺学号的记录**留着**，各自给空串（不臆造、也不丢人）', () => {
    browser.localStorage.seed(
      STUDENTS_KEY,
      JSON.stringify([
        { id: 's1', name: '旦增卓玛', studentNo: '0101' },
        { id: 's2', studentNo: '0102' },
        null,
        '不是对象',
      ]),
    )

    const students = useStudentStore().students

    // 丢弃只发生在「压根不是一条记录」时：认得出是一个学生就留着，教师才有机会补姓名
    expect(students.map((item) => item.id)).toEqual(['s1', 's2'])
    expect(students[0]!.studentNo).toBe('0101')
    // 空串而不是 undefined：座位图 / 值日卡片在渲染路径上直接 `name.charAt(0)`，
    // undefined 会抛错把整页打断（同 `studentNo` 那条守卫的理由）
    expect(students[1]!.name).toBe('')
  })

  it('学生：缺学号的老记录给空串，且不凭空补性别 / 干部等业务字段', () => {
    browser.localStorage.seed(STUDENTS_KEY, JSON.stringify([{ id: 's1', name: '旦增卓玛' }]))

    const student = useStudentStore().students[0]!

    expect(student.studentNo).toBe('')
    expect(student.gender).toBeUndefined()
    expect(student.cadreRole).toBeUndefined()
    expect(student.deletedAt).toBeUndefined()
  })

  it('学生：已退档（软删除）的记录照常读回来，不被当成脏数据清掉', () => {
    browser.localStorage.seed(
      STUDENTS_KEY,
      JSON.stringify([{ id: 's1', name: '旦增卓玛', deletedAt: '2026-01-01T00:00:00.000Z' }]),
    )

    const store = useStudentStore()

    expect(store.students).toHaveLength(1)
    expect(store.activeStudents).toHaveLength(0)
  })

  it('学生：宿舍非固定清单内的值被清空，清单内的值原样保留', () => {
    browser.localStorage.seed(
      STUDENTS_KEY,
      JSON.stringify([
        { id: 's1', name: '甲', gender: 'male', dormitory: '3 号楼 412' },
        { id: 's2', name: '乙', gender: 'female', dormitory: '女生2栋113' },
        { id: 's3', name: '丙', gender: 'female', dormitory: '男生1栋209' },
      ]),
    )

    const students = useStudentStore().students

    // Phase 5A 起宿舍是固定 8 间的下拉，历史自由文本留着就是界面上一个选不中的值
    expect(students[0]!.dormitory).toBeUndefined()
    expect(students[1]!.dormitory).toBe('女生2栋113')
    // 性别与房间对不上同样不合法：女生不能住男生楼
    expect(students[2]!.dormitory).toBeUndefined()
  })

  it('学生：宿舍收敛是幂等的——合法值在一次重载之后依然在', () => {
    browser.localStorage.seed(
      STUDENTS_KEY,
      JSON.stringify([{ id: 's1', name: '甲', gender: 'female', dormitory: '女生2栋114' }]),
    )
    expect(useStudentStore().students[0]!.dormitory).toBe('女生2栋114')

    // 重新装载一次（模拟刷新页面 / 新设备拉回云端那份）。
    // 收敛写在 normalizeStudent 里，它同时跑在首屏加载、跨标签页同步、云同步三条路径上——
    // 一旦有人把它改成「无条件清空」，教师刚选好的宿舍会在下一次同步时凭空消失，
    // 而界面上只表现为「宿舍又没了」，看不出是谁清的
    setActivePinia(createPinia())
    expect(useStudentStore().students[0]!.dormitory).toBe('女生2栋114')
  })

  it('学生：空学号不参与查重——第二个还没填学号的学生也要能存进去', () => {
    browser.localStorage.seed(STUDENTS_KEY, JSON.stringify([]))
    const store = useStudentStore()

    expect(store.addStudent({ name: '甲', studentNo: '', gender: 'female' })).toBeDefined()
    // 空串不是一个可用的身份键。若拿它互相判重，教师导入一份学号列空着的名单时，
    // 第一个学生之后每一个都会被拒绝写入
    expect(store.addStudent({ name: '乙', studentNo: '', gender: 'male' })).toBeDefined()
    // 非空学号照旧拦重复
    expect(store.addStudent({ name: '丙', studentNo: '0101', gender: 'male' })).toBeDefined()
    expect(store.addStudent({ name: '丁', studentNo: '0101', gender: 'male' })).toBeUndefined()
  })

  it('课程表：非法星期 / 节次 / 缺科目或班级的条目逐条丢弃，合法的留下', () => {
    browser.localStorage.seed(
      `${prefix}:timetable`,
      JSON.stringify([
        { id: 'l1', weekday: 1, period: 1, subject: '语文', className: '高一(1)班' },
        { id: 'l2', weekday: 8, period: 1, subject: '语文', className: '高一(1)班' },
        { id: 'l3', weekday: '1', period: 1, subject: '语文', className: '高一(1)班' },
        { id: 'l4', weekday: 2, period: 0, subject: '语文', className: '高一(1)班' },
        { id: 'l5', weekday: 2, period: 1, subject: '', className: '高一(1)班' },
        { id: 'l6', weekday: 2, period: 1, subject: '数学', className: '' },
        { id: 'l7', weekday: 3, period: 2, subject: '英语', className: '高一(2)班' },
      ]),
    )

    const lessons = useTimetableStore().lessons

    expect(lessons.map((item) => item.id)).toEqual(['l1', 'l7'])
  })

  it('课程表：班级号由班级名重新派生（篡改的 classId 被纠正，两者不会各说各话）', () => {
    browser.localStorage.seed(
      `${prefix}:timetable`,
      JSON.stringify([
        {
          id: 'l1',
          weekday: 1,
          period: 1,
          subject: '语文',
          className: '高一(1)班',
          classId: '假的班级号',
        },
      ]),
    )

    const lesson = useTimetableStore().lessons[0]!

    expect(lesson.classId).not.toBe('假的班级号')
    expect(lesson.classId).toBeTruthy()
  })

  it('课程表：同一 id 重复出现时只保留首条（重复 id 会让列表的 v-for key 冲突）', () => {
    browser.localStorage.seed(
      `${prefix}:timetable`,
      JSON.stringify([
        { id: 'l1', weekday: 1, period: 1, subject: '语文', className: '高一(1)班' },
        { id: 'l1', weekday: 2, period: 1, subject: '数学', className: '高一(1)班' },
      ]),
    )

    const lessons = useTimetableStore().lessons

    expect(lessons).toHaveLength(1)
    expect(lessons[0]!.subject).toBe('语文')
  })

  it('座位方案：同屏只能有一个「当前方案」（多个 isCurrent 时只留第一个）', () => {
    browser.localStorage.seed(
      `${prefix}:seatPlans`,
      JSON.stringify([
        { id: 'p1', name: '方案一', isCurrent: true, seats: [] },
        { id: 'p2', name: '方案二', isCurrent: true, seats: [] },
      ]),
    )

    const store = useSeatStore()

    expect(store.plans.filter((plan) => plan.isCurrent)).toHaveLength(1)
    expect(store.currentPlan?.id).toBe('p1')
    expect(store.plans).toHaveLength(2)
  })

  it('值日：设置记录是单例（重复的只认第一条），组名缺失不丢组（丢组等于把组员编排一起丢了）', () => {
    browser.localStorage.seed(
      `${prefix}:duty`,
      JSON.stringify([
        { id: 'a', kind: 'settings', startDate: '2026-09-01', startGroupId: 'g1' },
        { id: 'b', kind: 'settings', startDate: '2026-10-01', startGroupId: 'g2' },
        { id: 'g1', kind: 'group', name: '第一组', studentIds: ['s1', 's1', 's2'] },
        { id: 'g2', kind: 'group', name: '', studentIds: [] },
        { id: 'x', kind: '别的类型' },
      ]),
    )

    const store = useDutyStore()

    expect(store.settings.startDate).toBe('2026-09-01')
    expect(store.groups.map((group) => group.id)).toEqual(['g1', 'g2'])
    expect(store.groups[0]!.studentIds).toEqual(['s1', 's2'])
  })

  it('周末返家：同一学生同一周末只留一条、同一 id 只留一条（否则人数会算多、留校算少）', () => {
    browser.localStorage.seed(
      `${prefix}:weekendReturns`,
      JSON.stringify([
        { id: 'r1', studentId: 's1', weekendDate: '2026-09-12', studentName: '甲（0101）' },
        { id: 'r2', studentId: 's1', weekendDate: '2026-09-12', studentName: '甲（0101）' },
        { id: 'r1', studentId: 's2', weekendDate: '2026-09-12', studentName: '乙（0102）' },
        { id: 'r3', studentId: 's3', weekendDate: '不是周末', studentName: '丙（0103）' },
        { id: 'r4', weekendDate: '2026-09-12', studentName: '丁（0104）' },
      ]),
    )

    const records = useWeekendStore().records

    expect(records).toHaveLength(1)
    expect(records[0]!.studentId).toBe('s1')
    // 认不出的日期 / 缺学生主键一律丢弃，不猜一个周末给他补上
    expect(records.some((item) => item.studentId === 's3')).toBe(false)
  })

  it('周末返家：既不在档案里、自己又没有姓名快照的记录丢弃（列出来也不知道是谁）', () => {
    browser.localStorage.seed(
      `${prefix}:weekendReturns`,
      JSON.stringify([
        { id: 'r1', studentId: '不在档案里的人', weekendDate: '2026-09-12' },
        // 换一个周末：同学生同周末的重复项会被去重规则先吃掉，测不到姓名这条
        { id: 'r2', studentId: '不在档案里的人', weekendDate: '2026-09-19', studentName: '甲' },
      ]),
    )

    const records = useWeekendStore().records

    // 有姓名快照的留下（学生被删后快照冻结，正是它存在的意义）；两处都拿不到姓名的丢
    expect(records.map((item) => item.id)).toEqual(['r2'])
  })

  it('座位约束：认不出的类型 / 缺学生主键的条目丢弃，enabled 只有明确 false 才算关闭', () => {
    browser.localStorage.seed(
      `${prefix}:seatConstraints`,
      JSON.stringify([
        { id: 'c1', studentA: 's1', studentB: 's2', type: 'no-deskmate', enabled: false },
        { id: 'c2', studentA: 's1', type: '编不出来' },
        { id: 'c3', type: 'no-adjacent' },
      ]),
    )

    const items = useConstraintStore().items

    expect(items.map((item) => item.id)).toEqual(['c1'])
    expect(items[0]!.enabled).toBe(false)
  })
})
