import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CELLS, validateCell } from '../js/cells.js';
import { generateLayout, packStats } from '../js/layout.js';
import { fitLayouts, bestConfigs, checkConfig, chooseRows, countAlong, requiredBox } from '../js/fit.js';
import { stripCalc, wireCalc, sizePack, parseCellList, balanceCells, runtimeCalc } from '../js/tools.js';
import { renderPackSVG, renderFitSVG } from '../js/render.js';
import { analyzeCurrents } from '../js/analysis.js';
import { bmsPlan, protectionProfile, wireColor } from '../js/bms.js';
import { renderBmsSVG } from '../js/schematic.js';
import { buildScene3D } from '../js/scene3d.js';

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
  for (const snake of ['cols', 'rows', 'u'])
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

const strip = { material: 'nickel', width: 8, thickness: 0.15, layers: 1 };

test('U-подібна змійка: P+ і P− з одного боку пакета', () => {
  const L = generateLayout({ S: 10, P: 4, rows: 8, arrangement: 'grid', snake: 'u', gap: 0.5, cell: c21700 });
  assert.equal(L.snake, 'u');
  assert.deepEqual(L.warnings, []);
  const g0 = L.cells.filter((c) => c.group === 0), gLast = L.cells.filter((c) => c.group === 9);
  assert.ok(g0.every((c) => c.col === 0));
  assert.ok(gLast.every((c) => c.col === 0));
  assert.ok(g0.every((c) => c.row < 4) && gLast.every((c) => c.row >= 4));
});

test('точки підключення: балансувальні дроти біля BMS, силові — за вибором', () => {
  const base = { S: 6, P: 3, rows: 3, arrangement: 'grid', snake: 'cols', gap: 0.5, cell: c18650 };
  const R = generateLayout({ ...base, bmsSide: 'right' });
  const Lf = generateLayout({ ...base, bmsSide: 'left' });
  for (const b of R.buses) {
    const tap = R.cells[b.tap];
    assert.ok(b.members.includes(b.tap));
    // жодна комірка шини не ближча до правого краю
    assert.ok(b.members.every((id) => R.cells[id].x <= tap.x + 1e-9));
  }
  assert.ok(Lf.buses.every((b) => b.members.every((id) => Lf.cells[id].x >= Lf.cells[b.tap].x - 1e-9)));
  const C = generateLayout({ ...base, leadAttach: 'center' });
  assert.equal(C.cells[C.buses[0].power].row, 1); // середній ряд групи 1
  assert.equal(C.buses[0].tap, C.buses[0].power);
  assert.equal(C.buses[3].power, null);
});

test('аналіз струмів: 3S1P — кожна комірка несе весь струм', () => {
  const L = generateLayout({ S: 3, P: 1, rows: 1, arrangement: 'grid', snake: 'cols', gap: 0.5, cell: c18650 });
  const a = analyzeCurrents(L, c18650, { load: 5, strip });
  assert.ok(a.ok);
  for (const v of a.cellI) assert.ok(Math.abs(v - 5) < 1e-6, String(v));
  // спад = 3 комірки × r + 2 перемички
  assert.ok(a.drop > 3 * 5 * 0.025 && a.drop < 3 * 5 * 0.025 + 0.05);
});

test('аналіз струмів: сума струмів кожної групи дорівнює навантаженню', () => {
  for (const snake of ['cols', 'u']) {
    const L = generateLayout({ S: 10, P: 4, rows: snake === 'u' ? 8 : 4, arrangement: 'grid', snake, gap: 0.5, cell: c21700 });
    const a = analyzeCurrents(L, c21700, { load: 20, strip });
    assert.ok(a.ok);
    for (let g = 0; g < 10; g++) {
      const sum = L.cells.filter((c) => c.group === g).reduce((s, c) => s + a.cellI[c.id], 0);
      assert.ok(Math.abs(sum - 20) < 1e-6, `${snake} група ${g + 1}: ${sum}`);
    }
    assert.ok(a.cellI.every((v) => v > 0));
    assert.ok(a.maxLink.I > 0 && a.maxLink.I <= 20 + 1e-6);
  }
});

