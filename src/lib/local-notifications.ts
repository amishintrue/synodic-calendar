/**
 * Local Notifications Service for Capacitor
 * 
 * РЕШЕНИЕ ПРОБЛЕМЫ ФОНОВЫХ УВЕДОМЛЕНИЙ:
 * 
 * Когда пользователь смахивает приложение из недавних, Android по умолчанию:
 * 1. Убивает процесс приложения
 * 2. Отменяет ВСЕ запланированные AlarmManager-будильники
 * 
 * Это поведение Android, а не баг плагина. Решения:
 * 
 * 1. ИСКЛЮЧЕНИЕ ИЗ ОПТИМИЗАЦИИ БАТАРЕИ — критически важно!
 *    Без этого Android будет убивать приложение агрессивно.
 * 
 * 2. НАСТРОЙКИ ПРОИЗВОДИТЕЛЯ (Xiaomi, Samsung, Huawei и т.д.)
 *    Каждый производитель добавляет свою "оптимизацию", которую нужно отключить вручную.
 * 
 * 3. AUTOSTART PERMISSION (Xiaomi, OPPO, Vivo)
 *    Нужно разрешить автозапуск приложения.
 * 
 * 4. FOREGROUND SERVICE — крайняя мера, держит приложение "живым"
 *    Показывает постоянное уведомление, но гарантирует работу.
 */

import { LocalNotifications, PermissionStatus } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { APP_TIMEZONE, nowInAppTimezone } from '@/lib/reminders';

/** Время по умолчанию для напоминаний без указанного времени (HH:MM).
 *  Единственный источник истины — используется и планировщиком, и UI-валидацией. */
export const DEFAULT_REMINDER_TIME = '09:00';

/**
 * Проверяет, находится ли дата+время в прошлом. Общая точка истины для
 * UI-валидации напоминаний (создание/редактирование/заходы солнца-луны),
 * чтобы условия "<=" vs "<" и дефолты времени не расходились между местами.
 *
 * @param iso   Дата в формате YYYY-MM-DD
 * @param hhmm  Время в формате HH:MM (пустая строка → DEFAULT_REMINDER_TIME)
 */
export function isPastDateTime(iso: string, hhmm: string): boolean {
  const { y, m, d } = { y: +iso.slice(0, 4), m: +iso.slice(5, 7), d: +iso.slice(8, 10) };
  const [hh, mm] = (hhmm || DEFAULT_REMINDER_TIME).split(':').map((v) => parseInt(v, 10));
  const fireAt = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
  return fireAt.getTime() <= Date.now();
}

// ============================================================================
// Вспомогательные функции для перевода времени (взяты из старой версии)
// ============================================================================

/**
 * Переводит "настенное" время (дата+часы:минуты) в часовом поясе приложения
 * (APP_TIMEZONE) в точный момент UTC — тот самый Date, который нужен
 * нативному планировщику.
 */
function zonedTimeToUtc(dateISO: string, hhmm: string, timeZone: string): Date {
  const guessUtc = new Date(`${dateISO}T${hhmm}:00Z`);

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = dtf.formatToParts(guessUtc).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});

  const asIfLocalDigitsWereUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  const offsetMs = asIfLocalDigitsWereUtc - guessUtc.getTime();
  return new Date(guessUtc.getTime() - offsetMs);
}

/**
 * Возвращает ближайшее будущее вхождение заданного дня недели и времени.
 * Используется для еженедельных напоминаний вместо schedule.on (менее надёжно).
 */
function getNextWeeklyOccurrence(weekday: number, hhmm: string): Date {
  const today = nowInAppTimezone();
  const [hh, mm] = hhmm.split(':').map((v) => parseInt(v, 10));
  
  // Вычисляем разницу в днях до следующего вхождения weekday
  let daysUntil = (weekday - today.weekday + 7) % 7;
  if (daysUntil === 0) {
    // Сегодня нужный день недели — проверяем, не прошло ли уже время
    if (today.hhmm >= hhmm) {
      daysUntil = 7; // время прошло, планируем на следующую неделю
    }
  }
  
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysUntil);
  
  // Формируем дату в часовом поясе приложения
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(targetDate);
  
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dateISO = `${get("year")}-${get("month")}-${get("day")}`;
  
  return zonedTimeToUtc(dateISO, hhmm, APP_TIMEZONE);
}

