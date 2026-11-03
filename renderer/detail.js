/* ══════════════════════════════════════════════════════════════════
   마감 하나 — 날짜 · 메모 · 링크 · 첨부파일.
   시간과 장소는 쓰지 않는다(2026-09-12). 모두 날짜 단위다.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  // 첨부를 폴더 사이로 옮기는 끌기인지 (컴퓨터에서 끌어온 파일과 가른다).
  // ⚠ tree.js 안의 함수라 이렇게 꺼내 써야 한다. 예전에는 그냥 isAttDrag 를 불러서
  // 끌어다 놓는 순간 ReferenceError 로 죽었다 — 마감에 파일 드롭이 통째로 안 됐다.
  const isAttDrag = (e) => Tree.isAttDrag(e);
  // 화면 순서는 일요일부터. 저장되는 요일 번호는 1=월 … 7=일.
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const wdValue = (i) => (i === 0 ? 7 : i);      // 칸 번호 → 요일 번호
  const wdLabel = (n) => DOW[n % 7];             // 요일 번호 → 이름
  const el = {};
  let cur = null;          // 현재 보고 있는 원본 마감
  let curOcc = null;       // 이 화면을 연 회차 날짜
  let filling = false;     // 값을 채워 넣는 동안 change 이벤트를 무시
  let mdbox = null;        // 메모 칸
  let linkBox = null;      // 링크 칸
  let pendingFocus = false;

  const Detail = {
    get currentId() { return cur ? cur.id : null; },

    init() {
      [
        'panel', 'pDelete', 'pTitle', 'pColorDot', 'pFolder',
        'pRepeat', 'wdPicker', 'untilRow',
        'pDateBtn', 'pDatePrev', 'pDateNext',
        'repeatSummary', 'repeatBox', 'pUntilBtn', 'pUntilClear',
        'remindAtRow', 'pRemindDate', 'pRemindTime',
        'pReminder', 'attList', 'attAdd', 'dropzone', 'panelFoot',
        'pMdMount', 'pLinks',
        'attCount', 'attOrganize', 'attNewFolder',
        'pDone', 'pIsEvent',
        'orgOut', 'orgStatus', 'orgStop', 'orgBody', 'orgWarn', 'orgActs', 'orgCancel', 'orgApply',
        'orgWishRow', 'orgWish', 'orgGo', 'orgWishCancel',
      ].forEach((id) => { el[id] = document.getElementById(id); });

      el.pDelete.addEventListener('click', onDelete);

      // 요일 선택기
      el.wdPicker.replaceChildren(...DOW.map((d, i) => {
        const b = document.createElement('button');
        b.textContent = d;
        b.dataset.wd = wdValue(i);
        b.addEventListener('click', () => { b.classList.toggle('on'); commitRepeat(); });
        return b;
      }));

      el.pTitle.addEventListener('input', debounce(() => {
        commit({ title: el.pTitle.value });
        Nav.touch();
      }, 250));
      el.pFolder.addEventListener('change', () => {
        commit({ folder: el.pFolder.value });
        if (global.Files) Files.render();
      });
      el.pDateBtn.addEventListener('click', () => {
        Picker.openCalendar(el.pDateBtn, cur ? cur.date : Recur.todayISO(), (iso) => setDate(iso));
      });
      el.pDatePrev.addEventListener('click', () => cur && setDate(Recur.addDays(cur.date, -1)));
      el.pDateNext.addEventListener('click', () => cur && setDate(Recur.addDays(cur.date, 1)));

      el.repeatSummary.addEventListener('click', () => {
        el.repeatBox.hidden = !el.repeatBox.hidden;
        el.repeatSummary.classList.toggle('on', !el.repeatBox.hidden);
      });
      el.pUntilBtn.addEventListener('click', () => {
        const now = (cur && cur.repeat && cur.repeat.until) || Recur.addDays(cur.date, 30);
        Picker.openCalendar(el.pUntilBtn, now, (iso) => {
          el.pUntilBtn.dataset.iso = iso;
          el.pUntilBtn.textContent = Picker.label(iso);
          commitRepeat();
        });
      });
      el.pUntilClear.addEventListener('click', () => {
        el.pUntilBtn.dataset.iso = '';
        el.pUntilBtn.textContent = '없음';
        commitRepeat();
      });

      el.pRemindDate.addEventListener('click', () => {
        const now = el.pRemindDate.dataset.iso || (cur ? cur.date : Recur.todayISO());
        Picker.openCalendar(el.pRemindDate, now, (iso) => {
          el.pRemindDate.dataset.iso = iso;
          el.pRemindDate.textContent = Picker.label(iso);
          commitRemind();
        });
      });
      el.pRemindTime.addEventListener('blur', commitRemind);
      el.pRemindTime.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el.pRemindTime.blur(); }
      });
      el.pReminder.addEventListener('change', onReminderPick);
      el.pDone.addEventListener('change', () => {
        if (filling || !cur) return;
        Store.setDone(cur, curOcc, el.pDone.checked);
        cur = Store.get(cur.id);
        Cal.render();
        Side.renderDeadlines();
      });
      el.pIsEvent.addEventListener('change', () => {
        commit({ kind: el.pIsEvent.checked ? 'event' : 'deadline' });
        el.pDone.parentElement.hidden = el.pIsEvent.checked;
        Side.renderDeadlines();
        if (global.Files) Files.render();
      });
      el.pRepeat.addEventListener('change', commitRepeat);

      // ── 메모 칸 ── 마크다운·수식·코드·체크리스트·AI 정리를 한 덩어리로 쓴다
      mdbox = MdBox.create(el.pMdMount, {
        label: '메모',
        get: () => (cur ? cur.body : ''),
        set: (text) => {
          if (!cur) return;
          Store.update(cur.id, { body: text });
          cur = Store.get(cur.id);
          Nav.touch();
        },
        onPaste,
        keepEditWithin: el.panel,
      });

      // ── 이 마감에 딸린 링크 ──
      linkBox = Links.section(el.pLinks, '');

      // ── 첨부 ──
      el.attAdd.addEventListener('click', pickAndAdd);
      if (global.IS_WEB) el.attAdd.textContent = '파일 올리기';
      el.attNewFolder.addEventListener('click', newFolder);
      // AI 정리는 먼저 "어떻게 나눌까" 를 물어본다. 비워두면 알아서 나눈다.
      el.attOrganize.addEventListener('click', () => {
        if (!cur || (cur.attachments || []).length < 2) {
          App.toast('나눌 파일이 두 개는 있어야 합니다.');
          return;
        }
        el.orgWishRow.hidden = false;
        el.orgWish.value = '';
        el.orgWish.focus();
      });
      el.orgWishCancel.addEventListener('click', () => { el.orgWishRow.hidden = true; });
      el.orgGo.addEventListener('click', () => { el.orgWishRow.hidden = true; runOrganize(el.orgWish.value.trim()); });
      el.orgWish.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el.orgGo.click(); }
        else if (e.key === 'Escape') { e.stopPropagation(); el.orgWishRow.hidden = true; }
      });
      el.orgStop.addEventListener('click', () => { orgAbort = true; });
      el.orgCancel.addEventListener('click', closeOrg);
      el.orgApply.addEventListener('click', applyOrganize);

      // 나무의 빈 자리에 놓으면 폴더 밖(맨 위)으로 뺀다
      el.attList.addEventListener('dragover', (e) => {
        if (!isAttDrag(e) || e.target.closest('.att-folder')) return;
        e.preventDefault();
      });
      el.attList.addEventListener('drop', (e) => {
        if (!isAttDrag(e) || e.target.closest('.att-folder')) return;
        e.preventDefault();
        e.stopPropagation();
        moveAttachment(e.dataTransfer.getData('text/x-att'), '');
      });

      // 컴퓨터에서 끌어온 파일은 마감 화면 어디에 놓아도 붙는다.
      // 놓을 자리를 패널 전체로 넓혔으니 알림 칸도 그동안 함께 밝힌다.
      let hotDepth = 0;
      el.panel.addEventListener('dragenter', (e) => {
        if (!isOsDrag(e)) return;
        hotDepth++;
        el.dropzone.classList.add('hot');
      });
      el.panel.addEventListener('dragleave', (e) => {
        if (!isOsDrag(e)) return;
        if (--hotDepth <= 0) { hotDepth = 0; el.dropzone.classList.remove('hot'); }
      });
      el.panel.addEventListener('dragover', (e) => {
        if (!isOsDrag(e)) return;
        e.preventDefault();
      });
      el.panel.addEventListener('drop', (e) => { hotDepth = 0; onDrop(e); });

      // 이 화면을 탭에 등록한다 — 탭 이름은 마감 제목을 따라간다.
      Nav.register('event', {
        el: el.panel,
        live: true,          // 손으로 고치는 화면이라 데이터가 바뀌어도 스스로 다시 그리지 않는다
        title: (r) => {
          const ev = Store.get(r.id);
          return ev ? (ev.title.trim() || '제목 없음') : '마감';
        },
        show: (r) => mount(r.id, r.date),
        leave: unmount,
      });
    },

    // 이 마감 화면으로 넘어간다.
    open(ev, occDate, isNew) {
      if (!ev) return;
      pendingFocus = !!isNew;
      Nav.go({ v: 'event', id: ev.id, date: occDate || ev.date });
    },

    close() { Nav.backOr({ v: 'home' }); },

    // 외부에서 데이터가 바뀌었을 때 화면만 다시 채운다.
    refresh(id) {
      if (id) {
        const ev = Store.get(id);
        if (ev) { cur = ev; curOcc = ev.date; }
      }
      if (cur && Store.get(cur.id)) { cur = Store.get(cur.id); fill(); }
    },

    isOpen() { const r = Nav.current; return !!(r && r.v === 'event'); },
    isEditing() { return !!(mdbox && mdbox.isEditing()); },
    // AI 결과를 아직 적용/버리지 않은 동안에는 화면을 다시 그리지 않는다.
    isBusy() { return MdBox.busy() || !!org; },

    mount,
    unmount,
  };

  // ──────────────────── 탭이 이 화면을 켜고 끌 때 ────────────────────

  function mount(id, occ) {
    const ev = Store.get(id);
    if (!ev) { Nav.replace({ v: 'home' }); return; }
    if (!cur || cur.id !== id) {
      if (mdbox) mdbox.closeAi();
      closeOrg();
      collapsed.clear();
    }
    cur = ev;
    curOcc = occ || ev.date;
    fill();
    if (linkBox) linkBox.setOwner(id);
    if (pendingFocus) {
      pendingFocus = false;
      setTimeout(() => { el.pTitle.focus(); el.pTitle.select(); }, 30);
    }
  }

  // 이 화면을 떠날 때 — 편집을 저장하고, 아무것도 안 적은 빈 마감은 치운다.
  function unmount() {
    if (mdbox) { if (mdbox.isEditing()) mdbox.leaveEdit(); mdbox.closeAi(); }
    closeOrg();
    if (cur && !cur.title.trim() && !cur.body.trim()
        && !(cur.attachments || []).length && !Store.linksOf(cur.id).length) {
      Store.remove(cur.id);
      Cal.render();
    }
    cur = null;
    curOcc = null;
  }

  // ────────────────────────────── 채우기 ──────────────────────────────

  function fill() {
    filling = true;
    const ev = cur;
    el.pTitle.value = ev.title;
    el.pDateBtn.textContent = Picker.label(ev.date);
    fillFolders(ev.folder || '');
    el.pIsEvent.checked = !Store.isDeadline(ev);
    paintReminder();
    el.pDone.checked = Store.isDone(ev, curOcc);
    el.pDone.parentElement.hidden = el.pIsEvent.checked;
    paintColors(ev.color);

    const rep = ev.repeat;
    el.pRepeat.value = rep ? rep.freq : 'none';
    el.wdPicker.hidden = !(rep && rep.freq === 'weekly');
    el.untilRow.hidden = !rep;
    el.pUntilBtn.dataset.iso = (rep && rep.until) || '';
    el.pUntilBtn.textContent = rep && rep.until ? Picker.label(rep.until) : '없음';
    for (const b of el.wdPicker.children) {
      b.classList.toggle('on', !!(rep && rep.weekdays && rep.weekdays.includes(Number(b.dataset.wd))));
    }
    // 반복이 없으면 접어 둔다 — 평소에 볼 일이 없는 설정이다.
    el.repeatBox.hidden = !rep;
    el.repeatSummary.classList.toggle('on', !!rep);
    el.repeatSummary.textContent = repeatText(rep);

    if (mdbox) mdbox.render();

    renderAttachments();
    renderFoot();
    filling = false;
  }

  // 어느 폴더에 둘지 — 파일 화면의 폴더 목록을 그대로 쓴다.
  function fillFolders(cur) {
    const opts = [new Option('서랍 (맨 위)', '')];
    for (const f of Store.folders) opts.push(new Option(f, f));
    el.pFolder.replaceChildren(...opts);
    el.pFolder.value = Store.folders.includes(cur) ? cur : '';
  }

  function paintColors(hex) {
    el.pColorDot.style.background = hex;
  }

  function renderFoot() {
    const ev = cur;
    const bits = [];
    if (Store.isRepeating(ev)) {
      const r = ev.repeat;
      const freq = { daily: '매일', weekly: '매주', monthly: '매월', yearly: '매년' }[r.freq];
      const wd = r.freq === 'weekly' && r.weekdays.length
        ? ' ' + r.weekdays.map(wdLabel).join('·') + '요일' : '';
      bits.push('↻ ' + freq + wd + (r.until ? ' · ' + r.until + '까지' : ''));
    }
    el.panelFoot.replaceChildren();
    if (bits.length) {
      const s = document.createElement('div');
      s.textContent = bits.join('  ');
      el.panelFoot.appendChild(s);

      const btn = document.createElement('button');
      btn.className = 'btn-ghost sm';
      btn.style.marginTop = '8px';
      btn.textContent = '이 날짜(' + curOcc + ')만 따로 편집';
      btn.addEventListener('click', () => {
        const made = Store.detachOne(cur, curOcc, {});
        Cal.render();
        Detail.open(made, made.date);
        App.toast('이 날짜를 반복에서 떼어냈습니다.');
      });
      el.panelFoot.appendChild(btn);
    }
  }

  // ──────────────── 날짜 · 시간 · 알림 · 반복 고르기 ────────────────

  function setDate(iso) {
    if (!cur || !iso) return;
    commit({ date: iso });
    curOcc = iso;
    el.pDateBtn.textContent = Picker.label(iso);
    if (!el.remindAtRow.hidden) paintReminder();
  }


  // 알림 목록은 종일이냐 아니냐에 따라 다르게 만든다.
  // 종일 마감에 "10분 전"은 뜻이 없어서 날짜 단위로 바꾼다.
  function reminderOptions(allDay) {
    return true
      ? [['', '알림 없음'], ['0', '당일 아침 9시'], ['1440', '하루 전 9시'],
        ['2880', '이틀 전 9시'], ['10080', '일주일 전 9시'], ['custom', '시각 직접 지정…']]
      : [['', '알림 없음'], ['0', '시작 시각'], ['5', '5분 전'], ['10', '10분 전'],
        ['30', '30분 전'], ['60', '1시간 전'], ['1440', '하루 전'],
        ['custom', '시각 직접 지정…']];
  }

  function paintReminder() {
    const ev = cur;
    const opts = reminderOptions(ev.allDay);
    el.pReminder.replaceChildren(...opts.map(([v, t]) => new Option(t, v)));

    if (ev.reminderAt) {
      el.pReminder.value = 'custom';
      el.remindAtRow.hidden = false;
      const [d, t] = ev.reminderAt.split(' ');
      el.pRemindDate.dataset.iso = d;
      el.pRemindDate.textContent = Picker.label(d);
      el.pRemindTime.value = t;
    } else {
      const v = ev.reminder === null ? '' : String(ev.reminder);
      el.pReminder.value = opts.some(([o]) => o === v) ? v : '';
      el.remindAtRow.hidden = true;
    }
  }

  // 자주 쓰는 알림 시각 — 누르면 그 날짜/시각으로 바로 잡힌다.

  function onReminderPick() {
    if (filling || !cur) return;
    const v = el.pReminder.value;
    if (v === 'custom') {
      el.remindAtRow.hidden = false;
      if (!el.pRemindDate.dataset.iso) {
        const d = Recur.addDays(cur.date, -1);
        el.pRemindDate.dataset.iso = d;
        el.pRemindDate.textContent = Picker.label(d);
        el.pRemindTime.value = '21:00';
      }
      commitRemind();
      return;
    }
    el.remindAtRow.hidden = true;
    commit({ reminder: v === '' ? null : Number(v), reminderAt: null });
  }

  function commitRemind() {
    if (filling || !cur) return;
    const d = el.pRemindDate.dataset.iso;
    const t = Picker.parseTime(el.pRemindTime.value);
    if (t) el.pRemindTime.value = t;
    if (!d || !t) return;
    commit({ reminderAt: d + ' ' + t, reminder: null });
  }

  function repeatText(rep) {
    if (!rep) return '반복 안 함';
    const freq = { daily: '매일', weekly: '매주', monthly: '매월', yearly: '매년' }[rep.freq] || '반복';
    const wd = rep.freq === 'weekly' && rep.weekdays.length
      ? ' ' + rep.weekdays.map(wdLabel).join('·') : '';
    return freq + wd + (rep.until ? ' · ' + rep.until.slice(5) + '까지' : '');
  }

  // ────────────────────────────── 편집 반영 ──────────────────────────────

  function commit(patch) {
    if (filling || !cur) return;
    Store.update(cur.id, patch);
    cur = Store.get(cur.id);
    Cal.render();
    if (global.Side) Side.renderDeadlines();
    if (patch.date) curOcc = cur.date;
  }

  function commitRepeat() {
    if (filling || !cur) return;
    const freq = el.pRepeat.value;
    el.wdPicker.hidden = freq !== 'weekly';
    el.untilRow.hidden = freq === 'none';
    if (freq === 'none') {
      commit({ repeat: null });
      el.untilRow.hidden = true;
      el.repeatSummary.textContent = repeatText(null);
      el.repeatSummary.classList.remove('on');
      renderFoot();
      return;
    }
    el.untilRow.hidden = false;
    const weekdays = Array.from(el.wdPicker.children)
      .filter((b) => b.classList.contains('on')).map((b) => Number(b.dataset.wd));
    commit({ repeat: { freq, weekdays, until: el.pUntilBtn.dataset.iso || null, interval: 1 } });
    fillRepeatUI();
    el.repeatSummary.textContent = repeatText(cur.repeat);
    el.repeatSummary.classList.toggle('on', !!cur.repeat);
    renderFoot();
  }

  function fillRepeatUI() {
    const r = cur.repeat;
    if (!r) return;
    filling = true;
    for (const b of el.wdPicker.children) {
      b.classList.toggle('on', r.weekdays.includes(Number(b.dataset.wd)));
    }
    filling = false;
  }

  function onDelete() {
    const ev = cur;
    if (!ev) return;
    if (Store.isRepeating(ev)) {
      App.ask('반복 일정 삭제', '"' + (ev.title || '제목 없음') + '" 은(는) 반복 일정입니다.', [
        { label: '이 날짜만', primary: true, value: 'one' },
        { label: '이후 모두', value: 'after' },
        { label: '전체 삭제', value: 'all', danger: true },
        { label: '취소', value: null },
      ]).then((c) => {
        if (c === 'one') Store.excludeOne(ev, curOcc);
        else if (c === 'after') Store.truncateFrom(ev, curOcc);
        else if (c === 'all') Store.remove(ev.id);
        else return;
        cur = null;
        Cal.render();
        Nav.backOr({ v: 'home' });
        App.toast('삭제했습니다.');
      });
      return;
    }
    App.ask('일정 삭제', '"' + (ev.title || '제목 없음') + '" 을(를) 삭제할까요?', [
      { label: '삭제', primary: true, danger: true, value: 'yes' },
      { label: '취소', value: null },
    ]).then((c) => {
      if (c !== 'yes') return;
      for (const l of Store.linksOf(ev.id)) Store.removeLink(l.id);
      Store.remove(ev.id);
      cur = null;
      Cal.render();
      Nav.backOr({ v: 'home' });
      App.toast('삭제했습니다.');
    });
  }

  // ────────────────────────────── 첨부 ──────────────────────────────

  // ── 폴더 나무 ──
  // 폴더 목록은 앱 전체가 함께 쓴다(Store.folders). 여기서는 이 일정의 파일만
  // 그 나무 위에 얹어 보여 준다. 디스크의 파일은 어디로도 움직이지 않는다.

  const collapsed = new Set();   // 접어 둔 폴더 경로

  function renderAttachments() {
    const ev = cur;
    const list = (ev.attachments || []).map((a) => ({ att: a, ev }));

    Tree.render(el.attList, {
      items: list,
      folders: Store.foldersInUse(ev),   // 이 일정이 실제로 쓰는 폴더만 보인다
      collapsed,
      onToggle: (p) => {
        if (collapsed.has(p)) collapsed.delete(p); else collapsed.add(p);
        renderAttachments();
      },
      onMove: moveAttachment,
      onRename: renameFolder,
      onDissolve: dissolveFolder,
      onDone: setAttDone,
      onInsert: insertRef,
      onRemove: removeAttachment,
    });

    const n = list.length;
    const done = list.filter((x) => x.att.done).length;
    el.attCount.hidden = !n;
    el.attCount.textContent = done + ' / ' + n;
    el.attCount.classList.toggle('done', n > 0 && done === n);
    el.attOrganize.disabled = n < 2;
  }

  function setAttDone(attId, v) {
    if (!cur) return;
    Store.update(cur.id, {
      attachments: (cur.attachments || []).map((a) => (
        a.id === attId ? Object.assign({}, a, { done: !!v }) : a)),
    });
    cur = Store.get(cur.id);
    renderAttachments();
  }

  function moveAttachment(attId, folder) {
    if (!attId || !cur) return;
    Store.addFolder(folder);
    Store.update(cur.id, {
      attachments: (cur.attachments || []).map((a) => (
        a.id === attId ? Object.assign({}, a, { folder }) : a)),
    });
    cur = Store.get(cur.id);
    renderAttachments();
  }

  async function newFolder() {
    const name = await App.prompt('새 폴더',
      '앱 안에서만 쓰는 폴더입니다. 모든 일정이 함께 쓰고, 디스크의 파일은 움직이지 않습니다.', '');
    if (!name) return;
    if (Store.addFolder(name)) renderAttachments();
  }

  async function renameFolder(pathStr) {
    const name = await App.prompt('폴더 이름 바꾸기', null, Tree.leafOf(pathStr));
    if (!name) return;
    const parent = Tree.parentOf(pathStr);
    const next = Store.util.cleanFolder(parent ? parent + '/' + name : name);
    if (!next || next === pathStr) return;
    Store.renameFolderEverywhere(pathStr, next);
    if (cur) cur = Store.get(cur.id);
    renderAttachments();
  }

  // 폴더만 없애고 안의 파일은 한 단계 위로 올린다. 파일은 절대 지우지 않는다.
  function dissolveFolder(pathStr) {
    Store.dissolveFolderEverywhere(pathStr);
    if (cur) cur = Store.get(cur.id);
    renderAttachments();
    App.toast('폴더만 풀었습니다. 파일은 그대로 있습니다.');
  }


  // ── AI 폴더 나누기 ──
  // 모델은 "어느 파일을 어느 폴더에" 만 정한다. 파일 이름은 앱이 대조해서
  // 목록에 없는 이름은 버리고, 언급 안 된 파일은 있던 자리에 그대로 둔다.

  let org = null;         // { plan: Map<attId, folder>, model }
  let orgAbort = false;
  let orgTimer = null;

  function closeOrg() {
    clearInterval(orgTimer);
    orgTimer = null;
    org = null;
    orgAbort = false;
    if (el.orgWishRow) el.orgWishRow.hidden = true;
    if (el.orgOut) {
      el.orgOut.hidden = true;
      el.orgActs.hidden = true;
      el.orgWarn.hidden = true;
      el.orgBody.replaceChildren();
    }
    if (el.attOrganize) el.attOrganize.disabled = false;
  }

  async function runOrganize(wish) {
    if (!cur || org) return;
    const files = (cur.attachments || []).slice();
    if (files.length < 2) { App.toast('나눌 파일이 두 개는 있어야 합니다.'); return; }

    orgAbort = false;
    el.orgOut.hidden = false;
    el.orgActs.hidden = true;
    el.orgWarn.hidden = true;
    el.orgStop.hidden = false;
    el.orgBody.replaceChildren(msgRow(wish ? ' + wish +  대로 나누는 중…' : '파일 이름을 보고 나누는 중…'));
    el.attOrganize.disabled = true;

    const t0 = Date.now();
    const tick = () => {
      el.orgStatus.className = 'ai-status busy';
      el.orgStatus.textContent = files.length + '개'
        + (wish ? ' · "' + wish.slice(0, 20) + '"' : '')
        + ' · ' + Math.round((Date.now() - t0) / 1000) + '초';
    };
    tick();
    clearInterval(orgTimer);
    orgTimer = setInterval(tick, 1000);

    const res = await api.attach.organize(
      files.map((a) => ({ name: a.name, isImage: !!a.isImage })),
      cur.title || '',
      Store.settings.writeModel);

    clearInterval(orgTimer);
    orgTimer = null;
    el.orgStop.hidden = true;
    el.attOrganize.disabled = false;
    if (orgAbort || !cur) { closeOrg(); return; }

    if (!res.ok) {
      el.orgStatus.className = 'ai-status err';
      el.orgStatus.textContent = '실패';
      el.orgBody.replaceChildren(msgRow(res.error));
      return;
    }

    // 이름으로 맞춘다. 같은 이름이 여럿이면 앞에서부터 하나씩 쓴다.
    const byName = new Map();
    for (const a of files) {
      if (!byName.has(a.name)) byName.set(a.name, []);
      byName.get(a.name).push(a);
    }
    const plan = new Map();
    let unknown = 0;
    for (const it of (res.items || [])) {
      const key = String((it && it.file) || '').trim();
      const bucket = byName.get(key);
      if (!bucket || !bucket.length) { if (key) unknown++; continue; }
      plan.set(bucket.shift().id, Store.util.cleanFolder(it.folder));
    }

    const secs = Math.round((Date.now() - t0) / 1000);
    el.orgStatus.className = 'ai-status';
    el.orgStatus.textContent = res.model + ' · ' + secs + '초'
      + (res.fellBack ? ' · ' + res.fellBack + ' 이(가) 없어 대신 씀' : '');

    org = { plan, model: res.model };
    const changed = files.filter((a) => plan.has(a.id) && plan.get(a.id) !== (a.folder || '')).length;
    const notes = [];
    const missed = files.length - plan.size;
    if (missed > 0) notes.push('모델이 <b>' + missed + '개</b>는 언급하지 않았습니다. 그 파일은 있던 자리에 둡니다.');
    if (unknown) notes.push('목록에 없는 이름 <b>' + unknown + '개</b>를 지어냈길래 버렸습니다.');
    if (!changed) notes.push('바뀌는 게 없습니다.');
    if (notes.length) { el.orgWarn.innerHTML = notes.join('<br>'); el.orgWarn.hidden = false; }

    renderOrgPreview();
    el.orgApply.disabled = !changed;
    el.orgActs.hidden = false;
  }

  function msgRow(text) {
    const d = document.createElement('div');
    d.style.cssText = 'font-size:13px;color:var(--text-3);padding:4px 2px';
    d.textContent = text;
    return d;
  }

  function renderOrgPreview() {
    const items = (cur.attachments || []).map((a) => {
      const folder = org.plan.has(a.id) ? org.plan.get(a.id) : (a.folder || '');
      return { att: Object.assign({}, a, { folder, moved: folder !== (a.folder || '') }), ev: cur };
    });
    Tree.render(el.orgBody, { items, readOnly: true });
  }

  function applyOrganize() {
    if (!org || !cur) return;
    const before = (cur.attachments || []).map((a) => ({ id: a.id, folder: a.folder || '' }));

    const next = (cur.attachments || []).map((a) => (
      org.plan.has(a.id) ? Object.assign({}, a, { folder: org.plan.get(a.id) }) : a));
    for (const f of next.map((a) => a.folder).filter(Boolean)) Store.addFolder(f, true);
    Store.saveFolders();

    Store.update(cur.id, { attachments: next });
    cur = Store.get(cur.id);
    closeOrg();
    renderAttachments();

    App.toast('폴더로 나눴습니다. 디스크의 파일은 그대로입니다.', {
      label: '되돌리기',
      fn: () => {
        const back = new Map(before.map((x) => [x.id, x.folder]));
        Store.update(cur.id, {
          attachments: (cur.attachments || []).map((a) => Object.assign({}, a, {
            folder: back.has(a.id) ? back.get(a.id) : (a.folder || ''),
          })),
        });
        cur = Store.get(cur.id);
        renderAttachments();
        App.toast('되돌렸습니다.');
      },
    });
  }

  function insertRef(a) {
    const ref = (a.isImage ? '!' : '') + '[' + a.name + '](att:' + a.id + ')';
    mdbox.insertAt(ref);
    App.toast('메모에 넣었습니다.');
  }

  async function removeAttachment(a) {
    const c = await App.ask('첨부 제거',
      a.mode === 'linked'
        ? '"' + a.name + '" 연결을 끊을까요? 원본 파일은 그대로 남습니다.'
        : '"' + a.name + '" 을(를) 제거할까요? 앱 폴더의 파일은 휴지통으로 갑니다.',
      [{ label: '제거', primary: true, danger: true, value: 'yes' }, { label: '취소', value: null }]);
    if (c !== 'yes') return;
    await api.attach.remove(a.id);
    const next = (cur.attachments || []).filter((x) => x.id !== a.id);
    Store.update(cur.id, { attachments: next });
    cur = Store.get(cur.id);
    renderAttachments();
    App.toast('제거했습니다.');
  }

  async function addPaths(paths) {
    if (!paths || !paths.length || !cur) return;
    App.toast('연결하는 중…');
    const made = await api.attach.add(cur.id, paths);
    await landAttachments(made);
  }

  async function landAttachments(made) {
    if (!cur || !made || !made.length) { App.toast('첨부하지 못했습니다.'); return; }
    // 마감이 든 폴더에 함께 넣어 둔다 — 파일 화면에서 바로 보이도록.
    for (const a of made) a.folder = cur.folder || '';
    Store.update(cur.id, { attachments: (cur.attachments || []).concat(made) });
    cur = Store.get(cur.id);
    await Store.saveNow();
    renderAttachments();
    // 이미지는 바로 메모에서 볼 수 있게 넣어준다.
    const imgs = made.filter((a) => a.isImage);
    if (imgs.length) {
      const refs = imgs.map((a) => '![' + a.name + '](att:' + a.id + ')').join('\n');
      const body = cur.body ? cur.body.replace(/\s*$/, '') + '\n\n' + refs + '\n' : refs + '\n';
      Store.update(cur.id, { body });
      cur = Store.get(cur.id);
      mdbox.refresh();
    }
    if (global.Files) Files.render();
    App.toast(made.length + '개 연결했습니다.' + (global.IS_WEB ? '' : ' 원본은 그 자리에 그대로 있습니다.'));
  }

  async function pickAndAdd() {
    if (!cur) return;
    App.toast('고르는 중…');
    const made = await api.attach.pick(cur.id);
    if (!made || !made.length) return;           // 고르기를 그냥 닫은 것
    await landAttachments(made);
  }

  // 컴퓨터에서 끌어온 파일인지 (앱 안에서 첨부를 옮기는 끌기와 가른다).
  function isOsDrag(e) {
    return !isAttDrag(e) && Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
  }

  async function onDrop(e) {
    if (!isOsDrag(e)) return;          // 폴더 사이를 옮기는 중이면 여기서 다루지 않는다
    e.preventDefault();
    e.stopPropagation();
    el.dropzone.classList.remove('hot');
    if (!cur) return;
    const files = Array.from(e.dataTransfer.files || []);
    const paths = files.map((f) => api.attach.pathOf(f)).filter(Boolean);
    if (paths.length) { await addPaths(paths); return; }
    // 경로가 없는 것(브라우저에서 끌어온 그림 등)은 원본이 없으니 내용을 앱 폴더에 둔다.
    const made = [];
    for (const f of files) {
      const buf = new Uint8Array(await f.arrayBuffer());
      const a = await api.attach.addBuffer(cur.id, f.name, buf);
      if (a) made.push(a);
    }
    await landAttachments(made);
  }

  async function onPaste(e) {
    if (!cur) return;
    const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
    const imgItem = items.find((i) => i.type && i.type.startsWith('image/'));
    if (!imgItem) return;
    e.preventDefault();
    const file = imgItem.getAsFile();
    if (!file) return;
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const name = '붙여넣은 이미지 ' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.' + ext;
    const buf = new Uint8Array(await file.arrayBuffer());
    const a = await api.attach.addBuffer(cur.id, name, buf);
    Store.update(cur.id, { attachments: (cur.attachments || []).concat([a]) });
    cur = Store.get(cur.id);
    await Store.saveNow();
    renderAttachments();
    mdbox.insertAt('![' + a.name + '](att:' + a.id + ')');
    App.toast('이미지를 저장했습니다.');
  }

  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  global.Detail = Detail;
})(window);
