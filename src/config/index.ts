/** 应用全局配置 */
import pkg from '../../package.json'

export interface AppConfig {
  name: string
  version: string
  /** localStorage 键名前缀，避免与其他项目冲突 */
  storageKeyPrefix: string
  /**
   * 腾讯云开发 CloudBase 环境 ID（Phase 9B）。
   * **空串＝没配**：云端同步整块不启用，应用照常按「纯本地」运行——
   * 这样源码在没填环境 ID 时也是可运行、可构建的，不会因为缺配置而白屏。
   */
  cloudEnvId: string
  /** 云端同步用的集合名（一个存储键 = 一份文档，见 `services/remote.ts`） */
  cloudCollection: string
  /** macOS 桌面小组件的快照桥配置（v3.7.0，见下） */
  widget: WidgetBridgeConfig
}

/**
 * macOS 桌面小组件的快照桥（v3.7.0）。
 *
 * **为什么路径要放这里**：Widget 读的是沙盒容器里的一个 JSON 文件，Web 侧要把它写到同一个
 * 位置。这条路的两端（Swift 的 `Shared/SnapshotStore.swift` 与这里）必须指向同一处，
 * 而「同一处」只能有一份定义——写死在两处，改一边就静默失联（表现是「同步说成功了，
 * Widget 一直没数据」，两边代码各自看都对）。规格 §六 明确要求：路径抽象成配置，
 * 不许把开发机绝对路径散落在代码里。
 *
 * 这里的默认值对应**本机固定路径方案**（规格 §六 方案 B）：
 *
 *   ~/Library/Containers/<Widget 扩展 bundle id>/Data/Library/Application Support/TeacherDesk/
 *
 * **为什么是「扩展的容器」而不是 App Group**（2026-09-30 核对本机环境后的结论）：
 * · macOS 的 Widget 扩展**必须开沙盒**才会出现在小组件库里（不开沙盒 = 构建成功但库里没有）；
 * · App Group 需要**真实 Team ID + 开发者账号**才能落地，而本机 `security find-identity`
 *   是 0 个签名身份（ad-hoc 签名）；
 * · 沙盒扩展读自己的容器**不需要任何 entitlement**，ad-hoc 签名即可 —— 于是
 *   「宿主 App 不沙盒 + 把快照写进扩展容器 + 扩展只读自己的容器」是这台机器上
 *   代价最小且能跑通的一条路（宿主 App 里的「打开快照文件夹」直接打开的就是它）。
 *
 * 换机器 / 换 bundle id 时改这里（或用构建变量 `VITE_WIDGET_CONTAINER_DIR` 覆盖），
 * Swift 侧的 `SnapshotStore` 也按同一顺序找文件，两边都认「多候选取最新」。
 */
export interface WidgetBridgeConfig {
  /** 快照文件名（两端共用，改这里要同步改 Swift） */
  snapshotFileName: string
  /** Widget 扩展的 bundle id —— 沙盒容器目录由它决定 */
  widgetBundleId: string
  /** 宿主 App 的 bundle id —— `teacherdesk://` 深链的注册者 */
  hostBundleId: string
  /**
   * 快照所在的**完整目录**（`~` 开头，可含环境变量展开）。
   * 教师第一次连接时要在文件选择框里「前往」到这里，所以它必须能整段复制粘贴。
   */
  containerDir: string
}

export const appConfig: AppConfig = {
  name: 'TeacherDesk',
  /**
   * 应用版本：单一来源 package.json（构建期读取，UI-5C 起不再手工同步）。
   * 备份文件的元信息会带上它，用于日后诊断「这份备份出自哪个版本」（utils/backup.ts）。
   */
  version: pkg.version,
  storageKeyPrefix: 'teacherdesk',
  /**
   * 环境 ID 不是秘密（它本来就会随前端代码发到浏览器里，访问与否由云端身份认证与
   * 集合安全规则决定），所以直接写在配置里；需要临时换环境时用构建变量覆盖即可。
   */
  cloudEnvId: import.meta.env.VITE_CLOUD_ENV_ID ?? 'teacher-desk-d6gdsgqb8f9dc13d2',
  cloudCollection: 'teacherdesk',
  widget: {
    snapshotFileName: 'widget-snapshot.json',
    widgetBundleId: 'com.teacherdesk.mac.widget',
    hostBundleId: 'com.teacherdesk.mac',
    containerDir:
      import.meta.env.VITE_WIDGET_CONTAINER_DIR ??
      '~/Library/Containers/com.teacherdesk.mac.widget/Data/Library/Application Support/TeacherDesk',
  },
}
