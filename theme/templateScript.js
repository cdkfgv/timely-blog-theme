/*
 * Trilium 属性变更脚本（挂到博客子树的 ~runOnAttributeChange 上）
 * 触发条件：笔记的 `publish` 标签发生变化
 * 作用：publish=true 时自动补 #blogSummary（正文纯文本前 120 字）与 #blogDate（当天）
 *
 * 注意：本文件由 Trilium 的 Script 环境执行（顶层 return / const 均可用）。
 */

if (api.originEntity.isDeleted) { return; }
if (api.originEntity.name !== 'publish') { return; }

/* 摘要噪声块：代码、脚本、样式、表格等不应出现在摘要里 */
const NOISE_BLOCK = /<(script|style|pre|code|figure|table|svg)\b[\s\S]*?<\/\1>/gi;
/* 块级收尾标签 → 空格，避免英文两段粘在一起 */
const BLOCK_BREAK = /<(\/p|\/div|\/li|\/h[1-6]|br)\s*\/?>/gi;
/* 中日韩统一表意文字 + 全角标点：两侧的空白直接吃掉（中文不需要词间空格） */
const CJK = '\\u3000-\\u303f\\u4e00-\\u9fff\\uff00-\\uffef';

const note = api.originEntity.getNote();

if (note.getLabelValue('publish') === 'true') {
    note.setLabel('blogSummary', extractTextFromHTML(note.getContent()));
    if (!note.getLabelValue('blogDate')) {
        note.setLabel('blogDate', getFormattedDate());
    }
    note.save();
}

/** 正文 → 纯文本摘要（上限 120 字，超出才加省略号） */
function extractTextFromHTML(html) {
    let text = String(html || '')
        .replace(NOISE_BLOCK, ' ')   // 先剥代码块，否则代码会污染摘要开头
        .replace(BLOCK_BREAK, ' ')
        .replace(/<[^>]*>/g, '');    // 剩下的标签一律去掉

    text = text
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").replace(/&amp;/g, '&')   // &amp; 必须最后还原
        .replace(new RegExp(`([${CJK}])[\\s]+([${CJK}])`, 'g'), '$1$2') // 中文之间不留空格
        .replace(/\s+/g, ' ')
        .trim();

    return text.length > 120 ? text.substring(0, 120) + '...' : text;
}

/** yyyy-MM-dd */
function getFormattedDate() {
    const date = new Date();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}
