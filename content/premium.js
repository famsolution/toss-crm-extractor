// ╔══════════════════════════════════════════════════════════════════╗
// ║ 📊 보험료 비교 추출 — 한장으로 보는 보험료 비교 페이지(mmlfcp)        ║
// ║   - 보험사: #companyInfo li 들 (코드/이름/총보험료/상품명/플랜)        ║
// ║   - 담보:   #bojang_lists li 들 (cd, 이름, guide_coverage_amount)    ║
// ║   - 보험료: #premium_lists em 들 (company×coverage premium 그리드)    ║
// ╚══════════════════════════════════════════════════════════════════╝
function extractPremiumComparison() {
  const result = { type: 'premium_compare', extractedAt: new Date().toISOString(), companies: [], coverages: [], form: {} };

  // 🆕 mmlfcp 폼 정보 추출 (이름/생년월일/성별/생손보 유형/상품 유형/만기)
  try {
    const formIds = ['cust_name', 'birth_date', 'gender', 'selInsuranceType', 'selProductsGroupCD', 'selPaymentExpirationCD'];
    formIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        result.form[id] = el.value || '';
        // select 의 경우 선택된 텍스트도 같이 보관 (디스플레이 호환)
        if (el.tagName === 'SELECT' && el.selectedIndex >= 0) {
          result.form[id + '_text'] = el.options[el.selectedIndex].textContent.trim();
        }
      }
    });
    // 보험나이 — span#insur_age 텍스트
    const ageSpan = document.getElementById('insur_age');
    if (ageSpan) result.form.insur_age_label = ageSpan.textContent.trim();
    console.log('[Toss Extractor] mmlfcp form 추출:', result.form);
  } catch (e) {
    console.warn('[Toss Extractor] form 추출 실패:', e);
  }

  // ── 보험사 카드 ──
  document.querySelectorAll('#companyInfo li').forEach(li => {
    const chk = li.querySelector('input[type="checkbox"][company_code]');
    if (!chk) return;
    const code = chk.getAttribute('company_code');
    const name = chk.getAttribute('company_name') || '';
    const totalEl = li.querySelector(`#total_${code}`);
    const total  = totalEl ? (parseInt(totalEl.getAttribute('total_premium') || (totalEl.textContent || '').replace(/[^0-9]/g, ''), 10) || 0) : 0;
    const alertBox = li.querySelector('.alert__product-info');
    let productName = '', planInfo = '';
    if (alertBox) {
      const topStrong  = alertBox.querySelector('.alert__top strong');
      const botStrongs = alertBox.querySelectorAll('.alert__bottom strong');
      productName = topStrong ? topStrong.textContent.trim() : '';
      planInfo    = botStrongs[0] ? botStrongs[0].textContent.trim() : '';
    }
    const img = li.querySelector('.img-area img');
    result.companies.push({ code, name, total, productName, planInfo, logoAlt: img ? (img.alt || '') : '' });
  });

  // ── 담보 항목 ──
  document.querySelectorAll('#bojang_lists li').forEach(li => {
    const chk = li.querySelector('input[type="checkbox"][data-cd]');
    if (!chk) return;
    const cd = chk.getAttribute('data-cd');
    const name = chk.getAttribute('coverage_name') || (li.querySelector('label') ? li.querySelector('label').textContent.trim() : '');
    const guide = parseInt(chk.getAttribute('guide_coverage_amount') || '0', 10);
    const valInput = li.querySelector(`#input_${cd}`);
    const value = valInput ? (parseInt(String(valInput.value || '0').replace(/[^0-9]/g, ''), 10) || 0) : 0;
    result.coverages.push({ cd, name, guideAmount: guide, currentValue: value, premiums: {} });
  });

  // ── 보험료 그리드 (회사×담보) ──
  const covIndex = {};
  result.coverages.forEach((c, i) => { covIndex[c.cd] = i; });
  document.querySelectorAll('#premium_lists em[coverage_cd][company_code]').forEach(em => {
    const cd = em.getAttribute('coverage_cd');
    const co = em.getAttribute('company_code');
    const pr = parseInt(em.getAttribute('premium') || '0', 10) || 0;
    const idx = covIndex[cd];
    if (idx != null && co) result.coverages[idx].premiums[co] = pr;
  });

  return result;
}

