//
//  WidgetDiagnostics.swift —— 「小组件诊断」文本（v3.7.2 规格 §十 ~ §十二）
//
//  目的只有一个：**出问题时能一句话说清现场**。教师点一下「复制诊断信息」，
//  把纯文本贴给我就能定位（不用来回问"你那个 PWA 装在哪儿"）。
//
//  两条纪律：
//    · **一个字段都不许猜**：PWA 的名字 / bundle id / 路径全部来自 `PWALocator` 的**实际扫描**，
//      Snapshot 的大小 / 时间来自**实际读文件**，Widget 扩展的 bundle id 来自**产物里的 Info.plist**。
//    · **区分宿主与 PWA**（规格 §二十五 特意点到）：两者名字都叫 TeacherDesk，
//      所以每一段都写清楚是哪个，并且分别给出 bundle id。
//

import AppKit
import Foundation

/// 注意：`text()` 要读 `HostRuntime`（@MainActor），所以整个枚举标成 @MainActor；
/// 它的调用方（委托、面板、命令行入口）本来都在主线程上。
@MainActor
enum WidgetDiagnostics {
    /// 完整诊断文本（纯文本，可直接粘贴）
    static func text() -> String {
        var lines: [String] = []
        lines.append("TeacherDesk Widget Diagnostics")
        lines.append("==============================")
        lines.append("")
        lines.append(contentsOf: hostSection())
        lines.append("")
        lines.append(contentsOf: widgetSection())
        lines.append("")
        lines.append(contentsOf: pwaSection())
        lines.append("")
        lines.append(contentsOf: snapshotSection())
        lines.append("")
        lines.append(contentsOf: widgetStateSection())
        lines.append("")
        return lines.joined(separator: "\n")
    }

    /// 复制到系统剪贴板（返回是否至少写了一次）
    @discardableResult
    static func copyToPasteboard() -> Bool {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        return pasteboard.setString(text(), forType: .string)
    }

    // MARK: - 各段

    private static func hostSection() -> [String] {
        let bundle = Bundle.main
        let info = bundle.infoDictionary ?? [:]
        let displayName =
            (info["CFBundleDisplayName"] as? String)
            ?? (info["CFBundleName"] as? String)
            ?? "TeacherDesk"
        return [
            "Host App",
            "Display Name: \(displayName)",
            "Bundle ID: \(bundle.bundleIdentifier ?? "(unknown)")",
            "Version: \(bundle.shortVersion) (\(bundle.buildVersion))",
            "Path: \(bundle.bundlePath)",
            "Sandboxed: \(SnapshotStore.isSandboxed ? "Yes" : "No")",
        ]
    }

    private static func widgetSection() -> [String] {
        // 扩展的真实信息从**产物里**读（宿主 bundle 的 PlugIns 目录），不写常量
        let appex = Bundle.main.builtInPlugInsURL?
            .appendingPathComponent("TeacherDeskWidget.appex")
        let bundle = appex.flatMap { Bundle(url: $0) }
        let info = bundle?.infoDictionary ?? [:]
        var lines = [
            "Widget Extension",
            "Bundle ID: \(bundle?.bundleIdentifier ?? "(未找到扩展)")",
            "Version: \(bundle?.shortVersion ?? "-") (\(bundle?.buildVersion ?? "-"))",
            "Path: \(appex?.path ?? "-")",
        ]
        if let point = (info["NSExtension"] as? [String: Any])?["NSExtensionPointIdentifier"] as? String {
            lines.append("Extension Point: \(point)")
        }
        lines.append(
            "Families: 今日课程 [Small, Medium] · 一周课程表 [Large]（见 supportedFamilies）"
        )
        return lines
    }

