//
//  TodayScheduleView.swift —— 今日课程（small / medium，v3.7.0，v3.7.3 视觉精修）
//
//  视觉层级（规格 §十三 / §十六）：**主信息是主角，节次是辅助**。
//  所以每一行是「节次（小字、灰）+ 班级（大字、深色）」，而不是反过来。
//
//  v3.7.1：主信息从**科目**改成**班级**（`SnapshotDerive.label(for:)` 是唯一口径）。
//  理由来自真实使用：数学老师一天十节都是数学，逐行写「数学」等于没有信息，
//  「下一节去哪个班」才是要看的那件事。
//
//  ## 尺寸差异怎么处理（规格 §二十八）
//
//  规格要求 medium「显示当天完整课程」，而一个班一天最多 10 节（早自习 + 7 节 + 3 节晚自习）。
//  medium 与 small **高度一样**（都是 170pt），差别只在宽度——所以「放得下几行」这件事
//  两个尺寸其实一样，区别在每一行有多舒展。
//  这里用 **ViewThatFits** 让系统自己挑：从「全部」开始试，放不下就退到 9 / 7 / 6 …行，
//  退让时明确写出「还有 N 节」——**宁可少显示几行并说出来，也不能悄悄裁掉一行**
//  （被裁掉的那一行正是最后一节课，教师会以为今天早放学）。
//
//  节次用短名（「早自习」「第2节」「晚自习1」）：完整名「早自习及第一节」在小组件宽度里
//  会把班级挤没；规格也允许小组件不显示节次时间。
//
//  空态：今天真的没有课就说「今天没有安排课程」，**不伪造课程**（规格 §8.1）。
//
//  v3.7.2：加「当前 / 下一节」强调（`SnapshotDerive.moment`），只改今日课程，不动一周课表；
//  **不做倒计时、不显示时刻**（规格 §十三）。
//
//  ## v3.7.3 改了什么（全部是排版）
//
//  ① **日期不再被截成「周四 · 1...」**（规格 §十四）。两处一起改：
//     右侧那句话加了 `fixedSize(horizontal:)`（它宁可把标题挤瘦也不出省略号），
//     并且**先试完整日期、放不下才退到「10月1日」**（规格 §十五）——
//     用 `ViewThatFits` 挑，而不是用 `truncationMode` 把问题藏起来。
//  ② **标题与日期的层级拉开**（规格 §十三）：标题 15pt semibold 主文字色，
//     日期 12pt medium 次级灰——不再是两个差不多重的字。
//  ③ **当前 / 下一节分三级**（规格 §十七 / §十八 / §十九）：
//     当前 = 极淡主色**行底** + 「当前」标签；下一节 = 只挂「下一节」标签（更淡）；
//     普通 = 什么都没有。三档各不相同，强调才有意义。
//  ④ 行的左右不再各自留白：强调底用**负内边距向外扩**，这样有没有强调，文字都对齐同一根线。
//

import SwiftUI
import WidgetKit

struct TodayScheduleView: View {
    @Environment(\.colorScheme) private var scheme

    let entry: SnapshotEntry
    /// 由调用方给：Widget 传系统给的 `@Environment(\.widgetFamily)`，
    /// 宿主 App 的预览页传它要预览的尺寸（v3.7.2 §六：预览必须复用同一个 View）
    var family: WidgetFamily

    /// 退让阶梯：先试全部，再 9 / 7 / 6 / 5 / 4 / 3 / 2 / 1 行（`ViewThatFits` 取第一个放得下的）
    ///
    /// 比 v3.7.2 的 [全部, 8, 6, 4, 3, 2, 1] 更细：粗阶梯会出现「明明还能多放一行，
    /// 却整档退到少两行」的浪费（真实快照的周四正好是 5 节，落在一个空档上）。
    private static let capacities = [Int.max, 9, 7, 6, 5, 4, 3, 2, 1]

    /// 一个候选档：显示前 `capacity` 行，以及**要不要带那行「今日课程已结束」**
    private struct StackCandidate: Hashable {
        let capacity: Int
        let showsFinishedNote: Bool
    }

