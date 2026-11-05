// Генерація геометрії пакета: розташування комірок, розбиття на паралельні групи,
// шини (нікелеві перемички) на верхній і нижній стороні.
//
// Модель полярності: група 0 стоїть «+» догори. Кожна наступна група перевернута.
// Шина j (0..S) з'єднує групи j-1 та j:
//   j = 0  — мінус пакета (P−), низ групи 0
//   j = S  — плюс пакета (P+)
//   j непарне — шина на верхній стороні, j парне — на нижній.
// Для призматичних комірок «верх» = перша клема, «низ» = друга клема (обидві зверху корпусу).

export const SQRT3_2 = Math.sqrt(3) / 2;

export function cellFootprint(cell, rotate = false) {
  if (cell.shape === 'cyl') return { w: cell.d, h: cell.d };
  return rotate ? { w: cell.w, h: cell.t } : { w: cell.t, h: cell.w };
}

/**
 * Автоматична кількість рядів: для циліндричних — класичне «група = стовпець»,
 * для призматичних — один ряд (клеми сусідніх комірок поруч).
 * Для U-подібної змійки рядів удвічі більше: група йде «туди» верхнім блоком і «назад» нижнім.
 */
export function autoRows(S, P, shape = 'cyl', snake = 'cols') {
  if (snake === 'u' && S >= 2) return shape === 'prism' ? 2 : 2 * P;
  if (P <= 1 || shape === 'prism') return 1;
  return P;
}

export const BMS_SIDES = ['right', 'left', 'top', 'bottom'];

/**
 * Точка клеми комірки на заданій стороні (у координатах схеми, мм).
 * Для циліндрів — центр торця; для призматичних — відповідна клема на верхній кришці.
 */
export function terminalPoint(layout, c, side) {
  if (layout.shape !== 'prism') return [c.x, c.y];
  const fp = layout.footprint;
  if (layout.rotate) return side === 'top' ? [c.x - fp.w * 0.3, c.y] : [c.x + fp.w * 0.3, c.y];
  return side === 'top' ? [c.x, c.y - fp.h * 0.3] : [c.x, c.y + fp.h * 0.3];
}

/** Центр (середнє положення) комірок кожної групи та «центральна» комірка групи. */
export function groupCentroids(layout) {
  const acc = Array.from({ length: layout.S }, () => ({ x: 0, y: 0, n: 0 }));
  for (const c of layout.cells) { const a = acc[c.group]; a.x += c.x; a.y += c.y; a.n++; }
  return acc.map((a, g) => {
    const x = a.x / a.n, y = a.y / a.n;
    let best = null;
    for (const c of layout.cells) if (c.group === g && (!best || Math.hypot(c.x - x, c.y - y) < Math.hypot(best.x - x, best.y - y))) best = c;
    return { x, y, cell: best.id };
  });
}

/**
 * @param {object} o
 * @param {number} o.S  кількість послідовних груп
 * @param {number} o.P  кількість паралельних комірок у групі
 * @param {number} o.rows кількість рядів
 * @param {'grid'|'honeycomb'} o.arrangement
 * @param {'cols'|'rows'|'u'} o.snake напрямок «змійки» (u — P+ і P− з одного боку)
 * @param {'right'|'left'|'top'|'bottom'} [o.bmsSide] з якого боку пакета стоїть BMS
 * @param {'near'|'center'} [o.leadAttach] куди приварювати силові дроти P+/P−
 * @param {number} o.gap зазор між комірками, мм
 * @param {object} o.cell комірка
 * @param {boolean} [o.rotate] поворот призматичної комірки
 */
