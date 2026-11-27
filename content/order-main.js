// ──────────────────────────────────────────────────────────────────────────
// order-main.js — 페이지(MAIN world)에 주입되어 보장분석 표의 보험 '열 순서' 를 한 번에 바꾼다.
//   CRM 화면은 열 순서를 화면 프로그램(React) 안의 '목록 상태' 로 들고 있다. 머리칸을 하나씩 끌어
//   옮기는 대신, 그 목록을 찾아 원하는 순서로 한 번에 바꿔 넣는다(사람이 끌어 옮긴 것과 같은 결과).
//   · 요청: window.postMessage({ __sdhOrder: 'apply', reqId, perm: [현재 몇 번째 열 → 새 자리 순서] })
//   · 응답: window.postMessage({ __sdhOrderRes: reqId, ok, why })
//   목록을 못 찾거나 모양이 예상과 다르면 아무것도 바꾸지 않고 ok:false — 확장은 예전 방식(끌어 옮기기)으로.
// ──────────────────────────────────────────────────────────────────────────
(function () {
  if (window.__sdhOrderMain) return;
  window.__sdhOrderMain = true;

  const fiberOf = el => { for (const k in el) if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) return el[k]; return null; };
  function headerCells() {
    const tables = Array.prototype.filter.call(document.querySelectorAll('table'), t => !t.closest('[role="dialog"]'));
    for (const t of tables) {
      const tr = t.querySelector('tr'); if (!tr) continue;
      const hs = Array.prototype.filter.call(tr.children, c => c.getAttribute('aria-roledescription') === 'sortable');
      if (hs.length > 1) return hs;
    }
    return [];
  }
  // 머리칸마다 '정렬용 이름표(id)' — useSortable({ id }) 에 넘긴 값
  function sortableId(el) {
    for (let f = fiberOf(el), n = 0; f && n < 12; f = f.return, n++) {
      const p = f.memoizedProps;
      if (p && (typeof p.id === 'string' || typeof p.id === 'number')) return p.id;
    }
    return undefined;
  }
  function contextItems(cells) {
    for (let f = fiberOf(cells[0]), n = 0; f && n < 30; f = f.return, n++) {
      const it = f.memoizedProps && f.memoizedProps.items;
      if (Array.isArray(it) && it.length === cells.length) return it.map(x => (x && typeof x === 'object' ? x.id : x));
    }
    return null;
  }
  const idOfItem = x => (x == null ? x : (typeof x === 'object' ? (x.id !== undefined ? x.id : x.key !== undefined ? x.key : x.uid) : x));
  // 위로 올라가며 '열 순서 목록' 상태(useState) 를 찾는다: 길이가 같고 각 항목의 id 가 머리칸 id 와 같은 순서
  function findOrderState(cells, ids) {
    const seen = new Set();
    for (let f = fiberOf(cells[0]), depth = 0; f && depth < 60; f = f.return, depth++) {
      if (seen.has(f)) break; seen.add(f);
      for (let h = f.memoizedState, k = 0; h && typeof h === 'object' && 'next' in h && k < 80; h = h.next, k++) {
        const v = h.memoizedState, q = h.queue;
        if (!Array.isArray(v) || !q || typeof q.dispatch !== 'function' || v.length !== ids.length) continue;
        const vid = v.map(idOfItem);
        if (vid.every((x, i) => String(x) === String(ids[i]))) return { hook: h, list: v };
      }
    }
    return null;
  }
  // ① 가장 확실한 방법: CRM 이 '끌어 놓기 끝' 때 부르는 함수(onDragEnd)를 직접 불러, 사람이 끌어 놓은 것과
  //    똑같이 옮긴다. (실제 CRM 은 열 순서를 이 함수 안에서만 바꾼다 — 2026-11-28 실제 화면에서 확인)
  function dndCtx(cells) {
    let items = null, onEnd = null;
    for (let f = fiberOf(cells[0]), n = 0; f && n < 80; f = f.return, n++) {
      const m = f.memoizedProps;
      if (!m) continue;
      if (!items && Array.isArray(m.items) && m.items.length === cells.length) items = m.items.map(x => (x && typeof x === 'object' ? x.id : x));
      if (typeof m.onDragEnd === 'function') { onEnd = m.onDragEnd; break; }
    }
    return items && onEnd ? { items, onEnd } : null;
  }
  const _wait = ms => new Promise(r => setTimeout(r, ms));
  async function applyByDragEnd(perm) {
    let cells = headerCells(), ctx = dndCtx(cells);
    if (!ctx) return 'dnd';
    const target = perm.map(i => ctx.items[i]);
    if (target.some(x => x === undefined) || new Set(target.map(String)).size !== target.length) return 'perm';
    const ev = (id, i, list) => ({ id, data: { current: { sortable: { index: i, items: list, containerId: 'Sortable' } } }, rect: { current: { initial: null, translated: null } }, disabled: false });
    for (let i = 0; i < target.length; i++) {
      ctx = dndCtx(headerCells()); if (!ctx) return 'dnd';
      const cur = ctx.items;
      if (String(cur[i]) === String(target[i])) continue;
      const j = cur.findIndex(x => String(x) === String(target[i]));
      if (j < 0) return 'missing';
      ctx.onEnd({ active: ev(cur[j], j, cur), over: ev(cur[i], i, cur), delta: { x: 0, y: 0 }, collisions: null, activatorEvent: null });
      // 화면이 다시 그려질 때까지 (최대 0.6초)
      for (let w = 0; w < 30; w++) { await _wait(20); const c2 = dndCtx(headerCells()); if (c2 && String(c2.items[i]) === String(target[i])) break; }
    }
    const fin = dndCtx(headerCells());
    return fin && fin.items.every((x, i) => String(x) === String(target[i])) ? '' : 'verify';
  }

  let last = null;   // 마지막으로 바꾼 상태와 원래 목록 — 화면이 기대대로 안 바뀌면 되돌린다
  window.addEventListener('message', ev => {
    const d = ev.data;
    if (ev.source !== window || !d) return;
    if (d.__sdhOrder === 'revert') {
      try { if (last && last.reqId === d.reqId) { last.hook.queue.dispatch(last.list); last = null; } } catch (e) {}
      return;
    }
    if (d.__sdhOrder !== 'apply') return;
    const reply = (ok, why) => { try { window.postMessage({ __sdhOrderRes: d.reqId, ok, why }, '*'); } catch (e) {} };
    (async () => {
      try {
        const cells = headerCells();
        if (cells.length && Array.isArray(d.perm) && d.perm.length === cells.length) {
          const why = await applyByDragEnd(d.perm);
          if (!why) return reply(true, '');
          if (why !== 'dnd') return reply(false, 'dragend-' + why);
        }
      } catch (e) {}
      applyByState();
    })();
    function applyByState() {
    try {
      const cells = headerCells();
      const perm = d.perm;
      if (!cells.length || !Array.isArray(perm) || perm.length !== cells.length) return reply(false, 'cells');
      // 정렬 목록 이름표: ① 끌기 목록(SortableContext)의 items  ② 없으면 머리칸 쪽 props.id
      let ids = contextItems(cells);
      if (!ids) ids = cells.map(sortableId);
      if (!ids || ids.some(x => x === undefined) || new Set(ids.map(String)).size !== ids.length) return reply(false, 'ids');
      const st = findOrderState(cells, ids);
      if (!st) return reply(false, 'state');
      const next = perm.map(i => st.list[i]);
      if (next.some(x => x === undefined) || new Set(next).size !== next.length) return reply(false, 'perm');
      last = { reqId: d.reqId, hook: st.hook, list: st.list };
      st.hook.queue.dispatch(next);
      reply(true, '');
    } catch (e) { reply(false, String(e && e.message || e)); }
    }
  });
})();
