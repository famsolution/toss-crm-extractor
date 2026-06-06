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
    products.push({
      key: `${sec.섹션번호}::${sec.상품명}`,
      섹션번호: sec.섹션번호,
      보험사명: sec.보험사명 || '',
      상품명: sec.상품명 || '(상품명 없음)',
      premium: _premiumFrom(ins),
      계약일: ins ? (ins['계약일'] || '') : '',
      갱신유무: ins ? (ins['갱신 유무'] || ins['갱신유무'] || '') : '',
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
  // 카드 렌더링 (체크박스)
  cardList.innerHTML = products.map(p => {
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
    const pname = prod.상품명 || '';
    // 갱신주기: ①특약/상품 탐지값 → ②상품명 "N년" → ③기본 20 (분석기에서 커스텀 가능)
    let cycle = prod.갱신주기 || '';
    if (!cycle) { const cm = pname.match(/(\d{1,2})\s*년/); if (cm) cycle = +cm[1]; }
    if (!cycle) cycle = 20;
    const payload = {
      name: String(name), age: String(age), prem: String(prod.premium || ''),
      cycle: String(cycle), product: pname,
      contractDate: _toIsoDate(prod.계약일 || '')
    };
    const data = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    const url = RENEWAL_ANALYZER_URL + '?data=' + data;
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url });
    else window.open(url, '_blank');
  } catch (err) {
    alert('갱신분석 전송 실패: ' + (err && err.message ? err.message : err));
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
    if (!nm) { alert('담보명을 입력하세요.'); return; }
    const learn = _loadCovLearn();
    learn.added = learn.added || [];
    learn.added.push({ name: nm, amountMan: amt });
    learn.deleted = learn.deleted.filter(d => d !== _covNorm(nm));
    _saveCovLearn(learn);
    _renderProductPreview();
  });
  // 학습 초기화
  const resetBtn = preview.querySelector('#resetCovLearn');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    if (confirm('담보 학습(수정·삭제·추가)을 모두 초기화할까요?')) {
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
const CFG_KEY = 'premium_compare_cfg';
const CFG_TEMPLATES_KEY = 'premium_compare_templates';
const TARGET_MODE_KEY = 'apply_target_mode';

// 현재 선택된 전송 대상 ('auto' | 'consult' | 'standard' | 'plan' | 'premium-page')
function getTargetMode() {
  const el = document.querySelector('input[name="targetMode"]:checked');
  return el?.value || 'auto';
}
function setTargetMode(mode) {
  const el = document.querySelector(`input[name="targetMode"][value="${mode}"]`);
  if (el) el.checked = true;
}
// 🆕 데이터 type 에 따라 호환되지 않는 전송 대상 라디오를 자동 비활성화
//   compatibility map:
//     coverage         → standard ✅, auto ✅, plan ❌, premium-page ❌
//     customer         → standard ✅, auto ✅, plan ❌, premium-page ✅
//     premium_compare  → standard ❌, auto ✅, plan ✅, premium-page ✅
function syncTargetCompatibility() {
  const type = extractedData?.type || null;
  const radios = {
    auto:        document.querySelector('input[name="targetMode"][value="auto"]'),
    consult:     document.querySelector('input[name="targetMode"][value="consult"]'),
    standard:    document.querySelector('input[name="targetMode"][value="standard"]'),
    plan:        document.querySelector('input[name="targetMode"][value="plan"]'),
    'premium-page': document.querySelector('input[name="targetMode"][value="premium-page"]')
  };
  // mmlfcp 폼은 cust 정보를 lastCustomer (이전 추출) 로도 채울 수 있으므로
  // coverage / premium_compare 도 premium-page 허용 (cfg.coverages + lastCustomer 사용)
  const compatMap = {
    coverage:        { auto: true, consult: true,  standard: true,  plan: false, 'premium-page': true },
    customer:        { auto: true, consult: true,  standard: true,  plan: false, 'premium-page': true },
    premium_compare: { auto: true, consult: false, standard: false, plan: true,  'premium-page': true }
  };
  const compat = compatMap[type] || { auto: true, consult: true, standard: true, plan: true, 'premium-page': true };
  Object.entries(radios).forEach(([key, el]) => {
    if (!el) return;
    const label = el.closest('label');
    const ok = compat[key];
    el.disabled = !ok;
    if (label) {
      label.style.opacity = ok ? '' : '0.4';
      label.style.cursor = ok ? '' : 'not-allowed';
      label.title = ok ? '' : `이 데이터(${type})는 ${key} 로 전송할 수 없습니다`;
    }
  });
  // 현재 선택이 비호환이면 첫 호환 옵션으로 자동 전환
  const cur = getTargetMode();
  if (compat[cur] === false) {
    const fallback = ['auto', 'consult', 'standard', 'plan', 'premium-page'].find(k => compat[k]);
    if (fallback) {
      setTargetMode(fallback);
      try { chrome.storage.local.set({ [TARGET_MODE_KEY]: fallback }); } catch {}
      updateTargetHint();
      // 사용자에게 시각적으로 알림
      const hint = document.getElementById('targetModeHint');
      if (hint) {
        const prev = hint.textContent;
        hint.style.color = '#dc2626';
        hint.textContent = `⚠ "${cur}" 는 ${type} 데이터와 호환되지 않아 "${fallback}" 으로 자동 전환됨`;
        setTimeout(() => { hint.style.color = ''; hint.textContent = prev; }, 3500);
      }
    }
  }
}

function updateTargetHint() {
  const mode = getTargetMode();
  const hint = document.getElementById('targetModeHint');
  if (!hint) return;
  const map = {
    'auto': '데이터 종류에 따라 자동으로 적절한 페이지로 전송됩니다',
    'consult': '고객 상담등록 페이지(page_jmin.html)로 전송 — 추출한 고객정보를 상담등록 폼에 자동 입력',
    'standard': '보장분석 프로그램의 표준 보장분석 모드로 전송 — 보험상품/담보 매트릭스 채우기',
    'plan': '보장분석 프로그램의 가설계 탭 (premium_plan iframe) 으로 전송',
    'premium-page': '현재 활성 탭(보험료 비교 페이지) 의 폼을 자동 입력 — 이름/생년월일/성별/유형/만기/담보'
  };
  hint.textContent = map[mode] || '';
}

// 🆕 담보 카탈로그 — 카테고리별 그룹화 (한장으로 보는 보험료 비교 페이지의 89개 담보)
const COVERAGE_CATALOG = [
  { cat: '🚑 상해·사망·배상', items: [
    { cd: 'a001', name: '상해후유장해(3~100%)' },
    { cd: 'a005', name: '상해고도후유(80%이상)' },
    { cd: 'a012', name: '상해사망' },
    { cd: 'a017', name: '질병후유장해(3~100%)' },
    { cd: 'a022', name: '질병고도후유(80%이상)' },
    { cd: 'a023', name: '질병사망' },
    { cd: 'a042', name: '가족일상생활중배상책임' }
  ]},
  { cat: '🩺 암', items: [
    { cd: 'b001', name: '통합암진단비' },
    { cd: 'b002', name: '암진단비(유사암제외)' },
    { cd: 'b004', name: '특정암진단비' },
    { cd: 'b005', name: '고액암진단비' },
    { cd: 'b006', name: '유사암진단비' },
    { cd: 'b007', name: '재진단암진단비' },
    { cd: 'b010', name: '암수술비(1회,유사암제외)' },
    { cd: 'b011', name: '암수술비(매회,유사암포함)' },
    { cd: 'b013', name: '암직접치료입원일당(1-180,요양병원제외)' },
    { cd: 'b016', name: '암요양병원입원비(1~90)' },
    { cd: 'b019', name: '다빈치로봇암수술비' },
    { cd: 'b021', name: '항암방사선약물치료비(최초1회한)' },
    { cd: 'b023', name: '표적항암약물허가치료비(최초1회한)' },
    { cd: 'b026', name: '항암중입자방사선지료비(최초1회한)' },
    { cd: 'b040', name: '카티(CAR-T)항암약물허가치료비' },
    { cd: 'b045', name: '중증질환자암산정특례대상진단' },
    { cd: 'b051', name: '암직접치료통원일당' },
    { cd: 'b052', name: '암직접치료통원일당(상급종합병원)' },
    { cd: 'b056', name: '암주요치료비(10년)' },
    { cd: 'b059', name: '암상급종합병원주요치료비(10년)' },
    { cd: 'b064', name: '하이클래스암주요치료비(10년)' },
    { cd: 'b068', name: '암주요치료비(만기보장)' },
    { cd: 'b070', name: '암상급종합병원주요치료비(만기보장)' }
  ]},
  { cat: '🧠 뇌·뇌심', items: [
    { cd: 'c001', name: '뇌혈관질환진단비' },
    { cd: 'c002', name: '통합뇌진단비' },
    { cd: 'c003', name: '뇌졸중진단비' },
    { cd: 'c006', name: '뇌출혈진단비' },
    { cd: 'c007', name: '뇌혈관질환수술비(매회)' },
    { cd: 'c008', name: '중증질환자뇌혈관산정특례대상' },
    { cd: 'c009', name: '뇌질환통원일당' },
    { cd: 'c010', name: '뇌질환통원일당(상급종합병원)' },
    { cd: 'cc11', name: '뇌심질환통원일당' },
    { cd: 'cc12', name: '뇌심질환통원일당(상급종합병원)' }
  ]},
  { cat: '❤️ 심장·순환계·2대질환', items: [
    { cd: 'd000', name: '심장질환진단비' },
    { cd: 'd001', name: '허혈성심장질환진단비' },
    { cd: 'd002', name: '통합심장진단비' },
    { cd: 'd003', name: '급성심근경색증진단비' },
    { cd: 'd004', name: '허혈성심장질환수술비(매회)' },
    { cd: 'd005', name: '2대질환주요치료비(10년)' },
    { cd: 'd007', name: '2대질환상급종합병원주요치료비(10년)' },
    { cd: 'd008', name: '2대질환주요치료비(만기보장)' },
    { cd: 'd010', name: '2대질환상급종합병원주요치료비(만기보장)' },
    { cd: 'd013', name: '중증질환자심장질환산정특례' },
    { cd: 'd014', name: '심장질환통원일당' },
    { cd: 'd015', name: '심장질환통원일당(상급종합병원)' },
    { cd: 'd018', name: '순환계질환진단비' },
    { cd: 'd020', name: '순환계주요치료비(10년)' },
    { cd: 'd021', name: '순환계주요치료비(10년)상급종합병원' },
    { cd: 'd022', name: '순환계주요치료비(만기보장)' },
    { cd: 'd023', name: '순환계주요치료비(만기보장)상급종합병원' }
  ]},
  { cat: '🏥 수술·입원·기타', items: [
    { cd: 'e001', name: '상해수술비' },
    { cd: 'e003', name: '질병수술비' },
    { cd: 'e006', name: 'N대질병수술비' },
    { cd: 'e008', name: '혈전용해치료비' },
    { cd: 'e018', name: '상해(1~5종)수술비 (5종기준)' },
    { cd: 'e019', name: '질병(1~5종)수술비 (5종기준)' },
    { cd: 'e022', name: '질병입원비' },
    { cd: 'e023', name: '질병중환자실입원비' },
    { cd: 'e024', name: '상해입원비' },
    { cd: 'e025', name: '상해중환자실입원비' },
    { cd: 'e026', name: '간병인상해입원일당(요양병원포함)' },
    { cd: 'e027', name: '간병인질병입원일당(요양병원포함)' },
    { cd: 'e028', name: '상해간호간병통합서비스' },
    { cd: 'e029', name: '질병간호간병통합서비스' },
    { cd: 'e031', name: '통풍진단비' },
    { cd: 'e032', name: '대상포진진단비' },
    { cd: 'e035', name: '골절진단비(치아파절제외)' },
    { cd: 'e039', name: '화상진단비' },
    { cd: 'ee07', name: '뇌혈관질환및허혈성심장질환수술비' },
    { cd: 'ee09', name: '질병상해(1~5종)수술비 (5종기준)' }
  ]},
  { cat: '🛏 입원실 (상해+질병)', items: [
    { cd: 'e061', name: '상해입원 2~3인 종합병원(상급)' },
    { cd: 'e062', name: '질병입원 2~3인 종합병원(상급)' },
    { cd: 'e063', name: '상해입원 2~3인 종합병원' },
    { cd: 'e064', name: '질병입원 2~3인 종합병원' },
    { cd: 'e065', name: '상해입원 1인실 종합병원(상급)' },
    { cd: 'e066', name: '질병입원 1인실 종합병원(상급)' },
    { cd: 'e067', name: '상해입원 1인실 종합병원' },
    { cd: 'e068', name: '질병입원 1인실 종합병원' },
    { cd: 'ee59', name: '상해 및 질병 2~3인실 종합병원(상급)' },
    { cd: 'ee60', name: '상해 및 질병 2~3인실 종합병원' },
    { cd: 'ee69', name: '상해 및 질병 1인실 종합병원(상급)' },
    { cd: 'ee70', name: '상해 및 질병 1인실 종합병원' }
  ]}
];

// 선택된 담보 set
const _selectedCoverages = new Set();
function _renderCoverageList() {
  const container = document.getElementById('cfgCovList');
  if (!container) return;
  container.innerHTML = '';
  COVERAGE_CATALOG.forEach((g, gi) => {
    const cat = document.createElement('div');
    cat.className = 'cov-cat';
    const pickedCount = g.items.filter(it => _selectedCoverages.has(it.name)).length;
    cat.innerHTML = `
      <div class="cov-cat-header" data-cat-idx="${gi}">
        <div class="left"><span class="chevron">▶</span><span>${g.cat}</span></div>
        <div class="cov-cat-count">
          ${pickedCount > 0 ? `<span class="picked">${pickedCount}</span>/` : ''}${g.items.length}
        </div>
      </div>
      <div class="cov-cat-body">
        ${g.items.map(it => `
          <label class="cov-row" data-name="${it.name}">
            <input type="checkbox" data-cov="${it.name}" ${_selectedCoverages.has(it.name) ? 'checked' : ''}>
            <span class="cd">${it.cd}</span>
            <span class="nm">${it.name}</span>
          </label>
        `).join('')}
      </div>
    `;
    container.appendChild(cat);
  });
  // 헤더 클릭 = 토글
  container.querySelectorAll('.cov-cat-header').forEach(h => {
    h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
  });
  // 체크박스 변경
  container.querySelectorAll('input[type="checkbox"][data-cov]').forEach(cb => {
    cb.addEventListener('change', () => {
      const name = cb.dataset.cov;
      if (cb.checked) _selectedCoverages.add(name);
      else _selectedCoverages.delete(name);
      _updateCovCountDisplay();
      saveCfgState();
    });
  });
  _updateCovCountDisplay();
}
function _updateCovCountDisplay() {
  const el = document.getElementById('cfgCovCount');
  if (el) el.textContent = `${_selectedCoverages.size}개 선택`;
  // 카테고리 카운트 갱신
  document.querySelectorAll('.cov-cat').forEach((cat, gi) => {
    const g = COVERAGE_CATALOG[gi];
    if (!g) return;
    const pickedCount = g.items.filter(it => _selectedCoverages.has(it.name)).length;
    const countEl = cat.querySelector('.cov-cat-count');
    if (countEl) {
      countEl.innerHTML = (pickedCount > 0 ? `<span class="picked">${pickedCount}</span>/` : '') + `${g.items.length}`;
    }
  });
}
function _setSelectedCoverages(names) {
  _selectedCoverages.clear();
  (names || []).forEach(n => _selectedCoverages.add(String(n).trim()));
  // 모든 카테고리 펼치기 (선택된 항목이 있는 카테고리)
  setTimeout(() => {
    document.querySelectorAll('.cov-cat').forEach((cat, gi) => {
      const g = COVERAGE_CATALOG[gi];
      if (g && g.items.some(it => _selectedCoverages.has(it.name))) cat.classList.add('open');
    });
  }, 0);
  _renderCoverageList();
}
// 미리 정의된 프리셋 (담보 리스트)
const CFG_PRESETS = {
  basic: {
    name: '기본 종합(무해지)',
    insType: 'LF', prodType: '06', maturity: '01',
    coverages: ['상해사망', '질병사망', '암진단비(유사암제외)', '뇌혈관질환진단비', '허혈성심장질환진단비', '수술비(N대)', '입원일당']
  },
  cancer: {
    name: '암 특화',
    insType: 'LF', prodType: '06', maturity: '01',
    coverages: ['통합암진단비', '암진단비(유사암제외)', '특정암진단비', '고액암진단비', '소액암진단비', '항암방사선약물치료비']
  },
  dental: {
    name: '치아보험',
    insType: 'F', prodType: '26', maturity: '01',
    coverages: ['치아보철치료비', '치아보존치료비', '치아우식증', '치주질환']
  },
  driver: {
    name: '운전자보험',
    insType: 'F', prodType: '28', maturity: '01',
    coverages: ['교통상해후유장해', '교통상해사망', '운전자벌금', '교통사고처리지원금', '변호사선임비용']
  }
};

function getCfgFromUI() {
  return {
    insType: document.getElementById('cfgInsType')?.value || 'LF',
    prodType: document.getElementById('cfgProdType')?.value || '06',
    maturity: document.getElementById('cfgMaturity')?.value || '01',
    coverages: Array.from(_selectedCoverages)
  };
}
function setCfgToUI(cfg) {
  if (!cfg) return;
  if (cfg.insType) document.getElementById('cfgInsType').value = cfg.insType;
  if (cfg.prodType) document.getElementById('cfgProdType').value = cfg.prodType;
  if (cfg.maturity) document.getElementById('cfgMaturity').value = cfg.maturity;
  _setSelectedCoverages(cfg.coverages || []);
}
function saveCfgState() {
  try { chrome.storage.local.set({ [CFG_KEY]: getCfgFromUI() }); } catch {}
}
async function loadCfgState() {
  return new Promise(res => {
    try { chrome.storage.local.get([CFG_KEY], v => res(v?.[CFG_KEY] || null)); } catch { res(null); }
  });
}
async function loadTemplates() {
  return new Promise(res => {
    try { chrome.storage.local.get([CFG_TEMPLATES_KEY], v => res(v?.[CFG_TEMPLATES_KEY] || {})); } catch { res({}); }
  });
}
async function saveTemplate(name, cfg) {
  const all = await loadTemplates();
  all[name] = cfg;
  return new Promise(res => {
    try { chrome.storage.local.set({ [CFG_TEMPLATES_KEY]: all }, () => res(true)); } catch { res(false); }
  });
}
async function deleteTemplate(name) {
  const all = await loadTemplates();
  delete all[name];
  return new Promise(res => {
    try { chrome.storage.local.set({ [CFG_TEMPLATES_KEY]: all }, () => res(true)); } catch { res(false); }
  });
}
async function refreshTemplateDropdown() {
  const all = await loadTemplates();
  const sel = document.getElementById('cfgLoadTpl');
  if (!sel) return;
  sel.innerHTML = '<option value="">— 선택 —</option>' +
    Object.keys(all).map(n => `<option value="${n}">${n}</option>`).join('');
}

// DOM 준비 후 이벤트 바인딩
// 🆕 mmlfcp 폼 옵션 동기화 — 페이지의 실제 상품유형/만기 옵션을 cfg 드롭다운에 채움
function _fillCfgSelect(id, opts) {
  const sel = document.getElementById(id);
  if (!sel || !Array.isArray(opts) || opts.length === 0) return;
  const cur = sel.value;
  sel.innerHTML = opts.map(o => `<option value="${o.value}">${(o.text || o.value)}</option>`).join('');
  if (opts.some(o => o.value === cur)) sel.value = cur;   // 기존 선택 유지
}
async function _syncFormOptions(showMsg) {
  const msg = document.getElementById('sync_options_msg');
  const setMsg = (t, color) => { if (msg) { msg.textContent = t; msg.style.color = color || '#9ca3af'; } };
  try {
    const tabs = await chrome.tabs.query({});
    const mtab = tabs.find(t => t.url && /mmlfcp\.ohmymanager\.com|ohmymanager\.com/i.test(t.url));
    if (!mtab) { if (showMsg) setMsg('⚠️ mmlfcp 보험료 비교 페이지를 먼저 열어주세요.', '#ef4444'); return false; }
    const insType = (document.getElementById('cfgInsType') || {}).value || '';
    if (showMsg) setMsg('옵션 불러오는 중…', '#6366f1');
    return await new Promise(resolve => {
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; if (showMsg) setMsg('⚠️ 응답 시간 초과 (페이지 새로고침 후 재시도)', '#ef4444'); resolve(false); } }, 4000);
      chrome.tabs.sendMessage(mtab.id, { action: 'getFormOptions', insType }, resp => {
        if (done) return; done = true; clearTimeout(to);
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          if (showMsg) setMsg('⚠️ 옵션을 못 읽었습니다. 확장 새로고침 후 페이지도 새로고침해 주세요.', '#ef4444');
          resolve(false); return;
        }
        _fillCfgSelect('cfgProdType', resp.prodTypes);
        _fillCfgSelect('cfgMaturity', resp.maturities);
        if (typeof saveCfgState === 'function') try { saveCfgState(); } catch (e) {}
        if (showMsg) setMsg(`✅ 불러옴 — 상품유형 ${(resp.prodTypes || []).length}개 · 만기 ${(resp.maturities || []).length}개`, '#16a34a');
        resolve(true);
      });
    });
  } catch (e) { if (showMsg) setMsg('⚠️ ' + e.message, '#ef4444'); return false; }
}

