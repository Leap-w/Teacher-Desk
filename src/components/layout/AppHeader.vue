<script setup lang="ts">
import { useRouter } from 'vue-router'

import { AppButton } from '@/components/ui'
import { useCloudSync } from '@/composables/useCloudSync'
import { useToast } from '@/composables/useToast'
import { useToday } from '@/composables/useToday'

/**
 * 顶栏：一句话状态 + 一个同步按钮。
 *
 * 状态文案和同步动作都来自 `useCloudSync()`，与工具箱那张卡片**同一份**——顶栏先前
 * 挂的是 Phase 0 的假同步（定时器转 1.2 秒就报「已同步」），和工具箱的真同步并存，
 * 同一屏上说两句互相矛盾的话。现在顶栏不再自己造状态，只显示引擎给的事实。
 *
 * 顶栏不放登录表单（那里没地方，也不该有密码框）：没登录时点按钮把人送到工具箱。
 */
const router = useRouter()
const toast = useToast()
const { state, enabled, syncing, lastSyncedClock, syncWithFeedback } = useCloudSync()
const { todayLabel } = useToday()

async function onSync(): Promise<void> {
  // 有等教师裁决的冲突（Phase 9C）：顶栏没有裁决的地方（那是工具箱那张卡片里的区块），
  // 所以把人送过去——而不是在这儿报一句「同步不了」然后没下文
  if (state.value.conflicts.length > 0) {
    toast.info('有模块本机与云端都有数据，需要确认保留哪一份，去工具箱处理。')
    await router.push('/toolbox')
    return
  }
  // `checked` 之前状态一律是 `signedOut`（只是还没问过云端，不代表真的没登录）。
  // 少了这一位判断，应用一启动点同步就会被喊去登录，而其实会话是好的。
  if (state.value.checked && state.value.status === 'signedOut') {
    toast.info('还没登录，先到工具箱登录一次。')
    await router.push('/toolbox')
    return
  }
  await syncWithFeedback()
}
</script>

<template>
  <header class="app-header">
    <RouterLink to="/" class="brand">
      <span class="brand-mark" aria-hidden="true">T</span>
      <span class="brand-name">TeacherDesk</span>
    </RouterLink>

    <div class="flex items-center gap-4">
      <span v-if="lastSyncedClock" class="header-synced">已同步 {{ lastSyncedClock }}</span>
      <span class="header-date">{{ todayLabel }}</span>
      <!-- 没配环境 ID 时整块云端同步不启用：与其摆一个点了没反应的按钮，不如不摆 -->
      <AppButton v-if="enabled" size="sm" :loading="syncing" @click="onSync">
        {{ syncing ? '同步中…' : '同步' }}
      </AppButton>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  flex-shrink: 0;
  /* 高度写在 height 上、安全区走内边距：内容仍占 64px，只是整体从刘海 / 状态栏下方开始 */
  height: calc(64px + env(safe-area-inset-top, 0px));
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: env(safe-area-inset-top, 0px)
    calc(clamp(20px, 3vw, 36px) + env(safe-area-inset-right, 0px)) 0
    calc(clamp(20px, 3vw, 36px) + env(safe-area-inset-left, 0px));
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: 1px solid var(--color-border);
  z-index: 10;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 10px;
  transition: background var(--transition-fast);
}

.brand:hover {
  background: rgba(29, 29, 31, 0.04);
}

.brand-mark {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  /* CDL 品牌渐变：高原青 → 天空蓝（同 AppLayout 顶栏头像渐变） */
  background: linear-gradient(135deg, var(--color-primary), var(--color-sky));
  color: #ffffff;
  font-size: 15px;
  font-weight: var(--font-weight-bold);
  box-shadow: var(--shadow-sm);
}

.brand-name {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.2px;
  background: linear-gradient(
    120deg,
    var(--color-primary-strong),
    var(--color-primary),
    var(--color-secondary)
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.header-date {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.header-synced {
  font-size: 12px;
  color: var(--color-text-secondary);
}

@media (max-width: 760px) {
  .header-date,
  .header-synced {
    display: none;
  }
}
</style>
