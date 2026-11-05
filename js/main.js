import { BUILTIN_CELLS, validateCell } from './cells.js';
import { generateLayout, packStats, autoRows } from './layout.js';
import { bestConfigs, checkConfig, requiredBox } from './fit.js';
import { renderPackSVG, renderFitSVG, svgToPng, VIEW_MODES } from './render.js';
import { buildScene3D } from './scene3d.js';
import { STRIP_MATERIALS, stripCalc, wireCalc, runtimeCalc, sizePack, parseCellList, balanceCells } from './tools.js';
import { analyzeCurrents } from './analysis.js';
import { bmsPlan, BMS_TYPES, BMS_PORTS } from './bms.js';
import { renderBmsSVG } from './schematic.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const num = (el) => { const v = parseFloat(String(el.value).replace(',', '.')); return isFinite(v) ? v : 0; };
const fmt = (n, d = 1) => (n == null || !isFinite(n) ? '—' : Number(n).toLocaleString('uk-UA', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STORE_KEY = 'battery-ide:v1';

// ------------------------------------------------------------------ стан
const state = {
  cellId: 'samsung-50e',
  customCells: [],
  S: 10, P: 4, rows: '', gap: 0.5, arrangement: 'grid', snake: 'cols', rotate: false,
  labels: 'group', load: 20, mirror: true, balance: true,
  stripMat: 'nickel', stripW: 8, stripT: 0.15, stripL: 1,
  bmsSide: 'right', leadAttach: 'near',
  viewMode: 'scheme', step: 'all',
  v3d: { explode: 0, strips: true, wires: true, labels: true, enclosure: false, color: 'type' },
  zoom: 1,
  bms: { type: 'hardware', port: 'common', channels: 0, current: 0, chargeA: 0, balanceA: 0.05, ntc: 1, sw: true, precharge: false, leadLen: 0.3 },
  matching: null, // { S, P, groups: [[cap...]] }
  fit: { L: 150, W: 90, H: 75, margin: 2, gap: 0.5, depth: 4, layerGap: 2, layers: false, mode: 'range', smin: 1, smax: 16, volt: '' },
};

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) mergeState(JSON.parse(raw));
  } catch { /* сховище недоступне */ }
}
function mergeState(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(state)) if (k in obj) state[k] = k === 'fit' || k === 'bms' || k === 'v3d' ? { ...state[k], ...obj[k] } : obj[k];
}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* ігноруємо */ } }, 200);
}

const allCells = () => [...BUILTIN_CELLS, ...state.customCells];
const getCell = () => allCells().find((c) => c.id === state.cellId) || BUILTIN_CELLS[0];

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200);
}
function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------------ вкладки
function initTabs() {
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  const h = location.hash.replace('#', '');
  if (h && $(`#tab-${h}`)) showTab(h);
}
function showTab(id) {
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${id}`));
  history.replaceState(null, '', `#${id}`);
  if (id === 'fit') updateFitHint();
  if (id === 'calc') renderCalcs();
  if (id === 'bms') renderBms();
  if (viewer) { if (id === 'designer' && state.viewMode === '3d') viewer.start(); else viewer.stop(); }
}

// ------------------------------------------------------------------ тема
function initTheme() {
  let theme = null;
  try { theme = localStorage.getItem('battery-ide:theme'); } catch { /* */ }
  if (theme) document.documentElement.dataset.theme = theme;
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('battery-ide:theme', next); } catch { /* */ }
  });
}

