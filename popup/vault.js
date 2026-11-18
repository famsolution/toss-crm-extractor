// ═══════════════════════════════════════════════════════════════════
// 🔐 PC 금고 — 보험사 비번·고객정보를 이 PC 의 크롬 확장 저장소(chrome.storage.local)에
//   PIN 으로 암호화해 저장한다. (서버·워크스페이스로는 보내지 않음)
//
//   · 암호화: PBKDF2-SHA256(PIN, salt, 310,000회) → AES-GCM 256. 항목마다 새 IV.
//   · 잠금 해제한 키는 chrome.storage.session(메모리, 디스크 X)에 30분 보관 →
//     팝업을 닫았다 열어도 30분 안이면 PIN 을 다시 묻지 않는다. 브라우저를 닫으면 사라진다.
//   · PIN 을 잊으면 복구 불가 — '초기화' 로 금고를 비우고 새로 시작해야 한다.
//
//   저장 키 (chrome.storage.local)
//     vault_meta      { v, salt, iter, check:{iv,ct} }   ← PIN 확인용 (평문 'ok' 를 암호화)
//     vault_<이름>     { iv, ct }                         ← JSON 배열을 암호화한 것
// ═══════════════════════════════════════════════════════════════════

const VAULT_META_KEY = 'vault_meta';
const VAULT_SESSION_KEY = 'vault_session';
const VAULT_ITER = 310000;
const VAULT_IDLE_MS = 30 * 60 * 1000;

let _vaultKey = null;        // CryptoKey (잠금 해제 상태일 때만)
const _vaultUnlockWaiters = [];

const _vb64 = {
  enc(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); },
  dec(str) { const s = atob(str); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
};

function _vStoreGet(area, keys) {
  return new Promise(r => { try { chrome.storage[area].get(keys, v => r(v || {})); } catch (e) { r({}); } });
}
function _vStoreSet(area, obj) {
  return new Promise((r, j) => { try { chrome.storage[area].set(obj, () => { const e = chrome.runtime && chrome.runtime.lastError; e ? j(new Error(e.message)) : r(); }); } catch (e) { j(e); } });
}
function _vStoreRemove(area, keys) {
  return new Promise(r => { try { chrome.storage[area].remove(keys, () => r()); } catch (e) { r(); } });
}

async function _vDeriveKey(pin, salt, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function _vEncrypt(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return { iv: _vb64.enc(iv), ct: _vb64.enc(ct) };
}
async function _vDecrypt(key, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _vb64.dec(box.iv) }, key, _vb64.dec(box.ct));
  return new TextDecoder().decode(pt);
}

async function vaultIsSetUp() {
  const st = await _vStoreGet('local', [VAULT_META_KEY]);
  return !!(st[VAULT_META_KEY] && st[VAULT_META_KEY].salt);
}
function vaultIsUnlocked() { return !!_vaultKey; }

async function _vRememberSession() {
  try {
    const key = _vaultKey;
    if (!key) return;
    const raw = await crypto.subtle.exportKey('raw', key);
    if (_vaultKey !== key) return;   // 그 사이 잠겼으면 세션 키를 되살리지 않는다
    await _vStoreSet('session', { [VAULT_SESSION_KEY]: { k: _vb64.enc(raw), exp: Date.now() + VAULT_IDLE_MS } });
  } catch (e) { /* session 저장소가 없으면 팝업을 열 때마다 PIN 을 묻는다 */ }
}

