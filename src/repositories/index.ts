/**
 * Repository 层统一出口（V2.2.0-alpha · Phase Cloud-1）。
 *
 * **Repository First**：Store / 页面 / 工具一律经这里拿数据，不允许直接触碰
 * localStorage 或未来云端。各模块仓储的职责与播种口径见各自文件。
 */
export { SyncStatus } from './base/types'
export type {
  DataSourceAdapter,
  CollectionRepository,
  RepositoryResult,
  SaveResult,
} from './base/types'
export { createCollectionRepository } from './base/createCollectionRepository'
export { localStorageAdapter } from './adapters/LocalStorageAdapter'
export { cloudAdapter } from './adapters/CloudAdapter'
export { studentRepository } from './student/studentRepository'
export { seatRepository } from './seat/seatRepository'
export { seatConstraintRepository } from './seat/seatConstraintRepository'
export { leaveRepository } from './leave/leaveRepository'
export { dutyRepository } from './duty/dutyRepository'
export { weekendRepository } from './weekend/weekendRepository'
export { scheduleRepository } from './schedule/scheduleRepository'
export { taskRepository } from './task/taskRepository'
export { dashboardRepository } from './dashboard/dashboardRepository'
export { userProfileRepository, DEFAULT_USER_PROFILE } from './user/userProfileRepository'
export { syncQueueRepository, SYNC_QUEUE_STORAGE_KEY } from './sync/syncQueueRepository'
