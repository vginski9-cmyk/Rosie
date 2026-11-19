// SHARED SECTIONS — one offering JOINS another offering of its family from a given term on. Cape Fear's Nursing
// Transition (10 students, spring entry) sits with the ADN Fall Entry class from that class's second semester
// (NUR 112/114) through NUR 213; Brunswick's LPN-to-ADN and Paramedic-to-ADN bridges and Southeastern's LPN-to-ADN
// join their ADN class's second year. The rule (the owner's call, 2026-11-19):
//
//   • joiner term k ≥ joinsAtTermIndex maps to host term joinsHostTermIndex + (k − joinsAtTermIndex);
//   • a joiner course whose CODE the mapped host term also carries is the host's section: one meeting, both offerings'
//     students in it, instructors and preceptors counted once — the host's enrollment for that term includes the
//     joiner's, the joiner books, dates and staffs nothing for it (`heldIn` says where it is held), and the joiner's
//     students sit in the host's sections under their own offering;
//   • the joiner's other courses in a shared term stay its own sections (Brunswick's LPN takes ENG 112 in the summer
//     the ADN takes PSY 241; Southeastern's LPN takes NUR 211 in a fall the ADN teaches NUR 212);
//   • the joiner's shared terms take the host's dates.
//
// `applyJoins` is the one mapping every reader and seed uses — the capacity model (staffing, scheduler, site load,
// asset map, exceptions, expansion, the audit), the calendar view, the weekly bookings and the student rosters —
// so the same meeting is never counted twice. Pure: it returns new objects and never mutates its inputs. One level
// only: a host that itself joins another offering is refused (both read `joinUnresolved`).

import type { PrismaClient } from "@prisma/client";

export interface JoinSpec { hostCohortId: string; atTermIndex: number; hostTermIndex: number }
export interface JoinableCourse { code: string | null; termIndex: number; /** The course row, when the caller has one (the bookings skip a held-in course by id). */ courseId?: string | null }
export interface JoinableCohort {
  cohortId: string; cohort: string;
  join?: JoinSpec | null;
  enrollmentByTerm: Record<number, number>;
  termStartByIndex: Record<number, Date | string | null>;
  termEndByIndex?: Record<number, Date | string | null>;
  courses: JoinableCourse[];
}
/** A joiner course held in the host's section. */
export interface HeldIn { code: string | null; courseId: string | null; termIndex: number; hostCohortId: string; hostCohortName: string; hostTermIndex: number }
/** What a joiner adds to one of the host's terms. */
export interface JoinedSeats { cohortId: string; cohortName: string; joinerTermIndex: number; seats: number }
export type Joined<T extends JoinableCohort> = T & {
  heldIn: HeldIn[];
  joinedSeats: Record<number, JoinedSeats[]>;
  joinUnresolved?: string;
};

export const normCode = (c: string | null | undefined): string => (c ?? "").replace(/\s+/g, " ").trim().toUpperCase();
/** The host term a joiner term sits in (null before the join begins). */
export const hostTermOf = (j: JoinSpec, k: number): number | null => (k >= j.atTermIndex ? j.hostTermIndex + (k - j.atTermIndex) : null);
/** The joiner term that sits in a host term (null before the join begins). */
export const joinerTermOf = (j: JoinSpec, h: number): number | null => (h >= j.hostTermIndex ? j.atTermIndex + (h - j.hostTermIndex) : null);

const lastKnown = (e: Record<number, number>, k: number): number => {
  if (e[k] != null) return e[k];
  const keys = Object.keys(e).map(Number).filter((x) => x <= k).sort((a, b) => b - a);
  return keys.length ? e[keys[0]] : 0;
};
const hasTerm = (c: JoinableCohort, k: number): boolean => Object.prototype.hasOwnProperty.call(c.termStartByIndex, k) || c.courses.some((x) => x.termIndex === k);

