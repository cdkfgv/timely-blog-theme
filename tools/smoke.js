/**
 * 主题回归 smoke test — 改完主题跑一次（需要 share-tool 已在运行）
 *
 *   npm run smoke                 # 默认 http://localhost:4321
 *   BASE=http://localhost:4321 POST_ID=post0000005 npm run smoke
 *
 * 覆盖：
 *   A. 内联脚本转义（`</script>` 不得提前闭合 BLOG_DATA）
 *   B. 页面标题（不重复、含 tag/category、详情页不被覆盖）
 *   C. 路由与标题锚点不打架（锚点 hash 不触发回顶部 / 不触发 404 路由）
 *   D. 拼写回归（不得再出现 fiexd）
 *   E. 主题静态资源可访问
 *   F. 资源加载策略（无自动回退，CDN 地址保留）
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const BASE = (process.env.BASE || `http://localhost:${config.port}`).replace(/\/+$/, '');
const PREFIX = config.shareUrlPrefix;
const POST_ID = process.env.POST_ID || 'post0000005';
const SCRIPT_TAG_END = '</scr' + 'ipt>';

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

/** 从渲染出的 HTML 里取 window.BLOG_DATA（对象字面量，值已是 JSON 串） */
function parseBlogData(html) {
  const i = html.indexOf('window.BLOG_DATA = ');
  if (i < 0) return null;
  const j = html.indexOf(SCRIPT_TAG_END, i);
  if (j < 0) return null;
  try {
    // eslint-disable-next-line no-new-func
    return { data: new Function(`return ${html.slice(i + 18, j)}`)(), blockEnd: j, ok: true };
  } catch (err) {
    return { data: null, blockEnd: j, ok: false, error: err.message };
  }
}

/* ------------------------------------------------------------------ */
/* A/B/C/D/E                                                           */
/* ------------------------------------------------------------------ */

console.log(`\n[smoke] base=${BASE}${PREFIX}/  post=${POST_ID}\n`);

// ---- A. 转义 ----
console.log('A. 内联脚本转义');
const post = await get(`${BASE}${PREFIX}/${POST_ID}`);
if (post.status !== 200) {
  console.log(`  ! 跳过（${POST_ID} 返回 ${post.status}，real 模式可设 POST_ID=<含 </script> 的笔记>）`);
} else {
  const parsed = parseBlogData(post.body);
  check('BLOG_DATA 可整体求值', parsed?.ok, parsed?.error);
  if (parsed?.ok) {
    const raw = post.body.slice(post.body.indexOf('window.BLOG_DATA = '), parsed.blockEnd);
    check('正文里的 </script> 已转义（块内不含裸标签）', !raw.includes(SCRIPT_TAG_END));
    check('BLOG_DATA 后紧跟 <head>（无 JSON 文本泄漏）',
      /^\s*<head>/.test(post.body.slice(parsed.blockEnd + SCRIPT_TAG_END.length)));
    if (typeof parsed.data.content === 'string' && parsed.data.content.includes(SCRIPT_TAG_END)) {
      check('转义可逆：还原后仍是真实 </script> 文本', true);
    } else {
      console.log('  ! 该笔记正文未含 </script>，跳过可逆性检查');
    }
  }
}

