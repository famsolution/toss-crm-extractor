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

// 🆕 보장분석(/cover) 페이지에서 customerId 후보를 여러 경로로 수집 — /cover/{id} 가 실제 customerId 와 달라도 대응.
//   ① URL /cover/{id}  ② DOM 의 고객 링크 a[href*="/customers/{id}"]  ③ 앱 상태(redux/next)의 customerId 류 필드
function collectCustomerIdCandidates() {
  const ids = [];
  try { const m = location.pathname.match(/\/cover\/(\d+)/); if (m) ids.push(m[1]); } catch {}
  try {
    document.querySelectorAll('a[href*="/customers/"]').forEach(a => {
      const m = (a.getAttribute('href') || '').match(/\/customers\/(\d+)/);
      if (m) ids.push(m[1]);
    });
  } catch {}
  try {
    const cands = [window.__REDUX_STORE__, window.store, window.__NEXT_DATA__, window.__INITIAL_STATE__, window.__APP_STATE__];
    const seen = new Set();
    const scan = (o, d = 0) => {
      if (!o || d > 5 || typeof o !== 'object' || ids.length > 8) return;
      for (const k of Object.keys(o)) {
        const v = o[k];
        if ((typeof v === 'string' || typeof v === 'number') && /customer[_-]?(id|no)|custId|고객(ID|번호)/i.test(k) && /^\d{3,}$/.test(String(v))) {
          if (!seen.has(String(v))) { seen.add(String(v)); ids.push(String(v)); }
        } else if (v && typeof v === 'object' && d < 5) { scan(v, d + 1); }
      }
    };
    for (const c of cands) { if (c) { const s = (typeof c.getState === 'function') ? c.getState() : c; scan(s); } }
  } catch {}
  return [...new Set(ids)];   // 중복 제거(우선순위 순서 유지)
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

