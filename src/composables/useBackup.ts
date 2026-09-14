/**
 * 备份 / 恢复的界面入口（V3.0 起）。
 *
 * 分层规则是「页面只认识 stores 与 composables」。备份这类操作处理的是**整份数据集**
 * （导出 / 合并导入 / 两档清空 / 备份提醒），没有任何一个模块仓储能代表它，所以
 * 由这里转交 `repositories/backup/backupRepository.ts`——页面因此不需要认识
 * `services/storage` 与广播，仓库层也不必为「整份数据」造一个假的领域模型。
 *
 * 用的是**同一个单例对象**：`useBackup()` 只是取到它，重复调用不会产生第二份状态
 * （与 `backupRepository` 一样，它本身无状态）。
 */
import { backupRepository } from '@/repositories'

export function useBackup() {
  return backupRepository
}
