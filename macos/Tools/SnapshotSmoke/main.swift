//
//  main.swift —— 本机就能跑的冒烟测试（Phase 12）
//
//  **它存在的理由**：这台机器上没有 Xcode，Widget 跑不起来、预览看不了。
//  但「快照能不能正确解出来」「星期换算对不对」「排序稳不稳」这些**跟界面无关**的事，
//  用 `swiftc` 编译成命令行程序就能真跑一遍——于是它们不该靠肉眼看代码来保证。
//
//  跑法（见 `macos/Tools/verify.sh`）：
//      swiftc -O -o /tmp/td-smoke Shared/*.swift Tools/SnapshotSmoke/main.swift && /tmp/td-smoke
//
//  ⚠️ 文件名必须是 `main.swift`：swiftc 只允许名为 main.swift 的文件里写顶层语句，
//  所以这里是一个「目录 + main.swift」而不是单个文件——改名会让它编译不过。
//
//  ⚠️ 这里**不是** Widget 的测试：WidgetKit 的渲染、时间线调度、点按跳转都在 Xcode 里，
//  本机验不了（`verify.sh` 会在末尾如实说明这件事，不假装验过了）。
//
//  与 Web 侧常驻测试（Phase 9C，`src/__tests__/`）同一条纪律：
//  **断言名要说清「坏了会导致什么」**，而不是「assertEquals(a, b)」。
//

import Foundation

// MARK: - 极简断言（不引入 XCTest：命令行里跑，越少依赖越好）

var passed = 0
var failures: [String] = []

func check(_ condition: Bool, _ what: String) {
    if condition {
        passed += 1
    } else {
        failures.append(what)
    }
}

func checkEqual<T: Equatable>(_ lhs: T, _ rhs: T, _ what: String) {
    if lhs == rhs {
        passed += 1
    } else {
        failures.append("\(what)（得到 \(lhs)，期望 \(rhs)）")
    }
}

// MARK: - 样例云端文档（形状抄自 src/services/cloudbase.ts：一存储键一份文档）

func document(_ key: String, _ payloadJSON: String, updatedAt: Int64) -> CloudDocument {
    CloudDocument(key: key, payload: Data(payloadJSON.utf8), updatedAt: updatedAt)
}

let studentsJSON = """
[
  {"id":"s1","name":"张三","studentNo":"2026001"},
  {"id":"s2","name":"李四","studentNo":"2026002"},
  {"id":"s3","name":"王五","studentNo":"2026003","deletedAt":"2026-09-01T02:00:00.000Z"}
]
"""

let timetableJSON = """
[
  {"id":"l1","weekday":1,"period":5,"subject":"班会","classId":"class-高一9班","className":"高一9班","teacher":"我"},
  {"id":"l2","weekday":1,"period":1,"subject":"数学","classId":"class-高一9班","className":"高一9班","teacher":"我","location":"A 栋 302"},
  {"id":"l3","weekday":1,"period":3,"subject":"数学","classId":"class-高一7班","className":"高一7班","teacher":"我","isTemporary":true},
  {"id":"l4","weekday":9,"period":2,"subject":"不存在的星期","classId":"x","className":"x","teacher":"我"},
  {"id":"l5","weekday":2,"period":0,"subject":"不存在的节次","classId":"x","className":"x","teacher":"我"},
  {"id":"l6","weekday":2,"period":2,"subject":"","classId":"x","className":"x","teacher":"我"}
]
"""

let todosJSON = """
[
  {"id":"t1","text":"收齐体检表","done":false},
  {"id":"t2","text":"","done":false},
  {"id":"t3","text":"确认留校名单","done":true}
]
"""

let seatPlansJSON = """
[
  {"id":"p1","name":"开学初","createdAt":"2026-09-01T00:00:00.000Z","updatedAt":"2026-09-01T01:30:00.000Z","isCurrent":false,"seats":[],"changeLogs":[]},
  {"id":"p2","name":"第一次月考后","createdAt":"2026-09-10T00:00:00.000Z","updatedAt":"2026-09-10T09:15:00.000Z","isCurrent":true,"seats":[],"changeLogs":[]}
]
"""