test('аналіз струмів: вивід у центрі групи зменшує розбаланс', () => {
  const base = { S: 4, P: 7, rows: 7, arrangement: 'grid', snake: 'cols', gap: 0.5, cell: c18650, bmsSide: 'top' };
  const near = analyzeCurrents(generateLayout({ ...base, leadAttach: 'near' }), c18650, { load: 30, strip });
  const center = analyzeCurrents(generateLayout({ ...base, leadAttach: 'center' }), c18650, { load: 30, strip });
  assert.ok(center.worstGroup.imbalance < near.worstGroup.imbalance, `${center.worstGroup.imbalance} vs ${near.worstGroup.imbalance}`);
  // мідь розподіляє струм рівномірніше за нікель
  const cu = analyzeCurrents(generateLayout({ ...base, leadAttach: 'near' }), c18650, { load: 30, strip: { ...strip, material: 'copper' } });
  assert.ok(cu.worstGroup.imbalance < near.worstGroup.imbalance);
});

test('аналіз без навантаження не виконується', () => {
  const L = generateLayout({ S: 2, P: 2, rows: 2, arrangement: 'grid', snake: 'cols', gap: 0.5, cell: c18650 });
  assert.equal(analyzeCurrents(L, c18650, { load: 0, strip }).ok, false);
});

test('профіль захисту залежить від хімії', () => {
  const li = protectionProfile(c21700);
  assert.equal(li.charge, 4.2);
  assert.ok(li.ovp > li.charge && li.uvp < li.uvpr);
  const lfp = protectionProfile(prism);
  assert.ok(lfp.charge <= 3.65 && lfp.ovp <= 3.7);
  const unknown = protectionProfile({ ...c18650, chem: 'Інше' });
  assert.equal(unknown.known, false);
});

test('план BMS: дроти, запобіжник, перевірки', () => {
  const L = generateLayout({ S: 10, P: 4, rows: 4, arrangement: 'grid', snake: 'cols', gap: 0.5, cell: c21700 });
  const plan = bmsPlan(c21700, L, { type: 'hardware', port: 'common', ntc: 1, sw: true }, 20);
  assert.equal(plan.wires.length, 11);
  assert.equal(plan.wires[0].color, wireColor(0));
  assert.ok(Math.abs(plan.wires[10].vNom - 36) < 1e-9);
  assert.ok(plan.bmsCurrent >= 25);
  assert.ok(plan.fuse >= 25);
  assert.ok(plan.power.recommended.amps >= plan.fuse);
  assert.ok(Math.abs(plan.pack.charge - 42) < 1e-9);
  assert.ok(plan.checks.some((c) => c.level === 'ok'));
  assert.ok(!plan.checks.some((c) => c.level === 'bad'));
  // замала BMS і зайві канали апаратної BMS — помилки
  const bad = bmsPlan(c21700, L, { type: 'hardware', port: 'common', channels: 13, current: 10 }, 20);
  assert.ok(bad.checks.filter((c) => c.level === 'bad').length >= 2);
  const smart = bmsPlan(c21700, L, { type: 'smart', port: 'separate', channels: 16, ntc: 2 }, 20);
  assert.equal(smart.unused, 6);
  assert.ok(smart.checks.some((c) => c.level === 'warn' && c.text.includes('B11')));
});

test('SVG схеми BMS та фізичної схеми з аналізом', () => {
  const L = generateLayout({ S: 13, P: 4, rows: 8, arrangement: 'grid', snake: 'u', gap: 0.5, cell: c21700, bmsSide: 'left', leadAttach: 'center' });
  for (const [type, port, channels] of [['hardware', 'common', 0], ['smart', 'separate', 16]]) {
    const plan = bmsPlan(c21700, L, { type, port, channels, ntc: 2, sw: true, precharge: true }, 30);
    const svg = renderBmsSVG(plan, c21700, 30);
    assert.ok(svg.startsWith('<svg') && svg.includes('B13') && svg.includes('Запобіжник'));
    assert.ok(!/NaN|undefined|Infinity/.test(svg));
    if (port === 'separate') assert.ok(svg.includes('C−'));
  }
  const a = analyzeCurrents(L, c21700, { load: 30, strip });
  const pack = renderPackSVG(L, { mode: 'wiring', analysis: a, mirrorBottom: true });
  assert.ok(pack.includes('BMS') && pack.includes('P+') && pack.includes('<title>'));
  assert.ok(!/NaN|undefined|Infinity/.test(pack));
  const pr = generateLayout({ S: 8, P: 2, rows: 1, arrangement: 'grid', snake: 'cols', gap: 1, cell: prism, bmsSide: 'bottom' });
  for (const mode of ['scheme', 'assembly', 'currents', 'wiring'])
    assert.ok(!/NaN|undefined/.test(renderPackSVG(pr, { mode, analysis: analyzeCurrents(pr, prism, { load: 100, strip }) })), mode);
});

