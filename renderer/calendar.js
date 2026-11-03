/* ══════════════════════════════════════════════════════════════════
   달력 — 이 앱의 홈 화면. 월간 한 판과 드래그 앤 드롭.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  // 화면에 보이는 순서는 일요일부터. 데이터의 요일 번호는 1=월 … 7=일 그대로다.
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  // 요일 번호(1~7) → 화면 칸 번호(0=일 … 6=토)
  const col = (iso) => Recur.weekday(iso) % 7;
  const $ = (s) => document.querySelector(s);

  const el = {};
  let openHandler = () => {};
  let popover = null;

  const Cal = {
    view: 'month',
    anchor: Recur.todayISO(),

    init(onOpen) {
      openHandler = onOpen || (() => {});
      el.monthView = $('#monthView');
      el.dowRow = $('#dowRow');
      el.monthGrid = $('#monthGrid');
      el.period = $('#periodLabel');
      el.homeView = $('#homeView');

      el.dowRow.innerHTML = DOW.map((d, i) =>
        '<div class="dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + d + '</div>').join('');

      window.addEventListener('resize', () => { if (this.onScreen()) this.render(); });
      document.addEventListener('pointerdown', (e) => {
        if (popover && !popover.contains(e.target)) closePopover();
      }, true);

      Nav.register('home', {
        el: el.homeView,
        title: () => '달력',
        show: () => { this.render(); if (global.Side) Side.renderDeadlines(); },
      });
    },

    // 지금 홈(달력)을 보고 있는가
    onScreen() { const r = Nav.current; return !!(r && r.v === 'home'); },

    goToday() { this.anchor = Recur.todayISO(); this.render(); },

    step(dir) {
      const d = Recur.fromISO(this.anchor);
      d.setDate(1);
      d.setMonth(d.getMonth() + dir);
      this.anchor = Recur.toISO(d);
      this.render();
    },

    goTo(iso) {
      this.anchor = iso;
      if (this.onScreen()) this.render();
      else updatePeriod();
    },

    render() {
      closePopover();
      if (!el.monthView) return;
      renderMonth();
      updatePeriod();
    },
  };

  // ────────────────────────────── 공통 ──────────────────────────────

  function updatePeriod() {
    if (true) {
      const d = Recur.fromISO(Cal.anchor);
      el.period.innerHTML = (d.getMonth() + 1) + '월 <span class="yr">' + d.getFullYear() + '</span>';
    } else {
      const s = weekStart(Cal.anchor);
      const e = Recur.addDays(s, 6);
      const ds = Recur.fromISO(s);
      const de = Recur.fromISO(e);
      const same = ds.getMonth() === de.getMonth();
      el.period.innerHTML = (ds.getMonth() + 1) + '월 ' + ds.getDate() + '일 – '
        + (same ? '' : (de.getMonth() + 1) + '월 ') + de.getDate() + '일'
        + ' <span class="yr">' + de.getFullYear() + '</span>';
    }
  }

  function weekStart(iso) { return Recur.addDays(iso, -col(iso)); }
  function monthGridStart(iso) {
    const d = Recur.fromISO(iso);
    d.setDate(1);
    const first = Recur.toISO(d);
    return Recur.addDays(first, -col(first));
  }

  function dayNoteText(occ) {
    return [occ.startTime && (occ.startTime + (occ.endTime ? '–' + occ.endTime : '')),
      occ.location].filter(Boolean).join(' · ');
  }

  // ────────────────────────────── 월간 뷰 ──────────────────────────────

  function renderMonth() {
    const start = monthGridStart(Cal.anchor);
    const end = Recur.addDays(start, 41);
    const today = Recur.todayISO();
    const curMonth = Recur.fromISO(Cal.anchor).getMonth();

    const byDay = new Map();
    for (const occ of Store.inRange(start, end)) {
      if (!byDay.has(occ.date)) byDay.set(occ.date, []);
      byDay.get(occ.date).push(occ);
    }

    const frag = document.createDocumentFragment();
    for (let i = 0; i < 42; i++) {
      const iso = Recur.addDays(start, i);
      const d = Recur.fromISO(iso);
      const wd = Recur.weekday(iso);

      const cell = document.createElement('div');
      cell.className = 'day'
        + (d.getMonth() === curMonth ? '' : ' out')
        + (iso === today ? ' today' : '')
        + (wd === 6 ? ' sat' : wd === 7 ? ' sun' : '');
      cell.dataset.date = iso;

      const num = document.createElement('button');
      num.className = 'day-num';
      num.textContent = (d.getDate() === 1)
        ? (d.getMonth() + 1) + '월 1일' : d.getDate();
      if (d.getDate() === 1) num.style.width = 'auto', num.style.padding = '0 8px';
      num.addEventListener('click', (e) => { e.stopPropagation(); showDayPopover(iso, num); });
      cell.appendChild(num);

      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const occ of (byDay.get(iso) || [])) chips.appendChild(makeChip(occ));
      cell.appendChild(chips);

      cell.addEventListener('dblclick', (e) => {
        if (e.target.closest('.chip') || e.target.closest('.day-num')) return;
        openHandler(Store.create({ date: iso, allDay: true }), iso, true);
      });

      frag.appendChild(cell);
    }

    el.monthGrid.replaceChildren(frag);
    requestAnimationFrame(trimChips);
  }

  function makeChip(occ) {
    const done = Store.isDeadline(occ) && Store.isDone(Store.get(occ.id), occ.date);
    const chip = document.createElement('div');
    chip.className = 'chip' + (occ.isRepeat ? ' repeat' : '') + (done ? ' done' : '');
    chip.dataset.id = occ.id;
    chip.dataset.date = occ.date;
    chip.title = (occ.title || '(제목 없음)') + (dayNoteText(occ) ? '\n' + dayNoteText(occ) : '');

    const dot = document.createElement('span');
    dot.className = 'cdot';
    dot.style.background = occ.color;
    chip.appendChild(dot);

    const title = document.createElement('span');
    title.className = 'ctitle';
    title.textContent = occ.title || '(제목 없음)';
    chip.appendChild(title);

    attachMonthDrag(chip, occ);
    return chip;
  }

  // 칸 높이에 맞춰 넘치는 일정은 "+N개"로 접는다.
  function trimChips() {
    for (const cell of el.monthGrid.children) {
      const box = cell.querySelector('.chips');
      const items = Array.from(box.children).filter((c) => c.classList.contains('chip'));
      const old = box.querySelector('.more');
      if (old) old.remove();
      items.forEach((c) => { c.hidden = false; });

      const avail = box.clientHeight;
      if (!avail || !items.length) continue;
      // 실제로 그려진 칩 높이를 재서 계산한다. n개는 n*h + (n-1)*gap 만큼 쓴다.
      const gap = 2;
      const h = items[0].getBoundingClientRect().height || 21;
      let fit = Math.floor((avail + gap) / (h + gap));
      if (items.length > fit) {
        fit = Math.max(1, fit - 1);           // "+N개" 자리를 비우되 최소 하나는 보여준다
        const hidden = items.length - fit;
        items.slice(fit).forEach((c) => { c.hidden = true; });
        const more = document.createElement('button');
        more.className = 'more';
        more.textContent = '+' + hidden + '개';
        more.addEventListener('click', (e) => {
          e.stopPropagation();
          showDayPopover(cell.dataset.date, more);
        });
        box.appendChild(more);
      }
    }
  }

  // ── 하루치 목록 팝오버 ──
  function closePopover() {
    if (popover) { popover.remove(); popover = null; }
  }

  function showDayPopover(iso, anchorEl) {
    closePopover();
    const list = Store.inRange(iso, iso);
    const d = Recur.fromISO(iso);

    const box = document.createElement('div');
    box.className = 'modal-card';
    box.style.cssText = 'position:fixed;z-index:70;width:260px;padding:12px;max-height:60vh;overflow:auto;';
    box.innerHTML = '<div style="text-align:center;margin-bottom:8px">'
      + '<div style="font-size:11px;color:#5f6368;letter-spacing:.8px">' + DOW[col(iso)] + '</div>'
      + '<div style="font-size:24px;color:#3c4043">' + d.getDate() + '</div></div>';

    const ul = document.createElement('div');
    ul.style.cssText = 'display:flex;flex-direction:column;gap:2px';
    if (!list.length) {
      ul.innerHTML = '<div style="text-align:center;color:#80868b;font-size:13px;padding:8px 0">일정 없음</div>';
    }
    for (const occ of list) {
      const c = makeChip(occ);
      c.style.height = '24px';
      ul.appendChild(c);
    }
    box.appendChild(ul);

    const add = document.createElement('button');
    add.className = 'btn-ghost sm';
    add.style.cssText = 'width:100%;margin-top:10px';
    add.textContent = '＋ 이 날에 일정 추가';
    add.addEventListener('click', () => {
      closePopover();
      openHandler(Store.create({ date: iso, allDay: true }), iso, true);
    });
    box.appendChild(add);

    document.body.appendChild(box);
    const r = anchorEl.getBoundingClientRect();
    const bw = box.offsetWidth, bh = box.offsetHeight;
    box.style.left = Math.min(Math.max(8, r.left - 20), innerWidth - bw - 8) + 'px';
    box.style.top = Math.min(Math.max(8, r.top - 8), innerHeight - bh - 8) + 'px';
    popover = box;
  }

  // ── 월간 드래그: 날짜 이동 ──
  function attachMonthDrag(chip, occ) {
    chip.addEventListener('pointerdown', (down) => {
      if (down.button !== 0) return;
      down.stopPropagation();
      let dragging = false;
      let ghost = null;
      let lastCell = null;

      const move = (e) => {
        if (!dragging) {
          if (Math.abs(e.clientX - down.clientX) + Math.abs(e.clientY - down.clientY) < 5) return;
          dragging = true;
          closePopover();
          chip.classList.add('dragging');
          ghost = document.createElement('div');
          ghost.className = 'drag-ghost';
          ghost.style.background = occ.color;
          ghost.textContent = occ.title || '(제목 없음)';
          document.body.appendChild(ghost);
        }
        ghost.style.left = (e.clientX + 10) + 'px';
        ghost.style.top = (e.clientY - 10) + 'px';

        const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.day');
        if (cell !== lastCell) {
          if (lastCell) lastCell.classList.remove('drop-target');
          lastCell = cell;
          if (cell) cell.classList.add('drop-target');
        }
      };

      const up = (e) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        chip.classList.remove('dragging');
        if (ghost) ghost.remove();
        if (lastCell) lastCell.classList.remove('drop-target');

        if (!dragging) { openHandler(Store.get(occ.id), occ.date); return; }
        const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.day');
        if (!cell || cell.dataset.date === occ.date) return;
        moveOccurrence(occ, { date: cell.dataset.date });
      };

      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  // 반복 일정이면 "이 일정만 / 이후 전부"를 물어본 뒤 옮긴다.
  function moveOccurrence(occ, patch) {
    const ev = Store.get(occ.id);
    if (!ev) return;

    if (!Store.isRepeating(ev)) {
      Store.update(ev.id, patch);
      Cal.render();
      global.App && App.refreshPanel(ev.id);
      return;
    }

    global.App.ask('반복 일정 옮기기', '이 일정은 반복됩니다. 어디까지 바꿀까요?', [
      { label: '이 일정만', primary: true, value: 'one' },
      { label: '이후 모두', value: 'after' },
      { label: '취소', value: null },
    ]).then((choice) => {
      if (choice === 'one') {
        const made = Store.detachOne(ev, occ.date, patch);
        Cal.render();
        global.App.refreshPanel(made.id);
      } else if (choice === 'after') {
        const made = Store.splitFrom(ev, occ.date, patch);
        Cal.render();
        global.App.refreshPanel(made && made.id);
      }
    });
  }

  global.Cal = Cal;
})(window);
