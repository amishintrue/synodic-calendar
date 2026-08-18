"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "@capacitor/app";
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
import {
  getObservations,
  addObservation,
  deleteObservation,
  getNotes,
  saveNote,
  getReminders,
  addReminder,
  updateReminder,
  deleteReminder,
  getSettings,
  setSetting,
  toggleWeekStart,
  rescheduleAllReminders,
} from "@/lib/data-service";
import {
  initializeNotifications,
  requestNotificationPermission,
  ensureExactAlarmsAllowed,
  checkNotificationHealth,
  getBatteryOptimizationInfo,
  type BatteryOptimizationInfo,
} from "@/lib/local-notifications";
import NoteEditor, { NoteEditorHandle } from "@/components/NoteEditor";
import BatteryOptimizationGuide from "@/components/BatteryOptimizationGuide";
import {
  getUserLocation,
  getSunMoonTimes,
  localNoonForDate,
  formatTime,
  type LocationResult,
} from "@/lib/sun-moon";

type Observation = { id: number; date: string };
type Note = { date: string; comment: string };
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
  // Какой месяц открыт по умолчанию.
  const [viewYear, setViewYear] = useState<number>(() => parseISO(todayISO()).y);
  const [viewMonth, setViewMonth] = useState<number>(() => parseISO(todayISO()).m); // 1..12

  // «Сегодня» вычисляем ТОЛЬКО на клиенте и только после монтирования.
  const [today, setToday] = useState<string | null>(null);
  const t = today ? parseISO(today) : null;
  const [observations, setObservations] = useState<Observation[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [weekStart, setWeekStart] = useState<"sunday" | "monday">("sunday");
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // Здоровье системы уведомлений (разрешение / точные будильники / батарея) —
  // на этом строится колокольчик: виден, только пока что-то не в порядке.
  const [notifHealth, setNotifHealth] = useState<{
    hasPermission: boolean;
    hasExactAlarmPermission: boolean;
    batteryOptimizationNeeded: boolean;
  } | null>(null);
  const [batteryInfo, setBatteryInfo] = useState<BatteryOptimizationInfo | null>(null);
  const [batteryDismissed, setBatteryDismissed] = useState(false);
  const [showBatteryModal, setShowBatteryModal] = useState(false);

  // Дата, когда пользователь последний раз подтвердил предупреждение о
  // приближении нового месяца ("Я помню") — переиспользуем существующее
  // поле settings.lastMoonAlertDate, раньше оно гасило push, теперь гасит
  // модалку на сегодня.
  const [moonAlertAckDate, setMoonAlertAckDate] = useState<string>("");

  // Местоположение пользователя для восхода/захода Солнца и Луны в модалке
  // сегодняшнего дня. Определяется один раз за сессию (через
  // @capacitor/geolocation, с запасным вариантом — Иерусалим, если
  // геолокация отключена/недоступна).
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
      const [obs, rem, settings, notesData] = await Promise.all([
        getObservations(),
        getReminders(),
        getSettings(),
        getNotes(),
      ]);
      setObservations(obs);
      setReminders(rem);
      if (settings.weekStart === "monday" || settings.weekStart === "sunday") {
        setWeekStart(settings.weekStart);
      }
      setNotes(notesData);
      setMoonAlertAckDate(settings.lastMoonAlertDate || "");
      setBatteryDismissed(settings.batteryOptimizationDismissed === "1");
      setLoaded(true);
    } catch (error) {
      console.error("Failed to load data:", error);
      setLoaded(true);
    }
  }, []);

  // «Сегодня» держим актуальным: обновляем раз в минуту
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

  // Hardware back button handling
  useEffect(() => {
    const handleBackButton = () => {
      // Если редактируется напоминание (в т.ч. прямо внутри модалки дня) —
      // сначала отменяем редактирование, а не закрываем всю модалку разом.
      if (editingReminderId !== null) {
        setEditingReminderId(null);
        return;
      }
      // Если открыто модальное окно дня — закрываем его
      if (selected) {
        setSelected(null);
        return;
      }
      // Иначе сворачиваем приложение
      App.minimizeApp();
    };

    let removeBackListener: (() => void) | undefined;
    (async () => {
      try {
        const listener = await App.addListener("backButton", handleBackButton);
        removeBackListener = () => listener.remove();
      } catch {
        // not native platform
      }
    })();

    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      if (editingReminderId !== null) {
        setEditingReminderId(null);
        history.pushState(null, "", window.location.href);
      } else if (selected) {
        setSelected(null);
        history.pushState(null, "", window.location.href);
      }
    };

    window.addEventListener("popstate", handlePopState);
    history.pushState(null, "", window.location.href);

    return () => {
      removeBackListener?.();
      window.removeEventListener("popstate", handlePopState);
    };
  }, [selected, editingReminderId]);

  const refreshNotificationHealth = useCallback(async () => {
    const [health, info] = await Promise.all([
      checkNotificationHealth(),
      getBatteryOptimizationInfo(),
    ]);
    setNotifHealth(health);
    setBatteryInfo(info);
  }, []);

  useEffect(() => {
    loadAll();
    (async () => {
      const result = await initializeNotifications();
      // Пересоздаём уведомления при старте (страховка после перезагрузки/обновления).
      if (result.permissionGranted) {
        await rescheduleAllReminders();
      }
      await refreshNotificationHealth();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAll, refreshNotificationHealth]);

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

  // Предстоящие и прошедшие одноразовые напоминания
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
  // даже если баннер в потоке страницы никто не заметил. Работает целиком
  // локально, без push и будильников: пересчитывается при каждом открытии.
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
        (r) =>
          (r.kind === "date" && r.date === iso) ||
          (r.kind === "weekly" && r.weekday === wd)
      );
    },
    [reminders]
  );

  /* ---------- Действия ---------- */
    const navigate = (delta: number) => {
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

  const handleToggleWeekStart = async () => {
    const next = await toggleWeekStart(weekStart);
    setWeekStart(next);
  };

  const toggleObservation = async (iso: string) => {
    const exists = obsDates.includes(iso);
    if (exists) {
      const rows = await deleteObservation(iso);
      setObservations(rows);
    } else {
      const rows = await addObservation(iso);
      setObservations(rows);
    }
  };

  // Сохранить заметку к любому дню
  const handleSaveNote = async (iso: string, comment: string) => {
    const rows = await saveNote(iso, comment);
    setNotes(rows);
  };

  const handleAddReminder = async () => {
    if (!selected) return;

    const input = remTitleInputRef.current;

    const proceed = async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;

      if (!remTime) {
        remTimeInputRef.current?.focus();
        setTimeout(() => showPicker(remTimeInputRef.current), 0);
        return;
      }

    setSaving(true);
      const row = await addReminder(
        trimmed,
        remKind,
        selected,
        weekdayOfISO(selected),
        remTime || null
      );
      setReminders((prev) => [...prev, row]);
      if (remTitleInputRef.current) remTitleInputRef.current.value = "";
      setRemTitle("");
      setRemTime("");
      setSaving(false);
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
    await deleteReminder(id);
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
      const row = await updateReminder(
        id,
        trimmed,
        editKind,
        editKind === "date" ? editDate : null,
        editKind === "weekly" ? editWeekday : null,
        editTime || null
      );
    if (row) {
      setReminders((prev) => prev.map((r) => (r.id === id ? row : r)));
      setEditingReminderId(null);
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

  // Колокольчик решает одну проблему за клик (разрешение → точные будильники
  // → инструкция по батарее/автозапуску) и перепроверяет статус — сам
  // исчезнет, когда всё в порядке.
  const handleBellClick = async () => {
    if (!notifHealth) return;

    if (!notifHealth.hasPermission) {
      await requestNotificationPermission();
    } else if (!notifHealth.hasExactAlarmPermission) {
      await ensureExactAlarmsAllowed(); // откроет системный экран настроек
    } else if (notifHealth.batteryOptimizationNeeded && !batteryDismissed && batteryInfo) {
      setShowBatteryModal(true);
      return; // ждём действия в модалке, не перепроверяем сразу
    }

    await refreshNotificationHealth();
  };

  const handleBatteryDismiss = async () => {
    await setSetting("batteryOptimizationDismissed", "1");
    setBatteryDismissed(true);
    setShowBatteryModal(false);
  };

  // Подтверждение окна наблюдения нового месяца
  const acknowledgeMoonAlert = async () => {
    if (!today) return;
    await setSetting("lastMoonAlertDate", today);
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

  // Handlers для Enter key
  const handleRemTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;

    const input = e.currentTarget;

    const run = () => {
      setRemTitle(input.value);
      if (remTime) {
        handleAddReminder();
      } else {
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
      saveEditedReminder(editingReminderId!);
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
                        spellCheck={true}
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
              className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
            />
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
              <> · <span className="text-amber-400">{r.time}</span></>
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

  return (
    <div className="mx-auto max-w-3xl px-2 pb-16 pt-4 sm:px-4">
      {/* Заголовок */}
      <header className="mb-3 flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-100 sm:text-2xl">
          <span className="text-2xl">🌙</span> Лунный календарь
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleWeekStart}
            className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            title="Первый день недели"
          >
            Неделя с: <b className="text-sky-300">{weekStart === "sunday" ? "Вс" : "Пн"}</b>
          </button>
          {notifHealth && (
            !notifHealth.hasPermission ||
            !notifHealth.hasExactAlarmPermission ||
            (notifHealth.batteryOptimizationNeeded && !batteryDismissed)
          ) && (
            <button
              onClick={handleBellClick}
              title={
                !notifHealth.hasPermission
                  ? "Нет разрешения на уведомления"
                  : !notifHealth.hasExactAlarmPermission
                  ? "Нет разрешения на точные будильники"
                  : "Нужна настройка автозапуска/батареи"
              }
              className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20"
            >
              🔔 Разрешить
            </button>
          )}
        </div>
      </header>

      {/* Модалка окна наблюдения — форсируется, пока не подтверждено "Я
          помню" сегодня. Никаких push/будильников: пересчитывается локально
          при каждом открытии приложения. */}
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

      {/* Инструкция по батарее/автозапуску — модалка по клику на колокольчик. */}
      {showBatteryModal && batteryInfo && (
        <BatteryOptimizationGuide
          batteryInfo={batteryInfo}
          onDismiss={handleBatteryDismiss}
          onClose={() => setShowBatteryModal(false)}
        />
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
            {MONTHS[viewMonth - 1]} {viewYear}
          </span>
          <button
            onClick={() => {
              if (t) {
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
            <div
              className="relative grid grid-cols-7 gap-1"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
        {cells.map((iso, idx) => {
          if (!iso)
            return (
              <div
                key={idx}
                className="min-h-[72px] rounded-lg bg-slate-900/40 sm:min-h-[86px]"
              />
            );
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
              {/* Кастомная подсказка при наведении */}
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
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-100">
                  {selInfo.p.d} {MONTHS[selInfo.p.m - 1].toLowerCase()} {selInfo.p.y}
                </h3>
                <p className="text-xs text-slate-400">
                  {WEEKDAYS_FULL[weekdayOfISO(selInfo.iso)]}
                </p>
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
                    {selInfo.syn.day}-й день синодического месяца
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
                    <div className="font-semibold">
                      {formatTime(selectedAstro?.sunset ?? null, location.timeZone)}
                    </div>
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
                    <div className="font-semibold">
                      {selectedAstro?.moonAlwaysUp
                        ? "не заходит"
                        : selectedAstro?.moonAlwaysDown
                          ? "не восходит"
                          : formatTime(selectedAstro?.moonset ?? null, location.timeZone)}
                    </div>
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
                                spellCheck={true}
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
