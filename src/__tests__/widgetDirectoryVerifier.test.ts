/**
 * 网页端目录身份验证器自检（v3.7.8 P2）。
 *
 * 这一层盯的是**「明明没验过却说验过了」**：验证结论一旦误判，网页就会把快照写进
 * 一个小组件永远读不到的目录，而且界面显示「已连接」——错得安静。
 *
 * 所以每条都钉住「什么情况必须不通过」：
 *  ① 只有「protocol + type + nonce + ok === true」四件全对才算成功；
 *  ② 响应 nonce 不一致 / 协议不符 → 当场拒绝，不重试；
 *  ③ 12 秒没等到 → timeout（**不等于选错目录**，也不等于授权失败）；
 *  ④ 取消 / 重复请求 / 并发 → 互不串线；
 *  ⑤ 非法 nonce 一个文件都不碰。
 *
 * 时间与宿主唤起都是注入的，所以 12 秒超时在这里是瞬间跑完的。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildVerifyRequest,
  createWidgetDirectoryVerifier,
  isValidVerifyNonce,
  parseVerifyResponse,
  verifyRequestFileName,
  verifyResponseFileName,
  verifyWidgetDirectory,
  WIDGET_VERIFY_POLL_INTERVAL_MS,
  WIDGET_VERIFY_PROTOCOL,
  WIDGET_VERIFY_REQUEST_TYPE,
  WIDGET_VERIFY_RESPONSE_TYPE,
  WIDGET_VERIFY_TIMEOUT_MS,
  type WidgetVerifyDirectoryHandle,
  type WidgetVerifyEnvironment,
} from '@/services/widgetDirectoryVerifier'

const NONCE = '8f1c2d4e-0a1b-4c2d-9e3f-5a6b7c8d9e0f'

function notFound() {
  return Object.assign(new Error('A requested file or directory could not be found.'), {
    name: 'NotFoundError',
  })
}

/** 假时钟：`sleep` 直接推进时间，于是 12 秒超时瞬间跑完 */
function makeClock(start = 0) {
  let value = start
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms
    },
    get value() {
      return value
    },
  }
}

/** 假目录：只实现验证器真正用到的那几个能力 */
function fakeDirectory(files = new Map<string, string>()) {
  const directory: WidgetVerifyDirectoryHandle & {
    files: Map<string, string>
    writes: string[]
    failWrites: boolean
    failRemoval: boolean
    /** 让 `getFile().text()` 抛非 NotFound 的错（模拟读取被拒绝） */
    failReads: boolean
  } = {
    name: 'TeacherDesk',
    files,
    writes: [],
    failWrites: false,
    failRemoval: false,
    failReads: false,
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name)) {
        if (!options?.create) throw notFound()
        files.set(name, '')
      }
      return {
        async createWritable() {
          let buffer = ''
          return {
            async write(data: string) {
              buffer += data
            },
            async close() {
              if (directory.failWrites) {
                throw Object.assign(new Error('写入被拒绝'), { name: 'NotAllowedError' })
              }
              files.set(name, buffer)
              directory.writes.push(name)
            },
          }
        },
        async getFile() {
          return {
            async text() {
              if (directory.failReads) {
                throw Object.assign(new Error('读取被拒绝'), { name: 'NotReadableError' })
              }
              const value = files.get(name)
              if (value === undefined) throw notFound()
              return value
            },
          }
        },
      }
    },
    async removeEntry(name: string) {
      if (directory.failRemoval) {
        throw Object.assign(new Error('删除被拒绝'), { name: 'NotAllowedError' })
      }
      if (!files.has(name)) throw notFound()
      files.delete(name)
    },
  }
  return directory
}

function okResponse(nonce = NONCE): string {
  return JSON.stringify({
    protocol: WIDGET_VERIFY_PROTOCOL,
    type: WIDGET_VERIFY_RESPONSE_TYPE,
    nonce,
    ok: true,
    respondedAt: '2026-11-13T07:00:53.583Z',
    detail: '容器目录与选中目录一致',
  })
}

