// ──────────────────────────────────────────────────────────────────────────
// pcs-step-editor.js — popup "🧪 단계 검증 · 편집"
//   각 단계를 하나씩 실행해 확인하고, 추가/삭제/순서이동/내용편집(JSON)을 하며
//   보면서 고칠 수 있게 한다. 편집 결과는 storage.pcsSteps 에 저장되어 자동 작성
//   버튼(전체 실행)에도 즉시 반영된다.
//
//   · 준비(고객·매칭): 입력 칸의 보험사/상품명으로 고객 수집 + 상품 매칭 → 단계의
//     값(고객명·보험사명·상품명 등)을 실제 값으로 해석해 미리보기/실행에 사용.
//   · 이 단계 실행: 현재 send 화면 상태 그대로, 커서 단계 1개만 실행.
//   · 여기서부터: 커서부터 끝까지 실행.
// ──────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function setMsg(m, c) { const e = $('pcsEdMsg'); if (e) { e.innerHTML = m || ''; e.style.color = c || '#64748B'; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  let STEPS = [];
  let PREP = null;      // prepareContext 결과 (null = 미준비)
  let cursor = 0;
  let editing = -1;     // 편집 중인 행 인덱스 (-1 = 없음)

  function ctx() { return PREP ? PREP.ctx : {}; }

  function resolvedText(s) {
    if (!window.PCSSteps) return '';
    if (s.action === 'type' || s.action === 'typeIfPresent') return window.PCSSteps.resolveValue(s.value, ctx());
    return '';
  }

  function summary(s) {
    switch (s.action) {
      case 'navigate': return `🌐 이동 <span style="color:#94a3b8;">${esc((s.url || '').replace(/^https?:\/\/[^/]+/, '…'))}</span>`;
      case 'focus': return '🎯 화면 포커스';
      case 'click': return `🖱️ 클릭 <b>〔${esc(s.id)}〕</b>`;
      case 'type': { const t = PREP ? resolvedText(s) : ''; return `⌨️ 입력 ⟵ ${esc(s.value)}${t ? ` = "<b>${esc(t)}</b>"` : ''}`; }
      case 'typeIfPresent': { const t = PREP ? resolvedText(s) : ''; return `⌨️ 입력(선택) ⟵ ${esc(s.value)}${t ? ` = "<b>${esc(t)}</b>"` : (PREP ? ' <span style="color:#94a3b8;">(비어 건너뜀)</span>' : '')}`; }
      case 'key': return `⏎ <b>${esc(s.key)}</b> ×${s.times || 0}`;
      case 'keyByCategory': { const c = ctx().category; const n = (s.map && s.map[c]); return `⏎ ${esc(s.key)} ×<b>${PREP && n != null ? n : '?'}</b> <span style="color:#94a3b8;">(카테고리 ${PREP ? esc(c) : '장기/일반/자동차'})</span>`; }
      case 'notify': return '🔔 정지 + 서명 알림';
      default: return esc(s.action);
    }
  }

  function render() {
    const box = $('pcsEdList');
    if (!box) return;
    box.innerHTML = '';
    STEPS.forEach((s, i) => {
      const row = document.createElement('div');
      row.style.cssText = `border:1px solid ${i === cursor ? '#6366f1' : '#e2e8f0'};border-radius:6px;padding:5px 7px;background:${i === cursor ? '#eef2ff' : '#fff'};`;
      const btn = (act, label, title) => `<span data-i="${i}" data-act="${act}" title="${title}" style="cursor:pointer;font-size:11px;padding:1px 4px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;">${label}</span>`;
      row.innerHTML =
        `<div style="display:flex;align-items:center;gap:4px;">
           <span style="font-weight:700;color:#4338ca;min-width:16px;text-align:right;">${i + 1}</span>
           <span style="flex:1;min-width:0;font-size:10.5px;line-height:1.35;">${summary(s)}${s.waitAfter ? ` <span style="color:#cbd5e1;">·${s.waitAfter}ms</span>` : ''}</span>
           ${btn('run', '▶', '이 단계 실행')}${btn('cursor', '◎', '여기로 커서')}${btn('edit', '✎', 'JSON 편집')}${btn('up', '▲', '위로')}${btn('down', '▼', '아래로')}${btn('del', '🗑', '삭제')}
         </div>` +
        (editing === i
          ? `<div style="margin-top:4px;">
               <textarea class="pcsEdJson" rows="4" style="width:100%;box-sizing:border-box;font:11px monospace;border:1.5px solid #c7d2fe;border-radius:6px;padding:6px;">${esc(JSON.stringify(s, null, 1))}</textarea>
               <div style="display:flex;gap:5px;margin-top:3px;">
                 <span data-i="${i}" data-act="save" style="cursor:pointer;font-size:11px;font-weight:700;padding:3px 8px;border-radius:5px;background:#6366f1;color:#fff;">저장</span>
                 <span data-i="${i}" data-act="cancel" style="cursor:pointer;font-size:11px;padding:3px 8px;border-radius:5px;border:1px solid #cbd5e1;">취소</span>
               </div>
             </div>` : '');
      box.appendChild(row);
    });
    const cur = $('pcsEdCursor');
    if (cur) cur.innerHTML = STEPS.length
      ? `현재 커서: <b>${cursor + 1} / ${STEPS.length}</b> — ${STEPS[cursor] ? summary(STEPS[cursor]) : ''}` : '단계 없음';
  }

  async function load() {
    STEPS = (window.PCSCalib ? await window.PCSCalib.getSteps() : (window.PCSSteps ? window.PCSSteps.DEFAULT_STEPS.slice() : []));
    if (cursor >= STEPS.length) cursor = Math.max(0, STEPS.length - 1);
    render();
  }

  function save(cb) {
    if (window.PCSCalib) window.PCSCalib.saveSteps(STEPS, (err) => { if (err) setMsg('저장 실패: ' + err.message, '#ef4444'); if (cb) cb(); });
  }

  async function buildPayload(stepsResolved) {
    const g = await chrome.storage.local.get(['pcsCalibration']);
    return {
      mode: 'calibrated',
      calibration: g.pcsCalibration || { targets: {} },
      steps: stepsResolved,
      customer: PREP ? PREP.customer : null,
      best: PREP ? PREP.best : null,
    };
  }

  // 한 개 또는 슬라이스 실행
  async function runSlice(fromIdx, count, btnEl) {
    const slice = STEPS.slice(fromIdx, count == null ? STEPS.length : fromIdx + count);
    if (!slice.length) { setMsg('실행할 단계가 없습니다.', '#d97706'); return; }
    const needsCtx = slice.some(s => s.action === 'type' || s.action === 'typeIfPresent' || s.action === 'keyByCategory');
    if (needsCtx && !PREP) setMsg('⚠️ 준비(고객·매칭) 안 됨 — 값이 빈 채로 실행됩니다.', '#d97706');
    const resolved = window.PCSSteps.resolveSteps(slice, ctx());
    const payload = await buildPayload(resolved);
    if (btnEl) btnEl.disabled = true;
    setMsg(`▶ 단계 ${fromIdx + 1}${slice.length > 1 ? `~${fromIdx + slice.length}` : ''} 실행 중…`, '#4338ca');
    chrome.runtime.sendMessage({ action: 'pcsCalibRun', payload }, (res) => {
      if (btnEl) btnEl.disabled = false;
      if (chrome.runtime.lastError) { setMsg('실행 오류: ' + chrome.runtime.lastError.message, '#ef4444'); return; }
      if (res && res.ok) setMsg(`✅ 단계 ${fromIdx + 1}${slice.length > 1 ? `~${fromIdx + slice.length}` : ''} 완료. send 화면을 확인하세요.`, '#16a34a');
      else setMsg('❌ 실패: ' + ((res && res.error) || '알 수 없음') + '<br>send 탭 오류 패널 확인.', '#ef4444');
    });
  }

  function reportText(report) {
    return report.map(r => `${r.i}. ${r.label || r.action} [${r.key ? r.key + '×' + r.times : r.action}] → ${r.focus} | ${r.note}`).join('\n');
  }

  function renderReport(report, ok, error) {
    const box = $('pcsEdReport'); if (!box) return;
    const lines = (report || []).map(r => {
      const bad = /⚠️/.test(r.note || '');
      const meta = r.key ? `${r.key}×${r.times}` : r.action;
      return `<div style="padding:3px 5px;border-left:3px solid ${bad ? '#ef4444' : '#16a34a'};background:${bad ? '#fef2f2' : '#f0fdf4'};margin-bottom:2px;border-radius:0 4px 4px 0;">
        <b>${r.i}.</b> ${esc(r.label || meta)} <span style="color:#94a3b8;">[${esc(meta)}]</span><br>
        <span style="color:#64748b;">포커스: ${esc(r.focus)} · ${esc(r.note || '')}</span></div>`;
    }).join('');
    box.style.display = 'block';
    box.innerHTML = `<div style="font-weight:700;margin:4px 0;">🔍 검증 결과 ${ok ? '완료' : '(중단: ' + esc(error || '') + ')'}</div>${lines}`
      + `<textarea readonly rows="3" onclick="this.select()" style="width:100%;box-sizing:border-box;margin-top:4px;font:10px monospace;border:1px solid #cbd5e1;border-radius:5px;padding:4px;">${esc(reportText(report || []))}</textarea>`;
    setMsg('검증 완료 — ⚠️ 표시된 단계가 막힌 곳입니다. 아래 텍스트를 복사해 공유하면 로직을 맞춰드립니다.', '#16a34a');
  }

  async function onVerify(btn) {
    if (!STEPS.length) { setMsg('단계가 없습니다.', '#d97706'); return; }
    if (!PREP) { await onPrepare(null); if (!PREP) { setMsg('준비(고객·매칭)가 필요합니다.', '#ef4444'); return; } }
    const resolved = window.PCSSteps.resolveSteps(STEPS, ctx());
    const payload = await buildPayload(resolved);
    payload.verify = true;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 검증 중…'; }
    setMsg('🔍 전체 검증 실행 중… send 화면 상단 패널을 보세요.', '#4338ca');
    chrome.runtime.sendMessage({ action: 'pcsCalibRun', payload }, (res) => {
      if (btn) { btn.disabled = false; btn.textContent = '🔍 전체 검증 실행'; }
      if (chrome.runtime.lastError) { setMsg('검증 오류: ' + chrome.runtime.lastError.message, '#ef4444'); return; }
      if (res && res.report) renderReport(res.report, res.ok, res.error);
      else setMsg('검증 결과 없음' + (res && res.error ? ': ' + res.error : ''), '#ef4444');
    });
  }

  async function onPrepare(btn) {
    if (!window.PCSCalib) { setMsg('준비 모듈 로드 실패', '#ef4444'); return; }
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 준비 중…'; }
    setMsg('고객 수집 · 상품 매칭 중…', '#4338ca');
    try {
      PREP = await window.PCSCalib.prepareContext();
      setMsg(`✅ 준비 완료 — ${PREP.customer.고객명} / ${PREP.company.inscoNm}<br>` +
        `상품: ${esc(PREP.best.procNm.slice(0, 40))}… (격차 ${PREP.confidenceGap})`, '#16a34a');
      render();   // 값 미리보기 갱신
    } catch (e) {
      PREP = null;
      setMsg('준비 실패: ' + (e && e.message || e), '#ef4444');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 준비(고객·매칭)'; }
    }
  }

  function onListClick(ev) {
    const t = ev.target.closest('[data-act]');
    if (!t) return;
    const i = parseInt(t.getAttribute('data-i'), 10);
    const act = t.getAttribute('data-act');
    if (isNaN(i)) return;
    switch (act) {
      case 'run': cursor = i; runSlice(i, 1, null); render(); break;
      case 'cursor': cursor = i; render(); break;
      case 'edit': editing = (editing === i ? -1 : i); render(); break;
      case 'cancel': editing = -1; render(); break;
      case 'save': {
        const ta = t.closest('div').parentElement.querySelector('.pcsEdJson');
        try {
          const obj = JSON.parse(ta.value);
          if (!obj || !obj.action) throw new Error('action 필드가 필요합니다');
          STEPS[i] = obj; editing = -1; save(); render(); setMsg(`단계 ${i + 1} 저장됨.`, '#16a34a');
        } catch (e) { setMsg('JSON 오류: ' + e.message, '#ef4444'); }
        break;
      }
      case 'up': if (i > 0) { const x = STEPS.splice(i, 1)[0]; STEPS.splice(i - 1, 0, x); editing = -1; cursor = i - 1; save(); render(); } break;
      case 'down': if (i < STEPS.length - 1) { const x = STEPS.splice(i, 1)[0]; STEPS.splice(i + 1, 0, x); editing = -1; cursor = i + 1; save(); render(); } break;
      case 'del':
        if (confirm(`단계 ${i + 1} 삭제할까요?\n${summary(STEPS[i]).replace(/<[^>]+>/g, '')}`)) {
          STEPS.splice(i, 1); editing = -1; if (cursor >= STEPS.length) cursor = Math.max(0, STEPS.length - 1); save(); render(); setMsg('삭제됨.', '#16a34a');
        }
        break;
    }
  }

  function onAdd() {
    const def = { action: 'key', key: 'Tab', times: 1, label: '새 단계', waitAfter: 300 };
    const at = STEPS.length ? cursor + 1 : 0;
    STEPS.splice(at, 0, def); cursor = at; editing = at; save(); render();
    setMsg('단계 추가됨 — JSON을 편집해 동작을 지정하세요.', '#2563eb');
  }

  function init() {
    const list = $('pcsEdList'); if (!list) return;   // 패널 없으면 미동작
    list.addEventListener('click', onListClick);
    const p = $('pcsEdPrepBtn'); if (p) p.addEventListener('click', () => onPrepare(p));
    const rl = $('pcsEdReloadBtn'); if (rl) rl.addEventListener('click', () => { PREP = PREP; load(); setMsg('단계를 다시 불러왔습니다.', '#64748b'); });
    const a = $('pcsEdAddBtn'); if (a) a.addEventListener('click', onAdd);
    const rsd = $('pcsEdResetStepsBtn'); if (rsd) rsd.addEventListener('click', () => {
      if (!confirm('단계를 기본값으로 되돌릴까요? (가르친 좌표는 유지됩니다)')) return;
      try { chrome.storage.local.remove(['pcsSteps'], () => { editing = -1; cursor = 0; load(); setMsg('단계를 기본값으로 되돌렸습니다.', '#16a34a'); }); }
      catch (e) { setMsg('실패: ' + (e && e.message || e), '#ef4444'); }
    });
    const one = $('pcsEdRunOneBtn'); if (one) one.addEventListener('click', () => { runSlice(cursor, 1, one); if (cursor < STEPS.length - 1) { cursor++; render(); } });
    const from = $('pcsEdRunFromBtn'); if (from) from.addEventListener('click', () => runSlice(cursor, null, from));
    const to = $('pcsEdRunToBtn'); if (to) to.addEventListener('click', () => runSlice(0, cursor + 1, to));
    const vf = $('pcsEdVerifyBtn'); if (vf) vf.addEventListener('click', () => onVerify(vf));
    const prev = $('pcsEdPrevBtn'); if (prev) prev.addEventListener('click', () => { if (cursor > 0) { cursor--; render(); } });
    const rst = $('pcsEdResetCurBtn'); if (rst) rst.addEventListener('click', () => { cursor = 0; render(); });
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
