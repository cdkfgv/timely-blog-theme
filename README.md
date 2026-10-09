# timely-blog-theme

Trilium Notes 的**分享（share）主题** `TimelyBlogTheme` + 本地**预览/测试工具**，同一个仓库。

| 目录 | 内容 |
|---|---|
| **`theme/`** | 主题本体：`TimelyBlogTheme.ejs`（模板）/ `.css`（Tailwind v4 产物）/ `.js`（手写前端脚本）。构建源是 `theme/src/input.css` |
| **`dev/`** | 本地预览工具：用 ETAPI 读 Trilium 真实数据、直接渲染本地主题文件，改完存盘即见；含 6 套测试 |
| **`dist/`** | **发布产物**（`npm run build` 生成，已压缩、已按 CDN 命名）：`timely-theme.css` / `timely-theme.js`。不进版本库 |
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
| `npm run build` | **发布用**：编译 CSS + 压缩 JS → `dist/`（两步串联，传前跑这个） |
| `npm run build:css` | 只编译主题 CSS（`theme/src/input.css` → `theme/TimelyBlogTheme.css`，minify） |
| `npm run dist` | 只压缩打包 → `dist/`（假定 CSS 已是最新） |
| `npm run dev` | 同 `build:css`，但 `--watch`（开发时挂着） |
| `npm start` | 起本地预览服务（默认 4321） |
| `npm run serve` | 起预览服务，并在 `dev/server.js` 改动时自动重启 |
| `npm run smoke` | 服务端渲染结果断言（默认打 4321，用 `BASE=` 换端口） |
| `npm run dom` | 在 jsdom 里执行主题 JS（`theme/` 手写源）验证交互（**mock 专用**） |
| `npm run dom:dist` | 同上，但执行 `dist/` 里的**压缩产物** —— 证明压缩没改变行为 |
| `npm run unit` | 纯逻辑单测（ETAPI 客户端等，不需要起服务） |
| `npm run script-test` | `templateScript.js`（Trilium 属性变更脚本）行为测试 |
| `npm run push` | 把本地 EJS/CSS/JS 推回 Trilium 的三个 code 笔记 |
| `npm run state` | 命令行查看拉取到的笔记树（调试标签/层级） |

---

## 发布（走 CDN）

外网分享页只加载 **2 个文件**（EJS 里的 CDN `<link>` / `<script>` 引用）：

```bash
npm run build      # ① 编译 CSS + 压缩 JS，产出 dist/
```

然后把这两个文件原样上传（**文件名已经对了，不用再改名**）：

| 上传到 CDN 仓库 | 来自本地 |
|---|---|
| `Timely-Theme/timely-theme.css` | `dist/timely-theme.css`（≈49.7 KB / gzip 9.4 KB） |
| `Timely-Theme/timely-theme.js` | `dist/timely-theme.js`（≈10.4 KB / gzip 3.9 KB） |

⚠️ 上线前**务必先 `npm run build`** —— `theme/TimelyBlogTheme.css` 与 `dist/` 都是构建产物，
不编译直接传会漏掉最新样式。

`theme/src/input.css`、`package.json`、`dev/` 都**不需要上传**（构建输入与开发工具，运行时无任何 URL 指向它们）。

### 压缩是怎么做的

| 文件 | 工具 | 说明 |
|---|---|---|
| `dist/timely-theme.css` | Tailwind 自带（lightningcss） | 由 `build:css` 的 `--minify` 完成，`dist` 阶段**原样拷贝**，保证与 `theme/TimelyBlogTheme.css` 逐字节一致 |
| `dist/timely-theme.js` | **terser**（`ecma: 5` + `mangle` + 3 轮 compress） | 手写源保持 ES5，产物同样 ES5 兼容；约 19.8 KB → 10.4 KB（**省约 48%**） |

`dev/tools/build-dist.js` 自带守卫，任一不过就非零退出（**别把坏产物传上 CDN**）：
CSS 必须是压缩产物、JS 压缩后语法必须可解析 / 体积必须变小 / EJS 与 CSS 依赖的 9 个选择器字面量必须全部存活。

---

## 两条关键约定

1. **`theme/TimelyBlogTheme.css` 与 `dist/` 都是构建产物，不要直接编辑。**
   改样式请改 `theme/src/input.css`，或改 `theme/TimelyBlogTheme.ejs` 里的 class，然后 `npm run build`
   （产物里的任意值类如 `max-w-[98rem]` 由构建自动生成）。
   开发期挂 `npm run dev` 即可，预览读的是 `theme/` 下的未压缩文件（**dist/ 只有 `npm run build` 才刷新**）。

2. **新增 / 改名模板文件，要在 `theme/src/input.css` 补一条 `@source`。**
   Tailwind 的自动全域扫描已关闭（`@import "tailwindcss" source(none)`），
   改用显式白名单 —— 否则新文件里的 class 会**静默不生成**（页面看着"没样式"，但构建不报错）。

布局相关数值（容器总宽 / 侧栏宽 / 侧栏顶边）已提成 `theme/src/input.css` 的 `:root` 变量，
改一处即全联动；对照表与手动调参步骤见 [theme/布局调参速查.md](theme/布局调参速查.md)。

---

## 仓库由来

原为两个独立仓库 —— 主题 `TimelyBlogTheme` 与预览工具 `share-tool`，
2026-10-09 用 `git subtree` 合并到本仓库的 `theme/` 与 `dev/` 两个子目录，**两侧提交历史完整保留**；
随后仓库由 `trilium-theme` 更名为 `timely-blog-theme`（与 CDN 仓库 `cdkfgv/timely-theme` 的命名对齐）。