function failResponse(nonce = NONCE, errorCode = 'request-missing'): string {
  return JSON.stringify({
    protocol: WIDGET_VERIFY_PROTOCOL,
    type: WIDGET_VERIFY_RESPONSE_TYPE,
    nonce,
    ok: false,
    respondedAt: '2026-11-13T07:00:53.583Z',
    errorCode,
    detail: '容器里没有本次 nonce 的请求文件',
  })
}

/** 注入环境：固定 nonce、假时钟、记录唤起 */
function makeEnvironment(
  clock: ReturnType<typeof makeClock>,
  overrides: Partial<WidgetVerifyEnvironment> = {},
) {
  const notified: string[] = []
  const sleeps: number[] = []
  const environment: Partial<WidgetVerifyEnvironment> = {
    supported: () => true,
    createNonce: () => NONCE,
    notifyHost: (nonce: string) => {
      notified.push(nonce)
    },
    now: clock.now,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      clock.advance(ms)
    },
    ...overrides,
  }
  return { environment, notified, sleeps }
}

let clock: ReturnType<typeof makeClock>

beforeEach(() => {
  clock = makeClock()
})

describe('请求构造', () => {
  it('字段完整、协议版本与类型正确、时间是 ISO 8601', () => {
    const at = new Date('2026-11-13T07:00:48.123Z')
    const payload = buildVerifyRequest(NONCE, at)
    expect(payload).toEqual({
      protocol: 1,
      type: WIDGET_VERIFY_REQUEST_TYPE,
      nonce: NONCE,
      createdAt: '2026-11-13T07:00:48.123Z',
    })
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload)
  })

  it('nonce 校验与原生端同口径：16…64 位、只允许字母数字连字符', () => {
    expect(isValidVerifyNonce(NONCE)).toBe(true)
    expect(isValidVerifyNonce('a'.repeat(16))).toBe(true)
    expect(isValidVerifyNonce('a'.repeat(64))).toBe(true)
    expect(isValidVerifyNonce('a'.repeat(15))).toBe(false)
    expect(isValidVerifyNonce('a'.repeat(65))).toBe(false)
    expect(isValidVerifyNonce('../../etc/passwd')).toBe(false)
    expect(isValidVerifyNonce('has space in it here')).toBe(false)
    expect(isValidVerifyNonce('has_underscore_1234')).toBe(false)
    expect(isValidVerifyNonce('')).toBe(false)
  })

  it('文件名只由 nonce 生成', () => {
    expect(verifyRequestFileName(NONCE)).toBe(`td-verify-${NONCE}.req`)
    expect(verifyResponseFileName(NONCE)).toBe(`td-verify-${NONCE}.res`)
  })
})

describe('响应解析', () => {
  it('四件全对才算成功', () => {
    expect(parseVerifyResponse(okResponse(), NONCE)).toEqual({ kind: 'ok' })
  })

  it('宿主明确失败 → rejected，带上 errorCode', () => {
    expect(parseVerifyResponse(failResponse(NONCE, 'request-expired'), NONCE)).toEqual({
      kind: 'rejected',
      errorCode: 'request-expired',
      detail: '容器里没有本次 nonce 的请求文件',
    })
  })

  it('nonce 不一致 → 拒绝（不通过、不重试）', () => {
    const parsed = parseVerifyResponse(okResponse('11111111-2222-3333-4444-555555555555'), NONCE)
    expect(parsed.kind).toBe('mismatch')
  })

  it('protocol 不是 1 → 拒绝', () => {
    const text = JSON.stringify({
      protocol: 2,
      type: WIDGET_VERIFY_RESPONSE_TYPE,
      nonce: NONCE,
      ok: true,
    })
    expect(parseVerifyResponse(text, NONCE).kind).toBe('mismatch')
  })

  it('type 不符 → 拒绝', () => {
    const text = JSON.stringify({
      protocol: 1,
      type: 'something.else',
      nonce: NONCE,
      ok: true,
    })
    expect(parseVerifyResponse(text, NONCE).kind).toBe('mismatch')
  })

  it('缺 ok / ok 不是布尔 / 不是对象 → 拒绝', () => {
    expect(
      parseVerifyResponse(
        JSON.stringify({ protocol: 1, type: WIDGET_VERIFY_RESPONSE_TYPE, nonce: NONCE }),
        NONCE,
      ).kind,
    ).toBe('mismatch')
    expect(
      parseVerifyResponse(
        JSON.stringify({
          protocol: 1,
          type: WIDGET_VERIFY_RESPONSE_TYPE,
          nonce: NONCE,
          ok: 'true',
        }),
        NONCE,
      ).kind,
    ).toBe('mismatch')
    expect(parseVerifyResponse('[1,2,3]', NONCE).kind).toBe('mismatch')
  })

  it('坏 JSON → incomplete（可以重试，不算 mismatch）', () => {
    expect(parseVerifyResponse('{"protocol":1,', NONCE).kind).toBe('incomplete')
  })

  it('失败响应缺 errorCode 时给 unknown，不当成功', () => {
    const text = JSON.stringify({
      protocol: 1,
      type: WIDGET_VERIFY_RESPONSE_TYPE,
      nonce: NONCE,
      ok: false,
    })
    const parsed = parseVerifyResponse(text, NONCE)
    expect(parsed.kind).toBe('rejected')
    expect(parsed.kind === 'rejected' && parsed.errorCode).toBe('unknown')
  })
})

