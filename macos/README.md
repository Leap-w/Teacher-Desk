# TeacherDesk · macOS 课程表小组件（v3.7.3）

桌面上两个**只读**小部件：**今日课程**（small / medium）与**一周课程表**（large）。
数据来自 TeacherDesk 的课程表，点一下打开 TeacherDesk 网页版（PWA）。

> **Web/PWA 是唯一的业务系统，小组件只是它的只读窗口。**
> 这里一个字节的业务数据都改不了：不联网、不登录、不碰 CloudBase、不写课程表。

---

## 数据是怎么流动的

```
   CloudBase ──① 同步──▶ TeacherDesk 网页版（PWA）
                              │
                              │ ② 课程表 Store / Repository（唯一数据源）
                              ▼
                      Widget 快照 widget-snapshot.json
                              │  ③ File System Access API：一次授权，之后静默覆写
                              ▼
              ~/Library/Containers/com.teacherdesk.mac.widget/Data/
                Library/Application Support/TeacherDesk/
                              │
                              │ ④ 只读（沙盒扩展读自己的容器）
                              ▼
                    WidgetKit 扩展 ──⑤ 点击──▶ 宿主 App ──▶ 打开 TeacherDesk
```

四点值得说明：

1. **快照由 Web 侧生成**（`src/utils/widgetSnapshot.ts`，纯函数）。
   小组件**不自己算课表**：`COURSE_PERIODS`、星期名、节次名全部随快照带过去，
   Swift 侧不再拼一套「第2节」「星期一」——两处各拼一遍迟早不一致
   （规格 §十三：以项目实际数据结构为准，不要硬编码节次）。
2. **只有两个进程碰数据**：网页写、小组件读。宿主 App 也只会读，外加「写入样例 / 通知刷新」两个按钮。
3. **小组件那份源码里没有任何网络调用**，而且它的沙盒**没有联网 entitlement**——
   所以「不联网」是**系统强制**的，不是代码纪律（规格 §七 / §二十二）。
4. **快照里没有「今天」**。今天该看哪一列由小组件按自己的系统日期算——
   否则一份昨晚写的快照今早还会显示昨天的课。

## 为什么是「扩展容器」而不是 App Group

规格 §六 要求先看本机实际环境再选方案。2026-09-30 核对的结果：

| 事实                                                                                  | 后果                                                      |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 本机 `security find-identity` = **0 个签名身份**（只能 ad-hoc / Sign to Run Locally） | App Group 需要**真实 Team ID + 开发者账号**，这条路走不通 |
| macOS 的 Widget 扩展**不开沙盒就不会出现在小组件库里**（构建能过、库里没有）          | 扩展必须沙盒                                              |
| 沙盒扩展读**自己的容器**不需要任何 entitlement                                        | 于是「宿主不沙盒 + 写进扩展容器 + 扩展读自己的容器」成立  |

于是：**扩展沙盒 + 宿主不开沙盒 + 不用 App Group**，全程 ad-hoc 签名、零账号配置。
路径写在两处（同一份定义的两种语言）：`src/config/index.ts` 的 `appConfig.widget` 与
`Shared/SnapshotStore.swift`，`Tools/verify.sh` 会盯住工程文件那一侧。

**代价说清楚**：宿主 App 没有被系统隔离（它必须能写扩展的容器）。
它不联网、不登录、不碰业务数据，但这是代码纪律而非系统强制。
以后要系统级隔离（或要分发）时，按 `TeacherDeskWidget.entitlements` 注释里的三步换成 App Group。

## 目录

```
macos/
├── TeacherDesk.xcodeproj/          工程文件（手写，Xcode 16+ 的「同步文件夹」结构）
├── project.yml                     XcodeGen 退路（工程被改坏时用它重建）
├── Shared/                         两个 target 各编一份
│   ├── SnapshotModel.swift         快照契约（与 src/types/widget.ts 逐字段对齐）
│   ├── SnapshotStore.swift         快照路径与读写的**唯一**入口（四态读结果）
│   ├── SnapshotDerive.swift        展示级派生：今天是哪一列 / 今天有哪些课 / 当前与下一节 / 标题行文案
│   ├── WidgetLinks.swift           点击打开哪一页（深链 `teacherdesk://open`）
│   ├── DesignTokens.swift          松石青等设计变量（从 src/styles/theme.css 抄来）+ Widget 专用字级与版心
│   ├── SnapshotSample.swift        样例快照（与 Samples/snapshot.sample.json 逐字节相同）
│   └── Views/                      **Widget 与宿主预览共用的同一批 View**（v3.7.2 起，不存在第二套 UI）
│       ├── TodayScheduleView.swift    今日课程（small + medium）
│       ├── WeekScheduleView.swift     一周课程表（large）
│       └── WidgetChrome.swift         背景 / 版心 / 标题行 / 四态空壳
├── TeacherDesk/                    宿主 App（一屏面板：状态 / 路径 / 按钮 + 预览 + 诊断）
│   ├── TeacherDeskApp.swift        @main + `teacherdesk://` 深链 + 无界面调试开关
│   ├── HostView.swift              全部界面 + 面板状态模型
│   ├── WidgetPreview.swift         预览渲染与 PNG 导出（同一套 View）
│   ├── WidgetDiagnostics.swift     五段诊断文本
│   ├── Info.plist / *.entitlements 深链方案；**不开沙盒**
├── TeacherDeskWidget/              Widget 扩展（**沙盒**、无网络）
│   ├── TeacherDeskWidgetBundle.swift      @main：只挂两个 Widget
│   ├── TeacherDeskWidgets.swift           两个 Widget 定义 + 时间线（15 分钟 / 跨零点）
│   └── Info.plist / *.entitlements        widgetkit 扩展点；app-sandbox
├── Samples/snapshot.sample.json    样例快照（由 Web 侧真正的生成器产出）
└── Tools/
    ├── verify.sh                   八档自检（见下）
    ├── SnapshotSmoke/main.swift    快照数据层冒烟（纯 Foundation，命令行可跑）
    └── install-snapshot.sh         Safari 兜底：把下载的快照放进容器
