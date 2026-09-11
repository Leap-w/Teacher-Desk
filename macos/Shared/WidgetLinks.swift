//
//  WidgetLinks.swift —— 点击 Widget 打开哪里
//
//  规格（Phase 12 §三）只允许一件事：**点开对应的页面**。Widget 内部不许有任何写入操作。
//  所以这里算出来的 URL 全部是指向 Web/PWA 的普通链接，点开就是 Safari 打开那一页，
//  Widget **不**试图在本地打开什么、也不试图把数据写回去。
//
//  两个去处：
//  1. 教师在宿主 App 里填了 Web 地址 → 直接开那一页（`<地址>/#/students` 这样拼）；
//  2. 没填 → 退回打开宿主 App 自己（`teacherdesk://open`），由它提示去填地址。
//
//  ⚠️ 路由前缀是 `#/`：这个应用是**哈希路由**的单页应用，地址栏里的那一段必须带 `#`，
//  写成 `/students` 会落到服务器的 404 上（本地 dev 时尤其明显）。
//

import Foundation

/// 三个 Widget 各自要打开的目标页
enum WidgetDestination {
    /// 今日课程 → 课表中心
    case schedule
    /// 今日待办 → 工作台
    case dashboard
    /// 班级概况 → 学生档案
    case students

    /// Web/PWA 里对应的哈希路由（出处：`src/router/index.ts`）
    var webPath: String {
        switch self {
        case .schedule: return "#/schedule"
        case .dashboard: return "#/"
        case .students: return "#/students"
        }
    }

    /// 宿主 App 的兜底深链（没配 Web 地址时用）
    var hostFallbackURL: URL? {
        URL(string: "teacherdesk://open")
    }
}

enum WidgetLinks {
    /// 为某个目标算出可点的 URL；**永远返回一个能用的 URL**（兜底打开宿主 App），
    /// 免得调用方到处判空、或者不小心让整块 Widget 变成不可点。
    static func url(for destination: WidgetDestination, in snapshot: WidgetSnapshot?) -> URL {
        if let base = snapshot?.pwaBaseURL, let url = compose(base: base, path: destination.webPath) {
            return url
        }
        return destination.hostFallbackURL ?? URL(string: "teacherdesk://open")!
    }

    /// 把基址与哈希路由拼起来。
    ///
    /// 手写拼接而不用 `URL(string:relativeTo:)`：相对 URL 的解析会把 `#/students` 里的
    /// 片段吃掉一半（`#` 之后的部分一律按 fragment 处理），拼出来的东西看着对、点开却是首页。
    /// 这里只做一件最笨也最准的事——把基址尾部的 `/` 去掉，再接上路径。
    private static func compose(base: String, path: String) -> URL? {
        guard let trimmed = base.nonEmpty else { return nil }
        var text = trimmed
        while text.hasSuffix("/") { text.removeLast() }
        guard text.hasPrefix("http://") || text.hasPrefix("https://") else { return nil }
        return URL(string: text + "/" + path)
    }
}
