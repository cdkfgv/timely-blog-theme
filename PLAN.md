# TimelyBlogTheme 重构计划清单

> 汇总自代码审查 + Trilium 官方文档核对 + share-tool 实测复现。
> 验证环境：`D:/share-tool`（`ETAPI_MOCK=1` 假数据 / 填 `.env` 后用真实库），存盘即热重载。
> 每阶段独立可验证，做完一项勾一项，**不跨阶段混改**。

## 工作流约定（两条硬规则）

1. **三阶段流程（用户决策，EJS 里两套写法并存）**：
   | 阶段 | EJS 生效写法 | share-tool |
   |---|---|---|
   | ① **开发**（当前） | `note.getRelations("shareCss"/"shareJs")` → `api/notes/<id>/download`；CDN 注释保留 | `ASSET_MODE=local`（默认）→ 重写成本地 `TimelyBlogTheme.css/.js`，存盘即见 |
   | ② **预览** | **不动**（CSS/JS 已上传进 Trilium） | `ASSET_MODE=as-is` → 保持原样，验证 Trilium 托管的文件渲染是否正常 |
   | ③ **上线** | 注释掉两段 shareCss/shareJs 循环，启用 CDN `<link>`/`<script>` | 同上；想本地看效果再切回 `local` |
   - 原因：`shareCss`/`shareJs` 方式**访问需要登录**，不适合外网；外网一律走 CDN
   - `~shareCss` / `~shareJs` 关系**必须勾「可继承」**，否则子页面取不到
2. **不主动 push**：我不执行 `npm run push` / 任何 ETAPI 写操作，也不碰 GitHub。本地验证通过后由**你手动**推送。我只做「改代码 + 本地渲染验证 + 报告结果」。

---

## 阶段 0 · 环境（已完成）

- [x] 建 `D:/share-tool`：本地模拟 Trilium 分享渲染，ETAPI 取真实数据 + 主题热重载
- [x] `git init` + 首个提交 `7f3e411`
- [x] 假数据端到端验证：首页/详情/固定页 200，草稿排除，链接/附件/图片改写正确，附件代理 MIME 正确，目录穿越被挡，SSE 触达
- [x] 复现 `</script>` 注入故障（mock 用例 `post0000005`）
- [x] 填 `.env` 三项（`TRILIUM_URL` / `ETAPI_TOKEN` / `ROOT_NOTE_ID`）并把 `ETAPI_MOCK` 改 `0`，跑通真实数据
  - 实测（2026-09-30）：真实库 `https://note.yihwang.top` / 根笔记 `p3wjHYobxcWH`，`npm run smoke` **43 项全通过**

---

## 阶段 1 · 安全修（不动架构，最小 diff）✅ 已完成（2026-09-30）

> 目标：消掉会导致页面挂掉 / 明显错乱的硬伤。改完本地验证通过后，**由你手动** push。
> 验证：`cd D:/share-tool && ETAPI_MOCK=1 npm run smoke` → **25 项全通过**。

- [x] **1.1 `</script>` 注入（P0）** — EJS 里新增 `safeJson()`，把 JSON 串里的 `< > & U+2028 U+2029` 转成 `\u00XX` 转义，`site` / `blogger` / `posts` / `postDetail` / `content` / `noteTitle` / `fixedPages` / `isFixed` 全部改走它
  - 回归用例 `post0000005`：BLOG_DATA 块完整（不再被提前闭合）、块后紧跟 `<head>`（无 JSON 文本泄漏）、还原后仍是真实 `</script>` 文本
- [x] **1.2 首页标题重复 + tag/category 标题缺失** — 删掉 `watch(titles)`，改为 `updateRoute()` 末尾调用 `updateTitle()`；首页不再拼两次站点名，`tag` / `category` / `notfound` 纳入映射（`标签：X - 站点` / `分类：X - 站点`）；`G.isPostPage` 时直接返回，避免覆盖服务端渲染的文章标题
- [x] **1.3 拼写错误** — `fiexdPages` → `fixedPages`、`isFiexdPage` → `isFixedPage`（EJS 定义 + 调用 + `BLOG_DATA` 字段名；JS 里未使用的 `fiexdPages` computed 已删）
- [x] **1.4 初始锚点滚动打架** — 新增 `isAnchorHash()`：标题锚点（`#heading-x`）**不参与路由、不回顶部、不触发 hashchange 重渲染**；路由 hash 才 `scrollTo(0)`。判定收进 `updateRoute()` 内部，任何调用方都安全

顺手修的（share-tool，非主题问题）：
- `ETAPI_MOCK=1` 时不再读 `.env` 里的真实 `ROOT_NOTE_ID`（否则预取失败、首页空、子页全 404）
- 新增 `npm run smoke`：主题回归断言（转义 / 标题 / 路由锚点 / 拼写 / 静态资源）


