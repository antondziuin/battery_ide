// Генерація SVG для схеми пакета та прев'ю вписування в корпус.

import { loadColor } from './analysis.js';
import { wireColor } from './bms.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (n) => (Math.round(n * 100) / 100).toString();

export function groupColor(g, light = 78) {
  return `hsl(${Math.round((g * 137.508) % 360)}, 62%, ${light}%)`;
}

const COLORS = {
  bg: '#ffffff', text: '#1d232b', muted: '#5b6672', stroke: '#2c333b',
  nickel: '#9aa4ae', series: '#d4862a', plus: '#d93636', minus: '#1d232b',
  tag: '#2456c7', tagPack: '#b3261e', dim: '#7a8591',
};

const MIRROR_SIDE = { left: 'right', right: 'left', top: 'top', bottom: 'bottom' };

/**
 * @param {object} layout результат generateLayout
 * @param {object} opts
 * @param {boolean} [opts.mirrorBottom]
 * @param {'group'|'groupk'|'index'|'capacity'|'current'|'none'} [opts.labels]
 * @param {boolean} [opts.showBalance] балансувальні дроти та BMS
 * @param {Object<number,string>} [opts.cellLabels] довільні підписи комірок (наприклад, ємність)
 * @param {object} [opts.analysis] результат analyzeCurrents — підсвітка навантаження перемичок
 * @param {string} [opts.title]
 */
export function renderPackSVG(layout, opts = {}) {
  const fp = layout.footprint;
  const base = Math.min(fp.w, fp.h);
  const fs = Math.max(2.5, Math.min(base * 0.3, 9));
  const pad = Math.max(Math.min(base * 0.9, 25), fs * 3);
  const titleH = fs * 2.2;
  const showBms = opts.showBalance !== false;
  const views = layout.shape === 'cyl'
    ? [{ side: 'top', title: 'Вигляд зверху' }, { side: 'bottom', title: opts.mirrorBottom ? 'Вигляд знизу (пакет перевернуто)' : 'Нижня сторона (як крізь пакет зверху)', mirror: !!opts.mirrorBottom }]
    : [{ side: 'both', title: 'Вигляд зверху (клеми)' }];

  const bmsBox = { gap: fs * 3, thick: fs * 3.2 };
  const padsFor = (mirror) => {
    const p = { left: pad, right: pad, top: pad, bottom: pad };
    if (showBms) {
      const side = mirror ? MIRROR_SIDE[layout.bmsSide] : layout.bmsSide;
      p[side] = Math.max(pad, bmsBox.gap + bmsBox.thick + fs);
    }
    return p;
  };
  const p0 = padsFor(false);
  const vw = layout.width + p0.left + p0.right;
  const vh = layout.height + p0.top + p0.bottom + titleH;
  const horizontal = layout.width <= layout.height * 1.6;
  const W = horizontal ? vw * views.length : vw;
  const leg = legendLayout(layout, fs, W, opts);
  const legendH = leg.height;
  const H = (horizontal ? vh : vh * views.length) + legendH + (opts.title ? titleH : 0);

  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${f(H)}" width="${f(W * 3)}" height="${f(H * 3)}" font-family="Inter, Segoe UI, Arial, sans-serif">`;
  s += `<rect x="0" y="0" width="${f(W)}" height="${f(H)}" fill="${COLORS.bg}"/>`;
  let top0 = 0;
  if (opts.title) {
    const tfs = Math.min(fs * 1.3, (W * 0.95) / (opts.title.length * 0.58));
    s += `<text x="${f(W / 2)}" y="${f(titleH * 0.7)}" font-size="${f(tfs)}" font-weight="700" text-anchor="middle" fill="${COLORS.text}">${esc(opts.title)}</text>`;
    top0 = titleH;
  }
  views.forEach((v, i) => {
    const ox = horizontal ? i * vw : 0;
    const oy = top0 + (horizontal ? 0 : i * vh);
    const pd = padsFor(!!v.mirror);
    s += `<g transform="translate(${f(ox)},${f(oy)})">`;
    s += `<text x="${f(vw / 2)}" y="${f(titleH * 0.75)}" font-size="${f(fs * 1.1)}" font-weight="600" text-anchor="middle" fill="${COLORS.text}">${esc(v.title)}</text>`;
    s += `<g transform="translate(${f(pd.left)},${f(pd.top + titleH)})">`;
    const ctx = { layout, opts, fs, mirror: !!v.mirror, side: v.side, bmsBox, showBms };
    s += layout.shape === 'cyl' ? cylView(ctx) : prismView(ctx);
    s += dims(layout, fs);
    s += '</g></g>';
  });
  s += legend(leg, fs, H - legendH);
  s += '</svg>';
  return s;
}

