'use strict';

/* ================================================================
   工具函数
================================================================ */
const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isDark() {
  return document.documentElement.classList.contains('dark');
}

/* ================================================================
   Vue 依赖（在 DOMContentLoaded 后从 window.Vue 获取）
================================================================ */
var ref, reactive, computed, watch, onMounted, nextTick, createApp;

/* ================================================================
   全局共享状态（先用普通对象，DOMContentLoaded 后增强为响应式）
================================================================ */
const G = {
  route: { name: 'home', params: {} },
  isPostPage: window.BLOG_DATA?.isPostPage ?? false,
  searchOpen: null,
  lightboxSrc: null,
  lightboxOpen: null,
  // TOC 数据（文章详情页使用）
  tocHeadings: [],
  tocActive: '',
  tocTree: [],
  tocCollapsed: false,
};

/* ================================================================
   组件定义工厂（确保所有属性在创建时完整）
================================================================ */

/* ================================================================
   SkeletonItem 骨架屏
================================================================ */
function createSkeletonItem() {
  return {
    template: getTemplate('tpl-skeleton-item')
  };
}

/* ================================================================
   PostCard 文章卡片
================================================================ */
function createPostCard() {
  return {
    props: ['post'],
    computed: {
      cover() {
        const c = this.post.cover;
        return (c && /^https?:\/\//i.test(c)) ? c : '';
      },
      tagList() {
        return (this.post.tags || []).slice(0, 3);
      },
    },
    template: getTemplate('tpl-post-card')
  };
}

/* ================================================================
   HomeView 首页
================================================================ */
function createHomeView() {
  return {
    components: { 'skeleton-item': createSkeletonItem(), 'post-card': createPostCard() },
    setup() {
      const loading = ref(true);
      const posts = computed(() => window.BLOG_DATA?.posts || []);
      onMounted(() => {
        setTimeout(() => loading.value = false, 300);
      });
      return { loading, posts };
    },
    template: getTemplate('tpl-home-view')
  };
}

/* ================================================================
   ArchiveView 归档
================================================================ */
function createArchiveView() {
  return {
    setup() {
      const posts = computed(() => window.BLOG_DATA?.posts || []);
      const yearsMap = computed(() => {
        const map = {};
        posts.value.forEach(p => {
          const d = new Date(p.date);
          const y = d.getFullYear().toString();
          const m = d.getMonth();
          if (!map[y]) map[y] = {};
          if (!map[y][m]) map[y][m] = [];
          map[y][m].push(p);
        });
        const sorted = {};
        Object.keys(map).sort((a, b) => b - a).forEach(y => sorted[y] = map[y]);
        return sorted;
      });
      return { posts, yearsMap, MONTHS };
    },
    template: getTemplate('tpl-archive-view')
  };
}

/* ================================================================
   TagsView 标签总览
================================================================ */
function createTagsView() {
  return {
    setup() {
      const posts = computed(() => window.BLOG_DATA?.posts || []);
      const tags = computed(() => {
        const map = {};
        posts.value.forEach(p => (p.tags || []).forEach(t => map[t] = (map[t] || 0) + 1));
        return Object.keys(map).sort((a, b) => map[b] - map[a]).map(name => ({ name, count: map[name] }));
      });
      return { tags };
    },
    template: getTemplate('tpl-tags-view')
  };
}

/* ================================================================
   TagView 标签文章列表
================================================================ */
function createTagView() {
  return {
    components: { 'post-card': createPostCard() },
    setup() {
      const tag = computed(() => G.route.params.tag || '');
      const posts = computed(() => window.BLOG_DATA?.posts || []);
      const filtered = computed(() => posts.value.filter(p => (p.tags || []).includes(tag.value)));
      return { tag, filtered };
    },
    template: getTemplate('tpl-tag-view')
  };
}

/* ================================================================
   CategoryView 分类文章列表
================================================================ */
function createCategoryView() {
  return {
    components: { 'post-card': createPostCard() },
    setup() {
      const cat = computed(() => G.route.params.cat || '');
      const posts = computed(() => window.BLOG_DATA?.posts || []);
      const filtered = computed(() => posts.value.filter(p => p.category === cat.value));
      return { cat, filtered };
    },
    template: getTemplate('tpl-category-view')
  };
}

/* ================================================================
   AboutView 关于页
================================================================ */
function createAboutView() {
  return {
    setup() {
      const blogger = computed(() => window.BLOG_DATA?.blogger || {});
      return { blogger };
    },
    template: getTemplate('tpl-about-view')
  };
}

/* ================================================================
   NotFoundView 404
================================================================ */
const NotFoundView = {
  template: getTemplate('tpl-not-found-view')
};

/* ================================================================
   AppHeader 导航栏
================================================================ */
const AppHeader = {
  emits: ['toggle-search'],
  setup() {
    const site = computed(() => window.BLOG_DATA?.site || {});
    const routeName = computed(() => G.route.name);
    const isDarkMode = ref(isDark());
    const catOpen = ref(false);
    const posts = computed(() => window.BLOG_DATA?.posts || []);
    const cats = computed(() => {
      const map = {};
      posts.value.forEach(p => { if (p.category) map[p.category] = (map[p.category] || 0) + 1; });
      return Object.keys(map).sort().map(name => ({ name, count: map[name] }));
    });

    function toggleTheme() {
      const dark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('theme', dark ? 'dark' : 'light');
      isDarkMode.value = dark;
      const light = document.getElementById('prism-light');
      const dark2 = document.getElementById('prism-dark');
      if (light && dark2) { light.disabled = dark; dark2.disabled = !dark; }
      // 控制深色背景层
      const darkBg = document.getElementById('dark-bg');
      if (darkBg) darkBg.classList.toggle('hidden', !dark);
    }

    onMounted(() => {
      const light = document.getElementById('prism-light');
      const dark2 = document.getElementById('prism-dark');
      if (light && dark2) { light.disabled = isDarkMode.value; dark2.disabled = !isDarkMode.value; }
      // 初始化深色背景层
      const darkBg = document.getElementById('dark-bg');
      if (darkBg) darkBg.classList.toggle('hidden', !isDarkMode.value);
      document.addEventListener('click', () => catOpen.value = false);
    });

    return { site, routeName, isDarkMode, catOpen, cats, toggleTheme };
  },
  template: getTemplate('tpl-app-header')
};

/* ================================================================
   AppSidebar 侧边栏
================================================================ */
const AppSidebar = {
  setup() {
    const blogger = computed(() => window.BLOG_DATA?.blogger || {});
    const tagsOpen = ref(true);
    const posts = computed(() => window.BLOG_DATA?.posts || []);
    const tagList = computed(() => {
      const map = {};
      posts.value.forEach(p => (p.tags || []).forEach(t => map[t] = (map[t] || 0) + 1));
      return Object.keys(map).sort((a, b) => map[b] - map[a]).map(name => ({ name, count: map[name] }));
    });

    function scrollTo(id) {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }

    return { blogger, tagsOpen, tagList, G, scrollTo };
  },
  template: getTemplate('tpl-app-sidebar')
};

/* ================================================================
   AppFooter 页脚
================================================================ */
const AppFooter = {
  setup() {
    const site = computed(() => window.BLOG_DATA?.site || {});
    const blogger = computed(() => window.BLOG_DATA?.blogger || {});
    return { site, blogger, year: new Date().getFullYear() };
  },
  template: getTemplate('tpl-app-footer')
};

/* ================================================================
   PostDetailView 文章详情页
================================================================ */
const PostDetailView = {
  setup() {
    const title = computed(() => window.BLOG_DATA?.noteTitle || '');
    const content = computed(() => window.BLOG_DATA?.content || '');
    const detail = computed(() => window.BLOG_DATA?.postDetail || null);
    const isFixed = computed(() => window.BLOG_DATA.isFixed || false);
    const contentEl = ref(null);
    const mobileTocOpen = ref(false);

    function scrollTo(id) {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }

    onMounted(() => {
      nextTick(() => {
        if (!contentEl.value) return;
        const headings = contentEl.value.querySelectorAll('h1, h2, h3, h4, h5');
        
        // 构建嵌套树结构
        const rawHeadings = [];
        headings.forEach((h, i) => {
          if (!h.id) h.id = 'heading-' + i;
          const level = parseInt(h.tagName.slice(1));
          rawHeadings.push({ id: h.id, text: h.textContent, level, children: [], active: false, collapsed: false });
        });
        
        // 更新 tocHeadings（扁平列表，用于 active 状态追踪）
        G.tocHeadings.splice(0);
        rawHeadings.forEach(h => G.tocHeadings.push(h));
        
        // 构建树
        const root = [];
        const stack = [{ level: 0, children: root }];
        rawHeadings.forEach(item => {
          while (stack.length > 1 && stack[stack.length - 1].level >= item.level) stack.pop();
          stack[stack.length - 1].children.push(item);
          stack.push(item);
        });
        
        // 顶级超过3个默认折叠
        G.tocCollapsed.value = root.length > 10;
        
        // 更新响应式数组
        G.tocTree.splice(0, G.tocTree.length, ...root);
        
        if (G.tocHeadings.length >= 2) {
          let lastHashId = '';
          let initDone = false; // 标志位：初始化期间跳过响应
          
          const observer = new IntersectionObserver(entries => {
            if (!initDone) return; // 初始化期间不响应
            entries.forEach(entry => {
              const heading = G.tocHeadings.find(x => x.id === entry.target.id);
              if (heading) heading.active = entry.isIntersecting;
              // 只在首个可见标题时更新 URL
              if (entry.isIntersecting && entry.target.id !== lastHashId) {
                lastHashId = entry.target.id;
                G.tocActive.value = entry.target.id;
                history.replaceState(null, '', '#' + entry.target.id);
              }
            });
          }, { rootMargin: '-80px 0px -70% 0px' });
          headings.forEach(h => observer.observe(h));

          // 初始化：根据 URL 哈希设置 active 状态
          const initHash = window.location.hash.slice(1);
          if (initHash) {
            const target = G.tocHeadings.find(x => x.id === initHash);
            if (target) {
              G.tocHeadings.forEach(h => h.active = false);
              target.active = true;
              G.tocActive.value = initHash;
            }
            // 等待页面滚动完成后再启用 IntersectionObserver
            setTimeout(() => { initDone = true; }, 500);
          } else {
            initDone = true;
          }
        }

        // Prism 语言别名映射（MIME类型 -> Prism支持的语言）
        const langMap = {
          'application-typescript': 'typescript',
          'application-javascript': 'javascript',
          'application-javascript-env-backend': 'javascript',
          'application-x-jsp': 'markup',
          'text/html': 'markup',
          'application/javascript': 'javascript',
          'text/typescript': 'typescript',
        };

        // 代码块增强
        contentEl.value.querySelectorAll('pre').forEach(pre => {
          const code = pre.querySelector('code');
          if (!code || pre.closest('.code-block')) return;
          const wrapper = document.createElement('div');
          wrapper.className = 'code-block';
          pre.parentNode.insertBefore(wrapper, pre);
          
          // 获取语言标识并映射
          const rawLang = (code.className.match(/language-([\w-]+)/) || [])[1] || '';
          const lang = langMap[rawLang] || rawLang || 'code';
          
          const header = document.createElement('div');
          header.className = 'code-header';
          header.innerHTML = '<span>' + escHtml(lang) + '</span><button class="copy-btn"><i class="fa-regular fa-copy" style="margin-right:0.25rem"></i>复制</button>';
          pre.classList.add('rounded-b-lg', 'rounded-t-none');
          wrapper.appendChild(header);
          wrapper.appendChild(pre);
          
          // 设置正确的语言类名
          code.className = 'language-' + lang;
          
          header.querySelector('.copy-btn').addEventListener('click', () => {
            navigator.clipboard.writeText(code.textContent).then(() => {
              header.querySelector('.copy-btn').innerHTML = '<i class="fa-solid fa-check" style="color:#22c55e;margin-right:0.25rem"></i><span style="color:#22c55e">已复制</span>';
              setTimeout(() => header.querySelector('.copy-btn').innerHTML = '<i class="fa-regular fa-copy" style="margin-right:0.25rem"></i>复制', 2000);
            });
          });
          
          // 调用 Prism 高亮
          window.Prism?.highlightElement(code);
        });

        // 图片灯箱
        contentEl.value.querySelectorAll('img').forEach(img => {
          if (img.closest('a')) return;
          img.style.cursor = 'zoom-in';
          img.addEventListener('click', e => {
            G.lightboxSrc.value = img.src;
            G.lightboxOpen.value = true;
            e.stopPropagation();
          });
        });

        // 外部链接新窗口打开
        contentEl.value.querySelectorAll('a[href]').forEach(a => {
          if (a.hostname !== window.location.hostname) {
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
          }
        });
      });
    });

    return { title, content, detail, isFixed, contentEl, mobileTocOpen, scrollTo, G };
  },
  template: getTemplate('tpl-post-detail-view')
};

/* ================================================================
   SearchModal 搜索弹窗
================================================================ */
const SearchModal = {
  setup() {
    const searchOpen = G.searchOpen;
    const q = ref('');
    const selected = ref(-1);
    const inputEl = ref(null);

    const results = computed(() => {
      const query = q.value.trim().toLowerCase();
      if (!query) return [];
      return (window.BLOG_DATA?.posts || []).filter(p =>
        p.title.toLowerCase().includes(query) ||
        (p.summary || '').toLowerCase().includes(query) ||
        (p.tags || []).some(t => t.toLowerCase().includes(query))
      );
    });

    function close() {
      searchOpen.value = false;
      q.value = '';
      selected.value = -1;
    }

    function onKey(e) {
      const items = results.value;
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); selected.value = Math.min(selected.value + 1, items.length - 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); selected.value = Math.max(selected.value - 1, 0); }
      else if (e.key === 'Enter' && selected.value >= 0) {
        e.preventDefault();
        const p = items[selected.value];
        if (p) window.location.href = './' + p.id;
        close();
      }
    }

    onMounted(() => {
      document.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          searchOpen.value = true;
          nextTick(() => inputEl.value?.focus());
        }
      });
    });

    return { searchOpen, q, results, selected, onKey, close, inputEl };
  },
  template: getTemplate('tpl-search-modal')
};

