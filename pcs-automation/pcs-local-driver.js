// ──────────────────────────────────────────────────────────────────────────
// pcs-local-driver.js — 금소법/상품비교 확인서 "로컬 자동 진행" 드라이버 (MV3 service worker)
//
//   Claude(시각 에이전트) 없이, 확장 자체에서 Flutter(CanvasKit) 확인서 전송
//   화면을 자동 진행한다. 원리:
//     · chrome.debugger 로 **신뢰된(trusted) OS 급 클릭/타이핑**을 주입
//       (Claude+Chrome 이 쓰는 것과 동일한 CDP 채널 — Flutter 가 정상 수신)
//     · Flutter 접근성(Semantics) 트리를 켜면 캔버스 위 요소들이
//       aria-label 붙은 DOM(flt-semantics)으로 노출 → 라벨로 위치를 찾아 클릭
//
//   안전 원칙: ⛔ 서명&완료(고객 발송, 비가역) 직전에 반드시 정지. 전송은 사람이.
//   권한: 기존 게이트(extAuthOK = 로그인 + 관리자 승인) 그대로 적용.
// ──────────────────────────────────────────────────────────────────────────
'use strict';

const ENTRY_URL = 'https://crm.tossinsu.com/crm-v2/center/pcs-documents';
const SEND_RE = /crm\.tossinsu\.com\/crm-v2\/center\/pcs-documents\/send/;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 페이지 컨텍스트 실행 헬퍼 ──

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

async function exec(tabId, func, args) {
  const res = await chrome.scripting.executeScript({ target: { tabId }, func, args: args || [] });
  return res && res[0] && res[0].result;
}
async function cdp(tabId, method, params) {
  try {
    return await chrome.debugger.sendCommand({ tabId }, method, params || {});
  } catch (e) {
    // 페이지 이동/배너 취소 등으로 디버거가 떨어지면 자동 재연결 후 1회 재시도
    if (/not attached|detached|target.*closed/i.test(String(e && e.message || e))) {
      try { await chrome.debugger.attach({ tabId }, '1.3'); } catch (e2) {
        if (!/already attached/i.test(String(e2 && e2.message || e2))) throw e;
      }
      await new Promise(r => setTimeout(r, 200));
      return chrome.debugger.sendCommand({ tabId }, method, params || {});
    }
    throw e;
  }
}

// ── 진행 상황 오버레이 (send 탭 좌상단 고정 패널) ──
function _overlayInPage(html, isError) {
  let el = document.getElementById('__pcs_local_overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = '__pcs_local_overlay';
    el.style.cssText = 'position:fixed;top:10px;left:10px;z-index:2147483647;max-width:380px;background:#0f172a;color:#fff;font:12px/1.5 -apple-system,sans-serif;padding:10px 14px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.45);white-space:pre-wrap;';
    document.body.appendChild(el);
  }
  el.style.background = isError ? '#7f1d1d' : '#0f172a';
  el.innerHTML = html;
}
async function overlay(tabId, msg, isError) {
  try { await exec(tabId, _overlayInPage, [msg, !!isError]); } catch (_) {}
}

