/* ══════════════════════════════════════════════════════════════════
   일정 데이터 — 로드 / 저장 / 반복 일정 수정 규칙
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const COLORS = [
    { hex: '#1a73e8', name: '기본' },
    { hex: '#039be5', name: '하늘' },
    { hex: '#0b8043', name: '숲' },
    { hex: '#33b679', name: '풀' },
    { hex: '#f6bf26', name: '노랑' },
    { hex: '#f4511e', name: '주황' },
    { hex: '#d50000', name: '빨강' },
    { hex: '#8e24aa', name: '보라' },
    { hex: '#616161', name: '회색' },
  ];

  const listeners = new Set();

  const Store = {
    events: [],
    settings: {},
    info: {},
    COLORS,

    folders: [],          // 앱 전체가 함께 쓰는 폴더 목록
    notes: [],            // 마감과 별개인 필기
    links: [],            // 저장해 둔 링크
    files: [],            // 어느 마감에도 매이지 않은 파일 (파일 화면에서 바로 가져온 것)
    tombs: [],            // 지운 것의 흔적 — 기기끼리 맞출 때 "지웠다"를 알려면 필요하다
    meta: {},             // foldersAt 같은 묶음 단위 시각

    async init() {
      const [events, notes, links, files, folders, settings, info, extra] = await Promise.all([
        api.events.load(), api.notes.load(), api.links.load(), api.files.load(),
        api.folders.load(), api.settings.load(), api.app.info(),
        api.sync ? api.sync.load() : Promise.resolve(null),
      ]);
      this.tombs = (extra && Array.isArray(extra.tombs)) ? extra.tombs : [];
      this.meta = (extra && extra.meta) ? extra.meta : {};
      this.settings = settings || {};
      this.info = info || {};
      this.folders = (folders || []).map(cleanFolder).filter(Boolean);
      this.events = (events || []).map(normalize);
      this.notes = (notes || []).map(normNote);
      this.links = (links || []).map(normLink);
      this.files = (files || []).map(normFile);
      this.absorbLegacyFolders();
    },

    // 예전에는 폴더를 일정마다 들고 있었다. 남아 있으면 전역 목록으로 옮긴다.
    absorbLegacyFolders() {
      let moved = false;
      for (const ev of this.events) {
        if (!ev.attFolders || !ev.attFolders.length) continue;
        for (const p of ev.attFolders) if (this.addFolder(p, true)) moved = true;
        delete ev.attFolders;
        moved = true;
      }
      // 파일이 들어 있는 폴더도 목록에 있어야 한다
      for (const ev of this.events) {
        for (const a of (ev.attachments || [])) if (a.folder) this.addFolder(a.folder, true);
      }
      if (moved) { this.saveFolders(); this.save(); }
    },

    // 폴더 하나를 목록에 넣는다. 중간 단계 폴더도 함께 만든다.
    addFolder(p, quiet) {
      const clean = cleanFolder(p);
      if (!clean) return false;
      let added = false;
      const parts = clean.split('/');
      for (let i = 1; i <= parts.length; i++) {
        const sub = parts.slice(0, i).join('/');
        if (!this.folders.includes(sub)) { this.folders.push(sub); added = true; }
      }
      if (added) { this.folders.sort(); if (!quiet) this.saveFolders(); }
      return added;
    },

    saveFolders() {
      this.meta.foldersAt = new Date().toISOString();
      this.saveSync();
      clearTimeout(this._ft);
      this._ft = setTimeout(() => api.folders.save(this.folders), 150);
      this.emit();
    },

    // 폴더 이름을 바꾼다 — 전역 목록과 모든 일정의 파일에 함께 반영한다.
    renameFolderEverywhere(from, to) {
      const swap = (p) => {
        if (!p) return p;
        if (p === from) return to;
        if (p.indexOf(from + '/') === 0) return to + p.slice(from.length);
        return p;
      };
      this.folders = Array.from(new Set(this.folders.map(swap))).sort();
      for (const ev of this.events) {
        for (const a of (ev.attachments || [])) a.folder = swap(a.folder || '');
      }
      this.saveFolders();
      this.save();
    },

    // 폴더만 없애고 안의 것은 한 단계 위로 올린다. 파일은 절대 지우지 않는다.
    dissolveFolderEverywhere(target) {
      const lift = (p) => {
        if (!p) return p;
        const parent = target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : '';
        if (p === target) return parent;
        if (p.indexOf(target + '/') === 0) {
          return (parent ? parent + '/' : '') + p.slice(target.length + 1);
        }
        return p;
      };
      this.folders = Array.from(new Set(this.folders
        .filter((p) => p !== target)
        .map(lift)
        .filter(Boolean))).sort();
      for (const ev of this.events) {
        for (const a of (ev.attachments || [])) a.folder = lift(a.folder || '');
      }
      this.saveFolders();
      this.save();
    },

    // 그 일정이 실제로 쓰고 있는 폴더만 (상세 패널용)
    foldersInUse(ev) {
      const used = new Set();
      for (const a of (ev.attachments || [])) {
        if (!a.folder) continue;
        const parts = a.folder.split('/');
        for (let i = 1; i <= parts.length; i++) used.add(parts.slice(0, i).join('/'));
      }
      return Array.from(used).sort();
    },

    // 모든 첨부를 한 줄로 편다 (파일 화면용). ev 가 없으면 매이지 않은 파일.
    allAttachments() {
      const out = [];
      for (const ev of this.events) {
        for (const a of (ev.attachments || [])) out.push({ att: a, ev });
      }
      for (const a of this.files) out.push({ att: a, ev: null });
      return out;
    },

    // ── 어느 마감에도 매이지 않은 파일 ──
    addFiles(list) {
      const made = (list || []).map((f) => stamp(normFile(f)));
      this.files = this.files.concat(made);
      this.saveFiles();
      return made;
    },

    updateFile(id, patch) {
      const f = this.files.find((x) => x.id === id);
      if (!f) return null;
      Object.assign(f, patch);
      normFile(stamp(f));
      this.saveFiles();
      return f;
    },

    removeFile(id) {
      const i = this.files.findIndex((x) => x.id === id);
      if (i >= 0) { this.files.splice(i, 1); this.bury('f', id); }
      this.saveFiles();
    },

    saveFiles() {
      clearTimeout(this._ff);
      this._ff = setTimeout(() => api.files.save(this.files), 150);
      this.emit();
    },

    // 첨부 하나를 id 로 찾는다 (마감에 딸렸든 아니든)
    findAttachment(id) {
      return this.allAttachments().find((x) => x.att.id === id) || null;
    },

    // 첨부가 든 폴더를 바꾼다 — 어디에 있든 알아서 찾아 고친다.
    setAttachmentFolder(id, folder) {
      const f = cleanFolder(folder);
      const own = this.files.find((x) => x.id === id);
      if (own) { own.folder = f; this.saveFiles(); return true; }
      for (const ev of this.events) {
        const a = (ev.attachments || []).find((x) => x.id === id);
        if (!a) continue;
        a.folder = f;
        this.save();
        return true;
      }
      return false;
    },

    // 메인 프로세스가 첨부 정보를 바꿨을 때 다시 읽어온다.
    // what: 없으면 전부, 'events' 처럼 하나, 또는 ['events', 'files'] 처럼 여럿
    async reload(what) {
      const jobs = [];
      const want = (k) => !what || what === k || (Array.isArray(what) && what.includes(k));
      if (want('events')) jobs.push(api.events.load().then((v) => {
        this.events = (v || []).map(normalize);
      }));
      if (want('folders')) jobs.push(api.folders.load().then((v) => {
        this.folders = (v || []).map(cleanFolder).filter(Boolean);
      }));
      if (want('notes')) jobs.push(api.notes.load().then((v) => {
        this.notes = (v || []).map(normNote);
      }));
      if (want('links')) jobs.push(api.links.load().then((v) => {
        this.links = (v || []).map(normLink);
      }));
      if (want('files')) jobs.push(api.files.load().then((v) => {
        this.files = (v || []).map(normFile);
      }));
      await Promise.all(jobs);
      this.emit();
    },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit() { for (const fn of listeners) fn(); },

    save() {
      clearTimeout(this._t);
      this._t = setTimeout(() => api.events.save(this.events), 150);
      this.emit();
    },

    async saveNow() {
      clearTimeout(this._t);
      await api.events.save(this.events);
      this.emit();
    },

    async saveSettings(patch) {
      this.settings = await api.settings.save(Object.assign({}, this.settings, patch));
      return this.settings;
    },

    get(id) { return this.events.find((e) => e.id === id) || null; },

    create(partial) {
      const ev = normalize(Object.assign({
        id: newId(),
        title: '',
        date: Recur.todayISO(),
        allDay: true,
        startTime: '',
        endTime: '',
        location: '',
        body: '',
        color: COLORS[0].hex,
        repeat: null,
        exceptions: [],
        reminder: this.settings.defaultReminder === '' ? null
          : (this.settings.defaultReminder != null ? Number(this.settings.defaultReminder) : 10),
        attachments: [],
        createdAt: new Date().toISOString(),
      }, partial || {}));
      stamp(ev);
      this.events.push(ev);
      this.save();
      return ev;
    },

    update(id, patch) {
      const ev = this.get(id);
      if (!ev) return null;
      Object.assign(ev, patch, { updatedAt: new Date().toISOString() });
      normalize(ev);
      this.save();
      return ev;
    },

    remove(id) {
      const i = this.events.findIndex((e) => e.id === id);
      if (i >= 0) { this.events.splice(i, 1); this.bury('e', id); }
      this.save();
    },

    // 지운 것을 적어 둔다. 이게 없으면 다른 기기가 "없어졌네" 를
    // "아직 안 받았네" 와 구별하지 못해 지운 것이 되살아난다.
    bury(kind, id) {
      this.tombs = this.tombs.filter((t) => !(t.k === kind && t.id === id));
      this.tombs.push({ k: kind, id, at: new Date().toISOString() });
      // 한 달 넘은 흔적은 치운다. 그쯤이면 모든 기기가 받아 갔다.
      const cut = new Date(Date.now() - 30 * 86400000).toISOString();
      this.tombs = this.tombs.filter((t) => t.at > cut);
      this.saveSync();
    },

    buried(kind, id) {
      return this.tombs.find((t) => t.k === kind && t.id === id) || null;
    },

    saveSync() {
      if (!api.sync) return;
      clearTimeout(this._st);
      this._st = setTimeout(() => api.sync.save({ tombs: this.tombs, meta: this.meta }), 200);
    },

    // ── 반복 일정 ──────────────────────────────────────────────
    isRepeating(ev) { return !!(ev && ev.repeat && ev.repeat.freq && ev.repeat.freq !== 'none'); },

    // "이 날짜만" — 해당 회차를 예외로 빼고 독립 일정으로 새로 만든다.
    detachOne(ev, occDate, patch) {
      ev.exceptions = (ev.exceptions || []).concat([occDate]);
      const copy = normalize(Object.assign({}, deepCopy(ev), {
        id: newId(),
        date: occDate,
        repeat: null,
        exceptions: [],
        detachedFrom: ev.id,
        createdAt: new Date().toISOString(),
      }, patch || {}));
      this.events.push(copy);
      this.save();
      return copy;
    },

    // "이후 전부" — 원본을 전날까지로 끊고, 이 날짜부터 새 반복 일정을 만든다.
    splitFrom(ev, occDate, patch) {
      const prev = Recur.addDays(occDate, -1);
      if (prev < ev.date) {
        // 첫 회차부터 바꾸는 경우면 원본을 그대로 고친다.
        return this.update(ev.id, Object.assign({ date: occDate }, patch || {}));
      }
      const tail = normalize(Object.assign({}, deepCopy(ev), {
        id: newId(),
        date: occDate,
        exceptions: (ev.exceptions || []).filter((d) => d >= occDate),
        splitFrom: ev.id,
        createdAt: new Date().toISOString(),
      }, patch || {}));
      ev.repeat = Object.assign({}, ev.repeat, { until: prev });
      ev.exceptions = (ev.exceptions || []).filter((d) => d < occDate);
      this.events.push(tail);
      this.save();
      return tail;
    },

    // 해당 회차 하나만 삭제
    excludeOne(ev, occDate) {
      ev.exceptions = (ev.exceptions || []).concat([occDate]);
      this.save();
    },

    // 이 회차부터 이후 전부 삭제
    truncateFrom(ev, occDate) {
      const prev = Recur.addDays(occDate, -1);
      if (prev < ev.date) { this.remove(ev.id); return; }
      ev.repeat = Object.assign({}, ev.repeat, { until: prev });
      this.save();
    },

    // ── 마감 ───────────────────────────────────────────────────
    isDeadline(ev) { return !!ev && ev.kind !== 'event'; },

    // 반복 마감은 회차마다 따로 끝난다.
    isDone(ev, occDate) {
      if (!ev) return false;
      if (this.isRepeating(ev)) return (ev.doneDates || []).includes(occDate || ev.date);
      return !!ev.done;
    },

    setDone(ev, occDate, v) {
      if (!ev) return;
      if (this.isRepeating(ev)) {
        const d = occDate || ev.date;
        const list = (ev.doneDates || []).filter((x) => x !== d);
        if (v) list.push(d);
        this.update(ev.id, { doneDates: list });
      } else {
        this.update(ev.id, { done: !!v });
      }
    },

    // 마감 목록 — 가까운 순. 지난 것도 끝나지 않았으면 남겨 둔다.
    deadlines(daysAhead) {
      const today = Recur.todayISO();
      const from = Recur.addDays(today, -120);
      const to = Recur.addDays(today, daysAhead || 120);
      return Recur.expandAll(this.events.filter((e) => this.isDeadline(e)), from, to)
        .map((occ) => {
          const ev = this.get(occ.id);
          const done = this.isDone(ev, occ.date);
          const left = Math.round((Recur.fromISO(occ.date) - Recur.fromISO(today)) / 86400000);
          return Object.assign({}, occ, { done, left });
        })
        // 끝낸 지 오래된 것만 목록에서 뺀다. 최근 것은 "끝낸 것" 을 켜면 보인다.
        .filter((o) => !(o.done && o.left < -14))
        .sort((a, b) => (a.done !== b.done ? (a.done ? 1 : -1) : 0)
          || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
          || String(a.title || '').localeCompare(String(b.title || ''), 'ko'));
    },

    // ── 필기(노트) ─────────────────────────────────────────────
    getNote(id) { return this.notes.find((n) => n.id === id) || null; },

    createNote(partial) {
      const n = normNote(Object.assign({
        id: 'nt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        title: '',
        body: '',
        pinned: false,
        links: [],
        createdAt: new Date().toISOString(),
      }, partial || {}));
      stamp(n);
      this.notes.unshift(n);
      this.saveNotes();
      return n;
    },

    updateNote(id, patch) {
      const n = this.getNote(id);
      if (!n) return null;
      Object.assign(n, patch, { updatedAt: new Date().toISOString() });
      normNote(n);
      this.saveNotes();
      return n;
    },

    removeNote(id) {
      const i = this.notes.findIndex((n) => n.id === id);
      if (i >= 0) { this.notes.splice(i, 1); this.bury('n', id); }
      this.saveNotes();
    },

    saveNotes() {
      clearTimeout(this._nt);
      this._nt = setTimeout(() => api.notes.save(this.notes), 150);
      this.emit();
    },

    // 고정한 것이 먼저, 그다음 최근에 고친 순서
    sortedNotes() {
      return this.notes.slice().sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt));
      });
    },

    // ── 저장한 링크 ────────────────────────────────────────────
    getLink(id) { return this.links.find((l) => l.id === id) || null; },

    createLink(partial) {
      const l = normLink(Object.assign({
        id: 'lk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        url: '',
        title: '',
        folder: '',
        createdAt: new Date().toISOString(),
      }, partial || {}));
      stamp(l);
      this.links.unshift(l);
      this.saveLinks();
      return l;
    },

    updateLink(id, patch) {
      const l = this.getLink(id);
      if (!l) return null;
      Object.assign(l, patch, { updatedAt: new Date().toISOString() });
      normLink(l);
      this.saveLinks();
      return l;
    },

    removeLink(id) {
      const i = this.links.findIndex((l) => l.id === id);
      if (i >= 0) { this.links.splice(i, 1); this.bury('l', id); }
      this.saveLinks();
    },

    saveLinks() {
      clearTimeout(this._lt);
      this._lt = setTimeout(() => api.links.save(this.links), 150);
      this.emit();
    },

    // 마감이나 노트에 딸린 링크만
    linksOf(ownerId) { return this.links.filter((l) => l.owner === ownerId); },

    // ── 조회 ───────────────────────────────────────────────────
    inRange(from, to) { return Recur.expandAll(this.events, from, to); },
  };

  function newId() {
    return 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  function isISO(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || ''); }

  // 기기끼리 맞출 때 "누가 더 최근인가"를 이걸로 판단한다.
  function stamp(o) {
    o.updatedAt = new Date().toISOString();
    return o;
  }

  function normFile(f) {
    f.folder = cleanFolder(f.folder);
    f.done = !!f.done;
    f.name = f.name == null ? '' : String(f.name);
    return f;
  }

  function normNote(n) {
    n.title = n.title == null ? '' : String(n.title);
    n.body = n.body || '';
    n.folder = cleanFolder(n.folder);
    n.pinned = !!n.pinned;
    n.createdAt = n.createdAt || new Date().toISOString();
    return n;
  }

  // 주소를 사람이 대충 쳐도 열리게 다듬는다. 제목이 없으면 도메인을 쓴다.
  function normLink(l) {
    let url = String(l.url || '').trim();
    if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
    l.url = url;
    l.title = l.title == null ? '' : String(l.title);
    l.note = l.note || '';
    l.folder = cleanFolder(l.folder);
    l.owner = l.owner || '';        // 마감·노트에 딸린 것이면 그 id
    l.createdAt = l.createdAt || new Date().toISOString();
    return l;
  }

  // 화면에 보일 이름 — 제목이 없으면 도메인, 그것도 없으면 주소 그대로
  function linkLabel(l) {
    if (l.title) return l.title;
    try { return new URL(l.url).hostname.replace(/^www\./, ''); } catch (e) { return l.url || '링크'; }
  }

  function linkHost(l) {
    try { return new URL(l.url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  // 아이콘에 넣을 한 글자 — ko.wikipedia.org 면 'K'가 아니라 'W'가 낫다.
  function linkInitial(l) {
    const host = linkHost(l);
    if (!host) return (l.url || '?').slice(0, 1).toUpperCase();
    const parts = host.split('.');
    const name = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return (name || host).slice(0, 1).toUpperCase();
  }

  function normalize(ev) {
    ev.title = ev.title == null ? '' : String(ev.title);
    ev.date = /^\d{4}-\d{2}-\d{2}$/.test(ev.date || '') ? ev.date : Recur.todayISO();
    // 시간과 장소는 쓰지 않는다(2026-09-12). 모든 항목이 날짜 단위다.
    // 예전 자료의 값은 지우지 않고 그대로 두되, 화면에서는 보이지 않는다.
    ev.allDay = true;
    ev.body = ev.body || '';
    ev.folder = cleanFolder(ev.folder);
    ev.color = /^#[0-9a-f]{6}$/i.test(ev.color || '') ? ev.color : COLORS[0].hex;
    ev.exceptions = Array.isArray(ev.exceptions) ? ev.exceptions : [];
    ev.attachments = Array.isArray(ev.attachments) ? ev.attachments : [];

    // 이 앱은 마감을 적는 데 주로 쓴다. 그래서 새로 만드는 것은 기본이 마감이고,
    // 수업이나 약속처럼 그냥 그 시간에 있는 일은 kind 를 'event' 로 바꾼다.
    ev.kind = ev.kind === 'event' ? 'event' : 'deadline';
    ev.done = !!ev.done;
    // 반복 마감은 회차마다 끝나므로 날짜별로 따로 기록한다.
    ev.doneDates = Array.isArray(ev.doneDates) ? ev.doneDates.filter(isISO) : [];

    // 폴더는 앱 전체가 함께 쓴다(Store.folders). 여기서는 파일이 어느 폴더인지만 다듬는다.
    for (const a of ev.attachments) {
      a.folder = cleanFolder(a.folder);
      a.done = !!a.done;
    }
    // 첨부를 처음 넣은 자리를 마감이 정해 준다 — 파일 화면에서 바로 보이도록.
    ev.reminder = (ev.reminder === null || ev.reminder === undefined || ev.reminder === '')
      ? null : Number(ev.reminder);
    // 알림 시각을 직접 정한 경우. "YYYY-MM-DD HH:MM" 로 저장한다.
    ev.reminderAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(ev.reminderAt || '')
      ? ev.reminderAt : null;
    if (ev.reminderAt) ev.reminder = null;

    if (ev.repeat && ev.repeat.freq && ev.repeat.freq !== 'none') {
      const r = ev.repeat;
      r.freq = ['daily', 'weekly', 'monthly', 'yearly'].includes(r.freq) ? r.freq : 'weekly';
      r.weekdays = Array.isArray(r.weekdays)
        ? r.weekdays.map(Number).filter((n) => n >= 1 && n <= 7).sort()
        : [];
      if (r.freq === 'weekly' && !r.weekdays.length) r.weekdays = [Recur.weekday(ev.date)];
      r.until = /^\d{4}-\d{2}-\d{2}$/.test(r.until || '') ? r.until : null;
      r.interval = Math.max(1, Number(r.interval) || 1);
    } else {
      ev.repeat = null;
    }
    return ev;
  }

  // 폴더 경로를 안전하게 다듬는다. 세 단계까지만, 이상한 글자는 뺀다.
  function cleanFolder(p) {
    if (!p) return '';
    return String(p)
      .replace(/\\/g, '/')
      .split('/')
      .map((s) => s.replace(/[<>:"|?*\x00-\x1f]/g, '').replace(/^\.+/, '').trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 3)
      .join('/');
  }

  function normTime(t) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return '';
    const h = Math.min(23, Math.max(0, Number(m[1])));
    const mi = Math.min(59, Math.max(0, Number(m[2])));
    return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
  }

  function toMin(t) {
    const m = normTime(t);
    if (!m) return 0;
    return Number(m.slice(0, 2)) * 60 + Number(m.slice(3, 5));
  }

  function fromMin(n) {
    const v = Math.max(0, Math.min(24 * 60 - 1, Math.round(n)));
    return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
  }

  function addMinutes(t, n) { return fromMin(toMin(t) + n); }

  Store.util = {
    newId, normalize, normTime, toMin, fromMin, addMinutes, deepCopy, cleanFolder,
    normNote, normLink, normFile, linkLabel, linkHost, linkInitial, stamp,
  };
  global.Store = Store;
})(window);
