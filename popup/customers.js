// ═══════════════════════════════════════════════════════════════════
// 👤 고객 — 회원 개인정보·건강상태를 이 PC 금고(popup/vault.js, PIN 암호화)에 저장하고,
//   원할 때 [워크스페이스로 보내기] 로 토스 워크스페이스 고객 등록 화면에 채워 넣는다.
//
//   · 건강상태는 워크스페이스 건강고지와 같은 질문·같은 저장 형식(healthState)을 쓴다.
//     → 워크스페이스에서 그대로 보이고, 기존 고객이면 먼저 등록된 병력과 합쳐진다(덮어쓰지 않음).
//   · 보내기는 워크스페이스 화면의 등록/수정 창을 '채우기만' 한다. 저장은 워크스페이스에서
//     [저장] 을 눌러야 된다 — 기존 고객 병합·중복 방지 로직을 워크스페이스 쪽이 그대로 맡는다.
//   · 받는 함수 window.__applyExtCustomerFromExtension 는 워크스페이스 js/shared.js 에 있다.
//   · 건강상태 질문은 [✏️ 질문 편집] 으로 카테고리·질문을 추가/이름변경/삭제/순서변경 할 수 있다
//     (이 PC 의 chrome.storage.local 'cu_health_tpl' — 질문 문구는 개인정보가 아니라 암호화 안 함).
//     질문을 지우거나 순서를 바꾸면 저장된 모든 고객의 답변 위치도 함께 옮긴다.
//   · 토스 CRM 추출 → [📤 프로그램 적용] 에서 '🔐 내 확장에 저장' 을 고르면 routeVault 로 여기 저장된다.
//   · [⛶ 크게 보기] — 같은 화면을 큰 창(popup.html?full=1&tab=cust)으로 연다.
// ═══════════════════════════════════════════════════════════════════

// 워크스페이스 js/jmin.js 의 HEALTH_TPL·DRV_OPTS·MOTO_OPTS 와 같은 내용 (바뀌면 둘 다 고칠 것)
const CU_HEALTH_TPL = {
  categories: ['일반체', '간편(유병자)', '실비', '펫보험'],
  questions: {
    '일반체': [
      '1. 운전여부', '2. 원동기장치(오토바이등) 탑승여부',
      '3. 최근 3개월 이내에 의사로부터 진찰 또는 검사를 통하여 [질병확정진단, 질병의심소견, 치료, 입원, 수술, 투약]을 받은 사실이 있습니까?',
      '4. 최근 3개월 이내에 [마약을 사용하거나 혈압강하제, 신경안정제, 수면제, 각성제, 진통제 등 약물을 상시 복용]한 사실이 있습니까?',
      '5. 최근 1년 이내에 의사로부터 진찰 또는 검사를 받고, 이를 통하여 추가검사(재검사)를 받은 사실이 있습니까?',
      '6. 최근 5년 이내에 [입원, 수술, 7일 이상 치료, 30일 이상 투약]을 받은 사실이 있습니까?',
      '7. 최근 5년 이내에 [10대 질병]으로 [진단, 치료, 입원, 수술, 투약]을 받은 사실이 있습니까?',
      '8. 최근 6~10년 이내에 [입원, 수술]을 받은 사실이 있습니까?',
      '9. 최근 6~10년 이내에 [3대 질병]으로 [진단, 입원, 수술]을 받은 사실이 있습니까?',
      '10. 주민등록 발급일자 또는 운전면허 번호'
    ],
    '간편(유병자)': [
      '1. 운전여부', '2. 원동기장치(오토바이등)',
      '3. 최근 3개월 이내에 질병확정진단, 소견, 입원/수술/추가검사 필요소견을 받은 사실이 있습니까?',
      '4. 최근 5년 이내에 입원, 수술을 받은 사실이 있습니까?',
      '5. 최근 5년 이내에 6대 질병을 받은 사실이 있습니까?',
      '6. 최근 6~10년 이내에 입원, 수술을 받은 사실이 있습니까?',
      '7. 주민등록 발급일자 또는 운전면허 번호'
    ],
    '실비': ['1. 최근 3개월 이내 질병확정진단', '2. 최근 5년 이내 10대 질병 진단/치료/입원/수술'],
    '펫보험': ['1. 반려동물 이름/품종', '2. 최근 3개월 이내 치료/투약 이력', '3. 최근 1년 이내 수술/입원 이력', '4. 예방접종 여부']
  }
};
const CU_DRV_OPTS = ['운전 안함', '자가용', '영업용', '용달', '버스', '트럭', '기타(직접입력)'];
const CU_MOTO_OPTS = ['운전 안함', '오토바이', '전기자전거', '전기킥보드', '기타(직접입력)'];
const CU_TELCO = ['', 'SKT', 'KT', 'LGU+', '알뜰폰'];
const CU_TPL_KEY = 'cu_health_tpl';
let _cuTpl = JSON.parse(JSON.stringify(CU_HEALTH_TPL));   // 지금 쓰는 질문 템플릿 (편집 가능)
let _cuTplEdit = false;                                   // 질문 편집 모드
let _cuPendingImport = null;                              // 금고가 잠겨 있을 때 받은 추출 데이터

