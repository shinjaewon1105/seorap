/* ══════════════════════════════════════════════════════════════════
   클래스룸 → 마감
   학교 계정의 Apps Script 웹 앱(gas/클래스룸)이 넘겨준 과제를 마감으로 들여온다.
   과제 기한은 클래스룸이 준 날짜를 그대로 믿는다 — 모델을 거치지 않는다.
   날짜가 글 속에만 있는 공지는 로컬 모델이 뽑고, 한국어 해석기가 다시 계산한 뒤
   `클래스룸/확인 필요` 에 넣는다. 맞는지는 사람이 보고 옮긴다.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const ROOT = '클래스룸';
  const CHECK = ROOT + '/확인 필요';
  const EVERY = 3 * 3600 * 1000;
  const DONE = ['TURNED_IN', 'RETURNED'];
  // 날짜와 할 일의 낌새가 둘 다 있는 공지만 모델에게 보낸다. 한 편에 30초쯤 걸린다.
  const HINT_DATE = /(\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\s*\/\s*\d{1,2}|\d{1,2}\.\s?\d{1,2}\.?\s*\(\s*[월화수목금토일]\s*\)|[월화수목금토일]요일|내일|모레|다음\s*주|이번\s*주|오늘)/;
  const HINT_TASK = /(까지|마감|제출|시험|평가|수행|준비물|발표|가지고\s*오|가져오|챙겨)/;
  // 학교 공지는 "11.19.(목)" 처럼 쓴다. 괄호 속 요일이 붙은 것만 날짜로 본다 — 3.14 같은 수와 헷갈리지 않게.
  const DOT_DATE = /(\d{1,2})\.\s?(\d{1,2})\.?\s*(?=\(\s*[월화수목금토일]\s*\))/g;

  let running = null;
  let busyNow = false;

  const Classroom = {
    on: false,

    async init() {
      if (!api.classroom) return;              // 웹 버전
      const row = $('#classroomRow');
      if (row) row.hidden = false;
      const btn = $('#classroomNow');
      if (btn) btn.addEventListener('click', () => this.run(true));
      this.on = !!(await api.classroom.status()).on;
      if (!this.on) return;                    // data/classroom.json 이 없다
      setTimeout(() => this.run(false), 8000); // 켜자마자 몰리지 않게
      setInterval(() => this.run(false), EVERY);
    },

    run(manual) {
      if (running) return running;
      running = sync(manual)
        .catch((e) => {
          api.log('클래스룸 오류: ' + e.message);
          return finish(state(), { at: new Date().toISOString(), error: e.message });
        })
        .finally(() => { running = null; busyNow = false; this.paint(); });
      return running;
    },

    // 설정 화면의 진단 한 줄. 어디서 막혔는지 그대로 보여야 한다.
    paint() {
      const note = $('#classroomNote');
      if (!note) return;
      const btn = $('#classroomNow');
      if (btn) { btn.disabled = !this.on || busyNow; btn.hidden = !this.on; }
      if (!this.on) {
        note.className = 's-note';
        note.textContent = '연결 안 됨 — data/classroom.json 에 웹 앱 주소와 비밀값을 넣으면 켜집니다.';
        return;
      }
      if (busyNow) { note.className = 's-note'; note.textContent = '가져오는 중…'; return; }
      const l = state().last;
      if (!l) { note.className = 's-note'; note.textContent = '아직 한 번도 가져오지 않았습니다.'; return; }
      const parts = ['마지막 ' + when(l.at)];
      if (l.fetched != null) {
        parts.push('새 마감 ' + (l.made || 0), '날짜 바뀜 ' + (l.moved || 0),
          '제출 ' + (l.done || 0), '공지에서 ' + (l.picked || 0));
      }
      if (l.noteSkip) parts.push('공지 건너뜀: ' + l.noteSkip);
      parts.push(l.error ? '오류: ' + l.error : '오류 없음');
      note.className = 's-note ' + (l.error ? 'bad' : 'ok');
      note.textContent = parts.join(' · ');
    },
  };

  function state() {
    const s = Store.settings.classroom || {};
    return {
      imported: Array.isArray(s.imported) ? s.imported.slice() : [],
      seen: Object.assign({}, s.seen || {}),
      last: s.last || null,
    };
  }

  async function finish(st, last) {
    await Store.saveSettings({ classroom: { imported: st.imported, seen: st.seen, last: last || st.last } });
  }

  async function sync(manual) {
    busyNow = true;
    Classroom.paint();
    const st = state();
    const last = { at: new Date().toISOString(), made: 0, moved: 0, done: 0, picked: 0, error: '' };

    const r = await api.classroom.fetch();
    if (!r || !r.ok) {
      last.error = (r && r.error) || '응답이 비었습니다';
      api.log('클래스룸 가져오기 실패: ' + last.error);
      if (manual) App.toast('클래스룸: ' + last.error);
      return finish(st, last);
    }
    last.fetched = (r.work || []).length;
    if (r.errors && r.errors.length) last.error = r.errors.join(' / ').slice(0, 300);

    const imported = new Set(st.imported);
    applyWork(r.work || [], imported, last);
    st.imported = Array.from(imported);
    await finish(st, last);                      // 과제는 먼저 적어 둔다 — 공지는 오래 걸린다

    await applyNotes(r.notes || [], st, imported, last);
    st.imported = Array.from(imported);
    // 공지는 최근 것만 오므로, 목록에 없는 것의 기록은 버려도 된다.
    const live = new Set((r.notes || []).map((n) => n.id));
    for (const id of Object.keys(st.seen)) if (!live.has(id)) delete st.seen[id];
    await finish(st, last);

    const n = last.made + last.picked;
    if (n) App.toast('클래스룸에서 마감 ' + n + '개를 들여왔습니다.');
    else if (manual) App.toast('클래스룸: 새로 들일 것이 없습니다.');
  }

  // ────────────────────────────── 과제 ──────────────────────────────

  function byKey() {
    const m = new Map();
    for (const ev of Store.events) if (ev.source === 'classroom' && ev.sourceKey) m.set(ev.sourceKey, ev);
    return m;
  }

  function applyWork(list, imported, last) {
    const today = Recur.todayISO();
    const have = byKey();
    for (const w of list) {
      if (!w.due) continue;                       // 기한 없는 과제는 마감이 아니다
      const key = 'w:' + w.courseId + '/' + w.id;
      const date = w.due.slice(0, 10);
      const ev = have.get(key);
      if (ev) { refresh(ev, w, date, last); imported.add(key); continue; }
      if (imported.has(key)) continue;            // 서랍에서 지운 것 — 되살리지 않는다
      if (date < today) continue;                 // 이미 지난 과제는 처음부터 들이지 않는다
      const folder = ROOT + '/' + w.course.replace(/[/\\]/g, '-');
      Store.addFolder(folder);
      Store.create({
        title: w.title || '(제목 없는 과제)',
        date,
        folder,
        body: workBody(w),
        done: DONE.includes(w.state),
        source: 'classroom',
        sourceKey: key,
        sourceDate: date,
        sourceState: w.state || '',
      });
      imported.add(key);
      last.made++;
    }
  }

  // 이미 들인 과제를 클래스룸에 맞춘다. 사람이 손댄 것은 덮지 않는다.
  function refresh(ev, w, date, last) {
    const patch = {};
    if (date !== ev.sourceDate) {
      // 사용자가 날짜를 옮겨 두었으면(ev.date ≠ sourceDate) 그대로 둔다.
      if (ev.date === ev.sourceDate) { patch.date = date; last.moved++; }
      patch.sourceDate = date;
    }
    // 끝냄은 제출 상태가 **바뀐 순간에만** 고친다. 사람이 다시 푼 체크를 매번 덮지 않게.
    const state = w.state || '';
    if (state !== (ev.sourceState || '')) {
      const was = DONE.includes(ev.sourceState);
      const now = DONE.includes(state);
      patch.sourceState = state;
      if (was !== now) { patch.done = now; if (now) last.done++; }
    }
    if (Object.keys(patch).length) Store.update(ev.id, patch);
  }

  function workBody(w) {
    const out = [];
    if (w.link) out.push('[클래스룸에서 열기](' + w.link + ')');
    if (w.text) out.push('', '> ' + w.text);
    return out.join('\n');
  }

  // ────────────────────────────── 공지 ──────────────────────────────

  async function applyNotes(notes, st, imported, last) {
    const fresh = notes.filter((n) => st.seen[n.id] !== n.updated);
    if (!fresh.length) return;
    const model = Store.settings.extractModel || 'qwen3.5:4b';
    const status = await api.ollama.status();
    if (!status.ok || !status.models.includes(model)) {
      last.noteSkip = status.ok ? model + ' 모델 없음' : 'Ollama 꺼짐';
      return;                                     // seen 을 안 적었으니 다음에 다시 본다
    }
    const today = Recur.todayISO();
    for (const n of fresh) {
      if (!(HINT_DATE.test(n.text) && HINT_TASK.test(n.text))) { st.seen[n.id] = n.updated; continue; }
      const r = await api.classroom.extract(n.text, n.posted, model);
      if (!r || !r.ok) {
        last.error = '공지 읽기: ' + ((r && r.error) || '응답 없음');
        continue;                                 // 다음에 다시
      }
      st.seen[n.id] = n.updated;
      const have = byKey();
      for (const it of (r.items || []).slice(0, 5)) {
        const date = checkDate(it, n.posted, n.text);
        if (!date || date < today) continue;
        const key = 'a:' + n.courseId + '/' + n.id + '@' + date;
        if (imported.has(key) || have.has(key)) continue;
        Store.addFolder(CHECK);
        Store.create({
          title: noteTitle(n, it),
          date,
          folder: CHECK,
          body: noteBody(n, it),
          source: 'classroom',
          sourceKey: key,
          sourceDate: date,
        });
        imported.add(key);
        last.picked++;
      }
      st.imported = Array.from(imported);
      await finish(st, last);                     // 한 편 끝날 때마다 — 중간에 꺼져도 다시 안 돈다
    }
  }

  // 원문 표현 속 날짜 조각. 하나씩 한국어 해석기에 넣는다.
  const DATE_BITS = /(\d{4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\/\d{1,2}|(?:이번|다음|담|차|저번|지난)\s*주\s*[월화수목금토일]요일|[월화수목금토일]요일|내일\s*모레|모레|글피|내일|오늘|\d+\s*[일주]\s*(?:뒤|후))/g;

  /* 모델 날짜를 그대로 믿지 않는다. 날짜 조각을 공지가 올라온 날 기준으로
     한국어 해석기가 다시 읽는다.
     - 모델이 옮긴 원문(phrase)에 날짜 조각이 있으면:
       모델 날짜가 그중 하나면 그대로 ("11월 6일에서 11월 8일로" 에서 8일을 고른 것),
       아니면 해석기 쪽 마지막 조각 — 바뀐 날짜는 보통 뒤에 온다
     - phrase 에 날짜가 없고 공지 전체에 날짜가 하나뿐이면 그것.
       모델은 "책을 가지고 오세요" 만 옮기고 "이번 주 금요일" 을 토요일로 셌다(실측)
     - 그래도 못 읽으면 그때만 모델 날짜
     공지보다 앞이거나 넉 달 넘게 뒤면 잘못 읽은 것으로 보고 버린다. */
  function checkDate(it, base, text) {
    const viaModel = /^\d{4}-\d{2}-\d{2}$/.test(it.date || '') ? it.date : null;
    const dates = (s) => (String(s || '').replace(DOT_DATE, '$1월 $2일 ').match(DATE_BITS) || [])
      .map((bit) => NL.resolveKo(bit, base).date)
      .filter(Boolean);
    const found = dates(it.phrase);
    const whole = Array.from(new Set(dates(text)));
    let d = viaModel;
    if (found.length) {
      if (!found.includes(viaModel)) d = found[found.length - 1];
    } else if (whole.length === 1) {
      d = whole[0];
    }
    if (!d || d < base || d > Recur.addDays(base, 120)) return null;
    return d;
  }

  // 확인 필요 폴더에는 여러 수업이 섞이므로 제목 앞에 짧은 수업 이름을 붙인다.
  function noteTitle(n, it) {
    const short = String(n.course)
      .replace(/\d{4}\s*(학년도)?\.?/g, '')
      .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
      .replace(/\d+기_?|_/g, ' ')
      .replace(/\s+/g, ' ').trim() || n.course;
    return '[' + short.slice(0, 16) + '] ' + String(it.title || '공지의 날짜').trim().slice(0, 80);
  }

  function noteBody(n, it) {
    const quote = String(n.text).replace(/\s+/g, ' ').trim();
    return [
      '**확인 필요** — 공지 글에서 AI 가 뽑은 날짜입니다. 맞으면 다른 폴더로 옮기고, 아니면 지우세요.',
      '',
      '- 수업: ' + n.course,
      '- 공지에 적힌 말: "' + String(it.phrase || '').trim() + '"',
      n.link ? '- [클래스룸에서 공지 열기](' + n.link + ')' : '',
      '',
      '> ' + (quote.length > 300 ? quote.slice(0, 300) + '…' : quote),
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  }

  function when(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '?';
    const p = (x) => String(x).padStart(2, '0');
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  global.Classroom = Classroom;
})(window);