## 阶段 2 · 样式出 EJS + CDN 策略优化

> 目标：EJS 只留数据 + 结构。
> **资源引用三阶段（用户决策）**：见顶部「三阶段流程」。EJS 里同时保留两套写法 —— 开发/预览期用 `note.getRelations("shareCss"/"shareJs")` → `api/notes/<id>/download`，上线形态（CDN）以注释保留在旁。代码里**不做任何自动回退 / 环境判断**。

- [x] ~~2.2 资源改 `~shareCss` / `~shareJs`~~ — 原「淘汰 CDN、全量内迁」方案撤销；现改为**双形态并存**（见上方决策）
- [x] **2.1 手写样式出 EJS → CSS 末尾** — 113 行内联 `<style>`（`::selection`、滚动条、`.code-block`、`.prose-content` 全段、`.toc-drawer`、`prefers-reduced-motion`）迁到 `TimelyBlogTheme.css` 末尾，带醒目 banner 标注「非 Tailwind 产物，重构建后需贴回」。EJS 47,497 → 38,357 字节（**每页少下发 9.1KB**），渲染结果里已无 `<style>`
  - 用户决策：单文件（不拆第二个 CSS），接受重构建需贴回的人工成本
- [x] **2.2a 缓存策略** — 用户决策：**保持 `@main`**，不加版本 tag/SHA（避免每次发布多一步改 EJS）；若日后出现明显缓存滞后再切 tag
- [x] ~~**2.2b CDN 兜底（onerror 自动回退）**~~ — **撤销，不做**（用户决策）
  - 理由：CSS/JS 上传 GitHub、切 CDN 是**人工发布步骤**，代码里不写任何自动判断/回退
  - 已移除：EJS 里的 `cssFallback`/`jsFallback`（读 `~shareCss`/`~shareJs` 生成 `onerror`）、CSS `onerror` 属性、JS `onerror` 动态注入
  - 备注：主题 JS 启动仍用 `readyState` 判断（与回退无关）
- [x] **2.2d 开发期引用 Trilium 托管资源**（新增，替代 2.2b 的实际需求）
  - EJS head 加用户提供的两段循环：`shareCss` → `<link href="api/notes/<id>/download" rel="stylesheet">`、`shareJs` → `<script type="module" src="api/notes/<id>/download">`
  - CDN 地址**以注释保留**在旁（上线时与上面互换角色）
  - share-tool 同步支持：`ASSET_MODE=local` 重写成本地文件 / `as-is` 保持原样（对应阶段②预览、③上线）
  - 修复 share-tool 数据层 bug：**relation 的继承此前完全没实现**（只继承了 label），导致挂在根笔记的 `~shareCss` 在子页面取不到
  - `type="module"` 影响已静态核查：主题 JS 无顶层 `this`、无隐式全局、无严格模式禁用语法
- [x] **2.2c 预连接** — 三个源都加了 `<link rel="preconnect" crossorigin>`（jsdmirror / cdnjs / unpkg）
- [ ] **2.3 依赖收敛** — 用户决策：图标换**内联 SVG**（需先确认线框稿）
  - [x] 线框稿：`mockups/icons-mockup.html`（24 个图标逐一对照，左列真实 FontAwesome，含明暗切换、34px 放大对比、场景预演）→ **待你确认**
  - [ ] 按确认结果改 EJS：`<svg><symbol>` 精灵块 + `class="i i-16"`，删 FontAwesome `all.min.css`
  - [x] ~~Prism 语言包按需收敛~~ → **已整体换掉**，见阶段 6

---

## 阶段 3 · 去 Vue 改 SSR（最大一刀）✅ 已完成（2026-09-30）

> 目标：`Trilium 渲染空壳 → Vue 客户端重画` 改成 `Trilium 直接吐内容，JS 只做交互`。
> 实测（mock 4 篇文章）：
> | 指标 | 前 | 后 |
> |---|---|---|
> | 主题 JS | 676 行 / 24.4KB（Vue 应用） | 478 行 / 18.6KB（原生脚本，**有效行 553 → 397**） |
> | 文章页 HTML | 37.5KB | **23.8KB（−36%）** |
> | 首页 HTML | 36.4KB | 39.9KB（+9.5%，因为归档/标签/404 也变成真实标记，换来 hash 切换零渲染） |
> | 首次渲染依赖 | `vue.global.js` 500KB+ 下载后才出内容 | 无（HTML 到达即内容；**爬虫也能读到正文**） |
> 验证：`npm run smoke` **38 项**（服务端渲染结果）+ `npm run dom` **46 项**（jsdom 真实行为），`local` / `as-is` 两种资源模式均全通过。

