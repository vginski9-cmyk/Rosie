// Calendarize an offering: one weekly booking (meeting pattern) per course ×
// session type × section, placed into campus rooms without conflicts, with
// clinical sections attributed to partner sites. Pure — the server action and
// the seed both call it.

import { autoSchedule, toHHMM, type PlaceReq, type RoomLite } from "./space";

const WK_MS = 7 * 24 * 3600 * 1000;

export interface CalendarizeTerm {
  id: string; index: number; startWeek: number | null; endWeek: number | null;
  /** Real first day of the term (ms), if dated. */
  startMs: number | null;
  courses: { id: string; sessions: { kind: string; maxStudents: number; lengthHours: number }[] }[];
}
export interface CalendarizeInput {
  cohortId: string;
  /** Term-1 seats — sections = ceil(seats ÷ session capacity). */
  seats: number;
  /** Offering start (ms) — synthesizes term windows for undated terms. */
  cohortStartMs: number | null;
  terms: CalendarizeTerm[];
  rooms: RoomLite[];
  /** Partner sites that can host clinical sections, secured first. */
  hostIds: string[];
}
export interface MeetingRow {
  cohortId: string; courseId: string; kind: string; sectionIndex: number; sectionCount: number; seats: number;
  dayOfWeek: string; startTime: string; lengthHours: number; termIndex: number; startWeek: number; endWeek: number;
  facilityId: string | null; employerId: string | null; staffPersonId: string | null;
}

export function planMeetings(input: CalendarizeInput): MeetingRow[] {
  const E = Math.max(1, Math.round(input.seats));
  const reqs: PlaceReq[] = [];
  const meta = new Map<string, { courseId: string; kind: string; sectionIndex: number; sectionCount: number; seats: number; lengthHours: number; termIndex: number; startWeek: number; endWeek: number }>();
  for (const t of input.terms) {
    const base = t.startMs ?? (input.cohortStartMs != null ? input.cohortStartMs + (t.index - 1) * 17 * WK_MS : null);
    if (base == null) continue;
    const tw = (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1;
    for (const c of t.courses) {
      const kinds = new Map<string, { maxStudents: number; lengthHours: number }>();
      for (const s of c.sessions) if (!kinds.has(s.kind)) kinds.set(s.kind, { maxStudents: s.maxStudents, lengthHours: s.lengthHours });
      for (const [kind, info] of kinds) {
        const cap = Math.max(1, info.maxStudents || (kind === "CLINICAL" ? 8 : 30));
        const sections = Math.max(1, Math.ceil(E / cap));
        for (let si = 1; si <= sections; si++) {
          const id = `${input.cohortId}:${c.id}:${kind}:${si}`;
          reqs.push({ id, cohortId: input.cohortId, sectionIndex: si, kind, seats: Math.ceil(E / sections), lengthHours: info.lengthHours || 2, weekStartMs: base, weekEndMs: base + tw * WK_MS });
          meta.set(id, { courseId: c.id, kind, sectionIndex: si, sectionCount: sections, seats: Math.ceil(E / sections), lengthHours: info.lengthHours || 2, termIndex: t.index, startWeek: t.startWeek ?? 1, endWeek: t.endWeek ?? 16 });
        }
      }
    }
  }
  if (!reqs.length) return [];
  const { placements } = autoSchedule(reqs, input.rooms);
  let ci = 0;
  return reqs.map((r) => {
    const m = meta.get(r.id)!;
    const pl = placements.get(r.id)!;
    return {
      cohortId: input.cohortId, courseId: m.courseId, kind: m.kind, sectionIndex: m.sectionIndex, sectionCount: m.sectionCount, seats: m.seats,
      dayOfWeek: pl.dayOfWeek, startTime: toHHMM(pl.startMin), lengthHours: m.lengthHours, termIndex: m.termIndex, startWeek: m.startWeek, endWeek: m.endWeek,
      facilityId: pl.facilityId, employerId: m.kind === "CLINICAL" && input.hostIds.length ? input.hostIds[(ci++) % input.hostIds.length] : null, staffPersonId: null,
    };
  });
}