test('режими 2D-схеми показують лише потрібне', () => {
  const L = generateLayout({ S: 6, P: 3, rows: 3, arrangement: 'grid', snake: 'cols', gap: 0.5, cell: c18650 });
  const a = analyzeCurrents(L, c18650, { load: 15, strip });
  const scheme = renderPackSVG(L, { mode: 'scheme', analysis: a });
  assert.ok(scheme.includes('Схема з') && scheme.includes('marker-end') && scheme.includes('P−') && scheme.includes('P+'));
  assert.ok(!scheme.includes('Вигляд знизу') && !scheme.includes('BMS'));
  // 5 переходів між групами (+ відрізки P−→1 і 6→P+, якщо вивід не в центрі групи)
  assert.ok((scheme.match(/marker-end/g) || []).length >= 5);
  const asm = renderPackSVG(L, { mode: 'assembly', mirrorBottom: true });
  assert.ok(asm.includes('Вигляд зверху') && asm.includes('Вигляд знизу') && !asm.includes('>BMS<'));
  const cells = renderPackSVG(L, { mode: 'assembly', step: 'cells' });
  assert.ok(cells.includes('Крок 1') && !cells.includes('Вигляд знизу') && !cells.includes('перемичка B'));
  const top = renderPackSVG(L, { mode: 'assembly', step: 'top' });
  assert.ok(top.includes('Крок 2') && top.includes('B1') && !top.includes('B0 P−'));
  const bottom = renderPackSVG(L, { mode: 'assembly', step: 'bottom', mirrorBottom: true });
  assert.ok(bottom.includes('Крок 3') && bottom.includes('B0 P−'));
  const cur = renderPackSVG(L, { mode: 'currents', analysis: a });
  assert.ok(cur.includes('5А') || cur.includes('5,'));
  assert.ok(cur.includes('допустимого'));
  const wir = renderPackSVG(L, { mode: 'wiring' });
  assert.ok(wir.includes('>BMS<') && wir.includes('Балансувальний дріт B3'));
  for (const s of [scheme, asm, cells, top, bottom, cur, wir]) assert.ok(!/NaN|undefined|Infinity/.test(s));
});

test('стик груп в одну комірку підсилюється другою перемичкою', () => {
  const L = generateLayout({ S: 13, P: 4, rows: 8, arrangement: 'grid', snake: 'u', gap: 0.5, cell: c21700 });
  assert.ok(L.jumperNotes.some((n) => n.includes('лише однією коміркою')));
  assert.ok(L.buses.slice(1, 13).every((b) => b.seriesLinks >= 2));
  assert.ok(!renderPackSVG(L, { mode: 'scheme' }).includes('1 контакт!'));
  // для P < 3 підсилення не додається — схема лише попереджає
  const L2 = generateLayout({ S: 7, P: 2, rows: 4, arrangement: 'grid', snake: 'u', gap: 0.5, cell: c21700 });
  if (L2.buses.slice(1, 7).some((b) => b.seriesLinks === 1)) assert.ok(renderPackSVG(L2, { mode: 'scheme' }).includes('1 контакт!'));
  const ok = generateLayout({ S: 10, P: 4, rows: 4, arrangement: 'grid', snake: 'cols', gap: 0.5, cell: c21700 });
  assert.ok(!renderPackSVG(ok, { mode: 'scheme' }).includes('1 контакт!'));
});

