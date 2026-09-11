//
//  SnapshotModel.swift —— Widget 专用只读快照的契约（Phase 12.2）
//
//  **这份快照是 Web/PWA 与 Widget 之间唯一的数据接口。** Widget 不连 CloudBase、
//  不认识 CloudBase 的文档结构、也不认识 Web 的存储键名——它只认识这个文件里的类型。
//
//  三条设计纪律（与 Phase 12 规格一致）：
//
//  1. **只放展示需要的字段**。云上的文档里有什么、这里只取用得上的那几样；
//     快照不是备份，不做全量搬运，也不许顺手多加字段「以后可能有用」。
//  2. **不复制业务规则**。读数、派生一律以 Web 为准：这份快照里出现的一切，
//     要么是云端原文，要么是 `SnapshotDerive` 里那几条**逐行注明 Web 出处**的展示级
//     换算（当天课程筛选、在读判定、当前方案选取）。真正的业务算法（值日轮换、
//     留校统计、请假时间线…）**一律不搬**——那些留在 Web 里，Widget 不显示它们。
//  3. **时间一律用毫秒时间戳**（与 Web 的 `updatedAt` 同口径），不用 ISO 字符串：
//     快照要能直接和云端文档里的数字对照，出了分歧一眼看得出。
//

import Foundation

/// 快照格式版本。日后改结构时**只增不改**：Widget 遇到比自己认识的新版本会退成空态，
/// 而不是把不认识的字段当默认值渲染出一屏假数据。
let snapshotSchemaVersion = 1

/// 一天的课（对应 Web 的 `types/timetable.ts` 的 `Lesson`，只留展示用得上的字段）。
///
/// 刻意**不带 `teacher` / `classId`**：Widget 的今日课程只显示「第N节 / 科目 / 班级 / 地点」，
/// 与工作台「今日课程」卡片一字不差（`views/Home/components/DashboardLessonCard.vue`）。
struct SnapshotLesson: Codable, Hashable, Identifiable {
    var id: String
    /// 1 = 周一 … 7 = 周日（与 Web 的 `Weekday` 完全一致，转换见 `SnapshotDerive.weekday(of:)`）
    var weekday: Int
    /// 节次，从 1 起（Web 的 `LESSON_PERIODS` 是 1…8）
    var period: Int
    var subject: String
    /// 上课班级名，如「高一9班」
    var className: String
    /// 上课地点，如「A 栋 302」（可缺）
    var location: String?
    /// 临时代课（Web 里为 true 时卡片显示「代课」标签）
    var isTemporary: Bool?

    enum CodingKeys: String, CodingKey {
        case id, weekday, period, subject, className, location, isTemporary
    }
}

/// 一条今日待办（对应 Web 的 `types/dashboard.ts` 的 `Todo`，字段一一对应）。
struct SnapshotTodo: Codable, Hashable, Identifiable {
    var id: String
    var text: String
    var done: Bool
}

/// 学生人数（**只搬两个数**，不搬学生列表）。
///
/// Widget 的班级概况只显示「在读 N 人」与「另有 M 位已退档」，所以快照里只留这两个计数。
/// 姓名、学号、家庭地址这些一个都不进快照——Widget 不显示它们，多搬一份就多一份泄漏面。
struct SnapshotStudentCounts: Codable, Hashable {
    /// 在读人数（Web 口径：档案里 `deletedAt` 为空的学生）
    var active: Int
    /// 已退档人数（Web 里不进在读人数，界面上也不再出现，只用小字说明）
    var removed: Int
}

/// 当前座位方案（只留名字与时刻；座位明细不进快照）。
struct SnapshotSeatPlan: Codable, Hashable {
    var name: String
    /// 方案最近一次内容更新时间（毫秒时间戳，来自 Web 的 `SeatPlan.updatedAt`）
    var updatedAtMillis: Int64
}

/// 一份快照。**这就是 Widget 能看到的全部世界。**
struct WidgetSnapshot: Codable, Hashable {
    var schemaVersion: Int
    /// 快照生成时刻（宿主 App 写完这份文件的时刻，毫秒时间戳）
    var generatedAtMillis: Int64
    /// 云端数据本身的时刻：四份文档 `updatedAt` 的最大值（毫秒时间戳）。
    /// Widget 上的「更新于 09:32」显示的就是它——**不是**快照生成时刻，
    /// 否则离线一周后打开仍会显示「刚刚更新」。
    var syncedAtMillis: Int64
    /// 班级名（Web 的 `DEFAULT_CLASSROOM_CONFIG.name`，当前是「高一9班」）
    var classroomName: String
    /// 全部课程（**不过滤星期**：快照是同步那一刻生成的，Widget 可能几天后才渲染，
    /// 当天是哪天要等渲染时才知道）
    var lessons: [SnapshotLesson]
    var todos: [SnapshotTodo]
    var students: SnapshotStudentCounts
    /// 当前使用中的座位方案；没有方案时为 nil
    var seatPlan: SnapshotSeatPlan?
    /// 点击 Widget 时打开的 Web/PWA 地址（由教师在宿主 App 里填一次；没填则点击打开宿主 App）
    var pwaBaseURL: String?

