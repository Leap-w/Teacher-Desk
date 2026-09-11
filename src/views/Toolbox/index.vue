<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { AppButton, AppCard, AppModal } from '@/components/ui'
import { useToast } from '@/composables/useToast'
import { appConfig } from '@/config'
import {
  LAST_BACKUP_KEY,
  LEGACY_CLEAR_MODULES,
  applyWrites,
  clearAllKeys,
  countModules,
  createBackup,
  downloadJson,
  isLegacyClearItem,
  parseBackup,
  planClearSamples,
  planMerge,
  readModules,
  type BackupFile,
  type ClearPlan,
  type CommitOutcome,
  type MergeStat,
  type StoragePort,
} from '@/utils/backup'
import { formatClock, formatDateKey, formatDateOnly } from '@/utils/date'

/**
 * 工具箱（近期增量「数据管理」，见 docs/开发计划.md §六）。
 * 本页只做数据备份 / 恢复与清空：整页操作都以「写 localStorage → 重载」收尾，
 * 由八个 store 用各自既有的 normalize* 重新加载（见 utils/backup.ts 顶部说明）。
 */

const toast = useToast()

/** 重载后的一次性提示（跨页面跳转会丢，所以放 sessionStorage，落回本页时弹一次） */
const NOTICE_KEY = `${appConfig.storageKeyPrefix}:notice`

/**
 * 本机存储端口：读不到（隐私模式等）不是错误，按「没有数据」处理；
 * 写失败必须让调用方知道，故不吞异常——由 utils/backup.ts 整批回滚。
 */
const storage: StoragePort = {
  read(key) {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  write(key, value) {
    window.localStorage.setItem(key, value)
  },
  remove(key) {
    window.localStorage.removeItem(key)
  },
  /** 枚举全部键用规范 API（length + key(i)），不依赖 Object.keys 的实现细节 */
  list() {
    const keys: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key !== null) keys.push(key)
    }
    return keys
  },
}

function readAll() {
  return readModules((key) => storage.read(key))
}

/** 旧键（历史遗留，见 LEGACY_CLEAR_MODULES）：不进概览，只在「清空示例数据」里一并清 */
function readLegacy() {
  return readModules((key) => storage.read(key), LEGACY_CLEAR_MODULES)
}

/** 本机数据快照：概览与各操作共用同一次读取，避免两个数字来自不同时刻 */
const snapshot = ref(readAll())
const legacySnapshot = ref(readLegacy())
function refreshSnapshot(): void {
  snapshot.value = readAll()
  legacySnapshot.value = readLegacy()
}

const overview = computed(() => countModules(snapshot.value.values))
/** 读取异常、无法解析的数据块（绝不写盘，界面上必须说出来） */
const broken = computed(() => snapshot.value.broken)
const lastBackupAt = ref<string>(storage.read(LAST_BACKUP_KEY) ?? '')

/** 当前可清理的示例数据（按钮禁用与确认弹窗共用同一份计算结果） */
const samplePlan = ref<ClearPlan>(
  planClearSamples(snapshot.value.values, legacySnapshot.value.values),
)
const sampleTotal = computed(() =>
  samplePlan.value.removed.reduce((sum, item) => sum + item.count, 0),
)
/** 本次清空是否动到了旧课表存档（决定要不要多解释一句：它不是现行课表） */
const clearsLegacy = computed(() =>
  samplePlan.value.removed.some((item) => isLegacyClearItem(item.label)),
)

/**
 * 旧课表存档是否还在盘上（读得出原文或读不出都算——「清空全部数据」删的是键，
 * 连读不动的原文一起删，且它不在备份范围内，弹窗必须先说清楚）。
 */
const hasLegacyArchive = computed(() =>
  LEGACY_CLEAR_MODULES.some(
    (module) =>
      legacySnapshot.value.values[module.key] !== undefined ||
      legacySnapshot.value.broken.includes(module.label),
  ),
)

const lastBackupText = computed(() => {
  const iso = lastBackupAt.value
  if (!iso) return '还没有导出过备份。'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '还没有导出过备份。'
  return `上次导出：${formatDateOnly(date)} ${formatClock(date)}`
})

/* ---------- 写盘收尾（成功 / 失败两条路，绝不混说） ---------- */

