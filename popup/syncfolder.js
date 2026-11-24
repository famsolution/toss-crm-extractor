// ═══════════════════════════════════════════════════════════════════
// 📁 폴더 동기화 — 보험사 비번·고객정보(건강정보 포함)를 원드라이브/구글드라이브 폴더의 파일 1개로
//   · 내가 고른 폴더(예: C:\Users\나\OneDrive\토스확장)에 '토스확장_금고.json' 을 둔다.
//     원드라이브·구글드라이브 PC 프로그램이 그 파일을 다른 PC 로 옮겨 주고, 다른 PC 의 확장도 같은
//     폴더를 연결하면 양쪽이 같은 내용을 쓴다(양방향).
//   · 파일은 금고와 똑같이 PIN 으로 암호화된 상태 그대로 — PIN 은 파일에 없다. 클라우드나 파일이
//     새도 PIN 없이는 못 연다. 모든 PC 가 같은 PIN 을 쓴다(폴더 파일의 PIN).
//   · 합치기: 항목마다 고친 시각(_u)을 비교해 나중에 고친 쪽을 쓰고, 지운 항목은 지운 시각으로 반영.
//   · 단계별 백업: 파일 내용이 바뀌기 직전 것을 '백업' 폴더에 남긴다.
//       최근 변경 20개 → 그보다 오래된 건 하루 1개(30일) → 그보다 오래된 건 한 달 1개(12개월)
//     백업도 암호화 상태. [백업에서 되돌리기] 로 고른 시점으로 되돌린다(되돌리기 직전도 백업됨).
//   · 폴더 권한: 크롬이 PC 를 다시 켠 뒤 한 번 '허용' 을 다시 묻는 경우가 있다 → [다시 허용] 한 번.
//     폴더 고르기·허용은 팝업이 아닌 큰 창(popup.html?full=1)에서 한다(팝업은 창이 뜨면 닫힘).
// ═══════════════════════════════════════════════════════════════════
const SF_FILE = '토스확장_금고.json';
const SF_BACKUP_DIR = '백업';
const SF_APP = 'toss-crm-extractor-sync';
const SF_KEEP = { recent: 20, days: 30, months: 12 };
const SF_STATE_KEY = 'sf_state';          // {folder, lastSync, lastError}
let _sfBusy = false, _sfTimer = null, _sfQuiet = false;

// ── 폴더 핸들 보관 (IndexedDB — 확장 팝업과 큰 창이 함께 씀) ──
function _sfDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('tce_sync', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('h');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function _sfHandle(set) {
  const db = await _sfDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('h', set === undefined ? 'readonly' : 'readwrite');
    const st = tx.objectStore('h');
    const q = set === undefined ? st.get('dir') : (set === null ? st.delete('dir') : st.put(set, 'dir'));
    q.onsuccess = () => res(set === undefined ? q.result || null : true); q.onerror = () => rej(q.error);
  });
}
function _sfStore(get, obj) {
  return new Promise(r => { try { obj ? chrome.storage.local.set(obj, () => r()) : chrome.storage.local.get(get, v => r(v || {})); } catch (e) { r({}); } });
}
async function _sfSetState(patch) {
  const st = (await _sfStore([SF_STATE_KEY]))[SF_STATE_KEY] || {};
  await _sfStore(null, { [SF_STATE_KEY]: Object.assign(st, patch) });
  sfRenderStatus();
}
const sfIsFull = () => /[?&]full=1\b/.test(location.search);

async function _sfPerm(h, ask) {
  const o = { mode: 'readwrite' };
  try {
    if ((await h.queryPermission(o)) === 'granted') return true;
    if (ask && (await h.requestPermission(o)) === 'granted') return true;
  } catch (e) {}
  return false;
}

