// Change records (Phase 5 of docs/metrics-audit.md). Every bulk write — applying a scheduler
// plan, auto-assigning an offering, re-aligning offerings to the calendar — is previewed
// first, then recorded as a ChangeSet: what it created, changed and removed, which blockers
// were overridden, and a snapshot that puts things back. Undo restores the snapshot and
// marks the record undone; it never deletes the record.
//
// Server-only (Prisma). Server actions in lib/actions wrap these for the browser.

import { prisma } from "./db";
import { AUTO_PLAN_NOTE, type Blocker, type BlockerKind } from "./scheduler";

export const PLAN_PIN_NOTE = "auto-plan:pinned";
export type ChangeKind = "scheduler-apply" | "auto-assign" | "realign";

/** What a change did, in rows, by table — the numbers the confirm step shows and the record keeps. */
export interface ChangeSummary {
  created: Record<string, number>;
  changed: Record<string, number>;
  removed: Record<string, number>;
  /** Blockers present when the change was applied (blocking ones need an override). */
  blockers?: Pick<Blocker, "kind" | "label" | "shifts" | "seats" | "blocking">[];
  /** Free-text notes the change wants remembered (agreement tier widened, warnings). */
  notes?: string[];
}
export interface ChangeSetRow { id: string; kind: ChangeKind; label: string; institutionId: string | null; cohortIds: string[]; summary: ChangeSummary; overridden: BlockerKind[] | null; createdAt: string; undoneAt: string | null }

const parse = <T,>(s: string | null | undefined, fallback: T): T => { if (!s) return fallback; try { return JSON.parse(s) as T; } catch { return fallback; } };
const chunks = <T,>(xs: T[], n = 400): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };
const isoOf = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const dateOf = (s: string | null | undefined) => (s ? new Date(s) : null);

export function rowOf(r: { id: string; kind: string; label: string; institutionId: string | null; cohortIds: string; summary: string; overridden: string | null; createdAt: Date; undoneAt: Date | null }): ChangeSetRow {
  return { id: r.id, kind: r.kind as ChangeKind, label: r.label, institutionId: r.institutionId, cohortIds: parse<string[]>(r.cohortIds, []), summary: parse<ChangeSummary>(r.summary, { created: {}, changed: {}, removed: {} }), overridden: parse<BlockerKind[] | null>(r.overridden, null), createdAt: r.createdAt.toISOString(), undoneAt: r.undoneAt ? r.undoneAt.toISOString() : null };
}

