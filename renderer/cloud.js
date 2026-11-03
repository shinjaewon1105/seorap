/* ══════════════════════════════════════════════════════════════════
   클라우드 — Firebase 로 기기끼리 자료를 맞춘다.

   규칙은 하나다: **항목마다 updatedAt 이 늦은 쪽이 이긴다.**
   지운 것은 흔적(tomb)을 남겨서, "없어졌다"와 "아직 안 받았다"를 구별한다.

   설정이 비어 있으면(renderer/firebase-config.js) 이 파일은 아무것도 하지 않는다.
   앱은 예전처럼 이 PC 안에서만 돌아간다.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const COLS = [
    { k: 'e', name: 'events', get: () => Store.events, norm: (x) => Store.util.normalize(x) },
    { k: 'n', name: 'notes', get: () => Store.notes, norm: (x) => Store.util.normNote(x) },
    { k: 'l', name: 'links', get: () => Store.links, norm: (x) => Store.util.normLink(x) },
    { k: 'f', name: 'files', get: () => Store.files, norm: (x) => Store.util.normFile(x) },
  ];

  let app = null;
  let db = null;
  let storage = null;
  let auth = null;
  let uid = null;
  /* off      설정이 없다 — 클라우드를 아예 안 쓴다
     out      로그인 전
     verify   로그인은 했는데 이메일 확인 전
     noadmin  아직 이 앱의 관리자가 없다 (처음 한 사람이 등록해야 한다)
     pending  관리자 승인 기다리는 중
     working  맞추는 중
     ok       맞추고 있다
     error    문제가 있다 */
  let state = 'off';
  let adminUid = '';
  let approved = false;
  let memberUnsub = null;
  let detail = '';
  const listeners = new Set();
  const unsubs = [];
  let pushTimer = null;
  let pulling = false;          // 받아 오는 중에는 다시 올리지 않는다
  const urlCache = new Map();

  const Cloud = {
    get state() { return state; },
    get detail() { return detail; },
    get email() { return auth && auth.currentUser ? auth.currentUser.email : ''; },
    get uid() { return uid; },
    configured() { return !!(global.FIREBASE_CONFIG && global.FIREBASE_CONFIG.apiKey); },
    signedIn() { return !!uid; },
    // 첨부파일 내용까지 올리는가. 꺼져 있으면 이름과 자리만 맞춰진다.
    storageOn() { return attMode() !== 'off'; },
    attMode,
    attInfo() {
      return {
        mode: attMode(), pending: attInfo.pending, skipped: attInfo.skipped,
        used: usage || 0, cap: MAX_USER, max: MAX_FILE,
      };
    },

    // 내 자리 아래의 칸 하나. 로그인 전에는 null 이다. (ai-relay.js 가 쓴다)
    col(name) { return (db && uid) ? root().collection(name) : null; },
    doc(name, id) { return (db && uid) ? root().collection(name).doc(id) : null; },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async init() {
      if (!this.configured()) { set('off'); return; }
      if (typeof firebase === 'undefined') { set('error', 'Firebase 파일을 못 불러왔습니다.'); return; }
      try {
        app = firebase.initializeApp(global.FIREBASE_CONFIG);
        auth = firebase.auth();
        db = firebase.firestore();
        // Storage 는 카드 등록(Blaze)이 있어야 켜진다. firebase-config.js 에서 끈다.
        storage = (global.FIREBASE_STORAGE === true && firebase.storage) ? firebase.storage() : null;
        // 인터넷이 끊겨도 쓰던 자료가 그대로 보이게 한다.
        try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* 이미 켜졌거나 안 되는 환경 */ }
        auth.onAuthStateChanged((user) => {
          uid = user ? user.uid : null;
          stopMember();
          approved = false;
          if (uid) gate().catch((e) => set('error', message(e)));
          else { stop(); set('out'); }
        });
        set('out');
      } catch (e) {
        set('error', e.message);
      }
    },

    /* 실패해도 `set('error')` 를 부르지 않는다.
       그러면 상태가 바뀌면서 로그인 칸이 통째로 사라져 다시 시도할 수가 없다.
       실수한 것뿐인데 화면이 없어지면 안 된다 — 틀렸다고만 말해 주면 된다. */
    async signIn(email, password) {
      if (!auth) return { ok: false, error: '클라우드가 꺼져 있습니다.' };
      try {
        await auth.signInWithEmailAndPassword(email, password);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: message(e), code: String((e && e.code) || '') };
      }
    },

    async signOut() {
      if (!auth) return;
      await auth.signOut();
    },

    // 새로 쓰는 사람이 스스로 계정을 만든다. 만들자마자 확인 메일이 한 통 간다.
    async signUp(email, password) {
      if (!auth) return { ok: false, error: '클라우드가 꺼져 있습니다.' };
      try {
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        // 메일이 안 가더라도 가입 자체는 된 것이다. 막지 않는다.
        try { await cred.user.sendEmailVerification(); } catch (e) { /* 나중에 다시 보낼 수 있다 */ }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: message(e), code: String((e && e.code) || '') };
      }
    },

    // 비밀번호를 잊었을 때. 가짜 이메일로 가입했으면 이 길이 없다.
    async resetPassword(email) {
      if (!auth) return { ok: false, error: '클라우드가 꺼져 있습니다.' };
      try {
        await auth.sendPasswordResetEmail(email);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: message(e) };
      }
    },

    get verified() { return !!(auth && auth.currentUser && auth.currentUser.emailVerified); },

    // 무엇이 막고 있는지 한눈에. "그냥 안 됨" 을 없애려고 둔다.
    async diag() {
      const u = auth && auth.currentUser;
      return {
        state,
        signedIn: !!u,
        email: u ? (u.email || '') : '',
        verified: !!(u && u.emailVerified),
        tokenVerified: await tokenVerified(false),
        hasAdmin: !!adminUid,
        isAdmin: !!uid && uid === adminUid,
        approved,
        uid: uid || '',
      };
    },
    get approved() { return approved; },
    isAdmin() { return !!uid && uid === adminUid; },
    hasAdmin() { return !!adminUid; },

    /* 이 앱의 관리자를 정한다. **처음 한 사람만** 된다 —
       규칙이 `config/admin` 을 만들기만 허락하고 고치지는 못하게 막는다. */
    async claimAdmin() {
      if (!uid || !auth.currentUser) return { ok: false, error: '로그인하지 않았습니다.' };
      if (!auth.currentUser.emailVerified) return { ok: false, error: '이메일 확인이 먼저입니다.' };
      // 규칙은 토큰 안의 email_verified 만 본다. 먼저 새로 받아 온다.
      if (!(await tokenVerified(false)) && !(await tokenVerified(true))) {
        note('관리자 등록 막힘 — 토큰에 확인 표시가 없다 uid=' + uid);
        return { ok: false, error: '확인 표시가 아직 안 붙었습니다. 로그아웃했다 다시 로그인해 보세요.' };
      }
      note('관리자 등록 시도 uid=' + uid);
      try {
        // 이미 있으면 규칙이 덮어쓰기를 막는다. 그게 누구인지 먼저 보고 말해 준다.
        const cur = await db.collection('config').doc('admin').get();
        if (cur.exists) {
          adminUid = String(cur.data().uid || '');
          await gate();
          return adminUid === uid
            ? { ok: true }
            : { ok: false, error: '이미 다른 계정이 관리자로 등록돼 있습니다.' };
        }
        await db.collection('config').doc('admin').set({
          uid, email: auth.currentUser.email || '', at: new Date().toISOString(),
        });
        adminUid = uid;
        await gate();
        return { ok: true };
      } catch (e) {
        note('관리자 등록 실패 — code=' + ((e && e.code) || '?')
          + ' msg=' + String((e && e.message) || '').slice(0, 200)
          + ' uid=' + uid + ' adminUid=' + (adminUid || '(없음)'));
        await gate();
        // 막힌 이유를 뭉뚱그리지 않는다. "이미 다른 계정" 이라고 둘러대면 손쓸 수가 없다.
        const code = String((e && e.code) || '');
        if (code.includes('permission-denied')) {
          return { ok: false, error: adminUid
            ? '이미 다른 계정이 관리자로 등록돼 있습니다.'
            : '규칙이 막았습니다. 이메일 확인이 토큰에 아직 안 붙은 듯합니다 — '
              + '로그아웃했다 다시 로그인해 보세요.' };
        }
        return { ok: false, error: message(e) };
      }
    },

    // 관리자가 보는 가입 신청 목록
    async members() {
      if (!db || !uid || uid !== adminUid) return [];
      try {
        const snap = await db.collection('members').get();
        return snap.docs
          .map((d) => Object.assign({ id: d.id }, d.data()))
          .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
      } catch (e) {
        return [];
      }
    },

    async setApproved(who, yes) {
      if (!db || uid !== adminUid) return false;
      try {
        await db.collection('members').doc(who).update({ approved: !!yes, by: uid });
        return true;
      } catch (e) {
        return false;
      }
    },

    async removeMember(who) {
      if (!db || uid !== adminUid) return false;
      try { await db.collection('members').doc(who).delete(); return true; } catch (e) { return false; }
    },

    // 링크를 누르고 온 다음에는 이걸 불러야 앱이 안다.
    async refreshUser() {
      if (!auth || !auth.currentUser) return false;
      try { await auth.currentUser.reload(); } catch (e) { return false; }
      const ok = auth.currentUser.emailVerified;
      // reload() 는 사람 정보만 새로 읽는다. **토큰은 그대로다.**
      // 규칙이 보는 건 토큰뿐이라, 여기서 새로 받아오지 않으면
      // "확인했는데도 아무것도 안 된다" 가 된다. (실제로 여기서 막혔다)
      if (ok) { try { await auth.currentUser.getIdToken(true); } catch (e) { /* 다음 기회에 */ } }
      // 확인이 끝났든 아니든, 아직 문 앞이면 처음부터 다시 두드려 본다.
      if (ok && state !== 'ok' && state !== 'working') gate().catch(() => {});
      else for (const fn of listeners) fn(state, detail);
      return ok;
    },

    async sendVerify() {
      if (!auth || !auth.currentUser) return { ok: false, error: '로그인하지 않았습니다.' };
      try {
        await auth.currentUser.sendEmailVerification();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: message(e) };
      }
    },

    // 자료가 바뀔 때마다 부른다 (Store.onChange 에서)
    nudge() {
      if (!uid || pulling) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => pushAll().catch((e) => set('error', message(e))), 800);
    },

    // 지금 당장 한 번 맞춘다
    async syncNow() {
      if (!uid) return;
      await pullAll();
      await pushAll();
    },

    // ── 첨부파일 ──
    uploadAttachment, downloadAttachment, attUrl, attUrlSync, forgetUrl,
    putBytes, getBytes, deleteBytes,
    ensureLocal: (att) => ensureLocal(att),
  };

  function set(s, d) {
    const changed = (s !== state) || (d || '') !== detail;
    state = s;
    detail = d || '';
    if (changed) note(s === 'error' ? ('오류 — ' + detail) : ('상태: ' + s + (detail ? ' — ' + detail : '')));
    for (const fn of listeners) fn(state, detail);
  }

  // 무슨 일이 있었는지 남겨 둔다. 화면의 토스트는 스쳐 지나가서 되짚을 수가 없다.
  function note(line) {
    try { if (global.api && api.log) api.log(line); } catch (e) { /* 기록은 덤이다 */ }
  }

  function message(e) {
    const m = String((e && e.code) || '');
    if (m.includes('email-already-in-use')) return '이미 그 이메일로 가입돼 있습니다. 로그인을 눌러 보세요.';
    if (m.includes('weak-password')) return '비밀번호가 너무 약합니다. 8자 이상으로 해 주세요.';
    if (m.includes('operation-not-allowed')) return '지금은 가입이 막혀 있습니다.';
    if (m.includes('missing-email')) return '이메일을 적어 주세요.';
    if (m.includes('wrong-password') || m.includes('invalid-credential')) return '이메일이나 비밀번호가 다릅니다.';
    if (m.includes('user-not-found')) return '그 이메일로 만든 사용자가 없습니다.';
    if (m.includes('user-disabled')) return '잠긴 계정입니다.';
    if (m.includes('invalid-email')) return '이메일 모양이 아닙니다.';
    if (m.includes('too-many-requests')) return '너무 여러 번 시도했습니다. 잠시 뒤에 다시.';
    if (m.includes('network')) return '인터넷에 닿지 못했습니다.';
    return (e && e.message) || '알 수 없는 오류';
  }

  const root = () => db.collection('users').doc(uid);

  // ────────────────────────── 들어오는 문 ──────────────────────────
  /* 세 문을 차례로 지난다: 이메일 확인 → 관리자가 있는가 → 승인받았는가.
     어디서 막혔는지가 그대로 상태가 되어 화면에 적힌다.
     "그냥 안 된다" 로 끝나지 않게 하는 게 이 함수의 일이다. */

  // 토큰 안의 email_verified — 규칙이 보는 값이다. 사람 정보(emailVerified)와 다를 수 있다.
  async function tokenVerified(force) {
    if (!auth || !auth.currentUser) return false;
    try {
      const r = await auth.currentUser.getIdTokenResult(!!force);
      return r.claims.email_verified === true;
    } catch (e) {
      return false;
    }
  }

  async function gate() {
    if (!auth.currentUser.emailVerified) { stop(); set('verify'); return; }

    // 확인 링크를 눌렀어도 손에 든 토큰은 한 시간쯤 예전 값을 물고 있다.
    // 규칙은 토큰을 보므로, 뒤처져 있으면 여기서 새로 받아 온다.
    if (!(await tokenVerified(false))) {
      if (!(await tokenVerified(true))) {
        stop();
        set('error', '이메일은 확인됐는데 인증 표시가 아직 안 붙었습니다. '
          + '로그아웃했다 다시 로그인하면 풀립니다.');
        return;
      }
    }

    try {
      const cfg = await db.collection('config').doc('admin').get();
      adminUid = cfg.exists ? String(cfg.data().uid || '') : '';
    } catch (e) {
      adminUid = '';
    }
    note('문지기 — 관리자=' + (adminUid || '(아직 없음)') + ' 나=' + uid);
    if (!adminUid) { stop(); set('noadmin'); return; }

    if (uid === adminUid) { approved = true; start(); return; }

    await ensureMember();
    watchMember();
  }

  // "쓰고 싶습니다" 를 적어 둔다. 관리자가 이걸 보고 승인한다.
  async function ensureMember() {
    try {
      const ref = db.collection('members').doc(uid);
      const snap = await ref.get();
      approved = !!(snap.exists && snap.data().approved);
      if (!snap.exists) {
        await ref.set({
          uid,
          email: (auth.currentUser.email || '').slice(0, 320),
          approved: false,
          at: new Date().toISOString(),
        });
      }
    } catch (e) { /* 아래 watchMember 가 다시 본다 */ }
  }

  // 승인이 떨어지는 순간 바로 맞추기 시작한다. 다시 켜지 않아도 되게.
  function watchMember() {
    stopMember();
    memberUnsub = db.collection('members').doc(uid).onSnapshot((snap) => {
      const was = approved;
      approved = !!(snap.exists && snap.data().approved);
      if (approved && !was) start();
      else if (!approved) { stop(); set('pending'); }
    }, () => set('pending'));
  }

  function stopMember() {
    if (memberUnsub) { try { memberUnsub(); } catch (e) { /* 이미 끊김 */ } memberUnsub = null; }
  }

  // ────────────────────────────── 시작 · 멈춤 ──────────────────────────────

  async function start() {
    set('working', '맞추는 중…');
    try {
      await pullAll();
      await pushAll();
      watch();
      set('ok');
    } catch (e) {
      set('error', message(e));
    }
  }

  function stop() {
    while (unsubs.length) { try { unsubs.pop()(); } catch (e) { /* 이미 끊김 */ } }
  }

  // 남이 고치면 바로 따라온다.
  function watch() {
    stop();
    for (const c of COLS) {
      unsubs.push(root().collection(c.name).onSnapshot((snap) => {
        if (!snap.docChanges().length) return;
        let touched = false;
        pulling = true;
        for (const ch of snap.docChanges()) {
          if (ch.doc.metadata.hasPendingWrites) continue;   // 내가 방금 쓴 것
          touched = applyDoc(c, ch.doc.id, ch.type === 'removed' ? null : ch.doc.data()) || touched;
        }
        pulling = false;
        if (touched) refresh(c);
      }, (e) => set('error', message(e))));
    }
    unsubs.push(root().collection('meta').doc('folders').onSnapshot((doc) => {
      if (!doc.exists || doc.metadata.hasPendingWrites) return;
      if (applyFolders(doc.data())) {
        Store.emit();
        if (global.Files) Files.render();
      }
    }));
  }

  // ────────────────────────────── 받아 오기 ──────────────────────────────

  async function pullAll() {
    pulling = true;
    try {
      for (const c of COLS) {
        const snap = await root().collection(c.name).get();
        let touched = false;
        snap.forEach((doc) => { touched = applyDoc(c, doc.id, doc.data()) || touched; });
        if (touched) refresh(c);
      }
      const f = await root().collection('meta').doc('folders').get();
      if (f.exists && applyFolders(f.data())) Store.emit();

      const t = await root().collection('meta').doc('tombs').get();
      if (t.exists) mergeTombs(t.data().list || []);
      applyTombs();
    } finally {
      pulling = false;
    }
  }

  // 문서 하나를 이 기기에 반영한다. 바뀌었으면 true.
  function applyDoc(c, id, data) {
    const list = c.get();
    const i = list.findIndex((x) => x.id === id);
    const mine = i >= 0 ? list[i] : null;

    if (!data) {                       // 저쪽에서 지웠다
      if (!mine) return false;
      list.splice(i, 1);
      return true;
    }
    const tomb = Store.buried(c.k, id);
    if (tomb && tomb.at > (data.updatedAt || '')) return false;   // 내가 나중에 지웠다

    if (mine && (mine.updatedAt || '') >= (data.updatedAt || '')) return false;  // 내 것이 더 새것
    const next = c.norm(Object.assign({}, data, { id }));
    if (mine) list[i] = next; else list.push(next);
    return true;
  }

  function applyFolders(data) {
    if (!data || !Array.isArray(data.list)) return false;
    const at = data.at || '';
    if ((Store.meta.foldersAt || '') >= at) return false;
    Store.folders = data.list.map(Store.util.cleanFolder).filter(Boolean);
    Store.meta.foldersAt = at;
    return true;
  }

  function mergeTombs(remote) {
    const byKey = new Map(Store.tombs.map((t) => [t.k + ':' + t.id, t]));
    for (const t of remote) {
      const key = t.k + ':' + t.id;
      const mine = byKey.get(key);
      if (!mine || t.at > mine.at) byKey.set(key, t);
    }
    Store.tombs = Array.from(byKey.values());
  }

  // 흔적보다 오래된 항목은 이 기기에서도 치운다.
  function applyTombs() {
    for (const c of COLS) {
      const list = c.get();
      for (let i = list.length - 1; i >= 0; i--) {
        const t = Store.buried(c.k, list[i].id);
        if (t && t.at > (list[i].updatedAt || '')) list.splice(i, 1);
      }
    }
  }

  function refresh(c) {
    if (c.name === 'events') Store.save();
    else if (c.name === 'notes') Store.saveNotes();
    else if (c.name === 'links') Store.saveLinks();
    else Store.saveFiles();
    if (global.Nav) Nav.softRefresh();
    if (global.Side) Side.renderDeadlines();
  }

  // ────────────────────────────── 올리기 ──────────────────────────────

  let lastPushed = new Map();       // id → updatedAt 로 이미 올린 것은 건너뛴다

  async function pushAll() {
    if (!uid) return;
    set('working', '올리는 중…');
    const batchLimit = 400;
    let batch = db.batch();
    let n = 0;

    for (const c of COLS) {
      const col = root().collection(c.name);
      for (const item of c.get()) {
        const key = c.k + ':' + item.id;
        if (lastPushed.get(key) === (item.updatedAt || '')) continue;
        batch.set(col.doc(item.id), clean(item), { merge: false });
        lastPushed.set(key, item.updatedAt || '');
        if (++n >= batchLimit) { await batch.commit(); batch = db.batch(); n = 0; }
      }
    }
    // 지운 것은 저쪽에서도 지운다
    for (const t of Store.tombs) {
      const c = COLS.find((x) => x.k === t.k);
      if (!c) continue;
      const key = 'tomb:' + t.k + ':' + t.id;
      if (lastPushed.get(key) === t.at) continue;
      batch.delete(root().collection(c.name).doc(t.id));
      lastPushed.set(key, t.at);
      if (++n >= batchLimit) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    if (n) await batch.commit();

    await root().collection('meta').doc('folders').set({
      list: Store.folders, at: Store.meta.foldersAt || new Date().toISOString(),
    });
    await root().collection('meta').doc('tombs').set({ list: Store.tombs });
    set('ok');
    syncAttachments().catch(() => { /* 다음 기회에 */ });
  }

  // 아직 안 올린 첨부를 몇 개씩 나눠 올린다. 한 번에 다 하면 앱이 먹통이 된다.
  let uploading = false;
  let attInfo = { pending: 0, skipped: 0 };

  async function syncAttachments() {
    if (!uid || attMode() === 'off' || uploading) return;
    const all = Store.allAttachments()
      // 원본 연결한 파일은 밖에서 고쳐질 수 있다. 그래서 크기·시각이 달라지면 다시 올린다.
      .filter((x) => !x.att.missing && (!x.att.cloud || x.att.cloudSig !== attSig(x.att)));

    // 너무 큰 것은 건너뛴다. 몇 개인지는 설정 화면에 그대로 적힌다 — 조용히 삼키지 않는다.
    const pending = all.filter((x) => !(x.att.size > MAX_FILE));
    attInfo = { pending: pending.length, skipped: all.length - pending.length };
    if (!pending.length) return;

    uploading = true;
    try {
      for (const x of pending.slice(0, 3)) {
        if (await uploadAttachment(x.att)) markCloud(x.att.id, attSig(x.att));
      }
    } finally {
      uploading = false;
    }
    if (pending.length > 3) setTimeout(() => syncAttachments().catch(() => {}), 900);
  }

  // 올린 그때의 크기·시각. 원본이 바뀌면 이 값이 달라져서 다시 올라간다.
  function attSig(att) {
    return String(att.size || 0) + ':' + String(Math.round(att.mtimeMs || 0));
  }

  function markCloud(id, sig) {
    if (Store.files.some((f) => f.id === id)) {
      Store.updateFile(id, { cloud: true, cloudSig: sig });
      return;
    }
    for (const ev of Store.events) {
      const a = (ev.attachments || []).find((x) => x.id === id);
      if (!a) continue;
      a.cloud = true;
      a.cloudSig = sig;
      Store.update(ev.id, { attachments: ev.attachments });
      return;
    }
  }

  // 이 PC에 파일이 없으면 클라우드에서 받아 온다. 열기 전에 부른다.
  async function ensureLocal(att) {
    if (!att) return false;
    if (!att.missing && (att.rel || att.abs)) return true;
    if (attMode() === 'off') {
      App.toast('이 파일은 다른 기기에 있습니다. (첨부 동기화가 꺼져 있습니다)');
      return false;
    }
    if (!uid || !att.cloud) return false;
    App.toast('클라우드에서 받는 중…');
    const ok = await downloadAttachment(att);
    if (ok) { await Store.reload(['events', 'files']); App.toast('받았습니다.'); }
    else App.toast('클라우드에도 없습니다.');
    return ok;
  }

  // Firestore 는 undefined 를 싫어한다. 그리고 이 기기에만 뜻이 있는 값은 빼고 올린다.
  function clean(obj) {
    const out = {};
    for (const k in obj) {
      const v = obj[k];
      if (v === undefined) continue;
      if (k === 'abs' || k === 'ino' || k === 'rel' || k === 'diskAt') continue;    // 이 PC 안의 경로·사정
      if (v && typeof v === 'object') out[k] = JSON.parse(JSON.stringify(v));
      else out[k] = v;
    }
    if (!out.updatedAt) out.updatedAt = new Date().toISOString();
    return out;
  }

  // ────────────────────────────── 첨부파일 ──────────────────────────────
  /* 파일 **내용**을 둘 데가 두 군데다. 바깥에서 보기엔 똑같다.

     'storage'   — Firebase Storage. 제대로 된 길이지만 카드 등록(Blaze)이 필요하다.
     'firestore' — 카드 없이 가는 길. 문서 하나가 1MB 까지라 파일을 조각내서 담는다.
                   base64 로 말지 않고 binary 그대로 넣어서 부풀지 않는다.
     'off'       — 올리지 않는다. 파일은 만든 컴퓨터에만 남는다.

     Firestore 쪽은 무료 몫 1GB 를 가입한 사람 전부가 나눠 쓴다. 그래서 뚜껑이 있다.
     Blaze 를 켜면 FIREBASE_STORAGE 를 true 로 바꾸는 것만으로 위쪽 길로 옮겨간다. */

  const PART = 700000;                    // 조각 하나 (문서 한도 1MB 안쪽으로 넉넉히)
  const MAX_FILE = 5 * 1024 * 1024;       // 한 개 5MB 까지
  const MAX_USER = 100 * 1024 * 1024;     // 한 사람 100MB 까지

  function attMode() {
    if (global.FIREBASE_STORAGE === true && storage) return 'storage';
    if (global.FIREBASE_BLOBS !== false && db) return 'firestore';
    return 'off';
  }

  function attPath(id) { return 'users/' + uid + '/att/' + id; }
  const blobDoc = (id) => root().collection('blobs').doc(id);
  const partDoc = (id, i) => blobDoc(id).collection('parts').doc(String(i));

  // ── 얼마나 썼나 ──
  // 규칙은 합계를 셀 수 없다. 그래서 앱이 적어 두고 스스로 지킨다.

  let usage = null;

  async function loadUsage() {
    if (usage !== null) return usage;
    try {
      const s = await root().collection('meta').doc('usage').get();
      usage = s.exists ? Number(s.data().bytes || 0) : 0;
    } catch (e) {
      usage = 0;
    }
    return usage;
  }

  async function addUsage(delta) {
    await loadUsage();
    usage = Math.max(0, usage + delta);
    try {
      await root().collection('meta').doc('usage')
        .set({ bytes: usage, at: new Date().toISOString() });
    } catch (e) { /* 다음 번에 */ }
  }

  // ── 넣고 · 꺼내고 · 지우고 ──

  async function putBytes(id, bytes, mime, name) {
    if (!uid) return false;
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length > MAX_FILE) return false;
    const mode = attMode();
    try {
      if (mode === 'storage') {
        await storage.ref(attPath(id)).put(u8, {
          contentType: mime || 'application/octet-stream',
          customMetadata: { name: name || '' },
        });
      } else if (mode === 'firestore') {
        if ((await loadUsage()) + u8.length > MAX_USER) return false;
        const n = Math.max(1, Math.ceil(u8.length / PART));
        // 조각을 먼저 다 넣고 맨 마지막에 머리글을 쓴다.
        // 중간에 끊기면 머리글이 없어서 "반쯤 올라간 파일" 로 보이지 않는다.
        for (let i = 0; i < n; i++) {
          const part = u8.subarray(i * PART, Math.min(u8.length, (i + 1) * PART));
          await partDoc(id, i).set({ i, b: firebase.firestore.Blob.fromUint8Array(part) });
        }
        await blobDoc(id).set({
          size: u8.length, chunks: n,
          mime: String(mime || 'application/octet-stream').slice(0, 200),
          name: String(name || '').slice(0, 400),
          updatedAt: new Date().toISOString(),
        });
        await addUsage(u8.length);
      } else {
        return false;
      }
      forgetUrl(id);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function getBytes(id) {
    if (!uid) return null;
    const mode = attMode();
    try {
      if (mode === 'storage') {
        const url = await attUrl(id);
        if (!url) return null;
        return new Uint8Array(await (await fetch(url)).arrayBuffer());
      }
      if (mode === 'firestore') {
        const head = await blobDoc(id).get();
        if (!head.exists) return null;
        const d = head.data();
        const out = new Uint8Array(Number(d.size) || 0);
        let at = 0;
        for (let i = 0; i < (Number(d.chunks) || 0); i++) {
          const part = await partDoc(id, i).get();
          if (!part.exists) return null;               // 조각이 빈다 — 온전하지 않다
          const piece = part.data().b.toUint8Array();
          out.set(piece, at);
          at += piece.length;
        }
        return at === out.length ? out : null;
      }
    } catch (e) { /* 못 받았다 */ }
    return null;
  }

  async function deleteBytes(id) {
    if (!uid) return false;
    const mode = attMode();
    try {
      if (mode === 'storage') {
        try { await storage.ref(attPath(id)).delete(); } catch (e) { /* 이미 없다 */ }
      } else if (mode === 'firestore') {
        const head = await blobDoc(id).get();
        const d = head.exists ? head.data() : null;
        for (let i = 0; i < ((d && Number(d.chunks)) || 0); i++) {
          try { await partDoc(id, i).delete(); } catch (e) { /* 이미 없다 */ }
        }
        try { await blobDoc(id).delete(); } catch (e) { /* 이미 없다 */ }
        if (d && d.size) await addUsage(-Number(d.size));
      }
    } catch (e) { /* 이미 없을 수 있다 */ }
    forgetUrl(id);
    return true;
  }

  // ── 이 기기와 클라우드 사이 ──

  /* 이 기기의 파일을 올린다. **원본 연결(linked)한 것도 올린다.**

     예전에는 안 올렸다 — 앱이 사본을 만들지 않기로 했으니까.
     그런데 그건 **이 컴퓨터 안에** 사본을 안 만든다는 뜻이었다.
     사용자가 "원본 연결해놔도 핸드폰에서 보이게" 라고 해서 규칙을 다시 그었다:
     디스크의 원본은 여전히 손대지 않고 그 자리에 그대로 두되,
     내용은 클라우드에도 둔다. 그래야 휴대폰에서 열린다. */
  async function uploadAttachment(att) {
    if (!uid || !att || attMode() === 'off') return false;
    if (!api.attach.read) return false;
    if (att.size > MAX_FILE) return false;
    const res = await api.attach.read(att.id);
    if (!res || !res.ok) return false;
    return putBytes(att.id, new Uint8Array(res.bytes), res.mime, att.name);
  }

  // 다른 기기가 올린 파일을 이 PC로 받아 온다.
  async function downloadAttachment(att) {
    if (!uid || !att || !api.attach.write) return false;
    const bytes = await getBytes(att.id);
    if (!bytes) return false;
    const saved = await api.attach.write(att.id, att.name, bytes);
    return !!(saved && saved.ok);
  }

  // ── 그림 주소 ──

  // 웹에서는 그림 주소가 당장 필요하다. 미리 받아 둔 것을 그 자리에서 돌려준다.
  function attUrlSync(id) {
    const hit = urlCache.get(id);
    if (hit !== undefined) return hit;
    urlCache.set(id, '');
    attUrl(id).then((u) => { if (u) redrawSoon(); });
    return '';
  }

  let redrawTimer = null;
  function redrawSoon() {
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(() => {
      if (global.Nav) Nav.softRefresh();
    }, 300);
  }

  async function attUrl(id) {
    if (!uid) return '';
    if (urlCache.has(id)) return urlCache.get(id);
    const mode = attMode();
    if (mode === 'off') { urlCache.set(id, ''); return ''; }
    urlCache.set(id, '');                       // 같은 것을 두 번 받지 않도록 먼저 자리를 잡는다
    try {
      let url = '';
      if (mode === 'storage') {
        url = await storage.ref(attPath(id)).getDownloadURL();
      } else {
        const head = await blobDoc(id).get();
        const bytes = await getBytes(id);
        if (bytes) {
          const mime = (head.exists && head.data().mime) || 'application/octet-stream';
          url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        }
      }
      urlCache.set(id, url || '');
      return url || '';
    } catch (e) {
      urlCache.set(id, '');
      return '';
    }
  }

  // blob: 주소는 스스로 놓아주지 않으면 메모리에 남는다.
  function forgetUrl(id) {
    const u = urlCache.get(id);
    if (typeof u === 'string' && u.slice(0, 5) === 'blob:') {
      try { URL.revokeObjectURL(u); } catch (e) { /* 이미 놓았다 */ }
    }
    urlCache.delete(id);
  }

  global.Cloud = Cloud;
})(window);
