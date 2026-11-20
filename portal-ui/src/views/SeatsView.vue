<script setup lang="ts">
import { computed, onActivated, onMounted, onUnmounted, ref } from 'vue'
import { portalData } from '../data'
import type { Seat } from '../data'
import { useFullscreenSession } from '../composables/useFullscreenSession'
import type { SeatView } from '../utils/seatView'
import Icon from '../components/Icon.vue'
import SeatBoard from '../components/SeatBoard.vue'
import SeatViewToggle from '../components/SeatViewToggle.vue'
import StudentSheet from '../components/StudentSheet.vue'

type OrientationApi = {
  lock?: (value: string) => Promise<void>
  unlock?: () => void
}

function orientationApi(): OrientationApi | undefined {
  return (screen as unknown as { orientation?: OrientationApi }).orientation
}

const {
  active: fullscreen,
  lockFailed,
  enter,
  exit,
  finish,
  onChange,
  onEscape,
} = useFullscreenSession({
  isFullscreenElement: () => !!document.fullscreenElement,
  requestFullscreen: async () => {
    await document.documentElement.requestFullscreen?.()
  },
  exitFullscreen: async () => {
    await document.exitFullscreen()
  },
  lockOrientation: async () => {
    const api = orientationApi()
    if (!api?.lock) throw new Error('orientation lock unsupported')
    await api.lock('landscape')
  },
  unlockOrientation: () => {
    orientationApi()?.unlock?.()
  },
  setBodyLock: (locked) => {
    document.body.classList.toggle('portal-fs', locked)
  },
})

const isPortrait = ref(typeof window !== 'undefined' && window.innerHeight > window.innerWidth)
const selectedSeat = ref<Seat | null>(null)
const view = ref<SeatView>('teacher')

// KeepAlive preserves this component; every entry must reset to the teacher view.
onActivated(() => {
  view.value = 'teacher'
  selectedSeat.value = null
})

const selectedStudent = computed(() => {
  const id = selectedSeat.value?.studentId
  return id ? (portalData.studentById(id) ?? null) : null
})

const seatContext = computed(() =>
  selectedSeat.value ? `第 ${selectedSeat.value.row} 排 · 第 ${selectedSeat.value.col} 列` : '',
)

const landscapeLabel = computed(() => (fullscreen.value ? '退出横屏' : '横屏查看'))

const rotateHint = computed(() => {
  if (!fullscreen.value) return ''
  if (isPortrait.value && lockFailed.value) return '当前浏览器不支持自动横屏，请旋转手机后使用'
  if (isPortrait.value) return '请旋转手机至横屏，一屏查看全部座位'
  if (lockFailed.value) return '当前浏览器不支持自动横屏；已按横屏布局显示'
  return ''
})

function updateOrientation() {
  isPortrait.value = window.innerHeight > window.innerWidth
}

function toggleLandscape() {
  if (fullscreen.value) void exit()
  else void enter()
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') onEscape()
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onChange)
  window.addEventListener('resize', updateOrientation)
  window.addEventListener('orientationchange', updateOrientation)
  window.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onChange)
  window.removeEventListener('resize', updateOrientation)
  window.removeEventListener('orientationchange', updateOrientation)
  window.removeEventListener('keydown', onKey)
  finish()
})
</script>

<template>
  <div class="page seats">
    <header class="page-head">
      <h1>座位图</h1>
      <p class="muted">7 排 × 9 列 · 点击座位查看同学</p>
    </header>

    <div class="page-toolbar">
      <SeatViewToggle v-model="view" />
    </div>

    <div class="board-card card">
      <div class="board-scroll">
        <SeatBoard
          :seats="portalData.seats"
          :blocks="portalData.classroom.blocks"
          :rows="portalData.classroom.rows"
          :view="view"
          :selected-key="selectedSeat ? `${selectedSeat.row}-${selectedSeat.col}` : null"
          @select="selectedSeat = $event"
        />
      </div>
    </div>

    <button
      type="button"
      class="fs-button"
      :class="{ active: fullscreen }"
      data-landscape-toggle
      :aria-pressed="fullscreen"
      @click="toggleLandscape()"
    >
      <Icon :name="fullscreen ? 'close' : 'expand'" :size="18" /> {{ landscapeLabel }}
    </button>

    <p class="legend muted">
      <span class="dot occupied"></span> 已入座 <span class="dot blank"></span> 空位
    </p>
    <p class="footnote muted">
      <Icon name="info" :size="14" />
      {{ portalData.mode === 'demo' ? '座位姓名为虚构演示数据' : '座位数据为只读同步内容' }}
    </p>

    <Teleport to="body">
      <div v-if="fullscreen" class="fs-overlay">
        <div class="fs-top">
          <div class="fs-title">
            <strong>{{ portalData.classInfo.name }} · 座位图</strong>
            <span class="muted">横屏全屏视图</span>
          </div>
          <SeatViewToggle v-model="view" />
          <button type="button" class="fs-exit" data-landscape-exit @click="exit()">
            <Icon name="close" :size="18" /> 退出横屏
          </button>
        </div>

        <div class="fs-stage">
          <SeatBoard
            fullscreen
            :seats="portalData.seats"
            :blocks="portalData.classroom.blocks"
            :rows="portalData.classroom.rows"
            :view="view"
            :selected-key="selectedSeat ? `${selectedSeat.row}-${selectedSeat.col}` : null"
            @select="selectedSeat = $event"
          />
        </div>

        <div v-if="rotateHint" class="rotate-hint" :class="{ strong: isPortrait && lockFailed }">
          <Icon name="rotate" :size="18" />
          <span>{{ rotateHint }}</span>
        </div>
      </div>
    </Teleport>

    <StudentSheet
      :student="selectedStudent"
      :context-label="seatContext"
      @close="selectedSeat = null"
    />
  </div>
</template>

<style scoped>
.page-head {
  padding-top: var(--space-2);
}

.page-head h1 {
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.page-head p {
  margin-top: 4px;
  font-size: 13px;
}

.page-toolbar {
  display: flex;
  margin-top: var(--space-4);
}

.board-card {
  margin-top: var(--space-3);
  padding: var(--space-4);
  overflow: hidden;
}

.board-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  padding: 4px 2px 12px;
}

.fs-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 50px;
  margin-top: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--primary);
  font-weight: 600;
}

.fs-button.active {
  border-color: var(--primary-ring);
  background: var(--primary-soft);
}

.legend {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-4);
  font-size: 12px;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid var(--border-strong);
  background: var(--bg-card);
}

.dot.blank {
  border-style: dashed;
  background: transparent;
}

.legend .blank + * {
  margin-left: 0;
}

.footnote {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-4);
  font-size: 11px;
}

.fs-overlay {
  position: fixed;
  z-index: 200;
  inset: 0;
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
  padding: calc(8px + var(--safe-top)) var(--space-4) calc(8px + var(--safe-bottom));
  background: var(--bg-page);
}

.fs-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-2);
  flex: none;
  min-height: 44px;
}

.fs-title {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.fs-title strong {
  font-size: 14px;
  font-weight: 600;
}

.fs-title span {
  font-size: 10px;
}

.fs-exit {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-main);
  font-size: 13px;
}

.fs-stage {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
}

.rotate-hint {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  margin-top: 6px;
  padding: 6px var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 12px;
  text-align: center;
}

.rotate-hint.strong {
  background: var(--text-main);
  color: var(--text-inverse);
}

:global(body.portal-fs) {
  overflow: hidden;
}
</style>
