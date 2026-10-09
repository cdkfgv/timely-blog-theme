/**
 * 产出「可直接被 CDN 引用」的压缩产物 → 仓库根目录
 *
 *   npm run build     # 完整链路：先 Tailwind 编译 CSS，再跑本脚本
 *   npm run min       # 只跑本脚本（假定 theme/TimelyBlogTheme.css 已是最新）
 *
 * 输入 → 输出（顺手完成改名 + 落到仓库根，CDN 地址就是对得上的）：
 *   theme/TimelyBlogTheme.css   Tailwind --minify 产物（已单行压缩） → timely-blog-theme.min.css（原样拷贝）
 *   theme/TimelyBlogTheme.js    手写源（未压缩）                     → timely-blog-theme.min.js（terser 压缩）
 *
 * 为什么要单独出一份 min（而不是就地覆盖 theme/ 下的文件）：
 *   theme/TimelyBlogTheme.js 是**手写源**，就地压缩会丢掉唯一可读版本；
 *   而 CDN 上文件名是 timely-blog-theme.min.*（见 EJS 的 <link>/<script>），与本仓库源文件不同名。
 *
 * ⚠️ 产物**进版本库**（不在 .gitignore 里）：
 *   jsDelivr / jsdmirror 只提供「仓库里已提交的文件」，不提交等于外网引用不到。
 *   所以改完主题必须 `npm run build` 并**把这两个 min 文件一起提交**。
 *
 * 本脚本自带守卫（任一不过就非零退出，避免把坏产物推上 CDN）：
 *   ① CSS 必须是 Tailwind 压缩产物（banner + 单行压缩体）——否则说明构建漏了 --minify
 *   ② JS 压缩后语法必须可解析、体积必须小于源、EJS/CSS 依赖的选择器字符串必须全部存活
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { minify } from 'terser';
import { config, themePath } from '../config.js';

const OUT_DIR = config.min.dir;

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const shortHash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const gzipSize = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
const bytes = (s) => Buffer.byteLength(s);

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  \u2713 ${name}`);
    return true;
  }
  failed += 1;
  console.log(`  \u2717 ${name}${detail ? `\n      ${detail}` : ''}`);
  return false;
}

/**
 * JS 压缩后必须仍然含有的字符串 —— 全部取自 getElementById(...) / [data-*] 这类**字面量**：
 * terser 只改标识符、绝不动字符串，所以源里有、压缩后就必须还在。
 * 这些是 EJS 与 CSS 共同依赖的「契约」，掉一个页面就静默失灵。
 */
const JS_CONTRACT = [
  'theme-toggle', 'hljs-light', 'hljs-dark',
  'search-modal', 'reading-progress', 'back-to-top',
  'data-view-panel', 'data-toc-jump', 'data-toggle',
];

/** CSS 里必须仍然存在的关键声明（布局联动变量 + 侧栏定位规则） */
const CSS_CONTRACT = ['--layout-aside', '--layout-container', 'aside.aside-fixed'];

console.log('\n[min] 打包 CDN 产物\n');

/* ==================== 1. 读输入 ==================== */
const cssIn = themePath(config.cssFile);
const jsIn = themePath(config.jsFile);
for (const f of [cssIn, jsIn]) {
  if (!fs.existsSync(f)) {
    console.error(`缺少输入文件：${f}`);
    process.exit(1);
  }
}
const cssSrc = fs.readFileSync(cssIn, 'utf8');
const jsSrc = fs.readFileSync(jsIn, 'utf8');

console.log('输入');
console.log(`  ${config.cssFile.padEnd(26)} ${kb(bytes(cssSrc)).padStart(9)}  gzip ${kb(gzipSize(Buffer.from(cssSrc)))}`);
console.log(`  ${config.jsFile.padEnd(26)} ${kb(bytes(jsSrc)).padStart(9)}  gzip ${kb(gzipSize(Buffer.from(jsSrc)))}`);

/* ==================== 2. CSS：校验后原样拷贝 ==================== */
/* Tailwind --minify 的产物形如「banner 行 + 换行 + 单行压缩体」（v4 会在 banner 后留一个 \n），
   所以判据是「除 banner 外只有一行」；出现更多换行说明跑的是未压缩构建。
   CSS 不再二次处理 —— 保持逐字节一致，样式正确性由既有的 smoke 断言（读同一份 CSS）兜底。 */
