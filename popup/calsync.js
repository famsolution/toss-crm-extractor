// ═══════════════════════════════════════════════════════════════════
// 🔄 캘린더 동기화 — PC 워크스페이스 일정(금고 'events') ↔ 웹 워크스페이스 · 네이버 캘린더
//
//   · 가운데는 이 확장의 일정. 웹·네이버에서 만든 일정은 이쪽으로 들어오고, 이쪽 일정은 양쪽으로 나간다.
//   · 웹 워크스페이스: Firestore 'schedules' (웹 캘린더가 그대로 보여 주는 곳)
//       {title, datetime:'YYYY-MM-DD HH:MM', memo, color, owner_id, created_at,
//        source:'ext', ext_id, ext_type, ext_done, ext_customer_id, updated_at}
//   · 네이버 캘린더: CalDAV (네이버 아이디 + '애플리케이션 비밀번호'). 계정은 🔑 비번 금고에
//       보험사 칸 '네이버 캘린더' 로 저장 (다른 PC 와 같이 동기화됨).
//   · 같은 일정이 여러 PC 에서 따로 생기지 않도록: 웹 문서는 ext_id, 네이버 일정은 UID 'sdh-<id>' 로 짝을 찾는다.
//   · PC 별 기록(마지막으로 맞춘 내용) — chrome.storage.local 'calsync_map'
//       { <일정id>: { w: 웹문서id, wh: 맞춘내용, n: 네이버href, ne: etag, nh: 맞춘내용 } }
//   ⚠ 일정(제목에 들어간 고객 이름 포함)이 웹 서버·네이버로 나간다 — 사용자가 켠 경우에만.
// ═══════════════════════════════════════════════════════════════════
const CS_KEYS = { map: 'calsync_map', opt: 'calsync_opt', state: 'calsync_state' };
const CS_FS = 'https://firestore.googleapis.com/v1/projects/ympaint-86457/databases/(default)/documents';
const CS_FS_KEY = 'AIzaSyDdXNSnNwsAX_kCzbbfOa8p0iYRDpQR2VU';   // 웹 앱 공개 키 (firebase-init.js 와 같음)
const CS_NAVER = 'https://caldav.calendar.naver.com';
const CS_NAVER_LABEL = '네이버 캘린더';
const CS_COLORS = { '상담': '#2383E2', '청약': '#0F7B6C', '전화': '#D9730D', '서류': '#9065B0', '기타': '#787774' };
let _csBusy = false;

function _csGet(keys) { return new Promise(r => { try { chrome.storage.local.get(keys, v => r(v || {})); } catch (e) { r({}); } }); }
function _csSet(obj) { return new Promise(r => { try { chrome.storage.local.set(obj, () => r()); } catch (e) { r(); } }); }
async function csOptions() { const o = (await _csGet([CS_KEYS.opt]))[CS_KEYS.opt] || {}; return { web: !!o.web, naver: !!o.naver, hideName: !!o.hideName }; }
async function csSetOptions(p) { const o = Object.assign(await csOptions(), p); await _csSet({ [CS_KEYS.opt]: o }); return o; }
async function csState() { return (await _csGet([CS_KEYS.state]))[CS_KEYS.state] || {}; }
async function _csSetState(p) { const s = Object.assign(await csState(), p); await _csSet({ [CS_KEYS.state]: s }); try { document.dispatchEvent(new Event('calsync-state')); } catch (e) {} }

// 맞춰 볼 내용 (이게 같으면 같은 일정)
const _csSig = e => JSON.stringify([String(e.title || ''), String(e.date || ''), String(e.time || ''), String(e.memo || ''), !!e.done]);
const _csInWindow = d => { const t = Date.parse(d); if (isNaN(t)) return false; const now = Date.now(); return t > now - 120 * 864e5 && t < now + 400 * 864e5; };
// 네이버로 보낼 제목 — '이름 가리기' 를 켜면 홍길동 → 홍○동
function _csMask(name) { name = String(name || ''); return name.length <= 1 ? name : name.length === 2 ? name[0] + '○' : name[0] + '○'.repeat(name.length - 2) + name[name.length - 1]; }
function _csOutTitle(e, opt) {
  let t = String(e.title || e.customerName || e.type || '일정');
  if (opt && opt.hideName && e.customerName) t = t.split(e.customerName).join(_csMask(e.customerName));
  return t;
}

