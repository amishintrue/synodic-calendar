/**
 * Астрономические вычисления для БИБЛЕЙСКОГО календаря: точный момент
 * весеннего равноденствия, восход/заход Солнца и Луны, соединения
 * (астрономические новолуния) — всё через offline-библиотеку
 * astronomy-engine (без сети, детерминированная эфемерида).
 *
 * ВАЖНО: в отличие от `sun-moon.ts` (который считает восход/закат по
 * геопозиции УСТРОЙСТВА для карточки дня), здесь всё намеренно жёстко
 * привязано к Иерусалиму — это исторически корректная точка отсчёта для
 * библейского календаря (Ткуфат Нисан, начало суток с заката и т.д.),
 * не зависящая от того, где физически находится пользователь.
 */

import * as Astronomy from "astronomy-engine";

// Иерусалим — точка наблюдения, к которой исторически привязан библейский календарь.
export const BIBLICAL_OBSERVER = new Astronomy.Observer(31.7683, 35.2137, 754);
export const BIBLICAL_TIME_ZONE = "Asia/Jerusalem";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

/** Возвращает календарную дату (год-месяц-день) в часовом поясе Иерусалима для заданного момента. */
export function jerusalemYMD(date: Date): YMD {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: BIBLICAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

export function ymdAddDays(ymd: YMD, days: number): YMD {
  // Строим "нейтральный" полдень UTC для арифметики над календарной датой.
  const base = Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12, 0, 0);
  const shifted = new Date(base + days * MS_PER_DAY);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

function anchorNoonUTC(ymd: YMD): Date {
  // 10:00 UTC заведомо приходится на светлое время суток в Иерусалиме (UTC+2/+3),
  // это безопасная точка отсчёта для поиска захода солнца/луны в течение "того же" календарного дня.
  return new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 10, 0, 0));
}

const sunsetCache = new Map<string, Date | null>();
const moonsetCache = new Map<string, Date | null>();

function cacheKey(ymd: YMD): string {
  return `${ymd.y}-${ymd.m}-${ymd.d}`;
}

/** Момент захода солнца для заданной календарной даты (по Иерусалиму). */
export function sunsetFor(ymd: YMD): Date | null {
  const key = cacheKey(ymd);
  if (sunsetCache.has(key)) return sunsetCache.get(key)!;
  const start = anchorNoonUTC(ymd);
  const result = Astronomy.SearchRiseSet(Astronomy.Body.Sun, BIBLICAL_OBSERVER, -1, start, 2);
  const date = result ? result.date : null;
  sunsetCache.set(key, date);
  return date;
}

/** Момент захода луны для заданной календарной даты (по Иерусалиму). */
export function moonsetFor(ymd: YMD): Date | null {
  const key = cacheKey(ymd);
  if (moonsetCache.has(key)) return moonsetCache.get(key)!;
  const start = anchorNoonUTC(ymd);
  const result = Astronomy.SearchRiseSet(Astronomy.Body.Moon, BIBLICAL_OBSERVER, -1, start, 2);
  const date = result ? result.date : null;
  moonsetCache.set(key, date);
  return date;
}

/** Угловое расстояние между Луной и Солнцем (элонгация), градусы. */
export function moonElongation(date: Date): number {
  return Astronomy.AngleFromSun(Astronomy.Body.Moon, date);
}

/**
 * Библейские сутки начинаются с захода солнца. Для произвольного момента времени
 * возвращает момент (Date) начала библейских суток, в которые попадает этот момент.
 */
export function biblicalDayStart(instant: Date): Date {
  const ymd = jerusalemYMD(instant);
  const sunsetToday = sunsetFor(ymd);
  if (sunsetToday && instant.getTime() < sunsetToday.getTime()) {
    const prev = ymdAddDays(ymd, -1);
    const sunsetPrev = sunsetFor(prev);
    return sunsetPrev ?? new Date(instant.getTime() - MS_PER_DAY);
  }
  return sunsetToday ?? instant;
}

/** Ищет следующее новолуние (астрономическое соединение) после указанного момента. */
export function nextConjunction(after: Date): Date {
  let mq = Astronomy.SearchMoonQuarter(after);
  let guard = 0;
  while (mq.quarter !== 0 && guard < 8) {
    mq = Astronomy.NextMoonQuarter(mq);
    guard++;
  }
  return mq.time.date;
}

/** Весеннее равноденствие (Ткуфат Нисан) для заданного года — точный астрономический момент (UTC Date). */
export function marchEquinox(year: number): Date {
  const seasons = Astronomy.Seasons(year);
  return seasons.mar_equinox.date;
}

/**
 * Момент равноденствия, приведённый к границе библейских суток (после захода солнца
 * событие "переезжает" на следующие сутки).
 */
export function equinoxBiblicalDayStart(year: number): Date {
  return biblicalDayStart(marchEquinox(year));
}
