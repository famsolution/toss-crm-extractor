// popup.js

let extractedData = null;
// 🆕 선택된 보험상품들 (다중 선택 — 여러 상품의 담보를 합산해 mmlfcp 로 전송)
let _selectedProductKeys = new Set();

// 금액 문자열 → 만원 단위 정수 (합산용)
function _parseAmtToMan(raw) {
  if (!raw) return 0;
  const s = String(raw);
  const num = parseInt(s.replace(/[^\d]/g, ''), 10);
  if (!num) return 0;
  if (/만/.test(s)) return num;                       // 이미 만원 단위
  if (num >= 10000) return Math.round(num / 10000);   // 원 → 만원
  return num;
}

// 추출 데이터에서 상품별 담보+금액 추출 — coverageDetails.rows 그룹화
function _getProductsFromExtractedData() {
  if (!extractedData || extractedData.type !== 'coverage') return [];
  const rows = Array.isArray(extractedData.coverageDetails) ? extractedData.coverageDetails : [];
  const summary = Array.isArray(extractedData.productSummary) ? extractedData.productSummary : [];
  const insurances = Array.isArray(extractedData.insurances) ? extractedData.insurances : [];
  // 🆕 상품 ↔ 보험(상위표) 매칭 — 매칭된 보험 레코드 반환 (월납보험료/계약일/갱신유무 활용)
  const _norm = s => String(s || '').replace(/\s/g, '');
  const _matchIns = (sec) => {
    const sn = _norm(sec.상품명), cn = _norm(sec.보험사명);
    return insurances.find(ins => {
      const bn = _norm(ins['보험명']);
      const ic = _norm(ins['보험사명']);
      const nameMatch = bn && sn && (bn === sn || bn.includes(sn) || sn.includes(bn));
      const coMatch = !cn || !ic || cn === ic || cn.includes(ic) || ic.includes(cn);
      return nameMatch && coMatch;
    }) || null;
  };
  const _premiumFrom = ins => ins ? (parseInt(String(ins['월납보험료'] || ins['총보험료'] || '').replace(/[^0-9]/g, '')) || 0) : 0;
  // 🆕 갱신주기 탐지 — 상품명/특약명 텍스트에서 "N년갱신" / "갱신 N년"
  const _detectCycle = (sec, coverages, ins) => {
    const parts = [sec.상품명, ins && ins['보험명'], ins && (ins['갱신 유무'] || ins['갱신유무'])]
      .concat((coverages || []).map(c => c.name)).filter(Boolean);
    const text = parts.join(' ');
    const m = text.match(/(\d{1,2})\s*년\s*갱신/) || text.match(/갱신\s*[:\-]?\s*(\d{1,2})\s*년/);
    return m ? parseInt(m[1]) : '';
  };
  // 🆕 가장 정확한 갱신기간 — 보장탭 각 담보/특약의 (보장종료일 − 보장시작일) 갭(년)
  const _yearGap = (s, e) => {
    const a = String(s || '').replace(/[^0-9]/g, ''), b = String(e || '').replace(/[^0-9]/g, '');
    if (a.length < 8 || b.length < 8) return 0;
    const d1 = new Date(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6, 8));
    const d2 = new Date(+b.slice(0, 4), +b.slice(4, 6) - 1, +b.slice(6, 8));
    if (isNaN(d1) || isNaN(d2) || d2 <= d1) return 0;
    return Math.round((d2 - d1) / (365.25 * 86400000));
  };
  const _detectCycleFromDates = (prows) => {
    const gaps = {};
    (prows || []).forEach(r => { const g = _yearGap(r['보장시작일'], r['보장종료일']); if (g >= 1 && g <= 30) gaps[g] = (gaps[g] || 0) + 1; });
    let best = 0, cnt = 0; Object.keys(gaps).forEach(g => { if (gaps[g] > cnt) { cnt = gaps[g]; best = +g; } });
    return best; // 1~30년 범위 중 가장 빈번한 갭(=갱신주기), 없으면 0
  };
  const products = [];
  summary.forEach(sec => {
    const productRows = rows.filter(r =>
      r._섹션번호 === sec.섹션번호 &&
      (r['보장 금액'] || r['보장명'])
    );
    if (productRows.length === 0) return;
    const coverages = productRows.map(r => ({
      name: r['보장명'] || r['보장 소분류'] || '',
      amount: r['보장 금액'] || '',
      _섹션번호: r._섹션번호
    })).filter(c => c.name);
    const ins = _matchIns(sec);
    const _n = v => parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10) || 0;
    // 🔑 보험료: 상위표 매칭값 우선, 실패 시 productSummary(sec) 자체의 월납보험료 사용
    //    (이름 매칭 실패로 premium=0 이 되어 분석기에 '값이 안 들어오던' 핵심 버그 수정)
    const _prem = _premiumFrom(ins) || _n(sec.월납보험료);
    products.push({
      key: `${sec.섹션번호}::${sec.상품명}`,
      섹션번호: sec.섹션번호,
      보험사명: sec.보험사명 || '',
      상품명: sec.상품명 || '(상품명 없음)',
      premium: _prem,
      // 계약일: 상위표 매칭값 → 없으면 productSummary 보장시작일
      계약일: (ins && (ins['계약일'] || '')) || sec.보장시작일 || '',
      보장시작일: sec.보장시작일 || '',
      월납보험료: sec.월납보험료 || '',   // 폴백용 원본 보존
      갱신유무: (ins && (ins['갱신 유무'] || ins['갱신유무'])) || '',
      // 갱신주기: ①보장시작~종료일 갭(가장 정확) → ②상품/특약명 "N년갱신" → (없으면 분석기 기본 20)
      갱신주기: _detectCycleFromDates(productRows) || _detectCycle(sec, coverages, ins),
      coverages
    });
  });
  return products;
}

