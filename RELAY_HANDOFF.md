RELAY-STATUS: CONTINUE

# 목표
리팩터링 끝까지 해줘

# 대상 (첫 세션에서 파악한 현황)
빌드 단계 없는 MV3 확장. 커다란 단일 파일 두 개가 핵심 문제였다.
- `popup.js` 3,521줄 (분리 완료)
- `content.js` 3,231줄 (아직)
- `popup.html` 743줄 (CSS 500줄 인라인)
- CLAUDE.md 금지사항 위반: `alert`/`confirm` — popup 46곳, content 8곳

# 계획 (순서)
1. ✅ popup.js → `popup/*.js` 7개 모듈 분리
2. ✅ content.js → `content/*.js` 10개 모듈 분리 + `tools/verify.js`
3. ✅ 거대 함수 분해 — 남은 최대 함수는 `applyToPremiumFormUnified` 333줄
4. ✅ popup.html 인라인 CSS(9~508줄) → `popup.css` 추출 (커밋 74b92f6)
5. ⬜ `alert`/`confirm` 제거 → showToast/showNotice + 커스텀 확인 다이얼로그 (총 54곳)
6. ⬜ manifest version 올리고 마무리

# 지금까지 한 것
- **커밋 `be231f8`** — popup.js 를 7개로 순차 분할 (products/config/boot/xlsx/actions/apply/render).
  이어붙이면 원본과 **바이트 단위 동일**함을 node 로 확인. popup.html `<script>` 7줄로 교체.
- **커밋 `0d6c458`** — content.js 를 10개로 분할
  (boot/util/privacy/customer/insurance/coverage-excel/premium/premium-apply/messages/paint-pro).
  본문은 바이트 동일. 감싸던 `if(로드됨){}else{...}` 가드만 없앴다 —
  블록 스코프 const/let 이 파일 간에 공유되지 않기 때문. 대신 부작용만 개별로 막는다
  (`__tossCrmExtractorMsgBound`, `__tossCrmPaintProBound`).
  주입 목록은 `popup/boot.js` 의 `CONTENT_SCRIPT_FILES` + `injectContentScripts()` 로 일원화.
  `tools/verify.js` 추가 + 릴리스 워크플로가 zip 전에 실행.

- **커밋 `74b92f6`** — popup.html 인라인 CSS 498줄 → `popup.css` (743줄 → 251줄).
- **커밋 (helper hoist)** — btnApply 클로저 헬퍼 7개를 apply.js 모듈 스코프로 승격.
- **커밋 (auto/guard)** — `resolveAutoTarget()` / `applyCompatGuard()` + `COMPAT_MATRIX` 분리.
- **커밋 `0cac7a1`** — apply.js 도달 불가 코드 404줄 삭제 (1,406 → 1,003줄).
  코드에 '실행되지 않음'이라고 적혀 있던 구 executeScript 경로.

- **커밋 `a1a26f8`** — btnApply 라우트 5개를 `routeConsult`/`routeStandard`/`routePlan`/
  `routePremiumPage`/`routePremiumCompareToPlan` 함수로 분해. 공유 변수는 `ctx` 객체로 전달.
  `routePremiumPage` 만 boolean 반환(원래 fall-through 하던 블록이라).
  핸들러 본문 길이: ~1,389줄 → ~120줄. 남은 것은 `content/premium-apply.js` 쪽.

# 바로 다음에 할 일
계획 5번 — `alert`/`confirm` 제거. CLAUDE.md 가 명시적으로 금지한 항목이다.
`node tools/verify.js` 가 파일별 개수를 그대로 찍어준다 (현재 총 50곳):
  content/paint-pro.js 8 · popup/actions.js 2 · popup/apply.js 28 ·
  popup/boot.js 4 · popup/config.js 1 · popup/products.js 4 · popup/xlsx.js 3
주의:
  · popup 쪽에는 이미 `showToast` 가 있다 (popup/render.js 확인). 안내성 alert 은 그걸로.
  · `confirm()` 은 반환값을 쓰므로 단순 치환 불가 — Promise 를 돌려주는
    커스텀 다이얼로그(showConfirm)를 popup.html/popup.css 에 하나 만들고
    호출부를 `await showConfirm(...)` 로 바꿔야 한다. 호출 함수가 async 인지 먼저 확인.
  · `content/paint-pro.js` 는 popup 의 showToast 를 못 쓴다 — 페이지에 직접
    띄우는 별도 토스트가 필요하다 (premium-apply.js 의 statusBox 방식 참고).
그 다음 계획 6번 — `manifest.json` version 올리기.

# 검증 방법 (테스트가 없으므로)
- **`node tools/verify.js`** — 매 변경 후 반드시 실행 (문법 + 참조 정합성 + 주입목록 일치)
- 순차 분할일 때는 이어붙인 결과가 원본과 동일한지 node 로 비교
- 실제 브라우저 검증은 불가 — **동작 보존이 증명 가능한 변형만** 한다

# 이어가는 법
이 문서를 읽고 '바로 다음에 할 일' 부터 진행. 매 단계마다 커밋하고 이 문서를 갱신한다.