// ── Flutter Semantics: 상태 점검 + 활성화 시도 + 진단 (same-origin iframe + shadow DOM 탐색) ──
//   반환: { semCount, placeholder:{x,y}|null, diag:{...} }
//   활성화 전략(여러 Flutter 버전 대응):
//     · placeholder 엘리먼트에 직접 합성 pointer/mouse/click 이벤트 발사 (좌표 불필요)
//     · placeholder 좌표를 반환해 드라이버가 CDP 신뢰 클릭도 병행
//   placeholder 는 tag(flt-semantics-placeholder) 외에 role=button + aria-label에
//   "accessibility/스크린/접근성" 포함으로도 탐지(버전별 차이 대응).
function _semProbe() {
  const deepAll = (root, sel, acc) => {
    acc = acc || [];
    if (!root) return acc;
    try { root.querySelectorAll(sel).forEach(e => acc.push(e)); } catch (_) {}
    const walk = (n) => {
      if (n.shadowRoot) deepAll(n.shadowRoot, sel, acc);
      for (const c of (n.children || [])) walk(c);
    };
    try { walk(root.body || root); } catch (_) {}
    return acc;
  };
  const fire = (el) => {
    const o = { bubbles: true, cancelable: true, view: window };
    ['pointerover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => {
      try {
        const Ev = /^pointer/.test(t) ? (window.PointerEvent || MouseEvent) : MouseEvent;
        el.dispatchEvent(new Ev(t, o));
      } catch (_) { try { el.dispatchEvent(new Event(t, o)); } catch (_) {} }
    });
    try { el.focus(); } catch (_) {}
    try { el.click(); } catch (_) {}
  };
  const RE_A11Y = /enable\s*accessibility|accessibility|접근성|스크린\s*리더|screen\s*reader|콘텐츠.*사용|enable\s*semantics/i;
  const findPlaceholder = (doc) => {
    // 1) 정식 태그/속성
    let p = deepAll(doc, 'flt-semantics-placeholder, [flt-semantics-placeholder], .flt-semantics-placeholder')[0];
    if (p) return p;
    // 2) 라벨/텍스트로 광범위 탐지 (모든 deep 엘리먼트 대상)
    const all = deepAll(doc, '*');
    return all.find(b => {
      if (!b.getAttribute) return false;
      const lab = (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('placeholder') || '') + ' ' + (b.textContent || '').slice(0, 40);
      return RE_A11Y.test(lab);
    }) || null;
  };

  const docs = [document];
  document.querySelectorAll('iframe').forEach(f => { try { if (f.contentDocument) docs.push(f.contentDocument); } catch (_) {} });

  const offsetOf = (doc) => {
    if (doc === document) return { ox: 0, oy: 0 };
    const fr = [...document.querySelectorAll('iframe')].find(f => { try { return f.contentDocument === doc; } catch (_) { return false; } });
    if (fr) { const b = fr.getBoundingClientRect(); return { ox: b.left, oy: b.top }; }
    return { ox: 0, oy: 0 };
  };

  let semCount = 0, ph = null, glassCenter = null, glassCorner = null;
  const fltTags = new Set(), ariaLabels = new Set();
  let glassPane = false, iframeCount = 0, placeholderRect = null, glassPaneShadow = 'none', glassPaneKids = [];
  document.querySelectorAll('iframe').forEach(() => iframeCount++);

  for (const doc of docs) {
    semCount += deepAll(doc, 'flt-semantics, [id^="flt-semantic-node"]').length;
    const gp = deepAll(doc, 'flt-glass-pane, flutter-view, flt-scene-host')[0];
    if (gp) {
      glassPane = true;
      // glass-pane 의 shadow 여부 + 직속 자식 태그 (placeholder 위치 추적용)
      try {
        if (gp.shadowRoot) { glassPaneShadow = 'open'; glassPaneKids = [...gp.shadowRoot.children].map(c => (c.tagName || '').toLowerCase()).slice(0, 15); }
        else if (gp.children && gp.children.length) { glassPaneShadow = 'light'; glassPaneKids = [...gp.children].map(c => (c.tagName || '').toLowerCase()).slice(0, 15); }
        else { glassPaneShadow = 'closed?'; }
      } catch (_) {}
      // placeholder 없는 빌드: glass-pane 에 직접 합성 포인터 이벤트 → DesktopSemanticsEnabler 유도
      if (!ph) fire(gp);
      // glass-pane 좌표(신뢰 클릭용) — 중심 + 좌상단 코너(부작용 최소 안전 지점)
      if (!glassCenter) {
        const r = gp.getBoundingClientRect();
        const { ox, oy } = offsetOf(doc);
        if (r.width > 2 && r.height > 2) {
          glassCenter = { x: Math.round(ox + r.left + r.width / 2), y: Math.round(oy + r.top + r.height / 2) };
          glassCorner = { x: Math.round(ox + r.left + 8), y: Math.round(oy + r.top + 8) };
        }
      }
    }
    deepAll(doc, '*').slice(0, 6000).forEach(el => {
      const t = (el.tagName || '').toLowerCase();
      if (t.indexOf('flt-') === 0 || t === 'flutter-view') fltTags.add(t);
      const al = el.getAttribute && el.getAttribute('aria-label');
      if (al && ariaLabels.size < 30) ariaLabels.add(al.slice(0, 40));
    });
    if (!ph) {
      const p = findPlaceholder(doc);
      if (p) {
        fire(p);   // ← 좌표 불필요 합성 활성화 (핵심)
        const r = p.getBoundingClientRect();
        placeholderRect = { w: Math.round(r.width), h: Math.round(r.height), l: Math.round(r.left), t: Math.round(r.top) };
        let ox = 0, oy = 0;
        if (doc !== document) {
          const fr = [...document.querySelectorAll('iframe')].find(f => { try { return f.contentDocument === doc; } catch (_) { return false; } });
          if (fr) { const b = fr.getBoundingClientRect(); ox = b.left; oy = b.top; }
        }
        // 좌표 클릭용: 크기가 있으면 중심, 없으면 좌상단(0,0) 부근(폴백은 화면중앙 아님 — placeholder는 보통 좌상단)
        const x = (r.width > 1) ? ox + r.left + r.width / 2 : ox + r.left + 4;
        const y = (r.height > 1) ? oy + r.top + r.height / 2 : oy + r.top + 4;
        ph = { x: Math.round(x), y: Math.round(y) };
      }
    }
  }
  return {
    semCount,
    placeholder: ph,
    glassCenter, glassCorner,
    diag: {
      iframeCount, glassPane, semCount, placeholderFound: !!ph, placeholderRect,
      glassPaneShadow, glassPaneKids,
      fltTags: [...fltTags].slice(0, 20),
      ariaLabels: [...ariaLabels].slice(0, 30),
    },
  };
}

