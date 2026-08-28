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
  _initUiModeControls();
  document.querySelectorAll('input[name="targetMode"]').forEach(r => {
    r.addEventListener('change', () => {
      updateTargetHint();
      _syncTmBtns();
      try { chrome.storage.local.set({ [TARGET_MODE_KEY]: getTargetMode() }); } catch {}
    });
  });
  // 🆕 부재고객[경고] 버튼 — 현재 활성 탭(토스 보장분석)에 sendToStudio 트리거
  // Absence warning button: send current extraction with product-selection rule.
  const _absBtn = document.getElementById('btn_absence_warn');
  if (_absBtn) {
    _absBtn.addEventListener('click', async () => {
      const data = extractedData;
      if (!data) { alert('먼저 데이터 추출 버튼을 눌러 데이터를 추출해 주세요.'); return; }
      _openAbsenceStudio(data);
    });
  }
  const _ppBtn = document.getElementById('btn_paintpro');
  if (_ppBtn) {
    _ppBtn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      // 토스 보장분석 페이지(앵커 존재)인지 확인
      let hasAnchor = false;
      try {
        const r = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => !!document.getElementById('__paintpro_send')
        });
        hasAnchor = !!(r && r[0] && r[0].result);
      } catch {}
      if (!hasAnchor) { alert('토스 보장분석 페이지에서 실행해 주세요.'); return; }
      // 🔑 popup 을 닫아 페이지 focus 복귀 → content.js 가 clipboard.read() 실행 가능
      //    (popup 이 떠 있으면 페이지에 focus 가 없어 클립보드 읽기가 브라우저 보안으로 차단됨)
      try { chrome.tabs.sendMessage(tab.id, { action: 'triggerPaintPro' }, () => { void chrome.runtime.lastError; }); } catch {}
      setTimeout(() => window.close(), 120);
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

  // 🆕 페이지별 버튼 표시/숨김 — 현재 활성 탭 URL로 컨텍스트 감지
  function applyPageContext(url) {
    const u = decodeURIComponent(url || '');
    const isCoverage   = /crm\.tossinsu\.com.*\/cover\//i.test(u);           // 토스 보장분석
    const isCustomer   = /crm\.tossinsu\.com.*\/customers?\//i.test(u);      // 토스 고객 페이지
    const isPremium    = /mmlfcp\.ohmymanager\.com/i.test(u);                // 보험료 비교 폼
    const isVercel     = /tossinssu-pro\.vercel\.app/i.test(u);
    const isPlan       = isVercel && /plan\.html/i.test(u);                   // 가설계
    const isEditor     = isVercel && /editor\.html/i.test(u);                // 페인트프로 에디터
    const isApp        = isVercel && !isPlan && !isEditor;                    // 보장분석 앱 메인

    const targetPanel  = document.querySelector('[data-target-panel]');
    const cfgPanel     = document.querySelector('.cfg-panel');

    // 버튼 ID → 표시 여부 매핑
    const btnMap = {
      tm_auto:        isCustomer || (!isCoverage && !isPremium && !isVercel),  // 기타 페이지
      tm_consult:     isCustomer,
      tm_std:         isCoverage || isApp,
      tm_plan:        isPlan,
      tm_prem:        isCoverage,
      tm_paintpro:    isCoverage,
      tm_absence:     isCoverage,
    };

    // label(for=id) 또는 button(id) 표시 제어
    Object.entries(btnMap).forEach(([id, show]) => {
      const el = document.getElementById(id);
      if (!el) return;
      // label 이면 부모가 button 역할; button 이면 그냥 button
      const target = el.tagName === 'INPUT' ? document.querySelector(`label[for="${id}"]`) : el;
      if (target) target.style.display = show ? '' : 'none';
    });

    if (isPremium) {
      // 보험료 비교 페이지: 전송 대상 패널 숨김 + plan 자동 선택
      if (targetPanel) targetPanel.style.display = 'none';
      setTargetMode('plan');
      try { chrome.storage.local.set({ [TARGET_MODE_KEY]: 'plan' }); } catch {}
    } else {
      if (targetPanel) targetPanel.style.display = '';
      // 기본 선택: 페이지에 맞는 라디오 자동 설정
      if (isCoverage)     { setTargetMode('standard'); }
      else if (isCustomer){ setTargetMode('consult'); try { chrome.storage.local.set({ [TARGET_MODE_KEY]: 'consult' }); } catch {} }
      else if (isPlan)    { setTargetMode('plan'); }
      else if (isApp)     { setTargetMode('standard'); }
    }

    // 고객 페이지에서는 cfg 패널 숨김
    if (cfgPanel) cfgPanel.style.display = isCustomer ? 'none' : '';

    updateTargetHint();
    _syncTmBtns();
  }

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    applyPageContext(activeTab?.url || '');
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