test('3D-сцена: комірки, перемички, дроти, розліт і межі', () => {
  const L = generateLayout({ S: 10, P: 4, rows: 4, arrangement: 'grid', snake: 'cols', gap: 0.5, cell: c21700, bmsSide: 'right' });
  const a = analyzeCurrents(L, c21700, { load: 20, strip });
  const sc = buildScene3D(L, c21700, { strip, analysis: a, stripColor: 'current', enclosure: true });
  const kinds = (k) => sc.items.filter((i) => i.kind === k);
  assert.equal(kinds('cell').length, 40);
  assert.equal(kinds('strip').length, L.linkCount);
  assert.equal(kinds('wire').length, 11 + 2); // B0…B10 + P−/P+
  assert.equal(kinds('bms').length, 1);
  assert.equal(kinds('label').length, 10 + 2);
  assert.equal(kinds('enclosure').length, 1);
  assert.ok(kinds('strip').every((s) => s.current != null && /^#/.test(s.color)));
  // пакет відцентровано, верхні перемички над комірками, нижні — під ними
  const xs = kinds('cell').map((c) => c.x);
  assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs)) < 1e-6);
  assert.ok(kinds('strip').filter((s) => s.side === 'top').every((s) => s.y > c21700.h));
  assert.ok(kinds('strip').filter((s) => s.side === 'bottom').every((s) => s.y < 0));
  // BMS праворуч від пакета
  assert.ok(kinds('bms')[0].x > L.width / 2);
  const ex = buildScene3D(L, c21700, { strip, explode: 1, wires: false, labels: false });
  const topY = (sc2) => Math.max(...sc2.items.filter((i) => i.kind === 'strip').map((s) => s.y));
  assert.ok(topY(ex) > topY(sc) + c21700.h * 0.3);
  assert.equal(ex.items.filter((i) => i.kind === 'wire' || i.kind === 'bms' || i.kind === 'label').length, 0);
  const all = JSON.stringify(sc);
  assert.ok(!/null,null|NaN|Infinity/.test(all));
  for (const v of [...sc.bounds.min, ...sc.bounds.max]) assert.ok(Number.isFinite(v));
});

test('3D-сцена для призматичних комірок', () => {
  const L = generateLayout({ S: 8, P: 2, rows: 2, arrangement: 'grid', snake: 'cols', gap: 1, cell: prism, bmsSide: 'top' });
  const sc = buildScene3D(L, prism, { strip });
  assert.equal(sc.terminals.length, 16);
  assert.ok(sc.items.filter((i) => i.kind === 'strip').every((s) => s.y > prism.h));
  assert.ok(sc.items.some((i) => i.kind === 'wire' && i.radius === 3)); // кабель між рядами
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(sc)));
});

// ------------------------------------------------------------------ комутація
import { harnessRoutes, routeConflicts, stripRuns, cutList, stripClearance, segmentDistance } from '../js/routing.js';
import { renderBmsSchematic } from '../js/schematic.js';

test('дроти BMS не перетинаються: перебір розкладок, змійок і сторін', () => {
  let checked = 0, clean = 0;
  for (const arrangement of ['grid', 'honeycomb', 'honeycomb2'])
    for (const snake of ['cols', 'rows', 'u'])
      for (const [S, P, rows] of [[4, 3, 3], [7, 3, 3], [10, 4, 4], [13, 4, 8], [14, 5, 5], [3, 5, 4], [16, 2, 4], [20, 6, 6]])
        for (const bmsSide of ['auto', 'right', 'left', 'top', 'bottom'])
          for (const leadAttach of ['near', 'center']) {
            const L = generateLayout({ S, P, rows, arrangement, snake, gap: 0.5, cell: c18650, bmsSide, leadAttach });
            const c = routeConflicts(harnessRoutes(L, { gap: 15, thick: 4 }).routes);
            const tag = `${arrangement}/${snake} ${S}S${P}P BMS:${bmsSide}→${L.bmsSide} ${leadAttach} (${L.harness.quality})`;
            if (L.harness.quality !== 'crossing') assert.equal(c.crossings.length, 0, `${tag}: ${JSON.stringify(c.crossings)}`);
            if (L.harness.quality === 'clean') { assert.equal(c.overlaps.length, 0, tag); clean++; }
            if (bmsSide === 'auto') {
              // автовибір бере найкращу сторону
              const qs = Object.values(L.harness.alternatives).map((a) => a.quality);
              if (qs.includes('clean')) assert.equal(L.harness.quality, 'clean', tag);
              assert.notEqual(L.harness.quality, 'crossing', tag);
            }
            checked++;
          }
  assert.ok(checked > 600 && clean > 0, `${clean}/${checked}`);
});

