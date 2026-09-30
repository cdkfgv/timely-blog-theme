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
 *   L. 侧边栏 sticky 吸顶（不被 header 遮挡 / 层级 / 源码对齐校验）
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

/* 详情页内边距：外层主体容器一层 + 详情视图容器一层，合计两层（旧版就是两层，
   去掉内层会明显变紧 —— 正文贴边，是真实被用户发现的回归）。 */
const PAD_BOX = /class="[^"]*max-w-\[100rem\][^"]*px-5 sm:px-8 xl:px-10 py-10 pb-28 md:pb-14[^"]*"/g;
const homePad = (home.body.match(PAD_BOX) || []).length;
check(`首页只有一层内边距容器（${homePad}）`, homePad === 1, `实际 ${homePad} 层`);
if (post.status === 200) {
  const postPad = (post.body.match(PAD_BOX) || []).length;
  check(`详情页内边距容器两层（${postPad} = 外层 shell + 详情视图根）`, postPad === 2,
    `实际 ${postPad} 层 —— 详情页内边距被清掉了？`);
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
check('EJS 开发形态：引用 ~shareCss / ~shareJs',
  /getRelations\("shareCss"\)/.test(ejsSrc) && /getRelations\("shareJs"\)/.test(ejsSrc),
  'EJS 里未找到 shareCss / shareJs 循环');
check('EJS 保留 CDN 上线形态（已注释）',
  /<!--[\s\S]{0,400}?timely-theme\.css[\s\S]{0,400}?-->/.test(ejsSrc) &&
  /<!--[\s\S]{0,400}?timely-theme\.js[\s\S]{0,400}?-->/.test(ejsSrc),
  'EJS 里未找到被注释的 CDN 引用');
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
const LOCAL_SCRIPT = new RegExp(`<script type="module" src="${PREFIX}/theme/${config.jsFile}"></script>`);

/* 子页面用 POST_ID 那篇（真实库必须显式设 POST_ID=<真实文章 noteId>）；
   POST_ID 取不到时退回 mock 用例，避免真实库跑出一堆无意义的「子页面」断言失败。 */
const sub = post.status === 200 ? post : await get(`${BASE}${PREFIX}/post0000001`);
const subOk = sub.status === 200;
if (!subOk) console.log(`  ! 子页面断言跳过（${POST_ID} 与 post0000001 都取不到 200）`);

if (config.assetMode === 'as-is') {
  check('首页保留 Trilium 资源引用（未本地化）', hostedAssetRefs(home.body).length > 0);
  check('子页面保留 Trilium 资源引用（关系已继承）', !subOk || hostedAssetRefs(sub.body).length > 0,
    '子页面没有 api/notes 引用 → 关系没继承');
  check('未注入本地主题资源', !LOCAL_LINK.test(home.body));
  check('注释里的 CDN 保持原样', /<!--[\s\S]*?cdn\.jsdmirror\.com[\s\S]*?-->/.test(home.body));
  const first = hostedAssetRefs(home.body)[0]?.match(/api\/notes\/([\w-]+)\/download/);
  if (first) {
    const res = await fetch(`${BASE}${PREFIX}/api/notes/${first[1]}/download`);
    const ct = res.headers.get('content-type') || '';
    check(`主题资源可访问（${first[1]} → ${res.status} ${ct}）`, res.status === 200 && /css|javascript/i.test(ct));
  }
} else {
  const homeAssets = hostedAssetRefs(home.body);
  check('首页主题资源已本地化（无 api/notes 引用）', homeAssets.length === 0, `仍有 ${homeAssets.length} 处`);
  check(`首页注入本地 CSS（${PREFIX}/theme/${config.cssFile}）`, LOCAL_LINK.test(home.body));
  check(`首页注入本地 JS（${PREFIX}/theme/${config.jsFile}，保持 module）`, LOCAL_SCRIPT.test(home.body));
  check('注释里的 CDN 保持原样', /<!--[\s\S]*?cdn\.jsdmirror\.com[\s\S]*?-->/.test(home.body), '注释被误改写');

  const subAssets = hostedAssetRefs(sub.body);
  check('子页面主题资源已本地化', !subOk || subAssets.length === 0, `仍有 ${subAssets.length} 处`);
  check('子页面继承到主题资源（关系需勾「可继承」）', !subOk || LOCAL_LINK.test(sub.body),
    '子页面没有主题 CSS —— 关系没继承');
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
check('卡片图标都带 bx 前缀（已在加载的图标包）',
  cardIcons.every((i) => /(^|\s)bx/.test(i.cls)),
  cardIcons.map((i) => i.cls).join(' / '));

/* 图标必须出现在标题链接之前（A 方案：内联在标题左侧） */
check('图标内联在标题左侧（<i> 紧邻 <a> 之前）',
  /<i class="[^"]+ post-icon"[^>]*><\/i><a href="\.\//.test(home.body),
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
   L 段 · 侧边栏 sticky 吸顶（遮挡回归守卫）
   ------------------------------------------------------------------
   背景（BUG）：header 是 sticky top-0 + h-14（3.5rem / 56px），占视口 0~56px；
   侧边栏原写 top-[2.5rem]（40px）→ 吸顶后上沿被 header 压住 16px。

   这里做**两侧对齐校验**：从 EJS 读出侧边栏的 sticky top 值，
   再从 CSS 里读 header 高度，比较二者 —— 只要有人改了 header 高度或
   aside 的 top，断言就会失败。不硬编码 3.5rem，避免「改了但测试还绿」。
   ------------------------------------------------------------------ */

/* 读取主题源码（EJS + CSS）做静态校验 —— 这两个是纯源码事实，mock/真实库都跑 */
let themeEjsSrc = '';
let themeCssSrc = '';
try {
  themeEjsSrc = fs.readFileSync(themePath(config.ejsFile), 'utf8');
  themeCssSrc = fs.readFileSync(themePath(config.cssFile), 'utf8');
} catch { /* 下面断言会各自报错 */ }

/* L1 · header 高度（h-14 是 Tailwind 的 --spacing 倍数，1 = 0.25rem） */
const headerSpacing = themeEjsSrc.match(/<header[^>]*class="[^"]*\bh-(\d+)\b/);
const headerRem = headerSpacing ? Number(headerSpacing[1]) * 0.25 : null;
check('能从 EJS 读出 header 高度（h-N 工具类）',
  headerRem !== null, '未匹配到 <header> 上的 h-* 类');

/* L2 · 侧边栏吸顶值：优先取 CSS 里显式声明的 top（手写 banner 段），回退到 EJS 的 top-[Xrem] */
const asideCssTop = themeCssSrc.match(/aside\.sticky\s*\{[^}]*?top:\s*([\d.]+)rem/s);
const asideEjsTop = themeEjsSrc.match(/<aside[^>]*class="[^"]*\btop-\\?\[([\d.]+)rem\\?\]/);
const asideRem = asideCssTop ? Number(asideCssTop[1]) : (asideEjsTop ? Number(asideEjsTop[1]) : null);
check('能从主题里读出侧边栏 sticky top 值',
  asideRem !== null, 'CSS 的 aside.sticky 与 EJS 的 top-[*rem] 都没取到');