// 30분 안에 잠금 해제했던 키가 남아 있으면 그대로 쓴다
async function _vRestoreSession() {
  try {
    const st = await _vStoreGet('session', [VAULT_SESSION_KEY]);
    const s = st[VAULT_SESSION_KEY];
    if (!s || !s.k || !(s.exp > Date.now())) return false;
    _vaultKey = await crypto.subtle.importKey('raw', _vb64.dec(s.k), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    await _vRememberSession();   // 사용 중이면 30분 연장
    return true;
  } catch (e) { _vaultKey = null; return false; }
}

async function vaultSetup(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await _vDeriveKey(pin, salt, VAULT_ITER);
  const check = await _vEncrypt(key, 'ok');
  await _vStoreSet('local', { [VAULT_META_KEY]: { v: 1, salt: _vb64.enc(salt), iter: VAULT_ITER, check } });
  _vaultKey = key;
  await _vRememberSession();
  _vNotifyUnlocked();
}

async function vaultUnlock(pin) {
  const st = await _vStoreGet('local', [VAULT_META_KEY]);
  const m = st[VAULT_META_KEY];
  if (!m) throw new Error('금고가 아직 만들어지지 않았습니다.');
  const key = await _vDeriveKey(pin, _vb64.dec(m.salt), m.iter || VAULT_ITER);
  try { if (await _vDecrypt(key, m.check) !== 'ok') return false; } catch (e) { return false; }
  _vaultKey = key;
  await _vRememberSession();
  _vNotifyUnlocked();
  return true;
}

async function vaultLock() {
  _vaultKey = null;
  await _vStoreRemove('session', [VAULT_SESSION_KEY]);
}

// 저장된 배열 읽기/쓰기 — 잠겨 있으면 오류
async function vaultGet(name) {
  if (!_vaultKey) throw new Error('잠겨 있습니다');
  const k = 'vault_' + name;
  const st = await _vStoreGet('local', [k]);
  if (!st[k]) return [];
  const arr = JSON.parse(await _vDecrypt(_vaultKey, st[k]));
  return Array.isArray(arr) ? arr : [];
}
async function vaultPut(name, arr) {
  if (!_vaultKey) throw new Error('잠겨 있습니다');
  await _vStoreSet('local', { ['vault_' + name]: await _vEncrypt(_vaultKey, JSON.stringify(arr || [])) });
  await _vRememberSession();
}

// PIN 변경 — 모든 항목을 새 키로 다시 암호화
async function vaultChangePin(oldPin, newPin, names) {
  if (!(await vaultUnlock(oldPin))) return false;
  const data = {};
  for (const n of names) data[n] = await vaultGet(n);
  await vaultSetup(newPin);
  for (const n of names) await vaultPut(n, data[n]);
  return true;
}

async function vaultReset(names) {
  await _vStoreRemove('local', [VAULT_META_KEY].concat(names.map(n => 'vault_' + n)));
  await vaultLock();
}

function vaultWhenUnlocked() {
  return _vaultKey ? Promise.resolve(true) : new Promise(r => _vaultUnlockWaiters.push(r));
}
function _vNotifyUnlocked() {
  while (_vaultUnlockWaiters.length) { try { _vaultUnlockWaiters.shift()(true); } catch (e) {} }
  document.querySelectorAll('.vault-gate').forEach(g => g.remove());
  document.querySelectorAll('.vault-body').forEach(b => { b.style.display = ''; });
  try { document.dispatchEvent(new Event('vault-unlocked')); } catch (e) {}
}

const VAULT_NAMES = ['creds', 'customers'];

// ── 💻 다른 PC 로 옮기기 — 암호화된 그대로 내보내고/가져온다 (PIN 은 파일에 없음) ──
const VAULT_FILE_APP = 'toss-crm-extractor-vault';
const VAULT_EXTRA_KEYS = ['cu_health_tpl', 'credCardAuto'];   // 암호화 대상은 아니지만 같이 옮길 설정
async function vaultExportFile() {
  if (!_vaultKey) throw new Error('먼저 PIN 으로 금고를 열어 주세요.');
  const keys = [VAULT_META_KEY].concat(VAULT_NAMES.map(n => 'vault_' + n), VAULT_EXTRA_KEYS);
  const st = await _vStoreGet('local', keys);
  if (!st[VAULT_META_KEY]) throw new Error('금고가 없습니다.');
  const counts = {};
  for (const n of VAULT_NAMES) { try { counts[n] = (await vaultGet(n)).length; } catch (e) { counts[n] = 0; } }
  return { app: VAULT_FILE_APP, v: 1, exportedAt: new Date().toISOString(), counts, data: st };
}
function vaultParseFile(obj) {
  if (!obj || obj.app !== VAULT_FILE_APP || !obj.data || !obj.data[VAULT_META_KEY] || !obj.data[VAULT_META_KEY].check)
    throw new Error('토스인슈 CRM 추출기 금고 백업 파일이 아닙니다.');
  return obj;
}
async function vaultImportFile(obj) {
  vaultParseFile(obj);
  const keep = {};
  [VAULT_META_KEY].concat(VAULT_NAMES.map(n => 'vault_' + n), VAULT_EXTRA_KEYS).forEach(k => { if (obj.data[k] !== undefined) keep[k] = obj.data[k]; });
  await _vStoreRemove('local', [VAULT_META_KEY].concat(VAULT_NAMES.map(n => 'vault_' + n)));
  await _vStoreSet('local', keep);
  await vaultLock();   // 가져온 금고는 백업한 PC 의 PIN 으로 연다
}

// 잠금 화면 — 금고를 쓰는 탭(.vault-body 를 가진 tab-content) 안에 그린다
async function vaultRenderGate(pane) {
  if (!pane || _vaultKey) return;
  const body = pane.querySelector('.vault-body');
  if (body) body.style.display = 'none';
  if (pane.querySelector('.vault-gate')) return;
  const setUp = await vaultIsSetUp();
  const g = document.createElement('div');
  g.className = 'vault-gate';
  g.innerHTML = setUp ? `
      <div class="vg-ic">🔒</div>
      <div class="vg-t">PC 금고 잠김</div>
      <div class="vg-s">보험사 비번과 고객정보는 이 PC 에 암호화돼 있습니다.<br>PIN 을 입력하세요.</div>
      <input class="vg-in" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN">
      <button class="btn-primary vg-ok">잠금 해제</button>
      <div class="vg-msg"></div>
      <button class="cred-link vg-reset">PIN 을 잊었어요 (금고 초기화)</button>` : `
      <div class="vg-ic">🔐</div>
      <div class="vg-t">PC 금고 만들기</div>
      <div class="vg-s">보험사 비번과 고객정보를 이 PC 에만 암호화해 저장합니다.<br>
        잠금 PIN 을 정하세요 (4자리 이상). <b>PIN 을 잊으면 복구할 수 없습니다.</b></div>
      <input class="vg-in" type="password" inputmode="numeric" autocomplete="off" placeholder="새 PIN">
      <input class="vg-in2" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN 다시 입력">
      <button class="btn-primary vg-ok">금고 만들기</button>
      <div class="vg-msg"></div>
      <button class="cred-link pc-move-import">💻 다른 PC 의 금고 백업 가져오기</button>`;
  pane.insertBefore(g, pane.firstChild);
  const inp = g.querySelector('.vg-in'), inp2 = g.querySelector('.vg-in2'), msg = g.querySelector('.vg-msg'), ok = g.querySelector('.vg-ok');
  const go = async () => {
    const pin = inp.value;
    msg.textContent = '';
    if (!setUp) {
      if (pin.length < 4) { msg.textContent = 'PIN 은 4자리 이상이어야 합니다.'; return; }
      if (pin !== inp2.value) { msg.textContent = '두 PIN 이 다릅니다.'; return; }
      ok.disabled = true; ok.textContent = '만드는 중…';
      try { await vaultSetup(pin); } catch (e) { msg.textContent = '실패: ' + (e.message || e); ok.disabled = false; ok.textContent = '금고 만들기'; }
      return;
    }
    if (!pin) return;
    ok.disabled = true; ok.textContent = '확인 중…';
    let good = false;
    try { good = await vaultUnlock(pin); } catch (e) { msg.textContent = e.message || String(e); }
    if (!good) { if (!msg.textContent) msg.textContent = 'PIN 이 맞지 않습니다.'; ok.disabled = false; ok.textContent = '잠금 해제'; inp.select(); }
  };
  ok.addEventListener('click', go);
  [inp, inp2].forEach(el => el && el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(); } }));
  const im = g.querySelector('.pc-move-import');
  if (im) im.addEventListener('click', () => { if (typeof pcMoveImport === 'function') pcMoveImport(); });
  const rs = g.querySelector('.vg-reset');
  if (rs) rs.addEventListener('click', async () => {
    const y = await showConfirm('PC 금고를 초기화하면 이 PC 에 저장한 보험사 비번과 고객정보가 모두 지워지고 되돌릴 수 없습니다.\n계속할까요?', '금고 초기화');
    if (!y) return;
    await vaultReset(VAULT_NAMES);
    g.remove();
    vaultRenderGate(pane);
  });
  setTimeout(() => { try { inp.focus(); } catch (e) {} }, 30);
}