// Проверка, что мы в Capacitor (Android)
export function isCapacitor(): boolean {
  return Capacitor.isNativePlatform();
}

// ============================================================================
// РАЗРЕШЕНИЯ И ОПТИМИЗАЦИЯ БАТАРЕИ
// ============================================================================

/**
 * Запрашивает разрешение на уведомления
 */
export async function requestNotificationPermission(): Promise<PermissionStatus> {
  if (!isCapacitor()) {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const perm = await Notification.requestPermission();
      return { display: perm } as PermissionStatus;
    }
    return { display: 'denied' } as PermissionStatus;
  }

  return LocalNotifications.requestPermissions();
}

/**
 * Проверяет текущее состояние разрешения
 */
export async function getNotificationPermission(): Promise<PermissionStatus> {
  if (!isCapacitor()) {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return { display: Notification.permission } as PermissionStatus;
    }
    return { display: 'denied' } as PermissionStatus;
  }

  return LocalNotifications.checkPermissions();
}

/**
 * Проверяет и запрашивает разрешение на точные будильники (Android 12+)
 * Это КРИТИЧЕСКИ ВАЖНО для работы уведомлений в точное время
 */
export async function ensureExactAlarmsAllowed(): Promise<boolean> {
  if (!isCapacitor()) return true;
  
  try {
    const status = await LocalNotifications.checkExactNotificationSetting();
    console.log('[Notifications] Exact alarm status:', status);
    
    if (status.exact_alarm !== 'granted') {
      // Открывает системный экран настроек
      await LocalNotifications.changeExactNotificationSetting();
      return false; // Пользователь должен включить вручную
    }
    return true;
  } catch (error) {
    // Метод доступен с версии плагина 6.0.0
    console.warn('[Notifications] checkExactNotificationSetting unavailable:', error);
    return true; // Предполагаем, что на старых версиях всё ок
  }
}

/**
 * Информация о производителях с агрессивной оптимизацией батареи
 * и инструкции по отключению
 */
export interface BatteryOptimizationInfo {
  manufacturer: string;
  needsSpecialSettings: boolean;
  settingsPath: string[];
  instructions: string;
  /**
   * Варианты deep-link на экран автозапуска конкретной прошивки.
   * Прошивки меняют пути между версиями (например, MIUI 12 → 14), поэтому
   * пробуем по очереди несколько известных activity. Если ни одна не
   * сработала — UI падает назад на страницу настроек приложения и текстовую
   * инструкцию.
   */
  autostartIntents?: string[];
  /**
   * Deep-link на экран настроек батареи/оптимизации (если известен).
   */
  batteryIntent?: string;
}

/**
 * Открывает Activity по строке "package/activity" через Android Intent.
 * Работает только в нативном Capacitor; при отсутствии activity
 * (другая версия прошивки) тихо возвращает false — вызывающий код
 * показывает текстовую инструкцию.
 */
export async function openOemSettingsScreen(intentSpec?: string): Promise<boolean> {
  if (!isCapacitor() || !intentSpec) return false;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    // Используем общий механизм Capacitor для вызова нативного метода.
    // MainActivity наследует BridgeActivity, у которого есть startActivity.
    const NativeIntents = registerPlugin<{ openActivity(options: { component: string }): Promise<void> }>(
      'NativeIntents'
    );
    await NativeIntents.openActivity({ component: intentSpec });
    return true;
  } catch (error) {
    console.warn('[Notifications] openOemSettingsScreen failed:', error);
    return false;
  }
}

