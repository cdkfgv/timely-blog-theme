import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, themePath, assertEtapiConfig, ROOT_DIR } from './config.js';
import { createEtapi } from './src/etapi.js';
import { createMockEtapi, MOCK_ROOT_NOTE_ID } from './src/mock.js';
import { TriliumStore } from './src/store.js';
import { renderSharePage, renderErrorPage } from './src/render.js';

const PREFIX = config.shareUrlPrefix;

/* ------------------------------------------------------------------ */
/* 基础设施：ETAPI 客户端 + 数据层                                       */
/* ------------------------------------------------------------------ */

const api = config.mock
  ? createMockEtapi()
  : createEtapi({ baseUrl: config.triliumUrl, token: config.etapiToken });

// 假数据模式下强制使用 mock 的根笔记（.env 里可能填着真实 ROOT_NOTE_ID，会查不到）
const rootNoteId = config.mock ? MOCK_ROOT_NOTE_ID : config.rootNoteId;

const store = new TriliumStore(api, {
  rootNoteId,
  ttl: config.cacheTtl,
  depth: config.prefetchDepth,
  maxNotes: config.maxNotes,
});

/* ------------------------------------------------------------------ */
/* 热重载：监听主题文件变化 → 通知浏览器刷新                              */
/* ------------------------------------------------------------------ */

const sseClients = new Set();

function broadcastReload(reason = 'reload') {
  for (const res of sseClients) {
    res.write(`data: ${reason}\n\n`);
  }
  if (sseClients.size) console.log(`[live] ${reason} → 已通知 ${sseClients.size} 个页面`);
}

