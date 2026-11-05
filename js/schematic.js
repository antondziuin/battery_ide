// Електрична (принципова) схема підключення BMS: групи, балансувальні дроти, силове коло,
// запобіжник, вимикач, навантаження та зарядний порт.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (n) => (Math.round(n * 10) / 10).toString();
const num = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toString().replace('.', ',');

const C = { text: '#1d232b', muted: '#5b6672', plus: '#d93636', minus: '#1d232b', bms: '#2456c7', bmsBg: '#eef4ff', ntc: '#7a8591', bad: '#e03131' };

const line = (x1, y1, x2, y2, color, w = 1.5, extra = '') =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" ${extra}/>`;
const poly = (pts, color, w = 1.5, extra = '') =>
  `<polyline points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" ${extra}/>`;
const dot = (x, y, color = C.text, r = 3) => `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="${color}"/>`;
const text = (x, y, t, o = {}) =>
  `<text x="${f(x)}" y="${f(y)}" font-size="${o.size || 11}" ${o.anchor ? `text-anchor="${o.anchor}"` : ''} ${o.weight ? `font-weight="${o.weight}"` : ''} fill="${o.color || C.text}">${esc(t)}</text>`;

/**
 * @param {object} plan результат bmsPlan
 * @param {object} cell комірка
 * @param {number} load струм навантаження, А
 */
export function renderBmsSVG(plan, cell, load = 0) {
  return renderBmsSchematic(plan, cell, load).svg;
}

/**
 * Будує схему і повертає також список провідників за мережами (для перевірки перетинів).
 * @returns {{svg: string, nets: {net: string, pts: number[][]}[]}}
 */
