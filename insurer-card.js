// ═══════════════════════════════════════════════════════════════════
// insurer-card.js — 보험사 GA/설계사 포털에 들어가면 그 보험사 계정(ID/비번)을
//   화면 오른쪽 아래에 40초 동안 자동으로 띄운다. (확장 아이콘을 누르지 않아도 됨)
//
//   · 계정은 PC 금고(PIN 암호화)에 있다. 이 스크립트는 금고를 직접 못 열고,
//     background 에 이 페이지 주소의 계정만 달라고 요청한다(credCardLookup).
//     금고가 잠겨 있으면(30분 지남·브라우저 재시작) '잠김' 안내만 띄운다.
//   · 사이트 스크립트가 못 읽게 닫힌(closed) Shadow DOM 안에 그린다. ID·비번은 카드가 떠 있는
//     동안 바로 보인다([숨김] 으로 가릴 수 있음). [복사] 는 바로 클립보드로 보낸다.
//   · 같은 탭에서 같은 보험사는 한 번만 자동으로 뜬다(페이지 이동마다 뜨지 않게).
//     40초가 지나면 작은 🔑 버튼만 남고, 누르면 다시 열린다.
//   · 끄기: 확장 팝업 🔑 비번 탭 아래 '사이트 자동 표시' 체크.
// ═══════════════════════════════════════════════════════════════════
(function () {
  if (window.top !== window) return;               // iframe 안에서는 띄우지 않음
  if (window.__tossCredCardBound) return;
  window.__tossCredCardBound = true;

  const SHOW_SEC = 40;
  let host = null, root = null, timer = null, left = SHOW_SEC, paused = false;

  const CSS = `
    :host { all: initial; }
    .wrap { position: fixed; right: 18px; bottom: 18px; z-index: 2147483646;
            font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", "Segoe UI", sans-serif; }
    .card { width: 300px; background: #fff; border: 1.5px solid #2563EB; border-radius: 12px;
            box-shadow: 0 12px 32px rgba(15,23,42,.22); padding: 12px 12px 10px; color: #0F172A; }
    .hd { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
    .t { font-size: 13px; font-weight: 800; flex: 1; }
    .sec { font-size: 11px; color: #64748B; }
    .x { border: none; background: none; font-size: 16px; color: #64748B; cursor: pointer; padding: 0 2px; line-height: 1; }
    .acc { border: 1px solid #E2E8F0; border-radius: 8px; padding: 7px 9px; margin-top: 6px; }
    .ins { font-size: 12px; font-weight: 800; color: #1D4ED8; margin-bottom: 4px; }
    .kv { display: flex; align-items: center; gap: 6px; font-size: 13px; margin-top: 3px; }
    .k { width: 30px; flex: 0 0 auto; font-size: 11px; color: #94A3B8; font-weight: 700; }
    .v { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .mono { font-family: Consolas, "Courier New", monospace; letter-spacing: .5px; }
    .b { flex: 0 0 auto; padding: 2px 8px; border: 1px solid #CBD5E1; border-radius: 5px; background: #fff;
         color: #475569; font-size: 11px; font-weight: 700; cursor: pointer; }
    .b:hover { border-color: #2563EB; color: #2563EB; }
    .ex { font-size: 11px; color: #475569; margin-top: 4px; }
    .msg { font-size: 12px; color: #475569; line-height: 1.55; }
    .bar { height: 3px; background: #DBEAFE; border-radius: 99px; margin-top: 9px; overflow: hidden; }
    .bar i { display: block; height: 100%; background: #2563EB; width: 100%; transition: width 1s linear; }
    .pill { width: 38px; height: 38px; border-radius: 50%; border: 1.5px solid #2563EB; background: #fff;
            box-shadow: 0 6px 18px rgba(15,23,42,.2); font-size: 17px; cursor: pointer; }
    .toast { font-size: 11px; color: #059669; font-weight: 700; min-height: 13px; margin-top: 4px; }`;

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement('div');
    host.setAttribute('data-toss-cred', '');
    root = host.attachShadow({ mode: 'closed' });
    (document.body || document.documentElement).appendChild(host);
  }
  function clearTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function removeAll() { clearTimer(); try { host && host.remove(); } catch (e) {} host = null; root = null; }

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {}
    // http 사이트 등 clipboard API 가 막힌 경우 — 숨긴 입력칸으로 복사 후 즉시 제거
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      root.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  function showPill() {
    clearTimer();
    ensureHost();
    root.innerHTML = '';
    const st = el('style'); st.textContent = CSS; root.appendChild(st);
    const w = el('div', 'wrap');
    const p = el('button', 'pill', '🔑'); p.title = '보험사 계정 보기';
    p.addEventListener('click', () => request(true));
    w.appendChild(p); root.appendChild(w);
  }

  function render(res) {
    ensureHost();
    root.innerHTML = '';
    const st = el('style'); st.textContent = CSS; root.appendChild(st);
    const w = el('div', 'wrap'); const card = el('div', 'card');
    const hd = el('div', 'hd');
    hd.appendChild(el('div', 't', '🔑 ' + ((res.names && res.names[0]) || '보험사') + ' 계정'));
    const sec = el('span', 'sec'); hd.appendChild(sec);
    const x = el('button', 'x', '×'); x.title = '닫기'; x.addEventListener('click', showPill); hd.appendChild(x);
    card.appendChild(hd);
    const toast = el('div', 'toast');

    if (res.locked) {
      card.appendChild(el('div', 'msg', '🔒 PC 금고가 잠겨 있어 계정을 표시할 수 없습니다. 확장 아이콘을 눌러 PIN 을 입력하면 바로 여기에 표시됩니다.'));
    } else {
      (res.items || []).forEach(it => {
        const acc = el('div', 'acc');
        acc.appendChild(el('div', 'ins', it.보험사 || ''));
        const r1 = el('div', 'kv'); r1.appendChild(el('span', 'k', 'ID')); r1.appendChild(el('span', 'v', it.ID || '-'));
        if (it.ID) { const b = el('button', 'b', '복사'); b.addEventListener('click', async () => { toast.textContent = (await copyText(it.ID)) ? 'ID 복사됨' : '복사 실패'; }); r1.appendChild(b); }
        acc.appendChild(r1);
        const pw = String(it.비밀번호 || '');
        const r2 = el('div', 'kv'); r2.appendChild(el('span', 'k', '비번'));
        // 카드가 떠 있는 동안은 비번을 바로 보여준다 — 가리고 싶으면 [숨김]
        const pv = el('span', 'v mono', pw || '-'); r2.appendChild(pv);
        if (pw) {
          let shown = true;
          const sb = el('button', 'b', '숨김');
          sb.addEventListener('click', () => { shown = !shown; pv.textContent = shown ? pw : '•'.repeat(Math.min(pw.length, 10)); sb.textContent = shown ? '숨김' : '보기'; });
          const cb = el('button', 'b', '복사');
          cb.addEventListener('click', async () => { toast.textContent = (await copyText(pw)) ? '비번 복사됨' : '복사 실패'; });
          r2.appendChild(sb); r2.appendChild(cb);
        }
        acc.appendChild(r2);
        const ex = [it.생년월일 && ('생년월일 ' + it.생년월일), it.년월일 && ('년월일 ' + it.년월일), it.비고].filter(Boolean).join(' · ');
        if (ex) acc.appendChild(el('div', 'ex', ex));
        card.appendChild(acc);
      });
    }
    card.appendChild(toast);
    const bar = el('div', 'bar'); const fill = el('i'); bar.appendChild(fill); card.appendChild(bar);
    w.appendChild(card); root.appendChild(w);

    // 40초 카운트다운 — 마우스를 올려 두면 멈춘다
    clearTimer(); left = SHOW_SEC; paused = false;
    card.addEventListener('mouseenter', () => { paused = true; });
    card.addEventListener('mouseleave', () => { paused = false; });
    const tick = () => {
      sec.textContent = paused ? '멈춤' : left + '초';
      fill.style.width = Math.max(0, left / SHOW_SEC * 100) + '%';
    };
    tick();
    timer = setInterval(() => {
      if (!paused) left--;
      if (left <= 0) { showPill(); return; }
      tick();
    }, 1000);
  }

  function request(force) {
    try {
      chrome.runtime.sendMessage({ action: 'credCardLookup', force: !!force }, res => {
        void chrome.runtime.lastError;
        if (!res || !res.ok) return;
        if (!res.show) { if (res.pill) showPill(); return; }
        render(res);
      });
    } catch (e) { /* 확장이 새로고침돼 연결이 끊긴 경우 — 조용히 무시 */ }
  }

  // 팝업에서 금고를 풀면 열려 있는 보험사 탭에 다시 띄운다
  try {
    chrome.runtime.onMessage.addListener(msg => { if (msg && msg.action === 'credCardRetry') request(true); });
  } catch (e) {}

  const start = () => setTimeout(() => request(false), 600);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
