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

func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 12, _ minute: Int = 0) -> Date {
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    components.hour = hour
    components.minute = minute
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

print("\n== 3b. 标题行文案（v3.7.3：短日期 / 同步时刻）==")
// 短日期是 small 的退路（规格 §十五）：170pt 宽减去版心只剩 146pt，完整日期不一定放得下，
// 放不下时退到「9月29日」而**不是**「周二 · 9月…」——所以这两条要钉死。
check("短日期 =「9月29日」", SnapshotDerive.shortDateLine(of: date(2026, 9, 29), calendar: calendar) == "9月29日",
      SnapshotDerive.shortDateLine(of: date(2026, 9, 29), calendar: calendar))
check("完整日期 = 短日期前面加「星期 · 」，两者只差这一截",
      SnapshotDerive.dateLine(of: date(2026, 9, 29), calendar: calendar)
        == "周二 · " + SnapshotDerive.shortDateLine(of: date(2026, 9, 29), calendar: calendar))
// 同步时刻：一周课程表右上角写「07:30 同步」（规格 §六），所以只取 HH:mm 这一段
check("同步时刻从 updatedAtLabel 里切出「07:30」（样例是「10月1日 07:30」）",
      SnapshotDerive.syncClockLabel(sample, calendar: calendar) == "07:30",
      SnapshotDerive.syncClockLabel(sample, calendar: calendar) ?? "nil")
check("label 缺席时退到 ISO8601 的 updatedAt（带毫秒也要认）", {
    let snapshot = WidgetSnapshot(
        schemaVersion: 2, generator: nil,
        updatedAt: "2026-09-30T23:30:00.000Z", updatedAtLabel: nil,
        pwaBaseUrl: nil, className: nil, periods: [], week: []
    )
    return SnapshotDerive.syncClockLabel(snapshot, calendar: calendar) == "07:30"
}())
check("两个字段都没有 → nil（宁可不显示，也不编一个时刻出来）", {
    let snapshot = WidgetSnapshot(
        schemaVersion: 2, generator: nil, updatedAt: nil, updatedAtLabel: nil,
        pwaBaseUrl: nil, className: nil, periods: [], week: []
    )
    return SnapshotDerive.syncClockLabel(snapshot, calendar: calendar) == nil
}())

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

print("\n== 6. 点击链接（Widget → 宿主 App → TeacherDesk PWA，v3.7.2）==")
// 实测结论（2026-10-01）：widgetURL 给 https 地址会落到 Safari 而不是 PWA，
// 所以两个 Widget 的点击目标统一是宿主 App 的深链，由宿主去开扫出来的那个 PWA。
check("今日课程 → teacherdesk://open",
      WidgetLinks.url(for: .today, in: sample).absoluteString == "teacherdesk://open",
      WidgetLinks.url(for: .today, in: sample).absoluteString)
check("一周课程表 → teacherdesk://open",
      WidgetLinks.url(for: .week, in: sample).absoluteString == "teacherdesk://open",
      WidgetLinks.url(for: .week, in: sample).absoluteString)
check("没有快照时同样是这个深链（不会点空）",
      WidgetLinks.url(for: .today, in: nil).absoluteString == "teacherdesk://open")
check("深链解析：teacherdesk://open → 打开", TeacherDeskDeepLink.parse(URL(string: "teacherdesk://open")!) == .open)
check("深链解析：teacherdesk://refresh → 只刷新", TeacherDeskDeepLink.parse(URL(string: "teacherdesk://refresh")!) == .refresh)
check("深链解析：teacherdesk:// 空 host 也当打开", TeacherDeskDeepLink.parse(URL(string: "teacherdesk://")!) == .open)
check("深链解析：别的 scheme 不误判", TeacherDeskDeepLink.parse(URL(string: "https://example.com")!) == .unknown)
// 宿主 App 的最后一级退路（扫不到 PWA 应用壳时）：快照地址 + history 路由仍要拼对
check("退路地址：基址 + /work/schedule",
      WidgetLinks.browserFallbackURL(in: sample, path: WidgetDestination.today.webPath)?.absoluteString
        == sample.pwaBaseUrl! + "/work/schedule")
check("退路地址：基址带尾斜杠不会双斜杠",
      WidgetLinks.compose(base: "https://example.com/", path: "/work/schedule")?.absoluteString == "https://example.com/work/schedule")
check("退路地址：没有快照就是 nil（不乱猜地址）",
      WidgetLinks.browserFallbackURL(in: nil, path: "/work/schedule") == nil)
check("非 http 基址被拒（不会拼出一个点不开的链接）",
      WidgetLinks.compose(base: "javascript:alert(1)", path: "/work/schedule") == nil)

print("\n== 6b. 今日课程「当前 / 下一节」（v3.7.2，纯函数、按快照时间算）==")
// 样例的时段：早自习 07:40–08:20 / 第2节 08:30–09:10 / … 具体用它自己的 startTime/endTime
let mondayRows = SnapshotDerive.lessons(in: sample, on: date(2026, 9, 28), calendar: calendar)
func momentsAt(_ hour: Int, _ minute: Int) -> SnapshotDerive.DaySchedule {
    SnapshotDerive.daySchedule(rows: mondayRows, now: date(2026, 9, 28, hour, minute), calendar: calendar)
}
func stateSummary(_ schedule: SnapshotDerive.DaySchedule) -> String {
    schedule.moments.map {
        switch $0 {
        case .current: return "当前"
        case .next: return "下一节"
        case .later: return "之后"
        case .past: return "已上"
        }
    }.joined(separator: ",")
}

// ① 上课前：还没到第一节课 → 只有「下一节」，且是第一节
let before = momentsAt(6, 0)
check("上课前：第一节是「下一节」，没有「当前」",
      before.nextPeriodID(rows: mondayRows) == mondayRows.first?.period.id
        && before.currentPeriodID(rows: mondayRows) == nil, stateSummary(before))

// ② 正在上课：第一节是「当前」，第二节是「下一节」
let firstStart = SnapshotDerive.minutes(of: mondayRows[0].period.startTime)!
let duringFirst = SnapshotDerive.daySchedule(
    rows: mondayRows,
    now: date(2026, 9, 28, firstStart / 60, firstStart % 60 + 1),
    calendar: calendar
)
check("正在上课：当前=第一节，下一节=第二节",
      duringFirst.currentPeriodID(rows: mondayRows) == mondayRows[0].period.id
        && duringFirst.nextPeriodID(rows: mondayRows) == mondayRows[1].period.id,
      stateSummary(duringFirst))

// ③ 两节课之间（下课那一分钟起就不再是「当前」）→ 下一节是正确的第二节，不是刚上完的
let firstEnd = SnapshotDerive.minutes(of: mondayRows[0].period.endTime)!
let between = SnapshotDerive.daySchedule(
    rows: mondayRows,
    now: date(2026, 9, 28, firstEnd / 60, firstEnd % 60),
    calendar: calendar
)
check("课间：没有「当前」，下一节仍是第二节（不是刚上完的那节）",
      between.currentPeriodID(rows: mondayRows) == nil
        && between.nextPeriodID(rows: mondayRows) == mondayRows[1].period.id,
      stateSummary(between))

// ④ 全天结束：最后一节的下课之后
let lastEnd = SnapshotDerive.minutes(of: mondayRows.last!.period.endTime)!
let afterAll = SnapshotDerive.daySchedule(
    rows: mondayRows,
    now: date(2026, 9, 28, lastEnd / 60, lastEnd % 60),
    calendar: calendar
)
check("全天结束：没有当前、没有下一节，且 isFinished = true",
      afterAll.currentPeriodID(rows: mondayRows) == nil
        && afterAll.nextPeriodID(rows: mondayRows) == nil
        && afterAll.isFinished,
      stateSummary(afterAll))

// ⑤ 今天没课（周末）：既没有当前也没有下一节，也不说「已结束」
let weekendRows = SnapshotDerive.lessons(in: sample, on: date(2026, 10, 3), calendar: calendar)
let weekend = SnapshotDerive.daySchedule(rows: weekendRows, now: date(2026, 10, 3, 10, 0), calendar: calendar)
check("今天没课：无当前 / 无下一节，isFinished = false（界面走空态）",
      weekend.currentPeriodID(rows: weekendRows) == nil
        && weekend.nextPeriodID(rows: weekendRows) == nil
        && !weekend.isFinished)

// ⑥ 时间字段坏掉时不冒充「当前」（快照是外部文件，必须防）
let badPeriod = SnapshotPeriod(
    id: "p2", label: "第2节", shortLabel: "第2节",
    startTime: "bogus", endTime: "09:10", order: 2, group: "morning"
)
let badLesson = SnapshotLesson(periodId: "p2", className: "高一9班", subject: "数学")
let badRows = [(period: badPeriod, lesson: badLesson)]
let bad = SnapshotDerive.daySchedule(rows: badRows, now: date(2026, 9, 28, 9, 0), calendar: calendar)
check("时段里时间写坏了：不判定为当前、也不判定为下一节",
      bad.currentPeriodID(rows: badRows) == nil && bad.nextPeriodID(rows: badRows) == nil)
check("分钟解析：合法值正确、非法值 nil",
      SnapshotDerive.minutes(of: "07:40") == 460 && SnapshotDerive.minutes(of: "24:00") == nil
        && SnapshotDerive.minutes(of: "07:60") == nil && SnapshotDerive.minutes(of: "abc") == nil)

print("\n== 7. 样例文件与 Swift 内嵌字符串逐字节一致 ==")
// 多候选路径：从 `macos/` 里跑（verify.sh 就是这么跑的）和从仓库根目录跑都能找到。
// 早先写死单一相对路径，在仓库根目录手工跑时第 7 项会假红一次——**自检工具自己也不该依赖 cwd**。
let sampleCandidates = ["Samples/snapshot.sample.json", "macos/Samples/snapshot.sample.json"]
    .map { URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent($0) }
let sampleFile = sampleCandidates.first { FileManager.default.fileExists(atPath: $0.path) }
    ?? sampleCandidates[0]
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

print("\n== 9. 目录身份验证（v3.7.8 P1：宿主只认自己的容器）==")
// 用一个临时目录冒充「Widget 容器」——验证器只认传进去的那个目录，正好可测。
// 这里钉的是「哪种情况必须失败」：这些判断错了不会报错，只会把错目录当成对的。
let verifyRoot = URL(fileURLWithPath: NSTemporaryDirectory())
    .appendingPathComponent("td-verify-smoke-\(UUID().uuidString)", isDirectory: true)
try? FileManager.default.createDirectory(at: verifyRoot, withIntermediateDirectories: true)

func requestJSON(
    _ nonce: String,
    createdAt: Date,
    type: String = WidgetVerifyProtocol.requestType,
    version: Int = 1
) -> String {
    "{\"protocol\": \(version), \"type\": \"\(type)\", \"nonce\": \"\(nonce)\", "
        + "\"createdAt\": \"\(WidgetVerifyProtocol.timestamp(createdAt))\"}"
}

@discardableResult
func writeRequestFile(_ name: String, _ json: String, into directory: URL = verifyRoot) -> Bool {
    (try? Data(json.utf8).write(to: directory.appendingPathComponent(name))) != nil
}

func responseObject(_ nonce: String, in directory: URL = verifyRoot) -> [String: Any]? {
    let url = directory.appendingPathComponent(WidgetVerifyProtocol.responseName(nonce: nonce))
    guard let data = try? Data(contentsOf: url),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return nil }
    return object
}

