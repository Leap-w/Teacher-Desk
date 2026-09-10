# 更新日志（CHANGELOG）

> 记录每个 tag 的交付内容；版本号与 git tag 一一对应（规范见 `docs/开发手册.md` §13.1）。
> 每条只记「用户能感知的变化」与「不可回退的关键实现」，详细设计与取舍见开发手册 §9 对应小节。
> 历史阶段（Phase 0–2 + 增量）已并入基线 `v0.2.0`，不再单列。

---

## v0.6.0 —— Phase 4 工作台（Dashboard）（2026-09-10，commit `feat: phase-4 dashboard`）

首页从「四张建设中卡片」升级为班主任每天打开的**默认工作台**（手机优先，PC 自适应最大宽度 960px 居中）。

### 新增

- **今日课程**（最高优先级）：新增 `stores/timetable.ts`（键 `teacherdesk:timetable:lessons`）+ `types/timetable.ts`（`Lesson { id, weekday 1–7, period, subject, className, location? }`）+ `utils/timetable.ts`（`WEEKDAY_LABELS` / `weekdayOf` / `sortLessons`）。只显示**今天**的课（页面层由 `useToday().now` 解析星期，跨零点自动切换），按节次升序，展示「第N节 + 科目 + 班级 + 地点」，右上角「今天 星期X」；无课显示空态「今天暂无课程」（周末文案区分）。
- **今日待办**：新增 `stores/dashboard.ts`（键 `teacherdesk:dashboard:todos`）+ `types/dashboard.ts`（`Todo { id, text, done }`）。点击即完成 / 取消，完成项划线置灰，**刷新后保持**；卡片右上角「已完成 N / M」。种子 3 条：班会准备 / 检查卫生 / 批改作业。
- **快捷入口**：四个入口卡片（学生档案 → `/students`、座位管理 → `/seats`、家校沟通（规划中，点击给提示，**不新增路由**）、我的课表 → `/schedule`），图标统一 `@vicons/ionicons5`（本项目首个图标依赖，按需引入）；手机 2×2、PC 4 列。
- **本周课时统计**：从课表 store 自动统计「本周授课 N 节」；「较上周 ——」为占位（历史周次对比需保存往周课表，本阶段不做）。
- **今日日期头部**：`formatDateOnly` / `formatWeekdayLabel`（`utils/date.ts`）+ `useToday()` 驱动，三行依次为「2026年9月10日」「星期四」「{问候语}，今天也一起把班级管理做好。」（问候语由 `greetingByHour` 按时段给出：上午好 / 中午好 / 下午好 / 晚上好 / 夜深了），**不写死日期**。
- 首次启动种子课表 12 条 / 周（高一9班班主任，教本班与高一7班数学 + 本班班会；周末无课，用于验证空态）。

### 变化

- 首页原「今日课程」「待办事项」两张建设中卡片由真实卡片取代；「请假审批」「班级概况」保留为「规划中」卡片（`DashboardCard` 收窄为 `leave | class`，`icon` 改为 Vue 组件类型，改用 Ionicons）。
- `services/mock.ts` 新增 `createSeedLessons()` / `createSeedTodos()`。

### 修复（交付前独立审查，10 项全部修复；无高 / 中危项）

- 课表 load 用 `Number()` 强转星期 / 节次（`true` / `"1"` 会被当成周一第 1 节）→ 改 `typeof` 严格判定；两个 store 的 load 未去重 id（篡改出的重复 id 会让 `v-for` key 冲突）→ 按 id 只留首条。
- 星期文案有 `WEEKDAY_LABELS` 与 `Intl` 两个来源（同一天可能两种写法）→ 统一为 `WEEKDAY_LABELS[weekdayOf(date)]`；统计卡标题「本周课时」与内容「本周授课」用词不一致 → 统一为「本周授课」。
- 待办行触控高度 36px（低于移动端 44px 下限）→ 加大内边距；待办空态写「先在这里勾选完成情况」但列表为空时无物可勾 → 改写；三处硬编码间距 / 圆角 → 改用 token；超长上课地点会撑破整行 → 允许收缩换行。
- 死类名 `dash-card` / `cell-lessons` / `cell-todos` 清理；CHANGELOG 头部漏记问候语前缀。详见开发手册 §8「Phase 4 交付前审查」。

### 未实现（本阶段边界）

课表编辑与周视图（`/schedule` 仍为占位页）、待办的添加 / 删除 / 编辑、待办跨天归档与历史、周课时历史对比。

### 验证

