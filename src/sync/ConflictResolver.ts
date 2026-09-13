/**
 * 冲突解决器（V2.2.1-alpha · Phase Cloud-2）。
 *
 * 本阶段只有 **Local Wins**（默认，也是拍板口径的延续：Cloud-1 的
 * `services/cloudSync.ts` 用「最后写入胜出 + 示例数据豁免」，在本地是唯一编辑端时
 * 等价于 Local Wins）。Cloud Wins / Merge 留到 Cloud-3 按真实场景扩展——
 * 扩展点就是这里加策略分支，引擎与队列不动。
 */
import type { ConflictInput, ConflictResolution, ConflictStrategy } from './types'

export class ConflictResolver {
  private strategy: ConflictStrategy

  constructor(strategy: ConflictStrategy = 'local-wins') {
    this.strategy = strategy
  }

  get currentStrategy(): ConflictStrategy {
    return this.strategy
  }

  /** 切换策略（Cloud-3 起由用户偏好 / 键级配置驱动） */
  setStrategy(strategy: ConflictStrategy): void {
    this.strategy = strategy
  }

  /** 裁决一次冲突；未知策略按 local-wins 兜底（宁可保留教师的本地改动） */
  resolve(input: ConflictInput): ConflictResolution {
    switch (this.strategy) {
      case 'cloud-wins':
        return {
          strategy: 'cloud-wins',
          winner: 'cloud',
          reason: `远端版本 ${input.remoteVersion} 覆盖本地版本 ${input.localVersion}`,
        }
      case 'merge':
        // 本阶段不做字段级合并：占位为「保留两端」交由上层决定，仍按本地优先落地
        return {
          strategy: 'merge',
          winner: 'local',
          reason: '合并策略尚未实现，暂按本地优先落地（不丢本地改动）',
        }
      case 'local-wins':
      default:
        return {
          strategy: 'local-wins',
          winner: 'local',
          reason: `保留本地版本 ${input.localVersion}（远端 ${input.remoteVersion} 不覆盖）`,
        }
    }
  }

  /** 便捷判定：给定冲突是否应保留本地 */
  keepsLocal(input: ConflictInput): boolean {
    return this.resolve(input).winner === 'local'
  }
}
