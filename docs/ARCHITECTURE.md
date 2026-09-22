# TeacherDesk 架构总览（V3.0）

> 一页看懂 TeacherDesk 的分层与数据流。Phase Cloud-1（v2.2.0-alpha）起，
> 数据访问统一走 **Repository 层**——这是 Web（当前）、CloudBase（未来）、
> PostgreSQL（未来）共享的唯一数据规范（Repository First）。

## 总体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                          视图层（Vue 3 SFC）                       │
│   views/Home · Students · Seats · Leave · Duty · Weekend         │
│   views/Schedule · Works · Fund · My · Toolbox                   │
│   组件体系：components/ui（Design System）· dashboard/ · layout/  │
└───────────────┬──────────────────────────────────────────────────┘
                │ 只调用 Store（Pinia），不触碰任何存储
┌───────────────▼──────────────────────────────────────────────────┐
│                     状态层（Pinia Stores ×11）                     │
│   student · seat(+constraint) · leave · duty · weekend            │
│   timetable(schedule) · work(task) · fund(v3.6.0) · user          │
│   appSettings（Hero 与时光中心共用）                                │
│   业务规则 / 派生计算 / 动作校验；**不直接读写存储**                 │
└───────────────┬──────────────────────────────────────────────────┘
                │ 读写 + bind（唯一数据入口，Repository First）
┌───────────────▼──────────────────────────────────────────────────┐
│                   数据访问层（src/repositories/）                  │
│  ┌──────────── base/ ────────────────────────────────────────┐   │
│  │ types.ts        SyncStatus · SaveResult · RepositoryResult │   │
│  │                 DataSourceAdapter · CollectionRepository    │   │
│  │ createCollectionRepository   读写原语（load/writeSeed/bind）│   │
│  └────────────────────────────────────────────────────────────┘   │
│  ┌──────────── adapters/ ─────────────────────────────────────┐   │
│  │ LocalStorageAdapter ✅ 当前唯一实现（纯委托 services 层）    │   │
│  │ CloudAdapter        占位（connect/pull/push/sync TODO）     │   │
│  └────────────────────────────────────────────────────────────┘   │
│  ┌──────────── 模块仓储 ──────────────────────────────────────┐   │
│  │ studentRepository · seatRepository · seatConstraintRepo     │   │
│  │ leaveRepository · dutyRepository · weekendRepository        │   │
│  │ scheduleRepository(lessons+exchanges) · taskRepository      │   │
│  │ fundRepository · fundCollectionRepository · fundCategoryRepo │
│  │ userProfileRepository · appSettingsRepository                │   │
│  │  各自拥有：键名 · 复活规则(normalize) · 播种守卫 · 迁移       │   │
│  └────────────────────────────────────────────────────────────┘   │
└───────────────┬──────────────────────────────────────────────────┘
                │ DataSourceAdapter 契约
┌───────────────▼──────────────────────────────────────────────────┐
│                        服务层（src/services/）                     │
│   storage.ts    全应用唯一写盘点（幂等写 / 损坏降级 / 写盘记账）     │
│   sync.ts       syncPersisted 注册表：写盘 + 跨标签页广播 + 云同步   │
│   cloudSync.ts  云同步冲突口径（最后写入胜出 + 示例数据豁免）        │
│   mock.ts       示例数据（播种用）                                  │
└───────────────┬──────────────────────────────────────────────────┘
┌───────────────▼──────────────────────────────────────────────────┐
│              持久化：localStorage（键名不变，零迁移）               │
│  teacherdesk:students / seatPlans / seatConstraints / leaves      │
│  teacherdesk:duty / weekendReturns / timetable(:exchanges)        │
│  teacherdesk:works / profile                                     │
│  teacherdesk:fund:records / fund:collections / fund:expenseCats   │
└──────────────────────────────────────────────────────────────────┘
```

## 数据流（一次编辑的旅程）

```
组件事件 → Store action（校验 + 派生） → ref 更新
  → Repository.bind 注册的 watch → LocalStorageAdapter.writeJSON（幂等）
      ├─ services/storage.ts 记录写盘时刻（最后写入胜出的依据）
      └─ services/sync.ts 广播键名
           ├─ 其它标签页：重读 → revive → 回写内存（幂等链自然终止）
           └─ 云同步（若启用）：对比基线 → push/pull（Cloud-2 前恒 LocalOnly）
```

首次启动的播种：Store 调 `repo.load()` → 键不存在 → 模块仓储执行**播种守卫**
（示例学生是否都在读）→ `repo.writeSeed(seed)` 登记基线 → 首次云同步据此
认出「本机只有示例数据」。守卫规则在仓储里，Store 与 adapter 都不掺和。

## 同步层（V2.2.1-alpha · Phase Cloud-2 起）

```
UI（同步徽章 / 提示条）──只读──► SyncSnapshot
                                    ▲
                     useSyncEngine（响应式桥）
                                    ▲
        ┌───────────── SyncEngine（sync / enqueue / flush）────────────┐
        │  SyncQueue(FIFO+retry)  SyncStateMachine(5 态)  SyncEvents    │
        │  ConflictResolver(Local Wins 占位)                           │
        └───────────────────────────┬─────────────────────────────────┘
                                    │ 注入 SyncTransport（唯一接缝）
                    CloudTransport（Cloud-3，真实通道）
                    SimulatedTransport（测试与本地演示）
