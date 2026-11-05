// Трасування дротів BMS, перевірка перетинів, нарізка стрічки та зазори між шинами.
// Усі координати — у площині схеми (мм): x праворуч, y вниз, пакет займає [0, width] × [0, height].

import { terminalPoint, edgeFrame, harnessGap } from './layout.js';

// Палітра балансувальних дротів (умовна). B0 — завжди чорний.
const WIRE_PALETTE = ['#e03131', '#f08c00', '#d4a017', '#2f9e44', '#1c7ed6', '#7048e8', '#c2255c', '#0c8599', '#8d5524', '#5c940d', '#ae3ec9', '#495057'];
export function wireColor(k) {
  return k === 0 ? '#1d232b' : WIRE_PALETTE[(k - 1) % WIRE_PALETTE.length];
}

/**
 * Траси балансувальних і силових дротів до BMS.
 * @param {object} layout результат generateLayout
 * @param {{gap:number, thick:number, minPitch?:number}} o
 *   gap — відстань від краю пакета до BMS, thick — товщина блоку BMS,
 *   minPitch — мінімальний крок пінів (щоб роз'єм не був меншим за кількість дротів)
 * @returns {{side, dir, bms:{x,y,w,h}, pins, routes}}
 */
export function harnessRoutes(layout, o = {}) {
  const S = layout.S;
  const side = layout.bmsSide;
  const fr = edgeFrame(layout.width, layout.height, side);
  const dir = layout.harness?.dir ?? 1;
  const gap = o.gap ?? 15;
  const thick = o.thick ?? 4;
  const n = S + 3; // P−, B0…BS, P+
  const lb = Math.max(fr.len * 0.8, n * (o.minPitch ?? 0));
  const a0 = fr.len / 2 - lb / 2;
  const slotA = (i) => (dir > 0 ? a0 + (i + 0.5) * (lb / n) : a0 + lb - (i + 0.5) * (lb / n));
  const p1 = fr.point(a0, gap), p2 = fr.point(a0 + lb, gap + thick);
  const bms = { x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]), w: Math.abs(p2[0] - p1[0]), h: Math.abs(p2[1] - p1[1]) };
  const exitOff = gap * 0.45;
  const delta = harnessGap(layout) * 0.3;
  const surfaceOf = (bus) => (layout.shape === 'prism' ? 'both' : bus.side);

  const pins = {};
  const routes = [];
  for (const b of layout.buses) {
    const t = terminalPoint(layout, layout.cells[b.tap], b.side);
    const pin = fr.point(slotA(b.index + 1), gap);
    pins[`B${b.index}`] = pin;
    routes.push({ name: `B${b.index}`, k: b.index, kind: 'balance', surface: surfaceOf(b), color: wireColor(b.index), points: [t, fr.point(fr.along(t), exitOff), pin] });
  }
  for (const [b, name, slot, sign, color] of [[layout.buses[0], 'P−', 0, -1, '#1d232b'], [layout.buses[S], 'P+', S + 2, 1, '#d93636']]) {
    const t = terminalPoint(layout, layout.cells[b.power], b.side);
    const pin = fr.point(slotA(slot), gap);
    pins[name] = pin;
    // силовий дріт відходить від тієї ж точки, що й B0/BS, трохи вбік свого піна — без перетину
    routes.push({ name, k: null, kind: 'power', surface: surfaceOf(b), color, points: [t, fr.point(fr.along(t) + sign * dir * delta, exitOff), pin] });
  }
  return { side, dir, bms, pins, routes, quality: layout.harness?.quality ?? 'clean' };
}

export const polylineLength = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

// ------------------------------------------------------------------ геометрія відрізків

const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;

/** Чи перетинаються відрізки (власне перетин або накладання), не рахуючи спільних кінців. */
export function segmentsCross(a1, a2, b1, b2) {
  const eps = 1e-7;
  const d1 = orient(b1, b2, a1), d2 = orient(b1, b2, a2), d3 = orient(a1, a2, b1), d4 = orient(a1, a2, b2);
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return true;
  // колінеарне накладання ненульової довжини
  if (Math.abs(d1) <= eps && Math.abs(d2) <= eps) {
    const ax = Math.abs(a2[0] - a1[0]) >= Math.abs(a2[1] - a1[1]) ? 0 : 1;
    const [lo1, hi1] = [Math.min(a1[ax], a2[ax]), Math.max(a1[ax], a2[ax])];
    const [lo2, hi2] = [Math.min(b1[ax], b2[ax]), Math.max(b1[ax], b2[ax])];
    return Math.min(hi1, hi2) - Math.max(lo1, lo2) > 0.5;
  }
  return false;
}

/** Відстань між відрізками. */
export function segmentDistance(a1, a2, b1, b2) {
  if (segmentsCross(a1, a2, b1, b2)) return 0;
  return Math.min(pointSegDist(a1, b1, b2), pointSegDist(a2, b1, b2), pointSegDist(b1, a1, a2), pointSegDist(b2, a1, a2));
}

export function pointSegDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Власний перетин відрізків (кінець одного на іншому перетином не вважається). */
function properCross(a1, a2, b1, b2) {
  const eps = 1e-7;
  const d1 = orient(b1, b2, a1), d2 = orient(b1, b2, a2), d3 = orient(a1, a2, b1), d4 = orient(a1, a2, b2);
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}
function collinearOverlap(a1, a2, b1, b2) {
  const eps = 1e-7;
  if (Math.abs(orient(b1, b2, a1)) > eps || Math.abs(orient(b1, b2, a2)) > eps) return 0;
  const ax = Math.abs(a2[0] - a1[0]) >= Math.abs(a2[1] - a1[1]) ? 0 : 1;
  return Math.min(Math.max(a1[ax], a2[ax]), Math.max(b1[ax], b2[ax])) - Math.max(Math.min(a1[ax], a2[ax]), Math.min(b1[ax], b2[ax]));
}

