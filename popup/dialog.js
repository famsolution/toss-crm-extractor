/* ═══════════════════════════════════════════════════════════════════
   popup/dialog.js — alert/confirm 대체 모달
   확장 코드에서 alert/confirm 사용이 금지되어 있으므로(CLAUDE.md),
   같은 자리에서 쓸 수 있는 Promise 기반 다이얼로그를 제공한다.
     · showAlert(message, title?)          → Promise<void>          (확인 버튼 1개)
     · showConfirm(message, title?)        → Promise<boolean>       (확인/취소)
     · showPrompt(message, title?, value?) → Promise<string|null>   (입력 + 확인/취소)
   ─ 여러 줄 메시지는 textContent + white-space:pre-wrap 으로 그대로 표시.
   ═══════════════════════════════════════════════════════════════════ */

let __dlgResolve = null;

function __dlgEls() {
  return {
    backdrop: document.getElementById('modalBackdrop'),
    title:    document.getElementById('modalTitle'),
    body:     document.getElementById('modalBody'),
    input:    document.getElementById('modalInput'),
    ok:       document.getElementById('modalOk'),
    cancel:   document.getElementById('modalCancel'),
  };
}

function __dlgClose(result) {
  const { backdrop } = __dlgEls();
  if (backdrop) backdrop.hidden = true;
  const resolve = __dlgResolve;
  __dlgResolve = null;
  if (resolve) resolve(result);
}

function __dlgOpen({ message, title, withCancel, withInput, value }) {
  const els = __dlgEls();
  // 팝업 DOM 이 없는 상황에서는 취소로 간주한다 (동의 없이 진행하지 않는다).
  if (!els.backdrop) return Promise.resolve(withInput ? null : !withCancel);

  __dlgClose(false);   // 열려 있던 이전 다이얼로그 정리

  els.title.textContent = title || (withCancel ? '확인' : '알림');
  els.body.textContent = String(message == null ? '' : message);
  els.cancel.hidden = !withCancel;
  els.input.hidden = !withInput;
  els.input.value = withInput ? String(value == null ? '' : value) : '';
  els.backdrop.hidden = false;
  (withInput ? els.input : els.ok).focus();

  return new Promise(resolve => { __dlgResolve = resolve; });
}

function showAlert(message, title) {
  return __dlgOpen({ message, title, withCancel: false });
}

function showConfirm(message, title) {
  return __dlgOpen({ message, title, withCancel: true });
}

// 입력값을 돌려준다. 취소하면 null — 네이티브 입력창과 같은 계약.
function showPrompt(message, title, value) {
  return __dlgOpen({ message, title, withCancel: true, withInput: true, value })
    .then(ok => (ok ? __dlgEls().input.value : null));
}

document.addEventListener('DOMContentLoaded', () => {
  const els = __dlgEls();
  if (!els.backdrop) return;
  els.ok.addEventListener('click', () => __dlgClose(true));
  els.cancel.addEventListener('click', () => __dlgClose(false));
  els.input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); __dlgClose(true); }
  });
  els.backdrop.addEventListener('click', e => {
    if (e.target === els.backdrop && !els.cancel.hidden) __dlgClose(false);
  });
  document.addEventListener('keydown', e => {
    if (els.backdrop.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); __dlgClose(false); }
    if (e.key === 'Enter')  { e.preventDefault(); __dlgClose(true); }
  });
});
