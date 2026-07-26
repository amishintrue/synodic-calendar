import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { reminders } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (!Number.isInteger(numId)) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Пустой запрос" }, { status: 400 });

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const kind = body.kind === "weekly" ? "weekly" : "date";
  const dateISO =
    typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  const weekday =
    Number.isInteger(body.weekday) && body.weekday >= 0 && body.weekday <= 6
      ? (body.weekday as number)
      : null;
  const time = typeof body.time === "string" && /^\d{2}:\d{2}$/.test(body.time) ? body.time : null;

  if (!title) return NextResponse.json({ error: "Введите текст напоминания" }, { status: 400 });
  if (kind === "date" && !dateISO) return NextResponse.json({ error: "Укажите дату" }, { status: 400 });
  if (kind === "weekly" && weekday === null)
    return NextResponse.json({ error: "Укажите день недели" }, { status: 400 });

  const [row] = await db
    .update(reminders)
    .set({
      title,
      kind,
      date: kind === "date" ? dateISO : null,
      weekday: kind === "weekly" ? weekday : null,
      time,
      lastNotifiedDate: null, // изменили — можно уведомлять заново
    })
    .where(eq(reminders.id, numId))
    .returning();
  if (!row) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (!Number.isInteger(numId)) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }
  await db.delete(reminders).where(eq(reminders.id, numId));
  return NextResponse.json({ ok: true });
}
