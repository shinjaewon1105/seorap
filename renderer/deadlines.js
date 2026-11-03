/* ══════════════════════════════════════════════════════════════════
   마감 목록 — 홈(달력) 옆에 늘 떠 있다. 가까운 순으로 D-N 이 붙는다.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const el = {};
  let showDone = false;
  let onOpen = () => {};

  // ────────────────────────── 마감 목록 ──────────────────────────

  function dday(left) {
    if (left === 0) return { text: 'D-DAY', cls: 'today' };
    if (left < 0) return { text: '+' + (-left) + '일', cls: 'over' };
    if (left <= 3) return { text: 'D-' + left, cls: 'soon' };
    return { text: 'D-' + left, cls: '' };
  }

  function groupOf(o) {
    if (o.done) return '끝냄';
    if (o.left < 0) return '지났음';
    if (o.left === 0) return '오늘';
    if (o.left <= 7) return '이번 주';
    if (o.left <= 30) return '이번 달';
    return '나중에';
  }

  const ORDER = ['지났음', '오늘', '이번 주', '이번 달', '나중에', '끝냄'];

  function renderDeadlines() {
    const all = Store.deadlines();
    const list = showDone ? all : all.filter((o) => !o.done);

    const left = all.filter((o) => !o.done).length;
    el.dlCount.hidden = !all.length;
    el.dlCount.textContent = left ? left + '개 남음' : '다 끝냄';
    el.dlCount.classList.toggle('done', all.length > 0 && left === 0);
    el.dlToggleDone.classList.toggle('on', showDone);

    if (!list.length) {
      el.dlList.replaceChildren(node('div', 'dl-empty',
        all.length ? '남은 마감이 없습니다.'
          : (api.ollama ? '아직 마감이 없습니다.\n위 입력줄에 적어보세요.'
            : '아직 마감이 없습니다.\n＋ 를 눌러 만들어 보세요.')));
      return;
    }

    const rows = [];
    let group = null;
    for (const o of list) {
      const g = groupOf(o);
      if (g !== group) {
        group = g;
        rows.push(node('div', 'dl-group', g));
      }
      rows.push(dlRow(o));
    }
    el.dlList.replaceChildren(...rows);
  }

  function dlRow(o) {
    const row = document.createElement('div');
    row.className = 'dl' + (o.done ? ' done' : '');

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = o.done;
    chk.title = o.done ? '아직 안 끝남으로' : '끝냄으로';
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', () => {
      Store.setDone(Store.get(o.id), o.date, chk.checked);
      refreshAll();
    });
    row.appendChild(chk);

    const main = document.createElement('div');
    main.className = 'dl-main';
    const t = document.createElement('div');
    t.className = 'dl-title-txt';
    t.textContent = o.title || '(제목 없음)';
    main.appendChild(t);

    const sub = document.createElement('div');
    sub.className = 'dl-sub';
    const dot = document.createElement('span');
    dot.className = 'dl-dot';
    dot.style.background = o.color;
    sub.appendChild(dot);
    const when = o.date.slice(5).replace('-', '/') + (o.isRepeat ? ' ↻' : '');
    sub.appendChild(document.createTextNode(when));
    main.appendChild(sub);
    row.appendChild(main);

    const ev0 = Store.get(o.id);
    if (ev0) {
      const chips = [];
      const st = MD.taskStats(ev0.body || '');
      if (st.total) chips.push({ t: '☑ ' + st.done + '/' + st.total, done: st.done === st.total });
      const na = (ev0.attachments || []).length;
      if (na) chips.push({ t: '📎 ' + na });
      const nl = Store.linksOf(ev0.id).length;
      if (nl) chips.push({ t: '🔗 ' + nl });
      for (const c of chips) {
        const b = document.createElement('span');
        b.className = 'dl-chip' + (c.done ? ' done' : '');
        b.textContent = c.t;
        sub.appendChild(b);
      }
    }

    const d = dday(o.left);
    const badge = document.createElement('span');
    badge.className = 'dl-dday ' + d.cls;
    badge.textContent = d.text;
    row.appendChild(badge);

    row.addEventListener('click', (e) => {
      const ev = Store.get(o.id);
      if (!ev) return;
      Cal.goTo(o.date);
      onOpen(ev, o.date, { newTab: e.ctrlKey || e.metaKey });
    });
    row.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const ev = Store.get(o.id);
      if (ev) onOpen(ev, o.date, { newTab: true, background: true });
    });
    return row;
  }

  // ────────────────────────── 공통 ──────────────────────────

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    n.className = cls;
    n.textContent = text;
    n.style.whiteSpace = 'pre-line';
    return n;
  }

  function refreshAll() {
    renderDeadlines();
    if (global.Files) Files.render();
    if (Cal.onScreen()) Cal.render();
  }

  const Side = {
    init(openHandler) {
      onOpen = openHandler || (() => {});
      ['dlList', 'dlCount', 'dlToggleDone', 'dlNew',
      ].forEach((id) => { el[id] = document.getElementById(id); });

      showDone = !!Store.settings.showDoneDeadlines;

      el.dlToggleDone.addEventListener('click', () => {
        showDone = !showDone;
        Store.saveSettings({ showDoneDeadlines: showDone });
        renderDeadlines();
      });
      el.dlNew.addEventListener('click', () => {
        const d = Recur.todayISO();
        onOpen(Store.create({ date: d, allDay: true }), d, { isNew: true });
      });
      renderDeadlines();
    },
    renderDeadlines,
    refreshAll,
  };

  global.Side = Side;
})(window);
