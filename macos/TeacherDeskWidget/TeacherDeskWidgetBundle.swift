//
//  TeacherDeskWidgetBundle.swift —— Widget 扩展入口（v3.7.0）
//
//  本版**只有两个** Widget（规格 §一 / §二十七 明确不做其他）：
//    · 今日课程（small + medium）
//    · 一周课程表（large）
//

import SwiftUI
import WidgetKit

@main
struct TeacherDeskWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayScheduleWidget()
        WeekScheduleWidget()
    }
}
