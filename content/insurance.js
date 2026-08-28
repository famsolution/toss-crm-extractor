function extractInsuranceData() {
  // 1) 메인 보험 비교 테이블 찾기 — 여러 selector 시도 (toss UI 변경 대응)
  let tbody = document.querySelector('tbody[data-tds-desktop-table-body]');
  if (!tbody) {
    const firstInsCell = document.querySelector('td.insurance-table-cell');
    if (firstInsCell) tbody = firstInsCell.closest('tbody');
  }

  // 2) tbody가 없어도 fallback — 페이지 전체에서 알려진 헤더를 가진 <tr> 찾기
  const trRows = tbody
    ? tbody.querySelectorAll('tr')
    : document.querySelectorAll('tr');

  const dataMatrix = [];
  let referenceTable = null;

  trRows.forEach(tr => {
    const th = tr.querySelector('th');
    if (!th) return;
    // 헤더 텍스트 추출 (다양한 셀 구조 대응)
    const headerEl =
      th.querySelector('[data-tds-desktop-table-h-cell-children-container]') ||
      th;
    const headerText = (headerEl.innerText || '').trim().split('\n')[0].trim();
    // 진단: 처리되는 모든 헤더 출력 (한 번만)
    if (!window.__tossDebugSeenHeaders) window.__tossDebugSeenHeaders = new Set();
    if (!window.__tossDebugSeenHeaders.has(headerText)) {
      window.__tossDebugSeenHeaders.add(headerText);
      console.log('[Toss Ext] row header 감지:', JSON.stringify(headerText), '(길이:', headerText.length, ')', '- 매칭:', INSURANCE_ROW_HEADERS.has(headerText) ? '✓' : '✗');
    }
    if (!INSURANCE_ROW_HEADERS.has(headerText)) return;
    // 헤더 alias 적용 (예: "보험 개수" → "보험명")
    const effectiveHeader = ROW_HEADER_ALIAS[headerText] || headerText;

    // 같은 테이블의 행들만 처리 (다른 테이블의 동명 헤더 혼합 방지)
    const parentTable = tr.closest('table');
    if (!referenceTable) referenceTable = parentTable;
    if (parentTable !== referenceTable) return;

    // 데이터 셀 추출 (insurance-table-cell 또는 일반 td)
    const dataCells = tr.querySelectorAll(
      'td.insurance-table-cell, td[aria-label]'
    );
    const cells = dataCells.length > 0 ? dataCells : tr.querySelectorAll('td');
    if (cells.length === 0) return;

    const rowData = { header: effectiveHeader, values: [], titles: [], cells: [] };
    cells.forEach(cell => {
      rowData.cells.push(cell);
      const content =
        cell.querySelector('[data-tds-desktop-table-primitive-cell-content]') ||
        cell;
      let text = (content.innerText || '').trim().replace(/\s+/g, ' ');

      // 편집 가능한 셀: input/textarea의 value 우선
      const input = cell.querySelector('input[type="text"], textarea');
      if (input && input.value && input.value.trim()) {
        text = input.value.trim();
      }

      // 🆕 보험료 금액 행(월납/기납/잔여/총) — innerText 가 비었거나 "-" 인 경우,
      //   같은 셀의 textContent 에서 "N 원"/콤마숫자만 보수적으로 복원 (숨은 span 등).
      //   ※ 위험한 광범위 추측은 하지 않음 — 못 채운 일시납 월납은 아래 컬럼 교차채움이 처리.
      const _AMOUNT_HEADERS = new Set(['월납보험료', '기납보험료', '잔여보험료', '총보험료']);
      if (_AMOUNT_HEADERS.has(effectiveHeader) && !/\d/.test(text)) {
        const raw = String((content && content.textContent) || cell.textContent || '').replace(/\s+/g, ' ').trim();
        const m = raw.match(/(-?[\d,]{2,})\s*원/) || raw.match(/-?[\d]{1,3}(?:,[\d]{3})+/);
        if (m) text = (m[1] || m[0]).trim();
      }

      // title 속성 추출 (셀 자체 → 자식 요소 순)
      let title = cell.getAttribute('title') || '';
      if (!title) {
        const titledEl = cell.querySelector('[title]:not([title=""])');
        if (titledEl) title = titledEl.getAttribute('title') || '';
      }

      // placeholder("보험명 없음") 셀: title에 실제 값이 있으면 사용
      if ((text === '보험명 없음' || !text) && title && title !== '보험명 없음') {
        text = title;
      }

      // 추가 fallback: 셀 내부의 <span>들에서 실제 상품명 탐색
      // 토스 CRM 일부 셀은 placeholder를 표시하면서 실제 값을 내부 span에 보관 (숨겨진 경우 포함)
      // 예: <span class="pc22-1e3yv2i0 css-...">프로미카개인용</span>
      const STATUS_TOKENS = new Set([
        '정상', '만기', '소멸', '해지', '실효',
        '납입중', '납입종료', '미가입', '해외여행보험',
        '갱신', '비갱신', '비갱신형', '갱신형', '갱신형 보험', '갱신형 특약',
        '본인', '-', '보험명 없음', ''
      ]);
      const isValidProductName = (t) => {
        if (!t || STATUS_TOKENS.has(t)) return false;
        if (t.length < 3) return false;
        if (!/[가-힣A-Za-z]/.test(t)) return false;
        if (/^\d{4}-\d{2}-\d{2}/.test(t)) return false;
        if (/^\d+[\s,]*원/.test(t)) return false;
        return true;
      };

      // 항상 내부 자식 요소를 검사해 더 좋은 상품명 후보 찾기 (보험명 셀 전용)
      // effectiveHeader 사용 — "보험 개수" → "보험명" alias 적용된 결과
      if (effectiveHeader === '보험명') {
        let bestCandidate = '';
        const fullCellText = (cell.textContent || '').trim().replace(/\s+/g, ' ');
        // 모든 자식 요소 (leaf only) 검사
        const allChildren = cell.querySelectorAll('*');
        const candidateList = [];
        for (const el of allChildren) {
          if (el.children.length > 0) continue;
          const elText = (el.textContent || '').trim().replace(/\s+/g, ' ');
          candidateList.push({ tag: el.tagName, text: elText.substring(0, 80) });
          if (!isValidProductName(elText)) continue;
          if (elText.length > bestCandidate.length) {
            bestCandidate = elText;
          }
        }
        // textContent에서 placeholder 제거 후 시도
        if (!bestCandidate && fullCellText) {
          const cleaned = fullCellText.replace(/보험명 없음/g, '').trim();
          if (isValidProductName(cleaned)) bestCandidate = cleaned;
        }
        // 진단 로그 — 항상 출력 (cellIndex로 어떤 컬럼인지 추적)
        console.log('[Toss Ext] 보험명 셀', {
          colIdx: rowData.values.length,
          innerText: text,
          textContent: fullCellText.substring(0, 150),
          title: title,
          cellHTML: cell.outerHTML.substring(0, 400),
          leafChildren: candidateList,
          bestCandidate
        });
        // 더 나은 후보가 있으면 교체 (단, 기존 text가 valid 한 경우에만 비교)
        if (bestCandidate && (!isValidProductName(text) || text === '보험명 없음' || bestCandidate.length > text.length)) {
          text = bestCandidate;
        }
      }

      rowData.values.push(text);
      rowData.titles.push(title);
    });
    dataMatrix.push(rowData);
  });

  if (dataMatrix.length === 0) return [];

  // 🆕 thead에서 상품명 추출 — 토스 CRM 업데이트로 "보험명"이 body row가 아닌 thead로 이동
  //   각 insurance column의 thead 셀에 상품명이 있음 (보통 span.pc22-1e3yv2i0 안)
  const productNamesFromThead = [];
  {
    const table = (tbody && tbody.closest('table')) ||
                  document.querySelector('table:has(td.insurance-table-cell)') ||
                  document.querySelector('table:has(td[aria-label])');
    if (table) {
      const thead = table.querySelector('thead');
      if (thead) {
        const headerCells = thead.querySelectorAll('th, td');
        const STATUS_TOKENS = new Set([
          '정상', '만기', '소멸', '해지', '실효', '납입중', '납입종료',
          '미가입', '해외여행보험', '갱신', '비갱신', '비갱신형', '갱신형',
          '본인', '-', '보험명 없음', '보험 개수', ''
        ]);
        const isValidProductName = (t) => {
          if (!t || STATUS_TOKENS.has(t)) return false;
          if (t.length < 3) return false;
          if (!/[가-힣A-Za-z]/.test(t)) return false;
          if (/^\d{4}-\d{2}-\d{2}/.test(t)) return false;
          if (/^\d+[\s,]*원/.test(t)) return false;
          return true;
        };
        headerCells.forEach((hc, idx) => {
          // 모든 leaf 자식 요소 textContent 검사
          let best = '';
          const leafs = hc.querySelectorAll('*');
          for (const el of leafs) {
            if (el.children.length > 0) continue;
            const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
            if (isValidProductName(t) && t.length > best.length) best = t;
          }
          if (best) productNamesFromThead.push(best);
        });
        console.log('[Toss Ext] thead에서 추출한 상품명들:', productNamesFromThead);
      }
    }
  }

  const numInsurances = dataMatrix[0].values.length;
  // 🆕 1차: 컬럼(보험상품)별 가시성 판정.
  //   토스 보장분석 페이지에서 '보험상품 선택'으로 일부만 고르면 미선택 상품 컬럼이 hidden 처리된다.
  const _hiddenCol = [];
  let _visibleCount = 0;
  for (let i = 0; i < numInsurances; i++) {
    let hiddenCount = 0, totalChecked = 0;
    for (const row of dataMatrix) {
      const cell = row.cells && row.cells[i];
      if (!cell) continue;
      totalChecked++;
      const style = window.getComputedStyle(cell);
      if (style.display === 'none' || style.visibility === 'hidden' ||
          cell.hidden || cell.offsetWidth === 0 || cell.offsetHeight === 0) {
        hiddenCount++;
      }
    }
    // 절반 이상의 셀이 숨겨져 있으면 이 컬럼은 토스 페이지에서 가려진(미선택) 것
    _hiddenCol[i] = (totalChecked > 0 && hiddenCount > totalChecked / 2);
    if (!_hiddenCol[i]) _visibleCount++;
  }
  // 🆕 선택 규칙: 일부만 선택 → 그 상품만 / 아무것도 선택 안 함(전부 숨김) 또는 전부 선택 → 전체 상품 전달.
  const _useAllCols = (_visibleCount === 0);
  if (_useAllCols) console.log('[Toss Extractor] 선택된 보험상품 없음(전부 숨김) → 전체 상품 전달');

  const insurances = [];
  for (let i = 0; i < numInsurances; i++) {
    if (!_useAllCols && _hiddenCol[i]) {
      console.log(`[Toss Extractor] 미선택(숨김) 컬럼 #${i + 1} 제외`);
      continue;
    }

    const insurance = {};
    dataMatrix.forEach(row => {
      if (row.values[i]) insurance[row.header] = row.values[i];
      // 보험명 행의 title 속성에서 잘리지 않은 전체 상품명 추출
      if (row.header === '보험명' && row.titles[i]) {
        insurance['보험명'] = row.titles[i];
      }
    });
    // 🆕 thead에서 추출한 상품명을 보험명으로 설정 (보험명이 비어있는 경우)
    // thead의 column 인덱스는 보통 데이터 셀의 인덱스와 매칭됨 (단, 첫 sticky cell offset 고려)
    if (!insurance['보험명'] || insurance['보험명'] === '보험명 없음') {
      // thead 셀 개수가 데이터 컬럼보다 1개 많으면 (sticky empty cell 포함) +1 offset
      const theadOffset = productNamesFromThead.length > numInsurances ? 1 : 0;
      const theadName = productNamesFromThead[i + theadOffset];
      if (theadName) {
        insurance['보험명'] = theadName;
      }
    }
    if (Object.keys(insurance).length > 0) insurances.push(insurance);
  }

  // 🆕 일시납(또는 월납이 비어있는) 상품의 월납보험료 보정 — 결정적 규칙:
  //   납입주기가 "일시납" 이면 월납 = 총보험료(없으면 기납)와 동일하다.
  //   월납 셀이 비거나 "-" 인데 총/기납에 값이 있으면 그 값으로 채운다.
  const _digits = (v) => String(v == null ? '' : v).replace(/[^\d]/g, '');
  insurances.forEach(ins => {
    const cycle = String(ins['납입주기/납입기간'] || ins['납입주기'] || '');
    const isLump = /일시납/.test(cycle);
    const m = _digits(ins['월납보험료']);
    const total = _digits(ins['총보험료']);
    const paid  = _digits(ins['기납보험료']);
    const fill = total || paid;
    if (!fill) return;
    if (!m) {
      // 월납이 비어있으면 총/기납으로 채움
      ins['월납보험료'] = Number(fill).toLocaleString();
    } else if (isLump && m !== fill && total) {
      // 🆕 일시납인데 월납이 총보험료와 다르면(숨은 담보금 등 오추출) 총보험료로 교정
      ins['월납보험료'] = Number(total).toLocaleString();
    }
  });

  return insurances;
}

