// ═══════════════════════════════════════════════════════════════════
// 🗂 PC 워크스페이스 — 캘린더 + 고객·건강상태 (모두 이 PC 금고에 PIN 암호화 저장)
//   · 일정: 금고 'events' [{id,title,date:'YYYY-MM-DD',time,type,customerId,customerName,memo,done,_u}]
//   · 고객·건강상태: 확장 고객 화면(popup.html?...&solo=1&embed=1)을 그대로 띄워 같은 데이터를 씀
//   · 생일(고객 생년월일)은 달력에 🎂 로 자동 표시
//   · 폴더 동기화(popup/syncfolder.js)를 켜 두면 일정도 다른 PC 와 함께 쓴다
// ═══════════════════════════════════════════════════════════════════
const WS_TYPES = [
  { k: '상담', c: '#2383E2', bg: '#E7F3F8' },
  { k: '청약', c: '#0F7B6C', bg: '#DDEDEA' },
  { k: '연락', c: '#D9730D', bg: '#FAEBDD' },
  { k: '방문', c: '#9065B0', bg: '#EAE4F2' },
  { k: '기념일', c: '#C14C8A', bg: '#F4DFEB' },
  { k: '기타', c: '#787774', bg: '#F1F1EF' }
];
const _wsType = k => WS_TYPES.find(t => t.k === k) || WS_TYPES[WS_TYPES.length - 1];
let _wsEvents = [], _wsCusts = [], _wsMonth = new Date(), _wsSel = null, _wsEdit = null, _wsQuery = '';
const _wsEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _wsPad = n => String(n).padStart(2, '0');
const _wsYmd = d => `${d.getFullYear()}-${_wsPad(d.getMonth() + 1)}-${_wsPad(d.getDate())}`;
const _wsToday = () => _wsYmd(new Date());

// 확장 공용 코드가 부르는 알림 (팝업에서는 render.js 가 정의)
function showToast(msg) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(showToast._t); showToast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ── 데이터 ──
async function wsLoad() {
  if (!vaultIsUnlocked()) return;
  try { _wsEvents = await vaultGet('events'); } catch (e) { _wsEvents = []; }
  try { _wsCusts = await vaultGet('customers'); } catch (e) { _wsCusts = []; }
  wsRenderCal(); wsRenderSide(); wsFillCustList(); wsRenderStat(); wsRenderStats();
}
async function wsSaveEvents() { await vaultPut('events', _wsEvents); }

// 고객 생일 → 이 달의 🎂 (생년월일 YYYY-MM-DD / YYYYMMDD / YYMMDD / 주민번호 앞 6자리)
function _wsBirthMD(c) {
  let d = String(c['생년월일'] || '').replace(/[^\d]/g, '');
  if (d.length < 6) d = String(c['주민등록번호'] || '').replace(/[^\d]/g, '').slice(0, 6);
  if (d.length === 8) return d.slice(4, 8);
  if (d.length >= 6) return d.slice(2, 6);
  return '';
}

// 고객에서 나온 달력 항목 — 첫 상담(등록일) · 상담 예약(다음예약일시)
//   고객마다 '등록 → 상담 일정(종류 상담) → 다음 상담 예약' 을 날짜·시간 순으로 세어 N차 상담으로 표시
function _wsCustItems() {
  const out = [];
  _wsCusts.forEach(c => {
    const nm = c['고객명'] || '(이름 없음)';
    const rg = String(c['등록일'] || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(rg)) out.push({ id: 'cr:' + c.id, kind: 'reg', customerId: c.id, customerName: nm, date: rg.slice(0, 10), time: rg.slice(11, 16), type: '상담' });
    const ap = String(c['다음예약일시'] || '').replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}/.test(ap)) out.push({ id: 'ca:' + c.id, kind: 'appt', customerId: c.id, customerName: nm, date: ap.slice(0, 10), time: ap.slice(11, 16), type: '상담' });
  });
  const rounds = _wsRounds(out);
  out.forEach(it => { it.round = rounds[it.id] || 1; it.title = `${it.customerName} ${it.round}차 상담${it.kind === 'appt' ? ' (예약)' : ''}`; });
  return out;
}
// id → N차 (고객별, 날짜·시간 순)
function _wsRounds(custItems) {
  const per = {};
  const add = (cid, id, date, time) => { (per[cid] = per[cid] || []).push({ id, k: date + ' ' + (time || '00:00') }); };
  (custItems || []).forEach(it => add(it.customerId, it.id, it.date, it.time));
  _wsEvents.forEach(e => { if (e.customerId && e.type === '상담') add(e.customerId, e.id, e.date, e.time); });
  const r = {};
  Object.values(per).forEach(l => { l.sort((a, b) => a.k.localeCompare(b.k)); l.forEach((x, i) => { r[x.id] = i + 1; }); });
  return r;
}
let _wsRoundCache = {};

