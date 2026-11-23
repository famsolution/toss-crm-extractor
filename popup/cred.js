// ═══════════════════════════════════════════════════════════════════
// 🔑 보험사 전산 비번 — 이 PC 의 금고(popup/vault.js, PIN 암호화)에만 저장한다.
//   · 지금 열린 탭이 보험사 사이트면 그 보험사의 ID/비번을 맨 위에 보여준다 (탭도 자동 전환)
//   · 전체 목록 확인 · 검색 · 등록 · 수정 · 삭제
//   필드는 워크스페이스 비번 탭과 같은 이름(구분/보험사/ID/비밀번호/생년월일/년월일/순서/비고)을 쓴다.
//   ⚠️ 서버(Firestore)로 보내지 않는다. 보험사 목록·주소 판별은 insurer-sites.js.
// ═══════════════════════════════════════════════════════════════════

let _credList = [];          // [{doc_id, 구분, 보험사, ID, 비밀번호, ...}]
let _credFilter = 'all';     // all | loss | life
let _credQuery = '';
let _credEditId = null;      // 수정 중인 doc_id ('' = 신규)
let _credSiteNames = [];     // 지금 탭 사이트에 해당하는 보험사 이름들
let _credSites = [];         // 사용자가 계정에 연결한 주소 [{base, cid, name}] (chrome.storage.local 'cred_sites')
let _credTab = null;         // 지금 보고 있는 탭 {id, url}
let _credLk = { base: '', names: [], cids: [] };   // 지금 탭 주소 판별 결과
// 보험사 사이트가 아닌 게 분명한 곳 — '계정 연결' 안내를 띄우지 않음
const CRED_NOT_INSURER = /^(tossinsu\.com|ohmymanager\.com|web\.app|firebaseapp\.com|vercel\.app|google\.com|naver\.com|kakao\.com|daum\.net|youtube\.com|github\.com)$/;
const _credShown = new Set();   // 비번을 펼쳐 보인 doc_id

function _credEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _credNewId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ── 🌐 계정 ↔ 사이트 주소 연결 ──
async function _credLoadSites() {
  const st = await new Promise(r => { try { chrome.storage.local.get(CRED_SITES_KEY, v => r(v || {})); } catch (e) { r({}); } });
  _credSites = Array.isArray(st[CRED_SITES_KEY]) ? st[CRED_SITES_KEY] : [];
}
async function _credSaveSites() {
  await new Promise(r => { try { chrome.storage.local.set({ [CRED_SITES_KEY]: _credSites }, () => r()); } catch (e) { r(); } });
}
// 계정 하나의 연결 주소를 정한다 (base 가 '' 이면 연결 해제). 한 계정에 주소 하나.
async function _credSetSite(cid, base, name) {
  _credSites = _credSites.filter(m => m.cid !== cid);
  if (base) _credSites.push({ base, cid, name: name || '' });
  await _credSaveSites();
}
function _credSiteOf(cid) { const m = _credSites.find(x => x.cid === cid); return m ? m.base : ''; }
function _credRefreshLookup() { _credLk = _credLookupUrl(_credTab && _credTab.url, _credSites); _credSiteNames = _credLk.names; }

// 지금 탭에 계정 카드를 바로 띄운다 (방금 연결한 주소는 아직 스크립트가 없으니 넣어 준다)
async function _credPokeTab() {
  if (!_credTab || !_credTab.id) return;
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: _credTab.id }, func: () => !!window.__tossCredCardBound });
    if (r && r.result) chrome.tabs.sendMessage(_credTab.id, { action: 'credCardRetry' }, () => { void chrome.runtime.lastError; });
    else await chrome.scripting.executeScript({ target: { tabId: _credTab.id }, files: ['insurer-card.js'] });
  } catch (e) { /* 크롬 내부 페이지 등은 넣을 수 없음 */ }
}

async function credLinkCurrentSite(cid) {
  const c = _credFind(cid);
  if (!c || !_credLk.base) return;
  await _credSetSite(cid, _credLk.base, c['보험사']);
  if (!c['사이트'] && _credTab && _credTab.url) {
    try { c['사이트'] = new URL(_credTab.url).origin; await _credPersist(); } catch (e) {}
  }
  _credRefreshLookup();
  credRender();
  showToast(`🌐 ${_credLk.base} 에서 ${c['보험사']} 계정이 뜨도록 연결했습니다`);
  _credPokeTab();
}

async function credLoad() {
  const box = document.getElementById('credList');
  if (!vaultIsUnlocked()) return;
  try { _credList = await vaultGet('creds'); }
  catch (e) {
    if (box) box.innerHTML = '<div class="cred-empty">불러오기 실패: ' + _credEsc(e.message || e) + '</div>';
    return;
  }
  credRender();
  try { await vaultWriteCardCache(_credList); } catch (e) {}   // 사이트 카드 10초 미리보기용 사본 갱신
}
async function _credPersist() {
  await vaultPut('creds', _credList);
  try { await vaultWriteCardCache(_credList); } catch (e) {}
}

