//
//  SnapshotDerive.swift —— 展示级换算（**全部细节都在这里，一个不藏在视图里**）
//
//  ⚠️ 这个文件是 Phase 12 里唯一一处「Swift 侧重新表达了一遍 Web 的口径」的地方。
//  它不是业务逻辑的实现，而是**展示换算**——但边界值得写清楚，免得日后被人顺手扩大：
//
//  **这里允许有的**：日期→星期几、按星期筛课程、按节次排序、数一数已完成几条、
//  时间格式化成 HH:mm。这些都是「把已有的数摆成某个样子」，改错了顶多显示得不对。
//
//  **这里绝对不许有的**：值日轮换、留校人数、请假时间线、座位约束求解、云端冲突判定。
//  那些是真正的业务算法，一旦在 Swift 里再写一遍，Web 与 Widget 就有了两套规则，
//  而且**没有任何东西保证它们一致**（Web 那边有 81 项常驻测试看着，这边没有）。
//  所以 Widget **不显示**这些内容——不是做不到，是不该做。
//
//  下面每一条换算都注明了 Web 侧的出处，改任何一条之前先去读那个文件。
//

import Foundation

enum SnapshotDerive {
    // MARK: - 星期（出处：src/utils/timetable.ts）

    /// 与 Web 的 `weekdayOf` 完全一致：**1 = 周一 … 7 = 周日**。
    ///
    /// 两边的原生口径不同，这是全部麻烦的来源：JS 的 `Date.getDay()` 是 0 = 周日，
    /// Swift 的 `Calendar.component(.weekday)` 是 1 = 周日。Web 那边把 0 折成 7，
    /// 这里把 1 折成 7、其余减一，**结果必须逐日相同**（`Tools/` 里有一条冒烟断言对着查）。
    static func weekday(of date: Date, calendar: Calendar = .current) -> Int {
        let native = calendar.component(.weekday, from: date) // 1 = 周日 … 7 = 周六
        return native == 1 ? 7 : native - 1
    }

    /// 星期文案（出处：`src/utils/timetable.ts` 的 `WEEKDAY_LABELS`）
    ///
    /// 文案**只此一份**：Web 侧当年特意不走 `Intl`，就是为了避免「同一天两种星期写法」，
    /// 这边同理——不用 `DateFormatter` 的星期格式，直接抄表。
    static func weekdayLabel(_ weekday: Int) -> String {
        switch weekday {
        case 1: return "星期一"
        case 2: return "星期二"
        case 3: return "星期三"
        case 4: return "星期四"
        case 5: return "星期五"
        case 6: return "星期六"
        case 7: return "星期日"
        default: return "—"
        }
    }

    /// 星期短标签（出处：`WEEKDAY_SHORT_LABELS`）
    static func weekdayShortLabel(_ weekday: Int) -> String {
        switch weekday {
        case 1: return "周一"
        case 2: return "周二"
        case 3: return "周三"
        case 4: return "周四"
        case 5: return "周五"
        case 6: return "周六"
        case 7: return "周日"
        default: return "—"
        }
    }

    static func isWeekend(_ weekday: Int) -> Bool { weekday >= 6 }

    // MARK: - 课程（出处：src/utils/timetable.ts 的 sortLessons / stores/timetable.ts 的 lessonsOf）

    /// 某一天的课，已按节次升序。
    ///
    /// 排序规则抄 Web 的 `sortLessons`：**先节次，同节次按科目名**——第二条不是装饰，
    /// 它保证渲染顺序稳定（同一节次两门课时不会每次刷新换个顺序）。
    static func lessons(on weekday: Int, from lessons: [SnapshotLesson]) -> [SnapshotLesson] {
        lessons
            .filter { $0.weekday == weekday }
            .sorted { a, b in
                if a.period != b.period { return a.period < b.period }
                return a.subject < b.subject
            }
    }

    /// 今天的课（`now` 默认取当前时刻，测试与预览时传入固定时间）
    static func todayLessons(from snapshot: WidgetSnapshot, now: Date = Date(),
                            calendar: Calendar = .current) -> [SnapshotLesson] {
        lessons(on: weekday(of: now, calendar: calendar), from: snapshot.lessons)
    }

    // MARK: - 待办（出处：src/views/Home/components/DashboardTodoCard.vue）

    /// 「已完成 X / Y」里的两个数。
    ///
    /// 注意 `allDone` 的前提是 `total > 0`（Web 侧同一个写法）：空列表不算「全部完成」，
    /// 否则「今天还没有待办」会被渲染成一片绿色对勾。
    static func todoCounts(_ todos: [SnapshotTodo]) -> (done: Int, total: Int) {
        (done: todos.filter(\.done).count, total: todos.count)
    }

    static func allTodosDone(_ todos: [SnapshotTodo]) -> Bool {
        let counts = todoCounts(todos)
        return counts.total > 0 && counts.done == counts.total
    }

    // MARK: - 时间文案（出处：src/utils/date.ts 的 formatClock）

    /// 「09:32」——24 小时制，两位补零。
    ///
    /// 与 Web 的 `formatClock` 一致（那边用 `Intl` 的 `hourCycle: 'h23'`，同样是两位补零的
    /// 24 小时制）。**不用 `DateFormatter` 的本地化格式**：它会跟着系统地区变，
    /// 而「更新于 09:32」这个数字是给教师对时间的，不是给他读语言的。
    static func clockLabel(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        let hour = parts.hour ?? 0
        let minute = parts.minute ?? 0
        return String(format: "%02d:%02d", hour, minute)
    }
}