// ── Semantics 노드 목록: [{label, x, y, w, h, editable}] (viewport 좌표, iframe 오프셋 보정) ──
function _semList() {
  const out = [];
  const collect = (doc, ox, oy) => {
    const els = doc.querySelectorAll('flt-semantics, [id^="flt-semantic-node"]');
    els.forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const label = (el.getAttribute('aria-label') || el.getAttribute('aria-valuetext') || '').trim()
        || (el.childElementCount === 0 ? (el.textContent || '').trim() : '');
      out.push({
        label,
        role: el.getAttribute('role') || '',
        editable: el.getAttribute('role') === 'textbox' || !!el.querySelector('input,textarea') || el.tagName === 'INPUT',
        x: Math.round(ox + r.left + r.width / 2),
        y: Math.round(oy + r.top + r.height / 2),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    });
  };
  collect(document, 0, 0);
  document.querySelectorAll('iframe').forEach(f => {
    try { if (f.contentDocument) { const b = f.getBoundingClientRect(); collect(f.contentDocument, b.left, b.top); } } catch (_) {}
  });
  return out;
}

async function semList(tabId) { return (await exec(tabId, _semList)) || []; }

// ── 신뢰 클릭 / 타이핑 (CDP) ──
async function trustedClick(tabId, x, y) {
  const base = { x, y, button: 'left', clickCount: 1, pointerType: 'mouse' };
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, button: 'none' });
  await sleep(60);
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await sleep(60);
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
}
async function trustedType(tabId, text) {
  // insertText 가 가장 안정적 (IME 커밋과 동일 — 한글 조합 안 깨짐). 실패 대비 키 폴백.
  try { await cdp(tabId, 'Input.insertText', { text }); }
  catch (_) {
    for (const ch of text) {
      await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', text: ch });
      await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', text: ch });
      await sleep(25);
    }
  }
}

// ── 신뢰 키 입력 (CDP) — Tab/Space/Enter/ArrowDown 등 ──
const _KEYMAP = {
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
};
async function trustedKey(tabId, keyName, times) {
  const m = _KEYMAP[keyName];
  if (!m) throw new Error('알 수 없는 키: ' + keyName);
  const n = Math.max(0, times || 0);
  for (let i = 0; i < n; i++) {
    const base = { key: m.key, code: m.code, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk };
    await cdp(tabId, 'Input.dispatchKeyEvent', { type: m.text ? 'keyDown' : 'rawKeyDown', ...base, ...(m.text ? { text: m.text } : {}) });
    await sleep(30);
    await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(140);
  }
}

const _norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

// ── 라벨로 요소 찾기 (후보 배열, 부분일치) → 노드 반환. pick: 'last'면 가장 아래(다음 버튼 등) ──
async function findByLabel(tabId, candidates, { timeoutMs = 8000, pick = 'first', exact = false } = {}) {
  const t0 = Date.now();
  let lastDump = [];
  while (Date.now() - t0 < timeoutMs) {
    const list = await semList(tabId);
    lastDump = list;
    const hits = [];
    for (const n of list) {
      const nl = _norm(n.label);
      if (!nl) continue;
      for (const c of candidates) {
        const nc = _norm(c);
        if (exact ? nl === nc : nl.includes(nc)) { hits.push(n); break; }
      }
    }
    if (hits.length) {
      if (pick === 'last') hits.sort((a, b) => b.y - a.y);
      return hits[0];
    }
    await sleep(400);
  }
  const dump = lastDump.filter(n => n.label).slice(0, 30).map(n => n.label).join(' | ');
  throw new Error(`라벨 못 찾음: [${candidates.join(', ')}]\n현재 화면 라벨: ${dump || '(없음 — 의미트리 미활성?)'}`);
}

async function clickLabel(tabId, candidates, opts) {
  const n = await findByLabel(tabId, candidates, opts);
  await trustedClick(tabId, n.x, n.y);
  await sleep(450);
  return n;
}

async function typeInto(tabId, fieldCandidates, text, opts) {
  const n = await findByLabel(tabId, fieldCandidates, opts);
  await trustedClick(tabId, n.x, n.y);
  await sleep(450);
  await trustedType(tabId, text);
  await sleep(350);
}

