// ═══════════════════════════════════════════════════════════════════
// 💻 다른 PC 에서 쓰기 — 버튼 하나로 여는 안내 창
//   ① 확장 설치 파일 받기 : GitHub 'latest' 릴리스 zip (push 할 때마다 자동으로 새 버전)
//   ② 금고 백업 내보내기  : 보험사 비번·고객정보를 '암호화된 그대로' 파일 1개로 저장
//   ③ 금고 백업 가져오기  : 다른 PC 에서 그 파일을 넣고 원래 PIN 으로 연다
//   PIN 은 파일에 들어가지 않는다 — 파일만으로는 내용을 볼 수 없다.
// ═══════════════════════════════════════════════════════════════════
const PC_MOVE_ZIP_URL = 'https://github.com/famsolution/toss-crm-extractor/releases/latest/download/sangdam-helper.zip';

function _pmEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function pcMoveOpen() {
  document.getElementById('pcMoveBack')?.remove();
  let ver = '';
  try { ver = chrome.runtime.getManifest().version; } catch (e) {}
  const back = document.createElement('div');
  back.id = 'pcMoveBack';
  back.className = 'pm-back';
  back.innerHTML = `
    <div class="pm-box" role="dialog" aria-modal="true">
      <div class="pm-hd"><b>💻 다른 PC 에서 쓰기</b><span class="cred-sp"></span><button class="cred-ic pm-x" title="닫기">✕</button></div>

      <div class="pm-step">
        <div class="pm-t">① 다른 PC 에 확장 프로그램 설치</div>
        <div class="pm-s">지금 이 PC 버전: <b>v${_pmEsc(ver)}</b></div>
        <button class="btn-primary pm-zip">⬇ 설치 파일(zip) 받기</button>
        <button class="cred-copy pm-copy">설치 링크 복사</button>
        <ol class="pm-ol">
          <li>다른 PC 에서 위 링크로 zip 을 받아 <b>압축을 풉니다</b>.</li>
          <li>크롬 주소창에 <code>chrome://extensions</code> → 오른쪽 위 <b>개발자 모드</b> 켜기.</li>
          <li><b>압축해제된 확장 프로그램을 로드합니다</b> → 푼 폴더 선택.</li>
          <li>확장 아이콘 → 같은 이메일로 로그인(관리자 승인 계정).</li>
        </ol>
      </div>

      <div class="pm-step pm-sf">
        <div class="pm-t">📁 원드라이브·구글드라이브 폴더로 자동 동기화 <span class="pm-rec">추천</span></div>
        <div class="pm-s">보험사 비번·고객정보(건강정보 포함)를 고른 폴더에 <b>PIN 으로 암호화된 파일 1개</b>로 둡니다.
          원드라이브/구글드라이브 PC 프로그램이 동기화하는 폴더(예: <code>OneDrive\상담도우미</code>)를 고르세요.
          다른 PC 에서도 같은 폴더를 연결하면 어느 PC 에서 고쳐도 서로 반영됩니다(같은 PIN 사용).
          바뀔 때마다 <b>백업</b> 폴더에 단계별로 남깁니다 — 최근 20개 · 하루 1개(30일) · 한 달 1개(12개월).</div>
        <div class="sf-status"></div>
        <div class="pm-btns">
          <button class="btn-primary" data-sf="connect">📁 폴더 연결 / 바꾸기</button>
          <button class="btn-secondary sf-reperm" data-sf="reperm" style="display:none">📁 다시 허용</button>
          <button class="btn-secondary sf-need-conn" data-sf="sync">🔄 지금 동기화</button>
          <button class="btn-secondary sf-need-conn" data-sf="restore">↩ 백업에서 되돌리기</button>
          <button class="cred-link sf-need-conn" data-sf="off">연결 끊기</button>
        </div>
      </div>

      <div class="pm-step">
        <div class="pm-t">② 이 PC 의 보험사 비번·고객정보 내보내기 (파일 1개로 직접 옮길 때)</div>
        <div class="pm-s">암호화된 그대로 파일 1개로 저장합니다. <b>PIN 은 파일에 들어가지 않아</b> 파일만으로는 열 수 없습니다.</div>
        <button class="btn-secondary pm-export">📦 금고 백업 파일 저장</button>
        <div class="pm-msg pm-export-msg"></div>
      </div>

      <div class="pm-step">
        <div class="pm-t">③ 다른 PC 에서 가져오기</div>
        <div class="pm-s">다른 PC 의 확장 팝업 → 🔑 비번 또는 👤 고객 탭 → <b>'💻 다른 PC 의 금고 백업 가져오기'</b> 또는 아래 버튼 → 백업 파일 선택 → <b>원래 PIN</b> 입력.</div>
        <button class="btn-secondary pm-import">📥 금고 백업 파일 가져오기</button>
        <div class="pm-warn">가져오면 그 PC 에 있던 금고 내용은 백업 파일 내용으로 <b>바뀝니다</b>.</div>
      </div>
    </div>`;
  document.body.appendChild(back);
  if (typeof sfRenderStatus === 'function') sfRenderStatus();
  const close = () => back.remove();
  back.querySelector('.pm-x').addEventListener('click', close);
  back.addEventListener('click', e => { if (e.target === back) close(); });
  back.querySelector('.pm-zip').addEventListener('click', () => { try { chrome.tabs.create({ url: PC_MOVE_ZIP_URL }); } catch (e) { window.open(PC_MOVE_ZIP_URL, '_blank'); } });
  back.querySelector('.pm-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(PC_MOVE_ZIP_URL); showToast('🔗 설치 링크 복사됨 — 카톡·메일로 다른 PC 에 보내세요'); }
    catch (e) { await showAlert(PC_MOVE_ZIP_URL, '설치 링크'); }
  });
  back.querySelector('.pm-export').addEventListener('click', () => pcMoveExport(back.querySelector('.pm-export-msg')));
  back.querySelector('.pm-import').addEventListener('click', pcMoveImport);
}

