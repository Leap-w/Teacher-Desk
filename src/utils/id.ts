/** 生成唯一 ID（优先使用浏览器原生 UUID，降级为时间戳 + 随机串） */
export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