    private static func pwaSection() -> [String] {
        let snapshot = SnapshotStore.read()
        let baseURL: String? = {
            if case let .ok(value) = snapshot { return value.pwaBaseUrl }
            return nil
        }()
        let pwa = PWALocator.locateTeacherDesk(
            pwaBaseURL: baseURL,
            fallbackHost: HostLauncher.fallbackHost
        )
        var lines = ["TeacherDesk PWA（本机实际扫描结果，非硬编码）"]
        if let pwa {
            lines.append("Display Name: \(pwa.name)")
            lines.append("Bundle ID: \(pwa.bundleID)")
            lines.append("Install Path: \(pwa.path.path)")
            lines.append("App URL: \(pwa.appURL?.absoluteString ?? "-")")
            lines.append("Running: \(pwa.isRunning ? "Yes" : "No")")
        } else {
            lines.append("Display Name: (未找到已安装的 PWA 应用壳)")
            lines.append("Bundle ID: -")
            lines.append("Install Path: -")
            lines.append("Running: No")
        }
        let scanned = PWALocator.installedWebApps()
        lines.append("Scanned Web Apps: \(scanned.count)")
        for app in scanned.prefix(6) {
            lines.append("  · \(app.name) — \(app.bundleID)")
        }
        return lines
    }

    private static func snapshotSection() -> [String] {
        let file = SnapshotStore.primaryFileURL
        let path = file?.path ?? "(算不出路径)"
        var lines = ["Widget Snapshot"]
        lines.append("Path: \(path)")
        if let file {
            let exists = FileManager.default.fileExists(atPath: file.path)
            lines.append("Exists: \(exists ? "Yes" : "No")")
            lines.append("Readable: \(FileManager.default.isReadableFile(atPath: file.path) ? "Yes" : "No")")
            let attributes = try? FileManager.default.attributesOfItem(atPath: file.path)
            let size = (attributes?[.size] as? NSNumber)?.intValue ?? 0
            let modified = attributes?[.modificationDate] as? Date
            lines.append("File Size: \(size) bytes")
            lines.append("Modified At: \(modified.map { HostRuntime.stampFormatter.string(from: $0) } ?? "-")")
        } else {
            lines.append("Exists: No")
            lines.append("Readable: No")
            lines.append("File Size: -")
            lines.append("Modified At: -")
        }
        switch SnapshotStore.read() {
        case .missing: lines.append("Read Result: missing（还没有同步过）")
        case .ok: lines.append("Read Result: ok")
        case .broken: lines.append("Read Result: broken（文件在，但解析失败）")
        case let .unsupported(version): lines.append("Read Result: unsupported（格式 v\(version)）")
        }
        return lines
    }

    private static func widgetStateSection() -> [String] {
        let now = Date()
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "yyyy-MM-dd"
        var lines = ["Widget"]
        lines.append("Widget Snapshot Schema: v\(widgetSnapshotSchemaVersion)")
        lines.append("Today: \(formatter.string(from: now)) · 星期\(SnapshotDerive.weekday(of: now))")

        if case let .ok(snapshot) = SnapshotStore.read() {
            lines.append("Snapshot Written At: \(snapshot.updatedAtLabel ?? snapshot.updatedAt ?? "-")")
            let lessonCount = SnapshotDerive.lessonCount(in: snapshot)
            lines.append("Week Lessons: \(lessonCount)")
            let todays = SnapshotDerive.lessons(in: snapshot, on: now)
            let schedule = SnapshotDerive.daySchedule(rows: todays, now: now)
            lines.append("Today Lessons: \(todays.count)")
            lines.append(
                "Current Period: \(schedule.currentPeriodID(rows: todays) ?? "-")"
            )
            lines.append("Next Period: \(schedule.nextPeriodID(rows: todays) ?? "-")")
            lines.append("Today Finished: \(schedule.isFinished ? "Yes" : "No")")
        } else {
            lines.append("Snapshot Written At: -")
            lines.append("Week Lessons: -")
            lines.append("Today Lessons: -")
        }
        lines.append("Last Widget Reload: \(HostRuntime.shared.lastReloadLabel)")
        return lines
    }
}

extension Bundle {
    var shortVersion: String {
        (infoDictionary?["CFBundleShortVersionString"] as? String) ?? "-"
    }
    var buildVersion: String {
        (infoDictionary?["CFBundleVersion"] as? String) ?? "-"
    }
}