// ══════════════ 웹 워크스페이스 (Firestore REST) ══════════════
function _fsVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
function _fsPlain(f) {
  const o = {};
  Object.keys(f || {}).forEach(k => {
    const v = f[k];
    o[k] = 'stringValue' in v ? v.stringValue : 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? Number(v.integerValue)
      : 'doubleValue' in v ? v.doubleValue : 'timestampValue' in v ? v.timestampValue : null;
  });
  return o;
}
async function _fsFetch(url, opt) {
  const o = Object.assign({ headers: { 'Content-Type': 'application/json' } }, opt);
  let r = await fetch(url + (url.includes('?') ? '&' : '?') + 'key=' + CS_FS_KEY, o);
  if (r.status === 403) r = await fetch(url, o);   // 키가 웹 주소 전용으로 묶여 있으면 키 없이 (문서 규칙이 허용하는 범위)
  if (!r.ok) throw new Error('웹 워크스페이스 응답 ' + r.status);
  return r.status === 204 ? null : r.json();
}
async function _csOwners() {
  const ids = typeof _gcUserIds === 'function' ? await _gcUserIds() : [];
  if (!ids.length) throw new Error('웹 워크스페이스 계정을 모릅니다 — 확장에 로그인했는지 확인하세요');
  // 웹 계정 문서(users/{id})가 있는 이름으로 저장 — 웹이 같은 계정으로 읽음
  let owner = ids[0];
  for (const id of ids) {
    try { const r = await fetch(`${CS_FS}/users/${encodeURIComponent(id)}?key=${CS_FS_KEY}`); if (r.ok) { owner = id; break; } } catch (e) {}
  }
  return { owner, ids };
}
async function _csWebList(ids) {
  const res = await _fsFetch(CS_FS + ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: 'schedules' }],
    where: { fieldFilter: { field: { fieldPath: 'owner_id' }, op: 'IN', value: { arrayValue: { values: ids.slice(0, 10).map(_fsVal) } } } }
  } }) });
  return (res || []).filter(x => x.document).map(x => Object.assign(_fsPlain(x.document.fields), { _id: x.document.name.split('/').pop() }));
}
function _csToWeb(e, owner) {
  return { title: String(e.title || e.customerName || e.type || '일정'), datetime: e.date + (e.time ? ' ' + e.time : ''), memo: String(e.memo || ''),
    color: CS_COLORS[e.type] || CS_COLORS['기타'], owner_id: owner, source: 'ext', ext_id: e.id, ext_type: e.type || '기타',
    ext_done: !!e.done, ext_customer_id: e.customerId || '', updated_at: Date.now() };
}
function _csFromWeb(d) {
  const dt = String(d.datetime || '').replace('T', ' ');
  return { title: String(d.title || ''), date: dt.slice(0, 10), time: /\d{2}:\d{2}/.test(dt.slice(11, 16)) ? dt.slice(11, 16) : '', memo: String(d.memo || ''),
    type: d.ext_type || (/상담/.test(d.title || '') ? '상담' : '기타'), done: !!d.ext_done, customerId: d.ext_customer_id || '' };
}
async function _csWebPut(id, data) {
  const f = {}; Object.keys(data).forEach(k => { f[k] = _fsVal(data[k]); });
  if (!id) { f.created_at = _fsVal(new Date().toISOString().replace('T', ' ').slice(0, 19)); return (await _fsFetch(CS_FS + '/schedules', { method: 'POST', body: JSON.stringify({ fields: f }) })).name.split('/').pop(); }
  const mask = Object.keys(data).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  await _fsFetch(`${CS_FS}/schedules/${id}?${mask}`, { method: 'PATCH', body: JSON.stringify({ fields: f }) });
  return id;
}
async function _csWebDel(id) { try { await _fsFetch(`${CS_FS}/schedules/${id}`, { method: 'DELETE' }); } catch (e) { if (!/404/.test(e.message)) throw e; } }

