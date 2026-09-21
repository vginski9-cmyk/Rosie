// The master calendar's data: every session of every offering at a college, dated by the one
// engine everything else uses (buildInstances: the term dates, the break rule, the holiday rule),
// joined to its sections (room or site, staff), the students on it, per-occurrence moves and the
// scheduler's bookings — for the date range the chosen view covers, narrowed to one student,
// instructor, preceptor, site, room, offering, program or course when the page asks.

import { prisma } from "./db";
import { buildInstances, resolveSessionDay, type CohortCalendarInput, type DatedInstance } from "./capacitymodel";
import { holidayMap } from "./academiccalendar";
import { isHolidayRule, DEFAULT_HOLIDAY_RULE, type HolidayRule } from "./holidayrule";
import { closedWeek, mondayOfDate, type SemesterAnchors } from "./term";
import { OPERATIONAL } from "./mode";
import {
  rangeFor, narrowEvents, aggregateDays, totalsOf, parseEntityKey, addDaysIso, dowShort, mondayIso, EVENT_VIEWS,
  type CalView, type CalEvent, type CalSection, type CalEntity, type CalRange, type CalDayAgg, type CalTotals, type EventKind, type EntityKind,
} from "./calendarview";
import { detectDatedConflicts, conflictGroups, seatStartsByGroup, toMin, toHHMM, type DatedBooking, type Weekday } from "./space";

const isOnline = (deliveryMode: string | null | undefined, location: string | null | undefined) => /online|internet/i.test(deliveryMode ?? "") || /^internet$/i.test(location ?? "");
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

export interface CalendarParams { institutionId?: string | null; view: CalView; dateIso: string; who?: string | null; kind?: EventKind | null; programId?: string | null }

export interface CalConflictGroup { kind: string; dateIso: string; detail: string; eventIds: string[]; /** Section-level overlap groups folded into this line (two courses of one offering at once = one line, however many sections). */ pairs: number }
export interface CalTermBar { cohortId: string; cohortName: string; programId: string; programName: string; termName: string; startIso: string; endIso: string }

export interface CalendarData {
  institutions: { id: string; name: string }[];
  institutionId: string | null; institutionName: string | null;
  anchors: SemesterAnchors;
  range: CalRange;
  /** Every event in the range (day, week and month views); the coarser views ship roll-ups only. */
  events: CalEvent[];
  days: Record<string, CalDayAgg>;
  totals: CalTotals;
  holidays: { date: string; label: string }[];
  closedWeeks: { mondayIso: string; label: string }[];
  semesterMarks: { iso: string; label: string; kind: string }[];
  terms: CalTermBar[];
  entities: CalEntity[];
  who: CalEntity | null;
  programs: { id: string; name: string }[];
  conflicts: CalConflictGroup[];
  canEdit: boolean;
  rooms: { id: string; name: string; kind: string; capacity: number | null }[];
  people: { id: string; name: string; role: string; employerId: string | null }[];
  employers: { id: string; name: string; setting: string | null }[];
  today: string;
}

async function inChunks<T, R>(ids: T[], size: number, fn: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
  return out;
}