- [x] **3.1 列表/标签/归档/分类页改 EJS 循环输出** — 首页卡片、归档（年→月→日）、标签总览全部服务端渲染；
  标签/分类的**文章列表改为克隆首页卡片**（`data-post-id` / `data-category` / `data-tags`），不再额外下发一份 HTML
- [x] **3.2 详情页 `<%- content %>`** — 正文由 Trilium 渲染好直接输出（`#post-content`）
- [x] **3.3 卡片复用** — 卡片标记在模板里只出现一次（首页循环），标签/分类页复用同一份 DOM，无需 partial
- [x] **3.4 原生 JS 接管交互（实测 478 行，有效行 397）**
  | 功能 | 实现 |
  |---|---|
  | 明/暗切换 | JS 只管翻转 `html.dark` + 落盘；图标切换与深色背景层改由 CSS(`.dark`) 驱动，零 JS |
  | 折叠面板（标签/目录/目录分组/移动端目录） | 统一 `[data-toggle="id"]` + `hidden` + `aria-expanded`，箭头旋转交给 CSS |
  | 标签/归档/分类筛选 | hash 路由切换 `<section data-view-panel>` 显隐 + 克隆卡片 |
  | 搜索弹窗 | 索引从 `<script type="application/json">` 读，结果用 DOM API 构造（`textContent`，无 innerHTML 拼接） |
  | 代码块复制、灯箱、外链、目录高亮 | 原生 DOM，逻辑沿用；无 clipboard API 时退回 `execCommand` |
  | 阅读进度、回到顶部 | 合并为一个 rAF 节流的 scroll 监听 |
  | 导航高亮 | `aria-current="page"` + `body[data-view]`，样式在 CSS 里用颜色变量实现 |
- [x] **3.5 TOC 锚点挪服务端** — 模板内自实现 slug（中文保留），服务端给正文标题补 `id` 并建目录树
  - ⚠️ **纠正**：Trilium 的模板 locals **没有 `utils`**，官方 `page.ejs` 也是自己内联 `slugify` —— 不能依赖 `utils.slugifyHeadings`
  - ⚠️ **行为变化**：锚点由 `#heading-0`（序号）改为 `#问题`（标题文本），旧书签失效；同时 `#` 链接可读性、SEO 更好
- [ ] **3.6 EJS 拆 partials** — **暂缓**：`include('name')` 需要模板笔记下挂 `application/x-ejs` 子笔记（Trilium 侧手工建），
  且 share-tool 还要补 `includer`。当前卡片已无重复标记，收益有限，留待需要时再做

---

## 阶段 4 · 收尾优化

> 4.1 ~ 4.5 是「Vue 时代」的问题，阶段 3 去 Vue 时已顺带解决，保留记录。
> 4.6 ~ 4.9 已完成（2026-09-30）。验证：`npm run smoke` **58 项**（mock·local）/ **57 项**（mock·as-is）/ **43 项**（真实库），
> `npm run dom` **46 项**，`npm run script-test` **24 项**，全通过。

- [x] **4.1 派生数据只算一次** — 聚合改为模板里算一次（`tagCount` / `catCount` / `archive`），导航、侧边栏、标签页、归档页共用
- [x] **4.2 全局状态统一** — `G` 全局对象（ref/reactive 混用）整体删除；状态落在 DOM（`hidden` / `aria-expanded` / `aria-current` / `body[data-view]`）
- [x] **4.3 归档去重 O(n²) → Set**；~~`collect()` 统一用 `getVisibleChildNotes`（原实现子节点用 `getChildNotes`，会带出隐藏笔记）~~
  - 🔴 **该条已被阶段 5 推翻并回退**：改回 `getChildNotes()`，见下方 5.1
- [x] **4.4 删首页骨架屏假延迟** — SSR 后首屏即内容，`setTimeout(300)` 与骨架屏标记一并删除
- [x] **4.5 observer / listener 生命周期** — 不再有「路由切换销毁重建组件」的场景（页面级渲染），IntersectionObserver 只在一页内创建一次；scroll 监听已合并为单个 rAF 节流
- [x] **4.6 补 OG / Twitter meta** — 按 Trilium 官方属性实现，模板侧自己算（默认 `page.ejs` 的特征不继承）：
  | 属性 | 输出 |
  |---|---|
  | `#shareDescription` | `<meta name="description">` + `og:description` + `twitter:description`（无则：文章页用 `#blogSummary`，列表页用 `#siteDescription`） |
  | `#shareOpenGraphURL` | `og:url` + `twitter:url` |
  | `#shareOpenGraphDomain` | `twitter:domain` |
  | `#shareOpenGraphImage` / `~shareOpenGraphImage` | `og:image` + `twitter:image`；label 值原样用，relation 指向 File 笔记 → `api/notes/<id>/download`；都为空时回退文章 `#headerImage` |
  | `#shareOpenGraphColor` | `theme-color` |
  | `#shareDisallowRobotIndexing` | `<meta name="robots" content="noindex, follow">`（只有该笔记有） |
  | 新增 `#siteUrl` | `og:image` / `og:url` 的相对地址按它补成绝对地址（OG 要求绝对 URL），未设则原样输出 |
  | 其余 | `og:site_name` / `og:title` / `og:type`（文章 article、列表 website）/ `twitter:card`（有图 `summary_large_image`，无图 `summary`）/ `twitter:title` |
