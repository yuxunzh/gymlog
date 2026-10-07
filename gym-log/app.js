'use strict';

/* ==========================================================
   健身记录 GymLog v2.0
   - 数据依然存在本机（localStorage），键名沿用 v1，老数据不会丢
   - 新增：动作库、常用动作一键记录、自动带入上次重量、组数批量填写
   ========================================================== */

const APP_VERSION = '2.0';
const STORAGE_KEY = 'gymlog.data.v1';
const BANNER_KEY = 'gymlog.installBannerDismissed';
const BODY_PARTS = ['胸','背','肩','腿','臀','手臂','核心','全身','有氧','其他'];
const LIBRARY = (typeof EXERCISE_LIBRARY !== 'undefined' && EXERCISE_LIBRARY) ? EXERCISE_LIBRARY : {};
const QUICK_LIMIT = 8;

/* ================= 通用工具 ================= */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function uid(){
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8);
}
function toDateStr(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function shiftDateStr(dateStr, days){
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}
function fmtW(w){ const n = Number(w)||0; return n % 1 === 0 ? String(n) : n.toFixed(1); }
function fmtNum(n){ return Math.round(n).toLocaleString('zh-CN'); }
function fmtShort(n){
  if (n >= 10000) return (n/10000).toFixed(1).replace(/\.0$/,'') + '万';
  if (n >= 1000) return (n/1000).toFixed(1).replace(/\.0$/,'') + 'k';
  return String(Math.round(n));
}
function fmtDateShort(date){
  const d = new Date(date + 'T12:00:00');
  return `${d.getMonth()+1}/${d.getDate()}`;
}
function formatDateCN(date){
  const d = new Date(date + 'T12:00:00');
  const weeks = ['周日','周一','周二','周三','周四','周五','周六'];
  const today = new Date();
  const prefix = d.getFullYear() === today.getFullYear() ? '' : d.getFullYear() + '年';
  return `${prefix}${d.getMonth()+1}月${d.getDate()}日 ${weeks[d.getDay()]}`;
}

/* ================= 状态 ================= */
let db = { version: 2, records: {}, favorites: [] };
let currentDate = toDateStr(new Date());
let selectedPart = BODY_PARTS[0];
let selectedExercise = '';
let draftSets = [];
let deferredPrompt = null;
let editingId = null;
let swReg = null;
let toastTimer = null;
let pickerQuery = '';
let prefillNote = '';

/* ================= 数据层 ================= */
function load(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw){
      const parsed = JSON.parse(raw);
      if (parsed && parsed.records && typeof parsed.records === 'object') return parsed;
    }
  }catch(e){ console.warn('读取本地数据失败', e); }
  return { version: 2, records: {}, favorites: [] };
}

function normalizeRecords(records){
  const out = {};
  for (const [date, list] of Object.entries(records)){
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(list)) continue;
    out[date] = list.map(ex => ({
      id: (ex && ex.id) || uid(),
      bodyPart: BODY_PARTS.includes(ex.bodyPart) ? ex.bodyPart : '其他',
      exercise: String((ex && ex.exercise) || '').trim(),
      sets: Array.isArray(ex && ex.sets) ? ex.sets
        .filter(s => s && typeof s === 'object')
        .map(s => ({ weight: Number(s.weight) || 0, reps: Number(s.reps) || 0 }))
        .filter(s => s.reps > 0) : [],
      createdAt: (ex && ex.createdAt) || Date.now()
    })).filter(ex => ex.exercise);
    if (out[date].length === 0) delete out[date];
  }
  return out;
}

function normalizeDb(raw){
  return {
    version: 2,
    records: normalizeRecords((raw && raw.records) || {}),
    favorites: Array.isArray(raw && raw.favorites) ? raw.favorites.filter(x => typeof x === 'string' && x) : []
  };
}

function getRecords(date){ return db.records[date] || (db.records[date] = []); }
function allDatesWithData(){ return Object.keys(db.records).filter(d => db.records[d] && db.records[d].length > 0).sort(); }

function save(msg){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  renderAll();
  if (msg) toast(msg);
}

/* ================= 查询辅助 ================= */
function findLastUsed(name){
  const dates = allDatesWithData().reverse();
  for (const date of dates){
    const list = db.records[date];
    for (let i = list.length - 1; i >= 0; i--){
      const ex = list[i];
      if (ex.exercise === name && ex.sets.length) return { date, sets: ex.sets, bodyPart: ex.bodyPart };
    }
  }
  return null;
}

function partOfExercise(name){
  for (const part of Object.keys(LIBRARY)){
    if (LIBRARY[part].includes(name)) return part;
  }
  for (const date of allDatesWithData()){
    const ex = db.records[date].find(x => x.exercise === name);
    if (ex) return ex.bodyPart;
  }
  return selectedPart;
}

