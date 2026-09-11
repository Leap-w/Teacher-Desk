/**
 * 同步冲突判定（Phase 9C §4.1，P0）。
 *
 * `decideKey` 是整个云端同步里唯一会出错的地方：谁新谁旧、该推还是该采纳，八个模块
 * 全靠这一个函数（`services/cloudSync.ts` 里它的调用点只有一处）。这里把它的每一种
 * 处境都钉死——**第一次**同步 / **正常**同步 / 本地有**待发送**修改 / 云端**不存在**这个键，
 * 四件事分开测，不混成一个用例。
 *
 * 判定结果只有四种：`skip`（两边都没动）、`push`（本机这份上去）、`adopt`（云端那份下来）、
 * `conflict`（首次同步时两边都有真实数据，等教师裁决——Phase 9C 收紧的那条）。
 */
import { describe, expect, it } from 'vitest'

import { decideKey } from '@/services/cloudSync'
import type { RemoteDoc } from '@/services/remote'

const KEY = 'teacherdesk:students'
/** 本机上一轮同步时与云端对齐过的那份原文 */
const SEEN = JSON.stringify([{ id: 'a' }])
/** 本机现在的原文（比 SEEN 多了一条 = 本地改过） */
const LOCAL = JSON.stringify([{ id: 'a' }, { id: 'b' }])
/** 云端那份（内容与哪一边相同不影响判定，判定只看时刻） */
const REMOTE_PAYLOAD = [{ id: 'z' }]

const T0 = 1_700_000_000_000

function doc(updatedAt: number): RemoteDoc {
  return { key: KEY, payload: REMOTE_PAYLOAD, updatedAt }
}

/** 记账：`seen` 是本机上次对齐后的原文，`syncedAt` 是那一刻，`localUpdatedAt` 是本机写盘时刻 */
function meta(seen: string | null, syncedAt: number, localUpdatedAt: number) {
  return { seen, syncedAt, localUpdatedAt }
}

describe('情况 A：本机无数据、云端有 → 云端胜出', () => {
  it('键不存在（还没播种过）时把云端那份拿下来', () => {
    expect(decideKey(null, doc(T0), undefined, T0, true)).toMatchObject({ kind: 'adopt' })
  })

  it('本机是空列表（教师清空过）时同样以云端为准', () => {
    // `hasNoLocalData('[]')` 为 true，所以调用方传进来的 localIsInitial 是 true
    expect(decideKey('[]', doc(T0), undefined, T0, true)).toMatchObject({ kind: 'adopt' })
  })

  it('本机还是播种的那一份示例数据时以云端为准', () => {
    const seedText = JSON.stringify([{ id: 'seed-1' }])
    expect(decideKey(seedText, doc(T0), undefined, T0, true)).toMatchObject({ kind: 'adopt' })
  })
})

describe('情况 B：云端不存在这个键 ≠ 删除指令', () => {
  it('本地改过 → 推上去（不因云端缺键而丢本机数据）', () => {
    expect(decideKey(LOCAL, undefined, meta(SEEN, T0, T0), T0, false)).toMatchObject({
      kind: 'push',
    })
  })

  it('本地没改过 → 什么都不做，且**不是**采纳（云上没东西可采纳）', () => {
    const decision = decideKey(SEEN, undefined, meta(SEEN, T0, T0), T0, false)
    expect(decision.kind).toBe('skip')
  })

  it('首次同步（没有任何记账）+ 云端无此键 → 推本机这份', () => {
    expect(decideKey(LOCAL, undefined, undefined, T0, false)).toMatchObject({ kind: 'push' })
  })
})

describe('情况 C：本地更新更晚 → 本地胜出', () => {
  it('本地写盘时刻晚于云端写入时刻 → 推本机这份', () => {
    // 两边都改过（doc.updatedAt > syncedAt），本地更晚
    const decision = decideKey(LOCAL, doc(T0), meta(SEEN, T0 - 5000, T0 + 1000), T0, false)
    expect(decision).toMatchObject({ kind: 'push' })
  })

  it('记账里没有本地写盘时刻时用「现在」兜底，仍是本地胜出', () => {
    // localUpdatedAt 为 0（跨会话丢了）——若拿它去比，云端那份会赢，正好判反
    const decision = decideKey(LOCAL, doc(T0), meta(SEEN, T0 - 5000, 0), T0 + 10_000, false)
    expect(decision).toMatchObject({ kind: 'push' })
  })
})

