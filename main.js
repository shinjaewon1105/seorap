'use strict';

const {
  app, BrowserWindow, ipcMain, Tray, Menu, Notification, shell, dialog, protocol, nativeImage,
} = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const Recur = require('./shared/recur.js');

// ---------------------------------------------------------------- 경로 / 저장소

const ROOT = __dirname;

/* 자료를 어디에 둘까.

   설치판은 프로그램 속(app.asar)이 **읽기 전용**이라 거기에 쓸 수 없다.
   그때만 사용자 폴더로 간다. 폴더째 들고 다니는 방식은 옆의 `data/` 를 그대로 쓴다.

   ⚠ `app.isPackaged` 로 가르면 안 된다.
   **인자 없이 연 electron.exe 도 그게 true 다.** 서랍.lnk 가 딱 그렇게 연다
   (dist/resources/app 디딤돌). 그래서 폴더째 쓰던 앱이 사용자 폴더를 보게 되고,
   자료가 통째로 사라진 것처럼 보인다. 2026-09-13에 실제로 그렇게 만들었다.
   경로에 app.asar 이 들어 있는지로 가른다 — 이건 설치판에서만 참이다. */
const IN_ASAR = ROOT.split(path.sep).includes('app.asar');
const DATA = IN_ASAR
  ? path.join(app.getPath('userData'), 'data')
  : path.join(ROOT, 'data');
const ATTACH = path.join(DATA, 'attachments');
const EVENTS_FILE = path.join(DATA, 'events.json');
const SETTINGS_FILE = path.join(DATA, 'settings.json');

fs.mkdirSync(ATTACH, { recursive: true });

const HOME = os.homedir();
const DEFAULT_SETTINGS = {
  ollamaUrl: 'http://127.0.0.1:11434',
  // 2026-10-28 부터 qwen3.5:9b 하나로 다 한다. 모델을 지우고 바꿔도 앱이 멈추지 않게
  // 부를 때마다 useModel() 이 설치된 것으로 바로잡는다.
  // 이 모델은 생각 모드가 기본이라, 요청마다 think 를 꼭 정해 줘야 한다(아래 ollamaParse).
  model: 'qwen3.5:9b',
  altModel: 'qwen3.5:9b',
  writeModel: 'qwen3.5:9b',
  // 클래스룸 공지에서 날짜 뽑기. 생각 모드로 돌려야 상대 날짜를 맞힌다(classroom.js).
  extractModel: 'qwen3.5:9b',
  defaultReminder: 10,
  watchFolders: [
    path.join(HOME, 'Desktop'),
    path.join(HOME, 'Documents'),
    path.join(HOME, 'Downloads'),
  ],
};

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return JSON.parse(JSON.stringify(fallback));
  }
}

// 쓰다 죽어도 원본이 남도록 임시 파일에 쓴 뒤 교체한다.
function writeJSONAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

let store = readJSON(EVENTS_FILE,
  { version: 1, events: [], folders: [], notes: [], links: [], files: [] });
if (!Array.isArray(store.events)) store = { version: 1, events: [] };
// 첨부 폴더는 일정마다가 아니라 앱 전체가 함께 쓴다.
if (!Array.isArray(store.folders)) store.folders = [];
if (!Array.isArray(store.notes)) store.notes = [];     // 마감과 별개인 필기
if (!Array.isArray(store.links)) store.links = [];     // 저장해 둔 링크
if (!Array.isArray(store.files)) store.files = [];     // 어느 마감에도 매이지 않은 파일
if (!Array.isArray(store.tombs)) store.tombs = [];     // 지운 것의 흔적 (기기끼리 맞출 때 쓴다)
if (!store.meta || typeof store.meta !== 'object') store.meta = {};

let settings = Object.assign({}, DEFAULT_SETTINGS, readJSON(SETTINGS_FILE, {}));
// 파일은 이제 언제나 원본 자리에 연결한다(2026-11-01). 고르는 칸이 없어졌다.
delete settings.defaultAttachMode;
// 존재하지 않는 감시 폴더는 조용히 버린다.
settings.watchFolders = (settings.watchFolders || []).filter((p) => {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
});

function persistEvents() { writeJSONAtomic(EVENTS_FILE, store); }
function persistSettings() { writeJSONAtomic(SETTINGS_FILE, settings); }

if (!fs.existsSync(EVENTS_FILE)) persistEvents();
if (!fs.existsSync(SETTINGS_FILE)) persistSettings();

// ---------------------------------------------------------------- 첨부파일

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.json': 'application/json',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
};
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif']);

function mimeOf(p) { return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'; }
function isImage(p) { return IMAGE_EXT.has(path.extname(p).toLowerCase()); }

function attachAbsPath(att) {
  if (!att) return null;
  if (att.mode === 'linked') return att.abs || null;
  // 다른 기기가 올린 첨부는 아직 이 PC에 내려오지 않아 rel 이 없다.
  return att.rel ? path.join(DATA, att.rel) : null;
}

function allAttachments() {
  const out = [];
  for (const ev of store.events) for (const a of (ev.attachments || [])) out.push({ ev, a });
  for (const a of store.files) out.push({ ev: null, a });
  return out;
}

function findAttachment(id) {
  for (const ev of store.events) {
    for (const a of (ev.attachments || [])) if (a.id === id) return { ev, a };
  }
  for (const a of store.files) if (a.id === id) return { ev: null, a };
  return null;
}

// 파일 앞부분 1MB + 크기로 만든 지문. 이동한 파일을 다시 찾을 때 쓴다.
function quickHash(p, size) {
  try {
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(Math.min(size, 1024 * 1024));
      fs.readSync(fd, buf, 0, buf.length, 0);
      return crypto.createHash('sha1').update(buf).update(String(size)).digest('hex');
    } finally { fs.closeSync(fd); }
  } catch (e) { return null; }
}

function statInfo(p) {
  const st = fs.statSync(p);
  return {
    size: st.size,
    mtimeMs: Math.round(st.mtimeMs),
    ino: st.ino ? String(st.ino) : null,
    hash: quickHash(p, st.size),
  };
}

function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';
}

function uniqueTarget(dir, base) {
  let target = path.join(dir, base);
  let n = 1;
  while (fs.existsSync(target)) {
    const ext = path.extname(base);
    target = path.join(dir, path.basename(base, ext) + ' (' + (++n) + ')' + ext);
  }
  return target;
}

/* 원본 자리에 두고 경로만 연결한다(linked).

   2026-11-01 부터 컴퓨터의 파일은 **언제나** 이렇게 붙는다. 앱 폴더로 복사해 오는
   "가져오기"는 없앴다(사용자 요청). 앱 폴더(managed)에 생기는 건 원본이 없는 것뿐이다 —
   붙여넣은 그림, 브라우저에서 끌어온 그림, 다른 기기가 올린 파일. */
function linkAttachment(srcPath) {
  return Object.assign({
    id: newId('att'),
    name: path.basename(srcPath),
    mode: 'linked',
    abs: srcPath,
    isImage: isImage(srcPath),
    missing: false,
    addedAt: new Date().toISOString(),
  }, statInfo(srcPath));
}

// ---------------------------------------------------------------- 파일 감시 / 재연결

let win = null;              // 가장 최근에 만진 창 (트레이·알림이 되살릴 대상)
const wins = new Set();      // 열려 있는 창 전부
const watchers = [];

// 창이 여럿이면 한쪽에서 고친 것을 나머지도 알아야 한다.
function notifyRenderer(channel, payload, exceptId) {
  for (const w of wins) {
    if (w.isDestroyed()) continue;
    if (exceptId && w.webContents.id === exceptId) continue;
    w.webContents.send(channel, payload);
  }
}