func fileCount(in directory: URL) -> Int {
    (try? FileManager.default.contentsOfDirectory(atPath: directory.path))?.count ?? -1
}

let verifyNow = date(2026, 11, 13, 15, 0)
let nonceA = "8f1c2d4e-0a1b-4c2d-9e3f-5a6b7c8d9e0f"

// ① 合法请求 → 通过，响应内容对得上
writeRequestFile(WidgetVerifyProtocol.requestName(nonce: nonceA),
                 requestJSON(nonceA, createdAt: verifyNow.addingTimeInterval(-5)))
let okOutcome = ContainerVerifier.verify(nonce: nonceA, directory: verifyRoot, now: verifyNow)
check("合法请求 → 验证通过", okOutcome.ok && okOutcome.failure == nil, okOutcome.detail)
let okResponse = responseObject(nonceA)
check("响应 nonce 与请求一致", okResponse?["nonce"] as? String == nonceA, "\(okResponse?["nonce"] ?? "nil")")
check("响应 ok = true、protocol = 1、type = result",
      okResponse?["ok"] as? Bool == true
        && okResponse?["protocol"] as? Int == 1
        && okResponse?["type"] as? String == WidgetVerifyProtocol.responseType)
check("响应里不带本地绝对路径",
      !((okResponse?["detail"] as? String) ?? "").contains("/Users"))

