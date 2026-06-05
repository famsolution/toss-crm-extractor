// 🔐 확장 전용 Firebase 초기화 — 앱과 같은 프로젝트(ympaint-86457) 재사용, 컬렉션만 'extUsers' 로 분리.
//   (MV3 는 원격 스크립트 금지 → vendor/ 의 로컬 compat SDK 를 popup.html 에서 먼저 로드한다)
var firebaseConfig = {
  apiKey: "AIzaSyDdXNSnNwsAX_kCzbbfOa8p0iYRDpQR2VU",
  authDomain: "ympaint-86457.firebaseapp.com",
  projectId: "ympaint-86457",
  storageBucket: "ympaint-86457.firebasestorage.app",
  messagingSenderId: "525716645386",
  appId: "1:525716645386:web:6e0f97808dbbc86af3a1f3"
};
try {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  // 로그인 상태를 IndexedDB 에 영속화 → popup 을 닫았다 열어도 유지
  firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function(){});
  window._fbAuth = firebase.auth();
  window._fbDb = firebase.firestore();
  // MV3 환경에서 Firestore 연결 안정화 (long-polling 자동감지)
  try { window._fbDb.settings({ experimentalAutoDetectLongPolling: true, merge: true }); } catch (e) {}
} catch (e) {
  console.error('[Ext Firebase] 초기화 실패', e);
}