export async function getCalendarView(p: CalendarParams): Promise<CalendarData> {
  const today = isoOf(new Date());
  const institutions = await prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  let institutionId = p.institutionId && institutions.some((i) => i.id === p.institutionId) ? p.institutionId : null;
  if (!institutionId) {
    // The college with the most scheduled offerings, so the calendar opens on real data.
    const grouped = await prisma.meetingPattern.groupBy({ by: ["cohortId"], _count: true });
    if (grouped.length) {
      const rows = await prisma.cohort.findMany({ where: { id: { in: grouped.map((g) => g.cohortId) } }, select: { id: true, program: { select: { institutionId: true } } } });
      const instOf = new Map(rows.map((c) => [c.id, c.program.institutionId]));
      const counts = new Map<string, number>();
      for (const g of grouped) { const i = instOf.get(g.cohortId); if (i) counts.set(i, (counts.get(i) ?? 0) + g._count); }
      institutionId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }
    institutionId = institutionId ?? institutions[0]?.id ?? null;
  }
  const empty = (range: CalRange): CalendarData => ({ institutions, institutionId, institutionName: institutions.find((i) => i.id === institutionId)?.name ?? null, anchors: { springStart: "01-08", summerStart: "05-28", fallStart: "08-15" }, range, events: [], days: {}, totals: totalsOf([]), holidays: [], closedWeeks: [], semesterMarks: [], terms: [], entities: [], who: null, programs: [], conflicts: [], canEdit: OPERATIONAL, rooms: [], people: [], employers: [], today });
  if (!institutionId) return empty(rangeFor(p.view, p.dateIso));

  const inst = await prisma.institution.findUnique({ where: { id: institutionId }, select: { id: true, name: true, springStart: true, summerStart: true, fallStart: true, holidayRule: true, academicEvents: { orderBy: { date: "asc" }, select: { date: true, endDate: true, label: true, kind: true, season: true } } } });
  if (!inst) return empty(rangeFor(p.view, p.dateIso));
  const anchors: SemesterAnchors = { springStart: inst.springStart, summerStart: inst.summerStart, fallStart: inst.fallStart };
  const range = rangeFor(p.view, p.dateIso, anchors);
  const events = inst.academicEvents.map((e) => ({ iso: isoOf(e.date), endIso: e.endDate ? isoOf(e.endDate) : null, label: e.label, kind: e.kind, season: e.season }));
  const holidays = holidayMap(events);
  const holidayRule: HolidayRule = isHolidayRule(inst.holidayRule) ? inst.holidayRule : DEFAULT_HOLIDAY_RULE;

  // ── Every offering of the college, its template and its calendar ──────────────────────────────
  const programs = await prisma.program.findMany({
    where: { institutionId, cohorts: { some: { status: { not: "archived" } } } },
    select: {
      id: true, name: true,
      terms: { orderBy: { index: "asc" }, select: { id: true, index: true, name: true, startWeek: true, endWeek: true, courses: { orderBy: { sequenceOrder: "asc" }, select: { id: true, code: true, name: true, sessions: { orderBy: [{ week: "asc" }, { number: "asc" }], select: { id: true, kind: true, number: true, title: true, deliveryMode: true, location: true, lengthHours: true, maxStudents: true, facultyNeeded: true, facultyContactPolicy: true, supportStaffNeeded: true, supportContactPolicy: true, week: true, dayOfWeek: true, startTime: true, notes: true, preceptorsNeeded: true, preceptorContactPolicy: true, rotationType: true, clinicalMode: true } } } } } },
      cohorts: { where: { status: { not: "archived" } }, orderBy: { name: "asc" }, select: {
        id: true, name: true, status: true, plannedSeats: true, campus: { select: { name: true } }, locationNote: true, _count: { select: { students: true } },
        cohortTerms: { select: { termId: true, startDate: true, endDate: true } },
        courseDates: { select: { courseId: true, startDate: true, endDate: true } },
        sessionOverrides: true,
        meetings: { orderBy: { sectionIndex: "asc" }, select: { id: true, courseId: true, kind: true, sectionIndex: true, sectionCount: true, seats: true, dayOfWeek: true, startTime: true, lengthHours: true, facilityId: true, employerId: true, staffPersonId: true, facility: { select: { name: true } }, employer: { select: { name: true } }, staff: { select: { id: true, name: true, role: true } } } },
      } },
    },
  });

  type Pattern = (typeof programs)[number]["cohorts"][number]["meetings"][number];
  const instances: { inst: DatedInstance; cohort: { id: string; name: string; status: string; programId: string; programName: string }; patterns: Map<string, Pattern[]>; enrollment: number }[] = [];
  const termBars: CalTermBar[] = [];
  for (const prog of programs) {
    const orderedTerms = prog.terms;
    for (const co of prog.cohorts) {
      const ctById = new Map(co.cohortTerms.map((ct) => [ct.termId, ct]));
      // Only an offering that touches the range (with a week either side for moves) is dated.
      const touches = orderedTerms.some((t) => { const ct = ctById.get(t.id); return ct?.startDate && ct?.endDate && isoOf(ct.startDate) <= addDaysIso(range.toIso, 14) && isoOf(ct.endDate) >= addDaysIso(range.fromIso, -14); });
      if (!touches) continue;
      for (const t of orderedTerms) { const ct = ctById.get(t.id); if (ct?.startDate && ct?.endDate && isoOf(ct.startDate) <= range.toIso && isoOf(ct.endDate) >= range.fromIso) termBars.push({ cohortId: co.id, cohortName: co.name, programId: prog.id, programName: prog.name, termName: t.name, startIso: isoOf(ct.startDate), endIso: isoOf(ct.endDate) }); }
      const enrollment = Math.max(1, Math.round(co._count.students || co.plannedSeats || 0));
      const enrollmentByTerm: Record<number, number> = {}; const termStartByIndex: Record<number, Date | null> = {}; const termEndByIndex: Record<number, Date | null> = {}; const termWeeksByIndex: Record<number, number | null> = {};
      for (const t of orderedTerms) { const ct = ctById.get(t.id); enrollmentByTerm[t.index] = enrollment; termStartByIndex[t.index] = ct?.startDate ?? null; termEndByIndex[t.index] = ct?.endDate ?? null; termWeeksByIndex[t.index] = t.startWeek != null && t.endWeek != null && t.endWeek >= t.startWeek ? t.endWeek - t.startWeek + 1 : null; }
      const patterns = new Map<string, Pattern[]>();
      for (const m of co.meetings) { const k = `${m.courseId}|${m.kind}`; patterns.set(k, [...(patterns.get(k) ?? []), m]); }
      const ov = new Map(co.sessionOverrides.map((o) => [o.sessionId, o]));
      const cd = new Map(co.courseDates.map((x) => [x.courseId, x]));
      const input: CohortCalendarInput = {
        cohortId: co.id, cohort: co.name, programId: prog.id, program: prog.name, enrollmentByTerm, termStartByIndex, termEndByIndex, termWeeksByIndex, holidays, holidayRule,
        courses: orderedTerms.flatMap((t) => t.courses.map((c) => ({
          code: c.code, title: c.name, courseId: c.id, termIndex: t.index, termName: t.name,
          startDate: cd.get(c.id)?.startDate ?? null, endDate: cd.get(c.id)?.endDate ?? null,
          sessions: c.sessions.map((s) => {
            const o = ov.get(s.id);
            const online = isOnline(o?.deliveryMode ?? s.deliveryMode, o?.location ?? s.location);
            const bk = patterns.get(`${c.id}|${s.kind}`) ?? [];
            return {
              id: s.id, kind: s.kind as EventKind, number: s.number, title: o?.title ?? s.title, deliveryMode: o?.deliveryMode ?? s.deliveryMode, location: o?.location ?? s.location,
              lengthHours: o?.lengthHours ?? s.lengthHours, maxStudents: o?.maxStudents ?? s.maxStudents, facultyNeeded: o?.facultyNeeded ?? s.facultyNeeded, facultyContactPolicy: o?.facultyContactPolicy ?? s.facultyContactPolicy,
              supportStaffNeeded: o?.supportStaffNeeded ?? s.supportStaffNeeded, supportContactPolicy: o?.supportContactPolicy ?? s.supportContactPolicy,
              week: o?.week ?? s.week,
              dayOfWeek: o?.dayOfWeek ?? resolveSessionDay(s.dayOfWeek, online, bk, c.sessions.filter((x) => x.kind === s.kind).map((x) => x.dayOfWeek).filter((d): d is string => !!d)),
              startTime: o?.startTime ?? s.startTime ?? (online ? null : bk.find((b) => b.dayOfWeek === (o?.dayOfWeek ?? s.dayOfWeek))?.startTime ?? bk[0]?.startTime ?? null),
              notes: o?.notes ?? s.notes, preceptorsNeeded: o?.preceptorsNeeded ?? s.preceptorsNeeded, preceptorContactPolicy: o?.preceptorContactPolicy ?? s.preceptorContactPolicy,
              rotationType: o?.rotationType ?? s.rotationType, clinicalMode: o?.clinicalMode ?? s.clinicalMode,
            };
          }),
        }))),
      };
      const cohort = { id: co.id, name: co.name, status: co.status, programId: prog.id, programName: prog.name };
      for (const inst of buildInstances(input)) {
        if (!inst.dateIso || inst.beyondTerm) continue;
        // Keep a fortnight either side so a move into the range is found.
        if (inst.dateIso < addDaysIso(range.fromIso, -14) || inst.dateIso > addDaysIso(range.toIso, 14)) continue;
        instances.push({ inst, cohort, patterns, enrollment });
      }
    }
  }

  // ── The joins for these sessions: staff, students, moves, bookings ────────────────────────────
  const cohortIds = [...new Set(instances.map((x) => x.cohort.id))];
  const sessionIds = [...new Set(instances.map((x) => x.inst.session.id))];
  const win = { gte: new Date(addDaysIso(range.fromIso, -14) + "T00:00:00Z"), lte: new Date(addDaysIso(range.toIso, 14) + "T00:00:00Z") };
  const [staffRows, shiftRows, sectionRows, moveRows, bookingRows] = cohortIds.length ? await Promise.all([
    inChunks(sessionIds, 400, (ids) => prisma.sessionInstructor.findMany({ where: { cohortId: { in: cohortIds }, sessionId: { in: ids } }, select: { cohortId: true, sessionId: true, sectionIndex: true, role: true, person: { select: { id: true, name: true, employerId: true } } } })),
    inChunks(sessionIds, 400, (ids) => prisma.studentShift.findMany({ where: { cohortId: { in: cohortIds }, sessionId: { in: ids } }, select: { cohortId: true, sessionId: true, sectionIndex: true, status: true, student: { select: { id: true, name: true } }, preceptor: { select: { id: true, name: true, employerId: true } } } })),
    prisma.studentSection.findMany({ where: { cohortId: { in: cohortIds } }, select: { cohortId: true, courseId: true, kind: true, sectionIndex: true, student: { select: { id: true, name: true, status: true } } } }),
    prisma.shiftMove.findMany({ where: { cohortId: { in: cohortIds }, OR: [{ fromDate: win }, { toDate: win }] }, select: { cohortId: true, sessionId: true, sectionIndex: true, fromDate: true, toDate: true, startTime: true, facilityId: true, employerId: true, staffPersonId: true, facility: { select: { name: true } }, employer: { select: { name: true } }, staff: { select: { id: true, name: true, role: true } } } }),
    prisma.assetBooking.findMany({ where: { cohortId: { in: cohortIds }, sessionId: { not: null }, date: win }, select: { cohortId: true, sessionId: true, sectionIndex: true, date: true, asset: { select: { employer: { select: { id: true, name: true } } } } } }),
  ]) : [[], [], [], [], []];
  const staffBy = new Map<string, { id: string; name: string; role: string }[]>();
  for (const r of staffRows) { const k = `${r.cohortId}|${r.sessionId}|${r.sectionIndex}`; const l = staffBy.get(k) ?? []; if (!l.some((x) => x.id === r.person.id)) l.push({ id: r.person.id, name: r.person.name, role: r.role }); staffBy.set(k, l); }
  const shiftsBy = new Map<string, { id: string; name: string; status: string | null; preceptor: { id: string; name: string } | null }[]>();
  for (const r of shiftRows) { const k = `${r.cohortId}|${r.sessionId}|${r.sectionIndex}`; const l = shiftsBy.get(k) ?? []; l.push({ id: r.student.id, name: r.student.name, status: r.status, preceptor: r.preceptor ? { id: r.preceptor.id, name: r.preceptor.name } : null }); shiftsBy.set(k, l); }
  const rosterBy = new Map<string, { id: string; name: string; status: string | null }[]>();
  for (const r of sectionRows) { const k = `${r.cohortId}|${r.courseId}|${r.kind}|${r.sectionIndex}`; const l = rosterBy.get(k) ?? []; l.push({ id: r.student.id, name: r.student.name, status: r.student.status }); rosterBy.set(k, l); }
  const moveBy = new Map(moveRows.map((m) => [`${m.cohortId}|${m.sessionId}|${m.sectionIndex}|${isoOf(m.fromDate)}`, m]));
  const bookingBy = new Map<string, (typeof bookingRows)[number]>();
  for (const b of bookingRows) bookingBy.set(`${b.cohortId}|${b.sessionId}|${b.sectionIndex}|${isoOf(b.date)}`, b);

  // ── Events: one per session per date, with its sections ──────────────────────────────────────
  const all = new Map<string, CalEvent>();
  const eventOf = (x: (typeof instances)[number], date: string): CalEvent => {
    const s = x.inst.session;
    const start = s.startTime ?? null;
    const hours = s.lengthHours ?? 0;
    return {
      id: `${x.cohort.id}|${s.id}|${date}`, date, dayOfWeek: dowShort(date),
      startTime: start, endTime: start ? toHHMM(Math.round(toMin(start) + hours * 60)) : null, hours,
      kind: s.kind, online: isOnline(s.deliveryMode, s.location), title: s.title,
      courseId: x.inst.courseId ?? "", courseCode: x.inst.courseCode, courseName: x.inst.courseTitle,
      cohortId: x.cohort.id, cohortName: x.cohort.name, cohortStatus: x.cohort.status, programId: x.cohort.programId, programName: x.cohort.programName,
      termName: x.inst.termName, weekOfTerm: x.inst.weekOfTerm,
      holidayMoved: x.inst.holidayMoved ?? null, holiday: x.inst.holiday ?? null,
      sections: [], students: 0,
    };
  };
  for (const x of instances) {
    const s = x.inst.session; const date = x.inst.dateIso!;
    const pats = x.patterns.get(`${x.inst.courseId}|${s.kind}`) ?? [];
    const onDay = pats.filter((m) => m.dayOfWeek === s.dayOfWeek);
    const chosen = (onDay.length ? onDay : pats).filter((m, i, arr) => arr.findIndex((y) => y.sectionIndex === m.sectionIndex) === i);
    const count = Math.max(1, ...chosen.map((m) => m.sectionCount));
    const secs: { index: number; pat: Pattern | null }[] = chosen.length ? chosen.map((m) => ({ index: m.sectionIndex, pat: m })) : [{ index: 1, pat: null }];
    for (const { index, pat } of secs) {
      const key = `${x.cohort.id}|${s.id}|${index}`;
      const shifts = shiftsBy.get(key) ?? [];
      const roster = s.kind === "CLINICAL" ? shifts.map((st) => ({ id: st.id, name: st.name, status: st.status })) : rosterBy.get(`${x.cohort.id}|${x.inst.courseId}|${s.kind}|${index}`) ?? [];
      // A hand-made move is filed under the pattern date; when the rule already moved the session, either date finds it.
      const mv = moveBy.get(`${key}|${date}`) ?? (x.inst.holidayMoved ? moveBy.get(`${key}|${x.inst.holidayMoved.fromIso}`) : undefined);
      const heldDate = mv ? isoOf(mv.toDate) : date;
      if (heldDate < range.fromIso || heldDate > range.toIso) continue;
      const booking = bookingBy.get(`${key}|${heldDate}`) ?? null;
      const staff = [...(staffBy.get(key) ?? [])];
      for (const st of shifts) if (st.preceptor && !staff.some((p) => p.id === st.preceptor!.id)) staff.push({ id: st.preceptor.id, name: st.preceptor.name, role: "preceptor" });
      if (mv?.staff && !staff.some((p) => p.id === mv.staff!.id)) staff.push({ id: mv.staff.id, name: mv.staff.name, role: mv.staff.role });
      if (!staff.length && pat?.staff) staff.push({ id: pat.staff.id, name: pat.staff.name, role: pat.staff.role });
      const siteId = s.kind === "CLINICAL" ? booking?.asset.employer.id ?? mv?.employerId ?? pat?.employerId ?? null : null;
      const site = s.kind === "CLINICAL" ? booking?.asset.employer.name ?? mv?.employer?.name ?? pat?.employer?.name ?? null : null;
      const roomId = s.kind === "CLINICAL" ? null : mv?.facilityId ?? pat?.facilityId ?? null;
      const room = s.kind === "CLINICAL" ? null : mv?.facility?.name ?? pat?.facility?.name ?? null;
      const section: CalSection = { index, count, seats: pat?.seats ?? (roster.length || x.enrollment), patternId: pat?.id ?? null, roomId, room, siteId, site, booked: !!booking, staff, students: roster, moved: mv ? { fromIso: isoOf(mv.fromDate), startTime: mv.startTime ?? null } : null };
      const id = `${x.cohort.id}|${s.id}|${heldDate}`;
      const ev = all.get(id) ?? eventOf(x, heldDate);
      if (mv?.startTime && ev.sections.length === 0) { ev.startTime = mv.startTime; ev.endTime = toHHMM(Math.round(toMin(mv.startTime) + ev.hours * 60)); }
      ev.sections.push(section); ev.students += roster.length;
      all.set(id, ev);
    }
  }
  const everything = [...all.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "99").localeCompare(b.startTime ?? "99") || (a.courseCode ?? a.courseName).localeCompare(b.courseCode ?? b.courseName));

  // ── The searchable things, and the one asked for ─────────────────────────────────────────────
  const programIds = programs.map((p) => p.id);
  const [students, people, employers, rooms] = await Promise.all([
    prisma.student.findMany({ where: { programId: { in: programIds } }, orderBy: { name: "asc" }, select: { id: true, name: true, status: true, cohort: { select: { name: true } }, program: { select: { name: true } } } }),
    prisma.person.findMany({ where: { institutionId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, employerId: true, employer: { select: { name: true } } } }),
    prisma.employer.findMany({ where: { institutionId, status: { not: "archived" } }, orderBy: { name: "asc" }, select: { id: true, name: true, setting: true, city: true } }),
    prisma.facility.findMany({ where: { institutionId, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, capacity: true, building: true } }),
  ]);
  const entities: CalEntity[] = [
    ...students.map((s) => ({ kind: "student" as EntityKind, id: s.id, name: s.name, sub: [s.program.name, s.cohort?.name, s.status].filter(Boolean).join(" · ") })),
    ...people.map((x) => ({ kind: "person" as EntityKind, id: x.id, name: x.name, sub: [x.role, x.employer?.name].filter(Boolean).join(" · ") })),
    ...employers.map((e) => ({ kind: "site" as EntityKind, id: e.id, name: e.name, sub: [e.setting, e.city].filter(Boolean).join(" · ") })),
    ...rooms.map((r) => ({ kind: "room" as EntityKind, id: r.id, name: r.name, sub: [r.kind.toLowerCase(), r.building].filter(Boolean).join(" · ") })),
    ...programs.flatMap((p) => p.cohorts.map((c) => ({ kind: "cohort" as EntityKind, id: c.id, name: c.name, sub: [p.name, c.campus?.name, c.status].filter(Boolean).join(" · ") }))),
    ...programs.map((p) => ({ kind: "program" as EntityKind, id: p.id, name: p.name, sub: "program" })),
    ...programs.flatMap((p) => p.terms.flatMap((t) => t.courses.map((c) => ({ kind: "course" as EntityKind, id: c.id, name: c.code ? `${c.code} · ${c.name}` : c.name, sub: `${p.name} · ${t.name}` })))),
  ];
  const whoKey = parseEntityKey(p.who);
  const who = whoKey ? entities.find((e) => e.kind === whoKey.kind && e.id === whoKey.id) ?? null : null;

  const narrowed = narrowEvents(everything, who ? { kind: who.kind, id: who.id } : null, p.kind ?? null, p.programId ?? null);
  const days = aggregateDays(narrowed);
  const totals = totalsOf(narrowed);

  // ── Conflicts, on the dates things happen (day, week and month views) ─────────────────────────
  let conflicts: CalConflictGroup[] = [];
  if (EVENT_VIEWS.includes(p.view)) {
    const rows = narrowed.flatMap((e) => e.sections.map((s) => ({ id: `${e.id}#${s.index}`, eventId: e.id, cohortId: e.cohortId, courseId: e.courseId, kind: e.kind, sectionIndex: s.index, seats: s.seats, lengthHours: e.hours, dayOfWeek: e.dayOfWeek as Weekday, startMin: e.startTime ? toMin(e.startTime) : -1, dateIso: e.date, facilityId: s.roomId, staffPersonId: s.staff[0]?.id ?? null })));
    const seatStarts = seatStartsByGroup(rows, (r) => `${r.cohortId}|${r.courseId}|${r.kind}|${r.dateIso}`);
    const dated: DatedBooking[] = rows.filter((r) => r.startMin >= 0).map((r) => ({ id: r.id, cohortId: r.cohortId, sectionIndex: r.sectionIndex, kind: r.kind, seats: r.seats, seatStart: seatStarts.get(r.id), lengthHours: r.lengthHours, dayOfWeek: r.dayOfWeek, startMin: r.startMin, dateIso: r.dateIso, facilityId: r.facilityId, staffPersonId: r.staffPersonId }));
    const eventOfRow = new Map(rows.map((r) => [r.id, r.eventId]));
    // One line per clash of events (a room, a person, or one offering's students in two places), however many sections it touches.
    const folded = new Map<string, CalConflictGroup>();
    for (const g of conflictGroups(detectDatedConflicts(dated))) {
      const eventIds = [...new Set(g.ids.map((id) => eventOfRow.get(id)!).filter(Boolean))].sort();
      if (eventIds.length < 2) continue;
      const k = `${g.kind}|${g.dateIso}|${eventIds.join(",")}`;
      const cur = folded.get(k);
      if (cur) cur.pairs++; else folded.set(k, { kind: g.kind, dateIso: g.dateIso, detail: g.detail, eventIds, pairs: 1 });
    }
    conflicts = [...folded.values()].sort((a, b) => a.dateIso.localeCompare(b.dateIso) || a.kind.localeCompare(b.kind));
  }

  // ── The calendar's own marks in the range ────────────────────────────────────────────────────
  const holidayList = Object.entries(holidays).filter(([d]) => d >= range.fromIso && d <= range.toIso).map(([date, label]) => ({ date, label })).sort((a, b) => a.date.localeCompare(b.date));
  const closedWeeks: { mondayIso: string; label: string }[] = [];
  for (let m = mondayIso(range.fromIso); m <= range.toIso; m = addDaysIso(m, 7)) { const l = closedWeek(mondayOfDate(new Date(m + "T00:00:00Z")), holidays); if (l) closedWeeks.push({ mondayIso: m, label: l }); }
  const semesterMarks = events.filter((e) => (e.kind === "term_start" || e.kind === "term_end" || e.kind === "session_start") && e.iso >= range.fromIso && e.iso <= range.toIso).map((e) => ({ iso: e.iso, label: e.label, kind: e.kind }));

  return {
    institutions, institutionId, institutionName: inst.name, anchors, range,
    events: EVENT_VIEWS.includes(p.view) ? narrowed : [],
    days, totals, holidays: holidayList, closedWeeks, semesterMarks,
    terms: termBars.sort((a, b) => a.startIso.localeCompare(b.startIso) || a.cohortName.localeCompare(b.cohortName)),
    entities, who, programs: programs.map((x) => ({ id: x.id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name)),
    conflicts, canEdit: OPERATIONAL,
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, kind: r.kind, capacity: r.capacity })),
    people: people.filter((x) => ["instructor", "preceptor", "coordinator"].includes(x.role)).map((x) => ({ id: x.id, name: x.name, role: x.role, employerId: x.employerId })),
    employers: employers.map((e) => ({ id: e.id, name: e.name, setting: e.setting })),
    today,
  };
}