```

## Widget 的视觉规则（v3.7.3 定稿）

桌面截图读起来像「网页卡片」的根因不是配色，而是**用背景块代替了排版**。所以这一版把规矩写死：

| 规则                                       | 为什么                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| **强调只给星期标题，不给整列**             | 今天那一列每一格都盖一层底，就是一条由 10 个圆角块串成的柱子；「今天」只需要一个落点       |
| **有课才有容器，`—` 永远没有背景**         | 空格子占了课表一多半；给它们加底，整张表就只剩「有没有底色」这一种层级                     |
| **层级靠字号 / 字重 / 灰度，不靠胶囊**     | 三级灰（主文字 / 次级 / 空课程）比三层底色安静得多，也更像 macOS 原生                      |
| **版心自己给（`contentMarginsDisabled`）** | 系统的默认边距量不到、也没法被预览复用；关掉它，`TDWidgetMetrics` 才是唯一出处，预览＝真机 |
| **右侧那句话宁可把标题挤瘦，也不出省略号** | Medium 的「周四 · 1...」就是这么来的；放不下就退到「10月1日」（规格 §十五）                |
| **不加渐变 / 图片 / 阴影 / 新配色**        | 小组件贴在教师自己的壁纸上，它该安静地待着，而不是抢桌面注意力                             |

**当前 / 下一节**是**三档**（不是三颗一样的胶囊）：当前 = 极淡主色行底 + 「当前」标签；
下一节 = 只挂更淡的「下一节」标签；普通 = 什么都没有。全天结束后两者都不显示，课程回到普通状态。
判定算法是纯函数 `SnapshotDerive.daySchedule(rows:now:)`，**本版一个字未改**。

## 跑起来

### 0. 自检（不需要图形界面）

```sh
sh macos/Tools/verify.sh
```

八档：工程文件一致性 → plist / entitlements 关键键 → **全部源文件类型检查** →
**快照冒烟 55 项** → `xcodebuild` 真编译 → 产物结构断言（appex 是否嵌进 App、扩展点、
深链、沙盒 entitlement、签名校验）→ **三种尺寸 × 深浅两色的预览 PNG 导出** →
**五段诊断信息**。

> 本机工作区里的文件带 Finder 信息时 `codesign` 会拒签（`resource fork … detritus`），
> 脚本会自动清一次 `xattr` 再增量重跑。这是本机文件系统的问题，不是工程的问题。

### 1. 构建 + 安装

```sh
cd macos
xcodebuild -project TeacherDesk.xcodeproj -scheme TeacherDesk -configuration Debug \
  -derivedDataPath .build/DerivedData build
cp -R .build/DerivedData/Build/Products/Debug/TeacherDesk.app /Applications/
open /Applications/TeacherDesk.app
```

或者直接双击 `TeacherDesk.xcodeproj`，在 Xcode 里 Run 一次（**必须把 App 放到
`/Applications` 并在那里跑起来**，WidgetKit 才会收录它的扩展——这是系统的规矩）。

### 2. 添加小组件

桌面空白处右键 →「编辑小组件」→ 搜 `TeacherDesk` → 添加：

- **今日课程**：支持 small（放不下时自动少显示几行并写「还有 N 节」）与 medium（当天全部课程）
- **一周课程表**：只支持 large（一周课表在 small 里没有可读性，规格 §十四）

此时小组件显示「还没有课程数据」是对的——快照还没写。两种办法看到内容：

- **看样例**：打开宿主 App →「写入样例快照」（50 节课的样例课表）。
- **接真数据**：打开 TeacherDesk 网页版 →「课程表」页底部的「macOS 桌面小组件」卡片 →
  「连接小组件」→ 在系统选择框里按 ⌘⇧G 粘贴宿主 App 里显示的那条路径 → 选中并允许写入。

### 3. 之后

- 改课程表（增删改 / 换课 / Excel 导入）→ 快照自动重写（防抖 1.5s）；
- 应用启动时也会对一次（规格 §二十一）；
- 小组件每 15 分钟重读一次文件，跨零点后自动切到新的一天；
- 想立刻看到变化：网页上点「同步并刷新」（会跳 `teacherdesk://refresh`，宿主 App 调
  `WidgetCenter.reloadAllTimelines()`），或在宿主 App 里点「刷新小组件」。

## 已知边界

- **`get-task-allow`**：Debug 构建的签名里带它（Xcode 自动加的调试 entitlement），
  Release 构建没有。自己用不影响。
- **没做签名 / 公证**：本机 ad-hoc（`-`）。换机器要重新构建（不改代码）。
- **Safari 兜底**：Safari 目前不支持 File System Access API，网页上的卡片会显示「下载快照」，
  下载后跑 `sh macos/Tools/install-snapshot.sh ~/Downloads/widget-snapshot.json`。
- **小组件刷新频率由系统决定**：15 分钟是「请求」，系统可能因电量/负载推迟——
  所以「同步并刷新」那颗按钮存在的意义就是需要立刻看到时用它。
- **本工程刻意不用 `@State`**：Xcode 27 里它是宏，展开要走 `swift-plugin-server`，
  在没有图形界面的构建环境（命令行 / CI / 沙盒）里会直接编译失败。
  宿主面板改用 ObservableObject（属性包装器），代价是几行样板代码。
  Widget 用的 `@Environment` 不受影响。
