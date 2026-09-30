/** 与分享模板对齐的小工具（对应 Trilium 模板 locals 里的 utils） */

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

export function stripTags(html) {
  return String(html ?? '').replace(/<[^>]*>/g, '');
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 给 HTML 里的标题补 id，并返回扁平/树形目录数据（服务端出 TOC 时用）
 */
export function slugifyHeadings(html) {
  const headings = [];
  const used = new Map();
  const out = String(html ?? '').replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi, (match, level, attrs, inner) => {
    const text = stripTags(inner).trim();
    let id = slugify(text);
    if (used.has(id)) {
      const n = used.get(id) + 1;
      used.set(id, n);
      id = `${id}-${n}`;
    } else {
      used.set(id, 0);
    }
    headings.push({ id, text, level: Number(level), children: [] });
    const cleanAttrs = attrs.replace(/\s*\bid="[^"]*"/i, '');
    return `<h${level}${cleanAttrs} id="${id}">${inner}</h${level}>`;
  });

  // 构建层级树
  const tree = [];
  const stack = [{ level: 0, children: tree }];
  for (const h of headings) {
    while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop();
    stack[stack.length - 1].children.push(h);
    stack.push(h);
  }
  return { html: out, headings, tree };
}

export const utils = { slugify, stripTags, escapeHtml, slugifyHeadings };