let documents = [
    document(CloudKeys.students, studentsJSON, updatedAt: 1_756_000_000_000),
    document(CloudKeys.timetable, timetableJSON, updatedAt: 1_756_000_500_000),
    document(CloudKeys.todos, todosJSON, updatedAt: 1_755_999_000_000),
    document(CloudKeys.seatPlans, seatPlansJSON, updatedAt: 1_756_000_200_000),
]

let snapshot = SnapshotBuilder.build(
    documents: documents,
    classroomName: "高一9班",
    pwaBaseURL: "https://example.com/teacherdesk/",
    now: Date(timeIntervalSince1970: 1_756_001_000)
)

// MARK: - 1. 快照组装：非法条目被丢弃、合法的一条不少

checkEqual(snapshot.lessons.count, 3, "课表里 3 条合法记录应全部留下、3 条非法的全部丢弃")
checkEqual(snapshot.todos.count, 2, "空文本的待办应被丢弃（否则界面上会出现一行空白）")
checkEqual(snapshot.students.active, 2, "在读人数 = 没有 deletedAt 的学生数（source: stores/student.ts:48）")
checkEqual(snapshot.students.removed, 1, "已退档人数应单独算出来（界面上要用小字说出来）")
checkEqual(snapshot.seatPlan?.name, "第一次月考后", "当前方案应取 isCurrent 为 true 的那一个")
checkEqual(snapshot.classroomName, "高一9班", "班级名应原样带进快照")

// syncedAt 应取四份文档里最新的那份：否则「更新于」会比真实数据旧
checkEqual(snapshot.syncedAtMillis, 1_756_000_500_000, "「更新于」应取四份文档 updatedAt 的最大值")

// 没有 isCurrent 时的补位规则（source: stores/seat.ts:78-84 的 normalizePlans）
let noCurrentSnapshot = SnapshotBuilder.build(
    documents: [document(CloudKeys.seatPlans, """
    [{"id":"p1","name":"只有这一个","updatedAt":"2026-09-01T01:30:00.000Z","seats":[],"changeLogs":[]}]
    """, updatedAt: 1)],
    classroomName: "高一9班",
    pwaBaseURL: nil
)
checkEqual(noCurrentSnapshot.seatPlan?.name, "只有这一个", "一个 isCurrent 都没有时应取第一条（与 Web 的补位规则一致）")

// 云端缺某个键时不该整份失败
let partialSnapshot = SnapshotBuilder.build(documents: [], classroomName: "高一9班", pwaBaseURL: nil)
checkEqual(partialSnapshot.lessons.count, 0, "云端一份文档都没有时快照应为空，而不是报错")
checkEqual(partialSnapshot.students.active, 0, "没有学生文档时应为 0，而不是崩掉")

// MARK: - 2. 落盘再读回：编码/解码闭环（Widget 侧读的就是这条路径）

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
guard let encoded = try? encoder.encode(snapshot) else {
    print("✗ 快照编码失败")
    exit(1)
}
checkEqual(
    WidgetSnapshot.decode(from: encoded)?.todos.count, snapshot.todos.count,
    "写盘再读回应完全一致（不一致会让 Widget 显示的和宿主 App 同步的对不上）"
)

