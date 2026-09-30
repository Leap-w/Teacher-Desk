//
//  HostView.swift —— 宿主 App 的全部界面（一屏，v3.7.0）
//
//  它回答教师三个问题，一屏说完：
//    ① 小组件现在读到的是什么？（快照在不在、什么时候写的、这一周几节课）
//    ② 快照文件在哪？（可选择的路径 + 「打开文件夹」）
//    ③ 我该做什么？（连接 TeacherDesk / 写入样例 / 刷新小组件）
//
//  **不做任何业务**：没有课表编辑、没有档案、没有同步按钮——那些都在 Web/PWA 里
//  （规格 §二十七：不要 Widget 内编辑、不要 macOS 版 TeacherDesk）。
//
//  状态放在 `HostModel`（ObservableObject + 手动 objectWillChange）而不是 `@State`：
//  理由见 `TeacherDeskApp.swift` 顶部（Xcode 27 里 `@State` 是宏，命令行构建走不通）。
//

import AppKit
import Combine
import SwiftUI

/// 面板状态模型。所有「点一下要变的东西」都在这里，View 只读它。
final class HostModel: ObservableObject {
    /// 视图订阅它才能重画（`@Published` 也是宏，所以手动发信号，见文件顶部说明）
    let objectWillChange = ObservableObjectPublisher()

    /// 快照当前的读结果（四态，与 `SnapshotRead` 一一对应）
    private(set) var panel: PanelState = .empty {
        didSet { objectWillChange.send() }
    }

    /// 上一次操作的反馈（「已通知小组件刷新」这类）
    private(set) var message: String? {
        didSet { objectWillChange.send() }
    }

    init() {
        reload()
    }

    /// 重新读一次盘上的快照
    func reload() {
        panel = PanelState(read: SnapshotStore.read())
    }

    func notifyWidgets() {
        HostDeepLink.reloadWidgets()
        message = "已通知小组件刷新"
    }

    func openTeacherDesk() {
        HostDeepLink.openTeacherDesk()
    }

    /// 把样例快照写进去（让教师在连上网页之前就能看见小组件长什么样）
    func writeSample() {
        do {
            _ = try SnapshotStore.write(SnapshotSample.json)
            HostDeepLink.reloadWidgets()
            message = "样例快照已写入，小组件几秒内显示样例课表"
            reload()
        } catch {
            message = "写入失败：\(error.localizedDescription)"
        }
    }

    /// 在访达里定位快照文件（目录还不存在时，从最近存在的一层打开）
    func revealSnapshotFolder() {
        guard let file = SnapshotStore.primaryFileURL else { return }
        let directory = file.deletingLastPathComponent()
        if FileManager.default.fileExists(atPath: directory.path) {
            NSWorkspace.shared.activateFileViewerSelecting([file])
            return
        }
        var probe = directory
        while !FileManager.default.fileExists(atPath: probe.path), probe.path != "/" {
            probe.deleteLastPathComponent()
        }
        NSWorkspace.shared.open(probe)
    }
}

/// 面板要显示的一段状态（由 `SnapshotRead` 翻译成「人话」，四态各有各的说法）
struct PanelState {
    enum Tone { case ok, idle, warn }

    let title: String
    let details: [String]
    let tone: Tone

    static let empty = PanelState(title: "正在读取…", details: [], tone: .idle)

    init(title: String, details: [String], tone: Tone) {
        self.title = title
        self.details = details
        self.tone = tone
    }

    /// 四种读结果 → 四种说法。**「没有数据」与「数据坏了」必须分开说**（同 Web 侧存储层口径）
    init(read: SnapshotRead) {
        switch read {
        case .missing:
            self.init(
                title: "还没有快照",
                details: [
                    "点「写入样例快照」可以先看效果。",
                    "要用真数据：打开 TeacherDesk 网页版 → 课程表 →「连接小组件」。",
                ],
                tone: .idle
            )
        case let .ok(snapshot):
            let lessons = SnapshotDerive.lessonCount(in: snapshot)
            let className = snapshot.className.flatMap { $0.isEmpty ? nil : $0 } ?? "（未填）"
            self.init(
                title: "已读到快照",
                details: [
                    "写入时刻：\(snapshot.updatedAtLabel ?? snapshot.updatedAt ?? "未知")",
                    "本周课时：\(lessons) 节 · 班级：\(className)",
                    "快照格式 v\(snapshot.schemaVersion)（当前小组件认 v\(widgetSnapshotSchemaVersion)）",
                ],
                tone: .ok
            )
        case .broken:
            self.init(
                title: "快照读不出来",
                details: [
                    "文件在，但内容解析失败。",
                    "到 TeacherDesk 课程表页点一次「仅同步」重写它。",
                ],
                tone: .warn
            )
        case let .unsupported(version):
            self.init(
                title: "快照格式太新（v\(version)）",
                details: ["这份快照由更新的 TeacherDesk 写出，请更新这个小组件 App。"],
                tone: .warn
            )
        }
    }
}