// 상품-accordion 헤더 텍스트에서 보험사명/상품명 분리
function extractProductInfoFromAccordion(accordion) {
  if (!accordion) return { company: '', product: '', headerText: '' };
  const header = accordion.querySelector(
    '.p-accordion__item-header, [class*="accordion__item-header"]'
  );
  if (!header) return { company: '', product: '', headerText: '' };

  // 헤더 전체 텍스트를 줄 단위로 분리 (DOM 구조와 무관하게 신뢰성 ↑)
  const headerText = header.innerText.trim();
  const lines = headerText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // 제외할 패턴: 상태 배지, 금액·납입 정보 등
  const STATUS_TOKENS = new Set([
    '정상', '납입중', '납입종료', '실효', '해지', '갱신', '비갱신',
    '비갱신형', '갱신형 특약', '월납중', '연납', '일시납'
  ]);
  const isProductLine = (line) => {
    if (STATUS_TOKENS.has(line)) return false;
    if (/원\s*[|│\/]/.test(line)) return false;     // "153,250 원 | 월납..."
    if (/^[\d,.\s]+(?:원|만원|개)/.test(line)) return false; // "5,000 만원" 등 금액
    if (/^[\d,\s]+$/.test(line)) return false;       // 순수 숫자
    if (line.length < 2) return false;
    return /[가-힣A-Za-z]/.test(line);               // 한글 또는 영문 포함
  };
  const productLines = lines.filter(isProductLine);

  // 일반 패턴: [보험사명, 상품명] 순서
  let company = '';
  let product = '';
  if (productLines.length >= 2) {
    company = productLines[0];
    product = productLines[1];
  } else if (productLines.length === 1) {
    product = productLines[0];
  }

  // 보험료 라인 추출 (예: "153,250 원 | 월납 / 현대해상화재보험")
  let premium = '';
  let payCycle = '';
  const premiumLine = lines.find(l => /원\s*[|│]/.test(l));
  if (premiumLine) {
    const pm = premiumLine.match(/([\d,]+)\s*원/);
    if (pm) premium = pm[1].replace(/,/g, '');
    const cm = premiumLine.match(/\|\s*([^/]+?)\s*\//);
    if (cm) payCycle = cm[1].trim();
  }

  return { company, product, premium, payCycle, headerText };
}

// 접혀있는 모든 accordion 을 펼침 (탭 전환은 별도 switchAllTabsTo 로)
async function expandAllAccordions() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let rounds = 0;
  const maxRounds = 6;
  let totalExpanded = 0;

  while (rounds < maxRounds) {
    const collapsed = document.querySelectorAll('.p-accordion__item-header[aria-expanded="false"]');
    collapsed.forEach(header => {
      try { header.click(); totalExpanded++; } catch (e) {
        console.warn('[Toss Extractor] accordion click failed:', e);
      }
    });
    if (collapsed.length === 0) break;
    await sleep(450);
    rounds++;
  }
  return { rounds, expanded: totalExpanded };
}

