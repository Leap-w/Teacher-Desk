<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Paintbrush, PlaneLanding, UserRound } from 'lucide-vue-next'

import { useDutyStore } from '@/stores/duty'
import SettingsPage from '../components/SettingsPage.vue'
import SettingsSection from '../components/SettingsSection.vue'
import SettingsCell from '../components/SettingsCell.vue'

/**
 * 班级设置（v3.0.4-rc · 二级页）。
 *
 * 原有「请假 / 值日 / 周末」三组设置原样搬进来，**一项未删**；
 * 每项都指向该模块自己的设置入口（双入口不迁移——真正的设置在各自模块页里，
 * 这里给的是「从设置进来也能直达」的一条路）。
 */
const router = useRouter()
const dutyStore = useDutyStore()

const dutySubtitle = computed(
  () => dutyStore.rotationSummary || '轮换起点 · 起点组（在值日管理页内）',
)
</script>

<template>
  <SettingsPage title="班级设置" subtitle="请假、值日与周末返校的默认口径">
    <SettingsSection title="班级事务">
      <SettingsCell
        :icon="UserRound"
        title="请假默认设置"
        subtitle="默认返校时间 · 显示方式（在请假管理页内）"
        @click="router.push('/class/leave')"
      />
      <SettingsCell
        :icon="Paintbrush"
        title="值日默认设置"
        :subtitle="dutySubtitle"
        @click="router.push('/class/duty')"
      />
      <SettingsCell
        :icon="PlaneLanding"
        title="周末返校默认设置"
        subtitle="默认返校提醒 · 返家登记（在周末管理页内）"
        @click="router.push('/class/weekend')"
      />
    </SettingsSection>
  </SettingsPage>
</template>
