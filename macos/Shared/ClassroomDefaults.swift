//
//  ClassroomDefaults.swift —— 班级名（**Web 侧是一个常量，这里如实复制一份**）
//
//  出处：`src/types/classroom.ts:41` 的 `DEFAULT_CLASSROOM_CONFIG.name`。
//  在 Web 那边它是「真实教室固定配置」的一部分（7 排 × 9 列 · 3-3-3 · 63 座），
//  班级名**不是用户数据**——学生档案里连 `className` 字段都没有，全应用只有这一个来源。
//
//  ⚠️ 所以这一行是**复制**而不是「读出来的」：换班级时要改两处（Web 的 classroom.ts 与这里）。
//  为什么不干脆让宿主 App 从课程数据里推：课程里的 `className` 是「这节课给哪个班上」，
//  教师本人带的不止一个班（高一9班、高一7班都在课表里），推出来的东西与「我的班是哪个」
//  根本不是一回事。数据里没有的信息，就不从别处凑。
//

import Foundation

enum ClassroomDefaults {
    /// 班级名
    static let name = "高一9班"
}
