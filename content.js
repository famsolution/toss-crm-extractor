// content.js - 토스인슈 CRM 데이터 추출 콘텐츠 스크립트
// VERSION: 3.5.0 (2026-05-28) — mmlfcp 통합 적용 (applyToPremiumForm) + 단계별 진행 표시

// 중복 주입 방지 — 새 버전은 강제 재등록
const __EXT_VERSION = '3.7.9';
if (window.__tossCrmExtractorLoaded && window.__tossCrmExtractorVersion === __EXT_VERSION) {
  console.log(`[Toss Extractor] 이미 로드됨 (v${__EXT_VERSION})`);
} else {
  if (window.__tossCrmExtractorLoaded) {
    console.log(`[Toss Extractor] 버전 업그레이드 v${window.__tossCrmExtractorVersion || '?'} → v${__EXT_VERSION}`);
  }
  window.__tossCrmExtractorLoaded = true;
  window.__tossCrmExtractorVersion = __EXT_VERSION;
  console.log(`[Toss Extractor] ✨ v${__EXT_VERSION} 로드됨 (applyToPremiumForm 핸들러 포함)`);

function getAllCellValues(ariaLabel) {
  const cells = document.querySelectorAll(`td[aria-label="${ariaLabel}"] [data-tds-desktop-table-primitive-cell-content]`);
  return Array.from(cells).map(c => c.innerText.trim()).filter(v => v.length > 0);
}

// 마스킹된 값인지 판별 (* 가 2개 이상 포함)
function isMasked(value) {
  return typeof value === 'string' && /\*{2,}/.test(value);
}

// 여러 셀 값 중 최적값 선택
// - preferMasked: true면 마스킹된 값을 우선 (API로 복원할 대상)
// - 그 다음 길이 긴 값
function pickBestValue(values, { preferMasked = false } = {}) {
  if (!values || values.length === 0) return '';
  if (preferMasked) {
    const masked = values.find(v => isMasked(v));
    if (masked) return masked;
  }
  return values.reduce((best, cur) => (cur.length > best.length ? cur : best), values[0]);
}

function getCellValue(ariaLabel, opts) {
  return pickBestValue(getAllCellValues(ariaLabel), opts);
}

// 직업 코드 → 한글 매핑 (토스인슈 enum)
const JOB_LABELS = {
  OFFICE_WORKER: '직장인', PROFESSIONAL: '전문직', PUBLIC_OFFICER: '공무원',
  SELF_EMPLOYED: '자영업자', FREELANCE: '프리랜서', HOUSEKEEPER: '주부',
  STUDENT: '학생', UNEMPLOYED: '무직'
};
const DRIVING_LABELS = { NONE: '미운전', PERSONAL: '개인용', BUSINESS: '업무용' };
const CARRIER_LABELS = {
  SKT: 'SKT', KT: 'KT', LGU: 'LG U+',
  SK_MVNO: 'SKT 알뜰폰', KT_MVNO: 'KT 알뜰폰', LG_MVNO: 'LG 알뜰폰'
};

// 🔑 CSRF / Authorization 토큰 자동 추출 (쿠키, localStorage, meta 태그 등에서)
function _getAuthHeaders() {
  const h = { 'Accept': 'application/json' };
  // 1) meta CSRF
  const csrfMeta = document.querySelector('meta[name="csrf-token"], meta[name="X-CSRF-TOKEN"]');
  if (csrfMeta) h['X-CSRF-TOKEN'] = csrfMeta.getAttribute('content') || '';
  // 2) localStorage 인증 토큰 (Toss SSO 의 흔한 패턴)
  try {
    for (const k of Object.keys(localStorage)) {
      if (/token|auth|jwt|bearer/i.test(k)) {
        const v = localStorage.getItem(k);
        if (v && v.length > 20 && !h['Authorization']) {
          h['Authorization'] = v.startsWith('Bearer ') ? v : ('Bearer ' + v);
          break;
        }
      }
    }
  } catch (_) {}
  // 3) 쿠키에서 csrftoken / xsrf-token 추출
  try {
    const cookies = document.cookie.split(';').map(c => c.trim());
    for (const c of cookies) {
      const [name, value] = c.split('=');
      if (/^_csrf$|csrftoken|xsrf-token/i.test(name) && value) {
        h['X-XSRF-TOKEN'] = value;
        h['X-CSRF-TOKEN'] = value;
        break;
      }
    }
  } catch (_) {}
  h['X-Requested-With'] = 'XMLHttpRequest';
  return h;
}

// 🆕 마스킹 복원 API — 여러 endpoint 패턴을 순차 시도 (한 곳이 변경되어도 fallback)
async function fetchPrivacyData(customerId) {
  if (!customerId) return null;
  const urls = [
    `/api/customer/v2/${customerId}/privacy`,
    `/api/customer/v1/${customerId}/privacy`,
    `/api/customer/${customerId}/privacy`,
    `/api/v2/customer/${customerId}/privacy`,
    `/api/customer/v2/${customerId}/personal`,
    `/api/customer/v2/${customerId}/detail`,
    `/api/customer/v2/${customerId}/full`,
    `/api/crm/customer/v2/${customerId}/privacy`,
  ];
  const headers = _getAuthHeaders();
  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: 'include', headers });
      if (!res.ok) {
        console.log(`[Toss Extractor] ${url} → ${res.status}`);
        continue;
      }
      const data = await res.json();
      console.log(`[Toss Extractor] ✅ ${url} 성공:`, data);
      if (data?.resultType === 'SUCCESS' && data?.success) return data.success;
      if (data?.success) return data.success;
      if (data?.customerName || data?.customerEmail || data?.phoneNumber) return data;
      // body 안에 nested 가능
      if (data?.data) return data.data;
    } catch (e) {
      console.warn(`[Toss Extractor] ${url} 에러:`, e.message);
    }
  }
  console.warn('[Toss Extractor] 모든 privacy endpoint 실패 — DOM/popover 시도로 폴백');
  return null;
}

// 전화번호 별도 엔드포인트 — popover 클릭시 호출되는 것
async function fetchPhoneData(customerId) {
  if (!customerId) return null;
  const urls = [
    `/api/customer/v2/${customerId}/phone`,
    `/api/customer/v1/${customerId}/phone`,
    `/api/customer/${customerId}/phone`,
    `/api/v2/customer/${customerId}/phone`,
    `/api/customer/v2/${customerId}/phone-number`,
    `/api/customer/v2/${customerId}/contact`,
    `/api/crm/customer/v2/${customerId}/phone`,
  ];
  const headers = _getAuthHeaders();
  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: 'include', headers });
      if (!res.ok) {
        console.log(`[Toss Extractor] ${url} → ${res.status}`);
        continue;
      }
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        console.log(`[Toss Extractor] ✅ ${url} 성공:`, json);
        if (json?.success && typeof json.success === 'string') return json.success;
        if (json?.success?.phoneNumber) return json.success.phoneNumber;
        if (json?.phoneNumber) return json.phoneNumber;
        if (json?.data?.phoneNumber) return json.data.phoneNumber;
        if (typeof json === 'string') return json;
      } catch {
        // JSON 아닌 경우 — 따옴표 제거하고 반환
        const phone = text.replace(/^"|"$/g, '').trim();
        if (/^\d{2,3}-?\d{3,4}-?\d{4}$/.test(phone)) return phone;
      }
    } catch (e) {
      console.warn(`[Toss Extractor] ${url} 에러:`, e.message);
    }
  }
  console.warn('[Toss Extractor] 모든 phone endpoint 실패');
  return null;
}

// 🆕 페이지 자체의 인증된 fetch 컨텍스트를 활용 — 토스 CRM 의 React/Redux 상태 직접 조회
//   대부분의 SPA 는 전역 state 에 사용자가 보고 있는 데이터가 평문으로 저장됨
function findUnmaskedFromAppState(customerId) {
  try {
    // React DevTools 의 fiber 노드를 통해 상태 추출
    const result = {};
    const checkObj = (obj, depth = 0) => {
      if (!obj || depth > 5 || typeof obj !== 'object') return;
      for (const key of Object.keys(obj)) {
        const v = obj[key];
        if (typeof v === 'string') {
          // 전화번호 패턴
          if (/^01[0-9]-?\d{3,4}-?\d{4}$/.test(v.replace(/\s/g, ''))) {
            result.phone = result.phone || v;
          }
          // 이메일 패턴 (마스킹 없는)
          if (/^[^\s@*]+@[^\s@*]+\.[^\s@*]+$/.test(v)) {
            result.email = result.email || v;
          }
          // 주민번호 패턴
          if (/^\d{6}-?\d{7}$/.test(v.replace(/\s/g, ''))) {
            result.rrn = result.rrn || v;
          }
        } else if (typeof v === 'object' && v !== null && depth < 4) {
          checkObj(v, depth + 1);
        }
      }
    };
    // window 의 redux store 후보
    const candidates = [
      window.__REDUX_STORE__,
      window.store,
      window.__NEXT_DATA__,
      window.__INITIAL_STATE__,
      window.__APP_STATE__,
    ];
    for (const c of candidates) {
      if (c) {
        const state = (typeof c.getState === 'function') ? c.getState() : c;
        checkObj(state);
      }
    }
    // React fiber root 에서 추출
    const rootEl = document.getElementById('root') || document.getElementById('__next') || document.body;
    if (rootEl) {
      const reactKey = Object.keys(rootEl).find(k => k.startsWith('__reactContainer$') || k.startsWith('_reactRootContainer'));
      if (reactKey) {
        try {
          const fiber = rootEl[reactKey];
          checkObj(fiber, 0);
        } catch (_) {}
      }
    }
    if (Object.keys(result).length > 0) {
      console.log('[Toss Extractor] ✅ App State 에서 추출:', result);
    }
    return result;
  } catch (e) {
    console.warn('[findUnmaskedFromAppState]', e);
    return {};
  }
}

// 🆕 페이지 DOM 에서 마스킹 해제된 전화번호 찾기
//   사용자가 토스 CRM 에서 "전화번호 보기" 버튼을 한 번이라도 클릭했다면
//   DOM 어딘가에 010-XXXX-XXXX 형태의 전체 번호가 노출되어 있음
function findUnmaskedPhoneInDOM() {
  try {
    // 1) 일반 텍스트 노드 + input value 모두 검색
    const phoneRegex = /\b01[0-9][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g;
    const candidates = new Set();
    // input value 검색 (popover 안에 있을 수 있음)
    document.querySelectorAll('input').forEach(el => {
      const v = el.value || '';
      const matches = v.match(phoneRegex);
      if (matches) matches.forEach(m => candidates.add(m));
    });
    // 일반 텍스트 노드 검색
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent || '';
      if (t.includes('*')) continue;   // 마스킹된 텍스트 스킵
      const matches = t.match(phoneRegex);
      if (matches) matches.forEach(m => candidates.add(m));
    }
    // 중복 제거 후 첫 번째 후보 반환 (보통 하나만 노출됨)
    const list = Array.from(candidates);
    if (list.length === 0) return null;
    console.log('[Toss Extractor] DOM 에서 마스킹 해제 전화번호 발견:', list);
    return list[0];
  } catch (e) {
    console.warn('[findUnmaskedPhoneInDOM] 실패:', e);
    return null;
  }
}

// 🆕 페이지 내 모든 마스킹 해제 가능 버튼/아이콘을 자동 클릭
//   - "보기" 텍스트 버튼
//   - eye 아이콘 (SVG, data-tds-icon, lucide 등)
//   - 마스킹된 텍스트 옆 클릭 가능 영역
async function tryRevealAllMaskedFields() {
  try {
    const clicked = new Set();
    // 1) "보기" 텍스트 포함 버튼
    document.querySelectorAll('button, [role="button"]').forEach(b => {
      const text = (b.textContent || b.getAttribute('aria-label') || '').trim();
      if (/^(보기|보이기|👁|🔓|reveal|show)$/i.test(text) ||
          /보기$/.test(text) || /^전체$/.test(text)) {
        if (!clicked.has(b)) {
          try { b.click(); clicked.add(b); } catch(_){}
        }
      }
    });
    // 2) eye 아이콘 (SVG, data attribute)
    document.querySelectorAll('[data-tds-icon="eye"], [data-tds-icon="eye-on"], svg[class*="eye" i]').forEach(icon => {
      const btn = icon.closest('button, [role="button"]') || icon;
      if (!clicked.has(btn)) {
        try { btn.click(); clicked.add(btn); } catch(_){}
      }
    });
    // 3) 마스킹된 텍스트 (***) 가 들어있는 셀에 click 시도
    document.querySelectorAll('td, [data-tds-desktop-table-primitive-cell-content], [data-clickable]').forEach(cell => {
      const text = cell.textContent || '';
      if (/\*{2,}|●●|·{2,}/.test(text)) {
        if (!clicked.has(cell)) {
          try { cell.click(); clicked.add(cell); } catch(_){}
        }
      }
    });
    if (clicked.size > 0) {
      console.log(`[Toss Extractor] 🔓 ${clicked.size}개 reveal 트리거 클릭`);
      // 클릭 후 popover/tooltip 열림 대기
      await new Promise(r => setTimeout(r, 1200));
    }
  } catch (e) {
    console.warn('[tryRevealAllMaskedFields]', e);
  }
}

// 🆕 popover 버튼 클릭으로 전화번호 노출 시도
//   토스 CRM 의 "전화번호 보기" 버튼을 프로그래매틱하게 클릭
async function tryRevealPhoneViaUI() {
  try {
    // 가능성 있는 버튼들 — 텍스트가 "보기", "전화번호" 포함
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], [data-tds-icon]'));
    const phoneBtn = buttons.find(b => {
      const text = (b.textContent || b.getAttribute('aria-label') || '').trim();
      return /전화번호.*보기|연락처.*보기|👁/.test(text) ||
             b.querySelector('[data-tds-icon="eye"]') !== null;
    });
    if (!phoneBtn) return null;
    console.log('[Toss Extractor] 전화번호 보기 버튼 클릭 시도');
    phoneBtn.click();
    // 0.8초 대기 후 DOM 재스캔
    await new Promise(r => setTimeout(r, 800));
    return findUnmaskedPhoneInDOM();
  } catch (e) {
    console.warn('[tryRevealPhoneViaUI] 실패:', e);
    return null;
  }
}

