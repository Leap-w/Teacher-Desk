/**
 * 存储层的不变量（Phase 9C §五）。
 *
 * 两条都是**承重**的，坏掉的后果都不是「不好用」而是「数据被悄悄盖掉」：
 *
 * 1. **写盘幂等**：内容没变 → 不写盘、返回 `false`、不广播。跨标签页同步靠它终止回声——
 *    少了它，两个入口收到对方的消息就各写一次盘、各广播一次，来回乒乓；
 * 2. **唯一出口**：全应用只有 `services/storage.ts` 碰 `localStorage`。绕过去的写入
 *    不会被登记写盘时刻、不会被同步看见，在界面上完全看不出来。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import { FakeBroadcastChannel, installFakeBrowser, type FakeBrowser } from './helpers/env'
import { appConfig } from '@/config'
import { lastWriteAt, localStoragePort, readRaw, writeJSON } from '@/services/storage'
import { applySyncKeys, syncPersisted, syncSubscriberCount, syncedKeys } from '@/services/sync'

let browser: FakeBrowser
let seq = 0

/** 每个用例用一个新的键：`sync.ts` 的订阅表是模块级的，同一个键注册两次会互相干扰 */
function freshKey(): string {
  seq += 1
  return `${appConfig.storageKeyPrefix}:test${seq}`
}

function postedMessages(): unknown[] {
  return FakeBroadcastChannel.all.flatMap((channel) => channel.posted)
}

beforeEach(() => {
  browser = installFakeBrowser()
})

describe('writeJSON：内容没变就不写盘（跨标签页不乒乓的前提）', () => {
  it('第一次写入 → 写盘一次、返回 true', () => {
    const key = freshKey()
    browser.localStorage.resetCounters()

    expect(writeJSON(key, [{ id: 'a' }])).toBe(true)
    // 数据键写一次（另有一次是存储层自己的「写盘时刻」表，不算数据写入）
    expect(browser.localStorage.writesFor(key)).toBe(1)
    expect(readRaw(key)).toBe(JSON.stringify([{ id: 'a' }]))
  })

  it('内容相同的第二次写入 → 不写盘、返回 false', () => {
    const key = freshKey()
    writeJSON(key, [{ id: 'a' }])
    browser.localStorage.resetCounters()

    expect(writeJSON(key, [{ id: 'a' }])).toBe(false)
    expect(browser.localStorage.writesFor(key)).toBe(0)
  })

  it('深层相同但不是同一个对象 → 仍然不写盘（比的是序列化后的原文）', () => {
    const key = freshKey()
    writeJSON(key, [{ id: 'a', profile: { name: '张三' } }])
    browser.localStorage.resetCounters()

    expect(writeJSON(key, [{ id: 'a', profile: { name: '张三' } }])).toBe(false)
    expect(browser.localStorage.writesFor(key)).toBe(0)
  })

  it('内容变了 → 写盘一次、返回 true', () => {
    const key = freshKey()
    writeJSON(key, [{ id: 'a' }])
    browser.localStorage.resetCounters()

    expect(writeJSON(key, [{ id: 'a' }, { id: 'b' }])).toBe(true)
    expect(browser.localStorage.writesFor(key)).toBe(1)
  })

  it('幂等写不更新「最后写盘时刻」：它记的是盘上内容最后一次变化的时刻', () => {
    const key = freshKey()
    writeJSON(key, [{ id: 'a' }])
    const written = lastWriteAt(key)
    expect(written).not.toBeNull()

    writeJSON(key, [{ id: 'a' }])
    expect(lastWriteAt(key)).toBe(written)
  })

  it('删除会登记写盘时刻（云端同步据此判「本机这份是什么时候动的」）', () => {
    const key = freshKey()
    writeJSON(key, [{ id: 'a' }])
    browser.localStorage.resetCounters()

    localStoragePort.remove(key)

    expect(browser.localStorage.removes).toBe(1)
    expect(readRaw(key)).toBeNull()
    expect(lastWriteAt(key)).not.toBeNull()
  })
})

