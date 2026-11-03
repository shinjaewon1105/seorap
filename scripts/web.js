// renderer/ 를 브라우저에서 그대로 돌 수 있게 web/ 으로 옮겨 담는다.
// 다른 점은 두 가지뿐이다 —
//   1) preload 대신 web-shim.js 가 `api` 를 만든다 (자료는 localStorage, 맞추기는 cloud.js)
//   2) Electron 전용 파일(preload 연결, appfile:// )은 들어가지 않는다
//
//   node scripts/web.js  →  web/ 이 만들어지고, firebase deploy 로 올리면 된다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const src = path.join(root, 'renderer');
const out = path.join(root, 'web');

function copyDir(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip && skip.includes(entry.name)) continue;
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b, skip);
    else if (entry.isFile()) fs.copyFileSync(a, b);
  }
}

function rmDir(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

rmDir(out);
copyDir(src, out, ['index.html']);

// shared/recur.js 는 renderer 밖에 있으므로 따로 넣는다
fs.mkdirSync(path.join(out, 'shared'), { recursive: true });
fs.copyFileSync(path.join(root, 'shared', 'recur.js'), path.join(out, 'shared', 'recur.js'));
fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(out, 'icon.png'));

// ── index.html 을 웹용으로 고쳐 쓴다 ──
let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');

// appfile: 은 Electron 전용이다. 대신 Firebase Storage 를 연다.
html = html.replace(/img-src[^;]*;/, "img-src 'self' data: blob: https://*.googleapis.com https://*.firebasestorage.app;");

// 받침대를 store.js 보다 먼저 끼워 넣는다
html = html.replace('<script src="firebase-config.js"></script>',
  '<script src="firebase-config.js"></script>\n<script src="web-shim.js"></script>');

// 휴대폰에서 홈 화면에 담을 수 있게
html = html.replace('</head>',
  '<link rel="icon" href="icon.png">\n'
  + '<link rel="manifest" href="manifest.webmanifest">\n'
  + '<meta name="theme-color" content="#1a73e8">\n'
  + '<meta name="apple-mobile-web-app-capable" content="yes">\n'
  + '<meta name="apple-mobile-web-app-title" content="서랍">\n'
  + '<link rel="apple-touch-icon" href="icon.png">\n'
  + '</head>');

/* 주소 뒤에 판 번호를 붙인다 — `cloud.js?v=a1b2c3d4`.

   이게 없으면 고친 것이 바로 안 보인다. 브라우저(와 중간의 CDN)가 예전 파일을
   들고 있어서다. 내용이 바뀌면 주소가 바뀌니 무조건 새로 받아 간다.
   실제로 한 번 당했다 — 새 cloud.js 를 올렸는데 예전 것이 계속 왔다. */
const stamp = (file) => {
  const p = path.join(out, file);
  if (!fs.existsSync(p)) return '';
  return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex').slice(0, 8);
};

html = html.replace(/(<(?:script|link)\b[^>]*?\b(?:src|href)=")([^"?:]+\.(?:js|css))(")/g,
  (all, a, file, b) => {
    const v = stamp(file);
    return v ? a + file + '?v=' + v + b : all;
  });

fs.writeFileSync(path.join(out, 'index.html'), html, 'utf8');

/* ── PC 앱 받기 ──

   **설치 파일(.exe)은 Firebase 무료 요금제에 올릴 수 없다.**
   올리려 하면 배포가 통째로 실패한다 (Executable files are forbidden on the Spark plan).
   그래서 파일은 딴 데 두고 여기서는 **주소만** 건다.

   `download/링크.txt` 에 내려받을 주소를 한 줄 적어 두면 그리로 이어 준다
   (구글 드라이브 공유 링크, GitHub Releases 주소 등 아무거나).
   비어 있으면 "관리자에게 받으세요" 라고만 적힌다. */
const dl = path.join(root, 'download');
const setup = path.join(dl, '서랍-설치.exe');

