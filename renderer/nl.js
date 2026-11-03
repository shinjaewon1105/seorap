/* ══════════════════════════════════════════════════════════════════
   자연어 → 일정
   Llama 는 "문장을 구조화된 JSON으로 바꾸는 일"만 한다.
   날짜·시간 계산은 작은 모델이 자주 틀리므로, 앱이 결정론적으로
   한 번 더 확인해서 확실히 읽히는 표현은 앱 값으로 덮어쓴다.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const WD = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 7 };

  // ────────────────────── 한국어 날짜/시간 해석기 ──────────────────────

  // base 를 주면 오늘 대신 그 날을 기준으로 읽는다 (클래스룸 공지는 올라온 날 기준이다).
  function resolveKo(text, base) {
    const today = base || Recur.todayISO();
    const out = { date: null, startTime: null, endTime: null, allDay: null, repeat: null };
    const t = text.replace(/\s+/g, ' ');

    // ── 날짜 ──
    let m;

    if ((m = t.match(/(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})\s*일?/))) {
      out.date = iso(+m[1], +m[2], +m[3]);
    } else if ((m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/))) {
      out.date = upcoming(+m[1], +m[2], today);
    } else if ((m = t.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s|$)/))) {
      out.date = upcoming(+m[1], +m[2], today);
    } else if (/모레|내일모레/.test(t)) {
      out.date = Recur.addDays(today, /내일모레/.test(t) ? 2 : 2);
    } else if (/글피/.test(t)) {
      out.date = Recur.addDays(today, 3);
    } else if (/내일/.test(t)) {
      out.date = Recur.addDays(today, 1);
    } else if (/어제/.test(t)) {
      out.date = Recur.addDays(today, -1);
    } else if (/오늘|이따|잠시\s*후/.test(t)) {
      out.date = today;
    } else if ((m = t.match(/(\d+)\s*일\s*(?:뒤|후|있다가)/))) {
      out.date = Recur.addDays(today, +m[1]);
    } else if ((m = t.match(/(\d+)\s*주\s*(?:뒤|후)/))) {
      out.date = Recur.addDays(today, +m[1] * 7);
    }

    // 요일 표현 (앞에 이번주/다음주가 붙을 수 있다)
    if (!out.date && (m = t.match(/(이번\s*주|담\s*주|다음\s*주|차\s*주|저번\s*주|지난\s*주)?\s*([월화수목금토일])요일/))) {
      const target = WD[m[2]];
      const mondayThis = Recur.addDays(today, -(Recur.weekday(today) - 1));
      const scope = (m[1] || '').replace(/\s/g, '');
      if (/다음주|담주|차주/.test(scope)) out.date = Recur.addDays(mondayThis, 7 + target - 1);
      else if (/저번주|지난주/.test(scope)) out.date = Recur.addDays(mondayThis, -7 + target - 1);
      else if (/이번주/.test(scope)) out.date = Recur.addDays(mondayThis, target - 1);
      else {
        // 수식어가 없으면 오늘 이후로 가장 가까운 그 요일
        let d = today;
        for (let i = 0; i < 7; i++) {
          if (Recur.weekday(d) === target) break;
          d = Recur.addDays(d, 1);
        }
        out.date = d;
      }
    }

    if (!out.date && /다음\s*달|담\s*달/.test(t)) {
      const dm = t.match(/(\d{1,2})\s*일/);
      const base = Recur.fromISO(today);
      base.setDate(1);
      base.setMonth(base.getMonth() + 1);
      base.setDate(dm ? Math.min(+dm[1], new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()) : 1);
      out.date = Recur.toISO(base);
    }

    // ── 시간 ──
    const times = findTimes(t);
    if (times.length) {
      out.startTime = times[0];
      if (times[1] && times[1] > times[0]) out.endTime = times[1];
      out.allDay = false;
    } else if (/종일|하루\s*종일|온종일/.test(t)) {
      out.allDay = true;
    }

    // ── 반복 ──
    if (/매일|날마다/.test(t)) out.repeat = { freq: 'daily', weekdays: [], until: null, interval: 1 };
    else if (/매주|주마다/.test(t)) {
      const days = [];
      const re = /([월화수목금토일])요일/g;
      let g;
      while ((g = re.exec(t))) days.push(WD[g[1]]);
      out.repeat = { freq: 'weekly', weekdays: days, until: null, interval: 1 };
    } else if (/매달|매월|달마다/.test(t)) out.repeat = { freq: 'monthly', weekdays: [], until: null, interval: 1 };
    else if (/매년|해마다/.test(t)) out.repeat = { freq: 'yearly', weekdays: [], until: null, interval: 1 };

    return out;
  }

  function iso(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1) return null;
    return Recur.toISO(dt);
  }

  // 연도가 없으면 다가오는 쪽으로 읽는다.
  function upcoming(mo, d, from) {
    const today = from || Recur.todayISO();
    const y = Recur.fromISO(today).getFullYear();
    let v = iso(y, mo, d);
    if (v && v < today) v = iso(y + 1, mo, d);
    return v;
  }

  const MERID = /(오전|오후|아침|저녁|밤|새벽|낮|정오|자정)/;

  function findTimes(t) {
    const found = [];
    const re = /(오전|오후|아침|저녁|밤|새벽|낮)?\s*(\d{1,2})\s*(?::\s*(\d{2})|시\s*(반|\d{1,2}\s*분)?)/g;
    let m;
    while ((m = re.exec(t))) {
      const isColon = m[0].includes(':');
      const isHour = /시/.test(m[0]);
      if (!isColon && !isHour) continue;

      let h = +m[2];
      let mi = 0;
      if (m[3]) mi = +m[3];
      else if (m[4]) mi = /반/.test(m[4]) ? 30 : (parseInt(m[4], 10) || 0);

      const mer = m[1];
      if (mer) {
        if (/오후|저녁|밤/.test(mer) && h < 12) h += 12;
        else if (/오전|아침|새벽/.test(mer) && h === 12) h = 0;
        else if (/낮/.test(mer) && h < 12) h += 12;
      } else if (!isColon && h >= 1 && h <= 7) {
        h += 12;  // "3시 회의" 는 보통 오후를 뜻한다
      }
      if (h > 23 || mi > 59) continue;
      found.push(String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0'));
    }
    if (/정오/.test(t)) found.unshift('12:00');
    if (/자정/.test(t)) found.unshift('00:00');
    return found;
  }

  // ────────────────────── LLM 결과 + 앱 검증 병합 ──────────────────────

  // 작은 모델은 "다음주 화요일 발표"처럼 날짜 표현을 제목에 끌고 들어온다.
  // 날짜·시간은 이미 따로 저장되므로 제목에서는 걷어낸다.
  const TITLE_NOISE = [
    /(다음|이번|저번|지난|담|차)\s*주\s*[월화수목금토일]요일/g,
    /[월화수목금토일]요일/g,
    /(내일모레|오늘|모레|글피|내일|어제)/g,
    /(다음|담)\s*달/g,
    /\d{4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?/g,
    /\d{1,2}\s*월\s*\d{1,2}\s*일/g,
    /\d{1,2}:\d{2}\s*(?:[~\-–]\s*\d{1,2}:\d{2})?/g,
    /(오전|오후|아침|저녁|밤|새벽|낮)?\s*\d{1,2}\s*시\s*(?:반|\d{1,2}\s*분)?/g,
    /(매일|매주|매달|매월|매년|날마다|주마다|달마다|해마다)/g,
    /(하루\s*종일|온종일|종일)/g,
  ];

  function cleanTitle(s) {
    let t = String(s || '').trim();
    for (const p of TITLE_NOISE) t = t.replace(p, ' ');
    return t.replace(/\s+/g, ' ').replace(/^[\s,·.\-–~]+|[\s,·.\-–~]+$/g, '').trim();
  }

  const squash = (s) => String(s || '').replace(/\s+/g, '');

  function buildDraft(raw, text) {
    const ko = resolveKo(text);
    const today = Recur.todayISO();

    const llmDate = /^\d{4}-\d{2}-\d{2}$/.test(raw.date || '')
      && !isNaN(Recur.fromISO(raw.date).getTime()) ? raw.date : null;

    // 앱이 확실히 읽어낸 날짜가 있으면 그것을 쓴다.
    const date = ko.date || llmDate || today;

    let allDay = ko.allDay !== null ? ko.allDay : !!raw.allDay;
    const llmStart = Store.util.normTime(raw.startTime);
    const llmEnd = Store.util.normTime(raw.endTime);

    let startTime = ko.startTime || llmStart;
    // 앱이 시작 시각을 따로 읽어냈다면, 모델의 끝 시각은 시작이 서로 맞을 때만 믿는다.
    let endTime = ko.endTime
      || ((llmEnd && (!ko.startTime || llmStart === ko.startTime)) ? llmEnd : '');
    if (!startTime) allDay = true;
    if (allDay) { startTime = ''; endTime = ''; }
    else if (!endTime || endTime <= startTime) endTime = Store.util.addMinutes(startTime, 60);

    let repeat = ko.repeat;
    if (!repeat && raw.repeatFreq && raw.repeatFreq !== 'none') {
      repeat = {
        freq: raw.repeatFreq,
        weekdays: Array.isArray(raw.repeatWeekdays) ? raw.repeatWeekdays.map(Number) : [],
        until: /^\d{4}-\d{2}-\d{2}$/.test(raw.repeatUntil || '') ? raw.repeatUntil : null,
        interval: 1,
      };
    }
    if (repeat && repeat.freq === 'weekly' && !repeat.weekdays.length) {
      repeat.weekdays = [Recur.weekday(date)];
    }

    const rawTitle = String(raw.title || '').trim();
    const title = cleanTitle(rawTitle) || rawTitle || cleanTitle(text) || text.trim().slice(0, 40) || '새 일정';

    // 모델이 제목을 그대로 되풀이한 설명은 버린다.
    let body = String(raw.description || '').trim();
    const bt = squash(body);
    const tt = squash(title);
    if (bt && tt && (bt === tt || (bt.includes(tt) && bt.length <= tt.length + 8))) body = '';

    return {
      title,
      date,
      allDay,
      startTime,
      endTime,
      location: String(raw.location || '').trim(),
      body,
      repeat: repeat || null,
      overrode: !!(ko.date && llmDate && ko.date !== llmDate),
    };
  }

  // ────────────────────────────── UI ──────────────────────────────

  const NL = {
    draft: null,

    init() {
      this.input = $('#nlInput');
      this.status = $('#nlStatus');
      this.wrap = $('#previewWrap');
      this.box = $('#preview');

      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (this.draft) this.confirm();
          else this.run();
        } else if (e.key === 'Escape') {
          this.clear();
          this.input.blur();
        }
      });
      this.input.addEventListener('input', () => {
        if (this.draft) this.hidePreview();
      });
    },

    setStatus(msg, cls) {
      this.status.textContent = msg || '';
      this.status.className = 'nl-status' + (cls ? ' ' + cls : '');
    },

    async run(modelOverride) {
      const text = this.input.value.trim();
      if (!text) return;
      this.setStatus('이해하는 중…', 'busy');
      this.hidePreview();

      const t0 = performance.now();
      if (!api.ollama) return { ok: false, error: '이 기기에서는 AI 입력을 쓸 수 없습니다.' };
      const res = await api.ollama.parse(text, modelOverride);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);

      if (!res.ok) {
        this.setStatus('실패', 'err');
        App.toast('일정을 읽지 못했습니다 — ' + res.error, {
          label: '설정 열기', fn: () => App.openSettings(),
        });
        return;
      }

      this.draft = buildDraft(res.raw || {}, text);
      this.draft.model = res.model;
      this.draft.secs = secs;
      this.setStatus(secs + '초', '');
      this.showPreview();
    },

    showPreview() {
      const d = this.draft;
      this.box.replaceChildren();

      this.box.appendChild(chip('제목', input('title', d.title, 'title', (v) => { d.title = v; })));
      this.box.appendChild(chip('날짜', input('date', d.date, 'd', (v) => { d.date = v; }, 'date')));

      const timeChip = document.createElement('div');
      timeChip.className = 'pv-chip';
      const lbl = document.createElement('label');
      lbl.textContent = '시간';
      timeChip.appendChild(lbl);
      if (d.allDay) {
        const b = document.createElement('button');
        b.textContent = '종일';
        b.style.cssText = 'padding:0 6px;color:#5f6368';
        b.addEventListener('click', () => {
          d.allDay = false; d.startTime = '09:00'; d.endTime = '10:00';
          this.showPreview();
        });
        timeChip.appendChild(b);
      } else {
        timeChip.appendChild(input('start', d.startTime, 't', (v) => { d.startTime = v; }, 'time'));
        const dash = document.createElement('span');
        dash.textContent = '–';
        dash.style.color = '#80868b';
        timeChip.appendChild(dash);
        timeChip.appendChild(input('end', d.endTime, 't', (v) => { d.endTime = v; }, 'time'));
      }
      this.box.appendChild(timeChip);

      this.box.appendChild(chip('장소', input('loc', d.location, 'loc', (v) => { d.location = v; })));

      if (d.repeat) {
        const r = document.createElement('div');
        r.className = 'pv-chip';
        r.innerHTML = '<label>반복</label><span style="padding-right:6px">↻ '
          + { daily: '매일', weekly: '매주', monthly: '매월', yearly: '매년' }[d.repeat.freq] + '</span>';
        const x = document.createElement('button');
        x.textContent = '✕';
        x.style.cssText = 'color:#80868b;padding:0 4px';
        x.title = '반복 끄기';
        x.addEventListener('click', () => { d.repeat = null; this.showPreview(); });
        r.appendChild(x);
        this.box.appendChild(r);
      }

      const acts = document.createElement('div');
      acts.className = 'pv-actions';
      const ok = document.createElement('button');
      ok.className = 'btn-ghost primary';
      ok.textContent = '추가  ⏎';
      ok.addEventListener('click', () => this.confirm());
      const cancel = document.createElement('button');
      cancel.className = 'btn-ghost';
      cancel.textContent = '취소';
      cancel.addEventListener('click', () => this.clear());
      acts.appendChild(cancel);
      acts.appendChild(ok);
      this.box.appendChild(acts);

      const note = document.createElement('div');
      note.className = 'pv-model';
      note.textContent = d.model + ' · ' + d.secs + '초'
        + (d.overrode ? ' · 날짜는 앱이 다시 계산했습니다' : '');
      const alt = (Store.settings.altModel && Store.settings.altModel !== d.model)
        ? Store.settings.altModel : null;
      if (alt) {
        const again = document.createElement('button');
        again.style.cssText = 'color:#1a73e8;margin-left:8px';
        again.textContent = alt + ' 로 다시';
        again.addEventListener('click', () => this.run(alt));
        note.appendChild(again);
      }
      this.box.appendChild(note);

      this.wrap.hidden = false;
    },

    confirm() {
      const d = this.draft;
      if (!d) return;
      const ev = Store.create({
        title: d.title,
        date: d.date,
        allDay: d.allDay,
        startTime: d.startTime,
        endTime: d.endTime,
        location: d.location,
        body: d.body,
        repeat: d.repeat,
      });
      this.clear();
      Cal.goTo(ev.date);
      App.toast('"' + (ev.title || '일정') + '" 을(를) ' + ev.date + '에 추가했습니다.', {
        label: '열기', fn: () => Detail.open(Store.get(ev.id), ev.date),
      });
    },

    hidePreview() {
      this.draft = null;
      this.wrap.hidden = true;
    },

    clear() {
      this.hidePreview();
      this.input.value = '';
      this.setStatus('');
    },

    focus() { this.input.focus(); this.input.select(); },
  };

  function chip(label, control) {
    const c = document.createElement('div');
    c.className = 'pv-chip';
    const l = document.createElement('label');
    l.textContent = label;
    c.appendChild(l);
    c.appendChild(control);
    return c;
  }

  function input(name, value, cls, onChange, type) {
    const i = document.createElement('input');
    i.type = type || 'text';
    i.className = cls;
    i.value = value || '';
    i.placeholder = name === 'loc' ? '없음' : '';
    i.addEventListener('input', () => onChange(i.value));
    i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); NL.confirm(); }
      if (e.key === 'Escape') { e.preventDefault(); NL.clear(); }
    });
    return i;
  }

  global.NL = NL;
  global.NL.resolveKo = resolveKo;
})(window);