/**
 * Каскадный вариант: пробует по очереди все известные пути к экрану
 * автозапуска данной прошивки, затем — гарантированный fallback на
 * страницу настроек самого приложения (там у MIUI/Huawei тоже есть
 * переключатели "Автозапуск"/"Запуск" в новых версиях).
 * Возвращает true, если удалось открыть хоть что-то.
 */
export async function openAutostartScreen(intents: string[] = []): Promise<boolean> {
  for (const spec of intents) {
    if (await openOemSettingsScreen(spec)) return true;
  }
  // Fallback: страница нашего приложения в системных настройках —
  // открывается всегда, на любой прошивке. На новых MIUI/EMUI там же
  // лежат переключатели автозапуска.
  return openOemSettingsScreen('com.android.settings/com.android.settings.applications.InstalledAppDetailsTop');
}

/**
 * Определяет производителя устройства и возвращает инструкции.
 *
 * ВАЖНО: определяем по Device.getInfo().manufacturer (@capacitor/device,
 * реально читает Build.MANUFACTURER на Android), а НЕ по navigator.userAgent —
 * UA WebView на многих устройствах (в первую очередь Samsung) содержит
 * только код модели ("SM-G991B"), а не название бренда, так что
 * определение по UA молчаливо не срабатывало бы для части пользователей.
 *
 * Требует зависимость: npm install @capacitor/device && npx cap sync
 */
export async function getBatteryOptimizationInfo(): Promise<BatteryOptimizationInfo | null> {
  if (!isCapacitor()) return null; // на вебе OEM-ограничений батареи не существует

  let manufacturerRaw = '';
  try {
    const info = await Device.getInfo();
    manufacturerRaw = (info.manufacturer || '').toLowerCase();
  } catch (error) {
    console.warn('[Notifications] Device.getInfo() unavailable:', error);
    return null;
  }

  const ua = manufacturerRaw;

  if (ua.includes('xiaomi') || ua.includes('redmi') || ua.includes('poco')) {
    return {
      manufacturer: 'Xiaomi/Redmi/POCO',
      needsSpecialSettings: true,
      settingsPath: ['Настройки', 'Приложения', 'Управление приложениями', '[Ваше приложение]', 'Другие разрешения'],
      batteryIntent: 'android.settings.BATTERY_OPTIMIZATION_SETTINGS',
      instructions: `
1. Автозапуск: Настройки → Приложения → Управление приложениями → [это приложение] → Другие разрешения → включите "Автозапуск"
2. Нажмите "Открыть настройки батареи" ниже
3. В списке найдите это приложение → выберите "Без ограничений"
      `.trim()
    };
  }
  
  if (ua.includes('huawei') || ua.includes('honor')) {
    return {
      manufacturer: 'Huawei/Honor',
      needsSpecialSettings: true,
      settingsPath: ['Настройки', 'Батарея', 'Запуск приложений'],
      batteryIntent: 'android.settings.BATTERY_OPTIMIZATION_SETTINGS',
      instructions: `
1. Автозапуск: Настройки → Батарея → Запуск приложений → [это приложение] → отключите "Управление автоматически" → включите Автозапуск и Работа в фоне
2. Нажмите "Открыть настройки батареи" ниже
3. В списке найдите это приложение → выберите "Не оптимизировать"
      `.trim()
    };
  }
  
  if (ua.includes('samsung')) {
    return {
      manufacturer: 'Samsung',
      needsSpecialSettings: true,
      settingsPath: ['Настройки', 'Уход за устройством', 'Батарея'],
      batteryIntent: 'android.settings.BATTERY_OPTIMIZATION_SETTINGS',
      instructions: `
1. Нажмите "Открыть настройки батареи" ниже
2. Выберите "Все приложения" → найдите это приложение → "Не оптимизировать"
3. Также: Настройки → Уход за устройством → Батарея → ⋮ → Настройки → отключите "Перевод в спящий режим неиспользуемых приложений"
      `.trim()
    };
  }
  
  if (ua.includes('oppo') || ua.includes('realme') || ua.includes('oneplus')) {
    return {
      manufacturer: 'OPPO/Realme/OnePlus',
      needsSpecialSettings: true,
      settingsPath: ['Настройки', 'Батарея', 'Управление приложениями'],
      batteryIntent: 'android.settings.BATTERY_OPTIMIZATION_SETTINGS',
      instructions: `
1. Автозапуск: Настройки → Приложения → Управление приложениями → [это приложение] → разрешите "Автозапуск"
2. Нажмите "Открыть настройки батареи" ниже
3. В списке найдите это приложение → выберите "Не оптимизировать" / "Разрешить работу в фоне"
      `.trim()
    };
  }
  
  if (ua.includes('vivo')) {
    return {
      manufacturer: 'Vivo',
      needsSpecialSettings: true,
      settingsPath: ['Настройки', 'Батарея', 'Высокое потребление в фоне'],
      batteryIntent: 'android.settings.BATTERY_OPTIMIZATION_SETTINGS',
      instructions: `
1. Автозапуск: i Менеджер → Управление приложениями → Автозапуск → разрешите для этого приложения
2. Нажмите "Открыть настройки батареи" ниже
3. В списке найдите это приложение → выберите "Высокое потребление в фоне"
      `.trim()
    };
  }
  
  // Стандартный Android
  return {
    manufacturer: 'Android',
    needsSpecialSettings: false,
    settingsPath: ['Настройки', 'Приложения', '[Приложение]', 'Батарея'],
    batteryIntent: 'android.settings.BATTERY_OPTIMIZATION_SETTINGS',
    instructions: `
1. Нажмите "Открыть настройки батареи" ниже
2. В списке найдите это приложение → выберите "Не оптимизировать"
    `.trim()
  };
}

