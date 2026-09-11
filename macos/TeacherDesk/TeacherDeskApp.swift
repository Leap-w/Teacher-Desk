//
//  TeacherDeskApp.swift —— 宿主 App 的入口
//
//  ⚠️ **这不是 TeacherDesk 的桌面版**，别把它当成第二个客户端来长：
//  它不显示课表、不显示档案、没有工作台，一个业务页面都没有。它只干一件事——
//  把云端那四份文档变成一份只读快照，写进共享目录给 Widget 读。
//  真正干活的界面仍然只有 Web/PWA 一个（规格 §四）。
//
//  窗口刻意做成「一屏就装下」的小面板（`windowResizability(.contentSize)`）：
//  它不该被当成一个可以常驻的大窗口，教师平时根本不需要打开它——
//  Widget 的数据是它自动同步的，只有换账号 / 换 Web 地址时才需要进来点一下。
//

import SwiftUI

@main
struct TeacherDeskApp: App {
    @StateObject private var state = AppState()

    var body: some Scene {
        WindowGroup {
            HostView()
                .environmentObject(state)
                // 打开 App 时自动同步一次（规格 §一：打开系统时自动同步）
                .task { await state.autoSyncOnLaunch() }
        }
        .windowResizability(.contentSize)
        .defaultSize(width: 420, height: 520)
    }
}