// 상품 선택 UI 갱신 — 카드 리스트 형태 (체크박스 다중 선택)
function _renderProductPicker() {
  const section = document.getElementById('productPickerSection');
  const cardList = document.getElementById('productCardList');
  const count = document.getElementById('productPickerCount');
  if (!section || !cardList) return;
  const products = _getProductsFromExtractedData();
  if (products.length === 0) {
    section.style.display = 'none';
    _selectedProductKeys.clear();
    return;
  }
  section.style.display = '';
  // 🆕 추출 후 첫 표시 시 — 보낼 페이지 설정(cfg) 펼치고 mmlfcp 옵션 자동 동기화
  if (!window._cfgSyncedOnce) {
    window._cfgSyncedOnce = true;
    const cb = document.getElementById('cfgBody');
    const cv = document.getElementById('cfgChevron');
    if (cb) cb.style.display = 'block';
    if (cv) cv.textContent = '▲';
    if (typeof _syncFormOptions === 'function') { try { _syncFormOptions(false); } catch (e) {} }
  }
  // 존재하지 않는 key 정리
  const validKeys = new Set(products.map(p => p.key));
  _selectedProductKeys.forEach(k => { if (!validKeys.has(k)) _selectedProductKeys.delete(k); });
  const selCount = _selectedProductKeys.size;
  count.textContent = `총 ${products.length}개 상품${selCount ? ` · ${selCount}개 선택` : ''}`;
  // 🆕 다중 선택 시 — 한 번에 갱신분석 버튼 (2개 이상 선택)
  const _multiBar = selCount > 1
    ? `<div style="margin-bottom:8px;"><button id="__multiAnaBtn" style="width:100%; border:none; background:#dc2626; color:#fff; border-radius:6px; padding:9px; font-size:12px; font-weight:800; cursor:pointer;">📈 선택한 ${selCount}개 상품 한 번에 갱신분석 (합산/상품별)</button></div>`
    : '';
  // 카드 렌더링 (체크박스)
  cardList.innerHTML = _multiBar + products.map(p => {
    const isSel = _selectedProductKeys.has(p.key);
    const sampleCovs = p.coverages.slice(0, 3).map(c => c.name).join(', ');
    const extra = p.coverages.length > 3 ? ` 외 ${p.coverages.length - 3}개` : '';
    return `
      <div class="product-card" data-key="${p.key}" style="cursor:pointer; padding:8px 10px; border-radius:6px; border:2px solid ${isSel ? '#6366f1' : '#e5e7eb'}; background:${isSel ? '#eef2ff' : '#fff'}; transition:all 0.15s;">
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="width:16px; height:16px; border-radius:4px; border:2px solid ${isSel ? '#6366f1' : '#d1d5db'}; background:${isSel ? '#6366f1' : '#fff'}; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:11px; font-weight:900; line-height:1;">
            ${isSel ? '✓' : ''}
          </div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:11.5px; font-weight:700; color:#1f2937; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${p.상품명}">${p.상품명}</div>
            <div style="font-size:10px; color:#6b7280; margin-top:1px;">[${p.보험사명}] · ${p.coverages.length}개 담보${p.premium > 0 ? ` · <span style="color:#2563eb; font-weight:700;">💰 ${p.premium.toLocaleString()}원</span>` : ''}</div>
            <div style="font-size:9.5px; color:#9ca3af; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${sampleCovs}${extra}</div>
          </div>
          <button class="ana-send-btn" data-ana="${p.key}" title="이 상품으로 갱신형 보험료 분석 보내기" style="flex-shrink:0; border:none; background:#fee2e2; color:#dc2626; border-radius:6px; padding:6px 9px; font-size:11px; font-weight:800; cursor:pointer; white-space:nowrap;">📈 갱신분석</button>
        </div>
      </div>
    `;
  }).join('');
  // 🆕 다중 갱신분석 버튼 핸들러
  const _mb = document.getElementById('__multiAnaBtn');
  if (_mb) _mb.addEventListener('click', (e) => {
    e.stopPropagation();
    const sel = products.filter(p => _selectedProductKeys.has(p.key));
    if (sel.length) sendMultiToRenewalAnalyzer(sel);
  });
  // 카드 클릭 이벤트 — 체크박스 토글 (다중)
  cardList.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', () => {
      const key = card.dataset.key;
      if (_selectedProductKeys.has(key)) _selectedProductKeys.delete(key);
      else _selectedProductKeys.add(key);
      _renderProductPicker();  // 재렌더링
    });
  });
  // 🆕 [📈 갱신분석] — 그 상품 정보를 갱신형 보험료 분석기로 전송 (카드 선택과 분리)
  cardList.querySelectorAll('.ana-send-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const prod = products.find(p => p.key === btn.dataset.ana);
      if (prod) sendToRenewalAnalyzer(prod);
    });
  });
  _renderProductPreview();
}

