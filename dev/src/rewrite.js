/**
 * 内容渲染：对齐 Trilium 的 share/content_renderer.ts
 * - 内部笔记链接（#root/xxx 或 #xxx）→ 相对链接 ./{shareId}
 * - 附件链接（#xxx?attachmentId=yyy）→ api/attachments/yyy/download
 * - 打不开的链接去掉 href（与 Trilium 一致）
 * - api/ 开头的资源路径统一转成 /share/api/ 绝对路径，保证任意页面深度都能取到
 */

export function rewriteContent(html, { resolveNote }) {
  if (!html) return '';

  // ---------- <a> ----------
  let out = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs, inner) => {
    const hrefMatch = attrs.match(/\bhref="([^"]*)"/i);
    if (!hrefMatch) return match;
    const href = hrefMatch[1];

    // 脚注锚点保持原样
    if (href.startsWith('#fn')) return match;

    if (href.startsWith('#')) {
      const attachment = href.match(/attachmentId=([a-zA-Z0-9_]+)/);
      if (attachment) {
        const id = attachment[1];
        const nextAttrs = setAttr(attrs, 'href', `/share/api/attachments/${id}/download`);
        const withClass = addClass(nextAttrs, 'attachment-link');
        return `<a${withClass}>${inner}</a>`;
      }

      const [notePath] = href.split('?');
      const segments = notePath.split('/');
      const noteId = segments[segments.length - 1];
      const linked = resolveNote(noteId);
      if (!linked) {
        // Trilium：目标不可共享/不存在 → 移除 href，保留文字
        return `<a${attrs.replace(/\s*\bhref="[^"]*"/i, '')}>${inner}</a>`;
      }
      const external = linked.getLabelValue('shareExternalLink') || linked.getLabelValue('shareExternal');
      if (external) {
        let nextAttrs = setAttr(attrs, 'href', external);
        nextAttrs = setAttr(nextAttrs, 'target', '_blank');
        nextAttrs = setAttr(nextAttrs, 'rel', 'noopener noreferrer');
        return `<a${nextAttrs}>${inner}</a>`;
      }
      const nextAttrs = addClass(setAttr(attrs, 'href', `./${linked.shareId}`), `type-${linked.type}`);
      return `<a${nextAttrs}>${inner}</a>`;
    }

    // 其他（站外/协议链接）只做 api 路径归一
    if (/^(api\/|\/api\/)/i.test(href)) {
      return `<a${setAttr(attrs, 'href', href.replace(/^\/?api\//i, '/share/api/'))}>${inner}</a>`;
    }
    return match;
  });

  // ---------- <img> ----------
  out = out.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
    const srcMatch = attrs.match(/\bsrc="([^"]*)"/i);
    if (!srcMatch) return match;
    const src = srcMatch[1];
    if (/^https?:\/\//i.test(src) || src.startsWith('data:')) return match;
    if (/^\/?api\//i.test(src)) {
      return `<img${setAttr(attrs, 'src', src.replace(/^\/?api\//i, '/share/api/'))}>`;
    }
    return match;
  });

  return out;
}

function setAttr(attrs, name, value) {
  const safe = String(value).replace(/"/g, '&quot;');
  const re = new RegExp(`\\s*\\b${name}="[^"]*"`, 'i');
  if (re.test(attrs)) return attrs.replace(re, ` ${name}="${safe}"`);
  return `${attrs} ${name}="${safe}"`;
}

function addClass(attrs, cls) {
  const re = /\bclass="([^"]*)"/i;
  if (re.test(attrs)) {
    return attrs.replace(re, (m, existing) => (existing.includes(cls) ? m : `class="${existing} ${cls}"`));
  }
  return `${attrs} class="${cls}"`;
}

/** 是否为空内容（对齐 Trilium：无文本且无图片） */
export function isEmptyContent(html) {
  if (!html) return true;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return text.length === 0 && !/<img\b/i.test(html);
}