// ── send 탭 확보: 열려 있으면 사용, 없으면 진입 페이지에서 '확인서 전송하기' 클릭 ──
function _clickEntryButton() {
  const btns = [...document.querySelectorAll('button, [role="button"], a')];
  const b = btns.find(el => /확인서\s*전송하기/.test(el.textContent || ''));
  if (b) { b.click(); return true; }
  return false;
}
async function ensureSendTab() {
  let tabs = await chrome.tabs.query({ url: 'https://crm.tossinsu.com/*' });
  let sendTab = tabs.find(t => SEND_RE.test(t.url || ''));
  if (sendTab) return sendTab.id;

  let entry = tabs.find(t => (t.url || '').includes('/pcs-documents'));
  if (!entry) {
    entry = await chrome.tabs.create({ url: ENTRY_URL, active: true });
    await sleep(3500);
  } else {
    await chrome.tabs.update(entry.id, { active: true });
    await sleep(600);
  }
  const clicked = await exec(entry.id, _clickEntryButton);
  if (!clicked) throw new Error("'확인서 전송하기' 버튼을 찾지 못했습니다. CRM 로그인/페이지 로딩을 확인하세요.");
  // 새 탭(/send) 등장 대기
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    tabs = await chrome.tabs.query({ url: 'https://crm.tossinsu.com/*' });
    sendTab = tabs.find(t => SEND_RE.test(t.url || ''));
    if (sendTab) { await chrome.tabs.update(sendTab.id, { active: true }); await sleep(2500); return sendTab.id; }
  }
  throw new Error('확인서 전송(/send) 탭이 열리지 않았습니다.');
}

