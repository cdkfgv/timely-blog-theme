/**
 * 主题回归 smoke test — 改完主题跑一次（需要 share-tool 已在运行）
 *
 *   npm run smoke                                    # 默认 http://localhost:4321
 *   BASE=http://localhost:4321 POST_ID=xxx npm run smoke
 *
 * 覆盖服务端渲染结果本身（客户端行为见 npm run dom）：
 *   A. 内联脚本安全（正文含 </script> 时搜索索引不得被提前闭合）
 *   B. 页面标题（不重复、含文章名）
 *   C. SSR 结构（无 Vue / 无 BLOG_DATA / 视图面板齐全 / 导航钩子）
 *   D. 服务端 TOC（正文标题 id ↔ 目录链接一一对应）
 *   E. 主题静态资源可访问
 *   F. 资源加载策略（开发期本地化 / 预览期保持原样）
 *   G. 拼写与依赖回归
 *   H. 分享元信息（OG / Twitter / favicon / robots）
 *   I. canvas（Excalidraw）笔记
 *   J. 代码高亮（highlight.js 引用 / 语言名归一 / 5 种 MIME 形态）
 *   K. 笔记图标（#iconClass → 首页卡片 / 详情页标题）
 *   L. 侧边栏完全固定（position: fixed / left 公式跨文件对齐）
 *   M. 暗色模式是 class 策略（产物里不得有 prefers-color-scheme 的 dark 媒体查询）
 *   N. 站内链接基址（linkBase=/share/，反向代理映射到域名根时也必须可用）
 */

import fs from 'node:fs';
import path from 'node:path';
import { config, themePath } from '../config.js';

const BASE = (process.env.BASE || `http://localhost:${config.port}`).replace(/\/+$/, '');
const PREFIX = config.shareUrlPrefix;
const POST_ID = process.env.POST_ID || 'post0000005';

