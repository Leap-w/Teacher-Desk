<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowDownLeft, ArrowUpRight, Layers, Plus } from 'lucide-vue-next'

import { AppButton, AppModal } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { useFundStore } from '@/stores/fund'
import { useUserStore } from '@/stores/user'
import { filterByRange, flowEntrySourceId, formatMoney, totalsOf } from '@/utils/fund'
import {
  FUND_BATCHES_PER_PAGE,
  FUND_ROWS_PER_PAGE,
  buildFundCollectionSheet,
  buildFundFlowSheet,
  fundExportFilename,
  fundExportTitle,
  paginate,
} from '@/utils/fundExport'
import {
  createPdf,
  embedPdfImage,
  exportDateLabel,
  exportDateStamp,
  renderExportNode,
} from '@/utils/seatExport'
import { buildXlsxBook, downloadXlsxBuffer } from '@/utils/xlsxBook'
import type { FundExportKind } from '@/utils/fundExport'
import type {
  FundCollection,
  FundCollectionInput,
  FundFlowEntry,
  FundRange,
  FundRecord,
  FundRecordInput,
  FundRecordType,
} from '@/types/fund'
import FundCollectionDetail from './components/FundCollectionDetail.vue'
import FundCollectionDrawer from './components/FundCollectionDrawer.vue'
import FundCollectionSection from './components/FundCollectionSection.vue'
import type { FundCollectionCard } from './components/FundCollectionSection.vue'
import FundExportLedgerSheet from './components/FundExportLedgerSheet.vue'
import FundExportMenu from './components/FundExportMenu.vue'
import FundExportRosterSheet from './components/FundExportRosterSheet.vue'
import type { FundExportBatch } from './components/FundExportRosterSheet.vue'
import FundExportSheet from './components/FundExportSheet.vue'
import FundFlowList from './components/FundFlowList.vue'
import FundHero from './components/FundHero.vue'
import FundRecordDetail from './components/FundRecordDetail.vue'
import FundRecordDrawer from './components/FundRecordDrawer.vue'

/**
 * 班费管理（v3.6.0，规格第二～十节）——班级电子流水账。
 *
 * 版面自上而下：**余额卡（含统计范围切换）→ 收支流水 → 收费批次 → FAB**。
 * 余额放第一屏第一眼，是因为教师打开这一页真正要看的常常只有那一个数。
 *
 * 三条贯穿本页的约定：
 *
 * ① **所有写操作都从这一页发起**（`fundStore` 的增删改只在这里被调用）。
 *    下面的详情 / 名单 / 抽屉组件都是只读展示 + emit——删一个批次之后该发生什么
 *    （二次确认、toast、关掉哪一层）只有页面知道，组件不该各自猜。
 *
 * ② **余额永远来自 `fundStore.balance`（全部口径）**，收入 / 支出 / 笔数跟着切换走。
 *    详见 `FundHero` 的说明。
 *
 * ③ **导出恒为全部口径**，不看页面上的切换：导出的是账本本身，不是当前这一屏。
 *
 * 本页不挂「⚙ 设置」按钮：班费没有自己的设置项，链到设置页只会落在一个空组上。
 */
const fundStore = useFundStore()
const userStore = useUserStore()
const toast = useToast()

/* ==================== 统计范围 ==================== */

const range = ref<FundRange>('all')

/** 当前范围内的流水（切换只影响这一份，不影响余额与导出） */
const rangeEntries = computed(() =>
  filterByRange(fundStore.flowEntries, range.value, fundStore.todayKey, fundStore.termRange),
)
const rangeTotals = computed(() => totalsOf(rangeEntries.value))

/** 批次卡片：名单进度与金额都从 store 的同一份口径取 */
const collectionCards = computed<FundCollectionCard[]>(() =>
  fundStore.collections.map((collection) => {
    const { paid, total } = fundStore.progressOf(collection.id)
    return {
      collection,
      paid,
      total,
      income: fundStore.incomeOf(collection.id),
      percent: total ? Math.round((paid / total) * 100) : 0,
    }
  }),
)

/* ==================== FAB：记一笔 / 建批次 ==================== */

const fabOpen = ref(false)

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') fabOpen.value = false
}

onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))

/* ==================== 流水：新增 / 编辑 ==================== */

const recordOpen = ref(false)
const recordType = ref<FundRecordType>('expense')
/** 编辑中的流水 id（空串 = 新增）。**存 id 而不是对象**：store 是不可变替换，
    握着一个旧对象会在下一次改写后变成一行过期数据 */