export function renderBmsSchematic(plan, cell, load = 0) {
  const { S, P } = plan;
  const rowH = S <= 12 ? 48 : S <= 20 ? 38 : 30;
  const unusedN = Math.min(plan.unused, 8);
  const pinStep = 14;
  const unusedH = unusedN * pinStep;
  const yTop = 78;
  const yNode = (k) => yTop + 54 + unusedH + (S - k) * rowH;
  const y0 = yNode(0);
  const yS = yNode(S);

  const x0 = 96;
  const nSym = Math.min(P, 3);
  const packRight = x0 + 22 + nSym * 40 + (P > 3 ? 34 : 0);
  const xn = packRight + 14;
  const bmsX = xn + 190;
  const bmsW = 176;
  const bmsTop = yS - 30 - unusedH;
  const bmsBottom = y0 + 76;
  const outX = bmsX + bmsW + 150;
  const devW = 124, devH = 70;
  const xPp = outX - 40;                      // шина P+ (ліворуч від пристроїв)
  const xR1 = outX + devW + 30, xR2 = outX + devW + 60; // шини мінусів (праворуч від пристроїв)
  const awg = plan.power.recommended ? `${plan.power.recommended.awg} AWG` : '—';
  const chAwg = plan.chargeWire.recommended ? `${plan.chargeWire.recommended.awg} AWG` : '—';
  const separate = plan.port === 'separate';

  const nets = [];
  let s = '';
  /** провідник певної мережі: малюється і запам'ятовується для перевірки */
  const wire = (net, pts, color, w = 1.5, extra = '') => { nets.push({ net, pts }); s += poly(pts, color, w, extra); };
  const W = xR2 + 120;

  // ---------- групи
  for (let k = 1; k <= S; k++) {
    const yt = yNode(k), yb = yNode(k - 1), ym = (yt + yb) / 2;
    s += text(x0 - 10, ym + 4, `Група ${k}`, { anchor: 'end', size: 11, color: C.muted });
    for (let i = 0; i < nSym; i++) {
      const x = x0 + 32 + i * 40;
      s += line(x, yt, x, ym - 4, C.text) + line(x - 11, ym - 4, x + 11, ym - 4, C.text, 2.5) + line(x - 6, ym + 3, x + 6, ym + 3, C.text, 4) + line(x, ym + 3, x, yb, C.text);
      s += dot(x, yt, C.text, 2.2) + dot(x, yb, C.text, 2.2);
      if (i === 0) s += text(x + 13, ym - 6, '+', { size: 10, color: C.plus, weight: 700 });
    }
    if (P > 3) s += text(x0 + 32 + nSym * 40 - 8, ym + 4, `… ×${P}`, { size: 11, color: C.muted });
  }
  // вузли (шини груп) та балансувальні дроти — кожен на своєму рівні, паралельно
  for (const w of plan.wires) {
    const y = yNode(w.k);
    wire(`B${w.k}`, [[x0, y], [xn, y]], C.text, 2.2);
    wire(`B${w.k}`, [[xn, y], [bmsX, y]], w.color, 2, 'opacity="0.95"');
    s += dot(xn, y, w.color, 2.6);
    s += text(xn + 6, y - 4, w.name, { size: 11, weight: 700, color: w.color === '#1d232b' ? C.text : w.color });
    s += text(bmsX - (plan.unused ? 26 : 8), y - 4, `${num(w.vNom)} В`, { size: 10, anchor: 'end', color: C.muted });
  }

  // ---------- NTC: посередині між балансувальними дротами — без перетинів
  const ntcGroups = [];
  for (let i = 0; i < plan.ntc; i++) ntcGroups.push(Math.min(S, Math.max(1, Math.round(((i + 1) * S) / (plan.ntc + 1)) || 1)));
  ntcGroups.forEach((g, i) => {
    const ym = (yNode(g) + yNode(g - 1)) / 2 + (ntcGroups.indexOf(g) !== i ? 8 : 0);
    const xs = xn + 40;
    s += `<rect x="${f(xs - 9)}" y="${f(ym - 4)}" width="18" height="8" fill="#fff" stroke="${C.ntc}" stroke-width="1.3"/>`;
    s += line(xs - 11, ym + 7, xs + 11, ym - 7, C.ntc, 1.2);
    s += text(xs, ym - 8, `T${i + 1} · на комірки`, { size: 10, anchor: 'middle', color: C.ntc });
    wire(`NTC${i}`, [[xs + 9, ym], [bmsX, ym]], C.ntc, 1.2, 'stroke-dasharray="4 3"');
  });

  // ---------- BMS
  s += `<rect x="${f(bmsX)}" y="${f(bmsTop)}" width="${bmsW}" height="${f(bmsBottom - bmsTop)}" rx="8" fill="${C.bmsBg}" stroke="${C.bms}" stroke-width="2"/>`;
  for (const w of plan.wires) {
    const y = yNode(w.k);
    s += dot(bmsX, y, w.color, 3.5);
    s += text(bmsX + 8, y + 4, w.name, { size: 10, color: C.bms, weight: 600 });
  }
  if (plan.unused) {
    for (let i = 0; i < unusedN; i++) {
      const y = yS - (i + 1) * pinStep;
      s += dot(bmsX, y, '#adb5bd', 3);
      s += text(bmsX + 8, y + 4, `B${S + i + 1}`, { size: 9, color: '#868e96' });
      if (plan.type === 'smart') wire(`B${S}`, [[bmsX, y], [bmsX - 18, y], [bmsX - 18, yS]], '#868e96', 1.2, 'stroke-dasharray="3 2"');
      else s += line(bmsX - 6, y - 4, bmsX + 2, y + 4, C.bad, 1.5) + line(bmsX - 6, y + 4, bmsX + 2, y - 4, C.bad, 1.5);
    }
    if (plan.type === 'smart') s += dot(bmsX - 18, yS, '#868e96', 2.5);
    if (plan.unused > unusedN) s += text(bmsX + 8, yS - (unusedN + 1) * pinStep + 4, `… ще ${plan.unused - unusedN}`, { size: 9, color: '#868e96' });
  }
  const cx = bmsX + bmsW / 2 + 16;
  const cy = (bmsTop + bmsBottom) / 2 - 24;
  s += text(cx, cy, `BMS ${plan.channels}S`, { size: 16, weight: 800, anchor: 'middle', color: C.bms });
  s += text(cx, cy + 18, plan.type === 'smart' ? 'розумна' : 'апаратна', { size: 11, anchor: 'middle', color: C.bms });
  s += text(cx, cy + 34, `${plan.bmsCurrent} А тривало`, { size: 11, anchor: 'middle', color: C.bms });
  s += text(cx, cy + 50, separate ? 'роздільний порт' : 'спільний порт', { size: 11, anchor: 'middle', color: C.bms });
  if (plan.ntc) s += text(cx, cy + 66, `NTC × ${plan.ntc}`, { size: 11, anchor: 'middle', color: C.ntc });

  // силові клеми внизу BMS: B− ліворуч, далі P−, C−
  const tB = bmsX + 26, tP = bmsX + 76, tC = bmsX + 126;
  const term = (x, label, color) => dot(x, bmsBottom, color, 4.5) + text(x, bmsBottom - 9, label, { size: 11, weight: 700, anchor: 'middle', color });

  // ---------- пристрої: «+» на лівій грані, «−» на правій
  const loadTop = yTop + 36;
  const chTop = Math.max(bmsBottom - devH - 8, loadTop + devH + 24);
  const loadPlusY = loadTop + devH / 2, chPlusY = chTop + devH / 2;
  const device = (y, title, sub) => `<rect x="${f(outX)}" y="${f(y)}" width="${devW}" height="${devH}" rx="8" fill="#f8f9fa" stroke="${C.text}" stroke-width="1.5"/>`
    + text(outX + devW / 2, y + 22, title, { size: 12, weight: 700, anchor: 'middle' }) + text(outX + devW / 2, y + 60, sub, { size: 10, anchor: 'middle', color: C.muted })
    + text(outX + 8, y + devH / 2 + 5, '+', { size: 14, weight: 800, color: C.plus }) + text(outX + devW - 8, y + devH / 2 + 5, '−', { size: 14, weight: 800, anchor: 'end' });
  s += device(loadTop, 'Навантаження', load ? `до ${num(load)} А` : 'контролер / інвертор');
  s += device(chTop, 'Зарядний порт', `${num(plan.pack.charge, 1)} В · ${num(plan.chargeA, 1)} А`);

  // ---------- силове коло (рівні нижче за BMS і пристрої — нічого не перетинають)
  const below = Math.max(bmsBottom, chTop + devH) + 22;
  const yB = bmsBottom + 24;
  const yC = below;
  const yP = separate ? below + 24 : below;
  // мінус пакета → B− BMS
  wire('B0', [[x0, y0], [x0, yB], [tB, yB], [tB, bmsBottom]], C.minus, 4);
  s += dot(x0, y0, C.minus, 4);
  s += text((x0 + tB) / 2, yB - 6, `B− · ${awg}`, { size: 11, anchor: 'middle', weight: 600 });

  // плюс пакета → запобіжник → (вимикач) → шина P+
  const fx = bmsX - 70;
  wire(`B${S}`, [[x0, yS], [x0, yTop], [fx - 22, yTop]], C.plus, 4);
  s += dot(x0, yS, C.plus, 4);
  s += `<rect x="${f(fx - 22)}" y="${f(yTop - 8)}" width="44" height="16" rx="3" fill="#fff" stroke="${C.text}" stroke-width="1.5"/>` + line(fx - 22, yTop, fx + 22, yTop, C.text, 1);
  s += text(fx, yTop - 14, `Запобіжник ${num(plan.fuse, 1)} А`, { size: 11, anchor: 'middle', weight: 600 });
  s += text((x0 + fx - 22) / 2, yTop - 6, `P+ · ${awg}`, { size: 11, anchor: 'middle', weight: 600, color: C.plus });
  if (plan.sw) {
    const sx = bmsX + bmsW / 2;
    wire('F', [[fx + 22, yTop], [sx - 16, yTop]], C.plus, 4);
    s += dot(sx - 16, yTop, C.text, 3) + dot(sx + 16, yTop, C.text, 3) + line(sx - 16, yTop, sx + 13, yTop - 13, C.text, 2);
    s += text(sx, yTop + 18, 'Вимикач', { size: 11, anchor: 'middle' });
    if (plan.precharge) {
      const yr = yTop - 30;
      wire('F', [[sx - 30, yTop], [sx - 30, yr], [sx - 16, yr]], C.text, 1.2);
      wire('P+', [[sx + 16, yr], [sx + 30, yr], [sx + 30, yTop]], C.text, 1.2);
      s += `<rect x="${f(sx - 16)}" y="${f(yr - 5)}" width="32" height="10" fill="#fff" stroke="${C.text}" stroke-width="1.3"/>`;
      s += dot(sx - 30, yTop, C.text, 2.2) + dot(sx + 30, yTop, C.text, 2.2);
      s += text(sx, yr - 9, 'Передзаряд ~100 Ом 5 Вт', { size: 10, anchor: 'middle', color: C.muted });
    }
    wire('P+', [[sx + 16, yTop], [xPp, yTop]], C.plus, 4);
  } else {
    wire('P+', [[fx + 22, yTop], [xPp, yTop]], C.plus, 4);
  }
  // шина P+ → «+» навантаження і зарядного порту
  wire('P+', [[xPp, yTop], [xPp, chPlusY], [outX, chPlusY]], C.plus, 3.5);
  wire('P+', [[xPp, loadPlusY], [outX, loadPlusY]], C.plus, 3.5);
  s += dot(xPp, loadPlusY, C.plus, 3.5);
  s += text(xPp + 4, yTop - 6, 'P+', { size: 12, weight: 800, color: C.plus });

  // P− (і C−) обходять пристрої знизу і підходять до «−» праворуч
  if (separate) {
    wire('C−', [[tC, bmsBottom], [tC, yC], [xR1, yC], [xR1, chPlusY], [outX + devW, chPlusY]], C.minus, 2.5, 'stroke-dasharray="7 3"');
    s += text(xR1 + 4, (yC + chPlusY) / 2, `C− · ${chAwg}`, { size: 11, weight: 700 });
    wire('P−', [[tP, bmsBottom], [tP, yP], [xR2, yP], [xR2, loadPlusY], [outX + devW, loadPlusY]], C.minus, 3.5);
    s += text(xR2 + 4, (loadPlusY + chPlusY) / 2 - 14, `P− · ${awg}`, { size: 11, weight: 700 });
  } else {
    wire('P−', [[tP, bmsBottom], [tP, yP], [xR1, yP], [xR1, loadPlusY], [outX + devW, loadPlusY]], C.minus, 3.5);
    wire('P−', [[xR1, chPlusY], [outX + devW, chPlusY]], C.minus, 3.5);
    s += dot(xR1, chPlusY, C.minus, 3.5);
    s += text(xR1 + 4, (yP + chPlusY) / 2, `P− · ${awg}`, { size: 11, weight: 700 });
  }
  s += term(tB, 'B−', C.minus) + term(tP, 'P−', C.minus);
  if (separate) s += term(tC, 'C−', C.minus);

  const H = Math.max(yP, chTop + devH) + 56;
  const title = `Схема підключення BMS · ${S}S${P}P · ${num(S * cell.vNom)} В (${num(S * cell.vMin)}–${num(S * cell.vMax)} В)`;
  let head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${f(H)}" width="${f(W)}" height="${f(H)}" font-family="Inter, Segoe UI, Arial, sans-serif">`;
  head += `<rect width="${f(W)}" height="${f(H)}" fill="#fff"/>`;
  head += text(16, 24, title, { size: 15, weight: 700 });
  const foot = text(16, H - 16, `Балансувальні дроти: ${plan.balanceAwg}–24 AWG, порядок B0 → B${S}. Кольори дротів умовні. Напруга вказана відносно B0 (номінальна).`, { size: 11, color: C.muted });
  return { svg: head + s + foot + '</svg>', nets };
}
