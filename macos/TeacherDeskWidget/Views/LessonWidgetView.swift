//
//  LessonWidgetView.swift —— Widget 1：今日课程
//
//  **与工作台「今日课程」卡片同源同款**（出处 `src/views/Home/components/DashboardLessonCard.vue`）：
//  一行是「第N节 · 科目 · 班级 · 地点」，右上角是「今天 星期四」，没课时的空态文案
//  按「是不是周末」分两句。**这里没有钟点**——见下面那段说明，那不是偷懒。
//
//  ⚠️ **「当前/下一节课程 + 当前时间段」这一条，现有数据做不到，所以没做。**
//  Web 的课表模型里只有「星期 + 第几节」（`types/timetable.ts` 的 `weekday` / `period`），
//  **全应用没有任何地方记录过「第 3 节从几点上到几点」**（我核对过：`utils/timetable.ts`
//  只有 `LESSON_PERIODS = 1…8`，没有时间表）。要显示「当前时间段」就得凭空发明一份作息时间，
//  那正是「不臆造业务默认值」（Phase 9C §六）与环境里最忌讳的事。
//  所以这里如实显示「第 N 节」，与 Web 一字不差；要不要引入作息时间表，
//  属于**新的数据模型**，留给需求方拍板（已列进交付报告的待定项）。
//

import SwiftUI
import WidgetKit

struct LessonWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let state: SnapshotReadResult
    let now: Date

    var body: some View {
        WidgetSurface {
            VStack(alignment: .leading, spacing: TDMetric.space2) {
                WidgetHeader(title: "今日课程", badge: weekdayBadge)
                body(for: state)
                Spacer(minLength: 0)
                WidgetStatusLine(state: state)
            }
            .padding(TDMetric.space3)
        }
        .widgetURL(WidgetLinks.url(for: .schedule, in: snapshot))
    }

    private var snapshot: WidgetSnapshot? {
        if case .ok(let value) = state { return value }
        return nil
    }

    private var weekdayBadge: String? {
        guard snapshot != nil else { return nil }
        return "今天 \(SnapshotDerive.weekdayShortLabel(SnapshotDerive.weekday(of: now)))"
    }

    @ViewBuilder
    private func body(for state: SnapshotReadResult) -> some View {
        let lessons = snapshot.map { SnapshotDerive.todayLessons(from: $0, now: now) } ?? []

        switch state {
        case .ok where !lessons.isEmpty:
            lessonList(lessons)
        case .ok:
            // 空态文案按「是不是周末」分两句（与工作台卡片同一套措辞）
            let weekend = SnapshotDerive.isWeekend(SnapshotDerive.weekday(of: now))
            WidgetEmptyState(
                icon: "📚",
                title: "今天暂无课程",
                description: weekend ? "周末不排课，好好休息。" : "今天没有安排课程，可以安排班级事务。"
            )
        case .missing:
            WidgetEmptyState(icon: "🕗", title: "尚未同步数据", description: "在 TeacherDesk 里同步一次即可看到课程。")
        case .broken:
            WidgetEmptyState(icon: "⚠️", title: "数据读取失败", description: "打开 TeacherDesk 重新同步一次。")
        case .unavailable:
            WidgetEmptyState(icon: "⚠️", title: "共享容器不可用", description: "请重新安装本 App（详见 macos/README）。")
        }
    }

    @ViewBuilder
    private func lessonList(_ lessons: [SnapshotLesson]) -> some View {
        switch family {
        case .systemSmall:
            // Small 放不下列表：只显示第一节 + 今天一共几节（规格允许「减少信息而不是塞满」）
            if let first = lessons.first {
                VStack(alignment: .leading, spacing: TDMetric.space1) {
                    PeriodChip(period: first.period)
                    Text(first.subject)
                        .font(TDFont.bodyStrong)
                        .foregroundStyle(TDColor.text)
                        .lineLimit(2)
                    Text(first.className)
                        .font(TDFont.caption)
                        .foregroundStyle(TDColor.textSecondary)
                        .lineLimit(1)
                    if let location = first.location {
                        Text(location)
                            .font(TDFont.footnote)
                            .foregroundStyle(TDColor.textFaint)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    if lessons.count > 1 {
                        Text("今天共 \(lessons.count) 节")
                            .font(TDFont.footnote)
                            .foregroundStyle(TDColor.textFaint)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        default:
            // Medium / Large：标题下面就是把列表摆出来，条目上限按尺寸给
            VStack(alignment: .leading, spacing: 0) {
                ForEach(visible(lessons)) { lesson in
                    LessonRow(lesson: lesson)
                    if lesson.id != visible(lessons).last?.id {
                        Divider().overlay(TDColor.border)
                    }
                }
                if lessons.count > visible(lessons).count {
                    Text("还有 \(lessons.count - visible(lessons).count) 节")
                        .font(TDFont.footnote)
                        .foregroundStyle(TDColor.textFaint)
                        .padding(.top, TDMetric.space1)
                }
            }
        }
    }

    /// 显示几条：Medium 3 条、Large 6 条（再多就挤了，规格允许「不强行塞满」）
    private func visible(_ lessons: [SnapshotLesson]) -> [SnapshotLesson] {
        Array(lessons.prefix(family == .systemLarge ? 6 : 3))
    }
}

/// 一行课：`第N节 | 科目 班级 | 地点 [代课]`（与工作台卡片同款排法）
private struct LessonRow: View {
    let lesson: SnapshotLesson

    var body: some View {
        HStack(alignment: .center, spacing: TDMetric.space2) {
            PeriodChip(period: lesson.period)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: TDMetric.space1) {
                    Text(lesson.subject)
                        .font(TDFont.bodyStrong)
                        .foregroundStyle(TDColor.text)
                        .lineLimit(1)
                    if lesson.isTemporary == true {
                        TemporaryChip()
                    }
                }
                Text(lesson.className)
                    .font(TDFont.caption)
                    .foregroundStyle(TDColor.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if let location = lesson.location {
                Text(location)
                    .font(TDFont.footnote)
                    .foregroundStyle(TDColor.textFaint)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, TDMetric.space2)
    }
}

/// 「代课」小标（出处：`ScheduleLessonCard.vue` 的 `<AppBadge variant="warning">代课</AppBadge>`）
private struct TemporaryChip: View {
    var body: some View {
        Text("代课")
            .font(TDFont.footnote.weight(.semibold))
            .foregroundStyle(TDColor.warningStrong)
            .padding(.horizontal, TDMetric.space1 + 2)
            .padding(.vertical, 1)
            .background(Capsule().fill(TDColor.warning.opacity(0.18)))
    }
}

// 预览放在 `#if DEBUG` 里是两件事共同要求的：
// 1. `#Preview` 宏的实现在 Xcode 里（命令行工具链没有 `PreviewsMacros`），
//    收进 DEBUG 之后，没有 Xcode 的机器也能对整份源码做类型检查（见 `macos/Tools/verify.sh`）；
// 2. Xcode 的 Debug 配置默认就定义了 DEBUG，所以预览照常可用。
#if DEBUG
#Preview("Medium", as: .systemMedium) {
    LessonWidget()
} timeline: {
    SnapshotEntry(date: Date(), state: .ok(.sample))
    SnapshotEntry(date: Date(), state: .missing)
}
#endif