/** 成功收尾：写一次性提示 → 重载，由各 store 的 normalize* 重新加载 */
function finish(notice: string): void {
  setNotice(notice)
  try {
    window.location.reload()
  } catch (error) {
    // 沙箱 iframe 里 reload 可能被拦；提示已写进 sessionStorage，下次进入本页会补弹
    console.warn('[toolbox] 页面重载被拦截：', error)
  }
}

/** 失败收尾：如实说本机数据到底动没动——回滚失败时它可能停在半截状态 */
function reportCommitFailure(outcome: Extract<CommitOutcome, { ok: false }>, action: string): void {
  if (outcome.rolledBack) {
    toast.danger(`${action}失败（可能是浏览器存储空间不足），已恢复为操作前的数据`)
  } else {
    toast.danger(`${action}中断，且未能自动恢复。本机数据可能不完整，请立刻刷新页面检查`)
  }
  console.warn(`[toolbox] ${action}失败：`, outcome.error)
}

/* ---------- 导出 ---------- */

function exportBackup(): void {
  const now = new Date()
  const { backup, broken: brokenLabels } = createBackup((key) => storage.read(key), now)
  try {
    downloadJson(JSON.stringify(backup, null, 2), `teacherdesk-backup-${formatDateKey(now)}.json`)
  } catch (error) {
    toast.danger('导出失败：浏览器没能开始下载，请重试')
    console.warn('[toolbox] 导出失败：', error)
    return
  }
  try {
    storage.write(LAST_BACKUP_KEY, now.toISOString())
    lastBackupAt.value = now.toISOString()
  } catch {
    // 只影响「上次导出」提示，不影响备份文件本身，不打断流程
  }
  toast.success('已导出备份文件（浏览器下载目录）')
  if (brokenLabels.length > 0) {
    toast.warning(`${brokenLabels.join('、')}读取异常，未包含在备份中；建议刷新页面后重新导出`)
  }
}

/* ---------- 导入 ---------- */

const fileInput = ref<HTMLInputElement | null>(null)
const importOpen = ref(false)
const importing = ref(false)
const importMeta = ref<{
  filename: string
  file: BackupFile
  unknownModules: string[]
  idless: { label: string; count: number }[]
} | null>(null)
const importStats = ref<MergeStat[]>([])
/** 合并计划：预览确认前只算不写（writes 为空 = 备份里没有可导入的数据块） */
const importWrites = ref<Record<string, string>>({})
/** 本机读取异常、本次导入不会触碰的数据块（备份里就算有也不写） */
const importSkipped = ref<string[]>([])

function pickFile(): void {
  fileInput.value?.click()
}

async function onFilePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 选同一个文件两次也要能触发 change
  input.value = ''
  if (!file) return
  let text: string
  try {
    text = await file.text()
  } catch {
    toast.danger('读取文件失败，请重试')
    return
  }
  const parsed = parseBackup(text)
  if (!parsed.ok) {
    toast.danger(parsed.error)
    return
  }
  refreshSnapshot()
  const plan = planMerge(snapshot.value.values, parsed.backup, broken.value)
  importMeta.value = {
    filename: file.name,
    file: parsed.backup,
    unknownModules: parsed.unknownModules,
    idless: parsed.idless,
  }
  importStats.value = plan.stats
  importWrites.value = plan.writes
  importSkipped.value = broken.value
  importOpen.value = true
}

const importSummary = computed(() => {
  const added = importStats.value.reduce((sum, item) => sum + item.added, 0)
  const replaced = importStats.value.reduce((sum, item) => sum + item.replaced, 0)
  return { added, replaced }
})

/** 有没有真正会发生的变化（只有空数组块时也算没有） */
const importHasChanges = computed(
  () => importSummary.value.added + importSummary.value.replaced > 0,
)

const importMetaText = computed(() => {
  const file = importMeta.value?.file
  if (!file) return ''
  const date = file.exportedAt ? file.exportedAt.slice(0, 10) : '—'
  return `导出时间 ${date}（备份格式 ${file.schemaVersion} · 应用版本 ${file.appVersion || '—'}）`
})

const idlessText = computed(() =>
  (importMeta.value?.idless ?? []).map((item) => `${item.label} ${item.count} 条`).join('、'),
)

