// Типові збірки за застосуванням (за популярними конфігураціями: самокати, e-bike, скейти,
// e-moto, електроінструмент, LiFePO4 для сонячних систем). Значення навантаження — орієнтовні.

export const PRESETS = [
  {
    id: 'scooter-36', label: 'Самокат 36 В · 10S3P (18650)', S: 10, P: 3, cell: 'samsung-35e', load: 15,
    note: 'Типова батарея електросамоката (наприклад, Xiaomi M365 — 10S3P).',
  },
  {
    id: 'ebike-36', label: 'E-bike 36 В · 10S4P (18650)', S: 10, P: 4, cell: 'samsung-35e', load: 15,
    note: 'Базовий e-bike 250–500 Вт.',
  },
  {
    id: 'ebike-48', label: 'E-bike 48 В · 13S4P (Hailong, 52 комірки)', S: 13, P: 4, cell: 'samsung-35e', load: 20, snake: 'u',
    note: 'Корпуси Hailong на 52 комірки 18650 — під 13S4P; U-подібна змійка виводить P+ і P− з одного боку.',
  },
  {
    id: 'ebike-52', label: 'E-bike 52 В · 14S5P (18650)', S: 14, P: 5, cell: 'samsung-35e', load: 25,
    note: 'Популярний 52 В пакет для 750–1000 Вт.',
  },
  {
    id: 'triangle-52', label: 'Трикутник у раму 52 В · 14S6P', S: 14, P: 6, cell: 'samsung-35e', load: 30, arrangement: 'honeycomb',
    shape: { type: 'triangle', a: 450, b: 300, x: 380, thick: 80 },
    lead: 'collector',
    note: 'Пакет у трикутник рами: стільники, вписування у форму, мідна збірна шина на силових виводах.',
  },
  {
    id: 'esk8-12', label: 'Скейт 43 В · 12S4P (21700)', S: 12, P: 4, cell: 'molicel-p42a', load: 60, rows: 2,
    ser: { same: false, material: 'copper', width: 10, thickness: 0.3, layers: 1 },
    note: 'Електроскейт: плоский пакет у два ряди (кожна група 2×2), послідовні перемички — мідь. Для короткої деки — «Ярусів: 2».',
  },
  {
    id: 'emoto-72', label: 'E-moto 72 В · 20S8P (21700)', S: 20, P: 8, cell: 'samsung-40t', load: 100, lead: 'collector',
    ser: { same: false, material: 'copper', width: 10, thickness: 0.3, layers: 1 },
    strip: { material: 'nickel', width: 10, thickness: 0.2, layers: 1 },
    note: 'Високострумовий пакет: послідовні перемички з міді, збірна шина на виводах.',
  },
  {
    id: 'tool-18', label: 'Інструмент 18 В · 5S2P (18650)', S: 5, P: 2, cell: 'molicel-p28a', load: 30, rows: 2,
    note: 'Акумулятор інструмента «18 В / 20V Max».',
  },
  {
    id: 'lfp-12-32700', label: 'LiFePO4 12 В · 4S2P (32700)', S: 4, P: 2, cell: '32700-lfp', load: 20, rows: 2,
    note: '12 В для освітлення, рибальського ехолота, слабкого інвертора.',
  },
  {
    id: 'lfp-12', label: 'LiFePO4 12 В · 4S (280 А·год)', S: 4, P: 1, cell: 'eve-lf280k', load: 100, rows: 1,
    bms: { type: 'smart' },
    note: '3,6 кВт·год: будинок на колесах, човен, резервне живлення.',
  },
  {
    id: 'lfp-24', label: 'LiFePO4 24 В · 8S (280 А·год)', S: 8, P: 1, cell: 'eve-lf280k', load: 100, rows: 2, snake: 'u',
    bms: { type: 'smart' },
    note: '7,2 кВт·год у два ряди по 4 (P+ і P− з одного боку).',
  },
  {
    id: 'lfp-48', label: 'LiFePO4 48 В · 16S (280 А·год)', S: 16, P: 1, cell: 'eve-lf280k', load: 100, rows: 2, snake: 'u',
    bms: { type: 'smart' },
    note: '14,3 кВт·год, стандарт для 48 В інверторів (16S, заряд до ≈56,8 В).',
  },
];

export const presetById = (id) => PRESETS.find((p) => p.id === id) || null;
