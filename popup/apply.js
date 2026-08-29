// ─────────────────────────────────────────────────────────────
// '📤 프로그램 적용' — 대상 탭 판별과 데이터 주입 헬퍼.
//   원래 btnApply 핸들러 안의 클로저였다. 핸들러 밖에서도 읽히도록 끌어올렸다.
// ─────────────────────────────────────────────────────────────
// 🆕 보장분석 프로그램 탭 찾기 헬퍼
function findProgramTab(allTabs) { return allTabs.find(t => t.url && (
  /toss_insu\d*_?\d*\.html/i.test(t.url) ||                        // 로컬 파일
  (/tossinssu-pro\.vercel\.app/i.test(t.url) && !/(plan|editor|index)\.html/i.test(t.url)) // Vercel 메인
)); }
// 🆕 mmlfcp 페이지 식별 헬퍼 (premium_plan.html iframe 도 포함)
const isPremiumComparePageUrl = (u) => u && (
  /mmlfcp\.ohmymanager\.com/i.test(u) ||
  /ohmymanager\.com/i.test(u) ||
  /보험료\s*비교/i.test(decodeURIComponent(u || '')) ||
  /premium_plan\.html/i.test(u) ||
  /tossinssu-pro\.vercel\.app\/plan\.html/i.test(u)
);
const PLAN_APP_DEFAULT_URL = 'https://tossinssu-pro.vercel.app/app.html';
const isPlanReceiverUrl = (u) => !!u && (
  /premium_plan\.html/i.test(u) ||
  /tossinssu-pro\.vercel\.app\/plan\.html/i.test(u)
);
const isProgramAppUrl = (u) => !!u && (
  /toss_insu\d*_?\d*\.html/i.test(u) ||
  (/tossinssu-pro\.vercel\.app/i.test(u) && !/(editor|index)\.html/i.test(u))
);
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _switchToPlanView = async (tab, opts = {}) => {
  if (!tab || isPlanReceiverUrl(tab.url)) return true;
  const tries = opts.quick ? 1 : 4;
  for (let i = 0; i < tries; i++) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => {
          const norm = (s) => String(s || '').replace(/\s+/g, '');
          const isVisible = (el) => {
            try {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            } catch { return true; }
          };
          const controls = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"], a'))
            .filter(isVisible);
          const byText = (re) => controls.find(el => re.test(norm(el.textContent || el.innerText || el.value || '')));
          const compareBtn = byText(/보험사(별)?비교|보험사비교|보험료비교|비교표/);
          if (compareBtn) compareBtn.click();
          setTimeout(() => {
            const controls2 = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"], a'));
            const planBtn = controls2.find(el => /가설계/.test(norm(el.textContent || el.innerText || el.value || '')));
            if (planBtn) planBtn.click();
          }, 180);
          return { compareClicked: !!compareBtn };
        }
      });
    } catch (e) {
      console.warn('[btnApply/plan] 가설계 화면 전환 스크립트 실패:', e);
    }
    await _sleep(opts.quick ? 500 : 900);
    try {
      const probe = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        world: 'MAIN',
        func: () => ({
          ok: typeof window.__applyPremiumDataFromExtension === 'function',
          location: location.href
        })
      });
      if (probe.some(r => r?.result?.ok)) return true;
    } catch {}
  }
  return false;
};
const _applyPremiumDataToPlan = async (target, dataJson, opts = {}) => {
  const started = Date.now();
  const maxMs = opts.maxMs || 35000;
  let frameResults = [];
  let lastError = '';
  while (Date.now() - started < maxMs) {
    if (opts.switchPlan) await _switchToPlanView(target, { quick: true });
    try {
      frameResults = await chrome.scripting.executeScript({
        target: { tabId: target.id, allFrames: true },
        world: 'MAIN',
        args: [dataJson],
        func: async (json) => {
          try {
            const data = JSON.parse(json);
            if (typeof window.__applyPremiumDataFromExtension === 'function') {
              const ret = window.__applyPremiumDataFromExtension(data);
              if (ret && typeof ret.then === 'function') await ret;
              return { ok: true, location: location.href };
            }
            return { ok: false, error: 'receiver 없음', location: location.href };
          } catch (e) {
            return { ok: false, error: e.message, location: location.href };
          }
        }
      });
      const okFrame = frameResults.find(r => r?.result?.ok);
      if (okFrame) return { ok: true, okFrame, frameResults };
      lastError = frameResults.map(r => r?.result?.error).filter(Boolean).join(' / ') || lastError;
    } catch (e) {
      lastError = e.message || String(e);
      console.warn('[btnApply/plan] 가설계 데이터 주입 재시도:', lastError);
    }
    await _sleep(900);
  }
  return { ok: false, frameResults, error: lastError || 'receiver 없음' };
};

