// ─────────────────────────────────────────────────────────────
// background.js — 확장 서비스워커 (MV3)
//
//   역할: 확장 UI 모드(팝업 / 사이드패널) 저장·복원.
//     · chrome.action.setPopup 으로 아이콘 클릭 동작을 전환
//     · 설치/브라우저 시작 시 저장된 모드를 복원
//     · 팝업에서 { action:'extSetUiMode', mode, open } 메시지로 전환 요청
//
//   ※ 이전에는 pcs-automation/pcs-local-driver.js (금소법 확인서 자동화)가
//      서비스워커를 겸했으나, 금소법 기능 제거에 따라 확장 기본 동작만
//      이 파일로 분리했다.
// ─────────────────────────────────────────────────────────────
'use strict';

// 보험사 주소 목록·판별 (popup 과 공용)
try { importScripts('insurer-sites.js'); } catch (e) { console.warn('[bg] insurer-sites.js 로드 실패', e); }

const EXT_UI_MODE_KEY = 'ext_ui_mode_v1';

async function _activeWindowId(sender) {
  if (sender && sender.tab && sender.tab.windowId != null) return sender.tab.windowId;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0] && tabs[0].windowId != null) return tabs[0].windowId;
  } catch (_) {}
  try {
    const win = await chrome.windows.getCurrent();
    return win && win.id;
  } catch (_) {}
  return undefined;
}

async function _applyExtensionUiMode(mode, sender, opts) {
  const next = mode === 'sidepanel' ? 'sidepanel' : 'popup';
  if (next === 'sidepanel' && !chrome.sidePanel) {
    await chrome.storage.local.set({ [EXT_UI_MODE_KEY]: 'popup' });
    if (chrome.action && chrome.action.setPopup) await chrome.action.setPopup({ popup: 'popup.html' });
    return { ok: false, mode: 'popup', error: 'Current Chrome does not support sidePanel API.' };
  }
  await chrome.storage.local.set({ [EXT_UI_MODE_KEY]: next });
  if (chrome.action && chrome.action.setPopup) {
    await chrome.action.setPopup({ popup: next === 'popup' ? 'popup.html' : '' });
  }
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: next === 'sidepanel' });
  }
  let openError = '';
  if (next === 'sidepanel' && opts && opts.open && chrome.sidePanel && chrome.sidePanel.open) {
    try {
      const windowId = await _activeWindowId(sender);
      if (windowId != null) await chrome.sidePanel.open({ windowId });
    } catch (e) {
      openError = String(e && e.message || e);
    }
  }
  return { ok: true, mode: next, openError };
}

function _restoreExtensionUiMode() {
  try {
    chrome.storage.local.get([EXT_UI_MODE_KEY], (v) => {
      _applyExtensionUiMode(v && v[EXT_UI_MODE_KEY] === 'sidepanel' ? 'sidepanel' : 'popup', null, { open: false }).catch(() => {});
    });
  } catch (_) {}
}

_restoreExtensionUiMode();
chrome.runtime.onInstalled.addListener(_restoreExtensionUiMode);
chrome.runtime.onStartup.addListener(_restoreExtensionUiMode);

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req || req.action !== 'extSetUiMode') return;
  _applyExtensionUiMode(req.mode, sender, { open: !!req.open })
    .then(sendResponse)
    .catch(e => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true;
});

// 🆕 페인트프로 전송용 — 토스 '이미지 복사'는 탭 배율이 100% 가 아니면 글자가 겹친 이미지를 만든다.
//   content/paint-pro.js 가 캡처 직전 100% 로 맞추고(op:set100), 끝나면 원래 배율로 되돌린다(op:restore).
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req || req.action !== 'paintProZoom') return;
  const tabId = sender && sender.tab && sender.tab.id;
  if (tabId == null) { sendResponse({ ok: false }); return; }
  (async () => {
    if (req.op === 'set100') {
      const prev = await chrome.tabs.getZoom(tabId);
      if (Math.abs(prev - 1) > 0.001) await chrome.tabs.setZoom(tabId, 1);
      return { ok: true, prev };
    }
    if (req.op === 'restore' && req.zoom > 0) {
      await chrome.tabs.setZoom(tabId, req.zoom);
      return { ok: true };
    }
    return { ok: false };
  })().then(sendResponse).catch(e => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true;
});

