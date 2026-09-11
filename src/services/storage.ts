/**
 * 本机存储层（Phase 9A 抽出）：全应用读写 localStorage 的**唯一出口**。
 *
 * 为什么要有这一层：
 * - 同一个动作此前有三处实现——八个 store 各写一份「try + setItem + catch warn」，
 *   备份模块自带一份 `StoragePort`，工具箱页面又照着抄了一份。改一处（比如加配额处理）
 *   要记得改十处，漏掉的那处会安静地不生效；
 * - Phase 9（后端接入）要把数据载体从 localStorage 换成「本地缓存 + 云端」，
 *   调用方只认这一层，替换点才只有一处；
 * - 跨标签页同步要求写盘**幂等**（见 `writeJSON` 的说明），而幂等判断的前提是
 *   「写盘」这件事只发生在一个地方。
 *
 * 本层**不做业务校验**：读到的东西是不是某个 store 认得的形状，由各 store 既有的
 * `normalize*` / 类型守卫负责——那是唯一事实来源，这里再判一次只会多出一份会分叉的规则。
 */

/**
 * 本机存储端口：读不到（隐私模式等）不是错误，按「没有数据」处理；
 * 写失败必须让调用方知道，故不吞异常——备份模块据此整批回滚，`writeJSON` 据此告警。
 */
export interface StoragePort {
  read(key: string): string | null
  write(key: string, value: string): void
  remove(key: string): void
  /** 列出全部键（清空全部数据用；需覆盖本模块不认识的历史 / 未来键，不能写死键名） */
  list(): string[]
}

/** localStorage 实现（浏览器端的唯一实现；自检脚本按同一接口换成内存 Map） */
export const localStoragePort: StoragePort = {
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

/**
 * 键名末段（`teacherdesk:students` → `students`）：告警文案里当模块名用。
 * 由键名派生而不是让每个调用方传一遍：少了十个「传错名字」的机会，也不会漏传。
 *
 * 名字与 `utils/backup.ts` 里那个私有的同名函数区分开：那个把键映射成中文模块名
 * （「学生档案」），是给教师看的；这个是给开发者看的日志标签。
 */
export function keyLabel(key: string): string {
  const parts = key.split(':')
  return parts[parts.length - 1] ?? key
}

/**
 * 严格读原始字符串：**存储读不了会抛**，由调用方处置。
 *
 * 与 `localStoragePort.read` 的差别只在这一点上，但差别要紧：那边（备份模块）把「读不了」
 * 当成「没有数据」，这边（各 store）必须把「读不了」与「键不存在」分开——
 * 前者要告警并显示空列表，后者要播种示例数据。混成一个 `null`，隐私模式下会被
 * 误判成「第一次打开」，凭空造出一份示例学生 / 示例课表给教师看（而且刷新就没了）。
 */
export function readRaw(key: string): string | null {
  return window.localStorage.getItem(key)
}

/**
 * `readList` 家族的三态结果。为什么要分三态而不是「列表 / null」两态：
 * 调用方对**损坏**和**不存在**要做的处置完全相反——
 * - 首屏加载：不存在 → 播种示例数据；损坏 → 安全降级为空（**千万不能播种**，
 *   否则一份被改坏的课表会被示例数据盖掉）；
 * - 跨标签页同步：不存在 → 不动内存（键在对方那里被删了，整批删除走 reload 消息）；
 *   损坏 → **什么都不做**，盘上原文保留，等下一次真实写入。
 *   （早先这里把损坏也当成 `[]` 灌给 store，等于用一次读取错误去覆盖内存里的好数据，
 *   还会顺势把空列表写回盘上，把原文冲掉——Phase 9A 交付前审查修复。）
 */
type ReadResult = { kind: 'missing' | 'ok' | 'broken'; list: unknown[] }

function readListCore(key: string): ReadResult {
  let raw: string | null
  try {
    raw = readRaw(key)
  } catch (error) {
    console.warn(`[${keyLabel(key)}] 读取本地存储失败，已跳过本次读取（原文保留）：`, error)
    return { kind: 'broken', list: [] }
  }
  if (raw === null) return { kind: 'missing', list: [] }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      console.warn(`[${keyLabel(key)}] 本地数据不是列表，已跳过本次读取（原文保留）`)
      return { kind: 'broken', list: [] }
    }
    return { kind: 'ok', list: parsed }
  } catch (error) {
    console.warn(`[${keyLabel(key)}] 本地数据解析失败，已跳过本次读取（原文保留）：`, error)
    return { kind: 'broken', list: [] }
  }
}

/**
 * 读一个列表键（首屏加载用）：
 * - **键不存在 → `null`**（与「空列表」是两件事：各 store 据此决定要不要播种示例数据）；
 * - 存储读不了 / 内容不是列表 / 解析失败 → 告警后返回 `[]`，**且不写盘**——盘上原文保留，
 *   被改坏的数据还能人工找回（与备份模块「宁可不认，不可丢」同一口径）。
 *
 * 注意文案说「已跳过本次读取」而不是「已重置为空」：盘上什么都没有被改，
 * 界面只是这一次先用空的（原文案会让教师以为数据被清了）。
 */
export function readList(key: string): unknown[] | null {
  const result = readListCore(key)
  return result.kind === 'missing' ? null : result.list
}

/**
 * 读一个列表键（同步用，只认「确实读到了内容」）：
 * 键不存在或内容损坏都返回 `null`，调用方据此**跳过本次更新、保留内存里的现值**。
 * 与 `readList` 的差别只在这点上，但同步链路上值得单开一个函数：那里要的是
 * 「读不到就别动」，而 `readList` 的 `[]` 会顺手把内存和盘上都清成空的。
 */
export function readListStrict(key: string): unknown[] | null {
  const result = readListCore(key)
  return result.kind === 'ok' ? result.list : null
}

/**
 * 写一个 JSON 键；**幂等**——盘上已有相同内容时不写并返回 `false`。
 *
 * 为什么幂等是必须的（Phase 9A 跨标签页同步）：另一个入口改了数据会广播过来，
 * 本页重读后替换内存状态，而替换又会触发本页的写盘 watch——若不做比较，写下去的是
 * 「和盘上一模一样的内容」，可 localStorage 的写入**即使值没变也会通知其它标签页**，
 * 于是两个入口互相触发、无限乒乓。有了比较，这次回写变成空操作，链路到此为止。
 *
 * 返回值即「是否真的写入了」——调用方据此决定要不要广播（没写就不用广播）。
 * 写入失败只告警不抛：隐私模式 / 配额耗尽时应用要继续能用，数据先留在内存里。
 */
export function writeJSON(key: string, value: unknown): boolean {
  let text: string | undefined
  try {
    text = JSON.stringify(value)
  } catch (error) {
    console.warn(`[${keyLabel(key)}] 数据无法序列化，未写入本地存储：`, error)
    return false
  }
  // JSON.stringify(undefined) 得到 undefined（不是字符串），写进去会变成字面量 "undefined"
  if (text === undefined) {
    console.warn(`[${keyLabel(key)}] 数据为空值，未写入本地存储`)
    return false
  }
  try {
    if (localStoragePort.read(key) === text) return false
    localStoragePort.write(key, text)
    return true
  } catch (error) {
    console.warn(`[${keyLabel(key)}] 写入本地存储失败（数据只保留在内存中）：`, error)
    return false
  }
}
