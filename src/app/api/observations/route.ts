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
  if (typeof dateISO !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    return NextResponse.json({ error: "Некорректная дата" }, { status: 400 });
  }
  await db
    .insert(observations)
    .values({ date: dateISO })
    .onConflictDoNothing();
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
