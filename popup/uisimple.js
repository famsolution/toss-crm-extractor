// 🔠 쉬운 화면 켜기/끄기 — 큰 글씨·큰 버튼(popup-simple.css) ↔ 예전 화면
document.addEventListener('DOMContentLoaded', () => {
  const b = document.getElementById('uiSimpleBtn');
  if (!b) return;
  const root = document.documentElement;
  const paint = () => { b.textContent = root.classList.contains('ui-simple') ? '🔠 원래 화면' : '🔠 큰 글씨 화면'; };
  paint();
  b.addEventListener('click', () => {
    const on = !root.classList.contains('ui-simple');
    root.classList.toggle('ui-simple', on);
    try { localStorage.setItem('uiSimple', on ? '1' : '0'); } catch (e) {}
    paint();
  });
});
