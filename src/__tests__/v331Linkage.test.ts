/**
 * v3.3.1 §六：数据联动检查——把改动散落各处之后**接缝**上那几根线钉住。
 *
 * 这一版没有新模块，风险不在「某个函数算错了」，而在「某处没接上」：
 * 周末加了课首页认不认、清空课表会不会把作息一起清掉、导出图会不会漏画门窗、
 * 重名消歧是不是全站真的只剩一条规则。规则本身的正确性由各自的测试负责
 * （`timetable.test.ts` / `seatPlan.test.ts` / `studentName.test.ts`），
 * 本文件只验**接线**——因此除了两处 store 级行为（周末取课、清空课表）之外，
 * 其余走源码级断言：这里要防的是「改错了地方」，不是「算错了数」。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { useAppSettingsStore } from '@/stores/appSettings'
import { useTimetableStore } from '@/stores/timetable'
import { useNow } from '@/composables/useToday'
import { viewRoomItems } from '@/utils/seatView'
import { classIdOf } from '@/utils/timetable'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { LessonInput } from '@/types/timetable'

/* 2026-09-19 是星期六、2026-09-20 是星期日（课表 weekday 记作 6 / 7） */
const SATURDAY = new Date('2026-09-19T09:00:00')
const SUNDAY = new Date('2026-09-20T09:00:00')

const LESSONS_KEY = `${appConfig.storageKeyPrefix}:timetable`
const EXCHANGES_KEY = `${appConfig.storageKeyPrefix}:timetable:exchanges`

let browser: ReturnType<typeof installFakeBrowser>

beforeEach(() => {
  browser = installFakeBrowser()
  // 首次启动会播种示例课表（12 节）——本文件测的是「我加的这两节」，
  // 与示例数据混在一起会让条数断言变成对播种逻辑的断言
  browser.localStorage.seed(LESSONS_KEY, JSON.stringify([]))
  browser.localStorage.seed(EXCHANGES_KEY, JSON.stringify([]))
  setActivePinia(createPinia())
})

const CLASS_NAME = '高一9班'

function lesson(
  weekday: 1 | 2 | 3 | 6 | 7,
  periodId: LessonInput['periodId'],
  subject: string,
): LessonInput {
  return {
    weekday,
    periodId,
    subject,
    // classId 由班级名派生（班级名是唯一事实来源），写死别的值 store 会直接拒收
    classId: classIdOf(CLASS_NAME),
    className: CLASS_NAME,
    teacher: '我',
    type: 'normal',
  }
}

/* ==================== ① 周末课程 → 首页今日课程 ==================== */

describe('周六 / 周日的课会出现在首页「今日课程」里', () => {
  it('星期六：todayWeekday 是 6，当天排在周六的课进 todayLessons', () => {
    const store = useTimetableStore()
    store.addLesson(lesson(6, 'p2', '数学'))
    store.addLesson(lesson(1, 'p2', '语文'))

    // 时钟是全应用共用那一个 ref（useNow），直接改它 = 把日期挪到周六
    useNow().value = SATURDAY

    expect(store.todayWeekday).toBe(6)
    expect(store.todayLabel).toBe('星期六')
    expect(store.todayLessons.map((item) => item.subject)).toEqual(['数学'])
  })

  it('星期日：JS 的 getDay() 是 0，课表要认成 7（周日排过课的班级不在少数）', () => {
    const store = useTimetableStore()
    store.addLesson(lesson(7, 'evening1', '晚自习辅导'))
    store.addLesson(lesson(6, 'p2', '数学'))

    useNow().value = SUNDAY

    expect(store.todayWeekday).toBe(7)
    expect(store.todayLabel).toBe('星期日')
    expect(store.todayLessons.map((item) => item.subject)).toEqual(['晚自习辅导'])
  })

  it('首页读的是 todayLessons，不是「周一到周五」写死的某一列', () => {
    const source = readFileSync('src/views/Home/components/TodayScheduleCard.vue', 'utf8')
    expect(source).toContain('timetableStore.todayLessons')
    expect(source).toContain('timetableStore.todayWeekday')
    // 周末不再是「特殊的一天」：卡片只是换一句提示语，课程照常按同一份数据渲染
    expect(source).not.toContain('lessonsOf(1)')
  })

  it('周课表七天全画（周六 / 周日不再靠「有课才追加一列」忽隐忽现）', () => {
    // 列清单由页面（`WEEKDAYS` = 周一…周日）传给网格组件：七列是固定的，
    // 不随「这周周末有没有课」增减——周末没课时教师也得找得到那个能点的空格子
    const page = readFileSync('src/views/Schedule/index.vue', 'utf8')
    expect(page).toContain('WEEKDAYS')
    expect(page).toContain(':weekdays="columns"')
    const grid = readFileSync('src/views/Schedule/components/ScheduleWeekGrid.vue', 'utf8')
    expect(grid).toContain('weekdays')
    expect(grid).not.toContain('WEEKDAY_COLUMNS')
  })
})

/* ==================== ② 清空课程 → Store 同步、作息不动 ==================== */

