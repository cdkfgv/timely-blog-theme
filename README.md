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
| `/share/theme/<file>` | CDN / `api/notes/<id>/download` | 本地主题资源（两种形态都会被本地化到这里） |
| `/share/api/notes/<id>/download` | 同 | Trilium 托管的 Code 笔记（主题 CSS/JS 的开发期引用） |
| `/share/api/attachments/<id>/download` | 同 | 附件下载 |
| `/share/api/attachments/<id>/image/<title>` | 同 | 正文内嵌图片 |
| `/share/api/images/<noteId>/<file>` | 同 | 图片笔记 |
| `/share/__dev/state` | — | 当前拉取到的笔记树（noteId / shareId / 标签） |
| `/share/__dev/invalidate` | — | 清缓存并全量重拉 |
| 任意页面加 `?fresh=1` | — | 跳过缓存重新拉取 |

`content` 里的内部链接按 Trilium 规则改写：`#root/<noteId>` → `./<shareId>`、`#...?attachmentId=x` → `api/attachments/x/download`、找不到的目标去掉 `href`，`api/` 资源路径归一为 `/share/api/`。

---

## 主题资源 · 三阶段流程

| 阶段 | EJS 里生效的写法 | share-tool 怎么配合 |
|---|---|---|
| ① **开发**（当前） | `note.getRelations("shareCss"/"shareJs")` → `api/notes/<id>/download`；CDN 注释保留 | `ASSET_MODE=local`（默认）：把该引用重写成 `/share/theme/<本地文件>`，改 CSS/JS 存盘即见 |
| ② **预览** | **不动**（CSS/JS 已上传进 Trilium） | `ASSET_MODE=as-is`：不重写，页面保持原样 → 真正验证 Trilium 托管的文件渲染是否正确 |
| ③ **上线** | 注释 `shareCss`/`shareJs` 两段循环，启用 CDN `<link>` / `<script>` | 同上 `ASSET_MODE=as-is`；若想本地看效果再切回 `local`（会把 CDN 地址指向本地文件） |

```bash
# 阶段② / ③ 预览真实形态
ASSET_MODE=as-is npm start
```

> `~shareCss` / `~shareJs` 方式访问需要登录，所以只用于开发/预览；外网一律走 CDN（阶段③）。

**本地化细节**：`config.assetRewrite`（CDN 地址按文件名映射）+ `config.hostedAssets`（noteId → 本地文件名，取自 `PUSH_NOTE_CSS/JS`，mock 用 `themeCss0001/themeJs0001`；未命中按被引用笔记的 MIME 兜底）。HTML 注释内不改写，便于在页面源码里对照。

⚠️ Trilium 里加 `~shareCss`/`~shareJs` 关系时**必须勾选「可继承」**，否则只有分享根笔记那页能取到，所有子页面无样式。

---

## 日常流程

```bash
npm start                      # 起服务（建议 npm run dev）
# 改 D:/TimelyBlogTheme/*.ejs|css|js → 存盘 → 浏览器自动刷新
npm run state                  # 命令行看拉取到的笔记树（debug 标签/层级）
npm run push                   # 满意后推回 Trilium 的 EJS/CSS/JS 三个 code 笔记
```

`npm run push` 需要先填 `PUSH_NOTE_EJS / PUSH_NOTE_CSS / PUSH_NOTE_JS`（Trilium 里对应笔记的 noteId）。

### 改完主题跑这组检查

```bash
npm run smoke          # 服务端渲染结果断言（默认打 4321；BASE=... 可换端口）
npm run dom            # jsdom 里真实执行主题 JS，验交互行为
npm run unit           # 纯逻辑单测（ETAPI 客户端等，不需要起服务）
npm run script-test    # templateScript.js（Trilium 属性变更脚本）行为测试
```

- `smoke` / `dom` 走的是**正在运行的实例**，两种资源模式各跑一遍：
  `ETAPI_MOCK=1 BASE=http://localhost:4323 npm run smoke`（local）、
  `ASSET_MODE=as-is ETAPI_MOCK=1 BASE=http://localhost:4324 npm run smoke`（as-is）。
  mock 专属断言受 `ETAPI_MOCK` 控制，真实库跑时会自动跳过。
- **连真实库时务必显式给 `POST_ID`**（文章页相关断言要用），例如
  `POST_ID=HvzRWi2r9bUh npm run smoke`。不给的话会用 mock 用例 id，A/B/D 段会被跳过。
- `unit` / `script-test` 不需要起服务。

---

## 与线上行为的已知差异

| 场景 | 线上 Trilium | 本工具 |
|---|---|---|
| 可见子笔记判定 | 只含「已共享」笔记（shaca） | ETAPI 读不到共享开关，`getVisibleChildNotes()` 改用排除 `#shareHiddenFromTree` 近似。<br>⚠️ 主题的**文章收集**不该用它（`#shareHiddenFromTree` = 隐藏于树导航，≠ 不是文章），已改回 `getChildNotes()`；本地可能因此多出「未共享但 `#publish=true`」的笔记 |
| canvas（Excalidraw）笔记 | 场景 JSON 渲染成 `<img src="api/images/<id>/<title>?<utcDateModified>">` | 标记逐字节对齐；但本地不绘制，`/api/images/:id/*` 返回占位 SVG |
| 内容本身是合法 JSON 的正文 | 原样下发 | 必须原样下发 —— `getNoteContent` 曾无条件 `JSON.parse`，canvas 笔记会渲染成 `[object Object]`（已修，`npm run unit` 有守卫） |
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