// ② nonce 不合法：一律拒绝，且**一个文件都不碰**（它会被拼进文件名）
let countBefore = fileCount(in: verifyRoot)
check("nonce 为 nil → nonce-invalid",
      ContainerVerifier.verify(nonce: nil, directory: verifyRoot, now: verifyNow).failure == .nonceInvalid)
check("nonce 为空串 → nonce-invalid",
      ContainerVerifier.verify(nonce: "", directory: verifyRoot, now: verifyNow).failure == .nonceInvalid)
check("nonce 含路径穿越 → nonce-invalid",
      ContainerVerifier.verify(nonce: "../../etc/passwd", directory: verifyRoot, now: verifyNow).failure
        == .nonceInvalid)
check("nonce 过长（65 位）→ nonce-invalid",
      ContainerVerifier.verify(nonce: String(repeating: "a", count: 65), directory: verifyRoot, now: verifyNow)
        .failure == .nonceInvalid)
check("非法 nonce 不产生任何文件", fileCount(in: verifyRoot) == countBefore,
      "\(countBefore) → \(fileCount(in: verifyRoot))")

// ③ 请求文件不存在（**用户选错目录时最常走到的分支**）
let nonceMissing = "11111111-2222-3333-4444-555555555555"
let missingOutcome = ContainerVerifier.verify(nonce: nonceMissing, directory: verifyRoot, now: verifyNow)
check("请求文件不存在 → request-missing", missingOutcome.failure == .requestMissing, missingOutcome.detail)
check("失败也写一份失败响应（网页能读到就不会干等）",
      responseObject(nonceMissing)?["ok"] as? Bool == false)
