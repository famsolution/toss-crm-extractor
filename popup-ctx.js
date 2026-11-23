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
  // 📐 폭에 맞춰 글씨·버튼 크기 자동 조절 — 폭이 실재하는 그릇(오른쪽 세로바·크게 보기·고객관리 창)에서만.
  //   팝업은 크롬이 800px 로 고정하고, 뷰포트 기준 계산이 팝업 폭을 좁게 굳히는 버그가 있었으므로
  //   팝업에서는 절대 돌리지 않는다(아래 is-sidepanel 이 붙은 경우에만 동작).
  //   · 전체를 zoom 으로 비례 축소/확대: 360px → 0.85배 · 800px → 1배 · 1600px 이상 → 1.2배
  //   · 줄어든 뒤의 실제 폭이 좁으면(640 미만) w-narrow — 버튼을 한 줄에 하나씩, 칸을 1단으로
  var fitting = false;
  var fit = function () {
    if (!root.classList.contains('is-sidepanel')) return;
    var w = window.innerWidth || root.clientWidth || 0;
    if (!w) return;
    var s;
    if (w <= 360) s = 0.85;
    else if (w < 800) s = 0.85 + (w - 360) / (800 - 360) * 0.15;
    else s = Math.min(1.2, 1 + (w - 800) / (1600 - 800) * 0.2);
    s = Math.round(s * 100) / 100;
    if (root.style.zoom !== String(s)) root.style.zoom = String(s);
    var eff = w / s;
    root.classList.toggle('w-narrow', eff < 640);
    root.classList.toggle('w-mid', eff >= 640 && eff < 1000);
    root.classList.toggle('w-wide', eff >= 1000);
  };
  var startFit = function () {
    if (fitting) return; fitting = true;
    fit();
    var t = null;
    window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(fit, 60); });
  };
  var mark = function () { root.classList.add('is-sidepanel'); startFit(); };

  // ⛶ 크게 보기 창(popup.html?full=1) — 실제 창 폭이 있으므로 사이드패널처럼 100% 폭 + 큰 화면 배치
  // 🪟 고객관리 팝업 창(popup.html?full=1&tab=cust&solo=1) — 고객 탭만 단독으로
  if (/[?&]solo=1\b/.test(location.search)) root.classList.add('is-solo');
  if (/[?&]full=1\b/.test(location.search)) { mark(); root.classList.add('is-full'); return; }
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