// ══════════════ 네이버 캘린더 (CalDAV) ══════════════
async function _csNaverCred() {
  if (typeof vaultIsUnlocked !== 'function' || !vaultIsUnlocked()) return null;
  const list = await vaultGet('creds');
  return list.find(c => String(c['보험사'] || '').replace(/\s/g, '') === CS_NAVER_LABEL.replace(/\s/g, '') && c['ID'] && c['비밀번호']) || null;
}
function _csAuth(c) { return 'Basic ' + btoa(unescape(encodeURIComponent(String(c['ID']).replace(/@naver\.com$/i, '') + ':' + String(c['비밀번호']).replace(/\s/g, '')))); }
async function _dav(url, method, auth, body, headers) {
  const r = await fetch(url, { method, headers: Object.assign({ Authorization: auth, 'Content-Type': 'application/xml; charset=utf-8' }, headers || {}), body, credentials: 'omit' });
  if (r.status === 401 || r.status === 403) throw new Error('네이버 로그인 실패 — 아이디와 애플리케이션 비밀번호를 확인하세요');
  return r;
}
const _xmlDoc = t => new DOMParser().parseFromString(t, 'application/xml');
const _xq = (node, local) => Array.prototype.filter.call(node.getElementsByTagName('*'), n => n.localName === local);
const _abs = (base, href) => new URL(href, base).href;
// 캘린더 주소 찾기: 내 정보 → 캘린더 모음 → 일정을 담는 첫 캘린더 (찾은 주소는 기억)
async function _csNaverCal(auth) {
  const st = await csState();
  if (st.naverCal) return st.naverCal;
  const pf = b => `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${b}</d:propfind>`;
  let r = await _dav(CS_NAVER + '/.well-known/caldav', 'PROPFIND', auth, pf('<d:prop><d:current-user-principal/></d:prop>'), { Depth: '0' });
  if (r.status === 404 || r.status === 405) r = await _dav(CS_NAVER + '/', 'PROPFIND', auth, pf('<d:prop><d:current-user-principal/></d:prop>'), { Depth: '0' });
  const base = r.url || CS_NAVER + '/';
  const pr = _xq(_xmlDoc(await r.text()), 'current-user-principal')[0];
  const phref = pr && _xq(pr, 'href')[0];
  if (!phref) throw new Error('네이버 캘린더 정보를 찾지 못했습니다 (' + r.status + ')');
  const purl = _abs(base, phref.textContent.trim());
  r = await _dav(purl, 'PROPFIND', auth, pf('<d:prop><c:calendar-home-set/></d:prop>'), { Depth: '0' });
  const hs = _xq(_xmlDoc(await r.text()), 'calendar-home-set')[0];
  const hh = hs && _xq(hs, 'href')[0];
  if (!hh) throw new Error('네이버 캘린더 모음을 찾지 못했습니다');
  const home = _abs(purl, hh.textContent.trim());
  r = await _dav(home, 'PROPFIND', auth, pf('<d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/></d:prop>'), { Depth: '1' });
  const cals = _xq(_xmlDoc(await r.text()), 'response').map(x => {
    const href = (_xq(x, 'href')[0] || {}).textContent || '';
    const isCal = _xq(x, 'calendar').length > 0;
    const comps = _xq(x, 'comp').map(c => c.getAttribute('name'));
    const name = ((_xq(x, 'displayname')[0] || {}).textContent || '').trim();
    return { href: _abs(home, href.trim()), isCal, ev: !comps.length || comps.includes('VEVENT'), name };
  }).filter(c => c.isCal && c.ev);
  if (!cals.length) throw new Error('일정을 넣을 네이버 캘린더가 없습니다');
  const pick = cals.find(c => /내\s*캘린더|기본/.test(c.name)) || cals[0];
  await _csSetState({ naverCal: pick.href, naverCalName: pick.name });
  return pick.href;
}
const _icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const _icsUn = s => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
function _csToIcs(e, opt) {
  const d = e.date.replace(/-/g, ''), now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  let when;
  if (e.time) {
    const [h, m] = e.time.split(':').map(Number);
    const end = new Date(Date.UTC(+e.date.slice(0, 4), +e.date.slice(5, 7) - 1, +e.date.slice(8, 10), h + 1, m));
    const ed = end.toISOString().slice(0, 10).replace(/-/g, '') + 'T' + String(end.getUTCHours()).padStart(2, '0') + String(end.getUTCMinutes()).padStart(2, '0') + '00';
    when = [`DTSTART;TZID=Asia/Seoul:${d}T${e.time.replace(':', '')}00`, `DTEND;TZID=Asia/Seoul:${ed}`];
  } else {
    const n = new Date(Date.UTC(+e.date.slice(0, 4), +e.date.slice(5, 7) - 1, +e.date.slice(8, 10) + 1)).toISOString().slice(0, 10).replace(/-/g, '');
    when = [`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${n}`];
  }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//sangdam-helper//KO', 'CALSCALE:GREGORIAN',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Seoul', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT', 'UID:sdh-' + e.id, 'DTSTAMP:' + now, ...when,
    'SUMMARY:' + _icsEsc(_csOutTitle(e, opt)), e.memo ? 'DESCRIPTION:' + _icsEsc(e.memo) : '',
    'CATEGORIES:' + _icsEsc(e.type || '기타'), e.done ? 'X-SDH-DONE:1' : '', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
}
function _csFromIcs(text) {
  const lines = String(text || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  let inEv = false, ev = null;
  for (const ln of lines) {
    if (ln === 'BEGIN:VEVENT') { inEv = true; ev = {}; continue; }
    if (ln === 'END:VEVENT') break;
    if (!inEv) continue;
    const i = ln.indexOf(':'); if (i < 0) continue;
    const head = ln.slice(0, i), val = ln.slice(i + 1), name = head.split(';')[0].toUpperCase();
    if (!(name in ev)) ev[name] = { head, val };
  }
  if (!ev || !ev.DTSTART) return null;
  const dv = ev.DTSTART.val, m = dv.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  let date = `${m[1]}-${m[2]}-${m[3]}`, time = m[4] ? `${m[4]}:${m[5]}` : '';
  if (m[7]) {   // UTC → 한국 시간
    const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 9, +m[5]));
    date = t.toISOString().slice(0, 10); time = t.toISOString().slice(11, 16);
  }
  const cat = ev.CATEGORIES ? _icsUn(ev.CATEGORIES.val).split(',')[0] : '';
  return { uid: ev.UID ? ev.UID.val : '', title: _icsUn(ev.SUMMARY ? ev.SUMMARY.val : ''), date, time, memo: _icsUn(ev.DESCRIPTION ? ev.DESCRIPTION.val : ''),
    type: CS_COLORS[cat] ? cat : (/상담/.test(ev.SUMMARY ? ev.SUMMARY.val : '') ? '상담' : '기타'), done: !!ev['X-SDH-DONE'], rrule: !!ev.RRULE };
}
async function _csNaverList(cal, auth) {
  const from = new Date(Date.now() - 120 * 864e5).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const to = new Date(Date.now() + 400 * 864e5).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const body = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop>
    <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${from}" end="${to}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const r = await _dav(cal, 'REPORT', auth, body, { Depth: '1' });
  if (!r.ok && r.status !== 207) throw new Error('네이버 일정 읽기 실패 (' + r.status + ')');
  return _xq(_xmlDoc(await r.text()), 'response').map(x => {
    const href = _abs(cal, ((_xq(x, 'href')[0] || {}).textContent || '').trim());
    const etag = ((_xq(x, 'getetag')[0] || {}).textContent || '').trim();
    const ev = _csFromIcs((_xq(x, 'calendar-data')[0] || {}).textContent || '');
    return ev ? Object.assign(ev, { href, etag }) : null;
  }).filter(Boolean);
}
async function _csNaverPut(cal, auth, e, link, opt) {
  const href = (link && link.n) || (cal.replace(/\/?$/, '/') + encodeURIComponent('sdh-' + e.id) + '.ics');
  const h = { 'Content-Type': 'text/calendar; charset=utf-8' };
  if (link && link.n && link.ne) h['If-Match'] = link.ne; else if (!(link && link.n)) h['If-None-Match'] = '*';
  let r = await _dav(href, 'PUT', auth, _csToIcs(e, opt), h);
  if (r.status === 412) { delete h['If-Match']; delete h['If-None-Match']; r = await _dav(href, 'PUT', auth, _csToIcs(e, opt), h); }   // 서버 쪽이 바뀌었으면 덮어씀(이쪽이 더 새 것일 때만 여기로 옴)
  if (!r.ok) throw new Error('네이버에 일정 저장 실패 (' + r.status + ')');
  return { href, etag: r.headers.get('ETag') || '' };
}
async function _csNaverDel(href, auth) { const r = await _dav(href, 'DELETE', auth); if (!r.ok && r.status !== 404) throw new Error('네이버 일정 삭제 실패 (' + r.status + ')'); }
// 연결 확인 (설정 화면 [연결 확인])
async function csNaverTest() {
  const c = await _csNaverCred(); if (!c) throw new Error(`🔑 비번에 보험사 이름 '${CS_NAVER_LABEL}' 로 네이버 아이디와 애플리케이션 비밀번호를 먼저 저장하세요`);
  await _csSetState({ naverCal: '' });
  const cal = await _csNaverCal(_csAuth(c));
  return (await csState()).naverCalName || cal;
}