// ---- B. 服务端标题 ----
console.log('\nB. 页面标题（服务端）');
const home = await get(`${BASE}${PREFIX}/`);
check('首页 200', home.status === 200);
const homeTitle = (home.body.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
const siteName = homeTitle.trim();
check(`首页标题不重复（当前 "${homeTitle}"）`, siteName.length > 0 && !/^(.+?) - \1$/.test(homeTitle));
if (post.status === 200) {
  const postTitle = (post.body.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  check(`详情页标题为「笔记名 - 站点名」（当前 "${postTitle}"）`,
    postTitle !== siteName && postTitle.endsWith(` - ${siteName}`));
}

// ---- C. 路由/标题逻辑（源码级，直接跑主题 JS 里的函数） ----
console.log('\nC. 路由与标题锚点（主题 JS 源码级）');
const jsPath = path.join(config.themeDir, config.jsFile);
const jsSrc = fs.readFileSync(jsPath, 'utf8');
const start = jsSrc.indexOf('// 标题锚点');
const end = jsSrc.indexOf('function updateProgress');
if (start < 0 || end < 0) {
  check('能在主题 JS 里定位到路由/标题函数', false, `${jsPath}`);
} else {
  const snippet = jsSrc.slice(start, end);

  // 把主题里的路由/标题函数放进沙箱跑，location / window.scrollTo / document.title 全部可控
  const makeHarness = ({ isPostPage = false, initialTitle = 'SERVER-RENDERED' } = {}) => {
    const state = { scrolled: 0, title: initialTitle };
    const G = { isPostPage, route: { name: 'home', params: {} } };
    const api = new Function(
      'window', 'document', 'location', 'G', 'decodeURIComponent',
      `${snippet}
       return {
         isAnchorHash: isAnchorHash,
         route: function () { return G.route; },
         title: function () { return document.title; },
         scrolled: function () { return window.__scrolled; },
         run: function (h) { location.hash = h; updateRoute(); }
       };`,
    )(
      {
        BLOG_DATA: { site: { name: 'Timely' } },
        scrollTo: () => { state.scrolled++; },
        get __scrolled() { return state.scrolled; },
      },
      { get title() { return state.title; }, set title(v) { state.title = v; } },
      { hash: '' },
      G,
      decodeURIComponent,
    );
    return api;
  };

  const cases = [
    ['', 'Timely'],
    ['#/', 'Timely'],
    ['#/archive', '归档 - Timely'],
    ['#/tags', '标签 - Timely'],
    ['#/tag/' + encodeURIComponent('Vue'), '标签：Vue - Timely'],
    ['#/category/' + encodeURIComponent('前端'), '分类：前端 - Timely'],
    ['#/about', '关于 - Timely'],
    ['#/nope', '404 - Timely'],
  ];
  for (const [hash, expect] of cases) {
    const api = makeHarness();
    api.run(hash);
    check(`hash="${hash || '(空)'}" → title "${expect}"`, api.title() === expect, `实际 "${api.title()}"`);
  }

  // 标题锚点：不触发回顶部、不参与路由
  const anchor = makeHarness();
  anchor.run('#heading-3');
  check('标题锚点不回顶部', anchor.scrolled() === 0, `scrollTo 调用 ${anchor.scrolled()} 次`);
  check('标题锚点不改变路由与标题', anchor.route().name === 'home' && anchor.title() === 'Timely');
  check('isAnchorHash 判定正确',
    anchor.isAnchorHash('#heading-3') && !anchor.isAnchorHash('#/')
    && !anchor.isAnchorHash('#') && !anchor.isAnchorHash(''));

  // 路由切换仍要回顶部
  const routeSwitch = makeHarness();
  routeSwitch.run('#/archive');
  check('路由切换仍回顶部', routeSwitch.scrolled() === 1, `scrollTo 调用 ${routeSwitch.scrolled()} 次`);

  // 详情页：服务端标题不被客户端覆盖
  const detailPage = makeHarness({ isPostPage: true, initialTitle: '文章名 - Timely' });
  detailPage.run('');
  check('详情页标题不被客户端覆盖', detailPage.title() === '文章名 - Timely', `实际 "${detailPage.title()}"`);
}

// ---- D. 拼写回归 ----
console.log('\nD. 拼写与字段回归');
check('渲染结果里不再出现 fiexd', !/fiexd/i.test(home.body + (post.body || '')));
const homeData = parseBlogData(home.body);
check('BLOG_DATA 暴露 fixedPages 字段', Array.isArray(homeData?.data?.fixedPages));
check('主题源码里不再出现 fiexd', !/fiexd/i.test(jsSrc + fs.readFileSync(path.join(config.themeDir, config.ejsFile), 'utf8')));

// ---- E. 静态资源 ----
console.log('\nE. 主题静态资源');
for (const [file, typeHint] of [[config.cssFile, /^text\/css/], [config.jsFile, /javascript/]]) {
  const res = await fetch(`${BASE}${PREFIX}/theme/${file}`);
  const ct = res.headers.get('content-type') || '';
  check(`GET /theme/${file} → 200 且 MIME 正确`, res.status === 200 && typeHint.test(ct), `status=${res.status} ct=${ct}`);
}

// ---- F. 资源加载策略 ----
console.log('\nF. 资源加载策略（开发期引用 Trilium 托管资源，发布期切 CDN）');
const ejsSrc = fs.readFileSync(path.join(config.themeDir, config.ejsFile), 'utf8');
check('EJS 开发形态：引用 ~shareCss / ~shareJs',
  /getRelations\("shareCss"\)/.test(ejsSrc) && /getRelations\("shareJs"\)/.test(ejsSrc),
  'EJS 里未找到 shareCss / shareJs 循环');
check('EJS 保留 CDN 发布形态（已注释）',
  /<!--[\s\S]{0,400}?timely-theme\.css[\s\S]{0,400}?-->/.test(ejsSrc) &&
  /<!--[\s\S]{0,400}?timely-theme\.js[\s\S]{0,400}?-->/.test(ejsSrc),
  'EJS 里未找到被注释的 CDN 引用');
check('无自动回退逻辑（无 onerror / 动态注入）',
  !home.body.includes('onerror="this.onerror=null') && !/onerror="\(function\(\)/.test(home.body),
  '检测到回退属性');

const homeAssets = home.body.match(/<link[^>]+href="api\/notes\/[^"]+\/download"[^>]*>|<script[^>]+src="api\/notes\/[^"]+\/download"[^>]*>/g) || [];
check('首页主题资源已本地化（无 api/notes 引用）', homeAssets.length === 0, `仍有 ${homeAssets.length} 处：${homeAssets[0] || ''}`);
check(`首页注入本地 CSS（${PREFIX}/theme/${config.cssFile}）`,
  new RegExp(`<link[^>]+href="${PREFIX}/theme/${config.cssFile}"`).test(home.body));
check(`首页注入本地 JS（${PREFIX}/theme/${config.jsFile}，保持 module）`,
  new RegExp(`<script type="module" src="${PREFIX}/theme/${config.jsFile}"></script>`).test(home.body),
  '未找到 type="module" 的主题脚本');
check('注释里的 CDN 发布形态保持原样', /<!--[\s\S]*?cdn\.jsdmirror\.com[\s\S]*?-->/.test(home.body), '注释内容被误改写');

// 子页面同样要有样式 —— 验证 ~shareCss / ~shareJs 关系的「可继承」生效
const sub = await get(`${BASE}${PREFIX}/post0000001`);
const subAssets = sub.body.match(/<link[^>]+href="api\/notes\/[^"]+\/download"[^>]*>|<script[^>]+src="api\/notes\/[^"]+\/download"[^>]*>/g) || [];
check('子页面主题资源已本地化', subAssets.length === 0, `仍有 ${subAssets.length} 处`);
check('子页面继承到主题资源（关系需勾「可继承」）',
  new RegExp(`<link[^>]+href="${PREFIX}/theme/${config.cssFile}"`).test(sub.body),
  '子页面没有主题 CSS —— 关系没继承');

/* ------------------------------------------------------------------ */

console.log(`\n[smoke] 通过 ${pass} 项，失败 ${fail} 项\n`);
process.exit(fail ? 1 : 0);
