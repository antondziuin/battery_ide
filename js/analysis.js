// Розрахунок розподілу струмів у пакеті під навантаженням.
//
// Модель: кожна клема комірки — вузол. Комірка — джерело ЕРС із внутрішнім опором між своїми
// клемами, перемичка — опір між клемами сусідніх комірок однієї шини. Навантаження — джерело
// струму між точками приварювання силових дротів P+ та P−.
// Оскільки ЕРС усіх комірок однакові, зрівняльних струмів без навантаження немає, і за принципом
// суперпозиції струми визначаються лише навантаженням (ЕРС можна прийняти нульовими).
// Систему G·v = i (лапласіан провідностей, вузол P− заземлено) розв'язуємо методом спряжених
// градієнтів з передобумовлювачем Якобі — матриця розріджена, симетрична, додатно визначена.

import { STRIP_MATERIALS, stripCalc } from './tools.js';

const nodeOf = (cellId, side) => cellId * 2 + (side === 'top' ? 0 : 1);

/**
 * @param {object} layout результат generateLayout
 * @param {object} cell комірка
 * @param {object} o
 * @param {number} o.load струм навантаження, А
 * @param {{material:string,width:number,thickness:number,layers:number}} o.strip перемички
 * @param {number} [o.weld] опір одного зварного з'єднання, мОм
 */
