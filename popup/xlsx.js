// 전체 보장내역 시트 — 모든 컬럼(반복되는 보험사/상품 등은 세로 병합)
const COVERAGE_EXCEL_COLUMNS = [
  { key: 'insurer', label: '보험사', width: 16, align: 'center' },
  { key: 'productName', label: '상품명', width: 34, align: 'left' },
  { key: 'productType', label: '상품구분', width: 16, align: 'center' },
  { key: 'coverageName', label: '담보명', width: 36, align: 'left' },
  { key: 'coverageDescription', label: '보장내용', width: 30, align: 'left' },
  { key: 'coverageAmount', label: '가입금액', width: 16, money: 'amount', align: 'right' },
  { key: 'insurancePeriod', label: '보험기간', width: 20, align: 'center' },
  { key: 'paymentPeriod', label: '납입기간', width: 16, align: 'center' },
  { key: 'premium', label: '보험료', width: 14, money: 'won', align: 'right' },
  { key: 'renewalType', label: '갱신여부', width: 12, align: 'center' },
  { key: 'memo', label: '비고', width: 26, align: 'left' }
];
// 상품별 시트 — 담보 단위 (보험사/상품구분/보험료/갱신은 제목·요약줄로 올림)
const PRODUCT_COVERAGE_COLUMNS = [
  { key: '_no', label: 'No.', width: 6, align: 'center', seq: true },
  { key: 'coverageName', label: '담보명', width: 38, align: 'left' },
  { key: 'coverageDescription', label: '보장내용', width: 30, align: 'left' },
  { key: 'coverageAmount', label: '가입금액', width: 16, money: 'amount', align: 'right' },
  { key: 'insurancePeriod', label: '보험기간', width: 20, align: 'center' },
  { key: 'paymentPeriod', label: '납입기간', width: 16, align: 'center' },
  { key: 'memo', label: '비고', width: 26, align: 'left' }
];