// 🤖 전송 대상 자동 감지 — 활성 탭 "주소" 로 어디에 보낼지 정한다.
//   · CRM 고객정보 페이지(/customers/)          → consult      (📝 상담등록)
//   · CRM 보장 페이지(/cover/)                   → standard     (📊 표준 보장분석)
//   · 보험료 비교 페이지(mmlfcp / premium_plan)  → premium-page (📋 보험료 비교 폼)
//   · 상담등록 CRM(page_*.html)                  → consult
// 주소로 못 정하면 추출 데이터 종류로 폴백한다.
async function resolveAutoTarget({ isPremiumCompare, isCustomer }) {
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
    if (isPremiumCompare) resolved = 'plan';         // mmlfcp 추출 비교 데이터 → 보장분석 가설계
    else if (isCustomer)  resolved = 'consult';      // 고객 데이터 → 상담등록
    else                  resolved = 'standard';     // 보장(coverage) 등 → 표준 보장분석
  }
  const _routeLabel = { consult: '📝 상담등록', standard: '📊 표준 보장분석', 'premium-page': '📋 보험료 비교 폼', plan: '📐 가설계 탭' }[resolved] || resolved;
  console.log('[btnApply] 🤖 자동 감지 — 주소:', detectedUrl, '→ 대상:', resolved);
  try { showToast('🤖 자동 감지 → ' + _routeLabel); } catch {}
  return resolved;
}

// 🛡 호환성 가드 — 데이터 type 과 맞지 않는 대상이면 사용자에게 물어 보정한다.
//   반환: 진행할 대상 문자열 / 사용자가 거절하면 null
const COMPAT_MATRIX = {
  coverage:        { auto: true, consult: true,  standard: true,  plan: false, 'premium-page': true },
  customer:        { auto: true, consult: true,  standard: true,  plan: false, 'premium-page': true },
  premium_compare: { auto: true, consult: false, standard: false, plan: true,  'premium-page': true }
};
async function applyCompatGuard(targetMode, dataType) {
  const compat = COMPAT_MATRIX[dataType];
  if (!compat || compat[targetMode] !== false) return targetMode;

  const fallback = ['auto', 'consult', 'standard', 'plan', 'premium-page'].find(k => compat[k]);
  const proceed = await showConfirm(
    `⚠️ 호환되지 않는 전송 대상\n\n` +
    `추출 데이터: ${dataType}\n` +
    `선택한 대상: ${targetMode}\n\n` +
    `→ "${fallback}" 으로 변경해서 진행할까요?`,
    '호환되지 않는 전송 대상'
  );
  if (!proceed) return null;

  setTargetMode(fallback);
  try { chrome.storage.local.set({ [TARGET_MODE_KEY]: fallback }); } catch {}
  return fallback;
}