```

### 云同步流程（Cloud-3：Repository → SyncEngine → CloudBase）

```
本地写盘（Store → Repository → LocalStorageAdapter）
  └─ services/sync 广播键名 → onSyncDirty(key)
        └─ autoSync（调度层）：isCloudReady() ? engine.enqueue(key) : 忽略（本地模式）
              └─ 防抖 1.5s → SyncEngine.flush()
                    └─ CloudTransport.push(key) → syncKeyNow(key)（v3.4.1 起不再盲推）
                          └─ pull 这一份 → decideKey 裁决（与整轮对账同一个函数）
                                ├─ push     → RemotePort.push({ key, payload, updatedAt }) → CloudBase 文档
                                ├─ adopt    → 写盘 → applySyncKeys（内存跟上）
                                └─ conflict → 一个字都不动，列进待裁决

触发整轮对账（SyncEngine.runCycle → CloudTransport.sync → syncNow）：
  应用启动 ｜ 邮箱登录完成 ｜ 回到前台 ｜ 重新联网 ｜ 手动「立即同步」
    └─ pull 全量文档 → decideKey（LWW + 首次同步保护）逐键裁决
         ├─ push   ：本机更新 → 推上去 + 记对齐记账（seen / syncedAt / localUpdatedAt）
         ├─ adopt  ：云端更新 → 写盘采纳 → applySyncKeys 让内存与其它标签页跟上
         └─ conflict：两边都改过且首次同步 → 一个字都不动，列进待裁决（工具箱逐键选择）

首次初始化（§六）：登录后 probeFirstSync()
  empty → 正常开始 ｜ local-only → 问「是否用本机数据初始化云端」
  cloud-only → 直接拉 ｜ both → 交给逐键裁决