// 개인정보 칸 — key 는 워크스페이스 고객 필드명과 같다
const CU_FIELDS = [
  { k: '고객명', label: '이름', req: true },
  { k: '연락처', label: '연락처', ph: '010-0000-0000', mode: 'tel' },
  { k: '생년월일', label: '생년월일', ph: '830101', mode: 'numeric' },
  { k: '주민등록번호', label: '주민등록번호', ph: '000000-0000000', mode: 'numeric', secret: true },
  { k: '성별', label: '성별', opts: ['', '남', '여'] },
  { k: '통신사', label: '통신사', opts: CU_TELCO },
  { k: '직업', label: '직업' },
  { k: '하는일', label: '하는 일' },
  { k: '키', label: '키(cm)', mode: 'decimal' },
  { k: '몸무게', label: '몸무게(kg)', mode: 'decimal' },
  { k: '운전여부', label: '운전여부', opts: [''].concat(CU_DRV_OPTS.filter(o => o !== '기타(직접입력)')) },
  { k: '이메일', label: '이메일', mode: 'email' },
  { k: '주소', label: '주소', wide: true },
  { k: '메모', label: '메모', wide: true, area: true }
];

let _cuList = [];
let _cuQuery = '';
let _cuEdit = null;          // 편집 중인 고객 사본 (null = 목록 화면)
let _cuHealthCat = '일반체';

function _cuEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function _cuNow() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function _cuNewId() { return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// 질문 형식 — 워크스페이스 renderHealthQuestions 와 같은 판정
//   (질문을 지우거나 옮기면 번호가 바뀌므로 번호 대신 문구로 판정)
function _cuQText(q) { return String(q || '').replace(/^\s*\d+\s*[.)]\s*/, '').trim(); }
function _cuQType(q) {
  const t = _cuQText(q);
  if (/^운전\s*여부/.test(t)) return 'drv';
  if (/^원동기/.test(t)) return 'moto';
  if (t.includes('발급일자') || t.includes('면허 번호') || t.includes('이름/품종')) return 'single';
  return 'list';
}
function _cuQs(cat) { return (_cuTpl.questions && _cuTpl.questions[cat]) || []; }

async function _cuLoadTpl() {
  const st = await new Promise(r => { try { chrome.storage.local.get(CU_TPL_KEY, v => r(v || {})); } catch (e) { r({}); } });
  const t = st[CU_TPL_KEY];
  if (t && Array.isArray(t.categories) && t.questions) _cuTpl = t;
}
function _cuSaveTpl() { try { chrome.storage.local.set({ [CU_TPL_KEY]: _cuTpl }); } catch (e) {} }

// 실제 답변이 몇 개인지 (워크스페이스 healthHasAnswers 와 같은 기준)
function _cuHealthCount(h) {
  let n = 0;
  const st = (h && h.state) || {};
  Object.keys(st).forEach(cat => Object.keys(st[cat] || {}).forEach(i => {
    const v = st[cat][i];
    if (Array.isArray(v)) n += v.filter(x => String(x || '').trim()).length;
    else if (v && typeof v === 'object') { if (String(v.value || '').trim() || String(v.etc || '').trim()) n++; }
    else if (String(v || '').trim()) n++;
  }));
  return n;
}

async function cuLoad() {
  if (!vaultIsUnlocked()) return;
  try { _cuList = await vaultGet('customers'); }
  catch (e) { document.getElementById('cuList').innerHTML = '<div class="cred-empty">불러오기 실패: ' + _cuEsc(e.message || e) + '</div>'; return; }
  cuRenderList();
}
async function _cuPersist() { await vaultPut('customers', _cuList); }

// ── 목록 ──
function cuRenderList() {
  document.getElementById('cuListView').style.display = '';
  document.getElementById('cuFormView').style.display = 'none';
  const q = _cuQuery.replace(/\s/g, '').toLowerCase();
  const qd = q.replace(/[^0-9]/g, '');
  const data = _cuList
    .filter(c => !q || String(c['고객명'] || '').replace(/\s/g, '').toLowerCase().includes(q) || (qd && String(c['연락처'] || '').replace(/[^0-9]/g, '').includes(qd)))
    .sort((a, b) => String(b['수정일'] || '').localeCompare(String(a['수정일'] || '')));
  document.getElementById('cuCount').textContent = `${data.length}명`;
  document.getElementById('cuList').innerHTML = data.length ? data.map(c => {
    const hc = _cuHealthCount(c.health);
    const sub = [c['연락처'], c['생년월일']].filter(Boolean).map(_cuEsc).join(' · ');
    return `<div class="cred-row" data-id="${_cuEsc(c.id)}">
      <div class="cred-top">
        <span class="cred-ins">${_cuEsc(c['고객명'] || '(이름 없음)')}</span>
        ${hc ? `<span class="cred-type cu-hbadge">건강 ${hc}</span>` : ''}
        <span class="cred-sp"></span>
        <button class="cred-ic" data-act="edit" title="수정">✏️</button>
        <button class="cred-ic" data-act="del" title="삭제">🗑</button>
      </div>
      ${sub ? `<div class="cred-extra">${sub}</div>` : ''}
      <div class="cu-row-foot">
        <span class="cred-extra">${c['보낸날'] ? '워크스페이스 보냄 ' + _cuEsc(c['보낸날']) : '수정 ' + _cuEsc(c['수정일'] || '')}</span>
        <button class="cred-copy cu-send-row" data-act="send">📤 워크스페이스에 고객등록</button>
      </div>
    </div>`;
  }).join('') : '<div class="cred-empty">저장된 고객이 없습니다.</div>';
}