// 🆕 갱신형 보험료 분석기로 상품 정보 전송 (CRM analyzer.html)
const RENEWAL_ANALYZER_URL = 'https://ympaint-86457.web.app/analyzer.html';
function _ageFromBirth(b) {
  const s = String(b || '').replace(/[^0-9]/g, '');
  if (s.length >= 8) {
    const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
    const t = new Date(); let a = t.getFullYear() - y;
    if ((t.getMonth() + 1) < m || ((t.getMonth() + 1) === m && t.getDate() < d)) a--;
    return a > 0 && a < 120 ? a : '';
  }
  return '';
}
function _toIsoDate(s) {
  const d = String(s || '').replace(/[^0-9]/g, '');
  if (d.length >= 8) return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
  return '';
}
function sendToRenewalAnalyzer(prod) {
  try {
    const cust = (extractedData && extractedData.customer) || {};
    const name = cust['고객명'] || cust.name || '';
    let age = cust['보험나이'] || _ageFromBirth(cust['생년월일'] || cust['생년월일표시']) || '';
    const pname = prod.상품명 || prod['상품명'] || '';
    // 🆕 보험료 폴백 — prod.premium(상위표 매칭값)이 0이면 prod 자체의 다른 보험료 필드 사용
    //    (이름 매칭 실패로 premium=0 이 되어 '값이 안 들어오던' 버그 보완)
    let prem = prod.premium || 0;
    if (!prem) {
      const _n = v => parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10) || 0;
      prem = _n(prod['월납보험료']) || _n(prod['보험료']) || _n(prod['총보험료']) || 0;
    }
    // 갱신주기: ①특약/상품 탐지값 → ②상품명 "N년" → ③기본 20 (분석기에서 커스텀 가능)
    let cycle = prod.갱신주기 || prod['갱신주기'] || '';
    if (!cycle) { const cm = pname.match(/(\d{1,2})\s*년/); if (cm) cycle = +cm[1]; }
    if (!cycle) cycle = 20;
    // 🆕 계약일 폴백
    const _cd = prod.계약일 || prod['계약일'] || (cust['계약일'] || '');
    const payload = {
      name: String(name), age: String(age), prem: String(prem || ''),
      cycle: String(cycle), product: pname,
      contractDate: _toIsoDate(_cd)
    };
    // 🆕 진단 로그 — 어떤 값이 비는지 콘솔에서 바로 확인 가능
    console.log('[갱신분석 전송] payload=', payload, '| prod=', prod);
    const _empties = Object.entries(payload).filter(([k, v]) => k !== 'contractDate' && (v === '' || v == null)).map(([k]) => k);
    if (_empties.length) console.warn('[갱신분석 전송] 빈 값 필드:', _empties.join(', '), '— 상위표 매칭 실패 가능. prod 원본 확인 필요.');

    const data = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    // 🆕 base64 의 '+' '/' '=' 가 URL 쿼리에서 깨지지 않도록 encodeURIComponent 로 감쌈
    //    (이전: 그대로 붙여 '+'가 공백으로 바뀌어 분석기 디코드 실패)
    const url = RENEWAL_ANALYZER_URL + '?data=' + encodeURIComponent(data);

    // 🆕 이미 열려 있는 갱신분석기 탭이 있으면 그 탭을 새 URL로 갱신(reload)해 '같은 탭에서 값이 안 바뀌던' 버그 해결.
    //    없으면 새 탭 생성. (URL 의 ?data 가 매번 달라 update 만으로 재로딩 → readIntake 가 새 값 적용)
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ url: RENEWAL_ANALYZER_URL + '*' }, function (tabs) {
        try {
          if (tabs && tabs.length) {
            const t = tabs[0];
            chrome.tabs.update(t.id, { url: url, active: true });
            if (t.windowId != null && chrome.windows && chrome.windows.update) {
              try { chrome.windows.update(t.windowId, { focused: true }); } catch (e) {}
            }
          } else {
            chrome.tabs.create({ url: url });
          }
        } catch (e) {
          try { chrome.tabs.create({ url: url }); } catch (_) { window.open(url, '_blank'); }
        }
      });
    } else {
      window.open(url, '_blank');
    }
  } catch (err) {
    showAlert('갱신분석 전송 실패: ' + (err && err.message ? err.message : err));
  }
}

