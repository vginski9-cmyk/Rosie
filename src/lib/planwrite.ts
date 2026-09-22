// WRITING A PLAN TO THE CALENDAR — the one path every placement takes. The scheduler's apply
// action, the seed (which places the demo roster with the scheduler itself) and undo all go
// through here, so the roster the site-load page reads is exactly what the scheduler placed.
// Pure Prisma: nothing here touches a request, so it runs inside a seed as well as a server action.

import { prisma } from "./db";
import { AUTO_PLAN_NOTE } from "./scheduler";
export { AUTO_PLAN_NOTE };

export interface PlanAssignmentInput {
  assetId: string; employerId: string; cohortId: string; sessionId: string; sectionIndex: number; courseId: string | null;
  date: string; block: string; seats: number; seatsPerSection: number; preceptorIds: string[]; instructorId: string | null;
  /** Seats per asset when the section spreads across several rooms at the site (defaults to the lead asset with all seats). */
  parts?: { assetId: string; seats: number }[];
  /** When a section is split across sites, this piece covers section seats (seatOffset, seatOffset + seats]. */
  seatOffset?: number;
  /** The section's seat span under the even-dealing rule (lib/sections); absent on inputs from before it existed. */
  seatStart?: number; sectionSeats?: number;
  /** Where the shift moved from and what changed — the calendar shows it where it actually lands. */
  originalDate?: string; movedDays?: number; changedBlock?: boolean; startTime?: string | null; hours?: number;
}
/** A student shift that existed before the plan (seeded or hand-made, not pinned to a site) and that the plan pinned; cleared back to unpinned. */
export const PLAN_PIN_NOTE = "auto-plan:pinned";
export interface AppliedPlan { bookings: number; placements: number; meetings: number; moves: number; staffed: number; shifts: number; offSite: number }
export const chunks = <T,>(xs: T[], n = 400): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

/** Write a recommended plan to the database so every calendar shows it:
 *  - learner bookings on assets (one per placed section × room);
 *  - each clinical section's meeting pattern pointed at its main site and lead preceptor;
 *  - a per-occurrence move for every shift the plan put on another day, another shift
 *    block or another site than its weekly pattern says;
 *  - the preceptors and instructor on every shift (the staffing table the calendar and loads read);
 *  - every student's shift pinned to the booked asset and preceptor;
 *  - a planned placement per student per site.
 *  Earlier auto-plan rows for the same offerings are replaced; anything made by hand is left alone. */
