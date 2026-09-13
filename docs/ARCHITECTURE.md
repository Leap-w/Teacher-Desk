# TeacherDesk 架构总览（V2.2）

> 一页看懂 TeacherDesk 的分层与数据流。Phase Cloud-1（v2.2.0-alpha）起，
> 数据访问统一走 **Repository 层**——这是 Web（当前）、CloudBase（未来）、
> PostgreSQL（未来）、macOS Widget（未来）共享的唯一数据规范（Repository First）。

## 总体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                          视图层（Vue 3 SFC）                       │
│   views/Home · Students · Seats · Leave · Duty · Weekend         │
│   views/Schedule · Works · My · Toolbox                          │
│   组件体系：components/ui（Design System）· dashboard/ · layout/  │
└───────────────┬──────────────────────────────────────────────────┘
                │ 只调用 Store（Pinia），不触碰任何存储
┌───────────────▼──────────────────────────────────────────────────┐
│                     状态层（Pinia Stores ×9）                      │
│   student · seat(+constraint) · leave · duty · weekend            │
│   timetable(schedule) · work(task) · dashboard · user             │
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
│  │ dashboardRepository · userProfileRepository                 │   │
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
│  teacherdesk:works / dashboard:todos / profile                    │
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

## 分层规则（改代码前先看）

| 层           | 允许                                           | 禁止                                             |
| ------------ | ---------------------------------------------- | ------------------------------------------------ |
| views        | 调 Store、组件                                 | 碰 repositories / services / localStorage        |
| stores       | 调 Repository、utils                           | 碰 services/storage、services/sync、localStorage |
| repositories | 调 adapter、utils、（seed 可读 student store） | 碰业务 Store 的其它成员、组件                    |
| adapters     | 调 services/storage、services/sync             | 业务判断（normalize / 播种守卫）                 |
| services     | —                                              | 不 import 上层（保持可独立测试）                 |

## 下一步（Phase Cloud-2+）

- **CloudAdapter 实现**：pull/push/sync 对接 CloudBase；冲突口径整体迁自
  `services/cloudSync.ts`；`SyncStatus` 由真实状态驱动（UI 的同步徽章随之点亮）。
- **macOS Widget**：经同一套 Repository 读数据（Swift 侧走云端或共享存储，
  复用相同键名与 revive 规则的移植版）。
- **PostgreSQL（可选远端）**：只新增一个 `DataSourceAdapter` 实现，Store 与页面零改动。

详细历史决策见 `docs/开发手册.md` §9（按阶段编号）；用户可感知的变化见 `docs/CHANGELOG.md`。
