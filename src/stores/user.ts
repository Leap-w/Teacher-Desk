import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { AVATAR_DATA_PREFIX, AVATAR_MAX_BYTES } from '@/types/user'
import {
  DEFAULT_USER_PROFILE,
  userProfileRepository,
} from '@/repositories/user/userProfileRepository'
import type { UserProfile, UserProfileInput } from '@/types/user'

// 默认资料与其健壮化规则已迁入仓储（Phase Cloud-1）；转发导出保持既有导入路径（含测试）
export { DEFAULT_USER_PROFILE } from '@/repositories/user/userProfileRepository'

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
  const profileList = ref<UserProfile[]>([userProfileRepository.readProfile()])
  /** 资料版本号：头像换/删、字段保存时递增，界面不必深比较 dataURL */
  const revision = ref(0)

  userProfileRepository.bind(profileList)

  const profile = computed(() => profileList.value[0] ?? { ...DEFAULT_USER_PROFILE })

  function replaceProfile(next: UserProfile): void {
    profileList.value = [next]
  }

  /** 昵称（头部与编辑抽屉标题用）；空 = 尚未设置（UI 显示引导，不臆造称呼） */
  const displayName = computed(() => profile.value.nickname)
  /** 昵称首字（未设头像时的占位）；空昵称返回空串——组件改用用户图标，不放假字母 */
  const initial = computed(() => profile.value.nickname.charAt(0))
  /** 资料是否已经设置过（任一身份字段非空即视为已设置） */
  const isProfileSet = computed(
    () =>
      profile.value.nickname.trim() !== '' ||
      profile.value.school.trim() !== '' ||
      profile.value.className.trim() !== '' ||
      profile.value.subject.trim() !== '',
  )

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
    isProfileSet,
    updateProfile,
    setAvatar,
    removeAvatar,
  }
})
