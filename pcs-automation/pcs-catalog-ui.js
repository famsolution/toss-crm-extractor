// ──────────────────────────────────────────────────────────────────────────
// pcs-catalog-ui.js — popup "📅 상품 목록 기준일" 표시 + 수동 동기화
//   서비스워커(pcs-local-driver.js)의 매월 1일 자동 동기화 결과를 보여주고,
//   "🔄 지금 최신 확인" 으로 즉시 동기화를 트리거한다.
//   동기화 자체는 로그인된 CRM 탭 컨텍스트에서 실행되므로 send 화면과 동일한
//   카탈로그(상품 by-company API)를 본다.
// ──────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function renderStatus(catalog, pending) {
    const el = $('pcsCatalogStatus');
    if (!el) return;
    if (!catalog) {
      el.innerHTML = pending
        ? '⏳ 동기화 대기 중 — CRM 로그인 탭을 열면 자동 확인합니다.'
        : '아직 동기화 기록이 없습니다. <b>🔄 지금 최신 확인</b>을 눌러보세요.';
      el.style.color = '#94a3b8';
      return;
    }
    const insurers = catalog.insurers || {};
    const names = Object.keys(insurers);
    const okItems = names
      .filter(n => !insurers[n].error)
      .map(n => `${n} ${insurers[n].forSale ?? insurers[n].count}개`);
    const errItems = names.filter(n => insurers[n].error);
    el.innerHTML =
      `✅ 기준일 <b>${fmtDate(catalog.asOf)}</b>` +
      (okItems.length ? `<br>${okItems.join(' · ')}` : '') +
      (errItems.length ? `<br><span style="color:#d97706;">확인 실패: ${errItems.join(', ')}</span>` : '') +
      (pending ? '<br><span style="color:#d97706;">갱신 대기 중</span>' : '');
    el.style.color = '#64748b';
  }

  function loadStatus() {
    try {
      chrome.runtime.sendMessage({ action: 'pcsCatalogStatus' }, (res) => {
        if (chrome.runtime.lastError) { renderStatus(null, false); return; }
        if (res && res.ok) renderStatus(res.catalog, res.pending);
      });
    } catch (_) { renderStatus(null, false); }
  }

  async function onSyncNow() {
    const btn = $('pcsCatalogSyncBtn'), el = $('pcsCatalogStatus');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 확인 중…'; }
    if (el) { el.textContent = '동기화 중… (CRM 로그인 탭 필요)'; el.style.color = '#64748b'; }
    try {
      chrome.runtime.sendMessage({ action: 'pcsCatalogSyncNow' }, (res) => {
        if (btn) { btn.disabled = false; btn.textContent = '🔄 지금 최신 확인'; }
        if (chrome.runtime.lastError) {
          if (el) { el.textContent = '동기화 실패: ' + chrome.runtime.lastError.message; el.style.color = '#ef4444'; }
          return;
        }
        if (res && res.ok) renderStatus(res.snapshot, false);
        else if (res && res.pending) {
          if (el) { el.innerHTML = '⏳ CRM 로그인 탭을 먼저 열어주세요 — 탭이 열리면 자동으로 확인합니다.'; el.style.color = '#d97706'; }
        } else if (el) {
          el.textContent = '동기화 실패: ' + ((res && res.error) || '알 수 없음'); el.style.color = '#ef4444';
        }
      });
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 지금 최신 확인'; }
      if (el) { el.textContent = '동기화 실패: ' + (e && e.message || e); el.style.color = '#ef4444'; }
    }
  }

  function init() {
    const b = $('pcsCatalogSyncBtn'); if (b) b.addEventListener('click', onSyncNow);
    loadStatus();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