// ── 입력 화면 ──
function cuOpenForm(c) {
  _cuEdit = c ? JSON.parse(JSON.stringify(c)) : { id: '', health: { cat: '일반체', state: {} } };
  if (!_cuEdit.health) _cuEdit.health = { cat: '일반체', state: {} };
  if (!_cuEdit.health.state) _cuEdit.health.state = {};
  _cuHealthCat = _cuEdit.health.cat || _cuTpl.categories[0] || '일반체';
  _cuTplEdit = false;
  document.getElementById('cuFormTit').textContent = c ? `✏️ ${c['고객명'] || ''} 수정` : '➕ 새 고객';
  document.getElementById('cuFields').innerHTML = CU_FIELDS.map(f => {
    const v = _cuEsc(_cuEdit[f.k] || '');
    let input;
    if (f.opts) input = `<select data-k="${f.k}">${f.opts.map(o => `<option value="${_cuEsc(o)}"${o === (_cuEdit[f.k] || '') ? ' selected' : ''}>${o ? _cuEsc(o) : '선택'}</option>`).join('')}</select>`;
    else if (f.area) input = `<textarea data-k="${f.k}" rows="2">${v}</textarea>`;
    else input = `<input data-k="${f.k}" type="${f.secret ? 'password' : 'text'}" ${f.mode ? `inputmode="${f.mode}"` : ''} placeholder="${_cuEsc(f.ph || '')}" value="${v}" autocomplete="off">`;
    return `<label class="${f.wide ? 'wide' : ''}">${_cuEsc(f.label)}${f.req ? ' *' : ''}${f.secret ? '<button type="button" class="cred-ic cu-eye" data-act="eye" title="보기/숨김">👁</button>' : ''}${input}</label>`;
  }).join('');
  cuRenderHealth();
  document.getElementById('cuListView').style.display = 'none';
  document.getElementById('cuFormView').style.display = '';
  document.querySelector('#cuFields [data-k="고객명"]')?.focus();
}

function cuRenderHealth() {
  const st = _cuEdit.health.state;
  if (_cuTplEdit) { cuRenderTplEditor(); return; }
  const cats = _cuTpl.categories.slice();
  Object.keys(st).forEach(c => { if (!cats.includes(c) && Object.keys(st[c] || {}).length) cats.push(c); });
  document.getElementById('cuHealthCats').innerHTML = cats.map(cat =>
    `<button type="button" class="cred-filter${cat === _cuHealthCat ? ' on' : ''}" data-act="hcat" data-cat="${_cuEsc(cat)}">${_cuEsc(cat)}</button>`).join('') +
    `<span class="cred-sp"></span><button type="button" class="cred-copy" data-act="tpl-edit">✏️ 질문 편집</button>`;
  const qs = _cuQs(_cuHealthCat);
  if (!qs.length) { document.getElementById('cuHealthQs').innerHTML = '<div class="cred-empty">이 카테고리에 질문이 없습니다. [✏️ 질문 편집] 에서 추가하세요.</div>'; return; }
  const cs = st[_cuHealthCat] || {};
  document.getElementById('cuHealthQs').innerHTML = qs.map((q, i) => {
    const t = _cuQType(q), v = cs[i], txt = _cuEsc(_cuQText(q));
    let body;
    if (t === 'drv' || t === 'moto') {
      const cur = (v && v.value) || '', etc = (v && v.etc) || '';
      const opts = t === 'drv' ? CU_DRV_OPTS : CU_MOTO_OPTS;
      body = `<select data-act="hsel" data-i="${i}"><option value="">선택...</option>${opts.map(o => `<option${o === cur ? ' selected' : ''}>${_cuEsc(o)}</option>`).join('')}</select>` +
        (cur === '기타(직접입력)' ? `<input data-act="hetc" data-i="${i}" placeholder="직접 입력" value="${_cuEsc(etc)}">` : '');
    } else if (t === 'single') {
      const cur = (v && typeof v === 'object' && !Array.isArray(v)) ? (v.value || '') : (typeof v === 'string' ? v : '');
      body = `<input data-act="hsingle" data-i="${i}" placeholder="답변 입력" value="${_cuEsc(cur)}">`;
    } else {
      const ans = Array.isArray(v) ? v : [];
      body = `<div class="cu-hadd"><input data-act="hinp" data-i="${i}" placeholder="답변 입력 후 Enter 또는 추가"><button type="button" class="cred-copy" data-act="hadd" data-i="${i}">추가</button></div>` +
        (ans.length ? `<div class="cu-hans">${ans.map((a, j) => `<span><em data-act="hedit" data-i="${i}" data-j="${j}" title="눌러서 고치기">${_cuEsc(a)}</em><button type="button" data-act="hdel" data-i="${i}" data-j="${j}" title="삭제">×</button></span>`).join('')}</div>` : '');
    }
    return `<div class="cu-hq"><div class="cu-hq-t"><b>${i + 1}</b> ${txt}</div>${body}</div>`;
  }).join('');
}

