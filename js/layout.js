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
export const BMS_SIDE_NAMES = { right: 'праворуч', left: 'ліворуч', top: 'зверху', bottom: 'знизу' };

/**
 * Точка клеми комірки на заданій стороні (у координатах схеми, мм).
 * Для циліндрів — центр торця; для призматичних — відповідна клема на верхній кришці.
 */
export function terminalPoint(layout, c, side) {
  if (layout.shape !== 'prism') return [c.x, c.y];
  // розвернута на 180° комірка (непарні ряди): клеми міняються місцями
  if (c.flip) side = side === 'top' ? 'bottom' : 'top';
  const fp = layout.footprint;
  if (layout.rotate) return side === 'top' ? [c.x - fp.w * 0.3, c.y] : [c.x + fp.w * 0.3, c.y];
  return side === 'top' ? [c.x, c.y - fp.h * 0.3] : [c.x, c.y + fp.h * 0.3];
}

/**
 * Чи пройшла б пряма шина між клемами сусідніх призматичних комірок над іншою клемою
 * (тоді потрібен гнучкий кабель дугою).
 */
export function prismLinkBlocked(layout, A, B, side) {
  if (layout.shape !== 'prism') return false;
  const other = side === 'top' ? 'bottom' : 'top';
  const a = terminalPoint(layout, A, side), b = terminalPoint(layout, B, side);
  const tr = Math.min(layout.footprint.w, layout.footprint.h) * 0.17;
  for (const c of [A, B]) {
    const [px, py] = terminalPoint(layout, c, other);
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2)) : 0;
    if (Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy)) < tr * 1.5) return true;
  }
  return false;
}

