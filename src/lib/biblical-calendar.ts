/**
 * Библейский календарь: последовательность синодических месяцев с номерами
 * 1..12 (изредка 13 — Адар II), определяемая полностью автоматически:
 *
 * 1. Начало месяца — приближённый расчёт видимости молодого серпа Луны
 *    вечером (см. isCrescentVisible ниже) после каждого астрономического
 *    соединения.
 * 2. Начало года — в конце 12-го месяца проверяется правило "Песах не
 *    раньше весеннего равноденствия": предполагаемый 14-й день
 *    наступающего месяца сравнивается с моментом Ткуфат Нисан. Если 14-е
 *    число наступает на равноденствие или позже — наступающий месяц
 *    становится 1-м (Нисан) нового года; если раньше — вставляется 13-й,
 *    високосный месяц (Адар II), и год ждёт следующего новолуния.
 *
 * Это отдельная, полностью вычисляемая система — она не заменяет и не
 * трогает существующий механизм ручных "наблюдений" пользователя
 * (см. `synodicDayFor` в `moon.ts`), а лишь даёт номер библейского месяца
 * для произвольной даты.
 */
import {
  type YMD,
  biblicalDayStart,
  equinoxBiblicalDayStart,
  jerusalemYMD,
  moonElongation,
  moonsetFor,
  nextConjunction,
  sunsetFor,
  ymdAddDays,
} from "./biblical-astro";

export interface BiblicalMonth {
  /** Порядковый номер месяца в библейском году (1..12, редко 13 — Адар II). */
  number: number;
  /** Является ли месяц дополнительным (13-м, високосным). */
  isLeap: boolean;
  /** Момент начала месяца (заход солнца, знаменующий начало 1-го дня). */
  start: Date;
  /** Момент окончания месяца (= начало следующего месяца). */
  end: Date;
  /** Порядковый номер года цикла (просто счётчик от начала расчёта, не богословское значение). */
  yearIndex: number;
  /** Была ли неомения определена по строгому критерию видимости, либо взята "по умолчанию". */
  fallback: boolean;
}

interface RawMonthStart {
  start: Date;
  conjunction: Date;
  fallback: boolean;
}

/**
 * Простейший (приближённый) критерий видимости молодого серпа луны вечером заданной даты:
 * - заход луны должен происходить позже захода солнца (окно наблюдения существует);
 * - луна должна быть достаточно "старой" после соединения;
 * - угловое расстояние от Солнца (элонгация) должно быть достаточным.
 * Это упрощённая эвристика (в духе критериев Одэ/Йеллопа), а не точная модель видимости.
 */
function isCrescentVisible(dayYmd: YMD, conjunction: Date): boolean {
  const sunset = sunsetFor(dayYmd);
  const moonset = moonsetFor(dayYmd);
  if (!sunset || !moonset) return false;
  if (sunset.getTime() < conjunction.getTime()) return false; // соединение ещё не наступило к закату

  const lagMinutes = (moonset.getTime() - sunset.getTime()) / 60000;
  const ageHours = (sunset.getTime() - conjunction.getTime()) / 3600000;
  const elongation = moonElongation(sunset);

  return lagMinutes >= 35 && ageHours >= 14 && elongation >= 7;
}

/** Находит начало следующего синодического месяца (вечер видимой неомении) после заданного момента. */
function findNextMonthStart(after: Date): RawMonthStart {
  const conjunction = nextConjunction(after);
  const base = jerusalemYMD(conjunction);

  for (let offset = 0; offset <= 3; offset++) {
    const candidate = ymdAddDays(base, offset);
    if (isCrescentVisible(candidate, conjunction)) {
      const sunset = sunsetFor(candidate)!;
      return { start: sunset, conjunction, fallback: false };
    }
  }

  // Если критерий видимости не сработал (полярные случаи/погрешности) — берём вечер через 2 дня
  // после соединения, что практически всегда обеспечивает видимость серпа.
  const fallbackDate = ymdAddDays(base, 2);
  const fallbackSunset = sunsetFor(fallbackDate);
  return {
    start: fallbackSunset ?? new Date(conjunction.getTime() + 2 * 24 * 3600 * 1000),
    conjunction,
    fallback: true,
  };
}

/**
 * Определяет, должен ли месяц, начинающийся в monthStart, стать 1-м месяцем (Нисаном) нового года,
 * согласно правилу: 14-й день (предполагаемый Песах) обязан наступать на равноденствие или после него.
 */
