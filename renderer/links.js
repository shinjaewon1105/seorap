/* ══════════════════════════════════════════════════════════════════
   링크 — 마감·필기 안에 붙여 두는 칸.
   따로 모아 둔 링크는 파일 화면에서 폴더로 정리한다.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const U = () => Store.util;
  const collapsed = new Set();
  let editing = null;        // 지금 펼쳐 놓고 고치는 링크 id

  const Links = {
    init() {},

    // 마감·필기 안에 넣는 링크 칸
    section(mount, ownerId) { return new Section(mount, ownerId); },

    open,
  };

  function open(l) {
    if (!l.url) return;
    api.shell.openExternal(l.url);
  }

  // 주소만 받아 담고, 제목은 뒤에서 천천히 받아온다.
  async function addFromInput(input, ownerId, after) {
    const raw = input.value.trim();
    if (!raw) return;
    input.value = '';
    const l = Store.createLink({ url: raw, owner: ownerId || '' });
    if (after) after();
    fetchTitle(l.id, after);
  }

  async function fetchTitle(id, after) {
    const l = Store.getLink(id);
    if (!l || l.title || !/^https?:/i.test(l.url)) return;
    const res = await api.links.title(l.url);
    if (res && res.ok && res.title && Store.getLink(id) && !Store.getLink(id).title) {
      Store.updateLink(id, { title: res.title });
    }
    if (after) after();
  }

  function iconBtn(title, d, fn) {
    const b = document.createElement('button');
    b.className = 'icon-btn sm';
    b.title = title;
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    s.appendChild(p);
    b.appendChild(s);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  }

  // ────────────────── 마감·필기에 딸린 링크 칸 ──────────────────

  function Section(mount, ownerId) {
    this.owner = ownerId;
    const root = document.createElement('div');
    root.className = 'link-block';

    const bar = document.createElement('div');
    bar.className = 'md-bar';
    const lab = document.createElement('span');
    lab.className = 'md-label';
    lab.textContent = '링크';
    bar.appendChild(lab);
    this.count = document.createElement('span');
    this.count.className = 'task-progress';
    this.count.hidden = true;
    bar.appendChild(this.count);
    root.appendChild(bar);

    const addRow = document.createElement('div');
    addRow.className = 'link-add';
    const input = document.createElement('input');
    input.className = 'f-input';
    input.placeholder = '주소를 붙여넣으세요';
    input.autocomplete = 'off';
    addRow.appendChild(input);
    const btn = document.createElement('button');
    btn.className = 'btn-ghost sm';
    btn.textContent = '＋ 담기';
    addRow.appendChild(btn);
    root.appendChild(addRow);

    this.list = document.createElement('div');
    this.list.className = 'link-list';
    root.appendChild(this.list);

    const self = this;
    const submit = () => addFromInput(input, self.owner, () => self.render());
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    input.addEventListener('paste', (e) => {
      const t = (e.clipboardData && e.clipboardData.getData('text')) || '';
      if (!/^\s*(https?:\/\/|www\.)\S+\s*$/i.test(t)) return;
      e.preventDefault();
      input.value = t.trim();
      submit();
    });

    mount.appendChild(root);
    this.root = root;
    this.render();
  }

  Section.prototype.setOwner = function (id) { this.owner = id; this.render(); };

  Section.prototype.render = function () {
    const self = this;
    const list = Store.linksOf(this.owner);
    this.count.hidden = !list.length;
    this.count.textContent = list.length + '개';

    if (!list.length) {
      const e = document.createElement('div');
      e.className = 'link-empty';
      e.textContent = '아직 담아 둔 링크가 없습니다.';
      this.list.replaceChildren(e);
      return;
    }
    this.list.replaceChildren(...list.map((l) => {
      const n = document.createElement('div');
      n.className = 'lk small';
      n.dataset.id = l.id;

      const mark = document.createElement('span');
      mark.className = 'lk-mark';
      mark.textContent = U().linkInitial(l);
      n.appendChild(mark);

      const main = document.createElement('div');
      main.className = 'lk-main';
      const t = document.createElement('div');
      t.className = 'lk-title';
      t.textContent = U().linkLabel(l);
      main.appendChild(t);
      const sub = document.createElement('div');
      sub.className = 'lk-sub';
      sub.textContent = l.url;
      main.appendChild(sub);
      n.appendChild(main);

      const acts = document.createElement('div');
      acts.className = 'lk-acts';
      acts.appendChild(iconBtn('파일 화면으로 빼기', 'M12 5v14M5 12h14', () => {
        Store.updateLink(l.id, { owner: '' });
        self.render();
        if (global.Files) Files.render();
        App.toast('파일 화면으로 옮겼습니다.');
      }));
      acts.appendChild(iconBtn('지우기', 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', () => {
        Store.removeLink(l.id);
        self.render();
      }));
      n.appendChild(acts);

      n.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        open(l);
      });
      return n;
    }));
  };

  global.Links = Links;
})(window);
