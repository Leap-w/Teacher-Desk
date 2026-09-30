//
//  TeacherDeskApp.swift —— 宿主 App（v3.7.0）
//
//  它的存在**只有一个理由**：WidgetKit 的扩展必须装在一个 App 里才会被系统收录
//  （`Contents/PlugIns/*.appex`），并且点击小组件时由它把教师送到 TeacherDesk。
//
//  因此它刻意是「一个窗口 + 几颗按钮」：
//    · 没有课表、没有档案、没有工作台、**一个业务页面都没有**（规格 §二十七）；
//    · 不登录、不联网、不碰 CloudBase——Web/PWA 仍然是唯一的业务系统与唯一的写入方；
//    · 它读写的唯一文件就是那份只读快照。
//
//  ## 为什么面板状态不放 `@State`
//
//  Xcode 27 起 SwiftUI 的 `@State` 是**宏**（`SwiftUIMacros.StateMacro`），展开要走
//  `swift-plugin-server`。GUI 里没问题，但在「只有命令行工具链」或沙盒化的构建环境里
//  那个服务起不来，表现是一句很难懂的 `produced malformed response` 直接编译失败。
//  这份工程要能在 `xcodebuild` 命令行下独立验证（见 `Tools/verify.sh`），所以面板状态
//  改用 **ObservableObject**（属性包装器，不走宏）+ 手动 `objectWillChange`，
//  代价是几行样板代码，换来的是「Xcode 与命令行都编得过」。
//  Widget 那边不受影响：它用的 `@Environment` 仍是属性包装器。
//
//  URL 方案 `teacherdesk://`：
//    · Widget 点击 → `teacherdesk://open`
//    · Web 侧「同步并刷新」→ `teacherdesk://refresh`（顺带把小组件立刻重画一遍）
//  两件事都不改任何业务数据。
//

import SwiftUI
import WidgetKit

@main
struct TeacherDeskApp: App {
    /// 面板模型（普通存储属性，不需要任何属性包装器）
    private let model = HostModel()

    var body: some Scene {
        Window("TeacherDesk 小组件", id: "main") {
            HostView(model: model)
                .frame(minWidth: 460, minHeight: 420)
        }
        .windowResizability(.contentSize)
        // 小组件是主体，这个窗口只是安装与诊断用的面板
        .defaultSize(width: 520, height: 560)
    }
}

/// 深链处理（Widget 与 Web 都会用到）
enum HostDeepLink {
    /// `teacherdesk://open` → 打开 TeacherDesk（PWA）
    case open
    /// `teacherdesk://refresh` → 只让小组件重画（不改数据、不开浏览器）
    case refresh
    /// 其它 / 解析不出 → 当作 open
    case unknown

    static func parse(_ url: URL) -> HostDeepLink {
        guard url.scheme == "teacherdesk" else { return .unknown }
        switch url.host ?? url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) {
        case "refresh": return .refresh
        case "open", "": return .open
        default: return .unknown
        }
    }

    /// 立刻让系统重画两个小组件的时间线（规格 §二十：「如果当前环境支持」——支持）
    static func reloadWidgets() {
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// 打开 TeacherDesk。
    ///
    /// 优先打开**装成 PWA 的那个应用**（macOS 14+ 的 Safari「添加到程序坞」会生成
    /// `~/Applications/<名字>.app`，Chrome 的「安装应用」也在那里生成快捷方式）；
    /// 找不到就交给系统用默认浏览器打开网址——两条路都进 TeacherDesk，只是窗口形态不同。
    /// 这是「点击 Widget 后能直接进入 TeacherDesk」最省事的实现，不需要给 PWA 注册 URL Scheme。
    static func openTeacherDesk() {
        let urlText = teacherDeskURL()
        for candidate in installedWebAppCandidates()
        where FileManager.default.fileExists(atPath: candidate.path) {
            let configuration = NSWorkspace.OpenConfiguration()
            NSWorkspace.shared.openApplication(at: candidate, configuration: configuration) { _, error in
                if error != nil, let url = URL(string: urlText) { NSWorkspace.shared.open(url) }
            }
            return
        }
        if let url = URL(string: urlText) { NSWorkspace.shared.open(url) }
    }

    /// 目标页：快照里带了地址就用它（换域名 / 本机 dev 都不用改这里），否则用线上地址兜底
    static func teacherDeskURL() -> String {
        var base = "https://teacher-desk-d6gdsgqb8f9dc13d2-1454430270.tcloudbaseapp.com"
        if case let .ok(snapshot) = SnapshotStore.read(),
           let fromSnapshot = snapshot.pwaBaseUrl,
           !fromSnapshot.isEmpty {
            base = fromSnapshot
        }
        while base.hasSuffix("/") { base.removeLast() }
        // 路由是 history 模式（`/work/schedule/`），见 src/router/routes.ts
        return base + "/work/schedule/"
    }

    /// 已安装的 Web App（Safari 的「添加到程序坞」/ Chrome 的「安装应用」都落在 ~/Applications）
    private static func installedWebAppCandidates() -> [URL] {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let names = ["TeacherDesk.app", "TeacherDesk 班主任工作台.app"]
        var result = names.map { home.appendingPathComponent("Applications/\($0)") }
        result.append(contentsOf: names.map { URL(fileURLWithPath: "/Applications/\($0)") })
        return result
    }
}
