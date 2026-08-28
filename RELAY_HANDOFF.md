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
3. ⬜ 거대 함수 분해: `content/premium-apply.js applyToPremiumFormUnified`(~840줄),
      `popup/apply.js` btnApply 핸들러(~1,389줄)
4. ⬜ popup.html 인라인 CSS(9~508줄) → `popup.css` 추출
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

# 바로 다음에 할 일
계획 3번 — 거대 함수 분해. `popup/apply.js` 의 btnApply 핸들러(1,389줄)가 가장 크다.
전송 대상(auto/consult/standard/plan/premium-page)별 분기를 함수로 뽑아내는 방향.

# 검증 방법 (테스트가 없으므로)
- **`node tools/verify.js`** — 매 변경 후 반드시 실행 (문법 + 참조 정합성 + 주입목록 일치)
- 순차 분할일 때는 이어붙인 결과가 원본과 동일한지 node 로 비교
- 실제 브라우저 검증은 불가 — **동작 보존이 증명 가능한 변형만** 한다

# 이어가는 법
이 문서를 읽고 '바로 다음에 할 일' 부터 진행. 매 단계마다 커밋하고 이 문서를 갱신한다.
