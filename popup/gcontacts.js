// ═══════════════════════════════════════════════════════════════════
// 📇 폰 주소록 — 👤 고객 탭의 고객 전화번호를 구글 주소록에 등록 → 폰에 자동 동기화
//
//   · 워크스페이스에 이미 있는 구글 주소록 연동을 그대로 쓴다.
//     (워크스페이스 사이드바 🔗 Google → [📇 주소록 연동] 으로 연결해 둔 개인 구글계정)
//     서버 함수 gcalContact 가 저장된 구글 로그인으로 People API 를 부른다 → 확장에는
//     구글 비번·토큰이 오지 않는다.
//   · 같은 번호의 연락처가 이미 있으면 새로 만들지 않는다(기존 우선 — 서버 함수 규칙).
//   · 연락처 이름은 워크스페이스와 같은 패턴(users/{계정}.contact_name_pattern, 기본
//     '{프리픽스}{날짜} {이름}({생년}년)') · 같은 접두어(ㄴ./ㅈ.) 를 쓴다.
//   · 등록된 연락처 ID(google_contact_resource)는 고객과 함께 PC 금고에 저장 → 다시 눌러도 중복 없음.
// ═══════════════════════════════════════════════════════════════════
const GC_FN_URL = 'https://asia-northeast3-ympaint-86457.cloudfunctions.net/gcalContact';
const GC_PATTERN_DEFAULT = '{프리픽스}{날짜} {이름}({생년}년)';
const GC_KEYS = { userId: 'gcContactUserId', prefix: 'gcContactPrefix', pattern: 'gcContactPattern', auto: 'gcContactAuto' };
// 이름 형식에 쓸 수 있는 칸 — 웹 워크스페이스(jmin.js JMIN_CONTACT_VARS)와 같음
const GC_VARS = [
  { key: '{프리픽스}', label: '프리픽스', desc: 'ㄴ. 또는 ㅈ.' }, { key: '{이름}', label: '이름', desc: '고객명 + 님' },
  { key: '{날짜}', label: '등록날짜', desc: 'YYMMDD' }, { key: '{생년}', label: '출생년도', desc: 'YY' },
  { key: '{생년월일}', label: '생년월일', desc: 'YYMMDD' }, { key: '{연도}', label: '연도', desc: 'YYYY' },
  { key: '{월}', label: '월', desc: 'MM' }, { key: '{일}', label: '일', desc: 'DD' }, { key: '{전화}', label: '전화번호', desc: '연락처' }
];
let _gcAuto = true;   // PC 에 저장할 때 폰 주소록에도 자동 등록 (웹 워크스페이스의 '상담 저장 시 자동 등록' 과 같음)

let _gcPattern = null;     // 워크스페이스에서 읽은 이름 패턴
let _gcPrefix = 'ㄴ.';
let _gcBusy = false;

function _gcStoreGet(keys) { return new Promise(r => { try { chrome.storage.local.get(keys, v => r(v || {})); } catch (e) { r({}); } }); }
function _gcStoreSet(obj) { return new Promise(r => { try { chrome.storage.local.set(obj, () => r()); } catch (e) { r(); } }); }

// 워크스페이스 계정 ID 후보 — 확장 로그인 이메일 기준 (jmin1318 ↔ jmin1318@naver.com 같은 사람)
async function _gcUserIds() {
  const st = await _gcStoreGet([GC_KEYS.userId, 'extEmail']);
  const user = window._fbAuth && window._fbAuth.currentUser;
  const email = String((user && user.email) || st.extEmail || '').trim();
  const out = [];
  const add = v => { v = String(v || '').trim(); if (v && !out.includes(v)) out.push(v); };
  add(st[GC_KEYS.userId]);
  add(email);
  if (email.includes('@')) { add(email.split('@')[0]); }
  return out;
}

