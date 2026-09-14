<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Cloud, CloudOff, LogOut, RefreshCw, UserRound } from 'lucide-vue-next'

import { AppButton, AppField, AppInput, AppModal } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useSyncEngine } from '@/composables/useSyncEngine'
import { useCloudActions } from '@/composables/useCloudActions'

import SettingsCell from './SettingsCell.vue'
import SettingsSection from './SettingsSection.vue'

/**
 * SyncPanel — 云端同步面板（V2.2.2-alpha · Phase Cloud-3）。
 *
 * Control Center「数据与同步」的升级：当前账号 / 最近同步时间 / 同步状态 / 立即同步 / 登录 / 登出。
 * 状态一律来自 **SyncState（引擎）** 与既有的 cloudSyncState（通道）——不另造一份状态。
 *
 * 首次初始化（§六）：登录后判定四种处境；「本机有真实数据、云端空」时**必须问一句**
 * （检测到本地已有班级数据，是否初始化云端？），避免误覆盖；「两边都有」则引导到
 * 工具箱的逐键裁决（既有能力，不在这里重复一套）。
 */
const toast = useToast()
const { label, state, pending } = useSyncEngine()

const {
  state: cloudSyncState,
  configured,
  syncNow,
  signIn,
  signOut,
  channel: cloudTransport,
} = useCloudActions()
const signedIn = computed(() => cloudSyncState.value.account !== null)
const account = computed(() => cloudSyncState.value.account)
const lastSyncedAt = computed(() => cloudSyncState.value.lastSyncedAt)
const error = computed(() => cloudSyncState.value.error)
const conflicts = computed(() => cloudSyncState.value.conflicts)

/** 最近同步时间：今天显示时刻，更早显示日期（跟着本地时区走） */
const lastSyncText = computed(() => {
  const at = lastSyncedAt.value
  if (at === null) return '还没同步过'
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  const today = new Date()
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return sameDay ? `今天 ${clock}` : `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${clock}`
})

const badgeVariant = computed(() => {
  if (!configured) return 'neutral'
  if (state.value === 'error' || cloudSyncState.value.status === 'error') return 'danger'
  if (state.value === 'syncing') return 'warning'
  if (signedIn.value && cloudSyncState.value.status === 'idle') return 'success'
  return 'neutral'
})

const badgeText = computed(() => {
  if (!configured) return '本地模式'
  if (!signedIn.value) return '未登录'
  if (state.value === 'syncing') return '同步中'
  if (pending.value > 0) return `待同步 ${pending.value}`
  return label.value
})

/* ---------- 立即同步 ---------- */

const syncing = ref(false)

async function onSyncNow(): Promise<void> {
  if (syncing.value) return
  syncing.value = true
  try {
    await syncNow()
    if (cloudSyncState.value.status === 'idle') toast.success('已与云端对齐')
    else toast.warning(error.value ?? '同步没成功，稍后会自动重试')
  } catch (issue) {
    toast.danger(issue instanceof Error ? issue.message : '同步失败')
  } finally {
    syncing.value = false
  }
}

/** 账号行：未登录时点开登录弹窗；已登录时只是查看（不做跳转，避免误触） */
function onAccountCell(): void {
  if (!signedIn.value) openLogin()
}

/* ---------- 登录（邮箱）+ 首次初始化确认 ---------- */

const loginOpen = ref(false)
const email = ref('')
const password = ref('')
const loginBusy = ref(false)
const initOpen = ref(false)
const initBusy = ref(false)

function openLogin(): void {
  email.value = ''
  password.value = ''
  loginOpen.value = true
}

async function submitLogin(): Promise<void> {
  if (!email.value.trim() || !password.value) {
    toast.danger('请填写邮箱与密码')
    return
  }
  loginBusy.value = true
  try {
    await signIn(email.value.trim(), password.value)
    loginOpen.value = false
    toast.success('登录成功，正在对齐数据')
    await offerInitialization()
  } catch (issue) {
    toast.danger(issue instanceof Error ? issue.message : '登录失败')
  } finally {
    loginBusy.value = false
  }
}

/**
 * 登录后判定首次同步处境：只有「本机有数据、云端空」才问一句
 * （其余三种由同步流程自行处置：拉取 / 正常开始 / 逐键裁决）。
 */
async function offerInitialization(): Promise<void> {
  const channel = cloudTransport()
  if (!channel) return
  try {
    const situation = await channel.firstSyncSituation()
    if (situation === 'local-only') initOpen.value = true
    else if (situation === 'both') {
      toast.info('本机与云端都有数据，请在工具箱里选择保留哪一份')
    }
  } catch (issue) {
    console.warn('[sync] 首次同步处境判定失败：', issue)
  }
}