// 🆕 여러 상품을 한 번에 갱신분석기로 전송 (analyzer 가 합산/상품별 토글로 표시)
function sendMultiToRenewalAnalyzer(prods) {
  try {
    if (!prods || !prods.length) return;
    if (prods.length === 1) { sendToRenewalAnalyzer(prods[0]); return; }
    const cust = (extractedData && extractedData.customer) || {};
    const name = cust['고객명'] || cust.name || '';
    let age = cust['보험나이'] || _ageFromBirth(cust['생년월일'] || cust['생년월일표시']) || '';
    const _n = v => parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10) || 0;
    const products = prods.map(prod => {
      const pname = prod.상품명 || prod['상품명'] || '';
      let prem = prod.premium || 0;
      if (!prem) prem = _n(prod['월납보험료']) || _n(prod['보험료']) || _n(prod['총보험료']) || 0;
      let cycle = prod.갱신주기 || prod['갱신주기'] || '';
      if (!cycle) { const cm = pname.match(/(\d{1,2})\s*년/); if (cm) cycle = +cm[1]; }
      if (!cycle) cycle = 20;
      const _cd = prod.계약일 || prod['계약일'] || prod.보장시작일 || '';
      return { product: pname, age: String(age), prem: String(prem || ''), cycle: String(cycle), contractDate: _toIsoDate(_cd) };
    });
    const payload = { name: String(name), age: String(age), products };
    console.log('[갱신분석 다중전송] payload=', payload);
    const data = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    const url = RENEWAL_ANALYZER_URL + '?data=' + encodeURIComponent(data);
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ url: RENEWAL_ANALYZER_URL + '*' }, function (tabs) {
        try {
          if (tabs && tabs.length) {
            const t = tabs[0];
            chrome.tabs.update(t.id, { url: url, active: true });
            if (t.windowId != null && chrome.windows && chrome.windows.update) { try { chrome.windows.update(t.windowId, { focused: true }); } catch (e) {} }
          } else { chrome.tabs.create({ url: url }); }
        } catch (e) { try { chrome.tabs.create({ url: url }); } catch (_) { window.open(url, '_blank'); } }
      });
    } else { window.open(url, '_blank'); }
  } catch (err) {
    showAlert('다중 갱신분석 전송 실패: ' + (err && err.message ? err.message : err));
  }
}

