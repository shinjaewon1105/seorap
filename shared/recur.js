// 반복 일정 전개 로직. main 프로세스(알림)와 renderer(달력)가 같은 규칙을 쓰도록 공유한다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Recur = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const pad = (n) => String(n).padStart(2, '0');

  function toISO(dt) {
    return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
  }
  function fromISO(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(iso, n) {
    const dt = fromISO(iso);
    dt.setDate(dt.getDate() + n);
    return toISO(dt);
  }
  function addMonths(iso, n) {
    const dt = fromISO(iso);
    const day = dt.getDate();
    dt.setDate(1);
    dt.setMonth(dt.getMonth() + n);
    // 31일이 없는 달은 그 달에 발생하지 않은 것으로 본다.
    const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
    if (day > last) return null;
    dt.setDate(day);
    return toISO(dt);
  }
  // 1 = 월요일 ... 7 = 일요일
  function weekday(iso) {
    const w = fromISO(iso).getDay();
    return w === 0 ? 7 : w;
  }
  function todayISO() {
    return toISO(new Date());
  }

  const MAX_STEPS = 4000;

  // 한 일정이 [from, to] 구간에서 실제로 발생하는 날짜들을 돌려준다.
  function occurrences(ev, from, to) {
    const out = [];
    const ex = new Set(ev.exceptions || []);
    const rep = ev.repeat;

    if (!rep || !rep.freq || rep.freq === 'none') {
      if (ev.date >= from && ev.date <= to && !ex.has(ev.date)) out.push(ev.date);
      return out;
    }

    const hardEnd = rep.until && rep.until < to ? rep.until : to;
    if (hardEnd < ev.date) return out;

    let steps = 0;

    if (rep.freq === 'daily') {
      const every = Math.max(1, rep.interval || 1);
      // from 이전 구간은 건너뛰고 시작한다.
      let cur = ev.date;
      if (cur < from) {
        const diff = Math.round((fromISO(from) - fromISO(cur)) / 86400000);
        cur = addDays(cur, Math.floor(diff / every) * every);
      }
      while (cur <= hardEnd && steps++ < MAX_STEPS) {
        if (cur >= from && !ex.has(cur)) out.push(cur);
        cur = addDays(cur, every);
      }
      return out;
    }

    if (rep.freq === 'weekly') {
      const days = rep.weekdays && rep.weekdays.length ? rep.weekdays : [weekday(ev.date)];
      const set = new Set(days);
      let cur = ev.date > from ? ev.date : from;
      while (cur <= hardEnd && steps++ < MAX_STEPS) {
        if (cur >= ev.date && set.has(weekday(cur)) && !ex.has(cur)) out.push(cur);
        cur = addDays(cur, 1);
      }
      return out;
    }

    if (rep.freq === 'monthly') {
      let i = 0;
      while (steps++ < MAX_STEPS) {
        const cur = addMonths(ev.date, i++);
        if (cur === null) {
          if (i > 400) break;
          continue;
        }
        if (cur > hardEnd) break;
        if (cur >= from && !ex.has(cur)) out.push(cur);
      }
      return out;
    }

    if (rep.freq === 'yearly') {
      const base = fromISO(ev.date);
      let y = base.getFullYear();
      const endY = fromISO(hardEnd).getFullYear();
      while (y <= endY && steps++ < MAX_STEPS) {
        const cur = y + '-' + pad(base.getMonth() + 1) + '-' + pad(base.getDate());
        if (cur >= from && cur <= hardEnd && cur >= ev.date && !ex.has(cur)) out.push(cur);
        y++;
      }
      return out;
    }

    return out;
  }

  // 여러 일정을 구간 안에서 전개해 { ...ev, date, occDate, isRepeat } 목록으로 만든다.
  function expandAll(events, from, to) {
    const list = [];
    for (const ev of events) {
      for (const d of occurrences(ev, from, to)) {
        list.push(Object.assign({}, ev, {
          date: d,
          occDate: d,
          isRepeat: !!(ev.repeat && ev.repeat.freq && ev.repeat.freq !== 'none'),
          key: ev.id + '@' + d,
        }));
      }
    }
    list.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return (a.startTime || '').localeCompare(b.startTime || '');
    });
    return list;
  }

  return { toISO, fromISO, addDays, addMonths, weekday, todayISO, occurrences, expandAll, pad };
});