// ─────────────────────────────────────────────────────────────
// 전송 대상별 라우트. ctx = { btn, safetyTimer, allTabs, targetMode, is* 플래그 }
//   routePremiumPage 만 처리 여부(boolean)를 돌려준다 — 나머지는 항상 자기가 끝낸다.
// ─────────────────────────────────────────────────────────────
// 🆕 강제 라우팅 — 상담등록 (CRM page_*.html). 추출한 고객정보를 상담등록 페이지로 전송
async function routeConsult(ctx) {
  const { btn, safetyTimer, allTabs, targetMode, isPremiumCompare, isCustomer, isCoverage } = ctx;
    console.log('[btnApply] 📤 라우팅: 상담등록 (page_*.html)');
    const CONSULT_URL = 'https://ympaint-86457.web.app/page_jmin.html';
    // ⚠ device-redirect.js 가 좁은 화면·모바일에서 page_*.html → m_*.html 로 갈아탄다.
    //    m_ 을 빼놓으면 이미 열린 탭을 못 찾고 매번 새 탭을 열게 된다.
    const _isConsultUrl = (u) => !!u && (
      /ympaint-86457\.(web\.app|firebaseapp\.com)\/(page|m)_/i.test(u) ||
      /(page|m)_(jmin|leader|manager|member|rookie|admin)\.html/i.test(u)
    );
    const findConsultTabs = () => allTabs.filter(t => _isConsultUrl(t.url));

    // ⚠ 탭을 활성화하면 그 순간 팝업 문서가 파괴된다 — 뒤에 있는 alert/토스트는
    //    실행되지 못하고 사용자는 아무 안내도 못 받는다(조용한 실패).
    //    그래서 안내는 (1) 탭을 건드리기 "전에" (2) 팝업과 수명이 무관한
    //    브라우저 알림으로 띄운다. notifications 권한은 manifest 에 이미 있다.
    const _notifyConsult = (message) => {
      try {
        chrome.notifications.create({
          type: 'basic', iconUrl: 'icons/icon128.png',
          title: '토스인슈 CRM 추출기 — 상담등록', message, priority: 2
        });
      } catch (e) { console.warn('[btnApply/consult] 알림 실패:', e); }
    };

    // receiver(window.__applyTossDataFromExtension) 가 살아 있는지 1회 확인.
    const _probeReceiver = async (tabId) => {
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId }, world: 'MAIN',
          func: () => typeof window.__applyTossDataFromExtension === 'function'
        });
        return !!(r && r.result);
      } catch { return false; }
    };
    // maxMs 동안 0.5초 간격으로 receiver 를 기다린다.
    const _waitReceiver = (tabId, maxMs) => new Promise(resolve => {
      let elapsed = 0;
      const tid = setInterval(async () => {
        elapsed += 500;
        if (await _probeReceiver(tabId)) { clearInterval(tid); resolve(true); return; }
        if (elapsed >= maxMs) { clearInterval(tid); resolve(false); }
      }, 500);
    });

    // ⚠ 후보가 여러 개면 "receiver 가 실제로 살아 있는 탭" 을 고른다.
    //    크롬 메모리 세이버가 오래 방치된 탭을 폐기(discard)하면 URL 은 그대로인데
    //    JS 컨텍스트가 없다. 그런 탭을 집으면 'receiver 없음' 으로 떨어진다.
    const _candidates = findConsultTabs();
    let consultTab = null;
    for (const t of _candidates) {
      if (t.discarded) continue;
      if (await _probeReceiver(t.id)) { consultTab = t; break; }
    }
    // 살아 있는 탭이 없으면 첫 후보를 되살려 쓴다 (새로고침 후 재대기).
    if (!consultTab && _candidates.length) {
      const t = _candidates[0];
      console.log('[btnApply/consult] receiver 없는 탭 — 새로고침 후 재시도:', t.url);
      try {
        await chrome.tabs.reload(t.id);
        if (await _waitReceiver(t.id, 15000)) consultTab = t;
      } catch (e) { console.warn('[btnApply/consult] 탭 새로고침 실패:', e); }
      if (!consultTab) {
        clearTimeout(safetyTimer);
        btn.textContent = '📤 프로그램 적용';
        btn.disabled = false;
        _notifyConsult('상담등록 페이지가 응답하지 않습니다. 방금 활성화한 탭에서 로그인 상태를 확인하고, Ctrl+Shift+R 로 새로고침 후 다시 시도해 주세요.');
        try {
          await chrome.tabs.update(t.id, { active: true });
          await chrome.windows.update(t.windowId, { focused: true });
        } catch {}
        return;
      }
    }
    // 탭이 없으면 마지막 상담등록 URL → 기본 CONSULT_URL 순으로 자동 오픈
    if (!consultTab) {
      const stored = await new Promise(r => {
        try { chrome.storage.local.get(['lastConsultUrl'], v => r(v?.lastConsultUrl || null)); } catch { r(null); }
      });
      const openUrl = stored || CONSULT_URL;
      try {
        // ⚠ active:true 로 열면 안 된다. 새 탭으로 포커스가 넘어가는 순간 크롬이
        //    팝업을 닫아버리고, 팝업의 JS 컨텍스트가 통째로 사라진다. 그러면 아래의
        //    "receiver 대기 → executeScript 로 적용" 이 아예 실행되지 않아
        //    페이지만 열리고 고객 등록은 안 되는 상태가 된다.
        //    → 백그라운드로 열어 적용까지 끝낸 뒤 마지막에 활성화한다.
        consultTab = await chrome.tabs.create({ url: openUrl, active: false });
        // receiver(__applyTossDataFromExtension) 정의될 때까지 대기 (최대 15초)
        const _ready = await _waitReceiver(consultTab.id, 15000);
        if (!_ready) {
          // 로그인 화면에서 멈춰 있는 경우가 대부분 — 탭을 보여줘야 사용자가 조치할 수 있다.
          clearTimeout(safetyTimer);
          btn.textContent = '📤 프로그램 적용';
          btn.disabled = false;
          _notifyConsult('상담등록 페이지가 15초 안에 준비되지 않았습니다. 방금 연 탭에서 로그인이 필요한지 확인한 뒤 다시 [프로그램 적용] 을 눌러주세요.');
          await chrome.tabs.update(consultTab.id, { active: true });
          await chrome.windows.update(consultTab.windowId, { focused: true });
          return;
        }
      } catch (e) {
        clearTimeout(safetyTimer);
        btn.textContent = '📤 프로그램 적용';
        btn.disabled = false;
        showAlert('상담등록 페이지 자동 오픈 실패: ' + (e.message || e));
        return;
      }
    }
    // 데이터 적용 — 추출 데이터를 텍스트로 포맷해 상담등록 페이지 수신 함수로 전송
    const textData = formatAsText(extractedData);
    // 🆕 보장분석 데이터면 구조화(JSON) 그대로 전송 → 고객 DB 에 보장내역 저장
    //    (텍스트 왕복은 담보 매트릭스가 손실되므로 별도 수신 함수 사용)
    const _isCov = !!(extractedData && extractedData.type === 'coverage' &&
      ((Array.isArray(extractedData.productSummary) && extractedData.productSummary.length) ||
       (Array.isArray(extractedData.coverageDetails) && extractedData.coverageDetails.length)));
    const _covPayload = _isCov ? {
      type: 'coverage',
      name: extractedData.customerName || extractedData.name || extractedData['고객명'] ||
            (extractedData.basicInfo && (extractedData.basicInfo['이름'] || extractedData.basicInfo.name)) || '',
      phone: extractedData.phone || extractedData['연락처'] ||
            (extractedData.basicInfo && (extractedData.basicInfo['연락처'] || extractedData.basicInfo.phone)) || '',
      productSummary: extractedData.productSummary || [],
      coverageDetails: extractedData.coverageDetails || []
    } : null;
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: consultTab.id }, world: 'MAIN',
        args: [textData, _covPayload],
        func: (text, cov) => {
          // 보장분석 페이로드가 있으면 우선 처리
          if (cov && typeof window.__applyTossCoverageFromExtension === 'function') {
            try { window.__applyTossCoverageFromExtension(cov); return { ok: true, mode: 'coverage', location: location.href }; }
            catch (e) { return { ok: false, error: e.message, location: location.href }; }
          }
          if (typeof window.__applyTossDataFromExtension === 'function') {
            try { window.__applyTossDataFromExtension(text); return { ok: true, mode: 'text', location: location.href }; }
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
        // 탭을 활성화하는 순간 팝업이 닫히므로 토스트를 먼저 띄운다.
        showToast(r.result.mode === 'coverage' ? '🛡️ 보장분석을 고객 DB에 저장했습니다' : '✅ 상담등록 페이지에 적용 완료');
        await chrome.tabs.update(consultTab.id, { active: true });
        await chrome.windows.update(consultTab.windowId, { focused: true });
      } else {
        showAlert('상담등록 적용 실패: ' + (r?.result?.error || 'unknown') +
              '\n\n대상 탭: ' + (r?.result?.location || consultTab.url || '(알 수 없음)') +
              '\n\n· 그 탭에서 로그인이 되어 있는지 확인\n· Ctrl+Shift+R 로 새로고침 후 재시도');
      }
    } catch (e) {
      clearTimeout(safetyTimer);
      btn.textContent = '📤 프로그램 적용';
      btn.disabled = false;
      showAlert('상담등록 실행 실패: ' + (e.message || e));
    }
    return;
}

