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
| `content.js` | CRM 페이지 주입 — 데이터 추출 |
| `insurer-fill.js` | 보험사 보험료비교 폼 자동입력 |
| `pcs-clip-intercept.js` | 클립보드 인터셉트 |
| `ext-auth-gate.js` | **권한 게이트** — 승인 전 기능 차단 |
| `firebase-init.js` | Firebase 인증 초기화 |
| `popup.html` / `popup.js` | 팝업 UI (회원가입·로그인) |
| `vendor/` | 외부 라이브러리 |
| `.github/` | zip 릴리스 자동 빌드 워크플로 |

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
- 확장 코드에서 `alert`/`confirm`을 쓰지 마세요.
- MV3 서비스 워커는 유휴 시 종료됩니다. 상태는 `chrome.storage`에 두세요.