// ── 폴더 연결 (큰 창에서, 버튼 클릭으로) ──
async function sfConnect() {
  if (!sfIsFull()) { sfOpenFull(); return; }
  if (!window.showDirectoryPicker) { await showAlert('이 크롬에서는 폴더 연결을 쓸 수 없습니다. 크롬을 최신으로 업데이트해 주세요.'); return; }
  let h;
  try { h = await window.showDirectoryPicker({ id: 'tce-sync', mode: 'readwrite' }); }
  catch (e) { return; }   // 취소
  if (!(await _sfPerm(h, true))) { await showAlert('폴더에 쓰기 권한이 없습니다.'); return; }
  await _sfHandle(h);
  await _sfSetState({ folder: h.name, lastError: '' });
  showToast('📁 \'' + h.name + '\' 폴더를 연결했습니다');
  await sfSync({ interactive: true });
}
async function sfDisconnect() {
  if (!(await showConfirm('폴더 동기화를 끊을까요?\n폴더의 파일과 이 PC 의 내용은 그대로 남습니다.', '폴더 동기화 끊기'))) return;
  await _sfHandle(null);
  await _sfSetState({ folder: '', lastSync: 0, lastError: '' });
}
function sfOpenFull() {
  const url = chrome.runtime.getURL('popup.html?full=1&tab=cred&sync=1');
  try { chrome.tabs.create({ url }); } catch (e) { window.open(url, '_blank'); }
}

// ── 파일 읽기/쓰기 ──
async function _sfRead(dir, name) {
  try { const fh = await dir.getFileHandle(name); return await (await fh.getFile()).text(); }
  catch (e) { if (e && e.name === 'NotFoundError') return null; throw e; }
}
async function _sfWrite(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text); await w.close();
}
const _sfStamp = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

// 단계별 백업: 최근 20개 + 하루 1개(30일) + 한 달 1개(12개월), 나머지는 지움
async function _sfBackup(dir, text) {
  const bd = await dir.getDirectoryHandle(SF_BACKUP_DIR, { create: true });
  const d = new Date();
  await _sfWrite(bd, '금고_' + _sfStamp(d) + '_' + String(d.getMilliseconds()).padStart(3, '0') + '.json', text);
  const names = [];
  for await (const [n, h] of bd.entries()) if (h.kind === 'file' && /^금고_\d{8}_\d{6}(_\d{3})?\.json$/.test(n)) names.push(n);
  names.sort().reverse();   // 최신부터
  const keep = new Set(names.slice(0, SF_KEEP.recent));
  const now = Date.now(), day = 864e5, seenD = new Set(), seenM = new Set();
  names.slice(SF_KEEP.recent).forEach(n => {
    const y = n.slice(3, 7), mo = n.slice(7, 9), d = n.slice(9, 11);
    const t = new Date(+y, +mo - 1, +d).getTime();
    if (now - t <= SF_KEEP.days * day) { if (!seenD.has(y + mo + d)) { seenD.add(y + mo + d); keep.add(n); } }
    else if (now - t <= SF_KEEP.months * 31 * day) { if (!seenM.has(y + mo)) { seenM.add(y + mo); keep.add(n); } }
  });
  for (const n of names) if (!keep.has(n)) { try { await bd.removeEntry(n); } catch (e) {} }
}

// ── PIN 묻기 (폴더 파일이 다른 PIN 으로 잠겨 있을 때) ──
async function _sfAskPin(meta, msg) {
  for (let i = 0; i < 3; i++) {
    const pr = showPrompt(msg + (i ? '\n\n❌ PIN 이 맞지 않습니다. 다시 입력하세요.' : ''), '폴더 파일 PIN');
    let inp = null; try { inp = __dlgEls().input; inp.type = 'password'; inp.value = ''; } catch (e) {}
    const pin = await pr;
    if (inp) inp.type = 'text';
    if (pin == null) return null;
    const key = await vaultKeyForMeta(meta, pin.trim());
    if (key) return key;
  }
  return null;
}

// ── 합치기 ──
function _sfMerge(name, a, b, tomb) {
  const m = new Map();
  [a, b].forEach(list => (list || []).forEach(r => {
    const id = vaultRecId(name, r); if (!id) return;
    const o = m.get(id);
    if (!o || (r._u || 0) > (o._u || 0)) m.set(id, r);
  }));
  const t = tomb || {};
  return Array.from(m.values()).filter(r => !(t[vaultRecId(name, r)] >= (r._u || 0)));
}
function _sfMergeTomb(a, b) {
  const out = {};
  VAULT_NAMES.forEach(n => {
    out[n] = Object.assign({}, (a || {})[n]);
    Object.entries((b || {})[n] || {}).forEach(([k, v]) => { if (!(out[n][k] >= v)) out[n][k] = v; });
    // 90일 지난 지운 표시는 정리
    Object.keys(out[n]).forEach(k => { if (Date.now() - out[n][k] > 90 * 864e5) delete out[n][k]; });
  });
  return out;
}
const _sfSort = (name, arr) => arr.slice().sort((x, y) => String(vaultRecId(name, x)).localeCompare(String(vaultRecId(name, y))));

