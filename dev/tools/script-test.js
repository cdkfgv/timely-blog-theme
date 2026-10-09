/**
 * templateScript.js（Trilium ~runOnAttributeChange 脚本）行为测试
 *
 *   npm run script-test
 *
 * Trilium 脚本无法直接 import：它在 Trilium 的 Script 环境里执行，依赖全局 `api`，
 * 且有顶层 return。这里用 new Function('api', src) 复刻那个环境 + 打桩的 note。
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const src = fs.readFileSync(path.join(config.themeDir, 'templateScript.js'), 'utf8');

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

/** 跑一次脚本，返回写入的标签、save 次数 */
function run({ content, labels = {}, attrName = 'publish', isDeleted = false }) {
  const store = new Map(Object.entries(labels));
  const written = [];
  let saves = 0;
  const note = {
    getLabelValue: (n) => (store.has(n) ? store.get(n) : null),
    getLabelValues: (n) => (store.has(n) ? [store.get(n)] : []),
    hasLabel: (n) => store.has(n),
    setLabel: (n, v) => { store.set(n, v); written.push([n, v]); },
    save: () => { saves++; },
    getContent: () => content,
  };
  const api = { originEntity: { isDeleted, name: attrName, getNote: () => note } };
  new Function('api', src)(api);
  return { store, written, saves };
}

const summaryOf = (content, labels) => {
  const { store } = run({ content, labels });
  return store.get('blogSummary');
};

console.log('\n[script-test] templateScript.js\n');

console.log('A. publish=true 时的写入');
{
  const r = run({ content: '<h2>标题</h2><p>正文。</p>', labels: { publish: 'true' } });
  check('写了 blogSummary', r.store.get('blogSummary') === '标题正文。', String(r.store.get('blogSummary')));
  check('补了 blogDate（yyyy-MM-dd）', /^\d{4}-\d{2}-\d{2}$/.test(r.store.get('blogDate')), String(r.store.get('blogDate')));
  check('调用了 note.save()', r.saves === 1, `saves=${r.saves}`);
}
{
  const r = run({ content: '<p>x</p>', labels: { publish: 'true', blogDate: '2020-01-02' } });
  check('已有 blogDate 不被覆盖', r.store.get('blogDate') === '2020-01-02');
}
check('短文不加省略号', summaryOf('<p>短。</p>', { publish: 'true' }) === '短。');

console.log('\nB. publish != true 时不动笔记');
{
  const r = run({ content: '<p>草稿内容。</p>', labels: { publish: 'false' } });
  check('不写 blogSummary', !r.store.has('blogSummary'));
  check('不补 blogDate', !r.store.has('blogDate'));
  check('不调用 note.save()', r.saves === 0, `saves=${r.saves}`);
}
{
  const r = run({ content: '<p>草稿内容。</p>', labels: {} });
  check('没有 publish 标签时也不动', !r.store.has('blogSummary') && r.saves === 0);
}

console.log('\nC. 触发条件过滤');
{
  const r = run({ content: '<p>x</p>', labels: { publish: 'true' }, attrName: 'blogDate' });
  check('非 publish 属性变更直接返回', !r.store.has('blogSummary') && r.saves === 0);
}
{
  const r = run({ content: '<p>x</p>', labels: { publish: 'true' }, isDeleted: true });
  check('已删除的笔记直接返回', !r.store.has('blogSummary'));
}

console.log('\nD. 摘要提取：剥噪声块');
check('代码块不进摘要',
  summaryOf('<h2>标题</h2><p>正文开始。</p><pre><code>const x = 1;</code></pre><p>结尾。</p>', { publish: 'true' })
    === '标题正文开始。结尾。');
check('<pre> 套 <code> 整体剥掉',
  !String(summaryOf('<p>甲</p><pre><code>const y = 2;</code></pre><p>乙</p>', { publish: 'true' })).includes('const'));
check('<script> 内容不进摘要',
  !String(summaryOf('<p>甲</p><script>window.a=1;</script><p>乙</p>', { publish: 'true' })).includes('window.a'));
check('<style> 内容不进摘要',
  !String(summaryOf('<p>甲</p><style>.a{color:red}</style><p>乙</p>', { publish: 'true' })).includes('color:red'));
check('<table> 内容不进摘要',
  !String(summaryOf('<p>甲</p><table><tr><td>单元格</td></tr></table><p>乙</p>', { publish: 'true' })).includes('单元格'));

console.log('\nE. 摘要提取：空白与实体');
check('英文单词不被粘连（保留单空格）',
  summaryOf('<p>hello   world</p>', { publish: 'true' }) === 'hello world');
check('块级标签之间按空格分隔（英文）',
  summaryOf('<p>first line</p><p>second line</p>', { publish: 'true' }) === 'first line second line');
check('中文之间的换行/缩进直接吃掉',
  summaryOf('<p>中文\n      段落</p>', { publish: 'true' }) === '中文段落');
check('中英混排保留必要空格',
  summaryOf('<p>用 Vue 写页面</p>', { publish: 'true' }) === '用 Vue 写页面',
  String(summaryOf('<p>用 Vue 写页面</p>', { publish: 'true' })));
check('&nbsp; 归一为空格', summaryOf('<p>a&nbsp;b</p>', { publish: 'true' }) === 'a b');
check('常见实体还原',
  summaryOf('<p>a &amp; b &lt;c&gt;</p>', { publish: 'true' }) === 'a & b <c>',
  String(summaryOf('<p>a &amp; b &lt;c&gt;</p>', { publish: 'true' })));

console.log('\nF. 截断');
{
  const long = '一'.repeat(200);
  const s = summaryOf(`<p>${long}</p>`, { publish: 'true' });
  check('超 120 字截断并加省略号', s.length === 123 && s.endsWith('...'), `len=${s.length}`);
  check('恰好 120 字不加省略号', summaryOf(`<p>${'一'.repeat(120)}</p>`, { publish: 'true' }).length === 120);
}

/* ------------------------------------------------------------------ */

console.log(`\n[script-test] 通过 ${pass} 项，失败 ${fail} 项\n`);

if (process.env.PRINT_SUMMARY === '1') {
  const sample = run({
    content: '<h2>问题</h2><p>每次改 EJS 都要复制进 Trilium，反馈太慢。</p><pre><code>const a=1;</code></pre><p>a &amp; b</p>',
    labels: { publish: 'true' },
  });
  console.log(`sample summary: ${sample.store.get('blogSummary')}\n`);
}

process.exit(fail ? 1 : 0);