// ------------------------------------------------------------------ вибір комірки
function fillCellSelect() {
  const sel = $('#cellSelect');
  const groups = {};
  for (const c of allCells()) (groups[c.custom ? 'Власні' : c.format] ||= []).push(c);
  sel.innerHTML = Object.entries(groups).map(([g, list]) =>
    `<optgroup label="${esc(g)}">${list.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
  sel.value = getCell().id;
}
function cellSummary(c) {
  const size = c.shape === 'cyl' ? `Ø${c.d}×${c.h} мм` : `${c.w}×${c.t}×${c.h} мм`;
  return `${c.chem} · ${size} · ${fmt(c.capacity, 2)} А·год · ${c.vNom} В (${c.vMin}–${c.vMax}) · до ${c.iMax} А · ${c.mass} г`;
}

// ------------------------------------------------------------------ конструктор
const PRESETS = [[3, 1], [4, 1], [6, 2], [7, 3], [10, 4], [13, 4], [14, 5], [16, 1], [20, 6]];

function bindDesigner() {
  const bind = (sel, key, parse = (el) => el.value, ev = 'input') => {
    const el = $(sel);
    const v = state[key];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    el.addEventListener(ev, () => { state[key] = el.type === 'checkbox' ? el.checked : parse(el); renderDesigner(); save(); });
  };
  const int = (el) => Math.max(1, Math.min(200, Math.floor(num(el)) || 1));
  bind('#inS', 'S', int); bind('#inP', 'P', int);
  bind('#inRows', 'rows', (el) => (el.value === '' ? '' : int(el)));
  bind('#inGap', 'gap', num);
  bind('#inArr', 'arrangement', undefined, 'change');
  bind('#inSnake', 'snake', undefined, 'change');
  bind('#inRotate', 'rotate', undefined, 'change');
  bind('#inLabels', 'labels', undefined, 'change');
  bind('#inLoad', 'load', num);
  bind('#inMirror', 'mirror', undefined, 'change');
  $('#inStripMat').innerHTML = Object.entries(STRIP_MATERIALS).map(([k, m]) => `<option value="${k}">${esc(m.name)}</option>`).join('');
  bind('#inStripMat', 'stripMat', undefined, 'change');
  bind('#inStripW', 'stripW', num); bind('#inStripT', 'stripT', num); bind('#inStripL', 'stripL', int);
  bind('#inBmsSide', 'bmsSide', undefined, 'change');
  bind('#inLead', 'leadAttach', undefined, 'change');
  $('#toBms').addEventListener('click', () => showTab('bms'));
  $$('#modeSeg button').forEach((b) => b.addEventListener('click', () => { state.viewMode = b.dataset.mode; renderDesigner(); save(); }));
  $$('#stepSeg button').forEach((b) => b.addEventListener('click', () => { state.step = b.dataset.step; renderDesigner(); save(); }));
  $$('.v3d-views button').forEach((b) => b.addEventListener('click', () => viewer?.setView(b.dataset.view)));
  const v3dBind = (sel, key, prop = 'checked') => {
    const el = $(sel);
    el[prop] = state.v3d[key];
    el.addEventListener(prop === 'checked' ? 'change' : 'input', () => {
      state.v3d[key] = prop === 'checked' ? el.checked : prop === 'valueAsNumber' ? el.valueAsNumber : el.value;
      renderDesigner(); save();
    });
  };
  v3dBind('#v3dStrips', 'strips'); v3dBind('#v3dWires', 'wires'); v3dBind('#v3dLabels', 'labels'); v3dBind('#v3dBox', 'enclosure');
  v3dBind('#v3dColor', 'color', 'value'); v3dBind('#v3dExplode', 'explode', 'valueAsNumber');

  $('#cellSelect').addEventListener('change', (e) => { state.cellId = e.target.value; onCellChange(); });
  $('#presets').innerHTML = PRESETS.map(([s, p]) => `<button data-s="${s}" data-p="${p}" title="${s} послідовно × ${p} паралельно">${s}S${p}P</button>`).join('');
  $('#presets').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    setConfig(+b.dataset.s, +b.dataset.p, '');
  });
  $$('.zoom button').forEach((b) => b.addEventListener('click', () => {
    const d = +b.dataset.zoom;
    state.zoom = d === 0 ? 1 : Math.max(0.3, Math.min(6, state.zoom * (d > 0 ? 1.25 : 0.8)));
    applyZoom(); save();
  }));
  $('#btnSvg').addEventListener('click', () => download(`${fileBase()}-${state.viewMode}.svg`, currentSvg, 'image/svg+xml'));
  $('#btnPng').addEventListener('click', async () => {
    try {
      const blob = state.viewMode === '3d' && viewer ? await viewer.png() : await svgToPng(currentSvg, 1);
      download(`${fileBase()}-${state.viewMode}.png`, blob, 'image/png');
    } catch { toast('Не вдалося створити PNG'); }
  });
  $('#btnPrint').addEventListener('click', () => window.print());
  $('#btnSave').addEventListener('click', () => {
    download(`${fileBase()}.json`, JSON.stringify({ app: 'battery-ide', version: 1, state }, null, 2), 'application/json');
  });
  $('#fileLoad').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      mergeState(data.state || data);
      syncInputs(); fillCellSelect(); renderAll(); save();
      toast('Проєкт завантажено');
    } catch { toast('Файл не схожий на проєкт Battery IDE'); }
    e.target.value = '';
  });
}

function syncInputs() {
  const map = { '#inS': 'S', '#inP': 'P', '#inRows': 'rows', '#inGap': 'gap', '#inArr': 'arrangement', '#inSnake': 'snake', '#inRotate': 'rotate', '#inLabels': 'labels', '#inLoad': 'load', '#inMirror': 'mirror', '#inStripMat': 'stripMat', '#inStripW': 'stripW', '#inStripT': 'stripT', '#inStripL': 'stripL', '#inBmsSide': 'bmsSide', '#inLead': 'leadAttach' };
  for (const [sel, key] of Object.entries(map)) {
    const el = $(sel);
    if (el.type === 'checkbox') el.checked = !!state[key]; else el.value = state[key];
  }
  syncFitInputs();
  syncBmsInputs();
}

function setConfig(S, P, rows, extra = {}) {
  Object.assign(state, { S, P, rows }, extra);
  syncInputs(); renderDesigner(); save();
}

function onCellChange() {
  const c = getCell();
  if (c.shape !== 'cyl' && state.arrangement.startsWith('honeycomb')) state.arrangement = 'grid';
  syncInputs(); renderAll(); save();
}

const fileBase = () => `battery-${state.S}S${state.P}P-${getCell().id}`;
let currentSvg = '';
let currentLayout = null;

function applyZoom() {
  const svg = $('#svgHost svg');
  if (svg) svg.style.width = `${state.zoom * 100}%`;
}

function cellLabelsFromMatching(layout) {
  const m = state.matching;
  if (!m || m.S !== layout.S || m.P !== layout.P) return null;
  const labels = {};
  for (const c of layout.cells) {
    const g = m.groups[c.group];
    if (g && g[c.k] != null) labels[c.id] = String(g[c.k]);
  }
  return labels;
}

const stripOpts = () => ({ material: state.stripMat, width: state.stripW, thickness: state.stripT, layers: state.stripL });
let currentAnalysis = null;

function buildLayout(cell) {
  const rows = state.rows || autoRows(state.S, state.P, cell.shape, state.snake);
  return generateLayout({
    S: state.S, P: state.P, rows, arrangement: state.arrangement, snake: state.snake, gap: state.gap, cell,
    rotate: state.rotate, bmsSide: state.bmsSide, leadAttach: state.leadAttach,
  });
}

const groupPair = (busIndex) => `між групами ${busIndex} та ${busIndex + 1}`;
function linkPlace(layout, a) {
  const l = a.maxLink;
  if (!l) return '';
  const A = layout.cells[l.a];
  if (l.bus === 0) return `на мінусовій шині (група 1), біля ряду ${A.row + 1}, стовпця ${A.col + 1}`;
  if (l.bus === layout.S) return `на плюсовій шині (група ${layout.S}), біля ряду ${A.row + 1}, стовпця ${A.col + 1}`;
  return `${l.series ? 'послідовна' : 'паралельна'} перемичка ${groupPair(l.bus)}, ряд ${A.row + 1}, стовпець ${A.col + 1}`;
}

function renderDesigner() {
  const cell = getCell();
  $('#cellInfo').textContent = cellSummary(cell);
  $('#rotateWrap').hidden = cell.shape === 'cyl';
  $$('#inArr option[value^="honeycomb"]').forEach((o) => (o.disabled = cell.shape !== 'cyl'));
  $('#inSnake').disabled = state.arrangement === 'honeycomb2' && cell.shape === 'cyl';
  $('#inRows').placeholder = `авто (${autoRows(state.S, state.P, cell.shape, state.snake)})`;

  const layout = buildLayout(cell);
  currentLayout = layout;
  const stats = packStats(cell, state.S, state.P, { loadCurrent: state.load });
  const analysis = layout.N <= 4000 ? analyzeCurrents(layout, cell, { load: state.load, strip: stripOpts() }) : { ok: false, reason: 'Завеликий пакет для розрахунку' };
  currentAnalysis = analysis;
  const cellLabels = state.labels === 'capacity' ? cellLabelsFromMatching(layout) : null;
  const title = `${state.S}S${state.P}P · ${cell.name} · ${fmt(stats.vNom)} В ${fmt(stats.ah)} А·год`;
  const mode = ['scheme', 'assembly', 'currents', 'wiring', '3d'].includes(state.viewMode) ? state.viewMode : 'scheme';
  $$('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $$('#stepSeg button').forEach((b) => b.classList.toggle('active', b.dataset.step === state.step));
  $('#stepRow').hidden = mode !== 'assembly';
  $('#modeHint').textContent = mode === '3d'
    ? 'Обертання — ліва кнопка миші або один палець, зсув — права кнопка або два пальці, масштаб — коліщатко. Наведіть на комірку, щоб побачити деталі.'
    : VIEW_MODES[mode] + (mode === 'currents' && !analysis.ok ? ` (${analysis.reason})` : '');
  $('#svgWrap').hidden = mode === '3d';
  $('#view3d').hidden = mode !== '3d';
  $('.zoom').hidden = mode === '3d';
  $('#btnSvg').disabled = mode === '3d';
  if (mode === '3d') {
    render3D(cell, layout, analysis);
  } else {
    viewer?.stop();
    currentSvg = renderPackSVG(layout, {
      mode, step: state.step, mirrorBottom: state.mirror,
      labels: state.labels === 'capacity' && !cellLabels ? 'group' : state.labels,
      cellLabels, title, analysis,
    });
    $('#svgHost').innerHTML = currentSvg;
    applyZoom();
  }
  const snakeName = { cols: '', rows: ', змійка по рядах', u: ', U-подібна' }[layout.snake] || '';
  $('#schemeTitle').textContent = `Схема ${state.S}S${state.P}P — ${layout.rows}×${layout.cols}${layout.honey ? (layout.dense ? ', щільні стільники' : ', стільники') : ''}${snakeName}`;

  // попередження
  const warns = [...layout.warnings];
  const strip = stripCalc(stripOpts());
  const perLink = state.S > 1 && layout.minSeries ? state.load / layout.minSeries : null;
  if (analysis.ok) {
    if (cell.shape === 'cyl' && analysis.maxLinkRatio > 1.05)
      warns.push(`Найнавантаженіша перемичка — ${linkPlace(layout, analysis)}: ${fmt(analysis.maxLink.I)} А при допустимих ≈ ${fmt(strip.ampacity)} А. `
        + (analysis.maxLink.series && layout.buses[analysis.maxLink.bus].seriesLinks === 1
          ? `Групи ${analysis.maxLink.bus} та ${analysis.maxLink.bus + 1} торкаються лише однією коміркою — весь струм іде через одну перемичку. Покладіть уздовж стику мідну шину або змініть кількість рядів.`
          : 'Додайте шар стрічки, ширшу стрічку або мідь саме на цій ділянці.'));
    if (analysis.maxCellRatio > 1)
      warns.push(`Комірка #${analysis.maxCellId + 1} віддає ${fmt(analysis.maxCell, 2)} А — більше за допустимі ${cell.iMax} А через нерівномірний розподіл струму.`);
    const wg = analysis.worstGroup;
    if (wg && layout.P > 1 && wg.imbalance > 0.15)
      warns.push(`Нерівномірний струм у групі ${wg.group + 1}: від ${fmt(wg.min, 2)} до ${fmt(wg.max, 2)} А (${fmt(wg.imbalance * 100, 0)}%). Комірки біля силових виводів старітимуть швидше — перенесіть виводи в центр групи, додайте шар стрічки або мідну шину.`);
  } else if (cell.shape === 'cyl' && perLink && perLink > strip.ampacity * 1.05) {
    warns.push(`Струм через послідовну перемичку ≈ ${fmt(perLink)} А (найслабше місце — ${groupPair(layout.weakestBus)}, ${layout.minSeries} перемичок), а стрічка витримує ≈ ${fmt(strip.ampacity)} А.`);
  }
  if (stats.perCell && stats.perCell > cell.iMax)
    warns.push(`Струм на одну комірку ${fmt(stats.perCell)} А перевищує допустимий ${cell.iMax} А. Збільште P.`);
  if (state.labels === 'capacity' && !cellLabels)
    warns.push('Немає результату балансування для цієї конфігурації — розподіліть комірки на вкладці «Балансування комірок».');
  $('#warnings').innerHTML = warns.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join('');

  const plan = currentPlan(cell, layout);
  renderStats(cell, stats, layout, strip, perLink, analysis, plan);
  renderBom(cell, stats, layout, plan);
  renderSteps(cell, layout, plan);
  if ($('#tab-bms').classList.contains('active')) renderBms();
}