// ── 동기화 한 번 ──
//   interactive: 사용자가 누른 경우(PIN 묻기·권한 다시 묻기 허용). 자동 실행은 조용히 건너뜀.
async function sfSync(opt) {
  opt = opt || {};
  if (_sfBusy) return false;
  const h = await _sfHandle().catch(() => null);
  if (!h) return false;
  if (!vaultIsUnlocked()) { if (opt.interactive) await showAlert('먼저 🔑 비번 탭에서 PIN 으로 금고를 열어 주세요.'); return false; }
  if (!(await _sfPerm(h, !!opt.interactive && sfIsFull()))) { await _sfSetState({ lastError: 'perm' }); return false; }
  _sfBusy = true;
  try {
    const text = await _sfRead(h, SF_FILE);
    const localMeta = await vaultMeta();
    const local = {};
    for (const n of VAULT_NAMES) local[n] = await vaultGet(n);
    const lst = await _sfStore([VAULT_TOMB_KEY].concat(VAULT_EXTRA_KEYS));
    let file = null, fileData = null, fileKey = null;
    if (text) {
      try { file = JSON.parse(text); } catch (e) { throw new Error('폴더의 ' + SF_FILE + ' 파일이 손상되었습니다. [백업에서 되돌리기] 를 쓰세요.'); }
      if (!file || file.app !== SF_APP || !file.meta || !file.meta.check) throw new Error(SF_FILE + ' 가 이 확장의 동기화 파일이 아닙니다.');
      if (file.meta.salt === localMeta.salt) fileKey = vaultCurrentKey();
      else {
        if (!opt.interactive) { await _sfSetState({ lastError: 'pin' }); return false; }
        fileKey = await _sfAskPin(file.meta, '폴더의 동기화 파일은 다른 PIN 으로 잠겨 있습니다.\n(다른 PC 에서 만든 파일이거나, PIN 을 바꾸기 전 파일)\n\n그 파일의 PIN 을 입력하면 이 PC 내용과 합치고, 앞으로 모든 PC 가 같은 PIN 을 씁니다.');
        if (!fileKey) return false;
      }
      fileData = {};
      for (const n of VAULT_NAMES) fileData[n] = file.data && file.data[n] ? JSON.parse(await vaultDecryptWith(fileKey, file.data[n])) : [];
    }
    // 합치기
    const tomb = _sfMergeTomb(lst[VAULT_TOMB_KEY], file && file.tomb);
    const merged = {};
    for (const n of VAULT_NAMES) merged[n] = _sfMerge(n, local[n], fileData && fileData[n], tomb[n]);
    const extras = {};
    VAULT_EXTRA_KEYS.forEach(k => {
      const fv = file && file.extras ? file.extras[k] : undefined, lv = lst[k];
      if (fv && lv && typeof fv === 'object' && typeof lv === 'object' && !Array.isArray(lv)) extras[k] = Object.assign({}, fv, lv);
      else extras[k] = lv !== undefined ? lv : fv;
    });
    // 어느 PIN 으로 갈지: 기본은 폴더 파일 쪽(처음 연결하는 PC 는 폴더 PIN 을 따름).
    //   이 PC 가 마지막 동기화 뒤에 PIN 을 바꾼 경우에만 이 PC 의 새 PIN 으로 파일을 다시 잠근다.
    const sst = (await _sfStore([SF_STATE_KEY]))[SF_STATE_KEY] || {};
    const pinChangedHere = !!sst.lastSync && (localMeta.at || 0) > sst.lastSync && (localMeta.at || 0) > (file && file.meta.at || 0);
    let meta = localMeta, key = vaultCurrentKey();
    if (file && file.meta.salt !== localMeta.salt && !pinChangedHere) {
      meta = file.meta; key = fileKey;
      await vaultAdoptMeta(meta, key);
    }
    // 이 PC 에 반영
    for (const n of VAULT_NAMES) await vaultPut(n, merged[n], { raw: true });
    const ext = {}; VAULT_EXTRA_KEYS.forEach(k => { if (extras[k] !== undefined) ext[k] = extras[k]; });
    await _sfStore(null, Object.assign({ [VAULT_TOMB_KEY]: tomb }, ext));
    // 폴더 파일에 반영 — 내용이 바뀔 때만(바뀌기 직전 파일은 백업)
    const same = file && file.meta.salt === meta.salt && VAULT_NAMES.every(n => JSON.stringify(_sfSort(n, fileData[n])) === JSON.stringify(_sfSort(n, merged[n])))
      && JSON.stringify(file.tomb || {}) === JSON.stringify(tomb) && JSON.stringify(file.extras || {}) === JSON.stringify(ext);
    if (!same) {
      const out = { app: SF_APP, v: 1, savedAt: new Date().toISOString(), counts: {}, meta, data: {}, tomb, extras: ext };
      for (const n of VAULT_NAMES) { out.counts[n] = merged[n].length; out.data[n] = await vaultEncryptWith(key, JSON.stringify(merged[n])); }
      if (text) await _sfBackup(h, text);
      await _sfWrite(h, SF_FILE, JSON.stringify(out));
    }
    await _sfSetState({ folder: h.name, lastSync: Date.now(), lastError: '' });
    _sfQuiet = true;
    try { if (typeof credLoad === 'function') await credLoad(); if (typeof cuLoad === 'function') await cuLoad(); } finally { _sfQuiet = false; }
    try { document.dispatchEvent(new Event('vault-synced')); } catch (e) {}
    if (opt.interactive) showToast('📁 동기화했습니다 — 비번 ' + merged.creds.length + '개 · 고객 ' + merged.customers.length + '명' + (merged.events ? ' · 일정 ' + merged.events.length + '개' : ''));
    return true;
  } catch (e) {
    await _sfSetState({ lastError: String(e && e.message || e) });
    if (opt.interactive) await showAlert('폴더 동기화 실패: ' + (e.message || e));
    return false;
  } finally { _sfBusy = false; }
}

