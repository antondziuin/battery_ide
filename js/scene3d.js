// Опис 3D-сцени пакета без залежності від рендерера (тестується в Node).
// Одиниці — мм. Вісь Y — уздовж осі комірок (догори), X/Z — площина схеми.
// Центр пакета — у початку координат по X/Z, низ комірок — Y = 0.

import { terminalPoint, groupCentroids, prismLinkBlocked } from './layout.js';
import { loadColor } from './analysis.js';
import { harnessRoutes } from './routing.js';

export const STRIP_COLORS = { nickel: '#b9c0c8', series: '#d4862a', copper: '#c87533', faint: '#c4cad1' };

/**
 * @param {object} layout результат generateLayout
 * @param {object} cell комірка
 * @param {object} o
 * @param {{material:string,width:number,thickness:number,layers:number}} [o.strip]
 * @param {object} [o.analysis] результат analyzeCurrents (для кольорів за струмом)
 * @param {'type'|'current'} [o.stripColor]
 * @param {number} [o.explode] 0…1 — розліт верхніх і нижніх перемичок
 * @param {boolean} [o.strips] [o.wires] [o.labels] [o.enclosure]
 * @param {{margin:number, depthReserve:number}} [o.box]
 */
export function buildScene3D(layout, cell, o = {}) {
  const cyl = layout.shape === 'cyl';
  const fp = layout.footprint;
  const h = cell.h;
  const layers = layout.layers || 1;
  const step2d = layout.layerStep || 0; // зсув ярусу в площині схеми
  const planeH = layers > 1 ? layout.layerHeight : layout.height;
  const cx = layout.width / 2, cz = planeH / 2;
  const explode = Math.max(0, Math.min(1, Number(o.explode) || 0));
  const lift = explode * h * 0.45;
  const strip = o.strip || { material: 'nickel', width: 8, thickness: 0.15, layers: 1 };
  const analysis = o.stripColor === 'current' && o.analysis?.ok ? o.analysis : null;
  const S = layout.S;
  const sw = cyl ? Math.min(strip.width, cell.d * 0.8) : Math.min(fp.w, fp.h) * 0.35;
  const st = cyl ? Math.max(strip.thickness * Math.max(1, strip.layers || 1), 0.3) : 2;
  // яруси стоять один на одному: між ними ізоляційна прокладка; розліт розсуває і яруси
  const layerGap = (layout.layerGapPhys ?? 4) + 2 * st + 2 * lift;
  const base = (l) => l * (h + layerGap);
  const totalH = base(layers - 1) + h;
  const X = (x) => x - cx;
  const Zl = (y, l) => y - l * step2d - cz; // з площини схеми в координату ярусу
  const tp = (c, side) => { const [x, y] = terminalPoint(layout, c, side); return [X(x), Zl(y, c.layer || 0)]; };
  const surfaceY = (l, side, extra = 0) => (cyl
    ? (side === 'top' ? base(l) + h + st / 2 + lift + extra : base(l) - st / 2 - lift - extra)
    : base(l) + h + 3 + st / 2 + lift + extra);
  const out = (side) => (cyl && side === 'bottom' ? -1 : 1);

  const items = [];
  // ---------- комірки
  for (const c of layout.cells) {
    items.push({ kind: 'cell', id: c.id, group: c.group, k: c.k, plusTop: c.plusTop, layer: c.layer || 0, x: X(c.x), z: Zl(c.y, c.layer || 0), y0: base(c.layer || 0), row: c.row, col: c.col });
  }

  // ---------- перемички, дроти-перемички, мідна збірна шина
  if (o.strips !== false) {
    for (const b of layout.buses) {
      for (const e of b.collector || []) {
        const A = layout.cells[e.a], B = layout.cells[e.b];
        const [ax, az] = tp(A, b.side), [bx, bz] = tp(B, b.side);
        items.push({ kind: 'strip', side: b.side, bus: b.index, collector: true, color: STRIP_COLORS.copper, x1: ax, z1: az, x2: bx, z2: bz, y: surfaceY(A.layer || 0, b.side, st + 0.6), width: sw * 1.1, thick: 0.8 });
      }
      b.links.forEach((l, li) => {
        const A = layout.cells[l.a], B = layout.cells[l.b];
        const la = A.layer || 0, lb = B.layer || 0;
        const [ax, az] = tp(A, b.side), [bx, bz] = tp(B, b.side);
        let color = l.jumper ? '#6741d9' : l.series ? STRIP_COLORS.series : STRIP_COLORS.nickel;
        let current = null;
        if (analysis) { current = analysis.linkI[b.index][li]; color = loadColor(analysis.linkRatio ? analysis.linkRatio[b.index][li] : current / analysis.ampacity); }
        else if (!cyl && !l.jumper) color = STRIP_COLORS.copper;
        const prismCable = !cyl && !l.jumper && prismLinkBlocked(layout, A, B, b.side);
        if (l.jumper || prismCable) {
          const ya = surfaceY(la, b.side), yb = surfaceY(lb, b.side);
          const d = out(b.side) * (prismCable ? 25 : 8);
          let points;
          if (la === lb) {
            const off = prismCable ? Math.min(fp.w, fp.h) * 0.25 : 0;
            const ox = prismCable && !layout.rotate ? off : 0, oz = prismCable && layout.rotate ? off : 0;
            points = [[ax, ya, az], [ax + ox, ya + d, az + oz], [bx + ox, yb + d, bz + oz], [bx, yb, bz]];
          } else {
            // міжярусний перехід — по зовнішній стінці пакета
            const ex = (ax + bx) / 2 >= 0 ? layout.width / 2 + 6 : -layout.width / 2 - 6;
            points = [[ax, ya, az], [ax, ya + d, az], [ex, ya + d, az], [ex, yb + d, bz], [bx, yb + d, bz], [bx, yb, bz]];
          }
          items.push({ kind: 'wire', color, radius: l.jumper ? 2 : 3, bus: b.index, current, jumper: !!l.jumper, points, polyline: !prismCable });
        } else {
          items.push({
            kind: 'strip', side: b.side, bus: b.index, series: l.series, current, color,
            x1: ax, z1: az, x2: bx, z2: bz, y: surfaceY(la, b.side), width: sw, thick: st,
          });
        }
      });
    }
  }

  // ---------- BMS і дроти (ті самі траси, що й у 2D: без перетинів)
  if (o.wires !== false) {
    const gap = 12, thick = 2.5;
    const H = harnessRoutes(layout, { gap, thick, minPitch: 2.6 });
    const boardH = Math.max(25, Math.min(totalH * 0.75, 70 * layers));
    const boardY = totalH / 2;
    const r = H.bms;
    const nx = { right: 1, left: -1 }[H.side] || 0, nz = { bottom: 1, top: -1 }[H.side] || 0;
    // у багатоярусному пакеті BMS-плата в площині одного ярусу (по центру)
    const rz = layers > 1 && !(H.side === 'left' || H.side === 'right') ? (H.side === 'top' ? -planeH / 2 - gap - thick / 2 : planeH / 2 + gap + thick / 2) : Zl(r.y + r.h / 2, 0);
    const rsz = layers > 1 && (H.side === 'left' || H.side === 'right') ? Math.min(r.h, planeH * 0.9) : r.h;
    const rzC = layers > 1 && (H.side === 'left' || H.side === 'right') ? 0 : rz;
    items.push({ kind: 'bms', x: X(r.x + r.w / 2), y: boardY, z: rzC, sx: r.w, sy: boardH, sz: rsz, label: `BMS ${S}S`, nx, nz });
    const busByName = Object.fromEntries(layout.buses.map((b) => [`B${b.index}`, b]));
    for (const rt of H.routes) {
      const bus = rt.name === 'P−' ? layout.buses[0] : rt.name === 'P+' ? layout.buses[S] : busByName[rt.name];
      const tapCell = layout.cells[rt.kind === 'power' ? bus.power : bus.tap];
      const l = tapCell.layer || 0;
      const surfY = surfaceY(l, bus.side, 1.2 + st / 2);
      const pinY = rt.surface === 'bottom' ? boardY - 3 : boardY + 3;
      const pin = rt.points[rt.points.length - 1];
      const e = rt.points[rt.points.length - 2];
      const onSurface = rt.points.slice(0, -1).map((q) => [X(q[0]), surfY, Zl(q[1], l)]);
      const E3 = onSurface[onSurface.length - 1];
      // для бічних сторін координата вздовж краю — у межах ярусу; для верх/низ — лишаємо площину ярусу 0
      const pinZ = layers > 1 && (H.side === 'left' || H.side === 'right') ? Math.max(-rsz / 2, Math.min(rsz / 2, Zl(pin[1], 0) * (rsz / Math.max(r.h, 1)))) : Zl(pin[1], 0);
      const eZ = layers > 1 && !(H.side === 'left' || H.side === 'right') ? rz - (nz * (gap * 0.55)) : Zl(e[1], l);
      const E3b = [X(e[0]), surfY, eZ];
      const D3 = [X(e[0]), pinY, eZ];
      const P3 = [X(pin[0]), pinY, pinZ];
      const pts = [...onSurface, E3b, D3, P3].filter((q, i, arr) => i === 0 || q.some((v, k) => Math.abs(v - arr[i - 1][k]) > 1e-9));
      items.push({ kind: 'wire', color: rt.color, radius: rt.kind === 'power' ? 2.2 : 0.9, points: pts, label: rt.name, polyline: true });
    }
  }

  // ---------- підписи
  if (o.labels !== false) {
    groupCentroids(layout).forEach((g, i) => {
      const c = layout.cells[g.cell];
      const l = c.layer || 0;
      items.push({ kind: 'label', text: String(i + 1), group: i, x: X(c.x), y: base(l) + h + st + lift + 10, z: Zl(c.y, l) });
    });
    const pm = layout.cells[layout.buses[0].power], pp = layout.cells[layout.buses[S].power];
    const yFor = (c, b) => (cyl && b.side === 'bottom' ? base(c.layer || 0) - st - lift - 10 : base(c.layer || 0) + h + st + lift + 16);
    items.push({ kind: 'label', text: 'P−', color: '#1d232b', x: X(pm.x), y: yFor(pm, layout.buses[0]), z: Zl(pm.y, pm.layer || 0) });
    items.push({ kind: 'label', text: 'P+', color: '#d93636', x: X(pp.x), y: yFor(pp, layout.buses[S]), z: Zl(pp.y, pp.layer || 0) });
  }

  // ---------- мінімальний корпус
  if (o.enclosure) {
    const m = o.box?.margin ?? 2, dr = o.box?.depthReserve ?? 4;
    items.push({ kind: 'enclosure', x: 0, y: totalH / 2, z: 0, sx: layout.width + 2 * m, sy: totalH + dr + 2 * m, sz: planeH + 2 * m, outline: layout.outline ? layout.outline.map(([x, y]) => [X(x), y - cz]) : null });
  }

  // межі сцени для камери
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const grow = (x, y, z) => { min = [Math.min(min[0], x), Math.min(min[1], y), Math.min(min[2], z)]; max = [Math.max(max[0], x), Math.max(max[1], y), Math.max(max[2], z)]; };
  grow(-layout.width / 2, -lift - st, -planeH / 2);
  grow(layout.width / 2, totalH + lift + st + 12, planeH / 2);
  for (const it of items) {
    if (it.kind === 'bms' || it.kind === 'enclosure') { grow(it.x - it.sx / 2, it.y - it.sy / 2, it.z - it.sz / 2); grow(it.x + it.sx / 2, it.y + it.sy / 2, it.z + it.sz / 2); }
    if (it.kind === 'wire') for (const p of it.points) grow(...p);
  }

  return {
    shape: layout.shape, h, r: cyl ? cell.d / 2 : null, w: fp.w, d: fp.h, S, layers,
    terminals: cyl ? null : layout.cells.map((c) => ({ id: c.id, top: tp(c, 'top'), bottom: tp(c, 'bottom') })),
    items, bounds: { min, max },
  };
}
