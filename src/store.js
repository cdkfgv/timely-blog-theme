import { ShareNote } from './share-note.js';

/**
 * 数据层：通过 ETAPI 预取「根笔记 + 子树元数据」，在内存里建一棵可同步访问的树。
 *
 * 为什么要预取：Trilium 的 EJS 模板是同步渲染的（getLabelValue / getChildNotes 都是同步调用），
 * 而 ETAPI 是 HTTP 异步接口。所以先把元数据一次性拉下来，再交给模板同步使用。
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mapLimit(items, limit, fn) {
  const out = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function splitAttributes(raw) {
  const attrs = raw.attributes ?? [];
  return {
    labels: attrs.filter((a) => a.type === 'label'),
    relations: attrs.filter((a) => a.type === 'relation'),
  };
}

/**
 * 某笔记自身「可继承」的属性（label + relation）。
 * 对齐 Trilium `BAttribute.isInheritable`：可继承属性沿父链下传给所有子孙笔记。
 * 注意 relation 同样可继承 —— `~shareCss` / `~shareJs` 挂在分享根笔记上，
 * 子页面渲染时 note 是子笔记，只能靠继承取到。
 */
function inheritableAttrs(node) {
  return [...node.ownLabels, ...node.ownRelations].filter((a) => a.isInheritable);
}

export class TriliumStore {
  constructor(api, { rootNoteId, ttl = 30000, depth = 6, maxNotes = 2000 } = {}) {
    this.api = api;
    this.rootNoteId = rootNoteId;
    this.ttl = ttl;
    this.depth = depth;
    this.maxNotes = maxNotes;

    this.nodes = new Map(); // noteId -> node
    this.byShare = new Map(); // shareId -> noteId
    this.contentCache = new Map(); // noteId -> { text, ts }
    this.attachmentCache = new Map(); // attachmentId -> { buffer, contentType, ts }
    this.loadedAt = 0;
    this.loading = null;
    this.stats = { notes: 0, durationMs: 0, truncated: false };
  }

  get root() {
    return this.get(this.rootNoteId);
  }

  get(noteId) {
    const node = this.nodes.get(noteId);
    return node ? node.note : undefined;
  }

  resolveShareId(noteId) {
    const node = this.nodes.get(noteId);
    return node ? node.note.shareId : noteId;
  }

  async _fetchNode(noteId) {
    const raw = await this.api.getNote(noteId);
    const { labels, relations } = splitAttributes(raw);
    return {
      raw,
      noteId,
      ownLabels: labels.map((l) => ({ ...l, own: true })),
      ownRelations: relations.map((r) => ({ ...r, own: true })),
      labels: labels.map((l) => ({ ...l, own: true })),
      relations: relations.map((r) => ({ ...r, own: true })),
      children: raw.childNoteIds ?? [], // noteId 数组
      parentId: (raw.parentNoteIds ?? [])[0] ?? null,
      depth: 0,
      note: null, // ShareNote
    };
  }

