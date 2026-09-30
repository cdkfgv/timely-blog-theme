/**
 * 打印当前会拉取到的笔记树（不启动 web 服务）
 * 用法：npm run state
 */
import { config, assertEtapiConfig } from '../config.js';
import { createEtapi } from '../src/etapi.js';
import { createMockEtapi, MOCK_ROOT_NOTE_ID } from '../src/mock.js';
import { TriliumStore } from '../src/store.js';

const api = config.mock ? createMockEtapi() : createEtapi({ baseUrl: config.triliumUrl, token: config.etapiToken });

const missing = config.mock ? [] : assertEtapiConfig();
if (missing.length) {
  console.error(`缺少配置：${missing.join(', ')}（可先 ETAPI_MOCK=1 npm run state 看假数据）`);
  process.exit(1);
}

const store = new TriliumStore(api, {
  rootNoteId: config.mock ? MOCK_ROOT_NOTE_ID : config.rootNoteId,
  ttl: 0,
  depth: config.prefetchDepth,
  maxNotes: config.maxNotes,
});

await store.ensure(true);
const state = store.state();

console.log(`\n根笔记: ${state.rootNoteId}  共 ${state.total} 个节点  用时 ${state.stats.durationMs}ms\n`);
console.log('depth  publish  blogDate     shareId / noteId'.padEnd(60) + 'title');
console.log('-'.repeat(100));
for (const n of state.nodes) {
  const share = n.shareId === n.noteId ? n.noteId : `${n.shareId} → ${n.noteId}`;
  console.log(
    String(n.depth).padEnd(6) +
      String(n.publish ?? '-').padEnd(9) +
      String(n.blogDate ?? '-').slice(0, 10).padEnd(13) +
      share.padEnd(34) +
      n.title,
  );
}
console.log('');