/* ================================================================
   BackToTop 回到顶部
================================================================ */
const BackToTop = {
  setup() {
    const visible = ref(false);
    function onScroll() { visible.value = window.scrollY > 300; }
    function scrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }
    onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }));
    return { visible, scrollTop };
  },
  template: getTemplate('tpl-back-to-top')
};

/* ================================================================
   Lightbox 图片灯箱
================================================================ */
const Lightbox = {
  setup() {
    const lightboxOpen = G.lightboxOpen;
    const lightboxSrc = G.lightboxSrc;
    function close() { lightboxOpen.value = false; lightboxSrc.value = ''; }
    onMounted(() => document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); }));
    return { lightboxOpen, lightboxSrc, close };
  },
  template: getTemplate('tpl-lightbox')
};

/* ================================================================
   AppRoot 主组件
================================================================ */
const AppRoot = {
  components: {
    'app-header': AppHeader,
    'app-sidebar': AppSidebar,
    'app-footer': AppFooter,
    'not-found-view': NotFoundView,
    'post-detail-view': PostDetailView,
    'search-modal': SearchModal,
    'back-to-top': BackToTop,
    'lightbox': Lightbox,
  },
  setup() {
    const progress = ref(0);
    const mainEl = ref(null);
    let viewApp = null;

    function getViewComponent(name) {
      if (G.isPostPage) return PostDetailView;
      const map = {
        home: createHomeView,
        archive: createArchiveView,
        tags: createTagsView,
        tag: createTagView,
        category: createCategoryView,
        about: createAboutView,
      };
      const factory = map[name];
      return factory ? factory() : NotFoundView;
    }

    function renderView() {
      if (!mainEl.value) return;
      const name = G.route.name;
      const comp = getViewComponent(name);
      
      // 销毁旧应用
      if (viewApp) {
        viewApp.unmount();
        viewApp = null;
      }
      
      // 创建新应用
      viewApp = createApp(comp);
      viewApp.mount(mainEl.value);
    }

    // 标题锚点（#heading-x）不参与路由
    function isAnchorHash(h) { return h.length > 1 && h.slice(0, 2) !== '#/'; }

    function updateTitle() {
      // 详情页/固定页的标题由服务端渲染（含文章名），不要覆盖
      if (G.isPostPage) return;
      const siteName = window.BLOG_DATA?.site?.name || '';
      const base = {
        home: '',
        archive: '归档',
        tags: '标签',
        tag: G.route.params.tag ? '标签：' + G.route.params.tag : '标签',
        category: G.route.params.cat ? '分类：' + G.route.params.cat : '分类',
        about: '关于',
        notfound: '404',
      }[G.route.name] || '';
      document.title = base ? (siteName ? base + ' - ' + siteName : base) : siteName;
    }

    function updateRoute() {
      const h = location.hash || '';
      // 标题锚点（#heading-x）不参与路由，也不触发回顶部
      if (!isAnchorHash(h)) {
        if (!h || h === '#/' || h === '#') { G.route.name = 'home'; G.route.params = {}; }
        else if (h === '#/archive') { G.route.name = 'archive'; G.route.params = {}; }
        else if (h === '#/tags') { G.route.name = 'tags'; G.route.params = {}; }
        else if (h === '#/about') { G.route.name = 'about'; G.route.params = {}; }
        else {
          const tagMatch = h.match(/^#\/tag\/(.+)$/);
          if (tagMatch) { G.route.name = 'tag'; G.route.params = { tag: decodeURIComponent(tagMatch[1]) }; }
          else {
            const catMatch = h.match(/^#\/category\/(.+)$/);
            if (catMatch) { G.route.name = 'category'; G.route.params = { cat: decodeURIComponent(catMatch[1]) }; }
            else { G.route.name = 'notfound'; G.route.params = {}; }
          }
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      updateTitle();
    }

    function updateProgress() {
      const scrollTop = window.scrollY;
      const docH = document.documentElement.scrollHeight - window.innerHeight;
      progress.value = docH > 0 ? Math.min(100, (scrollTop / docH) * 100) : 0;
    }

    onMounted(() => {
      updateRoute();
      // 初始渲染
      nextTick(() => {
        renderView();
        // URL 带标题锚点时滚动到对应标题（不覆盖服务端已渲染的标题）
        const initHash = window.location.hash || '';
        if (isAnchorHash(initHash)) {
          nextTick(() => {
            const el = document.getElementById(initHash.slice(1));
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          });
        }
      });

      window.addEventListener('hashchange', () => {
        const h = location.hash || '';
        if (isAnchorHash(h)) return; // 标题锚点变化不触发路由切换
        updateRoute();
        renderView();
      });
      window.addEventListener('scroll', updateProgress, { passive: true });
    });

    return { G, progress, mainEl };
  },
};

/* ================================================================
   启动
================================================================ */

// Vue 3 x-template: 从 <template id="xxx"> 读取 innerHTML
function getTemplate(id) {
  const el = document.getElementById(id);
  if (!el) {
    console.error('Template not found:', id);
    return '<div style="color:red">Template missing: ' + id + '</div>';
  }
  return el.innerHTML || '<div style="color:red">Template empty: ' + id + '</div>';
}

// AppRoot 模板在 getTemplate 就绪后赋值
AppRoot.template = getTemplate('tpl-app-root');

function boot() {
  const VueAPI = window.Vue;
  if (!VueAPI) {
    console.error('[theme] Vue 未加载，页面内容无法渲染（检查 CDN 或 ~shareJs 兜底）');
    return;
  }
  ref = VueAPI.ref;
  reactive = VueAPI.reactive;
  computed = VueAPI.computed;
  watch = VueAPI.watch;
  onMounted = VueAPI.onMounted;
  nextTick = VueAPI.nextTick;
  createApp = VueAPI.createApp;

  // G 相关属性需要在 Vue 加载后转为响应式
  G.tocHeadings = reactive([]);
  G.tocTree = reactive([]);
  G.route = reactive(G.route);
  G.searchOpen = ref(false);
  G.lightboxSrc = ref('');
  G.lightboxOpen = ref(false);
  G.tocActive = ref('');
  // tocCollapsed 和 tocTree 用 reactive 确保深度追踪
  G.tocCollapsed = reactive({ value: false });
  G.tocTree = reactive([]);

  const app = createApp(AppRoot);
  app.mount('#app');
}

// 同步/异步加载都能初始化（脚本位置或注入方式变化时也不用改这里）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
