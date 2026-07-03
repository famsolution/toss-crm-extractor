// ──────────────────────────────────────────────────────────────────────────
// pcs-steps.js — 좌표 모드 "단계 정의" (편집 가능한 단일 소스)
//
//   매크로 동작을 코드가 아니라 이 데이터로 관리한다. 이 Flutter 빌드는 키보드
//   포커스 이동(Tab)·활성화(Space)·목록이동(ArrowDown)이 동작하므로, 대부분을
//   키보드로 진행하고 포커스를 잡아야 하는 칸만 좌표로 클릭한다.
//
//   action 종류:
//     navigate        : { url }                 해당 URL 로 이동 후 Flutter 로딩 대기
//     focus           :                          Flutter 화면에 키보드 포커스(안전한 모서리 클릭)
//     click           : { id }                   가르친 좌표 클릭(포커스 이동용)
//     type            : { value }                현재 포커스 칸에 값 입력
//     typeIfPresent   : { value }                값이 있을 때만 입력(예: 증권번호)
//     key             : { key, times }           Tab/Space/Enter/ArrowDown 을 times 번
//     keyByCategory   : { key, map }             카테고리(장기/일반/자동차)에 따라 Tab 횟수
//     notify          : { title, message }       데스크톱 알림 + 진행 정지(마지막)
//
//   value 토큰: customer.고객명 / customer.연락처 / customer.생년월일 /
//              policyNo(증권번호) / companyTerm(보험사 검색어) / productTerm(상품 검색어)
//              그 외 문자열은 "그대로 입력".
//
//   ※ 실제 토스 send 플로우(사용자 확인):
//     1) /send 이동 → Tab×6 → Space (→기본정보)
//     2) 고객명칸 좌표클릭→고객명, Tab×2→연락처, Tab×2→증권번호(있으면), Tab×2→생일,
//        Tab×2→Space (→상품비교)
//     3) 카테고리(장기 Tab×2/일반 Tab×4/자동차 Tab×6)→Space,
//        보험사칸 좌표클릭→보험사명→↓·Tab·Space(첫 결과),
//        상품칸 좌표클릭→상품명→↓·Tab·Space(첫 결과), Tab×2→Space (→다음)
//     4) Tab×1→Space  5) Tab×1→Space  6) 정지 + 서명 알림
// ──────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  const SEND_URL = 'https://crm.tossinsu.com/crm-v2/center/pcs-documents/send';

  const DEFAULT_STEPS = [
    // 1) 이동 → 종류선택 통과
    { action: 'navigate', url: SEND_URL, label: 'send 화면으로 이동', waitAfter: 800 },
    { action: 'focus', label: 'Flutter 화면 포커스', waitAfter: 300 },
    { action: 'key', key: 'Tab', times: 5, label: 'Tab ×5', waitAfter: 150 },
    { action: 'key', key: 'Space', times: 1, label: 'Space (→기본정보)', waitAfter: 1300 },

    // 2) 기본정보 — Space 로 진입 시 고객명칸이 자동 포커스됨(좌표 클릭 불필요)
    { action: 'type', value: 'customer.고객명', label: '고객명 입력', waitAfter: 250 },
    { action: 'key', key: 'Tab', times: 2, label: 'Tab ×2 (→연락처)', waitAfter: 200 },
    { action: 'type', value: 'customer.연락처', label: '연락처 입력', waitAfter: 250 },
    { action: 'key', key: 'Tab', times: 2, label: 'Tab ×2 (→증권번호)', waitAfter: 200 },
    { action: 'typeIfPresent', value: 'policyNo', label: '증권번호 입력 (있으면)', waitAfter: 250 },
    { action: 'key', key: 'Tab', times: 2, label: 'Tab ×2 (→생일)', waitAfter: 200 },
    { action: 'type', value: 'customer.생년월일', label: '생일 입력', waitAfter: 250 },
    { action: 'key', key: 'Tab', times: 2, label: 'Tab ×2', waitAfter: 150 },
    { action: 'key', key: 'Space', times: 1, label: 'Space (→상품비교)', waitAfter: 1300 },

    // 3) 상품비교 — 장기 전용. 장기 선택(Tab×2 → Space) 후 입력 영역으로 Tab×6,
    //    보험사·상품은 좌표로 클릭해 입력. (종류를 먼저 선택해야 입력칸 활성화)
    { action: 'key', key: 'Tab', times: 2, label: '카테고리 [장기] Tab×2', waitAfter: 200 },
    { action: 'key', key: 'Space', times: 1, label: 'Space (장기 확정)', waitAfter: 500 },
    // 보험사: 텍스트박스 좌표 클릭 → 2초 대기 → 입력 → 바로 아래 뜬 결과 좌표 클릭
    { id: 'companyField', action: 'click', label: '보험사 텍스트박스 클릭 (좌표)', waitAfter: 2000 },
    { action: 'type', value: 'companyTerm', label: '보험사명 입력', waitAfter: 700 },
    { id: 'companyResult', action: 'click', label: '검색된 보험사(바로 아래) 클릭 (좌표)', waitAfter: 1000 },
    // 상품: 텍스트박스 좌표 클릭 → 2초 대기 → 입력 → 바로 아래 뜬 결과 좌표 클릭
    { id: 'productField', action: 'click', label: '상품명 텍스트박스 클릭 (좌표)', waitAfter: 2000 },
    { action: 'type', value: 'productTerm', label: '상품명 입력', waitAfter: 700 },
    { id: 'productResult', action: 'click', label: '검색된 상품(바로 아래) 클릭 (좌표)', waitAfter: 800 },

    // 4) 다음 진행 — Tab×2 + Space 를 세 번
    { action: 'key', key: 'Tab', times: 2, label: 'Tab ×2', waitAfter: 150 },
    { action: 'key', key: 'Space', times: 1, label: 'Space (→다음)', waitAfter: 1200 },
    { action: 'key', key: 'Tab', times: 2, label: 'Tab ×2', waitAfter: 150 },
    { action: 'key', key: 'Space', times: 1, label: 'Space (→다음)', waitAfter: 1200 },
    { action: 'key', key: 'Tab', times: 2, label: 'Tab ×2', waitAfter: 150 },
    { action: 'key', key: 'Space', times: 1, label: 'Space (→다음)', waitAfter: 1200 },

    // 6) 정지 + 서명 알림
    { action: 'notify', title: '금소법 확인서 — 서명 필요', message: '자동 진행 완료. 화면을 확인하고 서명·발송을 직접 진행하세요. (발송은 비가역)', label: '정지 + 서명 알림', waitAfter: 0 },
  ];

  // value 토큰 → 실제 문자열
  function resolveValue(token, ctx) {
    if (token == null) return '';
    ctx = ctx || {};
    const c = ctx.customer || {};
    switch (token) {
      case 'customer.고객명': return c.고객명 || '';
      case 'customer.연락처': return c.연락처 || '';
      case 'customer.생년월일': return c.생년월일 || '';
      case 'policyNo': return ctx.policyNo || '';
      case 'companyTerm': return ctx.companyTerm || '';
      case 'productTerm': return ctx.productTerm || '';
      default: return String(token);   // 그대로 입력할 리터럴
    }
  }

  const ACTIONS = ['navigate', 'focus', 'click', 'type', 'typeIfPresent', 'key', 'keyByCategory', 'notify'];

  // 단계 배열 유효성 (불러오기 검증용)
  function validateSteps(steps) {
    return Array.isArray(steps) && steps.length > 0 && steps.every(s =>
      s && ACTIONS.indexOf(s.action) >= 0 && (s.action !== 'click' || typeof s.id === 'string'));
  }

  // 진행용으로 값/횟수 미리 해석
  function resolveSteps(steps, ctx) {
    ctx = ctx || {};
    return (steps || []).map(s => {
      const o = Object.assign({}, s);
      if (s.action === 'type' || s.action === 'typeIfPresent') o.text = resolveValue(s.value, ctx);
      if (s.action === 'keyByCategory') o.times = (s.map && s.map[ctx.category]) || 0;
      if (typeof o.waitAfter !== 'number') o.waitAfter = 400;
      return o;
    });
  }

  const api = { SEND_URL, DEFAULT_STEPS, resolveValue, validateSteps, resolveSteps, ACTIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PCSSteps = api;
})(typeof window !== 'undefined' ? window : globalThis);
