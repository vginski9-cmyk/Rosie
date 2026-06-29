// Space & scheduling engine. The single brain behind the offering calendars AND
// the institution-wide master space calendar. Works on "bookings" — recurring
// weekly meetings placed on a (weekday, time-of-day, room) and active across a
// real calendar date range — so conflicts and room utilization are computed the
// same way everywhere. Pure TS (no Prisma, no React) → unit-testable.

export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export const WEEKDAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
export const ALL_DAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const DAY_START_MIN = 8 * 60; // 08:00 — earliest a campus room is booked
export const DAY_END_MIN = 20 * 60; // 20:00 — latest a campus room is booked
export const SLOT_MIN = 30; // placement granularity
const WEEK_MS = 7 * 24 * 3600 * 1000;

export const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const toHHMM = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const timeOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean => aStart < bEnd && bStart < aEnd;
/** Inclusive date-range overlap (ms). */
export const weeksOverlap = (a1: number, a2: number, b1: number, b2: number): boolean => a1 <= b2 && b1 <= a2;

/** A room (Facility) available to host campus meetings. */
export interface RoomLite {
  id: string;
  name: string;
  kind: string; // CLASSROOM | LAB | CLINICAL | SIM | OTHER
  capacity: number | null;
}

/** Which room kinds can host each meeting kind. CLINICAL is off-campus. */
export const ROOM_KINDS_FOR: Record<string, string[]> = {
  CLASS: ["CLASSROOM", "OTHER"],
  LAB: ["LAB", "SIM"],
  CLINICAL: [], // hosted at employer sites — never competes for campus rooms
};

/** A placed, recurring weekly booking. */
export interface Booking {
  id: string;
  cohortId: string;
  sectionIndex: number;
  kind: string;
  seats: number;
  lengthHours: number;
  dayOfWeek: Weekday;
  startMin: number; // minutes from midnight
  weekStartMs: number; // calendar ms of the FIRST week it recurs
  weekEndMs: number; // calendar ms of the LAST week it recurs
  facilityId: string | null;
  staffPersonId: string | null;
}

export type ConflictKind = "room" | "staff" | "section";
export interface Conflict {
  kind: ConflictKind;
  aId: string;
  bId: string;
  dayOfWeek: Weekday;
  key: string; // room/staff/section id involved
  detail: string;
}

/** All hard conflicts across a set of bookings: a room double-booked, a person
 *  teaching two at once, or one cohort-section expected in two places at once —
 *  in each case only when the weekday, time-of-day AND calendar weeks all overlap. */
export function detectConflicts(bookings: Booking[]): Conflict[] {
  const out: Conflict[] = [];
  // Bucket by weekday so we only compare same-day meetings.
  const byDay = new Map<Weekday, Booking[]>();
  for (const b of bookings) {
    const arr = byDay.get(b.dayOfWeek) ?? [];
    arr.push(b);
    byDay.set(b.dayOfWeek, arr);
  }
  for (const [day, arr] of byDay) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        const aEnd = a.startMin + a.lengthHours * 60;
        const bEnd = b.startMin + b.lengthHours * 60;
        if (!timeOverlap(a.startMin, aEnd, b.startMin, bEnd)) continue;
        if (!weeksOverlap(a.weekStartMs, a.weekEndMs, b.weekStartMs, b.weekEndMs)) continue;
        if (a.facilityId && b.facilityId && a.facilityId === b.facilityId) {
          out.push({ kind: "room", aId: a.id, bId: b.id, dayOfWeek: day, key: a.facilityId, detail: `room double-booked ${day} ${toHHMM(a.startMin)}` });
        }
        if (a.staffPersonId && b.staffPersonId && a.staffPersonId === b.staffPersonId) {
          out.push({ kind: "staff", aId: a.id, bId: b.id, dayOfWeek: day, key: a.staffPersonId, detail: `staff double-booked ${day} ${toHHMM(a.startMin)}` });
        }
        if (a.cohortId === b.cohortId && a.sectionIndex === b.sectionIndex) {
          out.push({ kind: "section", aId: a.id, bId: b.id, dayOfWeek: day, key: `${a.cohortId}#${a.sectionIndex}`, detail: `section overlap ${day} ${toHHMM(a.startMin)}` });
        }
      }
    }
  }
  return out;
}

