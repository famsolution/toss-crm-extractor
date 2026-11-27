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
  });
})();