function dims(layout, fs) {
  const { width: w, height: h } = layout;
  const o = fs * 1.2;
  return `<g stroke="${COLORS.dim}" stroke-width="${f(fs * 0.06)}" fill="${COLORS.dim}" font-size="${f(fs * 0.8)}">`
    + `<line x1="0" y1="${f(h + o)}" x2="${f(w)}" y2="${f(h + o)}"/>`
    + `<line x1="0" y1="${f(h + o * 0.6)}" x2="0" y2="${f(h + o * 1.4)}"/><line x1="${f(w)}" y1="${f(h + o * 0.6)}" x2="${f(w)}" y2="${f(h + o * 1.4)}"/>`
    + `<text x="${f(w / 2)}" y="${f(h + o * 2.1)}" text-anchor="middle" stroke="none">${f(w)} мм</text>`
    + `<line x1="${f(-o)}" y1="0" x2="${f(-o)}" y2="${f(h)}"/>`
    + `<line x1="${f(-o * 1.4)}" y1="0" x2="${f(-o * 0.6)}" y2="0"/><line x1="${f(-o * 1.4)}" y1="${f(h)}" x2="${f(-o * 0.6)}" y2="${f(h)}"/>`
    + `<text x="${f(-o * 1.5)}" y="${f(h / 2)}" text-anchor="middle" stroke="none" transform="rotate(-90 ${f(-o * 1.5)} ${f(h / 2)})">${f(h)} мм</text>`
    + '</g>';
}

const fmt1 = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');

function cellText(c, opts) {
  if (opts.cellLabels && opts.cellLabels[c.id] != null) return opts.cellLabels[c.id];
  switch (opts.labels || 'group') {
    case 'group': return `${c.group + 1}S`;
    case 'index': return `#${c.id + 1}`;
    case 'groupk': return `${c.group + 1}.${c.k + 1}`;
    case 'current': return opts.analysis?.ok ? `${fmt1(opts.analysis.cellI[c.id])}А` : `${c.group + 1}S`;
    default: return '';
  }
}

function cellTitle(c, opts) {
  let t = `Комірка #${c.id + 1} · група ${c.group + 1}, позиція ${c.k + 1} · ряд ${c.row + 1}, стовпець ${c.col + 1}`;
  if (opts.analysis?.ok) t += ` · струм ${fmt1(opts.analysis.cellI[c.id])} А`;
  return `<title>${esc(t)}</title>`;
}

function linkStyle(ctx, bus, li, l) {
  const a = ctx.opts.analysis;
  if (a?.ok) {
    const I = a.linkI[bus.index][li];
    const ratio = I / a.ampacity;
    return { color: loadColor(ratio), title: `Перемичка B${bus.index}: ${fmt1(I)} А (${Math.round(ratio * 100)}% допустимого)` };
  }
  return { color: l.series ? COLORS.series : COLORS.nickel, title: `${l.series ? 'Послідовна' : 'Паралельна'} перемичка B${bus.index}` };
}

function tag(x, y, text, color, fs) {
  const w = fs * 0.62 * text.length + fs * 0.6;
  const h = fs * 1.15;
  return `<g><rect x="${f(x - w / 2)}" y="${f(y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(h * 0.3)}" fill="${color}" stroke="#fff" stroke-width="${f(fs * 0.08)}"/>`
    + `<text x="${f(x)}" y="${f(y + fs * 0.33)}" font-size="${f(fs * 0.85)}" font-weight="700" text-anchor="middle" fill="#fff">${esc(text)}</text></g>`;
}

