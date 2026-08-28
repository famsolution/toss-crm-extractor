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
2. ⬜ content.js → `content/*.js` 분리 (manifest content_scripts js 배열 + popup/boot.js 의 executeScript files 배열 동시 수정 필요!)
3. ⬜ 거대 함수 분해: `content.js applyToPremiumFormUnified`(~840줄), `popup/apply.js btnApply 핸들러`(~1,389줄)
4. ⬜ popup.html 인라인 CSS → `popup.css` 추출
5. ⬜ `alert`/`confirm` 제거 → showToast/showNotice + 커스텀 확인 다이얼로그
6. ⬜ manifest version 올리고 마무리

# 지금까지 한 것
- **커밋 `be231f8`** — popup.js 를 7개로 순차 분할.
  분할 검증 방식: 줄 순서를 그대로 둔 순차 분할이라 `cat` 이어붙이면 원본과
  **바이트 단위 동일**함을 node 로 확인함. popup.html 의 `<script>` 를 7줄로 교체.
  파일: products / config / boot / xlsx / actions / apply / render.

# 바로 다음에 할 일
계획 2번 — content.js 분리.
주의: content.js 는 전체가 `if (already loaded) {} else { ... }` 가드 블록 안에 있고
(1~8줄, 3231줄 닫힘), 마지막에 IIFE(2720~3229) 가 있다. 파일을 나눌 때
manifest.json `content_scripts[0].js` 와 `popup/boot.js` 의
`chrome.scripting.executeScript({files:['content.js']})` 를 **둘 다** 갱신해야 한다.

# 검증 방법 (테스트가 없으므로)
- `node --check <파일>` 로 문법 검사
- 순차 분할일 때는 이어붙인 결과가 원본과 동일한지 node 로 비교
- 실제 브라우저 검증은 불가 — 분할/추출은 **동작 보존이 증명 가능한 변형만** 한다

# 이어가는 법
이 문서를 읽고 '바로 다음에 할 일' 부터 진행. 매 단계마다 커밋하고 이 문서를 갱신한다.
