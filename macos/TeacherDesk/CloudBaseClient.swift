//
//  CloudBaseClient.swift —— 宿主 App 与 CloudBase 之间的全部网络代码
//
//  ⚠️ **先读这段再改这个文件。**
//
//  这是整个 macOS 工程里唯一一处「照着别人的协议手写请求」的地方。Web 侧用的是官方
//  `@cloudbase/js-sdk`，我们这边没有等价的 Swift SDK，所以只能直接打它的网关。
//  换句话说：**这个文件是整份代码里最脆的一块**，SDK 换个版本就可能失效。
//  真失效了，症状是宿主 App 里登录/同步报错，而 Widget 那边显示「尚未同步数据」——
//  不会损坏任何数据（宿主 App 对云端只读）。
//
//  下面每条端点都不是猜的，出处都写在各自的位置上。三条硬事实：
//
//    1. 网关基址  https://{env}.api.tcloudbasegateway.com/v1
//       出处：`@cloudbase/js-sdk` 的 `app/src/constants/common.ts:90`
//    2. `init({env})` 不带 key 时，client_id **就是 env id 本身**
//       出处：`oauth/src/oauth2client/oauth2client.ts:441` —— `if (!options.clientId && options.env) options.clientId = options.env`
//       且凭据走 **Basic** 头：同文件 472 行 `Basic ${btoa(`${clientId}:${clientSecret}`)}`（此模式下 clientSecret 为空）
//       实测：`Authorization: Basic base64("<env>:")` → 返回 `INVALID_CREDENTIALS`（说明凭据被接受、真的去验了账号）；
//             不带这个头 → `MISSING_CREDENTIALS`。这一条是用 curl 打真网关试出来的，不是读代码推的。
//    3. 数据查询路径  {prefix}/collections/{collection}/documents?offset=&limit=
//       出处：`database/src/index.ts:286` 的 `getUrlPrefix`（instance/database 缺省都是 `(default)`）
//       与 313 行拼 URL 的那一行
//
//  与 Web 侧的对应关系（`src/services/cloudbase.ts`）：这里做的**就是**它的 `pull()`
//  ——同样 `limit(100)`、同样不写 where、同样按 key 挑出要的那几份。**没有发明新查询**。
//

import Foundation

enum CloudBaseClient {
    // MARK: - 配置

    /// 云环境 id（出处：`src/config/index.ts` 的 `cloudEnvId` 缺省值）
    static let envId = "teacher-desk-d6gdsgqb8f9dc13d2"

    /// 集合名（出处：`src/config/index.ts` 的 `cloudCollection`）
    static let collection = "teacherdesk"

    private static var gatewayBase: URL {
        // 力展开失败只会是拼错了字面量，属于编译期就该发现的问题
        URL(string: "https://\(envId).api.tcloudbasegateway.com/v1")!
    }

    /// 网关需要知道「是哪个应用在调」，缺省模式下就是 env id 本身（见文件头第 2 条）
    private static var basicAuthorization: String {
        "Basic " + Data("\(envId):".utf8).base64EncodedString()
    }

    // MARK: - 错误

    /// 出错的三种情形分开说，**不折成一句「网络错误」**（与 Web 侧 `toCloudError` 同一条纪律）。
    enum ClientError: LocalizedError {
        /// 没登录（或登录态已失效且刷新不回来）
        case notSignedIn
        /// 云端明确回了一个错误码
        case cloud(code: String, message: String)
        /// 连上了但回的东西读不懂
        case malformed(String)

        var errorDescription: String? {
            switch self {
            case .notSignedIn:
                return "还没有登录，或登录已过期，请重新登录"
            case .cloud(let code, let message):
                // 云端给了什么就显示什么。**不翻译、不改写**——教师拿着原文去搜，
                // 比拿着一句我们编的「同步失败，请重试」有用得多
                return "\(message)（\(code)）"
            case .malformed(let reason):
                return "云端返回的数据读不懂：\(reason)"
            }
        }
    }

    // MARK: - 登录

