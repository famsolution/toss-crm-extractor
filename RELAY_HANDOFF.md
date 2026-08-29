RELAY-STATUS: DONE

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
5. ✅ `alert`/`confirm` 제거 → showToast/showNotice + 커스텀 확인 다이얼로그 (총 54곳)
6. ✅ manifest version 올리고 마무리

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

- **커밋 `89ea5f5`** — `popup/dialog.js` 추가. `showAlert(msg,title)` /
  `showConfirm(msg,title)` — Promise 기반 모달. popup.html 에 마크업 +
  스크립트(다른 popup 모듈보다 먼저), popup.css 에 `.modal-*` 스타일.
- **커밋 (popup 교체)** — actions/boot/config/products/xlsx 10곳 + apply.js 28곳.
  `applyCompatGuard` 는 confirm 반환값을 쓰므로 async 로 승격, 호출부에 await.
  products.js 의 학습 초기화 핸들러도 async 로.
- **커밋 (paint-pro)** — content script 는 popup 의 showAlert 을 못 쓴다.
  Shadow DOM 안에 그리는 `pageAlert` / `pageConfirm` 을 `content/paint-pro.js`
  IIFE 안에 추가하고 8곳을 옮겼다.
  `tools/verify.js` 의 alert/confirm 검사를 **경고 → 오류**로 승격 —
  이제 남아 있으면 릴리스 빌드가 실패한다. **현재 0곳.**

- **커밋 `c39409b`** — `manifest.json` 3.22.6 → **3.23.0**.
  `CLAUDE.md` 구조표 갱신(`content.js`/`popup.js` 는 이제 없다),
  주입 목록이 manifest 와 `popup/boot.js` 두 곳에 있다는 점,
  변경 후 `node tools/verify.js` 를 돌려야 한다는 점을 명시.
- **커밋 `f3098ca`** — `prompt()` 2곳도 제거. `showPrompt(msg, title, value)`
  → `Promise<string|null>`. 템플릿 이름 입력(boot.js) / mmlfcp URL 입력(apply.js).
  DOM 이 없을 때의 폴백을 '취소'로 — 동의 없이 진행하지 않는다.
  verify 의 금지 API 검사에 `prompt` 추가.

# 결과

목표(리팩터링)가 계획 1~6 전부 끝났다.

| 항목 | 전 | 후 |
| --- | --- | --- |
| `popup.js` | 3,521줄 단일 | `popup/*.js` 8개 (최대 1,027줄) |
| `content.js` | 3,231줄 단일 | `content/*.js` 10개 (최대 879줄) |
| `popup.html` | 743줄 (CSS 498줄 인라인) | 253줄 + `popup.css` |
| 비대화 다이얼로그 | `alert`/`confirm`/`prompt` 56곳 | **0곳** (verify 가 오류로 잡음) |
| 검증 | 없음 | `tools/verify.js` + 릴리스 워크플로에서 실행 |
| 버전 | 3.22.6 | 3.23.0 |

남은 개선 여지(필수 아님, 다음 사람을 위한 메모):
- `popup/apply.js` 1,027줄 · `content/premium-apply.js` 879줄 — 더 쪼개질 수 있다.
- `pageAlert`/`pageConfirm` 은 `content/paint-pro.js` IIFE 안에만 있다.
  다른 content 모듈에서도 필요해지면 `content/dialog.js` 로 띄우고
  manifest 와 `CONTENT_SCRIPT_FILES` 에 둘 다 등록해야 한다.
- 브라우저 실젝 검증은 이 세션에서 불가능했다. 모달/입력창은 새 UI 이므로
  확장을 한 번 로드해 동작을 눈으로 확인하는 것을 권한다.

# 검증 방법 (테스트가 없으므로)
- **`node tools/verify.js`** — 매 변경 후 반드시 실행 (문법 + 참조 정합성 + 주입목록 일치)
- 순차 분할일 때는 이어붙인 결과가 원본과 동일한지 node 로 비교
- 실제 브라우저 검증은 불가 — **동작 보존이 증명 가능한 변형만** 한다

# 이어가는 법
이 문서를 읽고 '바로 다음에 할 일' 부터 진행. 매 단계마다 커밋하고 이 문서를 갱신한다.
