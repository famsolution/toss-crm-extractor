# 토스인슈 CRM 추출기 (크롬 확장)

토스인슈 CRM 데이터 추출 + 보험료비교 폼 자동입력. **로그인 + 관리자 승인** 권한 게이트가
들어 있습니다.

- 저장소: `https://github.com/famsolution/toss-crm-extractor.git` (branch `main`)
- 상세: `README.md`

## 구조 (MV3, 빌드 단계 없음)

| 파일 | 역할 |
| --- | --- |
| `manifest.json` | MV3 매니페스트 |
| `background.js` | 서비스 워커 |
| `content/*.js` | CRM 페이지 주입 — 데이터 추출 (10개 모듈) |
| `insurer-fill.js` | 보험사 보험료비교 폼 자동입력 |
| `pcs-clip-intercept.js` | 클립보드 인터셉트 |
| `ext-auth-gate.js` | **권한 게이트** — 승인 전 기능 차단 |
| `firebase-init.js` | Firebase 인증 초기화 |
| `popup.html` / `popup.css` / `popup/*.js` | 팝업 UI (회원가입·로그인, 8개 모듈) |
| `tools/verify.js` | 정합성 검사 (문법·참조·주입목록·금지 API) |
| `vendor/` | 외부 라이브러리 |
| `.github/` | zip 릴리스 자동 빌드 워크플로 |

주입되는 `content/*.js` 목록은 **두 곳**에 있고 서로 같아야 합니다 —
`manifest.json` 의 `content_scripts` 와 `popup/boot.js` 의 `CONTENT_SCRIPT_FILES`.
`node tools/verify.js` 가 이 일치를 검사합니다.

## 변경 후에는 `node tools/verify.js`

테스트가 없는 프로젝트입니다. 대신 이 스크립트가 문법, `manifest`/`popup.html` 의 파일
참조, 주입 목록 일치, 금지 API(`alert`/`confirm`) 잔존을 검사합니다. 릴리스 워크플로도
zip 을 만들기 전에 이걸 실행하므로, 실패하면 배포가 멈춥니다.

## 권한 게이트는 제품 요구사항입니다

이메일/비밀번호 가입 → 자동으로 **승인 대기** 상태 → 관리자가 승인 토글을 켜야 활성화.
승인 전에는 추출·자동입력이 차단됩니다. `ext-auth-gate.js`의 이 검사를 우회하거나
비활성화하는 변경은 하지 마세요.

## 배포

`.github` 워크플로가 releases/latest의 `toss-crm-extractor.zip`을 자동 갱신합니다.
사용자는 그 zip을 받아 `chrome://extensions`에서 압축해제 로드합니다.
버전을 올릴 때 `manifest.json`의 `version`을 함께 올리세요.

## 주의

- 고객 개인정보를 다루는 확장입니다. 추출 데이터를 로그로 남기거나 외부로 전송하는 코드를
  추가하지 마세요.
- 확장 코드에서 `alert`/`confirm`을 쓰지 마세요. 대신 팝업에서는 `popup/dialog.js` 의
  `showAlert` / `showConfirm`, content script 에서는 `content/paint-pro.js` 의
  `pageAlert` / `pageConfirm` 을 씁니다. 둘 다 Promise 를 돌려줍니다.
- MV3 서비스 워커는 유휴 시 종료됩니다. 상태는 `chrome.storage`에 두세요.
