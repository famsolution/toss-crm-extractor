// ═══════════════════════════════════════════════════════════════
// 🆕 자동 업데이트 — update.bat 없이 확장 안에서 바로
//
//   ① 처음 한 번: [자동 업데이트 켜기] → 확장을 압축 풀어 둔 폴더(manifest.json 이 있는 곳)를 고른다
//      (크롬의 '폴더 사용 허락' — 폴더 동기화와 같은 방식, 이 PC 에만 기억)
//   ② 그다음부터: 새 버전이 나오면 확장을 열 때 최신 zip 을 받아 그 폴더에 덮어쓰고 스스로 다시 시작한다.
//      크롬이 폴더 허락을 다시 묻는 상태면 [⬆ 업데이트] 한 번만 누르면 된다.
//   · 고른 폴더가 지금 이 확장의 폴더가 맞는지(manifest.json 내용이 같은지) 확인한 뒤에만 쓴다.
//   · .bat 같은 실행 파일은 덮어쓰지 않는다. 받는 것은 공개 릴리스 zip 뿐, 보내는 데이터는 없다.
// ═══════════════════════════════════════════════════════════════
(function () {
  const ZIP_URL = 'https://github.com/famsolution/toss-crm-extractor/releases/latest/download/sangdam-helper.zip';
  const cur = chrome.runtime.getManifest().version;
  const isFull = /[?&]full=1\b/.test(location.search);
  const newer = (a, b) => {
    const x = String(a || '').split('.').map(n => parseInt(n, 10) || 0), y = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
    return false;
  };
  const say = (m, t) => (typeof showAlert === 'function' ? showAlert(m, t || '🆕 업데이트') : Promise.resolve());
  const toast = m => { if (typeof showToast === 'function') showToast(m); };

  // ── 설치 폴더 기억 (IndexedDB) ──
  function _idb() { return new Promise((res, rej) => { const r = indexedDB.open('sdh-upd', 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function getDir() { try { const db = await _idb(); return await new Promise(res => { const q = db.transaction('h').objectStore('h').get('dir'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } }
  async function setDir(h) { const db = await _idb(); await new Promise((res, rej) => { const t = db.transaction('h', 'readwrite'); t.objectStore('h').put(h, 'dir'); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
  async function perm(h, ask) {
    const o = { mode: 'readwrite' };
    try { if ((await h.queryPermission(o)) === 'granted') return true; if (ask) return (await h.requestPermission(o)) === 'granted'; } catch (e) {}
    return false;
  }
  async function readText(dir, name) { try { return await (await (await dir.getFileHandle(name)).getFile()).text(); } catch (e) { return null; } }
  // 고른 폴더가 지금 돌아가는 이 확장의 폴더인지
  async function isOurFolder(dir) {
    const mine = await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).text();
    const there = await readText(dir, 'manifest.json');
    return there !== null && there.trim() === mine.trim();
  }

  // ── zip 풀기 (외부 라이브러리 없이, 크롬 내장 압축 해제) ──
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), out = new Map();
    let e = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) { if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; } }
    if (e < 0) throw new Error('받은 파일이 zip 이 아닙니다');
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const td = new TextDecoder();
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip 목록이 손상되었습니다');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (name.endsWith('/')) continue;
      const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      const raw = u8.slice(ds, ds + csize);
      let data;
      if (method === 0) data = raw;
      else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else throw new Error('지원하지 않는 압축 방식: ' + name);
      out.set(name.replace(/^\.\//, ''), data);
    }
    return out;
  }
  async function writeFile(root, path, data) {
    const parts = path.split('/').filter(Boolean);
    if (parts.some(x => x === '..')) return;
    let d = root;
    for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
    const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable(); await w.write(data); await w.close();
  }

  // ── 받아서 덮어쓰기 → 다시 시작 ──
  let _busy = false;
  async function apply(dir, onStep) {
    if (_busy) return false; _busy = true;
    try {
      onStep && onStep('⬇ 최신 버전 받는 중…');
      const r = await fetch(ZIP_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('내려받기 실패 (' + r.status + ')');
      const files = await unzip(await r.arrayBuffer());
      const mf = files.get('manifest.json');
      if (!mf) throw new Error('받은 파일에 manifest.json 이 없습니다');
      const nm = JSON.parse(new TextDecoder().decode(mf));
      if (nm.name !== chrome.runtime.getManifest().name) throw new Error('받은 파일이 이 확장 것이 아닙니다');
      if (!newer(nm.version, cur)) { toast('✅ 이미 최신 버전입니다 (v' + cur + ')'); return false; }
      if (!(await isOurFolder(dir))) throw new Error('고른 폴더가 지금 쓰는 확장 폴더와 다릅니다 — [폴더 다시 고르기] 로 manifest.json 이 있는 확장 폴더를 골라 주세요');
      onStep && onStep(`📝 v${nm.version} 설치 중…`);
      const names = [...files.keys()].filter(x => x !== 'manifest.json' && !/\.(bat|cmd|exe|ps1|vbs)$/i.test(x));
      for (const name of names) await writeFile(dir, name, files.get(name));
      await writeFile(dir, 'manifest.json', mf);           // 버전 표시는 맨 마지막에 바꿈
      await chrome.storage.local.set({ updLastApplied: { v: nm.version, at: Date.now() } });
      onStep && onStep(`✅ v${nm.version} 설치 완료 — 다시 시작합니다`);
      setTimeout(() => { try { chrome.runtime.reload(); } catch (e) {} }, 900);
      return true;
    } finally { _busy = false; }
  }

  // 큰 창에서: 폴더 고르기(처음) 또는 허락 다시 받기 → 바로 설치
  async function connectAndApply(btn, forcePick, explained) {
    const step = m => { if (btn) btn.textContent = m; else toast(m); };
    try {
      let dir = forcePick ? null : await getDir();
      if (dir && !(await perm(dir, true))) dir = null;
      if (!dir) {
        if (!explained) await say('확장 프로그램을 압축 풀어 둔 폴더를 골라 주세요.\n\n· 안에 manifest.json 과 update.bat 이 있는 폴더입니다\n· 크롬이 "파일 수정 허용"을 물으면 허용(가능하면 「방문할 때마다 허용」)\n\n한 번만 고르면 다음부터는 새 버전이 나올 때 자동으로 설치됩니다.', '⬆ 자동 업데이트 켜기');
        dir = await window.showDirectoryPicker({ id: 'sdh-ext-folder', mode: 'readwrite' });
        if (!(await perm(dir, true))) throw new Error('폴더 수정 허락을 받지 못했습니다');
        if (!(await isOurFolder(dir))) throw new Error('이 폴더는 지금 쓰는 확장 폴더가 아닙니다.\nchrome://extensions 에서 상담 도우미의 "세부정보 → 소스" 에 나오는 폴더를 골라 주세요.');
        await setDir(dir);
        await chrome.storage.local.set({ updAuto: true });
        toast('✅ 자동 업데이트를 켰습니다');
      }
      const st = await chrome.storage.local.get(['updLatest']);
      if (st.updLatest && newer(st.updLatest, cur)) await apply(dir, step);
      else { step('✅ 최신 버전입니다'); }
    } catch (e) {
      if (e && e.name === 'AbortError') return;          // 폴더 고르기 취소
      await say('업데이트하지 못했습니다.\n\n' + (e.message || e) + '\n\n안 되면 폴더의 update.bat 을 실행해도 됩니다.');
    }
  }

  function openFull() {
    const url = chrome.runtime.getURL('popup.html?full=1&upd=1');
    try { chrome.tabs.create({ url }); } catch (e) { window.open(url, '_blank'); }
  }
  function openGuide() {
    const url = chrome.runtime.getURL('update-guide.html');
    try { chrome.tabs.create({ url }); } catch (e) { window.open(url, '_blank'); }
  }

  async function render(latest) {
    document.getElementById('updBar')?.remove();
    if (!(latest && newer(latest, cur))) return;
    const st = await chrome.storage.local.get(['updSnooze', 'updAuto']);
    const dir = await getDir();
    const granted = dir ? await perm(dir, false) : false;
    const bar = document.createElement('div');
    bar.id = 'updBar'; bar.className = 'upd-bar';
    const hd = document.querySelector('.header');
    const put = () => { if (hd) hd.insertAdjacentElement('afterend', bar); else document.body.prepend(bar); };
    // 자동: 폴더 허락이 살아 있으면 묻지 않고 바로 설치
    if (dir && granted && st.updAuto !== false) {
      bar.innerHTML = `<span class="upd-ic">⬇</span><span class="upd-tx">새 버전 <b>v${latest}</b> 자동 설치 중…</span>`;
      put();
      const tx = bar.querySelector('.upd-tx');
      try { await apply(dir, m => { tx.textContent = m; }); }
      catch (e) { tx.textContent = '⚠ 자동 설치 실패: ' + (e.message || e); bar.insertAdjacentHTML('beforeend', '<button type="button" class="upd-go" data-u="go">다시 시도</button>'); }
    } else {
      if (!dir && st.updSnooze === latest) return;          // '나중에' 누른 버전 (자동 업데이트를 안 켠 경우만)
      bar.innerHTML = `<span class="upd-ic">🆕</span><span class="upd-tx">새 버전 <b>v${latest}</b> 이 나왔습니다 <small>(지금 v${cur})</small></span>
        <button type="button" class="upd-go" data-u="go">${dir ? '⬆ 업데이트' : '⬆ 업데이트 (자동 켜기)'}</button>
        ${dir ? '' : '<button type="button" class="upd-x" data-u="later" title="이 버전은 다시 알리지 않기">✕</button>'}`;
      put();
    }
    bar.addEventListener('click', async e => {
      const b = e.target.closest('[data-u]'); if (!b) return;
      if (b.dataset.u === 'go') { if (isFull) connectAndApply(b); else openFull(); }   // 폴더 허락 창은 큰 창에서만 뜬다
      else if (b.dataset.u === 'later') { await chrome.storage.local.set({ updSnooze: latest }); bar.remove(); }
    });
  }

  // 설정용 (머리말 버전 표시를 누르면 열리는 작은 메뉴)
  async function versionMenu(anchor) {
    document.getElementById('updMenu')?.remove();
    const dir = await getDir(), st = await chrome.storage.local.get(['updAuto', 'updLastApplied']);
    const m = document.createElement('div'); m.id = 'updMenu'; m.className = 'gc-menu';
    m.innerHTML = `<div class="gc-menu-t">상담 도우미 v${cur}</div>
      <div class="gc-menu-prev">자동 업데이트: <b>${dir && st.updAuto !== false ? '켜짐 · 폴더 ' + dir.name : '꺼짐'}</b></div>
      <div class="gc-menu-row"><button type="button" class="gc-sub" data-m="check">🔄 새 버전 확인</button></div>
      <div class="gc-menu-row"><button type="button" class="gc-sub" data-m="auto">${dir ? '📁 폴더 다시 고르기' : '⬆ 자동 업데이트 켜기'}</button></div>
      ${dir ? `<div class="gc-menu-row"><button type="button" class="gc-sub" data-m="toggle">${st.updAuto !== false ? '⏸ 자동 설치 끄기' : '▶ 자동 설치 켜기'}</button></div>` : ''}
      <div class="gc-menu-row"><button type="button" class="gc-sub" data-m="guide">📖 업데이트 안내</button></div>
      <div class="gc-menu-row"><button type="button" class="gc-sub" data-m="ppdiag">🔎 페인트프로 진단 복사</button></div>`;
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(window.innerWidth - 230, r.left - 120)) + 'px'; m.style.top = (r.bottom + 6) + 'px';
    const close = () => { m.remove(); document.removeEventListener('mousedown', out, true); };
    const out = ev => { if (!m.contains(ev.target) && ev.target !== anchor) close(); };
    setTimeout(() => document.addEventListener('mousedown', out, true), 0);
    m.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-m]'); if (!b) return;
      close();
      if (b.dataset.m === 'check') {
        toast('🔄 새 버전 확인 중…');
        chrome.runtime.sendMessage({ action: 'updCheckNow' }, res => {
          void chrome.runtime.lastError;
          if (res && res.latest) { if (res.has) render(res.latest); else toast('✅ 최신 버전입니다 (v' + cur + ')'); }
          else toast('업데이트 확인 실패 — 인터넷 연결을 확인하세요');
        });
      } else if (b.dataset.m === 'auto') { if (isFull) connectAndApply(null, true); else { await chrome.storage.local.set({ updPick: true }); openFull(); } }
      else if (b.dataset.m === 'toggle') { await chrome.storage.local.set({ updAuto: st.updAuto === false }); toast(st.updAuto === false ? '▶ 자동 설치를 켰습니다' : '⏸ 자동 설치를 껐습니다 — 새 버전은 안내만 합니다'); }
      else if (b.dataset.m === 'guide') openGuide();
      else if (b.dataset.m === 'ppdiag') {
        const d = (await chrome.storage.local.get(['paintProDiag'])).paintProDiag;
        if (!d) toast('아직 페인트프로 기록이 없습니다 — 페인트프로를 한 번 실행한 뒤 눌러 주세요');
        else { try { await navigator.clipboard.writeText(d); toast('🔎 마지막 페인트프로 진단 내용을 복사했습니다'); } catch (e) { say(d, '🔎 페인트프로 진단'); } }
      }
    });
  }

  window.__sdhUpd = { unzip, writeFile };   // 점검용

  document.addEventListener('DOMContentLoaded', async () => {
    const vb = document.getElementById('verBadge');
    if (vb) { vb.textContent = 'v' + cur; vb.title = '버전 · 업데이트 설정'; vb.addEventListener('click', () => versionMenu(vb)); }
    const st = await chrome.storage.local.get(['updLatest', 'updCheckedAt', 'updPick', 'updLastApplied']);
    if (st.updLastApplied && st.updLastApplied.v === cur && Date.now() - st.updLastApplied.at < 120000) toast(`🎉 v${cur} 로 업데이트되었습니다`);
    // 큰 창으로 넘어온 경우: 안내 → 클릭 한 번으로 폴더 허락/고르기
    if (isFull && /[?&]upd=1\b/.test(location.search)) {
      const pick = !!st.updPick; if (pick) await chrome.storage.local.remove('updPick');
      setTimeout(async () => {
        const dir = pick ? null : await getDir();
        const msg = dir ? '새 버전을 설치하려면 확장 폴더 사용을 한 번 허락해야 합니다.\n\n[확인] 을 누른 뒤 크롬이 묻는 창에서 「파일 수정 허용」(또는 「방문할 때마다 허용」)을 눌러 주세요.'
          : '자동 업데이트를 켭니다.\n\n[확인] 을 누르면 폴더 고르기 창이 뜹니다. 확장 프로그램을 압축 풀어 둔 폴더(manifest.json · update.bat 이 있는 곳)를 골라 주세요.';
        if (await showConfirm(msg, '⬆ 업데이트')) connectAndApply(null, pick, true);
      }, 400);
    }
    render(st.updLatest || '');
    if (!st.updCheckedAt || Date.now() - st.updCheckedAt > 30 * 60 * 1000) {     // 30분 넘었으면 지금 다시 확인
      chrome.runtime.sendMessage({ action: 'updCheckNow' }, r => { void chrome.runtime.lastError; if (r && r.latest && r.latest !== st.updLatest) render(r.latest); });
    }
  });
})();