function confirmImport(): void {
  if (importing.value || !importHasChanges.value) return
  importing.value = true
  const { added, replaced } = importSummary.value
  const outcome = applyWrites(importWrites.value, storage)
  if (!outcome.ok) {
    importing.value = false
    reportCommitFailure(outcome, '导入')
    return
  }
  finish(`导入完成：新增 ${added} 条，覆盖 ${replaced} 条`)
}

/* ---------- 清空 ---------- */

const clearSampleOpen = ref(false)
const clearAllOpen = ref(false)

function openClearSamples(): void {
  // 每次打开都重算，避免页面停留期间数据已变（例如另一个标签页删了记录）
  refreshSnapshot()
  samplePlan.value = planClearSamples(snapshot.value.values, legacySnapshot.value.values)
  if (sampleTotal.value === 0) {
    toast.info(
      broken.value.length > 0
        ? `当前没有可清理的示例数据（${broken.value.join('、')}读取异常，未纳入判断）`
        : '当前没有可清理的示例数据',
    )
    return
  }
  clearSampleOpen.value = true
}

function confirmClearSamples(): void {
  const outcome = applyWrites(samplePlan.value.writes, storage)
  if (!outcome.ok) {
    reportCommitFailure(outcome, '清空示例数据')
    return
  }
  finish(`已清空 ${sampleTotal.value} 条示例数据`)
}

function openClearAll(): void {
  refreshSnapshot()
  clearAllOpen.value = true
}

/**
 * 清空全部会删掉本应用前缀下的**所有**键，故读取异常的块也要列出来。
 * 「还没打开过」（count === null）的块盘上没有键，没有东西可删，不列（与 0 条同处理）。
 */
const clearAllItems = computed(() =>
  overview.value.filter((item) => (item.count ?? 0) > 0 || broken.value.includes(item.label)),
)

function confirmClearAll(): void {
  const outcome = clearAllKeys(storage)
  if (!outcome.ok) {
    reportCommitFailure(outcome, '清空全部数据')
    return
  }
  if (outcome.count === 0) {
    clearAllOpen.value = false
    toast.info('本机暂无可清空的数据')
    return
  }
  finish('已清空本机全部数据')
}

/** 待删示例记录的名单文案（超出上限时补一句） */
function namesText(item: ClearPlan['removed'][number]): string {
  const rest = item.count - item.names.length
  const head = item.names.join('、')
  return rest > 0 ? `${head}，另有 ${rest} ${item.unit}未列出` : head
}

function setNotice(text: string): void {
  try {
    window.sessionStorage.setItem(NOTICE_KEY, text)
  } catch {
    // 提示发不出去不影响这次操作本身
  }
}

onMounted(() => {
  try {
    const text = window.sessionStorage.getItem(NOTICE_KEY)
    if (!text) return
    window.sessionStorage.removeItem(NOTICE_KEY)
    toast.success(text)
  } catch {
    // 忽略
  }
})
</script>

