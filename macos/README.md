# TeacherDesk · macOS 原生 Widget（Phase 12）

三个只读小部件，摆在 macOS 桌面上：**今日课程**、**今日待办**、**班级概况**。

> **Web/PWA 是唯一的业务系统，Widget 是它的只读窗口。**
> 这里一个字节的业务数据都改不了——Widget 里点一下只会跳回网页，编辑永远在网页里做。

## 它不是什么

- **不是 TeacherDesk 的桌面版。** 宿主 App 里没有课表、没有档案、没有工作台，一个业务页面都没有。
  它只做一件事：登录 → 从云端把数据拉下来 → 写成一份只读快照 → 让 Widget 读。
- **不是第二套业务逻辑。** Widget 不直连数据库、不写业务数据、不重新实现 CloudBase SDK，
  也没有自己的「今日课程怎么算」——快照里的每一条派生规则都在 Swift 注释里注明了 Web 侧的出处。
- **不碰 Web 工程。** 整个 Phase 12 只新增了 `macos/` 这一个目录，`src/` 一行没动。

## 数据是怎么流动的

```
   CloudBase  ──① 拉取（只读）──▶  宿主 App  ──② 写快照──▶  ~/Library/Application Support/
                                                                  TeacherDesk/
                                                                  widget-snapshot.json
                                                                  │
                                                          ③ 只读（不联网）
                                                                  ▼
                                                            Widget 扩展
                                                                  │
                                                     ④ 点击 → 打开 Web/PWA
                                                                  ▼
                                                             Safari（在这改数据）
```

三点值得说明：

1. **为什么中间要有一个宿主 App。** Web/PWA 跑在 Safari 的沙箱里，**写不进任何原生 App 的共享位置**。
   所以「PWA 直接喂给 Widget」这条路在 macOS 上根本不通，中间必须有一个原生进程当桥。
2. **Widget 扩展不联网**——它那份源码里没有任何网络调用，
   `CloudBaseClient.swift` 只编进宿主 App 的 target，根本不在扩展里。
   ⚠️ 注意这是**代码纪律**，不是系统强制：这个 App 不开沙箱（理由见下），
   所以没有「不写联网 entitlement 就联不上网」那层保证。这是有意换来的代价。
3. **宿主 App 对云端只读**：只登录、只查询、从不写回。Web 仍然是唯一的写入方。

## 目录

```
macos/
├── TeacherDesk.xcodeproj/      Xcode 工程（手写的 pbxproj，见下面「工程文件」）
├── project.yml                 XcodeGen 备用描述（工程被改坏时用它重建）
├── Shared/                     宿主 App 与 Widget 共用的代码（两边都编一份）
│   ├── SnapshotModel.swift     快照的契约 + 宽容解码
│   ├── SnapshotStore.swift     快照文件的唯一读写入口（Application Support）
│   ├── SnapshotBuilder.swift   云端文档 → 快照（纯函数）
│   ├── SnapshotDerive.swift    展示级派生（星期换算、当天筛选、计数）
│   ├── CloudDocuments.swift    云端文档的形状与键名
│   ├── DesignTokens.swift      松石青等设计变量（从 src/styles/theme.css 抄来）
│   ├── WidgetLinks.swift       点击 Widget 时打开哪个页面
│   ├── ClassroomDefaults.swift 班级名（Web 侧常量的副本）
│   └── SnapshotSample.swift    预览/占位用的样例数据
├── TeacherDesk/                宿主 App（登录 + 同步，无业务界面）
│   ├── TeacherDeskApp.swift
│   ├── AppState.swift          状态机：登录 → 拉取 → 写快照 → 通知 Widget 重载
│   ├── HostView.swift          全部界面（一屏）
│   ├── CloudBaseClient.swift   ⚠️ 唯一手写 HTTP 协议的地方，最脆的一块
│   └── KeychainStore.swift     token 存哪儿
├── TeacherDeskWidget/          Widget 扩展
│   ├── TeacherDeskWidgetBundle.swift
│   ├── TeacherDeskWidgets.swift    三个 Widget 定义 + 时间线
│   └── Views/                      WidgetChrome / Lesson / Todo / Class
├── Samples/snapshot.sample.json    样例快照
└── Tools/
    ├── verify.sh                   自检（配置 + 类型检查 + 冒烟测试 + Xcode 真编译）
    └── use-sample-snapshot.sh      把样例快照塞进共享容器
```

## 跑起来

### 0. 先看长什么样（不需要登录）

```sh
cd macos
sh Tools/use-sample-snapshot.sh
```

