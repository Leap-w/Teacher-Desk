# 更新日志（CHANGELOG）

> 记录每个 tag 的交付内容；版本号与 git tag 一一对应（规范见 `docs/开发手册.md` §13.1）。
> 每条只记「用户能感知的变化」与「不可回退的关键实现」，详细设计与取舍见开发手册 §9 对应小节。
> 历史阶段（Phase 0–2 + 增量）已并入基线 `v0.2.0`，不再单列。

---

## v0.8.0 —— Phase 5 请假 / 离校管理（Leave）（2026-09-10，commit `feat: phase-5 leave management`）

`/leave` 由占位页升级为完整模块：**请假申请 → 审批 → 离校 / 返校登记**一条线打通，工作台新增「请假审批」卡片。

> 编号：路线图（开发手册 §10）中本阶段为 **Phase 5**。注意与 `v0.7.0` 的「Phase 5 课程中心」区分——那次是交付口径称 Phase 5（路线图编号 Phase 4.1），**两者不是同一交付**，以 tag 为准。

### 新增

- **`/leave` 请假管理页**：页头「请假管理 + 待处理 N 条 · 本月已批准 N 人次 + ＋ 新增请假」；搜索（学生姓名 / 学号后四位）+ 状态筛选（全部 / 待处理 / 已批准 / 已驳回，各带计数）；记录卡片列表（待处理置顶、已办按开始时间倒序）；空态区分「暂无请假记录」与「未找到匹配的请假记录」（后者带「清除筛选」）。
- **请假申请**：新增 / 编辑用右侧抽屉（复用 `AppDrawer`）——学生（按学号排序）/ 类型（病假 / 事假 / 其他）/ 开始与结束的「日期 + 上午 / 下午」/ 原因；**时长随填随显**（半天 / 1 天 / 1 天半，跨月 / 跨年同样正确）；同一学生同时段已有记录时给出**重叠提示但不拦截**（准不准由班主任判断）；写入成功后抽屉才关闭，被拒时已填内容留着可改。
- **审批**：批准 / 驳回共用一个弹窗（文案与按钮随选择切换），**驳回可写说明**（显示在卡片上）、**批准不保存说明**；审批单向，已办记录不可再改状态。
- **离校 / 返校登记**：**仅已批准**的记录可登记；打开时预填已登记时间，未登记则预填「此刻」；记错可**覆盖修改**（不必删记录重建，那样会丢审批结果与另一端时间）；校验时间线（先离校后返校）与「不能晚于现在」（登记的是既成事实）；未登记离校时「登记返校」按钮禁用并说明原因。
- **派生状态**：卡片上的「未离校 / 已离校 / 已返校」由两个登记时间戳**派生展示**（徽标语义色：未离校中性 / 已离校警示 / 已返校成功），**不新增第四种审批状态**。
- **工作台「请假审批」卡片**：待处理徽标（有则警示色）+ 最多列出 3 条待办单（姓名 / 类型 / 时段，点击进入请假页）+ 页脚「本月已批准 N 人次 · 还有 M 条待处理」+「去审批」（无待处理时为「去请假管理」）；`DashboardCard.key` 收窄为 `'class'`，首页只剩「班级概况」一张规划中卡片。
- **数据层**：`types/leave.ts`（`LeaveRecord` / `LeaveInput` / `LeavePoint` / `LeaveStatus` / `LeaveType`）+ `utils/leave.ts`（时长 / 时段文案 / `halfDayKey` 日历序 / 重叠判定 / `normalizeLeaveRecord`）+ `stores/leave.ts`（键 **`teacherdesk:leaves`**，`addLeave` / `updateLeave` / `decideLeave` / `registerLeftSchool` / `registerBackToSchool` / `removeLeave`，返回值契约同 student：`undefined` = 被拒、`false` = 不存在）。

### 变化

- `types/index.ts` 里原有的 `LeaveRecord` / `LeaveType` / `LeaveStatus` 脚手架类型**移除**，改由 `types/leave.ts` 承载（不留两套形状）。
- `services/mock.ts` 新增 3 条示例请假（待处理 / 已批准且已离校未返校 / 已驳回带说明）；**示例数据只在学生档案仍是示例数据时才播种**——`teacherdesk:leaves` 是新增键，否则每个存量用户第一次打开都会凭空多出 3 条别人家学生的记录。
- 工作台首页由 5 张卡片变为 6 张（新增「请假审批」）；`/leave` 不再使用 `PagePlaceholder`（占位页只剩 Duty / Toolbox）。

### 修复（交付前两轮独立审查：正确性 + 文档 / UX，共 19 项全部处理）

