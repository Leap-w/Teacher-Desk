/** 生成唯一 ID（优先使用浏览器原生 UUID，降级为时间戳 + 随机串） */
export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 示例数据的 id 前缀（逐条对应 `services/mock.ts` 的四个 createSeed*；
 * 教师自己录入的记录走 `createId()` 的 UUID / `id-` 前缀，两者不会撞车）。
 * 「清空示例数据」据此识别示例记录，改种子 id 前缀时**必须同步这里**。
 */
const SAMPLE_ID_PREFIXES = ['seed-', 'lesson-', 'todo-', 'leave-']

/** 是否为示例数据（services/mock.ts 播种、而非教师录入） */
export function isSampleRecordId(id: string): boolean {
  return SAMPLE_ID_PREFIXES.some((prefix) => id.startsWith(prefix))
}