// ============================================================================
// ПЛАНИРОВАНИЕ УВЕДОМЛЕНИЙ
// ============================================================================

export interface SchedulableReminder {
  id: number;
  title: string;
  kind: 'date' | 'weekly';
  date: string | null;   // YYYY-MM-DD для kind='date'
  weekday: number | null; // 0=воскресенье..6=суббота для kind='weekly'
  time: string | null;    // HH:MM
}

/**
 * Показывает уведомление немедленно (для тестирования или мгновенных оповещений)
 */
export async function showImmediateNotification(payload: {
  id: number;
  title: string;
  body: string;
  extra?: Record<string, unknown>;
}): Promise<void> {
  if (!isCapacitor()) {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(payload.title, { body: payload.body });
    }
    return;
  }

  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: payload.id,
          title: payload.title,
          body: payload.body,
          schedule: { at: new Date(Date.now() + 100), allowWhileIdle: true },
          extra: payload.extra,
          smallIcon: 'ic_stat_icon_config_sample',
          iconColor: '#488AFF',
          sound: 'beep.wav',
        },
      ],
    });
  } catch (error) {
    console.error('[Notifications] Failed to show immediate:', error);
  }
}

/**
 * Отменяет уведомление по ID
 */
export async function cancelNotification(id: number): Promise<void> {
  if (!isCapacitor()) return;

  try {
    await LocalNotifications.cancel({ notifications: [{ id }] });
  } catch (error) {
    console.error('[Notifications] Failed to cancel:', error);
  }
}

/**
 * Отменяет все запланированные уведомления
 */
export async function cancelAllNotifications(): Promise<void> {
  if (!isCapacitor()) return;

  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({ notifications: pending.notifications });
    }
  } catch (error) {
    console.error('[Notifications] Failed to cancel all:', error);
  }
}

/**
 * Возвращает список запланированных уведомлений (для отладки)
 */
export async function getPendingNotifications(): Promise<{ id: number; title?: string; body?: string; at?: Date }[]> {
  if (!isCapacitor()) return [];

  try {
    const pending = await LocalNotifications.getPending();
    return pending.notifications.map(n => ({
      id: n.id,
      title: n.title,
      body: n.body,
      at: n.schedule?.at ? new Date(n.schedule.at as unknown as string) : undefined,
    }));
  } catch (error) {
    console.error('[Notifications] Failed to get pending:', error);
    return [];
  }
}

