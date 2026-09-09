// Calendarize an offering: one weekly booking (meeting pattern) per course ×
// session type × section, placed into campus rooms without conflicts, with
// clinical sections attributed to partner sites. Pure — the server action and
// the seed both call it.

import { autoSchedule, toHHMM, type PlaceReq, type RoomLite, type Weekday } from "./space";
import { sectionSlot, toMinutes } from "./sessiontimes";
import { hostSlots, type HostLite } from "./hosts";
import type { RotationCode } from "./assetmap";

const WK_MS = 7 * 24 * 3600 * 1000;

export interface CalendarizeTerm {
  id: string; index: number; startWeek: number | null; endWeek: number | null;
  /** Real first day of the term (ms), if dated. */
  startMs: number | null;
  /** Real last day of the term (ms) — weekly bookings recur until it, not past the semester. */
  endMs?: number | null;
  courses: { id: string; sessions: { kind: string; maxStudents: number; lengthHours: number; dayOfWeek?: string | null; startTime?: string | null; sectionTimes?: string | null; location?: string | null; rotationType?: string | null }[] }[];
}
export interface CalendarizeInput {
  cohortId: string;
  /** Term-1 seats — sections = ceil(seats ÷ session capacity). */
  seats: number;
  /** Offering start (ms) — synthesizes term windows for undated terms. */
  cohortStartMs: number | null;
  terms: CalendarizeTerm[];
  rooms: RoomLite[];
  /** Partner sites that can host clinical sections, secured first (fallback when no host matches a rotation's setting). */
  hostIds: string[];
  /** Sites with their assets by setting and agreement rank — clinical sections go to sites that HAVE the setting the rotation needs. */
  hosts?: HostLite[];
  /** Rotation type → asset setting code (the institution's coded map). */
  rotations?: RotationCode[];
}
export interface MeetingRow {
  cohortId: string; courseId: string; kind: string; sectionIndex: number; sectionCount: number; seats: number;
  dayOfWeek: string; startTime: string; lengthHours: number; termIndex: number; startWeek: number; endWeek: number;
  facilityId: string | null; employerId: string | null; staffPersonId: string | null;
}

const normName = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function planMeetings(input: CalendarizeInput): MeetingRow[] {
  const E = Math.max(1, Math.round(input.seats));
  const reqs: PlaceReq[] = [];
  const roomByName = new Map(input.rooms.map((r) => [normName(r.name), r]));
  const codeOf = new Map((input.rotations ?? []).map((r) => [r.rotationType.toLowerCase(), r.settingCode]));
  const siteSlots = new Map<string, string[]>();
  const meta = new Map<string, { courseId: string; kind: string; sectionIndex: number; sectionCount: number; seats: number; lengthHours: number; termIndex: number; startWeek: number; endWeek: number }>();
  for (const t of input.terms) {
    const base = t.startMs ?? (input.cohortStartMs != null ? input.cohortStartMs + (t.index - 1) * 17 * WK_MS : null);
    if (base == null) continue;
    const tw = (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1;
    const endMs = t.startMs != null && t.endMs != null && t.endMs > t.startMs ? t.endMs + 24 * 3600 * 1000 : base + tw * WK_MS;
    for (const c of t.courses) {
      // The course's weekly pattern per kind: the sheet's own day, time and room when it states them.
      const kinds = new Map<string, { maxStudents: number; lengthHours: number; sample: (typeof c.sessions)[number] }>();
      for (const s of c.sessions) {
        const cur = kinds.get(s.kind);
        // Prefer a session that states a day/time as the pattern's representative.
        if (!cur || (!(cur.sample.dayOfWeek && (cur.sample.startTime || cur.sample.sectionTimes)) && s.dayOfWeek && (s.startTime || s.sectionTimes))) kinds.set(s.kind, { maxStudents: s.maxStudents, lengthHours: s.lengthHours, sample: s });
      }
      for (const [kind, info] of kinds) {
        const cap = Math.max(1, info.maxStudents || (kind === "CLINICAL" ? 8 : 30));
        const sections = Math.max(1, Math.ceil(E / cap));
        const room = info.sample.location ? roomByName.get(normName(info.sample.location)) ?? null : null;
        // Sites for this course's clinical: the settings its rotation types need, at sites that have them.
        let slots: string[] = [];
        if (kind === "CLINICAL" && input.hosts?.length) {
          // Setting codes the course's clinical sessions need, most-used first (the primary setting).
          const freq = new Map<string, number>();
          for (const s of c.sessions) { if (s.kind !== "CLINICAL") continue; const code = codeOf.get((s.rotationType ?? "").trim().toLowerCase()); if (code) freq.set(code, (freq.get(code) ?? 0) + 1); }
          const codes = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
          slots = codes.length ? hostSlots(input.hosts, codes) : [];
          if (!slots.length) slots = [...input.hosts].sort((a, b) => a.rank - b.rank).map((h) => h.employerId);
        }
        siteSlots.set(`${c.id}|${kind}`, slots);
        for (let si = 1; si <= sections; si++) {
          const id = `${input.cohortId}:${c.id}:${kind}:${si}`;
          const slot = sectionSlot({ dayOfWeek: info.sample.dayOfWeek ?? null, startTime: info.sample.startTime ?? null, sectionTimes: info.sample.sectionTimes ?? null }, si);
          const preferDay = (slot?.dayOfWeek ?? info.sample.dayOfWeek ?? undefined) as Weekday | undefined;
          // Seats dealt evenly: 41 students in 4 sections are 11, 10, 10, 10 — never 44.
          const seats = Math.floor(E / sections) + (si <= E % sections ? 1 : 0);
          reqs.push({ id, cohortId: input.cohortId, sectionIndex: si, kind, seats, lengthHours: info.lengthHours || 2, weekStartMs: base, weekEndMs: endMs, preferDay, preferStartMin: slot ? toMinutes(slot.startTime) : undefined, preferFacilityId: room?.id ?? undefined });
          meta.set(id, { courseId: c.id, kind, sectionIndex: si, sectionCount: sections, seats, lengthHours: info.lengthHours || 2, termIndex: t.index, startWeek: t.startWeek ?? 1, endWeek: t.endWeek ?? 16 });
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
      facilityId: pl.facilityId, employerId: m.kind === "CLINICAL" ? (siteSlots.get(`${m.courseId}|${m.kind}`)?.length ? siteSlots.get(`${m.courseId}|${m.kind}`)![(m.sectionIndex - 1) % siteSlots.get(`${m.courseId}|${m.kind}`)!.length] : input.hostIds.length ? input.hostIds[(ci++) % input.hostIds.length] : null) : null, staffPersonId: null,
    };
  });
}