/** Геометрія блоку BMS біля відповідного краю пакета у координатах виду. */
function bmsGeometry(ctx) {
  const { layout, fs, bmsBox, mirror } = ctx;
  const side = mirror ? MIRROR_SIDE[layout.bmsSide] : layout.bmsSide;
  const vertical = side === 'left' || side === 'right';
  const edgeLen = vertical ? layout.height : layout.width;
  const len = Math.min(Math.max(edgeLen * 0.8, fs * 8), Math.max(edgeLen, fs * 8));
  const mid = edgeLen / 2;
  let x, y, w, h;
  if (side === 'right') { x = layout.width + bmsBox.gap; y = mid - len / 2; w = bmsBox.thick; h = len; }
  else if (side === 'left') { x = -bmsBox.gap - bmsBox.thick; y = mid - len / 2; w = bmsBox.thick; h = len; }
  else if (side === 'top') { x = mid - len / 2; y = -bmsBox.gap - bmsBox.thick; w = len; h = bmsBox.thick; }
  else { x = mid - len / 2; y = layout.height + bmsBox.gap; w = len; h = bmsBox.thick; }
  const S = layout.S;
  // піни роз'єму вздовж ближньої до пакета грані: B0…BS, далі силові
  const pin = (k) => {
    const t = (k + 1) / (S + 4);
    if (side === 'right') return [x, y + h * t];
    if (side === 'left') return [x + w, y + h * t];
    if (side === 'top') return [x + w * t, y + h];
    return [x + w * t, y];
  };
  const powerPin = (which) => {
    const t = which === 'minus' ? (S + 2) / (S + 4) : (S + 3) / (S + 4);
    if (side === 'right') return [x, y + h * t];
    if (side === 'left') return [x + w, y + h * t];
    if (side === 'top') return [x + w * t, y + h];
    return [x + w * t, y];
  };
  return { side, x, y, w, h, pin, powerPin };
}

function bmsLayer(ctx, sideFilter, termPoint) {
  const { layout, fs } = ctx;
  const g = bmsGeometry(ctx);
  const S = layout.S;
  let wires = '', box = '';
  box += `<rect x="${f(g.x)}" y="${f(g.y)}" width="${f(g.w)}" height="${f(g.h)}" rx="${f(fs * 0.4)}" fill="#e7f0ff" stroke="${COLORS.tag}" stroke-width="${f(fs * 0.12)}"/>`;
  box += `<text x="${f(g.x + g.w / 2)}" y="${f(g.y + g.h / 2 + fs * 0.35)}" font-size="${f(fs)}" font-weight="800" text-anchor="middle" fill="${COLORS.tag}">BMS</text>`;
  for (const b of layout.buses) {
    if (!sideFilter(b)) continue;
    const [cx, cy] = termPoint(b.tap, b.side);
    const [px, py] = g.pin(b.index);
    const col = wireColor(b.index);
    wires += `<line x1="${f(cx)}" y1="${f(cy)}" x2="${f(px)}" y2="${f(py)}" stroke="${col}" stroke-width="${f(fs * 0.16)}" opacity="0.9"><title>Балансувальний дріт B${b.index}</title></line>`;
    box += `<circle cx="${f(px)}" cy="${f(py)}" r="${f(fs * 0.25)}" fill="${col}"/>`;
  }
  // силові дроти
  for (const [b, which, col] of [[layout.buses[0], 'minus', COLORS.minus], [layout.buses[S], 'plus', COLORS.plus]]) {
    if (!sideFilter(b)) continue;
    const [cx, cy] = termPoint(b.power, b.side);
    const [px, py] = g.powerPin(which);
    wires += `<line x1="${f(cx)}" y1="${f(cy)}" x2="${f(px)}" y2="${f(py)}" stroke="${col}" stroke-width="${f(fs * 0.38)}" stroke-linecap="round" opacity="0.75"><title>${which === 'minus' ? 'Силовий P− → B− BMS' : 'Силовий P+ → запобіжник'}</title></line>`;
    box += `<circle cx="${f(px)}" cy="${f(py)}" r="${f(fs * 0.4)}" fill="${col}"/>`;
  }
  return { wires, box };
}

