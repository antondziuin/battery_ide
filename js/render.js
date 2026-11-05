// Генерація SVG для схеми пакета та прев'ю вписування в корпус.
//
// Режими фізичної схеми:
//   scheme   — оглядова схема: паралельні групи як кольорові області, шлях струму P− → P+
//   assembly — креслення для зварювання (з кроками: комірки → верх → низ)
//   currents — розрахунковий струм комірок і навантаження перемичок
//   wiring   — балансувальні та силові дроти до BMS

import { loadColor } from './analysis.js';
import { wireColor, harnessRoutes } from './routing.js';
import { terminalPoint, groupCentroids } from './layout.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (n) => (Math.round(n * 100) / 100).toString();

export function groupColor(g, light = 78) {
  return `hsl(${Math.round((g * 137.508) % 360)}, 62%, ${light}%)`;
}

const COLORS = {
  bg: '#ffffff', text: '#1d232b', muted: '#5b6672', stroke: '#2c333b',
  nickel: '#9aa4ae', series: '#d4862a', plus: '#d93636', minus: '#1d232b',
  tag: '#2456c7', tagPack: '#b3261e', dim: '#7a8591', flow: '#1d232b',
};

const MIRROR_SIDE = { left: 'right', right: 'left', top: 'top', bottom: 'bottom' };

export const VIEW_MODES = {
  scheme: 'Порядок груп і шлях струму від P− до P+. Кольорова область — одна паралельна група; суцільна стрілка — групи з\'єднані зверху, пунктирна — знизу.',
  assembly: 'Креслення для зварювання: полярність кожної комірки й перемички на верхній та нижній стороні. Оберіть крок, щоб бачити лише потрібне.',
  currents: 'Розрахунковий струм кожної комірки та навантаження перемичок при заданому струмі навантаження.',
  wiring: 'Куди приварити балансувальні дроти B0…Bn і силові виводи P+/P− та як вони йдуть до BMS.',
};

/**
 * @param {object} layout результат generateLayout
 * @param {object} opts
 * @param {'scheme'|'assembly'|'currents'|'wiring'} [opts.mode]
 * @param {'all'|'cells'|'top'|'bottom'} [opts.step] крок збирання (для assembly)
 * @param {boolean} [opts.mirrorBottom]
 * @param {'group'|'groupk'|'index'|'capacity'|'current'|'none'} [opts.labels]
 * @param {Object<number,string>} [opts.cellLabels] довільні підписи комірок (наприклад, ємність)
 * @param {object} [opts.analysis] результат analyzeCurrents
 * @param {string} [opts.title]
 */