// 🆕 모든 accordion 의 보장/특약 segmented control 을 지정된 탭(label) 으로 강제 전환
//   다양한 selector + 텍스트 매칭 fallback 으로 Toss CRM 의 DOM 구조 변경에도 대응
async function switchAllTabsTo(label) {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let rounds = 0, totalSwitched = 0;

  const findCandidates = () => {
    // 🔒 스코프 한정: 보장/특약 토글은 항상 accordion 내부에만 존재한다.
    //    document 전체에서 텍스트가 '보장'/'특약'인 버튼을 클릭하면
    //    상단 네비게이션/다른 탭을 눌러 페이지를 이탈 → 보장·특약 둘 다 추출 실패.
    //    따라서 accordion 컨테이너 내부로만 후보를 제한한다.
    const scopes = Array.from(document.querySelectorAll('.p-accordion__item'));
    const roots = scopes.length > 0 ? scopes : [document];
    const collect = (selector, exactText) => {
      const out = [];
      roots.forEach(root => {
        root.querySelectorAll(selector).forEach(el => {
          if (exactText) {
            const txt = (el.innerText || el.textContent || '').trim();
            if (txt !== label || txt.length >= 20) return;
          }
          out.push(el);
        });
      });
      return out;
    };

    // 1) title 속성 (현재 알려진 구조)
    let nodes = collect(`button[role="radio"][title="${label}"], button[role="tab"][title="${label}"], [role="radio"][title="${label}"], [role="tab"][title="${label}"]`, false);
    // 2) 텍스트 콘텐츠 (innerText) 정확 일치 — title 없어도 동작
    if (nodes.length === 0) {
      nodes = collect('button[role="radio"], button[role="tab"], [role="radio"], [role="tab"], button[data-radix-collection-item]', true);
    }
    // 2.5) 🆕 더 광범위한 fallback — segmented control / pill / chip / div[role] 등
    //      단, accordion 내부로 스코프 제한되어 안전함
    if (nodes.length === 0) {
      nodes = collect('button, div[role="button"], div[data-state], span[role="tab"], a[role="tab"]', true);
    }
    // 3) 활성화되지 않은 것만 (이미 active 인 건 제외) — 또는 상태 모름
    const filtered = nodes.filter(el => {
      const aria = (el.getAttribute('aria-checked') || el.getAttribute('aria-selected') || '').toLowerCase();
      const ds = (el.getAttribute('data-state') || '').toLowerCase();
      // checked/active/true 면 이미 활성 → 제외. 그 외에는 (unchecked/inactive/false/모름) 클릭 시도
      const isActive = ds === 'checked' || ds === 'active' || aria === 'true';
      return !isActive;
    });
    return filtered;
  };

  while (rounds < 6) {
    const btns = findCandidates();
    if (btns.length === 0) break;
    btns.forEach(b => { try { b.click(); totalSwitched++; } catch (e) {
      console.warn('[Toss Extractor] tab switch click failed:', e);
    } });
    await sleep(450);
    rounds++;
  }
  // React 렌더링 안정화
  await sleep(400);

  // 검증: 실제로 활성화된 라벨이 무엇인지 로깅 (디버그)
  const activeBtns = Array.from(document.querySelectorAll('button[role="radio"][data-state="checked"], button[role="tab"][aria-selected="true"], button[role="radio"][aria-checked="true"]'));
  const activeLabels = activeBtns.map(b => (b.getAttribute('title') || b.innerText || '').trim()).filter(Boolean);
  console.log(`[Toss Extractor] switchAllTabsTo('${label}'): clicked ${totalSwitched}회, 활성화된 탭=`, activeLabels);
  return totalSwitched;
}

