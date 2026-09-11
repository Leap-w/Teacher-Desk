//
//  SnapshotStore.swift —— 快照文件的读写（宿主 App 写、Widget 读）
//
//  **为什么不是「Web 写快照、Widget 读快照」**：Web/PWA 跑在 Safari 的沙箱里，
//  写不进任何原生 App 的共享位置——这条路在 macOS 上根本不通。所以中间必须有
//  一个原生宿主 App 当桥：宿主 App 连 CloudBase 取数、生成快照落盘，Widget 只读它。
//
//  读的三种形态**照搬 Web 存储层的口径**（Phase 9A/9C 的 `readRaw` 三态，见
//  `src/services/storage.ts`）：
//
//    - `.missing` 文件不存在（还没同步过）→ 空态「尚未同步数据」
//    - `.ok`      读到了且能解析          → 正常渲染
//    - `.broken`  读到了但解析不了        → 「数据读取失败」，**不当作空数据**
//
//  第三种为什么要单列（Phase 9C 花了很大力气才在 Web 侧守住这条）：把「读不出来」
//  与「没有数据」折成同一个空，界面就会显示「今天暂无课程」——教师以为今天没课，
//  而真相是他那份数据坏了。这两种处境的**说法必须不一样**。
//

import Foundation

/// 快照读取结果
enum SnapshotReadResult {
    case missing
    case ok(WidgetSnapshot)
    case broken
    /// 连「放快照的目录」都算不出来（正常机器上不会发生；留着是为了让调用方
    /// 不必对这个分支做假设——状态机里四种说法都得有人接）
    case unavailable
}

/// 快照文件的唯一读写入口。
///
/// 宿主 App 与 Widget 扩展**都必须走这里**——路径算两遍就会分叉，而分叉的表现是
/// 「宿主 App 说同步成功了，Widget 却一直显示没数据」，且两边的代码各自看都对。
///
/// ## 为什么是一个普通目录，而不是 App Group 共享容器
///
/// 这个 App **不上架、只自己用**，于是可以不走 App Sandbox + App Groups 那套：
/// App Groups 是付费开发者账号的能力，而沙箱要配的东西更多、出问题更难查。
/// 换成「两个 target 都不开沙箱 + 一个普通目录」之后：
///
///   · 不需要 Apple ID，ad-hoc 签名（`-`）就能构建和运行
///   · 路径是肉眼可见、可以直接打开看的：`~/Library/Application Support/TeacherDesk/`
///   · 排查问题时 `cat` 一下就知道 Widget 到底读到了什么
///
/// **代价要说清楚**：沙箱没开之后，「Widget 不联网」就不再是系统强制的了，
/// 退回成一条代码纪律——Widget 那份源码里没有任何网络调用（`CloudBaseClient`
/// 只编进宿主 App 的 target，不在扩展里）。这是有意接受的取舍，不是疏忽。
///

enum SnapshotStore {
    /// 快照目录名（`~/Library/Application Support/` 下面那一层）
    static let directoryName = "TeacherDesk"

    /// 容器内文件名
    static let fileName = "widget-snapshot.json"

    /// 快照目录。宿主 App 写之前会确保它存在
    static var directoryURL: URL? {
        FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent(directoryName, isDirectory: true)
    }

    static var fileURL: URL? {
        directoryURL?.appendingPathComponent(fileName, isDirectory: false)
    }

    /// 给人看的路径（出错时显示在界面上，教师可以直接去 Finder 里看）
    static var displayPath: String {
        "~/Library/Application Support/\(directoryName)/\(fileName)"
    }

    // MARK: - 读（Widget 侧）

    static func read() -> SnapshotReadResult {
        guard let url = fileURL else { return .unavailable }
        guard let data = try? Data(contentsOf: url) else { return .missing }
        guard let snapshot = WidgetSnapshot.decode(from: data) else { return .broken }
        return .ok(snapshot)
    }

    // MARK: - 写（宿主 App 侧）

    enum WriteError: Error, LocalizedError {
        case directoryUnavailable
        case directoryNotWritable(underlying: Error)
        case encodingFailed

        var errorDescription: String? {
            switch self {
            case .directoryUnavailable:
                return "找不到 Application Support 目录（正常机器上不该发生）"
            case .directoryNotWritable(let underlying):
                return "写不进 \(SnapshotStore.displayPath)：\(underlying.localizedDescription)"
            case .encodingFailed:
                return "快照编码失败（这不该发生，遇到了请把它当作 bug 报出来）"
            }
        }
    }

    /// 原子写：先写临时文件再替换。
    ///
    /// **不能直接覆盖**：Widget 随时可能在读这份文件，写到一半被读到就是一份坏 JSON——
    /// 而按上面的三态口径，坏 JSON 会被判成「数据读取失败」显示给教师。原子替换之后，
    /// 读方要么读到旧的完整版，要么读到新的完整版，不存在中间态。
    static func write(_ snapshot: WidgetSnapshot) throws {
        guard let directory = directoryURL, let url = fileURL else {
            throw WriteError.directoryUnavailable
        }
        do {
            // 目录可能还不存在（第一次同步）；`withIntermediateDirectories` 让它变幂等
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            throw WriteError.directoryNotWritable(underlying: error)
        }

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(snapshot) else { throw WriteError.encodingFailed }
        try data.write(to: url, options: .atomic)
    }
}
