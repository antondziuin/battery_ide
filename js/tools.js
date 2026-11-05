// Допоміжні калькулятори: нікелева стрічка, перетин дроту, час роботи/заряду,
// підбір конфігурації під вимоги, балансування комірок за ємністю.

// Питомий опір, Ом·м
export const STRIP_MATERIALS = {
  nickel: { name: 'Чистий нікель (Ni200/201)', rho: 6.99e-8 },
  steel: { name: 'Нікельована сталь', rho: 1.3e-7 },
  copper: { name: 'Мідь', rho: 1.72e-8 },
  copperNi: { name: 'Мідь + нікель (сендвіч)', rho: 2.2e-8 },
};

// Калібровано так, що чистий нікель 8 × 0.15 мм ≈ 5 А тривало (поширене практичне правило).
// Допустима розсіювана потужність пропорційна периметру перетину.
const STRIP_K = 0.0893; // Вт/м на мм периметра

/**
 * @param {{material:string,width:number,thickness:number,layers?:number,length?:number,current?:number}} o
 * width, thickness, length — мм
 */
export function stripCalc(o) {
  const mat = STRIP_MATERIALS[o.material] || STRIP_MATERIALS.nickel;
  const layers = Math.max(1, Math.floor(o.layers || 1));
  const area = o.width * o.thickness * layers; // мм²
  const rPerM = mat.rho / (area * 1e-6); // Ом/м
  const perimeter = 2 * (o.width + o.thickness * layers);
  const ampacity = Math.sqrt((STRIP_K * perimeter) / rPerM);
  const lenM = (o.length || 0) / 1000;
  const R = rPerM * lenM;
  const I = o.current || 0;
  return {
    area, rPerM, mOhmPerCm: rPerM * 10, // мОм/см = Ом/м * 1000 / 100
    ampacity, R, drop: R * I, loss: R * I * I,
    load: ampacity ? I / ampacity : 0,
    layersNeeded: I ? layersNeededFor(I, o, mat) : null,
  };
}

function layersNeededFor(I, o, mat) {
  for (let n = 1; n <= 10; n++) {
    const area = o.width * o.thickness * n;
    const r = mat.rho / (area * 1e-6);
    const per = 2 * (o.width + o.thickness * n);
    if (Math.sqrt((STRIP_K * per) / r) >= I) return n;
  }
  return null;
}

// Мідний багатожильний дріт у силіконовій ізоляції — консервативні тривалі струми.
export const AWG_TABLE = [
  { awg: 26, mm2: 0.129, amps: 2.2 },
  { awg: 24, mm2: 0.205, amps: 3.5 },
  { awg: 22, mm2: 0.326, amps: 5 },
  { awg: 20, mm2: 0.518, amps: 7.5 },
  { awg: 18, mm2: 0.823, amps: 10 },
  { awg: 16, mm2: 1.31, amps: 15 },
  { awg: 14, mm2: 2.08, amps: 22 },
  { awg: 12, mm2: 3.31, amps: 35 },
  { awg: 10, mm2: 5.26, amps: 50 },
  { awg: 8, mm2: 8.37, amps: 75 },
  { awg: 6, mm2: 13.3, amps: 100 },
  { awg: 4, mm2: 21.2, amps: 140 },
  { awg: 2, mm2: 33.6, amps: 190 },
  { awg: 0, mm2: 53.5, amps: 250 },
  { awg: '00', mm2: 67.4, amps: 300 },
  { awg: '0000', mm2: 107, amps: 400 },
];
const RHO_CU = 1.72e-8;

/**
 * @param {{current:number, length:number, voltage:number, maxDropPct:number}} o
 * length — довжина кабелю в один бік, м (рахуємо туди і назад)
 */
export function wireCalc(o) {
  const rows = AWG_TABLE.map((w) => {
    const R = (RHO_CU * 2 * o.length) / (w.mm2 * 1e-6);
    const drop = R * o.current;
    const dropPct = o.voltage ? (drop / o.voltage) * 100 : 0;
    return { ...w, R, drop, dropPct, loss: drop * o.current, okAmps: w.amps >= o.current, okDrop: dropPct <= o.maxDropPct };
  });
  const rec = rows.find((r) => r.okAmps && r.okDrop) || null;
  return { rows, recommended: rec };
}

/**
 * Час роботи й заряду.
 * @param {{wh:number, ah:number, vNom:number, loadW?:number, loadA?:number, efficiency?:number, dod?:number, chargeA?:number}} o
 */
export function runtimeCalc(o) {
  const eff = (o.efficiency ?? 90) / 100;
  const dod = (o.dod ?? 90) / 100;
  const usableWh = o.wh * dod * eff;
  const loadW = o.loadW || (o.loadA ? o.loadA * o.vNom : 0);
  const hours = loadW ? usableWh / loadW : null;
  const chargeH = o.chargeA ? ((o.ah * dod) / o.chargeA) * 1.15 + (o.chargeA / o.ah > 0.5 ? 0.3 : 0.15) : null;
  return {
    usableWh, loadW, hours,
    loadA: loadW / o.vNom,
    cRate: o.vNom && o.ah ? loadW / o.vNom / o.ah : null,
    chargeH, chargeC: o.chargeA ? o.chargeA / o.ah : null,
  };
}

/**
 * Підбір S×P під вимоги.
 * @param {object} cell
 * @param {{voltage:number, mode:'nearest'|'max'|'min', ah?:number, wh?:number, current?:number, peak?:number}} t
 */