- prettier --check / vue-tsc --noEmit / eslint / build 四项全通过；PWA **30 个 precache 条目**（Phase 3D 为 29，+1 首页 chunk，无异常下降）。
- 数据层运行时自检（种子 / 排序 / 周日 = 7 / 日期与星期文案 / 损坏与非数组缓存 / 逐条 normalize 丢弃非法记录 / 重复 id 去重 / 待办勾选与持久化）与 SSR 渲染验证（工作日渲染今日 2 节课、周末切换为空态并验证「今天」由 JS Date 驱动）在**审查修复后复跑：36 项 + 43 项全过**。
- 未修改 Student / SeatPlan / Constraint 三个 store，未新增路由与一级导航，未触碰 PWA manifest / 图标 / 缓存策略。

---

## v0.5.0 —— Phase 3D 自动排座（2026-09-10，commit `feat: phase-3D auto seat arrangement` + `fix: phase-3D review fixes`）

排座模块整阶段收尾：从「手工换座」进入「约束求解」。

### 新增

- **自动排座求解器** `utils/seatArrange.ts`（纯函数，无 store 依赖）：硬约束（不能同桌 / 不能相邻）**绝不违反**，无法全部满足则不生成方案并逐条报告冲突；软规则（坐后排 ≥5 排 / 坐前排 ≤2 排 / 同区块）**尽量满足**；「高个」标签派生低权重后排偏好，显式规则优先。贪心放置 + 换种子重启（≤200）+ 局部搜索（≤3000 步），自带 xorshift32 种子 PRNG（不引依赖）→ 同输入同种子结果确定，且与调用方数组顺序无关。
- 三个规则位（3C 预留）正式启用为**手工录入的软规则**，约束录入扩到 5 类（`ConstraintEditModal` 按类型显隐「学生 B」）；约束检查器新增 rules 分组，与求解器同源判定。
- 结果落地为**新方案**（默认名「自动排座 N」，原方案原样保留可对比 / 可切回）+「换一种排法」（换种子重排，沿用同一方案名不堆积）+「撤销」（切回原方案并删除新方案，页面级、不跨刷新）。
- store 增量：`createPlanFromSeats()`（不信任传入座位，按行列重算并整表重建 63 座，末排尾座强制留空）、`replacePlanSeats()`。

### 修复（交付前独立审查，8 项全部修复）

- 硬约束冲突文案把同一学生印两遍（重复 key）、断言「无法同时满足」（实为启发式未找到，改为「未能找到…（可能无解）」）、高个 + 显式坐前排规则导致检查器自造告警、`rerollArrange` 漏 `cancelPicker()`、无输入提示与「高个」摘要自相矛盾、`occupantsFromSeats` 同座位定序、`BACK_ROW_MIN` 注释脱节、超容量文案把学生总数当溢出数。详见开发手册 §8。

### 已知边界

- 贪心 + 重启在极稠密硬约束下可能找不到确实存在的排法（30 人两两「不能相邻」可复现）；档案 `seatNumber` 与方案座位自 Phase 3B 起即脱节，本阶段沿用。

### 验证

- 四项验证全通过；PWA 29 个 precache 条目；求解器运行时自测 29 项断言全过。

---

## v0.4.0 —— Phase 3C 教室工具（2026-09-10，commit `feat: phase-3C classroom tools`）

不做自动排座，先补齐教师日常要用的教室工具。

### 新增

- **座位图导出**：PNG（老师 / 学生视角）、PDF（老师视角单页 / 双视角同页 A4），标题「高一9班 座位表」自动附方案名与导出日期；中文全部由浏览器渲染进画布再嵌入 PDF（jsPDF 内置字体不含 CJK）；离屏静态渲染导出，不触碰页面状态。
- **学生定位（Search to Seat）**：姓名 / 学号后四位搜索，唯一命中直接滚动 + 座位闪烁 + 弹信息卡；重名列出候选不猜人。
- **Constraint Checker**：新增 `types/constraint.ts` + `stores/constraint.ts`（键 `teacherdesk:seatConstraints`，CRUD + 方向无关去重 + 学生删除联动清理）+ `utils/constraint.ts` 四类**只读**检查（不能同桌 / 不能相邻 → 红；高个坐 1–2 排、班委 ≥2 同区 → 琥珀；无问题 ✓），右侧面板逐行点击定位。
- **方案对比**：A（基准）/ B（对照）差异清单（共调整 N 人 + 位置 / 跨区明细）+ 只读对比查看（变化学生黄色描边）+ 3 页对比 PDF。
- 依赖新增：`html-to-image`、`jspdf`。

### 验证

