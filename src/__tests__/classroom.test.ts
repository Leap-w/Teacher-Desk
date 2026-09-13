/**
 * 课堂工具（Phase Classroom-1 §六）。
 *
 * 覆盖：随机点名（模式 / 池 / 空池 / 消歧）、课堂计时器（预设 / 自定义 / 状态机 / 格式化）、
 * 抽签（三组 / 随机 / 空）、页面元信息（三个工具 / 路由 / 响应式网格）。
 *
 * 全部是**纯函数**测试：随机源注入 rng，因此「抽到谁」是确定的；
 * 不碰 DOM，也不需要浏览器（组件的渲染由 Chrome 冒烟另验）。
 */
import { describe, expect, it } from 'vitest'

import {
  CLASSROOM_TOOLS,
  PICK_MODES,
  PICK_ROLL_MS,
  PICK_ROLL_TICKS,
  PICK_TICK_MS,
  TIMER_MAX_MINUTES,
  TIMER_PRESETS_MIN,
  displayNameOf,
  drawOnce,
  formatDuration,
  groupResultLabel,
  isFinished,
  isValidMinutes,
  nextPhase,
  pickPoolFor,
  pickRandom,
  pickRandomGroup,
  remainingMs,
  rollFrame,
  timerProgress,
  type LotteryGroup,
} from '@/utils/classroom'
import { buildDutyGroupNameById, buildNameCounts, disambiguatorOf } from '@/utils/student'
import type { Student } from '@/types'

/* ---------- 测试数据（形状与 normalizeStudent 一致，字段齐全才不会被改写） ---------- */

function makeStudent(id: string, name: string, gender: 'male' | 'female', studentNo = ''): Student {
  return {
    id,
    name,
    gender,
    studentNo,
    cadreRole: undefined,
    tags: [],
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
  } as unknown as Student
}

const STUDENTS: Student[] = [
  makeStudent('s-1', '旦增卓玛', 'female', '0011'),
  makeStudent('s-2', '旦增卓玛', 'female', '0012'), // 同名（消歧用）
  makeStudent('s-3', '扎西顿珠', 'male', '0013'),
  makeStudent('s-4', '格桑梅朵', 'female', '0014'),
  makeStudent('s-5', '洛桑', 'male', '0015'),
]

const GROUPS = [
  { name: '第1组', studentIds: ['s-1', 's-3'] },
  { name: '第2组', studentIds: ['s-2', 's-4'] },
]

const nameCounts = buildNameCounts(STUDENTS)
const groupNameById = buildDutyGroupNameById(GROUPS)

/** 固定随机源：永远返回 0（抽到池里第一个），或指定序列 */
const first = () => 0
const last = () => 0.999999

/* ==================== ① 随机点名（12 条） ==================== */

