/**
 * 서랍 ← 클래스룸, 1단계 시험.
 *
 * 학교 계정의 Apps Script 에서 probe() 를 한 번 돌리면, 이 계정으로 클래스룸을
 * 직접 읽을 수 있는지와 무엇이 보이는지를 실행 로그 하나에 적는다.
 * 읽기만 한다 — 쓰기 권한은 appsscript.json 에서 아예 청하지 않는다.
 * 어디서 막혔는지가 로그에 그대로 남아야 한다. 그래서 단계마다 따로 잡는다.
 */
const TZ = 'Asia/Seoul';

function probe() {
  const out = [];
  const say = (s) => out.push(s);
  const now = new Date();
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  say('서랍 클래스룸 시험 · ' + Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm'));

  let courses = null;
  try {
    courses = listAll((t) => Classroom.Courses.list({
      studentId: 'me', courseStates: ['ACTIVE'], pageSize: 50, pageToken: t,
    }), 'courses', 200);
    say('✓ 수업 목록 · ' + courses.length + '개: ' + courses.map((c) => c.name).join(' · '));
  } catch (e) {
    say('✗ 수업 목록: ' + short(e));
  }

  // 수업마다 과제 · 내 제출 상태 · 공지를 따로 읽어 본다. 하나가 막혀도 나머지는 본다.
  const stat = { work: tally(), subs: tally(), notes: tally() };
  const types = {};
  const states = {};
  const upcoming = [];
  const noteSamples = [];
  let total = 0;
  let noDue = 0;

  for (const c of (courses || []).slice(0, 20)) {
    let work = [];
    try {
      work = listAll((t) => Classroom.Courses.CourseWork.list(c.id, { pageSize: 50, pageToken: t }), 'courseWork', 100);
      stat.work.ok++;
    } catch (e) {
      stat.work.fail(e);
    }

    const mine = {};
    try {
      const subs = listAll((t) => Classroom.Courses.CourseWork.StudentSubmissions.list(c.id, '-', {
        userId: 'me', pageSize: 100, pageToken: t,
      }), 'studentSubmissions', 300);
      for (const s of subs) {
        mine[s.courseWorkId] = s.state;
        states[s.state] = (states[s.state] || 0) + 1;
      }
      stat.subs.ok++;
    } catch (e) {
      stat.subs.fail(e);
    }

    for (const w of work) {
      total++;
      types[w.workType] = (types[w.workType] || 0) + 1;
      const due = dueKST(w);
      if (!due) { noDue++; continue; }
      if (due.slice(0, 10) >= today) {
        upcoming.push({ due: due, course: c.name, title: w.title, state: mine[w.id] || '?' });
      }
    }

    try {
      const r = Classroom.Courses.Announcements.list(c.id, { pageSize: 3 }) || {};
      for (const a of (r.announcements || [])) {
        if (noteSamples.length < 3) noteSamples.push(c.name + ' │ ' + oneLine(a.text, 60));
      }
      stat.notes.ok++;
    } catch (e) {
      stat.notes.fail(e);
    }
  }

  if (courses && courses.length) {
    say(stat.work.line('과제 목록'));
    say(stat.subs.line('내 제출 상태'));
    say(stat.notes.line('공지'));
    say('과제 ' + total + '개 (기한 없음 ' + noDue + ') · 종류 ' + JSON.stringify(types));
    say('제출 상태 ' + JSON.stringify(states));
    upcoming.sort((a, b) => a.due.localeCompare(b.due));
    say('앞으로 남은 기한 ' + upcoming.length + '개' + (upcoming.length > 15 ? ' (앞 15개만)' : '') + ':');
    for (const u of upcoming.slice(0, 15)) {
      say('  ' + u.due + ' │ ' + u.course + ' │ ' + u.title + ' │ ' + u.state);
    }
    if (noteSamples.length) {
      say('공지 앞부분:');
      noteSamples.forEach((s) => say('  ' + s));
    }
  }

  say('');
  if (courses && courses.length && stat.work.ok > 0) {
    say('→ 결론: 클래스룸을 바로 읽을 수 있다. Gmail 시험은 필요 없다.');
  } else if (courses && courses.length === 0) {
    say('→ 수업이 하나도 안 보인다. 학교 계정으로 열었는지, 클래스룸에 학생으로 들어가 있는지 볼 것.');
  } else {
    say('→ 결론: 클래스룸 직접 읽기가 막혔다. 2단계(Gmail 시험)로 간다.');
  }

  const text = out.join('\n');
  console.log(text);
  return text;
}

/** 쪽마다 끊어 오는 목록을 끝까지(또는 max 개까지) 모은다. */
function listAll(call, key, max) {
  const items = [];
  let token;
  do {
    const r = call(token) || {};
    (r[key] || []).forEach((x) => items.push(x));
    token = r.nextPageToken;
  } while (token && items.length < max);
  return items;
}

/**
 * 클래스룸의 dueDate · dueTime 은 UTC 다. 한국 시각으로 바꿔야 날짜가 맞는다 —
 * 오전 9시 전에 마감인 과제는 UTC 로는 전날이다.
 */
function dueKST(w) {
  if (!w.dueDate) return null;
  const d = w.dueDate;
  const t = w.dueTime || {};
  const ms = Date.UTC(d.year, d.month - 1, d.day, t.hours || 0, t.minutes || 0);
  return Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd HH:mm');
}

/** 성공한 수업 수와 첫 오류를 센다. 오류를 뭉뚱그리지 않고 처음 것을 그대로 보인다. */
function tally() {
  return {
    ok: 0, bad: 0, err: '',
    fail(e) { this.bad++; if (!this.err) this.err = short(e); },
    line(name) {
      if (!this.bad) return '✓ ' + name + ' · 수업 ' + this.ok + '개';
      if (!this.ok) return '✗ ' + name + ': ' + this.err;
      return '△ ' + name + ' · ' + this.ok + '개 됨, ' + this.bad + '개 오류: ' + this.err;
    },
  };
}

function oneLine(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function short(e) {
  return oneLine(e && e.message ? e.message : e, 220);
}