    /// 用**用户名 + 密码**登录。
    ///
    /// ⚠️ 是用户名，**不是邮箱**。Web 侧踩过这个坑：控制台建的是「用户名」类型账号，
    /// 走邮箱那套接口登不上（见 `src/services/cloudbase.ts` 里的注释）。
    static func signIn(username: String, password: String) async throws -> CloudAccount {
        var request = URLRequest(url: gatewayBase.appendingPathComponent("signin"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(basicAuthorization, forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "client_id": envId,
            "username": username,
            "password": password,
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfFailed(data: data, response: response)

        let payload = try decodeJSONObject(data)
        let credentials = try Credentials(fromSignInResponse: payload)
        let account = CloudAccount(
            uid: credentials.subject ?? "",
            // 云端没回用户名就用教师刚填的那个——总比界面上显示一片空白强
            name: (payload["user"] as? [String: Any])?["username"] as? String ?? username
        )
        store(credentials: credentials, account: account)
        return account
    }

    /// 恢复上次的登录态。**没有存过就返回 nil**（不抛错——「从没登录过」不是异常。
    /// 与 Web 侧「没有账号也不是异常」同一条纪律：那个 catch 会把「没登录」和「登录坏了」混在一起）。
    static func restoreSession() async throws -> CloudAccount? {
        guard let username = KeychainStore.get(.username) else { return nil }
        guard let credentials = loadCredentials() else { return nil }

        let fresh = try await refreshIfNeeded(credentials)
        return CloudAccount(uid: fresh.subject ?? "", name: username)
    }

    /// 退出登录：清 Keychain。
    ///
    /// **不去调 /v1/user/signout**：那需要把 token 发出去注销，成功了当然好，
    /// 失败了（比如断网）就变成「教师点了退出、其实没退成」——这种失败最不该发生。
    /// 本机凭据删掉，这台 Mac 上就再也拿不到数据了，这才是教师按「退出」时要的结果。
    static func signOut() async {
        KeychainStore.removeAll()
    }

    // MARK: - 取数

    /// 拉回那四份文档（学生 / 课程表 / 待办 / 座位方案）。
    ///
    /// 查询形状**照抄 Web 的 `pull()`**：`limit(100)`、不写 where、拿回来再按 key 挑。
    /// 没有为了「只取四条」去发明一个 where 语法——集合里统共就几份文档，
    /// 而少一个自造查询就少一处会随 SDK 版本失效的东西。
    static func fetchDocuments() async throws -> [CloudDocument] {
        guard let stored = loadCredentials() else { throw ClientError.notSignedIn }
        let credentials = try await refreshIfNeeded(stored)
        return try await fetchDocuments(with: credentials.accessToken)
    }

    private static func fetchDocuments(with accessToken: String) async throws -> [CloudDocument] {
        // instance 与 database 缺省都是 `(default)` —— 括号是字面量的一部分，不能省
        // （出处：`database/src/index.ts:284-286`）
        var components = URLComponents(
            url: gatewayBase.appendingPathComponent("database/instances/(default)/databases/(default)/collections/\(collection)/documents"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "offset", value: "0"),
            URLQueryItem(name: "limit", value: "100"),
            // 网关要求每个请求都带上 client_id（出处：oauth2client.ts:667）
            URLQueryItem(name: "client_id", value: envId),
        ]

        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfFailed(data: data, response: response)

        let rows = try documentsFromResponse(data)
        let wanted = Set(CloudKeys.wanted)
        return rows
            .compactMap { makeDocument(from: $0) }
            .filter { wanted.contains($0.key) }
    }

    // MARK: - 响应的解析（宽容读取，与 Web 侧 `revive*` 同款）

    /// 从查询响应里挖出文档数组。
    ///
    /// 宽容是有依据的：SDK 自己就同时兼容三种形状（`database/src/index.ts:336-340`）——
    /// `data` 直接是数组、`data.list` 是数组、或整份就是一个数组。我们照单全收，
    /// 免得后端哪天换了一种，这边就整片空白。
    private static func documentsFromResponse(_ data: Data) throws -> [[String: Any]] {
        let root = try decodeJSONObject(data)

        if let list = root["list"] as? [[String: Any]] { return list }
        if let list = root["documents"] as? [[String: Any]] { return list }
        // `data` 可能是对象（含 list），也可能是数组（本身就是文档列表）
        if let inner = root["data"] as? [[String: Any]] { return inner }
        if let inner = root["data"] as? [String: Any] {
            if let list = inner["list"] as? [[String: Any]] { return list }
            if let list = inner["documents"] as? [[String: Any]] { return list }
        }
        if root["data"] == nil && root["code"] == nil {
            throw ClientError.malformed("响应里找不到文档列表")
        }
        return []
    }

    /// 一行 → 一份文档。**键名或载荷对不上的行直接丢掉**（返回 nil），不猜、不补默认值：
    /// 这一层丢掉一条，`SnapshotBuilder` 那边就少一条，界面上的表现是「少显示了点什么」；
    /// 而如果这里硬凑一个空 payload 混进去，表现会是「待办全没了」——后者会让教师以为数据丢了。
    private static func makeDocument(from row: [String: Any]) -> CloudDocument? {
        // 云端主键两种写法都出现过：文档里存的 `key` 字段，与 Mongo 的 `_id`
        let key = (row["key"] as? String) ?? (row["_id"] as? String)
        guard let key, !key.isEmpty else { return nil }
        guard let payload = row["payload"], JSONSerialization.isValidJSONObject(["p": payload]) else { return nil }
        guard let payloadData = try? JSONSerialization.data(withJSONObject: payload) else { return nil }

        // updatedAt 可能是数字，也可能被包成 `{"$numberLong": "..."}` 之类的 EJSON 形态；
        // 认不出就记 0 —— 0 会让「更新于」显示成 1970，一眼看得出是没读到，不会被误当成真实时间
        return CloudDocument(key: key, payload: payloadData, updatedAt: numberValue(row["updatedAt"]) ?? 0)
    }

    private static func numberValue(_ any: Any?) -> Int64? {
        if let n = any as? NSNumber { return n.int64Value }
        if let n = any as? Int64 { return n }
        if let n = any as? Double { return Int64(n) }
        if let s = any as? String { return Int64(s) }
        if let dict = any as? [String: Any] {
            for key in ["$numberLong", "$numberInt", "value", "$numberDouble"] {
                if let inner = dict[key] { return numberValue(inner) }
            }
        }
        return nil
    }

    private static func decodeJSONObject(_ data: Data) throws -> [String: Any] {
        guard let object = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
            throw ClientError.malformed("不是合法的 JSON")
        }
        // 顶层直接是数组的情形：包一层再交给上面的挖掘逻辑
        if let array = object as? [[String: Any]] { return ["data": array] }
        guard let dict = object as? [String: Any] else {
            throw ClientError.malformed("顶层既不是对象也不是数组")
        }
        return dict
    }

    // MARK: - HTTP 层

    /// 非 2xx 一律抛错，并把云端给的 `code` / `message` 原样带上。
    ///
    /// **不把 401 吞掉换成一个空数组**：那样宿主 App 会「同步成功」地写下一份空快照，
    /// 三个 Widget 一起变成「今天暂无课程」——教师看着以为课表没了。
    /// 同步失败就该是失败的，界面上一句话说明白，Widget 继续用它手上那份旧数据。
    private static func throwIfFailed(data: Data, response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw ClientError.malformed("响应不是 HTTP")
        }
        guard !(200...299).contains(http.statusCode) else { return }

        let object = try? decodeJSONObject(data)
        let code = object?["code"] as? String ?? "HTTP_\(http.statusCode)"
        let message = object?["message"] as? String ?? "云端拒绝了这次请求"
        throw ClientError.cloud(code: code, message: message)
    }

    // MARK: - 凭据

    /// 一次登录拿到的三样东西。`access_token` 是个 JWT，`sub` 里就是用户 id——
    /// **本地解一下就够了**，不用再为「我是谁」多打一次 /v1/user/me
    /// （那会多一处会失效的端点，而这里解出来的只是拿来显示的名字）。
    private struct Credentials {
        var accessToken: String
        var refreshToken: String?
        var expiresAtMillis: Int64

        var subject: String? { Self.subject(ofJWT: accessToken) }

        init(accessToken: String, refreshToken: String?, expiresAtMillis: Int64) {
            self.accessToken = accessToken
            self.refreshToken = refreshToken
            self.expiresAtMillis = expiresAtMillis
        }

        init(fromSignInResponse object: [String: Any]) throws {
            // token 可能平铺在顶层，也可能包在 `data` 里
            let body = (object["data"] as? [String: Any]) ?? object
            guard let token = body["access_token"] as? String, !token.isEmpty else {
                throw ClientError.malformed("登录响应里没有 access_token")
            }
            accessToken = token
            refreshToken = body["refresh_token"] as? String
            let expiresIn = numberValue(body["expires_in"]) ?? 3600
            expiresAtMillis = Int64(Date().timeIntervalSince1970 * 1000) + expiresIn * 1000
        }

        /// 只解开 JWT 的第二段（载荷）读 `sub`。
        /// **不验签名**——这不是在做鉴权判断，token 有没有被篡改由云端说了算；
        /// 这里只是拿个显示用的 id，验签名反而会让这几行代码看起来像一道安全边界。
        private static func subject(ofJWT token: String) -> String? {
            let parts = token.split(separator: ".")
            guard parts.count >= 2 else { return nil }
            var base64 = String(parts[1])
                .replacingOccurrences(of: "-", with: "+")
                .replacingOccurrences(of: "_", with: "/")
            while base64.count % 4 != 0 { base64 += "=" }
            guard let data = Data(base64Encoded: base64),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { return nil }
            return (object["sub"] as? String) ?? (object["user_id"] as? String)
        }
    }

    private static func store(credentials: Credentials, account: CloudAccount) {
        KeychainStore.set(credentials.accessToken, for: .accessToken)
        if let refresh = credentials.refreshToken { KeychainStore.set(refresh, for: .refreshToken) }
        KeychainStore.set(String(credentials.expiresAtMillis), for: .expiresAtMillis)
        KeychainStore.set(account.name, for: .username)
        KeychainStore.set(account.uid, for: .uid)
    }

    private static func loadCredentials() -> Credentials? {
        guard let token = KeychainStore.get(.accessToken) else { return nil }
        return Credentials(
            accessToken: token,
            refreshToken: KeychainStore.get(.refreshToken),
            expiresAtMillis: Int64(KeychainStore.get(.expiresAtMillis) ?? "") ?? 0
        )
    }

    /// 快过期（或已经过期）就拿 refresh_token 换一个新的。
    ///
    /// 留 60 秒余量：正好卡在过期那一刻去请求，来回一趟就过点了。
    /// 刷新失败**不抛错**，而是把旧的 token 原样交回去——它可能其实还能用
    /// （比如本机时钟快了），让它去云端试一次，真不行那边会回 401，那时报的错才准确。
    private static func refreshIfNeeded(_ credentials: Credentials) async throws -> Credentials {
        let nowMillis = Int64(Date().timeIntervalSince1970 * 1000)
        guard credentials.expiresAtMillis - nowMillis < 60_000 else { return credentials }
        guard let refreshToken = credentials.refreshToken else { return credentials }

        var request = URLRequest(url: gatewayBase.appendingPathComponent("token"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(basicAuthorization, forHTTPHeaderField: "Authorization")
        // 出处：oauth2client.ts 的刷新分支 —— grant_type=refresh_token + client_id/secret + refresh_token
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "client_id": envId,
            "grant_type": "refresh_token",
            "refresh_token": refreshToken,
        ])

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse).map({ (200...299).contains($0.statusCode) }) == true,
              let object = try? decodeJSONObject(data),
              let refreshed = try? Credentials(fromSignInResponse: object)
        else { return credentials }

        KeychainStore.set(refreshed.accessToken, for: .accessToken)
        if let token = refreshed.refreshToken { KeychainStore.set(token, for: .refreshToken) }
        KeychainStore.set(String(refreshed.expiresAtMillis), for: .expiresAtMillis)
        return refreshed
    }
}