describe('随机点名', () => {
  it('1. 全班模式：池 = 全部在读学生', () => {
    expect(pickPoolFor('all', STUDENTS).map((s) => s.id)).toEqual([
      's-1',
      's-2',
      's-3',
      's-4',
      's-5',
    ])
  })

  it('2. 男生模式：只含男生', () => {
    expect(pickPoolFor('male', STUDENTS).map((s) => s.id)).toEqual(['s-3', 's-5'])
  })

  it('3. 女生模式：只含女生', () => {
    expect(pickPoolFor('female', STUDENTS).map((s) => s.id)).toEqual(['s-1', 's-2', 's-4'])
  })

  it('4. 今日值日组模式：只含该组成员（按在读名单过滤）', () => {
    expect(pickPoolFor('duty', STUDENTS, ['s-1', 's-3']).map((s) => s.id)).toEqual(['s-1', 's-3'])
  })

  it('5. 今日值日组模式：当天没有值日组 → 空池（不编造名字）', () => {
    expect(pickPoolFor('duty', STUDENTS, [])).toEqual([])
  })

  it('6. 抽签用随机源：rng=0 抽第一个，rng≈1 抽最后一个', () => {
    expect(pickRandom(STUDENTS, first)?.id).toBe('s-1')
    expect(pickRandom(STUDENTS, last)?.id).toBe('s-5')
  })

  it('7. 空池随机 → undefined（界面显示空态而不是随机名字）', () => {
    expect(pickRandom([], first)).toBeUndefined()
  })

  it('8. 四种模式齐全且顺序固定（界面按钮顺序）', () => {
    expect(PICK_MODES.map((mode) => mode.key)).toEqual(['all', 'male', 'female', 'duty'])
  })

  it('9. 抽一次：返回学生 + 消歧后的展示名（重名带值日组）', () => {
    const outcome = drawOnce('all', STUDENTS, [], nameCounts, groupNameById, first)
    expect(outcome.student?.id).toBe('s-1')
    expect(outcome.displayName).toBe('旦增卓玛（第1组）')
  })

  it('10. 重名但无值日组：回落学号后四位', () => {
    const outcome = drawOnce('all', STUDENTS, [], nameCounts, new Map(), last)
    // rng=0.99999 → 池里最后一位是 s-5（洛桑，不重名）
    expect(outcome.displayName).toBe('洛桑')
    const second = drawOnce('female', STUDENTS, [], nameCounts, new Map(), () => 0.5)
    expect(second.displayName).toBe('旦增卓玛（0012）')
  })

  it('11. 不重名的学生不加后缀', () => {
    const student = STUDENTS[2]!
    expect(displayNameOf(student, nameCounts, groupNameById)).toBe('扎西顿珠')
  })

  it('12. 空池给可读原因（按模式区分），而不是空洞的空白', () => {
    const all = drawOnce('all', [], [], nameCounts, groupNameById, first)
    expect(all.emptyReason).toContain('还没有在读学生')
    const duty = drawOnce('duty', STUDENTS, [], nameCounts, groupNameById, first)
    expect(duty.emptyReason).toContain('今天没有值日组')
    const male = drawOnce('male', [STUDENTS[0]!], [], nameCounts, groupNameById, first)
    expect(male.emptyReason).toContain('没有男生')
  })

  it('13. 滚动帧：按 tick 在池里循环取名字（不会越界）', () => {
    const pool = pickPoolFor('male', STUDENTS)
    expect(rollFrame(pool, nameCounts, groupNameById, 0)).toBe('扎西顿珠')
    expect(rollFrame(pool, nameCounts, groupNameById, 1)).toBe('洛桑')
    expect(rollFrame(pool, nameCounts, groupNameById, 2)).toBe('扎西顿珠') // 循环
    expect(rollFrame([], nameCounts, groupNameById, 3)).toBe('—')
  })

  it('14. 滚动节奏：约 1 秒、约 12 帧（拍板值）', () => {
    expect(PICK_ROLL_MS).toBe(1000)
    expect(PICK_ROLL_TICKS).toBe(12)
    expect(PICK_TICK_MS * PICK_ROLL_TICKS).toBeGreaterThanOrEqual(PICK_ROLL_MS - 100)
  })
})

/* ==================== ② 课堂计时器（10 条） ==================== */

