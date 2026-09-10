<script setup lang="ts">
import { computed } from 'vue'

import { AppCard, AppField, AppInput, AppSelect, AppSwitch } from '@/components/ui'
import type { DutyGroup, DutySettings } from '@/types/duty'
import type { SelectOption } from '@/types'

interface Props {
  settings: DutySettings
  groups: DutyGroup[]
  /** 轮换说明（由 store 的 rotationSummary 传入，文案口径只有一处） */
  summary: string
  /** 起点组已失效（被删 / 被清空示例数据删掉）：提示教师重设起点 */
  misaligned: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** 改动轮换设置（日期 / 起点组 / 周末开关），由页面写入 store */
  (event: 'change', patch: Partial<Omit<DutySettings, 'id' | 'kind'>>): void
}>()

const groupOptions = computed<SelectOption<string>[]>(() =>
  props.groups.map((group) => ({ label: group.name, value: group.id })),
)
</script>

<template>
  <AppCard title="轮换设置">
    <div class="rotation">
      <p class="rotation-summary">{{ summary }}</p>

      <p v-if="misaligned" class="rotation-warning">
        原来的起点组已被删除，轮换暂时按第一个组推进。请把下面的「起点组」重新选一下。
      </p>

      <div class="rotation-fields">
        <AppField label="起点日期" hint="轮换从这一天算起，之后每天顺延一组">
          <!-- 用 change 而不是 input 提交：日期框敲年份的每个字符都会触发 input，
               每敲一下写一次 store、弹一次提示，设置面板会被淹掉 -->
          <AppInput
            :model-value="settings.startDate"
            type="date"
            @change="
              emit('change', { startDate: String(($event.target as HTMLInputElement).value) })
            "
          />
        </AppField>

        <AppField label="起点组">
          <AppSelect
            :model-value="settings.startGroupId || undefined"
            :options="groupOptions"
            :disabled="groups.length === 0"
            :placeholder="groups.length === 0 ? '还没有值日组' : '选择当天值日的组'"
            @update:model-value="emit('change', { startGroupId: String($event) })"
          />
        </AppField>

        <AppField label="周末值日" hint="关闭时周六周日不排，周一接着上一组继续">
          <AppSwitch
            :model-value="settings.includeWeekend"
            label="周末也排值日"
            @update:model-value="emit('change', { includeWeekend: $event })"
          />
        </AppField>
      </div>

      <p class="rotation-hint">
        发现轮换对不上时（调休、月假返校后），把起点日期改成今天、选好今天该值日的组，
        后面的安排会跟着重排。起点日期正好落在周末（且关闭了「周末值日」）时，从下一个
        值日开始轮；起点日期设为以后的某天时，前面的日子按同一个起点往前倒推。
      </p>
    </div>
  </AppCard>
</template>

<style scoped>
.rotation {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.rotation-summary {
  font-size: var(--text-md);
  color: var(--color-text);
}

.rotation-warning {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-warning-soft);
  color: var(--color-warning-strong);
  font-size: var(--text-sm);
  line-height: 1.7;
}

.rotation-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
}

@media (min-width: 760px) {
  .rotation-fields {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: start;
  }
}

.rotation-hint {
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--color-text-secondary);
}
</style>
