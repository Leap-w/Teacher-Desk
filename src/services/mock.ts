import { addDaysToDateKey, formatDateKey } from '@/utils/date'
import { DUTY_SETTINGS_ID } from '@/utils/duty'
import { currentWeekendKey } from '@/utils/weekend'
import type { Student } from '@/types'
import type { Todo } from '@/types/dashboard'
import type { DutyRecord } from '@/types/duty'
import type { LeaveRecord } from '@/types/leave'
import type { Lesson } from '@/types/timetable'
import type { WeekendReturnRecord } from '@/types/weekend'

/**
 * 首次启动的示例数据（模拟后端返回，仅当本地无缓存时使用）。
 * 刻意包含：两名同名学生、两名班委、男女混合、不同宿舍与返家范围（市区/其他县/市外），
 * 便于演示重名处理与筛选。
 */
export function createSeedStudents(): Student[] {
  return [
    {
      id: 'seed-01',
      name: '旦增卓玛',
      studentNo: '20230101',
      gender: 'female',
      seatNumber: 1,
      dormitory: '女生2栋113',
      cadreRole: '班长',
      tags: ['三好学生'],
      familyAddress: '西藏自治区昌都市卡若区俄洛镇俄洛村 12 号',
      familyLocation: { prefecture: '昌都市', county: '卡若区', scope: 'changdu-city' },
    },
    {
      id: 'seed-02',
      name: '旦增卓玛',
      studentNo: '20230102',
      gender: 'female',
      seatNumber: 2,
      dormitory: '女生2栋114',
      tags: ['文艺骨干'],
      familyAddress: '西藏自治区昌都市江达县同普乡格巴村 5 号',
      familyLocation: { prefecture: '昌都市', county: '江达县', scope: 'changdu-county' },
    },
    {
      id: 'seed-03',
      name: '李明',
      studentNo: '20230103',
      gender: 'male',
      seatNumber: 15,
      dormitory: '男生1栋209',
      familyAddress: '西藏自治区昌都市类乌齐县桑多镇桑多村 21 号',
      familyLocation: { prefecture: '昌都市', county: '类乌齐县', scope: 'changdu-county' },
    },
    {
      id: 'seed-05',
      name: '张浩然',
      studentNo: '20230105',
      gender: 'male',
      seatNumber: 3,
      dormitory: '男生1栋210',
      cadreRole: '学习委员',
      tags: ['数学课代表'],
      familyAddress: '西藏自治区昌都市左贡县旺达镇列达村 9 号',
      familyLocation: { prefecture: '昌都市', county: '左贡县', scope: 'changdu-county' },
    },
    {
      id: 'seed-06',
      name: '陈思远',
      studentNo: '20230106',
      gender: 'male',
      seatNumber: 4,
      dormitory: '男生1栋211',
      familyAddress: '西藏自治区拉萨市城关区八廓街 3 号',
      familyLocation: { prefecture: '拉萨市', county: '城关区', scope: 'outside-changdu' },
    },
    {
      id: 'seed-07',
      name: '刘佳怡',
      studentNo: '20230107',
      gender: 'female',
      seatNumber: 17,
      dormitory: '女生2栋115',
      familyAddress: '西藏自治区昌都市卡若区妥坝乡妥坝村 2 号',
      familyLocation: { prefecture: '昌都市', county: '卡若区', scope: 'changdu-city' },
    },
  ]
}

/**
 * 首次启动的示例值日安排（Phase 6）：三个值日组 + 一条轮换设置。
 * 六名示例学生分三组各两人——含两名「旦增卓玛」，用于验证重名时显示学号后四位。
 *
 * 轮换起点写成**首次启动那天**，不写死日期：写死的示例过几天就成了「起点在过去很久」，
 * 教师打开看到的是与自己无关的中间某组。周末开关默认关（Phase 6 范围拍板口径）。
 * 只在示例学生确实还在档案中时才播种（stores/duty.ts 的 loadRecords）。
 */