- [x] **4.7 `#shareHiddenFromTree`** — 清单已写进 EJS 顶部（EJS 注释，不进页面字节）：模板 / CSS / JS / favicon 四份笔记都挂上。**Trilium 侧需你手动加标签**
- [x] **4.8 `~shareFavicon` 关系** — 指向 File 笔记 → `api/notes/<id>/download`；优先级 `#shareFavicon`（完整 URL）> `~shareFavicon` 关系 > 内置 emoji data-URI；需勾「可继承」才能在各子页面生效
- [x] **4.9 `templateScript.js` 修三处** — 重写：
  - 摘要先剥 `<script|style|pre|code|figure|table|svg>` 整块 + 块级标签转空格，代码不再污染前 120 字
  - 空白归一改语言感知：`([中文])[\s]+([中文])` → 直接吃掉，其余压成单空格（英文不再被连成一坨）
  - `note.save()` 挪进 `publish === 'true'` 分支；`blogDate` 判空再写；摘要按需加省略号（≤120 字不加）
  - 顺带：`&nbsp;` 与常见实体还原、剥离顺序修正
  - 新增 `npm run script-test`（24 项）：用 `new Function('api', src)` + 打桩 note 复刻 Trilium 脚本环境
- [x] **4.6' 双重转义 BUG（新发现，P1）** — 全量 `<%= esc(x) %>` 会被 EJS 再转义一次（`&` → `&amp;`），
  标题/描述含 `&`、`<`、`'` 时页面出现 `&amp;amp;` / `&amp;#39;`，favicon data-URI 直接变 `&amp;lt;svg` 而失效。
  修法：所有 `<%= esc(...) %>` / `<%= enc(...) %>` → `<%- esc(...) %>` / `<%- enc(...) %>`（共 40+ 处）。
  smoke 加双重转义守卫 + mock 里塞入含 `& < >` 的站点简介与文章标题做正向断言。
- [ ] **4.10 目录结构（可选，B 方案）** — `TimelyBlogTheme/src/` 放三个主题文件，`文章模版.html` / `templateScript.js` 留根；代价是 `.env` 加 `EJS_FILE=src/...` 等两行
- [ ] **4.11 主题 JS 是 `type="module"` 但内容为传统写法** — 阶段③ 切 CDN 时 `<script src>` 不带 module，两者都能跑（已用 `readyState` 判断）；若保留 module，注意 Trilium 侧 JS 笔记 MIME 必须为 `text/javascript`

---

## 阶段 5 · 真实数据联调修复（2026-09-30 下午）

> 背景：`share-tool` 第一次连**真实库**（`note.yihwang.top` / 根 `p3wjHYobxcWH`）跑，暴露出 3 个只有真实数据才会踩到的问题。
> 之前几轮的「实测数据」其实跑的是 mock（当时 4321 实例是 `ETAPI_MOCK=1` 起的），所以没暴露。

- [x] **5.1 🔴 首页列表空了（P0，阶段 4.3 引入的回归）**
  - 现象：真实库首页 `共 0 篇文章`，一篇都列不出来
  - 根因：`collect()` 递归用了 `getVisibleChildNotes()`，而 `#shareHiddenFromTree` 的语义只是
    **「不出现在分享树的左侧导航」**，不等于「不是文章」。你博客里 5 篇文章都带这个标签 → 全被过滤
  - 佐证：旧版（线上 Vue 版）递归用的就是 `getChildNotes()`，只有根节点用 `getVisibleChildNotes()`；线上 `/share/rWETtjGJtS3W` 返回 200 说明这些笔记确实已共享
  - 修法：递归与根都改回 `getChildNotes()`。文章唯一判据是 `#publish=true`；真实 Trilium 的 shaca 只装已共享笔记，
    所以 `getChildNotes()` 就等于分享子树，模板/CSS 副本等没有 `#publish` 的笔记自然被过滤
  - 回归：smoke 加「隐藏于树的已发布文章仍在列表里」+「源码里必须用 `rootNote.getChildNotes()`」
    （mock 里把 `post0000003` 标上 `#shareHiddenFromTree`）
