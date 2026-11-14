/**
 * 学生照片处理配置（v3.8.0 · Phase 1B）。
 *
 * **压缩参数集中在这里**：以后调整清晰度 / 尺寸只改本文件，不在图片管线里散落数字。
 * 配置本身是**代码级常量**：不进 localStorage、不参与同步、不参与备份。
 */

/** 图片处理参数（默认值按 Phase 1B 规格） */
export interface PhotoProcessingOptions {
  /** 原图最长边（px）。比它小的图**不放大** */
  fullMaxEdge: number
  /** 原图重编码 JPEG 质量（0–1） */
  fullQuality: number
  /** 缩略图最长边（px） */
  thumbMaxEdge: number
  /** 缩略图重编码 JPEG 质量（0–1） */
  thumbQuality: number
  /** 统一输出 MIME（canvas 重编码会顺带**剥掉 EXIF/GPS**） */
  outputMimeType: string
  /** 透明背景转 JPEG 时的填充色（不填会在 JPEG 里变黑） */
  background: string
}

/**
 * 默认处理参数：
 * - 原图 1600px / 0.82：投影、打印小尺寸都够用，典型 120–300KB；
 * - 缩略图 320px / 0.75：照片墙 2–4 列清晰，典型 15–40KB。
 * 两者都远小于云端与 IndexedDB 的能力上限，真正的约束是"备份/手机内存"与资源点预算。
 */
export const PHOTO_PROCESSING: Readonly<PhotoProcessingOptions> = {
  fullMaxEdge: 1600,
  fullQuality: 0.82,
  thumbMaxEdge: 320,
  thumbQuality: 0.75,
  outputMimeType: 'image/jpeg',
  background: '#ffffff',
}

/**
 * 私有文件的签名 URL 有效期（秒）。
 *
 * 官方规则：小于 1 秒拒绝、大于 3600 秒会告警；这里固定用 **3600**，
 * 并且**绝不持久化**签名 URL——过期后按 fileId 重新签发即可。
 */
export const PHOTO_SIGNED_URL_EXPIRES_IN = 3600

/**
 * 本地照片缓存的"软提示"阈值（字节）——**不是硬限制**。
 *
 * 规格明确不允许未经验证就设硬性上限；这里只给后续 UI 一个提示参考值（250MB）：
 * 超过时提示教师清理/备份，但**不阻止**继续保存。
 */
export const PHOTO_SOFT_WARNING_BYTES = 250 * 1024 * 1024

/** IndexedDB 媒体库名（独立于 macOS 小组件的 `teacherdesk-widget` 库） */
export const PHOTO_MEDIA_DB_NAME = 'teacherdesk-media'

/** IndexedDB 中两个 Object Store 的名字（原图 / 缩略图） */
export const PHOTO_MEDIA_STORES = {
  full: 'photos',
  thumb: 'thumbs',
} as const

/** 云端对象路径前缀（`teacherdesk-assets` 只是路径语义，不是独立 Bucket） */
export const PHOTO_STORAGE_ROOT = 'student-photos'
