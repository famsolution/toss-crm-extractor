function showCopyButtons(show) {
  const dev = document.getElementById('devToolbar');
  if (dev) dev.style.display = show ? 'flex' : 'none';
  document.getElementById('btnApply').style.display = show ? '' : 'none';
}

function isMasked(v) {
  return typeof v === 'string' && /\*{2,}/.test(v);
}

function renderResult(data) {
  const content = document.getElementById('resultContent');
  const badge = document.getElementById('pageBadge');

  if (data.type === 'customer') {
    badge.textContent = '상세 페이지';
    content.innerHTML = renderCustomer(data.customer);
  } else if (data.type === 'coverage') {
    badge.textContent = '보장 페이지';
    content.innerHTML = renderCoverage(data.insurances);
  } else if (data.type === 'premium_compare') {
    // 🆕 한장으로 보는 보험료 비교 — 보험사 카드 + 담보 수 요약 표시
    badge.textContent = '보험료 비교';
    content.innerHTML = renderPremiumCompare(data);
  } else if (data.type === 'error') {
    showNotice('⚠️', '오류가 발생했습니다', data.error || '');
  } else {
    badge.textContent = '미지원';
    showNotice('🚫', '지원하지 않는 페이지입니다', '상세/보장 또는 보험료 비교 페이지에서 사용해주세요');
  }
}