// ═══════════════════════════════════════════════════════════════════
// 🔑 보험사 사이트 자동 표시 (insurer-card.js) — PC 금고에서 이 사이트 계정만 꺼내 준다
//   · 금고 키는 popup/vault.js 가 잠금 해제 때 chrome.storage.session 에 넣어 둔 것(PIN 입력 후 6시간).
//     없거나 만료면 잠김으로 응답한다(PIN 은 페이지에서 받지 않는다).
//   · 요청한 페이지 주소(sender.url)에 해당하는 보험사 계정만 돌려준다.
//   · 같은 탭·같은 보험사 도메인은 자동으로 한 번만 띄운다(이후엔 🔑 버튼만).
// ═══════════════════════════════════════════════════════════════════
const CRED_CARD_SHOWN_KEY = 'credCardShown';

function _bgB64(str) { const s = atob(str); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }

async function _bgVaultCreds() {
  const sess = await chrome.storage.session.get('vault_session');
  const v = sess && sess.vault_session;
  if (!v || !v.k || !(v.exp > Date.now())) return null;   // 잠김
  const st = await chrome.storage.local.get('vault_creds');
  if (!st.vault_creds) return [];
  const key = await crypto.subtle.importKey('raw', _bgB64(v.k), { name: 'AES-GCM' }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _bgB64(st.vault_creds.iv) }, key, _bgB64(st.vault_creds.ct));
  const arr = JSON.parse(new TextDecoder().decode(pt));
  return Array.isArray(arr) ? arr : [];
}

// 🔓 금고가 잠겼을 때 쓰는 '처음 10초' 미리보기 사본 (popup/vault.js vaultWriteCardCache)
async function _bgCardCache() {
  const st = await chrome.storage.local.get(['card_cache', 'card_dev_key', 'credPreviewNoPin']);
  if (st.credPreviewNoPin === false || !st.card_cache || !st.card_dev_key) return null;
  const key = await crypto.subtle.importKey('raw', _bgB64(st.card_dev_key), { name: 'AES-GCM' }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _bgB64(st.card_cache.iv) }, key, _bgB64(st.card_cache.ct));
  const arr = JSON.parse(new TextDecoder().decode(pt));
  return Array.isArray(arr) ? arr : null;
}

async function _bgCredCardLookup(req, sender) {
  const url = (sender && (sender.url || (sender.tab && sender.tab.url))) || '';
  const tabId = sender && sender.tab && sender.tab.id;
  const local = await chrome.storage.local.get(['credCardAuto', 'vault_meta', CRED_SITES_KEY]);
  // 내장 보험사 주소 + 사용자가 계정에 연결한 주소
  const lk = _credLookupUrl(url, local[CRED_SITES_KEY] || []);
  const names = lk.names;
  if (!names.length && !lk.cids.length) return { ok: true, show: false };
  if (!local.vault_meta) return { ok: true, show: false };                  // 금고를 아직 안 만듦
  if (local.credCardAuto === false && !req.force) return { ok: true, show: false };

  let host = '';
  try { host = new URL(url).hostname; } catch (e) {}
  const base = _credBaseDomain(host);
  const sess = await chrome.storage.session.get(CRED_CARD_SHOWN_KEY);
  const shown = (sess && sess[CRED_CARD_SHOWN_KEY]) || {};
  const already = tabId != null && Array.isArray(shown[tabId]) && shown[tabId].includes(base);

  let creds;
  try { creds = await _bgVaultCreds(); } catch (e) { creds = null; }
  const markShown = async () => {
    if (tabId == null) return;
    shown[tabId] = Array.from(new Set((shown[tabId] || []).concat(base)));
    await chrome.storage.session.set({ [CRED_CARD_SHOWN_KEY]: shown });
  };
  if (creds === null) {                                                     // 잠김
    if (already && !req.force) return { ok: true, show: false, pill: true };
    // 처음 자동으로 뜰 때만 PIN 없이 10초 미리보기 (🔑 버튼으로 다시 열 때는 안 됨 — 반복 열람 방지)
    if (!already && !req.force) {
      let pre = null;
      try { pre = await _bgCardCache(); } catch (e) { pre = null; }
      const hits = (pre || []).filter(c => _credMatchLookup(c, lk));
      if (hits.length) { await markShown(); return { ok: true, show: true, names, items: hits, previewSec: 10 }; }
    }
    await markShown();
    return { ok: true, show: true, locked: true, names };
  }
  const items = creds.filter(c => _credMatchLookup(c, lk))
    .map(c => ({ 보험사: c['보험사'] || '', ID: c['ID'] || '', 비밀번호: c['비밀번호'] || '', 생년월일: c['생년월일'] || '', 년월일: c['년월일'] || '', 비고: c['비고'] || '' }));
  if (!items.length) return { ok: true, show: false };
  if (already && !req.force) return { ok: true, show: false, pill: true };
  await markShown();
  return { ok: true, show: true, names, items };
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req || req.action !== 'credCardLookup') return;
  _bgCredCardLookup(req, sender).then(sendResponse).catch(e => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const sess = await chrome.storage.session.get(CRED_CARD_SHOWN_KEY);
    const shown = (sess && sess[CRED_CARD_SHOWN_KEY]) || {};
    if (shown[tabId]) { delete shown[tabId]; await chrome.storage.session.set({ [CRED_CARD_SHOWN_KEY]: shown }); }
  } catch (e) {}
});