- **【阻塞】跨月 / 跨年的请假时长全部算错**：`halfDayKey` 原先对日期键做十进制相减，月份进位处 9-30 → 10-01 相差 71 天，「9月30日 → 10月1日」显示**共 72 天**（跨年更离谱），抽屉里随填随显、卡片与审批弹窗同样错——改为 `Date.UTC` 天序号（全程 UTC，不读时区）。
- **【高】存量用户升级凭空多出 3 条示例请假**（含 1 条待处理 + 1 条已批准）：播种收紧为「示例学生确实还在档案中」才写，否则返回空列表且不写盘。
- **【中】未登记离校时「登记返校」是死路**：store 必定拒绝，但提示指向「时间顺序」，教师看不出真正原因——改为卡片上直接禁用并说明。
- **【中】缓存被改坏的时间线**（「离校 9/12 → 返校 9/10」）会被原样加载且无法原样重存：load 时补时间线自洽校验，只丢被改坏的时间戳。
- **【低】**：日期守卫接受「2 月 31 日」这类不存在的日期（改回读校验）；登记允许未来时间（卡片会提前显示「已返校」）；页头「本月请假」实际只数已批准（文案改「本月已批准」）；「未离校 · 离校 未登记」语义打架（时间戳补「时间」前缀）；派生状态自造徽标样式（改用 `AppBadge`）；首页空态暗示不存在的「学生提交」通道（改文案）；筛选条缺 `aria-pressed`、卡片操作按钮无障碍名称缺学生姓名（补齐）；`withStudentNames` 注释与实现不符（只改注释）。
- 交付卫生：交付前自检临时文件已删除。

### 未实现（本阶段边界）

考勤记录（出勤 / 缺勤 / 点名）、销假流程、家长 / 学生端申请入口、请假条打印与导出、请假统计报表（只有「本月已批准人次」一个计数）、跨标签页 / 已安装 PWA 与浏览器之间的数据同步（各持整份数组、后写覆盖先写，与既有四个 store 同款，见开发手册 §9.8）、后端接入。周末返家（返家申请 / 审批 / 离校返校登记）仍归 Phase 7。

### 验证

- prettier --check / vue-tsc --noEmit / eslint / build 四项全通过；PWA **40 个 precache 条目**（Phase 4.1 为 35，+5：请假页与其组件 chunk）。
- 数据层运行时自检 **105 项**（四种模式：主用例 89 + 非法条目 10 + 缓存损坏 2 + 存量用户升级 4）+ SSR 渲染验证 **71 项**（工作台卡片与待处理数、请假页列表排序与三种状态分支、三个弹层、未登记离校时「登记返校」禁用与说明）全过；审查修复后均已复跑（修复前 73 / 63 项同样全过）。
- 未修改 Student / SeatPlan / Constraint / Timetable 四个 store 的数据与语义，未新增路由与一级导航，未触碰 PWA manifest / 图标 / 缓存策略。

---

## v0.7.0 —— Phase 4.1 / Phase 5 课程中心（Timetable）（2026-09-10，commit `feat: phase-5 timetable center`）

课表从「工作台的只读数据源」升级为**可编辑的课程中心**；`/schedule` 由占位页升级为真实页面。

> 编号：路线图（开发手册 §10）中本阶段为 **Phase 4.1**，交付口径称 **Phase 5**，两者同指本次交付。

### 新增

- **周课表页面** `/schedule`：手机（<760px）星期切换条 + 分日列表（空态「星期X没有课」+「＋ 添加课程」）；PC（≥760px）完整周视图（行 = 8 个节次，列 = 周一~周五；**录入了周末课时自动追加周六 / 周日列**，今天所在列主色高亮 + 「今天」标签）；页头「我的课表 · 本周共 N 节课 · ＋ 新增课程」；空格子可点击直接在该时段新增（预填星期 / 节次）。
- **课程编辑**：新增自研 `AppDrawer`（右侧抽屉）+ `AppSwitch`，表单含星期 / 节次 / 科目 / 班级（下拉选择已录入班级，或「其他（手动输入）」）/ 任课教师（默认「我」）/ 地点 / 临时代课开关；**时段冲突校验**（一位教师同一节次只能在一个班上课，提示「该时间已有课程：X（Y）」，编辑时排除自身）；删除需二次确认（AppModal）。
- **临时代课**：打开「临时代课」的课程在课表上显示「代课」徽标 + 暖色卡片 + 警示色左边框，无障碍名称同步带上「（代课）」；示例课表有意不含代课记录（代课是对他人缺勤的事实描述，由教师自己录入）。
- **工作台联动**：删除 Dashboard 内部 mock，今日课程 / 「今天 星期X」/ 本周课时全部改读 `timetableStore`；课表增删改后工作台即时同步。
- **共享时钟**：`useToday` 改为全应用共享的 `useNow()`（懒创建 + 单个 30 秒定时器），工作台头部、今日课程与课表「今天」同源，跨零点一起翻篇。
- **课程模型二合一**：`Lesson` 扩为 `{ id, weekday, period, subject, classId, className, teacher, location?, isTemporary? }`（+ `LessonInput`），成为**全项目唯一课程模型**；`utils/timetable.ts` 新增 `classIdOf` / `findSlotConflict` / `weekendWeekdaysOf` / `LESSON_PERIODS(1–8)` / `WEEKDAY_COLUMNS(1–5)` / 星期短标签。
- **UI Kit 公共设施** `components/ui/layers.ts`：滚动锁计数 + 层级栈 + 焦点陷阱，供 AppModal 与 AppDrawer 共用。