async function extractCustomerData() {
  const fields = [
    '고객명', '성별', '생년월일', '상령일', '연락처', '이메일',
    '주소', '직업', '하는일', '키', '몸무게', '운전여부', '통신사',
    '주민등록번호', 'Insu No.', 'User No.', 'GA No.', '비고', '메모'
  ];

  // 여러 셀에 동일 라벨이 있는 경우 마스킹된 값을 우선 (개인정보는 마스킹된 쪽이 실제 전체 데이터)
  const preferMaskedFields = new Set(['주소', '연락처', '이메일', '주민등록번호']);

  const customer = {};
  for (const field of fields) {
    const val = getCellValue(field, { preferMasked: preferMaskedFields.has(field) });
    if (val) customer[field] = val;
  }

  // 고객 ID는 URL에서 추출
  const match = window.location.pathname.match(/\/customers\/(\d+)/);
  const customerId = match ? match[1] : '';
  if (customerId) customer['고객ID'] = customerId;

  // 마스킹된 필드가 있으면 서버에서 실제 값 조회
  const hasMaskedValues = Object.values(customer).some(isMasked);
  customer['_마스킹복원'] = hasMaskedValues ? false : 'unnecessary';

  if (customerId && hasMaskedValues) {
    const privacy = await fetchPrivacyData(customerId);

    if (privacy) {
      // 마스킹된 필드 교체
      if (isMasked(customer['이메일']) && privacy.customerEmail) {
        customer['이메일'] = privacy.customerEmail;
      }
      if (privacy.address || privacy.additionalAddress) {
        const addr = [privacy.address, privacy.additionalAddress].filter(Boolean).join(' ').trim();
        if (addr && isMasked(customer['주소'])) customer['주소'] = addr;
      }
      if (isMasked(customer['주민등록번호']) && privacy.rrn) {
        customer['주민등록번호'] = privacy.rrn;
      }
      if (isMasked(customer['연락처']) && privacy.phoneNumber) {
        customer['연락처'] = privacy.phoneNumber;
      }
      // 보조 필드들 (없거나 마스킹된 경우만)
      if (privacy.customerName && (!customer['고객명'] || isMasked(customer['고객명']))) {
        customer['고객명'] = privacy.customerName;
      }
      if (privacy.customerJob && JOB_LABELS[privacy.customerJob] && (!customer['직업'] || isMasked(customer['직업']))) {
        customer['직업'] = JOB_LABELS[privacy.customerJob];
      }
      if (privacy.drivingStatus && DRIVING_LABELS[privacy.drivingStatus] && (!customer['운전여부'] || isMasked(customer['운전여부']))) {
        customer['운전여부'] = DRIVING_LABELS[privacy.drivingStatus];
      }
      if (privacy.mobileCarrier && CARRIER_LABELS[privacy.mobileCarrier] && (!customer['통신사'] || isMasked(customer['통신사']))) {
        customer['통신사'] = CARRIER_LABELS[privacy.mobileCarrier];
      }
      if (privacy.height && (!customer['키'] || isMasked(customer['키']))) {
        customer['키'] = `${privacy.height}cm`;
      }
      if (privacy.weight && (!customer['몸무게'] || isMasked(customer['몸무게']))) {
        customer['몸무게'] = `${privacy.weight}kg`;
      }
      if (privacy.work && (!customer['하는일'] || isMasked(customer['하는일']))) {
        customer['하는일'] = privacy.work;
      }
      customer['_마스킹복원'] = true;
    } else {
      // privacy API가 실패하면 phone API는 별도로 시도
      if (isMasked(customer['연락처'])) {
        const phone = await fetchPhoneData(customerId);
        if (phone) {
          customer['연락처'] = phone;
          customer['_마스킹복원'] = 'partial';
        }
      }
    }
  }

  // 🆕 폴백 단계 1: App State (React/Redux) 에서 직접 추출
  if (isMasked(customer['연락처']) || isMasked(customer['이메일']) || isMasked(customer['주민등록번호'])) {
    const stateData = findUnmaskedFromAppState(customerId);
    if (stateData.phone && isMasked(customer['연락처'])) {
      customer['연락처'] = stateData.phone;
      customer['_마스킹복원'] = 'app-state';
    }
    if (stateData.email && isMasked(customer['이메일'])) {
      customer['이메일'] = stateData.email;
    }
    if (stateData.rrn && isMasked(customer['주민등록번호'])) {
      customer['주민등록번호'] = stateData.rrn;
    }
  }

  // 🆕 폴백 단계 2: DOM 에서 찾기 (이미 노출된 값 픽업)
  if (isMasked(customer['연락처'])) {
    let unmasked = findUnmaskedPhoneInDOM();
    if (!unmasked) {
      // 한 번 더 시도: popover 버튼 자동 클릭으로 노출
      unmasked = await tryRevealPhoneViaUI();
    }
    if (unmasked) {
      customer['연락처'] = unmasked;
      customer['_마스킹복원'] = customer['_마스킹복원'] || 'dom-partial';
      console.log('[Toss Extractor] ✅ DOM 에서 전화번호 복원:', unmasked);
    }
  }

  // 🆕 폴백 단계 3: 모든 마스킹 필드에 대해 popover/clickable 영역 자동 클릭 시도
  //    (전화번호 이외에도 이메일, 주민번호 등의 "보기" 버튼이 있을 수 있음)
  if (isMasked(customer['연락처']) || isMasked(customer['이메일']) || isMasked(customer['주민등록번호'])) {
    await tryRevealAllMaskedFields();
    // 재시도 — 노출 후 DOM 재스캔
    const dom2 = findUnmaskedPhoneInDOM();
    if (dom2 && isMasked(customer['연락처'])) {
      customer['연락처'] = dom2;
      customer['_마스킹복원'] = customer['_마스킹복원'] || 'auto-reveal';
    }
    // 이메일 / 주민번호 도 DOM 에서 다시 찾기
    const allText = document.body.innerText || '';
    if (isMasked(customer['이메일'])) {
      const m = allText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (m) customer['이메일'] = m[0];
    }
    if (isMasked(customer['주민등록번호'])) {
      const m = allText.match(/\d{6}-?\d{7}/);
      if (m) customer['주민등록번호'] = m[0].includes('-') ? m[0] : m[0].substring(0,6) + '-' + m[0].substring(6);
    }
  }

  // 여전히 마스킹된 필드가 남아있는지 확인
  const remainingMasked = Object.entries(customer)
    .filter(([k]) => !k.startsWith('_'))
    .filter(([, v]) => isMasked(v))
    .map(([k]) => k);
  if (remainingMasked.length > 0) {
    customer['_마스킹잔여'] = remainingMasked;
  }

  return customer;
}

// 알려진 보험 메타데이터 헤더 (토스 페이지의 행 라벨)
const INSURANCE_ROW_HEADERS = new Set([
  '보험명', '보험사명', '계약일', '계약상태', '갱신 유무', '갱신유무',
  '계약자/피보험자', '증권번호', '납입 여부', '납입여부',
  '납입주기/납입기간', '보장만기/만기연령', '납입종료일/종료연령',
  '월납보험료', '기납보험료', '잔여보험료', '총보험료',
  '매니저 의견', '매니저 코멘트', '대분류', '소분류',
  '성별', '생년월일', '상령일', '최초 보험연결일', '상담 문의',
  // 토스 UI 업데이트로 추가된 헤더 — 셀에 상품명+카운트 등이 함께 들어있음
  '보험 개수'
]);
// 헤더 라벨 정규화: 토스 UI 변경으로 첫 행이 "보험 개수"로 바뀌었지만 실제로는 상품명 row 역할
const ROW_HEADER_ALIAS = {
  '보험 개수': '보험명',
  '갱신유무': '갱신 유무',
  '납입여부': '납입 여부'
};

// 🆕 보장내역(cover) 페이지 '기본정보' 전체 추출 (이름 + 성별/생년월일/상령일/최초보험연결일/상담문의)
//   토스 보장분석 페이지의 기본정보는 <td aria-label="성별/생년월일/상령일/..."> 라벨셀 + 다음 형제 값셀 구조.
//   반환: { 고객명, 성별, 생년월일(YYYYMMDD), 생년월일표시, 상령일, 최초보험연결일, 상담문의, 보험나이 }
async function extractCustomerBasicInfo(customerId) {
  const out = {};
  const toYmd = (raw) => {
    if (!raw) return '';
    let d = String(raw).replace(/[^\d]/g, '').slice(0, 8);   // "2007-01-27 (보험나이 19세)" → 20070127
    if (d.length === 6) { const yy = parseInt(d.slice(0, 2), 10); d = `${yy <= 24 ? 2000 + yy : 1900 + yy}${d.slice(2)}`; }
    return d.length >= 8 ? d.slice(0, 8) : '';
  };

  // ── 0) 고객명 ──
  //   ① 페이지 title "보장 : 박현빈 8005099" → 이름
  //   ② bold 헤더(프로필 영역)에서 한글 이름
  //   ③ 계약자/피보험자 "김*선/박현빈" 의 본인측
  try {
    let name = '';
    const tm = (document.title || '').match(/보장\s*[:：]\s*([가-힣]{2,5})/);
    if (tm) name = tm[1];
    if (!name) {
      // bold + 한글 2~5자 헤더 (프로필 이름)
      const bolds = Array.from(document.querySelectorAll('[style*="font-weight: bold"], [style*="font-weight:bold"], b, strong'));
      for (const el of bolds) {
        const t = (el.textContent || '').trim();
        if (/^[가-힣]{2,5}$/.test(t)) { name = t; break; }
      }
    }
    if (name) out.고객명 = name;
  } catch (e) {}

  // ── 1) 기본정보 — 토스 구조: <th>라벨</th> <td aria-label="라벨">값</td>
  //   즉 aria-label 이 붙은 셀(TD) 자신의 텍스트가 '값'. (라벨은 별도 th)
  const LABELS = { '성별': '성별', '생년월일': '생년월일', '상령일': '상령일', '최초 보험연결일': '최초보험연결일', '상담 문의': '상담문의' };
  try {
    const cells = Array.from(document.querySelectorAll('td[aria-label], [role="cell"][aria-label]'));
    for (const cell of cells) {
      const lbl = (cell.getAttribute('aria-label') || '').trim();
      const key = LABELS[lbl];
      if (!key || out[key]) continue;
      const val = (cell.innerText || cell.textContent || '').trim();   // 셀 자신 = 값
      if (val && val !== lbl) out[key] = val;
    }
  } catch (e) { console.warn('[Toss Extractor] 기본정보 aria-label 스캔 실패:', e); }

  // ── 2) 폴백: 라벨 텍스트 기반(aria-label 없을 때) ──
  if (!out.성별 || !out.생년월일) {
    try {
      const all = Array.from(document.querySelectorAll('td, th, div, span, dt, dd'));
      for (let i = 0; i < all.length; i++) {
        const t = (all[i].innerText || '').trim();
        const next = () => (all[i].nextElementSibling?.innerText || all[i + 1]?.innerText || '').trim();
        if (t === '성별' && !out.성별) { const v = next(); if (/남/.test(v)) out.성별 = '남자'; else if (/여/.test(v)) out.성별 = '여자'; }
        if (t === '생년월일' && !out.생년월일) { const v = next(); if (/\d{4}/.test(v)) { out.생년월일표시 = v; out.생년월일 = toYmd(v); } }
        if (t === '상령일' && !out.상령일) { const v = next(); if (v) out.상령일 = v; }
      }
    } catch (e) {}
  }

  // ── 3) 생년월일 정규화 + 보험나이 분리 ──
  if (out.생년월일 && !/^\d{8}$/.test(out.생년월일)) {
    out.생년월일표시 = out.생년월일;             // 원문 보존("2007-01-27 (보험나이 19세)")
    const ageM = out.생년월일.match(/보험나이\s*(\d+)\s*세/);
    if (ageM) out.보험나이 = ageM[1];
    out.생년월일 = toYmd(out.생년월일);           // 8자리로
  }
  // ── 4) 성별 미확보 시 생년월일 라벨 옆 주민번호/표시값 또는 API 폴백 ──
  if (!out.성별 && customerId) {
    try {
      const privacy = await fetchPrivacyData(customerId);
      if (privacy && privacy.rrn) {
        if (!out.생년월일) { const y = toYmd(privacy.rrn); if (y) out.생년월일 = y; }
        const g = String(privacy.rrn).replace(/[^\d]/g, '')[6];
        if (['1', '3', '5', '7'].includes(g)) out.성별 = '남자';
        else if (['2', '4', '6', '8'].includes(g)) out.성별 = '여자';
      }
    } catch (e) {}
  }
  console.log('[Toss Extractor] 👤 보장내역 기본정보 추출:', out);
  return out;
}
// 하위호환 별칭 (기존 호출부 유지)
async function extractCustomerBirthFromCoverPage(customerId) {
  const info = await extractCustomerBasicInfo(customerId);
  return { 생년월일: info.생년월일 || '', 성별: info.성별 || '' };
}

function extractInsuranceData() {
  // 1) 메인 보험 비교 테이블 찾기 — 여러 selector 시도 (toss UI 변경 대응)
  let tbody = document.querySelector('tbody[data-tds-desktop-table-body]');
  if (!tbody) {
    const firstInsCell = document.querySelector('td.insurance-table-cell');
    if (firstInsCell) tbody = firstInsCell.closest('tbody');
  }

  // 2) tbody가 없어도 fallback — 페이지 전체에서 알려진 헤더를 가진 <tr> 찾기
  const trRows = tbody
    ? tbody.querySelectorAll('tr')
    : document.querySelectorAll('tr');

  const dataMatrix = [];
  let referenceTable = null;

  trRows.forEach(tr => {
    const th = tr.querySelector('th');
    if (!th) return;
    // 헤더 텍스트 추출 (다양한 셀 구조 대응)
    const headerEl =
      th.querySelector('[data-tds-desktop-table-h-cell-children-container]') ||
      th;
    const headerText = (headerEl.innerText || '').trim().split('\n')[0].trim();
    // 진단: 처리되는 모든 헤더 출력 (한 번만)
    if (!window.__tossDebugSeenHeaders) window.__tossDebugSeenHeaders = new Set();
    if (!window.__tossDebugSeenHeaders.has(headerText)) {
      window.__tossDebugSeenHeaders.add(headerText);
      console.log('[Toss Ext] row header 감지:', JSON.stringify(headerText), '(길이:', headerText.length, ')', '- 매칭:', INSURANCE_ROW_HEADERS.has(headerText) ? '✓' : '✗');
    }
    if (!INSURANCE_ROW_HEADERS.has(headerText)) return;
    // 헤더 alias 적용 (예: "보험 개수" → "보험명")
    const effectiveHeader = ROW_HEADER_ALIAS[headerText] || headerText;

    // 같은 테이블의 행들만 처리 (다른 테이블의 동명 헤더 혼합 방지)
    const parentTable = tr.closest('table');
    if (!referenceTable) referenceTable = parentTable;
    if (parentTable !== referenceTable) return;

    // 데이터 셀 추출 (insurance-table-cell 또는 일반 td)
    const dataCells = tr.querySelectorAll(
      'td.insurance-table-cell, td[aria-label]'
    );
    const cells = dataCells.length > 0 ? dataCells : tr.querySelectorAll('td');
    if (cells.length === 0) return;

    const rowData = { header: effectiveHeader, values: [], titles: [], cells: [] };
    cells.forEach(cell => {
      rowData.cells.push(cell);
      const content =
        cell.querySelector('[data-tds-desktop-table-primitive-cell-content]') ||
        cell;
      let text = (content.innerText || '').trim().replace(/\s+/g, ' ');

      // 편집 가능한 셀: input/textarea의 value 우선
      const input = cell.querySelector('input[type="text"], textarea');
      if (input && input.value && input.value.trim()) {
        text = input.value.trim();
      }

      // 🆕 보험료 금액 행(월납/기납/잔여/총) — innerText 가 비었거나 "-" 인 경우,
      //   같은 셀의 textContent 에서 "N 원"/콤마숫자만 보수적으로 복원 (숨은 span 등).
      //   ※ 위험한 광범위 추측은 하지 않음 — 못 채운 일시납 월납은 아래 컬럼 교차채움이 처리.
      const _AMOUNT_HEADERS = new Set(['월납보험료', '기납보험료', '잔여보험료', '총보험료']);
      if (_AMOUNT_HEADERS.has(effectiveHeader) && !/\d/.test(text)) {
        const raw = String((content && content.textContent) || cell.textContent || '').replace(/\s+/g, ' ').trim();
        const m = raw.match(/(-?[\d,]{2,})\s*원/) || raw.match(/-?[\d]{1,3}(?:,[\d]{3})+/);
        if (m) text = (m[1] || m[0]).trim();
      }

      // title 속성 추출 (셀 자체 → 자식 요소 순)
      let title = cell.getAttribute('title') || '';
      if (!title) {
        const titledEl = cell.querySelector('[title]:not([title=""])');
        if (titledEl) title = titledEl.getAttribute('title') || '';
      }

      // placeholder("보험명 없음") 셀: title에 실제 값이 있으면 사용
      if ((text === '보험명 없음' || !text) && title && title !== '보험명 없음') {
        text = title;
      }

      // 추가 fallback: 셀 내부의 <span>들에서 실제 상품명 탐색
      // 토스 CRM 일부 셀은 placeholder를 표시하면서 실제 값을 내부 span에 보관 (숨겨진 경우 포함)
      // 예: <span class="pc22-1e3yv2i0 css-...">프로미카개인용</span>
      const STATUS_TOKENS = new Set([
        '정상', '만기', '소멸', '해지', '실효',
        '납입중', '납입종료', '미가입', '해외여행보험',
        '갱신', '비갱신', '비갱신형', '갱신형', '갱신형 보험', '갱신형 특약',
        '본인', '-', '보험명 없음', ''
      ]);
      const isValidProductName = (t) => {
        if (!t || STATUS_TOKENS.has(t)) return false;
        if (t.length < 3) return false;
        if (!/[가-힣A-Za-z]/.test(t)) return false;
        if (/^\d{4}-\d{2}-\d{2}/.test(t)) return false;
        if (/^\d+[\s,]*원/.test(t)) return false;
        return true;
      };

      // 항상 내부 자식 요소를 검사해 더 좋은 상품명 후보 찾기 (보험명 셀 전용)
      // effectiveHeader 사용 — "보험 개수" → "보험명" alias 적용된 결과
      if (effectiveHeader === '보험명') {
        let bestCandidate = '';
        const fullCellText = (cell.textContent || '').trim().replace(/\s+/g, ' ');
        // 모든 자식 요소 (leaf only) 검사
        const allChildren = cell.querySelectorAll('*');
        const candidateList = [];
        for (const el of allChildren) {
          if (el.children.length > 0) continue;
          const elText = (el.textContent || '').trim().replace(/\s+/g, ' ');
          candidateList.push({ tag: el.tagName, text: elText.substring(0, 80) });
          if (!isValidProductName(elText)) continue;
          if (elText.length > bestCandidate.length) {
            bestCandidate = elText;
          }
        }
        // textContent에서 placeholder 제거 후 시도
        if (!bestCandidate && fullCellText) {
          const cleaned = fullCellText.replace(/보험명 없음/g, '').trim();
          if (isValidProductName(cleaned)) bestCandidate = cleaned;
        }
        // 진단 로그 — 항상 출력 (cellIndex로 어떤 컬럼인지 추적)
        console.log('[Toss Ext] 보험명 셀', {
          colIdx: rowData.values.length,
          innerText: text,
          textContent: fullCellText.substring(0, 150),
          title: title,
          cellHTML: cell.outerHTML.substring(0, 400),
          leafChildren: candidateList,
          bestCandidate
        });
        // 더 나은 후보가 있으면 교체 (단, 기존 text가 valid 한 경우에만 비교)
        if (bestCandidate && (!isValidProductName(text) || text === '보험명 없음' || bestCandidate.length > text.length)) {
          text = bestCandidate;
        }
      }

      rowData.values.push(text);
      rowData.titles.push(title);
    });
    dataMatrix.push(rowData);
  });

  if (dataMatrix.length === 0) return [];

  // 🆕 thead에서 상품명 추출 — 토스 CRM 업데이트로 "보험명"이 body row가 아닌 thead로 이동
  //   각 insurance column의 thead 셀에 상품명이 있음 (보통 span.pc22-1e3yv2i0 안)
  const productNamesFromThead = [];
  {
    const table = (tbody && tbody.closest('table')) ||
                  document.querySelector('table:has(td.insurance-table-cell)') ||
                  document.querySelector('table:has(td[aria-label])');
    if (table) {
      const thead = table.querySelector('thead');
      if (thead) {
        const headerCells = thead.querySelectorAll('th, td');
        const STATUS_TOKENS = new Set([
          '정상', '만기', '소멸', '해지', '실효', '납입중', '납입종료',
          '미가입', '해외여행보험', '갱신', '비갱신', '비갱신형', '갱신형',
          '본인', '-', '보험명 없음', '보험 개수', ''
        ]);
        const isValidProductName = (t) => {
          if (!t || STATUS_TOKENS.has(t)) return false;
          if (t.length < 3) return false;
          if (!/[가-힣A-Za-z]/.test(t)) return false;
          if (/^\d{4}-\d{2}-\d{2}/.test(t)) return false;
          if (/^\d+[\s,]*원/.test(t)) return false;
          return true;
        };
        headerCells.forEach((hc, idx) => {
          // 모든 leaf 자식 요소 textContent 검사
          let best = '';
          const leafs = hc.querySelectorAll('*');
          for (const el of leafs) {
            if (el.children.length > 0) continue;
            const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
            if (isValidProductName(t) && t.length > best.length) best = t;
          }
          if (best) productNamesFromThead.push(best);
        });
        console.log('[Toss Ext] thead에서 추출한 상품명들:', productNamesFromThead);
      }
    }
  }

  const numInsurances = dataMatrix[0].values.length;
  const insurances = [];
  for (let i = 0; i < numInsurances; i++) {
    // 컬럼 가시성 체크: 이 컬럼의 셀이 대부분 숨겨져 있으면 토스 페이지에서 필터로 가려진 보험 → 제외
    let hiddenCount = 0;
    let totalChecked = 0;
    for (const row of dataMatrix) {
      const cell = row.cells && row.cells[i];
      if (!cell) continue;
      totalChecked++;
      const style = window.getComputedStyle(cell);
      if (style.display === 'none' || style.visibility === 'hidden' ||
          cell.hidden || cell.offsetWidth === 0 || cell.offsetHeight === 0) {
        hiddenCount++;
      }
    }
    // 절반 이상의 셀이 숨겨져 있으면 이 컬럼은 토스 페이지에서 가려진 것
    if (totalChecked > 0 && hiddenCount > totalChecked / 2) {
      console.log(`[Toss Extractor] 숨겨진 컬럼 #${i + 1} 자동 제외 (${hiddenCount}/${totalChecked} 셀 hidden)`);
      continue;
    }

    const insurance = {};
    dataMatrix.forEach(row => {
      if (row.values[i]) insurance[row.header] = row.values[i];
      // 보험명 행의 title 속성에서 잘리지 않은 전체 상품명 추출
      if (row.header === '보험명' && row.titles[i]) {
        insurance['보험명'] = row.titles[i];
      }
    });
    // 🆕 thead에서 추출한 상품명을 보험명으로 설정 (보험명이 비어있는 경우)
    // thead의 column 인덱스는 보통 데이터 셀의 인덱스와 매칭됨 (단, 첫 sticky cell offset 고려)
    if (!insurance['보험명'] || insurance['보험명'] === '보험명 없음') {
      // thead 셀 개수가 데이터 컬럼보다 1개 많으면 (sticky empty cell 포함) +1 offset
      const theadOffset = productNamesFromThead.length > numInsurances ? 1 : 0;
      const theadName = productNamesFromThead[i + theadOffset];
      if (theadName) {
        insurance['보험명'] = theadName;
      }
    }
    if (Object.keys(insurance).length > 0) insurances.push(insurance);
  }

  // 🆕 일시납(또는 월납이 비어있는) 상품의 월납보험료 보정 — 결정적 규칙:
  //   납입주기가 "일시납" 이면 월납 = 총보험료(없으면 기납)와 동일하다.
  //   월납 셀이 비거나 "-" 인데 총/기납에 값이 있으면 그 값으로 채운다.
  const _digits = (v) => String(v == null ? '' : v).replace(/[^\d]/g, '');
  insurances.forEach(ins => {
    const cycle = String(ins['납입주기/납입기간'] || ins['납입주기'] || '');
    const isLump = /일시납/.test(cycle);
    const m = _digits(ins['월납보험료']);
    const total = _digits(ins['총보험료']);
    const paid  = _digits(ins['기납보험료']);
    const fill = total || paid;
    if (!fill) return;
    if (!m) {
      // 월납이 비어있으면 총/기납으로 채움
      ins['월납보험료'] = Number(fill).toLocaleString();
    } else if (isLump && m !== fill && total) {
      // 🆕 일시납인데 월납이 총보험료와 다르면(숨은 담보금 등 오추출) 총보험료로 교정
      ins['월납보험료'] = Number(total).toLocaleString();
    }
  });

  return insurances;
}