function _cuHSet(i, val) {
  const st = _cuEdit.health.state;
  if (!st[_cuHealthCat]) st[_cuHealthCat] = {};
  st[_cuHealthCat][i] = val;
}
function _cuHAdd(i) {
  const inp = document.querySelector(`#cuHealthQs [data-act="hinp"][data-i="${i}"]`);
  const v = (inp && inp.value || '').trim();
  if (!v) return;
  const st = _cuEdit.health.state;
  if (!st[_cuHealthCat]) st[_cuHealthCat] = {};
  const cur = Array.isArray(st[_cuHealthCat][i]) ? st[_cuHealthCat][i] : [];
  if (!cur.includes(v)) cur.push(v);
  st[_cuHealthCat][i] = cur;
  cuRenderHealth();
  document.querySelector(`#cuHealthQs [data-act="hinp"][data-i="${i}"]`)?.focus();
}

// 입력칸에 쓰다 만 답변(추가 안 누른 것)도 저장에 넣는다 — 워크스페이스 _captureHealthPendingInputs 와 같은 동작
function _cuCapturePending() {
  const st = _cuEdit.health.state;
  let added = false;
  document.querySelectorAll('#cuHealthQs [data-act="hinp"]').forEach(inp => {
    const v = (inp.value || '').trim();
    if (!v) return;
    const i = Number(inp.dataset.i);
    if (!st[_cuHealthCat]) st[_cuHealthCat] = {};
    const cur = Array.isArray(st[_cuHealthCat][i]) ? st[_cuHealthCat][i] : [];
    if (!cur.includes(v)) cur.push(v);
    st[_cuHealthCat][i] = cur;
    inp.value = '';
    added = true;
  });
  if (added) cuRenderHealth();
}

function _cuReadFields() {
  document.querySelectorAll('#cuFields [data-k]').forEach(el => { _cuEdit[el.dataset.k] = (el.value || '').trim(); });
  _cuEdit.health.cat = _cuHealthCat;
}

async function cuSave() {
  _cuCapturePending();
  _cuReadFields();
  if (!_cuEdit['고객명']) { await showAlert('이름을 입력하세요.'); return null; }
  if (!vaultIsUnlocked()) { await showAlert('금고가 잠겨 있습니다. PIN 으로 잠금을 풀어 주세요.'); return null; }
  const before = _cuList.slice();
  _cuEdit['수정일'] = _cuNow();
  if (!_cuEdit.id) { _cuEdit.id = _cuNewId(); _cuList.push(_cuEdit); }
  else { const i = _cuList.findIndex(c => c.id === _cuEdit.id); if (i >= 0) _cuList[i] = _cuEdit; else _cuList.push(_cuEdit); }
  try { await _cuPersist(); }
  catch (e) { _cuList = before; await showAlert('저장 실패: ' + (e.message || e)); return null; }
  const saved = _cuEdit;
  _cuEdit = null;
  showToast('💾 PC 에 저장했습니다');
  cuRenderList();
  return saved;
}

async function cuDelete(c) {
  const ok = await showConfirm(`${c['고객명'] || ''} 고객을 이 PC 에서 삭제할까요?\n워크스페이스에 이미 보낸 내용은 지워지지 않습니다.`, '고객 삭제');
  if (!ok) return;
  const before = _cuList.slice();
  _cuList = _cuList.filter(x => x.id !== c.id);
  try { await _cuPersist(); cuRenderList(); showToast('🗑 삭제했습니다'); }
  catch (e) { _cuList = before; await showAlert('삭제 실패: ' + (e.message || e)); }
}

// ── 워크스페이스로 보내기 ──
const CU_WS_URL = 'https://ympaint-86457.web.app/page_jmin.html';
const _cuIsWsUrl = u => !!u && /ympaint-86457\.(web\.app|firebaseapp\.com)\/(page|m)_jmin\.html/i.test(u);

async function _cuProbe(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: () => typeof window.__applyExtCustomerFromExtension === 'function' });
    return !!(r && r.result);
  } catch (e) { return false; }
}

function _cuPayload(c) {
  const fields = {};
  CU_FIELDS.forEach(f => { if (f.k !== '메모' && c[f.k]) fields[f.k] = c[f.k]; });
  if (c['메모']) fields['상담이력'] = c['메모'];
  const state = (c.health && c.health.state) || {};
  // 질문 목록도 보낸다 — 질문을 편집했으면 워크스페이스가 같은 번호를 다른 질문으로 읽지 않도록
  const qs = {};
  Object.keys(state).forEach(cat => { qs[cat] = _cuQs(cat).map((q, i) => `${i + 1}. ${_cuQText(q)}`); });
  return { fields, health: { cat: (c.health && c.health.cat) || '일반체', state, qs } };
}