export function renderPackSVG(layout, opts = {}) {
  const mode = VIEW_MODES[opts.mode] ? opts.mode : 'assembly';
  const step = mode === 'assembly' ? opts.step || 'all' : 'all';
  const fp = layout.footprint;
  const base = Math.min(fp.w, fp.h);
  const fs = Math.max(2.5, Math.min(base * 0.3, 9));
  const pad = Math.max(Math.min(base * 0.9, 25), fs * 3);
  const titleH = fs * 2.2;
  const showBms = mode === 'wiring';
  const cyl = layout.shape === 'cyl';
  const bottomTitle = opts.mirrorBottom ? 'Вигляд знизу (пакет перевернуто)' : 'Нижня сторона (як крізь пакет зверху)';

  let views;
  if (mode === 'scheme') views = [{ side: 'scheme', title: 'Схема з\'єднань · вигляд зверху' }];
  else if (!cyl) views = [{ side: 'both', title: step === 'cells' ? 'Крок 1 · розстановка комірок' : 'Вигляд зверху (клеми)' }];
  else if (step === 'cells') views = [{ side: 'top', title: 'Крок 1 · розстановка комірок (вигляд зверху)', noStrips: true }];
  else if (step === 'top') views = [{ side: 'top', title: 'Крок 2 · перемички на верхній стороні' }];
  else if (step === 'bottom') views = [{ side: 'bottom', title: `Крок 3 · перемички знизу — ${opts.mirrorBottom ? 'пакет перевернуто' : 'як крізь пакет'}`, mirror: !!opts.mirrorBottom }];
  else views = [{ side: 'top', title: 'Вигляд зверху' }, { side: 'bottom', title: bottomTitle, mirror: !!opts.mirrorBottom }];
  if (!cyl && step === 'cells') views[0].noStrips = true;

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
  const leg = legendLayout(layout, fs, W, mode, step);
  const legendH = leg.height;
  const H = (horizontal ? vh : vh * views.length) + legendH + (opts.title ? titleH : 0);

  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${f(H)}" width="${f(W * 3)}" height="${f(H * 3)}" font-family="Inter, Segoe UI, Arial, sans-serif">`;
  s += `<defs><marker id="arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${COLORS.flow}"/></marker></defs>`;
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
    s += `<text x="${f(vw / 2)}" y="${f(titleH * 0.75)}" font-size="${f(Math.min(fs * 1.1, (vw * 0.95) / (v.title.length * 0.55)))}" font-weight="600" text-anchor="middle" fill="${COLORS.text}">${esc(v.title)}</text>`;
    s += `<g transform="translate(${f(pd.left)},${f(pd.top + titleH)})">`;
    const ctx = {
      layout, opts, fs, mirror: !!v.mirror, side: v.side, bmsBox, showBms, mode, step,
      noStrips: !!v.noStrips, analysis: mode === 'currents' && opts.analysis?.ok ? opts.analysis : null,
    };
    if (v.side === 'scheme') s += schemeView(ctx);
    else s += cyl ? cylView(ctx) : prismView(ctx);
    if (mode !== 'wiring') s += dims(layout, fs);
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

function cellText(c, ctx) {
  const { opts } = ctx;
  if (ctx.mode === 'currents' && ctx.analysis) return `${fmt1(ctx.analysis.cellI[c.id])}А`;
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
  const a = ctx.analysis;
  if (a) {
    const I = a.linkI[bus.index][li];
    const ratio = I / a.ampacity;
    return { color: loadColor(ratio), opacity: 0.88, title: `Перемичка B${bus.index}: ${fmt1(I)} А (${Math.round(ratio * 100)}% допустимого)` };
  }
  if (ctx.mode === 'wiring') return { color: '#c4cad1', opacity: 0.7, title: `Перемичка B${bus.index}` };
  return { color: l.series ? COLORS.series : COLORS.nickel, opacity: 0.85, title: `${l.series ? 'Послідовна' : 'Паралельна'} перемичка B${bus.index}` };
}

function tag(x, y, text, color, fs) {
  const w = fs * 0.62 * text.length + fs * 0.6;
  const h = fs * 1.15;
  return `<g><rect x="${f(x - w / 2)}" y="${f(y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(h * 0.3)}" fill="${color}" stroke="#fff" stroke-width="${f(fs * 0.08)}"/>`
    + `<text x="${f(x)}" y="${f(y + fs * 0.33)}" font-size="${f(fs * 0.85)}" font-weight="700" text-anchor="middle" fill="#fff">${esc(text)}</text></g>`;
}

const busLabel = (b, S) => (b.index === 0 ? 'B0 P−' : b.index === S ? `B${S} P+` : `B${b.index}`);
const busTagColor = (b, S) => (b.index === 0 || b.index === S ? COLORS.tagPack : wireColor(b.index));

// ------------------------------------------------------------------ оглядова схема

function schemeView(ctx) {
  const { layout, fs } = ctx;
  const cyl = layout.shape === 'cyl';
  const fp = layout.footprint;
  const r = Math.min(fp.w, fp.h) / 2;
  const S = layout.S;
  const ow = Math.max(r * 0.12, fs * 0.15); // товщина контуру групи
  // пари сусідніх комірок однієї групи
  const pairs = new Map();
  for (const b of layout.buses) for (const l of b.links) if (!l.series) pairs.set(`${Math.min(l.a, l.b)}-${Math.max(l.a, l.b)}`, l);
  const shape = (c, grow, color) => (cyl
    ? `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r + grow)}" fill="${color}"/>`
    : `<rect x="${f(c.x - fp.w / 2 - grow)}" y="${f(c.y - fp.h / 2 - grow)}" width="${f(fp.w + 2 * grow)}" height="${f(fp.h + 2 * grow)}" rx="${f(r * 0.15 + grow)}" fill="${color}"/>`);
  const bar = (A, B, w, color) => `<line x1="${f(A.x)}" y1="${f(A.y)}" x2="${f(B.x)}" y2="${f(B.y)}" stroke="${color}" stroke-width="${f(w)}" stroke-linecap="round"/>`;
  const barW = cyl ? r * 1.3 : Math.min(fp.w, fp.h) * 0.9;

  let s = '';
  // контур груп (знизу) і заливка (зверху) — межі між групами залишаються видимими
  for (const c of layout.cells) s += shape(c, ow, groupColor(c.group, 42));
  for (const l of pairs.values()) s += bar(layout.cells[l.a], layout.cells[l.b], barW + 2 * ow, groupColor(layout.cells[l.a].group, 42));
  for (const l of pairs.values()) s += bar(layout.cells[l.a], layout.cells[l.b], barW, groupColor(layout.cells[l.a].group, 80));
  for (const c of layout.cells) {
    s += shape(c, 0, groupColor(c.group, 80));
    s += cyl
      ? `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r * 0.8)}" fill="none" stroke="${groupColor(c.group, 66)}" stroke-width="${f(r * 0.05)}">${cellTitle(c, ctx.opts)}</circle>`
      : '';
    const plus = c.plusTop;
    const [tx, ty] = cyl ? [c.x + r * 0.5, c.y - r * 0.42] : terminalPoint(layout, c, 'top');
    s += `<text x="${f(tx)}" y="${f(ty + fs * 0.3)}" font-size="${f(fs * 0.9)}" font-weight="800" text-anchor="middle" fill="${plus ? COLORS.plus : COLORS.minus}" opacity="0.75">${plus ? '+' : '−'}</text>`;
  }

  // шлях струму: P− → центри груп → P+
  const cents = groupCentroids(layout);
  const pts = [];
  const pm = layout.cells[layout.buses[0].power];
  const pp = layout.cells[layout.buses[S].power];
  pts.push({ x: pm.x, y: pm.y });
  cents.forEach((c) => pts.push(c));
  pts.push({ x: pp.x, y: pp.y });
  const lw = Math.max(fs * 0.28, r * 0.16);
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1];
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    if (len < 1e-6) continue;
    // сегмент i з'єднує: 0 — P−→група 1, S — група S→P+, інші — шина i (групи i та i+1)
    const side = i === 0 ? layout.buses[0].side : i === S ? layout.buses[S].side : layout.buses[i].side;
    const dash = side === 'bottom' ? `stroke-dasharray="${f(lw * 2.2)} ${f(lw * 1.6)}"` : '';
    s += `<line x1="${f(A.x)}" y1="${f(A.y)}" x2="${f(B.x)}" y2="${f(B.y)}" stroke="#fff" stroke-width="${f(lw * 2.4)}" stroke-linecap="round" opacity="0.7"/>`;
    // стрілка посередині сегмента
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    s += `<line x1="${f(A.x)}" y1="${f(A.y)}" x2="${f(mx)}" y2="${f(my)}" stroke="${COLORS.flow}" stroke-width="${f(lw)}" ${dash} marker-end="url(#arrowhead)"/>`;
    s += `<line x1="${f(mx)}" y1="${f(my)}" x2="${f(B.x)}" y2="${f(B.y)}" stroke="${COLORS.flow}" stroke-width="${f(lw)}" ${dash}/>`;
    if (i > 0 && i < S) {
      const n = layout.buses[i].seriesLinks;
      if (n === 1) s += `<text x="${f(mx)}" y="${f(my - fs * 0.6)}" font-size="${f(fs * 0.7)}" font-weight="700" text-anchor="middle" fill="${COLORS.tagPack}">1 контакт!</text>`;
    }
  }
  // номери груп
  cents.forEach((c, g) => {
    s += `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(fs * 1.05)}" fill="#fff" stroke="${groupColor(g, 38)}" stroke-width="${f(fs * 0.16)}"/>`;
    s += `<text x="${f(c.x)}" y="${f(c.y + fs * 0.42)}" font-size="${f(fs * 1.15)}" font-weight="800" text-anchor="middle" fill="${groupColor(g, 28)}">${g + 1}</text>`;
  });
  s += tag(pm.x, pm.y - r * 0.6, 'P−', COLORS.minus, fs);
  s += tag(pp.x, pp.y + r * 0.6, 'P+', COLORS.plus, fs);
  return s;
}