- [x] **5.2 ETAPI 正文被自动 `JSON.parse`（P1，share-tool）**
  - 现象：canvas 笔记的正文渲染成字符串 `[object Object]`
  - 根因：`etapi.js` 的 `request()` 对所有响应无条件 `JSON.parse`。canvas（Excalidraw）笔记的正文本身就是合法 JSON
    （`{"type":"excalidraw",...}`）→ 被解析成对象 → `store.content` 里 `String(obj)` 得 `[object Object]`
  - 修法：`request()` 加 `raw` 选项，`getNoteContent` 走 `{ raw: true }` 原样返回字符串
    （任何「内容本身是合法 JSON」的文本笔记同样中招，不只是 canvas）
  - 回归：新增 `npm run unit`（`tools/unit-test.js`），用打桩 fetch 断言正文返回字符串、元数据接口仍解析对象
- [x] **5.3 canvas（Excalidraw）笔记支持（share-tool）**
  - 实测线上 Trilium 对 canvas 笔记的输出（不是下发场景 JSON，而是渲染成图片）：
    `<img src="api/images/<noteId>/<encodeURIComponent(title)>?<utcDateModified>">`
  - share-tool 对齐该标记；`/api/images/:id/*` 路由已存在，本地返回一张占位 SVG
    （本地不模拟 Excalidraw 绘制，属已知差异）
  - 现在真实库 `/share/rWETtjGJtS3W` 的输出与线上逐字节一致
- [x] **5.4 顺手修 smoke 的两处假报**
  - `F` 段「子页面」写死 `post0000001`：真实库没这篇 → 整段无意义失败；改为用 `POST_ID`，取不到 200 时明确跳过
  - `G` 段「渲染结果里不再出现 fiexd」：真实库文章《基于 Trilium Note…》正文里本来就在讲 `fiexdPages` 这个笔误
    → 误报；改为 mock 专用，源码级断言保持无条件
  - 新增 `I` 段：canvas 笔记专项（5 项）

**真实库实测（`POST_ID=HvzRWi2r9bUh`，有 `<h2>` 的那篇）**

| 检查 | 结果 |
|---|---|
| 首页文章列表 | **5 篇**（原 0 篇）：`网络拓扑图` / `常用软件推荐` / `公网安全访问内网 NAS` / `应用分享：TriliumNotes` / `基于 Trilium Note…` |
| 标签 / 归档聚合 | 正常（Docker、NAS、Network、Self-Hosted、Trilium Notes、公网访问、内网穿透） |
| canvas 文章 | `<img src="/share/api/images/rWETtjGJtS3W/%E7%BD%91%E7%BB%9C%E6%8B%93%E6%89%91%E5%9B%BE?2026-09-29 08:30:32.421Z">` —— 与线上一致 |
| `shareAlias` | 根笔记的 `#siteName` 是「妙蛙妙蛙」，`关于` 走 `shareAlias=about` |

**测试矩阵（全绿）**

| 套件 | mock·local | mock·as-is | 真实库 |
|---|---|---|---|
| `npm run smoke` | **65** | **64** | **46**（需 `POST_ID=<真实文章 noteId>`） |
| `npm run dom` | **46** | 46 | — |
| `npm run unit` | **5** | — | — |
| `npm run script-test` | **24** | — | — |

---

## 已确认「不是必须」/ 保持不改

| 项 | 结论 |
|---|---|
| Vue 3 整套 SPA | 可去掉（见阶段 3） |
| `vue.global.js`（带编译器版，500KB+） | 删；若一定要留框架，Alpine.js（~15KB）是这场景正解 |
| Tailwind 预编译产物挂 CDN | **保持** — 这是 Trilium 无构建管线下的唯一正确姿势，且视觉已深度定制，换 Pico/Water.css 纯亏 |
| `#shareOmitDefaultCss` | 已用上，fully custom 不需要默认样式 |
| `templateScript.js` 整体思路 | **保持** — 属性变更脚本自动填摘要/日期，已是 Trilium 地道用法 |
| Svelte / Solid | 不建议 — 需 Node 构建链，Trilium 没有 |
| `~shareHtml` / `#shareHtmlLocation` | **不用** — 官方新特性（注入 head/body/content 片段），本主题已能改模板源码，多一层属性反而难维护 |
| `~shareLogo` / `#shareLogoWidth/Height` / `#shareRootLink` | **不适用** — 这些只作用于**默认主题**左侧树的 logo；本模板自绘导航，用 `#bloggerAvatarUrl` 即可 |
| `#shareCredentials` / `#shareIndex` / `#shareExternalLink` / `#shareRaw` | **不用** — 与本站形态无关（免登录公开博客 / 无分享索引页 / 无外链跳转 / 无 raw 输出） |

---

