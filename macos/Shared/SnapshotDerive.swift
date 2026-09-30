//
//  SnapshotDerive.swift —— 展示级派生（纯函数）
//
//  Widget 里所有「今天是哪一列 / 今天有哪些课 / 显示哪几天」的判断都从这里出，
//  不在 View 里各写一遍。三条口径：
//
//  ① **今天由 Widget 自己算**（用系统日期），不是快照里的字段。快照是事实层，
//     可能写于几小时前；把「今天」烘进去会出现「早上显示昨天的课」。
//  ② **星期换算与 Web 侧一致**：1 = 周一 … 7 = 周日（`utils/timetable.ts` 的 `Weekday`），
//     不是 `Calendar` 的 1 = 周日。差一位的后果是整张周课表错列——最容易犯且最难看出。
//  ③ **周视图列**：周一~周五恒定显示，周六/周日**有课才追加**。工作日恒定是因为它是课表的主体；
//     周末按需是因为 Large 也只有那么大，两个空列会白白吃掉一半宽度。
//

import Foundation

enum SnapshotDerive {
    /// 某天的星期序号：1 = 周一 … 7 = 周日（**与 Web 侧 `Weekday` 同口径**）
    static func weekday(of date: Date, calendar: Calendar = .current) -> Int {
        // Calendar 的 weekday 是 1 = 周日 … 7 = 周六，这里换算成「周一 = 1」
        let raw = calendar.component(.weekday, from: date)
        return ((raw + 5) % 7) + 1
    }

    /// 「周二 · 9月30日」（今日课程 Widget 的副标题）
    static func dateLine(of date: Date, calendar: Calendar = .current) -> String {
        let weekdayIndex = weekday(of: date, calendar: calendar)
        let short = SnapshotDerive.weekdayShortName(weekdayIndex)
        let month = calendar.component(.month, from: date)
        let day = calendar.component(.day, from: date)
        return "\(short) · \(month)月\(day)日"
    }

    /// 星期的中文短名。**与快照里的 `shortLabel` 分开**：这里的「今天」可能落在快照没覆盖的日子上
    /// （比如周日在快照里没有课、但日期行仍要正确显示「周日」）
    static func weekdayShortName(_ weekday: Int) -> String {
        switch weekday {
        case 1: return "周一"
        case 2: return "周二"
        case 3: return "周三"
        case 4: return "周四"
        case 5: return "周五"
        case 6: return "周六"
        default: return "周日"
        }
    }

    /// 某天的课（时段顺序由快照的 `periods[].order` 决定，不依赖数组原序）
    static func lessons(
        in snapshot: WidgetSnapshot,
        on date: Date,
        calendar: Calendar = .current
    ) -> [(period: SnapshotPeriod, lesson: SnapshotLesson)] {
        let weekdayIndex = weekday(of: date, calendar: calendar)
        guard let day = snapshot.day(weekdayIndex) else { return [] }
        return align(day: day, in: snapshot)
    }

    /// 把某天的课对齐到时段表上（只保留「有时段定义且真有课」的格子，顺序 = 课表顺序）
    static func align(
        day: SnapshotDay,
        in snapshot: WidgetSnapshot
    ) -> [(period: SnapshotPeriod, lesson: SnapshotLesson)] {
        let byPeriod = Dictionary(
            day.lessons.map { ($0.periodId, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        return snapshot.orderedPeriods.compactMap { period in
            guard let lesson = byPeriod[period.id] else { return nil }
            return (period, lesson)
        }
    }

    /// 周视图要显示的列：周一~周五恒定，周末有课才追加
    static func visibleDays(in snapshot: WidgetSnapshot) -> [SnapshotDay] {
        snapshot.week
            .filter { day in
                if day.weekday <= 5 { return true }
                return !day.lessons.isEmpty
            }
            .sorted { $0.weekday < $1.weekday }
    }

    /// 某一格上有什么课（周视图用；没有就是 nil → 画「—」）
    static func lesson(in day: SnapshotDay, periodID: String) -> SnapshotLesson? {
        day.lessons.first { $0.periodId == periodID }
    }

    /// 一节课**显示什么**（v3.7.1 的唯一显示口径）
    ///
    /// 规则只有一条：**先班级，再科目**。
    /// - 数学老师每节课的科目都是「数学」，逐行重复没有信息量，而「高一9班」才是要看的
    ///   —— 所以班级优先；
    /// - 快照是 v1（没有班级字段）时退回科目：老文件不会显示成空行；
    /// - 两个都没有（手改坏的快照）时给一个中性占位，绝不画空白格子。
    static func label(for lesson: SnapshotLesson) -> String {
        let className = lesson.className?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let subject = lesson.subject?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !className.isEmpty { return className }
        if !subject.isEmpty { return subject }
        return "—"
    }

    /// 整周课时数（空态与诊断用）
    static func lessonCount(in snapshot: WidgetSnapshot) -> Int {
        snapshot.week.reduce(0) { $0 + $1.lessons.count }
    }
}
