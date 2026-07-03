// ──────────────────────────────────────────────────────────────────────────
// pcs-ui.js — popup "📄 확인서" 탭 로직
//   제안서 텍스트 파싱(ProposalParser) + 상품 매칭(PCSProductMatcher) 연결.
//   매칭 API 호출은 확장의 host_permissions(crm.tossinsu.com) + 로그인 쿠키로 수행.
// ──────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function setStatus(msg, color) {
    const el = $('pcsStatus');
    if (el) { el.textContent = msg || ''; el.style.color = color || '#64748B'; }
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); setStatus('복사됨: ' + t, '#16a34a'); }
    catch { setStatus('복사 실패', '#ef4444'); }
  }

  // ── 텍스트에서 보험사/상품명 추출 ──
  //   silent=true 면 빈 입력에 에러를 띄우지 않음(자동 추출용)
  function onParse(silent) {
    const text = ($('pcsProposalText').value || '').trim();
    if (!text) { if (!silent) setStatus('제안서 텍스트를 붙여넣으세요.', '#ef4444'); return; }
    if (!window.ProposalParser) { setStatus('파서 모듈 로드 실패', '#ef4444'); return; }
    const p = window.ProposalParser.parseProposalText(text);
    if (p.보험사) $('pcsCompany').value = p.보험사;
    if (p.상품명) $('pcsProductName').value = p.상품명;
    const bits = [];
    if (p.고객명) bits.push('고객 ' + p.고객명);
    if (p.보험료) bits.push('보험료 ' + p.보험료.toLocaleString() + '원');
    if (p.가계약번호) bits.push('가계약 ' + p.가계약번호);
    setStatus('추출 완료 · ' + (bits.join(' · ') || '보험사/상품명'), '#2563EB');
  }

  // 매칭에 쓴 보험사를 월간 동기화 추적 목록에 누적 (실패해도 무시)
  function trackInsurer(company) {
    if (!company) return;
    try { chrome.runtime.sendMessage({ action: 'pcsTrackInsurer', company }, () => void chrome.runtime.lastError); } catch (_) {}
  }

  // ── 카드 렌더 ──
  function renderCandidates(res) {
    const box = $('pcsResult');
    box.innerHTML = '';
    if (!res.best) { setStatus('일치 후보가 없습니다.', '#ef4444'); return; }

    const gap = res.confidenceGap;
    const trust = gap == null ? '' : (gap >= 0.05
      ? `<span style="color:#16a34a;font-weight:700;">신뢰 높음 (격차 ${gap})</span>`
      : `<span style="color:#d97706;font-weight:700;">확인 권장 (격차 ${gap})</span>`);
    setStatus(`${res.company.inscoNm} · ${res.totalScanned}개 중 매칭 · ${trust ? '' : ''}`, '#2563EB');

    // 🆕 1순위 상품명 복사 영역 표시
    const topCopyBox = $('pcsTopProductCopy'), topText = $('pcsTopProductText');
    if (topCopyBox && topText && res.best) {
      topText.value = res.best.procNm;
      topCopyBox.style.display = 'flex';
      const btn = $('pcsTopProductBtn');
      if (btn) btn.onclick = () => copyText(res.best.procNm);
    }

    res.candidates.forEach((c, i) => {
      const top = i === 0;
      const card = document.createElement('div');
      card.style.cssText = `border:1.5px solid ${top ? '#6366f1' : '#e2e8f0'};border-radius:8px;padding:8px 10px;background:${top ? '#eef2ff' : '#fff'};`;
      card.innerHTML =
        `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
           <span style="font-size:10.5px;font-weight:700;color:${top ? '#4338ca' : '#64748b'};">${top ? '1순위 ✅' : (i + 1) + '순위'} · 점수 ${c.score}</span>
           <button data-cd="${escapeHtml(c.productCd)}" class="pcsCopyCd" style="font-size:10px;border:1px solid #c7d2fe;background:#fff;border-radius:5px;padding:2px 6px;cursor:pointer;">코드 복사</button>
         </div>
         <div style="font-size:11.5px;color:#1e293b;margin-top:4px;line-height:1.4;">${escapeHtml(c.procNm)}</div>
         <div style="font-size:10px;color:#94a3b8;margin-top:3px;">productCd: ${escapeHtml(c.productCd)}${c.isForSale ? '' : ' · <span style="color:#ef4444;">판매중지</span>'}</div>`;
      box.appendChild(card);
    });
    box.querySelectorAll('.pcsCopyCd').forEach(b =>
      b.addEventListener('click', () => copyText(b.dataset.cd)));
    if (top0Trust(gap) === false) {
      const note = document.createElement('div');
      note.style.cssText = 'font-size:10.5px;color:#d97706;';
      note.textContent = '⚠️ 1·2순위 점수가 비슷합니다. 상품명을 직접 확인하세요.';
      box.appendChild(note);
    }
  }
  function top0Trust(gap) { return gap == null ? null : gap >= 0.05; }

  // ── 매칭 실행 ──
  //   API 호출은 반드시 crm.tossinsu.com 탭 컨텍스트에서 수행해야 세션 쿠키가
  //   실린다(popup 직접 fetch는 SameSite 로 쿠키 누락 위험). 따라서 열려 있는
  //   CRM 탭에 매처 모듈을 주입하고 그 안에서 matchProduct 를 실행한다.
  async function onMatch() {
    const company = ($('pcsCompany').value || '').trim();
    const product = ($('pcsProductName').value || '').trim();
    if (!company || !product) { setStatus('보험사와 상품명을 입력하세요.', '#ef4444'); return; }
    setStatus('매칭 중… (CRM 로그인 탭 필요)', '#64748B');
    $('pcsResult').innerHTML = '';
    try {
      const tabs = await chrome.tabs.query({ url: 'https://crm.tossinsu.com/*' });
      if (!tabs.length) {
        setStatus('crm.tossinsu.com 탭을 먼저 열어 로그인하세요.', '#ef4444');
        return;
      }
      const tabId = tabs[0].id;
      // 1) 매처 모듈을 탭에 주입
      await chrome.scripting.executeScript({ target: { tabId }, files: ['pcs-automation/pcs-product-matcher.js'] });
      // 2) 탭 컨텍스트에서 매칭 실행(쿠키 동봉 동일출처 fetch)
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (c, p) => window.PCSProductMatcher.matchProduct(c, p, { onlyForSale: true, topN: 5 }),
        args: [company, product],
      });
      if (!result) { setStatus('매칭 결과 없음 (로그인 상태 확인)', '#ef4444'); return; }
      renderCandidates(result);
      trackInsurer(result.company && result.company.inscoNm || company);
    } catch (e) {
      setStatus('매칭 실패: ' + (e && e.message ? e.message : e), '#ef4444');
    }
  }

  function init() {
    const pb = $('pcsParseBtn'), mb = $('pcsMatchBtn'), ta = $('pcsProposalText');
    if (pb) pb.addEventListener('click', () => onParse(false));
    if (mb) mb.addEventListener('click', onMatch);
    // 제안서 텍스트를 붙여넣으면 버튼 없이도 자동으로 보험사/상품명 추출
    if (ta) ta.addEventListener('paste', () => setTimeout(() => onParse(true), 0));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
