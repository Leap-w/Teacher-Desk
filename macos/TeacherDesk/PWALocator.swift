//
//  PWALocator.swift —— 找这台 Mac 上**实际安装**的 TeacherDesk PWA（v3.7.2）
//
//  为什么需要它：WidgetKit 的 `widgetURL` 只能交给系统去打开一个 URL，而实测（2026-10-01）
//  证明「打开 https 网址」在本机落到的是 **Safari**，不是 Chrome 装的那个 PWA——
//  Chrome 的 PWA 应用壳（`app_mode_loader`）**没有**把自己注册成该网址的 URL 处理器。
//  所以点击链路必须经由宿主 App：
//
//      Widget ──teacherdesk://open──▶ 宿主 App ──NSWorkspace 打开「PWA 应用」──▶ PWA 到前台
//
//  规格 §4.1 明确禁止硬编码猜测 bundle id / 安装路径（例如
//  `com.google.Chrome.app.TeacherDesk` 或 `/Applications/TeacherDesk.app`），
//  所以这里**扫出来**：遍历应用目录里的 `.app`，读它们的 Info.plist，
//  按 `CrAppModeShortcutURL`（Chrome / Edge / Brave 系应用壳都写这个键）或任意
//  http(s) 字符串字段与目标地址比对。
//
//  本机实测（2026-10-01）：
//    Display Name : TeacherDesk · 班主任工作台
//    Bundle ID    : com.google.Chrome.app.hhbpeacabhcmkepnkdnhckppijlfbbng
//    Path         : /Applications/TeacherDesk · 班主任工作台.app
//    CrAppModeShortcutURL : https://teacher-desk-…tcloudbaseapp.com/
//  ——以上都是**扫出来的结果**，不是写死的常量；换机器、换浏览器、换安装位置都不用改代码。
//

import AppKit
import Foundation

/// 一个「安装在本机的 Web 应用（PWA / Chrome 应用壳）」
struct InstalledWebApp {
    /// 显示名（`CFBundleName`），用于 `open -a` 与诊断面板
    let name: String
    /// `CFBundleIdentifier`，用于 `open -b` 与「是否在运行」判断
    let bundleID: String
    /// `.app` 的绝对路径
    let path: URL
    /// 这个应用壳指向的网址（`CrAppModeShortcutURL` 或扫到的 http(s) 字段）
    let appURL: URL?

    /// 该应用此刻是否正在运行（诊断面板要显示 Running: Yes/No）
    var isRunning: Bool {
        NSWorkspace.shared.runningApplications.contains { $0.bundleIdentifier == bundleID }
    }
}

enum PWALocator {
    /// 扫描的位置：用户级与系统级（不含 `/System/Applications`——那里不会有本应用）
    private static var searchRoots: [URL] {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return [
            home.appendingPathComponent("Applications", isDirectory: true),
            URL(fileURLWithPath: "/Applications", isDirectory: true),
        ]
    }

    /// 扫一遍本机所有「Web 应用壳」，按路径去重
    ///
    /// 只往下探两层（`~/Applications/Chrome Apps.localized/xxx.app` 这一层也要能扫到），
    /// 不做递归全盘搜索——那既慢又会误伤。
    static func installedWebApps() -> [InstalledWebApp] {
        var found: [InstalledWebApp] = []
        var seen = Set<String>()
        for root in searchRoots {
            for bundle in appBundles(under: root, depth: 2) {
                guard seen.insert(bundle.path).inserted else { continue }
                guard let app = describe(bundle: bundle) else { continue }
                found.append(app)
            }
        }
        // 稳定顺序：路径字典序（诊断面板的输出才不会每次刷新都换行）
        return found.sorted { $0.path.path < $1.path.path }
    }

    /// 找「指向 TeacherDesk」的那一个 PWA
    ///
    /// - Parameter pwaBaseURL: 快照里带的地址（`pwaBaseUrl`）。**优先按它的 host 匹配**——
    ///   这样换域名、或者教师用本机 dev 地址时，仍然能找对那个应用壳。
    ///   没有快照（或快照里没地址）时退回 `fallbackHost`（应用内置的线上域名常量）。
    static func locateTeacherDesk(pwaBaseURL: String?, fallbackHost: String) -> InstalledWebApp? {
        let wantedHost = host(of: pwaBaseURL) ?? fallbackHost
        let apps = installedWebApps()

        // ① 应用壳指向的网址 host 与目标一致（最可靠）
        if let matched = apps.first(where: { $0.appURL?.host == wantedHost }) { return matched }
        // ② host 对不上时，退一步比「网址里包含目标 host」（有的壳会带路径/参数）
        if let matched = apps.first(where: { app in
            guard let url = app.appURL?.absoluteString else { return false }
            return url.contains(wantedHost)
        }) { return matched }
        // ③ 再退一步：**名字里就有 TeacherDesk** 的应用壳（教师自己改过地址也能命中）
        return apps.first { $0.name.localizedCaseInsensitiveContains("TeacherDesk") }
    }