function addExerciseToDate(date, name, part, sets){
  const list = getRecords(date);
  const copied = sets.map(s => ({ weight: Number(s.weight) || 0, reps: Number(s.reps) || 0 }));
  let entry = list.find(x => x.exercise === name);
  if (entry){
    entry.sets = entry.sets.concat(copied);
  } else {
    entry = { id: uid(), bodyPart: part || '其他', exercise: name, sets: copied, createdAt: Date.now() };
    list.push(entry);
  }
  return entry;
}

function exerciseStats(){
  const map = new Map();
  for (const date of allDatesWithData()){
    for (const ex of db.records[date]){
      if (!ex.sets.length) continue;
      const cur = map.get(ex.exercise) || { name: ex.exercise, count: 0, lastDate: '', lastSets: [] };
      cur.count += ex.sets.length;
      cur.lastDate = date;
      cur.lastSets = ex.sets;
      map.set(ex.exercise, cur);
    }
  }
  return map;
}

function topExercises(limit){
  const stats = exerciseStats();
  const pinned = db.favorites.map(n => stats.get(n)).filter(Boolean);
  const rest = [...stats.values()]
    .filter(t => !db.favorites.includes(t.name))
    .sort((a, b) => (b.count - a.count) || (a.lastDate < b.lastDate ? 1 : -1));
  return pinned.concat(rest).slice(0, limit);
}

function lastSessionDate(){
  const all = allDatesWithData();
  const before = all.filter(d => d < currentDate);
  if (before.length) return before[before.length - 1];
  const others = all.filter(d => d !== currentDate);
  return others.length ? others[0] : null;
}

function libraryCount(){
  return Object.keys(LIBRARY).reduce((sum, k) => sum + (Array.isArray(LIBRARY[k]) ? LIBRARY[k].length : 0), 0);
}

/* ================= 渲染：总入口 ================= */
function renderAll(){
  renderRecordView();
  renderHistory();
  renderSettings();
  renderSuggestions();
  renderBanner();
}

/* ================= 渲染：记录页 ================= */
function renderRecordView(){
  $('#date-input').value = currentDate;
  renderQuickAdd();

  const list = getRecords(currentDate);
  const container = $('#record-list');
  container.innerHTML = '';
  $('#empty-state').classList.toggle('hidden', list.length > 0);

  if (list.length > 0){
    const byPart = {};
    for (const ex of list) (byPart[ex.bodyPart] = byPart[ex.bodyPart] || []).push(ex);
    const parts = Object.keys(byPart).sort((a, b) => (BODY_PARTS.indexOf(a) - BODY_PARTS.indexOf(b)) || a.localeCompare(b, 'zh'));
    for (const part of parts){
      const section = document.createElement('div');
      section.className = 'part-section';
      section.innerHTML = `<h3 class="part-title">${esc(part)} <span class="part-count">${byPart[part].length} 个动作</span></h3>`;
      for (const ex of byPart[part]) section.appendChild(exerciseCard(ex));
      container.appendChild(section);
    }
  }

  renderExercisePicker();
  renderDraft();
  $('#prefill-hint').textContent = prefillNote;
}

function exerciseCard(ex){
  const card = document.createElement('div');
  card.className = 'exercise-card';
  card.dataset.id = ex.id;
  const volume = ex.sets.reduce((s, st) => s + st.weight * st.reps, 0);
  const setsHtml = ex.sets.length
    ? `<div class="set-chips">${ex.sets.map(s => `<span class="set-chip">${fmtW(s.weight)}kg × ${s.reps}</span>`).join('')}</div>`
    : '<div class="muted">暂无组数</div>';
  card.innerHTML = `
    <div class="ex-head">
      <div class="ex-name">${esc(ex.exercise)}</div>
      <div class="ex-actions">
        <button class="mini-btn" data-act="addset" title="快速加一组（复制最后一组）">＋组</button>
        <button class="mini-btn" data-act="edit" title="编辑">编辑</button>
        <button class="mini-btn danger" data-act="delete" title="删除">删除</button>
      </div>
    </div>
    ${setsHtml}
    <div class="ex-meta">${ex.sets.length} 组 · 总容量 ${fmtNum(volume)} kg</div>`;
  return card;
}

function renderQuickAdd(){
  const card = $('#quick-card');
  const list = $('#quick-list');
  const items = topExercises(QUICK_LIMIT);
  if (items.length === 0){
    card.classList.add('hidden');
    list.innerHTML = '';
    return;
  }
  card.classList.remove('hidden');
  list.innerHTML = items.map(t => {
    const last = t.lastSets[t.lastSets.length - 1];
    return `<button type="button" class="quick-chip" data-quick="${esc(t.name)}">
      <span class="quick-name">${esc(t.name)}</span>
      <span class="quick-sub">${fmtW(last.weight)}kg × ${last.reps} × ${t.lastSets.length}组</span>
      <span class="quick-plus">＋</span>
    </button>`;
  }).join('');
}