test('дроти: B0 і P− виходять з однієї точки, порядок пінів відповідає порядку точок', () => {
  const L = generateLayout({ S: 10, P: 4, rows: 4, arrangement: 'grid', snake: 'cols', gap: 0.5, cell: c21700, bmsSide: 'bottom' });
  assert.equal(L.harness.quality, 'clean');
  const H = harnessRoutes(L, { gap: 15, thick: 4 });
  const r = Object.fromEntries(H.routes.map((x) => [x.name, x]));
  assert.deepEqual(r['P−'].points[0], r.B0.points[0]);
  assert.deepEqual(r['P+'].points[0], r.B10.points[0]);
  // уздовж краю (вісь x для нижнього краю) точки підключення йдуть у порядку пінів
  for (const surf of ['top', 'bottom']) {
    const seq = H.routes.filter((x) => x.kind === 'balance' && x.surface === surf).sort((a, b) => a.k - b.k);
    for (let i = 1; i < seq.length; i++) {
      assert.ok(H.dir * (seq[i].points[0][0] - seq[i - 1].points[0][0]) > 0);
      assert.ok(H.dir * (seq[i].points[2][0] - seq[i - 1].points[2][0]) > 0);
    }
  }
  // уся траса — поза перемичками інших шин: дріт іде перпендикулярно до краю, далі віялом
  assert.ok(H.routes.every((x) => x.points.length === 3));
});

test('стрічка: суцільні відрізки замість окремих перемичок, зазори між шинами', () => {
  const L = generateLayout({ S: 10, P: 4, rows: 4, arrangement: 'grid', snake: 'cols', gap: 0.5, cell: c21700 });
  const runs = stripRuns(L);
  assert.ok(runs.length < L.linkCount);
  assert.equal(runs.reduce((s, r) => s + r.links, 0), L.linkCount);
  const totalLinks = L.buses.reduce((s, b) => s + b.links.reduce((t, l) => t + l.len, 0), 0);
  assert.ok(Math.abs(runs.reduce((s, r) => s + r.len, 0) - totalLinks) < 1e-6);
  // у класичному розташуванні кожна група — один вертикальний відрізок на кожній стороні
  assert.equal(runs.filter((r) => Math.abs(r.a[0] - r.b[0]) < 1e-6 && r.len > L.pitchY * 2.5).length, 10 * 2 - 2 + 2);
  const cl = cutList(runs, 4);
  assert.equal(cl.pieces, runs.length);
  assert.ok(cl.total > totalLinks);
  const ok = stripClearance(L, 8, 1);
  assert.equal(ok.violations.length, 0);
  assert.ok(ok.minGap > 10);
  // надто широка стрічка — оголені шини різних потенціалів майже торкаються
  const bad = stripClearance(generateLayout({ S: 6, P: 3, rows: 3, arrangement: 'honeycomb', snake: 'cols', gap: 0.2, cell: c18650 }), 17.5, 1);
  assert.ok(bad.violations.some((v) => v.kind === 'strips'));
  for (const arrangement of ['grid', 'honeycomb', 'honeycomb2'])
    for (const snake of ['cols', 'rows', 'u']) {
      const X = generateLayout({ S: 13, P: 4, rows: 4, arrangement, snake, gap: 0.5, cell: c18650 });
      assert.equal(stripClearance(X, 8, 1).violations.length, 0, `${arrangement}/${snake}`);
    }
});

test('електрична схема BMS: провідники різних мереж ніде не перетинаються і не торкаються', () => {
  for (const [S, P, cfg] of [
    [4, 1, { type: 'hardware', port: 'common', ntc: 1, sw: true }],
    [10, 4, { type: 'hardware', port: 'separate', ntc: 2, sw: true, precharge: true }],
    [13, 4, { type: 'smart', port: 'common', channels: 16, ntc: 3, sw: false }],
    [16, 2, { type: 'smart', port: 'separate', channels: 24, ntc: 0, sw: true, precharge: true }],
    [1, 2, { type: 'hardware', port: 'common', ntc: 1, sw: false }],
  ]) {
    const L = generateLayout({ S, P, rows: P, arrangement: 'grid', snake: 'cols', gap: 0.5, cell: c21700 });
    const plan = bmsPlan(c21700, L, cfg, 20);
    const { svg, nets } = renderBmsSchematic(plan, c21700, 20);
    assert.ok(!/NaN|undefined/.test(svg));
    const segs = nets.flatMap((n) => n.pts.slice(1).map((p, i) => ({ net: n.net, a: n.pts[i], b: p })));
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 1; j < segs.length; j++) {
        if (segs[i].net === segs[j].net) continue;
        const d = segmentDistance(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
        assert.ok(d > 0.5, `${S}S ${cfg.port}: ${segs[i].net} × ${segs[j].net} (${d.toFixed(2)})`);
      }
    if (cfg.port === 'separate') assert.ok(nets.some((n) => n.net === 'C−'));
  }
});