// 🆕 한장으로 보는 보험료 비교 페이지 폼에 설정 자동 입력 (생손보/상품/만기/담보)
//   cfg = { insType, prodType, maturity, coverages: ['암진단비(유사암제외)', ...] }
function applyConfigToPremiumPage(cfg) {
  const result = { ok: true, applied: {} };
  if (!cfg) return result;
  // ── 생손보 유형 ──
  if (cfg.insType) {
    const el = document.getElementById('selInsuranceType');
    if (el) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(el, cfg.insType);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      result.applied['생손보 유형'] = cfg.insType;
    }
  }
  // ── 상품 유형 ──
  if (cfg.prodType) {
    const el = document.getElementById('selProductsGroupCD');
    if (el) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(el, cfg.prodType);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      result.applied['상품 유형'] = cfg.prodType;
    }
  }
  // ── 만기 ──
  if (cfg.maturity) {
    const el = document.getElementById('selPaymentExpirationCD');
    if (el) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(el, cfg.maturity);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      result.applied['만기'] = cfg.maturity;
    }
  }
  // ── 담보 체크박스 자동 선택 ──
  //   페이지의 모든 coverage 체크박스 검사 → coverage_name 이 cfg.coverages 와 일치하면 check
  if (Array.isArray(cfg.coverages) && cfg.coverages.length > 0) {
    const wanted = new Set(cfg.coverages.map(s => String(s || '').replace(/\s+/g, '').trim()));
    const checks = document.querySelectorAll('input[type="checkbox"][data-cd], input[type="checkbox"][coverage_name]');
    let matched = 0;
    checks.forEach(cb => {
      const name = cb.getAttribute('coverage_name') || cb.value || '';
      const norm = String(name).replace(/\s+/g, '').trim();
      if (wanted.has(norm)) {
        if (!cb.checked) cb.click();   // click 으로 click 이벤트도 발화
        matched++;
      }
    });
    result.applied['담보'] = `${matched}/${cfg.coverages.length} 선택됨`;
  }
  console.log('[Toss Extractor] 보험료 비교 페이지 설정 적용:', result);
  return result;
}
window.__applyConfigToPremiumPage = applyConfigToPremiumPage;

// 🆕 한장으로 보는 보험료 비교 페이지 폼에 고객 정보 자동 입력
//   타깃 셀렉터: #cust_name(이름) / #birth_date(YYYYMMDD) / #gender(M/F)
//   사용자가 보험료 비교 페이지로 이동한 뒤 확장프로그램 적용 버튼 → 이 함수 호출
function applyCustomerToPremiumPage(customer) {
  if (!customer) return { ok: false, error: 'customer 없음' };
  const result = { ok: true, filled: {} };
  // ── 이름 ──
  const nameEl = document.getElementById('cust_name');
  const name = customer['고객명'] || customer['_고객명'];
  if (nameEl && name) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(nameEl, name);
    nameEl.dispatchEvent(new Event('input', { bubbles: true }));
    nameEl.dispatchEvent(new Event('change', { bubbles: true }));
    result.filled['이름'] = name;
  }
  // ── 생년월일 (YYYYMMDD 8자리) ──
  const birthEl = document.getElementById('birth_date');
  let birthRaw = customer['생년월일'] || '';
  if (birthEl && birthRaw) {
    // 다양한 입력 포맷 정규화: "1985-01-01", "1985.01.01", "850101", "1985년 1월 1일" 등
    let digits = String(birthRaw).replace(/[^\d]/g, '');
    if (digits.length === 6) {
      // YY → YYYY 보정 (24 이하면 20XX, 그 외 19XX)
      const yy = parseInt(digits.slice(0, 2), 10);
      const yyyy = yy <= 24 ? 2000 + yy : 1900 + yy;
      digits = `${yyyy}${digits.slice(2)}`;
    }
    if (digits.length === 8) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(birthEl, digits);
      birthEl.dispatchEvent(new Event('input', { bubbles: true }));
      birthEl.dispatchEvent(new Event('change', { bubbles: true }));
      result.filled['생년월일'] = digits;
    } else {
      result.filled['생년월일'] = `(스킵: 형식 변환 실패, ${birthRaw})`;
    }
  }
  // ── 성별 ──
  const genderEl = document.getElementById('gender');
  const gender = customer['성별'] || '';
  if (genderEl && gender) {
    // "남성"/"남"/"M"/"male" → M, "여성"/"여"/"F"/"female" → F
    const isMale = /남|^M$|male/i.test(String(gender));
    const isFemale = /여|^F$|female/i.test(String(gender));
    const code = isMale ? 'M' : (isFemale ? 'F' : '');
    if (code) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(genderEl, code);
      genderEl.dispatchEvent(new Event('change', { bubbles: true }));
      result.filled['성별'] = `${gender} (${code})`;
    }
  }
  console.log('[Toss Extractor] 보험료 비교 페이지 폼 자동 입력:', result);
  return result;
}
// 전역 노출 — popup.js 가 chrome.scripting.executeScript 로 호출
window.__applyCustomerToPremiumPage = applyCustomerToPremiumPage;