// ── 담보 학습(편집) 데이터 — 금액 수정/삭제/추가를 localStorage 에 저장해 다음에도 자동 적용 ──
const _COV_LEARN_KEY = 'cov_learn_v1';
const _covNorm = s => String(s || '').replace(/\s/g, '').toLowerCase();
function _loadCovLearn() {
  try {
    const d = JSON.parse(localStorage.getItem(_COV_LEARN_KEY));
    if (d && typeof d === 'object') return { overrides: d.overrides || {}, deleted: d.deleted || [], added: d.added || [] };
  } catch (e) {}
  return { overrides: {}, deleted: [], added: [] };
}
function _saveCovLearn(d) { try { localStorage.setItem(_COV_LEARN_KEY, JSON.stringify(d)); } catch (e) {} }

function _renderProductPreview() {
  const preview = document.getElementById('productPickerPreview');
  if (!preview) return;
  if (!_selectedProductKeys || _selectedProductKeys.size === 0) { preview.style.display = 'none'; return; }
  const merged = _getSelectedProductCoverages();
  if (!merged || merged.length === 0) { preview.style.display = 'none'; return; }
  preview.style.display = '';
  const rows = merged.map(c => {
    const amt = parseInt(String(c.amount || '').replace(/[^0-9]/g, '')) || 0;
    const tag = c._added ? '<span style="color:#16a34a;font-size:9px;">추가</span>' : (c._edited ? '<span style="color:#d97706;font-size:9px;">수정</span>' : '');
    return `<div style="display:flex;align-items:center;gap:4px;padding:2px 0;border-bottom:1px solid #f3f4f6;">
      <span style="flex:1;min-width:0;font-size:10.5px;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${c.name}">${c.name} ${tag}</span>
      <input data-cov="${encodeURIComponent(c.name)}" value="${amt || ''}" placeholder="0" style="width:58px;font-size:10.5px;text-align:right;border:1px solid #d1d5db;border-radius:4px;padding:2px 4px;" />
      <span style="font-size:9.5px;color:#9ca3af;">만</span>
      <button data-del="${encodeURIComponent(c.name)}" title="이 담보 삭제(학습)" style="border:none;background:#fef2f2;color:#ef4444;border-radius:4px;cursor:pointer;font-size:11px;padding:1px 5px;">🗑</button>
    </div>`;
  }).join('');
  preview.innerHTML = `
    <div style="font-weight:700;font-size:11px;color:#4338ca;margin-bottom:4px;">📝 전송 담보 — 편집·학습 (${merged.length}개)</div>
    <div style="font-size:9px;color:#9ca3af;margin-bottom:4px;">담보금을 직접 수정/삭제/추가하면 자동 저장되어 다음에도 적용됩니다. (받아오는 페이지와 담보명이 달라도 직접 맞출 수 있어요)</div>
    <div id="covEditList" style="max-height:230px;overflow:auto;">${rows}</div>
    <div style="display:flex;gap:4px;margin-top:6px;">
      <input id="newCovName" placeholder="담보명 추가" style="flex:1;min-width:0;font-size:10.5px;border:1px solid #d1d5db;border-radius:4px;padding:3px 5px;" />
      <input id="newCovAmt" placeholder="만원" style="width:55px;font-size:10.5px;text-align:right;border:1px solid #d1d5db;border-radius:4px;padding:3px 5px;" />
      <button id="addCovBtn" style="border:none;background:#6366f1;color:#fff;border-radius:4px;cursor:pointer;font-size:11px;font-weight:700;padding:3px 9px;">+ 추가</button>
    </div>
    <div style="text-align:right;margin-top:4px;"><button id="resetCovLearn" style="border:none;background:none;color:#ef4444;text-decoration:underline;cursor:pointer;font-size:9.5px;">학습 초기화</button></div>
  `;
  // 금액 수정 → 학습 저장
  preview.querySelectorAll('input[data-cov]').forEach(inp => {
    inp.addEventListener('change', () => {
      const name = decodeURIComponent(inp.dataset.cov);
      const amt = parseInt(inp.value.replace(/[^0-9]/g, '')) || 0;
      const learn = _loadCovLearn();
      learn.overrides[_covNorm(name)] = amt;
      _saveCovLearn(learn);
      _renderProductPreview();
    });
  });
  // 삭제 → 학습 저장
  preview.querySelectorAll('button[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = decodeURIComponent(btn.dataset.del);
      const learn = _loadCovLearn();
      const n = _covNorm(name);
      if (!learn.deleted.includes(n)) learn.deleted.push(n);
      learn.added = (learn.added || []).filter(a => _covNorm(a.name) !== n);
      delete learn.overrides[n];
      _saveCovLearn(learn);
      _renderProductPreview();
    });
  });
  // 담보 추가 → 학습 저장
  const addBtn = preview.querySelector('#addCovBtn');
  if (addBtn) addBtn.addEventListener('click', () => {
    const nm = (preview.querySelector('#newCovName').value || '').trim();
    const amt = parseInt((preview.querySelector('#newCovAmt').value || '').replace(/[^0-9]/g, '')) || 0;
    if (!nm) { showAlert('담보명을 입력하세요.'); return; }
    const learn = _loadCovLearn();
    learn.added = learn.added || [];
    learn.added.push({ name: nm, amountMan: amt });
    learn.deleted = learn.deleted.filter(d => d !== _covNorm(nm));
    _saveCovLearn(learn);
    _renderProductPreview();
  });
  // 학습 초기화
  const resetBtn = preview.querySelector('#resetCovLearn');
  if (resetBtn) resetBtn.addEventListener('click', async () => {
    if (await showConfirm('담보 학습(수정·삭제·추가)을 모두 초기화할까요?', '학습 초기화')) {
      _saveCovLearn({ overrides: {}, deleted: [], added: [] });
      _renderProductPreview();
    }
  });
}