// 상품-accordion 헤더 텍스트에서 보험사명/상품명 분리
function extractProductInfoFromAccordion(accordion) {
  if (!accordion) return { company: '', product: '', headerText: '' };
  const header = accordion.querySelector(
    '.p-accordion__item-header, [class*="accordion__item-header"]'
  );
  if (!header) return { company: '', product: '', headerText: '' };

  // 헤더 전체 텍스트를 줄 단위로 분리 (DOM 구조와 무관하게 신뢰성 ↑)
  const headerText = header.innerText.trim();
  const lines = headerText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // 제외할 패턴: 상태 배지, 금액·납입 정보 등
  const STATUS_TOKENS = new Set([
    '정상', '납입중', '납입종료', '실효', '해지', '갱신', '비갱신',
    '비갱신형', '갱신형 특약', '월납중', '연납', '일시납'
  ]);
  const isProductLine = (line) => {
    if (STATUS_TOKENS.has(line)) return false;
    if (/원\s*[|│\/]/.test(line)) return false;     // "153,250 원 | 월납..."
    if (/^[\d,.\s]+(?:원|만원|개)/.test(line)) return false; // "5,000 만원" 등 금액
    if (/^[\d,\s]+$/.test(line)) return false;       // 순수 숫자
    if (line.length < 2) return false;
    return /[가-힣A-Za-z]/.test(line);               // 한글 또는 영문 포함
  };
  const productLines = lines.filter(isProductLine);

  // 일반 패턴: [보험사명, 상품명] 순서
  let company = '';
  let product = '';
  if (productLines.length >= 2) {
    company = productLines[0];
    product = productLines[1];
  } else if (productLines.length === 1) {
    product = productLines[0];
  }

  // 보험료 라인 추출 (예: "153,250 원 | 월납 / 현대해상화재보험")
  let premium = '';
  let payCycle = '';
  const premiumLine = lines.find(l => /원\s*[|│]/.test(l));
  if (premiumLine) {
    const pm = premiumLine.match(/([\d,]+)\s*원/);
    if (pm) premium = pm[1].replace(/,/g, '');
    const cm = premiumLine.match(/\|\s*([^/]+?)\s*\//);
    if (cm) payCycle = cm[1].trim();
  }

  return { company, product, premium, payCycle, headerText };
}

// 접혀있는 모든 accordion 을 펼침 (탭 전환은 별도 switchAllTabsTo 로)
async function expandAllAccordions() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let rounds = 0;
  const maxRounds = 6;
  let totalExpanded = 0;

  while (rounds < maxRounds) {
    const collapsed = document.querySelectorAll('.p-accordion__item-header[aria-expanded="false"]');
    collapsed.forEach(header => {
      try { header.click(); totalExpanded++; } catch (e) {
        console.warn('[Toss Extractor] accordion click failed:', e);
      }
    });
    if (collapsed.length === 0) break;
    await sleep(450);
    rounds++;
  }
  return { rounds, expanded: totalExpanded };
}

// 🆕 모든 accordion 의 보장/특약 segmented control 을 지정된 탭(label) 으로 강제 전환
//   다양한 selector + 텍스트 매칭 fallback 으로 Toss CRM 의 DOM 구조 변경에도 대응
async function switchAllTabsTo(label) {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let rounds = 0, totalSwitched = 0;

  const findCandidates = () => {
    // 🔒 스코프 한정: 보장/특약 토글은 항상 accordion 내부에만 존재한다.
    //    document 전체에서 텍스트가 '보장'/'특약'인 버튼을 클릭하면
    //    상단 네비게이션/다른 탭을 눌러 페이지를 이탈 → 보장·특약 둘 다 추출 실패.
    //    따라서 accordion 컨테이너 내부로만 후보를 제한한다.
    const scopes = Array.from(document.querySelectorAll('.p-accordion__item'));
    const roots = scopes.length > 0 ? scopes : [document];
    const collect = (selector, exactText) => {
      const out = [];
      roots.forEach(root => {
        root.querySelectorAll(selector).forEach(el => {
          if (exactText) {
            const txt = (el.innerText || el.textContent || '').trim();
            if (txt !== label || txt.length >= 20) return;
          }
          out.push(el);
        });
      });
      return out;
    };

    // 1) title 속성 (현재 알려진 구조)
    let nodes = collect(`button[role="radio"][title="${label}"], button[role="tab"][title="${label}"], [role="radio"][title="${label}"], [role="tab"][title="${label}"]`, false);
    // 2) 텍스트 콘텐츠 (innerText) 정확 일치 — title 없어도 동작
    if (nodes.length === 0) {
      nodes = collect('button[role="radio"], button[role="tab"], [role="radio"], [role="tab"], button[data-radix-collection-item]', true);
    }
    // 2.5) 🆕 더 광범위한 fallback — segmented control / pill / chip / div[role] 등
    //      단, accordion 내부로 스코프 제한되어 안전함
    if (nodes.length === 0) {
      nodes = collect('button, div[role="button"], div[data-state], span[role="tab"], a[role="tab"]', true);
    }
    // 3) 활성화되지 않은 것만 (이미 active 인 건 제외) — 또는 상태 모름
    const filtered = nodes.filter(el => {
      const aria = (el.getAttribute('aria-checked') || el.getAttribute('aria-selected') || '').toLowerCase();
      const ds = (el.getAttribute('data-state') || '').toLowerCase();
      // checked/active/true 면 이미 활성 → 제외. 그 외에는 (unchecked/inactive/false/모름) 클릭 시도
      const isActive = ds === 'checked' || ds === 'active' || aria === 'true';
      return !isActive;
    });
    return filtered;
  };

  while (rounds < 6) {
    const btns = findCandidates();
    if (btns.length === 0) break;
    btns.forEach(b => { try { b.click(); totalSwitched++; } catch (e) {
      console.warn('[Toss Extractor] tab switch click failed:', e);
    } });
    await sleep(450);
    rounds++;
  }
  // React 렌더링 안정화
  await sleep(400);

  // 검증: 실제로 활성화된 라벨이 무엇인지 로깅 (디버그)
  const activeBtns = Array.from(document.querySelectorAll('button[role="radio"][data-state="checked"], button[role="tab"][aria-selected="true"], button[role="radio"][aria-checked="true"]'));
  const activeLabels = activeBtns.map(b => (b.getAttribute('title') || b.innerText || '').trim()).filter(Boolean);
  console.log(`[Toss Extractor] switchAllTabsTo('${label}'): clicked ${totalSwitched}회, 활성화된 탭=`, activeLabels);
  return totalSwitched;
}

// 보장 페이지의 상품별 보장 상세 테이블 추출
// 🆕 보장 행의 표준 컬럼 순서 — 토스 CRM 표와 동일
//   계약자/피보험자 → 보장 대분류 → 보장 소분류 → 보장명 → 보장 금액 → 납입기간 → 보장시작일 → 보장종료일
const COVERAGE_STD_ORDER = [
  '계약자/피보험자',
  '보장 대분류',
  '보장 소분류',
  '보장명',
  '보장 금액',
  '납입기간',
  '보장시작일',
  '보장종료일'
];

// 표준 순서로 정렬된 새 객체 반환 (JSON 직렬화 시 키 순서 보존)
function _orderedCoverageRow(rowData) {
  const ordered = {
    _상품명: rowData._상품명,
    _보험사명: rowData._보험사명,
    _섹션번호: rowData._섹션번호
  };
  // 🔑 _accordionIdx 는 보장/특약 pass 동일 accordion 묶기에 필수 — 명시적으로 복사
  if (rowData._accordionIdx !== undefined) ordered._accordionIdx = rowData._accordionIdx;
  if (rowData._tabType) ordered._tabType = rowData._tabType;
  COVERAGE_STD_ORDER.forEach(k => {
    if (rowData[k] !== undefined) ordered[k] = rowData[k];
  });
  // 표준 순서에 없는 추가 필드는 뒤에 그대로 보존
  Object.keys(rowData).forEach(k => {
    if (k.startsWith('_')) return;
    if (COVERAGE_STD_ORDER.includes(k)) return;
    if (ordered[k] === undefined) ordered[k] = rowData[k];
  });
  return ordered;
}

// 요소가 실제로 보이는지 검사 (display:none / aria-hidden 등 차단된 경우 제외)
function _isElementVisible(el) {
  if (!el) return false;
  let cur = el;
  while (cur && cur !== document.body) {
    const cs = window.getComputedStyle(cur);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (cur.getAttribute && cur.getAttribute('aria-hidden') === 'true') return false;
    cur = cur.parentElement;
  }
  return true;
}

// 🆕 th 에서 헤더 라벨 추출 — BEM 클래스(.table__header-cell__container__label) 우선, 없으면 th 자체 텍스트
function _thLabel(th) {
  const labelEl = th.querySelector('.table__header-cell__container__label');
  if (labelEl) return (labelEl.innerText || labelEl.textContent || '').trim();
  // 폴백: th 내부 텍스트 (아이콘/버튼 텍스트가 섞일 수 있으나 보장 컬럼명은 보통 단순 텍스트)
  return (th.innerText || th.textContent || '').trim();
}

// 🆕 테이블이 "담보 상세" 테이블인지 헤더 라벨로 판정 (클래스명 변경에 무관)
const _COVERAGE_HEADER_KEYS = ['보장명', '보장 금액', '보장 대분류', '보장 소분류', '납입기간', '보장시작일', '보장종료일'];
function _isCoverageTable(table) {
  const ths = table.querySelectorAll('thead th');
  if (ths.length === 0) return false;
  let hit = 0;
  ths.forEach(th => { const l = _thLabel(th); if (_COVERAGE_HEADER_KEYS.includes(l)) hit++; });
  return hit >= 2;  // 보장 컬럼이 2개 이상이면 담보 상세 테이블로 인정
}