// 🆕 한장으로 보는 보험료 비교 결과 카드 렌더러
function renderPremiumCompare(data) {
  const cos = (data.companies || []).slice().sort((a, b) => (a.total || 0) - (b.total || 0));
  const covCount = (data.coverages || []).length;
  const filled = (data.coverages || []).filter(c => c.currentValue > 0).length;
  let html = `<div class="alert success">✅ 보험료 비교 데이터 추출 완료 — ${cos.length}개 보험사 · ${covCount}개 담보 (${filled}개 가입금액 입력됨)</div>`;
  html += `<div class="section"><div class="section-header"><span>🏆 보험사별 총보험료 (저렴 순)</span><span class="count">${cos.length}개</span></div>`;
  cos.forEach((c, i) => {
    const rank = i + 1;
    const rankColor = rank === 1 ? '#16a34a' : (rank === 2 ? '#3182f6' : (rank === 3 ? '#f59e0b' : '#64748b'));
    html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #f1f5f9;">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${rankColor};color:#fff;font-weight:800;font-size:11px;">${rank}</span>
      <span style="flex:1;font-weight:700;font-size:13px;">${escapeHtml(c.name || c.code)}</span>
      <span style="font-weight:800;font-size:13px;color:#1e293b;">${(c.total||0).toLocaleString()}원</span>
    </div>`;
  });
  html += `</div>`;
  html += `<div class="alert">▶ <strong>"프로그램에 적용"</strong> 버튼을 누르면 보험료 비교(plan.html) 또는 보장분석의 "보험사별 비교" iframe 으로 자동 채워집니다.</div>`;
  return html;
}

function escapeHtml(s) { return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function renderCustomer(customer) {
  const priorityFields = ['고객명', '성별', '생년월일', '상령일', '연락처', '이메일', '주소', '직업', '하는일',
                          '주민등록번호', '키', '몸무게', '운전여부', '통신사'];
  const otherFields = Object.keys(customer).filter(k =>
    !priorityFields.includes(k) && k !== '고객ID' && !k.startsWith('_')
  );

  let html = '';

  // 마스킹 복원 상태 알림
  if (customer._마스킹복원 === true) {
    html += `<div class="alert success">✅ 마스킹된 정보를 서버에서 복원했습니다</div>`;
  } else if (customer._마스킹복원 === 'partial') {
    html += `<div class="alert">⚠️ 일부 정보만 복원되었습니다 (전화번호만 가능)</div>`;
  } else if (customer._마스킹복원 === false) {
    html += `<div class="alert error">❌ 마스킹 복원 실패 — 권한이 없거나 API 호출이 실패했습니다.<br>토스인슈 CRM에 로그인된 상태인지 확인해주세요.</div>`;
  }

  if (customer._마스킹잔여 && customer._마스킹잔여.length > 0) {
    html += `<div class="alert">⚠️ 일부 필드는 여전히 마스킹되어 있습니다: ${customer._마스킹잔여.join(', ')}</div>`;
  }

  // 마스킹 복원된 필드인지 추정 (값에 *가 없으면 복원된 것)
  const wasMasked = (field) => customer._마스킹복원 === true && ['연락처', '이메일', '주소', '주민등록번호'].includes(field) && !isMasked(customer[field]);

  html += `<div class="section">
    <div class="section-header">
      <span>👤 고객 기본 정보</span>
      <span class="count">ID: ${customer['고객ID'] || '-'}</span>
    </div>`;

  priorityFields.forEach(field => {
    if (customer[field]) {
      const val = customer[field];
      const cls = isMasked(val) ? 'still-masked' : (wasMasked(field) ? 'was-masked' : '');
      html += `<div class="field-row">
        <span class="field-label">${field}</span>
        <span class="field-value ${cls}">${escHtml(val)}</span>
      </div>`;
    }
  });

  html += '</div>';

  if (otherFields.length > 0) {
    html += `<div class="section">
      <div class="section-header">추가 정보</div>`;
    otherFields.forEach(field => {
      html += `<div class="field-row">
        <span class="field-label">${field}</span>
        <span class="field-value ${isMasked(customer[field]) ? 'still-masked' : ''}">${escHtml(customer[field])}</span>
      </div>`;
    });
    html += '</div>';
  }

  return html;
}

function renderCoverage(insurances) {
  if (!insurances || insurances.length === 0) {
    return `<div class="notice"><div class="icon">📋</div><p>보장 내역이 없습니다</p></div>`;
  }

  let html = `<div style="padding: 8px 8px 4px; font-size: 12px; color: #5f6368;">
    총 ${insurances.length}건의 보험 내역
  </div>`;

  insurances.forEach((ins, idx) => {
    const status = ins['계약상태'] || '';
    const statusClass = status.includes('유효') || status.includes('납입중') ? 'status-active'
      : status.includes('소멸') || status.includes('만기') ? 'status-ended'
      : 'status-other';

    html += `<div class="insurance-card">
      <div class="insurance-card-header">
        <span>${escHtml(ins['보험명'] || `보험 ${idx + 1}`)}</span>
        ${status ? `<span class="status-badge ${statusClass}">${escHtml(status)}</span>` : ''}
        <span class="company">${escHtml(ins['보험사명'] || '')}</span>
      </div>`;

    const displayFields = ['보험사명', '계약일', '계약상태', '갱신 유무', '계약자/피보험자', '증권번호',
      '납입 여부', '납입주기/납입기간', '보장만기/만기연령', '납입종료일/종료연령',
      '월납보험료', '기납보험료', '잔여보험료', '총보험료', '대분류', '소분류',
      '매니저 의견', '매니저 코멘트'];

    displayFields.forEach(field => {
      if (ins[field]) {
        html += `<div class="field-row">
          <span class="field-label">${field}</span>
          <span class="field-value">${escHtml(ins[field])}</span>
        </div>`;
      }
    });

    html += '</div>';
  });

  return html;
}

function formatAsText(data) {
  // 🆕 한장으로 보는 보험료 비교 데이터
  if (data && data.type === 'premium_compare') {
    const lines = [`=== 보험료 비교 (${(data.companies||[]).length}개 보험사 · ${(data.coverages||[]).length}개 담보) ===`];
    (data.companies || []).forEach((c, i) => {
      lines.push(`[${i+1}] ${c.name || c.code} — 총 ${(c.total||0).toLocaleString()}원`);
      if (c.productName) lines.push(`     상품: ${c.productName}`);
      if (c.planInfo)    lines.push(`     플랜: ${c.planInfo}`);
    });
    lines.push(`\n--- 담보별 보험료 ---`);
    (data.coverages || []).forEach((cv) => {
      const prs = Object.entries(cv.premiums || {}).map(([co, p]) => `${co}:${(p||0).toLocaleString()}`).join(' / ');
      lines.push(`• ${cv.name} (${cv.cd}) [가입금액 ${cv.guideAmount || 0}만]  ${prs}`);
    });
    lines.push(`\n추출 시각: ${new Date(data.extractedAt).toLocaleString('ko-KR')}`);
    lines.push(`▶ 보험료 비교(plan.html) (또는 보장분석의 "보험사별 비교" 탭) 이 열려있으면 "프로그램에 적용" 버튼으로 자동 채울 수 있습니다.`);
    return lines.join('\n');
  }
  if (data.type === 'customer') {
    const lines = ['=== 고객 정보 ==='];
    Object.entries(data.customer).forEach(([k, v]) => {
      if (k !== '고객ID' && !k.startsWith('_')) lines.push(`${k}: ${v}`);
    });
    if (data.customer['_마스킹잔여']?.length) {
      lines.push(`\n※ 마스킹 남은 필드: ${data.customer['_마스킹잔여'].join(', ')}`);
    }
    lines.push(`\n추출 시각: ${new Date(data.extractedAt).toLocaleString('ko-KR')}`);
    return lines.join('\n');
  }

  if (data.type === 'coverage') {
    const lines = [`=== 보장 내역 (총 ${data.insurances.length}건) === [EXT v3.7.9]`];
    data.insurances.forEach((ins, i) => {
      lines.push(`\n[${i + 1}] ${ins['보험명'] || '보험명 없음'} - ${ins['보험사명'] || ''}`);
      Object.entries(ins).forEach(([k, v]) => {
        if (k !== '보험명' && k !== '보험사명') lines.push(`  ${k}: ${v}`);
      });
    });

    // 상품별 보장 상세 데이터
    if (data.coverageDetails && data.coverageDetails.length > 0) {
      // 상품 요약
      if (data.productSummary && data.productSummary.length > 0) {
        lines.push(`\n\n=== 상품별 보장 추출 요약 (${data.productSummary.length}개 상품) ===`);
        data.productSummary.forEach(s => {
          lines.push(`  • [${s.섹션번호}] ${s.보험사명 || '-'} / ${s.상품명 || '상품명 없음'} → ${s.담보수}개 담보`);
        });
      }
      // 상품별 그룹화하여 출력
      lines.push(`\n\n=== 상품별 보장 목록 (총 ${data.coverageDetails.length}건) ===`);
      const grouped = {};
      data.coverageDetails.forEach(det => {
        const key = `${det['_섹션번호']}::${det['_상품명'] || '미분류'}`;
        if (!grouped[key]) grouped[key] = { 보험사명: det['_보험사명'] || '', 상품명: det['_상품명'] || '미분류', 섹션번호: det['_섹션번호'], rows: [] };
        grouped[key].rows.push(det);
      });
      Object.values(grouped)
        .sort((a, b) => (a.섹션번호 || 0) - (b.섹션번호 || 0))
        .forEach(grp => {
          lines.push(`\n[상품 ${grp.섹션번호}] ${grp.보험사명 ? grp.보험사명 + ' / ' : ''}${grp.상품명}`);
          // 대분류별로 다시 정렬
          const byMajor = {};
          grp.rows.forEach(det => {
            const major = det['보장 대분류'] || '기타';
            if (!byMajor[major]) byMajor[major] = [];
            byMajor[major].push(det);
          });
          Object.entries(byMajor).forEach(([major, dets]) => {
            lines.push(`  ◆ ${major}`);
            dets.forEach(det => {
              const minor = det['보장 소분류'] || '';
              const name = det['보장명'] || '';
              const amount = det['보장 금액'] || '';
              const term = det['납입기간'] || '';
              const start = det['보장시작일'] || '';
              const end = det['보장종료일'] || '';
              const tab = det['_tabType'] || '';
              const aIdx = (typeof det['_accordionIdx'] === 'number') ? det['_accordionIdx'] : -1;
              lines.push(`    • [${minor}] ${name}`);
              // 🔑 텍스트 포맷에 탭/accordion 정보 보존 — 메인 앱 파서가 이 값으로 _tabType / _accordionIdx 복원
              lines.push(`      금액: ${amount} / 납입기간: ${term} / ${start} ~ ${end} [META tab=${tab} aIdx=${aIdx}]`);
            });
          });
        });
    }

    // 🆕 고객 기본정보 블록 — 앱 파서가 이 마커로 customer 복원 (이름/성별/생년월일/상령일/최초보험연결일/상담문의)
    //   ⚠️ formatAsText 가 customer 를 누락하면 앱이 옛 customerInfo 를 그대로 표시하는 버그 → 여기서 항상 동봉.
    if (data.customer && Object.keys(data.customer).length > 0) {
      lines.push(`\n=== 고객 기본정보 ===`);
      const _c = data.customer;
      ['고객명', '성별', '생년월일', '생년월일표시', '상령일', '최초보험연결일', '상담문의', '보험나이'].forEach(k => {
        if (_c[k]) lines.push(`${k}: ${_c[k]}`);
      });
    }
    lines.push(`\n추출 시각: ${new Date(data.extractedAt).toLocaleString('ko-KR')}`);
    return lines.join('\n');
  }

  return '';
}

async function copyToClipboard(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`✅ ${message}`);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(`✅ ${message}`);
  }
}

async function saveData(data) {
  const result = await chrome.storage.sync.get('savedRecords');
  const records = result.savedRecords || [];

  const id = data.type === 'customer'
    ? (data.customer['고객ID'] || Date.now())
    : (data.customerId || Date.now());

  const existingIdx = records.findIndex(r => r.id === String(id) && r.type === data.type);
  const record = {
    id: String(id),
    type: data.type,
    savedAt: new Date().toISOString(),
    name: data.type === 'customer'
      ? (data.customer['고객명'] || '이름 없음')
      : `보장 내역 (${data.customerId})`,
    data
  };

  if (existingIdx >= 0) records[existingIdx] = record;
  else records.unshift(record);

  const trimmed = records.slice(0, 50);
  await chrome.storage.sync.set({ savedRecords: trimmed });
}

async function loadSavedList() {
  const result = await chrome.storage.sync.get('savedRecords');
  const records = result.savedRecords || [];
  const listEl = document.getElementById('savedList');

  if (records.length === 0) {
    listEl.innerHTML = `<div class="notice">
      <div class="icon">📂</div>
      <p>저장된 데이터가 없습니다</p>
      <p class="sub">현재 페이지에서 데이터를 추출하고 저장해보세요</p>
    </div>`;
    return;
  }

  listEl.innerHTML = records.map(rec => `
    <div class="saved-item">
      <div class="saved-item-info">
        <div class="name">${escHtml(rec.name)}</div>
        <div class="meta">${rec.type === 'customer' ? '👤 고객정보' : '📋 보장내역'} · ${new Date(rec.savedAt).toLocaleString('ko-KR')}</div>
      </div>
      <div class="saved-item-actions">
        <button class="btn-sm btn-copy btn-load" data-id="${escHtml(rec.id)}" data-type="${rec.type}">복사</button>
        <button class="btn-sm btn-danger btn-delete" data-id="${escHtml(rec.id)}" data-type="${rec.type}">삭제</button>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('.btn-load').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { id, type } = btn.dataset;
      const result = await chrome.storage.sync.get('savedRecords');
      const rec = (result.savedRecords || []).find(r => r.id === id && r.type === type);
      if (rec) copyToClipboard(formatAsText(rec.data), '클립보드에 복사되었습니다');
    });
  });

  listEl.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { id, type } = btn.dataset;
      const result = await chrome.storage.sync.get('savedRecords');
      const records = (result.savedRecords || []).filter(r => !(r.id === id && r.type === type));
      await chrome.storage.sync.set({ savedRecords: records });
      showToast('🗑️ 삭제되었습니다');
      loadSavedList();
    });
  });
}

