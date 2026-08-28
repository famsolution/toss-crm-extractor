// content/boot.js — 토스인슈 CRM 추출 콘텐츠 스크립트의 첫 파일.
//
// content 스크립트는 여러 파일로 나뉘어 있지만 모두 같은 isolated world 의
// 전역 스코프를 공유하므로, 한 파일의 함수/상수를 다른 파일에서 그냥 쓸 수 있다.
// 대신 로드 순서가 곧 의존 순서다 — 파일을 추가·삭제할 때 아래 두 곳을 함께 고쳐야 한다.
//   · manifest.json  content_scripts[0].js
//   · popup/boot.js  ensureContentScript() 의 executeScript files
//
// 중복 주입 표시. 부작용(메시지 리스너 등록·타이머)은 각 파일이 개별로 막는다.
const __EXT_VERSION = '3.7.9';
if (window.__tossCrmExtractorLoaded && window.__tossCrmExtractorVersion !== __EXT_VERSION) {
  console.log(`[Toss Extractor] 버전 업그레이드 v${window.__tossCrmExtractorVersion || '?'} → v${__EXT_VERSION}`);
}
window.__tossCrmExtractorLoaded = true;
window.__tossCrmExtractorVersion = __EXT_VERSION;
console.log(`[Toss Extractor] ✨ v${__EXT_VERSION} 로드됨`);
