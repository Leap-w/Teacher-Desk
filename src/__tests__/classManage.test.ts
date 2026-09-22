/**
 * V1.1.5 自检：班级管理路由结构 + 请假记录语义。
 *
 * 路由：/class 下四个子模块、旧路径（/seats /leave /duty /weekend）重定向兼容。
 * 请假：记录口径（无审批）——状态标签、旧数据归一、筛选、排序、store 行为。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeBrowser } from './helpers/env'
import { routes } from '@/router/routes'
import {
  LEAVE_STATUS_LABELS,
  filterLeaveRecords,
  isLeaveThisWeek,
  isLeaveToday,
  normalizeLeaveRecord,
  sortLeaveRecords,
} from '@/utils/leave'
import type { LeaveRecord } from '@/types/leave'

/* ========== 路由结构 ========== */

describe('班级管理路由（V1.3.0 IA）', () => {
  const classRoute = routes.find((route) => route.path === '/class')

  it('「班级管理」存在，空路径 redirect 到座位管理（一级菜单直达第一子模块）', () => {
    expect(classRoute).toBeDefined()
    const index = classRoute?.children?.find((child) => child.path === '')
    expect(index).toBeDefined()
    expect(index?.redirect).toBe('/class/seats')
  })

  it('「工作管理」空路径 redirect 是函数：默认进课程表，记过则回上次那一页（v3.1.0）', () => {
    const workRoute = routes.find((route) => route.path === '/work')
    const index = workRoute?.children?.find((child) => child.path === '')
    // 写死路径改成函数后，redirect 不再等于某个字符串——默认落点由 utils/workTab 决定
    expect(typeof index?.redirect).toBe('function')
    // 没记过（测试环境没有 localStorage）→ 课程表；v3.1.0 前这里是工作清单
    expect((index?.redirect as () => string)()).toBe('/work/schedule')
  })

  it('「工作管理」的两个子页顺序是 课程表 → 工作清单（决定二级导航先后）', () => {
    const workRoute = routes.find((route) => route.path === '/work')
    const children = (workRoute?.children ?? []).filter((child) => child.path !== '')
    expect(children.map((child) => child.path)).toEqual(['schedule', 'works'])
  })

  it('「班级管理」下挂五个子模块（v3.6.0 起含班费管理）', () => {
    expect(classRoute).toBeDefined()
    const children = (classRoute?.children ?? []).filter(
      (child) => child.path !== '' && !child.redirect,
    )
    expect(children.map((child) => child.path)).toEqual([
      'seats',
      'leave',
      'duty',
      'weekend',
      'fund',
    ])
  })

  it('学生档案是一级导航路由（不 hidden）', () => {
    const students = routes.find((route) => route.path === '/students')
    expect(students).toBeDefined()
    expect(students?.meta?.hidden).toBeFalsy()
  })

  it('旧路径全部重定向到新层级（旧链接不失效）', () => {
    const redirectOf = (from: string) =>
      routes.find((route) => route.path === from && 'redirect' in route)
    expect(redirectOf('/seats')).toMatchObject({ redirect: '/class/seats' })
    expect(redirectOf('/leave')).toMatchObject({ redirect: '/class/leave' })
    expect(redirectOf('/duty')).toMatchObject({ redirect: '/class/duty' })
    expect(redirectOf('/weekend')).toMatchObject({ redirect: '/class/weekend' })
  })

  it('四个子模块各自带名称（次级导航渲染靠它）', () => {
    const children = (classRoute?.children ?? []).filter(
      (child) => child.path !== '' && !child.redirect,
    )
    for (const child of children) {
      expect(child.meta?.title).toBeTruthy()
    }
  })
})

/* ========== 工作管理的「上次看的 Tab」（v3.1.0） ========== */

describe('utils/workTab：记住工作管理里停留的那一页', () => {
  beforeEach(() => {
    installFakeBrowser()
    window.localStorage.clear()
    vi.resetModules()
  })

  const load = async () => {
    const mod = await import('@/utils/workTab')
    return mod
  }

  it('没记过 → 课程表（v3.1.0 的新默认，此前是工作清单）', async () => {
    const { loadWorkTab, DEFAULT_WORK_TAB } = await load()
    expect(DEFAULT_WORK_TAB).toBe('/work/schedule')
    expect(loadWorkTab()).toBe('/work/schedule')
  })

  it('记过 → 回到上次那一页', async () => {
    const { loadWorkTab, rememberWorkTab } = await load()
    rememberWorkTab('/work/works')
    expect(loadWorkTab()).toBe('/work/works')
    rememberWorkTab('/work/schedule')
    expect(loadWorkTab()).toBe('/work/schedule')
  })

  it('只认 /work 下的两个子页——别的路径一律忽略（首页、学生档案划过不留痕）', async () => {
    const { loadWorkTab, rememberWorkTab } = await load()
    rememberWorkTab('/')
    rememberWorkTab('/students')
    rememberWorkTab('/work')
    rememberWorkTab('/work/schedule/extra')
    expect(loadWorkTab()).toBe('/work/schedule')
    expect(window.localStorage.getItem('teacherdesk:workTab')).toBeNull()
  })

  it('盘上坏值 / 认不出的值一律回默认（记忆坏掉不该让 /work 打不开）', async () => {
    const { loadWorkTab } = await load()
    window.localStorage.setItem('teacherdesk:workTab', '{broken json')
    expect(loadWorkTab()).toBe('/work/schedule')

    window.localStorage.setItem('teacherdesk:workTab', JSON.stringify('/class/seats'))
    expect(loadWorkTab()).toBe('/work/schedule')
  })

  it('也认 { tab } 这种对象写法（容忍将来换成结构化存储）', async () => {
    const { loadWorkTab } = await load()
    window.localStorage.setItem('teacherdesk:workTab', JSON.stringify({ tab: '/work/works' }))
    expect(loadWorkTab()).toBe('/work/works')
  })
})

