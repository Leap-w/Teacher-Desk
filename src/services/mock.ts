import type { Student } from '@/types'
import type { Todo } from '@/types/dashboard'
import type { Lesson } from '@/types/timetable'

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
      dormitory: '3 号楼 412',
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
      dormitory: '5 号楼 208',
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
      dormitory: '5 号楼 208',
      familyAddress: '西藏自治区昌都市类乌齐县桑多镇桑多村 21 号',
      familyLocation: { prefecture: '昌都市', county: '类乌齐县', scope: 'changdu-county' },
    },
    {
      id: 'seed-05',
      name: '张浩然',
      studentNo: '20230105',
      gender: 'male',
      seatNumber: 3,
      dormitory: '3 号楼 415',
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
      dormitory: '3 号楼 418',
      familyAddress: '西藏自治区拉萨市城关区八廓街 3 号',
      familyLocation: { prefecture: '拉萨市', county: '城关区', scope: 'outside-changdu' },
    },
    {
      id: 'seed-07',
      name: '刘佳怡',
      studentNo: '20230107',
      gender: 'female',
      seatNumber: 17,
      dormitory: '5 号楼 210',
      familyAddress: '西藏自治区昌都市卡若区妥坝乡妥坝村 2 号',
      familyLocation: { prefecture: '昌都市', county: '卡若区', scope: 'changdu-city' },
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
