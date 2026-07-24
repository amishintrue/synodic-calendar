"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MOON_SPRITE,
  addDaysISO,
  isNewMoon,
  moonPhaseName,
  moonPhaseTrig2,
  moonTilePosition,
  parseISO,
  synodicDayFor,
  toISO,
  todayISO,
  weekdayOfISO,
} from "@/lib/moon";

type Observation = { id: number; date: string; comment: string | null };
type Reminder = {
  id: number;
  title: string;
  kind: "date" | "weekly";
  date: string | null;
  weekday: number | null;
  time: string | null;
};

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const WEEKDAYS_FULL = [
  "Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота",
];
const WEEKDAYS_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

function MoonIcon({ moonDay, size = 34 }: { moonDay: number; size?: number }) {
  const tile = moonTilePosition(moonDay);
  const s = size / MOON_SPRITE.tileH;
  if (!tile) {
    // Новолуние — тёмный диск
    return (
      <div
        className="rounded-full border border-slate-600 bg-slate-950"
        style={{ width: size * 0.82, height: size * 0.82 }}
        title="Новолуние"
      />
    );
  }
  return (
    <div
      style={{
        width: MOON_SPRITE.tileW * s,
        height: MOON_SPRITE.tileH * s,
        backgroundImage: "url(/images/moon-phases.png)",
        backgroundSize: `${MOON_SPRITE.width * s}px ${MOON_SPRITE.height * s}px`,
        backgroundPosition: `-${tile.x * s}px -${tile.y * s}px`,
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}

export default function MoonCalendar() {
  const today = todayISO();
  const t = parseISO(today);

  const [viewYear, setViewYear] = useState(t.y);
  const [viewMonth, setViewMonth] = useState(t.m); // 1..12
  const [observations, setObservations] = useState<Observation[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [weekStart, setWeekStart] = useState<"sunday" | "monday">("sunday");
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [notifPerm, setNotifPerm] = useState<string>("default");

  // Форма напоминания
  const [remTitle, setRemTitle] = useState("");
  const [remKind, setRemKind] = useState<"date" | "weekly">("date");
  const [remTime, setRemTime] = useState("");
  const [saving, setSaving] = useState(false);

  // Комментарий к наблюдению
  const [obsComment, setObsComment] = useState("");

  const loadAll = useCallback(async () => {
    const [obsRes, remRes, setRes] = await Promise.all([
      fetch("/api/observations"),
      fetch("/api/reminders"),
      fetch("/api/settings"),
    ]);
    setObservations(await obsRes.json());
    setReminders(await remRes.json());
    const s = await setRes.json();
    if (s.weekStart === "monday" || s.weekStart === "sunday") setWeekStart(s.weekStart);
    setLoaded(true);
  }, []);

  useEffect(() => {
    loadAll();
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotifPerm(Notification.permission);
    }
  }, [loadAll]);

  // При открытии дня подставляем в поле уже сохранённый комментарий (если есть)
  useEffect(() => {
    if (selected) {
      setObsComment(obsByDate.get(selected)?.comment ?? "");
    } else {
      setObsComment("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const obsDates = useMemo(
    () => observations.map((o) => o.date).sort(),
    [observations]
  );
  const obsByDate = useMemo(
    () => new Map(observations.map((o) => [o.date, o])),
    [observations]
  );

  /* ---------- Уведомления о приближении нового месяца ---------- */
  const todaySynodic = synodicDayFor(today, obsDates);
  const todayPhase = moonPhaseTrig2(t.y, t.m, t.d);

  let moonAlert: { text: string; kind: "warn" | "info" } | null = null;
  if (todaySynodic && todaySynodic.day >= 29) {
    moonAlert = {
      text: `Идёт ${todaySynodic.day}-й день синодического месяца — приближается новый месяц! Наблюдайте молодую луну на вечернем небе и отметьте день наблюдения.`,
      kind: "warn",
    };
  } else if (!todaySynodic && isNewMoon(todayPhase)) {
    moonAlert = {
      text: "Сегодня новолуние (по расчёту). В ближайшие вечера ожидается появление нового месяца — отметьте день его наблюдения в календаре.",
      kind: "info",
    };
  }

  const todaysReminders = useMemo(() => {
    const wd = weekdayOfISO(today);
    return reminders.filter(
      (r) => (r.kind === "date" && r.date === today) || (r.kind === "weekly" && r.weekday === wd)
    );
  }, [reminders, today]);

  // Системное уведомление (раз в день)
  useEffect(() => {
    if (!loaded || typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const guard = `moon-notified-${today}`;
    if (localStorage.getItem(guard)) return;
    const lines: string[] = [];
    if (moonAlert) lines.push(moonAlert.text);
    for (const r of todaysReminders) lines.push(`Напоминание: ${r.title}${r.time ? " в " + r.time : ""}`);
    if (lines.length > 0) {
      new Notification("Лунный календарь", { body: lines.join("\n") });
      localStorage.setItem(guard, "1");
    }
  }, [loaded, moonAlert, todaysReminders, today]);

  /* ---------- Сетка месяца ---------- */
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const firstWd = weekdayOfISO(toISO(viewYear, viewMonth, 1)); // 0=Вс
  const startOffset = weekStart === "sunday" ? firstWd : (firstWd + 6) % 7;
  const weekdayOrder = weekStart === "sunday" ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];

  const cells: (string | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toISO(viewYear, viewMonth, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const remindersFor = useCallback(
    (iso: string) => {
      const wd = weekdayOfISO(iso);
      return reminders.filter(
        (r) => (r.kind === "date" && r.date === iso) || (r.kind === "weekly" && r.weekday === wd)
      );
    },
    [reminders]
  );

  /* ---------- Действия ---------- */
  const navigate = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setViewMonth(m); setViewYear(y);
  };

  const toggleWeekStart = async () => {
    const next = weekStart === "sunday" ? "monday" : "sunday";
    setWeekStart(next);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "weekStart", value: next }),
    });
  };

  const toggleObservation = async (iso: string, comment?: string) => {
    const exists = obsDates.includes(iso);
    const res = exists
      ? await fetch(`/api/observations?date=${iso}`, { method: "DELETE" })
      : await fetch("/api/observations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: iso, comment }),
        });
    setObservations(await res.json());
  };

  // Сохранить/изменить комментарий, не снимая отметку наблюдения
  const saveComment = async (iso: string, comment: string) => {
    const res = await fetch("/api/observations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: iso, comment }),
    });
    setObservations(await res.json());
  };

  const addReminder = async () => {
    if (!selected || !remTitle.trim()) return;
    setSaving(true);
    const res = await fetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: remTitle,
        kind: remKind,
        date: selected,
        weekday: weekdayOfISO(selected),
        time: remTime || undefined,
      }),
    });
    if (res.ok) {
      const row = await res.json();
      setReminders((prev) => [...prev, row]);
      setRemTitle(""); setRemTime("");
    }
    setSaving(false);
  };

  const deleteReminder = async (id: number) => {
    await fetch(`/api/reminders/${id}`, { method: "DELETE" });
    setReminders((prev) => prev.filter((r) => r.id !== id));
  };

  const requestNotifications = async () => {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setNotifPerm(p);
  };

  /* ---------- Рендер ---------- */
  const selInfo = selected
    ? {
        iso: selected,
        p: parseISO(selected),
        phase: moonPhaseTrig2(parseISO(selected).y, parseISO(selected).m, parseISO(selected).d),
        syn: synodicDayFor(selected, obsDates),
        isObs: obsDates.includes(selected),
        rems: remindersFor(selected),
      }
    : null;

  return (
    <div className="mx-auto max-w-3xl px-2 pb-16 pt-4 sm:px-4">
      {/* Заголовок */}
      <header className="mb-3 flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-100 sm:text-2xl">
          <span className="text-2xl">🌙</span> Лунный календарь
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleWeekStart}
            className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            title="Первый день недели"
          >
            Неделя с: <b className="text-sky-300">{weekStart === "sunday" ? "Вс" : "Пн"}</b>
          </button>
          {notifPerm !== "granted" && (
            <button
              onClick={requestNotifications}
              className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            >
              🔔 Разрешить
            </button>
          )}
        </div>
      </header>

      {/* Баннеры */}
      {moonAlert && (
        <div
          className={`mb-3 rounded-xl border px-4 py-3 text-sm ${
            moonAlert.kind === "warn"
              ? "border-amber-500/50 bg-amber-500/10 text-amber-200"
              : "border-sky-500/50 bg-sky-500/10 text-sky-200"
          }`}
        >
          {moonAlert.kind === "warn" ? "⚠️ " : "🌑 "}
          {moonAlert.text}
        </div>
      )}
      {todaysReminders.length > 0 && (
        <div className="mb-3 rounded-xl border border-violet-500/50 bg-violet-500/10 px-4 py-3 text-sm text-violet-200">
          🔔 Сегодня:{" "}
          {todaysReminders.map((r) => r.title + (r.time ? ` (${r.time})` : "")).join("; ")}
        </div>
      )}

      {/* Навигация по месяцам */}
      <div className="mb-2 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-2 py-2">
        <button onClick={() => navigate(-1)} className="rounded-lg px-3 py-1.5 text-xl text-slate-300 hover:bg-slate-800" aria-label="Предыдущий месяц">‹</button>
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-slate-100 sm:text-lg">
            {MONTHS[viewMonth - 1]} {viewYear}
          </span>
          <button
            onClick={() => { setViewYear(t.y); setViewMonth(t.m); }}
            className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
          >
            Сегодня
          </button>
        </div>
        <button onClick={() => navigate(1)} className="rounded-lg px-3 py-1.5 text-xl text-slate-300 hover:bg-slate-800" aria-label="Следующий месяц">›</button>
      </div>

      {/* Дни недели */}
      <div className="grid grid-cols-7 gap-1">
        {weekdayOrder.map((wd) => (
          <div
            key={wd}
            className={`py-1 text-center text-xs font-semibold uppercase ${
              wd === 0 || wd === 6 ? "text-rose-400" : "text-slate-400"
            }`}
          >
            {WEEKDAYS_SHORT[wd]}
          </div>
        ))}
      </div>

      {/* Сетка */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((iso, idx) => {
          if (!iso) return <div key={idx} className="min-h-[72px] rounded-lg bg-slate-900/40 sm:min-h-[86px]" />;
          const p = parseISO(iso);
          const phase = moonPhaseTrig2(p.y, p.m, p.d);
          const syn = synodicDayFor(iso, obsDates);
          const isObs = obsDates.includes(iso);
          const isFirstSyn = syn?.day === 1;
          const isToday = iso === today;
          const rems = remindersFor(iso);

          const dayComment = obsByDate.get(iso)?.comment ?? null;
          return (
            <div key={iso} className="group relative">
              <button
                onClick={() => { setSelected(iso); setRemKind("date"); setRemTitle(""); setRemTime(""); }}
                className={`relative flex min-h-[72px] w-full flex-col items-center justify-center rounded-lg border bg-black p-0.5 transition hover:border-sky-500 sm:min-h-[86px] ${
                  isToday
                    ? "border-white ring-1 ring-white"
                    : isFirstSyn
                      ? "border-amber-400 ring-1 ring-amber-400"
                      : isObs
                        ? "border-emerald-400 ring-1 ring-emerald-400"
                        : "border-slate-800"
                }`}
              >
                {/* Число солнечного месяца — вверху слева */}
                <span className="absolute left-1 top-0.5 text-[11px] font-bold leading-4 text-sky-300 sm:text-sm">
                  {p.d}
                </span>
                {/* Отметка наблюдения */}
                {isObs && (
                  <span className="absolute right-1 top-0.5 text-[10px]">👁️</span>
                )}
                {/* Пиктограмма */}
                <MoonIcon moonDay={phase} size={30} />
                {/* Число синодического месяца — внизу справа */}
                {syn && syn.day >= 1 && (
                  <span
                    className={`absolute bottom-0.5 right-1 text-[11px] font-bold leading-4 sm:text-sm ${
                      syn.day > 30 ? "text-rose-400" : "text-amber-400"
                    }`}
                  >
                    {syn.day}
                  </span>
                )}
                {/* Напоминания */}
                {rems.length > 0 && (
                  <span className="absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full bg-violet-400" />
                )}
              </button>
              {/* Кастомная подсказка при наведении (нужна, чтобы комментарий можно было выделить жирным) */}
              <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden w-max max-w-[220px] -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] leading-snug text-slate-200 shadow-lg group-hover:block">
                <div>
                  {p.d} {MONTHS[p.m - 1]}: {moonPhaseName(phase)} (лунный день {phase})
                </div>
                {dayComment && <div className="mt-1 font-bold text-amber-300">{dayComment}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Список напоминаний */}
      <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-2 text-sm font-bold text-slate-200">🔔 Мои напоминания</h2>
        {reminders.length === 0 && (
          <p className="text-xs text-slate-500">Пока нет напоминаний. Нажмите на день календаря, чтобы добавить.</p>
        )}
        <ul className="space-y-1.5">
          {reminders.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-800/60 px-3 py-2 text-sm">
              <span className="text-slate-200">
                {r.title}
                <span className="ml-2 text-xs text-slate-400">
                  {r.kind === "date"
                    ? `📅 ${r.date?.split("-").reverse().join(".")}`
                    : `🔁 каждый(-ую) ${WEEKDAYS_FULL[r.weekday ?? 0].toLowerCase()}`}
                  {r.time ? ` · ${r.time}` : ""}
                </span>
              </span>
              <button
                onClick={() => deleteReminder(r.id)}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10"
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Модальное окно дня */}
      {selInfo && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-4 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-100">
                  {selInfo.p.d} {MONTHS[selInfo.p.m - 1].toLowerCase()} {selInfo.p.y}
                </h3>
                <p className="text-xs text-slate-400">{WEEKDAYS_FULL[weekdayOfISO(selInfo.iso)]}</p>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800">✕</button>
            </div>

            <div className="mb-3 flex items-center gap-3 rounded-xl bg-black p-3">
              <MoonIcon moonDay={selInfo.phase} size={46} />
              <div className="text-sm">
                <div className="text-slate-200">{moonPhaseName(selInfo.phase)}</div>
                <div className="text-xs text-slate-400">Лунный день по расчёту: {selInfo.phase}</div>
                {selInfo.syn && selInfo.syn.day >= 1 ? (
                  <div className="text-xs text-amber-400">
                    {selInfo.syn.day}-й день синодического месяца
                    {selInfo.syn.day === 1 ? " — первый день! 🌒" : ""}
                    <span className="text-slate-500">
                      {" "}(наблюдение {selInfo.syn.observationISO.split("-").reverse().join(".")})
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">Нумерация начнётся после отметки наблюдения</div>
                )}
              </div>
            </div>

            <button
              onClick={() => toggleObservation(selInfo.iso, obsComment)}
              className={`mb-2 w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                selInfo.isObs
                  ? "bg-rose-600/20 text-rose-300 hover:bg-rose-600/30"
                  : "bg-emerald-600 text-white hover:bg-emerald-500"
              }`}
            >
              {selInfo.isObs
                ? "✕ Снять отметку наблюдения нового месяца"
                : "👁️ Я наблюдал(а) новый месяц этим вечером"}
            </button>
            {!selInfo.isObs && (
              <p className="-mt-1 mb-2 text-[11px] text-slate-500">
                Следующий день ({addDaysISO(selInfo.iso, 1).split("-").reverse().join(".")}) станет 1-м днём синодического месяца.
              </p>
            )}

            {/* Комментарий к наблюдению */}
            <div className="mb-4">
              <label className="mb-1 block text-xs font-bold uppercase text-slate-400">
                Комментарий (необязательно)
              </label>
              <textarea
                value={obsComment}
                onChange={(e) => setObsComment(e.target.value)}
                placeholder="Например: было облачно, плохая видимость…"
                rows={2}
                className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-sky-500"
              />
              {selInfo.isObs && (
                <button
                  onClick={() => saveComment(selInfo.iso, obsComment)}
                  className="mt-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  💾 Сохранить комментарий
                </button>
              )}
            </div>

            {/* Напоминания этого дня */}
            {selInfo.rems.length > 0 && (
              <div className="mb-3">
                <h4 className="mb-1.5 text-xs font-bold uppercase text-slate-400">Напоминания в этот день</h4>
                <ul className="space-y-1">
                  {selInfo.rems.map((r) => (
                    <li key={r.id} className="flex items-center justify-between rounded-lg bg-slate-800/60 px-3 py-1.5 text-sm text-slate-200">
                      <span>
                        {r.title}
                        <span className="ml-1 text-xs text-slate-400">
                          {r.kind === "weekly" ? "(еженедельно)" : ""} {r.time ?? ""}
                        </span>
                      </span>
                      <button onClick={() => deleteReminder(r.id)} className="text-xs text-rose-400">✕</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Форма нового напоминания */}
            <div className="rounded-xl border border-slate-700 p-3">
              <h4 className="mb-2 text-xs font-bold uppercase text-slate-400">Новое напоминание</h4>
              <input
                value={remTitle}
                onChange={(e) => setRemTitle(e.target.value)}
                placeholder="Текст напоминания…"
                className="mb-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-sky-500"
              />
              <div className="mb-2 flex flex-wrap gap-2 text-xs">
                <label className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${remKind === "date" ? "border-sky-500 bg-sky-500/10 text-sky-300" : "border-slate-700 text-slate-400"}`}>
                  <input type="radio" className="hidden" checked={remKind === "date"} onChange={() => setRemKind("date")} />
                  📅 На эту дату
                </label>
                <label className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${remKind === "weekly" ? "border-sky-500 bg-sky-500/10 text-sky-300" : "border-slate-700 text-slate-400"}`}>
                  <input type="radio" className="hidden" checked={remKind === "weekly"} onChange={() => setRemKind("weekly")} />
                  🔁 Каждый(-ую) {WEEKDAYS_FULL[weekdayOfISO(selInfo.iso)].toLowerCase()}
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={remTime}
                  onChange={(e) => setRemTime(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
                />
                <button
                  onClick={addReminder}
                  disabled={saving || !remTitle.trim()}
                  className="flex-1 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:opacity-40"
                >
                  {saving ? "Сохранение…" : "Добавить"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
