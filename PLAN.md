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
- [ ] 填 `.env` 三项（`TRILIUM_URL` / `ETAPI_TOKEN` / `ROOT_NOTE_ID`）并把 `ETAPI_MOCK` 改 `0`，跑通真实数据

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
  - [ ] Prism 语言包按需收敛（低优先，可能延后）

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

- [x] **4.1 派生数据只算一次** — 聚合改为模板里算一次（`tagCount` / `catCount` / `archive`），导航、侧边栏、标签页、归档页共用
- [x] **4.2 全局状态统一** — `G` 全局对象（ref/reactive 混用）整体删除；状态落在 DOM（`hidden` / `aria-expanded` / `aria-current` / `body[data-view]`）
- [x] **4.3 归档去重 O(n²) → Set**；`collect()` 统一用 `getVisibleChildNotes`（原实现子节点用 `getChildNotes`，会带出隐藏笔记）
- [x] **4.4 删首页骨架屏假延迟** — SSR 后首屏即内容，`setTimeout(300)` 与骨架屏标记一并删除
- [x] **4.5 observer / listener 生命周期** — 不再有「路由切换销毁重建组件」的场景（页面级渲染），IntersectionObserver 只在一页内创建一次；scroll 监听已合并为单个 rAF 节流
- [ ] **4.6 补 OG / Twitter meta** — 官方模板按笔记 label 生成（`shareOpenGraphURL` / `shareDescription` / `shareOpenGraphImage`），现在社交分享无预览图
- [ ] **4.7 `#shareHiddenFromTree`** — 给模板/CSS/JS 笔记挂上，不出现在导航
- [ ] **4.8 `#shareFavicon` 关系** — 指向文件笔记，替代 emoji data-URI
- [ ] **4.9 `templateScript.js` 修三处**
  - 摘要提取没先剥 `<pre>/<code>/<script>` 块 → 代码块内容污染前 120 字
  - `\s+ → ''` 会把英文单词连成一坨（中文可接受，至少补注释或改按语言分支）
  - `note.save()` 无条件执行 → 挪进 `publishStatus === 'true'` 分支
- [ ] **4.10 目录结构（可选，B 方案）** — `TimelyBlogTheme/src/` 放三个主题文件，`文章模版.html` / `templateScript.js` 留根；代价是 `.env` 加 `EJS_FILE=src/...` 等两行
- [ ] **4.11 主题 JS 是 `type="module"` 但内容为传统写法** — 阶段③ 切 CDN 时 `<script src>` 不带 module，两者都能跑（已用 `readyState` 判断）；若保留 module，注意 Trilium 侧 JS 笔记 MIME 必须为 `text/javascript`

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

---

## share-tool 已知差异（非主题问题，按需处理）

- ETAPI 读不到「共享开关」→ 本地改用排除 `#shareHiddenFromTree` 判定可见子笔记（树里混有未共享笔记时加该标签即可对齐线上）
- 未模拟：受保护笔记拦截、CKEditor 净化、i18n 文案、KaTeX
- `npm run push` 无 dry-run 预览（可选加）