async function vaultLockAndShowGates() {
  await vaultLock();
  document.querySelectorAll('.tab-content.active').forEach(p => { if (p.querySelector('.vault-body')) vaultRenderGate(p); });
  ['tab-cred', 'tab-cust'].forEach(id => { const p = document.getElementById(id); if (p) vaultRenderGate(p); });
}

async function vaultChangePinFlow() {
  const oldPin = await showPrompt('현재 PIN', 'PIN 변경');
  if (oldPin == null) return;
  const newPin = await showPrompt('새 PIN (4자리 이상)', 'PIN 변경');
  if (newPin == null) return;
  if (String(newPin).length < 4) { await showAlert('PIN 은 4자리 이상이어야 합니다.'); return; }
  const again = await showPrompt('새 PIN 다시 입력', 'PIN 변경');
  if (again !== newPin) { await showAlert('두 PIN 이 다릅니다.'); return; }
  const ok = await vaultChangePin(String(oldPin), String(newPin), VAULT_NAMES);
  if (!ok) await showAlert('현재 PIN 이 맞지 않습니다.');
  else showToast('🔑 PIN 을 바꿨습니다');
}

// 팝업 시작 — 30분 안에 풀었던 금고면 자동 해제, 아니면 금고 탭들에 잠금 화면
document.addEventListener('DOMContentLoaded', async () => {
  try { if (window._extAuthReady && !(await window._extAuthReady)) return; } catch (e) { return; }
  const restored = await _vRestoreSession();
  if (restored) _vNotifyUnlocked();
  else ['tab-cred', 'tab-cust'].forEach(id => vaultRenderGate(document.getElementById(id)));
  document.querySelectorAll('.vault-lock-btn').forEach(b => b.addEventListener('click', vaultLockAndShowGates));
  document.querySelectorAll('.vault-pin-btn').forEach(b => b.addEventListener('click', vaultChangePinFlow));
});
