//
//  WeekScheduleView.swift —— 一周课程表（large，v3.7.0，v3.7.3 视觉精修）
//
//  布局（规格 §十二 / §二十六）：**列 = 星期，行 = 节次**，格子 = 班级。
//  左侧一列是节次的短名（「早自习」「第2节」…「晚自习3」），顶上一行是星期。
//
//  三条规矩：
//   · **节次与星期名全部来自快照**（Web 侧的 `COURSE_PERIODS` / `WEEKDAY_LABELS`），
//     Swift 侧不写死「第1节…第8节」——项目改作息时小组件跟着变（规格 §十三）。
//   · **空格子画「—」**（规格 §十）：不猜、不留白得让人以为没加载完。
//   · **只强调星期标题上的「今天」**（规格 §四 / §七）。
//
//  ## v3.7.3 改了什么（这一版全部是排版，不动数据）
//
//  ① **今天不再整列铺底**。v3.7.2 是「今天那一列每一格都盖一层淡主色」，
//     桌面截图里就是七列里突然多出一条由 10 个浅色圆角块串成的柱子——这是本版
//     要消掉的第一件事（规格 §四）。现在「今天」只落在**星期标题**那一小块上。
//  ② **空课程不再有背景**。`—` 只留一个低对比度的字（规格 §十）；有课的格子才有
//     一层极浅的中性底（规格 §五 / §九）。于是整张表从「一片圆角块」变成
//     「只有有课的地方有容器」——这才是 macOS 原生课表该有的密度。
//  ③ **纵向重新分配**。v3.7.2 的行距只有 3/2/1/0 四档，课表永远挤在顶部、
//     下半张全是空白。现在退让阶梯从「舒展」开始（行距 9 → 2），
//     并且**剩余空间交给表尾的自然留白**——内容占据主要区域，上下都有呼吸（规格 §十一）。
//  ④ 标题右侧从「同步于 10月1日 01:21」压成「01:21 同步」（规格 §六）。
//
//  只支持 large（规格 §十四）：一周课表在 small 里没有可读性，medium 也没保证。
//
//  溢出策略：行高按「放得下多少行」自动收缩（`ViewThatFits` + 六档行距），
//  格子里的字号固定在 9.5–11pt，过长缩排 / 截断（规格 §三十二：不许撑破整体布局）。
//
//  v3.7.1：格子里写的是**班级**（`SnapshotDerive.label(for:)`），不是科目——
//  数学老师一周 50 节都写「数学」的话，这张表什么也没告诉他。
//

import SwiftUI
import WidgetKit

struct WeekScheduleView: View {
    @Environment(\.colorScheme) private var scheme

    let entry: SnapshotEntry
    /// 由调用方给（同 `TodayScheduleView`）：Widget 传系统值，预览页传要预览的尺寸
    var family: WidgetFamily