check("失败响应的 errorCode = request-missing",
      responseObject(nonceMissing)?["errorCode"] as? String == "request-missing")

// ④ 请求内容里的 nonce 与深链不一致
let nonceB = "22222222-3333-4444-5555-666666666666"
writeRequestFile(WidgetVerifyProtocol.requestName(nonce: nonceB), requestJSON(nonceA, createdAt: verifyNow))
check("请求内容 nonce 不一致 → nonce-mismatch",
      ContainerVerifier.verify(nonce: nonceB, directory: verifyRoot, now: verifyNow).failure == .nonceMismatch)

// ⑤ 过期 / 未来时间
let nonceExpired = "33333333-4444-5555-6666-777777777777"
writeRequestFile(WidgetVerifyProtocol.requestName(nonce: nonceExpired),
                 requestJSON(nonceExpired, createdAt: verifyNow.addingTimeInterval(-300)))
check("请求过期（5 分钟前）→ request-expired",
      ContainerVerifier.verify(nonce: nonceExpired, directory: verifyRoot, now: verifyNow).failure
        == .requestExpired)
let nonceFuture = "44444444-5555-6666-7777-888888888888"
writeRequestFile(WidgetVerifyProtocol.requestName(nonce: nonceFuture),
                 requestJSON(nonceFuture, createdAt: verifyNow.addingTimeInterval(600)))
check("请求时间在未来 → request-expired",
      ContainerVerifier.verify(nonce: nonceFuture, directory: verifyRoot, now: verifyNow).failure
        == .requestExpired)

// ⑥ 格式坏 / 协议版本不符
let nonceBroken = "55555555-6666-7777-8888-999999999999"
writeRequestFile(WidgetVerifyProtocol.requestName(nonce: nonceBroken), "{ 这不是 JSON")
check("请求不是 JSON → request-malformed",
      ContainerVerifier.verify(nonce: nonceBroken, directory: verifyRoot, now: verifyNow).failure
        == .requestMalformed)
let nonceVersion = "66666666-7777-8888-9999-aaaaaaaaaaaa"
writeRequestFile(WidgetVerifyProtocol.requestName(nonce: nonceVersion),
                 requestJSON(nonceVersion, createdAt: verifyNow, version: 99))
check("协议版本不符 → request-malformed",
      ContainerVerifier.verify(nonce: nonceVersion, directory: verifyRoot, now: verifyNow).failure
        == .requestMalformed)

