/**
 * 模拟 Trilium 模板里可用的 note 对象（SNote / Note 的子集）
 * 模板中用到的方法：noteId / title / dateCreated / getLabelValue / getLabelValues /
 * hasLabel / getChildNotes / getVisibleChildNotes / hasChildren
 * 全部为同步调用 —— 数据由 TriliumStore 预取后放进内存。
 */
export class ShareNote {
  constructor(node, store) {
    this._node = node;
    this._store = store;
  }

  get noteId() {
    return this._node.noteId;
  }

  get title() {
    return this._node.raw.title ?? '';
  }

  get type() {
    return this._node.raw.type ?? 'text';
  }

  get mime() {
    return this._node.raw.mime ?? 'text/html';
  }

  get isProtected() {
    return !!this._node.raw.isProtected;
  }

  get dateCreated() {
    return this._node.raw.dateCreated ?? '';
  }

  get utcDateModified() {
    return this._node.raw.utcDateModified ?? '';
  }

  get parentNoteIds() {
    return this._node.raw.parentNoteIds ?? [];
  }

  /** 对齐 Trilium SNote.shareId：分享根笔记返回 ''，否则 shareAlias || noteId */
  get shareId() {
    if (this.hasLabel('shareRoot')) return '';
    return this.getLabelValue('shareAlias') || this.noteId;
  }

  get escapedTitle() {
    return String(this.title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * 对齐 Trilium v0.105.0 的 SNote.getIcon(filterByPrefix)：
   *   读 #iconClass label（可被 filterByPrefix 过滤）→ 交给 getNoteIcon() 兜底类型默认。
   * 线上返回 `tn-icon <class>`；本地没有 tn-icon 那套样式，故只返回裸图标 class，
   * 由主题自己拼 <i class="...">。既有的 `#iconClass`（如 "bx bxs-shower"）原样透出。
   */
  getIcon(filterByPrefix = []) {
    const iconClassLabels = this.getLabelValues('iconClass').filter((value) => {
      if (filterByPrefix.length === 0) return true;
      return filterByPrefix.some((prefix) => value.startsWith(prefix));
    });
    return iconClassLabels.length > 0 ? iconClassLabels[0] : this._defaultIcon();
  }

  /** 对齐 getNoteIcon()：未设 #iconClass 时的类型回退（内置图标包 prefix = bx） */
  _defaultIcon() {
    if (this.hasLabel('shareRoot')) return 'bx bx-home-alt-2';
    if (this.noteId === '_share') return 'bx bx-share-alt';
    if (this.type === 'text') return this.hasChildren() ? 'bx bx-folder' : 'bx bx-note';
    if (this.type === 'code' && /^text\/x-sql/.test(this.mime)) return 'bx bx-data';
    if (this.type === 'code') return 'bx bx-code-curly';
    if (this.type === 'book') return 'bx bx-book';
    if (this.type === 'image') return 'bx bx-image';
    if (this.type === 'canvas') return 'bx bx-pen';
    if (this.type === 'file') return 'bx bx-file';
    return 'bx bx-note';
  }

  /* ---------------- 标签 / 关系 ---------------- */

  getLabelValue(name) {
    const found = this._node.labels.find((l) => l.name === name);
    return found ? found.value : null;
  }

  getLabelValues(name) {
    return this._node.labels.filter((l) => l.name === name).map((l) => l.value);
  }

  hasLabel(name) {
    return this._node.labels.some((l) => l.name === name);
  }

  isLabelTruthy(name) {
    const v = this.getLabelValue(name);
    return v !== null && v !== 'false';
  }

  getLabel(name) {
    return this._node.labels.find((l) => l.name === name) ?? null;
  }

  getRelation(name) {
    const r = this._node.relations.find((x) => x.name === name);
    return r ? { name: r.name, value: r.value } : null;
  }

  getRelations(name) {
    return this._node.relations.filter((r) => r.name === name).map((r) => ({ name: r.name, value: r.value }));
  }

  hasRelation(name) {
    return this._node.relations.some((r) => r.name === name);
  }

  /* ---------------- 树 ---------------- */

  hasChildren() {
    return this._node.children.length > 0;
  }

  hasVisibleChildren() {
    return this.getVisibleChildNotes().length > 0;
  }

  getChildNotes() {
    return this._node.children.map((id) => this._store.get(id)).filter(Boolean);
  }

  /**
   * 生产环境里 shaca 只包含「已共享」的笔记，因此 visible = 已共享且未标记隐藏。
   * 本地通过 ETAPI 无法读到共享开关，故：排除 #shareHiddenFromTree（隐藏项）。
   * 若本地树里混有未共享笔记，给它们加 #shareHiddenFromTree 即可对齐线上表现。
   */
  getVisibleChildNotes() {
    return this._node.children
      .map((id) => this._store.get(id))
      .filter((n) => n && !n.hasLabel('shareHiddenFromTree'));
  }

  getParents() {
    return this.parentNoteIds.map((id) => this._store.get(id)).filter(Boolean);
  }

  /** 模板脚本里可能出现，保持静默 */
  save() {}
  addLabel() {}
  setLabel() {}

  toString() {
    return `ShareNote(${this.noteId}, ${this.title})`;
  }
}