const editingRecordId = ref('')
const editingRecord = computed(() =>
  fundStore.records.find((item) => item.id === editingRecordId.value),
)

function openCreateRecord(type: FundRecordType) {
  fabOpen.value = false
  editingRecordId.value = ''
  recordType.value = type
  recordOpen.value = true
}

function openEditRecord(record: FundRecord) {
  recordDetailId.value = ''
  editingRecordId.value = record.id
  recordType.value = record.type
  recordOpen.value = true
}

function onRecordSubmit(input: FundRecordInput) {
  const editing = editingRecord.value
  const saved = editing ? fundStore.updateRecord(editing.id, input) : fundStore.addRecord(input)
  if (!saved) {
    toast.danger('保存失败：请检查标题、金额和日期')
    return
  }
  recordOpen.value = false
  toast.success(
    editing
      ? '已保存修改'
      : `已记一笔${input.type === 'income' ? '收入' : '支出'} ${formatMoney(input.amount)}`,
  )
}

/* ==================== 流水详情 / 删除 ==================== */

const recordDetailId = ref('')
const recordDetail = computed(() =>
  fundStore.records.find((item) => item.id === recordDetailId.value),
)

const recordConfirmOpen = ref(false)
const recordToRemove = ref<FundRecord | undefined>(undefined)

/** 点流水列表的一行：批次行看名单，手记行看详情 */
function openEntry(entry: FundFlowEntry) {
  const sourceId = flowEntrySourceId(entry)
  if (entry.kind === 'collection') collectionDetailId.value = sourceId
  else recordDetailId.value = sourceId
}

function askRemoveRecord(record: FundRecord) {
  recordDetailId.value = ''
  recordToRemove.value = record
  recordConfirmOpen.value = true
}

function confirmRemoveRecord() {
  const target = recordToRemove.value
  recordConfirmOpen.value = false
  recordToRemove.value = undefined
  if (!target) return
  if (!fundStore.removeRecord(target.id)) {
    toast.danger('删除失败：这一笔可能已经被移除')
    return
  }
  toast.success(`已删除「${target.title}」`)
}

/* ==================== 收费批次 ==================== */

const collectionFormOpen = ref(false)
const collectionFormId = ref('')
const editingCollection = computed(() =>
  fundStore.collections.find((item) => item.id === collectionFormId.value),
)
/** 编辑批次时的已交人数（抽屉据此预告「改金额会重算成多少」） */
const editingPaidCount = computed(() =>
  collectionFormId.value ? fundStore.progressOf(collectionFormId.value).paid : 0,
)

const collectionDetailId = ref('')
const detailCollection = computed(() =>
  fundStore.collections.find((item) => item.id === collectionDetailId.value),
)
const detailRows = computed(() =>
  collectionDetailId.value ? fundStore.rosterOf(collectionDetailId.value) : [],
)

const collectionConfirmOpen = ref(false)
const collectionToRemove = ref<FundCollection | undefined>(undefined)

function openCreateCollection() {
  fabOpen.value = false
  collectionFormId.value = ''
  collectionFormOpen.value = true
}

function openCollectionDetail(collection: FundCollection) {
  collectionDetailId.value = collection.id
}

/** 从名单抽屉进「编辑信息」：关掉名单，避免两层抽屉叠在一起 */
function openEditCollection() {
  const target = detailCollection.value
  if (!target) return
  collectionDetailId.value = ''
  collectionFormId.value = target.id
  collectionFormOpen.value = true
}

function onCollectionSubmit(input: FundCollectionInput) {
  const editing = editingCollection.value
  const saved = editing
    ? fundStore.updateCollection(editing.id, input)
    : fundStore.addCollection(input)
  if (!saved) {
    toast.danger('保存失败：请检查名称、金额和日期')
    return
  }
  collectionFormOpen.value = false
  toast.success(editing ? '已保存批次信息' : `已建批次「${saved.title}」，去名单里勾选已交的学生`)
}

/** 勾选 / 取消一个学生：不弹 toast——一次收几十个人的费，弹几十条提示是噪音 */
function onTogglePaid(studentId: string) {
  const id = collectionDetailId.value
  if (!id) return
  fundStore.togglePaid(id, studentId)
}

function onSetAllPaid(paid: boolean) {
  const id = collectionDetailId.value
  if (!id) return
  const before = fundStore.progressOf(id).paid
  if (!fundStore.setAllPaid(id, paid)) {
    toast.danger('操作失败：这个批次可能已经被删除')
    return
  }
  const after = fundStore.progressOf(id).paid
  toast.success(paid ? `已把 ${after} 名学生标为已交` : `已取消 ${before} 名学生的已交标记`)
}