export async function writeSchedulerPlan(allAssignments: PlanAssignmentInput[], opts: { /** ISO date; shifts before it are history and are never re-planned (default: today). The seed passes the window start to write a whole roster. */ cutoff?: string } = {}): Promise<AppliedPlan> {
  const todayIsoPw = new Date().toISOString().slice(0, 10);
  const cutoff = opts.cutoff ?? new Date().toISOString().slice(0, 10);
  const cutoffDate = new Date(cutoff + "T00:00:00Z");
  // THE PAST IS HISTORY: what already happened keeps its bookings, moves, staff and pins; only shifts from the cutoff on are replaced.
  const assignments = allAssignments.filter((a) => a.date >= cutoff);
  const cohortIds = [...new Set(allAssignments.map((a) => a.cohortId))];
  if (cohortIds.length === 0) return { bookings: 0, placements: 0, meetings: 0, moves: 0, staffed: 0, shifts: 0, offSite: 0 };
  await prisma.assetBooking.deleteMany({ where: { cohortId: { in: cohortIds }, note: AUTO_PLAN_NOTE, date: { gte: cutoffDate } } });
  await prisma.wblPlacement.deleteMany({ where: { cohortId: { in: cohortIds }, notes: AUTO_PLAN_NOTE, endDate: { gte: cutoffDate } } });
  await prisma.shiftMove.deleteMany({ where: { cohortId: { in: cohortIds }, note: AUTO_PLAN_NOTE, toDate: { gte: cutoffDate } } });
  // Staff rows carry no date: the earlier plan's rows for the sections being re-planned go; history's stay.
  const futureKeys = new Set(assignments.map((a) => `${a.cohortId}|${a.sessionId}|${a.sectionIndex}`));
  const oldStaff = await prisma.sessionInstructor.findMany({ where: { cohortId: { in: cohortIds }, note: AUTO_PLAN_NOTE }, select: { id: true, cohortId: true, sessionId: true, sectionIndex: true } });
  for (const ids of chunks(oldStaff.filter((r) => futureKeys.has(`${r.cohortId}|${r.sessionId}|${r.sectionIndex}`)).map((r) => r.id))) await prisma.sessionInstructor.deleteMany({ where: { id: { in: ids } } });
  // Sessions whose shifts are all history keep their student pins untouched below.
  const pastSessions = new Set(allAssignments.filter((a) => a.date < cutoff).map((a) => `${a.cohortId}|${a.sessionId}`));
  await prisma.assetBooking.createMany({
    data: assignments.flatMap((a) => (a.parts?.length ? a.parts : [{ assetId: a.assetId, seats: a.seats }]).map((pt) => ({ assetId: pt.assetId, cohortId: a.cohortId, sessionId: a.sessionId, sectionIndex: a.sectionIndex, date: new Date(a.date + "T00:00:00Z"), block: a.block, students: Math.max(1, Math.round(pt.seats)), note: AUTO_PLAN_NOTE }))),
  });

  // Each (cohort, course, section)'s MAIN site + lead preceptor → the meeting pattern the calendar reads.
  const bySection = new Map<string, { employer: Map<string, number>; preceptor: Map<string, number>; instructor: Map<string, number> }>();
  for (const a of assignments) {
    if (!a.courseId) continue;
    const k = `${a.cohortId}|${a.courseId}|${a.sectionIndex}`;
    const s = bySection.get(k) ?? { employer: new Map(), preceptor: new Map(), instructor: new Map() };
    s.employer.set(a.employerId, (s.employer.get(a.employerId) ?? 0) + 1);
    for (const p of a.preceptorIds) s.preceptor.set(p, (s.preceptor.get(p) ?? 0) + 1);
    if (a.instructorId) s.instructor.set(a.instructorId, (s.instructor.get(a.instructorId) ?? 0) + 1);
    bySection.set(k, s);
  }
  let meetings = 0;
  const top = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  const mainSite = new Map<string, string | null>();
  for (const [k, s] of bySection) {
    const [cohortId, courseId, sec] = k.split("|");
    mainSite.set(k, top(s.employer));
    // The pattern's lead staff is the section's usual preceptor, else its instructor (an instructor-led site has no preceptor); never a null overwrite of someone set by hand.
    const lead = top(s.preceptor) ?? top(s.instructor);
    const r = await prisma.meetingPattern.updateMany({ where: { cohortId, courseId, kind: "CLINICAL", sectionIndex: Number(sec) }, data: { employerId: top(s.employer), ...(lead ? { staffPersonId: lead } : {}) } });
    meetings += r.count;
  }

  // Per-occurrence moves: a shift the plan put on another day, another shift block or another
  // site than its weekly pattern says gets a move on the calendar, keyed by the date the pattern
  // had it on. A move someone made by hand on that same shift is respected, not overwritten.
  const handMoves = new Set((await prisma.shiftMove.findMany({ where: { cohortId: { in: cohortIds } }, select: { cohortId: true, sessionId: true, sectionIndex: true, fromDate: true } })).map((m) => `${m.cohortId}|${m.sessionId}|${m.sectionIndex}|${m.fromDate.toISOString().slice(0, 10)}`));
  // A preceptor someone assigned by hand at the site the plan booked leads that shift; the plan's own pick fills in only where nobody is.
  const handRows = await prisma.sessionInstructor.findMany({ where: { cohortId: { in: cohortIds }, role: "preceptor", note: null }, select: { id: true, cohortId: true, sessionId: true, sectionIndex: true, personId: true, person: { select: { employerId: true } } } });
  const handBySection = new Map<string, { id: string; personId: string; employerId: string | null }[]>();
  for (const r of handRows) { const k = `${r.cohortId}|${r.sessionId}|${r.sectionIndex}`; const l = handBySection.get(k) ?? []; l.push({ id: r.id, personId: r.personId, employerId: r.person.employerId }); handBySection.set(k, l); }
  const handAt = (a: PlanAssignmentInput) => (handBySection.get(`${a.cohortId}|${a.sessionId}|${a.sectionIndex}`) ?? []).filter((h) => h.employerId === a.employerId).map((h) => h.personId);
  const leadPreceptor = (a: PlanAssignmentInput) => handAt(a)[0] ?? a.preceptorIds[0] ?? null;
  const leadStaff = (a: PlanAssignmentInput) => leadPreceptor(a) ?? a.instructorId ?? null;
  // A preceptor stays with their employer. Once the plan books a shift at a site, a preceptor from some
  // OTHER site cannot be on it — those assignments come off (the plan puts the site's own people on).
  const offSite = new Set<string>();
  for (const a of assignments) for (const h of handBySection.get(`${a.cohortId}|${a.sessionId}|${a.sectionIndex}`) ?? []) if (h.employerId && h.employerId !== a.employerId) offSite.add(h.id);
  for (const ids of chunks([...offSite])) await prisma.sessionInstructor.deleteMany({ where: { id: { in: ids } } });
  const moveRows = new Map<string, { cohortId: string; sessionId: string; sectionIndex: number; fromDate: Date; toDate: Date; startTime: string | null; employerId: string; staffPersonId: string | null; note: string }>();
  for (const a of assignments) {
    const from = a.originalDate ?? a.date;
    const k = `${a.cohortId}|${a.sessionId}|${a.sectionIndex}|${from}`;
    if (moveRows.has(k) || handMoves.has(k)) continue; // the lead piece of a split section carries the move
    const sectionMain = a.courseId ? mainSite.get(`${a.cohortId}|${a.courseId}|${a.sectionIndex}`) ?? null : null;
    const elsewhere = sectionMain != null && sectionMain !== a.employerId;
    if (!(a.movedDays || a.changedBlock || elsewhere || from !== a.date)) continue;
    moveRows.set(k, { cohortId: a.cohortId, sessionId: a.sessionId, sectionIndex: a.sectionIndex, fromDate: new Date(from + "T00:00:00Z"), toDate: new Date(a.date + "T00:00:00Z"), startTime: a.changedBlock ? a.startTime ?? null : null, employerId: a.employerId, staffPersonId: leadStaff(a), note: AUTO_PLAN_NOTE });
  }
  for (const c of chunks([...moveRows.values()])) await prisma.shiftMove.createMany({ data: c });

  // Who works each shift: the plan's preceptors and instructor on the session × section, next to
  // (never instead of) anyone already assigned by hand.
  const staffedAlready = new Set((await prisma.sessionInstructor.findMany({ where: { cohortId: { in: cohortIds } }, select: { cohortId: true, sessionId: true, sectionIndex: true, personId: true } })).map((r) => `${r.cohortId}|${r.sessionId}|${r.sectionIndex}|${r.personId}`));
  const staffRows: { cohortId: string; sessionId: string; personId: string; sectionIndex: number; role: string; contactHours: number; startOffsetMin: number; note: string }[] = [];
  const addStaff = (a: PlanAssignmentInput, personId: string, role: string) => {
    const k = `${a.cohortId}|${a.sessionId}|${a.sectionIndex}|${personId}`;
    if (staffedAlready.has(k)) return;
    staffedAlready.add(k);
    staffRows.push({ cohortId: a.cohortId, sessionId: a.sessionId, personId, sectionIndex: a.sectionIndex, role, contactHours: a.hours ?? 0, startOffsetMin: 0, note: AUTO_PLAN_NOTE });
  };
  for (const a of assignments) { if (!handAt(a).length) for (const p of a.preceptorIds) addStaff(a, p, "preceptor"); if (a.instructorId) addStaff(a, a.instructorId, "instructor"); }
  for (const c of chunks(staffRows)) await prisma.sessionInstructor.createMany({ data: c });

  // Students follow their section. Each student's shifts are pinned to the booked asset, preceptor
  // and instructor (created when missing, pinned when unpinned, left alone when someone pinned or
  // logged them by hand), and one planned placement per student × site spans that site's dates.
  const students = await prisma.student.findMany({ where: { cohortId: { in: cohortIds } }, select: { id: true, cohortId: true, sectionIndex: true } });
  const placements: { studentId: string; employerId: string; cohortId: string; startDate: Date; endDate: Date; status: string; notes: string }[] = [];
  const target = new Map<string, { studentId: string; cohortId: string; sessionId: string; sectionIndex: number; assetId: string; preceptorId: string | null; instructorId: string | null }>();
  for (const st of students) {
    const mine = assignments.filter((a) => {
      if (a.cohortId !== st.cohortId) return false;
      // Seats are dealt evenly across sections (lib/sections); the plan carries each section's span. Older inputs without it fall back to the ceiling rule.
      const per = Math.max(1, a.seatsPerSection);
      const inSection = a.seatStart != null && a.sectionSeats != null ? st.sectionIndex >= a.seatStart && st.sectionIndex < a.seatStart + a.sectionSeats : Math.max(1, Math.ceil(Math.max(1, st.sectionIndex) / per)) === a.sectionIndex;
      if (!inSection) return false;
      const ord = a.seatStart != null ? st.sectionIndex - a.seatStart + 1 : st.sectionIndex - (a.sectionIndex - 1) * per;
      return ord > (a.seatOffset ?? 0) && ord <= (a.seatOffset ?? 0) + a.seats;
    });
    const bySite = new Map<string, { from: string; to: string }>();
    for (const a of mine) {
      const w = bySite.get(a.employerId) ?? { from: a.date, to: a.date }; if (a.date < w.from) w.from = a.date; if (a.date > w.to) w.to = a.date; bySite.set(a.employerId, w);
      target.set(`${st.id}|${a.sessionId}`, { studentId: st.id, cohortId: st.cohortId!, sessionId: a.sessionId, sectionIndex: a.sectionIndex, assetId: a.assetId, preceptorId: leadPreceptor(a), instructorId: a.instructorId ?? null });
    }
    // A rotation's placement reads by its dates: over (completed), under way (active) or ahead (planned) — a graduated class's are history.
    for (const [employerId, w] of bySite) placements.push({ studentId: st.id, employerId, cohortId: st.cohortId!, startDate: new Date(w.from + "T00:00:00Z"), endDate: new Date(w.to + "T00:00:00Z"), status: w.to < todayIsoPw ? "completed" : w.from <= todayIsoPw ? "active" : "planned", notes: AUTO_PLAN_NOTE });
  }
  if (placements.length) await prisma.wblPlacement.createMany({ data: placements });

  const existing = await prisma.studentShift.findMany({ where: { cohortId: { in: cohortIds } }, select: { id: true, cohortId: true, studentId: true, sessionId: true, sectionIndex: true, note: true, assetId: true, preceptorId: true, instructorId: true, status: true } });
  const seen = new Set<string>();
  const updates = new Map<string, { ids: string[]; data: { assetId: string; preceptorId: string | null; instructorId: string | null; sectionIndex: number; note: string } }>();
  const stale: string[] = []; const unpin: string[] = []; const repin: { id: string; assetId: string }[] = [];
  for (const row of existing) {
    const k = `${row.studentId}|${row.sessionId}`;
    const t = target.get(k);
    if (!t) { if (pastSessions.has(`${row.cohortId ?? ""}|${row.sessionId}`)) continue; if (row.note === AUTO_PLAN_NOTE) stale.push(row.id); else if (row.note === PLAN_PIN_NOTE) unpin.push(row.id); continue; }
    seen.add(k);
    // A logged shift keeps its history (status, hours, preceptor, instructor); only when the caller re-plans its date on purpose
    // (a cutoff before it) does its seat follow the new booking, so no pin ever points at a booking that no longer exists.
    if (row.status !== "scheduled") { if (row.assetId && row.assetId !== t.assetId && (row.note === AUTO_PLAN_NOTE || row.note === PLAN_PIN_NOTE)) repin.push({ id: row.id, assetId: t.assetId }); continue; }
    const ours = row.note === AUTO_PLAN_NOTE || row.note === PLAN_PIN_NOTE || row.note === "auto-assign";
    if (!ours && row.assetId) continue; // pinned by hand
    const note = row.note === AUTO_PLAN_NOTE ? AUTO_PLAN_NOTE : PLAN_PIN_NOTE;
    if (row.assetId === t.assetId && row.preceptorId === t.preceptorId && row.instructorId === t.instructorId && row.sectionIndex === t.sectionIndex && row.note === note) continue;
    const uk = `${t.assetId}|${t.preceptorId ?? ""}|${t.instructorId ?? ""}|${t.sectionIndex}|${note}`;
    const u = updates.get(uk) ?? { ids: [], data: { assetId: t.assetId, preceptorId: t.preceptorId, instructorId: t.instructorId, sectionIndex: t.sectionIndex, note } };
    u.ids.push(row.id); updates.set(uk, u);
  }
  const creates = [...target.entries()].filter(([k]) => !seen.has(k)).map(([, t]) => ({ ...t, note: AUTO_PLAN_NOTE }));
  for (const c of chunks(creates)) await prisma.studentShift.createMany({ data: c });
  for (const u of updates.values()) for (const ids of chunks(u.ids)) await prisma.studentShift.updateMany({ where: { id: { in: ids } }, data: u.data });
  for (const ids of chunks(stale)) await prisma.studentShift.deleteMany({ where: { id: { in: ids } } });
  for (const r of repin) await prisma.studentShift.update({ where: { id: r.id }, data: { assetId: r.assetId } });
  for (const ids of chunks(unpin)) await prisma.studentShift.updateMany({ where: { id: { in: ids } }, data: { assetId: null, preceptorId: null, instructorId: null, note: null } });

  return { bookings: assignments.reduce((n, a) => n + (a.parts?.length || 1), 0), placements: placements.length, meetings, moves: moveRows.size, staffed: staffRows.length, shifts: creates.length + [...updates.values()].reduce((n, u) => n + u.ids.length, 0), offSite: offSite.size };
}


/** Remove everything a plan wrote for these offerings: bookings, placements, moves, shift staffing,
 *  the student shifts it created — and the shifts it merely pinned go back to unpinned. Hand-made rows stay. */
export async function clearSchedulerPlanRows(cohortIds: string[]): Promise<void> {
  if (!cohortIds.length) return;
  await prisma.assetBooking.deleteMany({ where: { cohortId: { in: cohortIds }, note: AUTO_PLAN_NOTE } });
  await prisma.wblPlacement.deleteMany({ where: { cohortId: { in: cohortIds }, notes: AUTO_PLAN_NOTE } });
  await prisma.shiftMove.deleteMany({ where: { cohortId: { in: cohortIds }, note: AUTO_PLAN_NOTE } });
  await prisma.sessionInstructor.deleteMany({ where: { cohortId: { in: cohortIds }, note: AUTO_PLAN_NOTE } });
  await prisma.studentShift.deleteMany({ where: { cohortId: { in: cohortIds }, note: AUTO_PLAN_NOTE } });
  await prisma.studentShift.updateMany({ where: { cohortId: { in: cohortIds }, note: PLAN_PIN_NOTE }, data: { assetId: null, preceptorId: null, instructorId: null, note: null } });
}
