// Підбір і підключення BMS: пороги захисту, балансувальні дроти, запобіжник, перетини, перевірки.

import { wireCalc } from './tools.js';

// Рекомендовані налаштування на одну комірку, В. Значення консервативні (на ресурс), а не граничні.
export const CHEM_PROFILES = {
  'Li-ion': { charge: 4.2, ovp: 4.25, ovpr: 4.15, uvp: 2.8, uvpr: 3.0, balStart: 3.9, balDelta: 10, storage: 3.7 },
  LiFePO4: { charge: 3.55, ovp: 3.65, ovpr: 3.4, uvp: 2.6, uvpr: 2.9, balStart: 3.4, balDelta: 10, storage: 3.3 },
  LTO: { charge: 2.7, ovp: 2.8, ovpr: 2.65, uvp: 1.8, uvpr: 2.0, balStart: 2.5, balDelta: 10, storage: 2.4 },
  'Na-ion': { charge: 3.9, ovp: 4.0, ovpr: 3.85, uvp: 2.0, uvpr: 2.3, balStart: 3.6, balDelta: 15, storage: 3.1 },
};

export const BMS_TYPES = {
  hardware: 'Апаратна (фіксована кількість S)',
  smart: 'Розумна (налаштовувана, Bluetooth/UART)',
};
export const BMS_PORTS = {
  common: 'Спільний порт (P− для заряду й розряду)',
  separate: 'Роздільний порт (P− розряд, C− заряд)',
};

const FUSES = [1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100, 125, 150, 175, 200, 250, 300, 350, 400, 500];
const BMS_RATINGS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500];
const roundUp = (list, v) => list.find((x) => x >= v - 1e-9) ?? Math.ceil(v);

// Палітра балансувальних дротів (умовна). B0 — завжди чорний.
const WIRE_PALETTE = ['#e03131', '#f08c00', '#d4a017', '#2f9e44', '#1c7ed6', '#7048e8', '#c2255c', '#0c8599', '#8d5524', '#5c940d', '#ae3ec9', '#495057'];
export function wireColor(k) {
  return k === 0 ? '#1d232b' : WIRE_PALETTE[(k - 1) % WIRE_PALETTE.length];
}

/** Налаштування захисту для комірки з урахуванням її даташиту. */
export function protectionProfile(cell) {
  const p = CHEM_PROFILES[cell.chem];
  if (!p) {
    return {
      known: false,
      charge: cell.vMax, ovp: cell.vMax + 0.05, ovpr: cell.vMax - 0.1, uvp: cell.vMin + 0.2, uvpr: cell.vMin + 0.4,
      balStart: (cell.vNom + cell.vMax) / 2, balDelta: 15, storage: cell.vNom,
    };
  }
  return {
    known: true,
    charge: Math.min(p.charge, cell.vMax),
    ovp: Math.min(p.ovp, cell.vMax + 0.05),
    ovpr: Math.min(p.ovpr, cell.vMax - 0.03),
    uvp: Math.max(p.uvp, cell.vMin),
    uvpr: Math.max(p.uvpr, cell.vMin + 0.2),
    balStart: p.balStart, balDelta: p.balDelta, storage: p.storage,
  };
}

/**
 * Повний план підключення BMS.
 * @param {object} cell
 * @param {object} layout результат generateLayout (для розташування точок)
 * @param {object} cfg налаштування BMS
 * @param {'hardware'|'smart'} cfg.type
 * @param {'common'|'separate'} cfg.port
 * @param {number} [cfg.channels] кількість каналів BMS (0 — як S)
 * @param {number} [cfg.current] тривалий струм BMS, А (0 — підібрати)
 * @param {number} [cfg.chargeA] струм заряду, А (0 — 0,3C)
 * @param {number} [cfg.balanceA] струм балансування, А
 * @param {number} [cfg.ntc] кількість датчиків температури
 * @param {boolean} [cfg.sw] вимикач на P+
 * @param {boolean} [cfg.precharge] коло попереднього заряду
 * @param {number} [cfg.leadLen] довжина силових дротів в один бік, м
 * @param {number} load струм навантаження, А
 */
