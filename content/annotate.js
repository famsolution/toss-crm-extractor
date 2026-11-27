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
  let mode = '';                      // '' | 'hl' | 'edit'
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
  function snapshot() { undo.push(JSON.stringify({ data, rules })); if (undo.length > 50) undo.shift(); renderBar(); }
  async function doUndo() {
    const s = undo.pop(); if (!s) return;
    const o = JSON.parse(s); data = o.data; rules = o.rules;
    await saveCustomer(); saveRules(); applyAll(); renderBar(); toast('↶ 되돌렸습니다');
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
    document.querySelectorAll('[data-tce-ed]').forEach(el => { el.removeAttribute('data-tce-ed'); el.removeAttribute('title'); el.style.removeProperty('outline'); });
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
  function setCellText(cell, text) {
    let list = editedNodes.get(cell);
    if (!list) { list = textNodes(cell).map(n => ({ node: n, orig: n.nodeValue })); if (!list.length) return; editedNodes.set(cell, list); }
    list.forEach((x, i) => { x.node.nodeValue = i === 0 ? text : ''; });
    cell.setAttribute('data-tce-ed', '1');
    cell.title = '✏️ 고친 글자 — 원래: ' + list.map(x => x.orig).join('').trim();
    cell.style.setProperty('outline', '1.5px dashed rgba(37, 99, 235, 0.55)');
    cell.style.setProperty('outline-offset', '-2px');
  }

  function applyAll() {
    if (applying) return;
    applying = true;
    try {
      unpaintAll(); restoreEdits();
      if (!enabled || !cid) return;
      roots().forEach(root => {
        const { parsed, keys } = scanRoot(root);
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
              if (ed) setCellText(c, ed.text);
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
  function onClick(e) {
    if (!enabled || !mode || !cid) return;
    if (e.composedPath && e.composedPath().includes(barHost)) return;
    const cell = e.target.closest && e.target.closest('td,th');
    if (!cell || !cell.closest('table')) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const loc = locate(cell); if (!loc || !loc.row) return;
    if (mode === 'hl') toggleHighlight(loc);
    else if (mode === 'edit' && !loc.isLabel) openEditor(cell, loc);
  }
  function swallow(e) {
    if (!enabled || !mode) return;
    if (e.composedPath && e.composedPath().includes(barHost)) return;
    const cell = e.target.closest && e.target.closest('td,th');
    if (cell && cell.closest('table')) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
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
  function openEditor(cell, loc) {
    closeEditor();
    const r = cell.getBoundingClientRect();
    const cur = (cell.textContent || '').trim();
    const orig = originalText(cell);
    edBox = document.createElement('div');
    edBox.setAttribute('data-tce-ui', '');
    const sr = edBox.attachShadow({ mode: 'closed' });
    sr.innerHTML = `<style>
      .b{position:fixed;z-index:2147483646;background:#fff;border:1.5px solid #2563EB;border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.2);padding:8px;display:flex;flex-direction:column;gap:6px;font:12px -apple-system,"Malgun Gothic",sans-serif;min-width:220px}
      input{padding:6px 8px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px}
      .a{display:flex;gap:6px;justify-content:flex-end}.o{color:#64748B;font-size:11px}
      button{padding:4px 10px;border-radius:6px;border:1px solid #CBD5E1;background:#fff;cursor:pointer;font-size:12px}
      .p{background:#2563EB;color:#fff;border-color:#2563EB}</style>
      <div class="b"><input><div class="o"></div><div class="a"><button class="r">원래 글자로</button><button class="c">취소</button><button class="p">저장</button></div></div>`;
    const box = sr.querySelector('.b'), inp = sr.querySelector('input');
    box.style.left = Math.max(8, Math.min(window.innerWidth - 240, r.left)) + 'px';
    box.style.top = Math.min(window.innerHeight - 110, r.bottom + 4) + 'px';
    inp.value = cur;
    sr.querySelector('.o').textContent = '원래: ' + orig;
    const save = async (text) => {
      snapshot();
      const i = data.edits.findIndex(x => x.sec === loc.sec && x.row === loc.row && x.col === loc.col);
      if (text == null || text.trim() === '' || text.trim() === orig) { if (i >= 0) data.edits.splice(i, 1); }
      else if (i >= 0) data.edits[i].text = text.trim(); else data.edits.push({ sec: loc.sec, row: loc.row, col: loc.col, text: text.trim() });
      await saveCustomer(); closeEditor(); applyAll();
    };
    sr.querySelector('.p').addEventListener('click', () => save(inp.value));
    sr.querySelector('.r').addEventListener('click', () => save(null));
    sr.querySelector('.c').addEventListener('click', closeEditor);
    inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') save(inp.value); if (ev.key === 'Escape') closeEditor(); });
    document.documentElement.appendChild(edBox);
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  }
  function closeEditor() { if (edBox) { edBox.remove(); edBox = null; } }

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
      setTimeout(() => { window.removeEventListener('message', on); r({ ok: false, why: 'timeout' }); }, 1500);
    });
    if (!res.ok) { console.info('[상담도우미] 한 번에 순서 맞추기 불가(' + res.why + ') — 하나씩 옮깁니다'); return false; }
    for (let i = 0; i < 15; i++) { await sleep(100); if (currentOrder().join(',') === target.join(',')) return true; }
    return false;
  }

  async function replayOrder() {
    const want = data.order;
    if (!enabled || !Array.isArray(want) || !want.length) return;
    let cur = currentOrder();
    if (!cur.length) return;
    // 저장된 순서에 있는 보험만 그 순서로, 새로 생긴 보험은 CRM 순서대로 뒤에
    const target = want.filter(k => cur.includes(k)).concat(cur.filter(k => !want.includes(k)));
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
          if (!(await moveColumn(j, i))) { failed = true; break; }
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
      if (Array.isArray(data.order) && data.order.length && autoFixes < 3) {
        const target = data.order.filter(k => cur.includes(k)).concat(cur.filter(k => !data.order.includes(k)));
        if (target.join(',') !== sig) { autoFixes++; replayOrder(); }
      }
      return;
    }
    if (Date.now() - userTouchAt > 6000) {
      // 사용자가 옮긴 게 아님 = CRM이 화면을 새로 그리며 원래 순서로 되돌림 → 기억한 순서로 다시 맞춤
      lastOrderSig = sig;
      if (Array.isArray(data.order) && data.order.length && autoFixes < 3) { autoFixes++; replayOrder(); }
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
    t.textContent = msg; t.style.opacity = '1';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 3500);
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
  function drawNums() {
    const hs = onCover() ? headerCells() : [];
    if (numsHidden() || hs.length < 2) { if (numRoot) { numRoot.innerHTML = ''; numRoot.__sig = ''; } return; }
    ensureNumHost();
    const rects = hs.map(h => h.getBoundingClientRect());
    const sig = rects.map(r => [r.left, r.top, r.width].map(Math.round).join(':')).join('|') + '#' + numEdit + '#' + (numBusy ? 1 : 0);
    if (numRoot.__sig === sig) return;
    numRoot.__sig = sig;
    numRoot.innerHTML = `<style>
      .b{position:fixed;pointer-events:auto;min-width:30px;height:30px;padding:0 8px;box-sizing:border-box;border-radius:99px;border:0;
        background:#4F46E5;color:#fff;font:800 16px/30px -apple-system,"Malgun Gothic",sans-serif;text-align:center;cursor:pointer;
        box-shadow:0 2px 6px rgba(79,70,229,.35);transform:translateX(-50%);user-select:none}
      .b:hover{background:#4338CA}
      .b.busy{background:#94A3B8;cursor:wait}
      input{position:fixed;pointer-events:auto;width:58px;height:32px;box-sizing:border-box;border:2px solid #4F46E5;border-radius:9px;
        font:800 16px -apple-system,"Malgun Gothic",sans-serif;text-align:center;transform:translateX(-50%);outline:none;box-shadow:0 4px 12px rgba(15,23,42,.2)}
    </style>` + rects.map((r, i) => {
      if (r.width < 4 || r.bottom < 0 || r.top > innerHeight) return '';
      const room = r.top >= 34, top = room ? r.top - 32 : r.top + 1, left = room ? r.left + r.width / 2 : r.left + 18;   // 위에 자리가 없으면 칸 왼쪽 위 구석
      return i === numEdit
        ? `<input data-i="${i}" type="number" min="1" max="${rects.length}" value="${i + 1}" style="left:${left}px;top:${top - 1}px" title="옮길 번호를 넣고 Enter (Esc 취소)">`
        : `<button class="b${numBusy ? ' busy' : ''}" data-i="${i}" style="left:${left}px;top:${top}px" title="번호를 눌러 바꾸면 그 자리로 옮깁니다">${i + 1}</button>`;
    }).join('');
    numRoot.querySelectorAll('button.b').forEach(b => b.addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      if (numBusy) return;
      numEdit = Number(b.dataset.i); numRoot.__sig = ''; drawNums();
      const inp = numRoot.querySelector('input'); if (inp) { inp.focus(); inp.select(); }
    }));
    const inp = numRoot.querySelector('input');
    if (inp) {
      const done = go => {
        const from = Number(inp.dataset.i), to = Math.max(1, Math.min(rects.length, parseInt(inp.value, 10) || from + 1)) - 1;
        numEdit = -1; numRoot.__sig = ''; drawNums();
        if (go && to !== from) moveByNumber(from, to);
      };
      inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); else if (ev.key === 'Escape') done(false); });
      inp.addEventListener('blur', () => { if (numEdit >= 0) done(true); });
    }
  }
  async function moveByNumber(from, to) {
    const cur = currentOrder(); if (!cur.length) return;
    const target = cur.slice(); const [k] = target.splice(from, 1); target.splice(to, 0, k);
    numBusy = true; replaying = true; numRoot && (numRoot.__sig = ''); drawNums();
    let ok = false;
    try {
      ok = await fastOrder(target);
      if (!ok) ok = await moveColumn(from, to) && currentOrder().join(',') === target.join(',');
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
    barRoot.innerHTML = `<style>
      :host{all:initial}
      .w{position:fixed;right:16px;top:72px;z-index:2147483645;font:12px -apple-system,BlinkMacSystemFont,"Malgun Gothic",sans-serif;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
      .fab{border:1.5px solid #2563EB;background:#fff;color:#1D4ED8;border-radius:99px;padding:6px 12px;font-weight:800;cursor:pointer;box-shadow:0 4px 14px rgba(15,23,42,.15)}
      .fab.on{background:#2563EB;color:#fff}
      .p{background:#fff;border:1px solid #CBD5E1;border-radius:12px;box-shadow:0 10px 30px rgba(15,23,42,.2);padding:10px;width:260px;display:flex;flex-direction:column;gap:8px}
      .r{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
      .lab{font-size:11px;color:#64748B;font-weight:700;width:100%}
      button{border:1px solid #CBD5E1;background:#fff;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;color:#334155}
      button.sel{border-color:#2563EB;background:#EFF6FF;color:#1D4ED8;font-weight:800}
      .sw{width:22px;height:22px;border-radius:50%;padding:0;border:2px solid #fff;box-shadow:0 0 0 1px #CBD5E1}
      .sw.sel{box-shadow:0 0 0 2px #2563EB}
      .hint{font-size:11px;color:#475569;line-height:1.5;background:#F8FAFC;border-radius:6px;padding:6px}
      .t{font-size:11.5px;background:#0F172A;color:#fff;border-radius:8px;padding:6px 10px;opacity:0;transition:opacity .3s;max-width:300px}
      .off{color:#B91C1C}.dz button{color:#B91C1C;border-color:#FECACA}</style>
      <div class="w">
        <button class="fab ${mode ? 'on' : ''}" data-a="toggle">🖍 ${!enabled ? '표시 꺼짐' : mode === 'hl' ? '형광펜 중' : mode === 'edit' ? '글자 수정 중' : '표시 도구'}</button>
        ${barOpen ? `<div class="p">
          ${enabled ? `
          <div class="r"><span class="lab">모드 (켜져 있는 동안 표를 누르면 CRM 기능 대신 표시가 됩니다)</span>
            <button data-a="mode-hl" class="${mode === 'hl' ? 'sel' : ''}">🖍 형광펜</button>
            <button data-a="mode-edit" class="${mode === 'edit' ? 'sel' : ''}">✏️ 글자 수정</button>
            <button data-a="mode-off" class="${!mode ? 'sel' : ''}">보기만</button></div>
          ${mode === 'hl' ? `
          <div class="r"><span class="lab">색</span>${COLORS.map(c => `<button class="sw ${curColor === c.k ? 'sel' : ''}" data-a="c-${c.k}" title="${c.name}" style="background:${c.bg}"></button>`).join('')}
            <button data-a="c-x" class="${curColor === 'x' ? 'sel' : ''}" title="누른 칸의 형광펜 지우기">지우개</button></div>
          <div class="r"><span class="lab">적용 범위</span>
            <button data-a="s-one" class="${scope === 'one' ? 'sel' : ''}">이 고객만</button>
            <button data-a="s-all" class="${scope === 'all' ? 'sel' : ''}">모든 고객(줄 단위)</button></div>
          <div class="hint">칸을 누르면 그 칸의 글자, 줄 이름(예: 질병입원의료비)을 누르면 그 줄 글자 전체에 칠해집니다. 같은 색으로 다시 누르면 지워집니다.${scope === 'all' ? '<br><b>모든 고객</b>: 누른 줄이 모든 고객 화면에서 칠해집니다.' : ''}</div>` : ''}
          ${mode === 'edit' ? `<div class="hint">고칠 칸을 누르면 입력창이 뜹니다. 화면에서만 바뀌고 CRM 데이터는 그대로입니다. 고친 칸은 점선 테두리 · 마우스를 올리면 원래 글자.</div>` : ''}
          <div class="r"><span class="lab">보험 순서 ${ordered ? '— <b>기억됨</b>' : '— 번호를 바꾸거나 CRM에서 끌어 옮기면 기억'}</span>
            <button data-a="nums" class="${numsOn ? 'sel' : ''}">🔢 번호 ${numsOn ? '보임' : '숨김'}</button>
            ${ordered ? '<button data-a="order-reset">원래 순서로</button>' : ''}</div>
          <div class="r"><button data-a="undo" ${undo.length ? '' : 'disabled'}>↶ 되돌리기${undo.length ? ' (' + undo.length + ')' : ''}</button></div>
          <div class="r dz"><span class="lab">원래대로 (이 고객)</span>
            <button data-a="clr-hl">형광펜 지우기</button><button data-a="clr-ed">글자 원래대로</button><button data-a="clr-all">전부</button></div>
          ${rules.length ? `<div class="r dz"><span class="lab">모든 고객 규칙 ${rules.length}개</span><button data-a="clr-rules">규칙 모두 지우기</button></div>` : ''}
          <div class="r"><button data-a="disable" class="off">⏻ 표시 기능 끄기</button></div>
          ` : `<div class="hint">표시 기능이 꺼져 있어 원래 화면입니다. 켜면 저장해 둔 형광펜·글자·순서가 다시 적용됩니다.</div>
          <div class="r"><button data-a="enable">⏻ 표시 기능 켜기</button></div>`}
        </div>` : ''}
        <div class="t"></div>
      </div>`;
    barRoot.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', onBar));
  }
  async function onBar(e) {
    const a = e.currentTarget.dataset.a;
    if (a === 'toggle') { barOpen = !barOpen; if (!barOpen) mode = ''; renderBar(); return; }
    if (a === 'nums') { numsOn = !numsOn; try { chrome.storage.local.set({ anno_nums: numsOn }); } catch (x) {} numRoot && (numRoot.__sig = ''); drawNums(); renderBar(); return; }
    if (a === 'mode-hl') mode = 'hl';
    else if (a === 'mode-edit') mode = 'edit';
    else if (a === 'mode-off') { mode = ''; closeEditor(); }
    else if (a.startsWith('c-')) curColor = a.slice(2);
    else if (a === 's-one') scope = 'one';
    else if (a === 's-all') scope = 'all';
    else if (a === 'undo') return doUndo();
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
    cid = now; mode = ''; undo.length = 0; lastOrderSig = ''; orderReady = false; autoFixes = 0; closeEditor();
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
      if (enabled && mode && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key && ev.key.toLowerCase() === 'z' && !edBox) { ev.preventDefault(); doUndo(); }
      return;
    }
    swallow(ev);
  }, true));
  new MutationObserver(muts => {
    if (applying) return;
    const ours = n => n.nodeType === 1 && (n.hasAttribute('data-tce-hl') || n.hasAttribute('data-tce-ui'));
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