// ── 메인 시나리오 ──
async function run(payload) {
  const { customer, best, company, searchTerm, category } = payload || {};
  if (!customer || !best) throw new Error('고객/상품 데이터가 없습니다.');

  // 권한 게이트 — 로그인 + 관리자 승인된 사용자만
  const gate = await chrome.storage.local.get(['extAuthOK']);
  if (gate.extAuthOK !== true) throw new Error('⛔ 권한 없음 — 확장 로그인 후 관리자 승인이 필요합니다.');

  const tabId = await ensureSendTab();
  try { await chrome.debugger.attach({ tabId }, '1.3'); } catch (e) {
    if (!/already attached/i.test(String(e))) throw new Error('디버거 연결 실패: ' + (e.message || e));
  }

  try {
    await overlay(tabId, '🤖 <b>금소법 로컬 자동 진행</b> 시작…<br>① 화면 의미 트리 활성화 중');

    // ① Semantics 활성화 (합성 이벤트 + placeholder 신뢰 클릭 + Tab 키 병행, 최대 ~20초)
    let on = false, lastDiag = null;
    for (let i = 0; i < 40; i++) {
      const p = await exec(tabId, _semProbe);    // 매 호출이 placeholder에 합성 이벤트 발사
      if (p) lastDiag = p.diag;
      if (p && p.semCount > 3) { on = true; break; }
      if (p && p.placeholder) await trustedClick(tabId, p.placeholder.x, p.placeholder.y);  // 신뢰 클릭 병행
      // placeholder가 없는 최신 Flutter 빌드 대응: glass-pane 위 신뢰 포인터 이벤트로
      // DesktopSemanticsEnabler 를 유도(실제 마우스 이동→코너 클릭) + Tab 키 병행
      if (p && !p.placeholder) {
        const gc = p.glassCenter, corner = p.glassCorner;
        try {
          if (gc) {
            await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: gc.x, y: gc.y, button: 'none', pointerType: 'mouse' });
            await sleep(40);
            await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: gc.x + 6, y: gc.y + 4, button: 'none', pointerType: 'mouse' });
          }
          // 부작용 최소 지점(좌상단 코너) 신뢰 클릭 — 데스크톱 enabler 는 첫 포인터다운에 활성화
          if (corner) await trustedClick(tabId, corner.x, corner.y);
          await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
          await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        } catch (_) {}
      }
      if (i % 6 === 5 && lastDiag) {
        await overlay(tabId, `① 의미 트리 활성화 시도 중… (${i + 1}/40)<br>` +
          `iframe ${lastDiag.iframeCount} · glassPane ${lastDiag.glassPane ? 'O' : 'X'} · ` +
          `placeholder ${lastDiag.placeholderFound ? 'O' : 'X'} · semNodes ${lastDiag.semCount}`);
      }
      await sleep(500);
    }
    if (!on) {
      const d = lastDiag || {};
      throw new Error(
        'Flutter 의미 트리를 켜지 못했습니다.\n' +
        `진단: iframe=${d.iframeCount}, glassPane=${d.glassPane}, placeholderFound=${d.placeholderFound}, ` +
        `placeholderRect=${d.placeholderRect ? JSON.stringify(d.placeholderRect) : 'null'}, semNodes=${d.semCount}\n` +
        `glassPaneShadow=${d.glassPaneShadow} · glassPaneKids=[${(d.glassPaneKids || []).join(', ') || '없음'}]\n` +
        `flt태그=[${(d.fltTags || []).join(', ') || '없음'}]\n` +
        `aria-label들=[${(d.ariaLabels || []).join(' | ') || '없음'}]\n` +
        '※ glass-pane 신뢰 클릭/Tab으로도 semantics가 안 켜졌습니다. 이 진단 줄을 캡처해 주세요.');
    }

    // ② 확인서 종류 선택 — 기본 둘 다 체크 → 다음
    await overlay(tabId, '② 확인서 종류 → <b>다음</b>');
    await clickLabel(tabId, ['다음'], { pick: 'last' });

    // ③ 기본정보 입력
    await overlay(tabId, `③ 기본정보 입력<br>· ${customer.고객명} / ${customer.연락처} / ${customer.생년월일}`);
    await typeInto(tabId, ['고객명', '이름'], customer.고객명 || '');
    await typeInto(tabId, ['연락처', '휴대폰', '전화'], customer.연락처 || '');
    if (customer.생년월일) await typeInto(tabId, ['생일', '생년월일'], customer.생년월일);
    await clickLabel(tabId, ['다음'], { pick: 'last' });

    // ④ 상품비교 — 카테고리 → 보험사 → 상품
    const cat = category || '장기';
    await overlay(tabId, `④ 상품비교<br>· 카테고리 <b>${cat}</b> · ${company && company.inscoNm}<br>· ${best.procNm.slice(0, 60)}…`);
    try { await clickLabel(tabId, [cat], { timeoutMs: 5000 }); } catch (_) { /* 이미 선택돼 있을 수 있음 */ }

    await typeInto(tabId, ['보험사'], (company && company.inscoNm || '').slice(0, 3));
    await clickLabel(tabId, [company.inscoNm], { timeoutMs: 6000 });

    await typeInto(tabId, ['상품'], searchTerm || best.procNm.slice(0, 10));
    // 후보 중 매칭 procNm 과 정규화 일치(우선) → 부분 일치(차선)
    let prodNode = null;
    try { prodNode = await clickLabel(tabId, [best.procNm], { timeoutMs: 7000, exact: true }); }
    catch (_) { prodNode = await clickLabel(tabId, [best.procNm.slice(0, 24)], { timeoutMs: 5000 }); }
    await clickLabel(tabId, ['다음'], { pick: 'last' });

    // ⑤ 금소법 단계 — '다음' 류 진행 시도 (없으면 통과)
    await overlay(tabId, '⑤ 금소법 단계 진행 중…');
    try { await clickLabel(tabId, ['다음', '확인'], { pick: 'last', timeoutMs: 6000 }); } catch (_) {}

    // ⑥ ⛔ 서명&완료 — 자동 진행 금지, 정지
    await overlay(tabId,
      '✅ <b>자동 진행 완료 — 서명&완료 직전에서 정지했습니다.</b><br>' +
      `· 고객: ${customer.고객명} (${customer.연락처})<br>` +
      `· 상품: ${best.procNm}<br>· 코드: ${best.productCd}<br><br>` +
      '⛔ <b>고객 발송(서명 요청)은 직접 확인 후 눌러주세요.</b> (비가역 동작)');
    return { ok: true };
  } catch (e) {
    await overlay(tabId, '❌ 자동 진행 실패<br>' + String(e && e.message || e).replace(/\n/g, '<br>') +
      '<br><br>이 메시지를 캡처해 전달해 주시면 해당 단계를 보정합니다.', true);
    throw e;
  } finally {
    try { await chrome.debugger.detach({ tabId }); } catch (_) {}
  }
}

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req && req.action === 'pcsLocalRun') {
    run(req.payload)
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;   // async
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 좌표 보정 모드 — 의미트리를 못 켜는 Flutter 빌드용
//   가르치기로 저장된 flutter-view 대비 비율 좌표(pcsCalibration.targets)를
//   재생한다. 보험사·상품은 매칭으로 확정된 이름을 입력 후 첫 결과를 클릭하므로
//   캔버스를 읽을 필요가 없다. ⛔ 금소법·서명 단계 진입 직전 정지.
// ════════════════════════════════════════════════════════════════════════════

// flutter-view 의 최상위 뷰포트 좌표 rect (iframe 오프셋 보정)
function _flutterViewRect() {
  const find = (doc) => doc.querySelector('flutter-view, flt-glass-pane');
  let fv = find(document), ox = 0, oy = 0;
  if (!fv) {
    for (const f of document.querySelectorAll('iframe')) {
      try { if (f.contentDocument) { const e = find(f.contentDocument); if (e) { fv = e; const b = f.getBoundingClientRect(); ox = b.left; oy = b.top; break; } } } catch (_) {}
    }
  }
  if (!fv) return null;
  const r = fv.getBoundingClientRect();
  return { left: ox + r.left, top: oy + r.top, width: r.width, height: r.height };
}

// 현재 키보드 포커스 상태 — Flutter 텍스트칸은 flt-text-editing-host 의 실제 input 으로
// 노출되므로 editable/value 를 읽을 수 있다(버튼/체크박스 포커스는 입력칸 아님).
function _deepActive() {
  let a = document.activeElement, guard = 0;
  while (a && a.tagName === 'IFRAME' && guard++ < 5) {
    try { const d = a.contentDocument; if (!d || !d.activeElement) break; a = d.activeElement; } catch (_) { break; }
  }
  while (a && a.shadowRoot && a.shadowRoot.activeElement && guard++ < 12) a = a.shadowRoot.activeElement;
  const editable = !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable));
  let inHost = false;
  try { inHost = !!(a && a.closest && a.closest('flt-text-editing-host')); } catch (_) {}
  return {
    url: location.href,
    tag: a ? (a.tagName || '').toLowerCase() : '(none)',
    editable, inHost,
    value: editable ? (a.value != null ? a.value : (a.textContent || '')) : '',
  };
}