function renderStats(cell, st, layout, strip, perLink, a, plan) {
  const box = requiredBox(layout, cell, { margin: state.fit.margin, depthReserve: state.fit.depth });
  const ok = a && a.ok;
  const cards = [
    ['Напруга', `${fmt(st.vNom)} В`, `${fmt(st.vMin)} – ${fmt(st.vMax)} В`],
    ['Ємність', `${fmt(st.ah, 2)} А·год`, `${st.N} комірок`],
    ['Енергія', `${fmt(st.wh, 0)} Вт·год`, st.whPerKg ? `${fmt(st.whPerKg, 0)} Вт·год/кг` : ''],
    ['Макс. струм', `${fmt(st.iMax, 0)} А`, `${fmt(st.pMax / 1000, 2)} кВт`],
    ok
      ? ['Напруга під навантаженням', `${fmt(a.vTerm, 2)} В`, `просідання ${fmt(a.drop, 2)} В при ${fmt(a.load)} А`]
      : ['Опір пакета', st.irPack ? `${fmt(st.irPack, st.irPack < 1 ? 3 : 1)} мОм` : '—', st.sag ? `просідання ${fmt(st.sag, 2)} В при ${fmt(st.loadCurrent)} А` : 'лише комірки'],
    ok
      ? ['Струм комірок', `${fmt(a.maxCell, 2)} А`, `макс.; середній ${fmt(a.load / layout.P, 2)} А (${fmt(st.cRate, 2)}C)`, a.maxCellRatio > 1 ? 'bad' : 'ok']
      : ['Струм на комірку', st.perCell ? `${fmt(st.perCell, 2)} А` : '—', st.cRate ? `${fmt(st.cRate, 2)}C` : '', st.perCell > cell.iMax ? 'bad' : st.perCell ? 'ok' : ''],
    ok && layout.P > 1
      ? ['Розбаланс у групі', `${fmt(a.worstGroup.imbalance * 100, 1)}%`, `група ${a.worstGroup.group + 1}: ${fmt(a.worstGroup.min, 2)}–${fmt(a.worstGroup.max, 2)} А`, a.worstGroup.imbalance > 0.15 ? 'bad' : 'ok']
      : null,
    cell.shape === 'cyl'
      ? (ok
        ? ['Найгарячіша перемичка', `${fmt(a.maxLink?.I ?? 0, 1)} А`, `${fmt(a.maxLinkRatio * 100, 0)}% від ≈ ${fmt(strip.ampacity, 1)} А`, a.maxLinkRatio > 1.05 ? 'bad' : 'ok']
        : ['Перемичка', perLink ? `${fmt(perLink, 1)} А` : '—', `стрічка витримує ≈ ${fmt(strip.ampacity, 1)} А`, perLink && perLink > strip.ampacity * 1.05 ? 'bad' : perLink ? 'ok' : ''])
      : ['Шина між групами', perLink ? `${fmt(perLink, 1)} А` : '—', 'струм через найслабше з’єднання'],
    ok
      ? ['Тепло при навантаженні', `${fmt(a.cellLoss + a.stripLoss, 1)} Вт`, `комірки ${fmt(a.cellLoss, 1)} Вт, перемички ${fmt(a.stripLoss, 1)} Вт`]
      : ['Тепло при навантаженні', st.heat ? `${fmt(st.heat, 1)} Вт` : '—', 'втрати на опорі комірок'],
    ['Маса', `${fmt(st.massEst / 1000, 2)} кг`, `комірки ${fmt(st.cellsMass / 1000, 2)} кг`],
    ['Розмір блоку', `${fmt(layout.width, 0)}×${fmt(layout.height, 0)}`, `× ${fmt(cell.h, 0)} мм (корпус від ${fmt(box.a, 0)}×${fmt(box.b, 0)}×${fmt(box.depth, 0)})`],
    ['BMS', `${plan.channels}S · ${plan.bmsCurrent} А`, `запобіжник ${fmt(plan.fuse, 1)} А, заряд ${fmt(plan.pack.charge, 1)} В`, plan.checks.some((c) => c.level === 'bad') ? 'bad' : ''],
  ].filter(Boolean);
  $('#statsCards').innerHTML = cards.map(([k, v, s, cls = '']) =>
    `<div class="card ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s || ''}</div></div>`).join('');
}

