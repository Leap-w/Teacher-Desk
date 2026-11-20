<script setup lang="ts">
import { portalData } from '../data'
import Icon from '../components/Icon.vue'
import type { TabId } from '../components/nav'

const emit = defineEmits<{ navigate: [id: TabId] }>()

const entries: Array<{ id: TabId; icon: string; title: string; desc: string }> = [
  { id: 'schedule', icon: 'calendar', title: '课程表', desc: '本周课程安排' },
  { id: 'students', icon: 'users', title: '学生档案', desc: '认识班里同学' },
  { id: 'seats', icon: 'grid', title: '座位图', desc: '查看当前座位' },
  { id: 'photos', icon: 'image', title: '照片墙', desc: '班级影像记录' },
]
</script>

<template>
  <div class="page home">
    <header class="hero">
      <div class="brand-line">
        <span class="brand-dot"></span>
        CLASS PORTAL
        <span class="demo-chip">{{ portalData.mode === 'demo' ? '演示版' : '只读' }}</span>
      </div>
      <h1>{{ portalData.classInfo.name }}</h1>
      <p class="welcome">{{ portalData.classInfo.welcome }}</p>
      <p v-if="portalData.classInfo.lastUpdated" class="updated">
        <Icon name="clock" :size="14" /> 数据更新至 {{ portalData.classInfo.lastUpdated }}
      </p>
    </header>

    <section class="entries" aria-labelledby="entries-title">
      <h2 id="entries-title" class="section-title">快捷进入</h2>
      <div class="entry-grid">
        <button
          v-for="entry in entries"
          :key="entry.id"
          type="button"
          class="entry card"
          @click="emit('navigate', entry.id)"
        >
          <span class="entry-icon"><Icon :name="entry.icon" :size="24" /></span>
          <span class="entry-title">{{ entry.title }}</span>
          <span class="entry-desc">{{ entry.desc }}</span>
          <span class="entry-arrow"><Icon name="chevron" :size="16" /></span>
        </button>
      </div>
    </section>

    <p class="footnote">
      <Icon name="info" :size="14" />
      {{
        portalData.mode === 'demo'
          ? '本站展示的是虚构演示数据，不涉及任何真实学生信息'
          : '本站为只读班级展示，数据来自 TeacherDesk 已同步内容'
      }}
    </p>
  </div>
</template>

<style scoped>
.hero {
  padding: var(--space-6) var(--space-5);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.brand-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--primary);
}

.brand-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--primary);
}

.demo-chip {
  margin-left: auto;
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: var(--primary-soft);
  font-size: 10px;
  letter-spacing: 0;
}

.hero h1 {
  margin-top: var(--space-5);
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.welcome {
  margin-top: 6px;
  color: var(--text-sub);
  font-size: 14px;
}

.updated {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-5);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border);
  color: var(--text-sub);
  font-size: 12px;
}

.entries {
  margin-top: var(--space-8);
}

.entry-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.entry {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-height: 124px;
  padding: var(--space-4);
  text-align: left;
  transition:
    border-color 150ms ease,
    transform 150ms ease;
}

.entry:active {
  transform: scale(0.985);
}

.entry-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: var(--radius-sm);
  background: var(--primary-soft);
  color: var(--primary);
}

.entry-title {
  margin-top: var(--space-3);
  font-size: 15px;
  font-weight: 600;
}

.entry-desc {
  margin-top: 2px;
  color: var(--text-sub);
  font-size: 12px;
}

.entry-arrow {
  position: absolute;
  right: var(--space-3);
  bottom: var(--space-3);
  color: var(--text-sub);
}

.footnote {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-8);
  color: var(--text-sub);
  font-size: 11px;
}

@media (min-width: 768px) {
  .hero h1 {
    font-size: 36px;
  }
  .entry {
    min-height: 140px;
  }
}
</style>