function _xlsxXmlEsc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
function _xlsxColName(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function _xlsxCellRef(r, c) { return `${_xlsxColName(c)}${r}`; }
function _xlsxBytes(s) { return new TextEncoder().encode(s); }

let _xlsxCrcTable = null;
function _xlsxCrc32(data) {
  if (!_xlsxCrcTable) {
    _xlsxCrcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _xlsxCrcTable[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = _xlsxCrcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function _xlsxDosDateTime(d = new Date()) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}
function _xlsxZipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = _xlsxDosDateTime();
  const put16 = (dv, off, v) => dv.setUint16(off, v, true);
  const put32 = (dv, off, v) => dv.setUint32(off, v >>> 0, true);

  files.forEach(file => {
    const nameBytes = _xlsxBytes(file.path);
    const data = file.data instanceof Uint8Array ? file.data : _xlsxBytes(file.data);
    const crc = _xlsxCrc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    put32(lv, 0, 0x04034b50); put16(lv, 4, 20); put16(lv, 6, 0); put16(lv, 8, 0);
    put16(lv, 10, now.time); put16(lv, 12, now.date); put32(lv, 14, crc);
    put32(lv, 18, data.length); put32(lv, 22, data.length); put16(lv, 26, nameBytes.length); put16(lv, 28, 0);
    local.set(nameBytes, 30);
    chunks.push(local, data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    put32(cv, 0, 0x02014b50); put16(cv, 4, 20); put16(cv, 6, 20); put16(cv, 8, 0); put16(cv, 10, 0);
    put16(cv, 12, now.time); put16(cv, 14, now.date); put32(cv, 16, crc);
    put32(cv, 20, data.length); put32(cv, 24, data.length); put16(cv, 28, nameBytes.length);
    put16(cv, 30, 0); put16(cv, 32, 0); put16(cv, 34, 0); put16(cv, 36, 0); put32(cv, 38, 0); put32(cv, 42, offset);
    cd.set(nameBytes, 46);
    central.push(cd);
    offset += local.length + data.length;
  });

  const centralOffset = offset;
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  put32(ev, 0, 0x06054b50); put16(ev, 4, 0); put16(ev, 6, 0);
  put16(ev, 8, files.length); put16(ev, 10, files.length); put32(ev, 12, centralSize); put32(ev, 16, centralOffset); put16(ev, 20, 0);
  return new Blob([...chunks, ...central, eocd], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

function _xlsxStylesXml() {
  // 시안2 "토스 블루": 맑은 고딕 · 파란 헤더(흰 글씨) · 연파랑 제목/요약 · 얇은 파란 테두리 · 지브라 줄무늬
  //   cellXfs 인덱스:
  //   0 데이터(왼쪽) 1 제목 2 헤더 3 숫자#,##0 4 숫자원 5 숫자만원 6 요약줄 7 데이터(가운데)
  //   8 데이터(왼쪽,지브라) 9 데이터(가운데,지브라) 10 숫자#,##0(지브라) 11 숫자원(지브라) 12 숫자만원(지브라)
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="#,##0"/>
    <numFmt numFmtId="165" formatCode="#,##0&quot;원&quot;"/>
    <numFmt numFmtId="166" formatCode="#,##0&quot;만원&quot;"/>
  </numFmts>
  <fonts count="4">
    <font><sz val="11"/><color rgb="FF1E293B"/><name val="맑은 고딕"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="12"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="16"/><color rgb="FF1D4ED8"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="11"/><color rgb="FF1D4ED8"/><name val="맑은 고딕"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF3182F6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF5F9FF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFBFDBFE"/></left><right style="thin"><color rgb="FFBFDBFE"/></right><top style="thin"><color rgb="FFBFDBFE"/></top><bottom style="thin"><color rgb="FFBFDBFE"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="13">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function _xlsxFormulaCell(row, col, formula, style = 0) {
  return `<c r="${_xlsxCellRef(row, col)}" s="${style}"><f>${_xlsxXmlEsc(formula)}</f></c>`;
}
function _xlsxStringCell(row, col, value, style = 0) {
  const text = String(value == null ? '' : value);
  if (!text) return `<c r="${_xlsxCellRef(row, col)}" s="${style}"/>`;
  return `<c r="${_xlsxCellRef(row, col)}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${_xlsxXmlEsc(text)}</t></is></c>`;
}
function _xlsxNumberCell(row, col, value, style = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return _xlsxStringCell(row, col, value, 0);
  return `<c r="${_xlsxCellRef(row, col)}" s="${style}"><v>${n}</v></c>`;
}
function _moneyCellValue(raw, kind) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { type: 's', value: '' };
  const simple = s.replace(/\s+/g, '');
  if (/^-?[\d,]+(?:원|만원)?$/.test(simple)) {
    const n = parseInt(simple.replace(/[^\d-]/g, ''), 10);
    if (Number.isFinite(n)) {
      if (/만원$/.test(simple) || kind === 'amount') return { type: 'n', value: n, style: 5 };
      if (/원$/.test(simple) || kind === 'won') return { type: 'n', value: n, style: 4 };
      return { type: 'n', value: n, style: 3 };
    }
  }
  return { type: 's', value: s };
}
function _xlsxRowXml(rowNo, cells, height) {
  const h = height ? ` ht="${height}" customHeight="1"` : '';
  return `<row r="${rowNo}"${h}>${cells.join('')}</row>`;
}
function _xlsxColsXml(columns) {
  return `<cols>${columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`).join('')}</cols>`;
}
function _xlsxDataCell(rowNo, colNo, value, colDef, zebra) {
  // zebra 행은 지브라 스타일(+): 왼쪽 0→8, 가운데 7→9, 숫자 3/4/5→10/11/12
  const z = zebra ? 1 : 0;
  const textStyle = (colDef && colDef.align === 'center') ? (z ? 9 : 7) : (z ? 8 : 0);
  if (colDef && colDef.number) return _xlsxNumberCell(rowNo, colNo, value, z ? 10 : 3);
  if (colDef && colDef.money) {
    const m = _moneyCellValue(value, colDef.money);
    return m.type === 'n'
      ? _xlsxNumberCell(rowNo, colNo, m.value, m.style + (z ? 7 : 0))
      : _xlsxStringCell(rowNo, colNo, m.value, z ? 9 : 7);
  }
  return _xlsxStringCell(rowNo, colNo, value, textStyle);
}

// 머리행 라벨(제목/요약) — 병합을 위해 전 컬럼을 같은 스타일로 채운다
function _xlsxMergedLabelRow(rowNo, text, ncols, style, height) {
  const cells = [];
  for (let i = 1; i <= ncols; i++) {
    cells.push(i === 1 ? _xlsxStringCell(rowNo, 1, text, style) : `<c r="${_xlsxCellRef(rowNo, i)}" s="${style}"/>`);
  }
  return _xlsxRowXml(rowNo, cells, height);
}

// 범용 보장 시트 빌더 — 제목 + (선택)요약줄 + 헤더 + 데이터.
//   mergeKeys 에 든 컬럼은 "연속 동일값"을 세로로 셀 병합한다.
function _buildCoverageSheet(opts) {
  const { title, infoLine, columns, rows } = opts;
  const mergeKeys = opts.mergeKeys || [];
  const ncols = columns.length;
  const lastCol = _xlsxColName(ncols);
  const hasInfo = !!infoLine;
  const headerRow = hasInfo ? 3 : 2;
  const dataStart = headerRow + 1;
  const n = rows.length;
  const dataEnd = dataStart + Math.max(n, 1) - 1;

  // 값 매트릭스(병합 판정용) + 세로 병합 계산
  const valOf = (r, c, ri) => c.seq ? String(ri + 1) : (r[c.key] == null ? '' : String(r[c.key]));
  const vmerges = [];
  const covered = rows.map(() => new Array(ncols).fill(false));
  columns.forEach((c, ci) => {
    if (mergeKeys.indexOf(c.key) < 0) return;
    let i = 0;
    while (i < n) {
      const v = valOf(rows[i], c, i);
      let j = i + 1;
      if (v && v.trim()) { while (j < n && valOf(rows[j], c, j) === v) j++; }
      if (j - i > 1) {
        const cn = _xlsxColName(ci + 1);
        vmerges.push(`${cn}${dataStart + i}:${cn}${dataStart + j - 1}`);
        for (let k = i + 1; k < j; k++) covered[k][ci] = true;
      }
      i = j;
    }
  });

  const sheetRows = [_xlsxMergedLabelRow(1, title, ncols, 1, 34)];
  if (hasInfo) sheetRows.push(_xlsxMergedLabelRow(2, infoLine, ncols, 6, 24));
  sheetRows.push(_xlsxRowXml(headerRow, columns.map((c, i) => _xlsxStringCell(headerRow, i + 1, c.label, 2)), 28));

  if (n) {
    rows.forEach((r, ri) => {
      const rowNo = dataStart + ri;
      const zebra = (ri % 2 === 1);   // 홀수 데이터행 = 지브라 줄무늬
      const zc = zebra ? 9 : 7;
      const cells = columns.map((c, ci) => {
        if (covered[ri][ci]) return `<c r="${_xlsxCellRef(rowNo, ci + 1)}" s="${zc}"/>`;   // 병합에 가려진 빈 셀(테두리 유지)
        if (c.seq) return _xlsxStringCell(rowNo, ci + 1, String(ri + 1), zc);
        return _xlsxDataCell(rowNo, ci + 1, r[c.key], c, zebra);
      });
      sheetRows.push(_xlsxRowXml(rowNo, cells, 24));
    });
  } else {
    sheetRows.push(_xlsxRowXml(dataStart, columns.map((c, i) => _xlsxStringCell(dataStart, i + 1, '', 0)), 22));
  }

  const allMerges = [`A1:${lastCol}1`];
  if (hasInfo) allMerges.push(`A2:${lastCol}2`);
  vmerges.forEach(m => allMerges.push(m));

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${lastCol}${dataEnd}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${dataStart}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  ${_xlsxColsXml(columns)}
  <sheetData>${sheetRows.join('')}</sheetData>
  <autoFilter ref="A${headerRow}:${lastCol}${dataEnd}"/>
  <mergeCells count="${allMerges.length}">${allMerges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>
  <pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
</worksheet>`;
}

function _xlsxSafeSheetName(name, used) {
  let base = String(name || 'Sheet').replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let out = base;
  let n = 2;
  while (used.has(out)) {
    const suffix = ` ${n++}`;
    out = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(out);
  return out;
}
function buildCoverageWorkbookBlob(rows) {
  const sortedRows = rows.slice().sort((a, b) => (a.sourceOrder || 0) - (b.sourceOrder || 0));

  // 상품(보험사+상품명)별 그룹 — 첫 등장 순서 유지 (보험사 그룹/기타 시트 폐지)
  const groups = [];
  const gmap = {};
  sortedRows.forEach(r => {
    const key = `${r.insurer || ''}||${r.productName || ''}`;
    if (!gmap[key]) { gmap[key] = { insurer: r.insurer || '', productName: r.productName || '', rows: [] }; groups.push(gmap[key]); }
    gmap[key].rows.push(r);
  });

  const usedNames = new Set();
  const sheets = [];

  // 1) 전체 보장내역 — 반복되는 보험사/상품/구분/보험료/갱신 세로 병합
  sheets.push({
    name: _xlsxSafeSheetName('전체 보장내역', usedNames),
    xml: _buildCoverageSheet({
      title: '전체 보장 내역',
      columns: COVERAGE_EXCEL_COLUMNS,
      rows: sortedRows,
      mergeKeys: ['insurer', 'productName', 'productType', 'premium', 'renewalType']
    })
  });

  // 2) 상품별 시트 — 상품명을 시트명으로, 담보들을 나열 (보장내용/보험기간/납입기간/비고 병합)
  groups.forEach(g => {
    const first = g.rows[0] || {};
    const info = [
      g.insurer && `보험사: ${g.insurer}`,
      first.productType && `구분: ${first.productType}`,
      first.premium && `보험료: ${first.premium}`,
      first.renewalType && `갱신: ${first.renewalType}`
    ].filter(Boolean).join('     ');
    const baseName = g.productName || g.insurer || '상품';
    sheets.push({
      name: _xlsxSafeSheetName(baseName, usedNames),
      xml: _buildCoverageSheet({
        title: baseName,
        infoLine: info,
        columns: PRODUCT_COVERAGE_COLUMNS,
        rows: g.rows,
        mergeKeys: ['coverageDescription', 'insurancePeriod', 'paymentPeriod', 'memo']
      })
    });
  });

  const overrides = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const workbookSheets = sheets.map((s, i) => `<sheet name="${_xlsxXmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const workbookRels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;

  const files = [
    { path: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>` },
    { path: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { path: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>` },
    { path: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}</Relationships>` },
    { path: 'xl/styles.xml', data: _xlsxStylesXml() }
  ];
  sheets.forEach((s, i) => files.push({ path: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml }));
  return _xlsxZipStore(files);
}

function _coverageExcelFileName() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `보장분석_담보정리_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.xlsx`;
}
function _downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function downloadCoverageExcelFromActiveTab(btn) {
  const old = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '엑셀 생성 중...'; btn.disabled = true; }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('active tab not found');
    const injected = await ensureContentScript(tab.id);
    if (!injected) throw new Error('content script injection failed');

    const resp = await new Promise(resolve => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ ok: false, error: 'timeout', rows: [] });
      }, 90000);
      chrome.tabs.sendMessage(tab.id, { action: 'extractCoverageExcelRows' }, r => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message, rows: [] });
        else resolve(r || { ok: false, error: 'empty response', rows: [] });
      });
    });
    console.log('[Coverage Excel] extract response:', resp);
    const rows = Array.isArray(resp && resp.rows) ? resp.rows : [];
    if (!resp || !resp.ok || rows.length === 0) {
      alert('보장분석 탭에서 담보 데이터를 찾을 수 없습니다. 페이지를 확인한 뒤 다시 시도해주세요.');
      return;
    }

    let blob;
    try {
      blob = buildCoverageWorkbookBlob(rows);
    } catch (e) {
      console.error('[Coverage Excel] workbook build failed:', e);
      alert('엑셀 파일 생성 중 오류가 발생했습니다.');
      return;
    }
    const fileName = _coverageExcelFileName();
    _downloadBlob(blob, fileName);
    showToast(`✅ 엑셀 다운로드 준비 완료 (${rows.length}건)`);
  } catch (e) {
    console.error('[Coverage Excel] download failed:', e);
    alert('엑셀 파일 생성 중 오류가 발생했습니다.');
  } finally {
    if (btn) { btn.textContent = old; btn.disabled = false; }
  }
}

