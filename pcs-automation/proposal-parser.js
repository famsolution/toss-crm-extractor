// ──────────────────────────────────────────────────────────────────────────
// proposal-parser.js
// 보험사 가입제안서(PDF) 텍스트 → 구조화 필드 추출 (여러 보험사 형식 대응)
//
// 입력: 제안서 PDF 앞 1~2페이지 추출 텍스트(string).  opts.filename: 파일명(보험사 힌트)
//   텍스트 추출: 확장은 PCSPdf.extractText (pdf.js, 내장).
//
// 반환: { 보험사, 상품명, 고객명, 계약자, 보험료, 가계약번호, 상령일, 컨설턴트, 컨설턴트연락처 }
//   ※ 고객 연락처/생년월일은 제안서에 없을 수 있음 → CRM 고객 레코드에서 보완.
//
// 검증: 메리츠_106530.pdf, KB라이프_31173.pdf (글자 띄어쓰기 추출 형식) 통과.
// ──────────────────────────────────────────────────────────────────────────

(function (root) {
  'use strict';

  // 일부 제안서 PDF 는 숫자/영문/기호가 한 글자씩 띄어져 추출됨("K B3 . 1 0 . 5").
  //   → 숫자·영문·기호 사이 공백을 접합. (한글 단어 사이 공백은 보존)
  function despace(s) {
    let t = String(s || '');
    for (let i = 0; i < 4; i++) {
      t = t
        .replace(/(\d)\s+(?=[\d.,)\-])/g, '$1')          // 숫자 뒤 공백 + 숫자/기호
        .replace(/([A-Za-z])\s+(?=[A-Za-z0-9])/g, '$1')  // 영문 약어 접합 "K B3" → "KB3"
        .replace(/([(\[])\s+/g, '$1')                    // 여는 괄호 뒤 공백
        .replace(/\s+([)\],.])/g, '$1')                  // 닫는 괄호/구두점 앞 공백
        .replace(/(\d)\s+(만원|원|세만기|년납|년만기|세|년)/g, '$1$2');
    }
    return t;
  }

  // 보험사 식별 토큰 (손보 + 생명)
  const INSURERS = [
    'KB라이프', 'KB손해보험', 'KB손보', 'KB',
    '메리츠화재', '메리츠', '삼성화재', '삼성생명', '현대해상', 'DB손해보험', 'DB생명',
    '한화손해보험', '한화생명', '흥국화재', '흥국생명', '롯데손해보험', 'NH농협손해보험', 'NH농협생명', '농협',
    'MG손해보험', '하나손해보험', '하나생명', 'AXA', '교보생명', '교보라이프', '신한라이프', '미래에셋생명',
    'KDB생명', '라이나생명', 'ABL생명', '메트라이프', '동양생명', '푸본현대생명', 'IBK연금', 'AIG'
  ];

  function firstMatch(text, re) { const m = text.match(re); return m ? (m[1] || '').trim() : ''; }

  // 보험사: 파일명 힌트 → 본문/상품명 토큰 (긴 토큰 우선)
  function extractCompany(text, productName, filename) {
    const hay = (filename || '') + ' ' + text + ' ' + (productName || '');
    const sorted = INSURERS.slice().sort((a, b) => b.length - a.length);
    return sorted.find(k => hay.includes(k)) || '';
  }

  // 상품명: ① "주계약 <상품명> <금액>만원" 행 ② "가입제안서" 뒤 문구 ③ (무)/(유) 첫 줄
  function extractProductName(text, lines) {
    let m = text.match(/주\s*계\s*약\s+([^\n]*?)\s+[\d,]+\s*만원/);
    if (m && m[1] && m[1].replace(/\s/g, '').length >= 4) return m[1].replace(/\s{2,}/g, ' ').trim();
    m = text.match(/가\s*입\s*제\s*안\s*서\s+([^\n]+)/);
    if (m && m[1]) {
      const cand = m[1].replace(/\s{2,}/g, ' ').trim();
      if (cand && !/^계약자/.test(cand)) return cand.slice(0, 120);
    }
    const idx = lines.findIndex(l => /제안서\s*$/.test(l));
    if (idx >= 0 && lines[idx + 1] && !/^계약자/.test(lines[idx + 1])) return lines[idx + 1].trim();
    const byMark = lines.find(l => /^\(\s*[무유]\s*\)/.test(l.trim()));
    return byMark ? byMark.trim() : '';
  }

  // 고객명(피보험자): "OOO 고객님" / "피보험자 OOO" / "OOO 님의 가입"
  function extractCustomer(text) {
    return firstMatch(text, /([가-힣]{2,4})\s*고객님/)
      || firstMatch(text, /피보험자\s+([가-힣]{2,4})/)
      || firstMatch(text, /([가-힣]{2,4})\s*님의\s*가입/);
  }

  function parseProposalText(text, opts) {
    opts = opts || {};
    const norm = despace((text || '').replace(/\r/g, ''));
    const lines = norm.split('\n').map(s => s.trim()).filter(Boolean);

    const 상품명 = extractProductName(norm, lines);
    const 고객명 = extractCustomer(norm);
    const 계약자 = firstMatch(norm, /계약자\s+([가-힣]{2,4})/) || 고객명;
    const 상령일 = firstMatch(norm, /상령일\s*[:：]?\s*([0-9.\-]+)/);
    const 보험료 = firstMatch(norm, /초회보험료\s*[:：]?\s*([\d,]+)\s*원/)
      || firstMatch(norm, /보험료\s+([\d,]+)\s*원/);
    const 가계약번호 = firstMatch(norm, /가계약번호\s+(\d+)/);
    const 컨설턴트 = firstMatch(norm, /성명\s*[:：]\s*([가-힣]{2,4})/)
      || firstMatch(norm, /컨설턴트\s+.*?\(([가-힣]{2,4})\)/);
    const 컨설턴트연락처 = firstMatch(norm, /H\.?P\s*[:：]?\s*([\d\-]{9,})/)
      || firstMatch(norm, /휴대전화\s+([\d-]+)/);
    const 보험사 = extractCompany(norm, 상품명, opts.filename);

    return {
      보험사, 상품명, 고객명, 계약자,
      보험료: 보험료 ? Number(보험료.replace(/,/g, '')) : null,
      가계약번호, 상령일, 컨설턴트, 컨설턴트연락처,
    };
  }

  const api = { parseProposalText, despace };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ProposalParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
