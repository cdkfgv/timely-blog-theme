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
const relation = (name, value, isInheritable = false) => ({ attributeId: 'r_' + name + value, type: 'relation', name, value, position: 10, isInheritable });

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
      label('siteUrl', 'https://blog.example.com'),
      label('siteIcp', '京ICP备00000000号'),
      label('bloggerName', 'yihwang'),
      label('bloggerMotto', '热爱技术，保持好奇'),
      label('bloggerBio', '全栈开发者 & 基础设施折腾者 <yihwang>'), // 含 & < >：验证只转义一次
      label('bloggerEmail', 'me@example.com'),
      label('bloggerGithub', 'https://github.com/example'),
      label('shareOpenGraphDomain', 'blog.example.com', true),
      // 开发调试期主题资源引用（Trilium 托管 Code 笔记）。
      // 必须 isInheritable：否则只有根笔记页面能取到，子页面渲染时 note 是子笔记、取不到关系。
      relation('shareCss', 'themeCss0001', true),
      relation('shareJs', 'themeJs0001', true),
      // ~shareFavicon → File 笔记（勾「可继承」），替代内置 emoji data-URI
      relation('shareFavicon', 'favicon00001', true),
    ],
  },
  null,
);

/* ---- favicon（File 笔记，通过 ~shareFavicon 关系引用） ---- */
addNote(
  { noteId: 'favicon00001', title: 'favicon.svg', type: 'file', mime: 'image/svg+xml', attributes: [label('shareHiddenFromTree', '')] },
  'root0000blog',
);
content.set(
  'favicon00001',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#d97706"/><text x="16" y="23" font-size="20" text-anchor="middle" fill="#fff">T</text></svg>',
);

/* ---- 主题资源 code 笔记（线上 Trilium 托管的那两份，不出现在导航） ---- */
addNote(
  { noteId: 'themeCss0001', title: 'timely-theme.css', type: 'code', mime: 'text/css', attributes: [label('shareHiddenFromTree', '')] },
  'root0000blog',
);
content.set('themeCss0001', '/* 主题 CSS 副本 */\n:root { --mock-hosted-css: 1; }\n');
addNote(
  { noteId: 'themeJs0001', title: 'timely-theme.js', type: 'code', mime: 'text/javascript', attributes: [label('shareHiddenFromTree', '')] },
  'root0000blog',
);
content.set('themeJs0001', '/* 主题 JS 副本 */\nwindow.__MOCK_HOSTED_JS__ = 1;\n');

/* ---- 文章容器（模拟分组，用来验证递归遍历） ---- */
addNote({ noteId: 'folder000001', title: '2026', type: 'book' }, 'root0000blog');
addNote({ noteId: 'folder000002', title: '2025', type: 'book' }, 'root0000blog');
addNote(
  { noteId: 'about0000001', title: '关于', type: 'text', mime: 'text/html', attributes: [label('shareAlias', 'about')] },
  'root0000blog',
);

/** labels / attrs：数组项为 [name, value] 时按 label 处理，也可直接传属性对象（如 relation(...)） */
const post = (id, title, parent, attrs, html, type = 'text', mime = 'text/html') => {
  addNote(
    {
      noteId: id,
      title,
      type,
      mime,
      attributes: attrs.map((a) => (Array.isArray(a) ? label(a[0], a[1]) : a)),
    },
    parent,
  );
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
    // 笔记图标：Trilium「设置图标」写入的 #iconClass（Boxicons，前缀 bx）
    ['iconClass', 'bx bxs-shower'],
    // OG 元信息：label 形态（值原样输出）
    ['shareOpenGraphURL', 'https://blog.example.com/etapi-local-dev'],
    ['shareOpenGraphImage', 'https://cdn.example.com/og/etapi-local-dev.png'],
    ['shareDisallowRobotIndexing', ''],
  ],
  `<h2>问题</h2><p>每次改 EJS 都要复制进 Trilium，反馈太慢。</p>
   <h3>方案</h3><p>用 Node 起一个本地服务，读取真实数据，实时渲染模板。</p>
   <pre><code class="language-javascript">const app = createServer();\napp.listen(4321);</code></pre>
   <p>内部链接测试：<a href="#root/post0000002">另一篇文章</a>，附件链接测试：<a href="#root/att000000001?attachmentId=att000000001&amp;name=spec.txt">spec.txt</a>。</p>
   <img src="api/attachments/att000000001/image/pic.png" alt="">`,
);

