'use strict';

/* ==========================================================================
 * TimelyBlogTheme 交互脚本
 *
 * 页面内容全部由 EJS 服务端渲染，本脚本只负责交互：
 *   主题切换 / 折叠面板 / 分类下拉 / 导航高亮 / hash 路由（标签·归档·分类）
 *   / 目录滚动高亮 / 代码块复制 / 图片灯箱 / 搜索弹窗 / 阅读进度 / 回到顶部
 * ========================================================================== */
(function () {
  var D = document;
  var docEl = D.documentElement;

  function qs(sel, root) { return (root || D).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || D).querySelectorAll(sel)); }

  var SITE_NAME = D.body.getAttribute('data-site-name') || '';

  /* 站内链接基址：由 EJS 的 <body data-share-base> 下发，与模板里的 linkBase 同一值。
     ⚠️ 拼站内地址必须用**绝对路径**（/share/xxx），不能用相对链接 './xxx'：
        反向代理把分享页映射到域名根时（www.yihwang.top/ → /share/），
        浏览器地址栏是 `/`，'./xxx' 会解析成 `/xxx`（少了 /share）→ 404。
     缺属性时回落 /share/（Trilium 分享页的固定前缀）。 */
  var SHARE_BASE = D.body.getAttribute('data-share-base') || '/share/';

  /* ==================== 明 / 暗主题 ==================== */
  function isDark() { return docEl.classList.contains('dark'); }

  function syncHljs() {
    var light = D.getElementById('hljs-light');
    var dark = D.getElementById('hljs-dark');
    if (light && dark) { light.disabled = isDark(); dark.disabled = !isDark(); }
  }
  syncHljs();

  var themeBtn = D.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var dark = docEl.classList.toggle('dark');
      try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) { /* 隐私模式忽略 */ }
      syncHljs();
    });
  }

  /* ==================== 折叠面板 ==================== */
  /* 侧边栏标签、目录面板、目录分组、移动端目录共用：
     [data-toggle="元素id"] 控制 hidden，aria-expanded 交给 CSS 做箭头旋转 */
  qsa('[data-toggle]').forEach(function (btn) {
    var panel = D.getElementById(btn.getAttribute('data-toggle'));
    if (!panel) return;
    var icon = btn.getAttribute('data-icon') === 'plusminus' ? btn.querySelector('i') : null;

    function render() {
      var expanded = !panel.hidden;
      btn.setAttribute('aria-expanded', String(expanded));
      if (icon) {
        icon.classList.toggle('fa-plus', !expanded);
        icon.classList.toggle('fa-minus', expanded);
      }
    }
    btn.addEventListener('click', function () { panel.hidden = !panel.hidden; render(); });
    render();
  });

  /* ==================== 分类下拉 ==================== */
  var dropdown = qs('[data-dropdown]');
  if (dropdown) {
    var ddBtn = qs('[data-dropdown-toggle]', dropdown);
    var ddMenu = qs('[data-dropdown-menu]', dropdown);
    ddBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      ddMenu.hidden = !ddMenu.hidden;
      ddBtn.setAttribute('aria-expanded', String(!ddMenu.hidden));
    });
    D.addEventListener('click', function () {
      if (ddMenu.hidden) return;
      ddMenu.hidden = true;
      ddBtn.setAttribute('aria-expanded', 'false');
    });
  }

  /* ==================== 导航高亮 ==================== */
  function setNav(view, value) {
    D.body.setAttribute('data-view', view);
    var key = view === 'tag' ? 'tags' : view;
    qsa('[data-nav]').forEach(function (el) {
      if (el.getAttribute('data-nav') === key) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    qsa('[data-tag]').forEach(function (el) {
      if (view === 'tag' && el.getAttribute('data-tag') === value) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }

  function titleFor(name, value) {
    if (name === 'home') return SITE_NAME;
    var label = { archive: '归档', tags: '标签', about: '关于', notfound: '404' }[name];
    if (name === 'tag') label = '标签：' + (value || '');
    if (name === 'category') label = '分类：' + (value || '');
    if (!label) return SITE_NAME;
    return SITE_NAME ? label + ' - ' + SITE_NAME : label;
  }

  /* ==================== hash 路由（仅列表页） ==================== */
  var panels = qsa('[data-view-panel]');

  if (!panels.length) {
    /* 文章页：与旧行为一致，保持「首页」高亮 */
    setNav('home');
  } else {
    var cards = qsa('[data-view-panel="home"] article[data-post-id]');

    function parseHash() {
      var h = window.location.hash || '';
      /* #heading-x 之类的正文锚点不参与路由 */
      if (h.length > 1 && h.slice(0, 2) !== '#/') return null;
      if (!h || h === '#/' || h === '#') return { name: 'home' };
      if (h === '#/archive') return { name: 'archive' };
      if (h === '#/tags') return { name: 'tags' };
      if (h === '#/about') return { name: 'about' };
      var m = h.match(/^#\/tag\/(.+)$/);
      if (m) return { name: 'tag', value: decodeURIComponent(m[1]) };
      m = h.match(/^#\/category\/(.+)$/);
      if (m) return { name: 'category', value: decodeURIComponent(m[1]) };
      return { name: 'notfound' };
    }

    function findPanel(name) {
      for (var i = 0; i < panels.length; i++) {
        if (panels[i].getAttribute('data-view-panel') === name) return panels[i];
      }
      return null;
    }

    /* 标签 / 分类列表：直接克隆首页的卡片，不额外下发一份 HTML */
    function fillFiltered(route) {
      var panel = findPanel(route.name);
      if (!panel) return;
      var box = qs('[data-filter-list]', panel);
      if (!box) return;
      var count = 0;
      box.textContent = '';
      cards.forEach(function (card) {
        var hit = route.name === 'tag'
          ? (card.getAttribute('data-tags') || '').split('|').indexOf(route.value) !== -1
          : card.getAttribute('data-category') === route.value;
        if (!hit) return;
        count++;
        box.appendChild(card.cloneNode(true));
      });
      var nameEl = qs('[data-filter-name]', panel);
      var countEl = qs('[data-filter-count]', panel);
      if (nameEl) nameEl.textContent = route.value;
      if (countEl) countEl.textContent = String(count);
    }

    function showView(route) {
      panels.forEach(function (p) { p.hidden = p.getAttribute('data-view-panel') !== route.name; });
      if (route.name === 'tag' || route.name === 'category') fillFiltered(route);
      setNav(route.name, route.value);
      D.title = titleFor(route.name, route.value);
    }

    function applyHash(scrollTop) {
      var route = parseHash();
      if (!route) return;
      showView(route);
      if (scrollTop) window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    window.addEventListener('hashchange', function () { applyHash(true); });
    applyHash(false);
  }

  /* ==================== 正文增强（仅文章页） ==================== */
  var contentEl = D.getElementById('post-content');
  if (contentEl) {
    /* --- 代码块：包一层 header + 复制按钮 + highlight.js 高亮 --- */

    /* Trilium 输出的代码块 class 是 MIME 形式，需要归一到 hljs 认识的语言名。
       实测遇到的形态：
         language-text-x-sh                    → bash
         language-text-x-yaml                  → yaml
         language-text-x-trilium-auto          → 空（交给 hljs 自动探测）
         language-application-typescript       → typescript
         language-application-javascript-env-backend → javascript
       归一规则，按顺序：① 查别名表；② 去掉 text-x- / application- / text- 前缀；
       ③ application-*-env-backend 这类以 -env-backend 结尾的取第一段。 */
    var LANGUAGE_MAP = {
      'sh': 'bash',
      'shell': 'bash',
      'shellscript': 'bash',
      'zsh': 'bash',
      'yml': 'yaml',
      'js': 'javascript',
      'ts': 'typescript',
      'jsx': 'javascript',
      'tsx': 'typescript',
      'html': 'xml',
      'htm': 'xml',
      'markup': 'xml',
      'docker': 'dockerfile',
      'docker-compose': 'yaml',
      'dockercompose': 'yaml',
      'trilium-auto': '',
      'plaintext': '',
      'plain': '',
      'code': '',
      'text': ''
    };

    function normalizeLang(raw) {
      var s = String(raw || '').toLowerCase().trim();
      if (!s) return '';
      if (LANGUAGE_MAP[s] !== undefined) return LANGUAGE_MAP[s];
      /* application-javascript-env-backend → javascript；text-x-yaml → yaml */
      s = s.replace(/^language-/, '').replace(/^application-/, '').replace(/^text-x-/, '').replace(/^text-/, '');
      s = s.replace(/-env-backend$/, '');
      if (LANGUAGE_MAP[s] !== undefined) return LANGUAGE_MAP[s];
      /* 剩下的复合名取第一段（如 docker-compose → docker） */
      if (s.indexOf('-') > 0 && LANGUAGE_MAP[s.split('-')[0]] !== undefined) return LANGUAGE_MAP[s.split('-')[0]];
      return s;
    }

    function highlight(code) {
      if (!window.hljs) return;
      var lang = (code.className.match(/language-([\w-]+)/) || [])[1] || '';
      var normalized = normalizeLang(lang);
      var result;
      try {
        result = normalized
          ? window.hljs.highlight(code.textContent, { language: normalized, ignoreIllegals: true })
          : window.hljs.highlightAuto(code.textContent);
      } catch (e) {
        return; /* 语言未注册或语法异常时保持纯文本 */
      }
      code.innerHTML = result.value;
      code.classList.add('hljs');
      code.classList.add('language-' + (result.language || normalized || 'plaintext'));
      code.setAttribute('data-lang', result.language || normalized || 'plaintext');
    }

    qsa('pre', contentEl).forEach(function (pre) {
      var code = pre.querySelector('code');
      if (!code || pre.closest('.code-block')) return;

      var lang = normalizeLang((code.className.match(/language-([\w-]+)/) || [])[1] || '');
      code.setAttribute('data-lang', lang || 'text');

      var wrapper = D.createElement('div');
      wrapper.className = 'code-block';

      var header = D.createElement('div');
      header.className = 'code-header';

      var label = D.createElement('span');
      label.textContent = lang || 'text';

      var copyBtn = D.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'copy-btn';
      var COPY_IDLE = '<i class="fa-regular fa-copy" style="margin-right:0.25rem"></i>复制';
      var COPY_DONE = '<i class="fa-solid fa-check" style="color:#22c55e;margin-right:0.25rem"></i><span style="color:#22c55e">已复制</span>';
      copyBtn.innerHTML = COPY_IDLE;

      header.appendChild(label);
      header.appendChild(copyBtn);
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(header);
      wrapper.appendChild(pre);

      copyBtn.addEventListener('click', function () {
        var text = code.textContent;
        var done = function () {
          copyBtn.innerHTML = COPY_DONE;
          setTimeout(function () { copyBtn.innerHTML = COPY_IDLE; }, 2000);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { /* 用户拒绝授权则忽略 */ });
        } else {
          /* http 等非安全上下文没有 clipboard API，退回 execCommand */
          var ta = D.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          try {
            D.body.appendChild(ta);
            ta.select();
            D.execCommand('copy');
            done();
          } catch (err) { /* 环境不支持复制时静默忽略 */ }
          if (ta.parentNode) ta.parentNode.removeChild(ta);
        }
      });

      highlight(code);
    });

    /* --- 图片灯箱 --- */
    var lightbox = D.getElementById('lightbox');
    var lightboxImg = D.getElementById('lightbox-img');
    if (lightbox && lightboxImg) {
      var closeLightbox = function () {
        lightbox.hidden = true;
        lightboxImg.setAttribute('src', '');
      };
      lightbox.addEventListener('click', closeLightbox);
      lightboxImg.addEventListener('click', function (e) { e.stopPropagation(); });
      D.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
      });

      qsa('img', contentEl).forEach(function (img) {
        if (img.closest('a')) return;
        img.addEventListener('click', function (e) {
          lightboxImg.setAttribute('src', img.currentSrc || img.src);
          lightbox.hidden = false;
          e.stopPropagation();
        });
      });
    }

    /* --- 外部链接新窗口打开 --- */
    qsa('a[href]', contentEl).forEach(function (a) {
      if (a.hostname && a.hostname !== window.location.hostname) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
    });
  }

  /* ==================== 目录：滚动高亮 ==================== */
  if (qsa('[data-toc-link]').length) {
    var tocMap = Object.create(null);
    qsa('[data-toc-link], [data-toc-mirror]').forEach(function (a) {
      var id = a.getAttribute('data-toc-link') || a.getAttribute('data-toc-mirror');
      if (!tocMap[id]) tocMap[id] = [];
      tocMap[id].push(a);
    });
    var headings = [];
    Object.keys(tocMap).forEach(function (id) {
      var el = D.getElementById(id);
      if (el) headings.push(el);
    });

    if (headings.length && 'IntersectionObserver' in window) {
      var lastId = '';
      var ready = false;

      var observer = new IntersectionObserver(function (entries) {
        if (!ready) return;
        entries.forEach(function (entry) {
          var group = tocMap[entry.target.id];
          if (group) {
            group.forEach(function (a) {
              a.setAttribute('aria-current', entry.isIntersecting ? 'true' : 'false');
            });
          }
          if (entry.isIntersecting && entry.target.id !== lastId) {
            lastId = entry.target.id;
            history.replaceState(null, '', '#' + entry.target.id);
          }
        });
      }, { rootMargin: '-80px 0px -70% 0px' });

      headings.forEach(function (h) { observer.observe(h); });

      /* URL 自带锚点时：先按锚点定位，等滚动结束再启用观察 */
      var initId = '';
      try { initId = decodeURIComponent((window.location.hash || '').replace(/^#/, '')); } catch (e) { initId = ''; }
      if (initId && tocMap[initId]) {
        tocMap[initId].forEach(function (a) { a.setAttribute('aria-current', 'true'); });
        lastId = initId;
        setTimeout(function () { ready = true; }, 500);
      } else {
        ready = true;
      }
    }
  }

  /* ==================== 目录：点击平滑滚动 ==================== */
  D.addEventListener('click', function (e) {
    var node = e.target;
    var link = node && node.closest ? node.closest('[data-toc-link],[data-toc-jump]') : null;
    if (!link) return;
    var id = link.getAttribute('data-toc-link') || link.getAttribute('data-toc-jump');
    var target = id ? D.getElementById(id) : null;
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth' });
    if (link.hasAttribute('data-toc-jump')) {
      var panel = D.getElementById('mtoc-panel');
      var btn = D.getElementById('mtoc-toggle');
      if (panel) panel.hidden = true;
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  });

  /* ==================== 搜索 ==================== */
  var modal = D.getElementById('search-modal');
  if (modal) {
    var input = D.getElementById('search-input');
    var resultsBox = D.getElementById('search-results');
    var indexEl = D.getElementById('search-index');
    var index = [];
    if (indexEl) {
      try { index = JSON.parse(indexEl.textContent || '[]') || []; } catch (e) { index = []; }
    }

    var results = [];
    var selected = -1;

    function closeSearch() {
      modal.hidden = true;
      input.value = '';
      selected = -1;
      resultsBox.textContent = '';
    }

    function renderResults() {
      resultsBox.textContent = '';
      var q = input.value.trim().toLowerCase();
      results = q ? index.filter(function (p) {
        return String(p.title || '').toLowerCase().indexOf(q) !== -1
          || String(p.summary || '').toLowerCase().indexOf(q) !== -1
          || (p.tags || []).some(function (t) { return String(t).toLowerCase().indexOf(q) !== -1; });
      }) : [];

      if (q && !results.length) {
        var empty = D.createElement('div');
        empty.className = 'px-4 py-8 text-center text-stone-400 text-sm';
        empty.innerHTML = '<i class="fa-solid fa-magnifying-glass text-xl mb-2 block opacity-50"></i>没有找到相关文章';
        resultsBox.appendChild(empty);
        return;
      }

      results.forEach(function (p, i) {
        var a = D.createElement('a');
        a.href = SHARE_BASE + p.id;
        a.className = 'block px-4 py-3 transition-colors hover:bg-stone-100 dark:hover:bg-zinc-800';
        if (i === selected) a.setAttribute('aria-selected', 'true');

        var title = D.createElement('div');
        title.className = 'font-medium text-stone-800 dark:text-zinc-100';
        title.textContent = p.title || '';
        a.appendChild(title);

        if (p.summary) {
          var summary = D.createElement('div');
          summary.className = 'text-xs text-stone-400 dark:text-zinc-500 mt-1 line-clamp-2';
          summary.textContent = String(p.summary).substring(0, 80);
          a.appendChild(summary);
        }

        var meta = D.createElement('div');
        meta.className = 'text-xs text-stone-400 dark:text-zinc-500 mt-1';
        meta.textContent = (p.date || '') + (p.category ? ' · ' + p.category : '');
        a.appendChild(meta);

        a.addEventListener('click', closeSearch);
        resultsBox.appendChild(a);
      });
    }

    function openSearch() {
      modal.hidden = false;
      input.value = '';
      selected = -1;
      renderResults();
      input.focus();
    }

    function move(delta) {
      if (!results.length) return;
      selected = Math.max(0, Math.min(results.length - 1, selected + delta));
      renderResults();
      var current = resultsBox.querySelector('[aria-selected="true"]');
      if (current) current.scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('input', function () { selected = -1; renderResults(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeSearch(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return; }
      if (e.key === 'Enter' && selected >= 0) {
        var p = results[selected];
        if (p) {
          e.preventDefault();
          window.location.href = SHARE_BASE + p.id;
          closeSearch();
        }
      }
    });

    qsa('[data-search-open]').forEach(function (btn) { btn.addEventListener('click', openSearch); });
    qsa('[data-search-close]').forEach(function (btn) { btn.addEventListener('click', closeSearch); });
    var overlay = D.getElementById('search-overlay');
    if (overlay) overlay.addEventListener('click', closeSearch);
    D.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (modal.hidden) openSearch(); else closeSearch();
      }
    });
  }

  /* ==================== 阅读进度 + 回到顶部 ==================== */
  var progressBar = D.getElementById('reading-progress');
  var backToTop = D.getElementById('back-to-top');
  if (progressBar || backToTop) {
    var queued = false;

    function onScroll() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(function () {
        queued = false;
        var y = window.scrollY || window.pageYOffset || 0;
        if (progressBar) {
          var total = docEl.scrollHeight - window.innerHeight;
          progressBar.style.width = (total > 0 ? Math.min(100, (y / total) * 100) : 0) + '%';
        }
        if (backToTop) backToTop.classList.toggle('is-visible', y > 300);
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    if (backToTop) {
      backToTop.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
    onScroll();
  }
})();
