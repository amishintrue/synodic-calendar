import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { reminders, observations, settings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isNewMoon, moonPhaseTrig2, parseISO, synodicDayFor } from "@/lib/moon";
import { isReminderDueNow, nowInAppTimezone } from "@/lib/reminders";
import { sendPushToAll } from "@/lib/push";

/**
 * Вызывается по расписанию (Vercel Cron раз в сутки и/или внешний
 * бесплатный пингер вроде cron-job.org каждые 10-15 минут — см. README).
 * Проверяет, какие напоминания и лунные предупреждения "созрели" именно
 * сейчас, и рассылает push-уведомления, отмечая их как уже отправленные,
 * чтобы не дублировать в течение дня.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const keyParam = req.nextUrl.searchParams.get("key");
    const ok = auth === `Bearer ${secret}` || keyParam === secret;
    if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = nowInAppTimezone();
  const sentTitles: string[] = [];

  // --- Лунное предупреждение (не привязано к конкретному напоминанию) ---
  const obsRows = await db.select().from(observations);
  const obsDates = obsRows.map((o) => o.date).sort();
  const todaySynodic = synodicDayFor(today.dateISO, obsDates);
  const { y, m, d } = parseISO(today.dateISO);
  const todayPhase = moonPhaseTrig2(y, m, d);

  let moonAlertText: string | null = null;
  if (todaySynodic && todaySynodic.day >= 29) {
    moonAlertText = `Идёт ${todaySynodic.day}-й день синодического месяца — приближается новый месяц! Понаблюдайте молодую луну сегодня вечером.`;
  } else if (!todaySynodic && isNewMoon(todayPhase)) {
    moonAlertText = "Сегодня новолуние (по расчёту). В ближайшие вечера ожидается появление нового месяца.";
  }

  if (moonAlertText) {
    const settingRows = await db.select().from(settings).where(eq(settings.key, "lastMoonAlertDate"));
    const lastSent = settingRows[0]?.value;
    if (lastSent !== today.dateISO) {
      await sendPushToAll({ title: "🌑 Лунный календарь", body: moonAlertText });
      await db
        .insert(settings)
        .values({ key: "lastMoonAlertDate", value: today.dateISO })
        .onConflictDoUpdate({ target: settings.key, set: { value: today.dateISO } });
      sentTitles.push("moon-alert");
    }
  }

  // --- Пользовательские напоминания ---
  const allReminders = await db.select().from(reminders);
  for (const r of allReminders) {
    if (isReminderDueNow(r, today)) {
      await sendPushToAll({
        title: "🔔 Напоминание",
        body: r.time ? `${r.title} (в ${r.time})` : r.title,
      });
      await db
        .update(reminders)
        .set({ lastNotifiedDate: today.dateISO })
        .where(eq(reminders.id, r.id));
      sentTitles.push(r.title);
    }
  }

  return NextResponse.json({ ok: true, checkedAt: today, sent: sentTitles });
}
