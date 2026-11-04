import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CELLS, validateCell } from '../js/cells.js';
import { generateLayout, packStats } from '../js/layout.js';
import { fitLayouts, bestConfigs, checkConfig, chooseRows, countAlong, requiredBox } from '../js/fit.js';
import { stripCalc, wireCalc, sizePack, parseCellList, balanceCells, runtimeCalc } from '../js/tools.js';
import { renderPackSVG, renderFitSVG } from '../js/render.js';

const c18650 = BUILTIN_CELLS.find((c) => c.id === '18650-generic');
const c21700 = BUILTIN_CELLS.find((c) => c.id === 'samsung-50e');
const prism = BUILTIN_CELLS.find((c) => c.id === 'eve-lf280k');

test('усі вбудовані комірки валідні та мають унікальні id', () => {
  const ids = new Set();
  for (const c of BUILTIN_CELLS) {
    assert.deepEqual(validateCell(c), [], c.id);
    assert.ok(!ids.has(c.id), c.id);
    ids.add(c.id);
  }
});

for (const arrangement of ['grid', 'honeycomb', 'honeycomb2'])
  for (const snake of ['cols', 'rows'])
    for (const [S, P, rows] of [[4, 3, 3], [10, 4, 4], [13, 4, 6], [7, 3, 2], [5, 1, 1], [3, 5, 4], [14, 5, 7]])
      test(`${arrangement}/${snake} ${S}S${P}P rows=${rows}: групи суцільні, послідовні з'єднання існують`, () => {
        const L = generateLayout({ S, P, rows, arrangement, snake, gap: 0.5, cell: c18650 });
        assert.equal(L.cells.length, S * P);
        for (let g = 0; g < S; g++) assert.equal(L.cells.filter((c) => c.group === g).length, P);
        assert.equal(L.buses.length, S + 1);
        for (const b of L.buses) assert.ok(b.connected, `шина B${b.index} суцільна`);
        for (let j = 1; j < S; j++) assert.ok(L.buses[j].seriesLinks > 0, `B${j} має послідовну перемичку`);
        assert.deepEqual(L.warnings, []);
        // жодні дві комірки не перекриваються
        for (let i = 0; i < L.cells.length; i++)
          for (let k = i + 1; k < L.cells.length; k++) {
            const a = L.cells[i], b = L.cells[k];
            assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= c18650.d - 1e-6);
          }
        // всі комірки в межах габариту
        for (const c of L.cells) {
          assert.ok(c.x - c18650.d / 2 >= -1e-6 && c.x + c18650.d / 2 <= L.width + 1e-6);
          assert.ok(c.y - c18650.d / 2 >= -1e-6 && c.y + c18650.d / 2 <= L.height + 1e-6);
        }
      });

test('полярність: сусідні групи перевернуті, шини чергуються верх/низ', () => {
  const L = generateLayout({ S: 4, P: 2, rows: 2, arrangement: 'grid', snake: 'cols', gap: 0, cell: c18650 });
  assert.equal(L.cells.find((c) => c.group === 0).plusTop, true);
  assert.equal(L.cells.find((c) => c.group === 1).plusTop, false);
  assert.deepEqual(L.buses.map((b) => b.side), ['bottom', 'top', 'bottom', 'top', 'bottom']);
  // 4S2P у 2 ряди: 4×2, шина B1 (групи 1-2) — 2 послідовні перемички
  assert.equal(L.buses[1].seriesLinks, 2);
  assert.equal(L.width, 4 * c18650.d);
  assert.equal(L.height, 2 * c18650.d);
});

test('шина без сусідства дає попередження', () => {
  // 1 ряд, P=1 — усе ок; штучно перевіримо великий зазор не впливає
  const L = generateLayout({ S: 3, P: 1, rows: 1, arrangement: 'grid', snake: 'cols', gap: 5, cell: c18650 });
  assert.deepEqual(L.warnings, []);
});

test('призматичні комірки: розміри з урахуванням повороту', () => {
  const L = generateLayout({ S: 4, P: 1, rows: 1, arrangement: 'grid', snake: 'cols', gap: 1, cell: prism });
  assert.equal(L.footprint.w, prism.t);
  assert.ok(Math.abs(L.width - (4 * prism.t + 3)) < 1e-9);
  const R = generateLayout({ S: 4, P: 1, rows: 1, arrangement: 'grid', snake: 'cols', gap: 1, cell: prism, rotate: true });
  assert.equal(R.footprint.w, prism.w);
});