function renderExercisePicker(){
  const box = $('#exercise-picker');
  const q = pickerQuery.trim().toLowerCase();
  const sections = [];

  if (q){
    const found = [];
    for (const part of Object.keys(LIBRARY)){
      for (const name of LIBRARY[part]){
        if (name.toLowerCase().includes(q)) found.push({ name, part });
      }
    }
    sections.push({ title: found.length ? `搜索结果（${found.length}）` : '没有匹配的动作，可以直接在下面输入自定义名称', items: found });
  } else {
    const quick = topExercises(6);
    if (quick.length){
      sections.push({ title: '常用', items: quick.map(t => ({ name: t.name, part: partOfExercise(t.name) })) });
    }
    const lib = (LIBRARY[selectedPart] || []).map(name => ({ name, part: selectedPart }));
    sections.push({ title: `${selectedPart} · 动作库（${lib.length}）`, items: lib });
  }

  box.innerHTML = sections.map(sec => {
    if (!sec.items.length) return `<div class="picker-section"><div class="picker-empty">${esc(sec.title)}</div></div>`;
    return `<div class="picker-section">
      <div class="picker-title">${esc(sec.title)}</div>
      <div class="picker-chips">${sec.items.map(it => {
        const pinned = db.favorites.includes(it.name);
        const active = it.name === selectedExercise;
        return `<button type="button" class="picker-chip ${active ? 'active' : ''}" data-ex="${esc(it.name)}" data-part="${esc(it.part)}">
          <span>${esc(it.name)}</span>
          <span class="star ${pinned ? 'on' : ''}" data-star="${esc(it.name)}" title="设为常练">${pinned ? '★' : '☆'}</span>
        </button>`;
      }).join('')}</div>
    </div>`;
  }).join('');
}

function renderDraft(){
  const box = $('#draft-sets');
  if (draftSets.length === 0){
    box.innerHTML = '<span class="muted">还没有单独添加组：直接点最下面的「保存动作」，就会把上面的重量 × 次数 × 组数一起保存。</span>';
    return;
  }
  box.innerHTML = draftSets.map((s, i) =>
    `<span class="set-chip">${fmtW(s.weight)}kg × ${s.reps}<button type="button" class="chip-del" data-del="${i}" title="删除这一组">✕</button></span>`
  ).join('');
}

function renderChips(){
  $('#body-part-chips').innerHTML = BODY_PARTS.map(p =>
    `<button type="button" class="chip ${p === selectedPart ? 'active' : ''}" data-part="${p}">${p}</button>`).join('');
}

function renderSuggestions(){
  const names = new Set();
  for (const part of Object.keys(LIBRARY)) for (const n of LIBRARY[part]) names.add(n);
  for (const date of Object.keys(db.records)) for (const ex of db.records[date]) names.add(ex.exercise);
  $('#exercise-suggestions').innerHTML = [...names].map(n => `<option value="${esc(n)}"></option>`).join('');
}
/* ================= 交互：选择动作 / 记录 ================= */
function selectExercise(name, part){
  selectedExercise = name;
  $('#exercise-name').value = name;
  draftSets = [];
  if (part && BODY_PARTS.includes(part) && part !== selectedPart){
    selectedPart = part;
    renderChips();
  }
  applyLastUsed(name);
  renderExercisePicker();
  renderDraft();
}

function applyLastUsed(name){
  const found = findLastUsed(name);
  if (!found){
    prefillNote = `「${name}」还没有历史记录，填写重量、次数后保存即可。`;
  } else {
    const last = found.sets[found.sets.length - 1];
    $('#set-weight').value = fmtW(last.weight);
    $('#set-reps').value = last.reps;
    $('#set-count').value = Math.min(Math.max(found.sets.length, 1), 10);
    prefillNote = `上次 ${fmtDateShort(found.date)}：${fmtW(last.weight)}kg × ${last.reps}，共 ${found.sets.length} 组，已自动填好，直接保存即可。`;
  }
  $('#prefill-hint').textContent = prefillNote;
}

function toggleFavorite(name){
  const idx = db.favorites.indexOf(name);
  if (idx === -1) db.favorites.push(name);
  else db.favorites.splice(idx, 1);
  save(idx === -1 ? `已把「${name}」固定到常用 ★` : `已取消常用「${name}」`);
}

function quickAdd(name){
  const found = findLastUsed(name);
  if (!found){ toast('这个动作还没有历史记录'); return; }
  addExerciseToDate(currentDate, name, found.bodyPart || partOfExercise(name), found.sets);
  save(`已记录 ${name}（${fmtW(found.sets[found.sets.length-1].weight)}kg × ${found.sets[found.sets.length-1].reps}）✓`);
}

