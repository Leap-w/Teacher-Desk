<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Cloud, Download, Images, RefreshCw, Upload } from 'lucide-vue-next'

import { AppButton, AppCard, AppModal } from '@/components/ui'
import { useCloudSync } from '@/composables/useCloudSync'
import { useLoginModal } from '@/composables/useLoginModal'
import { usePhotoArchive } from '@/composables/usePhotoArchive'
import { useToast } from '@/composables/useToast'
import { appConfig } from '@/config'
import { STUDENT_PHOTOS_KEY } from '@/repositories'
import type { ConflictChoice } from '@/composables/useCloudSync'
import { useBackup } from '@/composables/useBackup'
import {
  applyWrites,
  createBackup,
  downloadJson,
  parseBackup,
  planMerge,
  readModules,
  type BackupFile,
  type CommitOutcome,
  type MergeStat,
} from '@/utils/backup'
import {
  photoArchiveProblems,
  photoArchiveStatusLabel,
  type PhotoArchiveContents,
  type PhotoArchiveManifest,
  type PhotoArchiveRestoreResult,
} from '@/utils/photoArchive'
import { formatDateKey } from '@/utils/date'
import SettingsCell from '@/views/My/components/SettingsCell.vue'
import SettingsSection from '@/views/My/components/SettingsSection.vue'

/**
 * 数据与同步（v3.0.3-rc 收敛）。
 *
 * **本页只负责三件事，且只有三个入口**：云同步 / 导出数据 / 导入数据。
 * 同步诊断九宫格、重置数据、工具箱、合并入口、备份与恢复的重复入口全部移除
 * （清空 / 重置能力仍在 `utils/backup.ts`，只是不再作为界面入口出现）。
 *
 * 整页操作以「写 localStorage → 重载」收尾，由八个 store 用各自既有的 normalize*
 * 重新加载（见 utils/backup.ts 顶部说明）。云同步的引擎与文案不在这一页：
 * 状态与动作来自 `composables/useCloudSync.ts`（与顶栏同步按钮**同一份**）。
 */

const toast = useToast()
const loginModal = useLoginModal()

/** 重载后的一次性提示（跨页面跳转会丢，所以放 sessionStorage，落回本页时弹一次） */
const NOTICE_KEY = `${appConfig.storageKeyPrefix}:notice`

/**
 * 本机存储端口：Phase 9A 起实现上收到 `services/storage.ts`（那里是全应用读写 localStorage
 * 的唯一出口），本页只借用——读不到（隐私模式等）不是错误，按「没有数据」处理；
 * 写失败必须让调用方知道，故它不吞异常——由 utils/backup.ts 整批回滚。
 */
const storage = useBackup()

/**
 * 照片完整备份（v3.8.1 Phase 1）：ZIP = JSON 数据 + 照片文件。
 * 与上面的 JSON 导出/导入**分开**两条入口，界面文案必须把两者说清楚。
 */
const {
  exportFullBackup,
  parseArchiveFile,
  restoreFullBackup,
  download: downloadPhotoArchiveFile,
} = usePhotoArchive()

function readAll() {
  return readModules((key) => storage.read(key))
}

/** 本机数据快照：概览与各操作共用同一次读取，避免两个数字来自不同时刻 */
const snapshot = ref(readAll())
function refreshSnapshot(): void {
  snapshot.value = readAll()
}

/** 读取异常、无法解析的数据块（绝不写盘，界面上必须说出来） */
const broken = computed(() => snapshot.value.broken)

/**
 * 「导出数据」那一行的小字（v3.0.5-rc；v3.8.1 起明确「不含照片文件」）。
 *
 * 这里原是**上次导出时间**（读 `teacherdesk:lastBackupAt`），没有记录时写「还没有导出过备份。」。
 * 需求方 2026-09-15 拍板：导出提示只在按钮下面挂一句小字即可，不要顶部警告、不要常驻提醒，
 * 所以这一行固定成「这个按钮是干什么的」，不再是「你多久没导出了」——那个键连同提醒条一并删了
 * （见 `utils/backup.ts` 顶部说明）。
 */
