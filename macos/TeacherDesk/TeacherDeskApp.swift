//
//  TeacherDeskApp.swift —— 宿主 App（v3.7.2）
//
//  它的职责只有两件（规格 §四）：
//    ① **Widget 的运行容器**——WidgetKit 要求扩展装在一个 App 里；
//    ② **点击桥接**——Widget 用 `teacherdesk://open` 唤起它，它把 **TeacherDesk PWA** 打开/激活，
//       自己**不展示界面、不抢焦点**。
//
//  ## 点击链路为什么要经过这里（2026-10-01 实测结论）
//
//      widgetURL(https://…/work/schedule) → 实测落到 **Safari**（Chrome 的 PWA 应用壳
//      并没有注册为该网址的 URL 处理器），不是教师装的那个 PWA；而 v3.7.0 的兜底又会去打开
//      「名字里带 TeacherDesk 的 App」——那恰好是本宿主 App 自己，于是点完停在宿主界面上。
//
//  所以现在：**Widget → `teacherdesk://open` → 宿主 App → NSWorkspace 打开扫出来的 PWA**。
//  实测 `open -a "<PWA 显示名>"` 与 `open -b "<PWA bundle id>"` 在「PWA 已运行」时都会
//  **复用同一个实例**（PID 不变、窗口到前台），因此不会产生重复窗口（规格 §4.2）。
//
//  ## 为什么它变成「菜单栏 App」（.accessory）
//
//  规格 §4.1 要求「自己不展示额外页面」。只要它还是带窗口的普通 App，被深链唤起时就可能
//  闪一下自己的窗口——那正是要修掉的观感。改成 `.accessory`（无 Dock 图标、无窗口）之后，
//  深链唤起**完全不出现界面**；面板入口挪到菜单栏图标里（预览 / 诊断要用它）。
//
//  ## 调试用的几个无界面开关（`Tools/verify.sh` 用它们做命令行自检）
//
//      TeacherDesk --print-diagnostics        把诊断信息打到 stdout
//      TeacherDesk --export-widget-previews   把三种尺寸 × 深浅两色的 PNG 导到 ~/Downloads
//      TeacherDesk --export-widget-previews --export-dir <dir> --at <yyyy-MM-ddTHH:mm>
//      TeacherDesk --export-widget-previews --snapshot sample
//      TeacherDesk --export-widget-previews --snapshot-file <path>
//  全都在建窗口之前处理并退出，所以命令行里跑它们不会闪任何界面。
//

import AppKit
import SwiftUI
import WidgetKit

/// 进程级运行状态（App、菜单栏、深链共用）
@MainActor
final class HostRuntime {
    static let shared = HostRuntime()

    /// 面板窗口的 SwiftUI scene id
    static let panelWindowID = "main"

    /// 上一次「通知小组件刷新」的时刻（诊断面板显示 Last Refresh）
    private(set) var lastWidgetReload: Date?

    func noteWidgetReload() {
        lastWidgetReload = Date()
        UserDefaults.standard.set(lastWidgetReload, forKey: "lastWidgetReloadAt")
    }

    /// 上次刷新时刻（本次会话没有就取上次运行留下的）
    var lastReloadLabel: String {
        let date = lastWidgetReload
            ?? UserDefaults.standard.object(forKey: "lastWidgetReloadAt") as? Date
        guard let date else { return "本次启动以来未刷新" }
        return Self.stampFormatter.string(from: date)
    }

    static let stampFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()
}

/// 命令行（无界面）执行器：`Tools/verify.sh` 用它在命令行里验证「预览导出」与「诊断信息」
///
/// 进程刚起来、还没进 run loop 时就在主线程上跑，所以标 `@MainActor`（诊断信息要读主线程状态）。
@MainActor
enum HostHeadless {
    /// 跑完就退出（返回值即进程退出码）
    static func run(_ command: HostCommand) -> Never {
        // 建一个最小可用的 NSApplication：ImageRenderer / NSStatusBar 之前的准备工作都需要它，
        // 但**不建任何窗口**、也不进 run loop
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)

