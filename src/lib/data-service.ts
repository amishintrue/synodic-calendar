/**
 * Data Service Layer - Unified interface for data access
 * Uses SQLite when in Capacitor (Android), falls back to localStorage for web
 */

import { db } from '@/db/sqlite';
import { initializeDatabase } from '@/db/init';
import {
  scheduleReminderNotification,
  cancelReminderNotification,
  setRescheduleCallback,
  isCapacitor,
} from '@/lib/local-notifications';

// Types
export interface Observation {
  id: number;
  date: string;
}

export interface Note {
  date: string;
  comment: string;
}

export interface Reminder {
  id: number;
  title: string;
  kind: 'date' | 'weekly';
  date: string | null;
  weekday: number | null;
  time: string | null;
}

export interface Settings {
  weekStart: 'sunday' | 'monday';
  appTimezone: string;
  lastMoonAlertDate: string;
  /** '1', если пользователь нажал «Готово, настроил(а)» в подсказке по батарее/автозапуску. */
  batteryOptimizationDismissed: string;
  /** Режим отображения календарной сетки: григорианский месяц или библейский. */
  calendarMode: 'gregorian' | 'biblical';
}

// Converters
function toObservation(row: Observation): Observation {
  return { id: row.id, date: row.date };
}

function toNote(row: Note): Note {
  return { date: row.date, comment: row.comment };
}

function toReminder(row: Reminder): Reminder {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    date: row.date,
    weekday: row.weekday,
    time: row.time,
  };
}

// ============ Observations ============

export async function getObservations(): Promise<Observation[]> {
  await initializeDatabase();
  const rows = await db.getObservations();
  return rows.map(toObservation);
}

export async function addObservation(date: string): Promise<Observation[]> {
  await initializeDatabase();
  const rows = await db.addObservation(date);
  return rows.map(toObservation);
}

export async function deleteObservation(date: string): Promise<Observation[]> {
  await initializeDatabase();
  const rows = await db.deleteObservation(date);
  return rows.map(toObservation);
}

// ============ Notes ============

export async function getNotes(): Promise<Note[]> {
  await initializeDatabase();
  const rows = await db.getNotes();
  return rows.map(toNote);
}

export async function saveNote(date: string, comment: string): Promise<Note[]> {
  await initializeDatabase();
  const rows = await db.saveNote(date, comment);
  return rows.map(toNote);
}

// ============ Reminders ============

export async function getReminders(): Promise<Reminder[]> {
  await initializeDatabase();
  const rows = await db.getReminders();
  return rows.map(toReminder);
}

export async function addReminder(
  title: string,
  kind: 'date' | 'weekly',
  date: string | null,
  weekday: number | null,
  time: string | null
): Promise<Reminder> {
  await initializeDatabase();
  const row = await db.addReminder(title, kind, date, weekday, time);
  const reminder = toReminder(row);
  
  // Планируем уведомление в системе
  await scheduleReminderNotification(reminder);
  
  return reminder;
}

export async function updateReminder(
  id: number,
  title: string,
  kind: 'date' | 'weekly',
  date: string | null,
  weekday: number | null,
  time: string | null
): Promise<Reminder | null> {
  await initializeDatabase();
  const row = await db.updateReminder(id, title, kind, date, weekday, time);
  if (!row) return null;
  
  const reminder = toReminder(row);
  
  // Перепланируем уведомление
  await scheduleReminderNotification(reminder);
  
  return reminder;
}

export async function deleteReminder(id: number): Promise<void> {
  await initializeDatabase();
  await db.deleteReminder(id);
  await cancelReminderNotification(id);
}

/**
 * Перепланирует еженедельное напоминание на следующую неделю
 * Вызывается после срабатывания уведомления
 */
export async function rescheduleWeeklyReminder(id: number): Promise<void> {
  const reminder = await db.getReminderById(id);
  if (reminder && reminder.kind === 'weekly') {
    await scheduleReminderNotification(reminder);
    console.log('[DataService] Rescheduled weekly reminder:', id);
  }
}

// Устанавливаем колбэк для перепланирования
setRescheduleCallback(rescheduleWeeklyReminder);

/**
 * Пересоздаёт все уведомления из БД
 * Вызывайте при старте приложения для восстановления после перезагрузки
 */
export async function rescheduleAllReminders(): Promise<void> {
  if (!isCapacitor()) return;
  
  try {
    const reminders = await getReminders();
    for (const r of reminders) {
      await scheduleReminderNotification(r);
    }
    console.log('[DataService] Rescheduled', reminders.length, 'reminders');
  } catch (error) {
    console.error('[DataService] Failed to reschedule reminders:', error);
  }
}

// ============ Settings ============

export async function getSettings(): Promise<Settings> {
  await initializeDatabase();
  const rows = await db.getSettings();
  return {
    weekStart: (rows.weekStart as 'sunday' | 'monday') || 'sunday',
    appTimezone: rows.appTimezone || 'Asia/Yekaterinburg',
    lastMoonAlertDate: rows.lastMoonAlertDate || '',
    batteryOptimizationDismissed: rows.batteryOptimizationDismissed || '',
    calendarMode: rows.calendarMode === 'biblical' ? 'biblical' : 'gregorian',
  };
}

export async function setSetting(
  key:
    | 'weekStart'
    | 'appTimezone'
    | 'lastMoonAlertDate'
    | 'batteryOptimizationDismissed'
    | 'calendarMode',
  value: string
): Promise<void> {
  await initializeDatabase();
  await db.setSetting(key, value);
}

export async function toggleWeekStart(current: 'sunday' | 'monday'): Promise<'sunday' | 'monday'> {
  const next = current === 'sunday' ? 'monday' : 'sunday';
  await setSetting('weekStart', next);
  return next;
}

export async function toggleCalendarMode(
  current: 'gregorian' | 'biblical'
): Promise<'gregorian' | 'biblical'> {
  const next = current === 'gregorian' ? 'biblical' : 'gregorian';
  await setSetting('calendarMode', next);
  return next;
}