  /** 预取整棵子树（元数据）。force = 忽略 TTL 重新拉取 */
  async ensure(force = false) {
    const fresh = this.loadedAt && Date.now() - this.loadedAt < this.ttl;
    if (!force && fresh && this.nodes.size) return this;
    if (this.loading) return this.loading;

    this.loading = this._load(force).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  async _load() {
    const started = Date.now();
    const nodes = new Map();
    const byShare = new Map();
    let truncated = false;

    const rootRaw = await this.api.getNote(this.rootNoteId);
    const rootNode = {
      raw: rootRaw,
      noteId: this.rootNoteId,
      ownLabels: splitAttributes(rootRaw).labels.map((l) => ({ ...l, own: true })),
      ownRelations: splitAttributes(rootRaw).relations.map((r) => ({ ...r, own: true })),
      children: rootRaw.childNoteIds ?? [],
      parentId: null,
      depth: 0,
      inherited: [],
      note: null,
    };
    rootNode.labels = rootNode.ownLabels;
    rootNode.relations = rootNode.ownRelations;
    nodes.set(rootNode.noteId, rootNode);

    // 逐层 BFS：每层并行拉取
    let frontier = [rootNode];
    let reachedDepth = 0;
    while (frontier.length && reachedDepth < this.depth) {
      const nextLevel = [];
      for (const parent of frontier) {
        if (nodes.size >= this.maxNotes) {
          truncated = true;
          break;
        }
        parent.children = parent.children.filter((id) => !nodes.has(id));
        const children = await mapLimit(parent.children, 8, async (id) => {
          try {
            return await this._fetchNode(id);
          } catch (err) {
            console.warn(`[store] 拉取笔记失败 ${id}: ${err.message}`);
            return null;
          }
        });
        for (const child of children) {
          if (!child || nodes.size >= this.maxNotes) {
            if (child) truncated = true;
            continue;
          }
          child.parentId = parent.noteId;
          child.depth = parent.depth + 1;
          // 继承可继承属性（label + relation 都沿父链下传）
          child.inherited = [...parent.inherited, ...inheritableAttrs(parent)];
          child.labels = dedupeAttrs(child.inherited.filter((a) => a.type === 'label'), child.ownLabels);
          child.relations = dedupeAttrs(child.inherited.filter((a) => a.type === 'relation'), child.ownRelations);
          nodes.set(child.noteId, child);
          nextLevel.push(child);
          const shareId = child.labels.find((l) => l.name === 'shareAlias')?.value || child.noteId;
          if (!byShare.has(shareId)) byShare.set(shareId, child.noteId);
        }
      }
      frontier = nextLevel;
      reachedDepth += 1;
    }

    for (const node of nodes.values()) {
      node.note = new ShareNote(node, this);
      const shareId = node.note.shareId;
      if (!byShare.has(shareId)) byShare.set(shareId, node.noteId);
    }

    this.nodes = nodes;
    this.byShare = byShare;
    this.loadedAt = Date.now();
    this.stats = { notes: nodes.size, durationMs: Date.now() - started, truncated };
    console.log(
      `[store] 预取完成：${nodes.size} 篇笔记 / ${this.stats.durationMs}ms${truncated ? '（已达 MAX_NOTES 上限，截断）' : ''}`,
    );
    return this;
  }

  /** 按 shareId（别名或 noteId）取笔记；不在预取范围时按需补拉 */
  async resolve(shareId) {
    await this.ensure();
    const noteId = this.byShare.get(shareId) || shareId;
    if (this.nodes.has(noteId)) return this.get(noteId);
    if (this.byShare.has(shareId)) return this.get(this.byShare.get(shareId));
    // 兜底：单条补拉（不在预取深度内 / 尚未加入索引）
    try {
      const node = await this._fetchNode(noteId);
      node.parentId = (node.raw.parentNoteIds ?? [])[0] ?? null;
      node.inherited = await this._collectInherited(node.parentId);
      node.labels = dedupeAttrs(node.inherited.filter((a) => a.type === 'label'), node.ownLabels);
      node.relations = dedupeAttrs(node.inherited.filter((a) => a.type === 'relation'), node.ownRelations);
      node.children = node.raw.childNoteIds ?? [];
      node.note = new ShareNote(node, this);
      this.nodes.set(node.noteId, node);
      this.byShare.set(node.note.shareId, node.noteId);
      return node.note;
    } catch {
      return undefined;
    }
  }

  /** 向上收集可继承标签（用于预取范围之外的笔记） */
  async _collectInherited(parentId, acc = [], guard = 0) {
    if (!parentId || guard > 20) return acc;
    let parent = this.nodes.get(parentId);
    if (!parent) {
      try {
        parent = await this._fetchNode(parentId);
        parent.inherited = await this._collectInherited(parent.parentId, [], guard + 1);
        parent.labels = dedupeAttrs(parent.inherited, parent.ownLabels);
        parent.relations = dedupeAttrs(parent.inherited, parent.ownRelations);
        parent.children = parent.raw.childNoteIds ?? [];
        parent.note = new ShareNote(parent, this);
        this.nodes.set(parent.noteId, parent);
      } catch {
        return acc;
      }
    }
    const next = [...inheritableAttrs(parent), ...acc];
    return this._collectInherited(parent.parentId, next, guard + 1);
  }

  /** 笔记内容（文本/HTML），带缓存 */
  async content(noteId, force = false) {
    const hit = this.contentCache.get(noteId);
    if (!force && hit && Date.now() - hit.ts < this.ttl) return hit.text;
    let text = '';
    try {
      const res = await this.api.getNoteContent(noteId);
      text = typeof res === 'string' ? res : res === null ? '' : String(res);
    } catch (err) {
      // book / 无内容笔记在 ETAPI 下可能直接报错，视为空内容
      if (err.status !== 404) console.warn(`[store] 读取内容失败 ${noteId}: ${err.message}`);
    }
    this.contentCache.set(noteId, { text, ts: Date.now() });
    return text;
  }

  /** 附件二进制（图片等） */
  async attachment(attachmentId) {
    const hit = this.attachmentCache.get(attachmentId);
    if (hit && Date.now() - hit.ts < this.ttl) return hit;
    const meta = await this.api.getAttachment(attachmentId).catch(() => null);
    const { buffer, contentType } = await this.api.getAttachmentContent(attachmentId);
    const result = { buffer, contentType: meta?.mime || contentType, meta };
    this.attachmentCache.set(attachmentId, { ...result, ts: Date.now() });
    return result;
  }

  /** 图片笔记 / 附件图片：ETAPI 只给内容，MIME 需要单独查 */
  async binary(noteId) {
    const hit = this.contentCache.get('bin:' + noteId);
    if (hit && Date.now() - hit.ts < this.ttl) return hit;
    const node = this.nodes.get(noteId);
    let mime = node?.note.mime;
    try {
      const { buffer, contentType } = await this.api.getAttachmentContent(noteId);
      const result = { buffer, contentType: mime || contentType };
      this.contentCache.set('bin:' + noteId, { ...result, ts: Date.now() });
      return result;
    } catch {
      const res = await this.api.getNoteContent(noteId);
      const buffer = Buffer.isBuffer(res) ? res : Buffer.from(String(res ?? ''), 'utf8');
      const result = { buffer, contentType: mime || 'application/octet-stream' };
      this.contentCache.set('bin:' + noteId, { ...result, ts: Date.now() });
      return result;
    }
  }

  invalidate() {
    this.loadedAt = 0;
    this.contentCache.clear();
    this.attachmentCache.clear();
  }

  /** /__dev/state 调试用摘要 */
  state() {
    const posts = [];
    const walk = (note, depth = 0) => {
      if (!note) return;
      posts.push({
        noteId: note.noteId,
        shareId: note.shareId,
        title: note.title,
        type: note.type,
        depth,
        publish: note.getLabelValue('publish'),
        blogDate: note.getLabelValue('blogDate'),
        labels: note.getLabelValues('blogTags'),
      });
      for (const child of note.getVisibleChildNotes()) walk(child, depth + 1);
    };
    walk(this.root);
    return {
      rootNoteId: this.rootNoteId,
      loadedAt: new Date(this.loadedAt).toISOString(),
      stats: this.stats,
      total: posts.length,
      nodes: posts,
    };
  }
}

/** 合并属性：自身属性优先，继承来的按 `name=value` 去重 */
function dedupeAttrs(inherited, own) {
  const seen = new Set();
  const out = [];
  for (const a of own) {
    seen.add(`${a.name}=${a.value}`);
    out.push(a);
  }
  for (const a of inherited) {
    const key = `${a.name}=${a.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}