test('характеристики пакета 10S4P 21700', () => {
  const st = packStats(c21700, 10, 4, { loadCurrent: 20 });
  assert.equal(st.N, 40);
  assert.ok(Math.abs(st.vNom - 36) < 1e-9);
  assert.ok(Math.abs(st.vMax - 42) < 1e-9);
  assert.equal(st.ah, 20);
  assert.equal(st.wh, 720);
  assert.equal(st.perCell, 5);
  assert.equal(st.balanceWires, 11);
});

test('countAlong', () => {
  assert.equal(countAlong(18, 18.4, 18.9), 0);
  assert.equal(countAlong(18.4, 18.4, 18.9), 1);
  assert.equal(countAlong(18.4 + 18.9, 18.4, 18.9), 2);
});

test('вписування: коробка рівно під 4×3 комірки 18650 стоячи', () => {
  const gap = 0.5, margin = 2;
  const box = { L: 4 * 18.4 + 3 * gap + 2 * margin, W: 3 * 18.4 + 2 * gap + 2 * margin, H: 65.2 + 4 + 2 * margin };
  const layouts = fitLayouts(box, c18650, { gap, margin, depthReserve: 4, allowLayers: false });
  const grid = layouts.find((l) => l.depthAxis === 'H' && l.arrangement === 'grid' && l.cols === 4);
  assert.ok(grid);
  assert.equal(grid.rows, 3);
  assert.equal(grid.perLayer, 12);
  const { configs } = bestConfigs(box, c18650, { gap, margin, depthReserve: 4, allowLayers: false }, [4, 4]);
  assert.equal(configs[0].P, 3);
  assert.ok(checkConfig(box, c18650, 4, 3, { gap, margin, depthReserve: 4, allowLayers: false }).length > 0);
  assert.equal(checkConfig(box, c18650, 4, 4, { gap, margin, depthReserve: 4, allowLayers: false }).length, 0);
});

test('вписування: занизька коробка не вміщує стоячі комірки', () => {
  const layouts = fitLayouts({ L: 200, W: 100, H: 40 }, c18650, { allowLayers: false });
  assert.ok(layouts.every((l) => l.depthAxis !== 'H'));
});

test('вписування: стільники дають не менше комірок у широкій коробці', () => {
  const box = { L: 200, W: 200, H: 80 };
  const ls = fitLayouts(box, c18650, { allowLayers: false });
  const grid = Math.max(...ls.filter((l) => l.arrangement === 'grid' && l.depthAxis === 'H').map((l) => l.perLayer));
  const hc = Math.max(...ls.filter((l) => l.arrangement.startsWith('honeycomb') && l.depthAxis === 'H').map((l) => l.perLayer));
  assert.ok(hc > grid, `стільники ${hc} vs сітка ${grid}`);
});

test('щільні стільники: зміщені ряди коротші на одну комірку', () => {
  const L = generateLayout({ S: 3, P: 7, rows: 3, arrangement: 'honeycomb2', snake: 'cols', gap: 0, cell: c18650 });
  assert.equal(L.dense, true);
  assert.equal(L.cols, 8); // 8 + 7 + 8 = 23 >= 21
  assert.ok(Math.abs(L.width - 8 * c18650.d) < 1e-9);
  assert.equal(L.cells.filter((c) => c.row === 1).length, 7);
});

test('вписування: обрана схема справді поміщається у площину корпусу', () => {
  const box = { L: 180, W: 120, H: 75 };
  const opt = { gap: 0.5, margin: 2, depthReserve: 4, allowLayers: false };
  const { configs } = bestConfigs(box, c18650, opt, [1, 16]);
  assert.ok(configs.length > 0);
  for (const c of configs) {
    const L = generateLayout({ S: c.S, P: c.P, rows: c.rows, arrangement: c.layout.arrangement, snake: 'cols', gap: opt.gap, cell: c18650 });
    assert.ok(L.width <= c.layout.planeA - 2 * opt.margin + 1e-6, `${c.S}S${c.P}P ширина ${L.width}`);
    assert.ok(L.height <= c.layout.planeB - 2 * opt.margin + 1e-6, `${c.S}S${c.P}P висота ${L.height}`);
  }
});

test('кілька шарів збільшують максимальний P', () => {
  const box = { L: 100, W: 60, H: 160 };
  const one = bestConfigs(box, c18650, { allowLayers: false }, [4, 4]).configs[0];
  const many = bestConfigs(box, c18650, { allowLayers: true }, [4, 4]).configs[0];
  assert.ok(many.P >= one.P);
});

test('chooseRows', () => {
  assert.equal(chooseRows(4, 3, 5, 5), 3);
  assert.equal(chooseRows(10, 4, 3, 20), 2);
  assert.equal(chooseRows(10, 4, 3, 10), null);
});

