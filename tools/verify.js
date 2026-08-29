#!/usr/bin/env node
// tools/verify.js — 빌드 단계가 없는 확장이라 대신 돌리는 정합성 검사.
//   node tools/verify.js
//
// 검사 항목
//   1) 모든 확장 JS 문법 (vendor 제외)
//   2) manifest.json 이 가리키는 파일이 실제로 존재하는지
//   3) popup.html 의 <script src> 가 실제로 존재하는지
//   4) popup/boot.js 의 CONTENT_SCRIPT_FILES 가 manifest content_scripts 와 같은지
//   5) 확장 코드에 alert/confirm/prompt 가 남아있는지 (CLAUDE.md 금지)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const errors = [];
const warnings = [];

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['.git', 'node_modules', 'vendor', 'icons', 'tools'].includes(e.name)) continue;
      walk(full, out);
    } else if (e.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

// 1) 문법
const jsFiles = walk(ROOT);
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  try {
    new vm.Script(src, { filename: f });
  } catch (e) {
    errors.push(`문법 오류 ${rel(f)}: ${e.message}`);
  }
}

// 2) manifest 참조
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const manifestRefs = [];
manifestRefs.push(manifest.background?.service_worker);
manifestRefs.push(manifest.action?.default_popup);
manifestRefs.push(...Object.values(manifest.action?.default_icon || {}));
manifestRefs.push(...Object.values(manifest.icons || {}));
for (const cs of manifest.content_scripts || []) manifestRefs.push(...(cs.js || []), ...(cs.css || []));
for (const war of manifest.web_accessible_resources || []) manifestRefs.push(...(war.resources || []));
manifestRefs.push((manifest.side_panel?.default_path || '').split('?')[0]);
for (const r of manifestRefs.filter(Boolean)) {
  if (!exists(r)) errors.push(`manifest.json 이 없는 파일을 가리킴: ${r}`);
}

// 3) popup.html 스크립트
const popupHtml = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const htmlRefs = [...popupHtml.matchAll(/<(?:script|link)[^>]*(?:src|href)="([^"]+)"/g)].map(m => m[1]);
for (const r of htmlRefs) {
  if (/^(https?:)?\/\//.test(r)) continue;
  if (!exists(r)) errors.push(`popup.html 이 없는 파일을 가리킴: ${r}`);
}

// 4) CONTENT_SCRIPT_FILES ↔ manifest content_scripts
const bootSrc = fs.readFileSync(path.join(ROOT, 'popup/boot.js'), 'utf8');
const listMatch = bootSrc.match(/const CONTENT_SCRIPT_FILES = \[([\s\S]*?)\];/);
if (!listMatch) {
  errors.push('popup/boot.js 에서 CONTENT_SCRIPT_FILES 를 찾지 못함');
} else {
  const fromBoot = [...listMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const fromManifest = manifest.content_scripts[0].js;
  if (JSON.stringify(fromBoot) !== JSON.stringify(fromManifest)) {
    errors.push(
      'CONTENT_SCRIPT_FILES 와 manifest content_scripts[0].js 가 다름\n' +
      `  boot.js : ${fromBoot.join(', ')}\n` +
      `  manifest: ${fromManifest.join(', ')}`
    );
  }
}

// 5) alert / confirm / prompt — 블로킹 네이티브 다이얼로그 (CLAUDE.md 금지)
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const n = (src.match(/(?<![\w.])(?:alert|confirm|prompt)\s*\(/g) || []).length;
  if (n) errors.push(`${rel(f)}: alert/confirm/prompt ${n}곳 — popup 은 showAlert/showConfirm/showPrompt, content 는 pageAlert/pageConfirm 을 쓰세요`);
}

for (const w of warnings) console.log('⚠️  ' + w);
if (errors.length) {
  console.error('\n❌ 검사 실패');
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log(`\n✅ 통과 — JS ${jsFiles.length}개, manifest/popup 참조 정상`);
