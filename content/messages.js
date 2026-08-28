// 🔐 확장 권한 확인 — extAuthOK(로그인 + 관리자승인) 가 true 일 때만 핵심 동작 허용.
//   popup 게이트가 1차 차단하지만, content 를 직접 호출하는 우회까지 여기서 막아 '완벽 차단'.
const _extAuthCheck = () => new Promise(function (res) {
  try { chrome.storage.local.get(['extAuthOK'], function (d) { res(!!(d && d.extAuthOK === true)); }); }
  catch (e) { res(false); }
});

// 팝업에서 메시지를 받아 데이터 추출.
// 재주입(popup 의 ensureContentScript)으로 리스너가 두 번 붙으면 sendResponse 가
// 중복 호출되므로 한 번만 등록한다.
if (!window.__tossCrmExtractorMsgBound) {
window.__tossCrmExtractorMsgBound = true;
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
  // 🆕 페인트 프로/스튜디오 트리거 — popup 이 닫힌 뒤(페이지 focus 복귀) 실행해야 clipboard.read 가 동작
  if (request.action === 'triggerPaintPro' || request.action === 'triggerStudio') {
    const _id = request.action === 'triggerPaintPro' ? '__paintpro_send' : '__studio_send';
    setTimeout(function () { const b = document.getElementById(_id); if (b) b.click(); }, 400);
    try { sendResponse({ ok: true }); } catch (e) {}
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
  if (request.action === 'extractCoverageExcelRows') {
    (async () => {
      if (!(await _extAuthCheck())) {
        try { sendResponse({ ok: false, error: '⛔ 권한이 없습니다. 확장 팝업에서 로그인 후 관리자 승인을 받으세요.', _denied: true, rows: [] }); } catch (e) {}
        return;
      }
      try {
        const result = await extractCoverageExcelRowsFromPage();
        sendResponse(result);
      } catch (e) {
        console.error('[Toss Extractor] 보장분석 엑셀 추출 실패:', e);
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e), rows: [] });
      }
    })();
    return true;
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
          // 보장 탭에서 이미 잡힌 행과 동일한 행이면 (탭 전환 실패 등) 제거 — 담보는 보장/특약 중 한 곳에만 속한다.
          // 🐛 [중복 근본원인] 기존 키는 _섹션번호(= 담보표 순번, tableIdx+1)를 썼는데, 특약 탭에서는
          //   특약이 없는 상품의 표가 사라져 순번이 앞으로 당겨진다 → 같은 담보인데 섹션번호가 달라져
          //   중복 판정에 실패, 보장·특약 양쪽에 동일 담보가 남았다.
          //   pass 사이에서 안정적인 _accordionIdx(= DOM accordion 순서)를 기준으로 바꾼다.
          const mainKeys = new Set(mainDetails.rows.map(_coverageDupKey));
          const beforeDedup = riderRows.length;
          riderRows = riderRows.filter(r => !mainKeys.has(_coverageDupKey(r)));
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
          // 🆕 전화번호 — 고객정보 페이지로 이동하지 않고 가져오기:
          //    ① 앱 상태(redux/next)에서 평문 전화 스캔 → ② phone API(/api/customer/{id}/phone, 쿠키 인증) 폴백
          try {
            let _phone = '';
            // ① 앱 상태에 평문 전화가 이미 있으면 그대로 사용 (API 불필요)
            const _st = findUnmaskedFromAppState(_custId);
            if (_st && _st.phone) _phone = _st.phone;
            // ② 없으면 여러 customerId 후보로 phone API 시도 (쿠키 인증, 페이지 이동 없음)
            if (!_phone) {
              const _cands = collectCustomerIdCandidates();
              console.log('[Toss Extractor] ☎ customerId 후보:', _cands);
              for (const cid of _cands) {
                const p = await fetchPhoneData(cid);
                if (p) { _phone = p; break; }
              }
            }
            if (_phone) { coverCustomer['연락처'] = _phone; coverCustomer['phone'] = _phone; console.log('[Toss Extractor] ☎ 보장분석 전화번호 확보:', _phone); }
            else console.warn('[Toss Extractor] ☎ 보장분석 전화번호 미확보 (앱상태/모든 customerId 후보 실패)');
          } catch (e) { console.warn('[Toss Extractor] 보장 전화번호 조회 실패:', e); }
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

} // end of __tossCrmExtractorMsgBound guard
