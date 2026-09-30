/**
 * 主题行为测试（jsdom）— 需要 share-tool 已在运行
 *
 *   npm run dom                    # 默认 http://localhost:4321
 *   BASE=http://localhost:4321 npm run dom
 *
 * 只加载「本地渲染结果 + 本地主题 JS」，剥离所有外部 script/link（不触网）。
 * 验证的是阶段 3 之后真实存在的客户端行为：hash 路由、导航高亮、折叠面板、
 * 分类下拉、主题切换、搜索、目录跳转、代码块包装、图片灯箱、回到顶部。
 */

import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { config, themePath } from '../config.js';

const BASE = (process.env.BASE || `http://localhost:${config.port}`).replace(/\/+$/, '');
const PREFIX = config.shareUrlPrefix;
const THEME_JS = fs.readFileSync(themePath(config.jsFile), 'utf8');

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

async function fetchPage(pathname) {
  const res = await fetch(`${BASE}${PREFIX}${pathname}`);
  if (res.status !== 200) throw new Error(`${pathname} → ${res.status}`);
  return res.text();
}

/** 把渲染结果挂进 jsdom，并执行本地主题脚本（不执行页面自带脚本、不加载外部资源） */
function mount(html, url) {
  const cleaned = html
    .replace(/<script[^>]*\bsrc=["'][^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<link[^>]*\brel=["']stylesheet["'][^>]*>/gi, '');
  const dom = new JSDOM(cleaned, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  // jsdom 未实现的滚动/观察者 API，补上最小桩，避免脚本因环境缺失而中断
  window.Element.prototype.scrollIntoView = function () {};
  window.scrollTo = function () {};
  window.eval(THEME_JS);
  return dom;
}

const panelOf = (d, name) => [...d.querySelectorAll('[data-view-panel]')]
  .find((el) => el.getAttribute('data-view-panel') === name);
const navOf = (d, name) => d.querySelector(`[data-nav="${name}"]`);
const fire = (w, el, type) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true }));
const goHash = (w, hash) => { w.location.hash = hash; w.dispatchEvent(new w.Event('hashchange')); };

/* ================================================================== */
/* A. 列表页：hash 路由 + 导航高亮 + 过滤                             */
/* ================================================================== */

console.log(`\n[dom] base=${BASE}${PREFIX}/\n`);
console.log('A. 列表页 hash 路由');
const home = mount(await fetchPage('/'), `${BASE}${PREFIX}/`);
const hw = home.window;
const hd = hw.document;

check('初始只显示首页面板',
  !panelOf(hd, 'home').hidden
  && ['archive', 'tags', 'tag', 'category', 'notfound'].every((n) => panelOf(hd, n).hidden));
check('初始导航高亮首页', navOf(hd, 'home').getAttribute('aria-current') === 'page');
check('初始 body[data-view]=home', hd.body.getAttribute('data-view') === 'home');

goHash(hw, '#/archive');
check('切到归档：面板切换正确', panelOf(hd, 'archive').hidden === false && panelOf(hd, 'home').hidden === true);
check('切到归档：标题更新', hd.title === '归档 - Timely', hd.title);
check('切到归档：高亮迁移',
  navOf(hd, 'archive').getAttribute('aria-current') === 'page'
  && !navOf(hd, 'home').hasAttribute('aria-current'));

goHash(hw, '#/tags');
check('切到标签总览', panelOf(hd, 'tags').hidden === false && hd.title === '标签 - Timely', hd.title);

goHash(hw, `#/tag/${encodeURIComponent('Vue')}`);
const tagPanel = panelOf(hd, 'tag');
const tagCards = tagPanel.querySelectorAll('[data-filter-list] article');
check('标签页过滤出 1 篇文章', tagCards.length === 1, `实际 ${tagCards.length} 篇`);
check('标签页回填标签名与数量',
  tagPanel.querySelector('[data-filter-name]').textContent === 'Vue'
  && tagPanel.querySelector('[data-filter-count]').textContent === '1');
check('标签页标题正确', hd.title === '标签：Vue - Timely', hd.title);
check('侧边栏当前标签高亮', hd.querySelector('[data-tag="Vue"]').getAttribute('aria-current') === 'page');
check('标签页高亮导航「标签」', navOf(hd, 'tags').getAttribute('aria-current') === 'page');

goHash(hw, `#/category/${encodeURIComponent('前端')}`);
check('分类页过滤出 1 篇文章',
  panelOf(hd, 'category').querySelectorAll('[data-filter-list] article').length === 1);
check('分类页标题正确', hd.title === '分类：前端 - Timely', hd.title);
check('分类页高亮导航「分类」', navOf(hd, 'category').getAttribute('aria-current') === 'page');

goHash(hw, '#/nope');
check('未知 hash → 404 面板', panelOf(hd, 'notfound').hidden === false && hd.title === '404 - Timely', hd.title);

goHash(hw, '#heading-x');
check('正文锚点不切视图（仍是 404）', panelOf(hd, 'notfound').hidden === false);

goHash(hw, '#/');
check('回到 #/ → 首页', panelOf(hd, 'home').hidden === false && hd.title === 'Timely');

/* ================================================================== */
/* B. 列表页交互                                                       */
/* ================================================================== */

console.log('\nB. 列表页交互');
const tagsToggle = hd.getElementById('tags-toggle');
const tagsPanel = hd.getElementById('tags-panel');
const tagsWasHidden = tagsPanel.hidden;
fire(hw, tagsToggle, 'click');
check('侧边栏标签面板可折叠',
  tagsPanel.hidden === !tagsWasHidden && tagsToggle.getAttribute('aria-expanded') === String(tagsWasHidden));

