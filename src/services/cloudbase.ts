/**
 * 腾讯云开发 CloudBase 适配器（Phase 9B）：本模块是**全应用唯一** import
 * `@cloudbase/js-sdk` 的地方。
 *
 * 这层刻意做得薄——它只干三件事：拿会话（登录 / 登出 / 当前用户）、把 SDK 的两种
 * 失败姿势统一成一种（抛 Error）、把「一个存储键 = 一份文档」翻译成 SDK 调用。
 * 所有判断性逻辑（谁更新、要不要推、什么时候同步）都在 `services/cloudSync.ts`，
 * 那边不依赖 SDK，因此可以完整自检；这个文件则需要真环境才能验证，
 * 把不可自检的面积压到最小是它唯一的设计目标。
 *
 * **SDK 的失败姿势有两种**（实测）：有的调用抛异常，有的**不抛**而是返回
 * `{ data, error }`——后者如果只写 `await` 就会把失败当成功，静默丢掉一次同步。
 * `unwrap` 把两种情况归一成「失败必抛」，调用方只写一条错误通路。
 */
import cloudbase from '@cloudbase/js-sdk'

import { appConfig } from '@/config'
import type { RemoteDoc, RemotePort } from '@/services/remote'

type CloudBaseApp = ReturnType<typeof cloudbase.init>

/** 已登录用户（云端只给应用这两样，够用了：uid 用来隔离数据，邮箱用来显示「你登录的是谁」） */
export interface CloudUser {
  uid: string
  email: string | null
}

/** 云端错误：带上 SDK 的 code，调用方据此区分「登录方式没开」这类能自解释的情况 */
export class CloudError extends Error {
  readonly code: string | null

  constructor(message: string, code: string | null) {
    super(message)
    this.name = 'CloudError'
    this.code = code
  }
}

/** 环境 ID 配了没有；没配则云端同步整块不启用（应用按纯本地跑） */
export function isCloudConfigured(): boolean {
  return appConfig.cloudEnvId.trim().length > 0
}

let app: CloudBaseApp | null = null
let appEnvId = ''

/** 取 SDK 应用实例（惰性创建：没配环境 ID 时，导入本模块不会有任何副作用） */
function getApp(): CloudBaseApp {
  const envId = appConfig.cloudEnvId.trim()
  if (envId.length === 0) {
    throw new CloudError('没有配置 CloudBase 环境 ID，云端同步未启用', 'NO_ENV_ID')
  }
  if (app === null || appEnvId !== envId) {
    app = cloudbase.init({ env: envId })
    appEnvId = envId
  }
  return app
}

/** 把任意形态的失败折成 `CloudError`，并尽量保住 code（它是「可自解释」的唯一线索） */
function toCloudError(raw: unknown): CloudError {
  if (raw instanceof CloudError) return raw
  if (raw instanceof Error) {
    const code = (raw as Error & { code?: unknown }).code
    return new CloudError(raw.message, typeof code === 'string' ? code : null)
  }
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as Record<string, unknown>
    const code = o.code ?? o.errorCode
    const message = typeof o.message === 'string' ? o.message : '云端操作失败'
    return new CloudError(message, typeof code === 'string' ? code : null)
  }
  return new CloudError(typeof raw === 'string' ? raw : '云端操作失败', null)
}

/** 失败必抛：SDK 抛出来的、和 `{ data, error }` 里藏着的，在这里合流 */
function unwrap<T>(result: unknown): T {
  if (typeof result === 'object' && result !== null && 'error' in result) {
    const error = (result as { error?: unknown }).error
    if (error) throw toCloudError(error)
    return (result as { data?: unknown }).data as T
  }
  return result as T
}

async function call<T>(promise: Promise<unknown>): Promise<T> {
  try {
    return unwrap<T>(await promise)
  } catch (error) {
    throw toCloudError(error)
  }
}

/**
 * 当前登录用户：**确实没登录**（或没配环境）返回 `null`，**查不出来则抛**。
 *
 * 为什么「查不出来」不能再折成 `null`（9B 交付前独立审查抓出来的）：调用方拿到 `null`
 * 只会做一件事——显示登录表单。而离线时 `getLoginState()` 要触网、失败后折成 `null`，
 * 教师看到的就是「未登录」：他会以为掉登录了，在没信号的地方反复输密码（输一次失败一次），
 * 而真实原因是连不上云端。抛出去之后，调用方用 `navigator.onLine` 分得开「连不上」与
 * 「确实没登录」，状态栏也就不必说谎。
 */