document.addEventListener('DOMContentLoaded', async () => {
  // 🔐 권한 게이트 — 로그인 + 관리자 승인(active) 통과 못하면 기능 초기화 중단 (게이트 화면이 막고 있음)
  try { if (window._extAuthReady && !(await window._extAuthReady)) return; } catch (e) { return; }
  // 패널 토글
  document.getElementById('cfgHeader')?.addEventListener('click', () => {
    const body = document.getElementById('cfgBody');
    const chev = document.getElementById('cfgChevron');
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    if (chev) chev.textContent = open ? '▼' : '▲';
  });
  // 🆕 mmlfcp 옵션 동기화 — 생손보유형 변경 또는 버튼 클릭 시 실제 상품유형/만기 옵션 불러오기
  document.getElementById('btn_sync_options')?.addEventListener('click', () => _syncFormOptions(true));
  document.getElementById('cfgInsType')?.addEventListener('change', () => _syncFormOptions(false));
  // 입력 변경 시 자동 저장
  ['cfgInsType','cfgProdType','cfgMaturity'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', saveCfgState);
  });
  // 🆕 전송 대상 라디오 — 변경 시 hint 업데이트 + 영속 저장
  // 🆕 tm-btn 활성 강조 — 라디오 변경 시 현재 선택된 label 에 active 클래스 토글
  function _syncTmBtns() {
    const cur = getTargetMode();
    document.querySelectorAll('.tm-btn').forEach(lb => {
      const forId = lb.getAttribute('for');
      const inp = forId ? document.getElementById(forId) : null;
      lb.style.background = (inp && inp.value === cur) ? '#2563eb' : '';
      lb.style.color = (inp && inp.value === cur) ? '#fff' : '';
      lb.style.borderColor = (inp && inp.value === cur) ? '#1d4ed8' : '';
    });
  }
  document.querySelectorAll('input[name="targetMode"]').forEach(r => {
    r.addEventListener('change', () => {
      updateTargetHint();
      _syncTmBtns();
      try { chrome.storage.local.set({ [TARGET_MODE_KEY]: getTargetMode() }); } catch {}
    });
  });
  // 🆕 부재고객[경고] 버튼 — 현재 활성 탭(토스 보장분석)에 sendToStudio 트리거
  const _absBtn = document.getElementById('btn_absence_warn');
  if (_absBtn) {
    _absBtn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      const prev = _absBtn.textContent; _absBtn.textContent = '⏳ 추출 중…'; _absBtn.disabled = true;
      try {
        const result = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const btn = document.getElementById('__studio_send');
            if (btn) { btn.click(); return 'ok'; }
            return 'no_button';
          }
        });
        if (result?.[0]?.result === 'no_button') {
          alert('토스 보장분석 페이지에서 실행해 주세요.');
        }
      } catch (e) {
        alert('오류: ' + (e.message || e));
      } finally { _absBtn.textContent = prev; _absBtn.disabled = false; }
    });
  }
  // 🆕 페인트 프로 버튼 — 현재 활성 탭(토스 보장분석)의 sendToPaintPro 트리거
  const _ppBtn = document.getElementById('btn_paintpro');
  if (_ppBtn) {
    _ppBtn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      const prev = _ppBtn.textContent; _ppBtn.textContent = '⏳ 준비 중…'; _ppBtn.disabled = true;
      try {
        const result = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const btn = document.getElementById('__paintpro_send');
            if (btn) { btn.click(); return 'ok'; }
            return 'no_button';
          }
        });
        if (result?.[0]?.result === 'no_button') {
          alert('토스 보장분석 페이지에서 실행해 주세요.');
        }
      } catch (e) {
        alert('오류: ' + (e.message || e));
      } finally { _ppBtn.textContent = prev; _ppBtn.disabled = false; }
    });
  }
  // 저장된 전송 대상 복원
  try {
    chrome.storage.local.get([TARGET_MODE_KEY], v => {
      if (v?.[TARGET_MODE_KEY]) setTargetMode(v[TARGET_MODE_KEY]);
      updateTargetHint();
      _syncTmBtns();
    });
  } catch { _syncTmBtns(); }

  // 🆕 현재 활성 탭 URL 로 페이지 컨텍스트 감지 → UI 자동 조정
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = activeTab?.url || '';
    const ctx = {
      isCustomer: /\/customers\//.test(url),
      isCoverage: /\/cover\//.test(url),
      isPremiumPage: /mmlfcp\.ohmymanager\.com|ohmymanager\.com.*보험료/i.test(decodeURIComponent(url))
    };
    const targetPanel = document.querySelector('[data-target-panel]') || document.querySelector('input[name="targetMode"]')?.closest('div[style*="background:#eff6ff"]');
    const radios = {
      auto: document.querySelector('input[name="targetMode"][value="auto"]'),
      consult: document.querySelector('input[name="targetMode"][value="consult"]'),
      standard: document.querySelector('input[name="targetMode"][value="standard"]'),
      plan: document.querySelector('input[name="targetMode"][value="plan"]'),
      premiumPage: document.querySelector('input[name="targetMode"][value="premium-page"]')
    };
    const labelOf = (r) => r?.closest('label');
    if (ctx.isCustomer) {
      // 🎯 고객 페이지: 전송 대상 패널은 노출하되 "상담등록" 을 기본값으로 선택
      //   (추출한 고객정보를 상담등록 페이지로 보내는 게 기본 동작)
      if (targetPanel) targetPanel.style.display = '';
      if (labelOf(radios.plan)) labelOf(radios.plan).style.display = 'none';
      setTargetMode('consult');
      try { chrome.storage.local.set({ [TARGET_MODE_KEY]: 'consult' }); } catch {}
      updateTargetHint();
      const cfgPanel = document.querySelector('.cfg-panel');
      if (cfgPanel) cfgPanel.style.display = 'none';
    } else if (ctx.isCoverage) {
      // 🎯 보장 페이지: 표준 보장분석 / 보험료 비교 폼만 노출
      if (labelOf(radios.auto)) labelOf(radios.auto).style.display = 'none';
      if (labelOf(radios.plan)) labelOf(radios.plan).style.display = 'none';
      // 기본값: 표준 보장분석
      setTargetMode('standard');
      updateTargetHint();
    } else if (ctx.isPremiumPage) {
      // 🎯 보험료 비교 페이지: 라디오 감추고 자동으로 plan (가설계) 라우팅
      //   (전송 시 보장분석 프로그램의 보험사별 비교 → 가설계 탭으로 전송)
      if (targetPanel) targetPanel.style.display = 'none';
      setTargetMode('plan');
      try { chrome.storage.local.set({ [TARGET_MODE_KEY]: 'plan' }); } catch {}
    }
    // 그 외 페이지는 4개 모두 노출 (기본)
  } catch (e) { console.warn('[popup] context detect failed:', e); }
  // 🆕 담보 리스트 렌더링 (초기)
  _renderCoverageList();
  // 🆕 상품 picker 초기 렌더링 (다중 체크박스 — legacy select 핸들러 제거)
  _renderProductPicker();
  // 🆕 고급 수동 담보 토글
  document.getElementById('cfgShowAdvancedCov')?.addEventListener('click', (e) => {
    e.preventDefault();
    const wrap = document.getElementById('cfgAdvancedCovWrap');
    if (wrap) wrap.style.display = (wrap.style.display === 'none') ? '' : 'none';
  });
  // 저장된 설정 복원
  const saved = await loadCfgState();
  if (saved) setCfgToUI(saved);
  // 🆕 담보 검색
  document.getElementById('cfgCovSearch')?.addEventListener('input', (e) => {
    const q = String(e.target.value || '').trim().toLowerCase();
    const list = document.getElementById('cfgCovList');
    if (!list) return;
    if (!q) {
      list.querySelectorAll('.cov-row').forEach(r => r.classList.remove('hidden'));
      list.querySelectorAll('.cov-cat').forEach(c => c.classList.remove('open'));
      return;
    }
    // 매칭되는 카테고리만 자동 펼치기
    list.querySelectorAll('.cov-cat').forEach(cat => {
      let anyMatch = false;
      cat.querySelectorAll('.cov-row').forEach(r => {
        const name = (r.dataset.name || '').toLowerCase();
        const match = name.includes(q);
        if (match) { r.classList.remove('hidden'); anyMatch = true; }
        else r.classList.add('hidden');
      });
      if (anyMatch) cat.classList.add('open');
      else cat.classList.remove('open');
    });
  });
  // 🆕 전체 / 해제
  document.getElementById('cfgCovAll')?.addEventListener('click', () => {
    COVERAGE_CATALOG.forEach(g => g.items.forEach(it => _selectedCoverages.add(it.name)));
    _renderCoverageList();
    saveCfgState();
  });
  document.getElementById('cfgCovClear')?.addEventListener('click', () => {
    _selectedCoverages.clear();
    _renderCoverageList();
    saveCfgState();
  });
  // 템플릿 드롭다운 초기화
  await refreshTemplateDropdown();
  // 템플릿 저장
  document.getElementById('cfgSaveTpl')?.addEventListener('click', async () => {
    const name = prompt('템플릿 이름을 입력하세요:', '');
    if (!name || !name.trim()) return;
    await saveTemplate(name.trim(), getCfgFromUI());
    await refreshTemplateDropdown();
    document.getElementById('cfgLoadTpl').value = name.trim();
    showToast(`💾 템플릿 "${name.trim()}" 저장됨`);
  });
  // 템플릿 불러오기
  document.getElementById('cfgLoadTpl')?.addEventListener('change', async (e) => {
    const name = e.target.value;
    if (!name) return;
    const all = await loadTemplates();
    if (all[name]) {
      setCfgToUI(all[name]);
      saveCfgState();
      showToast(`📋 "${name}" 불러옴`);
    }
  });
  // 템플릿 삭제
  document.getElementById('cfgDelTpl')?.addEventListener('click', async () => {
    const sel = document.getElementById('cfgLoadTpl');
    const name = sel.value;
    if (!name) { alert('삭제할 템플릿을 먼저 선택하세요.'); return; }
    if (!confirm(`템플릿 "${name}" 을 삭제할까요?`)) return;
    await deleteTemplate(name);
    await refreshTemplateDropdown();
    showToast(`🗑️ "${name}" 삭제됨`);
  });
  // 프리셋 버튼들
  document.querySelectorAll('.cfg-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.preset;
      const p = CFG_PRESETS[key];
      if (p) {
        setCfgToUI(p);
        saveCfgState();
        showToast(`✨ "${p.name}" 적용`);
      }
    });
  });
});

