// Розрахунок розподілу струмів у пакеті під навантаженням.
//
// Модель: кожна клема комірки — вузол. Комірка — джерело ЕРС із внутрішнім опором між своїми
// клемами, перемичка — опір між клемами сусідніх комірок однієї шини. Навантаження — джерело
// струму між точками приварювання силових дротів P+ та P−.
// Оскільки ЕРС усіх комірок однакові, зрівняльних струмів без навантаження немає, і за принципом
// суперпозиції струми визначаються лише навантаженням (ЕРС можна прийняти нульовими).
// Систему G·v = i (лапласіан провідностей, вузол P− заземлено) розв'язуємо методом спряжених
// градієнтів з передобумовлювачем Якобі — матриця розріджена, симетрична, додатно визначена.

import { STRIP_MATERIALS, stripCalc, AWG_TABLE } from './tools.js';

const nodeOf = (cellId, side) => cellId * 2 + (side === 'top' ? 0 : 1);

/**
 * @param {object} layout результат generateLayout
 * @param {object} cell комірка
 * @param {object} o
 * @param {number} o.load струм навантаження, А
 * @param {{material:string,width:number,thickness:number,layers:number}} o.strip паралельні перемички
 * @param {{material:string,width:number,thickness:number,layers:number}} [o.seriesStrip] послідовні
 *        перемички (між групами), якщо відрізняються від паралельних
 * @param {number} [o.jumperArea] перетин мідних дротів-перемичок, мм²
 * @param {number} [o.collectorArea] перетин мідної збірної шини вздовж крайньої групи, мм²
 * @param {number} [o.weld] опір одного зварного з'єднання, мОм
 */
export function analyzeCurrents(layout, cell, o) {
  const I = Number(o.load) || 0;
  const N = layout.N;
  const S = layout.S;
  if (!(I > 0)) return { ok: false, reason: 'Задайте струм навантаження' };
  const strip = o.strip || { material: 'nickel', width: 8, thickness: 0.15, layers: 1 };
  const spec = (st) => {
    const mat = STRIP_MATERIALS[st.material] || STRIP_MATERIALS.nickel;
    return {
      rho: mat.rho,
      area: Math.max(1e-6, st.width * st.thickness * Math.max(1, st.layers || 1)), // мм²
      ampacity: stripCalc({ material: st.material, width: st.width, thickness: st.thickness, layers: st.layers }).ampacity,
    };
  };
  const par = spec(strip);
  const ser = o.seriesStrip ? spec(o.seriesStrip) : par;
  const RHO_CU = 1.72e-8;
  const jumperArea = Math.max(0.2, o.jumperArea || 3.3);
  const jumper = { rho: RHO_CU, area: jumperArea, ampacity: wireAmpacity(jumperArea) };
  const collectorArea = Math.max(0.5, o.collectorArea || 5);
  const ampacity = par.ampacity;
  const weld = (o.weld ?? 0.15) / 1000; // Ом на одне зварювання
  const rCell = Math.max(0.05, cell.ir || 20) / 1000; // Ом
  const specOf = (l) => (l.jumper ? jumper : l.series ? ser : par);

  // мідна збірна шина: окремі вузли вздовж шини; кожна комірка приварена до неї
  const colNode = new Map(); // `${bus}:${cell}` → вузол
  let nNodes = 2 * N;
  for (const b of layout.buses)
    for (const e of b.collector || [])
      for (const id of [e.a, e.b]) if (!colNode.has(`${b.index}:${id}`)) colNode.set(`${b.index}:${id}`, nNodes++);
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
      const sp = specOf(l);
      const R = (sp.rho * (l.len / 1000)) / (sp.area * 1e-6) + 2 * weld;
      addEdge(nodeOf(l.a, b.side), nodeOf(l.b, b.side), 1 / R);
      return R;
    }));
    // мідна збірна шина: мідь між вузлами шини + зварювання кожної комірки до шини
    for (const e of b.collector || []) {
      const R = (RHO_CU * (e.len / 1000)) / (collectorArea * 1e-6);
      addEdge(colNode.get(`${b.index}:${e.a}`), colNode.get(`${b.index}:${e.b}`), 1 / Math.max(R, 1e-6));
    }
    const welded = new Set();
    for (const e of b.collector || [])
      for (const id of [e.a, e.b]) {
        if (welded.has(id)) continue;
        welded.add(id);
        addEdge(nodeOf(id, b.side), colNode.get(`${b.index}:${id}`), 1 / weld);
      }
  }

  const busN = layout.buses[0], busP = layout.buses[S];
  const pMinus = busN.power ?? busN.members[0], pPlus = busP.power ?? busP.members[busP.members.length - 1];
  // силовий дріт підходить до збірної шини (якщо є) або до клеми комірки
  const nMinus = colNode.get(`0:${pMinus}`) ?? nodeOf(pMinus, busN.side);
  const nPlus = colNode.get(`${S}:${pPlus}`) ?? nodeOf(pPlus, busP.side);

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
  const linkRatio = [];
  const linkI = layout.buses.map((b, bi) => {
    const ratios = [];
    const cur = b.links.map((l, li) => {
      const R = linkR[bi][li];
      const c = Math.abs(V(nodeOf(l.a, b.side)) - V(nodeOf(l.b, b.side))) / R;
      const amp = specOf(l).ampacity;
      ratios.push(c / amp);
      stripLoss += c * c * R;
      // «найнавантаженіша» — з найбільшою часткою від власного допустимого струму
      if (!maxLink || c / amp > maxLink.ratio) maxLink = { bus: b.index, link: li, I: c, ampacity: amp, ratio: c / amp, series: l.series, jumper: !!l.jumper, a: l.a, b: l.b };
      return c;
    });
    linkRatio.push(ratios);
    return cur;
  });
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
    maxLink, ampacity, linkRatio, seriesAmpacity: ser.ampacity, jumperAmpacity: jumper.ampacity,
    maxLinkRatio: maxLink ? maxLink.ratio : 0,
    stripLoss, cellLoss, drop,
    vTerm: S * cell.vNom - drop,
    plusNode: nPlus, minusNode: nMinus,
  };
}

/** Орієнтовний тривалий струм мідного дроту в силіконі за перетином (див. AWG_TABLE). */
export function wireAmpacity(mm2) {
  const t = AWG_TABLE.find((w) => w.mm2 >= mm2 - 1e-9) || AWG_TABLE[AWG_TABLE.length - 1];
  const prev = [...AWG_TABLE].reverse().find((w) => w.mm2 <= mm2 + 1e-9) || AWG_TABLE[0];
  if (t === prev || t.mm2 === prev.mm2) return t.amps;
  return prev.amps + ((mm2 - prev.mm2) / (t.mm2 - prev.mm2)) * (t.amps - prev.amps);
}

/** Колір перемички за навантаженням відносно допустимого струму. */
export function loadColor(ratio) {
  if (ratio < 0.5) return '#2f9e44';
  if (ratio < 0.8) return '#82b300';
  if (ratio < 1.0) return '#f08c00';
  return '#e03131';
}