function askRemoveCollection() {
  const target = detailCollection.value
  if (!target) return
  collectionDetailId.value = ''
  collectionToRemove.value = target
  collectionConfirmOpen.value = true
}

function confirmRemoveCollection() {
  const target = collectionToRemove.value
  collectionConfirmOpen.value = false
  collectionToRemove.value = undefined
  if (!target) return
  if (!fundStore.removeCollection(target.id)) {
    toast.danger('删除失败：这个批次可能已经被移除')
    return
  }
  toast.success(`已删除批次「${target.title}」，流水里的那一行收入随之消失`)
}

/* ==================== 导出（规格第十节） ==================== */

const exportBusy = ref<FundExportKind | null>(null)
/** 导出当天固定下来的日期文案（标题与文件名同一天，跨零点不会各写各的） */
const exportedDateText = ref(exportDateLabel())
const exportDateText = ref(exportDateStamp())
const stageEl = ref<HTMLElement>()

const className = computed(() => userStore.profile.className)
const exportTitle = computed(() => fundExportTitle(className.value))
const exportSubtitle = computed(() => `全部收支 · 导出日期 ${exportedDateText.value}`)

/** 账页分页：每页 15 条流水，页数随记录增长 */
const flowPages = computed(() => paginate(fundStore.flowEntries, FUND_ROWS_PER_PAGE))

/** 名单页的批次数据：名单取自 store（与屏幕上同一份，重名已消歧） */
const exportBatches = computed<FundExportBatch[]>(() =>
  fundStore.collections.map((collection) => {
    const { paid, total } = fundStore.progressOf(collection.id)
    return {
      collection,
      rows: fundStore.rosterOf(collection.id),
      paid,
      total,
      income: fundStore.incomeOf(collection.id),
    }
  }),
)
const rosterPages = computed(() => paginate(exportBatches.value, FUND_BATCHES_PER_PAGE))
/** 纸面总页数 = 流水页 + 名单页（PDF 的页序就是这个顺序） */
const totalPages = computed(() => flowPages.value.length + rosterPages.value.length)

function pageLabelOf(index: number) {
  return `第 ${index + 1} 页 / 共 ${totalPages.value} 页`
}

/** 离屏节点 → 画布。`renderExportNode` 内部会等字体就绪，中文与 ✓ / ○ 不会缺字 */
async function captureNode(node: HTMLElement) {
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  return renderExportNode(node)
}

async function runExport(kind: FundExportKind) {
  if (exportBusy.value) return
  if (fundStore.flowEntries.length === 0) {
    toast.warning('还没有任何收支记录，先记一笔再导出')
    return
  }
  exportBusy.value = kind
  exportedDateText.value = exportDateLabel()
  exportDateText.value = exportDateStamp()
  try {
    if (kind === 'xlsx-ledger') {
      const sheets = [buildFundFlowSheet(fundStore.flowEntries)]
      const collectionSheet = buildFundCollectionSheet(
        exportBatches.value.map((batch) => ({ title: batch.collection.title, rows: batch.rows })),
      )
      // 一个批次都没有时不加第二个工作表：一张空表会让人以为导出漏了东西
      if (collectionSheet) sheets.push(collectionSheet)
      const buffer = await buildXlsxBook(sheets)
      if (!buffer) throw new Error('工作簿生成失败')
      const filename = fundExportFilename(className.value, kind, exportDateText.value)
      if (!downloadXlsxBuffer(buffer, filename)) throw new Error('浏览器未接受下载')
      toast.success('已导出班费账目')
    } else {
      const nodes = [...(stageEl.value?.querySelectorAll<HTMLElement>('.stage-node') ?? [])]
      if (nodes.length === 0) throw new Error('导出页未就绪')
      const pdf = createPdf()
      for (const [index, node] of nodes.entries()) {
        const canvas = await captureNode(node)
        if (index > 0) pdf.addPage()
        embedPdfImage(pdf, canvas, { y: 10 })
      }
      pdf.save(fundExportFilename(className.value, kind, exportDateText.value))
      toast.success('已导出班费账目')
    }
  } catch (error) {
    console.error('[fund export] 导出失败：', error)
    toast.danger('导出失败：请刷新后重试')
  } finally {
    exportBusy.value = null
  }
}
</script>

