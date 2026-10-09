import fs from 'node:fs';
import ejs from 'ejs';
import { config, themePath } from '../config.js';
import { rewriteContent, isEmptyContent } from './rewrite.js';

/** 每次渲染都读盘，保证改完 EJS 刷新即见（不做模块级缓存） */
function readTemplate() {
  const file = themePath(config.ejsFile);
  if (!fs.existsSync(file)) {
    throw new Error(`找不到主题模板：${file}\n请检查 .env 里的 THEME_DIR / EJS_FILE，或参考 config.js 的默认值。`);
  }
  return fs.readFileSync(file, 'utf8');
}

const t = (key, opts) => {
  if (!opts) return key;
  return String(key).replace(/{{(\w+)}}/g, (m, k) => (k in opts ? opts[k] : m));
};

/**
 * 采集「整棵分享子树里实际会用到」的图标类名（如 `bxs-shower`）。
 *
 * 为什么要按需：Trilium 线上会把内置包的全部 1634 条 glyph 声明内联进每一页（≈45KB/页）。
 * 本地没必要照抄 —— 遍历 store 里所有笔记的 `#iconClass` + 类型回退（getIcon()），
 * 只把命中 glyph 表的那几个类名交给 buildIconPackCss()。
 *
 * 覆盖范围故意比「本页可见」宽：整棵子树都算，这样一个 glyph 集合对任意页面都够用，
 * 不会因为某页缺声明而出现「首页图标正常、详情页空白」这种随页面漂移的问题。
 */
function collectUsedGlyphs(store) {
  const used = new Set();
  for (const node of store.nodes.values()) {
    const note = node.note;
    if (!note || typeof note.getIcon !== 'function') continue;
    for (const cls of String(note.getIcon() || '').split(/\s+/)) {
      if (cls) used.add(cls);
    }
  }
  return used;
}

function buildLocals({ store, note }) {
  const root = store.root;
  return {
    // —— Trilium 自定义分享模板的真实 locals（对齐 share/content_renderer.ts 的 opts）——
    // 基线：note / header / content / isEmpty / subRoot / assetPath / assetUrlFragment /
    //       showLoginInShareTheme / t / isDev / utils / sanitizeUrl
    // + renderArgs（v0.105.0）：cssToLoad / jsToLoad / logoUrl / ancestors / isStatic /
    //       faviconUrl / iconPackCss / iconPackSupportedPrefixes
    note,
    content: null, // 由 renderSharePage 注入（已改写链接）
    header: '',
    isEmpty: false,
    subRoot: { note: root },
    assetPath: '',
    assetUrlFragment: '',
    appPath: '',
    showLoginInShareTheme: false,
    t,
    isDev: true,
    // 图标包：Trilium 已把 iconPackCss 算好塞进模板上下文（v0.105.0 RenderArgs）。
    // 线上内置包为 Boxicons v2（prefix bx），字体走 /share/assets/fonts/boxicons.woff2。
    // 本地由 buildIconPackCss() 复刻等价的 @font-face + .bx + 逐图标 glyph 声明
    // （按需输出：只含整棵子树实际用到的类名，线上是全量 1634 条）。
    iconPackCss: buildIconPackCss(collectUsedGlyphs(store)),
    iconPackSupportedPrefixes: ['bx'],
    // —— 本项目扩展（前缀 __ 避免与 Trilium locals 混淆）——
    __dev: {
      rootNoteId: root?.noteId,
      noteId: note.noteId,
      shareId: note.shareId,
    },
  };
}

/**
 * 内置图标包（Boxicons v2）的 iconPackCss。
 *
 * ⚠️ 这里必须复刻 Trilium 服务端的 `icon_packs.generateCss()` 结构：
 *      @font-face  +  `.bx` 基础规则  +  **逐图标的 glyph 声明**
 *      `.bx.bxs-shower::before { content: "\ef45"; }`
 *    只写前两段是不够的 —— 少了 glyph 声明，<i class="bx bxs-shower"> 渲染出来是**空白**，
 *    因为字体里并没有「.bxs-shower 这个类 ⇒ 对应码点」的映射（踩过：页面图标全部不显示）。
 *
 * 数据来源：`boxicons-glyphs.json`（1634 个图标，从 boxicons 官方 CSS 生成，
 * 生成脚本 tools/gen-boxicons-glyphs.py）。
 *
 * 体积优化：线上 Trilium 会把**全部** 1634 条声明内联进每一页（≈45KB/页）。
 * 本地不照抄 —— 传 usedGlyphs（整棵子树实际用到的类名集合，见 collectUsedGlyphs）时
 * 只输出命中 glyph 表的那几条（真实库约 5–10 条，≈1KB）。
 * 不传则输出全量（保持与线上一致的兜底行为，也方便对照调试）。
 */
let _glyphTableCache = null;
function loadGlyphTable() {
  if (_glyphTableCache !== null) return _glyphTableCache;
  const tablePath = themePath('boxicons-glyphs.json');
  if (!fs.existsSync(tablePath)) {
    console.warn(
      `[render] 缺少图标字形表 ${tablePath} → 图标会显示为空白。\n` +
      `         生成方式：node tools/gen-boxicons-glyphs.py（或见 README「图标包」一节）。`,
    );
    _glyphTableCache = {};
    return _glyphTableCache;
  }
  _glyphTableCache = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
  return _glyphTableCache;
}

const ICON_FONT_FACE = `@font-face {
  font-family: 'boxicons';
  font-weight: normal;
  font-style: normal;
  src: url('assets/fonts/boxicons.woff2') format('woff2');
}
.bx {
  font-family: 'boxicons' !important;
  font-weight: normal;
  font-style: normal;
  font-variant: normal;
  line-height: 1;
  display: inline-block;
  text-rendering: auto;
  text-transform: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}`;