## share-tool 已知差异（非主题问题，按需处理）

- ETAPI 读不到「共享开关」→ 本地拿不到真正的分享子树。**注意：主题的文章收集已不用 `#shareHiddenFromTree` 判定可见性**（见 5.1），
  所以本地会遍历 ETAPI 能读到的整棵子树；若某篇「未共享但带 `#publish=true`」的笔记出现在本地列表里，属已知差异（线上不会）
- canvas（Excalidraw）笔记：标记与线上一致（`<img src="api/images/...">`），但本地返回占位 SVG，不模拟实际绘制
- 未模拟：受保护笔记拦截、CKEditor 净化、i18n 文案、KaTeX
- `npm run push` 无 dry-run 预览（可选加）

---

## 阶段 6 · 代码高亮换 highlight.js ✅ 已完成（2026-09-30）

> 起因：用户问「现在用 Prism，有更好的推荐吗，bash / yaml 比较多」→ 做对比页 → 选中 highlight.js。

### 6.1 先修根因：语言名对不上（这才是「正文零高亮」的原因）

Trilium 输出的 `<code>` class 是 **MIME 形式**，实测 5 种形态，Prism 一个都不认：

| Trilium 实际输出 | 语义 | 归一目标 |
|---|---|---|
| `language-text-x-sh` | bash | `bash` |
| `language-text-x-yaml` | yaml | `yaml` |
| `language-text-x-trilium-auto` | 自动识别 | `''` → 交给 `highlightAuto` |
| `language-application-typescript` | ts | `typescript` |
| `language-application-javascript-env-backend` | node/js | `javascript` |

→ 主题 JS 新增 `LANGUAGE_MAP` + `normalizeLang()`；**换任何高亮器都躲不掉这一层**。

### 6.2 换库

- [x] 删 Prism：`prism.min.css` / `prism-tomorrow.min.css` + core + 5 个 `components/*.js`（共 8 个请求）
- [x] 换 hljs：`highlight.min.js` 单文件（全语言）+ `github.min.css` / `github-dark.min.css` **明暗双主题**，由 `syncHljs()` 切 `disabled`
- [x] `syncPrism()` → `syncHljs()`；`Prism.highlightElement()` → `hljs.highlight()/highlightAuto()`
- [x] 代码块容器补底色（`.code-block pre` 浅 `#fafaf9` / 暗 `#18181b`），`.hljs` 命中原来只写 `language-*` 的尺寸规则
- [x] 语言标签改读归一后的名字（不再显示 `text-x-sh` 这种原文）

### 6.3 对比页（交付给用户目视选型）

- `mockups/code-highlight-compare.html` — bash / yaml 各 4 栏并排（Prism tomorrow · hljs github-dark · Shiki 配色示意 · 现状无高亮）+ 体积/准确率表 + 建议
- 结论：**换 hljs**（按需版 ≈35KB，bash/yaml/docker 内置，单文件接入）；**不用 Shiki**（wasm ≈700KB 或服务端预渲染，不适配 Trilium 自定义模板）

### 6.4 测试

- `smoke` 新增 **J 段**（13 项）：引用检查、双主题互斥、`normalizeLang` 存在性、**5 种 MIME 形态逐一归一断言**、SSR 不改写正文 class
- `dom` 新增 **F 段**（14 项）：jsdom 注入 `hljs` 存根，验证 5 个代码块的真实归一路径 + CDN 挂掉时降级不抛异常
- ⚠️ **踩坑**：`#post-content code` 会匹配到正文里的**行内 `<code>`**（5 个空 class），统计代码块必须用 `#post-content .code-block pre code`
- ⚠️ `npm run dom` 依赖 mock 固定 fixture，连真实库时会直接报错退出（`config.mock` 判定），不再抛一堆 null 异常
- mock 新增 `post0000007`「代码高亮语言标记对照」，覆盖全部 5 种形态；归类用「工具链」以免打乱既有分类页断言

| 套件 | mock·local | mock·as-is | 真实库 |
|---|---|---|---|
| `smoke` | **84** | **83** | **60**（`POST_ID=tx5vjdhzMBf3`）|
| `dom` | **63** | **63** | —（mock 专用）|
| `unit` / `script-test` | **5** / **24** | — | — |

---

## 阶段 7 · 文章图标（`#iconClass`）渲染到网页 ✅

### 7.1 问题

用户在 Trilium 里给笔记设了图标（右侧属性面板的「图标」→ 写入 `#iconClass`，值为 Boxicons 类名如 `bx bxs-shower`），
但分享页上看不到 —— 主题为了网页好看只能手工复制 emoji，结果 Trilium 里变成「图标 + emoji」两个。

