function _maskCoverageExcelText(v) {
  let s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  s = s.replace(/\b(\d{6})-?\d{7}\b/g, '$1-*******');
  s = s.replace(/\b01[016789]-?\d{3,4}-?\d{4}\b/g, '010-****-****');
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, '***@***');
  return s;
}

function _normCoverageExcelText(v) {
  return String(v || '').replace(/\s+/g, '').toLowerCase();
}

function _coverageExcelPremiumDigits(v) {
  return String(v == null ? '' : v).replace(/[^\d]/g, '');
}

function _findInsuranceForCoverageSection(sec, insurances, fallbackIdx) {
  const list = Array.isArray(insurances) ? insurances : [];
  const sCompany = _normCoverageExcelText(sec && sec.보험사명);
  const sName = _normCoverageExcelText(sec && sec.상품명);
  const sPrem = _coverageExcelPremiumDigits(sec && sec.월납보험료);
  const sDate = String((sec && sec.보장시작일) || '').slice(0, 7);

  const scored = list.map((ins, idx) => {
    const iCompany = _normCoverageExcelText(ins && ins['보험사명']);
    const iName = _normCoverageExcelText(ins && ins['보험명']);
    const iPrem = _coverageExcelPremiumDigits(ins && (ins['월납보험료'] || ins['총보험료']));
    const iDate = String((ins && ins['계약일']) || '').slice(0, 7);
    let score = 0;
    if (sCompany && iCompany && (sCompany === iCompany || sCompany.includes(iCompany) || iCompany.includes(sCompany))) score += 5;
    if (sName && iName && (sName === iName || sName.includes(iName) || iName.includes(sName))) score += 8;
    if (sPrem && iPrem && sPrem === iPrem) score += 3;
    if (sDate && iDate && sDate === iDate) score += 3;
    return { ins, idx, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

  if (scored.length) return scored[0].ins;
  return list[fallbackIdx] || {};
}

function normalizeCoverageRowsForExcel(details, productSummary, insurances) {
  const rows = Array.isArray(details) ? details : [];
  const summary = Array.isArray(productSummary) ? productSummary : [];
  const secByNo = {};
  summary.forEach((sec, i) => {
    if (!sec) return;
    secByNo[sec.섹션번호] = sec;
    sec._excelFallbackIdx = i;
  });

  const insBySection = {};
  summary.forEach((sec, i) => {
    if (!sec) return;
    insBySection[sec.섹션번호] = _findInsuranceForCoverageSection(sec, insurances, i);
  });

  const normalized = [];
  rows.forEach((r, idx) => {
    const sec = secByNo[r._섹션번호] || {};
    const ins = insBySection[r._섹션번호] || _findInsuranceForCoverageSection(sec, insurances, Math.max(0, (r._섹션번호 || 1) - 1));
    const insurer = _maskCoverageExcelText(r._보험사명 || sec.보험사명 || ins['보험사명'] || '');
    const productName = _maskCoverageExcelText(r._상품명 || sec.상품명 || ins['보험명'] || '');
    const productCategory = _maskCoverageExcelText([ins['대분류'], ins['소분류']].filter(Boolean).join(' / '));
    const tabType = _maskCoverageExcelText(r._tabType || '');
    const coverageName = _maskCoverageExcelText(r['보장명'] || r['보장 소분류'] || '');
    const descParts = [r['보장 대분류'], r['보장 소분류']]
      .map(_maskCoverageExcelText)
      .filter(Boolean)
      .filter(v => v !== coverageName);
    const insurancePeriod = _maskCoverageExcelText(
      (r['보장시작일'] || r['보장종료일'])
        ? [r['보장시작일'], r['보장종료일']].filter(Boolean).join(' ~ ')
        : (ins['보장만기/만기연령'] || '')
    );

    if (!coverageName && !r['보장 금액']) return;
    normalized.push({
      insurer,
      productName,
      productType: productCategory || tabType,
      coverageName,
      coverageDescription: descParts.join(' > '),
      coverageAmount: _maskCoverageExcelText(r['보장 금액'] || ''),
      insurancePeriod,
      paymentPeriod: _maskCoverageExcelText(r['납입기간'] || ins['납입주기/납입기간'] || ''),
      premium: _maskCoverageExcelText(ins['월납보험료'] || sec.월납보험료 || ins['총보험료'] || ''),
      renewalType: _maskCoverageExcelText(ins['갱신 유무'] || ins['갱신유무'] || ''),
      memo: _maskCoverageExcelText(ins['매니저 코멘트'] || ins['매니저 의견'] || ''),
      sourceOrder: idx + 1
    });
  });
  return normalized;
}

// 🆕 [보장/특약 중복 제거 키] 담보는 보장·특약 중 한 곳에만 속한다. 특약 pass 결과 중
//   보장 pass 와 동일한 행(탭 전환 실패·같은 표 재수집)을 걸러내기 위한 키.
//   ⚠️ _섹션번호(= 담보표 순번)는 pass 마다 표 개수가 달라져 어긋나므로 쓰지 않는다.
//      pass 사이에서 안정적인 _accordionIdx(DOM accordion 순서)를 기준으로 한다.
function _coverageDupKey(r) {
  const acc = (r._accordionIdx != null && r._accordionIdx >= 0) ? `A${r._accordionIdx}` : `S${r._섹션번호}`;
  return [acc, r['보장명'] || '', r['보장 금액'] || '', r['보장 대분류'] || '', r['보장 소분류'] || ''].join('::');
}

async function extractCoverageExcelRowsFromPage() {
  const pageType = detectPageType();
  if (pageType !== 'coverage') {
    return { ok: false, error: 'not_coverage_page', rows: [] };
  }
  const expandInfo = await expandAllAccordions();

  await switchAllTabsTo('보장');
  const mainDetails = extractCoverageDetails();
  mainDetails.rows.forEach(r => { r._tabType = '보장'; });

  const switchedRider = await switchAllTabsTo('특약');
  console.log(`[Toss Extractor] Excel switchAllTabsTo('특약') → ${switchedRider}회 클릭됨`);
  await new Promise(r => setTimeout(r, 600));
  const riderDetails = extractCoverageDetails();
  const mainKeys = new Set(mainDetails.rows.map(_coverageDupKey));
  const _beforeDedupX = riderDetails.rows.length;
  let riderRows = riderDetails.rows.filter(r => !mainKeys.has(_coverageDupKey(r)));
  console.log(`[Toss Extractor] Excel 특약 추출: ${_beforeDedupX}건 → 중복 제외 후 ${riderRows.length}건`);
  riderRows.forEach(r => { r._tabType = '특약'; });
  await switchAllTabsTo('보장');

  const details = {
    rows: [...mainDetails.rows, ...riderRows],
    summary: mainDetails.summary
  };
  details.summary.forEach(sec => {
    sec.담보수 = details.rows.filter(r => r._섹션번호 === sec.섹션번호).length;
  });

  let insurances = extractInsuranceData();
  insurances = insurances.filter(ins => {
    const status = (ins['계약상태'] || '').trim();
    const payStatus = (ins['납입 여부'] || '').trim();
    const note = (ins['매니저 코멘트'] || '').trim();
    const combined = `${payStatus} ${note}`;
    if (['만기', '소멸', '해지', '실효'].includes(status) && /해외여행|단기|여행자/.test(combined)) return false;
    if (note === '해외여행보험' && status !== '정상') return false;
    return true;
  });
  const matchedNames = matchInsuranceNamesFromAccordion(insurances, details.summary);
  const rows = normalizeCoverageRowsForExcel(details.rows, details.summary, insurances);
  console.log('[Toss Extractor] 보장분석 엑셀용 정규화 완료:', {
    rows: rows.length,
    productSummary: details.summary.length,
    insurances: insurances.length,
    matchedNames,
    expandInfo
  });
  return {
    ok: rows.length > 0,
    rows,
    meta: {
      url: window.location.href,
      extractedAt: new Date().toISOString(),
      productCount: details.summary.length,
      coverageCount: rows.length,
      matchedNames,
      expandInfo
    }
  };
}

function detectPageType() {
  const url = window.location.href;
  if (url.includes('/customers/')) return 'customer';
  if (url.includes('/cover/')) return 'coverage';
  // 🆕 "한장으로 보는 보험료 비교" 페이지 — ohmymanager.com 또는 #companyInfo+#bojang_lists 존재
  if (url.includes('ohmymanager.com') || (document.getElementById('companyInfo') && document.getElementById('bojang_lists'))) {
    return 'premium_compare';
  }
  return 'unknown';
}

