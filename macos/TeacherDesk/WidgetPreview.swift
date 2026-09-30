//
//  WidgetPreview.swift —— 小组件预览与 PNG 导出（v3.7.2 规格 §五 ~ §九）
//
//  ## 为什么预览能代表真机
//
//  它渲染的是**同一批 SwiftUI View**（`TodayScheduleView` / `WeekScheduleView`，已挪到
//  `Shared/Views/`，Widget 与宿主都编同一份），只是把「用哪个尺寸」显式传进去
//  （Widget 里传系统给的 `widgetFamily`，这里传要预览的那个）。
//  规格 §六 特意点名的坑——"预览页面正常、真正 Widget 变形"——就是这么避免的：
//  预览里**没有第二套 UI**。
//
//  ## 尺寸从哪来
//
//  WidgetKit 没有「查询某个 family 有多大」的 API，所以这里用 macOS 桌面小组件的标准尺寸
//  （点）：Small 170×170 / Medium 364×170 / Large 364×382。**集中在这一个常量里**，
//  不与任何布局代码耦合；真机上如果与桌面所见有细微出入，改这一处即可（见 README 的已知边界）。
//
//  ## 导出的 PNG
//
//  `TeacherDesk-Widget-Today-Small.png` / `-Today-Medium.png` / `-Weekly-Large.png`
//  三种尺寸 × 浅色（默认）一份；另存深色版（`-Dark`），方便核对深色模式下的观感。
//  输出目录：`~/Downloads`（规格 §七）。
//

import AppKit
import SwiftUI
import WidgetKit

/// 三种预览尺寸（点）。集中一处，便于真机校准
struct WidgetPreviewSize: Hashable {
    let family: WidgetFamily
    let title: String
    let width: CGFloat
    let height: CGFloat

    static let small = WidgetPreviewSize(family: .systemSmall, title: "今日 Small", width: 170, height: 170)
    static let medium = WidgetPreviewSize(family: .systemMedium, title: "今日 Medium", width: 364, height: 170)
    static let large = WidgetPreviewSize(family: .systemLarge, title: "一周 Large", width: 364, height: 382)

    static let all: [WidgetPreviewSize] = [small, medium, large]

    /// 导出文件名用的短名
    var fileSlug: String {
        switch family {
        case .systemSmall: return "Today-Small"
        case .systemMedium: return "Today-Medium"
        default: return "Weekly-Large"
        }
    }

    static func size(for family: WidgetFamily) -> WidgetPreviewSize {
        all.first { $0.family == family } ?? medium
    }
}

/// 预览渲染：把「真实 View + 真实尺寸 + 真实快照（或样例）」拼成一个可显示 / 可导出的画面
///
/// `ImageRenderer` 与 SwiftUI 的 View 都在主线程上，所以这些渲染函数标 `@MainActor`
/// （调用方：面板按钮、命令行入口——本来都是主线程）。
@MainActor
enum WidgetPreviewRenderer {
    /// 预览用哪一个 SwiftUI View —— 与 Widget 的定义一致（今日 → TodayScheduleView，一周 → WeekScheduleView）
    ///
    /// 背景这里**显式**铺一层 `WidgetBackground()`：`.containerBackground(for: .widget)`
    /// 只在 widget 上下文里生效，宿主里渲染同一套 View 时得自己把背景垫上，
    /// 否则预览会是一片透明——看起来像"预览坏了"，其实是少了这一层。
    @ViewBuilder
    static func widgetView(entry: SnapshotEntry, size: WidgetPreviewSize) -> some View {
        ZStack {
            WidgetBackground()
            switch size.family {
            case .systemSmall, .systemMedium:
                TodayScheduleView(entry: entry, family: size.family)
            default:
                WeekScheduleView(entry: entry, family: size.family)
            }
        }
    }

