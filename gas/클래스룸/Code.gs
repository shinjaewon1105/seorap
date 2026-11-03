/**
 * 서랍 ← 클래스룸. 학교 계정에서 웹 앱으로 돈다.
 *
 * PC 서랍이 POST 로 비밀값을 보내면 과제 · 내 제출 상태 · 최근 공지를 JSON 으로 돌려준다.
 * 읽기만 한다 — 쓰기 권한은 appsscript.json 에서 아예 청하지 않는다.
 * 비밀값은 주소가 아니라 본문으로 받는다. 주소는 이곳저곳 기록에 남는다.
 *
 * 처음 한 번 setup() 을 돌려 비밀값을 만들고, 로그에 찍힌 값을 PC 의
 * 서랍/data/classroom.json 에 넣는다. check() 는 편집기에서 손으로 확인할 때 쓴다.
 */
const TZ = 'Asia/Seoul';
const NOTE_DAYS = 21;

function setup() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SECRET');
  if (!secret) {
    secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('SECRET', secret);
  }
  console.log('비밀값: ' + secret);
}

function check() {
  const r = collect();
  console.log('수업 ' + r.courses.length + ' · 과제 ' + r.work.length + ' · 공지 ' + r.notes.length +
    (r.errors.length ? ' · 오류 ' + r.errors.join(' / ') : ''));
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    body = {};
  }
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || body.secret !== secret) return json({ ok: false, error: '비밀값이 맞지 않습니다' });
  try {
    return json(collect());
  } catch (err) {
    return json({ ok: false, error: short(err) });
  }
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 수업마다 과제 · 내 제출 상태 · 공지를 읽는다.
 * 한 수업이 막혀도 나머지는 보내고, 막힌 것은 errors 에 그대로 적는다.
 * 공지는 최근 NOTE_DAYS 일 것만 — PC 가 로컬 모델로 읽기 때문에 많이 보내면 오래 걸린다.
 */
function collect() {
  const out = { ok: true, at: new Date().toISOString(), courses: [], work: [], notes: [], errors: [] };
  const since = new Date(Date.now() - NOTE_DAYS * 86400000).toISOString();
  const courses = listAll((t) => Classroom.Courses.list({
    studentId: 'me', courseStates: ['ACTIVE'], pageSize: 50, pageToken: t,
  }), 'courses', 200);

  for (const c of courses) {
    out.courses.push({ id: c.id, name: c.name });

    const mine = {};
    try {
      listAll((t) => Classroom.Courses.CourseWork.StudentSubmissions.list(c.id, '-', {
        userId: 'me', pageSize: 100, pageToken: t,
      }), 'studentSubmissions', 500).forEach((s) => { mine[s.courseWorkId] = s.state; });
    } catch (err) {
      out.errors.push(c.name + ' 제출 상태: ' + short(err));
    }

    try {
      const work = listAll((t) => Classroom.Courses.CourseWork.list(c.id, { pageSize: 50, pageToken: t }), 'courseWork', 500);
      for (const w of work) {
        out.work.push({
          id: w.id, courseId: c.id, course: c.name, title: w.title || '',
          text: oneLine(w.description, 400), due: dueKST(w), link: w.alternateLink || '',
          state: mine[w.id] || '', updated: w.updateTime || '',
        });
      }
    } catch (err) {
      out.errors.push(c.name + ' 과제: ' + short(err));
    }

    try {
      const r = Classroom.Courses.Announcements.list(c.id, { pageSize: 20 }) || {};
      for (const a of (r.announcements || [])) {
        if ((a.updateTime || a.creationTime || '') < since) continue;
        out.notes.push({
          id: a.id, courseId: c.id, course: c.name, text: String(a.text || '').slice(0, 3000),
          posted: Utilities.formatDate(new Date(a.creationTime), TZ, 'yyyy-MM-dd'),
          updated: a.updateTime || '', link: a.alternateLink || '',
        });
      }
    } catch (err) {
      out.errors.push(c.name + ' 공지: ' + short(err));
    }
  }
  return out;
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

function oneLine(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function short(e) {
  return oneLine(e && e.message ? e.message : e, 220);
}