console.log('\nCSS');
const cssBodyLines = cssSrc.replace(/^\/\*![^\n]*\r?\n/, '').trimEnd().split('\n').length;
check(
  '是 Tailwind 压缩产物（banner + 单行压缩体）',
  /^\/\*! tailwindcss/.test(cssSrc) && cssBodyLines === 1,
  `除 banner 外 ${cssBodyLines} 行，开头 ${JSON.stringify(cssSrc.slice(0, 48))}  ← 请先 npm run build:css`,
);
check(
  `关键声明存活（${CSS_CONTRACT.join(' / ')}）`,
  CSS_CONTRACT.every((s) => cssSrc.includes(s)),
  `缺失 ${JSON.stringify(CSS_CONTRACT.filter((s) => !cssSrc.includes(s)))}`,
);

/* ==================== 3. JS：terser 压缩 ==================== */
console.log('\nJS');
const t0 = Date.now();
let result;
try {
  result = await minify(jsSrc, {
    ecma: 5,                 // 源是纯 ES5（无箭头函数/let/const/模板串），产物也保持 ES5 兼容
    compress: { passes: 3 }, // 多压一轮，比默认单轮再小一点
    mangle: true,
    format: { comments: false },
  });
} catch (err) {
  console.error(`terser 压缩失败：${err.message}`);
  process.exit(1);
}
if (!result || !result.code) {
  console.error('terser 没有返回内容');
  process.exit(1);
}
const ms = Date.now() - t0;

const jsBanner = `/*! ${config.min.js} — Trilium 分享主题前端脚本（terser 压缩产物，勿手改；源码 theme/${config.jsFile}） */\n`;
const jsOut = `${jsBanner}${result.code.trim()}\n`;

check('压缩后语法可解析', (() => {
  try { new Function(jsOut); return true; } catch { return false; }
})(), '产物有语法错误，浏览器会整个脚本不执行');
check('压缩后是单行', result.code.trimEnd().split('\n').length === 1);
check(
  `EJS/CSS 依赖的选择器字面量全部存活（${JS_CONTRACT.length} 个）`,
  JS_CONTRACT.every((s) => jsOut.includes(s)),
  `缺失 ${JSON.stringify(JS_CONTRACT.filter((s) => !jsOut.includes(s)))}`,
);
check(
  '体积小于源',
  bytes(jsOut) < bytes(jsSrc),
  `${kb(bytes(jsOut))} ≥ ${kb(bytes(jsSrc))}`,
);

/* ==================== 4. 写出 ==================== */
fs.mkdirSync(OUT_DIR, { recursive: true });
const cssOutFile = path.join(OUT_DIR, config.min.css);
const jsOutFile = path.join(OUT_DIR, config.min.js);
fs.writeFileSync(cssOutFile, cssSrc);
fs.writeFileSync(jsOutFile, jsOut);

/* ==================== 5. 报告 ==================== */
const rows = [
  { label: 'CSS', name: config.min.css, from: cssSrc, out: cssSrc, note: 'Tailwind 已压缩，原样拷贝' },
  { label: 'JS', name: config.min.js, from: jsSrc, out: jsOut, note: `terser ${ms}ms` },
];

console.log(`\n输出 → ${OUT_DIR}`);
console.log('  ' + '文件'.padEnd(26) + '原始'.padStart(9) + '压缩后'.padStart(11) + '省下'.padStart(9) + 'gzip'.padStart(10) + '   sha256');
for (const r of rows) {
  const before = bytes(r.from);
  const after = bytes(r.out);
  const saved = before === after ? '—' : `-${(((before - after) / before) * 100).toFixed(1)}%`;
  console.log(
    '  ' + r.name.padEnd(26) +
    kb(before).padStart(9) +
    kb(after).padStart(11) +
    saved.padStart(9) +
    kb(gzipSize(Buffer.from(r.out))).padStart(10) +
    `   ${shortHash(Buffer.from(r.out))}`,
  );
}
console.log(`\n  ${rows.map((r) => r.note).join(' | ')}`);
console.log(`  产物目录：${OUT_DIR}（仓库根）`);
console.log('  下一步：把这两个文件**一起提交**（CDN 只认仓库里已提交的文件），');
console.log('          地址形如 https://cdn.jsdmirror.com/gh/<user>/timely-blog-theme@main/timely-blog-theme.min.css\n');

if (failed) {
  console.error(`[min] 失败 ${failed} 项 —— 产物已写出但不可信，请修复后重跑。\n`);
  process.exit(1);
}
console.log('[min] 全部检查通过。\n');
