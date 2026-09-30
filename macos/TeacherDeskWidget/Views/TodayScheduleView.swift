//
//  TodayScheduleView.swift —— 今日课程（small / medium，v3.7.0）
//
//  视觉层级（规格 §二十五）：**科目是主角，节次是辅助**。
//  所以每一行是「节次（小字、灰）+ 科目（大字、深色）」，而不是反过来。
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

import SwiftUI
import WidgetKit

struct TodayScheduleView: View {
    @Environment(\.colorScheme) private var scheme

    let entry: SnapshotEntry

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
                ViewThatFits(in: .vertical) {
                    ForEach(Self.capacities, id: \.self) { capacity in
                        lessonStack(rows: rows, capacity: capacity)
                    }
                }
                // 让列表吃掉标题之外的全部高度，且从顶部开始排
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
    }

    /// 一档候选：显示前 `capacity` 行（`Int.max` = 全部），放不下的部分用一句话说出来
    @ViewBuilder
    private func lessonStack(
        rows: [(period: SnapshotPeriod, lesson: SnapshotLesson)],
        capacity: Int
    ) -> some View {
        let shown = rows.count <= capacity ? rows : Array(rows.prefix(capacity))
        let hidden = rows.count - shown.count

        VStack(alignment: .leading, spacing: 3) {
            ForEach(shown, id: \.period.id) { row in
                HStack(alignment: .firstTextBaseline, spacing: TDSpace.sm) {
                    Text(row.period.shortLabel)
                        .font(TDFont.period)
                        .foregroundStyle(TDColor.faintText(scheme))
                        .lineLimit(1)
                        .frame(width: 46, alignment: .leading)
                    Text(row.lesson.subject)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(TDColor.text(scheme))
                        .lineLimit(1)
                        // 科目过长 → 截断（规格 §十七：不撑破整体布局）
                        .truncationMode(.tail)
                    Spacer(minLength: 0)
                }
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
}