// ══════════════ 한 번 맞추기 ══════════════
// 한 쪽(웹 또는 네이버)과 금고 일정을 맞춘다. side 객체가 그 쪽의 읽기/쓰기를 맡는다.
async function _csSyncSide(events, map, tomb, side) {
  const L = side.key, H = side.key + 'h';   // map 필드: 짝 id, 맞춘 내용
  const remote = await side.list();
  const byId = new Map(remote.map(x => [x.id, x]));          // 원격 문서 id/href → 항목
  const byExt = new Map(remote.filter(x => x.extId).map(x => [x.extId, x]));
  const evMap = new Map(events.map(e => [e.id, e]));
  let pushed = 0, pulled = 0, removed = 0, changed = false;
  const usedRemote = new Set();
  // ① 이쪽 일정 기준
  for (const e of events.slice()) {
    const lk = map[e.id] = map[e.id] || {};
    let r = lk[L] ? byId.get(lk[L]) : null;
    if (!r) r = byExt.get(e.id) || null;                       // 다른 PC 가 올린 같은 일정
    if (r) usedRemote.add(r.id);
    if (!r && lk[L]) {                                           // 짝이 원격에서 지워짐
      if (side.inScope(e) && lk[H] === _csSig(side.view ? side.view(e) : e)) { events.splice(events.indexOf(e), 1); evMap.delete(e.id); delete lk[L]; delete lk[H]; removed++; changed = true; continue; }
      delete lk[L];                                              // 이쪽이 그 뒤 고쳤으면 다시 올림
    }
    if (!r) {
      if (!side.inScope(e)) continue;
      const res = await side.put(e, null); lk[L] = res.id; if (res.etag !== undefined) lk.ne = res.etag; lk[H] = _csSig(side.view ? side.view(e) : e); pushed++; continue;
    }
    lk[L] = r.id; if (r.etag !== undefined && !lk.ne) lk.ne = r.etag;
    const rs = _csSig(r.ev), es = _csSig(side.view ? side.view(e) : e);
    if (rs === es) { lk[H] = es; if (r.etag !== undefined) lk.ne = r.etag; continue; }
    const extChanged = lk[H] ? es !== lk[H] : null, remChanged = lk[H] ? rs !== lk[H] : null;
    let pushIt;
    if (extChanged === null) pushIt = (e._u || 0) > (r.updatedAt || 0);   // 처음 맞추는 짝: 더 최근 것
    else if (extChanged && !remChanged) pushIt = true;
    else if (!extChanged && remChanged) pushIt = false;
    else pushIt = (e._u || 0) > (r.updatedAt || 0);
    if (pushIt) { const res = await side.put(e, r); lk[L] = res.id; if (res.etag !== undefined) lk.ne = res.etag; lk[H] = es; pushed++; }
    else { Object.assign(e, side.pick(r.ev, e)); lk[H] = rs; if (r.etag !== undefined) lk.ne = r.etag; pulled++; changed = true; }
  }
  // ② 이쪽에서 지운 일정 → 원격도 지움
  for (const id of Object.keys(map)) {
    if (evMap.has(id) || !map[id][L]) continue;
    // 이 PC 에서 짝을 맺었던 일정이 이제 없음 = 이쪽에서 지움 (다른 PC 에서 지운 것도 폴더 동기화로 여기 반영됨)
    const r = byId.get(map[id][L]);
    if (r) { await side.del(r); removed++; usedRemote.add(r.id); }
    delete map[id][L]; delete map[id][H]; delete map[id].ne;
  }
  // ③ 원격에만 있는 일정 → 이쪽으로
  for (const r of remote) {
    if (usedRemote.has(r.id)) continue;
    const id = r.extId || side.newId(r);
    if (evMap.has(id)) continue;
    if (tomb[id]) { await side.del(r); removed++; continue; }   // 이쪽에서 이미 지운 일정
    const e = Object.assign({ id, customerName: '', created: Date.now() }, side.pick(r.ev));
    events.push(e); evMap.set(id, e);
    map[id] = Object.assign(map[id] || {}, { [L]: r.id, [H]: _csSig(r.ev) }); if (r.etag !== undefined) map[id].ne = r.etag;
    pulled++; changed = true;
  }
  return { pushed, pulled, removed, changed };
}