async function pcMoveExport(msgEl) {
  let obj;
  try { obj = await vaultExportFile(); }
  catch (e) {
    if (!vaultIsUnlocked()) { await showAlert('금고가 잠겨 있습니다. 🔑 비번 탭에서 PIN 으로 연 뒤 다시 눌러 주세요.'); return; }
    await showAlert('내보내기 실패: ' + (e.message || e)); return;
  }
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const name = `상담도우미_금고백업_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  const c = obj.counts || {};
  if (msgEl) msgEl.textContent = `✔ ${name} — 보험사 비번 ${c.creds || 0}개 · 고객 ${c.customers || 0}명 (다운로드 폴더)`;
  showToast('📦 금고 백업 파일을 저장했습니다');
}

function pcMoveImport() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.addEventListener('change', async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    let obj;
    try { obj = vaultParseFile(JSON.parse(await f.text())); }
    catch (e) { await showAlert(e.message || '파일을 읽지 못했습니다.'); return; }
    const c = obj.counts || {};
    const had = await vaultIsSetUp();
    const ok = await showConfirm(
      `백업 파일: ${f.name}\n보험사 비번 ${c.creds ?? '?'}개 · 고객 ${c.customers ?? '?'}명 · ${obj.exportedAt ? new Date(obj.exportedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : ''}\n\n` +
      (had ? '⚠ 이 PC 에 있던 금고 내용은 백업 파일 내용으로 바뀝니다.\n' : '') +
      '가져온 뒤에는 백업한 PC 의 PIN 으로 엽니다. 계속할까요?', '금고 백업 가져오기');
    if (!ok) return;
    try { await vaultImportFile(obj); }
    catch (e) { await showAlert('가져오기 실패: ' + (e.message || e)); return; }
    document.getElementById('pcMoveBack')?.remove();
    document.querySelectorAll('.vault-gate').forEach(g => g.remove());
    ['tab-cred', 'tab-cust'].forEach(id => vaultRenderGate(document.getElementById(id)));
    const t = document.querySelector('.tab[data-tab="cred"]'); if (t) t.click();
    showToast('📥 가져왔습니다 — 원래 PIN 으로 여세요');
  });
  inp.click();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.pc-move-btn').forEach(b => b.addEventListener('click', pcMoveOpen));
});
