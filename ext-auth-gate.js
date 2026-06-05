// 🔐 확장 권한 게이트 — popup.js 보다 먼저 로드됨.
//   흐름: 로그인 → extUsers/{uid}.active 확인 → 통과 시 기능 활성 / 미승인 시 '승인 대기' 화면.
//   window._extAuthReady : Promise<boolean> (첫 인증상태). popup.js 가 await 해서 통과 못하면 기능 init 중단.
(function () {
  let _resolveReady;
  window._extAuthReady = new Promise(function (r) { _resolveReady = r; });
  window._extAuthOK = false;

  function $(id) { return document.getElementById(id); }
  function showLogin(sub) {
    var g = $('__ext_gate'); if (g) g.style.display = 'flex';
    var lb = $('__ext_login_box'); if (lb) lb.style.display = 'flex';
    var pb = $('__ext_pending_box'); if (pb) pb.style.display = 'none';
    if (sub) { var s = $('__ext_gate_sub'); if (s) s.textContent = sub; }
  }
  function showPending(email) {
    var g = $('__ext_gate'); if (g) g.style.display = 'flex';
    var lb = $('__ext_login_box'); if (lb) lb.style.display = 'none';
    var pb = $('__ext_pending_box'); if (pb) pb.style.display = 'block';
    var s = $('__ext_gate_sub'); if (s) s.textContent = '관리자 승인이 필요합니다.';
    var pe = $('__ext_pending_email'); if (pe && email) pe.textContent = email;
  }
  function hideGate() { var g = $('__ext_gate'); if (g) g.style.display = 'none'; }
  function setAuthFlag(v, user) {
    try {
      chrome.storage.local.set(v
        ? { extAuthOK: true, extUid: (user && user.uid) || '', extEmail: (user && user.email) || '' }
        : { extAuthOK: false });
    } catch (e) {}
  }

  function bindButtons() {
    var lb = $('__ext_login_btn');
    if (lb) lb.onclick = async function () {
      var email = (($('__ext_email') || {}).value || '').trim();
      var pw = (($('__ext_pw') || {}).value || '');
      var msg = $('__ext_gate_msg');
      if (!email || !pw) { if (msg) msg.textContent = '이메일과 비밀번호를 입력하세요.'; return; }
      if (msg) { msg.style.color = '#64748B'; msg.textContent = '로그인 중...'; }
      try {
        await window._fbAuth.signInWithEmailAndPassword(email, pw);
        // 이후 처리는 onAuthStateChanged 가 담당 (active 확인 → 통과 시 새로고침)
      } catch (e) {
        var bad = (e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential');
        if (msg) { msg.style.color = '#EF4444'; msg.textContent = '로그인 실패: ' + (bad ? '이메일/비밀번호를 확인하세요.' : (e.message || e.code)); }
      }
    };
    // 🆕 회원가입 — 누구나 가입 가능. 가입 직후 onAuthStateChanged 가 '대기(active:false)' 로 등록 → 관리자 승인 대기.
    var sb = $('__ext_signup_btn');
    if (sb) sb.onclick = async function () {
      var email = (($('__ext_email') || {}).value || '').trim();
      var pw = (($('__ext_pw') || {}).value || '');
      var msg = $('__ext_gate_msg');
      if (!email || !pw) { if (msg) { msg.style.color = '#EF4444'; msg.textContent = '이메일과 비밀번호를 입력하세요.'; } return; }
      if (pw.length < 6) { if (msg) { msg.style.color = '#EF4444'; msg.textContent = '비밀번호는 6자 이상이어야 합니다.'; } return; }
      if (msg) { msg.style.color = '#64748B'; msg.textContent = '가입 중...'; }
      try {
        await window._fbAuth.createUserWithEmailAndPassword(email, pw);
        // 가입 성공 → onAuthStateChanged 가 extUsers 대기 등록 + '승인 대기' 화면 표시
      } catch (e) {
        if (msg) {
          msg.style.color = '#EF4444';
          var dup = (e.code === 'auth/email-already-in-use');
          msg.textContent = dup ? '이미 가입된 이메일입니다. 로그인하세요.' : ('가입 실패: ' + (e.message || e.code));
        }
      }
    };
    var pwIn = $('__ext_pw');
    if (pwIn) pwIn.addEventListener('keypress', function (e) { if (e.key === 'Enter') { var b = $('__ext_login_btn'); if (b) b.click(); } });
    var out = $('__ext_logout_btn');
    if (out) out.onclick = function () { try { window._fbAuth.signOut(); } catch (e) {} };
  }

  function start() {
    bindButtons();
    if (!window._fbAuth || !window._fbDb) { showLogin('Firebase 로드 실패 — 확장을 새로고침하세요.'); _resolveReady(false); return; }
    var firstResolved = false;
    window._fbAuth.onAuthStateChanged(async function (user) {
      if (!user) {
        setAuthFlag(false);
        showLogin('사용하려면 로그인하세요.');
        if (!firstResolved) { firstResolved = true; _resolveReady(false); }
        return;
      }
      // 로그인됨 → extUsers/{uid} 의 active 확인
      var active = false;
      try {
        var ref = window._fbDb.collection('extUsers').doc(user.uid);
        var doc = await ref.get();
        active = doc.exists && doc.data() && doc.data().active === true;
        if (!doc.exists) {
          // 신규 가입자 → '대기(active:false)' 로 등록해 관리자 목록에 표시
          await ref.set({
            email: user.email || '',
            active: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
      } catch (e) { console.warn('[Ext Gate] extUsers 조회 실패', e); }

      if (active) {
        window._extAuthOK = true;
        setAuthFlag(true, user);
        hideGate();
        if (!firstResolved) { firstResolved = true; _resolveReady(true); }
        else { window.location.reload(); }   // 로그인 직후 통과 → 기능 초기화 위해 새로고침
      } else {
        window._extAuthOK = false;
        setAuthFlag(false);
        showPending(user.email || '');
        if (!firstResolved) { firstResolved = true; _resolveReady(false); }
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