    // MARK: - 内部

    /// 取某个网址的 host（拿不到就 nil）
    static func host(of urlText: String?) -> String? {
        guard let urlText, !urlText.isEmpty, let url = URL(string: urlText) else { return nil }
        return url.host
    }

    /// 列出目录下（含一层子目录）的 `.app`
    private static func appBundles(under root: URL, depth: Int) -> [URL] {
        guard depth >= 0 else { return [] }
        let manager = FileManager.default
        guard let entries = try? manager.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        var result: [URL] = []
        for entry in entries {
            if entry.pathExtension == "app" {
                result.append(entry)
                continue
            }
            let isDirectory = (try? entry.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
            if isDirectory, depth > 0 {
                result.append(contentsOf: appBundles(under: entry, depth: depth - 1))
            }
        }
        return result
    }

    /// 把一个 `.app` 描述成 `InstalledWebApp`；**不是 Web 应用壳就返回 nil**
    private static func describe(bundle url: URL) -> InstalledWebApp? {
        guard let info = NSDictionary(contentsOf: url.appendingPathComponent("Contents/Info.plist"))
        else { return nil }

        // 先判「它到底是不是浏览器装的网页应用壳」——**这一步必须严**：
        // 普通原生 App（IINA、Keka、AppCleaner…）的 Info.plist 里也有官网地址之类的 http 串，
        // 早先那版"扫到 http 就当应用壳"的宽松判断把它们全列成了 Web Apps（诊断信息里一眼看到）。
        guard isWebAppShell(info: info) else { return nil }
        guard let appURL = webAppURL(in: info) else { return nil }

        let name =
            (info["CFBundleDisplayName"] as? String)
            ?? (info["CFBundleName"] as? String)
            ?? url.deletingPathExtension().lastPathComponent
        let bundleID = info["CFBundleIdentifier"] as? String ?? ""
        return InstalledWebApp(name: name, bundleID: bundleID, path: url, appURL: appURL)
    }

    /// 这个 `.app` 是不是「浏览器安装的网页应用壳」
    ///
    /// 三个判据（任一成立即可），都取自包本身的客观特征，不猜名字：
    /// - `CrAppModeShortcutURL` / `CrAppModeShortcutID`：Chromium 系（Chrome / Edge / Brave）写这两个键
    /// - 可执行文件叫 `app_mode_loader`：Chromium 系应用壳的固定入口名（实测本机就是这个）
    /// - bundle id 落在已知前缀下（Chrome / Edge / Brave 的 `.app.`，以及 Safari 的网页 App）
    private static func isWebAppShell(info: NSDictionary) -> Bool {
        if info["CrAppModeShortcutURL"] != nil || info["CrAppModeShortcutID"] != nil { return true }
        if (info["CFBundleExecutable"] as? String) == "app_mode_loader" { return true }
        let identifier = info["CFBundleIdentifier"] as? String ?? ""
        let prefixes = [
            "com.google.Chrome.app.",
            "com.microsoft.edgemac.app.",
            "com.brave.Browser.app.",
            "com.apple.Safari.WebApp",
        ]
        return prefixes.contains { identifier.hasPrefix($0) }
    }

    /// 从 Info.plist 里找出这个应用壳指向的网址
    ///
    /// - `CrAppModeShortcutURL`：Chromium 系安装应用都写这个键（实测本机就是它）
    /// - 兜底：任何值是 `http(s)://…` 的字符串字段（调用方已经先确认过它确实是应用壳，
    ///   所以这里不会再把普通 App 的官网地址误当目标）
    ///
    /// 已知边界：Safari 的「添加到程序坞」网页 App 把地址放在包内另一个 plist 里，
    /// 这里扫不到——那种情况下会退回按名字匹配（`locateTeacherDesk` 的第 ③ 级）。
    private static func webAppURL(in info: NSDictionary) -> URL? {
        if let text = info["CrAppModeShortcutURL"] as? String, let url = URL(string: text),
           url.scheme?.hasPrefix("http") == true {
            return url
        }
        for (_, value) in info {
            if let text = value as? String, text.hasPrefix("http://") || text.hasPrefix("https://"),
               let url = URL(string: text) {
                return url
            }
        }
        return nil
    }
}