然后把小组件加到桌面（**右键桌面 → 编辑小组件 → 搜 TeacherDesk**）。
样例课程是周一到周五，周末打开会看到空态，那是正常的。

### 1. 打开工程

```sh
open macos/TeacherDesk.xcodeproj
```

> **如果 `xcodebuild` 报 "requires Xcode, but active developer directory is a command line tools instance"**，
> 说明 `xcode-select` 还指着 Command Line Tools。二选一：
>
> ```sh
> sudo xcode-select -s /Applications/Xcode.app/Contents/Developer   # 全局切过去
> ```
>
> 或者不改全局设置，只在当前终端里指定（`Tools/verify.sh` 用的就是这招，不需要 sudo）：
>
> ```sh
> export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
> ```

### 2. 签名：不需要配

**两个 target 都不开 App Sandbox**，entitlements 是空的。
所以 ad-hoc 签名（`-`）就够，**不需要 Apple ID，不需要开发者账号，不需要 App Groups**。

宿主 App 与 Widget 靠一个**普通目录**交换数据：

```
~/Library/Application Support/TeacherDesk/widget-snapshot.json
```

路径的唯一真源是 `Shared/SnapshotStore.swift`——两个 target 都从那里取，
不会出现「写的一个路径、读的另一个」这种最难查的分叉。

选这条路是因为这个 App **不上架、只自己用**。App Groups 是付费开发者账号的能力，
而沙箱要配的东西更多、出错时更难查。换成普通目录之后还有一个额外好处：
**排查问题时直接 `cat` 那个文件**，就知道 Widget 到底读到了什么。

> **要换回沙箱 + App Groups 的话**（比如哪天要给别的人用）：
> 在两个 entitlements 文件里加回 `app-sandbox` / `application-groups`，
> 并把 `SnapshotStore` 的路径实现改回 `containerURL(forSecurityApplicationGroupIdentifier:)`。
> 两个 entitlements 文件的注释里写了具体要加哪些键。这是一个**已知的、有意的**技术债，
> 不是遗漏。

### 3. 跑宿主 App

选 **TeacherDesk** scheme 运行，用 TeacherDesk 的**用户名 + 密码**登录
（⚠️ 是用户名，不是邮箱——Web 侧踩过这个坑）。登录成功会自动同步一次。

点「立即同步」会重新拉一遍，并让三个 Widget 立刻重画。

### 4. 填 Web 地址

宿主 App 底部那个「TeacherDesk 网页地址」，填上 PWA 的地址。
填了之后，点 Widget 就打开那个页面；没填就只唤起宿主 App。

## 自检

```sh
cd macos && sh Tools/verify.sh
```

有 Xcode 时跑六档：配置语法、JSON 合法性、两轮类型检查、29 项冒烟测试、
`xcodebuild -list`、以及 **`xcodebuild` 真编译一次**（不签名）。
只有 Command Line Tools 时前四档照跑，后两档跳过。

## 工程文件

`TeacherDesk.xcodeproj/project.pbxproj` 是**手写**的（写它的时候本机还没装 Xcode）。
它已经被 `xcodebuild -list` 和一次完整的 `xcodebuild build` 验证过——两个 target、
两个 scheme、扩展嵌入、资源目录编译全都正常。

万一以后被改坏（合并冲突解不干净之类），用备用方案重建：

```sh
brew install xcodegen
cd macos && xcodegen generate
```

`project.yml` 里的设置与手写的 pbxproj 是等价的（target 名、bundle id、
entitlements 都对得上），只是 UUID 会变。

## 已知取舍与未验证项

**这一节是这份 README 里最该读的部分。**

### 验证到什么程度了

| 事项                                                     | 状态                                                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 工程能被 Xcode 解析（两个 target / 两个 scheme）         | ✅ `xcodebuild -list`                                                                                |
| 全部 Swift 编译通过、Widget 扩展构建并嵌入、资源目录编译 | ✅ `BUILD SUCCEEDED`                                                                                 |
| 宿主 App 启动不崩                                        | ✅ 跑起来进程存活（ad-hoc 签名）                                                                     |
| 快照文件「写入 → 读回」整条链路                          | ✅ 端到端实测（样例写进去，`SnapshotStore.read()` 读回 `.ok`，17 节课 / 5 条待办 / 47 在读全部正确） |
| 快照组装、解码、星期换算、筛选排序、计数、深链           | ✅ 29 项冒烟测试                                                                                     |
| 全部 Swift 源码类型检查                                  | ✅ 两轮通过                                                                                          |
| `CloudBaseClient` 登录/取数                              | ⚠️ 只验证到「端点在、请求形状对」（见下），**没跑通过一次真实登录**                                  |
| Widget 渲染、三种尺寸排版                                | ❌ 未验证                                                                                            |
| 时间线 30 分钟刷新、同步后立即重画                       | ❌ 未验证                                                                                            |
| 点击 Widget 的跳转行为                                   | ❌ 未验证                                                                                            |
| **Widget 能否被系统的组件库加载**                        | ❌ 未验证                                                                                            |

