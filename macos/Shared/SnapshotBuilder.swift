//
//  SnapshotBuilder.swift —— 云端文档 → 只读快照（纯函数，可单测）
//
//  这是宿主机侧唯一一处「把 Web 的数据读成展开的样子」的地方，规则共三条，
//  每条都注明 Web 出处，**不多写一行**：
//
//    1. 在读人数 = payload 里 `deletedAt` 空的学生数（出处 `src/stores/student.ts:48`）
//    2. 当前方案 = 第一个 `isCurrent == true` 的方案；**一个都没有时取第一条**
//       （出处 `src/stores/seat.ts:78-84` 的 `normalizePlans`：无 isCurrent 则首个补位）
//    3. 其余字段**原样搬运**，不排序、不过滤、不算派生值
//
//  ⚠️ 第 3 条是纪律不是省略：像「今天的课」这种依赖当天的筛选**故意不在这里做**——
//  快照是同步那一刻生成的，而它可能在三天后才被渲染出来（见 `SnapshotModel` 的注释）。
//  在这里按「今天」筛过的快照，隔天打开就会显示昨天该上的课。
//
//  之所以整个 Builder 是纯函数（输入文档、输出快照，不碰网络也不碰磁盘）：
//  `Tools/` 下的冒烟测试就是直接喂它几份 JSON 再断言结果的，不需要登录、不需要联网。
//

import Foundation

enum SnapshotBuilder {
    /// 组装一份快照。
    ///
    /// - Parameters:
    ///   - documents: 云端拉回来的文档（缺哪个键，快照里对应的部分就是空/零——**不报错**）
    ///   - classroomName: 班级名（Web 的 `DEFAULT_CLASSROOM_CONFIG.name`，当前是「高一9班」）
    ///   - pwaBaseURL: 教师在宿主 App 里填的 Web 地址（可空）
    ///   - now: 快照生成时刻（测试注入用）
    static func build(
        documents: [CloudDocument],
        classroomName: String,
        pwaBaseURL: String?,
        now: Date = Date()
    ) -> WidgetSnapshot {
        let byKey = Dictionary(documents.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })

        // 云端数据本身的时刻：四份文档里最新的那份（作为「更新于」的依据）
        let syncedAtMillis = documents.map(\.updatedAt).max() ?? 0

        return WidgetSnapshot(
            schemaVersion: snapshotSchemaVersion,
            generatedAtMillis: Int64(now.timeIntervalSince1970 * 1000),
            syncedAtMillis: syncedAtMillis,
            classroomName: classroomName.nonEmpty ?? "本班",
            lessons: decode([LessonWire].self, from: byKey[CloudKeys.timetable]).compactMap(\.snapshot),
            todos: decode([TodoWire].self, from: byKey[CloudKeys.todos]).compactMap(\.snapshot),
            students: studentCounts(from: byKey[CloudKeys.students]),
            seatPlan: currentPlan(from: byKey[CloudKeys.seatPlans]),
            pwaBaseURL: pwaBaseURL?.nonEmpty
        )
    }

    // MARK: - 学生：只数人数（规则 1）

    private static func studentCounts(from document: CloudDocument?) -> SnapshotStudentCounts {
        let rows = decode([StudentWire].self, from: document)
        // 在读 = `deletedAt` 为空（出处 student.ts:48）。其余一律算已退档。
        let active = rows.filter { $0.deletedAt?.nonEmpty == nil }.count
        return SnapshotStudentCounts(active: active, removed: rows.count - active)
    }

    // MARK: - 座位方案：取当前那一个（规则 2）

    private static func currentPlan(from document: CloudDocument?) -> SnapshotSeatPlan? {
        let rows = decode([SeatPlanWire].self, from: document)
            .filter { $0.name?.nonEmpty != nil }
        guard !rows.isEmpty else { return nil }
        // 先找标记了 isCurrent 的；一个都没有时取第一条（与 Web 的 normalizePlans 同口径）
        let chosen = rows.first { $0.isCurrent == true } ?? rows[0]
        return SnapshotSeatPlan(
            name: chosen.name?.nonEmpty ?? "未命名方案",
            updatedAtMillis: isoMillis(chosen.updatedAt)
        )
    }

    // MARK: - 解码小工具

    /// 解不出来就返回空数组：一份坏文档不该让整次同步失败（Web 侧 `pull()` 里
    /// 「形状不对的文档跳过而不是抛」是同一条纪律，出处 `src/services/cloudbase.ts`）
    private static func decode<T: Decodable>(_ type: [T].Type, from document: CloudDocument?) -> [T] {
        guard let document else { return [] }
        return (try? JSONDecoder().decode(type, from: document.payload)) ?? []
    }

    /// ISO 字符串 → 毫秒时间戳（Web 的 `SeatPlan.updatedAt` 是 ISO 字符串）
    private static func isoMillis(_ text: String?) -> Int64 {
        guard let text = text?.nonEmpty else { return 0 }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) {
            return Int64(date.timeIntervalSince1970 * 1000)
        }
        // 秒级精度（没有小数秒）的写法也认，否则教师手改过的方案时间会静默变成 0
        formatter.formatOptions = [.withInternetDateTime]
        guard let date = formatter.date(from: text) else { return 0 }
        return Int64(date.timeIntervalSince1970 * 1000)
    }
}

// MARK: - 线上形状（只声明用得到的字段）

/// 课程（Web 的 `Lesson`，只取 Widget 显示的四项 + 代课标记）
///
/// 非法条目返回 nil 被丢弃，判据与 Web 的 `normalizeLesson` 一致：
/// 星期必须在 1…7、节次 ≥ 1、科目与班级不能是空——云上可能留着旧版本或人工试写的数据。
private struct LessonWire: Decodable {
    var id: String?
    var weekday: Int?
    var period: Int?
    var subject: String?
    var className: String?
    var location: String?
    var isTemporary: Bool?

    var snapshot: SnapshotLesson? {
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

/// 待办（Web 的 `Todo`，字段一一对应）；文本为空即丢弃（同 Web 的 `normalizeTodo`）
private struct TodoWire: Decodable {
    var id: String?
    var text: String?
    var done: Bool?

    var snapshot: SnapshotTodo? {
        guard let text = text?.nonEmpty else { return nil }
        return SnapshotTodo(id: id?.nonEmpty ?? text, text: text, done: done == true)
    }
}

/// 学生（**只读两个字段**：id 用不上，deletedAt 决定在不在读）
private struct StudentWire: Decodable {
    var deletedAt: String?
}

/// 座位方案（只读名字、是否当前、最后更新时间）
private struct SeatPlanWire: Decodable {
    var name: String?
    var isCurrent: Bool?
    var updatedAt: String?
}
