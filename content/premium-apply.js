// 🆕 보험료 비교 페이지 통합 자동 입력 — popup 에서 sendMessage 로 호출
//   payload: { customer, cfg, clickSearch, applyCoverages }
async function applyToPremiumFormUnified(payload) {
  const out = { ok: false, filled: {}, applied: {}, location: location.href, steps: [] };
  const t0 = Date.now();
  const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
  // 🆕 진행 상황 시각화 — 우상단 status 박스 (작업 끝날 때까지 유지)
  let statusBox = null;
  const updateStatus = (msg, color = '#3182f6') => {
    try {
      if (!statusBox) {
        statusBox = document.createElement('div');
        statusBox.id = '__tossExtStatus';
        statusBox.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;background:#3182f6;color:#fff;padding:12px 18px;border-radius:8px;font-size:13px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.3);min-width:280px;max-width:380px;line-height:1.4;';
        document.body.appendChild(statusBox);
      }
      statusBox.style.background = color;
      statusBox.innerHTML = `<div style="font-size:11px;opacity:0.85;margin-bottom:2px;">${elapsed()}</div>${msg}`;
    } catch {}
    out.steps.push({ t: elapsed(), msg });
  };
  const logStep = (msg) => { console.log(`[Toss Extractor] [${elapsed()}] ${msg}`); updateStatus(msg); };

  try {
    logStep('🔌 자동입력 시작');
    console.log('[Toss Extractor] payload:', payload);

    // 폼 요소 등장 대기 헬퍼 (최대 15초)
    const waitForEl = async (id, requireOptions = false, maxMs = 10000) => {
      const start = Date.now();
      while (Date.now() - start < maxMs) {
        const el = document.getElementById(id);
        if (el && (!requireOptions || (el.options && el.options.length > 0))) return el;
        await new Promise(r => setTimeout(r, 200));
      }
      return null;
    };

    const setInputVal = (el, val) => {
      if (!el) return false;
      try {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, val);
      } catch { el.value = val; }
      try {
        el.dispatchEvent(new Event('focus', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      } catch {}
      try { if (window.jQuery) window.jQuery(el).val(val).trigger('change').trigger('input'); } catch {}
      const final = el.value;
      console.log(`[Toss Extractor] setInputVal ${el.id}: target=${val}, final=${final}`);
      return final === String(val);
    };
    const setSelectVal = (el, val) => {
      if (!el || !el.options || el.options.length === 0) return false;
      const hasOption = Array.from(el.options).some(o => o.value === String(val));
      if (!hasOption) {
        const byText = Array.from(el.options).find(o => (o.textContent || '').trim() === String(val).trim());
        if (byText) val = byText.value; else return false;
      }
      // 1) selectedIndex 와 value 동시 설정
      let targetIdx = -1;
      for (let i = 0; i < el.options.length; i++) {
        if (el.options[i].value === String(val)) { targetIdx = i; break; }
      }
      if (targetIdx >= 0) el.selectedIndex = targetIdx;
      // 2) 네이티브 setter 로 value 설정 + 옵션 selected 속성 명시
      try {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(el, val);
      } catch { el.value = val; }
      Array.from(el.options).forEach((o, i) => { o.selected = (i === targetIdx); });
      // 3) 풍부한 이벤트 시퀀스 — 일부 페이지는 focus/blur/mousedown 등 필요
      try {
        el.dispatchEvent(new Event('focus', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      } catch {}
      // 4) jQuery change (페이지가 jQuery 사용 시)
      try { if (window.jQuery) window.jQuery(el).val(val).trigger('change'); } catch {}
      // 5) 검증 — 실제 값이 반영됐는지 확인
      const final = el.value;
      console.log(`[Toss Extractor] setSelectVal ${el.id}: target=${val}, final=${final}, idx=${el.selectedIndex}, options=${el.options.length}`);
      return final === String(val);
    };


    const cust = payload.customer || {};
    const cfg = payload.cfg || {};
    console.log('[Toss Extractor] 🧑 customer 객체:', cust, '키:', Object.keys(cust));

    // 핵심 요소 등장 대기
    logStep('🔍 폼 요소 등장 대기 (최대 10초)…');
    const anchor = await waitForEl('cust_name', false, 10000) || await waitForEl('selInsuranceType', false, 3000);
    if (!anchor) {
      out.error = '폼 요소 미발견 (cust_name/selInsuranceType 모두 없음)';
      logStep('❌ 폼 미발견 — 페이지 구조 다름');
      statusBox && (statusBox.style.background = '#dc2626');
      setTimeout(() => statusBox?.remove(), 8000);
      return out;
    }
    logStep(`✅ 폼 발견: ${anchor.id}`);

    // ── 이름 — 다양한 키 시도 ──
    const nameEl = document.getElementById('cust_name');
    const name = cust['고객명'] || cust['이름'] || cust['_고객명'] || cust.name || cust.customerName || '';
    logStep(`👤 이름 입력 시도 — el:${!!nameEl}, value:"${name}"`);
    if (nameEl && name) {
      setInputVal(nameEl, name);
      out.filled['이름'] = name;
      out.ok = true;
    } else if (nameEl) {
      logStep('⚠️ 이름 스킵 — customer 데이터에 이름 없음');
    }
    // ── 생년월일 — 다양한 키 시도 ──
    const birthEl = document.getElementById('birth_date');
    let birthRaw = cust['생년월일'] || cust['birthDate'] || cust['birth'] || cust['주민번호'] || '';
    // 주민번호에서 생년월일 추출 — 앞 6자리
    if (birthRaw && birthRaw.length >= 6 && /^\d/.test(birthRaw)) {
      const justDigits = String(birthRaw).replace(/[^\d]/g, '');
      if (justDigits.length >= 7) {
        // 주민번호 패턴 (YYMMDD-X...) 또는 YYYYMMDD
        birthRaw = justDigits.length >= 8 ? justDigits.slice(0, 8) : justDigits.slice(0, 6);
        // 주민번호의 7번째 자리로 성별 판별 가능 (1,3 남자 / 2,4 여자)
      }
    }
    logStep(`📅 생년월일 입력 시도 — el:${!!birthEl}, raw:"${birthRaw}"`);
    if (birthEl && birthRaw) {
      let digits = String(birthRaw).replace(/[^\d]/g, '');
      if (digits.length === 6) {
        const yy = parseInt(digits.slice(0, 2), 10);
        digits = `${yy <= 24 ? 2000 + yy : 1900 + yy}${digits.slice(2)}`;
      }
      if (digits.length >= 8) {
        digits = digits.slice(0, 8);
        setInputVal(birthEl, digits);
        out.filled['생년월일'] = digits;
        out.ok = true;
      } else {
        logStep(`⚠️ 생년월일 형식 변환 실패: ${digits}`);
      }
    } else if (birthEl) {
      logStep('⚠️ 생년월일 스킵 — customer 데이터에 생년월일 없음');
    }
    // ── 성별 — 주민번호로도 시도 ──
    const genderEl = document.getElementById('gender');
    let gender = cust['성별'] || cust['gender'] || '';
    // 주민번호에서 성별 추출 (7번째 자리)
    if (!gender && cust['주민번호']) {
      const ssn = String(cust['주민번호']).replace(/[^\d]/g, '');
      if (ssn.length >= 7) {
        const code = ssn[6];
        if (['1','3','5','7'].includes(code)) gender = '남성';
        else if (['2','4','6','8'].includes(code)) gender = '여성';
      }
    }
    logStep(`⚥ 성별 입력 시도 — el:${!!genderEl}, value:"${gender}"`);
    if (genderEl && gender) {
      const code = /남|^M$|male/i.test(gender) ? 'M' : (/여|^F$|female/i.test(gender) ? 'F' : '');
      if (code) {
        setSelectVal(genderEl, code);
        out.filled['성별'] = `${gender} (${code})`;
        out.ok = true;
        console.log('[Toss Extractor] ✅ 성별:', code);
      }
    }
    // ── 생손보 유형 / 상품 유형 / 만기 — cascading selects ──
    //   insType 변경 시 prodType 옵션이 페이지 JS 로 재로딩됨 → 각 변경 후 대기 필수
    //   prodType 변경 시 maturity 옵션도 재로딩될 수 있음

    // 옵션 안정화 대기 — 특정 value 가 옵션에 나타날 때까지 (최대 5초)
    const waitForOption = async (selectId, targetValue, maxMs = 5000) => {
      const start = Date.now();
      while (Date.now() - start < maxMs) {
        const el = document.getElementById(selectId);
        if (el && el.options && Array.from(el.options).some(o => o.value === String(targetValue))) return el;
        await new Promise(r => setTimeout(r, 150));
      }
      return document.getElementById(selectId);  // 못 찾아도 일단 반환
    };

    // 🆕 [버그수정] 종속 select 안정화 헬퍼 — 값을 설정한 뒤, 페이지 JS(renderPlanOptions 등)가
    //   비동기로 값을 '첫 번째'로 되돌리는 race 를 흡수한다. 설정→대기→검증, 어긋나면 재시도.
    //   ※ 근본 원인: selInsuranceType 의 change 핸들러가 selProductsGroupCD 를 무조건 첫 옵션으로 리셋함.
    const setSelectStable = async (id, val, label, settleMs = 700, tries = 4) => {
      let lastVal = null;
      for (let i = 0; i < tries; i++) {
        const el = await waitForOption(id, val, 2500);
        if (!el || !el.options || el.options.length === 0) { lastVal = '(옵션없음)'; await new Promise(r => setTimeout(r, 300)); continue; }
        setSelectVal(el, val);
        await new Promise(r => setTimeout(r, settleMs));   // 페이지의 비동기 리셋이 끝나길 대기
        lastVal = el.value;
        if (lastVal === String(val)) {
          logStep(`✅ ${label}: ${val} (OK, ${i + 1}회)`);
          return { ok: true, finalVal: lastVal, tries: i + 1 };
        }
        logStep(`↻ ${label} 되돌려짐(${lastVal}≠${val}) — 재설정 ${i + 1}/${tries}`);
      }
      logStep(`⚠️ ${label}: ${val} 고정 실패 (현재=${lastVal})`);
      return { ok: false, finalVal: lastVal, tries };
    };

    // ── 생손보 유형 ──
    //   이미 원하는 값이면 change 를 다시 쏘지 않는다(불필요한 상품유형 리셋 방지).
    if (cfg.insType) {
      const insEl = await waitForOption('selInsuranceType', cfg.insType, 3000);
      if (insEl) {
        if (insEl.value === String(cfg.insType)) {
          logStep(`✅ 생손보 유형: ${cfg.insType} (이미 설정됨 — change 생략)`);
          out.applied['생손보 유형'] = `${cfg.insType} (유지)`;
        } else {
          const r = await setSelectStable('selInsuranceType', cfg.insType, '생손보 유형', 800);
          out.applied['생손보 유형'] = `${cfg.insType}${r.ok ? '' : ' [실패]'}`;
          // 생손보가 바뀌면 상품유형이 자동 리셋되므로 충분히 더 대기
          await new Promise(r => setTimeout(r, 400));
        }
        out.ok = true;
      }
    }
    // 🆕 [버그수정] 생손보(LF)/손보(F) 는 상품유형·만기 코드 체계가 완전히 다름.
    //   예) 손보 만기 '20년/100세'=01 / 생손보 만기 '20년/100세,종신'=06,
    //       손보 상품 '종합무해지'=06 / 생손보 상품 '건강무해지'=01.
    //   cfg 기본값은 손보(F) 코드라, 생손보 페이지에 그대로 넣으면 옵션에 없어서 전부 실패함.
    //   → 코드가 현재 select 옵션에 없으면, '옵션 텍스트(의미)'로 best-match 해서 value 를 보정한다.
    const resolveCodeByText = (selectId, wantedCode, kind) => {
      const el = document.getElementById(selectId);
      if (!el || !el.options || el.options.length === 0) return wantedCode;
      // 1) 코드가 이미 옵션에 있으면 그대로
      if (Array.from(el.options).some(o => o.value === String(wantedCode))) return wantedCode;
      // 2) cfg UI 라벨(손보 기준)에서 핵심 의미어 추출 → 현재 옵션 텍스트와 매칭
      //    만기: '100세'/'90세'/'80세'/'갱신' + 납입년수(20년/30년) 우선
      //    상품: '종합','건강','간편3.3.5','실손','치아','운전자','어린이','여성' 등 핵심어
      const optTexts = Array.from(el.options).map(o => ({ v: o.value, t: (o.textContent || '').replace(/\s/g, '') }));
      let pick = null;
      if (kind === 'maturity') {
        // 손보 코드→의미 매핑
        const matMeaning = { '01':'100세','03':'80세','04':'90세','02':'갱신','07':'30년80세','08':'30년90세','09':'30년100세' };
        const key = matMeaning[String(wantedCode)] || '100세';
        // 납입년수 포함 키워드 우선 매칭 → 안되면 만기연령만
        const ageOnly = key.replace(/^\d+년/, '');
        pick = optTexts.find(o => o.t.includes(key)) || optTexts.find(o => o.t.includes(ageOnly));
      } else {
        // 상품유형 — 손보 코드→핵심어
        const prodMeaning = {
          '06':'종합','05':'종합','07':'5.10.10','08':'여성','14':'간편3.2.5','15':'간편3.3.5',
          '16':'간편3.5.5','17':'간편3.10.10','23':'실손','24':'간편실손','26':'치아','28':'운전자',
          '18':'어린이','19':'어린이','30':'치매'
        };
        const key = prodMeaning[String(wantedCode)] || '종합';
        pick = optTexts.find(o => o.t.includes(key));
        // 종합 못 찾으면 '건강'(생손보 기본 상품명)으로 폴백
        if (!pick) pick = optTexts.find(o => o.t.includes('건강')) || optTexts.find(o => o.t.includes('종합'));
        // 그래도 없으면 첫 옵션
        if (!pick) pick = optTexts[0];
      }
      if (pick) {
        console.log(`[Toss Extractor] 🔁 ${kind} 코드 보정: ${wantedCode} → ${pick.v}(${pick.t}) [현재 생손보/손보 체계]`);
        return pick.v;
      }
      return wantedCode;
    };

    // ── 상품 유형 ── (생손보 리셋을 흡수하도록 verify-retry + 코드 체계 보정)
    if (cfg.prodType) {
      const wantProd = resolveCodeByText('selProductsGroupCD', cfg.prodType, 'product');
      logStep(`📋 상품 유형 (${cfg.prodType}${wantProd !== cfg.prodType ? '→' + wantProd : ''}) 설정…`);
      const r = await setSelectStable('selProductsGroupCD', wantProd, '상품 유형', 750);
      const el = document.getElementById('selProductsGroupCD');
      out.applied['상품 유형'] = `${wantProd}${r.ok ? '' : ' [실패-현재' + r.finalVal + '] 옵션=' + (el ? Array.from(el.options).map(o => o.value).join(',') : '')}`;
      out.ok = true;
    }
    // ── 만기 ── (상품유형 변경이 만기 옵션을 갈아끼울 수 있으므로 역시 verify-retry + 코드 보정)
    if (cfg.maturity) {
      const wantMat = resolveCodeByText('selPaymentExpirationCD', cfg.maturity, 'maturity');
      logStep(`📋 만기 (${cfg.maturity}${wantMat !== cfg.maturity ? '→' + wantMat : ''}) 설정…`);
      const r = await setSelectStable('selPaymentExpirationCD', wantMat, '만기', 500);
      const el = document.getElementById('selPaymentExpirationCD');
      out.applied['만기'] = `${wantMat}${r.ok ? '' : ' [실패-현재' + r.finalVal + '] 옵션=' + (el ? Array.from(el.options).map(o => o.value).join(',') : '')}`;
      out.ok = true;
    }

    // 조회하기 클릭
    if (payload.clickSearch) {
      logStep('🔎 조회하기 버튼 찾는 중…');
      await new Promise(r => setTimeout(r, 400));
      let btn = document.getElementById('btn_search');
      if (!btn) {
        btn = Array.from(document.querySelectorAll('button, a, input[type=button], input[type=submit]'))
          .find(el => /조회|검색/i.test((el.innerText || el.textContent || el.value || '').trim()));
      }
      if (btn) {
        btn.click();
        out.applied['조회하기'] = '클릭됨';
        logStep('✅ 조회하기 클릭 — 결과 로드 3.5초 대기');
        await new Promise(r => setTimeout(r, 3500));
      } else {
        out.applied['조회하기'] = '버튼 못 찾음';
        logStep('⚠️ 조회하기 버튼 못 찾음');
      }
    }

    // 담보 체크 + 금액 입력
    //   우선순위: payload.productCoverages (상품에서 추출한 담보+금액) > cfg.coverages (팝업 체크 목록)
    if (payload.applyCoverages) await applyCoverageSection(payload, cfg, out);

    // 완료 — 상태 박스를 녹색으로 + 5초 후 제거
    const totalItems = Object.keys(out.filled).length + Object.keys(out.applied).length;
    out.ok = totalItems > 0;
    logStep(`✅ 완료 (${totalItems}개 항목 / ${elapsed()})`);
    if (statusBox) {
      statusBox.style.background = '#10b981';
      setTimeout(() => statusBox.remove(), 5000);
    }

    return out;
  } catch (e) {
    out.error = e.message;
    console.error('[Toss Extractor] applyToPremiumFormUnified 에러:', e);
    if (statusBox) {
      statusBox.style.background = '#dc2626';
      statusBox.innerHTML = `❌ 에러: ${e.message}<br><span style="font-size:10px;opacity:0.85;">${elapsed()} 경과</span>`;
      setTimeout(() => statusBox.remove(), 10000);
    }
    return out;
  }
}

// 담보명 정규화 — 공백/구두점 제거 후 소문자. 이름 매칭 전 항상 이 형태로 맞춘다.
const normalizeCoverageName = (s) => String(s || '').replace(/[\s·,\.\-_/\\()\[\]]/g, '').toLowerCase().trim();

// ─────────────────────────────────────────────────────────────
// 적용 대상 담보 목록을 만든다 — 이름 정규화, 통합 규칙, 1~5종 수술 중복 정리,
//   '주계약' 칸 제외까지. DOM 은 건드리지 않는다.
// ─────────────────────────────────────────────────────────────
function buildCoverageTargets(payload, cfg, out) {
  // 추출된 담보명에서 표준명만 추출 — "암진단/주계약" → "암진단", "고액암진단/고액치료비암..." → "고액암진단"
  //   slash 앞에 있는 부분이 mmlfcp 의 담보 표준명과 매칭되기 쉬움
  const extractStandardName = (raw) => {
    if (!raw) return '';
    const s = String(raw);
    const slashed = s.split('/')[0];
    const cleaned = slashed.replace(/\[[^\]]*\]/g, '').replace(/\([^\)]*\)/g, '').trim();
    return cleaned || slashed.trim() || s.trim();
  };
  // 다양한 매칭 후보 생성
  //   ⚠️ raw 전체를 normalizeCoverageName 하면 "유병자질병사망/주계약" → "유병자질병사망주계약" 이 되어
  //      mmlfcp "주계약" 체크박스에 substring 오매칭됨. slash 뒷부분(대분류/주계약 구분)은 제거.
  const candidateKeys = (raw) => {
    const std = extractStandardName(raw);
    const rawHead = String(raw || '').split('/')[0];   // slash 앞부분만
    const keys = new Set();
    keys.add(normalizeCoverageName(rawHead));
    keys.add(normalizeCoverageName(std));
    keys.add(normalizeCoverageName(std.replace(/(특약|보장|진단비|진단)$/, '')));
    return Array.from(keys).filter(k => k.length > 1);
  };
  // 금액 텍스트 정규화 — "1,000만원" / "10,000,000" / "1000" 등을 "만원 단위 정수" 로
  const parseAmount = (raw) => {
    if (!raw) return null;
    const s = String(raw).replace(/[^\d만원]/g, '');
    if (!s) return null;
    // "1000만원" → 1000, "10000000" (원) → 1000 만원
    const numericOnly = s.replace(/[^\d]/g, '');
    if (!numericOnly) return null;
    const num = parseInt(numericOnly, 10);
    if (/만원/.test(String(raw)) || /만/.test(String(raw))) {
      return num;  // 이미 만원 단위
    }
    // 원 단위면 만원으로 변환
    if (num >= 10000) return Math.round(num / 10000);
    return num;
  };

  let target = [];
  if (Array.isArray(payload.productCoverages) && payload.productCoverages.length > 0) {
    target = payload.productCoverages.map(c => ({
      name: c.name,
      keys: candidateKeys(c.name),
      standardName: extractStandardName(c.name),
      amount: parseAmount(c.amount),
      rawAmount: c.amount
    }));
    console.log('[Toss Extractor] 상품에서 담보+금액 사용:', target);
  } else if (Array.isArray(cfg.coverages) && cfg.coverages.length > 0) {
    target = cfg.coverages.map(n => ({ name: n, keys: candidateKeys(n), standardName: n, amount: null }));
    console.log('[Toss Extractor] cfg.coverages 사용:', target);
  }

  // 🆕 통합담보 합산 규칙 — 원본에선 분리(뇌혈관수술 / 심장수술 각각)됐지만
  //   mmlfcp 에선 1칸으로 통합된 담보. 분리담보 금액을 합산 후 op 적용해 통합담보 1건으로 대체.
  //   예: 뇌혈관질환수술(2000) + 허혈성심장질환수술(2000) = 4000 ÷2 → "뇌혈관질환및허혈성심장질환수술비" 2000
  const COMBINE_RULES = [
    {
      targetName: '뇌혈관질환및허혈성심장질환수술비',
      sourceMatchers: [/뇌혈관.*수술/, /(허혈성)?심장(질환)?.*수술/],
      op: 'sumHalf'
    }
  ];
  COMBINE_RULES.forEach(rule => {
    const srcs = target.filter(t => {
      const nm = t.standardName || t.name || '';
      return rule.sourceMatchers.some(rx => rx.test(nm));
    });
    if (srcs.length >= 2) {  // 분리담보가 2개 이상 있을 때만 통합
      const sum = srcs.reduce((s, t) => s + (t.amount || 0), 0);
      const val = rule.op === 'sumHalf' ? Math.round(sum / 2) : sum;
      target = target.filter(t => !srcs.includes(t));
      target.push({
        name: rule.targetName,
        keys: candidateKeys(rule.targetName),
        standardName: rule.targetName,
        amount: val,
        rawAmount: String(val) + '만원',
        _combined: true
      });
      console.log(`[Toss Extractor] 🔗 통합담보 합산: ${srcs.map(t => `${t.standardName}(${t.amount||0})`).join(' + ')} = ${sum} ÷2 → "${rule.targetName}" ${val}만원`);
    }
  });

  // 🆕 "1-5종 수술비"(질병/상해 종수술) — 1종~5종 여러 건 중 '5종' 또는 최대 금액 1건만 입력.
  //   예: 질병1-5종수술비(1종~5종) → 5종(또는 최대 금액)만 mmlfcp '질병종수술' 칸에 입력.
  const _parse15 = (nm) => {
    const s = String(nm || '');
    // "1-5종수술" 패턴 + 끝의 "(N종)" 종번호
    if (!/1\s*[-~]\s*5\s*종\s*수술/.test(s)) return null;
    const jm = s.match(/\(?\s*([1-5])\s*종\s*\)?\s*$/) || s.match(/([1-5])\s*종/g);
    let jong = 0;
    const m2 = s.match(/\(\s*([1-5])\s*종\s*\)/);
    if (m2) jong = parseInt(m2[1]);
    // 그룹 기준명 = 종번호/괄호 제거
    const base = s.replace(/\(\s*[1-5]\s*종\s*\)/g, '').replace(/\s+/g, '');
    return { base, jong };
  };
  const _g15 = {};
  target.forEach(t => {
    const info = _parse15(t.name || t.standardName);
    if (info) {
      if (!_g15[info.base]) _g15[info.base] = [];
      _g15[info.base].push({ t, jong: info.jong });
    }
  });
  Object.keys(_g15).forEach(base => {
    const arr = _g15[base];
    if (arr.length < 2) return;
    // 5종 우선, 없으면 최대 금액
    let keep = arr.find(x => x.jong === 5);
    if (!keep) keep = arr.reduce((a, b) => ((b.t.amount || 0) > (a.t.amount || 0) ? b : a));
    const removeSet = new Set(arr.filter(x => x !== keep).map(x => x.t));
    target = target.filter(t => !removeSet.has(t));
    console.log(`[Toss Extractor] 🔢 1-5종 수술비 통합: ${arr.length}건 중 "${keep.t.name}"(${keep.jong ? keep.jong + '종' : '최대'} ${keep.t.amount || 0}만원)만 입력`);
  });

  // 🆕 질병종/상해종 수술비(1-5종 5종) — 유형별로 다른 칸에 입력:
  //   - 생손보(LF)/생보(L): "질병상해(1~5종)수술(5종기준)" 통합 칸 1개 (질병>상해→질병값 / 상해크면 (질병+상해)÷2)
  //   - 손보(F): "질병(1~5종)수술비 (5종기준)" / "상해(1~5종)수술비 (5종기준)" 각각 칸에 5종 금액 그대로
  (() => {
    const _insType = (payload.cfg && payload.cfg.insType) || '';
    const _isSonbo = (_insType === 'F');
    const _isSurg = (nm, kind) => {
      const s = String(nm || '');
      if (/뇌|심장|허혈/.test(s)) return false;       // 뇌·심장 통합 담보는 별도 처리됨 → 제외
      return new RegExp(kind + '[^]{0,4}수술').test(s);
    };
    // 질병/상해 수술 담보 중 110/200 이상(=종수술 인식)인 것들 중 최대 금액
    const jilCands = target.filter(t => _isSurg(t.standardName || t.name, '질병') && (t.amount || 0) >= 110);
    const sangCands = target.filter(t => _isSurg(t.standardName || t.name, '상해') && (t.amount || 0) >= 200);
    const jil = jilCands.length ? jilCands.reduce((a, b) => ((b.amount || 0) > (a.amount || 0) ? b : a)) : null;
    const sang = sangCands.length ? sangCands.reduce((a, b) => ((b.amount || 0) > (a.amount || 0) ? b : a)) : null;
    const jAmt = jil ? (jil.amount || 0) : 0;
    const sAmt = sang ? (sang.amount || 0) : 0;
    if (!jil && !sang) return;

    if (_isSonbo) {
      // 손보: 질병/상해 각각 칸
      if (jil) {
        const NM = '질병(1~5종)수술비 (5종기준)';
        target = target.filter(t => t !== jil);
        target.push({ name: NM, keys: candidateKeys(NM), standardName: NM, amount: jAmt, rawAmount: jAmt + '만원', _combined: true });
      }
      if (sang) {
        const NM = '상해(1~5종)수술비 (5종기준)';
        target = target.filter(t => t !== sang);
        target.push({ name: NM, keys: candidateKeys(NM), standardName: NM, amount: sAmt, rawAmount: sAmt + '만원', _combined: true });
      }
      console.log(`[Toss Extractor] 🔢 손보 — 질병종 ${jAmt}만→"질병(1~5종)수술비" / 상해종 ${sAmt}만→"상해(1~5종)수술비" 각각`);
    } else {
      // 생손보/생보: 통합 칸 1개
      const val = (jAmt > sAmt) ? jAmt : Math.round((jAmt + sAmt) / 2);
      target = target.filter(t => t !== jil && t !== sang);
      const NM = '질병상해(1~5종)수술(5종기준)';
      target.push({ name: NM, keys: candidateKeys(NM), standardName: NM, amount: val, rawAmount: val + '만원', _combined: true });
      console.log(`[Toss Extractor] 🔗 생손보/생보 통합: 질병 ${jAmt}만 / 상해 ${sAmt}만 → "${NM}" ${val}만원 (${jAmt > sAmt ? '질병값' : '평균값'})`);
    }
  })();

  // 🆕 매칭 제외 담보 — '주계약' 칸은 항상 비움(사용자 요청). 원본 '주계약' 담보 제거.
  const _excludeName = (nm) => /^주계약$/.test(String(nm || '').trim());
  const _beforeExclude = target.length;
  target = target.filter(t => {
    if (_excludeName(t.standardName) || _excludeName(t.name)) {
      console.log(`[Toss Extractor] ⏭️ 제외(주계약 칸 미사용): "${t.standardName || t.name}"`);
      return false;
    }
    return true;
  });
  if (_beforeExclude !== target.length) out.applied['제외'] = `주계약 ${_beforeExclude - target.length}건`;
  return target;
}

// ─────────────────────────────────────────────────────────────
// 만들어진 담보 목록을 실제 mmlfcp 폼에 체크·금액 입력한다.
// ─────────────────────────────────────────────────────────────
async function fillCoverageInputs(target, out) {
  const checks = document.querySelectorAll('input[type="checkbox"][data-cd], input[type="checkbox"][coverage_name], input[type="checkbox"][id^="chk_"]');

  // 🆕 플랜이 자동 체크해둔 '담보 체크박스'만 해제 — 깨끗한 상태에서 원하는 담보만 입력.
  //   ⚠️ 보험사명 위 체크박스(회사 선택 → 보험료 표시)는 절대 건드리지 않는다. 어떤 상태에서도 유지.
  //      checks 셀렉터(data-cd / coverage_name / id^=chk_)는 '담보' 체크박스만 매칭하므로 안전.
  //   (이전의 '전체선택 토글'은 보험사 체크박스까지 해제해 보험료가 0이 되던 버그 → 제거)
  let _uncheckedCnt = 0;
  Array.from(checks).forEach(cb => {
    // 🛡️ 담보 고유 속성(coverage_name/data-cd)이 있는 것만 해제 — 보험사 체크박스(이 속성 없음) 보호.
    //    (손보 페이지의 보험사 체크박스가 chk_ id 로 잡혀 함께 해제되던 버그 차단)
    const isDamboCb = cb.getAttribute('coverage_name') || cb.getAttribute('data-cd');
    if (cb.checked && isDamboCb) { cb.click(); _uncheckedCnt++; }
  });
  if (_uncheckedCnt > 0) {
    out.applied['기존체크 해제'] = `담보 ${_uncheckedCnt}개`;
    console.log(`[Toss Extractor] ☐ 담보 체크박스 ${_uncheckedCnt}개만 해제 (보험사 체크박스는 유지)`);
    await new Promise(r => setTimeout(r, 300));  // 해제 반영 대기
  }

  // 페이지의 모든 체크박스명을 미리 normalizeCoverageName 해두기
  //   🆕 mmlfcp '주계약' 체크박스도 후보에서 제외 — 다른 담보가 주계약 칸에 substring 오매칭되는 것 차단
  const checkInfo = Array.from(checks).map(cb => ({
    cb,
    cname: cb.getAttribute('coverage_name') || cb.value || '',
    cnameNorm: normalizeCoverageName(cb.getAttribute('coverage_name') || cb.value || '')
  })).filter(ci => (ci.cname || '').trim() !== '주계약');
  let matched = 0, amountsFilled = 0;
  const matchedNames = [];
  const unmatched = [];
  // 🆕 학습된 매핑 로드 — chrome.storage.sync 라 같은 Chrome 계정으로 로그인된 모든 컴퓨터에서 공유된다.
  //   구조: { [추출담보 표준명]: 폼담보 coverage_name }  ('__SKIP__' = 연결 안 함)
  const LEARN_KEY = 'tossCovMap_v1';
  const learnMap = await new Promise(res => {
    try { chrome.storage.sync.get(LEARN_KEY, d => res((d && d[LEARN_KEY]) || {})); }
    catch (e) { res({}); }
  });
  // 🆕 이미 매칭된 체크박스는 다른 담보가 재사용하지 못하도록 — 한 칸에 여러 담보 뭉침 방지
  const usedCbs = new Set();
  // 1단계: 완전일치를 전체 target 에 먼저 적용 (정확매칭 우선권 확보 → substring 과매칭이 정확매칭 칸 가로채기 방지)
  const pending = [];
  target.forEach(t => {
    // 0단계: 학습된 매핑 우선 — 사용자가 패널에서 지정한 폼 담보로 강제 연결한다.
    const _learned = learnMap[t.standardName] || learnMap[t.name];
    if (_learned) {
      if (_learned === '__SKIP__') { t._skip = true; return; }  // '연결 안 함' 지정
      const ci = checkInfo.find(c => !usedCbs.has(c.cb) && c.cname === _learned);
      if (ci) { usedCbs.add(ci.cb); t._found = ci; t._byLearn = true; return; }
    }
    let foundInfo = null;
    for (const key of t.keys) {
      foundInfo = checkInfo.find(ci => !usedCbs.has(ci.cb) && ci.cnameNorm === key);
      if (foundInfo) break;
    }
    if (foundInfo) { usedCbs.add(foundInfo.cb); t._found = foundInfo; }
    else pending.push(t);
  });
  // 2단계: 남은 담보는 substring 양방향 매칭 (이미 쓰인 체크박스 제외)
  pending.forEach(t => {
    let foundInfo = null;
    for (const key of t.keys) {
      if (key.length < 3) continue;
      foundInfo = checkInfo.find(ci => !usedCbs.has(ci.cb) && (
        ci.cnameNorm.includes(key) || (key.length >= ci.cnameNorm.length && key.includes(ci.cnameNorm) && ci.cnameNorm.length >= 3)
      ));
      if (foundInfo) break;
    }
    if (foundInfo) { usedCbs.add(foundInfo.cb); t._found = foundInfo; }
  });
  // 금액 input 찾기 헬퍼 (3단계 + 감시에서 공용)
  const _amtInputOf = (cb) => {
    const cd = cb.getAttribute('data-cd') || cb.id.replace(/^chk_/, '');
    return document.getElementById(`input_${cd}`)
      || document.querySelector(`input[data-cd="${cd}"][type="text"], input[data-cd="${cd}"][type="number"]`);
  };

  // 🆕 실제 키보드 타이핑 모방 — mmlfcp 금액칸은 키 입력 이벤트로만 내부 state 갱신/재계산됨.
  //   (setInputVal 네이티브 setter 로는 DOM value 만 바뀌고 화면/보험료 미반영. 수동 입력은 반영됨이 확인됨)
  //   focus → 기존값 전체삭제 → 숫자 한 글자씩 keydown/input/keyup → blur
  const typeAmount = (el, value) => {
    if (!el) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    el.focus();
    el.click();
    // 기존 값 전체선택 → 삭제
    try { el.setSelectionRange(0, (el.value || '').length); } catch (e) {}
    nativeSetter.call(el, '');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    // 한 글자씩 타이핑
    let cur = '';
    for (const ch of String(value)) {
      const kc = 48 + (Number(ch) || 0);
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ch, code: 'Digit' + ch, keyCode: kc, which: kc }));
      el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: ch, code: 'Digit' + ch, keyCode: kc, which: kc }));
      cur += ch;
      nativeSetter.call(el, cur);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch, code: 'Digit' + ch, keyCode: kc, which: kc }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    try { if (window.jQuery) window.jQuery(el).trigger('input').trigger('change').trigger('blur'); } catch (e) {}
  };

  // 3단계: 체크와 금액입력을 분리 — 체크할 때마다 mmlfcp 가 전체 재계산을 돌려 직전 입력 금액을
  //   리셋하므로(마지막 담보만 살아남는 증상), '모든 체크 먼저 → 안정대기 → 금액 일괄 입력' 순서로 처리.
  // 3-A: 매칭 담보 모두 체크
  let _newlyChecked = 0;
  for (const t of target) {
    if (t._found) {
      if (!t._found.cb.checked) { t._found.cb.click(); _newlyChecked++; }
    } else if (!t._skip) {
      unmatched.push(`${t.standardName} (원본: "${t.name}")`);
    }
  }
  if (_newlyChecked > 0) {
    console.log(`[Toss Extractor] ☑️ ${_newlyChecked}개 담보 체크 완료 — 재계산 안정 대기(1.8s)`);
    await new Promise(r => setTimeout(r, 1800));  // 체크 자동입력 + 재계산이 끝날 시간
  }
  // 3-B: 금액 일괄 입력 (체크는 이미 끝나 cb.click 재계산 없음) — 자동값 비우고 받아온 값 입력
  for (const t of target) {
    if (!t._found) continue;
    matched++;
    matchedNames.push({ from: (t.name || t.standardName), std: t.standardName, to: t._found.cname, amt: t.amount });
    if (t.amount != null) {
      const amountInput = _amtInputOf(t._found.cb);
      if (amountInput) {
        const cd = t._found.cb.getAttribute('data-cd') || t._found.cb.id.replace(/^chk_/, '');
        typeAmount(amountInput, String(t.amount));    // 실제 키보드 타이핑 모방 (자동 clear 포함)
        await new Promise(r => setTimeout(r, 120));
        amountsFilled++;
        console.log(`[Toss Extractor] 💰 ${t._found.cname} (mmlfcp) ← "${t.standardName}" 금액: ${t.amount}만원 (${cd}) [키보드 타이핑]`);
      }
    }
  }
  out.applied['담보'] = `${matched}/${target.length} 체크 (전체 ${checks.length})`;
  if (amountsFilled > 0) out.applied['담보 금액'] = `${amountsFilled}건 입력`;
  if (unmatched.length > 0) out.applied['미매칭 담보'] = unmatched.slice(0, 5).join(', ') + (unmatched.length > 5 ? ` 외 ${unmatched.length-5}개` : '');
  console.log('[Toss Extractor] ✅ 담보 체크:', matched, '/', target.length, '/ 금액:', amountsFilled);

  // 🆕 담보 매칭 확인·수정 패널 — 추출담보(전)가 비교폼의 어떤 담보(후)로 이어졌는지 보여주고,
  //   드롭다운으로 매칭을 바꾸면 chrome.storage.sync 에 학습되어 같은 계정의 모든 컴퓨터에서 동일 적용된다.
  (function _renderMatchPanel(){
    try {
      const oldP = document.getElementById('__toss_match_panel');
      if (oldP) oldP.remove();
      // 폼 담보 목록(중복 제거) — 재매핑 드롭다운 옵션
      const formCovs = [];
      const _seen = new Set();
      checkInfo.forEach(ci => { if (ci.cname && !_seen.has(ci.cname)) { _seen.add(ci.cname); formCovs.push(ci.cname); } });

      const p = document.createElement('div');
      p.id = '__toss_match_panel';
      p.style.cssText = 'position:fixed;top:60px;right:18px;width:440px;max-height:82vh;overflow:auto;background:#fff;border:2px solid #2563eb;border-radius:12px;box-shadow:0 10px 36px rgba(0,0,0,.22);z-index:2147483646;font-family:"Malgun Gothic",sans-serif;font-size:13px;';

      const head = document.createElement('div');
      head.style.cssText = 'background:#2563eb;color:#fff;padding:11px 14px;font-weight:700;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:1;';
      head.innerHTML = '<span>📋 담보 매칭 확인·수정&nbsp; <span style="font-weight:400;font-size:11px;opacity:.85;">추출(전) → 비교폼(후)</span></span>';
      const closeBtn = document.createElement('span');
      closeBtn.textContent = '×';
      closeBtn.style.cssText = 'cursor:pointer;font-size:20px;line-height:1;';
      closeBtn.addEventListener('click', () => p.remove());
      head.appendChild(closeBtn);
      p.appendChild(head);

      const tip = document.createElement('div');
      tip.style.cssText = 'padding:7px 14px;background:#f8fafc;color:#475569;font-size:11px;border-bottom:1px solid #e2e8f0;';
      tip.innerHTML = '💡 매칭이 틀리면 드롭다운에서 올바른 담보를 고르세요. 선택은 <b>자동 저장·동기화</b>되어 다음에도(다른 컴퓨터에서도) 그대로 적용됩니다.';
      p.appendChild(tip);

      const bodyEl = document.createElement('div');
      bodyEl.style.cssText = 'padding:6px 0;';
      p.appendChild(bodyEl);

      target.forEach(t => {
        const row = document.createElement('div');
        row.style.cssText = 'padding:8px 14px;border-bottom:1px solid #f1f5f9;';

        const top = document.createElement('div');
        top.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:5px;';
        const fromEl = document.createElement('span');
        fromEl.textContent = t.name || t.standardName;
        fromEl.style.cssText = 'color:#0f172a;font-weight:700;';
        const arrow = document.createElement('span');
        arrow.textContent = '→';
        arrow.style.cssText = 'color:#94a3b8;';
        top.appendChild(fromEl);
        top.appendChild(arrow);
        if (t.amount != null) {
          const amtEl = document.createElement('span');
          amtEl.textContent = t.amount + '만원';
          amtEl.style.cssText = 'margin-left:auto;background:#eff6ff;color:#1d4ed8;border-radius:6px;padding:1px 7px;font-size:11px;font-weight:700;';
          top.appendChild(amtEl);
        }
        row.appendChild(top);

        const sel = document.createElement('select');
        sel.style.cssText = 'width:100%;padding:5px 7px;border:1px solid #cbd5e1;border-radius:7px;font-size:12px;background:#fff;';
        const optNone = document.createElement('option');
        optNone.value = ''; optNone.textContent = '— 연결 안 함 —';
        sel.appendChild(optNone);
        formCovs.forEach(cn => {
          const o = document.createElement('option');
          o.value = cn; o.textContent = cn;
          if (t._found && t._found.cname === cn) o.selected = true;
          sel.appendChild(o);
        });
        if (!t._found) optNone.selected = true;
        row.appendChild(sel);

        const status = document.createElement('div');
        status.style.cssText = 'margin-top:4px;font-size:11px;';
        if (t._found) { status.textContent = t._byLearn ? '✅ 학습된 연결' : '✅ 자동 연결'; status.style.color = '#16a34a'; }
        else if (t._skip) { status.textContent = '⏭️ 연결 안 함(학습됨)'; status.style.color = '#94a3b8'; }
        else { status.textContent = '❌ 자동 연결 실패 — 직접 선택하세요'; status.style.color = '#ef4444'; }
        row.appendChild(status);

        sel.addEventListener('change', () => {
          const newCname = sel.value;
          // 학습 저장 (sync — 모든 컴퓨터 공유)
          learnMap[t.standardName] = newCname || '__SKIP__';
          try { chrome.storage.sync.set({ [LEARN_KEY]: learnMap }); } catch (e) {}
          // 이전 매칭 해제 (금액 비우고 체크 해제)
          if (t._found && t._found.cb) {
            try { const oi = _amtInputOf(t._found.cb); if (oi) typeAmount(oi, ''); } catch (e) {}
            if (t._found.cb.checked) t._found.cb.click();
          }
          // 새 매칭 적용 (체크 + 금액 입력)
          if (newCname) {
            const ci = checkInfo.find(c => c.cname === newCname);
            if (ci) {
              t._found = ci; t._skip = false;
              if (!ci.cb.checked) ci.cb.click();
              if (t.amount != null) {
                const inp = _amtInputOf(ci.cb);
                if (inp) setTimeout(() => { try { typeAmount(inp, String(t.amount)); } catch (e) {} }, 500);
              }
            }
            status.textContent = '✅ 변경 저장됨 — 다음에도 자동 적용'; status.style.color = '#16a34a';
          } else {
            t._found = null; t._skip = true;
            status.textContent = '⏭️ 연결 안 함(저장됨)'; status.style.color = '#94a3b8';
          }
        });

        bodyEl.appendChild(row);
      });

      document.body.appendChild(p);
    } catch (e) { console.warn('[Toss Extractor] 매칭 패널 표시 실패', e); }
  })();

  // 🆕 지속 감시 재입력 — mmlfcp 가 조회 직후 자동 재계산으로 금액을 '진단수술' 플랜 기본값으로
  //   되돌리는 현상 대응. 되돌림은 확장 완료보다 늦게(수 초 후) 일어남.
  //   (수동 입력은 유지되므로 = mmlfcp 는 100 을 허용. 되돌림 이벤트가 끝난 뒤의 '마지막' 입력이 살아남는다)
  //   → 어긋난 칸을 주기적으로 재입력하며 감시. 일정시간 되돌림이 멈추면(안정) 종료.
  //   (_amtInputOf 는 3단계에서 이미 정의됨)
  const _toCorrect = target.filter(t => t._found && t.amount != null);
  if (_toCorrect.length > 0) {
    const MAX_MS = 9000;     // 최대 감시 시간
    const STEP = 700;        // 점검 주기
    const STABLE_MS = 2800;  // 이 시간 동안 되돌림 없으면 안정으로 판단하고 종료
    const t0 = Date.now();
    let lastFix = Date.now(), totalFix = 0, rounds = 0;
    while (Date.now() - t0 < MAX_MS) {
      let fixed = 0;
      _toCorrect.forEach(t => {
        const inp = _amtInputOf(t._found.cb);
        if (!inp) return;
        const cur = String(inp.value || '').replace(/[^\d]/g, '');
        if (cur !== String(t.amount)) {
          if (!t._found.cb.checked) t._found.cb.click();
          typeAmount(inp, String(t.amount));
          fixed++;
        }
      });
      rounds++;
      if (fixed > 0) {
        lastFix = Date.now();
        totalFix += fixed;
        console.log(`[Toss Extractor] 🔁 감시 재입력(round ${rounds}): ${fixed}건 교정`);
      }
      if (Date.now() - lastFix >= STABLE_MS) break;  // 안정 → 종료
      await new Promise(r => setTimeout(r, STEP));
    }
    out.applied['금액 감시교정'] = `${totalFix}회 / ${rounds}라운드 / ${Math.round((Date.now() - t0) / 1000)}s`;
    // 🔍 최종 검증
    const finalReport = _toCorrect.map(t => {
      const inp = _amtInputOf(t._found.cb);
      const cur = String(inp?.value || '').replace(/[^\d]/g, '');
      return `${cur === String(t.amount) ? '✅' : '❌'} ${t.standardName}: 원함=${t.amount} 현재=${inp?.value}`;
    });
    console.log('[Toss Extractor] 🔍 최종 금액 검증:\n  ' + finalReport.join('\n  '));
    const stillWrong = _toCorrect.filter(t => {
      const inp = _amtInputOf(t._found.cb);
      return String(inp?.value || '').replace(/[^\d]/g, '') !== String(t.amount);
    });
    if (stillWrong.length > 0) {
      out.applied['⚠️미교정'] = stillWrong.map(t => `${t.standardName}(원함${t.amount})`).join(', ');
    }

    // 🛡️ 조회하기 버튼 금액 가드 — 사용자가 보험료 보려고 '조회하기'를 누르면 mmlfcp 가
    //   금액을 '진단수술' 플랜 기본값으로 리셋함. 조회 클릭을 감지해 재계산 후 금액을 자동 복원.
    //   (확장 메시지 핸들러가 끝나도 리스너는 페이지에 남아, 사용자가 조회를 누를 때마다 동작)
    try {
      let searchBtn = document.getElementById('btn_search');
      if (!searchBtn) {
        searchBtn = Array.from(document.querySelectorAll('button, a, input[type=button], input[type=submit]'))
          .find(el => /조회|검색/i.test((el.innerText || el.textContent || el.value || '').trim()));
      }
      if (searchBtn && !searchBtn._tossAmtGuard) {
        searchBtn._tossAmtGuard = true;
        const _guardTargets = _toCorrect.map(t => ({ cb: t._found.cb, amount: t.amount, name: t.standardName }));
        searchBtn.addEventListener('click', () => {
          let tries = 0;
          const restore = () => {
            let fixed = 0;
            _guardTargets.forEach(g => {
              const inp = _amtInputOf(g.cb);
              if (!inp) return;
              const cur = String(inp.value || '').replace(/[^\d]/g, '');
              if (cur !== String(g.amount)) {
                if (!g.cb.checked) g.cb.click();
                typeAmount(inp, String(g.amount));
                fixed++;
              }
            });
            if (fixed > 0) console.log(`[Toss Extractor] 🛡️ 조회 후 금액 복원: ${fixed}건`);
            if (++tries < 7) setTimeout(restore, 800);  // 재계산이 늦게 끝나도 잡도록 반복 점검
          };
          setTimeout(restore, 1500);  // 재조회 재계산이 끝난 뒤부터 복원 시작
        });
        console.log('[Toss Extractor] 🛡️ 조회하기 버튼 금액 가드 설치됨 — 이후 조회를 눌러도 금액이 유지됩니다');
      }
    } catch (e) { console.warn('[Toss Extractor] 금액 가드 설치 실패:', e); }
  }
}

// ─────────────────────────────────────────────────────────────
// 담보 체크 + 금액 입력. applyToPremiumFormUnified 본문에서 통째로 분리했다.
//   바깥 스코프에서 쓰는 값은 payload / cfg / out 세 개뿐이라 인자로 받는다.
// ─────────────────────────────────────────────────────────────
async function applyCoverageSection(payload, cfg, out) {
  const target = buildCoverageTargets(payload, cfg, out);
  if (target.length > 0) await fillCoverageInputs(target, out);
}
