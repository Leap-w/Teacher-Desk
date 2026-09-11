//
//  DesignTokens.swift —— 松石青设计变量（**逐条抄自 Web 的 src/styles/theme.css**）
//
//  为什么要手抄一遍而不是「看起来像就行」：Widget 与 Web 会并排出现在同一块屏幕上
//  （教师左边开着工作台、右边挂着 Widget），绿色差一点点都看得出来。
//  这里每个值都标了 Web 侧的变量名，改的时候对着改。
//
//  ⚠️ **本文件不含任何布局**，只有颜色、圆角、间距、字号四组数值。
//  尺寸相关的取舍（哪些信息在 Small 尺寸下砍掉）在各个视图里就近决定。
//

import SwiftUI

// MARK: - 颜色（出处：theme.css 的 --color-* / --bg-main）

extension Color {
    /// 从 `#RRGGBB` 构造。Web 侧的变量是十六进制字面量，这里保持同一份写法，
    /// 免得转成小数值之后两边对不上还看不出来。
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }

    /// 从 `#RRGGBB` + 透明度构造（Web 侧的 `--color-primary-soft` 这类是 rgba 字面量）
    init(hex: UInt32, opacity: Double) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

enum TDColor {
    // ===== 品牌色（松石青）=====
    /// `--color-primary`
    static let primary = Color(hex: 0x2F8F83)
    /// `--color-primary-strong`
    static let primaryStrong = Color(hex: 0x25766C)
    /// `--color-primary-soft`（rgba(47, 143, 131, 0.12)）
    static let primarySoft = Color(hex: 0x2F8F83, opacity: 0.12)
    /// `--color-secondary`
    static let secondary = Color(hex: 0x5AAEA2)

    // ===== 功能色 =====
    /// `--color-success`
    static let success = Color(hex: 0x34C759)
    /// `--color-success-strong`
    static let successStrong = Color(hex: 0x217A3C)
    /// `--color-warning`
    static let warning = Color(hex: 0xFF9F0A)
    /// `--color-warning-strong`
    static let warningStrong = Color(hex: 0xB26A00)

    // ===== 中性色 =====
    /// `--color-text`
    static let text = Color(hex: 0x1D1D1F)
    /// `--color-text-secondary`
    static let textSecondary = Color(hex: 0x6E6E73)
    /// `--color-text-faint`
    static let textFaint = Color(hex: 0xA1A1A6)
    /// `--color-border`（rgba(29, 29, 31, 0.08)）
    static let border = Color(hex: 0x1D1D1F, opacity: 0.08)
    /// `--color-border-strong`（rgba(29, 29, 31, 0.14)）
    static let borderStrong = Color(hex: 0x1D1D1F, opacity: 0.14)
}

// MARK: - 字号（出处：theme.css 的 --text-*）
//
// Widget 里的字号不能照搬 Web 的 px：同一个 13px 在系统字体下与 Widget 环境的观感不同，
// 而且 WidgetKit 会跟随系统字号。所以这里按**语义**给出（标题 / 正文 / 说明 / 角标），
// 用 SwiftUI 的语义字号，让「随系统设置放大」这件事由系统负责。
// 括号里是对应的 Web 变量，仅表示层级关系，不是像素值。

enum TDFont {
    /// 卡片主标题（对应 `--text-lg` 一档的层级）
    static let title = Font.headline
    /// 主要信息（对应 `--text-md`）
    static let body = Font.body
    /// 主要信息加粗（课程名、人数这类要一眼看到的）
    static let bodyStrong = Font.body.weight(.semibold)
    /// 次要说明（对应 `--text-sm`）
    static let caption = Font.caption
    /// 角标 / 小字（对应 `--text-xs`）
    static let footnote = Font.caption2
    /// 大数字（在读人数这种一眼要读到的）
    static let metric = Font.title2.weight(.bold)
}

// MARK: - 圆角与间距（出处：theme.css 的 --radius-* / --space-*）

enum TDMetric {
    /// `--radius-sm` = 8px
    static let radiusSmall: CGFloat = 8
    /// `--radius-md` = 12px
    static let radiusMedium: CGFloat = 12
    /// `--radius-lg` = 16px
    static let radiusLarge: CGFloat = 16

    /// `--space-1` = 4px
    static let space1: CGFloat = 4
    /// `--space-2` = 8px
    static let space2: CGFloat = 8
    /// `--space-3` = 12px
    static let space3: CGFloat = 12
    /// `--space-4` = 16px
    static let space4: CGFloat = 16
    /// `--space-5` = 20px
    static let space5: CGFloat = 20
}