const exportHint = '导出 JSON：文字记录与照片信息，不含照片文件。'
/** 「导出完整备份（含照片）」那一行的小字 */
const exportArchiveHint = '导出 ZIP：JSON 数据 + 照片文件，用于换设备 / 重装后的完整恢复。'

/* ---------- 云同步（Phase 9B / 9C） ---------- */

const {
  state: cloud,
  busy: cloudBusy,
  conflictLabels: cloudConflictLabels,
  statusView: cloudStatusView,
  lastSyncedText: cloudLastSyncedText,
  syncWithFeedback,
  resolveConflict,
} = useCloudSync()

/** 云同步行右侧的值：未登录 / 已同步 / 需要确认…（与顶栏同一份口径） */
const cloudValue = computed(() => {
  if (!cloud.value.checked) return '检查中…'
  if (!cloud.value.account) return '未登录'
  return cloudStatusView.value.text
})

/**
 * 冲突确认弹窗（Phase 9C）。
 *
 * 冲突的处置**只在弹窗里发生**：两个选项都要覆盖掉一边的数据，且都不可撤销
 * （本机这份被覆盖后在别处再无副本，云端那份被覆盖后另一台设备下次同步也会跟着换掉），
 * 点错没有回头路。同步流程自己不替教师做这个决定。
 */
const conflictOpen = ref(false)

async function doResolveConflict(choice: ConflictChoice): Promise<void> {
  conflictOpen.value = false
  await resolveConflict(choice)
  refreshSnapshot()
}

/** 云同步行的动作：未登录先登录，已登录立即同步 */
async function onCloudRow(): Promise<void> {
  if (cloudBusy.value) return
  if (!cloud.value.checked) return
  if (!cloud.value.account) {
    loginModal.show()
    return
  }
  await syncWithFeedback()
  refreshSnapshot()
}

/* ---------- 写盘收尾（成功 / 失败两条路，绝不混说） ---------- */

/**
 * 成功收尾：先广播 → 写一次性提示 → 重载，由各 store 的 normalize* 重新加载。
 *
 * 广播（Phase 9A）必须在重载**之前**：导入备份是**整批换数据**（键可能新增、也可能消失），
 * 别的入口没法逐键对齐，只能整页重来。少了这一句，另一个标签页内存里还留着旧数据，
 * 教师下一次编辑就会把刚导入的整份覆盖掉。
 */
function finish(notice: string): void {
  storage.reloadPeers()
  setNotice(notice)
  try {
    window.location.reload()
  } catch (error) {
    // 沙箱 iframe 里 reload 可能被拦；提示已写进 sessionStorage，下次进入本页会补弹
    console.warn('[data] 页面重载被拦截：', error)
  }
}

/** 失败收尾：如实说本机数据到底动没动——回滚失败时它可能停在半截状态 */
function reportCommitFailure(outcome: Extract<CommitOutcome, { ok: false }>, action: string): void {
  if (outcome.rolledBack) {
    toast.danger(`${action}失败（可能是浏览器存储空间不足），已恢复为操作前的数据`)
  } else {
    toast.danger(`${action}中断，且未能自动恢复。本机数据可能不完整，请立刻刷新页面检查`)
  }
  console.warn(`[data] ${action}失败：`, outcome.error)
}

/* ---------- 导出 ---------- */

function exportBackup(): void {
  const now = new Date()
  const { backup, broken: brokenLabels } = createBackup((key) => storage.read(key), now)
  try {
    downloadJson(JSON.stringify(backup, null, 2), `teacherdesk-backup-${formatDateKey(now)}.json`)
  } catch (error) {
    toast.danger('导出失败：浏览器没能开始下载，请重试')
    console.warn('[data] 导出失败：', error)
    return
  }
  toast.success('已导出备份文件（浏览器下载目录）')
  if (brokenLabels.length > 0) {
    toast.warning(`${brokenLabels.join('、')}读取异常，未包含在备份中；建议刷新页面后重新导出`)
  }
}

