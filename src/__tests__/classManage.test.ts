/**
 * V1.1.5 自检：班级管理路由结构 + 请假记录语义。
 *
 * 路由：/class 下四个子模块、旧路径（/seats /leave /duty /weekend）重定向兼容。
 * 请假：记录口径（无审批）——状态标签、旧数据归一、筛选、排序、store 行为。
 */
import { describe, expect, it } from 'vitest'

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

describe('班级管理路由（V1.1.5）', () => {
  const classRoute = routes.find((route) => route.path === '/class')

  it('「班级管理」存在，且下挂四个子模块', () => {
    expect(classRoute).toBeDefined()
    const children = (classRoute?.children ?? []).filter((child) => !child.redirect)
    expect(children.map((child) => child.path)).toEqual(['seats', 'leave', 'duty', 'weekend'])
  })

  it('默认子入口指向座位管理（点「班级管理」落到第一个子模块）', () => {
    const index = classRoute?.children?.find((child) => child.redirect === '/class/seats')
    expect(index).toBeDefined()
  })

  it('旧路径全部重定向到新层级（旧链接不失效）', () => {
    const redirectOf = (from: string) =>
      routes.find((route) => route.path === from && 'redirect' in route)
    expect(redirectOf('/seats')).toMatchObject({ redirect: '/class/seats' })
    expect(redirectOf('/leave')).toMatchObject({ redirect: '/class/leave' })
    expect(redirectOf('/duty')).toMatchObject({ redirect: '/class/duty' })
    expect(redirectOf('/weekend')).toMatchObject({ redirect: '/class/weekend' })
  })

  it('四个子模块各自带名称与图标（侧边栏展平渲染靠它）', () => {
    const children = (classRoute?.children ?? []).filter((child) => child.path !== '')
    for (const child of children) {
      expect(child.meta?.title).toBeTruthy()
      expect(child.meta?.icon).toBeTruthy()
    }
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