function _csWebPass(events, map, tomb, ws) {
  return _csSyncSide(events, map, tomb, {
    key: 'w',
    list: async () => (await _csWebList(ws.ids)).map(d => ({ id: d._id, extId: d.source === 'ext' && d.ext_id ? d.ext_id : 'w:' + d._id, ev: _csFromWeb(d), updatedAt: d.updated_at || 0, src: d.source })),
    put: async (e, r) => ({ id: await _csWebPut(r ? r.id : '', _csToWeb(e, ws.owner)) }),
    del: async r => _csWebDel(r.id),
    view: e => Object.assign({}, e, { title: String(e.title || e.customerName || e.type || '일정') }),
    pick: ev => ev,
    inScope: () => true,
    ownedRemote: r => !!(r && r.src === 'ext'),
    newId: r => 'w:' + r.id
  });
}

async function csSync(opt) {
  opt = opt || {};
  if (_csBusy) return null;
  const o = await csOptions();
  if (!o.web && !o.naver) return null;
  if (typeof vaultIsUnlocked !== 'function' || !vaultIsUnlocked()) return null;
  _csBusy = true;
  const report = [];
  try {
    const events = await vaultGet('events');
    const map = (await _csGet([CS_KEYS.map]))[CS_KEYS.map] || {};
    const tomb = (((await _csGet(['vault_tomb']))['vault_tomb']) || {}).events || {};
    let changed = false;
    let webSide = null, wr = null;
    if (o.web) {
      try {
        webSide = await _csOwners();
        wr = await _csWebPass(events, map, tomb, webSide);
        changed = changed || wr.changed;
        await _csSetState({ webAt: Date.now(), webErr: '' });
      } catch (e) { await _csSetState({ webErr: String(e.message || e) }); report.push('웹 실패: ' + (e.message || e)); }
    }
    if (o.naver) {
      try {
        const c = await _csNaverCred();
        if (!c) throw new Error(`🔑 비번에 '${CS_NAVER_LABEL}' 계정이 없습니다`);
        const auth = _csAuth(c), cal = await _csNaverCal(auth);
        const r = await _csSyncSide(events, map, tomb, {
          key: 'n',
          list: async () => (await _csNaverList(cal, auth)).filter(x => !x.rrule).map(x => ({ id: x.href, etag: x.etag, extId: /^sdh-/.test(x.uid) ? x.uid.slice(4) : 'n:' + (x.uid || x.href).replace(/[^\w.-]/g, '').slice(-40), ev: x, updatedAt: 0 })),
          put: async (e, r) => { const res = await _csNaverPut(cal, auth, e, r ? { n: r.id, ne: map[e.id] && map[e.id].ne } : null, o); return { id: res.href, etag: res.etag }; },
          del: async r => _csNaverDel(r.id, auth),
          view: e => Object.assign({}, e, { title: _csOutTitle(e, o) }),
          pick: (ev, e) => ({ title: e && ev.title === _csOutTitle(e, o) ? e.title : ev.title, date: ev.date, time: ev.time, memo: ev.memo, type: ev.type, done: ev.done }),
          inScope: e => _csInWindow(e.date),
          ownedRemote: r => !!(r && /^sdh-/.test(r.ev.uid || '')),
          newId: r => 'n:' + (r.ev.uid || r.id).replace(/[^\w.-]/g, '').slice(-40)
        });
        changed = changed || r.changed;
        report.push(`네이버 ↑${r.pushed} ↓${r.pulled}${r.removed ? ' ✕' + r.removed : ''}`);
        if (r.changed && webSide) { try { const w2 = await _csWebPass(events, map, tomb, webSide); if (wr) ['pushed', 'pulled', 'removed'].forEach(k => { wr[k] += w2[k]; }); } catch (e) {} }   // 네이버에서 들어온 변경을 웹에도 바로
        await _csSetState({ naverAt: Date.now(), naverErr: '' });
      } catch (e) { await _csSetState({ naverErr: String(e.message || e) }); report.push('네이버 실패: ' + (e.message || e)); }
    }
    if (wr) report.unshift(`웹 ↑${wr.pushed} ↓${wr.pulled}${wr.removed ? ' ✕' + wr.removed : ''}`);
    await _csSet({ [CS_KEYS.map]: map });
    if (changed) { await vaultPut('events', events); try { document.dispatchEvent(new Event('calsync-pulled')); } catch (e) {} }
    if (opt.interactive && typeof showToast === 'function') showToast('🔄 ' + report.join(' · '));
    return report;
  } finally { _csBusy = false; }
}

// 자동: 일정을 저장하면 3초 뒤 · 화면이 열려 있는 동안 3분마다 · 금고를 열 때
let _csTimer = null;
document.addEventListener('vault-changed', e => { if (e.detail && e.detail.name === 'events' && !_csBusy) { clearTimeout(_csTimer); _csTimer = setTimeout(() => csSync({}), 3000); } });
document.addEventListener('vault-unlocked', () => setTimeout(() => csSync({}), 1500));
document.addEventListener('vault-synced', () => { clearTimeout(_csTimer); _csTimer = setTimeout(() => csSync({}), 2000); });
setInterval(() => { if (document.visibilityState === 'visible') csSync({}); }, 180000);
