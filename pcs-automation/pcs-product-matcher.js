// ──────────────────────────────────────────────────────────────────────────
// pcs-product-matcher.js
// 금소법/상품비교 확인서 — 제안서 상품명 → 토스인슈 상품 카탈로그 매칭
//
// 배경: 확인서 전송 플로우의 "상품비교" 단계는 Flutter(CanvasKit) 캔버스라
//       DOM 셀렉터로 옵션을 읽을 수 없다. 대신 같은 출처의 백엔드 API를 직접
//       호출해 전체 상품 목록(procNm + productCd)을 받아오고, 제안서 상품명과
//       정규화 Dice + 숫자토큰 가중 방식으로 fuzzy 매칭한다.
//
// 검증: 메리츠화재(N16) 2264개 상품에 대해 제안서명
//   "(무) 메리츠 통합간편건강보험(세만기형)2604(통합간편심사형)(3.0)
//    (해약환급금미지급형(납입후50%))(보험료 납입면제 2형)(3.10.5 간편심사형)"
//   → 1순위 procNm "...2604(통합간편심사형) (3.10.5간편심사형) 해약환급금미지급형
//      보험료 납입면제2형" (productCd N1611474962798), 확신격차 0.052 로 정확 매칭.
//
// API (인증: 동일 출처 쿠키 credentials:'include')
//   GET /api-mobile/v3/crm/pcs/insurance-company/list?name=<보험사명>
//       → { success: { companies: [{ inscoCd, inscoNm }] } }
//   GET /api-mobile/v3/crm/pcs/product/by-company?inscoCd=<코드>
//       → { success: { products: [{ procNm, productCd, isForSale, ... }] } }
// ──────────────────────────────────────────────────────────────────────────

(function (root) {
  'use strict';

  const API_BASE = 'https://crm.tossinsu.com';

  // ── 정규화: 한글/숫자만 남기고 나머지(공백·괄호·특수문자) 제거 + 흔한 노이즈 제거 ──
  function normalize(s) {
    return (s || '')
      .replace(/메리츠/g, '')      // 일부 카탈로그 procNm 은 "메리츠" 생략
      .replace(/[^가-힣0-9]/g, '');
  }

  // ── 문자 bigram Dice 계수 (0~1) ──
  function bigrams(s) {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  }
  function dice(a, b) {
    const A = bigrams(a), B = bigrams(b);
    let inter = 0, tot = 0;
    for (const [g, c] of A) { tot += c; if (B.has(g)) inter += Math.min(c, B.get(g)); }
    for (const [, c] of B) tot += c;
    return tot ? (2 * inter) / tot : 0;
  }

  // ── 숫자/버전 토큰 집합 (예: 2604, 3.10.5→3105, 50, 2) ──
  //   ⚠️ 점(.) 제거 후 비교: 제안서 PDF 추출이 "3.9.5"를 "395"로 떨어뜨리는 경우가 많아
  //   카탈로그의 "3.9.5"와 토큰이 어긋나 오매칭됨. 점을 빼면 3.9.5↔395 가 일치하고,
  //   3.10.5(→3105) vs 3.0.5(→305) 같은 버전 구분력은 그대로 유지된다.
  function numTokens(s) {
    return new Set(((s || '').match(/\d+(?:\.\d+)*/g) || []).map(t => t.replace(/\./g, '')));
  }
  function jaccard(A, B) {
    let i = 0;
    for (const x of A) if (B.has(x)) i++;
    const u = new Set([...A, ...B]).size;
    return u ? i / u : 0;
  }

  // ── 종합 점수: Dice (1-numW) + 숫자토큰 Jaccard (numW). 기본 numW=0.3 ──
  //   숫자토큰 가중이 3.10.5 vs 3.0.5, 세만기형(2604) vs 연만기형 같은
  //   "한 글자/한 숫자" 차이를 가르는 핵심. 확신도 낮을 때 numW를 높여 재매칭하면
  //   버전(숫자) 변별력이 커져 비슷한 후보들의 순위가 더 또렷해진다.
  function score(targetNorm, targetNums, procNm, numW) {
    const nw = (typeof numW === 'number') ? numW : 0.3;
    const d = dice(targetNorm, normalize(procNm));
    const n = jaccard(targetNums, numTokens(procNm));
    return { total: (1 - nw) * d + nw * n, dice: d, num: n };
  }

  // ── API 호출 ──
  async function fetchCompanies(name) {
    const url = `${API_BASE}/api-mobile/v3/crm/pcs/insurance-company/list?name=${encodeURIComponent(name)}`;
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(`insurance-company/list ${r.status}`);
    const j = await r.json();
    return (j && j.success && j.success.companies) || [];
  }

  async function fetchProducts(inscoCd) {
    const url = `${API_BASE}/api-mobile/v3/crm/pcs/product/by-company?inscoCd=${encodeURIComponent(inscoCd)}`;
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(`product/by-company ${r.status}`);
    const j = await r.json();
    return (j && j.success && j.success.products) || [];
  }

  // ── 보험사명 → inscoCd (정확 일치 우선, 없으면 첫 후보) ──
  async function resolveCompany(companyName) {
    const companies = await fetchCompanies(companyName);
    if (!companies.length) return null;
    const exact = companies.find(c => c.inscoNm === companyName);
    return exact || companies[0];
  }

  // ── 메인: 제안서 상품명 + 보험사명 → 최적 매칭 후보 ──
  //   options: { onlyForSale=true, topN=5, numWeight=0.3 }
  //   반환: { company, best, candidates, confidenceGap }
  async function matchProduct(companyName, proposalProductName, options) {
    const opt = Object.assign({ onlyForSale: true, topN: 5, numWeight: 0.3 }, options || {});
    const company = await resolveCompany(companyName);
    if (!company) throw new Error(`보험사 미발견: ${companyName}`);

    let products = await fetchProducts(company.inscoCd);
    if (opt.onlyForSale) products = products.filter(p => p.isForSale);

    const tNorm = normalize(proposalProductName);
    const tNums = numTokens(proposalProductName);

    const ranked = products.map(p => {
      const s = score(tNorm, tNums, p.procNm, opt.numWeight);
      return {
        procNm: p.procNm,
        productCd: p.productCd,
        isForSale: p.isForSale,
        score: +s.total.toFixed(4),
        dice: +s.dice.toFixed(3),
        num: +s.num.toFixed(3),
      };
    }).sort((a, b) => b.score - a.score);

    const best = ranked[0] || null;
    const confidenceGap = best && ranked[1] ? +(best.score - ranked[1].score).toFixed(4) : null;

    return {
      company,
      best,
      confidenceGap,             // 0.05 이상이면 1순위 신뢰 가능. 낮으면 사람 확인 권장.
      candidates: ranked.slice(0, opt.topN),
      totalScanned: products.length,
    };
  }

  const api = { normalize, dice, score, fetchCompanies, fetchProducts, resolveCompany, matchProduct };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PCSProductMatcher = api;
})(typeof window !== 'undefined' ? window : globalThis);
