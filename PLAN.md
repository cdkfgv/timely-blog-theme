# TimelyBlogTheme 重构计划清单

> 汇总自代码审查 + Trilium 官方文档核对 + share-tool 实测复现。
> 验证环境：`D:/share-tool`（`ETAPI_MOCK=1` 假数据 / 填 `.env` 后用真实库），存盘即热重载。
> 每阶段独立可验证，做完一项勾一项，**不跨阶段混改**。

## 工作流约定（两条硬规则）

1. **开发期一律看本地文件**：源码里始终写 CDN 地址（= 最终形态），share-tool 渲染时自动替换为 `/share/theme/<本地文件>`，所以改样式存盘即见，**不需要为了调试改回本地路径**。稳定后再推 GitHub、由 CDN 提供线上服务。
   - 换版本 tag / SHA 也不影响本地开发：`assetRewrite` 正则匹配任意 ref（`timely-theme@<任意>`），无需改配置。
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
> **托管方案已定（用户决策）：继续用 GitHub CDN，不迁 `~shareCss`/`~shareJs`。**
> 理由：域名已映射到 `/share`，本身免登录可访问；把 CSS/JS 推到 GitHub 走 CDN，一是**边缘缓存加速**（尤其封面流量、NAS 上行带宽有限），二是**博客内容就该公开分享**。此处不再讨论内迁，只做 CDN 路线下的优化。

- [x] ~~2.2 资源改 `~shareCss` / `~shareJs`~~ — **撤销，不做**（见上方决策）
- [ ] **2.1 prose 样式出 EJS** — 模板里约 110 行内联 `<style>` 挪进 CSS 笔记，EJS 每次渲染少下发一段静态文本（CSS 笔记仍按现有流程推 CDN，与托管方式无关）
- [ ] **2.2a 缓存策略** — 现在写死 `@main`：
  - 换**版本 tag 或 commit SHA**（如 `@v1.4.0` / `@<sha>`），jsDelivr 对不可变引用可长期强缓存，比 `@main` 命中率高、也不用等 CDN 清缓存
  - 推送后若 URL 不变，加 `?v=<hash>` 做失效；否则新样式要等 CDN TTL
  - 收益：首字节更快 + 更新可控
- [ ] **2.2b CDN 兜底（推荐加）** — CDN 挂了/被墙时页面无样式，很难看：
  ```html
  <link rel="stylesheet" href="CDN" onerror="this.onerror=null;this.href='/share/theme/TimelyBlogTheme.css'">
  ```
  JS 同理加载失败回退本地。等价于「CDN 主 + Trilium 内托管兜底」两全，也顺带说明：`~shareCss`/`~shareJs` 并非无用，做兜底比放 CDN 更合适（同域、随笔记库版本走）
- [ ] **2.2c 预连接** — `<link rel="preconnect" href="https://cdn.jsdmirror.com" crossorigin>`，省一次 DNS+TLS 往返
- [ ] **2.3 依赖收敛** — 4 个外部源 → 1~2 个（与托管方式无关，纯体积/请求数）
  | 现状 | 处理 |
  |---|---|
  | FontAwesome 全量 CSS + webfont（为十几个图标） | 换内联 SVG / iconfont 子集，省 ~100KB |
  | Prism 7 个语言包 + 双主题（9 个请求） | 只留实际用到的语言；双主题用一份 CSS + 变量 |
  | 字体（unpkg） | 保留（或并入自家 CDN 仓库一起托管） |
  | jsdmirror（主题 CSS/JS） | **保留**（用户决策），按 2.2a 加版本/失效参数 |

---

## 阶段 3 · 去 Vue 改 SSR（最大一刀）

> 目标：`Trilium 渲染空壳 → Vue 客户端重画` 改成 `Trilium 直接吐内容，JS 只做交互`。
> 收益：JS 从 ~650 行降到 ~200 行，删 `vue.global.js` + 手写路由 + `G` 全局状态，**顺带修掉 SEO 空页面**（现在爬到的 `<main id="app">` 是空的）。

- [ ] **3.1 列表/标签/归档/分类页改 EJS 循环输出** — 数据本来就在 EJS 里收集好，等于绕一圈客户端再画一遍
- [ ] **3.2 详情页 `<%- content %>`** — Trilium 已渲染好 HTML
- [ ] **3.3 文章卡片提成 EJS partial，`include` 复用**
- [ ] **3.4 原生 JS 接管交互（~200 行）**
  | 功能 | 实现 |
  |---|---|
  | 暗色切换 | 扩展 head 内联脚本，~10 行 |
  | TOC 滚动高亮 | 保留 ~30 行（生成挪到 3.5） |
  | 代码块复制、灯箱 | ~30 行（本来就是原生 DOM，直接搬） |
  | 搜索弹窗 | ~50 行（过滤逻辑不变，渲染换字符串拼接 / `<template>` clone） |
  | 标签/归档筛选 | hash 过滤 + 原生渲染 ~40 行（或拆真实笔记页，SEO 更好） |
  | 返回顶部、阅读进度 | ~15 行，两个 scroll 监听合并 |
- [ ] **3.5 TOC 锚点挪服务端** — 用 `utils.slugifyHeadings` 在 EJS 里生成锚点 ID + 目录数据，客户端那套 `querySelectorAll + 补 id + 建树` 删掉
- [ ] **3.6 EJS 拆 partials** — 642 行大模板拆成 `header` / `sidebar` / `footer` / `detail`（已验证 Trilium 的 `~shareTemplate` 支持 `include`）

---

## 阶段 4 · 收尾优化

- [ ] **4.1 派生数据只算一次** — `posts`、标签聚合（TagsView/AppSidebar 各一份）、分类聚合（Header 又来一份）在 5 处重复；改模块级 `computed` + `useTags()` / `useCategories()`，或 provide/inject（若 3.x 已去 Vue，则简化为渲染时一次性聚合）
- [ ] **4.2 全局状态统一** — `tocCollapsed` 用 `reactive({value})` 包一层又在模板 `.value`，与 ref 语义混乱 → 全用 ref / 收敛成单个 `createStore()`
- [ ] **4.3 归档去重 O(n²) → Set**；`processNode` 根节点用 `getVisibleChildNotes`、子节点用 `getChildNotes` → 统一 `getVisibleChildNotes`
- [ ] **4.4 删首页骨架屏假延迟** — 数据是内联同步的，`setTimeout(300)` 纯装饰，拖慢首屏感知
- [ ] **4.5 observer / listener 生命周期** — PostDetailView 的 IntersectionObserver 卸载后仍引用旧 DOM，顺手 `onUnmounted` 断开
- [ ] **4.6 补 OG / Twitter meta** — 官方模板按笔记 label 生成，现在社交分享无预览图
- [ ] **4.7 `#shareHiddenFromTree`** — 给模板/CSS/JS 笔记挂上，不出现在导航
- [ ] **4.8 `#shareFavicon` 关系** — 指向文件笔记，替代 emoji data-URI
- [ ] **4.9 `templateScript.js` 修三处**
  - 摘要提取没先剥 `<pre>/<code>/<script>` 块 → 代码块内容污染前 120 字
  - `\s+ → ''` 会把英文单词连成一坨（中文可接受，至少补注释或改按语言分支）
  - `note.save()` 无条件执行 → 挪进 `publishStatus === 'true'` 分支
- [ ] **4.10 目录结构（可选，B 方案）** — `TimelyBlogTheme/src/` 放三个主题文件，`文章模版.html` / `templateScript.js` 留根；代价是 `.env` 加 `EJS_FILE=src/...` 等两行

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
