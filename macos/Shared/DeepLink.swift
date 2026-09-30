//
//  DeepLink.swift —— `teacherdesk://` 深链的解析（v3.7.2）
//
//  为什么单独抽出来：它是**纯函数**（不碰 WidgetKit、不碰 AppKit），
//  放在 Shared 里，`Tools/verify.sh` 的快照冒烟就能把解析规则一条条钉住；
//  真正「让小组件重画」那半（`WidgetCenter`）留在宿主 App 里。
//
//  两个去处（规格 §四 / §二十一）：
//    · `teacherdesk://open`    —— Widget 被点击：由宿主 App 打开/激活 TeacherDesk PWA
//    · `teacherdesk://refresh` —— 网页上的「同步并刷新」：只让小组件重画，不动数据
//

import Foundation

enum TeacherDeskDeepLink {
    /// 打开 TeacherDesk（PWA）
    case open
    /// 只让小组件重画
    case refresh
    /// 其它 scheme / 未知 host —— 调用方按「打开」处理（点一下总得有点反应）
    case unknown

    static func parse(_ url: URL) -> TeacherDeskDeepLink {
        guard url.scheme == "teacherdesk" else { return .unknown }
        switch url.host ?? url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) {
        case "refresh": return .refresh
        case "open", "": return .open
        default: return .unknown
        }
    }
}