<template>
  <div class="fund-page">
    <header class="page-head">
      <div>
        <h1 class="page-title">班费管理</h1>
        <p class="page-subtitle">
          共 {{ fundStore.flowEntries.length }} 笔流水 ·
          {{ fundStore.collections.length }} 个收费批次
        </p>
      </div>
      <div class="head-actions">
        <FundExportMenu :busy="exportBusy" @request="runExport" />
      </div>
    </header>

    <FundHero
      :balance="fundStore.balance"
      :income="rangeTotals.income"
      :expense="rangeTotals.expense"
      :count="rangeTotals.count"
      :range="range"
      @update:range="range = $event"
    />

    <section class="layer-section">
      <h2 class="layer-title">收支流水</h2>
      <FundFlowList
        :entries="rangeEntries"
        :range="range"
        :has-any="fundStore.flowEntries.length > 0"
        @select="openEntry"
      />
    </section>

    <FundCollectionSection
      class="layer-section"
      :cards="collectionCards"
      @create="openCreateCollection"
      @open="openCollectionDetail"
    />

    <!-- ===== 记账入口：FAB（收入 / 支出 / 收费批次） ===== -->
    <div v-if="fabOpen" class="fab-scrim" @click="fabOpen = false" />

    <Transition name="fab-pop">
      <div v-if="fabOpen" class="fab-menu" role="menu" aria-label="记一笔">
        <button type="button" class="fab-item" role="menuitem" @click="openCreateRecord('income')">
          <span class="fab-icon is-income" aria-hidden="true">
            <ArrowDownLeft :size="17" :stroke-width="2" />
          </span>
          <span class="fab-text">
            <span class="fab-item-title">收入</span>
            <span class="fab-item-desc">收班费、补缴、退款</span>
          </span>
        </button>

        <button type="button" class="fab-item" role="menuitem" @click="openCreateRecord('expense')">
          <span class="fab-icon is-expense" aria-hidden="true">
            <ArrowUpRight :size="17" :stroke-width="2" />
          </span>
          <span class="fab-text">
            <span class="fab-item-title">支出</span>
            <span class="fab-item-desc">买东西、班级活动</span>
          </span>
        </button>

        <button type="button" class="fab-item" role="menuitem" @click="openCreateCollection">
          <span class="fab-icon" aria-hidden="true">
            <Layers :size="17" :stroke-width="2" />
          </span>
          <span class="fab-text">
            <span class="fab-item-title">收费批次</span>
            <span class="fab-item-desc">勾名单，金额自动算</span>
          </span>
        </button>
      </div>
    </Transition>

    <button
      type="button"
      class="fund-fab"
      :aria-expanded="fabOpen ? 'true' : 'false'"
      aria-haspopup="menu"
      :aria-label="fabOpen ? '收起记账入口' : '记一笔'"
      @click="fabOpen = !fabOpen"
    >
      <Plus :size="22" :stroke-width="2" aria-hidden="true" />
      <span class="fab-label">记一笔</span>
    </button>

    <!-- ===== 抽屉与弹窗 ===== -->
    <FundRecordDrawer
      v-model="recordOpen"
      :record="editingRecord"
      :default-type="recordType"
      @submit="onRecordSubmit"
    />

    <FundRecordDetail
      :model-value="Boolean(recordDetail)"
      :record="recordDetail"
      @update:model-value="recordDetailId = ''"
      @edit="openEditRecord"
      @remove="askRemoveRecord"
    />

    <FundCollectionDrawer
      v-model="collectionFormOpen"
      :collection="editingCollection"
      :paid-count="editingPaidCount"
      @submit="onCollectionSubmit"
    />

    <FundCollectionDetail
      :model-value="Boolean(detailCollection)"
      :collection="detailCollection"
      :rows="detailRows"
      @update:model-value="collectionDetailId = ''"
      @toggle="onTogglePaid"
      @set-all="onSetAllPaid"
      @edit="openEditCollection"
      @remove="askRemoveCollection"
    />

    <AppModal v-model="recordConfirmOpen" title="删除这条记录" :width="380">
      <p class="confirm-text">
        确定删除<strong>{{ recordToRemove ? recordToRemove.title : '' }}</strong>
        这一笔吗？删除后余额会立刻跟着变，此操作无法撤销。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="recordConfirmOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemoveRecord">删除记录</AppButton>
      </template>
    </AppModal>

    <AppModal v-model="collectionConfirmOpen" title="删除收费批次" :width="380">
      <p class="confirm-text">
        确定删除批次<strong>{{ collectionToRemove ? collectionToRemove.title : '' }}</strong>
        吗？它带来的收入（已交人数 × 每人金额）会一并从流水里消失，名单也不再保留。此操作无法撤销。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="collectionConfirmOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmRemoveCollection">删除批次</AppButton>
      </template>
    </AppModal>

    <!-- ===== 导出用的离屏纸面（html-to-image 抓不到 display:none，只能挪到屏幕外） ===== -->
    <div ref="stageEl" class="export-stage" aria-hidden="true">
      <div v-for="(page, index) in flowPages" :key="`flow-${index}`" class="stage-node">
        <FundExportSheet
          :title="exportTitle"
          :subtitle="exportSubtitle"
          footnote="金额列为「收入正 / 支出负」，可直接求和；合计等于当前余额。"
          :page-label="pageLabelOf(index)"
        >
          <FundExportLedgerSheet :entries="page" :totals="fundStore.totals" />
        </FundExportSheet>
      </div>

      <div v-for="(page, index) in rosterPages" :key="`roster-${index}`" class="stage-node">
        <FundExportSheet
          :title="exportTitle"
          subtitle="学生缴费名单"
          footnote="✓ 已交 · ○ 未交 · 空格 = 该批次名单里没有这名学生。"
          :page-label="pageLabelOf(flowPages.length + index)"
        >
          <FundExportRosterSheet :batches="page" />
        </FundExportSheet>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fund-page {
  max-width: var(--page-max-width);
  padding-bottom: var(--spacing-2xl);
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--spacing-lg);
}