function extractCoverageDetails() {
  // 🆕 클래스명에 의존하지 않고 헤더 라벨로 담보 테이블 식별 (Toss CRM DOM 변경 대응)
  //    1순위: 기존 알려진 클래스, 2순위: 헤더 라벨로 판정한 모든 table
  let allTables = Array.from(document.querySelectorAll('table.table.table--small'));
  if (allTables.length === 0) {
    allTables = Array.from(document.querySelectorAll('table')).filter(_isCoverageTable);
    console.log(`[Toss Extractor] table--small 0개 → 헤더 라벨로 담보 테이블 ${allTables.length}개 식별`);
  }
  const tables = allTables.filter(_isElementVisible);
  console.log(`[Toss Extractor] extractCoverageDetails: 전체 ${allTables.length}개 테이블 중 보이는 ${tables.length}개`);
  const allRows = [];
  const productSummary = []; // 상품별 추출 요약

  // 🆕 페이지 내 모든 accordion 의 안정된 인덱스 맵 — 보장/특약 pass 에서 동일 accordion 식별
  const allAccordions = Array.from(document.querySelectorAll('.p-accordion__item'));

  tables.forEach((table, tableIdx) => {
    // 가장 가까운 accordion 부모 찾기
    const accordion = table.closest('.p-accordion__item');
    const productInfo = extractProductInfoFromAccordion(accordion);
    // 🆕 accordion 의 안정된 인덱스 (DOM 순서) — 보장/특약 pass 사이 동일성 보장
    const accordionIdx = accordion ? allAccordions.indexOf(accordion) : -1;

    // 🆕 헤더 — th 별로 cellIndex(시각적 컬럼 위치) + 라벨 매핑
    //   필터 아이콘/체크박스 등 라벨이 없는 th 는 헤더 목록에서 제외하되, cellIndex 는 보존
    //   → 동일 cellIndex 로 td 를 가져오면 시각적 컬럼이 100% 일치
    const headerInfo = [];
    table.querySelectorAll('thead th').forEach(th => {
      const label = _thLabel(th);
      if (label) headerInfo.push({ colIdx: th.cellIndex, label });
    });
    if (headerInfo.length === 0) return;

    // 🆕 td 에서 텍스트를 안전하게 추출 — innerText 는 sibling/floating 요소를 끌어올 수 있어 옆 컬럼 값이 묻어옴
    //   1순위: .table__cell__container__label (헤더와 동일 BEM 패턴)
    //   2순위: .table__cell__container
    //   3순위: 일반 셀 내부 텍스트만 (input/textarea 의 value 도 인식)
    const extractCellText = (td) => {
      if (!td) return '';
      // input/textarea 값 우선 (편집 가능한 셀 대응)
      const input = td.querySelector('input, textarea');
      if (input && (input.value || '').trim()) return input.value.trim();
      // 라벨 컨테이너 (BEM 우선)
      const label = td.querySelector('.table__cell__container__label');
      if (label) return (label.innerText || label.textContent || '').trim();
      const wrap = td.querySelector('.table__cell__container');
      if (wrap) return (wrap.innerText || wrap.textContent || '').trim();
      // 폴백: td 자체 — 단 자식 아이콘/버튼 텍스트만 있는 경우 빈 값 처리
      const raw = (td.innerText || td.textContent || '').trim();
      return raw;
    };

    // 행 추출 — 클래스(table__row) 우선, 없으면 모든 tbody tr 폴백
    let rows = table.querySelectorAll('tbody tr.table__row');
    if (rows.length === 0) rows = table.querySelectorAll('tbody tr');
    let rowCount = 0;
    rows.forEach(row => {
      const tds = row.cells;   // HTMLCollection — 시각적 컬럼 순서 그대로
      if (!tds || tds.length === 0) return;

      const rowData = {
        _상품명: productInfo.product,
        _보험사명: productInfo.company,
        _섹션번호: tableIdx + 1,
        _accordionIdx: accordionIdx   // 🆕 보장/특약 pass 동일 accordion 묶기
      };
      // 🆕 cellIndex 기반 매핑 — 헤더의 colIdx 위치 td 에서 정확히 추출
      headerInfo.forEach(({ colIdx, label }) => {
        const td = tds[colIdx];
        const text = extractCellText(td);
        if (text) rowData[label] = text;
      });

      if (Object.keys(rowData).length > 3) {
        allRows.push(_orderedCoverageRow(rowData));
        rowCount++;
      }
    });

    if (rowCount > 0) {
      // 계약일 추출: 이 섹션의 모든 담보 행의 보장시작일 중 가장 빠른(=오래된) 날짜
      //   (보장시작일 ≈ 계약일과 매칭되는 경우가 많음)
      const sectionRows = allRows.filter(r => r._섹션번호 === tableIdx + 1);
      const startDates = sectionRows
        .map(r => r['보장시작일'])
        .filter(d => d && /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort();
      const earliestStart = startDates[0] || '';

      productSummary.push({
        섹션번호: tableIdx + 1,
        보험사명: productInfo.company,
        상품명: productInfo.product,
        월납보험료: productInfo.premium || '',
        납입주기: productInfo.payCycle || '',
        보장시작일: earliestStart,
        담보수: rowCount
      });
    }
  });

  return { rows: allRows, summary: productSummary };
}

// 상위표 insurances와 accordion productSummary 매칭 → 보험명 채워넣기
// 매칭 우선순위 (강 → 약):
//   1) 보험사명 + 계약일 (가장 정확)
//   2) 보험사명 + 월납보험료
//   3) 보험사명 + 계약일(연-월만 비교)  -- 일자가 1일 차이 같은 경우 대비
//   4) 보험사명만 (같은 회사에 후보 1개일 때)
function matchInsuranceNamesFromAccordion(insurances, productSummary) {
  if (!insurances || !productSummary || productSummary.length === 0) return 0;
  let matched = 0;
  const usedSections = new Set();
  const matchLog = [];

  const findCandidate = (insCompany, insDate, insPremiumDigits) => {
    // 1차: 보험사 + 계약일 정확 일치
    let c = productSummary.find(p =>
      !usedSections.has(p.섹션번호) &&
      p.보험사명 === insCompany &&
      insDate && p.보장시작일 === insDate
    );
    if (c) return { c, by: 'company+date' };
    // 2차: 보험사 + 월납보험료
    c = productSummary.find(p =>
      !usedSections.has(p.섹션번호) &&
      p.보험사명 === insCompany &&
      insPremiumDigits && p.월납보험료 === insPremiumDigits
    );
    if (c) return { c, by: 'company+premium' };
    // 3차: 보험사 + 계약일 연-월만 비교
    const insYM = (insDate || '').substring(0, 7);
    c = productSummary.find(p =>
      !usedSections.has(p.섹션번호) &&
      p.보험사명 === insCompany &&
      insYM && (p.보장시작일 || '').startsWith(insYM)
    );
    if (c) return { c, by: 'company+ym' };
    // 4차: 보험사 단독 + 후보 1개
    const sameCompany = productSummary.filter(p =>
      !usedSections.has(p.섹션번호) && p.보험사명 === insCompany
    );
    if (sameCompany.length === 1) return { c: sameCompany[0], by: 'company-only' };
    return { c: null, by: 'none' };
  };

  for (const ins of insurances) {
    const currentName = (ins['보험명'] || '').trim();
    if (currentName && currentName !== '보험명 없음') continue;
    const insCompany = (ins['보험사명'] || '').trim();
    const insDate = (ins['계약일'] || '').trim();
    const insPremiumDigits = (ins['월납보험료'] || '').replace(/[^\d]/g, '');
    if (!insCompany) continue;
    const { c: candidate, by } = findCandidate(insCompany, insDate, insPremiumDigits);
    if (candidate) {
      ins['보험명'] = candidate.상품명;
      usedSections.add(candidate.섹션번호);
      matched++;
      matchLog.push(`✓ ${insCompany} (${insDate}) → ${candidate.상품명} [${by}]`);
    } else {
      matchLog.push(`✗ ${insCompany} (${insDate}, ${insPremiumDigits}원) → no accordion match`);
    }
  }
  console.log('[Toss Extractor] 매칭 로그:\n' + matchLog.join('\n'));
  return matched;
}

function detectPageType() {
  const url = window.location.href;
  if (url.includes('/customers/')) return 'customer';
  if (url.includes('/cover/')) return 'coverage';
  // 🆕 "한장으로 보는 보험료 비교" 페이지 — ohmymanager.com 또는 #companyInfo+#bojang_lists 존재
  if (url.includes('ohmymanager.com') || (document.getElementById('companyInfo') && document.getElementById('bojang_lists'))) {
    return 'premium_compare';
  }
  return 'unknown';
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ 📊 보험료 비교 추출 — 한장으로 보는 보험료 비교 페이지(mmlfcp)        ║
// ║   - 보험사: #companyInfo li 들 (코드/이름/총보험료/상품명/플랜)        ║
// ║   - 담보:   #bojang_lists li 들 (cd, 이름, guide_coverage_amount)    ║
// ║   - 보험료: #premium_lists em 들 (company×coverage premium 그리드)    ║
// ╚══════════════════════════════════════════════════════════════════╝
function extractPremiumComparison() {
  const result = { type: 'premium_compare', extractedAt: new Date().toISOString(), companies: [], coverages: [], form: {} };

  // 🆕 mmlfcp 폼 정보 추출 (이름/생년월일/성별/생손보 유형/상품 유형/만기)
  try {
    const formIds = ['cust_name', 'birth_date', 'gender', 'selInsuranceType', 'selProductsGroupCD', 'selPaymentExpirationCD'];
    formIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        result.form[id] = el.value || '';
        // select 의 경우 선택된 텍스트도 같이 보관 (디스플레이 호환)
        if (el.tagName === 'SELECT' && el.selectedIndex >= 0) {
          result.form[id + '_text'] = el.options[el.selectedIndex].textContent.trim();
        }
      }
    });
    // 보험나이 — span#insur_age 텍스트
    const ageSpan = document.getElementById('insur_age');
    if (ageSpan) result.form.insur_age_label = ageSpan.textContent.trim();
    console.log('[Toss Extractor] mmlfcp form 추출:', result.form);
  } catch (e) {
    console.warn('[Toss Extractor] form 추출 실패:', e);
  }

  // ── 보험사 카드 ──
  document.querySelectorAll('#companyInfo li').forEach(li => {
    const chk = li.querySelector('input[type="checkbox"][company_code]');
    if (!chk) return;
    const code = chk.getAttribute('company_code');
    const name = chk.getAttribute('company_name') || '';
    const totalEl = li.querySelector(`#total_${code}`);
    const total  = totalEl ? (parseInt(totalEl.getAttribute('total_premium') || (totalEl.textContent || '').replace(/[^0-9]/g, ''), 10) || 0) : 0;
    const alertBox = li.querySelector('.alert__product-info');
    let productName = '', planInfo = '';
    if (alertBox) {
      const topStrong  = alertBox.querySelector('.alert__top strong');
      const botStrongs = alertBox.querySelectorAll('.alert__bottom strong');
      productName = topStrong ? topStrong.textContent.trim() : '';
      planInfo    = botStrongs[0] ? botStrongs[0].textContent.trim() : '';
    }
    const img = li.querySelector('.img-area img');
    result.companies.push({ code, name, total, productName, planInfo, logoAlt: img ? (img.alt || '') : '' });
  });

  // ── 담보 항목 ──
  document.querySelectorAll('#bojang_lists li').forEach(li => {
    const chk = li.querySelector('input[type="checkbox"][data-cd]');
    if (!chk) return;
    const cd = chk.getAttribute('data-cd');
    const name = chk.getAttribute('coverage_name') || (li.querySelector('label') ? li.querySelector('label').textContent.trim() : '');
    const guide = parseInt(chk.getAttribute('guide_coverage_amount') || '0', 10);
    const valInput = li.querySelector(`#input_${cd}`);
    const value = valInput ? (parseInt(String(valInput.value || '0').replace(/[^0-9]/g, ''), 10) || 0) : 0;
    result.coverages.push({ cd, name, guideAmount: guide, currentValue: value, premiums: {} });
  });

  // ── 보험료 그리드 (회사×담보) ──
  const covIndex = {};
  result.coverages.forEach((c, i) => { covIndex[c.cd] = i; });
  document.querySelectorAll('#premium_lists em[coverage_cd][company_code]').forEach(em => {
    const cd = em.getAttribute('coverage_cd');
    const co = em.getAttribute('company_code');
    const pr = parseInt(em.getAttribute('premium') || '0', 10) || 0;
    const idx = covIndex[cd];
    if (idx != null && co) result.coverages[idx].premiums[co] = pr;
  });

  return result;
}

// 🆕 한장으로 보는 보험료 비교 페이지 폼에 설정 자동 입력 (생손보/상품/만기/담보)
//   cfg = { insType, prodType, maturity, coverages: ['암진단비(유사암제외)', ...] }
function applyConfigToPremiumPage(cfg) {
  const result = { ok: true, applied: {} };
  if (!cfg) return result;
  // ── 생손보 유형 ──
  if (cfg.insType) {
    const el = document.getElementById('selInsuranceType');
    if (el) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(el, cfg.insType);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      result.applied['생손보 유형'] = cfg.insType;
    }
  }
  // ── 상품 유형 ──
  if (cfg.prodType) {
    const el = document.getElementById('selProductsGroupCD');
    if (el) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(el, cfg.prodType);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      result.applied['상품 유형'] = cfg.prodType;
    }
  }
  // ── 만기 ──
  if (cfg.maturity) {
    const el = document.getElementById('selPaymentExpirationCD');
    if (el) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(el, cfg.maturity);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      result.applied['만기'] = cfg.maturity;
    }
  }
  // ── 담보 체크박스 자동 선택 ──
  //   페이지의 모든 coverage 체크박스 검사 → coverage_name 이 cfg.coverages 와 일치하면 check
  if (Array.isArray(cfg.coverages) && cfg.coverages.length > 0) {
    const wanted = new Set(cfg.coverages.map(s => String(s || '').replace(/\s+/g, '').trim()));
    const checks = document.querySelectorAll('input[type="checkbox"][data-cd], input[type="checkbox"][coverage_name]');
    let matched = 0;
    checks.forEach(cb => {
      const name = cb.getAttribute('coverage_name') || cb.value || '';
      const norm = String(name).replace(/\s+/g, '').trim();
      if (wanted.has(norm)) {
        if (!cb.checked) cb.click();   // click 으로 click 이벤트도 발화
        matched++;
      }
    });
    result.applied['담보'] = `${matched}/${cfg.coverages.length} 선택됨`;
  }
  console.log('[Toss Extractor] 보험료 비교 페이지 설정 적용:', result);
  return result;
}
window.__applyConfigToPremiumPage = applyConfigToPremiumPage;

// 🆕 한장으로 보는 보험료 비교 페이지 폼에 고객 정보 자동 입력
//   타깃 셀렉터: #cust_name(이름) / #birth_date(YYYYMMDD) / #gender(M/F)
//   사용자가 보험료 비교 페이지로 이동한 뒤 확장프로그램 적용 버튼 → 이 함수 호출
function applyCustomerToPremiumPage(customer) {
  if (!customer) return { ok: false, error: 'customer 없음' };
  const result = { ok: true, filled: {} };
  // ── 이름 ──
  const nameEl = document.getElementById('cust_name');
  const name = customer['고객명'] || customer['_고객명'];
  if (nameEl && name) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(nameEl, name);
    nameEl.dispatchEvent(new Event('input', { bubbles: true }));
    nameEl.dispatchEvent(new Event('change', { bubbles: true }));
    result.filled['이름'] = name;
  }
  // ── 생년월일 (YYYYMMDD 8자리) ──
  const birthEl = document.getElementById('birth_date');
  let birthRaw = customer['생년월일'] || '';
  if (birthEl && birthRaw) {
    // 다양한 입력 포맷 정규화: "1985-01-01", "1985.01.01", "850101", "1985년 1월 1일" 등
    let digits = String(birthRaw).replace(/[^\d]/g, '');
    if (digits.length === 6) {
      // YY → YYYY 보정 (24 이하면 20XX, 그 외 19XX)
      const yy = parseInt(digits.slice(0, 2), 10);
      const yyyy = yy <= 24 ? 2000 + yy : 1900 + yy;
      digits = `${yyyy}${digits.slice(2)}`;
    }
    if (digits.length === 8) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(birthEl, digits);
      birthEl.dispatchEvent(new Event('input', { bubbles: true }));
      birthEl.dispatchEvent(new Event('change', { bubbles: true }));
      result.filled['생년월일'] = digits;
    } else {
      result.filled['생년월일'] = `(스킵: 형식 변환 실패, ${birthRaw})`;
    }
  }
  // ── 성별 ──
  const genderEl = document.getElementById('gender');
  const gender = customer['성별'] || '';
  if (genderEl && gender) {
    // "남성"/"남"/"M"/"male" → M, "여성"/"여"/"F"/"female" → F
    const isMale = /남|^M$|male/i.test(String(gender));
    const isFemale = /여|^F$|female/i.test(String(gender));
    const code = isMale ? 'M' : (isFemale ? 'F' : '');
    if (code) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(genderEl, code);
      genderEl.dispatchEvent(new Event('change', { bubbles: true }));
      result.filled['성별'] = `${gender} (${code})`;
    }
  }
  console.log('[Toss Extractor] 보험료 비교 페이지 폼 자동 입력:', result);
  return result;
}
// 전역 노출 — popup.js 가 chrome.scripting.executeScript 로 호출
window.__applyCustomerToPremiumPage = applyCustomerToPremiumPage;

