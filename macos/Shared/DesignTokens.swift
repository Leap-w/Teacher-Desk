//
//  DesignTokens.swift —— 设计变量（从 `src/styles/theme.css` 抄来，逐条注明出处）
//
//  Widget 是 SwiftUI 界面，不能把网页嵌进去（规格 §二十四），但它必须**看起来还是 TeacherDesk**。
//  所以这里把 Web 的设计变量按同一组名字、同一批取值抄一份，浅色 / 深色两套都给
//  （Web 侧同样有两套：`:root` 与 `[data-theme='dark']`）。
//
//  ⚠️ 这是一份**副本**，不是共享源。改 Web 主题色时这里要跟着改——
//  之所以不去读网页的 CSS：Widget 在沙盒里、不能访问 Web 的资源，为了几个颜色去搭一套
//  资源导出链路，比「两处各写一遍 + 注释里写明出处」贵得多（规格 §二十四：不要为了 Widget
//  重构 PWA）。排查「Widget 颜色怪怪的」时，第一件事就是拿这里与 theme.css 对一遍。
//

import SwiftUI

/// TeacherDesk 的颜色（浅色 / 深色各一套，取自 `src/styles/theme.css`）
enum TDColor {
    // ===== 浅色（theme.css 的 :root）=====
    static let primaryLight = Color(hex: 0x4A8C94) // --color-primary
    static let primaryDark = Color(hex: 0x5AA7AF) // [data-theme='dark'] --color-primary（暗底提亮一档）
    static let successLight = Color(hex: 0x6B9E85) // --color-success
    static let successDark = Color(hex: 0x7FB497)
    static let warningLight = Color(hex: 0xE8B04C) // --color-warning
    static let textLight = Color(hex: 0x101820) // --color-text-primary
    static let textDark = Color(hex: 0xF4F6F7)
    static let secondaryLight = Color(hex: 0x5F6F71) // --color-text-secondary
    static let secondaryDark = Color(hex: 0xA3ADB7)
    static let tertiaryLight = Color(hex: 0x67767A) // --color-text-tertiary
    static let tertiaryDark = Color(hex: 0x9AA5AD)
    static let faintLight = Color(hex: 0x7D8D8F) // --color-text-faint
    static let faintDark = Color(hex: 0x8A959E)
    static let cardLight = Color(hex: 0xFFFFFF) // --bg-card
    static let cardDark = Color(hex: 0x1B1E20)
    static let pageLight = Color(hex: 0xF8FAFB) // --bg-page
    static let pageDark = Color(hex: 0x111315)

    /// 主色（随深浅色切换）
    static func primary(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? primaryDark : primaryLight
    }

    /// 主色的低透明度底（`--color-primary-soft`：浅色 12% / 深色 16%）
    static func primarySoft(_ scheme: ColorScheme) -> Color {
        primary(scheme).opacity(scheme == .dark ? 0.16 : 0.12)
    }

    /// 「今天」这一列 / 这一行的强调底（比 primarySoft 更淡；`--color-primary-bg` 6% / 8%）
    static func primaryWash(_ scheme: ColorScheme) -> Color {
        primary(scheme).opacity(scheme == .dark ? 0.08 : 0.06)
    }

    static func success(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? successDark : successLight
    }

    /// 卡片底（`--bg-card`：浅色纯白 / 深色 #1B1E20）——宿主面板的窗口底色用它
    static func card(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? cardDark : cardLight
    }

    static func text(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? textDark : textLight
    }

    static func secondaryText(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? secondaryDark : secondaryLight
    }

    static func tertiaryText(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? tertiaryDark : tertiaryLight
    }

    static func faintText(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? faintDark : faintLight
    }

    /// 分隔线（`--color-border-light`：浅色 rgba(15,23,42,.05) / 深色 rgba(244,246,247,.06)）
    static func hairline(_ scheme: ColorScheme) -> Color {
        scheme == .dark
            ? Color.white.opacity(0.06)
            : Color(hex: 0x0F172A).opacity(0.05)
    }

    /// 淡填充（`--color-fill-disabled` 4% / 6%）
    static func fill(_ scheme: ColorScheme) -> Color {
        scheme == .dark
            ? Color.white.opacity(0.06)
            : Color(hex: 0x0F172A).opacity(0.04)
    }
}

/// 间距（theme.css 的 8pt 网格：4 / 8 / 12 / 16 / 24）
enum TDSpace {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
}

/// 圆角（theme.css：--radius-xs 8 / --radius-sm 12 / --radius-md 16 / --radius-full 9999）
enum TDRadius {
    static let xs: CGFloat = 8
    static let sm: CGFloat = 12
    static let md: CGFloat = 16
    static let full: CGFloat = 9999
}

/// 字号（theme.css：--font-caption 12 / --text-sm 13 / --text-md 14 / --text-lg 17 / --text-xl 22）
enum TDFont {
    static let caption = Font.system(size: 11, weight: .regular)
    static let small = Font.system(size: 12, weight: .regular)
    static let body = Font.system(size: 13, weight: .regular)
    static let bodyStrong = Font.system(size: 13, weight: .semibold)
    static let title = Font.system(size: 15, weight: .semibold)
    static let period = Font.system(size: 11, weight: .medium)
}

extension Color {
    /// 16 进制 → Color（设计变量是一串 `#4A8C94`，这里不做字符串解析，直接给整数）
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
