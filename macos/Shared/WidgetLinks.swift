//
//  WidgetLinks.swift —— 点击 Widget 打开哪里
//
//  规格 §十八 / §十九：两个 Widget 都是只读，点击只有一个去处——**打开 TeacherDesk**；
//  v3.7.2 §二 / §三 / §四 把这件事定死为「必须进入 Chrome 装的那个 PWA，而不是宿主 App」。
//
//  ## 为什么不再直接把 https 地址交给 widgetURL（2026-10-01 本机实测）
//
//    `open "https://teacher-desk-….tcloudbaseapp.com/work/schedule/"` → 打开的是 **Safari**
//    （Chrome 的 PWA 应用壳并没有把自己注册成该网址的处理器），而不是教师装的那个 PWA；
//    而 v3.7.0 的兜底还会去打开「名字里带 TeacherDesk 的 App」——那恰好是**本宿主 App 自己**，
//    于是点完停在宿主界面上。两条路都不满足规格 §二。
//
//  ## 现在的唯一去处
//
//    `teacherdesk://open` → 宿主 App → `PWALocator` 扫出本机实际的 PWA → `NSWorkspace` 打开/激活它
//    （实测：PWA 已运行时 PID 不变、窗口到前台；未运行时冷启动后成为前台应用）。
//
//    所以这里**不再拼 https 地址**：`url(for:in:)` 对两个 Widget 都返回同一个深链，
//    快照里的 `pwaBaseUrl` 仍然有用——它被宿主 App 拿去做「哪个应用壳才是我要的那个」的匹配依据。
//
//  为什么保留 `compose(base:path:)`：它把「基址 + history 路由」拼对（尾斜杠那类坑）的能力
//  仍然要留给宿主 App 的最后一级退路（扫不到应用壳时按快照地址交给系统打开），
//  以及给 `Tools/SnapshotSmoke` 钉住拼接规则。
//

import Foundation

/// 两个 Widget 各自的去处（本版都落在课程表页；分开写是因为将来可能有别的落点）
enum WidgetDestination {
    /// 今日课程
    case today
    /// 一周课程表
    case week

    /// Web 侧对应的**静态路径**（history 路由，见 `src/router/routes.ts`）
    var webPath: String {
        switch self {
        case .today, .week: return "/work/schedule"
        }
    }

    /// 宿主 App 的兜底深链
    var hostURL: URL {
        URL(string: "teacherdesk://open")!
    }
}

enum WidgetLinks {
    /// Widget 的点击目标：**永远是宿主 App 的深链**（两条路都经它去开 PWA，见文件头注释）
    ///
    /// 参数保留 `snapshot` 是为了不改调用方签名、也给将来可能的其它落点留位置；
    /// 本版它与结果无关——两个 Widget 都只有一个点击目标（规格 §二十二：禁止多个点击目标）。
    static func url(for destination: WidgetDestination, in snapshot: WidgetSnapshot?) -> URL {
        _ = snapshot
        return destination.hostURL
    }

    /// 宿主 App 的最后一级退路用：把快照里的基址与 history 路由拼成可打开的网页地址
    static func browserFallbackURL(in snapshot: WidgetSnapshot?, path: String) -> URL? {
        guard let base = snapshot?.pwaBaseUrl else { return nil }
        return compose(base: base, path: path)
    }

    /// 拼接基址与路径。
    ///
    /// 手写拼接而不用 `URL(string:relativeTo:)`：后者会把 `/work/schedule` 当成相对路径去解析，
    /// 结果取决于基址有没有尾斜杠——那种「看着对、点开是首页」的错最难查。
    /// 这里只做一件最笨也最准的事：去掉基址尾部的 `/`，再接上以 `/` 开头的路径。
    static func compose(base: String, path: String) -> URL? {
        let trimmed = base.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        var text = trimmed
        while text.hasSuffix("/") { text.removeLast() }
        guard text.hasPrefix("http://") || text.hasPrefix("https://") else { return nil }
        return URL(string: text + path)
    }
}