// ═══════════════════════════════════════════════════════════════════
// 🌐 사용자가 계정에 연결한 보험사 주소에도 계정 카드(insurer-card.js)를 띄운다
//   manifest 에는 내장 보험사 도메인만 있으므로, 'cred_sites' 의 나머지 도메인은 실행 중에
//   content script 로 등록한다(크롬을 다시 켜도 유지). 목록이 바뀌면 다시 맞춘다.
// ═══════════════════════════════════════════════════════════════════
const USER_CARD_SCRIPT_ID = 'insurer-card-user';
async function _bgSyncUserCardScript() {
  try {
    const st = await chrome.storage.local.get(CRED_SITES_KEY);
    const builtin = _credBuiltinBases();
    const bases = Array.from(new Set((st[CRED_SITES_KEY] || []).map(m => m && m.base).filter(b => b && !builtin.has(b))));
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [USER_CARD_SCRIPT_ID] }).catch(() => []);
    if (!bases.length) {
      if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [USER_CARD_SCRIPT_ID] });
      return;
    }
    const script = {
      id: USER_CARD_SCRIPT_ID,
      matches: bases.flatMap(b => [`https://*.${b}/*`, `http://*.${b}/*`]),
      js: ['insurer-card.js'], runAt: 'document_idle', persistAcrossSessions: true
    };
    if (existing.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  } catch (e) { console.warn('[bg] 사용자 보험사 주소 등록 실패', e); }
}
chrome.runtime.onInstalled.addListener(_bgSyncUserCardScript);
chrome.runtime.onStartup.addListener(_bgSyncUserCardScript);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[CRED_SITES_KEY]) _bgSyncUserCardScript();
});

// ═══════════════════════════════════════════════════════════════════
// 🖍 토스 보장분석 화면 표시 저장 (content/annotate.js)
//   고객별 형광펜·고친 글자·보험 순서를 이 PC 전용 키(anno_dev_key)로 암호화해 anno_c_<고객번호> 에 둔다.
//   (고친 글자에 고객 정보가 들어갈 수 있어서 평문으로 두지 않음)
// ═══════════════════════════════════════════════════════════════════
async function _bgAnnoKey() {
  let st = await chrome.storage.local.get('anno_dev_key');
  if (!st.anno_dev_key) {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    let s = ''; raw.forEach(b => { s += String.fromCharCode(b); });
    await chrome.storage.local.set({ anno_dev_key: btoa(s) });
    st = await chrome.storage.local.get('anno_dev_key');
  }
  return crypto.subtle.importKey('raw', _bgB64(st.anno_dev_key), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
function _bgB64enc(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
async function _bgAnno(req) {
  const cid = String(req.cid || '').replace(/[^0-9]/g, '');
  if (!cid) return { ok: false, error: '고객번호 없음' };
  const k = 'anno_c_' + cid;
  const key = await _bgAnnoKey();
  if (req.action === 'annoLoad') {
    const st = await chrome.storage.local.get(k);
    if (!st[k]) return { ok: true, data: null };
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _bgB64(st[k].iv) }, key, _bgB64(st[k].ct));
    return { ok: true, data: JSON.parse(new TextDecoder().decode(pt)) };
  }
  const d = req.data || {};
  const empty = !(d.hl && d.hl.length) && !(d.edits && d.edits.length) && !(d.order && d.order.length);
  if (empty) { await chrome.storage.local.remove(k); return { ok: true }; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(d)));
  await chrome.storage.local.set({ [k]: { iv: _bgB64enc(iv), ct: _bgB64enc(ct), at: Date.now() } });
  return { ok: true };
}
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req || (req.action !== 'annoLoad' && req.action !== 'annoSave')) return;
  _bgAnno(req).then(sendResponse).catch(e => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true;
});