// flutter-view 가 로딩될 때까지 대기 (navigate 후)
async function waitFlutterReady(tabId, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - (t0) < (timeoutMs || 15000)) {
    const r = await exec(tabId, _flutterViewRect).catch(() => null);
    if (r && r.width > 2 && r.height > 2) return r;
    await sleep(500);
  }
  return null;
}

// Flutter 캔버스에 키보드 포커스 — 안전한 좌상단 모서리 신뢰 클릭
async function focusFlutter(tabId) {
  const r = await exec(tabId, _flutterViewRect);
  if (!r) throw new Error('flutter-view 를 찾지 못했습니다 (send 화면이 맞는지 확인).');
  await trustedClick(tabId, Math.round(r.left + 8), Math.round(r.top + 8));
  await sleep(200);
}

async function ensureDebugger(tabId) {
  try { await chrome.debugger.attach({ tabId }, '1.3'); }
  catch (e) { if (!/already attached/i.test(String(e))) throw new Error('디버거 연결 실패: ' + (e.message || e)); }
}

async function runCalibrated(payload) {
  const { calibration, steps, customer, best } = payload || {};
  const verify = !!(payload && payload.verify);   // 검증 모드: 단계별 포커스/입력값 리포트
  const report = [];
  if (!calibration || !calibration.targets) throw new Error('보정 좌표가 없습니다. 먼저 가르치기를 하세요.');
  if (!Array.isArray(steps) || !steps.length) throw new Error('진행할 단계가 없습니다.');

  const gate = await chrome.storage.local.get(['extAuthOK']);
  if (gate.extAuthOK !== true) throw new Error('⛔ 권한 없음 — 확장 로그인 후 관리자 승인이 필요합니다.');

  const T = calibration.targets;
  // 진행할 탭 확보 (send 탭 우선, 없으면 임의 CRM 탭, 그래도 없으면 새 탭)
  let tabId;
  {
    const tabs = await chrome.tabs.query({ url: 'https://crm.tossinsu.com/*' });
    const t = tabs.find(t => SEND_RE.test(t.url || '')) || tabs[0];
    tabId = t ? t.id : (await chrome.tabs.create({ url: ENTRY_URL, active: true })).id;
    await chrome.tabs.update(tabId, { active: true });
  }
  await ensureDebugger(tabId);

  // 비율 → 절대 좌표 (매번 fvRect 재측정: 화면 전환에도 견고)
  async function absOf(id) {
    const t = T[id];
    if (!t) return null;
    const r = await exec(tabId, _flutterViewRect);
    if (!r) throw new Error('flutter-view 를 찾지 못했습니다 (send 화면이 맞는지 확인).');
    return { x: Math.round(r.left + t.xf * r.width), y: Math.round(r.top + t.yf * r.height) };
  }

  try {
    await overlay(tabId, '📐 <b>좌표 모드 자동 진행</b> 시작…').catch(() => {});

    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      const tag = `▶ 단계 ${i + 1}/${steps.length} · ${st.label || st.action}`;
      let waited = false;   // expectInput 분기가 이미 대기했으면 끝에서 또 안 기다림

      switch (st.action) {
        case 'navigate': {
          await chrome.tabs.update(tabId, { url: st.url });
          const ready = await waitFlutterReady(tabId, 15000);
          await ensureDebugger(tabId);   // 내비게이션으로 분리됐을 수 있음
          if (!ready) throw new Error('send 화면(Flutter) 로딩 실패 — 로그인/URL 확인.');
          await overlay(tabId, tag).catch(() => {});
          break;
        }
        case 'focus':
          await focusFlutter(tabId);
          await overlay(tabId, tag).catch(() => {});
          break;
        case 'click': {
          const p = await absOf(st.id);
          if (!p) { if (st.optional) break; throw new Error(`좌표 미등록: ${st.id} — 가르치기를 다시 하세요.`); }
          await overlay(tabId, tag).catch(() => {});
          await trustedClick(tabId, p.x, p.y);
          // 입력칸 기대 단계(보험사/상품): 검색 모달이 열릴 시간(대기시간)을 준 뒤
          //   포커스가 입력칸이 아니면 정지 — 이후 Space 가 카테고리로 새는 것 방지.
          if (st.expectInput) {
            const w = Math.max(500, typeof st.waitAfter === 'number' ? st.waitAfter : 0);
            await sleep(w); waited = true;
            let pr = null; try { pr = await exec(tabId, _deepActive); } catch (_) {}
            if (!pr || !pr.editable) {
              throw new Error(`'${st.label || st.id}' 클릭 후 입력칸 포커스 실패.\n→ 이 좌표 위치(가르치기) 또는 앞 단계(장기 선택)를 확인하세요.\n(이후 Space가 카테고리를 잘못 체크하는 것을 막기 위해 정지)`);
            }
          }
          break;
        }
        case 'type':
          await overlay(tabId, `${tag}${st.text ? ` ← "${String(st.text).slice(0, 20)}"` : ''}`).catch(() => {});
          if (st.text) await trustedType(tabId, String(st.text));
          break;
        case 'typeIfPresent':
          if (st.text) { await overlay(tabId, `${tag} ← "${String(st.text).slice(0, 20)}"`).catch(() => {}); await trustedType(tabId, String(st.text)); }
          break;
        case 'key':
        case 'keyByCategory':
          await overlay(tabId, `${tag} (${st.key}×${st.times || 0})`).catch(() => {});
          await trustedKey(tabId, st.key, st.times);
          break;
        case 'notify':
          await overlay(tabId,
            '✅ <b>자동 진행 완료 — 정지.</b><br>' +
            (customer ? `· 고객: ${customer.고객명} (${customer.연락처})<br>` : '') +
            (best ? `· 상품: ${best.procNm}<br>· 코드: ${best.productCd}<br>` : '') +
            `<br>⚠️ <b>${st.message || '화면 확인 후 서명·발송을 직접 진행하세요.'}</b>`).catch(() => {});
          try {
            chrome.notifications.create('', {
              type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
              title: st.title || '서명 필요', message: st.message || '화면 확인 후 서명하세요.', priority: 2,
            });
          } catch (_) {}
          break;
        default:
          break;
      }
      await sleep(waited ? 0 : (typeof st.waitAfter === 'number' ? st.waitAfter : 400));

      // 검증 모드: 단계 직후 포커스/입력 상태를 읽어 기록
      if (verify) {
        let pr = null; try { pr = await exec(tabId, _deepActive); } catch (_) {}
        const focus = pr ? (pr.editable ? `입력칸="${String(pr.value || '').slice(0, 24)}"` : `비입력(${pr.tag})`) : '?';
        let note = '';
        if (st.action === 'type' || st.action === 'typeIfPresent') {
          if (st.text) note = (pr && pr.editable && pr.value && String(pr.value).indexOf(String(st.text)) >= 0)
            ? '✅ 입력 확인' : '⚠️ 입력 안 들어감/불일치';
        } else if (st.action === 'key' && st.key === 'Space') {
          note = (pr && pr.editable) ? 'ℹ️ Space 후 입력칸 포커스(페이지 이동 후 자동포커스일 수 있음)' : '↪ 페이지/선택 시도';
        } else if (st.action === 'click') {
          note = (pr && pr.editable) ? '✅ 입력칸 포커스됨' : 'ℹ️ 포커스가 입력칸 아님';
        } else if (st.action === 'navigate') {
          note = (pr && /\/send/.test(pr.url || '')) ? '✅ send 화면' : '⚠️ URL 확인';
        }
        report.push({ i: i + 1, action: st.action, key: st.key || '', times: st.times || '', label: st.label || '', focus, note });
        await overlay(tabId, `🔍 검증 ${i + 1}/${steps.length} · ${st.label || st.action}<br>포커스: ${focus}<br>${note}`).catch(() => {});
      }
    }
    return { ok: true, report };
  } catch (e) {
    await overlay(tabId, '❌ 좌표 모드 실패<br>' + String(e && e.message || e).replace(/\n/g, '<br>') +
      '<br><br>위치가 어긋났다면 팝업에서 <b>📐 좌표 가르치기</b>를 다시 하거나, 단계 대기시간을 늘려보세요.', true).catch(() => {});
    if (verify) return { ok: false, error: String(e && e.message || e), report };
    throw e;
  } finally {
    try { await chrome.debugger.detach({ tabId }); } catch (_) {}
  }
}

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req && req.action === 'pcsCalibRun') {
    runCalibrated(req.payload)
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 매월 1일 상품 카탈로그 자동 동기화
//   상품 목록은 매칭 시점마다 항상 라이브 API(/api-mobile/v3/crm/pcs/product/by-company)
//   에서 받아오므로 본질적으로 늘 최신이다. 이 동기화는 그 "최신 상태"를 매월 1일
//   자동으로 확인해 두고, 팝업에 보험사별 상품 수 + 기준일을 보여주기 위한 것이다.
//   (send 화면의 Flutter 상품 목록과 동일 소스 — 같은 inscoCd 로 같은 카탈로그를 본다)
// ════════════════════════════════════════════════════════════════════════════
const PCS_SYNC_ALARM = 'pcsMonthlyCatalogSync';
// 첫 실행 시 비어 있지 않도록 자주 쓰는 보험사를 시드. 매칭/진행할 때 자동 누적된다.
const PCS_SEED_INSURERS = ['메리츠화재', '삼성화재', '현대해상', 'DB손해보험', 'KB손해보험'];

// 다음 달 1일 00:05 (로컬) 타임스탬프
function _firstOfNextMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 5, 0, 0).getTime();
}