// 보장 페이지의 상품별 보장 상세 테이블 추출
// 🆕 보장 행의 표준 컬럼 순서 — 토스 CRM 표와 동일
//   계약자/피보험자 → 보장 대분류 → 보장 소분류 → 보장명 → 보장 금액 → 납입기간 → 보장시작일 → 보장종료일
const COVERAGE_STD_ORDER = [
  '계약자/피보험자',
  '보장 대분류',
  '보장 소분류',
  '보장명',
  '보장 금액',
  '납입기간',
  '보장시작일',
  '보장종료일'
];

// 표준 순서로 정렬된 새 객체 반환 (JSON 직렬화 시 키 순서 보존)
function _orderedCoverageRow(rowData) {
  const ordered = {
    _상품명: rowData._상품명,
    _보험사명: rowData._보험사명,
    _섹션번호: rowData._섹션번호
  };
  // 🔑 _accordionIdx 는 보장/특약 pass 동일 accordion 묶기에 필수 — 명시적으로 복사
  if (rowData._accordionIdx !== undefined) ordered._accordionIdx = rowData._accordionIdx;
  if (rowData._tabType) ordered._tabType = rowData._tabType;
  COVERAGE_STD_ORDER.forEach(k => {
    if (rowData[k] !== undefined) ordered[k] = rowData[k];
  });
  // 표준 순서에 없는 추가 필드는 뒤에 그대로 보존
  Object.keys(rowData).forEach(k => {
    if (k.startsWith('_')) return;
    if (COVERAGE_STD_ORDER.includes(k)) return;
    if (ordered[k] === undefined) ordered[k] = rowData[k];
  });
  return ordered;
}

