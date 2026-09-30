//
//  main.swift —— 快照数据层的冒烟自检（v3.7.0）
//
//  它**不依赖 Xcode、不依赖 WidgetKit、不依赖 SwiftUI**：只把 Foundation 那几个文件
//  （SnapshotModel / SnapshotStore / SnapshotDerive / WidgetLinks / SnapshotSample）
//  编成一个命令行程序跑一遍。于是「快照解码对不对、星期换算对不对、今天该显示哪几节课对不对」
//  这些**错了也不会报错、只会安静地显示错课表**的事，能在命令行里被钉住。
//
//  跑法（见 Tools/verify.sh，脚本会把 SDK 与文件列表喂进来）：
//
//      swiftc -o /tmp/smoke main.swift ../../Shared/SnapshotModel.swift ...
//      /tmp/smoke
//
//  退出码：0 = 全过；1 = 有断言失败（脚本据此判红）。
//

import Foundation

var failures = 0
var checks = 0

func check(_ label: String, _ condition: Bool, _ detail: String = "") {
    checks += 1
    if condition {
        print("  ✓ \(label)")
    } else {
        failures += 1
        print("  ✗ \(label)\(detail.isEmpty ? "" : " —— \(detail)")")
    }
}

/// 固定时区与日历：星期换算的断言不能跟着跑测机的时区变（同 Web 侧 vitest 固定 TZ 的理由）
var calendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
    return calendar
}()

func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 12) -> Date {
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    components.hour = hour
    return calendar.date(from: components)!
}

print("\n== 1. 样例快照能否解码 ==")
let sampleData = Data(SnapshotSample.json.utf8)
let sampleRead = SnapshotStore.decode(data: sampleData)
guard case let .ok(sample) = sampleRead else {
    print("  ✗ 样例快照解不开：\(sampleRead)")
    exit(1)
}
check("schemaVersion = \(widgetSnapshotSchemaVersion)", sample.schemaVersion == widgetSnapshotSchemaVersion, "\(sample.schemaVersion)")
check("时段 10 条（早自习 + 第2~7节 + 三节晚自习）", sample.periods.count == 10, "\(sample.periods.count)")
check("一周 7 天", sample.week.count == 7, "\(sample.week.count)")
check("样例共 50 节课", SnapshotDerive.lessonCount(in: sample) == 50, "\(SnapshotDerive.lessonCount(in: sample))")
check("时段顺序按 order 升序", sample.orderedPeriods.map(\.order) == Array(1...10))
check("第一节是「早自习及第一节」", sample.orderedPeriods.first?.label == "早自习及第一节")

