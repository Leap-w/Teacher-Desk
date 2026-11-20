<script setup lang="ts">
import { computed, ref } from 'vue'
import { portalData } from '../data'
import type { Photo, Student } from '../data'
import Icon from '../components/Icon.vue'

interface PhotoSubject {
  photo: Photo
  student: Student
}

const keyword = ref('')
const active = ref<PhotoSubject | null>(null)

const subjects = computed<PhotoSubject[]>(() =>
  portalData.photos
    .map((photo) => ({ photo, student: portalData.studentById(photo.studentId) }))
    .filter((item): item is PhotoSubject => !!item.student)
    // 证件照优先、生活照在后；同组沿用快照里的姓名序。
    .sort((a, b) => {
      const categoryRank = (item: PhotoSubject) => (item.photo.category === 'id-photo' ? 0 : 1)
      return categoryRank(a) - categoryRank(b)
    }),
)

const query = computed(() => keyword.value.trim())
const filtered = computed(() => {
  const q = query.value
  if (!q) return subjects.value
  const needle = q.toLocaleLowerCase()
  // 只按姓名搜索：快照不导出学号 / 内部 ID，文案也必须与实际能力一致。
  return subjects.value.filter((item) => item.student.name.toLocaleLowerCase().includes(needle))
})

function clearSearch() {
  keyword.value = ''
}
</script>

<template>
  <div class="page photos">
    <header class="page-head">
      <h1>学生照片</h1>
      <p class="muted">
        {{ portalData.classInfo.name }} ·
        {{ portalData.mode === 'demo' ? '虚构演示照片' : '证件照与生活照' }}
      </p>
    </header>

    <div class="search-box">
      <Icon name="search" :size="18" />
      <input v-model="keyword" type="search" placeholder="搜索学生姓名" aria-label="搜索学生姓名" />
      <button v-if="keyword" type="button" aria-label="清空搜索" @click="keyword = ''">
        <Icon name="close" :size="16" />
      </button>
    </div>

    <div v-if="filtered.length" class="id-grid">
      <button
        v-for="item in filtered"
        :key="item.photo.id"
        type="button"
        class="id-card"
        :data-student-name="item.student.name"
        @click="active = item"
      >
        <span class="portrait">
          <img
            :src="portalData.photoUrl(item.photo)"
            :alt="`${item.student.name} 的${item.photo.category === 'life-photo' ? '生活照' : '证件照'}`"
            loading="lazy"
            decoding="async"
          />
        </span>
        <span class="name">
          {{ item.student.name }}
          <small v-if="item.photo.category === 'life-photo'" class="category">生活照</small>
        </span>
      </button>
    </div>

    <!-- 空搜索词 + 没有照片 ≠ 搜索无结果：两种状态必须分开，否则刚打开就误报「没有找到这位同学」。 -->
    <div v-else class="empty card">
      <div class="empty-portrait"><Icon name="users" :size="28" /></div>
      <template v-if="query">
        <p>没有找到这位同学</p>
        <button type="button" class="reset" @click="clearSearch">清空搜索</button>
      </template>
      <template v-else>
        <p>暂无学生照片</p>
        <p class="empty-hint">照片会随 TeacherDesk 的导出快照一起打包，重新导出即可更新。</p>
      </template>
    </div>

    <p v-if="portalData.mode === 'demo'" class="footnote muted">
      <Icon name="info" :size="14" /> 均为虚构占位图，非真实学生照片
    </p>

    <Teleport to="body">
      <div v-if="active" class="lightbox" @click.self="active = null">
        <button type="button" class="lightbox-close" aria-label="关闭大图" @click="active = null">
          <Icon name="close" :size="22" />
        </button>
        <figure>
          <span class="lightbox-portrait">
            <img
              :src="portalData.photoUrl(active.photo)"
              :alt="`${active.student.name} 的${active.photo.category === 'life-photo' ? '生活照' : '证件照'}`"
            />
          </span>
          <figcaption>
            <strong>{{ active.student.name }}</strong>
            <span class="muted">{{
              active.photo.category === 'life-photo' ? '生活照' : '证件照'
            }}</span>
          </figcaption>
        </figure>
      </div>
    </Teleport>
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

.search-box {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 48px;
  margin-top: var(--space-5);
  padding: 0 var(--space-3);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-sub);
}

.search-box:focus-within {
  border-color: var(--primary-ring);
}

.search-box input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 14px;
}

.search-box input::placeholder {
  color: var(--text-sub);
}

.search-box button {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  background: transparent;
  color: var(--text-sub);
}

.id-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.id-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  text-align: center;
}

.portrait {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  background: var(--bg-subtle);
}

/* Crop the old placeholder captions out of view; the student name below is the label. */
.portrait img {
  width: 100%;
  height: 150%;
  object-fit: cover;
  object-position: center top;
}

.name {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: var(--space-3) var(--space-2);
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category {
  flex: none;
  padding: 1px 5px;
  border-radius: var(--radius-pill);
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 10px;
  font-weight: 500;
}

.empty-hint {
  max-width: 280px;
  color: var(--text-sub);
  font-size: 11px;
  font-weight: 400;
  line-height: 1.5;
  text-align: center;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-4);
  padding: var(--space-10) var(--space-4);
  color: var(--primary);
}

.empty-portrait {
  display: grid;
  place-items: center;
  width: 72px;
  height: 96px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
}

.empty p {
  margin-top: var(--space-2);
  color: var(--text-main);
  font-weight: 600;
}

.reset {
  min-height: 44px;
  margin-top: var(--space-2);
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 500;
}

.footnote {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-6);
  font-size: 11px;
}

.lightbox {
  position: fixed;
  z-index: 150;
  inset: 0;
  display: grid;
  place-items: center;
  padding: var(--space-6) var(--space-4);
  background: rgba(20, 32, 30, 0.9);
}

.lightbox-close {
  position: absolute;
  top: calc(var(--space-4) + var(--safe-top));
  right: var(--space-4);
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

.lightbox figure {
  margin: 0;
  width: min(100%, 420px);
}

.lightbox-portrait {
  display: block;
  width: 100%;
  max-height: 72vh;
  aspect-ratio: 3 / 4;
  margin: 0 auto;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--bg-card);
}

.lightbox-portrait img {
  width: 100%;
  height: 150%;
  object-fit: cover;
  object-position: center top;
}

.lightbox figcaption {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: var(--space-3);
  color: #fff;
  text-align: center;
}

.lightbox figcaption .muted {
  color: rgba(255, 255, 255, 0.65);
  font-size: 12px;
}

@media (min-width: 768px) {
  .id-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
