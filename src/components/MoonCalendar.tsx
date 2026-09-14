"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { isPastDateTime } from "@/lib/reminders";
import {
  buildBiblicalMonths,
  findBiblicalMonthFor,
  type BiblicalMonth,
} from "@/lib/biblical-calendar";
import { jerusalemYMD } from "@/lib/biblical-astro";
import NoteEditor, { NoteEditorHandle } from "@/components/NoteEditor";
import {
  getUserLocation,
  getSunMoonTimes,
  localNoonForDate,
  formatTime,
  type LocationResult,
} from "@/lib/sun-moon";

type Observation = { id: number; date: string };
type Note = { date: string; comment: string };
/** Одна ячейка календарной сетки: либо реальный день (с григорианским
 * днём месяца в углу), либо `null` для пустой клетки-заполнителя. */
type GridCell = { iso: string } | null;
type Reminder = {
  id: number;
  title: string;
  kind: "date" | "weekly";
  date: string | null;
  weekday: number | null;
  time: string | null;
};

const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];
/** Родительный падеж — для дат вида «21 августа», «1 июля» в модалке дня. */
const MONTHS_GEN = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
const WEEKDAYS_FULL = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
];
const WEEKDAYS_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

/** VAPID-ключ приходит в base64url — Web Push API ожидает Uint8Array. */
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

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

function showPicker(el: HTMLInputElement | null) {
  try {
    (el as any)?.showPicker?.();
  } catch {
    // ignore
  }
}

