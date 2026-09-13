/**
 * 个人资料仓储（V2.2.0-alpha · Phase Cloud-1）。
 *
 * 数据源：`teacherdesk:profile`（**单元素数组**，对齐备份模块「一个键 = 一个数组」
 * 的硬约束；键名不变）。`DEFAULT_USER_PROFILE` 一并迁入本文件（normalize 依赖它），
 * stores/user.ts 原样 re-export 保持既有导入路径可用。
 */
import { appConfig } from '@/config'
import { AVATAR_DATA_PREFIX, AVATAR_MAX_BYTES } from '@/types/user'
import type { UserProfile } from '@/types/user'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const PROFILE_KEY = `${appConfig.storageKeyPrefix}:profile`

/**
 * 默认资料：示例口径取自本班事实（高一9班 · 数学 · 班主任），教师随时可改。
 * 昵称默认「Gile Thomas」是需求文档的示例值——改昵称是「我的」页第一件事，不设谜语。
 */
export const DEFAULT_USER_PROFILE: UserProfile = {
  nickname: 'Gile Thomas',
  school: '昌都市第三高级中学',
  className: '高一9班',
  subject: '数学',
}

/**
 * 单份资料的健壮化（load / 跨标签页同步共用）：字段认不出回默认值、
 * 头像必须长得像图片 dataURL 且不超限——**绝不写盘**（只影响内存展示）。
 */
function normalizeProfile(raw: unknown): UserProfile {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<UserProfile>
  const nickname =
    typeof source.nickname === 'string' && source.nickname.trim()
      ? source.nickname.trim()
      : DEFAULT_USER_PROFILE.nickname
  const text = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value.trim() ? value.trim() : fallback
  const avatar =
    typeof source.avatar === 'string' &&
    source.avatar.startsWith(AVATAR_DATA_PREFIX) &&
    source.avatar.length <= AVATAR_MAX_BYTES
      ? source.avatar
      : undefined
  return {
    nickname,
    school: text(source.school, DEFAULT_USER_PROFILE.school),
    className: text(source.className, DEFAULT_USER_PROFILE.className),
    subject: text(source.subject, DEFAULT_USER_PROFILE.subject),
    avatar,
  }
}

/** 同步通道需要的数组形状：单对象包成单元素数组（键里始终只有一条资料） */
export function reviveProfileList(raw: unknown[]): UserProfile[] {
  return [normalizeProfile(raw[0])]
}

const repository = createCollectionRepository<UserProfile[]>({
  key: PROFILE_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveProfileList,
})

export const userProfileRepository = {
  ...repository,

  /**
   * 读单份资料：键里存的是「单元素数组」（对齐同步层），也容忍直接存对象的历史写法；
   * 读不出来按默认资料处理（不写盘，不影响下次启动再试）。
   */
  readProfile(): UserProfile {
    try {
      const raw = localStorageAdapter.readRaw(PROFILE_KEY)
      if (raw === null) return { ...DEFAULT_USER_PROFILE }
      const parsed: unknown = JSON.parse(raw)
      const source = Array.isArray(parsed) ? parsed[0] : parsed
      return normalizeProfile(source)
    } catch (error) {
      console.warn('[profile] 读不出来，按默认资料处理：', error)
      return { ...DEFAULT_USER_PROFILE }
    }
  },
}