// 🆕 보험료 비교 페이지 통합 자동 입력 — popup 에서 sendMessage 로 호출
//   payload: { customer, cfg, clickSearch, applyCoverages }
async function applyToPremiumFormUnified(payload) {
  const out = { ok: false, filled: {}, applied: {}, location: location.href, steps: [] };
  const t0 = Date.now();
  const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
  // 🆕 진행 상황 시각화 — 우상단 status 박스 (작업 끝날 때까지 유지)
  let statusBox = null;
  const updateStatus = (msg, color = '#3182f6') => {
    try {
      if (!statusBox) {
        statusBox = document.createElement('div');
        statusBox.id = '__tossExtStatus';
        statusBox.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;background:#3182f6;color:#fff;padding:12px 18px;border-radius:8px;font-size:13px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.3);min-width:280px;max-width:380px;line-height:1.4;';
        document.body.appendChild(statusBox);
      }
      statusBox.style.background = color;
      statusBox.innerHTML = `<div style="font-size:11px;opacity:0.85;margin-bottom:2px;">${elapsed()}</div>${msg}`;
    } catch {}
    out.steps.push({ t: elapsed(), msg });
  };
  const logStep = (msg) => { console.log(`[Toss Extractor] [${elapsed()}] ${msg}`); updateStatus(msg); };

  try {
    logStep('🔌 자동입력 시작');
    console.log('[Toss Extractor] payload:', payload);

    // 폼 요소 등장 대기 헬퍼 (최대 15초)
    const waitForEl = async (id, requireOptions = false, maxMs = 10000) => {
      const start = Date.now();
      while (Date.now() - start < maxMs) {
        const el = document.getElementById(id);
        if (el && (!requireOptions || (el.options && el.options.length > 0))) return el;
        await new Promise(r => setTimeout(r, 200));
      }
      return null;
    };

    const setInputVal = (el, val) => {
      if (!el) return false;
      try {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, val);
      } catch { el.value = val; }
      try {
        el.dispatchEvent(new Event('focus', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      } catch {}
      try { if (window.jQuery) window.jQuery(el).val(val).trigger('change').trigger('input'); } catch {}
      const final = el.value;
      console.log(`[Toss Extractor] setInputVal ${el.id}: target=${val}, final=${final}`);
      return final === String(val);
    };
    const setSelectVal = (el, val) => {
      if (!el || !el.options || el.options.length === 0) return false;
      const hasOption = Array.from(el.options).some(o => o.value === String(val));
      if (!hasOption) {
        const byText = Array.from(el.options).find(o => (o.textContent || '').trim() === String(val).trim());
        if (byText) val = byText.value; else return false;
      }
      // 1) selectedIndex 와 value 동시 설정
      let targetIdx = -1;
      for (let i = 0; i < el.options.length; i++) {
        if (el.options[i].value === String(val)) { targetIdx = i; break; }
      }
      if (targetIdx >= 0) el.selectedIndex = targetIdx;
      // 2) 네이티브 setter 로 value 설정 + 옵션 selected 속성 명시
      try {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(el, val);
      } catch { el.value = val; }
      Array.from(el.options).forEach((o, i) => { o.selected = (i === targetIdx); });
      // 3) 풍부한 이벤트 시퀀스 — 일부 페이지는 focus/blur/mousedown 등 필요
      try {
        el.dispatchEvent(new Event('focus', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      } catch {}
      // 4) jQuery change (페이지가 jQuery 사용 시)
      try { if (window.jQuery) window.jQuery(el).val(val).trigger('change'); } catch {}
      // 5) 검증 — 실제 값이 반영됐는지 확인
      const final = el.value;
      console.log(`[Toss Extractor] setSelectVal ${el.id}: target=${val}, final=${final}, idx=${el.selectedIndex}, options=${el.options.length}`);
      return final === String(val);
    };


    const cust = payload.customer || {};
    const cfg = payload.cfg || {};
    console.log('[Toss Extractor] 🧑 customer 객체:', cust, '키:', Object.keys(cust));

    // 핵심 요소 등장 대기
    logStep('🔍 폼 요소 등장 대기 (최대 10초)…');
    const anchor = await waitForEl('cust_name', false, 10000) || await waitForEl('selInsuranceType', false, 3000);
    if (!anchor) {
      out.error = '폼 요소 미발견 (cust_name/selInsuranceType 모두 없음)';
      logStep('❌ 폼 미발견 — 페이지 구조 다름');
      statusBox && (statusBox.style.background = '#dc2626');
      setTimeout(() => statusBox?.remove(), 8000);
      return out;
    }
    logStep(`✅ 폼 발견: ${anchor.id}`);

    // ── 이름 — 다양한 키 시도 ──
    const nameEl = document.getElementById('cust_name');
    const name = cust['고객명'] || cust['이름'] || cust['_고객명'] || cust.name || cust.customerName || '';
    logStep(`👤 이름 입력 시도 — el:${!!nameEl}, value:"${name}"`);
    if (nameEl && name) {
      setInputVal(nameEl, name);
      out.filled['이름'] = name;
      out.ok = true;
    } else if (nameEl) {
      logStep('⚠️ 이름 스킵 — customer 데이터에 이름 없음');
    }
    // ── 생년월일 — 다양한 키 시도 ──
    const birthEl = document.getElementById('birth_date');
    let birthRaw = cust['생년월일'] || cust['birthDate'] || cust['birth'] || cust['주민번호'] || '';
    // 주민번호에서 생년월일 추출 — 앞 6자리
    if (birthRaw && birthRaw.length >= 6 && /^\d/.test(birthRaw)) {
      const justDigits = String(birthRaw).replace(/[^\d]/g, '');
      if (justDigits.length >= 7) {
        // 주민번호 패턴 (YYMMDD-X...) 또는 YYYYMMDD
        birthRaw = justDigits.length >= 8 ? justDigits.slice(0, 8) : justDigits.slice(0, 6);
        // 주민번호의 7번째 자리로 성별 판별 가능 (1,3 남자 / 2,4 여자)
      }
    }
    logStep(`📅 생년월일 입력 시도 — el:${!!birthEl}, raw:"${birthRaw}"`);
    if (birthEl && birthRaw) {
      let digits = String(birthRaw).replace(/[^\d]/g, '');
      if (digits.length === 6) {
        const yy = parseInt(digits.slice(0, 2), 10);
        digits = `${yy <= 24 ? 2000 + yy : 1900 + yy}${digits.slice(2)}`;
      }
      if (digits.length >= 8) {
        digits = digits.slice(0, 8);
        setInputVal(birthEl, digits);
        out.filled['생년월일'] = digits;
        out.ok = true;
      } else {
        logStep(`⚠️ 생년월일 형식 변환 실패: ${digits}`);
      }
    } else if (birthEl) {
      logStep('⚠️ 생년월일 스킵 — customer 데이터에 생년월일 없음');
    }
    // ── 성별 — 주민번호로도 시도 ──
    const genderEl = document.getElementById('gender');
    let gender = cust['성별'] || cust['gender'] || '';
    // 주민번호에서 성별 추출 (7번째 자리)
    if (!gender && cust['주민번호']) {
      const ssn = String(cust['주민번호']).replace(/[^\d]/g, '');
      if (ssn.length >= 7) {
        const code = ssn[6];
        if (['1','3','5','7'].includes(code)) gender = '남성';
        else if (['2','4','6','8'].includes(code)) gender = '여성';
      }
    }
    logStep(`⚥ 성별 입력 시도 — el:${!!genderEl}, value:"${gender}"`);
    if (genderEl && gender) {
      const code = /남|^M$|male/i.test(gender) ? 'M' : (/여|^F$|female/i.test(gender) ? 'F' : '');
      if (code) {
        setSelectVal(genderEl, code);
        out.filled['성별'] = `${gender} (${code})`;
        out.ok = true;
        console.log('[Toss Extractor] ✅ 성별:', code);
      }
    }
    // ── 생손보 유형 / 상품 유형 / 만기 — cascading selects ──
    //   insType 변경 시 prodType 옵션이 페이지 JS 로 재로딩됨 → 각 변경 후 대기 필수
    //   prodType 변경 시 maturity 옵션도 재로딩될 수 있음

    // 옵션 안정화 대기 — 특정 value 가 옵션에 나타날 때까지 (최대 5초)
    const waitForOption = async (selectId, targetValue, maxMs = 5000) => {
      const start = Date.now();
      while (Date.now() - start < maxMs) {
        const el = document.getElementById(selectId);
        if (el && el.options && Array.from(el.options).some(o => o.value === String(targetValue))) return el;
        await new Promise(r => setTimeout(r, 150));
      }
      return document.getElementById(selectId);  // 못 찾아도 일단 반환
    };

    // 🆕 [버그수정] 종속 select 안정화 헬퍼 — 값을 설정한 뒤, 페이지 JS(renderPlanOptions 등)가
    //   비동기로 값을 '첫 번째'로 되돌리는 race 를 흡수한다. 설정→대기→검증, 어긋나면 재시도.
    //   ※ 근본 원인: selInsuranceType 의 change 핸들러가 selProductsGroupCD 를 무조건 첫 옵션으로 리셋함.
    const setSelectStable = async (id, val, label, settleMs = 700, tries = 4) => {
      let lastVal = null;
      for (let i = 0; i < tries; i++) {
        const el = await waitForOption(id, val, 2500);
        if (!el || !el.options || el.options.length === 0) { lastVal = '(옵션없음)'; await new Promise(r => setTimeout(r, 300)); continue; }
        setSelectVal(el, val);
        await new Promise(r => setTimeout(r, settleMs));   // 페이지의 비동기 리셋이 끝나길 대기
        lastVal = el.value;
        if (lastVal === String(val)) {
          logStep(`✅ ${label}: ${val} (OK, ${i + 1}회)`);
          return { ok: true, finalVal: lastVal, tries: i + 1 };
        }
        logStep(`↻ ${label} 되돌려짐(${lastVal}≠${val}) — 재설정 ${i + 1}/${tries}`);
      }
      logStep(`⚠️ ${label}: ${val} 고정 실패 (현재=${lastVal})`);
      return { ok: false, finalVal: lastVal, tries };
    };

    // ── 생손보 유형 ──
    //   이미 원하는 값이면 change 를 다시 쏘지 않는다(불필요한 상품유형 리셋 방지).
    if (cfg.insType) {
      const insEl = await waitForOption('selInsuranceType', cfg.insType, 3000);
      if (insEl) {
        if (insEl.value === String(cfg.insType)) {
          logStep(`✅ 생손보 유형: ${cfg.insType} (이미 설정됨 — change 생략)`);
          out.applied['생손보 유형'] = `${cfg.insType} (유지)`;
        } else {
          const r = await setSelectStable('selInsuranceType', cfg.insType, '생손보 유형', 800);
          out.applied['생손보 유형'] = `${cfg.insType}${r.ok ? '' : ' [실패]'}`;
          // 생손보가 바뀌면 상품유형이 자동 리셋되므로 충분히 더 대기
          await new Promise(r => setTimeout(r, 400));
        }
        out.ok = true;
      }
    }
    // 🆕 [버그수정] 생손보(LF)/손보(F) 는 상품유형·만기 코드 체계가 완전히 다름.
    //   예) 손보 만기 '20년/100세'=01 / 생손보 만기 '20년/100세,종신'=06,
    //       손보 상품 '종합무해지'=06 / 생손보 상품 '건강무해지'=01.
    //   cfg 기본값은 손보(F) 코드라, 생손보 페이지에 그대로 넣으면 옵션에 없어서 전부 실패함.
    //   → 코드가 현재 select 옵션에 없으면, '옵션 텍스트(의미)'로 best-match 해서 value 를 보정한다.
    const resolveCodeByText = (selectId, wantedCode, kind) => {
      const el = document.getElementById(selectId);
      if (!el || !el.options || el.options.length === 0) return wantedCode;
      // 1) 코드가 이미 옵션에 있으면 그대로
      if (Array.from(el.options).some(o => o.value === String(wantedCode))) return wantedCode;
      // 2) cfg UI 라벨(손보 기준)에서 핵심 의미어 추출 → 현재 옵션 텍스트와 매칭
      //    만기: '100세'/'90세'/'80세'/'갱신' + 납입년수(20년/30년) 우선
      //    상품: '종합','건강','간편3.3.5','실손','치아','운전자','어린이','여성' 등 핵심어
      const optTexts = Array.from(el.options).map(o => ({ v: o.value, t: (o.textContent || '').replace(/\s/g, '') }));
      let pick = null;
      if (kind === 'maturity') {
        // 손보 코드→의미 매핑
        const matMeaning = { '01':'100세','03':'80세','04':'90세','02':'갱신','07':'30년80세','08':'30년90세','09':'30년100세' };
        const key = matMeaning[String(wantedCode)] || '100세';
        // 납입년수 포함 키워드 우선 매칭 → 안되면 만기연령만
        const ageOnly = key.replace(/^\d+년/, '');
        pick = optTexts.find(o => o.t.includes(key)) || optTexts.find(o => o.t.includes(ageOnly));
      } else {
        // 상품유형 — 손보 코드→핵심어
        const prodMeaning = {
          '06':'종합','05':'종합','07':'5.10.10','08':'여성','14':'간편3.2.5','15':'간편3.3.5',
          '16':'간편3.5.5','17':'간편3.10.10','23':'실손','24':'간편실손','26':'치아','28':'운전자',
          '18':'어린이','19':'어린이','30':'치매'
        };
        const key = prodMeaning[String(wantedCode)] || '종합';
        pick = optTexts.find(o => o.t.includes(key));
        // 종합 못 찾으면 '건강'(생손보 기본 상품명)으로 폴백
        if (!pick) pick = optTexts.find(o => o.t.includes('건강')) || optTexts.find(o => o.t.includes('종합'));
        // 그래도 없으면 첫 옵션
        if (!pick) pick = optTexts[0];
      }
      if (pick) {
        console.log(`[Toss Extractor] 🔁 ${kind} 코드 보정: ${wantedCode} → ${pick.v}(${pick.t}) [현재 생손보/손보 체계]`);
        return pick.v;
      }
      return wantedCode;
    };

    // ── 상품 유형 ── (생손보 리셋을 흡수하도록 verify-retry + 코드 체계 보정)
    if (cfg.prodType) {
      const wantProd = resolveCodeByText('selProductsGroupCD', cfg.prodType, 'product');
      logStep(`📋 상품 유형 (${cfg.prodType}${wantProd !== cfg.prodType ? '→' + wantProd : ''}) 설정…`);
      const r = await setSelectStable('selProductsGroupCD', wantProd, '상품 유형', 750);
      const el = document.getElementById('selProductsGroupCD');
      out.applied['상품 유형'] = `${wantProd}${r.ok ? '' : ' [실패-현재' + r.finalVal + '] 옵션=' + (el ? Array.from(el.options).map(o => o.value).join(',') : '')}`;
      out.ok = true;
    }
    // ── 만기 ── (상품유형 변경이 만기 옵션을 갈아끼울 수 있으므로 역시 verify-retry + 코드 보정)
    if (cfg.maturity) {
      const wantMat = resolveCodeByText('selPaymentExpirationCD', cfg.maturity, 'maturity');
      logStep(`📋 만기 (${cfg.maturity}${wantMat !== cfg.maturity ? '→' + wantMat : ''}) 설정…`);
      const r = await setSelectStable('selPaymentExpirationCD', wantMat, '만기', 500);
      const el = document.getElementById('selPaymentExpirationCD');
      out.applied['만기'] = `${wantMat}${r.ok ? '' : ' [실패-현재' + r.finalVal + '] 옵션=' + (el ? Array.from(el.options).map(o => o.value).join(',') : '')}`;
      out.ok = true;
    }

    // 조회하기 클릭
    if (payload.clickSearch) {
      logStep('🔎 조회하기 버튼 찾는 중…');
      await new Promise(r => setTimeout(r, 400));
      let btn = document.getElementById('btn_search');
      if (!btn) {
        btn = Array.from(document.querySelectorAll('button, a, input[type=button], input[type=submit]'))
          .find(el => /조회|검색/i.test((el.innerText || el.textContent || el.value || '').trim()));
      }
      if (btn) {
        btn.click();
        out.applied['조회하기'] = '클릭됨';
        logStep('✅ 조회하기 클릭 — 결과 로드 3.5초 대기');
        await new Promise(r => setTimeout(r, 3500));
      } else {
        out.applied['조회하기'] = '버튼 못 찾음';
        logStep('⚠️ 조회하기 버튼 못 찾음');
      }
    }

    // 담보 체크 + 금액 입력
    //   우선순위: payload.productCoverages (상품에서 추출한 담보+금액) > cfg.coverages (팝업 체크 목록)
    if (payload.applyCoverages) {
      const normalize = (s) => String(s || '').replace(/[\s·,\.\-_/\\()\[\]]/g, '').toLowerCase().trim();
      // 추출된 담보명에서 표준명만 추출 — "암진단/주계약" → "암진단", "고액암진단/고액치료비암..." → "고액암진단"
      //   slash 앞에 있는 부분이 mmlfcp 의 담보 표준명과 매칭되기 쉬움
      const extractStandardName = (raw) => {
        if (!raw) return '';
        const s = String(raw);
        const slashed = s.split('/')[0];
        const cleaned = slashed.replace(/\[[^\]]*\]/g, '').replace(/\([^\)]*\)/g, '').trim();
        return cleaned || slashed.trim() || s.trim();
      };
      // 다양한 매칭 후보 생성
      //   ⚠️ raw 전체를 normalize 하면 "유병자질병사망/주계약" → "유병자질병사망주계약" 이 되어
      //      mmlfcp "주계약" 체크박스에 substring 오매칭됨. slash 뒷부분(대분류/주계약 구분)은 제거.
      const candidateKeys = (raw) => {
        const std = extractStandardName(raw);
        const rawHead = String(raw || '').split('/')[0];   // slash 앞부분만
        const keys = new Set();
        keys.add(normalize(rawHead));
        keys.add(normalize(std));
        keys.add(normalize(std.replace(/(특약|보장|진단비|진단)$/, '')));
        return Array.from(keys).filter(k => k.length > 1);
      };
      // 금액 텍스트 정규화 — "1,000만원" / "10,000,000" / "1000" 등을 "만원 단위 정수" 로
      const parseAmount = (raw) => {
        if (!raw) return null;
        const s = String(raw).replace(/[^\d만원]/g, '');
        if (!s) return null;
        // "1000만원" → 1000, "10000000" (원) → 1000 만원
        const numericOnly = s.replace(/[^\d]/g, '');
        if (!numericOnly) return null;
        const num = parseInt(numericOnly, 10);
        if (/만원/.test(String(raw)) || /만/.test(String(raw))) {
          return num;  // 이미 만원 단위
        }
        // 원 단위면 만원으로 변환
        if (num >= 10000) return Math.round(num / 10000);
        return num;
      };

      let target = [];
      if (Array.isArray(payload.productCoverages) && payload.productCoverages.length > 0) {
        target = payload.productCoverages.map(c => ({
          name: c.name,
          keys: candidateKeys(c.name),
          standardName: extractStandardName(c.name),
          amount: parseAmount(c.amount),
          rawAmount: c.amount
        }));
        console.log('[Toss Extractor] 상품에서 담보+금액 사용:', target);
      } else if (Array.isArray(cfg.coverages) && cfg.coverages.length > 0) {
        target = cfg.coverages.map(n => ({ name: n, keys: candidateKeys(n), standardName: n, amount: null }));
        console.log('[Toss Extractor] cfg.coverages 사용:', target);
      }

      // 🆕 통합담보 합산 규칙 — 원본에선 분리(뇌혈관수술 / 심장수술 각각)됐지만
      //   mmlfcp 에선 1칸으로 통합된 담보. 분리담보 금액을 합산 후 op 적용해 통합담보 1건으로 대체.
      //   예: 뇌혈관질환수술(2000) + 허혈성심장질환수술(2000) = 4000 ÷2 → "뇌혈관질환및허혈성심장질환수술비" 2000
      const COMBINE_RULES = [
        {
          targetName: '뇌혈관질환및허혈성심장질환수술비',
          sourceMatchers: [/뇌혈관.*수술/, /(허혈성)?심장(질환)?.*수술/],
          op: 'sumHalf'
        }
      ];
      COMBINE_RULES.forEach(rule => {
        const srcs = target.filter(t => {
          const nm = t.standardName || t.name || '';
          return rule.sourceMatchers.some(rx => rx.test(nm));
        });
        if (srcs.length >= 2) {  // 분리담보가 2개 이상 있을 때만 통합
          const sum = srcs.reduce((s, t) => s + (t.amount || 0), 0);
          const val = rule.op === 'sumHalf' ? Math.round(sum / 2) : sum;
          target = target.filter(t => !srcs.includes(t));
          target.push({
            name: rule.targetName,
            keys: candidateKeys(rule.targetName),
            standardName: rule.targetName,
            amount: val,
            rawAmount: String(val) + '만원',
            _combined: true
          });
          console.log(`[Toss Extractor] 🔗 통합담보 합산: ${srcs.map(t => `${t.standardName}(${t.amount||0})`).join(' + ')} = ${sum} ÷2 → "${rule.targetName}" ${val}만원`);
        }
      });

      // 🆕 "1-5종 수술비"(질병/상해 종수술) — 1종~5종 여러 건 중 '5종' 또는 최대 금액 1건만 입력.
      //   예: 질병1-5종수술비(1종~5종) → 5종(또는 최대 금액)만 mmlfcp '질병종수술' 칸에 입력.
      const _parse15 = (nm) => {
        const s = String(nm || '');
        // "1-5종수술" 패턴 + 끝의 "(N종)" 종번호
        if (!/1\s*[-~]\s*5\s*종\s*수술/.test(s)) return null;
        const jm = s.match(/\(?\s*([1-5])\s*종\s*\)?\s*$/) || s.match(/([1-5])\s*종/g);
        let jong = 0;
        const m2 = s.match(/\(\s*([1-5])\s*종\s*\)/);
        if (m2) jong = parseInt(m2[1]);
        // 그룹 기준명 = 종번호/괄호 제거
        const base = s.replace(/\(\s*[1-5]\s*종\s*\)/g, '').replace(/\s+/g, '');
        return { base, jong };
      };
      const _g15 = {};
      target.forEach(t => {
        const info = _parse15(t.name || t.standardName);
        if (info) {
          if (!_g15[info.base]) _g15[info.base] = [];
          _g15[info.base].push({ t, jong: info.jong });
        }
      });
      Object.keys(_g15).forEach(base => {
        const arr = _g15[base];
        if (arr.length < 2) return;
        // 5종 우선, 없으면 최대 금액
        let keep = arr.find(x => x.jong === 5);
        if (!keep) keep = arr.reduce((a, b) => ((b.t.amount || 0) > (a.t.amount || 0) ? b : a));
        const removeSet = new Set(arr.filter(x => x !== keep).map(x => x.t));
        target = target.filter(t => !removeSet.has(t));
        console.log(`[Toss Extractor] 🔢 1-5종 수술비 통합: ${arr.length}건 중 "${keep.t.name}"(${keep.jong ? keep.jong + '종' : '최대'} ${keep.t.amount || 0}만원)만 입력`);
      });

      // 🆕 질병종/상해종 수술비(1-5종 5종) — 유형별로 다른 칸에 입력:
      //   - 생손보(LF)/생보(L): "질병상해(1~5종)수술(5종기준)" 통합 칸 1개 (질병>상해→질병값 / 상해크면 (질병+상해)÷2)
      //   - 손보(F): "질병(1~5종)수술비 (5종기준)" / "상해(1~5종)수술비 (5종기준)" 각각 칸에 5종 금액 그대로
      (() => {
        const _insType = (payload.cfg && payload.cfg.insType) || '';
        const _isSonbo = (_insType === 'F');
        const _isSurg = (nm, kind) => {
          const s = String(nm || '');
          if (/뇌|심장|허혈/.test(s)) return false;       // 뇌·심장 통합 담보는 별도 처리됨 → 제외
          return new RegExp(kind + '[^]{0,4}수술').test(s);
        };
        // 질병/상해 수술 담보 중 110/200 이상(=종수술 인식)인 것들 중 최대 금액
        const jilCands = target.filter(t => _isSurg(t.standardName || t.name, '질병') && (t.amount || 0) >= 110);
        const sangCands = target.filter(t => _isSurg(t.standardName || t.name, '상해') && (t.amount || 0) >= 200);
        const jil = jilCands.length ? jilCands.reduce((a, b) => ((b.amount || 0) > (a.amount || 0) ? b : a)) : null;
        const sang = sangCands.length ? sangCands.reduce((a, b) => ((b.amount || 0) > (a.amount || 0) ? b : a)) : null;
        const jAmt = jil ? (jil.amount || 0) : 0;
        const sAmt = sang ? (sang.amount || 0) : 0;
        if (!jil && !sang) return;

        if (_isSonbo) {
          // 손보: 질병/상해 각각 칸
          if (jil) {
            const NM = '질병(1~5종)수술비 (5종기준)';
            target = target.filter(t => t !== jil);
            target.push({ name: NM, keys: candidateKeys(NM), standardName: NM, amount: jAmt, rawAmount: jAmt + '만원', _combined: true });
          }
          if (sang) {
            const NM = '상해(1~5종)수술비 (5종기준)';
            target = target.filter(t => t !== sang);
            target.push({ name: NM, keys: candidateKeys(NM), standardName: NM, amount: sAmt, rawAmount: sAmt + '만원', _combined: true });
          }
          console.log(`[Toss Extractor] 🔢 손보 — 질병종 ${jAmt}만→"질병(1~5종)수술비" / 상해종 ${sAmt}만→"상해(1~5종)수술비" 각각`);
        } else {
          // 생손보/생보: 통합 칸 1개
          const val = (jAmt > sAmt) ? jAmt : Math.round((jAmt + sAmt) / 2);
          target = target.filter(t => t !== jil && t !== sang);
          const NM = '질병상해(1~5종)수술(5종기준)';
          target.push({ name: NM, keys: candidateKeys(NM), standardName: NM, amount: val, rawAmount: val + '만원', _combined: true });
          console.log(`[Toss Extractor] 🔗 생손보/생보 통합: 질병 ${jAmt}만 / 상해 ${sAmt}만 → "${NM}" ${val}만원 (${jAmt > sAmt ? '질병값' : '평균값'})`);
        }
      })();

      // 🆕 매칭 제외 담보 — '주계약' 칸은 항상 비움(사용자 요청). 원본 '주계약' 담보 제거.
      const _excludeName = (nm) => /^주계약$/.test(String(nm || '').trim());
      const _beforeExclude = target.length;
      target = target.filter(t => {
        if (_excludeName(t.standardName) || _excludeName(t.name)) {
          console.log(`[Toss Extractor] ⏭️ 제외(주계약 칸 미사용): "${t.standardName || t.name}"`);
          return false;
        }
        return true;
      });
      if (_beforeExclude !== target.length) out.applied['제외'] = `주계약 ${_beforeExclude - target.length}건`;

      if (target.length > 0) {
        const checks = document.querySelectorAll('input[type="checkbox"][data-cd], input[type="checkbox"][coverage_name], input[type="checkbox"][id^="chk_"]');

        // 🆕 플랜이 자동 체크해둔 '담보 체크박스'만 해제 — 깨끗한 상태에서 원하는 담보만 입력.
        //   ⚠️ 보험사명 위 체크박스(회사 선택 → 보험료 표시)는 절대 건드리지 않는다. 어떤 상태에서도 유지.
        //      checks 셀렉터(data-cd / coverage_name / id^=chk_)는 '담보' 체크박스만 매칭하므로 안전.
        //   (이전의 '전체선택 토글'은 보험사 체크박스까지 해제해 보험료가 0이 되던 버그 → 제거)
        let _uncheckedCnt = 0;
        Array.from(checks).forEach(cb => {
          // 🛡️ 담보 고유 속성(coverage_name/data-cd)이 있는 것만 해제 — 보험사 체크박스(이 속성 없음) 보호.
          //    (손보 페이지의 보험사 체크박스가 chk_ id 로 잡혀 함께 해제되던 버그 차단)
          const isDamboCb = cb.getAttribute('coverage_name') || cb.getAttribute('data-cd');
          if (cb.checked && isDamboCb) { cb.click(); _uncheckedCnt++; }
        });
        if (_uncheckedCnt > 0) {
          out.applied['기존체크 해제'] = `담보 ${_uncheckedCnt}개`;
          console.log(`[Toss Extractor] ☐ 담보 체크박스 ${_uncheckedCnt}개만 해제 (보험사 체크박스는 유지)`);
          await new Promise(r => setTimeout(r, 300));  // 해제 반영 대기
        }

        // 페이지의 모든 체크박스명을 미리 normalize 해두기
        //   🆕 mmlfcp '주계약' 체크박스도 후보에서 제외 — 다른 담보가 주계약 칸에 substring 오매칭되는 것 차단
        const checkInfo = Array.from(checks).map(cb => ({
          cb,
          cname: cb.getAttribute('coverage_name') || cb.value || '',
          cnameNorm: normalize(cb.getAttribute('coverage_name') || cb.value || '')
        })).filter(ci => (ci.cname || '').trim() !== '주계약');
        let matched = 0, amountsFilled = 0;
        const matchedNames = [];
        const unmatched = [];
        // 🆕 학습된 매핑 로드 — chrome.storage.sync 라 같은 Chrome 계정으로 로그인된 모든 컴퓨터에서 공유된다.
        //   구조: { [추출담보 표준명]: 폼담보 coverage_name }  ('__SKIP__' = 연결 안 함)
        const LEARN_KEY = 'tossCovMap_v1';
        const learnMap = await new Promise(res => {
          try { chrome.storage.sync.get(LEARN_KEY, d => res((d && d[LEARN_KEY]) || {})); }
          catch (e) { res({}); }
        });
        // 🆕 이미 매칭된 체크박스는 다른 담보가 재사용하지 못하도록 — 한 칸에 여러 담보 뭉침 방지
        const usedCbs = new Set();
        // 1단계: 완전일치를 전체 target 에 먼저 적용 (정확매칭 우선권 확보 → substring 과매칭이 정확매칭 칸 가로채기 방지)
        const pending = [];
        target.forEach(t => {
          // 0단계: 학습된 매핑 우선 — 사용자가 패널에서 지정한 폼 담보로 강제 연결한다.
          const _learned = learnMap[t.standardName] || learnMap[t.name];
          if (_learned) {
            if (_learned === '__SKIP__') { t._skip = true; return; }  // '연결 안 함' 지정
            const ci = checkInfo.find(c => !usedCbs.has(c.cb) && c.cname === _learned);
            if (ci) { usedCbs.add(ci.cb); t._found = ci; t._byLearn = true; return; }
          }
          let foundInfo = null;
          for (const key of t.keys) {
            foundInfo = checkInfo.find(ci => !usedCbs.has(ci.cb) && ci.cnameNorm === key);
            if (foundInfo) break;
          }
          if (foundInfo) { usedCbs.add(foundInfo.cb); t._found = foundInfo; }
          else pending.push(t);
        });
        // 2단계: 남은 담보는 substring 양방향 매칭 (이미 쓰인 체크박스 제외)
        pending.forEach(t => {
          let foundInfo = null;
          for (const key of t.keys) {
            if (key.length < 3) continue;
            foundInfo = checkInfo.find(ci => !usedCbs.has(ci.cb) && (
              ci.cnameNorm.includes(key) || (key.length >= ci.cnameNorm.length && key.includes(ci.cnameNorm) && ci.cnameNorm.length >= 3)
            ));
            if (foundInfo) break;
          }
          if (foundInfo) { usedCbs.add(foundInfo.cb); t._found = foundInfo; }
        });
        // 금액 input 찾기 헬퍼 (3단계 + 감시에서 공용)
        const _amtInputOf = (cb) => {
          const cd = cb.getAttribute('data-cd') || cb.id.replace(/^chk_/, '');
          return document.getElementById(`input_${cd}`)
            || document.querySelector(`input[data-cd="${cd}"][type="text"], input[data-cd="${cd}"][type="number"]`);
        };

        // 🆕 실제 키보드 타이핑 모방 — mmlfcp 금액칸은 키 입력 이벤트로만 내부 state 갱신/재계산됨.
        //   (setInputVal 네이티브 setter 로는 DOM value 만 바뀌고 화면/보험료 미반영. 수동 입력은 반영됨이 확인됨)
        //   focus → 기존값 전체삭제 → 숫자 한 글자씩 keydown/input/keyup → blur
        const typeAmount = (el, value) => {
          if (!el) return;
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          el.focus();
          el.click();
          // 기존 값 전체선택 → 삭제
          try { el.setSelectionRange(0, (el.value || '').length); } catch (e) {}
          nativeSetter.call(el, '');
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
          // 한 글자씩 타이핑
          let cur = '';
          for (const ch of String(value)) {
            const kc = 48 + (Number(ch) || 0);
            el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ch, code: 'Digit' + ch, keyCode: kc, which: kc }));
            el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: ch, code: 'Digit' + ch, keyCode: kc, which: kc }));
            cur += ch;
            nativeSetter.call(el, cur);
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch, code: 'Digit' + ch, keyCode: kc, which: kc }));
          }
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          try { if (window.jQuery) window.jQuery(el).trigger('input').trigger('change').trigger('blur'); } catch (e) {}
        };

        // 3단계: 체크와 금액입력을 분리 — 체크할 때마다 mmlfcp 가 전체 재계산을 돌려 직전 입력 금액을
        //   리셋하므로(마지막 담보만 살아남는 증상), '모든 체크 먼저 → 안정대기 → 금액 일괄 입력' 순서로 처리.
        // 3-A: 매칭 담보 모두 체크
        let _newlyChecked = 0;
        for (const t of target) {
          if (t._found) {
            if (!t._found.cb.checked) { t._found.cb.click(); _newlyChecked++; }
          } else if (!t._skip) {
            unmatched.push(`${t.standardName} (원본: "${t.name}")`);
          }
        }
        if (_newlyChecked > 0) {
          console.log(`[Toss Extractor] ☑️ ${_newlyChecked}개 담보 체크 완료 — 재계산 안정 대기(1.8s)`);
          await new Promise(r => setTimeout(r, 1800));  // 체크 자동입력 + 재계산이 끝날 시간
        }
        // 3-B: 금액 일괄 입력 (체크는 이미 끝나 cb.click 재계산 없음) — 자동값 비우고 받아온 값 입력
        for (const t of target) {
          if (!t._found) continue;
          matched++;
          matchedNames.push({ from: (t.name || t.standardName), std: t.standardName, to: t._found.cname, amt: t.amount });
          if (t.amount != null) {
            const amountInput = _amtInputOf(t._found.cb);
            if (amountInput) {
              const cd = t._found.cb.getAttribute('data-cd') || t._found.cb.id.replace(/^chk_/, '');
              typeAmount(amountInput, String(t.amount));    // 실제 키보드 타이핑 모방 (자동 clear 포함)
              await new Promise(r => setTimeout(r, 120));
              amountsFilled++;
              console.log(`[Toss Extractor] 💰 ${t._found.cname} (mmlfcp) ← "${t.standardName}" 금액: ${t.amount}만원 (${cd}) [키보드 타이핑]`);
            }
          }
        }
        out.applied['담보'] = `${matched}/${target.length} 체크 (전체 ${checks.length})`;
        if (amountsFilled > 0) out.applied['담보 금액'] = `${amountsFilled}건 입력`;
        if (unmatched.length > 0) out.applied['미매칭 담보'] = unmatched.slice(0, 5).join(', ') + (unmatched.length > 5 ? ` 외 ${unmatched.length-5}개` : '');
        console.log('[Toss Extractor] ✅ 담보 체크:', matched, '/', target.length, '/ 금액:', amountsFilled);

        // 🆕 담보 매칭 확인·수정 패널 — 추출담보(전)가 비교폼의 어떤 담보(후)로 이어졌는지 보여주고,
        //   드롭다운으로 매칭을 바꾸면 chrome.storage.sync 에 학습되어 같은 계정의 모든 컴퓨터에서 동일 적용된다.
        (function _renderMatchPanel(){
          try {
            const oldP = document.getElementById('__toss_match_panel');
            if (oldP) oldP.remove();
            // 폼 담보 목록(중복 제거) — 재매핑 드롭다운 옵션
            const formCovs = [];
            const _seen = new Set();
            checkInfo.forEach(ci => { if (ci.cname && !_seen.has(ci.cname)) { _seen.add(ci.cname); formCovs.push(ci.cname); } });

            const p = document.createElement('div');
            p.id = '__toss_match_panel';
            p.style.cssText = 'position:fixed;top:60px;right:18px;width:440px;max-height:82vh;overflow:auto;background:#fff;border:2px solid #2563eb;border-radius:12px;box-shadow:0 10px 36px rgba(0,0,0,.22);z-index:2147483646;font-family:"Malgun Gothic",sans-serif;font-size:13px;';

            const head = document.createElement('div');
            head.style.cssText = 'background:#2563eb;color:#fff;padding:11px 14px;font-weight:700;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:1;';
            head.innerHTML = '<span>📋 담보 매칭 확인·수정&nbsp; <span style="font-weight:400;font-size:11px;opacity:.85;">추출(전) → 비교폼(후)</span></span>';
            const closeBtn = document.createElement('span');
            closeBtn.textContent = '×';
            closeBtn.style.cssText = 'cursor:pointer;font-size:20px;line-height:1;';
            closeBtn.addEventListener('click', () => p.remove());
            head.appendChild(closeBtn);
            p.appendChild(head);

            const tip = document.createElement('div');
            tip.style.cssText = 'padding:7px 14px;background:#f8fafc;color:#475569;font-size:11px;border-bottom:1px solid #e2e8f0;';
            tip.innerHTML = '💡 매칭이 틀리면 드롭다운에서 올바른 담보를 고르세요. 선택은 <b>자동 저장·동기화</b>되어 다음에도(다른 컴퓨터에서도) 그대로 적용됩니다.';
            p.appendChild(tip);

            const bodyEl = document.createElement('div');
            bodyEl.style.cssText = 'padding:6px 0;';
            p.appendChild(bodyEl);

            target.forEach(t => {
              const row = document.createElement('div');
              row.style.cssText = 'padding:8px 14px;border-bottom:1px solid #f1f5f9;';

              const top = document.createElement('div');
              top.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:5px;';
              const fromEl = document.createElement('span');
              fromEl.textContent = t.name || t.standardName;
              fromEl.style.cssText = 'color:#0f172a;font-weight:700;';
              const arrow = document.createElement('span');
              arrow.textContent = '→';
              arrow.style.cssText = 'color:#94a3b8;';
              top.appendChild(fromEl);
              top.appendChild(arrow);
              if (t.amount != null) {
                const amtEl = document.createElement('span');
                amtEl.textContent = t.amount + '만원';
                amtEl.style.cssText = 'margin-left:auto;background:#eff6ff;color:#1d4ed8;border-radius:6px;padding:1px 7px;font-size:11px;font-weight:700;';
                top.appendChild(amtEl);
              }
              row.appendChild(top);

              const sel = document.createElement('select');
              sel.style.cssText = 'width:100%;padding:5px 7px;border:1px solid #cbd5e1;border-radius:7px;font-size:12px;background:#fff;';
              const optNone = document.createElement('option');
              optNone.value = ''; optNone.textContent = '— 연결 안 함 —';
              sel.appendChild(optNone);
              formCovs.forEach(cn => {
                const o = document.createElement('option');
                o.value = cn; o.textContent = cn;
                if (t._found && t._found.cname === cn) o.selected = true;
                sel.appendChild(o);
              });
              if (!t._found) optNone.selected = true;
              row.appendChild(sel);

              const status = document.createElement('div');
              status.style.cssText = 'margin-top:4px;font-size:11px;';
              if (t._found) { status.textContent = t._byLearn ? '✅ 학습된 연결' : '✅ 자동 연결'; status.style.color = '#16a34a'; }
              else if (t._skip) { status.textContent = '⏭️ 연결 안 함(학습됨)'; status.style.color = '#94a3b8'; }
              else { status.textContent = '❌ 자동 연결 실패 — 직접 선택하세요'; status.style.color = '#ef4444'; }
              row.appendChild(status);

              sel.addEventListener('change', () => {
                const newCname = sel.value;
                // 학습 저장 (sync — 모든 컴퓨터 공유)
                learnMap[t.standardName] = newCname || '__SKIP__';
                try { chrome.storage.sync.set({ [LEARN_KEY]: learnMap }); } catch (e) {}
                // 이전 매칭 해제 (금액 비우고 체크 해제)
                if (t._found && t._found.cb) {
                  try { const oi = _amtInputOf(t._found.cb); if (oi) typeAmount(oi, ''); } catch (e) {}
                  if (t._found.cb.checked) t._found.cb.click();
                }
                // 새 매칭 적용 (체크 + 금액 입력)
                if (newCname) {
                  const ci = checkInfo.find(c => c.cname === newCname);
                  if (ci) {
                    t._found = ci; t._skip = false;
                    if (!ci.cb.checked) ci.cb.click();
                    if (t.amount != null) {
                      const inp = _amtInputOf(ci.cb);
                      if (inp) setTimeout(() => { try { typeAmount(inp, String(t.amount)); } catch (e) {} }, 500);
                    }
                  }
                  status.textContent = '✅ 변경 저장됨 — 다음에도 자동 적용'; status.style.color = '#16a34a';
                } else {
                  t._found = null; t._skip = true;
                  status.textContent = '⏭️ 연결 안 함(저장됨)'; status.style.color = '#94a3b8';
                }
              });

              bodyEl.appendChild(row);
            });

            document.body.appendChild(p);
          } catch (e) { console.warn('[Toss Extractor] 매칭 패널 표시 실패', e); }
        })();

        // 🆕 지속 감시 재입력 — mmlfcp 가 조회 직후 자동 재계산으로 금액을 '진단수술' 플랜 기본값으로
        //   되돌리는 현상 대응. 되돌림은 확장 완료보다 늦게(수 초 후) 일어남.
        //   (수동 입력은 유지되므로 = mmlfcp 는 100 을 허용. 되돌림 이벤트가 끝난 뒤의 '마지막' 입력이 살아남는다)
        //   → 어긋난 칸을 주기적으로 재입력하며 감시. 일정시간 되돌림이 멈추면(안정) 종료.
        //   (_amtInputOf 는 3단계에서 이미 정의됨)
        const _toCorrect = target.filter(t => t._found && t.amount != null);
        if (_toCorrect.length > 0) {
          const MAX_MS = 9000;     // 최대 감시 시간
          const STEP = 700;        // 점검 주기
          const STABLE_MS = 2800;  // 이 시간 동안 되돌림 없으면 안정으로 판단하고 종료
          const t0 = Date.now();
          let lastFix = Date.now(), totalFix = 0, rounds = 0;
          while (Date.now() - t0 < MAX_MS) {
            let fixed = 0;
            _toCorrect.forEach(t => {
              const inp = _amtInputOf(t._found.cb);
              if (!inp) return;
              const cur = String(inp.value || '').replace(/[^\d]/g, '');
              if (cur !== String(t.amount)) {
                if (!t._found.cb.checked) t._found.cb.click();
                typeAmount(inp, String(t.amount));
                fixed++;
              }
            });
            rounds++;
            if (fixed > 0) {
              lastFix = Date.now();
              totalFix += fixed;
              console.log(`[Toss Extractor] 🔁 감시 재입력(round ${rounds}): ${fixed}건 교정`);
            }
            if (Date.now() - lastFix >= STABLE_MS) break;  // 안정 → 종료
            await new Promise(r => setTimeout(r, STEP));
          }
          out.applied['금액 감시교정'] = `${totalFix}회 / ${rounds}라운드 / ${Math.round((Date.now() - t0) / 1000)}s`;
          // 🔍 최종 검증
          const finalReport = _toCorrect.map(t => {
            const inp = _amtInputOf(t._found.cb);
            const cur = String(inp?.value || '').replace(/[^\d]/g, '');
            return `${cur === String(t.amount) ? '✅' : '❌'} ${t.standardName}: 원함=${t.amount} 현재=${inp?.value}`;
          });
          console.log('[Toss Extractor] 🔍 최종 금액 검증:\n  ' + finalReport.join('\n  '));
          const stillWrong = _toCorrect.filter(t => {
            const inp = _amtInputOf(t._found.cb);
            return String(inp?.value || '').replace(/[^\d]/g, '') !== String(t.amount);
          });
          if (stillWrong.length > 0) {
            out.applied['⚠️미교정'] = stillWrong.map(t => `${t.standardName}(원함${t.amount})`).join(', ');
          }

          // 🛡️ 조회하기 버튼 금액 가드 — 사용자가 보험료 보려고 '조회하기'를 누르면 mmlfcp 가
          //   금액을 '진단수술' 플랜 기본값으로 리셋함. 조회 클릭을 감지해 재계산 후 금액을 자동 복원.
          //   (확장 메시지 핸들러가 끝나도 리스너는 페이지에 남아, 사용자가 조회를 누를 때마다 동작)
          try {
            let searchBtn = document.getElementById('btn_search');
            if (!searchBtn) {
              searchBtn = Array.from(document.querySelectorAll('button, a, input[type=button], input[type=submit]'))
                .find(el => /조회|검색/i.test((el.innerText || el.textContent || el.value || '').trim()));
            }
            if (searchBtn && !searchBtn._tossAmtGuard) {
              searchBtn._tossAmtGuard = true;
              const _guardTargets = _toCorrect.map(t => ({ cb: t._found.cb, amount: t.amount, name: t.standardName }));
              searchBtn.addEventListener('click', () => {
                let tries = 0;
                const restore = () => {
                  let fixed = 0;
                  _guardTargets.forEach(g => {
                    const inp = _amtInputOf(g.cb);
                    if (!inp) return;
                    const cur = String(inp.value || '').replace(/[^\d]/g, '');
                    if (cur !== String(g.amount)) {
                      if (!g.cb.checked) g.cb.click();
                      typeAmount(inp, String(g.amount));
                      fixed++;
                    }
                  });
                  if (fixed > 0) console.log(`[Toss Extractor] 🛡️ 조회 후 금액 복원: ${fixed}건`);
                  if (++tries < 7) setTimeout(restore, 800);  // 재계산이 늦게 끝나도 잡도록 반복 점검
                };
                setTimeout(restore, 1500);  // 재조회 재계산이 끝난 뒤부터 복원 시작
              });
              console.log('[Toss Extractor] 🛡️ 조회하기 버튼 금액 가드 설치됨 — 이후 조회를 눌러도 금액이 유지됩니다');
            }
          } catch (e) { console.warn('[Toss Extractor] 금액 가드 설치 실패:', e); }
        }
      }
    }

    // 완료 — 상태 박스를 녹색으로 + 5초 후 제거
    const totalItems = Object.keys(out.filled).length + Object.keys(out.applied).length;
    out.ok = totalItems > 0;
    logStep(`✅ 완료 (${totalItems}개 항목 / ${elapsed()})`);
    if (statusBox) {
      statusBox.style.background = '#10b981';
      setTimeout(() => statusBox.remove(), 5000);
    }

    return out;
  } catch (e) {
    out.error = e.message;
    console.error('[Toss Extractor] applyToPremiumFormUnified 에러:', e);
    if (statusBox) {
      statusBox.style.background = '#dc2626';
      statusBox.innerHTML = `❌ 에러: ${e.message}<br><span style="font-size:10px;opacity:0.85;">${elapsed()} 경과</span>`;
      setTimeout(() => statusBox.remove(), 10000);
    }
    return out;
  }
}

