import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { reminders } from "@/db/schema";
import { asc } from "drizzle-orm";

export async function GET() {
  const rows = await db.select().from(reminders).orderBy(asc(reminders.id));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Пустой запрос" }, { status: 400 });

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const kind = body.kind === "weekly" ? "weekly" : "date";
  const dateISO =
    typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : null;
  const weekday =
    Number.isInteger(body.weekday) && body.weekday >= 0 && body.weekday <= 6
      ? (body.weekday as number)
      : null;
  const time =
    typeof body.time === "string" && /^\d{2}:\d{2}$/.test(body.time)
      ? body.time
      : null;

  if (!title) {
    return NextResponse.json({ error: "Введите текст напоминания" }, { status: 400 });
  }
  if (kind === "date" && !dateISO) {
    return NextResponse.json({ error: "Укажите дату" }, { status: 400 });
  }
  if (kind === "weekly" && weekday === null) {
    return NextResponse.json({ error: "Укажите день недели" }, { status: 400 });
  }

  const [row] = await db
    .insert(reminders)
    .values({
      title,
      kind,
      date: kind === "date" ? dateISO : null,
      weekday: kind === "weekly" ? weekday : null,
      time,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