- 四项验证全通过；PWA 29 个 precache 条目（较 3B +3）。

---

## v0.3.1 —— Phase 3B 拖拽换座（2026-09-09，commit `feat: phase-3B seat drag and swap`）

### 新增

- **拖拽换座**：Pointer Events 原生实现（无第三方库），已就座 ↔ 已就座 = 交换（2 条日志）、已就座 → 空位 = 移动（1 条）；从空位拖起 / 拖回原位 / 拖到空地不动作；PC 鼠标优先，双视角同一份数据即时同步。
- **换座日志 `SeatChangeLog`** 正式启用（UUID / ISO / 绑定方案 / 姓名快照），文案统一「姓名（学号后四位）」+「N排M列」；「保存本次调整（N）」归档并自动弹「本次调整」摘要（未保存前不落库，切换 / 新建方案即清空并提示）。
- **长按（0.4s）信息卡**：姓名 / 学号 / 宿舍 / 班委 / 标签 / 返家范围 +「查看详情」（复用学生模块弹窗）/「开始换座」；点击换座模式（提示条 + Esc 取消）。
- **删除学生自动释放座位**：启动清扫 + store 监听双保险，全部方案即时显示空位，不留脏引用、不写日志。

### 验证

- 四项验证全通过；PWA 26 个 precache 条目（较 3A +1）。

---

## v0.3.0-alpha —— Phase 3A 教室模型（2026-09-09，commit `feat: phase-3A classroom model`）

### 新增

- 固定教室模型 `types/classroom.ts`（高一9班 · 7 排 × 9 列 · 3-3-3 分列 · 63 座 · 就座 62 · 末排尾座留空 · 讲台 / 前后门 / 窗户），**唯一事实来源**，组件不硬编码教室数字。
- 座位 / 方案模型 `types/seat.ts` + `stores/seat.ts`（键 `teacherdesk:seatPlans`）：多方案（新建 / 切换 / 重命名 / 删除历史，当前方案不可删）、`seatNumber`(1–62) 按行优先座位号对号入座、load 时整表重建恒 63 座。
- 可视化座位网格 `/seats`：老师 / 学生**双视角**（约 300ms FLIP 翻转，选中跨视角保持）、班委 / 高个 / 标签强调标记、右侧方案管理面板。

### 验证

- 四项验证全通过；PWA 25 个 precache 条目（较 23 +2）。

---

## v0.2.1 —— 学生档案模型收敛：移除 boarding（2026-09-09，commit `refactor: remove boarding model`）

### 变化

- 全班统一住校（业务规则 §2.1），移除 `Student.boarding` 字段与全部住宿 / 走读 UI 遗留（表单选择器与联动、卡片 / 详情住宿行、`formatBoardingLabel`）；`normalizeStudent` 升级时剔除历史缓存里的 `boarding` 键。
- `dormitory`（宿舍文本）保留：它是「住在哪间宿舍」的中性事实，与住校 / 走读无关。
- 种子学生 8 → 6 名：删除 2 名走读样本，1 名（拉萨市外）转为住校样本保住市外覆盖。

### 验证

- 四项验证全通过；PWA 23 个 precache 条目不变。

---

## v0.2.0 —— 基线：Phase 0–2 完成态（2026-09-09，commit `chore: baseline after phase-2 student module`）

`git init` 后的基线提交，此前全部开发（Phase 0–2 + 增量，2026-09-08 及之前）并入此提交。

### 包含

- **Phase 0**：Vue 3 + Vite + TypeScript(strict) + Router + Pinia + UnoCSS + PWA 工程框架；Apple 风格松石青主题；Sidebar（路由表驱动）+ AppHeader 布局；7 个页面路由；ESLint + Prettier。
- **Phase 1**：Design Tokens（`styles/theme.css`）+ 10 个自研基础组件（AppButton / AppCard / AppInput / AppTextarea / AppSelect / AppField / AppBadge / AppModal / AppToast / EmptyState）+ 全局 Toast 与 Modal 交互规范。
- **Phase 2**：学生档案 MVP——`stores/student.ts`（localStorage 持久化 / seed-on-null / load 守卫 / 软删除）、列表（搜索 + 筛选 + 按学号升序）、卡片网格、详情 / 新增 / 编辑弹窗、重名区分 `formatStudentDisplayName`、学号唯一性双层防御、6 名种子学生。
- **Phase 2 增量（2026-09-08）**：`familyAddress` + `familyLocation { prefecture, county, scope }`（返家范围为行政区划事实，与「能否回家」无关）、`normalizeStudent` 旧数据升级、Store 学号唯一性兜底。