// 🆕 강제 라우팅 - 표준 보장분석
async function routeStandard(ctx) {
  const { btn, safetyTimer, allTabs, targetMode, isPremiumCompare, isCustomer, isCoverage } = ctx;
    console.log('[btnApply] 📤 라우팅: 표준 보장분석 (storage 중개)');
    const STD_DEFAULT_URL = 'https://tossinssu-pro.vercel.app/app.html';   // 표준분석 앱(receiver 가 있는 화면). '/' 는 로그인 페이지(index.html)라 적용 불가
    const textData = formatAsText(extractedData);
    // 🆕 적용 데이터를 storage 에 저장 → 앱 페이지의 content.js 가 앱(receiver) 준비되는 순간 자동 적용.
    //   (탭 열림/로그인/렌더 타이밍에 의존하지 않음 — 새로 열려도 준비되면 스스로 가져감)
    await new Promise(r => { try { chrome.storage.local.set({ __tossPendingApply: { text: textData, ts: Date.now() } }, r); } catch { r(); } });

    let programTab = findProgramTab(allTabs);
    if (!programTab) {
      const stored = await new Promise(r => { try { chrome.storage.local.get(['lastProgramUrl'], v => r(v?.lastProgramUrl || null)); } catch { r(null); } });
      // 🆕 stored 가 로그인/가설계/에디터 페이지면 무시 — 표준분석 receiver 가 없는 화면이라 적용이 안 됨
      const openUrl = (stored && !/(plan|editor|index)\.html/i.test(stored)) ? stored : STD_DEFAULT_URL;
      try { programTab = await chrome.tabs.create({ url: openUrl, active: true }); }
      catch (e) { clearTimeout(safetyTimer); btn.textContent = '📤 프로그램 적용'; btn.disabled = false; showAlert('탭 자동 오픈 실패: ' + (e.message || e)); return; }
    } else {
      try {
        await chrome.tabs.update(programTab.id, { active: true, highlighted: true });
        await chrome.windows.update(programTab.windowId, { focused: true, drawAttention: true });
      } catch {}
    }
    try { chrome.storage.local.set({ lastProgramUrl: programTab.url }); } catch {}
    clearTimeout(safetyTimer); btn.textContent = '📤 프로그램 적용'; btn.disabled = false;
    showToast('✅ 표준 보장분석으로 전송 — 앱이 준비되면 자동 입력됩니다');
    setTimeout(() => window.close(), 900);
    return;
}

