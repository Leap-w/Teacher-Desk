<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Paintbrush } from 'lucide-vue-next'

import { useDutyStore } from '@/stores/duty'
import SettingsPage from '../components/SettingsPage.vue'
import SettingsSection from '../components/SettingsSection.vue'
import SettingsCell from '../components/SettingsCell.vue'

/**
 * 班级设置（v3.0.4-rc · **v3.3.0 删掉两行死链**）。
 *
 * 这里本来有三行，都在说「（在 XX 管理页内）」：
 * - **值日默认设置**：值日页里**真有**轮换设置（起点日期 / 起点组 / 周末是否轮换），
 *   所以这行是诚实的——它是一条「从设置也能直达」的路，副标题实时显示当前轮换口径。
 * - 请假默认设置 / 周末返校默认设置：跳过去的那两页**根本没有设置项**。
 *   教师按「请假默认设置 → 默认返校时间 · 显示方式」的承诺点进去，落到的是一张请假记录列表，
 *   在那里找不到任何可以改的「默认值」。承诺与实际不符，就是半成品。
 *
 * v3.3.0 的处置是**删入口**（需求：要么删除入口，要么完整实现，不能保留半成品）：
 * 请假与周末本身在班级管理的一级导航里都有常驻入口，不需要绕道「设置」再骗一次。
 * 真要做默认值，先在对应模块页里把那项设置做出来，再回来加这一行。
 */
const router = useRouter()
const dutyStore = useDutyStore()

const dutySubtitle = computed(
  () => dutyStore.rotationSummary || '轮换起点 · 起点组（在值日管理页内）',
)
</script>

<template>
  <SettingsPage title="班级设置" subtitle="班级事务的默认口径">
    <SettingsSection title="班级事务">
      <SettingsCell
        :icon="Paintbrush"
        title="值日默认设置"
        :subtitle="dutySubtitle"
        @click="router.push('/class/duty')"
      />
    </SettingsSection>
  </SettingsPage>
</template>
