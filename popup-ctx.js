// ─────────────────────────────────────────────────────────────
// popup-ctx.js — 이 문서가 "팝업"인지 "사이드패널"인지 표시한다.
//
//   popup.html 한 파일을 action.default_popup 과 side_panel.default_path 가
//   같이 쓴다. 그런데 두 그릇의 폭 규칙이 정반대다.
//
//     · 팝업      : 문서의 고유 폭이 팝업 크기를 정한다 → 고정 폭이어야 한다.
//                   폭을 뷰포트에 맞추면(100vw / max-width:100% / @media max-width)
//                   "좁은 첫 레이아웃 → 더 좁은 문서 → 더 좁은 팝업" 순환에 빠진다.
//     · 사이드패널 : 그릇 폭이 실재하고 사용자가 늘렸다 줄인다 → 100% 여야 한다.
//
//   그래서 CSS 기본값은 팝업(고정 800px)으로 두고, 사이드패널일 때만
//   <html> 에 .is-sidepanel 을 붙여 폭 규칙을 뒤집는다.
//
//   판별은 manifest 의 side_panel.default_path 에 붙인 ?sp=1 로 한다.
//   URL 은 스크립트 실행 즉시 읽히므로 첫 레이아웃 전에 확정된다.
//   (MV3 CSP 상 인라인 스크립트를 못 쓰므로 이 별도 파일이 <head> 에서 동기 로드된다.)
// ─────────────────────────────────────────────────────────────
'use strict';

(function () {
  var root = document.documentElement;
  var mark = function () { root.classList.add('is-sidepanel'); };

  if (/[?&]sp=1\b/.test(location.search)) { mark(); return; }

  // 안전망 — ?sp=1 이 유실된 경우(구버전 설정 잔존 등)에도 사이드패널이면 잡는다.
  // 비동기라 한 프레임 늦게 반영되지만, 사이드패널은 늦은 리플로우가 무해하다.
  try {
    chrome.runtime.getContexts({ documentUrls: [location.href] }, function (ctxs) {
      if (chrome.runtime.lastError) return;
      if (ctxs && ctxs.some(function (c) { return c.contextType === 'SIDE_PANEL'; })) mark();
    });
  } catch (_) {}
})();