describe('syncPersisted：本页改了才写盘广播，别人改了则重读且不再广播', () => {
  it('本页数据变了 → 写盘一次 + 广播一次这条键', async () => {
    const key = freshKey()
    const source = ref<unknown[]>([{ id: 'a' }])
    syncPersisted(key, source, (raw) => raw)

    expect(syncSubscriberCount(key)).toBe(1)
    expect(syncedKeys()).toContain(key)

    browser.localStorage.resetCounters()
    source.value = [{ id: 'a' }, { id: 'b' }]
    await nextTick()

    expect(browser.localStorage.writesFor(key)).toBe(1)
    expect(postedMessages()).toEqual([{ kind: 'keys', keys: [key] }])
  })

  it('赋一份内容相同的新数组 → 不写盘、不广播（回声在这里终止）', async () => {
    const key = freshKey()
    const source = ref<unknown[]>([{ id: 'a' }])
    syncPersisted(key, source, (raw) => raw)
    // 盘上先有这一份（store 载入后写过一次），才有「回声」可言
    source.value = [{ id: 'a' }]
    await nextTick()

    browser.localStorage.resetCounters()
    source.value = [{ id: 'a' }]
    await nextTick()

    expect(browser.localStorage.writesFor(key)).toBe(0)
    expect(postedMessages()).toEqual([])
  })

  it('嵌套字段改了也要写盘（deep watch：换座位改的是方案里的某个座位）', async () => {
    const key = freshKey()
    const source = ref<{ seats: { id: string; studentId?: string }[] }>({
      seats: [{ id: 's1' }],
    })
    // 本用例只走「本页改 → 写盘」这一半，`revive` 不会被调用（远端更新那条路在下一个用例里），
    // 因此这里只是个满足签名的转换——座位方案在真实 store 里另有自己那份 reviveSeatPlans
    syncPersisted(
      key,
      source,
      (raw) => raw as unknown as { seats: { id: string; studentId?: string }[] },
    )
    source.value = { seats: [{ id: 's1' }] }
    await nextTick()

    browser.localStorage.resetCounters()
    source.value.seats[0]!.studentId = 'stu-1'
    await nextTick()

    expect(browser.localStorage.writesFor(key)).toBe(1)
    expect(readRaw(key)).toContain('stu-1')
  })

  it('别的入口改了：重读 → 规范化 → 换内存，且本页**不写盘也不广播**（不乒乓）', async () => {
    const key = freshKey()
    const source = ref<{ id: string }[]>([{ id: 'a' }])
    syncPersisted(key, source, (raw) => raw as { id: string }[])
    source.value = [{ id: 'a' }]
    await nextTick()

    // 另一个标签页往同一份 localStorage 里写了新内容（它自己那次写盘不归本页）
    localStoragePort.write(key, JSON.stringify([{ id: 'a' }, { id: 'b' }]))
    browser.localStorage.resetCounters()

    applySyncKeys([key])
    await nextTick()

    expect(source.value).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(browser.localStorage.writesFor(key)).toBe(0)
    expect(postedMessages()).toEqual([])
  })

  it('收到「键不存在」的消息时不动内存（整批删除走 reload 消息，不走逐键对齐）', async () => {
    const key = freshKey()
    const source = ref<{ id: string }[]>([{ id: 'a' }])
    syncPersisted(key, source, (raw) => raw as { id: string }[])
    await nextTick()

    localStoragePort.remove(key)
    applySyncKeys([key])
    await nextTick()

    expect(source.value).toEqual([{ id: 'a' }])
  })
})

describe('唯一出口：全应用只有 services/storage.ts 碰 localStorage（§11.1）', () => {
  /** 剥掉注释再找：本项目注释里大量出现「localStorage」这个词，不剥掉会满屏假警报 */
  function stripComments(code: string): string {
    return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  }

  function sourceFiles(dir: string): string[] {
    const files: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        // 自检自己不算：这里本来就有一份内存版替身（helpers/env.ts）
        if (entry === '__tests__') continue
        files.push(...sourceFiles(full))
        continue
      }
      if (/\.(ts|vue)$/.test(entry)) files.push(full)
    }
    return files
  }

  it('八个 store、同步层、界面层都不直接读写 localStorage', () => {
    const root = join(process.cwd(), 'src')
    const offenders = sourceFiles(root)
      .filter((file) => relative(root, file) !== 'services/storage.ts')
      .filter((file) => /\blocalStorage\b/.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(root, file))

    expect(offenders).toEqual([])
  })
})
