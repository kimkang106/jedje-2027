(() => {
'use strict';
const EP = (window.JEDJE_ENDPOINT || '').trim();
const ADMIN = '김시형(장학사)';
const ADVISOR = '박준형';
const SEM = ['1-1','1-2','2-1','2-2','3-1','3-2'];
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
let DATA = null, PLANS = null, view = 'mine', cur = null, filterM = '';
let me = ls.get('jedje.me', {who: '', pin: ''});
let OP = {};               // key -> record (server + local)
let pending = ls.get('jedje.pending', {});   // key -> fields not yet saved
let online = false;

// ---------- data ----------
async function load() {
  DATA = await (await fetch('data/schools.json')).json();
  $('#asof').textContent = `1차 자동 점검 ${DATA.meta.asof} 기준 · 학교 ${DATA.schools.length}교 · 위원 ${DATA.meta.members.length}명`;
  const sel = $('#who');
  DATA.meta.members.forEach(m => sel.insertAdjacentHTML('beforeend', `<option>${esc(m.name)}</option>`));
  sel.insertAdjacentHTML('beforeend', `<option>${esc(ADMIN)}</option>`);
  sel.value = me.who || ''; $('#pin').value = me.pin || '';
  Object.assign(OP, ls.get('jedje.local', {}));
  await pull();
  render();
}
async function pull() {
  if (!EP) { setConn('저장 서버가 아직 연결되지 않았습니다. 입력한 의견은 이 브라우저에만 임시 저장됩니다.'); return; }
  try {
    const r = await fetch(EP + '?action=all', {cache: 'no-store'});
    const j = await r.json();
    (j.rows || []).forEach(x => { OP[x.key] = Object.assign({}, OP[x.key] || {}, x); });
    Object.entries(pending).forEach(([k, v]) => { OP[k] = Object.assign({}, OP[k] || {}, v); });
    online = true; setConn(`저장 서버 연결됨 · ${new Date().toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit'})} 기준` + (Object.keys(pending).length ? ` · 아직 보내지 못한 의견 ${Object.keys(pending).length}건` : ''));
    if (Object.keys(pending).length) flush();
  } catch (e) { online = false; setConn('저장 서버에 연결하지 못했습니다. 의견은 이 브라우저에 임시 저장되고, 연결되면 다시 보냅니다.'); }
}
function setConn(t) { $('#conn').textContent = t; }
let flushing = false;
async function flush() {
  if (!EP || flushing) return;
  flushing = true;
  for (const [k, v] of Object.entries(pending)) {
    try {
      const r = await fetch(EP, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({action: 'save', member: me.who, pin: me.pin, rec: Object.assign({key: k}, v)})});
      const j = await r.json();
      if (j.ok) { delete pending[k]; }
      else if (j.error === 'auth') { setConn('확인 코드가 맞지 않아 저장하지 못했습니다. 위원 이름과 코드를 확인해 주세요.'); break; }
    } catch (e) { break; }
  }
  ls.set('jedje.pending', pending); flushing = false;
  if (!Object.keys(pending).length && EP) setConn('모든 의견이 저장 서버에 저장되었습니다.');
}
let tmr = null;
function save(key, fields) {
  const base = {member: me.who, ts: new Date().toISOString()};
  OP[key] = Object.assign({key}, OP[key] || {}, fields, base);
  pending[key] = Object.assign({}, pending[key] || {}, fields, base);
  const local = ls.get('jedje.local', {}); local[key] = OP[key]; ls.set('jedje.local', local);
  ls.set('jedje.pending', pending);
  clearTimeout(tmr); tmr = setTimeout(flush, 700);
}

// ---------- helpers ----------
const isAdmin = () => me.who === ADMIN;
const mySchools = () => DATA.schools.filter(s => isAdmin() ? (!filterM || s.m === filterM) : s.m === me.who);
const ikey = (s, e, r) => `i|${s.code}|${e.dept}|${r[0]}`;
function needItems(s) {
  const a = [];
  s.entries.forEach(e => e.res.forEach(r => { if (r[2] === '부적합' || r[2] === '확인 필요') a.push({s, e, r, key: ikey(s, e, r)}); }));
  return a;
}
function prog(s) {
  const n = needItems(s); const done = n.filter(x => OP[x.key] && OP[x.key].verdict).length;
  const sk = OP['s|' + s.code] || {};
  return {n: n.length, done, fin: !!sk.done};
}
const pillSt = st => st === '부적합' ? 'p-no' : st === '확인 필요' ? 'p-ck' : st === '적합' ? 'p-ok' : 'p-wt';

// ---------- views ----------
function render() {
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.v === view)));
  const v = $('#view');
  if (!me.who) { v.innerHTML = `<div class="notice">위에서 위원 이름을 고르고, 단톡방으로 안내받은 확인 코드를 넣은 뒤 <b>시작</b>을 눌러 주세요.</div>` + guideHTML(); return; }
  if (cur && view === 'mine') { v.innerHTML = ''; v.append(detail(cur)); return; }
  if (view === 'mine') v.innerHTML = listHTML();
  else if (view === 'dl') { v.innerHTML = dlHTML(); bindDl(); return; }
  else if (view === 'adv') v.innerHTML = advHTML();
  else if (view === 'all') v.innerHTML = allHTML();
  else v.innerHTML = guideHTML();
  bindList();
}
function listHTML() {
  const ss = mySchools();
  const tot = ss.reduce((a, s) => { const p = prog(s); a.n += p.n; a.d += p.done; a.f += p.fin; return a; }, {n: 0, d: 0, f: 0});
  let h = `<div class="bar"><div><h2>${isAdmin() ? '전체 학교' : esc(me.who) + ' 위원 담당 학교'}</h2>
  <p class="muted">${ss.length}교 · 검토 완료 ${tot.f}교 · 판정한 항목 ${tot.d}/${tot.n}</p></div>
  <div class="flex">${isAdmin() ? `<select id="fm" style="width:auto"><option value="">위원 전체</option>${DATA.meta.members.map(m => `<option ${filterM === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>` : ''}
  <button class="btn sm" id="exp">내 의견 엑셀로 내려받기</button></div></div>
  <p class="tiny" style="margin:-4px 0 10px">검토량이 많은 학교부터 보여 줍니다. 노란·빨간 숫자는 1차 자동 점검에서 확인 필요·부적합으로 나온 항목 수입니다.</p><div class="grid">`;
  ss.forEach(s => {
    const p = prog(s);
    h += `<button class="sc" data-code="${esc(s.code)}">
      <div class="row"><h3>${esc(s.name)}</h3>${p.fin ? '<span class="pill p-ok">검토 완료</span>' : ''}</div>
      <div class="row tiny">${esc(s.sg)} · ${esc(s.kind)} · ${esc(s.src)}${isAdmin() ? ' · ' + esc(s.m) : ''}</div>
      <div class="row">${s.st !== '제출' ? `<span class="pill p-wt">${esc(s.st)}</span>` : ''}
        <span class="pill ${s.b ? 'p-no' : 'p-wt'}">부적합 ${s.b}</span><span class="pill ${s.c ? 'p-ck' : 'p-wt'}">확인 필요 ${s.c}</span>
        ${s.adv ? `<span class="pill p-adv">자문 ${esc(s.adv)}</span>` : ''}</div>
      <div class="prog" aria-label="판정 진행"><i style="width:${p.n ? Math.round(p.done / p.n * 100) : (p.fin ? 100 : 0)}%"></i></div>
      <div class="tiny">판정 ${p.done}/${p.n}</div></button>`;
  });
  return h + '</div>';
}
function bindList() {
  document.querySelectorAll('.sc').forEach(b => b.onclick = () => { cur = DATA.schools.find(s => s.code === b.dataset.code); view = 'mine'; render(); scrollTo(0, 0); });
  const fm = $('#fm'); if (fm) fm.onchange = () => { filterM = fm.value; render(); };
  const ex = $('#exp'); if (ex) ex.onclick = exportXlsx;
  document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { cur = DATA.schools.find(s => s.code === b.dataset.open); view = 'mine'; render(); scrollTo(0, 0); });
  document.querySelectorAll('[data-advsave]').forEach(b => b.onclick = () => {
    const k = b.dataset.advsave; const t = document.getElementById('a_' + b.dataset.i);
    save(k, {advNote: t.value, advBy: me.who}); b.textContent = '저장됨'; setTimeout(() => b.textContent = '자문 의견 저장', 1500);
  });
}

function detail(s) {
  const el = document.createElement('div'); el.className = 'detail';
  const p = prog(s); const sk = OP['s|' + s.code] || {};
  el.innerHTML = `<div class="stick"><button class="btn sm" id="back">← 목록으로</button></div>
  <section class="card dhead"><div class="flex"><h2>${esc(s.name)}</h2>${s.st !== '제출' ? `<span class="pill p-wt">${esc(s.st)}</span>` : ''}${s.adv ? `<span class="pill p-adv">직업계 자문 ${esc(s.adv)}</span>` : ''}</div>
   <div class="kv"><span>${esc(s.sg)}</span><span>${esc(s.kind)}</span><span>자료 <b>${esc(s.src)}</b></span><span>담당 <b>${esc(s.m)}</b></span><span>부적합 <b>${s.b}</b> · 확인 필요 <b>${s.c}</b></span></div></section>
  <section class="card sec"><h3>편제표 자료</h3><div class="flex" id="files"></div><div id="plan"></div></section>
  <section class="card sec"><h3>1차 자동 점검 결과와 위원 판정</h3>
   <p class="tiny">빨간·노란 항목마다 <b>위원 판정</b>을 골라 주세요. 자동 점검이 잘못 잡은 경우는 "오검출"을 고르면 됩니다. 입력하면 바로 저장됩니다.</p><div id="items" class="detail"></div></section>
  <section class="card sec"><h3>학교 종합 의견</h3>
   <textarea id="memo" placeholder="학교에 환류할 종합 의견(선택)">${esc(sk.memo || '')}</textarea>
   <div class="chk"><label><input type="checkbox" id="fin" ${sk.done ? 'checked' : ''}> 이 학교 검토를 마쳤습니다</label></div>
   <span class="saved" id="sv"></span></section>`;
  el.querySelector('#back').onclick = () => { cur = null; render(); };
  // files
  const fw = el.querySelector('#files');
  s.files.forEach((f, i) => {
    fw.insertAdjacentHTML('beforeend', `<a class="btn sm" href="${esc(f.f)}" download="${esc(f.name)}">⬇ ${esc(f.name)}</a><button class="btn sm" data-xl="${i}">화면에서 보기</button>`);
  });
  if (s.hasPlan) fw.insertAdjacentHTML('beforeend', `<button class="btn sm" id="sp">입력 시스템 편제표 보기</button>`);
  if (!s.files.length && !s.hasPlan) fw.innerHTML = `<span class="muted">아직 볼 수 있는 편제표가 없습니다(${esc(s.st)}).</span>`;
  fw.querySelectorAll('[data-xl]').forEach(b => b.onclick = () => showXlsx(s.files[+b.dataset.xl], el.querySelector('#plan')));
  const sp = fw.querySelector('#sp'); if (sp) sp.onclick = () => showPlan(s, el.querySelector('#plan'));
  // items
  const iw = el.querySelector('#items');
  s.entries.forEach(e => {
    const box = document.createElement('div'); box.className = 'detail';
    const ok = e.res.filter(r => r[2] !== '부적합' && r[2] !== '확인 필요');
    box.insertAdjacentHTML('beforeend', `<div class="flex"><span class="pill p-acc">${esc(e.form)}</span><b>${esc(e.dept || '단일 과정')}</b>${e.total ? `<span class="tiny">교과 ${e.total[0] === e.total[1] ? e.total[0] : e.total[0] + '~' + e.total[1]}학점</span>` : ''}</div>`);
    e.res.filter(r => r[2] === '부적합' || r[2] === '확인 필요').forEach(r => box.append(itemEl(s, e, r)));
    if (ok.length) box.insertAdjacentHTML('beforeend', `<details class="fold"><summary>적합·해당 없음 ${ok.length}개 보기</summary><div class="tw"><table><tr><th>번호</th><th>항목</th><th>판정</th><th>내용</th></tr>${ok.map(r => `<tr><td class="n">${r[0]}</td><td>${esc(r[1])}</td><td class="n"><span class="pill ${pillSt(r[2])}">${esc(r[2])}</span></td><td>${esc(r[3])}</td></tr>`).join('')}</table></div></details>`);
    if (e.notes && e.notes.length) box.insertAdjacentHTML('beforeend', `<p class="tiny">참고: ${e.notes.map(n => esc(n[0] + ' — ' + n[2])).join(' / ')}</p>`);
    iw.append(box);
  });
  if (!s.entries.length) iw.innerHTML = `<p class="muted">편제표가 아직 제출되지 않아 자동 점검 결과가 없습니다.</p>`;
  const memo = el.querySelector('#memo'), fin = el.querySelector('#fin'), sv = el.querySelector('#sv');
  const ss = () => { save('s|' + s.code, {code: s.code, school: s.name, memo: memo.value, done: fin.checked}); sv.textContent = '저장됨'; };
  memo.onchange = ss; fin.onchange = ss;
  return el;
}
function itemEl(s, e, r) {
  const k = ikey(s, e, r), o = OP[k] || {};
  const voc = !!s.adv || s.m === ADVISOR && false;
  const d = document.createElement('div'); d.className = 'item ' + (r[2] === '부적합' ? 'no' : 'ck');
  d.innerHTML = `<div class="t"><span class="pill ${pillSt(r[2])}">${esc(r[2])}</span><b>${r[0]}. ${esc(r[1])}</b></div>
   <div class="d">${esc(r[3])}</div>
   <div class="ctl"><select aria-label="위원 판정"><option value="">위원 판정 선택</option>${['적합', '부적합', '오검출(자동 점검 오류)'].map(v => `<option ${o.verdict === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
   <textarea placeholder="의견(학교 환류 문구 또는 메모)">${esc(o.note || '')}</textarea></div>
   <div class="chk"><label><input type="checkbox" class="fb" ${o.fb ? 'checked' : ''}> 학교 환류 필요</label>
   ${s.adv ? `<label><input type="checkbox" class="ar" ${o.advReq ? 'checked' : ''}> ${esc(s.adv)} 위원에게 자문 요청</label>` : ''}</div>
   ${o.advNote ? `<div class="advbox"><b>자문 의견(${esc(o.advBy || ADVISOR)})</b><br>${esc(o.advNote)}</div>` : ''}
   <span class="saved"></span>`;
  const sel = d.querySelector('select'), ta = d.querySelector('textarea'), fb = d.querySelector('.fb'), ar = d.querySelector('.ar'), sv = d.querySelector('.saved');
  const f = () => { save(k, {code: s.code, school: s.name, dept: e.dept, no: r[0], title: r[1], auto: r[2], detail: r[3], verdict: sel.value, note: ta.value, fb: fb.checked, advReq: ar ? ar.checked : false, owner: s.m});
    sv.textContent = '저장됨 ' + new Date().toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit'}); };
  sel.onchange = f; ta.onchange = f; fb.onchange = f; if (ar) ar.onchange = f;
  return d;
}
async function showXlsx(f, host) {
  host.innerHTML = '<p class="muted">파일을 여는 중…</p>';
  if (!window.XLSX) { host.innerHTML = '<p class="muted">미리보기 도구를 불러오지 못했습니다. 내려받아 열어 주세요.</p>'; return; }
  try {
    const wb = XLSX.read(await (await fetch(f.f)).arrayBuffer(), {type: 'array'});
    const names = wb.SheetNames.filter(n => !/삭제금지|참고/.test(n));
    host.innerHTML = `<div class="flex" style="margin-bottom:8px"><select id="shs" style="width:auto">${names.map(n => `<option>${esc(n)}</option>`).join('')}</select><span class="tiny">엑셀 원본 그대로 보여 줍니다(병합 셀은 펼쳐 보임)</span></div><div class="tw xl" id="shv"></div>`;
    const draw = () => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[host.querySelector('#shs').value], {header: 1, blankrows: false, defval: ''});
      const w = Math.max(...rows.map(r => { let i = r.length; while (i > 0 && r[i - 1] === '') i--; return i; }));
      host.querySelector('#shv').innerHTML = `<table>${rows.map(r => `<tr>${Array.from({length: w}, (_, i) => `<td>${esc(r[i])}</td>`).join('')}</tr>`).join('')}</table>`;
    };
    host.querySelector('#shs').onchange = draw; draw();
  } catch (e) { host.innerHTML = '<p class="muted">파일을 열지 못했습니다. 내려받아 열어 주세요.</p>'; }
}
async function showPlan(s, host) {
  host.innerHTML = '<p class="muted">편제표를 불러오는 중…</p>';
  if (!PLANS) PLANS = await (await fetch('data/plans.json')).json();
  const ps = PLANS[s.code] || [];
  host.innerHTML = ps.map(p => {
    let h = `<h3 style="margin:10px 0 6px">${esc(p.dept || '단일 과정')} <span class="tiny">입력 시스템 저장 ${esc(p.saved)}</span></h3><div class="tw xl"><table><tr><th>교과(군)</th><th>과목</th><th>유형</th><th>기본</th><th>범위</th>${SEM.map(x => `<th>${x}</th>`).join('')}<th>비고</th></tr>`;
    p.g.forEach(g => {
      const lab = g.d === '지정' ? '지정' : `${g.p ? '순증 ' : ''}${g.d} · ${g.k}${g.same ? ` · 과목당 ${g.c}학점` : ''}`;
      h += `<tr class="gh"><td colspan="${6 + SEM.length}">${esc(lab)}</td></tr>`;
      g.s.forEach(x => {
        const cr = g.same ? SEM.map((_, i) => g.sems.includes(i) ? '○' : '') : x[5];
        h += `<tr><td>${esc(x[0])}</td><td><b>${esc(x[1])}</b></td><td>${esc(x[2])}</td><td class="n">${esc(x[3])}</td><td class="n">${esc(x[4])}</td>${cr.map(c => `<td class="n">${esc(c)}</td>`).join('')}<td>${esc(x[6])}</td></tr>`;
      });
    });
    const ch = p.ch || {};
    h += `<tr class="gh"><td colspan="${6 + SEM.length}">창의적 체험활동(시간)</td></tr>` + ['자율·자치', '동아리', '진로'].map((n, i) => `<tr><td colspan="5">${n}</td>${(ch[i] || ch[String(i)] || []).map(c => `<td class="n">${esc(c)}</td>`).join('')}<td></td></tr>`).join('');
    return h + '</table></div>';
  }).join('') + `<p class="tiny">"○"는 그 학기에 개설되는 선택 그룹(과목당 학점은 그룹 표시 참고)입니다.</p>`;
}
function advHTML() {
  const amAdv = me.who === ADVISOR || isAdmin();
  const rows = Object.values(OP).filter(o => o.key && o.key.startsWith('i|') && o.advReq && (amAdv || o.member === me.who || o.owner === me.who));
  let h = `<h2>${amAdv ? '직업계 자문 요청함' : '내가 요청한 자문'}</h2><p class="muted" style="margin:4px 0 12px">${amAdv ? '위원들이 전문교과 판단을 요청한 항목입니다. 해당 항목만 보고 자문 의견을 남겨 주세요.' : '직업계 학교의 전문교과 판단이 어려우면 항목에서 "자문 요청"을 체크하세요. 박준형 위원의 답이 여기에 표시됩니다.'}</p>`;
  if (!rows.length) return h + '<div class="notice">아직 자문 요청이 없습니다.</div>';
  rows.sort((a, b) => (!!a.advNote - !!b.advNote) || String(a.school).localeCompare(b.school));
  rows.forEach((o, i) => {
    h += `<div class="item ${o.auto === '부적합' ? 'no' : 'ck'}" style="margin-bottom:10px"><div class="t"><b>${esc(o.school)}</b><span class="tiny">${esc(o.dept)} · 담당 ${esc(o.owner || o.member)}</span>${o.advNote ? '<span class="pill p-ok">답변함</span>' : '<span class="pill p-adv">대기</span>'}</div>
     <div><b>${esc(o.no)}. ${esc(o.title)}</b> <span class="pill ${pillSt(o.auto)}">${esc(o.auto)}</span></div><div class="d">${esc(o.detail)}</div>
     ${o.note ? `<div class="d"><b>담당 위원 메모:</b> ${esc(o.note)}</div>` : ''}
     ${amAdv ? `<textarea id="a_${i}" placeholder="자문 의견">${esc(o.advNote || '')}</textarea><div class="flex"><button class="btn sm pri" data-advsave="${esc(o.key)}" data-i="${i}">자문 의견 저장</button><button class="btn sm" data-open="${esc(o.code)}">학교 열기</button></div>`
             : (o.advNote ? `<div class="advbox"><b>자문 의견</b><br>${esc(o.advNote)}</div>` : '')}</div>`;
  });
  return h;
}
function allHTML() {
  let h = `<h2>위원별 진행</h2><p class="muted" style="margin:4px 0 12px">저장 서버 기준입니다. ${online ? '' : '(서버 미연결 — 이 브라우저 기록만 반영)'}</p><div class="tw"><table><tr><th>위원</th><th>소속</th><th>학교</th><th>검토 완료</th><th>판정 항목</th><th>환류 필요</th><th>자문 요청(답변)</th></tr>`;
  const T = {s: 0, f: 0, n: 0, d: 0, fb: 0, ar: 0, aa: 0};
  DATA.meta.members.forEach(m => {
    const ss = DATA.schools.filter(s => s.m === m.name); let f = 0, n = 0, d = 0, fb = 0, ar = 0, aa = 0;
    ss.forEach(s => { const p = prog(s); f += p.fin; n += p.n; d += p.done; needItems(s).forEach(x => { const o = OP[x.key] || {}; fb += !!o.fb; ar += !!o.advReq; aa += !!(o.advReq && o.advNote); }); });
    Object.entries({s: ss.length, f, n, d, fb, ar, aa}).forEach(([k, v]) => T[k] += v);
    h += `<tr><td><b>${esc(m.name)}</b></td><td>${esc(m.aff)}</td><td class="n">${ss.length}</td><td class="n">${f}/${ss.length}</td><td class="n">${d}/${n}</td><td class="n">${fb}</td><td class="n">${ar}(${aa})</td></tr>`;
  });
  h += `<tr class="gh"><td>합계</td><td></td><td class="n">${T.s}</td><td class="n">${T.f}/${T.s}</td><td class="n">${T.d}/${T.n}</td><td class="n">${T.fb}</td><td class="n">${T.ar}(${T.aa})</td></tr></table></div>`;
  return h;
}
// ---------- 편제표 내려받기 ----------
let dlSel = new Set(), dlF = {kind: '', sg: '', mine: false, q: ''};
const kindGroup = k => /특성화|마이스터|고등기술|대안형/.test(k) ? '직업계고' : k === '종합고' ? '종합고' : /특목/.test(k) ? '특목고' : (k === '자공고' || k === '자사고') ? k : '일반고';
const short = n => n.replace('고등학교', '고').replace('고등기술학교', '고등기술');
function dlList() {
  return DATA.schools.filter(s => (!dlF.kind || kindGroup(s.kind) === dlF.kind) && (!dlF.sg || s.sg === dlF.sg) && (!dlF.mine || s.m === me.who) && (!dlF.q || s.name.includes(dlF.q)))
    .slice().sort((a, b) => a.sg.localeCompare(b.sg) || a.name.localeCompare(b.name));
}
function dlHTML() {
  const sgs = [...new Set(DATA.schools.map(s => s.sg))].sort();
  const kinds = ['일반고', '자공고', '자사고', '특목고', '종합고', '직업계고'];
  const L = dlList();
  return `<h2>편제표 내려받기</h2><p class="muted" style="margin:4px 0 12px">학교를 골라 한꺼번에 내려받습니다. 일반고 등은 입력 시스템 저장본을 엑셀·PDF로 바꾼 파일, 직업계고는 학교가 제출한 엑셀 원본(PDF 변환본 포함)입니다. 여러 학교를 고르면 압축(zip) 파일 하나로 받습니다.</p>
  <div class="filters"><select id="fk"><option value="">계열 전체</option>${kinds.map(k => `<option ${dlF.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
  <select id="fs"><option value="">시군 전체</option>${sgs.map(k => `<option ${dlF.sg === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
  <input type="text" id="fq" placeholder="학교명 검색" value="${esc(dlF.q)}">
  ${isAdmin() ? '' : `<label class="chk"><input type="checkbox" id="fmine" ${dlF.mine ? 'checked' : ''}> 내 담당만</label>`}</div>
  <div class="flex" style="margin-bottom:8px"><button class="btn sm" id="selall">보이는 학교 모두 선택</button><button class="btn sm" id="selnone">선택 해제</button><span class="tiny">${L.length}교 표시</span></div>
  <div class="card">${L.map(s => {
    const has = (s.plan ? 1 : 0) + s.files.length;
    const what = s.plan ? `입력 시스템 편제표${s.entries.length > 1 ? ` (${s.entries.filter(e => e.form === '양식1').length}개 과정)` : ''}` : s.files.length ? `제출 엑셀 ${s.files.length}개` : '';
    const extra = s.plan && s.files.length ? ` + 제출 엑셀 ${s.files.length}개` : '';
    return `<div class="dlrow"><input type="checkbox" id="d_${s.code}" data-dl="${s.code}" ${dlSel.has(s.code) ? 'checked' : ''} ${has ? '' : 'disabled'}>
     <label for="d_${s.code}"><b>${esc(s.name)}</b> <span class="tiny">${esc(s.sg)} · ${esc(s.kind)} · 담당 ${esc(s.m)}</span><br><span class="tiny">${has ? esc(what + extra) : '편제표 없음(' + esc(s.st) + ')'}</span></label>
     <span class="flex">${s.plan ? `<a class="btn sm" href="${esc(s.plan.x)}" download="${esc(short(s.name))}_편제표.xlsx">엑셀</a><a class="btn sm" href="${esc(s.plan.p)}" target="_blank" rel="noopener">PDF</a>` : ''}
     ${s.files.map(f => `<a class="btn sm" href="${esc(f.f)}" download="${esc(f.name)}">원본</a>`).join('')}</span></div>`;
  }).join('')}</div>
  <div class="dlbar"><div><b id="dlc">${dlSel.size}교 선택</b><div class="chk" style="margin-top:4px"><label><input type="checkbox" id="ox" checked> 엑셀</label><label><input type="checkbox" id="op"> PDF</label></div></div>
   <div class="flex"><button class="btn" id="merge" title="일반고 등 입력 시스템 편제표만 합칩니다">엑셀 한 파일로 합치기</button><button class="btn pri" id="dlgo">선택한 학교 zip으로 받기</button></div>
   <div class="tiny" id="dlmsg" style="flex-basis:100%"></div></div>`;
}
function bindDl() {
  const re = () => { $('#view').innerHTML = dlHTML(); bindDl(); };
  $('#fk').onchange = e => { dlF.kind = e.target.value; re(); };
  $('#fs').onchange = e => { dlF.sg = e.target.value; re(); };
  $('#fq').onchange = e => { dlF.q = e.target.value.trim(); re(); };
  const fm = $('#fmine'); if (fm) fm.onchange = e => { dlF.mine = e.target.checked; re(); };
  document.querySelectorAll('[data-dl]').forEach(c => c.onchange = () => { c.checked ? dlSel.add(c.dataset.dl) : dlSel.delete(c.dataset.dl); $('#dlc').textContent = dlSel.size + '교 선택'; });
  $('#selall').onclick = () => { dlList().forEach(s => { if (s.plan || s.files.length) dlSel.add(s.code); }); re(); };
  $('#selnone').onclick = () => { dlSel.clear(); re(); };
  $('#dlgo').onclick = dlZip; $('#merge').onclick = dlMerge;
}
function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
async function dlZip() {
  const msg = $('#dlmsg'), ox = $('#ox').checked, op = $('#op').checked;
  if (!dlSel.size) { msg.textContent = '학교를 먼저 선택해 주세요.'; return; }
  if (!ox && !op) { msg.textContent = '엑셀·PDF 중 하나 이상 골라 주세요.'; return; }
  if (!window.JSZip) { msg.textContent = '압축 도구를 불러오지 못했습니다. 새로 고침 후 다시 시도해 주세요.'; return; }
  const zip = new JSZip(); const ss = DATA.schools.filter(s => dlSel.has(s.code));
  const jobs = [];
  ss.forEach(s => {
    const base = `[${s.sg}] ${short(s.name)}`;
    if (s.plan) { if (ox) jobs.push([s.plan.x, `${base}_편제표.xlsx`]); if (op) jobs.push([s.plan.p, `${base}_편제표.pdf`]); }
    s.files.forEach((f, i) => { const nm = f.name.replace(/\.xlsx$/, ''); if (ox) jobs.push([f.f, `${nm}(제출 원본).xlsx`]); if (op && f.pdf) jobs.push([f.pdf, `${nm}(제출 원본).pdf`]); });
  });
  let done = 0; const btn = $('#dlgo'); btn.disabled = true;
  try {
    for (let i = 0; i < jobs.length; i += 6) {
      await Promise.all(jobs.slice(i, i + 6).map(async ([u, n]) => { const r = await fetch(u); if (r.ok) zip.file(n, await r.arrayBuffer()); done++; msg.textContent = `파일 모으는 중 ${done}/${jobs.length}`; }));
    }
    msg.textContent = '압축하는 중…';
    const blob = await zip.generateAsync({type: 'blob'});
    saveBlob(blob, `2027 신입생 편제표_${ss.length}교.zip`);
    msg.textContent = `${ss.length}교 · 파일 ${jobs.length}개를 받았습니다.` + (op && ss.some(s => s.files.some(f => !f.pdf)) ? ' (일부 직업계고 원본은 PDF 변환이 안 되어 엑셀만 들어 있습니다)' : '');
  } catch (e) { msg.textContent = '내려받기 중 오류가 났습니다. 학교 수를 줄여 다시 시도해 주세요.'; }
  btn.disabled = false;
}
async function dlMerge() {
  const msg = $('#dlmsg');
  const ss = DATA.schools.filter(s => dlSel.has(s.code) && s.plan);
  if (!ss.length) { msg.textContent = '입력 시스템 편제표가 있는 학교(일반고 등)를 선택해 주세요. 직업계고 원본은 양식이 달라 합치지 않습니다.'; return; }
  if (!window.XLSX) { msg.textContent = '엑셀 도구를 불러오지 못했습니다.'; return; }
  const out = XLSX.utils.book_new(); const used = new Set(); let n = 0;
  for (const s of ss) {
    const wb = XLSX.read(await (await fetch(s.plan.x)).arrayBuffer(), {type: 'array'});
    wb.SheetNames.forEach(sn => {
      let nm = (short(s.name) + (wb.SheetNames.length > 1 || sn !== '편제표' ? '_' + sn : '')).replace(/[\\/*?:\[\]]/g, '').slice(0, 31);
      let k = nm, i = 2; while (used.has(k)) k = nm.slice(0, 28) + '_' + i++; used.add(k);
      XLSX.utils.book_append_sheet(out, wb.Sheets[sn], k);
    });
    msg.textContent = `합치는 중 ${++n}/${ss.length}`;
  }
  XLSX.writeFile(out, `2027 신입생 편제표 모음_${ss.length}교.xlsx`);
  msg.textContent = `${ss.length}교를 시트별로 한 파일에 담았습니다(서식은 단순화됨).` + (DATA.schools.some(s => dlSel.has(s.code) && !s.plan) ? ' 직업계고 원본은 제외했습니다.' : '');
}

function guideHTML() {
  return `<section class="card sec" style="margin-top:12px"><h2>점검 안내</h2><ol class="guide">
  <li><b>위원 이름과 확인 코드</b>를 넣고 시작합니다. 같은 기기에서는 다음부터 자동으로 기억합니다.</li>
  <li><b>내 담당 학교</b>에서 학교를 엽니다. 검토량이 많은 학교가 위에 있습니다.</li>
  <li>편제표는 <b>입력 시스템 편제표 보기</b>(일반고 등) 또는 <b>엑셀 화면에서 보기·내려받기</b>(직업계고)로 확인합니다.</li>
  <li>1차 자동 점검의 <span class="pill p-no">부적합</span> <span class="pill p-ck">확인 필요</span> 항목마다 <b>위원 판정</b>(적합 / 부적합 / 오검출)과 의견을 남깁니다. 학교에 알려야 하면 <b>학교 환류 필요</b>를 체크합니다.</li>
  <li><b>직업계고</b>는 총 학점·체육·창체처럼 숫자로 정해지는 항목은 자동 점검 결과를 확인만 하면 됩니다. 전문교과 분류, 학기 단위·연속 학기, 실무 과목 능력단위, 고시 외 과목처럼 판단이 필요한 항목은 <b>자문 요청</b>을 체크하면 박준형 위원이 그 항목만 보고 답합니다.</li>
  <li><b>편제표 내려받기</b> 탭에서 여러 학교를 골라 엑셀·PDF를 zip 하나로 받거나, 일반고 편제표를 엑셀 한 파일(학교별 시트)로 합쳐 비교할 수 있습니다.</li>
  <li>학교를 다 봤으면 <b>학교 종합 의견</b>을 적고 <b>검토를 마쳤습니다</b>를 체크합니다.</li>
  <li>입력은 바로 저장됩니다. 인터넷이 끊기면 브라우저에 보관했다가 다시 연결될 때 보냅니다. 걱정되면 <b>내 의견 엑셀로 내려받기</b>로 백업해 두세요.</li></ol>
  <p class="tiny">일정: 2차 점검 ~11. 8.(일) · 결과 환류 11. 10.(화)~11. 20.(금) · 문의 고교교육과정지원센터 김시형 장학사 041-640-7211, 010-5680-0710</p></section>`;
}
function exportXlsx() {
  if (!window.XLSX) return;
  const ss = mySchools(); const rows = [['학교', '과정·학과', '번호', '항목', '자동 판정', '내용', '위원 판정', '의견', '환류 필요', '자문 요청', '자문 의견']];
  ss.forEach(s => needItems(s).forEach(x => { const o = OP[x.key] || {}; rows.push([s.name, x.e.dept, x.r[0], x.r[1], x.r[2], x.r[3], o.verdict || '', o.note || '', o.fb ? 'O' : '', o.advReq ? 'O' : '', o.advNote || '']); }));
  const memo = [['학교', '검토 완료', '종합 의견']]; ss.forEach(s => { const o = OP['s|' + s.code] || {}; memo.push([s.name, o.done ? 'O' : '', o.memo || '']); });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '항목별 판정'); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(memo), '학교 종합');
  XLSX.writeFile(wb, `편제표 2차 점검_${me.who}.xlsx`);
}

// ---------- events ----------
$('#go').onclick = async () => { me = {who: $('#who').value, pin: $('#pin').value.trim()}; ls.set('jedje.me', me); cur = null; view = 'mine'; await pull(); render(); };
document.querySelectorAll('.tab').forEach(t => t.onclick = async () => { view = t.dataset.v; cur = null; if (view !== 'guide') await pull(); render(); });
window.addEventListener('online', flush);
load().catch(() => { $('#view').innerHTML = '<div class="notice warn">자료를 불러오지 못했습니다. 새로 고침해 주세요.</div>'; });
})();
