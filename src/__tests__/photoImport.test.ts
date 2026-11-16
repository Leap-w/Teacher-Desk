/**
 * 按文件名批量导入照片自检（v3.8.2 · Phase 2）。
 *
 * 覆盖三段纯逻辑：
 * - 文件名解析：标准 / 无类型 / 四扩展名 / 大小写 / 全角连字符 / 姓名含连字符 / 各类格式错误；
 * - 学生匹配：唯一命中 / 班级不符 / 查无此人 / 重名 / 软删不可关联 / 已有照片提醒；
 * - 隐私：完整身份证号不进计划行、不进预览单元格、不进错误、不进日志；
 * - 串行编排：单张失败不中断、取消只停未开始项、成功行带 photoId、无类型按序级联。
 *
 * 解析 / 匹配 / 编排都是纯函数，直接喂 File 与内存数组，不需要 pinia 与假浏览器。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  PHOTO_IMPORT_EXTENSIONS,
  buildPhotoImportPlan,
  chooseImportStudent,
  classMatchesConfig,
  configuredClassNumber,
  executePhotoImport,
  maskIdNumberInFileName,
  maskPhotoDisplayName,
  parsePhotoFileName,
  removeImportRows,
} from '@/services/photoImport'
import { DEFAULT_CLASSROOM_CONFIG } from '@/types/classroom'
import type { Student } from '@/types'
import type { StudentPhoto } from '@/types/studentPhoto'

const ID = '540102199001011234'
const ID15 = '540102900101123'

function photo(name: string): File {
  return new File([new Uint8Array(16)], name, { type: 'image/jpeg' })
}

function student(id: string, name: string, extra: Partial<Student> = {}): Student {
  return { id, name, studentNo: '', gender: 'male', ...extra }
}

function roster(): Student[] {
  return [
    student('s1', '张三'),
    student('s2', '白玛'),
    student('s3', '旦增', { idCardSuffix: '3287' }),
    student('s4', '旦增', { idCardSuffix: '4412' }),
  ]
}

function planFor(files: File[], active: Student[] = roster(), existing: StudentPhoto[] = []) {
  const nameCounts = new Map<string, number>()
  for (const s of active) nameCounts.set(s.name, (nameCounts.get(s.name) ?? 0) + 1)
  return buildPhotoImportPlan(files, {
    activeStudents: active,
    nameCounts,
    existingPhotos: existing,
  })
}

/* ==================== 文件名解析 ==================== */

describe('文件名解析', () => {
  it('标准证件照文件名', () => {
    const r = parsePhotoFileName(`9班-张三-${ID}-证件照.jpg`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed).toMatchObject({
      className: '9班',
      studentName: '张三',
      idNumber: ID,
      category: 'id-photo',
      extension: 'jpg',
    })
  })

  it('标准生活照文件名', () => {
    const r = parsePhotoFileName(`9班-张三-${ID}-生活照.jpg`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.category).toBe('life-photo')
  })

  it('缺少类型 → category undefined，交给 Store 自动分类', () => {
    const r = parsePhotoFileName(`9班-张三-${ID}.jpg`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parsed.category).toBeUndefined()
  })

  it.each(['jpg', 'jpeg', 'png', 'webp'])('支持扩展名 %s', (ext) => {
    const r = parsePhotoFileName(`9班-张三-${ID}.${ext}`)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.parsed.extension).toBe(ext)
  })

  it('扩展名大小写不敏感', () => {
    const r = parsePhotoFileName(`9班-张三-${ID}.JPG`)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.parsed.extension).toBe('jpg')
  })

  it('全角连字符也能解析', () => {
    const r = parsePhotoFileName(`9班－张三－${ID}－证件照.jpg`)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.parsed.studentName).toBe('张三')
  })

  it('姓名中含连字符，按右侧身份证锚点切分，不被固定位置 split 截断', () => {
    const r = parsePhotoFileName(`9班-央金-卓玛-${ID}-生活照.jpg`)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.parsed.studentName).toBe('央金-卓玛')
      expect(r.parsed.idNumber).toBe(ID)
      expect(r.parsed.category).toBe('life-photo')
    }
  })

  it('15 位老身份证号可用', () => {
    const r = parsePhotoFileName(`9班-张三-${ID15}.jpg`)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.parsed.idNumber).toBe(ID15)
  })

  it('末位 X 的身份证号可用', () => {
    const r = parsePhotoFileName(`9班-张三-54010219900101123X.jpg`)
    expect(r.ok).toBe(true)
  })

  it('带路径前缀只取文件名', () => {
    const r = parsePhotoFileName(`/tmp/photos/9班-张三-${ID}.jpg`)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.parsed.className).toBe('9班')
  })

  it('错误身份证格式 → 拦下并说明原因', () => {
    const r = parsePhotoFileName('9班-张三-12345.jpg')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('身份证号格式')
  })

  it('缺少姓名 → 拦下', () => {
    const r = parsePhotoFileName(`9班--${ID}.jpg`)
    expect(r.ok).toBe(false)
  })

  it('缺少班级 → 拦下', () => {
    const r = parsePhotoFileName(`张三-${ID}.jpg`)
    expect(r.ok).toBe(false)
  })

  it('缺少身份证号 → 拦下', () => {
    const r = parsePhotoFileName('9班-张三.jpg')
    expect(r.ok).toBe(false)
  })

  it('无法解析的文件名 → 拦下', () => {
    expect(parsePhotoFileName('随便什么.jpg').ok).toBe(false)
  })

  it('不支持的扩展名 → 拦下', () => {
    expect(parsePhotoFileName(`9班-张三-${ID}.gif`).ok).toBe(false)
    expect(PHOTO_IMPORT_EXTENSIONS).toEqual(['jpg', 'jpeg', 'png', 'webp'])
  })
})

