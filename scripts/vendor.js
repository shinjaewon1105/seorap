// node_modules 안의 배포용 파일들을 renderer/vendor 로 복사한다.
// 앱은 전부 오프라인으로 돌기 때문에 CDN을 쓰지 않는다.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'renderer', 'vendor');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function copy(from, to) {
  const src = path.join(root, 'node_modules', from);
  const dest = path.join(out, to);
  if (!fs.existsSync(src)) {
    console.warn('[vendor] 없음, 건너뜀:', from);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.statSync(src).isDirectory()) copyDir(src, dest);
  else fs.copyFileSync(src, dest);
  console.log('[vendor]', from);
}

fs.mkdirSync(out, { recursive: true });

copy('marked/lib/marked.umd.js', 'marked.umd.js');
copy('dompurify/dist/purify.min.js', 'purify.min.js');
copy('katex/dist/katex.min.js', 'katex/katex.min.js');
copy('katex/dist/katex.min.css', 'katex/katex.min.css');
copy('katex/dist/fonts', 'katex/fonts');
copy('@highlightjs/cdn-assets/highlight.min.js', 'hljs/highlight.min.js');
copy('@highlightjs/cdn-assets/styles/github.min.css', 'hljs/github.min.css');

// Firebase — compat(UMD) 판을 쓴다. 모듈 번들러 없이 <script> 로 불러야 하기 때문이다.
copy('firebase/firebase-app-compat.js', 'firebase/firebase-app-compat.js');
copy('firebase/firebase-auth-compat.js', 'firebase/firebase-auth-compat.js');
copy('firebase/firebase-firestore-compat.js', 'firebase/firebase-firestore-compat.js');
copy('firebase/firebase-storage-compat.js', 'firebase/firebase-storage-compat.js');

console.log('[vendor] 완료');