// 선택된 상품들의 담보+금액 합산 배열 반환 (mmlfcp 전송용) — 학습(편집) 반영
//   여러 상품에 같은 담보명이 있으면 금액을 합산. 그 위에 학습(금액 오버라이드/삭제/추가) 적용.
function _getSelectedProductCoverages() {
  if (!_selectedProductKeys || _selectedProductKeys.size === 0) return null;
  const products = _getProductsFromExtractedData();
  const selected = products.filter(p => _selectedProductKeys.has(p.key));
  if (selected.length === 0) return null;
  const merged = {};       // normName → { name, amountMan, order }
  let order = 0;
  selected.forEach(p => {
    (p.coverages || []).forEach(c => {
      const key = String(c.name || '').replace(/\s/g, '');
      if (!key) return;
      if (!merged[key]) merged[key] = { name: c.name, amountMan: 0, order: order++ };
      merged[key].amountMan += _parseAmtToMan(c.amount);
    });
  });
  let result = Object.values(merged)
    .sort((a, b) => a.order - b.order)
    .map(m => ({ name: m.name, amountMan: m.amountMan, _edited: false, _added: false }));

  // 🆕 학습 적용
  const learn = _loadCovLearn();
  // 삭제
  result = result.filter(c => !learn.deleted.includes(_covNorm(c.name)));
  // 금액 오버라이드
  result = result.map(c => {
    const ov = learn.overrides[_covNorm(c.name)];
    return (ov != null) ? { name: c.name, amountMan: ov, _edited: true, _added: false } : c;
  });
  // 추가
  (learn.added || []).forEach(a => result.push({ name: a.name, amountMan: a.amountMan || 0, _edited: false, _added: true }));

  return result.map(c => ({ name: c.name, amount: c.amountMan > 0 ? `${c.amountMan}만원` : '', _edited: c._edited, _added: c._added }));
}

// 🆕 보험료 비교 자동 설정 — 영속 저장 + 템플릿 + 프리셋