// 요소가 실제로 보이는지 검사 (display:none / aria-hidden 등 차단된 경우 제외)
function _isElementVisible(el) {
  if (!el) return false;
  let cur = el;
  while (cur && cur !== document.body) {
    const cs = window.getComputedStyle(cur);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (cur.getAttribute && cur.getAttribute('aria-hidden') === 'true') return false;
    cur = cur.parentElement;
  }
  return true;
}

// 🆕 th 에서 헤더 라벨 추출 — BEM 클래스(.table__header-cell__container__label) 우선, 없으면 th 자체 텍스트
function _thLabel(th) {
  const labelEl = th.querySelector('.table__header-cell__container__label');
  if (labelEl) return (labelEl.innerText || labelEl.textContent || '').trim();
  // 폴백: th 내부 텍스트 (아이콘/버튼 텍스트가 섞일 수 있으나 보장 컬럼명은 보통 단순 텍스트)
  return (th.innerText || th.textContent || '').trim();
}

// 🆕 테이블이 "담보 상세" 테이블인지 헤더 라벨로 판정 (클래스명 변경에 무관)
const _COVERAGE_HEADER_KEYS = ['보장명', '보장 금액', '보장 대분류', '보장 소분류', '납입기간', '보장시작일', '보장종료일'];
function _isCoverageTable(table) {
  const ths = table.querySelectorAll('thead th');
  if (ths.length === 0) return false;
  let hit = 0;
  ths.forEach(th => { const l = _thLabel(th); if (_COVERAGE_HEADER_KEYS.includes(l)) hit++; });
  return hit >= 2;  // 보장 컬럼이 2개 이상이면 담보 상세 테이블로 인정
}

