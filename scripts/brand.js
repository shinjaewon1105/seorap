// electron.exe 를 그대로 쓰면 작업표시줄·Alt+Tab·작업 관리자에 전부 "Electron"으로
// 뜬다. 이름과 아이콘이 박힌 사본 "서랍.exe" 를 만들어 그걸 실행 파일로 쓴다.
// (dist 폴더 안에 두어야 옆에 있는 dll·resources 를 찾는다)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'node_modules', 'electron', 'dist');
const src = path.join(dist, 'electron.exe');
const out = path.join(dist, '서랍.exe');
const icon = path.join(root, 'build', 'icon.ico');

// 인자 없이 일정.exe 만 실행해도 이 앱이 뜨도록, Electron이 찾는 자리에
// 진짜 앱을 가리키는 두 줄짜리 디딤돌을 놓는다.
// 이렇게 해야 작업표시줄에 고정했을 때(고정본은 인자를 잃는다) 제대로 열린다.
function writeStub() {
  const dir = path.join(dist, 'resources', 'app');
  fs.mkdirSync(dir, { recursive: true });

  const pkg = require(path.join(root, 'package.json'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: pkg.name || 'seorap-app',
    productName: '서랍',
    version: pkg.version || '1.0.0',
    main: 'main.js',
  }, null, 2), 'utf8');

  // 경로를 자기 위치 기준으로 거슬러 올라가 찾는다. 폴더를 통째로 옮겨도 살아 있다.
  // resources/app → resources → dist → electron → node_modules → 앱 폴더 (다섯 단계)
  fs.writeFileSync(path.join(dir, 'main.js'), [
    "'use strict';",
    '// 자동 생성 파일 (scripts/brand.js). 직접 고치지 마세요.',
    '// 진짜 앱은 다섯 단계 위에 있습니다.',
    "const real = require('path').resolve(__dirname, '..', '..', '..', '..', '..', 'main.js');",
    'require(real);',
    '',
  ].join('\n'), 'utf8');

  console.log('[brand] 디딤돌 놓음: resources/app');
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('[brand] Windows가 아니라 건너뜀');
    return;
  }
  if (!fs.existsSync(src)) {
    console.warn('[brand] electron.exe 가 없어 건너뜀:', src);
    return;
  }
  if (!fs.existsSync(icon)) {
    console.warn('[brand] build/icon.ico 가 없어 건너뜀');
    return;
  }

  writeStub();

  // 이미 만들어 두었고 원본보다 새 것이면 다시 새기지 않는다.
  if (fs.existsSync(out)
      && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs
      && fs.statSync(out).mtimeMs >= fs.statSync(icon).mtimeMs) {
    console.log('[brand] 서랍.exe 이미 최신');
    return;
  }

  fs.copyFileSync(src, out);

  // rcedit 5는 ESM이라 require 하면 네임스페이스가 온다. 두 모양 다 받는다.
  let rcedit;
  try {
    const m = require('rcedit');
    rcedit = typeof m === 'function' ? m : (m.rcedit || m.default);
  } catch (e) {
    rcedit = null;
  }
  if (typeof rcedit !== 'function') {
    console.warn('[brand] rcedit 없음 — 아이콘·이름은 그대로 두고 파일 이름만 바꿉니다');
    return;
  }

  const pkg = require(path.join(root, 'package.json'));
  await rcedit(out, {
    icon,
    'file-version': pkg.version || '1.0.0',
    'product-version': pkg.version || '1.0.0',
    'version-string': {
      ProductName: '서랍',
      FileDescription: '서랍',
      InternalName: '서랍',
      OriginalFilename: '서랍.exe',
      CompanyName: '',
      LegalCopyright: '',
    },
  });
  console.log('[brand] 서랍.exe 만듦');
}

main().catch((e) => {
  console.warn('[brand] 실패:', e.message);
});