// 탭 전환
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'saved') loadSavedList();
  });
});

// content script 주입 (없으면 강제 주입)
async function ensureContentScript(tabId) {
  try {
    // 우선 핑 시도
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return true;
  } catch {
    // 없으면 주입
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      // 주입 후 약간의 대기
      await new Promise(r => setTimeout(r, 100));
      return true;
    } catch (e) {
      console.error('Script injection failed:', e);
      return false;
    }
  }
}

// 데이터 추출
document.getElementById('btnExtract').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const btn = document.getElementById('btnExtract');
  btn.textContent = '추출 중...';
  btn.disabled = true;

  try {
    const injected = await ensureContentScript(tab.id);
    if (!injected) {
      throw new Error('Content script 주입 실패');
    }

    const data = await chrome.tabs.sendMessage(tab.id, { action: 'extractData' });
    if (!data) throw new Error('데이터 응답 없음');

    extractedData = data;
    renderResult(data);
    showCopyButtons(true);
    document.getElementById('btnSave').style.display = '';
    // 🆕 데이터 type 에 맞춰 전송 대상 라디오 자동 enable/disable
    syncTargetCompatibility();
    // 🆕 추출된 상품 목록을 picker 에 렌더링
    _renderProductPicker();

    // 🆕 customer 타입은 영속 저장 — 이후 보장 페이지 / 보험료 비교 페이지로 이동해도 사용 가능
    if (data.type === 'customer' && data.customer) {
      try { chrome.storage.local.set({ lastCustomer: data.customer, lastCustomerAt: Date.now() }); } catch {}
    }
    // 추출 성공 시 자동으로 텍스트 클립보드 복사
    if (data.type === 'customer' || data.type === 'coverage' || data.type === 'premium_compare') {
      const text = formatAsText(data);
      if (text) {
        await copyToClipboard(text, '추출 완료 - 클립보드에 자동 복사됨');
      }
    }
  } catch (e) {
    console.error('Extract error:', e);
    const errMsg = e?.message || '';
    if (errMsg.includes('Cannot access')) {
      showNotice('🔒', '이 페이지에는 접근할 수 없습니다', 'crm.tossinsu.com 페이지에서만 사용 가능합니다');
    } else {
      showNotice('⚠️', '페이지에서 데이터를 읽을 수 없습니다', `오류: ${errMsg}\n페이지를 새로고침 후 다시 시도해주세요`);
    }
  } finally {
    btn.textContent = '📋 데이터 추출';
    btn.disabled = false;
  }
});

document.getElementById('btnCopyText').addEventListener('click', () => {
  if (!extractedData) return;
  copyToClipboard(formatAsText(extractedData), '텍스트가 복사되었습니다');
});

document.getElementById('btnCopyJson').addEventListener('click', () => {
  if (!extractedData) return;
  copyToClipboard(JSON.stringify(extractedData, null, 2), 'JSON이 복사되었습니다');
});

document.getElementById('btnSave').addEventListener('click', async () => {
  if (!extractedData) return;
  await saveData(extractedData);
  showToast('💾 저장되었습니다');
});

