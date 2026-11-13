//
//  ContainerVerifier.swift —— 目录身份验证器（v3.7.8 P1，纯 Foundation）
//
//  ## 它解决的是什么
//
//  机器上可能有两个都叫 `TeacherDesk` 的目录：
//
//      正确（Widget 扩展真正读的那一个）
//          ~/Library/Containers/com.teacherdesk.mac.widget/Data/Library/Application Support/TeacherDesk
//      历史遗留（v1.0.0 那版 macOS 工程留下的）
//          ~/Library/Application Support/TeacherDesk
//
//  `FileSystemDirectoryHandle` **不暴露绝对路径**，网页端只能比目录名，两个都一样 → 分不清。
//  于是改成「挑战—应答」：网页把带 nonce 的请求文件写进**用户选中的那个目录**，
//  宿主只在自己的真实容器里找它；找到即证明「用户选中的目录 == 扩展读的那个目录」。
//
//      <选中目录>/td-verify-<nonce>.req     ← 网页写（P2）
//      <容器>/td-verify-<nonce>.res         ← 宿主写（本文件），网页从**自己选中的目录**里读
//
//  选错目录时，响应写进了容器，网页在自己那个目录里永远读不到 → 超时 → 判失败。
//  **不需要本地服务、不需要浏览器回调、不需要 App Group。**
//
//  ## 为什么放在 Shared 而不是 TeacherDesk/
//
//  同 `SnapshotStore` 的先例：**只有宿主会调用它**（Widget 扩展里没有任何调用点，编进去也只是一段
//  死代码），但放在 Shared 才能被 `Tools/SnapshotSmoke` 用 swiftc 直接编译进冒烟程序——
//  于是「哪种情况必须失败」这些**错了也不会报错、只会悄悄把错目录当成对的**的判断，能在命令行里钉住。
//
//  ## 安全边界（别当成系统级安全）
//
//  · nonce 一次一用、2 分钟有效、只允许 `[A-Za-z0-9-]`（**绝不把外部字符串拼进路径**）；
//  · 宿主只读**自己算出来的容器目录**，不接受任何外部传入的路径；
//  · 响应只写 nonce / 结果 / 时间 / 错误码，**不回传本地绝对路径**；
//  · 它防的是「用户选错目录」，不是「本机恶意软件伪造响应文件」——后者超出本机单用户威胁模型。
//

import Foundation

/// 验证协议的常量与命名规则（Web 侧 P2 必须照这里的字面值实现，改一处就要两边一起改）
enum WidgetVerifyProtocol {
    /// 协议版本：请求与响应都必须带，且必须相等
    static let version = 1
    /// 请求文件的 `type` 字段
    static let requestType = "teacherdesk.widget.verify"
    /// 响应文件的 `type` 字段
    static let responseType = "teacherdesk.widget.verify.result"
    /// 文件名前缀（临时文件清理只碰这个前缀）
    static let filePrefix = "td-verify-"
    static let requestSuffix = ".req"
    static let responseSuffix = ".res"

    /// nonce 长度范围（UUID 是 36；放宽到 16…64 以便 Web 侧换生成方式）
    static let nonceLength = 16...64
    /// 请求有效期：超过这个时长一律判过期（同时是**重放窗口**的上界）
    static let validity: TimeInterval = 120
    /// 允许的时钟偏差：请求时间比现在晚这么多以内仍接受
    static let futureSkew: TimeInterval = 60
    /// 残留文件清理阈值：超过这个时长的 `td-verify-*` 会被顺手删掉
    static let staleAfter: TimeInterval = 600

    static func requestName(nonce: String) -> String { filePrefix + nonce + requestSuffix }
    static func responseName(nonce: String) -> String { filePrefix + nonce + responseSuffix }

    /// 时间戳格式：ISO 8601 带毫秒 + `Z`（Web 侧 `new Date().toISOString()` 同格式）
    static let timestampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static func timestamp(_ date: Date) -> String { timestampFormatter.string(from: date) }

    /// 解析时间戳：**带毫秒与不带毫秒都认**（手写/第三方生成的请求不至于因此被判坏）
    static func date(from text: String) -> Date? {
        if let parsed = timestampFormatter.date(from: text) { return parsed }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: text)
    }
}

/// 请求文件的结构（网页写入）
struct WidgetVerifyRequest: Decodable {
    /// JSON 里叫 `protocol`（Swift 关键字，用 CodingKeys 映射）
    let version: Int
    let type: String
    let nonce: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case version = "protocol"
        case type
        case nonce
        case createdAt
    }
}

/// 响应文件的结构（宿主写入，网页读取）
struct WidgetVerifyResponse: Encodable {
    let version: Int
    let type: String
    let nonce: String
    let ok: Bool
    let respondedAt: String
    let errorCode: String?
    let detail: String