// 워크스페이스의 이름 패턴·접두어 (users/{계정}) — 한 번만 읽음
async function _gcLoadSettings() {
  if (_gcPattern) return;
  _gcPattern = GC_PATTERN_DEFAULT;
  const st = await _gcStoreGet([GC_KEYS.prefix, GC_KEYS.pattern, GC_KEYS.auto]);
  if (st[GC_KEYS.prefix]) _gcPrefix = st[GC_KEYS.prefix];
  _gcAuto = st[GC_KEYS.auto] !== false;
  if (st[GC_KEYS.pattern]) { _gcPattern = st[GC_KEYS.pattern]; return; }   // 확장에서 바꾼 형식이 먼저
  try {
    if (!window._fbDb) return;
    for (const id of await _gcUserIds()) {
      const d = await window._fbDb.collection('users').doc(id).get();
      if (!d.exists) continue;
      const u = d.data() || {};
      if (u.contact_name_pattern) _gcPattern = u.contact_name_pattern;
      if (u.contact_name_prefix && !st[GC_KEYS.prefix]) _gcPrefix = u.contact_name_prefix;
      break;
    }
  } catch (e) { /* 못 읽으면 기본 패턴 */ }
}

// 워크스페이스 jminApplyPattern 과 같은 규칙
function gcContactName(c, prefix) {
  const name = String(c['고객명'] || '').trim();
  const phone = String(c['연락처'] || '').trim();
  let yyyy, mm, dd;
  const dm = String(c['등록일'] || c['수정일'] || '').match(/(\d{4})\D?(\d{2})\D?(\d{2})/);
  if (dm) { yyyy = dm[1]; mm = dm[2]; dd = dm[3]; }
  else { const n = new Date(); yyyy = String(n.getFullYear()); mm = String(n.getMonth() + 1).padStart(2, '0'); dd = String(n.getDate()).padStart(2, '0'); }
  const ymd = yyyy.slice(2) + mm + dd;
  let b6 = String(c['생년월일'] || '').replace(/[^0-9]/g, '');
  if (b6.length < 6) { const r = String(c['주민등록번호'] || '').replace(/[^0-9]/g, ''); if (r.length >= 6) b6 = r.slice(0, 6); }
  const by = b6.length >= 8 ? b6.slice(2, 4) : (b6.length >= 6 ? b6.slice(0, 2) : (b6.length === 4 ? b6.slice(2, 4) : (b6.length === 2 ? b6 : '')));
  return (_gcPattern || GC_PATTERN_DEFAULT)
    .replace(/\{프리픽스\}/g, prefix || _gcPrefix)
    .replace(/\{이름\}/g, name ? name + '님' : '')
    .replace(/\{날짜\}/g, ymd)
    .replace(/\{생년\}/g, by || '')
    .replace(/\{생년월일\}/g, b6.slice(0, 6))
    .replace(/\{연도\}/g, yyyy).replace(/\{월\}/g, mm).replace(/\{일\}/g, dd)
    .replace(/\{전화\}/g, phone)
    .replace(/\(\s*년\)/g, '').replace(/\s{2,}/g, ' ').trim();   // 생년을 모르면 '(년)' 지움
}

// 한 명 등록 → { status: 'created'|'matched'|'linked'|'nolink'|'error', resourceName?, error? }
async function gcSyncOne(c) {
  const phone = String(c['연락처'] || '').trim();
  const digits = phone.replace(/\D/g, '');
  if (!c['고객명'] || digits.length < 9) return { status: 'error', error: '이름·전화번호 필요' };
  if (/[\*●·]/.test(phone)) return { status: 'error', error: '마스킹된 번호' };
  await _gcLoadSettings();
  const name = gcContactName(c);
  for (const userId of await _gcUserIds()) {
    let r;
    try {
      r = await fetch(GC_FN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, name, phone, resourceName: c.google_contact_resource || '' }) });
    } catch (e) { return { status: 'error', error: '서버 연결 실패: ' + (e.message || e) }; }
    if (r.status === 401) continue;                     // 이 계정 ID 로는 주소록 미연동 → 다음 후보
    const d = await r.json().catch(() => null);
    if (!d) return { status: 'error', error: '응답 오류' };
    if (d.error) return { status: 'error', error: String(d.error) };
    await _gcStoreSet({ [GC_KEYS.userId]: userId });     // 맞는 계정 ID 기억
    return { status: d.matched ? 'matched' : (d.linked ? 'linked' : 'created'), resourceName: d.resourceName || '' };
  }
  return { status: 'nolink' };
}

const GC_NOLINK_MSG = '구글 주소록이 연결되어 있지 않습니다.\n\n워크스페이스(ympaint-86457.web.app) → 사이드바 🔗 Google → [📇 주소록 연동] 에서\n폰과 동기화된 개인 구글계정을 한 번 연결해 주세요. 그 뒤로는 여기서 바로 등록됩니다.';

