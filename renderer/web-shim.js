/* ══════════════════════════════════════════════════════════════════
   웹에서 쓰는 받침대 — 브라우저에는 Electron 의 `api` 가 없으므로
   같은 모양을 여기서 만들어 준다.

   자료는 이 브라우저의 localStorage 에 담고, 기기끼리 맞추는 일은
   데스크톱과 **똑같은 cloud.js** 가 한다. 그래서 맞추는 규칙이 하나뿐이다.

   이 PC 안에서만 뜻이 있는 것들(원본 연결, 탐색기에서 보기, 로컬 Llama)은
   여기서 조용히 빠진다. `api.ollama` 가 없으면 화면의 AI 단추도 사라진다.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const KEY = 'seorap:';

  function read(name, fallback) {
    try {
      const raw = localStorage.getItem(KEY + name);
      return raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(fallback));
    } catch (e) {
      return JSON.parse(JSON.stringify(fallback));
    }
  }

  function write(name, value) {
    try { localStorage.setItem(KEY + name, JSON.stringify(value)); } catch (e) { /* 꽉 찼다 */ }
    return true;
  }

  function box(name, fallback) {
    return {
      load: () => Promise.resolve(read(name, fallback)),
      save: (v) => Promise.resolve(write(name, v)),
    };
  }

  function newId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

  // ────────────────────────────── 첨부파일 ──────────────────────────────
  // 브라우저에는 디스크가 없다. 고른 파일을 바로 Storage 에 올리고,
  // 열 때는 내려받기 주소를 새 탭으로 연다.

  async function putFile(file) {
    if (!global.Cloud || !Cloud.signedIn()) {
      App.toast('먼저 설정에서 로그인해 주세요.');
      return null;
    }
    if (!Cloud.storageOn()) {
      App.toast('여기서는 파일을 올릴 수 없습니다. PC 앱에서 넣어 주세요.');
      return null;
    }
    const info = Cloud.attInfo();
    if (file.size > info.max) {
      App.toast(file.name + ' 은 너무 큽니다. 한 개 '
        + Math.round(info.max / 1024 / 1024) + 'MB 까지 올릴 수 있습니다.');
      return null;
    }
    const id = newId('att');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ok = await Cloud.putBytes(id, bytes, file.type, file.name);
    if (!ok) { App.toast('올리지 못했습니다.'); return null; }
    return {
      id,
      name: file.name,
      mode: 'managed',
      cloud: true,
      isImage: IMAGE.test(file.name),
      missing: false,
      size: file.size,
      mtimeMs: Date.now(),
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function pickFiles() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        const files = Array.from(input.files || []);
        input.remove();
        const out = [];
        for (const f of files) {
          const a = await putFile(f);
          if (a) out.push(a);
        }
        resolve(out);
      });
      // 창을 닫아버린 경우를 대비해 너무 오래 붙잡지 않는다
      input.addEventListener('cancel', () => { input.remove(); resolve([]); });
      input.click();
    });
  }

  async function openAttachment(id) {
    const url = global.Cloud ? await Cloud.attUrl(id) : '';
    if (!url) {
      App.toast(global.Cloud && Cloud.storageOn()
        ? '이 파일은 아직 안 올라왔습니다.'
        : '이 파일은 PC 앱에만 있습니다.');
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  global.api = {
    events: box('events', []),
    notes: box('notes', []),
    links: box('links', []),
    files: box('files', []),
    folders: box('folders', []),
    settings: box('settings', {}),
    sync: box('sync', { tombs: [], meta: {} }),

    attach: {
      // 경로로 가져오는 건 브라우저에 없다. 내용으로 받는 길만 쓴다.
      add: () => Promise.resolve([]),
      addBuffer: async (eventId, name, bytes) => {
        const file = new File([new Uint8Array(bytes)], name || 'file');
        return putFile(file);
      },
      pick: () => pickFiles(),
      open: (id) => openAttachment(id),
      reveal: () => Promise.resolve(),
      remove: async (id) => (global.Cloud ? Cloud.deleteBytes(id) : false),
      duplicate: () => Promise.resolve(null),
      verify: () => Promise.resolve(true),
      organize: () => Promise.resolve({ ok: false, error: '웹에서는 AI 기능을 쓸 수 없습니다.' }),
      pathOf: () => '',
    },

    dialog: {
      pickFiles: () => Promise.resolve([]),
      pickFolder: () => Promise.resolve(''),
    },

    shell: {
      openData: () => Promise.resolve(),
      openExternal: (url) => { if (/^https?:/i.test(url)) window.open(url, '_blank', 'noopener'); },
    },

    app: {
      info: () => Promise.resolve({ dataDir: '이 브라우저', home: '', version: 'web' }),
      quit: () => Promise.resolve(),
    },

    on: () => () => {},
    // ollama 는 일부러 없다 — 이 PC에서 도는 모델이라 브라우저에서는 못 쓴다.
  };

  // 첨부 그림 주소는 Storage 에서 온다.
  global.attSrc = (id) => (global.Cloud ? Cloud.attUrlSync(id) : '');
  global.IS_WEB = true;
})(window);