describe('文件信箱', () => {
  it('先把请求写进目录，再唤起宿主（顺序不能反）', async () => {
    const directory = fakeDirectory()
    const { environment, notified } = makeEnvironment(clock)

    const result = await verifyWidgetDirectory({ handle: directory, environment })

    expect(result.status).toBe('timeout') // 没有宿主响应
    expect(notified).toEqual([NONCE])
    // 请求文件已经写过（随后被清理）
    expect(directory.writes).toEqual([verifyRequestFileName(NONCE)])
  })

  it('请求报文内容与协议一致', async () => {
    const directory = fakeDirectory()
    const captured: string[] = []
    const { environment } = makeEnvironment(clock, {
      sleep: async (ms: number) => {
        // 只抓第一次（此刻请求文件刚写完），随后照常推进时间，避免死循环
        if (captured.length === 0) {
          captured.push(directory.files.get(verifyRequestFileName(NONCE)) ?? '')
        }
        clock.advance(ms)
      },
    })

    await verifyWidgetDirectory({ handle: directory, environment })

    const payload = JSON.parse(captured[0]!)
    expect(payload).toMatchObject({
      protocol: 1,
      type: WIDGET_VERIFY_REQUEST_TYPE,
      nonce: NONCE,
    })
    expect(new Date(payload.createdAt).toISOString()).toBe(payload.createdAt)
  })

  it('响应在第二次轮询出现 → verified', async () => {
    const directory = fakeDirectory()
    let ticks = 0
    const { environment } = makeEnvironment(clock, {
      sleep: async (ms: number) => {
        clock.advance(ms)
        ticks += 1
        if (ticks === 2) directory.files.set(verifyResponseFileName(NONCE), okResponse())
      },
    })

    const result = await verifyWidgetDirectory({ handle: directory, environment })
    expect(result).toEqual({ status: 'verified', nonce: NONCE })
  })

  it('宿主回失败响应 → failed(rejected) 并带上 errorCode', async () => {
    const directory = fakeDirectory(
      new Map([[verifyResponseFileName(NONCE), failResponse(NONCE, 'request-missing')]]),
    )
    const { environment } = makeEnvironment(clock)

    const result = await verifyWidgetDirectory({ handle: directory, environment })
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.reason).toBe('rejected')
    expect(result.status === 'failed' && result.errorCode).toBe('request-missing')
  })

  it('结束后清掉自己的两个临时文件', async () => {
    const directory = fakeDirectory()
    let ticks = 0
    const { environment } = makeEnvironment(clock, {
      sleep: async (ms: number) => {
        clock.advance(ms)
        ticks += 1
        if (ticks === 1) directory.files.set(verifyResponseFileName(NONCE), okResponse())
      },
    })

    await verifyWidgetDirectory({ handle: directory, environment })
    expect(directory.files.has(verifyRequestFileName(NONCE))).toBe(false)
    expect(directory.files.has(verifyResponseFileName(NONCE))).toBe(false)
  })

  it('清理失败不改变已确定的结论', async () => {
    const directory = fakeDirectory(new Map([[verifyResponseFileName(NONCE), okResponse()]]))
    directory.failRemoval = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { environment } = makeEnvironment(clock)

    const result = await verifyWidgetDirectory({ handle: directory, environment })
    expect(result.status).toBe('verified')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('轮询中 sleep 抛意外异常 → 仍然清理本次文件，异常向上抛', async () => {
    const directory = fakeDirectory()
    const { environment } = makeEnvironment(clock, {
      sleep: async () => {
        throw new Error('boom')
      },
    })

    await expect(verifyWidgetDirectory({ handle: directory, environment })).rejects.toThrow('boom')
    // v3.7.8 P3.3：整体 try/finally 保证异常路径也清理
    expect(directory.files.has(verifyRequestFileName(NONCE))).toBe(false)
    expect(directory.files.has(verifyResponseFileName(NONCE))).toBe(false)
  })

  it('响应读取抛非 NotFound 错误 → read-error，且清理本次文件', async () => {
    const directory = fakeDirectory(new Map([[verifyResponseFileName(NONCE), okResponse()]]))
    directory.failReads = true
    const { environment } = makeEnvironment(clock)

    const result = await verifyWidgetDirectory({ handle: directory, environment })
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.reason).toBe('read-error')
    expect(result.status === 'failed' && result.errorName).toBe('NotReadableError')
    // 请求与响应都属于本次 nonce，一起清掉
    expect(directory.files.size).toBe(0)
  })

  it('请求写不进去 → request-write-failed，且**不唤起宿主**', async () => {
    const directory = fakeDirectory()
    directory.failWrites = true
    const { environment, notified } = makeEnvironment(clock)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await verifyWidgetDirectory({ handle: directory, environment })
    warn.mockRestore()

    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.reason).toBe('request-write-failed')
    expect(result.status === 'failed' && result.errorName).toBe('NotAllowedError')
    // v3.7.8 P3：带出卡在哪一步（这里是 close），便于区分「句柄失效」与「权限被收回」
    expect(result.status === 'failed' && result.stage).toBe('close')
    expect(notified).toEqual([])
  })

  it('句柄已失效（getFileHandle 就抛 NotFoundError）→ stage 指到第一步', async () => {
    const stale = {
      name: 'TeacherDesk',
      async getFileHandle(): Promise<never> {
        throw notFound()
      },
      async removeEntry() {},
    }
    const { environment } = makeEnvironment(clock)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await verifyWidgetDirectory({ handle: stale, environment })
    warn.mockRestore()

    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.errorName).toBe('NotFoundError')
    expect(result.status === 'failed' && result.stage).toBe('getFileHandle')
  })

  it('唤起宿主抛异常 → host-not-reached，不谎报成功', async () => {
    const directory = fakeDirectory()
    const { environment } = makeEnvironment(clock, {
      notifyHost: () => {
        throw Object.assign(new Error('scheme 没有处理器'), { name: 'NotAllowedError' })
      },
    })

    const result = await verifyWidgetDirectory({ handle: directory, environment })
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.reason).toBe('host-not-reached')
  })
})

