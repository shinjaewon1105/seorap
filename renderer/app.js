/* ══════════════════════════════════════════════════════════════════
   앱 조립 — 위 줄, 단축키, 검색, 설정, 토스트/확인창
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  let toastTimer = null;
  let sideTimer = null;

  const App = {
    async init() {
      await Store.init();

      Nav.init();
      // 화면들이 각자 자기를 등록한다.
      Cal.init(openEvent);
      Detail.init();
      Side.init(openEvent);
      Files.init();
      Notes.init();
      Links.init();
      NL.init();
      bindTopbar();
      bindKeys();
      bindSearch();
      bindSettings();
      bindCloud();
      bindIPC();
      bindDrop();

      // 첫 화면은 달력. 알림을 눌러서 열었으면 그 마감을 바로 보여준다.
      const want = new URLSearchParams(location.search).get('open');
      const ev = want ? Store.get(want) : null;
      Nav.go({ v: 'home' });
      if (ev) Detail.open(ev, ev.date);

      // 클라우드는 설정이 있을 때만 깨어난다.
      if (global.Cloud) Cloud.init();
      if (global.AIRelay) AIRelay.init();
      // 클래스룸은 data/classroom.json 이 있는 PC 에서만 돈다.
      if (global.Classroom) Classroom.init();

      // 첫 요청이 느리지 않도록 모델을 미리 올려둔다.
      // (웹에서는 `api.ollama` 가 PC 앱으로 가는 심부름꾼이다 — ai-relay.js)
      if (api.ollama) {
        checkOllama();
        api.ollama.warm(Store.settings.model);
      }

      // AI 를 아예 쓸 수 없는 곳에서는 단추를 감춘다.
      if (!api.ollama) document.body.classList.add('no-ai');
    },

    toast(msg, action) {
      const t = $('#toast');
      t.replaceChildren(document.createTextNode(msg));
      if (action) {
        const b = document.createElement('button');
        b.textContent = action.label;
        b.addEventListener('click', () => { t.hidden = true; action.fn(); });
        t.appendChild(b);
      }
      t.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 3000);
    },

    // buttons: [{ label, value, primary?, danger? }]
    ask(title, text, buttons) {
      return new Promise((resolve) => {
        const modal = $('#askModal');
        $('#askTitle').textContent = title;
        $('#askText').textContent = text;
        const box = $('#askBtns');
        box.replaceChildren();

        const done = (v) => {
          modal.hidden = true;
          document.removeEventListener('keydown', onKey, true);
          resolve(v);
        };
        const onKey = (e) => {
          if (e.key === 'Escape') { e.stopPropagation(); done(null); }
        };

        for (const b of buttons) {
          const btn = document.createElement('button');
          btn.className = 'btn-ghost' + (b.primary ? ' primary' : '') + (b.danger && !b.primary ? ' danger' : '');
          if (b.danger && b.primary) btn.style.cssText = 'background:#d93025;border-color:#d93025';
          btn.textContent = b.label;
          btn.addEventListener('click', () => done(b.value));
          box.appendChild(btn);
        }
        modal.hidden = false;
        document.addEventListener('keydown', onKey, true);
        const first = box.querySelector('.primary') || box.firstChild;
        if (first) first.focus();
      });
    },

    // 한 줄 입력을 받는다 (폴더 이름 등). 취소하면 null.
    prompt(title, label, initial) {
      return new Promise((resolve) => {
        const modal = $('#askModal');
        $('#askTitle').textContent = title;
        const p = $('#askText');
        p.replaceChildren();
        if (label) {
          const l = document.createElement('div');
          l.textContent = label;
          l.style.cssText = 'margin-bottom:10px';
          p.appendChild(l);
        }
        const input = document.createElement('input');
        input.className = 'f-input';
        input.value = initial || '';
        input.style.cssText = 'width:100%;border:1px solid var(--line);background:#fff';
        p.appendChild(input);

        const box = $('#askBtns');
        box.replaceChildren();
        const done = (v) => {
          modal.hidden = true;
          document.removeEventListener('keydown', onKey, true);
          resolve(v);
        };
        const onKey = (e) => {
          if (e.key === 'Escape') { e.stopPropagation(); done(null); }
          else if (e.key === 'Enter' && document.activeElement === input) {
            e.preventDefault();
            done(input.value.trim() || null);
          }
        };
        for (const b of [
          { label: '취소', v: null },
          { label: '확인', v: true, primary: true },
        ]) {
          const btn = document.createElement('button');
          btn.className = 'btn-ghost' + (b.primary ? ' primary' : '');
          btn.textContent = b.label;
          btn.addEventListener('click', () => done(b.v === true ? (input.value.trim() || null) : null));
          box.appendChild(btn);
        }
        modal.hidden = false;
        document.addEventListener('keydown', onKey, true);
        setTimeout(() => { input.focus(); input.select(); }, 20);
      });
    },

    refreshPanel(id) { Detail.refresh(id); },
    openSettings,
  };

  // ────────────────────────────── 상단 바 ──────────────────────────────

  // 마감 하나를 연다. 달력은 세 번째 인자로 true(새로 만든 것)를 넘기기도 한다.
  function openEvent(ev, occDate, opts) {
    const isNew = opts === true || !!(opts && opts.isNew);
    Detail.open(ev, occDate, isNew);
  }

  function bindTopbar() {
    $('#btnToday').addEventListener('click', () => Cal.goToday());
    $('#btnPrev').addEventListener('click', () => Cal.step(-1));
    $('#btnNext').addEventListener('click', () => Cal.step(1));
    $('#btnSearch').addEventListener('click', openSearch);
    $('#btnSettings').addEventListener('click', openSettings);
  }

  // ────────────────────────────── 단축키 ──────────────────────────────

  function typing(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;

      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); Nav.back(); return; }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); Nav.forward && Nav.forward(); return; }

      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); NL.focus(); return; }
      if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearch(); return; }

      if (e.key === 'Escape') {
        if (!$('#searchModal').hidden) { closeSearch(); return; }
        if (!$('#settingsModal').hidden) { $('#settingsModal').hidden = true; return; }
        return;
      }
      if (typing(e) || mod || e.altKey) return;

      const view = (Nav.current || {}).v;
      if (view === 'home') {
        if (e.key === 'ArrowLeft') { e.preventDefault(); Cal.step(-1); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); Cal.step(1); return; }
        if (e.key === 't' || e.key === 'ㅅ') { Cal.goToday(); return; }
      }
      if (e.key === 'n' || e.key === 'ㅜ') {
        if (view === 'note') { Notes.create(); return; }
        if (view === 'files') return;        // 파일 화면은 자기 단축키를 쓴다
        const d = Recur.todayISO();
        openEvent(Store.create({ date: d }), d, true);
      }
    });
  }

  // ────────────────────────────── 검색 ──────────────────────────────

  function openSearch() {
    $('#searchModal').hidden = false;
    const i = $('#searchInput');
    i.value = '';
    $('#searchResults').replaceChildren();
    setTimeout(() => i.focus(), 20);
    runSearch('');
  }
  function closeSearch() { $('#searchModal').hidden = true; }

  function bindSearch() {
    $('#searchClose').addEventListener('click', closeSearch);
    $('#searchModal').addEventListener('click', (e) => {
      if (e.target.id === 'searchModal') closeSearch();
    });
    $('#searchInput').addEventListener('input', (e) => runSearch(e.target.value));
    $('#searchInput').addEventListener('keydown', (e) => {
      const items = Array.from($('#searchResults').children).filter((n) => n.classList.contains('sr'));
      if (!items.length) return;
      let i = items.findIndex((n) => n.classList.contains('sel'));
      if (e.key === 'ArrowDown') { e.preventDefault(); i = Math.min(items.length - 1, i + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); i = Math.max(0, i - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); (items[Math.max(0, i)]).click(); return; }
      else return;
      items.forEach((n) => n.classList.remove('sel'));
      items[i].classList.add('sel');
      items[i].scrollIntoView({ block: 'nearest' });
    });
  }

  // 마감 · 필기 · 링크를 한꺼번에 찾는다.
  function runSearch(q) {
    const box = $('#searchResults');
    const query = q.trim().toLowerCase();
    const hit = (s) => !query || String(s || '').toLowerCase().includes(query);
    const rows = [];

    let evs = Store.events.filter((ev) =>
      hit(ev.title) || hit(ev.location) || hit(MD.plain(ev.body)));
    evs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    for (const ev of evs.slice(0, 40)) {
      const when = ev.date + (ev.allDay ? ' · 종일' : ' · ' + ev.startTime + '–' + ev.endTime)
        + (ev.location ? ' · ' + ev.location : '')
        + (Store.isRepeating(ev) ? ' · ↻ 반복' : '');
      rows.push(srRow({
        kind: '마감', color: ev.color, title: ev.title || '(제목 없음)',
        sub: when, body: MD.plain(ev.body), query,
        go: () => { Cal.goTo(ev.date); Detail.open(Store.get(ev.id), ev.date); },
      }));
    }

    const notes = Store.sortedNotes().filter((n) => hit(n.title) || hit(MD.plain(n.body)));
    for (const n of notes.slice(0, 30)) {
      rows.push(srRow({
        kind: '필기', color: '#f4b400', title: n.title.trim() || '(제목 없음)',
        sub: '필기', body: MD.plain(n.body), query,
        go: () => Nav.go({ v: 'note', id: n.id }),
      }));
    }

    const files = Store.allAttachments().filter((x) => hit(x.att.name));
    for (const x of files.slice(0, 30)) {
      rows.push(srRow({
        kind: '파일', color: '#8e24aa', title: x.att.name,
        sub: (x.att.folder ? x.att.folder + ' · ' : '') + (x.ev.title || '제목 없음'),
        body: '', query,
        go: () => Files.revealAttachment(x.att.id),
      }));
    }

    const links = Store.links.filter((l) => hit(l.title) || hit(l.url) || hit(l.note));
    for (const l of links.slice(0, 30)) {
      rows.push(srRow({
        kind: '링크', color: '#0b8043', title: Store.util.linkLabel(l),
        sub: l.url, body: l.note, query,
        go: () => api.shell.openExternal(l.url),
      }));
    }

    if (!rows.length) {
      box.replaceChildren(node('div', 'sr-empty', query ? '결과가 없습니다.' : '아직 적어 둔 것이 없습니다.'));
      return;
    }
    box.replaceChildren(...rows);
  }

  function srRow(o) {
    const row = document.createElement('div');
    row.className = 'sr';

    const dot = document.createElement('span');
    dot.className = 'sr-dot';
    dot.style.background = o.color;
    dot.title = o.kind;
    row.appendChild(dot);

    const main = document.createElement('div');
    main.className = 'sr-main';
    main.appendChild(mark('sr-title', o.title, o.query));
    main.appendChild(node('div', 'sr-sub', o.kind + ' · ' + o.sub));

    if (o.body) {
      const idx = o.query ? o.body.toLowerCase().indexOf(o.query) : -1;
      const from = idx > 60 ? idx - 50 : 0;
      const snip = (from ? '… ' : '') + o.body.slice(from, from + 160);
      main.appendChild(mark('sr-snip', snip, o.query));
    }
    row.appendChild(main);
    row.addEventListener('click', () => { closeSearch(); o.go(); });
    return row;
  }

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    n.className = cls;
    n.textContent = text;
    return n;
  }

  // 검색어를 강조한 조각을 만든다(문자열 조립 없이 안전하게).
  function mark(cls, text, query) {
    const n = document.createElement('div');
    n.className = cls;
    if (!query) { n.textContent = text; return n; }
    const lower = text.toLowerCase();
    let i = 0;
    let at = lower.indexOf(query);
    while (at !== -1) {
      if (at > i) n.appendChild(document.createTextNode(text.slice(i, at)));
      const m = document.createElement('mark');
      m.textContent = text.slice(at, at + query.length);
      n.appendChild(m);
      i = at + query.length;
      at = lower.indexOf(query, i);
    }
    n.appendChild(document.createTextNode(text.slice(i)));
    return n;
  }

  // ────────────────────────────── 끌어다 놓기 ──────────────────────────────

  /* 컴퓨터에서 끌어온 파일을 받을 자리가 없는 곳에 놓아도 버리지 않는다.
     예전에는 달력 위나 화면 아래 알림 위에 놓으면 아무 일도 없이 사라졌다.
     파일 화면·마감 화면은 자기 자리에서 먼저 받고(preventDefault), 남은 것만 여기로 온다. */
  function bindDrop() {
    const osDrag = (e) => {
      const t = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
      return t.includes('Files') && !t.includes('text/x-item') && !t.includes('text/x-att');
    };
    document.addEventListener('dragover', (e) => { if (osDrag(e)) e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      if (!osDrag(e) || e.defaultPrevented) return;
      e.preventDefault();
      const r = Nav.current || {};
      if (r.v === 'event') return;                   // 마감 화면은 패널이 받는다
      let folder = null;                             // 파일 화면이면 지금 폴더
      if (r.v === 'note') {
        const n = Store.getNote(r.id);
        folder = (n && n.folder) || '';              // 필기가 든 폴더에 함께 둔다
      } else if (r.v !== 'files') folder = '';
      Files.dropOS(e, folder);
    });
  }

  // ────────────────────────────── 설정 ──────────────────────────────

  function openSettings() {
    const m = $('#settingsModal');
    $('#setReminder').value = Store.settings.defaultReminder == null ? '' : String(Store.settings.defaultReminder);
    $('#dataPath').textContent = Store.info.dataDir || '';
    renderFolders();
    if (global.Classroom) Classroom.paint();
    m.hidden = false;
    checkOllama();
  }

  function bindSettings() {
    $('#settingsClose').addEventListener('click', () => { $('#settingsModal').hidden = true; });
    $('#settingsModal').addEventListener('click', (e) => {
      if (e.target.id === 'settingsModal') $('#settingsModal').hidden = true;
    });
    $('#setModel').addEventListener('change', async (e) => {
      await Store.saveSettings({ model: e.target.value });
      api.ollama.warm(e.target.value);
      App.toast(e.target.value + ' 을(를) 씁니다.');
    });
    $('#setReminder').addEventListener('change', (e) =>
      Store.saveSettings({ defaultReminder: e.target.value === '' ? null : Number(e.target.value) }));
    $('#openData').addEventListener('click', () => api.shell.openData());
    $('#addFolder').addEventListener('click', async () => {
      const p = await api.dialog.pickFolder();
      if (!p) return;
      const next = (Store.settings.watchFolders || []).concat([p]);
      await Store.saveSettings({ watchFolders: Array.from(new Set(next)) });
      renderFolders();
    });
  }

  // ────────────────────────────── 클라우드 ──────────────────────────────

  /* ─────────────────────── 클라우드 화면 ───────────────────────
     로그인부터 자료가 맞춰지기까지 문이 셋이다.
       ① 이메일 확인   ② 관리자 승인   ③ 맞추기
     어디서 막혔는지를 화면이 그대로 말해 준다. "그냥 안 됨" 으로 끝내지 않는다.
     ─────────────────────────────────────────────────────────── */

  let cloudMode = 'in';            // 'in' 로그인 · 'up' 가입
  let lastCloudState = '';
  let verifyTimer = null;

  const show = (sel, yes) => { const e = $(sel); if (e) e.hidden = !yes; };

  // 틀렸다고 말하는 자리. 토스트만 띄우면 스쳐 지나가서 못 읽는다.
  function cloudErr(msg, kind) {
    const box = $('#cloudErr');
    if (!box) return;
    box.hidden = !msg;
    box.textContent = msg || '';
    box.className = 'cloud-msg' + (kind === 'ok' ? ' ok' : '');
  }

  function setCloudMode(mode) {
    cloudMode = mode;
    const up = mode === 'up';
    $('#cloudTabIn').classList.toggle('on', !up);
    $('#cloudTabUp').classList.toggle('on', up);
    $('#cloudPass2').hidden = !up;
    $('#cloudPass').autocomplete = up ? 'new-password' : 'current-password';
    $('#cloudPass').placeholder = up ? '비밀번호 (8자 이상)' : '비밀번호';
    $('#cloudSignIn').textContent = up ? '가입하기' : '로그인';
    $('#cloudForgot').hidden = up;
    cloudErr('');
  }

  // 단추가 없어도(사라졌어도) 하려던 일은 해야 한다 — 여기서 죽으면 눌러도 아무 일이 안 난다.
  async function busy(btn, fn) {
    if (!btn) return fn();
    const was = btn.textContent;
    btn.disabled = true;
    btn.textContent = '잠시만요…';
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = was; }
  }

  async function doSignIn() {
    const email = $('#cloudEmail').value.trim();
    const pass = $('#cloudPass').value;
    if (!email || !pass) { cloudErr('이메일과 비밀번호를 적어 주세요.'); return; }

    cloudErr('');
    const res = await busy($('#cloudSignIn'), () => Cloud.signIn(email, pass));
    if (res.ok) { $('#cloudPass').value = ''; return; }

    // 계정이 없는 것이면 가입 쪽으로 데려다준다. 다시 치게 하지 않는다.
    if (res.code && res.code.includes('user-not-found')) {
      setCloudMode('up');
      cloudErr('그 이메일로 만든 계정이 없습니다. 가입해 보세요.');
      return;
    }
    cloudErr(res.error);
  }

  async function doSignUp() {
    const email = $('#cloudEmail').value.trim();
    const pass = $('#cloudPass').value;
    if (!email || !pass) { cloudErr('이메일과 비밀번호를 적어 주세요.'); return; }
    // 파이어베이스는 6자면 받아주지만, 이건 자료 전체를 여는 열쇠다.
    if (pass.length < 8) { cloudErr('비밀번호는 8자 이상으로 해 주세요.'); return; }
    // 한 번 잘못 적으면 영영 못 들어온다. 그래서 두 번 받는다.
    if (pass !== $('#cloudPass2').value) { cloudErr('두 번 적은 비밀번호가 다릅니다.'); return; }

    const ok = await App.ask('이 이메일로 가입할까요?',
      email + '\n\n확인 메일이 이 주소로 갑니다. 비밀번호를 잊어도 이 주소로만 되찾습니다. '
      + '실제로 받을 수 있는 주소여야 합니다.',
      [{ label: '취소', value: false }, { label: '가입', value: true, primary: true }]);
    if (!ok) return;

    cloudErr('');
    const res = await busy($('#cloudSignIn'), () => Cloud.signUp(email, pass));
    if (res.ok) {
      $('#cloudPass').value = '';
      $('#cloudPass2').value = '';
      setCloudMode('in');
      return;                       // 다음 화면(이메일 확인)은 paintCloud 가 띄운다
    }
    if (res.code && res.code.includes('email-already-in-use')) {
      setCloudMode('in');
      cloudErr('이미 그 이메일로 가입돼 있습니다. 로그인해 보세요.');
      return;
    }
    cloudErr(res.error);
  }

  // 확인 링크를 누르고 돌아와도 앱은 모른다. 그래서 주기적으로 물어본다.
  function startVerifyPoll() {
    stopVerifyPoll();
    verifyTimer = setInterval(() => { Cloud.refreshUser().catch(() => {}); }, 5000);
  }

  function stopVerifyPoll() { clearInterval(verifyTimer); verifyTimer = null; }

  function bindCloud() {
    if (!global.Cloud) return;
    Cloud.onChange(paintCloud);
    setCloudMode('in');
    paintCloud();

    $('#cloudTabIn').addEventListener('click', () => setCloudMode('in'));
    $('#cloudTabUp').addEventListener('click', () => setCloudMode('up'));
    $('#cloudSignIn').addEventListener('click', () => (cloudMode === 'up' ? doSignUp() : doSignIn()));

    for (const id of ['#cloudEmail', '#cloudPass', '#cloudPass2']) {
      $(id).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); $('#cloudSignIn').click(); }
      });
      $(id).addEventListener('input', () => cloudErr(''));
    }

    $('#cloudForgot').addEventListener('click', async () => {
      const email = $('#cloudEmail').value.trim();
      if (!email) { cloudErr('먼저 이메일을 적어 주세요.'); return; }
      const res = await busy($('#cloudForgot'), () => Cloud.resetPassword(email));
      cloudErr(res.ok ? email + ' 으로 비밀번호를 다시 정하는 메일을 보냈습니다.' : res.error,
        res.ok ? 'ok' : '');
    });

    // ① 이메일 확인
    $('#cloudVerifyDone').addEventListener('click', async (e) => {
      const done = await busy(e.currentTarget, () => Cloud.refreshUser());
      if (!done) App.toast('아직 확인이 안 됐습니다. 메일함(스팸함도) 링크를 눌러 주세요.');
    });
    $('#cloudVerify').addEventListener('click', async (e) => {
      const res = await busy(e.currentTarget, () => Cloud.sendVerify());
      App.toast(res.ok ? '확인 메일을 다시 보냈습니다.' : res.error);
    });

    // 관리자 정하기 — 처음 한 사람만
    $('#cloudClaim').addEventListener('click', async (e) => {
      // ⚠ 단추를 **await 앞에서** 붙잡아 둔다.
      // 확인 창을 기다리는 사이 이벤트 처리가 끝나 `e.currentTarget` 이 null 이 된다.
      // 그걸 모르고 쓰면 핸들러가 조용히 죽어서 눌러도 아무 일이 안 난다. (실제로 겪었다)
      const btn = e.currentTarget;
      const ok = await App.ask('이 계정을 관리자로 정할까요?',
        Cloud.email + '\n\n관리자는 새로 가입한 사람을 승인해 줍니다.\n'
        + '한 번 정하면 앱에서는 바꿀 수 없습니다.',
        [{ label: '취소', value: false }, { label: '관리자로', value: true, primary: true }]);
      if (!ok) return;
      const res = await busy(btn, () => Cloud.claimAdmin());
      // 실패는 토스트로 흘려보내지 않는다. 읽을 시간을 준다.
      const box = $('#cloudAdminErr');
      box.hidden = !!res.ok;
      box.className = 'cloud-msg';
      box.textContent = res.ok ? '' : res.error;
      if (res.ok) App.toast('관리자로 등록했습니다.');
    });

    for (const id of ['#cloudSignOut', '#cloudOut1', '#cloudOut2', '#cloudOut3']) {
      $(id).addEventListener('click', async () => {
        const ok = await App.ask('로그아웃할까요?',
          '이 기기의 자료는 그대로 남습니다. 다시 로그인하면 이어서 맞춥니다.',
          [{ label: '취소', value: false }, { label: '로그아웃', value: true, primary: true }]);
        if (ok) Cloud.signOut();
      });
    }

    $('#cloudSyncNow').addEventListener('click', async (e) => {
      await busy(e.currentTarget, () => Cloud.syncNow());
      App.toast('다 맞췄습니다.');
    });

    $('#memberRefresh').addEventListener('click', () => paintMembers());
  }

  function paintCloud() {
    const note = $('#cloudNote');
    if (!note) return;
    const st = Cloud.state;

    if (st !== lastCloudState) {
      lastCloudState = st;
      // 로그인하고 나야 PC 앱이 켜져 있는지 알 수 있다.
      if (api.ollama && api.ollama.__relay) setTimeout(checkOllama, 300);
      if (st === 'verify') startVerifyPoll(); else stopVerifyPoll();
      if (st === 'ok') paintMembers();
    }

    paintDiag();
    show('#getAppRow', !!global.IS_WEB);
    show('#cloudForm', st === 'out');
    show('#cloudVerifyBox', st === 'verify');
    show('#cloudAdminBox', st === 'noadmin');
    show('#cloudPendingBox', st === 'pending');
    show('#cloudOn', st === 'ok' || st === 'working' || (st === 'error' && Cloud.signedIn()));
    show('#memberRow', !!(Cloud.isAdmin && Cloud.isAdmin()));

    if (st === 'verify') {
      $('#cloudVerifyText').textContent = Cloud.email
        + ' 으로 확인 메일을 보냈습니다. 메일함(스팸함도 보세요)에서 링크를 누른 뒤'
        + ' ‘확인했어요’ 를 누르시면 됩니다. 누르신 걸 앱이 알아채면 저절로 넘어갑니다.';
    }
    if (st === 'pending') {
      $('#cloudPendingText').textContent = Cloud.email
        + ' 로 신청했습니다. 관리자가 승인하면 이 화면에서 바로 넘어갑니다.'
        + ' 그때까지 이 기기 안에서는 평소대로 쓰실 수 있습니다.';
    }

    note.className = 's-note';
    if (st === 'off') {
      note.textContent = '클라우드가 꺼져 있습니다. renderer/firebase-config.js 에 설정을 넣으면 켜집니다.';
    } else if (st === 'out') {
      note.textContent = '로그인하면 다른 기기와 자료를 맞춥니다. 처음이면 ‘가입’ 을 누르세요.';
    } else if (st === 'verify' || st === 'noadmin' || st === 'pending') {
      note.textContent = '';
      note.hidden = true;
      return;
    } else if (st === 'working') {
      note.textContent = (Cloud.detail || '맞추는 중…') + ' — ' + Cloud.email;
    } else if (st === 'ok') {
      note.className = 's-note ok';
      note.textContent = Cloud.email + (Cloud.isAdmin() ? ' (관리자)' : '')
        + ' 으로 맞추고 있습니다. ' + attLine();
    } else {
      note.className = 's-note bad';
      note.textContent = Cloud.detail || '문제가 있습니다.';
    }
    note.hidden = false;
  }

  /* 어디서 막혔는지 한 줄로 보여 준다.
     막혔을 때 "그냥 안 돼요" 말고 이 줄을 읽어 주시면 바로 짚인다. */
  async function paintDiag() {
    const box = $('#cloudDiag');
    if (!box || !Cloud.diag) return;
    const st = Cloud.state;
    if (st === 'off' || st === 'out') { box.hidden = true; return; }

    const d = await Cloud.diag();
    const mark = (yes) => (yes ? '✓' : '✗');
    const bad = (yes, text) => (yes ? text : '<b>' + text + '</b>');
    box.hidden = false;
    box.innerHTML = [
      '로그인 ' + mark(d.signedIn),
      bad(d.verified, '이메일 확인 ' + mark(d.verified)),
      bad(d.tokenVerified, '인증 표시 ' + mark(d.tokenVerified)),
      '관리자 ' + (d.isAdmin ? '나' : (d.hasAdmin ? '다른 사람' : bad(false, '없음'))),
      bad(d.approved || d.isAdmin, '승인 ' + mark(d.approved || d.isAdmin)),
    ].join(' · ');
  }

  // 관리자만 본다 — 가입 신청 목록
  async function paintMembers() {
    if (!global.Cloud || !Cloud.isAdmin || !Cloud.isAdmin()) return;
    const box = $('#memberList');
    if (!box) return;
    const list = await Cloud.members();
    if (!list.length) {
      box.replaceChildren(node('div', 's-note', '아직 가입 신청이 없습니다.'));
      return;
    }
    box.replaceChildren(...list.map(memberRow));
  }

  function memberRow(m) {
    const row = node('div', 'member-row');
    row.appendChild(node('div', 'member-mail', m.email || m.id));

    const isMe = m.id === Cloud.uid;
    if (isMe) {
      row.appendChild(node('span', 'member-tag me', '나'));
      return row;
    }
    row.appendChild(node('span', 'member-tag ' + (m.approved ? 'ok' : 'wait'),
      m.approved ? '승인됨' : '기다림'));

    const act = document.createElement('button');
    act.className = 'btn-ghost sm' + (m.approved ? '' : ' primary');
    act.textContent = m.approved ? '승인 취소' : '승인';
    act.addEventListener('click', async () => {
      act.disabled = true;
      const ok = await Cloud.setApproved(m.id, !m.approved);
      App.toast(ok ? (m.approved ? '승인을 거뒀습니다.' : '승인했습니다.') : '바꾸지 못했습니다.');
      paintMembers();
    });
    row.appendChild(act);

    const del = document.createElement('button');
    del.className = 'btn-ghost sm danger';
    del.textContent = '지우기';
    del.addEventListener('click', async () => {
      const yes = await App.ask('이 신청을 지울까요?',
        (m.email || m.id) + '\n\n다시 로그인하면 또 신청이 올라옵니다. 계정 자체는 남습니다.',
        [{ label: '취소', value: false }, { label: '지우기', value: true, primary: true }]);
      if (!yes) return;
      await Cloud.removeMember(m.id);
      paintMembers();
    });
    row.appendChild(del);
    return row;
  }

  // 첨부파일이 지금 어디에 담기고 있는지, 못 올린 게 있는지 그대로 적는다.
  function attLine() {
    const a = Cloud.attInfo();
    if (a.mode === 'off') return '첨부파일 내용은 이 기기에만 있습니다.';
    const mb = (n) => (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + 'MB';
    let s = a.mode === 'storage' ? '첨부파일도 올립니다.'
      : '첨부파일은 ' + mb(a.used) + ' / ' + mb(a.cap) + ' 썼습니다.';
    if (a.pending) s += ' ' + a.pending + '개 올리는 중.';
    if (a.skipped) s += ' ' + a.skipped + '개는 너무 커서 못 올립니다(한 개 ' + mb(a.max) + ').';
    return s;
  }

  function renderFolders() {
    const box = $('#folderList');
    const folders = Store.settings.watchFolders || [];
    box.replaceChildren(...folders.map((p) => {
      const row = document.createElement('div');
      row.className = 'folder-item';
      const s = document.createElement('span');
      s.textContent = p;
      s.title = p;
      row.appendChild(s);
      const x = document.createElement('button');
      x.className = 'icon-btn';
      x.title = '빼기';
      x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      x.addEventListener('click', async () => {
        await Store.saveSettings({ watchFolders: folders.filter((f) => f !== p) });
        renderFolders();
      });
      row.appendChild(x);
      return row;
    }));
    if (!folders.length) {
      box.replaceChildren(node('div', 's-note', '감시 중인 폴더가 없습니다.'));
    }
  }

  async function checkOllama() {
    const note = $('#ollamaNote');
    const sel = $('#setModel');
    if (!api.ollama) { note.textContent = '이 기기에서는 쓸 수 없습니다.'; return; }

    // 웹에서는 Llama 가 이 기기에 없다. PC 앱에 부탁해서 쓴다 (ai-relay.js).
    const relay = !!api.ollama.__relay;
    const mine = Store.settings.model || '';
    const keep = () => sel.replaceChildren(new Option(mine || '(PC 앱 설정)', mine, true, true));
    const st = await api.ollama.status();

    if (!st.ok) {
      note.className = 's-note bad';
      note.textContent = relay
        ? 'AI는 내 컴퓨터에서 돕니다. 컴퓨터에 서랍(PC용)을 켜 두고 같은 계정으로 '
          + '로그인해 두면 휴대폰에서도 쓸 수 있습니다. (지금은 ' + st.error + ')'
        : 'Ollama에 연결하지 못했습니다 (' + st.error + '). '
          + '명령 프롬프트에서 ollama serve 가 떠 있는지 확인하세요.';
      keep();
      return;
    }
    if (!st.models.length) {
      note.className = 's-note bad';
      note.textContent = '설치된 모델이 없습니다. ollama pull qwen3.5:4b 를 먼저 실행하세요.';
      keep();
      return;
    }
    note.className = 's-note ok';
    note.textContent = (relay ? 'PC 앱을 거쳐 쓸 수 있습니다' : 'Ollama 연결됨')
      + ' · 모델 ' + st.models.length + '개';
    sel.replaceChildren(...st.models.map((m) =>
      new Option(m, m, m === Store.settings.model, m === Store.settings.model)));
  }

  // ────────────────────────────── 메인 프로세스 신호 ──────────────────────────────

  function bindIPC() {
    api.on('attachments:changed', async () => {
      const openId = Detail.currentId;
      // 편집 중이거나 AI 결과를 보고 있을 때는 화면을 흔들지 않는다
      if (Detail.isEditing() || Detail.isBusy() || Notes.isEditing()) return;
      // 첨부는 마감 안(events)에도, 어느 마감에도 매이지 않은 파일(files)에도 있다.
      // 예전에는 events 만 다시 읽어서, 파일 화면의 파일을 옮기면 화면이 예전 경로를 들고 있다가
      // 다음 저장 때 메인이 다시 찾아 둔 자리를 도로 덮어썼다.
      await Store.reload(['events', 'files']);
      Nav.refresh();
      if (openId) Detail.refresh(openId);
    });

    api.on('open:event', ({ id, date }) => {
      const ev = Store.get(id);
      if (!ev) return;
      Cal.goTo(date || ev.date);
      Detail.open(ev, date || ev.date);
    });

    // 데이터가 바뀌면 지금 보고 있는 화면과 마감 목록을 다시 그린다.
    Store.onChange(() => {
      clearTimeout(sideTimer);
      sideTimer = setTimeout(() => {
        Side.renderDeadlines();
        Nav.softRefresh();
      }, 60);
      if (global.Cloud) Cloud.nudge();
    });
  }

  global.App = App;
  document.addEventListener('DOMContentLoaded', () => App.init());
})(window);
