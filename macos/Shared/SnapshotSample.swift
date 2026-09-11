//
//  SnapshotSample.swift —— 示例快照（占位符、预览、冒烟测试三处共用同一份）
//
//  **为什么要专门有一份示例数据**：WidgetKit 在「还没拿到真实时间线」时会先渲染
//  `placeholder`，如果占位符也走「没有数据 → 空态」那条路，教师在把 Widget 加进通知中心
//  的一瞬间看到的会是「尚未同步数据」——一句吓人的假话。占位符必须显示的是一份
//  **形状正确的样子货**，这正是这个文件的用途。
//
//  它的内容是一份**普通的样例**（不是 Web 的示例数据、也不是任何真实数据）：
//  三个年级的课、几条待办、一个班的人数。改它不影响任何真实数据——示例数据只活在
//  内存里，永远不会被写进快照文件。
//

import Foundation

extension WidgetSnapshot {
    /// 占位符 / 预览 / 冒烟测试用的样例快照
    static let sample = WidgetSnapshot(
        schemaVersion: snapshotSchemaVersion,
        generatedAtMillis: 1_756_000_000_000,
        syncedAtMillis: 1_755_999_000_000,
        classroomName: "高一9班",
        lessons: [
            SnapshotLesson(id: "l1", weekday: 1, period: 1, subject: "数学", className: "高一9班",
                           location: "A 栋 302", isTemporary: false),
            SnapshotLesson(id: "l2", weekday: 1, period: 3, subject: "数学", className: "高一7班",
                           location: nil, isTemporary: false),
            SnapshotLesson(id: "l3", weekday: 1, period: 5, subject: "班会", className: "高一9班",
                           location: "A 栋 302", isTemporary: false),
            SnapshotLesson(id: "l4", weekday: 2, period: 2, subject: "数学", className: "高一9班",
                           location: "A 栋 302", isTemporary: false),
            SnapshotLesson(id: "l5", weekday: 4, period: 4, subject: "数学", className: "高一9班",
                           location: nil, isTemporary: true),
        ],
        todos: [
            SnapshotTodo(id: "t1", text: "收齐体检表", done: false),
            SnapshotTodo(id: "t2", text: "确认本周留校名单", done: false),
            SnapshotTodo(id: "t3", text: "把月考成绩录入系统", done: true),
        ],
        students: SnapshotStudentCounts(active: 41, removed: 2),
        seatPlan: SnapshotSeatPlan(name: "开学初", updatedAtMillis: 1_755_000_000_000),
        pwaBaseURL: nil
    )
}