    /// 候选顺序（规格 §二十一）
    ///
    /// 全天结束时优先「整份列表 + 一行状态」；**放不下时先让掉那行状态、把行留下**——
    /// 状态是锦上添花，列表才是教师要看的东西。所以两个变体是**交错**排的
    /// （(全部+状态) → (全部) → (9+状态) → (9) → …），而不是「先把所有带状态的试完」：
    /// 后者会让一个 10 节的班在放学后只剩 3 行 + 「还有 7 节」。
    private static func candidates(isFinished: Bool) -> [StackCandidate] {
        guard isFinished else {
            return capacities.map { StackCandidate(capacity: $0, showsFinishedNote: false) }
        }
        return capacities.flatMap { capacity in
            [
                StackCandidate(capacity: capacity, showsFinishedNote: true),
                StackCandidate(capacity: capacity, showsFinishedNote: false),
            ]
        }
    }

    /// 今日课程列表里「节次」那一列的宽度（与一周课表同值，两块界面对齐同一根线）
    private static let periodWidth = TDWidgetMetrics.periodColumnWidth

    var body: some View {
        Group {
            if let snapshot = entry.snapshot {
                content(snapshot: snapshot)
            } else {
                VStack(alignment: .leading, spacing: TDWidgetMetrics.compactTitleGap) {
                    heading
                    widgetNotice(
                        for: entry.read,
                        emptyTitle: "今天没有安排课程",
                        emptyDetail: "课程表里今天这一列为空。"
                    )
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .widgetContentPadding(family)
            }
        }
        // 点击任意位置 → 打开 TeacherDesk（规格 §十八）
        .widgetURL(WidgetLinks.url(for: .today, in: entry.snapshot))
    }

    @ViewBuilder
    private func content(snapshot: WidgetSnapshot) -> some View {
        let rows = SnapshotDerive.lessons(in: snapshot, on: entry.date)

        VStack(alignment: .leading, spacing: 0) {
            heading

            Spacer().frame(height: TDWidgetMetrics.compactTitleGap)

            if rows.isEmpty {
                VStack(alignment: .leading, spacing: TDSpace.xs) {
                    Text("今天没有安排课程")
                        .font(TDFont.bodyStrong)
                        .foregroundStyle(TDColor.text(scheme))
                    Text("课程表里今天这一列为空。")
                        .font(TDFont.caption)
                        .foregroundStyle(TDColor.tertiaryText(scheme))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                let schedule = SnapshotDerive.daySchedule(rows: rows, now: entry.date)
                ViewThatFits(in: .vertical) {
                    ForEach(Self.candidates(isFinished: schedule.isFinished), id: \.self) { candidate in
                        lessonStack(
                            rows: rows,
                            schedule: schedule,
                            capacity: candidate.capacity,
                            showsFinishedNote: candidate.showsFinishedNote
                        )
                    }
                }
                // 列表之后的剩余高度全部落在这里（列表从上往下排，不强行垂直居中）
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetContentPadding(family)
    }

    /* ---------- 标题 ---------- */

    /// 标题行：「今日课程」（主角）+ 日期（辅助）。
    ///
    /// 日期用 `ViewThatFits` 挑长度（规格 §十四 / §十五）：
    ///   ① 先试「周四 · 10月1日」；② 放不下退到「10月1日」；③ 再放不下就只留标题。
    /// 三级都**不出现省略号**——宁可少显示一段信息，也不出现「周四 · 1...」。
    private var heading: some View {
        ViewThatFits(in: .horizontal) {
            WidgetHeading(title: "今日课程", trailing: .date(SnapshotDerive.dateLine(of: entry.date)))
            WidgetHeading(title: "今日课程", trailing: .date(SnapshotDerive.shortDateLine(of: entry.date)))
            WidgetHeading(title: "今日课程", trailing: nil)
        }
    }

    /* ---------- 课程列表 ---------- */

    /// 一档候选：显示前 `capacity` 行（`Int.max` = 全部），放不下的部分用一句话说出来
    ///
    /// `showsFinishedNote` 只在**整天已经上完**且这一档还放得下时才画那行状态
    /// （规格 §二十一：一行小字，不是大横幅；而且它永远不许挤掉一节课）。
    @ViewBuilder
    private func lessonStack(
        rows: [(period: SnapshotPeriod, lesson: SnapshotLesson)],
        schedule: SnapshotDerive.DaySchedule,
        capacity: Int,
        showsFinishedNote: Bool
    ) -> some View {
        let shown = rows.count <= capacity ? rows : Array(rows.prefix(capacity))
        let hidden = rows.count - shown.count

        VStack(alignment: .leading, spacing: TDWidgetMetrics.lessonRowGap) {
            ForEach(Array(shown.enumerated()), id: \.element.period.id) { index, row in
                lessonRow(row: row, moment: schedule.moments[index])
            }
            if hidden > 0 {
                Text("还有 \(hidden) 节")
                    .font(TDFont.caption)
                    .foregroundStyle(TDColor.faintText(scheme))
            }
            if showsFinishedNote && schedule.isFinished {
                Text("今日课程已结束")
                    .font(TDFont.caption)
                    .foregroundStyle(TDColor.faintText(scheme))
                    .padding(.top, 1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 一行课：节次（辅助）+ 班级（主信息），**当前 / 下一节**按级别做轻量强调。
    ///
    /// 三档（规格 §十七 / §十八 / §十九）：
    ///   · **当前** → 极淡主色行底 + 「当前」标签（主色底、主色字、semibold）
    ///   · **下一节** → 不加行底，只挂「下一节」标签（更淡的底、更轻的字重）
    ///   · **普通** → 什么都没有
    /// 行底用**负内边距**向外扩 6pt，所以有强调和没强调的行，文字都落在同一根竖线上。
    /// **不引入新颜色**（全部取自 `TDColor` 的主色 / 淡填充），也不显示任何时刻或倒计时。
    @ViewBuilder
    private func lessonRow(
        row: (period: SnapshotPeriod, lesson: SnapshotLesson),
        moment: SnapshotDerive.Moment
    ) -> some View {
        let isCurrent = moment == .current
        let isNext = moment == .next

        HStack(alignment: .firstTextBaseline, spacing: TDSpace.sm) {
            Text(row.period.shortLabel)
                .font(TDFont.periodLabel)
                .foregroundStyle(isCurrent ? TDColor.primary(scheme) : TDColor.tertiaryText(scheme))
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .frame(width: Self.periodWidth, alignment: .leading)

            Text(SnapshotDerive.label(for: row.lesson))
                .font(TDFont.classLabel)
                .fontWeight(isCurrent ? .bold : .semibold)
                .foregroundStyle(TDColor.text(scheme))
                .lineLimit(1)
                // 班级名过长 → 先缩字号再截断（规格 §三十二：不撑破整体布局）
                .truncationMode(.tail)
                .minimumScaleFactor(0.8)
                .layoutPriority(1)

            // 标签**紧跟在班级名后面**：早先放在行尾（靠 Spacer 顶到最右）时，
            // 实际渲染出来像是标题行的一部分，跟"哪一节课"对不上（预览里一眼就看出来了）。
            if isCurrent {
                momentChip("当前", level: .current)
            } else if isNext {
                momentChip("下一节", level: .next)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 1)
        .background(
            RoundedRectangle(cornerRadius: TDRadius.xs, style: .continuous)
                .fill(isCurrent ? TDColor.primaryWash(scheme) : Color.clear)
                .padding(.horizontal, -6)
                .padding(.vertical, -2)
        )
    }

    /// 「当前 / 下一节」小标签的级别——只有两档，且**下一节一定比当前弱**（规格 §十八）
    private enum ChipLevel { case current, next }

    @ViewBuilder
    private func momentChip(_ text: String, level: ChipLevel) -> some View {
        let emphasized = level == .current
        Text(text)
            .font(.system(size: 9, weight: emphasized ? .semibold : .medium))
            .foregroundStyle(
                emphasized
                    ? TDColor.primary(scheme)
                    : TDColor.primary(scheme).opacity(0.9)
            )
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(
                RoundedRectangle(cornerRadius: TDRadius.chip, style: .continuous)
                    .fill(emphasized ? TDColor.primarySoft(scheme) : TDColor.primaryWash(scheme))
            )
    }
}
