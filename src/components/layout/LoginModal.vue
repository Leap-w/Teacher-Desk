<script setup lang="ts">
import { computed, ref } from 'vue'

import { useCloudSync } from '@/composables/useCloudSync'
import { useLoginModal } from '@/composables/useLoginModal'
import { useToast } from '@/composables/useToast'
import { AppButton, AppField, AppInput, AppModal } from '@/components/ui'

/**
 * LoginModal — 全局登录弹窗（v3.0.2-rc；v3.0.3-rc 修登录方式）。
 *
 * 登录的唯一入口（顶部头像 / 「我的」空状态 / 数据与同步页唤起同一个实例）：
 * **账号 + 密码**，成功后立即对齐一次云端并关闭弹窗——**留在当前页面**，不跳路由。
 * 失败不吞：登录是教师主动发起的动作，云端给的原因原样展示。
 *
 * ⚠️ 输入框必须是 `type="text"` + `autocomplete="username"`，**不能是 `type="email"`**：
 * 控制台建的账号是「用户名」类型，写 `type="email"` 时浏览器会在提交前用原生校验挡下
 * （提示「请输入邮箱」），请求根本发不出去——界面上只表现为「点了没反应」，云端没有任何错误可查。
 * 同一个坑 2026-09-12 踩过一次（开发手册 §9.20 取舍 ⑪），v3.0.2-rc 又回归了一次，故在此写明。
 */
const loginModal = useLoginModal()
const toast = useToast()
const { signedIn, signInWithAccount } = useCloudSync()

const account = ref('')
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
  if (!account.value.trim() || !password.value) {
    error.value = '请填写账号与密码'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await signInWithAccount(account.value.trim(), password.value)
    loginModal.hide()
    toast.success('登录成功，云端与本机已对齐')
    account.value = ''
    password.value = ''
  } catch (err) {
    // CloudBase 的报错原文摆出来（「用户不存在」「密码错误」比笼统提示有用）
    error.value = err instanceof Error ? err.message : '登录没成功，请检查账号与密码'
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

      <AppField label="账号" required>
        <AppInput
          v-model="account"
          type="text"
          autocomplete="username"
          placeholder="控制台建的用户名（可写成邮箱）"
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
