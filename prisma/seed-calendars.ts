// Each college's academic calendar, as the college publishes it (prisma/seed-data/calendars/*.txt,
// the text pasted from the college's calendar page or PDF), read by the same parser the setup
// page's paste box uses: semester starts and ends, later-session starts, and holidays and breaks
// become coded events, and the semester pattern (Monday on/after an anchor) follows the coded
// starts. Deadlines, registration windows and the like are read and ignored, as on the page.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { parseAcademicCalendar, anchorsFromEvents } from "../src/lib/academiccalendar";

/** Which file holds which college's calendar. Colleges not seeded (paused) are simply skipped. */
export const CALENDAR_FILES: Record<string, string> = {
  "Sandhills Community College": "sandhills.txt",
  "Carteret Community College": "carteret.txt",
  "Lenoir Community College": "lenoir.txt",
  "Craven Community College": "craven.txt",
  "Roanoke-Chowan Community College": "roanoke-chowan.txt",
  "College of The Albemarle": "albemarle.txt",
  "Brunswick Community College": "brunswick.txt",
  "Rowan-Cabarrus Community College": "rowan-cabarrus.txt",
  // Cape Fear: Summer 2026, Fall 2026 and Spring 2027 as published (term dates, sessions, closures); Spring 2027's
  // spring break and Summer 2027 were not found and are not seeded — the summer anchor follows the 2026 pattern.
  "Cape Fear Community College": "cape-fear.txt",
  // Southeastern: Fall 2026, Spring 2027 and Summer 2027 from the college's calendars page (read 2026-10-28);
  // Summer 2026 was not published there and is not seeded.
  "Southeastern Community College": "southeastern.txt",
  // UNCW: the registrar's 2026–27 dates (fall, spring, the two summer sessions); the nursing summer term spans both sessions.
  "University of North Carolina Wilmington": "uncw.txt",
};

export async function seedAcademicCalendars(prisma: PrismaClient, dir: string): Promise<Record<string, { events: number; starts: number; ends: number; sessions: number; holidays: number; anchors: string; warnings: number }>> {
  const out: Record<string, { events: number; starts: number; ends: number; sessions: number; holidays: number; anchors: string; warnings: number }> = {};
  for (const [name, file] of Object.entries(CALENDAR_FILES)) {
    const inst = await prisma.institution.findFirst({ where: { name }, select: { id: true, shortName: true, springStart: true, summerStart: true, fallStart: true } });
    const path = join(dir, file);
    if (!inst || !existsSync(path)) continue;
    const { events, warnings } = parseAcademicCalendar(readFileSync(path, "utf8"));
    const coded = events.filter((e) => e.kind !== "other");
    await prisma.academicEvent.deleteMany({ where: { institutionId: inst.id } });
    await prisma.academicEvent.createMany({ data: coded.map((e) => ({ institutionId: inst.id, date: new Date(e.iso + "T00:00:00Z"), endDate: e.endIso ? new Date(e.endIso + "T00:00:00Z") : null, label: e.label.slice(0, 200), kind: e.kind, season: e.season, source: e.source.slice(0, 500) })) });
    const anchors = anchorsFromEvents(events, { springStart: inst.springStart, summerStart: inst.summerStart, fallStart: inst.fallStart });
    await prisma.institution.update({ where: { id: inst.id }, data: anchors });
    const n = (k: string) => coded.filter((e) => e.kind === k).length;
    out[inst.shortName ?? name] = { events: coded.length, starts: n("term_start"), ends: n("term_end"), sessions: n("session_start"), holidays: n("holiday"), anchors: `${anchors.springStart} / ${anchors.summerStart} / ${anchors.fallStart}`, warnings: warnings.length };
  }
  return out;
}
