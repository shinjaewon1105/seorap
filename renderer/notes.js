/* ══════════════════════════════════════════════════════════════════
   필기 하나 — 마크다운·수식·코드·체크리스트를 그대로 쓴다.
   목록은 파일 화면이 맡는다(폴더 안에 마감·링크와 나란히 놓인다).
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  let el = {};
  let box = null;          // 지금 열려 있는 필기의 메모 칸
  let links = null;        // 그 필기에 딸린 링크 칸
  let curId = null;

  const Notes = {
    init() {
      el = {
        one: $('#noteView'), title: $('#noteTitle'), mdMount: $('#noteMd'),
        linkMount: $('#noteLinks'), pin: $('#notePin'), del: $('#noteDelete'),
        meta: $('#noteMeta'), folder: $('#noteFolder'),
      };

      el.folder.addEventListener('change', () => {
        if (!curId) return;
        Store.updateNote(curId, { folder: el.folder.value });
        if (global.Files) Files.render();
      });

      el.title.addEventListener('input', debounce(() => {
        if (!curId) return;
        Store.updateNote(curId, { title: el.title.value });
        Nav.touch();
      }, 250));
      el.title.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); if (box) box.enterEdit(); }
      });

      el.pin.addEventListener('click', () => {
        const n = Store.getNote(curId);
        if (!n) return;
        Store.updateNote(curId, { pinned: !n.pinned });
        paintPin();
        App.toast(n.pinned ? '고정을 풀었습니다.' : '위에 고정했습니다.');
      });

      el.del.addEventListener('click', onDelete);

      Nav.register('note', {
        el: el.one,
        live: true,          // 손으로 고치는 화면
        title: (r) => {
          const n = Store.getNote(r.id);
          return n ? (n.title.trim() || firstLine(n.body) || '새 필기') : '필기';
        },
        show: (r) => showOne(r.id),
        leave: () => {
          if (box && box.isEditing()) box.leaveEdit();
          if (box) box.closeAi();
          cleanupEmpty();
        },
      });
    },

    // 다른 화면에서 필기를 새로 만들 때
    create: newNote,
    isEditing: () => !!(box && box.isEditing()),
    isBusy: () => MdBox.busy(),
  };

  function debounce(fn, ms) {
    let t = null;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function firstLine(body) {
    const s = MD.plain(body || '').trim();
    if (!s) return '';
    return s.split('\n')[0].slice(0, 40);
  }

  // ────────────────────────────── 목록 ──────────────────────────────

  function newNote(opts) {
    const n = Store.createNote(opts || {});
    Nav.go({ v: 'note', id: n.id });
    setTimeout(() => { el.title.focus(); }, 40);
    return n;
  }

  // ────────────────────────────── 하나 보기 ──────────────────────────────

  function showOne(id) {
    const n = Store.getNote(id);
    if (!n) {
      Nav.replace({ v: 'files' });
      return;
    }
    const changed = curId !== id;
    curId = id;
    el.title.value = n.title;
    fillFolders(n.folder || '');
    paintPin();
    paintMeta();

    if (!box) {
      box = MdBox.create(el.mdMount, {
        label: '내용',
        get: () => (Store.getNote(curId) || {}).body || '',
        set: (text) => {
          if (!curId) return;
          Store.updateNote(curId, { body: text });
          Nav.touch();
        },
        emptyHint: '여기를 눌러 적기 시작하세요. 마크다운·수식·코드·체크리스트를 그대로 쓸 수 있습니다.',
      });
    } else if (changed) {
      box.closeAi();
      box.render();
    } else {
      box.render();
    }

    if (!links) links = Links.section(el.linkMount, id);
    else links.setOwner(id);
  }

  function fillFolders(cur) {
    const opts = [new Option('서랍 (맨 위)', '')];
    for (const f of Store.folders) opts.push(new Option(f, f));
    el.folder.replaceChildren(...opts);
    el.folder.value = Store.folders.includes(cur) ? cur : '';
  }

  function paintPin() {
    const n = Store.getNote(curId);
    el.pin.classList.toggle('on', !!(n && n.pinned));
    el.pin.title = n && n.pinned ? '고정 풀기' : '위에 고정';
  }

  function paintMeta() {
    const n = Store.getNote(curId);
    if (!n) { el.meta.textContent = ''; return; }
    const made = new Date(n.createdAt);
    el.meta.textContent = isNaN(made) ? ''
      : (made.getFullYear() + '. ' + (made.getMonth() + 1) + '. ' + made.getDate() + ' 에 만듦');
  }

  // 제목도 내용도 없는 필기는 나갈 때 조용히 치운다.
  function cleanupEmpty() {
    const n = Store.getNote(curId);
    if (!n) return;
    if (n.title.trim() || n.body.trim() || Store.linksOf(n.id).length) return;
    Store.removeNote(n.id);
    curId = null;
  }

  async function onDelete() {
    const n = Store.getNote(curId);
    if (!n) return;
    const ok = await App.ask('이 필기를 지울까요?', n.title.trim() || firstLine(n.body) || '빈 필기', [
      { label: '취소', value: false },
      { label: '지우기', value: true, primary: true, danger: true },
    ]);
    if (!ok) return;
    for (const l of Store.linksOf(n.id)) Store.removeLink(l.id);
    Store.removeNote(n.id);
    curId = null;
    Nav.backOr({ v: 'files' });
    App.toast('지웠습니다.');
  }

  global.Notes = Notes;
})(window);