function cylView(ctx) {
  const { layout, opts, fs, mirror, side } = ctx;
  const r = layout.footprint.w / 2;
  const X = (x) => (mirror ? layout.width - x : x);
  const S = layout.S;
  let s = '';
  for (const c of layout.cells)
    s += `<circle cx="${f(X(c.x))}" cy="${f(c.y)}" r="${f(r)}" fill="${groupColor(c.group)}" stroke="${COLORS.stroke}" stroke-width="${f(r * 0.05)}">${cellTitle(c, opts)}</circle>`;
  // перемички
  const sw = r * 0.62;
  for (const b of layout.buses.filter((b) => b.side === side))
    b.links.forEach((l, li) => {
      const A = layout.cells[l.a], B = layout.cells[l.b];
      const st = linkStyle(ctx, b, li, l);
      s += `<line x1="${f(X(A.x))}" y1="${f(A.y)}" x2="${f(X(B.x))}" y2="${f(B.y)}" stroke="${st.color}" stroke-width="${f(sw)}" stroke-linecap="round" opacity="0.82"><title>${esc(st.title)}</title></line>`;
    });
  for (const c of layout.cells) {
    const plus = side === 'top' ? c.plusTop : !c.plusTop;
    const x = X(c.x);
    if (plus) s += `<circle cx="${f(x)}" cy="${f(c.y)}" r="${f(r * 0.42)}" fill="none" stroke="${COLORS.plus}" stroke-width="${f(r * 0.07)}" pointer-events="none"/>`;
    s += `<text x="${f(x)}" y="${f(c.y + fs * 0.1)}" font-size="${f(fs * 1.25)}" font-weight="800" text-anchor="middle" fill="${plus ? COLORS.plus : COLORS.minus}" pointer-events="none">${plus ? '+' : '−'}</text>`;
    const t = cellText(c, opts);
    if (t) s += `<text x="${f(x)}" y="${f(c.y + r * 0.72)}" font-size="${f(fs * 0.62)}" text-anchor="middle" fill="${COLORS.text}" pointer-events="none">${esc(t)}</text>`;
  }
  if (ctx.showBms) {
    const term = (id) => { const c = layout.cells[id]; return [X(c.x), c.y]; };
    const layer = bmsLayer(ctx, (b) => b.side === side, term);
    s += layer.wires + layer.box;
    for (const b of layout.buses.filter((b) => b.side === side)) {
      const c = layout.cells[b.tap];
      const label = b.index === 0 ? 'B0 P−' : b.index === S ? `B${S} P+` : `B${b.index}`;
      s += tag(X(c.x), c.y - r * 0.62, label, b.index === 0 || b.index === S ? COLORS.tagPack : wireColor(b.index), fs);
      if ((b.index === 0 || b.index === S) && b.power !== b.tap) {
        const pc = layout.cells[b.power];
        s += tag(X(pc.x), pc.y - r * 0.62, b.index === 0 ? 'P−' : 'P+', COLORS.tagPack, fs);
      }
    }
  }
  return s;
}

function prismTerminals(layout, c) {
  const fp = layout.footprint;
  if (layout.rotate) return { top: [c.x - fp.w * 0.3, c.y], bottom: [c.x + fp.w * 0.3, c.y] };
  return { top: [c.x, c.y - fp.h * 0.3], bottom: [c.x, c.y + fp.h * 0.3] };
}

