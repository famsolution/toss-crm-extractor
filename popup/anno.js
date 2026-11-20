// 🖍 토스 보장분석 화면 표시(content/annotate.js) 켜기/끄기 — 끄면 모든 토스 탭이 바로 원래 화면으로
document.addEventListener('DOMContentLoaded', () => {
  const c = document.getElementById('annoEnabledChk');
  if (!c) return;
  try { chrome.storage.local.get('anno_enabled', st => { c.checked = st.anno_enabled !== false; }); } catch (e) {}
  c.addEventListener('change', () => {
    try { chrome.storage.local.set({ anno_enabled: c.checked }); } catch (e) {}
    if (typeof showToast === 'function') showToast(c.checked ? '🖍 토스 화면 표시를 켰습니다' : '토스 화면 표시를 껐습니다 — 원래 화면');
  });
});