function renderBom(cell, st, layout, plan) {
  const stripM = (layout.stripLength + layout.linkCount * 6) / 1000 * state.stripL;
  const cyl = cell.shape === 'cyl';
  const pw = plan.power.recommended;
  const rows = [
    [`Комірка ${cell.name}`, st.N, 'шт'],
    cyl ? ['Тримачі (холдери) комірок', `${st.N * 2}`, 'шт (верх+низ)'] : ['Шини/busbar', layout.linkCount, 'шт'],
    cyl ? [`Стрічка ${STRIP_MATERIALS[state.stripMat].name} ${state.stripW}×${state.stripT} мм`, fmt(stripM * 1.2, 2), 'м (з запасом 20%)'] : null,
    cyl ? ['Ізоляційні кільця (fish paper) на «+»', st.N, 'шт'] : null,
    [`BMS ${plan.channels}S ${cell.chem}, ${BMS_PORTS[plan.port].split(' (')[0].toLowerCase()}, ≥ ${plan.bmsCurrent} А`, 1, 'шт'],
    [`Балансувальні дроти ${plan.balanceAwg}–24 AWG (B0…B${state.S})`, st.balanceWires, `шт, ≈ ${fmt(plan.balanceLength / 1000, 2)} м разом`],
    [`Силовий дріт ${pw ? `${pw.awg} AWG (${pw.mm2} мм²)` : '—'}`, fmt(plan.leadLen * 2 * 1.2, 2), 'м (червоний + чорний)'],
    [`Запобіжник на P+`, 1, `шт, ${fmt(plan.fuse, 1)} А`],
    plan.sw ? ['Вимикач силового кола', 1, `шт, ≥ ${fmt(plan.fuse, 0)} А DC`] : null,
    plan.precharge ? ['Резистор передзаряду ~100 Ом 5 Вт + кнопка', 1, 'компл.'] : null,
    plan.ntc ? ['Датчик температури NTC 10 кОм', plan.ntc, 'шт'] : null,
    [`Зарядний пристрій ${fmt(plan.pack.charge, 1)} В CC/CV, ${fmt(plan.chargeA, 1)} А`, 1, 'шт'],
    ['Термоусадка / корпус, ізоляційний картон', 1, 'компл.'],
  ].filter(Boolean);
  $('#bomTable').innerHTML = `<thead><tr><th>Позиція</th><th class="num">К-сть</th><th>Од.</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td class="num">${r[1]}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody>`;
}

function renderSteps(cell, layout, plan) {
  const S = layout.S;
  const cyl = cell.shape === 'cyl';
  const steps = [
    `Перевірте всі ${layout.N} комірок: напруга в межах ±0,05 В, однакова партія. За можливості розподіліть за ємністю (вкладка «Балансування»).`,
    cyl ? `Встановіть комірки в тримачі за схемою «Вигляд зверху»: групи 1, 3, 5… — «+» догори, групи 2, 4, 6… — «−» догори.`
      : `Розставте комірки за схемою: у непарних групах «+» з першого боку, у парних — перевернуто.`,
    `Приваріть перемички на ${cyl ? 'верхній стороні' : 'клемах'}: шини B1, B3, B5… (${Math.ceil((S) / 2)} шт).`,
    cyl ? `Переверніть блок і приваріть нижні шини B0, B2, B4… згідно з «Вигляд знизу».` : `Встановіть шини B0, B2, B4…`,
    `Перевірте мультиметром напругу кожної групи та наростання напруги між B0 та кожним Bn (≈ n × ${cell.vNom} В).`,
    `Приваріть силові виводи в позначених точках P− та P+ (${layout.leadAttach === 'center' ? 'центр крайніх груп' : 'біля BMS'}), дріт ${plan.power.recommended ? plan.power.recommended.awg + ' AWG' : 'див. вкладку BMS'}.`,
    `Підключіть BMS за вкладкою «Підключення BMS»: B− → балансувальні B0…B${S} → роз'єм → P−${plan.port === 'separate' ? '/C−' : ''}. Запобіжник ${fmt(plan.fuse, 1)} А на P+.`,
    `Перший заряд — малим струмом під наглядом, перевірте балансування груп.`,
  ];
  $('#assemblySteps').innerHTML = steps.map((s) => `<li>${esc(s)}</li>`).join('');
}

// ------------------------------------------------------------------ 3D
let viewer = null;
let viewerLoading = null;
let render3DSeq = 0;

function ensureViewer() {
  if (viewer) return Promise.resolve(viewer);
  if (!viewerLoading) {
    viewerLoading = import('./view3d.js')
      .then((m) => m.createViewer($('#v3dHost'), $('#v3dTip')))
      .then((v) => (viewer = v))
      .catch((e) => { viewerLoading = null; throw e; });
  }
  return viewerLoading;
}

async function render3D(cell, layout, analysis) {
  const seq = ++render3DSeq;
  const v = state.v3d;
  $('#v3dExplode').value = v.explode;
  const desc = buildScene3D(layout, cell, {
    strip: stripOpts(), analysis, stripColor: v.color, explode: v.explode,
    strips: v.strips, wires: v.wires, labels: v.labels, enclosure: v.enclosure,
    box: { margin: state.fit.margin, depthReserve: state.fit.depth },
  });
  const info = (it) => {
    let t = `Комірка #${it.id + 1} · група ${it.group + 1}, позиція ${it.k + 1} · «${it.plusTop ? '+' : '−'}» догори`;
    if (analysis?.ok) t += ` · ${fmt(analysis.cellI[it.id], 2)} А`;
    return t;
  };
  const msg = $('#v3dMsg');
  if (!viewer) msg.textContent = 'Завантаження 3D…';
  try {
    const vw = await ensureViewer();
    if (seq !== render3DSeq || state.viewMode !== '3d') return;
    vw.update(desc, info);
    if ($('#tab-designer').classList.contains('active')) vw.start();
    msg.textContent = v.color === 'current' && !analysis?.ok ? `Колір за струмом недоступний: ${analysis?.reason || ''}` : '';
  } catch (e) {
    msg.textContent = `Не вдалося запустити 3D-перегляд (потрібна підтримка WebGL): ${e.message}`;
  }
}

// ------------------------------------------------------------------ BMS
function currentPlan(cell = getCell(), layout = currentLayout) {
  return bmsPlan(cell, layout, state.bms, state.load);
}
let currentBmsSvg = '';