// ------------------------------------------------------------------ BMS

/**
 * Шар BMS: блок біля краю пакета і дроти за трасами harnessRoutes (без перетинів).
 * @param {(route)=>boolean} surfaceFilter які траси показувати в цьому виді
 */
function bmsLayer(ctx, surfaceFilter) {
  const { layout, fs, bmsBox, mirror } = ctx;
  const H = harnessRoutes(layout, { gap: bmsBox.gap, thick: bmsBox.thick, minPitch: fs * 0.6 });
  const X = (x) => (mirror ? layout.width - x : x);
  const P = (p) => `${f(X(p[0]))},${f(p[1])}`;
  const r = H.bms;
  const bx = mirror ? layout.width - (r.x + r.w) : r.x;
  let halo = '', wires = '', box = '';
  box += `<rect x="${f(bx)}" y="${f(r.y)}" width="${f(r.w)}" height="${f(r.h)}" rx="${f(fs * 0.4)}" fill="#e7f0ff" stroke="${COLORS.tag}" stroke-width="${f(fs * 0.12)}"/>`;
  const vertical = r.h > r.w;
  box += `<text x="${f(bx + r.w / 2)}" y="${f(r.y + r.h / 2 + fs * 0.35)}" font-size="${f(fs)}" font-weight="800" text-anchor="middle" fill="${COLORS.tag}" ${vertical ? `transform="rotate(-90 ${f(bx + r.w / 2)} ${f(r.y + r.h / 2)})"` : ''}>BMS</text>`;
  const shown = H.routes.filter(surfaceFilter);
  // спершу силові (товстіші), зверху — балансувальні
  shown.sort((a, b) => (a.kind === 'power' ? 0 : 1) - (b.kind === 'power' ? 0 : 1));
  for (const rt of shown) {
    const w = rt.kind === 'power' ? fs * 0.42 : fs * 0.2;
    const pts = rt.points.map(P).join(' ');
    halo += `<polyline points="${pts}" fill="none" stroke="#fff" stroke-width="${f(w + fs * 0.24)}" stroke-linejoin="round" stroke-linecap="round"/>`;
    wires += `<polyline points="${pts}" fill="none" stroke="${rt.color}" stroke-width="${f(w)}" stroke-linejoin="round" stroke-linecap="round"><title>${esc(rt.kind === 'power' ? (rt.name === 'P−' ? 'Силовий P− → B− BMS' : 'Силовий P+ → запобіжник') : `Балансувальний дріт ${rt.name}`)}</title></polyline>`;
    const end = rt.points[rt.points.length - 1];
    box += `<circle cx="${f(X(end[0]))}" cy="${f(end[1])}" r="${f(rt.kind === 'power' ? fs * 0.4 : fs * 0.26)}" fill="${rt.color}"/>`;
  }
  return { wires: halo + wires, box };
}

