//
//  WidgetChrome.swift —— 两个 Widget 共用的外壳（v3.7.0，v3.7.3 视觉精修）
//
//  四件事在这里各写一次，不许在各自的 View 里再写一遍：
//    · 背景（`containerBackground` 用的那份，浅色 / 深色都跟着系统走，规格 §二十四）
//    · 版心（四周留白——**预览与真机共用的唯一一处数字**，规格 §三十）
//    · 标题行（左边名称、右边一句次级信息：日期 / 同步时刻）
//    · 四态空壳（还没同步 / 数据坏了 / 格式太新 —— 三种说法**必须不一样**）
//
//  最后一条是照搬 Web 侧存储层的口径：把「读不出来」说成「今天没有课」，
//  教师就会以为今天真没课——而真相是他的快照坏了。
//
//  ## v3.7.3 改了什么
//
//  ① **背景去掉那层径向渐变**（规格 §二十四 明令：不要渐变 / 不要图片）。小组件是贴在
//     教师自己壁纸上的，它该安静地待着，而不是自带一层「卡片光晕」。
//     现在是一块极浅的中性底：浅色 #FAFBFC（**不是纯白**，纯白在深色壁纸上像块灯箱）、
//     深色 #1B1E20。两边都是纯色，所以预览渲出来和桌面上是同一个东西。
//  ② **标题行分了两级**：`date`（今日课程右侧，12pt medium，二级）与
//     `sync`（一周课表右侧，11pt regular + 更低的对比度，三级）。
//     规格 §六 特意点名：「同步于 10月1日 01:21」这种长句不该跟标题抢焦点。
//  ③ 版心集中到 `TDWidgetMetrics`，并用 `contentMarginsDisabled()` 关掉系统那层默认边距——
//     否则「系统的 16 + 自己的 16」会叠成 32，而预览里只有自己的 16（规格 §三十）。
//

import SwiftUI
import WidgetKit

/// Widget 背景：一块**纯色**，跟系统深浅色走（规格 §二十四：不加渐变、不加图片）
struct WidgetBackground: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        scheme == .dark
            ? TDColor.widgetBackgroundDark
            : TDColor.widgetBackgroundLight
    }
}

/// 标题行右侧那句话的**级别**（决定字号、字重、灰度——三种都不同）
enum WidgetHeadingTrailing {
    /// 今日课程右侧的日期（「周四 · 10月1日」）：二级辅助信息
    case date(String)
    /// 一周课程表右侧的同步时刻（「01:21 同步」）：三级，**明显低于标题**
    case sync(String)

    var text: String {
        switch self {
        case let .date(value), let .sync(value): return value
        }
    }
}

/// 标题行：左「名称」右「一句次级信息」
///
/// 两条纪律（规格 §六 / §十三）：
///   · 标题永远是这一行里最重的——字大、字重高、用主文字色；
///   · 右侧那句**按级别取字号与灰度**，且 `fixedSize(horizontal:)` 保证它不被压成省略号
///     （Medium 的「周四 · 1...」就是这么来的，规格 §十四 禁止用 truncationMode 掩盖）。
struct WidgetHeading: View {
    @Environment(\.colorScheme) private var scheme

    let title: String
    let trailing: WidgetHeadingTrailing?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TDSpace.sm) {
            Text(title)
                .font(TDFont.widgetTitle)
                .foregroundStyle(TDColor.text(scheme))
                .lineLimit(1)
            Spacer(minLength: TDSpace.sm)
            if let trailing {
                Text(trailing.text)
                    .font(font(for: trailing))
                    .foregroundStyle(color(for: trailing))
                    .lineLimit(1)
                    // 右侧这句话**宁可把标题挤瘦，也不许自己出省略号**
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
    }

    private func font(for trailing: WidgetHeadingTrailing) -> Font {
        switch trailing {
        case .date: return TDFont.widgetDate
        case .sync: return TDFont.widgetSync
        }
    }

    private func color(for trailing: WidgetHeadingTrailing) -> Color {
        switch trailing {
        case .date: return TDColor.secondaryText(scheme)
        case .sync: return TDColor.faintText(scheme)
        }
    }
}

/// 空态 / 异常态外壳：图标 + 一句话 + 一句补充
struct WidgetNotice: View {
    @Environment(\.colorScheme) private var scheme

    let symbol: String
    let title: String
    let detail: String
    /// 主色（正常空态）还是警示色（数据坏了）
    let warn: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TDSpace.sm) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(warn ? TDColor.warningLight : TDColor.primary(scheme))
            Text(title)
                .font(TDFont.bodyStrong)
                .foregroundStyle(TDColor.text(scheme))
            Text(detail)
                .font(TDFont.small)
                .foregroundStyle(TDColor.secondaryText(scheme))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// `SnapshotRead` → 该显示什么（四态文案的唯一出处）
@ViewBuilder
func widgetNotice(for read: SnapshotRead, emptyTitle: String, emptyDetail: String) -> some View {
    switch read {
    case .missing:
        WidgetNotice(
            symbol: "square.and.arrow.down",
            title: "还没有课程数据",
            detail: "打开 TeacherDesk → 课程表 →「连接小组件」，同步一次即可。",
            warn: false
        )
    case .broken:
        WidgetNotice(
            symbol: "exclamationmark.triangle",
            title: "课程数据读不出来",
            detail: "快照文件在，但内容解析失败。到 TeacherDesk 课程表页点一次「仅同步」重写。",
            warn: true
        )
    case let .unsupported(version):
        WidgetNotice(
            symbol: "arrow.up.circle",
            title: "请更新这个小组件",
            detail: "课程数据格式已升级到 v\(version)，当前小组件只认 v\(widgetSnapshotSchemaVersion)。",
            warn: true
        )
    case .ok:
        WidgetNotice(symbol: "calendar", title: emptyTitle, detail: emptyDetail, warn: false)
    }
}

/// 版心：Widget 四周的留白（**唯一出处**，规格 §三十）
///
/// 之所以要自己留白而不是吃系统的默认边距：`contentMarginsDisabled()` 关掉系统那层之后，
/// 「留多少」就只剩这一处数字，预览与桌面上量到的完全一致。
extension View {
    func widgetContentPadding(_ family: WidgetFamily) -> some View {
        let inset = family == .systemSmall ? TDWidgetMetrics.smallPadding : TDWidgetMetrics.regularPadding
        return padding(.horizontal, inset).padding(.vertical, inset)
    }
}
