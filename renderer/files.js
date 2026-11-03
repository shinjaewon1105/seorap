/* ══════════════════════════════════════════════════════════════════
   파일 — 이 앱의 모든 것을 한 자리에서 정리한다.
   폴더 안에 마감·필기·링크·첨부파일이 나란히 들어간다.
   쓰는 법은 윈도우 파일 탐색기와 같게 맞췄다 — 두 번 눌러 열기, 주소 줄,
   머리글 정렬, 여러 개 고르기, 끌어 옮기기, 오른쪽 단추 차림표,
   잘라내기/복사/붙여넣기, F2, Delete.

   폴더는 앱 안에서만 있는 것이고, 디스크의 파일은 어디로도 움직이지 않는다.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const leafOf = (p) => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p);
  const fmtSize = (n) => Tree.fmtSize(n);
  const clean = (p) => Store.util.cleanFolder(p);

  let el = {};
  let cwd = '';
  let sel = new Set();
  let anchor = null;
  let view = 'list';
  let sort = { key: 'name', dir: 1 };
  let query = '';
  let clip = null;                    // { mode: 'copy'|'cut', keys: [] }
  const collapsed = new Set();

  const KIND_ORDER = { folder: 0, deadline: 1, note: 2, link: 3, file: 4 };
  const KIND_NAME = { folder: '폴더', deadline: '마감', note: '필기', link: '링크' };

  const Files = {
    init() {
      el = {
        screen: $('#filesView'), tree: $('#fxTree'), body: $('#fxBody'),
        path: $('#fxPath'), up: $('#fxUp'), search: $('#fxSearch'),
        back: $('#fxBack'), fwd: $('#fxFwd'),
        status: $('#fxStatus'), viewBtn: $('#fxView'), sortBtn: $('#fxSort'),
        cut: $('#fxCut'), copy: $('#fxCopy'), paste: $('#fxPaste'),
        renameBtn: $('#fxRename'), del: $('#fxDelete'),
        newBtn: $('#fxNew'), importBtn: $('#fxImport'), organize: $('#fxOrganize'),
        wishRow: $('#fxWishRow'), wish: $('#fxWish'), go: $('#fxGo'), wishCancel: $('#fxWishCancel'),
      };

      view = Store.settings.filesView === 'icons' ? 'icons' : 'list';
      if (Store.settings.filesSort) sort = Object.assign({}, sort, Store.settings.filesSort);

      el.up.addEventListener('click', () => goTo(parentOf(cwd)));
      el.back.addEventListener('click', () => Nav.back());
      el.fwd.addEventListener('click', () => Nav.forward());
      el.viewBtn.addEventListener('click', () => {
        view = view === 'list' ? 'icons' : 'list';
        Store.saveSettings({ filesView: view });
        render();
      });

      // 탐색기의 명령 줄 — 차림표를 열지 않고 바로 누른다
      el.cut.addEventListener('click', () => doCopy('cut'));
      el.copy.addEventListener('click', () => doCopy('copy'));
      el.paste.addEventListener('click', () => doPaste());
      el.renameBtn.addEventListener('click', () => {
        const p = picked();
        if (p.length === 1) rename(p[0]);
      });
      el.del.addEventListener('click', () => removeSelected());
      el.sortBtn.addEventListener('click', () => menu(anchorPoint(el.sortBtn), sortMenu()));
      el.search.addEventListener('input', () => { query = el.search.value.trim(); renderBody(); });
      el.search.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); el.search.value = ''; query = ''; renderBody(); }
      });
      el.newBtn.addEventListener('click', (e) => menu(anchorPoint(el.newBtn), newMenu()));
      el.importBtn.addEventListener('click', importFromDisk);
      // 브라우저는 원본 자리를 가리킬 수 없어 내용을 올린다
      if (global.IS_WEB) el.importBtn.textContent = '파일 올리기';

      el.organize.addEventListener('click', () => {
        if (Store.allAttachments().length < 2) { App.toast('나눌 파일이 두 개는 있어야 합니다.'); return; }
        el.wishRow.hidden = false;
        el.wish.value = '';
        el.wish.focus();
      });
      el.wishCancel.addEventListener('click', () => { el.wishRow.hidden = true; });
      el.go.addEventListener('click', () => { el.wishRow.hidden = true; organizeAll(el.wish.value.trim()); });
      el.wish.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el.go.click(); }
        else if (e.key === 'Escape') { e.stopPropagation(); el.wishRow.hidden = true; }
      });

      el.body.addEventListener('mousedown', (e) => {
        if (e.target.closest('.fx-item') || e.target.closest('.fx-head')) return;
        if (e.button === 0) { sel.clear(); paintSelection(); }
      });
      el.body.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.fx-item')) return;
        e.preventDefault();
        sel.clear();
        paintSelection();
        menu(e, emptyMenu());
      });

      // 컴퓨터에서 끌어다 놓기 + 앱 안에서 폴더 사이 옮기기
      el.body.addEventListener('dragover', (e) => {
        if (e.target.closest('.fx-item.folder')) return;
        if (!dragKind(e)) return;
        e.preventDefault();
        el.body.classList.add('drop-hot');
      });
      el.body.addEventListener('dragleave', (e) => {
        if (e.target === el.body) el.body.classList.remove('drop-hot');
      });
      el.body.addEventListener('drop', (e) => {
        el.body.classList.remove('drop-hot');
        if (e.target.closest('.fx-item.folder')) return;
        onDrop(e, cwd);
      });

      // 주소 줄의 빈 자리 = 지금 폴더 (마디 단추는 저마다 제 폴더로 받는다)
      dropTarget(el.path, null);

      longPress(el.body, (pt) => {
        sel.clear();
        paintSelection();
        menu(pt, emptyMenu());
      });

      document.addEventListener('keydown', onKey);

      Nav.register('files', {
        el: el.screen,
        title: (r) => (r.sub ? leafOf(r.sub) : '파일'),
        show: (r) => {
          const next = clean(r.sub || '');
          if (next !== cwd) { sel.clear(); anchor = null; query = ''; }
          cwd = next;
          render();
        },
      });
    },

    render,
    refresh: render,

    /* 받을 자리가 없는 곳(달력, 알림 위 등)에 컴퓨터 파일을 놓았을 때 app.js 가 부른다.
       folder 가 없으면 파일 화면의 지금 폴더. 다른 화면에서 왔으면 어디 들어갔는지 짚어 준다. */
    dropOS(e, folder) {
      const here = Nav.current && Nav.current.v === 'files';
      onDrop(e, folder == null ? cwd : folder, !here);
    },

    // 다른 화면에서 이 파일이 든 폴더를 열고 짚어 준다
    reveal(key, folder) {
      query = '';
      Nav.go({ v: 'files', sub: folder || '' });
      sel = new Set([key]);
      anchor = key;
      paintSelection();
      const node = el.body.querySelector('.fx-item[data-key="' + CSS.escape(key) + '"]');
      if (node) node.scrollIntoView({ block: 'center' });
    },

    revealAttachment(attId) {
      const it = Store.findAttachment(attId);
      if (it) this.reveal('a:' + attId, it.att.folder || '');
    },
  };

  // ────────────────────────────── 자료 ──────────────────────────────

  function allFolders() {
    const set = new Set();
    const add = (p) => {
      if (!p) return;
      const parts = p.split('/');
      for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'));
    };
    for (const f of Store.folders) add(f);
    for (const it of Store.allAttachments()) add(it.att.folder);
    for (const e of Store.events) add(e.folder);
    for (const n of Store.notes) add(n.folder);
    for (const l of Store.links) if (!l.owner) add(l.folder);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
  }

  function childFolders(path) {
    return allFolders().filter((p) => parentOf(p) === path);
  }

  const inFolder = (f, path) => (f || '') === path;
  const underFolder = (f, path) => {
    const x = f || '';
    return !path || x === path || x.indexOf(path + '/') === 0;
  };

  // 폴더 하나에 들어 있는 것 전부를 같은 모양으로 만든다.
  function itemsIn(path, deep) {
    const keep = (f) => (deep ? underFolder(f, path) : inFolder(f, path));
    const out = [];

    for (const e of Store.events) {
      if (!keep(e.folder)) continue;
      const left = Math.round((Recur.fromISO(e.date) - Recur.fromISO(Recur.todayISO())) / 86400000);
      out.push({
        key: 'e:' + e.id, kind: 'deadline', name: e.title || '제목 없음',
        sub: Store.isDeadline(e) ? dday(left, Store.isDone(e, e.date)) : '일정',
        size: 0, when: Date.parse(e.updatedAt || e.createdAt || '') || 0,
        date: e.date, data: e, done: Store.isDone(e, e.date),
      });
    }
    for (const n of Store.notes) {
      if (!keep(n.folder)) continue;
      const s = MD.taskStats(n.body || '');
      out.push({
        key: 'n:' + n.id, kind: 'note', name: n.title.trim() || firstLine(n.body) || '빈 필기',
        sub: s.total ? s.done + '/' + s.total : '', size: (n.body || '').length,
        when: Date.parse(n.updatedAt || n.createdAt || '') || 0, data: n,
      });
    }
    for (const l of Store.links) {
      if (l.owner || !keep(l.folder)) continue;
      out.push({
        key: 'l:' + l.id, kind: 'link', name: Store.util.linkLabel(l),
        sub: Store.util.linkHost(l), size: 0,
        when: Date.parse(l.updatedAt || l.createdAt || '') || 0, data: l,
      });
    }
    for (const x of Store.allAttachments()) {
      if (!keep(x.att.folder)) continue;
      out.push({
        key: 'a:' + x.att.id, kind: 'file', name: x.att.name,
        sub: x.ev ? (x.ev.title || '제목 없음') : '', size: x.att.size || 0,
        when: x.att.mtimeMs || Date.parse(x.att.addedAt || '') || 0,
        data: x.att, ev: x.ev, done: !!x.att.done,
      });
    }
    return out;
  }

  function countUnder(path) { return itemsIn(path, true).length; }

  function dday(left, done) {
    if (done) return '끝냄';
    if (left === 0) return 'D-DAY';
    if (left < 0) return '+' + (-left) + '일';
    return 'D-' + left;
  }

  function firstLine(body) {
    const s = MD.plain(body || '').trim();
    return s ? s.split('\n')[0].slice(0, 40) : '';
  }

  function kindLabel(it) {
    if (it.kind === 'file') {
      const ext = String(it.name).split('.').pop();
      return ext && ext !== it.name ? ext.toUpperCase() : '파일';
    }
    return KIND_NAME[it.kind] || '';
  }

  function goTo(path) { Nav.go({ v: 'files', sub: path || '' }); }

  // ────────────────────────────── 그리기 ──────────────────────────────

  function render() {
    if (!el.screen) return;
    el.up.disabled = !cwd;
    el.search.value = query;
    el.viewBtn.title = view === 'list' ? '큰 아이콘으로' : '자세히 보기';
    el.viewBtn.classList.toggle('on', view === 'icons');
    const vlabel = el.viewBtn.querySelector('span');
    if (vlabel) vlabel.textContent = view === 'list' ? '보기' : '자세히';
    syncCmds();
    el.organize.disabled = Store.allAttachments().length < 2;
    renderPath();
    renderTree();
    renderBody();
  }

  function renderPath() {
    const parts = cwd ? cwd.split('/') : [];
    const crumbs = [];

    const mk = (label, path, last) => {
      const b = document.createElement('button');
      b.className = 'fx-crumb' + (last ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', () => goTo(path));
      dropTarget(b, path);
      return b;
    };

    crumbs.push(mk('서랍', '', !parts.length));
    let acc = '';
    parts.forEach((p, i) => {
      acc = acc ? acc + '/' + p : p;
      const sep = document.createElement('span');
      sep.className = 'fx-sep';
      sep.textContent = '›';
      crumbs.push(sep);
      crumbs.push(mk(p, acc, i === parts.length - 1));
    });
    el.path.replaceChildren(...crumbs);
  }

  function renderTree() {
    const rows = [treeRow('서랍', '', 0, childFolders('').length)];
    const walk = (parent, depth) => {
      for (const p of childFolders(parent)) {
        const kids = childFolders(p);
        rows.push(treeRow(leafOf(p), p, depth, kids.length));
        if (kids.length && !collapsed.has(p)) walk(p, depth + 1);
      }
    };
    walk('', 1);
    el.tree.replaceChildren(...rows);
  }

  function treeRow(label, path, depth, hasKids) {
    const row = document.createElement('div');
    row.className = 'fx-tree-row' + (path === cwd ? ' on' : '');
    row.style.paddingLeft = (6 + depth * 14) + 'px';

    const tw = document.createElement('button');
    tw.className = 'fx-twisty';
    tw.textContent = hasKids ? (collapsed.has(path) ? '▸' : '▾') : '';
    tw.disabled = !hasKids;
    tw.addEventListener('click', (e) => {
      e.stopPropagation();
      if (collapsed.has(path)) collapsed.delete(path); else collapsed.add(path);
      renderTree();
    });
    row.appendChild(tw);
    row.appendChild(icon('folder'));

    const nm = document.createElement('span');
    nm.className = 'fx-tree-name';
    nm.textContent = label;
    row.appendChild(nm);

    const n = countUnder(path);
    if (n) {
      const c = document.createElement('span');
      c.className = 'fx-tree-count';
      c.textContent = String(n);
      row.appendChild(c);
    }

    row.addEventListener('click', () => goTo(path));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu(e, path ? folderMenu(path) : emptyMenu());
    });
    dropTarget(row, path);
    return row;
  }

  const ICONS = {
    folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
    deadline: 'M6 3h12v18l-6-4-6 4z',
    note: 'M6 3h9l4 4v14H6zM15 3v5h4M9 12h7M9 16h5',
    link: 'M9.5 13.5a4 4 0 005.7 0l2.8-2.8a4 4 0 10-5.7-5.7l-1.2 1.2M14.5 10.5a4 4 0 00-5.7 0l-2.8 2.8a4 4 0 105.7 5.7l1.2-1.2',
  };

  function icon(kind) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'fx-ico ' + kind);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', ICONS[kind] || ICONS.folder);
    s.appendChild(p);
    return s;
  }

  function sortItems(list) {
    const k = sort.key;
    const d = sort.dir;
    return list.slice().sort((a, b) => {
      // 폴더는 언제나 위에
      if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1;
      let r = 0;
      if (k === 'size') r = (a.size || 0) - (b.size || 0);
      else if (k === 'date') r = (a.when || 0) - (b.when || 0);
      else if (k === 'kind') r = (KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
        || kindLabel(a).localeCompare(kindLabel(b));
      else r = String(a.name).localeCompare(String(b.name), 'ko', { numeric: true });
      if (!r) r = String(a.name).localeCompare(String(b.name), 'ko', { numeric: true });
      return r * d;
    });
  }

  function renderBody() {
    const searching = !!query;
    const q = query.toLowerCase();

    let list = itemsIn(cwd, searching);
    if (searching) {
      list = list.filter((it) => it.name.toLowerCase().includes(q)
        || String(it.sub || '').toLowerCase().includes(q));
    } else {
      list = childFolders(cwd).map((p) => ({
        key: 'f:' + p, kind: 'folder', name: leafOf(p),
        sub: '', size: 0, when: 0, path: p,
      })).concat(list);
    }
    list = sortItems(list);

    el.body.replaceChildren();
    el.body.className = 'fx-body ' + view;
    if (view === 'list') el.body.appendChild(headRow());

    if (!list.length) {
      const d = document.createElement('div');
      d.className = 'screen-empty';
      d.innerHTML = searching ? '찾는 것이 없습니다.'
        : '이 폴더는 비어 있습니다.<br><small>오른쪽 단추를 눌러 새로 만들거나, 컴퓨터에서 파일을 끌어다 놓으세요.</small>';
      el.body.appendChild(d);
      paintStatus(0, 0);
      return;
    }

    for (const it of list) el.body.appendChild(itemNode(it, searching));
    paintStatus(list.length, list.reduce((s, it) => s + (it.kind === 'file' ? (it.size || 0) : 0), 0));
    paintSelection();
  }

  // 탐색기의 "정렬 기준" 과 같은 자리. 머리글을 눌러도 되지만, 큰 아이콘 보기에는 머리글이 없다.
  function sortMenu() {
    const cols = [['name', '이름'], ['kind', '종류'], ['size', '크기'], ['date', '수정한 날짜']];
    const items = cols.map(([key, label]) => ({
      label: label + (sort.key === key ? '   ✓' : ''),
      fn: () => { sort = { key, dir: sort.key === key ? sort.dir : 1 }; saveSort(); },
    }));
    items.push({ sep: true });
    items.push({ label: '오름차순' + (sort.dir > 0 ? '   ✓' : ''), fn: () => { sort.dir = 1; saveSort(); } });
    items.push({ label: '내림차순' + (sort.dir < 0 ? '   ✓' : ''), fn: () => { sort.dir = -1; saveSort(); } });
    return items;
  }

  function saveSort() {
    Store.saveSettings({ filesSort: sort });
    renderBody();
  }

  // 고른 것이 없으면 누를 수 없게 — 눌러 놓고 아무 일도 안 일어나는 게 제일 답답하다.
  function syncCmds() {
    const n = sel.size;
    const one = n === 1;
    el.cut.disabled = !n;
    el.copy.disabled = !n;
    el.paste.disabled = !clip || !clip.keys.length;
    el.renameBtn.disabled = !one;
    el.del.disabled = !n;
    if (global.Nav) {
      el.back.disabled = !Nav.canBack();
      el.fwd.disabled = !Nav.canForward();
    }
    el.up.disabled = !cwd;
  }

  function headRow() {
    const h = document.createElement('div');
    h.className = 'fx-head';
    for (const [key, label] of [['name', '이름'], ['kind', '종류'], ['size', '크기'], ['date', '수정한 날짜']]) {
      const b = document.createElement('button');
      b.className = 'fx-col ' + key + (sort.key === key ? ' on' : '');
      b.textContent = label + (sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');
      b.addEventListener('click', () => {
        if (sort.key === key) sort.dir = -sort.dir;
        else { sort.key = key; sort.dir = 1; }
        Store.saveSettings({ filesSort: sort });
        renderBody();
      });
      h.appendChild(b);
    }
    return h;
  }

  function itemNode(it, searching) {
    const n = document.createElement('div');
    n.className = 'fx-item ' + it.kind + (it.done ? ' done' : '')
      + (it.kind === 'file' && it.data.missing ? ' missing' : '')
      + (clip && clip.mode === 'cut' && clip.keys.includes(it.key) ? ' cut' : '');
    n.dataset.key = it.key;
    n.draggable = true;
    n.title = it.name;

    // 첨부파일만 끝냄 표시를 쓴다
    if (it.kind === 'file') {
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'fx-chk';
      chk.checked = !!it.done;
      chk.title = '끝낸 파일로 표시';
      chk.addEventListener('mousedown', (e) => e.stopPropagation());
      chk.addEventListener('click', (e) => e.stopPropagation());
      chk.addEventListener('change', () => setDone(it, chk.checked));
      n.appendChild(chk);
    } else {
      const pad = document.createElement('span');
      pad.className = 'fx-chk-pad';
      n.appendChild(pad);
    }

    if (it.kind === 'file') {
      const thumb = document.createElement('span');
      thumb.className = 'fx-thumb';
      if (it.data.isImage && !it.data.missing) {
        const img = document.createElement('img');
        img.src = attSrc(it.data.id, it.data.mtimeMs || 0);
        thumb.appendChild(img);
      } else {
        thumb.textContent = kindLabel(it).slice(0, 4);
        thumb.classList.add('ext');
      }
      n.appendChild(thumb);
    } else {
      n.appendChild(icon(it.kind));
    }

    const wrap = document.createElement('span');
    wrap.className = 'fx-namewrap';
    const nm = document.createElement('span');
    nm.className = 'fx-name';
    nm.textContent = it.name;
    wrap.appendChild(nm);

    if (it.kind === 'deadline' && it.sub) {
      const b = document.createElement('span');
      b.className = 'fx-badge ' + (it.done ? 'done' : it.sub === 'D-DAY' ? 'today'
        : it.sub.charAt(0) === '+' ? 'over' : '');
      b.textContent = it.sub;
      wrap.appendChild(b);
    } else if (it.sub && it.kind !== 'file') {
      const b = document.createElement('span');
      b.className = 'fx-sub-inline';
      b.textContent = it.sub;
      wrap.appendChild(b);
    } else if (it.kind === 'file' && it.sub) {
      const b = document.createElement('span');
      b.className = 'fx-sub-inline';
      b.textContent = it.sub;
      b.title = '이 마감 열기';
      b.addEventListener('click', (e) => { e.stopPropagation(); if (it.ev) Detail.open(it.ev, it.ev.date); });
      wrap.appendChild(b);
    }
    if (searching && (it.data ? it.data.folder : it.path)) {
      const f = document.createElement('span');
      f.className = 'fx-where';
      f.textContent = (it.data && it.data.folder) || '';
      if (f.textContent) wrap.appendChild(f);
    }
    n.appendChild(wrap);

    if (view === 'list') {
      n.appendChild(cell('fx-kind', it.kind === 'folder'
        ? '폴더' : kindLabel(it)));
      n.appendChild(cell('fx-size', it.kind === 'file' ? fmtSize(it.size)
        : it.kind === 'folder' ? (countUnder(it.path) ? countUnder(it.path) + '개' : '') : ''));
      n.appendChild(cell('fx-date', it.kind === 'deadline' ? it.date : dateText(it.when)));
    }

    bindItem(n, it);
    if (it.kind === 'folder') dropTarget(n, it.path);
    return n;
  }

  function cell(cls, text) {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text || '';
    return s;
  }

  function dateText(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    if (isNaN(d)) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ────────────────────────── 고르기 · 열기 ──────────────────────────

  function visibleKeys() {
    return Array.from(el.body.querySelectorAll('.fx-item')).map((n) => n.dataset.key);
  }

  function itemOf(key) {
    if (key.indexOf('f:') === 0) {
      const p = key.slice(2);
      return { key, kind: 'folder', name: leafOf(p), path: p };
    }
    const id = key.slice(2);
    const t = key.charAt(0);
    if (t === 'e') { const e = Store.get(id); return e && { key, kind: 'deadline', name: e.title, data: e }; }
    if (t === 'n') { const n = Store.getNote(id); return n && { key, kind: 'note', name: n.title, data: n }; }
    if (t === 'l') { const l = Store.getLink(id); return l && { key, kind: 'link', name: Store.util.linkLabel(l), data: l }; }
    const x = Store.findAttachment(id);
    return x && { key, kind: 'file', name: x.att.name, data: x.att, ev: x.ev };
  }

  function picked() { return Array.from(sel).map(itemOf).filter(Boolean); }

  async function open(it) {
    if (it.kind === 'folder') { goTo(it.path); return; }
    if (it.kind === 'deadline') { Detail.open(it.data, it.data.date); return; }
    if (it.kind === 'note') { Nav.go({ v: 'note', id: it.data.id }); return; }
    if (it.kind === 'link') { api.shell.openExternal(it.data.url); return; }
    // 다른 기기에서 올린 파일이면 먼저 받아 온다
    if (global.Cloud && it.data.missing) {
      const got = await Cloud.ensureLocal(it.data);
      if (!got) return;
    }
    api.attach.open(it.data.id);
  }

  function bindItem(node, it) {
    node.addEventListener('mousedown', (e) => {
      const key = node.dataset.key;
      if (e.button === 2) {
        if (!sel.has(key)) { sel.clear(); sel.add(key); paintSelection(); }
        return;
      }
      if (e.button !== 0) return;
      if (e.ctrlKey || e.metaKey) {
        if (sel.has(key)) sel.delete(key); else sel.add(key);
        anchor = key;
      } else if (e.shiftKey && anchor) {
        const keys = visibleKeys();
        const a = keys.indexOf(anchor);
        const b = keys.indexOf(key);
        if (a >= 0 && b >= 0) {
          sel.clear();
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.add(keys[i]);
        }
      } else if (!sel.has(key)) {
        sel.clear();
        sel.add(key);
        anchor = key;
      } else {
        anchor = key;
      }
      paintSelection();
    });

    node.addEventListener('dblclick', (e) => { e.preventDefault(); open(it); });
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu(e, it.kind === 'folder' ? folderMenu(it.path) : itemMenu(it));
    });
    // 휴대폰에는 오른쪽 단추가 없다. 꾹 누르면 같은 차림표가 뜬다.
    longPress(node, (pt) => {
      const key = node.dataset.key;
      if (!sel.has(key)) { sel.clear(); sel.add(key); paintSelection(); }
      menu(pt, it.kind === 'folder' ? folderMenu(it.path) : itemMenu(it));
    });
    // 손가락으로는 한 번만 눌러도 열린다 (두 번 누르기가 어렵다)
    node.addEventListener('touchend', (e) => {
      if (longPressed) { longPressed = false; return; }
      if (e.touches.length) return;
      e.preventDefault();
      sel.clear();
      sel.add(node.dataset.key);
      paintSelection();
      open(it);
    });

    node.addEventListener('dragstart', (e) => {
      if (!sel.has(node.dataset.key)) { sel.clear(); sel.add(node.dataset.key); paintSelection(); }
      e.dataTransfer.setData('text/x-item', Array.from(sel).join('|'));
      e.dataTransfer.effectAllowed = 'move';
      el.body.classList.add('dragging');
    });
    node.addEventListener('dragend', () => el.body.classList.remove('dragging'));
  }

  // 꾹 누르기 — 터치에서 오른쪽 단추를 대신한다
  let longPressed = false;

  function longPress(node, fn) {
    let timer = null;
    let start = null;
    node.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      start = { clientX: t.clientX, clientY: t.clientY };
      timer = setTimeout(() => {
        timer = null;
        longPressed = true;
        fn(start);
      }, 480);
    }, { passive: true });
    const cancel = () => { clearTimeout(timer); timer = null; };
    node.addEventListener('touchmove', (e) => {
      if (!start || !e.touches.length) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - start.clientX) > 10 || Math.abs(t.clientY - start.clientY) > 10) cancel();
    }, { passive: true });
    node.addEventListener('touchend', cancel);
    node.addEventListener('touchcancel', cancel);
  }

  // 끌어다 놓을 수 있는 자리 — 폴더 칸, 나무, 주소 줄
  // path 가 null 이면 놓는 순간의 지금 폴더로 받는다.
  function dropTarget(node, path) {
    node.addEventListener('dragover', (e) => {
      const kind = dragKind(e);
      if (!kind) return;
      e.preventDefault();
      e.stopPropagation();
      // 컴퓨터에서 온 것은 끌어온 쪽이 허락한 효과를 그대로 둔다 — 'link' 로 못박으면
      // 복사만 허락하는 곳(브라우저 등)에서 끌어온 파일이 거부된다.
      if (kind === 'item') e.dataTransfer.dropEffect = 'move';
      node.classList.add('hot');
    });
    node.addEventListener('dragleave', (e) => {
      if (!node.contains(e.relatedTarget)) node.classList.remove('hot');
    });
    node.addEventListener('drop', (e) => {
      node.classList.remove('hot');
      e.stopPropagation();
      onDrop(e, path === null ? cwd : path);
    });
  }

  function dragKind(e) {
    const types = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
    if (types.includes('Files')) return 'os';
    if (types.includes('text/x-item')) return 'item';
    return null;
  }

  async function onDrop(e, target, show) {
    const kind = dragKind(e);
    if (!kind) return;
    e.preventDefault();
    if (kind === 'os') {
      const files = Array.from(e.dataTransfer.files || []);
      const paths = files.map((f) => api.attach.pathOf(f)).filter(Boolean);
      if (paths.length) await importPaths(paths, target, show);
      else if (files.length) await importFileObjects(files, target, show);
      return;
    }
    moveKeys(Array.from(sel), target);
  }

  function paintSelection() {
    for (const n of el.body.querySelectorAll('.fx-item')) {
      n.classList.toggle('sel', sel.has(n.dataset.key));
    }
    const extra = el.status.querySelector('.fx-sel');
    if (extra) extra.textContent = sel.size ? ' · ' + sel.size + '개 선택' : '';
    syncCmds();
  }

  function paintStatus(count, bytes) {
    el.status.replaceChildren();
    const a = document.createElement('span');
    a.textContent = count + '개 항목' + (bytes ? ' · ' + fmtSize(bytes) : '');
    el.status.appendChild(a);
    const b = document.createElement('span');
    b.className = 'fx-sel';
    el.status.appendChild(b);
  }

  function selectAll() { sel = new Set(visibleKeys()); paintSelection(); }

  // ────────────────────────────── 단축키 ──────────────────────────────

  function onKey(e) {
    const r = Nav.current;
    if (!r || r.v !== 'files') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!$('#searchModal').hidden || !$('#settingsModal').hidden || !$('#askModal').hidden) return;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
    if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); doCopy('copy'); return; }
    if (mod && e.key.toLowerCase() === 'x') { e.preventDefault(); doCopy('cut'); return; }
    if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); doPaste(); return; }
    if (mod) return;

    if (e.key === 'F5') { e.preventDefault(); render(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); goTo(parentOf(cwd)); return; }
    if (e.key === 'F2') {
      const p = picked();
      if (p.length === 1) { e.preventDefault(); rename(p[0]); }
      return;
    }
    if (e.key === 'Delete') { e.preventDefault(); removeSelected(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      for (const it of picked()) open(it);
      return;
    }
    const keys = visibleKeys();
    const move = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' }[e.key];
    if (move !== undefined) {
      e.preventDefault();
      if (!keys.length) return;
      let i = keys.indexOf(anchor);
      if (move === 'first') i = 0;
      else if (move === 'last') i = keys.length - 1;
      else { i = i < 0 ? (move > 0 ? 0 : keys.length - 1) : i + move; }
      i = Math.max(0, Math.min(keys.length - 1, i));
      const to = keys[i];
      // Shift 를 누른 채면 범위를 넓힌다 (탐색기와 같게)
      if (e.shiftKey && anchor) {
        const a = keys.indexOf(anchor);
        const [lo, hi] = a < i ? [a, i] : [i, a];
        sel = new Set(keys.slice(lo, hi + 1));
      } else {
        anchor = to;
        sel = new Set([to]);
      }
      focusKey(to);
      return;
    }

    // 글자를 치면 그 글자로 시작하는 것으로 건너뛴다
    if (e.key.length === 1 && !e.altKey) {
      typeAhead(e.key, keys);
    }
  }

  // 이름 첫 글자로 건너뛰기 — 탐색기에서 되는 것
  let typed = '';
  let typedAt = 0;

  function typeAhead(ch, keys) {
    const now = Date.now();
    typed = (now - typedAt < 900) ? typed + ch : ch;
    typedAt = now;
    const want = typed.toLowerCase();
    const from = keys.indexOf(anchor);
    const order = keys.slice(from + 1).concat(keys.slice(0, from + 1));
    const hit = order.find((k) => {
      const it = itemOf(k);
      return it && String(it.name || '').toLowerCase().startsWith(want);
    });
    if (!hit) return;
    anchor = hit;
    sel = new Set([hit]);
    focusKey(hit);
  }

  function focusKey(key) {
    paintSelection();
    const node = el.body.querySelector('.fx-item[data-key="' + CSS.escape(key) + '"]');
    if (node) node.scrollIntoView({ block: 'nearest' });
  }

  // ────────────────────────── 오른쪽 단추 차림표 ──────────────────────────

  let menuEl = null;

  function closeMenu() {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = null;
    document.removeEventListener('mousedown', awayMenu, true);
    document.removeEventListener('keydown', escMenu, true);
  }
  function awayMenu(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
  function escMenu(e) { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } }

  function anchorPoint(node) {
    const r = node.getBoundingClientRect();
    return { clientX: r.left, clientY: r.bottom + 4 };
  }

  function menu(e, items) {
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'ctx-menu';
    for (const it of items) {
      if (it.sep) {
        const d = document.createElement('div');
        d.className = 'ctx-menu-sep';
        menuEl.appendChild(d);
        continue;
      }
      const b = document.createElement('button');
      const s = document.createElement('span');
      s.textContent = it.label;
      b.appendChild(s);
      if (it.key) {
        const k = document.createElement('em');
        k.textContent = it.key;
        b.appendChild(k);
      }
      if (it.danger) b.classList.add('danger');
      if (it.disabled) b.disabled = true;
      b.addEventListener('click', () => { closeMenu(); it.fn(); });
      menuEl.appendChild(b);
    }
    document.body.appendChild(menuEl);
    const w = menuEl.offsetWidth;
    const h = menuEl.offsetHeight;
    menuEl.style.left = Math.min(e.clientX, window.innerWidth - w - 8) + 'px';
    menuEl.style.top = Math.min(e.clientY, window.innerHeight - h - 8) + 'px';
    setTimeout(() => {
      document.addEventListener('mousedown', awayMenu, true);
      document.addEventListener('keydown', escMenu, true);
    }, 0);
  }

  function newMenu() {
    return [
      { label: '새 폴더', fn: () => newFolder(cwd) },
      { label: '새 마감', fn: () => newDeadline(cwd) },
      { label: '새 필기', fn: () => newNote(cwd) },
      { label: '새 링크', fn: () => newLink(cwd) },
      { sep: true },
      { label: global.IS_WEB ? '파일 올리기…' : '컴퓨터 파일 연결…', fn: importFromDisk },
    ];
  }

  function emptyMenu() {
    return newMenu().concat([
      { sep: true },
      { label: '붙여넣기', key: 'Ctrl+V', disabled: !clip, fn: doPaste },
      { label: '전체 선택', key: 'Ctrl+A', fn: selectAll },
      { label: view === 'list' ? '큰 아이콘으로' : '자세히 보기', fn: () => el.viewBtn.click() },
    ]);
  }

  function moveTargets(p) {
    const paths = p.filter((x) => x.kind === 'folder').map((x) => x.path);
    return [''].concat(allFolders())
      .filter((f) => f !== cwd && paths.indexOf(f) < 0)
      .filter((f) => !paths.some((src) => f === src || f.indexOf(src + '/') === 0))
      .slice(0, 8)
      .map((f) => ({ label: '→ ' + (f || '서랍 (맨 위로)'), fn: () => moveKeys(Array.from(sel), f) }));
  }

  function itemMenu(it) {
    const p = picked();
    const many = p.length > 1;
    const items = [
      { label: many ? p.length + '개 열기' : '열기', key: 'Enter', fn: () => p.forEach(open) },
    ];
    if (it.kind === 'file') {
      items.push({ label: '탐색기에서 보기', disabled: many, fn: () => api.attach.reveal(it.data.id) });
      if (it.ev) items.push({ label: '이 마감 열기', disabled: many, fn: () => Detail.open(it.ev, it.ev.date) });
      items.push({ label: it.done ? '끝냄 표시 지우기' : '끝냄으로 표시',
        fn: () => p.forEach((x) => x.kind === 'file' && setDone(x, !it.done)) });
    }
    if (it.kind === 'link') {
      items.push({ label: '주소 고치기', disabled: many, fn: () => editLink(it.data) });
    }
    items.push({ sep: true });
    items.push({ label: '잘라내기', key: 'Ctrl+X', fn: () => doCopy('cut') });
    items.push({ label: '복사', key: 'Ctrl+C', fn: () => doCopy('copy') });
    items.push({ label: '이름 바꾸기', key: 'F2', disabled: many || it.kind === 'file',
      fn: () => rename(it) });
    const targets = moveTargets(p);
    if (targets.length) {
      items.push({ sep: true });
      for (const t of targets) items.push(t);
    }
    items.push({ sep: true });
    items.push({ label: many ? p.length + '개 삭제' : '삭제', key: 'Delete', danger: true, fn: removeSelected });
    return items;
  }

  function folderMenu(path) {
    return [
      { label: '열기', fn: () => goTo(path) },
      { label: '이름 바꾸기', key: 'F2', fn: () => rename({ kind: 'folder', path, name: leafOf(path) }) },
      { sep: true },
      { label: '이 안에 새 폴더', fn: () => newFolder(path) },
      { label: global.IS_WEB ? '이 안으로 파일 올리기…' : '이 안에 파일 연결…', fn: () => importFromDisk(path) },
      { sep: true },
      { label: '잘라내기', key: 'Ctrl+X', fn: () => doCopy('cut') },
      { label: '복사', key: 'Ctrl+C', fn: () => doCopy('copy') },
      { sep: true },
      { label: '폴더만 풀기 (안의 것은 남김)', fn: () => dissolve(path) },
      { label: '폴더째 삭제', danger: true, fn: () => deleteFolder(path) },
    ];
  }

  // ────────────────────────── 새로 만들기 ──────────────────────────

  async function newFolder(under) {
    const base = clean(under || '');
    const name = await App.prompt('새 폴더',
      (base ? '"' + leafOf(base) + '" 안에 만듭니다.' : '맨 위에 만듭니다.'), '');
    if (!name) return;
    const full = clean((base ? base + '/' : '') + name);
    if (!full) return;
    if (full.split('/').length > 3) { App.toast('폴더는 세 단계까지만 됩니다.'); return; }
    Store.addFolder(full);
    goTo(base);
    render();
  }

  function newDeadline(folder) {
    const d = Recur.todayISO();
    const ev = Store.create({ date: d, folder: clean(folder || '') });
    Detail.open(ev, d, true);
  }

  function newNote(folder) {
    const n = Store.createNote({ folder: clean(folder || '') });
    Nav.go({ v: 'note', id: n.id });
    setTimeout(() => { const t = $('#noteTitle'); if (t) t.focus(); }, 40);
  }

  async function newLink(folder) {
    const url = await App.prompt('새 링크', '주소를 붙여넣으세요.', '');
    if (!url) return;
    const l = Store.createLink({ url, folder: clean(folder || '') });
    render();
    const res = await api.links.title(l.url);
    if (res && res.ok && res.title) Store.updateLink(l.id, { title: res.title });
    render();
  }

  async function importFromDisk(folder) {
    const target = typeof folder === 'string' ? folder : cwd;
    App.toast('고르는 중…');
    const made = await api.attach.pick(null);
    if (!made || !made.length) return;           // 고르기를 그냥 닫은 것
    landFiles(made, target);
  }

  // 끌어다 놓은 파일을 이 폴더에 연결한다. 디스크의 원본은 그 자리에 그대로 있다.
  async function importPaths(paths, target, show) {
    if (!paths || !paths.length) return;
    App.toast('연결하는 중…');
    const made = await api.attach.add(null, paths);
    landFiles(made, target, show);
  }

  // 원본 자리가 없는 것(브라우저에서 끌어온 그림, 웹 버전)은 내용을 그대로 넣는다.
  async function importFileObjects(files, target, show) {
    if (!files.length) return;
    App.toast('넣는 중…');
    const made = [];
    for (const f of files) {
      const buf = new Uint8Array(await f.arrayBuffer());
      const a = await api.attach.addBuffer(null, f.name, buf);
      if (a) made.push(a);
    }
    landFiles(made, target, show);
  }

  function landFiles(made, target, show) {
    if (!made || !made.length) { App.toast('연결하지 못했습니다. 폴더는 넣을 수 없고 파일만 됩니다.'); return; }
    const folder = clean(target || '');
    if (folder) Store.addFolder(folder, true);
    Store.addFiles(made.map((a) => Object.assign(a, { folder })));
    render();
    const msg = made.length + '개 연결했습니다.' + (global.IS_WEB ? '' : ' 원본은 그 자리에 그대로 있습니다.');
    if (!show) { App.toast(msg); return; }
    const keys = made.map((a) => 'a:' + a.id);
    App.toast('"' + (folder ? leafOf(folder) : '서랍') + '" 에 ' + msg, {
      label: '보기',
      fn: () => { Files.reveal(keys[0], folder); sel = new Set(keys); paintSelection(); },
    });
  }

  // ────────────────────────── 고치기 · 옮기기 ──────────────────────────

  function setDone(it, v) {
    if (it.kind !== 'file') return;
    const own = Store.files.find((x) => x.id === it.data.id);
    if (own) { Store.updateFile(own.id, { done: !!v }); render(); return; }
    for (const ev of Store.events) {
      if (!(ev.attachments || []).some((x) => x.id === it.data.id)) continue;
      Store.update(ev.id, {
        attachments: ev.attachments.map((x) => (
          x.id === it.data.id ? Object.assign({}, x, { done: !!v }) : x)),
      });
      break;
    }
    render();
  }

  async function rename(it) {
    if (it.kind === 'file') {
      // 앱 안에서 보이는 이름만 바꾼다. 디스크의 진짜 파일은 건드리지 않는다 —
      // 원본 연결한 파일이면 남의 폴더에 있는 파일 이름을 멋대로 바꾸는 셈이 된다.
      const next = await App.prompt('이름 바꾸기', '앱에서 보일 이름만 바뀝니다. 디스크의 파일은 그대로입니다.',
        it.data.name || '');
      if (next === null) return;
      const name = String(next).trim();
      if (!name || name === it.data.name) return;
      if (Store.files.some((f) => f.id === it.data.id)) Store.updateFile(it.data.id, { name });
      else if (it.ev) {
        it.data.name = name;
        Store.update(it.ev.id, { attachments: it.ev.attachments });
      }
      render();
      return;
    }
    if (it.kind === 'folder') {
      const name = await App.prompt('폴더 이름 바꾸기', null, leafOf(it.path));
      if (!name) return;
      const parent = parentOf(it.path);
      const next = clean(parent ? parent + '/' + name : name);
      if (!next || next === it.path) return;
      Store.renameFolderEverywhere(it.path, next);
      renameFolderOnItems(it.path, next);
      if (cwd === it.path || cwd.indexOf(it.path + '/') === 0) {
        Nav.replace({ v: 'files', sub: next + cwd.slice(it.path.length) });
        return;
      }
      render();
      return;
    }
    const cur = it.kind === 'link' ? (it.data.title || '') : (it.data.title || '');
    const name = await App.prompt('이름 바꾸기', null, cur);
    if (name === null) return;
    if (it.kind === 'deadline') Store.update(it.data.id, { title: name });
    else if (it.kind === 'note') Store.updateNote(it.data.id, { title: name });
    else Store.updateLink(it.data.id, { title: name });
    render();
  }

  // 폴더 이름이 바뀌면 마감·필기·링크의 폴더도 함께 따라간다.
  function renameFolderOnItems(from, to) {
    const swap = (p) => {
      if (!p) return p;
      if (p === from) return to;
      if (p.indexOf(from + '/') === 0) return to + p.slice(from.length);
      return p;
    };
    for (const e of Store.events) if (e.folder) e.folder = swap(e.folder);
    for (const n of Store.notes) if (n.folder) n.folder = swap(n.folder);
    for (const l of Store.links) if (l.folder) l.folder = swap(l.folder);
    for (const f of Store.files) if (f.folder) f.folder = swap(f.folder);
    Store.save();
    Store.saveNotes();
    Store.saveLinks();
    Store.saveFiles();
  }

  function setFolder(key, folder) {
    const id = key.slice(2);
    const t = key.charAt(0);
    if (t === 'e') { Store.update(id, { folder }); return true; }
    if (t === 'n') { Store.updateNote(id, { folder }); return true; }
    if (t === 'l') { Store.updateLink(id, { folder }); return true; }
    if (t === 'a') return Store.setAttachmentFolder(id, folder);
    return false;
  }

  function moveKeys(keys, target) {
    const dest = clean(target || '');
    let moved = 0;
    if (dest) Store.addFolder(dest, true);

    for (const key of keys) {
      if (key.indexOf('f:') === 0) {
        const src = key.slice(2);
        if (src === dest || dest === src || dest.indexOf(src + '/') === 0) continue;
        const next = clean((dest ? dest + '/' : '') + leafOf(src));
        if (!next || next === src) continue;
        if (next.split('/').length > 3) { App.toast('폴더는 세 단계까지만 됩니다.'); continue; }
        Store.renameFolderEverywhere(src, next);
        renameFolderOnItems(src, next);
        moved++;
      } else if (setFolder(key, dest)) moved++;
    }
    if (!moved) return;
    Store.saveFolders();
    sel.clear();
    render();
    App.toast(dest ? '"' + leafOf(dest) + '" 으로 옮겼습니다.' : '맨 위로 옮겼습니다.');
  }

  // ────────────────────────── 잘라내기 · 복사 ──────────────────────────

  function doCopy(mode) {
    if (!sel.size) return;
    clip = { mode, keys: Array.from(sel) };
    renderBody();
    App.toast(sel.size + '개를 ' + (mode === 'cut' ? '잘라냈습니다' : '복사했습니다')
      + '. 옮길 폴더에서 Ctrl+V');
  }

  async function doPaste() {
    if (!clip || !clip.keys.length) return;
    if (clip.mode === 'cut') {
      moveKeys(clip.keys, cwd);
      clip = null;
      return;
    }
    let made = 0;
    for (const key of clip.keys) made += await duplicate(key, cwd);
    if (made) {
      render();
      App.toast(made + '개를 복사해 넣었습니다.');
    }
  }

  // 하나를 이 폴더에 똑같이 하나 더 만든다.
  async function duplicate(key, dest) {
    const id = key.slice(2);
    const t = key.charAt(0);
    const folder = clean(dest || '');
    if (folder) Store.addFolder(folder, true);

    if (t === 'e') {
      const e = Store.get(id);
      if (!e) return 0;
      const copy = Store.util.deepCopy(e);
      delete copy.id;
      Store.create(Object.assign(copy, {
        title: (e.title || '제목 없음') + ' (사본)', folder, attachments: [],
      }));
      return 1;
    }
    if (t === 'n') {
      const n = Store.getNote(id);
      if (!n) return 0;
      Store.createNote({ title: (n.title || '') + ' (사본)', body: n.body, folder });
      return 1;
    }
    if (t === 'l') {
      const l = Store.getLink(id);
      if (!l) return 0;
      Store.createLink({ url: l.url, title: l.title, note: l.note, folder });
      return 1;
    }
    if (t === 'a') {
      const res = await api.attach.duplicate(id);
      if (!res || !res.id) return 0;
      Store.addFiles([Object.assign(res, { folder })]);
      return 1;
    }
    if (t === 'f') {
      // 폴더를 통째로 복사한다 — 안의 것까지.
      const src = id;
      let name = leafOf(src) + ' (사본)';
      const next = clean((folder ? folder + '/' : '') + name);
      if (!next || next.split('/').length > 3) { App.toast('폴더는 세 단계까지만 됩니다.'); return 0; }
      Store.addFolder(next);
      let n = 0;
      for (const it of itemsIn(src, false)) n += await duplicate(it.key, next);
      for (const sub of childFolders(src)) n += await duplicate('f:' + sub, next);
      return n + 1;
    }
    return 0;
  }

  // ────────────────────────────── 지우기 ──────────────────────────────

  async function dissolve(path) {
    const n = countUnder(path);
    const ok = await App.ask('폴더만 풀까요?',
      '"' + leafOf(path) + '" 폴더를 없애고 안의 것' + (n ? ' ' + n + '개' : '')
      + '은 한 단계 위로 올립니다. 아무것도 지워지지 않습니다.',
      [{ label: '취소', value: false }, { label: '풀기', value: true, primary: true }]);
    if (!ok) return;
    const parent = parentOf(path);
    const lift = (p) => {
      if (!p) return p;
      if (p === path) return parent;
      if (p.indexOf(path + '/') === 0) return (parent ? parent + '/' : '') + p.slice(path.length + 1);
      return p;
    };
    for (const e of Store.events) e.folder = lift(e.folder);
    for (const n2 of Store.notes) n2.folder = lift(n2.folder);
    for (const l of Store.links) l.folder = lift(l.folder);
    for (const f of Store.files) f.folder = lift(f.folder);
    Store.save();
    Store.saveNotes();
    Store.saveLinks();
    Store.saveFiles();
    Store.dissolveFolderEverywhere(path);
    if (cwd === path || cwd.indexOf(path + '/') === 0) { goTo(parent); return; }
    render();
  }

  async function deleteFolder(path) {
    const items = itemsIn(path, true);
    const ok = await App.ask('폴더째 지울까요?',
      '"' + leafOf(path) + '" 과(와) 그 안의 ' + items.length + '개를 모두 지웁니다. '
      + '연결한 원본 파일은 그대로 남습니다.',
      [{ label: '취소', value: false }, { label: '모두 삭제', value: true, primary: true, danger: true }]);
    if (!ok) return;
    for (const it of items) await removeOne(it.key);
    for (const sub of allFolders().filter((p) => p === path || p.indexOf(path + '/') === 0)) {
      Store.dissolveFolderEverywhere(sub);
    }
    if (cwd === path || cwd.indexOf(path + '/') === 0) { goTo(parentOf(path)); return; }
    render();
    App.toast('지웠습니다.');
  }

  async function removeOne(key) {
    const id = key.slice(2);
    const t = key.charAt(0);
    if (t === 'e') {
      for (const l of Store.linksOf(id)) Store.removeLink(l.id);
      Store.remove(id);
    } else if (t === 'n') {
      for (const l of Store.linksOf(id)) Store.removeLink(l.id);
      Store.removeNote(id);
    } else if (t === 'l') {
      Store.removeLink(id);
    } else if (t === 'a') {
      await api.attach.remove(id);
      if (global.Cloud && Cloud.signedIn()) await Cloud.deleteBytes(id);
      const own = Store.files.find((x) => x.id === id);
      if (own) Store.removeFile(id);
      else {
        for (const ev of Store.events) {
          if (!(ev.attachments || []).some((x) => x.id === id)) continue;
          Store.update(ev.id, { attachments: ev.attachments.filter((x) => x.id !== id) });
          break;
        }
      }
    }
  }

  async function removeSelected() {
    const p = picked();
    if (!p.length) return;
    const folders = p.filter((x) => x.kind === 'folder');
    if (folders.length === 1 && p.length === 1) { deleteFolder(folders[0].path); return; }

    const files = p.filter((x) => x.kind === 'file');
    const text = (p.length === 1 ? '"' + p[0].name + '" 을(를) 지울까요?' : p.length + '개를 지울까요?')
      + (files.some((x) => x.data.mode === 'linked') ? ' 연결만 끊고 원본 파일은 그대로 남습니다.' : '')
      + (files.some((x) => x.data.mode !== 'linked') ? ' 앱 폴더에 있던 파일은 휴지통으로 갑니다.' : '');
    const ok = await App.ask('삭제', text,
      [{ label: '취소', value: false }, { label: '삭제', value: true, primary: true, danger: true }]);
    if (!ok) return;

    for (const it of p) {
      if (it.kind === 'folder') await deleteFolderQuiet(it.path);
      else await removeOne(it.key);
    }
    sel.clear();
    render();
    App.toast('지웠습니다.');
  }

  async function deleteFolderQuiet(path) {
    for (const it of itemsIn(path, true)) await removeOne(it.key);
    for (const sub of allFolders().filter((p) => p === path || p.indexOf(path + '/') === 0)) {
      Store.dissolveFolderEverywhere(sub);
    }
  }

  // ────────────────────────────── 링크 고치기 ──────────────────────────────

  async function editLink(l) {
    const url = await App.prompt('링크 주소', Store.util.linkLabel(l), l.url);
    if (url === null) return;
    Store.updateLink(l.id, { url });
    render();
  }

  // ────────────────────── AI 폴더 나누기 (첨부파일) ──────────────────────

  let organizing = false;

  async function organizeAll(wish) {
    if (organizing) return;
    const items = Store.allAttachments();
    if (items.length < 2) { App.toast('나눌 파일이 두 개는 있어야 합니다.'); return; }
    organizing = true;
    el.organize.disabled = true;
    const old = el.organize.textContent;
    el.organize.textContent = ' 나누는 중…';
    App.toast((wish ? '"' + wish + '" 대로 ' : '') + '파일 ' + items.length
      + '개를 나누는 중입니다. 20초쯤 걸립니다.');

    const res = await api.attach.organize(
      items.map((x) => ({ name: x.att.name, isImage: !!x.att.isImage })),
      '여러 마감의 첨부파일 모음',
      Store.settings.writeModel, wish || '');

    organizing = false;
    el.organize.textContent = old;
    el.organize.disabled = false;
    if (!res.ok) { App.toast('실패 — ' + res.error); return; }

    const byName = new Map();
    for (const x of items) {
      if (!byName.has(x.att.name)) byName.set(x.att.name, []);
      byName.get(x.att.name).push(x);
    }
    const plan = new Map();
    for (const it of (res.items || [])) {
      const bucket = byName.get(String((it && it.file) || '').trim());
      if (!bucket || !bucket.length) continue;
      plan.set(bucket.shift().att.id, clean(it.folder));
    }
    const changed = items.filter((x) => plan.has(x.att.id)
      && plan.get(x.att.id) !== (x.att.folder || '')).length;
    if (!changed) { App.toast('바뀌는 게 없습니다.'); return; }

    const before = items.map((x) => ({ id: x.att.id, folder: x.att.folder || '' }));
    for (const [id, folder] of plan) Store.setAttachmentFolder(id, folder);
    for (const f of plan.values()) if (f) Store.addFolder(f, true);
    Store.saveFolders();
    render();

    App.toast(changed + '개를 폴더로 나눴습니다. 디스크의 파일은 그대로입니다.', {
      label: '되돌리기',
      fn: () => {
        for (const x of before) Store.setAttachmentFolder(x.id, x.folder);
        render();
        App.toast('되돌렸습니다.');
      },
    });
  }

  global.Files = Files;
})(window);
