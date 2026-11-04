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
  return {
    a: layout.width + 2 * margin,
    b: layout.height + 2 * margin,
    depth: cell.h + depthReserve + 2 * margin,
  };
}
