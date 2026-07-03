// ──────────────────────────────────────────────────────────────────────────
// pcs-geumso.js — popup "🛡️ 금소법" 버튼 로직
//   토스 CRM 고객 상세 페이지에서 금소법 확인서에 필요한 고객 데이터를
//   "페이지 기준"으로 수집한다.
//     · 고객명 / 생년월일 : 페이지 DOM
//     · 연락처(전체)       : 화면은 마스킹(010-****-XXXX)이므로
//                            GET /api/customer/v2/{id}/phone 로 복원
//   수집 결과는 (1) 팝업에 카드로 표시하고, (2) CRM 탭의 window.__tossPcsCustomer
//   에 심어 Claude(Chrome 연동)가 복사 없이 바로 읽어 진행하도록 한다.
//
//   ※ 확인서(Flutter) 단계 진행과 제안서 PDF 분석은 확장이 직접 못 하므로
//     Claude 가 이 데이터 + PDF 로 전송 단계까지 자동 진행한다.
// ──────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function setMsg(m, c) { const e = $('pcsGsMsg'); if (e) { e.textContent = m || ''; e.style.color = c || '#64748B'; } }

  // CRM 탭 안에서 실행될 함수 (closure 불가 — 자기완결적이어야 함)
  async function gatherInPage() {
    const m = location.pathname.match(/\/customers\/(\d+)/);
    if (!m) return { error: '고객 상세 페이지(/customers/{id})가 아닙니다.' };
    const id = m[1];
    const txt = document.body.innerText || '';
    const name = (document.title.match(/상세\s*:\s*([가-힣]{2,5})/) || [])[1]
      || (txt.match(/고객명\s*([가-힣]{2,5})/) || [])[1] || '';
    const birth = (txt.match(/생년월일\s*(\d{4}-\d{2}-\d{2})/) || [])[1]
      || (document.body.innerHTML.match(/(19|20)\d{2}-\d{2}-\d{2}/) || [])[0] || '';
    let phone = '';
    try {
      const r = await fetch(`/api/customer/v2/${id}/phone`, {
        credentials: 'include',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (r.ok) {
        const j = await r.json();
        phone = (j && j.success && j.success.phoneNumber) || (typeof j?.success === 'string' ? j.success : '') || '';
      }
    } catch (_) {}
    const pkg = { customerId: id, 고객명: name, 연락처: phone, 생년월일: birth, url: location.href, at: Date.now() };
    try { window.__tossPcsCustomer = pkg; } catch (_) {}
    return pkg;
  }

  function render(p) {
    const box = $('pcsGsCard');
    if (!box) return;
    if (p.error) { box.innerHTML = ''; setMsg(p.error, '#ef4444'); return; }
    const row = (k, v, ok) => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;">
        <span style="color:#64748b;">${k}</span>
        <span style="font-weight:600;color:${ok ? '#0f172a' : '#ef4444'};">${v || '— 없음'}</span></div>`;
    box.innerHTML =
      `<div style="border:1.5px solid #6366f1;border-radius:8px;padding:10px 12px;background:#eef2ff;">
         ${row('고객명', p.고객명, !!p.고객명)}
         ${row('연락처', p.연락처, !!p.연락처)}
         ${row('생년월일', p.생년월일, !!p.생년월일)}
         <div style="font-size:10px;color:#94a3b8;margin-top:4px;">고객ID ${p.customerId}</div>
       </div>
       <div style="font-size:11px;color:#4338ca;margin-top:8px;line-height:1.5;background:#fff;border:1px solid #c7d2fe;border-radius:6px;padding:8px 10px;">
         ✅ 고객 데이터 준비 완료. 제안서 텍스트를 아래 칸에 붙여넣고 <b>🤖 로컬 자동 진행</b>을 누르면<br>
         Claude 없이 확장이 직접 전송 단계까지 진행합니다(<b>발송 직전 정지</b>, 사람이 확인 후 발송).<br>
         <span style="color:#94a3b8;">(보조: 제안서 PDF를 Claude 창에 올리고 "금소법 진행" 방식도 계속 사용 가능)</span>
       </div>`;
    const ok = p.고객명 && p.연락처 && p.생년월일;
    setMsg(ok ? '수집 완료' : '일부 항목 누락 — 페이지를 확인하세요.', ok ? '#16a34a' : '#d97706');
  }

  async function onStart() {
    setMsg('고객 데이터 수집 중…', '#64748B');
    if ($('pcsGsCard')) $('pcsGsCard').innerHTML = '';
    try {
      const tabs = await chrome.tabs.query({ url: 'https://crm.tossinsu.com/crm-v2/customers/*' });
      // 상세 페이지(/customers/{id}) 탭 우선
      const tab = tabs.find(t => /\/customers\/\d+/.test(t.url)) || tabs[0];
      if (!tab) { setMsg('CRM 고객 상세 페이지 탭을 먼저 열어주세요.', '#ef4444'); return; }
      const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: gatherInPage });
      render(result || { error: '수집 실패' });
    } catch (e) {
      setMsg('실패: ' + (e && e.message ? e.message : e), '#ef4444');
    }
  }

  function setDropMsg(m, c) { const e = $('pcsDropMsg'); if (e) { e.textContent = m || ''; e.style.color = c || '#64748B'; } }

  // CRM 탭 안에서 실행 — 제안서 base64 를 window 에 심는다 (Claude 가 읽어 분석)
  function stashProposalInPage(filename, base64) {
    window.__tossPcsProposal = { filename: filename, base64: base64, at: Date.now() };
    return { ok: true, size: base64.length };
  }

  async function handleProposalFile(file) {
    if (!file) return;
    if (!/pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setDropMsg('PDF 파일만 가능합니다.', '#ef4444'); return;
    }
    setDropMsg(`'${file.name}' 읽는 중…`, '#64748B');
    const base64 = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1] || '');
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
    // 1) Claude 경로용 — CRM 탭에 base64 stash (있으면)
    try {
      const tabs = await chrome.tabs.query({ url: 'https://crm.tossinsu.com/crm-v2/customers/*' });
      const tab = tabs.find(t => /\/customers\/\d+/.test(t.url)) || tabs[0];
      if (tab) await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: stashProposalInPage, args: [file.name, base64] });
    } catch (_) {}

    // 2) 🆕 로컬 경로 — pdf.js 로 직접 텍스트 추출 → 보험사/상품명 자동 채움
    try {
      if (!window.PCSPdf) throw new Error('PDF 모듈 미로드');
      setDropMsg(`'${file.name}' 로컬 분석 중…`, '#64748B');
      const text = await window.PCSPdf.extractText(base64, 2);
      const ta = document.getElementById('pcsProposalText');
      if (ta) ta.value = text;
      let info = {};
      if (window.ProposalParser) {
        info = window.ProposalParser.parseProposalText(text, { filename: file.name });
        const cEl = document.getElementById('pcsCompany'), pEl = document.getElementById('pcsProductName');
        if (cEl && info.보험사) cEl.value = info.보험사;
        if (pEl && info.상품명) pEl.value = info.상품명;
      }
      const okFields = info.보험사 && info.상품명;
      setDropMsg(
        `✅ '${file.name}' 로컬 분석 완료 — ${info.보험사 || '보험사?'} / ${(info.상품명 || '상품명?').slice(0, 28)}…`
        + (okFields ? ' · 🤖 로컬 자동 진행 가능' : ' · ⚠️ 보험사/상품명 칸을 확인·보정하세요'),
        okFields ? '#16a34a' : '#d97706'
      );
    } catch (e) {
      setDropMsg('로컬 분석 실패: ' + (e && e.message ? e.message : e) + ' — 보험사/상품명을 직접 입력하세요.', '#ef4444');
    }
  }

  function setupDrop() {
    const zone = $('pcsDrop'), input = $('pcsDropInput');
    if (!zone) return;
    zone.addEventListener('click', () => input && input.click());
    if (input) input.addEventListener('change', () => handleProposalFile(input.files && input.files[0]));
    ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation(); zone.style.background = '#eef2ff'; zone.style.borderColor = '#6366f1';
    }));
    ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation(); zone.style.background = '#fff'; zone.style.borderColor = '#a5b4fc';
    }));
    zone.addEventListener('drop', e => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      handleProposalFile(f);
    });
  }

  function init() {
    const b = $('pcsGsBtn'); if (b) b.addEventListener('click', onStart);
    setupDrop();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
