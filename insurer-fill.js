// ──────────────────────────────────────────────────────────────
// 보험사 GA/설계사 포털 로그인 자동입력
//   CRM 비번탭에서 "🔗 접속" 클릭 시 열리는 URL 의 hash(#__tossfill=base64)에
//   담긴 {id, pw, clear} 를 읽어 → 기존 값 삭제 후 기록된 ID/비번 자동입력
// ──────────────────────────────────────────────────────────────
(function () {
  try {
    var m = (location.hash || '').match(/__tossfill=([^&]+)/);
    if (!m) return;
    var cred;
    try { cred = JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch (e) { return; }
    if (!cred || (!cred.id && !cred.pw)) return;
    // 자격정보 노출 방지 — hash 즉시 제거
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}

    function setVal(el, v) {
      if (!el) return;
      try { el.focus(); } catch (e) {}
      if (cred.clear) el.value = '';
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('keyup', { bubbles: true }));
    }
    function visible(el) { return el && el.offsetParent !== null && !el.disabled && !el.readOnly; }

    function fill() {
      var pw = Array.prototype.find.call(
        document.querySelectorAll('input[type="password"]'), visible
      ) || null;
      var idf = null;
      var scope = (pw && pw.form) ? pw.form : document;
      var texts = Array.prototype.filter.call(
        scope.querySelectorAll('input'),
        function (i) {
          var t = (i.type || 'text').toLowerCase();
          return (t === 'text' || t === 'email' || t === 'tel' || t === '') && visible(i);
        }
      );
      // 아이디 후보: name/id/placeholder 에 id·user·login·사번·아이디 등이 있는 것 우선
      idf = texts.find(function (i) {
        var k = ((i.name || '') + ' ' + (i.id || '') + ' ' + (i.placeholder || '') + ' ' + (i.getAttribute('aria-label') || '')).toLowerCase();
        return /id|user|login|userid|loginid|empno|사번|아이디|회원/.test(k);
      }) || texts[0] || null;

      var did = false;
      if (idf && cred.id != null && cred.id !== '') { setVal(idf, cred.id); did = true; }
      if (pw && cred.pw != null && cred.pw !== '') { setVal(pw, cred.pw); did = true; }
      return did;
    }

    // SPA/지연 렌더 대응 — 최대 ~10초 재시도
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      var ok = false;
      try { ok = fill(); } catch (e) {}
      if (ok || tries > 25) clearInterval(iv);
    }, 400);
    // DOM 준비 직후 1차 시도
    if (document.readyState === 'complete' || document.readyState === 'interactive') { try { fill(); } catch (e) {} }
    else document.addEventListener('DOMContentLoaded', function () { try { fill(); } catch (e) {} });
  } catch (e) { /* noop */ }
})();