        switch command {
        case .printDiagnostics:
            FileHandle.standardOutput.write(Data(WidgetDiagnostics.text().utf8))
            exit(0)
        case let .exportPreviews(directory, now, useSample, snapshotFile):
            let urls = WidgetPreviewExporter.exportAll(
                now: now ?? Date(),
                directory: directory,
                useSample: useSample,
                snapshotFile: snapshotFile
            )
            FileHandle.standardOutput.write(Data(urls.map(\.path).joined(separator: "\n").utf8))
            exit(urls.isEmpty ? 1 : 0)
        }
    }
}

/// 无界面调试命令
enum HostCommand {
    case printDiagnostics
    /// 导出预览 PNG
    /// - directory: `--export-dir <path>`（自检脚本指到工作区内，绕开"下载"目录的 TCC 保护）
    /// - now: `--at <yyyy-MM-ddTHH:mm>` 指定"此刻"，用来核对「当前 / 下一节」的强调
    /// - useSample: `--snapshot sample` 用内置样例数据（规格 §八 允许的 debug 数据；
    ///   默认 `live`，永远读真实快照）
    /// - snapshotFile: `--snapshot-file <path>` 用指定的快照文件渲染（**只给长文本验收用**，
    ///   规格 §三十二：要拿超长课程名试排版，又不能改教师的真快照）
    case exportPreviews(directory: URL?, now: Date?, useSample: Bool, snapshotFile: URL?)

    static func parse(_ arguments: [String]) -> HostCommand? {
        if arguments.contains("--print-diagnostics") { return .printDiagnostics }
        if arguments.contains("--export-widget-previews") {
            var directory: URL?
            if let index = arguments.firstIndex(of: "--export-dir"), index + 1 < arguments.count {
                directory = URL(fileURLWithPath: arguments[index + 1], isDirectory: true)
            }
            var now: Date?
            if let index = arguments.firstIndex(of: "--at"), index + 1 < arguments.count {
                now = Self.parseStamp(arguments[index + 1])
            }
            let useSample = arguments.contains("sample")
                && (arguments.firstIndex(of: "--snapshot").map { $0 + 1 < arguments.count && arguments[$0 + 1] == "sample" } ?? false)
            var snapshotFile: URL?
            if let index = arguments.firstIndex(of: "--snapshot-file"), index + 1 < arguments.count {
                snapshotFile = URL(fileURLWithPath: arguments[index + 1])
            }
            return .exportPreviews(
                directory: directory,
                now: now,
                useSample: useSample,
                snapshotFile: snapshotFile
            )
        }
        return nil
    }

    /// 解析 `yyyy-MM-ddTHH:mm`（本地时区；解析不出来就返回 nil，退回到"此刻"）
    static func parseStamp(_ text: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return formatter.date(from: text)
    }
}

/// 进程入口。
///
/// 之所以不直接把 `TeacherDeskApp` 标成 `@main`：`SceneBuilder` **不支持** `if/else`
/// 选 Scene 类型（编译期就会报 "closure containing control flow statement cannot be used
/// with result builder 'SceneBuilder'"），而命令行开关又必须在**建窗口之前**处理掉。
/// 于是这里先判参数：是调试命令就直接跑完 `exit`（进程里连一个窗口都没被创建过），
/// 否则再交给 SwiftUI 的默认 `App.main()`。
@main
enum TeacherDeskMain {
    static func main() {
        if let command = HostCommand.parse(CommandLine.arguments) {
            HostHeadless.run(command)
        }
        TeacherDeskApp.main()
    }
}

/// SwiftUI 应用本体（真正的入口是上面的 `TeacherDeskMain`，所以这里**不**标 `@main`）
struct TeacherDeskApp: App {
    @NSApplicationDelegateAdaptor(HostAppDelegate.self) private var delegate