// ------------------------------------------------------------------ детальні види

function cylView(ctx) {
  const { layout, opts, fs, mirror, side } = ctx;
  const r = layout.footprint.w / 2;
  const X = (x) => (mirror ? layout.width - x : x);
  const S = layout.S;
  const dim = ctx.mode === 'wiring';
  let s = '';
  for (const c of layout.cells)
    s += `<circle cx="${f(X(c.x))}" cy="${f(c.y)}" r="${f(r)}" fill="${groupColor(c.group, dim ? 90 : 78)}" stroke="${dim ? '#aab2bb' : COLORS.stroke}" stroke-width="${f(r * 0.05)}">${cellTitle(c, opts)}</circle>`;
  if (!ctx.noStrips) {
    const sw = r * (dim ? 0.4 : 0.62);
    for (const b of layout.buses.filter((b) => b.side === side))
      b.links.forEach((l, li) => {
        const A = layout.cells[l.a], B = layout.cells[l.b];
        const st = linkStyle(ctx, b, li, l);
        s += `<line x1="${f(X(A.x))}" y1="${f(A.y)}" x2="${f(X(B.x))}" y2="${f(B.y)}" stroke="${st.color}" stroke-width="${f(sw)}" stroke-linecap="round" opacity="${st.opacity}"><title>${esc(st.title)}</title></line>`;
      });
  }
  for (const c of layout.cells) {
    const plus = side === 'top' ? c.plusTop : !c.plusTop;
    const x = X(c.x);
    const big = ctx.noStrips ? 1.5 : 1;
    if (plus) s += `<circle cx="${f(x)}" cy="${f(c.y)}" r="${f(r * 0.42 * big)}" fill="none" stroke="${COLORS.plus}" stroke-width="${f(r * 0.07)}" pointer-events="none" ${dim ? 'opacity="0.4"' : ''}/>`;
    s += `<text x="${f(x)}" y="${f(c.y + fs * 0.1 * big)}" font-size="${f(fs * 1.25 * big)}" font-weight="800" text-anchor="middle" fill="${plus ? COLORS.plus : COLORS.minus}" pointer-events="none" ${dim ? 'opacity="0.35"' : ''}>${plus ? '+' : '−'}</text>`;
    const t = dim ? '' : cellText(c, ctx);
    if (t) s += `<text x="${f(x)}" y="${f(c.y + r * 0.72)}" font-size="${f(fs * 0.62)}" text-anchor="middle" fill="${COLORS.text}" pointer-events="none">${esc(t)}</text>`;
  }
  if (ctx.showBms) {
    const layer = bmsLayer(ctx, (rt) => rt.surface === side);
    s += layer.wires + layer.box;
  }
  // мітки шин: у режимі збирання — лише номери шин, у режимі проводки — разом із силовими виводами
  if ((ctx.mode === 'assembly' && !ctx.noStrips) || ctx.showBms)
    for (const b of layout.buses.filter((b) => b.side === side)) {
      const c = layout.cells[b.tap];
      s += tag(X(c.x), c.y - r * 0.62, busLabel(b, S), busTagColor(b, S), fs);
      if (ctx.showBms && (b.index === 0 || b.index === S) && b.power !== b.tap) {
        const pc = layout.cells[b.power];
        s += tag(X(pc.x), pc.y - r * 0.62, b.index === 0 ? 'P−' : 'P+', COLORS.tagPack, fs);
      }
    }
  return s;
}

