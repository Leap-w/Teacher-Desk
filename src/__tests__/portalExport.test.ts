import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  buildPortalSnapshot,
  formatLocalDateTime,
  inferClassName,
  type BuildSnapshotInput,
} from '@/utils/portalHtml/portalSnapshot'
import { buildPortalHtml, serializeSnapshot } from '@/utils/portalHtml/buildPortalHtml'
import type { Lesson } from '@/types/timetable'
import type { Student } from '@/types'
import type { Seat } from '@/types/seat'

function lesson(overrides: Partial<Lesson>): Lesson {
  return {
    id: 'l1',
    weekday: 1,
    periodId: 'morning',
    subject: '语文',
    classId: '',
    className: '高一9班',
    teacher: '陈老师',
    type: 'normal',
    ...overrides,
  }
}

function student(overrides: Partial<Student>): Student {
  return {
    id: 's1',
    name: '张三',
    studentNo: '1',
    gender: 'male',
    ...overrides,
  }
}

function seat(row: number, col: number, studentId?: string): Seat {
  return { id: `r${row}c${col}`, row, col, block: 'left', ...(studentId ? { studentId } : {}) }
}

const fixedNow = new Date(2026, 10, 20, 9, 5)

function baseInput(overrides: Partial<BuildSnapshotInput> = {}): BuildSnapshotInput {
  return {
    students: [student({ id: 's1', name: '张三' }), student({ id: 's2', name: '李四' })],
    lessons: [
      lesson({ weekday: 1, periodId: 'morning', subject: '语文' }),
      lesson({ id: 'l2', weekday: 1, periodId: 'p2', subject: '数学', type: 'substitute' }),
      lesson({ id: 'l3', weekday: 3, periodId: 'p5', subject: '英语' }),
      lesson({
        id: 'l4',
        weekday: 1,
        periodId: 'morning',
        subject: '别班课',
        className: '高一7班',
      }),
    ],
    seats: [seat(1, 1, 's1'), seat(1, 2, 's2'), seat(1, 9)],
    photos: [
      {
        photoId: 'p1',
        studentId: 's1',
        studentName: '张三',
        category: 'id-photo' as const,
        dataUrl: 'data:image/jpeg;base64,AAAA',
      },
    ],
    className: '高一9班',
    generatedAt: fixedNow,
    ...overrides,
  }
}