function addDraftSets(){
  const w = parseFloat($('#set-weight').value) || 0;
  const r = parseInt($('#set-reps').value, 10) || 0;
  const n = Math.max(1, Math.min(20, parseInt($('#set-count').value, 10) || 1));
  if (r <= 0){ toast('请先填写次数'); return; }
  for (let i = 0; i < n; i++) draftSets.push({ weight: w, reps: r });
  renderDraft();
  toast(`已加入 ${n} 组`);
}

function saveNewExercise(){
  const name = ($('#exercise-name').value || '').trim();
  if (!name){ toast('请先点选或填写动作名称'); return; }
  let sets = draftSets.slice();
  if (sets.length === 0){
    const w = parseFloat($('#set-weight').value) || 0;
    const r = parseInt($('#set-reps').value, 10) || 0;
    const n = Math.max(1, Math.min(20, parseInt($('#set-count').value, 10) || 1));
    if (r <= 0){ toast('请填写次数'); return; }
    for (let i = 0; i < n; i++) sets.push({ weight: w, reps: r });
  }
  addExerciseToDate(currentDate, name, selectedPart, sets);
  resetForm();
  save(`已保存 ${name}（${sets.length} 组）✓`);
}

function resetForm(){
  selectedExercise = '';
  draftSets = [];
  prefillNote = '';
  $('#exercise-name').value = '';
  $('#set-weight').value = '';
  $('#set-reps').value = '';
  $('#set-count').value = '1';
  $('#prefill-hint').textContent = '';
}

function quickAddSet(id){
  const ex = getRecords(currentDate).find(x => x.id === id);
  if (!ex) return;
  const last = ex.sets[ex.sets.length - 1];
  ex.sets.push(last ? { ...last } : { weight: 0, reps: 10 });
  save('已添加一组 ✓');
}

function deleteExercise(id){
  const list = getRecords(currentDate);
  const idx = list.findIndex(x => x.id === id);
  if (idx === -1) return;
  if (!confirm(`删除「${list[idx].exercise}」以及它的全部组数？`)) return;
  list.splice(idx, 1);
  if (list.length === 0) delete db.records[currentDate];
  save('已删除');
}

function repeatLastSession(){
  const from = lastSessionDate();
  if (!from){ toast('还没有可复制的历史训练'); return; }
  const list = db.records[from];
  const setCount = list.reduce((s, ex) => s + ex.sets.length, 0);
  if (!confirm(`把 ${formatDateCN(from)} 的 ${list.length} 个动作（共 ${setCount} 组）复制到 ${formatDateCN(currentDate)}？`)) return;
  for (const ex of list) addExerciseToDate(currentDate, ex.exercise, ex.bodyPart, ex.sets);
  save('已复制上次训练 ✓');
}

/* ================= 弹窗编辑 ================= */
function setRowHtml(w, r){
  return `<div class="set-row">
    <input type="number" inputmode="decimal" class="sw" placeholder="重量" step="0.5" min="0" value="${w === undefined ? '' : w}">
    <span class="set-x">kg ×</span>
    <input type="number" inputmode="numeric" class="sr" placeholder="次数" step="1" min="1" value="${r === undefined ? '' : r}">
    <button type="button" class="set-del" title="删除这一组">×</button>
  </div>`;
}

function collectSets(container){
  return $$(`${container} .set-row`).map(row => ({
    weight: parseFloat(row.querySelector('.sw').value) || 0,
    reps: parseInt(row.querySelector('.sr').value, 10) || 0
  })).filter(s => s.reps > 0);
}

function openEditModal(id){
  const ex = getRecords(currentDate).find(x => x.id === id);
  if (!ex) return;
  editingId = id;
  $('#modal-title').textContent = '编辑动作';
  $('#modal-exercise').value = ex.exercise;
  $('#modal-body-part').value = ex.bodyPart;
  $('#modal-sets').innerHTML = ex.sets.map(s => setRowHtml(fmtW(s.weight), s.reps)).join('');
  $('#modal-backdrop').classList.remove('hidden');
}

function closeModal(){
  $('#modal-backdrop').classList.add('hidden');
  editingId = null;
}

function saveModalEdit(){
  const name = $('#modal-exercise').value.trim();
  if (!name){ toast('请填写动作名称'); return; }
  const sets = collectSets('#modal-sets');
  if (sets.length === 0){ toast('请至少保留一组'); return; }
  const ex = getRecords(currentDate).find(x => x.id === editingId);
  if (!ex) return;
  ex.exercise = name;
  ex.bodyPart = $('#modal-body-part').value;
  ex.sets = sets;
  closeModal();
  save('已保存修改 ✓');
}

