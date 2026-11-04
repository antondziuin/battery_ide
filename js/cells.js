// База комірок. Розміри в мм, ємність в А·год, струм в А, маса в г, внутрішній опір в мОм.
// Значення орієнтовні (за типовими даташитами) — перевіряйте даташит вашої партії.
//
// shape: 'cyl' — циліндрична (d — діаметр, h — висота)
//        'prism' — призматична (w — ширина, з клемами; t — товщина; h — висота)

export const BUILTIN_CELLS = [
  // 18650
  { id: '18650-generic', format: '18650', name: '18650 типова 3000 мА·год', shape: 'cyl', d: 18.4, h: 65.2, capacity: 3.0, vNom: 3.6, vMax: 4.2, vMin: 2.5, iMax: 10, mass: 47, ir: 25, chem: 'Li-ion' },
  { id: 'samsung-35e', format: '18650', name: 'Samsung INR18650-35E', shape: 'cyl', d: 18.55, h: 65.25, capacity: 3.4, vNom: 3.6, vMax: 4.2, vMin: 2.65, iMax: 8, mass: 48, ir: 35, chem: 'Li-ion' },
  { id: 'lg-mj1', format: '18650', name: 'LG INR18650-MJ1', shape: 'cyl', d: 18.4, h: 65.0, capacity: 3.5, vNom: 3.635, vMax: 4.2, vMin: 2.5, iMax: 10, mass: 49, ir: 35, chem: 'Li-ion' },
  { id: 'molicel-p28a', format: '18650', name: 'Molicel INR-18650-P28A', shape: 'cyl', d: 18.5, h: 65.0, capacity: 2.8, vNom: 3.6, vMax: 4.2, vMin: 2.5, iMax: 35, mass: 46, ir: 12, chem: 'Li-ion' },
  { id: 'samsung-30q', format: '18650', name: 'Samsung INR18650-30Q', shape: 'cyl', d: 18.4, h: 65.0, capacity: 3.0, vNom: 3.6, vMax: 4.2, vMin: 2.5, iMax: 15, mass: 48, ir: 20, chem: 'Li-ion' },
  // 21700
  { id: 'samsung-50e', format: '21700', name: 'Samsung INR21700-50E', shape: 'cyl', d: 21.25, h: 70.3, capacity: 5.0, vNom: 3.6, vMax: 4.2, vMin: 2.5, iMax: 9.8, mass: 69, ir: 25, chem: 'Li-ion' },
  { id: 'samsung-40t', format: '21700', name: 'Samsung INR21700-40T', shape: 'cyl', d: 21.2, h: 70.2, capacity: 4.0, vNom: 3.6, vMax: 4.2, vMin: 2.5, iMax: 35, mass: 67, ir: 10, chem: 'Li-ion' },
  { id: 'molicel-p42a', format: '21700', name: 'Molicel INR-21700-P42A', shape: 'cyl', d: 21.7, h: 70.15, capacity: 4.2, vNom: 3.6, vMax: 4.2, vMin: 2.5, iMax: 45, mass: 70, ir: 10, chem: 'Li-ion' },
  { id: 'molicel-p45b', format: '21700', name: 'Molicel INR-21700-P45B', shape: 'cyl', d: 21.55, h: 70.15, capacity: 4.5, vNom: 3.6, vMax: 4.2, vMin: 2.5, iMax: 45, mass: 70, ir: 9, chem: 'Li-ion' },
  { id: 'eve-50e-21700', format: '21700', name: 'EVE INR21700-50E', shape: 'cyl', d: 21.3, h: 70.3, capacity: 5.0, vNom: 3.6, vMax: 4.2, vMin: 2.5, iMax: 15, mass: 68, ir: 20, chem: 'Li-ion' },
  // інші циліндричні
  { id: '14500-generic', format: '14500', name: '14500 типова 800 мА·год', shape: 'cyl', d: 14.2, h: 50.5, capacity: 0.8, vNom: 3.7, vMax: 4.2, vMin: 2.75, iMax: 1.6, mass: 20, ir: 60, chem: 'Li-ion' },
  { id: '26650-lfp', format: '26650', name: '26650 LiFePO4 3300 мА·год', shape: 'cyl', d: 26.2, h: 65.6, capacity: 3.3, vNom: 3.2, vMax: 3.65, vMin: 2.5, iMax: 10, mass: 85, ir: 15, chem: 'LiFePO4' },
  { id: '32700-lfp', format: '32700', name: '32700 LiFePO4 6000 мА·год', shape: 'cyl', d: 32.2, h: 70.5, capacity: 6.0, vNom: 3.2, vMax: 3.65, vMin: 2.5, iMax: 18, mass: 142, ir: 8, chem: 'LiFePO4' },
  { id: '4680-generic', format: '4680', name: '4680 (орієнтовно)', shape: 'cyl', d: 46.0, h: 80.0, capacity: 23.0, vNom: 3.6, vMax: 4.2, vMin: 2.5, iMax: 70, mass: 355, ir: 2, chem: 'Li-ion' },
  { id: '18650-lto', format: '18650', name: '18650 LTO 1300 мА·год', shape: 'cyl', d: 18.3, h: 65.0, capacity: 1.3, vNom: 2.4, vMax: 2.8, vMin: 1.5, iMax: 13, mass: 40, ir: 20, chem: 'LTO' },
  // призматичні
  { id: 'eve-lf105', format: 'Призматична', name: 'EVE LF105 (105 А·год)', shape: 'prism', w: 130.3, t: 36.3, h: 200.5, capacity: 105, vNom: 3.2, vMax: 3.65, vMin: 2.5, iMax: 105, mass: 1980, ir: 0.4, chem: 'LiFePO4' },
  { id: 'eve-lf280k', format: 'Призматична', name: 'EVE LF280K (280 А·год)', shape: 'prism', w: 173.7, t: 71.7, h: 207.2, capacity: 280, vNom: 3.2, vMax: 3.65, vMin: 2.5, iMax: 200, mass: 5490, ir: 0.25, chem: 'LiFePO4' },
  { id: 'calb-l173f100', format: 'Призматична', name: 'Призматична 100 А·год (типова)', shape: 'prism', w: 160, t: 50, h: 118, capacity: 100, vNom: 3.2, vMax: 3.65, vMin: 2.5, iMax: 100, mass: 1950, ir: 0.5, chem: 'LiFePO4' },
];

/** Довжина комірки вздовж осі (для циліндра) або висота (для призми). */
export function cellLength(cell) {
  return cell.h;
}

/** Енергія однієї комірки, Вт·год. */
export function cellEnergy(cell) {
  return cell.capacity * cell.vNom;
}

export function validateCell(c) {
  const errors = [];
  const num = (k) => typeof c[k] === 'number' && isFinite(c[k]) && c[k] > 0;
  if (!c.name) errors.push('Вкажіть назву');
  if (c.shape === 'cyl') {
    if (!num('d')) errors.push('Діаметр має бути > 0');
  } else if (c.shape === 'prism') {
    if (!num('w')) errors.push('Ширина має бути > 0');
    if (!num('t')) errors.push('Товщина має бути > 0');
  } else errors.push('Невідома форма');
  for (const k of ['h', 'capacity', 'vNom', 'vMax', 'vMin', 'iMax']) if (!num(k)) errors.push(`Поле ${k} має бути > 0`);
  if (num('vMax') && num('vNom') && c.vMax < c.vNom) errors.push('Vmax менша за Vnom');
  if (num('vMin') && num('vNom') && c.vMin > c.vNom) errors.push('Vmin більша за Vnom');
  return errors;
}