/** Joiner term → the course codes it shares with the mapped host term. */
export function sharedCodes(joiner: JoinableCohort, host: JoinableCohort, j: JoinSpec): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  const hostCodes = new Map<number, Set<string>>();
  for (const c of host.courses) { const s = hostCodes.get(c.termIndex) ?? new Set<string>(); if (normCode(c.code)) s.add(normCode(c.code)); hostCodes.set(c.termIndex, s); }
  for (const c of joiner.courses) {
    const h = hostTermOf(j, c.termIndex);
    if (h == null || !hasTerm(host, h)) continue;
    const code = normCode(c.code);
    if (code && hostCodes.get(h)?.has(code)) { const s = out.get(c.termIndex) ?? new Set<string>(); s.add(code); out.set(c.termIndex, s); }
  }
  return out;
}

/** The one mapping: hosts carry their joiners' seats in the shared terms, joiners lose the courses the host holds. */
export function applyJoins<T extends JoinableCohort>(cohorts: T[]): Joined<T>[] {
  const byId = new Map(cohorts.map((c) => [c.cohortId, c]));
  const out = new Map<string, Joined<T>>();
  for (const c of cohorts) out.set(c.cohortId, { ...c, enrollmentByTerm: { ...c.enrollmentByTerm }, termStartByIndex: { ...c.termStartByIndex }, termEndByIndex: c.termEndByIndex ? { ...c.termEndByIndex } : c.termEndByIndex, courses: [...c.courses], heldIn: [], joinedSeats: {} });
  for (const c of cohorts) {
    const j = c.join;
    if (!j) continue;
    const me = out.get(c.cohortId)!;
    const host = byId.get(j.hostCohortId);
    if (!host) { me.joinUnresolved = "the host offering is not on record"; continue; }
    if (host.join) { me.joinUnresolved = `${host.cohort} itself joins another offering; a join cannot chain`; const h = out.get(host.cohortId)!; h.joinUnresolved ??= `${c.cohort} joins it while it joins another offering`; continue; }
    if (host.cohortId === c.cohortId) { me.joinUnresolved = "an offering cannot join itself"; continue; }
    const h0 = out.get(host.cohortId)!;
    const shared = sharedCodes(c, host, j);
    const joinerTerms = [...new Set([...Object.keys(c.termStartByIndex).map(Number), ...c.courses.map((x) => x.termIndex)])].filter((k) => k >= j.atTermIndex).sort((a, b) => a - b);
    for (const k of joinerTerms) {
      const h = hostTermOf(j, k)!;
      if (!hasTerm(host, h)) { me.joinUnresolved = `its term ${k} runs past the host's last term`; continue; }
      const seats = lastKnown(c.enrollmentByTerm, k);
      h0.enrollmentByTerm[h] = lastKnown(h0.enrollmentByTerm, h) + seats;
      (h0.joinedSeats[h] ??= []).push({ cohortId: c.cohortId, cohortName: c.cohort, joinerTermIndex: k, seats });
      me.termStartByIndex[k] = host.termStartByIndex[h] ?? null;
      if (host.termEndByIndex) { me.termEndByIndex = me.termEndByIndex ?? {}; (me.termEndByIndex as Record<number, Date | string | null>)[k] = host.termEndByIndex[h] ?? null; }
      const codes = shared.get(k);
      if (codes?.size) {
        me.courses = me.courses.filter((x) => { const held = x.termIndex === k && codes.has(normCode(x.code)); if (held) me.heldIn.push({ code: x.code, courseId: x.courseId ?? null, termIndex: k, hostCohortId: host.cohortId, hostCohortName: host.cohort, hostTermIndex: h }); return !held; });
      }
    }
  }
  return cohorts.map((c) => out.get(c.cohortId)!);
}

/** Seat numbers inside the host's seat space: the host's planned seats (else its largest term), then each joiner's seats in
 *  start order — a joiner student's seat is the offset plus its own seat (`hostSeat`). */
export function joinerSeatOffsets(host: { cohortId: string; plannedSeats: number | null; enrollmentByTerm: Record<number, number> }, joiners: { cohortId: string; plannedSeats: number | null; startIso: string | null; name: string; enrollmentByTerm?: Record<number, number> }[]): Map<string, number> {
  const seatsOf = (p: number | null, e: Record<number, number> | undefined) => Math.max(1, Math.round(p ?? Math.max(0, ...Object.values(e ?? {}))));
  let offset = seatsOf(host.plannedSeats, host.enrollmentByTerm);
  const out = new Map<string, number>();
  for (const j of [...joiners].sort((a, b) => (a.startIso ?? "").localeCompare(b.startIso ?? "") || a.name.localeCompare(b.name))) { out.set(j.cohortId, offset); offset += seatsOf(j.plannedSeats, j.enrollmentByTerm); }
  return out;
}
export const hostSeat = (offset: number, ownSeat: number): number => offset + ownSeat;

