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

/**
 * 已登录用户。云端够用的就这几样：`uid` 用来隔离数据，`username` / `email` 用来显示
 * 「你登录的是谁」——账号是控制台建的「用户名」类型时**只有 `username`、没有邮箱**
 * （`IUserInfo` 里两者都是可选，见 `core.d.ts`），所以显示时先取 `username`。
 */
export interface CloudUser {
  uid: string
  username: string | null
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

/** 挑错误码（两种命名都见过） */
function pickCode(o: Record<string, unknown>): string | null {
  const code = o.code ?? o.errorCode
  return typeof code === 'string' && code !== '' ? code : null
}

/** 挑一句人话：`message` 之外还见过 `msg` 与 OAuth 风格的 `error_description` */
function pickMessage(o: Record<string, unknown>): string | null {
  for (const key of ['message', 'msg', 'error_description']) {
    const value = o[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

/** 兜底：把原始字段摊开摆出来（code 已单独取出，不重复） */
function describeFields(o: Record<string, unknown>, code: string | null): string {
  const parts = Object.entries(o)
    .filter(
      ([k, v]) => k !== 'code' && k !== 'errorCode' && v !== null && v !== undefined && v !== '',
    )
    .filter(([, v]) => typeof v !== 'object' && typeof v !== 'function')
    .map(([k, v]) => `${k}=${String(v)}`)
  if (code !== null) parts.unshift(`code=${code}`)
  return parts.length > 0
    ? `云端操作失败（${parts.join('，')}）`
    : '云端操作失败（云端没有给出任何原因）'
}

/**
 * 把错误码缀到原因后面；原因里已经含它（`describeFields` 那条路）就不重复。
 *
 * 码不能只躺在 `CloudError.code` 里——实测就是这么漏的：登录被云端拒绝，界面只显示
 * 兜底的「云端操作失败」，而唯一能定位问题的码存在字段里、没有任何界面读它。
 * 界面上三个显示点（工具箱、状态栏、同步卡片）都只认 `message`，所以**保证 message
 * 自带全部线索**比在每个显示点各补一次可靠得多。
 */
function withCode(message: string, code: string | null): string {
  if (code === null || message.includes(code)) return message
  return `${message}（${code}）`
}

/**
 * 把任意形态的失败折成 `CloudError`。**不丢线索**是这里的全部意义。
 *
 * 实测踩过一次：登录被云端拒绝，但它只给了 code、没给 message，于是界面显示兜底的
 * 「云端操作失败」——教师把这句复述过来，里面没有任何可用于排查的信息，只能靠猜。
 * 云端返回什么就显示什么（§9.20 取舍⑦：宁可显示英文，也不编「错误码 → 中文指引」
 * 的对照表），所以这里逐级退：message → msg → 原始字段罗列，**不退成一句空话**。
 */
function toCloudError(raw: unknown): CloudError {
  if (raw instanceof CloudError) return raw
  if (raw instanceof Error) {
    const o = raw as Error & Record<string, unknown>
    const code = pickCode(o)
    const message = raw.message.trim() !== '' ? raw.message : pickMessage(o)
    return new CloudError(withCode(message ?? describeFields(o, code), code), code)
  }
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as Record<string, unknown>
    const code = pickCode(o)
    return new CloudError(withCode(pickMessage(o) ?? describeFields(o, code), code), code)
  }
  if (typeof raw === 'string' && raw.trim() !== '') return new CloudError(raw, null)
  return new CloudError('云端操作失败（云端没有给出任何原因）', null)
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
  const state = await call<{
    user?: { uid?: string; username?: string; email?: string }
  } | null>(getApp().auth().getLoginState())
  const user = state?.user
  if (!user?.uid) return null
  return { uid: user.uid, username: user.username ?? null, email: user.email ?? null }
}

/** 「登录动作成了、但拿不到会话」是异常，不是「没登录」——混同会让界面显示成未登录 */
async function requireUser(): Promise<CloudUser> {
  const user = await currentUser()
  if (!user) throw new CloudError('登录成功但没拿到用户信息', null)
  return user
}

/**
 * 用户名 + 密码登录（**应用当前走的就是这条**）。
 *
 * **为什么是用户名而不是邮箱**（2026-09-12 实测定的）：CloudBase 控制台「身份认证 →
 * 用户管理 → 新建用户」的必填项是**用户名 / 用户昵称 / 密码**，邮箱只是选填——账号天生
 * 就是「用户名」类型，拿邮箱那套接口登不上。更要命的是界面这一侧的坑：输入框写的是
 * `type="email"`，教师填自己建的用户名时**被浏览器自己的校验挡在提交之前**（提示「请输入
 * 邮箱」），表现是「点登录没反应」——请求根本没发出去，云端不会有任何错误可查。
 *
 * `signInWithUsernameAndPassword` 与 `signInWithEmailAndPassword` 同在 `AuthV1Compat` 上
 * （`auth/dist/v1-compat.d.ts` 里相邻两行），所以会话读取那条路（`currentUser` →
 * `getLoginState`）一行都不用改——这次只换调用，不换代际。
 *
 * 想让用户名**就是**邮箱地址也完全可以：CloudBase 的用户名字符集允许邮箱格式，
 * 那时界面上填的是邮箱，走的仍是这条用户名登录。
 */
export async function signInWithUsername(username: string, password: string): Promise<CloudUser> {
  const auth = getApp().auth()
  await call(auth.signInWithUsernameAndPassword(username, password))
  return requireUser()
}

/** 邮箱 + 密码登录。⚠️ **目前没有调用方**（应用走的是 `signInWithUsername`，理由见上） */
export async function signInWithEmail(email: string, password: string): Promise<CloudUser> {
  const auth = getApp().auth()
  await call(auth.signInWithEmailAndPassword(email, password))
  return requireUser()
}

/**
 * 注册新账号（邮箱 + 密码）。
 *
 * ⚠️ **目前没有调用方**（2026-09-12 需求方拍板：网站单教师自用，账号在云开发控制台建，
 * 应用里只留登录页）。保留而不删，是因为它是这个适配层对 SDK 能力的一份如实记录，
 * 将来要重新开放注册只差一个界面——`services/index.ts` 那个空壳是同样的处置（见开发手册
 * §9.8）。**它不是「待用的死代码」，是「保留的能力」**：真删了，下次要用还得重新摸一遍
 * CloudBase 的注册语义（下面这些坑就是这样踩出来的）。
 *
 * 返回 `null` 表示**账号建好了，但云端没给登录态**——身份认证开了「邮箱验证」时就是
 * 这样：注册成功、验证邮件发出，但邮箱验证通过前不发放会话。这是配置决定的**正常中间
 * 状态**，不是失败（早先这里抛「注册成功但没拿到用户信息」：一句话自相矛盾，看了只会
 * 以为程序坏了，然后反复重试注册）。是否要求验证由云端配置决定，客户端**不该**去猜，
 * 所以这里只如实报告「有没有拿到登录态」，含义交给调用方翻译。
 *
 * 另一个实测记下的坑：若环境开了邮箱验证，**光有本函数不够**——云端发的若是「验证码」，
 * 还得有把验证码交回去的一步（v2 的 `getVerification` / `verifyOtp`，本机 SDK 里都在），
 * 否则账号会永远停在未验证、登录必被拒。
 */
export async function signUpWithEmail(email: string, password: string): Promise<CloudUser | null> {
  const auth = getApp().auth()
  await call(auth.signUpWithEmailAndPassword(email, password))
  return currentUser()
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