struct HostView: View {
    @Environment(\.colorScheme) private var scheme
    @ObservedObject var model: HostModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TDSpace.lg) {
                header
                statusCard
                pathCard
                actions
                steps
            }
            .padding(TDSpace.xl)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(TDColor.card(scheme))
        // 打开面板就顺手让小组件重画一次：`Tools/install-snapshot.sh` 与「写样例」都靠这一下
        .task { HostDeepLink.reloadWidgets() }
        .onOpenURL { url in
            switch HostDeepLink.parse(url) {
            case .refresh:
                model.notifyWidgets()
            case .open, .unknown:
                model.openTeacherDesk()
            }
        }
    }

    // MARK: - 各段

    private var header: some View {
        VStack(alignment: .leading, spacing: TDSpace.xs) {
            Text("TeacherDesk 桌面小组件")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(TDColor.text(scheme))
            Text("今日课程 · 一周课程表 —— 只读，数据来自 TeacherDesk 课程表")
                .font(TDFont.small)
                .foregroundStyle(TDColor.tertiaryText(scheme))
        }
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: TDSpace.sm) {
            HStack(spacing: TDSpace.sm) {
                Circle()
                    .fill(tint(model.panel.tone))
                    .frame(width: 8, height: 8)
                Text(model.panel.title)
                    .font(TDFont.bodyStrong)
                    .foregroundStyle(TDColor.text(scheme))
            }
            ForEach(model.panel.details, id: \.self) { line in
                Text(line)
                    .font(TDFont.small)
                    .foregroundStyle(TDColor.secondaryText(scheme))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TDSpace.lg)
        .background(TDColor.fill(scheme))
        .clipShape(RoundedRectangle(cornerRadius: TDRadius.sm, style: .continuous))
    }

    private var pathCard: some View {
        VStack(alignment: .leading, spacing: TDSpace.sm) {
            Text("快照文件")
                .font(TDFont.bodyStrong)
                .foregroundStyle(TDColor.text(scheme))
            Text(SnapshotStore.primaryFileURL?.path ?? "（算不出路径）")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(TDColor.secondaryText(scheme))
                .textSelection(.enabled)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            Text("由 TeacherDesk（浏览器）写入；本 App 与小组件都只读它。")
                .font(TDFont.caption)
                .foregroundStyle(TDColor.faintText(scheme))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TDSpace.lg)
        .background(TDColor.fill(scheme))
        .clipShape(RoundedRectangle(cornerRadius: TDRadius.sm, style: .continuous))
    }

    private var actions: some View {
        VStack(alignment: .leading, spacing: TDSpace.sm) {
            HStack(spacing: TDSpace.sm) {
                Button("打开 TeacherDesk") { model.openTeacherDesk() }
                    .buttonStyle(.borderedProminent)
                    .tint(TDColor.primary(scheme))
                Button("刷新小组件") { model.notifyWidgets() }
                Button("重新读取") { model.reload() }
            }
            HStack(spacing: TDSpace.sm) {
                Button("打开快照文件夹") { model.revealSnapshotFolder() }
                Button("写入样例快照") { model.writeSample() }
            }
            if let message = model.message {
                Text(message)
                    .font(TDFont.caption)
                    .foregroundStyle(TDColor.primary(scheme))
            }
        }
    }

    private var steps: some View {
        VStack(alignment: .leading, spacing: TDSpace.sm) {
            Text("怎么让小组件显示真课表")
                .font(TDFont.bodyStrong)
                .foregroundStyle(TDColor.text(scheme))
            ForEach(Array(Self.instructions.enumerated()), id: \.offset) { index, line in
                HStack(alignment: .top, spacing: TDSpace.sm) {
                    Text("\(index + 1).")
                        .font(TDFont.small)
                        .foregroundStyle(TDColor.faintText(scheme))
                    Text(line)
                        .font(TDFont.small)
                        .foregroundStyle(TDColor.secondaryText(scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TDSpace.lg)
        .background(TDColor.fill(scheme))
        .clipShape(RoundedRectangle(cornerRadius: TDRadius.sm, style: .continuous))
    }

    private func tint(_ tone: PanelState.Tone) -> Color {
        switch tone {
        case .ok: return TDColor.success(scheme)
        case .idle: return TDColor.faintText(scheme)
        case .warn: return Color(hex: 0xE8B04C)
        }
    }

    private static let instructions: [String] = [
        "把 TeacherDesk.app 放进「应用程序」文件夹（WidgetKit 只收录已安装 App 里的扩展）。",
        "在桌面空白处右键 →「编辑小组件」，搜索 TeacherDesk，添加「今日课程」与「一周课程表」。",
        "打开 TeacherDesk 网页版 →「课程表」页底部的「macOS 桌面小组件」卡片 → 点「连接小组件」。",
        "在系统选择框里按 ⌘⇧G，粘贴上面那条路径（到 TeacherDesk 目录），选中它并允许写入。",
        "之后改课程表会自动更新快照；点小组件任意位置会打开 TeacherDesk。",
    ]
}
