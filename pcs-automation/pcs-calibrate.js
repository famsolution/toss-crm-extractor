// ──────────────────────────────────────────────────────────────────────────
// pcs-calibrate.js — popup "📐 좌표 보정 모드" (가르치기 + 진행 + 단계 내보내기/불러오기)
//   이 토스 Flutter 빌드는 의미(접근성) 트리를 켤 수 없어 라벨 기반 자동화가
//   불가능하다. 대신 send 화면의 각 위치를 좌표로 등록(flutter-view 크기 대비
//   비율)하고, 그 좌표로 신뢰 클릭/타이핑한다.
//
//   단계 정의는 pcs-steps.js(PCSSteps.DEFAULT_STEPS) 가 단일 소스이며,
//   사용자가 .json 으로 내보내/고쳐/불러올 수 있다(chrome.storage.local.pcsSteps).
// ──────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function setMsg(m, c) { const e = $('pcsCalibMsg'); if (e) { e.innerHTML = m || ''; e.style.color = c || '#64748B'; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // 매칭된 상품을 카드로 표시 (어떤 상품과 매칭됐는지 눈으로 확인)
  function renderMatched(prep) {
    const box = $('pcsMatchedInfo');
    if (!box || !prep || !prep.best) return;
    const gap = prep.confidenceGap;
    const trust = gap == null ? ''
      : (gap >= 0.05 ? `<span style="color:#16a34a;font-weight:700;">신뢰 높음(격차 ${gap})</span>`
        : `<span style="color:#d97706;font-weight:700;">⚠️ 확인 권장(격차 ${gap})</span>`);
    const runnerUp = (prep.candidates && prep.candidates[1]) ? prep.candidates[1] : null;
    const retag = prep.retried ? '<span style="background:#fef3c7;color:#92400e;font-weight:700;border-radius:4px;padding:0 4px;margin-left:4px;">🔁 재매칭됨</span>' : '';
    box.style.display = 'block';
    box.innerHTML =
      `<div style="font-weight:800;color:#4338ca;margin-bottom:3px;">✅ 매칭된 상품 · ${esc((prep.company && prep.company.inscoNm) || '')} ${trust}${retag}</div>` +
      `<div style="color:#1e293b;font-weight:600;">${esc(prep.best.procNm)}</div>` +
      `<div style="color:#64748b;font-size:10px;margin-top:2px;">코드 ${esc(prep.best.productCd)} · 점수 ${prep.best.score != null ? prep.best.score : '-'}</div>` +
      (runnerUp ? `<div style="color:#94a3b8;font-size:10px;margin-top:3px;border-top:1px dashed #c7d2fe;padding-top:3px;">2순위(${runnerUp.score}): ${esc(String(runnerUp.procNm).slice(0, 60))}…</div>` : '');
  }

  // 현재 단계 정의 (사용자 커스텀 우선, 없으면 기본)
  function getSteps() {
    return new Promise((res) => {
      chrome.storage.local.get(['pcsSteps'], (g) => {
        const s = g.pcsSteps;
        res((window.PCSSteps && window.PCSSteps.validateSteps(s)) ? s : (window.PCSSteps ? window.PCSSteps.DEFAULT_STEPS : []));
      });
    });
  }

  // ── send 탭에 주입될 레코더(자기완결적). 모든 프레임에 주입되며, flutter-view가
  //    있는 프레임에서 클릭을 잡아 비율 좌표를 기록한다. 오버레이는 최상위 프레임에만. ──
  function recorderInPage(SEQ_JSON) {
    const SEQ = JSON.parse(SEQ_JSON);
    const isTop = (window.top === window.self);
    const fvHere = () => document.querySelector('flutter-view, flt-glass-pane');

    function paintOverlay() {
      if (!isTop) return;
      chrome.storage.local.get(['pcsCalibActive', 'pcsCalibIndex', 'pcsCalibArmed'], (g) => {
        let el = document.getElementById('__pcs_calib_overlay');
        if (!g.pcsCalibActive) { if (el) el.remove(); return; }
        if (!el) {
          el = document.createElement('div');
          el.id = '__pcs_calib_overlay';
          el.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#4338ca;color:#fff;font:13px/1.5 -apple-system,sans-serif;padding:12px 16px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.4);max-width:560px;text-align:center;';
          document.body.appendChild(el);
        }
        const i = g.pcsCalibIndex || 0;
        if (i >= SEQ.length) {
          el.innerHTML = '✅ <b>좌표 가르치기 완료!</b> 이제 팝업에서 <b>▶️ 좌표 모드로 진행</b>을 쓰면 됩니다. <span id="__pcs_calib_x" style="cursor:pointer;text-decoration:underline;">닫기</span>';
        } else {
          const t = SEQ[i];
          const armBtn = g.pcsCalibArmed
            ? `<span style="background:#16a34a;padding:3px 8px;border-radius:6px;font-weight:700;">📍 지금 그 칸을 클릭하세요</span>`
            : `<span id="__pcs_calib_arm" style="background:#f59e0b;color:#111;padding:3px 8px;border-radius:6px;font-weight:700;cursor:pointer;">📍 기록 시작</span>`;
          el.innerHTML =
            `📐 <b>좌표 가르치기 ${i + 1}/${SEQ.length}</b> — <b style="color:#fde047;">${t.label}</b><br>` +
            `${armBtn}<br>` +
            `<span style="font-size:11px;opacity:.9;">화면 이동(다음 버튼 등)은 먼저 마치고, 위 <b>기록 시작</b>을 누른 뒤 해당 칸을 클릭하세요. ` +
            `검색칸은 클릭 후 이름을 입력해 결과가 뜨면 그 결과를 기록 대상으로 클릭. ` +
            `<span id="__pcs_calib_back" style="cursor:pointer;text-decoration:underline;">한 단계 뒤로</span> · ` +
            `<span id="__pcs_calib_x" style="cursor:pointer;text-decoration:underline;">취소</span></span>`;
        }
        const ab = document.getElementById('__pcs_calib_arm');
        if (ab) ab.onclick = () => chrome.storage.local.set({ pcsCalibArmed: true });
        const xb = document.getElementById('__pcs_calib_x');
        if (xb) xb.onclick = () => chrome.storage.local.set({ pcsCalibActive: false, pcsCalibArmed: false });
        const bb = document.getElementById('__pcs_calib_back');
        if (bb) bb.onclick = () => chrome.storage.local.get(['pcsCalibIndex'], (s) =>
          chrome.storage.local.set({ pcsCalibIndex: Math.max(0, (s.pcsCalibIndex || 0) - 1), pcsCalibArmed: false }));
      });
    }

    function onDown(ev) {
      const fv = fvHere();
      if (!fv) return;
      chrome.storage.local.get(['pcsCalibActive', 'pcsCalibArmed', 'pcsCalibIndex', 'pcsCalibration'], (g) => {
        if (!g.pcsCalibActive || !g.pcsCalibArmed) return;   // 무장 상태에서의 클릭만 기록
        const i = g.pcsCalibIndex || 0;
        if (i >= SEQ.length) return;
        const r = fv.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        const xf = (ev.clientX - r.left) / r.width;
        const yf = (ev.clientY - r.top) / r.height;
        if (xf < 0 || xf > 1 || yf < 0 || yf > 1) return;   // flutter-view 밖 클릭 무시
        const cal = g.pcsCalibration || { targets: {} };
        cal.targets = cal.targets || {};
        cal.targets[SEQ[i].key] = { xf: +xf.toFixed(4), yf: +yf.toFixed(4) };
        cal.at = new Date().toISOString();
        const next = i + 1;
        const done = next >= SEQ.length;
        chrome.storage.local.set({
          pcsCalibration: cal,
          pcsCalibIndex: next,
          pcsCalibArmed: false,
          pcsCalibActive: done ? false : true,
          pcsCalibDone: done ? true : (g.pcsCalibDone || false),
        });
      });
      // preventDefault 안 함 → 실제 클릭이 그대로 전달됨
    }

    if (!window.__pcsCalibHooked) {
      window.__pcsCalibHooked = true;
      document.addEventListener('pointerdown', onDown, true);
      if (isTop) {
        chrome.storage.onChanged.addListener((ch, area) => {
          if (area === 'local' && (ch.pcsCalibActive || ch.pcsCalibIndex || ch.pcsCalibArmed)) paintOverlay();
        });
        paintOverlay();
      }
    }
    return { ok: true, frame: isTop ? 'top' : 'child', hasFv: !!fvHere() };
  }

  async function findSendTab() {
    const tabs = await chrome.tabs.query({ url: 'https://crm.tossinsu.com/*' });
    return tabs.find(t => /\/pcs-documents\/send/.test(t.url || '')) || null;
  }

  // ── 가르치기 시작 ──
  async function onTeach() {
    setMsg('send 화면 탭을 찾는 중…');
    const tab = await findSendTab();
    if (!tab) { setMsg('확인서 전송(/pcs-documents/send) 화면을 먼저 연 뒤 다시 누르세요.', '#ef4444'); return; }
    const steps = await getSteps();
    // 좌표가 필요한 단계(click)만 가르친다 — 나머지는 키보드로 자동 진행
    const SEQ = steps.filter(s => s.action === 'click').map(s => ({ key: s.id, label: s.label || s.id }));
    if (!SEQ.length) { setMsg('이 단계 정의에는 좌표 클릭이 없어 가르칠 게 없습니다.', '#d97706'); return; }
    await chrome.storage.local.set({ pcsCalibActive: true, pcsCalibIndex: 0, pcsCalibArmed: false, pcsCalibration: { targets: {} }, pcsCalibDone: false });
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: recorderInPage,
        args: [JSON.stringify(SEQ)],
      });
      await chrome.tabs.update(tab.id, { active: true });
      setMsg(`✅ send 화면 상단의 보라색 안내(총 ${SEQ.length}단계)를 따라 순서대로 클릭하세요.`, '#16a34a');
      window.close();
    } catch (e) {
      setMsg('주입 실패: ' + (e && e.message || e), '#ef4444');
    }
  }

  // 고객 수집 — CRM 상세 탭
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

  function deriveSearchTerm(procNm, inscoNm) {
    let s = String(procNm || '').replace(/\(무\)|무배당/g, ' ');
    const brand = String(inscoNm || '').replace(/(화재|해상|생명|손해보험|손보)$/, '');
    if (brand) s = s.split(brand).join(' ');
    const m = s.match(/[가-힣]{4,}/);
    return (m && m[0].slice(0, 10)) || String(procNm || '').slice(0, 10);
  }

  // ── 공용: 고객 수집 + 상품 매칭 → 단계 값 해석에 쓸 컨텍스트 생성 ──
  //   반환: { customer, company, best, confidenceGap, candidates, ctx }
  //   (검증/편집기와 공유. ctx 는 PCSSteps.resolveSteps 에 그대로 넣는다.)
  async function prepareContext(opts) {
    opts = opts || {};
    let company = ($('pcsCompany') && $('pcsCompany').value || '').trim();
    let productName = ($('pcsProductName') && $('pcsProductName').value || '').trim();
    if ((!company || !productName) && $('pcsProposalText') && $('pcsProposalText').value.trim() && window.ProposalParser) {
      const p = window.ProposalParser.parseProposalText($('pcsProposalText').value);
      company = company || p.보험사 || ''; productName = productName || p.상품명 || '';
      if ($('pcsCompany')) $('pcsCompany').value = company;
      if ($('pcsProductName')) $('pcsProductName').value = productName;
    }
    if (!company || !productName) throw new Error('보험사·상품명이 필요합니다 — 제안서 텍스트를 붙여넣거나 직접 입력하세요.');

    const customer = await gatherCustomer();
    if (!window.PCSProductMatcher) throw new Error('매칭 모듈 로드 실패');
    let m = await window.PCSProductMatcher.matchProduct(company, productName);
    if (!m.best) throw new Error('매칭 후보가 없습니다.');

    // 확신도 낮으면(1·2순위 격차 < 0.05) 안내 후 점(.) 표기 보정해 재매칭(숫자 가중 ↑)
    let retried = false;
    if (m.confidenceGap !== null && m.confidenceGap < 0.05) {
      setMsg(`⚠️ 매칭 확신도 낮음(격차 ${m.confidenceGap}) — 버전 표기(.) 보정해 재매칭 중…`, '#d97706');
      const info = $('pcsMatchedInfo');
      if (info) { info.style.display = 'block'; info.innerHTML = '<span style="color:#d97706;font-weight:700;">⏳ 확신도가 낮아 점(.) 표기를 보정해 다시 매칭하는 중…</span>'; }
      try {
        const m2 = await window.PCSProductMatcher.matchProduct(company, productName, { numWeight: 0.5 });
        if (m2 && m2.best && (m2.confidenceGap || 0) > (m.confidenceGap || 0)) { m = m2; retried = true; }
      } catch (_) {}
    }
    try { chrome.runtime.sendMessage({ action: 'pcsTrackInsurer', company: (m.company && m.company.inscoNm) || company }, () => void chrome.runtime.lastError); } catch (_) {}

    const policyNo = ($('pcsPolicyNo') && $('pcsPolicyNo').value || '').trim();
    const category = ($('pcsCalibCat') && $('pcsCalibCat').value)
      || ($('pcsLocalCat') && $('pcsLocalCat').value) || '장기';
    const ctx = {
      customer, policyNo, category,
      companyTerm: (m.company.inscoNm || company).slice(0, 4),
      productTerm: deriveSearchTerm(m.best.procNm, m.company.inscoNm),
    };
    const prep = { customer, company: m.company, best: m.best, confidenceGap: m.confidenceGap, candidates: m.candidates, ctx, retried };
    renderMatched(prep);   // 매칭된 상품을 화면에 표시
    return prep;
  }

  // ── 좌표 모드 진행 (전체 실행) ──
  async function onRun() {
    const btn = $('pcsCalibRunBtn');
    try {
      btn.disabled = true; btn.textContent = '⏳ 준비 중…';
      const g = await chrome.storage.local.get(['pcsCalibration']);
      const cal = g.pcsCalibration;
      const steps = await getSteps();
      const need = steps.filter(s => s.action === 'click' && !s.optional).map(s => s.id);
      if (!cal || !cal.targets || need.some(k => !cal.targets[k])) {
        setMsg('먼저 <b>📐 좌표 가르치기</b>로 위치를 등록하세요. (누락: ' +
          (cal && cal.targets ? need.filter(k => !cal.targets[k]).join(', ') : '전체') + ')', '#ef4444');
        return;
      }

      setMsg('① 고객 수집 · ② 상품 매칭 중…');
      const prep = await prepareContext();
      if (prep.confidenceGap !== null && prep.confidenceGap < 0.05) {
        const list = prep.candidates.slice(0, 3).map((c, i) => `${i + 1}. (${c.score}) ${c.procNm}`).join('\n');
        if (!confirm(`⚠️ 매칭 확신도가 낮습니다 (격차 ${prep.confidenceGap}).\n1순위로 진행할까요?\n\n${list}`)) {
          setMsg('취소됨 — 상품명을 더 정확히 입력 후 재시도하세요.', '#d97706'); return;
        }
      }

      const resolved = window.PCSSteps.resolveSteps(steps, prep.ctx);
      const payload = { mode: 'calibrated', calibration: cal, steps: resolved, customer: prep.customer, company: prep.company, best: prep.best };
      setMsg(`③ 자동 작성 진행 — <b>${prep.customer.고객명}</b> / ${prep.company.inscoNm}<br>` +
        `상품: ${prep.best.procNm.slice(0, 46)}…<br><span style="color:#4338ca;">send 탭 진행 패널 확인. ⛔ 서명은 직접!</span>`, '#16a34a');

      chrome.runtime.sendMessage({ action: 'pcsCalibRun', payload }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.ok) setMsg('✅ 진행 완료 — 서명 직전 정지. send 탭에서 확인 후 직접 진행하세요.', '#16a34a');
        else if (res) setMsg('❌ 실패: ' + (res.error || '') + '<br>send 탭의 오류 패널을 확인하세요.', '#ef4444');
      });
    } catch (e) {
      setMsg('❌ ' + (e && e.message || e), '#ef4444');
    } finally {
      btn.disabled = false; btn.textContent = '▶️ 금소법 자동 작성 시작';
    }
  }

  // ── 내보내기: 단계 정의 + 가르친 좌표를 .json 다운로드 ──
  async function onExport() {
    try {
      const g = await chrome.storage.local.get(['pcsCalibration']);
      const steps = await getSteps();
      const data = {
        kind: 'toss-pcs-calibration',
        version: 1,
        exportedAt: new Date().toISOString(),
        steps,
        calibration: g.pcsCalibration || { targets: {} },
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      a.href = url;
      a.download = `toss-pcs-steps_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg('✅ 단계·좌표를 .json 파일로 내보냈습니다.', '#16a34a');
    } catch (e) {
      setMsg('내보내기 실패: ' + (e && e.message || e), '#ef4444');
    }
  }

  // ── 불러오기: .json → 단계 정의(+좌표) 적용 ──
  function onImportFile(file) {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = JSON.parse(String(fr.result || '{}'));
        if (!window.PCSSteps || !window.PCSSteps.validateSteps(data.steps)) {
          setMsg('불러온 파일의 단계 형식이 올바르지 않습니다.', '#ef4444'); return;
        }
        const save = { pcsSteps: data.steps };
        let msg = `✅ 단계 ${data.steps.length}개 불러옴.`;
        if (data.calibration && data.calibration.targets && Object.keys(data.calibration.targets).length) {
          save.pcsCalibration = data.calibration;
          save.pcsCalibDone = true;
          msg += ` 좌표 ${Object.keys(data.calibration.targets).length}개도 적용 — 바로 진행 가능.`;
        } else {
          msg += ' 좌표는 없으니 가르치기를 해주세요.';
        }
        chrome.storage.local.set(save, () => { setMsg(msg, '#16a34a'); showCalibState(); });
      } catch (e) {
        setMsg('불러오기 실패: ' + (e && e.message || e), '#ef4444');
      }
    };
    fr.onerror = () => setMsg('파일 읽기 실패', '#ef4444');
    fr.readAsText(file);
  }

  // ── 좌표 초기화 — 가르친 좌표를 모두 지움(다시 가르치기용) ──
  function onResetCoords() {
    if (!confirm('가르친 좌표를 모두 지울까요?\n(보험사칸·첫 보험사·상품칸·첫 상품 — 📐 가르치기를 다시 해야 합니다)')) return;
    chrome.storage.local.remove(['pcsCalibration', 'pcsCalibDone', 'pcsCalibActive', 'pcsCalibIndex', 'pcsCalibArmed'],
      () => { setMsg('좌표를 초기화했습니다 — 📐 좌표 가르치기를 다시 하세요.', '#16a34a'); showCalibState(); });
  }

  function showCalibState() {
    chrome.storage.local.get(['pcsCalibration', 'pcsCalibDone', 'pcsSteps'], (g) => {
      const custom = (window.PCSSteps && window.PCSSteps.validateSteps(g.pcsSteps)) ? '사용자 단계' : '기본 단계';
      if (g.pcsCalibDone && g.pcsCalibration && g.pcsCalibration.at) {
        const d = new Date(g.pcsCalibration.at);
        const p = (n) => String(n).padStart(2, '0');
        setMsg(`${custom} · 좌표 등록됨(${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}). 위치가 바뀌면 다시 가르치기.`, '#64748b');
      } else {
        setMsg(`${custom} · 좌표 미등록 — 📐 가르치기부터 하세요.`, '#64748b');
      }
    });
  }

  function init() {
    const t = $('pcsCalibTeachBtn'), r = $('pcsCalibRunBtn');
    const ex = $('pcsCalibExportBtn'), im = $('pcsCalibImportBtn'), imf = $('pcsCalibImportInput'), rs = $('pcsCalibResetBtn');
    if (t) t.addEventListener('click', onTeach);
    if (r) r.addEventListener('click', onRun);
    if (ex) ex.addEventListener('click', onExport);
    if (im && imf) { im.addEventListener('click', () => imf.click()); imf.addEventListener('change', () => onImportFile(imf.files && imf.files[0])); }
    if (rs) rs.addEventListener('click', onResetCoords);
    showCalibState();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // 단계 검증/편집기(pcs-step-editor.js)와 공유하는 API
  function saveSteps(steps, cb) {
    if (!window.PCSSteps || !window.PCSSteps.validateSteps(steps)) { if (cb) cb(new Error('단계 형식 오류')); return; }
    chrome.storage.local.set({ pcsSteps: steps }, () => { if (cb) cb(null); });
  }
  window.PCSCalib = { prepareContext, getSteps, saveSteps };
})();