async function _gcSaveResource(c, res) {
  if (!res.resourceName || c.google_contact_resource === res.resourceName) return;
  c.google_contact_resource = res.resourceName;
  c['주소록등록일'] = (typeof _cuNow === 'function') ? _cuNow() : new Date().toISOString();
  cuStore.replace(c);
  try { await cuStore.persist(); } catch (e) {}
}

async function gcSyncCustomer(c) {
  if (_gcBusy) return;
  _gcBusy = true;
  try {
    const res = await gcSyncOne(c);
    if (res.status === 'nolink') { await showAlert(GC_NOLINK_MSG, '📇 폰 주소록'); return; }
    if (res.status === 'error') { await showAlert(`${c['고객명'] || ''}: ${res.error}`, '📇 폰 주소록'); return; }
    await _gcSaveResource(c, res);
    showToast(res.status === 'matched' ? '📇 같은 번호의 연락처가 이미 있어 그대로 두었습니다'
      : res.status === 'linked' ? '📇 이미 주소록에 등록된 고객입니다'
      : '📇 폰 주소록에 등록했습니다: ' + gcContactName(c));
    if (!cuStore.editing()) cuRenderList();
  } finally { _gcBusy = false; }
}

async function gcSyncAll() {
  if (_gcBusy) return;
  const targets = cuStore.list().filter(c => !c.google_contact_resource && String(c['연락처'] || '').replace(/\D/g, '').length >= 9 && !/[\*●·]/.test(String(c['연락처'] || '')));
  if (!targets.length) { await showAlert('주소록에 새로 등록할 고객이 없습니다.\n(이미 등록됐거나 전화번호가 없는 고객만 있음)', '📇 폰 주소록'); return; }
  await _gcLoadSettings();
  const ok = await showConfirm(`전화번호가 있고 아직 주소록에 없는 고객 ${targets.length}명을 구글 주소록에 등록합니다.\n이름 형식 예: ${gcContactName(targets[0])}\n같은 번호의 연락처가 이미 있으면 새로 만들지 않습니다.`, '📇 전체 주소록 등록');
  if (!ok) return;
  _gcBusy = true;
  const cnt = { created: 0, matched: 0, linked: 0, error: 0 };
  const errs = [];
  try {
    for (let i = 0; i < targets.length; i++) {
      showToast(`📇 주소록 등록 중… ${i + 1}/${targets.length}`);
      const c = targets[i];
      const res = await gcSyncOne(c);
      if (res.status === 'nolink') { await showAlert(GC_NOLINK_MSG, '📇 폰 주소록'); return; }
      if (res.status === 'error') { cnt.error++; errs.push(`${c['고객명'] || ''}: ${res.error}`); continue; }
      cnt[res.status]++;
      await _gcSaveResource(c, res);
    }
  } finally { _gcBusy = false; if (!cuStore.editing()) cuRenderList(); }
  await showAlert(`새로 등록 ${cnt.created}명 · 기존 연락처 유지 ${cnt.matched}명 · 이미 등록 ${cnt.linked}명` +
    (cnt.error ? `\n실패 ${cnt.error}명\n` + errs.slice(0, 5).join('\n') : '') +
    '\n\n폰에는 구글 주소록 동기화가 켜져 있으면 몇 분 안에 나타납니다.', '📇 전체 주소록 등록 결과');
}

