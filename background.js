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
