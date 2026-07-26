import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { notes } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const rows = await db.select().from(notes);
  return NextResponse.json(rows);
}

/**
 * Сохранить заметку к любому дню. Пустой/пробельный комментарий удаляет
 * заметку целиком (так проще очистить поле, чем хранить пустые строки).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const dateISO: unknown = body?.date;
  const commentRaw: unknown = body?.comment;
  if (typeof dateISO !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    return NextResponse.json({ error: "Некорректная дата" }, { status: 400 });
  }
  const comment = typeof commentRaw === "string" ? commentRaw.trim().slice(0, 500) : "";

  if (comment.length === 0) {
    await db.delete(notes).where(eq(notes.date, dateISO));
  } else {
    await db
      .insert(notes)
      .values({ date: dateISO, comment })
      .onConflictDoUpdate({
        target: notes.date,
        set: { comment, updatedAt: new Date() },
      });
  }

  const rows = await db.select().from(notes);
  return NextResponse.json(rows, { status: 201 });
}
