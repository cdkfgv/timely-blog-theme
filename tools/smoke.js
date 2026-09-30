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
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

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

/* ------------------------------------------------------------------ */

console.log(`\n[smoke] 通过 ${pass} 项，失败 ${fail} 项\n`);
process.exit(fail ? 1 : 0);
