function getAllCellValues(ariaLabel) {
  const cells = document.querySelectorAll(`td[aria-label="${ariaLabel}"] [data-tds-desktop-table-primitive-cell-content]`);
  return Array.from(cells).map(c => c.innerText.trim()).filter(v => v.length > 0);
}

// 마스킹된 값인지 판별 (* 가 2개 이상 포함)
function isMasked(value) {
  return typeof value === 'string' && /\*{2,}/.test(value);
}

// 여러 셀 값 중 최적값 선택
// - preferMasked: true면 마스킹된 값을 우선 (API로 복원할 대상)
// - 그 다음 길이 긴 값
function pickBestValue(values, { preferMasked = false } = {}) {
  if (!values || values.length === 0) return '';
  if (preferMasked) {
    const masked = values.find(v => isMasked(v));
    if (masked) return masked;
  }
  return values.reduce((best, cur) => (cur.length > best.length ? cur : best), values[0]);
}

function getCellValue(ariaLabel, opts) {
  return pickBestValue(getAllCellValues(ariaLabel), opts);
}

// 직업 코드 → 한글 매핑 (토스인슈 enum)
const JOB_LABELS = {
  OFFICE_WORKER: '직장인', PROFESSIONAL: '전문직', PUBLIC_OFFICER: '공무원',
  SELF_EMPLOYED: '자영업자', FREELANCE: '프리랜서', HOUSEKEEPER: '주부',
  STUDENT: '학생', UNEMPLOYED: '무직'
};
const DRIVING_LABELS = { NONE: '미운전', PERSONAL: '개인용', BUSINESS: '업무용' };
const CARRIER_LABELS = {
  SKT: 'SKT', KT: 'KT', LGU: 'LG U+',
  SK_MVNO: 'SKT 알뜰폰', KT_MVNO: 'KT 알뜰폰', LG_MVNO: 'LG 알뜰폰'
};

