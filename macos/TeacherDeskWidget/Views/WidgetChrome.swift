//
//  WidgetChrome.swift —— 两个 Widget 共用的外壳（v3.7.0）
//
//  三件事在这里各写一次，不许在各自的 View 里再写一遍：
//    · 背景（`containerBackground` 用的那份，浅色 / 深色都跟着系统走，规格 §二十三）
//    · 标题行（左边名称、右边一句状态：同步时刻 / 或空态说明）
//    · 四态空壳（还没同步 / 数据坏了 / 格式太新 —— 三种说法**必须不一样**）
//
//  最后一条是照搬 Web 侧存储层的口径：把「读不出来」说成「今天没有课」，
//  教师就会以为今天真没课——而真相是他的快照坏了。
//

import SwiftUI

/// Widget 背景：跟系统深浅色走，不强制白底（规格 §二十三）
struct WidgetBackground: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        // 纯色 + 一点极淡的主色光晕：与 Web 端「页面底 #F8FAFB / 卡片纯白」同一个观感，
        // 又不至于像一张廉价的纯白信息卡
        ZStack {
            (scheme == .dark ? TDColor.cardDark : TDColor.cardLight)
            RadialGradient(
                colors: [TDColor.primary(scheme).opacity(scheme == .dark ? 0.16 : 0.10), .clear],
                center: .topLeading,
                startRadius: 2,
                endRadius: 220
            )
        }
    }
}

/// 标题行：左「名称」右「状态一句话」
struct WidgetHeading: View {
    @Environment(\.colorScheme) private var scheme

    let title: String
    let trailing: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(TDFont.title)
                .foregroundStyle(TDColor.text(scheme))
            Spacer(minLength: TDSpace.sm)
            if let trailing {
                Text(trailing)
                    .font(TDFont.caption)
                    .foregroundStyle(TDColor.faintText(scheme))
                    .lineLimit(1)
            }
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
                .foregroundStyle(warn ? Color(hex: 0xE8B04C) : TDColor.primary(scheme))
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