function syncBmsInputs() {
  const b = state.bms;
  $('#bmsType').value = b.type; $('#bmsPort').value = b.port;
  $('#bmsCh').value = b.channels || ''; $('#bmsI').value = b.current || '';
  $('#bmsChA').value = b.chargeA || ''; $('#bmsBal').value = b.balanceA;
  $('#bmsNtc').value = b.ntc; $('#bmsLead').value = b.leadLen;
  $('#bmsSw').checked = b.sw; $('#bmsPre').checked = b.precharge;
  $('#bmsSide2').value = state.bmsSide; $('#bmsLead2').value = state.leadAttach;
}

function bindBms() {
  $('#bmsType').innerHTML = Object.entries(BMS_TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('#bmsPort').innerHTML = Object.entries(BMS_PORTS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  const read = () => {
    const b = state.bms;
    b.type = $('#bmsType').value; b.port = $('#bmsPort').value;
    b.channels = Math.floor(num($('#bmsCh'))); b.current = num($('#bmsI'));
    b.chargeA = num($('#bmsChA')); b.balanceA = num($('#bmsBal'));
    b.ntc = Math.max(0, Math.min(6, Math.floor(num($('#bmsNtc'))))); b.leadLen = num($('#bmsLead'));
    b.sw = $('#bmsSw').checked; b.precharge = $('#bmsPre').checked;
    state.bmsSide = $('#bmsSide2').value; state.leadAttach = $('#bmsLead2').value;
    syncInputs(); renderDesigner(); renderBms(); save();
  };
  $$('#tab-bms aside input, #tab-bms aside select').forEach((el) => el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', read));
  $('#bmsSvgBtn').addEventListener('click', () => download(`bms-${state.S}S${state.P}P.svg`, currentBmsSvg, 'image/svg+xml'));
  $('#bmsPngBtn').addEventListener('click', async () => {
    try { download(`bms-${state.S}S${state.P}P.png`, await svgToPng(currentBmsSvg, 2), 'image/png'); } catch { toast('Не вдалося створити PNG'); }
  });
  $('#bmsToDesigner').addEventListener('click', () => showTab('designer'));
}

function renderBms() {
  const cell = getCell();
  const layout = currentLayout;
  const plan = currentPlan(cell, layout);
  $('#bmsCh').placeholder = `як S (${layout.S})`;
  $('#bmsI').placeholder = `авто (${plan.recCurrent})`;
  $('#bmsChA').placeholder = `авто (${fmt(plan.chargeA, 1)})`;
  $('#bmsCfg').textContent = `${layout.S}S${layout.P}P, ${cell.name}, навантаження ${fmt(state.load)} А`;
  currentBmsSvg = renderBmsSVG(plan, cell, state.load);
  $('#bmsHost').innerHTML = currentBmsSvg;

  const icon = { ok: '✔', warn: '⚠', bad: '✘' };
  $('#bmsChecks').innerHTML = plan.checks.map((c) => `<li class="chk ${c.level}"><span>${icon[c.level]}</span>${esc(c.text)}</li>`).join('');

  $('#bmsWires').innerHTML = '<thead><tr><th>Дріт</th><th>Що з\'єднує</th><th>Куди приварити</th><th class="num">Від B0, В</th><th class="num">Довжина</th></tr></thead><tbody>'
    + plan.wires.map((w) => `<tr><td><span class="swatch" style="background:${w.color}"></span><b>${w.name}</b></td><td>${esc(w.role)}</td><td>${esc(w.where)}</td>`
      + `<td class="num">${fmt(w.vMin, 2)} / <b>${fmt(w.vNom, 2)}</b> / ${fmt(w.vMax, 2)}</td><td class="num">≈ ${w.length} мм</td></tr>`).join('')
    + (plan.unused ? `<tr class="dim"><td colspan="5">Невикористані канали B${layout.S + 1}…B${plan.channels}: ${plan.type === 'smart' ? `зазвичай з'єднуються з B${layout.S} — перевірте інструкцію BMS` : 'апаратна BMS має відповідати S'}</td></tr>` : '')
    + '</tbody>';

  const p = plan.profile, k = layout.S;
  const row = (name, v, hint = '') => `<tr><td>${name}</td><td class="num">${fmt(v, 3)} В</td><td class="num">${fmt(v * k, 2)} В</td><td class="hint-cell">${hint}</td></tr>`;
  $('#bmsProt').innerHTML = '<thead><tr><th>Параметр</th><th class="num">Комірка</th><th class="num">Пакет</th><th></th></tr></thead><tbody>'
    + row('Напруга заряду (CV)', p.charge, 'налаштування зарядного пристрою')
    + row('Захист від перезаряду (OVP)', p.ovp, 'відключення заряду')
    + row('Відновлення після OVP', p.ovpr)
    + row('Захист від перерозряду (UVP)', p.uvp, 'відключення розряду')
    + row('Відновлення після UVP', p.uvpr)
    + row('Початок балансування', p.balStart, `при різниці > ${p.balDelta} мВ`)
    + row('Напруга зберігання', p.storage, 'для тривалого зберігання')
    + `<tr><td>Захист від перевантаження (OCP)</td><td class="num">—</td><td class="num">≤ ${fmt(Math.min(plan.bmsCurrent, plan.packIMax), 0)} А</td><td class="hint-cell">тривалий розряд</td></tr>`
    + `<tr><td>Струм заряду</td><td class="num">—</td><td class="num">${fmt(plan.chargeA, 1)} А</td><td class="hint-cell">${fmt(plan.chargeC, 2)}C</td></tr>`
    + '</tbody>';
  $('#bmsProtNote').textContent = p.known ? `Профіль ${cell.chem}. Значення консервативні — для більшого ресурсу.` : 'Хімія невідома — пороги розраховано з даташиту комірки.';

  const pw = plan.power.recommended, cw = plan.chargeWire.recommended;
  $('#bmsPower').innerHTML = `<dl>
    <dt>Запобіжник P+</dt><dd>${fmt(plan.fuse, 1)} А</dd>
    <dt>Силові дроти (B−, P−, P+)</dt><dd>${pw ? `${pw.awg} AWG · ${pw.mm2} мм² · падіння ${fmt(pw.dropPct, 2)}%` : 'потрібні шини'}</dd>
    <dt>${plan.port === 'separate' ? 'Дріт C− і зарядного порту' : 'Дроти зарядного порту'}</dt><dd>${cw ? `${cw.awg} AWG · ${cw.mm2} мм²` : '—'}</dd>
    <dt>Балансувальні дроти</dt><dd>${plan.balanceAwg}–24 AWG, разом ≈ ${fmt(plan.balanceLength / 1000, 2)} м</dd>
    <dt>Зарядний пристрій</dt><dd>${fmt(plan.pack.charge, 1)} В CC/CV, ${fmt(plan.chargeA, 1)} А</dd>
  </dl>`;
  $('#bmsSteps').innerHTML = plan.steps.map((s) => `<li>${esc(s)}</li>`).join('');
}

// ------------------------------------------------------------------ вписування
let fitRows = [];
let fitSel = null;

function syncFitInputs() {
  const f = state.fit;
  $('#boxL').value = f.L; $('#boxW').value = f.W; $('#boxH').value = f.H;
  $('#fitMargin').value = f.margin; $('#fitGap').value = f.gap; $('#fitDepth').value = f.depth;
  $('#fitLayerGap').value = f.layerGap; $('#fitLayers').checked = f.layers;
  $('#fitSmin').value = f.smin; $('#fitSmax').value = f.smax; $('#fitVolt').value = f.volt;
  setFitMode(f.mode);
}
function readFit() {
  const f = state.fit;
  f.L = num($('#boxL')); f.W = num($('#boxW')); f.H = num($('#boxH'));
  f.margin = num($('#fitMargin')); f.gap = num($('#fitGap')); f.depth = num($('#fitDepth'));
  f.layerGap = num($('#fitLayerGap')); f.layers = $('#fitLayers').checked;
  f.smin = Math.max(1, Math.floor(num($('#fitSmin')))); f.smax = Math.max(f.smin, Math.floor(num($('#fitSmax'))));
  f.volt = $('#fitVolt').value;
  save();
}
function setFitMode(mode) {
  state.fit.mode = mode;
  $$('#fitModeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('#fitRange').hidden = mode !== 'range';
  $('#fitCheck').hidden = mode !== 'check';
  $('#fitBox').hidden = mode !== 'box';
}
function updateFitHint() { $('#fitCheckCfg').textContent = `${state.S}S${state.P}P, ${getCell().name}`; }

function bindFit() {
  $$('#fitModeSeg button').forEach((b) => b.addEventListener('click', () => { setFitMode(b.dataset.mode); updateFitHint(); runFit(); }));
  $('#fitRun').addEventListener('click', runFit);
  $$('#tab-fit aside input').forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') runFit(); }));
  $$('#tab-fit aside input').forEach((el) => el.addEventListener('change', runFit));
  $('#fitTable').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-i]'); if (!tr) return;
    selectFit(+tr.dataset.i);
  });
  $('#fitApply').addEventListener('click', () => {
    const r = fitRows[fitSel]; if (!r) return;
    const L = r.layout;
    setConfig(r.layers > 1 ? r.layerS : r.S, r.P, r.rows, { arrangement: L.arrangement, rotate: !!L.rotate, gap: state.fit.gap, snake: 'cols' });
    showTab('designer');
    toast(r.layers > 1 ? `Відкрито один шар (${r.layerS}S${r.P}P) з ${r.layers}` : 'Конфігурацію застосовано');
  });
}

function runFit() {
  readFit();
  const f = state.fit;
  const cell = getCell();
  const box = { L: f.L, W: f.W, H: f.H };
  const opt = { gap: f.gap, margin: f.margin, depthReserve: f.depth, layerGap: f.layerGap, allowLayers: f.layers };
  fitRows = [];
  let summary = '';
  if (f.mode === 'range') {
    let range = [f.smin, f.smax];
    const v = parseFloat(f.volt);
    if (v > 0) { const s = Math.round(v / cell.vNom); range = [Math.max(1, s - 1), s + 1]; }
    const { layouts, configs } = bestConfigs(box, cell, opt, range);
    fitRows = configs.map((c) => ({ ...c }));
    const maxCells = layouts.length ? Math.max(...layouts.map((l) => (f.layers ? l.total : l.perLayer))) : 0;
    summary = layouts.length
      ? `Максимум у корпусі: <b>${maxCells}</b> комірок ${cell.name}. Найкраще: ${layouts[0].orientation}, ${arrName(layouts[0])} ${layouts[0].cols}×${layouts[0].rows}${layouts[0].layers > 1 && f.layers ? ` × ${layouts[0].layers} шари` : ''}.`
      : '<span class="err">Жодна комірка не поміщається в корпус з такими відступами.</span>';
  } else if (f.mode === 'check') {
    const ok = checkConfig(box, cell, state.S, state.P, opt);
    fitRows = ok.map((o) => ({ S: state.S, P: state.P, ...o }));
    summary = ok.length ? `<span style="color:var(--ok)">✔ ${state.S}S${state.P}P поміщається — ${ok.length} варіант(ів).</span>`
      : `<span class="err">✘ ${state.S}S${state.P}P (${state.S * state.P} комірок) не поміщається. Спробуйте режим «Підбір S×P» або увімкніть кілька шарів.</span>`;
  } else {
    renderBoxMode(cell);
    return;
  }
  $('#fitSummary').innerHTML = summary;
  renderFitTable(cell);
  if (fitRows.length) {
    // за замовчуванням — рядок з найбільшою енергією в режимі підбору
    let best = 0;
    if (f.mode === 'range') fitRows.forEach((r, i) => { if (r.S * r.P >= fitRows[best].S * fitRows[best].P) best = i; });
    selectFit(best);
  } else {
    fitSel = null; $('#fitApply').disabled = true;
    $('#fitHost').innerHTML = '<p class="hint">Немає варіантів.</p>';
  }
}

const arrName = (l) => ({ honeycomb: 'стільники', honeycomb2: 'щільні стільники' }[l.arrangement] || 'сітка') + (l.rotate ? ' (поверн.)' : '');

function renderFitTable(cell) {
  const head = '<thead><tr><th>Конфігурація</th><th class="num">Комірок</th><th class="num">V ном</th><th class="num">А·год</th><th class="num">Вт·год</th><th>Орієнтація</th><th>Розміщення</th><th class="num">Заповн.</th></tr></thead>';
  const body = fitRows.map((r, i) => {
    const N = r.S * r.P;
    const fill = (N / (r.layout.perLayer * Math.max(1, r.layers))) * 100;
    return `<tr data-i="${i}"><td><b>${r.S}S${r.P}P</b>${r.layers > 1 ? ` <span class="badge warn-b">${r.layers} шари</span>` : ''}</td>`
      + `<td class="num">${N}</td><td class="num">${fmt(r.S * cell.vNom)}</td><td class="num">${fmt(r.P * cell.capacity, 2)}</td>`
      + `<td class="num">${fmt(N * cell.capacity * cell.vNom, 0)}</td><td>${r.layout.orientation}</td>`
      + `<td>${arrName(r.layout)} ${r.layout.cols}×${r.layout.rows}</td><td class="num">${fmt(fill, 0)}%</td></tr>`;
  }).join('');
  $('#fitTable').innerHTML = head + `<tbody>${body}</tbody>`;
}

function selectFit(i) {
  fitSel = i;
  $$('#fitTable tbody tr').forEach((tr) => tr.classList.toggle('sel', +tr.dataset.i === i));
  const r = fitRows[i];
  const cell = getCell();
  const L = r.layout;
  const layout = generateLayout({ S: r.layerS || r.S, P: r.P, rows: r.rows, arrangement: L.arrangement, snake: 'cols', gap: state.fit.gap, cell, rotate: L.rotate, bmsSide: state.bmsSide });
  $('#fitHost').innerHTML = renderFitSVG({
    planeA: L.planeA, planeB: L.planeB, margin: state.fit.margin, aAxis: L.aAxis, bAxis: L.bAxis,
    layout, layers: r.layers, depth: L.depth, cellLen: cell.h,
  });
  $('#fitApply').disabled = false;
}

function renderBoxMode(cell) {
  const f = state.fit;
  const layout = currentLayout;
  const b = requiredBox(layout, cell, { margin: f.margin, depthReserve: f.depth });
  const fits = (x, y, z) => x <= f.L + 1e-6 && y <= f.W + 1e-6 && z <= f.H + 1e-6;
  const opts = [
    [b.a, b.b, b.depth, 'стоячи'], [b.b, b.a, b.depth, 'стоячи, поверн.'],
    [b.depth, b.b, b.a, 'лежачи'], [b.a, b.depth, b.b, 'лежачи, поверн.'],
  ];
  $('#fitSummary').innerHTML = `Для схеми <b>${state.S}S${state.P}P</b> (${fmt(layout.width, 1)} × ${fmt(layout.height, 1)} × ${fmt(cell.h, 1)} мм) потрібен корпус з внутрішніми розмірами щонайменше <b>${fmt(b.a, 1)} × ${fmt(b.b, 1)} × ${fmt(b.depth, 1)} мм</b>. Об'єм ≈ ${fmt((b.a * b.b * b.depth) / 1e6, 2)} л.`;
  $('#fitTable').innerHTML = '<thead><tr><th>Варіант</th><th class="num">L</th><th class="num">W</th><th class="num">H</th><th>У поточний корпус</th></tr></thead><tbody>'
    + opts.map(([x, y, z, n]) => `<tr class="dim"><td>${n}</td><td class="num">${fmt(x, 1)}</td><td class="num">${fmt(y, 1)}</td><td class="num">${fmt(z, 1)}</td><td>${fits(x, y, z) ? '✔ поміщається' : '✘'}</td></tr>`).join('') + '</tbody>';
  $('#fitHost').innerHTML = renderFitSVG({
    planeA: b.a, planeB: b.b, margin: f.margin, aAxis: 'L', bAxis: 'W', layout, layers: 1, depth: b.depth, cellLen: cell.h,
  });
  fitRows = []; fitSel = null; $('#fitApply').disabled = true;
}

// ------------------------------------------------------------------ калькулятори
function bindCalcs() {
  $('#nsMat').innerHTML = Object.entries(STRIP_MATERIALS).map(([k, m]) => `<option value="${k}">${esc(m.name)}</option>`).join('');
  $$('#tab-calc input, #tab-calc select').forEach((el) => el.addEventListener('input', renderCalcs));
  $('#szApply').addEventListener('click', () => {
    const r = sizePackFromInputs();
    setConfig(r.S, r.P, '');
    showTab('designer');
    toast(`Застосовано ${r.S}S${r.P}P`);
  });
}
function sizePackFromInputs() {
  return sizePack(getCell(), { voltage: num($('#szV')), mode: $('#szMode').value, ah: num($('#szAh')), wh: num($('#szWh')), current: num($('#szI')), peak: num($('#szPk')) });
}
const dl = (pairs) => `<dl>${pairs.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

function renderCalcs() {
  const cell = getCell();
  // підбір
  const sz = sizePackFromInputs();
  $('#szOut').innerHTML = `<div class="big">${sz.S}S${sz.P}P</div>${dl([
    ['Комірка', esc(cell.name)], ['Напруга', `${fmt(sz.vMin)} / ${fmt(sz.vNom)} / ${fmt(sz.vMax)} В`],
    ['Ємність', `${fmt(sz.ah, 2)} А·год`], ['Енергія', `${fmt(sz.wh, 0)} Вт·год`],
    ['Комірок', sz.S * sz.P], ['Макс. струм', `${fmt(sz.P * cell.iMax, 0)} А`],
    ['Визначальне', sz.reasons.join(', ') || '—'],
  ])}`;
  // нікель
  const ns = stripCalc({ material: $('#nsMat').value, width: num($('#nsW')), thickness: num($('#nsT')), layers: num($('#nsL')), length: num($('#nsLen')), current: num($('#nsI')) });
  $('#nsOut').innerHTML = `<div class="big">≈ ${fmt(ns.ampacity, 1)} А</div>${dl([
    ['Перетин', `${fmt(ns.area, 2)} мм²`], ['Опір', `${fmt(ns.mOhmPerCm, 2)} мОм/см`],
    ['Опір ділянки', `${fmt(ns.R * 1000, 2)} мОм`], ['Падіння напруги', `${fmt(ns.drop * 1000, 1)} мВ`],
    ['Втрати', `${fmt(ns.loss, 2)} Вт`], ['Навантаження', `<span style="color:${ns.load > 1 ? 'var(--bad)' : 'var(--ok)'}">${fmt(ns.load * 100, 0)}%</span>`],
    ['Потрібно шарів', ns.layersNeeded ?? '> 10 — використайте мідь'],
  ])}`;
  // дріт
  const wr = wireCalc({ current: num($('#wrI')), length: num($('#wrLen')), voltage: num($('#wrV')), maxDropPct: num($('#wrDrop')) });
  const rec = wr.recommended;
  $('#wrOut').innerHTML = rec ? `<div class="big">${rec.awg} AWG · ${rec.mm2} мм²</div>${dl([['Падіння', `${fmt(rec.drop, 3)} В (${fmt(rec.dropPct, 2)}%)`], ['Втрати', `${fmt(rec.loss, 1)} Вт`]])}` : '<div class="err">Немає підхожого перетину в таблиці — розділіть струм на кілька провідників.</div>';
  $('#wrTable').innerHTML = '<thead><tr><th>AWG</th><th class="num">мм²</th><th class="num">I max</th><th class="num">Падіння</th><th class="num">%</th></tr></thead><tbody>'
    + wr.rows.map((r) => `<tr class="${r === rec ? 'rec' : (!r.okAmps || !r.okDrop) ? 'dim' : ''}"><td>${r.awg}</td><td class="num">${r.mm2}</td><td class="num">${r.amps} А</td><td class="num">${fmt(r.drop, 3)} В</td><td class="num">${fmt(r.dropPct, 2)}</td></tr>`).join('') + '</tbody>';
  // час роботи
  if ($('#rtFromPack').checked) {
    const st = packStats(cell, state.S, state.P);
    $('#rtV').value = +st.vNom.toFixed(2); $('#rtAh').value = +st.ah.toFixed(2);
  }
  $('#rtV').disabled = $('#rtAh').disabled = $('#rtFromPack').checked;
  const V = num($('#rtV')), Ah = num($('#rtAh'));
  const rt = runtimeCalc({ wh: V * Ah, ah: Ah, vNom: V, loadW: num($('#rtW')), efficiency: num($('#rtEff')), dod: num($('#rtDod')), chargeA: num($('#rtCh')) });
  const hm = (h) => (h == null || !isFinite(h) ? '—' : `${Math.floor(h)} год ${Math.round((h % 1) * 60)} хв`);
  $('#rtOut').innerHTML = `<div class="big">${hm(rt.hours)}</div>${dl([
    ['Енергія пакета', `${fmt(V * Ah, 0)} Вт·год`], ['Корисна енергія', `${fmt(rt.usableWh, 0)} Вт·год`],
    ['Струм навантаження', `${fmt(rt.loadA, 1)} А (${fmt(rt.cRate, 2)}C)`],
    ['Час заряду', `${hm(rt.chargeH)} (${fmt(rt.chargeC, 2)}C)`],
  ])}`;
}

// ------------------------------------------------------------------ балансування
let lastMatch = null;
function bindMatch() {
  $('#mtFromDesigner').addEventListener('click', () => { $('#mtS').value = state.S; $('#mtP').value = state.P; });
  $('#mtDemo').addEventListener('click', () => {
    const S = Math.max(1, Math.floor(num($('#mtS')))), P = Math.max(1, Math.floor(num($('#mtP'))));
    const n = S * P + 2;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    $('#mtInput').value = Array.from({ length: n }, (_, i) => `C${i + 1} ${Math.round(4800 + rnd() * 250)} ${(18 + rnd() * 6).toFixed(1)}`).join('\n');
  });
  $('#mtRun').addEventListener('click', runMatch);
  $('#mtApply').addEventListener('click', () => {
    if (!lastMatch) return;
    state.matching = { S: lastMatch.S, P: lastMatch.P, groups: lastMatch.res.groups.map((g) => g.cells.map((c) => c.label)) };
    setConfig(lastMatch.S, lastMatch.P, state.rows, { labels: 'capacity' });
    showTab('designer');
  });
  $('#mtCsv').addEventListener('click', () => {
    if (!lastMatch) return;
    const lines = ['group,position,label,capacity_mAh,ir_mOhm'];
    lastMatch.res.groups.forEach((g, gi) => g.cells.forEach((c, k) => lines.push(`${gi + 1},${k + 1},${c.label},${c.cap},${c.ir ?? ''}`)));
    download(`balance-${lastMatch.S}S${lastMatch.P}P.csv`, lines.join('\n'), 'text/csv');
  });
}
function runMatch() {
  const S = Math.max(1, Math.floor(num($('#mtS')))), P = Math.max(1, Math.floor(num($('#mtP'))));
  const list = parseCellList($('#mtInput').value);
  try {
    const res = balanceCells(list, S, P);
    lastMatch = { S, P, res };
    $('#mtSummary').innerHTML = `<div class="cards">${[
      ['Середня група', `${fmt(res.mean, 0)} мА·год`], ['Розкид', `${fmt(res.range, 0)} мА·год`],
      ['Розкид, %', `${fmt(res.rangePct, 2)}%`], ['Не використано', `${res.unused.length} шт`],
    ].map(([k, v]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>`;
    $('#mtGroups').innerHTML = res.groups.map((g, i) => `<div class="group"><h4><span>Група ${i + 1}</span><span>${fmt(g.sum, 0)}</span></h4>`
      + `<div class="cells">${g.cells.map((c) => `${esc(c.label)}:${c.cap}`).join(' ')}</div>`
      + (g.ir ? `<div class="hint">R групи ≈ ${fmt(g.ir, 2)} мОм</div>` : '') + '</div>').join('')
      + (res.unused.length ? `<div class="group"><h4>Не використано</h4><div class="cells">${res.unused.map((c) => `${esc(c.label)}:${c.cap}`).join(' ')}</div></div>` : '');
    $('#mtApply').disabled = $('#mtCsv').disabled = false;
  } catch (e) {
    lastMatch = null;
    $('#mtSummary').innerHTML = `<div class="err">${esc(e.message)}</div>`;
    $('#mtGroups').innerHTML = '';
    $('#mtApply').disabled = $('#mtCsv').disabled = true;
  }
}

// ------------------------------------------------------------------ довідник
function bindCells() {
  const form = $('#cellForm');
  const shapeSel = form.elements.shape;
  shapeSel.addEventListener('change', () => {
    const prism = shapeSel.value === 'prism';
    $$('.f-cyl', form).forEach((e) => (e.hidden = prism));
    $$('.f-prism', form).forEach((e) => (e.hidden = !prism));
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const c = { custom: true, format: 'Власні', shape: fd.get('shape'), name: String(fd.get('name')).trim(), chem: fd.get('chem') };
    for (const k of ['d', 'w', 't', 'h', 'capacity', 'iMax', 'mass', 'vMin', 'vNom', 'vMax', 'ir']) {
      const v = parseFloat(String(fd.get(k) ?? '').replace(',', '.'));
      if (isFinite(v)) c[k] = v;
    }
    if (c.shape === 'cyl') { delete c.w; delete c.t; } else delete c.d;
    const errs = validateCell(c);
    $('#cellFormErr').textContent = errs.join('. ');
    if (errs.length) return;
    c.id = `custom-${Date.now().toString(36)}`;
    state.customCells.push(c);
    state.cellId = c.id;
    fillCellSelect(); onCellChange(); renderCellsTable();
    toast('Комірку додано та обрано');
  });
  $('#cellSearch').addEventListener('input', renderCellsTable);
  $('#cellsTable').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      state.customCells = state.customCells.filter((c) => c.id !== del.dataset.del);
      if (!allCells().some((c) => c.id === state.cellId)) state.cellId = BUILTIN_CELLS[0].id;
      fillCellSelect(); onCellChange(); renderCellsTable();
      return;
    }
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    state.cellId = tr.dataset.id;
    fillCellSelect(); onCellChange(); renderCellsTable();
    toast(`Обрано ${getCell().name}`);
  });
}
function renderCellsTable() {
  const q = $('#cellSearch').value.trim().toLowerCase();
  const list = allCells().filter((c) => !q || `${c.name} ${c.format} ${c.chem}`.toLowerCase().includes(q));
  $('#cellsTable').innerHTML = '<thead><tr><th>Назва</th><th>Хімія</th><th>Розмір, мм</th><th class="num">А·год</th><th class="num">Вт·год</th><th class="num">I max</th><th class="num">IR</th><th class="num">Маса</th><th></th></tr></thead><tbody>'
    + list.map((c) => `<tr data-id="${esc(c.id)}" class="${c.id === state.cellId ? 'sel' : ''}"><td>${esc(c.name)}</td><td>${esc(c.chem)}</td>`
      + `<td>${c.shape === 'cyl' ? `Ø${c.d}×${c.h}` : `${c.w}×${c.t}×${c.h}`}</td><td class="num">${fmt(c.capacity, 2)}</td>`
      + `<td class="num">${fmt(c.capacity * c.vNom, 1)}</td><td class="num">${c.iMax} А</td><td class="num">${c.ir ?? '—'}</td>`
      + `<td class="num">${c.mass ?? '—'} г</td><td>${c.custom ? `<button class="ghost" data-del="${esc(c.id)}" title="Видалити">✕</button>` : ''}</td></tr>`).join('') + '</tbody>';
}

// ------------------------------------------------------------------ старт
function renderAll() {
  renderDesigner();
  renderCellsTable();
  renderCalcs();
  updateFitHint();
}

load();
initTheme();
fillCellSelect();
bindDesigner();
bindFit();
bindCalcs();
bindMatch();
bindCells();
bindBms();
syncInputs();
renderAll();
runFit();
initTabs();