function prismView(ctx) {
  const { layout, opts, fs } = ctx;
  const fp = layout.footprint;
  const tr = Math.min(fp.w, fp.h) * 0.17;
  const S = layout.S;
  let s = '';
  for (const c of layout.cells)
    s += `<rect x="${f(c.x - fp.w / 2)}" y="${f(c.y - fp.h / 2)}" width="${f(fp.w)}" height="${f(fp.h)}" rx="${f(tr * 0.3)}" fill="${groupColor(c.group)}" stroke="${COLORS.stroke}" stroke-width="${f(tr * 0.12)}">${cellTitle(c, opts)}</rect>`;
  for (const b of layout.buses)
    b.links.forEach((l, li) => {
      const ca = layout.cells[l.a], cb = layout.cells[l.b];
      const A = prismTerminals(layout, ca)[b.side], B = prismTerminals(layout, cb)[b.side];
      const st = linkStyle(ctx, b, li, l);
      // сусіди вздовж осі клем: шина пройшла б над іншою клемою — показуємо як гнучкий кабель
      const cable = layout.rotate ? Math.abs(ca.y - cb.y) < 1e-6 : Math.abs(ca.x - cb.x) < 1e-6;
      s += cable
        ? `<line x1="${f(A[0] + tr * 1.4)}" y1="${f(A[1])}" x2="${f(B[0] + tr * 1.4)}" y2="${f(B[1])}" stroke="${st.color}" stroke-width="${f(tr * 0.6)}" stroke-dasharray="${f(tr)} ${f(tr * 0.6)}" stroke-linecap="round"><title>${esc(st.title)}</title></line>`
        : `<line x1="${f(A[0])}" y1="${f(A[1])}" x2="${f(B[0])}" y2="${f(B[1])}" stroke="${st.color}" stroke-width="${f(tr * 1.3)}" stroke-linecap="round" opacity="0.85"><title>${esc(st.title)}</title></line>`;
    });
  for (const c of layout.cells) {
    const T = prismTerminals(layout, c);
    for (const side of ['top', 'bottom']) {
      const plus = side === 'top' ? c.plusTop : !c.plusTop;
      const [x, y] = T[side];
      s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(tr)}" fill="${plus ? COLORS.plus : COLORS.minus}" pointer-events="none"/>`;
      s += `<text x="${f(x)}" y="${f(y + tr * 0.35)}" font-size="${f(tr * 1.1)}" font-weight="800" text-anchor="middle" fill="#fff" pointer-events="none">${plus ? '+' : '−'}</text>`;
    }
    const t = cellText(c, opts);
    if (t) s += `<text x="${f(c.x)}" y="${f(c.y + fs * 0.3)}" font-size="${f(fs * 0.8)}" text-anchor="middle" fill="${COLORS.text}" pointer-events="none">${esc(t)}</text>`;
  }
  if (ctx.showBms) {
    const layer = bmsLayer(ctx, () => true, (id, side) => prismTerminals(layout, layout.cells[id])[side]);
    s += layer.wires + layer.box;
    for (const b of layout.buses) {
      const [x, y] = prismTerminals(layout, layout.cells[b.tap])[b.side];
      const label = b.index === 0 ? 'B0 P−' : b.index === S ? `B${S} P+` : `B${b.index}`;
      s += tag(x + tr * 2.6, y, label, b.index === 0 || b.index === S ? COLORS.tagPack : wireColor(b.index), fs * 0.8);
    }
  }
  return s;
}

function legendLayout(layout, fs, W, opts = {}) {
  const items = opts.analysis?.ok
    ? [
      [loadColor(0.2), 'перемичка < 50% допустимого струму'],
      [loadColor(0.6), '50–80%'],
      [loadColor(0.9), '80–100%'],
      [loadColor(1.2), 'перевантажена'],
    ]
    : [
      [COLORS.nickel, 'паралельна перемичка'],
      [COLORS.series, 'послідовна перемичка'],
    ];
  if (opts.showBalance !== false) items.push([COLORS.tag, 'балансувальні дроти B0…Bn → BMS'], [COLORS.tagPack, 'силові виводи P+ / P−']);
  if (layout.shape === 'prism') items.push([COLORS.muted, 'пунктир — гнучкий кабель між рядами']);
  const placed = [];
  let x = fs, line = 0;
  for (const [c, t] of items) {
    const w = fs * 2.4 + t.length * fs * 0.48;
    if (x + w > W - fs && x > fs) { x = fs; line++; }
    placed.push({ c, t, x, line });
    x += w;
  }
  return { placed, height: fs * (1.6 + (line + 1) * 1.3) };
}