/* ---------- 导出完整备份（含照片文件，ZIP） ---------- */

const exportingArchive = ref(false)
const archiveManifest = ref<PhotoArchiveManifest>()
const archiveResultOpen = ref(false)

/** 未进 ZIP 的照片（缺失 / 云端不可用 / 下载失败 / 格式不支持）——必须逐张告诉教师 */
const archiveProblemRows = computed(() =>
  archiveManifest.value ? photoArchiveProblems(archiveManifest.value) : [],
)

const archiveSummaryText = computed(() => {
  const manifest = archiveManifest.value
  if (!manifest) return ''
  const { photos, included, missing, failed, unavailable, deleted } = manifest.totals
  return (
    `照片记录 ${photos} 张：已包含 ${included} 张，缺失 ${missing} 张，` +
    `失败 ${failed} 张，云端不可用未获取 ${unavailable} 张，已删除 ${deleted} 张。`
  )
})

async function exportArchiveBackup(): Promise<void> {
  if (exportingArchive.value) return
  exportingArchive.value = true
  try {
    refreshSnapshot()
    const outcome = await exportFullBackup()
    if (!outcome.ok) {
      toast.danger(`导出完整备份失败：${outcome.error}`)
      return
    }
    if (!downloadPhotoArchiveFile(outcome.result, outcome.filename)) {
      toast.danger('导出失败：浏览器没能开始下载，请重试')
      return
    }
    archiveManifest.value = outcome.result.manifest
    archiveResultOpen.value = true
    const { included, missing, failed, unavailable } = outcome.result.manifest.totals
    if (missing + failed + unavailable === 0) {
      toast.success(`已导出完整备份：包含 ${included} 张照片文件`)
    } else {
      toast.warning(
        `已导出备份：包含 ${included} 张照片；另有 ${
          missing + failed + unavailable
        } 张未包含（详见导出清单）`,
      )
    }
  } finally {
    exportingArchive.value = false
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
/** 完整备份 ZIP（含照片）时非空；普通 JSON 导入时恒为 null */
const importArchive = ref<PhotoArchiveContents | null>(null)
/** 完整备份写回进度（照片逐张写入） */
const archiveProgress = ref<{ done: number; total: number } | null>(null)
/**
 * 完整备份写回失败时的**精确回滚结果**（当前只在弹窗内展示）：
 * `photoRollbackFailures` 非空 = 这些照片没能恢复原状，必须逐张告诉教师。
 */
const archiveRestoreFailure = ref<{
  phaseLabel: string
  rolledBackData: boolean
  failures: { photoId: string; action: string; error: string }[]
} | null>(null)

function pickFile(): void {
  fileInput.value?.click()
}

/** 按文件头判断是不是 ZIP（扩展名可能被系统改掉；同时接受 .zip） */
async function looksLikeZip(file: File): Promise<boolean> {
  if (file.name.toLowerCase().endsWith('.zip')) return true
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
    return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
  } catch {
    return false
  }
}

/** ZIP 完整备份：先全量校验，再进同一个导入预览弹窗（**此阶段不写任何数据**） */
async function inspectArchive(file: File): Promise<void> {
  archiveRestoreFailure.value = null
  const parsed = await parseArchiveFile(file)
  if (!parsed.ok) {
    toast.danger(parsed.error)
    return
  }
  refreshSnapshot()
  // 本机「学生照片」块读取异常时不能恢复照片文件：元数据无法安全合并，
  // 写进去的二进制会与元数据对不上（可能覆盖原有照片却不更新记录）。
  if (broken.value.includes('学生照片')) {
    toast.danger(
      '本机「学生照片」数据读取异常，无法安全导入完整备份。请先刷新页面，确认照片信息可正常读取后再试。',
    )
    return
  }
  const plan = planMerge(snapshot.value.values, parsed.contents.backup, broken.value)
  importArchive.value = parsed.contents
  importMeta.value = {
    filename: file.name,
    file: parsed.contents.backup,
    unknownModules: parsed.contents.unknownModules,
    idless: parsed.contents.idless,
  }
  importStats.value = plan.stats
  importWrites.value = plan.writes
  importSkipped.value = broken.value
  importOpen.value = true
}

async function onFilePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 选同一个文件两次也要能触发 change
  input.value = ''
  if (!file) return
  archiveRestoreFailure.value = null

  // v3.8.1：同一入口同时接受 JSON 与「完整备份 ZIP」，按文件内容分流（扩展名只作辅助）
  if (await looksLikeZip(file)) {
    await inspectArchive(file)
    return
  }

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
  importArchive.value = null
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

/** 本次是完整备份时，ZIP 内待写回的照片文件数 */
const importPhotoCount = computed(() => importArchive.value?.photos.length ?? 0)
/** 完整备份：业务数据有变化 **或** 有照片文件要写回，才算「可导入」 */
const importHasAnything = computed(() => importHasChanges.value || importPhotoCount.value > 0)
/** ZIP 清单里的照片统计（缺失 / 失败的照片不会写回，但业务记录照常导入） */
const importArchiveTotals = computed(() => importArchive.value?.manifest.totals ?? null)
/** ZIP 校验阶段的提示（多余文件、清单未覆盖的元数据等） */
const importArchiveWarnings = computed(() => importArchive.value?.warnings ?? [])

/** 导入预览用：ZIP 清单里的照片统计（与导出结果弹窗的 archiveSummaryText 分开，别串用） */
const importArchiveSummaryText = computed(() => {
  const totals = importArchiveTotals.value
  if (!totals) return ''
  return (
    `照片记录 ${totals.photos} 张：ZIP 内包含 ${totals.included} 张，缺失 ${totals.missing} 张，` +
    `失败 ${totals.failed} 张，云端不可用 ${totals.unavailable} 张，已删除 ${totals.deleted} 张。`
  )
})

/**
 * 普通 JSON 备份导入时的照片说明（v3.8.1 Phase 4 验收补强）。
 * ZIP 有专门的完整备份块；JSON 只有照片元数据，必须在这里明确说「不包含照片文件」，
 * 否则教师会以为导入 JSON 就把照片恢复了。
 */
const importJsonPhotoNote = computed(() => {
  if (importArchive.value || !importMeta.value) return ''
  const photos = importMeta.value.file.data[STUDENT_PHOTOS_KEY]
  if (!Array.isArray(photos) || photos.length === 0) return ''
  return (
    `本次是普通 JSON 备份：只包含 ${photos.length} 条照片信息，不包含照片文件；` +
    '需要恢复照片文件时，请使用「导出完整备份（含照片）」生成的 ZIP。'
  )
})

const importMetaText = computed(() => {
  const file = importMeta.value?.file
  if (!file) return ''
  const date = file.exportedAt ? file.exportedAt.slice(0, 10) : '—'
  return `导出时间 ${date}（备份格式 ${file.schemaVersion} · 应用版本 ${file.appVersion || '—'}）`
})

const idlessText = computed(() =>
  (importMeta.value?.idless ?? []).map((item) => `${item.label} ${item.count} 条`).join('、'),
)

/** 完整备份写回失败：照片与业务数据两条线分别如实说（不谎称「什么都没动」） */
function reportArchiveRestoreFailure(
  outcome: Extract<PhotoArchiveRestoreResult, { ok: false }>,
): void {
  const failures = outcome.photoRollbackFailures
  const phase = outcome.phase === 'photos' ? '照片写入' : '数据写入'
  const photoLine = outcome.rolledBackPhotos
    ? '本次写入的照片已全部还原 / 清理'
    : `有 ${failures.length} 张照片未能还原（见下方清单）`
  const dataLine = outcome.rolledBackData
    ? '原有业务数据已恢复'
    : '业务数据可能停在半截状态，请立刻刷新页面检查'
  archiveRestoreFailure.value = {
    phaseLabel: phase,
    rolledBackData: outcome.rolledBackData,
    failures: failures.map((item) => ({
      photoId: item.photoId,
      action: item.action === 'restore-overwritten' ? '还原原图失败' : '删除本次新建失败',
      error: item.error,
    })),
  }
  toast.danger(`导入完整备份失败（${phase}）：${photoLine}；${dataLine}`)
  console.warn('[data] 完整备份恢复失败：', outcome.error, failures)
}

async function confirmImport(): Promise<void> {
  if (importing.value || !importHasAnything.value) return
  const { added, replaced } = importSummary.value
  const archive = importArchive.value

  if (archive) {
    importing.value = true
    archiveProgress.value = { done: 0, total: archive.photos.length }
    try {
      const outcome = await restoreFullBackup(archive, importWrites.value, (done, total) => {
        archiveProgress.value = { done, total }
      })
      if (!outcome.ok) {
        reportArchiveRestoreFailure(outcome)
        return
      }
      archiveRestoreFailure.value = null
      finish(
        `导入完成：新增 ${added} 条，覆盖 ${replaced} 条；恢复照片 ${outcome.restoredPhotos} 张` +
          (outcome.overwrittenPhotos > 0
            ? `（其中覆盖本机同 photoId 照片 ${outcome.overwrittenPhotos} 张）`
            : ''),
      )
    } finally {
      importing.value = false
      archiveProgress.value = null
    }
    return
  }

  importing.value = true
  const outcome = applyWrites(importWrites.value, storage)
  if (!outcome.ok) {
    importing.value = false
    reportCommitFailure(outcome, '导入')
    return
  }
  finish(`导入完成：新增 ${added} 条，覆盖 ${replaced} 条`)
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
  <div class="data-page">
    <header class="page-head">
      <h1 class="page-head__title">数据与同步</h1>
      <p class="page-head__sub">云同步 · 导出 · 导入</p>
    </header>

    <!-- 云同步 / 导出数据（JSON）/ 导出完整备份（含照片）/ 导入数据 -->
    <SettingsSection title="数据与同步">
      <SettingsCell
        :icon="Cloud"
        icon-tone="primary"
        title="云同步"
        :subtitle="cloudLastSyncedText"
        :value="cloudValue"
        :chevron="false"
        @click="onCloudRow"
      />
      <SettingsCell
        :icon="Download"
        icon-tone="neutral"
        title="导出数据（JSON）"
        :subtitle="exportHint"
        :chevron="false"
        @click="exportBackup"
      />
      <SettingsCell
        :icon="Images"
        icon-tone="neutral"
        title="导出完整备份（含照片）"
        :subtitle="exportArchiveHint"
        :value="exportingArchive ? '正在打包…' : ''"
        :chevron="false"
        @click="exportArchiveBackup"
      />
      <SettingsCell
        :icon="Upload"
        icon-tone="neutral"
        title="导入数据"
        subtitle="从备份文件恢复（JSON 或完整备份 ZIP）"
        :chevron="false"
        @click="pickFile"
      />
    </SettingsSection>

    <!-- 两种备份的分工：必须让教师明白「JSON 不含照片文件」 -->
    <p class="backup-photo-note">
      备份说明：<strong>导出数据（JSON）</strong>只包含文字记录与照片信息，不含照片文件；
      需要连照片文件一起备份或换设备恢复时，请使用
      <strong>导出完整备份（含照片）</strong>，它会生成一个 ZIP（内含 backup.json 与照片文件）。
      两种文件都能从这里导入；旧版 JSON 备份照常可用。
    </p>

    <!-- 云同步的处境说明：只讲事实，不放第二个入口 -->
    <AppCard v-if="cloud.status !== 'disabled'" title="云同步状态">
      <div class="cloud-block">
        <div class="cloud-status">
          <span class="cloud-dot" :class="`is-${cloudStatusView.tone}`" aria-hidden="true" />
          <span class="cloud-status-text">{{ cloudStatusView.text }}</span>
          <span v-if="cloud.account" class="cloud-account">{{ cloud.account }}</span>
        </div>
        <!-- 云端给的原因原样摆出来。教师多半看不懂，但照着它去搜索、或截图发给懂的人，
             都比我们编一句「同步失败，请稍后再试」有用得多 -->
        <p v-if="cloud.error" class="cloud-error">云端返回的原因：{{ cloud.error }}</p>

        <!-- 首次同步发现「本机有数据、云端也有」（Phase 9C）：同步**不会**替教师选，
             两份都原样留着，这里把这件事说出来并给出唯一的处置入口 -->
        <div v-if="cloud.conflicts.length > 0" class="conflict-block">
          <p class="conflict-title">本机与云端都有数据，需要你确认保留哪一份</p>
          <p class="footnote">
            这些模块：{{ cloudConflictLabels.join('、') }}。同步暂时跳过了它们——本机这份和云端那份
            都原样保留着，只是这几项没在同步。
          </p>
          <div class="action-row">
            <AppButton variant="secondary" @click="conflictOpen = true">去确认保留哪一份</AppButton>
          </div>
        </div>

        <p v-if="!cloud.checked" class="footnote">正在检查登录状态…</p>
        <div v-else-if="!cloud.account" class="action-row">
          <AppButton @click="loginModal.show()">登录后开启云同步</AppButton>
          <p class="footnote">不注册：账号在云开发控制台「身份认证 → 用户管理」新建。</p>
        </div>
        <div v-else class="action-row">
          <AppButton
            :loading="cloudBusy"
            :disabled="cloudBusy || cloud.status === 'syncing'"
            @click="onCloudRow"
          >
            <RefreshCw :size="16" :stroke-width="2" aria-hidden="true" />
            立即同步
          </AppButton>
        </div>

        <p class="footnote">
          同步规则：新设备登录以云端为准；两边都有数据不会自动覆盖，会先请你确认保留哪一份；
          之后同一项两边都改过，以写得晚的一方为准。
        </p>
        <!-- 这里原有第二段常驻小字「本机数据保存在这台设备的浏览器里…建议定期导出备份。」，
             v3.0.5-rc 删除：它是全页最后一句话，长期占位、观感差；导出这件事的提示
             只留在上面「导出数据」那一行小字里 -->
      </div>
    </AppCard>

    <input
      ref="fileInput"
      class="file-input"
      type="file"
      accept=".json,.zip,application/json,application/zip"
      tabindex="-1"
      aria-hidden="true"
      @change="onFilePicked"
    />

    <AppModal v-model="importOpen" title="导入数据" :width="560">
      <template v-if="importMeta">
        <p class="modal-file">{{ importMeta.filename }}</p>
        <p class="footnote">{{ importMetaText }}</p>
        <p v-if="importJsonPhotoNote" class="note-text">{{ importJsonPhotoNote }}</p>

        <!-- 完整备份 ZIP：先说明里面有多少照片文件，再给业务数据合并预览 -->
        <section v-if="importArchive" class="archive-block">
          <p class="archive-title">完整备份（含照片文件）</p>
          <p class="note-text">{{ importArchiveSummaryText }}</p>
          <p v-if="importPhotoCount > 0" class="note-text">
            本次会先把 {{ importPhotoCount }} 张照片文件写回本机，再合并业务数据；照片按稳定 photoId
            与记录关联，不会靠文件名或人脸匹配。
          </p>
          <p
            v-if="
              importArchiveTotals &&
              importArchiveTotals.included <
                importArchiveTotals.photos - importArchiveTotals.deleted
            "
            class="warn-text"
          >
            清单里有照片未包含在 ZIP 中（缺失 / 失败 /
            云端不可用），这些照片文件无法恢复，但对应的照片记录与其它数据照常导入。
          </p>
          <p v-if="importArchiveWarnings.length > 0" class="note-text">
            校验提示：{{ importArchiveWarnings.join(' ') }}
          </p>
        </section>

        <!-- 写回失败：精确列出没恢复原状的照片文件，不返回笼统失败 -->
        <section v-if="archiveRestoreFailure" class="archive-block archive-block--error">
          <p class="archive-title">
            导入失败（{{ archiveRestoreFailure.phaseLabel }}）：
            {{ archiveRestoreFailure.rolledBackData ? '业务数据已回滚' : '业务数据可能未完全回滚' }}
          </p>
          <template v-if="archiveRestoreFailure.failures.length > 0">
            <p class="warn-text">
              以下
              {{ archiveRestoreFailure.failures.length }}
              张照片未能恢复原状，请核对后重新导入或联系维护者：
            </p>
            <ul class="archive-problem-list">
              <li v-for="item in archiveRestoreFailure.failures" :key="item.photoId">
                {{ item.photoId }} · {{ item.action }}（{{ item.error }}）
              </li>
            </ul>
          </template>
          <p v-else class="note-text">照片文件已全部还原 / 清理，原有业务数据未改变。</p>
        </section>

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
          规则：本机独有的记录原样保留，备份独有的追加到末尾，同一编号的记录用备份里的版本覆盖。
          导入不会删除当前数据。
        </p>
        <p v-if="importHasChanges" class="warn-text">
          被覆盖的版本无法找回。若本机数据比备份新，请先导出当前备份留一份。
        </p>
        <p v-if="!importHasAnything" class="warn-text">
          备份文件里没有可导入的记录，导入不会改变任何内容。
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
          备份里引用了本机没有的学生时（例如从别的设备导入），相关座位会显示为空、相关座位约束会显示成「已删除学生」、值日组里会显示成「未知学生」（可在值日管理页里取消勾选移除）、假期名单里会标注「已不在档案」（记录本身保留，可在假期管理页里清掉）。
        </p>
        <p v-if="archiveProgress" class="note-text">
          正在写回照片 {{ archiveProgress.done }} / {{ archiveProgress.total }} 张…
        </p>
      </template>
      <template #footer>
        <AppButton variant="ghost" @click="importOpen = false">取消</AppButton>
        <AppButton variant="secondary" @click="exportBackup">先导出当前备份</AppButton>
        <AppButton :loading="importing" :disabled="!importHasAnything" @click="confirmImport">
          <template v-if="importArchive">
            导入（新增 {{ importSummary.added }} 条 / 覆盖 {{ importSummary.replaced }} 条 / 照片
            {{ importPhotoCount }} 张）
          </template>
          <template v-else>
            导入（新增 {{ importSummary.added }} 条 / 覆盖 {{ importSummary.replaced }} 条）
          </template>
        </AppButton>
      </template>
    </AppModal>

    <!-- 完整备份导出结果：成功 / 缺失 / 失败逐类说清，绝不把缺失照片说成已备份 -->
    <AppModal v-model="archiveResultOpen" title="完整备份已导出" :width="560">
      <template v-if="archiveManifest">
        <p class="modal-file">{{ archiveSummaryText }}</p>
        <p class="note-text">
          文件已开始下载（ZIP）。其中 backup.json 与「导出数据（JSON）」内容同构；照片文件以 photoId
          命名，导入时按 photoId 与元数据关联。
        </p>
        <p class="note-text">本文件包含未成年人照片，请妥善保管，不要公开分享。</p>
        <section v-if="archiveProblemRows.length > 0" class="archive-block">
          <p class="archive-title">以下 {{ archiveProblemRows.length }} 张照片未包含在 ZIP 中</p>
          <ul class="archive-problem-list">
            <li v-for="row in archiveProblemRows" :key="row.photoId">
              {{ row.studentName || '未知学生' }} · {{ photoArchiveStatusLabel(row.status) }}
              <template v-if="row.reason">（{{ row.reason }}）</template>
            </li>
          </ul>
        </section>
        <p v-else class="note-text">全部有效照片都已包含在 ZIP 中。</p>
      </template>
      <template #footer>
        <AppButton @click="archiveResultOpen = false">知道了</AppButton>
      </template>
    </AppModal>

    <!-- 冲突处置（Phase 9C）。两个选项都会覆盖掉一边的数据，因此**不设默认动作**：
         弹窗只说明处境与后果，选哪一份由教师点。 -->
    <AppModal v-model="conflictOpen" title="本机与云端都有数据" :width="560">
      <p>这些模块本机有数据、云端也有，同步没有动它们：</p>
      <ul class="remove-list">
        <li v-for="label in cloudConflictLabels" :key="label">{{ label }}</li>
      </ul>
      <p class="warn-text">
        两边都可能是真的：本机这份可能是没联网时录的，云端那份可能是另一台设备上同步上去的。
        请选择保留哪一份——另一份会被覆盖，且不可撤销。选之前可以先导出一份本机备份。
      </p>
      <p class="note-text">
        不确定就先取消：不做选择不会丢数据，这些模块只是暂时不同步，随时可以回来再选。
      </p>
      <template #footer>
        <AppButton variant="ghost" @click="conflictOpen = false">取消</AppButton>
        <AppButton variant="secondary" :loading="cloudBusy" @click="doResolveConflict('remote')">
          保留云端数据（覆盖本机）
        </AppButton>
        <AppButton :loading="cloudBusy" @click="doResolveConflict('local')">
          保留本机数据（上传云端）
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.data-page {
  max-width: var(--page-max-width);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

/* ---- 页面头（与「我的」同一套页面标题层级） ---- */
.page-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0 4px var(--spacing-lg);
  border-bottom: var(--border-hairline-width) solid var(--color-border);
}

.page-head__title {
  font-size: var(--font-page-title);
  font-weight: var(--font-weight-bold);
  line-height: var(--leading-tight);
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
}

.page-head__sub {
  font-size: var(--font-content);
  color: var(--color-text-secondary);
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
  margin-top: var(--space-2);
}

.file-input {
  display: none;
}

.modal-file {
  font-weight: var(--font-weight-semibold);
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
  border-bottom: var(--border-hairline-width) solid var(--color-border);
}

.merge-table th {
  color: var(--color-text-secondary);
  font-weight: 500;
}

/* 完整备份（ZIP）的清单块：与业务数据合并表分开，避免看起来像同一份数据 */
.archive-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: var(--space-3) 0;
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
}

/* 回滚失败：用危险色描边，避免与普通“校验提示”混在一起 */
.archive-block--error {
  border-left-color: var(--color-danger);
  background: var(--color-danger-soft);
}

.archive-title {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.archive-problem-list {
  margin: var(--space-1) 0 0;
  padding-left: var(--space-4);
  list-style: disc;
  font-size: var(--text-xs);
  line-height: var(--leading-relaxed);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
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

/* 云同步：自带纵向间距（AppCard 的 body 不管子元素的间隔） */
.cloud-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.cloud-status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.cloud-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--color-text-faint);
}

.cloud-dot.is-ok {
  background: var(--color-success);
}

.cloud-dot.is-warn {
  background: var(--color-warning);
}

.cloud-dot.is-danger {
  background: var(--color-danger);
}

.cloud-status-text {
  font-weight: var(--font-weight-semibold);
}

.cloud-account {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  word-break: break-all;
}

/* 云端返回的原因：是给人看的原文，不是我们写的文案，故用次一级的颜色 */
.cloud-error {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  line-height: 1.6;
  padding: var(--space-2) var(--space-3);
  background: var(--color-fill-disabled);
  border-radius: var(--radius-md);
  word-break: break-word;
}

/* 待裁决的冲突（Phase 9C）：用左边框与底色把它与普通说明文字分开 */
.conflict-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: var(--border-hairline-width) solid var(--color-warning-soft-strong);
  border-left-width: 3px;
  border-radius: var(--radius-md);
  background: var(--color-warning-soft);
}

.conflict-title {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-warning-strong);
}

.backup-photo-note {
  margin: calc(-1 * var(--space-2)) var(--space-1) 0;
  font-size: var(--font-caption);
  line-height: var(--leading-relaxed);
  color: var(--color-text-tertiary);
}
</style>