// 🔐 확장 권한 확인 — extAuthOK(로그인 + 관리자승인) 가 true 일 때만 핵심 동작 허용.
//   popup 게이트가 1차 차단하지만, content 를 직접 호출하는 우회까지 여기서 막아 '완벽 차단'.
const _extAuthCheck = () => new Promise(function (res) {
  try { chrome.storage.local.get(['extAuthOK'], function (d) { res(!!(d && d.extAuthOK === true)); }); }
  catch (e) { res(false); }
});

// 팝업에서 메시지를 받아 데이터 추출
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 🆕 모든 수신 메시지 시각 표시 — 디버깅용 (action명만 빠르게 표시)
  try {
    const tag = document.createElement('div');
    tag.textContent = `📬 메시지 수신: ${request?.action || '(unknown)'}`;
    tag.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#7c3aed;color:#fff;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    document.body.appendChild(tag);
    setTimeout(() => tag.remove(), 3000);
  } catch (e) {}
  console.log('[Toss Extractor] 📬 메시지 수신:', request?.action, request);
  if (request.action === 'ping') {
    try { sendResponse({ ok: true, hasApplyHandler: true, version: __EXT_VERSION }); } catch (e) {}
    return false;
  }
  // 🆕 mmlfcp 폼의 실제 옵션 읽기 — 생손보유형 설정 후 상품유형/만기 옵션 반환 (popup 드롭다운 동기화용)
  if (request.action === 'getFormOptions') {
    (async () => {
      if (!(await _extAuthCheck())) { try { sendResponse({ ok: false, error: '⛔ 권한이 없습니다. 확장 팝업에서 로그인 후 관리자 승인을 받으세요.', _denied: true }); } catch (e) {} return; }
      try {
        const readOpts = (id) => {
          const sel = document.getElementById(id);
          if (!sel) return [];
          return Array.from(sel.options).map(o => ({ value: o.value, text: (o.textContent || '').trim() })).filter(o => o.value !== '');
        };
        // 생손보유형 지정 시: 설정 + 종속 옵션(plans) 동적 로드 대기
        if (request.insType) {
          const insSel = document.getElementById('selInsuranceType');
          if (insSel && insSel.value !== request.insType) {
            insSel.value = request.insType;
            insSel.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 900));  // renderPlanOptions 비동기 로드 대기
          }
        }
        sendResponse({
          ok: true,
          insTypes: readOpts('selInsuranceType'),
          prodTypes: readOpts('selProductsGroupCD'),
          maturities: readOpts('selPaymentExpirationCD')
        });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;  // 비동기 응답
  }
  // 🆕 보험료 비교 페이지 통합 자동 입력
  if (request.action === 'applyToPremiumForm') {
    chrome.storage.local.get(['extAuthOK'], (d) => {
      if (!d || d.extAuthOK !== true) {
        try { sendResponse({ ok: false, error: '⛔ 권한이 없습니다. 확장 팝업에서 로그인 후 관리자 승인을 받으세요.', _denied: true }); } catch (e) {}
        return;
      }
      try {
        applyToPremiumFormUnified(request.payload || {})
          .then(result => { try { sendResponse(result); } catch (e) { console.warn('[Toss Ext] sendResponse 실패:', e); } })
          .catch(e => { try { sendResponse({ ok: false, error: e.message }); } catch (err) {} });
      } catch (e) {
        try { sendResponse({ ok: false, error: 'handler 동기 에러: ' + e.message }); } catch (err) {}
      }
    });
    return true;  // 비동기 응답
  }
  if (request.action === 'extractData') {
    const pageType = detectPageType();

    (async () => {
      if (!(await _extAuthCheck())) { try { sendResponse({ type: 'error', error: '⛔ 권한이 없습니다. 확장 팝업에서 로그인 후 관리자 승인을 받으세요.', _denied: true }); } catch (e) {} return; }
      try {
        if (pageType === 'premium_compare') {
          // 🆕 한장으로 보는 보험료 비교 페이지 추출
          const data = extractPremiumComparison();
          sendResponse({ ...data, url: window.location.href });
          return;
        }
        if (pageType === 'customer') {
          const customer = await extractCustomerData();
          sendResponse({
            type: 'customer',
            url: window.location.href,
            extractedAt: new Date().toISOString(),
            customer
          });
        } else if (pageType === 'coverage') {
          const match = window.location.pathname.match(/\/cover\/(\d+)/);
          // 모든 accordion 자동 펼치기
          const expandInfo = await expandAllAccordions();

          // 🆕 보장 탭 → 추출 + _tabType:'보장' 태그
          await switchAllTabsTo('보장');
          const mainDetails = extractCoverageDetails();
          mainDetails.rows.forEach(r => { r._tabType = '보장'; });

          // 🆕 특약 탭으로 전환 → 추출 + _tabType:'특약' 태그
          //   ⚠️ 항상 extractCoverageDetails 호출 — 전환된 탭 수가 0이어도
          //      이미 활성화돼있거나 다른 페이지 구조일 수 있음. 빈 결과는 자연스럽게 걸러짐.
          const switchedRider = await switchAllTabsTo('특약');
          console.log(`[Toss Extractor] switchAllTabsTo('특약') → ${switchedRider}회 클릭됨 (0회여도 추출 시도)`);
          // 안정화 대기 — DOM 업데이트 보장
          await new Promise(r => setTimeout(r, 600));
          const riderDetails = extractCoverageDetails();
          let riderRows = riderDetails.rows;
          // 보장 탭에서 이미 잡힌 행과 정확히 동일한 행이면 (탭 전환 실패) 제거
          //   → 키: 섹션번호 + 보장명 + 보장 금액 조합으로 중복 판정
          const mainKeys = new Set(mainDetails.rows.map(r => `${r._섹션번호}::${r['보장명']||''}::${r['보장 금액']||''}`));
          const beforeDedup = riderRows.length;
          riderRows = riderRows.filter(r => {
            const key = `${r._섹션번호}::${r['보장명']||''}::${r['보장 금액']||''}`;
            return !mainKeys.has(key);
          });
          console.log(`[Toss Extractor] 특약 추출: ${beforeDedup}건 → 중복 제외 후 ${riderRows.length}건`);
          riderRows.forEach(r => { r._tabType = '특약'; });

          // 다시 보장 탭으로 복귀 (UI 사용자 경험)
          await switchAllTabsTo('보장');

          // 🔀 두 탭 결과 병합 — 같은 섹션에서 (보장+특약) 모두 수집
          const details = {
            rows: [...mainDetails.rows, ...riderRows],
            summary: mainDetails.summary   // summary 는 보장 기준 그대로 (담보수는 다시 계산)
          };
          // 섹션별 담보수 재계산
          details.summary.forEach(sec => {
            sec.담보수 = details.rows.filter(r => r._섹션번호 === sec.섹션번호).length;
          });
          console.log(`[Toss Extractor] 보장 ${mainDetails.rows.length}건 + 특약 ${riderRows.length}건 = 총 ${details.rows.length}건`);

          // 🆕 accordion 별 보장/특약 분포 — 메인 앱에서 그룹화 검증용
          const byAcc = {};
          details.rows.forEach(r => {
            const k = `${r._accordionIdx}::${(r._상품명 || '').substring(0, 40)}`;
            if (!byAcc[k]) byAcc[k] = { 보장: 0, 특약: 0, idx: r._accordionIdx, name: r._상품명 || '(이름 없음)' };
            byAcc[k][r._tabType || '없음'] = (byAcc[k][r._tabType || '없음'] || 0) + 1;
          });
          console.log('[Toss Extractor] 📊 accordion 별 보장/특약 분포:');
          Object.values(byAcc).sort((a, b) => a.idx - b.idx).forEach(v => {
            const status = v.보장 > 0 && v.특약 > 0 ? '✅' : (v.보장 > 0 ? '⚠️ 보장만' : (v.특약 > 0 ? '⚠️ 특약만' : '?'));
            console.log(`   [accordionIdx=${v.idx}] ${status} "${v.name}" → 보장 ${v.보장}건 + 특약 ${v.특약}건`);
          });
          let insurances = extractInsuranceData();
          // 의미 없는 보험 자동 제외 (만기/소멸/해지 + 단기·해외여행보험)
          const beforeCount = insurances.length;
          insurances = insurances.filter(ins => {
            const status = (ins['계약상태'] || '').trim();
            const payStatus = (ins['납입 여부'] || '').trim();
            const note = (ins['매니저 코멘트'] || '').trim();
            const combined = `${payStatus} ${note}`;
            // 만기/소멸/해지 + 단기보험류 표시 → 의미 없음 → 제외
            if (['만기', '소멸', '해지', '실효'].includes(status)) {
              if (/해외여행|단기|여행자/.test(combined)) return false;
            }
            // 매니저 코멘트가 "해외여행보험"이고 만기/소멸 등 → 단기보험 → 제외
            if (note === '해외여행보험' && status !== '정상') return false;
            return true;
          });
          const filteredCount = beforeCount - insurances.length;
          console.log(`[Toss Extractor] 의미 없는 단기보험 ${filteredCount}건 자동 제외 (전체 ${beforeCount} → 유효 ${insurances.length})`);
          // 상위표 보험명이 비었거나 "보험명 없음"인 경우 → accordion 상품명으로 자동 채움
          const matchedNames = matchInsuranceNamesFromAccordion(insurances, details.summary);
          console.log(`[Toss Extractor] 보험명 자동 매칭: ${matchedNames}건`);
          // 🆕 보장내역 페이지 '기본정보' 전체 추출 (이름/성별/생년월일/상령일/최초보험연결일/상담문의)
          const _custId = match ? match[1] : '';
          const basicInfo = await extractCustomerBasicInfo(_custId);
          // 이름: 기본정보(title/헤더) 우선 → 없으면 계약자/피보험자 본인측
          let _custName = basicInfo.고객명 || '';
          if (!_custName) {
            const _validIns = insurances.find(ins => (ins['계약상태'] || '').trim() === '정상') || insurances[0];
            if (_validIns) {
              const raw = String(_validIns['계약자/피보험자'] || '');   // "김*선/박현빈"
              const parts = raw.split('/').map(s => s.trim());
              // 마스킹(*) 없는 쪽을 우선, 둘 다 마스킹이면 두번째(피보험자=본인) 사용
              _custName = parts.find(p => p && !p.includes('*')) || parts[1] || parts[0] || '';
            }
          }
          const coverCustomer = {};
          if (_custName) { coverCustomer['고객명'] = _custName; coverCustomer['name'] = _custName; }
          if (basicInfo.생년월일) coverCustomer['생년월일'] = basicInfo.생년월일;
          if (basicInfo.생년월일표시) coverCustomer['생년월일표시'] = basicInfo.생년월일표시;
          if (basicInfo.성별) coverCustomer['성별'] = basicInfo.성별;
          if (basicInfo.상령일) coverCustomer['상령일'] = basicInfo.상령일;
          if (basicInfo.최초보험연결일) coverCustomer['최초보험연결일'] = basicInfo.최초보험연결일;
          if (basicInfo.상담문의) coverCustomer['상담문의'] = basicInfo.상담문의;
          if (basicInfo.보험나이) coverCustomer['보험나이'] = basicInfo.보험나이;
          console.log('[Toss Extractor] 👤 보장내역 기본정보 customer:', coverCustomer);
          sendResponse({
            type: 'coverage',
            url: window.location.href,
            customerId: _custId,
            extractedAt: new Date().toISOString(),
            expandInfo,
            matchedNames,
            coverageDetails: details.rows,
            productSummary: details.summary,
            insurances: insurances,
            customer: coverCustomer   // 🆕 이름/생년월일/성별 — popup.js 가 mmlfcp 폼에 사용
          });
        } else {
          sendResponse({ type: 'unknown' });
        }
      } catch (e) {
        sendResponse({ type: 'error', error: e.message });
      }
    })();

    return true; // 비동기 응답
  }
});