describe('单文件 HTML 导出 · 数据映射', () => {
  it('课表只保留目标班级，并按时段序号排列；代课有变更标记', () => {
    const snap = buildPortalSnapshot(baseInput())
    const monday = snap.week.find((day) => day.weekday === 1)!
    expect(monday.items.map((item) => item.subject)).toEqual(['语文', '数学'])
    expect(monday.items[1]?.changeLabel).toBe('代课')
    expect(snap.week.find((day) => day.weekday === 2)!.items).toHaveLength(0)
    // 别班课程没有混入
    expect(snap.week.flatMap((day) => day.items).some((item) => item.subject === '别班课')).toBe(
      false,
    )
  })

  it('时段来自 COURSE_PERIODS：10 段，早自习=1，晚自习3=10', () => {
    const snap = buildPortalSnapshot(baseInput())
    expect(snap.periods).toHaveLength(10)
    expect(snap.periods[0]).toMatchObject({ id: 1, name: '早自习及第一节' })
    expect(snap.periods[9]?.id).toBe(10)
  })

  it('座位只给活跃学生，固定空位与非活跃学生置空', () => {
    const snap = buildPortalSnapshot(
      baseInput({
        students: [student({ id: 's1', name: '张三' })],
        seats: [seat(1, 1, 's1'), seat(1, 2, 's2'), seat(1, 9)],
      }),
    )
    expect(snap.seats.find((s) => s.row === 1 && s.col === 1)?.studentId).toBe('s1')
    expect(snap.seats.find((s) => s.row === 1 && s.col === 2)?.studentId).toBeNull()
    expect(snap.seats.find((s) => s.row === 1 && s.col === 9)?.studentId).toBeNull()
  })

  it('照片只收活跃学生的当前证件照，按姓名排序；无字节的被丢弃', () => {
    const snap = buildPortalSnapshot(
      baseInput({
        photos: [
          {
            photoId: 'p2',
            studentId: 's2',
            studentName: '李四',
            category: 'id-photo' as const,
            dataUrl: 'data:image/png;base64,BBBB',
          },
          {
            photoId: 'p1',
            studentId: 's1',
            studentName: '张三',
            category: 'id-photo' as const,
            dataUrl: 'data:image/jpeg;base64,AAAA',
          },
          {
            photoId: 'p3',
            studentId: 's2',
            studentName: '李四',
            category: 'life-photo' as const,
            dataUrl: '',
          },
          {
            photoId: 'p4',
            studentId: 'ghost',
            studentName: '幽灵',
            category: 'id-photo' as const,
            dataUrl: 'data:image/png;base64,CCCC',
          },
        ],
      }),
    )
    // 与 Portal 云函数一致，按 zh-CN（拼音）排序：李四(li) 在 张三(zhang) 之前
    expect(snap.photos.map((p) => p.title)).toEqual(['李四', '张三'])
    expect(snap.photos[0]?.url).toContain('data:image/png;base64,')
  })

  it('一名学生的多张照片 id 唯一、类型据实保留（证件照 / 生活照）', () => {
    const snap = buildPortalSnapshot(
      baseInput({
        photos: [
          {
            photoId: 'life-1',
            studentId: 's1',
            studentName: '张三',
            category: 'life-photo',
            dataUrl: 'data:image/png;base64,BBBB',
          },
          {
            photoId: 'id-1',
            studentId: 's1',
            studentName: '张三',
            category: 'id-photo',
            dataUrl: 'data:image/jpeg;base64,AAAA',
          },
        ],
      }),
    )
    expect(snap.photos).toHaveLength(2)
    expect(new Set(snap.photos.map((photo) => photo.id)).size).toBe(2)
    expect(snap.photos.map((photo) => photo.category)).toEqual(['id-photo', 'life-photo'])
  })

  it('学生投影保留班级职务，但内部备注 remark 不进入快照（bio 留空）', () => {
    const snap = buildPortalSnapshot(
      baseInput({
        students: [
          student({
            id: 's1',
            name: '张三',
            cadreRole: '班长',
            remark: '单亲，情绪不稳，注意家长沟通',
          }),
        ],
      }),
    )
    expect(snap.students[0]).toMatchObject({ duty: '班长' })
    expect(snap.students[0]?.bio).toBeUndefined()
    expect(JSON.stringify(snap)).not.toContain('单亲')
    expect(JSON.stringify(snap)).not.toContain('家长沟通')
  })

  it('班级推断：显式优先；否则取出现最多的 className', () => {
    const lessons = baseInput().lessons
    expect(inferClassName(lessons, '9班')).toBe('9班')
    expect(inferClassName(lessons)).toBe('高一9班') // 3:1
  })

  it('更新时间用本地日历日，不用 UTC', () => {
    expect(formatLocalDateTime(fixedNow)).toBe('2026-11-20 09:05')
  })
})

