import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { startCloudSync } from './services/cloudSync'
import { onSyncReload } from './services/sync'

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
 * 云端同步的接线（Phase 9B）：启动即对齐一次，并把「本页写盘 / 重新联网 / 回到前台」
 * 三种时刻接到同步上（见 `services/cloudSync.ts` 的 `startCloudSync`）。
 *
 * 注册在 mount **之前**与 9A 同理：首屏那几个 store 一起来就会读盘、必要时播种示例数据，
 * 而 store 是懒加载的——某个模块第一次被打开时播种的示例数据，必须被同步看见并按
 * 「云端已有数据」处理掉，否则它会以「本地新数据」的身份推上云，把真实数据盖掉。
 * 没配环境 ID 时它只是把自己标成 `disabled`，不发任何请求。
 */
startCloudSync()

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