.page-title {
  font-size: var(--font-h2);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
}

.page-subtitle {
  margin-top: var(--space-1);
  font-size: var(--font-secondary);
  color: var(--color-text-tertiary);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.layer-section {
  margin-top: var(--section-gap);
}

.layer-title {
  margin-bottom: var(--spacing-md);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
}

/* ===== FAB 与它的菜单 ===== */

.fab-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-sticky);
}

.fab-menu {
  position: fixed;
  right: max(var(--space-5), env(safe-area-inset-right, 0px));
  bottom: calc(max(var(--space-5), env(safe-area-inset-bottom, 0px)) + 60px);
  z-index: var(--z-sticky);
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 232px;
  padding: 6px;
  background: var(--glass-bg-card);
  backdrop-filter: blur(var(--nav-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--nav-blur)) saturate(150%);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
}

.fab-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}

@media (hover: hover) {
  .fab-item:hover {
    background: var(--bg-hover);
  }
}

.fab-item:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.fab-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--color-primary-soft);
  color: var(--color-primary-dark);
}

.fab-icon.is-income {
  background: var(--color-success-soft);
  color: var(--color-success-strong);
}

.fab-icon.is-expense {
  background: var(--color-danger-soft);
  color: var(--color-danger-strong);
}

.fab-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.fab-item-title {
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.fab-item-desc {
  font-size: var(--font-caption);
  color: var(--color-text-tertiary);
}

.fab-pop-enter-active,
.fab-pop-leave-active {
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
  transform-origin: bottom right;
}

.fab-pop-enter-from,
.fab-pop-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}

.fund-fab {
  position: fixed;
  right: max(var(--space-5), env(safe-area-inset-right, 0px));
  bottom: max(var(--space-5), env(safe-area-inset-bottom, 0px));
  z-index: var(--z-sticky);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 48px;
  padding: 0 var(--space-5);
  border: none;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-text-inverse);
  font-size: var(--font-secondary);
  font-weight: var(--font-weight-semibold);
  box-shadow: var(--shadow-lg);
  cursor: pointer;
  transition:
    transform var(--duration-base) var(--ease-out),
    background var(--transition-fast),
    box-shadow var(--duration-base) var(--ease-out);
}

.fund-fab:hover {
  background: var(--color-primary-hover);
  transform: translateY(-2px);
  box-shadow: var(--shadow-xl);
}

.fund-fab:active {
  transform: scale(0.97);
}

.fund-fab:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.confirm-text {
  font-size: var(--font-secondary);
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.confirm-text strong {
  color: var(--color-text-primary);
}

/* 导出纸面：固定负坐标挪出视口（html-to-image 抓不到 display:none 的节点） */
.export-stage {
  position: fixed;
  left: -10000px;
  top: -4000px;
  pointer-events: none;
  z-index: -1;
}

.stage-node {
  width: max-content;
  margin-bottom: 40px;
}

@media (max-width: 640px) {
  .fund-fab {
    right: var(--space-4);
    bottom: var(--space-4);
    width: 48px;
    padding: 0;
    justify-content: center;
  }

  .fab-label {
    display: none;
  }

  .fab-menu {
    right: var(--space-4);
    bottom: calc(var(--space-4) + 60px);
  }
}
</style>