// ── 📇 번호저장 메뉴 (웹 워크스페이스의 '번호 저장 방식' 과 같은 모양) ──
function gcOpenGuide() {
  const url = chrome.runtime.getURL('contacts-guide.html');
  try { chrome.tabs.create({ url }); } catch (e) { window.open(url, '_blank'); }
}
async function gcOpenSaveMenu(trigger, onSave) {
  document.getElementById('gcSaveMenu')?.remove();
  await _gcLoadSettings();
  const pop = document.createElement('div');
  pop.id = 'gcSaveMenu'; pop.className = 'gc-menu';
  pop.innerHTML = `
    <div class="gc-menu-t">📇 번호 저장 방식</div>
    <div class="gc-menu-row">
      <button type="button" class="gc-pfx${_gcPrefix === 'ㄴ.' ? ' on' : ''}" data-p="ㄴ.">ㄴ. 저장</button>
      <button type="button" class="gc-pfx${_gcPrefix === 'ㅈ.' ? ' on' : ''}" data-p="ㅈ.">ㅈ. 저장</button>
    </div>
    <div class="gc-menu-prev">저장 이름: <b class="gc-prev-name"></b></div>
    <div class="gc-menu-row">
      <button type="button" class="gc-sub" data-a="pattern">⚙️ 이름 형식 설정</button>
      <button type="button" class="gc-sub gc-help" data-a="guide" title="사용법">?</button>
    </div>`;
  document.body.appendChild(pop);
  const sample = () => { try { if (typeof _cuEdit !== 'undefined' && _cuEdit) { _cuReadFields(); return _cuEdit; } } catch (e) {} return { '고객명': '홍길동', '생년월일': '830520' }; };
  pop.querySelector('.gc-prev-name').textContent = gcContactName(sample(), _gcPrefix);
  const r = trigger.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(window.innerWidth - 230, r.left)) + 'px';
  pop.style.top = (r.bottom + 230 > window.innerHeight ? Math.max(8, r.top - 200) : r.bottom + 6) + 'px';
  const close = () => { pop.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = e => { if (!pop.contains(e.target) && e.target !== trigger) close(); };
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  pop.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.p) {
      _gcPrefix = b.dataset.p; await _gcStoreSet({ [GC_KEYS.prefix]: _gcPrefix });   // 마지막에 고른 방식이 기본값
      const sel = document.getElementById('gcPrefix'); if (sel) sel.value = _gcPrefix;
      close(); if (onSave) onSave(_gcPrefix);
    } else if (b.dataset.a === 'pattern') { close(); gcOpenPatternPanel(); }
    else if (b.dataset.a === 'guide') { close(); gcOpenGuide(); }
  });
}

// ── ⚙️ 이름 형식 설정 창 ──
async function gcOpenPatternPanel() {
  document.getElementById('gcPatBack')?.remove();
  await _gcLoadSettings();
  const back = document.createElement('div');
  back.id = 'gcPatBack'; back.className = 'gc-pat-back';
  back.innerHTML = `<div class="gc-pat">
    <div class="gc-pat-t">⚙️ 폰 주소록 이름 형식</div>
    <div class="gc-pat-s">아래 칸을 눌러 넣거나 직접 고쳐 쓰세요. 웹 워크스페이스와 같은 형식입니다.</div>
    <input class="gc-pat-in" value="">
    <div class="gc-pat-vars">${GC_VARS.map(v => `<button type="button" data-k="${v.key}" title="${v.desc}">${v.label}<small>${v.key}</small></button>`).join('')}</div>
    <div class="gc-pat-prev">미리보기 · <b class="gc-pat-ex"></b></div>
    <label class="gc-pat-auto"><input type="checkbox" class="gc-pat-autock"> PC 에 저장할 때 폰 주소록에도 자동으로 등록 (전화번호가 있는 고객)</label>
    <div class="gc-pat-act">
      <button type="button" class="btn-secondary" data-a="def">기본값으로</button>
      <button type="button" class="cred-link" data-a="guide">📖 사용법</button>
      <span class="cred-sp"></span>
      <button type="button" class="btn-secondary" data-a="cancel">취소</button>
      <button type="button" class="btn-primary" data-a="save">저장</button>
    </div></div>`;
  document.body.appendChild(back);
  const inp = back.querySelector('.gc-pat-in'), ex = back.querySelector('.gc-pat-ex'), ck = back.querySelector('.gc-pat-autock');
  inp.value = _gcPattern || GC_PATTERN_DEFAULT; ck.checked = _gcAuto;
  const sampleC = { '고객명': '홍길동', '생년월일': '830520', '연락처': '010-1234-5678', '등록일': (typeof _cuNow === 'function' ? _cuNow() : '') };
  const prev = () => { const keep = _gcPattern; _gcPattern = inp.value.trim() || GC_PATTERN_DEFAULT; ex.textContent = gcContactName(sampleC, _gcPrefix); _gcPattern = keep; };
  prev(); inp.addEventListener('input', prev);
  back.addEventListener('click', async e => {
    if (e.target === back) { back.remove(); return; }
    const k = e.target.closest('[data-k]');
    if (k) { const a = inp.selectionStart ?? inp.value.length, z = inp.selectionEnd ?? a; inp.value = inp.value.slice(0, a) + k.dataset.k + inp.value.slice(z); inp.focus(); inp.selectionStart = inp.selectionEnd = a + k.dataset.k.length; prev(); return; }
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'cancel') back.remove();
    else if (b.dataset.a === 'def') { inp.value = GC_PATTERN_DEFAULT; prev(); }
    else if (b.dataset.a === 'guide') gcOpenGuide();
    else if (b.dataset.a === 'save') {
      _gcPattern = inp.value.trim() || GC_PATTERN_DEFAULT; _gcAuto = ck.checked;
      await _gcStoreSet({ [GC_KEYS.pattern]: _gcPattern, [GC_KEYS.auto]: _gcAuto });
      back.remove();
      if (typeof showToast === 'function') showToast('💾 이름 형식 저장: ' + gcContactName(sampleC, _gcPrefix));
    }
  });
  setTimeout(() => inp.focus(), 30);
}

