/* 설치 파일 만들기 — 다른 컴퓨터에도 서랍을 깔 수 있게.

     node scripts/release.js     (= npm run dist)

   하는 일은 셋이다.
     1) electron-builder 로 `dist-app/서랍-설치-1.0.0.exe` 를 만든다
     2) 그걸 `download/서랍-설치.exe` 로 옮겨 담는다 (판 번호가 바뀌어도 주소는 그대로)
     3) 크기·날짜를 `download/판.json` 에 적어 둔다 — 받기 화면이 이걸 읽는다

   그다음 `npm run web && npx firebase deploy --only hosting` 하면
   https://seorap-80fc9.web.app/받기/ 에서 내려받을 수 있다.

   주의 — Firebase 무료 몫은 **하루 360MB** 만 내보낸다.
   설치 파일이 90MB 쯤이니 하루 서너 번이면 찬다. 여럿에게 뿌릴 거면
   GitHub Releases 처럼 딴 데 두는 게 낫다. */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist-app');
const dest = path.join(root, 'download');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

console.log('[dist] 설치 파일을 만듭니다. 처음 한 번은 electron 을 내려받느라 몇 분 걸립니다…');

const builder = path.join(root, 'node_modules', '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');

const r = spawnSync(builder, ['--win', '--x64'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (r.status !== 0) {
  console.error('[dist] 만들지 못했습니다.');
  process.exit(1);
}

// 만들어진 설치 파일을 찾는다 (판 번호가 붙어 있다)
const made = fs.readdirSync(out).filter((f) => /^서랍-설치-.*\.exe$/.test(f));
if (!made.length) {
  console.error('[dist] dist-app 안에서 설치 파일을 못 찾았습니다.');
  process.exit(1);
}
const src = path.join(out, made[0]);

fs.mkdirSync(dest, { recursive: true });
// 주소는 늘 같게 둔다. 판이 올라가도 링크를 고치지 않아도 되도록.
const file = path.join(dest, '서랍-설치.exe');
fs.copyFileSync(src, file);

const st = fs.statSync(file);
fs.writeFileSync(path.join(dest, '판.json'), JSON.stringify({
  version: pkg.version,
  size: st.size,
  at: new Date().toISOString(),
  file: '서랍-설치.exe',
}, null, 2), 'utf8');

const mb = (st.size / 1024 / 1024).toFixed(1);
console.log('[dist] 됐습니다 — download/서랍-설치.exe (' + mb + 'MB, 판 ' + pkg.version + ')');
console.log('');
console.log('[dist] ※ 이 파일은 **Firebase 무료 요금제에 올릴 수 없습니다** —');
console.log('       exe 를 올리려 하면 배포가 통째로 실패합니다.');
console.log('       구글 드라이브나 GitHub Releases 에 올린 뒤, 그 주소를');
console.log('       download/링크.txt 에 한 줄로 적고 npm run web 하세요.');
console.log('       그러면 https://seorap-80fc9.web.app/get/ 이 그리로 이어 줍니다.');
