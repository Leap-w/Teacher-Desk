# TeacherDesk 路线图

> 同步自 `docs/开发手册.md` §10（2026-09-10 更新）。两份文档冲突时以开发手册为准。
>
> 后端规划：腾讯云 CloudBase + PostgreSQL。后端接入前所有数据走本地（Pinia + localStorage），`src/services` 预留接口抽象层。

## Phase 0 ✅ 基础架构

- Vue 3 + Vite + TypeScript(strict) + Router + Pinia + UnoCSS + PWA 工程框架
- Apple 风格主题（松石青）+ 布局骨架（Sidebar 由路由表驱动 / AppHeader）
- 7 个占位路由页面 + 首页静态 Dashboard
- ESLint + Prettier + 保存自动格式化

## Phase 1 ✅ UI Kit 设计系统 + 页面骨架

- Design Tokens 统一入 `theme.css`（颜色/间距/字号/圆角/阴影/毛玻璃/动效/焦点环/层级）
- 基础组件：AppInput / AppTextarea / AppSelect / AppField / AppBadge / AppButton / AppCard / AppModal / AppToast / EmptyState（统一出口 `components/ui/index.ts`）
- 全局交互：useToast 单例 + AppToast 挂载、AppModal Teleport + 焦点圈定 + 滚动锁定
- `services/` / `constants/` / `config/` 目录与业务领域类型

## Phase 2 ✅ 学生档案 MVP

- `stores/student.ts`：Pinia + localStorage 持久化、seed-on-null、load 守卫、软删除（deletedAt）
- 列表（搜索姓名/学号/宿舍/标签 + 筛选全部/男/女/班委，按学号升序）、卡片网格、详情弹窗、新增/编辑共用表单弹窗
- 重名区分 `formatStudentDisplayName`、种子学生（8→6 名，Phase 2.1 收敛）、UUID（crypto.randomUUID）
- 表单校验：姓名必填、学号必填且唯一、座位号非负整数、返家范围必选

## Phase 2 增量（2026-09-08）✅ 学生档案数据基础

- `Student` 新增 `familyAddress` 与 `familyLocation { prefecture, county, scope }`
- `FamilyScope = changdu-city | changdu-county | outside-changdu`（昌都市区 / 昌都市其他县 / 昌都市外）—— 行政区划事实，与"能否回家"无关（周末管理模块负责行为）
- 旧 localStorage 数据经 `normalizeStudent` load 时升级，不白屏、不覆盖
- Store 学号唯一性兜底（add/update 返回 undefined 拒绝）
- 卡片返家范围 Badge、表单「家庭信息」区、详情「家庭信息」区

## Phase 2.1 ✅ 学生档案模型收敛（2026-09-09）

- 移除 `Student.boarding` 字段与全部住宿 / 走读 UI 遗留（表单选择器与联动、卡片 / 详情住宿行、`formatBoardingLabel`）
- `normalizeStudent` 升级时剔除历史 localStorage 数据中的 boarding 遗留键；`dormitory` 宿舍字段保留
- mock 8→6 名：删除走读样本 2 名，1 名（陈思远，拉萨市外）转为住校样本保住市外覆盖；保留两名重名与三类返家范围
- 依据：全班统一住校（详见开发手册 §2.1）

## Phase 3 ⏳ 排座 / 座位管理（3A / 3B / 3C 已完成，3D 为下一小步）

