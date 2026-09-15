<script setup lang="ts">
/**
 * SeatCard — 座位卡（V2.0.4-alpha · Phase UI-4B）：
 * Apple Classroom 风的统一座位块——上：首字头像 + 姓名；中：座位号；边缘：强调标记
 * （班委顶条 / 高个顶条 / 女生底条 / 标签角点，颜色一律来自 theme.css）。
 *
 * v3.3.2：新增**女生底条**（`is-girl`，由父级 `seatClass` 计算）——顶部条画的是「角色」
 * （班委 / 高个），底部条画的是「性别」，两条信息分列卡片两端、互不遮蔽。
 * **只在网站屏幕上**：导出图走的是另一套实现（`SeatExportGraphic.vue`），不带性别标记。
 * 纯展示组件：交互（点击 / 拖拽）由父级通过原生事件穿透绑定，data-seat-id 也由
 * 父级传入后落到根按钮（拖拽落点判定 `closest('[data-seat-id]')` 依赖它）。
 */
withDefaults(
  defineProps<{
    /** 姓名（空位为空） */
    name?: string
    /** 姓名首字（头像占位） */
    char?: string
    /** 座位号文案，如「12 号」 */
    ordinal: string
    /** 空位 */
    empty?: boolean
    /** 状态类（is-selected / is-flashing / is-changed / is-cadre…由父级 seatClass 计算） */
    classes?: Record<string, boolean>
    /** 原生 title（悬停信息） */
    title?: string
  }>(),
  {
    name: '',
    char: '',
    empty: false,
    classes: () => ({}),
    title: '',
  },
)
</script>

<template>
  <button type="button" class="seat" :class="classes" :title="title">
    <!-- 女生标记（v3.3.2）：底部细条，与顶部条（班委 / 高个）分列两端、互不遮蔽。
         伪元素只有 ::before / ::after 两个且已被顶条与标签角点占用，故这里用真实元素 -->
    <span v-if="classes['is-girl']" class="seat-gender-bar" aria-hidden="true" />
    <template v-if="!empty">
      <span class="seat-avatar" aria-hidden="true">{{ char }}</span>
      <span class="seat-name">{{ name }}</span>
      <span class="seat-no">{{ ordinal }}</span>
    </template>
    <template v-else>
      <svg
        class="seat-empty-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M7 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
        <path d="M7 17v2M17 17v2" />
      </svg>
      <span class="seat-empty-text">空</span>
    </template>
  </button>
</template>

<style scoped>
/* ---- 统一 Seat Card：同一排里等分，跨排严格等宽 ---- */
/*
  v3.3.0：座位改为**等分整行宽度**（`flex: 1 1 0`），不再是固定 64px。
  固定宽度是「座位图只占中间 60%、两侧大片留白」的根因——窗口多宽，
  9 列都只吃掉 9×64=576px，剩下的全空着。交给 flex 分配后，
  同一排三个列块各占 1/3、块内三个座位再各占 1/3，跨排天然对齐
  （每一排的结构都是 3/3/3，所以等分结果逐列一致）。

  `width` 只在**父级不是 flex 容器**时兜底——那种情况下 flex 属性无效，
  座位仍按老尺寸渲染，不会塌成 0 宽。
  `min-width` 是地板：窄窗口下排不下了就让 `.room-scroll` 横向滚动，
  而不是把姓名挤成一列点。

  v3.3.1：**整体缩一号**（宽 140→126、高 100→90，约 −10%），省下的横向空间
  交给两条过道（12→24px），三组三人因此一眼分得开；座位本身从「大卡片」
  回到「格子」的比例。`max-width` 必须与 SeatClassroom 里 `.col-no` 的那个值
  保持一致——列号行与座位行是两条独立的 flex 行，只有约束相同才会逐列对齐。
  `max-width` 只在宽屏生效（窄窗口下座位本来就排不满，拿不到 126px）。
*/
.seat {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  flex: 1 1 0;
  min-width: 48px;
  max-width: 126px;
  width: clamp(52px, 5vw, 58px);
  height: clamp(68px, 6vw, 90px);
  padding: 6px 5px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-xs);
  font: inherit;
  text-align: center;
  cursor: pointer;
  overflow: hidden;
  user-select: none; /* 防拖拽过程中选中文字产生原生拖影 */
  -webkit-user-select: none;
  touch-action: pan-y; /* 保留页面纵向滚动，拖拽方向判定在父级 pointermove 内完成 */
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out),
    opacity var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