function legend(leg, fs, y) {
  let s = `<g font-size="${f(fs * 0.8)}" fill="${COLORS.muted}">`;
  for (const { c, t, x, line } of leg.placed) {
    const ly = y + fs * 0.6 + line * fs * 1.3;
    s += `<rect x="${f(x)}" y="${f(ly)}" width="${f(fs * 1.6)}" height="${f(fs * 0.7)}" rx="${f(fs * 0.2)}" fill="${c}"/>`;
    s += `<text x="${f(x + fs * 2)}" y="${f(ly + fs * 0.6)}">${esc(t)}</text>`;
  }
  return s + '</g>';
}

/**
 * Прев'ю вписування в корпус: переріз корпусу в площині, перпендикулярній осі комірок.
 */
export function renderFitSVG({ planeA, planeB, margin, aAxis, bAxis, layout, layers, depth, cellLen }) {
  const fp = layout.footprint;
  const base = Math.min(fp.w, fp.h);
  const fs = Math.max(3, Math.min(Math.max(planeA, planeB) * 0.035, 24));
  const pad = fs * 3.5;
  const W = planeA + pad * 2, H = planeB + pad * 2 + fs * 2;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${f(H)}" font-family="Inter, Segoe UI, Arial, sans-serif">`;
  s += `<rect width="${f(W)}" height="${f(H)}" fill="#fff"/>`;
  s += `<g transform="translate(${f(pad)},${f(pad)})">`;
  s += `<rect x="0" y="0" width="${f(planeA)}" height="${f(planeB)}" fill="#eef2f6" stroke="#2c333b" stroke-width="${f(fs * 0.15)}" rx="${f(fs * 0.3)}"/>`;
  s += `<rect x="${f(margin)}" y="${f(margin)}" width="${f(planeA - 2 * margin)}" height="${f(planeB - 2 * margin)}" fill="none" stroke="#7a8591" stroke-dasharray="${f(fs * 0.4)} ${f(fs * 0.3)}" stroke-width="${f(fs * 0.08)}"/>`;
  s += `<g transform="translate(${f(margin)},${f(margin)})">`;
  for (const c of layout.cells) {
    if (layout.shape === 'cyl') s += `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(fp.w / 2)}" fill="${groupColor(c.group)}" stroke="#2c333b" stroke-width="${f(base * 0.03)}"/>`;
    else s += `<rect x="${f(c.x - fp.w / 2)}" y="${f(c.y - fp.h / 2)}" width="${f(fp.w)}" height="${f(fp.h)}" fill="${groupColor(c.group)}" stroke="#2c333b" stroke-width="${f(base * 0.03)}"/>`;
    if (base > fs * 1.5) s += `<text x="${f(c.x)}" y="${f(c.y + fs * 0.3)}" font-size="${f(Math.min(fs * 0.8, base * 0.3))}" text-anchor="middle" fill="#1d232b">${c.group + 1}</text>`;
  }
  s += `<rect x="0" y="0" width="${f(layout.width)}" height="${f(layout.height)}" fill="none" stroke="#2456c7" stroke-width="${f(fs * 0.1)}" stroke-dasharray="${f(fs * 0.6)} ${f(fs * 0.3)}"/>`;
  s += '</g>';
  s += `<g font-size="${f(fs)}" fill="#1d232b">`;
  s += `<text x="${f(planeA / 2)}" y="${f(-fs * 0.9)}" text-anchor="middle">${aAxis} = ${f(planeA)} мм</text>`;
  s += `<text x="${f(-fs * 0.9)}" y="${f(planeB / 2)}" text-anchor="middle" transform="rotate(-90 ${f(-fs * 0.9)} ${f(planeB / 2)})">${bAxis} = ${f(planeB)} мм</text>`;
  s += `<text x="0" y="${f(planeB + fs * 1.6)}" fill="#2456c7">Блок: ${f(layout.width)} × ${f(layout.height)} мм</text>`;
  s += `<text x="${f(planeA)}" y="${f(planeB + fs * 1.6)}" text-anchor="end" fill="#5b6672">Глибина: ${f(depth)} мм, комірка ${f(cellLen)} мм${layers > 1 ? `, шарів: ${layers}` : ''}</text>`;
  s += '</g></g></svg>';
  return s;
}

export function svgToPng(svgString, scale = 1) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const w = Math.min(img.width * scale, 8000), h = Math.min(img.height * scale, 8000);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png');
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