- Phase 3A ✅（2026-09-09，tag v0.3.0-alpha）：固定教室模型（高一9班 · 7 排 × 9 列 · 3-3-3 分列 · 63 座就座 62 · 末排尾座留空）+ `Seat / SeatPlan / SeatChangeLog(预留)` 模型 + `stores/seat.ts`（`teacherdesk:seatPlans` 多方案：开学初 / 新建 / 切换 / 重命名 / 删除历史，当前不可删）+ 双视角可视化网格（老师 / 学生，约 300ms FLIP 翻转，选中跨视角保持）+ 右侧方案管理面板；`seatNumber`(1–62) 按 row-major 座位号对号入座
- Phase 3B ✅（2026-09-09，tag v0.3.1）：Pointer Events 原生拖拽换座（座位 ↔ 座位交换、座位 → 空位移入，63 号尾座可手动拖入，拖回原位不动作；双视角同一份座位数据即时同步、选中态保持）；`SeatChangeLog` 正式启用（UUID / ISO / 与 SeatPlan 关联 / `studentName` 快照，交换记 2 条、移动记 1 条，`姓名（学号后四位）` + `N排M列` 文案）；「保存本次调整（N）」归档并自动弹「本次调整」摘要（AppModal，共调整 N 人按学生去重）；长按（400ms）信息卡（姓名 / 学号 / 宿舍 / 班委 / 标签 / 返家范围 + 查看详情 / 开始换座，详情复用学生模块 `StudentDetailModal`）；点击换座模式（提示条 + Esc 取消）；删除学生自动释放其全部方案座位（启动清扫 + store 删除监听双保险，不写日志、不留脏引用）；store 新增 `swapSeats / moveStudent / clearSeatByStudent / appendSeatChangeLog / clearCurrentLogs / commitPendingLogs`，旧 localStorage 数据 load 时升级兼容
- Phase 3C ✅（2026-09-10，tag v0.4.0）：教室工具——① 一键导出座位图：PNG（老师 / 学生视角）、PDF（老师视角单页 / 双视角同页上半学生下半老师），标题「高一9班 座位表」自动附方案名 + 导出日期，html-to-image + jsPDF（A4，中文全栅格化进画布）；离屏静态渲染区导出，不触碰页面状态与实时 DOM。② 学生定位（Search to Seat）：姓名 / 学号后四位搜索，唯一命中直接定位（滚动 + 座位闪烁 3 次 + 信息卡），重名列出候选不猜人。③ 教室固定标识（讲台 / 前门 / 后门 / 窗户）：Phase 3A 既有实现 + 双视角自动对位即满足，未做两套布局。④ Constraint Checker：`types/constraint.ts` + `stores/constraint.ts`（localStorage、CRUD、方向无关去重、学生删除联动清理）+ `utils/constraint.ts` 四类只读检查（不能同桌 / 不能相邻 → conflict；高个坐 1–2 排、班委 ≥2 同区 → warn；无问题 ✓），右侧面板逐行点击定位；`back-row / front-row / same-block` 为 3D 自动排座预留规则位。⑤ 座位约束基础版：长按信息卡「＋ 座位约束」添加 不能同桌 / 不能相邻（预设卡主为学生 A），管理弹窗启用开关 / 删除。⑥ 方案对比（SeatPlan Compare）：A（基准）/ B（对照）自动比较，共调整 N 人 + 明细（位置变化 + 跨区时左区 → 中区）；只读对比查看 = 变化学生黄色描边（选中松石青不受影响）+ 提示条；对比 PDF 3 页（B 全图 / 变化摘要 / 变化高亮图）。明确未开发：自动排座、Undo、多选拖拽、AI 排座
- Phase 3D ⏭（下一小步，范围待与用户对齐）：自动排座（身高 / 视力 / 纪律相邻等，基于 3C 约束项）+ Undo
- 需求背景与业务规则：班级约 62 人；教室参数唯一来源 `types/classroom.ts`；详见开发手册 §2.4 / §9.2–§9.4

## Phase 4 ⏭ 课程表

- 周视图课表（行 = 节次，列 = 星期）
- 课程编辑（科目、教师、教室）
- 首页「今日课程」卡片接入真实数据

## Phase 5 ⏭ 请假 / 离校管理

- 请假申请（类型、时段、原因）
- 审批流程与状态流转（AppBadge 展示状态）
- 首页「请假审批」卡片接入

## Phase 6 ⏭ 值日管理

- 值日表编排与周期轮换
- 完成情况打卡与统计

## Phase 7 ⏭ 周末管理

- 返家申请、审批、离校 / 返校登记、周末统计
- 数据基础已就绪：学生档案的返家范围（scope）必选已入库
- 概念边界：档案存"家庭所在地事实"，周末管理存"具体周末的行为结果"（开发手册 §2.2）

## Phase 8 ⏭ 首页仪表盘整合

- 首页 4 张卡片（今日课程 / 待办 / 请假审批 / 班级概况）接入真实数据
- DashboardCard 类型已就绪（当前为静态文案）

## Phase 9 ⏭ 后端接入

- 腾讯云 CloudBase + PostgreSQL
- `services/` 抽象层替换 localStorage 实现（注意修正其注释口径）
- 鉴权与多班级支持

## Phase 10 ⏭ macOS Widget

- SwiftUI + WidgetKit
- 数据源方案探讨：本地文件 / 短 URL

---

## 未排期候选（按需插入）

- 工具箱：随机点名、随机分组、课堂倒计时
- PWA 完善：正式 PNG 应用图标（当前为 SVG 占位）、离线体验打磨、更新提示