export interface RoomUse {
  facilityId: string;
  name: string;
  kind: string;
  capacity: number | null;
  bookedHoursPeakWeek: number; // busiest week's booked hours
  openHoursPerWeek: number;
  utilization: number; // 0..1 (peak week booked / open)
  meetingCount: number;
  distinctDays: number;
}

/** Per-room utilization: the busiest single week's booked hours ÷ open hours.
 *  Campus rooms only (CLINICAL meetings are off-campus and excluded). */
export function roomUtilization(bookings: Booking[], rooms: RoomLite[], openHoursPerWeek = (DAY_END_MIN - DAY_START_MIN) / 60 * WEEKDAYS.length): RoomUse[] {
  const byRoom = new Map<string, Booking[]>();
  for (const b of bookings) {
    if (!b.facilityId) continue;
    const arr = byRoom.get(b.facilityId) ?? [];
    arr.push(b);
    byRoom.set(b.facilityId, arr);
  }
  return rooms.map((r) => {
    const arr = byRoom.get(r.id) ?? [];
    // Candidate weeks = every booking's start week; peak = week with max booked hrs.
    const weekStarts = [...new Set(arr.map((b) => b.weekStartMs))];
    let peak = 0;
    for (const w of weekStarts) {
      const wEnd = w; // a single week instant; a booking is active if its span covers w
      const hrs = arr.filter((b) => weeksOverlap(b.weekStartMs, b.weekEndMs, w, wEnd)).reduce((n, b) => n + b.lengthHours, 0);
      if (hrs > peak) peak = hrs;
    }
    const days = new Set(arr.map((b) => b.dayOfWeek));
    return {
      facilityId: r.id, name: r.name, kind: r.kind, capacity: r.capacity,
      bookedHoursPeakWeek: Math.round(peak * 10) / 10, openHoursPerWeek,
      utilization: openHoursPerWeek > 0 ? Math.min(1, peak / openHoursPerWeek) : 0,
      meetingCount: arr.length, distinctDays: days.size,
    };
  });
}

// --- Auto-scheduler: place meetings on (day, time, room) with no conflicts -----

export interface PlaceReq {
  id: string;
  cohortId: string;
  sectionIndex: number;
  kind: string;
  seats: number;
  lengthHours: number;
  weekStartMs: number;
  weekEndMs: number;
  staffPersonId?: string | null;
  preferDay?: Weekday;
  preferStartMin?: number;
}
export interface Placement {
  dayOfWeek: Weekday;
  startMin: number;
  facilityId: string | null;
}
export interface ScheduleResult {
  placements: Map<string, Placement>;
  unroomed: string[]; // placed in time but no campus room was free (space pressure)
}

/** Greedy institution-wide scheduler. Places each meeting on the first feasible
 *  (weekday, start time, room) that introduces no room / staff / section conflict
 *  with everything placed so far, honoring room kind + capacity. Off-campus
 *  CLINICAL meetings take a day/time but no room. Most-constrained meetings
 *  (longest, then largest) are placed first. Anything that can't get a room still
 *  gets a time (so it shows on the calendar) and is reported as unroomed. */
