/* ============================================================
   Flazz Agent UI — shared shell, shortcuts, command palette
   ============================================================ */
(function () {
  'use strict';

  var API_BASE = (window.FLAZZ_API_BASE || '').replace(/\/$/, '');
  var BOT_URL = window.FLAZZ_BOT_URL || 'https://t.me/ragteleshofiyanbot';
  var THEME_KEY = 'flazz-agent-theme';
  var PAGE = document.body.getAttribute('data-page') || 'chat';

  var state = {
    initialized: false,
    page: PAGE,
    actions: [],
    shortcuts: [],
    filteredActions: [],
    paletteIndex: 0,
    gPending: false,
    gTimer: null,
    theme: 'dark'
  };

  var ICONS = {
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    box: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    case: '<rect x="5" y="2.5" width="14" height="19" rx="3"/><circle cx="12" cy="8.5" r="2"/><path d="M9.5 15.5h5"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18.5h2"/>',
    palette: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    layers: '<path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"/><path d="m4 12 8 4.5 8-4.5"/><path d="m4 16.5 8 4.5 8-4.5"/>',
    chart: '<path d="M4 20V11M10 20V5M16 20v-6M22 20H2"/>',
    wand: '<path d="m15 4 5 5"/><path d="M4 20 18 6l-1.5-1.5L3 18.5 4 20Z"/><path d="M6 3v3M4.5 4.5h3M19 16v3M17.5 17.5h3"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>',
    flask: '<path d="M9 3h6"/><path d="M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/><path d="M7.5 15h9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    command: '<path d="M9 9h6v6H9z"/><path d="M9 9H7a2 2 0 1 1 2-2v2Zm6 0h2a2 2 0 1 0-2-2v2ZM9 15H7a2 2 0 1 0 2 2v-2Zm6 0h2a2 2 0 1 1-2 2v-2Z"/>',
    keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M19 10h.01M7 14h10"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M3 21v-5h5M21 3v5h-5"/>',
    spark: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M5 19v2M19 3V1"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    check: '<path d="m20 6-11 11-5-5"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
    arrowUp: '<path d="m18 15-6-6-6 6"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'
  };

  function icon(name, size) {
    var paths = ICONS[name] || ICONS.spark;
    var px = size || 17;
    return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('id-ID').format(Number(value) || 0);
  }

  function apiUrl(path) {
    return API_BASE + path;
  }

  function setTextAll(selector, value) {
    document.querySelectorAll(selector).forEach(function (node) {
      node.textContent = value;
    });
  }

  function loadStats() {
    fetch(apiUrl('/api/stats'), { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        setTextAll('[data-stat-models]', formatNumber(data.totalStockModels));
        setTextAll('[data-stat-units]', formatNumber(data.totalStockUnits));
        setTextAll('[data-stat-products]', formatNumber(data.totalProducts));
        setTextAll('[data-stat-docs]', formatNumber(data.totalRagDocuments));
        window.dispatchEvent(new CustomEvent('flazz:stats', { detail: data }));
      })
      .catch(function () {
        // Statistik hanya pelengkap; biarkan nilai awal tetap tampil.
      });
  }

  function applyTheme(theme, persist) {
    state.theme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    if (persist) {
      try { localStorage.setItem(THEME_KEY, state.theme); } catch (error) { /* private mode */ }
    }
    var label = state.theme === 'dark' ? 'Dark' : 'Light';
    var nextIcon = state.theme === 'dark' ? 'sun' : 'moon';
    document.querySelectorAll('[data-theme-label]').forEach(function (node) {
      node.textContent = label;
    });
    document.querySelectorAll('[data-theme-icon]').forEach(function (node) {
      node.innerHTML = icon(nextIcon, 16);
    });
    document.querySelectorAll('[data-theme-toggle]').forEach(function (node) {
      node.setAttribute('aria-label', state.theme === 'dark' ? 'Aktifkan tema terang' : 'Aktifkan tema gelap');
      node.setAttribute('title', state.theme === 'dark' ? 'Tema terang (T)' : 'Tema gelap (T)');
    });
  }

  function initTheme() {
    var theme = 'dark';
    try {
      theme = localStorage.getItem(THEME_KEY) || document.documentElement.getAttribute('data-theme') || 'dark';
    } catch (error) { /* private mode */ }
    applyTheme(theme, false);
  }

  function toggleTheme() {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark', true);
    toast(state.theme === 'dark' ? 'Tema gelap aktif.' : 'Tema terang aktif.', 'success');
  }

  function toggleSidebar() {
    document.body.classList.toggle('sidebar-open');
  }

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
  }

  function renderSidebar() {
    var mount = document.getElementById('appSidebar');
    if (!mount) return;

    var nav = [
      { id: 'chat', href: '/', label: 'Chat', sub: 'Tanya stok & katalog', icon: 'chat' },
      { id: 'monitor', href: '/monitor', label: 'Monitoring Stok', sub: 'Input & audit stok', icon: 'box' },
      { id: 'prompts', href: 'https://rag-tele.vercel.app/', label: 'Prompt Lab', sub: 'Lima prompt Tahap 1', icon: 'flask' }
    ];

    var navHtml = nav.map(function (item) {
      var active = state.page === item.id ? ' active' : '';
      var current = state.page === item.id ? ' aria-current="page"' : '';
      return '<a class="nav-item' + active + '" href="' + item.href + '"' + current + '>' +
        '<span class="nav-icon">' + icon(item.icon, 15) + '</span>' +
        '<span>' + item.label + '</span>' +
        '</a>';
    }).join('');

    mount.innerHTML =
      '<div class="sidebar-brand">' +
        '<div class="brand-mark" aria-hidden="true">' + icon('case', 20) + '</div>' +
        '<div class="brand-text"><strong>Flazzstore</strong><span>RAG Workspace</span></div>' +
        '<button class="icon-btn sidebar-close mobile-only" type="button" data-sidebar-toggle aria-label="Tutup menu">' + icon('close', 16) + '</button>' +
      '</div>' +
      '<button class="btn btn-primary btn-new" type="button" data-new-chat>' + icon('plus', 15) + '<span>Chat baru</span><kbd>N</kbd></button>' +
      '<nav class="sidebar-nav" aria-label="Navigasi utama">' +
        '<div class="sidebar-label">Workspace</div>' +
        navHtml +
        '<div class="sidebar-label">Data live</div>' +
        '<div class="sidebar-card" aria-label="Ringkasan data live">' +
          '<div class="mini-stat"><span>Tipe iPhone</span><b data-stat-models>—</b></div>' +
          '<div class="mini-stat"><span>Total unit</span><b data-stat-units>—</b></div>' +
          '<div class="mini-stat"><span>Katalog</span><b data-stat-products>—</b></div>' +
          '<div class="mini-stat"><span>Dokumen RAG</span><b data-stat-docs>—</b></div>' +
        '</div>' +
        '<div class="sidebar-label">Tools</div>' +
        '<button class="nav-item" type="button" data-command-toggle>' + icon('command', 15) + '<span>Command palette</span><kbd>⌘K</kbd></button>' +
        '<button class="nav-item" type="button" data-shortcuts-toggle>' + icon('keyboard', 15) + '<span>Keyboard shortcut</span><kbd>?</kbd></button>' +
        '<button class="nav-item" type="button" data-theme-toggle>' +
          '<span class="nav-icon" data-theme-icon>' + icon('sun', 15) + '</span>' +
          '<span>Tema</span><span class="nav-meta" data-theme-label>Dark</span>' +
        '</button>' +
      '</nav>' +
      '<div class="sidebar-footer">' +
        '<a class="sidebar-link" id="sidebarBotLink" href="' + escapeHtml(BOT_URL) + '" target="_blank" rel="noopener noreferrer">' + icon('external', 14) + '<span>Telegram bot</span></a>' +
        '<div class="sidebar-status"><span class="status-dot"></span><span>Cloudflare Edge</span></div>' +
      '</div>';

    var botLink = document.getElementById('sidebarBotLink');
    if (botLink) botLink.href = BOT_URL;
  }

  function injectChrome() {
    if (!document.getElementById('commandPalette')) {
      var palette = document.createElement('dialog');
      palette.id = 'commandPalette';
      palette.className = 'palette-dialog';
      palette.setAttribute('aria-label', 'Command palette');
      palette.innerHTML =
        '<div class="palette-search">' + icon('search', 17) +
          '<input id="paletteInput" type="text" placeholder="Cari aksi, halaman, atau perintah…" autocomplete="off" spellcheck="false" aria-label="Cari aksi">' +
          '<kbd>Esc</kbd>' +
        '</div>' +
        '<div class="palette-list" id="paletteList" role="listbox"></div>' +
        '<div class="palette-footer"><span><kbd>↑</kbd> <kbd>↓</kbd> pilih</span><span><kbd>↵</kbd> jalankan</span></div>';
      document.body.appendChild(palette);
    }

    if (!document.getElementById('shortcutsDialog')) {
      var shortcuts = document.createElement('dialog');
      shortcuts.id = 'shortcutsDialog';
      shortcuts.className = 'shortcuts-dialog';
      shortcuts.setAttribute('aria-label', 'Keyboard shortcut');
      shortcuts.innerHTML =
        '<div class="shortcuts-head"><h3>Keyboard shortcut</h3><button class="icon-btn" type="button" data-shortcuts-close aria-label="Tutup">' + icon('close', 15) + '</button></div>' +
        '<div class="shortcuts-list" id="shortcutsList"></div>';
      document.body.appendChild(shortcuts);
    }

    if (!document.getElementById('toastStack')) {
      var stack = document.createElement('div');
      stack.id = 'toastStack';
      stack.className = 'toast-stack';
      stack.setAttribute('aria-live', 'polite');
      stack.setAttribute('aria-atomic', 'true');
      document.body.appendChild(stack);
    }
  }

  function allActions() {
    return [
      { id: 'nav-chat', label: 'Buka Chat', description: 'RAG assistant & stok', hint: 'G C', icon: 'chat', keywords: 'chat home assistant', run: function () { go('/'); } },
      { id: 'nav-monitor', label: 'Buka Monitoring Stok', description: 'Input dan audit stok', hint: 'G M', icon: 'box', keywords: 'monitor stok gudang inventory', run: function () { go('/monitor'); } },
      { id: 'nav-prompts', label: 'Buka Prompt Lab', description: 'Lima prompt Tahap 1', hint: 'G P', icon: 'flask', keywords: 'prompt lab evaluasi', run: function () { window.open('https://rag-tele.vercel.app/', '_blank', 'noopener'); } },
      { id: 'new-chat', label: 'Chat baru', description: 'Mulai percakapan bersih', hint: 'N', icon: 'plus', keywords: 'new chat bersih', run: newChat },
      { id: 'toggle-theme', label: 'Ganti tema', description: 'Terang / gelap', hint: 'T', icon: 'sun', keywords: 'theme tema dark light', run: toggleTheme },
      { id: 'shortcuts', label: 'Keyboard shortcut', description: 'Lihat semua pintasan', hint: '?', icon: 'keyboard', keywords: 'shortcut keyboard bantuan', run: openShortcuts },
      { id: 'telegram', label: 'Buka Telegram bot', description: 'Chat lewat Telegram', hint: '', icon: 'external', keywords: 'telegram bot', run: function () { window.open(BOT_URL, '_blank', 'noopener'); } }
    ].concat(state.actions);
  }

  function renderPalette(query) {
    var list = document.getElementById('paletteList');
    if (!list) return;
    var normalized = String(query || '').trim().toLowerCase();
    state.filteredActions = allActions().filter(function (action) {
      if (!normalized) return true;
      return (action.label + ' ' + (action.description || '') + ' ' + (action.keywords || '')).toLowerCase().indexOf(normalized) !== -1;
    });
    state.paletteIndex = 0;

    if (!state.filteredActions.length) {
      list.innerHTML = '<div class="palette-empty">Tidak ada aksi yang cocok.</div>';
      return;
    }

    list.innerHTML = state.filteredActions.map(function (action, index) {
      return '<button class="palette-item' + (index === 0 ? ' is-active' : '') + '" type="button" role="option" aria-selected="' + (index === 0 ? 'true' : 'false') + '" data-palette-index="' + index + '">' +
        '<span class="palette-icon">' + icon(action.icon || 'spark', 14) + '</span>' +
        '<span class="palette-text"><strong>' + escapeHtml(action.label) + '</strong>' +
          (action.description ? '<small>' + escapeHtml(action.description) + '</small>' : '') +
        '</span>' +
        (action.hint ? '<kbd>' + escapeHtml(action.hint) + '</kbd>' : '') +
      '</button>';
    }).join('');
  }

  function setPaletteActive(index) {
    var items = document.querySelectorAll('#paletteList [data-palette-index]');
    if (!items.length) return;
    state.paletteIndex = (index + items.length) % items.length;
    items.forEach(function (item, itemIndex) {
      var active = itemIndex === state.paletteIndex;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active && item.scrollIntoView) item.scrollIntoView({ block: 'nearest' });
    });
  }

  function openPalette() {
    var dialog = document.getElementById('commandPalette');
    if (!dialog) return;
    if (!dialog.open) {
      renderPalette('');
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    var input = document.getElementById('paletteInput');
    if (input) {
      input.value = '';
      setTimeout(function () { input.focus(); }, 20);
    }
  }

  function closePalette() {
    var dialog = document.getElementById('commandPalette');
    if (dialog && dialog.open) dialog.close();
  }

  function runPaletteAction(index) {
    var action = state.filteredActions[index];
    if (!action) return;
    closePalette();
    setTimeout(function () { action.run(); }, 10);
  }

  function globalShortcutRows() {
    return [
      { keys: ['⌘', 'K'], label: 'Command palette' },
      { keys: ['/'], label: 'Fokus input / pencarian' },
      { keys: ['T'], label: 'Ganti tema terang/gelap' },
      { keys: ['G', 'C'], label: 'Buka Chat' },
      { keys: ['G', 'M'], label: 'Buka Monitoring Stok' },
      { keys: ['G', 'P'], label: 'Buka Prompt Lab' },
      { keys: ['?'], label: 'Daftar shortcut' },
      { keys: ['Esc'], label: 'Tutup dialog / menu' }
    ];
  }

  function openShortcuts() {
    var dialog = document.getElementById('shortcutsDialog');
    var list = document.getElementById('shortcutsList');
    if (!dialog || !list) return;
    var rows = globalShortcutRows().concat(state.shortcuts.map(function (shortcut) {
      return { keys: shortcut.keys || [shortcut.key.toUpperCase()], label: shortcut.label };
    }));
    list.innerHTML = rows.map(function (row) {
      return '<div class="shortcut-row"><span>' + escapeHtml(row.label) + '</span><span class="shortcut-keys">' +
        row.keys.map(function (key) { return '<kbd>' + escapeHtml(key) + '</kbd>'; }).join('') +
        '</span></div>';
    }).join('');
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
  }

  function closeShortcuts() {
    var dialog = document.getElementById('shortcutsDialog');
    if (dialog && dialog.open) dialog.close();
  }

  function toast(message, kind) {
    var stack = document.getElementById('toastStack');
    if (!stack) return;
    var node = document.createElement('div');
    node.className = 'toast ' + (kind || '');
    node.setAttribute('role', 'status');
    node.innerHTML = icon(kind === 'error' ? 'alert' : 'check', 14) + '<span>' + escapeHtml(message) + '</span>';
    stack.appendChild(node);
    requestAnimationFrame(function () { node.classList.add('show'); });
    setTimeout(function () {
      node.classList.remove('show');
      setTimeout(function () { node.remove(); }, 220);
    }, 3400);
  }

  function copyText(text) {
    var value = String(text == null ? '' : text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(function () {
        toast('Tersalin ke clipboard.', 'success');
        return true;
      }).catch(function () {
        return fallbackCopy(value);
      });
    }
    return Promise.resolve(fallbackCopy(value));
  }

  function fallbackCopy(value) {
    try {
      var area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      toast('Tersalin ke clipboard.', 'success');
      return true;
    } catch (error) {
      toast('Clipboard tidak tersedia.', 'error');
      return false;
    }
  }

  function go(path) {
    window.location.href = path;
  }

  function newChat() {
    if (state.page === 'chat') {
      window.dispatchEvent(new CustomEvent('flazz:new-chat'));
    } else {
      window.location.href = '/?new=1';
    }
  }

  function registerActions(actions) {
    if (Array.isArray(actions)) state.actions = state.actions.concat(actions);
  }

  function registerShortcut(shortcut) {
    if (!shortcut || !shortcut.key) return;
    state.shortcuts.push({
      key: String(shortcut.key).toLowerCase(),
      keys: shortcut.keys || [String(shortcut.key).toUpperCase()],
      label: shortcut.label || shortcut.key,
      run: shortcut.run
    });
  }

  function registerShortcuts(list) {
    if (Array.isArray(list)) list.forEach(registerShortcut);
  }

  function isTyping(element) {
    if (!element) return false;
    var tag = element.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
  }

  function handleKeydown(event) {
    var typing = isTyping(document.activeElement);
    var mod = event.metaKey || event.ctrlKey;

    if (mod && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette();
      return;
    }

    if (event.key === 'Escape') {
      var palette = document.getElementById('commandPalette');
      var shortcuts = document.getElementById('shortcutsDialog');
      if (palette && palette.open) {
        event.preventDefault();
        closePalette();
        return;
      }
      if (shortcuts && shortcuts.open) {
        event.preventDefault();
        closeShortcuts();
        return;
      }
      closeSidebar();
      return;
    }

    if (typing) return;

    if (event.key === '?') {
      event.preventDefault();
      openShortcuts();
      return;
    }

    if (!mod && !event.altKey && event.key.toLowerCase() === 't') {
      event.preventDefault();
      toggleTheme();
      return;
    }

    if (!mod && !event.altKey && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      state.gPending = true;
      clearTimeout(state.gTimer);
      state.gTimer = setTimeout(function () { state.gPending = false; }, 1300);
      return;
    }

    if (state.gPending) {
      var navKey = event.key.toLowerCase();
      state.gPending = false;
      clearTimeout(state.gTimer);
      if (navKey === 'c') { event.preventDefault(); go('/'); return; }
      if (navKey === 'm') { event.preventDefault(); go('/monitor'); return; }
      if (navKey === 'p') { event.preventDefault(); window.open('https://rag-tele.vercel.app/', '_blank', 'noopener'); return; }
      return;
    }

    if (mod || event.altKey) return;

    var key = event.key.toLowerCase();
    var shortcut = state.shortcuts.find(function (item) { return item.key === key; });
    if (shortcut) {
      event.preventDefault();
      shortcut.run();
    }
  }

  function bindEvents() {
    document.addEventListener('click', function (event) {
      var target = event.target;

      if (target.closest('[data-command-toggle]')) {
        event.preventDefault();
        openPalette();
        return;
      }
      if (target.closest('[data-shortcuts-toggle]')) {
        event.preventDefault();
        openShortcuts();
        return;
      }
      if (target.closest('[data-shortcuts-close]')) {
        event.preventDefault();
        closeShortcuts();
        return;
      }
      if (target.closest('[data-theme-toggle]')) {
        event.preventDefault();
        toggleTheme();
        return;
      }
      if (target.closest('[data-new-chat]')) {
        event.preventDefault();
        newChat();
        return;
      }
      if (target.closest('[data-sidebar-toggle]')) {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (target.closest('#sidebarScrim')) {
        closeSidebar();
        return;
      }
      var paletteItem = target.closest('[data-palette-index]');
      if (paletteItem) {
        event.preventDefault();
        runPaletteAction(Number(paletteItem.getAttribute('data-palette-index')));
      }
    });

    document.addEventListener('keydown', handleKeydown);

    var input = document.getElementById('paletteInput');
    if (input) {
      input.addEventListener('input', function () { renderPalette(input.value); });
      input.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setPaletteActive(state.paletteIndex + 1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          setPaletteActive(state.paletteIndex - 1);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          runPaletteAction(state.paletteIndex);
        }
      });
    }

    window.addEventListener('resize', function () {
      if (window.innerWidth > 960) closeSidebar();
    });
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    renderSidebar();
    injectChrome();
    bindEvents();
    initTheme();
    loadStats();
  }

  window.FlazzUI = {
    apiBase: API_BASE,
    apiUrl: apiUrl,
    botUrl: BOT_URL,
    page: PAGE,
    escapeHtml: escapeHtml,
    formatNumber: formatNumber,
    toast: toast,
    copyText: copyText,
    registerActions: registerActions,
    registerShortcut: registerShortcut,
    registerShortcuts: registerShortcuts,
    openPalette: openPalette,
    openShortcuts: openShortcuts,
    toggleTheme: toggleTheme,
    navigate: go,
    newChat: newChat,
    loadStats: loadStats,
    icon: icon
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
