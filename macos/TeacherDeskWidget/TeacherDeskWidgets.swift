//
//  TeacherDeskWidgets.swift —— 三个 Widget 的定义与时间线
//
//  第一版**只有三个**（规格 §二）：今日课程、今日待办、班级概况。
//  每个都支持 Small / Medium / Large；Small 放不下就少显示几条，不把内容硬塞进去。
//
//  ## 刷新这件事（规格 §一：手动同步 + 打开系统时自动同步 + WidgetKit 自身机制）
//
//  分工是这样的，三者互不越界：
//
//    - **手动**：宿主 App 里那颗「立即同步」按钮 —— 拉云端、写快照、顺手让 Widget 重载；
//    - **打开系统时**：宿主 App 启动时自动拉一次（`TeacherDeskApp` 里做）；
//    - **WidgetKit 自身**：就是下面这条时间线策略 —— 每 30 分钟重取一次快照文件。
//      它取的是**本地文件**，不联网、不登录、不发请求，所以「刷新」永远不会因为断网而失败，
//      最多是文件里的内容旧一点（那正是底部「更新于 09:32」要如实说出来的事）。
//
//  **没有网络重试系统**，也没有后台定时任务：断网时 Widget 照常显示上次的快照，
//  这与 Web 侧 Offline First 的口径是同一条线。
//
//  为什么是 30 分钟：跨零点、跨天不能全靠「恰好有人在那一刻刷新」，
//  半小时一档意味着「今天」最多错半小时就能自己纠回来，而系统也不会因为刷新太频繁
//  把 Widget 的刷新额度掐掉（WidgetKit 对刷新频率有硬上限，写太密反而会被降级）。
//

import SwiftUI
import WidgetKit

/// 时间线上的一条：**快照的读取结果**（不是快照本身——「读不到」也是一种要如实显示的状态）
struct SnapshotEntry: TimelineEntry {
    let date: Date
    let state: SnapshotReadResult
}

struct SnapshotTimelineProvider: TimelineProvider {
    /// 占位符（还没拿到真实时间线时系统抢先渲染的那一帧）
    ///
    /// **必须显示示例数据而不是空态**：教师在把 Widget 加进通知中心的一瞬间看到的
    /// 若是「尚未同步数据」，那是一句吓人的假话（他明明已经同步过）。理由详见 `SnapshotSample`。
    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: Date(), state: .ok(.sample))
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        // 预览（Widget 库里的大号预览图）也走样例，其余走真实文件
        let state: SnapshotReadResult = context.isPreview ? .ok(.sample) : SnapshotStore.read()
        completion(SnapshotEntry(date: Date(), state: state))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        let now = Date()
        let entry = SnapshotEntry(date: now, state: SnapshotStore.read())
        completion(Timeline(entries: [entry], policy: .after(Self.nextRefresh(after: now))))
    }

    /// 下一次重取时间：下一个 30 分钟整点（09:05 → 09:30，09:31 → 10:00）
    static func nextRefresh(after date: Date, calendar: Calendar = .current) -> Date {
        let parts = calendar.dateComponents([.minute], from: date)
        let minute = parts.minute ?? 0
        let step = 30
        let remaining = step - (minute % step)
        return calendar.date(byAdding: .minute, value: remaining, to: date) ?? date.addingTimeInterval(1800)
    }
}

// MARK: - 三个 Widget

/// 今日课程
struct LessonWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TeacherDeskLessonWidget", provider: SnapshotTimelineProvider()) { entry in
            LessonWidgetView(state: entry.state, now: entry.date)
        }
        .configurationDisplayName("今日课程")
        .description("今天第几节上什么课，一眼看到。")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

/// 今日待办
struct TodoWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TeacherDeskTodoWidget", provider: SnapshotTimelineProvider()) { entry in
            TodoWidgetView(state: entry.state, now: entry.date)
        }
        .configurationDisplayName("今日待办")
        .description("还剩哪几件事没做。")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

/// 班级概况
struct ClassWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TeacherDeskClassWidget", provider: SnapshotTimelineProvider()) { entry in
            ClassWidgetView(state: entry.state, now: entry.date)
        }
        .configurationDisplayName("班级概况")
        .description("在读人数与当前座位方案。")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
