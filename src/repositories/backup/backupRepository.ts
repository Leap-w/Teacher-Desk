/**
 * 备份 / 恢复的原始读写通道（V3.0 起）。
 *
 * **为什么需要它**：工具箱的导出 / 合并导入 / 两档清空，以及首页的备份提醒，处理的是
 * **整份数据集**——包括本应用当前不认识的历史键与将来的新键，没有任何一个模块仓储能代表
 * 「全部数据」这件事。按 Repository First，这种访问也必须落在 repositories 层，于是这里
 * 开一个**窄口子**：它只是 `services/storage` 的端口与「通知其它标签页重载」的命名转发，
 * **不含任何业务判断**——合并口径在 `utils/backup.ts`，清空范围由工具箱决定。
 *
 * 因此页面（工具箱 / 首页提醒）不认识 localStorage，也不认识广播：只认识这个仓储。
 */
import { broadcastReload } from '@/services/sync'
import { localStoragePort } from '@/services/storage'

export const backupRepository = {
  /** 按原样读一个键（备份元信息、本模块不认识的历史键都要能读） */
  read(key: string): string | null {
    return localStoragePort.read(key)
  },

  /**
   * 按原样写一个键。写盘时刻由端口统一登记（`services/storage` 是全应用唯一写盘点），
   * 因此经这里的写入与 store 的写入在「最后写入胜出」里是同一套时间。
   */
  write(key: string, value: string): void {
    localStoragePort.write(key, value)
  },

  /** 原样删除一个键 */
  remove(key: string): void {
    localStoragePort.remove(key)
  },

  /** 列出盘上全部键（清空全部数据用；**不能写死键名**，否则历史键会漏网） */
  list(): string[] {
    return localStoragePort.list()
  },

  /**
   * 通知其它标签页重新加载。合并导入 / 清空之后必须调用：那些页面内存里还留着旧数据，
   * 不重载的话它下一次写盘会把刚导入的内容盖回去。
   */
  reloadPeers(): void {
    broadcastReload()
  },
}
