/**
 * Расчёт лунного (синодического) дня по алгоритму «Тригонометрический 2»
 * (Trigonometric 2) — точный порт из проекта Петра Семилетова tea-qt
 * (src/calendar.cpp, Public Domain), который в свою очередь основан на
 * JavaScript-коде Ben Daglish (http://www.ben-daglish.net/moon.shtml).
 */

/** Юлианский день (JDN) для григорианской даты — эквивалент QDate::toJulianDay(). */
export function julianDay(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/**
 * Алгоритм «Тригонометрический 2».
 * Возвращает лунный день 1..30 (1 и 30 — новолуние, ~15 — полнолуние).
 */
export function moonPhaseTrig2(year: number, month: number, day: number): number {
  const n = Math.floor(12.37 * (year - 1900 + (1.0 * month - 0.5) / 12.0));
  const RAD = 3.14159265 / 180.0;
  const t = n / 1236.85;
  const t2 = t * t;
  const as = 359.2242 + 29.105356 * n;
  const am = 306.0253 + 385.816918 * n + 0.01073 * t2;
  let xtra = 0.75933 + 1.53058868 * n + (1.178e-4 - 1.55e-7 * t) * t2;
  xtra += (0.1734 - 3.93e-4 * t) * Math.sin(RAD * as) - 0.4068 * Math.sin(RAD * am);

  const i = xtra > 0.0 ? Math.floor(xtra) : Math.ceil(xtra - 1.0);
  const j1 = julianDay(year, month, day);
  const jd = 2415020 + 28 * n + i;

  let r = (((j1 - jd + 30) % 30) + 30) % 30;
  if (r === 0) r = 30;
  return r;
}

/** Новолуние по алгоритму (дни без пиктограммы в tea-qt: 1 и 30). */
export function isNewMoon(moonDay: number): boolean {
  return moonDay === 1 || moonDay === 30;
}

/**
 * Позиция плитки в спрайте moon-phases.png из tea-qt (533×378, сетка 7×5,
 * плитка 66×73, отступ 3). Порт кода paintCell из calendar.cpp.
 * Возвращает null, если для дня нет пиктограммы (новолуние).
 */
export function moonTilePosition(
  moonDay: number
): { x: number; y: number; w: number; h: number } | null {
  if (moonDay === 0 || moonDay === 30 || moonDay === 1) return null;

  let row = Math.floor(moonDay / 7);
  if (moonDay % 7 === 0 && row !== 0) row--;
  const col = moonDay - row * 7;

  const pad = 3;
  const x = (col - 1) * 73 + pad * col - pad;
  const y = row * 73 + pad * row;
  return { x, y, w: 66, h: 73 };
}

/** Размер всего спрайта — нужен для масштабирования background-size. */
export const MOON_SPRITE = { width: 533, height: 378, tileW: 66, tileH: 73 };

/** Название фазы для подсказки. */
export function moonPhaseName(moonDay: number): string {
  if (moonDay === 1 || moonDay === 30) return "Новолуние";
  if (moonDay < 8) return "Растущий серп (новый месяц)";
  if (moonDay === 8) return "Первая четверть";
  if (moonDay < 15) return "Растущая луна";
  if (moonDay === 15 || moonDay === 16) return "Полнолуние";
  if (moonDay < 23) return "Убывающая луна";
  if (moonDay === 23) return "Последняя четверть";
  return "Стареющий серп";
}

/* ---------- Вспомогательные функции для дат (без часовых поясов) ---------- */

export function toISO(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map((v) => parseInt(v, 10));
  return { y, m, d };
}

export function isoToJDN(iso: string): number {
  const { y, m, d } = parseISO(iso);
  return julianDay(y, m, d);
}

export function addDaysISO(iso: string, days: number): string {
  const { y, m, d } = parseISO(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function todayISO(): string {
  const now = new Date();
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** День недели 0=воскресенье..6=суббота для ISO-даты. */
export function weekdayOfISO(iso: string): number {
  const jdn = isoToJDN(iso);
  return (jdn + 1) % 7;
}

/**
 * Номер дня синодического месяца для даты.
 * observations — отсортированный по возрастанию список дат наблюдений.
 * Первый день месяца = наблюдение + 1 день.
 * Возвращает null, если наблюдений до этой даты не было.
 */
export function synodicDayFor(
  dateISO: string,
  observationsSorted: string[]
): { day: number; firstDayISO: string; observationISO: string } | null {
  let latest: string | null = null;
  for (const obs of observationsSorted) {
    if (obs < dateISO) latest = obs;
    else break;
  }
  if (!latest) return null;
  const firstDay = addDaysISO(latest, 1);
  const day = isoToJDN(dateISO) - isoToJDN(firstDay) + 1;
  // Синодический месяц не может длиться дольше ~31 дня (редкая аномалия).
  // Если наблюдение не обновили вовремя, дальше 31-го дня счётчик не показываем.
  if (day > 31) return null;
  return { day, firstDayISO: firstDay, observationISO: latest };
}