/** The most recent change records, newest first (institution-scoped when given). */
export async function listChangeSets(institutionId?: string, limit = 12): Promise<ChangeSetRow[]> {
  const rows = await prisma.changeSet.findMany({ where: institutionId ? { institutionId } : undefined, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map(rowOf);
}

// ── Scheduler plan: the rows applySchedulerPlan replaces or rewrites ────────────────────────
export interface PlanSnapshot {
  cohortIds: string[];
  bookings: { assetId: string; cohortId: string; sessionId: string | null; sectionIndex: number; date: string; block: string; students: number; note: string | null }[];
  placements: { studentId: string; employerId: string; cohortId: string | null; startDate: string | null; endDate: string | null; status: string; notes: string | null }[];
  moves: { cohortId: string; sessionId: string; sectionIndex: number; fromDate: string; toDate: string; startTime: string | null; employerId: string | null; staffPersonId: string | null; note: string | null }[];
  staff: { id: string; cohortId: string | null; sessionId: string; personId: string; sectionIndex: number; role: string; contactHours: number; startOffsetMin: number | null; note: string | null }[];
  meetings: { id: string; employerId: string | null; staffPersonId: string | null }[];
  shifts: { id: string; studentId: string; cohortId: string; sessionId: string; sectionIndex: number; assetId: string | null; preceptorId: string | null; note: string | null; settingCode: string | null; pinnedArea: string | null }[];
}

/** Everything an apply for these offerings may replace or rewrite, as it stands now. */
export async function snapshotPlan(cohortIds: string[]): Promise<PlanSnapshot> {
  if (!cohortIds.length) return { cohortIds, bookings: [], placements: [], moves: [], staff: [], meetings: [], shifts: [] };
  const [bookings, placements, moves, staff, meetings, shifts] = await Promise.all([
    prisma.assetBooking.findMany({ where: { cohortId: { in: cohortIds }, note: AUTO_PLAN_NOTE }, select: { assetId: true, cohortId: true, sessionId: true, sectionIndex: true, date: true, block: true, students: true, note: true } }),
    prisma.wblPlacement.findMany({ where: { cohortId: { in: cohortIds }, notes: AUTO_PLAN_NOTE }, select: { studentId: true, employerId: true, cohortId: true, startDate: true, endDate: true, status: true, notes: true } }),
    prisma.shiftMove.findMany({ where: { cohortId: { in: cohortIds }, note: AUTO_PLAN_NOTE }, select: { cohortId: true, sessionId: true, sectionIndex: true, fromDate: true, toDate: true, startTime: true, employerId: true, staffPersonId: true, note: true } }),
    // The plan's own staffing rows are replaced; hand-made preceptor rows can be taken off a shift that moves site — keep both.
    prisma.sessionInstructor.findMany({ where: { cohortId: { in: cohortIds }, OR: [{ note: AUTO_PLAN_NOTE }, { role: "preceptor", note: null }] }, select: { id: true, cohortId: true, sessionId: true, personId: true, sectionIndex: true, role: true, contactHours: true, startOffsetMin: true, note: true } }),
    prisma.meetingPattern.findMany({ where: { cohortId: { in: cohortIds }, kind: "CLINICAL" }, select: { id: true, employerId: true, staffPersonId: true } }),
    prisma.studentShift.findMany({ where: { cohortId: { in: cohortIds }, status: "scheduled" }, select: { id: true, studentId: true, cohortId: true, sessionId: true, sectionIndex: true, assetId: true, preceptorId: true, note: true, settingCode: true, pinnedArea: true } }),
  ]);
  return {
    cohortIds,
    bookings: bookings.map((b) => ({ ...b, date: b.date.toISOString() })),
    placements: placements.map((p) => ({ ...p, startDate: isoOf(p.startDate), endDate: isoOf(p.endDate) })),
    moves: moves.map((m) => ({ ...m, fromDate: m.fromDate.toISOString(), toDate: m.toDate.toISOString() })),
    staff, meetings, shifts,
  };
}

/** Put the plan's tables back the way the snapshot had them (hand-made rows made since are left alone). */
export async function restorePlan(s: PlanSnapshot): Promise<void> {
  const { cohortIds } = s;
  if (!cohortIds.length) return;
  // 1 · Drop what the apply wrote.
  await prisma.assetBooking.deleteMany({ where: { cohortId: { in: cohortIds }, note: AUTO_PLAN_NOTE } });
  await prisma.wblPlacement.deleteMany({ where: { cohortId: { in: cohortIds }, notes: AUTO_PLAN_NOTE } });
  await prisma.shiftMove.deleteMany({ where: { cohortId: { in: cohortIds }, note: AUTO_PLAN_NOTE } });
  await prisma.sessionInstructor.deleteMany({ where: { cohortId: { in: cohortIds }, note: AUTO_PLAN_NOTE } });
  // 2 · Put the earlier plan's rows back.
  for (const c of chunks(s.bookings)) await prisma.assetBooking.createMany({ data: c.map((b) => ({ ...b, date: new Date(b.date) })) });
  for (const c of chunks(s.placements)) await prisma.wblPlacement.createMany({ data: c.map((p) => ({ ...p, startDate: dateOf(p.startDate), endDate: dateOf(p.endDate) })) });
  for (const c of chunks(s.moves)) await prisma.shiftMove.createMany({ data: c.map((m) => ({ ...m, fromDate: new Date(m.fromDate), toDate: new Date(m.toDate) })) });
  const staffNow = new Set((await prisma.sessionInstructor.findMany({ where: { id: { in: s.staff.map((x) => x.id) } }, select: { id: true } })).map((x) => x.id));
  const staffBack = s.staff.filter((x) => !staffNow.has(x.id)).map(({ id: _id, ...rest }) => rest);
  for (const c of chunks(staffBack)) await prisma.sessionInstructor.createMany({ data: c });
  // 3 · Meeting patterns: site and lead preceptor as they were.
  const byTarget = new Map<string, string[]>();
  for (const m of s.meetings) { const k = `${m.employerId ?? ""}|${m.staffPersonId ?? ""}`; byTarget.set(k, [...(byTarget.get(k) ?? []), m.id]); }
  for (const [k, ids] of byTarget) { const [employerId, staffPersonId] = k.split("|"); for (const c of chunks(ids)) await prisma.meetingPattern.updateMany({ where: { id: { in: c } }, data: { employerId: employerId || null, staffPersonId: staffPersonId || null } }); }
  // 4 · Student shifts: rows the apply created go; rows it rewrote go back; rows it deleted come back.
  const keep = new Set(s.shifts.map((x) => x.id));
  const created = (await prisma.studentShift.findMany({ where: { cohortId: { in: cohortIds }, note: { in: [AUTO_PLAN_NOTE, PLAN_PIN_NOTE] } }, select: { id: true } })).map((x) => x.id).filter((id) => !keep.has(id));
  for (const c of chunks(created)) await prisma.studentShift.deleteMany({ where: { id: { in: c } } });
  const now = new Map((await prisma.studentShift.findMany({ where: { id: { in: s.shifts.map((x) => x.id) } }, select: { id: true, assetId: true, preceptorId: true, sectionIndex: true, note: true } })).map((x) => [x.id, x]));
  const groups = new Map<string, string[]>();
  const missing: PlanSnapshot["shifts"] = [];
  for (const x of s.shifts) {
    const cur = now.get(x.id);
    if (!cur) { missing.push(x); continue; }
    if (cur.assetId === x.assetId && cur.preceptorId === x.preceptorId && cur.sectionIndex === x.sectionIndex && cur.note === x.note) continue;
    const k = `${x.assetId ?? ""}|${x.preceptorId ?? ""}|${x.sectionIndex}|${x.note ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), x.id]);
  }
  for (const [k, ids] of groups) { const [assetId, preceptorId, sec, note] = k.split("|"); for (const c of chunks(ids)) await prisma.studentShift.updateMany({ where: { id: { in: c } }, data: { assetId: assetId || null, preceptorId: preceptorId || null, sectionIndex: Number(sec), note: note || null } }); }
  for (const c of chunks(missing)) await prisma.studentShift.createMany({ data: c.map(({ id: _id, ...rest }) => rest) });
}

// ── Auto-assign: the rows it adds (by id, diffed before and after) plus the plan it applies ──
export interface AutoAssignSnapshot {
  cohortId: string;
  before: { meetings: string[]; staff: string[]; sections: string[]; shifts: string[]; unpinned: string[] };
  /** Filled after the run: ids that did not exist before. */
  created?: { meetings: string[]; staff: string[]; sections: string[]; shifts: string[] };
  plan: PlanSnapshot;
}
export async function snapshotAutoAssign(cohortId: string): Promise<AutoAssignSnapshot> {
  const ids = async (rows: Promise<{ id: string }[]>) => (await rows).map((r) => r.id);
  const [meetings, staff, sections, shifts, unpinned, plan] = await Promise.all([
    ids(prisma.meetingPattern.findMany({ where: { cohortId }, select: { id: true } })),
    ids(prisma.sessionInstructor.findMany({ where: { cohortId }, select: { id: true } })),
    ids(prisma.studentSection.findMany({ where: { cohortId }, select: { id: true } })),
    ids(prisma.studentShift.findMany({ where: { cohortId }, select: { id: true } })),
    ids(prisma.studentShift.findMany({ where: { cohortId, assetId: null }, select: { id: true } })),
    snapshotPlan([cohortId]),
  ]);
  return { cohortId, before: { meetings, staff, sections, shifts, unpinned }, plan };
}
/** After the run: which ids are new. */
export async function diffAutoAssign(s: AutoAssignSnapshot): Promise<AutoAssignSnapshot> {
  const { cohortId } = s;
  const fresh = async (rows: Promise<{ id: string }[]>, had: string[]) => { const h = new Set(had); return (await rows).map((r) => r.id).filter((id) => !h.has(id)); };
  const [meetings, staff, sections, shifts] = await Promise.all([
    fresh(prisma.meetingPattern.findMany({ where: { cohortId }, select: { id: true } }), s.before.meetings),
    fresh(prisma.sessionInstructor.findMany({ where: { cohortId }, select: { id: true } }), s.before.staff),
    fresh(prisma.studentSection.findMany({ where: { cohortId }, select: { id: true } }), s.before.sections),
    fresh(prisma.studentShift.findMany({ where: { cohortId }, select: { id: true } }), s.before.shifts),
  ]);
  return { ...s, created: { meetings, staff, sections, shifts } };
}
export async function restoreAutoAssign(s: AutoAssignSnapshot): Promise<void> {
  const c = s.created ?? { meetings: [], staff: [], sections: [], shifts: [] };
  for (const ids of chunks(c.shifts)) await prisma.studentShift.deleteMany({ where: { id: { in: ids } } });
  for (const ids of chunks(c.sections)) await prisma.studentSection.deleteMany({ where: { id: { in: ids } } });
  for (const ids of chunks(c.staff)) await prisma.sessionInstructor.deleteMany({ where: { id: { in: ids } } });
  await restorePlan(s.plan);
  for (const ids of chunks(s.before.unpinned)) await prisma.studentShift.updateMany({ where: { id: { in: ids } }, data: { assetId: null } });
  // Weekly bookings the run calendarized go last (moves and staffing rows hang off them).
  for (const ids of chunks(c.meetings)) await prisma.meetingPattern.deleteMany({ where: { id: { in: ids } } });
}

// ── Re-align: each offering's dates, term rows and course windows as they were ──────────────
export interface RealignSnapshot {
  cohorts: { id: string; name: string; startDate: string | null; entryYear: number | null;
    terms: { termId: string; startDate: string | null; endDate: string | null; semester: string | null; source: string | null }[];
    courseDates: { courseId: string; startDate: string | null; endDate: string | null; auto: boolean }[] }[];
}
export async function snapshotRealign(cohortIds: string[]): Promise<RealignSnapshot> {
  const rows = await prisma.cohort.findMany({ where: { id: { in: cohortIds } }, select: { id: true, name: true, startDate: true, entryYear: true, cohortTerms: { select: { termId: true, startDate: true, endDate: true, semester: true, source: true } }, courseDates: { select: { courseId: true, startDate: true, endDate: true, auto: true } } } });
  return { cohorts: rows.map((c) => ({ id: c.id, name: c.name, startDate: isoOf(c.startDate), entryYear: c.entryYear, terms: c.cohortTerms.map((t) => ({ ...t, startDate: isoOf(t.startDate), endDate: isoOf(t.endDate) })), courseDates: c.courseDates.map((d) => ({ ...d, startDate: isoOf(d.startDate), endDate: isoOf(d.endDate) })) })) };
}
export async function restoreRealign(s: RealignSnapshot): Promise<void> {
  for (const c of s.cohorts) {
    await prisma.cohort.update({ where: { id: c.id }, data: { name: c.name, startDate: dateOf(c.startDate), entryYear: c.entryYear } });
    await prisma.cohortTerm.deleteMany({ where: { cohortId: c.id } });
    if (c.terms.length) await prisma.cohortTerm.createMany({ data: c.terms.map((t) => ({ cohortId: c.id, termId: t.termId, startDate: dateOf(t.startDate), endDate: dateOf(t.endDate), semester: t.semester, source: t.source })) });
    await prisma.cohortCourseDates.deleteMany({ where: { cohortId: c.id } });
    if (c.courseDates.length) await prisma.cohortCourseDates.createMany({ data: c.courseDates.map((d) => ({ cohortId: c.id, courseId: d.courseId, startDate: dateOf(d.startDate), endDate: dateOf(d.endDate), auto: d.auto })) });
  }
}

// ── The record itself ───────────────────────────────────────────────────────────────────────
export async function recordChange(o: { kind: ChangeKind; label: string; institutionId: string | null; cohortIds: string[]; summary: ChangeSummary; undo: PlanSnapshot | AutoAssignSnapshot | RealignSnapshot; overridden?: BlockerKind[] | null }): Promise<string> {
  const r = await prisma.changeSet.create({ data: { kind: o.kind, label: o.label, institutionId: o.institutionId, cohortIds: JSON.stringify(o.cohortIds), summary: JSON.stringify(o.summary), undo: JSON.stringify(o.undo), overridden: o.overridden?.length ? JSON.stringify(o.overridden) : null } });
  return r.id;
}

/** Undo one change: restore its snapshot and mark it undone. Returns the record, or null when it is unknown or already undone. */
export async function undoChange(id: string): Promise<ChangeSetRow | null> {
  const r = await prisma.changeSet.findUnique({ where: { id } });
  if (!r || r.undoneAt) return null;
  const kind = r.kind as ChangeKind;
  if (kind === "scheduler-apply") await restorePlan(parse<PlanSnapshot>(r.undo, { cohortIds: [], bookings: [], placements: [], moves: [], staff: [], meetings: [], shifts: [] }));
  else if (kind === "auto-assign") { const s = parse<AutoAssignSnapshot | null>(r.undo, null); if (s) await restoreAutoAssign(s); }
  else if (kind === "realign") await restoreRealign(parse<RealignSnapshot>(r.undo, { cohorts: [] }));
  const done = await prisma.changeSet.update({ where: { id }, data: { undoneAt: new Date() } });
  return rowOf(done);
}