```

**回声抑制**：整轮对账采纳远端时的写盘（状态为 `syncing`）**不再入队**——
否则会把刚取下来的内容又推回去，两台设备之间来回多推一轮。

### 长事务（Operation Lock，RC-1 起）

导入 / 批量修改这类「一次写很多键」的操作，不能和自动同步抢同一个键——否则云端会先看到
改到一半的样子。做法是一条**纯调度**的锁（`src/sync/operationLock.ts`，不 import Vue / 引擎 / 云模块）：

```
长事务入口（views/*）：runLockedOperation(name, fn)   ← composables/useOperationLock.ts
  ├─ operationLock.begin(name)              计数式上锁（同名可嵌套，最后一个 end 才解锁）
  ├─ fn()                                   真正写数据（一次写很多键）
  ├─ await nextTick()                       ★ 等本批写盘广播（Vue watcher）跑完再解锁
  ├─ operationLock.end(name)                完全解锁 → 通知订阅者
  └─ flushAfterOperation()                  队列空则什么都不做（本地模式不会被误标「已同步」）

锁定期间：
  onSyncDirty(key) → operationLock.deferKey(key) ✓  记账，不入队、不推云
  scheduleFlush()  → 查 locked，锁定则跳过          导入中途半个方案都不上云
解锁时：
  autoSync 的 onUnlock → 逐个 enqueue(记账的键) → scheduleFlush(0) → 立刻补推
```

**Operation Lock（长期规范）**：任何「一次写很多键」的操作都必须走 `runLockedOperation()`；
**不许**自己写 `begin` / `end`（漏写 `end` 会把自动同步永久停掉，而界面看不出任何异常）。
`finally` 保证解锁一定发生，写入抛错也不留死锁。

### 同步时序（一次本地改动，Cloud-4 完整链路）

```
Store（业务动作）
  ↓ 改 ref
Repository（bind 的 watch）
  ↓ 幂等写盘
LocalStorageAdapter → services/storage（写盘记账）+ services/sync（广播键名）
  ↓ onSyncDirty(key)
autoSync 调度层（只有这里 import 云模块）
  ↓ isCloudReady() ? engine.enqueue(key) : 忽略（本地模式）
SyncEngine 队列（FIFO + 同键去重 + 指数退避 1s→2s→4s + 20s 超时）
  ↓ 防抖 150ms 落盘（teacherdesk:sync-queue）→ 防抖 1.5s → flush()
CloudTransport（SyncTransport 实现）
  ↓ syncKeyNow(key)：先拉这一份云端文档 → decideKey 裁决（与整轮对账同一函数）
    ├─ 推   ：services/cloudSync 的 LWW 记账（seen / syncedAt / localUpdatedAt）→ RemotePort.push
    ├─ 采纳 ：写盘 → applySyncKeys（内存与其它入口跟上）
    └─ 冲突 ：一个字都不动，列进待裁决（工具箱显示「需要确认」）
  ↓
CloudBase 文档（key / payload / updatedAt）
  ↓ 事件 sync:start / sync:success / sync:error / sync:retry / sync:state
UI（同步徽章 / 首页提示条 / 工具箱诊断卡）＋ 队列快照落盘
```

### 冲突处理流程（Single User · Last Write Wins）

```
decideKey(本地原文, 云端文档, 对齐记账, now, 本机是否为播种内容)
  ├─ 本地无此键            → adopt（以云端为准）
  ├─ 云端无此键            → push（本机这份是新数据）
  ├─ 本地未变 + 云端更新    → adopt（云端胜）
  ├─ 本地未变 + 云端未变    → skip（一个字节都不动）
  ├─ 本地改了 + 云端也变了
  │    ├─ 首次同步（无记账）
  │    │    ├─ 本机只有播种内容 → adopt（新设备装上就该看到已有数据）
  │    │    └─ 本机有真实数据   → conflict（一个字不动，交教师逐键裁决）
  │    └─ 不是首次同步         → 比 updatedAt：新者胜出（push 或 adopt）
  └─ 云端两轮之间被改动、本机也改 → 同上比时间
```

**不传播删除**（无墓碑）：本地清空后重新播种，把「云端缺失」当删除指令会让一次误删
沿所有设备清干净；空数组（**键还在，内容为空**）则会正常同步。

**Sync Engine First（长期规范）**：CloudBase、跨设备同步、定时同步**只能调用
`SyncEngine`**，不得直接调用 `CloudAdapter`——后者永远只是数据通道，同步策略
（排队 / 重试 / 冲突 / 状态）始终集中在一层。

状态机：`LocalOnly → SyncPending → Syncing → Synced`，失败进 `Error`（重试耗尽）。
本阶段引擎空闲态即 `LocalOnly`（模拟传输、无网络、无用户可见行为变化）。

## 分层规则（改代码前先看）

| 层           | 允许                                           | 禁止                                             |
| ------------ | ---------------------------------------------- | ------------------------------------------------ |
| views        | 调 Store、组件、composables                    | 碰 repositories / services / localStorage        |
| stores       | 调 Repository、utils                           | 碰 services/storage、services/sync、localStorage |
| sync         | 调注入的 SyncTransport                         | 直接调 CloudAdapter / fetch / localStorage       |
| repositories | 调 adapter、utils、（seed 可读 student store） | 碰业务 Store 的其它成员、组件                    |
| adapters     | 调 services/storage、services/sync             | 业务判断（normalize / 播种守卫）                 |
| services     | —                                              | 不 import 上层（保持可独立测试）                 |

> **页面（views / components）只认识 stores 与 composables**，四个例外口子全部是 composable：
>
> | composable         | 管什么                                          | 底下的东西                                     |
> | ------------------ | ----------------------------------------------- | ---------------------------------------------- |
> | `useOperationLock` | 长事务（导入 / 批量修改）期间暂停同步           | `src/sync/operationLock.ts` + SyncEngine       |
> | `useSyncEngine`    | 同步状态的只读视图                              | SyncEngine 快照                                |
> | `useCloudActions`  | 登录 / 登出 / 立即同步 / 首次初始化             | `src/sync/autoSync.ts`（**只有它会引云 SDK**） |
> | `useCloudSync`     | 工具箱那张卡的既有云通道 + 冲突裁决             | `services/cloudSync.ts`                        |
> | `useBackup`        | 导出 / 导入 / 清空 / 备份提醒（**整份数据集**） | `repositories/backup/backupRepository.ts`      |
>
> 页面**不许**直接 import `@/services/*`、`@/sync/autoSync`、`@/repositories`——
> 前两者会把云 SDK 或底层实现拖进页面依赖图，后者会让「谁能碰数据源」变得说不清。
> V3.0.0 起这条已经真实成立（views / components / stores 三层的越层引用为零）。
>
> **v3.5.0 起另有一条「导入弹窗」的收敛**（不属于上表那几个数据源口子，故单列）：
> 五个导入弹窗的**取文件管道**（`file` → 二维数组，`services/studentImport::readSheetRows`）
> 与**外观**（上传卡 / 说明区 / 已选文件行 / 统计卡 / 提示条 / 逐行预览表）分别收进
> `composables/useSheetImport.ts` 与 `components/ui/Import*.vue`（六个组件 + `ui/importUi.ts`）。
> 收益是可数的：`readSheetRows` 的 import 点从 5 处降到 1 处，各弹窗的 scoped CSS 从 ~90 行降到 6 行。
> 各弹窗仍直接 import 各模块的**纯解析函数**（`parseSeatRows` / `parseStudentRows` / …）——
> 那是把它们自己的业务规则接进来，与「谁碰数据源」无关。

## 下一步

- **CloudBase 真机验证**：`docs/release-checklist.md` 第 3、10 节是上线当天的人工步骤。
- **PostgreSQL（可选远端）**：只新增一个 `DataSourceAdapter` 实现，Store 与页面零改动。
- **课堂 / 教学侧工具（V2.3+、V2.4）**：新工具先补 `utils/` 纯逻辑 + 常驻测试，页面只做渲染与交互。

详细历史决策见 `docs/开发手册.md` §9（按阶段编号）；用户可感知的变化见 `docs/CHANGELOG.md`。