function _credRow(c, highlight) {
  const id = c.doc_id;
  const shown = _credShown.has(id);
  const pw = String(c['비밀번호'] || '');
  const pwDisp = pw ? (shown ? _credEsc(pw) : '•'.repeat(Math.min(pw.length, 10))) : '-';
  const site = _credSiteOf(c.doc_id);
  const extra = [site && ('🌐 ' + site), c['생년월일'] && ('생년월일 ' + c['생년월일']), c['년월일'] && ('년월일 ' + c['년월일']), c['비고']].filter(Boolean).map(_credEsc).join(' · ');
  const type = c['구분'] === '생명보험' ? '생보' : (c['구분'] === '손해보험' ? '손보' : '');
  return `
    <div class="cred-row${highlight ? ' hit' : ''}" data-id="${_credEsc(id)}">
      <div class="cred-top">
        <span class="cred-ins">${_credEsc(c['보험사'] || '(보험사 없음)')}</span>
        ${type ? `<span class="cred-type">${type}</span>` : ''}
        <span class="cred-sp"></span>
        <button class="cred-ic" data-act="edit" title="수정">✏️</button>
        <button class="cred-ic" data-act="del" title="삭제">🗑</button>
      </div>
      <div class="cred-kv"><span class="k">ID</span><span class="v">${_credEsc(c['ID'] || '-')}</span>
        ${c['ID'] ? '<button class="cred-copy" data-act="copy-id">복사</button>' : ''}</div>
      <div class="cred-kv"><span class="k">비번</span><span class="v mono">${pwDisp}</span>
        ${pw ? `<button class="cred-copy" data-act="toggle">${shown ? '숨김' : '보기'}</button><button class="cred-copy" data-act="copy-pw">복사</button>` : ''}</div>
      ${extra ? `<div class="cred-extra">${extra}</div>` : ''}
    </div>`;
}

function credRender() {
  const box = document.getElementById('credList');
  const siteBox = document.getElementById('credSite');
  if (!box || !siteBox) return;

  // ① 지금 탭 보험사
  const hits = _credLk.base ? _credList.filter(c => _credMatchLookup(c, _credLk)) : [];
  const linkUI = () => _credList.length ? `
      <div class="cred-linkrow">
        <select id="credLinkSel">${_credList.slice().sort((a, b) => String(a['보험사'] || '').localeCompare(String(b['보험사'] || ''), 'ko'))
          .map(c => `<option value="${_credEsc(c.doc_id)}">${_credEsc(c['보험사'] || '')} · ${_credEsc(c['ID'] || '')}</option>`).join('')}</select>
        <button class="cred-copy" data-act="link-site">이 사이트에 연결</button>
        <button class="cred-link" data-act="new-site">+ 새 계정</button>
      </div>` : `<button class="cred-link" data-act="new-site">+ 이 사이트 계정 등록</button>`;
  if (hits.length) {
    siteBox.style.display = 'block';
    siteBox.innerHTML = `<div class="cred-site-hd">📍 지금 보고 있는 사이트 — ${_credEsc(_credSiteNames[0] || _credLk.base)}</div>` + hits.map(c => _credRow(c, true)).join('');
  } else if (_credSiteNames.length) {
    siteBox.style.display = 'block';
    siteBox.innerHTML = `<div class="cred-site-hd">📍 지금 보고 있는 사이트 — ${_credEsc(_credSiteNames[0])}</div>
      <div class="cred-empty">이 사이트에 맞는 계정을 못 찾았습니다. 계정을 골라 연결하면 다음부터 자동으로 뜹니다.</div>` + linkUI();
  } else if (_credLk.base && vaultIsUnlocked() && !CRED_NOT_INSURER.test(_credLk.base)) {
    // 보험사 목록에 없는 주소 — 여기가 보험사 사이트면 계정을 연결할 수 있게 (작게)
    siteBox.style.display = 'block';
    siteBox.innerHTML = `<div class="cred-site-hd cred-site-unknown">🌐 지금 사이트: ${_credEsc(_credLk.base)} — 보험사 사이트라면 계정을 연결하세요</div>` + linkUI();
  } else {
    siteBox.style.display = 'none';
    siteBox.innerHTML = '';
  }

  // ② 전체 목록
  const q = _credNorm(_credQuery);
  const data = _credList
    .filter(c => _credFilter === 'all' || (_credFilter === 'loss' ? c['구분'] === '손해보험' : c['구분'] === '생명보험'))
    .filter(c => !q || _credNorm(c['보험사']).includes(q) || _credNorm(c['ID']).includes(q) || _credNorm(c['비고']).includes(q))
    .sort((a, b) => ((a['순서'] || 99) - (b['순서'] || 99)) || String(a['보험사'] || '').localeCompare(String(b['보험사'] || ''), 'ko'));
  document.getElementById('credCount').textContent = `${data.length}개`;
  box.innerHTML = data.length ? data.map(c => _credRow(c, false)).join('') : '<div class="cred-empty">등록된 비번이 없습니다.</div>';
}

