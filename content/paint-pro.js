// ═══════════════════════════════════════════════════════════════════
// 🆕 토스 보장분석 → 페인트프로(editor.html) 이미지 전송
//   토스 페이지: '이미지 복사'(클립보드) 자동 클릭 → 클립보드 읽기 → storage 저장 → 새 탭 editor 열기
//   editor 페이지: storage 의 이미지를 sessionStorage 로 넘기고 editor 의 로더를 트리거
// ═══════════════════════════════════════════════════════════════════
(function () {
  // 재주입되면 setInterval 이 겹쳐 돌고 버튼이 두 번 붙으므로 한 번만 실행한다.
  if (window.__tossCrmPaintProBound) return;
  window.__tossCrmPaintProBound = true;

  const EDITOR_URL = 'https://tossinssu-pro.vercel.app/editor.html';
  const STORAGE_KEY = '__paintProImg_v1';
  const host = location.hostname;

  // ───────── editor(vercel) 페이지: 전달된 이미지를 받아 캔버스에 주입 ─────────
  if (/tossinssu-pro\.vercel\.app$/.test(host) && /editor\.html/i.test(location.pathname)) {
    try {
      chrome.storage.local.get([STORAGE_KEY], function (d) {
        const payload = d && d[STORAGE_KEY];
        if (!payload || !payload.dataURL) return;
        try {
          sessionStorage.setItem('toss_analysis_image', payload.dataURL);
          sessionStorage.setItem('toss_analysis_filename', payload.fileName || '토스보장분석.png');
        } catch (e) {}
        const trigger = function () { try { window.postMessage({ __paintProLoad: true }, '*'); } catch (e) {} };
        trigger(); setTimeout(trigger, 400); setTimeout(trigger, 1200); setTimeout(trigger, 2500);
        try { chrome.storage.local.remove(STORAGE_KEY); } catch (e) {}
      });
    } catch (e) {}
    return;
  }

  // ───────── vercel 메인 앱(app.html 등): storage 의 적용 대기 데이터를 페이지로 중개 ─────────
  //   확장 popup 이 chrome.storage.local['__tossPendingApply'] 에 저장 → 앱이 로그인/렌더 완료돼
  //   receiver(__applyTossDataFromExtension)가 준비되는 순간 적용 (탭 열림/로그인 타이밍 무관).
  if (/tossinssu-pro\.vercel\.app$/.test(host)) {
    (function () {
      const PKEY = '__tossPendingApply';
      let done = false, iv = null;
      const stop = function () { done = true; if (iv) { clearInterval(iv); iv = null; } };
      // 앱이 적용 완료를 알리면 storage 삭제 후 중단
      window.addEventListener('message', function (e) {
        if (e && e.data && e.data.__tossApplyDone) { try { chrome.storage.local.remove(PKEY); } catch (x) {} stop(); }
      });
      const tick = function () {
        if (done) return;
        try {
          chrome.storage.local.get([PKEY], function (d) {
            const p = d && d[PKEY];
            if (!p || !p.text) return;
            // receiver 가 준비됐든 아니든 계속 보냄 — 준비되면 페이지가 수신해 적용 후 __tossApplyDone 응답
            try { window.postMessage({ __tossApply: p.text, __ts: p.ts }, '*'); } catch (x) {}
          });
        } catch (x) {}
      };
      tick();
      iv = setInterval(tick, 1000);
      setTimeout(stop, 90000);   // 90초 후 중단
    })();
    return;
  }

  // ───────── 토스 보장분석 페이지: 전송 버튼 추가 ─────────
  // 🆕 토스 CRM(보장분석) 도메인이 아니면 전송 버튼을 절대 설치하지 않음
  //    (vercel 제안서의 '표', mmlfcp 등 다른 사이트에서 잘못 뜨던 문제 차단)
  if (!/(^|\.)tossinsu\.com$/i.test(host)) return;
  const findCopyBtn = function () {
    return Array.from(document.querySelectorAll('button')).find(function (b) { return (b.textContent || '').trim() === '이미지 복사'; });
  };
  const findTableTab = function () {
    return Array.from(document.querySelectorAll('button, [role=tab]')).find(function (b) { return (b.textContent || '').trim() === '표'; });
  };
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const blobToDataURL = function (blob) { return new Promise(function (res, rej) { const fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(blob); }); };

  // ── 클립보드 가로채기: 토스가 이미지를 클립보드에 쓰는 순간 그 dataURL 을 받는다 ──
  //   (clipboard.read 와 달리 포커스가 필요 없어 팝업 실행에서도 동작)
  let _capturedImageURL = null, _capturedAt = 0;
  (function injectClipInterceptor() {
    try {
      window.addEventListener('message', function (ev) {
        if (ev.source === window && ev.data && ev.data.__tossImageCaptured && ev.data.dataURL) {
          _capturedImageURL = ev.data.dataURL; _capturedAt = Date.now();
        }
      });
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('pcs-clip-intercept.js');
      s.onload = function () { s.remove(); };
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  })();

  let _lastClipErr = '';
  async function readClipboardImage() {
    try {
      // navigator.clipboard.read() 는 문서가 포커스 상태여야 동작한다.
      // 팝업에서 실행되면 페이지가 포커스를 잃어 "Document is not focused" 로 실패하므로
      // 먼저 창/문서에 포커스를 준다.
      if (!document.hasFocus()) {
        try { window.focus(); } catch (_) {}
        try { document.body && document.body.focus && document.body.focus(); } catch (_) {}
        await sleep(60);
      }
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const t = it.types.find(function (x) { return x.startsWith('image/'); });
        if (t) { const blob = await it.getType(t); return await blobToDataURL(blob); }
      }
      _lastClipErr = '클립보드에 이미지가 없습니다.';
    } catch (e) {
      _lastClipErr = (e && e.message) || String(e);
    }
    return null;
  }

  // 🆕 보장분석 요약(고객명/나이/성별/상령일/보험개수/월납합계/잔여합계)을 토스 인슈어런스 스튜디오로 전송
  const STUDIO_URL = 'https://toss-insurance-studio.web.app';
  async function sendToStudio(btn) {
    const old = btn.textContent; btn.textContent = '⏳ 추출 중…'; btn.disabled = true;
    try {
      const match = location.pathname.match(/\/cover\/(\d+)/);
      const custId = match ? match[1] : '';
      let basic = {};
      try { basic = (await extractCustomerBasicInfo(custId)) || {}; } catch (e) {}
      let insurances = [];
      try { insurances = extractInsuranceData() || []; } catch (e) {}
      const _num = function (v) { return parseInt(String(v == null ? '' : v).replace(/[^\d]/g, ''), 10) || 0; };
      const monthSum = insurances.reduce(function (s, i) { return s + _num(i['월납보험료']); }, 0);
      const remainSum = insurances.reduce(function (s, i) { return s + _num(i['잔여보험료']); }, 0);
      // 🆕 가입 보험 내역 → setPolicyList 형식으로 변환
      //   {name, premium, pay, expiry, renew}
      //   - name   : 보험명
      //   - premium: 월납보험료 (숫자, 원 단위)
      //   - pay    : 납입 여부 (납입중/납입종료/… 등 원문)
      //   - expiry : 보장만기/만기연령 (원문)
      //   - renew  : 갱신 유무 (원문)
      const policyList = insurances.map(function (ins) {
        return {
          name: ins['보험명'] || ins['보험사명'] || '',
          company: ins['보험사명'] || '',
          premium: _num(ins['월납보험료']),
          pay: ins['납입 여부'] || ins['납입여부'] || '',
          expiry: ins['보장만기/만기연령'] || ins['보장만기'] || '',
          renew: ins['갱신 유무'] || ins['갱신유무'] || ''
        };
      });
      const payload = {
        고객명: basic.고객명 || '',
        나이: basic.보험나이 || '',
        성별: basic.성별 || '',
        상령일: basic.상령일 || '',
        보험개수: insurances.length,
        월납합계: monthSum,
        잔여합계: remainSum,
        policyList: policyList,
        추출시각: new Date().toISOString()
      };
      if (!payload.고객명 && insurances.length === 0) {
        pageAlert('추출할 보장분석 데이터를 찾지 못했습니다.\n토스 보장분석(보장내역) 페이지에서 사용해 주세요.');
        return;
      }
      const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      const studioTab = window.open(STUDIO_URL + '/#studio=' + b64, '_blank');
      // 🆕 스튜디오 탭이 로드된 후 setPolicyList 호출 — postMessage 로 전달
      //   스튜디오가 window.addEventListener('message'...) 로 받아서 setPolicyList(data.policyList) 실행
      if (studioTab) {
        var _tries = 0;
        var _iv = setInterval(function () {
          _tries++;
          try {
            studioTab.postMessage({ __studioInit: true, policyList: policyList, payload: payload }, '*');
          } catch (e) {}
          if (_tries >= 10) clearInterval(_iv);
        }, 800);
      }
    } catch (e) {
      pageAlert('스튜디오 전송 실패: ' + (e.message || e));
    } finally { btn.textContent = old; btn.disabled = false; }
  }

  // ───────── 페이지 내 알림/확인 다이얼로그 (alert/confirm 대체) ─────────
  //   content script 는 popup 의 showAlert/showConfirm 을 쓸 수 없으므로 페이지에 직접 띄운다.
  //   토스 페이지 CSS 가 섞이지 않도록 Shadow DOM 안에 그린다.
  //     · pageAlert(msg, title)   → Promise<void>    (확인 1개)
  //     · pageConfirm(msg, title) → Promise<boolean> (확인/취소)
  const _DLG_CSS = `
    .back { position: fixed; inset: 0; background: rgba(15,23,42,.45);
            display: flex; align-items: center; justify-content: center; padding: 24px; }
    .box  { max-width: 420px; width: 100%; background: #fff; border-radius: 12px;
            box-shadow: 0 12px 40px rgba(15,23,42,.3); padding: 18px 18px 14px;
            font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif; }
    .t    { margin: 0 0 8px; font-size: 14px; font-weight: 700; color: #0F172A; }
    .m    { margin: 0 0 16px; font-size: 13px; line-height: 1.6; color: #475569;
            white-space: pre-wrap; word-break: break-word; max-height: 50vh; overflow-y: auto; }
    .a    { display: flex; justify-content: flex-end; gap: 6px; }
    button { min-width: 68px; padding: 8px 14px; border-radius: 8px; font-size: 13px;
             font-weight: 600; cursor: pointer; border: 1px solid transparent; }
    .o    { background: #2563EB; color: #fff; }
    .c    { background: #fff; color: #475569; border-color: #CBD5E1; }`;

  function _pageDialog(message, title, withCancel) {
    return new Promise(function (resolve) {
      const hostEl = document.createElement('div');
      hostEl.style.cssText = 'position:fixed; inset:0; z-index:2147483647;';
      const root = hostEl.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = _DLG_CSS;
      root.appendChild(style);
      const back = document.createElement('div'); back.className = 'back';
      const box  = document.createElement('div'); box.className  = 'box';
      const t    = document.createElement('p');   t.className    = 't';
      const m    = document.createElement('p');   m.className    = 'm';
      const acts = document.createElement('div'); acts.className = 'a';
      const ok   = document.createElement('button'); ok.className = 'o'; ok.textContent = '확인';
      t.textContent = title || (withCancel ? '확인' : '알림');
      m.textContent = String(message == null ? '' : message);
      const finish = function (v) { try { hostEl.remove(); } catch (e) {} resolve(v); };
      ok.addEventListener('click', function () { finish(true); });
      if (withCancel) {
        const cancel = document.createElement('button');
        cancel.className = 'c'; cancel.textContent = '취소';
        cancel.addEventListener('click', function () { finish(false); });
        acts.appendChild(cancel);
      }
      acts.appendChild(ok);
      box.appendChild(t); box.appendChild(m); box.appendChild(acts);
      back.appendChild(box); root.appendChild(back);
      document.body.appendChild(hostEl);
      ok.focus();
    });
  }
  function pageAlert(message, title)   { return _pageDialog(message, title, false); }
  function pageConfirm(message, title) { return _pageDialog(message, title, true); }

  async function sendToPaintPro(fab) {
    const old = fab.textContent;
    fab.textContent = '⏳ 이미지 준비 중…'; fab.disabled = true;
    try {
      // 1) '이미지 복사' 버튼이 안 보이면 → '표' 탭을 먼저 눌러 표 화면을 띄운다
      let btn = findCopyBtn();
      if (!btn) {
        const tab = findTableTab();
        if (tab) { tab.click(); for (let i = 0; i < 12 && !btn; i++) { await sleep(250); btn = findCopyBtn(); } }
      }
      if (!btn) { pageAlert('표 탭 또는 "이미지 복사" 버튼을 찾지 못했습니다.\n토스 보장분석 페이지에서 사용해 주세요.'); return; }

      // 2) 가로채기 리셋 후 토스 '이미지 복사' 클릭 → 토스가 clipboard.write 하는 순간
      //    가로채기 스크립트가 dataURL 을 postMessage 로 보내준다(포커스 불필요).
      _capturedImageURL = null;
      const clickedAt = Date.now();
      btn.click();

      // 3) 가로챈 이미지를 우선 대기(최대 ~3.5초). 실패 시 클립보드 읽기로 폴백.
      let dataURL = null;
      for (let i = 0; i < 20 && !dataURL; i++) {
        await sleep(180);
        if (_capturedImageURL && _capturedAt >= clickedAt) { dataURL = _capturedImageURL; break; }
      }
      if (!dataURL) {   // 폴백: 클립보드 직접 읽기(포커스 있을 때만 성공)
        for (let i = 0; i < 8 && !dataURL; i++) { await sleep(180); dataURL = await readClipboardImage(); }
      }
      if (!dataURL) {
        pageAlert('이미지를 읽지 못했습니다.\n\n· 토스 "이미지 복사" 버튼이 정상 동작하는지 확인해 주세요.\n· 확장 새로고침 후 다시 시도해 보세요.' +
          (_lastClipErr ? '\n\n[오류: ' + _lastClipErr + ']' : ''));
        return;
      }
      await new Promise(function (r) { chrome.storage.local.set({ [STORAGE_KEY]: { dataURL: dataURL, fileName: '토스보장분석.png', ts: Date.now() } }, r); });
      window.open(EDITOR_URL, '_blank');
    } finally { fab.textContent = old; fab.disabled = false; }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  🩺 실손보험 세대 분석 → 매니저 코멘트 자동 입력
  //   계약일(가입시점) 기준으로 실손 세대 + 재가입(전환) 시점을 판정한다.
  //   가입시점 경계:
  //     1세대       : ~2009.09           재가입 없음 → 계속 유지
  //     2세대 초기  : 2009.10 ~ 2013.03  재가입 없음 → 계속 유지
  //     2세대 후기  : 2013.04 ~ 2017.03  15년 주기 → 계약연도+15
  //     3세대       : 2017.04 ~ 2021.06  15년 주기 → 계약연도+15
  //     4세대       : 2021.07 ~ 현재     5년 주기  → 계약연도+5
  //   예) 2013 계약(2세대후기) → "2세대, 28년전환예정"
  //       2012 계약(2세대초기) → "2세대, 계속 유지"
  // ═══════════════════════════════════════════════════════════════════════
  function analyzeSilsonGeneration(contractDate) {
    const s = String(contractDate || '');
    const m = s.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})/) || s.match(/(\d{4})(\d{2})\d{2}/);
    if (!m) return null;
    const y = parseInt(m[1], 10), mo = parseInt(m[2], 10);
    if (!y || y < 1990 || y > 2100 || mo < 1 || mo > 12) return null;
    const ym = y * 12 + mo;
    const YY = (yr) => String(yr).slice(-2);   // 2028 → "28"
    if (ym <= 2009 * 12 + 9) return { gen: '1세대', renew: '계속 유지', year: y };
    if (ym <= 2013 * 12 + 3) return { gen: '2세대', renew: '계속 유지', year: y };
    if (ym <= 2017 * 12 + 3) return { gen: '2세대', renew: YY(y + 15) + '년전환예정', year: y };
    if (ym <= 2021 * 12 + 6) return { gen: '3세대', renew: YY(y + 15) + '년전환예정', year: y };
    return { gen: '4세대', renew: YY(y + 5) + '년전환예정', year: y };
  }

  function _silsonText(el) {
    if (!el) return '';
    const input = el.querySelector && el.querySelector('input[type="text"], textarea');
    if (input && (input.value || '').trim()) return input.value.trim();
    const title = el.getAttribute && (el.getAttribute('title') || '');
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    return text || title || '';
  }

  function _silsonNorm(s) {
    return String(s || '')
      .replace(/\[[^\]]*\]|\([^\)]*\)/g, '')
      .replace(/[↔→←▲▼△▽▴▾+\-–—_·ㆍ\[\]{}()]/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  function _silsonLooksSameProduct(a, b) {
    const x = _silsonNorm(a), y = _silsonNorm(b);
    if (!x || !y) return false;
    return x === y || x.includes(y) || y.includes(x);
  }

  function _silsonHasAmount(v) {
    const s = String(v || '').replace(/\s+/g, '');
    if (!s || s === '-' || s === '–') return false;
    if (!/\d/.test(s)) return false;
    return /(\d[\d,]*)(만원|원)?/.test(s);
  }

  // 보장분석 상단 가입보험 표를 컬럼(보험상품)별로 스캔 → 계약일/코멘트 셀 확보
  function _silsonScanColumns() {
    let tbody = document.querySelector('tbody[data-tds-desktop-table-body]');
    if (!tbody) { const c = document.querySelector('td.insurance-table-cell'); if (c) tbody = c.closest('tbody'); }
    const trRows = tbody ? tbody.querySelectorAll('tr') : document.querySelectorAll('tr');
    const WANT = ['보험명', '보험사명', '계약일', '매니저 코멘트', '매니저 의견', '대분류', '소분류'];
    const byHeader = {};
    let refTable = null;
    trRows.forEach(tr => {
      const th = tr.querySelector('th'); if (!th) return;
      const headerEl = th.querySelector('[data-tds-desktop-table-h-cell-children-container]') || th;
      let header = (headerEl.innerText || '').trim().split('\n')[0].trim();
      header = ROW_HEADER_ALIAS[header] || header;
      if (WANT.indexOf(header) < 0) return;
      const pt = tr.closest('table'); if (!refTable) refTable = pt; if (pt !== refTable) return;
      const cells = tr.querySelectorAll('td.insurance-table-cell, td[aria-label]');
      const use = cells.length ? cells : tr.querySelectorAll('td');
      byHeader[header] = byHeader[header] || [];
      use.forEach((cell, i) => { byHeader[header][i] = cell; });
    });
    const n = Math.max(0, ...WANT.map(h => (byHeader[h] || []).length));
    const cols = [];
    for (let i = 0; i < n; i++) {
      cols.push({
        idx: i,
        보험명: _silsonText(byHeader['보험명'] && byHeader['보험명'][i]),
        보험사명: _silsonText(byHeader['보험사명'] && byHeader['보험사명'][i]),
        계약일: _silsonText(byHeader['계약일'] && byHeader['계약일'][i]),
        대분류: _silsonText(byHeader['대분류'] && byHeader['대분류'][i]),
        소분류: _silsonText(byHeader['소분류'] && byHeader['소분류'][i]),
        commentCell: (byHeader['매니저 코멘트'] && byHeader['매니저 코멘트'][i])
          || (byHeader['매니저 의견'] && byHeader['매니저 의견'][i]) || null,
      });
    }
    return cols;
  }

  // 카테고리별 보장 정보 표에서 대분류 "실비" 아래 상품별 담보금 유무를 스캔한다.
  // 상단 보험명에 "실손/실비"가 없어도 이 표의 상품 컬럼에 금액이 있으면 실손 후보로 본다.
  function _silsonScanCategoryAmounts() {
    const hits = [];
    const tables = Array.from(document.querySelectorAll('table')).filter(_isElementVisible);
    tables.forEach(table => {
      const allRows = Array.from(table.querySelectorAll('tr'));
      if (!allRows.length) return;

      let headerRow = null, headerTexts = [];
      for (const tr of allRows) {
        const cells = Array.from(tr.querySelectorAll('th,td'));
        const texts = cells.map(_silsonText);
        const joined = texts.join('|');
        if (/대분류/.test(joined) && /소분류/.test(joined) && /보험명/.test(joined)) {
          headerRow = tr;
          headerTexts = texts;
          break;
        }
      }
      if (!headerRow) return;

      const majorIdx = headerTexts.findIndex(t => /대분류/.test(t));
      const minorIdx = headerTexts.findIndex(t => /소분류/.test(t));
      const baseIdx = headerTexts.findIndex(t => /보험명/.test(t));
      if (majorIdx < 0 || minorIdx < 0 || baseIdx < 0) return;
      const productCols = headerTexts
        .map((label, idx) => ({ label: String(label || '').replace(/\s+/g, ' ').trim(), idx }))
        .filter(c => c.idx > baseIdx && c.label);
      if (!productCols.length) return;
      const visualWidth = Math.max(baseIdx, ...productCols.map(c => c.idx)) + 1;

      const bodyRows = allRows.slice(allRows.indexOf(headerRow) + 1);
      let currentMajor = '';
      bodyRows.forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('td,th'));
        if (!cells.length) return;

        const shiftedByRowSpan = currentMajor && cells.length < visualWidth;
        const getCell = (visualIdx) => shiftedByRowSpan ? cells[visualIdx - 1] : cells[visualIdx];
        const majorCell = getCell(majorIdx);
        const rawMajor = _silsonText(majorCell);
        if (rawMajor) currentMajor = rawMajor;
        const major = rawMajor || currentMajor;
        if (!/(실비|실손)/.test(major)) return;

        const minor = _silsonText(getCell(minorIdx));
        productCols.forEach((pc, productIndex) => {
          const cell = getCell(pc.idx);
          const amount = _silsonText(cell);
          if (!_silsonHasAmount(amount)) return;
          hits.push({
            productIndex,
            productName: pc.label,
            major,
            minor,
            amount
          });
        });
      });
    });
    return hits;
  }

  function _silsonFindColumnForCategoryHit(hit, cols) {
    const byName = cols.find(c => _silsonLooksSameProduct(hit.productName, c.보험명));
    if (byName) return byName;
    return cols[hit.productIndex] || null;
  }

  function _silsonBuildHits(cols) {
    const byKey = new Map();
    const addHit = (col, source, detail) => {
      if (!col) return;
      const key = String(col.idx);
      if (!byKey.has(key)) {
        byKey.set(key, {
          name: col.보험명 || detail?.productName || '(이름 없음)',
          company: col.보험사명 || '',
          date: col.계약일 || '?',
          cell: col.commentCell,
          sources: [],
          details: []
        });
      }
      const h = byKey.get(key);
      if (source && !h.sources.includes(source)) h.sources.push(source);
      if (detail) h.details.push(detail);
    };

    cols.forEach(c => {
      const blob = `${c.보험명 || ''} ${c.소분류 || ''} ${c.대분류 || ''}`;
      if (/실손|실비/.test(blob)) addHit(c, '상단 보험상품 정보', null);
    });

    const categoryHits = _silsonScanCategoryAmounts();
    categoryHits.forEach(ch => {
      const col = _silsonFindColumnForCategoryHit(ch, cols);
      addHit(col, '실비 담보금', ch);
    });

    return Array.from(byKey.values()).map(h => {
      const a = analyzeSilsonGeneration(h.date);
      const detailText = h.details.length
        ? h.details.slice(0, 4).map(d => `${d.minor || d.major}: ${d.amount}`).join(', ') + (h.details.length > 4 ? ` 외 ${h.details.length - 4}건` : '')
        : '';
      return {
        ...h,
        text: a ? `${a.gen}, ${a.renew}` : '계약일 인식 실패',
        ok: !!a,
        reason: h.sources.join('+') || '실손/실비 텍스트',
        detailText
      };
    });
  }

  // 매니저 코멘트 셀에 값 입력 (React 호환 — 클릭으로 편집기 활성화 후 native setter)
  async function _setCommentCell(cell, value) {
    if (!cell) return false;
    let inp = cell.querySelector('textarea, input[type="text"], input:not([type])');
    if (!inp) { try { cell.click(); } catch (_) {} await sleep(160); inp = cell.querySelector('textarea, input[type="text"], input:not([type])'); }
    if (!inp) {
      const ce = cell.querySelector('[contenteditable="true"], [role="textbox"]');
      if (ce) { try { ce.focus(); } catch (_) {} ce.textContent = value; ce.dispatchEvent(new Event('input', { bubbles: true })); ce.dispatchEvent(new Event('blur', { bubbles: true })); return true; }
      return false;
    }
    const proto = inp.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(inp, value);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    inp.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  async function fillSilsonComments(btn) {
    const old = btn ? btn.textContent : '';
    if (btn) { btn.textContent = '⏳ 분석 중…'; btn.disabled = true; }
    try {
      const cols = _silsonScanColumns();
      const hits = _silsonBuildHits(cols);
      console.log('[Toss Extractor] 실손 세대 분석 후보:', hits);
      if (!hits.length) { pageAlert('실손/실비 보험을 찾지 못했습니다.\n토스 보장분석 표가 보이는 상태에서 사용하세요.'); return; }
      const summary = hits.map(h =>
        `· ${(h.name).slice(0, 26)} (${h.date}) → ${h.text}` +
        (h.reason ? ` [${h.reason}]` : '') +
        (h.detailText ? `\n  - ${h.detailText}` : '')
      ).join('\n');
      if (!await pageConfirm(`실손 ${hits.length}건을 분석했습니다. 매니저 코멘트에 입력할까요?\n\n${summary}`)) return;
      let written = 0; const failed = [];
      for (const h of hits) {
        if (h.ok && h.cell && await _setCommentCell(h.cell, h.text)) written++;
        else failed.push(`${h.name} → ${h.text} (${h.ok ? '코멘트칸 못찾음' : '계약일 오류'})`);
      }
      try { await navigator.clipboard.writeText(hits.map(h => `${h.name}: ${h.text}${h.detailText ? ' / ' + h.detailText : ''}`).join('\n')); } catch (_) {}
      pageAlert(`✅ 매니저 코멘트 ${written}건 입력 완료.` +
        (failed.length ? `\n\n⚠️ 미입력 ${failed.length}건(직접 입력 필요):\n${failed.join('\n')}` : '') +
        `\n\n(결과는 클립보드에도 복사됨)`);
    } catch (e) {
      pageAlert('실손 분석 실패: ' + (e && e.message || e));
    } finally {
      if (btn) { btn.textContent = old; btn.disabled = false; }
    }
  }

  // 🆕 왼쪽 사이드 버튼 스택 — 새 버튼은 _makeSideBtn 으로 추가하면 자동으로 세로 나열된다.
  function _ensureSidebar() {
    let bar = document.getElementById('__ext_sidebar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = '__ext_sidebar';
      bar.style.cssText = 'position:fixed; left:14px; bottom:20px; z-index:2147483647; display:flex; flex-direction:column; gap:10px; font-family:sans-serif;';
      document.body.appendChild(bar);
    }
    return bar;
  }
  function _makeSideBtn(id, text, bg, handler) {
    if (document.getElementById(id)) return;
    const b = document.createElement('button');
    b.id = id;
    b.textContent = text;
    b.style.cssText = 'padding:11px 16px; background:' + bg + '; color:#fff; border:none; border-radius:10px; font-weight:700; font-size:13px; box-shadow:0 6px 18px rgba(0,0,0,.22); cursor:pointer; white-space:nowrap; text-align:left;';
    b.onclick = function () { handler(b); };
    _ensureSidebar().appendChild(b);
  }
  function ensureButton() {
    // 🆕 오직 토스 보장분석(보장내역 /cover/ 경로) 페이지에서만 노출 — 다른 토스 페이지/앱에서는 표시 안 함
    if (!/\/cover\//.test(location.pathname) && !findCopyBtn()) {
      const _bar = document.getElementById('__ext_sidebar');
      if (_bar) _bar.remove();   // 보장분석 페이지를 벗어나면(SPA 전환) 버튼 제거
      return;
    }
    // 🆕 페인트 프로·부재고객[경고] 모두 확장 팝업으로 이동.
    //   __paintpro_send 는 팝업의 '🎨 페인트 프로' 버튼이 scripting으로 click() 하는 앵커 — 화면엔 안 보이게 숨김.
    if (!document.getElementById('__paintpro_send')) {
      const _anchor = document.createElement('button');
      _anchor.id = '__paintpro_send';
      _anchor.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden;pointer-events:none;';
      _anchor.onclick = function () { sendToPaintPro(_anchor); };
      document.body.appendChild(_anchor);
    }
    // 🩺 실손 세대 분석 버튼 (보장분석 표가 있을 때만 노출)
    _makeSideBtn('__silson_gen', '🩺 실손 세대 분석', '#0ea5e9', fillSilsonComments);
  }

  // 탭 전환/지연 렌더로 버튼이 늦게 생기므로 주기적으로 확인
  try { ensureButton(); setInterval(ensureButton, 1500); } catch (e) {}
})();