// Absence studio transfer product selection rule.
// Partial selection: selected products only. No selection or all selected: all products.
const _ABS_KEYS = {
  productName: '상품명',
  insurerName: '보험사명',
  monthlyPremium: '월납보험료',
  totalPremium: '총보험료',
  contractDate: '계약일',
  startDate: '보장시작일',
  insuranceName: '보험명',
  remainingPremium: '잔여보험료',
  payPeriod: '납입주기/납입기간',
  payCycle: '납입주기',
  expiry: '보장만기/만기연령',
  renewSpaced: '갱신 유무',
  renew: '갱신유무',
  customerName: '고객명',
  insuranceAge: '보험나이',
  age: '나이',
  gender: '성별',
  ageDate: '상령일',
  phone: '연락처',
  policyCount: '보험개수',
  monthlyTotal: '월납합계',
  remainingTotal: '잔여합계',
  extractedAt: '추출시각'
};
function _normPolicyText(s) {
  return String(s || '').replace(/s+/g, '').toLowerCase();
}
function _numOnly(v) {
  return parseInt(String(v == null ? '' : v).replace(/[^d]/g, ''), 10) || 0;
}
function _absenceProductMatchesInsurance(product, ins) {
  const K = _ABS_KEYS;
  const pName = _normPolicyText(product && product[K.productName]);
  const pCompany = _normPolicyText(product && product[K.insurerName]);
  const pPremium = _numOnly(product && (product.premium || product[K.monthlyPremium]));
  const pDate = _normPolicyText(product && (product[K.contractDate] || product[K.startDate]));

  const iName = _normPolicyText(ins && (ins[K.insuranceName] || ins[K.productName]));
  const iCompany = _normPolicyText(ins && ins[K.insurerName]);
  const iPremium = _numOnly(ins && (ins[K.monthlyPremium] || ins[K.totalPremium]));
  const iDate = _normPolicyText(ins && ins[K.contractDate]);

  const nameMatch = !!pName && !!iName && (pName === iName || pName.includes(iName) || iName.includes(pName));
  const companyMatch = !pCompany || !iCompany || pCompany === iCompany || pCompany.includes(iCompany) || iCompany.includes(pCompany);
  const premiumMatch = !pPremium || !iPremium || pPremium === iPremium;
  const dateMatch = !pDate || !iDate || pDate === iDate || pDate.slice(0, 7) === iDate.slice(0, 7);
  return nameMatch && companyMatch && premiumMatch && dateMatch;
}
function _getAbsenceEffectiveInsurances(data) {
  const insList = Array.isArray(data && data.insurances) ? data.insurances : [];
  if (!insList.length) return [];
  const products = _getProductsFromExtractedData();
  if (!products.length || !_selectedProductKeys || _selectedProductKeys.size === 0) return insList;
  const selectedProducts = products.filter(p => _selectedProductKeys.has(p.key));
  if (selectedProducts.length === 0 || selectedProducts.length >= products.length) return insList;
  const selectedIndexes = new Set(selectedProducts.map(p => products.indexOf(p)).filter(i => i >= 0));
  const filtered = insList.filter((ins, idx) =>
    selectedIndexes.has(idx) || selectedProducts.some(p => _absenceProductMatchesInsurance(p, ins))
  );
  return filtered.length ? filtered : insList;
}
function _buildAbsenceStudioPayload(data) {
  const K = _ABS_KEYS;
  const cust = (data && data.customer) || {};
  const insList = _getAbsenceEffectiveInsurances(data);
  const monthSum = insList.reduce((s, i) => s + _numOnly(i[K.monthlyPremium]), 0);
  const remainSum = insList.reduce((s, i) => s + _numOnly(i[K.remainingPremium]), 0);
  const policyList = insList.map(ins => ({
    name:         ins[K.insuranceName] || ins[K.insurerName] || '',
    company:      ins[K.insurerName] || '',
    premium:      _numOnly(ins[K.monthlyPremium]),
    pay:          ins[K.payPeriod] || ins[K.payCycle] || '',
    expiry:       String(ins[K.expiry] || '').trim(),
    renew:        ins[K.renewSpaced] || ins[K.renew] || '',
    contractDate: ins[K.contractDate] || ''
  }));
  const payload = {
    [K.customerName]:   cust[K.customerName] || cust.name || '',
    [K.age]:            cust[K.insuranceAge] || '',
    [K.gender]:         cust[K.gender] || '',
    [K.ageDate]:        cust[K.ageDate] || '',
    [K.phone]:          cust[K.phone] || cust.phone || '',
    [K.policyCount]:    insList.length,
    [K.monthlyTotal]:   monthSum,
    [K.remainingTotal]: remainSum,
    policyList,
    [K.extractedAt]:    new Date().toISOString()
  };
  return { payload, policyList };
}
function _openAbsenceStudio(data) {
  const STUDIO_URL = 'https://toss-insurance-studio.web.app';
  const pack = _buildAbsenceStudioPayload(data);
  const payload = pack.payload;
  const policyList = pack.policyList;
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const studioTab = window.open(STUDIO_URL + '/#studio=' + b64, '_blank');
  if (studioTab) {
    let _tries = 0;
    const _iv = setInterval(() => {
      _tries++;
      try { studioTab.postMessage({ __studioInit: true, policyList, payload }, '*'); } catch {}
      if (_tries >= 10) clearInterval(_iv);
    }, 800);
  }
}