/**
 * ГЛАВНАЯ ФУНКЦИЯ: Планирует уведомление для напоминания
 * 
 * Для kind='date' — использует schedule.at с точным временем в UTC
 * Для kind='weekly' — для надёжности планируем на СЛЕДУЮЩЕЕ срабатывание,
 *                     а при срабатывании перепланируем (см. handleNotificationReceived)
 * 
 * allowWhileIdle: true — критически важно для работы в Doze mode
 */
export async function scheduleReminderNotification(r: SchedulableReminder): Promise<void> {
  if (!isCapacitor()) return;

  // Сначала отменяем существующее уведомление с этим ID
  await cancelNotification(r.id);

  const time = r.time || DEFAULT_REMINDER_TIME;

  try {
    if (r.kind === 'date' && r.date) {
      // Разовое напоминание на конкретную дату
      const fireAt = zonedTimeToUtc(r.date, time, APP_TIMEZONE);
      
      if (fireAt.getTime() <= Date.now()) {
        console.log('[Notifications] Skipping past reminder:', r.id, r.date, time);
        return;
      }

      console.log('[Notifications] Scheduling one-time:', r.id, 'at', fireAt.toISOString());
      
      await LocalNotifications.schedule({
        notifications: [
          {
            id: r.id,
            title: '🔔 Напоминание',
            body: r.time ? `${r.title} (${r.time})` : r.title,
            schedule: {
              at: fireAt,
              allowWhileIdle: true, // Важно для Doze mode!
            },
            extra: { 
              type: 'reminder', 
              reminderId: r.id,
              kind: r.kind,
              originalDate: r.date,
              originalTime: r.time,
            },
            smallIcon: 'ic_stat_icon_config_sample',
            iconColor: '#488AFF',
          },
        ],
      });
      
    } else if (r.kind === 'weekly' && r.weekday !== null && r.weekday !== undefined) {
      // Еженедельное напоминание
      // 
      // ВАЖНО: Вместо schedule.on (который менее надёжен на убитых приложениях),
      // мы используем schedule.at на БЛИЖАЙШЕЕ срабатывание.
      // После срабатывания перепланируем на следующую неделю.
      
      const nextOccurrence = getNextWeeklyOccurrence(r.weekday, time);
      
      console.log('[Notifications] Scheduling weekly:', r.id, 'next at', nextOccurrence.toISOString());
      
      await LocalNotifications.schedule({
        notifications: [
          {
            id: r.id,
            title: '🔔 Напоминание',
            body: r.time ? `${r.title} (${r.time})` : r.title,
            schedule: {
              at: nextOccurrence,
              allowWhileIdle: true,
            },
            extra: { 
              type: 'reminder', 
              reminderId: r.id,
              kind: r.kind,
              weekday: r.weekday,
              originalTime: r.time,
              isWeeklyRecurring: true, // Маркер для перепланирования
            },
            smallIcon: 'ic_stat_icon_config_sample',
            iconColor: '#488AFF',
          },
        ],
      });
    }
  } catch (error) {
    console.error('[Notifications] Failed to schedule reminder:', r.id, error);
  }
}

/**
 * Отменяет уведомление для напоминания
 */
export async function cancelReminderNotification(id: number): Promise<void> {
  await cancelNotification(id);
}

// ============================================================================
// ОБРАБОТЧИКИ СОБЫТИЙ
// ============================================================================

// Колбэк для перепланирования еженедельных напоминаний
type RescheduleCallback = (reminderId: number) => Promise<void>;
let onRescheduleWeekly: RescheduleCallback | null = null;

/**
 * Устанавливает колбэк для перепланирования еженедельных напоминаний
 * Вызывается из data-service после того, как уведомление сработало
 */
export function setRescheduleCallback(callback: RescheduleCallback): void {
  onRescheduleWeekly = callback;
}

