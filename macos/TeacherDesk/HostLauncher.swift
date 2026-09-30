//
//  HostLauncher.swift —— 把「打开 TeacherDesk」这一件事做对（v3.7.2）
//
//  规格 §四 的六条职责全在这里：
//    ① 接收 Widget 点击（由 `HostAppDelegate` 的深链转到这）
//    ② 用**实际扫出来的** PWA bundle id / 路径（`PWALocator`，不硬编码）
//    ③ 调 `NSWorkspace`
//    ④ 启动 / 激活 PWA
//    ⑤ 自己不展示额外页面（宿主是 `.accessory`，深链路径上不建窗口）
//    ⑥ 尽快隐藏（`NSApp.hide`）
//
//  实测（2026-10-01，本机）：
//    · PWA 已运行 → `openApplication(at:)` 把它带到前台，**PID 不变**（复用同一实例，规格 §4.2）
//    · PWA 未运行 → 冷启动后成为前台应用（规格测试 1/2）
//    · `open <https 网址>` → 落到 Safari，**不是** PWA（所以不能靠网址跳）
//

import AppKit
import Foundation
import SwiftUI
import WidgetKit

enum HostLauncher {
    /// 打开（或激活）TeacherDesk PWA。
    ///
    /// 三级退路，逐级降级但仍然**一定是 TeacherDesk**（不会打开别的 App、也不会停在本宿主界面上）：
    ///   ① 扫出来的 PWA 应用壳（`NSWorkspace.openApplication`，复用已运行的实例）
    ///   ② 按 bundle id 再试一次（`open -b` 等价路径；壳被挪过位置时仍可能命中注册表里的记录）
    ///   ③ 交给系统打开快照里的网址（本机实测会落到 Safari——是 TeacherDesk，但不是 PWA 窗口）
    @discardableResult
    static func openTeacherDesk() -> String {
        let snapshot = SnapshotStore.read()
        let baseURL: String? = {
            if case let .ok(value) = snapshot { return value.pwaBaseUrl }
            return nil
        }()

        guard let pwa = PWALocator.locateTeacherDesk(
            pwaBaseURL: baseURL,
            fallbackHost: Self.fallbackHost
        ) else {
            return openInBrowser(baseURL: baseURL)
        }

        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.openApplication(at: pwa.path, configuration: configuration) { _, error in
            if error != nil {
                // ① 失败：按 bundle id 再试（等价于 `open -b`）
                Task { @MainActor in openByBundleID(pwa) }
            }
        }
        return "PWA: \(pwa.name) [\(pwa.bundleID)]"
    }

    /// 按 bundle id 打开（`open -b` 的等价实现）
    @MainActor
    private static func openByBundleID(_ pwa: InstalledWebApp) {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: pwa.bundleID)
        else { return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.openApplication(at: url, configuration: configuration)
    }

    /// 最后一级退路：用默认浏览器打开网址（仍是 TeacherDesk，只是不是 PWA 窗口）
    private static func openInBrowser(baseURL: String?) -> String {
        let text = (baseURL?.isEmpty == false ? baseURL! : "https://\(fallbackHost)") + "/work/schedule/"
        if let url = URL(string: text) { NSWorkspace.shared.open(url) }
        return "浏览器: \(text)"
    }

    /// 打开宿主面板（菜单栏图标调用；**只有用户主动点才会出现界面**）
    @MainActor
    static func showPanel() {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        // SwiftUI 的 Window scene：先试着按标识取，取不到就取第一个可成为主窗口的窗口
        let window =
            NSApp.windows.first { $0.identifier?.rawValue == HostRuntime.panelWindowID }
            ?? NSApp.windows.first { $0.canBecomeMain }
        window?.makeKeyAndOrderFront(nil)
    }

    /// 内置的线上域名（只在快照没有地址时用于**匹配**应用壳；不是路径也不是 bundle id）
    static let fallbackHost = "teacher-desk-d6gdsgqb8f9dc13d2-1454430270.tcloudbaseapp.com"
}

/// 「让小组件立刻重画」——`teacherdesk://refresh` 与菜单栏「刷新小组件」共用
///
/// （深链的**解析**在 `Shared/DeepLink.swift`，那是纯逻辑、也归冒烟测试钉；
///  这里只做需要 WidgetKit 的那一下。）
enum WidgetRefresher {
    static func reload() {
        WidgetCenter.shared.reloadAllTimelines()
    }
}