    enum CodingKeys: String, CodingKey {
        case version = "protocol"
        case type
        case nonce
        case ok
        case respondedAt
        case errorCode
        case detail
    }
}

/// 失败原因（**每一种都单独可辨**，不统一成「没有权限」）
enum WidgetVerifyFailure: String {
    /// nonce 缺失 / 空 / 太长 / 含非法字符 —— 这时**不写任何文件**（外部字符串绝不进路径）
    case nonceInvalid = "nonce-invalid"
    /// 算不出或找不到 Widget 容器目录（沙盒内运行 / 扩展没装过）
    case containerUnavailable = "container-unavailable"
    /// 容器里没有本次 nonce 的请求文件（**多半是用户选错了目录**）
    case requestMissing = "request-missing"
    /// 请求文件存在但读不出来
    case requestUnreadable = "request-unreadable"
    /// JSON 坏 / 缺字段 / 协议版本或 type 不符 / createdAt 不是时间
    case requestMalformed = "request-malformed"
    /// 请求文件里的 nonce 与深链里的不一致
    case nonceMismatch = "nonce-mismatch"
    /// 请求超过有效期（或时间戳在未来且超出允许偏差）
    case requestExpired = "request-expired"
    /// 验证通过但响应写不进去 —— **不得当成成功**
    case responseWriteFailed = "response-write-failed"
}

/// 一次验证的结果（`responseURL` / `requestURL` 只用于日志，**不进响应 JSON**）
struct WidgetVerifyOutcome {
    let ok: Bool
    let failure: WidgetVerifyFailure?
    let detail: String
    let responseURL: URL?
    let requestURL: URL?

    static func failed(
        _ failure: WidgetVerifyFailure,
        _ detail: String,
        response: URL? = nil,
        request: URL? = nil
    ) -> WidgetVerifyOutcome {
        WidgetVerifyOutcome(
            ok: false, failure: failure, detail: detail, responseURL: response, requestURL: request
        )
    }
}

enum ContainerVerifier {
    /// nonce 合法性：长度 + 字符集。
    ///
    /// 字符集是硬约束——nonce 会拼进文件名，`../` 这类东西必须在**这一步**就被挡掉，
    /// 不能指望后面的路径拼接"应该没问题"。
    static func isValidNonce(_ nonce: String) -> Bool {
        guard WidgetVerifyProtocol.nonceLength.contains(nonce.count) else { return false }
        let allowed = CharacterSet(
            charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"
        )
        return nonce.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    /// 核对一次验证请求。
    ///
    /// - Parameters:
    ///   - nonce: 深链里带来的 nonce（nil = 没给 / 重复 / 空）
    ///   - directory: **必须是 `SnapshotStore.widgetContainerDirectory`**（宿主真实写入的那一个）；
    ///     nil 表示算不出来（沙盒内运行）——不接受任何外部传入的路径
    ///   - now: 注入当前时间，便于自检
    static func verify(
        nonce: String?,
        directory: URL?,
        now: Date = Date()
    ) -> WidgetVerifyOutcome {
        // ① nonce 本身不合法：直接拒绝，**一个文件都不碰**（它会被拼进文件名）
        guard let nonce, isValidNonce(nonce) else {
            return .failed(.nonceInvalid, "nonce 缺失或格式非法（只允许 16…64 位 [A-Za-z0-9-]）")
        }

        // ② 容器目录必须存在（**不创建**：容器不在 = 扩展没装过，建一个空壳只会掩盖问题）
        guard let directory else {
            return .failed(.containerUnavailable, "算不出 Widget 容器目录（宿主跑在沙盒里？）")
        }
        var isDirectory: ObjCBool = false
        guard
            FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDirectory),
            isDirectory.boolValue
        else {
            return .failed(.containerUnavailable, "Widget 容器目录不存在")
        }

        // ③ 顺手清理残留（只碰自己的前缀、只碰超过 10 分钟的普通文件）
        pruneStaleFiles(in: directory, now: now)

        // ④ 请求文件必须**就在这个容器里**
        let requestURL = directory.appendingPathComponent(WidgetVerifyProtocol.requestName(nonce: nonce))
        guard FileManager.default.fileExists(atPath: requestURL.path) else {
            // 用户选错目录时最常走到这里：请求写进了另一个 TeacherDesk，宿主这里没有
            return fail(
                .requestMissing, "容器里没有本次 nonce 的请求文件", directory: directory,
                nonce: nonce, now: now, request: requestURL
            )
        }

        guard let data = try? Data(contentsOf: requestURL) else {
            return fail(
                .requestUnreadable, "请求文件读不出来", directory: directory, nonce: nonce, now: now,
                request: requestURL
            )
        }
        guard let request = try? JSONDecoder().decode(WidgetVerifyRequest.self, from: data) else {
            return fail(
                .requestMalformed, "请求文件不是合法 JSON 或缺字段", directory: directory,
                nonce: nonce, now: now, request: requestURL
            )
        }
        guard
            request.version == WidgetVerifyProtocol.version,
            request.type == WidgetVerifyProtocol.requestType
        else {
            return fail(
                .requestMalformed, "协议版本或请求类型不符", directory: directory, nonce: nonce,
                now: now, request: requestURL
            )
        }
        guard request.nonce == nonce else {
            return fail(
                .nonceMismatch, "请求文件里的 nonce 与深链不一致", directory: directory, nonce: nonce,
                now: now, request: requestURL
            )
        }
        guard let created = WidgetVerifyProtocol.date(from: request.createdAt) else {
            return fail(
                .requestMalformed, "createdAt 不是合法时间", directory: directory, nonce: nonce,
                now: now, request: requestURL
            )
        }
        let age = now.timeIntervalSince(created)
        guard age <= WidgetVerifyProtocol.validity else {
            return fail(
                .requestExpired, "请求已过期（超过 \(Int(WidgetVerifyProtocol.validity)) 秒）",
                directory: directory, nonce: nonce, now: now, request: requestURL
            )
        }
        guard age >= -WidgetVerifyProtocol.futureSkew else {
            return fail(
                .requestExpired, "请求时间在未来（超出允许的时钟偏差）", directory: directory,
                nonce: nonce, now: now, request: requestURL
            )
        }

        // ⑤ 走到这里才算「这个目录确实是 Widget 容器」——写成功响应
        guard
            let responseURL = writeResponse(
                .init(
                    version: WidgetVerifyProtocol.version,
                    type: WidgetVerifyProtocol.responseType,
                    nonce: nonce,
                    ok: true,
                    respondedAt: WidgetVerifyProtocol.timestamp(now),
                    errorCode: nil,
                    detail: "容器目录与选中目录一致"
                ),
                into: directory,
                nonce: nonce
            )
        else {
            // 验证逻辑通过了，但结果送不出去 → **不能算成功**（网页收不到就等于没验过）
            return .failed(.responseWriteFailed, "验证通过，但响应文件写不进去", request: requestURL)
        }
        NSLog("[widget-verify] ok nonce=%@", nonce)
        return WidgetVerifyOutcome(
            ok: true, failure: nil, detail: "验证通过", responseURL: responseURL, requestURL: requestURL
        )
    }