// ⑦ 多个 nonce 互不覆盖（请求隔离）
let nonceG = "77777777-8888-9999-aaaa-bbbbbbbbbbbb"
let nonceH = "88888888-9999-aaaa-bbbb-cccccccccccc"
writeRequestFile(WidgetVerifyProtocol.requestName(nonce: nonceG), requestJSON(nonceG, createdAt: verifyNow))
writeRequestFile(WidgetVerifyProtocol.requestName(nonce: nonceH), requestJSON(nonceH, createdAt: verifyNow))
_ = ContainerVerifier.verify(nonce: nonceG, directory: verifyRoot, now: verifyNow)
_ = ContainerVerifier.verify(nonce: nonceH, directory: verifyRoot, now: verifyNow)
check("两个 nonce 的响应互不覆盖",
      responseObject(nonceG)?["nonce"] as? String == nonceG
        && responseObject(nonceH)?["nonce"] as? String == nonceH)

// ⑧ 容器算不出来 / 不存在 → 明确报错，不当成功
check("容器目录为 nil → container-unavailable",
      ContainerVerifier.verify(nonce: nonceA, directory: nil, now: verifyNow).failure == .containerUnavailable)
check("容器目录不存在 → container-unavailable",
      ContainerVerifier.verify(nonce: nonceA, directory: verifyRoot.appendingPathComponent("nope"), now: verifyNow)
        .failure == .containerUnavailable)

// ⑨ 响应写不进去 → **不得报告成功**
let readOnlyDir = verifyRoot.appendingPathComponent("readonly", isDirectory: true)
try? FileManager.default.createDirectory(at: readOnlyDir, withIntermediateDirectories: true)
let nonceDenied = "99999999-aaaa-bbbb-cccc-dddddddddddd"
writeRequestFile(WidgetVerifyProtocol.requestName(nonce: nonceDenied),
                 requestJSON(nonceDenied, createdAt: verifyNow), into: readOnlyDir)
try? FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: readOnlyDir.path)
let deniedOutcome = ContainerVerifier.verify(nonce: nonceDenied, directory: readOnlyDir, now: verifyNow)
try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: readOnlyDir.path)
check("响应写不进去 → 不得报告成功",
      !deniedOutcome.ok && deniedOutcome.failure == .responseWriteFailed, deniedOutcome.detail)

// ⑩ 残留清理：只删自己前缀、且超过 10 分钟的普通文件
let staleFile = verifyRoot.appendingPathComponent("td-verify-stale.res")
try? Data("x".utf8).write(to: staleFile)
try? FileManager.default.setAttributes([.modificationDate: verifyNow.addingTimeInterval(-3600)],
                                       ofItemAtPath: staleFile.path)
_ = ContainerVerifier.verify(nonce: nonceA, directory: verifyRoot, now: verifyNow) // 触发一次清理
check("超过 10 分钟的残留被清理", !FileManager.default.fileExists(atPath: staleFile.path))
check("新鲜的响应不会被清理",
      FileManager.default.fileExists(
        atPath: verifyRoot.appendingPathComponent(WidgetVerifyProtocol.responseName(nonce: nonceA)).path))

// ⑪ 深链分流：verify / refresh / 未知 host 各走各的
check("深链：verify 带 nonce",
      TeacherDeskDeepLink.parse(URL(string: "teacherdesk://verify?nonce=\(nonceA)")!) == .verify(nonce: nonceA))
check("深链：verify 缺 nonce → .verify(nil)",
      TeacherDeskDeepLink.parse(URL(string: "teacherdesk://verify")!) == .verify(nonce: nil))
check("深链：重复 nonce 参数 → .verify(nil)（不取第一个凑数）",
      TeacherDeskDeepLink.parse(URL(string: "teacherdesk://verify?nonce=a&nonce=b")!) == .verify(nonce: nil))
check("深链：refresh 行为不变",
      TeacherDeskDeepLink.parse(URL(string: "teacherdesk://refresh")!) == .refresh)
check("深链：refresh 带多余参数仍是 refresh",
      TeacherDeskDeepLink.parse(URL(string: "teacherdesk://refresh?x=1")!) == .refresh)
check("深链：未知 host 仍是 unknown（不会误进 verify）",
      TeacherDeskDeepLink.parse(URL(string: "teacherdesk://nope?nonce=\(nonceA)")!) == .unknown)

try? FileManager.default.removeItem(at: verifyRoot)

print("\n结果：\(checks - failures)/\(checks) 项通过" + (failures == 0 ? " —— 全绿" : " —— \(failures) 项失败"))
exit(failures == 0 ? 0 : 1)