// ── 수정/등록 폼 ──
function credOpenForm(c, presetName) {
  _credEditId = c ? c.doc_id : '';
  const f = document.getElementById('credForm');
  const v = (id, val) => { const el = document.getElementById(id); if (el) el.value = val == null ? '' : val; };
  document.getElementById('credFormTit').textContent = c ? '✏️ 비번 수정' : '➕ 비번 등록';
  v('cf-type', (c && c['구분']) || (presetName && /생명|라이프/.test(presetName) ? '생명보험' : '손해보험'));
  v('cf-ins', (c && c['보험사']) || presetName || '');
  v('cf-id', c && c['ID']);
  v('cf-pw', c && c['비밀번호']);
  v('cf-birth', c && c['생년월일']);
  v('cf-birth8', c && c['년월일']);
  v('cf-order', c && c['순서'] != null ? c['순서'] : 99);
  v('cf-note', c && c['비고']);
  // 사이트 주소: 계정에 저장된 주소 → 연결된 도메인 → (새 계정이고 지금 탭이 웹사이트면) 지금 탭 주소
  v('cf-site', (c && (c['사이트'] || _credSiteOf(c.doc_id))) || (!c && _credLk.base && _credTab ? (() => { try { return new URL(_credTab.url).origin; } catch (e) { return ''; } })() : ''));
  f.style.display = 'block';
  f.scrollIntoView({ block: 'nearest' });
  document.getElementById('cf-ins').focus();
}
function credCloseForm() { _credEditId = null; document.getElementById('credForm').style.display = 'none'; }

async function credSaveForm() {
  const g = id => (document.getElementById(id)?.value || '').trim();
  const data = {
    구분: g('cf-type'), 보험사: g('cf-ins'), ID: g('cf-id'),
    비밀번호: document.getElementById('cf-pw')?.value || '',   // 비번은 공백도 그대로
    생년월일: g('cf-birth'), 년월일: g('cf-birth8'),
    순서: Number(g('cf-order')) || 99, 비고: g('cf-note'),
    사이트: g('cf-site')
  };
  if (!data.보험사) { await showAlert('보험사 이름을 입력하세요.'); return; }
  const siteBase = _credSiteBase(data.사이트);
  if (data.사이트 && !siteBase) { await showAlert('사이트 주소를 확인해 주세요. 예: https://sales.kbinsure.co.kr'); return; }
  if (!vaultIsUnlocked()) { await showAlert('금고가 잠겨 있습니다. PIN 으로 잠금을 풀어 주세요.'); return; }
  const before = _credList.slice();
  try {
    let cid = _credEditId;
    if (cid) {
      const i = _credList.findIndex(c => c.doc_id === cid);
      if (i >= 0) _credList[i] = Object.assign({}, _credList[i], data);
    } else {
      cid = _credNewId();
      _credList.push(Object.assign({}, data, { doc_id: cid }));
    }
    await _credPersist();
    // 내장 목록으로 이미 알아보는 주소면 따로 연결할 필요 없음 — 목록에 없는 주소만 연결
    const builtinHit = siteBase && _credBuiltinBases().has(siteBase) && _credMatchesNames(data, _credInsurersForUrl('https://' + siteBase));
    await _credSetSite(cid, builtinHit ? '' : siteBase, data.보험사);
    _credRefreshLookup();
    showToast(_credEditId ? '✏️ 수정했습니다' : '➕ 등록했습니다');
    credCloseForm();
    credRender();
    if (_credLk.cids.includes(cid) || _credMatchLookup(_credFind(cid), _credLk)) _credPokeTab();
  } catch (e) {
    _credList = before;
    await showAlert('저장 실패: ' + (e.message || e));
  }
}

async function credDelete(c) {
  const ok = await showConfirm(`${c['보험사'] || ''} (${c['ID'] || 'ID 없음'}) 비번을 삭제할까요?\n되돌릴 수 없습니다.`, '비번 삭제');
  if (!ok) return;
  const before = _credList.slice();
  try {
    _credList = _credList.filter(x => x.doc_id !== c.doc_id);
    await _credPersist();
    await _credSetSite(c.doc_id, '', '');
    _credRefreshLookup();
    credRender();
    showToast('🗑 삭제했습니다');
  } catch (e) {
    _credList = before;
    await showAlert('삭제 실패: ' + (e.message || e));
  }
}

