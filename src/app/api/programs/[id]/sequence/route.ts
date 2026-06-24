import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Persist a re-sequenced course layout. Accepts the full set of courses with
 * their (possibly new) termId and order, and writes them in a transaction.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = (await req.json()) as { courses: { id: string; termId: string; sequenceOrder: number }[] };
  if (!Array.isArray(body.courses)) {
    return NextResponse.json({ error: "courses[] required" }, { status: 400 });
  }

  // Validate the courses belong to this program (defense in depth for tenancy).
  const owned = await prisma.course.findMany({
    where: { id: { in: body.courses.map((c) => c.id) }, term: { programId: params.id } },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((c) => c.id));
  const updates = body.courses.filter((c) => ownedIds.has(c.id));

  await prisma.$transaction(
    updates.map((c) =>
      prisma.course.update({ where: { id: c.id }, data: { termId: c.termId, sequenceOrder: c.sequenceOrder } }),
    ),
  );

  return NextResponse.json({ ok: true, updated: updates.length });
}
