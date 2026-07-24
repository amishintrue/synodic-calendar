import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { observations } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

export async function GET() {
  const rows = await db
    .select()
    .from(observations)
    .orderBy(asc(observations.date));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const dateISO: unknown = body?.date;
  const commentRaw: unknown = body?.comment;
  if (typeof dateISO !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    return NextResponse.json({ error: "Некорректная дата" }, { status: 400 });
  }
  const comment =
    typeof commentRaw === "string" && commentRaw.trim().length > 0
      ? commentRaw.trim().slice(0, 500)
      : null;
  // Если день уже отмечен — обновляем только комментарий (позволяет
  // добавить/изменить его позже, не снимая и не ставя отметку заново).
  await db
    .insert(observations)
    .values({ date: dateISO, comment })
    .onConflictDoUpdate({
      target: observations.date,
      set: { comment },
    });
  const rows = await db
    .select()
    .from(observations)
    .orderBy(asc(observations.date));
  return NextResponse.json(rows, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const dateISO = req.nextUrl.searchParams.get("date");
  if (!dateISO) {
    return NextResponse.json({ error: "Не указана дата" }, { status: 400 });
  }
  await db.delete(observations).where(eq(observations.date, dateISO));
  const rows = await db
    .select()
    .from(observations)
    .orderBy(asc(observations.date));
  return NextResponse.json(rows);
}
