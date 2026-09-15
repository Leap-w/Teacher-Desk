/**
 * 重名消歧与身份证尾号（v3.3.1 §四）。
 *
 * 这一版把「重名怎么显示」从「一律拼学号后四位」改成了
 * 「不重名只有姓名；重名且填了身份证尾号 → 姓名（尾号）」，
 * 并且**撤掉了值日组与学号两条回落**。规则只有一份实现
 * （`utils/student.ts` 的 `formatStudentShortName`），所以这里测的是它，
 * 再加上「各条渲染链路确实调了它」的接线检查——规则对了但某处没接上，
 * 教师看到的仍然是两个分不清的「旦增卓玛」。
 */
import { readFileSync } from 'node:fs'

import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import {
  buildDutyGroupNameById,
  buildNameCounts,
  disambiguatorOf,
  formatStudentShortName,
  normalizeStudent,
} from '@/utils/student'
import { compareSeatPlans } from '@/utils/seat'
import { useStudentStore } from '@/stores/student'
import type { Student } from '@/types'

const prefix = appConfig.storageKeyPrefix
const STUDENTS_KEY = `${prefix}:students`

let browser: FakeBrowser

beforeEach(() => {
  browser = installFakeBrowser()
  setActivePinia(createPinia())
})

function makeStudent(id: string, name: string, extra: Partial<Student> = {}): Student {
  return { id, name, studentNo: '', gender: 'female', ...extra }
}

/** 一对同名学生：只有身份证尾号不同 */
const TWINS: Student[] = [
  makeStudent('t-1', '旦增卓玛', { idCardSuffix: '3287' }),
  makeStudent('t-2', '旦增卓玛', { idCardSuffix: '6145' }),
]

describe('normalizeStudent：身份证尾号的收敛', () => {
  it('去首尾空白、超长截到 4 位（外部导入写多了一律截断，不整条拒绝）', () => {
    expect(normalizeStudent(makeStudent('a', '甲', { idCardSuffix: ' 3287 ' })).idCardSuffix).toBe(
      '3287',
    )
    expect(
      normalizeStudent(makeStudent('b', '乙', { idCardSuffix: '3287 额外' })).idCardSuffix,
    ).toBe('3287')
    expect(
      normalizeStudent(makeStudent('c', '丙', { idCardSuffix: '18 位身份证号' })).idCardSuffix,
    ).toBe('18 位')
  })

  it('不做数字校验——身份证尾号可能是 X', () => {
    expect(normalizeStudent(makeStudent('a', '甲', { idCardSuffix: '32X7' })).idCardSuffix).toBe(
      '32X7',
    )
  })

  it("空串 / 纯空白 / 非字符串一律删除该键（不留 `''` 这种半状态）", () => {
    for (const value of ['', '   ', undefined, 3287, null]) {
      const student = normalizeStudent(
        makeStudent('a', '甲', { idCardSuffix: value as string | undefined }),
      )
      expect('idCardSuffix' in student).toBe(false)
    }
  })

  it('收敛是幂等的：合法值重载一次之后仍在', () => {
    browser.localStorage.seed(
      STUDENTS_KEY,
      JSON.stringify([{ id: 's1', name: '甲', gender: 'female', idCardSuffix: ' 3287 ' }]),
    )
    expect(useStudentStore().students[0]!.idCardSuffix).toBe('3287')
    setActivePinia(createPinia())
    expect(useStudentStore().students[0]!.idCardSuffix).toBe('3287')
  })
})

describe('formatStudentShortName：全站唯一的姓名显示规则', () => {
  it('不重名 → 只有姓名（哪怕填了尾号）', () => {
    const solo = [makeStudent('s-1', '扎西顿珠', { idCardSuffix: '3287' })]
    expect(formatStudentShortName(solo[0]!, buildNameCounts(solo))).toBe('扎西顿珠')
  })

  it('重名且填了尾号 → 姓名（尾号），两个人各显各的', () => {
    const counts = buildNameCounts(TWINS)
    expect(formatStudentShortName(TWINS[0]!, counts)).toBe('旦增卓玛（3287）')
    expect(formatStudentShortName(TWINS[1]!, counts)).toBe('旦增卓玛（6145）')
  })

  it('重名但没填尾号 → 仍然只有姓名（不编造、不回落到学号）', () => {
    const twins = [
      makeStudent('n-1', '旦增卓玛', { studentNo: '0011' }),
      makeStudent('n-2', '旦增卓玛', { studentNo: '0012' }),
    ]
    const counts = buildNameCounts(twins)
    expect(formatStudentShortName(twins[0]!, counts)).toBe('旦增卓玛')
    // 学号后四位不再参与消歧——这是 v3.3.1 明确删掉的一条回落
    expect(formatStudentShortName(twins[0]!, counts)).not.toContain('0011')
  })

  it('三个人同名：填了尾号的显示尾号，没填的只有姓名', () => {
    const trio = [
      makeStudent('t-1', '旦增卓玛', { idCardSuffix: '3287' }),
      makeStudent('t-2', '旦增卓玛', { idCardSuffix: '6145' }),
      makeStudent('t-3', '旦增卓玛'),
    ]
    const counts = buildNameCounts(trio)
    expect(trio.map((student) => formatStudentShortName(student, counts))).toEqual([
      '旦增卓玛（3287）',
      '旦增卓玛（6145）',
      '旦增卓玛',
    ])
  })
})