/** Зрозумілий опис місця комірки: ряд/стовпець (і ярус) або координати для довільної форми. */
export function cellPlace(layout, c) {
  const layer = layout.layers > 1 ? `ярус ${(c.layer || 0) + 1}, ` : '';
  if (layout.custom) {
    const y = c.y - (c.layer || 0) * (layout.layerStep || 0);
    return `${layer}x ≈ ${Math.round(c.x)} мм, y ≈ ${Math.round(y)} мм від лівого верхнього кута`;
  }
  return `${layer}ряд ${c.row - (c.layer || 0) * 100000 + 1}, стовпець ${c.col + 1}`;
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
 * @param {'grid'|'honeycomb'|'honeycomb2'} o.arrangement
 * @param {'cols'|'rows'|'u'} o.snake напрямок «змійки» (u — P+ і P− з одного боку)
 * @param {'right'|'left'|'top'|'bottom'|'auto'} [o.bmsSide] з якого боку пакета стоїть BMS
 * @param {'near'|'center'|'collector'} [o.leadAttach] силові виводи: біля BMS, у центрі групи
 *        або мідна збірна шина вздовж усієї крайньої групи
 * @param {number} o.gap зазор між комірками, мм
 * @param {object} o.cell комірка
 * @param {boolean} [o.rotate] поворот призматичної комірки
 * @param {number} [o.layers] кількість ярусів уздовж осі комірок (групи діляться між ярусами)
 * @param {{x:number,y:number,row:number,col:number}[]} [o.slots] довільні позиції комірок
 *        (наприклад, з вписування в трикутник); row/col — індекси решітки для «змійки»
 * @param {number[][]} [o.outline] контур форми (для малювання і країв BMS)
 */
export function generateLayout(o) {
  const S = Math.max(1, Math.floor(o.S));
  const P = Math.max(1, Math.floor(o.P));
  const N = S * P;
  const cell = o.cell;
  const gap = Math.max(0, Number(o.gap) || 0);
  const fp = cellFootprint(cell, o.rotate);
  const layers = Math.max(1, Math.min(8, Math.floor(o.layers) || 1, S));
  const Sl = Math.ceil(S / layers); // груп на ярус
  const Nl = Sl * P;
  const warnings = [];

  let slots = Array.isArray(o.slots) && o.slots.length && cell.shape === 'cyl' ? o.slots : null;
  if (o.slots?.length && cell.shape !== 'cyl') warnings.push('Довільна форма підтримується лише для циліндричних комірок — показано звичайну розкладку.');
  if (slots && slots.length < Nl) {
    warnings.push(`У задану форму вміщується ${slots.length} комірок, а потрібно ${Nl}${layers > 1 ? ' на ярус' : ''} — показано звичайну розкладку.`);
    slots = null;
  }
  const base = slots ? slotBase(slots, o.outline, Nl, fp, gap, P) : gridBase(o, Nl, Sl, P, fp, gap, cell);
  const { px, py } = base;

  // ---------- комірки по ярусах (непарні яруси йдуть у зворотному порядку: початок над кінцем попереднього)
  const sep = layers > 1 ? Math.max(2.5 * Math.max(px, py), 20) : 0;
  const layerStep = base.height + sep;
  const cells = [];
  for (let g = 0; g < S; g++) {
    const l = Math.floor(g / Sl);
    for (let k = 0; k < P; k++) {
      const i = (g - l * Sl) * P + k;
      const pos = l % 2 ? base.order[Nl - 1 - i] : base.order[i];
      const id = cells.length;
      cells.push({
        id, row: pos.row + l * 100000, col: pos.col, x: pos.x, y: pos.y + l * layerStep,
        group: g, k, layer: l, plusTop: g % 2 === 0,
        // призматичні в кількох рядах: кожен непарний ряд розвернуто, щоб шини між рядами
        // з'єднували клеми, звернені одна до одної
        flip: cell.shape === 'prism' && base.rows > 1 && pos.row % 2 === 1,
      });
    }
  }
  const usedRows = base.rows, usedCols = base.cols;
  const width = base.width;
  const height = layers * base.height + (layers - 1) * sep;

  const thr = px * 1.02 + 1e-6;
  const adjacent = base.byDistance
    ? (A, B) => Math.hypot(A.x - B.x, A.y - B.y) <= thr
    : (A, B) => Math.abs(A.row - B.row) + Math.abs(A.col - B.col) === 1;
  const byGroup = Array.from({ length: S }, () => []);
  for (const c of cells) byGroup[c.group].push(c);

  // відстань для дроту-перемички: у площині ярусу + перехід між ярусами
  const layerGapPhys = 4;
  const jumperLen = (A, B) => {
    const ya = A.y - A.layer * layerStep, yb = B.y - B.layer * layerStep;
    return Math.hypot(A.x - B.x, ya - yb) + Math.abs(A.layer - B.layer) * (cell.h + layerGapPhys);
  };

  const buses = [];
  const jumperNotes = [];
  for (let j = 0; j <= S; j++) {
    const members = [...(j >= 1 ? byGroup[j - 1] : []), ...(j < S ? byGroup[j] : [])];
    const side = j % 2 === 1 ? 'top' : 'bottom';
    const links = [];
    for (let a = 0; a < members.length; a++)
      for (let b = a + 1; b < members.length; b++) {
        const A = members[a], B = members[b];
        if (adjacent(A, B)) links.push({ a: A.id, b: B.id, len: Math.hypot(A.x - B.x, A.y - B.y), series: A.group !== B.group });
      }
    const hadSeries = links.some((l) => l.series);
    // частини шини, що не торкаються, з'єднуємо дротами-перемичками (найкоротшими)
    const jumpers = connectComponents(members, links, jumperLen);
    // стик сусідніх груп в одну комірку — весь струм через одну перемичку: підсилюємо
    // другою перемичкою якомога далі від наявного контакту
    const seriesNow = links.filter((l) => l.series).length + jumpers.filter((l) => l.series).length;
    if (j > 0 && j < S && P >= 3 && seriesNow === 1) {
      const ex = [...links, ...jumpers].find((l) => l.series);
      const ca = cells[ex.a], cb = cells[ex.b];
      let best = null;
      for (const A of byGroup[j - 1])
        for (const B of byGroup[j]) {
          if ((A.id === ex.a && B.id === ex.b) || (A.id === ex.b && B.id === ex.a)) continue;
          const len = jumperLen(A, B);
          const far = (Math.min(Math.hypot(A.x - ca.x, A.y - ca.y), Math.hypot(A.x - cb.x, A.y - cb.y))
            + Math.min(Math.hypot(B.x - ca.x, B.y - ca.y), Math.hypot(B.x - cb.x, B.y - cb.y))) / 2;
          const score = len - 0.6 * far;
          if (!best || score < best.score) best = { score, A, B, len };
        }
      if (best) jumpers.push({ a: best.A.id, b: best.B.id, len: best.len, series: true, jumper: true, reinforce: true, crossLayer: best.A.layer !== best.B.layer });
    }
    for (const jl of jumpers) {
      links.push(jl);
      const A = cells[jl.a], B = cells[jl.b];
      const where = A.layer !== B.layer ? ' між ярусами' : '';
      if (jl.reinforce) jumperNotes.push(`Групи ${j} та ${j + 1} торкаються лише однією коміркою — додано другу перемичку-дріт${where} ≈ ${Math.round(jl.len)} мм, щоб струм не йшов через одну точку.`);
      else if (jl.series) jumperNotes.push(`Групи ${j} та ${j + 1}${hadSeries ? ' (додатково)' : ''} з'єднано дротом-перемичкою${where}: ≈ ${Math.round(jl.len)} мм.`);
      else jumperNotes.push(`Шина B${j}: розрізнені частини групи ${A.group + 1} з'єднано дротом-перемичкою${where}: ≈ ${Math.round(jl.len)} мм.`);
    }
    buses.push({
      index: j,
      side,
      members: members.map((m) => m.id),
      links,
      seriesLinks: links.filter((l) => l.series).length,
      connected: true,
      jumpers: jumpers.length,
    });
  }

  // мідна збірна шина вздовж крайніх груп (силовий вивід у кількох точках)
  const attach = ['center', 'collector'].includes(o.leadAttach) ? o.leadAttach : 'near';
  if (attach === 'collector')
    for (const j of [0, S]) {
      const grp = byGroup[j === 0 ? 0 : S - 1];
      buses[j].collector = spanningEdges(grp, adjacent, jumperLen);
    }

  // Точки підключення дротів BMS (див. planHarness): узгоджений вибір, при якому дроти
  // не перетинаються; силові P−/P+ — біля BMS або в центрі крайньої групи.
  const geo = { shape: cell.shape, footprint: fp, rotate: !!o.rotate, width, height, cells, buses, byGroup, S, pitchX: px, pitchY: py };
  const uBoundary = !slots && layers === 1 && base.uBoundary != null ? base.uBoundary : null;
  const leadAttach = attach;
  const requested = BMS_SIDES.includes(o.bmsSide) ? o.bmsSide : 'auto';
  const options = {};
  for (const side of BMS_SIDES) options[side] = planHarness(geo, side, attach === 'center' ? 'center' : 'near');
  const rank = { clean: 0, bundled: 1, crossing: 2 };
  const better = (a, b) => (rank[a.quality] - rank[b.quality]) || (a.cost - b.cost);
  // U-розкладка: дроти центральним каналом між «банками» до BMS на відкритому кінці (ліворуч)
  const channel = uBoundary != null ? planChannel(geo, uBoundary, attach === 'center' ? 'center' : 'near') : null;
  if (channel && better(channel, options.left) < 0) options.left = channel;
  const bestSide = BMS_SIDES.reduce((m, s) => (better(options[s], options[m]) < 0 ? s : m), BMS_SIDES[0]);
  const bmsSide = requested === 'auto' ? bestSide : requested;
  const plan = options[bmsSide];
  for (const b of buses) {
    b.tap = plan.taps[b.index];
    b.power = b.index === 0 || b.index === S ? b.tap : null;
    b.tapDist = plan.dist[b.index];
  }
  const harness = {
    side: bmsSide, requested, quality: plan.quality, dir: plan.dir, cost: plan.cost, bestSide,
    mode: plan.mode || 'edge', boundaryY: plan.mode === 'channel' ? uBoundary : null,
    alternatives: Object.fromEntries(BMS_SIDES.map((s) => [s, { quality: options[s].quality, cost: options[s].cost }])),
  };

  const minSeries = S > 1 ? Math.min(...buses.slice(1, S).map((b) => b.seriesLinks)) : 0;
  const weakestBus = S > 1 ? buses.slice(1, S).reduce((m, b) => (b.seriesLinks < m.seriesLinks ? b : m)).index : null;
  const strips = buses.flatMap((b) => b.links.filter((l) => !l.jumper));
  const jumpers = buses.flatMap((b) => b.links.filter((l) => l.jumper));

  return {
    S, P, N, rows: usedRows, cols: usedCols, cells, buses, width, height,
    pitchX: px, pitchY: py, footprint: fp, shape: cell.shape, honey: base.honey, dense: base.dense, snake: base.snake, rotate: !!o.rotate,
    bmsSide, leadAttach, harness,
    layers, groupsPerLayer: Sl, layerHeight: base.height, layerStep, layerGapPhys,
    outline: base.outline || null, custom: !!slots, breaks: base.breaks ?? 0,
    warnings, jumperNotes, minSeries, weakestBus,
    stripLength: strips.reduce((s, l) => s + l.len, 0),
    linkCount: strips.length,
    jumperCount: jumpers.length,
    jumperLength: jumpers.reduce((s, l) => s + l.len, 0),
  };
}

/** Звичайна решітка (сітка / стільники / щільні стільники) з «змійкою» на Nl комірок. */
function gridBase(o, Nl, Sl, P, fp, gap, cell) {
  const honey = (o.arrangement === 'honeycomb' || o.arrangement === 'honeycomb2') && cell.shape === 'cyl';
  let dense = honey && o.arrangement === 'honeycomb2';
  let snake = dense ? 'rows' : ['rows', 'u'].includes(o.snake) ? o.snake : 'cols';
  const px = fp.w + gap;
  const py = honey ? (fp.w + gap) * SQRT3_2 : fp.h + gap;

  let R = Math.max(1, Math.min(Math.floor(o.rows) || autoRows(Sl, P, cell.shape, snake), Nl));
  if (snake === 'u' && R < 2) snake = 'cols';
  let C;
  if (dense) {
    C = denseCols(Nl, R);
    if (C < 2) dense = false;
    else R = denseRows(Nl, C);
  }
  if (!dense) {
    C = Math.ceil(Nl / R);
    if (snake === 'rows') R = Math.ceil(Nl / C); // прибираємо порожні ряди
  }

  const rowLen = (r) => (dense && r % 2 ? C - 1 : C);
  const order = [];
  if (snake === 'u') {
    // верхній блок рядів [0, R1) — змійкою зліва направо, нижній [R1, R) — справа наліво.
    // Напрямок першого стовпця обрано так, щоб верхній блок закінчувався біля нижнього.
    const R1 = Math.ceil(R / 2), R2 = R - R1;
    C = Math.ceil(Nl / R);
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
  const pos = order.slice(0, Nl).map(([r, c]) => ({
    row: r, col: c,
    x: c * px + fp.w / 2 + (honey && r % 2 ? px / 2 : 0),
    y: r * py + fp.h / 2,
  }));
  const R1 = Math.ceil(R / 2);
  const uBoundary = snake === 'u' && R >= 2 ? R1 * py + fp.h / 2 - py / 2 : null;
  return {
    order: pos, px, py, honey, dense, snake, byDistance: honey, uBoundary,
    rows: Math.max(...pos.map((p) => p.row)) + 1,
    cols: Math.max(...pos.map((p) => p.col)) + 1,
    width: Math.max(...pos.map((p) => p.x)) + fp.w / 2,
    height: Math.max(...pos.map((p) => p.y)) + fp.h / 2,
  };
}

/**
 * Довільні позиції (вписування у форму). Обираємо порядок обходу («змійку» по рядах
 * або стовпцях решітки, з будь-якого кута), за якого найменше розривів між сусідніми
 * в порядку комірками — там, де розрив, з'являться дроти-перемички.
 */
function slotBase(slots, outline, Nl, fp, gap, P = 1) {
  const px = fp.w + gap;
  const thr = px * 1.02 + 1e-6;
  const orders = [];
  for (const axis of ['row', 'col'])
    for (const rev of [false, true])
      for (const startRev of [false, true]) {
        const other = axis === 'row' ? 'col' : 'row';
        const keys = [...new Set(slots.map((s) => s[axis]))].sort((a, b) => (rev ? b - a : a - b));
        const order = [];
        keys.forEach((key, i) => {
          const line = slots.filter((s) => s[axis] === key).sort((a, b) => a[other] - b[other] || a.x - b.x || a.y - b.y);
          if ((i % 2 === 1) !== startRev) line.reverse();
          order.push(...line);
        });
        orders.push(order);
      }
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= thr;
  const breaks = (order) => {
    let n = 0;
    for (let i = 1; i < Nl; i++) if (!near(order[i], order[i - 1])) n++;
    return n;
  };
  // штраф: стики сусідніх груп з малою кількістю контактів (весь струм через 1–2 комірки)
  const score = (order) => {
    let pen = breaks(order);
    const want = Math.min(P, 3);
    for (let g = 0; g + 1 < Nl / P; g++) {
      let contacts = 0;
      for (let i = g * P; i < (g + 1) * P; i++)
        for (let k = (g + 1) * P; k < Math.min((g + 2) * P, Nl); k++) if (near(order[i], order[k])) contacts++;
      if (contacts < want) pen += (want - contacts) * 4;
    }
    return pen;
  };
  let best = orders[0], bestScore = score(best);
  for (const ord of orders.slice(1)) { const sc = score(ord); if (sc < bestScore) { best = ord; bestScore = sc; } }
  const bestB = breaks(best);

  // система координат: від лівого верхнього кута контуру (або комірок)
  const r = fp.w / 2;
  const pts = outline?.length >= 3 ? outline : null;
  const minX = pts ? Math.min(...pts.map((p) => p[0])) : Math.min(...slots.map((s) => s.x)) - r;
  const minY = pts ? Math.min(...pts.map((p) => p[1])) : Math.min(...slots.map((s) => s.y)) - r;
  const maxX = pts ? Math.max(...pts.map((p) => p[0])) : Math.max(...slots.map((s) => s.x)) + r;
  const maxY = pts ? Math.max(...pts.map((p) => p[1])) : Math.max(...slots.map((s) => s.y)) + r;
  const order = best.slice(0, Nl).map((s) => ({ x: s.x - minX, y: s.y - minY, row: s.row, col: s.col }));
  return {
    order, px, py: px, honey: true, dense: false, snake: 'shape', byDistance: true,
    rows: new Set(order.map((p) => p.row)).size, cols: new Set(order.map((p) => p.col)).size,
    width: maxX - minX, height: maxY - minY,
    outline: pts ? pts.map(([x, y]) => [x - minX, y - minY]) : null,
    breaks: bestB,
  };
}

/** Найкоротші дроти-перемички, що з'єднують усі частини шини в одне ціле (Крускал по компонентах). */
function connectComponents(members, links, lenFn) {
  if (members.length <= 1) return [];
  const parent = new Map(members.map((m) => [m.id, m.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const l of links) parent.set(find(l.a), find(l.b));
  const roots = () => new Set(members.map((m) => find(m.id)));
  const out = [];
  if (roots().size === 1) return out;
  const pairs = [];
  for (let a = 0; a < members.length; a++)
    for (let b = a + 1; b < members.length; b++) pairs.push([lenFn(members[a], members[b]), members[a], members[b]]);
  pairs.sort((x, y) => x[0] - y[0]);
  for (const [len, A, B] of pairs) {
    const ra = find(A.id), rb = find(B.id);
    if (ra === rb) continue;
    parent.set(ra, rb);
    out.push({ a: A.id, b: B.id, len, series: A.group !== B.group, jumper: true, crossLayer: A.layer !== B.layer });
    if (roots().size === 1) break;
  }
  return out;
}

/** Кістяк групи для мідної збірної шини: спершу сусідні комірки, за потреби — найкоротші переходи. */
function spanningEdges(group, adjacent, lenFn) {
  const parent = new Map(group.map((m) => [m.id, m.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const pairs = [];
  for (let a = 0; a < group.length; a++)
    for (let b = a + 1; b < group.length; b++) {
      const A = group[a], B = group[b];
      pairs.push([lenFn(A, B) + (adjacent(A, B) ? 0 : 1e6), A, B]);
    }
  pairs.sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [, A, B] of pairs) {
    const ra = find(A.id), rb = find(B.id);
    if (ra === rb) continue;
    parent.set(ra, rb);
    out.push({ a: A.id, b: B.id, len: lenFn(A, B) });
  }
  return out;
}

/**
 * Система координат краю пакета, біля якого стоїть BMS.
 * along — координата вздовж краю, dist — відстань від точки до краю,
 * point(a, off) — точка на відстані off назовні від краю.
 */
export function edgeFrame(width, height, side) {
  switch (side) {
    case 'right': return { side, vertical: true, len: height, along: (p) => p[1], dist: (p) => width - p[0], point: (a, off) => [width + off, a] };
    case 'left': return { side, vertical: true, len: height, along: (p) => p[1], dist: (p) => p[0], point: (a, off) => [-off, a] };
    case 'top': return { side, vertical: false, len: width, along: (p) => p[0], dist: (p) => p[1], point: (a, off) => [a, -off] };
    default: return { side: 'bottom', vertical: false, len: width, along: (p) => p[0], dist: (p) => height - p[1], point: (a, off) => [a, height + off] };
  }
}

/** Мінімальна відстань між сусідніми «доріжками» дротів уздовж краю, мм. */
export function harnessGap(geo) {
  return 0.4 * Math.min(geo.pitchX, geo.pitchY);
}

/**
 * Узгоджений вибір точок підключення дротів BMS для заданої сторони.
 *
 * Дріт іде від точки на шині перпендикулярно до краю пакета, а далі віялом до свого піна.
 * Піни роз'єму стоять підряд: P−, B0, B1, …, BS, P+. Дроти не перетинаються, якщо на кожній
 * поверхні (верх/низ) точки підключення йдуть уздовж краю в тому ж порядку, що й піни,
 * з інтервалом не менше за harnessGap. Це задача динамічного програмування по шинах
 * у порядку роз'єму з мінімізацією довжини дротів поверх пакета.
 *
 * Якість: clean — без перетинів і накладань; bundled — частина дротів іде спільним джгутом
 * (однакова координата), але не перетинається; crossing — розвести без перетинів неможливо.
 */
export function planHarness(geo, side, leadAttach = 'near') {
  const fr = edgeFrame(geo.width, geo.height, side);
  const { S, cells, buses } = geo;
  const central = (list) => {
    const cx = list.reduce((t, c) => t + c.x, 0) / list.length, cy = list.reduce((t, c) => t + c.y, 0) / list.length;
    return list.reduce((m, c) => (Math.hypot(c.x - cx, c.y - cy) < Math.hypot(m.x - cx, m.y - cy) - 1e-6 ? c : m));
  };
  const cand = buses.map((b) => {
    let ids = b.members;
    if (leadAttach === 'center' && (b.index === 0 || b.index === S)) ids = [central(geo.byGroup[b.index === 0 ? 0 : S - 1]).id];
    return ids.map((id) => {
      const p = terminalPoint(geo, cells[id], b.side);
      // силові P−/P+ (шини 0 і S) товсті й струмові — їхня довжина важить більше
      return { id, a: fr.along(p), d: fr.dist(p), w: b.index === 0 || b.index === S ? 4 : 1 };
    });
  });
  const costOf = (c) => c.w * c.d + 0.05 * Math.abs(c.a - fr.len / 2);
  const surfaces = geo.shape === 'prism'
    ? [buses.map((b) => b.index)]
    : ['top', 'bottom'].map((sd) => buses.filter((b) => b.side === sd).map((b) => b.index));

  const minGap = harnessGap(geo);
  const bundlePenalty = 3 * Math.max(geo.pitchX, geo.pitchY);
  const inversionPenalty = 30 * Math.max(geo.pitchX, geo.pitchY);
  const solve = (seq, dir, gap) => {
    if (!seq.length) return { cost: 0, pick: [] };
    const tables = [];
    seq.forEach((k, i) => {
      const row = cand[k].map((c) => {
        if (i === 0) return { cost: costOf(c), back: -1 };
        let best = Infinity, bi = -1;
        const prevC = cand[seq[i - 1]];
        tables[i - 1].forEach((pv, j) => {
          const step = dir * (c.a - prevC[j].a);
          if (step < gap) return;
          // спільна траса (джгут) і зворотний порядок (перетин) — лише в запасних режимах, зі штрафом
          const v = pv.cost + (step < -1e-6 ? inversionPenalty : step < minGap ? bundlePenalty : 0);
          if (v < best) { best = v; bi = j; }
        });
        return { cost: best === Infinity ? Infinity : best + costOf(c), back: bi };
      });
      tables.push(row);
    });
    const last = tables[tables.length - 1];
    let bi = -1;
    last.forEach((r, j) => { if (r.cost < Infinity && (bi < 0 || r.cost < last[bi].cost)) bi = j; });
    if (bi < 0) return null;
    const pick = [];
    for (let i = seq.length - 1; i >= 0; i--) { pick[i] = cand[seq[i]][bi]; bi = tables[i][bi].back; }
    return { cost: tables[tables.length - 1].reduce((m, r) => Math.min(m, r.cost), Infinity), pick };
  };

  for (const [quality, gap] of [['clean', minGap], ['bundled', -1e-6], ['crossing', -Infinity]]) {
    let best = null;
    for (const dir of [1, -1]) {
      let total = 0;
      const res = [];
      for (const seq of surfaces) {
        const r = solve(seq, dir, gap);
        if (!r) { total = Infinity; break; }
        total += r.cost;
        res.push([seq, r.pick]);
      }
      if (total < Infinity && (!best || total < best.cost)) best = { dir, cost: total, res };
    }
    if (best) {
      const taps = [], dist = [];
      for (const [seq, pick] of best.res) seq.forEach((k, i) => { taps[k] = pick[i].id; dist[k] = pick[i].d; });
      return { quality, dir: best.dir, cost: best.cost, taps, dist };
    }
  }
  throw new Error('planHarness: немає розв\'язку');
}

/**
 * Трасування U-розкладки центральним каналом. Групи 1…m лежать у верхньому «банку»
 * (зліва направо), m+1…S — у нижньому (справа наліво); BMS — на відкритому кінці U (ліворуч).
 * Дроти верхнього банку опускаються до каналу, нижнього — піднімаються, і йдуть каналом
 * ліворуч. Перетинів немає, якщо у верхньому банку точки йдуть зліва направо, а в нижньому —
 * справа наліво в порядку роз'єму (тоді порядок прибуття до BMS: P−, B0…BS, P+).
 */
export function planChannel(geo, yB, leadAttach = 'near') {
  const { S, cells, buses } = geo;
  const minGap = harnessGap(geo);
  const central = (list) => {
    const cx = list.reduce((t, c) => t + c.x, 0) / list.length, cy = list.reduce((t, c) => t + c.y, 0) / list.length;
    return list.reduce((m, c) => (Math.hypot(c.x - cx, c.y - cy) < Math.hypot(m.x - cx, m.y - cy) - 1e-6 ? c : m));
  };
  const cand = buses.map((b) => {
    let ids = b.members;
    if (leadAttach === 'center' && (b.index === 0 || b.index === S)) ids = [central(geo.byGroup[b.index === 0 ? 0 : S - 1]).id];
    return ids.map((id) => {
      const [x, y] = terminalPoint(geo, cells[id], b.side);
      const w = b.index === 0 || b.index === S ? 4 : 1;
      return { id, x, y, top: y < yB, d: Math.abs(y - yB) + x, w };
    });
  });
  const surfaces = geo.shape === 'prism'
    ? [buses.map((b) => b.index)]
    : ['top', 'bottom'].map((sd) => buses.filter((b) => b.side === sd).map((b) => b.index));
  for (const [quality, gap] of [['clean', minGap], ['bundled', -1e-6]]) {
    const r = solveChannel(gap);
    if (r) return { quality, ...r, dir: 1, mode: 'channel' };
  }
  return { quality: 'crossing', cost: Infinity, taps: [], dist: [], dir: 1, mode: 'channel' };

  function solveChannel(gapX) {
  const ok = (p, c) => (p.top && c.top ? c.x - p.x >= gapX : p.top && !c.top ? true : !p.top && !c.top ? p.x - c.x >= gapX : false);
  const taps = [], dist = [];
  let total = 0;
  for (const seq of surfaces) {
    if (!seq.length) continue;
    const tables = [];
    seq.forEach((k, i) => {
      tables.push(cand[k].map((c) => {
        if (i === 0) return { cost: c.w * c.d, back: -1 };
        let best = Infinity, bi = -1;
        tables[i - 1].forEach((pv, j) => { if (pv.cost < best && ok(cand[seq[i - 1]][j], c)) { best = pv.cost; bi = j; } });
        return { cost: best === Infinity ? Infinity : best + c.w * c.d, back: bi };
      }));
    });
    const last = tables[tables.length - 1];
    let bi = -1;
    last.forEach((r, j) => { if (r.cost < Infinity && (bi < 0 || r.cost < last[bi].cost)) bi = j; });
    if (bi < 0) return null;
    total += last[bi].cost;
    for (let i = seq.length - 1; i >= 0; i--) { const c = cand[seq[i]][bi]; taps[seq[i]] = c.id; dist[seq[i]] = c.d; bi = tables[i][bi].back; }
  }
  return { cost: total, taps, dist };
  }
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
