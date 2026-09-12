/**
 * 拼音排序的键提取器（Phase 5B）——**全应用唯一碰 `pinyin-pro` 的一层**。
 *
 * **`import('pinyin-pro')` 是动态的**，理由与 `services/studentImport.ts` 里的 xlsx 相同：
 * 拼音词典压缩后仍有数百 KB，而按拼音排序是可选操作，不是每次打开工作台都要用的东西。
 * 仓库没有配 `manualChunks`（`vite.config.ts`），所以静态引入等于直接把它塞进首屏包；
 * 而首屏已经背着「未启用 gzip」与 CloudBase SDK 两笔账（见开发手册遗留问题）。
 *
 * 与 xlsx 的唯一差别是**调用频率**：导入是低频操作，排序是高频交互。所以这里多做了两件事——
 * ① 模块级缓存，加载一次就常驻；② 失败**不缓存失败本身**，教师下次再点还有机会重试
 * （多半是断网或离线首次加载，网络回来就好了）。
 *
 * 纯函数层（`utils/studentQuery.ts`）通过参数接收这里的返回值，因此它自己不需要
 * 知道 pinyin-pro 的存在，测试里可以直接注入假键。
 */
export type PinyinKey = (name: string) => string

let cached: PinyinKey | null = null
let pending: Promise<PinyinKey | null> | null = null

/**
 * 加载拼音键提取器；失败返回 `null`（不抛），由调用方决定怎么提示。
 * 返回的键是**无声调全拼小写**，如 `旦增卓玛` → `danzengzhuoma`。
 */
export async function loadPinyinKey(): Promise<PinyinKey | null> {
  if (cached) return cached

  let task = pending
  if (!task) {
    task = import('pinyin-pro')
      .then((module) => {
        const key: PinyinKey = (name) => module.pinyin(name, { toneType: 'none' })
        cached = key
        return key
      })
      .catch(() => {
        pending = null
        return null
      })
    pending = task
  }
  return task
}