// ── 백업에서 되돌리기 ──
async function sfRestore() {
  const h = await _sfHandle().catch(() => null);
  if (!h) { await showAlert('먼저 동기화 폴더를 연결해 주세요.'); return; }
  if (!vaultIsUnlocked()) { await showAlert('먼저 🔑 비번 탭에서 PIN 으로 금고를 열어 주세요.'); return; }
  if (!(await _sfPerm(h, sfIsFull()))) { await showAlert('폴더 권한을 다시 허용해야 합니다. [📁 다시 허용] 을 눌러 주세요.'); return; }
  let bd;
  try { bd = await h.getDirectoryHandle(SF_BACKUP_DIR); } catch (e) { await showAlert('아직 백업이 없습니다.'); return; }
  const list = [];
  for await (const [n, fh] of bd.entries()) if (fh.kind === 'file' && /^금고_\d{8}_\d{6}(_\d{3})?\.json$/.test(n)) list.push(n);
  list.sort().reverse();
  if (!list.length) { await showAlert('아직 백업이 없습니다.'); return; }
  const show = list.slice(0, 40);
  const fmt = n => `${n.slice(3, 7)}-${n.slice(7, 9)}-${n.slice(9, 11)} ${n.slice(12, 14)}:${n.slice(14, 16)}:${n.slice(16, 18)}`;
  const lines = [];
  for (let i = 0; i < show.length; i++) {
    let c = '';
    try { const o = JSON.parse(await (await (await bd.getFileHandle(show[i])).getFile()).text()); c = ` — 비번 ${o.counts?.creds ?? '?'}개 · 고객 ${o.counts?.customers ?? '?'}명`; } catch (e) {}
    lines.push(`${i + 1}. ${fmt(show[i])}${c}`);
  }
  const ans = await showPrompt('되돌릴 시점의 번호를 입력하세요. (지금 내용도 되돌리기 직전에 백업됩니다)\n\n' + lines.join('\n'), '백업에서 되돌리기', '1');
  const idx = parseInt(ans, 10) - 1;
  if (ans == null || !(idx >= 0 && idx < show.length)) return;
  if (!(await showConfirm(fmt(show[idx]) + ' 시점으로 되돌릴까요?\n모든 PC 가 이 내용으로 바뀝니다.', '백업에서 되돌리기'))) return;
  try {
    const o = JSON.parse(await (await (await bd.getFileHandle(show[idx])).getFile()).text());
    const meta = await vaultMeta();
    let key = vaultCurrentKey();
    if (o.meta.salt !== meta.salt) { key = await _sfAskPin(o.meta, '이 백업은 다른 PIN 으로 잠겨 있습니다. 그때의 PIN 을 입력하세요.'); if (!key) return; }
    const now = Date.now();
    const tomb = (await _sfStore([VAULT_TOMB_KEY]))[VAULT_TOMB_KEY] || {};
    for (const n of VAULT_NAMES) {
      const arr = o.data && o.data[n] ? JSON.parse(await vaultDecryptWith(key, o.data[n])) : [];
      const keepIds = new Set(arr.map(r => vaultRecId(n, r)));
      tomb[n] = tomb[n] || {};
      (await vaultGet(n)).forEach(r => { const id = vaultRecId(n, r); if (id && !keepIds.has(id)) tomb[n][id] = now; });
      arr.forEach(r => { r._u = now; delete tomb[n][vaultRecId(n, r)]; });   // 되돌린 내용이 다른 PC 것보다 '나중' 이 되게
      await vaultPut(n, arr, { raw: true });
    }
    await _sfStore(null, { [VAULT_TOMB_KEY]: tomb });
    await sfSync({ interactive: true });
    showToast('↩ ' + fmt(show[idx]) + ' 시점으로 되돌렸습니다');
  } catch (e) { await showAlert('되돌리기 실패: ' + (e.message || e)); }
}