{
  const getDir = path.join(out, 'get');
  fs.mkdirSync(getDir, { recursive: true });

  let meta = { version: '', size: 0, at: '' };
  try { meta = JSON.parse(fs.readFileSync(path.join(dl, '판.json'), 'utf8')); } catch (e) { /* 없으면 말고 */ }
  if (!meta.size && fs.existsSync(setup)) meta.size = fs.statSync(setup).size;

  let link = '';
  try {
    link = fs.readFileSync(path.join(dl, '링크.txt'), 'utf8')
      .split(/\r?\n/)
      .map((x) => x.trim())
      .find((x) => x && x[0] !== '#') || '';        // # 로 시작하는 줄은 설명이다
  } catch (e) { /* 없으면 말고 */ }
  if (link && !/^https?:/i.test(link)) link = '';   // 주소 모양이 아니면 없는 셈 친다

  /* 구글 드라이브의 보기 주소(`/file/d/<id>/view`)는 미리보기 화면이라
     누르면 파일이 아니라 구경 창이 뜬다. 바로 받아지는 주소로 바꿔 준다. */
  const gd = link.match(/drive\.google\.com\/file\/d\/([^/?]+)/);
  // confirm=t 는 25MB 넘는 파일에 뜨는 '바이러스 검사를 못 했습니다' 창을 건너뛴다.
  if (gd) link = 'https://drive.google.com/uc?export=download&confirm=t&id=' + gd[1];

  /* 구글 드라이브는 25MB 넘는 파일에 "바이러스 검사를 할 수 없습니다" 창을 띄운다.
     파일이 커서 그런 것뿐인데 처음 보면 겁난다. 미리 일러 둔다. */
  const driveWarn = gd
    ? `<p class="warn">구글 드라이브가 <b>"바이러스 검사를 할 수 없습니다"</b> 라고 합니다.
       파일이 커서 검사를 못 한 것뿐입니다. <b>무시하고 다운로드</b> 를 누르세요.</p>`
    : '';

  const mb = meta.size ? (meta.size / 1024 / 1024).toFixed(0) : '';
  const day = String(meta.at || '').slice(0, 10);
  const button = link
    ? `<a class="get" href="${link}" target="_blank" rel="noopener">Windows 용 내려받기</a>
  <div class="meta">${mb ? mb + 'MB · ' : ''}판 ${meta.version || '1.0.0'}${day ? ' · ' + day : ''} · 64비트 Windows</div>`
    : `<div class="none">아직 올려 둔 파일이 없습니다.<br>관리자에게 <b>서랍-설치.exe</b> 를 달라고 하세요.</div>`;

  fs.writeFileSync(path.join(getDir, 'index.html'), `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>서랍 — PC 앱 받기</title>
<link rel="icon" href="../icon.png">
<style>
  :root { color-scheme: light; }
  body {
    margin: 0; padding: 40px 20px 80px;
    font: 15px/1.75 'Malgun Gothic', 'Segoe UI', system-ui, sans-serif;
    color: #202124; background: #fff;
  }
  .wrap { max-width: 520px; margin: 0 auto; }
  img.logo { width: 64px; height: 64px; border-radius: 14px; }
  h1 { font-size: 26px; margin: 18px 0 6px; }
  p.lead { color: #5f6368; margin: 0 0 28px; }
  a.get {
    display: inline-flex; align-items: center; gap: 10px;
    background: #1a73e8; color: #fff; text-decoration: none;
    padding: 15px 26px; border-radius: 999px; font-size: 16px; font-weight: 600;
  }
  a.get:hover { background: #1557b0; }
  .meta { color: #80868b; font-size: 13px; margin-top: 12px; }
  .none { background: #fef7e0; color: #7a5900; border-radius: 10px; padding: 16px 18px; font-size: 14px; }
  .warn { color: #5f6368; font-size: 13px; line-height: 1.7; margin: 14px 0 0; max-width: 46ex; }
  h2 { font-size: 15px; margin: 36px 0 8px; }
  ul { padding-left: 20px; margin: 0; color: #3c4043; }
  li { margin: 5px 0; }
  .note { background: #f8f9fa; border-radius: 10px; padding: 14px 16px; margin-top: 28px; font-size: 14px; color: #3c4043; }
  .back { display: inline-block; margin-top: 32px; color: #1a73e8; text-decoration: none; }
</style>
</head>
<body>
<div class="wrap">
  <img class="logo" src="../icon.png" alt="">
  <h1>서랍 — PC 앱</h1>
  <p class="lead">마감·필기·링크·파일을 한 서랍에.</p>

  ${button}
  ${driveWarn}

  <h2>PC 앱이어야 되는 것</h2>
  <ul>
    <li><b>AI 기능</b> — 자연어로 마감 적기, 메모 정리, 파일 정리.
        내 컴퓨터에서 도는 Llama 를 쓰기 때문입니다</li>
    <li>컴퓨터의 파일을 <b>원본 자리 그대로</b> 연결해 두기</li>
    <li>마감 알림</li>
  </ul>

  <h2>깔 때</h2>
  <ul>
    <li>관리자 권한은 필요 없습니다. 내 계정에만 깔립니다</li>
    <li>서명하지 않은 프로그램이라 Windows 가 파란 창으로 막아설 수 있습니다 —
        <b>추가 정보 → 실행</b> 을 누르면 됩니다</li>
    <li>AI 를 쓰려면 <a href="https://ollama.com" target="_blank" rel="noopener">Ollama</a> 도 함께 깔고
        <code>ollama pull llama3.2:3b</code> 를 한 번 실행하세요</li>
  </ul>

  <div class="note">
    휴대폰에서는 깔지 않아도 됩니다. 브라우저로 열고 홈 화면에 담으면 앱처럼 씁니다.
    다만 AI 기능은 PC 앱이 켜져 있어야 합니다.
  </div>

  <a class="back" href="../">← 서랍 열기</a>
</div>
</body>
</html>
`, 'utf8');
  console.log(link
    ? '[web] 받기 화면 → /get/  (' + link + ')'
    : '[web] 받기 화면 → /get/  (아직 링크 없음 — download/링크.txt 에 주소를 적으세요)');
}

fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({
  name: '서랍',
  short_name: '서랍',
  start_url: '.',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: '#1a73e8',
  icons: [{ src: 'icon.png', sizes: '256x256', type: 'image/png', purpose: 'any maskable' }],
}, null, 2), 'utf8');

// 브라우저에는 없는 것들을 지운다
const drop = ['web-shim.js.map'];
for (const f of drop) rmDir(path.join(out, f));

const count = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);

console.log('[web] ' + count(out) + '개 파일을 web/ 에 담았습니다.');
console.log('[web] 올리기:  npx firebase deploy --only hosting');
