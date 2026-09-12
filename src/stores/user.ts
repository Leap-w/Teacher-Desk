import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { appConfig } from '@/config'
import { readRaw } from '@/services/storage'
import { syncPersisted } from '@/services/sync'
import { AVATAR_DATA_PREFIX, AVATAR_MAX_BYTES } from '@/types/user'
import type { UserProfile, UserProfileInput } from '@/types/user'

const STORAGE_KEY = `${appConfig.storageKeyPrefix}:profile`

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
function reviveProfileList(raw: unknown[]): UserProfile[] {
  return [normalizeProfile(raw[0])]
}

/** 身份展示行：如「高一9班 班主任 · 数学教师」 */
export function identityLineOf(profile: UserProfile): string {
  return `${profile.className} 班主任 · ${profile.subject}教师`
}

/** 资料校验：昵称必填（页面上用它称呼教师） */
export function isProfileInputValid(input: UserProfileInput): boolean {
  return typeof input.nickname === 'string' && input.nickname.trim().length > 0
}

/**
 * 「我的」个人资料状态（V1.1.6）：读写唯一入口。
 * 数据源 `teacherdesk:profile`（单对象键）。**业务数据独立**：本 store 不引用任何
 * 业务 store，改资料不会碰学生 / 座位 / 课表（§11.1 单向依赖）。
 */
export const useUserStore = defineStore('user', () => {
  /**
   * 持久化形状是**单元素数组**（对齐备份模块「一个键 = 一个数组」的硬约束，
   * V1.1.6.1 起个人资料进入备份与云同步）；界面读写走下面的 `profile` computed。
   */
  const profileList = ref<UserProfile[]>([readProfile()])
  /** 资料版本号：头像换/删、字段保存时递增，界面不必深比较 dataURL */
  const revision = ref(0)

  syncPersisted(STORAGE_KEY, profileList, reviveProfileList)

  const profile = computed(() => profileList.value[0] ?? { ...DEFAULT_USER_PROFILE })

  function replaceProfile(next: UserProfile): void {
    profileList.value = [next]
  }

  function readProfile(): UserProfile {
    try {
      const raw = readRaw(STORAGE_KEY)
      if (raw === null) return { ...DEFAULT_USER_PROFILE }
      const parsed: unknown = JSON.parse(raw)
      // 键里存的是「单元素数组」（对齐同步层），也容忍直接存对象的历史写法
      const source = Array.isArray(parsed) ? parsed[0] : parsed
      return normalizeProfile(source)
    } catch (error) {
      console.warn('[profile] 读不出来，按默认资料处理：', error)
      return { ...DEFAULT_USER_PROFILE }
    }
  }

  /** 昵称（头部与编辑抽屉标题用） */
  const displayName = computed(() => profile.value.nickname)
  /** 昵称首字（未设头像时的占位） */
  const initial = computed(() => profile.value.nickname.charAt(0) || '师')

  /**
   * 保存资料字段；昵称为空时拒绝（返回原因）。
   * **整对象替换** = 一次写盘 + 一次广播（syncPersisted 统一收口）。
   */
  function updateProfile(input: UserProfileInput): { ok: true } | { ok: false; reason: string } {
    if (!isProfileInputValid(input)) return { ok: false, reason: '昵称不能为空' }
    replaceProfile({
      ...profile.value,
      nickname: input.nickname.trim(),
      school: input.school.trim(),
      className: input.className.trim(),
      subject: input.subject.trim(),
    })
    revision.value += 1
    return { ok: true }
  }

  /** 设置头像；只收图片 dataURL 且不超限，超限给出可读原因 */
  function setAvatar(dataUrl: string): { ok: true } | { ok: false; reason: string } {
    if (!dataUrl.startsWith(AVATAR_DATA_PREFIX)) {
      return { ok: false, reason: '只支持图片文件' }
    }
    // base64 体积 ≈ 原始 4/3；这里按 dataURL 总长保守判断
    if (dataUrl.length > AVATAR_MAX_BYTES) {
      return { ok: false, reason: '图片太大，请换一张小一点的' }
    }
    replaceProfile({ ...profile.value, avatar: dataUrl })
    revision.value += 1
    return { ok: true }
  }

  /** 删除头像（回到昵称首字占位） */
  function removeAvatar(): void {
    if (profile.value.avatar === undefined) return
    replaceProfile({ ...profile.value, avatar: undefined })
    revision.value += 1
  }

  return {
    profile,
    revision,
    displayName,
    initial,
    updateProfile,
    setAvatar,
    removeAvatar,
  }
})
