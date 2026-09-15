/** 生成唯一 ID（优先使用浏览器原生 UUID，降级为时间戳 + 随机串） */
export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 示例数据的 id 前缀（逐条对应 `services/mock.ts` 的五个 createSeed*；
 * 教师自己录入的记录走 `createId()` 的 UUID / `id-` 前缀，两者不会撞车）。
 * 「清空示例数据」据此识别示例记录，改种子 id 前缀时**必须同步这里**。
 *
 * 注意 `duty-settings`（轮换设置，值日数组里的单例记录）**也以 `duty-` 开头**，
 * 但它是设置不是示例数据，因此 `utils/backup.ts` 的值日分支只对 `kind === 'group'`
 * 应用前缀判定——不靠「id 正好不撞前缀」这种巧合。
 */
const SAMPLE_ID_PREFIXES = ['seed-', 'lesson-', 'leave-', 'duty-', 'weekend-']

/** 是否为示例数据（services/mock.ts 播种、而非教师录入） */
export function isSampleRecordId(id: string): boolean {
  return SAMPLE_ID_PREFIXES.some((prefix) => id.startsWith(prefix))
}
