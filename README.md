# trilium-theme

Trilium Notes 的**分享（share）主题** + 本地**预览/测试工具**，同一个仓库。

| 目录 | 内容 |
|---|---|
| **`theme/`** | 主题本体：`TimelyBlogTheme.ejs`（模板）/ `.css`（Tailwind v4 产物）/ `.js`（前端脚本）。构建源是 `theme/src/input.css` |
| **`dev/`** | 本地预览工具：用 ETAPI 读 Trilium 真实数据、直接渲染本地主题文件，改完存盘即见；含 6 套测试 |
| `theme/mockups/` | 设计与对比用的静态 HTML 稿 |
| `theme/PLAN.md` | 逐阶段开发记录（含踩坑与决策原因） |
| `theme/布局调参速查.md` | 布局数值的手动调整指引 |

关联的两个 Trilium 概念：**自定义分享模板**（`~shareTemplate` 指向 `TimelyBlogTheme.ejs`）、
**图标包**（Boxicons 经服务端 `iconPackCss` 注入）。

---

## 快速开始

```bash
npm install          # 依赖统一装在根，theme/ 与 dev/ 共用一份 node_modules
```

**开发主题**（两个终端）：

```bash
npm run dev          # 终端 1：Tailwind 监听 theme/src/input.css，存盘即重编译
npm start            # 终端 2：起本地预览 → http://localhost:4321/share/
```

首次使用需建 `dev/.env`（填 ETAPI token 与分享根 noteId），详见 [dev/README.md](dev/README.md)。

---

## 常用命令

> ⚠️ 所有命令都在**仓库根目录**执行（`theme/` 与 `dev/` 不再各自 `npm install`）。

| 命令 | 作用 |
|---|---|
| `npm run build` | 编译主题 CSS（`theme/src/input.css` → `theme/TimelyBlogTheme.css`，minify） |
| `npm run dev` | 同上，但 `--watch`（开发时挂着） |
| `npm start` | 起本地预览服务（默认 4321） |
| `npm run serve` | 起预览服务，并在 `dev/server.js` 改动时自动重启 |
| `npm run smoke` | 服务端渲染结果断言（默认打 4321，用 `BASE=` 换端口） |
| `npm run dom` | 在 jsdom 里执行主题 JS 验证交互（**mock 专用**） |
| `npm run unit` | 纯逻辑单测（ETAPI 客户端等，不需要起服务） |
| `npm run script-test` | `templateScript.js`（Trilium 属性变更脚本）行为测试 |
| `npm run push` | 把本地 EJS/CSS/JS 推回 Trilium 的三个 code 笔记 |
| `npm run state` | 命令行查看拉取到的笔记树（调试标签/层级） |

---

## 发布（走 CDN）

外网分享页只加载 **2 个文件**（EJS 里的 CDN `<link>` / `<script>` 引用）：

| 上传到 CDN 仓库 | 来自本地 |
|---|---|
| `Timely-Theme/timely-theme.css` | `theme/TimelyBlogTheme.css`（**需改名**） |
| `Timely-Theme/timely-theme.js` | `theme/TimelyBlogTheme.js`（**需改名**） |

⚠️ 上线前**务必先 `npm run build`** —— `theme/TimelyBlogTheme.css` 是构建产物，
不编译直接传会漏掉最新样式。

`theme/src/input.css`、`package.json`、`dev/` 都**不需要上传**（构建输入与开发工具，运行时无任何 URL 指向它们）。

---

## 两条关键约定

1. **`theme/TimelyBlogTheme.css` 是构建产物，不要直接编辑。**
   改样式请改 `theme/src/input.css`，或改 `theme/TimelyBlogTheme.ejs` 里的 class，然后 `npm run build`
   （产物里的任意值类如 `max-w-[98rem]` 由构建自动生成）。

2. **新增 / 改名模板文件，要在 `theme/src/input.css` 补一条 `@source`。**
   Tailwind 的自动全域扫描已关闭（`@import "tailwindcss" source(none)`），
   改用显式白名单 —— 否则新文件里的 class 会**静默不生成**（页面看着"没样式"，但构建不报错）。

布局相关数值（容器总宽 / 侧栏宽 / 侧栏顶边）已提成 `theme/src/input.css` 的 `:root` 变量，
改一处即全联动；对照表与手动调参步骤见 [theme/布局调参速查.md](theme/布局调参速查.md)。

---

## 仓库由来

原为两个独立仓库 —— 主题 `TimelyBlogTheme` 与预览工具 `share-tool`，
2026-10-09 用 `git subtree` 合并到本仓库的 `theme/` 与 `dev/` 两个子目录，**两侧提交历史完整保留**。
