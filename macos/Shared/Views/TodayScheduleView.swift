//
//  TodayScheduleView.swift —— 今日课程（small / medium，v3.7.0）
//
//  视觉层级（规格 §二十五）：**主信息是主角，节次是辅助**。
//  所以每一行是「节次（小字、灰）+ 班级（大字、深色）」，而不是反过来。
//
//  v3.7.1：主信息从**科目**改成**班级**（`SnapshotDerive.label(for:)` 是唯一口径）。
//  理由来自真实使用：数学老师一天十节都是数学，逐行写「数学」等于没有信息，
//  「下一节去哪个班」才是要看的那件事。
//
//  ## 尺寸差异怎么处理（规格 §九）
//
//  规格要求 medium「显示当天完整课程」，而一个班一天最多 10 节（早自习 + 7 节 + 3 节晚自习），
//  在 medium 的高度里排 10 行是有余量的——但余量不多，而 small 只能放 5 行左右。
//  与其写死「medium 显示 10 行、small 显示 5 行」然后在某台机器上被裁掉最后一行，
//  这里用 **ViewThatFits** 让系统自己挑：从「全部」开始试，放不下就退到 8 / 6 / 4 …行，
//  退让时明确写出「还有 N 节」——**宁可少显示几行并说出来，也不能悄悄裁掉一行**
//  （被裁掉的那一行正是最后一节课，教师会以为今天早放学）。
//
//  节次用短名（「早自习」「第2节」「晚自习1」）：完整名「早自习及第一节」在小组件宽度里
//  会把科目挤没；规格也允许小组件不显示节次时间。
//
//  空态：今天真的没有课就说「今天没有安排课程」，**不伪造课程**（规格 §8.1）。
//
//  v3.7.2：加「当前 / 下一节」强调（`SnapshotDerive.moment`），只改今日课程，
//  不动一周课表；**不做倒计时、不显示时刻**（规格 §十三）。
//

import SwiftUI
import WidgetKit

struct TodayScheduleView: View {
    @Environment(\.colorScheme) private var scheme

    let entry: SnapshotEntry
    /// 由调用方给：Widget 传系统给的 `@Environment(\.widgetFamily)`，
    /// 宿主 App 的预览页传它要预览的尺寸（v3.7.2 §六：预览必须复用同一个 View）
    var family: WidgetFamily

    /// 退让阶梯：先试全部，再 8 / 6 / 4 / 3 / 2 / 1 行（`ViewThatFits` 取第一个放得下的）
    private static let capacities = [Int.max, 8, 6, 4, 3, 2, 1]

    var body: some View {
        Group {
            if let snapshot = entry.snapshot {
                content(snapshot: snapshot)
            } else {
                VStack(alignment: .leading, spacing: TDSpace.md) {
                    WidgetHeading(title: "今日课程", trailing: nil)
                    widgetNotice(
                        for: entry.read,
                        emptyTitle: "今天没有安排课程",
                        emptyDetail: "课程表里今天这一列为空。"
                    )
                }
            }
        }
        // 点击任意位置 → 打开 TeacherDesk（规格 §十八）
        .widgetURL(WidgetLinks.url(for: .today, in: entry.snapshot))
    }

    @ViewBuilder
    private func content(snapshot: WidgetSnapshot) -> some View {
        let rows = SnapshotDerive.lessons(in: snapshot, on: entry.date)
        VStack(alignment: .leading, spacing: TDSpace.sm) {
            WidgetHeading(
                title: "今日课程",
                trailing: SnapshotDerive.dateLine(of: entry.date)
            )

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
                    ForEach(Self.capacities, id: \.self) { capacity in
                        lessonStack(rows: rows, schedule: schedule, capacity: capacity)
                    }
                }
                // 让列表吃掉标题之外的全部高度，且从顶部开始排
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                if schedule.isFinished {
                    // 全天结束：只补一行状态，**不改整体结构**（规格 §十八）
                    Text("今日课程已结束")
                        .font(TDFont.caption)
                        .foregroundStyle(TDColor.faintText(scheme))
                }
            }
        }
    }

    /// 一档候选：显示前 `capacity` 行（`Int.max` = 全部），放不下的部分用一句话说出来
    @ViewBuilder
    private func lessonStack(
        rows: [(period: SnapshotPeriod, lesson: SnapshotLesson)],
        schedule: SnapshotDerive.DaySchedule,
        capacity: Int
    ) -> some View {
        let shown = rows.count <= capacity ? rows : Array(rows.prefix(capacity))
        let hidden = rows.count - shown.count

        VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(shown.enumerated()), id: \.element.period.id) { index, row in
                lessonRow(row: row, moment: schedule.moments[index])
            }
            if hidden > 0 {
                Text("还有 \(hidden) 节")
                    .font(TDFont.caption)
                    .foregroundStyle(TDColor.faintText(scheme))
                    .padding(.top, 1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 一行课：节次 + 班级，**当前 / 下一节**用同一套设计变量做轻量强调。
    ///
    /// 强调手法（规格 §十六 / §十七）：当前那一节给主色淡底 + 主色左边线 + 字重不变但更实，
    /// 后面挂一颗小小的「当前」；下一节只挂一颗「下一节」标签，不加底色。
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
                .font(TDFont.period)
                .foregroundStyle(isCurrent ? TDColor.primary(scheme) : TDColor.faintText(scheme))
                .lineLimit(1)
                .frame(width: 46, alignment: .leading)
            Text(SnapshotDerive.label(for: row.lesson))
                .font(.system(size: 13, weight: isCurrent ? .bold : .semibold))
                .foregroundStyle(TDColor.text(scheme))
                .lineLimit(1)
                // 班级名过长 → 截断（规格 §十七：不撑破整体布局）
                .truncationMode(.tail)
                .layoutPriority(1)
            // 标签**紧跟在班级名后面**：早先放在行尾（靠 Spacer 顶到最右）时，
            // 实际渲染出来像是标题行的一部分，跟"哪一节课"对不上（预览里一眼就看出来了）。
            if isCurrent {
                momentChip("当前", emphasized: true)
            } else if isNext {
                momentChip("下一节", emphasized: false)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, isCurrent ? 2 : 0)
        .padding(.horizontal, isCurrent ? 5 : 0)
        .background(
            RoundedRectangle(cornerRadius: TDRadius.xs, style: .continuous)
                .fill(isCurrent ? TDColor.primarySoft(scheme) : .clear)
        )
    }

    /// 「当前 / 下一节」小标签
    @ViewBuilder
    private func momentChip(_ text: String, emphasized: Bool) -> some View {
        Text(text)
            .font(.system(size: 9.5, weight: emphasized ? .bold : .medium))
            .foregroundStyle(emphasized ? Color.white : TDColor.primary(scheme))
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(
                RoundedRectangle(cornerRadius: TDRadius.xs, style: .continuous)
                    .fill(emphasized ? TDColor.primary(scheme) : TDColor.primaryWash(scheme))
            )
    }
}
