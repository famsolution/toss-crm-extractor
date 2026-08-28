
const CFG_KEY = 'premium_compare_cfg';
const CFG_TEMPLATES_KEY = 'premium_compare_templates';
const TARGET_MODE_KEY = 'apply_target_mode';
const EXT_UI_MODE_KEY = 'ext_ui_mode_v1';

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

function _setUiModeVisual(mode) {
  const popupBtn = document.getElementById('uiModePopupBtn');
  const sideBtn = document.getElementById('uiModeSideBtn');
  if (popupBtn) popupBtn.classList.toggle('active', mode !== 'sidepanel');
  if (sideBtn) sideBtn.classList.toggle('active', mode === 'sidepanel');
}
function _requestUiMode(mode, openNow) {
  const next = mode === 'sidepanel' ? 'sidepanel' : 'popup';
  _setUiModeVisual(next);
  try { chrome.storage.local.set({ [EXT_UI_MODE_KEY]: next }); } catch {}
  try {
    chrome.runtime.sendMessage({ action: 'extSetUiMode', mode: next, open: !!openNow }, (res) => {
      if (chrome.runtime.lastError) {
        showToast('표시 방식 저장됨 - 확장 새로고침 후 적용');
        return;
      }
      if (res && res.ok === false) {
        alert(res.error || '표시 방식을 변경하지 못했습니다.');
        return;
      }
      if (next === 'sidepanel') {
        showToast(res && res.openError ? '오른쪽 세로바로 설정됨 - 확장 아이콘을 다시 눌러 열어주세요' : '오른쪽 세로바로 전환됨');
        setTimeout(() => { try { window.close(); } catch {} }, 180);
      } else {
        showToast('팝업 방식으로 전환됨');
      }
    });
  } catch (e) {
    showToast('표시 방식 저장됨');
  }
}
function _initUiModeControls() {
  const popupBtn = document.getElementById('uiModePopupBtn');
  const sideBtn = document.getElementById('uiModeSideBtn');
  if (!popupBtn && !sideBtn) return;
  try {
    chrome.storage.local.get([EXT_UI_MODE_KEY], v => _setUiModeVisual(v?.[EXT_UI_MODE_KEY] || 'popup'));
  } catch { _setUiModeVisual('popup'); }
  popupBtn?.addEventListener('click', () => _requestUiMode('popup', false));
  sideBtn?.addEventListener('click', () => _requestUiMode('sidepanel', true));
}

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
    'premium-page': '현재 활성 탭(보험료 비교 페이지) 의 폼을 자동 입력 — 이름/생년월일/성별/유형/만기/담보',
    'paintpro': '토스 보장분석 표 이미지를 페인트 프로로 전송 (📤 프로그램 적용 시 실행)',
    'absence': '추출 데이터를 부재고객[경고] 스튜디오로 전송 (📤 프로그램 적용 시 실행)'
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

