//
//  CloudDocuments.swift —— 云端文档的形状与键名
//
//  这里描述的**就是 Web 侧 Phase 9B 已经在用的东西**，一个字段都没有发明：
//
//    - 集合名与键名 → `src/config/index.ts`（`cloudCollection` / `storageKeyPrefix`）
//    - 一存储键一份文档、`{ key, payload, updatedAt }` 三字段 → `src/services/cloudbase.ts`
//    - `payload` 就是 Web 各 store 写进 localStorage 的那个数组原文（**不是**包了一层的对象）
//
//  ⚠️ 两侧必须对齐的只有一处：**payload 的形状由 Web 决定**。Web 改了某个字段名，
//  这里要跟着改；改了而没跟着改的表现是「Widget 少显示一样东西」或「那条记录被丢弃」，
//  不会把云端数据改坏（宿主 App 对云端**只读**，从不写回）。
//

import Foundation

/// Widget 要用到的四个存储键（其余四个键——请假 / 值日 / 周末返家 / 座位约束——Widget 不显示，
/// 因此**不拉取、不解析、不进快照**：少一份数据就少一份出错和泄漏的面）
enum CloudKeys {
    /// 键前缀（出处：`src/config/index.ts` 的 `storageKeyPrefix`）
    static let prefix = "teacherdesk"

    /// 学生档案（班级概况用：数人数）
    static let students = "\(prefix):students"
    /// 课程表（今日课程用）
    static let timetable = "\(prefix):timetable"
    /// 今日待办（待办 Widget 用）
    static let todos = "\(prefix):dashboard:todos"
    /// 座位方案（班级概况用：当前方案名）
    static let seatPlans = "\(prefix):seatPlans"

    /// 要拉取的键（顺序无关，但定下来便于日志对照）
    static let wanted = [students, timetable, todos, seatPlans]
}

/// 云端拉回来的一份文档。
///
/// `payload` 保持**原始 JSON 字节**而不是解析成对象：解析的工作统一交给 `SnapshotBuilder`
/// （那里是纯函数、可被冒烟测试直接喂样例数据），这一层只负责「把网上来的东西原样搬回来」。
struct CloudDocument: Hashable {
    let key: String
    let payload: Data
    /// 这份文档在云端的写入时刻（毫秒时间戳；云端没给就记 0）
    let updatedAt: Int64
}

/// 云端用户信息（只用于界面显示「你登录的是谁」）
struct CloudAccount: Hashable {
    let uid: String
    let name: String
}
