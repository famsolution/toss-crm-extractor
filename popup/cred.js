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
const _credShown = new Set();   // 비번을 펼쳐 보인 doc_id

function _credEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _credNewId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

async function credLoad() {
  const box = document.getElementById('credList');
  if (!vaultIsUnlocked()) return;
  try { _credList = await vaultGet('creds'); }
  catch (e) {
    if (box) box.innerHTML = '<div class="cred-empty">불러오기 실패: ' + _credEsc(e.message || e) + '</div>';
    return;
  }
  credRender();
}
async function _credPersist() { await vaultPut('creds', _credList); }

function _credRow(c, highlight) {
  const id = c.doc_id;
  const shown = _credShown.has(id);
  const pw = String(c['비밀번호'] || '');
  const pwDisp = pw ? (shown ? _credEsc(pw) : '•'.repeat(Math.min(pw.length, 10))) : '-';
  const extra = [c['생년월일'] && ('생년월일 ' + c['생년월일']), c['년월일'] && ('년월일 ' + c['년월일']), c['비고']].filter(Boolean).map(_credEsc).join(' · ');
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
  if (_credSiteNames.length) {
    const hits = _credList.filter(c => _credMatchesNames(c, _credSiteNames));
    siteBox.style.display = 'block';
    siteBox.innerHTML = `<div class="cred-site-hd">📍 지금 보고 있는 사이트 — ${_credEsc(_credSiteNames[0])}</div>` +
      (hits.length ? hits.map(c => _credRow(c, true)).join('')
        : `<div class="cred-empty">이 보험사로 등록된 계정이 없습니다. <button class="cred-link" data-act="new-site">+ 등록</button></div>`);
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
    순서: Number(g('cf-order')) || 99, 비고: g('cf-note')
  };
  if (!data.보험사) { await showAlert('보험사 이름을 입력하세요.'); return; }
  if (!vaultIsUnlocked()) { await showAlert('금고가 잠겨 있습니다. PIN 으로 잠금을 풀어 주세요.'); return; }
  const before = _credList.slice();
  try {
    if (_credEditId) {
      const i = _credList.findIndex(c => c.doc_id === _credEditId);
      if (i >= 0) _credList[i] = Object.assign({}, _credList[i], data);
    } else {
      _credList.push(Object.assign({}, data, { doc_id: _credNewId() }));
    }
    await _credPersist();
    showToast(_credEditId ? '✏️ 수정했습니다' : '➕ 등록했습니다');
    credCloseForm();
    credRender();
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
  const row = btn.closest('.cred-row');
  const c = row && _credFind(row.dataset.id);
  if (!c) return;
  if (act === 'edit') credOpenForm(c);
  else if (act === 'del') credDelete(c);
  else if (act === 'copy-id') credCopy(c['ID'], 'ID');
  else if (act === 'copy-pw') credCopy(c['비밀번호'], '비번');
  else if (act === 'toggle') { if (_credShown.has(c.doc_id)) _credShown.delete(c.doc_id); else _credShown.add(c.doc_id); credRender(); }
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
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    _credSiteNames = _credInsurersForUrl(tab && tab.url);
  } catch (e) { _credSiteNames = []; }
  if (_credSiteNames.length) _credSwitchToTab();
  // 🔑 사이트 자동 표시 설정 (insurer-card.js) — 비밀이 아니라 그냥 저장
  const auto = document.getElementById('credAutoChk');
  if (auto) {
    chrome.storage.local.get('credCardAuto', st => { auto.checked = st.credCardAuto !== false; });
    auto.addEventListener('change', () => chrome.storage.local.set({ credCardAuto: auto.checked }));
  }
  // 금고를 풀면 지금 보고 있는 보험사 탭에 계정 카드를 바로 다시 띄운다
  document.addEventListener('vault-unlocked', async () => {
    credLoad();
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && _credInsurersForUrl(tab.url).length) chrome.tabs.sendMessage(tab.id, { action: 'credCardRetry' }, () => { void chrome.runtime.lastError; });
    } catch (e) {}
  });
  if (vaultIsUnlocked()) credLoad();
});