    var generatedAt: Date { Date(timeIntervalSince1970: Double(generatedAtMillis) / 1000) }
    var syncedAt: Date { Date(timeIntervalSince1970: Double(syncedAtMillis) / 1000) }
}

// MARK: - 解码：宽容读取，缺字段不整份作废

extension WidgetSnapshot {
    /// 从磁盘上的 JSON 原文解码。
    ///
    /// **宽容策略与 Web 的 `revive*` 同款**（Phase 9C §六）：认得出的留下、认不出的丢弃，
    /// 缺字段给安全空值，**不臆造业务默认值**。一份被外部改坏的快照应该退化成「少几条待办」，
    /// 而不是让三个 Widget 一起变成空白。
    ///
    /// 只有两种情况算**彻底读不动**（返回 nil，Widget 显示「数据读取失败」）：
    /// 不是 JSON、或不是对象。其余一律尽力而为。
    static func decode(from data: Data) -> WidgetSnapshot? {
        let decoder = JSONDecoder()
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { return nil }
        guard envelope.schemaVersion <= snapshotSchemaVersion else { return nil }

        return WidgetSnapshot(
            schemaVersion: envelope.schemaVersion,
            generatedAtMillis: envelope.generatedAtMillis ?? 0,
            syncedAtMillis: envelope.syncedAtMillis ?? envelope.generatedAtMillis ?? 0,
            classroomName: envelope.classroomName?.nonEmpty ?? "本班",
            lessons: (envelope.lessons ?? []).compactMap { $0.valid },
            todos: (envelope.todos ?? []).compactMap { $0.valid },
            students: SnapshotStudentCounts(
                active: max(0, envelope.students?.active ?? 0),
                removed: max(0, envelope.students?.removed ?? 0)
            ),
            seatPlan: envelope.seatPlan.flatMap { $0.valid },
            pwaBaseURL: envelope.pwaBaseURL?.nonEmpty
        )
    }

    /// 磁盘原文的中间形态：所有字段可选，坏数据在这里被逐个拦下
    private struct Envelope: Codable {
        var schemaVersion: Int
        var generatedAtMillis: Int64?
        var syncedAtMillis: Int64?
        var classroomName: String?
        var lessons: [LenientLesson]?
        var todos: [LenientTodo]?
        var students: LenientCounts?
        var seatPlan: LenientSeatPlan?
        var pwaBaseURL: String?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            // 版本号缺失时按 1 处理（第一版写出来的文件本来就没有更早的格式）
            schemaVersion = (try? c.decode(Int.self, forKey: .schemaVersion)) ?? 1
            generatedAtMillis = try? c.decode(Int64.self, forKey: .generatedAtMillis)
            syncedAtMillis = try? c.decode(Int64.self, forKey: .syncedAtMillis)
            classroomName = try? c.decode(String.self, forKey: .classroomName)
            lessons = try? c.decode([LenientLesson].self, forKey: .lessons)
            todos = try? c.decode([LenientTodo].self, forKey: .todos)
            students = try? c.decode(LenientCounts.self, forKey: .students)
            seatPlan = try? c.decode(LenientSeatPlan.self, forKey: .seatPlan)
            pwaBaseURL = try? c.decode(String.self, forKey: .pwaBaseURL)
        }

        private enum CodingKeys: String, CodingKey {
            case schemaVersion, generatedAtMillis, syncedAtMillis, classroomName
            case lessons, todos, students, seatPlan, pwaBaseURL
        }
    }

    private struct LenientLesson: Codable {
        var id: String?
        var weekday: Int?
        var period: Int?
        var subject: String?
        var className: String?
        var location: String?
        var isTemporary: Bool?

        /// 非法条目返回 nil 被丢弃（与 Web 的 `normalizeLesson` 同款判据：
        /// 星期必须在 1…7、节次必须 ≥ 1、科目与班级不能是空串）
        var valid: SnapshotLesson? {
            guard let weekday, (1...7).contains(weekday) else { return nil }
            guard let period, period >= 1 else { return nil }
            guard let subject = subject?.nonEmpty, let className = className?.nonEmpty else { return nil }
            return SnapshotLesson(
                id: id?.nonEmpty ?? "\(weekday)-\(period)-\(className)-\(subject)",
                weekday: weekday,
                period: period,
                subject: subject,
                className: className,
                location: location?.nonEmpty,
                isTemporary: isTemporary
            )
        }
    }

    private struct LenientTodo: Codable {
        var id: String?
        var text: String?
        var done: Bool?

        /// 文本为空即丢弃（Web 的 `normalizeTodo` 同样判据）；`done` 非 true 一律未完成
        var valid: SnapshotTodo? {
            guard let text = text?.nonEmpty else { return nil }
            return SnapshotTodo(id: id?.nonEmpty ?? text, text: text, done: done == true)
        }
    }

    private struct LenientCounts: Codable {
        var active: Int?
        var removed: Int?
    }

    private struct LenientSeatPlan: Codable {
        var name: String?
        var updatedAtMillis: Int64?

        var valid: SnapshotSeatPlan? {
            guard let name = name?.nonEmpty else { return nil }
            return SnapshotSeatPlan(name: name, updatedAtMillis: updatedAtMillis ?? 0)
        }
    }
}

extension String {
    /// 去掉首尾空白后为空即视同「没有」
    var nonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