function _ensureMonthlyAlarm() {
  chrome.alarms.get(PCS_SYNC_ALARM, (a) => {
    if (!a) chrome.alarms.create(PCS_SYNC_ALARM, { when: _firstOfNextMonth() });
  });
}

// 로그인된 CRM 탭 찾기 (없으면 null) — 쿠키 동봉 동일출처 fetch 를 위해 탭 컨텍스트 사용
async function _findCrmTab() {
  const tabs = await chrome.tabs.query({ url: 'https://crm.tossinsu.com/*' });
  return tabs[0] || null;
}

// CRM 탭에서 보험사명 → { inscoCd, inscoNm, count, forSale } 조회 (매처 모듈 주입 후 실행)
async function _fetchCatalogInTab(tabId, companyName) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['pcs-automation/pcs-product-matcher.js'] });
  } catch (_) {}
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (name) => {
      try {
        const M = window.PCSProductMatcher;
        if (!M) return { error: '매처 미로드' };
        const co = await M.resolveCompany(name);
        if (!co) return { error: '보험사 미발견' };
        const products = await M.fetchProducts(co.inscoCd);
        return {
          inscoCd: co.inscoCd, inscoNm: co.inscoNm,
          count: products.length,
          forSale: products.filter(p => p.isForSale).length,
        };
      } catch (e) { return { error: String(e && e.message || e) }; }
    },
    args: [companyName],
  });
  return result || { error: '응답 없음' };
}

