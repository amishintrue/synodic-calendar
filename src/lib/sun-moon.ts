/**
 * Восход/закат Солнца и Луны по географическим координатам.
 *
 * Считаем полностью офлайн через библиотеку suncalc (чистый JS, без сети) —
 * это критично, т.к. приложение должно работать без интернета (Capacitor +
 * SQLite). Координаты берём с самого устройства через плагин
 * @capacitor/geolocation (на Android спросит разрешение сам, в вебе
 * использует navigator.geolocation). Если геолокация выключена/недоступна
 * или пользователь не дал разрешение — используем координаты Иерусалима.
 */

import * as SunCalc from "suncalc";

export type GeoCoords = { latitude: number; longitude: number };

/** Иерусалим — координаты по умолчанию, если геолокация недоступна. */
export const JERUSALEM_COORDS: GeoCoords = { latitude: 31.7683, longitude: 35.2137 };
export const JERUSALEM_TIME_ZONE = "Asia/Jerusalem";

export type LocationResult = {
  coords: GeoCoords;
  source: "device" | "jerusalem";
  /** Часовой пояс для форматирования времени. Задан только для запасного
   * варианта (Иерусалим) — координаты устройства форматируем в текущем
   * часовом поясе самого устройства, т.к. оно физически там и находится. */
  timeZone?: string;
};

let cachedLocation: LocationResult | null = null;
let inFlight: Promise<LocationResult> | null = null;

async function getDevicePosition(timeoutMs: number): Promise<GeoCoords | null> {
  // 1. Пытаемся через плагин Capacitor Geolocation (нативно на Android,
  //    через navigator.geolocation в браузере/вебе).
  try {
    const { Geolocation } = await import("@capacitor/geolocation");

    try {
      const status = await Geolocation.checkPermissions();
      if (status.location === "denied" && status.coarseLocation === "denied") {
        return null;
      }
      if (status.location !== "granted" && status.coarseLocation !== "granted") {
        const requested = await Geolocation.requestPermissions().catch(() => null);
        if (
          !requested ||
          (requested.location !== "granted" && requested.coarseLocation !== "granted")
        ) {
          return null;
        }
      }
    } catch {
      // Некоторые платформы (например, отключённые службы геолокации)
      // бросают исключение уже на этапе проверки разрешений — просто
      // пробуем получить позицию напрямую ниже, а если не выйдет, уйдём
      // в резервный вариант.
    }

    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: timeoutMs,
      maximumAge: 5 * 60_000,
    });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
    // Плагин недоступен (например, SSR) — падаем на обычный Web API ниже.
  }

  // 2. Обычный браузерный Geolocation API как запасной вариант.
  if (typeof navigator !== "undefined" && navigator.geolocation) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60_000 }
      );
    });
  }

  return null;
}

/**
 * Возвращает местоположение пользователя (с кэшированием на время сессии
 * приложения). Если геолокация отключена, недоступна или пользователь
 * отказал в разрешении — возвращает координаты Иерусалима.
 */
export async function getUserLocation(forceRefresh = false): Promise<LocationResult> {
  if (!forceRefresh && cachedLocation) return cachedLocation;
  if (!forceRefresh && inFlight) return inFlight;

  inFlight = (async () => {
    const coords = await getDevicePosition(8000);
    const result: LocationResult = coords
      ? { coords, source: "device" }
      : { coords: JERUSALEM_COORDS, source: "jerusalem", timeZone: JERUSALEM_TIME_ZONE };
    cachedLocation = result;
    inFlight = null;
    return result;
  })();

  return inFlight;
}

export type SunMoonTimes = {
  sunrise: Date | null;
  sunset: Date | null;
  moonrise: Date | null;
  moonset: Date | null;
  /** Луна не заходит за горизонт в этот календарный день (полярный день). */
  moonAlwaysUp: boolean;
  /** Луна не восходит в этот календарный день (полярная ночь). */
  moonAlwaysDown: boolean;
  /** Доля освещённости лунного диска, 0..1. */
  moonIllumination: number;
};

function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * Строит Date, представляющий полдень (12:00) заданного календарного дня в
 * ЛОКАЛЬНОМ часовом поясе среды выполнения (устройства). Использовать именно
 * это, а не полночь, при расчёте восхода/захода для КОНКРЕТНОГО выбранного
 * дня календаря (а не "сейчас"): SunCalc считает астрономию по UTC-суткам, и
 * если передать полночь по местному времени, для смещений от UTC можно
 * попасть на соседние UTC-сутки и получить время не за тот календарный день.
 * Полдень почти всегда остаётся в пределах правильных UTC-суток.
 */
export function localNoonForDate(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Восход/закат Солнца и Луны для заданной даты и координат. */
export function getSunMoonTimes(date: Date, coords: GeoCoords): SunMoonTimes {
  const sun = SunCalc.getTimes(date, coords.latitude, coords.longitude);
  const moon = SunCalc.getMoonTimes(date, coords.latitude, coords.longitude);
  const illum = SunCalc.getMoonIllumination(date);

  return {
    sunrise: isValidDate(sun.sunrise) ? sun.sunrise : null,
    sunset: isValidDate(sun.sunset) ? sun.sunset : null,
    moonrise: isValidDate(moon.rise) ? moon.rise : null,
    moonset: isValidDate(moon.set) ? moon.set : null,
    moonAlwaysUp: !!moon.alwaysUp,
    moonAlwaysDown: !!moon.alwaysDown,
    moonIllumination: illum.fraction,
  };
}

/** Форматирует время в формате ЧЧ:ММ, опционально в заданном часовом поясе. */
export function formatTime(date: Date | null, timeZone?: string): string {
  if (!date) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(date);
  } catch {
    return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
}