<template>
  <div class="toolbox-page">
    <header class="page-toolbar">
      <div>
        <h1 class="page-title">工具箱</h1>
        <p class="page-subtitle">数据备份与恢复；教学小工具规划中。</p>
      </div>
    </header>

    <AppCard
      title="数据管理"
      subtitle="本机数据保存在这台设备的浏览器里，清理浏览器缓存、换设备或换浏览器都会全部丢失，建议定期导出备份。"
    >
      <ul class="count-list">
        <li v-for="item in overview" :key="item.key" class="count-item">
          <span class="count-label">{{ item.label }}</span>
          <span v-if="broken.includes(item.label)" class="count-broken">读取异常</span>
          <!-- 盘上没有这个键 = 模块从未打开过。写「还没打开过」而不是「未初始化」：显示 0 会让人
               以为模块是空的（技术债 #9），而「未初始化」是开发者词，教师看不懂 -->
          <span v-else-if="item.count === null" class="count-pending">还没打开过</span>
          <span v-else class="count-value">{{ item.count }} {{ item.unit }}</span>
        </li>
      </ul>
      <p class="footnote">
        数字为保存在本机的全部记录（含已从列表移除、档案仍留档的学生），备份会原样保留。「还没打开过」表示这个模块的数据还没在本机生成——示例数据会在第一次打开它时写入。
      </p>
      <p v-if="broken.length > 0" class="warn-text">
        本机「{{
          broken.join('、')
        }}」读取异常，暂无法统计。为避免覆盖还能人工找回的原文，导入与「清空示例数据」都会跳过它。
      </p>

      <div class="action-row">
        <AppButton @click="exportBackup">导出备份（JSON）</AppButton>
        <AppButton variant="secondary" @click="pickFile">导入备份</AppButton>
        <p class="last-backup">{{ lastBackupText }}</p>
      </div>
      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept=".json,application/json"
        tabindex="-1"
        aria-hidden="true"
        @change="onFilePicked"
      />

      <section class="danger-zone">
        <h3 class="zone-title">危险操作</h3>
        <dl class="zone-item">
          <dt>清空示例数据</dt>
          <dd>
            删除首次打开时自动生成的示例记录（示例学生 / 课程 / 待办 / 请假 / 值日组 /
            周末返家），以及这些学生产生的座位约束。你自己新增的记录不受影响；但若你把某条示例记录改成了自己的内容，它同样会被删掉——确认前请先核对名单。座位方案保留，示例学生占用的座位会在下次打开「座位表」时自动释放。轮换设置会保留：剩下的值日组若接不上起点，值日管理页会提示重设。
          </dd>
          <dt>清空全部数据</dt>
          <dd>删除本机全部数据，恢复到首次打开的状态（示例数据会重新出现）。</dd>
        </dl>
        <div class="action-row">
          <AppButton
            variant="secondary"
            :disabled="sampleTotal === 0"
            :title="sampleTotal === 0 ? '当前没有可清理的示例数据' : undefined"
            @click="openClearSamples"
          >
            清空示例数据{{ sampleTotal > 0 ? `（${sampleTotal} 条）` : '' }}
          </AppButton>
          <AppButton variant="danger" @click="openClearAll">清空全部数据</AppButton>
        </div>
        <p v-if="sampleTotal === 0" class="footnote">当前没有可清理的示例数据。</p>
      </section>
    </AppCard>

    <AppCard title="教学小工具" subtitle="随机点名、随机分组、课堂倒计时等，还在计划中。">
      <p class="footnote">这些工具会在后续版本提供（点名与分组需要先有学生档案）。</p>
    </AppCard>

    <AppModal v-model="importOpen" title="导入备份（合并）" :width="560">
      <template v-if="importMeta">
        <p class="modal-file">{{ importMeta.filename }}</p>
        <p class="footnote">{{ importMetaText }}</p>
        <table class="merge-table">
          <thead>
            <tr>
              <th scope="col">数据块</th>
              <th scope="col">新增</th>
              <th scope="col">覆盖</th>
              <th scope="col">保持不变</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="stat in importStats" :key="stat.label">
              <td>{{ stat.label }}</td>
              <td>{{ stat.added }} {{ stat.unit }}</td>
              <td>{{ stat.replaced }} {{ stat.unit }}</td>
              <td>{{ stat.kept }} {{ stat.unit }}</td>
            </tr>
          </tbody>
        </table>
        <p class="note-text">
          合并规则：本机独有的记录原样保留，备份独有的追加到末尾，同一编号的记录用备份里的版本覆盖。合并不会删除当前数据。
        </p>
        <p v-if="importHasChanges" class="warn-text">
          被覆盖的版本无法找回。若本机数据比备份新，请先点「先导出当前备份」留一份。
        </p>
        <p v-if="!importHasChanges" class="warn-text">
          备份文件里没有可合并的记录，导入不会改变任何内容。
        </p>
        <p v-if="importSkipped.length > 0" class="warn-text">
          本机「{{ importSkipped.join('、') }}」读取异常，为避免覆盖原文，本次导入不会改动它。
        </p>
        <p v-if="importMeta.unknownModules.length > 0" class="note-text">
          备份里有 {{ importMeta.unknownModules.length }} 个无法识别的数据块，已忽略。
        </p>
        <p v-if="idlessText" class="note-text">
          备份里「{{ idlessText }}」缺少编号，只能追加到列表末尾，可能与已有内容重复。
        </p>
        <p v-if="importHasChanges" class="note-text">
          备份里引用了本机没有的学生时（例如从别的设备导入），相关座位会显示为空、相关座位约束会显示成「已删除学生」、值日组里会显示成「未知学生」（可在值日管理页里取消勾选移除）、周末返家名单里会标注「已不在档案」（记录本身保留，可在周末管理页删除）。
        </p>
      </template>
      <template #footer>
        <AppButton variant="ghost" @click="importOpen = false">取消</AppButton>
        <AppButton variant="secondary" @click="exportBackup">先导出当前备份</AppButton>
        <AppButton :loading="importing" :disabled="!importHasChanges" @click="confirmImport">
          合并导入（新增 {{ importSummary.added }} 条 / 覆盖 {{ importSummary.replaced }} 条）
        </AppButton>
      </template>
    </AppModal>

    <AppModal v-model="clearSampleOpen" title="清空示例数据" :width="520">
      <p>将从本机删除以下示例记录：</p>
      <ul class="remove-list">
        <li v-for="item in samplePlan.removed" :key="item.label">
          {{ item.label }} {{ item.count }} {{ item.unit }}：{{ namesText(item) }}
        </li>
      </ul>
      <p class="warn-text">
        示例记录按首次生成时的编号识别，所以上面列出的记录都会被删除——包括你已经改成自己内容的那几条，请先核对名单。
      </p>
      <p v-if="clearsLegacy" class="note-text">
        「旧课表数据」是课表升级时留下的旧存档（已经不再使用，只有当年有课程没能搬过去时才会保留），
        这里同样只删其中的示例课程，其余原文保留。
      </p>
      <p class="note-text">删除后不可撤销，建议先导出备份。座位方案与换座日志保留。</p>
      <template #footer>
        <AppButton variant="ghost" @click="clearSampleOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmClearSamples">确认清空</AppButton>
      </template>
    </AppModal>

    <AppModal v-model="clearAllOpen" title="清空全部数据" :width="480">
      <p>将删除本机全部数据，并恢复到首次打开的状态（示例数据会重新出现）：</p>
      <ul v-if="clearAllItems.length > 0" class="remove-list">
        <li v-for="item in clearAllItems" :key="item.key">
          {{ item.label }}
          {{ broken.includes(item.label) ? '（读取异常）' : `${item.count} ${item.unit}` }}
        </li>
      </ul>
      <p v-else class="note-text">本机暂无数据。</p>
      <p v-if="hasLegacyArchive" class="note-text">
        课表升级时留下的「旧课表数据」存档也会一并删除——它不在备份范围内，删除后无法找回。
      </p>
      <p class="warn-text">此操作不可撤销。若还想保留，请先导出备份。</p>
      <template #footer>
        <AppButton variant="ghost" @click="clearAllOpen = false">取消</AppButton>
        <AppButton variant="danger" @click="confirmClearAll">确认清空全部数据</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.toolbox-page {
  max-width: 960px;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: 0;
}

