/**
 * Repository 层统一出口（V2.2.0-alpha · Phase Cloud-1）。
 *
 * **Repository First**：Store / 页面 / 工具一律经这里拿数据，不允许直接触碰
 * localStorage 或未来云端。各模块仓储的职责与播种口径见各自文件。
 */
export { SyncStatus } from './base/types'
export type { DataSourceAdapter, CollectionRepository } from './base/types'
export { createCollectionRepository } from './base/createCollectionRepository'
export { localStorageAdapter } from './adapters/LocalStorageAdapter'
export { studentRepository } from './student/studentRepository'
export { seatRepository } from './seat/seatRepository'
export { seatConstraintRepository } from './seat/seatConstraintRepository'
export { leaveRepository } from './leave/leaveRepository'
export { dutyRepository } from './duty/dutyRepository'
export { weekendRepository } from './weekend/weekendRepository'
export { holidayRepository, HOLIDAYS_KEY } from './holiday/holidayRepository'
export { holidayRecordRepository, HOLIDAY_RECORDS_KEY } from './holiday/holidayRecordRepository'
// v3.8.0（Phase 1A）：违纪管理数据层（`teacherdesk:violations`）
export { violationRepository, VIOLATIONS_KEY } from './violation/violationRepository'
// v3.8.1（Phase 3）：违纪自定义预设（`teacherdesk:violationPresets`；独立键、随同步/备份走）
export {
  violationPresetRepository,
  VIOLATION_PRESETS_KEY,
} from './violation/violationPresetRepository'
// v3.8.0（Phase 1B）：学生照片元数据（`teacherdesk:studentPhotos`；图片二进制在 IDB / 云存储）
export { studentPhotoRepository, STUDENT_PHOTOS_KEY } from './studentPhoto/studentPhotoRepository'
export { scheduleRepository } from './schedule/scheduleRepository'
export { semesterRepository } from './semester/semesterRepository'
export { substituteRepository, SUBSTITUTES_KEY } from './substitute/substituteRepository'
export { taskRepository } from './task/taskRepository'
export { userProfileRepository, DEFAULT_USER_PROFILE } from './user/userProfileRepository'
export { appSettingsRepository, DEFAULT_APP_SETTINGS } from './settings/appSettingsRepository'
export { syncQueueRepository, SYNC_QUEUE_STORAGE_KEY } from './sync/syncQueueRepository'
export {
  themeRepository,
  THEME_PREFERENCES,
  normalizeThemePreference,
} from './theme/themeRepository'
export type { ThemePreference } from './theme/themeRepository'
export { backupRepository } from './backup/backupRepository'