// 🆕 강제 라우팅 - 가설계 탭 (사용자가 명시 선택 시)
async function routePlan(ctx) {
  const { btn, safetyTimer, allTabs, targetMode, isPremiumCompare, isCustomer, isCoverage } = ctx;
    let programTab = findProgramTab(allTabs);
    const planTab = allTabs.find(t => t.url && (
      /premium_plan\.html/i.test(t.url) ||
      /tossinssu-pro\.vercel\.app\/plan\.html/i.test(t.url)
    ));
    let target = planTab || programTab;
    // 🆕 보장분석 프로그램이 안 열려있으면 마지막 URL(또는 기본 URL)로 자동 오픈 + 로드 대기
    if (!target) {
      const stored = await new Promise(r => {
        try { chrome.storage.local.get(['lastProgramUrl'], v => r(v?.lastProgramUrl || null)); } catch { r(null); }
      });
      const openUrl = (stored && isProgramAppUrl(stored) && !/(editor|index)\.html/i.test(stored))
        ? stored
        : PLAN_APP_DEFAULT_URL;
      try {
        // active:false — 위 상담등록과 같은 이유. 새 탭에 포커스를 주면 팝업이 닫히면서
        // 아래의 "앱 준비 대기 → 적용" 이 실행되지 못한다. 적용 후 활성화한다.
        programTab = await chrome.tabs.create({ url: openUrl, active: false });
        target = programTab;
        // 페이지(앱) 준비 대기 (max 18초) — 새 탭이 열린 직후엔 receiver 가 없으므로 반드시 기다린다
        await new Promise(resolve => {
          let elapsed = 0;
          const tid = setInterval(async () => {
            elapsed += 500;
            try {
              const [r] = await chrome.scripting.executeScript({
                target: { tabId: programTab.id }, world: 'MAIN',
                func: () => typeof window.__applyTossDataFromExtension === 'function' || typeof window.__applyPremiumDataFromExtension === 'function' || document.querySelectorAll('button').length > 5
              });
              if (r && r.result) { clearInterval(tid); resolve(true); return; }
            } catch {}
            if (elapsed >= 18000) { clearInterval(tid); resolve(false); }
          }, 500);
        });
      } catch (e) {
        clearTimeout(safetyTimer); btn.textContent = '📤 프로그램 적용'; btn.disabled = false;
        showAlert('보장분석 프로그램 자동 오픈 실패: ' + (e.message || e));
        return;
      }
    }
    // 가설계 모드로 전환하고 iframe/수신 함수가 뜰 시간을 준다.
    if (!planTab && target) await _switchToPlanView(target);
    // premium_compare 데이터 전송 (있을 때만)
    if (isPremiumCompare) {
      // 데이터 검증
      const hasCompanies = Array.isArray(extractedData.companies) && extractedData.companies.length > 0;
      const hasCoverages = Array.isArray(extractedData.coverages) && extractedData.coverages.length > 0;
      console.log('[btnApply/plan] 데이터 확인 — companies:', extractedData.companies?.length, '/ coverages:', extractedData.coverages?.length);
      if (!hasCompanies && !hasCoverages) {
        clearTimeout(safetyTimer);
        btn.textContent = '📤 프로그램 적용';
        btn.disabled = false;
        showAlert('⚠️ 추출된 데이터가 비어 있습니다.\n\nmmlfcp 페이지에서 [조회하기] 버튼을 먼저 누르고 보험료가 표시된 상태에서 추출해주세요.');
        return;
      }
      const dataJson = JSON.stringify(extractedData);
      try {
        await chrome.tabs.update(target.id, { active: true });
        await chrome.windows.update(target.windowId, { focused: true });
        const applyResult = await _applyPremiumDataToPlan(target, dataJson, {
          switchPlan: !isPlanReceiverUrl(target.url),
          maxMs: 35000
        });
        if (applyResult.ok) {
          clearTimeout(safetyTimer);
          btn.textContent = '📤 프로그램 적용';
          btn.disabled = false;
          showToast('✅ 가설계 탭에 적용 완료');
          setTimeout(() => showAlert(`✅ 가설계 탭 적용 완료\n\n• 보험사: ${extractedData.companies?.length || 0}개\n• 담보: ${extractedData.coverages?.length || 0}개`), 100);
        } else {
          clearTimeout(safetyTimer);
          btn.textContent = '📤 프로그램 적용';
          btn.disabled = false;
          const tried = (applyResult.frameResults || []).map(r => r?.result?.location || '?').join('\n  · ');
          showAlert('가설계 탭 적용 실패\n\n원인: ' + (applyResult.error || '알 수 없음') + '\n\n시도한 프레임:\n  · ' + (tried || '(없음)') + '\n\n해결:\n① 보장분석 프로그램을 한 번 새로고침(Ctrl+Shift+R)\n② 보험사별 비교 → 가설계 탭이 노출된 상태인지 확인');
        }
      } catch (e) {
        clearTimeout(safetyTimer);
        btn.textContent = '📤 프로그램 적용';
        btn.disabled = false;
        console.error('[btnApply/plan] 실행 에러:', e);
        showAlert('실행 실패: ' + (e.message || e));
      }
    } else {
      // coverage/customer 데이터인 경우: 가설계 모드 전환만 + 안내
      if (programTab) await chrome.tabs.update(programTab.id, { active: true });
      clearTimeout(safetyTimer);
      btn.textContent = '📤 프로그램 적용';
      btn.disabled = false;
      showAlert('✅ 가설계 탭으로 전환됨\n\n현재 추출한 데이터(' + extractedData.type + ')는 가설계와 형식이 달라 자동 입력은 안 됩니다.\n보험료 비교 데이터를 추출해서 다시 적용해주세요.');
    }
    return;
}