    var body: some View {
        Group {
            if let snapshot = entry.snapshot {
                content(snapshot: snapshot)
            } else {
                VStack(alignment: .leading, spacing: TDWidgetMetrics.titleGap) {
                    WidgetHeading(title: "一周课程表", trailing: nil)
                    widgetNotice(
                        for: entry.read,
                        emptyTitle: "这一周还没有课",
                        emptyDetail: "课程表里一条课程都没有。"
                    )
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .widgetContentPadding(family)
            }
        }
        .widgetURL(WidgetLinks.url(for: .week, in: entry.snapshot))
    }

    @ViewBuilder
    private func content(snapshot: WidgetSnapshot) -> some View {
        let days = SnapshotDerive.visibleDays(in: snapshot)
        let periods = snapshot.orderedPeriods

        // 结构照规格 §十一 的竖排顺序：标题 → 呼吸 → 星期 → 呼吸 → 课程表 → 自然底部留白。
        // 底部的 `Spacer(minLength: 0)` 是**故意留的**：课表挑完档位后剩下的高度全部落在这里，
        // 于是内容始终从上往下占满主要区域，不会像 v3.7.2 那样「顶死在上半张」。
        VStack(alignment: .leading, spacing: 0) {
            WidgetHeading(
                title: "一周课程表",
                trailing: SnapshotDerive.syncClockLabel(snapshot).map { .sync("\($0) 同步") }
            )

            Spacer().frame(height: TDWidgetMetrics.titleGap)

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
                let today = SnapshotDerive.weekday(of: entry.date)
                headerRow(days: days, today: today)
                Spacer().frame(height: TDWidgetMetrics.headerGap)
                grid(days: days, periods: periods, today: today)
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetContentPadding(family)
    }

    /* ---------- 表格本体 ---------- */

    /// 一档行高 = (行距, 格子上下内边距, 格子里字号)
    private struct GridDensity {
        let rowSpacing: CGFloat
        let cellPadding: CGFloat
        let subjectSize: CGFloat
    }

    /// 退让阶梯：**从舒展开始**，放不下才一档一档收紧。
    ///
    /// v3.7.2 是从「最紧」开始（3/2/1/0），于是 Large 里永远选最紧的那档、
    /// 下面空出一大片。这里把阶梯倒过来，并让档与档之间的高度差保持在 20pt 上下——
    /// 差得太大会出现「明明还差一点就能再宽松一档」的浪费。
    private static let densities: [GridDensity] = [
        GridDensity(rowSpacing: 9, cellPadding: 5, subjectSize: 11),
        GridDensity(rowSpacing: 7, cellPadding: 4, subjectSize: 11),
        GridDensity(rowSpacing: 5.5, cellPadding: 3, subjectSize: 10.5),
        GridDensity(rowSpacing: 4, cellPadding: 2, subjectSize: 10),
        GridDensity(rowSpacing: 3, cellPadding: 1.5, subjectSize: 9.5),
        GridDensity(rowSpacing: 2, cellPadding: 1, subjectSize: 9.5),
    ]

    @ViewBuilder
    private func grid(days: [SnapshotDay], periods: [SnapshotPeriod], today: Int) -> some View {
        ViewThatFits(in: .vertical) {
            ForEach(Array(Self.densities.enumerated()), id: \.offset) { _, density in
                table(days: days, periods: periods, today: today, density: density)
            }
        }
    }

    private func table(
        days: [SnapshotDay],
        periods: [SnapshotPeriod],
        today: Int,
        density: GridDensity
    ) -> some View {
        VStack(alignment: .leading, spacing: density.rowSpacing) {
            ForEach(periods) { period in
                row(period: period, days: days, density: density)
            }
        }
    }

    /// 表头：左上角留出节次列的宽度，其余是星期
    ///
    /// 「今天」的强调**只在这里**（规格 §四 / §七）：松石青文字 + 加粗 + 一小块极淡的底。
    /// 底只包住这四个字，不往下贯穿整列——v3.7.2 那种「整列胶囊」就是这么来的。
    private func headerRow(days: [SnapshotDay], today: Int) -> some View {
        HStack(spacing: TDWidgetMetrics.gridColumnGap) {
            Color.clear.frame(width: TDWidgetMetrics.periodColumnWidth, height: 1)
            ForEach(days, id: \.weekday) { day in
                let isToday = day.weekday == today
                Text(day.shortLabel)
                    .font(.system(size: 11, weight: isToday ? .semibold : .medium))
                    .foregroundStyle(isToday ? TDColor.primary(scheme) : TDColor.secondaryText(scheme))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 2)
                    .background(
                        RoundedRectangle(cornerRadius: TDRadius.chip, style: .continuous)
                            .fill(isToday ? TDColor.primaryWash(scheme) : Color.clear)
                    )
            }
        }
    }

    /// 一行：节次 + 每天的格子
    ///
    /// 格子的三条规则（规格 §五 / §九 / §十）：
    ///   · **有课** → 主文字色 + semibold + 极浅中性底（唯一有容器的地方）；
    ///   · **没课** → 一个低对比度的「—」，**没有背景**；
    ///   · **今天那一列** → 与别的列一样，不加底色（强调只给星期标题）。
    private func row(period: SnapshotPeriod, days: [SnapshotDay], density: GridDensity) -> some View {
        HStack(spacing: TDWidgetMetrics.gridColumnGap) {
            Text(period.shortLabel)
                .font(TDFont.periodLabel)
                .foregroundStyle(TDColor.tertiaryText(scheme))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(width: TDWidgetMetrics.periodColumnWidth, alignment: .leading)

            ForEach(days, id: \.weekday) { day in
                let lesson = SnapshotDerive.lesson(in: day, periodID: period.id)
                Text(lesson.map(SnapshotDerive.label(for:)) ?? "—")
                    .font(.system(size: density.subjectSize, weight: lesson == nil ? .regular : .semibold))
                    .foregroundStyle(
                        lesson == nil ? TDColor.widgetEmptyMark(scheme) : TDColor.text(scheme)
                    )
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .minimumScaleFactor(0.8)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, density.cellPadding)
                    .background(
                        RoundedRectangle(cornerRadius: TDRadius.chip, style: .continuous)
                            .fill(lesson == nil ? Color.clear : TDColor.fill(scheme))
                    )
            }
        }
    }
}
