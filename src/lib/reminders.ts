/**
 * Общая логика для напоминаний — используется и в браузере (мгновенные
 * уведомления, пока открыт сайт), и на сервере (cron-проверка для push).
 */

/** Часовой пояс приложения. Если у вас другой — поменяйте здесь и один раз
 * заново задеплойте (в drizzle-миграции это не участвует). */
export const APP_TIMEZONE = "Europe/Moscow";

export type ReminderRow = {
  id: number;
  title: string;
  kind: string; // 'date' | 'weekly'
  date: string | null;
  weekday: number | null;
  time: string | null;
  lastNotifiedDate: string | null;
};

/** Текущие дата/время/день недели в часовом поясе приложения. */
export function nowInAppTimezone(): { dateISO: string; hhmm: string; weekday: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dateISO = `${get("year")}-${get("month")}-${get("day")}`;
  const hhmm = `${get("hour")}:${get("minute")}`;
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = weekdayMap[get("weekday")] ?? new Date().getDay();
  return { dateISO, hhmm, weekday };
}

/**
 * "Созрело" ли напоминание прямо сейчас: сегодня подходящий день, время уже
 * наступило (если оно указано), и сегодня ещё не уведомляли по нему.
 */
export function isReminderDueNow(
  r: ReminderRow,
  today: { dateISO: string; hhmm: string; weekday: number }
): boolean {
  if (r.lastNotifiedDate === today.dateISO) return false; // уже уведомляли сегодня
  const dayMatches =
    (r.kind === "date" && r.date === today.dateISO) ||
    (r.kind === "weekly" && r.weekday === today.weekday);
  if (!dayMatches) return false;
  if (r.time && r.time > today.hhmm) return false; // время ещё не наступило
  return true;
}