async function routePremiumPage(ctx) {
  const { btn, safetyTimer, allTabs, targetMode, isPremiumCompare, isCustomer, isCoverage } = ctx;
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
          if (stored) showAlert('mmlfcp URL 형식이 아닙니다. 취소되었습니다.');
          return true;   // 처리 완료 — 호출부는 여기서 끝낸다
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
        showAlert('탭 자동 오픈 실패: ' + (e.message || e));
        return true;   // 처리 완료 — 호출부는 여기서 끝낸다
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
        const proceed = await showConfirm(
          '⚠️ 추출된 보험상품 중 선택된 게 없습니다.\n\n' +
          '📦 상단의 "보험상품 선택" 에서 상품을 선택하면\n' +
          '   그 상품의 담보+금액이 mmlfcp 에 자동 입력됩니다.\n\n' +
          '선택 없이 진행하면 폼 기본정보만 채워집니다.\n' +
          '계속할까요?',
          '보험상품 미선택'
        );
        if (!proceed) {
          clearTimeout(safetyTimer);
          btn.textContent = '📤 프로그램 적용';
          btn.disabled = false;
          return true;   // 처리 완료 — 호출부는 여기서 끝낸다
        }
      }
      if (!hasCustomerData && !hasCfgData && !hasProductData) {
        clearTimeout(safetyTimer);
        btn.textContent = '📤 프로그램 적용';
        btn.disabled = false;
        showAlert(
          '⚠️ 입력할 값이 하나도 없습니다.\n\n' +
          '· 보험상품 선택: 상단 📦 보험상품 선택에서 클릭\n' +
          '· 고객 정보: CRM 고객 페이지에서 데이터 추출 필요\n' +
          '· 설정값: 폼 기본 설정 패널에서 유형/만기 선택'
        );
        return true;   // 처리 완료 — 호출부는 여기서 끝낸다
      }
      if (!hasCustomerData) {
        console.warn('[btnApply] ⚠️ 고객 데이터 없음 — 그 외 값만 입력됩니다');
      }
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
            await injectContentScripts(activeTab.id, false);
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
            await injectContentScripts(activeTab.id, false);
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
          setTimeout(() => showAlert(
            '📋 보험료 비교 페이지에 자동 입력 완료\n\n' +
            (lines.join('\n') || '(채울 값 없음)') +
            '\n\n🔗 입력된 탭:\n' + (unifiedRes.location || activeTab.url || '')
          ), 100);
        } else {
          const err = unifiedRes?.error || '알 수 없음';
          const isConnErr = /Could not establish connection|Receiving end does not exist/i.test(err);
          showAlert(
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
        return true;   // 처리 완료 — 호출부는 여기서 끝낸다
      } catch (e) {
        clearTimeout(safetyTimer);
        btn.textContent = '📤 프로그램 적용';
        btn.disabled = false;
        showAlert('통합 적용 실패: ' + (e.message || e));
        return true;   // 처리 완료 — 호출부는 여기서 끝낸다
      }
    }
  return false;   // 대상 탭이 보험료 비교 페이지가 아니었다 — 호출부가 다음 라우트로 넘어간다
}

