/**
 * SQLite schema for the Lunar Calendar app.
 * Mirrors the PostgreSQL schema but adapted for SQLite.
 */

export const SQLITE_SCHEMA = `
-- Наблюдения нового месяца (молодой луны)
CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,  -- ISO format: YYYY-MM-DD
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Заметки к дням
CREATE TABLE IF NOT EXISTS notes (
  date TEXT PRIMARY KEY,      -- ISO format: YYYY-MM-DD
  comment TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Напоминания
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('date', 'weekly')),
  date TEXT,                  -- ISO format для kind='date'
  weekday INTEGER,            -- 0=воскресенье..6=суббота для kind='weekly'
  time TEXT,                  -- HH:MM format
  last_notified_date TEXT,    -- ISO format
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Push-подписки (не нужны для оффлайн, но оставим для совместимости)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Настройки (ключ/значение)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Индексы для производительности
CREATE INDEX IF NOT EXISTS idx_observations_date ON observations(date);
CREATE INDEX IF NOT EXISTS idx_reminders_kind_date ON reminders(kind, date);
CREATE INDEX IF NOT EXISTS idx_reminders_kind_weekday ON reminders(kind, weekday);
`;

export const INITIAL_SETTINGS = [
  { key: 'weekStart', value: 'sunday' },
  { key: 'appTimezone', value: 'Asia/Yekaterinburg' },
  { key: 'lastMoonAlertDate', value: '' },
];