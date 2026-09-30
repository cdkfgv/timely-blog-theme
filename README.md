# share-tool

本地模拟 **Trilium Notes 分享（share）** 渲染流程的小工具。

解决的问题：改主题（EJS / CSS / JS）时必须先复制进 Trilium 才能看效果，反馈链路过长。
现在：**本地读真实数据 → 直接渲染你的 EJS → 存盘即刷新**，调试满意后再一键推回 Trilium。

- 数据来源：Trilium 的 **ETAPI**（真实笔记树、真实标签、真实正文）
- 模板来源：本地 `TimelyBlogTheme.ejs`（每次请求重新读盘，不做缓存）
- 资源来源：本地 `TimelyBlogTheme.css / .js`（自动把 EJS 里的 CDN 地址替换成本地路径）
- 渲染管线：对齐 Trilium `share/content_renderer.ts` + `page.ejs` 的 locals 与链接改写规则

---

## 快速开始

```bash
cd D:/share-tool
npm install

cp .env.example .env        # Windows: copy .env.example .env
# 编辑 .env，填下面三项：
#   TRILIUM_URL=http://<你的 Trilium 地址>:8080
#   ETAPI_TOKEN=<Trilium → Options → ETAPI → 新建 token>
#   ROOT_NOTE_ID=<分享根笔记的 noteId>

npm start                   # 或 npm run dev（server.js 改动自动重启）
```

打开 http://localhost:4321/share/

> 仓库里已带一份 `.env`（`ETAPI_MOCK=1`），可以先不填 token 直接 `npm start` 看内置假数据跑通界面；
> 接了真实数据后把它改成 `ETAPI_MOCK=0`。

---

## 配置项（.env）

| 变量 | 默认 | 说明 |
|---|---|---|
| `TRILIUM_URL` | `http://localhost:8080` | Trilium 地址，**不要带 `/etapi`** |
| `ETAPI_TOKEN` | — | ETAPI token，`Authorization: <token>` |
| `ROOT_NOTE_ID` | — | 分享根笔记 noteId，其子树会被预取 |
| `PORT` | `4321` | 本地端口 |
| `THEME_DIR` | `../TimelyBlogTheme` | 主题文件目录（默认即同级仓库） |
| `EJS_FILE` / `CSS_FILE` / `JS_FILE` | `TimelyBlogTheme.*` | 主题文件名 |
| `LIVE_RELOAD` | `1` | 主题文件变化自动刷新浏览器（SSE） |
| `CACHE_TTL` | `30000` | 笔记元数据/内容缓存毫秒数 |
| `PREFETCH_DEPTH` | `6` | 预取深度（模板递归 maxDepth=5） |
| `MAX_NOTES` | `2000` | 预取上限，防大库拉爆 |
| `ETAPI_MOCK` | `0` | `1` = 内置假数据，无需 Trilium |
| `PUSH_NOTE_EJS/CSS/JS` | — | `npm run push` 回推用（三个笔记的 noteId） |

---

## 路由对照

| 本地 | Trilium 线上 | 说明 |
|---|---|---|
| `/share/` | `/share/` | 根笔记页（首页列表） |
| `/share/<noteId 或 shareAlias>` | 同 | 详情页 / 固定页（如 `/share/about`） |
| `/share/theme/<file>` | CDN / `~shareCss`、`~shareJs` | 本地主题资源 |
| `/share/api/attachments/<id>/download` | 同 | 附件下载 |
| `/share/api/attachments/<id>/image/<title>` | 同 | 正文内嵌图片 |
| `/share/api/images/<noteId>/<file>` | 同 | 图片笔记 |
| `/share/__dev/state` | — | 当前拉取到的笔记树（noteId / shareId / 标签） |
| `/share/__dev/invalidate` | — | 清缓存并全量重拉 |
| 任意页面加 `?fresh=1` | — | 跳过缓存重新拉取 |

`content` 里的内部链接按 Trilium 规则改写：`#root/<noteId>` → `./<shareId>`、`#...?attachmentId=x` → `api/attachments/x/download`、找不到的目标去掉 `href`，`api/` 资源路径归一为 `/share/api/`。

---

## 日常流程

```bash
npm start                      # 起服务（建议 npm run dev）
# 改 D:/TimelyBlogTheme/*.ejs|css|js → 存盘 → 浏览器自动刷新
npm run state                  # 命令行看拉取到的笔记树（debug 标签/层级）
npm run push                   # 满意后推回 Trilium 的 EJS/CSS/JS 三个 code 笔记
```

`npm run push` 需要先填 `PUSH_NOTE_EJS / PUSH_NOTE_CSS / PUSH_NOTE_JS`（Trilium 里对应笔记的 noteId）。

---

## 与线上行为的已知差异

| 场景 | 线上 Trilium | 本工具 |
|---|---|---|
| 可见子笔记判定 | 只含「已共享」笔记（shaca） | ETAPI 读不到共享开关，改为排除 `#shareHiddenFromTree`；混有未共享笔记时给它们加该标签即可对齐 |
| 受保护笔记 | 显示 `Protected note cannot be displayed` | ETAPI 用 token 可读到内容，不做拦截 |
| 正文净化 | 走 CKEditor 渲染 + sanitize | 直接用 ETAPI 原始内容 |
| `t()` 国际化 | i18next 实际文案 | 直通 key |
| 数学公式 | 注入 KaTeX | 未模拟 |
| 默认主题的标题锚点/TOC | 属于默认 `page.ejs`，自定义模板不继承 | 与自定义模板表现一致（不注入） |

---

## 内置回归用例

`ETAPI_MOCK=1` 时，假数据里有一篇 **「正文含内联脚本（验证转义）」**：正文包含真实的 `</script>` 标签（网页剪藏常见）。

访问 `/share/post0000005` 可以看到：`window.BLOG_DATA` 的内联脚本被提前闭合，剩余 JSON 泄漏成页面文本，SPA 直接失效。
修法是在 EJS 里对注入 `<script>` 的内容做 `<` → `\u003c` 转义（如 `JSON.stringify(v).replace(/</g, '\\u003c')`）。

---

## 目录结构

```
share-tool/
├─ server.js            # HTTP 服务：路由 / SSE 热重载 / 代理
├─ config.js            # .env 解析 + 默认值 + 资源本地化规则
├─ src/
│  ├─ etapi.js          # ETAPI 客户端（fetch，Authorization: token）
│  ├─ store.js          # 子树预取 + 缓存 + 标签继承 + shareId 索引
│  ├─ share-note.js     # 模拟模板里的 note 对象（getLabelValue/… 同步 API）
│  ├─ rewrite.js        # 正文链接改写（对齐 content_renderer.ts）
│  ├─ render.js         # EJS 渲染 + 资源本地化 + 热重载注入
│  ├─ utils.js          # slugify / stripTags / slugifyHeadings
│  └─ mock.js           # 内置假数据（ETAPI_MOCK=1）
└─ tools/
   ├─ state.js          # 打印笔记树
   └─ push-theme.js     # 回推主题到 Trilium
```

### 为什么必须预取

Trilium 的 EJS 模板是**同步渲染**的（`getLabelValue()` / `getChildNotes()` 都是同步调用），而 ETAPI 是 HTTP 异步接口。
因此服务先把「根笔记 + 子树元数据」整棵拉进内存（默认 6 层、最多 2000 篇，可配），再交给模板同步使用；正文按需拉取并缓存。