describe('轮询', () => {
  it('每 300ms 一次、总共等 12 秒', async () => {
    const directory = fakeDirectory()
    const { environment, sleeps } = makeEnvironment(clock)

    const result = await verifyWidgetDirectory({ handle: directory, environment })

    expect(result.status).toBe('timeout')
    expect(sleeps.every((ms) => ms === WIDGET_VERIFY_POLL_INTERVAL_MS)).toBe(true)
    expect(clock.value).toBe(WIDGET_VERIFY_TIMEOUT_MS)
    expect(sleeps).toHaveLength(WIDGET_VERIFY_TIMEOUT_MS / WIDGET_VERIFY_POLL_INTERVAL_MS)
  })

  it('中途取消 → cancelled，并清掉临时文件', async () => {
    const directory = fakeDirectory()
    const controller = new AbortController()
    let ticks = 0
    const { environment } = makeEnvironment(clock, {
      sleep: async (ms: number) => {
        clock.advance(ms)
        ticks += 1
        if (ticks === 3) controller.abort()
      },
    })

    const result = await verifyWidgetDirectory({
      handle: directory,
      signal: controller.signal,
      environment,
    })
    expect(result).toEqual({ status: 'cancelled', nonce: NONCE })
    expect(directory.files.has(verifyRequestFileName(NONCE))).toBe(false)
  })

  it('不完整的响应可以有限重试，写完整后通过', async () => {
    const directory = fakeDirectory()
    let ticks = 0
    const { environment } = makeEnvironment(clock, {
      sleep: async (ms: number) => {
        clock.advance(ms)
        ticks += 1
        const name = verifyResponseFileName(NONCE)
        if (ticks === 1) directory.files.set(name, '{"protocol":1,')
        if (ticks === 2) directory.files.set(name, '{"protocol":1,"type":"')
        if (ticks === 3) directory.files.set(name, okResponse())
      },
    })

    const result = await verifyWidgetDirectory({ handle: directory, environment })
    expect(result.status).toBe('verified')
  })

  it('连续三次读不出合法响应 → bad-response', async () => {
    const directory = fakeDirectory(new Map([[verifyResponseFileName(NONCE), 'not json']]))
    const { environment } = makeEnvironment(clock)

    const result = await verifyWidgetDirectory({ handle: directory, environment })
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.reason).toBe('bad-response')
  })

  it('**旧 nonce 的响应不能通过**（文件名对、内容错）', async () => {
    const directory = fakeDirectory(
      new Map([
        [verifyResponseFileName(NONCE), okResponse('00000000-1111-2222-3333-444444444444')],
      ]),
    )
    const { environment } = makeEnvironment(clock)

    const result = await verifyWidgetDirectory({ handle: directory, environment })
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.reason).toBe('bad-response')
  })

  it('并发两次互不干扰（各自读自己的响应）', async () => {
    const first = fakeDirectory(new Map([[verifyResponseFileName(NONCE), okResponse()]]))
    const otherNonce = '99999999-8888-7777-6666-555555555555'
    const second = fakeDirectory(
      new Map([[verifyResponseFileName(otherNonce), failResponse(otherNonce, 'request-missing')]]),
    )

    const envOne = makeEnvironment(clock).environment
    const envTwo = makeEnvironment(clock, { createNonce: () => otherNonce }).environment

    const [a, b] = await Promise.all([
      verifyWidgetDirectory({ handle: first, environment: envOne }),
      verifyWidgetDirectory({ handle: second, environment: envTwo }),
    ])

    expect(a.status).toBe('verified')
    expect(b.status).toBe('failed')
  })
})