// ── 🔄 자동 등록 — PC 에 저장할 때 아직 주소록에 없는 고객이면 등록 ──
let _gcNolinkShown = false;
document.addEventListener('cu-saved', async e => {
  const c = e.detail; if (!c) return;
  if (window.__gcSkipAutoOnce) { window.__gcSkipAutoOnce = false; return; }
  await _gcLoadSettings();
  if (!_gcAuto) return;
  const phone = String(c['연락처'] || '');
  if (phone.replace(/\D/g, '').length < 9 || /[\*●·]/.test(phone)) return;
  const nm = gcContactName(c);
  if (c.google_contact_resource) return;   // 이미 주소록에 있음 (서버는 기존 연락처 이름을 바꾸지 않음)
  const res = await gcSyncOne(c);
  if (res.status === 'nolink') { if (!_gcNolinkShown) { _gcNolinkShown = true; showToast('📇 구글 주소록 미연결 — 자동 등록을 건너뜀 (📖 사용법 참고)'); } return; }
  if (res.status === 'error') { showToast('📇 주소록 자동 등록 실패: ' + res.error); return; }
  const cur = cuStore.find(c.id) || c;
  if (res.resourceName) cur.google_contact_resource = res.resourceName;
  cur['주소록이름'] = nm; cur['주소록번호'] = phone;
  cur['주소록등록일'] = cur['주소록등록일'] || (typeof _cuNow === 'function' ? _cuNow() : '');
  cuStore.replace(cur);
  try { await cuStore.persist(); } catch (err) {}
  showToast(res.status === 'created' ? '📇 폰 주소록에도 등록: ' + nm : '📇 폰 주소록 확인됨: ' + nm);
  if (!cuStore.editing()) cuRenderList();
});

document.addEventListener('DOMContentLoaded', async () => {
  try { if (window._extAuthReady && !(await window._extAuthReady)) return; } catch (e) { return; }
  const pane = document.getElementById('tab-cust');
  if (!pane) return;
  const pfx = document.getElementById('gcPrefix');
  if (pfx) {
    pfx.addEventListener('change', () => { _gcPrefix = pfx.value; _gcStoreSet({ [GC_KEYS.prefix]: pfx.value }); });
    _gcLoadSettings().then(() => { if (Array.from(pfx.options).some(o => o.value === _gcPrefix)) pfx.value = _gcPrefix; });
  }
  pane.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'gc-all') { gcSyncAll(); return; }
    if (b.dataset.act === 'gc-one') {
      const row = b.closest('.cred-row');
      const c = row && cuStore.find(row.dataset.id);
      if (c) gcSyncCustomer(c);
      return;
    }
    if (b.dataset.act === 'gc-menu') {       // 연락처 옆 📇 번호저장 → ㄴ./ㅈ. 고르면 PC 저장 + 주소록 등록
      e.preventDefault();
      gcOpenSaveMenu(b, async () => {
        window.__gcSkipAutoOnce = true;                 // 아래에서 직접 등록하므로 자동 등록은 한 번 건너뜀
        let c; try { c = await cuSave(); } finally { window.__gcSkipAutoOnce = false; }
        if (c) { await gcSyncCustomer(c); const cur = cuStore.find(c.id); if (cur) { cur['주소록이름'] = gcContactName(cur); cur['주소록번호'] = cur['연락처']; cuStore.replace(cur); try { await cuStore.persist(); } catch (err) {} } }
      });
      return;
    }
    if (b.dataset.act === 'gc-set') { gcOpenPatternPanel(); return; }
    if (b.dataset.act === 'gc-guide') { gcOpenGuide(); return; }
    if (b.dataset.act === 'gc-form') {       // 입력 화면: 저장 후 등록
      const c = await cuSave();
      if (c) gcSyncCustomer(c);
    }
  });
});
