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
