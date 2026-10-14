#!/usr/bin/env node
// tools/testbed/build.js — 격리 테스트용 확장 사본을 만든다.
//   node tools/testbed/build.js [출력경로]
//
// 원본은 건드리지 않는다. 사본의 manifest 만 다음과 같이 좁힌다.
//   · 이름에 [TEST] 표시 — 설치된 실물과 헷갈리지 않게
//   · content_scripts / host_permissions 를 로컬 픽스처 호스트(http) 로만 제한
//   · 보험사 30곳 주입(insurer-fill.js) 제거 — 테스트 대상이 아니다
// 권한 게이트(ext-auth-gate.js)는 절대 건드리지 않는다 (CLAUDE.md).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '.out', 'ext'));

const SKIP = new Set(['CLAUDE.md', 'README.md', 'RELAY_HANDOFF.md']);

fs.rmSync(OUT, { recursive: true, force: true });

// git 이 추적하는 파일만 복사 — 백업·임시 파일이 섞이지 않는다
const files = execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' })
  .split('\n').filter(Boolean)
  .filter(f => !SKIP.has(f) && !f.startsWith('.github/') && !f.startsWith('tools/'));

for (const f of files) {
  const dst = path.join(OUT, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), dst);
}

const mp = path.join(OUT, 'manifest.json');
const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
m.name = '[TEST] ' + m.name;
m.description = '테스트 전용 사본 — 로컬 픽스처에서만 동작. 실제 사이트 매칭 제거됨.';
m.host_permissions = [
  'http://crm.tossinsu.com/*', 'http://mmlfcp.ohmymanager.com/*',
  'http://127.0.0.1/*', 'http://localhost/*'
];
m.content_scripts = [{
  matches: ['http://crm.tossinsu.com/*', 'http://mmlfcp.ohmymanager.com/*'],
  js: m.content_scripts[0].js,
  run_at: 'document_idle'
}];
m.web_accessible_resources = [{
  resources: ['pcs-clip-intercept.js'], matches: ['http://crm.tossinsu.com/*']
}];
fs.writeFileSync(mp, JSON.stringify(m, null, 2));

// 압축해제 로드 확장의 ID 는 폴더 경로의 SHA-256(윈도우는 UTF-16LE)에서 나온다
const crypto = require('crypto');
const enc = process.platform === 'win32' ? 'utf16le' : 'utf8';
const id = crypto.createHash('sha256').update(Buffer.from(OUT, enc)).digest('hex')
  .slice(0, 32).split('').map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');

console.log('사본 생성: ' + OUT + ' (' + files.length + '개 파일)');
console.log('확장 ID  : ' + id);
console.log('팝업 URL : chrome-extension://' + id + '/popup.html');
