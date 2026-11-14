import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { startAutoSync } from './sync/autoSync'
import { probeCloudSession } from './services/cloudSync'
import { startWidgetSnapshotSync } from './composables/useWidgetSnapshot'
import { onSyncReload } from './services/sync'
import { startStudentPhotoAutoRetry } from './stores/studentPhoto'
import { startViolationSync } from './stores/violation'
import { startViolationPresetSync } from './stores/violationPreset'

import 'virtual:uno.css'
import './styles/main.css'

/**
 * 跨标签页同步的应用级接线（Phase 9A）：别的入口导入备份 / 清空数据后，本页整页重载。
 * 那两种操作是**整批换数据**（键可能新增、也可能消失），没有逐键对齐的余地——
 * 重来一遍才能让八个 store 与新数据对齐。逐键同步见 `services/sync.ts` 的 `syncPersisted`。
 * 注册在 mount 之前：应用一起来就听得见，不会漏掉启动瞬间到达的广播。
 *
 * 取舍：重载**不弹确认、也不提示**，另一页上的未保存状态（正在填的表单等）会直接消失。
 * 这是有意选的：导入备份 / 清空数据本来就是「整个应用的数据都换了」的操作，教师在那一边
 * 点下去的时候，意图就是让所有入口都用新数据；此时再回到这一页问一句「要不要重载」，
 * 只会让两页短暂地各显示一份不同的数据。表单内容是即时提交的（无草稿态），没有真正的未保存数据。
 */
onSyncReload(() => window.location.reload())

/**
 * Pinia 实例要**留一个引用**：下面的 Widget 快照同步需要它。
 *
 * 提前到 `startAutoSync()` 之前创建，是为了让「违纪自定义预设」的 Store 能在**首轮云同步
 * 对账之前**完成 Repository.bind（见下一条注释）。`app.use(pinia)` 仍然只装这一次，
 * 之后所有 Store 共用同一个实例。
 */
const pinia = createPinia()

/**
 * v3.8.1 Phase 4：**违纪事件 + 自定义预设都必须在启动时注册同步键**。
 *
 * 违纪页面是懒加载的——如果只在页面里实例化 Store，没打开过违纪页的设备就永远不会把
 * `teacherdesk:violations` / `teacherdesk:violationPresets` 注册进 `syncedKeys()`，
 * 这些数据在云端同步里等于不存在（而界面上完全看不出来）。
 *
 * Phase 3 只预注册了预设键；Phase 4 验收发现事件键同样缺失，这里补齐：
 * 两个 Store 都在 `startAutoSync()` 的首次对账之前完成 Repository.bind。
 * 只提前注册 / 加载这两个 Store，不改变同步协议、LWW 或数据格式。
 */
startViolationSync(pinia)
startViolationPresetSync(pinia)

/**
 * 云端同步的接线（Phase 9B 起，Cloud-3 改为经同步引擎）：启动即对账一次，
 * 并把「本页写盘（防抖）/ 重新联网 / 回到前台」三种时刻接到引擎上
 * （见 `src/sync/autoSync.ts`）。
 *
 * 注册在 mount **之前**与 9A 同理：首屏那几个 store 一起来就会读盘、必要时播种示例数据，
 * 而 store 是懒加载的——某个模块第一次被打开时播种的示例数据，必须被同步看见并按
 * 「云端已有数据」处理掉，否则它会以「本地新数据」的身份推上云，把真实数据盖掉。
 * 没配环境 ID 时什么都不注册，本地模式照常工作（引擎保持 LocalOnly）。
 */
startAutoSync()

/**
 * 再把「现在是谁登录着」问一次（v3.3.0）。
 *
 * 界面读的登录状态在 `services/cloudSync.ts` 那一份里，引擎那条链路不认识它——
 * 不补这一句，冷启动时工具箱的云同步行会永远停在「检查中…」且点了没反应，
 * 顶栏的同步按钮也不会出现（见 `probeCloudSession` 的说明）。
 * 它只查会话、不传数据，所以与上面的引擎不会互相打架。
 *
 * 不 await：它是一次网络往返，不该挡住首屏；界面在它回来之前显示「检查中…」是对的。
 */
void probeCloudSession()

const app = createApp(App)

app.use(pinia)
app.use(router)

/**
 * 学生照片的离线补传接线（v3.8.0 · Phase 1B 数据层）。
 *
 * 照片采用**本地优先**：上传失败 / 断网 / 未登录都只意味着"还没上云"，本地照片照常可用。
 * 这里在启动时恢复本机上传队列，并在「联网 / 回到前台」时自动补传。
 * 它只碰照片模块自己的 outbox 与云端文件通道，不参与普通业务 JSON 同步；
 * 任何失败都留在本机队列里，下一次再试，绝不丢本地照片。
 */
startStudentPhotoAutoRetry()

app.mount('#app')

/**
 * macOS 桌面小组件的快照同步（v3.7.0，规格 §二十一：启动时检查并更新一次）。
 *
 * 它是**尽力而为**的：没连过就等于不做事，连过但权限不在就安静跳过；
 * 任何失败都只 `console.warn`，绝不打扰教师，更不影响应用启动。
 */
startWidgetSnapshotSync(pinia)
