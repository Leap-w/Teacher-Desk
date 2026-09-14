<script setup lang="ts">
import { computed, ref } from 'vue'

import { useCloudSync } from '@/composables/useCloudSync'
import { useLoginModal } from '@/composables/useLoginModal'
import { useToast } from '@/composables/useToast'
import { AppButton, AppField, AppInput, AppModal } from '@/components/ui'

/**
 * LoginModal — 全局登录弹窗（v3.0.2-rc）。
 *
 * 登录的唯一入口（Header 头像 / 「我的」空状态唤起）：邮箱 + 密码，
 * 成功后立即对齐一次云端并关闭弹窗——**留在当前页面**，不跳路由。
 * 失败不吞：登录是教师主动发起的动作，云端给的原因原样展示。
 */
const loginModal = useLoginModal()
const toast = useToast()
const { signedIn, signInWithEmail } = useCloudSync()

const email = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

const visible = computed(() => loginModal.open.value)

function close(): void {
  if (busy.value) return
  loginModal.hide()
  error.value = ''
}

async function submit(): Promise<void> {
  if (!email.value.trim() || !password.value) {
    error.value = '请填写邮箱与密码'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await signInWithEmail(email.value.trim(), password.value)
    loginModal.hide()
    toast.success('登录成功，云端与本机已对齐')
    email.value = ''
    password.value = ''
  } catch (err) {
    // CloudBase 的报错原文摆出来（「用户不存在」「密码错误」比笼统提示有用）
    error.value = err instanceof Error ? err.message : '登录没成功，请检查邮箱与密码'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppModal
    :model-value="visible"
    title="登录 TeacherDesk"
    :width="380"
    @update:model-value="close()"
  >
    <form class="login-form" @submit.prevent="submit">
      <p class="login-form__hint">登录后，本机数据与你的云端账号自动对齐；不登录也能照常使用。</p>

      <AppField label="邮箱" required>
        <AppInput
          v-model="email"
          type="email"
          autocomplete="username"
          placeholder="你注册的邮箱"
          :disabled="busy"
        />
      </AppField>
      <AppField label="密码" required>
        <AppInput
          v-model="password"
          type="password"
          autocomplete="current-password"
          :disabled="busy"
        />
      </AppField>

      <p v-if="error" class="login-form__error" role="alert">{{ error }}</p>
      <p v-if="signedIn" class="login-form__error">已经登录了，不需要再登录。</p>
    </form>

    <template #footer>
      <AppButton variant="ghost" :disabled="busy" @click="close">取消</AppButton>
      <AppButton type="submit" form="login-form" :loading="busy">登录并同步</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.login-form__hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-tertiary);
}

.login-form__error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-danger);
}
</style>
