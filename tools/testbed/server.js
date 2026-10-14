// 테스트 픽스처 서버 — Host 헤더로 가짜 사이트를 구분해 응답한다.
const http = require('http'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, 'fixtures');
const send = (res, file) => {
  fs.readFile(path.join(DIR, file), (e, b) => {
    if (e) { res.writeHead(404, {'content-type':'text/plain; charset=utf-8'}); return res.end('fixture 없음: ' + file); }
    res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(b);
  });
};
http.createServer((req, res) => {
  const host = String(req.headers.host || '').split(':')[0];
  console.log(new Date().toISOString().slice(11,19), host + req.url);
  if (/tossinsu\.com$/.test(host))      return send(res, /empty/.test(req.url) ? 'crm-empty.html' : 'crm.html');
  if (/ohmymanager\.com$/.test(host))   return send(res, 'mmlfcp.html');
  res.writeHead(200, {'content-type':'text/plain; charset=utf-8'});
  res.end('차단됨(샌드박스): ' + host + req.url);   // 그 외 모든 호스트는 여기서 끝 — 외부로 안 나간다
}).listen(8899, '127.0.0.1', () => console.log('fixture server :8899'));