export function generateLayout(o) {
  const S = Math.max(1, Math.floor(o.S));
  const P = Math.max(1, Math.floor(o.P));
  const N = S * P;
  const cell = o.cell;
  const gap = Math.max(0, Number(o.gap) || 0);
  const fp = cellFootprint(cell, o.rotate);
  const honey = (o.arrangement === 'honeycomb' || o.arrangement === 'honeycomb2') && cell.shape === 'cyl';
  // щільні стільники: зміщені ряди мають на одну комірку менше, змійка лише по рядах
  let dense = honey && o.arrangement === 'honeycomb2';
  let snake = dense ? 'rows' : ['rows', 'u'].includes(o.snake) ? o.snake : 'cols';
  const px = fp.w + gap;
  const py = honey ? (fp.w + gap) * SQRT3_2 : fp.h + gap;

  let R = Math.max(1, Math.min(Math.floor(o.rows) || autoRows(S, P, cell.shape, snake), N));
  if (snake === 'u' && R < 2) snake = 'cols';
  let C;
  if (dense) {
    C = denseCols(N, R);
    if (C < 2) dense = false;
    else R = denseRows(N, C);
  }
  if (!dense) {
    C = Math.ceil(N / R);
    if (snake === 'rows') R = Math.ceil(N / C); // прибираємо порожні ряди
  }

  const rowLen = (r) => (dense && r % 2 ? C - 1 : C);
  const order = [];
  if (snake === 'u') {
    // верхній блок рядів [0, R1) — змійкою зліва направо, нижній [R1, R) — справа наліво.
    // Напрямок першого стовпця обрано так, щоб верхній блок закінчувався біля нижнього.
    const R1 = Math.ceil(R / 2), R2 = R - R1;
    C = Math.ceil(N / R);
    const startDown = C % 2 === 1;
    for (let c = 0; c < C; c++) {
      const down = (c % 2 === 0) === startDown;
      for (let i = 0; i < R1; i++) order.push([down ? i : R1 - 1 - i, c]);
    }
    for (let t = 0; t < C; t++) {
      const c = C - 1 - t;
      for (let i = 0; i < R2; i++) order.push([R1 + (t % 2 === 0 ? i : R2 - 1 - i), c]);
    }
  } else if (snake === 'cols') {
    for (let c = 0; c < C; c++)
      for (let i = 0; i < R; i++) order.push([c % 2 ? R - 1 - i : i, c]);
  } else {
    for (let r = 0; r < R; r++) {
      const n = rowLen(r);
      for (let i = 0; i < n; i++) order.push([r, r % 2 ? n - 1 - i : i]);
    }
  }

  const cells = [];
  for (let i = 0; i < N; i++) {
    const [r, c] = order[i];
    const group = Math.floor(i / P);
    cells.push({
      id: i,
      row: r,
      col: c,
      x: c * px + fp.w / 2 + (honey && r % 2 ? px / 2 : 0),
      y: r * py + fp.h / 2,
      group,
      k: i % P,
      plusTop: group % 2 === 0,
    });
  }

  const usedRows = Math.max(...cells.map((c) => c.row)) + 1;
  const usedCols = Math.max(...cells.map((c) => c.col)) + 1;
  const width = Math.max(...cells.map((c) => c.x)) + fp.w / 2;
  const height = Math.max(...cells.map((c) => c.y)) + fp.h / 2;

  const thr = px * 1.02 + 1e-6;
  const adjacent = honey
    ? (A, B) => Math.hypot(A.x - B.x, A.y - B.y) <= thr
    : (A, B) => Math.abs(A.row - B.row) + Math.abs(A.col - B.col) === 1;
  const byGroup = Array.from({ length: S }, () => []);
  for (const c of cells) byGroup[c.group].push(c);

  const buses = [];
  for (let j = 0; j <= S; j++) {
    const members = [...(j >= 1 ? byGroup[j - 1] : []), ...(j < S ? byGroup[j] : [])];
    const side = j % 2 === 1 ? 'top' : 'bottom';
    const links = [];
    for (let a = 0; a < members.length; a++)
      for (let b = a + 1; b < members.length; b++) {
        const A = members[a], B = members[b];
        const d = Math.hypot(A.x - B.x, A.y - B.y);
        if (adjacent(A, B)) links.push({ a: A.id, b: B.id, len: d, series: A.group !== B.group });
      }
    buses.push({
      index: j,
      side,
      members: members.map((m) => m.id),
      links,
      seriesLinks: links.filter((l) => l.series).length,
      connected: isConnected(members.map((m) => m.id), links),
    });
  }

  // Точки підключення: балансувальні дроти — до комірки шини, найближчої до BMS;
  // силові P−/P+ — біля BMS або в центрі крайньої групи.
  const bmsSide = BMS_SIDES.includes(o.bmsSide) ? o.bmsSide : 'right';
  const leadAttach = o.leadAttach === 'center' ? 'center' : 'near';
  const edgeDist = (c) => ({ right: width - c.x, left: c.x, top: c.y, bottom: height - c.y }[bmsSide]);
  const alongEdge = (c) => (bmsSide === 'left' || bmsSide === 'right' ? Math.abs(c.y - height / 2) : Math.abs(c.x - width / 2));
  const nearest = (list) => list.reduce((m, c) => {
    const d = edgeDist(c) - edgeDist(m);
    return d < -1e-6 || (Math.abs(d) <= 1e-6 && alongEdge(c) < alongEdge(m)) ? c : m;
  });
  const central = (list) => {
    const cx = list.reduce((s, c) => s + c.x, 0) / list.length, cy = list.reduce((s, c) => s + c.y, 0) / list.length;
    return list.reduce((m, c) => (Math.hypot(c.x - cx, c.y - cy) < Math.hypot(m.x - cx, m.y - cy) - 1e-6 ? c : m));
  };
  for (const b of buses) {
    const mem = b.members.map((id) => cells[id]);
    if (b.index === 0 || b.index === S) {
      const grp = byGroup[b.index === 0 ? 0 : S - 1];
      b.power = (leadAttach === 'center' ? central(grp) : nearest(grp)).id;
      b.tap = b.power;
    } else {
      b.power = null;
      b.tap = nearest(mem).id;
    }
    b.tapDist = edgeDist(cells[b.tap]);
  }

  const warnings = [];
  for (const b of buses) {
    if (b.index > 0 && b.index < S && b.seriesLinks === 0)
      warnings.push(`Групи ${b.index} та ${b.index + 1} не мають сусідніх комірок — потрібна додаткова шина/дріт між ними.`);
    else if (!b.connected)
      warnings.push(`Шина B${b.index} не суцільна — частина комірок не торкається сусідів, потрібна додаткова перемичка.`);
  }
  const minSeries = S > 1 ? Math.min(...buses.slice(1, S).map((b) => b.seriesLinks)) : 0;
  const weakestBus = S > 1 ? buses.slice(1, S).reduce((m, b) => (b.seriesLinks < m.seriesLinks ? b : m)).index : null;

  return {
    S, P, N, rows: usedRows, cols: usedCols, cells, buses, width, height,
    pitchX: px, pitchY: py, footprint: fp, shape: cell.shape, honey, dense, snake, rotate: !!o.rotate,
    bmsSide, leadAttach,
    warnings, minSeries, weakestBus,
    stripLength: buses.reduce((s, b) => s + b.links.reduce((t, l) => t + l.len, 0), 0),
    linkCount: buses.reduce((s, b) => s + b.links.length, 0),
  };
}