describe('单文件 HTML 导出 · HTML 组装', () => {
  it('序列化转义 < ，防止数据里的 </script> 提前闭合脚本', () => {
    const snap = buildPortalSnapshot(
      baseInput({ students: [student({ id: 's1', name: '</script><script>alert(1)</script>' })] }),
    )
    const literal = serializeSnapshot(snap)
    expect(literal).not.toContain('</script>')
    expect(literal).toContain('\\u003c/script>')
  })

  it('产物是单文件：CSS 内联、快照注入、JS 内联，无外部资源引用', () => {
    const snap = buildPortalSnapshot(baseInput())
    const html = buildPortalHtml({ data: snap, css: '.x{color:red}', js: 'console.log(1)' })
    expect(html).toContain('<style>.x{color:red}</style>')
    expect(html).toContain('window.__PORTAL_SNAPSHOT__ =')
    expect(html).toContain('<script>console.log(1)</script>')
    expect(html).toContain('<div id="app"></div>')
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect(html).not.toMatch(/<link[^>]+stylesheet/)
    expect(html).not.toMatch(/(src|href)="https?:\/\//)
  })
})

/** 源码级断言先剥注释：注释里提到关键词会误伤 not.toContain。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function readRepoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8')
}

describe('门户 UI 已并入 TeacherDesk（不再依赖独立 Portal 项目）', () => {
  it('构建脚本只从仓库内 portal-ui/ 构建，没有外部 Portal 目录/环境变量', () => {
    const code = stripComments(readRepoFile('scripts/build-portal-assets.cjs'))
    expect(code).toContain('portal-ui')
    expect(code).toContain('vite.config.ts')
    expect(code).not.toContain('PORTAL_DIST')
    expect(code).not.toContain('TeacherDesk-Class-Portal')
    expect(code).not.toContain('Codex')
  })

  it('内置 UI 源码五个页面与底座齐全，且不含登录/鉴权/网络数据路径', () => {
    for (const file of [
      'App.vue',
      'main.ts',
      'components/BottomNav.vue',
      'components/Icon.vue',
      'components/SeatBoard.vue',
      'components/SeatViewToggle.vue',
      'components/StudentSheet.vue',
      'views/HomeView.vue',
      'views/ScheduleView.vue',
      'views/StudentsView.vue',
      'views/SeatsView.vue',
      'views/PhotosView.vue',
      'styles/tokens.css',
      'styles/base.css',
      'data/index.ts',
      'utils/seatView.ts',
      'composables/useFullscreenSession.ts',
    ]) {
      expect(() => readRepoFile(`portal-ui/src/${file}`), `缺少内置 UI 源码 ${file}`).not.toThrow()
    }
    const app = stripComments(readRepoFile('portal-ui/src/App.vue'))
    expect(app).not.toContain('AuthGate')
    expect(app).not.toContain('DataGate')
    const data = stripComments(readRepoFile('portal-ui/src/data/index.ts'))
    expect(data).toContain('__PORTAL_SNAPSHOT__')
    expect(data).not.toContain('fetch(')
    expect(data).not.toContain('/api')
    expect(data).not.toContain('VITE_AUTH_MODE')
  })

  it('固化资源由内置源码重新生成：无登录/鉴权代码残留，只读快照入口仍在', () => {
    const assets = stripComments(readRepoFile('src/utils/portalHtml/portalAssets.ts'))
    expect(assets).toContain('__PORTAL_SNAPSHOT__')
    for (const banned of ['密码', '登录', 'auth-screen', '退出全部设备', '/api', 'fetch(']) {
      expect(assets).not.toContain(banned)
    }
  })

  it('座位姓名完整显示：源码与固化资源都不含姓名截断', () => {
    const source = stripComments(readRepoFile('portal-ui/src/components/SeatBoard.vue'))
    expect(source).not.toMatch(/\.name\.slice\(/)
    expect(source).not.toContain('text-overflow: ellipsis')
    expect(source).toContain('seat-name')
    // 全屏座格只有 30–40px：必须有独立的小字号规则，9 字姓名才不会溢出成 4 行。
    expect(source).toContain('.seat-board.is-fullscreen .seat .seat-name')
    expect(source).toContain('clamp(7px, calc(var(--seat-size) * 0.23), 11px)')
    const css = stripComments(readRepoFile('src/utils/portalHtml/portalAssets.ts'))
    expect(css).not.toContain('name.slice(0,3)')
    expect(css).not.toContain('name.slice(0, 3)')
  })

  it('照片墙区分空数据与搜索无结果，且搜索与文案都只承诺姓名', () => {
    const source = stripComments(readRepoFile('portal-ui/src/views/PhotosView.vue'))
    expect(source).toContain('暂无学生照片')
    expect(source).toContain('没有找到这位同学')
    // 只按姓名搜索：源码里不得再匹配内部 ID。
    expect(source).toContain('item.student.name.toLocaleLowerCase().includes(needle)')
    expect(source).not.toContain('student.id.toLocaleLowerCase()')
    // 占位提示、aria 标签与标题都不能承诺学号 / 当前证件照。
    expect(source).not.toContain('搜索学生姓名或学号')
    expect(source).not.toContain('学生证件照')
    expect(source).toContain('placeholder="搜索学生姓名"')
    expect(source).toContain('<h1>学生照片</h1>')
  })

  it('对外文档不再承诺照片墙支持学号搜索', () => {
    const readme = readRepoFile('README.md')
    const readme391 = readme.slice(readme.indexOf('**v3.9.1**'), readme.indexOf('**v3.9.0**'))
    expect(readme391).toContain('仅按学生姓名搜索')
    expect(readme391).not.toContain('按姓名或学号搜索')

    const changelog = readRepoFile('docs/CHANGELOG.md')
    const section391 = changelog.slice(
      changelog.indexOf('## v3.9.1'),
      changelog.indexOf('## v3.9.0'),
    )
    expect(section391).toContain('只按学生姓名')
    expect(section391).not.toContain('搜索同时匹配姓名与学号')
  })
})
