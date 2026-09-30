/**
 * 纯逻辑单测（不需要起服务、不需要 Trilium）
 *
 *   npm run unit
 *
 * A. ETAPI 客户端：正文接口必须原样返回字符串，不能被 JSON.parse 变成对象
 */

import { createEtapi, EtapiError } from '../src/etapi.js';

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

console.log('\n[unit]\n');

console.log('A. ETAPI 客户端');
{
  const routes = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    const body = routes[path];
    if (body === undefined) return new Response('', { status: 404 });
    return new Response(body.body, {
      status: 200,
      headers: { 'Content-Type': body.type },
    });
  };

  const api = createEtapi({ baseUrl: 'http://localhost:1', token: 't' });

  // canvas 场景 JSON：正文本身就是合法 JSON
  const scene = '{"type":"excalidraw","version":2,"elements":[]}';
  routes['/etapi/notes/canvas1/content'] = { body: scene, type: 'application/json' };
  // 元数据接口：应当照旧解析成对象
  routes['/etapi/notes/canvas1'] = { body: '{"noteId":"canvas1","title":"图"}', type: 'application/json' };

  const content = await api.getNoteContent('canvas1');
  check('正文是合法 JSON 时仍返回字符串（不被 parse）', typeof content === 'string', `实际 ${typeof content}`);
  check('正文内容逐字节保留', content === scene);
  check('String(正文) 不是 "[object Object]"', String(content) !== '[object Object]');

  const meta = await api.getNote('canvas1');
  check('元数据接口仍解析为对象', meta && typeof meta === 'object' && meta.noteId === 'canvas1');

  // 404 → EtapiError
  try {
    await api.getNote('nope');
    check('404 抛 EtapiError', false, '没有抛错');
  } catch (err) {
    check('404 抛 EtapiError 且带 status', err instanceof EtapiError && err.status === 404);
  }

  globalThis.fetch = realFetch;
}

/* ------------------------------------------------------------------ */

console.log(`\n[unit] 通过 ${pass} 项，失败 ${fail} 项\n`);
process.exit(fail ? 1 : 0);
