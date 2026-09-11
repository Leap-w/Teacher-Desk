//
//  TeacherDeskWidgetBundle.swift —— Widget 扩展的入口
//
//  扩展里 `@main` 只能有一个，就是这里。三个 Widget 的**顺序**就是它们在 Widget 库里的
//  顺序：今日课程 → 今日待办 → 班级概况（与工作台上三张卡片的先后一致）。
//
//  ⚠️ 这个 target 是 **Widget Extension**（不是 App），它的 Info.plist 里必须有
//  `NSExtension → NSExtensionPointIdentifier = com.apple.widgetkit-extension`，
//  少这一项的表现是「构建成功、但 Widget 库里一个都看不到」——排查时先看这里。
//

import WidgetKit
import SwiftUI

@main
struct TeacherDeskWidgetBundle: WidgetBundle {
    var body: some Widget {
        LessonWidget()
        TodoWidget()
        ClassWidget()
    }
}
