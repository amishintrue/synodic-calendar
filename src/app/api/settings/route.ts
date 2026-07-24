import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings } from "@/db/schema";

export async function GET() {
  const rows = await db.select().from(settings);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return NextResponse.json(map);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const key: unknown = body?.key;
  const value: unknown = body?.value;
  if (typeof key !== "string" || typeof value !== "string") {
    return NextResponse.json({ error: "key/value обязательны" }, { status: 400 });
  }
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
  return NextResponse.json({ ok: true });
}