describe('情况 D：云端更晚 → 云端胜出', () => {
  it('云端写入时刻晚于本地写盘时刻 → 采纳云端那份', () => {
    const decision = decideKey(LOCAL, doc(T0), meta(SEEN, T0 - 5000, T0 - 1000), T0, false)
    expect(decision).toMatchObject({ kind: 'adopt', doc: { updatedAt: T0 } })
  })
})

describe('情况 E：时间相同 → 云端胜出（保持 9B 既有设计，不靠巧合）', () => {
  it('两边时刻一模一样时判云端赢', () => {
    const decision = decideKey(LOCAL, doc(T0), meta(SEEN, T0 - 5000, T0), T0, false)
    expect(decision).toMatchObject({ kind: 'adopt' })
  })
})

describe('情况 F：本地有待发送的修改', () => {
  it('云端没这个键 → 推上去（改动没丢）', () => {
    expect(decideKey(LOCAL, undefined, meta(SEEN, T0, T0), T0, false)).toMatchObject({
      kind: 'push',
    })
  })

  it('云端有但云端那份没再动过 → 推上去（改动没丢）', () => {
    // doc.updatedAt <= syncedAt：云端自我上次对齐后没动过，本机的改动直接覆盖它
    const decision = decideKey(LOCAL, doc(T0 - 1000), meta(SEEN, T0, T0), T0, false)
    expect(decision).toMatchObject({ kind: 'push' })
  })

  it('首次同步时本机有真实数据、云端也有 → 冲突，等教师裁决（不静默覆盖）', () => {
    // Phase 9C 收紧的那一条：9B 时这里直接采纳云端，本机这份真实数据一个字节都不剩
    const decision = decideKey(LOCAL, doc(T0), undefined, T0, false)
    expect(decision).toMatchObject({ kind: 'conflict', doc: { updatedAt: T0 } })
  })

  it('已有记账（非首次）时仍按拍板口径判：云端更晚则采纳（这是明示的规则，不是静默丢弃）', () => {
    const decision = decideKey(LOCAL, doc(T0), meta(SEEN, T0 - 5000, T0 - 1000), T0, false)
    expect(decision).toMatchObject({ kind: 'adopt' })
  })
})

describe('情况 G：首次同步（这台设备还没有任何记账）', () => {
  it('两边都没有 → 什么都不做', () => {
    expect(decideKey(null, undefined, undefined, T0, true)).toMatchObject({ kind: 'skip' })
  })

  it('本机没有、云端有 → 以云端为准（新设备一登录就该看到已有数据）', () => {
    expect(decideKey(null, doc(T0), undefined, T0, true)).toMatchObject({ kind: 'adopt' })
  })

  it('本机只有初始化内容、云端有 → 以云端为准，而不是把示例推上去', () => {
    expect(decideKey(LOCAL, doc(T0), undefined, T0, true)).toMatchObject({ kind: 'adopt' })
  })

  it('本机已有真实数据、云端也有 → 冲突（既不推也不采纳）', () => {
    expect(decideKey(LOCAL, doc(T0), undefined, T0, false)).toMatchObject({ kind: 'conflict' })
  })
})

describe('纯函数：同样的输入给同样的结果，且不碰传进来的那份文档', () => {
  it('调用两次结果一致', () => {
    const args = [LOCAL, doc(T0), meta(SEEN, T0 - 5000, T0 - 1000), T0, false] as const
    expect(decideKey(...args)).toEqual(decideKey(...args))
  })

  it('判成采纳时给出的是同一个文档对象（不是复制品），且文档本身没被改写', () => {
    const remote = doc(T0)
    const decision = decideKey(LOCAL, remote, meta(SEEN, T0 - 5000, T0 - 1000), T0, false)
    expect(decision.kind).toBe('adopt')
    if (decision.kind === 'adopt') expect(decision.doc).toBe(remote)
    expect(remote).toEqual({ key: KEY, payload: REMOTE_PAYLOAD, updatedAt: T0 })
  })

  it('判成冲突时同样不复制、不改写云端那份（教师做选择时拿到的就是它）', () => {
    const remote = doc(T0)
    const decision = decideKey(LOCAL, remote, undefined, T0, false)
    expect(decision.kind).toBe('conflict')
    if (decision.kind === 'conflict') expect(decision.doc).toBe(remote)
  })
})