let pass = 0;
let fail = 0;

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${name}`);
  } else {
    fail++;
    console.log(`  \u2717 ${name}${detail ? `\n       ${detail}` : ''}`);
  }
  return !!cond;
}

async function get(url) {
  const res = await fetch(url);
  return { status: res.status, body: await res.text() };
}

const ejsSrc = fs.readFileSync(path.join(config.themeDir, config.ejsFile), 'utf8');
const jsSrc = fs.readFileSync(path.join(config.themeDir, config.jsFile), 'utf8');

console.log(`\n[smoke] base=${BASE}${PREFIX}/  post=${POST_ID}  mock=${config.mock}\n`);

const home = await get(`${BASE}${PREFIX}/`);
const post = await get(`${BASE}${PREFIX}/${POST_ID}`);

/* ---- A. 内联脚本安全 ---- */
console.log('A. 内联脚本安全');
check('首页 200', home.status === 200, `status=${home.status}`);
if (post.status !== 200) {
  console.log(`  ! 跳过（${POST_ID} 返回 ${post.status}；real 模式可设 POST_ID=<含 </script> 的笔记>）`);
} else {
  const m = post.body.match(/<script type="application\/json" id="search-index">([\s\S]*?)<\/script>/);
  check('搜索索引块存在', !!m);
  if (m) {
    let data = null;
    try { data = JSON.parse(m[1]); } catch (err) { /* 下面断言报错 */ }
    check('搜索索引是完整可解析的 JSON', Array.isArray(data), '解析失败 → 内联块被提前闭合');
    check('索引条目结构完整（末条含 id/title）',
      !!data && data.length > 0 && data[data.length - 1].id && typeof data[data.length - 1].title === 'string');
    check('索引不含正文（体积可控）', !!data && !Object.prototype.hasOwnProperty.call(data[0] || {}, 'content'));
    const tail = post.body.slice(post.body.indexOf(m[0]) + m[0].length);
    check('索引块之后没有 JSON 文本泄漏', !/\{"id":"/.test(tail.slice(0, 400)), tail.slice(0, 160));
  }
  check('正文里的 <script> 仍原样出现在正文中',
    /<script>window\.__clipDemo = 1;<\/script>/.test(post.body) || !config.mock);
}

/* ---- B. 服务端标题 ---- */
console.log('\nB. 页面标题（服务端渲染）');
const homeTitle = (home.body.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
const siteName = homeTitle.trim();
check(`首页标题非空且不重复（当前 "${homeTitle}"）`, siteName.length > 0 && !/^(.+?) - \1$/.test(homeTitle));
if (post.status === 200) {
  const postTitle = (post.body.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  check(`文章页标题为「笔记名 - 站点名」（当前 "${postTitle}"）`,
    postTitle !== siteName && postTitle.endsWith(` - ${siteName}`));
}
const about = await get(`${BASE}${PREFIX}/about`);
if (about.status === 200) {
  check('固定页能打开', about.status === 200);
}

/* ---- C. SSR 结构 ---- */
console.log('\nC. SSR 结构');
const VIEWS = ['home', 'archive', 'tags', 'tag', 'category', 'notfound'];
check('页面不含 Vue 运行时', !/vue\.global|window\.Vue\b/.test(home.body));
check('不含 SPA 空壳 <div id="app">', !home.body.includes('id="app"'));
check('不含内联 window.BLOG_DATA', !home.body.includes('window.BLOG_DATA'));
check('不含 Vue x-template', !/<template id="tpl-/.test(home.body));
const cardCount = (home.body.match(/<article data-post-id=/g) || []).length;
check(`首页服务端渲染出文章卡片（${cardCount} 张）`, cardCount > 0);
check('视图面板齐全', VIEWS.every((v) => home.body.includes(`data-view-panel="${v}"`)),
  VIEWS.filter((v) => !home.body.includes(`data-view-panel="${v}"`)).join(', '));
check('body 带 data-view / data-site-name',
  /<body[^>]*data-view="home"[^>]*data-site-name="[^"]+"/.test(home.body));
check('导航项都带 data-nav 钩子',
  ['home', 'category', 'tags', 'archive', 'about'].every((n) => home.body.includes(`data-nav="${n}"`)));
check('（mock）未发布笔记不进列表', !config.mock || !home.body.includes('未发布草稿'));
check('（mock）标签/分类聚合齐全',
  !config.mock || (home.body.includes('#/tag/Vue') && home.body.includes('#/category/')));
check('（mock）#shareHiddenFromTree 的已发布文章仍在列表里',
  !config.mock || home.body.includes('data-post-id="post0000003"'),
  '隐藏于分享树导航 ≠ 不是文章；collect() 不能改用 getVisibleChildNotes()');
check('collect() 用 getChildNotes() 遍历（不能用 getVisibleChildNotes）',
  /rootNote\.getChildNotes\(\)\.forEach/.test(ejsSrc) && !/collect\([^)]*getVisibleChildNotes/.test(ejsSrc),
  'EJS 里的文章收集遍历方式被改回可见性过滤');

/* 详情页内边距：
   · 水平 px 仍是两层（外层 shell + 详情视图根）—— 去掉会明显变紧（正文贴边），
     是此前被用户发现的真实回归，必须保留。
   · 垂直上内边距：详情视图根用 pt-8（2rem）—— 正文顶边因此比右侧 fixed 侧栏
     低 32px（侧栏 top = 96px）。这是用户定稿的取舍（详情页顶部要留白）；
     改回 pt-0 则两者齐平（96px），同步改这里的断言即可。
   所以这里分别断言：水平两层、垂直顶层等于定稿值。 */
/* ⚠️ 容器宽度不要硬编码：从 EJS 读出 max-w-[Nrem] 再拼正则。
      （曾硬编码 100rem，容器收窄到 92.5rem 后这里全部误报；也曾只写整数 \d+，
        匹配不到 92.5 → 依赖它的断言连环误报。） */
const containerMaxMatch = ejsSrc.match(/max-w-\[(\d+(?:\.\d+)?)rem\]/);
const CONTAINER_ESC = containerMaxMatch ? containerMaxMatch[1].replace('.', '\\.') : '\\d+(?:\\.\\d+)?';
/* ⚠️ 两套转义别混用：
   · **HTML 渲染结果**里 class 是原样的 `max-w-[92.5rem]`（方括号不转义）
   · **CSS 文件**里选择器是转义的 `.max-w-\[92\.5rem\]`
   早先混用了 CSS 的转义去匹配 HTML → 永远匹配不到（静默变 0 层）。
   还有：`\b` 别用在 `px-5` 这种带连字符的类名上（`-` 是非单词字符，边界语义失灵）。 */
/* ⚠️ 匹配要限定在**同一个 class 属性内部**：`class="[^"]*max-w-...` 里的 `[^"]*`
   可以跨越多个标签（只要中间不出现引号），会把相邻元素也算进来（曾数出 3/4 层）。
   grep 风格的「单标签内」写法：class="..." 里不允许出现 `<` 或 `>`。 */
/* ⚠️ 必须带上 `py-10 md:pb-14` 这个尾巴来锁定「主体容器」：
   header / 页脚内层也用了同样的 `max-w-[..] px-5` 组合（收窄容器后共享同一宽度），
   光靠 max-w + px-5 会一并数进来（曾数出 3/4 层）。
   ⚠️ 别把 `pb-28` 写进尾巴 —— 它是可变的（已把移动端底部留白从 112px 降到 40px），
   写死会在改 padding 时静默失效（曾因此误报「0 层」）。 */
const CONTAINER_CLASS = 'max-w-\\[' + CONTAINER_ESC + 'rem\\]';
const CLS = 'class="[^"<>]*';
const PAD_BOX = new RegExp(
  CLS + CONTAINER_CLASS + '[^"<>]*px-5[^"<>]*py-10[^"<>]*md:pb-14[^"<>]*"', 'g',
);

const homePad = (home.body.match(PAD_BOX) || []).length;
check(`首页只有一层内边距容器（${homePad}）`, homePad === 1, `实际 ${homePad} 层`);
if (post.status === 200) {
  /* 详情页有**两**层容器，靠 py-10 / pt-8 区分：
       · 外层 shell：py-10 md:pb-14          ← 提供上内边距
       · 详情视图根：pt-8 pb-28 md:pb-14     ← 再叠 32px 上内边距（定稿值）
     两层的**水平** px 都保留（去掉会正文贴边，是真实回归）。 */
  const outerShell = (post.body.match(PAD_BOX) || []).length;
  check(`详情页外层 shell 保留 py-10 上内边距（${outerShell} 层）`, outerShell === 1,
    `实际 ${outerShell} 层 —— 详情页完全没有上内边距了？`);

  const innerRoot = new RegExp(
    CLS + CONTAINER_CLASS + '[^"<>]*px-5[^"<>]*pt-8[^"<>]*pb-28[^"<>]*md:pb-14[^"<>]*"', 'g',
  );
  const innerRootN = (post.body.match(innerRoot) || []).length;
  check(`详情视图根用 pt-8 且保留水平 px（${innerRootN} 处）`, innerRootN === 1,
    `实际 ${innerRootN} 处 —— 详情视图根应写 px-5 sm:px-8 xl:px-10 pt-8 pb-28 md:pb-14：`
    + `水平内边距必须保留（否则正文贴边）；pt-* 改动需同步改本断言`
    + `（pt-8 → 正文顶边 128px，比 fixed 侧栏低 32px；pt-0 → 两者齐平 96px）`);
}

/* ---- D. 服务端 TOC ---- */
console.log('\nD. 服务端 TOC');
if (post.status === 200) {
  const ids = [...post.body.matchAll(/<h[1-6][^>]*\sid="([^"]+)"/g)].map((x) => x[1]);
  const tocIds = [...post.body.matchAll(/data-toc-link="([^"]+)"/g)].map((x) => x[1]);
  check('正文标题都带 id', ids.length > 0, '未找到带 id 的标题');
  if (ids.length > 1) {
    check('目录链接与标题 id 一一对应',
      JSON.stringify(ids) === JSON.stringify(tocIds), `标题 ${JSON.stringify(ids)} vs 目录 ${JSON.stringify(tocIds)}`);
  } else {
    check('标题不足 2 个时不渲染目录', tocIds.length === 0, `目录 ${JSON.stringify(tocIds)}`);
  }
  check('客户端不再解析 DOM 建目录', !/querySelectorAll\('h1, h2/.test(jsSrc));
}

/* ---- E. 主题静态资源 ---- */
console.log('\nE. 主题静态资源');
for (const [file, typeHint] of [[config.cssFile, /^text\/css/], [config.jsFile, /javascript/]]) {
  const res = await fetch(`${BASE}${PREFIX}/theme/${file}`);
  const ct = res.headers.get('content-type') || '';
  check(`GET /theme/${file} → 200 且 MIME 正确`, res.status === 200 && typeHint.test(ct), `status=${res.status} ct=${ct}`);
}

/* ---- F. 资源加载策略 ---- */
console.log(`\nF. 资源加载策略（ASSET_MODE=${config.assetMode}）`);

/* 主题 CSS/JS 统一走 CDN（阶段③ 上线形态）。EJS 里只有这一种形态：
   线上直连 CDN；本地 dev 在 ASSET_MODE=local 时由 assetRewrite 把 CDN 地址
   重写成 /share/theme/<本地文件>（见 dev/config.js）。不写死域名，跟着 EJS 走。 */
const CDN_CSS_TAG = /<link[^>]+href="(https:\/\/cdn\.[^"]+\/timely-blog-theme@[^"]+\/timely-blog-theme\.min\.css)"/;
const CDN_JS_TAG = /<script[^>]+src="(https:\/\/cdn\.[^"]+\/timely-blog-theme@[^"]+\/timely-blog-theme\.min\.js)"/;

check('EJS 上线形态：启用 CDN 的 CSS + JS 引用',
  CDN_CSS_TAG.test(ejsSrc) && CDN_JS_TAG.test(ejsSrc),
  'EJS 里未找到启用的 CDN 引用（timely-blog-theme.min.css / .min.js）');
check('EJS 已停用 Trilium 托管的 ~shareCss / ~shareJs',
  !/getRelations\("shareCss"\)/.test(ejsSrc) && !/getRelations\("shareJs"\)/.test(ejsSrc),
  '仍存在 shareCss / shareJs 循环 —— api/notes 方式需要登录，外网不可用');
check('无自动回退逻辑（无 onerror / 动态注入）',
  !home.body.includes('onerror="this.onerror=null') && !/onerror="\(function\(\)/.test(home.body),
  '检测到回退属性');

/* 只统计「主题资源」引用：rel="stylesheet" 的 link + 带 src 的 script（排除 favicon 等） */
function hostedAssetRefs(html) {
  const linkTags = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map((m) => m[0]);
  const scriptTags = [...html.matchAll(/<script\b[^>]*src="[^"]*"[^>]*>/g)].map((m) => m[0]);
  return [...linkTags, ...scriptTags].filter((tag) => /api\/notes\/[\w-]+\/download/.test(tag));
}
const LOCAL_LINK = new RegExp(`<link[^>]+href="${PREFIX}/theme/${config.cssFile}"`);
/* 不再要求 type="module"：CDN 的 script 标签本来就是传统脚本（见 EJS 尾部），
   重写只换 URL 不动属性。 */
const LOCAL_SCRIPT = new RegExp(`<script[^>]+src="${PREFIX}/theme/${config.jsFile}"`);

/* 子页面用 POST_ID 那篇（真实库必须显式设 POST_ID=<真实文章 noteId>）；
   POST_ID 取不到时退回 mock 用例，避免真实库跑出一堆无意义的「子页面」断言失败。 */
const sub = post.status === 200 ? post : await get(`${BASE}${PREFIX}/post0000001`);
const subOk = sub.status === 200;
if (!subOk) console.log(`  ! 子页面断言跳过（${POST_ID} 与 post0000001 都取不到 200）`);

if (config.assetMode === 'as-is') {
  check('首页保留 CDN 引用（未本地化）', CDN_CSS_TAG.test(home.body) && CDN_JS_TAG.test(home.body));
  check('子页面同样有 CDN 引用（不依赖关系继承）',
    !subOk || (CDN_CSS_TAG.test(sub.body) && CDN_JS_TAG.test(sub.body)),
    '子页面没有 CDN 引用');
  check('未注入本地主题资源', !LOCAL_LINK.test(home.body) && !LOCAL_SCRIPT.test(home.body));
  check('无残留 Trilium 托管资源引用', hostedAssetRefs(home.body).length === 0,
    `仍有 ${hostedAssetRefs(home.body).length} 处 api/notes 引用`);

  /* 实测 CDN 真能取到 —— 这是「切 CDN」的唯一硬前提，页面上写对地址不等于外网可达 */
  const cssUrl = home.body.match(CDN_CSS_TAG)?.[1];
  if (cssUrl) {
    const res = await fetch(cssUrl).catch(() => null);
    const ct = res?.headers.get('content-type') || '';
    check(`CDN 可访问（${res?.status ?? 'ERR'} ${ct}）`,
      !!res && res.status === 200 && /css/i.test(ct),
      `取不到 ${cssUrl}`);
  }
} else {
  const homeAssets = hostedAssetRefs(home.body);
  check('首页已本地化（无 api/notes 引用）', homeAssets.length === 0, `仍有 ${homeAssets.length} 处`);
  check(`首页注入本地 CSS（${PREFIX}/theme/${config.cssFile}）`, LOCAL_LINK.test(home.body));
  check(`首页注入本地 JS（${PREFIX}/theme/${config.jsFile}）`, LOCAL_SCRIPT.test(home.body));
  check('CDN 引用已被本地化替换（首页无残留）',
    !CDN_CSS_TAG.test(home.body) && !CDN_JS_TAG.test(home.body));

  const subAssets = hostedAssetRefs(sub.body);
  check('子页面主题资源已本地化', !subOk || subAssets.length === 0, `仍有 ${subAssets.length} 处`);
  check('子页面同样注入本地主题资源（不依赖关系继承）',
    !subOk || (LOCAL_LINK.test(sub.body) && LOCAL_SCRIPT.test(sub.body)),
    '子页面没有本地主题 CSS/JS');
}

/* ---- G. 拼写与依赖回归 ---- */
console.log('\nG. 拼写与依赖回归');
check('渲染结果里不再出现 fiexd', !config.mock || !/fiexd/i.test(home.body + (post.body || '')),
  '（mock 专用；真实库正文里可能本来就有这个词）');
check('主题源码里不再出现 fiexd', !/fiexd/i.test(jsSrc + ejsSrc));
check('主题 JS 不再依赖 Vue', !/window\.Vue|createApp\(|reactive\(|computed\(/.test(jsSrc));
check('主题 JS 不再依赖 BLOG_DATA', !/BLOG_DATA/.test(jsSrc));

/* ---- H. 分享元信息（OG / Twitter / favicon / robots） ---- */
console.log('\nH. 分享元信息');
const metaOf = (html, re) => (html.match(re) || [])[1] || '';

check('og:site_name / og:title / og:type 都在',
  /<meta property="og:site_name"/.test(home.body) &&
  /<meta property="og:title"/.test(home.body) &&
  /<meta property="og:type" content="website">/.test(home.body));
check('twitter:card 存在', /<meta name="twitter:card" content="(summary|summary_large_image)">/.test(home.body));
check('description 非空', /<meta name="description" content="[^"]+">/.test(home.body));
check('favicon 非空', /<link rel="icon" href="[^"]+">/.test(home.body));
check('列表页 og:type=website 且不标 noindex',
  !/<meta name="robots"/.test(home.body), '列表页不该出现 robots');

if (config.mock) {
  const p1 = await get(`${BASE}${PREFIX}/post0000001`);
  const p2 = await get(`${BASE}${PREFIX}/post0000002`);
  const p3 = await get(`${BASE}${PREFIX}/post0000003`);

  check('文章页 og:type=article', /<meta property="og:type" content="article">/.test(p1.body));
  check('#shareDisallowRobotIndexing → noindex, follow',
    /<meta name="robots" content="noindex, follow">/.test(p1.body), '未输出 robots');
  check('#shareOpenGraphURL → og:url / twitter:url',
    metaOf(p1.body, /<meta property="og:url" content="([^"]+)">/) === 'https://blog.example.com/etapi-local-dev' &&
    metaOf(p1.body, /<meta name="twitter:url" content="([^"]+)">/) === 'https://blog.example.com/etapi-local-dev');
  check('#shareOpenGraphImage（label 值原样）→ og:image + summary_large_image',
    p1.body.includes('<meta property="og:image" content="https://cdn.example.com/og/etapi-local-dev.png">') &&
    p1.body.includes('<meta name="twitter:card" content="summary_large_image">'));
  check('无 #shareDescription 时描述回退 blogSummary',
    p1.body.includes('content="把主题开发从「复制到 Trilium 看效果」变成「本地刷新」…"'));
  check('#shareDescription 优先于 blogSummary',
    p2.body.includes('content="SSR 重构后首屏不再依赖 Vue 运行时。"'));
  check('~shareOpenGraphImage（relation → File 笔记）→ og:image',
    metaOf(p2.body, /<meta property="og:image" content="([^"]+)">/).includes('api/notes/favicon00001/download'),
    metaOf(p2.body, /<meta property="og:image" content="([^"]+)">/));
  check('#shareOpenGraphColor → theme-color',
    p2.body.includes('<meta name="theme-color" content="#d97706">'));
  check('#shareOpenGraphDomain → twitter:domain',
    p2.body.includes('<meta name="twitter:domain" content="blog.example.com">'));
  check('og:image 缺省回退 #headerImage，并按 #siteUrl 补成绝对地址',
    metaOf(p3.body, /<meta property="og:image" content="([^"]+)">/) ===
      'https://blog.example.com/api/attachments/att000000001/image/pic.png',
    metaOf(p3.body, /<meta property="og:image" content="([^"]+)">/));
  check('~shareFavicon（可继承）在各页面都生效',
    [home, p1, p2].every((r) => r.body.includes('api/notes/favicon00001/download')),
    'favicon 关系未继承到子页面');
  check('favicon 资源可访问', await (async () => {
    const res = await fetch(`${BASE}${PREFIX}/api/notes/favicon00001/download`);
    return res.status === 200 && /svg/.test(res.headers.get('content-type') || '');
  })());

  /* 回归：<%= esc(x) %> 会被 EJS 再转义一次（& → &amp;），所有输出去都必须用 <%- esc(...) %> */
  const all = home.body + p1.body + p2.body + p3.body;
  check('渲染结果没有双重转义',
    !/&amp;amp;|&amp;lt;|&amp;gt;|&amp;quot;|&amp;#39;/.test(all),
    (all.match(/&amp;(?:amp|lt|gt|quot|#39);/) || [])[0] || '');
  check('含 & < > 的字段只转义一次',
    home.body.includes('全栈开发者 &amp; 基础设施折腾者 &lt;yihwang&gt;') &&
    !home.body.includes('&amp;amp;'));
  check('title / og:title 里的特殊字符只转义一次',
    p3.body.includes('<title>在 NAS 上跑顺一切 &amp; 折腾 &lt;笔记&gt; - Timely</title>') &&
    p3.body.includes('<meta property="og:title" content="在 NAS 上跑顺一切 &amp; 折腾 &lt;笔记&gt;">'),
    (p3.body.match(/<title>[^<]*<\/title>/) || [])[0] || '');
} else {
  console.log('  ! 跳过具体取值断言（mock 专用；真实库请核对笔记上的 #share* 属性）');
}

/* ---- I. canvas（Excalidraw）笔记 ---- */
console.log('\nI. canvas（Excalidraw）笔记');
if (config.mock) {
  const cv = await get(`${BASE}${PREFIX}/post0000006`);
  check('canvas 文章页 200', cv.status === 200, `status=${cv.status}`);
  check('canvas 出现在首页列表里', home.body.includes('data-post-id="post0000006"'));
  check('正文渲染成图片，而不是场景 JSON',
    /<img src="(?:\/share)?\/api\/images\/post0000006\//.test(cv.body) && !cv.body.includes('"excalidraw"'),
    (cv.body.match(/<img src="[^"]*images[^"]*"/) || [])[0] || '未找到 img');
  check('页面里没有 [object Object]', !cv.body.includes('[object Object]'));
  check('canvas 图片路由可访问（本地占位图）', await (async () => {
    const res = await fetch(
      `${BASE}${PREFIX}/api/images/post0000006/${encodeURIComponent('手绘网络拓扑')}`,
    );
    return res.status === 200 && /svg/.test(res.headers.get('content-type') || '');
  })());
} else {
  check('真实库渲染结果里没有 [object Object]', !home.body.includes('[object Object]'));
  console.log('  ! 跳过 canvas 专项断言（mock 专用）');
}

/* ------------------------------------------------------------------ */
/* J. 代码高亮（highlight.js）：引用、语言名归一、回归守卫 */
/* ------------------------------------------------------------------ */

check('已换用 highlight.js（不再引 Prism）',
  /highlight\.min\.js/.test(home.body) && !/prism/i.test(home.body),
  /prism/i.test(home.body) ? '页面上还有 Prism 引用' : '没有 highlight.js 引用');
check('hljs 明暗双主题各挂一份且互斥',
  /id="hljs-light"/.test(home.body) && /id="hljs-dark"[^>]*\bdisabled\b/.test(home.body),
  '缺少 hljs-light / hljs-dark（暗色应为 disabled）');
check('主题 JS 不再调用 Prism.highlightElement', !/Prism\.highlightElement/.test(jsSrc));
check('主题 JS 有 normalizeLang 语言名归一', /function normalizeLang/.test(jsSrc));
check('主题 JS 用 hljs.highlight / highlightAuto', /hljs\.highlightAuto|hljs\.highlight\(/.test(jsSrc));
check('主题 JS 的明暗切换钩子已改名 syncHljs', /function syncHljs/.test(jsSrc) && !/function syncPrism/.test(jsSrc));

/* 语言名映射表必须覆盖 Trilium 实测的 5 种 MIME 形态（否则真库正文零高亮） */
const LANG_CASES = [
  ['text-x-sh', 'bash'],
  ['text-x-yaml', 'yaml'],
  ['application-typescript', 'typescript'],
  ['application-javascript-env-backend', 'javascript'],
  ['text-x-trilium-auto', ''],
];
/* 在 jsdom 之外直接跑归一段：从主题 JS 里抠出 normalizeLang + LANGUAGE_MAP 求值 */
const langOk = await (async () => {
  const start = jsSrc.indexOf('var LANGUAGE_MAP');
  const end = jsSrc.indexOf('function highlight(');
  if (start < 0 || end < 0) return null;
  const snippet = jsSrc.slice(start, end);
  try {
    const fn = new Function(snippet + '\nreturn normalizeLang;')();
    return LANG_CASES.map(([raw, want]) => [raw, fn(raw), want]);
  } catch (e) {
    return null;
  }
})();
if (langOk) {
  langOk.forEach(([raw, got, want]) => {
    check(`语言名归一：${raw} → ${want || '(空/自动)'}`, got === want, `实际得到 "${got}"`);
  });
} else {
  check('能从主题 JS 中提取 normalizeLang 做归一验证', false, '切片失败，检查变量名是否被改动');
}

if (!config.mock) {
  /* 真实库：直接核对渲染结果里 Trilium 的 language-* 是否被归一后带 hljs 标记 */
  const rawLangs = [...new Set((post.body.match(/class="language-[^"]+"/g) || []))];
  check('真实库文章页的代码块带 language-* 标记', rawLangs.length > 0,
    rawLangs.join(' / ') || '该文章没有代码块，换 POST_ID 再测');
  console.log(`  i 实际语言标记：${rawLangs.join(', ') || '(无)'}`);
} else {
  const p7 = await get(`${BASE}${PREFIX}/post0000007`);
  check('高亮专项文章页 200', p7.status === 200, `status=${p7.status}`);
  check('高亮专项文章在首页列表里', home.body.includes('data-post-id="post0000007"'));
  /* SSR 阶段 class 应保持 Trilium 原样，归一发生在客户端（jsdom 由 dom-test 覆盖） */
  LANG_CASES.slice(0, 4).forEach(([raw]) => {
    check(`SSR 保留 Trilium 原始 class：language-${raw}`,
      p7.body.includes(`language-${raw}`), '模板不应改写正文里的 class');
  });
}

/* ------------------------------------------------------------------
   K 段 · 笔记图标（#iconClass → 首页卡片 / 详情页标题）
   ------------------------------------------------------------------
   背景：Trilium 的分享页默认只在左侧树渲染 note.getIcon()；
   主题把它搬到首页卡片与详情页 <h1> 上，做到「Trilium 里设一次，网页跟着显示」。
   数据源是笔记的 #iconClass（Boxicons，如 "bx bxs-shower"）。
   ------------------------------------------------------------------ */

/**
 * 从主题 EJS 里切片取出图标放行判定，复刻成可调用函数。
 * 回归价值：曾把判定写成 `part.indexOf(p + '-') === 0`，
 * 基础类 "bx" 本身不匹配 → 整串被丢弃 → 页面上一个图标都没有。
 *
 * isKnownIconClass 在 EJS 里闭包引用了模块级的 iconPrefixes，
 * 切片求值时该变量不存在 → 这里显式把它作为第二个参数注入。
 */
function iconCloneTest() {
  let src = '';
  try {
    src = fs.readFileSync(themePath(config.ejsFile), 'utf8');
  } catch {
    return null;
  }
  const start = src.indexOf('function isKnownIconClass');
  const end = src.indexOf('function noteIcon');
  if (start < 0 || end < 0 || end <= start) return null;
  const snippet = src.slice(start, end);
  try {
    // 包一层：把 iconPrefixes 定义为形参，调用时传入
    const fn = new Function(
      `return function(iconPrefixes){ ${snippet}\nreturn isKnownIconClass; }`,
    )();
    return (cls, prefixes) => fn(prefixes)(cls);
  } catch {
    return null;
  }
}

/* K1 · iconPackCss 的注入出口（两处：<head> 的 style 标签 + 字体来源）*/
check('页面注入了 iconPackCss（#trilium-icon-packs）',
  home.body.includes('id="trilium-icon-packs"'),
  '缺少该 style 标签 → 图标字体不会加载');

/* 字体 URL：local 模式应被重写成本地主题文件；as-is 保持 Trilium 的 assets/fonts 路径 */
if (config.assetMode === 'as-is') {
  check('as-is：字体保持 Trilium 原始路径 assets/fonts/boxicons.woff2',
    /assets\/fonts\/boxicons\.woff2/.test(home.body),
    'as-is 模式不应改写资源地址');
} else {
  check('local：boxicons 字体被重写为 /share/theme/boxicons.woff2',
    home.body.includes(`${PREFIX}/theme/boxicons.woff2`),
    '本地渲染时字体需指向主题仓库内的字体文件');
}

/* K2 · 首页卡片图标渲染 */
const cardIcons = [...home.body.matchAll(
  /<i class="([^"]+) post-icon" aria-hidden="true"><\/i><a[^>]*>([^<]{0,60})/g,
)].map((m) => ({ cls: m[1], title: m[2] }));

check('首页卡片渲染了笔记图标', cardIcons.length > 0, '一个都没有 → noteIcon() 可能被过滤空了');
/* 图标类名必须是「页面上真的加载了的图标包」之一：
   - bx*  → boxicons（iconPackCss 注入，服务端按笔记 #iconClass 输出）
   - fa*  → FontAwesome（EJS 里从 cdnjs 引入）
   ⚠️ 曾经只放行 bx —— 用户给笔记设 #iconClass="fa-solid fa-a" 时会误报失败（其实能正常渲染）。 */
check('FontAwesome 样式表已加载（fa-* 图标可用）',
  home.body.includes('font-awesome/6.5.1/css/all.min.css'),
  '缺 FontAwesome <link> → 卡片上的 fa-* 图标会渲染成空白方块');
check('卡片图标类名属于已加载的图标包（bx* / fa*）',
  cardIcons.every((i) => /(^|\s)(bx|fa)/.test(i.cls)),
  cardIcons.map((i) => i.cls).join(' / '));

/* 图标必须出现在标题链接之前（A 方案：内联在标题左侧） */
check('图标内联在标题左侧（<i> 紧邻 <a> 之前）',
  new RegExp(`<i class="[^"]+ post-icon"[^>]*></i><a href="${PREFIX}/`).test(home.body),
  'A 方案要求图标与标题同行且在前');

/* K3 · 详情页标题图标（用 mock 里确实设了 iconClass 的文章） */
if (config.mock) {
  const withIcon = await get(`${BASE}${PREFIX}/post0000001`);
  check('详情页标题带图标（post0000001 设了 #iconClass）',
    withIcon.body.includes('bxs-shower') && /<i class="bx bxs-shower post-icon"/.test(withIcon.body),
    '详情页 <h1> 未渲染图标');

  /* 未设 #iconClass 的笔记 → getIcon() 按类型兜底，不应渲染成空 */
  const noIcon = await get(`${BASE}${PREFIX}/post0000002`);
  const h1 = (noIcon.body.match(/<h1 class="text-2xl md:text-3xl[\s\S]{0,200}?<\/h1>/) || [])[0] || '';
  check('未设图标的笔记回退为类型默认图标（bx bx-note）',
    h1.includes('bx bx-note post-icon'),
    `实际：${h1.slice(0, 120) || '(未取到 h1)'}`);

  /* mock 专属：确认两种 Boxicons 变体（regular / solid）都能透出 */
  const bxs = cardIcons.filter((i) => /\bbxs-/.test(i.cls));
  check('solid 变体（bxs-*）能正常渲染', bxs.length > 0,
    cardIcons.map((i) => i.cls).join(' / '));
} else {
  /* 真实库：不假设具体文章设了图标，只验证「有 #iconClass 就一定渲染出来」的对照关系 */
  const anyCardIcon = cardIcons.length;
  check('真实库首页存在文章图标或回退图标', anyCardIcon > 0,
    '一篇都没有 → 检查 getIcon() / iconPackSupportedPrefixes 是否可用');
  console.log(`  k 首页图标分布：${cardIcons.map((i) => i.cls).join(', ') || '(无)'}`);
}

/* K4 · 图标 class 的放行判定（回归：曾写成 indexOf(p + '-') === 0 导致 bx 被判否）*/
const iconClone = iconCloneTest();
if (iconClone) {
  const cases = [
    ['bx bxs-shower', ['bx'], true],
    ['bx bx-note', ['bx'], true],
    ['bx', ['bx'], true],
    ['fa-solid fa-tag', ['bx'], false],
    ['', ['bx'], false],
  ];
  cases.forEach(([cls, prefixes, want]) => {
    const got = iconClone(cls, prefixes);
    check(`图标放行判定：${cls || '(空)'} → ${want ? '通过' : '拦截'}`, got === want, `实际 ${got}`);
  });
} else {
  check('能从主题 EJS 中提取图标放行判定做验证', false, '切片失败，检查 isKnownIconClass 是否被改名');
}

/* ------------------------------------------------------------------
   L 段 · 侧边栏**完全固定**（position: fixed）
   ------------------------------------------------------------------
   演变（四次）：
     ① `sticky top-[2.5rem]`（40px）→ 吸顶后被 header（h-14 = 56px）压住 16px；
     ② `sticky top-[4.5rem]` + z-index:20 → 修好遮挡；
     ③ 去掉 sticky 改静态排布；
     ④ `sticky top:4.5rem` + max-height + overflow-y（吸顶+限高+内部滚）；
     ⑤ **最终：position: fixed** —— sticky 再怎么调都有「先滚一段再吸住」，
        用户要的是「一次都不动」，只能脱离文档流。

   守卫思路（L 段是**纯源码静态校验**，mock / 真实库都跑）：
     - aside 必须带自定义类 `aside-fixed`，且**不得**再带 `self-start`
       （fixed 元素不参与 grid 布局，留着会误导）
     - CSS 规则必须 `position: fixed` + `top` + `left` + `max-height` + `overflow-y`
     - 跨文件对齐：从 EJS 读容器 max-width / 内边距 / 卡片宽 / header 高度，
       校验 CSS 公式里引用的常量与之一致（改一处不改另一处 → 报错）
     - 渲染结果必须带 `aside-fixed`
   ------------------------------------------------------------------ */

/* 读取主题源码（EJS + CSS）做静态校验 */
let themeEjsSrc = '';
let themeCssSrc = '';
try {
  themeEjsSrc = fs.readFileSync(themePath(config.ejsFile), 'utf8');
  themeCssSrc = fs.readFileSync(themePath(config.cssFile), 'utf8');
} catch { /* 下面断言会各自报错 */ }

/* L1 · 从 EJS 读出上游常量（不硬编码，改了就报错） */
const headerSpacing = themeEjsSrc.match(/<header[^>]*class="[^"]*\bh-(\d+)\b/);
const headerRem = headerSpacing ? Number(headerSpacing[1]) * 0.25 : null;
check('能从 EJS 读出 header 高度（h-N 工具类）',
  headerRem !== null, '未匹配到 <header> 上的 h-* 类');

/* ⚠️ 必须支持小数：容器曾收窄到 92.5rem 让整块居中，
   早先的正则只写 \d+ 会匹配不到 → 所有依赖 containerRem 的断言连环误报。 */
const containerMaxW = themeEjsSrc.match(/class="[^"]*\bmax-w-\\?\[(\d+(?:\.\d+)?)rem\\?\]/);
const containerRem = containerMaxW ? Number(containerMaxW[1]) : null;
check('能从 EJS 读出内容容器 max-width（max-w-[Nrem]，支持小数如 92.5rem）',
  containerRem !== null, '未匹配到容器上的 max-w-[*rem]');

const asideWidth = themeEjsSrc.match(/<aside[^>]*class="[^"]*\bw-\\?\[(\d+)px\\?\]/);
const asideW = asideWidth ? Number(asideWidth[1]) : null;
check('能从 EJS 读出侧边栏宽度（w-[Npx]）',
  asideW !== null, '未匹配到 <aside> 上的 w-[*px]');

/* L2 · aside 的 class */
const asideTag = themeEjsSrc.match(/<aside[^>]*>/);
const asideClass = asideTag
  ? (asideTag[0].match(/class="([^"]*)"/) || [, ''])[1]
  : '';
check('能从 EJS 里取到 <aside> 的 class',
  asideClass.length > 0, '未匹配到 <aside ... class="...">');
check('侧边栏带 aside-fixed 类（完全固定用的自定义类）',
  /(^|\s)aside-fixed(\s|$)/.test(asideClass),
  `aside class = "${asideClass}"，缺少 aside-fixed`);
check('侧边栏已移除 self-start（fixed 元素不参与 grid 布局）',
  !/\bself-start\b/.test(asideClass),
  'fixed 后 self-start 已无意义，留着会误导（脱离文档流后不由 grid 决定位置）');
check('侧边栏不再用 sticky（sticky 必有"先滚一段"的过程）',
  !/\bsticky\b/.test(asideClass),
  'aside 仍带 sticky —— sticky 的语义是随滚动走一段再吸住，做不到"一次都不动"');

/* L3 · CSS 规则：fixed 五要素
   ⚠️ 产物是 Tailwind minify 后的单行 CSS（`aside.aside-fixed{...}` 无换行、无空格），
      所以**不能**再用 `\{[\s\S]*?\n  \}` 这种依赖缩进的正则 —— 改用花括号配对提取。
   ⚠️ 定位值自 v4 构建链路起改为 CSS 变量驱动（--layout-top / --layout-container /
      --layout-aside），规则体里是 `top:var(--layout-top)` 而非字面量 `top:6rem`。
      因此断言改成：① 规则体里必须**引用**变量；② 变量在 :root 里**有定义**；
      ③ 变量的值与 EJS 从 class 里读出的值一致（L4/L5 负责）。 */
const extractRule = (css, selector) => {
  const i = css.indexOf(selector);
  if (i < 0) return '';
  const open = css.indexOf('{', i);
  if (open < 0) return '';
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, j);
    }
  }
  return '';
};
const ruleBody = extractRule(themeCssSrc, 'aside.aside-fixed');
check('主题 CSS 有 aside.aside-fixed 规则',
  !!ruleBody, 'CSS banner 段缺少 aside.aside-fixed');

/* :root 里的布局变量（单一事实来源）*/
const layoutVar = (name) => {
  const m = themeCssSrc.match(new RegExp(`--${name}\\s*:\\s*([^;}]+)`));
  return m ? m[1].trim() : '';
};
const varTop = layoutVar('layout-top');
const varContainer = layoutVar('layout-container');
const varAside = layoutVar('layout-aside');
check('CSS :root 定义了 --layout-top（侧栏顶边的单一事实来源）',
  /^[\d.]+rem$/.test(varTop), `--layout-top = "${varTop}"（应为 Nrem）`);
check('CSS :root 定义了 --layout-container（容器宽）',
  /^[\d.]+rem$/.test(varContainer), `--layout-container = "${varContainer}"（应为 Nrem）`);
check('CSS :root 定义了 --layout-aside（侧栏宽）',
  /^\d+px$/.test(varAside), `--layout-aside = "${varAside}"（应为 Npx）`);

check('侧边栏规则含 position: fixed',
  /position:\s*fixed/.test(ruleBody), ruleBody.slice(0, 120) || '(规则未取到)');
check('侧边栏 top 引用 --layout-top（而非硬编码）',
  /top:\s*var\(--layout-top\)/.test(ruleBody),
  '缺少 top:var(--layout-top) —— 垂直位置不定或硬编码了值');
check('侧边栏规则含 left（水平对齐 grid 列）',
  /left:\s*calc\(/.test(ruleBody), '缺少 left —— fixed 后不再自动对齐列位置');
check('侧边栏规则含 max-height（超高时兜底）',
  /max-height:\s*calc\(/.test(ruleBody), '缺少 max-height');
check('侧边栏规则含 overflow-y: auto（兜底内部滚动）',
  /overflow-y:\s*auto/.test(ruleBody), '缺少 overflow-y');
check('侧边栏规则含 z-index（低于 header、高于正文）',
  /z-index:\s*\d+/.test(ruleBody), '缺少 z-index');

/* L4 · top 必须**正好等于**「改动前由文档流提供的落点」
   —— fixed 脱离文档流后，容器 py-10 的 padding-top 不再推它，必须显式加进 top。

      期望：top === header 高度 + 容器 py-N           （**恰好相等**，不是 ≥）

   ⚠️ 为什么是「恰好相等」而不是「≥ + 呼吸间距」：
      改动前 aside 在文档流里、是 `align-items:start` 的 grid 子项，
      所以它的卡片顶边 **就是**容器内容区顶边 = header + 容器 py-N。
      这个值本身已经含「header 到卡片」的净间距（py-10 = 40px），**不需要再加呼吸间距**。
      曾经写成 `top ≥ header + py + 8px`，结果我按"≥"让 top 变成了 7rem(112px)，
      比正确落点 96px 多了 16px → 用户报「比初始高度矮了大概 16px」。
      → **守卫必须锁死"等于"，否则它无法发现"多加了间距"这类反向偏差。**

   ⚠️ 必须锚定「主体布局容器」，不能用裸 py-(\d+) —— 页面里 py-1 / py-2 / py-0.5
      一大堆（目录链接、按钮、分类胶囊…），裸正则会匹配到第一个（py-1）而静默取错值。
      这里用容器独有的 class 组合锚定：flex-1 + flex-col + max-w-[Nrem] + py-N。 */
const containerEl = themeEjsSrc.match(
  /class="[^"]*\bflex-1\b[^"]*\bflex-col\b[^"]*\bmax-w-\\?\[\d+(?:\.\d+)?rem\\?\][^"]*\bpy-(\d+)\b/,
);
const containerPyRem = containerEl ? Number(containerEl[1]) * 0.25 : null;
check('能从 EJS 读出主体布局容器的竖向内边距（py-N，锚定 flex-col + max-w-[Nrem]）',
  containerPyRem !== null,
  '未匹配到主体容器上的 py-* —— fixed 的 top 需要它来补位');

const asideTop = varTop ? Number(varTop.replace('rem', '')) : null;
if (headerRem !== null && asideTop !== null) {
  const toPx = (rem) => Math.round(rem * 16);
  const exactTop = headerRem + (containerPyRem ?? 0);
  check(`侧边栏顶部不被 header 遮挡（top ${toPx(asideTop)}px ≥ header ${toPx(headerRem)}px）`,
    asideTop >= headerRem,
    `top 比 header 矮 ${toPx(headerRem - asideTop)}px → 卡片上沿会被压住`);
  check(`--layout-top 正好补回文档流落点（top ${toPx(asideTop)}px = header+py ${toPx(exactTop)}px）`,
    asideTop === exactTop,
    `fixed 脱离文档流后必须**恰好**补回容器 padding-top（${containerPyRem}rem）：`
    + `期望 --layout-top = ${exactTop}rem（header ${headerRem}rem + py ${containerPyRem}rem），`
    + `实际 ${asideTop}rem → `
    + (asideTop < exactTop
      ? `比原来偏上 ${toPx(exactTop - asideTop)}px`
      : `比原来偏低/偏下 ${toPx(asideTop - exactTop)}px（多加了间距，原来没有这一项）`));
}

/* L4b · max-height 必须引用同一个 --layout-top（防只改一处）。
   ⚠️ 变量驱动后不再比较"字面量相等"，而是断言公式里引用了**同一个变量** ——
      这样改 --layout-top 一处，两个消费者自动同步，结构上不可能不一致。 */
check('max-height 引用了 --layout-top（与 top 同坐标系，防只改一处）',
  /max-height:\s*calc\(100vh\s*-\s*var\(--layout-top\)/.test(ruleBody),
  `max-height 必须以 var(--layout-top) 作减数，实际规则体：${ruleBody.slice(0, 160)}`);

/* L5 · left 公式必须引用同一组变量（防「改了容器宽度忘了改公式」）
   ⚠️ 变量驱动后，检查点从"字面量等于 EJS 值"变成"公式引用了变量" +
      "变量值等于 EJS 值"，两段合起来等价，但不再有"漏改一处"的可能。 */
const leftDecl = ruleBody.match(/\bleft:\s*([^;]+);?/);
const leftBody = leftDecl ? leftDecl[1] : '';
check('能从 CSS 里提取 left 声明（只取声明本身，避开注释）',
  leftBody.length > 0, '未匹配到 left: ...; 声明');

check('left 公式引用了 --layout-container（容器宽）',
  /100vw\s*-\s*var\(--layout-container\)/.test(leftBody),
  `left 里没找到 "100vw - var(--layout-container)" —— 容器宽度改了但 left 公式没同步。实际：${leftBody}`);
check('left 公式引用了 --layout-aside（侧栏宽，作减数）',
  /-\s*var\(--layout-aside\)/.test(leftBody),
  `left 里没找到 "- var(--layout-aside)" —— 侧栏宽度改了但 left 公式没同步。实际：${leftBody}`);
check('left 公式用 min() 处理容器未满宽（否则窄屏会算错）',
  /min\(\s*100vw/.test(ruleBody),
  '缺少 min(100vw, ...) —— 容器窄于 max-width 时内容宽应为 100vw');
check('left 公式用 max() 处理容器居中（否则宽屏会偏左）',
  /max\(\s*0px/.test(ruleBody),
  '缺少 max(0px, ...) —— 宽屏时容器居中偏移会被算成负数');

/* L5b · 变量值必须与 EJS 里 class 读出的值一致（变量驱动后的一致性锚点） */
if (containerRem !== null && varContainer) {
  check(`--layout-container（${varContainer}）= EJS 容器的 max-w（${containerRem}rem）`,
    Number(varContainer.replace('rem', '')) === containerRem,
    `容器宽不一致：CSS 变量 ${varContainer} vs EJS max-w-[${containerRem}rem]`);
}
if (asideW !== null && varAside) {
  check(`--layout-aside（${varAside}）= EJS 侧栏的 w-[...]（${asideW}px）`,
    Number(varAside.replace('px', '')) === asideW,
    `侧栏宽不一致：CSS 变量 ${varAside} vs EJS w-[${asideW}px]`);
}

/* L6 · 内边距分段必须与 EJS 的 sm:px-8 / xl:px-10 对应 */
const hasSmPad = /--aside-pad:\s*2rem/.test(themeCssSrc);     /* px-8 = 2rem */
const hasXlPad = /--aside-pad:\s*2\.5rem/.test(themeCssSrc);  /* px-10 = 2.5rem */
check('内边距分段与 EJS 的 sm:px-8 对应（2rem）',
  hasSmPad || !/sm\\:px-8/.test(themeEjsSrc),
  'EJS 用 sm:px-8（2rem），但 CSS 里没有 --aside-pad: 2rem');
check('内边距分段与 EJS 的 xl:px-10 对应（2.5rem）',
  hasXlPad || !/xl\\:px-10/.test(themeEjsSrc),
  'EJS 用 xl:px-10（2.5rem），但 CSS 里没有 --aside-pad: 2.5rem');

/* L7 · 渲染结果与源码一致 */
check('渲染结果里 aside 带 aside-fixed 类',
  /<aside[^>]*class="[^"]*\baside-fixed\b/.test(home.body),
  '服务端渲染出的 aside 没有 aside-fixed');
check('渲染结果里 aside 不再带 self-start / sticky',
  !/<aside[^>]*class="[^"]*\bself-start\b/.test(home.body) &&
  !/<aside[^>]*class="[^"]*\bsticky\b/.test(home.body),
  '服务端渲染出的 aside 仍带 self-start 或 sticky');

/* L8 · 两侧卡片内边距必须一致（用户发现：右侧留白比左侧小，观感不齐）
   —— 左侧文章卡是 `p-5 md:p-6`，右侧卡片若只写 `p-5`，
      ≥768px 时左侧 24px、右侧 20px，两侧内容边缘对不齐。 */
const leftCardPad = themeEjsSrc.match(
  /class="relative\s+p-(\d+)\s+md:p-(\d+)[^"]*rounded-xl[^"]*bg-white/,
);
const asideCardPad = themeEjsSrc.match(
  /<aside[\s\S]{0,400}?class="p-(\d+)(?:\s+md:p-(\d+))?\s+rounded-xl\s+bg-white/,
);
check('能从 EJS 读出左侧文章卡的内边距（p-N md:p-M）',
  leftCardPad !== null, '未匹配到左侧文章卡的 p-N md:p-M');
check('能从 EJS 读出侧栏卡片的内边距',
  asideCardPad !== null, '未匹配到 <aside> 内首张卡片的 p-*');
if (leftCardPad && asideCardPad) {
  const lBase = Number(leftCardPad[1]), lMd = Number(leftCardPad[2]);
  const aBase = Number(asideCardPad[1]);
  const aMd = asideCardPad[2] ? Number(asideCardPad[2]) : aBase;
  check(`两侧卡片内边距一致（左 p-${lBase} md:p-${lMd} / 右 p-${aBase} md:p-${aMd}）`,
    lBase === aBase && lMd === aMd,
    `两侧卡片内边距不一致 → ≥768px 时左侧 ${lMd * 4}px、右侧 ${aMd * 4}px，`
    + `内容边缘对不齐（用户报告的"右侧留白看起来不一致"）；`
    + `如需不同，请同步改 .smoke.js 的这条断言并说明理由`);
}

/* L9 · EJS 用的容器任意值类必须在 Tailwind 产物里有对应声明
   —— Tailwind 只扫描构建时的类名，EJS 里新写的 max-w-[92.5rem] 不会自动生成，
      漏了会静默退回无 max-width（页面变超宽），非常隐蔽。 */
if (containerRem !== null) {
  /* ⚠️ 别用 RegExp 拼转义 —— CSS 选择器里的 `[` `.` `]` 本身已被反斜杠转义
     （产物形态：.max-w-\[92\.5rem\]），再叠一层 JS 转义极易写错。
     直接用「字面量选择器字符串」在 CSS 源码里找（indexOf），稳且可读。 */
  const selLiteral = '.max-w-\\[' + String(containerRem).replace('.', '\\.') + 'rem\\]';
  const selIdx = themeCssSrc.indexOf(selLiteral);
  const after = selIdx >= 0 ? themeCssSrc.slice(selIdx, selIdx + 120) : '';
  check(`Tailwind 产物里有 .max-w-[${containerRem}rem] 的声明（否则该任意值类不生效）`,
    selIdx >= 0 && /max-width\s*:/.test(after),
    `CSS 里没有 ${selLiteral} 规则 —— 可能是还没跑 npm run build，`
    + `或该 class 没被 @source 白名单扫到（新增/改名模板文件要在 theme/src/input.css 补一条 @source）`);
}

/* ------------------------------------------------------------------
   M 段 · 暗色模式必须是「class 策略」，不能跟随系统
   ------------------------------------------------------------------
   本主题的明暗由 `<html class="dark">` 控制：头部内联脚本按 localStorage +
   prefers-color-scheme 决定是否去掉这个类，切换按钮 toggle 它；手写样式段也
   全部写成 `.dark .xxx`。**一整套都是 class 策略。**

   但 Tailwind v4 的 dark 变体**默认**编译成 `@media (prefers-color-scheme: dark)`
   —— 那是「跟随操作系统」。于是页面样式被劈成两半：
     一半听按钮（手写段 + html.dark），一半听系统（dark:* 工具类）。
   后果（用户 2026-10-09 报「白色主题有些字看不清」）：
     系统深色 + 页面切到浅色 → 背景变白，但 dark:text-zinc-400(#a1a1aa) /
     dark:text-zinc-500 等**仍在生效** → 浅灰字压在白底上，看不清。
   反向同理：系统浅色 + 页面切深色 → 深字（text-stone-800）压深底。

   修法：在 `theme/src/input.css` 声明
     `@custom-variant dark (&:where(.dark, .dark *));`
   本段把它锁死 —— 这行删掉后构建照样成功、页面也不报错，
   只在「系统主题与页面主题不一致」时错乱，属于极难排查的静默回归。
   ------------------------------------------------------------------ */
let themeInputCss = '';
try {
  themeInputCss = fs.readFileSync(path.join(config.themeDir, 'src', 'input.css'), 'utf8');
} catch { /* 下面断言会报错 */ }

check('input.css 声明了 dark 变体的 class 策略（@custom-variant dark）',
  /@custom-variant\s+dark\s*\(\s*&:where\(\s*\.dark\s*,\s*\.dark\s+\*\s*\)\s*\)/.test(themeInputCss),
  '缺少 `@custom-variant dark (&:where(.dark, .dark *));` —— '
  + 'Tailwind v4 默认把 dark: 编译成 @media (prefers-color-scheme:dark)（跟随系统），'
  + '而本主题的主题切换是 .dark 类策略，两者不一致时文字与背景会撞色');

check('CSS 产物里没有 prefers-color-scheme 的 dark 媒体查询',
  !/prefers-color-scheme\s*:\s*dark/.test(themeCssSrc),
  '产物里仍有 @media (prefers-color-scheme:dark) —— dark: 变体没走 class 策略。'
  + '系统深色时切到浅色主题 → 浅灰字（dark:text-zinc-400）压在白底上，看不清。'
  + '检查 theme/src/input.css 的 @custom-variant 是否还在');

check('dark: 工具类的选择器确实挂在 .dark 类上',
  themeCssSrc.indexOf('.dark\\:') >= 0 && /:where\(\.dark,\.dark \*\)/.test(themeCssSrc),
  '产物里找不到 `:where(.dark,.dark *)` —— dark: 变体没有绑定到 .dark 类');

check('EJS 头部有明暗初始化脚本（读 localStorage，防首屏闪白）',
  /localStorage\.getItem\('theme'\)/.test(themeEjsSrc),
  'EJS 头部缺少读 localStorage 的初始化脚本 —— 切换结果不持久化');

check('EJS 的 <html> 默认带 dark 类（内联脚本只负责"去掉"）',
  /<html[^>]*class="[^"]*\bdark\b/.test(themeEjsSrc),
  'html 默认不带 dark —— 内联脚本只做移除、不做添加，默认值改成浅色会让脚本逻辑反过来');

/* ------------------------------------------------------------------
   N 段 · 站内链接基址（linkBase = /share/）

   分享页里所有站内地址都必须拼成**绝对路径** /share/xxx：
     Trilium 的分享根是 /share/，但反向代理可以把整站映射到域名根
     （www.yihwang.top/ → note.yihwang.top/share/）。此时浏览器地址栏是 `/`，
     相对链接 ./xxx 会解析成 /xxx（少了 /share）→ 点文章 404。
   同一份基址两处使用，必须同源：
     · EJS 的 var linkBase        → 静态链接 / favicon 等托管资源
     · <body data-share-base>     → 主题 JS（搜索结果链接）
   本段锁死「没有相对链接」+「基址存在且一致」+「渲染结果里全是绝对路径」。

   ⚠️ 不要改用 `<base href>`：它会改 document.baseURI，导致 TOC 滚动高亮的
      `history.replaceState(null,'','#'+id)` 解析成 `/share/#id`（地址栏被改到
      首页），正文里裸 `#fragment`（脚注等）也会全部跳错。
   ------------------------------------------------------------------ */

/* 源码级断言前先剥掉注释：EJS 的 <!-- --> 与 <% %> 里都可能出现「反例字面量」
   （本段的说明注释里就写了 href="./…" / <base href> 这两个反面写法） */
const ejsNoComments = ejsSrc.replace(/<!--[\s\S]*?-->/g, '').replace(/<%[\s\S]*?%>/g, '');

check('EJS 声明了站内链接基址 linkBase = /share/',
  /var\s+linkBase\s*=\s*'\/share\/'/.test(ejsSrc),
  'EJS 里找不到 `var linkBase = \'/share/\'` —— 站内链接失去统一基址');

check('EJS 里不再有相对链接（href="./…"）',
  !/href="\.\//.test(ejsNoComments),
  'EJS 里仍有 href="./…" 形式的相对链接 —— 反向代理把站点映射到域名根时会解析到错误目录');

check('EJS 没有引入 <base href>（它会污染 replaceState / 裸 #锚点）',
  !/<base\b/i.test(ejsNoComments),
  '<base> 会改 document.baseURI：TOC 高亮的 history.replaceState(null,\'\',\'#id\') '
  + '会变成 /share/#id（地址栏跳到首页），正文里 #fragment 也会跳错。改用 linkBase 绝对路径');

check('EJS 给 <body> 下发了 data-share-base',
  /data-share-base="<%- esc\(linkBase\) %>"/.test(ejsSrc),
  '<body> 缺 data-share-base —— 主题 JS 拼搜索链接时会回落硬编码值，两处容易漂移');

check('主题 JS 从 data-share-base 取基址，且不再用 "./" 拼站内链接',
  /getAttribute\('data-share-base'\)/.test(jsSrc) && !/['"]\.\/['"]\s*\+/.test(jsSrc),
  '主题 JS 里仍有 \'./\' + id 之类的相对拼接 —— 搜索结果链接在代理域名根下会 404');

/* 渲染结果：首页 + 文章页都必须给 <body> 带上同一基址 */
check('首页 <body> 带 data-share-base="/share/"',
  home.body.includes('data-share-base="/share/"'),
  '首页缺 data-share-base');
check('子页面 <body> 也带 data-share-base="/share/"（不依赖属性继承）',
  post.body.includes('data-share-base="/share/"'),
  '文章页缺 data-share-base');

/* 所有绝对路径链接都必须落在分享前缀下（/rss.xml 是有意保留的例外） */
function absoluteHrefs(html) {
  return [...html.matchAll(/href="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((h) => h.startsWith('/') && h !== '/rss.xml');
}
const homeAbs = absoluteHrefs(home.body);
check('首页站内链接全部是绝对路径 /share/…',
  homeAbs.length > 0 && homeAbs.every((h) => h.startsWith(`${PREFIX}/`)),
  `异常链接：${homeAbs.filter((h) => !h.startsWith(`${PREFIX}/`)).join(', ') || '(无)'}`);
check('首页文章卡片指向 /share/<shareId>',
  homeAbs.some((h) => new RegExp(`^${PREFIX}/[\\w-]+$`).test(h)),
  '首页没有 /share/<shareId> 形式的文章链接');
check('子页面站内链接全部是绝对路径 /share/…',
  absoluteHrefs(post.body).every((h) => h.startsWith(`${PREFIX}/`)),
  `异常链接：${absoluteHrefs(post.body).filter((h) => !h.startsWith(`${PREFIX}/`)).join(', ') || '(无)'}`);

/* ------------------------------------------------------------------ */

console.log(`\n[smoke] 通过 ${pass} 项，失败 ${fail} 项\n`);
process.exit(fail ? 1 : 0);