最后四条必须**把 Widget 加到桌面上**才知道，属于「只能在图形界面里看」的部分。

> 最后一条是本设计里唯一一处**结构性**的未知：不开沙箱的 widget 扩展，
> 系统（`chronod`）认不认？绝大多数 macOS widget 都是沙箱的，但没有哪份文档说沙箱是硬性要求。
> 如果加桌面时组件库里根本搜不到 TeacherDesk，那就是这里的问题——
> 解法是回到沙箱 + App Groups（见上面「签名：不需要配」里的那段）。

### `CloudBaseClient` 为什么是最脆的一块

Web 侧用的是官方 `@cloudbase/js-sdk`，Swift 这边没有等价 SDK，只能直接打它的网关。
每条端点的出处都写在 `CloudBaseClient.swift` 的注释里（SDK 源码的行号）。
其中「`Basic base64("<env>:")` 这个凭据头」是**用 curl 打真网关试出来的**：
带上它返回 `INVALID_CREDENTIALS`（说明凭据被接受、真的去验账号了），不带返回 `MISSING_CREDENTIALS`。

但**数据查询那一环没能这样验证**——网关在凭证层就先拦住了，无论路径对错都回同一个 401，
分不出 404 和 401。它是照着 SDK 源码（`database/src/index.ts:286`、`:313`）推的。
第一次真登录如果失败，**先看这里**。

好消息是它坏起来很安全：宿主 App 对云端只读，出问题只会「同步失败」，
Widget 继续显示手上那份旧数据，**不会损坏任何东西**。

### 三个有意的「不做」

1. **没有「当前/下一节」与「当前时间段」。**
   规格里提到了这个，但**全应用没有任何一节课的上课时间**——课表里只有「周几 / 第几节 / 科目」。
   要做就得凭空编一套作息时间表，那是发明数据，不是展示数据。所以只做「今天第 N 节」的列表。
   真要做，得先在 Web 的数据模型里加上下课时间。

2. **值日轮换、留校统计没有搬进 Swift。**
   班级概况里本来可以放这两项，但它们是**业务算法**（要读请假记录、算轮换序号）。
   搬进来就是造第二套业务逻辑，且两边一旦不一致，教师没法判断哪个对。
   Widget 里只显示不需要算法的两个数：在读人数、当前座位方案。

3. **班级名是一个复制来的常量**（`ClassroomDefaults.name`）。
   它在 Web 侧就不是用户数据（学生档案里连 `className` 字段都没有），**没有任何地方能读出来**。
   所以只能复制一份，换班级时两边都要改——`ClassroomDefaults.swift` 里写了这件事。

### 规格与代码库对不上的地方

Phase 12 的规格里写的是 **PostgreSQL**，但这个项目用的是 **CloudBase 文档存储**
（`src/services/cloudbase.ts`），没有 PostgreSQL、也没有任何 SQL。
本实现按**代码库的实际情况**走：宿主 App 直连 CloudBase 拉那四份文档。
如果将来真要换 PostgreSQL，换的是 `CloudBaseClient.swift` 这一个文件，其余不动。

## 出问题了怎么查

Widget 上那行小字就是诊断入口，四种说法对应四种处境：

| 显示             | 意思                            | 去看                                              |
| ---------------- | ------------------------------- | ------------------------------------------------- |
| `更新于 09:32`   | 正常                            | —                                                 |
| `尚未同步数据`   | 那个文件不存在                  | 宿主 App 登录过吗？同步成功过吗？                 |
| `数据读取失败`   | 文件在，但解析不了              | 文件被改坏了，重新同步一次                        |
| `找不到快照目录` | 算不出 Application Support 路径 | 正常机器上不该出现；真出现了看宿主 App 里报的路径 |

宿主 App 那边的错误是**云端原话**——没编成「同步失败，请重试」。
搜那句英文原文，比搜我们的转述有用。

想直接看一眼 Widget 到底读到了什么：

```sh
cat ~/Library/Application\ Support/TeacherDesk/widget-snapshot.json
```