describe('「删除所有课程」清的是课表，不碰课程时间设置', () => {
  it('课程与换课记录一起清空，条数如实返回', () => {
    const store = useTimetableStore()
    store.addLesson(lesson(1, 'p2', '语文'))
    store.addLesson(lesson(1, 'p3', '数学'))
    const moved = store.lessons[1]!
    expect(
      store.exchangeLesson({ lessonId: moved.id, to: { weekday: 3, periodId: 'p5' } }).ok,
    ).toBe(true)
    expect(store.exchanges.length).toBe(1)

    const removed = store.clearLessons()

    expect(removed).toBe(2)
    expect(store.lessons).toEqual([])
    // 只清课程会让原时间一直挂着「已调走」的标记，教师会以为课还在
    expect(store.exchanges).toEqual([])
    expect(store.weekLessonCount).toBe(0)
    expect(store.todayLessons).toEqual([])
  })

  it('课程时间设置原样保留（需求点名的一条：作息和课表是两份东西）', () => {
    const appSettings = useAppSettingsStore()
    appSettings.updatePeriodTime('morning', { start: '07:30', end: '08:55' })
    const before = appSettings.periods.map((period) => ({ ...period }))
    expect(appSettings.periodOverrideCount).toBe(1)

    const store = useTimetableStore()
    store.addLesson(lesson(2, 'p2', '英语'))
    store.clearLessons()

    expect(appSettings.periods).toEqual(before)
    // 首页「当前 / 下一节课」读的也是这份作息，清课之后判定依据不变
    expect(appSettings.periods[0]!.startTime).toBe('07:30')
  })

  it('设置页调的是 store 的 clearLessons，且二次确认文案与需求一致', () => {
    const source = readFileSync('src/views/My/settings/TeachingSettings.vue', 'utf8')
    expect(source).toContain('timetableStore.clearLessons()')
    expect(source).toContain('将删除课程表中的全部课程，此操作不可撤销。')
    // 危险批量写要走长事务锁（写入期间自动同步只记账不推送）
    expect(source).toContain("runLockedOperation('course-clear'")
    // 本地清一遍、store 不知道的写法就是 §六 要防的「Store 不同步」
    expect(source).not.toContain('lessons = []')
  })
})

/* ==================== ③ 导出座位图：两种视角都画全门窗 ==================== */

describe('导出座位图的两种视角都不漏画门窗', () => {
  it('讲台 + 前门、后门在老师 / 学生两个视角里各出现且只出现一次', () => {
    for (const view of ['teacher', 'student'] as const) {
      const items = viewRoomItems(view, DEFAULT_CLASSROOM_CONFIG)
      expect(items.filter((item) => item.kind === 'front-line')).toHaveLength(1)
      expect(items.filter((item) => item.kind === 'door-back')).toHaveLength(1)
      // 座位行一个不少（漏一行 = 导出图少一排人）
      expect(items.filter((item) => item.kind === 'row')).toHaveLength(
        DEFAULT_CLASSROOM_CONFIG.rows,
      )
    }
  })

  it('导出图与页面共用同一份排布真源，且四种房间元素都渲染了', () => {
    const source = readFileSync('src/views/Seats/components/SeatExportGraphic.vue', 'utf8')
    // 共用真源：导出图和屏幕上看到的必须是同一间教室（各画一份迟早分叉）
    for (const shared of ['viewRoomItems', 'viewRowUnits', 'viewColUnits']) {
      expect(source).toContain(shared)
    }
    for (const marker of ['讲台', '前门', '后门', '窗']) {
      expect(source).toContain(marker)
    }
    expect(source).toContain('doorSidesOf')
    expect(source).toContain('windowSideOf')
  })

  it('导出入口把两种视角都递给了导出图（视角选择不该是摆设）', () => {
    const source = readFileSync('src/views/Seats/index.vue', 'utf8')
    expect(source).toContain('SeatExportGraphic')
    expect(source).toContain("'teacher'")
    expect(source).toContain("'student'")
  })
})

/* ==================== ④ 重名消歧全站只剩一条规则 ==================== */

describe('重名显示全站统一（不留旧口径的尾巴）', () => {
  /** 递归收集 src 下的 .vue / .ts（跳过测试自身，那里的字符串是断言不是实现） */
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        if (entry !== '__tests__') sourceFiles(path, out)
      } else if (entry.endsWith('.vue') || entry.endsWith('.ts')) {
        out.push(path)
      }
    }
    return out
  }

  it('全项目没有人再调用已删除的 formatStudentDisplayName', () => {
    const hits = sourceFiles('src').filter((path) =>
      readFileSync(path, 'utf8').includes('formatStudentDisplayName'),
    )
    expect(hits).toEqual([])
  })

  it('disambiguatorOf 只认身份证尾号：值日组与学号都不再参与', () => {
    const source = readFileSync('src/utils/student.ts', 'utf8')
    const start = source.indexOf('export function disambiguatorOf(')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, source.indexOf('\n}', start))
    expect(body).toContain('idCardSuffixOf')
    expect(body).not.toContain('dutyGroup')
    expect(body).not.toContain('studentNo')
  })

  it('座位图页面与导出图都按同一份名册算重名计数', () => {
    for (const path of [
      'src/views/Seats/components/SeatClassroom.vue',
      'src/views/Seats/components/SeatExportGraphic.vue',
    ]) {
      const source = readFileSync(path, 'utf8')
      expect(source).toContain('buildNameCounts')
      expect(source).toContain('formatStudentShortName')
    }
  })

  it('「重名几人」「第 X 组」两类旧文案都不再出现在档案界面', () => {
    for (const path of [
      'src/views/Students/index.vue',
      'src/views/Students/components/StudentCard.vue',
      'src/views/Students/components/StudentDetailModal.vue',
    ]) {
      const source = readFileSync(path, 'utf8')
      expect(source).not.toContain('重名 {{')
      expect(source).not.toContain('同名 {{')
      expect(source).not.toContain('duplicateCount')
    }
  })
})