/* ========== 请假记录语义 ========== */

function mkRecord(overrides: Partial<LeaveRecord>): LeaveRecord {
  return {
    id: 'x',
    studentId: 's1',
    studentName: '张三',
    type: 'personal',
    start: { date: '2026-09-14', half: 'am' },
    end: { date: '2026-09-14', half: 'pm' },
    reason: '家庭事务',
    status: 'approved',
    createdAt: '2026-09-14T08:00:00.000Z',
    ...overrides,
  }
}

describe('请假记录口径（V1.1.5：只做记录，不做审批）', () => {
  it('状态标签不含审批词汇', () => {
    expect(LEAVE_STATUS_LABELS.approved).toBe('已记录')
    expect(LEAVE_STATUS_LABELS.pending).toBe('记录中')
    expect(LEAVE_STATUS_LABELS.rejected).toBe('已作废')
    for (const label of Object.values(LEAVE_STATUS_LABELS)) {
      expect(label.includes('批准')).toBe(false)
      expect(label.includes('驳回')).toBe(false)
      expect(label.includes('审批')).toBe(false)
    }
  })

  it('normalizeLeaveRecord：旧「待处理」读取时归一为「已记录」（记录即生效）', () => {
    const normalized = normalizeLeaveRecord({
      id: 'a',
      studentId: 's1',
      studentName: '张三',
      type: 'sick',
      start: { date: '2026-09-14', half: 'am' },
      end: { date: '2026-09-15', half: 'pm' },
      reason: '生病',
      status: 'pending',
      createdAt: '',
    })
    expect(normalized?.status).toBe('approved')
  })

  it('normalizeLeaveRecord：旧「已驳回」保留原值（那次请假没有发生，不改写历史）', () => {
    const normalized = normalizeLeaveRecord({
      id: 'b',
      studentId: 's1',
      studentName: '张三',
      type: 'sick',
      start: { date: '2026-09-14', half: 'am' },
      end: { date: '2026-09-15', half: 'pm' },
      reason: '生病',
      status: 'rejected',
      createdAt: '',
    })
    expect(normalized?.status).toBe('rejected')
  })

  it('normalizeLeaveRecord：缺状态按「已记录」保守处理（不再有「未批准」的概念）', () => {
    const normalized = normalizeLeaveRecord({
      studentId: 's1',
      type: 'other',
      start: { date: '2026-09-14', half: 'am' },
      end: { date: '2026-09-14', half: 'pm' },
      reason: '事由',
      createdAt: '',
    })
    expect(normalized?.status).toBe('approved')
  })

  it('筛选：今日 / 本周 / 未返校 / 已返校（后两项只看登记端点）', () => {
    const today = '2026-09-14' // 周一
    const records: LeaveRecord[] = [
      mkRecord({ id: '1', start: { date: today, half: 'am' }, end: { date: today, half: 'pm' } }),
      mkRecord({
        id: '2',
        start: { date: '2026-09-10', half: 'am' },
        end: { date: '2026-09-20', half: 'pm' },
        leftSchool: { date: '2026-09-10', half: 'am' },
      }),
      mkRecord({
        id: '3',
        start: { date: '2026-09-01', half: 'am' },
        end: { date: '2026-09-02', half: 'pm' },
        leftSchool: { date: '2026-09-01', half: 'am' },
        backToSchool: { date: '2026-09-02', half: 'pm' },
      }),
      mkRecord({
        id: '4',
        start: { date: '2026-10-01', half: 'am' },
        end: { date: '2026-10-02', half: 'pm' },
      }),
    ]
    expect(filterLeaveRecords(records, 'today', today).map((item) => item.id)).toEqual(['1', '2'])
    expect(filterLeaveRecords(records, 'week', today).map((item) => item.id)).toEqual(['1', '2'])
    expect(filterLeaveRecords(records, 'out', today).map((item) => item.id)).toEqual(['2'])
    expect(filterLeaveRecords(records, 'back', today).map((item) => item.id)).toEqual(['3'])
    expect(filterLeaveRecords(records, 'all', today)).toHaveLength(4)
  })

  it('isLeaveToday / isLeaveThisWeek：跨周的不算本周', () => {
    const today = '2026-09-14'
    expect(
      isLeaveToday(
        mkRecord({ start: { date: today, half: 'am' }, end: { date: today, half: 'pm' } }),
        today,
      ),
    ).toBe(true)
    expect(
      isLeaveThisWeek(
        mkRecord({
          start: { date: '2026-09-20', half: 'am' },
          end: { date: '2026-09-21', half: 'pm' },
        }),
        today,
      ),
    ).toBe(true) // 9-20 是本周日
    expect(
      isLeaveThisWeek(
        mkRecord({
          start: { date: '2026-09-21', half: 'am' },
          end: { date: '2026-09-21', half: 'pm' },
        }),
        today,
      ),
    ).toBe(false) // 下周一
  })

  it('排序：按开始时段倒序（最近发生的在前）', () => {
    const sorted = sortLeaveRecords([
      mkRecord({
        id: 'old',
        start: { date: '2026-09-01', half: 'am' },
        end: { date: '2026-09-01', half: 'pm' },
      }),
      mkRecord({
        id: 'new',
        start: { date: '2026-09-14', half: 'am' },
        end: { date: '2026-09-14', half: 'pm' },
      }),
    ])
    expect(sorted.map((item) => item.id)).toEqual(['new', 'old'])
  })
})
