/**
 * 模拟 ETAPI：无需 Trilium 即可跑起来调前端（ETAPI_MOCK=1）
 * 结构与真实 ETAPI 保持一致：Note 对象含 attributes / childNoteIds，content 走单独接口。
 */

const notes = new Map();

function addNote(note, parentId) {
  notes.set(note.noteId, {
    isProtected: false,
    dateCreated: '2026-09-01 10:00:00.000+0800',
    utcDateCreated: '2026-09-01 02:00:00.000Z',
    dateModified: '2026-09-20 10:00:00.000+0800',
    utcDateModified: '2026-09-20 02:00:00.000Z',
    parentNoteIds: parentId ? [parentId] : [],
    childNoteIds: [],
    attributes: [],
    ...note,
  });
  if (parentId) notes.get(parentId).childNoteIds.push(note.noteId);
}

const content = new Map();
const label = (name, value, isInheritable = false) => ({ attributeId: 'a_' + name + value, type: 'label', name, value, position: 10, isInheritable });

/* ---- 站点根 ---- */
addNote(
  {
    noteId: 'root0000blog',
    title: 'Timely',
    type: 'text',
    mime: 'text/html',
    attributes: [
      label('shareRoot', ''),
      label('siteName', 'Timely'),
      label('siteDescription', '极简技术博客'),
      label('siteIcp', '京ICP备00000000号'),
      label('bloggerName', 'yihwang'),
      label('bloggerMotto', '热爱技术，保持好奇'),
      label('bloggerBio', '全栈开发者，关注前后端与基础设施。'),
      label('bloggerEmail', 'me@example.com'),
      label('bloggerGithub', 'https://github.com/example'),
    ],
  },
  null,
);

/* ---- 文章容器（模拟分组，用来验证递归遍历） ---- */
addNote({ noteId: 'folder000001', title: '2026', type: 'book' }, 'root0000blog');
addNote({ noteId: 'folder000002', title: '2025', type: 'book' }, 'root0000blog');
addNote(
  { noteId: 'about0000001', title: '关于', type: 'text', mime: 'text/html', attributes: [label('shareAlias', 'about')] },
  'root0000blog',
);

const post = (id, title, parent, labels, html) => {
  addNote({ noteId: id, title, type: 'text', mime: 'text/html', attributes: labels.map(([n, v]) => label(n, v)) }, parent);
  content.set(id, html);
};

post(
  'post0000001',
  '用 ETAPI 打通本地开发流程',
  'folder000001',
  [
    ['publish', 'true'],
    ['blogDate', '2026-09-28T10:00:00.000+0800'],
    ['blogCategory', '工程效率'],
    ['blogTags', 'Trilium'],
    ['blogTags', 'Node.js'],
    ['blogSummary', '把主题开发从「复制到 Trilium 看效果」变成「本地刷新」…'],
  ],
  `<h2>问题</h2><p>每次改 EJS 都要复制进 Trilium，反馈太慢。</p>
   <h3>方案</h3><p>用 Node 起一个本地服务，读取真实数据，实时渲染模板。</p>
   <pre><code class="language-javascript">const app = createServer();\napp.listen(4321);</code></pre>
   <p>内部链接测试：<a href="#root/post0000002">另一篇文章</a>，附件链接测试：<a href="#root/att000000001?attachmentId=att000000001&amp;name=spec.txt">spec.txt</a>。</p>
   <img src="api/attachments/att000000001/image/pic.png" alt="">`,
);

post(
  'post0000002',
  '主题结构优化笔记',
  'folder000001',
  [
    ['publish', 'true'],
    ['blogDate', '2026-09-20T10:00:00.000+0800'],
    ['blogCategory', '前端'],
    ['blogTags', 'Vue'],
    ['blogSummary', '把客户端渲染搬回服务端，首屏即内容。'],
  ],
  `<h2>现状</h2><p>EJS 出空壳，Vue 再画一遍。</p>
   <h3>方向</h3><ul><li>列表页服务端渲染</li><li>只保留交互用 JS</li></ul>
   <blockquote><p>先能本地跑，再谈重构。</p></blockquote>
   <p>代码里含 <code>&lt;/script&gt;</code> 时会不会炸？这是一个验证点。</p>`,
);

post(
  'post0000003',
  '在 NAS 上跑顺一切',
  'folder000002',
  [
    ['publish', 'true'],
    ['blogDate', '2025-12-11T10:00:00.000+0800'],
    ['blogCategory', '基础设施'],
    ['blogTags', 'Docker'],
    ['blogSummary', '飞牛 NAS + Cloudflare Tunnel 的日常。'],
  ],
  '<h2>拓扑</h2><p>NAS 跑 Docker，ECS 跑 frps / DERP。</p>',
);

post(
  'post0000004',
  '未发布草稿',
  'folder000002',
  [['blogDate', '2025-12-01T10:00:00.000+0800']],
  '<p>这篇没有 #publish，不应出现在列表里。</p>',
);

/**
 * 回归用例：正文里出现真实的 </script>（网页剪藏很常见）。
 * 主题用 JSON.stringify(content) 内联进 <script>，若不做 < → \u003c 转义，脚本会提前闭合。
 */
post(
  'post0000005',
  '正文含内联脚本（验证转义）',
  'folder000001',
  [
    ['publish', 'true'],
    ['blogDate', '2026-09-15T10:00:00.000+0800'],
    ['blogCategory', '验证'],
    ['blogTags', '安全'],
    ['blogSummary', '复现 BLOG_DATA 内联脚本提前闭合的问题。'],
  ],
  `<h2>场景</h2><p>从网页剪藏的正文常带真实 script 标签：</p>
   <script>window.__clipDemo = 1;</script>
   <p>页面出现裸露的 JSON 文本 = 内联脚本被提前闭合，需要把 &lt; 转义成 \\u003c。</p>`,
);

content.set(
  'about0000001',
  '<h2>关于我</h2><p>全栈开发者，喜欢折腾基础设施与开发工具。</p><h3>联系</h3><p>邮箱见侧边栏。</p>',
);

const attachments = new Map([
  ['att000000001', { attachmentId: 'att000000001', ownerId: 'post0000001', role: 'image', mime: 'image/png', title: 'pic.png', position: 10 }],
]);

// 1x1 透明 PNG
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

export const MOCK_ROOT_NOTE_ID = 'root0000blog';

export function createMockEtapi() {
  return {
    defaultRootNoteId: MOCK_ROOT_NOTE_ID,
    appInfo: async () => ({ appVersion: '0.9x-mock', dbVersion: 1 }),
    getNote: async (noteId) => {
      const n = notes.get(noteId);
      if (!n) {
        const err = new Error(`mock: note not found ${noteId}`);
        err.status = 404;
        throw err;
      }
      return JSON.parse(JSON.stringify(n));
    },
    getNoteContent: async (noteId) => content.get(noteId) ?? '',
    putNoteContent: async () => null,
    getAttachment: async (id) => {
      const a = attachments.get(id);
      if (!a) throw Object.assign(new Error('mock: attachment not found'), { status: 404 });
      return { ...a };
    },
    getAttachmentContent: async (id) => {
      if (!attachments.has(id)) throw Object.assign(new Error('mock: attachment not found'), { status: 404 });
      return { buffer: PNG_1PX, contentType: 'image/png' };
    },
  };
}