// ── 달력 ──
function wsRenderCal() {
  const y = _wsMonth.getFullYear(), m = _wsMonth.getMonth();
  document.getElementById('calTitle').textContent = `${y}년 ${m + 1}월`;
  try { wsRenderStats(); } catch (e) {}
  const first = new Date(y, m, 1), start = new Date(y, m, 1 - first.getDay());
  const today = _wsToday(), q = _wsQuery.trim();
  const byDay = {};
  _wsEvents.forEach(e => { if (!q || _wsMatch(e, q)) (byDay[e.date] = byDay[e.date] || []).push(e); });
  Object.values(byDay).forEach(l => l.sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99'))));
  const ci = _wsCustItems();
  _wsRoundCache = _wsRounds(ci);
  ci.forEach(it => { if (!q || _wsMatch(it, q)) (byDay[it.date] = byDay[it.date] || []).push(it); });
  Object.values(byDay).forEach(l => l.sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99'))));
  const births = {};
  if (!q) _wsCusts.forEach(c => { const md = _wsBirthMD(c); if (md) (births[md] = births[md] || []).push(c); });
  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = _wsYmd(d), md = key.slice(5, 7) + key.slice(8, 10);
    const evs = byDay[key] || [], bs = births[md] || [];
    const cls = ['ws-day', d.getMonth() !== m ? 'out' : '', key === today ? 'today' : '', key === _wsSel ? 'sel' : '', d.getDay() === 0 ? 'sun' : '', d.getDay() === 6 ? 'sat' : ''].join(' ');
    const chips = bs.map(c => `<div class="ws-chip bday" title="${_wsEsc(c['고객명'])} 생일">🎂 ${_wsEsc(c['고객명'])}</div>`).join('') +
      evs.slice(0, 4).map(e => { const t = _wsType(e.type);
        if (e.kind) return `<div class="ws-chip ${e.kind}" data-cust="${_wsEsc(e.customerId)}" title="${_wsEsc(e.title)} — 누르면 고객 열기">${e.kind === 'appt' ? '📞 ' : ''}${e.time ? `<b>${_wsEsc(e.time)}</b> ` : ''}${_wsEsc(e.customerName)} <span class="ws-rd">${e.round}차 상담</span></div>`;
        const rd = e.customerId && e.type === '상담' && _wsRoundCache[e.id] ? ` <span class="ws-rd">${_wsRoundCache[e.id]}차</span>` : '';
        return `<div class="ws-chip${e.done ? ' done' : ''}" data-ev="${e.id}" style="background:${t.bg};color:${t.c}">${e.time ? `<b>${_wsEsc(e.time)}</b> ` : ''}${_wsEsc(e.title || e.customerName || e.type)}${rd}</div>`; }).join('') +
      (evs.length > 4 ? `<div class="ws-more">+${evs.length - 4}개 더</div>` : '');
    html += `<div class="${cls}" data-day="${key}"><div class="ws-dnum">${d.getDate()}</div>${chips}</div>`;
  }
  document.getElementById('calGrid').innerHTML = html;
  document.getElementById('calLegend').innerHTML = WS_TYPES.map(t => `<span><i style="background:${t.c}"></i>${t.k}</span>`).join('') + '<span>👤 고객 N차 상담(등록일)</span><span>📞 다음 상담 예약</span><span>🎂 고객 생일</span>';
}
function _wsMatch(e, q) { return [e.title, e.customerName, e.memo, e.type].join(' ').toLowerCase().includes(q.toLowerCase()); }

// 오른쪽: 고른 날의 일정 또는 다가오는 일정(오늘부터 14일)
function wsRenderSide() {
  const t = document.getElementById('sideTitle'), box = document.getElementById('sideList');
  let list, head;
  const q = _wsQuery.trim();
  const ci = _wsCustItems(); _wsRoundCache = _wsRounds(ci);
  const all = _wsEvents.concat(ci);
  if (q) { list = all.filter(e => _wsMatch(e, q)); head = `🔍 '${q}' 검색 결과 ${list.length}개`; }
  else if (_wsSel) { list = all.filter(e => e.date === _wsSel); head = `${_wsSel.replace(/-/g, '.')} 일정`; }
  else {
    const from = _wsToday(), to = new Date(); to.setDate(to.getDate() + 14);
    list = all.filter(e => e.kind !== 'reg' && e.date >= from && e.date <= _wsYmd(to) && !e.done); head = '다가오는 일정 (2주)';
  }
  list = list.slice().sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
  t.textContent = head;
  const add = _wsSel && !q ? `<button class="btn-secondary ws-side-add" data-add="${_wsSel}">＋ 이 날 일정 추가</button>` : '';
  box.innerHTML = (list.length ? list.map(e => { const ty = _wsType(e.type);
    if (e.kind) return `
    <div class="ws-item ws-item-c" data-cust="${_wsEsc(e.customerId)}">
      <div class="ws-item-ck">${e.kind === 'appt' ? '📞' : '👤'}</div>
      <div class="ws-item-b">
        <div class="ws-item-t">${e.time ? _wsEsc(e.time) + ' ' : ''}${_wsEsc(e.customerName)} <span class="ws-rd">${e.round}차 상담</span>${e.kind === 'appt' ? ' <span class="ws-tag" style="background:#E6F4FF;color:#0B63C4">예약</span>' : ''}</div>
        <div class="ws-item-s">${_wsEsc(e.date.replace(/-/g, '.'))}${e.time ? ' ' + _wsEsc(e.time) : ''} · 누르면 고객 정보 열기</div>
      </div>
    </div>`;
    return `
    <div class="ws-item${e.done ? ' done' : ''}" data-ev="${e.id}">
      <label class="ws-item-ck" title="완료"><input type="checkbox" data-done="${e.id}"${e.done ? ' checked' : ''}></label>
      <div class="ws-item-b">
        <div class="ws-item-t"><span class="ws-tag" style="background:${ty.bg};color:${ty.c}">${_wsEsc(e.type)}</span>${_wsEsc(e.title || '(제목 없음)')}${e.customerId && e.type === '상담' && _wsRoundCache[e.id] ? ` <span class="ws-rd">${_wsRoundCache[e.id]}차</span>` : ''}</div>
        <div class="ws-item-s">${_wsEsc(e.date.replace(/-/g, '.'))}${e.time ? ' ' + _wsEsc(e.time) : ''}${e.customerName ? ' · 👤 ' + _wsEsc(e.customerName) : ''}</div>
        ${e.memo ? `<div class="ws-item-m">${_wsEsc(e.memo)}</div>` : ''}
      </div>
    </div>`; }).join('') : `<div class="cred-empty">${q ? '찾는 일정이 없습니다.' : _wsSel ? '이 날은 일정이 없습니다.' : '2주 안에 잡힌 일정이 없습니다.'}</div>`) + add;
}
function wsFillCustList() {
  document.getElementById('evCustList').innerHTML = _wsCusts
    .filter(c => c['고객명']).map(c => `<option value="${_wsEsc(c['고객명'])}">${_wsEsc([c['연락처'], c['생년월일']].filter(Boolean).join(' · '))}</option>`).join('');
}
// 위쪽 요약 카드 — 오늘 일정 · 이번 주 상담 예약 · 이번 달 새 고객 · 할 일(미완료)
function wsRenderStats() {
  const el = document.getElementById('wsStats'); if (!el) return;
  const today = _wsToday(), now = new Date();
  const wkEnd = new Date(now); wkEnd.setDate(now.getDate() + 7);
  const all = _wsEvents.concat(_wsCustItems());
  const todayN = all.filter(e => e.date === today && e.kind !== 'reg' && !e.done).length;
  const weekAppt = all.filter(e => e.kind !== 'reg' && (e.kind === 'appt' || e.type === '상담') && e.date >= today && e.date <= _wsYmd(wkEnd)).length;
  const ym = today.slice(0, 7);
  const newCust = _wsCusts.filter(c => String(c['등록일'] || '').slice(0, 7) === ym).length;
  const todo = _wsEvents.filter(e => !e.done && e.date >= today).length;
  const card = (ic, n, t, cls) => `<div class="ws-stat-c ${cls}"><div class="ws-stat-ic">${ic}</div><div><div class="ws-stat-n">${n}</div><div class="ws-stat-t">${t}</div></div></div>`;
  el.innerHTML = card('📌', todayN, '오늘 일정', 'c1') + card('📞', weekAppt, '7일 안 상담', 'c2') + card('🆕', newCust, '이번 달 새 고객', 'c3') + card('✅', todo, '남은 일정', 'c4');
  const h = document.getElementById('wsHello');
  if (h) { const d = new Date(); h.textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일 · 오늘 일정 ${todayN}건`; }
}
function wsRenderStat() {
  const el = document.getElementById('setStat'); if (!el) return;
  el.textContent = `고객 ${_wsCusts.length}명 · 일정 ${_wsEvents.length}개`;
}

// ── 일정 입력 창 ──
function wsOpenEvent(ev, day) {
  _wsEdit = ev ? Object.assign({}, ev) : { id: '', title: '', date: day || _wsSel || _wsToday(), time: '', type: '상담', customerId: '', customerName: '', memo: '', done: false };
  document.getElementById('evTitle').textContent = ev ? '일정 수정' : '새 일정';
  document.getElementById('evType').innerHTML = WS_TYPES.map(t => `<option${t.k === _wsEdit.type ? ' selected' : ''}>${t.k}</option>`).join('');
  document.getElementById('evName').value = _wsEdit.title;
  document.getElementById('evDate').value = _wsEdit.date;
  document.getElementById('evTime').value = _wsEdit.time || '';
  document.getElementById('evCust').value = _wsEdit.customerName || '';
  document.getElementById('evMemo').value = _wsEdit.memo || '';
  document.getElementById('evDone').checked = !!_wsEdit.done;
  document.getElementById('evDel').style.display = ev ? '' : 'none';
  document.getElementById('evOpenCust').style.display = _wsEdit.customerId ? '' : 'none';
  document.getElementById('evBack').hidden = false;
  setTimeout(() => document.getElementById('evName').focus(), 30);
}
function wsCloseEvent() { document.getElementById('evBack').hidden = true; _wsEdit = null; }
function _wsFindCust(name) {
  name = String(name || '').trim(); if (!name) return null;
  const hits = _wsCusts.filter(c => (c['고객명'] || '').trim() === name);
  return hits.length === 1 ? hits[0] : (hits[0] || null);
}
async function wsSaveEvent() {
  const e = _wsEdit; if (!e) return;
  e.title = document.getElementById('evName').value.trim();
  e.date = document.getElementById('evDate').value;
  e.time = document.getElementById('evTime').value;
  e.type = document.getElementById('evType').value;
  e.customerName = document.getElementById('evCust').value.trim();
  const c = _wsFindCust(e.customerName); e.customerId = c ? c.id : '';
  e.memo = document.getElementById('evMemo').value.trim();
  e.done = document.getElementById('evDone').checked;
  if (!e.date) { await showAlert('날짜를 고르세요.'); return; }
  if (!e.title && !e.customerName) { await showAlert('제목이나 고객 이름 중 하나는 입력하세요.'); return; }
  if (!e.title) e.title = `${e.customerName} ${e.type}`;
  const before = _wsEvents.slice();
  if (!e.id) { e.id = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); e.created = Date.now(); _wsEvents.push(e); }
  else { const i = _wsEvents.findIndex(x => x.id === e.id); if (i >= 0) _wsEvents[i] = e; else _wsEvents.push(e); }
  try { await wsSaveEvents(); } catch (err) { _wsEvents = before; await showAlert('저장 실패: ' + (err.message || err)); return; }
  wsCloseEvent(); _wsSel = e.date; _wsMonth = new Date(e.date + 'T00:00'); wsRenderCal(); wsRenderSide(); wsRenderStat();
  showToast('📅 일정을 저장했습니다');
}
async function wsDeleteEvent() {
  const e = _wsEdit; if (!e || !e.id) return;
  if (!(await showConfirm(`'${e.title}' 일정을 지울까요?`, '일정 삭제'))) return;
  _wsEvents = _wsEvents.filter(x => x.id !== e.id);
  await wsSaveEvents(); wsCloseEvent(); wsRenderCal(); wsRenderSide(); wsRenderStat();
  showToast('🗑 일정을 지웠습니다');
}
async function wsToggleDone(id, on) {
  const e = _wsEvents.find(x => x.id === id); if (!e) return;
  e.done = on; await wsSaveEvents(); wsRenderCal(); wsRenderSide();
}

// ── 고객 화면(확장 고객 탭)을 띄우고, 특정 고객 열기 ──
function wsEnsureFrame() {
  const f = document.getElementById('cuFrame');
  if (!f.src) f.src = chrome.runtime.getURL('popup.html?full=1&tab=cust&solo=1&embed=1');
  return f;
}
function wsOpenCustomer(id) {
  wsShowView('cust');
  const f = wsEnsureFrame();
  const tryOpen = (n) => {
    try {
      const w = f.contentWindow;
      const c = w && w.cuStore && w.cuStore.list().find(x => x.id === id);
      if (c && typeof w.cuOpenForm === 'function') { w.cuOpenForm(c); return; }
    } catch (e) {}
    if (n < 20) setTimeout(() => tryOpen(n + 1), 250);
  };
  tryOpen(0);
}

// ── 화면 전환 ──
function wsShowView(v) {
  document.querySelectorAll('.ws-nav-btn').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  document.querySelectorAll('.ws-view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  const pane = document.getElementById('view-' + v);
  if (!vaultIsUnlocked()) { vaultRenderGate(pane); return; }
  if (v === 'cust') wsEnsureFrame();
  if (v === 'set') { wsRenderStat(); if (typeof sfRenderStatus === 'function') sfRenderStatus(); }
  try { history.replaceState(null, '', '#' + v); } catch (e) {}
}

// ── .ics 내보내기 ──
function wsExportIcs() {
  const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//sangdam-helper//pc-workspace//KO', 'CALSCALE:GREGORIAN'];
  _wsEvents.forEach(e => {
    const d = e.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', 'UID:' + e.id + '@pc-workspace');
    if (e.time) {
      const t = e.time.replace(':', '') + '00';
      lines.push('DTSTART;TZID=Asia/Seoul:' + d + 'T' + t, 'DURATION:PT1H');
    } else {
      const nx = new Date(e.date + 'T00:00'); nx.setDate(nx.getDate() + 1);
      lines.push('DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + _wsYmd(nx).replace(/-/g, ''));
    }
    lines.push('SUMMARY:' + esc(`[${e.type}] ${e.title}`));
    const desc = [e.customerName ? '고객: ' + e.customerName : '', e.memo].filter(Boolean).join('\n');
    if (desc) lines.push('DESCRIPTION:' + esc(desc));
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = 'PC워크스페이스_일정_' + _wsToday() + '.ics';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  showToast('📥 일정 ' + _wsEvents.length + '개를 내려받았습니다');
}

// ── 시작 ──
document.addEventListener('DOMContentLoaded', async () => {
  // 🔐 확장 로그인·관리자 승인(팝업에서 통과하면 extAuthOK 기록) — 통과 못 하면 막음
  const st = await new Promise(r => { try { chrome.storage.local.get(['extAuthOK'], v => r(v || {})); } catch (e) { r({}); } });
  if (!st.extAuthOK) { document.getElementById('wsAuth').style.display = 'flex'; return; }
  document.getElementById('wsApp').style.display = '';

  document.querySelectorAll('.ws-nav-btn').forEach(b => b.addEventListener('click', () => wsShowView(b.dataset.view)));
  document.getElementById('calPrev').onclick = () => { _wsMonth = new Date(_wsMonth.getFullYear(), _wsMonth.getMonth() - 1, 1); wsRenderCal(); };
  document.getElementById('calNext').onclick = () => { _wsMonth = new Date(_wsMonth.getFullYear(), _wsMonth.getMonth() + 1, 1); wsRenderCal(); };
  document.getElementById('calToday').onclick = () => { _wsMonth = new Date(); _wsSel = _wsToday(); wsRenderCal(); wsRenderSide(); };
  document.getElementById('calAdd').onclick = () => wsOpenEvent(null);
  document.getElementById('calSearch').addEventListener('input', e => { _wsQuery = e.target.value; wsRenderCal(); wsRenderSide(); });
  document.getElementById('calGrid').addEventListener('click', e => {
    const cc = e.target.closest('[data-cust]'); if (cc) { wsOpenCustomer(cc.dataset.cust); return; }
    const chip = e.target.closest('[data-ev]');
    if (chip) { const ev = _wsEvents.find(x => x.id === chip.dataset.ev); if (ev) wsOpenEvent(ev); return; }
    const day = e.target.closest('[data-day]'); if (!day) return;
    _wsSel = _wsSel === day.dataset.day ? null : day.dataset.day; wsRenderCal(); wsRenderSide();
  });
  document.getElementById('calGrid').addEventListener('dblclick', e => { const day = e.target.closest('[data-day]'); if (day && !e.target.closest('[data-ev]')) wsOpenEvent(null, day.dataset.day); });
  document.getElementById('sideList').addEventListener('click', e => {
    const ck = e.target.closest('[data-done]'); if (ck) { wsToggleDone(ck.dataset.done, ck.checked); return; }
    const add = e.target.closest('[data-add]'); if (add) { wsOpenEvent(null, add.dataset.add); return; }
    const cc = e.target.closest('[data-cust]'); if (cc) { wsOpenCustomer(cc.dataset.cust); return; }
    const it = e.target.closest('[data-ev]'); if (it) { const ev = _wsEvents.find(x => x.id === it.dataset.ev); if (ev) wsOpenEvent(ev); }
  });
  document.getElementById('evSave').onclick = wsSaveEvent;
  document.getElementById('evCancel').onclick = wsCloseEvent;
  document.getElementById('evDel').onclick = wsDeleteEvent;
  document.getElementById('evOpenCust').onclick = () => { const id = _wsEdit && _wsEdit.customerId; wsCloseEvent(); if (id) wsOpenCustomer(id); };
  document.getElementById('evBack').addEventListener('click', e => { if (e.target.id === 'evBack') wsCloseEvent(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.getElementById('evBack').hidden) wsCloseEvent(); });
  document.getElementById('evBack').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) wsSaveEvent(); });
  document.getElementById('setIcs').onclick = wsExportIcs;
  document.getElementById('setPin').onclick = () => vaultChangePinFlow();
  document.getElementById('setGcPat').onclick = () => gcOpenPatternPanel();
  document.getElementById('setGcGuide').onclick = () => gcOpenGuide();

  document.addEventListener('vault-unlocked', () => {
    wsLoad();
    const active = document.querySelector('.ws-view.active');
    if (active && active.id === 'view-cust') { const f = document.getElementById('cuFrame'); f.src = ''; wsEnsureFrame(); }
  });
  document.addEventListener('vault-synced', wsLoad);
  // 다른 창(확장 고객 탭 등)에서 고객을 바꾸면 달력의 고객 목록·생일도 맞춘다
  try { chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.vault_customers || ch.vault_events)) wsLoad(); }); } catch (e) {}

  const v = (location.hash || '').slice(1);
  wsShowView(['cal', 'cust', 'set'].includes(v) ? v : 'cal');
  if (vaultIsUnlocked()) wsLoad();
});
