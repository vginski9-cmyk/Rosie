// AUTO-ASSIGN an offering — one button that does the whole placement job:
//
//   1. Calendarize (if not yet): every course × session type × section gets a
//      weekly booking with a day, a time and a campus room (or a partner site).
//   2. Clinical placement: every dated clinical section is placed onto a
//      partner's physical asset (room / bed unit / suite) on its date and shift
//      by the recommendation engine — under secured agreements first, widening
//      to asked / any agreements only for whatever could not be placed — and
//      the plan is written (asset bookings, each section's site + lead
//      preceptor on its weekly booking, planned placements per student).
//   3. Staffing: every shift gets the faculty, support staff and preceptors its
//      session row says it needs — load-aware under each person's workload
//      policy (never double-booked at the same time, lowest weekly load first,
//      never over the policy's weekly cap unless nobody else is left), program
//      faculty first, then the rest of the institution's bench.
//   4. Learners: every student is placed in a section of every course kind by
//      seat order and given every clinical shift of their section — pinned to
//      the asset the plan booked for it — so each learner's hours, settings and
//      shifts are on their itinerary.
//
// Everything already assigned by hand is kept; the engine only fills gaps.
// Returns a summary that says exactly what it did and what it could not do.

import { prisma } from "./db";
import { planMeetings } from "./calendarize";
import { buildInstances, type CohortCalendarInput, type DatedInstance } from "./capacitymodel";
import { demandUnits, recommendPlan, DEFAULT_POLICY, REASON_LABEL, type Policy, type Assignment as PlanAssignment, type UnmetReason } from "./scheduler";
import { resolvePolicy, familyOfRole, type PolicyLite, type PersonLite, type RoleFamily } from "./workload";
import { getCapacityModel, getSchedulerData, getWorkloadPolicies, datedStaffAssignments } from "./queries";
import { applySchedulerPlan } from "./actions";

export interface AutoAssignSummary {
  calendarized: boolean; meetings: number;
  plan: { demandShifts: number; placedShifts: number; placedShare: number; bookings: number; sitesUsed: number; agreements: string; unmet: { reason: string; shifts: number; fixes: string[] }[] } | null;
  staff: { facultyShifts: number; supportShifts: number; preceptorShifts: number; clinicalFacultyShifts: number; alreadyCovered: number; uncovered: { kind: string; shifts: number; why: string }[]; overCap: number; people: number };
  learners: { students: number; sections: number; shifts: number; shiftsOnAssets: number };
  notes: string[];
}

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const mondayOf = (isoDate: string) => { const d = new Date(isoDate + "T00:00:00Z"); return iso(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY)); };
const toMin = (t: string | null) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };

/** Calendarize an offering that has no weekly bookings yet (idempotent). */
export async function calendarizeCore(cohortId: string): Promise<number> {
  const existing = await prisma.meetingPattern.count({ where: { cohortId } });
  if (existing > 0) return 0;
  const co = await prisma.cohort.findUnique({
    where: { id: cohortId },
    include: {
      cohortTerms: { select: { termId: true, startDate: true, endDate: true } },
      program: { select: { institutionId: true, defaultCohortSeats: true, terms: { select: { id: true, index: true, startWeek: true, endWeek: true, courses: { select: { id: true, sessions: { select: { kind: true, maxStudents: true, lengthHours: true } } } } } } } },
    },
  });
  if (!co) return 0;
  const rooms = await prisma.facility.findMany({ where: { institutionId: co.program.institutionId, status: "active" }, select: { id: true, name: true, kind: true, capacity: true } });
  const hosts = await prisma.employer.findMany({ where: { institutionId: co.program.institutionId, status: "active", OR: [{ agreementStatus: "secured" }, { setting: { contains: "Hospital" } }, { setting: { contains: "Imaging" } }, { setting: { contains: "Surgical" } }, { setting: { contains: "Clinic" } }] }, select: { id: true, agreementStatus: true } });
  hosts.sort((a, b) => Number(b.agreementStatus === "secured") - Number(a.agreementStatus === "secured"));
  const ctById = new Map(co.cohortTerms.map((ct) => [ct.termId, ct]));
  const rows = planMeetings({
    cohortId, seats: Math.round(co.plannedSeats ?? co.program.defaultCohortSeats ?? 30), cohortStartMs: co.startDate?.getTime() ?? null,
    terms: co.program.terms.map((t) => ({ id: t.id, index: t.index, startWeek: t.startWeek, endWeek: t.endWeek, startMs: ctById.get(t.id)?.startDate?.getTime() ?? null, endMs: ctById.get(t.id)?.endDate?.getTime() ?? null, courses: t.courses })),
    rooms, hostIds: hosts.map((h) => h.id),
  });
  for (let i = 0; i < rows.length; i += 400) await prisma.meetingPattern.createMany({ data: rows.slice(i, i + 400) });
  return rows.length;
}