    /// 一个完整的预览块：按真实尺寸固定，外加 macOS 小组件那圈圆角
    static func preview(entry: SnapshotEntry, size: WidgetPreviewSize, scheme: ColorScheme) -> some View {
        widgetView(entry: entry, size: size)
            .frame(width: size.width, height: size.height)
            .environment(\.colorScheme, scheme)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
            )
            .shadow(color: .black.opacity(scheme == .dark ? 0.4 : 0.12), radius: 8, y: 3)
    }

    /// 用当前**真实快照**构造 entry（规格 §八：默认不写死假数据）
    ///
    /// 两个 debug 入口只给命令行自检用（`Tools/verify.sh`），界面上的预览**永远**走默认这一条：
    /// - `useSample`（`--snapshot sample`）：核对「当前 / 下一节」的强调时，
    ///   需要一份"此刻正好在上课"的数据，而教师本机的真实快照不一定在那个时间窗里。
    /// - `snapshotFile`（`--snapshot-file <path>`）：**长文本验收**（规格 §三十二）——
    ///   要拿「非常长的课程名称」去试排版，又不能把教师的真快照改掉，
    ///   于是让它读一个临时文件。它只影响预览渲染，不碰任何写入路径。
    static func currentEntry(
        now: Date = Date(),
        useSample: Bool = false,
        snapshotFile: URL? = nil
    ) -> SnapshotEntry {
        if let snapshotFile {
            return SnapshotEntry(date: now, read: SnapshotStore.decode(contentsOf: snapshotFile))
        }
        if useSample, let sample = SnapshotSample.decoded {
            return SnapshotEntry(date: now, read: .ok(sample))
        }
        return SnapshotEntry(date: now, read: SnapshotStore.read())
    }

    /// 把某个尺寸渲成 PNG 数据
    static func pngData(entry: SnapshotEntry, size: WidgetPreviewSize, scheme: ColorScheme) -> Data? {
        let renderer = ImageRenderer(content: preview(entry: entry, size: size, scheme: scheme))
        renderer.scale = 2
        guard let cgImage = renderer.cgImage else { return nil }
        let rep = NSBitmapImageRep(cgImage: cgImage)
        return rep.representation(using: .png, properties: [:])
    }
}

/// 批量导出（按钮与 `--export-widget-previews` 共用同一条实现）
@MainActor
enum WidgetPreviewExporter {
    /// 导出目录的回退链
    ///
    /// `~/Downloads` 是教师最方便找到的地方（规格 §七），但 macOS 对「下载 / 桌面 / 文稿」
    /// 有 TCC 保护：没被授权过的进程写进去会**直接报权限错**（本机命令行自检时就是这样）。
    /// 所以这里按顺序试，第一个写得进去的目录就算数，并把实际位置回报给界面 / stdout——
    /// 绝不"静默失败"，也绝不因为一个目录没权限就整个功能不可用。
    static func candidateDirectories(override: URL?) -> [URL] {
        var list: [URL] = []
        if let override { list.append(override) }
        if let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first {
            list.append(downloads)
        }
        if let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            list.append(support.appendingPathComponent("TeacherDesk/previews", isDirectory: true))
        }
        list.append(URL(fileURLWithPath: NSTemporaryDirectory()))
        return list
    }

    /// 导出三种尺寸 × 浅/深两色；返回写成功的文件（空数组表示一个都没写出去）
    @discardableResult
    static func exportAll(
        now: Date = Date(),
        directory override: URL? = nil,
        useSample: Bool = false,
        snapshotFile: URL? = nil
    ) -> [URL] {
        let entry = WidgetPreviewRenderer.currentEntry(
            now: now,
            useSample: useSample,
            snapshotFile: snapshotFile
        )
        let manager = FileManager.default

        // 先渲好（渲染与目录无关，避免每个候选目录重渲一遍）
        var payloads: [(name: String, data: Data)] = []
        for size in WidgetPreviewSize.all {
            for scheme in [ColorScheme.light, .dark] {
                guard let data = WidgetPreviewRenderer.pngData(entry: entry, size: size, scheme: scheme)
                else { continue }
                let suffix = scheme == .dark ? "-Dark" : ""
                payloads.append(("TeacherDesk-Widget-\(size.fileSlug)\(suffix).png", data))
            }
        }
        guard !payloads.isEmpty else { return [] }

        for directory in candidateDirectories(override: override) {
            try? manager.createDirectory(at: directory, withIntermediateDirectories: true)
            var written: [URL] = []
            var failed = false
            for payload in payloads {
                let url = directory.appendingPathComponent(payload.name)
                do {
                    try payload.data.write(to: url, options: .atomic)
                    written.append(url)
                } catch {
                    // 这个目录不许写（TCC / 沙盒）→ 换下一个候选，别在这里报一堆错
                    failed = true
                    break
                }
            }
            if !failed, written.count == payloads.count {
                NSLog("[widget] 预览已导出到 \(directory.path)")
                return written
            }
        }
        NSLog("[widget] 导出预览失败：所有候选目录都写不进去")
        return []
    }
}
