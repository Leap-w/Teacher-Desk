/** 应用全局配置 */
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
}

export const appConfig: AppConfig = {
  name: 'TeacherDesk',
  /**
   * 应用版本：与 package.json 的 version 保持同步（交付打 tag 时一起改）。
   * 备份文件的元信息会带上它，用于日后诊断「这份备份出自哪个版本」（utils/backup.ts）。
   */
  version: '1.1.1',
  storageKeyPrefix: 'teacherdesk',
  /**
   * 环境 ID 不是秘密（它本来就会随前端代码发到浏览器里，访问与否由云端身份认证与
   * 集合安全规则决定），所以直接写在配置里；需要临时换环境时用构建变量覆盖即可。
   */
  cloudEnvId: import.meta.env.VITE_CLOUD_ENV_ID ?? 'teacher-desk-d6gdsgqb8f9dc13d2',
  cloudCollection: 'teacherdesk',
}