export function createSeedDuty(): DutyRecord[] {
  return [
    {
      id: 'duty-01',
      kind: 'group',
      name: '第 1 组',
      studentIds: ['seed-01', 'seed-03'],
    },
    {
      id: 'duty-02',
      kind: 'group',
      name: '第 2 组',
      studentIds: ['seed-05', 'seed-07'],
    },
    {
      id: 'duty-03',
      kind: 'group',
      name: '第 3 组',
      studentIds: ['seed-02', 'seed-06'],
    },
    {
      id: DUTY_SETTINGS_ID,
      kind: 'settings',
      startDate: formatDateKey(new Date()),
      startGroupId: 'duty-01',
      includeWeekend: false,
    },
  ]
}

/**
 * 首次启动的示例课表（工作台「今日课程」与 `/schedule` 周课表共用）。
 * 场景：高一9班班主任，教本班与高一7班的数学，兼任本班班会课 —— 共 12 节 / 周，
 * 周末无课（用于验证「今天暂无课程」的空态）。
 * 有意不种「代课」记录：「代课」是对他人缺勤的事实描述，应由教师自己录入。
 */
export function createSeedLessons(): Lesson[] {
  return [
    {
      id: 'lesson-01',
      weekday: 1,
      period: 1,
      subject: '数学',
      classId: 'class-高一9班',
      className: '高一9班',
      teacher: '我',
      location: 'A 栋 302',
    },
    {
      id: 'lesson-02',
      weekday: 1,
      period: 3,
      subject: '数学',
      classId: 'class-高一7班',
      className: '高一7班',
      teacher: '我',
      location: 'A 栋 305',
    },
    {
      id: 'lesson-03',
      weekday: 1,
      period: 7,
      subject: '班会',
      classId: 'class-高一9班',
      className: '高一9班',
      teacher: '我',
      location: 'A 栋 302',
    },
    {
      id: 'lesson-04',
      weekday: 2,
      period: 2,
      subject: '数学',
      classId: 'class-高一9班',
      className: '高一9班',
      teacher: '我',
      location: 'A 栋 302',
    },
    {
      id: 'lesson-05',
      weekday: 2,
      period: 4,
      subject: '数学',
      classId: 'class-高一7班',
      className: '高一7班',
      teacher: '我',
      location: 'A 栋 305',
    },
    {
      id: 'lesson-06',
      weekday: 3,
      period: 1,
      subject: '数学',
      classId: 'class-高一7班',
      className: '高一7班',
      teacher: '我',
      location: 'A 栋 305',
    },
    {
      id: 'lesson-07',
      weekday: 3,
      period: 3,
      subject: '数学',
      classId: 'class-高一9班',
      className: '高一9班',
      teacher: '我',
      location: 'A 栋 302',
    },
    {
      id: 'lesson-08',
      weekday: 4,
      period: 2,
      subject: '数学',
      classId: 'class-高一9班',
      className: '高一9班',
      teacher: '我',
      location: 'A 栋 302',
    },
    {
      id: 'lesson-09',
      weekday: 4,
      period: 5,
      subject: '数学',
      classId: 'class-高一7班',
      className: '高一7班',
      teacher: '我',
      location: 'A 栋 305',
    },
    {
      id: 'lesson-10',
      weekday: 5,
      period: 1,
      subject: '数学',
      classId: 'class-高一9班',
      className: '高一9班',
      teacher: '我',
      location: 'A 栋 302',
    },
    {
      id: 'lesson-11',
      weekday: 5,
      period: 3,
      subject: '数学',
      classId: 'class-高一7班',
      className: '高一7班',
      teacher: '我',
      location: 'A 栋 305',
    },
    {
      id: 'lesson-12',
      weekday: 5,
      period: 6,
      subject: '班会',
      classId: 'class-高一9班',
      className: '高一9班',
      teacher: '我',
      location: 'A 栋 302',
    },
  ]
}

