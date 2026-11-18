// ═══════════════════════════════════════════════════════════════════
// insurer-sites.js — 보험사 GA/설계사 포털 주소 목록 + 주소→보험사 판별
//   popup(🔑 비번 탭) 과 background(사이트 자동 표시) 가 함께 쓴다.
//   워크스페이스 js/jmin.js 의 INSURER_SITES 와 같은 목록 — 바뀌면 둘 다 고칠 것.
//   ⚠ 주소를 추가하면 manifest.json 의 insurer-card.js matches 에도 그 도메인을 넣어야
//     사이트 자동 표시가 뜬다.
// ═══════════════════════════════════════════════════════════════════
function _credNorm(s) { return String(s || '').replace(/\s/g, '').toLowerCase(); }

var CRED_INSURER_SITES = {
  '삼성화재':'https://erp.samsungfire.com','현대해상':'https://sp.hi.co.kr',
  'DB손해보험':'https://www.mdbins.com','DB손보':'https://www.mdbins.com',
  '메리츠화재':'https://nsso.meritzfire.com','메리츠':'https://nsso.meritzfire.com',
  'KB손해보험':'http://sales.kbinsure.co.kr','KB손보':'http://sales.kbinsure.co.kr',
  '한화손해보험':'http://portal.hwgeneralins.com','한화손보':'http://portal.hwgeneralins.com',
  '흥국화재':'https://sales.heungkukfire.co.kr','롯데손해보험':'https://lottero.lotteins.co.kr','롯데손보':'https://lottero.lotteins.co.kr',
  'NH농협손해보험':'https://ss.nhfire.co.kr','농협손해보험':'https://ss.nhfire.co.kr','NH손보':'https://ss.nhfire.co.kr',
  'MG손해보험':'https://mganet.mggeneralins.com','MG손보':'https://mganet.mggeneralins.com',
  '신한EZ손해보험':'https://ga.shinhanez.co.kr','신한EZ':'https://ga.shinhanez.co.kr',
  'AIG손해보험':'https://ga.aig.co.kr','AIG':'https://ga.aig.co.kr','하나손해보험':'https://sfa.saleshana.com',
  '삼성생명':'https://ga.samsunglife.com','한화생명':'https://hmp.hanwhalife.com','교보생명':'https://ga.kyobo.com',
  '신한라이프':'https://ga.shinhanlife.co.kr','라이나생명':'https://ga.lina.co.kr','ABL생명':'https://ga.abllife.co.kr',
  '하나생명':'https://ga.hanalife.co.kr','메트라이프':'https://brand.metlife.co.kr','메트라이프생명':'https://brand.metlife.co.kr',
  'KB라이프':'https://sfa.kblife.co.kr','KB라이프생명':'https://sfa.kblife.co.kr','NH농협생명':'https://sfa.nhlife.co.kr','농협생명':'https://sfa.nhlife.co.kr',
  '흥국생명':'https://sales.heungkuklife.co.kr','푸본현대생명':'https://ez.fubonhyundai.com',
  'DB생명':'http://etopia.dongbulife.com','동부생명':'http://etopia.dongbulife.com',
  'KDB생명':'http://kss.kdblife.co.kr','카디프생명':'http://ga.cardif.co.kr','IM라이프':'https://fgs.imlifeins.co.kr','IM라이프생명':'https://fgs.imlifeins.co.kr'
};

// sales.meritzfire.com · nsso.meritzfire.com → meritzfire.com / ga.hi.co.kr → hi.co.kr
function _credBaseDomain(host) {
  const p = String(host || '').toLowerCase().replace(/^www\./, '').split('.');
  const n = /^(co|or|go|ac|ne|re)$/.test(p[p.length - 2] || '') ? 3 : 2;
  return p.slice(-n).join('.');
}

// 탭 주소 → 해당 보험사 이름 목록
function _credInsurersForUrl(url) {
  let host = '';
  try { host = new URL(url).hostname; } catch (e) { return []; }
  if (!host) return [];
  const base = _credBaseDomain(host);
  const out = [];
  Object.keys(CRED_INSURER_SITES).forEach(name => {
    let h = '';
    try { h = new URL(CRED_INSURER_SITES[name]).hostname; } catch (e) { return; }
    if (h === host || _credBaseDomain(h) === base) out.push(name);
  });
  return out;
}

function _credMatchesNames(c, names) {
  const k = _credNorm(c['보험사']);
  if (!k) return false;
  return names.some(n => { const nn = _credNorm(n); return nn === k || nn.includes(k) || k.includes(nn); });
}
