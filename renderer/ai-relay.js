/* ══════════════════════════════════════════════════════════════════
   AI 심부름 — 휴대폰에서도 Llama 를 쓴다

   Llama 는 이 PC 안에서 돈다. 휴대폰이 그걸 쓰려면 길이 있어야 하는데,
   바깥으로 포트를 여는 건(터널·포트포워딩) 그 순간 집 컴퓨터가 인터넷에
   노출된다는 뜻이라 하지 않는다.

   대신 **파이어베이스를 우체통으로 쓴다.**

     휴대폰  →  users/{uid}/ai 에 "이것 좀 해 주세요" 를 적어 둔다
     PC 앱   →  그걸 집어다 Llama 를 돌리고, 답을 그 자리에 적는다
     휴대폰  →  답이 적히면 받아서 쓰고, 쪽지를 지운다

   그래서 열리는 구멍이 하나도 없다. 오가는 건 전부 로그인한 자기 자리 안이고,
   PC가 꺼져 있으면 그냥 "PC가 꺼져 있습니다" 라고 말한다.

   이 파일 하나가 양쪽을 다 맡는다.
     - `api.ollama` 가 있는 기기(=PC 앱)  → **일꾼**이 된다
     - 없는 기기(=브라우저)              → **부탁하는 쪽**의 `api.ollama` 를 만들어 준다
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const BEAT_MS = 60 * 1000;        // 일꾼이 "살아 있음" 을 적는 주기
  const ALIVE_MS = 180 * 1000;      // 이보다 오래되면 꺼진 것으로 본다
  const SWEEP_MS = 20 * 60 * 1000;  // 이보다 오래된 쪽지는 치운다
  const MAX_IN = 190000;            // 규칙의 뚜껑보다 조금 작게
  const MAX_OUT = 380000;

  const nowISO = () => new Date().toISOString();
  const aiCol = () => (global.Cloud ? Cloud.col('ai') : null);
  const workerDoc = () => (global.Cloud ? Cloud.doc('meta', 'worker') : null);

  const AIRelay = {
    // 이 기기가 일꾼인가 (Llama 를 직접 돌릴 수 있는가)
    get isWorker() { return !!(global.api && api.ollama && !api.ollama.__relay); },
    init,
    workerOnline,
  };

  function init() {
    if (!global.Cloud || !Cloud.configured()) return;
    Cloud.onChange(() => {
      if (Cloud.signedIn()) { if (AIRelay.isWorker) startWorker(); }
      else stopWorker();
    });
    if (Cloud.signedIn() && AIRelay.isWorker) startWorker();
  }

  // ══════════════════════════ 일꾼 (PC 앱) ══════════════════════════

  let unsub = null;
  let unsub2 = null;
  let beatTimer = null;
  let sweepTimer = null;
  let busy = false;
  const queue = [];
  let running = null;             // 지금 돌리고 있는 쪽지의 id

  function startWorker() {
    if (unsub) return;
    const col = aiCol();
    if (!col) return;

    beat();
    beatTimer = setInterval(beat, BEAT_MS);
    sweepTimer = setInterval(sweep, SWEEP_MS);

    unsub = col.where('status', '==', 'pending').onSnapshot((snap) => {
      for (const ch of snap.docChanges()) {
        if (ch.type !== 'added') continue;
        if (!queue.includes(ch.doc.id)) queue.push(ch.doc.id);
      }
      pump();
    }, () => { /* 권한이 없거나 끊겼다 — 다음 로그인 때 다시 */ });

    // 부탁하던 쪽이 취소하면 쪽지를 지운다. 그러면 돌리던 것도 멈춘다.
    unsub2 = col.onSnapshot((snap) => {
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed' && ch.doc.id === running && api.ollama.formatStop) {
          api.ollama.formatStop();
        }
      }
    }, () => {});
  }

  function stopWorker() {
    if (unsub) { try { unsub(); } catch (e) { /* 이미 끊김 */ } unsub = null; }
    if (unsub2) { try { unsub2(); } catch (e) { /* 이미 끊김 */ } unsub2 = null; }
    clearInterval(beatTimer); beatTimer = null;
    clearInterval(sweepTimer); sweepTimer = null;
    queue.length = 0;
  }

  // "나 여기 켜져 있어요" 를 주기적으로 적는다. 휴대폰은 이걸 보고 판단한다.
  async function beat() {
    const doc = workerDoc();
    if (!doc) return;
    let models = [];
    try {
      const st = await api.ollama.status();
      if (st && st.ok) models = (st.models || []).slice(0, 60);
    } catch (e) { /* Ollama 가 안 떠 있다 — 그래도 켜져 있다고는 알린다 */ }
    try { await doc.set({ at: nowISO(), models }); } catch (e) { /* 다음 번에 */ }
  }

  // 오래된 쪽지를 치운다. 부탁한 쪽이 창을 닫아버린 경우다.
  async function sweep() {
    const col = aiCol();
    if (!col) return;
    const cut = new Date(Date.now() - SWEEP_MS).toISOString();
    try {
      const snap = await col.where('createdAt', '<', cut).limit(50).get();
      for (const d of snap.docs) await d.ref.delete();
    } catch (e) { /* 다음 번에 */ }
  }

  async function pump() {
    if (busy) return;
    const id = queue.shift();
    if (!id) return;
    busy = true;
    try { await handle(id); } catch (e) { /* 아래에서 적었다 */ }
    busy = false;
    if (queue.length) pump();
  }

  async function handle(id) {
    const col = aiCol();
    if (!col) return;
    const ref = col.doc(id);

    // 두 대가 켜져 있어도 한 대만 집도록 — 먼저 집는 쪽이 임자다.
    let job = null;
    try {
      job = await firebase.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const d = snap.data();
        if (d.status !== 'pending') return null;
        tx.update(ref, { status: 'working', updatedAt: nowISO() });
        return d;
      });
    } catch (e) {
      return;
    }
    if (!job) return;

    running = id;
    let out = null;
    let err = '';
    try {
      out = await run(id, job);
    } catch (e) {
      err = (e && e.message) || '알 수 없는 오류';
    }
    running = null;

    let text = '';
    try { text = JSON.stringify(out === undefined ? null : out); } catch (e) { err = '답을 옮기지 못했습니다.'; }
    if (!err && text.length > MAX_OUT) err = '결과가 너무 깁니다. PC 앱에서 해 주세요.';

    try {
      if (err) await ref.update({ status: 'error', err: String(err).slice(0, 1500), updatedAt: nowISO() });
      else await ref.update({ status: 'done', out: text, updatedAt: nowISO() });
    } catch (e) { /* 부탁한 쪽이 이미 지웠다 */ }
  }

  async function run(id, job) {
    const inp = JSON.parse(job.input || '{}');
    if (job.op === 'parse') {
      return api.ollama.parse(String(inp.text || ''), inp.model);
    }
    if (job.op === 'format') {
      return api.ollama.format('relay-' + id, String(inp.text || ''), inp.model, inp.prev, inp.missing);
    }
    if (job.op === 'organize') {
      return api.attach.organize(inp.files || [], inp.context || '', inp.model, inp.wish || '');
    }
    throw new Error('모르는 부탁입니다: ' + job.op);
  }

  // ══════════════════════ 부탁하는 쪽 (브라우저) ══════════════════════

  // PC 앱이 지금 켜져 있는가
  async function workerOnline() {
    const doc = workerDoc();
    if (!doc) return false;
    try {
      const s = await doc.get();
      if (!s.exists) return false;
      const at = Date.parse(s.data().at || '');
      return !!at && (Date.now() - at) < ALIVE_MS;
    } catch (e) {
      return false;
    }
  }

  async function workerModels() {
    const doc = workerDoc();
    if (!doc) return [];
    try {
      const s = await doc.get();
      return s.exists ? (s.data().models || []) : [];
    } catch (e) { return []; }
  }

  let pending = null;             // 지금 기다리는 쪽지 (취소용)

  const OFFLINE = 'PC 앱이 꺼져 있습니다. AI는 그 컴퓨터에서 돌기 때문에 켜 두셔야 합니다.';

  async function ask(op, input, waitMs) {
    const col = aiCol();
    if (!col) return { ok: false, error: '먼저 설정 → 클라우드에서 로그인해 주세요.' };
    if (!(await workerOnline())) return { ok: false, error: OFFLINE };

    let payload;
    try { payload = JSON.stringify(input || {}); } catch (e) { return { ok: false, error: '보낼 수 없는 내용입니다.' }; }
    if (payload.length > MAX_IN) return { ok: false, error: '글이 너무 깁니다. PC 앱에서 해 주세요.' };

    const ref = col.doc();
    try {
      await ref.set({ op, status: 'pending', input: payload, createdAt: nowISO(), updatedAt: nowISO() });
    } catch (e) {
      return { ok: false, error: '부탁을 보내지 못했습니다.' };
    }

    pending = ref;
    const res = await waitFor(ref, waitMs);
    pending = null;
    try { await ref.delete(); } catch (e) { /* 이미 없다 */ }
    return res;
  }

  function waitFor(ref, waitMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (done) return; done = true; clearTimeout(timer); off(); resolve(r); };

      const timer = setTimeout(() => finish({
        ok: false,
        error: 'PC가 시간 안에 답하지 못했습니다. 모델이 크면 오래 걸립니다.',
      }), waitMs);

      const off = ref.onSnapshot((snap) => {
        if (!snap.exists) return;
        const d = snap.data();
        if (d.status === 'done') {
          let out = null;
          try { out = JSON.parse(d.out || 'null'); } catch (e) { /* 망가진 답 */ }
          finish(out && typeof out === 'object' ? out : { ok: false, error: '답을 읽지 못했습니다.' });
        } else if (d.status === 'error') {
          finish({ ok: false, error: d.err || '실패했습니다.' });
        }
      }, () => finish({ ok: false, error: '기다리는 중에 끊겼습니다.' }));
    });
  }

  // 브라우저에는 Llama 가 없으니, 같은 모양의 `api.ollama` 를 여기서 만든다.
  // 화면 쪽 코드(nl.js · mdbox.js)는 이게 심부름인지 모른 채 그대로 쓴다.
  function installClient() {
    if (!global.api || api.ollama) return;

    api.ollama = {
      __relay: true,
      async status() {
        if (!global.Cloud || !Cloud.signedIn()) {
          return { ok: false, models: [], error: '로그인하지 않았습니다' };
        }
        if (!(await workerOnline())) return { ok: false, models: [], error: 'PC 앱이 꺼져 있음' };
        return { ok: true, models: await workerModels() };
      },
      warm: () => Promise.resolve(true),          // 데울 건 저쪽 몫이다
      parse: (text, model) => ask('parse', { text, model }, 3 * 60 * 1000),
      format: (id, text, model, prev, missing) =>
        ask('format', { text, model, prev, missing }, 12 * 60 * 1000),
      formatStop: async () => {
        if (pending) { try { await pending.delete(); } catch (e) { /* 이미 없다 */ } }
        return true;
      },
    };

    // 파일 AI 정리도 같은 길로 보낸다.
    if (api.attach) {
      api.attach.organize = (files, context, model, wish) =>
        ask('organize', { files, context, model, wish }, 6 * 60 * 1000);
    }
  }

  installClient();
  global.AIRelay = AIRelay;
})(window);