/* ==================== 脱敏与班级 ==================== */

describe('脱敏与班级校验', () => {
  it('脱敏文件名不含完整身份证号', () => {
    const parsed = parsePhotoFileName(`9班-张三-${ID}-证件照.jpg`)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const masked = maskPhotoDisplayName(parsed.parsed)
    expect(masked).not.toContain(ID)
    expect(masked).toContain('****')
    expect(masked).toContain('张三')
  })

  it('班级号从 DEFAULT_CLASSROOM_CONFIG 派生，不硬编码', () => {
    expect(configuredClassNumber()).toBe(/(\d+)/.exec(DEFAULT_CLASSROOM_CONFIG.name)?.[1])
    expect(classMatchesConfig('9班')).toBe(true)
    expect(classMatchesConfig('8班')).toBe(false)
    expect(classMatchesConfig('高一9班')).toBe(true)
    expect(classMatchesConfig('无数字班')).toBe(false)
  })
})

/* ==================== 学生匹配 ==================== */

describe('学生匹配', () => {
  it('班级一致、姓名唯一 → ready，归属写入', () => {
    const plan = planFor([photo(`9班-张三-${ID}-证件照.jpg`)])
    expect(plan.readyCount).toBe(1)
    expect(plan.rows[0]).toMatchObject({ action: 'ready', studentId: 's1', displayStudent: '张三' })
  })

  it('姓名唯一也标注「身份证号未核验」，不伪造验证成功', () => {
    const plan = planFor([photo(`9班-张三-${ID}.jpg`)])
    expect(plan.rows[0]!.warnings.some((w) => w.includes('未核验'))).toBe(true)
  })

  it('班级不一致 → blocked-class，拦下且说明原因', () => {
    const plan = planFor([photo(`8班-张三-${ID}.jpg`)])
    expect(plan.rows[0]!.action).toBe('blocked-class')
    expect(plan.blockedCount).toBe(1)
    expect(plan.rows[0]!.errors[0]).toContain('不符')
  })

  it('学生不存在 → need-choice，候选为全部在读', () => {
    const plan = planFor([photo(`9班-不存在的人-${ID}.jpg`)])
    expect(plan.rows[0]!.action).toBe('need-choice')
    expect(plan.rows[0]!.candidates.length).toBe(roster().length)
  })

  it('同名学生 → need-choice，候选为同名者，必须人工指定', () => {
    const plan = planFor([photo(`9班-旦增-${ID}.jpg`)])
    expect(plan.rows[0]!.action).toBe('need-choice')
    expect(plan.rows[0]!.candidates.map((s) => s.id)).toEqual(['s3', 's4'])
    expect(plan.rows[0]!.errors[0]).toContain('同名')
  })

  it('软删除学生不进在报名册，因此不会被命中，也不会进人工候选', () => {
    // 真实调用方（弹窗）传的是 studentStore.activeStudents，软删学生已被排除。
    const active = [student('s1', '张三'), student('s2', '白玛')]
    const plan = planFor([photo(`9班-张三-${ID}.jpg`)], active)
    expect(plan.rows[0]!.action).toBe('ready')
    expect(plan.rows[0]!.studentId).toBe('s1')
    const missing = planFor([photo(`9班-已退档者-${ID}.jpg`)], active)
    expect(missing.rows[0]!.action).toBe('need-choice')
    expect(missing.rows[0]!.candidates.map((s) => s.id)).not.toContain('s9')
    // 即便调用方误把软删学生塞进名册，服务内部也会自己滤掉
    const softDeleted = student('s9', '张三', { deletedAt: '2026-01-01T00:00:00.000Z' })
    const guarded = planFor([photo(`9班-张三-${ID}.jpg`)], [...active, softDeleted])
    expect(guarded.rows[0]!.action).toBe('ready')
    expect(guarded.rows[0]!.studentId).toBe('s1')
  })

  it('已有同类照片 → 提醒数量，且不覆盖旧照片', () => {
    const existing: StudentPhoto[] = [
      {
        id: 'p1',
        studentId: 's1',
        studentName: '张三',
        category: 'id-photo',
        storagePath: 'x',
        mimeType: 'image/jpeg',
        width: 1,
        height: 1,
        size: 1,
        uploadedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    const plan = planFor([photo(`9班-张三-${ID}-证件照.jpg`)], roster(), existing)
    expect(plan.rows[0]!.existingCount).toBe(1)
    expect(plan.rows[0]!.warnings.some((w) => w.includes('不覆盖'))).toBe(true)
  })

  it('人工指定后行进入 ready，归属明确', () => {
    const plan = planFor([photo(`9班-旦增-${ID}.jpg`)])
    const target = roster().find((s) => s.id === 's4')!
    const nameCounts = new Map([['旦增', 2]])
    const rows = chooseImportStudent(plan.rows, '1', target, nameCounts)
    expect(rows[0]!.action).toBe('ready')
    expect(rows[0]!.studentId).toBe('s4')
    expect(rows[0]!.displayStudent).toContain('4412')
    expect(rows[0]!.errors).toEqual([])
  })

  it('人工指定软删除学生 → 不生效', () => {
    const plan = planFor([photo(`9班-旦增-${ID}.jpg`)])
    const rows = chooseImportStudent(
      plan.rows,
      '1',
      student('s9', '旦增', { deletedAt: '2026-01-01T00:00:00.000Z' }),
    )
    expect(rows[0]!.action).toBe('need-choice')
  })

  it('移除行后不再参与导入', () => {
    const plan = planFor([photo(`9班-张三-${ID}.jpg`), photo(`9班-白玛-${ID}.jpg`)])
    const rows = removeImportRows(plan.rows, ['1'])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.studentId).toBe('s2')
  })
})

/* ==================== 隐私 ==================== */

describe('身份证隐私', () => {
  it('完整身份证号不进入任何计划行（字段层面）', () => {
    const plan = planFor([photo(`9班-张三-${ID}-证件照.jpg`), photo(`9班-旦增-${ID}.jpg`)])
    const serialized = JSON.stringify(plan.rows.map((row) => ({ ...row, file: undefined })))
    expect(serialized).not.toContain(ID)
  })

  it('完整身份证号不进入预览单元格与错误/警告', () => {
    const plan = planFor([photo(`9班-张三-${ID}-证件照.jpg`)])
    const cells = {
      fileName: plan.rows[0]!.displayName,
      errors: plan.rows[0]!.errors,
      warnings: plan.rows[0]!.warnings,
    }
    expect(JSON.stringify(cells)).not.toContain(ID)
  })

  it('文件名异常行的错误文案也不回显身份证号（用脱敏名反馈）', () => {
    // 格式错误时连解析都失败，错误里只有规则说明，没有原文件名
    const plan = planFor([photo('乱七八糟.gif')])
    expect(plan.rows[0]!.errors.join('')).not.toContain(ID)
    expect(plan.rows[0]!.displayName).not.toContain(ID)
  })

  /* ===== Phase 4.6 回归：解析失败路径也必须脱敏（原 P1 隐私缺陷）=====
   * 以下号码均为测试构造值，不是任何真实学生的身份证号。 */
  it('解析失败 + 18 位身份证号：仍被拦截，displayName 脱敏且保留可识别部分与扩展名', () => {
    // 类型词「学生照」无法识别 → 解析失败（blocked-name）
    const name = `9班-张三-${ID}-学生照.jpg`
    const plan = planFor([photo(name)])
    const row = plan.rows[0]!
    expect(parsePhotoFileName(name).ok).toBe(false)
    expect(row.action).toBe('blocked-name')
    expect(row.displayName).not.toContain(ID)
    expect(row.displayName).toBe('9班-张三-****-学生照.jpg')
    expect(row.displayName).toMatch(/\.jpg$/)
    expect(row.displayName).toContain('张三')
  })

  it('解析失败 + 15 位身份证号：displayName 不含完整号码', () => {
    const name = `9班-张三-${ID15}-学生照.jpg`
    const plan = planFor([photo(name)])
    const row = plan.rows[0]!
    expect(parsePhotoFileName(name).ok).toBe(false)
    expect(row.action).toBe('blocked-name')
    expect(row.displayName).not.toContain(ID15)
    expect(row.displayName).toBe('9班-张三-****-学生照.jpg')
  })

  it.each(['X', 'x'])('解析失败 + 18 位末位 %s：大小写 X 均脱敏', (last) => {
    const number = `54010219900101123${last}`
    const name = `9班-张三-${number}-学生照.jpg`
    const plan = planFor([photo(name)])
    const row = plan.rows[0]!
    expect(parsePhotoFileName(name).ok).toBe(false)
    expect(row.displayName).not.toContain(number)
    expect(row.displayName).toBe('9班-张三-****-学生照.jpg')
  })

  it('解析失败 + 班级不符：原始名里的身份证号也不明文展示', () => {
    // 班级不符走解析成功后的 blocked-class 分支，displayName 由 maskPhotoDisplayName 生成；
    // 这里同时钉住"带脏字符导致解析失败"时 base 分支也脱敏
    const badParse = `高一(9)班-张三-${ID}-证件照.jpg` // 班级段带括号 → 解析可能失败，也可能成功但班级不符
    const plan = planFor([photo(badParse)])
    expect(JSON.stringify(plan.rows)).not.toContain(ID)
    expect(plan.rows[0]!.displayName).not.toContain(ID)
  })

  it('解析成功路径回归：结构化脱敏不受影响，解析与匹配逻辑照旧', () => {
    const plan = planFor([photo(`9班-张三-${ID}-证件照.jpg`)])
    const row = plan.rows[0]!
    expect(row.action).toBe('ready')
    expect(row.studentId).toBe('s1')
    expect(row.category).toBe('id-photo')
    expect(row.displayName).toBe('9班-张三-****-证件照.jpg')
    expect(row.displayName).not.toContain(ID)
  })

  it('原始名脱敏不误伤班级号 / 普通序号 / 紧挨字母的数字串', () => {
    expect(maskIdNumberInFileName('9班-0101班号-张同学.jpg')).toBe('9班-0101班号-张同学.jpg')
    expect(maskIdNumberInFileName('photo000123456789012.jpg')).toBe('photo000123456789012.jpg')
    expect(maskIdNumberInFileName('9班-张三-20230101.jpg')).toBe('9班-张三-20230101.jpg')
  })

  it('服务源码不含 console 日志（不会把身份证号写进日志）', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../services/photoImport.ts', import.meta.url)),
      'utf8',
    )
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(stripped).not.toMatch(/console\.(log|warn|error|info|debug)/)
  })

  it('弹窗与照片墙入口：只显示脱敏名、不回显原始 file.name、不声称核验', () => {
    const modal = readFileSync(
      fileURLToPath(new URL('../views/Photos/components/PhotoImportModal.vue', import.meta.url)),
      'utf8',
    )
    expect(modal).toContain('ImportPreviewTable')
    expect(modal).toContain('runLockedOperation')
    expect(modal).toContain('displayName')
    // 模板插值里绝不直接渲染原始文件名（只允许内存内比较用的 file.name）
    expect(modal).not.toMatch(/\{\{[^}]*file\.name[^}]*\}\}/)
    const wall = readFileSync(
      fileURLToPath(new URL('../views/Photos/index.vue', import.meta.url)),
      'utf8',
    )
    expect(wall).toContain('PhotoImportModal')
    expect(wall).toContain('批量导入')
  })

  it('所有展示路径只用脱敏字段：预览表 / 人工指定 / 移除区均不渲染原始 file.name', () => {
    const modal = readFileSync(
      fileURLToPath(new URL('../views/Photos/components/PhotoImportModal.vue', import.meta.url)),
      'utf8',
    )
    // 三处展示都取 displayName（不是 file.name）；file.name 仅出现在内存去重的比较里
    expect(modal.match(/displayName/g)!.length).toBeGreaterThanOrEqual(3)
    expect(modal).not.toMatch(/\{\{[^}]*file\.name[^}]*\}\}/)
    expect(modal).toContain('cells: {')
    expect(modal).toContain('fileName: row.displayName')
  })

  it('解析失败 + 完整身份证号：计划序列化、错误、警告全链路不含号码', () => {
    // 模拟解析失败但文件名含完整号码（Phase 4.5 的 P1 触发场景）
    const name = `9班-张三-${ID}-错误类型.jpg`
    const plan = planFor([photo(name)])
    const row = plan.rows[0]!
    const visible = {
      displayName: row.displayName,
      errors: row.errors,
      warnings: row.warnings,
      className: row.className,
      studentName: row.studentName,
      displayStudent: row.displayStudent,
    }
    expect(JSON.stringify(visible)).not.toContain(ID)
    // 计划行里没有 idNumber / 原始 name 字段可被序列化出去
    expect(Object.keys(row)).not.toContain('idNumber')
    expect(JSON.stringify(plan)).not.toContain(ID)
  })
})