async function credCopy(text, label) {
  try { await navigator.clipboard.writeText(String(text || '')); showToast(`📋 ${label} 복사됨`); }
  catch (e) { await showAlert('복사 실패: ' + (e.message || e)); }
}

function _credFind(id) { return _credList.find(c => c.doc_id === id); }

function _credOnClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'new-site') { credOpenForm(null, _credSiteNames[0] || ''); return; }
  if (act === 'link-site') { const sel = document.getElementById('credLinkSel'); if (sel && sel.value) credLinkCurrentSite(sel.value); return; }
  const row = btn.closest('.cred-row');
  const c = row && _credFind(row.dataset.id);
  if (!c) return;
  if (act === 'edit') credOpenForm(c);
  else if (act === 'del') credDelete(c);
  else if (act === 'copy-id') credCopy(c['ID'], 'ID');
  else if (act === 'copy-pw') credCopy(c['비밀번호'], '비번');
  else if (act === 'toggle') { if (_credShown.has(c.doc_id)) _credShown.delete(c.doc_id); else _credShown.add(c.doc_id); credRender(); }
}

// 페이지가 바뀌면(popup/autopage.js) 지금 사이트의 계정 목록을 다시 맞춘다. 보험사 사이트면 true
function credOnPageChange(tab) {
  _credTab = tab && /^https?:/.test(tab.url || '') ? { id: tab.id, url: tab.url } : null;
  _credRefreshLookup();
  try { if (vaultIsUnlocked()) credRender(); } catch (e) {}
  return !!(_credSiteNames.length || _credLk.cids.length);
}

function _credSwitchToTab() {
  const t = document.querySelector('.tab[data-tab="cred"]');
  if (t) t.click();
}

document.addEventListener('DOMContentLoaded', async () => {
  try { if (window._extAuthReady && !(await window._extAuthReady)) return; } catch (e) { return; }
  const pane = document.getElementById('tab-cred');
  if (!pane) return;
  pane.addEventListener('click', _credOnClick);
  document.getElementById('credSearch')?.addEventListener('input', e => { _credQuery = e.target.value; credRender(); });
  document.querySelectorAll('.cred-filter').forEach(b => b.addEventListener('click', () => {
    _credFilter = b.dataset.f;
    document.querySelectorAll('.cred-filter').forEach(x => x.classList.toggle('on', x === b));
    credRender();
  }));
  document.getElementById('credNewBtn')?.addEventListener('click', () => credOpenForm(null));
  document.getElementById('credReloadBtn')?.addEventListener('click', () => credLoad());
  document.getElementById('cf-save')?.addEventListener('click', credSaveForm);
  document.getElementById('cf-cancel')?.addEventListener('click', credCloseForm);
  document.getElementById('cf-pw-toggle')?.addEventListener('click', () => {
    const el = document.getElementById('cf-pw'); if (el) el.type = el.type === 'password' ? 'text' : 'password';
  });

  // 지금 탭이 보험사 사이트인지 — 맞으면 비번 탭으로 바로 전환
  await _credLoadSites();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    _credTab = tab && /^https?:/.test(tab.url || '') ? { id: tab.id, url: tab.url } : null;
  } catch (e) { _credTab = null; }
  _credRefreshLookup();
  if (_credSiteNames.length || _credLk.cids.length) _credSwitchToTab();
  // 🔑 사이트 자동 표시 설정 (insurer-card.js) — 비밀이 아니라 그냥 저장
  const auto = document.getElementById('credAutoChk');
  if (auto) {
    chrome.storage.local.get('credCardAuto', st => { auto.checked = st.credCardAuto !== false; });
    auto.addEventListener('change', () => chrome.storage.local.set({ credCardAuto: auto.checked }));
  }
  // 🔓 PIN 없이 처음 10초 보기 설정
  const pv = document.getElementById('credPreviewChk');
  if (pv) {
    vaultCardPreviewEnabled().then(on => { pv.checked = on; });
    pv.addEventListener('change', () => vaultSetCardPreview(pv.checked));
  }
  // 금고를 풀면 지금 보고 있는 보험사 탭에 계정 카드를 바로 다시 띄운다
  document.addEventListener('vault-unlocked', async () => {
    credLoad();
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && (_credSiteNames.length || _credLk.cids.length)) chrome.tabs.sendMessage(tab.id, { action: 'credCardRetry' }, () => { void chrome.runtime.lastError; });
    } catch (e) {}
  });
  if (vaultIsUnlocked()) credLoad();
});
