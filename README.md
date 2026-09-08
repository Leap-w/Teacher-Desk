# TeacherDesk

面向高中班主任的综合工作台（Web / PWA，本地优先）。以班级日常事务为核心，逐步覆盖学生档案、座位编排、课程表、请假审批、值日管理、周末管理等场景；后端规划腾讯云 CloudBase + PostgreSQL，后续支持 macOS Widget。

> **开发交接**：当前状态、业务规则、技术架构与开发规范的详细说明见 [docs/开发手册.md](docs/开发手册.md)；阶段规划见 [docs/roadmap.md](docs/roadmap.md)。

## 当前进度

| 阶段         | 内容                                                     | 状态   |
| ------------ | -------------------------------------------------------- | ------ |
| Phase 0      | 基础架构：Vite / 路由 / 布局 / 主题 / PWA / 规范         | ✅     |
| Phase 1      | UI Kit 设计系统（Tokens + 基础组件）+ 页面骨架           | ✅     |
| Phase 2      | 学生档案 MVP（模型 / Store / 列表 / 详情 / 表单）        | ✅     |
| Phase 2 增量 | 家庭地址、家庭所在地、返家范围（数据基础）               | ✅     |
| Phase 2.1    | 学生档案模型收敛：清理 boarding 遗留（统一住校）         | ✅     |
| Phase 3      | 排座 / 座位管理                                          | 规划中 |
| Phase 4+     | 课程表 / 请假 / 值日 / 周末管理 / 仪表盘 / 后端 / Widget | 规划中 |

学生档案已完成：搜索与筛选、重名学生区分、详情 / 新增 / 编辑弹窗、软删除、学号唯一性（表单 + Store 双层）、家庭地址与返家范围数据模型（为未来周末管理打底）。数据当前保存在浏览器 localStorage，后端尚未接入。

## 技术栈

| 类别       | 选型                                           |
| ---------- | ---------------------------------------------- |
| 框架       | Vue 3.5 + TypeScript 5.8（strict）             |
| 构建       | Vite 7                                         |
| 路由       | Vue Router 4                                   |
| 状态管理   | Pinia 3                                        |
| 原子化 CSS | UnoCSS（presetWind3，主题对接 theme.css 变量） |
| PWA        | vite-plugin-pwa（autoUpdate）                  |
| 代码规范   | ESLint 9（flat）+ Prettier 3                   |

组件全部自行封装（不引入 UI 组件库），Apple 风格：主题色松石青 `#2F8F83`、16px 圆角、毛玻璃、柔和阴影。Design Tokens 统一维护在 `src/styles/theme.css`。

## 启动方式

```bash
# 安装依赖（Node.js >= 20.19）
npm install

# 本地开发（http://localhost:5173）
npm run dev
```

常用命令：

```bash
npm run dev         # 开发服务器
npm run type-check  # TypeScript 类型检查（vue-tsc --noEmit）
npm run lint        # ESLint 检查并自动修复
npm run format      # Prettier 格式化
npm run build       # 类型检查 + 生产构建
npm run preview     # 预览生产构建（验证 PWA 安装用）
```

## 基础组件（`src/components/ui/`）

AppCard / AppButton / AppInput / AppTextarea / AppSelect / AppField / AppBadge / AppModal / AppToast / EmptyState，统一由 `@/components/ui` 出口导入。

全局通知（AppToast 已在 `App.vue` 挂载）：

```ts
import { useToast } from '@/composables/useToast'
const toast = useToast()
toast.success('保存成功')
toast.danger('同步失败，请重试')
```

## 目录结构

```
TeacherDesk/
├── docs/               # 开发手册（交接主文档）+ 路线图
├── public/             # PWA SVG 图标占位（favicon / icon / icon-maskable）
├── src/
│   ├── components/
│   │   ├── ui/         # 通用基础组件
│   │   └── layout/     # AppHeader / Sidebar / PagePlaceholder
│   ├── composables/    # useToast / useToday
│   ├── config/         # appConfig（存储键前缀等）
│   ├── constants/      # Toast 时长与堆栈上限
│   ├── router/         # 路由（侧边导航由此驱动）
│   ├── services/       # mock 种子数据 + api 占位（后端接入预留）
│   ├── stores/         # app（占位同步）/ student（学生领域）
│   ├── styles/         # theme.css 设计变量 + 全局样式
│   ├── types/          # 全部共享类型
│   ├── utils/          # date / id / student 工具
│   ├── views/          # Home / Students（唯一完成模块）/ Seats / Schedule / Leave / Duty / Toolbox
│   ├── App.vue
│   └── main.ts
└── package.json
```

## PWA

manifest 与 Service Worker 已配置（autoUpdate），生产构建后可安装。图标当前为 SVG 占位，正式 PNG 图标列入后续规划。
