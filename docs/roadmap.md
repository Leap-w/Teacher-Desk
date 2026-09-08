# TeacherDesk 路线图

> 同步自 `docs/开发手册.md` §10（2026-09-08 更新）。两份文档冲突时以开发手册为准。
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
- 重名区分 `formatStudentDisplayName`、8 名种子学生、UUID（crypto.randomUUID）
- 表单校验：姓名必填、学号必填且唯一、座位号非负整数、返家范围必选

## Phase 2 增量（2026-09-08）✅ 学生档案数据基础

- `Student` 新增 `familyAddress` 与 `familyLocation { prefecture, county, scope }`
- `FamilyScope = changdu-city | changdu-county | outside-changdu`（昌都市区 / 昌都市其他县 / 昌都市外）—— 行政区划事实，与"能否回家"无关（周末管理模块负责行为）
- 旧 localStorage 数据经 `normalizeStudent` load 时升级，不白屏、不覆盖
- Store 学号唯一性兜底（add/update 返回 undefined 拒绝）
- 卡片返家范围 Badge、表单「家庭信息」区、详情「家庭信息」区

## Phase 2.1 ⏳ 学生档案模型收敛（待办）

- 清理 boarding / 住宿走读遗留：`Student.boarding` 字段、表单住宿选择与宿舍联动、卡片/详情住宿行、`formatBoardingLabel`、mock 走读样本（3 名）
- 依据：全班统一住校（详见开发手册 §2.1）

## Phase 3 ⏭ 排座 / 座位管理（下一开发阶段）

- 教室座位网格（可视化排座），替换当前纯数字 `seatNumber` 字段
- 需求背景：班级约 62 人；3-3-3 座位布局思路；后续可能有学生间座位约束
- 详见开发手册 §9.2（仅记录背景，未开始设计）

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
