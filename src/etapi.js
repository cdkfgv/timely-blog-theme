/**
 * ETAPI 客户端（Trilium External API）
 * 规范参考：https://github.com/TriliumNext/Notes/blob/develop/apps/server/src/assets/etapi.openapi.yaml
 * 认证：Authorization: <ETAPI_TOKEN>
 */

export class EtapiError extends Error {
  constructor(message, { status, path } = {}) {
    super(message);
    this.name = 'EtapiError';
    this.status = status;
    this.path = path;
  }
}

export function createEtapi({ baseUrl, token, timeout = 20000 }) {
  const apiRoot = `${baseUrl.replace(/\/+$/, '')}/etapi`;

  async function request(pathname, { method = 'GET', body, contentType, binary = false } = {}) {
    const url = `${apiRoot}${pathname}`;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: token,
          ...(contentType ? { 'Content-Type': contentType } : {}),
        },
        body,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      throw new EtapiError(
        `无法连接 Trilium (${apiRoot})：${err.message}\n` +
          '请确认 TRILIUM_URL 正确、Trilium 已启动、且允许本机访问。',
        { path: pathname },
      );
    }

    if (res.status === 401) {
      throw new EtapiError('ETAPI 认证失败（401）：请检查 ETAPI_TOKEN 是否正确/是否被删除。', {
        status: 401,
        path: pathname,
      });
    }
    if (res.status === 404) {
      throw new EtapiError(`资源不存在（404）：${pathname}`, { status: 404, path: pathname });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new EtapiError(`ETAPI 请求失败 ${res.status} ${pathname}\n${text.slice(0, 500)}`, {
        status: res.status,
        path: pathname,
      });
    }

    if (binary) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { buffer: buf, contentType: res.headers.get('content-type') || 'application/octet-stream' };
    }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return {
    apiRoot,
    request,
    appInfo: () => request('/app-info'),
    getNote: (noteId) => request(`/notes/${encodeURIComponent(noteId)}`),
    getNoteContent: (noteId) => request(`/notes/${encodeURIComponent(noteId)}/content`),
    putNoteContent: (noteId, content, contentType = 'text/plain') =>
      request(`/notes/${encodeURIComponent(noteId)}/content`, {
        method: 'PUT',
        body: content,
        contentType,
      }),
    getAttachment: (attachmentId) => request(`/attachments/${encodeURIComponent(attachmentId)}`),
    getAttachmentContent: (attachmentId) =>
      request(`/attachments/${encodeURIComponent(attachmentId)}/content`, { binary: true }),
  };
}
