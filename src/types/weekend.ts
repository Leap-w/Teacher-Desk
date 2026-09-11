/**
 * 周末返家领域类型（Phase 7B 引入）。
 *
 * 边界（开发手册 §2.2）：学生档案存「家庭所在地事实」（`familyLocation` / `scope`），
 * 周末管理存「某个周末的行为结果」——本文件只描述后者。
 * **代码中永不出现 `canGoHome` 之类的字段**：是否返家是教师对某一个周末的记录，
 * 不由 `scope` 推导（§2.2 红线）。
 *
 * 粒度（Phase 7B 需求方拍板，比 roadmap 的原始描述更轻）：一条记录 = 一个学生 + 一个周末，
 * **只记「是否返家」**——不记时长、不记离校 / 返校时间、不设审批状态。
 * 留校 = 这个周末没有他的记录（派生口径，不落库）。
 * 因此 Phase 7A 抽出的离校 / 返校公共件（`RegisterPointModal` / `RegisterStatusLine` /
 * `registerPointError`）在 7B 里**没有使用方**，仍只有请假模块在用——这是范围，不是遗漏
 * （见 docs/开发手册.md §9.17 与本文件同级的 `types/point.ts` 注释）。
 */

/**
 * 周末键：该周末**周六**的日期键（`YYYY-MM-DD`）。
 * 周日与它同属一个周末（`weekendKeyOf` 把周日归到前一天），因此落库的一律是周六键。
 */
export type WeekendKey = string

/** 一条周末返家记录 */
export interface WeekendReturnRecord {
  id: string
  studentId: string
  /**
   * 学生姓名快照「姓名（学号后四位）」，写入时生成（同 LeaveRecord / SeatChangeLog）。
   * 学生被删除（软删）后记录保留，靠它仍能读出「这是谁返家」；
   * 学生在档案中改名 / 补学号时，store 会按档案刷新该快照（见 stores/weekend.ts）。
   */
  studentName: string
  /** 返家的那个周末（周六日期键） */
  weekendDate: WeekendKey
  /** 登记时间（ISO） */
  createdAt: string
}