function showNotice(icon, title, sub = '') {
  document.getElementById('resultContent').innerHTML = `
    <div class="notice">
      <div class="icon">${icon}</div>
      <p>${title}</p>
      ${sub ? `<p class="sub">${sub}</p>` : ''}
    </div>`;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  const badge = document.getElementById('pageBadge');

  // 🆕 한장으로 보는 보험료 비교 페이지 패턴 — file:// 저장본까지 폭넓게 인식
  const isPremiumCompare = (
    url.includes('mmlfcp.ohmymanager.com') ||
    url.includes('ohmymanager.com') ||
    /한장으로|한장으로%20|premium_plan|premium-compare|tossinssu-pro\.vercel\.app\/plan\.html/i.test(url) ||
    /보험료%20비교|보험료비교/.test(url)
  );

  if (url.includes('crm.tossinsu.com/crm-v2/customers/')) {
    badge.textContent = '상세 페이지';
    badge.style.background = 'rgba(52, 168, 83, 0.3)';
  } else if (url.includes('crm.tossinsu.com/crm-v2/cover/')) {
    badge.textContent = '보장 페이지';
    badge.style.background = 'rgba(52, 168, 83, 0.3)';
  } else if (url.includes('crm.tossinsu.com')) {
    badge.textContent = 'CRM 접속 중';
  } else if (isPremiumCompare) {
    badge.textContent = '보험료 비교';
    badge.style.background = 'rgba(59, 130, 246, 0.35)';
  } else if (/^file:\/\//i.test(url)) {
    // file:// — 일단 추출 시도 허용. content.js 가 DOM 보고 페이지 타입 자동 판정
    badge.textContent = '로컬 파일';
    badge.style.background = 'rgba(100, 116, 139, 0.35)';
  } else {
    // 알 수 없는 페이지여도 비활성화하지 않음 — 사용자가 시도하면 content.js 가 페이지 타입 검사 후 알려줌
    badge.textContent = '외부 페이지';
    // 안내 메시지만 (버튼은 활성 유지)
    showNotice('ℹ️', '지원 페이지', 'CRM 상세/보장 페이지 또는 한장으로 보는 보험료 비교 페이지에서 사용하세요. 그 외 페이지에서는 추출이 동작하지 않을 수 있습니다.');
  }
})();
