/**
 * 서랍 ← 학교 Gmail, 2단계 시험. 1단계(클래스룸 직접 읽기)가 막혔을 때만 쓴다.
 *
 * 클래스룸 알림 메일이 이 계정에 오는지, 오면 어떤 모양인지를 실행 로그 하나에 적는다.
 * 해석 규칙은 이 로그의 실제 메일 모양을 보고 정한다 — 짐작으로 정규식을 박지 않는다.
 * 읽기 전용(gmail.readonly)만 청한다. GmailApp 은 보내기·지우기까지 되는
 * mail.google.com 권한을 요구해서 일부러 쓰지 않는다.
 */
const TZ = 'Asia/Seoul';
const QUERY = 'from:classroom.google.com newer_than:90d';
const SAMPLES = 4;

function probe() {
  const out = [];
  const say = (s) => out.push(s);
  say('서랍 Gmail 시험 · ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'));

  let ids = [];
  try {
    const r = Gmail.Users.Messages.list('me', { q: QUERY, maxResults: 50 }) || {};
    ids = (r.messages || []).map((m) => m.id);
    say('✓ 메일 읽기 · 클래스룸 알림 ' + ids.length + (r.nextPageToken ? '개 넘게' : '개') + ' (최근 90일)');
  } catch (e) {
    say('✗ 메일 읽기: ' + short(e));
    say('');
    say('→ 결론: 학교 Gmail 도 막혔다. 길 C 로 간다.');
    return done(out);
  }

  if (!ids.length) {
    say('');
    say('→ 메일 읽기는 되는데 클래스룸 알림이 한 통도 없다.');
    say('  클래스룸 → 설정 → 알림 → "이메일 알림 허용" 이 켜져 있는지 볼 것.');
    return done(out);
  }

  // 제목만 훑어 메일 종류를 가늠한다. 따옴표 안(과제 이름)과 숫자는 가려서 모양만 센다.
  const shapes = {};
  const firstOf = {};
  for (const id of ids) {
    try {
      const m = Gmail.Users.Messages.get('me', id, { format: 'metadata', metadataHeaders: ['Subject'] });
      const shape = subjectShape(header(m, 'Subject'));
      shapes[shape] = (shapes[shape] || 0) + 1;
      if (!firstOf[shape]) firstOf[shape] = id;
    } catch (e) {
      say('△ 제목 읽기 오류: ' + short(e));
      break;
    }
  }
  const order = Object.keys(shapes).sort((a, b) => shapes[b] - shapes[a]);
  say('제목 모양 (따옴표 안 · 숫자는 가림):');
  order.forEach((s) => say('  ' + shapes[s] + '× ' + s));

  // 모양마다 한 통씩, 본문과 클래스룸 링크 모양을 그대로 보인다.
  for (const shape of order.slice(0, SAMPLES)) {
    say('');
    try {
      const m = Gmail.Users.Messages.get('me', firstOf[shape], { format: 'full' });
      const when = Utilities.formatDate(new Date(Number(m.internalDate)), TZ, 'yyyy-MM-dd HH:mm');
      say('── ' + when + ' │ ' + header(m, 'Subject'));
      const parts = textParts(m.payload);
      const body = parts.plain || stripHtml(parts.html);
      body.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 30)
        .forEach((l) => say('  ' + (l.length > 120 ? l.slice(0, 120) + '…' : l)));
      const links = classroomLinks(parts.html + '\n' + parts.plain);
      say('  링크 모양: ' + (links.length ? links.join('  ') : '(없음)'));
    } catch (e) {
      say('△ 본문 읽기 오류: ' + short(e));
    }
  }

  say('');
  say('→ 결론: 학교 Gmail 로 갈 수 있다. 이 로그를 붙여 넣으면 해석 규칙을 맞춘다.');
  return done(out);
}

function done(out) {
  const text = out.join('\n');
  console.log(text);
  return text;
}

function header(m, name) {
  const h = ((m.payload && m.payload.headers) || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function subjectShape(s) {
  return String(s || '')
    .replace(/["“”][^"“”]*["“”]/g, '"…"')
    .replace(/[‘’'][^‘’']*[‘’']/g, "'…'")
    .replace(/\d+/g, '#')
    .trim();
}

/** 여러 겹으로 싸인 메일에서 글 부분만 꺼낸다. */
function textParts(payload) {
  const got = { plain: '', html: '' };
  (function walk(p) {
    if (!p) return;
    if (p.parts && p.parts.length) { p.parts.forEach(walk); return; }
    if (!p.body || !p.body.data) return;
    if (p.mimeType === 'text/plain' && !got.plain) got.plain = decode(p.body.data);
    if (p.mimeType === 'text/html' && !got.html) got.html = decode(p.body.data);
  })(payload);
  return got;
}

/** 고급 Gmail 서비스는 본문을 바이트 배열로도, web-safe base64 글자로도 준다. 둘 다 받는다. */
function decode(data) {
  let bytes = data;
  if (typeof data === 'string') {
    const pad = (4 - (data.length % 4)) % 4;
    bytes = Utilities.base64DecodeWebSafe(data + '='.repeat(pad));
  }
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 메일 속 클래스룸 주소를 모양만 보인다. 구글 리디렉트(google.com/url?q=)에 싸여 있으면 벗긴다.
 * 8자 넘는 ID 조각은 ‹글자 수› 로 가린다 — 해석 규칙엔 ID 가 어느 자리에 오는지만 필요하다.
 */
function classroomLinks(text) {
  const seen = {};
  const urls = String(text || '').match(/https?:\/\/[^\s"'<>]+/g) || [];
  for (let u of urls) {
    u = u.replace(/&amp;/g, '&');
    const wrapped = u.match(/[?&]q=([^&]+)/);
    if (wrapped && !/^https?:\/\/classroom\.google\.com\//.test(u)) u = decodeURIComponent(wrapped[1]);
    const m = u.match(/classroom\.google\.com(\/[^?#]*)/);
    if (!m) continue;
    seen[m[1].replace(/[A-Za-z0-9_-]{8,}/g, (s) => '‹' + s.length + '›')] = true;
  }
  return Object.keys(seen).slice(0, 6);
}

function oneLine(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function short(e) {
  return oneLine(e && e.message ? e.message : e, 220);
}