let watchTimer = null;
function startThemeWatcher() {
  if (!config.liveReload) return;
  if (!fs.existsSync(config.themeDir)) {
    console.warn(`[live] 主题目录不存在，跳过监听：${config.themeDir}`);
    return;
  }
  try {
    fs.watch(config.themeDir, { persistent: true }, (event, filename) => {
      if (!filename) return;
      if (!/\.(ejs|css|js|html)$/i.test(filename)) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => broadcastReload('reload'), 120);
    });
    console.log(`[live] 监听主题目录：${config.themeDir}`);
  } catch (err) {
    console.warn(`[live] 目录监听失败：${err.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const mimeOf = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data, null, 2), { 'Content-Type': 'application/json; charset=utf-8' });
}

function serveThemeFile(res, relPath) {
  const target = path.resolve(config.themeDir, relPath);
  if (!target.startsWith(path.resolve(config.themeDir))) {
    return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return send(res, 404, `theme file not found: ${relPath}`, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  send(res, 200, fs.readFileSync(target), { 'Content-Type': mimeOf(target) });
}

async function serveProxyBinary(res, loader) {
  try {
    const { buffer, contentType } = await loader();
    send(res, 200, buffer, { 'Content-Type': contentType || 'application/octet-stream' });
  } catch (err) {
    send(res, 404, `asset not found: ${err.message}`, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

/* ------------------------------------------------------------------ */
/* 页面渲染                                                             */
/* ------------------------------------------------------------------ */

async function handlePage(req, res, { shareId, fresh }) {
  const url = req.url;
  try {
    await store.ensure(fresh);
    if (!store.root) {
      throw new Error(`找不到根笔记 ${rootNoteId}：请确认 ROOT_NOTE_ID 是否正确、该笔记是否已共享。`);
    }

    const note = shareId ? await store.resolve(shareId) : store.root;
    if (!note) {
      const body = `<!DOCTYPE html><meta charset="utf-8"><body style="font:14px/1.8 ui-monospace,monospace;background:#18181b;color:#e4e4e7;padding:40px">
<h1 style="color:#f59e0b">404 · 笔记不存在</h1>
<p>shareId: <code>${shareId}</code></p>
<p>可用路由：<code>${PREFIX}/</code>、<code>${PREFIX}/{noteId 或 shareAlias}</code></p>
<p>已收录的笔记：<a style="color:#fbbf24" href="${PREFIX}/__dev/state">${PREFIX}/__dev/state</a></p></body>`;
      return send(res, 404, body, { 'Content-Type': 'text/html; charset=utf-8' });
    }

    const { html } = await renderSharePage({ store, note, url });
    send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
  } catch (err) {
    console.error('[render] 失败：', err.message);
    const html = renderErrorPage(err, { url, noteId: shareId });
    send(res, 500, html, { 'Content-Type': 'text/html; charset=utf-8' });
  }
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(parsed.pathname);
  const fresh = parsed.searchParams.get('fresh') === '1';

  // 根路径跳转到分享前缀
  if (pathname === '/') return send(res, 302, '', { Location: `${PREFIX}/` });
  if (pathname === '/favicon.ico') return send(res, 204, '');

  const isSharePath = pathname === PREFIX || pathname.startsWith(PREFIX + '/');

  // ---- 开发端点（/__dev/* 与 /share/__dev/* 均可）----
  const devPath = pathname.startsWith(PREFIX + '/__dev/')
    ? pathname.slice(PREFIX.length)
    : pathname.startsWith('/__dev/')
      ? pathname
      : null;

  if (devPath) {
    if (devPath === '/__dev/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write('data: connected\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (devPath === '/__dev/state') {
      await store.ensure(fresh);
      return sendJson(res, 200, store.state());
    }
    if (devPath === '/__dev/invalidate') {
      store.invalidate();
      await store.ensure(true);
      broadcastReload('reload');
      return sendJson(res, 200, { ok: true, stats: store.stats });
    }
    return send(res, 404, 'not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  if (!isSharePath) {
    return send(res, 404, 'not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  const rest = pathname.slice(PREFIX.length); // '' | '/' | '/xxx'

  // ---- 主题静态资源 ----
  if (rest.startsWith('/theme/')) {
    return serveThemeFile(res, rest.slice('/theme/'.length));
  }

  // ---- 附件 / 图片 / 文件代理（对齐 Trilium 的 api/... 路径）----
  let m;
  if ((m = rest.match(/^\/api\/attachments\/([^/]+)\/(download|image)(?:\/.*)?$/))) {
    return serveProxyBinary(res, () => store.attachment(m[1]));
  }
  if ((m = rest.match(/^\/api\/images\/([^/]+)\/(.*)$/))) {
    return serveProxyBinary(res, () => store.binary(m[1]));
  }
  if ((m = rest.match(/^\/api\/notes\/([^/]+)\/(download|view)$/))) {
    return serveProxyBinary(res, () => store.binary(m[1]));
  }

  // ---- 页面 ----
  const shareId = rest.replace(/^\//, '').replace(/\/+$/, '');
  return handlePage(req, res, { shareId: shareId || null, fresh });
});

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const missing = config.mock ? [] : assertEtapiConfig();
  if (missing.length) {
    console.error(`\n[config] 缺少配置：${missing.join(', ')}\n`);
    console.error('  1) cp .env.example .env');
    console.error('  2) 填 TRILIUM_URL / ETAPI_TOKEN / ROOT_NOTE_ID（Trilium → Options → ETAPI 生成 token）');
    console.error('  3) 想先看界面可设 ETAPI_MOCK=1\n');
    process.exit(1);
  }

  server.listen(config.port, () => {
    const base = `http://localhost:${config.port}${PREFIX}/`;
    console.log('\n================= share-tool (Trilium 分享模拟) =================');
    console.log(`  数据源   : ${config.mock ? '内置假数据 (ETAPI_MOCK=1)' : api.apiRoot}`);
    console.log(`  根笔记   : ${rootNoteId}`);
    console.log(`  主题目录 : ${config.themeDir}`);
    console.log(`  模板     : ${config.ejsFile}`);
    console.log(`  预取深度 : ${config.prefetchDepth} · 缓存 ${config.cacheTtl}ms`);
    console.log(`  首页     : ${base}`);
    console.log(`  调试状态 : ${base}__dev/state`);
    console.log(`  强制刷新 : 任意页面加 ?fresh=1`);
    console.log('================================================================\n');
  });

  startThemeWatcher();

  if (!config.mock) {
    try {
      const info = await api.appInfo();
      console.log(`[etapi] 已连接 Trilium ${info.appVersion ?? ''} (${api.apiRoot})`);
    } catch (err) {
      console.error(`[etapi] 连接失败：${err.message}`);
      console.error('[etapi] 服务仍会启动，页面会显示具体错误；修正 .env 后刷新即可。');
    }
    store.ensure().catch((err) => console.error(`[store] 首次预取失败：${err.message}`));
  } else {
    await store.ensure(true).catch((err) => console.error('[store] 预取失败：', err.message));
  }
}

main();

process.on('SIGINT', () => {
  console.log('\n[server] 关闭中…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
});

export { server, store };
export const projectRoot = ROOT_DIR;
