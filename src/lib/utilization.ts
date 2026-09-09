// Room & campus utilization — the analytics behind the master calendar.
// Every weekly booking (meeting pattern) is expanded into dated occurrences
// ("atoms") inside a window; each atom knows its room, building, campus,
// program, course, cohort, session type and calendar coordinates (day, week,
// month, semester, year). Group the atoms any way you think about them and
// read booked hours, open hours (from each room's coded hours and closures),
// utilization, seat-hours and fill. Pure functions, no I/O.

import { openHoursOn, type HoursSpan, type Closure } from "./rooms";
import { seasonOfDate, semesterAt, type SemesterAnchors } from "./term";

export interface UtilRoom {
  id: string; name: string; kind: string; capacity: number | null;
  buildingId: string | null; building: string | null; campusId: string | null; campus: string | null;
  hours: HoursSpan[]; closures: Closure[];
}
export interface UtilMeeting {
  id: string; cohortId: string; cohort: string; programId: string; program: string;
  courseId: string; courseCode: string | null; courseName: string; kind: string; sectionIndex: number; seats: number;
  dayOfWeek: string; startTime: string; lengthHours: number;
  facilityId: string | null; employerId: string | null; employerName: string | null;
  weekStartMs: number; weekEndMs: number; termIndex: number;
}
export interface SemesterWindow { iso: string; endIso: string | null; season: string | null }
export interface UtilFilters {
  from: string; to: string;
  programIds?: string[]; courseIds?: string[]; cohortIds?: string[]; buildingIds?: string[]; roomIds?: string[];
  kinds?: string[]; weekdays?: string[];
  /** "campus" = roomed bookings only · "clinical" = partner-site bookings only · undefined = both. */
  where?: "campus" | "clinical";
}
export interface UtilAtom {
  meetingId: string; iso: string; weekday: string; monday: string; month: string; year: string; semester: string;
  startMin: number; endMin: number; hours: number; seats: number; kind: string;
  programId: string; program: string; courseId: string; course: string; cohortId: string; cohort: string;
  roomId: string | null; room: string | null; roomKind: string | null; capacity: number | null;
  buildingId: string | null; building: string | null; campusId: string | null; campus: string | null;
  siteId: string | null; site: string | null;
  /** The booking sits inside the room's coded open hours that day. */
  withinOpen: boolean | null;
}
export type UtilGroup = "day" | "week" | "month" | "semester" | "year" | "weekday" | "hour" | "program" | "course" | "cohort" | "kind" | "campus" | "building" | "room" | "site";
export const UTIL_GROUPS: { key: UtilGroup; label: string }[] = [
  { key: "room", label: "Room" }, { key: "building", label: "Building" }, { key: "campus", label: "Campus" }, { key: "site", label: "Clinical site" },
  { key: "program", label: "Program" }, { key: "course", label: "Course" }, { key: "cohort", label: "Cohort" }, { key: "kind", label: "Type" },
  { key: "day", label: "Day" }, { key: "week", label: "Week" }, { key: "month", label: "Month" }, { key: "semester", label: "Semester" }, { key: "year", label: "Year" }, { key: "weekday", label: "Weekday" }, { key: "hour", label: "Hour of day" },
];