export function bmsPlan(cell, layout, cfg, load) {
  const S = layout.S, P = layout.P;
  const prof = protectionProfile(cell);
  const ah = cell.capacity * P;
  const packIMax = cell.iMax * P;
  const loadA = Number(load) || 0;
  const channels = Math.floor(cfg.channels) > 0 ? Math.floor(cfg.channels) : S;
  const recCurrent = roundUp(BMS_RATINGS, Math.max(loadA * 1.25, 5));
  const bmsCurrent = Number(cfg.current) > 0 ? Number(cfg.current) : recCurrent;
  const chargeA = Number(cfg.chargeA) > 0 ? Number(cfg.chargeA) : Math.max(0.5, Math.round(ah * 0.3 * 10) / 10);
  const balanceA = Number(cfg.balanceA) > 0 ? Number(cfg.balanceA) : 0.05;
  const ntc = Math.max(0, Math.floor(cfg.ntc ?? 1));
  const leadLen = Number(cfg.leadLen) > 0 ? Number(cfg.leadLen) : 0.3;
  const vNom = S * cell.vNom;

  // Запобіжник: вище за робочий струм (з запасом на пуски), але не вище за BMS і можливості комірок.
  const fuse = roundUp(FUSES, Math.max(loadA * 1.25, Math.min(chargeA * 1.25, bmsCurrent), 1));
  // Силовий дріт розраховуємо на струм запобіжника — дріт має пережити будь-який струм до його спрацювання.
  const power = wireCalc({ current: fuse, length: leadLen, voltage: vNom, maxDropPct: 2 });
  const chargeWire = wireCalc({ current: chargeA * 1.25, length: leadLen, voltage: vNom, maxDropPct: 3 });

  const pitch = Math.max(layout.pitchX, layout.pitchY);
  const wires = [];
  for (let k = 0; k <= S; k++) {
    const bus = layout.buses[k];
    const c = layout.cells[bus.tap];
    const prism = layout.shape === 'prism';
    const sideName = prism ? (bus.side === 'top' ? 'клема 1' : 'клема 2') : bus.side === 'top' ? 'зверху' : 'знизу';
    const terminal = k === 0 ? '−' : '+';
    const groupNo = k === 0 ? 1 : k;
    wires.push({
      k,
      name: `B${k}`,
      color: wireColor(k),
      role: k === 0 ? 'мінус групи 1 (мінус пакета)' : k === S ? `плюс групи ${k} (плюс пакета)` : `плюс групи ${k} / мінус групи ${k + 1}`,
      where: `група ${groupNo} «${terminal}», ряд ${c.row + 1}, стовпець ${c.col + 1}, ${sideName}`,
      cellId: c.id,
      vMin: k * cell.vMin, vNom: k * cell.vNom, vMax: k * cell.vMax,
      length: Math.round((bus.tapDist + 60 + pitch) / 10) * 10, // мм, з запасом на укладання
    });
  }
  const balanceLength = wires.reduce((s, w) => s + w.length, 0);

  const checks = [];
  const add = (level, text) => checks.push({ level, text });
  if (channels < S) add('bad', `BMS на ${channels}S не підходить для ${S}S — потрібна BMS щонайменше на ${S} каналів.`);
  else if (channels > S && cfg.type === 'hardware')
    add('bad', `Апаратна BMS на ${channels}S розрахована саме на ${channels} груп. Для ${S}S купуйте BMS на ${S}S або розумну BMS з налаштуванням кількості комірок.`);
  else if (channels > S)
    add('warn', `У BMS ${channels} каналів, використовується ${S}. Задайте кількість комірок ${S} у налаштуваннях; невикористані дроти B${S + 1}…B${channels} зазвичай з'єднують з B${S} — звіртеся з інструкцією виробника.`);
  else add('ok', `Кількість каналів BMS збігається з ${S}S.`);

  if (loadA > 0 && bmsCurrent < loadA * 1.1) add('bad', `Тривалий струм BMS ${bmsCurrent} А замалий для навантаження ${loadA} А (потрібно від ${recCurrent} А).`);
  else if (loadA > 0) add('ok', `BMS ${bmsCurrent} А має запас ${Math.round((bmsCurrent / loadA - 1) * 100)}% до навантаження ${loadA} А.`);
  if (bmsCurrent > packIMax * 1.05)
    add('warn', `BMS пропускає ${bmsCurrent} А, а комірки разом витримують лише ${Math.round(packIMax)} А. Налаштуйте захист від перевантаження (OCP) не вище ${Math.floor(packIMax)} А.`);
  if (loadA > packIMax) add('bad', `Навантаження ${loadA} А перевищує можливості комірок (${Math.round(packIMax)} А) — збільште P.`);

  const chargeC = chargeA / ah;
  if (chargeC > 1) add('bad', `Струм заряду ${chargeA} А = ${chargeC.toFixed(2)}C — зависокий для більшості комірок.`);
  else if (chargeC > 0.5) add('warn', `Струм заряду ${chargeC.toFixed(2)}C — перевірте, що даташит комірки дозволяє такий заряд.`);
  if (cfg.port === 'separate' && chargeA > bmsCurrent * 0.5)
    add('warn', 'У BMS з роздільним портом струм заряду (C−) зазвичай значно менший за розрядний — перевірте його номінал.');

  if (ah >= 30 && balanceA < 0.5)
    add('warn', `Для ${ah.toFixed(0)} А·год пасивного балансування ${balanceA * 1000} мА мало — розгляньте активний балансир на 1–2 А.`);
  if (cell.chem === 'NiMH') add('bad', 'NiMH не використовує BMS з балансуванням — потрібен відповідний зарядний пристрій (−ΔV / температура).');
  else if (!prof.known) add('warn', `Для хімії «${cell.chem}» немає профілю — пороги розраховано з даташиту комірки.`);

  const kwh = (vNom * ah) / 1000;
  if (ntc === 0) add('warn', 'Не підключено жодного датчика температури — рекомендується хоча б один NTC.');
  else if (kwh > 1 && ntc < 2) add('warn', 'Для пакета понад 1 кВт·год рекомендується два датчики температури.');
  if (S * cell.vMax > 40 && !cfg.precharge)
    add('warn', 'Для контролерів з великими конденсаторами на вході додайте коло попереднього заряду (резистор біля вимикача), щоб не обгоряли контакти.');
  if (!power.recommended) add('bad', 'Немає підхожого перетину силового дроту — використайте кілька паралельних дротів або шини.');

  const steps = [
    'Переконайтеся, що BMS розрахована на цю хімію та кількість груп, а балансувальний роз\'єм від\'єднано від плати.',
    `Приваріть/припаяйте силовий дріт B− (${power.recommended ? power.recommended.awg + ' AWG' : 'див. перетин'}) до мінуса пакета (точка P−) та під'єднайте до B− на BMS.`,
    `Припаяйте балансувальні дроти по черзі B0 → B${S}, кожен до своєї шини (див. таблицю). Довжини — з запасом, без натягу.`,
    `Не підключаючи роз'єм до BMS, перевірте мультиметром: між сусідніми пінами ≈ ${cell.vNom} В (${cell.vMin}–${cell.vMax}), між B0 і Bk — наростання на ≈ ${cell.vNom} В з кожним кроком.`,
    'Під\'єднайте роз\'єм до BMS (якщо інструкція не вимагає іншого порядку). Невикористані піни — згідно з інструкцією.',
    cfg.port === 'separate'
      ? 'Під\'єднайте навантаження до P+ та P−, зарядний порт — до P+ та C−.'
      : 'Під\'єднайте навантаження й зарядний порт до P+ та P−.',
    `Плюс пакета виведіть через запобіжник ${fuse} А${cfg.sw ? ' і вимикач' : ''}${cfg.precharge ? ' (з колом попереднього заряду)' : ''} на P+.`,
    ntc ? `Закріпіть ${ntc > 1 ? `${ntc} датчики` : 'датчик'} температури на комірках у центрі пакета (найгарячіше місце).` : 'За можливості додайте датчик температури.',
    cfg.type === 'smart'
      ? `Налаштуйте BMS: ${S} комірок, пороги з таблиці, ємність ${ah.toFixed(1)} А·год, OCP ≤ ${Math.min(bmsCurrent, Math.floor(packIMax))} А.`
      : 'Апаратна BMS може бути «заблокована» після підключення — активуйте її, коротко подавши заряд на P+/P− (C−).',
    'Перший заряд — під наглядом, контролюйте напруги груп і нагрів.',
    'Відключення — у зворотному порядку: навантаження, роз\'єм балансування, B−.',
  ];

  return {
    S, P, channels, unused: Math.max(0, channels - S), type: cfg.type, port: cfg.port,
    profile: prof,
    pack: {
      charge: prof.charge * S, ovp: prof.ovp * S, ovpr: prof.ovpr * S, uvp: prof.uvp * S, uvpr: prof.uvpr * S, storage: prof.storage * S,
    },
    bmsCurrent, recCurrent, chargeA, chargeC, balanceA, ntc, leadLen,
    fuse, power, chargeWire, sw: !!cfg.sw, precharge: !!cfg.precharge,
    wires, balanceLength, balanceAwg: balanceA > 1 ? 20 : 22,
    checks, steps, packIMax, ah, vNom,
  };
}