async function confirmInitialize(): Promise<void> {
  const channel = cloudTransport()
  if (!channel) return
  initBusy.value = true
  try {
    const result = await channel.initializeFromLocal()
    initOpen.value = false
    if (result.failed > 0) toast.warning(`已初始化云端，${result.failed} 个模块失败，稍后自动重试`)
    else toast.success(`已用本机数据初始化云端（${result.pushed} 个模块）`)
  } catch (issue) {
    toast.danger(issue instanceof Error ? issue.message : '初始化失败')
  } finally {
    initBusy.value = false
  }
}

/* ---------- 登出 ---------- */

async function onSignOut(): Promise<void> {
  if (!window.confirm('退出登录后本机数据保留，云端不动。确定退出吗？')) return
  await signOut()
  toast.success('已退出登录，回到本地模式')
}

/** 登录状态变化时（比如工具箱里登录了）：补一次处境判定 */
watch(signedIn, (now, before) => {
  if (now && !before) void offerInitialization()
})
</script>

<template>
  <SettingsSection title="云端同步">
    <SettingsCell
      :icon="signedIn ? Cloud : CloudOff"
      :title="signedIn ? '当前账号' : '登录云端'"
      :subtitle="
        signedIn ? lastSyncText : configured ? '邮箱登录 · 多设备自动对齐' : '未配置云环境，仅本地'
      "
      :value="signedIn ? (account ?? '') : undefined"
      :badge-text="badgeText"
      :badge-variant="badgeVariant"
      @click="onAccountCell"
    />

    <SettingsCell
      v-if="signedIn"
      :icon="RefreshCw"
      title="立即同步"
      subtitle="拉取云端改动并推上本机改动"
      :value="syncing ? '同步中…' : undefined"
      @click="onSyncNow"
    />

    <SettingsCell
      v-if="signedIn"
      :icon="UserRound"
      icon-tone="neutral"
      title="本机与云端都有数据？"
      :subtitle="
        conflicts.length > 0
          ? `有 ${conflicts.length} 个模块等待你选择保留哪一份（去工具箱处理）`
          : '首次同步需要选择时，去工具箱逐键裁决'
      "
      @click="$router.push('/my/tools')"
    />

    <SettingsCell
      v-if="signedIn"
      :icon="LogOut"
      icon-tone="danger"
      title="退出登录"
      subtitle="本机数据保留，云端不动"
      danger
      @click="onSignOut"
    />
  </SettingsSection>

  <!-- 邮箱登录 -->
  <AppModal v-model="loginOpen" title="登录云端">
    <form id="cloud-login-form" class="login-form" @submit.prevent="submitLogin">
      <AppField label="邮箱" required hint="与 CloudBase 控制台里建的账号一致">
        <AppInput v-model="email" type="text" placeholder="teacher@example.com" />
      </AppField>
      <AppField label="密码" required>
        <AppInput v-model="password" type="password" placeholder="账号密码" />
      </AppField>
      <p class="login-hint">
        控制台若只开通了「用户名登录」，可在工具箱里用用户名登录。账号在 CloudBase 控制台「身份认证
        → 用户管理」里创建。
      </p>
    </form>
    <template #footer>
      <AppButton variant="ghost" :disabled="loginBusy" @click="loginOpen = false">取消</AppButton>
      <AppButton type="submit" form="cloud-login-form" :disabled="loginBusy">
        {{ loginBusy ? '登录中…' : '登录' }}
      </AppButton>
    </template>
  </AppModal>

  <!-- 首次初始化确认 -->
  <AppModal v-model="initOpen" title="初始化云端">
    <p class="init-text">检测到本地已有班级数据，是否用本机这份初始化云端？</p>
    <ul class="init-list">
      <li>云端目前没有 TeacherDesk 数据，初始化会把本机的学生 / 座位 / 课表等推上去。</li>
      <li>初始化后，其它设备登录同一账号即可看到这份数据。</li>
      <li>本机数据不受影响；不想现在做，选「稍后」即可，之后随时能在工具箱里同步。</li>
    </ul>
    <template #footer>
      <AppButton variant="ghost" :disabled="initBusy" @click="initOpen = false">稍后</AppButton>
      <AppButton :disabled="initBusy" @click="confirmInitialize">
        {{ initBusy ? '初始化中…' : '初始化云端' }}
      </AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-card);
}

.login-hint {
  margin: 0;
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.init-text {
  margin: 0 0 var(--space-3);
  font-size: var(--font-content);
  color: var(--color-text-primary);
}

.init-list {
  margin: 0;
  padding-left: 1.1em;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--font-secondary);
  color: var(--color-text-secondary);
}
</style>