// ═══════════════════════════════════════════════════════════════════
// 🪟 고객관리 팝업 창 — popup.html?full=1&tab=cust&solo=1 을 작은 창으로 (이미 열려 있으면 앞으로)
//   위치·크기는 창이 기억(cu_solo_bounds). 팝업 버튼 · 단축키(Alt+Shift+C)로 연다.
// ═══════════════════════════════════════════════════════════════════
async function _bgOpenCustomerSolo() {
  const base = chrome.runtime.getURL('popup.html');
  try {
    const tabs = await chrome.tabs.query({ url: base + '*' });
    const t = (tabs || []).find(x => /[?&]solo=1/.test(x.url || ''));
    if (t) { await chrome.windows.update(t.windowId, { focused: true, state: 'normal' }); return; }
  } catch (e) {}
  const st = await chrome.storage.local.get('cu_solo_bounds');
  const b = st.cu_solo_bounds || {};
  const opt = { url: base + '?full=1&tab=cust&solo=1', type: 'popup', width: b.width || 560, height: b.height || 820, focused: true };
  if (b.left != null && b.top != null) { opt.left = b.left; opt.top = b.top; }
  try { await chrome.windows.create(opt); }
  catch (e) { delete opt.left; delete opt.top; await chrome.windows.create(opt); }   // 저장된 위치가 화면 밖이면 기본 위치로
}
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req || req.action !== 'cuOpenSolo') return;
  _bgOpenCustomerSolo().then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: String(e) }));
  return true;
});
try { chrome.commands.onCommand.addListener(cmd => { if (cmd === 'open-customers') _bgOpenCustomerSolo(); }); } catch (e) {}

// 🎨 페인트프로 편집기 열기 (content/paint-pro.js) — 확장 버튼에서 시작하면 페이지의 window.open 이
//   팝업 차단에 막히므로 여기서 새 탭으로 연다. 보낸 탭 바로 옆에.
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req || req.action !== 'paintProOpenEditor') return;
  const url = String(req.url || '');
  if (!/^https:\/\/tossinssu-pro\.vercel\.app\//.test(url)) { sendResponse({ ok: false }); return; }
  const opt = { url, active: true };
  if (sender && sender.tab) { opt.index = sender.tab.index + 1; opt.openerTabId = sender.tab.id; opt.windowId = sender.tab.windowId; }
  chrome.tabs.create(opt).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: String(e) }));
  return true;
});

// 🗂 PC 워크스페이스 (workspace.html) — 이미 열려 있으면 그 탭으로, 없으면 새 탭
async function _bgOpenPcWorkspace() {
  const url = chrome.runtime.getURL('workspace.html');
  try {
    const tabs = await chrome.tabs.query({ url: url + '*' });
    if (tabs && tabs[0]) { await chrome.tabs.update(tabs[0].id, { active: true }); await chrome.windows.update(tabs[0].windowId, { focused: true }); return; }
  } catch (e) {}
  await chrome.tabs.create({ url, active: true });
}
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req || req.action !== 'openPcWorkspace') return;
  _bgOpenPcWorkspace().then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: String(e) }));
  return true;
});
try { chrome.commands.onCommand.addListener(cmd => { if (cmd === 'open-pc-workspace') _bgOpenPcWorkspace(); }); } catch (e) {}


// ═══════════════════════════════════════════════════════════════
// 🆕 업데이트 확인 — GitHub 의 manifest.json 버전만 읽는다 (보내는 데이터 없음)
//   새 버전이 있으면 확장 아이콘에 'NEW' 표시, 팝업이 안내 띠를 보여 준다.
// ═══════════════════════════════════════════════════════════════
const UPD_MANIFEST_URL = 'https://raw.githubusercontent.com/famsolution/toss-crm-extractor/main/manifest.json';
function _updNewer(a, b) {   // a 가 b 보다 새 버전이면 true
  const x = String(a || '').split('.').map(n => parseInt(n, 10) || 0), y = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}
async function _updCheck() {
  const cur = chrome.runtime.getManifest().version;
  let latest = '';
  try {
    const r = await fetch(UPD_MANIFEST_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) latest = String((await r.json()).version || '');
  } catch (e) { return null; }
  if (!latest) return null;
  const has = _updNewer(latest, cur);
  await chrome.storage.local.set({ updLatest: latest, updCheckedAt: Date.now() });
  try {
    await chrome.action.setBadgeText({ text: has ? 'NEW' : '' });
    if (has) await chrome.action.setBadgeBackgroundColor({ color: '#F97316' });
  } catch (e) {}
  return { cur, latest, has };
}
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('tce-update-check', { periodInMinutes: 180 }); _updCheck(); });
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('tce-update-check', { periodInMinutes: 180 }); _updCheck(); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'tce-update-check') _updCheck(); });
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg && msg.action === 'updCheckNow') { _updCheck().then(r => send(r || { error: 'offline' })); return true; }
  if (msg && msg.action === 'updReload') { send({ ok: true }); setTimeout(() => chrome.runtime.reload(), 150); return true; }
});