const ddToggle = hd.querySelector('[data-dropdown-toggle]');
const ddMenu = hd.querySelector('[data-dropdown-menu]');
fire(hw, ddToggle, 'click');
check('分类下拉可展开', ddMenu.hidden === false && ddToggle.getAttribute('aria-expanded') === 'true');
fire(hw, hd.body, 'click');
check('点击空白处关闭下拉', ddMenu.hidden === true);

const themeBtn = hd.getElementById('theme-toggle');
const wasDark = hd.documentElement.classList.contains('dark');
fire(hw, themeBtn, 'click');
check('主题切换翻转 dark 类', hd.documentElement.classList.contains('dark') === !wasDark);
check('主题偏好写入 localStorage', hw.localStorage.getItem('theme') === (!wasDark ? 'dark' : 'light'));
check('回到顶部初始隐藏', !hd.getElementById('back-to-top').classList.contains('is-visible'));

console.log('C. 搜索');
fire(hw, hd.querySelector('[data-search-open]'), 'click');
check('搜索弹窗打开', hd.getElementById('search-modal').hidden === false);
const searchInput = hd.getElementById('search-input');
const searchResults = hd.getElementById('search-results');

searchInput.value = 'NAS';
searchInput.dispatchEvent(new hw.Event('input', { bubbles: true }));
const rows = searchResults.querySelectorAll('a');
check('命中 1 条', rows.length === 1, `实际 ${rows.length} 条`);
check('命中链接指向正确文章', rows[0] && rows[0].getAttribute('href') === './post0000003', rows[0] && rows[0].getAttribute('href'));

searchInput.value = 'Vue';
searchInput.dispatchEvent(new hw.Event('input', { bubbles: true }));
searchInput.dispatchEvent(new hw.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
check('方向键选中第一项', !!searchResults.querySelector('[aria-selected="true"]'));

searchInput.value = 'zzz-不存在';
searchInput.dispatchEvent(new hw.Event('input', { bubbles: true }));
check('无结果时给提示', /没有找到相关文章/.test(searchResults.textContent));

fire(hw, hd.querySelector('[data-search-close]'), 'click');
check('关闭后清空并隐藏',
  hd.getElementById('search-modal').hidden === true && searchResults.textContent === '');

/* ================================================================== */
/* D. 文章页                                                           */
/* ================================================================== */

console.log('\nD. 文章页');
const post = mount(await fetchPage('/post0000001'), `${BASE}${PREFIX}/post0000001`);
const pw = post.window;
const pd = pw.document;

check('文章页没有视图面板（不走 hash 路由）', pd.querySelectorAll('[data-view-panel]').length === 0);
check('文章页导航保持首页高亮', navOf(pd, 'home').getAttribute('aria-current') === 'page');
check('代码块被包装', pd.querySelectorAll('#post-content .code-block').length === 1);
check('代码块显示语言', pd.querySelector('.code-header span')?.textContent === 'javascript',
  pd.querySelector('.code-header span')?.textContent);
check('代码块有复制按钮', !!pd.querySelector('.code-header .copy-btn'));
check('代码块已补 language-* 类',
  /class="language-javascript"/.test(pd.querySelector('#post-content code').outerHTML),
  pd.querySelector('#post-content code').outerHTML.slice(0, 80));
check('外链已加 target=_blank',
  [...pd.querySelectorAll('#post-content a[href]')].every((a) => a.hostname === 'localhost' ? true : a.target === '_blank'));

const img = pd.querySelector('#post-content img');
fire(pw, img, 'click');
check('点图片打开灯箱', pd.getElementById('lightbox').hidden === false);
check('灯箱写入图片地址', (pd.getElementById('lightbox-img').getAttribute('src') || '').length > 0);
fire(pw, pd.getElementById('lightbox'), 'click');
check('点灯箱关闭', pd.getElementById('lightbox').hidden === true);

const copyBtn = pd.querySelector('.code-header .copy-btn');
let copyThrew = false;
try { fire(pw, copyBtn, 'click'); } catch (err) { copyThrew = true; }
check('点复制按钮不抛异常（无 clipboard API 时走降级）', !copyThrew);

const jump = pd.querySelector('[data-toc-jump]');
let jumpThrew = false;
try { fire(pw, jump, 'click'); } catch (err) { jumpThrew = true; }
check('点移动端目录项不抛异常', !jumpThrew);
check('点移动端目录项后收起抽屉', pd.getElementById('mtoc-panel').hidden === true);

const tocToggle = pd.getElementById('toc-toggle');
const tocPanel = pd.getElementById('toc-panel');
const tocWasHidden = tocPanel.hidden;
fire(pw, tocToggle, 'click');
check('侧边栏目录面板可折叠',
  tocPanel.hidden === !tocWasHidden && tocToggle.getAttribute('aria-expanded') === String(tocWasHidden));

console.log('\nE. 无 TOC 的文章页（单标题）');
const post3 = mount(await fetchPage('/post0000003'), `${BASE}${PREFIX}/post0000003`);
const p3d = post3.window.document;
check('单标题文章仍渲染目录（>1 才算多级）', p3d.getElementById('post-content').textContent.includes('拓扑'));
check('无多级目录时不渲染移动端抽屉', !p3d.getElementById('mtoc-panel'));

/* ------------------------------------------------------------------ */

console.log(`\n[dom] 通过 ${pass} 项，失败 ${fail} 项\n`);
process.exit(fail ? 1 : 0);
