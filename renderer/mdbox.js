/* ══════════════════════════════════════════════════════════════════
   메모 칸 — 마크다운 보기/편집 · 체크리스트 · AI 서식 정리
   마감 상세와 필기가 똑같은 칸을 쓴다.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  let active = null;          // AI 정리는 한 번에 하나만 돈다

  const MdBox = {
    create(mount, opts) { return new Box(mount, opts || {}); },
    // 지금 AI 결과를 보고 있는 칸이 있으면 true — 화면을 다시 그리면 안 된다
    busy() { return !!(active && active.ai); },
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function svgSpark() {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z');
    s.appendChild(p);
    return s;
  }

  function Box(mount, opts) {
    this.o = opts;
    this.ai = null;
    this.aiTimer = null;
    this.build(mount);
    this.render();
  }

  Box.prototype.get = function () { return String(this.o.get() || ''); };
  Box.prototype.save = function (text) { this.o.set(text); };

  // ────────────────────────────── 만들기 ──────────────────────────────

  Box.prototype.build = function (mount) {
    const self = this;
    const o = this.o;
    const root = el('div', 'md-block');

    const bar = el('div', 'md-bar');
    bar.appendChild(el('span', 'md-label', o.label || '메모'));
    this.progress = el('span', 'task-progress');
    this.progress.hidden = true;
    bar.appendChild(this.progress);

    const acts = el('div', 'att-actions');
    this.btnAi = el('button', 'btn-ghost sm ai-btn');
    this.btnAi.title = '적어둔 내용을 Markdown 서식으로 정리합니다 (내용은 그대로)';
    this.btnAi.appendChild(svgSpark());
    this.btnAi.appendChild(document.createTextNode('AI 정리'));
    if (!global.api || !api.ollama) this.btnAi.hidden = true;   // 웹에는 로컬 모델이 없다
    acts.appendChild(this.btnAi);
    this.btnEdit = el('button', 'btn-ghost sm', '편집');
    acts.appendChild(this.btnEdit);
    bar.appendChild(acts);
    if (o.noBar) bar.hidden = true;
    root.appendChild(bar);

    this.view = el('div', 'md-view');
    this.view.tabIndex = 0;
    this.view.title = '클릭하면 편집합니다';
    root.appendChild(this.view);

    this.edit = document.createElement('textarea');
    this.edit.className = 'md-edit';
    this.edit.spellcheck = false;
    this.edit.hidden = true;
    this.edit.placeholder = o.placeholder
      || 'Markdown으로 자유롭게 적으세요.\n\n# 제목,  **굵게**,  - 목록\n- [ ] 체크리스트\n수식:  $E=mc^2$   또는   $$\\int_0^1 x^2 dx$$\n코드:  ```python 으로 시작하는 블록';
    root.appendChild(this.edit);

    this.tip = el('div', 'md-tip', 'Ctrl+Enter 또는 바깥 클릭으로 저장 · Esc로 닫기');
    this.tip.hidden = true;
    root.appendChild(this.tip);

    // ── AI 결과 칸 ──
    const out = el('div', 'ai-out');
    out.hidden = true;
    const head = el('div', 'ai-head');
    head.appendChild(el('span', 'ai-name', 'AI 정리 결과'));
    this.aiStatus = el('span', 'ai-status');
    head.appendChild(this.aiStatus);
    this.aiStop = el('button', 'btn-ghost sm', '중지');
    head.appendChild(this.aiStop);
    out.appendChild(head);

    this.aiBody = el('div', 'ai-body');
    out.appendChild(this.aiBody);
    this.aiWarn = el('div', 'ai-warn');
    this.aiWarn.hidden = true;
    out.appendChild(this.aiWarn);

    const aacts = el('div', 'ai-acts');
    aacts.hidden = true;
    this.aiRetry = el('button', 'btn-ghost sm', '빠진 것 채우기');
    this.aiRetry.title = '빠진 내용을 짚어주고 한 번 더 정리시킵니다';
    this.aiRetry.hidden = true;
    aacts.appendChild(this.aiRetry);
    this.aiDiscard = el('button', 'btn-ghost sm', '버리기');
    aacts.appendChild(this.aiDiscard);
    this.aiAppend = el('button', 'btn-ghost sm', '아래에 붙이기');
    aacts.appendChild(this.aiAppend);
    this.aiReplace = el('button', 'btn-ghost sm primary', '바꾸기');
    aacts.appendChild(this.aiReplace);
    out.appendChild(aacts);

    this.aiOut = out;
    this.aiActs = aacts;
    root.appendChild(out);

    mount.appendChild(root);
    this.root = root;

    // ── 손질 ──
    this.view.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a) { e.preventDefault(); self.onLink(a); return; }
      if (e.target.closest('.katex')) return;
      if (e.target.matches('input[type="checkbox"]')) return;
      self.enterEdit();
    });
    this.view.addEventListener('change', (e) => self.onTaskToggle(e));
    this.btnEdit.addEventListener('click', () => (self.edit.hidden ? self.enterEdit() : self.leaveEdit()));

    this.edit.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); self.leaveEdit(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); self.leaveEdit(); }
      else if (e.key === 'Tab') { e.preventDefault(); self.insert('  '); }
    });
    this.edit.addEventListener('blur', () => {
      setTimeout(() => {
        if (!self.edit.hidden && document.activeElement !== self.edit
            && !root.contains(document.activeElement)
            && !(o.keepEditWithin && o.keepEditWithin.contains(document.activeElement))) {
          self.leaveEdit();
        }
      }, 0);
    });
    let t = null;
    this.edit.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => self.save(self.edit.value), 400);
    });
    if (o.onPaste) this.edit.addEventListener('paste', o.onPaste);

    this.btnAi.addEventListener('click', () => self.runFormat());
    this.aiStop.addEventListener('click', () => api.ollama.formatStop());
    this.aiDiscard.addEventListener('click', () => self.closeAi());
    this.aiRetry.addEventListener('click', () => self.retryFormat());
    this.aiReplace.addEventListener('click', () => self.applyFormat('replace'));
    this.aiAppend.addEventListener('click', () => self.applyFormat('append'));
  };

  // ────────────────────────────── 보기 ──────────────────────────────

  Box.prototype.render = function () {
    MD.renderInto(this.view, this.get(), { interactive: true });
    this.paintProgress();
    if (this.o.emptyHint && !this.get().trim()) {
      this.view.replaceChildren(el('div', 'md-empty', this.o.emptyHint));
    }
  };

  Box.prototype.paintProgress = function () {
    const s = MD.taskStats(this.get());
    this.progress.hidden = !s.total;
    this.progress.textContent = s.done + ' / ' + s.total;
    this.progress.classList.toggle('done', s.total > 0 && s.done === s.total);
  };

  Box.prototype.onTaskToggle = function (e) {
    const box = e.target;
    if (!box.matches || !box.matches('input[type="checkbox"]')) return;
    const i = Number(box.dataset.task);
    if (!Number.isInteger(i)) return;
    const r = MD.toggleTask(this.get(), i);
    if (!r.ok) { App.toast('원본에서 그 항목을 찾지 못했습니다.'); this.render(); return; }
    this.save(r.text);
    if (!this.edit.hidden) this.edit.value = r.text;
    this.paintProgress();
  };

  Box.prototype.onLink = function (a) {
    const href = a.getAttribute('href') || '';
    if (this.o.onLink && this.o.onLink(href)) return;
    const m = href.match(/^(?:att|attachment):\/{0,2}(.+)$/i);
    if (m) { api.attach.open(m[1].trim()); return; }
    if (/^https?:/i.test(href)) api.shell.openExternal(href);
  };

  // ────────────────────────────── 편집 ──────────────────────────────

  Box.prototype.isEditing = function () { return !this.edit.hidden; };

  Box.prototype.enterEdit = function () {
    this.edit.value = this.get();
    this.view.hidden = true;
    this.edit.hidden = false;
    this.tip.hidden = false;
    this.btnEdit.textContent = '완료';
    this.edit.focus();
    const n = this.edit.value.length;
    this.edit.setSelectionRange(n, n);
  };

  Box.prototype.leaveEdit = function () {
    if (this.edit.hidden) return;
    this.save(this.edit.value);
    this.edit.hidden = true;
    this.view.hidden = false;
    this.tip.hidden = true;
    this.btnEdit.textContent = '편집';
    this.render();
  };

  // 바깥에서 값이 바뀌었을 때 화면만 맞춘다 (편집 중이면 편집칸을, 아니면 보기를)
  Box.prototype.refresh = function () {
    if (this.edit.hidden) this.render();
    else this.edit.value = this.get();
  };

  Box.prototype.insert = function (text) {
    const t = this.edit;
    const s = t.selectionStart, e = t.selectionEnd;
    t.value = t.value.slice(0, s) + text + t.value.slice(e);
    t.selectionStart = t.selectionEnd = s + text.length;
    t.dispatchEvent(new Event('input'));
  };

  // 바깥(첨부 등)에서 커서 자리에 글을 끼워 넣을 때 쓴다.
  Box.prototype.insertAt = function (text) {
    if (this.edit.hidden) {
      const next = this.get().replace(/\s*$/, '') + '\n\n' + text + '\n';
      this.save(next);
      this.render();
    } else {
      this.insert(text);
    }
  };

  // ────────────────────── AI 정리 (서식만) ──────────────────────
  //
  // 모델은 "적어둔 내용에 Markdown 서식만 입히는" 일만 한다. 그래도 가끔
  // 낱말이나 숫자를 흘리므로, 적용하기 전에 앱이 원문과 대조해 무엇이
  // 빠졌는지 직접 짚어 준다. 판단은 사용자가 한다.

  Box.prototype.closeAi = function () {
    clearInterval(this.aiTimer);
    this.aiTimer = null;
    if (this.ai && !this.ai.done) api.ollama.formatStop();
    this.ai = null;
    if (active === this) active = null;
    this.aiOut.hidden = true;
    this.aiActs.hidden = true;
    this.aiWarn.hidden = true;
    this.aiRetry.hidden = true;
    this.aiBody.className = 'ai-body';
    this.aiBody.textContent = '';
    this.btnAi.disabled = false;
  };

  Box.prototype.runFormat = function () {
    if (this.ai) return;
    if (active && active.ai) { App.toast('먼저 진행 중인 AI 정리를 끝내주세요.'); return; }

    // 편집 중에 일부만 골라두었으면 그 부분만 정리한다.
    let source = this.get();
    let sel = null;
    if (!this.edit.hidden) {
      const t = this.edit;
      if (t.selectionEnd > t.selectionStart) {
        sel = { start: t.selectionStart, end: t.selectionEnd };
        source = t.value.slice(sel.start, sel.end);
      } else {
        source = t.value;
      }
    }
    if (!source.trim()) {
      App.toast('정리할 내용이 비어 있습니다. 먼저 생각나는 대로 적어보세요.');
      return;
    }
    this.ai = { reqId: 'f' + Date.now(), source, sel, text: '', done: false, miss: null, pass: 1 };
    active = this;
    this.aiOut.hidden = false;
    this.doFormat();
  };

  Box.prototype.retryFormat = function () {
    if (!this.ai || !this.ai.done || !this.ai.miss) return;
    const hints = missingContext(this.ai.source, this.ai.miss);
    if (!hints.length) return;
    this.ai = Object.assign({}, this.ai, {
      reqId: 'f' + Date.now(), done: false, pass: this.ai.pass + 1,
      prev: this.ai.text, hints,
    });
    this.doFormat();
  };

  Box.prototype.doFormat = async function () {
    const me = this.ai;
    me.text = '';
    this.btnAi.disabled = true;
    this.aiActs.hidden = true;
    this.aiWarn.hidden = true;
    this.aiRetry.hidden = true;
    this.aiStop.hidden = false;
    this.aiBody.className = 'ai-body';
    this.aiBody.textContent = '';

    const t0 = Date.now();
    const scope = (me.sel ? '선택한 부분' : '전체') + (me.pass > 1 ? ' · 다시 시도' : '');
    const tick = () => {
      this.aiStatus.className = 'ai-status busy';
      this.aiStatus.textContent = scope + ' · ' + Math.round((Date.now() - t0) / 1000) + '초';
    };
    tick();
    clearInterval(this.aiTimer);
    this.aiTimer = setInterval(tick, 1000);

    const res = await api.ollama.format(
      me.reqId, me.source, Store.settings.writeModel, me.prev, me.hints);

    clearInterval(this.aiTimer);
    this.aiTimer = null;
    if (this.ai !== me) return;          // 그 사이에 닫혔거나 다시 눌렀다

    me.done = true;
    this.aiStop.hidden = true;
    this.btnAi.disabled = false;

    if (!res.ok) {
      this.aiStatus.className = 'ai-status err';
      this.aiStatus.textContent = '실패';
      this.aiBody.textContent = res.error;
      return;
    }

    const out = String(res.text || '').trim();
    me.text = out;

    const secs = Math.round((Date.now() - t0) / 1000);
    this.aiStatus.className = 'ai-status';
    this.aiStatus.textContent = res.model + ' · ' + secs + '초'
      + (me.pass > 1 ? ' · ' + me.pass + '번째' : '')
      + (res.stopped ? ' · 중지함' : '')
      + (res.fellBack ? ' · ' + res.fellBack + ' 이(가) 없어 대신 씀' : '');

    if (!out) {
      this.aiBody.textContent = '결과가 비어 있습니다.';
      this.aiActs.hidden = false;
      return;
    }

    this.aiBody.className = 'ai-body md-view rendered';
    MD.renderInto(this.aiBody, out);

    // ── 원문 대조 ──
    const miss = missingBits(me.source, out);
    me.miss = (miss.numbers.length || miss.words.length) ? miss : null;

    const notes = [];
    if (miss.numbers.length) {
      notes.push('원문의 숫자가 결과에 없습니다 — '
        + miss.numbers.map((n) => '<span class="num">' + MD.escapeHTML(n) + '</span>').join(' ')
        + ' · 꼭 확인하세요.');
    }
    if (miss.words.length) {
      notes.push('결과에서 안 보이는 말: <b>'
        + miss.words.slice(0, 12).map(MD.escapeHTML).join('</b>, <b>') + '</b>'
        + (miss.words.length > 12 ? ' 외 ' + (miss.words.length - 12) + '개' : ''));
    }
    const grew = out.length / Math.max(1, me.source.length);
    if (grew > 2) {
      notes.push('결과가 원문보다 <b>' + grew.toFixed(1) + '배</b> 깁니다. '
        + '없던 내용이 붙었을 수 있으니 훑어보세요.');
    }
    if (notes.length) {
      this.aiWarn.innerHTML = notes.join('<br>');
      this.aiWarn.hidden = false;
    }
    this.aiRetry.hidden = !(me.miss && me.pass < 3);
    this.aiActs.hidden = false;
  };

  Box.prototype.onChunk = function (p) {
    if (!this.ai || !p || p.id !== this.ai.reqId) return;
    this.aiBody.textContent += p.delta;
    this.aiBody.scrollTop = this.aiBody.scrollHeight;
  };

  Box.prototype.applyFormat = function (mode) {
    if (!this.ai || !this.ai.text) return;
    const out = this.ai.text;
    const sel = this.ai.sel;
    const editing = !this.edit.hidden;
    const base = editing ? this.edit.value : this.get();
    let next;

    if (sel) {
      next = mode === 'replace'
        ? base.slice(0, sel.start) + out + base.slice(sel.end)
        : base.slice(0, sel.end) + '\n\n' + out + base.slice(sel.end);
    } else {
      next = mode === 'replace' ? out : (base.replace(/\s*$/, '') + '\n\n' + out + '\n');
    }

    const before = base;
    const self = this;
    this.save(next);
    if (editing) this.edit.value = next;
    else this.render();

    this.closeAi();
    App.toast(mode === 'replace' ? '정리한 내용으로 바꿨습니다.' : '아래에 붙였습니다.', {
      label: '되돌리기',
      fn: () => {
        self.save(before);
        if (!self.edit.hidden) self.edit.value = before;
        else self.render();
        App.toast('되돌렸습니다.');
      },
    });
  };

  // ────────────────────── 원문 대조 도구 ──────────────────────

  // 뜻 없는 이음말은 빠져도 문제가 아니라 굳이 알리지 않는다.
  const NOISE = new Set([
    '그리고', '그래서', '그런데', '근데', '하지만', '그러면', '그럼', '또한',
    '이거', '그거', '저거', '이것', '그것', '저것', '거기', '여기',
    '좀', '그냥', '또', '및', '등', '등등', '아직', '이제', '일단', '우선',
    '진짜', '완전', '되게', '너무', '아주', '조금', '거의',
    '이고', '이며', '하면', '이면', '인데', '이때', '일때', '또는', '혹은', '이거는',
  ]);

  // 대충 적은 수식이 LaTeX로 바뀌면 글자 자체가 달라진다.
  // "루트"가 \sqrt 로, "플마"가 \pm 으로 바뀐 것을 손실로 오해하지 않도록,
  // 우리가 모델에게 시킨 변환만큼은 같은 말로 쳐 준다.
  const MATH_SYN = {
    root: 'sqrt', 루트: 'sqrt', 제곱근: 'sqrt', 루트기호: 'sqrt',
    적분: 'int', 인테그랄: 'int', 시그마: 'sum', 극한: 'lim',
    파이: 'pi', 세타: 'theta', 알파: 'alpha', 베타: 'beta', 감마: 'gamma',
    람다: 'lambda', 델타: 'delta', 오메가: 'omega', 뮤: 'mu',
    플마: 'pm', 플러스마이너스: 'pm', 곱하기: 'cdot', 나누기: 'frac',
    분의: 'frac', 제곱: '2', 세제곱: '3', 도: 'circ',
  };

  // 서식 기호를 걷어내고 낱말이 살아남았는지 본다. 한국어는 조사가 붙었다
  // 떨어지므로 앞부분만 같아도 남은 것으로 치고, 숫자는 정확히 일치해야 한다.
  function missingBits(src, out) {
    const strip = (s) => String(s).replace(/[*_`~#>|\\$[\]()\-]/g, ' ').replace(/\s+/g, ' ');
    const o = strip(out);

    const oMath = String(out)
      .replace(/\\(?:left|right|quad|qquad|mathrm|text|operatorname|displaystyle|,|;|!)/g, ' ')
      .replace(/\\([a-zA-Z]+)/g, '$1')
      .replace(/[{}_^*+\-/=·,.\s]/g, '');
    const flat = (s) => s.replace(/[{}_^*+\-/=·,.]/g, '');

    const seen = new Set();
    const numbers = [];
    const words = [];

    for (let w of strip(src).split(' ')) {
      if (w.length < 2 || seen.has(w)) continue;
      seen.add(w);
      w = w.replace(/^[.,;:]+|[.,;:]+$/g, '');
      if (w.length < 2) continue;

      const nums = w.match(/\d+(?:[.,]\d+)?/g);
      if (nums) {
        for (const n of nums) {
          if (o.includes(n)) continue;
          if (oMath.includes(n.replace(/[.,]/g, ''))) continue;
          if (numbers.indexOf(n) === -1) numbers.push(n);
        }
        continue;
      }
      if (NOISE.has(w)) continue;

      let kept = false;
      for (let n = w.length; n >= Math.max(2, w.length - 3); n--) {
        const piece = w.slice(0, n);
        if (o.includes(piece)) { kept = true; break; }
        const fp = flat(piece);
        if (fp.length >= 2 && oMath.includes(fp)) { kept = true; break; }
        const syn = MATH_SYN[piece];
        if (syn && oMath.includes(syn)) { kept = true; break; }
      }
      if (!kept) words.push(w);
    }
    return { numbers, words };
  }

  // 빠진 낱말이 들어 있던 원문 조각을 뽑아, 다시 시도할 때 그대로 짚어 준다.
  function missingContext(src, miss) {
    const all = miss.numbers.concat(miss.words);
    if (!all.length) return [];
    const chunks = String(src).split(/[\n!?·]+|(?<!\d)\.(?!\d)/)
      .map((s) => s.trim()).filter((s) => s.length > 1);
    const hit = chunks.filter((c) => all.some((m) => c.includes(m)));
    const picked = (hit.length ? hit : all).slice(0, 8);
    let budget = 600;
    const out = [];
    for (const p of picked) {
      if (budget - p.length < 0) break;
      budget -= p.length;
      out.push(p);
    }
    return out.length ? out : all.slice(0, 8);
  }

  // 흘러 들어오는 조각은 지금 돌고 있는 칸에만 넣는다.
  document.addEventListener('DOMContentLoaded', () => {
    api.on('format:chunk', (p) => { if (active) active.onChunk(p); });
  });

  MdBox.missingBits = missingBits;
  global.MdBox = MdBox;
})(window);
