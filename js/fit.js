// Вписування пакета в корпус.
// Корпус задається внутрішніми розмірами L × W × H (мм).
// Для кожної орієнтації комірки рахуємо, скільки рядів × стовпців поміщається
// в площині, перпендикулярній осі комірки, та скільки шарів уздовж осі.

import { SQRT3_2, denseCapacity, denseCols } from './layout.js';

const AXES = ['L', 'W', 'H'];

/** Скільки комірок розміром s з кроком p поміщається в довжину A. */
export function countAlong(A, s, p) {
  if (A + 1e-9 < s) return 0;
  return Math.floor((A - s) / p + 1e-9) + 1;
}

/**
 * Усі варіанти розміщення комірки в корпусі.
 * @param {{L:number,W:number,H:number}} box внутрішні розміри
 * @param {object} cell
 * @param {{gap?:number, margin?:number, depthReserve?:number, layerGap?:number, allowLayers?:boolean}} opt
 *   margin — зазор до стінок з кожного боку (тримачі, ізоляція)
 *   depthReserve — запас уздовж осі комірки (нікель, ізоляція, BMS)
 */
export function fitLayouts(box, cell, opt = {}) {
  const gap = opt.gap ?? 0.5;
  const margin = opt.margin ?? 2;
  const depthReserve = opt.depthReserve ?? 4;
  const layerGap = opt.layerGap ?? 2;
  const allowLayers = opt.allowLayers ?? true;
  const dims = { L: box.L, W: box.W, H: box.H };
  const out = [];

  // Осі: depth — уздовж осі комірки; a — горизонталь площини; b — вертикаль площини.
  const perms = [];
  for (const depth of AXES) {
    const rest = AXES.filter((x) => x !== depth);
    perms.push({ depth, a: rest[0], b: rest[1] });
    perms.push({ depth, a: rest[1], b: rest[0] });
  }

  for (const pm of perms) {
    const A = dims[pm.a] - 2 * margin;
    const B = dims[pm.b] - 2 * margin;
    const D = dims[pm.depth] - 2 * margin;
    const len = cell.h + depthReserve;
    if (A <= 0 || B <= 0 || D < len) continue;
    const layers = allowLayers ? Math.floor((D + layerGap) / (len + layerGap) + 1e-9) : 1;

    const variants = [];
    if (cell.shape === 'cyl') {
      const p = cell.d + gap;
      variants.push({ arrangement: 'grid', cols: countAlong(A, cell.d, p), rows: countAlong(B, cell.d, p) });
      // стільники: непарні ряди зміщені на півкроку, тому ширина + p/2
      const hc = countAlong(A - p / 2, cell.d, p);
      const hrRows = B + 1e-9 < cell.d ? 0 : Math.floor((B - cell.d) / (p * SQRT3_2) + 1e-9) + 1;
      if (hrRows >= 2) {
        variants.push({ arrangement: 'honeycomb', cols: hc, rows: hrRows });
        const dc = countAlong(A, cell.d, p);
        if (dc >= 2) variants.push({ arrangement: 'honeycomb2', cols: dc, rows: hrRows });
      }
      for (const v of variants) v.rotate = false;
    } else {
      for (const rotate of [false, true]) {
        const fw = rotate ? cell.w : cell.t, fh = rotate ? cell.t : cell.w;
        variants.push({ arrangement: 'grid', rotate, cols: countAlong(A, fw, fw + gap), rows: countAlong(B, fh, fh + gap) });
      }
    }

    for (const v of variants) {
      if (v.cols < 1 || v.rows < 1) continue;
      const perLayer = v.arrangement === 'honeycomb2' ? denseCapacity(v.rows, v.cols) : v.cols * v.rows;
      out.push({
        ...v,
        depthAxis: pm.depth, aAxis: pm.a, bAxis: pm.b,
        planeA: dims[pm.a], planeB: dims[pm.b], depth: dims[pm.depth],
        layers, perLayer, total: perLayer * layers,
        orientation: orientationName(pm.depth),
      });
    }
  }
  // прибираємо дублікати (однакова кількість і орієнтація)
  const seen = new Set();
  return out
    .sort((x, y) => y.total - x.total || y.perLayer - x.perLayer)
    .filter((v) => {
      const k = [v.depthAxis, v.aAxis, v.arrangement, v.rotate, v.cols, v.rows, v.layers].join('|');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export function orientationName(depthAxis) {
  if (depthAxis === 'H') return 'стоячи (вісь уздовж H)';
  if (depthAxis === 'L') return 'лежачи (вісь уздовж L)';
  return 'лежачи (вісь уздовж W)';
}

/**
 * Вибрати кількість рядів для S×P комірок у сітці maxRows × maxCols (в одному шарі),
 * щоб змійка помістилася. Повертає null, якщо не поміщається.
 */
export function chooseRows(S, P, maxRows, maxCols) {
  const N = S * P;
  if (N > maxRows * maxCols) return null;
  // класичний варіант: група = стовпець
  if (P <= maxRows && S <= maxCols) return P;
  let best = null;
  for (let r = 1; r <= maxRows; r++) {
    const c = Math.ceil(N / r);
    if (c > maxCols) continue;
    const waste = r * c - N;
    const score = waste * 10 + Math.abs(r - c) * 0.01 + (P % r === 0 || r % P === 0 ? 0 : 1);
    if (!best || score < best.score) best = { r, score };
  }
  return best ? best.r : null;
}

/** Кількість рядів для конструктора з урахуванням типу розміщення L. */
export function rowsFor(L, S, P) {
  if (L.arrangement === 'honeycomb2') {
    const N = S * P;
    if (N > L.perLayer) return null;
    // найменше стовпців, що вміщуються, — найкомпактніший блок
    for (let r = 1; r <= L.rows; r++) if (denseCols(N, r) <= L.cols) return r;
    return null;
  }
  return chooseRows(S, P, L.rows, L.cols);
}

/**
 * Для діапазону S знайти максимальний P, що поміщається.
 * Багатошарові варіанти: кожен шар — окремий блок із ceil(S/k) груп, блоки з'єднуються послідовно.
 */
export function bestConfigs(box, cell, opt = {}, sRange = [1, 24]) {
  const layouts = fitLayouts(box, cell, opt);
  const res = [];
  for (let S = sRange[0]; S <= sRange[1]; S++) {
    let best = null;
    for (const L of layouts) {
      // одношарове рішення
      let P = Math.floor(L.perLayer / S);
      while (P >= 1 && rowsFor(L, S, P) == null) P--;
      if (P >= 1) {
        const cand = { S, P, layout: L, layers: 1, layerS: S, rows: rowsFor(L, S, P) };
        if (!best || cand.P > best.P) best = cand;
      }
      // багатошарове: шари укладаються один на одного, кожен шар містить ceil(S/k) груп
      for (let k = 2; k <= L.layers; k++) {
        const Sl = Math.ceil(S / k);
        let Pm = Math.floor(L.perLayer / Sl);
        while (Pm >= 1 && rowsFor(L, Sl, Pm) == null) Pm--;
        if (Pm >= 1 && (!best || Pm > best.P)) best = { S, P: Pm, layout: L, layers: k, layerS: Sl, rows: rowsFor(L, Sl, Pm) };
      }
    }
    if (best) res.push(best);
  }
  return { layouts, configs: res };
}

/** Перевірити, чи поміщається конкретна конфігурація S×P; повертає всі підхожі розміщення. */
export function checkConfig(box, cell, S, P, opt = {}) {
  const layouts = fitLayouts(box, cell, opt);
  const ok = [];
  for (const L of layouts) {
    const rows = rowsFor(L, S, P);
    if (rows != null) { ok.push({ layout: L, rows, layers: 1, layerS: S }); continue; }
    for (let k = 2; k <= L.layers; k++) {
      const Sl = Math.ceil(S / k);
      const r = rowsFor(L, Sl, P);
      if (r != null) { ok.push({ layout: L, rows: r, layers: k, layerS: Sl }); break; }
    }
  }
  return ok;
}

/** Мінімальні внутрішні розміри корпусу під готову схему (одношарова). */
export function requiredBox(layout, cell, opt = {}) {
  const margin = opt.margin ?? 2;
  const depthReserve = opt.depthReserve ?? 4;
  const layers = layout.layers || 1;
  return {
    a: layout.width + 2 * margin,
    b: (layers > 1 ? layout.layerHeight : layout.height) + 2 * margin,
    depth: layers * cell.h + (layers - 1) * (layout.layerGapPhys ?? 4) + depthReserve + 2 * margin,
  };
}

// ------------------------------------------------------------------ довільна форма

/**
 * Контур форми (у мм, вісь y — донизу).
 * triangle: a — основа (низ), b — висота, x — положення вершини від лівого кінця основи
 * trapezoid: a — низ, c — верх, b — висота, x — зсув верхньої сторони від лівого краю
 * polygon: points — масив [x, y]
 */
export function shapeOutline(shape) {
  if (!shape) return null;
  const a = +shape.a || 0, b = +shape.b || 0, c = +shape.c || 0, x = +shape.x || 0;
  if (shape.type === 'triangle') return [[0, b], [a, b], [x, 0]];
  if (shape.type === 'trapezoid') return [[0, b], [a, b], [x + c, 0], [x, 0]];
  if (shape.type === 'polygon') return (shape.points || []).filter((p) => p.length >= 2 && p.every(Number.isFinite));
  return null;
}

/** Розбір тексту «x, y» по рядках у масив точок. */
export function parsePolygon(text) {
  return String(text).split(/\n|;/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/[\s,]+/).map((v) => parseFloat(v.replace(',', '.'))))
    .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [p[0], p[1]]);
}

export function polygonArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; s += x1 * y2 - x2 * y1; }
  return Math.abs(s) / 2;
}

