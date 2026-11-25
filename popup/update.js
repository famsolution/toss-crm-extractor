// ═══════════════════════════════════════════════════════════════
// 🆕 업데이트 안내 띠 — 새 버전이 있으면 머리말 아래에 띄운다
//   ① update.bat 실행(설치 폴더에 최신 파일 덮어쓰기)  ② [적용] = 확장 다시 불러오기
//   update.bat 이 파일을 바꿨는지는 확장 폴더의 manifest.json 을 다시 읽어 알아낸다.
// ═══════════════════════════════════════════════════════════════
(function () {
  const cur = chrome.runtime.getManifest().version;
  const newer = (a, b) => {
    const x = String(a || '').split('.').map(n => parseInt(n, 10) || 0), y = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
    return false;
  };
  // 폴더에 이미 새 파일이 덮어써졌는지 (압축해제 설치일 때만 의미 있음)
  async function diskVersion() {
    try { const r = await fetch(chrome.runtime.getURL('manifest.json') + '?t=' + Date.now(), { cache: 'no-store' }); return String((await r.json()).version || ''); }
    catch (e) { return ''; }
  }
  function openGuide() {
    const url = chrome.runtime.getURL('update-guide.html');
    try { chrome.tabs.create({ url }); } catch (e) { window.open(url, '_blank'); }
  }
  // 팝업은 열 때마다 폴더의 새 파일로 뜨지만, 백그라운드는 예전 버전 그대로일 수 있다
  //   → 백그라운드에 부탁하지 않고 팝업에서 바로 다시 불러온다.
  function reload(btn) {
    if (btn) { btn.disabled = true; btn.textContent = '적용 중…'; }
    try { chrome.runtime.reload(); } catch (e) {}
    setTimeout(() => {    // 여기까지 왔으면 다시 불러오기가 안 된 것
      if (btn) { btn.disabled = false; btn.textContent = '적용'; }
      if (typeof showAlert === 'function') showAlert('자동 적용이 되지 않았습니다.\n\n주소창에 chrome://extensions 를 열고\n상담 도우미의 🔄 새로고침 버튼을 한 번 눌러 주세요.', '🆕 업데이트');
    }, 2500);
  }

  async function render(latest) {
    document.getElementById('updBar')?.remove();
    const disk = await diskVersion();
    const ready = disk && newer(disk, cur);                 // 파일은 바뀌었고 다시 불러오기만 남음
    if (!ready && !(latest && newer(latest, cur))) return;
    const st = await chrome.storage.local.get(['updSnooze']);
    if (!ready && st.updSnooze === latest) return;          // '나중에' 누른 버전은 다시 띄우지 않음
    const bar = document.createElement('div');
    bar.id = 'updBar'; bar.className = 'upd-bar' + (ready ? ' ready' : '');
    bar.innerHTML = ready
      ? `<span class="upd-ic">✅</span><span class="upd-tx"><b>v${disk}</b> 파일 준비 완료 — [적용] 을 누르면 바로 새 버전으로 바뀝니다</span>
         <button type="button" class="upd-go" data-u="reload">적용</button>`
      : `<span class="upd-ic">🆕</span><span class="upd-tx">새 버전 <b>v${latest}</b> 이 나왔습니다 <small>(지금 v${cur})</small></span>
         <button type="button" class="upd-go" data-u="guide">업데이트 방법</button>
         <button type="button" class="upd-go upd-sub" data-u="reload" title="update.bat 을 실행한 뒤 누르세요">적용</button>
         <button type="button" class="upd-x" data-u="later" title="이 버전은 다시 알리지 않기">✕</button>`;
    const hd = document.querySelector('.header');
    if (hd) hd.insertAdjacentElement('afterend', bar); else document.body.prepend(bar);
    bar.addEventListener('click', async e => {
      const b = e.target.closest('[data-u]'); if (!b) return;
      if (b.dataset.u === 'guide') openGuide();
      else if (b.dataset.u === 'reload') {
        const d = await diskVersion();
        if (d && newer(d, cur)) reload(b);
        else if (typeof showAlert === 'function') showAlert('아직 새 파일이 설치 폴더에 없습니다.\n\n확장 프로그램 폴더의 update.bat 을 먼저 실행한 뒤 [적용] 을 눌러 주세요.\n(자세한 방법: 업데이트 방법)', '🆕 업데이트');
      } else if (b.dataset.u === 'later') { await chrome.storage.local.set({ updSnooze: latest }); bar.remove(); }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const vb = document.getElementById('verBadge'); if (vb) vb.textContent = 'v' + cur;
    const st = await chrome.storage.local.get(['updLatest', 'updCheckedAt']);
    render(st.updLatest || '');
    if (!st.updCheckedAt || Date.now() - st.updCheckedAt > 30 * 60 * 1000) {     // 30분 넘었으면 지금 다시 확인
      chrome.runtime.sendMessage({ action: 'updCheckNow' }, r => { void chrome.runtime.lastError; if (r && r.latest) render(r.latest); });
    }
    const vbtn = document.getElementById('verBadge');
    if (vbtn) vbtn.addEventListener('click', () => {
      vbtn.textContent = '확인 중…';
      chrome.runtime.sendMessage({ action: 'updCheckNow' }, r => {
        void chrome.runtime.lastError;
        vbtn.textContent = 'v' + cur;
        if (r && r.latest) { render(r.latest); if (!r.has && typeof showToast === 'function') showToast('✅ 최신 버전입니다 (v' + cur + ')'); }
        else if (typeof showToast === 'function') showToast('업데이트 확인 실패 — 인터넷 연결을 확인하세요');
      });
    });
  });
})();
