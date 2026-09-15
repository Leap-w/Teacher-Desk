<script setup lang="ts">
import { computed } from 'vue'

import { useAppSettingsStore } from '@/stores/appSettings'

/**
 * WorkTimeCard — 工作时光 / 支教时光（v3.0.4-rc 接入统一设置；**v3.0.5-rc 换成昌都记忆的
 * `.time-capsule` 结构**）。
 *
 * **DOM 与子元素层级与昌都记忆 `Profile.vue` 的 `.profile__time-capsule` 一一对应**：
 * 头部（标题 + 阶段徽标）→ 三格统计（支教第 N 天 / 已经过 N 个月 / 剩余 N 天）→
 * 渐变进度条 → 底部三个日期节点。只替换内容来源，卡片骨架一字未改。
 *
 * **数据与首页 Hero 同源**（`useAppSettingsStore` → `timeCenter`）：
 * - 支教天数 ← `timeCenter.serviceStart`（首页「第 X 天」是同一个值）
 * - 学期进度 ← `timeCenter.semesterStart` → `semesterEnd`（首页进度条同源）
 * - 轴上的日期 ← 学期起止
 *
 * 改任一处日期，这里与首页同时更新；本组件不再有自己的设置读取
 * （旧 `useCountdownSettings` 已并入 store）。
 * v3.1.0：日期从 `settings.semesterStart` 挪到了 `settings.timeCenter.semesterStart`——
 * 只是取值路径变了，派生值一个没动。
 */
const appSettings = useAppSettingsStore()

const daysWorked = computed(() => appSettings.daysWorked)
const termProgress = computed(() => appSettings.termProgress)
const termDaysRemaining = computed(() => appSettings.termDaysRemaining)
const termIsOver = computed(() => appSettings.termIsOver)
const termStart = computed(() => appSettings.timeCenter.semesterStart)
const termEnd = computed(() => appSettings.timeCenter.semesterEnd)

/** 进度条与百分比开关：与首页 Hero 读的是同一个字段（v3.3.0 起两处一致） */
const showProgress = computed(() => appSettings.settings.showProgress)

/** 已经过的整月数（按天折算，约 30.44 天/月，与昌都记忆同一算法） */
const monthsPassed = computed(() => Math.floor(daysWorked.value / 30.44))

/** 当前学年：8 月起算新学年（如 2026-09 → 2026–2027 学年）——头部徽标位 */
const schoolYear = computed(() => {
  const now = new Date()
  const year = now.getFullYear()
  return now.getMonth() >= 7 ? `${year}–${year + 1}` : `${year - 1}–${year}`
})

/** 轴上的日期：`YYYY.MM`（与昌都记忆 `capsuleDates` 同一格式） */
const fmtMonth = (iso: string): string =>
  /^\d{4}-\d{2}/.test(iso) ? `${iso.slice(0, 4)}.${iso.slice(5, 7)}` : iso
</script>

<template>
  <section class="time-capsule">
    <div class="time-capsule__head">
      <span class="time-capsule__head-label">工作时光</span>
      <span class="time-capsule__phase">{{ schoolYear }} 学年</span>
    </div>

    <div class="time-capsule__grid">
      <div class="time-capsule__stat">
        <span class="time-capsule__stat-label">支教第</span>
        <span class="time-capsule__stat-num time-capsule__stat-num--primary">{{ daysWorked }}</span>
        <span class="time-capsule__stat-sub">天</span>
      </div>
      <div class="time-capsule__stat">
        <span class="time-capsule__stat-label">已经过</span>
        <span class="time-capsule__stat-num">{{ monthsPassed }}</span>
        <span class="time-capsule__stat-sub">个月</span>
      </div>
      <div class="time-capsule__stat">
        <span class="time-capsule__stat-label">剩余</span>
        <span class="time-capsule__stat-num time-capsule__stat-num--gold">
          {{ termIsOver ? 0 : termDaysRemaining }}
        </span>
        <span class="time-capsule__stat-sub">天到期末</span>
      </div>
    </div>

    <!--
      柔和进度条（学期进度，与首页 Hero 同一条）。
      v3.3.0：**跟着「时光中心 → Hero 外观 → 显示进度条」开关走**。
      在这个开关存在之前，首页 Hero 会隐藏进度条、这一张却照画不误——
      同一个开关在两个页面给出两种结果，教师会以为开关坏了。
    -->
    <div v-if="showProgress" class="time-capsule__progress">
      <div class="time-capsule__progress-track">
        <div class="time-capsule__progress-fill" :style="{ width: termProgress + '%' }" />
      </div>
    </div>

    <div class="time-capsule__dates">
      <span>{{ fmtMonth(termStart) }} 开学</span>
      <span>{{ showProgress ? `今天 ${termProgress}%` : '今天' }}</span>
      <span>{{ fmtMonth(termEnd) }} 期末</span>
    </div>
  </section>
</template>

<style scoped>
/* ==========================================
   Time capsule（对齐 Changdu-Memory .profile__time-capsule）
   ========================================== */
.time-capsule {
  padding: var(--spacing-lg);
  border-radius: var(--radius-card);
  background: var(--glass-bg-card);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: var(--border-hairline-width) solid var(--color-border-light);
  box-shadow: var(--shadow-card);
}

.time-capsule__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: var(--border-hairline-width) solid var(--color-border-light);
}

.time-capsule__head-label {
  font-size: 20px;
  line-height: 1.3;
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  flex: 1;
}

/* 阶段徽标位：这里放学年（TeacherDesk 没有昌都记忆的「一年旅程节点」） */
.time-capsule__phase {
  font-size: var(--font-caption);
  font-weight: var(--font-weight-bold);
  color: var(--color-primary-strong);
  background: var(--color-primary-bg);
  padding: 3px 10px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.time-capsule__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
  text-align: center;
}

.time-capsule__stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 4px;
  border-radius: 16px;
  background: var(--color-bg-white);
  border: var(--border-hairline-width) solid var(--color-border-light);
  box-shadow: 0 1px 2px rgba(16, 24, 32, 0.03);
}

.time-capsule__stat-label {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.time-capsule__stat-num {
  font-size: 26px;
  font-weight: var(--font-weight-extrabold);
  color: var(--color-text-primary);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.time-capsule__stat-num--primary {
  color: var(--color-primary-strong);
}

.time-capsule__stat-num--gold {
  color: var(--color-gold);
}

.time-capsule__stat-sub {
  font-size: 10px;
  color: var(--color-text-tertiary);
}

.time-capsule__progress {
  margin-bottom: 10px;
  padding: 2px;
}

.time-capsule__progress-track {
  height: 10px;
  background: var(--color-border-light);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.time-capsule__progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), var(--color-sky), var(--color-gold));
  border-radius: var(--radius-full);
  transition: width 800ms ease;
}

.time-capsule__dates {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}
</style>
