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

    // ===== Widget 自己的底色（v3.7.3）=====
    //  为什么要跟 `card` 分开：面板是**网页式的卡片**，用纯白没问题；
    //  而小组件是贴在教师壁纸上的，纯白在深色壁纸上会像一块灯箱。
    //  所以浅色退一档到 #FAFBFC（几乎看不出，但不再刺眼），深色保持 #1B1E20。
    //  **两块都是纯色**：规格 §二十四 不许渐变、不许图片——渐变在桌面上会被读成「装饰」。
    static let widgetBackgroundLight = Color(hex: 0xFAFBFC)
    static let widgetBackgroundDark = Color(hex: 0x1B1E20)

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

    /// 空课程那个「—」的颜色（v3.7.3）
    ///
    /// 为什么不直接用 `faintText`：深色下 faint(#8A959E) 与节次的 tertiary(#9AA5AD)
    /// **几乎同一个灰**，于是「一片 —」看起来和节次一样重要，整张表只剩一种灰度
    /// ——规格 §二十三 要的正是「把四级灰拉开」。所以这一级单独定，比节次再退一档。
    static func widgetEmptyMark(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x6C767E) : Color(hex: 0xA3AEB0)
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

    /// Widget 内部的小元素圆角（v3.7.3）：**比 Web 的 8 更小**。
    /// 小组件里的胶囊越小越像「状态」，越大的圆角越像「网页按钮」——
    /// 桌面截图里那一片圆角块，很大一部分就是 8 在 11pt 高的格子上显得太圆。
    static let chip: CGFloat = 6
}

/// 字号（theme.css：--font-caption 12 / --text-sm 13 / --text-md 14 / --text-lg 17 / --text-xl 22）
enum TDFont {
    static let caption = Font.system(size: 11, weight: .regular)
    static let small = Font.system(size: 12, weight: .regular)
    static let body = Font.system(size: 13, weight: .regular)
    static let bodyStrong = Font.system(size: 13, weight: .semibold)
    static let title = Font.system(size: 15, weight: .semibold)
    static let period = Font.system(size: 11, weight: .medium)

    // ===== Widget 专用字级（v3.7.3）=====
    //  规则：**层级靠字号 + 字重 + 灰度三件事一起做**，不靠给每块数据加背景（规格 §二）。
    //  一周课表里真正需要「一眼扫到」的只有班级，所以只有它是 semibold 的实心文字。

    /// Widget 标题（「今日课程」「一周课程表」）——最高层级
    static let widgetTitle = Font.system(size: 15, weight: .semibold)
    /// 今日课程右侧的日期——二级（辅助但不该看不清）
    static let widgetDate = Font.system(size: 12, weight: .medium)
    /// 一周课程表右侧的同步时刻——三级（**明显低于标题**，规格 §六）
    static let widgetSync = Font.system(size: 11, weight: .regular)
    /// 星期标题
    static let weekday = Font.system(size: 11, weight: .medium)
    /// 节次短名（「早自习」「第2节」「晚自习3」）——辅助层级
    static let periodLabel = Font.system(size: 10, weight: .medium)
    /// 今日课程列表里的班级——主信息
    static let classLabel = Font.system(size: 13, weight: .semibold)
    /// 「当前 / 下一节」小标签
    static let chip = Font.system(size: 9, weight: .semibold)
}

/// Widget 的版心与呼吸（v3.7.3 视觉精修）
///
/// 数值集中在这里的理由：**Preview 与真机必须是同一套数字**（规格 §三十）。
/// 系统的内容边距被关掉了（`contentMarginsDisabled()`，见 `TeacherDeskWidgets.swift`），
/// 于是「留多少白」这件事只有这一处说了算，预览里量到多少、桌面上就是多少。
enum TDWidgetMetrics {
    /// small 的版心（170×170，四周都紧）
    static let smallPadding: CGFloat = 12
    /// medium / large 的版心
    static let regularPadding: CGFloat = 16
    /// 标题与下一块之间的固定间距（一周课程表：标题 → 星期）
    static let titleGap: CGFloat = 12
    /// 今日课程的标题间距——比 large 小 2pt：small / medium 只有 170pt 高，
    /// 那 2pt 直接决定「当天第 5 节课还能不能留在列表里」（规格 §二十八）
    static let compactTitleGap: CGFloat = 10
    /// 星期标题与课程表之间的固定间距
    static let headerGap: CGFloat = 6
    /// 今日课程列表里每行之间的间距
    ///
    /// 定成 3（与 v3.7.2 同值）不是偷懒：medium / small 都只有 170pt 高，
    /// 每行多 1pt，一天 5 节课就吃掉 5pt——正好是「第 5 节还能不能显示」的那点余量。
    /// 想让它更透气，得先动版心或标题，而不是偷偷把这一行挤掉。
    static let lessonRowGap: CGFloat = 3
    /// 课程表里「节次列」的宽度：够放「晚自习3」四个字
    static let periodColumnWidth: CGFloat = 44
    /// 课程表里格与格之间的横向间距
    static let gridColumnGap: CGFloat = 4
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