/**
 * Инициализирует обработчики событий уведомлений
 */
function setupNotificationListeners(): void {
  if (!isCapacitor()) return;

  // Когда уведомление показано (сработало)
  LocalNotifications.addListener('localNotificationReceived', async (notification) => {
    console.log('[Notifications] Received:', notification);
    
    // Если это еженедельное напоминание — нужно перепланировать на следующую неделю
    if (notification.extra?.isWeeklyRecurring && notification.extra?.reminderId) {
      const reminderId = notification.extra.reminderId as number;
      console.log('[Notifications] Weekly reminder fired, will reschedule:', reminderId);
      
      if (onRescheduleWeekly) {
        // Небольшая задержка, чтобы уведомление точно было показано
        setTimeout(() => onRescheduleWeekly?.(reminderId), 1000);
      }
    }
  });

  // Когда пользователь нажал на уведомление
  LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    console.log('[Notifications] Action performed:', action);
    
    // Можно добавить навигацию к конкретному экрану
    // if (action.notification.extra?.type === 'reminder') {
    //   router.push('/reminders');
    // }
  });
}

// ============================================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================================

let isInitialized = false;

/**
 * Инициализирует систему уведомлений
 * Вызывайте один раз при старте приложения
 */
export async function initializeNotifications(): Promise<{
  permissionGranted: boolean;
  exactAlarmsAllowed: boolean;
  batteryInfo: BatteryOptimizationInfo | null;
}> {
  const result: {
    permissionGranted: boolean;
    exactAlarmsAllowed: boolean;
    batteryInfo: BatteryOptimizationInfo | null;
  } = {
    permissionGranted: false,
    exactAlarmsAllowed: false,
    batteryInfo: null,
  };

  if (!isCapacitor()) {
    // Веб-версия
    if (typeof window !== 'undefined' && 'Notification' in window) {
      result.permissionGranted = Notification.permission === 'granted';
    }
    return result;
  }

  if (isInitialized) {
    const perm = await getNotificationPermission();
    result.permissionGranted = perm.display === 'granted';
    result.exactAlarmsAllowed = await ensureExactAlarmsAllowed();
    result.batteryInfo = await getBatteryOptimizationInfo();
    return result;
  }

  try {
    // Запрашиваем разрешение на уведомления
    const perm = await requestNotificationPermission();
    result.permissionGranted = perm.display === 'granted';
    console.log('[Notifications] Permission:', perm.display);

    if (result.permissionGranted) {
      // Проверяем разрешение на точные будильники
      result.exactAlarmsAllowed = await ensureExactAlarmsAllowed();
      
      // Устанавливаем обработчики
      setupNotificationListeners();
    }

    result.batteryInfo = await getBatteryOptimizationInfo();
    isInitialized = true;
  } catch (error) {
    console.error('[Notifications] Initialization failed:', error);
  }

  return result;
}

/**
 * Проверяет здоровье системы уведомлений
 */
export async function checkNotificationHealth(): Promise<{
  hasPermission: boolean;
  hasExactAlarmPermission: boolean;
  pendingCount: number;
  batteryOptimizationNeeded: boolean;
}> {
  if (!isCapacitor()) {
    return {
      hasPermission: typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted',
      hasExactAlarmPermission: true,
      pendingCount: 0,
      batteryOptimizationNeeded: false,
    };
  }

  const perm = await getNotificationPermission();
  const pending = await getPendingNotifications();
  const batteryInfo = await getBatteryOptimizationInfo();

  let hasExactAlarmPermission = true;
  try {
    const exactStatus = await LocalNotifications.checkExactNotificationSetting();
    hasExactAlarmPermission = exactStatus.exact_alarm === 'granted';
  } catch {
    // Старая версия плагина
  }

  return {
    hasPermission: perm.display === 'granted',
    hasExactAlarmPermission,
    pendingCount: pending.length,
    batteryOptimizationNeeded: batteryInfo?.needsSpecialSettings ?? false,
  };
}
