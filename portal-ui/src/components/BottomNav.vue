<script setup lang="ts">
import Icon from './Icon.vue'
import type { TabId } from './nav'

defineProps<{ active: TabId }>()
const emit = defineEmits<{ change: [id: TabId] }>()

const items: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'home', label: '首页', icon: 'home' },
  { id: 'schedule', label: '课程表', icon: 'calendar' },
  { id: 'students', label: '学生档案', icon: 'users' },
  { id: 'seats', label: '座位图', icon: 'grid' },
  { id: 'photos', label: '照片墙', icon: 'image' },
]
</script>

<template>
  <nav class="bottom-nav" aria-label="主导航">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="nav-item"
      :class="{ active: active === item.id }"
      :aria-current="active === item.id ? 'page' : undefined"
      @click="emit('change', item.id)"
    >
      <span class="nav-icon"><Icon :name="item.icon" :size="22" /></span>
      <span class="nav-label">{{ item.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.bottom-nav {
  position: fixed;
  z-index: 50;
  left: 0;
  right: 0;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  height: calc(var(--nav-height) + var(--safe-bottom));
  padding-bottom: var(--safe-bottom);
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: saturate(180%) blur(16px);
  -webkit-backdrop-filter: saturate(180%) blur(16px);
  border-top: 1px solid var(--border);
}

.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 44px;
  min-height: 44px;
  border: 0;
  background: transparent;
  color: var(--text-sub);
  transition: color 150ms ease;
}

.nav-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 30px;
  border-radius: var(--radius-pill);
  transition: background 150ms ease;
}

.nav-label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.01em;
  line-height: 1.2;
  white-space: nowrap;
}

.nav-item.active {
  color: var(--primary);
}

.nav-item.active .nav-icon {
  background: var(--primary-soft);
}

@media (min-width: 768px) and (min-height: 600px) {
  .bottom-nav {
    left: 50%;
    right: auto;
    bottom: 20px;
    transform: translateX(-50%);
    width: max-content;
    min-width: 520px;
    height: 64px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    box-shadow: var(--shadow-pop);
  }

  .nav-item {
    padding: 0 14px;
  }

  .nav-label {
    font-size: 11px;
  }
}
</style>
