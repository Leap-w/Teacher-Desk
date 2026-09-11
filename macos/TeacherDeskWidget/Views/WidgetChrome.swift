//
//  WidgetChrome.swift —— 三个 Widget 共用的外壳：卡片底、标题行、空态、状态行
//
//  共用是为了**口径一致**：三个 Widget 会并排挂在通知中心里，标题字号差一点、
//  左边距差一点、空态语气不一样，一眼就看得出是两个东西拼的。
//

import SwiftUI
import WidgetKit

// MARK: - 卡片底

/// Widget 的统一外表：松石青浅底 + 系统卡片圆角。
///
/// macOS 14 起 WidgetKit 要求视图显式声明 `containerBackground`（不声明会直接报错），
/// 所以背景只能挂在这一层——每个视图各写一遍的话，早晚会漏掉一个。
struct WidgetSurface<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .containerBackground(for: .widget) {
                LinearGradient(
                    colors: [Color.white, TDColor.primarySoft],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
    }
}

// MARK: - 标题行

/// 标题 + 右侧角标（与 Web 的 `AppCard` + `AppBadge` 同一个排法）
struct WidgetHeader: View {
    let title: String
    var badge: String?
    var badgeTint: Color = TDColor.primaryStrong

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TDMetric.space2) {
            Text(title)
                .font(TDFont.title)
                .foregroundStyle(TDColor.text)
                .lineLimit(1)
            Spacer(minLength: 0)
            if let badge {
                Text(badge)
                    .font(TDFont.footnote.weight(.semibold))
                    .foregroundStyle(badgeTint)
                    .padding(.horizontal, TDMetric.space2)
                    .padding(.vertical, 2)
                    .background(
                        Capsule().fill(TDColor.primarySoft)
                    )
                    .lineLimit(1)
            }
        }
    }
}

// MARK: - 空态

/// 空态（文案与工作台卡片一字不差，出处 `DashboardLessonCard.vue` / `DashboardTodoCard.vue`）
struct WidgetEmptyState: View {
    let icon: String
    let title: String
    var description: String?

    var body: some View {
        VStack(spacing: TDMetric.space2) {
            Text(icon).font(.system(size: 26))
            Text(title)
                .font(TDFont.bodyStrong)
                .foregroundStyle(TDColor.textSecondary)
            if let description {
                Text(description)
                    .font(TDFont.footnote)
                    .foregroundStyle(TDColor.textFaint)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - 状态行（「更新于 09:32」）

/// 底部那行小字：**它同时承担「这份数据有多旧」与「为什么没有数据」两件事**。
///
/// 三种读不到的情形说的**不是同一句话**（Phase 9C 在 Web 侧守了很久的同一条纪律）：
/// 没同步过 ≠ 读坏了 ≠ 快照目录算不出来。折成一句「暂无数据」的话，教师没法判断
/// 是「还没登过录」还是「东西坏了」。
struct WidgetStatusLine: View {
    let state: SnapshotReadResult

    var body: some View {
        HStack(spacing: TDMetric.space1) {
            Image(systemName: symbol)
                .font(.system(size: 9))
            Text(text)
                .font(TDFont.footnote)
                .lineLimit(1)
        }
        .foregroundStyle(tint)
    }

    private var text: String {
        switch state {
        case .ok(let snapshot):
            return "更新于 \(SnapshotDerive.clockLabel(snapshot.syncedAt))"
        case .missing:
            return "尚未同步数据"
        case .broken:
            return "数据读取失败"
        case .unavailable:
            // 正常机器上走不到这里（算不出 Application Support 目录基本不可能）。
            // 真出现了，那句话本身没法定向，所以直接把路径报出来让人去看
            return "找不到快照目录"
        }
    }

    private var symbol: String {
        switch state {
        case .ok: return "arrow.triangle.2.circlepath"
        case .missing: return "clock"
        case .broken: return "exclamationmark.triangle"
        case .unavailable: return "exclamationmark.triangle"
        }
    }

    private var tint: Color {
        switch state {
        case .ok: return TDColor.textFaint
        case .missing: return TDColor.textFaint
        case .broken: return TDColor.warningStrong
        case .unavailable: return TDColor.warningStrong
        }
    }
}

// MARK: - 小标签（「第3节」「代课」）

/// 与 Web 的「第N节」徽标同款（`DashboardLessonCard.vue` 的 `.lesson-period`）
struct PeriodChip: View {
    let period: Int

    var body: some View {
        Text("第\(period)节")
            .font(TDFont.footnote.weight(.semibold))
            .foregroundStyle(TDColor.primaryStrong)
            .padding(.horizontal, TDMetric.space2)
            .padding(.vertical, 3)
            .background(RoundedRectangle(cornerRadius: TDMetric.radiusSmall, style: .continuous)
                .fill(TDColor.primarySoft))
    }
}
