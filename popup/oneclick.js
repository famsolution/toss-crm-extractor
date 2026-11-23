// ═══════════════════════════════════════════════════════════════════
// 👆 한 번에 적용 — 📋 현재 페이지 탭의 전송 대상 버튼을 누르면 바로 [추출 → 그곳으로 적용]
//   예전: 대상 고르기 → [📋 데이터 추출] → [📤 프로그램 적용] 3번
//   지금: 대상 버튼 1번 (그 버튼이 곧 실행 버튼). [📋 데이터 추출] 은 내용만 볼 때 그대로 쓴다.
//   · 실제 보내기는 기존 [📤 프로그램 적용] 처리(apply.js)를 그대로 부른다 — 보내는 방식은 같다.
//   · 누를 때마다 지금 페이지를 새로 추출한다(다른 고객의 이전 데이터를 보내지 않게).
//   · 👤 고객 등록(PC · 워크스페이스 · 함께) 버튼도 이 탭에 — 고객 탭과 같은 동작.
// ═══════════════════════════════════════════════════════════════════
let _ocBusy = false;

// 지금 페이지에 해당되는 보낼 곳을 앞에 꺼내 놓고, 나머지는 '다른 곳으로 보내기' 안에 둔다
const OC_RELEVANT = {
  'toss-customer': ['consult', 'standard', 'premium-page'],
  'toss-cover': ['standard', 'paintpro', 'absence', 'consult'],
  'premium': ['plan', 'premium-page']
};
const OC_ORDER = ['consult', 'standard', 'plan', 'premium-page', 'paintpro', 'absence'];
function arrangeTargets(kind) {
  const quick = document.getElementById('sendQuick'), list = document.getElementById('sendMoreList');
  const more = document.getElementById('sendMore'), sum = document.getElementById('sendMoreSum');
  if (!quick || !list) return;
  const want = OC_RELEVANT[kind] || [];
  OC_ORDER.forEach(v => {
    const inp = document.querySelector(`input[name="targetMode"][value="${v}"]`);
    const lab = inp && document.querySelector(`label.tm-btn[for="${inp.id}"]`);
    if (lab) (want.includes(v) ? quick : list).appendChild(lab);
  });
  // 위에 꺼낸 순서를 OC_RELEVANT 순서대로
  want.forEach(v => { const inp = document.querySelector(`input[name="targetMode"][value="${v}"]`); const lab = inp && quick.querySelector(`label[for="${inp.id}"]`); if (lab) quick.appendChild(lab); });
  quick.style.display = want.length ? '' : 'none';
  if (more) more.style.display = list.children.length ? '' : 'none';
  if (sum) sum.textContent = want.length ? '다른 곳으로 보내기' : '보낼 곳 고르기';
  if (more && !want.length) more.open = true;            // 해당되는 곳이 없는 페이지면 전부 펼쳐 보임
}

async function oneClickApply(mode, label) {
  if (_ocBusy) return;
  _ocBusy = true;
  const orig = label ? label.innerHTML : '';
  try {
    if (label) { label.classList.add('oc-run'); label.innerHTML = '⏳ ' + label.textContent.trim(); }
    const data = await runExtract();
    if (!data || data.type === 'error') return;        // 추출 실패 안내는 runExtract 가 띄움
    const r = document.querySelector(`input[name="targetMode"][value="${mode}"]`);
    if (r && !r.checked) { r.disabled = false; r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
    document.getElementById('btnApply').click();       // apply.js 의 기존 적용 흐름
  } finally {
    if (label) { label.innerHTML = orig; label.classList.remove('oc-run'); }
    setTimeout(() => { _ocBusy = false; }, 800);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // 전송 대상 버튼 = 실행 버튼
  document.querySelectorAll('label.tm-btn[for]').forEach(label => {
    label.addEventListener('click', e => {
      const inp = document.getElementById(label.getAttribute('for'));
      if (!inp) return;
      e.preventDefault();                                // 라디오 선택은 oneClickApply 가 직접
      // (이전 추출 기준으로 꺼져 있어도 누를 수 있게 — 새로 추출한 뒤 apply.js 가 맞는지 다시 확인함)
      oneClickApply(inp.value, label);
    });
    label.title = (label.title ? label.title + ' — ' : '') + '누르면 바로 추출해서 적용합니다';
  });
  // '다른 곳으로 보내기' 펼침 상태 기억
  const more = document.getElementById('sendMore');
  if (more) {
    try { more.open = localStorage.getItem('sendMoreOpen') === '1'; } catch (e) {}
    more.addEventListener('toggle', () => { try { localStorage.setItem('sendMoreOpen', more.open ? '1' : '0'); } catch (e) {} });
  }
  const hint = document.getElementById('targetModeHint');
  if (hint) hint.textContent = '';
  // 👤 고객 등록 (고객 탭과 같은 세 가지)
  const go = async (mode) => {
    if (typeof cuRegisterFromPage !== 'function') return;
    await cuRegisterFromPage(mode);
    if (mode !== 'ws' && typeof cuStore !== 'undefined') {           // 저장했으면 건강상태 입력하러 고객 탭으로
      const t = document.querySelector('.tab[data-tab="cust"]'); if (t && vaultIsUnlocked()) t.click();
    }
  };
  document.getElementById('ocRegPc')?.addEventListener('click', () => go('pc'));
  document.getElementById('ocRegWs')?.addEventListener('click', () => go('ws'));
  document.getElementById('ocRegBoth')?.addEventListener('click', () => go('both'));
});
