/* ══════════════════════════════════════════════════════════════════
   Markdown + LaTeX(KaTeX) + 코드 하이라이트(highlight.js) 렌더러
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  // 첨부 그림의 주소. 데스크톱은 appfile://, 웹은 Storage 주소를 쓴다.
  // web-shim.js 가 있으면 그쪽이 덮어쓴다.
  if (!global.attSrc) {
    global.attSrc = (id, v) => 'appfile://att/' + encodeURIComponent(id) + '?v=' + (v || 0);
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // 첨부 참조( att:<id> )를 앱 내부 URL로 바꾼다.
  function resolveSrc(href) {
    const m = String(href).match(/^(?:att|attachment):\/{0,2}(.+)$/i);
    return m ? 'appfile://att/' + encodeURIComponent(m[1].trim()) : href;
  }

  // ── marked 설정 ────────────────────────────────────────────────
  // marked는 버전에 따라 renderer 인자가 (토큰 객체) 또는 (문자열, …)이라
  // 두 모양을 모두 받는다.
  const renderer = {
    code(a, b) {
      const isTok = a && typeof a === 'object';
      const text = String((isTok ? a.text : a) || '');
      const lang = String((isTok ? a.lang : b) || '').trim().split(/\s+/)[0];
      let body = escapeHTML(text);
      let cls = 'hljs';
      try {
        if (global.hljs && lang && hljs.getLanguage(lang)) {
          body = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
          cls += ' language-' + lang;
        } else if (global.hljs && text.length < 20000) {
          const auto = hljs.highlightAuto(text);
          body = auto.value;
          if (auto.language) cls += ' language-' + auto.language;
        }
      } catch (e) { /* 하이라이트 실패 시 원문 그대로 */ }
      return '<pre><code class="' + cls + '">' + body + '</code></pre>\n';
    },

    image(a, b, c) {
      const isTok = a && typeof a === 'object';
      const href = resolveSrc((isTok ? a.href : a) || '');
      const title = (isTok ? a.title : b) || '';
      const alt = (isTok ? a.text : c) || '';
      return '<img src="' + escapeHTML(href) + '" alt="' + escapeHTML(alt) + '"'
        + (title ? ' title="' + escapeHTML(title) + '"' : '') + ' loading="lazy">';
    },

    link(a, b, c) {
      const isTok = a && typeof a === 'object';
      const href = String((isTok ? a.href : a) || '');
      const title = (isTok ? a.title : b) || '';
      // 토큰 형태에서는 자식 인라인이 이미 렌더된 뒤 넘어온다.
      const text = (isTok ? (a.text != null ? a.text : href) : (c != null ? c : href));
      const ext = /^https?:/i.test(href) ? ' data-ext="1"' : '';
      return '<a href="' + escapeHTML(href) + '"'
        + (title ? ' title="' + escapeHTML(title) + '"' : '') + ext + '>' + text + '</a>';
    },
  };

  if (global.marked && marked.use) {
    marked.use({ gfm: true, breaks: true, renderer: renderer });
  }

  // ── 수식 추출 ──────────────────────────────────────────────────
  // 코드 블록·인라인 코드 안의 $는 건드리지 않도록 한 번에 훑는다.
  // 자리표시자는 매 렌더마다 새 난수를 써서 본문 텍스트와 절대 겹치지 않게 한다.
  function extractMath(src) {
    const nonce = 'zK' + Math.random().toString(36).slice(2, 10);
    const open = 'MTH' + nonce + 'x';
    const close = 'x' + nonce + 'END';
    const store = [];
    let out = '';
    let i = 0;
    const n = src.length;

    const push = (tex, display) => {
      store.push({ tex, display });
      return open + (store.length - 1) + close;
    };

    while (i < n) {
      const ch = src[i];

      // 펜스 코드 블록
      if (src.startsWith('```', i) || src.startsWith('~~~', i)) {
        const fence = src.substr(i, 3);
        let end = src.indexOf('\n' + fence, i + 3);
        end = end === -1 ? n : end + 1 + fence.length;
        out += src.slice(i, end);
        i = end;
        continue;
      }

      // 인라인 코드
      if (ch === '`') {
        let ticks = 0;
        while (src[i + ticks] === '`') ticks++;
        const mark = '`'.repeat(ticks);
        const end = src.indexOf(mark, i + ticks);
        const stop = end === -1 ? n : end + ticks;
        out += src.slice(i, stop);
        i = stop;
        continue;
      }

      // 블록 수식  $$…$$  /  \[…\]
      if (src.startsWith('$$', i)) {
        const end = src.indexOf('$$', i + 2);
        if (end !== -1) { out += push(src.slice(i + 2, end), true); i = end + 2; continue; }
      }
      if (src.startsWith('\\[', i)) {
        const end = src.indexOf('\\]', i + 2);
        if (end !== -1) { out += push(src.slice(i + 2, end), true); i = end + 2; continue; }
      }
      if (src.startsWith('\\(', i)) {
        const end = src.indexOf('\\)', i + 2);
        if (end !== -1) { out += push(src.slice(i + 2, end), false); i = end + 2; continue; }
      }

      // 인라인 수식 $…$ — "$5 에서 $10" 같은 통화 표기와 헷갈리지 않게
      // 여는 $ 뒤에는 공백이 없어야 하고, 닫는 $ 앞에도 공백이 없어야 한다.
      if (ch === '$' && src[i - 1] !== '\\') {
        const next = src[i + 1];
        if (next && !/\s/.test(next)) {
          let j = i + 1;
          let nl = 0;
          while (j < n) {
            if (src[j] === '\n' && ++nl > 1) break;
            if (src[j] === '$' && src[j - 1] !== '\\' && !/\s/.test(src[j - 1])) break;
            j++;
          }
          if (j < n && src[j] === '$' && j - i > 1 && !/\d/.test(src[j + 1] || '')) {
            out += push(src.slice(i + 1, j), false);
            i = j + 1;
            continue;
          }
        }
      }

      out += ch;
      i++;
    }

    return { text: out, store, open, close };
  }

  function renderMath(html, ex) {
    if (!ex.store.length) return html;
    const re = new RegExp(ex.open + '(\\d+)' + ex.close, 'g');
    return html.replace(re, (_m, id) => {
      const item = ex.store[Number(id)];
      if (!item) return '';
      if (!global.katex) return escapeHTML(item.tex);
      try {
        return katex.renderToString(item.tex, {
          displayMode: item.display,
          throwOnError: false,
          errorColor: '#d93025',
          strict: false,
          trust: false,
        });
      } catch (e) {
        return '<span class="katex-error">' + escapeHTML(item.tex) + '</span>';
      }
    });
  }

  // ── 정리(sanitize) ────────────────────────────────────────────
  const PURIFY_OPTS = {
    ADD_ATTR: ['target', 'data-ext', 'loading'],
    // 첨부 이미지를 위해 appfile: 스킴을 허용한다.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|appfile|data|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  };

  function render(src) {
    const text = String(src || '');
    if (!text.trim()) return '';
    const ex = extractMath(text);
    let html;
    try {
      html = global.marked ? marked.parse(ex.text) : '<p>' + escapeHTML(ex.text) + '</p>';
    } catch (e) {
      html = '<p>' + escapeHTML(ex.text) + '</p>';
    }
    if (global.DOMPurify) html = DOMPurify.sanitize(html, PURIFY_OPTS);
    // KaTeX 출력은 우리가 만든 것이므로 정리 이후에 끼워 넣는다.
    return renderMath(html, ex);
  }

  // interactive:true 면 체크박스를 눌러 켜고 끌 수 있게 하고, 몇 번째 항목인지
  // 표시해 둔다. 그 번호로 원본의 [ ] 를 찾아 뒤집는다.
  function renderInto(el, src, opts) {
    el.innerHTML = render(src);
    const boxes = el.querySelectorAll('input[type="checkbox"]');
    for (let i = 0; i < boxes.length; i++) {
      boxes[i].dataset.task = String(i);
      boxes[i].disabled = !(opts && opts.interactive);
    }
    return boxes.length;
  }

  // index 번째 할 일 표시를 [ ] ↔ [x] 로 뒤집는다.
  // 코드 블록 안의 [ ] 는 체크박스로 그려지지 않으므로 번호를 셀 때도 건너뛴다.
  function toggleTask(src, index) {
    const lines = String(src).split('\n');
    let inFence = false;
    let n = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(?:```|~~~)/.test(lines[i])) { inFence = !inFence; continue; }
      if (inFence) continue;
      const m = lines[i].match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/);
      if (!m) continue;
      if (n === index) {
        lines[i] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3];
        return { text: lines.join('\n'), ok: true };
      }
      n++;
    }
    return { text: String(src), ok: false };
  }

  // 진행 상황 — 체크리스트가 있으면 "3/7" 을 보여주기 위해 센다.
  function taskStats(src) {
    const lines = String(src).split('\n');
    let inFence = false;
    let done = 0;
    let total = 0;
    for (const line of lines) {
      if (/^\s*(?:```|~~~)/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const m = line.match(/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/);
      if (!m) continue;
      total++;
      if (m[1] !== ' ') done++;
    }
    return { done, total };
  }

  // 검색 스니펫용 — 마크업을 걷어낸 순수 텍스트
  function plain(src) {
    return String(src || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^[#>\-*+]\s+/gm, '')
      .replace(/[*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── KaTeX 글꼴 ──
  // 크로미움이 수식에 쓰이는 글꼴을 스스로 받아오지 않아, 글자가 통째로
  // 안 보이는 일이 있다(자리는 잡혀 있는데 획이 안 그려진다). 시작할 때
  // 한 번 직접 불러 두면 그다음부터는 어느 화면에서든 제대로 나온다.
  const KATEX_FACES = [
    'KaTeX_Main', 'KaTeX_Math', 'KaTeX_Size1', 'KaTeX_Size2', 'KaTeX_Size3',
    'KaTeX_Size4', 'KaTeX_AMS', 'KaTeX_Caligraphic', 'KaTeX_Fraktur',
    'KaTeX_SansSerif', 'KaTeX_Script', 'KaTeX_Typewriter',
  ];

  function loadMathFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all(KATEX_FACES.map((f) =>
      document.fonts.load('16px "' + f + '"').catch(() => {})));
  }

  document.addEventListener('DOMContentLoaded', loadMathFonts);

  global.MD = {
    render, renderInto, plain, resolveSrc, escapeHTML, toggleTask, taskStats, loadMathFonts,
  };
})(window);
