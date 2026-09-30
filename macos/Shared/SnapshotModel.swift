//
//  SnapshotModel.swift —— 快照契约（v3.7.0）
//
//  这份结构**必须**与 Web 侧 `src/types/widget.ts` 逐字段对齐，它是两端唯一的接口。
//  改这里就要改那边（以及 `WIDGET_SNAPSHOT_SCHEMA_VERSION`），否则表现是「Widget 显示不出来」
//  或「渲染出一张看着正常、其实是错位的课表」——后者更危险。
//
//  为什么全部字段都是 `let` + Optional：Widget 只读，不存在「改一半」的状态；
//  而快照是**另一个进程写的文件**，任何字段都可能因为版本错位而缺席——缺字段时宁可显示
//  「读不出来」，也不要靠默认值编一份课表出来（见 SnapshotStore 的四种读结果）。
//

import Foundation

/// 当前 Widget 认识的快照格式版本（与 Web 侧 `WIDGET_SNAPSHOT_SCHEMA_VERSION` 同值）
let widgetSnapshotSchemaVersion = 1

/// 一条时段（Web 侧 `WidgetSnapshotPeriod`）
struct SnapshotPeriod: Decodable, Identifiable, Hashable {
    let id: String
    let label: String
    let shortLabel: String
    let startTime: String
    let endTime: String
    let order: Int
    let group: String
}

/// 一节课（Web 侧 `WidgetSnapshotLesson`）——只有时段与科目，Widget 本版只画这两样
struct SnapshotLesson: Decodable, Hashable {
    let periodId: String
    let subject: String
}

/// 一天（Web 侧 `WidgetSnapshotDay`）
struct SnapshotDay: Decodable, Hashable {
    let weekday: Int
    let label: String
    let shortLabel: String
    let lessons: [SnapshotLesson]
}

/// 整份快照（Web 侧 `WidgetSnapshot`）
struct WidgetSnapshot: Decodable, Hashable {
    let schemaVersion: Int
    let generator: String?
    let updatedAt: String?
    let updatedAtLabel: String?
    let pwaBaseUrl: String?
    let className: String?
    let periods: [SnapshotPeriod]
    let week: [SnapshotDay]

    /// 时段表按顺序排好（快照里已经是升序，这里再兜一次：手改过的文件不该让 Widget 乱序）
    var orderedPeriods: [SnapshotPeriod] {
        periods.sorted { $0.order < $1.order }
    }

    /// 找某一天（找不到给 nil，调用方按「今天没有安排」处理）
    func day(_ weekday: Int) -> SnapshotDay? {
        week.first { $0.weekday == weekday }
    }
}

/// 只读 `schemaVersion` 的探针：格式版本比本 Widget 新时**不猜着读**，直接说「请更新」
struct SnapshotVersionProbe: Decodable {
    let schemaVersion: Int
}