test('requiredBox', () => {
  const L = generateLayout({ S: 2, P: 1, rows: 1, arrangement: 'grid', snake: 'cols', gap: 0, cell: c18650 });
  const b = requiredBox(L, c18650, { margin: 1, depthReserve: 2 });
  assert.ok(Math.abs(b.a - (2 * 18.4 + 2)) < 1e-9);
  assert.ok(Math.abs(b.depth - (65.2 + 2 + 2)) < 1e-9);
});

test('нікелева стрічка 8×0.15 ≈ 5 А, мідь витримує більше', () => {
  const ni = stripCalc({ material: 'nickel', width: 8, thickness: 0.15 });
  assert.ok(ni.ampacity > 4.8 && ni.ampacity < 5.2, String(ni.ampacity));
  const cu = stripCalc({ material: 'copper', width: 8, thickness: 0.15 });
  assert.ok(cu.ampacity > ni.ampacity * 1.8);
  const two = stripCalc({ material: 'nickel', width: 8, thickness: 0.15, layers: 2, current: 7 });
  assert.ok(two.ampacity > ni.ampacity);
  assert.equal(two.layersNeeded, 2);
});

test('дріт: рекомендація відповідає струму та падінню', () => {
  const r = wireCalc({ current: 30, length: 0.5, voltage: 36, maxDropPct: 2 });
  assert.ok(r.recommended);
  assert.ok(r.recommended.amps >= 30);
  assert.ok(r.recommended.dropPct <= 2);
});

test('підбір конфігурації 36 В 10 А·год 20 А на 21700 50E', () => {
  const r = sizePack(c21700, { voltage: 36, mode: 'nearest', ah: 10, current: 20 });
  assert.equal(r.S, 10);
  assert.equal(r.P, 3); // 20/9.8 → 3 перевищує 10/5 → 2
  const m = sizePack(c21700, { voltage: 42, mode: 'max' });
  assert.equal(m.S, 10);
});

test('час роботи', () => {
  const r = runtimeCalc({ wh: 360, ah: 10, vNom: 36, loadW: 100, efficiency: 100, dod: 100 });
  assert.ok(Math.abs(r.hours - 3.6) < 1e-9);
});

test('розбір списку комірок', () => {
  const l = parseCellList('3400\n3450 21\nA7 3300 25\n\n3500;20');
  assert.equal(l.length, 4);
  assert.equal(l[1].cap, 3450);
  assert.equal(l[1].ir, 21);
  assert.equal(l[2].label, 'A7');
  assert.equal(l[2].cap, 3300);
  assert.equal(l[3].ir, 20);
});

test('балансування: рівні групи та збереження комірок', () => {
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const list = Array.from({ length: 42 }, (_, i) => ({ label: `c${i}`, cap: Math.round(3000 + rnd() * 400) }));
  const r = balanceCells(list, 10, 4);
  assert.equal(r.groups.length, 10);
  assert.ok(r.groups.every((g) => g.cells.length === 4));
  assert.equal(r.unused.length, 2);
  const labels = new Set(r.groups.flatMap((g) => g.cells.map((c) => c.label)));
  assert.equal(labels.size, 40);
  assert.ok(r.rangePct < 1, `розкид ${r.rangePct}%`);
  assert.throws(() => balanceCells(list.slice(0, 5), 3, 2));
});

test('SVG генерується для циліндричних і призматичних', () => {
  const L = generateLayout({ S: 3, P: 2, rows: 2, arrangement: 'honeycomb', snake: 'cols', gap: 0.5, cell: c18650 });
  const s = renderPackSVG(L, { mirrorBottom: true, title: 'test <&>' });
  assert.ok(s.startsWith('<svg'));
  assert.ok(s.includes('B3 P+'));
  assert.ok(s.includes('test &lt;&amp;&gt;'));
  const P = generateLayout({ S: 4, P: 1, rows: 1, arrangement: 'grid', snake: 'cols', gap: 1, cell: prism });
  assert.ok(renderPackSVG(P).includes('B4 P+'));
  const f = renderFitSVG({ planeA: 100, planeB: 60, margin: 2, aAxis: 'L', bAxis: 'W', layout: L, layers: 1, depth: 70, cellLen: 65 });
  assert.ok(f.includes('L = 100'));
  assert.ok(!/NaN|undefined/.test(s + f));
});

test('призматичні в один ряд: лише сусідні комірки з’єднані', () => {
  const L = generateLayout({ S: 8, P: 2, rows: 1, arrangement: 'grid', snake: 'cols', gap: 0.5, cell: prism });
  for (let j = 1; j < 8; j++) assert.equal(L.buses[j].seriesLinks, 1);
  assert.equal(L.buses[1].links.length, 3);
});
