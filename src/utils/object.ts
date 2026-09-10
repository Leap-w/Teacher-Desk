/**
 * 对象形状守卫（跨模块共享）。
 *
 * 住在这里的原因：数据备份（utils/backup.ts）与值日记录健壮化（utils/duty.ts）
 * 各自写过一份**逐字相同**的 `isPlainObject`——两份副本就会漂移（§11.1 单一来源）。
 * 这里是它唯一的家。
 */

/** 是否为「非空对象」——数组也是对象，需要单独排除 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