export function analyzeCurrents(layout, cell, o) {
  const I = Number(o.load) || 0;
  const N = layout.N;
  const S = layout.S;
  if (!(I > 0)) return { ok: false, reason: 'Задайте струм навантаження' };
  const strip = o.strip || { material: 'nickel', width: 8, thickness: 0.15, layers: 1 };
  const mat = STRIP_MATERIALS[strip.material] || STRIP_MATERIALS.nickel;
  const area = Math.max(1e-6, strip.width * strip.thickness * Math.max(1, strip.layers || 1)); // мм²
  const weld = (o.weld ?? 0.15) / 1000; // Ом на одне зварювання
  const rCell = Math.max(0.05, cell.ir || 20) / 1000; // Ом
  const ampacity = stripCalc({ material: strip.material, width: strip.width, thickness: strip.thickness, layers: strip.layers }).ampacity;

  const nNodes = 2 * N;
  const adj = Array.from({ length: nNodes }, () => []);
  const addEdge = (a, b, g) => { adj[a].push([b, g]); adj[b].push([a, g]); };

  for (const c of layout.cells) {
    const neg = nodeOf(c.id, c.plusTop ? 'bottom' : 'top');
    const pos = nodeOf(c.id, c.plusTop ? 'top' : 'bottom');
    addEdge(neg, pos, 1 / rCell);
  }
  const linkR = [];
  for (const b of layout.buses) {
    linkR.push(b.links.map((l) => {
      const R = (mat.rho * (l.len / 1000)) / (area * 1e-6) + 2 * weld;
      addEdge(nodeOf(l.a, b.side), nodeOf(l.b, b.side), 1 / R);
      return R;
    }));
  }

  const busN = layout.buses[0], busP = layout.buses[S];
  const nMinus = nodeOf(busN.power ?? busN.members[0], busN.side);
  const nPlus = nodeOf(busP.power ?? busP.members[busP.members.length - 1], busP.side);

  // досяжні вузли від P−
  const seen = new Uint8Array(nNodes);
  const stack = [nMinus];
  seen[nMinus] = 1;
  while (stack.length) {
    const v = stack.pop();
    for (const [w] of adj[v]) if (!seen[w]) { seen[w] = 1; stack.push(w); }
  }
  if (!seen[nPlus]) return { ok: false, reason: 'Між P− та P+ немає електричного кола' };

  // індекси невідомих (усі досяжні вузли, крім заземленого P−)
  const idx = new Int32Array(nNodes).fill(-1);
  let n = 0;
  for (let v = 0; v < nNodes; v++) if (seen[v] && v !== nMinus) idx[v] = n++;
  const diag = new Float64Array(n);
  for (let v = 0; v < nNodes; v++) if (idx[v] >= 0) for (const [, g] of adj[v]) diag[idx[v]] += g;
  const rhs = new Float64Array(n);
  rhs[idx[nPlus]] = -I; // струм витікає з P+ у навантаження

  const matvec = (x, out) => {
    for (let v = 0; v < nNodes; v++) {
      const i = idx[v];
      if (i < 0) continue;
      let s = diag[i] * x[i];
      for (const [w, g] of adj[v]) { const j = idx[w]; if (j >= 0) s -= g * x[j]; }
      out[i] = s;
    }
  };
  const x = new Float64Array(n);
  const r = Float64Array.from(rhs);
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = r[i] / diag[i];
  const p = Float64Array.from(z);
  const Ap = new Float64Array(n);
  let rz = 0;
  for (let i = 0; i < n; i++) rz += r[i] * z[i];
  const bnorm = Math.abs(I);
  let iter = 0;
  for (; iter < 20 * n + 100; iter++) {
    matvec(p, Ap);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    if (!(pAp > 0)) break;
    const alpha = rz / pAp;
    let rnorm = 0;
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; rnorm += r[i] * r[i]; }
    if (Math.sqrt(rnorm) < 1e-11 * bnorm) break;
    let rzNew = 0;
    for (let i = 0; i < n; i++) { z[i] = r[i] / diag[i]; rzNew += r[i] * z[i]; }
    const beta = rzNew / rz;
    rz = rzNew;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }
  const V = (node) => (idx[node] >= 0 ? x[idx[node]] : 0);

  // струми комірок (розряд > 0)
  const cellI = new Float64Array(N);
  let cellLoss = 0;
  for (const c of layout.cells) {
    const neg = nodeOf(c.id, c.plusTop ? 'bottom' : 'top');
    const pos = nodeOf(c.id, c.plusTop ? 'top' : 'bottom');
    cellI[c.id] = seen[neg] ? (V(neg) - V(pos)) / rCell : 0;
    cellLoss += cellI[c.id] ** 2 * rCell;
  }
  // струми перемичок
  let stripLoss = 0;
  let maxLink = null;
  const linkI = layout.buses.map((b, bi) => b.links.map((l, li) => {
    const R = linkR[bi][li];
    const cur = Math.abs(V(nodeOf(l.a, b.side)) - V(nodeOf(l.b, b.side))) / R;
    stripLoss += cur * cur * R;
    if (!maxLink || cur > maxLink.I) maxLink = { bus: b.index, link: li, I: cur, series: l.series, a: l.a, b: l.b };
    return cur;
  }));
  // статистика по групах
  const groups = Array.from({ length: S }, () => ({ min: Infinity, max: -Infinity, sum: 0, minId: -1, maxId: -1 }));
  for (const c of layout.cells) {
    const g = groups[c.group], v = cellI[c.id];
    g.sum += v;
    if (v < g.min) { g.min = v; g.minId = c.id; }
    if (v > g.max) { g.max = v; g.maxId = c.id; }
  }
  let worst = null;
  groups.forEach((g, i) => {
    g.mean = g.sum / layout.P;
    g.imbalance = g.mean > 0 ? (g.max - g.min) / g.mean : 0;
    if (!worst || g.imbalance > worst.imbalance) worst = { group: i, ...g };
  });
  let maxCell = 0, maxCellId = 0;
  cellI.forEach((v, i) => { if (v > maxCell) { maxCell = v; maxCellId = i; } });

  const drop = -V(nPlus); // спад напруги всередині пакета (комірки + перемички)
  return {
    ok: true, load: I, iterations: iter,
    cellI, linkI, groups, worstGroup: worst,
    maxCell, maxCellId, maxCellRatio: cell.iMax ? maxCell / cell.iMax : 0,
    maxLink, ampacity, maxLinkRatio: maxLink ? maxLink.I / ampacity : 0,
    stripLoss, cellLoss, drop,
    vTerm: S * cell.vNom - drop,
    plusNode: nPlus, minusNode: nMinus,
  };
}

/** Колір перемички за навантаженням відносно допустимого струму. */
export function loadColor(ratio) {
  if (ratio < 0.5) return '#2f9e44';
  if (ratio < 0.8) return '#82b300';
  if (ratio < 1.0) return '#f08c00';
  return '#e03131';
}