/* ================= 历史页 ================= */
function groupByPart(list){
  const m = {};
  for (const ex of list) (m[ex.bodyPart] = m[ex.bodyPart] || []).push(ex);
  return m;
}

function renderHistory(){
  const container = $('#history-list');
  const dates = allDatesWithData().reverse();
  container.innerHTML = '';
  if (dates.length === 0){
    container.innerHTML = '<div class="empty-state">还没有训练记录，去「记录」页添加吧 💪</div>';
    return;
  }
  for (const date of dates){
    const list = db.records[date];
    const setCount = list.reduce((s, ex) => s + ex.sets.length, 0);
    const volume = list.reduce((s, ex) => s + ex.sets.reduce((a, b) => a + b.weight * b.reps, 0), 0);
    const byPart = groupByPart(list);
    const el = document.createElement('details');
    el.className = 'history-day';
    el.innerHTML = `
      <summary>
        <div class="h-head">
          <span class="h-date">${esc(formatDateCN(date))}</span>
          <span class="h-meta muted">${list.length} 个动作 · ${setCount} 组 · ${fmtNum(volume)} kg</span>
        </div>
      </summary>
      <div class="h-body">
        ${Object.entries(byPart).map(([p, arr]) => `
          <div class="h-part">
            <div class="h-part-name">${esc(p)}</div>
            ${arr.map(ex => `<div class="h-ex"><span>${esc(ex.exercise)}</span><span class="muted">${ex.sets.length} 组</span></div>`).join('')}
          </div>`).join('')}
        <button class="mini-btn open-day" data-date="${date}">在「记录」页查看这一天</button>
      </div>`;
    container.appendChild(el);
  }
}

/* ================= 统计页 ================= */
function renderStats(){
  renderStatCards();
  renderExerciseOptions();
  drawTrend();
  drawVolumeBars();
}

function renderStatCards(){
  const dates = allDatesWithData();
  let sets = 0, volume = 0;
  for (const d of dates) for (const ex of db.records[d]){
    sets += ex.sets.length;
    volume += ex.sets.reduce((a, s) => a + s.weight * s.reps, 0);
  }
  $('#stat-days').textContent = dates.length;
  $('#stat-sets').textContent = fmtNum(sets);
  $('#stat-volume').textContent = fmtShort(volume) + ' kg';
}

function renderExerciseOptions(){
  const seen = new Map();
  for (const date of Object.keys(db.records)) for (const ex of db.records[date]){
    if (!seen.has(ex.exercise)) seen.set(ex.exercise, ex.bodyPart);
  }
  const sel = $('#stats-exercise');
  const current = sel.value;
  sel.innerHTML = [...seen.keys()]
    .sort((a, b) => a.localeCompare(b, 'zh'))
    .map(n => `<option value="${esc(n)}">${esc(n)}（${esc(seen.get(n))}）</option>`).join('');
  if ([...seen.keys()].includes(current)) sel.value = current;
}

function drawTrend(){
  const canvas = $('#line-chart');
  const name = $('#stats-exercise').value;
  const use1rm = $('#use-1rm').checked;
  const data = [];
  if (name){
    for (const date of allDatesWithData()){
      for (const ex of db.records[date]){
        if (ex.exercise !== name) continue;
        let best = 0;
        for (const s of ex.sets){
          const w = s.weight || 0, r = s.reps || 0;
          let v = w;
          if (use1rm && r > 1) v = w * (1 + r / 30);
          if (v > best) best = v;
        }
        if (best > 0) data.push({ v: best, label: date });
      }
    }
  }
  drawLineChart(canvas, data);
}

function drawLineChart(canvas, data){
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
  const cssH = 240;
  canvas.width = Math.max(10, cssW * dpr);
  canvas.height = cssH * dpr;
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const pad = { l: 42, r: 12, t: 14, b: 28 };
  if (data.length === 0){
    ctx.fillStyle = '#64748b';
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('暂无该动作的记录', cssW / 2, cssH / 2);
    return;
  }
  const vals = data.map(d => d.v);
  let minV = Math.min(...vals), maxV = Math.max(...vals);
  if (minV === maxV){ minV -= 1; maxV += 1; }
  const span = maxV - minV;
  minV -= span * 0.08; maxV += span * 0.08;
  const iw = cssW - pad.l - pad.r, ih = cssH - pad.t - pad.b;
  const x = i => pad.l + (data.length === 1 ? iw / 2 : i * iw / (data.length - 1));
  const y = v => pad.t + ih * (1 - (v - minV) / (maxV - minV));

  ctx.strokeStyle = 'rgba(148,163,184,0.18)';
  ctx.fillStyle = '#64748b';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++){
    const v = minV + (maxV - minV) * i / 4;
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(cssW - pad.r, yy); ctx.stroke();
    ctx.fillText(fmtNum(v), pad.l - 6, yy);
  }
  const step = Math.ceil(data.length / 5);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  data.forEach((d, i) => {
    if (i % step !== 0 && i !== data.length - 1) return;
    ctx.fillText(d.label.slice(5).replace('-', '/'), x(i), cssH - pad.b + 8);
  });

  const grad = ctx.createLinearGradient(0, pad.t, 0, cssH - pad.b);
  grad.addColorStop(0, 'rgba(52,211,153,0.25)');
  grad.addColorStop(1, 'rgba(52,211,153,0.02)');
  ctx.beginPath();
  data.forEach((d, i) => i ? ctx.lineTo(x(i), y(d.v)) : ctx.moveTo(x(i), y(d.v)));
  ctx.strokeStyle = '#34d399';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.lineTo(x(data.length - 1), cssH - pad.b);
  ctx.lineTo(x(0), cssH - pad.b);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  data.forEach((d, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(d.v), 3, 0, Math.PI * 2);
    ctx.fillStyle = '#34d399';
    ctx.fill();
    ctx.strokeStyle = '#0b1220';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
}