async function cuSend(c) {
  if (!c || !c['고객명']) return;
  const tabs = await chrome.tabs.query({});
  let tab = tabs.find(t => _cuIsWsUrl(t.url));
  let ready = false;
  if (tab) ready = await _cuProbe(tab.id);
  if (!tab) {
    // 백그라운드로 열어야 팝업이 닫히지 않는다 (활성화하는 순간 팝업이 사라짐)
    tab = await chrome.tabs.create({ url: CU_WS_URL, active: false });
    for (let i = 0; i < 30 && !ready; i++) { await new Promise(r => setTimeout(r, 500)); ready = await _cuProbe(tab.id); }
  }
  if (!ready) {
    const isOld = tab && tab.status === 'complete';
    await showAlert(isOld
      ? '워크스페이스 화면이 이 기능을 아직 모릅니다.\n워크스페이스를 새 버전으로 배포했는지 확인한 뒤, 워크스페이스 탭을 새로고침하고 다시 보내 주세요.\n(로그인 화면이면 먼저 로그인)'
      : '워크스페이스 화면이 준비되지 않았습니다. 로그인했는지 확인한 뒤 다시 보내 주세요.');
    try { await chrome.tabs.update(tab.id, { active: true }); } catch (e) {}
    return;
  }
  let res = null;
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN', args: [_cuPayload(c)],
      func: (p) => { try { return window.__applyExtCustomerFromExtension(p); } catch (e) { return { ok: false, error: e.message }; } }
    });
    res = r && r.result;
  } catch (e) { res = { ok: false, error: e.message || String(e) }; }
  if (!res || !res.ok) { await showAlert('보내기 실패: ' + ((res && res.error) || '알 수 없는 오류')); return; }
  const i = _cuList.findIndex(x => x.id === c.id);
  if (i >= 0) { _cuList[i]['보낸날'] = _cuNow(); try { await _cuPersist(); } catch (e) {} }
  showToast(res.mode === 'edit' ? '📤 기존 고객 수정 창에 채웠습니다 — 워크스페이스에서 [저장]' : '📤 새 고객 등록 창에 채웠습니다 — 워크스페이스에서 [저장]');
  await chrome.tabs.update(tab.id, { active: true });
  try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) {}
}

// ── ✏️ 질문 편집 (카테고리·질문 추가/이름변경/삭제/순서) ──
function cuRenderTplEditor() {
  const cats = _cuTpl.categories;
  if (!cats.includes(_cuHealthCat)) _cuHealthCat = cats[0] || '';
  document.getElementById('cuHealthCats').innerHTML = cats.map(cat =>
    `<button type="button" class="cred-filter${cat === _cuHealthCat ? ' on' : ''}" data-act="hcat" data-cat="${_cuEsc(cat)}">${_cuEsc(cat)}</button>`).join('') +
    `<button type="button" class="cred-copy" data-act="tpl-cat-add">＋ 카테고리</button><span class="cred-sp"></span>` +
    `<button type="button" class="btn-primary cu-tpl-done" data-act="tpl-done">✔ 편집 끝</button>`;
  const qs = _cuQs(_cuHealthCat);
  document.getElementById('cuHealthQs').innerHTML = (_cuHealthCat ? `
    <div class="cu-tpl-cat">
      <b>[${_cuEsc(_cuHealthCat)}]</b>
      <button type="button" class="cred-copy" data-act="tpl-cat-ren">이름 변경</button>
      <button type="button" class="cred-copy cu-danger" data-act="tpl-cat-del">카테고리 삭제</button>
    </div>` : '<div class="cred-empty">카테고리가 없습니다. [＋ 카테고리] 로 만드세요.</div>') +
    qs.map((q, i) => `
    <div class="cu-tpl-q">
      <span class="cu-tpl-n">${i + 1}</span>
      <input data-act="tpl-q" data-i="${i}" value="${_cuEsc(_cuQText(q))}">
      <button type="button" class="cred-ic" data-act="tpl-up" data-i="${i}" title="위로"${i === 0 ? ' disabled' : ''}>▲</button>
      <button type="button" class="cred-ic" data-act="tpl-down" data-i="${i}" title="아래로"${i === qs.length - 1 ? ' disabled' : ''}>▼</button>
      <button type="button" class="cred-ic" data-act="tpl-del" data-i="${i}" title="질문 삭제">🗑</button>
    </div>`).join('') +
    (_cuHealthCat ? `<div class="cu-hadd"><input id="cuTplNewQ" placeholder="새 질문 입력 후 Enter 또는 추가"><button type="button" class="cred-copy" data-act="tpl-add">＋ 질문 추가</button></div>
    <div class="cred-extra">· '운전여부'로 시작하면 운전 선택, '원동기'로 시작하면 원동기 선택, '발급일자/면허 번호' 가 들어가면 한 줄 답, 그 외는 여러 답변 칸이 됩니다.<br>· 질문을 지우거나 옮기면 저장된 모든 고객의 답변도 함께 옮겨집니다.</div>` : '');
}