export function sizePack(cell, t) {
  let S;
  const ratio = t.voltage / cell.vNom;
  if (t.mode === 'max') S = Math.max(1, Math.floor(t.voltage / cell.vMax + 1e-9));
  else if (t.mode === 'min') S = Math.max(1, Math.ceil(t.voltage / cell.vMin - 1e-9));
  else S = Math.max(1, Math.round(ratio));
  const reasons = [];
  // LiFePO4 «48 В»: стандарт — 16S (51,2 В), а не 15S, що дає просте округлення 48 / 3,2
  if (t.mode !== 'max' && t.mode !== 'min' && cell.chem === 'LiFePO4' && t.voltage >= 44 && t.voltage <= 54) {
    if (S !== 16) reasons.push('16S — стандарт LiFePO4 для 48 В інверторів');
    S = 16;
  }
  const vNom = S * cell.vNom;
  const needAh = Math.max(t.ah || 0, t.wh ? t.wh / vNom : 0);
  let P = 1;
  if (needAh) { const p = Math.ceil(needAh / cell.capacity - 1e-9); if (p > P) P = p; reasons.push(`ємність: ${p}P`); }
  if (t.current) { const p = Math.ceil(t.current / cell.iMax - 1e-9); if (p > P) P = p; reasons.push(`тривалий струм: ${p}P`); }
  if (t.peak) { const p = Math.ceil(t.peak / (cell.iMax * 1.5) - 1e-9); if (p > P) P = p; reasons.push(`піковий струм: ${p}P`); }
  return { S, P, reasons, vNom, vMax: S * cell.vMax, vMin: S * cell.vMin, ah: P * cell.capacity, wh: P * cell.capacity * vNom };
}

/** Розбір тексту зі списком комірок: «3450», «3450 22», «3450;22», по одній на рядок або через кому. */
export function parseCellList(text) {
  const out = [];
  const lines = String(text).split(/\n|,(?=\s*\d{3,})/);
  let n = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const nums = line.split(/[\s;\t|]+/).map((x) => parseFloat(x.replace(',', '.'))).filter((x) => isFinite(x));
    if (!nums.length) continue;
    n++;
    let label = String(n);
    const m = line.match(/^#?([A-Za-zА-Яа-яІіЇїЄє][\w-]*)\s*[:=]?/);
    if (m) label = m[1];
    out.push({ label, cap: nums[0], ir: nums.length >= 2 ? nums[1] : null });
  }
  return out;
}

/**
 * Розподіл комірок по групах так, щоб сумарні ємності груп були максимально рівні.
 * Жадібне LPT + покращення обмінами.
 * @param {{label:string,cap:number,ir?:number}[]} list
 */
export function balanceCells(list, S, P) {
  const N = S * P;
  if (list.length < N) throw new Error(`Потрібно щонайменше ${N} комірок, введено ${list.length}`);
  // беремо N найкращих за ємністю
  const sorted = [...list].sort((a, b) => b.cap - a.cap);
  const used = sorted.slice(0, N);
  const unused = sorted.slice(N);
  const groups = Array.from({ length: S }, () => ({ cells: [], sum: 0 }));
  for (const c of used) {
    let best = null;
    for (const g of groups) if (g.cells.length < P && (!best || g.sum < best.sum)) best = g;
    best.cells.push(c);
    best.sum += c.cap;
  }
  // покращення: міняємо комірки між найбільшою і найменшою групою
  for (let iter = 0; iter < 2000; iter++) {
    let improved = false;
    groups.sort((a, b) => b.sum - a.sum);
    const range = groups[0].sum - groups[S - 1].sum;
    if (range <= 0) break;
    outer: for (let hi = 0; hi < S - 1; hi++) {
      for (let lo = S - 1; lo > hi; lo--) {
        const G = groups[hi], g = groups[lo];
        const diff = G.sum - g.sum;
        let bestSwap = null;
        for (let i = 0; i < G.cells.length; i++)
          for (let k = 0; k < g.cells.length; k++) {
            const d = G.cells[i].cap - g.cells[k].cap;
            if (d > 0 && d < diff) {
              const gain = Math.abs(diff) - Math.abs(diff - 2 * d);
              if (gain > 1e-9 && (!bestSwap || gain > bestSwap.gain)) bestSwap = { i, k, d, gain };
            }
          }
        if (bestSwap) {
          const a = G.cells[bestSwap.i], b = g.cells[bestSwap.k];
          G.cells[bestSwap.i] = b; g.cells[bestSwap.k] = a;
          G.sum -= bestSwap.d; g.sum += bestSwap.d;
          const newRange = Math.max(...groups.map((x) => x.sum)) - Math.min(...groups.map((x) => x.sum));
          if (newRange < range - 1e-9) { improved = true; break outer; }
          // відкат, якщо загальний розкид не зменшився
          G.cells[bestSwap.i] = a; g.cells[bestSwap.k] = b;
          G.sum += bestSwap.d; g.sum -= bestSwap.d;
        }
      }
    }
    if (!improved) break;
  }
  // впорядкування груп для стабільного виводу
  groups.forEach((g) => g.cells.sort((a, b) => b.cap - a.cap));
  const sums = groups.map((g) => g.sum);
  const max = Math.max(...sums), min = Math.min(...sums);
  const mean = sums.reduce((s, x) => s + x, 0) / S;
  return {
    groups: groups.map((g) => ({
      cells: g.cells, sum: g.sum,
      ir: g.cells.every((c) => c.ir) ? 1 / g.cells.reduce((s, c) => s + 1 / c.ir, 0) : null,
    })),
    unused, max, min, mean, range: max - min, rangePct: mean ? ((max - min) / mean) * 100 : 0,
  };
}