describe('disambiguatorOf：值日组与学号两条回落都撤掉了', () => {
  it('值日组再也不是消歧依据（第 3 组下个月就不是了）', () => {
    const groups = [
      { name: '第1组', studentIds: ['t-1'] },
      { name: '第2组', studentIds: ['t-2'] },
    ]
    const groupNameById = buildDutyGroupNameById(groups)
    // 这个 map 仍然存在（档案卡要显示「在哪个组」），但它不再参与消歧
    expect(groupNameById.get('t-1')).toBe('第1组')
    expect(disambiguatorOf(TWINS[0]!, buildNameCounts(TWINS))).toBe('3287')
    expect(disambiguatorOf(TWINS[0]!, buildNameCounts(TWINS))).not.toBe('第1组')
  })
})

describe('学生档案的姓名渲染链路：全都接到了同一份规则', () => {
  const read = (path: string) => readFileSync(path, 'utf8')

  it('座位图（页面 + 导出图）都走 formatStudentShortName，且计数取自同一份名册', () => {
    for (const path of [
      'src/views/Seats/components/SeatClassroom.vue',
      'src/views/Seats/components/SeatExportGraphic.vue',
    ]) {
      const source = read(path)
      expect(source).toContain('formatStudentShortName')
      expect(source).toContain('buildNameCounts')
      // 格子里直接写 `student.name` 就是「两个旦增卓玛长得一模一样」的复发点
      expect(source).not.toContain('?.name ??')
    }
  })

  it('档案页与课堂工具共用 store 的重名计数，没有人自己数一遍', () => {
    expect(read('src/views/Students/index.vue')).toContain('studentStore.nameCounts')
    expect(read('src/views/Classroom/components/RandomPicker.vue')).toContain(
      'studentStore.nameCounts',
    )
    // 「同名 N 人」徽章撤掉了：消歧的答案就是姓名后面那个尾号，再说一遍只是占地方。
    // （只查渲染出来的文案与那个 prop，注释里提到它不算——注释恰恰是在解释为什么撤掉）
    for (const path of [
      'src/views/Students/components/StudentCard.vue',
      'src/views/Students/components/StudentProfileHeader.vue',
    ]) {
      const source = read(path)
      expect(source).not.toContain('同名 {{')
      expect(source).not.toContain('duplicateCount')
      expect(source).not.toContain('duplicate-count')
    }
  })

  it('软删除的学生不参与重名计数（删掉一个同名学生后，另一个不该还挂着括号）', () => {
    browser.localStorage.seed(STUDENTS_KEY, JSON.stringify([]))
    const store = useStudentStore()
    store.addStudent({
      name: '旦增卓玛',
      studentNo: '0011',
      gender: 'female',
      idCardSuffix: '3287',
    })
    store.addStudent({
      name: '旦增卓玛',
      studentNo: '0012',
      gender: 'female',
      idCardSuffix: '6145',
    })
    expect(store.nameCounts.get('旦增卓玛')).toBe(2)

    store.removeStudent(store.activeStudents[1]!.id)
    expect(store.nameCounts.get('旦增卓玛')).toBe(1)
    const only = store.activeStudents[0]!
    expect(formatStudentShortName(only, store.nameCounts)).toBe('旦增卓玛')
  })
})

describe('数据联动：尾号随学生数据流到座位方案对比', () => {
  it('方案对比里的学生名同样带尾号（换座前后对不上人等于白对比）', async () => {
    browser.localStorage.seed(STUDENTS_KEY, JSON.stringify([]))
    const store = useStudentStore()
    store.addStudent({
      name: '旦增卓玛',
      studentNo: '0011',
      gender: 'female',
      idCardSuffix: '3287',
    })
    store.addStudent({
      name: '旦增卓玛',
      studentNo: '0012',
      gender: 'female',
      idCardSuffix: '6145',
    })
    await nextTick()

    const students = new Map(store.activeStudents.map((student) => [student.id, student]))
    const [first, second] = store.activeStudents
    const planA = {
      id: 'p-a',
      name: 'A',
      seats: [{ id: '1-1', row: 1, col: 1, studentId: first!.id }],
      createdAt: '',
      updatedAt: '',
    }
    const planB = {
      id: 'p-b',
      name: 'B',
      seats: [
        { id: '1-1', row: 1, col: 1, studentId: second!.id },
        { id: '1-2', row: 1, col: 2, studentId: first!.id },
      ],
      createdAt: '',
      updatedAt: '',
    }

    const result = compareSeatPlans(planA as never, planB as never, students)
    expect(result.entries.map((entry) => entry.name).sort()).toEqual([
      '旦增卓玛（3287）',
      '旦增卓玛（6145）',
    ])
  })
})
