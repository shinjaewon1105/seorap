'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch, arg) => ipcRenderer.invoke(ch, arg);

contextBridge.exposeInMainWorld('api', {
  events: {
    load: () => invoke('events:load'),
    save: (events) => invoke('events:save', events),
  },
  // 마감과 별개인 필기
  notes: {
    load: () => invoke('notes:load'),
    save: (notes) => invoke('notes:save', notes),
  },
  // 저장해 둔 링크
  links: {
    load: () => invoke('links:load'),
    save: (links) => invoke('links:save', links),
    title: (url) => invoke('links:title', url),
  },
  // 어느 마감에도 매이지 않은 파일 (파일 화면에서 바로 가져온 것)
  files: {
    load: () => invoke('files:load'),
    save: (files) => invoke('files:save', files),
  },
  // 기기끼리 맞추는 데만 쓰는 부스러기
  sync: {
    load: () => invoke('sync:load'),
    save: (v) => invoke('sync:save', v),
  },
  // 첨부 폴더는 앱 전체가 함께 쓰는 목록이다 (일정마다가 아니다).
  folders: {
    load: () => invoke('folders:load'),
    save: (folders) => invoke('folders:save', folders),
  },
  settings: {
    load: () => invoke('settings:load'),
    save: (next) => invoke('settings:save', next),
  },
  ollama: {
    status: () => invoke('ollama:status'),
    parse: (text, model) => invoke('ollama:parse', { text, model }),
    warm: (model) => invoke('ollama:warm', model),
    // 정리 결과는 'format:chunk' 로 조각조각 들어오고, 이 호출은 다 끝나면 끝난다.
    format: (id, text, model, prev, missing) =>
      invoke('ollama:format', { id, text, model, prev, missing }),
    formatStop: () => invoke('ollama:formatStop'),
  },
  // 학교 클래스룸 → 마감. 웹 앱 주소와 비밀값은 메인에만 있다.
  classroom: {
    status: () => invoke('classroom:status'),
    fetch: () => invoke('classroom:fetch'),
    extract: (text, base, model) => invoke('classroom:extract', { text, base, model }),
  },
  attach: {
    // 컴퓨터의 파일은 언제나 원본 자리에 연결한다(사본을 만들지 않는다).
    add: (eventId, paths) => invoke('attach:add', { eventId, paths }),
    // 고르기 창 + 연결을 한 번에. 웹 버전은 <input type=file> 로 올린다.
    pick: (eventId) => invoke('attach:pick', { eventId }),
    addBuffer: (eventId, name, buffer) => invoke('attach:addBuffer', { eventId, name, buffer }),
    open: (id) => invoke('attach:open', id),
    reveal: (id) => invoke('attach:reveal', id),
    remove: (id) => invoke('attach:remove', id),
    duplicate: (id) => invoke('attach:duplicate', id),
    read: (id) => invoke('attach:read', id),
    write: (id, name, bytes) => invoke('attach:write', { id, name, bytes }),
    verify: () => invoke('attach:verify'),
    // 앱 안에서만 쓰는 폴더로 나눠 달라고 모델에게 물어본다 (디스크는 그대로).
    organize: (files, context, model, wish) =>
      invoke('attach:organize', { files, context, model, wish }),
    // 드롭된 File 객체에서 실제 디스크 경로를 얻는다 (Electron 32의 공식 경로).
    pathOf: (file) => {
      try { return webUtils.getPathForFile(file); } catch (e) { return ''; }
    },
  },
  dialog: {
    pickFiles: () => invoke('dialog:pickFiles'),
    pickFolder: () => invoke('dialog:pickFolder'),
  },
  shell: {
    openData: () => invoke('shell:openData'),
    openExternal: (url) => invoke('shell:openExternal', url),
  },
  app: {
    info: () => invoke('app:info'),
    quit: () => invoke('app:quit'),
  },
  // 클라우드가 막힌 자리를 data/기록.txt 에 남긴다
  log: (line) => invoke('log:add', line),

  on: (channel, fn) => {
    const allowed = ['attachments:changed', 'open:event', 'format:chunk', 'data:changed'];
    if (!allowed.includes(channel)) return () => {};
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