function shouldStartNewYear(monthStart: Date): boolean {
  const startYmd = jerusalemYMD(monthStart);
  const day14Ymd = ymdAddDays(startYmd, 13);
  const day14Sunset = sunsetFor(day14Ymd);
  const day14Start = day14Sunset ? biblicalDayStart(day14Sunset) : biblicalDayStart(monthStart);

  // Равноденствие обычно приходится на конец февраля/март по юлианскому счёту месяцев —
  // используем год, соответствующий календарной дате начала месяца.
  const equinoxStart = equinoxBiblicalDayStart(startYmd.y);

  return day14Start.getTime() >= equinoxStart.getTime();
}

/**
 * Строит последовательность синодических месяцев с 1 по (12 или 13), покрывающую диапазон
 * [rangeStart, rangeEnd].
 *
 * ВАЖНО про самокоррекцию нумерации. Первый месяц последовательности не привязан ни к
 * какому известному Нисану — ему присваивается номер 1 произвольно, и корректный номер
 * устанавливается только когда впервые сработает правило равноденствия на границе 12→1.
 * Эмпирическая проверка (см. историю чата) показала, что при "плохой" стартовой фазе
 * (например, если условный месяц 1 случайно попадает на середину лета) это самоисправление
 * может занять не "первый год", а до ~25 лет: без вставки 13-го месяца Нисан дрейфует
 * назад примерно на 11 дней в год (12 синодических месяцев короче солнечного года), и
 * лишь когда он естественным образом попадает в окно перед равноденствием, впервые
 * добавляется 13-й месяц и год "цепляется" за правильную фазу. Поэтому LOOKBACK_YEARS
 * ниже — не декоративный запас, а обязательный разбег для сходимости алгоритма.
 */
const LOOKBACK_YEARS = 30;
const MS_PER_YEAR = 365 * 24 * 3600 * 1000;

export function buildBiblicalMonths(rangeStart: Date, rangeEnd: Date): BiblicalMonth[] {
  const months: BiblicalMonth[] = [];

  let cursor = new Date(rangeStart.getTime() - LOOKBACK_YEARS * MS_PER_YEAR);
  let counter = 1;
  let yearIndex = 1;

  let current = findNextMonthStart(cursor);

  while (current.start.getTime() < rangeEnd.getTime()) {
    const next = findNextMonthStart(current.start);

    const isLeap = counter >= 13;
    months.push({
      number: isLeap ? 13 : counter,
      isLeap,
      start: current.start,
      end: next.start,
      yearIndex,
      fallback: current.fallback,
    });

    if (counter >= 12) {
      if (shouldStartNewYear(next.start)) {
        counter = 1;
        yearIndex += 1;
      } else {
        counter += 1;
      }
    } else {
      counter += 1;
    }

    cursor = current.start;
    current = next;
    if (months.length > 900) break; // защита от зацикливания
  }

  // Месяцы из "разбега" (LOOKBACK_YEARS до rangeStart) нужны были только чтобы
  // нумерация успела сойтись к правильной фазе — самому вызывающему коду они
  // не нужны и только раздували бы массив/линейный поиск в findBiblicalMonthFor.
  // Оставляем один месяц, начинающийся до rangeStart (чтобы дата ровно на
  // границе диапазона тоже нашлась), остальной "разбег" отбрасываем.
  const firstRelevantIdx = months.findIndex((m) => m.end.getTime() > rangeStart.getTime());
  return firstRelevantIdx > 0 ? months.slice(firstRelevantIdx) : months;
}

/** Ищет месяц, которому принадлежит указанный момент времени. */
export function findBiblicalMonthFor(months: BiblicalMonth[], instant: Date): BiblicalMonth | null {
  const t = instant.getTime();
  for (const month of months) {
    if (t >= month.start.getTime() && t < month.end.getTime()) return month;
  }
  return null;
}

export interface BiblicalDayInfo {
  /** Номер дня в синодическом месяце (1..30). */
  dayOfMonth: number;
  /** Месяц, к которому относится день, если удалось определить. */
  month: BiblicalMonth | null;
}

/** Возвращает номер дня синодического месяца и сам месяц для произвольного момента времени. */
export function getBiblicalDayInfo(months: BiblicalMonth[], instant: Date): BiblicalDayInfo {
  const dayStart = biblicalDayStart(instant);
  const month = findBiblicalMonthFor(months, dayStart);
  if (!month) return { dayOfMonth: 0, month: null };
  const diffDays = Math.round((dayStart.getTime() - month.start.getTime()) / (24 * 3600 * 1000));
  return { dayOfMonth: diffDays + 1, month };
}