function buildIconPackCss(usedGlyphs) {
  const table = loadGlyphTable();
  const names = usedGlyphs && usedGlyphs.size
    ? [...usedGlyphs].filter((n) => n in table)
    : Object.keys(table);
  const decls = names
    .map((name) => `.bx.${name}::before { content: "${table[name]}"; }`)
    .join('\n');
  return decls ? `${ICON_FONT_FACE}\n${decls}` : ICON_FONT_FACE;
}

/**
 * canvas（Excalidraw）笔记在分享页里不是下发场景 JSON，而是渲染成一张图片。
 * 实测线上 Trilium 的输出（末尾 utcDateModified 用于缓存失效）：
 *   <img src="api/images/<noteId>/<encodeURIComponent(title)>?<utcDateModified>">
 */
function canvasMarkup(note) {
  const stamp = note.utcDateModified || '';
  return `<img src="api/images/${note.noteId}/${encodeURIComponent(note.title)}${stamp ? '?' + stamp : ''}">`;
}

export async function renderSharePage({ store, note, url = '/' }) {
  let rawContent = '';
  if (note.type === 'canvas') rawContent = canvasMarkup(note);
  else if (note.type !== 'book') rawContent = await store.content(note.noteId, false);

  const content = rewriteContent(rawContent, {
    resolveNote: (noteId) => store.get(noteId),
  });

  const locals = buildLocals({ store, note });
  locals.content = content;
  locals.isEmpty = isEmptyContent(content);

  const source = readTemplate();
  let html = ejs.render(source, locals, {
    filename: themePath(config.ejsFile),
    async: false,
    rmWhitespace: false,
  });

  html = localizeAssets(html, store);
  html = injectLiveReload(html);
  return { html, isEmpty: locals.isEmpty, content };
}

/**
 * 把 EJS 里的主题资源引用换成本地文件（`ASSET_MODE=local`，主题流程的阶段①）。
 * 处理的两种引用形态：
 *   1. `note.getRelations("shareCss"/"shareJs")` → `api/notes/<noteId>/download`
 *      —— 按 noteId 查 config.hostedAssets；未命中则按被引用笔记的 MIME 判断
 *   2. CDN 地址（发布形态，EJS 里以注释保留）—— 按文件名映射
 * HTML 注释里的内容保持原样，方便对照发布形态。
 * `ASSET_MODE=as-is` 时（阶段② 预览 / ③ 上线）整段跳过，页面保持 EJS 原样。
 */
function localizeAssets(html, store) {
  if (config.assetMode === 'as-is') return html;

  const rewrite = (chunk) => {
    let out = chunk;

    for (const rule of config.assetRewrite) {
      const re = new RegExp(rule.pattern, 'g');
      out = out.replace(re, (match, file) => {
        const local = rule.map?.[file] || file;
        return `${config.shareUrlPrefix}/theme/${local}`;
      });
    }

    return out.replace(/api\/notes\/([\w-]+)\/download/g, (match, noteId) => {
      let local = config.hostedAssets[noteId];
      if (!local) {
        const mime = store?.get(noteId)?.mime ?? '';
        if (/^text\/css/i.test(mime)) local = config.cssFile;
        else if (/javascript/i.test(mime)) local = config.jsFile;
      }
      return local ? `${config.shareUrlPrefix}/theme/${local}` : match;
    });
  };

  return html
    .split(/(<!--[\s\S]*?-->)/)
    .map((part, i) => (i % 2 === 1 ? part : rewrite(part)))
    .join('');
}

/** 注入热重载脚本（主题文件变化 → 浏览器自动刷新） */
function injectLiveReload(html) {
  if (!config.liveReload) return html;
  const snippet =
    '<script data-share-tool="livereload">(function(){try{var es=new EventSource("' +
    config.shareUrlPrefix +
    '/__dev/events");es.onmessage=function(e){if(e.data==="reload")location.reload();};}catch(err){}})();</script>';
  if (html.includes('</body>')) return html.replace('</body>', snippet + '\n</body>');
  return html + snippet;
}

/** 出错时给一个能直接定位问题的页面（Trilium 线上会静默回退默认模板，本地故意暴露） */
export function renderErrorPage(err, { url, noteId } = {}) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const stack = config.mock || process.env.SHOW_STACK === '1' ? `<pre>${esc(err.stack)}</pre>` : '';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>渲染失败 - share-tool</title>
<style>
  body{margin:0;padding:32px;background:#18181b;color:#e4e4e7;font:14px/1.7 ui-monospace,Menlo,Consolas,monospace}
  h1{color:#f59e0b;font-size:18px;margin:0 0 12px}
  .box{background:#27272a;border:1px solid #3f3f46;border-radius:10px;padding:16px;margin-bottom:14px;white-space:pre-wrap;word-break:break-word}
  pre{overflow:auto;background:#09090b;border:1px solid #27272a;border-radius:8px;padding:12px;color:#a1a1aa}
  .hint{color:#a1a1aa}
  a{color:#fbbf24}
</style></head><body>
<h1>渲染失败</h1>
<div class="box">${esc(err.message)}</div>
<div class="hint">URL: ${esc(url)}${noteId ? ` · noteId: ${esc(noteId)}` : ''}</div>
${stack}
<p class="hint">提示：模板报错时可先看上面的堆栈定位到 EJS 行号；数据相关问题访问 <a href="${config.shareUrlPrefix}/__dev/state">${config.shareUrlPrefix}/__dev/state</a> 查看已拉取的笔记。</p>
</body></html>`;
}
