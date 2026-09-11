//
//  ClassWidgetView.swift —— Widget 3：班级概况
//
//  ⚠️ **这里显示的三样，与工作台那张「班级概况」卡片并不完全相同，这是有意的。**
//
//  工作台卡片显示的是「在读人数 / 今日值日 / 本周末留校」（出处
//  `src/views/Home/components/DashboardClassCard.vue`）。后面两样**没有搬进 Widget**：
//
//    - 「今日值日」要算出今天轮到哪个组 → 那是 `src/utils/duty.ts` 里的**轮换算法**
//      （起点推算、周末跳过、组被删时顺延），一行代码背后是一整套业务规则；
//    - 「本周末留校」= 在读人数 − 这一期仍在读的返家人数 → 依赖请假/返家记录的时间区间判定。
//
//  把它们在 Swift 里再写一遍，就等于给同一件事造出第二套规则，而且**没有任何东西保证
//  两套一致**（Web 那边有 81 项常驻测试盯着，这边没有）。所以 Widget 只显示
//  **不需要算法、看一眼就成立**的三样：班级名、在读人数、当前座位方案的方案名。
//  这与规格里举的例子（高一9班 / 学生人数 / 当前座位方案）是一致的。
//
//  人数口径（出处 `src/stores/student.ts`）：在读 = 档案里 `deletedAt` 为空的学生；
//  已退档的**不在**这个数里，但要用小字说出来——不说，教师只会发现人数比记忆里少，
//  却找不到少的是谁（Phase 8 审查修正的原话）。
//

import SwiftUI
import WidgetKit

struct ClassWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let state: SnapshotReadResult
    let now: Date

    var body: some View {
        WidgetSurface {
            VStack(alignment: .leading, spacing: TDMetric.space2) {
                WidgetHeader(title: title, badge: nil)
                body(for: state)
                Spacer(minLength: 0)
                WidgetStatusLine(state: state)
            }
            .padding(TDMetric.space3)
        }
        .widgetURL(WidgetLinks.url(for: .students, in: snapshot))
    }

    private var snapshot: WidgetSnapshot? {
        if case .ok(let value) = state { return value }
        return nil
    }

    private var title: String { snapshot?.classroomName ?? "班级概况" }

    @ViewBuilder
    private func body(for state: SnapshotReadResult) -> some View {
        switch state {
        case .ok(let snapshot):
            rows(snapshot)
        case .missing:
            WidgetEmptyState(icon: "🕗", title: "尚未同步数据", description: "在 TeacherDesk 里同步一次即可看到班级概况。")
        case .broken:
            WidgetEmptyState(icon: "⚠️", title: "数据读取失败", description: "打开 TeacherDesk 重新同步一次。")
        case .unavailable:
            WidgetEmptyState(icon: "⚠️", title: "共享容器不可用", description: "请重新安装本 App（详见 macos/README）。")
        }
    }

    @ViewBuilder
    private func rows(_ snapshot: WidgetSnapshot) -> some View {
        if family == .systemSmall {
            smallLayout(snapshot)
        } else {
            VStack(alignment: .leading, spacing: TDMetric.space2) {
                OverviewRow(
                    label: "在读人数",
                    value: "\(snapshot.students.active) 人",
                    note: studentNote(snapshot),
                    url: WidgetLinks.url(for: .students, in: snapshot)
                )
                OverviewRow(
                    label: "当前座位方案",
                    value: snapshot.seatPlan?.name ?? "未设置",
                    note: seatNote(snapshot),
                    url: WidgetLinks.url(for: .students, in: snapshot)
                )
            }
        }
    }

    /// Small：人数放大占主位，座位方案压成一行（规格允许在 Small 上「减少信息」）
    @ViewBuilder
    private func smallLayout(_ snapshot: WidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: TDMetric.space1) {
            Text("在读人数")
                .font(TDFont.footnote)
                .foregroundStyle(TDColor.textSecondary)
            Text("\(snapshot.students.active)")
                .font(TDFont.metric)
                .foregroundStyle(TDColor.primaryStrong)
            if let note = studentNote(snapshot) {
                Text(note)
                    .font(TDFont.footnote)
                    .foregroundStyle(TDColor.textFaint)
                    .lineLimit(2)
            }
            Spacer(minLength: TDMetric.space1)
            HStack(spacing: TDMetric.space1) {
                Image(systemName: "chair.lounge")
                    .font(.system(size: 10))
                Text(snapshot.seatPlan?.name ?? "未设置座位方案")
                    .font(TDFont.caption)
                    .lineLimit(1)
            }
            .foregroundStyle(TDColor.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 人数那行的小字（与工作台卡片同一套说法）
    private func studentNote(_ snapshot: WidgetSnapshot) -> String? {
        if snapshot.students.active == 0 && snapshot.students.removed == 0 {
            return "还没有学生档案，去添加"
        }
        if snapshot.students.removed > 0 {
            return "另有 \(snapshot.students.removed) 位已退档，不计入"
        }
        return nil
    }

    /// 座位方案那行的小字：说清这份方案是什么时候调的（没有方案时说清去哪儿建）
    private func seatNote(_ snapshot: WidgetSnapshot) -> String? {
        guard let plan = snapshot.seatPlan else { return "在座位表里新建一个方案" }
        guard plan.updatedAtMillis > 0 else { return nil }
        let date = Date(timeIntervalSince1970: Double(plan.updatedAtMillis) / 1000)
        return "最后调整 \(SnapshotDerive.clockLabel(date))"
    }
}

/// 一行概况：左标签右数值（与工作台卡片 `.overview-row` 同款），整行可点，跳 Web 对应页
private struct OverviewRow: View {
    let label: String
    let value: String
    var note: String?
    /// 由调用方用 `WidgetLinks` 算好（要带快照里的 PWA 地址，见 `WidgetLinks.url`）
    let url: URL

    var body: some View {
        Link(destination: url) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: TDMetric.space2) {
                    Text(label)
                        .font(TDFont.caption)
                        .foregroundStyle(TDColor.textSecondary)
                    Spacer(minLength: 0)
                    Text(value)
                        .font(TDFont.bodyStrong)
                        .foregroundStyle(TDColor.text)
                        .lineLimit(1)
                }
                if let note {
                    Text(note)
                        .font(TDFont.footnote)
                        .foregroundStyle(TDColor.textFaint)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, TDMetric.space1)
            .padding(.horizontal, TDMetric.space2)
            .background(RoundedRectangle(cornerRadius: TDMetric.radiusMedium, style: .continuous)
                .fill(Color.white.opacity(0.55)))
        }
    }
}

// 预览收进 `#if DEBUG`：理由同 LessonWidgetView（命令行工具链里没有 #Preview 的宏实现）
#if DEBUG
#Preview("Medium", as: .systemMedium) {
    ClassWidget()
} timeline: {
    SnapshotEntry(date: Date(), state: .ok(.sample))
    SnapshotEntry(date: Date(), state: .missing)
}
#endif
