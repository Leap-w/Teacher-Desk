//
//  HostView.swift —— 宿主 App 的全部界面
//
//  界面上只有三样东西，**刻意没有第四样**：
//    1. 登录（用户名 + 密码，与 Web/PWA 同一套账号）
//    2. 同步状态与「立即同步」
//    3. 一条设置：Web/PWA 地址（点击 Widget 时打开哪儿）
//
//  这里不显示课表、不显示待办、不显示学生名单——那些是 Web 的活儿。
//  宿主 App 显示数据，会让教师以为「这里也能管事」，而它其实一个字节都改不了。
//

import SwiftUI

struct HostView: View {
    @EnvironmentObject private var state: AppState
    @Environment(\.openURL) private var openURL

    @State private var username = ""
    @State private var password = ""

    var body: some View {
        VStack(alignment: .leading, spacing: TDMetric.space4) {
            header
            Divider().overlay(TDColor.border)

            if state.account == nil {
                loginForm
            } else {
                signedInPanel
            }

            Divider().overlay(TDColor.border)
            webAddressField
            footer
        }
        .padding(TDMetric.space5)
        .frame(width: 420)
        .background(
            LinearGradient(colors: [Color.white, TDColor.primarySoft],
                           startPoint: .top, endPoint: .bottom)
        )
        // Widget 的兜底点击（没配 Web 地址时）落到这里：把窗口带到前台，让教师看到状态
        .onOpenURL { url in
            guard url.scheme == "teacherdesk" else { return }
            NSApp.activate(ignoringOtherApps: true)
            Task { await state.syncNow() }
        }
    }

    // MARK: - 头部

    private var header: some View {
        VStack(alignment: .leading, spacing: TDMetric.space1) {
            Text("TeacherDesk")
                .font(.title2.weight(.bold))
                .foregroundStyle(TDColor.text)
            Text("\(ClassroomDefaults.name) · Widget 数据同步")
                .font(TDFont.caption)
                .foregroundStyle(TDColor.textSecondary)
        }
    }

    // MARK: - 登录

    private var loginForm: some View {
        VStack(alignment: .leading, spacing: TDMetric.space2) {
            Text("用 TeacherDesk 的账号登录")
                .font(TDFont.bodyStrong)
                .foregroundStyle(TDColor.text)

            TextField("用户名", text: $username)
                .textFieldStyle(.roundedBorder)
                // **不是邮箱**：Web 侧实测过，控制台建的是「用户名」类型账号，
                // 用邮箱那套接口登不上（见 src/services/cloudbase.ts 的注释）
                .disableAutocorrection(true)

            SecureField("密码", text: $password)
                .textFieldStyle(.roundedBorder)
                .onSubmit { submit() }

            Button(action: submit) {
                Text(state.status == .working ? "登录中…" : "登录并同步")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(TDColor.primary)
            .disabled(state.status == .working)
        }
    }

    private func submit() {
        Task { await state.signIn(username: username, password: password) }
    }

    // MARK: - 已登录

    private var signedInPanel: some View {
        VStack(alignment: .leading, spacing: TDMetric.space3) {
            if let account = state.account {
                HStack(spacing: TDMetric.space2) {
                    Image(systemName: "person.crop.circle.fill")
                        .foregroundStyle(TDColor.primary)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(account.name)
                            .font(TDFont.bodyStrong)
                            .foregroundStyle(TDColor.text)
                        Text("已登录")
                            .font(TDFont.footnote)
                            .foregroundStyle(TDColor.textFaint)
                    }
                    Spacer(minLength: 0)
                }
            }

            statusLine
            snapshotSummary

            HStack(spacing: TDMetric.space2) {
                Button {
                    Task { await state.syncNow() }
                } label: {
                    Text(state.status == .working ? "同步中…" : "立即同步")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(TDColor.primary)
                .disabled(state.status == .working)

                Button("退出登录") {
                    Task { await state.signOut() }
                }
                .buttonStyle(.bordered)
            }
        }
    }

    private var statusLine: some View {
        HStack(spacing: TDMetric.space1) {
            Image(systemName: state.status.isFailed ? "exclamationmark.triangle.fill" : "arrow.triangle.2.circlepath")
                .font(.system(size: 10))
            // 失败时显示云端给的原话（不编「同步失败，请重试」——那会让教师反复点同一个按钮）
            Text(state.status.text)
                .font(TDFont.caption)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(state.status.isFailed ? TDColor.warningStrong : TDColor.textSecondary)
    }

    /// 同步下来了几条 —— 让教师一眼确认「Widget 里该有的东西都在」
    @ViewBuilder
    private var snapshotSummary: some View {
        if let snapshot = state.lastSnapshot {
            HStack(spacing: TDMetric.space3) {
                metric("课程", "\(snapshot.lessons.count)")
                metric("待办", "\(snapshot.todos.count)")
                metric("在读", "\(snapshot.students.active)")
            }
            .padding(TDMetric.space3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: TDMetric.radiusMedium, style: .continuous)
                .fill(Color.white.opacity(0.6)))
        }
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value)
                .font(TDFont.bodyStrong)
                .foregroundStyle(TDColor.primaryStrong)
            Text(label)
                .font(TDFont.footnote)
                .foregroundStyle(TDColor.textFaint)
        }
    }

    // MARK: - Web 地址设置

    private var webAddressField: some View {
        VStack(alignment: .leading, spacing: TDMetric.space1) {
            Text("TeacherDesk 网页地址")
                .font(TDFont.caption.weight(.semibold))
                .foregroundStyle(TDColor.textSecondary)
            TextField("https://…", text: $state.pwaBaseURL)
                .textFieldStyle(.roundedBorder)
                .disableAutocorrection(true)
            Text("点击 Widget 时打开这里。留空则点击只唤起本 App。")
                .font(TDFont.footnote)
                .foregroundStyle(TDColor.textFaint)
        }
    }

    // MARK: - 页脚

    private var footer: some View {
        Text("Widget 显示的是本 App 同步下来的那份数据，只读。数据的增删改仍然只在 TeacherDesk 网页里做。")
            .font(TDFont.footnote)
            .foregroundStyle(TDColor.textFaint)
            .fixedSize(horizontal: false, vertical: true)
    }
}
