# 테스트베드 — 격리 샌드박스에서 확장 돌리기

브라우저 테스트가 **실제 토스 CRM·보험사 사이트·운영 Firebase 에 닿지 못하도록** 묶어 놓고
확장을 실제로 실행해 본다. 테스트가 없는 프로젝트라 `tools/verify.js` 와 함께 쓴다.
(이 폴더는 릴리스 zip 에 들어가지 않는다 — 워크플로가 `tools/*` 를 제외한다.)

## 구성

| 파일 | 역할 |
| --- | --- |
| `build.js` | git 추적 파일만 모아 **확장 사본**을 만들고 manifest 를 로컬 전용으로 좁힌다 |
| `server.js` | Host 헤더로 가짜 사이트를 구분해 응답하는 픽스처 서버 (127.0.0.1:8899) |
| `fixtures/crm.html` | 가짜 토스 보장분석 페이지 (상단 가입보험 표 + 카테고리별 보장 표) |
| `fixtures/crm-empty.html` | 데이터 없는 페이지 — 실패 경로(pageAlert) 확인용 |
| `fixtures/mmlfcp.html` | 가짜 보험료비교 폼. **생손보 전환 시 상품유형을 비동기로 리셋하는 실제 버그 상황까지 재현** |

## 실행

```bash
node tools/testbed/build.js            # 사본 생성 + 확장 ID 출력
node tools/testbed/server.js &         # 픽스처 서버

agent-browser --session tosstest --headed \
  --extension "<build.js 가 출력한 경로>" \
  --args "--host-resolver-rules=MAP * 127.0.0.1,--no-first-run,--disable-background-networking" \
  open "http://crm.tossinsu.com:8899/cover/12345"
```

`MAP * 127.0.0.1` 이 **모든 호스트를 픽스처 서버로** 돌린다. 외부로 나가는 요청이 하나도 없고,
그래서 Firebase 인증도 실패한다 — 운영 데이터에 쓰기가 일어날 수 없다.
`crm.tossinsu.com` / `mmlfcp.ohmymanager.com` 로 접속해야 content script 가 주입된다
(match pattern 은 포트를 따지지 않으므로 `:8899` 를 붙여도 매칭된다).

## 확인할 수 있는 것

- 팝업 모달 — `showAlert` / `showConfirm` / `showPrompt` (확인·취소·Esc·Enter·백드롭·재진입)
- content 모달 — `pageAlert` / `pageConfirm` (🩺 실손 세대 분석 버튼이 실제 경로)
- 자동입력 — `applyToPremiumForm` 메시지로 생손보/상품/만기 코드 보정, 담보 체크·금액 입력

## 권한 게이트는 건드리지 않는다

`ext-auth-gate.js` 는 제품 요구사항이다 (CLAUDE.md). 사본에서도 그대로 둔다.
자동입력 경로만 테스트할 때는 **사본 프로필 안에서만** 확장 페이지 콘솔로

```js
chrome.storage.local.set({ extAuthOK: true })
```

를 세운다. 코드를 고쳐 우회하지 말 것. 이 프로필은 샌드박스 전용이고 외부와 끊겨 있다.