function weeklyVolumes(n){
  const map = new Map();
  for (const date of Object.keys(db.records)){
    const list = db.records[date];
    const d = new Date(date + 'T12:00:00');
    const start = new Date(d);
    start.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = toDateStr(start);
    const vol = list.reduce((s, ex) => s + ex.sets.reduce((a, b) => a + (b.weight || 0) * (b.reps || 0), 0), 0);
    map.set(key, (map.get(key) || 0) + vol);
  }
  const today = new Date();
  const arr = [];
  for (let i = n - 1; i >= 0; i--){
    const d = new Date(today);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - i * 7);
    const key = toDateStr(d);
    arr.push({ label: `${d.getMonth()+1}/${d.getDate()}`, v: map.get(key) || 0 });
  }
  return arr;
}

function drawVolumeBars(){
  drawBarChart($('#bar-chart'), weeklyVolumes(8));
}

function drawBarChart(canvas, data){
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
  const cssH = 200;
  canvas.width = Math.max(10, cssW * dpr);
  canvas.height = cssH * dpr;
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const pad = { l: 44, r: 10, t: 16, b: 28 };
  const maxV = Math.max(1, ...data.map(d => d.v));
  const top = maxV * 1.1;
  const iw = cssW - pad.l - pad.r, ih = cssH - pad.t - pad.b;
  const y = v => pad.t + ih * (1 - v / top);
  ctx.strokeStyle = 'rgba(148,163,184,0.18)';
  ctx.fillStyle = '#64748b';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++){
    const v = top * i / 4;
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(cssW - pad.r, yy); ctx.stroke();
    ctx.fillText(fmtShort(v), pad.l - 6, yy);
  }
  const bw = Math.max(6, Math.min(28, iw / data.length * 0.55));
  data.forEach((d, i) => {
    const cx = pad.l + iw * (i + 0.5) / data.length;
    const h = ih * d.v / top;
    const active = i === data.length - 1;
    ctx.fillStyle = d.v > 0 ? (active ? '#34d399' : 'rgba(52,211,153,0.35)') : 'rgba(148,163,184,0.12)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - bw / 2, cssH - pad.b - h, bw, h, 4);
    else ctx.rect(cx - bw / 2, cssH - pad.b - h, bw, h);
    ctx.fill();
    ctx.fillStyle = '#8ea0bd';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(d.label, cx, cssH - pad.b + 8);
    if (d.v > 0){
      ctx.fillStyle = active ? '#34d399' : '#64748b';
      ctx.textBaseline = 'bottom';
      ctx.fillText(fmtShort(d.v), cx, cssH - pad.b - h - 3);
    }
  });
}

/* ================= 设置页 ================= */
function renderSettings(){
  const hint = $('#install-hint');
  const btn = $('#install-btn');
  if (deferredPrompt){
    btn.hidden = false;
    hint.textContent = '点击下方按钮，把健身记录安装到手机主屏幕，之后可以像普通 App 一样打开（支持离线使用）。';
  } else if (isIOS()){
    btn.hidden = true;
    hint.textContent = 'iPhone/iPad：用 Safari 打开本页面，点底部「分享」按钮，再选「添加到主屏幕」。';
  } else {
    btn.hidden = true;
    hint.textContent = '用 Chrome / Edge 打开本页面后，在地址栏右侧菜单中选择「安装应用 / 添加到主屏幕」，即可像普通 App 一样使用（支持离线）。';
  }
  $('#app-version').textContent = 'v' + APP_VERSION;
  $('#lib-count').textContent = libraryCount();
}

