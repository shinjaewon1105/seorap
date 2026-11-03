/* ══════════════════════════════════════════════════════════════════
   화면 이동 — 창 하나, 탭 없음.
   달력(홈)과 파일이 본 화면이고, 마감·필기 하나를 열면 그 위에 덮인다.
   어디서 왔는지만 기억해서 ← 로 돌아간다.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const screens = {};        // 이름 → { el, title(route), show(route), leave(route), live }
  let hist = [];
  let at = -1;
  let el = {};

  const HOME = { v: 'home' };
  const ROOTS = ['home', 'files'];        // 본 화면 — 돌아갈 자리

  const Nav = {
    register(name, def) { screens[name] = def; },

    init() {
      el = {
        back: $('#navBack'), title: $('#screenTitle'),
        seg: $('#navSeg'), screens: $('#screens'),
      };
      el.back.addEventListener('click', () => this.back());
      el.seg.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b) this.go({ v: b.dataset.view });
      });
      return this;
    },

    get current() { return at >= 0 ? hist[at] : null; },

    go(route) {
      const cur = this.current;
      if (cur && same(cur, route)) { paint(); return; }
      leaveCurrent();
      // 본 화면끼리 오갈 때는 기록을 쌓지 않는다. 뒤로 가기가 지저분해진다.
      if (cur && ROOTS.includes(cur.v) && ROOTS.includes(route.v)) hist[at] = route;
      else {
        hist = hist.slice(0, at + 1).concat([route]);
        if (hist.length > 50) hist.shift();
        at = hist.length - 1;
      }
      paint();
    },

    replace(route) {
      if (at < 0) { this.go(route); return; }
      leaveCurrent();
      hist[at] = route;
      paint();
    },

    canBack() { return at > 0; },
    canForward() { return at < hist.length - 1; },

    back() {
      if (at <= 0) return;
      leaveCurrent();
      at -= 1;
      paint();
    },

    forward() {
      if (at >= hist.length - 1) return;
      leaveCurrent();
      at += 1;
      paint();
    },

    // 돌아갈 데가 있으면 뒤로, 없으면 이 자리를 대신 채운다 (지운 뒤에 쓴다)
    backOr(route) {
      if (at > 0) this.back();
      else this.replace(route);
    },

    // 화면 이름만 고쳐 그린다 — 글을 쓰는 중인 화면을 건드리지 않는다.
    touch() { paintTitle(); },

    // 데이터가 바뀌었을 때 — 목록 화면은 다시 그리고, 손으로 고치는 중인
    // 화면(마감 하나·필기 하나)은 이름만 고친다.
    softRefresh() {
      const r = this.current;
      if (!r) return;
      const s = screens[r.v];
      if (s && s.show && !s.live) s.show(r);
      paintTitle();
    },

    refresh(view) {
      const r = this.current;
      if (!r || (view && r.v !== view)) return;
      const s = screens[r.v];
      if (s && s.show) s.show(r);
      paintTitle();
    },

    paint,
    HOME,
  };

  function same(a, b) {
    return a.v === b.v && (a.id || '') === (b.id || '')
      && (a.sub || '') === (b.sub || '') && (a.date || '') === (b.date || '');
  }

  function leaveCurrent() {
    const r = Nav.current;
    if (!r) return;
    const s = screens[r.v];
    if (s && s.leave) s.leave(r);
  }

  function paint() {
    if (at < 0) { hist = [HOME]; at = 0; }
    const r = Nav.current;

    for (const name in screens) {
      const s = screens[name];
      if (s.el) s.el.hidden = (name !== r.v);
    }
    const s = screens[r.v];
    if (s && s.show) s.show(r);

    paintTitle();
    document.body.dataset.view = r.v;
  }

  function paintTitle() {
    const r = Nav.current;
    if (!r) return;
    const s = screens[r.v];
    const t = s && s.title ? s.title(r) : '';

    el.back.hidden = at <= 0;
    // 본 화면에서는 제목을 굳이 되풀이하지 않는다 — 아래 화면이 이미 말해 준다.
    el.title.textContent = ROOTS.includes(r.v) ? '' : (t || '');
    el.title.hidden = !el.title.textContent;

    for (const b of el.seg.children) {
      b.classList.toggle('on', b.dataset.view === r.v);
    }
  }

  global.Nav = Nav;
})(window);
