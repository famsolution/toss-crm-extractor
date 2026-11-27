// ═══════════════════════════════════════════════════════════════════
// 🆕 보장분석 → 페인트프로(editor.html) 이미지 전송
//   CRM 페이지: '이미지 복사'(클립보드) 자동 클릭 → 클립보드 읽기 → storage 저장 → 새 탭 editor 열기
//   editor 페이지: storage 의 이미지를 sessionStorage 로 넘기고 editor 의 로더를 트리거
// ═══════════════════════════════════════════════════════════════════
(function () {
  // 재주입되면 setInterval 이 겹쳐 돌고 버튼이 두 번 붙으므로 한 번만 실행한다.
  if (window.__sdhPaintProBound) return;
  window.__sdhPaintProBound = true;
  // 이 스크립트 인스턴스 표식 — 확장 새로고침 후 남은 옛 앵커를 구분하는 데 쓴다
  const _OWNER = (chrome.runtime.getManifest().version || '') + ':' + Math.random().toString(36).slice(2);

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
          sessionStorage.setItem('toss_analysis_filename', payload.fileName || '보장분석.png');
        } catch (e) {}
        const trigger = function () { try { window.postMessage({ __paintProLoad: true }, '*'); } catch (e) {} };
        trigger(); setTimeout(trigger, 400); setTimeout(trigger, 1200); setTimeout(trigger, 2500);
        try { chrome.storage.local.remove(STORAGE_KEY); } catch (e) {}
      });
    } catch (e) {}
    return;
  }

  // ───────── vercel 메인 앱(app.html 등): storage 의 적용 대기 데이터를 페이지로 중개 ─────────
  //   확장 popup 이 chrome.storage.local['__sdhPendingApply'] 에 저장 → 앱이 로그인/렌더 완료돼
  //   receiver(__applyTossDataFromExtension)가 준비되는 순간 적용 (탭 열림/로그인 타이밍 무관).
  if (/tossinssu-pro\.vercel\.app$/.test(host)) {
    (function () {
      const PKEY = '__sdhPendingApply';
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

  // ───────── 보장분석 페이지: 전송 버튼 추가 ─────────
  // 🆕 CRM(보장분석) 도메인이 아니면 전송 버튼을 절대 설치하지 않음
  //    (vercel 제안서의 '표', mmlfcp 등 다른 사이트에서 잘못 뜨던 문제 차단)
  if (!/(^|\.)tossinsu\.com$/i.test(host)) return;
  const findCopyBtn = function () {
    return Array.from(document.querySelectorAll('button')).find(function (b) { return (b.textContent || '').trim() === '이미지 복사'; });
  };
  const findTableTab = function () {
    return Array.from(document.querySelectorAll('button, [role=tab]')).find(function (b) { return (b.textContent || '').trim() === '표'; });
  };
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  // 응답이 오지 않는 단계에서 멈추지 않도록 — ms 안에 안 끝나면 fallback 으로 넘어감
  const _within = function (p, ms, fallback) { return Promise.race([Promise.resolve(p).catch(function () { return fallback; }), sleep(ms).then(function () { return fallback; })]); };
  let _ppStep = '', _ppBgSilent = false;
  const blobToDataURL = function (blob) { return new Promise(function (res, rej) { const fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(blob); }); };

  // ── 클립보드 가로채기: CRM이 이미지를 클립보드에 쓰는 순간 그 dataURL 을 받는다 ──
  //   (clipboard.read 와 달리 포커스가 필요 없어 팝업 실행에서도 동작)
  let _capturedImageURL = null, _capturedAt = 0;
  (function injectClipInterceptor() {
    try {
      window.addEventListener('message', function (ev) {
        if (ev.source === window && ev.data && ev.data.__sdhImageCaptured && ev.data.dataURL) {
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
      const items = await _within(navigator.clipboard.read().catch(function (e) { return { __err: e }; }), 2500, '__timeout');
      if (items === '__timeout') { _lastClipErr = '클립보드 읽기 권한 창이 떠 있거나(주소창 확인) 응답이 없습니다'; return null; }
      if (items && items.__err) throw items.__err;
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

  // 🆕 보장분석 요약(고객명/나이/성별/상령일/보험개수/월납합계/잔여합계)을 보장분석 스튜디오로 전송
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
        pageAlert('추출할 보장분석 데이터를 찾지 못했습니다.\n보장분석(보장내역) 페이지에서 사용해 주세요.');
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
  //   CRM 페이지 CSS 가 섞이지 않도록 Shadow DOM 안에 그린다.
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
      // CRM '보장분석 표 미리보기' 같은 창(모달)이 떠 있으면 그 위에 보이고 눌려야 한다 —
      // 일반 요소는 z-index 가 아무리 커도 모달 아래에 깔리거나 눌리지 않는다(사무실 PC 에서 '미리보기에서 멈춤'으로 보임).
      // → 브라우저 '맨 위 층' 에 올라가는 <dialog>.showModal() 로 띄운다.
      const dlg = document.createElement('dialog');
      dlg.style.cssText = 'padding:0;margin:0;border:0;background:transparent;width:100vw;height:100vh;max-width:none;max-height:none;overflow:hidden;pointer-events:auto;';
      const hostEl = document.createElement('div');
      hostEl.style.cssText = 'position:fixed; inset:0; z-index:2147483647; pointer-events:auto;';
      dlg.appendChild(hostEl);
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
      let fin = false;
      const finish = function (v) { if (fin) return; fin = true; try { dlg.close(); } catch (e) {} try { dlg.remove(); } catch (e) {} resolve(v); };
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); finish(false); });
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
      (document.body || document.documentElement).appendChild(dlg);
      try { dlg.showModal(); } catch (e) { try { dlg.setAttribute('open', ''); } catch (_) {} }
      setTimeout(function () { try { ok.focus(); } catch (e) {} }, 30);
    });
  }
  function pageAlert(message, title)   { return _pageDialog(message, title, false); }
  function pageConfirm(message, title) { return _pageDialog(message, title, true); }

  // 🆕 탭 배율을 100% 로 (background 가 chrome.tabs.setZoom 수행). 이전 배율을 돌려준다. 실패하면 0.
  function _setTabZoom100() {
    return new Promise(function (res) {
      try {
        let done = false;
        chrome.runtime.sendMessage({ action: 'paintProZoom', op: 'set100' }, function (r) {
          void chrome.runtime.lastError; if (done) return; done = true; res((r && r.ok && r.prev) || 0);
        });
        // 백그라운드가 옛 버전이면(파일만 바뀌고 확장을 다시 불러오지 않음) 답이 오지 않는다 → 배율 맞추기 없이 진행
        setTimeout(function () { if (!done) { done = true; _ppBgSilent = true; res(0); } }, 2500);
      } catch (e) { res(0); }
    });
  }
  function _restoreTabZoom(prev) {
    if (!prev || Math.abs(prev - 1) < 0.001) return;
    try { chrome.runtime.sendMessage({ action: 'paintProZoom', op: 'restore', zoom: prev }, function () { void chrome.runtime.lastError; }); } catch (e) {}
  }


  // ═══════════════════════════════════════════════════════════════════
  // ⏳ 미리보기 창이 '완전히 자리 잡은 뒤' 이미지 복사 누르기 (글자 겹침의 근본 원인 수정, 2026-11)
  //   '표' 를 누르면 '보장분석 표 미리보기' 창이 작게 시작해 커지는 애니메이션으로 열린다.
  //   그 도중에 '이미지 복사' 를 누르면 CRM은 칸 크기를 '줄어든 상태'로 재고 글자는 원래 크기로
  //   그려서, 글자가 칸보다 커져 겹치고 잘린다(사용자 이미지: 기준의 88% 크기로 나옴).
  //   사람이 직접 누를 때는 애니메이션이 이미 끝나 있어서 정상이었다.
  //   → 애니메이션·크기 변화가 멈추고 글꼴이 다 불러와질 때까지 기다린 뒤 누른다.
  // ═══════════════════════════════════════════════════════════════════
  function _scaledAncestor(el) {
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const t = getComputedStyle(a).transform;
      if (t && t !== 'none') {
        const m = t.match(/matrix\(([^)]+)\)/);
        if (m) { const v = m[1].split(',').map(Number); if (Math.abs(Math.hypot(v[0], v[1]) - 1) > 0.002) return true; }
        else if (/matrix3d/.test(t)) return true;
      }
    }
    return false;
  }
  function _reportTitle() {
    const all = document.querySelectorAll('h1,h2,h3,h4,div,span,p,strong');
    for (let i = 0; i < all.length; i++) {
      const t = (all[i].textContent || '').trim();
      if (t.length <= 40 && /님의\s*보장\s*분석$/.test(t) && all[i].offsetWidth > 0) return all[i];
    }
    return null;
  }
  async function _waitPreviewSettled(btn, maxMs) {
    const start = Date.now();
    const box = (btn && (btn.closest('[role="dialog"]') || btn.closest('[aria-modal="true"]'))) || _reportTitle() || btn || document.body;
    let last = '', stable = 0;
    while (Date.now() - start < (maxMs || 5000)) {
      const r = box.getBoundingClientRect();
      const key = [r.left, r.top, r.width, r.height].map(function (v) { return Math.round(v * 10); }).join(',');
      let running = 0;
      try {
        running = (document.getAnimations ? document.getAnimations() : []).filter(function (a) {
          if (a.playState !== 'running') return false;
          try { const tm = a.effect && a.effect.getTiming && a.effect.getTiming(); if (tm && tm.iterations === Infinity) return false; } catch (e) {}   // 로딩 스피너 등 무한 반복은 제외
          return true;
        }).length;
      } catch (e) {}
      const scaled = _scaledAncestor(box);
      stable = (key === last && !running && !scaled) ? stable + 1 : 0;
      last = key;
      if (stable >= 3) break;
      await sleep(100);
    }
    try { await _within(document.fonts.ready, 2000, null); } catch (e) {}
    await _within(new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }), 400, null);   // 창이 가려져 있으면 그림 갱신이 멈춰서 기다리지 않음
  }
  // CRM 이미지가 '줄어든 상태'로 찍혔는지 — 보고서 폭 대비 이미지 폭이 화면 배율의 정수배(1·2·3배)가 아니면 의심
  async function _imgLooksScaled(url) {
    try {
      const im = await _within(new Promise(function (res, rej) { const i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = url; }), 3000, null);
      if (!im) return false;
      const title = _reportTitle();
      if (!title) return false;
      const want = im.width / im.height;
      for (let el = title.parentElement; el && el !== document.documentElement; el = el.parentElement) {
        const w = el.offsetWidth, h = el.scrollHeight;
        if (w < 200 || h < 200) continue;
        if (Math.abs(w / h - want) / want < 0.015) {
          const k = im.width / w, d = window.devicePixelRatio || 1;
          return ![1, 2, 3, d, 2 * d, 3 * d].some(function (c) { return Math.abs(k / c - 1) < 0.02; });
        }
      }
    } catch (e) {}
    return false;
  }

  // 진행 안내 — 확장 버튼으로 시작하면 숨은 앵커가 눌리므로 화면에 아무 표시가 없었다 → 위쪽에 작은 안내
  let _ppMsgEl = null, _ppMsgT = null;
  function _ppStatus(msg, ms) {
    try {
      if (!_ppMsgEl || !document.documentElement.contains(_ppMsgEl)) {
        _ppMsgEl = document.createElement('div');
        _ppMsgEl.style.cssText = 'position:fixed;top:14px;left:50%;right:auto;bottom:auto;margin:0;border:0;transform:translateX(-50%);z-index:2147483647;background:#37352F;color:#fff;padding:9px 16px;border-radius:8px;font:600 14px -apple-system,"Malgun Gothic",sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);pointer-events:none;';
        try { _ppMsgEl.setAttribute('popover', 'manual'); } catch (e) {}   // 미리보기 창 위에도 보이도록 맨 위 층으로
        (document.body || document.documentElement).appendChild(_ppMsgEl);
      }
      _ppMsgEl.textContent = msg; _ppMsgEl.style.display = '';
      try { if (_ppMsgEl.showPopover) { _ppMsgEl.hidePopover && _ppMsgEl.matches(':popover-open') && _ppMsgEl.hidePopover(); _ppMsgEl.showPopover(); } } catch (e) {}
      clearTimeout(_ppMsgT);
      if (ms) _ppMsgT = setTimeout(function () { if (_ppMsgEl) _ppMsgEl.style.display = 'none'; }, ms);
    } catch (e) {}
  }
  // 페인트프로 편집기 열기 — 확장 버튼에서 시작하면 이 페이지에 '사용자 클릭' 이 없어서 window.open 이
  // 팝업 차단에 막힌다(이미지 복사 뒤 아무 변화 없음). background 가 새 탭으로 연다.
  function _ppOpenEditor() {
    return new Promise(function (res) {
      let done = false;
      try {
        chrome.runtime.sendMessage({ action: 'paintProOpenEditor', url: EDITOR_URL }, function (r) {
          void chrome.runtime.lastError;
          if (done) return; done = true;
          if (r && r.ok) return res(true);
          res(!!window.open(EDITOR_URL, '_blank'));
        });
      } catch (e) { done = true; res(!!window.open(EDITOR_URL, '_blank')); }
      setTimeout(function () { if (!done) { done = true; res(!!window.open(EDITOR_URL, '_blank')); } }, 3000);
    });
  }

  // 바깥 껍데기: 어떤 단계에서 멈춰도 60초 뒤에는 풀고, 어느 단계였는지 알려 준다
  let _ppRunning = 0;
  async function sendToPaintPro(fab) {
    if (_ppRunning && Date.now() - _ppRunning < 60000) { _ppStatus('🎨 이미 페인트프로로 보내는 중입니다… (' + _ppStep + ')', 2500); return; }
    _ppRunning = Date.now(); _ppStep = '시작'; _ppBgSilent = false;
    const old = fab.textContent;
    let finished = false;
    const watchdog = setTimeout(function () {
      if (finished) return;
      _ppRunning = 0; fab.textContent = old; fab.disabled = false; _ppStatus('', 1);
      pageAlert('페인트프로 보내기가 「' + _ppStep + '」 단계에서 멈췄습니다.\n\n' + _ppHint() + '\n\n[확장 v' + chrome.runtime.getManifest().version + ']', '🎨 페인트프로');
    }, 60000);
    try { await _sendToPaintPro(fab, old); }
    finally { finished = true; clearTimeout(watchdog); _ppRunning = 0; }
  }
  function _ppHint() {
    const tips = [];
    if (_ppBgSilent) tips.push('· 확장의 뒤쪽(백그라운드)이 답하지 않습니다 — chrome://extensions 에서 상담 도우미 🔄 새로고침 후 CRM 탭도 F5');
    if (/이미지 복사/.test(_ppStep)) tips.push('· CRM [이미지 복사] 를 직접 눌러 "복사되었습니다" 가 뜨는지 확인 — 안 뜨면 이 PC 의 클립보드 사용이 막힌 것입니다(주소창 왼쪽 🔒 → 사이트 설정 → 클립보드 허용)');
    if (/클립보드/.test(_ppStep)) tips.push('· CRM [이미지 복사] 를 눌러도 이미지가 오지 않았습니다 — CRM 미리보기에서 [이미지 복사] 를 직접 눌러 "복사되었습니다" 가 뜨는지 확인해 주세요. 안 뜨면 이 PC 의 클립보드 사용이 막힌 것입니다(주소창 왼쪽 🔒 → 사이트 설정 → 클립보드 → 허용)');
    if (/클립보드/.test(_ppStep) || _lastClipErr) tips.push('· 클립보드: ' + (_lastClipErr || '읽기 실패'));
    if (/여는/.test(_ppStep)) tips.push('· 페인트프로 주소(tossinssu-pro.vercel.app)가 회사 인터넷에서 열리는지 주소창에 직접 넣어 확인');
    if (!tips.length) tips.push('· CRM 탭을 F5 로 새로고침한 뒤 다시 시도해 주세요');
    return tips.join('\n');
  }
  async function _sendToPaintPro(fab, old) {
    fab.textContent = '⏳ 이미지 준비 중…'; fab.disabled = true;
    _ppStatus('🎨 페인트프로로 보내는 중… (표 이미지 준비)');
    try {
      // 1) '이미지 복사' 버튼이 안 보이면 → '표' 탭을 먼저 눌러 표 화면을 띄운다
      _ppStep = '표 화면 찾기';
      let btn = findCopyBtn();
      if (!btn) {
        const tab = findTableTab();
        if (tab) { tab.click(); for (let i = 0; i < 12 && !btn; i++) { await sleep(250); btn = findCopyBtn(); } }
      }
      if (!btn) { pageAlert('표 탭 또는 "이미지 복사" 버튼을 찾지 못했습니다.\n보장분석 페이지에서 사용해 주세요.'); return; }

      // 2) 🆕 브라우저 확대/축소를 100% 로 맞춘 뒤 캡처한다 (근본 원인 수정, 2026-11).
      //    CRM '이미지 복사'는 화면 배치를 재서 글자를 다시 그리는데, 탭 배율이 100% 가 아니면
      //    배치는 줄어든 크기로 재고 글자는 원래 크기로 그려 글자가 커지고 겹치고 잘린다.
      //    (예전에 이미지가 약 99% 크기로 들어오던 것도 같은 원인.) 캡처가 끝나면 원래 배율로 되돌린다.
      let dataURL = null;
      _ppStep = '화면 배율 100% 맞추기';
      const zoomBefore = await _setTabZoom100();
      if (zoomBefore && Math.abs(zoomBefore - 1) > 0.001) {
        await sleep(400);
        try { await _within(document.fonts.ready, 2000, null); } catch (e) {}
        await _within(new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }), 400, null);   // 창이 가려져 있으면 그림 갱신이 멈춰서 기다리지 않음
      }
      try {

      // 2) 가로채기 리셋 후 CRM '이미지 복사' 클릭 → CRM이 clipboard.write 하는 순간
      //    가로채기 스크립트가 dataURL 을 postMessage 로 보내준다(포커스 불필요).
      // 미리보기 창 애니메이션이 끝나 자리 잡을 때까지 기다린 뒤 누른다 (위 _waitPreviewSettled 설명)
      for (let attempt = 0; attempt < 2 && !dataURL; attempt++) {
        _ppStep = '미리보기 자리 잡기 기다림';
        await _waitPreviewSettled(btn, attempt ? 6000 : 4000);
        _ppStep = 'CRM 이미지 복사';
        _capturedImageURL = null;
        const clickedAt = Date.now();
        _ppStatus('🎨 페인트프로로 보내는 중… (이미지 복사)');
        btn.click();

        // 3) 가로챈 이미지를 우선 대기(최대 ~3.5초). 실패 시 클립보드 읽기로 폴백.
        for (let i = 0; i < 20 && !dataURL; i++) {
          await sleep(180);
          if (_capturedImageURL && _capturedAt >= clickedAt) { dataURL = _capturedImageURL; break; }
        }
        if (!dataURL) {   // 폴백: 클립보드 직접 읽기(포커스 있을 때만 성공)
          _ppStep = '클립보드에서 이미지 읽기';
          for (let i = 0; i < 8 && !dataURL; i++) { await sleep(180); dataURL = await readClipboardImage(); }
        }
        // 그래도 줄어든 상태로 찍혔으면 한 번 더 기다렸다 다시 누른다
        if (dataURL && attempt === 0 && await _imgLooksScaled(dataURL)) {
          console.warn('[paint-pro] CRM 이미지가 줄어든 상태로 찍힘 — 기다렸다 다시 복사');
          dataURL = null;
          await sleep(800);
        }
      }
      } finally {
        if (zoomBefore) _restoreTabZoom(zoomBefore);
      }
      if (!dataURL) {
        _ppStatus('', 1);
        pageAlert('이미지를 읽지 못했습니다 (「' + _ppStep + '」 단계).\n\n' + _ppHint());
        return;
      }
      _ppStep = '이미지 넘길 준비';
      const saveErr = await _within(new Promise(function (r) { chrome.storage.local.set({ [STORAGE_KEY]: { dataURL: dataURL, fileName: '보장분석.png', ts: Date.now() } }, function () { r(chrome.runtime.lastError ? chrome.runtime.lastError.message : ''); }); }), 5000, '저장 응답 없음');
      if (saveErr) { _ppStatus('', 1); pageAlert('이미지를 넘기지 못했습니다: ' + saveErr + '\n(이미지 크기 ' + Math.round(dataURL.length / 1048576 * 10) / 10 + 'MB)\n\n' + _ppHint(), '🎨 페인트프로'); return; }
      _ppStep = '페인트프로 여는';
      _ppStatus('🎨 페인트프로를 여는 중…');
      const opened = await _ppOpenEditor();
      if (opened) _ppStatus('✅ 페인트프로를 새 탭으로 열었습니다', 3500);
      else { _ppStatus('', 1); pageAlert('페인트프로 창을 열지 못했습니다.\n주소창 오른쪽의 팝업 차단 표시를 눌러 crm.tossinsu.com 팝업을 허용한 뒤 다시 시도해 주세요.'); }
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
      console.log('[상담도우미] 실손 세대 분석 후보:', hits);
      if (!hits.length) { pageAlert('실손/실비 보험을 찾지 못했습니다.\n보장분석 표가 보이는 상태에서 사용하세요.'); return; }
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
    // 🆕 오직 보장분석(보장내역 /cover/ 경로) 페이지에서만 노출 — 다른 CRM 페이지/앱에서는 표시 안 함
    if (!/\/cover\//.test(location.pathname) && !findCopyBtn()) {
      const _bar = document.getElementById('__ext_sidebar');
      if (_bar) _bar.remove();   // 보장분석 페이지를 벗어나면(SPA 전환) 버튼 제거
      return;
    }
    // 🆕 페인트 프로·부재고객[경고] 모두 확장 팝업으로 이동.
    //   __paintpro_send 는 팝업의 '🎨 페인트 프로' 버튼이 scripting으로 click() 하는 앵커 — 화면엔 안 보이게 숨김.
    //   🆕 확장을 새로고침하면 옛 버전 스크립트가 만든 앵커가 페이지에 남는다. 그 앵커를 누르면
    //      죽은 옛 코드가 돌아 아무 일도 안 일어나므로, 이 스크립트가 만든 앵커가 아니면 갈아끼운다.
    const _old = document.getElementById('__paintpro_send');
    if (_old && _old.dataset.owner !== _OWNER) _old.remove();
    if (!document.getElementById('__paintpro_send')) {
      const _anchor = document.createElement('button');
      _anchor.id = '__paintpro_send';
      _anchor.dataset.owner = _OWNER;
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