.page-title {
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: -0.3px;
}

.page-subtitle {
  margin-top: var(--space-1);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.count-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.count-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--color-fill-disabled);
  border-radius: var(--radius-md);
}

.count-label {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.count-value {
  font-weight: 600;
}

.count-broken {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-danger);
}

/* 「还没打开过」：不是错误也不是 0，用最轻的一档文字，避免被当成异常 */
.count-pending {
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}

.footnote {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.action-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-top: var(--space-3);
}

.last-backup {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.file-input {
  display: none;
}

.danger-zone {
  margin-top: var(--space-5);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
}

.zone-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-danger);
  margin-bottom: var(--space-2);
}

.zone-item dt {
  font-size: var(--text-sm);
  font-weight: 600;
  margin-top: var(--space-2);
}

.zone-item dd {
  /* dd 默认有 40px 缩进，会与上面的小标题错开 */
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.modal-file {
  font-weight: 600;
  word-break: break-all;
}

.merge-table {
  width: 100%;
  margin: var(--space-3) 0;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.merge-table th,
.merge-table td {
  padding: var(--space-1) var(--space-2);
  text-align: left;
  border-bottom: 1px solid var(--color-border);
}

.merge-table th {
  color: var(--color-text-secondary);
  font-weight: 500;
}

.remove-list {
  margin: var(--space-3) 0;
  padding-left: var(--space-4);
  list-style: disc;
  font-size: var(--text-sm);
  line-height: 1.8;
}

.warn-text {
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-danger);
  line-height: 1.6;
}

.note-text {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  line-height: 1.6;
}
</style>