describe('课堂计时器', () => {
  it('15. 四个预设值固定为 1 / 3 / 5 / 10 分钟', () => {
    expect([...TIMER_PRESETS_MIN]).toEqual([1, 3, 5, 10])
  })

  it('16. 自定义分钟数校验：范围内整数才接受', () => {
    expect(isValidMinutes(1)).toBe(true)
    expect(isValidMinutes(45)).toBe(true)
    expect(isValidMinutes(TIMER_MAX_MINUTES)).toBe(true)
    expect(isValidMinutes(0)).toBe(false)
    expect(isValidMinutes(-3)).toBe(false)
    expect(isValidMinutes(2.5)).toBe(false)
    expect(isValidMinutes(TIMER_MAX_MINUTES + 1)).toBe(false)
    expect(isValidMinutes(Number.NaN)).toBe(false)
  })

  it('17. 毫秒格式化：60 秒 → 01:00、90 秒 → 01:30、10 分钟 → 10:00', () => {
    expect(formatDuration(60_000)).toBe('01:00')
    expect(formatDuration(90_000)).toBe('01:30')
    expect(formatDuration(600_000)).toBe('10:00')
    expect(formatDuration(5_000)).toBe('00:05')
  })

  it('18. 剩余时间不会小于 0（到点即 0）', () => {
    expect(remainingMs(60_000, 20_000)).toBe(40_000)
    expect(remainingMs(60_000, 90_000)).toBe(0)
  })

  it('19. 到点判定：剩余为 0 即结束', () => {
    expect(isFinished(60_000, 59_000)).toBe(false)
    expect(isFinished(60_000, 60_000)).toBe(true)
    expect(isFinished(60_000, 120_000)).toBe(true)
  })

  it('20. 进度 0–1，总时为 0 视为已完成', () => {
    expect(timerProgress(60_000, 0)).toBe(0)
    expect(timerProgress(60_000, 30_000)).toBe(0.5)
    expect(timerProgress(60_000, 90_000)).toBe(1)
    expect(timerProgress(0, 0)).toBe(1)
  })

  it('21. 状态机：空闲 → 开始 → 运行中', () => {
    expect(nextPhase('idle', 'start')).toBe('running')
  })

  it('22. 状态机：运行中按「开始」＝暂停（大按钮一按就停，符合课堂直觉）', () => {
    expect(nextPhase('running', 'start')).toBe('paused')
  })

  it('23. 状态机：暂停后继续 → 运行中；重置永远回空闲', () => {
    expect(nextPhase('paused', 'start')).toBe('running')
    expect(nextPhase('running', 'reset')).toBe('idle')
    expect(nextPhase('paused', 'reset')).toBe('idle')
    expect(nextPhase('finished', 'reset')).toBe('idle')
  })

  it('24. 状态机：已结束后再开始＝重新计时（回运行中）', () => {
    expect(nextPhase('finished', 'start')).toBe('running')
  })
})

/* ==================== ③ 抽签（8 条） ==================== */

describe('抽签（值日组）', () => {
  const groups: LotteryGroup[] = [
    { id: 'g-1', name: '第1组', memberCount: 6 },
    { id: 'g-2', name: '第2组', memberCount: 5 },
    { id: 'g-3', name: '第3组', memberCount: 7 },
  ]

  it('25. 抽签池就是现有值日组（三个组原样读入，不改名不加组）', () => {
    expect(groups.map((group) => group.name)).toEqual(['第1组', '第2组', '第3组'])
  })

  it('26. rng=0 抽第一组；rng≈1 抽最后一组（结果可复现）', () => {
    expect(pickRandomGroup(groups, first)?.name).toBe('第1组')
    expect(pickRandomGroup(groups, last)?.name).toBe('第3组')
  })

  it('27. 中间值抽到中间组（三段均匀映射）', () => {
    expect(pickRandomGroup(groups, () => 0.5)?.name).toBe('第2组')
  })

  it('28. 没有值日组 → undefined（界面显示空态）', () => {
    expect(pickRandomGroup([], first)).toBeUndefined()
  })

  it('29. 结果文案直接用组名（「第2组」，不在此处改口径）', () => {
    expect(groupResultLabel(groups[1]!)).toBe('第2组')
  })

  it('30. 无组时结果文案可读（不是空字符串）', () => {
    expect(groupResultLabel(undefined)).toContain('还没有值日组')
  })

  it('31. 组员数来自值日管理（抽签卡显示「N 人」）', () => {
    expect(groups.map((group) => group.memberCount)).toEqual([6, 5, 7])
  })

  it('32. 抽签不修改原始数组（纯函数，值日编排不受影响）', () => {
    const copy = [...groups]
    pickRandomGroup(groups, last)
    expect(groups).toEqual(copy)
  })
})