function prismView(ctx) {
  const { layout, opts, fs } = ctx;
  const fp = layout.footprint;
  const tr = Math.min(fp.w, fp.h) * 0.17;
  const S = layout.S;
  const dim = ctx.mode === 'wiring';
  const T = (c, side) => terminalPoint(layout, c, side);
  let s = '';
  for (const c of layout.cells)
    s += `<rect x="${f(c.x - fp.w / 2)}" y="${f(c.y - fp.h / 2)}" width="${f(fp.w)}" height="${f(fp.h)}" rx="${f(tr * 0.3)}" fill="${groupColor(c.group, dim ? 90 : 78)}" stroke="${COLORS.stroke}" stroke-width="${f(tr * 0.12)}">${cellTitle(c, opts)}</rect>`;
  if (!ctx.noStrips)
    for (const b of layout.buses)
      b.links.forEach((l, li) => {
        const ca = layout.cells[l.a], cb = layout.cells[l.b];
        const A = T(ca, b.side), B = T(cb, b.side);
        const st = linkStyle(ctx, b, li, l);
        // сусіди вздовж осі клем: шина пройшла б над іншою клемою — показуємо як гнучкий кабель
        const cable = layout.rotate ? Math.abs(ca.y - cb.y) < 1e-6 : Math.abs(ca.x - cb.x) < 1e-6;
        s += cable
          ? `<line x1="${f(A[0] + tr * 1.4)}" y1="${f(A[1])}" x2="${f(B[0] + tr * 1.4)}" y2="${f(B[1])}" stroke="${st.color}" stroke-width="${f(tr * 0.6)}" stroke-dasharray="${f(tr)} ${f(tr * 0.6)}" stroke-linecap="round"><title>${esc(st.title)}</title></line>`
          : `<line x1="${f(A[0])}" y1="${f(A[1])}" x2="${f(B[0])}" y2="${f(B[1])}" stroke="${st.color}" stroke-width="${f(tr * 1.3)}" stroke-linecap="round" opacity="${st.opacity}"><title>${esc(st.title)}</title></line>`;
      });
  for (const c of layout.cells) {
    for (const side of ['top', 'bottom']) {
      const plus = side === 'top' ? c.plusTop : !c.plusTop;
      const [x, y] = T(c, side);
      s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(tr)}" fill="${plus ? COLORS.plus : COLORS.minus}" pointer-events="none" ${dim ? 'opacity="0.45"' : ''}/>`;
      s += `<text x="${f(x)}" y="${f(y + tr * 0.35)}" font-size="${f(tr * 1.1)}" font-weight="800" text-anchor="middle" fill="#fff" pointer-events="none">${plus ? '+' : '−'}</text>`;
    }
    const t = dim ? '' : cellText(c, ctx);
    if (t) s += `<text x="${f(c.x)}" y="${f(c.y + fs * 0.3)}" font-size="${f(fs * 0.8)}" text-anchor="middle" fill="${COLORS.text}" pointer-events="none">${esc(t)}</text>`;
  }
  if (ctx.showBms) {
    const layer = bmsLayer(ctx, () => true);
    s += layer.wires + layer.box;
  }
  if ((ctx.mode === 'assembly' && !ctx.noStrips) || ctx.showBms)
    for (const b of layout.buses) {
      const [x, y] = T(layout.cells[b.tap], b.side);
      s += tag(x + tr * 2.6, y, busLabel(b, S), busTagColor(b, S), fs * 0.8);
    }
  return s;
}