print("\n== 2. 四种读结果必须分得开 ==")
check("不存在的文件 → missing", {
    if case .missing = SnapshotStore.decode(contentsOf: URL(fileURLWithPath: "/tmp/td-not-exist.json")) {
        return true
    }
    return false
}())
check("坏 JSON → broken（不是「今天没课」）", {
    if case .broken = SnapshotStore.decode(data: Data("{ 这不是 JSON".utf8)) { return true }
    return false
}())
check("缺字段 → broken", {
    if case .broken = SnapshotStore.decode(data: Data(#"{"schemaVersion":1}"#.utf8)) { return true }
    return false
}())
check("格式版本更高 → unsupported（不猜着读）", {
    if case let .unsupported(version) = SnapshotStore.decode(data: Data(#"{"schemaVersion":99}"#.utf8)) {
        return version == 99
    }
    return false
}())

print("\n== 3. 星期换算（1 = 周一 … 7 = 周日，与 Web 侧同口径）==")
check("2026-09-28 周一 → 1", SnapshotDerive.weekday(of: date(2026, 9, 28), calendar: calendar) == 1)
check("2026-09-29 周二 → 2", SnapshotDerive.weekday(of: date(2026, 9, 29), calendar: calendar) == 2)
check("2026-10-03 周六 → 6", SnapshotDerive.weekday(of: date(2026, 10, 3), calendar: calendar) == 6)
check("2026-10-04 周日 → 7", SnapshotDerive.weekday(of: date(2026, 10, 4), calendar: calendar) == 7)
check("日期行文案 =「周二 · 9月29日」", SnapshotDerive.dateLine(of: date(2026, 9, 29), calendar: calendar) == "周二 · 9月29日",
      SnapshotDerive.dateLine(of: date(2026, 9, 29), calendar: calendar))

print("\n== 4. 今日课程（当天有课 / 没课 / 周末）==")
let monday = SnapshotDerive.lessons(in: sample, on: date(2026, 9, 28), calendar: calendar)
check("周一 10 节", monday.count == 10, "\(monday.count)")
check("第一节 = 早自习 · 高一10班", monday.first?.period.shortLabel == "早自习"
    && monday.first.map { SnapshotDerive.label(for: $0.lesson) } == "高一10班")
check("显示的是**班级**而不是科目（数学老师每节科目都一样）",
      monday.first?.lesson.subject == "数学" && monday.first.map { SnapshotDerive.label(for: $0.lesson) } == "高一10班")
check("最后一节 = 晚自习3 · 高一9班", monday.last?.period.shortLabel == "晚自习3"
    && monday.last.map { SnapshotDerive.label(for: $0.lesson) } == "高一9班")
let saturday = SnapshotDerive.lessons(in: sample, on: date(2026, 10, 3), calendar: calendar)
check("周六没有课（空数组 → 界面走空态）", saturday.isEmpty)

print("\n== 5. 一周课表 ==")
check("样例里周末没课 → 可见列只有周一到周五", SnapshotDerive.visibleDays(in: sample).map(\.weekday) == [1, 2, 3, 4, 5])
check("周三第3节有课且显示班级", {
    guard let wednesday = sample.day(3),
          let lesson = SnapshotDerive.lesson(in: wednesday, periodID: "p3") else { return false }
    return SnapshotDerive.label(for: lesson) == lesson.className && lesson.className?.isEmpty == false
}())
check("周五第7节是班会（科目仍留在快照里，只是界面不画它）", {
    guard let friday = sample.day(5) else { return false }
    return SnapshotDerive.lesson(in: friday, periodID: "p7")?.subject == "班会"
}())
check("一周里出现多个班级（班级才是有效信息）", Set(
    sample.week.flatMap { $0.lessons.compactMap(\.className) }
).count >= 2, "\(Set(sample.week.flatMap { $0.lessons.compactMap(\.className) }).count) 个班")

print("\n== 5b. 显示口径：先班级，再科目，绝不空白 ==")
check("有班级 → 显示班级（科目不参与）", SnapshotDerive.label(
    for: SnapshotLesson(periodId: "p2", className: "高一9班", subject: "数学")) == "高一9班")
check("没有班级（v1 快照）→ 退回显示科目", SnapshotDerive.label(
    for: SnapshotLesson(periodId: "p2", className: nil, subject: "数学")) == "数学")
check("班级是空白串也当没有 → 退回科目", SnapshotDerive.label(
    for: SnapshotLesson(periodId: "p2", className: "   ", subject: "数学")) == "数学")
check("两个都没有（手改坏的快照）→ 中性占位，不画空白", SnapshotDerive.label(
    for: SnapshotLesson(periodId: "p2", className: nil, subject: nil)) == "—")
check("空格子返回 nil（界面画「—」而不是猜一门课）", {
    guard let sunday = sample.day(7) else { return false }
    return SnapshotDerive.lesson(in: sunday, periodID: "p3") == nil
}())

print("\n== 6. 点击链接（Widget → TeacherDesk）==")
let link = WidgetLinks.url(for: .today, in: sample)
check("拼出课程表页的完整地址", link.absoluteString == sample.pwaBaseUrl! + "/work/schedule", link.absoluteString)
check("基址带尾斜杠也不会拼出双斜杠",
      WidgetLinks.compose(base: "https://example.com/", path: "/work/schedule")?.absoluteString == "https://example.com/work/schedule")
check("基址为空 → 退回宿主 App 深链",
      WidgetLinks.url(for: .today, in: nil).absoluteString == "teacherdesk://open")
check("非 http 基址被拒（不会拼出一个点不开的链接）",
      WidgetLinks.compose(base: "javascript:alert(1)", path: "/work/schedule") == nil)

print("\n== 7. 样例文件与 Swift 内嵌字符串逐字节一致 ==")
let sampleFile = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    .appendingPathComponent("Samples/snapshot.sample.json")
if let onDisk = try? String(contentsOf: sampleFile, encoding: .utf8) {
    check("Samples/snapshot.sample.json == SnapshotSample.json", onDisk == SnapshotSample.json,
          "长度 \(onDisk.count) vs \(SnapshotSample.json.count)")
} else {
    check("能读到 Samples/snapshot.sample.json", false, sampleFile.path)
}

print("\n== 8. 快照路径（当前机器上算出来的那一条）==")
check("算得出主路径", SnapshotStore.primaryFileURL != nil, SnapshotStore.primaryFileURL?.path ?? "nil")
print("  宿主写入：\(SnapshotStore.primaryFileURL?.path ?? "（算不出）")")
print("  候选路径：")
for url in SnapshotStore.candidateFileURLs { print("    · \(url.path)") }
check("候选里含 Widget 扩展容器里的那份", SnapshotStore.candidateFileURLs.contains {
    $0.path.contains("Library/Containers/\(SnapshotStore.widgetBundleID)/")
} || SnapshotStore.isSandboxed)

print("\n结果：\(checks - failures)/\(checks) 项通过" + (failures == 0 ? " —— 全绿" : " —— \(failures) 项失败"))
exit(failures == 0 ? 0 : 1)
