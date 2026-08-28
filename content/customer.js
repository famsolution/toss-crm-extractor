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