// 추적 대상 보험사 목록 (시드 + 사용 누적)
async function _trackedInsurers() {
  const g = await chrome.storage.local.get(['pcsCatalogInsurers']);
  const used = Array.isArray(g.pcsCatalogInsurers) ? g.pcsCatalogInsurers : [];
  return Array.from(new Set([...PCS_SEED_INSURERS, ...used]));
}

// 동기화 실행 — 결과를 chrome.storage.local.pcsCatalog 에 저장
async function syncCatalog(reason) {
  const tab = await _findCrmTab();
  if (!tab) {
    // 로그인 탭이 없으면 보류 — 다음 팝업 열림/브라우저 시작 때 재시도
    await chrome.storage.local.set({ pcsCatalogPending: true });
    return { ok: false, pending: true, error: 'CRM 로그인 탭 없음 — 보류' };
  }
  const insurers = await _trackedInsurers();
  const out = {};
  for (const name of insurers) {
    const r = await _fetchCatalogInTab(tab.id, name);
    out[r.inscoNm || name] = r.error
      ? { error: r.error, at: Date.now() }
      : { inscoCd: r.inscoCd, count: r.count, forSale: r.forSale, at: Date.now() };
  }
  const snapshot = { asOf: new Date().toISOString(), reason: reason || 'manual', insurers: out };
  await chrome.storage.local.set({ pcsCatalog: snapshot, pcsCatalogPending: false });
  _ensureMonthlyAlarm(); // 다음 달 1일 재예약
  return { ok: true, snapshot };
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === PCS_SYNC_ALARM) {
    syncCatalog('monthly').finally(_ensureMonthlyAlarm);
  }
});

// 설치/브라우저 시작 시 알람 보장 + 보류분 있으면 기회 동기화
chrome.runtime.onInstalled.addListener(() => { _ensureMonthlyAlarm(); syncCatalog('installed').catch(() => {}); });
chrome.runtime.onStartup.addListener(() => {
  _ensureMonthlyAlarm();
  chrome.storage.local.get(['pcsCatalogPending'], (g) => { if (g.pcsCatalogPending) syncCatalog('startup-pending').catch(() => {}); });
});

// 팝업 ↔ 서비스워커 메시지 (수동 동기화 / 상태 조회 / 보험사 사용 누적)
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (!req) return;
  if (req.action === 'pcsCatalogSyncNow') {
    syncCatalog('manual').then(sendResponse).catch(e => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  if (req.action === 'pcsCatalogStatus') {
    chrome.storage.local.get(['pcsCatalog', 'pcsCatalogPending'], (g) =>
      sendResponse({ ok: true, catalog: g.pcsCatalog || null, pending: !!g.pcsCatalogPending }));
    return true;
  }
  if (req.action === 'pcsTrackInsurer' && req.company) {
    chrome.storage.local.get(['pcsCatalogInsurers'], (g) => {
      const list = Array.isArray(g.pcsCatalogInsurers) ? g.pcsCatalogInsurers : [];
      if (!list.includes(req.company)) list.push(req.company);
      chrome.storage.local.set({ pcsCatalogInsurers: list }, () => sendResponse({ ok: true }));
    });
    return true;
  }
});