/* 代码高亮专项：覆盖 Trilium 实测输出的 5 种 MIME 形态 class。
   Prism 时代这些 class 一个都对不上 → 正文零高亮；主题里 normalizeLang() 负责归一。 */
post(
  'post0000007',
  '代码高亮语言标记对照',
  'folder000001',
  [
    ['publish', 'true'],
    ['blogDate', '2026-09-29T10:00:00.000+0800'],
    ['blogCategory', '工具链'],
    ['blogTags', 'highlight.js'],
    ['blogSummary', 'Trilium 输出的 class 是 MIME 形式，需要归一后高亮器才认得。'],
  ],
  `<h2>五种实测形态</h2>
   <p>bash（Trilium 里是 <code>text-x-sh</code>）：</p>
   <pre><code class="language-text-x-sh">export NO_PROXY="*"
for id in a b; do printf "%s\\n" "$id"; done</code></pre>
   <p>yaml（<code>text-x-yaml</code>）：</p>
   <pre><code class="language-text-x-yaml">services:
  trilium:
    image: triliumnext/trilium:latest
    ports:
      - "8080:8080"</code></pre>
   <p>typescript（<code>application-typescript</code>）：</p>
   <pre><code class="language-application-typescript">const greet = (name: string): string => name + '!';</code></pre>
   <p>javascript（<code>application-javascript-env-backend</code>）：</p>
   <pre><code class="language-application-javascript-env-backend">const app = createServer();
app.listen(4321);</code></pre>
   <p>自动（<code>text-x-trilium-auto</code>）：</p>
   <pre><code class="language-text-x-trilium-auto">docker compose up -d</code></pre>`,
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
    // OG 元信息：relation 形态（指向 File 笔记 → api/notes/<id>/download）
    ['shareDescription', 'SSR 重构后首屏不再依赖 Vue 运行时。'],
    ['shareOpenGraphColor', '#d97706'],
    relation('shareOpenGraphImage', 'favicon00001'),
  ],
  `<h2>现状</h2><p>EJS 出空壳，Vue 再画一遍。</p>
   <h3>方向</h3><ul><li>列表页服务端渲染</li><li>只保留交互用 JS</li></ul>
   <blockquote><p>先能本地跑，再谈重构。</p></blockquote>
   <p>代码里含 <code>&lt;/script&gt;</code> 时会不会炸？这是一个验证点。</p>`,
);

post(
  'post0000003',
  '在 NAS 上跑顺一切 & 折腾 <笔记>', // 标题含 & < >：验证只转义一次
  'folder000002',
  [
    ['publish', 'true'],
    ['blogDate', '2025-12-11T10:00:00.000+0800'],
    ['blogCategory', '基础设施'],
    ['blogTags', 'Docker'],
    ['blogSummary', '飞牛 NAS + Cloudflare Tunnel 的日常。'],
    // OG 元信息兜底：没有 OG 相关属性时用文章封面（相对路径 + #siteUrl 拼成绝对地址）
    ['headerImage', 'api/attachments/att000000001/image/pic.png'],
    // 回归用例：已共享 + 已发布但「隐藏于分享树导航」的文章，仍必须出现在首页列表里
    ['shareHiddenFromTree', ''],
    // 图标：solid 变体（bx s 前缀）—— 与 post0000001 的 bxs- 形态形成对照
    ['iconClass', 'bx bxs-coffee-bean'],
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

/** 回归用例：canvas（Excalidraw）笔记当文章用 —— 正文是场景 JSON，模板不该把它原样输出 */
post(
  'post0000006',
  '手绘网络拓扑',
  'folder000001',
  [
    ['publish', 'true'],
    ['blogDate', '2026-09-29T10:00:00.000+0800'],
    ['blogCategory', '灵光一闪'],
    ['blogTags', 'Network'],
    ['blogSummary', '一张手绘的网络拓扑。'],
  ],
  '{"type":"excalidraw","version":2,"elements":[{"id":"rect1","type":"rectangle"}]}',
  'canvas',
  'application/json',
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
