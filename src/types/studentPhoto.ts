/**
 * 学生照片领域类型（v3.8.0 · Phase 1B 数据层）。
 *
 * ## 边界
 *
 * - **元数据**（本文件描述的结构）住在 `localStorage` 的 `teacherdesk:studentPhotos`，
 *   随现有 Repository / 跨标签页广播 / 云同步 / JSON 备份走（与其余业务数据同一套机制）。
 * - **图片二进制**住在独立的 IndexedDB 库 `teacherdesk-media`，或 CloudBase 云存储对象里，
 *   **绝不进入元数据数组**：不放 Blob / ArrayBuffer / Base64 / dataURL / 签名 URL。
 *   这一条由 `utils/studentPhoto.ts` 的 normalize 与测试共同保证。
 * - **删除是逻辑删除**：保留记录、`deletedAt` 墓碑、`fileId`/`storagePath`；
 *   本阶段**不物理删除云端文件**（没有跨设备删除确认机制）。
 * - 照片状态（local-only / remote-only / ready / uploading / missing / deleted）**不落盘**，
 *   由「元数据 + 本机媒体实际存在性 + 上传进行中集合」实时派生（见 `deriveStudentPhotoState`）。
 *
 * 与学生的关联只认稳定 `studentId`（`Student.id`）；`studentName` 只是展示快照，
 * 改名后由 store 刷新、学生软删除后冻结（与请假 / 违纪同一口径）。
 */

/** 照片分类（明确落库，绝不靠文件名推断） */
export type StudentPhotoCategory = 'id-photo' | 'life-photo'

/**
 * 派生状态（**不落盘**）：
 * - `local-only`：本机有、云端没有（未上传 / 未登录 / 离线）；
 * - `remote-only`：云端有、本机没有（另一台设备上传的）；
 * - `ready`：本机与云端都有；
 * - `uploading`：正在上传（本机一定有原图）；
 * - `missing`：本机没有、也没有云端标识（元数据在，文件不可得）；
 * - `deleted`：已逻辑删除（墓碑，不参与正常展示）。
 */
export type StudentPhotoMediaState =
  'local-only' | 'remote-only' | 'ready' | 'uploading' | 'missing' | 'deleted'

/**
 * 一张学生照片的元数据。
 *
 * **注意**：这是"能进入 JSON 的全部内容"。图片文件本身不在这里，
 * `size/width/height` 只是**压缩后**图片的度量信息（用于容量提示与展示布局）。
 */
export interface StudentPhoto {
  /** 照片记录稳定 ID（UUID）；同时是 IndexedDB 键与云端文件名的一部分 */
  id: string
  /** 关联学生的稳定 ID（`Student.id`），**绝不用姓名关联** */
  studentId: string
  /**
   * 姓名快照（重名时带身份证尾号，口径同全站 `formatStudentShortName`）。
   * 学生改名后由 store 刷新；学生软删除后冻结在原姓名。
   */
  studentName: string
  /** 照片分类 */
  category: StudentPhotoCategory
  /**
   * 是否为「当前证件照」。
   * 只有 `id-photo` 才有意义；每名学生**至多一条**（normalize 会收敛，store 每次切换整体写）。
   * **新上传证件照不会自动成为当前证件照**——必须教师手动指定。
   */
  isCurrentIdPhoto?: boolean
  /** CloudBase 文件标识（`cloud://…`）；缺省 = 尚未上传（local-only） */
  fileId?: string
  /** 云端对象路径（`student-photos/<studentId>/<photoId>.jpg`，不含学生姓名） */
  storagePath: string
  /** 图片 MIME（重编码统一为 `image/jpeg`） */
  mimeType: string
  /** 压缩后宽度（px） */
  width: number
  /** 压缩后高度（px） */
  height: number
  /** 压缩后文件大小（字节） */
  size: number
  /** 上传时间（ISO 8601，UTC 带时区标识；业务信息，重新下载/重生成缩略图都不改它） */
  uploadedAt: string
  /** 元数据最后更新时间（ISO） */
  updatedAt: string
  /** 记录创建时间（ISO） */
  createdAt: string
  /** 逻辑删除时间（ISO）；非空 = 墓碑记录，不参与正常展示 */
  deletedAt?: string
}

/**
 * 保存照片时记录一条元数据所需的输入（由 store 在图片处理完成后组装）。
 * `id` / `uploadedAt` / `createdAt` / `updatedAt` 由 store 生成。
 */
export type StudentPhotoDraft = Omit<
  StudentPhoto,
  'id' | 'uploadedAt' | 'createdAt' | 'updatedAt' | 'deletedAt'
>

/** 照片类型中文文案（后续 UI / 备份展示共用） */
export const STUDENT_PHOTO_CATEGORY_LABELS: Record<StudentPhotoCategory, string> = {
  'id-photo': '证件照',
  'life-photo': '生活照',
}

/** 全部合法分类（normalize / 校验 / 测试共用） */
export const KNOWN_STUDENT_PHOTO_CATEGORIES: readonly StudentPhotoCategory[] = [
  'id-photo',
  'life-photo',
]
