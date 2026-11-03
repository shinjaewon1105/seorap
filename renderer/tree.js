/* ══════════════════════════════════════════════════════════════════
   첨부 폴더 나무 — 상세 패널과 파일 화면이 함께 쓴다.
   폴더는 앱 안에서만 있는 것이고, 디스크의 파일은 어디로도 움직이지 않는다.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const leafOf = (p) => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p);

  const FOLDER_PATH = 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z';

  function fmtSize(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function iconBtn(title, d, fn) {
    const b = document.createElement('button');
    b.className = 'icon-btn';
    b.title = title;
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + d + '"/></svg>';
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(e); });
    return b;
  }

  function isAttDrag(e) {
    return !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('text/x-att'));
  }

  function indentWrap(depth, inner) {
    const row = document.createElement('div');
    row.className = 'att-row';
    row.style.paddingLeft = (depth * 18) + 'px';
    row.appendChild(inner);
    return row;
  }

  // opts:
  //   items      [{ att, ev }]           보여줄 파일들
  //   folders    string[]                보여줄 폴더 경로 (없어도 파일 폴더로 채운다)
  //   collapsed  Set                     접어 둔 경로
  //   showOwner  bool                    파일 밑에 어느 일정 것인지 표시
  //   readOnly   bool                    미리보기용 — 버튼도 드래그도 없음
  //   on{Toggle,Move,Rename,Dissolve,Done,Open,Reveal,Remove,Insert}
  function render(box, opts) {
    const o = opts || {};
    const items = o.items || [];
    const collapsed = o.collapsed || new Set();

    // 폴더 목록 = 넘겨준 것 + 파일이 실제로 들어 있는 곳 + 그 중간 단계
    const set = new Set();
    const addPath = (p) => {
      if (!p) return;
      const parts = p.split('/');
      for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'));
    };
    for (const p of (o.folders || [])) addPath(p);
    for (const it of items) addPath(it.att.folder);

    const byFolder = new Map([['', []]]);
    for (const p of set) byFolder.set(p, []);
    for (const it of items) {
      const f = it.att.folder || '';
      if (!byFolder.has(f)) byFolder.set(f, []);
      byFolder.get(f).push(it);
    }

    const countIn = (folder) => items.filter(
      (it) => it.att.folder === folder || (it.att.folder || '').indexOf(folder + '/') === 0).length;

    const rows = [];
    const walk = (parent, depth) => {
      const kids = Array.from(byFolder.keys())
        .filter((p) => p && parentOf(p) === parent)
        .sort((a, b) => a.localeCompare(b, 'ko'));
      for (const p of kids) {
        rows.push(folderRow(p, depth, countIn(p), o, collapsed));
        if (!collapsed.has(p)) walk(p, depth + 1);
      }
      for (const it of (byFolder.get(parent) || [])) {
        rows.push(fileRow(it, depth, o));
      }
    };
    walk('', 0);

    box.replaceChildren(...rows);

    // 나무의 빈 자리에 놓으면 폴더 밖으로 뺀다
    if (!o.readOnly && !box.dataset.rootDrop) {
      box.dataset.rootDrop = '1';
      box.addEventListener('dragover', (e) => {
        if (!isAttDrag(e) || e.target.closest('.att-folder')) return;
        e.preventDefault();
      });
      box.addEventListener('drop', (e) => {
        if (!isAttDrag(e) || e.target.closest('.att-folder')) return;
        e.preventDefault();
        e.stopPropagation();
        if (o.onMove) o.onMove(e.dataTransfer.getData('text/x-att'), '');
      });
    }
  }

  function folderRow(pathStr, depth, count, o, collapsed) {
    const open = !collapsed.has(pathStr);
    const box = document.createElement('div');
    box.className = 'att-folder' + (open ? '' : ' closed');
    box.dataset.folder = pathStr;

    box.innerHTML = (o.readOnly ? ''
      : '<svg class="caret" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>')
      + '<svg class="fico" viewBox="0 0 24 24"><path d="' + FOLDER_PATH + '"/></svg>';

    const name = document.createElement('span');
    name.className = 'fname';
    name.textContent = leafOf(pathStr);
    box.appendChild(name);

    const cnt = document.createElement('span');
    cnt.className = 'fcount';
    cnt.textContent = count ? count + '개' : '비어 있음';
    box.appendChild(cnt);

    if (!o.readOnly) {
      const btns = document.createElement('div');
      btns.className = 'fbtns';
      if (o.onRename) {
        btns.appendChild(iconBtn('이름 바꾸기', 'M4 20h4l10-10-4-4L4 16zM14 6l4 4',
          () => o.onRename(pathStr)));
      }
      if (o.onDissolve) {
        btns.appendChild(iconBtn('폴더 풀기 (파일은 남습니다)', 'M6 6l12 12M18 6L6 18',
          () => o.onDissolve(pathStr)));
      }
      box.appendChild(btns);

      box.addEventListener('click', () => { if (o.onToggle) o.onToggle(pathStr); });

      box.addEventListener('dragover', (e) => {
        if (!isAttDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        box.classList.add('drop-in');
      });
      box.addEventListener('dragleave', () => box.classList.remove('drop-in'));
      box.addEventListener('drop', (e) => {
        box.classList.remove('drop-in');
        if (!isAttDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (o.onMove) o.onMove(e.dataTransfer.getData('text/x-att'), pathStr);
      });
    }

    return indentWrap(depth, box);
  }

  function fileRow(it, depth, o) {
    const a = it.att;
    const ev = it.ev;
    const row = document.createElement('div');
    row.className = 'att' + (a.missing ? ' missing' : '') + (a.done ? ' done' : '');

    if (!o.readOnly) {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/x-att', a.id);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));

      // 파일마다 체크박스 — 제출했는지, 확인했는지 표시용
      if (o.onDone) {
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.className = 'att-chk';
        chk.checked = !!a.done;
        chk.title = '끝낸 파일로 표시';
        chk.addEventListener('click', (e) => e.stopPropagation());
        chk.addEventListener('change', () => o.onDone(a.id, chk.checked));
        row.appendChild(chk);
      }
    }

    const thumb = document.createElement('div');
    thumb.className = 'att-thumb';
    if (a.isImage && !a.missing) {
      const img = document.createElement('img');
      img.src = attSrc(a.id, a.mtimeMs || 0);
      img.style.cssText = 'width:100%;height:100%;object-fit:cover';
      thumb.appendChild(img);
    } else {
      thumb.textContent = (String(a.name).split('.').pop() || '?').slice(0, 4);
    }
    row.appendChild(thumb);

    const meta = document.createElement('div');
    meta.className = 'att-meta';
    const nm = document.createElement('div');
    nm.className = 'att-name';
    nm.textContent = a.name;
    meta.appendChild(nm);

    const sub = document.createElement('div');
    sub.className = 'att-sub';
    const badge = document.createElement('span');
    badge.className = 'att-badge ' + (a.missing ? 'missing' : a.mode === 'linked' ? 'linked' : '');
    badge.textContent = a.missing ? '파일 없음' : a.mode === 'linked' ? '원본 연결' : '앱 폴더';
    sub.appendChild(badge);
    sub.appendChild(document.createTextNode(fmtSize(a.size)));

    if (o.showOwner && ev) {
      const own = document.createElement('span');
      own.className = 'att-owner';
      const dot = document.createElement('span');
      dot.className = 'dl-dot';
      dot.style.background = ev.color;
      own.appendChild(dot);
      own.appendChild(document.createTextNode((ev.title || '제목 없음') + ' · ' + ev.date));
      own.style.cursor = 'pointer';
      own.title = '이 일정 열기';
      own.addEventListener('click', (e) => { e.stopPropagation(); if (o.onOpen) o.onOpen(ev); });
      sub.appendChild(own);
    }
    meta.appendChild(sub);
    row.appendChild(meta);

    if (!o.readOnly) {
      const btns = document.createElement('div');
      btns.className = 'att-btns';
      if (o.onInsert) {
        btns.appendChild(iconBtn('본문에 넣기', 'M12 5v14M5 12h14', () => o.onInsert(a)));
      }
      btns.appendChild(iconBtn('열기', 'M14 3h7v7M21 3l-9 9M5 5h6M5 5v14h14v-6',
        () => api.attach.open(a.id)));
      btns.appendChild(iconBtn('탐색기에서 보기', 'M3 7h6l2 2h10v10H3z',
        () => api.attach.reveal(a.id)));
      if (o.onRemove) {
        btns.appendChild(iconBtn('제거', 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13',
          () => o.onRemove(a, ev)));
      }
      row.appendChild(btns);
    } else if (a.moved) {
      const tag = document.createElement('span');
      tag.className = 'att-badge linked';
      tag.textContent = '옮김';
      row.appendChild(tag);
    }

    return indentWrap(depth, row);
  }

  global.Tree = { render, parentOf, leafOf, fmtSize, iconBtn, isAttDrag, indentWrap };
})(window);
