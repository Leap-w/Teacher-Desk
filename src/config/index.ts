/** 应用全局配置 */
export interface AppConfig {
  name: string
  version: string
  /** localStorage 键名前缀，避免与其他项目冲突 */
  storageKeyPrefix: string
}

export const appConfig: AppConfig = {
  name: 'TeacherDesk',
  /**
   * 应用版本：与 package.json 的 version 保持同步（交付打 tag 时一起改）。
   * 备份文件的元信息会带上它，用于日后诊断「这份备份出自哪个版本」（utils/backup.ts）。
   */
  version: '0.9.0',
  storageKeyPrefix: 'teacherdesk',
}
