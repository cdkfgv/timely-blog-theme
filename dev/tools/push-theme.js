/**
 * 把本地主题文件回推到 Trilium 的 code 笔记（调试满意后一键同步，免手工复制）
 * 用法：npm run push
 * 需要 .env 配置 PUSH_NOTE_EJS / PUSH_NOTE_CSS / PUSH_NOTE_JS（对应 Trilium 里三个笔记的 noteId）
 */
import fs from 'node:fs';
import { config, themePath } from '../config.js';
import { createEtapi } from '../src/etapi.js';

const missing = [];
if (!config.etapiToken) missing.push('ETAPI_TOKEN');
if (missing.length) {
  console.error(`缺少配置：${missing.join(', ')}`);
  process.exit(1);
}

const targets = [
  { key: 'ejs', noteId: config.push.ejs, file: config.ejsFile, mime: 'text/plain' },
  { key: 'css', noteId: config.push.css, file: config.cssFile, mime: 'text/plain' },
  { key: 'js', noteId: config.push.js, file: config.jsFile, mime: 'text/plain' },
];

const api = createEtapi({ baseUrl: config.triliumUrl, token: config.etapiToken });
let pushed = 0;
let skipped = 0;

for (const target of targets) {
  if (!target.noteId) {
    console.warn(`跳过 ${target.key}: 未配置 PUSH_NOTE_${target.key.toUpperCase()}`);
    skipped += 1;
    continue;
  }
  const file = themePath(target.file);
  if (!fs.existsSync(file)) {
    console.warn(`跳过 ${target.key}: 本地文件不存在 ${file}`);
    skipped += 1;
    continue;
  }
  const content = fs.readFileSync(file, 'utf8');
  try {
    await api.putNoteContent(target.noteId, content, target.mime);
    console.log(`✓ ${target.key}  ${target.file} (${content.length} 字符) → 笔记 ${target.noteId}`);
    pushed += 1;
  } catch (err) {
    console.error(`✗ ${target.key} 推送失败：${err.message}`);
    process.exitCode = 1;
  }
}

console.log(`\n完成：推送 ${pushed} 个，跳过 ${skipped} 个。`);
if (pushed) console.log('提示：Trilium 端共享页面刷新后即可看到新主题。');
