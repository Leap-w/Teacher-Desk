//
//  WeekScheduleView.swift —— 一周课程表（large，v3.7.0）
//
//  布局（规格 §十二 / §二十六）：**列 = 星期，行 = 节次**，格子 = 科目。
//  左侧一列是节次的短名（「早自习」「第2节」…「晚自习3」），顶上一行是星期。
//
//  三条规矩：
//   · **节次与星期名全部来自快照**（Web 侧的 `COURSE_PERIODS` / `WEEKDAY_LABELS`），
//     Swift 侧不写死「第1节…第8节」——项目改作息时小组件跟着变（规格 §十三）。
//   · **今天那一列轻量强调**（规格 §十五）：整列一层极淡的主色底 + 列头用主色加粗。
//     用的就是 Web 端的主色（`--color-primary`），不引入新配色。
//   · **空格子画「—」**（规格 §十六）：不猜、不留白得让人以为没加载完。
//
//  只支持 large（规格 §十四）：一周课表在 small 里没有可读性，medium 也没保证。
//
//  溢出策略：行高按「放得下多少行」自动收缩（`ViewThatFits` + 三档行距），
//  科目字号固定 10.5–11pt，过长截断（规格 §十七：不许撑破整体布局）。
//

import SwiftUI
import WidgetKit

struct WeekScheduleView: View {
    @Environment(\.colorScheme) private var scheme

    let entry: SnapshotEntry

    var body: some View {
        Group {
            if let snapshot = entry.snapshot {
                content(snapshot: snapshot)
            } else {
                VStack(alignment: .leading, spacing: TDSpace.md) {
                    WidgetHeading(title: "一周课程表", trailing: nil)
                    widgetNotice(
                        for: entry.read,
                        emptyTitle: "这一周还没有课",
                        emptyDetail: "课程表里一条课程都没有。"
                    )
                }
            }
        }
        .widgetURL(WidgetLinks.url(for: .week, in: entry.snapshot))
    }

    @ViewBuilder
    private func content(snapshot: WidgetSnapshot) -> some View {
        let days = SnapshotDerive.visibleDays(in: snapshot)
        let periods = snapshot.orderedPeriods

        VStack(alignment: .leading, spacing: TDSpace.sm) {
            WidgetHeading(
                title: "一周课程表",
                trailing: snapshot.updatedAtLabel.map { "同步于 \($0)" }
            )

            if days.isEmpty || periods.isEmpty || SnapshotDerive.lessonCount(in: snapshot) == 0 {
                VStack(alignment: .leading, spacing: TDSpace.xs) {
                    Text("这一周还没有课")
                        .font(TDFont.bodyStrong)
                        .foregroundStyle(TDColor.text(scheme))
                    Text("到 TeacherDesk 课程表里加几节课，或从 Excel 导入。")
                        .font(TDFont.caption)
                        .foregroundStyle(TDColor.tertiaryText(scheme))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                grid(days: days, periods: periods)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
    }

    /// 表格本体。行距有三档，`ViewThatFits` 从宽到紧挑第一个放得下的
    @ViewBuilder
    private func grid(days: [SnapshotDay], periods: [SnapshotPeriod]) -> some View {
        ViewThatFits(in: .vertical) {
            table(days: days, periods: periods, rowSpacing: 3, subjectSize: 11)
            table(days: days, periods: periods, rowSpacing: 2, subjectSize: 10.5)
            table(days: days, periods: periods, rowSpacing: 1, subjectSize: 10)
            table(days: days, periods: periods, rowSpacing: 0, subjectSize: 9.5)
        }
    }

    private func table(
        days: [SnapshotDay],
        periods: [SnapshotPeriod],
        rowSpacing: CGFloat,
        subjectSize: CGFloat
    ) -> some View {
        let today = SnapshotDerive.weekday(of: entry.date)

        return VStack(alignment: .leading, spacing: rowSpacing) {
            headerRow(days: days, today: today)
            ForEach(periods) { period in
                row(period: period, days: days, today: today, subjectSize: subjectSize)
            }
        }
    }

    /// 表头：左上角留一个节次列的宽度，其余是星期
    private func headerRow(days: [SnapshotDay], today: Int) -> some View {
        HStack(spacing: 2) {
            Color.clear.frame(width: Self.periodColumnWidth, height: 12)
            ForEach(days, id: \.weekday) { day in
                let isToday = day.weekday == today
                Text(day.shortLabel)
                    .font(.system(size: 10.5, weight: isToday ? .bold : .medium))
                    .foregroundStyle(isToday ? TDColor.primary(scheme) : TDColor.secondaryText(scheme))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity)
                    .background(
                        RoundedRectangle(cornerRadius: TDRadius.xs, style: .continuous)
                            .fill(isToday ? TDColor.primaryWash(scheme) : .clear)
                    )
            }
        }
    }

    /// 一行：节次 + 每天的格子
    private func row(
        period: SnapshotPeriod,
        days: [SnapshotDay],
        today: Int,
        subjectSize: CGFloat
    ) -> some View {
        HStack(spacing: 2) {
            Text(period.shortLabel)
                .font(.system(size: 9.5, weight: .medium))
                .foregroundStyle(TDColor.faintText(scheme))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(width: Self.periodColumnWidth, alignment: .leading)

            ForEach(days, id: \.weekday) { day in
                let isToday = day.weekday == today
                let lesson = SnapshotDerive.lesson(in: day, periodID: period.id)
                Text(lesson?.subject ?? "—")
                    .font(.system(size: subjectSize, weight: lesson == nil ? .regular : .semibold))
                    .foregroundStyle(lesson == nil ? TDColor.faintText(scheme) : TDColor.text(scheme))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .minimumScaleFactor(0.85)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 1)
                    .background(
                        RoundedRectangle(cornerRadius: TDRadius.xs, style: .continuous)
                            .fill(cellBackground(isToday: isToday, hasLesson: lesson != nil))
                    )
            }
        }
    }

    /// 格子底：今天那一列整列有极淡的主色；其余格子只有「有课」时给一点点填充，
    /// 让「有课 / 没课」在缩略视图里也能一眼分开（规格 §二十六：不加装饰，只做区分）
    private func cellBackground(isToday: Bool, hasLesson: Bool) -> Color {
        if isToday { return TDColor.primaryWash(scheme) }
        return hasLesson ? TDColor.fill(scheme) : .clear
    }

    /// 节次列宽：够放「晚自习3」四个字（9.5pt 约 42pt）
    private static let periodColumnWidth: CGFloat = 44
}
