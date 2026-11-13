//
//  DeepLink.swift —— `teacherdesk://` 深链的解析（v3.7.2；v3.7.8 增 verify）
//
//  为什么单独抽出来：它是**纯函数**（不碰 WidgetKit、不碰 AppKit），
//  放在 Shared 里，`Tools/verify.sh` 的快照冒烟就能把解析规则一条条钉住；
//  真正「让小组件重画」那半（`WidgetCenter`）留在宿主 App 里。
//
//  三个去处（规格 §四 / §二十一；v3.7.8 P1 增第三条）：
//    · `teacherdesk://open`    —— Widget 被点击：由宿主 App 打开/激活 TeacherDesk PWA
//    · `teacherdesk://refresh` —— 网页上的「同步并刷新」：只让小组件重画，不动数据
//    · `teacherdesk://verify?nonce=<nonce>` —— 网页发起的**目录身份验证**：
//      宿主只在自己的 Widget 容器里核对，结果写进同一目录的响应文件（见 `ContainerVerifier`）。
//
//  ## 为什么 nonce 的「格式」不在这里判
//
//  这里只负责**取出来**（0 个或多个 `nonce` 参数一律当作没给），
//  合法性（长度 / 字符集）交给 `ContainerVerifier.isValidNonce`。
//  分开的好处：解析规则能被冒烟测试钉死，而「什么算合法 nonce」只在一处定义。
//

import Foundation

enum TeacherDeskDeepLink: Equatable {
    /// 打开 TeacherDesk（PWA）
    case open
    /// 只让小组件重画
    case refresh
    /// 目录身份验证请求；`nonce` 为 nil 表示**没给 / 给了多个 / 空值**（由验证器判为非法）
    case verify(nonce: String?)
    /// 其它 scheme / 未知 host —— 调用方按「打开」处理（点一下总得有点反应）
    case unknown

    static func parse(_ url: URL) -> TeacherDeskDeepLink {
        guard url.scheme == "teacherdesk" else { return .unknown }
        switch url.host ?? url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) {
        case "refresh": return .refresh
        case "verify": return .verify(nonce: queryNonce(in: url))
        case "open", "": return .open
        default: return .unknown
        }
    }

    /// 取 query 里的 `nonce`：**恰好一个非空值**才算数。
    ///
    /// 0 个（没给）、多个（重复参数，可能被拼成「取第一个」而误判）、空字符串 → 一律 nil。
    /// 不做百分号解码之外的任何加工：`URLComponents.queryItems` 已经解过码。
    static func queryNonce(in url: URL) -> String? {
        guard
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let items = components.queryItems
        else { return nil }
        let matches = items.filter { $0.name == "nonce" }
        guard matches.count == 1, let value = matches[0].value, !value.isEmpty else { return nil }
        return value
    }
}