const DAY = 86400000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_ORDER: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (s: string) => new Date(s + "T00:00:00Z");
export const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const mondayOf = (iso: string) => { const d = dateOf(iso); return isoOf(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY)); };
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtMD = (iso: string) => `${MONTH[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
export const fmtMDY = (iso: string) => `${fmtMD(iso)}, ${iso.slice(0, 4)}`;

/** The semester a date sits in: the coded window that contains it, else the
 *  pattern (the latest semester start on or before the date — early August is
 *  still the summer term). */
export function semesterOf(iso: string, semesters: SemesterWindow[] = [], anchors?: SemesterAnchors): string {
  const hit = semesters.find((s) => s.iso <= iso && (s.endIso ?? "9999") >= iso);
  if (hit) return `${hit.season ?? seasonOfDate(dateOf(hit.iso))} ${hit.iso.slice(0, 4)}`;
  const s = semesterAt(dateOf(iso), anchors);
  return `${s.season} ${s.year}`;
}

/** Expand every weekly booking into dated occurrences inside the window, after filters. */
export function utilizationAtoms(meetings: UtilMeeting[], rooms: UtilRoom[], f: UtilFilters, semesters: SemesterWindow[] = [], anchors?: SemesterAnchors): UtilAtom[] {
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const out: UtilAtom[] = [];
  const fromMs = dateOf(f.from).getTime(), toMs = dateOf(f.to).getTime();
  if (!(toMs >= fromMs)) return out;
  for (const m of meetings) {
    if (!m.weekStartMs) continue;
    if (f.where === "campus" && !m.facilityId) continue;
    if (f.where === "clinical" && m.kind !== "CLINICAL") continue;
    if (f.programIds?.length && !f.programIds.includes(m.programId)) continue;
    if (f.courseIds?.length && !f.courseIds.includes(m.courseId)) continue;
    if (f.cohortIds?.length && !f.cohortIds.includes(m.cohortId)) continue;
    if (f.kinds?.length && !f.kinds.includes(m.kind)) continue;
    if (f.weekdays?.length && !f.weekdays.includes(m.dayOfWeek)) continue;
    const room = m.facilityId ? roomById.get(m.facilityId) ?? null : null;
    if (f.roomIds?.length && !(m.facilityId && f.roomIds.includes(m.facilityId))) continue;
    if (f.buildingIds?.length && !(room?.buildingId && f.buildingIds.includes(room.buildingId))) continue;
    const wd = DAY_ORDER[m.dayOfWeek]; if (wd == null) continue;
    // First occurrence on/after max(window start, booking start) that falls on the weekday.
    const start = Math.max(fromMs, m.weekStartMs);
    const end = Math.min(toMs, m.weekEndMs - 1);
    if (end < start) continue;
    const d0 = new Date(start);
    const off = (wd - ((d0.getUTCDay() + 6) % 7) + 7) % 7;
    const startMin = toMin(m.startTime), endMin = startMin + Math.round(m.lengthHours * 60);
    for (let t = start + off * DAY; t <= end; t += 7 * DAY) {
      const iso = isoOf(new Date(t));
      out.push({
        meetingId: m.id, iso, weekday: m.dayOfWeek, monday: mondayOf(iso), month: iso.slice(0, 7), year: iso.slice(0, 4), semester: semesterOf(iso, semesters, anchors),
        startMin, endMin, hours: m.lengthHours, seats: m.seats, kind: m.kind,
        programId: m.programId, program: m.program, courseId: m.courseId, course: m.courseCode ?? m.courseName, cohortId: m.cohortId, cohort: m.cohort,
        roomId: room?.id ?? null, room: room?.name ?? null, roomKind: room?.kind ?? null, capacity: room?.capacity ?? null,
        buildingId: room?.buildingId ?? null, building: room?.building ?? null, campusId: room?.campusId ?? null, campus: room?.campus ?? null,
        siteId: m.employerId, site: m.employerName,
        withinOpen: room ? (room.hours.length ? room.hours.some((h) => h.dayOfWeek === m.dayOfWeek && toMin(h.openTime) <= startMin && toMin(h.closeTime) >= endMin) : null) : null,
      });
    }
  }
  return out.sort((a, b) => a.iso.localeCompare(b.iso) || a.startMin - b.startMin);
}

/** Open room-hours of a set of rooms over a set of dates (coded hours; closures win). */
export function openRoomHours(rooms: UtilRoom[], dates: Iterable<string>): number {
  let n = 0;
  const list = [...dates];
  for (const r of rooms) { if (!r.hours.length) continue; for (const iso of list) n += openHoursOn(r.hours, r.closures, iso); }
  return n;
}
/** Every date in a window. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = []; const a = dateOf(from).getTime(), b = dateOf(to).getTime();
  for (let t = a; t <= b; t += DAY) out.push(isoOf(new Date(t)));
  return out;
}

export interface UtilRow {
  key: string; label: string; sub?: string;
  bookings: number; days: number; rooms: number; hours: number; seatHours: number;
  byKind: Record<string, number>;
  /** Open room-hours the group's rooms offer over the group's dates (null when the grouping has no room/time meaning). */
  openHours: number | null; utilization: number | null;
  /** Seat-hours ÷ (booked hours × room capacity) — how full booked rooms are. */
  fill: number | null;
  /** Bookings outside their room's coded hours. */
  outsideHours: number;
  roomIds: string[]; dates: string[];
}

/** The time-group key of a date (shared by atoms and by the open-hours denominator). */
function timeKey(g: UtilGroup, iso: string, semester: string): string {
  switch (g) {
    case "day": return iso;
    case "week": return mondayOf(iso);
    case "month": return iso.slice(0, 7);
    case "year": return iso.slice(0, 4);
    case "weekday": return String(DAY_ORDER[WEEKDAYS[dateOf(iso).getUTCDay()]] ?? 9);
    case "semester": { const [season, year] = semester.split(" "); const rank = season === "Spring" ? 1 : season === "Summer" ? 2 : 3; return `${year}-${rank}`; }
    default: return "";
  }
}
/** The row an atom belongs to under a grouping (cheap — use it to find a row's members). */
export function groupKey(g: UtilGroup, x: UtilAtom): { key: string; label: string; sub?: string } { return keyOf(g, x); }
function keyOf(g: UtilGroup, x: UtilAtom): { key: string; label: string; sub?: string } {
  switch (g) {
    case "day": return { key: x.iso, label: `${WEEKDAYS[dateOf(x.iso).getUTCDay()]} ${fmtMDY(x.iso)}` };
    case "week": return { key: x.monday, label: `Week of ${fmtMDY(x.monday)}` };
    case "month": return { key: x.month, label: `${MONTH[Number(x.month.slice(5, 7)) - 1]} ${x.month.slice(0, 4)}` };
    case "semester": return { key: timeKey("semester", x.iso, x.semester), label: x.semester };
    case "year": return { key: x.year, label: x.year };
    case "weekday": return { key: String(DAY_ORDER[x.weekday] ?? 9), label: x.weekday };
    case "hour": { const h = Math.floor(x.startMin / 60); return { key: String(h).padStart(2, "0"), label: `${h % 12 || 12}${h >= 12 ? "p" : "a"} starts` }; }
    case "program": return { key: x.programId, label: x.program };
    case "course": return { key: x.courseId, label: x.course, sub: x.program };
    case "cohort": return { key: x.cohortId, label: x.cohort, sub: x.program };
    case "kind": return { key: x.kind, label: x.kind === "CLASS" ? "Class" : x.kind === "LAB" ? "Lab" : "Clinical" };
    case "campus": return { key: x.campusId ?? (x.roomId ? "~nocampus" : "~offcampus"), label: x.campus ?? (x.roomId ? "(no campus)" : "Off campus — clinical sites") };
    case "building": return { key: x.buildingId ?? (x.roomId ? "~nobuilding" : "~offcampus"), label: x.building ?? (x.roomId ? "(no building)" : "Off campus — clinical sites"), sub: x.campus ?? undefined };
    case "room": return { key: x.roomId ?? "~unroomed", label: x.room ?? (x.kind === "CLINICAL" ? "Clinical sites (off campus)" : "Unroomed"), sub: x.building ?? undefined };
    case "site": return { key: x.siteId ?? (x.roomId ? "~campus" : "~tbd"), label: x.site ?? (x.roomId ? "On campus" : "Site TBD") };
  }
}
const ROOM_GROUPS: UtilGroup[] = ["room", "building", "campus"];
const TIME_GROUPS: UtilGroup[] = ["day", "week", "month", "semester", "year", "weekday"];

/** Roll the atoms up by a grouping. `rooms` is the room scope (after filters) — its open hours are the denominator. */
export function utilizationRollup(atoms: UtilAtom[], rooms: UtilRoom[], groupBy: UtilGroup, from: string, to: string, semesters: SemesterWindow[] = [], anchors?: SemesterAnchors): UtilRow[] {
  const acc = new Map<string, UtilRow & { _rooms: Set<string>; _dates: Set<string>; _capHours: number; _campusSeatHours: number }>();
  for (const x of atoms) {
    const k = keyOf(groupBy, x);
    const r = acc.get(k.key) ?? { key: k.key, label: k.label, sub: k.sub, bookings: 0, days: 0, rooms: 0, hours: 0, seatHours: 0, byKind: {}, openHours: null, utilization: null, fill: null, outsideHours: 0, roomIds: [], dates: [], _rooms: new Set<string>(), _dates: new Set<string>(), _capHours: 0, _campusSeatHours: 0 };
    r.bookings++; r.hours += x.hours; r.seatHours += x.hours * x.seats; r.byKind[x.kind] = (r.byKind[x.kind] ?? 0) + x.hours;
    // Fill compares seat-hours with room capacity — only bookings that sit in a room with a capacity.
    if (x.roomId) { r._rooms.add(x.roomId); if (x.capacity) { r._capHours += x.hours * x.capacity; r._campusSeatHours += x.hours * x.seats; } }
    r._dates.add(x.iso);
    if (x.withinOpen === false) r.outsideHours++;
    acc.set(k.key, r);
  }
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const windowDates = datesBetween(from, to);
  const rows = [...acc.values()].map(({ _rooms, _dates, _capHours, _campusSeatHours, ...r }) => {
    let openHours: number | null = null;
    if (ROOM_GROUPS.includes(groupBy)) {
      // The group's rooms over the whole window — even rooms that had no bookings in it.
      const groupRooms = groupBy === "room" ? [..._rooms].map((id) => roomById.get(id)!).filter(Boolean)
        : rooms.filter((rm) => (groupBy === "building" ? (rm.buildingId ?? "~nobuilding") : (rm.campusId ?? "~nocampus")) === r.key);
      openHours = groupRooms.length ? openRoomHours(groupRooms, windowDates) : null;
      if (groupBy !== "room") { _rooms.clear(); for (const rm of groupRooms) _rooms.add(rm.id); }
    } else if (TIME_GROUPS.includes(groupBy)) {
      // Every room in scope over the group's dates.
      const dates = windowDates.filter((d) => timeKey(groupBy, d, semesterOf(d, semesters, anchors)) === r.key);
      openHours = rooms.length ? openRoomHours(rooms, dates) : null;
    }
    const campusHours = Object.entries(r.byKind).filter(([k]) => k !== "CLINICAL").reduce((n, [, v]) => n + v, 0);
    return {
      ...r, rooms: _rooms.size, days: _dates.size, roomIds: [..._rooms], dates: [..._dates].sort(),
      openHours, utilization: openHours && openHours > 0 ? Math.min(9.99, campusHours / openHours) : null,
      fill: _capHours > 0 ? _campusSeatHours / _capHours : null,
    };
  });
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

/** Grand totals for the window: booked vs open room-hours across the room scope. */
export function utilizationTotals(atoms: UtilAtom[], rooms: UtilRoom[], from: string, to: string) {
  const dates = datesBetween(from, to);
  const open = openRoomHours(rooms, dates);
  const campus = atoms.filter((a) => a.roomId);
  const hours = atoms.reduce((n, a) => n + a.hours, 0);
  const campusHours = campus.reduce((n, a) => n + a.hours, 0);
  const seatHours = atoms.reduce((n, a) => n + a.hours * a.seats, 0);
  const capHours = campus.reduce((n, a) => n + (a.capacity ? a.hours * a.capacity : 0), 0);
  const campusSeatHours = campus.reduce((n, a) => n + (a.capacity ? a.hours * a.seats : 0), 0);
  const byDay = new Map<string, number>();
  for (const a of atoms) byDay.set(a.iso, (byDay.get(a.iso) ?? 0) + a.hours);
  const busiest = [...byDay.entries()].sort((x, y) => y[1] - x[1])[0] ?? null;
  const byKind: Record<string, number> = {};
  for (const a of atoms) byKind[a.kind] = (byKind[a.kind] ?? 0) + a.hours;
  return {
    bookings: atoms.length, hours, campusHours, clinicalHours: hours - campusHours, seatHours, byKind,
    openHours: open, utilization: open > 0 ? campusHours / open : null,
    fill: capHours > 0 ? campusSeatHours / capHours : null,
    roomsUsed: new Set(campus.map((a) => a.roomId)).size, roomsInScope: rooms.length, roomsWithHours: rooms.filter((r) => r.hours.length).length,
    days: dates.length, daysWithBookings: byDay.size,
    busiestDay: busiest ? { iso: busiest[0], hours: busiest[1] } : null,
    outsideHours: atoms.filter((a) => a.withinOpen === false).length,
  };
}

/** Weekday × hour-of-day heat: room-hours booked in each hour slot (a booking 9:00–11:30 lights 9, 10 and half of 11). */
export function hourHeat(atoms: UtilAtom[], startHour = 6, endHour = 22) {
  const grid: Record<string, number[]> = {};
  for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) grid[d] = Array.from({ length: endHour - startHour }, () => 0);
  for (const a of atoms) {
    const row = grid[a.weekday]; if (!row) continue;
    for (let h = startHour; h < endHour; h++) {
      const s = h * 60, e = s + 60;
      const ov = Math.max(0, Math.min(e, a.endMin) - Math.max(s, a.startMin));
      if (ov > 0) row[h - startHour] += ov / 60;
    }
  }
  return { grid, hours: Array.from({ length: endHour - startHour }, (_, i) => startHour + i) };
}

/** The natural drill-down from one grouping to the next. */
export const DRILL_INTO: Record<UtilGroup, UtilGroup> = {
  room: "day", building: "room", campus: "building", site: "day",
  program: "course", course: "room", cohort: "course", kind: "room",
  day: "room", week: "day", month: "week", semester: "month", year: "semester", weekday: "room", hour: "room",
};