// 📤 프로그램에 적용 — 자동으로 적절한 대상 탭을 찾아 데이터 주입
//   · type==='premium_compare' → premium_plan.html 탭 또는 보장분석의 iframe 으로
//   · 그 외(customer/coverage) → toss_insu260406_*.html / page_*.html 탭으로 (기존 로직)
document.getElementById('btnApply').addEventListener('click', async () => {
  console.log('[btnApply] click — extractedData:', extractedData);
  const btn = document.getElementById('btnApply');
  if (!extractedData) {
    console.warn('[btnApply] extractedData 없음 → 추출 먼저 실행');
    alert('먼저 "데이터 추출" 버튼을 눌러주세요.');
    return;
  }
  btn.textContent = '적용 중...';
  btn.disabled = true;

  // 🛡 안전망 — 60초 안에 응답 없으면 button 복구 (mmlfcp 입력은 폼+조회+담보 대기로 최대 25초+ 소요)
  const safetyTimer = setTimeout(() => {
    console.warn('[btnApply] 60초 타임아웃 — button 강제 복구');
    btn.textContent = '📤 프로그램 적용';
    btn.disabled = false;
    alert('적용 시간 초과 (60초).\n\n· 대상 페이지가 응답하지 않습니다\n· 페이지를 새로고침(Ctrl+Shift+R) 후 다시 시도');
  }, 60000);

  try {
    const isPremiumCompare = extractedData && extractedData.type === 'premium_compare';
    const isCustomer = extractedData && extractedData.type === 'customer';
    const isCoverage = extractedData && extractedData.type === 'coverage';
    // 🆕 사용자가 선택한 전송 대상 — 'auto' 면 자동 감지, 그 외는 강제 라우팅
    let targetMode = getTargetMode();
    console.log('[btnApply] type =', extractedData.type, ', target =', targetMode);

    // 🆕 자동 감지(auto) — 현재 활성 탭의 "주소"를 보고 3개 대상 중 어디로 보낼지 스스로 결정한다.
    //   · CRM 고객정보 페이지(/customers/)            → consult       (📝 상담등록)
    //   · CRM 보장 페이지(/cover/)                      → standard      (📊 표준 보장분석)
    //   · 보험료 비교 페이지(mmlfcp / premium_plan)     → premium-page  (📋 보험료 비교 폼)
    //   · 상담등록 CRM(page_*.html)                     → consult
    if (targetMode === 'auto') {
      let resolved = null;
      let detectedUrl = '';
      try {
        const [_at] = await chrome.tabs.query({ active: true, currentWindow: true });
        const u = (_at && _at.url) || '';
        detectedUrl = u;
        const uDec = (() => { try { return decodeURIComponent(u); } catch { return u; } })();
        const isPremiumUrl  = /mmlfcp\.ohmymanager\.com/i.test(u) || /ohmymanager\.com/i.test(u) || /premium_plan\.html/i.test(u) || /보험료\s*비교/.test(uDec);
        const isConsultUrl  = /ympaint-86457\.(web\.app|firebaseapp\.com)\/page_/i.test(u) || /page_(jmin|leader|manager|member|rookie|admin)\.html/i.test(u);
        const isCoverUrl    = /\/cover\/\d+/i.test(u) || /crm\.tossinsu\.com\/.*cover\b/i.test(u);
        const isCustomerUrl = /\/customers\/\d+/i.test(u) || /crm\.tossinsu\.com\/.*customers\b/i.test(u);
        // 우선순위: 보험료비교 → 상담등록CRM → 보장(/cover) → 고객(/customers)
        if (isPremiumUrl && !isPremiumCompare) resolved = 'premium-page';
        else if (isConsultUrl) resolved = 'consult';
        else if (isCoverUrl)   resolved = 'standard';
        else if (isCustomerUrl) resolved = 'consult';
      } catch (e) { console.warn('[btnApply] auto 페이지 감지 실패:', e); }
      // 주소로 판단 못하면 추출 데이터 종류로 폴백 (3개 대상 한정)
      if (!resolved) {
        if (isPremiumCompare) resolved = 'premium-page'; // 비교 데이터 → 보험료 비교 폼
        else if (isCustomer)  resolved = 'consult';      // 고객 데이터 → 상담등록
        else                  resolved = 'standard';     // 보장(coverage) 등 → 표준 보장분석
      }
      const _routeLabel = { consult: '📝 상담등록', standard: '📊 표준 보장분석', 'premium-page': '📋 보험료 비교 폼', plan: '📐 가설계 탭' }[resolved] || resolved;
      console.log('[btnApply] 🤖 자동 감지 — 주소:', detectedUrl, '→ 대상:', resolved);
      try { showToast('🤖 자동 감지 → ' + _routeLabel); } catch {}
      targetMode = resolved;
    }
    // 🛡 호환성 가드 — 데이터 type 과 맞지 않는 전송 대상이면 자동 보정 + 안내
    const _compatGuard = {
      coverage:        { auto: true, consult: true,  standard: true,  plan: false, 'premium-page': true },
      customer:        { auto: true, consult: true,  standard: true,  plan: false, 'premium-page': true },
      premium_compare: { auto: true, consult: false, standard: false, plan: true,  'premium-page': true }
    }[extractedData.type] || null;
    if (_compatGuard && _compatGuard[targetMode] === false) {
      const fallback = ['auto', 'consult', 'standard', 'plan', 'premium-page'].find(k => _compatGuard[k]);
      const proceed = confirm(
        `⚠️ 호환되지 않는 전송 대상\n\n` +
        `추출 데이터: ${extractedData.type}\n` +
        `선택한 대상: ${targetMode}\n\n` +
        `→ "${fallback}" 으로 변경해서 진행할까요?`
      );
      if (!proceed) {
        btn.textContent = '📤 프로그램 적용';
        btn.disabled = false;
        clearTimeout(safetyTimer);
        return;
      }
      targetMode = fallback;
      setTargetMode(fallback);
      try { chrome.storage.local.set({ [TARGET_MODE_KEY]: fallback }); } catch {}
    }
    const allTabs = await chrome.tabs.query({});
    console.log('[btnApply] 모든 탭:', allTabs.length, '개');

    // 🆕 보장분석 프로그램 탭 찾기 헬퍼
    const findProgramTab = () => allTabs.find(t => t.url && (
      /toss_insu\d*_?\d*\.html/i.test(t.url) ||                        // 로컬 파일
      (/tossinssu-pro\.vercel\.app/i.test(t.url) && !/(plan|editor|index)\.html/i.test(t.url)) // Vercel 메인
    ));

    // 🆕 강제 라우팅 — 상담등록 (CRM page_*.html). 추출한 고객정보를 상담등록 페이지로 전송
    if (targetMode === 'consult') {
      console.log('[btnApply] 📤 라우팅: 상담등록 (page_*.html)');
      const CONSULT_URL = 'https://ympaint-86457.web.app/page_jmin.html';
      const findConsultTab = () => allTabs.find(t => t.url && (
        /ympaint-86457\.(web\.app|firebaseapp\.com)\/page_/i.test(t.url) ||
        /page_(jmin|leader|manager|member|rookie|admin)\.html/i.test(t.url)
      ));
      let consultTab = findConsultTab();
      // 탭이 없으면 마지막 상담등록 URL → 기본 CONSULT_URL 순으로 자동 오픈
      if (!consultTab) {
        const stored = await new Promise(r => {
          try { chrome.storage.local.get(['lastConsultUrl'], v => r(v?.lastConsultUrl || null)); } catch { r(null); }
        });
        const openUrl = stored || CONSULT_URL;
        try {
          consultTab = await chrome.tabs.create({ url: openUrl, active: true });
          // receiver(__applyTossDataFromExtension) 정의될 때까지 대기 (최대 15초)
          await new Promise(resolve => {
            let elapsed = 0;
            const tid = setInterval(async () => {
              elapsed += 500;
              try {
                const [r] = await chrome.scripting.executeScript({
                  target: { tabId: consultTab.id }, world: 'MAIN',
                  func: () => typeof window.__applyTossDataFromExtension === 'function'
                });
                if (r?.result) { clearInterval(tid); resolve(true); return; }
              } catch {}
              if (elapsed >= 15000) { clearInterval(tid); resolve(false); }
            }, 500);
          });
        } catch (e) {
          clearTimeout(safetyTimer);
          btn.textContent = '📤 프로그램 적용';
          btn.disabled = false;
          alert('상담등록 페이지 자동 오픈 실패: ' + (e.message || e));
          return;
        }
      }
      // 데이터 적용 — 추출 데이터를 텍스트로 포맷해 상담등록 페이지 수신 함수로 전송
      const textData = formatAsText(extractedData);
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId: consultTab.id }, world: 'MAIN',
          args: [textData],
          func: (text) => {
            if (typeof window.__applyTossDataFromExtension === 'function') {
              try { window.__applyTossDataFromExtension(text); return { ok: true, location: location.href }; }
              catch (e) { return { ok: false, error: e.message, location: location.href }; }
            }
            return { ok: false, error: 'receiver 없음 - 상담등록 페이지 새로고침 필요', location: location.href };
          }
        });
        clearTimeout(safetyTimer);
        btn.textContent = '📤 프로그램 적용';
        btn.disabled = false;
        if (r?.result?.ok) {
          try { chrome.storage.local.set({ lastConsultUrl: consultTab.url }); } catch {}
          await chrome.tabs.update(consultTab.id, { active: true });
          await chrome.windows.update(consultTab.windowId, { focused: true });
          showToast('✅ 상담등록 페이지에 적용 완료');
          setTimeout(() => window.close(), 800);
        } else {
          alert('상담등록 적용 실패: ' + (r?.result?.error || 'unknown') + '\n\n· 상담등록 페이지(page_jmin.html)를 Ctrl+Shift+R 로 새로고침 후 재시도');
        }
      } catch (e) {
        clearTimeout(safetyTimer);
        btn.textContent = '📤 프로그램 적용';
        btn.disabled = false;
        alert('상담등록 실행 실패: ' + (e.message || e));
      }
      return;
    }

    // 🆕 강제 라우팅 - 표준 보장분석 (사용자가 명시 선택 시)
    if (targetMode === 'standard') {
      console.log('[btnApply] 📤 라우팅: 표준 보장분석 (toss_insu*.html)');
      let programTab = findProgramTab();
      // 프로그램 탭이 없으면 마지막 URL 로 자동 오픈 시도
      if (!programTab) {
        const stored = await new Promise(r => {
          try { chrome.storage.local.get(['lastProgramUrl'], v => r(v?.lastProgramUrl || null)); } catch { r(null); }
        });
        if (!stored) {
          alert('보장분석 프로그램이 열려있지 않습니다.\n\nhttps://tossinssu-pro.vercel.app 을 먼저 열어주세요. (한 번 적용 성공 후 자동 오픈됩니다)');
          return;
        }
        try {
          programTab = await chrome.tabs.create({ url: stored, active: true });
          // receiver 함수 정의될 때까지 대기 (최대 15초)
          await new Promise(resolve => {
            let elapsed = 0;
            const tid = setInterval(async () => {
              elapsed += 500;
              try {
                const [r] = await chrome.scripting.executeScript({
                  target: { tabId: programTab.id }, world: 'MAIN',
                  func: () => typeof window.__applyTossDataFromExtension === 'function'
                });
                if (r?.result) { clearInterval(tid); resolve(true); return; }
              } catch {}
              if (elapsed >= 15000) { clearInterval(tid); resolve(false); }
            }, 500);
          });
        } catch (e) { alert('탭 자동 오픈 실패: ' + (e.message || e)); return; }
      }
      // 표준 모드로 전환
      try {
        await chrome.scripting.executeScript({
          target: { tabId: programTab.id }, world: 'MAIN',
          func: () => {
            const tabs = Array.from(document.querySelectorAll('button'));
            const stdBtn = tabs.find(b => /표준\s*보장분석/.test(b.textContent || ''));
            if (stdBtn) stdBtn.click();
          }
        });
        await new Promise(r => setTimeout(r, 300));
      } catch {}
      // 데이터 적용 — extractedData 전체를 텍스트로 포맷팅하여 전송
      const textData = formatAsText(extractedData);
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId: programTab.id }, world: 'MAIN',
          args: [textData],
          func: (text) => {
            if (typeof window.__applyTossDataFromExtension === 'function') {
              try { window.__applyTossDataFromExtension(text); return { ok: true }; }
              catch (e) { return { ok: false, error: e.message }; }
            }
            return { ok: false, error: 'receiver 없음 - 페이지 새로고침 필요' };
          }
        });
        if (r?.result?.ok) {
          // 성공 → URL 영속 저장 (다음 자동 오픈용)
          try { chrome.storage.local.set({ lastProgramUrl: programTab.url }); } catch {}
          // 🆕 보장분석 탭으로 확실히 전환 — 탭 활성화 + 하이라이트 + 창 포커스(+주의환기)
          try {
            await chrome.tabs.update(programTab.id, { active: true, highlighted: true });
            await chrome.windows.update(programTab.windowId, { focused: true, drawAttention: true });
          } catch (e) { console.warn('[btnApply] 탭 전환 실패:', e); }
          clearTimeout(safetyTimer);
          btn.textContent = '📤 프로그램 적용';
          btn.disabled = false;
          showToast('✅ 표준 보장분석에 적용 — 해당 탭으로 이동했습니다');
          setTimeout(() => window.close(), 600);
        } else {
          clearTimeout(safetyTimer);
          btn.textContent = '📤 프로그램 적용';
          btn.disabled = false;
          alert('표준 보장분석 적용 실패: ' + (r?.result?.error || 'unknown') + '\n\n· 프로그램을 Ctrl+Shift+R 로 새로고침 후 재시도');
        }
      } catch (e) {
        alert('실행 실패: ' + (e.message || e));
      }
      return;
    }

    // 🆕 강제 라우팅 - 가설계 탭 (사용자가 명시 선택 시)
    if (targetMode === 'plan') {
      let programTab = findProgramTab();
      const planTab = allTabs.find(t => t.url && (
        /premium_plan\.html/i.test(t.url) ||
        /tossinssu-pro\.vercel\.app\/plan\.html/i.test(t.url)
      ));
      let target = planTab || programTab;
      // 🆕 보장분석 프로그램이 안 열려있으면 마지막 URL 로 자동 오픈
      if (!target) {
        const stored = await new Promise(r => {
          try { chrome.storage.local.get(['lastProgramUrl'], v => r(v?.lastProgramUrl || null)); } catch { r(null); }
        });
        if (stored) {
          try {
            programTab = await chrome.tabs.create({ url: stored, active: true });
            target = programTab;
            // 페이지 로드 대기 (max 15초)
            await new Promise(resolve => {
              let elapsed = 0;
              const tid = setInterval(async () => {
                elapsed += 500;
                try {
                  const [r] = await chrome.scripting.executeScript({
                    target: { tabId: programTab.id }, world: 'MAIN',
                    func: () => typeof window.__applyTossDataFromExtension === 'function' || document.querySelectorAll('button').length > 5
                  });
                  if (r && r.result) { clearInterval(tid); resolve(true); return; }
                } catch {}
                if (elapsed >= 15000) { clearInterval(tid); resolve(false); }
              }, 500);
            });
          } catch (e) {
            alert('보장분석 프로그램 자동 오픈 실패: ' + (e.message || e) + '\n\n· chrome://extensions → 파일 URL 액세스 허용 ON 확인');
            return;
          }
        } else {
          alert('보장분석 프로그램이 열려있지 않습니다.\n\n파일을 한 번 직접 열어주세요 (한 번 적용 성공 후부터 자동 오픈).');
          return;
        }
      }
      // 가설계 모드로 전환
      if (!planTab && programTab) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: programTab.id }, world: 'MAIN',
            func: () => {
              const btns = Array.from(document.querySelectorAll('button'));
              // 🆕 "보험사별 비교" / "보험사비교" 둘 다 매칭 (라벨 축약 호환)
              const compareBtn = btns.find(b => /보험사\s*(별\s*)?비교/.test(b.textContent || ''));
              if (compareBtn) compareBtn.click();
              setTimeout(() => {
                const planBtn = Array.from(document.querySelectorAll('button')).find(b => /가설계/.test(b.textContent || ''));
                if (planBtn) planBtn.click();
              }, 100);
            }
          });
          await new Promise(r => setTimeout(r, 700));
        } catch {}
      }
      // premium_compare 데이터 전송 (있을 때만)
      if (isPremiumCompare) {
        // 데이터 검증
        const hasCompanies = Array.isArray(extractedData.companies) && extractedData.companies.length > 0;
        const hasCoverages = Array.isArray(extractedData.coverages) && extractedData.coverages.length > 0;
        console.log('[btnApply/plan] 데이터 확인 — companies:', extractedData.companies?.length, '/ coverages:', extractedData.coverages?.length);
        if (!hasCompanies && !hasCoverages) {
          alert('⚠️ 추출된 데이터가 비어 있습니다.\n\nmmlfcp 페이지에서 [조회하기] 버튼을 먼저 누르고 보험료가 표시된 상태에서 추출해주세요.');
          return;
        }
        const dataJson = JSON.stringify(extractedData);
        try {
          await chrome.tabs.update(target.id, { active: true });
          await chrome.windows.update(target.windowId, { focused: true });
          // 추가 안정화 대기
          await new Promise(r => setTimeout(r, 600));
          const res = await chrome.scripting.executeScript({
            target: { tabId: target.id, allFrames: true }, world: 'MAIN',
            args: [dataJson],
            func: (json) => {
              try {
                const data = JSON.parse(json);
                if (typeof window.__applyPremiumDataFromExtension === 'function') {
                  window.__applyPremiumDataFromExtension(data);
                  return { ok: true, location: location.href };
                }
                return { ok: false, error: 'receiver 없음', location: location.href };
              } catch (e) { return { ok: false, error: e.message, location: location.href }; }
            }
          });
          const ok = res.find(r => r?.result?.ok);
          if (ok) {
            showToast('✅ 가설계 탭에 적용 완료');
            setTimeout(() => alert(`✅ 가설계 탭 적용 완료\n\n• 보험사: ${extractedData.companies?.length || 0}개\n• 담보: ${extractedData.coverages?.length || 0}개`), 100);
          } else {
            const tried = res.map(r => r?.result?.location || '?').join('\n  · ');
            const err = res.map(r => r?.result?.error).filter(Boolean).join(' / ') || '알 수 없음';
            alert('가설계 탭 적용 실패\n\n원인: ' + err + '\n\n시도한 프레임:\n  · ' + tried + '\n\n해결:\n① 보장분석 프로그램을 한 번 새로고침(Ctrl+Shift+R)\n② 보험사별 비교 → 가설계 탭이 노출된 상태인지 확인');
          }
        } catch (e) {
          console.error('[btnApply/plan] 실행 에러:', e);
          alert('실행 실패: ' + (e.message || e));
        }
      } else {
        // coverage/customer 데이터인 경우: 가설계 모드 전환만 + 안내
        if (programTab) await chrome.tabs.update(programTab.id, { active: true });
        alert('✅ 가설계 탭으로 전환됨\n\n현재 추출한 데이터(' + extractedData.type + ')는 가설계와 형식이 달라 자동 입력은 안 됩니다.\n보험료 비교 데이터를 추출해서 다시 적용해주세요.');
      }
      return;
    }

    // 🆕 mmlfcp 페이지 식별 헬퍼 (premium_plan.html iframe 도 포함)
    const isPremiumComparePageUrl = (u) => u && (
      /mmlfcp\.ohmymanager\.com/i.test(u) ||
      /ohmymanager\.com/i.test(u) ||
      /보험료\s*비교/i.test(decodeURIComponent(u || '')) ||
      /premium_plan\.html/i.test(u) ||
      /tossinssu-pro\.vercel\.app\/plan\.html/i.test(u)
    );
    // 자동 라우팅 보조 — 사용자가 mmlfcp 탭에 있고 auto 모드면 premium 으로 보냄
    const [_activeTab0] = await chrome.tabs.query({ active: true, currentWindow: true });
    const _userOnPremium = _activeTab0 && isPremiumComparePageUrl(_activeTab0.url);
    // 🎯 라우팅 규칙:
    //   · 'premium-page' (명시 선택 또는 auto 가 보험료 비교 페이지로 해석) → premium 라우팅
    //   · auto 는 위에서 이미 구체 모드(premium-page/consult/standard/plan)로 해석됨
    //   ※ premium_compare 데이터는 절대 premium 으로 보내지 않음 (mmlfcp→mmlfcp 방지)
    const _shouldRouteToPremium = (targetMode === 'premium-page') && !isPremiumCompare;
    console.log('[btnApply] 라우팅 결정:', { targetMode, _userOnPremium, isPremiumCompare, _shouldRouteToPremium });

    if (_shouldRouteToPremium) {
      console.log('[btnApply] 📤 라우팅: 보험료 비교 폼 (mmlfcp/premium_plan) — 필요한 값만 전송 (이름/생년월일/성별/유형/만기/담보)');
      // 모든 탭에서 매칭 페이지 찾기
      let premiumTab = allTabs.find(t => isPremiumComparePageUrl(t.url));
      // 못 찾으면 저장된 URL 로 새 탭 오픈 (mmlfcp 사용 시 토큰 포함된 URL 자동 복원)
      let openedNew = false;
      if (!premiumTab) {
        let stored = await new Promise(r => {
          try { chrome.storage.local.get(['lastPremiumComparePageUrl'], v => r(v?.lastPremiumComparePageUrl || null)); } catch { r(null); }
        });
        // 저장된 URL 이 없으면 사용자에게 입력 받기
        if (!stored) {
          stored = prompt(
            '🌐 mmlfcp 보험료 비교 페이지가 열려있지 않습니다.\n\n' +
            '페이지 URL 을 붙여넣으세요 (token 포함):\n' +
            '예: https://mmlfcp.ohmymanager.com/index.html?token=...&path=lifefire&device=WEB',
            ''
          );
          if (!stored || !isPremiumComparePageUrl(stored)) {
            clearTimeout(safetyTimer);
            btn.textContent = '📤 프로그램 적용';
            btn.disabled = false;
            if (stored) alert('mmlfcp URL 형식이 아닙니다. 취소되었습니다.');
            return;
          }
          // 영속 저장 (다음 자동 사용)
          try { chrome.storage.local.set({ lastPremiumComparePageUrl: stored }); } catch {}
        }
        try {
          premiumTab = await chrome.tabs.create({ url: stored, active: true });
          openedNew = true;
        } catch (e) {
          clearTimeout(safetyTimer);
          btn.textContent = '📤 프로그램 적용';
          btn.disabled = false;
          alert('탭 자동 오픈 실패: ' + (e.message || e));
          return;
        }
      }
      // 🆕 외부 폴링 제거 — 인젝트 함수 내부에서 직접 폼 요소 대기 (waitForEl)
      //   새 탭 오픈 시 최소한의 페이지 로드 대기만 수행
      if (premiumTab && openedNew) {
        await new Promise(r => setTimeout(r, 1500));
      }
      const activeTab = premiumTab;
      const isPremiumComparePage = activeTab && isPremiumComparePageUrl(activeTab.url);
      // URL 영속 저장 (다음 자동 오픈용)
      if (isPremiumComparePage && activeTab.url && /mmlfcp\.ohmymanager\.com/i.test(activeTab.url)) {
        try { chrome.storage.local.set({ lastPremiumComparePageUrl: activeTab.url }); } catch {}
      }
      if (isPremiumComparePage) {
        // 고객정보 — 우선순위(2026-06 수정):
        //   1) customer 타입 추출 데이터(가장 정확)
        //   2) ⭐ '현재' coverage 추출의 계약자/피보험자 (= 지금 추출한 그 고객)  ← storage 보다 우선!
        //   3) storage lastCustomer (최후 폴백; '이전에 본 다른 고객'일 수 있어 위험 → 이름 일치할 때만 보강용)
        //   ※ 기존 버그: coverage 추출 시 customer=null → 곧장 storage(옛 고객 '배정희')로 폴백되어
        //     엉뚱한 사람 이름/생년월일/성별이 들어갔음.
        let customer = isCustomer ? (extractedData?.customer || {}) : null;

        // 🆕 1.5) coverage 추출이 직접 만든 customer(이름+생년월일+성별) 우선 사용
        //   content.js extractCustomerBirthFromCoverPage 로 보장내역 페이지에서 생년월일/성별까지 확보됨
        if ((!customer || Object.keys(customer).length === 0) && isCoverage && extractedData?.customer
            && Object.keys(extractedData.customer).length > 0) {
          customer = { ...extractedData.customer };
          console.log('[btnApply] ✅ coverage 추출 customer 직접 사용:', customer);
        }

        // 2) coverage 추출의 계약자에서 '현재 고객명' 확보 (위에서 customer 못 채웠을 때)
        let coverageContractorName = (customer && (customer['고객명'] || customer.name)) || '';
        if ((!customer || Object.keys(customer).length === 0) && isCoverage && Array.isArray(extractedData?.insurances)) {
          const validIns = extractedData.insurances.find(ins => ins['계약상태'] === '정상' || ins['납입 여부'] === '납입중')
                        || extractedData.insurances[0];
          if (validIns) {
            const contractorRaw = validIns['계약자/피보험자'] || '';   // "강창범/본인"
            coverageContractorName = contractorRaw.split('/')[0].trim();
          }
        }

        // 3) storage lastCustomer 는 '현재 고객명과 일치할 때만' 사용 (생년월일/성별 보강용).
        //    이름이 다르면 = 다른 고객이므로 절대 쓰지 않음(엉뚱한 사람 데이터 유입 차단).
        if (!customer || Object.keys(customer).length === 0) {
          const stored = await new Promise(r => {
            try { chrome.storage.local.get(['lastCustomer'], v => r(v?.lastCustomer || null)); } catch { r(null); }
          });
          const storedName = stored && (stored['고객명'] || stored.name || '');
          if (coverageContractorName) {
            if (stored && storedName && storedName.trim() === coverageContractorName) {
              // 같은 고객 → storage 의 생년월일/성별 등 보강 + 이름은 현재값으로 확정
              customer = { ...stored, 고객명: coverageContractorName, name: coverageContractorName };
              console.log('[btnApply] ✅ storage 고객 일치 — 보강 사용:', coverageContractorName);
            } else {
              // 이름 불일치 또는 storage 없음 → 현재 계약자 이름만 사용(생년월일/성별은 비움)
              customer = { 고객명: coverageContractorName, name: coverageContractorName, _source: 'coverage_contractor' };
              console.log('[btnApply] ⚠️ storage 고객 불일치/없음 — 현재 계약자만 사용:', coverageContractorName, '| storage였던값:', storedName || '(없음)');
            }
          } else {
            // 계약자도 못 찾음 → 최후로 storage (단, 이름 없으면 빈 객체)
            customer = stored || {};
            if (storedName) console.log('[btnApply] ⚠️ 계약자 미확보 — storage 폴백:', storedName);
          }
        }
        // 그래도 비어있으면 빈 객체로
        if (!customer) customer = {};
        // 설정값 — popup UI 에서 가져옴 (cfg 패널)
        const cfg = getCfgFromUI();
        const selectedProduct = _getSelectedProductCoverages();
        console.log('[btnApply] mmlfcp 입력 페이로드 — customer:', customer, '| cfg:', cfg, '| product:', selectedProduct);
        // 데이터 검증
        const hasCustomerData = customer && (customer.고객명 || customer.name || customer.생년월일 || customer.성별);
        const hasCfgData = cfg && (cfg.insType || cfg.prodType || cfg.maturity || (cfg.coverages && cfg.coverages.length > 0));
        const hasProductData = selectedProduct && selectedProduct.length > 0;
        // 추출 데이터가 coverage 타입이고 상품이 있는데 선택 안 했으면 경고
        const products = _getProductsFromExtractedData();
        if (products.length > 0 && !hasProductData) {
          const proceed = confirm(
            '⚠️ 추출된 보험상품 중 선택된 게 없습니다.\n\n' +
            '📦 상단의 "보험상품 선택" 에서 상품을 선택하면\n' +
            '   그 상품의 담보+금액이 mmlfcp 에 자동 입력됩니다.\n\n' +
            '선택 없이 진행하면 폼 기본정보만 채워집니다.\n' +
            '계속할까요?'
          );
          if (!proceed) {
            clearTimeout(safetyTimer);
            btn.textContent = '📤 프로그램 적용';
            btn.disabled = false;
            return;
          }
        }
        if (!hasCustomerData && !hasCfgData && !hasProductData) {
          clearTimeout(safetyTimer);
          btn.textContent = '📤 프로그램 적용';
          btn.disabled = false;
          alert(
            '⚠️ 입력할 값이 하나도 없습니다.\n\n' +
            '· 보험상품 선택: 상단 📦 보험상품 선택에서 클릭\n' +
            '· 고객 정보: CRM 고객 페이지에서 데이터 추출 필요\n' +
            '· 설정값: 폼 기본 설정 패널에서 유형/만기 선택'
          );
          return;
        }
        if (!hasCustomerData) {
          console.warn('[btnApply] ⚠️ 고객 데이터 없음 — 그 외 값만 입력됩니다');
        }
        const payload = { customer: customer || {}, cfg };
        const payloadJson = JSON.stringify(payload);
        let res = [];
        // 🆕 NEW PATH — content.js sendMessage 사용 (executeScript world:MAIN 우회)
        //   content.js 가 mmlfcp 페이지에 정상 로드되어 있음 ([Toss Extractor] v3.0.0 로드됨 확인)
        //   하나의 메시지로 폼 입력 + 조회하기 + 담보 체크 까지 통합 처리
        try {
          console.log('[btnApply] content.js 통합 메시지 전송 시작 → tabId:', activeTab.id);
          // 새 탭이면 content.js 가 listener 등록할 시간 추가 대기
          if (openedNew) await new Promise(r => setTimeout(r, 1500));

          // 🆕 PING 사전 검사 — 새 content.js (applyToPremiumForm 핸들러 있는 버전) 가 로드됐는지 확인
          //   오래된 버전이면 ping 도 통과하지만 applyToPremiumForm 핸들러 없음 → 강제 재인젝션
          const pingTest = await new Promise((resolve) => {
            try {
              const tid = setTimeout(() => resolve({ ok: false, timeout: true }), 2500);
              chrome.tabs.sendMessage(activeTab.id, { action: 'ping' }, (response) => {
                clearTimeout(tid);
                if (chrome.runtime.lastError) {
                  resolve({ ok: false, error: chrome.runtime.lastError.message });
                } else {
                  resolve(response || { ok: false });
                }
              });
            } catch (e) { resolve({ ok: false, error: e.message }); }
          });
          console.log('[btnApply] PING 결과:', pingTest);
          const REQUIRED_CT_VER = '3.7.9';
          // ping 실패 OR 새 핸들러 없음 OR 버전 낮음 → content.js 오래된 버전 → 강제 재인젝션
          const needsReinject = !pingTest?.ok || !pingTest?.hasApplyHandler ||
            (pingTest?.version && pingTest.version < REQUIRED_CT_VER);
          if (needsReinject) {
            console.warn('[btnApply] content.js 미로드/오래된 버전 → 강제 재인젝션');
            try {
              await chrome.scripting.executeScript({
                target: { tabId: activeTab.id, allFrames: false },
                files: ['content.js']
              });
              await new Promise(r => setTimeout(r, 800));
              console.log('[btnApply] 강제 재인젝션 완료');
            } catch (e) {
              console.error('[btnApply] 강제 인젝션 실패:', e);
            }
          }
          const hasCovs = Array.isArray(cfg.coverages) && cfg.coverages.length > 0;
          // 🆕 선택된 보험상품의 담보+금액 (있으면 cfg.coverages 보다 우선 사용)
          const productCoverages = _getSelectedProductCoverages();
          console.log('[btnApply] 선택된 상품 담보+금액:', productCoverages);
          const msgPayload = {
            action: 'applyToPremiumForm',
            payload: {
              customer: customer || {},
              cfg: cfg,
              clickSearch: true,
              applyCoverages: hasCovs || !!productCoverages,
              productCoverages: productCoverages
            }
          };
          // 🆕 sendMessage with auto-inject fallback + 45초 hard timeout
          const trySendMessage = () => new Promise((resolve) => {
            let resolved = false;
            const tid = setTimeout(() => {
              if (!resolved) {
                resolved = true;
                resolve({ ok: false, error: 'content.js 응답 타임아웃 (45초) — 페이지에서 작업이 막힘' });
              }
            }, 45000);
            try {
              chrome.tabs.sendMessage(activeTab.id, msgPayload, (response) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(tid);
                if (chrome.runtime.lastError) {
                  resolve({ ok: false, error: chrome.runtime.lastError.message });
                } else {
                  resolve(response || { ok: false, error: '응답 없음 (sendResponse 호출 안 됨)' });
                }
              });
            } catch (e) {
              if (!resolved) {
                resolved = true;
                clearTimeout(tid);
                resolve({ ok: false, error: e.message });
              }
            }
          });
          let unifiedRes = await trySendMessage();
          // 🛡 connection 실패 시 — content.js 가 로드 안 됨 → 수동 인젝션 후 재시도
          if (!unifiedRes?.ok && /Could not establish connection|Receiving end does not exist/i.test(unifiedRes?.error || '')) {
            console.warn('[btnApply] content.js 미로드 감지 — 수동 인젝션 시도');
            try {
              await chrome.scripting.executeScript({
                target: { tabId: activeTab.id, allFrames: false },
                files: ['content.js']
              });
              console.log('[btnApply] content.js 인젝션 완료, 1초 대기 후 재시도');
              await new Promise(r => setTimeout(r, 1000));
              unifiedRes = await trySendMessage();
            } catch (injErr) {
              console.error('[btnApply] 수동 인젝션 실패:', injErr);
              unifiedRes = {
                ok: false,
                error: 'content.js 인젝션 실패: ' + (injErr.message || injErr)
              };
            }
          }
          console.log('[btnApply] content.js 응답:', unifiedRes);
          // 결과 표시
          clearTimeout(safetyTimer);
          btn.textContent = '📤 프로그램 적용';
          btn.disabled = false;
          if (unifiedRes?.ok) {
            try {
              await chrome.tabs.update(activeTab.id, { active: true, highlighted: true });
              await chrome.windows.update(activeTab.windowId, { focused: true, drawAttention: true });
            } catch {}
            const lines = [];
            if (Object.keys(unifiedRes.filled || {}).length > 0) {
              lines.push('✅ 고객 정보');
              Object.entries(unifiedRes.filled).forEach(([k, v]) => lines.push(`  • ${k}: ${v}`));
            }
            if (Object.keys(unifiedRes.applied || {}).length > 0) {
              lines.push('');
              lines.push('✅ 설정');
              Object.entries(unifiedRes.applied).forEach(([k, v]) => lines.push(`  • ${k}: ${v}`));
            }
            showToast('✅ 입력 완료 — 해당 탭으로 자동 전환됨');
            setTimeout(() => alert(
              '📋 보험료 비교 페이지에 자동 입력 완료\n\n' +
              (lines.join('\n') || '(채울 값 없음)') +
              '\n\n🔗 입력된 탭:\n' + (unifiedRes.location || activeTab.url || '')
            ), 100);
          } else {
            const err = unifiedRes?.error || '알 수 없음';
            const isConnErr = /Could not establish connection|Receiving end does not exist/i.test(err);
            alert(
              'mmlfcp 보험료 비교 폼 자동 입력 실패\n\n' +
              '원인: ' + err + '\n\n' +
              (isConnErr ? (
                '⚠️ content.js 가 mmlfcp 페이지에 로드되지 않았습니다.\n\n' +
                '해결 방법:\n' +
                '① mmlfcp 페이지(' + (activeTab.url || '').substring(0, 60) + '...) 로 가서 Ctrl+Shift+R 새로고침\n' +
                '② 새로고침 후 다시 데이터 추출 + 프로그램 적용\n' +
                '③ 그래도 안 되면: chrome://extensions → 토스인슈 CRM 데이터 추출기 → 새로고침 아이콘 클릭'
              ) : (
                '확인사항:\n' +
                '① mmlfcp 페이지에서 Ctrl+Shift+R 로 새로고침 후 다시 시도\n' +
                '② chrome://extensions → 사이트 접근 권한 확인\n' +
                '③ F12 콘솔에서 [Toss Extractor] 로그 확인'
              ))
            );
          }
          return;
        } catch (e) {
          clearTimeout(safetyTimer);
          btn.textContent = '📤 프로그램 적용';
          btn.disabled = false;
          alert('통합 적용 실패: ' + (e.message || e));
          return;
        }
        /* ──────── 구 executeScript 기반 코드 (보존: 필요시 fallback) ──────── */
        // 아래 코드는 실행되지 않음 — 위 try 블록에서 항상 return
        try {
          res = await chrome.scripting.executeScript({
            target: { tabId: activeTab.id, allFrames: true },
            world: 'MAIN',
            args: [payloadJson],
            func: async (json) => {
              try {
                // 페이지측 visible 토스트 (사용자가 인젝트 실행 확인 가능)
                try {
                  const t = document.createElement('div');
                  t.textContent = '🔌 확장프로그램 입력 시작…';
                  t.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;background:#3182f6;color:#fff;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
                  document.body.appendChild(t);
                  setTimeout(() => t.remove(), 5000);
                } catch {}
                console.log('[ext] 🔌 인젝트 시작 — location:', location.href);
                const p = JSON.parse(json);
                const out = { ok: false, filled: {}, applied: {}, location: location.href };
                const cust = p.customer || {};
                const cfg = p.cfg || {};

                // 🆕 인젝트 함수 내부 대기 — 폼 요소가 나타날 때까지 (최대 15초)
                const waitForEl = async (id, requireOptions = false, maxMs = 15000) => {
                  const start = Date.now();
                  while (Date.now() - start < maxMs) {
                    const el = document.getElementById(id);
                    if (el) {
                      if (!requireOptions) return el;
                      if (el.options && el.options.length > 0) return el;
                    }
                    await new Promise(r => setTimeout(r, 200));
                  }
                  return null;
                };

                // 핵심 폼 요소 등장 대기 (cust_name 또는 selInsuranceType)
                console.log('[ext] 폼 요소 등장 대기…');
                const formAnchor = await Promise.race([
                  waitForEl('cust_name', false, 15000),
                  waitForEl('selInsuranceType', false, 15000)
                ]);
                if (!formAnchor) {
                  console.warn('[ext] ❌ 15초 안에 폼 요소 미발견 — 이 프레임은 대상 아님');
                  return { ok: false, error: '폼 요소 미발견 (15초 대기 후)', location: location.href };
                }
                console.log('[ext] ✅ 폼 요소 발견:', formAnchor.id);

                const setInputVal = (el, val) => {
                  if (!el) return false;
                  try {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    setter.call(el, val);
                  } catch { el.value = val; }
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  return true;
                };
                const setSelectVal = (el, val) => {
                  if (!el) return false;
                  // 옵션이 0개면 아직 로드 안 됨 → 실패
                  if (!el.options || el.options.length === 0) return false;
                  // 정확한 value 매칭 시도
                  const hasOption = Array.from(el.options).some(o => o.value === String(val));
                  if (!hasOption) {
                    // value 가 없으면 텍스트 매칭 시도
                    const byText = Array.from(el.options).find(o =>
                      (o.textContent || '').trim() === String(val).trim()
                    );
                    if (byText) val = byText.value;
                    else return false;
                  }
                  try {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
                    setter.call(el, val);
                  } catch { el.value = val; }
                  // selectedIndex 도 명시적으로 설정 (일부 라이브러리 호환)
                  for (let i = 0; i < el.options.length; i++) {
                    if (el.options[i].value === String(val)) { el.selectedIndex = i; break; }
                  }
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  // jQuery 환경이면 jQuery change 도 발화
                  try { if (window.jQuery) window.jQuery(el).trigger('change'); } catch {}
                  return true;
                };

                // 디버그 정보 수집
                out.debug = {
                  custKeys: Object.keys(cust),
                  cfg: { insType: cfg.insType, prodType: cfg.prodType, maturity: cfg.maturity },
                  els: {
                    cust_name: !!document.getElementById('cust_name'),
                    birth_date: !!document.getElementById('birth_date'),
                    gender: !!document.getElementById('gender'),
                    selInsuranceType: !!document.getElementById('selInsuranceType'),
                    selProductsGroupCD: !!document.getElementById('selProductsGroupCD'),
                    selPaymentExpirationCD: !!document.getElementById('selPaymentExpirationCD')
                  },
                  skipped: []
                };
                console.log('[ext] 입력 시작 — cust keys:', Object.keys(cust), '| cfg:', cfg);

                // ── 고객 이름 ──
                const nameEl = document.getElementById('cust_name');
                const name = cust['고객명'] || cust.name;
                if (nameEl && name) {
                  setInputVal(nameEl, name);
                  out.filled['이름'] = name;
                  out.ok = true;
                  console.log('[ext] ✅ 이름 입력:', name);
                } else {
                  out.debug.skipped.push(`이름 (el=${!!nameEl}, name=${name || 'EMPTY'})`);
                  console.warn('[ext] ⚠️ 이름 스킵 — el:', !!nameEl, '| name:', name);
                }
                // ── 생년월일 (YYYYMMDD) ──
                const birthEl = document.getElementById('birth_date');
                let birthRaw = cust['생년월일'] || '';
                if (birthEl && birthRaw) {
                  let digits = String(birthRaw).replace(/[^\d]/g, '');
                  if (digits.length === 6) {
                    const yy = parseInt(digits.slice(0, 2), 10);
                    const yyyy = yy <= 24 ? 2000 + yy : 1900 + yy;
                    digits = `${yyyy}${digits.slice(2)}`;
                  }
                  if (digits.length === 8) {
                    setInputVal(birthEl, digits);
                    out.filled['생년월일'] = digits;
                    out.ok = true;
                    console.log('[ext] ✅ 생년월일 입력:', digits);
                  } else {
                    out.debug.skipped.push(`생년월일 (raw=${birthRaw}, digits=${digits})`);
                  }
                } else {
                  out.debug.skipped.push(`생년월일 (el=${!!birthEl}, raw=${birthRaw || 'EMPTY'})`);
                  console.warn('[ext] ⚠️ 생년월일 스킵 — el:', !!birthEl, '| raw:', birthRaw);
                }
                // ── 성별 ──
                const genderEl = document.getElementById('gender');
                const gender = cust['성별'] || '';
                if (genderEl && gender) {
                  const isMale = /남|^M$|male/i.test(String(gender));
                  const isFemale = /여|^F$|female/i.test(String(gender));
                  const code = isMale ? 'M' : (isFemale ? 'F' : '');
                  if (code) {
                    const ok = setSelectVal(genderEl, code);
                    out.filled['성별'] = `${gender} (${code})${ok ? '' : ' [실패]'}`;
                    out.ok = true;
                    console.log('[ext] ✅ 성별 입력:', code, '결과:', ok);
                  }
                } else {
                  out.debug.skipped.push(`성별 (el=${!!genderEl}, gender=${gender || 'EMPTY'})`);
                }
                // ── 생손보 유형 — select 는 options 로드 대기 ──
                if (cfg.insType) {
                  const el = await waitForEl('selInsuranceType', true, 8000);
                  if (el) {
                    const ok = setSelectVal(el, cfg.insType);
                    out.applied['생손보 유형'] = `${cfg.insType}${ok ? '' : ' [실패]'}`;
                    out.ok = true;
                    console.log('[ext] ✅ 생손보 유형 입력:', cfg.insType, '결과:', ok, '/ options:', el.options.length);
                  } else { out.debug.skipped.push('생손보 유형 (8초 옵션 대기 실패)'); console.warn('[ext] ⚠️ selInsuranceType 옵션 미로드'); }
                } else { out.debug.skipped.push('생손보 유형 (cfg 비어있음)'); }
                // ── 상품 유형 ──
                if (cfg.prodType) {
                  const el = await waitForEl('selProductsGroupCD', true, 8000);
                  if (el) {
                    const ok = setSelectVal(el, cfg.prodType);
                    out.applied['상품 유형'] = `${cfg.prodType}${ok ? '' : ' [실패]'}`;
                    out.ok = true;
                    console.log('[ext] ✅ 상품 유형 입력:', cfg.prodType, '결과:', ok, '/ options:', el.options.length);
                  } else { out.debug.skipped.push('상품 유형 (8초 옵션 대기 실패)'); console.warn('[ext] ⚠️ selProductsGroupCD 옵션 미로드'); }
                } else { out.debug.skipped.push('상품 유형 (cfg 비어있음)'); }
                // ── 만기 ──
                if (cfg.maturity) {
                  const el = await waitForEl('selPaymentExpirationCD', true, 8000);
                  if (el) {
                    const ok = setSelectVal(el, cfg.maturity);
                    out.applied['만기'] = `${cfg.maturity}${ok ? '' : ' [실패]'}`;
                    out.ok = true;
                    console.log('[ext] ✅ 만기 입력:', cfg.maturity, '결과:', ok, '/ options:', el.options.length);
                  } else { out.debug.skipped.push('만기 (8초 옵션 대기 실패)'); console.warn('[ext] ⚠️ selPaymentExpirationCD 옵션 미로드'); }
                } else { out.debug.skipped.push('만기 (cfg 비어있음)'); }
                // ── 담보 체크박스는 별도 2단계 (조회하기 클릭 후) — 여기서는 스킵 ──
                return out;
              } catch (e) { return { ok: false, error: e.message, location: location.href }; }
            }
          });
        } catch (e) {
          alert('스크립트 실행 실패: ' + (e.message || e) + '\n\n· chrome://extensions → 파일 URL 액세스 허용 ON 확인');
          return;
        }

        // 🆕 2단계: 폼 입력 완료 → 폼 안정화 대기 → 조회하기 클릭 → 조회 완료 대기 → (담보 있으면) 담보 체크
        //   조회하기는 담보 선택 여부와 무관하게 항상 실행 — 사용자 요청
        const hasCoverages = Array.isArray(cfg.coverages) && cfg.coverages.length > 0;
        {
          // ── 2-1) 폼 입력값이 page state 에 반영되도록 짧은 대기
          await new Promise(r => setTimeout(r, 400));

          // ── 2-2) 조회하기 버튼 클릭
          let searchClickedOk = false;
          try {
            const clickRes = await chrome.scripting.executeScript({
              target: { tabId: activeTab.id, allFrames: true }, world: 'MAIN',
              func: () => {
                // 1) 직접 id 매칭 (mmlfcp 페이지: <button id="btn_search">)
                let btn = document.getElementById('btn_search');
                // 2) id 패턴 매칭
                if (!btn) btn = document.querySelector('button[id*="search" i], button[id*="조회"]');
                // 3) 텍스트 매칭 — "조회" 포함
                if (!btn) {
                  const candidates = Array.from(document.querySelectorAll('button, a, input[type=button], input[type=submit]'));
                  btn = candidates.find(el => {
                    const t = (el.innerText || el.textContent || el.value || '').trim();
                    return /조회|검색/i.test(t);
                  });
                }
                if (btn) {
                  try {
                    btn.click();
                    return { ok: true, clicked: btn.id || (btn.tagName + ':' + (btn.innerText || btn.value || '').substring(0, 20)), location: location.href };
                  } catch (e) { return { ok: false, error: e.message, location: location.href }; }
                }
                return { ok: false, error: '조회하기 버튼 못 찾음', location: location.href };
              }
            });
            searchClickedOk = !!(clickRes && clickRes.find(r => r?.result?.ok));
            console.log('[btnApply] 조회하기 클릭 결과:', clickRes.map(r => r?.result));
          } catch (e) { console.warn('[btnApply] 조회하기 클릭 실패:', e); }

          if (!searchClickedOk) {
            alert(
              '⚠️ 조회하기 버튼을 찾지 못했습니다.\n\n' +
              '· 이름/생년월일/성별/유형 입력이 정상인지 확인\n' +
              '· 페이지 새로고침(Ctrl+Shift+R) 후 다시 시도'
            );
            return;
          }

          // ── 2-3) 조회 완료 대기 — mmlfcp 페이지는 정적 HTML 에 체크박스/total 요소가 이미 있으므로
          //   엄격한 감지보다는 합리적 시간 대기 + 베스트에포트 감지로 처리
          //   기본: 3.5초 대기 (대부분의 조회 완료 시간) + 그 안에 명확한 결과 표시되면 즉시 종료
          const readyResult = await new Promise(resolve => {
            let elapsed = 0;
            const MAX_WAIT = 8000;     // 최대 8초 — 그 안에 결과 안 와도 일단 진행
            const MIN_WAIT = 2500;     // 최소 2.5초 — 너무 빨리 진행 방지
            const tid = setInterval(async () => {
              elapsed += 500;
              if (elapsed < MIN_WAIT) return;  // 최소 대기 시간 동안은 그냥 통과
              try {
                const [r] = await chrome.scripting.executeScript({
                  target: { tabId: activeTab.id, allFrames: true }, world: 'MAIN',
                  func: () => {
                    // 조회 결과 표시 신호: product_result 영역이 보이거나, 보험사 보험료가 표시
                    const productResult = document.getElementById('product_result');
                    const productVisible = productResult && productResult.offsetParent !== null;
                    const allChecks = document.querySelectorAll('input[type="checkbox"][data-cd], input[type="checkbox"][coverage_name], input[type="checkbox"][id^="chk_"]');
                    let visibleChecks = 0;
                    allChecks.forEach(cb => { if (cb.offsetParent !== null) visibleChecks++; });
                    return { productVisible, visibleChecks, totalChecks: allChecks.length };
                  }
                });
                const result = r?.result || {};
                // 결과 영역 보이고 체크박스 표시되면 즉시 완료
                if (result.productVisible && result.visibleChecks > 0) {
                  clearInterval(tid);
                  resolve({ ok: true, ...result, elapsedMs: elapsed });
                  return;
                }
              } catch (e) { /* 무시 */ }
              if (elapsed >= MAX_WAIT) {
                clearInterval(tid);
                resolve({ ok: 'forced', timedOut: true, elapsedMs: elapsed });
              }
            }, 500);
          });
          console.log('[btnApply] 조회 완료 대기 결과:', readyResult);
          // timedOut 이어도 그냥 진행 (담보 체크박스가 정적 HTML 에 있어서 클릭 가능)

          // ── 2-4) 추가 안정화 대기 (페이지가 결과 렌더링 마무리할 시간)
          await new Promise(r => setTimeout(r, 600));

         // 담보 체크 적용 (담보가 선택되었을 때만)
         if (hasCoverages) {
          try {
            const covRes = await chrome.scripting.executeScript({
              target: { tabId: activeTab.id, allFrames: true }, world: 'MAIN',
              args: [JSON.stringify(cfg.coverages)],
              func: (covJson) => {
                try {
                  // 정규화 함수 — 공백/기호 제거 + 소문자
                  const normalize = (s) => String(s || '').replace(/[\s·,\.\-_/\\()\[\]]/g, '').toLowerCase().trim();
                  const wantedRaw = JSON.parse(covJson);
                  const wantedNorm = new Set(wantedRaw.map(normalize));
                  const checks = document.querySelectorAll('input[type="checkbox"][data-cd], input[type="checkbox"][coverage_name], input[type="checkbox"][id^="chk_"]');
                  if (checks.length === 0) return { ok: false, error: '체크박스 없음', location: location.href };
                  let matched = 0;
                  const matchedNames = [];
                  const unmatchedWanted = new Set(wantedRaw);
                  checks.forEach(cb => {
                    const cname = cb.getAttribute('coverage_name') || cb.value || '';
                    const norm = normalize(cname);
                    if (wantedNorm.has(norm)) {
                      if (!cb.checked) cb.click();
                      matched++;
                      matchedNames.push(cname);
                      // raw 매칭에서 제거 (남은 건 unmatched)
                      wantedRaw.forEach(w => { if (normalize(w) === norm) unmatchedWanted.delete(w); });
                    }
                  });
                  return {
                    ok: true,
                    matched,
                    total: wantedRaw.length,
                    matchedNames: matchedNames.slice(0, 10),
                    unmatched: Array.from(unmatchedWanted).slice(0, 10),
                    totalCheckboxes: checks.length,
                    location: location.href
                  };
                } catch (e) { return { ok: false, error: e.message, location: location.href }; }
              }
            });
            const cr = covRes.find(r => r?.result?.ok);
            console.log('[btnApply] 담보 체크 결과:', covRes.map(r => r?.result));
            if (cr) {
              const ok = res.find(r => r && r.result && r.result.ok);
              if (ok) {
                if (!ok.result.applied) ok.result.applied = {};
                ok.result.applied['담보'] = `${cr.result.matched}/${cr.result.total} 선택됨 (전체 ${cr.result.totalCheckboxes}개 중)`;
                if (cr.result.unmatched && cr.result.unmatched.length > 0) {
                  ok.result.applied['미매칭 담보'] = cr.result.unmatched.join(', ');
                }
              }
            } else {
              // 모든 frame 에서 실패 — 어떤 에러였는지 콘솔에 남김
              const errs = covRes.map(r => r?.result?.error || `${r?.result?.location} (no result)`).join(' | ');
              console.warn('[btnApply] 담보 체크 모든 프레임 실패:', errs);
            }
          } catch (e) { console.warn('[btnApply] 담보 체크 실패:', e); }
         } // end if (hasCoverages)
        }
        // 🆕 디버그: 모든 프레임의 응답 로그
        console.log('[btnApply] 폼 입력 결과 (모든 프레임):', res.map(r => r?.result));
        const ok = res.find(r => r && r.result && r.result.ok);
        if (ok) {
          // 🆕 적용 성공 → 즉시 그 탭/창으로 사용자 시선 이동
          try {
            await chrome.tabs.update(activeTab.id, { active: true, highlighted: true });
            await chrome.windows.update(activeTab.windowId, { focused: true, drawAttention: true });
          } catch (e) { console.warn('[btnApply] tab activation failed:', e); }
          const lines = [];
          if (ok.result.filled && Object.keys(ok.result.filled).length > 0) {
            lines.push('✅ 고객 정보');
            Object.entries(ok.result.filled).forEach(([k, v]) => lines.push(`  • ${k}: ${v}`));
          } else {
            lines.push('⚠️ 고객 정보가 비어있어 채울 수 없습니다.');
            lines.push('  (CRM 고객 페이지에서 데이터 추출 먼저 실행 필요)');
          }
          if (ok.result.applied && Object.keys(ok.result.applied).length > 0) {
            lines.push('');
            lines.push('✅ 설정');
            Object.entries(ok.result.applied).forEach(([k, v]) => lines.push(`  • ${k}: ${v}`));
          }
          // 🆕 어느 탭에서 일어났는지 명확히
          const targetUrl = ok.result.location || activeTab.url || '';
          clearTimeout(safetyTimer);
          btn.textContent = '📤 프로그램 적용';
          btn.disabled = false;
          showToast('✅ 입력 완료 — 해당 탭으로 자동 전환됨');
          setTimeout(() => alert(
            '📋 보험료 비교 페이지에 자동 입력 완료\n\n' +
            (lines.join('\n') || '(채울 값 없음)') +
            '\n\n🔗 입력된 탭:\n' + targetUrl
          ), 100);
        } else {
          clearTimeout(safetyTimer);
          btn.textContent = '📤 프로그램 적용';
          btn.disabled = false;
          // 자세한 디버그 정보 수집
          const frameInfos = res.map(r => {
            const d = r?.result;
            if (!d) return '(no result)';
            const els = d.debug?.els || {};
            const elsSummary = Object.entries(els).filter(([_, v]) => v).map(([k]) => k).join(', ') || '없음';
            return `${d.location || '?'}\n      els: [${elsSummary}]\n      error: ${d.error || '(filled=' + Object.keys(d.filled || {}).length + ', applied=' + Object.keys(d.applied || {}).length + ')'}`;
          }).join('\n  · ');
          const errMsg = res.map(r => r?.result?.error).filter(Boolean).join(' / ') || '폼 요소 미발견 또는 채울 값 없음';
          alert(
            'mmlfcp 보험료 비교 폼 자동 입력 실패\n\n' +
            '원인: ' + errMsg + '\n\n' +
            '프레임별 상태:\n  · ' + frameInfos + '\n\n' +
            '확인사항:\n' +
            '① 페이지 새로고침(Ctrl+Shift+R) — 폼이 완전히 로드된 뒤 재시도\n' +
            '② 확장 팝업의 cfg 패널에서 생손보 유형/상품 유형/만기 선택 확인\n' +
            '③ 고객 정보를 채우려면 먼저 CRM 고객 페이지에서 데이터 추출\n\n' +
            'F12 콘솔의 [btnApply] / [ext] 로그도 확인해주세요.'
          );
        }
        return;
      }
    }
    // (위에서 보험료 비교 페이지면 자동 입력 후 return. 그 외 customer 는 기존 흐름)

    // 🆕 보험료 비교 데이터 → premium_plan.html 탭으로 우선 라우팅
    if (isPremiumCompare) {
      const planTabs = allTabs.filter(t => t.url && (
        /premium_plan\.html/i.test(t.url) ||
        /tossinssu-pro\.vercel\.app\/plan\.html/i.test(t.url)
      ));
      const programTabs = allTabs.filter(t => t.url && (
        /toss_insu\d*_?\d*\.html/i.test(t.url) ||
        (/tossinssu-pro\.vercel\.app/i.test(t.url) && !/(plan|editor|index)\.html/i.test(t.url))
      ));
      const target = planTabs[0] || programTabs[0];
      if (!target) {
        alert('보장분석 프로그램이 열려있지 않습니다.\n\nhttps://tossinssu-pro.vercel.app 을 먼저 열어주세요.');
        return;
      }
      const dataJson = JSON.stringify(extractedData);
      // 🆕 보장분석 프로그램에 적용 시 자동으로 보험사별 비교 → 가설계 모드 전환 + iframe 활성화 대기
      const isProgramTab = !planTabs[0] && programTabs[0];
      if (isProgramTab) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: target.id },
            world: 'MAIN',
            func: () => {
              // React 상태 강제 전환 — appMode='premium_compare' + premiumView='plan'
              // setter 가 전역에 노출 안 되어 있을 가능성 있으므로 버튼 클릭으로 대신 트리거
              try {
                // 1) 보험사별 비교 탭 클릭 — "보험사별 비교"/"보험사비교" 둘 다 매칭(라벨 축약 호환)
                const tabs = Array.from(document.querySelectorAll('button'));
                const compareBtn = tabs.find(b => /보험사\s*(별\s*)?비교/.test(b.textContent || ''));
                if (compareBtn) compareBtn.click();
                // 2) 가설계 토글 클릭 (이미 활성이면 noop)
                setTimeout(() => {
                  const tabs2 = Array.from(document.querySelectorAll('button'));
                  const planBtn = tabs2.find(b => /가설계/.test(b.textContent || ''));
                  if (planBtn) planBtn.click();
                }, 100);
              } catch (e) { console.warn('[ext] auto-switch failed:', e); }
            }
          });
          // iframe 로드 대기 (최대 3초)
          await new Promise(resolve => setTimeout(resolve, 700));
        } catch (e) { console.warn('[ext] mode-switch err:', e); }
      }
      // 🔑 allFrames:true → iframe(premium_plan.html) 의 window.__applyPremiumDataFromExtension 호출
      let frameResults = [];
      try {
        frameResults = await chrome.scripting.executeScript({
          target: { tabId: target.id, allFrames: true },
          world: 'MAIN',
          args: [dataJson],
          func: (json) => {
            try {
              const data = JSON.parse(json);
              if (typeof window.__applyPremiumDataFromExtension === 'function') {
                window.__applyPremiumDataFromExtension(data);
                return { ok: true, location: location.href };
              }
              return { ok: false, error: 'no receiver', location: location.href };
            } catch (e) { return { ok: false, error: e.message, location: location.href }; }
          }
        });
      } catch (e) {
        alert('스크립트 실행 실패: ' + (e.message || e) + '\n\n파일 URL 권한이 필요할 수 있습니다.\n· chrome://extensions → "토스인슈 CRM 데이터 추출기" 상세 → "파일 URL 액세스 허용" ON');
        return;
      }
      // iframe 이 늦게 로드된 경우 1회 재시도 (최대 3초 추가 대기)
      let okFrame = frameResults.find(r => r && r.result && r.result.ok);
      if (!okFrame) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        try {
          frameResults = await chrome.scripting.executeScript({
            target: { tabId: target.id, allFrames: true },
            world: 'MAIN',
            args: [dataJson],
            func: (json) => {
              try {
                const data = JSON.parse(json);
                if (typeof window.__applyPremiumDataFromExtension === 'function') {
                  window.__applyPremiumDataFromExtension(data);
                  return { ok: true, location: location.href };
                }
                return { ok: false, error: 'no receiver', location: location.href };
              } catch (e) { return { ok: false, error: e.message, location: location.href }; }
            }
          });
          okFrame = frameResults.find(r => r && r.result && r.result.ok);
        } catch {}
      }
      if (okFrame) {
        await chrome.tabs.update(target.id, { active: true });
        await chrome.windows.update(target.windowId, { focused: true });
        showToast('✅ 보험료 비교에 적용 완료!');
      } else {
        // 디버그 정보 — 어느 프레임이 시도되었는지
        const tried = frameResults.map(r => r?.result?.location || '(unknown)').join('\n  · ');
        const errMsg = frameResults.map(r => r?.result?.error).filter(Boolean).join(' / ') || 'receiver 없음';
        alert(
          '적용 실패: window.__applyPremiumDataFromExtension 함수를 찾지 못했습니다.\n\n' +
          '시도한 프레임:\n  · ' + (tried || '(없음)') + '\n\n' +
          '확인사항:\n' +
          '① 보험료 비교(plan.html) 페이지를 한 번 새로고침 (Ctrl+Shift+R) — 옛 버전이면 수신 함수가 없습니다\n' +
          '② 보장분석 프로그램에서 "보험사별 비교" 탭을 한 번 클릭해 iframe 을 활성화\n' +
          '③ https://tossinssu-pro.vercel.app/plan.html 단독 탭을 따로 열어두는 방법도 있음\n\n' +
          '내부 오류: ' + errMsg
        );
      }
      return;
    }

    // 🆕 우리 CRM (ympaint-86457.web.app 또는 page_*.html) 우선 검색
    //    그 다음 보장분석 프로그램(toss_insu*.html) 폴백
    const crmTabs = allTabs.filter(t => {
      if (!t.url) return false;
      // ympaint-86457 호스팅 페이지
      if (/ympaint-86457\.(web\.app|firebaseapp\.com)\/page_/i.test(t.url)) return true;
      // 로컬/기타 호스팅의 page_*.html
      if (/page_(jmin|leader|manager|member|rookie|admin)\.html/i.test(t.url)) return true;
      return false;
    });
    const legacyTabs = allTabs.filter(t =>
      t.url && (
        /toss_insu\d*_?\d*\.html/i.test(t.url) ||
        (/tossinssu-pro\.vercel\.app/i.test(t.url) && !/(plan|editor|index)\.html/i.test(t.url))
      )
    );
    // 우선순위: CRM 탭 → 보장분석 프로그램 탭
    let programTabs = crmTabs.length > 0 ? crmTabs : legacyTabs;
    console.log('[btnApply] 대상 탭 검색:', { crm: crmTabs.length, legacy: legacyTabs.length, 선택: programTabs.length > 0 ? programTabs[0].url : '없음' });

    // 🆕 열린 탭이 없으면 마지막으로 성공한 URL 을 자동으로 열고 적용
    if (programTabs.length === 0) {
      const stored = await new Promise(res => {
        try { chrome.storage.local.get(['lastProgramUrl'], v => res(v || {})); } catch { res({}); }
      });
      const lastUrl = stored.lastProgramUrl;
      if (!lastUrl) {
        alert('대상 프로그램이 열려있지 않습니다.\n\n다음 중 하나를 먼저 브라우저에서 열어주세요:\n• 보장분석 프로그램: https://tossinssu-pro.vercel.app\n• 보험료 비교: https://tossinssu-pro.vercel.app/plan.html');
        return;
      }
      console.log('[btnApply] 프로그램 탭 없음 — 마지막 URL 로 자동 오픈:', lastUrl);
      let newTab;
      try {
        newTab = await chrome.tabs.create({ url: lastUrl, active: true });
      } catch (e) {
        alert('탭 자동 오픈 실패: ' + (e.message || e) + '\n\n· file:// URL 권한이 필요합니다.\n· chrome://extensions → 토스인슈 CRM 데이터 추출기 → "파일 URL 액세스 허용" ON');
        return;
      }
      // 페이지가 로드되어 window.__applyTossDataFromExtension 이 정의될 때까지 폴링 (최대 15초)
      const isReady = await new Promise((resolve) => {
        let elapsed = 0;
        const tid = setInterval(async () => {
          elapsed += 400;
          try {
            const [r] = await chrome.scripting.executeScript({
              target: { tabId: newTab.id },
              world: 'MAIN',
              func: () => typeof window.__applyTossDataFromExtension === 'function'
            });
            if (r && r.result === true) { clearInterval(tid); resolve(true); return; }
          } catch {}
          if (elapsed >= 15000) { clearInterval(tid); resolve(false); }
        }, 400);
      });
      if (!isReady) {
        alert('새 탭이 열렸으나 페이지가 응답하지 않습니다.\n\n· 파일 경로가 유효한지 확인\n· 페이지가 완전히 로드된 뒤 다시 적용을 시도해주세요');
        return;
      }
      programTabs = [newTab];
    }

    const programTab = programTabs[0];
    const textData = formatAsText(extractedData);

    // 프로그램 페이지의 main world에서 함수 호출
    let result;
    try {
      const [scriptResult] = await chrome.scripting.executeScript({
        target: { tabId: programTab.id },
        world: 'MAIN',
        args: [textData],
        func: (text) => {
          if (typeof window.__applyTossDataFromExtension === 'function') {
            try {
              window.__applyTossDataFromExtension(text);
              return { ok: true };
            } catch (e) {
              return { ok: false, error: e.message };
            }
          }
          return { ok: false, error: 'window.__applyTossDataFromExtension is not defined' };
        }
      });
      result = scriptResult?.result;
    } catch (e) {
      // file:// 권한 부족 시
      if (e.message.includes('Cannot access') || e.message.includes('file URLs')) {
        alert('❌ file:// URL 접근 권한이 필요합니다.\n\n1. chrome://extensions 열기\n2. 토스인슈 CRM 데이터 추출기의 "상세" 클릭\n3. "파일 URL에 대한 액세스 허용" 토글 활성화\n4. 확장프로그램 reload 후 다시 시도');
        return;
      }
      throw e;
    }

    if (result?.ok) {
      // 프로그램 탭으로 자동 전환
      await chrome.tabs.update(programTab.id, { active: true });
      await chrome.windows.update(programTab.windowId, { focused: true });
      // 🆕 적용 성공 시 URL 저장 — 다음에 탭이 닫혀있어도 자동으로 열어 적용 가능
      try {
        if (programTab.url) chrome.storage.local.set({ lastProgramUrl: programTab.url });
      } catch {}
      showToast('✅ 프로그램에 적용 완료!');
      // 0.8초 후 popup 자동 닫기
      setTimeout(() => window.close(), 800);
    } else {
      // 폴백: 클립보드에 데이터 쓰고 사용자에게 안내
      await copyToClipboard(textData, '클립보드에 복사됨 — 프로그램에서 Ctrl+V 하세요');
      await chrome.tabs.update(programTab.id, { active: true });
      const reason = result?.error || 'unknown';
      alert(`자동 적용 실패: ${reason}\n\n프로그램이 최신 버전인지 확인하고 새로고침 후 다시 시도하세요.\n클립보드에 복사되어 있으니 Ctrl+V로 붙여넣을 수도 있습니다.`);
    }
  } catch (e) {
    console.error('[btnApply] Apply error:', e);
    alert('적용 실패: ' + (e.message || 'unknown'));
  } finally {
    clearTimeout(safetyTimer);   // safety timer 정리
    btn.textContent = '📤 프로그램 적용';
    btn.disabled = false;
    console.log('[btnApply] 완료 — button 복구');
  }
});