**根因**：Trilium 官方分享模板只在**左侧导航树**渲染 `note.getIcon()`（`tree_item.ejs` 唯一一处调用）；
正文 `<h1 id="title">` 与首页卡片（主题自绘）都不读这个 label。

### 7.2 关键事实（核对 TriliumNext/Trilium **v0.105.0** tag 源码）

- 实例版本：`GET /etapi/app-info` → `appVersion: 0.105.0`（buildDate 2026-08-19）。源码仓库是 **`TriliumNext/Trilium`**（非 `TriliumNext/Notes`）。
- v0.105.0 渲染入口在 `apps/server/src/share/content_renderer.ts` 的 `renderNoteContent()` / `RenderArgs`：
  模板上下文**确实包含** `utils`、`cssToLoad`、`jsToLoad`、`isStatic`、`faviconUrl`、`logoUrl`、**`iconPackCss`**、**`iconPackSupportedPrefixes`**
  （此前项目笔记里「没有 utils / cssToLoad / jsToLoad」的说法是**过时的**，已更正）。
- `iconPackCss` **不是**「一套可挑的离线图标库」，而是「把笔记图标包的字体 + glyph 规则注入页面」的出口：
  `iconPacks.map(p => generateCss(p, 字体URL)).join()`；内置包只有 **Boxicons v2，prefix `bx`**。
- 字体 URL：内置包 → `assets/fonts/boxicons.woff2`（相对 `/share/`，**匿名可访问**，实测 200）；
  自定义包 → `api/attachments/<id>/download`。
- ⚠️ 自定义图标包有个硬门槛：`.filter(p => p.builtin || !!shaca.notes[p.manifestNoteId])` ——
  **图标包笔记必须在分享子树内**，否则整包被静默剔除（无任何报错）。
- `SNote.getIcon(filterByPrefix)`：读 `#iconClass` → 否则 `getNoteIcon()` 按类型兜底，返回 `tn-icon <class>`。

### 7.3 方案（用户选 A：内联图标）

- `mockups/icons-ab-mockup.html` — A（内联，图标与标题同行）/ B（胶囊徽章）双栏对比 + 对比表 + 建议 A。
- **A 已定稿**；无 `#iconClass` 的笔记**回退为类型默认图标**（对齐 Trilium 桌面端）。

### 7.4 实现

- 主题 `TimelyBlogTheme.ejs`：
  - 采集 `post.icon = node.getIcon()`；
  - `isKnownIconClass(cls)` 放行判定（只接受已加载图标包前缀，避免自定义包渲染成空方块）；
  - 首页卡片 `<h2>` 与详情页 `<h1>` 标题前插 `<i class="{icon} post-icon" aria-hidden="true">`；
  - `<head>` 注入 `<style id="trilium-icon-packs"><%- iconPackCss %></style>`（Trilium 自己生成，不含用户输入）。
- 主题 `TimelyBlogTheme.css`：`.post-icon` 尺寸 / 琥珀色（暗色 accent）/ 基线对齐，追加在末尾 banner 段。
- 主题附 `boxicons.woff2`（115KB，本地调试用；线上由 Trilium 分发，不入 CDN 请求）。
- share-tool：`ShareNote.getIcon()` + `_defaultIcon()`；`render.js` locals 补 `iconPackCss` / `iconPackSupportedPrefixes`；
  `config.js` 加字体本地化重写 → `/share/theme/boxicons.woff2`。

### 7.5 踩坑（P1 回归守卫）

- ⚠️ 放行判定**不能**写成 `part.indexOf(p + '-') === 0`：Boxicons 的基础类就是 `bx` 本身（不是 `bx-xxx`），
  这样写会把整串判否 → **页面上一个图标都没有**。正确写法：`part === p || part.indexOf(p) === 0`。smoke K 段有专项断言。

### 7.6 踩坑二：图标显示为空白（P0，用户实测发现）

**现象**：卡片/标题的 `<i class="bx bxs-shower post-icon">` 标签明明在，页面上却是**空白**。

**根因**：`iconPackCss` 只写了 `@font-face` + `.bx` 基础规则，**漏了逐图标的 glyph 声明**：

```css
.bx.bxs-shower::before { content: "\ef45"; }   /* ← 缺这一段 */
```

字体文件里没有「`.bxs-shower` 这个类 ⇒ 对应码点」的映射，`<i>` 就渲染成空字符。
**光有字体不够，CSS 里必须同时有「类名 → 码点」映射。**

**修复**：

- 从 boxicons 官方 CSS（`cdn.jsdelivr.net/npm/boxicons@2.1.4/css/boxicons.min.css`）正则提取，
  生成 `boxicons-glyphs.json`（**1634 个图标**，格式 `{"bxs-shower": "\\ef45", ...}`）；
  生成脚本：`tools/gen-boxicons-glyphs.py`。
