import fs from 'node:fs';
import ejs from 'ejs';
import { config, themePath } from '../config.js';
import { rewriteContent, isEmptyContent } from './rewrite.js';
import { utils } from './utils.js';

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

function buildLocals({ store, note }) {
  const root = store.root;
  const isText = note.type === 'text' || note.type === 'code';
  return {
    // —— Trilium 分享模板的基础 locals（与本项目对齐的子集）——
    note,
    content: null, // 由 renderSharePage 注入（已改写链接）
    header: '',
    isEmpty: false,
    subRoot: { note: root },
    cssToLoad: [`${config.shareUrlPrefix}/theme/${config.cssFile}`],
    jsToLoad: [`${config.shareUrlPrefix}/theme/${config.jsFile}`],
    faviconUrl: '/favicon.ico',
    logoUrl: '',
    isStatic: false,
    isDev: true,
    appPath: '',
    assetPath: '',
    assetUrlFragment: '',
    t,
    utils,
    // —— 本项目扩展 ——
    __dev: {
      isText,
      rootNoteId: root?.noteId,
      noteId: note.noteId,
      shareId: note.shareId,
    },
  };
}

export async function renderSharePage({ store, note, url = '/' }) {
  const rawContent = note.type === 'book' ? '' : await store.content(note.noteId, false);
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

  html = localizeAssets(html);
  html = injectLiveReload(html);
  return { html, isEmpty: locals.isEmpty, content };
}

/** 把 EJS 里写死的 CDN 地址换成本地主题文件，改 CSS/JS 刷新即见 */
export function localizeAssets(html) {
  let out = html;
  for (const rule of config.assetRewrite) {
    const re = new RegExp(rule.pattern, 'g');
    out = out.replace(re, (match, file) => {
      const local = rule.map?.[file] || file;
      return `${config.shareUrlPrefix}/theme/${local}`;
    });
  }
  return out;
}

/** 注入热重载脚本（主题文件变化 → 浏览器自动刷新） */
export function injectLiveReload(html) {
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