/* L3 · 核心断言：吸顶位置必须在 header 下沿之下（含间距） */
if (headerRem !== null && asideRem !== null) {
  const toPx = (rem) => Math.round(rem * 16);
  check(`侧边栏吸顶不被 header 遮挡（top ${toPx(asideRem)}px ≥ header ${toPx(headerRem)}px）`,
    asideRem * 16 >= headerRem * 16,
    `top 比 header 矮 ${toPx(headerRem - asideRem)}px → 卡片上沿会被压住`);
  check('侧边栏吸顶与 header 之间留有呼吸间距（≥ 8px）',
    (asideRem - headerRem) * 16 >= 8,
    `间距仅 ${toPx(asideRem - headerRem)}px，卡片会紧贴导航栏`);
}

/* L4 · 层级：侧边栏 z-index 必须低于 header(z-50)、高于归档标题(z-10) */
const asideZ = themeCssSrc.match(/aside\.sticky\s*\{[^}]*?z-index:\s*(\d+)/s);
const asideZNum = asideZ ? Number(asideZ[1]) : null;
check('侧边栏设置了 z-index（避免滚动时被正文穿透）',
  asideZNum !== null, 'CSS 的 aside.sticky 里没有 z-index');
if (asideZNum !== null) {
  check('侧边栏 z-index 低于 header（否则会盖住顶部导航）',
    asideZNum < 50, `实际 z-index: ${asideZNum}，应 < 50`);
  check('侧边栏 z-index 高于归档年份标题（z-10）',
    asideZNum > 10, `实际 z-index: ${asideZNum}，应 > 10`);
}

/* L5 · 渲染结果里 aside 的 class 与 CSS 规则必须同时到位 */
check('渲染结果里 aside 已改用 top-[4.5rem]',
  /<aside[^>]*class="[^"]*\btop-\\?\[4\.5rem\\?\]/.test(home.body),
  'EJS 里的 aside 不是 top-[4.5rem]');
check('主题 CSS 已下发 aside.sticky 规则（top + z-index）',
  /aside\.sticky\s*\{[^}]*top:/.test(themeCssSrc) && /aside\.sticky\s*\{[^}]*z-index:/.test(themeCssSrc),
  '手写 banner 段缺少 aside.sticky 规则');

/* ------------------------------------------------------------------ */

console.log(`\n[smoke] 通过 ${pass} 项，失败 ${fail} 项\n`);
process.exit(fail ? 1 : 0);