/** Скільки комірок вміщують R рядів щільних стільників по C (парні ряди) та C−1 (непарні). */
export function denseCapacity(R, C) {
  return Math.ceil(R / 2) * C + Math.floor(R / 2) * (C - 1);
}
/** Мінімальна кількість стовпців для N комірок у R рядах щільних стільників. */
export function denseCols(N, R) {
  if (R <= 1) return N;
  let C = Math.max(2, Math.ceil((N + Math.floor(R / 2)) / R));
  while (denseCapacity(R, C) < N) C++;
  return C;
}
/** Мінімальна кількість рядів для N комірок при C стовпцях. */
export function denseRows(N, C) {
  let R = 1;
  while (denseCapacity(R, C) < N) R++;
  return R;
}

function isConnected(ids, links) {
  if (ids.length <= 1) return true;
  const parent = new Map(ids.map((i) => [i, i]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const l of links) parent.set(find(l.a), find(l.b));
  const root = find(ids[0]);
  return ids.every((i) => find(i) === root);
}

/** Електричні та механічні характеристики пакета. */
export function packStats(cell, S, P, opts = {}) {
  const N = S * P;
  const vNom = cell.vNom * S, vMax = cell.vMax * S, vMin = cell.vMin * S;
  const ah = cell.capacity * P;
  const wh = ah * vNom;
  const iMax = cell.iMax * P;
  const irPack = cell.ir ? (cell.ir * S) / P : null; // мОм
  const cellsMass = (cell.mass || 0) * N;
  const massEst = cellsMass * (cell.shape === 'cyl' ? 1.15 : 1.08);
  const load = Number(opts.loadCurrent) || 0;
  const sag = irPack && load ? (irPack / 1000) * load : null;
  return {
    N, vNom, vMax, vMin, ah, wh, iMax, pMax: iMax * vNom, irPack,
    cellsMass, massEst, whPerKg: cellsMass ? wh / (massEst / 1000) : null,
    loadCurrent: load, cRate: load ? load / ah : null, perCell: load ? load / P : null,
    sag, vUnderLoad: sag != null ? vNom - sag : null,
    heat: irPack && load ? (irPack / 1000) * load * load : null,
    chargerVoltage: vMax,
    bmsCurrent: load ? Math.ceil(load * 1.25) : Math.ceil(iMax * 0.5),
    balanceWires: S + 1,
  };
}
