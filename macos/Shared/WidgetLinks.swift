//
//  WidgetLinks.swift —— 点击 Widget 打开哪里
//
//  规格 §十八 / §十九：两个 Widget 都是只读，点击只有一个去处——**打开 TeacherDesk**。
//  本版按「成本最低且稳定」排了三级：
//
//  ① 快照里带了 `pwaBaseUrl` → 直接拼目标页（`<base>/work/schedule/`），
//     点开就是教师装成 PWA 的那个应用（浏览器对已安装 PWA 的这个地址会开应用窗口）。
//     **注意路由是 history 模式**（`/work/schedule/`），不是 v1.0.0 那版的 `#/schedule`——
//     写成 `#/schedule` 会落到首页或 404（`src/router/routes.ts` 与 `scripts/hosting-routes.cjs`）。
//  ② 没带地址（旧快照 / 手写的样例）→ 打开宿主 App 自己（`teacherdesk://open`），
//     由它在面板上给出「打开 TeacherDesk」按钮与地址说明。
//  ③ 连宿主 App 都没有（理论上不会：Widget 就装在它里面）→ 打开宿主 App 的主页地址常量。
//
//  为什么不直接把地址写死在这里：换域名、或教师用本机 `npm run dev` 的地址同步快照时，
//  Widget 源码不该跟着改。地址属于**数据**，所以它随快照走。
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
    /// 为某个去处算出可点的 URL；**永远返回一个能用的 URL**，免得调用方判空
    static func url(for destination: WidgetDestination, in snapshot: WidgetSnapshot?) -> URL {
        if let base = snapshot?.pwaBaseUrl, let url = compose(base: base, path: destination.webPath) {
            return url
        }
        return destination.hostURL
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
