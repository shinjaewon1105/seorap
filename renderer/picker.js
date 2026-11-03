/* ══════════════════════════════════════════════════════════════════
   날짜 · 시간 고르기
   Windows 기본 날짜 칸은 연/월/일을 칸마다 맞춰야 해서 마감을 자주 옮기는
   이 앱에는 불편하다. 화살표로 하루씩 밀거나 작은 달력에서 고른다.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const col = (iso) => Recur.weekday(iso) % 7;

  let open = null;   // 지금 떠 있는 달력

  function closeCalendar() {
    if (open) { open.remove(); open = null; }
  }

  document.addEventListener('pointerdown', (e) => {
    if (open && !open.contains(e.target) && !e.target.closest('[data-cal-anchor]')) closeCalendar();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) { e.stopPropagation(); closeCalendar(); }
  }, true);

  // 날짜를 "9월 8일 (화)" 로 읽기 좋게
  function label(iso) {
    if (!iso) return '날짜 없음';
    const d = Recur.fromISO(iso);
    const today = Recur.todayISO();
    const diff = Math.round((d - Recur.fromISO(today)) / 86400000);
    const near = diff === 0 ? '오늘' : diff === 1 ? '내일' : diff === -1 ? '어제'
      : diff === 2 ? '모레' : '';
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + DOW[col(iso)] + ')'
      + (near ? '  ' + near : '');
  }

  // 작은 달력을 anchor 아래에 띄운다.
  function openCalendar(anchor, value, onPick) {
    closeCalendar();
    let shown = value || Recur.todayISO();

    const box = document.createElement('div');
    box.className = 'cal-pop';

    const draw = () => {
      const base = Recur.fromISO(shown);
      base.setDate(1);
      const first = Recur.toISO(base);
      const start = Recur.addDays(first, -col(first));
      const today = Recur.todayISO();
      const month = base.getMonth();

      box.replaceChildren();

      const head = document.createElement('div');
      head.className = 'cal-head';
      const prev = mini('‹', () => { shift(-1); });
      const title = document.createElement('span');
      title.className = 'cal-title';
      title.textContent = base.getFullYear() + '년 ' + (month + 1) + '월';
      const next = mini('›', () => { shift(1); });
      head.append(prev, title, next);
      box.appendChild(head);

      const dows = document.createElement('div');
      dows.className = 'cal-dow';
      DOW.forEach((d, i) => {
        const c = document.createElement('span');
        c.textContent = d;
        if (i === 0) c.className = 'sun';
        if (i === 6) c.className = 'sat';
        dows.appendChild(c);
      });
      box.appendChild(dows);

      const grid = document.createElement('div');
      grid.className = 'cal-grid';
      for (let i = 0; i < 42; i++) {
        const iso = Recur.addDays(start, i);
        const dd = Recur.fromISO(iso);
        const b = document.createElement('button');
        b.textContent = dd.getDate();
        b.className = (dd.getMonth() === month ? '' : 'out')
          + (iso === today ? ' today' : '')
          + (iso === value ? ' sel' : '')
          + (col(iso) === 0 ? ' sun' : col(iso) === 6 ? ' sat' : '');
        b.addEventListener('click', () => { closeCalendar(); onPick(iso); });
        grid.appendChild(b);
      }
      box.appendChild(grid);
    };

    const shift = (n) => {
      const d = Recur.fromISO(shown);
      d.setDate(1);
      d.setMonth(d.getMonth() + n);
      shown = Recur.toISO(d);
      draw();
    };

    draw();
    document.body.appendChild(box);

    const r = anchor.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    box.style.left = Math.min(Math.max(8, r.left), innerWidth - w - 8) + 'px';
    box.style.top = (r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
    open = box;
  }

  function mini(text, fn) {
    const b = document.createElement('button');
    b.className = 'cal-nav';
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  }


  // "9" "930" "9:3" "1830" 처럼 대충 쳐도 24시간 HH:MM 으로 만든다.
  // Windows 기본 시간 칸은 오전/오후로 나오고 칸마다 맞춰야 해서 직접 받는다.
  function parseTime(str) {
    const raw = String(str || '').trim();
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    let h;
    let mi;

    if (/[:.시]/.test(raw)) {
      // 구분자가 있으면 앞이 시, 뒤가 분. "9:3" 은 9시 30분으로 본다.
      const parts = raw.split(/[:.시]/);
      h = Number((parts[0] || '').replace(/\D/g, '')) || 0;
      const rest = (parts[1] || '').replace(/\D/g, '');
      mi = rest === '' ? 0 : Number(rest.length === 1 ? rest + '0' : rest.slice(0, 2));
    } else if (digits.length <= 2) {
      h = Number(digits);
      mi = 0;
    } else {
      // 몰아 친 경우: 930 → 9:30, 1830 → 18:30
      h = Number(digits.slice(0, digits.length - 2));
      mi = Number(digits.slice(-2));
    }
    if (!Number.isFinite(h) || !Number.isFinite(mi)) return '';
    h = Math.max(0, Math.min(23, h));
    mi = Math.max(0, Math.min(59, mi));
    return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
  }



  global.Picker = { label, openCalendar, closeCalendar, parseTime, DOW, col };
})(window);