test('3D: дроти — ламані за тими ж трасами, що й у 2D', () => {
  const L = generateLayout({ S: 10, P: 4, rows: 4, arrangement: 'grid', snake: 'cols', gap: 0.5, cell: c21700, bmsSide: 'top' });
  const sc = buildScene3D(L, c21700, { strip });
  const wires = sc.items.filter((i) => i.kind === 'wire');
  assert.equal(wires.length, 13);
  assert.ok(wires.every((w) => w.polyline && w.points.length === 4));
  // дроти зверху підходять до роз'єму згори, знизу — знизу
  const top = wires.filter((w) => w.points[0][1] > c21700.h), bottom = wires.filter((w) => w.points[0][1] < 0);
  assert.ok(top.length && bottom.length);
  assert.ok(Math.min(...top.map((w) => w.points[3][1])) > Math.max(...bottom.map((w) => w.points[3][1])));
});

// ------------------------------------------------------------------ пресети, форми, яруси, перемички
import { PRESETS } from '../js/presets.js';
import { shapeOutline, parsePolygon, fitPolygon, bestConfigsShape, circleInPolygon, polygonArea } from '../js/fit.js';

const cellById = (id) => BUILTIN_CELLS.find((c) => c.id === id);

test('пресети: існуючі комірки, коректна розкладка, дроти без перетинів', () => {
  assert.ok(PRESETS.length >= 10);
  for (const p of PRESETS) {
    const cell = cellById(p.cell);
    assert.ok(cell, `${p.id}: комірка ${p.cell}`);
    let slots = null, outline = null;
    if (p.shape) {
      outline = shapeOutline(p.shape);
      const v = fitPolygon(outline, cell, { gap: 0.5, margin: 2 })[0];
      assert.ok(v.count >= p.S * p.P, `${p.id}: у форму вміщується ${v.count}`);
      slots = v.slots;
    }
    const L = generateLayout({ S: p.S, P: p.P, rows: p.rows, arrangement: p.arrangement || 'grid', snake: p.snake || 'cols', gap: 0.5, cell, leadAttach: p.lead, slots, outline });
    assert.deepEqual(L.warnings, [], p.id);
    const c = routeConflicts(harnessRoutes(L, { gap: 15, thick: 4 }).routes);
    assert.equal(c.crossings.length, 0, `${p.id}: перетини ${JSON.stringify(c.crossings)}`);
    const a = analyzeCurrents(L, cell, { load: p.load, strip: p.strip || strip, seriesStrip: p.ser && !p.ser.same ? p.ser : null });
    assert.ok(a.ok, p.id);
    for (let g = 0; g < p.S; g++) {
      const sum = L.cells.filter((x) => x.group === g).reduce((s, x) => s + a.cellI[x.id], 0);
      assert.ok(Math.abs(sum - p.load) < 1e-6, `${p.id} група ${g + 1}`);
    }
  }
});

test('LiFePO4 48 В: підбір дає 16S; призматичні 2×8 — розвернутий ряд, шини без конфліктів, дроти каналом', () => {
  const lf = cellById('eve-lf280k');
  assert.equal(sizePack(lf, { voltage: 48, mode: 'nearest' }).S, 16);
  assert.equal(sizePack(lf, { voltage: 24, mode: 'nearest' }).S, 8);
  assert.equal(sizePack(lf, { voltage: 12, mode: 'nearest' }).S, 4);
  const L = generateLayout({ S: 16, P: 1, rows: 2, snake: 'u', arrangement: 'grid', gap: 1, cell: lf });
  assert.ok(L.cells.filter((c) => c.row === 1).every((c) => c.flip) && L.cells.filter((c) => c.row === 0).every((c) => !c.flip));
  assert.equal(stripClearance(L, Math.min(lf.t, lf.w) * 0.3, 1).violations.length, 0);
  assert.equal(L.harness.mode, 'channel');
  const c = routeConflicts(harnessRoutes(L, { gap: 15, thick: 4 }).routes);
  assert.equal(c.crossings.length + c.overlaps.length, 0);
});

