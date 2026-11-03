/* ══════════════════════════════════════════════════════════════════
   Firebase 설정 — 여기가 비어 있으면 클라우드 기능은 통째로 꺼진다.
   앱은 예전처럼 이 PC 안에서만 돌아간다.

   여기 들어가는 값은 브라우저에 그대로 실리는 공개 값입니다.
   진짜 보호는 firestore.rules 의 "로그인한 자기 것만" 이 합니다.
   진짜 비밀(비밀번호·서비스 계정 키)은 여기 적지 마세요.
   ══════════════════════════════════════════════════════════════════ */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyA2p2nMumIEaV09POtYThWBMRHOd_uZJBs",
  authDomain: "seorap-80fc9.firebaseapp.com",
  projectId: "seorap-80fc9",
  storageBucket: "seorap-80fc9.firebasestorage.app",
  messagingSenderId: "440697483945",
  appId: "1:440697483945:web:2c126d6298434720d42fb8",
};

/* 첨부파일의 **내용**을 어디에 둘지. 위쪽이 켜져 있으면 위쪽이 이긴다.

   [1] Firebase Storage — 제대로 된 길. 카드 등록(Blaze)이 필요하다.
       켜려면: 콘솔에서 빌드 → Storage → 시작하기 → 아래를 true 로 →
              firebase.json 에 "storage": { "rules": "storage.rules" } 를 되돌리고
              npm run web && npx firebase deploy
       그러면 그동안 쌓인 첨부가 알아서 옮겨 올라간다. */
window.FIREBASE_STORAGE = false;

/* [2] Firestore 에 조각내서 — 카드 없이 가는 길. 지금 쓰는 쪽이다.
       문서 하나가 1MB 까지라 파일을 700KB 씩 잘라 담는다.
       한 개 5MB, 한 사람 100MB 까지. 무료 몫 1GB 를 가입한 사람 전부가 나눠 쓴다.

   둘 다 false 면 첨부파일은 만든 컴퓨터에만 남는다.
   그래도 **이름과 자리(어느 폴더, 어느 마감)는 언제나 맞춰진다.** */
window.FIREBASE_BLOBS = true;
