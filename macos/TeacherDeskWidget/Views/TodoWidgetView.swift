//
//  TodoWidgetView.swift —— Widget 2：今日待办 / 工作安排
//
//  **这是工作台「今日待办」卡片的 Widget 化**（出处 `src/views/Home/components/DashboardTodoCard.vue`），
//  不是一个新的任务管理模块。数据就是那一份 `teacherdesk:dashboard:todos`（字段只有
//  `id / text / done` 三样），**没有**优先级、标签、截止时间、重复任务、工时、日志——
//  Web 侧没有这些模型，Widget 也就无从显示。规格里那张「不要增加」的清单，
//  在这个文件里体现为：**这里一行判断都没有，只把 todo.done 摆出来**。
//
//  只读的含义（规格 §三）：Widget 里的方框**不是复选框**，点了不会改状态——
//  点了是打开工作台，由教师在那里勾。所以这里画的是纯展示的对勾，不是可交互控件。
//

import SwiftUI
import WidgetKit

struct TodoWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let state: SnapshotReadResult
    let now: Date

    var body: some View {
        WidgetSurface {
            VStack(alignment: .leading, spacing: TDMetric.space2) {
                WidgetHeader(
                    title: "今日待办",
                    badge: badgeText,
                    badgeTint: allDone ? TDColor.successStrong : TDColor.textSecondary
                )
                body(for: state)
                Spacer(minLength: 0)
                WidgetStatusLine(state: state)
            }
            .padding(TDMetric.space3)
        }
        .widgetURL(WidgetLinks.url(for: .dashboard, in: snapshot))
    }

    private var snapshot: WidgetSnapshot? {
        if case .ok(let value) = state { return value }
        return nil
    }

    private var todos: [SnapshotTodo] { snapshot?.todos ?? [] }

    private var allDone: Bool { SnapshotDerive.allTodosDone(todos) }

    /// 「已完成 X / Y」（与工作台卡片同一个角标）
    private var badgeText: String? {
        guard snapshot != nil else { return nil }
        let counts = SnapshotDerive.todoCounts(todos)
        return "已完成 \(counts.done) / \(counts.total)"
    }

    @ViewBuilder
    private func body(for state: SnapshotReadResult) -> some View {
        switch state {
        case .ok where !todos.isEmpty:
            VStack(alignment: .leading, spacing: 0) {
                ForEach(visible) { todo in
                    TodoRow(todo: todo)
                }
                if todos.count > visible.count {
                    Text("还有 \(todos.count - visible.count) 条")
                        .font(TDFont.footnote)
                        .foregroundStyle(TDColor.textFaint)
                        .padding(.top, TDMetric.space1)
                }
            }
        case .ok:
            WidgetEmptyState(
                icon: "✅",
                title: "今天还没有待办",
                description: "待办的添加与删除将在后续版本提供。"
            )
        case .missing:
            WidgetEmptyState(icon: "🕗", title: "尚未同步数据", description: "在 TeacherDesk 里同步一次即可看到待办。")
        case .broken:
            WidgetEmptyState(icon: "⚠️", title: "数据读取失败", description: "打开 TeacherDesk 重新同步一次。")
        case .unavailable:
            WidgetEmptyState(icon: "⚠️", title: "共享容器不可用", description: "请重新安装本 App（详见 macos/README）。")
        }
    }

    /// 未完成的排在前面，已完成的沉底——**只排序，不改数据**。
    ///
    /// 排序理由：Widget 一屏只看得到几条，而教师打开它是想知道「还剩什么没做」。
    /// 已完成的条目留在原位会把有用的挤下去（Web 的工作台卡片因为够长，是原序显示的）。
    /// 同一状态内保持原有先后，顺序稳定可预期。
    private var visible: [SnapshotTodo] {
        let ordered = todos.filter { !$0.done } + todos.filter(\.done)
        return Array(ordered.prefix(family == .systemLarge ? 8 : (family == .systemMedium ? 5 : 3)))
    }
}

/// 一行待办：方框 + 文本（已完成的加删除线并变浅，与工作台卡片同款）
private struct TodoRow: View {
    let todo: SnapshotTodo

    var body: some View {
        HStack(alignment: .top, spacing: TDMetric.space2) {
            box
            Text(todo.text)
                .font(TDFont.body)
                .foregroundStyle(todo.done ? TDColor.textFaint : TDColor.text)
                .strikethrough(todo.done, color: TDColor.textFaint)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TDMetric.space1 + 1)
    }

    /// 纯展示的方框：勾上的用主色填底 + 白勾（与工作台卡片的 `.todo-box` 同款）
    private var box: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(todo.done ? TDColor.primary : Color.clear)
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .strokeBorder(todo.done ? TDColor.primary : TDColor.borderStrong, lineWidth: 1.5)
            if todo.done {
                Image(systemName: "checkmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: 15, height: 15)
        .padding(.top, 2)
    }
}

// 预览收进 `#if DEBUG`：理由同 LessonWidgetView（命令行工具链里没有 #Preview 的宏实现）
#if DEBUG
#Preview("Medium", as: .systemMedium) {
    TodoWidget()
} timeline: {
    SnapshotEntry(date: Date(), state: .ok(.sample))
    SnapshotEntry(date: Date(), state: .missing)
}
#endif
