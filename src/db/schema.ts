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
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Пользовательские напоминания: на конкретную дату или на день недели.
 * kind: 'date' — на дату (поле date), 'weekly' — еженедельно (поле weekday, 0=воскресенье).
 */
export const reminders = pgTable("reminders", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  kind: text("kind").notNull(), // 'date' | 'weekly'
  date: date("date", { mode: "string" }),
  weekday: integer("weekday"), // 0 = воскресенье ... 6 = суббота
  time: text("time"), // 'HH:MM' опционально
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Настройки (ключ/значение): weekStart = 'sunday' | 'monday' и т.п. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
