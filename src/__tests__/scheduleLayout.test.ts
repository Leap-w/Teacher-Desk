/**
 * v3.7.6 §1：课程表页布局调整的接线自检。
 *
 * 这一轮改的不是算法，而是**东西放哪、状态是不是只剩一份**。最容易出的错都接缝上：
 *  ① 周次选择从课程表页移进设置后，两页各自留一个 `selectedWeek`——在设置里切到第 8 周，
 *     回到课程表还停在第 3 周，界面「能点」但选择悄悄丢了；
 *  ② 小组件卡片搬了位置，却顺手复制出一份连接逻辑，或把 `teacherdesk://refresh` 的
 *     跳转弄丢；
 *  ③ 卡片从课程表页删掉了，但旧文件还留在原目录，以后有人改错那一份。
 *
 * 本文件因此以**源码级断言**为主（仓库没有 jsdom），只对共享周次状态做一条运行时断言。
 */
import { existsSync, readFileSync } from 'node:fs'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeBrowser } from './helpers/env'
import { useTimetableStore } from '@/stores/timetable'

const read = (path: string) => readFileSync(path, 'utf8')

const SCHEDULE = 'src/views/Schedule/index.vue'
const SEMESTER_SETTINGS = 'src/views/My/settings/SemesterSettings.vue'
const TEACHING_SETTINGS = 'src/views/My/settings/TeachingSettings.vue'
const WIDGET_SETTINGS = 'src/views/My/settings/WidgetSettings.vue'
const WIDGET_CARD = 'src/views/My/settings/components/WidgetBridgeCard.vue'

beforeEach(() => {
  installFakeBrowser()
  setActivePinia(createPinia())
})

describe('周次状态只有一份，选择入口在设置里', () => {
  it('课程表页读 timetable store 的共享周次，不再自己维护 ref', () => {
    const page = read(SCHEDULE)
    expect(page).toContain('timetableStore.selectedWeek')
    expect(page).not.toContain('const selectedWeek = ref')
    expect(page).not.toContain('class="week-bar"')
    expect(page).not.toContain('v-model="selectedWeek"')
  })

  it('课程表页仍保留直达周次设置的入口（能力没被藏起来）', () => {
    expect(read(SCHEDULE)).toContain('/my/settings/teaching/semester')
  })

  it('学期设置页提供上一周 / 下一周 / 下拉 / 回到本周，并且写的是共享状态', () => {
    const page = read(SEMESTER_SETTINGS)
    expect(page).toContain('timetable.setSelectedWeek')
    expect(page).toContain('timetable.stepSelectedWeek')
    expect(page).toContain('timetable.goToCurrentWeek')
    expect(page).toContain('weekOptions')
    expect(page).toContain('回到本周')
  })

  it('运行时：设置页改的周次就是课程表页读的周次', () => {
    const store = useTimetableStore()
    store.setSelectedWeek(3)
    expect(store.selectedWeek).toBe(3)
    store.stepSelectedWeek(1)
    expect(store.selectedWeek).toBe(4)
    store.goToCurrentWeek()
    expect(store.selectedWeek).toBe(store.currentWeek ?? 1)
  })
})

describe('macOS 小组件卡片整体移入设置', () => {
  it('课程表页不再渲染小组件卡片', () => {
    expect(read(SCHEDULE)).not.toContain('WidgetBridgeCard')
  })

  it('设置页用原组件，不复制一套连接逻辑', () => {
    expect(read(TEACHING_SETTINGS)).toContain('/my/settings/teaching/widget')
    expect(read(WIDGET_SETTINGS)).toContain('<WidgetBridgeCard />')

    const card = read(WIDGET_CARD)
    // 连接 / 同步刷新 / 下载 / 复制路径这些原有能力都还在
    expect(card).toContain('openWidgetHostRefresh')
    expect(card).toContain('WIDGET_SNAPSHOT_PATH')
    expect(card).toContain('navigator.clipboard.writeText')
    expect(card).toContain('widget.download()')
    expect(card).toContain('widget.disconnect()')
  })

  it('旧位置不再留副本，路由指向新设置页', () => {
    expect(existsSync('src/views/Schedule/components/WidgetBridgeCard.vue')).toBe(false)
    const routes = read('src/router/routes.ts')
    expect(routes).toContain("path: '/my/settings/teaching/widget'")
    expect(routes).toContain("import('@/views/My/settings/WidgetSettings.vue')")
  })
})
