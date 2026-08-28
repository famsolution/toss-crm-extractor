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

document.getElementById('btnCoverageExcel')?.addEventListener('click', async () => {
  await downloadCoverageExcelFromActiveTab(document.getElementById('btnCoverageExcel'));
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
// 🆕 전송 대상 '🎨 페인트 프로' 실행 — 프로그램 적용으로 통일 라우팅 (선택 후 📤 프로그램 적용)
async function _execPaintProRoute(btn, safetyTimer) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const _restore = () => { try { clearTimeout(safetyTimer); } catch {} if (btn) { btn.textContent = '📤 프로그램 적용'; btn.disabled = false; } };
  if (!tab) { _restore(); return; }
  let hasAnchor = false;
  try {
    const r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => !!document.getElementById('__paintpro_send') });
    hasAnchor = !!(r && r[0] && r[0].result);
  } catch {}
  if (!hasAnchor) { alert('토스 보장분석 페이지에서 실행해 주세요.'); _restore(); return; }
  // 🔑 popup 을 닫아 페이지 focus 복귀 → content.js 가 clipboard.read() 실행 가능
  try { chrome.tabs.sendMessage(tab.id, { action: 'triggerPaintPro' }, () => { void chrome.runtime.lastError; }); } catch {}
  try { clearTimeout(safetyTimer); } catch {}
  setTimeout(() => window.close(), 120);
}

// 🆕 전송 대상 '부재고객[경고]' 실행 — 추출 데이터를 스튜디오로 전송
async function _execAbsenceRoute(btn, safetyTimer) {
  const _restore = () => { try { clearTimeout(safetyTimer); } catch {} if (btn) { btn.textContent = '프로그램 적용'; btn.disabled = false; } };
  const data = extractedData;
  if (!data) { alert('먼저 데이터 추출 버튼을 눌러 데이터를 추출해 주세요.'); _restore(); return; }
  _openAbsenceStudio(data);
  _restore();
}