/* Hover：2px 微抬升 + 主色边框 + 一层极浅主色底（「这个座位可以点」的即时回执） */
@media (hover: hover) {
  .seat:hover:not(.is-empty) {
    transform: translateY(-2px);
    border-color: var(--color-primary);
    background: var(--color-primary-bg);
    box-shadow: var(--shadow-sm);
  }
}

.seat:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

/* 对比变化高亮 = 琥珀描边（先于选中态声明，选中环仍可覆盖） */
.seat.is-changed {
  border-color: var(--color-warning-strong);
  box-shadow: var(--ring-warning-soft);
}

/* 定位闪烁（3 次约 1.5s，父级定时清类以支持重放） */
.seat.is-flashing {
  animation: seat-flash 0.5s ease-in-out 3;
}

@keyframes seat-flash {
  0%,
  100% {
    border-color: var(--color-border);
    box-shadow: none;
  }

  45% {
    border-color: var(--color-warning-strong);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-warning) 55%, transparent);
  }
}

.seat.is-selected {
  border-color: var(--color-primary);
  box-shadow: var(--ring-focus);
}

/* ---- 空座：统一 Empty Seat（虚线 + 空座插画），不是普通空白 ---- */
.seat.is-empty {
  background: var(--color-bg-subtle);
  border-style: dashed;
  cursor: default;
}

.seat-empty-icon {
  width: 22px;
  height: 22px;
  color: var(--color-text-faint);
  opacity: 0.7;
}

.seat-empty-text {
  font-size: var(--font-caption);
  color: var(--color-text-faint);
  line-height: 1;
}

.seat.is-drop-target.is-empty {
  border-style: solid;
}

/* ---- 内容 ---- */
.seat-avatar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
}

/*
  v3.3.0：座位宽了，姓名跟着升一档（12 → 13px）——「姓名与学号更清晰」。
  v3.3.1：**姓名必须完整显示**——重名学生带尾号后（「旦增卓玛（3287）」）一行放不下，
  所以去掉省略号，改成最多折两行（超长姓名仍由 overflow: hidden 兜底，不会顶出卡片）。
  省略号在座位图上是「这学生叫什么？」的坑：教师看到的是一串「旦增卓…」，
  而重名区分恰恰要靠括号里那几个字。
*/
.seat-name {
  max-width: 100%;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text);
  line-height: 1.15;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: normal;
}

.seat-no {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  line-height: 1.2;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* ---- 强调标记：班委 = 顶条主色，高个 = 顶条琥珀，其他标签 = 角点 ---- */
.seat.is-cadre::before,
.seat.is-tall::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
}

/*
  女生 = 底条（v3.3.2）。**为什么是底部而不是顶部**：顶部条已经被班委 / 高个占用，
  两者都画在 `::before` 上——同一个学生既是班委又是女生时，若都往顶部画就只剩一条。
  分列上下两端之后，顶部说的是「角色」、底部说的是「性别」，两条同时成立、各自可见。
  高度与顶条同是 3px、圆角跟着卡片下沿走，视觉上就是同一套标记语言的下半部分。
*/
.seat-gender-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  border-radius: 0 0 var(--radius-md) var(--radius-md);
  background: var(--color-gender-female);
}

.seat.is-cadre::before {
  background: var(--color-primary-strong);
}

.seat.is-tall::before {
  background: var(--color-warning);
}

.seat.is-tag::after {
  content: '';
  position: absolute;
  top: 3px;
  right: 3px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-text-secondary);
}

/* ---- 拖拽 / 换座模式反馈（状态类由父级计算，样式归卡片） ---- */
/* 拖拽源：压暗 */
.seat.is-drag-source {
  opacity: 0.45;
  border-color: var(--color-primary);
  transform: none;
}

/* 有效落点：松石青边框 + Glow + 3% 放大（突然交换被 FLIP / 状态提示取代，不闪跳） */
.seat.is-drop-target {
  transform: scale(1.03);
  border-color: var(--color-primary-strong);
  box-shadow:
    0 0 0 4px var(--color-primary-soft-strong),
    0 0 14px rgba(74, 140, 148, 0.35);
}

/* 点击换座模式源座位（长按卡「开始换座」）：虚线框 + 选中环 */
.seat.is-pick-source {
  border-color: var(--color-primary-strong);
  outline: 2px dashed var(--color-primary);
  outline-offset: 2px;
  box-shadow: var(--ring-focus);
}
</style>
