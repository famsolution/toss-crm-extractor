// ──────────────────────────────────────────────────────────────────────────
// pcs-clip-intercept.js — 페이지(MAIN world)에 주입되어 navigator.clipboard.write
//   를 가로챈다. CRM '이미지 복사'가 클립보드에 이미지를 쓰는 순간 그 blob 을
//   dataURL 로 변환해 window.postMessage 로 content script 에 전달한다.
//   → 클립보드를 "다시 읽지" 않으므로 document 포커스가 필요 없다(팝업 실행 OK).
// ──────────────────────────────────────────────────────────────────────────
(function () {
  const _clipAlready = !!window.__sdhClipPatched;
  window.__sdhClipPatched = true;

  // 진단용 — CRM 이 클립보드에 무엇을 했는지 content script 에 알림 (이미지 내용은 보내지 않음)
  function note(ev, msg) { try { window.postMessage({ __sdhClipEvent: ev, msg: String(msg || '').slice(0, 160), at: Date.now() }, '*'); } catch (e) {} }
  function emit(blob) {
    try {
      const fr = new FileReader();
      fr.onload = function () {
        try { window.postMessage({ __sdhImageCaptured: true, dataURL: fr.result, at: Date.now() }, '*'); } catch (e) {}
      };
      fr.readAsDataURL(blob);
    } catch (e) {}
  }

  // 1) navigator.clipboard.write 가로채기 (이미지 복사의 표준 경로)
  if (!_clipAlready) try {
    const cb = navigator.clipboard;
    if (cb && typeof cb.write === 'function') {
      const orig = cb.write.bind(cb);
      cb.write = function (items) {
        note('write', (items || []).map(function (i) { return (i.types || []).join('+'); }).join(','));
        try {
          (items || []).forEach(function (item) {
            (item.types || []).forEach(function (type) {
              if (type && type.indexOf('image/') === 0) {
                Promise.resolve(item.getType(type)).then(emit).catch(function () {});
              }
            });
          });
        } catch (e) {}
        const pr = orig(items);
        try { pr.then(function () { note('write-ok'); }, function (e) { note('write-err', (e && (e.name + ': ' + e.message)) || e); }); } catch (e) {}
        return pr;
      };
    }
  } catch (e) {}

  // 2) ClipboardItem 생성 가로채기 (write 전에 blob 을 미리 확보 — 더 이른 시점)
  if (!_clipAlready) try {
    if (typeof window.ClipboardItem === 'function') {
      const OrigCI = window.ClipboardItem;
      const Patched = function (data) {
        note('item', Object.keys(data || {}).join('+'));
        try {
          Object.keys(data || {}).forEach(function (type) {
            if (type && type.indexOf('image/') === 0) {
              Promise.resolve(data[type]).then(function (b) { if (b instanceof Blob) emit(b); }).catch(function () {});
            }
          });
        } catch (e) {}
        return new OrigCI(data);
      };
      Patched.prototype = OrigCI.prototype;
      window.ClipboardItem = Patched;
    }
  } catch (e) {}
})();
