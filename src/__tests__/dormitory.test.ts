/**
 * 宿舍自由文本 / 八项快捷预设自检（v3.8.1 · Phase 2）。
 *
 * 这一版把宿舍从「固定 8 间白名单」改成「自由文本 + 快捷预设」，最容易回流的两种旧行为是：
 * ① 数据规范化又按白名单把非预设值清掉；② 表单又按性别清空宿舍。
 * 因此本文件既测纯逻辑，也做源码级扫描，钉住旧行为不再出现。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { appConfig } from '@/config'
import { createBackup, parseBackup } from '@/utils/backup'
import {
  DORMITORY_CUSTOM,
  DORMITORY_PRESETS,
  dormitoryFromForm,
  dormitoryOptions,
  hasDormitoryValue,
  isDormitoryPreset,
  isDormitorySelectionMissing,
  normalizeStudent,
  splitDormitoryForForm,
} from '@/utils/student'
import type { Student } from '@/types'

/** 需求指定的八项，顺序固定——测试里独立写一份，防止实现被「顺手排序」 */
const EXPECTED_PRESETS = [
  '女生2栋212',
  '女生2栋114',
  '女生2栋115',
  '女生2栋116',
  '男生1栋203',
  '男生1栋210',
  '男生1栋208',
  '男生1栋209',
] as const

const read = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

function studentWithDormitory(dormitory: unknown): Student {
  const base = { id: 's1', name: '甲', studentNo: '', gender: 'female' as const }
  return (dormitory === undefined ? base : { ...base, dormitory }) as unknown as Student
}

describe('八项快捷预设', () => {
  it('完整、名称与顺序与需求完全一致', () => {
    expect(DORMITORY_PRESETS).toEqual(EXPECTED_PRESETS)
    expect(DORMITORY_PRESETS).toHaveLength(8)
  })

  it('下拉选项 = 未分配 + 八项预设，顺序一致', () => {
    expect(dormitoryOptions()).toEqual([
      { label: '未分配', value: '' },
      ...EXPECTED_PRESETS.map((room) => ({ label: room, value: room })),
    ])
  })

  it('原有旧预设不再作为当前快捷预设展示，但仍可作为普通值保存', () => {
    for (const old of ['女生2栋113', '男生1栋211', '男生1栋212']) {
      expect(DORMITORY_PRESETS).not.toContain(old)
      expect(isDormitoryPreset(old)).toBe(false)
    }
  })

  it('isDormitoryPreset 只对八项预设为真（不 trim、不做模糊匹配）', () => {
    for (const room of EXPECTED_PRESETS) expect(isDormitoryPreset(room)).toBe(true)
    expect(isDormitoryPreset(' 女生2栋212 ')).toBe(false)
    expect(isDormitoryPreset('')).toBe(false)
    expect(isDormitoryPreset(undefined)).toBe(false)
  })
})

describe('表单回填 / 提交：预设与自定义都正确', () => {
  it('预设值回填到下拉', () => {
    expect(splitDormitoryForForm('女生2栋212')).toEqual({ select: '女生2栋212', custom: '' })
  })

  it('非预设值（含旧值与自定义）回填到自定义输入框，原样保留', () => {
    expect(splitDormitoryForForm('女生2栋113')).toEqual({
      select: DORMITORY_CUSTOM,
      custom: '女生2栋113',
    })
    expect(splitDormitoryForForm('北校区 3 号楼 412')).toEqual({
      select: DORMITORY_CUSTOM,
      custom: '北校区 3 号楼 412',
    })
    // 不 trim：首尾空格也属于用户输入的一部分
    expect(splitDormitoryForForm('  A-3F  ')).toEqual({
      select: DORMITORY_CUSTOM,
      custom: '  A-3F  ',
    })
  })

  it('空宿舍 = 未分配（空串 / undefined）', () => {
    expect(splitDormitoryForForm('')).toEqual({ select: '', custom: '' })
    expect(splitDormitoryForForm(undefined)).toEqual({ select: '', custom: '' })
    expect(dormitoryFromForm('', '')).toBeUndefined()
    expect(dormitoryFromForm(DORMITORY_CUSTOM, '')).toBeUndefined()
  })

  it('提交：预设取下拉值、自定义取输入框原文；往返幂等', () => {
    expect(dormitoryFromForm('男生1栋203', '')).toBe('男生1栋203')
    expect(dormitoryFromForm(DORMITORY_CUSTOM, ' 北校区 3 号楼 412 ')).toBe(' 北校区 3 号楼 412 ')
    for (const value of ['女生2栋212', '女生2栋113', '北校区 3 号楼 412', '  A-3F  ']) {
      const form = splitDormitoryForForm(value)
      expect(dormitoryFromForm(form.select, form.custom)).toBe(value)
    }
  })
})

