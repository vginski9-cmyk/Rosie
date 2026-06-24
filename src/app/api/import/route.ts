import { NextRequest, NextResponse } from "next/server";
import { parseWorkbook, mapCalendarBlocks } from "@/lib/etl/parseWorkbook";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/**
 * ETL endpoint.
 *  - action=preview (default): parse the workbook, return sheets + detected type.
 *  - action=load: commit recognized sheets (currently calendar_blocks) to a
 *    given institution.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const action = String(form.get("action") ?? "preview");
  const institutionId = form.get("institutionId") ? String(form.get("institutionId")) : null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let parsed;
  try {
    parsed = parseWorkbook(buffer, { previewRows: action === "load" ? 100000 : 8 });
  } catch (e) {
    return NextResponse.json({ error: `Could not parse workbook: ${(e as Error).message}` }, { status: 422 });
  }

  if (action === "load") {
    if (!institutionId) return NextResponse.json({ error: "institutionId required to load" }, { status: 400 });
    let loaded = 0;
    const log: string[] = [];
    for (const sheet of parsed.sheets) {
      if (sheet.detected === "calendar_blocks") {
        const records = mapCalendarBlocks(sheet);
        for (const r of records) {
          await prisma.calendarBlock.upsert({
            where: { institutionId_blockKey: { institutionId, blockKey: r.blockKey } },
            update: {
              name: r.name,
              termKey: r.termKey,
              academicYear: r.academicYear,
              termCode: r.termCode,
              startDate: r.startDate ? new Date(r.startDate) : null,
              endDate: r.endDate ? new Date(r.endDate) : null,
              lengthWeeks: r.lengthWeeks,
              lengthDays: r.lengthDays,
              nonHolidayMon: r.nonHolidayMon,
              nonHolidayTue: r.nonHolidayTue,
              nonHolidayWed: r.nonHolidayWed,
              nonHolidayThu: r.nonHolidayThu,
              nonHolidayFri: r.nonHolidayFri,
            },
            create: {
              institutionId,
              blockKey: r.blockKey,
              name: r.name,
              termKey: r.termKey,
              academicYear: r.academicYear,
              termCode: r.termCode,
              startDate: r.startDate ? new Date(r.startDate) : null,
              endDate: r.endDate ? new Date(r.endDate) : null,
              lengthWeeks: r.lengthWeeks,
              lengthDays: r.lengthDays,
              nonHolidayMon: r.nonHolidayMon,
              nonHolidayTue: r.nonHolidayTue,
              nonHolidayWed: r.nonHolidayWed,
              nonHolidayThu: r.nonHolidayThu,
              nonHolidayFri: r.nonHolidayFri,
            },
          });
          loaded++;
        }
        log.push(`Loaded ${records.length} calendar blocks from "${sheet.name}"`);
      }
    }
    return NextResponse.json({ ok: true, loaded, log });
  }

  // preview
  return NextResponse.json({
    fileName: file.name,
    sheets: parsed.sheets.map((s) => ({ name: s.name, detected: s.detected, headers: s.headers, rowCount: s.rowCount, sample: s.rows.slice(0, 5) })),
  });
}