// 모든 고객(+ 지금 편집 중인 고객)의 해당 카테고리 답변 위치를 바꾼다. mapFn(oldIndex) → newIndex 또는 -1(삭제)
function _cuRemapAll(cat, mapFn) {
  const fix = c => {
    const st = c && c.health && c.health.state;
    if (!st || !st[cat]) return;
    const out = {};
    Object.keys(st[cat]).forEach(k => { const n = mapFn(Number(k)); if (n >= 0) out[n] = st[cat][k]; });
    st[cat] = out;
  };
  _cuList.forEach(fix);
  if (_cuEdit) fix(_cuEdit);
}
function _cuRenameCatAll(from, to) {
  const fix = c => { const st = c && c.health && c.health.state; if (st && st[from]) { st[to] = st[from]; delete st[from]; } if (c && c.health && c.health.cat === from) c.health.cat = to; };
  _cuList.forEach(fix); if (_cuEdit) fix(_cuEdit);
}
function _cuCountAnswered(cat, idx) {
  return _cuList.filter(c => {
    const m = c.health && c.health.state && c.health.state[cat];
    if (!m) return false;
    if (idx == null) return _cuHealthCount({ state: { [cat]: m } }) > 0;
    return _cuHealthCount({ state: { [cat]: { 0: m[idx] } } }) > 0;
  }).length;
}
async function _cuTplCommit() {
  _cuSaveTpl();
  try { await _cuPersist(); } catch (e) { await showAlert('고객 답변 위치 저장 실패: ' + (e.message || e)); }
  cuRenderHealth();
}

async function _cuTplAction(act, b) {
  const cat = _cuHealthCat;
  const qs = _cuQs(cat);
  const i = Number(b && b.dataset.i);
  if (act === 'tpl-edit') { _cuCapturePending(); _cuTplEdit = true; cuRenderHealth(); return; }
  if (act === 'tpl-done') { _cuTplEdit = false; cuRenderHealth(); return; }
  if (act === 'tpl-cat-add') {
    const name = String((await showPrompt('새 카테고리 이름 (예: 치아보험)', '카테고리 추가')) || '').trim();
    if (!name) return;
    if (_cuTpl.categories.includes(name)) { await showAlert('같은 이름의 카테고리가 있습니다.'); return; }
    _cuTpl.categories.push(name); _cuTpl.questions[name] = []; _cuHealthCat = name;
    return _cuTplCommit();
  }
  if (act === 'tpl-cat-ren') {
    const name = String((await showPrompt('카테고리 새 이름', '이름 변경', cat)) || '').trim();
    if (!name || name === cat) return;
    if (_cuTpl.categories.includes(name)) { await showAlert('같은 이름의 카테고리가 있습니다.'); return; }
    _cuTpl.categories = _cuTpl.categories.map(c => c === cat ? name : c);
    _cuTpl.questions[name] = _cuTpl.questions[cat] || []; delete _cuTpl.questions[cat];
    _cuRenameCatAll(cat, name); _cuHealthCat = name;
    return _cuTplCommit();
  }
  if (act === 'tpl-cat-del') {
    const n = _cuCountAnswered(cat);
    const ok = await showConfirm(`[${cat}] 카테고리를 삭제할까요?` + (n ? `\n이 카테고리에 답한 고객 ${n}명의 답변도 함께 지워집니다.` : ''), '카테고리 삭제');
    if (!ok) return;
    _cuTpl.categories = _cuTpl.categories.filter(c => c !== cat); delete _cuTpl.questions[cat];
    const drop = c => { const st = c && c.health && c.health.state; if (st) delete st[cat]; if (c && c.health && c.health.cat === cat) c.health.cat = _cuTpl.categories[0] || ''; };
    _cuList.forEach(drop); if (_cuEdit) drop(_cuEdit);
    _cuHealthCat = _cuTpl.categories[0] || '';
    return _cuTplCommit();
  }
  if (act === 'tpl-add') {
    const inp = document.getElementById('cuTplNewQ');
    const t = (inp && inp.value || '').trim();
    if (!t) return;
    _cuTpl.questions[cat] = qs.concat(t);
    return _cuTplCommit();
  }
  if (act === 'tpl-del') {
    const n = _cuCountAnswered(cat, i);
    const ok = await showConfirm(`이 질문을 삭제할까요?\n"${_cuQText(qs[i])}"` + (n ? `\n이 질문에 답한 고객 ${n}명의 답변도 함께 지워집니다.` : ''), '질문 삭제');
    if (!ok) return;
    _cuTpl.questions[cat] = qs.filter((_, k) => k !== i);
    _cuRemapAll(cat, k => k === i ? -1 : (k > i ? k - 1 : k));
    return _cuTplCommit();
  }
  if (act === 'tpl-up' || act === 'tpl-down') {
    const j = act === 'tpl-up' ? i - 1 : i + 1;
    if (j < 0 || j >= qs.length) return;
    const arr = qs.slice(); const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    _cuTpl.questions[cat] = arr;
    _cuRemapAll(cat, k => k === i ? j : (k === j ? i : k));
    return _cuTplCommit();
  }
}