export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Чи поміщається коло радіуса r (з відступом) повністю всередині багатокутника. */
export function circleInPolygon(p, r, poly) {
  if (!pointInPolygon(p, poly)) return false;
  for (let i = 0; i < poly.length; i++) if (distToSegment(p, poly[i], poly[(i + 1) % poly.length]) < r - 1e-9) return false;
  return true;
}

/**
 * Вписування циліндричних комірок у багатокутник (переріз, перпендикулярний осі комірок).
 * Перебирає сітку і стільники, кути повороту решітки та її зсув — обирає максимум комірок.
 * @param {number[][]} poly контур, мм
 * @param {object} cell
 * @param {{gap?:number, margin?:number}} opt
 * @returns {{arrangement, angle, count, slots:{x,y,row,col}[]}[]} варіанти від найкращого
 */
export function fitPolygon(poly, cell, opt = {}) {
  if (cell.shape !== 'cyl' || !poly || poly.length < 3) return [];
  const gap = opt.gap ?? 0.5, margin = opt.margin ?? 2;
  const r = cell.d / 2;
  const p = cell.d + gap;
  const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.hypot(maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const out = [];
  for (const arrangement of ['grid', 'honeycomb']) {
    const angles = arrangement === 'grid' ? [0, 15, 30, 45, 60, 75] : [0, 10, 20, 30, 40, 50];
    let best = null;
    for (const deg of angles) {
      const t = (deg * Math.PI) / 180;
      const u = [p * Math.cos(t), p * Math.sin(t)];
      const v = arrangement === 'grid'
        ? [-p * Math.sin(t), p * Math.cos(t)]
        : [p * (0.5 * Math.cos(t) - SQRT3_2 * Math.sin(t)), p * (0.5 * Math.sin(t) + SQRT3_2 * Math.cos(t))];
      const n = Math.ceil(span / (p * (arrangement === 'grid' ? 1 : SQRT3_2))) + 2;
      const steps = 6;
      for (let oi = 0; oi < steps; oi++)
        for (let oj = 0; oj < steps; oj++) {
          const ox = cx + (oi / steps) * u[0] + (oj / steps) * v[0];
          const oy = cy + (oi / steps) * u[1] + (oj / steps) * v[1];
          const slots = [];
          for (let j = -n; j <= n; j++)
            for (let i = -n; i <= n; i++) {
              const x = ox + i * u[0] + j * v[0], y = oy + i * u[1] + j * v[1];
              if (x < minX || x > maxX || y < minY || y > maxY) continue;
              if (circleInPolygon([x, y], r + margin, poly)) slots.push({ x, y, row: j, col: i });
            }
          if (!best || slots.length > best.count) best = { arrangement, angle: deg, count: slots.length, slots };
        }
    }
    if (best && best.count) out.push(best);
  }
  return out.sort((a, b) => b.count - a.count);
}

/**
 * Підбір S×P для довільної форми.
 * @param {{outline:number[][], depth:number}} shape контур і глибина (уздовж осі комірок)
 */
export function bestConfigsShape(shape, cell, opt = {}, sRange = [1, 24]) {
  const poly = shape.outline;
  const margin = opt.margin ?? 2, reserve = opt.depthReserve ?? 4, layerGap = opt.layerGap ?? 2;
  const D = (shape.depth || 0) - 2 * margin;
  const len = cell.h + reserve;
  const variants = D >= len ? fitPolygon(poly, cell, opt) : [];
  const maxLayers = opt.allowLayers ? Math.max(1, Math.floor((D + layerGap) / (len + layerGap) + 1e-9)) : 1;
  const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
  const planeA = Math.max(...xs) - Math.min(...xs), planeB = Math.max(...ys) - Math.min(...ys);
  const configs = [];
  for (let S = sRange[0]; S <= sRange[1]; S++) {
    let best = null;
    for (const v of variants)
      for (let k = 1; k <= Math.min(maxLayers, S); k++) {
        const Sl = Math.ceil(S / k);
        const P = Math.floor(v.count / Sl);
        if (P >= 1 && (!best || P > best.P)) best = { S, P, layers: k, layerS: Sl, rows: null, layout: { ...v, perLayer: v.count, layers: maxLayers, total: v.count * maxLayers, orientation: 'вісь комірок — уздовж товщини', cols: v.count, rows: 1, planeA, planeB, aAxis: 'X', bAxis: 'Y', depth: shape.depth, shape: true } };
      }
    if (best) configs.push(best);
  }
  return { variants, configs, maxLayers };
}
