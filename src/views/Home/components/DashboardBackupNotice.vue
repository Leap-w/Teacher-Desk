<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Download } from 'lucide-vue-next'

import { AppButton } from '@/components/ui'
import { useNow } from '@/composables/useToday'
import { useBackup } from '@/composables/useBackup'
import { LAST_BACKUP_KEY, backupReminder } from '@/utils/backup'

/**
 * 备份提醒（稳定性增量）：本机数据只存在这台设备的浏览器里，备份却是手动的——
 * 教师想不起来导出，就等于没有备份（开发计划 §五 #7）。
 * 这里只在**从未导出 / 距上次导出超阈值**时出现一条细提示，导出后自动消失。
 *
 * 只读本机辅助键 `teacherdesk:lastBackupAt`（不是业务数据、不参与备份）：
 * 不碰任何 store、不写任何数据，也不做「数据变更感知」（与 utils/backup.ts 同口径）。
 */

const router = useRouter()
const now = useNow()

/**
 * 只读一次：导出发生在工具箱页，回到工作台会重新挂载（读到的就是新值）；
 * 隐私模式下读不到按「从未导出」处理（与工具箱同一口径，见 services/storage.ts）。
 */
const lastBackupAt = ref(useBackup().read(LAST_BACKUP_KEY) ?? '')
const reminder = computed(() => backupReminder(lastBackupAt.value, now.value))
</script>

<template>
  <div
    v-if="reminder.level !== 'none'"
    class="backup-notice"
    :class="`is-${reminder.level}`"
    role="status"
  >
    <span class="notice-icon" aria-hidden="true"><Download :size="18" :stroke-width="2" /></span>
    <p class="notice-text">{{ reminder.text }}</p>
    <AppButton size="sm" variant="secondary" @click="router.push('/toolbox')">
      去导出备份
    </AppButton>
  </div>
</template>

<style scoped>
.backup-notice {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-fill-disabled);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

/* 超过阈值才转醒目态：从没导出过是「提醒」，拖久了才是「该做了」 */
.backup-notice.is-due {
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
}

.notice-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.notice-icon :deep(svg) {
  width: 16px;
  height: 16px;
}

.notice-text {
  flex: 1;
  min-width: 0;
}

.backup-notice :deep(.app-button) {
  flex-shrink: 0;
}
</style>