- share-tool `render.js` 的 `buildIconPackCss()` 复刻 Trilium 服务端 `icon_packs.generateCss()` 的完整结构：
  `@font-face` + `.bx` + **逐图标 glyph 声明**。
- ⚠️ **体积优化（本地特有）**：线上 Trilium 把全量 1634 条内联进**每一页**（≈45KB/页，首页 48KB → **126KB**）。
  本地改为**按需输出**：`collectUsedGlyphs(store)` 遍历整棵子树所有笔记的 `getIcon()`，
  只输出命中 glyph 表的类名 → 真实库 **9 条**、页面回到 **48.8KB**。
  范围故意取「整棵子树」而非「本页可见」，避免「首页正常、详情页空白」随页面漂移。

### 7.7 测试

| 套件 | mock·local | mock·as-is | 真实库 |
|---|---|---|---|
| `smoke` | **97** | **96** | **71**（`POST_ID=HvzRWi2r9bUh`）|
| `dom` | **63** | — | —（mock 专用）|
| `unit` / `script-test` | **5** / **24** | — | — |

- `smoke` 新增 **K 段**（10 项）：iconPackCss 注入、字体重写（按 `ASSET_MODE` 分支）、卡片/详情页图标、类型回退、放行判定回归。
- 真实库实测：5 篇文章图标全部对上（`bxs-shower` / `bxs-coffee-bean` / `bxs-palette`，无图标的回退 `bx-note` / `bx-pen`）。
- `dom` 此前记的 1 项既存失败（外链 `target=_blank`）本次复跑已消失 → **63 / 0**。
- ⚠️ 库里改了 `render.js` 后**必须重启实例**（ES module 缓存），否则看到的还是旧 CSS。

---

## 阶段 8 · 侧边栏吸顶被顶部导航遮挡 ✅

### 8.1 问题（用户报告）

首页滚动时，右侧卡片吸顶后**上沿被顶部导航压住**。

### 8.2 根因

| 元素 | 定位 | 实际值 | 结论 |
|---|---|---|---|
| `header` 顶部导航 | `sticky top-0` + `h-14` | 占视口 **0~56px** | 遮挡源 |
| `aside` 右侧卡片 | `sticky top-[2.5rem]` | 吸顶在 **40px** | 比 header 下沿**高 16px** → 被压 |

那 16px 恰好是卡片头像 `w-14` 的高度，就是「太靠上」的直接观感来源。

### 8.3 修复

- **吸顶位置**：`top-[2.5rem]`(40px) → **`top-[4.5rem]`**(72px) = `header 56px + 16px 呼吸间距`，
  与页面主体 `py-10`、卡片间 `space-y-4` 的间距节奏一致。
- **层级**：侧边栏加 `z-index: 20` —— 卡在「header（z-50）之下、正文之上」，
  滚动时卡片应盖住左侧列表内容而非被穿透；同时高于归档年份标题的 `z-10`。

### 8.4 ⚠️ 关键坑：手写 CSS 必须显式声明这两个工具类

`.top-[4.5rem]` 与 `.z-20` **都不在 Tailwind 构建产物里**（构建时 EJS 写的还是 `top-[2.5rem]`，
`z-20` 从未被扫到）。只改 EJS 的 class **不生效**；而重建 Tailwind 又会覆盖手写段。
→ 最终把这两条写进 `TimelyBlogTheme.css` 末尾 banner 段（`.aside.sticky { top / z-index }`），
EJS 里的 `top-[4.5rem]` 保留作为语义标注。

> 推广：**改任何 Tailwind 任意值类（`top-[...]` / `z-N`）前，先 grep 构建产物确认它已生成**；
> 没有就写在 banner 段，别指望改个 class 名就自动有样式。

### 8.5 测试

- `smoke` 新增 **L 段（9 项）**，做**源码两侧对齐校验**（不硬编码 3.5rem）：
  从 EJS 读 header 的 `h-N` → 换算 rem；从 CSS 读 `aside.sticky` 的 `top` → 比大小。
  - 吸顶不被遮挡（top ≥ header 高度）
  - 留呼吸间距（≥ 8px）
  - `z-index` 存在且 `10 < z < 50`
  - 渲染结果里 `aside` 的 class 与 CSS 规则同时到位
- **守卫有效性已验证**：临时把改动回退成 bug 状态 → 3 项断言失败，报错信息精确到
  「top 比 header 矮 16px → 卡片上沿会被压住」。恢复后全绿。

| 套件 | mock·local | mock·as-is | 真实库 |
|---|---|---|---|
| `smoke` | **106** | **96** | **80**（`POST_ID=HvzRWi2r9bUh`）|
| `dom` | **63** | — | —（mock 专用）|
| `unit` / `script-test` | **5** / **24** | — | — |