// 🆕 보험료 비교 데이터 → premium_plan.html 탭으로 우선 라우팅
async function routePremiumCompareToPlan(ctx) {
  const { btn, safetyTimer, allTabs, targetMode, isPremiumCompare, isCustomer, isCoverage } = ctx;
    const planTabs = allTabs.filter(t => t.url && (
      /premium_plan\.html/i.test(t.url) ||
      /tossinssu-pro\.vercel\.app\/plan\.html/i.test(t.url)
    ));
    const programTabs = allTabs.filter(t => t.url && (
      /toss_insu\d*_?\d*\.html/i.test(t.url) ||
      (/tossinssu-pro\.vercel\.app/i.test(t.url) && !/(plan|editor|index)\.html/i.test(t.url))
    ));
    let target = planTabs[0] || programTabs[0];
    if (!target) {
      const stored = await new Promise(r => {
        try { chrome.storage.local.get(['lastProgramUrl'], v => r(v?.lastProgramUrl || null)); } catch { r(null); }
      });
      const openUrl = (stored && isProgramAppUrl(stored) && !/(editor|index)\.html/i.test(stored))
        ? stored
        : PLAN_APP_DEFAULT_URL;
      try {
        target = await chrome.tabs.create({ url: openUrl, active: true });
        await _sleep(1500);
      } catch (e) {
        clearTimeout(safetyTimer);
        btn.textContent = '📤 프로그램 적용';
        btn.disabled = false;
        showAlert('보장분석 프로그램 자동 오픈 실패: ' + (e.message || e));
        return;
      }
    }
    const dataJson = JSON.stringify(extractedData);
    const applyResult = await _applyPremiumDataToPlan(target, dataJson, {
      switchPlan: !isPlanReceiverUrl(target.url),
      maxMs: 35000
    });
    if (applyResult.ok) {
      clearTimeout(safetyTimer);
      btn.textContent = '📤 프로그램 적용';
      btn.disabled = false;
      await chrome.tabs.update(target.id, { active: true });
      await chrome.windows.update(target.windowId, { focused: true });
      showToast('✅ 가설계 탭에 적용 완료!');
    } else {
      // 디버그 정보 — 어느 프레임이 시도되었는지
      clearTimeout(safetyTimer);
      btn.textContent = '📤 프로그램 적용';
      btn.disabled = false;
      const frameResults = applyResult.frameResults || [];
      const tried = frameResults.map(r => r?.result?.location || '(unknown)').join('\n  · ');
      const errMsg = applyResult.error || frameResults.map(r => r?.result?.error).filter(Boolean).join(' / ') || 'receiver 없음';
      showAlert(
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

document.getElementById('btnApply').addEventListener('click', async () => {
  console.log('[btnApply] click — extractedData:', extractedData);
  const btn = document.getElementById('btnApply');
  if (!extractedData) {
    console.warn('[btnApply] extractedData 없음 → 추출 먼저 실행');
    showAlert('먼저 "데이터 추출" 버튼을 눌러주세요.');
    return;
  }
  btn.textContent = '적용 중...';
  btn.disabled = true;

  // 🛡 안전망 — 60초 안에 응답 없으면 button 복구 (mmlfcp 입력은 폼+조회+담보 대기로 최대 25초+ 소요)
  const safetyTimer = setTimeout(() => {
    console.warn('[btnApply] 60초 타임아웃 — button 강제 복구');
    btn.textContent = '📤 프로그램 적용';
    btn.disabled = false;
    showAlert('적용 시간 초과 (60초).\n\n· 대상 페이지가 응답하지 않습니다\n· 페이지를 새로고침(Ctrl+Shift+R) 후 다시 시도');
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
    if (targetMode === 'auto') targetMode = await resolveAutoTarget({ isPremiumCompare, isCustomer });
    // 🆕 페인트 프로 / 부재고객[경고] — 선택 후 '프로그램 적용' 으로 실행 (다른 대상과 동일한 흐름)
    if (targetMode === 'paintpro') { await _execPaintProRoute(btn, safetyTimer); return; }
    if (targetMode === 'absence')  { await _execAbsenceRoute(btn, safetyTimer); return; }
    // 🛡 호환성 가드 — 데이터 type 과 맞지 않는 전송 대상이면 자동 보정 + 안내
    const guardedMode = await applyCompatGuard(targetMode, extractedData.type);
    if (guardedMode === null) {   // 사용자가 대상 변경을 거절 — 아무것도 하지 않고 종료
      btn.textContent = '📤 프로그램 적용';
      btn.disabled = false;
      clearTimeout(safetyTimer);
      return;
    }
    targetMode = guardedMode;
    const allTabs = await chrome.tabs.query({});
    console.log('[btnApply] 모든 탭:', allTabs.length, '개');
    // 라우트 함수에 넘길 공통 컨텍스트
    const ctx = { btn, safetyTimer, allTabs, targetMode, isPremiumCompare, isCustomer, isCoverage };


    if (targetMode === 'consult')  { await routeConsult(ctx);  return; }

    if (targetMode === 'standard') { await routeStandard(ctx); return; }

    if (targetMode === 'plan')     { await routePlan(ctx);     return; }

    // 자동 라우팅 보조 — 사용자가 mmlfcp 탭에 있고 auto 모드면 premium 으로 보냄
    const [_activeTab0] = await chrome.tabs.query({ active: true, currentWindow: true });
    const _userOnPremium = _activeTab0 && isPremiumComparePageUrl(_activeTab0.url);
    // 🎯 라우팅 규칙:
    //   · 'premium-page' (명시 선택 또는 auto 가 보험료 비교 페이지로 해석) → premium 라우팅
    //   · auto 는 위에서 이미 구체 모드(premium-page/consult/standard/plan)로 해석됨
    //   ※ premium_compare 데이터는 절대 premium 으로 보내지 않음 (mmlfcp→mmlfcp 방지)
    const _shouldRouteToPremium = (targetMode === 'premium-page') && !isPremiumCompare;
    console.log('[btnApply] 라우팅 결정:', { targetMode, _userOnPremium, isPremiumCompare, _shouldRouteToPremium });

    // 보험료 비교 폼으로 보냈으면 여기서 끝. 대상 탭이 비교 페이지가 아니면 아래로 흘러간다.
    if (_shouldRouteToPremium && await routePremiumPage(ctx)) return;
    // (위에서 보험료 비교 페이지면 자동 입력 후 return. 그 외 customer 는 기존 흐름)

    if (isPremiumCompare) { await routePremiumCompareToPlan(ctx); return; }

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
        showAlert('대상 프로그램이 열려있지 않습니다.\n\n다음 중 하나를 먼저 브라우저에서 열어주세요:\n• 보장분석 프로그램: https://tossinssu-pro.vercel.app\n• 보험료 비교: https://tossinssu-pro.vercel.app/plan.html');
        return;
      }
      console.log('[btnApply] 프로그램 탭 없음 — 마지막 URL 로 자동 오픈:', lastUrl);
      let newTab;
      try {
        newTab = await chrome.tabs.create({ url: lastUrl, active: true });
      } catch (e) {
        showAlert('탭 자동 오픈 실패: ' + (e.message || e) + '\n\n· file:// URL 권한이 필요합니다.\n· chrome://extensions → 토스인슈 CRM 데이터 추출기 → "파일 URL 액세스 허용" ON');
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
        showAlert('새 탭이 열렸으나 페이지가 응답하지 않습니다.\n\n· 파일 경로가 유효한지 확인\n· 페이지가 완전히 로드된 뒤 다시 적용을 시도해주세요');
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
        showAlert('❌ file:// URL 접근 권한이 필요합니다.\n\n1. chrome://extensions 열기\n2. 토스인슈 CRM 데이터 추출기의 "상세" 클릭\n3. "파일 URL에 대한 액세스 허용" 토글 활성화\n4. 확장프로그램 reload 후 다시 시도');
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
      showAlert(`자동 적용 실패: ${reason}\n\n프로그램이 최신 버전인지 확인하고 새로고침 후 다시 시도하세요.\n클립보드에 복사되어 있으니 Ctrl+V로 붙여넣을 수도 있습니다.`);
    }
  } catch (e) {
    console.error('[btnApply] Apply error:', e);
    showAlert('적용 실패: ' + (e.message || 'unknown'));
  } finally {
    clearTimeout(safetyTimer);   // safety timer 정리
    btn.textContent = '📤 프로그램 적용';
    btn.disabled = false;
    console.log('[btnApply] 완료 — button 복구');
  }
});