### 变化

- **存储键迁移**：`teacherdesk:timetable:lessons` → **`teacherdesk:timetable`**（首次加载自动迁移：补 `classId` / `teacher` 后写新键并删旧键；旧键损坏则保留现场、本次用示例课表）。新键损坏（非 JSON / 非数组）**降级为空课表**，不再重置为示例数据——课表可编辑后，重播种子会覆盖教师的真实课表。
- `stores/timetable.ts` 由只读变可写：新增 `addLesson` / `updateLesson` / `removeLesson`（`undefined` = 被拒、`false` = 不存在）+ `todayWeekday` / `todayLabel` / `todayLessons` / `weekendWeekdays` / `classNames` / `slotConflict`；改了班级名而未带 `classId` 时自动重新派生。
- `services/mock.ts` 示例课表补 `classId` / `className` / `teacher: '我'` / 地点（仍为 12 条 / 周）。
- `AppModal` 改用共享的滚动锁与层级栈：在已打开的抽屉上弹确认框，关闭确认框不再提前解锁页面滚动，一次 Esc 不再连关两层。

### 修复（交付前独立审查，12 项全部修复；无高 / 中危项）

- **写入被拒不再吞掉已填内容**：原先抽屉提交后无条件关闭，保存被 store 拒绝（如另一个标签页已删掉该课）时教师刚填的东西一起消失；改为由页面**写入成功后**才关抽屉，失败时内容留着可改。校验失败还会弹 toast 报首个错误——手机上面单滚动后，出错字段可能在视口外，只有内联提示等于没反馈。
- **迁移不再悄悄删数据**：旧键里有不合法条目时，原先会把它们丢弃后连旧键一起删掉；改为**有条目被丢弃就不删旧键**并告警（迁移是单向的，删了再也找不回原文），新键路径同样补丢弃告警。
- **`classId` 与班级名一一对应**：`classIdOf` 原先折叠空白，`高一9班` 与 `高一 9班` 会共用一个 id（下拉里两个班级名、一个身份），与 §9.7 取舍 ④ 相反；改为只做首尾 `trim`，并在写入校验里要求 `classId` 必须等于班级名的派生结果。
- 非法入参（`undefined` 字段）由**抛异常**改为**拒绝写入**（`typeof` 严格判定，同 load 口径）；节次上限单一来源（`MAX_LESSON_PERIOD` 由 `LESSON_PERIODS` 末项派生，删掉 store 里另算的一份）。
- 无障碍：周视图课程卡的无障碍名称补上**星期 + 节次**（原来读屏软件分不出「周一第 2 节」与「周四第 2 节」），分日切换条补 `aria-pressed`（原来只有视觉高亮）。
- 清理：硬编码 hover 色改用新增的 `--color-primary-soft-strong` / `--color-warning-soft-strong`（`AppButton` 同值替换，无视觉变化）；`759px / 760px` 之间的 0.02px 断点缝隙改为 `759.98px`；移除不可达的 `@submit.prevent="submit"`（回车保存未接线，见开发手册 §9.8）；交付前自检临时文件已删除。详见开发手册 §8「Phase 5 交付前审查」。

### 未实现（本阶段边界）

调课 / 停课 / 单双周 / 学期周次与起止日期、按日期的一次性调整、课表导入导出与打印、节假日跳过、班级实体（班级名即标识）、学生视角课表、代课的审批与归档、**跨标签页 / 浏览器与已安装 PWA 之间的课表同步**（各持整份数组、后写覆盖先写，与既有三个 store 同款，见开发手册 §9.8）、课程抽屉的回车保存。

### 验证

- prettier --check / vue-tsc --noEmit / eslint / build 四项全通过；PWA **35 个 precache 条目**（Phase 4 为 30，+5：课表页与其组件 chunk）。
- 数据层运行时自检 **74 项** + SSR 渲染验证 **43 项**全过（独立审查修复后复跑；修复前为 61 / 42 项，同样全过）。
- 未修改 Student / SeatPlan / Constraint 三个 store，未新增路由与一级导航，未触碰 PWA manifest / 图标 / 缓存策略。

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