/**
 * Конфлікти трас на одній поверхні:
 *   crossings — дроти перетинаються (недопустимо для акуратного джгута);
 *   overlaps  — дроти йдуть спільною трасою (джгут) — допустимо для ізольованих дротів.
 */
export function routeConflicts(routes) {
  const crossings = [], overlaps = [];
  for (let i = 0; i < routes.length; i++)
    for (let j = i + 1; j < routes.length; j++) {
      const A = routes[i], B = routes[j];
      if (A.surface !== B.surface) continue;
      let cross = false, over = false;
      for (let s = 0; s < A.points.length - 1; s++)
        for (let t = 0; t < B.points.length - 1; t++) {
          const a1 = A.points[s], a2 = A.points[s + 1], b1 = B.points[t], b2 = B.points[t + 1];
          if (properCross(a1, a2, b1, b2)) cross = true;
          else if (collinearOverlap(a1, a2, b1, b2) > 0.5) over = true;
        }
      if (cross) crossings.push([A.name, B.name, A.surface]);
      else if (over) overlaps.push([A.name, B.name, A.surface]);
    }
  return { crossings, overlaps };
}

/** Лише перетини (для зворотної сумісності). */
export function routeCrossings(routes) {
  return routeConflicts(routes).crossings;
}

// ------------------------------------------------------------------ стрічка

/**
 * Злиття колінеарних перемичок однієї шини в суцільні відрізки (шматки стрічки).
 * @returns {{bus, side, a:[x,y], b:[x,y], len, links:number}[]}
 */
export function stripRuns(layout) {
  const runs = [];
  for (const bus of layout.buses) {
    const segs = bus.links.map((l) => {
      let p = terminalPoint(layout, layout.cells[l.a], bus.side), q = terminalPoint(layout, layout.cells[l.b], bus.side);
      if (p[0] > q[0] + 1e-6 || (Math.abs(p[0] - q[0]) <= 1e-6 && p[1] > q[1])) [p, q] = [q, p];
      const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
      return { p, q, ang };
    });
    const used = new Array(segs.length).fill(false);
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      let { p, q } = segs[i];
      const ang = segs[i].ang;
      let count = 1;
      let grew = true;
      while (grew) {
        grew = false;
        for (let j = 0; j < segs.length; j++) {
          if (used[j] || Math.abs(segs[j].ang - ang) > 1e-3) continue;
          if (same(segs[j].p, q)) { q = segs[j].q; used[j] = true; count++; grew = true; }
          else if (same(segs[j].q, p)) { p = segs[j].p; used[j] = true; count++; grew = true; }
        }
      }
      runs.push({ bus: bus.index, side: bus.side, a: p, b: q, len: Math.hypot(q[0] - p[0], q[1] - p[1]), links: count });
    }
  }
  return runs;
}

/**
 * Карта нарізки: шматки однакової довжини (з напуском на зварювання) згруповано.
 * @param {number} overlap запас на кожен кінець, мм
 */
export function cutList(runs, overlap) {
  const map = new Map();
  for (const r of runs) {
    const L = Math.round(r.len + 2 * overlap);
    map.set(L, (map.get(L) || 0) + 1);
  }
  const items = [...map.entries()].sort((a, b) => b[0] - a[0]).map(([len, count]) => ({ len, count }));
  return { items, pieces: runs.length, total: items.reduce((s, i) => s + i.len * i.count, 0) };
}

/**
 * Перевірка оголених шин: зазор між перемичками різних шин на одній поверхні
 * та проходження перемички над клемою комірки, що належить іншій шині.
 * @param {number} width ширина стрічки/шини, мм
 * @param {number} [clearance] мінімально допустимий зазор, мм
 */
export function stripClearance(layout, width, clearance = 1) {
  const cyl = layout.shape === 'cyl';
  const surf = (b) => (cyl ? b.side : 'both');
  const segs = [];
  for (const b of layout.buses)
    for (const l of b.links)
      segs.push({ bus: b.index, surface: surf(b), a: terminalPoint(layout, layout.cells[l.a], b.side), b: terminalPoint(layout, layout.cells[l.b], b.side) });
  let minGap = Infinity, worst = null;
  const violations = [];
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const A = segs[i], B = segs[j];
      if (A.surface !== B.surface || A.bus === B.bus) continue;
      const g = segmentDistance(A.a, A.b, B.a, B.b) - width;
      if (g < minGap) { minGap = g; worst = [A.bus, B.bus]; }
      if (g < clearance) violations.push({ kind: 'strips', buses: [A.bus, B.bus], gap: g });
    }
  // клеми інших шин під перемичкою
  const termR = cyl ? layout.footprint.w * 0.2 : Math.min(layout.footprint.w, layout.footprint.h) * 0.17;
  const terminals = [];
  for (const b of layout.buses)
    for (const id of b.members) terminals.push({ bus: b.index, surface: surf(b), p: terminalPoint(layout, layout.cells[id], b.side), id });
  for (const s of segs)
    for (const t of terminals) {
      if (t.surface !== s.surface || t.bus === s.bus) continue;
      if (pointSegDist(t.p, s.a, s.b) < width / 2 + termR) violations.push({ kind: 'terminal', buses: [s.bus, t.bus], cell: t.id });
    }
  return { minGap: minGap === Infinity ? null : minGap, worst, violations };
}
