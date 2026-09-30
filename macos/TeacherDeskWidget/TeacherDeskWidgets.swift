//
//  TeacherDeskWidgets.swift —— 两个 Widget 的定义与时间线（v3.7.0）
//
//  ## 时间线怎么定
//
//  规格 §二十：不需要秒级实时，但**课程表改完最终要反映到小组件**。两条一起用：
//
//   1. **定期重读文件**：每次刷新时重新读那份 JSON（15 分钟一次）。
//      为什么不做「文件监听」：Widget 扩展不是常驻进程，系统只在给它的刷新窗口里唤起它，
//      监听文件系统没有意义（进程都不在）。
//   2. **宿主 App 立刻重画**：网页「同步并刷新」会跳 `teacherdesk://refresh`，
//      宿主 App 收到就 `WidgetCenter.reloadAllTimelines()` —— 这一条是即时的。
//
//  另外一条时间是**跨零点**：今日课程必须在 00:00 之后变成新的一天（不是等 15 分钟），
//  所以下一次刷新取「15 分钟后」与「今天 00:01」里更早的那个。
//
//  ## 数据从哪来
//
//  只从 `SnapshotStore.read()` 读本地文件——**不联网、不登录、不碰 CloudBase**（规格 §七 / §二十二）。
//  扩展开了沙盒且**没有任何网络 entitlement**，所以「不联网」这一条是系统强制的，不是纪律。
//

import SwiftUI
import WidgetKit

/// 只读本地快照的时间线提供者
struct SnapshotTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry {
        // 红/绿占位阶段也要有内容：用样例（形状与真实快照完全一致）
        SnapshotEntry(date: Date(), read: SnapshotStore.decode(data: Data(SnapshotSample.json.utf8)))
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        if context.isPreview {
            completion(SnapshotEntry(date: Date(), read: SnapshotStore.decode(data: Data(SnapshotSample.json.utf8))))
            return
        }
        completion(SnapshotEntry(date: Date(), read: SnapshotStore.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        let now = Date()
        let entry = SnapshotEntry(date: now, read: SnapshotStore.read())
        completion(Timeline(entries: [entry], policy: .after(SnapshotTimelineProvider.nextRefresh(after: now))))
    }

    /// 下一次刷新：15 分钟后，或跨零点后的第 1 分钟——取更早的那个
    static func nextRefresh(after date: Date, calendar: Calendar = .current) -> Date {
        let quarter = date.addingTimeInterval(15 * 60)
        guard let nextDay = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: date))
        else { return quarter }
        let justAfterMidnight = nextDay.addingTimeInterval(60)
        return min(quarter, justAfterMidnight)
    }
}

/* ================== Widget ① 今日课程 ================== */

struct TodayScheduleWidget: Widget {
    /// kind 一旦发布就不能改（系统的持久化身份靠它）
    static let kind = "TeacherDeskTodaySchedule"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: SnapshotTimelineProvider()) { entry in
            TodayWidgetContent(entry: entry)
                .containerBackground(for: .widget) { WidgetBackground() }
        }
        .configurationDisplayName("今日课程")
        .description("今天要上的课，按课程节次排列。数据来自 TeacherDesk 课程表，只读。")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

/* ================== Widget ② 一周课程表 ================== */

struct WeekScheduleWidget: Widget {
    static let kind = "TeacherDeskWeekSchedule"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: SnapshotTimelineProvider()) { entry in
            WeekWidgetContent(entry: entry)
                .containerBackground(for: .widget) { WidgetBackground() }
        }
        .configurationDisplayName("一周课程表")
        .description("一周的完整课表（星期 × 节次）。今天那一列会高亮。数据来自 TeacherDesk 课程表，只读。")
        .supportedFamilies([.systemLarge])
    }
}

/* ---------- 把系统给的尺寸读出来，显式交给内容 View（v3.7.2） ---------- */

/// 今日课程：`@Environment(\.widgetFamily)` 只能在 View 里读，所以用这个两行的包装。
/// 内容 View 本身不读环境 —— 宿主 App 的预览页要能指定尺寸（规格 §六）。
private struct TodayWidgetContent: View {
    let entry: SnapshotEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        TodayScheduleView(entry: entry, family: family)
    }
}

private struct WeekWidgetContent: View {
    let entry: SnapshotEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        WeekScheduleView(entry: entry, family: family)
    }
}