/** The host's seats per term once its joiners sit in: what the weekly bookings size their sections from. */
export const seatsByTermFor = (host: Joined<JoinableCohort>): Record<number, number> => ({ ...host.enrollmentByTerm });

/** A headcount a page can show for a host: its own students and the students sitting in from its joiners. */
export function headcount(host: { students: number; joiners?: { students: number }[] }): { own: number; joined: number; label: string } {
  const joined = (host.joiners ?? []).reduce((n, j) => n + j.students, 0);
  return { own: host.students, joined, label: joined ? `${host.students} + ${joined} joined` : String(host.students) };
}

/** A Prisma `where` for rows of an offering or of the offerings that join it (student sections, shifts, bookings). */
export const cohortOrJoiners = (cohortId: string) => ({ OR: [{ cohortId }, { cohort: { joinsCohortId: cohortId } }] });

/** A joiner's shared terms take the host's dates: joiner term k ≥ atTermIndex → the host's row for term hostTermOf(k).
 *  `missing` lists joiner terms the host has no dated term for (the join runs past the host's last term). */
export function joinedTermDates(j: JoinSpec, joinerTerms: { id: string; index: number }[], hostTerms: { index: number; startIso: string; endIso: string | null }[]): { dates: Record<string, { startIso: string; endIso: string | null }>; missing: number[] } {
  const byIndex = new Map(hostTerms.map((t) => [t.index, t]));
  const dates: Record<string, { startIso: string; endIso: string | null }> = {}; const missing: number[] = [];
  for (const t of joinerTerms) {
    const h = hostTermOf(j, t.index);
    if (h == null) continue;
    const row = byIndex.get(h);
    if (row) dates[t.id] = { startIso: row.startIso, endIso: row.endIso }; else missing.push(t.index);
  }
  return { dates, missing };
}

/** The join context the weekly bookings need (lib/cohortjoin): for one offering or every offering of a college, each
 *  cohort's seats per term once its joiners sit in, and the course ids a joiner books nothing for. */
export async function bookingJoins(prismaClient: PrismaClient, where: Record<string, unknown>): Promise<Map<string, { seatsByTerm: Record<number, number>; skipCourseIds: Set<string> }>> {
  const rows = await prismaClient.cohort.findMany({
    where, select: {
      id: true, name: true, plannedSeats: true, joinsCohortId: true, joinsAtTermIndex: true, joinsHostTermIndex: true,
      cohortTerms: { select: { startDate: true, endDate: true, term: { select: { index: true } } } },
      program: { select: { defaultCohortSeats: true, terms: { select: { index: true, courses: { select: { id: true, code: true } } } } } },
    },
  });
  const inputs = rows.map((co) => {
    const seats = Math.round(co.plannedSeats ?? co.program.defaultCohortSeats ?? 30);
    return {
      cohortId: co.id, cohort: co.name,
      join: co.joinsCohortId && co.joinsAtTermIndex != null && co.joinsHostTermIndex != null ? { hostCohortId: co.joinsCohortId, atTermIndex: co.joinsAtTermIndex, hostTermIndex: co.joinsHostTermIndex } : null,
      enrollmentByTerm: Object.fromEntries(co.program.terms.map((t) => [t.index, seats])) as Record<number, number>,
      termStartByIndex: Object.fromEntries(co.cohortTerms.map((ct) => [ct.term.index, ct.startDate])) as Record<number, Date | null>,
      termEndByIndex: Object.fromEntries(co.cohortTerms.map((ct) => [ct.term.index, ct.endDate])) as Record<number, Date | null>,
      courses: co.program.terms.flatMap((t) => t.courses.map((x) => ({ code: x.code, termIndex: t.index, courseId: x.id }))),
    };
  });
  return new Map(applyJoins(inputs).map((j) => [j.cohortId, { seatsByTerm: j.enrollmentByTerm, skipCourseIds: new Set(j.heldIn.map((h) => h.courseId).filter((id): id is string => !!id)) }]));
}