let verifyTimer = null;
function scheduleVerify(delay) {
  clearTimeout(verifyTimer);
  verifyTimer = setTimeout(verifyAttachments, delay || 400);
}

// 모든 첨부의 존재 여부와 수정 시각을 확인하고, 사라진 것은 감시 폴더에서 찾아 다시 연결한다.
function verifyAttachments() {
  let changed = false;
  const missing = [];

  for (const pair of allAttachments()) {
    const a = pair.a;
    const p = attachAbsPath(a);
    let st = null;
    try { st = p ? fs.statSync(p) : null; } catch (e) { st = null; }

    if (!st || !st.isFile()) {
      if (!a.missing) { a.missing = true; a.diskAt = Date.now(); changed = true; }
      // 다른 기기가 올려서 아직 이 PC에 안 내려온 것(rel 도 abs 도 없음)은 찾으러 다니지 않는다.
      if (!p) continue;
      missing.push(a);
      continue;
    }
    if (a.missing) { a.missing = false; a.diskAt = Date.now(); changed = true; }
    const m = Math.round(st.mtimeMs);
    if (a.mtimeMs !== m || a.size !== st.size) {
      a.diskAt = Date.now();
      a.mtimeMs = m;
      a.size = st.size;
      a.ino = st.ino ? String(st.ino) : a.ino;
      a.hash = quickHash(p, st.size);
      // 이름은 건드리지 않는다 — 자리는 그대로이고, 앱에서 바꿔 둔 이름일 수 있다.
      changed = true;
    }
  }

  // 감시 폴더에서 막 생기거나 이름이 바뀐 파일부터 맞춰 본다. 옮긴 파일은 대개 여기서 찾는다.
  const fresh = Array.from(touched);
  touched.clear();
  if (missing.length && fresh.length && relinkFrom(missing, fresh)) changed = true;

  if (changed) {
    persistEvents();
    notifyRenderer('attachments:changed', null);
  }

  // 그래도 못 찾은 것은 감시 폴더 전체를 훑는다 — 무겁다(3만 개에 1.4초).
  // 예전에는 이걸 2분마다, 바탕화면에서 무엇이 바뀔 때마다 **메인 스레드에서 동기로** 돌려
  // 사라진 파일이 하나만 있어도 앱이 수시로 굳었다. 이제 비동기로, 사라진 목록이 바뀌었거나
  // 30분이 지났을 때만 한다.
  const still = missing.filter((a) => a.missing && (a.ino || a.hash));
  const sig = still.map((a) => a.id).sort().join('|');
  if (still.length && !walking && (sig !== lastWalk.sig || Date.now() - lastWalk.at > 30 * 60000)) {
    lastWalk = { sig, at: Date.now() };
    walking = true;
    walkForMissing(still).then((found) => {
      if (!found) return;
      persistEvents();
      notifyRenderer('attachments:changed', null);
    }).catch(() => {}).finally(() => { walking = false; });
  }
}

const touched = new Set();           // 감시 폴더에서 최근에 생기거나 이름이 바뀐 경로
let walking = false;
let lastWalk = { sig: '', at: 0 };

/* 사라진 첨부 a 와 디스크의 파일 p(st) 가 같은 파일인가 — NTFS 파일 ID 또는 지문.
   ⚠ 파일 ID 만 보면 안 된다. Node 는 64비트 ID 를 보통 숫자로 줘서 뒷자리가 잘리고,
   지운 파일의 자리를 새 파일이 물려받기도 해서 **다른 파일과 ID 가 겹친다**(실제로 겪었다 —
   지운 시험 파일의 기록이 엉뚱한 새 파일에 붙었다). 옮기기는 크기를 바꾸지 않으니 크기도 본다. */
function sameFile(cands, p, st) {
  const inoKey = st.ino ? String(st.ino) : null;
  let hit = inoKey ? cands.find((a) => a.missing && a.ino === inoKey && a.size === st.size) : null;
  if (!hit) {
    const bySize = cands.filter((a) => a.missing && a.hash && a.size === st.size);
    if (bySize.length) {
      const h = quickHash(p, st.size);
      hit = bySize.find((a) => a.hash === h) || null;
    }
  }
  return hit;
}

function relinkTo(hit, p, st) {
  const old = attachAbsPath(hit);
  // 앱에서 따로 붙인 이름이 아니면 디스크에서 바뀐 이름을 따라간다.
  if (!old || hit.name === path.basename(old)) hit.name = path.basename(p);
  hit.abs = p;
  hit.mode = 'linked';
  hit.missing = false;
  hit.ino = st.ino ? String(st.ino) : null;
  hit.mtimeMs = Math.round(st.mtimeMs);
  hit.isImage = isImage(p);
  hit.diskAt = Date.now();
  delete hit.rel;
}

function relinkFrom(missing, paths) {
  let found = false;
  for (const p of paths) {
    let st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (!st.isFile()) continue;
    const hit = sameFile(missing, p, st);
    if (hit) { relinkTo(hit, p, st); found = true; }
  }
  return found;
}

const WALK_SKIP = new Set(['node_modules', '.git', 'AppData', '$RECYCLE.BIN', 'System Volume Information']);

// 감시 폴더를 비동기로 훑어 사라진 첨부와 같은 파일을 찾는다. 화면을 멈추지 않는다.
async function walkForMissing(targets) {
  let found = false;
  let seen = 0;
  const walk = async (dir, depth) => {
    if (depth > 8 || seen > 60000 || !targets.some((a) => a.missing)) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      if (ent.name.charAt(0) === '.' || WALK_SKIP.has(ent.name)) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { await walk(p, depth + 1); continue; }
      if (!ent.isFile()) continue;
      seen++;
      let st;
      try { st = await fsp.stat(p); } catch (err) { continue; }
      const hit = sameFile(targets, p, st);
      if (hit) { relinkTo(hit, p, st); found = true; }
    }
  };
  for (const r of settings.watchFolders) await walk(r, 0);
  return found;
}

function startWatchers() {
  while (watchers.length) {
    try { watchers.pop().close(); } catch (e) { /* 이미 닫힘 */ }
  }
  const dirs = [ATTACH].concat(settings.watchFolders);
  for (const dir of dirs) {
    try {
      // Windows는 recursive 감시를 OS가 직접 지원해서 초기 스캔 없이 가볍다.
      const w = fs.watch(dir, { recursive: true }, (type, name) => {
        if (type === 'rename' && name && touched.size < 500) touched.add(path.join(dir, String(name)));
        scheduleVerify(600);
      });
      w.on('error', () => {});
      watchers.push(w);
    } catch (e) {
      console.warn('[watch] 실패:', dir, e.message);
    }
  }
}

// ---------------------------------------------------------------- Ollama

const PARSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    date: { type: 'string' },
    startTime: { type: 'string' },
    endTime: { type: 'string' },
    allDay: { type: 'boolean' },
    location: { type: 'string' },
    description: { type: 'string' },
    repeatFreq: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'] },
    repeatWeekdays: { type: 'array', items: { type: 'integer' } },
    repeatUntil: { type: 'string' },
  },
  required: ['title', 'date', 'allDay', 'startTime', 'endTime', 'location', 'description', 'repeatFreq'],
};

const WD_KO = ['월', '화', '수', '목', '금', '토', '일'];

function pad2(n) { return String(n).padStart(2, '0'); }