function extractCoverageDetails() {
  // 🆕 클래스명에 의존하지 않고 헤더 라벨로 담보 테이블 식별 (Toss CRM DOM 변경 대응)
  //    1순위: 기존 알려진 클래스, 2순위: 헤더 라벨로 판정한 모든 table
  let allTables = Array.from(document.querySelectorAll('table.table.table--small'));
  if (allTables.length === 0) {
    allTables = Array.from(document.querySelectorAll('table')).filter(_isCoverageTable);
    console.log(`[Toss Extractor] table--small 0개 → 헤더 라벨로 담보 테이블 ${allTables.length}개 식별`);
  }
  const tables = allTables.filter(_isElementVisible);
  console.log(`[Toss Extractor] extractCoverageDetails: 전체 ${allTables.length}개 테이블 중 보이는 ${tables.length}개`);
  const allRows = [];
  const productSummary = []; // 상품별 추출 요약

  // 🆕 페이지 내 모든 accordion 의 안정된 인덱스 맵 — 보장/특약 pass 에서 동일 accordion 식별
  const allAccordions = Array.from(document.querySelectorAll('.p-accordion__item'));

  tables.forEach((table, tableIdx) => {
    // 가장 가까운 accordion 부모 찾기
    const accordion = table.closest('.p-accordion__item');
    const productInfo = extractProductInfoFromAccordion(accordion);
    // 🆕 accordion 의 안정된 인덱스 (DOM 순서) — 보장/특약 pass 사이 동일성 보장
    const accordionIdx = accordion ? allAccordions.indexOf(accordion) : -1;

    // 🆕 헤더 — th 별로 cellIndex(시각적 컬럼 위치) + 라벨 매핑
    //   필터 아이콘/체크박스 등 라벨이 없는 th 는 헤더 목록에서 제외하되, cellIndex 는 보존
    //   → 동일 cellIndex 로 td 를 가져오면 시각적 컬럼이 100% 일치
    const headerInfo = [];
    table.querySelectorAll('thead th').forEach(th => {
      const label = _thLabel(th);
      if (label) headerInfo.push({ colIdx: th.cellIndex, label });
    });
    if (headerInfo.length === 0) return;

    // 🆕 td 에서 텍스트를 안전하게 추출 — innerText 는 sibling/floating 요소를 끌어올 수 있어 옆 컬럼 값이 묻어옴
    //   1순위: .table__cell__container__label (헤더와 동일 BEM 패턴)
    //   2순위: .table__cell__container
    //   3순위: 일반 셀 내부 텍스트만 (input/textarea 의 value 도 인식)
    const extractCellText = (td) => {
      if (!td) return '';
      // input/textarea 값 우선 (편집 가능한 셀 대응)
      const input = td.querySelector('input, textarea');
      if (input && (input.value || '').trim()) return input.value.trim();
      // 라벨 컨테이너 (BEM 우선)
      const label = td.querySelector('.table__cell__container__label');
      if (label) return (label.innerText || label.textContent || '').trim();
      const wrap = td.querySelector('.table__cell__container');
      if (wrap) return (wrap.innerText || wrap.textContent || '').trim();
      // 폴백: td 자체 — 단 자식 아이콘/버튼 텍스트만 있는 경우 빈 값 처리
      const raw = (td.innerText || td.textContent || '').trim();
      return raw;
    };

    // 행 추출 — 클래스(table__row) 우선, 없으면 모든 tbody tr 폴백
    let rows = table.querySelectorAll('tbody tr.table__row');
    if (rows.length === 0) rows = table.querySelectorAll('tbody tr');
    let rowCount = 0;
    rows.forEach(row => {
      const tds = row.cells;   // HTMLCollection — 시각적 컬럼 순서 그대로
      if (!tds || tds.length === 0) return;

      const rowData = {
        _상품명: productInfo.product,
        _보험사명: productInfo.company,
        _섹션번호: tableIdx + 1,
        _accordionIdx: accordionIdx   // 🆕 보장/특약 pass 동일 accordion 묶기
      };
      // 🆕 cellIndex 기반 매핑 — 헤더의 colIdx 위치 td 에서 정확히 추출
      headerInfo.forEach(({ colIdx, label }) => {
        const td = tds[colIdx];
        const text = extractCellText(td);
        if (text) rowData[label] = text;
      });

      if (Object.keys(rowData).length > 3) {
        allRows.push(_orderedCoverageRow(rowData));
        rowCount++;
      }
    });

    if (rowCount > 0) {
      // 계약일 추출: 이 섹션의 모든 담보 행의 보장시작일 중 가장 빠른(=오래된) 날짜
      //   (보장시작일 ≈ 계약일과 매칭되는 경우가 많음)
      const sectionRows = allRows.filter(r => r._섹션번호 === tableIdx + 1);
      const startDates = sectionRows
        .map(r => r['보장시작일'])
        .filter(d => d && /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort();
      const earliestStart = startDates[0] || '';

      productSummary.push({
        섹션번호: tableIdx + 1,
        보험사명: productInfo.company,
        상품명: productInfo.product,
        월납보험료: productInfo.premium || '',
        납입주기: productInfo.payCycle || '',
        보장시작일: earliestStart,
        담보수: rowCount
      });
    }
  });

  return { rows: allRows, summary: productSummary };
}

// 상위표 insurances와 accordion productSummary 매칭 → 보험명 채워넣기
// 매칭 우선순위 (강 → 약):
//   1) 보험사명 + 계약일 (가장 정확)
//   2) 보험사명 + 월납보험료
//   3) 보험사명 + 계약일(연-월만 비교)  -- 일자가 1일 차이 같은 경우 대비
//   4) 보험사명만 (같은 회사에 후보 1개일 때)
function matchInsuranceNamesFromAccordion(insurances, productSummary) {
  if (!insurances || !productSummary || productSummary.length === 0) return 0;
  let matched = 0;
  const usedSections = new Set();
  const matchLog = [];

  const findCandidate = (insCompany, insDate, insPremiumDigits) => {
    // 1차: 보험사 + 계약일 정확 일치
    let c = productSummary.find(p =>
      !usedSections.has(p.섹션번호) &&
      p.보험사명 === insCompany &&
      insDate && p.보장시작일 === insDate
    );
    if (c) return { c, by: 'company+date' };
    // 2차: 보험사 + 월납보험료
    c = productSummary.find(p =>
      !usedSections.has(p.섹션번호) &&
      p.보험사명 === insCompany &&
      insPremiumDigits && p.월납보험료 === insPremiumDigits
    );
    if (c) return { c, by: 'company+premium' };
    // 3차: 보험사 + 계약일 연-월만 비교
    const insYM = (insDate || '').substring(0, 7);
    c = productSummary.find(p =>
      !usedSections.has(p.섹션번호) &&
      p.보험사명 === insCompany &&
      insYM && (p.보장시작일 || '').startsWith(insYM)
    );
    if (c) return { c, by: 'company+ym' };
    // 4차: 보험사 단독 + 후보 1개
    const sameCompany = productSummary.filter(p =>
      !usedSections.has(p.섹션번호) && p.보험사명 === insCompany
    );
    if (sameCompany.length === 1) return { c: sameCompany[0], by: 'company-only' };
    return { c: null, by: 'none' };
  };

  for (const ins of insurances) {
    const currentName = (ins['보험명'] || '').trim();
    if (currentName && currentName !== '보험명 없음') continue;
    const insCompany = (ins['보험사명'] || '').trim();
    const insDate = (ins['계약일'] || '').trim();
    const insPremiumDigits = (ins['월납보험료'] || '').replace(/[^\d]/g, '');
    if (!insCompany) continue;
    const { c: candidate, by } = findCandidate(insCompany, insDate, insPremiumDigits);
    if (candidate) {
      ins['보험명'] = candidate.상품명;
      usedSections.add(candidate.섹션번호);
      matched++;
      matchLog.push(`✓ ${insCompany} (${insDate}) → ${candidate.상품명} [${by}]`);
    } else {
      matchLog.push(`✗ ${insCompany} (${insDate}, ${insPremiumDigits}원) → no accordion match`);
    }
  }
  console.log('[Toss Extractor] 매칭 로그:\n' + matchLog.join('\n'));
  return matched;
}