    /// 面板模型（普通存储属性，不需要任何属性包装器）
    private let model = HostModel()

    var body: some Scene {
        Window("TeacherDesk 小组件", id: HostRuntime.panelWindowID) {
            HostView(model: model)
                .frame(minWidth: 520, minHeight: 560)
        }
        .windowResizability(.contentSize)
        .defaultSize(width: 560, height: 760)
    }
}

/// App 级委托：深链、菜单栏入口、命令行命令
@MainActor
final class HostAppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    /// 本次启动是否是被深链唤起的（Widget 点击）——用它能区分「用户主动打开」与「点击桥接」
    private var handledDeepLink = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        // 菜单栏常驻：不占 Dock、不占窗口，只有一个小图标（面板入口）
        NSApp.setActivationPolicy(.accessory)
        installStatusItem()
        WidgetRefresher.reload()
        HostRuntime.shared.noteWidgetReload()

        // 启动后没被深链唤起 → 是用户**主动打开**的（双击 / `open -a`），给面板；
        // 被深链唤起（点小组件）就什么都不显示——那正是 v3.7.2 要修掉的观感（规格 §4.1）。
        // 深链稍晚才到时，`application(_:open:)` 里的 hideOwnWindows() 会把它收回去。
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            guard let self, !self.handledDeepLink else { return }
            HostLauncher.showPanel()
        }
    }

    /// 深链：`teacherdesk://open`（Widget 点击）/ `teacherdesk://refresh`（网页「同步并刷新」）
    func application(_ application: NSApplication, open urls: [URL]) {
        handledDeepLink = true
        for url in urls {
            switch TeacherDeskDeepLink.parse(url) {
            case .open, .unknown:
                HostLauncher.openTeacherDesk()
            case .refresh:
                WidgetRefresher.reload()
                HostRuntime.shared.noteWidgetReload()
            }
        }
        // 无论哪条深链，都不把自己的界面带到前台（规格 §4.1）
        hideOwnWindows()
    }

    /// 用户点菜单栏图标 → 打开面板
    @objc private func openPanel() {
        HostLauncher.showPanel()
    }

    /// 在访达里双击这个 App（或 `open -a TeacherDesk`）→ 打开面板
    ///
    /// 它现在是 `.accessory`（菜单栏 App），双击不会自动冒出窗口，所以显式处理：
    /// `showPanel()` 与菜单栏那一项是**同一条实现**，两条入口不会走岔。
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { HostLauncher.showPanel() }
        return true
    }

    @objc private func openTeacherDesk() {
        HostLauncher.openTeacherDesk()
    }

    @objc private func refreshWidgets() {
        WidgetRefresher.reload()
        HostRuntime.shared.noteWidgetReload()
    }

    @objc private func copyDiagnostics() {
        WidgetDiagnostics.copyToPasteboard()
    }

    private func installStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(
            systemSymbolName: "macwindow.on.rectangle",
            accessibilityDescription: "TeacherDesk 小组件"
        )
        let menu = NSMenu()
        menu.addItem(menuItem("打开小组件面板…", #selector(openPanel)))
        menu.addItem(menuItem("打开 TeacherDesk", #selector(openTeacherDesk)))
        menu.addItem(menuItem("刷新小组件", #selector(refreshWidgets)))
        menu.addItem(.separator())
        menu.addItem(menuItem("复制诊断信息", #selector(copyDiagnostics)))
        menu.addItem(.separator())
        menu.addItem(menuItem("退出", #selector(NSApplication.terminate(_:))))
        item.menu = menu
        statusItem = item
    }

    private func menuItem(_ title: String, _ action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }

    private func hideOwnWindows() {
        for window in NSApp.windows where window.canBecomeMain {
            window.orderOut(nil)
        }
        NSApp.hide(nil)
    }
}