test('окремі послідовні перемички та мідна збірна шина зменшують навантаження і розбаланс', () => {
  const c = cellById('samsung-40t');
  const ni = { material: 'nickel', width: 10, thickness: 0.2, layers: 1 };
  const cu = { material: 'copper', width: 10, thickness: 0.3, layers: 1 };
  const near = generateLayout({ S: 20, P: 8, rows: 8, cell: c, gap: 0.5, leadAttach: 'near' });
  const col = generateLayout({ S: 20, P: 8, rows: 8, cell: c, gap: 0.5, leadAttach: 'collector' });
  assert.ok(col.buses[0].collector.length === 7 && col.buses[20].collector.length === 7);
  assert.ok(!near.buses[0].collector);
  const aNear = analyzeCurrents(near, c, { load: 100, strip: ni, seriesStrip: cu });
  const aCol = analyzeCurrents(col, c, { load: 100, strip: ni, seriesStrip: cu });
  assert.ok(aCol.worstGroup.imbalance < aNear.worstGroup.imbalance / 3, `${aCol.worstGroup.imbalance} vs ${aNear.worstGroup.imbalance}`);
  const aNi = analyzeCurrents(col, c, { load: 100, strip: ni });
  assert.ok(aCol.maxLinkRatio < aNi.maxLinkRatio);
  assert.ok(aCol.seriesAmpacity > aCol.ampacity);
  // нарізка окремо для послідовних і паралельних
  const all = stripRuns(col), par = stripRuns(col, 'parallel'), ser = stripRuns(col, 'series');
  assert.equal(par.reduce((s, r) => s + r.links, 0) + ser.reduce((s, r) => s + r.links, 0), all.reduce((s, r) => s + r.links, 0));
  assert.ok(ser.every((r) => r.series) && par.every((r) => !r.series));
});

test('вписування у трикутник: усі комірки всередині з відступом, стільники щільніші', () => {
  const c = cellById('samsung-35e');
  const tri = shapeOutline({ type: 'triangle', a: 450, b: 300, x: 380 });
  assert.equal(polygonArea(tri), 450 * 300 / 2);
  const vs = fitPolygon(tri, c, { gap: 0.5, margin: 2 });
  assert.equal(vs[0].arrangement, 'honeycomb');
  for (const v of vs) for (const s of v.slots) assert.ok(circleInPolygon([s.x, s.y], c.d / 2 + 2 - 1e-6, tri));
  // щільність не перевищує теоретичну для кіл (π/(2√3) ≈ 0,907)
  assert.ok(vs[0].count * Math.PI * (c.d / 2) ** 2 / polygonArea(tri) < 0.907);
  assert.ok(vs[0].count > 150);
  const { configs } = bestConfigsShape({ outline: tri, depth: 80 }, c, {}, [13, 14]);
  assert.equal(configs.find((x) => x.S === 14).P, 13);
  assert.equal(bestConfigsShape({ outline: tri, depth: 60 }, c, {}, [14, 14]).configs.length, 0); // 65 мм не вміщується в 60
  assert.deepEqual(parsePolygon('0,0\n100, 0\n100 50\nx\n0 50'), [[0, 0], [100, 0], [100, 50], [0, 50]]);
  assert.ok(shapeOutline({ type: 'trapezoid', a: 400, c: 250, b: 200, x: 100 }).length === 4);
});

test('розкладка у формі: групи суцільні, комірки у контурі, дроти без перетинів', () => {
  const c = cellById('samsung-35e');
  const tri = shapeOutline({ type: 'triangle', a: 450, b: 300, x: 380 });
  const v = fitPolygon(tri, c, { gap: 0.5, margin: 2 })[0];
  for (const [S, P] of [[14, 6], [13, 7], [14, 13], [10, 18], [20, 9]]) {
    const L = generateLayout({ S, P, cell: c, gap: 0.5, slots: v.slots, outline: tri });
    assert.ok(L.custom && L.outline.length === 3);
    assert.equal(L.cells.length, S * P);
    for (const cc of L.cells) assert.ok(circleInPolygon([cc.x, cc.y], c.d / 2, L.outline), `${S}S${P}P комірка поза формою`);
    for (const b of L.buses) assert.ok(b.connected);
    assert.ok(L.buses.slice(1, S).every((b) => b.seriesLinks >= 1));
    const cf = routeConflicts(harnessRoutes(L, { gap: 15, thick: 4 }).routes);
    if (L.harness.quality !== 'crossing') assert.equal(cf.crossings.length, 0, `${S}S${P}P`);
    assert.ok(analyzeCurrents(L, c, { load: 30, strip }).ok);
  }
  // замало місць — звичайна розкладка з попередженням
  const tiny = generateLayout({ S: 20, P: 20, cell: c, gap: 0.5, slots: v.slots, outline: tri });
  assert.ok(!tiny.custom && tiny.warnings.length === 1);
});