/** The whole placement job for one offering. */
export async function autoAssignOffering(cohortId: string): Promise<AutoAssignSummary | null> {
  const notes: string[] = [];
  const head = await prisma.cohort.findUnique({ where: { id: cohortId }, select: { id: true, name: true, programId: true, plannedSeats: true, program: { select: { id: true, name: true, institutionId: true, familyId: true, defaultCohortSeats: true } }, _count: { select: { students: true } } } });
  if (!head) return null;
  const institutionId = head.program.institutionId;

  // 1 · Calendarize.
  const made = await calendarizeCore(cohortId);
  const calendarized = made > 0;
  if (calendarized) notes.push(`Calendarized: ${made} weekly bookings (rooms, days, times; clinical sections at partner sites).`);

  // The dated model of THIS offering (every session instance with its date & sections).
  const cap = await getCapacityModel({ cohortId });
  const cc = cap?.cohorts.find((c) => c.cohortId === cohortId) ?? null;
  const rows: DatedInstance[] = cc ? buildInstances({
    cohortId: cc.cohortId, cohort: cc.cohort, programId: cc.programId, program: cc.program, enrollmentByTerm: cc.enrollmentByTerm,
    termStartByIndex: Object.fromEntries(Object.entries(cc.termStartByIndex).map(([k, v]) => [k, v ? new Date(v) : null])),
    termEndByIndex: cc.termEndByIndex, termWeeksByIndex: cc.termWeeksByIndex, holidays: cc.holidays, courses: cc.courses,
  } as CohortCalendarInput, cc.assumptions) : [];
  const dated = rows.filter((r) => r.dateIso);
  const dateOfSession = new Map(dated.map((r) => [r.session.id, r.dateIso!]));
  const from = dated.map((r) => r.dateIso!).sort()[0] ?? iso(new Date());
  const to = dated.map((r) => r.dateIso!).sort().at(-1) ?? from;

  // 2 · Clinical placement under the widest-needed agreement policy.
  let planSummary: AutoAssignSummary["plan"] = null;
  const planPreceptorBySection = new Map<string, string[]>(); // `${sessionId}|${sec}` → preceptor ids
  const planInstructorBySection = new Map<string, string>();
  const assetBySection = new Map<string, string>();
  if (cc && dated.length) {
    const sched = await getSchedulerData(institutionId, from, to);
    const demand = demandUnits(dated, sched.rotations, (cc.moves ?? []).map((m) => ({ sessionId: m.sessionId, sectionIndex: m.sectionIndex, fromDate: m.fromDate, toDate: m.toDate, startTime: m.startTime ?? null })), { [cohortId]: cc.familyId ?? null });
    if (demand.length) {
      // Other offerings' bookings (hand-made or planned) consume seats; this offering's own auto-plan is replaced.
      const existingBookings = sched.bookings.filter((b) => b.cohortId !== cohortId || (b as { note?: string | null }).note !== "auto-plan");
      const base = { demand, assets: sched.assets, overrides: sched.overrides, existingBookings, preceptors: sched.preceptors, instructors: sched.instructors, students: sched.students, familyAgreements: sched.familyAgreements };
      const tiers: { label: string; policy: Policy }[] = [
        { label: "secured agreements", policy: { ...DEFAULT_POLICY, agreements: "secured" } },
        { label: "secured + asked agreements", policy: { ...DEFAULT_POLICY, agreements: "secured+asked" } },
        { label: "any partner (agreement still to secure)", policy: { ...DEFAULT_POLICY, agreements: "any", flexibleShift: true, flexibleDays: 1 } },
      ];
      let best = recommendPlan({ ...base, policy: tiers[0].policy }); let bestLabel = tiers[0].label;
      for (const t of tiers.slice(1)) {
        if (best.summary.placedShare >= 0.999) break;
        const p = recommendPlan({ ...base, policy: t.policy });
        if (p.summary.placedShifts > best.summary.placedShifts) { best = p; bestLabel = t.label; }
      }
      if (bestLabel !== tiers[0].label) notes.push(`Clinical placement widened to ${bestLabel} to place more sections — secure those agreements.`);
      const applied = await applySchedulerPlan(institutionId, best.assignments.map((x: PlanAssignment) => ({ assetId: x.assetId, employerId: x.employerId, cohortId: x.unit.cohortId, sessionId: x.unit.sessionId, sectionIndex: x.unit.sectionIndex, courseId: x.unit.courseId, date: x.date, block: x.block, seats: x.seats, seatsPerSection: x.unit.seatsPerSection, preceptorIds: x.preceptorIds, instructorId: x.instructorId, parts: x.parts.map((p) => ({ assetId: p.assetId, seats: p.seats })), seatOffset: x.seatOffset })));
      for (const x of best.assignments) {
        const k = `${x.unit.sessionId}|${x.unit.sectionIndex}`;
        if (!planPreceptorBySection.has(k)) planPreceptorBySection.set(k, x.preceptorIds);
        if (x.instructorId && !planInstructorBySection.has(k)) planInstructorBySection.set(k, x.instructorId);
        if (!assetBySection.has(k)) assetBySection.set(k, x.assetId);
      }
      const byReason = new Map<UnmetReason, { shifts: number; fixes: Set<string> }>();
      for (const u of best.unmet) { const b = byReason.get(u.reason) ?? { shifts: 0, fixes: new Set<string>() }; b.shifts++; u.fixes.forEach((f) => b.fixes.add(f)); byReason.set(u.reason, b); }
      planSummary = {
        demandShifts: best.summary.demandShifts, placedShifts: best.summary.placedShifts, placedShare: best.summary.placedShare, bookings: applied.bookings, sitesUsed: best.summary.sitesUsed, agreements: bestLabel,
        unmet: [...byReason.entries()].map(([reason, b]) => ({ reason: REASON_LABEL[reason], shifts: b.shifts, fixes: [...b.fixes].slice(0, 4) })).sort((a, b) => b.shifts - a.shifts),
      };
    } else notes.push("No dated clinical sections to place (no clinical sessions, or the offering's terms are undated).");
  }

  // 3 · Staffing — fill every shift's remaining need under workload policies.
  const [sessions, people, policies, roleRows, existing, programAssignments, meetings] = await Promise.all([
    prisma.session.findMany({ where: { course: { term: { programId: head.programId } } }, select: { id: true, kind: true, lengthHours: true, maxStudents: true, facultyNeeded: true, preceptorsNeeded: true, supportStaffNeeded: true, startTime: true, course: { select: { id: true, code: true, name: true } } } }),
    prisma.person.findMany({ where: { institutionId, active: true }, select: { id: true, name: true, role: true, employmentType: true, title: true, employerId: true, assetId: true, institutionId: true } }),
    getWorkloadPolicies(),
    prisma.staffRole.findMany({ where: { institutionId }, select: { key: true, family: true } }),
    datedStaffAssignments({ institutionId }),
    prisma.assignment.findMany({ where: { programId: head.programId }, select: { personId: true } }),
    prisma.meetingPattern.findMany({ where: { cohortId }, select: { courseId: true, kind: true, sectionIndex: true, employerId: true, staffPersonId: true } }),
  ]);
  const roleFamilies: Record<string, RoleFamily> = Object.fromEntries(roleRows.map((r) => [r.key, r.family as RoleFamily]));
  const famOf = (role: string) => familyOfRole(role, roleFamilies);
  const enrolled = Math.max(head._count.students, head.plannedSeats ?? 0, 1);
  const programPeople = new Set(programAssignments.map((a) => a.personId));
  const progKey = /Radiograph/i.test(head.program.name) ? /Radiograph|Rad/i : /Surgical/i.test(head.program.name) ? /Surg/i : /Nurse Aide|CNA/i.test(head.program.name) ? /Nurse Aide|CNA/i : null;
  const policyOf = new Map(people.map((p) => [p.id, resolvePolicy(p as PersonLite, policies as PolicyLite[]).policy]));
  // Weekly load (contact hours per Monday) and busy slots (date|start) per person, across every offering.
  const weekLoad = new Map<string, Map<string, number>>();
  const busy = new Set<string>();
  const addLoad = (pid: string, dateIso: string | null, start: string | null, hours: number) => {
    if (!dateIso) return;
    const w = weekLoad.get(pid) ?? new Map<string, number>(); w.set(mondayOf(dateIso), (w.get(mondayOf(dateIso)) ?? 0) + hours); weekLoad.set(pid, w);
    if (start) busy.add(`${pid}|${dateIso}|${start}`);
  };
  for (const a of existing) addLoad(a.personId, a.dateIso, null, a.contactHours);
  // Existing rows on this cohort: what each shift already has.
  const mine = existing.filter((a) => a.cohortId === cohortId);
  const have = new Map<string, { role: string; contactHours: number; personId: string }[]>();
  for (const a of mine) { const k = `${a.sessionId}|${a.sectionIndex}`; const l = have.get(k) ?? []; l.push({ role: a.role, contactHours: a.contactHours, personId: a.personId }); have.set(k, l); }
  const sessionStart = new Map(dated.map((r) => [r.session.id, r.session.startTime ?? null]));
  for (const a of mine) { const st = sessionStart.get(a.sessionId) ?? null; if (a.dateIso && st) busy.add(`${a.personId}|${a.dateIso}|${st}`); }

  const creates: { cohortId: string; sessionId: string; personId: string; sectionIndex: number; role: string; contactHours: number; startOffsetMin: number }[] = [];
  const staffSummary: AutoAssignSummary["staff"] = { facultyShifts: 0, supportShifts: 0, preceptorShifts: 0, clinicalFacultyShifts: 0, alreadyCovered: 0, uncovered: [], overCap: 0, people: 0 };
  const uncovered = new Map<string, { shifts: number; why: string }>();
  const pick = (pool: typeof people, dateIso: string | null, start: string | null, hours: number, prefer: (p: (typeof people)[number]) => number): (typeof people)[number] | null => {
    const free = pool.filter((p) => !(dateIso && start && busy.has(`${p.id}|${dateIso}|${start}`)));
    if (!free.length) return null;
    const monday = dateIso ? mondayOf(dateIso) : null;
    const loadOf = (p: (typeof people)[number]) => (monday ? weekLoad.get(p.id)?.get(monday) ?? 0 : 0);
    const capOf = (p: (typeof people)[number]) => { const pol = policyOf.get(p.id)!; return pol.maxContactHoursPerWeek ?? pol.contactHoursPerWeek; };
    const underCap = free.filter((p) => loadOf(p) + hours <= capOf(p) + 1e-9);
    const cands = underCap.length ? underCap : free;
    if (!underCap.length) staffSummary.overCap++;
    cands.sort((a, b) => prefer(b) - prefer(a) || (loadOf(a) / Math.max(1, capOf(a))) - (loadOf(b) / Math.max(1, capOf(b))) || a.name.localeCompare(b.name));
    return cands[0];
  };
  const preferFaculty = (p: (typeof people)[number]) => (programPeople.has(p.id) ? 4 : 0) + (progKey && progKey.test(p.title ?? "") ? 2 : 0) + (p.employmentType === "full-time" ? 1 : 0);
  const facultyPool = people.filter((p) => famOf(p.role) === "faculty");
  const supportPool = people.filter((p) => famOf(p.role) === "support");
  const preceptorPool = people.filter((p) => famOf(p.role) === "preceptor");

  for (const s of sessions) {
    const sections = Math.max(1, Math.ceil(enrolled / Math.max(1, s.maxStudents)));
    const dateIso = dateOfSession.get(s.id) ?? null;
    const start = s.startTime ?? null;
    for (let sec = 1; sec <= sections; sec++) {
      const k = `${s.id}|${sec}`;
      const got = have.get(k) ?? [];
      const sum = (fam: RoleFamily) => got.filter((g) => famOf(g.role) === fam).reduce((n, g) => n + g.contactHours, 0);
      const needs: { fam: RoleFamily; count: number; role: string }[] = [
        { fam: "faculty", count: s.facultyNeeded, role: "instructor" },
        { fam: "support", count: s.supportStaffNeeded, role: "support" },
        { fam: "preceptor", count: s.kind === "CLINICAL" ? s.preceptorsNeeded : 0, role: "preceptor" },
      ];
      let anyNeed = false;
      for (const nd of needs) {
        if (nd.count <= 0) continue;
        anyNeed = true;
        const required = nd.count * s.lengthHours; const assigned = sum(nd.fam);
        let missing = Math.max(0, Math.round((required - assigned) / Math.max(0.25, s.lengthHours))); // people still needed on this shift
        if (missing <= 0) continue;
        const taken = new Set(got.map((g) => g.personId));
        while (missing > 0) {
          let who: (typeof people)[number] | null = null;
          if (nd.fam === "preceptor") {
            // The site the plan / weekly booking put this section at; its preceptors first, then the plan's named ones.
            const m = meetings.find((x) => x.courseId === s.course.id && x.kind === "CLINICAL" && x.sectionIndex === sec) ?? meetings.find((x) => x.courseId === s.course.id && x.kind === "CLINICAL");
            const planned = planPreceptorBySection.get(k) ?? [];
            const siteId = m?.employerId ?? null;
            const pool = preceptorPool.filter((p) => !taken.has(p.id) && (planned.includes(p.id) || (siteId ? p.employerId === siteId : false)));
            who = pick(pool.length ? pool : preceptorPool.filter((p) => !taken.has(p.id) && !siteId), dateIso, start, s.lengthHours, (p) => (planned.includes(p.id) ? 3 : 0) + (m?.staffPersonId === p.id ? 2 : 0));
            if (!who) { const u = uncovered.get("preceptor") ?? { shifts: 0, why: siteId ? "no free preceptor at the section's site that shift" : "section has no clinical site yet — place it first" }; u.shifts++; uncovered.set("preceptor", u); break; }
          } else if (nd.fam === "faculty") {
            const pool = facultyPool.filter((p) => !taken.has(p.id));
            const plannedInst = planInstructorBySection.get(k);
            who = pick(pool, dateIso, start, s.lengthHours, (p) => preferFaculty(p) + (plannedInst === p.id ? 5 : 0));
            if (!who) { const key = s.kind === "CLINICAL" ? "clinical faculty" : "faculty"; const u = uncovered.get(key) ?? { shifts: 0, why: "no faculty free at that time — add faculty or move the shift" }; u.shifts++; uncovered.set(key, u); break; }
          } else {
            const pool = supportPool.filter((p) => !taken.has(p.id));
            who = pick(pool, dateIso, start, s.lengthHours, (p) => (programPeople.has(p.id) ? 2 : 0));
            if (!who) { const u = uncovered.get("support staff") ?? { shifts: 0, why: "no support staff free at that time" }; u.shifts++; uncovered.set("support staff", u); break; }
          }
          creates.push({ cohortId, sessionId: s.id, personId: who.id, sectionIndex: sec, role: who.role, contactHours: s.lengthHours, startOffsetMin: 0 });
          taken.add(who.id); got.push({ role: who.role, contactHours: s.lengthHours, personId: who.id });
          addLoad(who.id, dateIso, start, s.lengthHours);
          if (nd.fam === "preceptor") staffSummary.preceptorShifts++; else if (nd.fam === "support") staffSummary.supportShifts++; else if (s.kind === "CLINICAL") staffSummary.clinicalFacultyShifts++; else staffSummary.facultyShifts++;
          missing--;
        }
      }
      if (anyNeed && !creates.some((c) => c.sessionId === s.id && c.sectionIndex === sec) && got.length) staffSummary.alreadyCovered++;
    }
  }
  for (let i = 0; i < creates.length; i += 400) await prisma.sessionInstructor.createMany({ data: creates.slice(i, i + 400) });
  staffSummary.people = new Set(creates.map((c) => c.personId)).size;
  staffSummary.uncovered = [...uncovered.entries()].map(([kind, u]) => ({ kind, shifts: u.shifts, why: u.why }));

  // 4 · Learners: sections by seat order, every clinical shift, pinned to the booked asset.
  const [students, courses, existingSections, existingShifts] = await Promise.all([
    prisma.student.findMany({ where: { cohortId, status: { in: ["enrolled", "admitted"] } }, select: { id: true, sectionIndex: true }, orderBy: { sectionIndex: "asc" } }),
    prisma.course.findMany({ where: { term: { programId: head.programId } }, select: { id: true, sessions: { select: { id: true, kind: true, maxStudents: true } } } }),
    prisma.studentSection.findMany({ where: { cohortId }, select: { studentId: true, courseId: true, kind: true } }),
    prisma.studentShift.findMany({ where: { cohortId }, select: { studentId: true, sessionId: true } }),
  ]);
  const hasSec = new Set(existingSections.map((x) => `${x.studentId}|${x.courseId}|${x.kind}`));
  const hasShift = new Set(existingShifts.map((x) => `${x.studentId}|${x.sessionId}`));
  const secRows: { studentId: string; cohortId: string; courseId: string; kind: string; sectionIndex: number }[] = [];
  const shiftRows: { studentId: string; cohortId: string; sessionId: string; sectionIndex: number; assetId: string | null; note: string | null }[] = [];
  for (const c of courses) {
    const kinds = new Map<string, { max: number; sessions: string[] }>();
    for (const s of c.sessions) { const k = kinds.get(s.kind) ?? { max: 0, sessions: [] }; k.max = Math.max(k.max, s.maxStudents ?? 0); k.sessions.push(s.id); kinds.set(s.kind, k); }
    for (const [kind, k] of kinds) {
      const nSec = Math.max(1, k.max > 0 ? Math.ceil(enrolled / k.max) : 1);
      for (const st of students) {
        const seat = Math.max(1, st.sectionIndex ?? 1);
        const sec = Math.min(nSec, k.max > 0 ? Math.ceil(seat / k.max) : 1);
        if (!hasSec.has(`${st.id}|${c.id}|${kind}`)) { secRows.push({ studentId: st.id, cohortId, courseId: c.id, kind, sectionIndex: sec }); hasSec.add(`${st.id}|${c.id}|${kind}`); }
        if (kind === "CLINICAL") for (const sid of k.sessions) {
          if (hasShift.has(`${st.id}|${sid}`)) continue;
          shiftRows.push({ studentId: st.id, cohortId, sessionId: sid, sectionIndex: sec, assetId: assetBySection.get(`${sid}|${sec}`) ?? null, note: "auto-assign" });
          hasShift.add(`${st.id}|${sid}`);
        }
      }
    }
  }
  for (let i = 0; i < secRows.length; i += 400) await prisma.studentSection.createMany({ data: secRows.slice(i, i + 400) });
  for (let i = 0; i < shiftRows.length; i += 400) await prisma.studentShift.createMany({ data: shiftRows.slice(i, i + 400) });
  // Existing shifts without an asset pick up the plan's asset.
  const unpinned = await prisma.studentShift.findMany({ where: { cohortId, assetId: null }, select: { id: true, sessionId: true, sectionIndex: true } });
  let pinned = 0;
  for (const u of unpinned) { const a = assetBySection.get(`${u.sessionId}|${u.sectionIndex}`); if (a) { await prisma.studentShift.update({ where: { id: u.id }, data: { assetId: a } }); pinned++; } }

  const meetingCount = await prisma.meetingPattern.count({ where: { cohortId } });
  return {
    calendarized, meetings: meetingCount,
    plan: planSummary,
    staff: staffSummary,
    learners: { students: students.length, sections: secRows.length, shifts: shiftRows.length, shiftsOnAssets: shiftRows.filter((r) => r.assetId).length + pinned },
    notes,
  };
}
