/**
 * 学生照片元数据仓储（v3.8.0 · Phase 1B）。
 *
 * 数据源：`teacherdesk:studentPhotos`（**本次新增的键**，一份数组装全部照片元数据）。
 *
 * ## 不播种、读不到键不写盘
 *
 * 与假期 / 班费 / 违纪同一处置：照片元数据是教师自己录入的业务数据，凭空造示例照片
 * 只会让人以为程序出错；「键不存在 = 这台设备还没有照片数据」也是云同步第一次对齐时
 * 「采纳云端」的前提（加载时顺手写 `[]` 会与云端真实数据撞成首次同步冲突）。
 *
 * ## 这里装的是**元数据**，不是照片
 *
 * 图片二进制在 IndexedDB（本机）与 CloudBase 云存储（云端），本键里只有纯 JSON。
 * `reviveStudentPhotos` 会剔除 Blob/Base64/签名 URL 之类字段并保留未来版本的未知字段，
 * 因此任何一次写盘 / 云同步 payload / JSON 备份都不会带图片内容。
 */
import { appConfig } from '@/config'
import { reviveStudentPhotos } from '@/utils/studentPhoto'
import type { StudentPhoto } from '@/types/studentPhoto'

import { localStorageAdapter } from '../adapters/LocalStorageAdapter'
import { createCollectionRepository } from '../base/createCollectionRepository'

const STUDENT_PHOTOS_KEY = `${appConfig.storageKeyPrefix}:studentPhotos`

const repository = createCollectionRepository<StudentPhoto[]>({
  key: STUDENT_PHOTOS_KEY,
  adapter: localStorageAdapter,
  reviveList: reviveStudentPhotos,
})

export { STUDENT_PHOTOS_KEY }

export const studentPhotoRepository = {
  ...repository,

  /**
   * 读照片元数据；键不存在（这台设备还没有照片）或内容损坏时都返回空数组，
   * 且**一个字节都不写盘**。
   */
  load(): StudentPhoto[] {
    return repository.load() ?? []
  },
}