test('дроти-перемички: розрізнені частини форми з\'єднуються автоматично', () => {
  const c = cellById('18650-generic');
  // два острівці по 6 місць, далеко один від одного
  const p = c.d + 0.5;
  const slots = [];
  for (let i = 0; i < 6; i++) slots.push({ x: 20 + i * p, y: 20, row: 0, col: i });
  for (let i = 0; i < 6; i++) slots.push({ x: 20 + i * p, y: 120, row: 5, col: i });
  const L = generateLayout({ S: 4, P: 3, cell: c, gap: 0.5, slots });
  assert.ok(L.jumperCount >= 1);
  assert.ok(L.jumperNotes.length >= 1);
  for (const b of L.buses) assert.ok(b.connected);
  const a = analyzeCurrents(L, c, { load: 10, strip, jumperArea: 2.08 });
  assert.ok(a.ok);
  for (let g = 0; g < 4; g++) assert.ok(Math.abs(L.cells.filter((x) => x.group === g).reduce((s, x) => s + a.cellI[x.id], 0) - 10) < 1e-6);
  // перемички — не стрічка: не в нарізці і не в перевірці зазорів
  assert.equal(stripRuns(L).reduce((s, r) => s + r.links, 0), L.linkCount);
  const svg = renderPackSVG(L, { mode: 'assembly' });
  assert.ok(svg.includes('Дріт-перемичка') && !/NaN|undefined/.test(svg));
});

test('яруси: групи діляться, міжярусна перемичка, корпус і 3D стеком', () => {
  const c = cellById('molicel-p42a');
  const L = generateLayout({ S: 12, P: 4, rows: 2, cell: c, gap: 0.5, layers: 2 });
  assert.equal(L.layers, 2);
  assert.equal(L.groupsPerLayer, 6);
  assert.ok(L.cells.filter((x) => x.layer === 0).every((x) => x.group < 6));
  assert.ok(L.cells.filter((x) => x.layer === 1).every((x) => x.group >= 6));
  const inter = L.buses[6].links.filter((l) => l.crossLayer);
  assert.ok(inter.length >= 1 && inter.every((l) => l.jumper && l.len >= c.h));
  // перша група ярусу 2 — над останньою групою ярусу 1 (коротка перемичка)
  assert.ok(Math.min(...inter.map((l) => l.len)) < c.h + 4 + 2 * (c.d + 0.5));
  const box = requiredBox(L, c, { margin: 2, depthReserve: 4 });
  assert.ok(Math.abs(box.depth - (2 * c.h + 4 + 4 + 4)) < 1e-6);
  assert.ok(Math.abs(box.b - (L.layerHeight + 4)) < 1e-6);
  const a = analyzeCurrents(L, c, { load: 60, strip, seriesStrip: { material: 'copper', width: 10, thickness: 0.3, layers: 1 } });
  assert.ok(a.ok);
  for (let g = 0; g < 12; g++) assert.ok(Math.abs(L.cells.filter((x) => x.group === g).reduce((s, x) => s + a.cellI[x.id], 0) - 60) < 1e-6);
  const sc = buildScene3D(L, c, { strip, enclosure: true });
  const ys = [...new Set(sc.items.filter((i) => i.kind === 'cell').map((i) => Math.round(i.y0)))];
  assert.equal(ys.length, 2);
  assert.ok(Math.max(...ys) >= c.h);
  assert.ok(sc.items.some((i) => i.kind === 'wire' && i.jumper));
  const svg = renderPackSVG(L, { mode: 'assembly', mirrorBottom: true });
  assert.ok(svg.includes('Ярус 2') && !/NaN|undefined/.test(svg));
});

test('BMS: нейтральний текст про зайві балансувальні дроти', () => {
  const L = generateLayout({ S: 13, P: 4, rows: 4, cell: c21700, gap: 0.5 });
  const plan = bmsPlan(c21700, L, { type: 'smart', port: 'common', channels: 16 }, 20);
  const t = plan.checks.map((x) => x.text).join(' ');
  assert.ok(t.includes('залежить від моделі') && t.includes('не підключають'));
  assert.ok(plan.steps.join(' ').includes('перший пін'));
  const svg = renderBmsSVG(plan, c21700, 20);
  assert.ok(svg.includes('за схемою виробника'));
});
