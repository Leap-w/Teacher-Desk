//
//  AppState.swift —— 宿主 App 的状态机（登录 → 拉取 → 写快照 → 让 Widget 重载）
//
//  **全程只有一个写动作**：把快照写进共享目录（`SnapshotStore.write`）。
//  宿主 App 对云端**只读**——它既不 push 也不 remove，Web/PWA 仍然是唯一的写入方
//  （规格 §四：Web 是唯一业务系统，Widget 是它的只读窗口）。
//
//  三种同步触发（规格 §一）里有两种落在这个文件：
//    - 打开 App 时自动同步一次（`autoSyncOnLaunch`）
//    - 手动点「立即同步」（`syncNow`）
//  第三种（WidgetKit 自己的刷新节奏）在 Widget 扩展那边，它只读本地文件、不联网。
//

import Foundation
import SwiftUI
import WidgetKit

@MainActor
final class AppState: ObservableObject {
    /// 界面上那一行状态。**失败与成功用不同的说法**，不折成一句「同步完成」——
    /// 教师看这一行是要判断「云端那份数据到底进没进来」的。
    enum Status: Equatable {
        case idle
        case working
        case ok(String)
        case failed(String)

        var text: String {
            switch self {
            case .idle: return "还没有同步过"
            case .working: return "正在同步…"
            case .ok(let message): return message
            case .failed(let message): return message
            }
        }

        var isFailed: Bool {
            if case .failed = self { return true }
            return false
        }
    }

    @Published private(set) var account: CloudAccount?
    @Published private(set) var status: Status = .idle
    /// 最近一次成功同步写下的快照（用于界面显示「更新于」与三个 Widget 的条目数）
    @Published private(set) var lastSnapshot: WidgetSnapshot?

    /// 教师在界面里填的 Web/PWA 地址（点击 Widget 时打开它）。
    ///
    /// 存在**宿主 App 自己的** UserDefaults 里就够了——Widget 那边不需要读它：
    /// 它要的地址是快照里的 `pwaBaseURL` 字段（同步时一起写进去的）。
    /// 换句话说这条设置只有一个读者，就是本 App，所以没有共享的必要。
    @Published var pwaBaseURL: String {
        didSet { UserDefaults.standard.set(pwaBaseURL, forKey: Self.pwaBaseURLKey) }
    }

    private static let pwaBaseURLKey = "pwaBaseURL"

    init() {
        pwaBaseURL = UserDefaults.standard.string(forKey: Self.pwaBaseURLKey) ?? ""
        // 界面一打开就把盘上那份快照读出来（哪怕还没联网），
        // 这样「更新于 …」显示的是真实存在的那一份，而不是一片空白
        if case .ok(let snapshot) = SnapshotStore.read() {
            lastSnapshot = snapshot
        }
    }

    // MARK: - 登录

    /// 恢复上次的登录态（token 在 Keychain 里，见 `CloudBaseClient`）
    func restoreSession() async {
        do {
            account = try await CloudBaseClient.restoreSession()
        } catch {
            // 恢复失败不弹错误：教师重新登录一次即可，不需要知道 token 为什么过期了
            account = nil
        }
    }

    func signIn(username: String, password: String) async {
        guard !username.trimmingCharacters(in: .whitespaces).isEmpty else {
            status = .failed("请填写用户名")
            return
        }
        status = .working
        do {
            account = try await CloudBaseClient.signIn(username: username, password: password)
            await syncNow()
        } catch {
            status = .failed(Self.describe(error))
        }
    }

    func signOut() async {
        await CloudBaseClient.signOut()
        account = nil
        status = .idle
    }

    // MARK: - 同步

    /// 打开 App 时自动同步一次（没登录就什么都不做——**不弹登录框**：
    /// 教师打开这个 App 多半只是想同步，不想被一个必须填的对话框拦住）
    func autoSyncOnLaunch() async {
        await restoreSession()
        guard account != nil else { return }
        await syncNow()
    }

    /// 拉云端 → 组快照 → 落盘 → 让 Widget 重载
    func syncNow() async {
        guard account != nil else {
            status = .failed("还没有登录")
            return
        }
        status = .working
        do {
            let documents = try await CloudBaseClient.fetchDocuments()
            let snapshot = SnapshotBuilder.build(
                documents: documents,
                classroomName: ClassroomDefaults.name,
                pwaBaseURL: pwaBaseURL
            )
            do {
                try SnapshotStore.write(snapshot)
            } catch {
                status = .failed(Self.describe(error))
                return
            }
            lastSnapshot = snapshot
            // 顺手让三个 Widget 重画：不刷新的话最多要等半小时（下一次时间线）
            WidgetCenter.shared.reloadAllTimelines()
            status = .ok("已同步 · 更新于 \(SnapshotDerive.clockLabel(snapshot.syncedAt))")
        } catch {
            status = .failed(Self.describe(error))
        }
    }

    /// 把错误折成一句人话。
    ///
    /// **不吞线索**（与 Web 侧 `cloudbase.ts` 的 `toCloudError` 同一条纪律）：
    /// 云端返回什么就显示什么，宁可显示英文原文，也不编一句「同步失败，请重试」——
    /// 后者只会让教师反复点同一个按钮。
    private static func describe(_ error: Error) -> String {
        if let localized = (error as? LocalizedError)?.errorDescription, !localized.isEmpty {
            return localized
        }
        return error.localizedDescription
    }
}