// ═══════════════════════════════════════════════════════════════════
// 🆕 토스 보장분석 → 페인트프로(editor.html) 이미지 전송
//   토스 페이지: '이미지 복사'(클립보드) 자동 클릭 → 클립보드 읽기 → storage 저장 → 새 탭 editor 열기
//   editor 페이지: storage 의 이미지를 sessionStorage 로 넘기고 editor 의 로더를 트리거
// ═══════════════════════════════════════════════════════════════════
(function () {
  const EDITOR_URL = 'https://tossinssu-pro.vercel.app/editor.html';
  const STORAGE_KEY = '__paintProImg_v1';
  const host = location.hostname;

  // ───────── editor(vercel) 페이지: 전달된 이미지를 받아 캔버스에 주입 ─────────
  if (/tossinssu-pro\.vercel\.app$/.test(host) && /editor\.html/i.test(location.pathname)) {
    try {
      chrome.storage.local.get([STORAGE_KEY], function (d) {
        const payload = d && d[STORAGE_KEY];
        if (!payload || !payload.dataURL) return;
        try {
          sessionStorage.setItem('toss_analysis_image', payload.dataURL);
          sessionStorage.setItem('toss_analysis_filename', payload.fileName || '토스보장분석.png');
        } catch (e) {}
        const trigger = function () { try { window.postMessage({ __paintProLoad: true }, '*'); } catch (e) {} };
        trigger(); setTimeout(trigger, 400); setTimeout(trigger, 1200); setTimeout(trigger, 2500);
        try { chrome.storage.local.remove(STORAGE_KEY); } catch (e) {}
      });
    } catch (e) {}
    return;
  }

  // ───────── 토스 보장분석 페이지: 전송 버튼 추가 ─────────
  // 🆕 토스 CRM(보장분석) 도메인이 아니면 전송 버튼을 절대 설치하지 않음
  //    (vercel 제안서의 '표', mmlfcp 등 다른 사이트에서 잘못 뜨던 문제 차단)
  if (!/(^|\.)tossinsu\.com$/i.test(host)) return;
  const findCopyBtn = function () {
    return Array.from(document.querySelectorAll('button')).find(function (b) { return (b.textContent || '').trim() === '이미지 복사'; });
  };
  const findTableTab = function () {
    return Array.from(document.querySelectorAll('button, [role=tab]')).find(function (b) { return (b.textContent || '').trim() === '표'; });
  };
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const blobToDataURL = function (blob) { return new Promise(function (res, rej) { const fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(blob); }); };

  async function readClipboardImage() {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const t = it.types.find(function (x) { return x.startsWith('image/'); });
        if (t) { const blob = await it.getType(t); return await blobToDataURL(blob); }
      }
    } catch (e) {}
    return null;
  }

  // 🆕 보장분석 요약(고객명/나이/성별/상령일/보험개수/월납합계/잔여합계)을 토스 인슈어런스 스튜디오로 전송
  const STUDIO_URL = 'https://toss-insurance-studio.web.app';
  async function sendToStudio(btn) {
    const old = btn.textContent; btn.textContent = '⏳ 추출 중…'; btn.disabled = true;
    try {
      if (typeof _extAuthCheck === 'function' && !(await _extAuthCheck())) {
        alert('⛔ 권한이 없습니다. 확장 팝업에서 로그인 후 관리자 승인을 받으세요.');
        return;
      }
      const match = location.pathname.match(/\/cover\/(\d+)/);
      const custId = match ? match[1] : '';
      let basic = {};
      try { basic = (await extractCustomerBasicInfo(custId)) || {}; } catch (e) {}
      let insurances = [];
      try { insurances = extractInsuranceData() || []; } catch (e) {}
      const _num = function (v) { return parseInt(String(v == null ? '' : v).replace(/[^\d]/g, ''), 10) || 0; };
      const monthSum = insurances.reduce(function (s, i) { return s + _num(i['월납보험료']); }, 0);
      const remainSum = insurances.reduce(function (s, i) { return s + _num(i['잔여보험료']); }, 0);
      const payload = {
        고객명: basic.고객명 || '',
        나이: basic.보험나이 || '',
        성별: basic.성별 || '',
        상령일: basic.상령일 || '',
        보험개수: insurances.length,
        월납합계: monthSum,
        잔여합계: remainSum,
        추출시각: new Date().toISOString()
      };
      if (!payload.고객명 && insurances.length === 0) {
        alert('추출할 보장분석 데이터를 찾지 못했습니다.\n토스 보장분석(보장내역) 페이지에서 사용해 주세요.');
        return;
      }
      const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      window.open(STUDIO_URL + '/#studio=' + b64, '_blank');
    } catch (e) {
      alert('스튜디오 전송 실패: ' + (e.message || e));
    } finally { btn.textContent = old; btn.disabled = false; }
  }

  async function sendToPaintPro(fab) {
    const old = fab.textContent;
    fab.textContent = '⏳ 이미지 준비 중…'; fab.disabled = true;
    try {
      // 1) '이미지 복사' 버튼이 안 보이면 → '표' 탭을 먼저 눌러 표 화면을 띄운다
      let btn = findCopyBtn();
      if (!btn) {
        const tab = findTableTab();
        if (tab) { tab.click(); for (let i = 0; i < 12 && !btn; i++) { await sleep(250); btn = findCopyBtn(); } }
      }
      if (!btn) { alert('표 탭 또는 "이미지 복사" 버튼을 찾지 못했습니다.\n토스 보장분석 페이지에서 사용해 주세요.'); return; }
      btn.click();   // 토스 '이미지 복사' → 클립보드에 이미지
      await sleep(250);
      let dataURL = null;
      for (let i = 0; i < 14 && !dataURL; i++) { await sleep(180); dataURL = await readClipboardImage(); }
      if (!dataURL) {
        alert('이미지를 읽지 못했습니다.\n\n· 토스 "이미지 복사"를 먼저 한 번 누른 뒤 이 버튼을 다시 눌러보세요.\n· 클립보드 권한 요청이 뜨면 허용해 주세요.');
        return;
      }
      await new Promise(function (r) { chrome.storage.local.set({ [STORAGE_KEY]: { dataURL: dataURL, fileName: '토스보장분석.png', ts: Date.now() } }, r); });
      window.open(EDITOR_URL, '_blank');
    } finally { fab.textContent = old; fab.disabled = false; }
  }

  function ensureButton() {
    if (!findCopyBtn() && !findTableTab()) return;   // 보장분석(표 탭 또는 이미지복사 버튼) 화면에서만 노출
    if (!document.getElementById('__paintpro_send')) {
      const fab = document.createElement('button');
      fab.id = '__paintpro_send';
      fab.textContent = '🎨 페인트프로로 전송';
      fab.style.cssText = 'position:fixed; right:20px; bottom:20px; z-index:2147483647; padding:12px 18px; background:#2563EB; color:#fff; border:none; border-radius:10px; font-weight:700; font-size:13px; box-shadow:0 6px 18px rgba(37,99,235,.4); cursor:pointer; font-family:sans-serif;';
      fab.onclick = function () { sendToPaintPro(fab); };
      document.body.appendChild(fab);
    }
    if (!document.getElementById('__studio_send')) {
      const sb = document.createElement('button');
      sb.id = '__studio_send';
      sb.textContent = '📤 스튜디오전송';
      sb.style.cssText = 'position:fixed; right:20px; bottom:70px; z-index:2147483647; padding:12px 18px; background:#7c3aed; color:#fff; border:none; border-radius:10px; font-weight:700; font-size:13px; box-shadow:0 6px 18px rgba(124,58,237,.4); cursor:pointer; font-family:sans-serif;';
      sb.onclick = function () { sendToStudio(sb); };
      document.body.appendChild(sb);
    }
  }

  // 탭 전환/지연 렌더로 버튼이 늦게 생기므로 주기적으로 확인
  try { ensureButton(); setInterval(ensureButton, 1500); } catch (e) {}
})();

} // end of __tossCrmExtractorLoaded guard