// ── 상태 표시 (💻 다른 PC 에서 쓰기 창 · 🔑 비번 탭 아래) ──
async function sfRenderStatus() {
  const st = (await _sfStore([SF_STATE_KEY]))[SF_STATE_KEY] || {};
  const h = await _sfHandle().catch(() => null);
  let perm = false; if (h) perm = await _sfPerm(h, false);
  const t = st.lastSync ? new Date(st.lastSync).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  let msg, cls = '';
  if (!h) msg = '📁 폴더 동기화 꺼짐';
  else if (!perm) { msg = `📁 '${h.name}' — 크롬이 폴더 허용을 다시 묻습니다 → [다시 허용]`; cls = 'warn'; }
  else if (st.lastError === 'pin') { msg = `📁 '${h.name}' — 폴더 파일의 PIN 확인 필요 → [지금 동기화]`; cls = 'warn'; }
  else if (st.lastError && st.lastError !== 'perm') { msg = `📁 '${h.name}' — 실패: ${st.lastError}`; cls = 'warn'; }
  else msg = `📁 '${h.name}' 와 동기화됨${t ? ' · ' + t : ''}`;
  document.querySelectorAll('.sf-status').forEach(el => { el.textContent = msg; el.className = 'sf-status ' + cls; });
  document.querySelectorAll('.sf-need-conn').forEach(el => { el.style.display = h ? '' : 'none'; });
  document.querySelectorAll('.sf-reperm').forEach(el => { el.style.display = h && !perm ? '' : 'none'; });
}
async function sfReperm() {
  const h = await _sfHandle().catch(() => null);
  if (!h) return;
  if (!sfIsFull()) { sfOpenFull(); return; }   // 팝업에서는 허용 창을 띄울 수 없어 큰 창으로
  if (await _sfPerm(h, true)) { sfRenderStatus(); await sfSync({ interactive: true }); }
}

// ── 자동 동기화: 금고를 열 때 · 저장할 때(1.5초 모아서) · 큰 창은 1분마다 ──
document.addEventListener('vault-unlocked', () => { setTimeout(() => sfSync({}), 300); });
document.addEventListener('vault-changed', () => {
  if (_sfQuiet || _sfBusy) return;
  clearTimeout(_sfTimer); _sfTimer = setTimeout(() => sfSync({}), 1500);
});
document.addEventListener('DOMContentLoaded', () => {
  sfRenderStatus();
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-sf]'); if (!b) return;
    const a = b.dataset.sf;
    if (a === 'connect') sfConnect();
    else if (a === 'sync') sfSync({ interactive: true });
    else if (a === 'restore') sfRestore();
    else if (a === 'off') sfDisconnect();
    else if (a === 'reperm') sfReperm();
  });
  if (vaultIsUnlocked()) setTimeout(() => sfSync({}), 500);
  if (sfIsFull()) setInterval(() => { if (document.visibilityState === 'visible') sfSync({}); }, 60000);
  if (/[?&]sync=1\b/.test(location.search) && typeof pcMoveOpen === 'function') setTimeout(pcMoveOpen, 300);
});
