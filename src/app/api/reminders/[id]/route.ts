import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { reminders } from "@/db/schema";
import { eq } from "drizzle-orm";

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
