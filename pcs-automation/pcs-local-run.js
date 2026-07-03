// ──────────────────────────────────────────────────────────────────────────
// pcs-local-run.js — popup "🤖 로컬 자동 진행" 트리거
//   Claude 없이 확장 자체로 금소법 확인서 전송 화면을 자동 진행한다.
//   ① 고객 수집(CRM 상세 페이지) ② 상품 매칭(카탈로그 API)
//   ③ 백그라운드 드라이버(pcs-local-driver)에 위임 → Flutter 화면 자동 진행
//   ⛔ 서명&완료(고객 발송)는 자동으로 누르지 않음 — 사람이 최종 확인.
// ──────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function setMsg(m, c) { const e = $('pcsLocalMsg'); if (e) { e.innerHTML = m || ''; e.style.color = c || '#64748B'; } }

  // 고객 수집 — pcs-geumso 의 gatherInPage 와 동일 로직 (CRM 탭 안에서 실행)
  async function gatherCustomer() {
    const tabs = await chrome.tabs.query({ url: 'https://crm.tossinsu.com/crm-v2/customers/*' });
    const tab = tabs.find(t => /\/customers\/\d+/.test(t.url)) || tabs[0];
    if (!tab) throw new Error('CRM 고객 상세 페이지 탭을 먼저 열어주세요.');
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async function () {
        const m = location.pathname.match(/\/customers\/(\d+)/);
        if (!m) return { error: '고객 상세 페이지가 아닙니다.' };
        const id = m[1];
        const txt = document.body.innerText || '';
        const name = (document.title.match(/상세\s*:\s*([가-힣]{2,5})/) || [])[1]
          || (txt.match(/고객명\s*([가-힣]{2,5})/) || [])[1] || '';
        const birth = (txt.match(/생년월일\s*(\d{4}-\d{2}-\d{2})/) || [])[1]
          || (document.body.innerHTML.match(/(19|20)\d{2}-\d{2}-\d{2}/) || [])[0] || '';
        let phone = '';
        try {
          const r = await fetch(`/api/customer/v2/${id}/phone`, { credentials: 'include', headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
          if (r.ok) { const j = await r.json(); phone = (j && j.success && j.success.phoneNumber) || (typeof j?.success === 'string' ? j.success : '') || ''; }
        } catch (_) {}
        return { customerId: id, 고객명: name, 연락처: phone, 생년월일: birth };
      },
    });
    if (!result || result.error) throw new Error((result && result.error) || '고객 수집 실패');
    if (!result.고객명 || !result.연락처) throw new Error('고객명/연락처 수집 누락 — 고객 상세 페이지를 확인하세요.');
    return result;
  }

  // 상품 검색어 도출 — procNm 에서 식별력 있는 한글 덩어리 (브랜드/(무) 제외)
  function deriveSearchTerm(procNm, inscoNm) {
    let s = String(procNm || '').replace(/\(무\)|무배당/g, ' ');
    const brand = String(inscoNm || '').replace(/(화재|해상|생명|손해보험|손보)$/, '');
    if (brand) s = s.split(brand).join(' ');
    const m = s.match(/[가-힣]{4,}/);
    return (m && m[0].slice(0, 10)) || String(procNm || '').slice(0, 10);
  }

  async function onRun() {
    const btn = $('pcsLocalBtn');
    try {
      btn.disabled = true; btn.textContent = '⏳ 진행 중…';

      // 입력 확보 — 보험사/상품명 (비어 있으면 제안서 텍스트에서 자동 추출)
      let company = ($('pcsCompany') && $('pcsCompany').value || '').trim();
      let productName = ($('pcsProductName') && $('pcsProductName').value || '').trim();
      if ((!company || !productName) && $('pcsProposalText') && $('pcsProposalText').value.trim() && window.ProposalParser) {
        const p = window.ProposalParser.parseProposalText($('pcsProposalText').value);
        company = company || p.보험사 || '';
        productName = productName || p.상품명 || '';
        if ($('pcsCompany')) $('pcsCompany').value = company;
        if ($('pcsProductName')) $('pcsProductName').value = productName;
      }
      if (!company || !productName) throw new Error('보험사·상품명이 필요합니다 — 제안서 텍스트를 붙여넣고 [📑 텍스트에서 추출] 하거나 직접 입력하세요.');

      setMsg('① 고객 데이터 수집 중…');
      const customer = await gatherCustomer();

      setMsg('② 상품 카탈로그 매칭 중…');
      if (!window.PCSProductMatcher) throw new Error('매칭 모듈 로드 실패');
      const m = await window.PCSProductMatcher.matchProduct(company, productName);
      if (!m.best) throw new Error('매칭 후보가 없습니다.');
      // 매칭에 쓴 보험사를 월간 동기화 추적 목록에 누적
      try { chrome.runtime.sendMessage({ action: 'pcsTrackInsurer', company: (m.company && m.company.inscoNm) || company }, () => void chrome.runtime.lastError); } catch (_) {}
      if (m.confidenceGap !== null && m.confidenceGap < 0.05) {
        const list = m.candidates.slice(0, 3).map((c, i) => `${i + 1}. (${c.score}) ${c.procNm}`).join('\n');
        if (!confirm(`⚠️ 매칭 확신도가 낮습니다 (격차 ${m.confidenceGap}).\n1순위로 진행할까요?\n\n${list}`)) {
          setMsg('사용자 취소 — 상품명을 더 정확히 입력 후 재시도하세요.', '#d97706'); return;
        }
      }

      const payload = {
        customer,
        company: m.company,
        best: m.best,
        searchTerm: deriveSearchTerm(m.best.procNm, m.company.inscoNm),
        category: ($('pcsLocalCat') && $('pcsLocalCat').value) || '장기',
      };
      setMsg(`③ 자동 진행 시작 — <b>${customer.고객명}</b> / ${m.company.inscoNm}<br>` +
        `상품: ${m.best.procNm.slice(0, 50)}…<br>` +
        `<span style="color:#4338ca;">CRM 탭 좌상단 진행 패널을 확인하세요. ⛔ 발송은 직접 확인 후!</span>`, '#16a34a');

      // 백그라운드 드라이버에 위임 — 팝업이 닫혀도 계속 진행됨
      chrome.runtime.sendMessage({ action: 'pcsLocalRun', payload }, (res) => {
        if (chrome.runtime.lastError) return;   // 팝업이 닫히면 응답 못 받음 — 정상
        if (res && res.ok) setMsg('✅ 자동 진행 완료 — 서명&완료 직전 정지. CRM 탭에서 확인 후 직접 발송하세요.', '#16a34a');
        else if (res) setMsg('❌ 실패: ' + (res.error || '') + '<br>CRM 탭의 오류 패널을 확인하세요.', '#ef4444');
      });
    } catch (e) {
      setMsg('❌ ' + (e && e.message || e), '#ef4444');
    } finally {
      btn.disabled = false; btn.textContent = '🤖 로컬 자동 진행 (Claude 불필요)';
    }
  }

  function init() { const b = $('pcsLocalBtn'); if (b) b.addEventListener('click', onRun); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