function systemPrompt() {
  const now = new Date();
  const today = Recur.toISO(now);
  const wd = WD_KO[Recur.weekday(today) - 1];
  return [
    '너는 한국어 일정 문장을 JSON으로 바꾸는 변환기다. 설명이나 인사 없이 JSON만 출력한다.',
    '오늘은 ' + today + ' ' + wd + '요일이고, 지금 시각은 ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ' 이다.',
    '',
    '규칙:',
    '- date는 반드시 YYYY-MM-DD 형식. "오늘/내일/모레/다음주 화요일/이번 주 금요일" 같은 표현을 오늘 기준으로 실제 날짜로 계산한다.',
    '- 요일만 주어지면 오늘 이후로 가장 가까운 그 요일을 고른다.',
    '- startTime, endTime은 24시간 HH:MM 형식. "오후 3시"는 15:00, "저녁 7시"는 19:00, "아침 8시"는 08:00.',
    '- 시간 언급이 전혀 없으면 allDay는 true, startTime과 endTime은 빈 문자열 "".',
    '- 시작 시간만 있으면 endTime은 시작 시간 + 1시간.',
    '- title은 일정 이름만 짧게. 날짜나 시간 표현은 title에 넣지 않는다.',
    '- location은 장소가 명시됐을 때만 채운다. 없으면 "".',
    '- description은 제목·시간·장소를 뺀 나머지 메모. 없으면 "".',
    '- 반복 표현(매일/매주/매달/매년)이 있으면 repeatFreq를 정하고, 없으면 "none".',
    '- repeatWeekdays는 1=월 2=화 3=수 4=목 5=금 6=토 7=일. 매주 반복일 때만 채운다.',
    '- repeatUntil은 "~까지"가 명시된 경우만 YYYY-MM-DD, 아니면 "".',
  ].join('\n');
}

async function ollamaFetch(pathname, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 120000);
  try {
    return await fetch(settings.ollamaUrl + pathname, Object.assign({}, init, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function ollamaStatus() {
  try {
    const res = await ollamaFetch('/api/tags', {}, 5000);
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status, models: [] };
    const j = await res.json();
    return {
      ok: true,
      models: (j.models || []).map((m) => m.name),
      model: settings.model,
      altModel: settings.altModel,
    };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '응답 없음' : e.message, models: [] };
  }
}

/* 부르려는 모델이 설치돼 있지 않으면 설치된 것으로 바꾼다.

   2026-10-28 에 qwen3.5:4b 를 지우고 9b 로 바꿨는데 설정은 4b 를 그대로 가리켜서
   자연어 입력 · 클래스룸 날짜 뽑기가 "model not found" 로 전부 죽어 있었다.
   설정에 적힌 이름이 사라졌으면 설정도 함께 고쳐 둔다 — 다음부터는 묻지 않는다. */
async function useModel(wanted, key) {
  const st = await ollamaStatus();
  if (!st.ok) throw new Error('Ollama에 연결하지 못했습니다 (' + st.error + ')');
  const want = wanted || settings[key] || settings.model;
  if (st.models.includes(want)) return { model: want, fellBack: false };
  const alt = st.models.includes(settings.model) ? settings.model : st.models[0];
  if (!alt) throw new Error('설치된 모델이 없습니다.');
  let healed = false;
  for (const k of ['model', 'altModel', 'writeModel', 'extractModel']) {
    if (!st.models.includes(settings[k])) { settings[k] = alt; healed = true; }
  }
  if (healed) persistSettings();
  return { model: alt, fellBack: want };
}

/* ⚠ think: false 를 빼면 안 된다. qwen3.5 는 생각 모드가 기본이라, 안 정하면 num_predict 를
   생각에 다 쓰고 빈 답을 낸다 — 자연어 입력 · 메모 정리 · 파일 나누기 셋 다 그랬다(2026-10-27 실측).
   끄면 2~5초에 제대로 낸다. 날짜는 어차피 nl.js 해석기가 다시 계산한다.
   생각을 못 하는 모델(horam 등)에 false 를 보내도 그냥 받는다(확인함). */
async function ollamaParse(text, modelWanted) {
  const { model } = await useModel(modelWanted, 'model');
  const body = {
    model,
    stream: false,
    think: false,
    format: PARSE_SCHEMA,
    keep_alive: '30m',
    options: { temperature: 0, num_predict: 400 },
    messages: [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: String(text).slice(0, 2000) },
    ],
  };
  const res = await ollamaFetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, 180000);

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Ollama 오류 ' + res.status + (t ? ': ' + t.slice(0, 200) : ''));
  }
  const j = await res.json();
  const content = (j.message && j.message.content) || '';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('모델이 JSON을 돌려주지 않았습니다.');
    parsed = JSON.parse(m[0]);
  }
  return { raw: parsed, model: body.model };
}

// ------------------------------------------------- 공지 글 → 날짜 (클래스룸)

const EXTRACT_TOOLS = [{
  type: 'function',
  function: {
    name: 'add_deadline',
    description: '챙겨야 할 날짜 하나를 적는다',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '무엇을 해야 하는지 짧게. 날짜 표현은 빼고' },
        phrase: { type: 'string', description: '공지 원문에서 그 날짜를 말한 부분을 글자 그대로' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['title', 'phrase', 'date'],
    },
  },
}];

/* 학교 공지에서 챙겨야 할 날짜를 뽑는다. 4B 모델은 **생각 모드를 켜야** 상대 날짜를 맞힌다
   — "다음 주 수요일" 이 든 시험에서 끄면 1/4, 켜면 4/4 (2026-10-27 실측).
   ⚠ 생각 모드에 `format`(JSON 스키마)을 같이 주면 안 된다. 생각이 끝나지 않아
   공지 한 편에 275초를 쓰고 빈 답을 냈다. 도구 호출로 받으면 10초 안팎이다.
   phrase(원문에서 날짜를 말한 부분)를 같이 받는 건 화면 쪽 한국어 해석기가
   그걸 다시 읽어 날짜를 맞춰 보기 위해서다(classroom.js 의 checkDate). */
async function ollamaExtract(text, base, modelWanted) {
  const { model } = await useModel(modelWanted, 'extractModel');
  const wd = WD_KO[Recur.weekday(base) - 1];
  const body = {
    model,
    stream: false,
    think: true,
    tools: EXTRACT_TOOLS,
    keep_alive: '30m',
    // 생각이 길어져도 여기서 끊는다 — 보통 300토큰 안팎이다.
    options: { temperature: 0, num_ctx: 8192, num_predict: 2500 },
    messages: [
      {
        role: 'system',
        content: [
          '너는 학교 공지에서 학생이 챙겨야 할 날짜를 찾아 add_deadline 도구로 하나씩 적는다.',
          '제출 마감, 준비물을 가져올 날, 시험 · 평가 · 발표 · 대회 날을 모두 따로 적는다.',
          '이 공지가 올라온 날은 ' + base + ' ' + wd + '요일이다. "내일", "다음 주 수요일" 같은 말은 이 날을 기준으로 계산한다.',
          '날짜가 정해진 일이 없으면 도구를 부르지 않는다. 날짜가 바뀌었으면 바뀐 날짜만 적는다.',
        ].join('\n'),
      },
      { role: 'user', content: String(text).slice(0, 3000) },
    ],
  };
  const res = await ollamaFetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, 150000);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Ollama 오류 ' + res.status + (t ? ': ' + t.slice(0, 200) : ''));
  }
  const j = await res.json();
  const items = ((j.message && j.message.tool_calls) || []).map((c) => {
    const a = c.function && c.function.arguments;
    if (typeof a !== 'string') return a || {};
    try { return JSON.parse(a); } catch (e) { return {}; }
  });
  return { items, model };
}