// ── 🔐 토스 CRM 추출 데이터 → 이 PC 금고에 저장 (📤 프로그램 적용 · '내 확장에 저장') ──
const _cuIsMasked = v => /[\*●·]/.test(String(v || ''));
const _cuDigits = v => String(v || '').replace(/[^0-9]/g, '');

async function cuImportExtracted(raw) {
  const src = raw || {};
  const pick = {};
  ['고객명', '연락처', '생년월일', '주민등록번호', '주소', '이메일', '직업', '하는일', '통신사', '운전여부'].forEach(k => {
    const v = String(src[k] == null ? '' : src[k]).trim(); if (v) pick[k] = v;
  });
  ['키', '몸무게'].forEach(k => { const v = String(src[k] == null ? '' : src[k]).replace(/[^\d.]/g, ''); if (v) pick[k] = v; });
  const g = String(src['성별'] || ''); if (/여/.test(g)) pick['성별'] = '여'; else if (/남/.test(g)) pick['성별'] = '남';
  if (!pick['고객명']) { await showAlert('고객명을 찾지 못했습니다. 토스 CRM 고객정보 화면에서 다시 추출해 주세요.'); return null; }
  // 같은 사람: 이름 같음 + (전화 숫자 같음 / 끝 4자리 같음 / 주민 앞 6자리 같음)
  const pd = _cuDigits(pick['연락처']), rr = _cuDigits(pick['주민등록번호']).slice(0, 6);
  const hit = _cuList.find(c => {
    if ((c['고객명'] || '') !== pick['고객명']) return false;
    const cp = _cuDigits(c['연락처']);
    if (pd && cp && (cp === pd || (pd.length >= 4 && cp.slice(-4) === pd.slice(-4)))) return true;
    const cr = _cuDigits(c['주민등록번호']).slice(0, 6);
    return !!(rr && cr && rr === cr);
  });
  const before = _cuList.slice();
  const target = hit ? Object.assign({}, hit) : { id: _cuNewId(), health: { cat: _cuTpl.categories[0] || '일반체', state: {} } };
  const masked = [];
  Object.keys(pick).forEach(k => {
    const v = pick[k];
    if (_cuIsMasked(v)) { if (String(target[k] || '').trim()) return; masked.push(k); }   // 마스킹 값으로 온전한 값을 덮지 않음
    target[k] = v;
  });
  target['수정일'] = _cuNow();
  if (hit) _cuList[_cuList.indexOf(hit)] = target; else _cuList.push(target);
  try { await _cuPersist(); }
  catch (e) { _cuList = before; await showAlert('저장 실패: ' + (e.message || e)); return null; }
  showToast((hit ? '🔐 기존 고객 정보를 갱신했습니다' : '🔐 새 고객으로 저장했습니다') + (masked.length ? ` — ⚠ 마스킹 남음: ${masked.join(', ')}` : ''));
  cuOpenForm(target);   // 바로 확인·건강상태 입력
  return target;
}

function _cuShowTab() { const t = document.querySelector('.tab[data-tab="cust"]'); if (t) t.click(); }

// apply.js 의 📤 프로그램 적용 → targetMode 'vault'
async function routeVault(ctx) {
  const { btn, safetyTimer } = ctx || {};
  try { clearTimeout(safetyTimer); } catch (e) {}
  if (btn) { btn.textContent = '📤 프로그램 적용'; btn.disabled = false; }
  const cust = (typeof extractedData !== 'undefined' && extractedData && extractedData.type === 'customer') ? extractedData.customer : null;
  if (!cust) { await showAlert('토스 CRM 고객정보 화면에서 추출한 데이터만 내 확장에 저장할 수 있습니다.'); return; }
  _cuShowTab();
  if (!vaultIsUnlocked()) { _cuPendingImport = cust; showToast('🔒 PIN 을 입력하면 바로 저장됩니다'); return; }
  await cuImportExtracted(cust);
}

// ── ⛶ 크게 보기 ──
async function cuOpenBigView() {
  const url = chrome.runtime.getURL('popup.html?full=1&tab=cust');
  try {
    const existing = await chrome.tabs.query({ url: chrome.runtime.getURL('popup.html') + '*' });
    const big = (existing || []).find(t => /[?&]full=1/.test(t.url || ''));
    if (big) { await chrome.windows.update(big.windowId, { focused: true }); await chrome.tabs.update(big.id, { active: true }); return; }
  } catch (e) {}
  try { await chrome.windows.create({ url, type: 'popup', width: 1180, height: 900 }); }
  catch (e) { await chrome.tabs.create({ url }); }
}

