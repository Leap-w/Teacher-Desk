<script setup lang="ts">
import { AppBadge, AppCard } from '@/components/ui'
import type { Student } from '@/types'
import StudentAvatar from './StudentAvatar.vue'

const props = withDefaults(
  defineProps<{
    student: Student
    /** 批量管理模式下卡片可勾选（Phase 5B）：点卡片 = 勾选，而不是打开详情 */
    selectable?: boolean
    selected?: boolean
  }>(),
  {
    selectable: false,
    selected: false,
  },
)

const emit = defineEmits<{
  open: [student: Student]
  toggle: [student: Student]
}>()

/**
 * 点击 / 回车的分流。批量模式下卡片是「选择器」而不是「入口」——
 * 否则教师想勾一个人，却每次都弹出详情弹窗，得先关掉才能继续选。
 */
function activate() {
  if (props.selectable) {
    emit('toggle', props.student)
    return
  }
  emit('open', props.student)
}
</script>

<template>
  <AppCard
    class="student-card"
    :class="{ 'is-selectable': selectable, 'is-selected': selected }"
    :hoverable="!selectable"
    :role="selectable ? undefined : 'button'"
    :tabindex="selectable ? undefined : 0"
    @click="activate"
    @keydown.enter="activate"
  >
    <!--
      勾选控件放在右上角：左上角是头像，挤在一起会让人分不清点的是哪一个。
      `@click.stop` 不能省——卡片根元素本身带 `@click`，不拦的话点一下会
      既勾选（或取消）又触发一次 activate，等于白点。
    -->
    <label v-if="selectable" class="picker" @click.stop>
      <input
        type="checkbox"
        class="picker-input"
        :checked="selected"
        :aria-label="`选择 ${student.name}`"
        @change="emit('toggle', student)"
      />
    </label>

    <div class="card-top">
      <StudentAvatar :name="student.name" />
      <div class="who">
        <h3 class="name">{{ student.name }}</h3>
        <!-- 学号自 Phase 5A 起可选，空值按 §2.3 显示占位符 -->
        <p class="meta">{{ student.studentNo || '—' }}</p>
      </div>
    </div>

    <!--
      顺序按「班主任日常要看的先后」排（Phase 5A）：班委先于标签，宿舍与电话垫底。
      返家范围从卡片上撤下——它是周末统计口径，日常不看，占的是最显眼的位置。
      不再显示座位号：档案已不维护它，摆在这里的是一个只读不写的值（§2.3）。

      空值规则（Phase 5B 固化）：**身份区用占位符，补充区整块隐藏**——
      姓名下方的学号是身份的一部分，空着也要说明「这里本该有学号」；
      而班委 / 标签 / 宿舍 / 电话是补充信息，没有就不占位置。两者混用会让卡片
      出现大片破折号，信息密度反而下降。
    -->
    <div v-if="student.cadreRole || student.tags?.length" class="badges">
      <AppBadge v-if="student.cadreRole" variant="primary">{{ student.cadreRole }}</AppBadge>
      <AppBadge v-for="tag in student.tags ?? []" :key="tag" variant="neutral">{{ tag }}</AppBadge>
    </div>

    <p v-if="student.dormitory" class="line">宿舍 · {{ student.dormitory }}</p>
    <p v-if="student.phone" class="line">电话 · {{ student.phone }}</p>
  </AppCard>
</template>

<style scoped>
/* 样式一律写在卡片自己这里，不动 AppCard 本体——那是全站共用组件，
   改它会波及首页、座位图等所有卡片（Phase 5B 的「保持现有布局，不重构组件结构」） */
.student-card {
  cursor: pointer;
}

.student-card.is-selectable {
  position: relative;
}

/* 选中态。`.is-selected:hover` 这一档不能省：`.app-card:hover` 也在改 box-shadow，
   同分情况下由样式注入顺序决定胜负，而那是模块图的副产物，不该拿来赌 */
.student-card.is-selected,
.student-card.is-selected:hover {
  background: var(--color-primary-soft);
  border-color: var(--color-primary);
  box-shadow: var(--ring-focus);
}

/* 按下时轻微下沉：AppCard 的 transition 早就为 transform 留了位置，一直没人用 */
.student-card:active {
  transform: translateY(1px);
}

.student-card:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.picker {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  display: inline-flex;
  padding: var(--space-1);
  cursor: pointer;
}

.picker-input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--color-primary);
  cursor: pointer;
}

.card-top {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.name {
  font-size: var(--text-md);
  font-weight: 600;
}

.meta {
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

/* 标签多了会自动换行：`.badges` 已是 flex + wrap，无需为「多标签」单独写规则 */
.badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

/* 单个标签过长时不撑破卡片。AppBadge 自带的 `white-space: nowrap` 在这里要放开，
   否则长标签不会换行、只会溢出卡片边界 */
.badges :deep(.app-badge) {
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}

/* 统一走 --space-3。原先这里靠 `.badges + .line` 兜第一个 .line 的上边距，
   那条相邻兄弟选择器只在「宿舍非空」时成立，宿舍空而电话有时就会少一档间距 */
.line {
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}
</style>