// ---------------------------------------------------------------- 클래스룸

/* 학교 계정의 Apps Script 웹 앱(gas/클래스룸)에서 과제를 받아 온다.
   주소와 비밀값은 data/classroom.json 에만 둔다 — 화면(renderer)으로는 넘기지 않는다.
   비밀값은 주소가 아니라 POST 본문에 넣는다. 주소는 이곳저곳 기록에 남는다. */
const CLASSROOM_FILE = path.join(DATA, 'classroom.json');

function classroomConfig() {
  const c = readJSON(CLASSROOM_FILE, {});
  return (c && c.url && c.secret) ? c : null;
}

/* 기록.txt 에 "fetch failed" 만 수십 줄 쌓여 있었다. 다시 해 보면 멀쩡히 된다(2026-11-01, 12초에
   과제 104개) — 노트북이 잠에서 막 깨어 아직 인터넷이 없을 때 걸린 것이다.
   그래서 연결 자체가 안 될 때만 잠시 뒤 두 번 더 해 보고, 그래도 안 되면 원인 코드까지 적는다. */
async function classroomFetch() {
  let r = null;
  for (const wait of [0, 20000, 60000]) {
    if (wait) await new Promise((ok) => setTimeout(ok, wait));
    r = await classroomFetchOnce();
    if (!r.net) break;
  }
  delete r.net;
  return r;
}

async function classroomFetchOnce() {
  const cfg = classroomConfig();
  if (!cfg) return { ok: false, off: true, error: '연결 안 됨' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 150000);
  try {
    // Apps Script 는 302 로 결과가 있는 주소를 알려 준다. fetch 가 GET 으로 따라간다.
    const res = await fetch(cfg.url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: cfg.secret }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      // 로그인 화면이 오면 웹 앱 액세스가 "모든 사용자" 가 아닌 것이다.
      const login = /accounts\.google\.com|ServiceLogin/.test(text);
      return {
        ok: false,
        error: login ? '웹 앱이 로그인을 요구합니다 (액세스를 "모든 사용자" 로)'
          : 'JSON 이 아닌 응답 (HTTP ' + res.status + ')',
      };
    }
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: '응답 없음' };
    const why = e.cause && (e.cause.code || e.cause.message);
    return { ok: false, net: true, error: e.message + (why ? ' (' + why + ')' : '') };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------- 메모 서식 정리 (스트리밍)

// 모델의 역할은 "서식만 입히기"로 한정한다. 글을 새로 쓰게 두면 없는 사실을
// 지어내거나, 사용자가 할 일로 적어둔 것을 대신 해 버린다(실측으로 확인).
// 예시는 반드시 시스템 프롬프트 안에 둔다. user/assistant 대화 턴으로 주면
// 모델이 그것을 앞선 대화로 여겨 예시 내용(우유·계란…)을 결과에 흘린다(실측 확인).
const FORMAT_SYS = [
  '너는 사용자가 급하게 적어둔 메모에 Markdown 서식을 입히는 도구다.',
  '너는 글쓴이가 아니다. 편집자도 아니다. 서식만 입힌다.',
  '',
  '== 절대 하지 말 것 ==',
  '- 사용자가 쓰지 않은 내용을 한 글자도 추가하지 마라. 설명, 예시, 공식 유도, 배경 지식 모두 금지다.',
  '- 사용자가 "~해야 함", "~써야 함", "~정리하기" 처럼 앞으로 할 일을 적어 두었으면,',
  '  그 일을 네가 대신 해 주면 안 된다. 할 일 항목으로만 남겨라.',
  '- 문장을 제목으로 바꾸지 마라. 문장은 문장 그대로 남긴다.',
  '- 내용을 요약하거나 줄이지 마라. 낱말 하나도 버리지 마라. 숫자는 특히 그대로 옮겨라.',
  '- 인사말이나 "정리했습니다" 같은 말을 붙이지 마라. 본문만 낸다.',
  '- 전체를 ``` 로 감싸지 마라.',
  '',
  '== 서식 ==',
  '원문의 글자는 그대로 두고 서식 기호만 더한다. 그래서 결과는 원문보다 조금만 길어야 한다.',
  '- 여러 개가 나열되면 - 목록으로 나눈다.',
  '- 준비물이나 해야 할 일은 - [ ] 로 만든다.',
  '- 덩어리가 뚜렷하게 나뉠 때만 ### 소제목을 붙인다.',
  '- 핵심 낱말만 **굵게** 한다.',
  '- 코드는 ``` 로 감싸고 언어 이름을 붙인다. 원문에 있는 코드만 감싼다.',
  '- 원문이 표 모양으로 나열되어 있으면 Markdown 표로 만든다.',
  '',
  '== 수식 ==',
  '수식만은 예외다. 대충 적은 식을 KaTeX가 읽는 LaTeX로 고쳐서 $...$ 안에 넣어라.',
  '여기서는 글자를 바꿔도 된다. 오히려 바꿔야 한다.',
  '다만 식의 뜻을 바꾸지 마라. 숫자와 부호는 원문 그대로 옮겨라.',
  '- 나눗셈은 분수로: (a+b)/c 는 $\\frac{a+b}{c}$',
  '- 3분의 1 은 $\\frac{1}{3}$',
  '- 아래첨자는 _, 위첨자는 ^: m1 은 $m_1$, x^2 는 $x^2$',
  '- 그리스 문자는 명령으로: mu 는 \\mu, 파이 는 \\pi, 세타 는 \\theta, alpha 는 \\alpha',
  '- 루트/제곱근은 \\sqrt{}, 적분은 \\int, 시그마/합은 \\sum, 극한은 \\lim',
  '- 플러스마이너스/플마 는 \\pm, 곱셈점은 \\cdot, 이상/이하는 \\ge \\le, 같지않음은 \\ne',
  '- 단위는 \\mathrm{}: 3.42 m/s 는 $3.42\\,\\mathrm{m/s}$',
  '- 적분·합의 범위는 아래위첨자로: 0부터 1까지 적분은 $\\int_{0}^{1}$',
  '- 30도 는 $30^\\circ$',
  '- 한 줄을 통째로 차지하는 큰 식은 $$...$$ 로 감싼다.',
  '- 수식이 아닌 것을 수식으로 만들지 마라. 날짜 2026-09-04, 가격 5만원, 5부 같은 것은 그대로 둔다.',
  '',
  '== 형식 예시 ==',
  '아래는 "어떻게 생긴 결과를 내야 하는지"만 보여주는 예시다.',
  '예시에 나오는 낱말(우유, 계란, 영수증, 속도, 중력가속도 같은 것)은',
  '사용자의 메모가 아니다. 결과에 절대 넣지 마라.',
  '',
  '--- 예시 1 입력 ---',
  '장보기 우유 계란 빵 사야함 그리고 영수증 정리하는거 잊지말기 이번주 예산은 5만원인데 좀 빠듯하다',
  '--- 예시 1 출력 ---',
  '### 장보기',
  '',
  '- [ ] 우유',
  '- [ ] 계란',
  '- [ ] 빵',
  '- [ ] 영수증 정리하는거 잊지말기',
  '',
  '이번주 예산은 **5만원**인데 좀 빠듯하다',
  '',
  '--- 예시 2 입력 ---',
  '물리 정리 속도는 v = s/t 이고 운동에너지는 2분의 1 m v제곱 중력가속도 g는 9.8 m/s^2 세타가 30도일때 sin값 2분의 1',
  '--- 예시 2 출력 ---',
  '### 물리 정리',
  '',
  '- 속도: $v = \\frac{s}{t}$',
  '- 운동에너지: $\\frac{1}{2} m v^{2}$',
  '- 중력가속도: $g = 9.8\\,\\mathrm{m/s^{2}}$',
  '- $\\theta = 30^\\circ$ 일 때 $\\sin\\theta = \\frac{1}{2}$',
  '',
  '--- 예시 끝 ---',
  '',
  '이제부터 사용자가 보내는 것이 진짜 메모다. 그것만 정리해라.',
].join('\n');