// ── 이벤트 ──
function _cuOnClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'hcat') { if (!_cuTplEdit) _cuCapturePending(); _cuHealthCat = b.dataset.cat; cuRenderHealth(); return; }
  if (act.startsWith('tpl-')) { if (act !== 'tpl-q') _cuTplAction(act, b); return; }
  if (act === 'hedit') {
    const st = _cuEdit.health.state[_cuHealthCat] || {};
    const arr = Array.isArray(st[b.dataset.i]) ? st[b.dataset.i] : [];
    const j = Number(b.dataset.j);
    showPrompt('답변 고치기 (비우면 삭제)', '답변 수정', arr[j]).then(v => {
      if (v == null) return;
      const t = String(v).trim();
      if (t) arr[j] = t; else arr.splice(j, 1);
      cuRenderHealth();
    });
    return;
  }
  if (act === 'hadd') { _cuHAdd(Number(b.dataset.i)); return; }
  if (act === 'hdel') {
    const st = _cuEdit.health.state[_cuHealthCat] || {};
    const arr = Array.isArray(st[b.dataset.i]) ? st[b.dataset.i] : [];
    arr.splice(Number(b.dataset.j), 1);
    cuRenderHealth();
    return;
  }
  if (act === 'eye') { const inp = b.parentElement.querySelector('input'); if (inp) inp.type = inp.type === 'password' ? 'text' : 'password'; return; }
  const row = b.closest('.cred-row');
  const c = row && _cuList.find(x => x.id === row.dataset.id);
  if (!c) return;
  if (act === 'edit') cuOpenForm(c);
  else if (act === 'del') cuDelete(c);
  else if (act === 'send') cuSend(c);
}
function _cuOnChange(e) {
  const el = e.target;
  if (el.dataset && el.dataset.act === 'tpl-q') {
    const t = el.value.trim(), i = Number(el.dataset.i), qs = _cuQs(_cuHealthCat);
    if (!t) { el.value = _cuQText(qs[i]); return; }   // 비우기 = 삭제가 아님 (삭제는 🗑)
    qs[i] = t; _cuSaveTpl();
    return;
  }
  if (!_cuEdit || !el.dataset) return;
  const i = Number(el.dataset.i);
  if (el.dataset.act === 'hsel') {
    const prev = (_cuEdit.health.state[_cuHealthCat] || {})[i] || {};
    _cuHSet(i, { value: el.value, etc: el.value === '기타(직접입력)' ? (prev.etc || '') : '' });
    // 일반체·간편 1번(운전) 을 고르면 개인정보 '운전여부' 도 맞춘다 (워크스페이스와 같은 동작)
    const q = _cuQs(_cuHealthCat)[i] || '';
    if (_cuQType(q) === 'drv' && el.value && el.value !== '기타(직접입력)') {
      const dv = document.querySelector('#cuFields [data-k="운전여부"]');
      if (dv && Array.from(dv.options).some(o => o.value === el.value)) dv.value = el.value;
    }
    cuRenderHealth();
  }
}
function _cuOnInput(e) {
  const el = e.target;
  if (!_cuEdit || !el.dataset) return;
  const i = Number(el.dataset.i);
  if (el.dataset.act === 'hetc') { const cur = (_cuEdit.health.state[_cuHealthCat] || {})[i] || {}; _cuHSet(i, { value: cur.value || '', etc: el.value }); }
  if (el.dataset.act === 'hsingle') _cuHSet(i, { value: el.value });
}
function _cuOnKey(e) {
  if (e.key !== 'Enter') return;
  if (e.target.dataset && e.target.dataset.act === 'hinp') { e.preventDefault(); _cuHAdd(Number(e.target.dataset.i)); }
  else if (e.target.id === 'cuTplNewQ') { e.preventDefault(); _cuTplAction('tpl-add'); }
  else if (e.target.dataset && e.target.dataset.act === 'tpl-q') { e.preventDefault(); e.target.blur(); }
}

document.addEventListener('DOMContentLoaded', async () => {
  try { if (window._extAuthReady && !(await window._extAuthReady)) return; } catch (e) { return; }
  const pane = document.getElementById('tab-cust');
  if (!pane) return;
  pane.addEventListener('click', _cuOnClick);
  pane.addEventListener('change', _cuOnChange);
  pane.addEventListener('input', _cuOnInput);
  pane.addEventListener('keydown', _cuOnKey);
  document.getElementById('cuSearch')?.addEventListener('input', e => { _cuQuery = e.target.value; cuRenderList(); });
  document.getElementById('cuNewBtn')?.addEventListener('click', () => cuOpenForm(null));
  document.getElementById('cuCancel')?.addEventListener('click', () => { _cuEdit = null; cuRenderList(); });
  document.getElementById('cuSave')?.addEventListener('click', () => cuSave());
  document.getElementById('cuSaveSend')?.addEventListener('click', async () => { const c = await cuSave(); if (c) cuSend(c); });
  document.getElementById('cuBigBtn')?.addEventListener('click', cuOpenBigView);
  await _cuLoadTpl();
  document.addEventListener('vault-unlocked', async () => {
    await cuLoad();
    if (_cuPendingImport) { const p = _cuPendingImport; _cuPendingImport = null; cuImportExtracted(p); }
  });
  if (vaultIsUnlocked()) cuLoad();
  // 크게 보기 창(popup.html?full=1&tab=cust) — 고객 탭으로 바로
  if (/[?&]tab=cust\b/.test(location.search)) _cuShowTab();
});
