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

    /// 「9月30日」——**不带星期**的那一版（v3.7.3）
    ///
    /// 给 small 用：170pt 宽减去版心只剩 146pt，「今日课程」四个字就吃掉 60pt，
    /// 完整日期（「周四 · 10月1日」）不一定放得下。规格 §十五 明确：放不下时
    /// **优先退到「10月1日」**，而不是让它变成「周四 · 1...」。
    /// 调用方（`TodayScheduleView`）用 `ViewThatFits` 先试完整的，放不下才用这一版。
    static func shortDateLine(of date: Date, calendar: Calendar = .current) -> String {
        let month = calendar.component(.month, from: date)
        let day = calendar.component(.day, from: date)
        return "\(month)月\(day)日"
    }

    /// 快照的**同步时刻**「01:21」（v3.7.3）
    ///
    /// 一周课程表右上角只写「01:21 同步」——规格 §六：不要再出现
    /// 「同步于 10月1日 01:21」这种长句，它是三级信息，不该跟标题抢焦点。
    ///
    /// 两个来源，按可靠性排序：
    ///   ① `updatedAtLabel` 里那一段 `HH:mm`（Web 侧已经按本地时区排好版了，直接切片）；
    ///   ② 退到 `updatedAt`（ISO8601，带 Z）→ 按 `calendar` 的时区换算成本地时刻。
    /// 都取不到就返回 nil —— 界面**宁可不显示**，也不要编一个时刻出来。
    static func syncClockLabel(
        _ snapshot: WidgetSnapshot,
        calendar: Calendar = .current
    ) -> String? {
        if let label = snapshot.updatedAtLabel,
           let range = label.range(of: #"\d{1,2}:\d{2}"#, options: .regularExpression) {
            return String(label[range])
        }
        guard let raw = snapshot.updatedAt, let date = parseISO8601(raw) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        // 时区跟着调用方给的日历走：自检里固定成 Asia/Shanghai，桌面上就是系统时区
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }

    /// ISO8601 → Date。**两种都要试**：Web 侧写出来的是带毫秒的（`…:00.000Z`），
    /// 而 `ISO8601DateFormatter` 默认那组选项**不认毫秒**——只试一种会静默返回 nil。
    static func parseISO8601(_ raw: String) -> Date? {
        let optionSets: [ISO8601DateFormatter.Options] = [
            [.withInternetDateTime, .withFractionalSeconds],
            [.withInternetDateTime],
        ]
        for options in optionSets {
            let parser = ISO8601DateFormatter()
            parser.formatOptions = options
            if let date = parser.date(from: raw) { return date }
        }
        return nil
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

    /* ---------- 当前 / 下一节（v3.7.2） ---------- */

    /// 一节课在「此刻」的处境。**不做倒计时、不显示时刻**（规格 §十三），
    /// 只回答「是不是正在上 / 是不是下一节」——那两件事才是教师扫一眼要的。
    enum Moment {
        /// 正在上（`start <= now < end`）
        case current
        /// 今天还没开始上的最靠前那一节
        case next
        /// 今天剩下的（既不是当前、也不是下一节）
        case later
        /// 已经上完
        case past
    }

    /// 今天这一整天此刻的处境
    struct DaySchedule {
        /// 每一节对应的处境，顺序与传入的 rows 一致
        let moments: [Moment]
        /// 今天有课、但全都上完了
        let isFinished: Bool

        /// 正在上的那一节的时段 id（没有就是 nil）
        func currentPeriodID(rows: [(period: SnapshotPeriod, lesson: SnapshotLesson)]) -> String? {
            for (index, moment) in moments.enumerated() where moment == .current {
                return rows[index].period.id
            }
            return nil
        }

        /// 下一节的时段 id（没有就是 nil）
        func nextPeriodID(rows: [(period: SnapshotPeriod, lesson: SnapshotLesson)]) -> String? {
            for (index, moment) in moments.enumerated() where moment == .next {
                return rows[index].period.id
            }
            return nil
        }
    }

    /// 判断某天此刻的处境。
    ///
    /// 三条口径（规格 §十八 的四种边界都在这里定死，`SnapshotSmoke` 逐条钉着）：
    /// - **正在上**：`start <= now < end`。下课那一分钟就立刻不再是「当前」——
    ///   否则两节课之间会同时出现「当前」和「下一节」两种说法。
    /// - **下一节**：所有 `start > now` 里最靠前的那一节，**与上一节是否刚下课无关**。
    ///   课间（10:00–10:30）显示的是「下一节：英语」，不是刚上完的数学。
    /// - **已结束**：今天有课、但每一节的 `end` 都早于此刻 → `isFinished = true`
    ///   （界面据此写一行「今日课程已结束」，不改变整体结构）。
    ///
    /// 时间一律**从快照的 `periods[].startTime/endTime` 解析**（规格 §十九：
    /// 不许在 Swift 里再硬编码 07:40 / 09:20 那一套）；解析不出来的时段按「不参与判定」处理，
    /// 绝不用一个猜出来的时间把某一节标成「当前」。
    static func daySchedule(
        rows: [(period: SnapshotPeriod, lesson: SnapshotLesson)],
        now: Date,
        calendar: Calendar = .current
    ) -> DaySchedule {
        let nowMinutes = calendar.component(.hour, from: now) * 60 + calendar.component(.minute, from: now)
        var moments: [Moment] = []
        var nextAssigned = false
        var anyRunningOrFuture = false

        // 先算出每节的起止分钟（解析不出来就是 nil）
        let ranges: [(start: Int, end: Int)?] = rows.map { row in
            guard let start = minutes(of: row.period.startTime),
                  let end = minutes(of: row.period.endTime),
                  start < end
            else { return nil }
            return (start, end)
        }

        for range in ranges {
            guard let range else {
                moments.append(.later)   // 时间坏掉的节：不参与判定，也不冒充「当前」
                continue
            }
            if range.start <= nowMinutes && nowMinutes < range.end {
                moments.append(.current)
                anyRunningOrFuture = true
            } else if range.start > nowMinutes {
                if !nextAssigned {
                    moments.append(.next)
                    nextAssigned = true
                } else {
                    moments.append(.later)
                }
                anyRunningOrFuture = true
            } else {
                moments.append(.past)
            }
        }

        return DaySchedule(
            moments: moments,
            // 「已结束」= 今天确实有课、但没有任何一节在跑或还没开始
            isFinished: !rows.isEmpty && !anyRunningOrFuture
        )
    }

    /// `"HH:mm"` → 当天第几分钟；形状不对返回 nil（快照是外部文件，必须防）
    static func minutes(of clock: String) -> Int? {
        let parts = clock.split(separator: ":")
        guard parts.count == 2,
              let hour = Int(parts[0]), let minute = Int(parts[1]),
              (0...23).contains(hour), (0...59).contains(minute)
        else { return nil }
        return hour * 60 + minute
    }
}