async function installApp(){
  if (!deferredPrompt){
    toast(isIOS() ? '请在 Safari 里点「分享」→「添加到主屏幕」' : '当前浏览器暂未提供安装入口，请用 Chrome / Edge 打开');
    return;
  }
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  renderSettings();
  renderBanner();
}

function checkUpdate(){
  if (!swReg){ toast('当前不是从网站打开，无法检查更新'); return; }
  swReg.update()
    .then(() => toast('已检查更新，有新版本会自动刷新'))
    .catch(() => toast('检查更新失败，请稍后重试'));
}

function exportData(){
  const payload = { app: '健身记录 GymLog', version: 2, exportedAt: new Date().toISOString(), records: db.records, favorites: db.favorites };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `健身记录备份-${toDateStr(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('已导出备份文件');
}

async function importData(e){
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try{
    const data = JSON.parse(await file.text());
    const records = (data && data.records) || null;
    if (!records || typeof records !== 'object') throw new Error('bad format');
    const newDates = Object.keys(records).length;
    if (newDates === 0){ toast('备份文件里没有数据'); return; }
    const oldCount = allDatesWithData().length;
    if (!confirm(`导入后将合并 ${newDates} 个日期的记录（同一天的记录会被备份文件覆盖）。\n当前已有 ${oldCount} 个训练日。继续？`)) return;
    const merged = normalizeRecords({ ...db.records, ...records });
    const favs = Array.isArray(data.favorites)
      ? [...new Set(db.favorites.concat(data.favorites.filter(x => typeof x === 'string')))]
      : db.favorites;
    db = { version: 2, records: merged, favorites: favs };
    save(`导入成功，共 ${newDates} 个日期的数据`);
  }catch(err){
    console.error(err);
    toast('导入失败：文件格式不正确');
  }
}

function clearData(){
  if (!confirm('确定要清空全部训练记录吗？此操作不可撤销，建议先导出备份。')) return;
  if (!confirm('再次确认：真的要清空所有数据吗？')) return;
  db = { version: 2, records: {}, favorites: [] };
  save('已清空全部数据');
}

/* ================= 安装横幅 ================= */
function isIOS(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(){
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

function renderBanner(){
  const el = $('#install-banner');
  if (!el) return;
  const dismissed = localStorage.getItem(BANNER_KEY) === '1';
  el.classList.toggle('hidden', isStandalone() || dismissed || !(deferredPrompt || isIOS()));
}

/* ================= 提示 ================= */
function toast(msg){
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ================= 事件绑定 ================= */
function switchTab(name){
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'record') renderRecordView();
  if (name === 'history') renderHistory();
  if (name === 'stats') renderStats();
  if (name === 'settings') renderSettings();
  window.scrollTo({ top: 0 });
}

function moveDate(delta){
  currentDate = shiftDateStr(currentDate, delta);
  renderRecordView();
}

function onRecordListClick(e){
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.exercise-card').dataset.id;
  const act = btn.dataset.act;
  if (act === 'addset') quickAddSet(id);
  else if (act === 'edit') openEditModal(id);
  else if (act === 'delete') deleteExercise(id);
}

function onQuickListClick(e){
  const btn = e.target.closest('.quick-chip');
  if (btn) quickAdd(btn.dataset.quick);
}

function onPickerClick(e){
  const star = e.target.closest('[data-star]');
  if (star){
    toggleFavorite(star.dataset.star);
    return;
  }
  const chip = e.target.closest('.picker-chip');
  if (chip) selectExercise(chip.dataset.ex, chip.dataset.part);
}

function onHistoryClick(e){
  const btn = e.target.closest('.open-day');
  if (!btn) return;
  currentDate = btn.dataset.date;
  $('#date-input').value = currentDate;
  switchTab('record');
}

function onSetDel(e){
  const btn = e.target.closest('.set-del');
  if (btn) btn.closest('.set-row').remove();
}

function onDraftClick(e){
  const btn = e.target.closest('[data-del]');
  if (!btn) return;
  draftSets.splice(Number(btn.dataset.del), 1);
  renderDraft();
}

function bindEvents(){
  $$('.tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.view)));

  $('#date-input').addEventListener('change', e => { currentDate = e.target.value || currentDate; renderRecordView(); });
  $('#prev-day').addEventListener('click', () => moveDate(-1));
  $('#next-day').addEventListener('click', () => moveDate(1));

  $('#body-part-chips').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    selectedPart = b.dataset.part;
    renderChips();
    renderExercisePicker();
  });

  $('#exercise-search').addEventListener('input', e => {
    pickerQuery = e.target.value;
    renderExercisePicker();
  });

  $('#exercise-picker').addEventListener('click', onPickerClick);

  $('#exercise-name').addEventListener('change', e => {
    const v = e.target.value.trim();
    selectedExercise = v;
    if (v && findLastUsed(v) && draftSets.length === 0) applyLastUsed(v);
    renderExercisePicker();
  });

  $('#add-to-draft').addEventListener('click', addDraftSets);
  $('#draft-sets').addEventListener('click', onDraftClick);
  $('#save-exercise').addEventListener('click', saveNewExercise);
  $('#record-list').addEventListener('click', onRecordListClick);
  $('#quick-list').addEventListener('click', onQuickListClick);
  $('#repeat-last').addEventListener('click', repeatLastSession);

  $('#history-list').addEventListener('click', onHistoryClick);
  $('#stats-exercise').addEventListener('change', drawTrend);
  $('#use-1rm').addEventListener('change', drawTrend);

  $('#export-btn').addEventListener('click', exportData);
  $('#import-file').addEventListener('change', importData);
  $('#clear-btn').addEventListener('click', clearData);
  $('#install-btn').addEventListener('click', installApp);
  $('#check-update').addEventListener('click', checkUpdate);

  $('#banner-install').addEventListener('click', installApp);
  $('#banner-close').addEventListener('click', () => {
    localStorage.setItem(BANNER_KEY, '1');
    renderBanner();
  });

  $('#modal-add-set').addEventListener('click', () => $('#modal-sets').insertAdjacentHTML('beforeend', setRowHtml('', '')));
  $('#modal-sets').addEventListener('click', onSetDel);
  $('#modal-cancel').addEventListener('click', closeModal);
  $('#modal-save').addEventListener('click', saveModalEdit);
  $('#modal-backdrop').addEventListener('click', e => { if (e.target.id === 'modal-backdrop') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  window.addEventListener('resize', () => { if ($('#view-stats').classList.contains('active')) renderStats(); });
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    renderBanner();
    renderSettings();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    renderSettings();
    renderBanner();
    toast('已安装到主屏幕 🎉');
  });
}

/* ================= Service Worker ================= */
function registerSW(){
  if (!('serviceWorker' in navigator)) return;
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (location.protocol !== 'https:' && !isLocal) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js')
    .then(reg => { swReg = reg; reg.update().catch(() => {}); })
    .catch(err => console.warn('Service Worker 注册失败（应用仍可正常使用）', err));
}

/* ================= 示例数据 ================= */
function seedDemoData(){
  const mk = (part, name, sets) => ({ id: uid(), bodyPart: part, exercise: name, sets, createdAt: Date.now() });
  const day = offset => shiftDateStr(toDateStr(new Date()), offset);
  db.records = {
    [day(-7)]: [
      mk('胸', '杠铃卧推', [{ weight: 60, reps: 10 }, { weight: 60, reps: 8 }, { weight: 55, reps: 10 }]),
      mk('胸', '上斜哑铃卧推', [{ weight: 20, reps: 10 }, { weight: 20, reps: 9 }]),
      mk('肩', '哑铃侧平举', [{ weight: 8, reps: 15 }, { weight: 8, reps: 12 }])
    ],
    [day(-5)]: [
      mk('背', '引体向上', [{ weight: 0, reps: 8 }, { weight: 0, reps: 7 }]),
      mk('背', '高位下拉', [{ weight: 50, reps: 12 }, { weight: 55, reps: 10 }]),
      mk('背', '杠铃划船', [{ weight: 40, reps: 10 }, { weight: 40, reps: 10 }])
    ],
    [day(-3)]: [
      mk('腿', '杠铃深蹲', [{ weight: 80, reps: 8 }, { weight: 80, reps: 6 }, { weight: 75, reps: 8 }]),
      mk('腿', '腿举', [{ weight: 120, reps: 12 }, { weight: 130, reps: 10 }]),
      mk('腿', '坐姿腿弯举', [{ weight: 35, reps: 12 }, { weight: 35, reps: 12 }])
    ],
    [day(-1)]: [
      mk('胸', '杠铃卧推', [{ weight: 62.5, reps: 8 }, { weight: 62.5, reps: 8 }, { weight: 60, reps: 10 }]),
      mk('肩', '哑铃肩推', [{ weight: 16, reps: 10 }, { weight: 16, reps: 9 }])
    ]
  };
  db.favorites = ['杠铃卧推', '杠铃深蹲', '引体向上'];
  save('已载入示例数据（可在设置里清空）');
}

/* ================= 启动 ================= */
function init(){
  db = normalizeDb(load());
  currentDate = toDateStr(new Date());
  const params = new URLSearchParams(location.search);
  if (params.get('demo') === '1' && allDatesWithData().length === 0) seedDemoData();
  renderChips();
  renderAll();
  bindEvents();
  const view = params.get('view');
  if (view && ['record', 'history', 'stats', 'settings'].includes(view)) switchTab(view);
  registerSW();
}

document.addEventListener('DOMContentLoaded', init);
