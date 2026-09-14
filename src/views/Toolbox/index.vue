<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { AppButton, AppCard, AppModal } from '@/components/ui'
import { useCloudSync } from '@/composables/useCloudSync'
import { useLoginModal } from '@/composables/useLoginModal'
import LoginModal from '@/components/layout/LoginModal.vue'
import { useToast } from '@/composables/useToast'
import { appConfig } from '@/config'
import type { ConflictChoice } from '@/composables/useCloudSync'
import { useBackup } from '@/composables/useBackup'
import {
  LAST_BACKUP_KEY,
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
import { formatClock, formatDateKey, formatDateOnly } from '@/utils/date'
import { Download, Upload } from 'lucide-vue-next'
import SyncDiagnosticsCard from './components/SyncDiagnosticsCard.vue'
import SettingsCell from '@/views/My/components/SettingsCell.vue'
import SettingsSection from '@/views/My/components/SettingsSection.vue'

/**
 * 工具箱（近期增量「数据管理」，见 docs/开发计划.md §六）。
 * 本页只做数据备份 / 恢复与清空：整页操作都以「写 localStorage → 重载」收尾，
 * 由八个 store 用各自既有的 normalize* 重新加载（见 utils/backup.ts 顶部说明）。
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
const lastBackupAt = ref<string>(storage.read(LAST_BACKUP_KEY) ?? '')

const lastBackupText = computed(() => {
  const iso = lastBackupAt.value
  if (!iso) return '还没有导出过备份。'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '还没有导出过备份。'
  return `上次导出：${formatDateOnly(date)} ${formatClock(date)}`
})

/* ---------- 云端同步（Phase 9B） ---------- */

/**
 * 云端同步的状态与操作。
 *
 * **同步的引擎不在这一页**：谁新谁旧、该推还是该采纳，全部在 `services/cloudSync.ts`；
 * 状态怎么说、点了按钮报什么，都在 `composables/useCloudSync.ts`——和顶栏那个同步按钮
 * **同一份**，所以两处不可能再各说各话。本页自己负责的只剩登录 / 登出：顶栏放不下表单，
 * 也不该在顶栏摆一个密码框。
 *
 * 下面解构成 `cloud*` 只是为了少改模板里的名字（模板早就这么叫了）。
 */
const {
  state: cloud,
  busy: cloudBusy,
  conflictLabels: cloudConflictLabels,
  statusView: cloudStatusView,
  lastSyncedText: cloudLastSyncedText,
  syncWithFeedback,
  resolveConflict,
} = useCloudSync()

/**
 * 冲突确认弹窗是否打开（Phase 9C）。
 *
 * 冲突的处置**只在弹窗里发生**：卡片上那个按钮只负责把弹窗打开。这不是多一道手续——
 * 两个选项都要覆盖掉一边的数据，且都不可撤销（本机这份被覆盖后在别处再无副本，
 * 云端那份被覆盖后另一台设备下次同步也会跟着换掉），点错没有回头路。
 */
const conflictOpen = ref(false)

/** 执行冲突处置（弹窗里的两个按钮）；处置完刷新本页概览——本机数据可能整份换掉了 */
async function doResolveConflict(choice: ConflictChoice): Promise<void> {
  conflictOpen.value = false
  await resolveConflict(choice)
  refreshSnapshot()
}

/* ---------- 写盘收尾（成功 / 失败两条路，绝不混说） ---------- */

/**
 * 成功收尾：先广播 → 写一次性提示 → 重载，由各 store 的 normalize* 重新加载。
 *
 * 广播（Phase 9A）必须在重载**之前**：导入备份 / 清空数据是**整批换数据**
 * （键可能新增、也可能消失），别的入口没法逐键对齐，只能整页重来。
 * 少了这一句，另一个标签页内存里还留着旧数据，教师下一次编辑就会把刚导入的整份覆盖掉
 * ——那正是技术债 #2 的另一半。
 */
function finish(notice: string): void {
  storage.reloadPeers()
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
        <h1 class="page-title">数据与同步</h1>
        <p class="page-subtitle">管理 TeacherDesk 本机与云端数据</p>
      </div>
    </header>

    <!-- Cloud-4：同步诊断（Observable Sync：状态 / 队列 / 待同步键 / 最近错误 / 通道） -->
    <SyncDiagnosticsCard />

    <AppCard
      title="导入导出"
      subtitle="本机数据保存在这台设备的浏览器里，清理浏览器缓存、换设备或换浏览器都会全部丢失，建议定期导出备份。"
    >
      <!-- 操作区：Apple Settings Cell（与「我的」页同一套设置行规范） -->
      <SettingsSection title="导入导出">
        <SettingsCell
          :icon="Download"
          icon-tone="neutral"
          title="导出数据"
          :subtitle="lastBackupText"
          @click="exportBackup"
        />
        <SettingsCell
          :icon="Upload"
          icon-tone="neutral"
          title="导入数据"
          subtitle="从备份文件恢复（JSON）"
          @click="pickFile"
        />
      </SettingsSection>

      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept=".json,application/json"
        tabindex="-1"
        aria-hidden="true"
        @change="onFilePicked"
      />
    </AppCard>

    <!-- 没配环境 ID 的构建里整块不显示：与其摆一个按不动的开关，不如不出现 -->
    <AppCard
      v-if="cloud.status !== 'disabled'"
      title="云同步"
      subtitle="把本机数据同步到你自己的云端账号，换设备或换浏览器时不用重新录一遍。不登录也能照常用——数据只留在本机，和以前一样。"
    >
      <div class="cloud-block">
        <div class="cloud-status">
          <span class="cloud-dot" :class="`is-${cloudStatusView.tone}`" aria-hidden="true" />
          <span class="cloud-status-text">{{ cloudStatusView.text }}</span>
          <span v-if="cloud.account" class="cloud-account">{{ cloud.account }}</span>
        </div>
        <p class="footnote">{{ cloudLastSyncedText }}</p>
        <!-- 云端给的原因原样摆出来。教师多半看不懂，但照着它去搜索、或截图发给懂的人，
             都比我们编一句「同步失败，请稍后再试」有用得多 -->
        <p v-if="cloud.error" class="cloud-error">云端返回的原因：{{ cloud.error }}</p>

        <!-- 首次同步发现「本机有数据、云端也有」（Phase 9C）：同步**不会**替教师选，
             两份都原样留着，这里把这件事说出来并给出唯一的处置入口 -->
        <div v-if="cloud.conflicts.length > 0" class="conflict-block">
          <p class="conflict-title">本机与云端都有数据，需要你确认保留哪一份</p>
          <p class="footnote">
            这些模块：{{ cloudConflictLabels.join('、') }}。同步暂时跳过了它们——本机这份和云端那份
            都原样保留着，只是这几项没在同步。这种情况通常出现在：你在没联网的时候录了新内容，
            而云端还存着另一台设备上同步上去的旧内容。
          </p>
          <div class="action-row">
            <AppButton variant="secondary" @click="conflictOpen = true">去确认保留哪一份</AppButton>
            <AppButton variant="ghost" @click="exportBackup">先导出本机备份</AppButton>
          </div>
        </div>

        <!-- 未登录：入口指向全局登录弹窗（不放表单——登录从点头像/点这里唤起） -->
        <div v-if="!cloud.checked" class="action-row">
          <p class="footnote">正在检查登录状态…</p>
        </div>
        <div v-else-if="!cloud.account && cloud.status === 'offline'" class="action-row">
          <p class="footnote">连不上云端，暂时无法确认登录状态。恢复网络后会自动重试。</p>
        </div>
        <div v-else-if="!cloud.account" class="action-row">
          <AppButton @click="loginModal.show()">立即登录同步</AppButton>
          <p class="footnote">不注册：账号在云开发控制台「身份认证 → 用户管理」新建。</p>
        </div>
        <div v-else class="action-row">
          <AppButton
            :loading="cloudBusy"
            :disabled="cloudBusy || cloud.status === 'syncing'"
            @click="syncWithFeedback"
          >
            立即同步
          </AppButton>
        </div>

        <p class="footnote">
          同步规则：新设备登录以云端为准；两边都有数据不会自动覆盖，会先请你确认保留哪一份；之后同一项两边都改过，以写得晚的一方为准。
        </p>
        <p class="footnote">
          同步需要云端先做好三件事：开启登录方式、在「身份认证 →
          用户管理」建好账号、建好数据集合。若一直失败，先查这三项。
        </p>
      </div>
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

    <LoginModal />
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
  font-weight: var(--font-weight-semibold);
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

.file-input {
  display: none;
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

/* 云端同步：自带纵向间距。AppCard 的 body 不管子元素的间隔（各卡片内容形态差得远，
   在那边定一套反而处处要覆盖），故这一块自己成列 */
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
  font-weight: 600;
}

.cloud-account {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  word-break: break-all;
}

/* 云端返回的原因：是给人看的原文，不是我们写的文案，故用次一级的颜色，
   与「危险操作」那类红字区分开——红字是「你会丢数据」，这里只是「没同步上」 */
.cloud-error {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  line-height: 1.6;
  padding: var(--space-2) var(--space-3);
  background: var(--color-fill-disabled);
  border-radius: var(--radius-md);
  word-break: break-word;
}

/* 待裁决的冲突（Phase 9C）：用左边框与底色把它与普通说明文字分开——
   这是这一页唯一「不做选择就同步不下去」的事，不该长得像一条脚注。
   用警示色而不是危险色：它不表示「你要丢数据了」，只表示「这里需要你拍板」 */
.conflict-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-warning-soft-strong);
  border-left-width: 3px;
  border-radius: var(--radius-md);
  background: var(--color-warning-soft);
}

.conflict-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-warning-strong);
}

.cloud-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 360px;
}
</style>
