//
//  SnapshotStore.swift —— 快照文件的读写（宿主 App 写、Widget 只读）
//
//  路径、读法、四种读结果都在这里，**两个 target 共用同一份**：路径算两遍就会分叉，
//  而分叉的表现是「Web 说写好了、Widget 一直显示没数据」，两边代码各自看都对。
//
//  ## 路径为什么是「Widget 扩展的容器」
//
//  本机（2026-09-30 核对）只有 Command Line Tools、`security find-identity` 0 个签名身份，
//  于是 App Group 那条标准路走不通（它要真实 Team ID + 开发者账号）。而 macOS 的
//  **Widget 扩展必须开沙盒**才会出现在小组件库里，不开沙盒的表现是「编译过了、库里没有」。
//  两条事实一叠，只剩一条路：
//
//      宿主 App **不开沙盒**（所以它能写任意路径，包括别人的容器）
//          ↓ 写
//      ~/Library/Containers/com.teacherdesk.mac.widget/Data/Library/Application Support/TeacherDesk/
//          ↓ 只读（沙盒扩展读自己的容器，**不需要任何 entitlement**）
//      Widget 扩展
//
//  沙盒里的 `FileManager` 把 `.applicationSupportDirectory` 解析到**自己容器的**同一个绝对路径，
//  所以 Widget 那份代码只需要用系统 API，不必知道容器号（见 `sandboxApplicationSupportDirectory`）。
//
//  ## 为什么不把「读不出来」和「没有数据」折成同一个空
//
//  照搬 Web 侧存储层的三态口径（`src/services/storage.ts`）：文件不存在是「还没同步过」，
//  解析失败是「数据坏了」——后者绝不能说成「今天没有课」，那会让教师以为今天真没课。
//

import Foundation

/// 快照的读取结果（四种说法各有各的界面文案，不许合并）
enum SnapshotRead {
    /// 文件不存在：还没同步过（Web 侧没连接 / 还没写过）
    case missing
    /// 读到了且能解析
    case ok(WidgetSnapshot)
    /// 读到了但解不开（手改坏 / 写了一半 / 传输截断）
    case broken
    /// 格式版本比本 Widget 新——不猜着读
    case unsupported(version: Int)
}

enum SnapshotStore {
    /// Widget 扩展的 bundle id —— 决定它的沙盒容器目录（与 `project.yml` / `src/config/index.ts` 同值）
    static let widgetBundleID = "com.teacherdesk.mac.widget"

    /// 容器内的目录名（`.../Application Support/` 下面那一层）
    static let directoryName = "TeacherDesk"

    /// 快照文件名（与 Web 侧 `appConfig.widget.snapshotFileName` 同值）
    static let fileName = "widget-snapshot.json"

    /// 当前进程是不是跑在沙盒里（扩展是、宿主 App 不是）
    static var isSandboxed: Bool {
        ProcessInfo.processInfo.environment["APP_SANDBOX_CONTAINER_ID"] != nil
    }

    /// 沙盒内 / 普通用户主目录下的 `Application Support/TeacherDesk`
    /// - 在 Widget 扩展里 = 自己容器的 Application Support（**这就是 Widget 读的那份**）
    /// - 在宿主 App 里 = 真实用户的 `~/Library/Application Support/TeacherDesk`
    static var applicationSupportDirectory: URL? {
        guard
            let base = FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first
        else { return nil }
        return base.appendingPathComponent(directoryName, isDirectory: true)
    }

    /// Widget 扩展容器的绝对路径（**只在宿主 App 里算得对**：宿主没开沙盒，主目录才是真主目录）
    static var widgetContainerDirectory: URL? {
        guard !isSandboxed else { return nil }
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home
            .appendingPathComponent("Library/Containers", isDirectory: true)
            .appendingPathComponent(widgetBundleID, isDirectory: true)
            .appendingPathComponent("Data/Library/Application Support", isDirectory: true)
            .appendingPathComponent(directoryName, isDirectory: true)
    }

    /// 宿主 App 该往哪里写：优先容器（Widget 读的就是它），沙盒内退 Application Support
    static var writeDirectory: URL? {
        widgetContainerDirectory ?? applicationSupportDirectory
    }

    /// 读的时候看哪些位置（宿主 App 里两个都看，取**较新的那个**；Widget 里只有一个能读到）
    static var candidateDirectories: [URL] {
        [widgetContainerDirectory, applicationSupportDirectory]
            .compactMap { $0 }
            // 两个候选指向同一处时（沙盒里）只留一个
            .reduce(into: [URL]()) { result, url in
                if !result.contains(url) { result.append(url) }
            }
    }

    /// 供界面展示的候选文件路径（诊断面板里逐条列出来，教师能自己 `ls` 核对）
    static var candidateFileURLs: [URL] {
        candidateDirectories.map { $0.appendingPathComponent(fileName) }
    }

    /// 主路径（宿主 App 写的那一份，也是界面「打开快照文件夹」打开的那个）
    static var primaryFileURL: URL? {
        writeDirectory?.appendingPathComponent(fileName)
    }

    /// 读快照：多个候选里取**修改时间最新**的一份（同一台机器上不该出现两份，但出现了要能说清用哪份）
    static func read() -> SnapshotRead {
        let candidates = candidateFileURLs.filter { FileManager.default.fileExists(atPath: $0.path) }
        guard !candidates.isEmpty else { return .missing }
        let newest = candidates.max { left, right in
            let leftDate = (try? left.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate ?? .distantPast
            let rightDate = (try? right.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate ?? .distantPast
            return leftDate < rightDate
        }!
        return decode(contentsOf: newest)
    }

    /// 解析一份快照文件（抽出来是为了让自检能直接喂字节，不必先落盘）
    static func decode(contentsOf url: URL) -> SnapshotRead {
        guard let data = try? Data(contentsOf: url) else { return .missing }
        return decode(data: data)
    }

    /// 解析快照字节
    static func decode(data: Data) -> SnapshotRead {
        let decoder = JSONDecoder()
        // ① 先只读版本号：格式比本 Widget 新时**不猜着读**（猜的结果是一张错课表）
        if let probe = try? decoder.decode(SnapshotVersionProbe.self, from: data),
           probe.schemaVersion > widgetSnapshotSchemaVersion {
            return .unsupported(version: probe.schemaVersion)
        }
        // ② 再整份解。缺字段 / 类型不对 → broken（不是「今天没课」）
        guard let snapshot = try? decoder.decode(WidgetSnapshot.self, from: data) else {
            return .broken
        }
        return .ok(snapshot)
    }

    /// 写快照（**只有宿主 App 会调用**；Widget 侧永远只读，规格 §二十二）
    @discardableResult
    static func write(_ text: String) throws -> URL {
        guard let directory = writeDirectory else {
            throw NSError(
                domain: "TeacherDesk.SnapshotStore",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "算不出快照目录"]
            )
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent(fileName)
        // 原子写：Widget 可能正好在这时读，写到一半的文件会让它读到一份坏数据
        try text.write(to: file, atomically: true, encoding: .utf8)
        return file
    }
}
