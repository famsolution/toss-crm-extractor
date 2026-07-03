// ──────────────────────────────────────────────────────────────────────────
// pcs-pdf.js — 로컬 PDF 텍스트 추출 (pdf.js, 확장 내장 vendor)
//   제안서 PDF(파일/ArrayBuffer/base64) → 앞 N페이지 텍스트 문자열.
//   Claude 없이 확장 자체에서 제안서를 분석하기 위한 입력 단계.
// ──────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  function _toUint8(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof input === 'string') {           // base64 (data URL 의 ',' 뒷부분)
      const b64 = input.includes(',') ? input.split(',')[1] : input;
      const bin = atob(b64);
      const a = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      return a;
    }
    throw new Error('지원하지 않는 PDF 입력 형식');
  }

  async function extractText(input, maxPages) {
    if (!root.pdfjsLib) throw new Error('pdf.js 가 로드되지 않았습니다.');
    try { root.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.js'); } catch (_) {}
    const data = _toUint8(input);
    const pdf = await root.pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    const n = Math.min(maxPages || 2, pdf.numPages);
    const out = [];
    for (let p = 1; p <= n; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      out.push(tc.items.map(i => i.str).join(' '));
    }
    return out.join('\n');
  }

  // File 객체 → base64 (FileReader)
  function fileToBase64(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1] || '');
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
  }

  root.PCSPdf = { extractText, fileToBase64 };
})(typeof window !== 'undefined' ? window : globalThis);
