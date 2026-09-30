import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
export const ROOT_DIR = __dirname;

// 极简 .env 解析（不引入 dotenv 依赖）
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT_DIR, '.env'));
loadEnvFile(path.join(ROOT_DIR, '.env.local'));

const num = (v, def) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? def : Number(v));
const bool = (v, def) => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(v));

const themeDir = path.resolve(ROOT_DIR, process.env.THEME_DIR || '../TimelyBlogTheme');

export const config = {
  triliumUrl: (process.env.TRILIUM_URL || 'http://localhost:8080').replace(/\/+$/, ''),
  etapiToken: process.env.ETAPI_TOKEN || '',
  rootNoteId: process.env.ROOT_NOTE_ID || '',
  port: num(process.env.PORT, 4321),

  themeDir,
  ejsFile: process.env.EJS_FILE || 'TimelyBlogTheme.ejs',
  cssFile: process.env.CSS_FILE || 'TimelyBlogTheme.css',
  jsFile: process.env.JS_FILE || 'TimelyBlogTheme.js',

  liveReload: bool(process.env.LIVE_RELOAD, true),
  cacheTtl: num(process.env.CACHE_TTL, 30000),
  prefetchDepth: num(process.env.PREFETCH_DEPTH, 6),
  maxNotes: num(process.env.MAX_NOTES, 2000),
  mock: bool(process.env.ETAPI_MOCK, false),

  shareUrlPrefix: '/share',

  push: {
    ejs: process.env.PUSH_NOTE_EJS || '',
    css: process.env.PUSH_NOTE_CSS || '',
    js: process.env.PUSH_NOTE_JS || '',
  },

  /**
   * 资源 URL 本地化（CDN 形态）：ASSET_MODE=local 时把 EJS 里写死的 CDN 地址
   * 换成本地文件。pattern 中第一个捕获组 = CDN 上的文件名，再由 map 映射成本地文件名。
   */
  assetRewrite: [
    {
      pattern: 'https?://cdn\\.jsdmirror\\.com/gh/[^/"\'`]+/timely-theme@[^/"\'`]+/Timely-Theme/([\\w.-]+)',
      map: {},
    },
  ],

  /**
   * 主题资源渲染模式（对应主题的三阶段流程）：
   *   local  （默认）= 阶段① 开发：api/notes/<id>/download 与 CDN 地址都重写成 /share/theme/<本地文件>，
   *                    改 CSS/JS 存盘即见
   *   as-is         = 阶段② 预览 / ③ 上线：不做任何重写，页面保持 EJS 原样 ——
   *                    阶段②走 Trilium 托管（验证笔记里的文件渲染是否正常），阶段③走 CDN
   */
  assetMode: (process.env.ASSET_MODE || 'local').toLowerCase() === 'as-is' ? 'as-is' : 'local',

  /**
   * 资源 URL 本地化（Trilium 托管形态）：EJS 用
   * `note.getRelations("shareCss"|"shareJs")` → `api/notes/<noteId>/download` 引用主题资源。
   * ASSET_MODE=local 时把这些引用换成本地主题文件（否则拿到的是笔记里的旧副本，改了看不见）。
   * key = Trilium 里 Code 笔记的 noteId，value = 本地主题文件名。
   * 未命中时回退：按被引用笔记的 MIME 判断（见 render.js 的 localizeAssets）。
   */
  hostedAssets: {},
};

config.assetRewrite[0].map = {
  'timely-theme.css': config.cssFile,
  'timely-theme.js': config.jsFile,
};

// Trilium 托管的主题资源 noteId → 本地文件名
if (config.push.css) config.hostedAssets[config.push.css] = config.cssFile;
if (config.push.js) config.hostedAssets[config.push.js] = config.jsFile;
if (config.mock) {
  config.hostedAssets.themeCss0001 = config.cssFile;
  config.hostedAssets.themeJs0001 = config.jsFile;
}


export function themePath(file) {
  return path.join(config.themeDir, file);
}

export function assertEtapiConfig() {
  const missing = [];
  if (!config.etapiToken) missing.push('ETAPI_TOKEN');
  if (!config.rootNoteId) missing.push('ROOT_NOTE_ID');
  return missing;
}