function showCopyButtons(show) {
  const dev = document.getElementById('devToolbar');
  if (dev) dev.style.display = show ? 'flex' : 'none';
  document.getElementById('btnApply').style.display = show ? '' : 'none';
}

function isMasked(v) {
  return typeof v === 'string' && /\*{2,}/.test(v);
}

function renderResult(data) {
  const content = document.getElementById('resultContent');
  const badge = document.getElementById('pageBadge');

  if (data.type === 'customer') {
    badge.textContent = '상세 페이지';
    content.innerHTML = renderCustomer(data.customer);
  } else if (data.type === 'coverage') {
    badge.textContent = '보장 페이지';
    content.innerHTML = renderCoverage(data.insurances);
  } else if (data.type === 'premium_compare') {
    // 🆕 한장으로 보는 보험료 비교 — 보험사 카드 + 담보 수 요약 표시
    badge.textContent = '보험료 비교';
    content.innerHTML = renderPremiumCompare(data);
  } else if (data.type === 'error') {
    showNotice('⚠️', '오류가 발생했습니다', data.error || '');
  } else {
    badge.textContent = '미지원';
    showNotice('🚫', '지원하지 않는 페이지입니다', '상세/보장 또는 보험료 비교 페이지에서 사용해주세요');
  }
}

// 🆕 한장으로 보는 보험료 비교 결과 카드 렌더러
function renderPremiumCompare(data) {
  const cos = (data.companies || []).slice().sort((a, b) => (a.total || 0) - (b.total || 0));
  const covCount = (data.coverages || []).length;
  const filled = (data.coverages || []).filter(c => c.currentValue > 0).length;
  let html = `<div class="alert success">✅ 보험료 비교 데이터 추출 완료 — ${cos.length}개 보험사 · ${covCount}개 담보 (${filled}개 가입금액 입력됨)</div>`;
  html += `<div class="section"><div class="section-header"><span>🏆 보험사별 총보험료 (저렴 순)</span><span class="count">${cos.length}개</span></div>`;
  cos.forEach((c, i) => {
    const rank = i + 1;
    const rankColor = rank === 1 ? '#16a34a' : (rank === 2 ? '#3182f6' : (rank === 3 ? '#f59e0b' : '#64748b'));
    html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #f1f5f9;">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${rankColor};color:#fff;font-weight:800;font-size:11px;">${rank}</span>
      <span style="flex:1;font-weight:700;font-size:13px;">${escapeHtml(c.name || c.code)}</span>
      <span style="font-weight:800;font-size:13px;color:#1e293b;">${(c.total||0).toLocaleString()}원</span>
    </div>`;
  });
  html += `</div>`;
  html += `<div class="alert">▶ <strong>"프로그램에 적용"</strong> 버튼을 누르면 보험료 비교(plan.html) 또는 보장분석의 "보험사별 비교" iframe 으로 자동 채워집니다.</div>`;
  return html;
}

function escapeHtml(s) { return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function renderCustomer(customer) {
  const priorityFields = ['고객명', '성별', '생년월일', '상령일', '연락처', '이메일', '주소', '직업', '하는일',
                          '주민등록번호', '키', '몸무게', '운전여부', '통신사'];
  const otherFields = Object.keys(customer).filter(k =>
    !priorityFields.includes(k) && k !== '고객ID' && !k.startsWith('_')
  );

  let html = '';

  // 마스킹 복원 상태 알림
  if (customer._마스킹복원 === true) {
    html += `<div class="alert success">✅ 마스킹된 정보를 서버에서 복원했습니다</div>`;
  } else if (customer._마스킹복원 === 'partial') {
    html += `<div class="alert">⚠️ 일부 정보만 복원되었습니다 (전화번호만 가능)</div>`;
  } else if (customer._마스킹복원 === false) {
    html += `<div class="alert error">❌ 마스킹 복원 실패 — 권한이 없거나 API 호출이 실패했습니다.<br>토스인슈 CRM에 로그인된 상태인지 확인해주세요.</div>`;
  }

  if (customer._마스킹잔여 && customer._마스킹잔여.length > 0) {
    html += `<div class="alert">⚠️ 일부 필드는 여전히 마스킹되어 있습니다: ${customer._마스킹잔여.join(', ')}</div>`;
  }

  // 마스킹 복원된 필드인지 추정 (값에 *가 없으면 복원된 것)
  const wasMasked = (field) => customer._마스킹복원 === true && ['연락처', '이메일', '주소', '주민등록번호'].includes(field) && !isMasked(customer[field]);

  html += `<div class="section">
    <div class="section-header">
      <span>👤 고객 기본 정보</span>
      <span class="count">ID: ${customer['고객ID'] || '-'}</span>
    </div>`;

  priorityFields.forEach(field => {
    if (customer[field]) {
      const val = customer[field];
      const cls = isMasked(val) ? 'still-masked' : (wasMasked(field) ? 'was-masked' : '');
      html += `<div class="field-row">
        <span class="field-label">${field}</span>
        <span class="field-value ${cls}">${escHtml(val)}</span>
      </div>`;
    }
  });

  html += '</div>';

  if (otherFields.length > 0) {
    html += `<div class="section">
      <div class="section-header">추가 정보</div>`;
    otherFields.forEach(field => {
      html += `<div class="field-row">
        <span class="field-label">${field}</span>
        <span class="field-value ${isMasked(customer[field]) ? 'still-masked' : ''}">${escHtml(customer[field])}</span>
      </div>`;
    });
    html += '</div>';
  }

  return html;
}

function renderCoverage(insurances) {
  if (!insurances || insurances.length === 0) {
    return `<div class="notice"><div class="icon">📋</div><p>보장 내역이 없습니다</p></div>`;
  }

  let html = `<div style="padding: 8px 8px 4px; font-size: 12px; color: #5f6368;">
    총 ${insurances.length}건의 보험 내역
  </div>`;

  insurances.forEach((ins, idx) => {
    const status = ins['계약상태'] || '';
    const statusClass = status.includes('유효') || status.includes('납입중') ? 'status-active'
      : status.includes('소멸') || status.includes('만기') ? 'status-ended'
      : 'status-other';

    html += `<div class="insurance-card">
      <div class="insurance-card-header">
        <span>${escHtml(ins['보험명'] || `보험 ${idx + 1}`)}</span>
        ${status ? `<span class="status-badge ${statusClass}">${escHtml(status)}</span>` : ''}
        <span class="company">${escHtml(ins['보험사명'] || '')}</span>
      </div>`;

    const displayFields = ['보험사명', '계약일', '계약상태', '갱신 유무', '계약자/피보험자', '증권번호',
      '납입 여부', '납입주기/납입기간', '보장만기/만기연령', '납입종료일/종료연령',
      '월납보험료', '기납보험료', '잔여보험료', '총보험료', '대분류', '소분류',
      '매니저 의견', '매니저 코멘트'];

    displayFields.forEach(field => {
      if (ins[field]) {
        html += `<div class="field-row">
          <span class="field-label">${field}</span>
          <span class="field-value">${escHtml(ins[field])}</span>
        </div>`;
      }
    });

    html += '</div>';
  });

  return html;
}

function formatAsText(data) {
  // 🆕 한장으로 보는 보험료 비교 데이터
  if (data && data.type === 'premium_compare') {
    const lines = [`=== 보험료 비교 (${(data.companies||[]).length}개 보험사 · ${(data.coverages||[]).length}개 담보) ===`];
    (data.companies || []).forEach((c, i) => {
      lines.push(`[${i+1}] ${c.name || c.code} — 총 ${(c.total||0).toLocaleString()}원`);
      if (c.productName) lines.push(`     상품: ${c.productName}`);
      if (c.planInfo)    lines.push(`     플랜: ${c.planInfo}`);
    });
    lines.push(`\n--- 담보별 보험료 ---`);
    (data.coverages || []).forEach((cv) => {
      const prs = Object.entries(cv.premiums || {}).map(([co, p]) => `${co}:${(p||0).toLocaleString()}`).join(' / ');
      lines.push(`• ${cv.name} (${cv.cd}) [가입금액 ${cv.guideAmount || 0}만]  ${prs}`);
    });
    lines.push(`\n추출 시각: ${new Date(data.extractedAt).toLocaleString('ko-KR')}`);
    lines.push(`▶ 보험료 비교(plan.html) (또는 보장분석의 "보험사별 비교" 탭) 이 열려있으면 "프로그램에 적용" 버튼으로 자동 채울 수 있습니다.`);
    return lines.join('\n');
  }
  if (data.type === 'customer') {
    const lines = ['=== 고객 정보 ==='];
    Object.entries(data.customer).forEach(([k, v]) => {
      if (k !== '고객ID' && !k.startsWith('_')) lines.push(`${k}: ${v}`);
    });
    if (data.customer['_마스킹잔여']?.length) {
      lines.push(`\n※ 마스킹 남은 필드: ${data.customer['_마스킹잔여'].join(', ')}`);
    }
    lines.push(`\n추출 시각: ${new Date(data.extractedAt).toLocaleString('ko-KR')}`);
    return lines.join('\n');
  }

  if (data.type === 'coverage') {
    const lines = [`=== 보장 내역 (총 ${data.insurances.length}건) === [EXT v3.7.9]`];
    data.insurances.forEach((ins, i) => {
      lines.push(`\n[${i + 1}] ${ins['보험명'] || '보험명 없음'} - ${ins['보험사명'] || ''}`);
      Object.entries(ins).forEach(([k, v]) => {
        if (k !== '보험명' && k !== '보험사명') lines.push(`  ${k}: ${v}`);
      });
    });

    // 상품별 보장 상세 데이터
    if (data.coverageDetails && data.coverageDetails.length > 0) {
      // 상품 요약
      if (data.productSummary && data.productSummary.length > 0) {
        lines.push(`\n\n=== 상품별 보장 추출 요약 (${data.productSummary.length}개 상품) ===`);
        data.productSummary.forEach(s => {
          lines.push(`  • [${s.섹션번호}] ${s.보험사명 || '-'} / ${s.상품명 || '상품명 없음'} → ${s.담보수}개 담보`);
        });
      }
      // 상품별 그룹화하여 출력
      lines.push(`\n\n=== 상품별 보장 목록 (총 ${data.coverageDetails.length}건) ===`);
      const grouped = {};
      data.coverageDetails.forEach(det => {
        const key = `${det['_섹션번호']}::${det['_상품명'] || '미분류'}`;
        if (!grouped[key]) grouped[key] = { 보험사명: det['_보험사명'] || '', 상품명: det['_상품명'] || '미분류', 섹션번호: det['_섹션번호'], rows: [] };
        grouped[key].rows.push(det);
      });
      Object.values(grouped)
        .sort((a, b) => (a.섹션번호 || 0) - (b.섹션번호 || 0))
        .forEach(grp => {
          lines.push(`\n[상품 ${grp.섹션번호}] ${grp.보험사명 ? grp.보험사명 + ' / ' : ''}${grp.상품명}`);
          // 대분류별로 다시 정렬
          const byMajor = {};
          grp.rows.forEach(det => {
            const major = det['보장 대분류'] || '기타';
            if (!byMajor[major]) byMajor[major] = [];
            byMajor[major].push(det);
          });
          Object.entries(byMajor).forEach(([major, dets]) => {
            lines.push(`  ◆ ${major}`);
            dets.forEach(det => {
              const minor = det['보장 소분류'] || '';
              const name = det['보장명'] || '';
              const amount = det['보장 금액'] || '';
              const term = det['납입기간'] || '';
              const start = det['보장시작일'] || '';
              const end = det['보장종료일'] || '';
              const tab = det['_tabType'] || '';
              const aIdx = (typeof det['_accordionIdx'] === 'number') ? det['_accordionIdx'] : -1;
              lines.push(`    • [${minor}] ${name}`);
              // 🔑 텍스트 포맷에 탭/accordion 정보 보존 — 메인 앱 파서가 이 값으로 _tabType / _accordionIdx 복원
              lines.push(`      금액: ${amount} / 납입기간: ${term} / ${start} ~ ${end} [META tab=${tab} aIdx=${aIdx}]`);
            });
          });
        });
    }

    // 🆕 고객 기본정보 블록 — 앱 파서가 이 마커로 customer 복원 (이름/성별/생년월일/상령일/최초보험연결일/상담문의)
    //   ⚠️ formatAsText 가 customer 를 누락하면 앱이 옛 customerInfo 를 그대로 표시하는 버그 → 여기서 항상 동봉.
    if (data.customer && Object.keys(data.customer).length > 0) {
      lines.push(`\n=== 고객 기본정보 ===`);
      const _c = data.customer;
      ['고객명', '성별', '생년월일', '생년월일표시', '상령일', '최초보험연결일', '상담문의', '보험나이'].forEach(k => {
        if (_c[k]) lines.push(`${k}: ${_c[k]}`);
      });
    }
    lines.push(`\n추출 시각: ${new Date(data.extractedAt).toLocaleString('ko-KR')}`);
    return lines.join('\n');
  }

  return '';
}

async function copyToClipboard(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`✅ ${message}`);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(`✅ ${message}`);
  }
}

async function saveData(data) {
  const result = await chrome.storage.sync.get('savedRecords');
  const records = result.savedRecords || [];

  const id = data.type === 'customer'
    ? (data.customer['고객ID'] || Date.now())
    : (data.customerId || Date.now());

  const existingIdx = records.findIndex(r => r.id === String(id) && r.type === data.type);
  const record = {
    id: String(id),
    type: data.type,
    savedAt: new Date().toISOString(),
    name: data.type === 'customer'
      ? (data.customer['고객명'] || '이름 없음')
      : `보장 내역 (${data.customerId})`,
    data
  };

  if (existingIdx >= 0) records[existingIdx] = record;
  else records.unshift(record);

  const trimmed = records.slice(0, 50);
  await chrome.storage.sync.set({ savedRecords: trimmed });
}

async function loadSavedList() {
  const result = await chrome.storage.sync.get('savedRecords');
  const records = result.savedRecords || [];
  const listEl = document.getElementById('savedList');

  if (records.length === 0) {
    listEl.innerHTML = `<div class="notice">
      <div class="icon">📂</div>
      <p>저장된 데이터가 없습니다</p>
      <p class="sub">현재 페이지에서 데이터를 추출하고 저장해보세요</p>
    </div>`;
    return;
  }

  listEl.innerHTML = records.map(rec => `
    <div class="saved-item">
      <div class="saved-item-info">
        <div class="name">${escHtml(rec.name)}</div>
        <div class="meta">${rec.type === 'customer' ? '👤 고객정보' : '📋 보장내역'} · ${new Date(rec.savedAt).toLocaleString('ko-KR')}</div>
      </div>
      <div class="saved-item-actions">
        <button class="btn-sm btn-copy btn-load" data-id="${escHtml(rec.id)}" data-type="${rec.type}">복사</button>
        <button class="btn-sm btn-danger btn-delete" data-id="${escHtml(rec.id)}" data-type="${rec.type}">삭제</button>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('.btn-load').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { id, type } = btn.dataset;
      const result = await chrome.storage.sync.get('savedRecords');
      const rec = (result.savedRecords || []).find(r => r.id === id && r.type === type);
      if (rec) copyToClipboard(formatAsText(rec.data), '클립보드에 복사되었습니다');
    });
  });

  listEl.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { id, type } = btn.dataset;
      const result = await chrome.storage.sync.get('savedRecords');
      const records = (result.savedRecords || []).filter(r => !(r.id === id && r.type === type));
      await chrome.storage.sync.set({ savedRecords: records });
      showToast('🗑️ 삭제되었습니다');
      loadSavedList();
    });
  });
}