export function autoSchedule(reqs: PlaceReq[], rooms: RoomLite[], opts?: { dayStart?: number; dayEnd?: number }): ScheduleResult {
  const dayStart = opts?.dayStart ?? DAY_START_MIN;
  const dayEnd = opts?.dayEnd ?? DAY_END_MIN;
  const placed: Booking[] = [];
  const placements = new Map<string, Placement>();
  const unroomed: string[] = [];

  const order = [...reqs].sort((a, b) => b.lengthHours - a.lengthHours || b.seats - a.seats || a.id.localeCompare(b.id));

  // Rotated day/time candidate lists so sections of the same course spread out.
  const rotate = <T,>(arr: T[], by: number): T[] => arr.map((_, i) => arr[(i + by) % arr.length]);

  const feasible = (cand: Booking): { roomConflict: boolean; otherConflict: boolean } => {
    let roomConflict = false, otherConflict = false;
    const cEnd = cand.startMin + cand.lengthHours * 60;
    for (const p of placed) {
      if (p.dayOfWeek !== cand.dayOfWeek) continue;
      if (!timeOverlap(cand.startMin, cEnd, p.startMin, p.startMin + p.lengthHours * 60)) continue;
      if (!weeksOverlap(cand.weekStartMs, cand.weekEndMs, p.weekStartMs, p.weekEndMs)) continue;
      if (cand.facilityId && p.facilityId === cand.facilityId) roomConflict = true;
      if (cand.staffPersonId && p.staffPersonId === cand.staffPersonId) otherConflict = true;
      if (p.cohortId === cand.cohortId && p.sectionIndex === cand.sectionIndex) otherConflict = true;
    }
    return { roomConflict, otherConflict };
  };

  for (const r of order) {
    const seed = (r.sectionIndex - 1);
    const days = rotate(WEEKDAYS, r.preferDay ? WEEKDAYS.indexOf(r.preferDay) : seed % WEEKDAYS.length);
    const times: number[] = [];
    for (let t = dayStart; t + r.lengthHours * 60 <= dayEnd; t += SLOT_MIN) times.push(t);
    const startTimes = r.preferStartMin != null
      ? [r.preferStartMin, ...times.filter((t) => t !== r.preferStartMin)]
      : rotate(times, (seed * 3) % Math.max(1, times.length));
    // Rooms that can host this kind, smallest adequate first (pack tight).
    const kinds = ROOM_KINDS_FOR[r.kind] ?? [];
    const pool = rooms
      .filter((rm) => kinds.includes(rm.kind))
      .sort((a, b) => (a.capacity ?? 1e9) - (b.capacity ?? 1e9) || a.name.localeCompare(b.name));
    const offCampus = kinds.length === 0;

    let chosen: Placement | null = null;
    let fallback: Placement | null = null; // a time that's section/staff-clear but unroomed
    outer:
    for (const day of days) {
      for (const startMin of startTimes) {
        if (offCampus) {
          const cand: Booking = { ...mkBooking(r), dayOfWeek: day, startMin, facilityId: null };
          const f = feasible(cand);
          if (!f.otherConflict) { chosen = { dayOfWeek: day, startMin, facilityId: null }; break outer; }
          continue;
        }
        for (const rm of pool) {
          if (rm.capacity != null && r.seats > rm.capacity) continue;
          const cand: Booking = { ...mkBooking(r), dayOfWeek: day, startMin, facilityId: rm.id };
          const f = feasible(cand);
          if (!f.roomConflict && !f.otherConflict) { chosen = { dayOfWeek: day, startMin, facilityId: rm.id }; break outer; }
          if (!f.otherConflict && !fallback) fallback = { dayOfWeek: day, startMin, facilityId: null };
        }
      }
    }
    const final = chosen ?? fallback ?? { dayOfWeek: r.preferDay ?? "Mon", startMin: r.preferStartMin ?? dayStart, facilityId: null };
    if (!offCampus && final.facilityId == null) unroomed.push(r.id);
    placements.set(r.id, final);
    placed.push({ ...mkBooking(r), ...final });
  }
  return { placements, unroomed };
}

function mkBooking(r: PlaceReq): Booking {
  return {
    id: r.id, cohortId: r.cohortId, sectionIndex: r.sectionIndex, kind: r.kind, seats: r.seats,
    lengthHours: r.lengthHours, dayOfWeek: "Mon", startMin: DAY_START_MIN,
    weekStartMs: r.weekStartMs, weekEndMs: r.weekEndMs, facilityId: null, staffPersonId: r.staffPersonId ?? null,
  };
}