describe('会话：重复请求与取消', () => {
  it('新的验证会取消上一次（旧请求不生效）', async () => {
    const directory = fakeDirectory()
    const { environment } = makeEnvironment(clock, {
      sleep: async (ms: number) => {
        clock.advance(ms) // 永远等不到响应
      },
    })
    const session = createWidgetDirectoryVerifier(environment)

    const firstRun = session.verify(directory)
    expect(session.running).toBe(true)
    const secondRun = session.verify(directory)

    const [first, second] = await Promise.all([firstRun, secondRun])
    expect(first.status).toBe('cancelled')
    expect(second.status).toBe('timeout')
  })

  it('cancel() 能中止进行中的验证', async () => {
    const directory = fakeDirectory()
    const { environment } = makeEnvironment(clock, {
      sleep: async (ms: number) => {
        clock.advance(ms)
        session.cancel()
      },
    })
    const session = createWidgetDirectoryVerifier(environment)

    const result = await session.verify(directory)
    expect(result.status).toBe('cancelled')
    expect(session.running).toBe(false)
  })
})

describe('安全性', () => {
  it('生成的 nonce 不合法 → invalid-nonce，且一个文件都不碰', async () => {
    const directory = fakeDirectory()
    const { environment, notified } = makeEnvironment(clock, {
      createNonce: () => '../../etc/passwd',
    })

    const result = await verifyWidgetDirectory({ handle: directory, environment })
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.reason).toBe('invalid-nonce')
    expect(directory.files.size).toBe(0)
    expect(directory.writes).toEqual([])
    expect(notified).toEqual([])
  })

  it('浏览器不支持 → unsupported，不写文件', async () => {
    const directory = fakeDirectory()
    const { environment } = makeEnvironment(clock, { supported: () => false })

    const result = await verifyWidgetDirectory({ handle: directory, environment })
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.reason).toBe('unsupported')
    expect(directory.writes).toEqual([])
  })
})
