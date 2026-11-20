<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 22 })

const paths: Record<string, string[]> = {
  home: ['M3 10.6 12 3l9 7.6', 'M5.5 9.4V21h13V9.4', 'M9.5 21v-6.2h5V21'],
  calendar: [
    'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
    'M8 3v4',
    'M16 3v4',
    'M3 10h18',
  ],
  users: [
    'M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11Z',
    'M3 20c0-3.1 2.7-5.6 6-5.6s6 2.5 6 5.6',
    'M16 5a3.2 3.2 0 0 1 0 6.2',
    'M17.6 14.8c2 .8 3.4 2.6 3.4 5.2',
  ],
  grid: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  image: [
    'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    'M8.6 9a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 8.6 9Z',
    'M21 15.5 15.5 10 5 20',
  ],
  search: ['M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z', 'M20.5 20.5 16 16'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  chevron: ['M9 5l7 7-7 7'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5.2l3.2 2'],
  expand: ['M8 3H3v5', 'M16 3h5v5', 'M21 16v5h-5', 'M3 16v5h5'],
  rotate: [
    'M4.2 12a7.8 7.8 0 0 1 13.4-5.5L20 9',
    'M20 4v5h-5',
    'M19.8 12a7.8 7.8 0 0 1-13.4 5.5L4 15',
    'M4 20v-5h5',
  ],
  back: ['M15 5l-7 7 7 7'],
  filter: ['M4 7h16', 'M7 12h10', 'M10 17h4'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 11v5', 'M12 8h.01'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z'],
}

const d = computed(() => paths[props.name] ?? paths.home ?? [])
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(item, i) in d" :key="i" :d="item" />
  </svg>
</template>
