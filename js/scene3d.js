// Опис 3D-сцени пакета без залежності від рендерера (тестується в Node).
// Одиниці — мм. Вісь Y — уздовж осі комірок (догори), X/Z — площина схеми.
// Центр пакета — у початку координат по X/Z, низ комірок — Y = 0.

import { terminalPoint, groupCentroids } from './layout.js';
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
  const cx = layout.width / 2, cz = layout.height / 2;
  const X = (x) => x - cx, Z = (y) => y - cz;
  const explode = Math.max(0, Math.min(1, Number(o.explode) || 0));
  const lift = explode * h * 0.45;
  const strip = o.strip || { material: 'nickel', width: 8, thickness: 0.15, layers: 1 };
  const analysis = o.stripColor === 'current' && o.analysis?.ok ? o.analysis : null;
  const S = layout.S;

  const items = [];
  // ---------- комірки
  for (const c of layout.cells) {
    items.push({ kind: 'cell', id: c.id, group: c.group, k: c.k, plusTop: c.plusTop, x: X(c.x), z: Z(c.y), row: c.row, col: c.col });
  }

  // ---------- перемички
  const sw = cyl ? Math.min(strip.width, cell.d * 0.8) : Math.min(fp.w, fp.h) * 0.35;
  const st = cyl ? Math.max(strip.thickness * Math.max(1, strip.layers || 1), 0.3) : 2;
  const termY = (side) => (cyl ? (side === 'top' ? h : 0) : h); // у призматичних обидві клеми зверху
  const stripY = (side) => (cyl
    ? (side === 'top' ? h + st / 2 + lift : -st / 2 - lift)
    : h + 3 + st / 2 + lift);
  if (o.strips !== false) {
    for (const b of layout.buses) {
      b.links.forEach((l, li) => {
        const A = layout.cells[l.a], B = layout.cells[l.b];
        const [ax, ay] = terminalPoint(layout, A, b.side);
        const [bx, by] = terminalPoint(layout, B, b.side);
        let color = l.series ? STRIP_COLORS.series : STRIP_COLORS.nickel;
        let current = null;
        if (analysis) { current = analysis.linkI[b.index][li]; color = loadColor(current / analysis.ampacity); }
        else if (!cyl) color = STRIP_COLORS.copper;
        const cable = !cyl && (layout.rotate ? Math.abs(A.y - B.y) < 1e-6 : Math.abs(A.x - B.x) < 1e-6);
        if (cable) {
          // гнучкий кабель дугою над іншою клемою
          const y = stripY(b.side);
          const off = Math.min(fp.w, fp.h) * 0.25;
          const ox = layout.rotate ? 0 : off, oz = layout.rotate ? off : 0;
          items.push({
            kind: 'wire', color, radius: 3, bus: b.index, current,
            points: [[X(ax), y, Z(ay)], [X(ax) + ox, y + 25, Z(ay) + oz], [X(bx) + ox, y + 25, Z(by) + oz], [X(bx), y, Z(by)]],
          });
        } else {
          items.push({
            kind: 'strip', side: b.side, bus: b.index, series: l.series, current, color,
            x1: X(ax), z1: Z(ay), x2: X(bx), z2: Z(by), y: stripY(b.side), width: sw, thick: st,
          });
        }
      });
    }
  }

  // ---------- BMS і дроти (ті самі траси, що й у 2D: без перетинів)
  if (o.wires !== false) {
    const gap = 12, thick = 2.5;
    const H = harnessRoutes(layout, { gap, thick, minPitch: 2.6 });
    const boardH = Math.max(25, Math.min(h * 0.75, 70));
    const boardY = h / 2;
    const r = H.bms;
    const nx = { right: 1, left: -1 }[H.side] || 0, nz = { bottom: 1, top: -1 }[H.side] || 0;
    items.push({ kind: 'bms', x: X(r.x + r.w / 2), y: boardY, z: Z(r.y + r.h / 2), sx: r.w, sy: boardH, sz: r.h, label: `BMS ${S}S`, nx, nz });
    for (const rt of H.routes) {
      const surfY = rt.surface === 'top' ? h + st + 1.2 + lift
        : rt.surface === 'bottom' ? -st - 1.2 - lift
          : h + 3 + st + 1.5 + lift;
      // піни: дроти зверху підходять до роз'єму згори, знизу — знизу (два віяла не перетинаються)
      const pinY = rt.surface === 'bottom' ? boardY - 3 : boardY + 3;
      const [t, e, pin] = rt.points;
      const T3 = [X(t[0]), surfY, Z(t[1])];
      const E3 = [X(e[0]), surfY, Z(e[1])];
      const D3 = [X(e[0]), pinY, Z(e[1])];
      const P3 = [X(pin[0]), pinY, Z(pin[1])];
      items.push({ kind: 'wire', color: rt.color, radius: rt.kind === 'power' ? 2.2 : 0.9, points: [T3, E3, D3, P3], label: rt.name, polyline: true });
    }
  }

  // ---------- підписи
  if (o.labels !== false) {
    const top = h + st + lift + 10;
    groupCentroids(layout).forEach((g, i) => {
      const c = layout.cells[g.cell];
      items.push({ kind: 'label', text: String(i + 1), group: i, x: X(c.x), y: top, z: Z(c.y) });
    });
    const pm = layout.cells[layout.buses[0].power], pp = layout.cells[layout.buses[S].power];
    const yFor = (b) => (cyl && b.side === 'bottom' ? -st - lift - 10 : top + 6);
    items.push({ kind: 'label', text: 'P−', color: '#1d232b', x: X(pm.x), y: yFor(layout.buses[0]), z: Z(pm.y) });
    items.push({ kind: 'label', text: 'P+', color: '#d93636', x: X(pp.x), y: yFor(layout.buses[S]), z: Z(pp.y) });
  }

  // ---------- мінімальний корпус
  if (o.enclosure) {
    const m = o.box?.margin ?? 2, dr = o.box?.depthReserve ?? 4;
    items.push({ kind: 'enclosure', x: 0, y: h / 2, z: 0, sx: layout.width + 2 * m, sy: h + dr + 2 * m, sz: layout.height + 2 * m });
  }

  // межі сцени для камери
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const grow = (x, y, z) => { min = [Math.min(min[0], x), Math.min(min[1], y), Math.min(min[2], z)]; max = [Math.max(max[0], x), Math.max(max[1], y), Math.max(max[2], z)]; };
  grow(-layout.width / 2, -lift - st, -layout.height / 2);
  grow(layout.width / 2, h + lift + st + 12, layout.height / 2);
  for (const it of items) {
    if (it.kind === 'bms' || it.kind === 'enclosure') { grow(it.x - it.sx / 2, it.y - it.sy / 2, it.z - it.sz / 2); grow(it.x + it.sx / 2, it.y + it.sy / 2, it.z + it.sz / 2); }
    if (it.kind === 'wire') for (const p of it.points) grow(...p);
  }

  return {
    shape: layout.shape, h, r: cyl ? cell.d / 2 : null, w: fp.w, d: fp.h, S,
    terminals: cyl ? null : layout.cells.map((c) => ({ id: c.id, top: terminalPoint(layout, c, 'top').map((v, i) => (i ? Z(v) : X(v))), bottom: terminalPoint(layout, c, 'bottom').map((v, i) => (i ? Z(v) : X(v))) })),
    items, bounds: { min, max },
  };
}