describe('Phase 4 验收修复：空白显示与自定义空值校验', () => {
  it('全空白宿舍不显示（不出现「宿舍 ·」空行），有内容才显示', () => {
    expect(hasDormitoryValue('  ')).toBe(false)
    expect(hasDormitoryValue('')).toBe(false)
    expect(hasDormitoryValue(undefined)).toBe(false)
    expect(hasDormitoryValue('女生2栋113')).toBe(true)
    expect(hasDormitoryValue(' 3 号楼 412 ')).toBe(true)
  })

  it('选「自定义宿舍」却空着：单个表单与批量修改都判为缺失；明确选「未分配」不算缺失', () => {
    expect(isDormitorySelectionMissing(DORMITORY_CUSTOM, '')).toBe(true)
    expect(isDormitorySelectionMissing(DORMITORY_CUSTOM, '   ')).toBe(true)
    expect(isDormitorySelectionMissing(DORMITORY_CUSTOM, '3 号楼 412')).toBe(false)
    expect(isDormitorySelectionMissing('', '')).toBe(false)
    expect(isDormitorySelectionMissing('女生2栋212', '')).toBe(false)
  })

  it('学生卡片 / 详情用统一判据隐藏空白宿舍；长宿舍允许换行而不是横向截断', () => {
    const cardMeta = read('src/views/Students/components/StudentCardMeta.vue')
    const detail = read('src/views/Students/components/StudentDetailModal.vue')
    const form = read('src/views/Students/components/StudentFormModal.vue')
    const batch = read('src/views/Students/components/StudentBatchEditModal.vue')
    expect(cardMeta).toContain('hasDormitoryValue')
    expect(cardMeta).toContain('overflow-wrap: anywhere')
    expect(detail).toContain('hasDormitoryValue')
    expect(form).toContain('isDormitorySelectionMissing')
    expect(form).toContain('请输入宿舍名称（要清空请选「未分配」）')
    // 防双击重复提交：成功后保持 submitting=true，下次打开复位
    expect(form).toContain('const submitting = ref(false)')
    expect(form).toContain('if (submitting.value) return')
    expect(batch).toContain('isDormitorySelectionMissing')
  })
})

describe('normalizeStudent：历史宿舍值完整保留', () => {
  it('旧预设值原样保留（女生2栋113 / 男生1栋211 / 男生1栋212）', () => {
    for (const value of ['女生2栋113', '男生1栋211', '男生1栋212']) {
      expect(normalizeStudent(studentWithDormitory(value)).dormitory).toBe(value)
    }
  })

  it('任意非预设字符串原样保留，包括内部空格、特殊字符与首尾空格', () => {
    for (const value of [
      '3 号楼 412',
      '北校区 A-3F #208',
      '  实验楼 2 层  ',
      '女生2栋212（临时）',
    ]) {
      expect(normalizeStudent(studentWithDormitory(value)).dormitory).toBe(value)
    }
  })

  it('不再按性别校验：女生保留男生楼、男生保留女生楼', () => {
    for (const [gender, dormitory] of [
      ['female', '男生1栋203'],
      ['male', '女生2栋212'],
    ] as const) {
      const raw = { ...studentWithDormitory(dormitory), gender }
      expect(normalizeStudent(raw).dormitory).toBe(dormitory)
    }
  })

  it('空串 / null / 数字等仍按既有约定剔除（空 = 未分配）', () => {
    expect(normalizeStudent(studentWithDormitory('')).dormitory).toBeUndefined()
    expect(normalizeStudent(studentWithDormitory(null)).dormitory).toBeUndefined()
    expect(normalizeStudent(studentWithDormitory(123)).dormitory).toBeUndefined()
  })

  it('规范化是幂等的：自定义值重复规范化后不变', () => {
    const raw = studentWithDormitory('北校区 3 号楼 412')
    const once = normalizeStudent(raw)
    const twice = normalizeStudent(once)
    expect(twice.dormitory).toBe('北校区 3 号楼 412')
  })

  it('JSON 备份导出 / 导入链路：自定义宿舍原样往返，导入后规范化仍保留', () => {
    const STUDENTS_KEY = `${appConfig.storageKeyPrefix}:students`
    const custom = '  北校区 3 号楼 412  '
    const rawStudent = {
      id: 's1',
      name: '甲',
      studentNo: '',
      gender: 'female',
      dormitory: custom,
    }
    const raw = new Map([[STUDENTS_KEY, JSON.stringify([rawStudent])]])

    // 导出：原值进入备份文件
    const { backup } = createBackup((key) => raw.get(key) ?? null, new Date('2026-11-14'))
    expect(JSON.stringify(backup)).toContain('北校区 3 号楼 412')

    // 导入：解析后再走 normalizeStudent（备份恢复 / 跨标签页 / 云同步同一条规则）
    const parsed = parseBackup(JSON.stringify(backup))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const restored = parsed.backup.data[STUDENTS_KEY] as Record<string, unknown>[]
    expect(normalizeStudent(restored[0] as unknown as Student).dormitory).toBe(custom)
  })
})

describe('源码级回归：旧白名单 / 性别联动不得回流', () => {
  it('student.ts 不再有性别分列白名单或 isValidDormitory', () => {
    const source = read('src/utils/student.ts')
    expect(source).toContain('DORMITORY_PRESETS')
    expect(source).not.toContain('isValidDormitory')
    expect(source).not.toContain('DORMITORIES: Record')
  })

  it('学生表单不再因性别清空宿舍，且自定义输入已接线', () => {
    const source = read('src/views/Students/components/StudentFormModal.vue')
    expect(source).not.toContain('isValidDormitory')
    expect(source).toContain('DORMITORY_CUSTOM')
    expect(source).toContain('splitDormitoryForForm')
    expect(source).toContain('dormitoryFromForm')
    expect(source).not.toContain('() => form.gender')
  })

  it('批量弹窗与导入服务不再使用旧白名单', () => {
    const batch = read('src/views/Students/components/StudentBatchEditModal.vue')
    const importService = read('src/services/studentImport.ts')
    const batchUtil = read('src/utils/studentBatch.ts')
    expect(batch).toContain('DORMITORY_PRESETS')
    expect(batch).toContain('DORMITORY_CUSTOM')
    expect(importService).not.toContain('isValidDormitory')
    expect(importService).not.toContain('dormitoryRejected')
    expect(batchUtil).not.toContain('isValidDormitory')
  })
})
