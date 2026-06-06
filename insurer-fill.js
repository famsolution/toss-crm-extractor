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
    // 입력칸의 설명 텍스트 모음 (name/id/placeholder/aria-label + 연결된 label + 직전 텍스트)
    function descOf(i) {
      var s = (i.name || '') + ' ' + (i.id || '') + ' ' + (i.placeholder || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' + (i.getAttribute('title') || '');
      try { if (i.id) { var l = document.querySelector('label[for="' + i.id + '"]'); if (l) s += ' ' + l.textContent; } } catch (e) {}
      try { var p = i.closest('label'); if (p) s += ' ' + p.textContent; } catch (e) {}
      try { var prev = i.previousElementSibling; if (prev && prev.textContent) s += ' ' + prev.textContent; } catch (e) {}
      return s.toLowerCase();
    }
    var ID_RE = /사원\s*번?호?|사번|아이디|회원|코드|\bid\b|user|login|emp|mbr|사용자/i;
    var SKIP_RE = /인증|생년|주민|보안|captcha|otp|sms|이메일|email|전화|휴대|phone|tel|검색|search/i;

    function fill() {
      var pwAll = Array.prototype.filter.call(document.querySelectorAll('input[type="password"]'), visible);
      var pw = pwAll.find(function (p) { return !SKIP_RE.test(descOf(p)); }) || pwAll[0] || null;
      var scope = (pw && pw.form) ? pw.form : document;
      var texts = Array.prototype.filter.call(scope.querySelectorAll('input'), function (i) {
        var t = (i.type || 'text').toLowerCase();
        return (t === 'text' || t === 'tel' || t === 'number' || t === '') && visible(i);
      });
      // ① 라벨/속성이 사원번호·아이디류이고 인증/생년월일이 아닌 것
      var idf = texts.find(function (i) { var d = descOf(i); return ID_RE.test(d) && !SKIP_RE.test(d); });
      // ② 없으면 비밀번호칸 바로 앞(DOM 순서)의 일반 텍스트칸
      if (!idf && pw) {
        var all = Array.prototype.slice.call(scope.querySelectorAll('input'));
        var pi = all.indexOf(pw);
        for (var j = pi - 1; j >= 0; j--) { if (texts.indexOf(all[j]) >= 0 && !SKIP_RE.test(descOf(all[j]))) { idf = all[j]; break; } }
      }
      // ③ 그래도 없으면 인증/생년 제외한 첫 텍스트칸
      if (!idf) idf = texts.find(function (i) { return !SKIP_RE.test(descOf(i)); }) || texts[0] || null;

      var did = false;
      if (idf && cred.id != null && cred.id !== '') { setVal(idf, cred.id); did = true; }
      if (pw && cred.pw != null && cred.pw !== '') { setVal(pw, cred.pw); did = true; }
      // 생년월일/년월일 — maxlength 우선, 없으면 호스트별 형식(현대해상=6자리, 메리츠/DB=8자리)
      if (cred.birth || cred.birth8) {
        var HOST_DATE_FMT = { 'sp.hi.co.kr': '6', 'www.mdbins.com': '8', 'nsso.meritzfire.com': '8' };
        var hf = HOST_DATE_FMT[location.hostname] || '';
        var dfs = texts.filter(function (i) { var d = descOf(i); return /생년월일|생일|년월일|birth|date.?of.?birth|dob|생\s*년/.test(d) && !/주민/.test(d); });
        dfs.forEach(function (df) {
          var ml = parseInt(df.getAttribute('maxlength') || '0', 10);
          var v;
          if (ml === 6) v = cred.birth || cred.birth8 || '';
          else if (ml === 8) v = cred.birth8 || cred.birth || '';
          else if (hf === '6') v = cred.birth || cred.birth8 || '';
          else if (hf === '8') v = cred.birth8 || cred.birth || '';
          else v = cred.birth8 || cred.birth || '';
          if (v) { setVal(df, v); did = true; }
        });
      }
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