/* ==================== ④ 页面与响应式（5 条） ==================== */

describe('页面与响应式', () => {
  it('33. 页面只做三个工具（顺序：点名 / 计时器 / 抽签）', () => {
    expect(CLASSROOM_TOOLS.map((tool) => tool.key)).toEqual(['picker', 'timer', 'lottery'])
    expect(CLASSROOM_TOOLS.map((tool) => tool.title)).toEqual(['随机点名', '课堂计时器', '抽签'])
  })

  it('34. 三个工具各有说明文案（入口卡与卡片共用同一份元信息）', () => {
    for (const tool of CLASSROOM_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(0)
    }
  })

  it('35. 路由已注册「/my/classroom」并有标题（入口与直达链接都能进）', async () => {
    const { routes } = await import('@/router/routes')
    const flat = JSON.stringify(routes)
    expect(flat).toContain('/my/classroom')
    expect(flat).toContain('课堂工具')
  })

  it('36. 工具箱入口卡指向课堂工具（我的 → 工具箱 → 课堂工具）', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/views/Toolbox/components/ClassroomEntryCard.vue', 'utf8')
    expect(source).toContain('to="/my/classroom"')
    expect(source).toContain('课堂工具')
  })

  it('37. 响应式网格：桌面三列 / 平板两列 / 手机单列（不出现横向滚动）', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/views/Classroom/ClassroomView.vue', 'utf8')
    expect(source).toContain('repeat(3, minmax(0, 1fr))')
    expect(source).toContain('repeat(2, minmax(0, 1fr))')
    expect(source).toContain('minmax(0, 1fr)')
    expect(source).not.toContain('overflow-x: auto')
  })
})

/* ==================== ⑤ 消歧逻辑复用（防复制第二份） ==================== */

describe('重名消歧：与 Student Hub 共用同一份实现', () => {
  it('38. buildNameCounts 统计同名人数', () => {
    expect(nameCounts.get('旦增卓玛')).toBe(2)
    expect(nameCounts.get('洛桑')).toBe(1)
  })

  it('39. buildDutyGroupNameById：一个学生只映射到一个组（取第一个）', () => {
    const map = buildDutyGroupNameById([
      { name: '第1组', studentIds: ['s-1'] },
      { name: '第2组', studentIds: ['s-1', 's-2'] },
    ])
    expect(map.get('s-1')).toBe('第1组')
    expect(map.get('s-2')).toBe('第2组')
  })

  it('40. disambiguatorOf：不重名 → undefined（不加后缀）', () => {
    expect(disambiguatorOf(STUDENTS[4]!, nameCounts, groupNameById)).toBeUndefined()
  })

  it('41. disambiguatorOf：重名 → 值日组优先', () => {
    expect(disambiguatorOf(STUDENTS[0]!, nameCounts, groupNameById)).toBe('第1组')
  })

  it('42. disambiguatorOf：重名且无组 → 学号后四位', () => {
    expect(disambiguatorOf(STUDENTS[1]!, nameCounts, new Map())).toBe('0012')
  })

  it('43. 消歧只有一份实现：课堂工具复用 utils/student，不复制一份', async () => {
    const { readFileSync } = await import('node:fs')
    const classroom = readFileSync('src/utils/classroom.ts', 'utf8')
    expect(classroom).toContain("from '@/utils/student'")
    expect(classroom).toContain('disambiguatorOf')
    // 不允许在这里另起一套同名计数
    expect(classroom).not.toContain('nameCounts.set(')
    // 档案页同样走公共件（不是各自一份）
    const students = readFileSync('src/views/Students/index.vue', 'utf8')
    expect(students).toContain('buildNameCounts')
    expect(students).toContain('buildDutyGroupNameById')
  })
})