let formatCtrl = null;

function stopFormat() {
  if (formatCtrl) {
    try { formatCtrl.abort(); } catch (e) { /* 이미 끝났을 수 있다 */ }
    formatCtrl = null;
  }
}

// prev + missing 이 주어지면 "빠진 것 채워서 다시" 두 번째 패스로 돈다.
async function ollamaFormat(sender, reqId, text, modelWanted, prev, missing) {
  stopFormat();
  const ctrl = new AbortController();
  formatCtrl = ctrl;

  // 설치되어 있지 않은 모델을 부르면 그냥 실패하므로 미리 확인하고 물러선다.
  const { model, fellBack } = await useModel(modelWanted, 'writeModel');

  // 서식만 입히는 일이라 원문보다 아주 길어질 이유가 없다.
  const cap = Math.min(2000, Math.max(300, Math.round(text.length * 2.5)));

  const messages = [
    { role: 'system', content: FORMAT_SYS },
    { role: 'user', content: text },
  ];

  // 두 번째 패스: 무엇이 빠졌는지 짚어 주고 그것만 채워 넣게 한다.
  if (prev && Array.isArray(missing) && missing.length) {
    messages.push({ role: 'assistant', content: prev });
    messages.push({
      role: 'user',
      content: [
        '방금 결과에서 원문의 다음 내용이 빠졌다:',
        missing.map((m) => '- ' + m).join('\n'),
        '',
        '빠진 것들을 원문에서 그대로 가져와 알맞은 자리에 넣고, 전체를 다시 내라.',
        '이미 잘 들어간 부분은 건드리지 마라. 새로운 내용은 여전히 만들지 마라.',
      ].join('\n'),
    });
  }

  const res = await fetch(settings.ollamaUrl + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: ctrl.signal,
    body: JSON.stringify({
      model,
      stream: true,
      think: false,              // 이유는 ollamaParse 위 — 켜 두면 빈 답이 온다
      keep_alive: '30m',
      options: { temperature: 0.1, num_predict: cap, repeat_penalty: 1.15 },
      messages,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Ollama 오류 ' + res.status + (t ? ': ' + t.slice(0, 200) : ''));
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let full = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let j;
        try { j = JSON.parse(line); } catch (e) { continue; }
        const delta = j.message && j.message.content;
        if (delta) {
          full += delta;
          if (!sender.isDestroyed()) sender.send('format:chunk', { id: reqId, delta });
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') return { text: full, model, stopped: true, fellBack };
    throw e;
  } finally {
    if (formatCtrl === ctrl) formatCtrl = null;
  }

  return { text: cleanFormatted(full), model, stopped: false, fellBack };
}

// 모델이 가끔 규칙을 어기고 붙이는 껍데기를 걷어낸다.
function cleanFormatted(s) {
  let t = String(s || '').trim();
  // 전체를 코드 펜스로 감싼 경우
  const fence = t.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```$/i);
  if (fence) t = fence[1].trim();
  // "네, 정리했습니다." 같은 첫 줄 인사말
  t = t.replace(/^(네[,.!]?\s*)?(다음은|아래는)?[^\n]{0,40}(정리(해\s*)?(했|드렸|드립니다|하겠습니다)|알겠습니다)[^\n]{0,20}[:：]?\s*\n+/i, '');
  return t.trim();
}

// ------------------------------------------------ 첨부파일 폴더 나누기 (AI)

// 앱 안에서만 쓰는 폴더다. 디스크의 파일은 한 발짝도 움직이지 않는다.
const ORGANIZE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          folder: { type: 'string' },
        },
        required: ['file', 'folder'],
      },
    },
  },
  required: ['items'],
};

// 예시를 대화 턴이 아니라 여기 글로 넣는다(턴으로 주면 예시 파일 이름이 결과로 샌다).
// "되도록 다 넣어라"를 넣기 전에는 여덟 개 중 여덟 개를 맨 위에 그대로 두는 일이 잦았다.
const ORGANIZE_SYS = [
  '너는 첨부파일을 폴더로 나누는 도구다. JSON만 낸다.',
  '',
  '== 지켜야 할 것 ==',
  '- 주어진 파일 이름을 한 글자도 바꾸지 말고 그대로 file 에 옮겨 적어라.',
  '- 목록에 있는 파일을 하나도 빠뜨리지 마라. 없는 파일을 지어내지도 마라.',
  '- folder 는 한국어로 짧게. 두 낱말을 넘지 않는다.',
  '- 하위 폴더는 슬래시로. 예: "자료/사진". 두 단계까지만.',
  '',
  '== 어떻게 묶나 ==',
  '- 되도록 모든 파일이 어느 폴더엔가 들어가게 하라. 맨 위에 남기는 건 정말 애매한 것만이다.',
  '- 하는 일이 같은 것끼리 묶어라. 예를 들면',
  '  · 글로 된 것(보고서, 논문, 계획서) → "문서"',
  '  · 사진과 그림 → "사진"',
  '  · 표와 수치(엑셀, csv) → "데이터"',
  '  · 발표에 쓰는 것(슬라이드, 대본) → "발표"',
  '- 다만 이 이름을 그대로 쓸 필요는 없다. 파일 이름을 보고 더 어울리는 말이 있으면 그걸 써라.',
  '- 폴더는 2~4개가 알맞다. 파일 하나만 드는 폴더는 만들지 마라.',
  '- 파일이 3개 이하면 나눌 것 없이 전부 "" 로 둔다.',
  '- 확장자나 일정 제목을 그대로 폴더 이름으로 쓰지 마라.',
  '',
  '== 보기 ==',
  '아래는 형식을 보여주는 예시일 뿐이다. 이 파일 이름을 결과에 넣지 마라.',
  '입력: 계약서.pdf / 사무실사진.jpg / 견적서.xlsx / 회의록.docx / 도면.png / 예산표.xlsx',
  '출력: 계약서.pdf→"문서", 회의록.docx→"문서", 사무실사진.jpg→"사진", 도면.png→"사진",',
  '      견적서.xlsx→"데이터", 예산표.xlsx→"데이터"',
].join('\n');

async function ollamaOrganize(files, context, modelWanted, wish) {
  const { model, fellBack } = await useModel(modelWanted, 'writeModel');

  const list = files.map((f, i) => (i + 1) + '. ' + f.name
    + (f.isImage ? '  (이미지)' : '')).join('\n');

  const res = await ollamaFetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,              // 이유는 ollamaParse 위 — 켜 두면 빈 답이 온다
      format: ORGANIZE_SCHEMA,
      keep_alive: '30m',
      options: { temperature: 0.2, num_predict: 700 },
      messages: [
        { role: 'system', content: ORGANIZE_SYS },
        {
          role: 'user',
          content: [
            context ? '일정: ' + context : '',
            // 사용자가 어떻게 나눌지 적어 두었으면 그것이 위의 일반 규칙보다 앞선다.
            wish ? '이렇게 나눠라 — 이 지시를 무엇보다 먼저 따라라: ' + wish : '',
            '파일 ' + files.length + '개:',
            list,
          ].filter(Boolean).join('\n'),
        },
      ],
    }),
  }, 180000);

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Ollama 오류 ' + res.status + (t ? ': ' + t.slice(0, 200) : ''));
  }
  const j = await res.json();
  const content = (j.message && j.message.content) || '';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('모델이 JSON을 돌려주지 않았습니다.');
    parsed = JSON.parse(m[0]);
  }
  return { items: Array.isArray(parsed.items) ? parsed.items : [], model, fellBack };
}

// ---------------------------------------------------------------- 알림

const notified = new Set();

function showReminder(ev, date, hhmm) {
  const detail = [hhmm || '종일', ev.location].filter(Boolean).join('  ·  ');
  const n = new Notification({
    title: (ev.kind === 'event' ? '' : '마감 · ') + (ev.title || '제목 없음'),
    body: detail,
  });
  n.on('click', () => {
    showWindow();
    notifyRenderer('open:event', { id: ev.id, date });
  });
  n.show();
}

function parseAt(str) {
  const m = String(str || '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
}

function reminderTick() {
  const now = new Date();
  const today = Recur.toISO(now);

  // ① 시각을 직접 정해 둔 알림
  for (const ev of store.events) {
    if (!ev.reminderAt) continue;
    const at = parseAt(ev.reminderAt);
    if (!at) continue;
    if (now.getTime() < at.getTime()) continue;
    if (now.getTime() - at.getTime() > 90000) continue;   // 너무 지난 건 넘어간다
    const key = ev.id + '@at:' + ev.reminderAt;
    if (notified.has(key)) continue;
    notified.add(key);
    showReminder(ev, ev.date, ev.allDay ? '' : ev.startTime);
  }

  // ② "몇 분 전" 알림. 일주일 전 같은 것도 잡히도록 넉넉히 펼친다.
  const list = Recur.expandAll(store.events, Recur.addDays(today, -1), Recur.addDays(today, 8));
  for (const occ of list) {
    const mins = occ.reminder;
    if (mins === null || mins === undefined || occ.reminderAt) continue;
    // 종일 마감은 시각이 없으므로 그날 아침 9시를 기준으로 센다.
    const hhmm = occ.allDay ? '09:00' : occ.startTime;
    if (!hhmm) continue;

    const parts = hhmm.split(':').map(Number);
    const start = Recur.fromISO(occ.date);
    start.setHours(parts[0] || 0, parts[1] || 0, 0, 0);

    const fireAt = start.getTime() - mins * 60000;
    if (now.getTime() < fireAt) continue;
    if (now.getTime() - fireAt > 90000) continue;         // 놓친 건 다시 울리지 않는다
    if (notified.has(occ.key)) continue;
    notified.add(occ.key);
    showReminder(Store_get(occ.id) || occ, occ.date, occ.allDay ? '' : occ.startTime);
  }

  if (notified.size > 500) notified.clear();
}

function Store_get(id) { return store.events.find((e) => e.id === id) || null; }

// ---------------------------------------------------------------- 창 / 트레이

let tray = null;
let quitting = false;

const ICON_FILE = path.join(ROOT, 'build', 'icon.ico');

let iconCache = null;
function appIcon() {
  if (iconCache) return iconCache;
  if (fs.existsSync(ICON_FILE)) {
    const img = nativeImage.createFromPath(ICON_FILE);
    if (!img.isEmpty()) { iconCache = img; return iconCache; }
  }
  iconCache = fallbackIcon();
  return iconCache;
}

// 아이콘 파일이 없어도 앱이 뜨도록 하는 대비책.
function fallbackIcon() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 32 32">'
    + '<rect x="3" y="3" width="26" height="26" rx="6" fill="#1a73e8"/>'
    + '<rect x="7.5" y="8" width="17" height="7" rx="2.4" fill="#ffffff"/>'
    + '<rect x="7.5" y="17" width="17" height="7" rx="2.4" fill="#ffffff" opacity="0.65"/>'
    + '<rect x="14" y="10.9" width="4" height="1.3" rx="0.6" fill="#1a73e8"/>'
    + '<rect x="14" y="19.9" width="4" height="1.3" rx="0.6" fill="#1557b0"/>'
    + '</svg>';
  return nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
}

function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// 창은 여러 개 띄울 수 있다(Ctrl+N). 같은 데이터를 보고, 한쪽이 고치면 나머지가 따라온다.
function createWindow(opts) {
  const first = wins.size === 0;
  const w = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 360,
    minHeight: 480,
    show: false,
    backgroundColor: '#ffffff',
    title: '서랍',
    icon: appIcon(),
    autoHideMenuBar: true,
    // 크롬처럼 창 맨 위가 탭이 되도록 제목 표시줄을 우리가 그린다.
    // 최소화·최대화·닫기 단추는 Windows 가 오른쪽에 그대로 얹어 준다.
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  wins.add(w);
  win = w;

  // 새로 연 창은 앞 창에서 조금 어긋나게 놓아야 겹쳐 보이지 않는다.
  if (!first) {
    const b = w.getBounds();
    const n = wins.size - 1;
    w.setBounds({ x: b.x + n * 28, y: b.y + n * 28, width: b.width, height: b.height });
  }

  w.setMenuBarVisibility(false);
  // 어느 화면을 열고 시작할지 창마다 다르게 줄 수 있다.
  const q = opts && opts.open ? '?open=' + encodeURIComponent(opts.open) : '';
  w.loadURL('appfile://app/index.html' + q);
  // 창을 언제 보여줄 것인가 —
  // 그림이 준비되면 연다. 신호를 못 받는 경우를 대비해 두 겹으로 받쳐 둔다.
  let shown = false;
  const reveal = () => {
    if (shown || w.isDestroyed()) return;
    shown = true;
    w.show();
    w.focus();
  };
  w.once('ready-to-show', reveal);
  w.webContents.once('did-finish-load', () => setTimeout(reveal, 50));
  setTimeout(reveal, 3000);

  // ILJEONG_DEBUG=1 로 실행하면 화면 쪽 콘솔을 터미널로 끌어온다.
  if (process.env.ILJEONG_DEBUG) {
    const LV = ['log', 'warn', 'error'];
    w.webContents.on('console-message', (e, level, message, line, sourceId) => {
      console.log('[renderer:' + (LV[level] || level) + '] ' + message
        + '  (' + String(sourceId).split('/').pop() + ':' + line + ')');
    });
    w.webContents.on('render-process-gone', (e, d) => console.log('[renderer gone]', d));
    w.webContents.on('did-fail-load', (e, code, desc, url) =>
      console.log('[load fail]', code, desc, url));
  }








  // F12 로 개발자 도구를 연다(메뉴 막대를 숨겨 두었으므로).
  w.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      w.webContents.toggleDevTools();
      e.preventDefault();
    }
  });

  // 첫 창은 X를 눌러도 트레이로 내려갈 뿐이다(알림을 계속 보내야 한다).
  // 나중에 연 창은 브라우저처럼 그냥 닫힌다.
  w.on('close', (e) => {
    if (!quitting && first && wins.size === 1) { e.preventDefault(); w.hide(); }
  });
  w.on('closed', () => {
    wins.delete(w);
    if (win === w) win = wins.values().next().value || null;
  });
  w.on('focus', () => { win = w; });

  w.webContents.setWindowOpenHandler((d) => {
    if (/^https?:/.test(d.url)) shell.openExternal(d.url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (url.indexOf('appfile://app/') !== 0) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
}

function createTray() {
  tray = new Tray(appIcon());
  tray.setToolTip('서랍');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '일정 열기', click: showWindow },
    { type: 'separator' },
    { label: '데이터 폴더 열기', click: () => shell.openPath(DATA) },
    { type: 'separator' },
    { label: '완전히 종료', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

// ---------------------------------------------------------------- 커스텀 프로토콜

protocol.registerSchemesAsPrivileged([{
  scheme: 'appfile',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

function registerProtocol() {
  const RENDERER = path.join(ROOT, 'renderer');
  protocol.handle('appfile', async (req) => {
    const url = new URL(req.url);
    const host = url.hostname;
    const rest = decodeURIComponent(url.pathname).replace(/^\/+/, '');

    try {
      if (host === 'app') {
        // shared/ 는 메인 프로세스와 같이 쓰는 모듈. CSP 'self' 안에 들어오도록
        // 같은 호스트의 하위 경로로 내보낸다.
        const shared = rest.indexOf('shared/') === 0;
        const base = shared ? path.join(ROOT, 'shared') : RENDERER;
        const rel = shared ? rest.slice('shared/'.length) : (rest || 'index.html');
        const target = path.normalize(path.join(base, rel));
        if (target.indexOf(base) !== 0) return new Response('forbidden', { status: 403 });
        const data = await fsp.readFile(target);
        // 앱을 고친 뒤 다시 열었는데 예전 화면 코드가 남아 있는 일이 없도록 매번 새로 읽힌다.
        return new Response(data, {
          headers: { 'content-type': mimeOf(target), 'cache-control': 'no-cache' },
        });
      }
      if (host === 'att') {
        const hit = findAttachment(rest);
        if (!hit) return new Response('not found', { status: 404 });
        const p = attachAbsPath(hit.a);
        const data = await fsp.readFile(p);
        return new Response(data, {
          headers: { 'content-type': mimeOf(p), 'cache-control': 'no-store' },
        });
      }
    } catch (e) {
      return new Response('error: ' + e.message, { status: 404 });
    }
    return new Response('bad host', { status: 400 });
  });
}

// ---------------------------------------------------------------- IPC

ipcMain.handle('events:load', () => store.events);

/* 첨부가 디스크의 어디에 있는지는 메인이 안다(감시·재연결). 화면은 그걸 받아 들고 있다가
   통째로 저장하는데, 그 사이 메인이 파일을 다시 찾았으면 화면의 낡은 자리가 덮어쓴다 —
   마감을 고치고 있을 때는 화면이 다시 읽기를 미루니 실제로 그랬다.
   그래서 메인이 더 나중에(diskAt) 알아낸 디스크 정보는 저장이 들어와도 지킨다. */
const DISK_KEYS = ['abs', 'rel', 'mode', 'missing', 'ino', 'hash', 'size', 'mtimeMs', 'isImage', 'diskAt'];
function keepDiskState(incoming) {
  const mine = new Map(allAttachments().map((x) => [x.a.id, x.a]));
  for (const a of incoming) {
    const m = a && mine.get(a.id);
    if (!m || !(m.diskAt > (a.diskAt || 0))) continue;
    for (const k of DISK_KEYS) {
      if (m[k] === undefined) delete a[k]; else a[k] = m[k];
    }
  }
}

ipcMain.handle('events:save', (e, events) => {
  const next = Array.isArray(events) ? events : [];
  keepDiskState([].concat(...next.map((ev) => (ev && ev.attachments) || [])));
  store.events = next;
  persistEvents();
  notifyRenderer('data:changed', 'events', e.sender.id);
  return true;
});

// ── 필기(노트) · 저장한 링크 ──
// 마감과 같은 파일에 담는다. 셋 다 한 덩어리로 백업된다.

ipcMain.handle('notes:load', () => store.notes);

ipcMain.handle('notes:save', (e, notes) => {
  store.notes = Array.isArray(notes) ? notes : [];
  persistEvents();
  notifyRenderer('data:changed', 'notes', e.sender.id);
  return true;
});

ipcMain.handle('links:load', () => store.links);

ipcMain.handle('links:save', (e, links) => {
  store.links = Array.isArray(links) ? links : [];
  persistEvents();
  notifyRenderer('data:changed', 'links', e.sender.id);
  return true;
});

ipcMain.handle('files:load', () => store.files);

// 기기끼리 맞추는 데만 쓰는 부스러기 — 지운 흔적과 묶음 단위 시각
ipcMain.handle('sync:load', () => ({ tombs: store.tombs, meta: store.meta }));

ipcMain.handle('sync:save', (e, arg) => {
  store.tombs = Array.isArray(arg && arg.tombs) ? arg.tombs : [];
  store.meta = (arg && arg.meta) || {};
  persistEvents();
  return true;
});

ipcMain.handle('files:save', (e, files) => {
  const next = Array.isArray(files) ? files : [];
  keepDiskState(next);
  store.files = next;
  persistEvents();
  notifyRenderer('data:changed', 'files', e.sender.id);
  return true;
});

// 주소만 붙여넣어도 제목이 채워지게 한다. 인터넷이 없으면 조용히 도메인만 쓴다.
ipcMain.handle('links:title', async (e, url) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!res.ok) return { ok: false };
    const type = res.headers.get('content-type') || '';
    if (!/text\/html/i.test(type)) return { ok: false };
    // 앞부분만 읽으면 <title> 은 거의 항상 들어 있다.
    const buf = await res.arrayBuffer();
    const head = Buffer.from(buf).slice(0, 200000).toString('utf8');
    const m = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) return { ok: false };
    const title = m[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ').trim();
    return title ? { ok: true, title: title.slice(0, 200) } : { ok: false };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? '응답 없음' : err.message };
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle('folders:load', () => store.folders);

ipcMain.handle('folders:save', (e, folders) => {
  store.folders = Array.isArray(folders) ? folders : [];
  persistEvents();
  notifyRenderer('data:changed', 'folders', e.sender.id);
  return true;
});

ipcMain.handle('settings:load', () => settings);

ipcMain.handle('settings:save', (e, next) => {
  const before = JSON.stringify(settings.watchFolders);
  settings = Object.assign(settings, next || {});
  persistSettings();
  if (JSON.stringify(settings.watchFolders) !== before) startWatchers();
  return settings;
});

ipcMain.handle('ollama:status', () => ollamaStatus());

ipcMain.handle('ollama:parse', async (e, arg) => {
  try {
    const r = await ollamaParse(arg.text, arg.model);
    return Object.assign({ ok: true }, r);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('classroom:status', () => ({ on: !!classroomConfig() }));

ipcMain.handle('classroom:fetch', () => classroomFetch());

ipcMain.handle('classroom:extract', async (e, arg) => {
  try {
    const r = await ollamaExtract(String(arg.text || ''), arg.base, arg.model);
    return Object.assign({ ok: true }, r);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('ollama:warm', async (e, model) => {
  try {
    const use = await useModel(model, 'model');
    await ollamaFetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: use.model, messages: [], keep_alive: '30m' }),
    }, 120000);
    return true;
  } catch (err) {
    return false;
  }
});

ipcMain.handle('ollama:format', async (e, arg) => {
  try {
    const r = await ollamaFormat(e.sender, arg.id, String(arg.text || ''), arg.model,
      arg.prev, arg.missing);
    return Object.assign({ ok: true }, r);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('ollama:formatStop', () => { stopFormat(); return true; });

ipcMain.handle('attach:organize', async (e, arg) => {
  try {
    const r = await ollamaOrganize(arg.files || [], arg.context || '', arg.model, arg.wish || '');
    return Object.assign({ ok: true }, r);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('dialog:pickFiles', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '첨부할 파일 선택',
    properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '감시할 폴더 선택',
    properties: ['openDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

// 파일 경로 목록을 원본 연결 첨부 레코드로 만든다. 폴더는 건너뛴다.
function linkPaths(paths) {
  const out = [];
  for (const p of (paths || [])) {
    try {
      if (!fs.statSync(p).isFile()) continue;
      out.push(linkAttachment(p));
    } catch (err) {
      console.warn('[attach] 실패', p, err.message);
    }
  }
  return out;
}

// 파일 고르기 창을 띄우고 바로 연결한다. 웹 버전도 같은 이름을 쓴다.
ipcMain.handle('attach:pick', async (e) => {
  const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender) || win || undefined, {
    title: '연결할 파일 고르기',
    properties: ['openFile', 'multiSelections'],
  });
  if (res.canceled || !res.filePaths.length) return [];
  return linkPaths(res.filePaths);
});

ipcMain.handle('attach:add', (e, arg) => linkPaths(arg && arg.paths));

// 클립보드/드롭으로 들어온 바이너리를 앱 폴더에 저장한다.
ipcMain.handle('attach:addBuffer', async (e, arg) => {
  const dir = path.join(ATTACH, arg.eventId || '_library');
  await fsp.mkdir(dir, { recursive: true });
  const target = uniqueTarget(dir, safeName(arg.name || ('붙여넣은 이미지 ' + Date.now() + '.png')));
  await fsp.writeFile(target, Buffer.from(arg.buffer));
  return Object.assign({
    id: newId('att'),
    name: path.basename(target),
    mode: 'managed',
    rel: path.relative(DATA, target).split(path.sep).join('/'),
    isImage: isImage(target),
    missing: false,
    addedAt: new Date().toISOString(),
  }, statInfo(target));
});

ipcMain.handle('attach:open', (e, id) => {
  const hit = findAttachment(id);
  if (!hit) return '첨부를 찾을 수 없습니다.';
  return shell.openPath(attachAbsPath(hit.a));
});

ipcMain.handle('attach:reveal', (e, id) => {
  const hit = findAttachment(id);
  if (!hit) return false;
  shell.showItemInFolder(attachAbsPath(hit.a));
  return true;
});

/* 앱 폴더에 있던 파일은 휴지통으로 보낸다. 연결된 원본은 건드리지 않는다.
   복사·붙여넣기로 같은 파일을 가리키는 기록이 또 있으면 그것도 남겨 둔다. */
ipcMain.handle('attach:remove', async (e, id) => {
  const hit = findAttachment(id);
  if (!hit) return false;
  if (hit.a.mode === 'managed') {
    const p = attachAbsPath(hit.a);
    const shared = p && allAttachments().some((x) => x.a.id !== id && attachAbsPath(x.a) === p);
    if (p && !shared) {
      try { await shell.trashItem(p); } catch (err) { /* 이미 없을 수 있다 */ }
    }
  }
  return true;
});

/* 클라우드가 어디서 막혔는지 적어 둔다 — `data/기록.txt`.

   화면의 토스트는 스쳐 지나가서 무슨 일이 있었는지 되짚을 수가 없다.
   여기 남겨 두면 나중에 그 줄만 보면 된다. 마지막 300줄만 들고 있는다. */
const LOG_FILE = path.join(DATA, '기록.txt');

ipcMain.handle('log:add', (e, line) => {
  try {
    const stamp = new Date().toLocaleString('ko-KR');
    let old = '';
    try { old = fs.readFileSync(LOG_FILE, 'utf8'); } catch (err) { /* 처음이다 */ }
    const lines = (old + stamp + '  ' + String(line || '').slice(0, 400) + '\n')
      .split('\n').filter(Boolean).slice(-300);
    fs.writeFileSync(LOG_FILE, lines.join('\n') + '\n', 'utf8');
  } catch (err) { /* 기록을 못 남겨도 앱은 돌아야 한다 */ }
  return true;
});

// 파일 화면의 복사·붙여넣기 — 디스크에 사본을 만들지 않고 같은 파일을 하나 더 가리킨다.
ipcMain.handle('attach:duplicate', async (e, id) => {
  const hit = findAttachment(id);
  if (!hit) return null;
  const src = attachAbsPath(hit.a);
  try {
    if (!src || !fs.statSync(src).isFile()) return null;
    if (hit.a.mode === 'linked') return linkAttachment(src);
    return Object.assign({}, hit.a, {
      id: newId('att'),
      addedAt: new Date().toISOString(),
      cloud: false,
      done: false,
    });
  } catch (err) {
    return null;
  }
});

// 클라우드에 올리려고 파일 내용을 읽는다.
ipcMain.handle('attach:read', async (e, id) => {
  const hit = findAttachment(id);
  if (!hit) return { ok: false, error: '첨부를 찾을 수 없습니다.' };
  const p = attachAbsPath(hit.a);
  try {
    const st = fs.statSync(p);
    if (st.size > 40 * 1024 * 1024) return { ok: false, error: '40MB 가 넘어 올리지 않습니다.' };
    const buf = await fsp.readFile(p);
    return { ok: true, bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.length), mime: mimeOf(p), size: st.size };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 다른 기기가 올린 파일을 이 PC 앱 폴더에 내려 앉힌다.
ipcMain.handle('attach:write', async (e, arg) => {
  try {
    const dir = path.join(ATTACH, '_cloud');
    await fsp.mkdir(dir, { recursive: true });
    const target = path.join(dir, safeName(arg.id + '_' + (arg.name || 'file')));
    await fsp.writeFile(target, Buffer.from(arg.bytes));
    const rel = path.relative(DATA, target).split(path.sep).join('/');
    // 기존 기록에 자리를 알려준다
    const hit = findAttachment(arg.id);
    if (hit) {
      hit.a.mode = 'managed';
      hit.a.rel = rel;
      hit.a.missing = false;
      hit.a.diskAt = Date.now();
      Object.assign(hit.a, statInfo(target));
      persistEvents();
      notifyRenderer('attachments:changed', null);
    }
    return { ok: true, rel };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('attach:verify', () => { verifyAttachments(); return true; });

ipcMain.handle('shell:openData', () => shell.openPath(DATA));

ipcMain.handle('shell:openExternal', (e, url) => {
  if (/^https?:/.test(url)) shell.openExternal(url);
});

ipcMain.handle('app:info', () => ({
  dataDir: DATA,
  home: HOME,
  version: app.getVersion(),
  electron: process.versions.electron,
  watchFolders: settings.watchFolders,
}));

ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });

// ---------------------------------------------------------------- 부팅

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    // 예전에는 여기서 setAppUserModelId('com.local.iljeong') 를 불렀는데,
    // Windows가 그 이름에 딸린 바로가기를 못 찾아 작업표시줄에 고정하면
    // exe 로 되돌아가 "Electron"으로 보였다. 지금은 일정.exe 자체에 이름과
    // 아이콘이 박혀 있으므로 창 정체성을 그대로 두는 편이 맞다.
    registerProtocol();
    createWindow();
    createTray();
    startWatchers();
    verifyAttachments();
    setInterval(reminderTick, 30000);
    setInterval(verifyAttachments, 120000);
    setTimeout(reminderTick, 3000);
  });

  app.on('window-all-closed', () => { /* 트레이에 남는다 */ });
  app.on('activate', showWindow);
  app.on('before-quit', () => { quitting = true; });
}
