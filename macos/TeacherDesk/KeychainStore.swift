//
//  KeychainStore.swift —— 登录凭据的存放处
//
//  为什么不跟快照放一块儿：快照是**给 Widget 读的**（就放在
//  `~/Library/Application Support/TeacherDesk/`，谁都打得开），而登录 token 不是。
//  把 token 和快照放进同一个目录，等于顺手把「谁能读你的云文档」也交了出去。
//
//  Keychain 是按**应用**隔离的，而且没有配 Keychain 共享组，
//  所以 Widget 扩展拿不到这里的任何东西。这不是靠命名区分，是系统在管。
//
//  这一层只做三件事：存、取、删。不碰网络，不懂 CloudBase。
//

import Foundation
import Security

enum KeychainStore {
    /// 服务名。取成 bundle id 是为了让「这是谁存的」在钥匙串访问.app 里一眼认得出。
    private static let service = "com.teacherdesk.mac.cloudbase"

    enum Key: String {
        case accessToken
        case refreshToken
        /// access_token 的过期时刻（毫秒时间戳，字符串存）
        case expiresAtMillis
        /// 登录用的用户名（下次恢复会话时用来在界面上显示「登录的是谁」）
        case username
        /// 云端返回的用户 id（从 token 里解出来；解不出就是空）
        case uid
    }

    // MARK: - 写

    /// 存一个值。已存在就覆盖（`SecItemUpdate` 而不是先删再加，
    /// 免得中间那一瞬间凭据是不存在的——那期间恰好同步就会莫名其妙地掉登录）。
    @discardableResult
    static func set(_ value: String, for key: Key) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]
        let data = Data(value.utf8)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            // 只在本机可用，且**不随 iCloud 钥匙串漫游**：
            // 这是「这台 Mac 上的这个 App 的登录态」，不是教师要在多设备间共享的密码
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]

        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess { return true }
        guard status == errSecItemNotFound else { return false }

        var insert = query
        insert.merge(attributes) { _, new in new }
        return SecItemAdd(insert as CFDictionary, nil) == errSecSuccess
    }

    // MARK: - 读

    static func get(_ key: Key) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let text = String(data: data, encoding: .utf8)
        else { return nil }
        return text
    }

    // MARK: - 删

    static func remove(_ key: Key) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]
        SecItemDelete(query as CFDictionary)
    }

    /// 退出登录时清干净。**别漏项**：留下一个 refresh_token，等于「退出」之后
    /// 下一次打开还能悄悄登回去，而教师以为自己已经退出了。
    static func removeAll() {
        for key in [Key.accessToken, .refreshToken, .expiresAtMillis, .username, .uid] {
            remove(key)
        }
    }
}