/* ==================== 串行编排 ==================== */

describe('串行导入编排', () => {
  it('多张串行：全部成功，每行带 photoId；顺序可预测', async () => {
    const plan = planFor([photo(`9班-张三-${ID}-证件照.jpg`), photo(`9班-白玛-${ID}-生活照.jpg`)])
    const order: string[] = []
    const execution = await executePhotoImport(plan.rows, async (row) => {
      order.push(row.studentId!)
      return { photoId: `photo-${row.id}` }
    })
    expect(execution.success).toBe(2)
    expect(execution.failed).toBe(0)
    expect(order).toEqual(['s1', 's2'])
    expect(execution.rows.filter((r) => r.action === 'imported').map((r) => r.photoId)).toEqual([
      'photo-1',
      'photo-2',
    ])
  })

  it('单张失败不中断其它张；失败行可重试且不重复成功项', async () => {
    const plan = planFor([
      photo(`9班-张三-${ID}.jpg`),
      photo(`9班-白玛-${ID}.jpg`),
      photo(`9班-不存在-${ID}.jpg`), // need-choice，不进导入
    ])
    let call = 0
    const execution = await executePhotoImport(plan.rows, async () => {
      call += 1
      if (call === 1) throw new Error('模拟单张处理失败')
      return { photoId: `photo-${call}` }
    })
    expect(execution.success).toBe(1)
    expect(execution.failed).toBe(1)
    expect(execution.failedRows[0]!.error).toContain('模拟单张处理失败')
    expect(execution.rows.find((r) => r.id === '1')!.action).toBe('failed')
    expect(execution.rows.find((r) => r.id === '2')!.action).toBe('imported')
    // need-choice 行未参与导入，原样保留
    expect(execution.rows.find((r) => r.id === '3')!.action).toBe('need-choice')
  })

  it('取消只停未开始项，已成功的保留', async () => {
    const plan = planFor([
      photo(`9班-张三-${ID}.jpg`),
      photo(`9班-白玛-${ID}.jpg`),
      photo(`9班-张三-${ID}.jpg`),
    ])
    let call = 0
    const execution = await executePhotoImport(
      plan.rows,
      async () => {
        call += 1
        return { photoId: `photo-${call}` }
      },
      { shouldCancel: () => call >= 1 },
    )
    expect(execution.cancelled).toBe(true)
    expect(call).toBe(1)
    expect(execution.rows.filter((r) => r.action === 'imported')).toHaveLength(1)
  })

  it('无类型照片按写入顺序交给 Store：显式分类透传、无类型传 undefined', async () => {
    const plan = planFor([
      photo(`9班-张三-${ID}.jpg`), // 无类型
      photo(`9班-张三-${ID}-证件照.jpg`), // 显式证件照
      photo(`9班-张三-${ID}-生活照.jpg`), // 显式生活照
    ])
    const categories: (string | undefined)[] = []
    await executePhotoImport(plan.rows, async (row) => {
      categories.push(row.category)
      return { photoId: `photo-${row.id}` }
    })
    expect(categories).toEqual([undefined, 'id-photo', 'life-photo'])
  })

  it('失败反馈用脱敏文件名，不含身份证号', async () => {
    const plan = planFor([photo(`9班-张三-${ID}-证件照.jpg`)])
    const execution = await executePhotoImport(plan.rows, async () => {
      throw new Error('boom')
    })
    expect(JSON.stringify(execution.failedRows)).not.toContain(ID)
    expect(execution.failedRows[0]!.displayName).toContain('****')
  })
})