export async function currentUser(): Promise<CloudUser | null> {
  if (!isCloudConfigured()) return null
  const state = await call<{ user?: { uid?: string; email?: string } } | null>(
    getApp().auth().getLoginState(),
  )
  const user = state?.user
  if (!user?.uid) return null
  return { uid: user.uid, email: user.email ?? null }
}

/** 邮箱 + 密码登录（账号由教师在控制台或应用的注册入口创建） */
export async function signInWithEmail(email: string, password: string): Promise<CloudUser> {
  const auth = getApp().auth()
  await call(auth.signInWithEmailAndPassword(email, password))
  const user = await currentUser()
  if (!user) throw new CloudError('登录成功但没拿到用户信息', null)
  return user
}

/** 注册新账号（邮箱 + 密码）；是否要求邮箱验证由云端身份认证的配置决定 */
export async function signUpWithEmail(email: string, password: string): Promise<CloudUser> {
  const auth = getApp().auth()
  await call(auth.signUpWithEmailAndPassword(email, password))
  const user = await currentUser()
  if (!user) throw new CloudError('注册成功但没拿到用户信息', null)
  return user
}

export async function signOutCloud(): Promise<void> {
  await call(getApp().auth().signOut())
}

/**
 * 文档主键：直接用存储键名。
 *
 * 换成「更安全的」哈希 / 转义会让教师在云开发控制台里看不懂哪份文档是哪个模块，
 * 而键名（`teacherdesk:students`）本身就是最清楚的说明。文档里另存了一份 `key` 字段，
 * 所以即使将来需要改主键规则，也不必反推。
 */
function docIdOf(key: string): string {
  return key
}

/** SDK 查询结果的形状不止一种（数组 / `{data}` / `{data:{list}}`），统一取成行数组 */
function rowsOf(result: unknown): Record<string, unknown>[] {
  const asArray = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null)
  const direct = asArray(result)
  if (direct) return direct.filter(isRow)
  if (typeof result === 'object' && result !== null) {
    const data = (result as { data?: unknown }).data
    const list = asArray(data) ?? asArray((data as { list?: unknown } | undefined)?.list)
    if (list) return list.filter(isRow)
  }
  return []
}

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * CloudBase 实现的远端端口。
 *
 * 两个刻意的选择：
 * - **`payload` 直接存数组**（不是 JSON 字符串）：控制台里点开就能读，
 *   教师自己也能核对「云上这份和我手机上的是不是一回事」，不用先解析一层；
 * - **`pull` 一次取全**：一个存储键一份文档，键数由应用决定（当前八个），
 *   不会随教师的数据量增长。`limit` 显式写出来是因为 SDK 默认只返回 20 条，
 *   靠默认值会变成「某天加第九个模块，它就静默不同步了」。
 */
export function createCloudBaseRemote(): RemotePort {
  const collection = () => getApp().database().collection(appConfig.cloudCollection)

  return {
    async pull(): Promise<RemoteDoc[]> {
      const rows = rowsOf(await call(collection().limit(100).get()))
      const docs: RemoteDoc[] = []
      for (const row of rows) {
        const key =
          typeof row.key === 'string' ? row.key : typeof row._id === 'string' ? row._id : null
        if (key === null) continue
        // 形状不对的文档**跳过而不是抛**：云上可能留着旧版本或人工试写的数据，
        // 一份坏文档不该让整次同步失败，其余七个模块还等着同步
        if (!Array.isArray(row.payload)) {
          console.warn(`[cloud] 云上「${key}」不是列表，本次跳过`)
          continue
        }
        const updatedAt = typeof row.updatedAt === 'number' ? row.updatedAt : 0
        docs.push({ key, payload: row.payload, updatedAt })
      }
      return docs
    },

    async push(doc: RemoteDoc): Promise<void> {
      await call(
        collection()
          .doc(docIdOf(doc.key))
          .set({ key: doc.key, payload: doc.payload, updatedAt: doc.updatedAt }),
      )
    },

    async remove(key: string): Promise<void> {
      await call(collection().doc(docIdOf(key)).remove())
    },
  }
}