    // MARK: - 内部

    /// 失败时**尽可能**也写一份失败响应（网页可能看得到，比如请求只是过期了）；
    /// 写不进去也不改变「失败」这个结论。
    private static func fail(
        _ failure: WidgetVerifyFailure,
        _ detail: String,
        directory: URL,
        nonce: String,
        now: Date,
        request: URL?
    ) -> WidgetVerifyOutcome {
        let responseURL = writeResponse(
            .init(
                version: WidgetVerifyProtocol.version,
                type: WidgetVerifyProtocol.responseType,
                nonce: nonce,
                ok: false,
                respondedAt: WidgetVerifyProtocol.timestamp(now),
                errorCode: failure.rawValue,
                detail: detail
            ),
            into: directory,
            nonce: nonce
        )
        if responseURL == nil {
            NSLog("[widget-verify] failed(%@) 且响应写入失败：%@", failure.rawValue, detail)
        } else {
            NSLog("[widget-verify] failed(%@)：%@", failure.rawValue, detail)
        }
        return .failed(failure, detail, response: responseURL, request: request)
    }

    /// 原子写响应文件（`.atomic` 会先写同目录临时文件再改名，网页不会读到半成品）
    private static func writeResponse(
        _ payload: WidgetVerifyResponse,
        into directory: URL,
        nonce: String
    ) -> URL? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(payload) else {
            NSLog("[widget-verify] 响应编码失败")
            return nil
        }
        let url = directory.appendingPathComponent(WidgetVerifyProtocol.responseName(nonce: nonce))
        do {
            try data.write(to: url, options: [.atomic])
            return url
        } catch {
            NSLog("[widget-verify] 响应写入失败：%@", error.localizedDescription)
            return nil
        }
    }

    /// 清理残留：只删「自己前缀 + 普通文件 + 超过 staleAfter」的条目。
    ///
    /// 保守到什么程度：不删目录、不删刚写的文件（网页可能正在读）、失败静默——
    /// 清理失败绝不影响验证结论。
    private static func pruneStaleFiles(in directory: URL, now: Date) {
        let manager = FileManager.default
        guard let names = try? manager.contentsOfDirectory(atPath: directory.path) else { return }
        for name in names where name.hasPrefix(WidgetVerifyProtocol.filePrefix) {
            let url = directory.appendingPathComponent(name)
            guard
                let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .contentModificationDateKey]),
                values.isRegularFile == true,
                let modified = values.contentModificationDate,
                now.timeIntervalSince(modified) > WidgetVerifyProtocol.staleAfter
            else { continue }
            try? manager.removeItem(at: url)
        }
    }
}
