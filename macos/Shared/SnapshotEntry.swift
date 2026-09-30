//
//  SnapshotEntry.swift —— Widget 的时间线条目（v3.7.2 起住在 Shared/）
//
//  为什么单独一个文件：它要满足 WidgetKit 的 `TimelineEntry`，于是文件里得 `import WidgetKit`。
//  而 `Tools/verify.sh` 的**快照冒烟**那一档刻意只用 Foundation 编译数据层
//  （模型 / 派生 / 链接 / 样例一致），不该被 WidgetKit 拖进来——分开文件，两边各取所需。
//
//  Widget 的时间线用它，宿主 App 的**预览页**也用它：预览要复用同一套 View，
//  而 View 的入参就是它（规格 §六）。
//

import Foundation
import WidgetKit

/// 一个时间线条目：读到的快照（或它的四种缺失状态）+ 这一帧的日期
///
/// v3.7.2 起住在 `Shared/`：Widget 的时间线用它，宿主 App 的**预览页**也用它
/// （规格 §六：预览必须复用同一套 View，而 View 的入参就是它）。
struct SnapshotEntry: TimelineEntry {
    let date: Date
    let read: SnapshotRead

    /// 快照（四态里只有 ok 有内容）
    var snapshot: WidgetSnapshot? {
        if case let .ok(snapshot) = read { return snapshot }
        return nil
    }
}
