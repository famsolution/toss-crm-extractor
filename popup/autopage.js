// ═══════════════════════════════════════════════════════════════════
// 🧭 페이지 따라가기 — 보고 있는 페이지가 바뀌면 확장 화면도 그 페이지에 맞게 바뀐다
//   · 토스 CRM 고객 상세 / 보장 / 보험료 비교 페이지 → 📋 현재 페이지 탭 + 그 페이지 안내
//   · 보험사 사이트                                   → 🔑 비번 탭 (그 보험사 계정이 위에)
//   · 토스 워크스페이스                               → 👤 고객 탭
//   · 그 밖의 페이지                                  → 탭은 그대로, 머리말 표시만 바꿈
//   · 이전 페이지에서 추출한 결과는 지운다(다른 고객 데이터를 잘못 보내지 않게).
//   · 추출은 자동으로 하지 않는다 — 추출이 토스 화면의 버튼(마스킹 해제 등)을 누르기 때문에
//     [📋 데이터 추출] 은 직접 누른다. 대신 그 버튼을 눈에 띄게 알려 준다.
//   · 같은 페이지 안에서 사용자가 직접 고른 탭은 바꾸지 않는다(주소가 바뀔 때만 자동 전환).
//   · 오른쪽 세로바·크게 보기 창에서 특히 쓸모 있다(팝업은 탭을 옮기면 닫히므로 열 때 한 번 맞춤).
//     고객관리 팝업 창(solo)에서는 아무것도 바꾸지 않는다.
// ═══════════════════════════════════════════════════════════════════
window.__autoPageOwnsBadge = true;
let _apLastKey = null;
let _apTimer = null;

function _apKind(url) {
  url = url || '';
  if (/crm\.tossinsu\.com\/crm-v2\/customers\//.test(url)) return 'toss-customer';
  if (/crm\.tossinsu\.com\/crm-v2\/cover\//.test(url)) return 'toss-cover';
  if (/crm\.tossinsu\.com/.test(url)) return 'toss';
  if (/ohmymanager\.com|premium_plan|premium-compare|tossinssu-pro\.vercel\.app\/plan\.html|한장으로|보험료%20비교|보험료비교/i.test(url)) return 'premium';
  if (/ympaint-86457\.(web\.app|firebaseapp\.com)/.test(url)) return 'workspace';
  return 'other';
}
function _apShowTab(name) {
  const t = document.querySelector(`.tab[data-tab="${name}"]`);
  if (t && !t.classList.contains('active')) t.click();
}
function _apFlash(el) {
  if (!el) return;
  el.classList.remove('ap-flash'); void el.offsetWidth; el.classList.add('ap-flash');
}
// 이전 페이지에서 뽑은 결과 지우기 + 이 페이지 안내
function _apResetResult(kind) {
  try { extractedData = null; } catch (e) {}
  try { showCopyButtons(false); } catch (e) {}
  try { syncTargetCompatibility(); } catch (e) {}   // 이전 데이터 기준으로 흐리게 한 대상 버튼을 되살림
  const pp = document.getElementById('productPickerSection'); if (pp) pp.style.display = 'none';
  const msg = {
    'toss-customer': ['👤', '고객 상세 페이지입니다', '[📋 데이터 추출] 을 누르면 이 고객의 정보를 읽습니다. 👤 고객 탭의 [📋 현재 페이지 고객 등록] 으로 바로 PC 에 저장할 수도 있습니다.'],
    'toss-cover': ['📊', '보장 페이지입니다', '[📋 데이터 추출] 로 보장 내용을 읽거나, [📊 보장분석 엑셀 다운로드] 를 누르세요. 형광펜·글자 수정은 토스 화면 오른쪽 위 🖍 버튼.'],
    'toss': ['🔍', '토스 CRM 입니다', '고객 상세 페이지나 보장 페이지를 열면 그에 맞는 기능이 나옵니다.'],
    'premium': ['💰', '보험료 비교 페이지입니다', '[📋 데이터 추출] 을 누르면 보험료 비교 내용을 읽습니다.'],
    'insurer': ['🔑', '보험사 사이트입니다', '🔑 비번 탭에서 이 보험사 계정을 확인하세요.'],
    'workspace': ['👤', '토스 워크스페이스입니다', '👤 고객 탭에서 고객을 골라 [📤 워크스페이스에 고객등록] 을 누르세요.'],
    'other': ['🔍', '토스인슈 CRM 페이지에서 데이터 추출 버튼을 클릭하세요', '상세 페이지 또는 보장 페이지에서 사용 가능합니다']
  }[kind];
  if (msg && typeof showNotice === 'function') showNotice(msg[0], msg[1], msg[2]);
}

async function _apActiveTab() {
  try {
    const w = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
    const t = w && w.tabs && w.tabs.find(x => x.active);
    if (t) return t;
  } catch (e) {}
  try { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t || null; } catch (e) { return null; }
}

async function apSync(first) {
  if (/[?&]solo=1\b/.test(location.search)) return;
  const tab = await _apActiveTab();
  if (!tab) return;
  const url = tab.url || '';
  if (/^chrome-extension:/.test(url)) return;            // 확장 자신의 창(크게 보기 등)은 무시
  let key = url;
  try { const u = new URL(url); key = u.origin + u.pathname; } catch (e) {}
  if (key === _apLastKey) return;                        // 같은 페이지 — 사용자가 고른 탭 유지
  const changed = _apLastKey !== null;
  _apLastKey = key;
  const kind = _apKind(url);
  try { updatePageBadge(url, true); } catch (e) {}
  const isInsurer = typeof credOnPageChange === 'function' ? credOnPageChange(tab) : false;
  try { arrangeTargets(kind); } catch (e) {}
  if (changed || kind !== 'other') _apResetResult(isInsurer ? 'insurer' : kind);
  const badge = document.getElementById('pageBadge');
  if (badge && isInsurer) badge.textContent = '보험사 사이트';
  else if (badge && kind === 'workspace') badge.textContent = '워크스페이스';
  // 탭 고르기 — 크게 보기 창을 특정 탭(?tab=cust 등)으로 연 직후에는 그 탭을 지킨다
  if (first && /[?&]tab=/.test(location.search)) return;
  // 탭 고르기
  if (isInsurer) _apShowTab('cred');
  else if (kind === 'workspace') _apShowTab('cust');
  else if (kind === 'toss-customer' || kind === 'toss-cover' || kind === 'toss' || kind === 'premium') {
    _apShowTab('current');
    if (kind !== 'toss') _apFlash(document.getElementById('btnExtract'));
  }
  if (changed) {
    const label = isInsurer ? '보험사 사이트(🔑 비번 탭)' : kind === 'workspace' ? '워크스페이스(👤 고객 탭)'
      : kind === 'toss-customer' ? '고객 상세 페이지' : kind === 'toss-cover' ? '보장 페이지' : kind === 'premium' ? '보험료 비교 페이지' : '';
    if (label && typeof showToast === 'function') showToast('🧭 ' + label + '에 맞췄습니다');
  }
}
function _apSoon() { clearTimeout(_apTimer); _apTimer = setTimeout(() => apSync(false), 250); }

try {
  chrome.tabs.onActivated.addListener(_apSoon);
  chrome.tabs.onUpdated.addListener((id, info, tab) => { if ((info.url || info.status === 'complete') && tab && tab.active) _apSoon(); });
  chrome.windows.onFocusChanged.addListener(w => { if (w !== chrome.windows.WINDOW_ID_NONE) _apSoon(); });
} catch (e) {}
document.addEventListener('DOMContentLoaded', () => { setTimeout(() => apSync(true), 150); });
