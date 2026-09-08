/** 应用全局配置 */
export interface AppConfig {
  name: string
  version: string
  /** localStorage 键名前缀，避免与其他项目冲突 */
  storageKeyPrefix: string
}

export const appConfig: AppConfig = {
  name: 'TeacherDesk',
  version: '0.1.0',
  storageKeyPrefix: 'teacherdesk',
}