function showNotice(icon, title, sub = '') {
  document.getElementById('resultContent').innerHTML = `
    <div class="notice">
      <div class="icon">${icon}</div>
      <p>${title}</p>
      ${sub ? `<p class="sub">${sub}</p>` : ''}
    </div>`;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  const badge = document.getElementById('pageBadge');

  // 🆕 한장으로 보는 보험료 비교 페이지 패턴 — file:// 저장본까지 폭넓게 인식
  const isPremiumCompare = (
    url.includes('mmlfcp.ohmymanager.com') ||
    url.includes('ohmymanager.com') ||
    /한장으로|한장으로%20|premium_plan|premium-compare|tossinssu-pro\.vercel\.app\/plan\.html/i.test(url) ||
    /보험료%20비교|보험료비교/.test(url)
  );

  if (url.includes('crm.tossinsu.com/crm-v2/customers/')) {
    badge.textContent = '상세 페이지';
    badge.style.background = 'rgba(52, 168, 83, 0.3)';
  } else if (url.includes('crm.tossinsu.com/crm-v2/cover/')) {
    badge.textContent = '보장 페이지';
    badge.style.background = 'rgba(52, 168, 83, 0.3)';
  } else if (url.includes('crm.tossinsu.com')) {
    badge.textContent = 'CRM 접속 중';
  } else if (isPremiumCompare) {
    badge.textContent = '보험료 비교';
    badge.style.background = 'rgba(59, 130, 246, 0.35)';
  } else if (/^file:\/\//i.test(url)) {
    // file:// — 일단 추출 시도 허용. content.js 가 DOM 보고 페이지 타입 자동 판정
    badge.textContent = '로컬 파일';
    badge.style.background = 'rgba(100, 116, 139, 0.35)';
  } else {
    // 알 수 없는 페이지여도 비활성화하지 않음 — 사용자가 시도하면 content.js 가 페이지 타입 검사 후 알려줌
    badge.textContent = '외부 페이지';
    // 안내 메시지만 (버튼은 활성 유지)
    showNotice('ℹ️', '지원 페이지', 'CRM 상세/보장 페이지 또는 한장으로 보는 보험료 비교 페이지에서 사용하세요. 그 외 페이지에서는 추출이 동작하지 않을 수 있습니다.');
  }
})();