function legendLayout(layout, fs, W, mode, step) {
  let items;
  if (mode === 'scheme') items = [
    [groupColor(0, 70), 'кольорова область — паралельна група (номер у колі)'],
    [COLORS.flow, 'стрілка — шлях струму; суцільна: з\'єднання зверху, пунктир: знизу'],
  ];
  else if (mode === 'currents') items = [
    [loadColor(0.2), 'перемичка < 50% допустимого струму'],
    [loadColor(0.6), '50–80%'],
    [loadColor(0.9), '80–100%'],
    [loadColor(1.2), 'перевантажена'],
  ];
  else if (mode === 'wiring') items = [
    [COLORS.tag, 'балансувальні дроти B0…Bn → BMS'],
    [COLORS.plus, 'силовий P+ → запобіжник'],
    [COLORS.minus, 'силовий P− → B− BMS'],
  ];
  else if (step === 'cells') items = [
    [COLORS.plus, '«+» догори: групи 1, 3, 5…'],
    [COLORS.minus, '«−» догори: групи 2, 4, 6…'],
  ];
  else items = [
    [COLORS.nickel, 'паралельна перемичка'],
    [COLORS.series, 'послідовна перемичка'],
    [COLORS.tag, 'номер шини (балансувальний вивід)'],
  ];
  if (layout.shape === 'prism' && mode !== 'scheme') items.push([COLORS.muted, 'пунктир — гнучкий кабель між рядами']);
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