export default function MoonCalendar() {
  // Какой месяц открыт по умолчанию. Берём ленивым инициализатором, чтобы
  // на клиенте это было реальное «сегодня» (на сервере/при сборке — дата
  // сборки, что влияет лишь на изначально открытый месяц, не на подсветку).
  const [viewYear, setViewYear] = useState<number>(() => parseISO(todayISO()).y);
  const [viewMonth, setViewMonth] = useState<number>(() => parseISO(todayISO()).m); // 1..12

  // «Сегодня» вычисляем ТОЛЬКО на клиенте и только после монтирования.
  // Страница строится статически (нет export const dynamic), поэтому при
  // пререндере вызов new Date() «замораживается» на дату сборки/деплоя —
  // и рамка текущего дня оставалась от даты последнего деплоя, а не от
  // реального сегодняшнего числа. null во время SSR и первого рендера =>
  // подсветки ещё нет (и нет рассинхрона с серверным HTML), а после
  // монтирования берём актуальную дату из клиентских часов.
  const [today, setToday] = useState<string | null>(null);
  const t = today ? parseISO(today) : null;
  const [observations, setObservations] = useState<Observation[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [weekStart, setWeekStart] = useState<"sunday" | "monday">("sunday");
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [notifPerm, setNotifPerm] = useState<string>("default");

  // Режим календарной сетки: григорианский (как раньше) или библейский
  // (сетка перестраивается под текущий синодический месяц библейского года).
  const [calendarMode, setCalendarMode] = useState<"gregorian" | "biblical">("gregorian");
  // Последовательность библейских месяцев считается один раз за сессию —
  // это довольно тяжёлые астрономические вычисления (поиск соединений,
  // заката/захода луны в Иерусалиме для ~6 лет), поэтому уводим их в
  // отдельный тик, чтобы не блокировать первую отрисовку календаря.
  const [biblicalMonths, setBiblicalMonths] = useState<BiblicalMonth[]>([]);
  const [biblicalReady, setBiblicalReady] = useState(false);
  // Индекс просматриваемого месяца внутри biblicalMonths (используется
  // только в библейском режиме сетки — навигация ‹ › двигает этот индекс).
  const [viewedBiblicalIndex, setViewedBiblicalIndex] = useState<number | null>(null);

  // Дата, когда пользователь последний раз подтвердил предупреждение о
  // приближении нового месяца ("Я помню") — переиспользуем существующее
  // поле settings.lastMoonAlertDate: оно же гасит дневной push (см. cron)
  // и модалку на сегодня.
  const [moonAlertAckDate, setMoonAlertAckDate] = useState<string>("");

  // Местоположение пользователя для восхода/захода Солнца и Луны в модалке
  // дня. Определяется один раз за сессию (браузерный Geolocation API, с
  // запасным вариантом — Иерусалим, если геолокация отключена/недоступна).
  const [location, setLocation] = useState<LocationResult | null>(null);

  // Форма напоминания
  const [remTitle, setRemTitle] = useState("");
  const [remKind, setRemKind] = useState<"date" | "weekly">("date");
  const [remTime, setRemTime] = useState("");
  const [saving, setSaving] = useState(false);

  // Редактирование существующего напоминания
  const [editingReminderId, setEditingReminderId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editKind, setEditKind] = useState<"date" | "weekly">("date");
  const [editDate, setEditDate] = useState("");
  const [editWeekday, setEditWeekday] = useState(0);
  const [editTime, setEditTime] = useState("");
  const [showPast, setShowPast] = useState(false);

  const remTitleInputRef = useRef<HTMLInputElement>(null);
  const remTimeInputRef = useRef<HTMLInputElement>(null);
  const editTimeInputRef = useRef<HTMLInputElement>(null);
  const editDateInputRef = useRef<HTMLInputElement>(null);
  const editWeekdaySelectRef = useRef<HTMLSelectElement>(null);
  const editTitleInputRef = useRef<HTMLInputElement>(null);
  const noteEditorRef = useRef<NoteEditorHandle>(null);

  const loadAll = useCallback(async () => {
    try {
      const [obsRes, remRes, setRes, notesRes] = await Promise.all([
        fetch("/api/observations"),
        fetch("/api/reminders"),
        fetch("/api/settings"),
        fetch("/api/notes"),
      ]);
      setObservations(await obsRes.json());
      setReminders(await remRes.json());
      const s = await setRes.json();
      if (s.weekStart === "monday" || s.weekStart === "sunday") setWeekStart(s.weekStart);
      setMoonAlertAckDate(typeof s.lastMoonAlertDate === "string" ? s.lastMoonAlertDate : "");
      setCalendarMode(s.calendarMode === "biblical" ? "biblical" : "gregorian");
      setNotes(await notesRes.json());
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoaded(true);
    }
  }, []);

  // «Сегодня» держим актуальным: обновляем раз в минуту (чтобы рамка
  // переехала на новый день в полночь, даже если вкладка всё время открыта)
  // и дополнительно — при возвращении в приложение из фона.
  useEffect(() => {
    const update = () => setToday(todayISO());
    update();
    const interval = setInterval(update, 60_000);
    const wake = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("pageshow", wake);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("pageshow", wake);
    };
  }, []);

  /* ---------- Кнопка «назад» (браузерная) ----------
   * Приоритет: редактирование напоминания → модалка дня. Пока открыт
   * хоть один оверлей, в истории держится «страховочный» pushState, чтобы
   * «назад» закрывал оверлей, а не уводило со страницы. Когда всё закрыто —
   * запись убирается и «назад» работает как обычно. */
  useEffect(() => {
    const overlayOpen = editingReminderId !== null || !!selected;
    if (!overlayOpen) return;

    let alive = true;
    history.pushState(null, "", window.location.href);

    const handlePopState = (e: PopStateEvent) => {
      if (!alive) return;
      e.preventDefault();
      if (editingReminderId !== null) {
        setEditingReminderId(null);
      } else if (selected) {
        setSelected(null);
      }
      history.pushState(null, "", window.location.href);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      alive = false;
      window.removeEventListener("popstate", handlePopState);
      history.back();
    };
  }, [selected, editingReminderId]);

  const ensurePushSubscription = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) return; // push ещё не настроен (нет ключей на сервере)
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
    } catch (err) {
      console.error("Не удалось оформить push-подписку:", err);
    }
  }, []);

  useEffect(() => {
    // Асинхронная загрузка данных (setState внутри loadAll происходит уже
    // после await'ов, не синхронно в теле эффекта).
    void Promise.resolve().then(loadAll);
    if (typeof window !== "undefined" && "Notification" in window) {
      const permission = Notification.permission;
      if (permission === "granted") ensurePushSubscription();
      // Отложенно, чтобы не вызывать setState синхронно в теле эффекта.
      Promise.resolve().then(() => setNotifPerm(permission));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAll]);

  // Строим последовательность библейских месяцев (±3 года от момента
  // запуска приложения) один раз за сессию. Расчёт полностью автономный
  // (не зависит от отметок наблюдения пользователя, см. lib/biblical-calendar.ts)
  // и не блокирует первую отрисовку — запускается в отдельном тике.
  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const rangeStart = new Date(now.getTime() - 3 * 365 * 24 * 3600 * 1000);
    const rangeEnd = new Date(now.getTime() + 3 * 365 * 24 * 3600 * 1000);
    const timer = setTimeout(() => {
      try {
        const months = buildBiblicalMonths(rangeStart, rangeEnd);
        if (!cancelled) setBiblicalMonths(months);
      } catch (error) {
        console.error("Failed to build biblical months:", error);
      } finally {
        if (!cancelled) setBiblicalReady(true);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Индекс библейского месяца, содержащего сегодняшний день (последний
  // элемент последовательности — запасной вариант, если «сегодня» не
  // нашлось). Используется, пока пользователь ещё не листал библейскую
  // сетку вручную (viewedBiblicalIndex === null).
  const todayBiblicalIndex = useMemo(() => {
    if (!biblicalReady || !today || biblicalMonths.length === 0) return null;
    const { y, m, d } = parseISO(today);
    const noon = new Date(y, m - 1, d, 12, 0, 0, 0);
    const idx = biblicalMonths.findIndex(
      (bm) => noon.getTime() >= bm.start.getTime() && noon.getTime() < bm.end.getTime()
    );
    return idx >= 0 ? idx : biblicalMonths.length - 1;
  }, [biblicalReady, today, biblicalMonths]);

  // Фактически просматриваемый индекс: выбор пользователя важнее «сегодня».
  const effectiveBiblicalIndex = viewedBiblicalIndex ?? todayBiblicalIndex;

  // Определяем местоположение при первом открытии модалки дня, а не сразу
  // при запуске приложения — геолокация нужна только для восхода/захода,
  // который виден только внутри этой модалки, так что не просим разрешение
  // раньше, чем оно реально понадобится пользователю. getUserLocation()
  // сама кэширует результат на сессию, так что при повторных открытиях
  // модалки повторного запроса к ОС не будет.
  useEffect(() => {
    if (!selected || location) return;
    let cancelled = false;
    getUserLocation().then((loc) => {
      if (!cancelled) setLocation(loc);
    });
    return () => {
      cancelled = true;
    };
  }, [selected, location]);

  const obsDates = useMemo(
    () => observations.map((o) => o.date).sort(),
    [observations]
  );
  const obsByDate = useMemo(
    () => new Map(observations.map((o) => [o.date, o])),
    [observations]
  );
  const notesByDate = useMemo(
    () => new Map(notes.map((n) => [n.date, n])),
    [notes]
  );

  // Предстоящие и прошедшие одноразовые напоминания — прошедшие скрываем
  // по умолчанию, чтобы список не захламлялся.
  const upcomingReminders = useMemo(
    () => reminders.filter((r) => !(today && r.kind === "date" && r.date && r.date < today)),
    [reminders, today]
  );
  const pastReminders = useMemo(
    () => reminders.filter((r) => today && r.kind === "date" && r.date && r.date < today),
    [reminders, today]
  );

  /* ---------- Уведомления о приближении нового месяца ---------- */
  const todaySynodic = today ? synodicDayFor(today, obsDates) : null;
  const todayPhase = t ? moonPhaseTrig2(t.y, t.m, t.d) : 0;

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

  // Показываем модалку (не просто баннер), пока пользователь явно не
  // подтвердит "Я помню" сегодня — чтобы окно наблюдения было не пропустить,
  // даже если баннер в потоке страницы никто не заметил. Подтверждение
  // сохраняется в settings.lastMoonAlertDate (тот же ключ использует
  // серверный cron, чтобы не слать повторный push в тот же день).
  const moonAlertActive = loaded && !!moonAlert && !!today && moonAlertAckDate !== today;

  const todaysReminders = useMemo(() => {
    if (!today) return [];
    const wd = weekdayOfISO(today);
    return reminders.filter(
      (r) =>
        (r.kind === "date" && r.date === today) ||
        (r.kind === "weekly" && r.weekday === wd)
    );
  }, [reminders, today]);

  // Уведомления в браузере, пока сайт открыт: проверяем раз в минуту и
  // учитываем точное время каждого напоминания (а не только день).
  //
  // Важно: если на странице зарегистрирован service worker (а он теперь
  // регистрируется всегда, из-за push-подписки), некоторые браузеры
  // (в частности Chrome на Android) запрещают вызывать `new Notification()`
  // напрямую и выбрасывают ошибку — нужно показывать уведомление именно
  // через registration.showNotification().
  const showLocalNotification = useCallback(async (body: string) => {
    try {
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.showNotification("Лунный календарь", { body });
          return;
        }
      }
      new Notification("Лунный календарь", { body });
    } catch (err) {
      console.error("Не удалось показать уведомление:", err);
    }
  }, []);

  useEffect(() => {
    if (!loaded || typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const check = () => {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      if (moonAlert) {
        const key = `moon-notified-${today}`;
        if (!localStorage.getItem(key)) {
          showLocalNotification(moonAlert.text);
          localStorage.setItem(key, "1");
        }
      }
      for (const r of todaysReminders) {
        if (r.time && r.time > hhmm) continue; // время ещё не наступило
        const key = `rem-notified-${r.id}-${today}`;
        if (localStorage.getItem(key)) continue;
        showLocalNotification(`Напоминание: ${r.title}${r.time ? " в " + r.time : ""}`);
        localStorage.setItem(key, "1");
      }
    };

    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [loaded, moonAlert, todaysReminders, today, showLocalNotification]);

  /* ---------- Сетка месяца ---------- */
  const weekdayOrder = weekStart === "sunday" ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];

  // Просматриваемый библейский месяц (только для режима "Библейский").
  // Индексация в biblicalMonths стабильна между рендерами, поэтому это
  // безопасно использовать напрямую, без отдельного useMemo.
  const viewedBiblicalMonth: BiblicalMonth | null =
    calendarMode === "biblical" && effectiveBiblicalIndex !== null
      ? biblicalMonths[effectiveBiblicalIndex] ?? null
      : null;

  const cells: GridCell[] = [];
  if (calendarMode === "biblical") {
    if (viewedBiblicalMonth) {
      // Диапазон клеток — гражданские дни от дня после вечера неомении до
      // гражданского дня заката следующего месяца. Номера библейских дней
      // в ячейки не выводятся: в обоих режимах в углу — григорианское
      // число, внизу справа — день от наблюдения (см. рендер ниже).
      const startYmd = jerusalemYMD(viewedBiblicalMonth.start);
      const day1ISO = addDaysISO(toISO(startYmd.y, startYmd.m, startYmd.d), 1);
      const endYmd = jerusalemYMD(viewedBiblicalMonth.end);

      let iso = day1ISO;
      const lastISO = toISO(endYmd.y, endYmd.m, endYmd.d);
      while (iso <= lastISO) {
        cells.push({ iso });
        iso = addDaysISO(iso, 1);
      }

      const firstWd = weekdayOfISO(day1ISO);
      const startOffset = weekStart === "sunday" ? firstWd : (firstWd + 6) % 7;

      for (let i = 0; i < startOffset; i++) cells.unshift(null);
      while (cells.length % 7 !== 0) cells.push(null);
    }
  } else {
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    const firstWd = weekdayOfISO(toISO(viewYear, viewMonth, 1)); // 0=Вс
    const startOffset = weekStart === "sunday" ? firstWd : (firstWd + 6) % 7;

    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ iso: toISO(viewYear, viewMonth, d) });
    }
    while (cells.length % 7 !== 0) cells.push(null);
  }

  const remindersFor = useCallback(
    (iso: string) => {
      const wd = weekdayOfISO(iso);
      return reminders.filter(
        (r) =>
          (r.kind === "date" && r.date === iso) ||
          (r.kind === "weekly" && r.weekday === wd)
      );
    },
    [reminders]
  );

  // Номер библейского месяца (1..12, изредка 13 — Адар II) для произвольной
  // календарной даты. Полностью автоматический расчёт (см.
  // lib/biblical-calendar.ts) — не связан с ручными отметками наблюдения.
  const biblicalMonthNumberFor = useCallback(
    (iso: string): { number: number; isLeap: boolean } | null => {
      if (!biblicalReady || biblicalMonths.length === 0) return null;
      const { y, m, d } = parseISO(iso);
      // Локальный полдень — безопасная точка отсчёта, не задевающая границу
      // библейских суток (см. аналогичный приём в lib/sun-moon.ts).
      const noon = new Date(y, m - 1, d, 12, 0, 0, 0);
      const month = findBiblicalMonthFor(biblicalMonths, noon);
      return month ? { number: month.number, isLeap: month.isLeap } : null;
    },
    [biblicalMonths, biblicalReady]
  );

  /* ---------- Действия ---------- */
  const navigateGregorian = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 1) {
      m = 12;
      y--;
    }
    if (m > 12) {
      m = 1;
      y++;
    }
    setViewMonth(m);
    setViewYear(y);
  };

  // В библейском режиме "месяц вперёд/назад" — это соседний элемент уже
  // посчитанной последовательности biblicalMonths, а не арифметика над
  // григорианским годом/месяцем.
  const navigateBiblical = (delta: number) => {
    const idx = effectiveBiblicalIndex;
    if (idx === null) return;
    const next = idx + delta;
    if (next < 0 || next >= biblicalMonths.length) return;
    setViewedBiblicalIndex(next);
  };

  // Общая точка входа для кнопок ‹ › и свайпа — сама решает, какой режим
  // сейчас активен, чтобы не дублировать эту проверку на каждом месте вызова.
  const navigate = (delta: number) => {
    if (calendarMode === "biblical") navigateBiblical(delta);
    else navigateGregorian(delta);
  };

  /* ---------- Свайп для смены месяца ----------
   * ВАЖНО: старая версия хранила X-координаты в useState и брала
   * swipeEndX из onTouchMove. На обычном тапе (например, по дню
   * календаря) палец почти не двигается, поэтому touchmove мог вообще
   * не сработать — swipeEndX оставался "протухшим" от предыдущего
   * жеста (а при самом первом тапе — вообще 0), и на touchEnd diff
   * получался огромным, что ложно триггерило navigate(). Из-за этого
   * при обычном тапе по дню менялся месяц в сетке позади модалки.
   *
   * Исправление: используем ref (без лишних ре-рендеров на каждый
   * touchmove) и считаем итоговый сдвиг прямо в touchend по
   * changedTouches — без промежуточного состояния, которое могло не
   * обновиться. Плюс отсекаем вертикальный скролл (когда dy больше dx).
   */
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current =
      e.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;

    const touch = e.changedTouches[0];
    if (!touch) return;

    const dx = start.x - touch.clientX;
    const dy = start.y - touch.clientY;
    const threshold = 50; // минимальное расстояние свайпа

    // Обычный тап (почти не сдвинулись) или вертикальный скролл —
    // это не свайп месяца, ничего не делаем.
    if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy)) return;

    if (dx > 0) {
      navigate(1); // свайп влево → следующий месяц
    } else {
      navigate(-1); // свайп вправо → предыдущий месяц
    }
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

  const toggleCalendarMode = async () => {
    const next = calendarMode === "gregorian" ? "biblical" : "gregorian";
    setCalendarMode(next);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "calendarMode", value: next }),
    });
  };

  const toggleObservation = async (iso: string) => {
    const exists = obsDates.includes(iso);
    const res = exists
      ? await fetch(`/api/observations?date=${iso}`, { method: "DELETE" })
      : await fetch("/api/observations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: iso }),
        });
    setObservations(await res.json());
  };

  // Сохранить заметку к любому дню (не только к дню наблюдения)
  const handleSaveNote = async (iso: string, comment: string) => {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: iso, comment }),
    });
    setNotes(await res.json());
  };

  /** Дочитать текущее значение поля напрямую из DOM — надёжно даже при
   * активной IME-композиции (кириллица), когда state мог не обновиться. */
  const readInputValue = (
    ref: React.RefObject<HTMLInputElement | null>,
    fallback: string
  ): string => (ref.current ? ref.current.value : fallback);

  const handleAddReminder = async () => {
    if (!selected) return;

    const input = remTitleInputRef.current;

    const proceed = async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;

      // Текущее время — из DOM, а не из state: при нажатии Enter в поле
      // времени state ещё не успел обновиться.
      const time = readInputValue(remTimeInputRef, remTime);

      // Проверка "в прошлом" — только для kind='date' с указанным временем.
      // Еженедельные напоминания срабатывают в ближайший подходящий день
      // недели, так что валидация для них не нужна и была бы ошибочной.
      // Пустое время не валидируем — это "весь день" (срабатывает с утра).
      if (remKind === "date" && time && isPastDateTime(selected, time)) {
        remTimeInputRef.current?.focus();
        setTimeout(() => showPicker(remTimeInputRef.current), 0);
        return;
      }

      setSaving(true);
      try {
        const res = await fetch("/api/reminders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: trimmed,
            kind: remKind,
            date: selected,
            weekday: weekdayOfISO(selected),
            time: time || undefined,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          alert(data?.error ?? "Не удалось сохранить напоминание");
          return;
        }
        const row = await res.json();
        setReminders((prev) => [...prev, row]);
        if (remTitleInputRef.current) remTitleInputRef.current.value = "";
        setRemTitle("");
        setRemTime("");
      } catch (error) {
        console.error("Failed to add reminder:", error);
        alert("Не удалось сохранить напоминание");
      } finally {
        setSaving(false);
      }
    };

    if (input && document.activeElement === input) {
      input.blur();
      requestAnimationFrame(() => {
        setRemTitle(input.value);
        proceed(input.value);
      });
    } else {
      proceed(input?.value ?? remTitle);
    }
  };

  const handleDeleteReminder = async (id: number) => {
    await fetch(`/api/reminders/${id}`, { method: "DELETE" });
    setReminders((prev) => prev.filter((r) => r.id !== id));
    if (editingReminderId === id) setEditingReminderId(null);
  };

  const startEditReminder = (r: Reminder) => {
    setEditingReminderId(r.id);
    setEditTitle(r.title);
    setEditKind(r.kind);
    // Если сейчас открыта модалка дня — по умолчанию подставляем ЕЁ дату
    // (а не сегодняшнюю): так переключение "еженедельно" → "на дату" из
    // модалки конкретного дня даёт ожидаемый результат.
    setEditDate(r.date ?? selected ?? today ?? "");
    setEditWeekday(r.weekday ?? 0);
    setEditTime(r.time ?? "");
  };

  const saveEditedReminder = async (id: number) => {
    const input = editTitleInputRef.current;

    const proceed = async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;

      // Текущее время — из DOM (при Enter в поле времени state ещё старый).
      const time = readInputValue(editTimeInputRef, editTime);

      // Проверка "в прошлом" — только для kind='date' с указанным временем.
      // Еженедельные напоминания срабатывают в ближайший день недели;
      // пустое время — "весь день", его не валидируем.
      if (editKind === "date" && editDate && time && isPastDateTime(editDate, time)) {
        if (editDateInputRef.current) {
          editDateInputRef.current.focus();
          setTimeout(() => showPicker(editDateInputRef.current), 0);
        } else {
          editTimeInputRef.current?.focus();
          setTimeout(() => showPicker(editTimeInputRef.current), 0);
        }
        return;
      }

      try {
        const res = await fetch(`/api/reminders/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: trimmed,
            kind: editKind,
            date: editKind === "date" ? editDate : undefined,
            weekday: editKind === "weekly" ? editWeekday : undefined,
            time: time || undefined,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          alert(data?.error ?? "Не удалось сохранить напоминание");
          return;
        }
        const row = await res.json();
        setReminders((prev) => prev.map((r) => (r.id === id ? row : r)));
        setEditingReminderId(null);
      } catch (error) {
        console.error("Failed to update reminder:", error);
        alert("Не удалось сохранить напоминание");
      }
    };

    if (input && document.activeElement === input) {
      input.blur();
      requestAnimationFrame(() => {
        setEditTitle(input.value);
        proceed(input.value);
      });
    } else {
      proceed(input?.value ?? editTitle);
    }
  };

  // Подтверждение окна наблюдения нового месяца. Тот же ключ settings
  // (lastMoonAlertDate) использует серверный cron — подтверждение заодно
  // гасит и дневной push, чтобы не дублировать предупреждение.
  const acknowledgeMoonAlert = async () => {
    if (!today) return;
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "lastMoonAlertDate", value: today }),
    });
    setMoonAlertAckDate(today);
  };

  const acknowledgeAndObserve = async () => {
    if (!today) return;
    await acknowledgeMoonAlert();
    setSelected(today);
    setRemKind("date");
    setRemTitle("");
    setRemTime("");
  };

  const requestNotifications = async () => {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setNotifPerm(p);
    if (p === "granted") await ensurePushSubscription();
  };

  /* ---------- Handlers для Enter key ---------- */
  const handleRemTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;

    const input = e.currentTarget;

    const run = () => {
      setRemTitle(input.value);
      if (readInputValue(remTimeInputRef, remTime)) {
        handleAddReminder();
      } else {
        // Время не указано — предложим его ввести (напоминание можно
        // сохранить и без времени, это режим "весь день").
        remTimeInputRef.current?.focus();
        setTimeout(() => showPicker(remTimeInputRef.current), 0);
      }
    };

    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      // IME-композиция (русский ввод) — не мешаем, но сначала коммитим слово.
      input.blur();
      requestAnimationFrame(run);
      return;
    }

    e.preventDefault();
    input.blur();
    requestAnimationFrame(run);
  };

  const handleEditTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;

    const input = e.currentTarget;

    const run = () => {
      setEditTitle(input.value);
      if (editKind === "date") {
        editDateInputRef.current?.focus();
      } else {
        editWeekdaySelectRef.current?.focus();
      }
    };

    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      input.blur();
      requestAnimationFrame(run);
      return;
    }

    e.preventDefault();
    input.blur();
    requestAnimationFrame(run);
  };

  const handleEditDateKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;

    const input = e.currentTarget;

    const run = () => {
      setEditDate(input.value);
      editTimeInputRef.current?.focus();
      setTimeout(() => showPicker(editTimeInputRef.current), 0);
    };

    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      input.blur();
      requestAnimationFrame(run);
      return;
    }

    e.preventDefault();
    input.blur();
    requestAnimationFrame(run);
  };

  const handleEditWeekdayKeyDown = (e: React.KeyboardEvent<HTMLSelectElement>) => {
    if (e.key !== "Enter") return;

    const input = e.currentTarget;

    const run = () => {
      setEditWeekday(Number(input.value));
      editTimeInputRef.current?.focus();
      setTimeout(() => showPicker(editTimeInputRef.current), 0);
    };

    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      input.blur();
      requestAnimationFrame(run);
      return;
    }

    e.preventDefault();
    input.blur();
    requestAnimationFrame(run);
  };

  const handleRemTimeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      setRemTime(e.currentTarget.value);
      handleAddReminder();
    }
  };

  const handleEditTimeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      setEditTime(e.currentTarget.value);
      if (editingReminderId !== null) saveEditedReminder(editingReminderId);
    }
  };

  const renderReminderRow = (r: Reminder) => {
    if (editingReminderId === r.id) {
      return (
        <li
          key={r.id}
          className="rounded-lg border border-sky-600/40 bg-slate-800/60 px-3 py-3"
        >
          <input
            ref={editTitleInputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleEditTitleKeyDown}
            className="mb-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
            autoCorrect="on"
            autoCapitalize="sentences"
          />
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <label
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${
                editKind === "date"
                  ? "border-sky-500 bg-sky-500/10 text-sky-300"
                  : "border-slate-700 text-slate-400"
              }`}
            >
              <input
                type="radio"
                className="hidden"
                checked={editKind === "date"}
                onChange={() => setEditKind("date")}
              />{" "}
              📅
            </label>
            {/* Пиктограммы выбора типа — всегда рядом: 📅 затем 🔁 */}
            <label
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${
                editKind === "weekly"
                  ? "border-sky-500 bg-sky-500/10 text-sky-300"
                  : "border-slate-700 text-slate-400"
              }`}
            >
              <input
                type="radio"
                className="hidden"
                checked={editKind === "weekly"}
                onChange={() => setEditKind("weekly")}
              />{" "}
              🔁
            </label>
            {editKind === "date" && (
              <input
                ref={editDateInputRef}
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                onKeyDown={handleEditDateKeyDown}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
              />
            )}
            {editKind === "weekly" && (
              <select
                ref={editWeekdaySelectRef}
                value={editWeekday}
                onChange={(e) => setEditWeekday(Number(e.target.value))}
                onKeyDown={handleEditWeekdayKeyDown}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
              >
                {WEEKDAYS_FULL.map((w, i) => (
                  <option key={i} value={i}>
                    {w}
                  </option>
                ))}
              </select>
            )}
            <input
              ref={editTimeInputRef}
              type="time"
              value={editTime}
              onChange={(e) => setEditTime(e.target.value)}
              onKeyDown={handleEditTimeKeyDown}
              className="w-auto shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
            />
            {/* Живое предупреждение о прошедшем времени (только kind='date') —
                тот же неблокирующий приём, что и "● не сохранено" в NoteEditor:
                считается на каждый рендер из текущего state, ничего не блокирует. */}
            {editKind === "date" && editDate && editTime && isPastDateTime(editDate, editTime) && (
              <span className="ml-2 text-[11px] text-amber-400">● прошедшее время</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => saveEditedReminder(r.id)}
              disabled={!editTitle.trim()}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
            >
              Сохранить
            </button>
            <button
              onClick={() => setEditingReminderId(null)}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Отмена
            </button>
          </div>
        </li>
      );
    }
    return (
      <li
        key={r.id}
        className="flex items-center justify-between gap-2 rounded-lg bg-slate-800/60 px-3 py-2 text-sm"
      >
        <span className="text-slate-200">
          {r.title}
          <span className="ml-2 text-xs text-slate-400">
            {r.kind === "date"
              ? `📅 ${r.date?.split("-").reverse().join(".")}`
              : `🔁 каждый(-ую) ${WEEKDAYS_FULL[r.weekday ?? 0].toLowerCase()}`}
            {r.time && (
              <>
                {" "}
                · <span className="text-amber-400">{r.time}</span>
              </>
            )}
          </span>
        </span>
        <span className="flex shrink-0 gap-1">
          <button
            onClick={() => startEditReminder(r)}
            className="rounded-md px-2 py-1 text-xs text-sky-400 hover:bg-sky-500/10"
          >
            ✏️
          </button>
          <button
            onClick={() => handleDeleteReminder(r.id)}
            className="rounded-md px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10"
          >
            Удалить
          </button>
        </span>
      </li>
    );
  };

  const closeDayModal = () => {
    setSelected(null);
    // Если внутри модалки было открыто редактирование напоминания —
    // закрываем и его, иначе форма редактирования "зависнет" открытой в
    // фоновом списке напоминаний под модалкой.
    setEditingReminderId(null);
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

  // Номер библейского месяца для дня, открытого в модалке — используется
  // только для подписи ("N-го месяца" вместо родового "синодического
  // месяца"); счётчик дня (selInfo.syn.day) остаётся как есть, от
  // наблюдений пользователя — тут заменяется только название месяца.
  const selectedBiblicalMonth = selInfo ? biblicalMonthNumberFor(selInfo.iso) : null;

  // Восход/закат Солнца и Луны — для дня, открытого в модалке (любого, не
  // только сегодняшнего). Координаты берём с устройства (см. эффект выше),
  // а сам момент для расчёта — полдень ВЫБРАННОГО дня (см. localNoonForDate
  // в lib/sun-moon.ts), а не "сейчас": иначе для прошлых/будущих дат
  // считалось бы неверное время.
  const isSelectedToday = !!selInfo && !!today && selInfo.iso === today;
  const selectedAstro = useMemo(() => {
    if (!selInfo || !location) return null;
    const noon = localNoonForDate(selInfo.p.y, selInfo.p.m, selInfo.p.d);
    return getSunMoonTimes(noon, location.coords);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selInfo?.iso, location]);

  // Создаёт разовое напоминание "за полчаса до захода солнца/луны" на
  // момент, по которому тапнули в карточке "Восход и закат" модалки дня.
  // Время напоминания = момент события минус 30 минут (округление вниз до
  // минуты), текст — фиксированный, дата — выбранный в календаре день.
  const addSunsetReminder = async (
    eventAt: Date | null | undefined,
    kind: "sun" | "moon"
  ) => {
    if (!eventAt || !selInfo) return;

    const remindAt = new Date(eventAt.getTime() - 30 * 60 * 1000);
    const hh = String(remindAt.getHours()).padStart(2, "0");
    const mm = String(remindAt.getMinutes()).padStart(2, "0");
    const time = `${hh}:${mm}`;

    // Событие уже скоро/прошло — напоминание создавать поздно.
    if (isPastDateTime(selInfo.iso, time)) return;

    const title =
      kind === "sun" ? "Заход солнца через полчаса" : "Заход луны через полчаса";

    // Защита от дублей: такое же напоминание (та же дата, время и текст)
    // уже существует — не создаём второе.
    const duplicate = reminders.some(
      (r) =>
        r.kind === "date" &&
        r.date === selInfo.iso &&
        r.time === time &&
        r.title === title
    );
    if (duplicate) return;

    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          kind: "date",
          date: selInfo.iso,
          time,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "Не удалось создать напоминание");
        return;
      }
      const row = await res.json();
      setReminders((prev) => [...prev, row]);
    } catch (error) {
      console.error("Failed to add sunset reminder:", error);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-2 pb-16 pt-4 sm:px-4">
      {/* Заголовок */}
      <header className="mb-3 flex items-center justify-between gap-2">
        <h1 className="flex items-start gap-1 text-lg font-bold text-slate-100 sm:text-2xl">
          <span className="mt-0.5 text-sm leading-none sm:text-base">🌙</span>
          <span className="text-3xl sm:text-4xl">{t ? t.y : ""}</span>
        </h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={toggleWeekStart}
            className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            title="Первый день недели"
          >
            Неделя с:{" "}
            <b className={weekStart === "sunday" ? "text-amber-300" : "text-sky-300"}>
              {weekStart === "sunday" ? "Вс" : "Пн"}
            </b>
          </button>
          <button
            onClick={toggleCalendarMode}
            className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            title="Тип календарной сетки"
          >
            Календарь:{" "}
            <b className={calendarMode === "gregorian" ? "text-sky-300" : "text-amber-300"}>
              {calendarMode === "gregorian" ? "Григорианский" : "Библейский"}
            </b>
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

      {/* Модалка окна наблюдения — форсируется, пока не подтверждено "Я
          помню" сегодня. Пересчитывается локально при каждом открытии. */}
      {moonAlertActive && moonAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div
            className={`w-full max-w-sm rounded-2xl border p-5 ${
              moonAlert.kind === "warn"
                ? "border-amber-500/60 bg-slate-900"
                : "border-sky-500/60 bg-slate-900"
            }`}
          >
            <div className="mb-2 text-3xl">{moonAlert.kind === "warn" ? "⚠️" : "🌑"}</div>
            <p className="mb-4 text-sm leading-relaxed text-slate-200">{moonAlert.text}</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={acknowledgeAndObserve}
                className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                👁️ Отметить наблюдение сейчас
              </button>
              <button
                onClick={acknowledgeMoonAlert}
                className="w-full rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
              >
                Я помню, отмечу позже
              </button>
            </div>
          </div>
        </div>
      )}

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
          {todaysReminders
            .map((r) => r.title + (r.time ? ` (${r.time})` : ""))
            .join("; ")}
        </div>
      )}

      {/* Навигация по месяцам */}
      <div className="mb-2 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-2 py-2">
        <button
          onClick={() => navigate(-1)}
          className="rounded-lg px-3 py-1.5 text-xl text-slate-300 hover:bg-slate-800"
          aria-label="Предыдущий месяц"
        >
          ‹
        </button>
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-slate-100 sm:text-lg">
            {calendarMode === "biblical"
              ? viewedBiblicalMonth
                ? `${viewedBiblicalMonth.number} месяц${viewedBiblicalMonth.isLeap ? " (Адар II)" : ""}`
                : "Считаем…"
              : MONTHS[viewMonth - 1]}
          </span>
          <button
            onClick={() => {
              if (!t) return;
              if (calendarMode === "biblical") {
                // Сбрасываем ручной выбор — снова показываем месяц,
                // содержащий сегодняшний день.
                setViewedBiblicalIndex(null);
              } else {
                setViewYear(t.y);
                setViewMonth(t.m);
              }
            }}
            className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
          >
            Сегодня
          </button>
        </div>
        <button
          onClick={() => navigate(1)}
          className="rounded-lg px-3 py-1.5 text-xl text-slate-300 hover:bg-slate-800"
          aria-label="Следующий месяц"
        >
          ›
        </button>
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

      {/* Пока библейские месяцы ещё считаются (или для текущей даты месяц
          почему-то не нашёлся) — сетку не рисуем, а не показываем пустоту. */}
      {calendarMode === "biblical" && cells.length === 0 && (
        <p className="mb-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-6 text-center text-xs text-slate-500">
          {biblicalReady ? "Не удалось определить месяц для этой даты." : "Считаем библейский календарь…"}
        </p>
      )}

      {/* Сетка */}
      <div
        className="relative grid grid-cols-7 gap-1"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {cells.map((cell, idx) => {
          if (!cell)
            return (
              <div
                key={idx}
                className="min-h-[72px] rounded-lg bg-slate-900/40 sm:min-h-[86px]"
              />
            );
          const iso = cell.iso;
          const p = parseISO(iso);
          const phase = moonPhaseTrig2(p.y, p.m, p.d);
          const syn = synodicDayFor(iso, obsDates);
          const isObs = obsDates.includes(iso);
          const isFirstSyn = syn?.day === 1;
          const isToday = !!today && iso === today;
          const rems = remindersFor(iso);

          const dayComment = notesByDate.get(iso)?.comment ?? null;
          return (
            <div key={iso} className="group relative">
              <button
                onClick={() => {
                  setSelected(iso);
                  setRemKind("date");
                  setRemTitle("");
                  setRemTime("");
                  // Поле заголовка ненаправляемое (defaultValue) — чистим и DOM.
                  if (remTitleInputRef.current) remTitleInputRef.current.value = "";
                }}
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
                {/* Число дня — вверху слева: григорианский день месяца в
                    обоих режимах. */}
                <span className="absolute left-1 top-0.5 text-[11px] font-bold leading-4 text-sky-300 sm:text-sm">
                  {p.d}
                </span>
                {/* Отметка наблюдения */}
                {isObs && (
                  <span className="absolute right-1 top-0.5 text-[10px]">👁️</span>
                )}
                {/* Пиктограмма */}
                <MoonIcon moonDay={phase} size={30} />
                {/* Число синодического месяца — внизу справа (только при
                    наличии нумерации от наблюдений пользователя) */}
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
                {dayComment && (
                  <div className="mt-1 font-bold text-amber-300">{dayComment}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Список напоминаний */}
      <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-2 text-sm font-bold text-slate-200">🔔 Мои напоминания</h2>
        {reminders.length === 0 && (
          <p className="text-xs text-slate-500">
            Пока нет напоминаний. Нажмите на день календаря, чтобы добавить.
          </p>
        )}
        {reminders.length > 0 && upcomingReminders.length === 0 && (
          <p className="text-xs text-slate-500">Нет предстоящих напоминаний.</p>
        )}
        <ul className="space-y-1.5">{upcomingReminders.map((r) => renderReminderRow(r))}</ul>

        {pastReminders.length > 0 && (
          <div className="mt-3 border-t border-slate-800 pt-2">
            <button
              onClick={() => setShowPast((v) => !v)}
              className="text-xs text-slate-500 underline decoration-dotted hover:text-slate-300"
            >
              {showPast ? "▲ Скрыть прошедшие" : `▼ Показать прошедшие (${pastReminders.length})`}
            </button>
            {showPast && (
              <ul className="mt-2 space-y-1.5 opacity-70">
                {pastReminders.map((r) => renderReminderRow(r))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Модальное окно дня */}
      {selInfo && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
          onClick={closeDayModal}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-4 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="whitespace-nowrap text-lg font-bold text-slate-100">
                  {WEEKDAYS_FULL[weekdayOfISO(selInfo.iso)]},{" "}
                  {selInfo.p.d} {MONTHS_GEN[selInfo.p.m - 1]}
                </h3>
              </div>
              <button
                onClick={closeDayModal}
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="mb-3 flex items-center gap-3 rounded-xl bg-black p-3">
              <MoonIcon moonDay={selInfo.phase} size={46} />
              <div className="text-sm">
                <div className="text-slate-200">{moonPhaseName(selInfo.phase)}</div>
                <div className="text-xs text-slate-400">
                  Лунный день по расчёту: {selInfo.phase}
                </div>
                {selInfo.syn && selInfo.syn.day >= 1 ? (
                  <div className="text-xs text-amber-400">
                    {selInfo.syn.day}-й день{" "}
                    {selectedBiblicalMonth
                      ? `${selectedBiblicalMonth.number}-го месяца${
                          selectedBiblicalMonth.isLeap ? " (Адар II)" : ""
                        }`
                      : "синодического месяца"}
                    {selInfo.syn.day === 1 ? " — первый день! 🌒" : ""}
                    <span className="text-slate-500">
                      {" "}
                      (наблюдение {selInfo.syn.observationISO.split("-").reverse().join(".")})
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">
                    Нумерация начнётся после отметки наблюдения
                  </div>
                )}
              </div>
            </div>

            {/* Восход/закат Солнца и Луны — для выбранного дня (любого, не
                только сегодняшнего), по геолокации устройства (либо
                Иерусалим по умолчанию, если геолокация недоступна). */}
            <div className="mb-3 rounded-xl border border-slate-700 bg-slate-800/40 p-3">
              <h4 className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-bold uppercase text-slate-400">
                Восход и закат{isSelectedToday ? " сегодня" : ""}
                {location?.source === "jerusalem" && (
                  <span
                    className="normal-case font-normal text-amber-400"
                    title="Геолокация отключена или недоступна — используются координаты Иерусалима"
                  >
                    (Иерусалим — по умолчанию)
                  </span>
                )}
              </h4>
              {!location ? (
                <p className="text-xs text-slate-500">Определяем местоположение…</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 text-sm text-slate-200">
                  <div className="rounded-lg bg-black/30 p-2">
                    <div className="text-[11px] text-slate-400">☀️ Восход солнца</div>
                    <div className="font-semibold">
                      {formatTime(selectedAstro?.sunrise ?? null, location.timeZone)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-black/30 p-2">
                    <div className="text-[11px] text-slate-400">🌇 Закат солнца</div>
                    <button
                      type="button"
                      onClick={() => addSunsetReminder(selectedAstro?.sunset, "sun")}
                      disabled={!selectedAstro?.sunset}
                      title="Создать напоминание за полчаса до захода"
                      className="w-full text-left font-semibold hover:text-sky-300 disabled:cursor-default"
                    >
                      {formatTime(selectedAstro?.sunset ?? null, location.timeZone)}
                    </button>
                  </div>
                  <div className="rounded-lg bg-black/30 p-2">
                    <div className="text-[11px] text-slate-400">🌙 Восход луны</div>
                    <div className="font-semibold">
                      {selectedAstro?.moonAlwaysUp
                        ? "не заходит"
                        : selectedAstro?.moonAlwaysDown
                          ? "не восходит"
                          : formatTime(selectedAstro?.moonrise ?? null, location.timeZone)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-black/30 p-2">
                    <div className="text-[11px] text-slate-400">🌑 Заход луны</div>
                    {selectedAstro?.moonAlwaysUp || selectedAstro?.moonAlwaysDown ? (
                      <div className="font-semibold">
                        {selectedAstro?.moonAlwaysUp
                          ? "не заходит"
                          : "не восходит"}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addSunsetReminder(selectedAstro?.moonset, "moon")}
                        disabled={!selectedAstro?.moonset}
                        title="Создать напоминание за полчаса до захода"
                        className="w-full text-left font-semibold hover:text-sky-300 disabled:cursor-default"
                      >
                        {formatTime(selectedAstro?.moonset ?? null, location.timeZone)}
                      </button>
                    )}
                  </div>
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-500">
                {location?.source === "device"
                  ? "По текущей геолокации устройства."
                  : "Геолокация отключена или недоступна — показано время для Иерусалима."}
              </p>
            </div>

            <button
              onClick={() => toggleObservation(selInfo.iso)}
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

            {/* Заметка к дню — доступна для любого дня, не только для наблюдения */}
            <NoteEditor
              key={selInfo.iso}
              ref={noteEditorRef}
              dayISO={selInfo.iso}
              initialValue={notesByDate.get(selInfo.iso)?.comment ?? ""}
              onSave={handleSaveNote}
            />

            {/* Напоминания этого дня — тот же renderReminderRow, что и в
                общем списке снизу, так что редактирование (✏️) работает
                прямо здесь, в модалке дня, а не только в общем списке. */}
            {selInfo.rems.length > 0 && (
              <div className="mb-3">
                <h4 className="mb-1.5 text-xs font-bold uppercase text-slate-400">
                  Напоминания в этот день
                </h4>
                <ul className="space-y-1.5">{selInfo.rems.map((r) => renderReminderRow(r))}</ul>
              </div>
            )}

            {/* Форма нового напоминания */}
            <div className="rounded-xl border border-slate-700 p-3">
              <h4 className="mb-2 text-xs font-bold uppercase text-slate-400">
                Новое напоминание
              </h4>
              <input
                ref={remTitleInputRef}
                defaultValue={remTitle}
                onChange={(e) => setRemTitle(e.target.value)}
                onKeyDown={handleRemTitleKeyDown}
                placeholder="Текст напоминания…"
                className="mb-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-sky-500"
                autoCorrect="on"
                autoCapitalize="sentences"
                enterKeyHint="next"
              />
              <div className="mb-2 flex flex-wrap gap-2 text-xs">
                <label
                  className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${
                    remKind === "date"
                      ? "border-sky-500 bg-sky-500/10 text-sky-300"
                      : "border-slate-700 text-slate-400"
                  }`}
                >
                  <input
                    type="radio"
                    className="hidden"
                    checked={remKind === "date"}
                    onChange={() => setRemKind("date")}
                  />
                  📅 На эту дату
                </label>
                <label
                  className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${
                    remKind === "weekly"
                      ? "border-sky-500 bg-sky-500/10 text-sky-300"
                      : "border-slate-700 text-slate-400"
                  }`}
                >
                  <input
                    type="radio"
                    className="hidden"
                    checked={remKind === "weekly"}
                    onChange={() => setRemKind("weekly")}
                  />
                  🔁 Каждый(-ую) {WEEKDAYS_FULL[weekdayOfISO(selInfo.iso)].toLowerCase()}
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={remTimeInputRef}
                  type="time"
                  value={remTime}
                  onChange={(e) => setRemTime(e.target.value)}
                  onKeyDown={handleRemTimeKeyDown}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
                />
                <button
                  onClick={handleAddReminder}
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
