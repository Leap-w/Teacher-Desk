<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { portalData } from '../data'
import type { Student } from '../data'
import Icon from './Icon.vue'

const props = defineProps<{ student: Student | null; contextLabel?: string }>()
const emit = defineEmits<{ close: [] }>()

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.student) emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div v-if="student" class="sheet-overlay" @click.self="emit('close')">
      <div class="sheet" role="dialog" aria-modal="true" :aria-label="`${student.name} 的档案`">
        <div class="sheet-bar"></div>
        <div class="sheet-head">
          <div class="avatar" :style="{ background: student.color || 'var(--primary)' }">
            {{ student.name.slice(0, 1) }}
          </div>
          <div class="head-text">
            <h2>{{ student.name }}</h2>
            <p class="muted">{{ contextLabel || '学生档案' }}</p>
          </div>
          <button type="button" class="close-btn" aria-label="关闭" @click="emit('close')">
            <Icon name="close" :size="20" />
          </button>
        </div>

        <dl class="facts">
          <div>
            <dt>性别</dt>
            <dd>{{ student.gender || '—' }}</dd>
          </div>
          <div>
            <dt>宿舍</dt>
            <dd>{{ student.dorm || '—' }}</dd>
          </div>
          <div>
            <dt>班级职务</dt>
            <dd>{{ student.duty || '—' }}</dd>
          </div>
        </dl>

        <div v-if="student.bio" class="bio">
          <h3>一句话介绍</h3>
          <p>{{ student.bio }}</p>
        </div>

        <p v-if="portalData.mode === 'demo'" class="demo-note">
          <Icon name="info" :size="15" /> 本页面所有学生信息均为虚构演示数据
        </p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sheet-overlay {
  position: fixed;
  z-index: 300;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(24, 38, 36, 0.32);
  padding: 0;
}

.sheet {
  position: relative;
  width: 100%;
  background: var(--bg-card);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding: var(--space-3) var(--space-5) calc(var(--space-6) + var(--safe-bottom));
  box-shadow: var(--shadow-pop);
}

.sheet-bar {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--border-strong);
  margin: 0 auto var(--space-4);
}

.sheet-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.avatar {
  flex: none;
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  font-size: 20px;
  font-weight: 600;
}

.head-text {
  min-width: 0;
  flex: 1;
}

.head-text h2 {
  font-size: 20px;
  font-weight: 600;
}

.head-text p {
  font-size: 12px;
}

.close-btn {
  flex: none;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: var(--bg-subtle);
  color: var(--text-sub);
}

.facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-2);
  margin: var(--space-5) 0 0;
}

.facts div {
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
  min-width: 0;
}

.facts dt {
  font-size: 11px;
  color: var(--text-sub);
}

.facts dd {
  margin: 4px 0 0;
  font-size: 13px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.bio {
  margin-top: var(--space-5);
}

.bio h3 {
  font-size: 13px;
  font-weight: 600;
}

.bio p {
  margin-top: var(--space-2);
  font-size: 14px;
  color: var(--text-sub);
}

.demo-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-5);
  font-size: 11px;
  color: var(--text-sub);
}

@media (min-width: 768px) {
  .sheet-overlay {
    align-items: center;
    padding: var(--space-6);
  }

  .sheet {
    max-width: 440px;
    border-radius: var(--radius-lg);
    padding-bottom: var(--space-6);
  }

  .sheet-bar {
    display: none;
  }
}
</style>