// 坏 JSON → 判「数据读取失败」，而不是当成「没有数据」
check(
    WidgetSnapshot.decode(from: Data("{ 这不是 JSON".utf8)) == nil,
    "坏掉的快照必须解不出来（判成空数据会让教师以为今天没课）"
)
// 版本比程序新 → 也拒绝（宁可不显示，也不用不认识的字段凑出一屏假数据）
check(
    WidgetSnapshot.decode(from: Data(#"{"schemaVersion":99}"#.utf8)) == nil,
    "快照版本高于本程序认识的上限时应拒绝解析"
)
// 缺字段 → 尽力而为：留下能用的部分
let lenient = WidgetSnapshot.decode(from: Data(#"""
{"schemaVersion":1,"generatedAtMillis":1,"classroomName":"高一9班",
 "todos":[{"text":"只有文本"},{"done":true},{"text":"  "}]}
"""#.utf8))
checkEqual(lenient?.todos.count, 1, "缺字段的待办应尽力解析：有文本的留下、空文本的丢弃")

// MARK: - 3. 星期换算（与 Web 的 weekdayOf 一日不差）

let calendar = Calendar(identifier: .gregorian)
func date(_ y: Int, _ m: Int, _ d: Int) -> Date {
    var components = DateComponents()
    components.year = y; components.month = m; components.day = d; components.hour = 10
    components.timeZone = TimeZone(identifier: "Asia/Shanghai")
    return calendar.date(from: components)!
}

// 2026-09-07 是周一，09-12 是周六，09-13 是周日（与 Web 侧 SSR 自检里用过的那几天一致）
checkEqual(SnapshotDerive.weekday(of: date(2026, 9, 7)), 1, "周一应算作 1（Web 的 Weekday 从周一起算）")
checkEqual(SnapshotDerive.weekday(of: date(2026, 9, 11)), 5, "周五应算作 5")
checkEqual(SnapshotDerive.weekday(of: date(2026, 9, 12)), 6, "周六应算作 6")
checkEqual(SnapshotDerive.weekday(of: date(2026, 9, 13)), 7, "**周日应算作 7**（Swift 原生是 1、JS 原生是 0，这里是两边唯一的换算点）")
check(SnapshotDerive.isWeekend(6) && SnapshotDerive.isWeekend(7) && !SnapshotDerive.isWeekend(5), "周末判定应为 6 / 7")

// MARK: - 4. 今日课程：筛选 + 排序

let mondayLessons = SnapshotDerive.lessons(on: 1, from: snapshot.lessons)
checkEqual(mondayLessons.map(\.period), [1, 3, 5], "周一的课应按节次升序（顺序错乱会让教师看错第几节）")
checkEqual(SnapshotDerive.lessons(on: 3, from: snapshot.lessons).count, 0, "没有课的星期应返回空（界面据此走空态）")

// MARK: - 5. 待办计数

let counts = SnapshotDerive.todoCounts(snapshot.todos)
checkEqual(counts.done, 1, "已完成计数应只数 done == true 的")
checkEqual(counts.total, 2, "总数应为过滤后的条数")
check(!SnapshotDerive.allTodosDone([]), "空列表不算「全部完成」（否则空态会显示成一片对勾）")
check(SnapshotDerive.allTodosDone([SnapshotTodo(id: "a", text: "x", done: true)]), "全部完成时应判为完成")

// MARK: - 6. 时间文案与深链

let fixedTime = Date(timeIntervalSince1970: 1_756_000_000) // 2025-08-24 前后，具体值不重要，格式才重要
check(SnapshotDerive.clockLabel(fixedTime).count == 5, "时间应为 HH:mm 五位（与 Web 的 formatClock 同格式）")
check(SnapshotDerive.clockLabel(fixedTime).contains(":"), "时间应带冒号")

checkEqual(
    WidgetLinks.url(for: .schedule, in: snapshot).absoluteString,
    "https://example.com/teacherdesk/#/schedule",
    "配了 Web 地址时应拼成「基址 + 哈希路由」，且**不能**多一个斜杠（多一个就 404）"
)
checkEqual(
    WidgetLinks.url(for: .students, in: nil).absoluteString, "teacherdesk://open",
    "没配 Web 地址时应退回打开宿主 App，而不是生成一个点不开的链接"
)

// MARK: - 7. 结果

print("冒烟测试：通过 \(passed) 项，失败 \(failures.count) 项")
for failure in failures {
    print("  ✗ \(failure)")
}
if failures.isEmpty {
    print("✓ 快照组装 / 解码 / 星期换算 / 筛选排序 / 计数 / 深链 全部通过")
    exit(0)
} else {
    exit(1)
}