/** 首次启动的示例待办（Phase 4 的今日待办卡片；勾选状态由 dashboard store 持久化） */
export function createSeedTodos(): Todo[] {
  return [
    { id: 'todo-01', text: '班会准备', done: false },
    { id: 'todo-02', text: '检查卫生', done: false },
    { id: 'todo-03', text: '批改作业', done: false },
  ]
}

/**
 * 首次启动的示例请假记录：覆盖三种状态——待处理（明天一天）、
 * 已批准且已登记离校（今天上午起，尚未返校）、已驳回（今天下午半天），
 * 便于演示审批流转与离校 / 返校登记。
 *
 * 日期相对「首次启动那天」生成，**不写死日期**：写死的示例几天后就成了过期记录。
 * 有意包含一名重名学生（seed-01 是两名「旦增卓玛」之一），验证快照带学号后四位。
 */
export function createSeedLeaves(): LeaveRecord[] {
  const today = formatDateKey(new Date())
  const tomorrow = addDaysToDateKey(today, 1)
  const now = new Date().toISOString()
  return [
    {
      id: 'leave-01',
      studentId: 'seed-07',
      studentName: '刘佳怡（0107）',
      type: 'personal',
      start: { date: tomorrow, half: 'am' },
      end: { date: tomorrow, half: 'pm' },
      reason: '家中有事，需回家一趟',
      status: 'pending',
      createdAt: now,
    },
    {
      id: 'leave-02',
      studentId: 'seed-06',
      studentName: '陈思远（0106）',
      type: 'sick',
      start: { date: today, half: 'am' },
      end: { date: tomorrow, half: 'pm' },
      reason: '发烧，需回家休息',
      status: 'approved',
      createdAt: now,
      decidedAt: now,
      leftSchool: { date: today, half: 'am' },
    },
    {
      id: 'leave-03',
      studentId: 'seed-01',
      studentName: '旦增卓玛（0101）',
      type: 'personal',
      start: { date: today, half: 'pm' },
      end: { date: today, half: 'pm' },
      reason: '临时外出',
      status: 'rejected',
      createdAt: now,
      decidedAt: now,
      decisionNote: '请说明具体事由后重新提交',
    },
  ]
}

/**
 * 首次启动的示例周末返家记录（Phase 7B）：本周末 3 人、上周末 2 人。
 * 覆盖两名同名「旦增卓玛」中的一位，验证快照里的学号后四位分得开；
 * 两个周末都有记录，是为了让「本月累计人次」与「本周末人数」不相等——
 * 只种一个周末的数据，看不出统计口径与当前名单的区别。
 *
 * 日期相对「首次启动那天」生成，**不写死日期**（同 createSeedLeaves / createSeedDuty）：
 * 「本周末」经 currentWeekendKey 归到该周周六，写死的示例过几天就成了别的周末的记录。
 * 只在示例学生确实还在档案中时才播种（stores/weekend.ts 的 loadReturns）。
 */
export function createSeedWeekendReturns(): WeekendReturnRecord[] {
  const thisWeekend = currentWeekendKey(formatDateKey(new Date()))
  const lastWeekend = addDaysToDateKey(thisWeekend, -7)
  const now = new Date().toISOString()
  return [
    {
      id: 'weekend-01',
      studentId: 'seed-01',
      studentName: '旦增卓玛（0101）',
      weekendDate: thisWeekend,
      createdAt: now,
    },
    {
      id: 'weekend-02',
      studentId: 'seed-03',
      studentName: '李明（0103）',
      weekendDate: thisWeekend,
      createdAt: now,
    },
    {
      id: 'weekend-03',
      studentId: 'seed-06',
      studentName: '陈思远（0106）',
      weekendDate: thisWeekend,
      createdAt: now,
    },
    {
      id: 'weekend-04',
      studentId: 'seed-05',
      studentName: '张浩然（0105）',
      weekendDate: lastWeekend,
      createdAt: now,
    },
    {
      id: 'weekend-05',
      studentId: 'seed-07',
      studentName: '刘佳怡（0107）',
      weekendDate: lastWeekend,
      createdAt: now,
    },
  ]
}
