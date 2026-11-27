// ═══════════════════════════════════════════════════════════════════
// 🖍 보장분석 화면 표시 (crm.tossinsu.com/crm-v2/cover/*)
//   ① 형광펜 — 칸·줄을 눌러 칠하기. '이 고객' 은 그 고객에게만, '모든 고객' 은 같은 줄 이름에 공통 적용
//   ② 보험 순서 기억 — CRM에서 드래그로 바꾼 순서를 고객별로 기억했다가 다시 열면 그대로 맞춘다
//   ③ 글자 수정 — 칸의 글자를 화면에서만 바꾼다(CRM 서버 데이터는 그대로)
//
//   · CRM 화면 자체를 바꾸지 않고, 열 때마다 내 표시를 다시 입힌다. 기능을 끄면(팝업 체크 또는
//     도구 막대 ⏻) 화면은 원래 모습 그대로다.
//   · 표시는 '줄 이름(예: 질병입원의료비) × 보험(증권번호)' 로 찾는다 → 보험 순서가 바뀌거나
//     '보장분석 표 미리보기' 창에서도 같은 칸에 표시된다. CRM '이미지 복사' 는 화면을 그대로
//     그리므로 형광펜·수정 글자가 페인트프로로 가는 이미지에도 그대로 들어간다(2026-11 실측).
//   · 순서 맞추기는 CRM의 끌어 옮기기 기능을 키보드(스페이스·화살표)로 대신 움직인다 —
//     화면 칸을 직접 옮기지 않으므로 CRM 화면이 꼬이지 않는다.
//   · 글자 수정은 칸 안 글자 노드의 내용만 바꾼다(노드를 새로 만들거나 지우지 않음) — CRM(React)
//     화면이 깨지지 않게.
//   · 안전장치: 되돌리기(↶, Ctrl+Z) · 고객별 '원래대로' · 기능 끄기. 저장은 background 가
//     이 PC 전용 키로 암호화(anno_c_<고객번호>). 공통 규칙은 anno_rules.
// ═══════════════════════════════════════════════════════════════════
(function () {
  if (!/(^|\.)tossinsu\.com$/i.test(location.hostname)) return;
  if (window.__sdhAnnoBound) return;
  window.__sdhAnnoBound = true;

  const COLORS = [
    { k: 'y', name: '노랑', bg: 'rgba(255, 230, 0, 0.55)' },
    { k: 'g', name: '초록', bg: 'rgba(52, 211, 153, 0.45)' },
    { k: 'p', name: '분홍', bg: 'rgba(244, 114, 182, 0.45)' },
    { k: 'b', name: '파랑', bg: 'rgba(96, 165, 250, 0.45)' }
  ];
  const colorBg = k => (COLORS.find(c => c.k === k) || COLORS[0]).bg;
  const MARK = 'data-tce';            // 우리가 칠한 칸 표시 (원래 배경은 data-tce-bg 에 보관)

  let enabled = true;
  let cid = '';                       // 고객 번호 (주소 끝 숫자)
  let data = { hl: [], edits: [], order: null };   // 이 고객 저장분
  let rules = [];                     // 공통 규칙 [{sec,row,color}]
  let mode = 'edit';                  // '' | 'hl' | 'edit' — 기본은 글자 수정
  let curColor = 'y';
  let scope = 'one';                  // 'one' 이 고객 | 'all' 모든 고객
  const undo = [];                    // 되돌리기 스냅샷
  let applying = false;
  const editedNodes = new Map();      // cell → [{node, orig}]
  let lastOrderSig = '';
  let replaying = false;
  let orderReady = false;             // 이 고객 화면에서 저장분 불러오기 + 순서 맞추기가 끝났는지
  let userTouchAt = 0;                // 사용자가 보험 머리칸을 직접 잡은 시각 (끌기·키보드)
  let autoFixes = 0;                  // CRM이 스스로 순서를 되돌렸을 때 다시 맞춘 횟수

  // ── background 저장소 ─────────────────────────────
  const send = msg => new Promise(r => { try { chrome.runtime.sendMessage(msg, x => { void chrome.runtime.lastError; r(x); }); } catch (e) { r(null); } });
  async function loadAll() {
    const st = await new Promise(r => { try { chrome.storage.local.get(['anno_enabled', 'anno_rules'], v => r(v || {})); } catch (e) { r({}); } });
    enabled = st.anno_enabled !== false;
    rules = Array.isArray(st.anno_rules) ? st.anno_rules : [];
    const res = cid ? await send({ action: 'annoLoad', cid }) : null;
    data = (res && res.ok && res.data) || { hl: [], edits: [], order: null };
    data.hl = data.hl || []; data.edits = data.edits || [];
  }
  async function saveCustomer() { if (cid) await send({ action: 'annoSave', cid, data }); }
  function saveRules() { try { chrome.storage.local.set({ anno_rules: rules }); } catch (e) {} }
  const redo = [];                    // 다시 실행(Ctrl+Shift+Z) 스냅샷
  function snapshot() { undo.push(JSON.stringify({ data, rules })); if (undo.length > 50) undo.shift(); redo.length = 0; renderBar(); }
  async function restoreSnap(s, msg) {
    const o = JSON.parse(s); data = o.data; rules = o.rules;
    closeEditor();
    await saveCustomer(); saveRules(); applyAll(); renderBar(); toast(msg);
  }
  async function doUndo() {
    const s = undo.pop(); if (!s) { toast('되돌릴 작업이 없습니다'); return; }
    redo.push(JSON.stringify({ data, rules }));
    await restoreSnap(s, '↶ 되돌렸습니다 (Ctrl+Shift+Z 로 다시 실행)');
  }
  async function doRedo() {
    const s = redo.pop(); if (!s) { toast('다시 실행할 작업이 없습니다'); return; }
    undo.push(JSON.stringify({ data, rules }));
    await restoreSnap(s, '↷ 다시 실행했습니다');
  }

  // ── 표 해석: 표 → 구역·줄 이름·보험 칸 ──────────────
  const norm = s => String(s || '').replace(/\s+/g, '');
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + s.length.toString(36); }
  const cellText = c => norm(c && c.textContent);

  // 한 줄 → { label, labelCells:[], prod:[td...] }  (보험 칸 = 마지막 TH 뒤의 TD 들)
  function parseRow(tr) {
    const cells = Array.prototype.filter.call(tr.children, c => c.tagName === 'TD' || c.tagName === 'TH');
    let k = -1;
    cells.forEach((c, j) => { if (c.tagName === 'TH') k = j; });
    if (k < 0) return null;
    const prev = cells[k - 1];
    // 보장 표: [대분류][소분류][합계 TH][보험...] → 소분류 / 상세 표: [이름 TH][보험...] → TH
    const labelCell = (prev && prev.tagName === 'TD' && prev.rowSpan === 1) ? prev : cells[k];
    // 줄 전체 칠하기용 이름 칸 — 여러 줄에 걸친 칸(대분류·요약 상자)은 빼서 다른 줄까지 칠하지 않게
    return { label: cellText(labelCell), labelCells: cells.slice(0, k + 1).filter(c => c.rowSpan === 1), prod: cells.slice(k + 1).filter(c => c.tagName === 'TD') };
  }

  // 화면 하나(본문 또는 미리보기 창)의 표들을 해석. 보험 칸 키 = 증권번호(없으면 보험명) 해시
  function scanRoot(root) {
    const tables = Array.prototype.slice.call(root.querySelectorAll('table'));
    const parsed = tables.map(t => ({ t, rows: Array.prototype.map.call(t.querySelectorAll('tr'), tr => ({ tr, p: parseRow(tr) })).filter(x => x.p) }));
    let keys = null;
    for (const pt of parsed) {
      const r = pt.rows.find(x => x.p.label === '증권번호') || null;
      if (r) { keys = r.p.prod.map(c => 'n' + hash(cellText(c))); break; }
    }
    // 증권번호가 비었거나(-, 가려진 번호 등) 두 보험이 같으면 구분이 안 돼 순서를 못 다룬다
    //   → 그런 보험만 보험명·보험사·계약일 등을 합쳐 구분하고, 그래도 같으면 순번을 붙인다 (정상인 보험 키는 그대로라 저장된 순서 유지)
    if (keys) {
      const raw = (() => { for (const pt of parsed) { const r = pt.rows.find(x => x.p.label === '증권번호'); if (r) return r.p.prod.map(c => cellText(c).trim()); } return []; })();
      const cnt = {}; keys.forEach(k => { cnt[k] = (cnt[k] || 0) + 1; });
      const bad = keys.map((k, i) => cnt[k] > 1 || !/[0-9A-Za-z가-힣]{3,}/.test((raw[i] || '').replace(/[*●\-\s]/g, '')));
      if (bad.some(Boolean)) {
        const extraRows = [];
        for (const pt of parsed) pt.rows.forEach(x => { if (/^(보험명|상품명|보험사명|보험사|계약일|가입일|계약자|피보험자|월납보험료|보험료)$/.test(x.p.label) && x.p.prod.length === keys.length) extraRows.push(x.p); });
        const seen = {};
        keys = keys.map((k, i) => {
          if (!bad[i]) return k;
          let base = 'c' + hash([raw[i] || ''].concat(extraRows.map(p => cellText(p.prod[i]).trim())).join('|'));
          seen[base] = (seen[base] || 0) + 1;
          return seen[base] > 1 ? base + '_' + seen[base] : base;
        });
      }
    }
    if (!keys) {
      for (const pt of parsed) {
        const r = pt.rows.find(x => x.p.label === '보험명');
        if (r) { keys = r.p.prod.map(c => 'm' + hash(cellText(c))); break; }
      }
    }
    parsed.forEach(pt => { pt.sec = pt.rows.some(x => x.p.label === '증권번호' || x.p.label === '보험사명') ? 'info' : 'cat'; });
    // 보장분석 표만 대상 (상담 메모 등 다른 작은 표는 건드리지 않음): 보험 칸 수가 보험 수와 같은 줄이 있는 표
    const n = (keys || []).length;
    const only = n ? parsed.filter(pt => pt.rows.some(x => x.p.prod.length === n)) : [];
    return { parsed: only, keys: keys || [] };
  }
  function roots() {
    const out = [document];
    document.querySelectorAll('[role="dialog"]').forEach(d => out.push(d));
    return out;
  }
  // 본문 표만(미리보기 창 제외)
  function mainScan() {
    const s = scanRoot(document);
    s.parsed = s.parsed.filter(pt => !pt.t.closest('[role="dialog"]'));
    return s;
  }

  // ── 칠하기 / 지우기 ────────────────────────────────
  // 형광펜 = 글자 위에만 칠하기. 칸 안 글자 자리(Range 사각형)에 맞춘 색 띠를 칸 안에 깔고
  // 글자 '뒤' 에 둔다(z-index -1, 칸을 쌓임 맥락으로). CRM 글자 노드는 건드리지 않음(React 안전).
  // 이 띠도 화면의 일부라 '이미지 복사' 이미지에 그대로 들어간다.
  const HL = 'data-tce-hl';
  const painted = new Map();          // cell → color
  function paint(el, color) { painted.set(el, color); }
  function drawCell(el, color) {
    let ov = Array.prototype.find.call(el.children, c => c.hasAttribute(HL));
    if (ov) ov.textContent = '';
    const tr = textNodes(el);
    if (!tr.length) return;
    if (!el.hasAttribute(MARK)) {
      el.setAttribute('data-tce-pos', el.style.getPropertyValue('position') || '');
      el.setAttribute('data-tce-z', el.style.getPropertyValue('z-index') || '');
      const cs = getComputedStyle(el);
      if (cs.position === 'static') el.style.setProperty('position', 'relative');
      if (cs.zIndex === 'auto') el.style.setProperty('z-index', '0');   // 띠가 칸 배경 위·글자 아래에 오도록
    }
    el.setAttribute(MARK, color);
    if (!ov) {
      ov = document.createElement('div');
      ov.setAttribute(HL, '');
      ov.setAttribute('aria-hidden', 'true');
      ov.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:-1;pointer-events:none;';
      el.appendChild(ov);
    }
    const box = el.getBoundingClientRect();
    const k = box.width ? el.offsetWidth / box.width : 1;   // 미리보기 창 확대·축소 애니메이션 보정
    const bg = colorBg(color);
    tr.forEach(n => {
      const r = document.createRange(); r.selectNodeContents(n);
      Array.prototype.forEach.call(r.getClientRects(), q => {
        if (q.width < 1 || q.height < 1) return;
        const d = document.createElement('div');
        const x = (q.left - box.left) * k - el.clientLeft, y = (q.top - box.top) * k - el.clientTop;
        const w = q.width * k, h = q.height * k;
        d.style.cssText = `position:absolute;left:${(x - 2).toFixed(1)}px;top:${(y + h * 0.08).toFixed(1)}px;width:${(w + 4).toFixed(1)}px;height:${(h * 0.9).toFixed(1)}px;background:${bg};border-radius:3px;`;
        ov.appendChild(d);
      });
    });
  }
  function drawAll() { painted.forEach((color, el) => { if (el.isConnected) drawCell(el, color); }); }
  function unpaintAll() {
    painted.clear();
    document.querySelectorAll('[' + HL + ']').forEach(el => el.remove());
    document.querySelectorAll('[' + MARK + ']').forEach(el => {
      const pos = el.getAttribute('data-tce-pos'), z = el.getAttribute('data-tce-z');
      if (pos) el.style.setProperty('position', pos); else el.style.removeProperty('position');
      if (z) el.style.setProperty('z-index', z); else el.style.removeProperty('z-index');
      el.removeAttribute(MARK); el.removeAttribute('data-tce-pos'); el.removeAttribute('data-tce-z');
    });
  }
  // 칸 너비가 바뀌면(창 크기, 순서 변경 중, 미리보기 창 애니메이션) 띠 위치를 다시 맞춘다
  let redrawTimer = null;
  function scheduleRedraw() { clearTimeout(redrawTimer); redrawTimer = setTimeout(() => { applying = true; try { drawAll(); } finally { setTimeout(() => { applying = false; }, 0); } }, 120); }
  window.addEventListener('resize', scheduleRedraw);
  function restoreEdits() {
    editedNodes.forEach(list => list.forEach(x => { try { if (x.node.nodeValue !== x.orig) x.node.nodeValue = x.orig; } catch (e) {} }));
    editedNodes.clear();
    document.querySelectorAll('[data-tce-unit]').forEach(el => el.remove());
    document.querySelectorAll('[data-tce-edc]').forEach(el => { const st = el.getAttribute('data-tce-edc'); if (st) el.setAttribute('style', st); else el.removeAttribute('style'); el.removeAttribute('data-tce-edc'); });
    document.querySelectorAll('[data-tce-ed]').forEach(el => { el.removeAttribute('data-tce-ed'); el.removeAttribute('title'); el.style.removeProperty('outline'); el.style.removeProperty('outline-offset'); });
  }
  function textNodes(el) {
    const out = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.trim() && !(n.parentElement && n.parentElement.closest('[' + HL + ']'))) out.push(n);
    return out;
  }
  function originalText(cell) {
    const l = editedNodes.get(cell);
    return l ? l.map(x => x.orig).join('').trim() : (cell.textContent || '').trim();
  }
  // ✏️ 고친 글자 넣기 — CRM 금액 칸('2,000' 진한 글자 + '만원' 옅은 글자)과 똑같은 모양으로
  //   · "3000만원" / "3,000 만원" / 금액 칸에 숫자만 → 천 단위 쉼표 + 단위는 CRM 단위 글자 모양
  //   · 빈 칸('-')처럼 단위 글자가 없던 칸은 같은 표의 금액 칸 모양을 본떠 단위 글자를 붙인다
  //   · color 를 고르면 그 색, 아니면 CRM 금액 숫자 색(진한 색) — 옅은 회색 칸에서도 잘 보이게
  //   · text 가 '' 이면 칸을 비운다
  const AMT_RE = /^\s*([+\-]?\d[\d,]*(?:\.\d+)?)\s*(만\s*원|천\s*원|억\s*원|원|만|억)?\s*$/;
  const UNIT_RE = /(원|만|억)/;
  function fmtNum(n) {
    const neg = /^-/.test(n), raw = n.replace(/[,+\-]/g, ''), [i, d] = raw.split('.');
    return (neg ? '-' : '') + Number(i || 0).toLocaleString('ko-KR') + (d ? '.' + d : '');
  }
  function unitTemplate(cell) {
    const t = cell.closest('table'); if (!t) return null;
    // CRM은 모자란 금액을 빨강으로 표시하므로, 색이 없는(검정·회색) 보통 금액 칸을 본보기로 고른다
    let best = null, bestSat = 2;
    for (const td of t.querySelectorAll('td')) {
      if (td === cell || td.hasAttribute('data-tce-ed')) continue;
      const ns = textNodes(td);
      if (ns.length === 2 && /\d/.test(ns[0].nodeValue) && UNIT_RE.test(ns[1].nodeValue) && ns[0].parentElement !== ns[1].parentElement) {
        const sat = satOf(getComputedStyle(ns[0].parentElement).color);
        if (sat < bestSat) { best = { num: ns[0].parentElement, unit: ns[1].parentElement }; bestSat = sat; }
        if (sat < 0.12) break;
      }
    }
    return best;
  }
  function rgbOf(c) {
    c = String(c || '').trim();
    let m = c.match(/^#([0-9a-f]{6})$/i);
    if (m) { const v = parseInt(m[1], 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; }
    m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function satOf(c) { const v = rgbOf(c); if (!v) return 1; const mx = Math.max(...v), mn = Math.min(...v); return mx ? (mx - mn) / mx : 0; }
  // 고른 글자색의 옅은 색 — 단위 글자('만원')용 (CRM 빨강 금액의 옅은 단위색과 같은 방식)
  function tint(c) { const v = rgbOf(c); if (!v) return c; return 'rgb(' + v.map(x => Math.round(x * 0.42 + 255 * 0.58)).join(',') + ')'; }
  function keepStyle(el) { if (el && !el.hasAttribute('data-tce-edc')) el.setAttribute('data-tce-edc', el.getAttribute('style') || ''); }
  function paintText(el, color) {
    if (!el) return;
    keepStyle(el);
    el.style.setProperty('color', color, 'important'); el.style.setProperty('-webkit-text-fill-color', color, 'important'); el.style.setProperty('opacity', '1', 'important');
  }
  // 값이 없는 칸 — CRM의 실제 빈 칸('-', 옅은 회색)과 똑같이
  function emptyTemplate(cell) {
    const t = cell.closest('table'); if (!t) return null;
    for (const td of t.querySelectorAll('td')) {
      if (td === cell || td.hasAttribute('data-tce-ed')) continue;
      const ns = textNodes(td);
      if (ns.length === 1 && ns[0].nodeValue.trim() === '-' && ns[0].parentElement !== td) return ns[0].parentElement;
    }
    return null;
  }
  function setEmpty(cell, list) {
    list.forEach(x => { x.node.nodeValue = ''; });
    list[0].node.nodeValue = '-';
    const host = list[0].node.parentElement;
    const tpl = emptyTemplate(cell);
    if (host && !(list.length === 1 && list[0].orig.trim() === '-')) {   // 원래 빈 칸이면 CRM 모양 그대로
      keepStyle(host);
      if (tpl) {
        const ts = getComputedStyle(tpl);
        host.style.setProperty('color', ts.color, 'important'); host.style.setProperty('-webkit-text-fill-color', ts.color, 'important');
        host.style.setProperty('font-size', ts.fontSize, 'important'); host.style.setProperty('font-weight', ts.fontWeight, 'important');
      } else { host.style.setProperty('color', '#BBBDBF', 'important'); host.style.setProperty('-webkit-text-fill-color', '#BBBDBF', 'important'); host.style.setProperty('font-weight', '400', 'important'); }
    }
    cell.setAttribute('data-tce-ed', '1');
    cell.title = '✏️ 비운 칸 — 원래: ' + list.map(x => x.orig).join('').trim();
  }
  function setCellText(cell, text, color) {
    let list = editedNodes.get(cell);
    if (!list) { list = textNodes(cell).map(n => ({ node: n, orig: n.nodeValue })); if (!list.length) return; editedNodes.set(cell, list); }
    cell.querySelectorAll('[data-tce-unit]').forEach(x => x.remove());
    text = String(text == null ? '' : text);
    if (text.trim() === '' || text.trim() === '-') { setEmpty(cell, list); return; }
    const hasUnitNode = list.length >= 2 && UNIT_RE.test(list[list.length - 1].orig) && /\d|-/.test(list[0].orig);
    const m = text.match(AMT_RE);
    const tpl = unitTemplate(cell);
    let numText = text, unitText = null;
    if (m && (m[2] || hasUnitNode)) { numText = fmtNum(m[1]); unitText = m[2] ? m[2].replace(/\s/g, '') : list[list.length - 1].orig.trim(); }
    else if (m && tpl && cell.closest('table') === tpl.num.closest('table')) { numText = fmtNum(m[1]); unitText = (tpl.unit.textContent || '').trim(); }   // 금액 표의 빈 칸에 숫자만 → 같은 표 단위(만원)
    if (unitText === '만') unitText = '만원';   // CRM 표기와 같게
    if (unitText === '억') unitText = '억원';
    const numColor = color || (tpl ? getComputedStyle(tpl.num).color : '#1B242D');
    list.forEach(x => { x.node.nodeValue = ''; });
    list[0].node.nodeValue = numText;
    const host = list[0].node.parentElement;
    if (unitText !== null && hasUnitNode) {
      const u = list[list.length - 1];
      u.node.nodeValue = u.orig.replace(u.orig.trim(), unitText);
    } else if (unitText !== null && host) {
      // 단위 글자가 없던 칸: 같은 표 금액 칸의 단위 글자 모양을 본떠 붙임
      const sp = document.createElement('span');
      sp.setAttribute('data-tce-unit', '');
      sp.textContent = unitText;
      if (tpl) {
        const us = getComputedStyle(tpl.unit);
        ['color', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing'].forEach(k => { sp.style[k] = us[k]; });
        sp.style.marginLeft = us.marginLeft !== '0px' ? us.marginLeft : '4px';
        const ns = getComputedStyle(tpl.num);
        if (host) { keepStyle(host); ['fontSize', 'fontWeight'].forEach(k => host.style.setProperty(k === 'fontSize' ? 'font-size' : 'font-weight', ns[k], 'important')); }
      } else { sp.style.marginLeft = '4px'; sp.style.opacity = '.6'; }
      if (host === cell || !cell.contains(host.parentElement)) host.appendChild(sp); else host.insertAdjacentElement('afterend', sp);   // 칸 안에만
    }
    if (text !== '' && (color || !hasUnitNode)) paintText(host, numColor);   // 원래 금액 칸을 기본색으로 고치면 CRM 색(빨강 등) 그대로
    if (color && unitText !== null) {
      const uEl = hasUnitNode ? list[list.length - 1].node.parentElement : cell.querySelector('[data-tce-unit]');
      if (uEl && uEl !== host) paintText(uEl, tint(color));
    }
    cell.setAttribute('data-tce-ed', '1');
    cell.title = '✏️ 고친 글자 — 원래: ' + list.map(x => x.orig).join('').trim();
  }

  function applyAll() {
    if (applying) return;
    applying = true;
    try {
      unpaintAll(); restoreEdits(); unhideAll(); hiddenN = 0;
      if (!enabled || !cid) return;
      roots().forEach(root => {
        const scan = scanRoot(root);
        const { parsed, keys } = scan;
        if (hideDiff) { if (root === document) scan.parsed = parsed.filter(pt => !pt.t.closest('[role="dialog"]')); const hn = hideDiffCols(scan); if (root === document) hiddenN = hn; scan.parsed = parsed; }
        parsed.forEach(pt => {
          if (root === document && pt.t.closest('[role="dialog"]')) return;   // 미리보기 표는 따로
          pt.rows.forEach(({ p }) => {
            const rowRule = rules.find(r => r.sec === pt.sec && r.row === p.label);
            const rowHl = data.hl.find(h => h.sec === pt.sec && h.row === p.label && h.col === '*');
            const rowColor = rowHl ? rowHl.color : (rowRule ? rowRule.color : null);
            if (rowColor) { p.labelCells.forEach(c => paint(c, rowColor)); p.prod.forEach(c => paint(c, rowColor)); }
            p.prod.forEach((c, j) => {
              const key = keys[j]; if (!key) return;
              const h = data.hl.find(x => x.sec === pt.sec && x.row === p.label && x.col === key);
              if (h) paint(c, h.color);
              const ed = data.edits.find(x => x.sec === pt.sec && x.row === p.label && x.col === key);
              if (ed) setCellText(c, ed.text, ed.color);
            });
          });
        });
      });
      drawAll();
    } finally { setTimeout(() => { applying = false; }, 0); }
    if (painted.size && document.querySelector('[role="dialog"]')) { setTimeout(scheduleRedraw, 400); setTimeout(scheduleRedraw, 1200); }
  }

  // 클릭한 칸 → 위치 정보
  function locate(cell) {
    const tr = cell.closest('tr'); const table = cell.closest('table');
    if (!tr || !table) return null;
    const root = cell.closest('[role="dialog"]') || document;
    const { parsed, keys } = scanRoot(root);
    const pt = parsed.find(x => x.t === table); if (!pt) return null;
    const row = pt.rows.find(x => x.tr === tr); if (!row) return null;
    const j = row.p.prod.indexOf(cell);
    return { sec: pt.sec, row: row.p.label, col: j >= 0 ? keys[j] : '*', isLabel: j < 0 };
  }

  // ── 클릭 처리 (형광펜·글자 수정 모드일 때만 CRM 동작을 막고 가로챔) ──
  // 표시 모드가 켜져 있어도 CRM 자체 기능은 그대로 쓰게 — 보험 머리칸(끌어 옮기기), 버튼·입력·선택 상자,
  // 매니저 의견·코멘트 줄, (글자 수정 모드의) 줄 이름 칸은 가로채지 않는다
  const PASS_SEL = 'button,a,input,select,textarea,label,[role="button"],[role="combobox"],[role="listbox"],[role="option"],[aria-haspopup],[contenteditable="true"]';
  function passThrough(e, cell) {
    if (!cell) return true;
    if (cell.closest('[aria-roledescription="sortable"]')) return true;
    if (e.target.closest && e.target.closest(PASS_SEL) && cell.contains(e.target.closest(PASS_SEL))) return true;
    const tr = cell.closest('tr'), first = tr && tr.firstElementChild;
    const rowName = first ? (first.textContent || '').trim() : '';
    if (/^매니저\s*(의견|코멘트)/.test(rowName)) return true;
    if (mode === 'edit') { const loc = locate(cell); if (!loc || !loc.row || loc.isLabel) return true; }
    return false;
  }
  function onClick(e) {
    if (!enabled || !mode || !cid) return;
    if (e.composedPath && e.composedPath().includes(barHost)) return;
    const cell = e.target.closest && e.target.closest('td,th');
    if (!cell || !cell.closest('table')) return;
    if (passThrough(e, cell)) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const loc = locate(cell); if (!loc || !loc.row) return;
    if (mode === 'hl') toggleHighlight(loc);
    else if (mode === 'edit' && !loc.isLabel) openEditor(cell, loc);
  }
  function swallow(e) {
    if (!enabled || !mode) return;
    if (e.composedPath && e.composedPath().includes(barHost)) return;
    const cell = e.target.closest && e.target.closest('td,th');
    if (cell && cell.closest('table') && !passThrough(e, cell)) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
  }

  async function toggleHighlight(loc) {
    snapshot();
    const color = curColor;
    if (scope === 'all') {
      // 공통 규칙은 줄 단위 — 같은 줄 이름이면 모든 고객에 칠해짐
      const i = rules.findIndex(r => r.sec === loc.sec && r.row === loc.row);
      if (i >= 0 && (color === 'x' || rules[i].color === color)) rules.splice(i, 1);
      else if (color !== 'x') { if (i >= 0) rules[i].color = color; else rules.push({ sec: loc.sec, row: loc.row, color }); }
      saveRules();
      toast(i >= 0 && (color === 'x' || !rules.find(r => r.sec === loc.sec && r.row === loc.row)) ? `모든 고객: '${loc.row}' 줄 형광펜 해제` : `모든 고객: '${loc.row}' 줄 형광펜`);
    } else {
      const col = loc.isLabel ? '*' : loc.col;
      const i = data.hl.findIndex(h => h.sec === loc.sec && h.row === loc.row && h.col === col);
      if (i >= 0 && (color === 'x' || data.hl[i].color === color)) data.hl.splice(i, 1);
      else if (color !== 'x') { if (i >= 0) data.hl[i].color = color; else data.hl.push({ sec: loc.sec, row: loc.row, col, color }); }
      await saveCustomer();
    }
    applyAll();
  }

  // ── 글자 수정 입력창 ───────────────────────────────
  let edBox = null;
  // ✏️ 글자 수정 — 칸 위에 그 칸과 똑같은 모양(글꼴·크기·정렬·여백)의 입력 자리를 겹쳐 '표에 바로 쓰는' 방식.
  //   CRM 칸 자체를 고치지 않으므로 CRM 화면이 다시 그려져도 입력이 깨지지 않는다. Enter 저장 · Esc 취소 · 비우면 원래 글자.
  let edCell = null;
  const ED_COLORS = [
    { k: '', name: '기본(CRM 색)', c: '#1B242D' }, { k: '#E11D48', name: '빨강', c: '#E11D48' }, { k: '#2563EB', name: '파랑', c: '#2563EB' },
    { k: '#059669', name: '초록', c: '#059669' }, { k: '#EA580C', name: '주황', c: '#EA580C' }, { k: '#7C3AED', name: '보라', c: '#7C3AED' }
  ];
  let edColor = '';
  function openEditor(cell, loc) {
    closeEditor();
    const prevEd = data.edits.find(x => x.sec === loc.sec && x.row === loc.row && x.col === loc.col);
    const cur = prevEd ? prevEd.text : (cell.textContent || '').trim();
    edColor = prevEd && prevEd.color ? prevEd.color : '';
    const orig = originalText(cell);
    const cs = getComputedStyle(cell);
    edBox = document.createElement('div');
    edBox.setAttribute('data-tce-ui', '');
    const sr = edBox.attachShadow({ mode: 'closed' });
    sr.innerHTML = `<style>
      .e{position:fixed;z-index:2147483646;box-sizing:border-box;background:#fff;outline:none;box-shadow:0 0 0 2px #6366F1,0 6px 18px rgba(15,23,42,.18);
        border-radius:3px;overflow:hidden;white-space:pre-wrap;word-break:break-all;cursor:text;display:flex;align-items:center}
      .e > div{width:100%;outline:none;min-height:1em}
      .e > div:empty::before{content:"(빈 칸)";color:#C0C4CF;font-weight:500}
      .e ::selection{background:rgba(99,102,241,.22);color:var(--c,#1B242D);-webkit-text-fill-color:var(--c,#1B242D)}
      .bar{position:fixed;z-index:2147483646;display:flex;align-items:center;gap:6px;background:rgba(31,35,48,.96);backdrop-filter:blur(8px);border-radius:12px;padding:6px 8px;
        box-shadow:0 10px 28px rgba(17,24,39,.3);font:12px -apple-system,"Malgun Gothic",sans-serif;color:#E5E7EB;white-space:nowrap}
      .sw{width:18px;height:18px;border-radius:50%;border:0;cursor:pointer;padding:0;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.35)}
      .sw.sel{box-shadow:0 0 0 2px rgba(31,35,48,.96),0 0 0 4px #A5B4FC}
      .sep{width:1px;height:16px;background:rgba(255,255,255,.18)}
      .bt{border:0;border-radius:8px;padding:4px 9px;font:inherit;font-weight:700;cursor:pointer;background:rgba(255,255,255,.1);color:#fff}
      .bt:hover{background:rgba(255,255,255,.2)}
      .k{color:#9CA3AF}</style>
      <div class="e"><div contenteditable="true" spellcheck="false"></div></div>
      <div class="bar"><span class="k">글자색</span>${ED_COLORS.map(c => `<button class="sw" data-c="${c.k}" title="${c.name}" style="background:${c.c}"></button>`).join('')}
        <span class="sep"></span><button class="bt" data-a="clear" title="칸을 비웁니다">비우기</button><button class="bt" data-a="orig" title="CRM 원래 글자로">↺ 원래 글자</button>
        <span class="sep"></span><span class="k">Enter 저장 · Esc 취소</span></div>`;
    const box = sr.querySelector('.e'), ed = sr.querySelector('.e > div'), bar = sr.querySelector('.bar');
    ['fontFamily', 'fontSize', 'lineHeight', 'textAlign', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'letterSpacing'].forEach(k => { box.style[k] = cs[k]; });
    box.style.fontWeight = '600'; box.style.caretColor = '#4F46E5';
    if (parseFloat(cs.paddingLeft) < 4) box.style.paddingLeft = '4px';
    ed.style.textAlign = cs.textAlign;
    ed.textContent = cur;
    const showColor = () => {
      box.style.color = edColor || '#1B242D'; box.style.setProperty('--c', edColor || '#1B242D');
      sr.querySelectorAll('.sw').forEach(b => b.classList.toggle('sel', b.dataset.c === edColor));
    };
    showColor();
    let closed = false;
    const save = async (text, revert) => {
      if (closed) return; closed = true;
      snapshot();
      const i = data.edits.findIndex(x => x.sec === loc.sec && x.row === loc.row && x.col === loc.col);
      const t = String(text == null ? '' : text).replace(/ /g, ' ').trim();
      if (revert || (t === orig && !edColor)) { if (i >= 0) data.edits.splice(i, 1); }
      else {
        const rec = { sec: loc.sec, row: loc.row, col: loc.col, text: t };
        if (edColor) rec.color = edColor;
        if (i >= 0) data.edits[i] = rec; else data.edits.push(rec);
      }
      await saveCustomer(); closeEditor(); applyAll();
    };
    // 도구 줄을 눌러도 입력칸 포커스를 잃지 않게(잃으면 저장돼 버림)
    bar.addEventListener('mousedown', ev => ev.preventDefault());
    bar.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.c !== undefined) { edColor = b.dataset.c; showColor(); save(ed.textContent); return; }   // 색을 누르면 바로 표에 적용
      if (b.dataset.a === 'clear') { ed.textContent = ''; ed.focus(); return; }
      if (b.dataset.a === 'orig') save(null, true);
    });
    ed.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); save(ed.textContent); }
      else if (ev.key === 'Escape') { closed = true; closeEditor(); }
    });
    ed.addEventListener('blur', () => { setTimeout(() => { if (!closed && edBox) save(ed.textContent); }, 0); });
    edCell = cell;
    document.documentElement.appendChild(edBox);
    edBox.__place = () => {
      if (!edCell || !edCell.isConnected) return;
      const r = edCell.getBoundingClientRect();
      box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = r.width + 'px'; box.style.minHeight = r.height + 'px';
      const bw = bar.offsetWidth || 420;
      bar.style.left = Math.max(8, Math.min(window.innerWidth - bw - 8, r.left)) + 'px';
      bar.style.top = (r.bottom + 46 > window.innerHeight ? r.top - 40 : r.bottom + 6) + 'px';
    };
    edBox.__place();
    setTimeout(() => {
      ed.focus();
      try { const rg = document.createRange(); rg.selectNodeContents(ed); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rg); } catch (e) {}
    }, 0);
  }
  function closeEditor() { if (edBox) { edBox.remove(); edBox = null; } edCell = null; }

  // ── 보험 순서 기억 · 다시 맞추기 ─────────────────────
  function headerCells() {
    const { parsed } = mainScan();
    for (const pt of parsed) {
      const tr = pt.t.querySelector('tr'); if (!tr) continue;
      const hs = Array.prototype.filter.call(tr.children, c => c.getAttribute('aria-roledescription') === 'sortable');
      if (hs.length) return hs;
    }
    return [];
  }
  function currentOrder() {
    const s = mainScan(), n = headerCells().length;
    if (!n) return [];
    const ks = s.keys.slice(0, n);
    // 아직 내용이 덜 그려진 표(증권번호가 비었거나 같은 키가 겹침)는 순서로 치지 않음
    const empty = ['n' + hash(''), 'm' + hash('')];   // 아직 비어 있는 증권번호 칸
    if (ks.length !== n || new Set(ks).size !== ks.length || ks.some(k => k.length < 3 || empty.includes(k))) return [];
    return ks;
  }
  const sameSet = (a, b) => a.length === b.length && a.every(k => b.includes(k));
  // 표가 다 그려지고 1초 넘게 그대로일 때까지 기다림 (새 브라우저로 열면 CRM이 표를 여러 번에 나눠 그림)
  async function waitStable(maxMs) {
    let last = '', since = Date.now();
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const sig = currentOrder().join(',');
      if (sig !== last) { last = sig; since = Date.now(); }
      else if (sig && Date.now() - since >= 700) return true;
      await sleep(250);
    }
    return !!last;
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function key(el, code) { el.dispatchEvent(new KeyboardEvent('keydown', { key: code === 'Space' ? ' ' : code, code, bubbles: true, cancelable: true })); }
  // CRM 머리칸 옮기기 — CRM 버전에 따라 키보드로만/끌기로만 되는 경우가 있어 여러 방법을 차례로 시도하고,
  // 한 번 된 방법은 기억해서 다음 칸부터 그 방법을 먼저 쓴다.
  let goodWay = '';
  try { chrome.storage.local.get(['anno_move_way'], v => { if (v && v.anno_move_way) goodWay = v.anno_move_way; }); } catch (e) {}
  const center = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; };
  function grips(h) {   // 실제로 잡히는 곳: 머리칸 자체 또는 안쪽 손잡이(버튼)
    const out = [];
    const c = center(h), hit = document.elementFromPoint(c.x, c.y);
    if (hit && h.contains(hit)) out.push(hit);
    h.querySelectorAll('button,[role="button"],[data-dnd-handle],[draggable="true"]').forEach(b => out.push(b));
    out.push(h);
    return out.filter((x, i, a) => a.indexOf(x) === i);
  }
  async function viaKeys(el, steps, dir) {
    el.focus(); key(el, 'Space'); await sleep(180);
    for (let i = 0; i < steps; i++) { key(document.activeElement && document.activeElement !== document.body ? document.activeElement : el, dir); await sleep(150); }
    key(document.activeElement && document.activeElement !== document.body ? document.activeElement : el, 'Space'); await sleep(400);
  }
  async function viaDrag(el, target, kind, toLeft) {
    const P = kind === 'pointer';
    const a = center(el), b = center(target);
    const tx = b.x + (toLeft ? -b.w * 0.25 : b.w * 0.25), ty = b.y;
    const fire = (node, type, x, y, buttons) => {
      const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons };
      node.dispatchEvent(P ? new PointerEvent(type, Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, o)) : new MouseEvent(type, o));
    };
    fire(el, P ? 'pointerdown' : 'mousedown', a.x, a.y, 1);
    await sleep(40);
    fire(document, P ? 'pointermove' : 'mousemove', a.x + (toLeft ? -6 : 6), a.y + 1, 1);   // 끌기 시작 거리
    await sleep(goodWay === kind ? 60 : 280);                                              // 처음엔 길게 누르기 조건 대비, 된 방법이면 짧게
    const n = goodWay === kind ? 6 : 14;
    for (let i = 1; i <= n; i++) { fire(document, P ? 'pointermove' : 'mousemove', a.x + (tx - a.x) * i / n, a.y + (ty - a.y) * i / n, 1); await sleep(goodWay === kind ? 16 : 30); }
    await sleep(goodWay === kind ? 60 : 120);
    fire(document, P ? 'pointerup' : 'mouseup', tx, ty, 0);
    await sleep(goodWay === kind ? 280 : 450);
  }
  async function moveColumn(from, to) {
    const hs = headerCells(), h = hs[from], target = hs[to]; if (!h || !target) return false;
    const before = currentOrder().join(',');
    const changed = () => { const now = currentOrder().join(','); return now && now !== before; };
    const toLeft = to < from, steps = Math.abs(to - from), dir = toLeft ? 'ArrowLeft' : 'ArrowRight';
    const ways = ['keys', 'pointer', 'mouse'];
    if (goodWay) ways.sort((x, y) => (x === goodWay ? -1 : 0) - (y === goodWay ? -1 : 0));
    for (const w of ways) {
      for (const g of grips(h)) {
        if (w === 'keys') await viaKeys(g, steps, dir);
        else await viaDrag(g, headerCells()[to] || target, w, toLeft);
        if (changed()) { if (goodWay !== w) { goodWay = w; try { chrome.storage.local.set({ anno_move_way: w }); } catch (e) {} } return true; }
        try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); } catch (e) {}   // 반쯤 잡힌 상태 풀기
        await sleep(120);
      }
    }
    return false;
  }
  // ⚡ 한 번에 맞추기 — CRM 화면 프로그램 안의 '열 순서' 를 바로 바꾼다 (order-main.js, 페이지 쪽에서 실행)
  let _omReady = null;
  function _omInject() {
    if (_omReady) return _omReady;
    _omReady = new Promise(res => {
      try {
        const sc = document.createElement('script');
        sc.src = chrome.runtime.getURL('content/order-main.js');
        sc.onload = () => { sc.remove(); res(true); }; sc.onerror = () => res(false);
        (document.head || document.documentElement).appendChild(sc);
      } catch (e) { res(false); }
    });
    return _omReady;
  }
  async function fastOrder(target) {
    if (!(await _omInject())) return false;
    const cur = currentOrder();
    const perm = target.map(k => cur.indexOf(k));
    if (perm.some(i => i < 0)) return false;
    const reqId = 'o' + Date.now() + Math.random().toString(36).slice(2, 6);
    const res = await new Promise(r => {
      const on = ev => { if (ev.source === window && ev.data && ev.data.__sdhOrderRes === reqId) { window.removeEventListener('message', on); r(ev.data); } };
      window.addEventListener('message', on);
      window.postMessage({ __sdhOrder: 'apply', reqId, perm }, '*');
      setTimeout(() => { window.removeEventListener('message', on); r({ ok: false, why: 'timeout' }); }, 8000);
    });
    if (!res.ok) { console.info('[상담도우미] 한 번에 순서 맞추기 불가(' + res.why + ') — 하나씩 옮깁니다'); return false; }
    for (let i = 0; i < 15; i++) { await sleep(100); if (currentOrder().join(',') === target.join(',')) return true; }
    // 화면(보험 내용 줄)이 기대대로 바뀌지 않았으면 — 머리칸만 바뀌었을 수 있으니 원래대로 되돌리고 끌어 옮기기로
    window.postMessage({ __sdhOrder: 'revert', reqId }, '*');
    console.info('[상담도우미] 한 번에 맞추기 결과가 화면과 달라 되돌림 — 하나씩 옮깁니다');
    await sleep(300);
    return false;
  }

  // 한 보험(key)을 to 자리로 — 한 번 끌어 놓으면 한 칸 어긋나 떨어지거나, 표가 옆으로 넓어 목적지 칸이
  // 화면 밖이면 놓을 곳이 없어 실패한다. → 둘 다 보이게 옆으로 스크롤하고, 멀면 보이는 데까지 나눠 옮기고,
  // 옮긴 뒤 실제 자리를 다시 확인해 맞을 때까지 몇 번 더 한다.
  function _visibleIdx(hs) {
    const box = scrollBoxX(hs[0]); const br = box ? box.getBoundingClientRect() : { left: 0, right: innerWidth };
    return hs.map(h => { const r = h.getBoundingClientRect(); return r.left >= Math.max(0, br.left) - 2 && r.right <= Math.min(innerWidth, br.right) + 2; });
  }
  function scrollBoxX(el) {
    for (let p = el && el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|overlay)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 2) return p;
    }
    return null;
  }
  async function moveKeyTo(key, to) {
    for (let tries = 0; tries < 6; tries++) {
      const cur = currentOrder(), j = cur.indexOf(key);
      if (j < 0) return false;
      if (j === to) return true;
      let hs = headerCells();
      try { hs[to].scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
      await sleep(80);
      hs = headerCells();
      let vis = _visibleIdx(hs);
      if (!vis[j]) { try { hs[j].scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} await sleep(80); hs = headerCells(); vis = _visibleIdx(hs); }
      // 출발 칸과 목적지 칸이 함께 안 보이면 보이는 범위 끝까지만 먼저 옮김
      let t = to;
      if (!vis[t]) { const dir = to < j ? -1 : 1; t = j; while (t + dir >= 0 && t + dir < hs.length && vis[t + dir] && t !== to) t += dir; if (t === j) t = j + dir; }
      if (!(await moveColumn(j, t))) return false;
    }
    return currentOrder().indexOf(key) === to;
  }

  // 👥 계약자와 피보험자가 다른 보험 — '계약자/피보험자' 줄이 "홍길동/본인" 이면 같음, "홍길동/자녀"·"홍길동/김영희" 면 다름
  let diffLeft = true;
  try { chrome.storage.local.get(['anno_diff_left'], v => { diffLeft = !(v && v.anno_diff_left === false); }); } catch (e) {}
  function diffKeys() { return diffKeysIn(mainScan()); }
  function diffKeysIn(scan) {
    const { parsed, keys } = scan;
    const out = new Set();
    for (const pt of parsed) {
      const both = pt.rows.find(x => /^계약자\s*\/\s*피보험자$/.test(x.p.label.replace(/\s+/g, ' ').trim()));
      const ca = pt.rows.find(x => x.p.label.trim() === '계약자'), ia = pt.rows.find(x => x.p.label.trim() === '피보험자');
      if (both) {
        both.p.prod.forEach((c, i) => {
          const t = cellText(c).replace(/\s+/g, '');
          const m = t.match(/^([^/]*)\/(.*)$/); if (!m || !keys[i]) return;
          if (m[2] && m[2] !== '본인' && m[2] !== m[1]) out.add(keys[i]);
        });
        break;
      }
      if (ca && ia) {
        ca.p.prod.forEach((c, i) => { const a = cellText(c).trim(), b = cellText(ia.p.prod[i] || c).trim(); if (keys[i] && b && b !== '본인' && a !== b) out.add(keys[i]); });
        break;
      }
    }
    return out;
  }
  // 맞출 순서 = 기억한 순서(없으면 CRM 순서) → 계약자·피보험자가 다른 보험을 맨 왼쪽으로 (각 무리 안의 순서는 그대로)
  function desiredOrder(cur) {
    const want = Array.isArray(data.order) && data.order.length ? data.order : cur;
    let target = want.filter(k => cur.includes(k)).concat(cur.filter(k => !want.includes(k)));
    if (diffLeft) { const d = diffKeys(); if (d.size) target = target.filter(k => d.has(k)).concat(target.filter(k => !d.has(k))); }
    return target;
  }

  // 🙈 피보험자가 다른 사람인 보험 숨기기 — 그 보험의 세로줄 전체(머리칸 포함)를 화면에서만 감춤.
  //   본문 표와 미리보기 창(페인트프로·이미지 복사) 모두에 적용. CRM 데이터·순서는 그대로.
  let hideDiff = false, hiddenN = 0;
  try { chrome.storage.local.get(['anno_hide_diff'], v => { hideDiff = !!(v && v.anno_hide_diff); scheduleApply(); }); } catch (e) {}
  const HIDE = 'data-tce-hide';
  function hideCell(el) {
    if (!el || el.hasAttribute(HIDE)) return;
    el.setAttribute(HIDE, el.style.getPropertyValue('display') || '');
    el.style.setProperty('display', 'none', 'important');
  }
  function unhideAll() {
    document.querySelectorAll('[' + HIDE + ']').forEach(el => {
      const v = el.getAttribute(HIDE);
      if (v) el.style.setProperty('display', v); else el.style.removeProperty('display');
      el.removeAttribute(HIDE);
    });
  }
  function hideDiffCols(scan) {
    const n = scan.keys.length; if (!n) return 0;
    const d = diffKeysIn(scan); if (!d.size) return 0;
    const idx = scan.keys.map((k, i) => d.has(k) ? i : -1).filter(i => i >= 0);
    scan.parsed.forEach(pt => {
      Array.prototype.forEach.call(pt.t.querySelectorAll('tr'), tr => {
        if (tr.closest('table') !== pt.t) return;
        const cells = Array.prototype.filter.call(tr.children, c => c.tagName === 'TD' || c.tagName === 'TH');
        let prod = null;
        const p = parseRow(tr);
        if (p && p.prod.length === n) prod = p.prod;
        else {
          const so = cells.filter(c => c.getAttribute('aria-roledescription') === 'sortable');
          if (so.length === n) prod = so;
          else if (cells.length > n && cells.slice(-n).every(c => c.colSpan === 1)) prod = cells.slice(-n);
        }
        if (prod) idx.forEach(i => hideCell(prod[i]));
      });
      const cols = Array.prototype.filter.call(pt.t.querySelectorAll('col'), c => c.closest('table') === pt.t);
      if (cols.length > n) idx.forEach(i => hideCell(cols[cols.length - n + i]));
    });
    return idx.length;
  }

  async function replayOrder() {
    if (!enabled) return;
    let cur = currentOrder();
    if (!cur.length) return;
    if (!(Array.isArray(data.order) && data.order.length) && !(diffLeft && diffKeys().size)) return;
    // 저장된 순서에 있는 보험만 그 순서로, 새로 생긴 보험은 CRM 순서대로 뒤에 + 계약자≠피보험자 보험은 맨 왼쪽
    const target = desiredOrder(cur);
    if (target.join(',') === cur.join(',')) { lastOrderSig = cur.join(','); return; }
    replaying = true;
    let failed = false;
    try {
      if (await fastOrder(target)) { lastOrderSig = target.join(','); toast('⚡ 기억한 보험 순서로 바로 맞췄습니다'); return; }
      for (let pass = 0; pass < 2 && !failed && currentOrder().join(',') !== target.join(','); pass++) {
        for (let i = 0; i < target.length; i++) {
          cur = currentOrder();
          const j = cur.indexOf(target[i]);
          if (j < 0 || j === i) continue;
          if (!(await moveKeyTo(target[i], i))) { failed = true; break; }
        }
      }
      if (failed) toast('⚠ 기억한 보험 순서를 맞추지 못했습니다 — CRM 순서 그대로 둡니다');
    } finally { lastOrderSig = currentOrder().join(','); replaying = false; }
    if (lastOrderSig === target.join(',')) toast('↔ 기억한 보험 순서로 맞췄습니다');
  }
  async function watchOrder() {
    if (replaying || !enabled || !cid || !orderReady) return;
    const cur = currentOrder(), sig = cur.join(',');
    if (!sig || sig === lastOrderSig) return;
    const prev = lastOrderSig ? lastOrderSig.split(',') : [];
    if (!lastOrderSig || !sameSet(cur, prev)) {   // 보험이 늘거나 줄면(표가 마저 그려짐) 기준을 새로 잡고, 기억한 순서와 다르면 다시 맞춤
      lastOrderSig = sig;
      if (autoFixes < 3) {
        const target = desiredOrder(cur);
        if (target.join(',') !== sig) { autoFixes++; replayOrder(); }
      }
      return;
    }
    if (Date.now() - userTouchAt > 6000) {
      // 사용자가 옮긴 게 아님 = CRM이 화면을 새로 그리며 원래 순서로 되돌림 → 기억한 순서로 다시 맞춤
      lastOrderSig = sig;
      if (autoFixes < 3 && desiredOrder(cur).join(',') !== sig) { autoFixes++; replayOrder(); }
      return;
    }
    lastOrderSig = sig;
    snapshot();
    data.order = sig.split(',');
    await saveCustomer();
    toast('↔ 바꾼 보험 순서를 기억했습니다 (다음에 열어도 이 순서)');
    renderBar();
  }

  // ── 도구 막대 ─────────────────────────────────────
  let barHost = null, barRoot = null, toastTimer = null;
  function ensureBar() {
    if (barHost && document.documentElement.contains(barHost)) return;
    barHost = document.createElement('div');
    barHost.setAttribute('data-tce-ui', '');
    barRoot = barHost.attachShadow({ mode: 'closed' });
    document.documentElement.appendChild(barHost);
  }
  function toast(msg) {
    if (!barRoot) return;
    const t = barRoot.querySelector('.t'); if (!t) return;
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'none';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-4px)'; }, 3500);
  }
  let barOpen = false;
  // ═══════════════════════════════════════════════════════════════
  // 🔢 보험 번호표 — 상품명 위에 1·2·3… 번호를 띄우고, 번호를 눌러 바꾸면 그 자리로 옮긴다
  //   번호표는 표 바깥의 확장 전용 층에 그려서 CRM 화면·이미지에는 들어가지 않는다.
  //   미리보기 창이 떠 있거나(이미지 복사·페인트프로) 페인트프로가 찍는 중이면 숨긴다.
  // ═══════════════════════════════════════════════════════════════
  let numsOn = true, numHost = null, numRoot = null, numEdit = -1, numBusy = false;
  try { chrome.storage.local.get(['anno_nums'], v => { numsOn = !(v && v.anno_nums === false); drawNums(); }); } catch (e) {}
  function ensureNumHost() {
    if (numHost && document.documentElement.contains(numHost)) return;
    numHost = document.createElement('div');
    numHost.setAttribute('data-tce-ui', '');
    numHost.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483644;pointer-events:none;';
    numRoot = numHost.attachShadow({ mode: 'closed' });
    document.documentElement.appendChild(numHost);
  }
  function numsHidden() {
    return !enabled || !numsOn || !cid || !orderReady || false ||
      document.documentElement.hasAttribute('data-sdh-capturing') || !!document.querySelector('[role="dialog"]');
  }
  // 번호표 자리 — 칸 위(자리가 없으면 칸 왼쪽 위 구석)
  // 표를 품고 스크롤되는 상자(없으면 페이지 자체) — 번호표는 그 상자의 보이는 맨 위에 붙어 따라온다
  function scrollBox(el) {
    for (let p = el && el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|overlay)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 2) return p;
    }
    return null;
  }
  function numPos(r, visTop) {
    // ① 칸 위에 자리가 있으면 칸 바로 위 가운데
    if (r.top - 32 >= visTop + 6) return { top: r.top - 32, left: r.left + r.width / 2 };
    // ② 머리칸이 아직 보이는데 위에 자리가 없으면 칸 왼쪽 위 구석 — 가운데를 가리면 CRM 에서 끌어 옮기기가 막힌다
    if (r.bottom > visTop + 34) return { top: Math.max(visTop + 2, r.top + 2), left: r.left + 18 };
    // ③ 머리칸이 위로 지나갔으면 보이는 영역 맨 위에 떠서 따라온다
    return { top: visTop + 6, left: r.left + r.width / 2 };
  }
  // 화면을 그리는 매 순간(스크롤·창 크기·CRM 화면 움직임) 머리칸을 따라 번호표 자리를 옮긴다
  function placeNums() {
    if (!numRoot || !numRoot.__cells) return;
    const hs = numRoot.__cells;
    const sb = numRoot.__box && numRoot.__box.isConnected ? numRoot.__box : null;
    const visTop = sb ? Math.max(0, sb.getBoundingClientRect().top) : 0;
    // 보장분석 표들(보장·특약 등 여러 개일 수 있음) 중 가장 아래 끝 — 이게 보이는 동안 번호표를 띄워 둔다
    let bottom = -1;
    (numRoot.__tables || []).forEach(t => { if (t.isConnected) bottom = Math.max(bottom, t.getBoundingClientRect().bottom); });
    if (bottom < 0 && hs[0] && hs[0].isConnected) bottom = (hs[0].closest('table') || hs[0]).getBoundingClientRect().bottom;
    numRoot.querySelectorAll('[data-i]').forEach(el => {
      const h = hs[Number(el.dataset.i)];
      if (!h || !h.isConnected) { el.style.display = 'none'; return; }
      const r = h.getBoundingClientRect();
      if (r.width < 4 || bottom < visTop + 44 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) { el.style.display = 'none'; return; }
      const p = numPos(r, visTop);
      el.style.display = '';
      el.style.left = p.left + 'px';
      el.style.top = p.top + 'px';
    });
  }
  (function follow() { try { placeNums(); if (edBox && edBox.__place) edBox.__place(); } catch (e) {} requestAnimationFrame(follow); })();
  function drawNums() {
    const hs = onCover() ? headerCells() : [];
    if (numsHidden() || hs.length < 2) { if (numRoot) { numRoot.innerHTML = ''; numRoot.__sig = ''; numRoot.__cells = null; } return; }
    ensureNumHost();
    numRoot.__cells = hs;
    numRoot.__box = scrollBox(hs[0].closest('table') || hs[0]);
    try { numRoot.__tables = mainScan().parsed.map(pt => pt.t); } catch (e) { numRoot.__tables = []; }
    // 번호표를 새로 만드는 건 칸 수·고치는 중·옮기는 중이 바뀔 때만 (스크롤 중 다시 만들면 입력칸이 사라짐)
    const sig = hs.length + '#' + numEdit + '#' + (numBusy ? 1 : 0);
    if (numRoot.__sig === sig) { placeNums(); return; }
    numRoot.__sig = sig;
    numRoot.innerHTML = `<style>
      .b{position:fixed;pointer-events:auto;min-width:30px;height:30px;padding:0 8px;box-sizing:border-box;border-radius:99px;border:0;
        background:#4F46E5;color:#fff;font:800 16px/30px -apple-system,"Malgun Gothic",sans-serif;text-align:center;cursor:pointer;
        box-shadow:0 2px 6px rgba(79,70,229,.35);transform:translateX(-50%);user-select:none}
      .b:hover{background:#4338CA}
      .b.busy{background:#94A3B8;cursor:wait}
      .b.ed{background:#fff;color:#4F46E5;box-shadow:0 0 0 3px #4F46E5,0 4px 12px rgba(15,23,42,.2);cursor:text;outline:none;min-width:40px}
    </style>` + hs.map((h, i) => i === numEdit
      ? `<span class="b ed" data-i="${i}" contenteditable="true" spellcheck="false" title="옮길 번호를 쓰고 Enter (Esc 취소)">${i + 1}</span>`
      : `<button class="b${numBusy ? ' busy' : ''}" data-i="${i}" title="번호를 눌러 바꾸면 그 자리로 옮깁니다">${i + 1}</button>`).join('');
    placeNums();
    numRoot.querySelectorAll('button.b').forEach(b => b.addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      if (numBusy) return;
      numEdit = Number(b.dataset.i); numRoot.__sig = ''; drawNums();
      const ed = numRoot.querySelector('.ed');
      if (ed) { ed.focus(); try { const rg = document.createRange(); rg.selectNodeContents(ed); const sel = numRoot.getSelection ? numRoot.getSelection() : window.getSelection(); sel.removeAllRanges(); sel.addRange(rg); } catch (e) {} }
    }));
    const inp = numRoot.querySelector('.ed');
    if (inp) {
      const n = hs.length;
      inp.addEventListener('input', () => { const v = inp.textContent.replace(/\D/g, '').slice(0, 2); if (v !== inp.textContent) { inp.textContent = v; } });
      const done = go => {
        const from = Number(inp.dataset.i), to = Math.max(1, Math.min(n, parseInt(inp.textContent, 10) || from + 1)) - 1;
        numEdit = -1; numRoot.__sig = ''; drawNums();
        if (go && to !== from) moveByNumber(from, to);
      };
      inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); done(true); } else if (ev.key === 'Escape') done(false); });
      inp.addEventListener('blur', () => { if (numEdit >= 0) done(true); });
    }
  }
  async function moveByNumber(from, to) {
    const cur = currentOrder();
    if (!cur.length) { toast('⚠ 표가 아직 다 그려지지 않았거나 보험을 구분할 수 없어 옮기지 못했습니다 — 잠시 뒤 다시 해 주세요'); return; }
    const target = cur.slice(); const [k] = target.splice(from, 1); target.splice(to, 0, k);
    numBusy = true; replaying = true; numRoot && (numRoot.__sig = ''); drawNums();
    let ok = false;
    try {
      ok = await fastOrder(target);
      if (!ok) { await moveKeyTo(k, to); ok = currentOrder().indexOf(k) === to; }
    } finally { replaying = false; numBusy = false; }
    const now = currentOrder();
    lastOrderSig = now.join(',');
    if (ok) {
      snapshot();
      data.order = now;
      await saveCustomer();
      toast(`🔢 ${from + 1}번 보험을 ${to + 1}번 자리로 옮기고 기억했습니다`);
      renderBar();
    } else toast('⚠ 이 자리로 옮기지 못했습니다 — CRM에서 직접 끌어 옮겨 주세요');
    numRoot && (numRoot.__sig = ''); drawNums();
  }
  setInterval(drawNums, 300);
  window.addEventListener('scroll', () => drawNums(), true);
  window.addEventListener('resize', () => drawNums());

  function renderBar() {
    if (!onCover()) { if (barHost) barHost.remove(); barHost = null; return; }
    ensureBar();
    const ordered = Array.isArray(data.order) && data.order.length;
    const fabLabel = !enabled ? '표시 꺼짐' : mode === 'hl' ? '형광펜 사용 중' : mode === 'edit' ? '글자 수정 중' : '표시 도구';
    const fabIcon = !enabled ? '⏻' : mode === 'edit' ? '✏️' : '🖍';
    barRoot.innerHTML = `<style>
      :host{all:initial}
      *{box-sizing:border-box}
      .w{position:fixed;right:18px;top:118px;z-index:2147483645;font:13px/1.45 "Pretendard",-apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;color:#1F2330;display:flex;flex-direction:column;align-items:flex-end;gap:8px;-webkit-font-smoothing:antialiased}
      button{font:inherit;cursor:pointer}
      .fab{display:flex;align-items:center;gap:8px;border:0;border-radius:99px;padding:8px 16px 8px 10px;font-weight:700;font-size:13.5px;
        background:rgba(255,255,255,.92);backdrop-filter:blur(10px);color:#3730A3;box-shadow:0 1px 2px rgba(17,24,39,.06),0 8px 24px rgba(17,24,39,.14),inset 0 0 0 1px rgba(79,70,229,.18);transition:transform .15s,box-shadow .15s}
      .fab:hover{transform:translateY(-1px);box-shadow:0 2px 4px rgba(17,24,39,.08),0 12px 28px rgba(17,24,39,.18),inset 0 0 0 1px rgba(79,70,229,.3)}
      .fab i{font-style:normal;display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#6366F1,#8B5CF6);color:#fff;font-size:13px;box-shadow:0 3px 8px rgba(99,102,241,.4)}
      .fab.on{background:linear-gradient(135deg,#6366F1,#7C3AED);color:#fff;box-shadow:0 8px 22px rgba(99,102,241,.45)}
      .fab.on i{background:rgba(255,255,255,.22);box-shadow:none}
      .fab.off{color:#9CA3AF}.fab.off i{background:#E5E7EB;color:#6B7280;box-shadow:none}
      .p{width:300px;max-height:calc(100vh - 186px);overflow:auto;background:rgba(255,255,255,.96);backdrop-filter:blur(14px);border-radius:18px;
        box-shadow:0 1px 2px rgba(17,24,39,.05),0 18px 48px rgba(17,24,39,.2),inset 0 0 0 1px rgba(17,24,39,.06);padding:14px;display:flex;flex-direction:column;gap:12px;animation:pin .16s ease}
      @keyframes pin{from{opacity:0;transform:translateY(-6px) scale(.98)}to{opacity:1;transform:none}}
      .p::-webkit-scrollbar{width:8px}.p::-webkit-scrollbar-thumb{background:#E2E4EC;border-radius:8px}
      .sec{display:flex;flex-direction:column;gap:7px}
      .lab{font-size:11.5px;font-weight:700;color:#8A90A2;letter-spacing:.2px;display:flex;align-items:center;gap:6px}
      .lab b{color:#059669;font-weight:700;background:#ECFDF5;border-radius:99px;padding:0 7px}
      .seg{display:flex;background:#F1F2F7;border-radius:12px;padding:3px;gap:2px}
      .seg button{flex:1;border:0;background:transparent;border-radius:9px;padding:7px 6px;font-weight:600;color:#4B5163;font-size:12.5px;transition:background .12s,color .12s}
      .seg button:hover{color:#1F2330}
      .seg button.sel{background:#fff;color:#4F46E5;font-weight:800;box-shadow:0 1px 2px rgba(17,24,39,.08),0 2px 8px rgba(17,24,39,.06)}
      .r{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
      .chip{border:0;border-radius:10px;padding:7px 11px;font-size:12.5px;font-weight:600;color:#374151;background:#F4F5F9;box-shadow:inset 0 0 0 1px #E6E8EF;transition:background .12s,color .12s,box-shadow .12s}
      .chip:hover{background:#EEF0FF;color:#4F46E5;box-shadow:inset 0 0 0 1px #D9DCFF}
      .chip.sel{background:#EEF0FF;color:#4338CA;font-weight:800;box-shadow:inset 0 0 0 1.5px #818CF8}
      .chip:disabled{opacity:.45;cursor:default;background:#F4F5F9;color:#9CA3AF;box-shadow:inset 0 0 0 1px #E6E8EF}
      .tg{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;border:0;background:#F7F8FB;border-radius:12px;padding:9px 12px;font-size:13px;font-weight:600;color:#1F2330;box-shadow:inset 0 0 0 1px #ECEEF3;text-align:left}
      .tg:hover{background:#F1F2F7}
      .tg s{text-decoration:none;flex:none;width:36px;height:21px;border-radius:99px;background:#D1D5DB;position:relative;transition:background .15s}
      .tg s::after{content:"";position:absolute;top:2.5px;left:2.5px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:left .15s}
      .tg.sel s{background:linear-gradient(135deg,#6366F1,#8B5CF6)}.tg.sel s::after{left:17.5px}
      .tg small{display:block;font-size:11px;color:#8A90A2;font-weight:500;margin-top:1px}
      .sw{width:28px;height:28px;border-radius:50%;padding:0;border:0;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08);transition:transform .12s,box-shadow .12s}
      .sw:hover{transform:scale(1.08)}
      .sw.sel{box-shadow:0 0 0 2px #fff,0 0 0 4px #6366F1}
      .hint{font-size:12px;color:#4B5163;line-height:1.6;background:linear-gradient(180deg,#F7F7FF,#F3F4FB);border-radius:12px;padding:9px 11px;box-shadow:inset 0 0 0 1px #E8E9F7}
      .hr{height:1px;background:#EEF0F4;margin:0 -2px}
      .dz .chip{color:#B42318;background:#FEF3F2;box-shadow:inset 0 0 0 1px #FDE1DE}.dz .chip:hover{background:#FEE4E2;color:#912018}
      .pw{border:0;width:100%;border-radius:12px;padding:9px;font-weight:700;font-size:12.5px;color:#6B7280;background:transparent;box-shadow:inset 0 0 0 1px #ECEEF3}
      .pw:hover{color:#B42318;background:#FEF3F2;box-shadow:inset 0 0 0 1px #FDE1DE}
      .pw.on{color:#fff;background:linear-gradient(135deg,#6366F1,#8B5CF6);box-shadow:0 6px 16px rgba(99,102,241,.35)}
      .t{font-size:12.5px;font-weight:600;background:rgba(31,35,48,.94);backdrop-filter:blur(8px);color:#fff;border-radius:12px;padding:8px 13px;opacity:0;transform:translateY(-4px);transition:opacity .25s,transform .25s;max-width:320px;box-shadow:0 10px 28px rgba(17,24,39,.3);pointer-events:none}
    </style>
      <div class="w">
        <button class="fab ${mode ? 'on' : ''} ${!enabled ? 'off' : ''}" data-a="toggle"><i>${fabIcon}</i>${fabLabel}</button>
        ${barOpen ? `<div class="p">
          ${enabled ? `
          <div class="sec"><span class="lab">모드 · 켜진 동안 표를 누르면 표시가 됩니다</span>
            <div class="seg"><button data-a="mode-off" class="${!mode ? 'sel' : ''}">👀 보기</button><button data-a="mode-hl" class="${mode === 'hl' ? 'sel' : ''}">🖍 형광펜</button><button data-a="mode-edit" class="${mode === 'edit' ? 'sel' : ''}">✏️ 글자 수정</button></div></div>
          ${mode === 'hl' ? `
          <div class="sec"><span class="lab">색</span>
            <div class="r">${COLORS.map(c => `<button class="sw ${curColor === c.k ? 'sel' : ''}" data-a="c-${c.k}" title="${c.name}" style="background:${c.bg}"></button>`).join('')}
              <button data-a="c-x" class="chip ${curColor === 'x' ? 'sel' : ''}" title="누른 칸의 형광펜 지우기">🧽 지우개</button></div></div>
          <div class="sec"><span class="lab">적용 범위</span>
            <div class="seg"><button data-a="s-one" class="${scope === 'one' ? 'sel' : ''}">이 고객만</button><button data-a="s-all" class="${scope === 'all' ? 'sel' : ''}">모든 고객 (줄 단위)</button></div></div>
          <div class="hint">칸을 누르면 그 칸, 줄 이름(예: 질병입원의료비)을 누르면 그 줄 전체가 칠해집니다. 같은 색으로 다시 누르면 지워집니다.${scope === 'all' ? '<br><b>모든 고객</b> — 누른 줄이 모든 고객 화면에서 칠해집니다.' : ''}</div>` : ''}
          ${mode === 'edit' ? `<div class="hint">고칠 칸을 누르고 바로 입력하세요. <b>Enter</b> 저장 · <b>Esc</b> 취소. 금액(예: 3000만원)은 CRM과 같은 모양으로, 글자색·비우기·원래 글자는 칸 아래 도구 줄에서. 화면에서만 바뀌고 CRM 데이터는 그대로이며, 마우스를 올리면 원래 글자가 보입니다.</div>` : ''}
          <div class="hr"></div>
          <div class="sec"><span class="lab">보험 순서 ${ordered ? '<b>기억됨</b>' : ''}</span>
            <button class="tg ${numsOn ? 'sel' : ''}" data-a="nums"><span>🔢 번호표 보이기<small>번호를 눌러 바꾸면 그 자리로 옮깁니다</small></span><s></s></button>
            <button class="tg ${diffLeft ? 'sel' : ''}" data-a="diffleft" title="모든 고객에 적용"><span>👥 계약자≠피보험자 맨 왼쪽<small>모든 고객에 적용</small></span><s></s></button>
            <button class="tg ${hideDiff ? 'sel' : ''}" data-a="hidediff" title="모든 고객에 적용"><span>🙈 피보험자가 다른 보험 숨기기<small>화면·페인트프로·이미지에서 빠짐 (모든 고객)${hideDiff && hiddenN ? ' · ' + hiddenN + '개 숨김' : ''}</small></span><s></s></button>
            ${ordered ? '<div class="r"><button class="chip" data-a="order-reset">↺ CRM 원래 순서로</button></div>' : ''}</div>
          <div class="hr"></div>
          <div class="sec"><span class="lab">되돌리기 · 지우기 (이 고객)</span>
            <div class="r"><button class="chip" data-a="undo" ${undo.length ? '' : 'disabled'} title="Ctrl+Z">↶ 되돌리기${undo.length ? ' ' + undo.length : ''}</button><button class="chip" data-a="redo" ${redo.length ? '' : 'disabled'} title="Ctrl+Shift+Z">↷ 다시 실행${redo.length ? ' ' + redo.length : ''}</button></div>
            <div class="r dz"><button class="chip" data-a="clr-hl">형광펜 지우기</button><button class="chip" data-a="clr-ed">글자 원래대로</button><button class="chip" data-a="clr-all">전부</button></div>
            ${rules.length ? `<div class="r dz"><button class="chip" data-a="clr-rules">모든 고객 규칙 ${rules.length}개 지우기</button></div>` : ''}</div>
          <button class="pw" data-a="disable">⏻ 표시 기능 끄기</button>
          ` : `<div class="hint">표시 기능이 꺼져 있어 CRM 원래 화면입니다. 켜면 저장해 둔 형광펜·글자·순서가 다시 적용됩니다.</div>
          <button class="pw on" data-a="enable">⏻ 표시 기능 켜기</button>`}
        </div>` : ''}
        <div class="t"></div>
      </div>`;
    barRoot.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', onBar));
  }
  async function onBar(e) {
    const a = e.currentTarget.dataset.a;
    if (a === 'toggle') { barOpen = !barOpen; renderBar(); return; }
    if (a === 'diffleft') { diffLeft = !diffLeft; try { chrome.storage.local.set({ anno_diff_left: diffLeft }); } catch (x) {} renderBar(); if (diffLeft) { autoFixes = 0; replayOrder(); } return; }
    if (a === 'hidediff') { hideDiff = !hideDiff; try { chrome.storage.local.set({ anno_hide_diff: hideDiff }); } catch (x) {} applyAll(); renderBar(); toast(hideDiff ? (hiddenN ? `🙈 피보험자가 다른 보험 ${hiddenN}개를 숨겼습니다` : '이 고객은 피보험자가 다른 보험이 없습니다') : '👁 숨긴 보험을 다시 보입니다'); return; }
    if (a === 'nums') { numsOn = !numsOn; try { chrome.storage.local.set({ anno_nums: numsOn }); } catch (x) {} numRoot && (numRoot.__sig = ''); drawNums(); renderBar(); return; }
    if (a === 'mode-hl') mode = 'hl';
    else if (a === 'mode-edit') mode = 'edit';
    else if (a === 'mode-off') { mode = ''; closeEditor(); }
    else if (a.startsWith('c-')) curColor = a.slice(2);
    else if (a === 's-one') scope = 'one';
    else if (a === 's-all') scope = 'all';
    else if (a === 'undo') return doUndo();
    else if (a === 'redo') return doRedo();
    else if (a === 'order-reset') {
      if (!confirmBox('기억한 보험 순서를 지우고 원래 순서로 돌아갈까요? (페이지를 새로 불러옵니다)')) return;
      snapshot(); data.order = null; await saveCustomer(); location.reload(); return;
    }
    else if (a === 'clr-hl' || a === 'clr-ed' || a === 'clr-all') {
      const what = a === 'clr-hl' ? '이 고객의 형광펜을 모두' : a === 'clr-ed' ? '이 고객의 고친 글자를 모두 원래대로' : '이 고객의 형광펜·고친 글자·기억한 순서를 모두';
      if (!confirmBox(what + ' 지울까요? (↶ 되돌리기로 다시 살릴 수 있습니다)')) return;
      snapshot();
      if (a !== 'clr-ed') data.hl = [];
      if (a !== 'clr-hl') data.edits = [];
      if (a === 'clr-all') data.order = null;
      await saveCustomer(); applyAll(); toast('원래대로 했습니다 (↶ 로 되돌릴 수 있음)');
    }
    else if (a === 'clr-rules') {
      if (!confirmBox('모든 고객에 적용되는 형광펜 규칙 ' + rules.length + '개를 지울까요? (↶ 되돌리기 가능)')) return;
      snapshot(); rules = []; saveRules(); applyAll();
    }
    else if (a === 'disable') { mode = ''; closeEditor(); await setEnabled(false); return; }
    else if (a === 'enable') { await setEnabled(true); return; }
    renderBar();
  }
  // 페이지 안 확인 창 — CRM 페이지의 confirm 대신 우리 막대 안에서 (확장 규칙: confirm/alert 금지)
  let pendingConfirm = null;
  function confirmBox(msg) {
    // 같은 버튼을 3초 안에 한 번 더 누르면 실행 (실수 방지)
    if (pendingConfirm && pendingConfirm.msg === msg && Date.now() - pendingConfirm.at < 3000) { pendingConfirm = null; return true; }
    pendingConfirm = { msg, at: Date.now() };
    toast('⚠ ' + msg + ' — 실행하려면 같은 버튼을 한 번 더 누르세요');
    return false;
  }
  async function setEnabled(on) {
    enabled = on;
    try { chrome.storage.local.set({ anno_enabled: on }); } catch (e) {}
    applyAll(); renderBar();
    if (on) replayOrder();
    toast(on ? '표시 기능을 켰습니다' : '표시 기능을 껐습니다 — 원래 화면');
  }

  // ── 페이지 감시 (CRM은 화면을 자주 다시 그린다 / 고객을 옮겨 다녀도 주소만 바뀜) ──
  const onCover = () => /\/crm-v2\/cover\/\d+/.test(location.pathname);
  const cidOf = () => { const m = location.pathname.match(/\/crm-v2\/cover\/(\d+)/); return m ? m[1] : ''; };
  let applyTimer = null;
  function scheduleApply() {
    if (applying) return;
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => { applyAll(); watchOrder(); }, 180);
  }
  async function onRoute() {
    const now = onCover() ? cidOf() : '';
    if (now === cid) return;
    cid = now; mode = mode === 'hl' ? 'hl' : 'edit'; undo.length = 0; redo.length = 0; lastOrderSig = ''; orderReady = false; autoFixes = 0; closeEditor();
    unpaintAll(); restoreEdits();
    if (!cid) { renderBar(); return; }
    await loadAll();
    renderBar();
    // 표가 다 그려질 때까지(최대 45초) 기다렸다가 기억한 순서로 맞추고 표시
    const myCid = cid;
    await waitStable(45000);
    if (cid !== myCid) return;
    await replayOrder();
    lastOrderSig = currentOrder().join(',');
    orderReady = true;
    applyAll();
  }

  document.addEventListener('click', onClick, true);
  ['pointerdown', 'keydown', 'dragstart'].forEach(t => document.addEventListener(t, ev => {
    if (replaying || !ev.isTrusted) return;
    const h = ev.target && ev.target.closest && ev.target.closest('[aria-roledescription="sortable"]');
    if (h) userTouchAt = Date.now();
  }, true));
  ['pointermove', 'pointerup'].forEach(t => document.addEventListener(t, () => { if (userTouchAt && Date.now() - userTouchAt < 6000) userTouchAt = Date.now(); }, true));
  ['pointerdown', 'mousedown', 'keydown'].forEach(t => document.addEventListener(t, ev => {
    if (t === 'keydown') {
      if (!enabled || !cid || edBox || !(ev.ctrlKey || ev.metaKey) || ev.altKey || !ev.key) return;
      // CRM 입력칸(메모 등)에서 쓰는 Ctrl+Z 는 그대로 둔다
      const tg = ev.composedPath ? ev.composedPath()[0] : ev.target;
      if (tg && tg.nodeType === 1 && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
      const k = ev.key.toLowerCase();
      if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); ev.stopPropagation(); doUndo(); }
      else if ((k === 'z' && ev.shiftKey) || (k === 'y' && !ev.shiftKey)) { ev.preventDefault(); ev.stopPropagation(); doRedo(); }
      return;
    }
    swallow(ev);
  }, true));
  new MutationObserver(muts => {
    if (applying) return;
    const ours = n => n.nodeType === 1 && (n.hasAttribute('data-tce-hl') || n.hasAttribute('data-tce-ui') || n.hasAttribute('data-tce-unit'));
    if (muts.every(m => (m.target && m.target.closest && m.target.closest('[data-tce-ui],[data-tce-hl]')) ||
      (m.type === 'childList' && Array.prototype.every.call(m.addedNodes, ours) && Array.prototype.every.call(m.removedNodes, ours)))) return;
    scheduleApply();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });   // CRM이 글자만 바꿔도 다시 입힘
  setInterval(onRoute, 700);
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      if (ch.anno_enabled) { enabled = ch.anno_enabled.newValue !== false; if (!enabled) mode = ''; applyAll(); renderBar(); }
      if (ch.anno_rules) { rules = ch.anno_rules.newValue || []; applyAll(); }
    });
  } catch (e) {}
  onRoute();
})();
