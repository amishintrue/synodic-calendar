import {
  date,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Дни, когда пользователь наблюдал новый месяц (молодую луну) вечером.
 * Следующий день считается 1-м днём синодического месяца.
 */
export const observations = pgTable("observations", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Произвольная заметка пользователя к конкретному дню (не обязательно
 * связанному с наблюдением) — например, про погоду или видимость.
 */
export const notes = pgTable("notes", {
  date: date("date", { mode: "string" }).primaryKey(),
  comment: text("comment").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Пользовательские напоминания: на конкретную дату или на день недели.
 * kind: 'date' — на дату (поле date), 'weekly' — еженедельно (поле weekday, 0=воскресенье).
 * lastNotifiedDate — дата (ISO), когда по этому напоминанию последний раз
 * отправлялось push-уведомление — нужно, чтобы не слать дважды за один день.
 */
export const reminders = pgTable("reminders", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  kind: text("kind").notNull(), // 'date' | 'weekly'
  date: date("date", { mode: "string" }),
  weekday: integer("weekday"), // 0 = воскресенье ... 6 = суббота
  time: text("time"), // 'HH:MM' опционально
  lastNotifiedDate: date("last_notified_date", { mode: "string" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Подписки на push-уведомления (Web Push API). Один браузер/устройство —
 * одна запись с уникальным endpoint.
 */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Настройки (ключ/значение): weekStart = 'sunday' | 'monday' и т.п. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
