// The clinical SCHEDULER — supply and demand put together.
//
// DEMAND: every dated clinical shift of every offering, one unit per SECTION
// (cohort × course × session × date × shift block × setting), sized in seats
// (students in that section), preceptors and faculty needed, and hours.
// SUPPLY: every physical asset × date × shift block from the 365-day asset map
// (learners per shift, preceptors per shift), the site's agreement and drive
// ring, and the preceptor / instructor people on hand.
//
// recommendPlan() places demand onto supply under a POLICY (which agreements
// count, flexible shift, flexible day, ring, continuity, spread, preceptor
// gate), constrained-first: the sections with the fewest possible homes are
// placed first so an easy section never steals the only slot a hard one had.
// Every placement carries its reason; everything unplaced carries WHY, plus
// which relaxation of the policy would have placed it — the bottleneck
// analytics fall straight out of that.
//
// Pure functions, no React, no Prisma. Deterministic for the same input.

import type { DatedInstance } from "./capacitymodel";
import { blocksOn, overrideIndex, overrideKey, shiftHours, isoAdd, type AssetLite, type AssetDayOverride, type AssetBookingLite, type RotationCode } from "./assetmap";
import { shiftBlockOf, weekdayOfIso, type ShiftBlock } from "./clinicalsupply";
import { dec } from "./format";

export type Agreements = "secured" | "secured+asked" | "any";
export type Ring = "Core" | "Ring 1" | "Ring 2" | "any";
export const RING_ORDER: Record<string, number> = { Core: 0, "Ring 1": 1, "Ring 2": 2, "Ring 3": 3, Outside: 4 };

export interface Policy {
  /** Which site agreements may host learners. */
  agreements: Agreements;
  /** May a section land on a different shift block than its session says? */
  flexibleShift: boolean;
  /** May a section move ± this many days inside the same week? 0 = exact date. */
  flexibleDays: 0 | 1 | 2;
  /** Farthest drive ring allowed. */
  maxRing: Ring;
  /** Keep a section at the same site across the whole course (strong preference). */
  continuity: boolean;
  /** Prefer the least-loaded site (balance) over the closest / most secured. */
  spread: boolean;
  /** A slot only counts if the site has a free preceptor person for it. */
  requirePreceptor: boolean;
  /** Leave sessions that fall on an observed holiday unplaced (they need moving). */
  skipHolidays: boolean;
  /** When no single site can seat a whole section on one shift, may it split across sites? Preceptor-led sections can (students are 1:1 anyway); an instructor-led group travels together. */
  split: "none" | "preceptor-led" | "any";

  // ── Students: where each student can go, and the breadth of what they see ──
  /** Farthest a site may be from a student's home, in drive minutes (null = no cap; students with no known home are unaffected). */
  maxStudentDriveMin: number | null;
  /** Prefer sites nearer each student's home over sites nearer campus. */
  preferCloserToStudent: boolean;
  /** With continuity on: stay at one site this many weeks, then prefer a different site (null = the whole course at one site). */
  rotateSitesEveryWeeks: number | null;
  /** Prefer a site the student has not been to in this plan. */
  varietySites: boolean;
  /** Prefer a facility type (acute-care hospital, imaging center, clinic …) the student has not seen. */
  varietyFacilityTypes: boolean;
  /** Prefer a health system the student has not been in. */
  varietySystems: boolean;

  // ── Preceptors: always at their own employer; how long they keep a student, how much they carry ──
  /** Shifts in a row a student keeps the same preceptor before rotating to another at the site (null = as long as possible — evaluations need a stretch). */
  preceptorStint: number | null;
  /** When choosing between free preceptors, prefer one the student has not had. */
  varietyPreceptors: boolean;
  /** A preceptor's ceiling of student shifts in one week (null = no ceiling). */
  maxPreceptorShiftsPerWeek: number | null;
  /** Students one preceptor may take on a shift; null = whatever the session says it needs. */
  studentsPerPreceptor: number | null;
}
/** Bookings and placements written by an applied plan carry this note, so they can be replaced without touching hand-made ones. */
export const AUTO_PLAN_NOTE = "auto-plan";
export const DEFAULT_POLICY: Policy = {
  agreements: "secured", flexibleShift: false, flexibleDays: 0, maxRing: "any", continuity: true, spread: false, requirePreceptor: false, skipHolidays: true, split: "preceptor-led",
  maxStudentDriveMin: null, preferCloserToStudent: true, rotateSitesEveryWeeks: null, varietySites: false, varietyFacilityTypes: false, varietySystems: false,
  preceptorStint: null, varietyPreceptors: false, maxPreceptorShiftsPerWeek: null, studentsPerPreceptor: null,
};

export interface DemandUnit {
  id: string;              // `${sessionId}|${sectionIndex}|${date}`
  cohortId: string; cohort: string; programId: string; program: string; familyId: string | null;
  courseId: string | null; courseCode: string | null; courseTitle: string; termIndex: number; termName: string; weekOfTerm: number;
  sessionId: string; sessionTitle: string | null; sectionIndex: number; sectionCount: number;
  date: string; weekMonday: string; block: ShiftBlock; startTime: string | null; hours: number;
  /** The date the weekly pattern puts this shift on — the key a per-occurrence move is filed under (date differs once a hand-made move applies). */
  originalDate: string;
  rotationType: string; settingCode: string | null;
  seats: number; preceptorsNeeded: number; facultyNeeded: number; clinicalMode: string | null;
  /** The session's students-per-section ceiling — seat numbers map to sections with it: section = ceil(seat ÷ seatsPerSection). */
  seatsPerSection: number;
  holiday: string | null; moved: boolean;
}

export interface Preceptor { id: string; name: string; employerId: string | null; role: string }
export interface Instructor { id: string; name: string; role: string }
export interface StudentLite {
  id: string; name: string; cohortId: string; sectionIndex: number;
  /** Where the student lives (a town), when known. */
  homeLabel?: string | null;
  /** Estimated drive minutes from the student's home to each site (employerId → minutes); absent when the home is unknown. */
  driveTo?: Record<string, number>;
}
export interface FamilyAgreement { familyId: string; employerId: string; agreementStatus: string }
/** One campus class or lab occurrence: the cohort's students are on campus then, so no clinical can land on them. */
export interface CampusBlock { cohortId: string; date: string; startMin: number; endMin: number; label: string }

export interface SchedulerInput {
  demand: DemandUnit[];
  /** Campus classes and labs, dated — a clinical never moves onto a day the cohort is in class, and never overlaps one on its own day. */
  campus?: CampusBlock[];
  assets: AssetLite[];
  overrides: AssetDayOverride[];
  /** Bookings already on the books that are NOT part of this plan (they consume seats). */
  existingBookings: AssetBookingLite[];
  preceptors: Preceptor[];
  instructors: Instructor[];
  students: StudentLite[];
  familyAgreements: FamilyAgreement[];
  policy: Policy;
}

export type UnmetReason = "holiday" | "class-day" | "unmapped-setting" | "no-asset-for-setting" | "no-agreement" | "ring" | "drive" | "closed-that-day" | "full" | "too-big" | "no-preceptor";
export const REASON_LABEL: Record<UnmetReason, string> = {
  "too-big": "no single site has enough seats of this setting on one shift for a section this size",
  holiday: "lands on an observed holiday — needs moving",
  "class-day": "overlaps a class or lab the cohort is in that day — students can't be in two places",
  drive: "every allowed site is farther than the students' drive cap from home",
  "unmapped-setting": "rotation type isn't mapped to an asset setting",
  "no-asset-for-setting": "no partner reports an asset of this setting",
  "no-agreement": "the only sites with this setting aren't under an allowed agreement",
  ring: "the only sites with this setting are beyond the allowed drive ring",
  "closed-that-day": "no asset of this setting runs that shift on that date",
  full: "every open asset is already full that shift",
  "no-preceptor": "no free preceptor at any open site that shift",
};

export interface Assignment {
  unit: DemandUnit;
  /** Lead asset (first part) — a section may spread across several rooms at the same site and shift. */
  assetId: string; asset: AssetLite;
  parts: { assetId: string; asset: AssetLite; seats: number }[];
  /** When a section is split across sites: this piece covers section seats (seatOffset, seatOffset + seats]. */
  seatOffset: number; splitOf: number;
  employerId: string; siteName: string;
  date: string; block: ShiftBlock; seats: number; hours: number;
  movedDays: number; changedBlock: boolean;
  preceptorIds: string[]; preceptorNames: string[]; instructorId: string | null; instructorName: string | null;
  score: number; reason: string;
}
export interface Unmet { unit: DemandUnit; reason: UnmetReason; fixes: string[] }

export interface SettingBalance {
  settingCode: string; setting: string; rotationTypes: string[];
  demandShifts: number; demandHours: number; demandSeats: number;
  supplyShiftsPhysical: number; supplyShiftsAllowed: number; supplyHoursAllowed: number; seatsAllowed: number;
  placedShifts: number; placedSeats: number; unmetShifts: number; utilization: number; verdict: "fits" | "tight" | "short" | "none";
}
export interface SiteLoad {
  employerId: string; siteName: string; agreementStatus: string; ring: string | null; county: string | null;
  assets: number; slotSeats: number; usedSeats: number; utilization: number;
  sections: number; learnerShifts: number; hours: number; cohorts: string[]; settings: string[];
  preceptorsOnHand: number; preceptorsPeak: number; preceptorShort: number;
}
export interface WeekCell { weekMonday: string; settingCode: string; demand: number; placed: number; unmet: number; supply: number }
export interface Bottleneck { key: string; settingCode: string; weekMonday: string; block: ShiftBlock | "any"; reason: UnmetReason; shifts: number; seats: number; cohorts: string[]; fixes: string[] }
export interface StudentRoster { student: StudentLite; cohort: string; stops: { siteName: string; from: string; to: string; shifts: number; hours: number; settings: string[] }[] }
/** What the plan gives one student: how many places, kinds of place, systems and preceptors they see, and how far they drive. */
export interface StudentStat {
  student: StudentLite; cohort: string; shifts: number; sites: number; facilityTypes: string[]; systems: number; settings: string[];
  preceptors: number; longestPreceptorRun: number; avgDriveMin: number | null; maxDriveMin: number | null; shiftsOverCap: number;
}
/** What the plan asks of one preceptor: always at their own employer, how many shifts, the busiest week, how many students. */
export interface PreceptorStat { id: string; name: string; employerId: string | null; siteName: string | null; shifts: number; peakWeek: number; students: number; sites: number; overCapWeeks: number }

export interface Plan {
  policy: Policy;
  assignments: Assignment[];
  unmet: Unmet[];
  balance: SettingBalance[];
  sites: SiteLoad[];
  weeks: WeekCell[];
  bottlenecks: Bottleneck[];
  rosters: StudentRoster[];
  studentStats: StudentStat[];
  preceptorStats: PreceptorStat[];
  summary: { demandShifts: number; demandSeats: number; demandHours: number; placedShifts: number; placedSeats: number; placedHours: number; unmetShifts: number; placedShare: number; supplySeatsAllowed: number; supplySeatsPhysical: number; preceptorShifts: number; preceptorsAssigned: number; instructorShifts: number; instructorsAssigned: number; sitesUsed: number; statement: string };
}

const BLOCKS: ShiftBlock[] = ["Day", "Evening", "Night"];
/** Which section (1-based) a seat number falls in when sections hold `seatsPerSection` students each. */
export const sectionOfSeat = (seat: number, seatsPerSection: number) => Math.max(1, Math.ceil(Math.max(1, seat) / Math.max(1, seatsPerSection)));
const num = (v: number) => dec(v);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const mondayOf = (iso: string) => isoAdd(iso, -((new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7));

// ── 1. Demand units from the capacity model ──────────────────────────────────
export interface MoveLite { sessionId: string; sectionIndex: number; fromDate: string; toDate: string; startTime: string | null }

/** One unit per SECTION of every dated clinical shift; per-occurrence moves applied. */
export function demandUnits(rows: DatedInstance[], rotations: RotationCode[], moves: MoveLite[] = [], familyByCohort: Record<string, string | null> = {}): DemandUnit[] {
  const codeOf = new Map(rotations.map((r) => [r.rotationType.toLowerCase(), r.settingCode]));
  const moveKey = (sid: string, sec: number, d: string) => `${sid}|${sec}|${d}`;
  const mv = new Map(moves.map((m) => [moveKey(m.sessionId, m.sectionIndex, m.fromDate), m]));
  const out: DemandUnit[] = [];
  for (const r of rows) {
    if (r.session.kind !== "CLINICAL" || !r.dateIso) continue;
    const Y = Math.max(0, Math.round(r.computed.Y ?? 0));
    const C = Math.max(0, Math.round(r.computed.C ?? 0));
    if (Y === 0 || C === 0) continue;
    const rt = r.session.rotationType?.trim() || "(unspecified)";
    const per = Math.max(1, r.session.maxStudents ?? 1);
    let left = C;
    for (let sec = 1; sec <= Y; sec++) {
      const seats = Math.max(1, Math.min(per, left)); left -= seats;
      const m = mv.get(moveKey(r.session.id, sec, r.dateIso));
      const date = m?.toDate ?? r.dateIso;
      const startTime = m?.startTime ?? r.session.startTime ?? null;
      out.push({
        id: `${r.session.id}|${sec}|${r.dateIso}`,
        cohortId: r.cohortId, cohort: r.cohort, programId: r.programId, program: r.program, familyId: familyByCohort[r.cohortId] ?? null,
        courseId: r.courseId, courseCode: r.courseCode, courseTitle: r.courseTitle, termIndex: r.termIndex, termName: r.termName, weekOfTerm: r.weekOfTerm,
        sessionId: r.session.id, sessionTitle: r.session.title ?? null, sectionIndex: sec, sectionCount: Y,
        date, weekMonday: mondayOf(date), block: shiftBlockOf(startTime), startTime, hours: r.session.lengthHours ?? 0, originalDate: r.dateIso,
        rotationType: rt, settingCode: codeOf.get(rt.toLowerCase()) ?? null,
        seats, preceptorsNeeded: Math.max(0, r.session.preceptorsNeeded ?? 0), facultyNeeded: Math.max(0, r.session.facultyNeeded ?? 0), clinicalMode: r.session.clinicalMode ?? null,
        seatsPerSection: per,
        holiday: m ? null : r.holiday, moved: !!m,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || BLOCKS.indexOf(a.block) - BLOCKS.indexOf(b.block) || a.cohort.localeCompare(b.cohort) || a.sectionIndex - b.sectionIndex);
}

// ── 2. The placement engine ──────────────────────────────────────────────────
interface Slot { asset: AssetLite; date: string; block: ShiftBlock; free: number; used: number }
const slotKey = (assetId: string, date: string, block: string) => `${assetId}|${date}|${block}`;

const agreementOk = (status: string, pol: Agreements) => pol === "any" ? status !== "declined" : pol === "secured+asked" ? status === "secured" || status === "asked" : status === "secured";
const ringOk = (ring: string | null | undefined, max: Ring) => max === "any" || (RING_ORDER[ring ?? "Outside"] ?? 9) <= RING_ORDER[max];
const AGREEMENT_SCORE: Record<string, number> = { secured: 50, asked: 12, prospect: 4, none: 0, declined: -999 };

export function recommendPlan(input: SchedulerInput): Plan {
  const { assets, overrides, policy } = input;
  const ov = overrideIndex(overrides);
  const live = assets.filter((a) => a.status !== "archived" && a.facilityStatus !== "archived");
  const famAgreement = new Map(input.familyAgreements.map((f) => [`${f.familyId}|${f.employerId}`, f.agreementStatus]));
  const agreementFor = (a: AssetLite, familyId: string | null) => (familyId && famAgreement.get(`${familyId}|${a.employerId}`)) || a.agreementStatus || "none";

  // Seats already taken by bookings outside this plan.
  const slots = new Map<string, Slot>();
  const slotFor = (a: AssetLite, date: string, block: ShiftBlock): Slot => {
    const k = slotKey(a.id, date, block);
    let s = slots.get(k);
    if (!s) { const used = input.existingBookings.filter((b) => b.assetId === a.id && b.date === date && b.block === block).reduce((n, b) => n + b.students, 0); s = { asset: a, date, block, free: Math.max(0, a.learnersPerShift - used), used }; slots.set(k, s); }
    return s;
  };
  const opens = (a: AssetLite, date: string, block: ShiftBlock) => blocksOn(a, date, ov.get(overrideKey(a.id, date))).includes(block);

  // Preceptor and instructor pools, by date × block.
  const preceptorsBySite = new Map<string, Preceptor[]>();
  for (const p of input.preceptors) if (p.employerId) { const l = preceptorsBySite.get(p.employerId) ?? []; l.push(p); preceptorsBySite.set(p.employerId, l); }
  const busy = new Map<string, Set<string>>(); // `${date}|${block}` → person ids in use
  const busyAt = (date: string, block: string) => { const k = `${date}|${block}`; let s = busy.get(k); if (!s) { s = new Set(); busy.set(k, s); } return s; };
  const freePreceptors = (employerId: string, date: string, block: string) => (preceptorsBySite.get(employerId) ?? []).filter((p) => !busyAt(date, block).has(p.id));

  // Site load, for the spread lever and the analytics.
  const siteUsed = new Map<string, number>();
  const siteCap = new Map<string, number>();
  for (const a of live) siteCap.set(a.employerId, (siteCap.get(a.employerId) ?? 0) + a.learnersPerShift);

  // Campus days: when the cohort is in class or lab. A clinical never MOVES onto such a day, and on
  // its own day it may only run if its hours don't overlap the class (a morning lab and an
  // evening shift can share a date; a day shift and a lab cannot).
  const campusByDay = new Map<string, CampusBlock[]>();
  for (const c of input.campus ?? []) { const k = `${c.cohortId}|${c.date}`; const l = campusByDay.get(k) ?? []; l.push(c); campusByDay.set(k, l); }
  const toMin = (t: string | null) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  const campusClash = (u: DemandUnit, date: string, block: ShiftBlock, moved: boolean): boolean => {
    const blocks = campusByDay.get(`${u.cohortId}|${date}`);
    if (!blocks?.length) return false;
    if (moved) return true;
    const start = block === u.block ? toMin(u.startTime) : block === "Day" ? 7 * 60 : block === "Evening" ? 15 * 60 : 23 * 60;
    if (start == null) return true;
    const end = start + Math.max(1, u.hours) * 60;
    return blocks.some((c) => start < c.endMin && c.startMin < end);
  };

  // Continuity memory: section (cohort|course|section) → employerId of its previous placements, and the weeks spent there.
  const home = new Map<string, Map<string, number>>();
  const homeWeeks = new Map<string, Map<string, Set<string>>>();
  const sectionKey = (u: DemandUnit) => `${u.cohortId}|${u.courseId ?? u.courseCode}|${u.sectionIndex}`;

  // The students in a section (seat numbers map to sections), and what each has seen so far in this plan:
  // sites, facility types, health systems and preceptors — the student-side levers score against these.
  const studentsCache = new Map<string, StudentLite[]>();
  const studentsOf = (u: DemandUnit): StudentLite[] => {
    const k = `${u.cohortId}|${u.seatsPerSection}|${u.sectionIndex}`;
    let l = studentsCache.get(k);
    if (!l) { l = input.students.filter((s) => s.cohortId === u.cohortId && sectionOfSeat(s.sectionIndex, u.seatsPerSection) === u.sectionIndex); studentsCache.set(k, l); }
    return l;
  };
  const seen = { sites: new Map<string, Set<string>>(), types: new Map<string, Set<string>>(), systems: new Map<string, Set<string>>(), preceptors: new Map<string, Map<string, number>>() };
  const seenSet = (m: Map<string, Set<string>>, id: string) => { let s = m.get(id); if (!s) { s = new Set(); m.set(id, s); } return s; };
  const lastPreceptor = new Map<string, { id: string; run: number }>(); // student → the preceptor they had last, and for how many shifts in a row
  const preceptorWeek = new Map<string, number>(); // `${preceptorId}|${weekMonday}` → shifts that week
  const driveOf = (stu: StudentLite[], employerId: string) => stu.map((s) => s.driveTo?.[employerId]).filter((n): n is number => n != null);

  /** A site's open assets of the unit's setting on one date × block, and the seats still free across them. */
  interface Pool { employerId: string; siteName: string; date: string; block: ShiftBlock; movedDays: number; assets: { a: AssetLite; slot: Slot }[]; free: number; used: number }
  interface Cand { pool: Pool; movedDays: number; changedBlock: boolean; score: number; reason: string }
  /** Candidates for a unit, plus the stage at which everything was eliminated (the unmet reason).
   *  A section is placed at ONE site on ONE shift, but may spread across that site's rooms. */
  const candidates = (u: DemandUnit, pol: Policy): { cands: Cand[]; partial: Cand[]; reason: UnmetReason | null; biggest: { site: string; seats: number } | null } => {
    if (pol.skipHolidays && u.holiday) return { cands: [], partial: [], reason: "holiday", biggest: null };
    if (!u.settingCode) return { cands: [], partial: [], reason: "unmapped-setting", biggest: null };
    let pool = live.filter((a) => a.settingCode === u.settingCode);
    if (!pool.length) return { cands: [], partial: [], reason: "no-asset-for-setting", biggest: null };
    pool = pool.filter((a) => agreementOk(agreementFor(a, u.familyId), pol.agreements));
    if (!pool.length) return { cands: [], partial: [], reason: "no-agreement", biggest: null };
    pool = pool.filter((a) => ringOk(a.ring, pol.maxRing));
    if (!pool.length) return { cands: [], partial: [], reason: "ring", biggest: null };
    const stu = studentsOf(u);
    if (pol.maxStudentDriveMin != null && stu.length) {
      const cap = pol.maxStudentDriveMin;
      pool = pool.filter((a) => driveOf(stu, a.employerId).every((m) => m <= cap));
      if (!pool.length) return { cands: [], partial: [], reason: "drive", biggest: null };
    }
    const dates: { date: string; movedDays: number }[] = [{ date: u.date, movedDays: 0 }];
    for (let d = 1; d <= pol.flexibleDays; d++) for (const sign of [-1, 1]) { const date = isoAdd(u.date, sign * d); if (mondayOf(date) === u.weekMonday) dates.push({ date, movedDays: sign * d }); }
    const blocks = pol.flexibleShift ? [u.block, ...BLOCKS.filter((b) => b !== u.block)] : [u.block];
    // Every date × block the cohort is free for: never a moved date the cohort is on campus, never an overlap on its own day.
    const free = dates.flatMap((d) => blocks.filter((b) => !campusClash(u, d.date, b, d.movedDays !== 0)).map((b) => ({ ...d, block: b })));
    if (!free.length) return { cands: [], partial: [], reason: "class-day", biggest: null };
    const pools = new Map<string, Pool>();
    for (const a of pool) for (const { date, movedDays, block: b } of free) {
      const d = { date, movedDays };
      if (!opens(a, d.date, b)) continue;
      const k = `${a.employerId}|${d.date}|${b}`;
      const P = pools.get(k) ?? { employerId: a.employerId, siteName: a.facilityName, date: d.date, block: b, movedDays: d.movedDays, assets: [], free: 0, used: 0 };
      const slot = slotFor(a, d.date, b);
      P.assets.push({ a, slot }); P.free += slot.free; P.used += slot.used;
      pools.set(k, P);
    }
    if (!pools.size) return { cands: [], partial: [], reason: "closed-that-day", biggest: null };
    // Structural ceiling: the most seats any one site has of this setting on one of these shifts, ignoring what is booked.
    const biggest = [...pools.values()].map((P) => ({ site: P.siteName, seats: P.assets.reduce((n, x) => n + x.a.learnersPerShift, 0) })).sort((a, b) => b.seats - a.seats)[0] ?? null;
    const staffedOk = (P: Pool) => !(pol.requirePreceptor && u.preceptorsNeeded > 0) || freePreceptors(P.employerId, P.date, P.block).length >= Math.ceil(u.preceptorsNeeded);
    const withRoom = [...pools.values()].filter((P) => P.free >= u.seats);
    const partialPools = [...pools.values()].filter((P) => P.free > 0 && P.free < u.seats && staffedOk(P));
    const prev = home.get(sectionKey(u));
    const prevWeeks = homeWeeks.get(sectionKey(u));
    const scoreOf = (P: Pool): Cand => {
      const lead = P.assets[0].a;
      const agreement = agreementFor(lead, u.familyId);
      const why: string[] = [];
      let score = 0;
      const cont = prev?.get(P.employerId) ?? 0;
      // Continuity keeps a section at its site — until the rotation cadence says it has had its stint there.
      const weeksHere = prevWeeks?.get(P.employerId);
      const stintDone = pol.rotateSitesEveryWeeks != null && !!weeksHere && !weeksHere.has(u.weekMonday) && weeksHere.size >= pol.rotateSitesEveryWeeks;
      if (pol.continuity && cont > 0 && !stintDone) { score += 100; why.push("same site as this section's earlier shifts"); }
      if (stintDone) { score -= 60; why.push(`${weeksHere!.size} weeks here already — rotation due`); }
      score += AGREEMENT_SCORE[agreement] ?? 0; why.push(`${agreement} agreement`);
      const ringPts = [30, 15, 5, 0, 0][RING_ORDER[lead.ring ?? "Outside"] ?? 4]; score += ringPts; if (lead.ring) why.push(lead.ring);
      if (stu.length) {
        // The students' own drive, and the breadth of what they have seen so far in this plan.
        const mins = driveOf(stu, P.employerId);
        if (pol.preferCloserToStudent && mins.length) { const avg = mins.reduce((n, m) => n + m, 0) / mins.length; score += Math.max(0, 30 - avg / 2); why.push(`${Math.round(avg)} min from home`); }
        if (pol.varietySites && stu.every((s) => !seen.sites.get(s.id)?.has(P.employerId))) { score += 25; why.push("a site the student has not been to"); }
        if (pol.varietyFacilityTypes && lead.facilityType && stu.every((s) => !seen.types.get(s.id)?.has(lead.facilityType!))) { score += 20; why.push(`first ${lead.facilityType.toLowerCase()}`); }
        if (pol.varietySystems && lead.organization && stu.every((s) => !seen.systems.get(s.id)?.has(lead.organization!))) { score += 15; why.push(`first time in ${lead.organization}`); }
      }
      if (P.movedDays === 0) score += 40; else why.push(`moved ${P.movedDays > 0 ? "+" : ""}${P.movedDays} day${Math.abs(P.movedDays) === 1 ? "" : "s"}`);
      if (P.block === u.block) score += 40; else why.push(`${P.block} shift instead of ${u.block}`);
      const load = (siteUsed.get(P.employerId) ?? 0) / Math.max(1, siteCap.get(P.employerId) ?? 1);
      score -= load * (pol.spread ? 80 : 15);
      const leftover = P.free - u.seats; score -= Math.min(leftover, 6) * 2;
      if (P.used > 0) { score += 8; why.push("fills a partly used shift"); }
      if (u.preceptorsNeeded > 0) { const fp = freePreceptors(P.employerId, P.date, P.block).length; if (fp >= Math.ceil(u.preceptorsNeeded)) { score += 10; why.push(`${fp} free preceptor${fp === 1 ? "" : "s"}`); } else score -= 25; }
      const roomsNeeded = (() => { let left = u.seats, n = 0; for (const x of [...P.assets].sort((p, q) => q.slot.free - p.slot.free)) { if (left <= 0) break; if (x.slot.free > 0) { left -= x.slot.free; n++; } } return n; })();
      if (roomsNeeded > 1) why.push(`across ${roomsNeeded} ${lead.assetType.toLowerCase()}s`);
      return { pool: P, movedDays: P.movedDays, changedBlock: P.block !== u.block, score, reason: why.join(" · ") };
    };
    const partial = partialPools.map(scoreOf).sort((x, y) => y.score - x.score || x.pool.siteName.localeCompare(y.pool.siteName));
    if (!withRoom.length) return { cands: [], partial, reason: biggest && biggest.seats < u.seats ? "too-big" : "full", biggest };
    const staffed = withRoom.filter(staffedOk);
    if (!staffed.length) return { cands: [], partial, reason: "no-preceptor", biggest };
    const cands: Cand[] = staffed.map(scoreOf);
    cands.sort((x, y) => y.score - x.score || x.pool.siteName.localeCompare(y.pool.siteName));
    return { cands, partial, reason: null, biggest };
  };

  // Constrained-first: fewest candidates first, then earliest date.
  const order = input.demand.map((u) => ({ u, n: candidates(u, policy).cands.length })).sort((a, b) => (a.n === 0 ? 1e9 : a.n) - (b.n === 0 ? 1e9 : b.n) || a.u.date.localeCompare(b.u.date) || a.u.sectionIndex - b.u.sectionIndex).map((x) => x.u);

  const assignments: Assignment[] = [];
  const unmet: Unmet[] = [];
  const instructorBusy = new Map<string, Set<string>>();
  const instBusyAt = (date: string, block: string) => { const k = `${date}|${block}`; let s = instructorBusy.get(k); if (!s) { s = new Set(); instructorBusy.set(k, s); } return s; };
  const instructorLoad = new Map<string, number>();
  const preceptorLoad = new Map<string, number>();

  const mayEverSplit = (u: DemandUnit) => policy.split === "any" || (policy.split === "preceptor-led" && u.facultyNeeded < 1 && !/instructor/i.test(u.clinicalMode ?? ""));
  /** Take `seats` from a pool's rooms, fullest-free first, and book the pieces. */
  const placeAt = (u: DemandUnit, best: Cand, seats: number, seatOffset: number, splitOf: number) => {
    const P = best.pool;
    const parts: Assignment["parts"] = [];
    let left = seats;
    for (const x of [...P.assets].sort((p, q) => q.slot.free - p.slot.free)) {
      if (left <= 0) break;
      const take = Math.min(left, x.slot.free);
      if (take <= 0) continue;
      x.slot.free -= take; x.slot.used += take; left -= take;
      parts.push({ assetId: x.a.id, asset: x.a, seats: take });
    }
    siteUsed.set(P.employerId, (siteUsed.get(P.employerId) ?? 0) + seats);
    const hm = home.get(sectionKey(u)) ?? new Map<string, number>(); hm.set(P.employerId, (hm.get(P.employerId) ?? 0) + 1); home.set(sectionKey(u), hm);
    const hw = homeWeeks.get(sectionKey(u)) ?? new Map<string, Set<string>>(); seenSet(hw, P.employerId).add(u.weekMonday); homeWeeks.set(sectionKey(u), hw);
    const stu = studentsOf(u).filter((s) => { const ord = s.sectionIndex - (u.sectionIndex - 1) * u.seatsPerSection; return ord > seatOffset && ord <= seatOffset + seats; });
    const lead0 = P.assets[0].a;
    for (const s of stu) { seenSet(seen.sites, s.id).add(P.employerId); if (lead0.facilityType) seenSet(seen.types, s.id).add(lead0.facilityType); if (lead0.organization) seenSet(seen.systems, s.id).add(lead0.organization); }
    // Preceptors — always people OF this site, never from another employer. One per preceptor needed
    // (or per N students under the ratio lever), under the weekly ceiling; the student keeps the same
    // preceptor through a stint, then rotates; least-loaded first; a new face if the lever says so.
    const need = u.preceptorsNeeded > 0 ? Math.max(Math.ceil(u.preceptorsNeeded), policy.studentsPerPreceptor ? Math.ceil(seats / policy.studentsPerPreceptor) : 0) : 0;
    const underWeekCap = (p: Preceptor) => policy.maxPreceptorShiftsPerWeek == null || (preceptorWeek.get(`${p.id}|${u.weekMonday}`) ?? 0) < policy.maxPreceptorShiftsPerWeek;
    const affinity = (p: Preceptor) => {
      let pts = 0;
      for (const s of stu) {
        const last = lastPreceptor.get(s.id);
        if (last?.id === p.id) pts += policy.preceptorStint != null && last.run >= policy.preceptorStint ? -3 : 3; // keep through the stint, then rotate
        else if (policy.varietyPreceptors && (seen.preceptors.get(s.id)?.get(p.id) ?? 0) > 0) pts -= 1;
      }
      return pts;
    };
    const picks = freePreceptors(P.employerId, P.date, P.block).filter(underWeekCap).sort((a, b) => affinity(b) - affinity(a) || (preceptorLoad.get(a.id) ?? 0) - (preceptorLoad.get(b.id) ?? 0) || a.name.localeCompare(b.name)).slice(0, need);
    for (const p of picks) {
      busyAt(P.date, P.block).add(p.id); preceptorLoad.set(p.id, (preceptorLoad.get(p.id) ?? 0) + 1);
      preceptorWeek.set(`${p.id}|${u.weekMonday}`, (preceptorWeek.get(`${p.id}|${u.weekMonday}`) ?? 0) + 1);
    }
    const leadP = picks[0];
    for (const s of stu) {
      for (const p of picks) { let m = seen.preceptors.get(s.id); if (!m) { m = new Map(); seen.preceptors.set(s.id, m); } m.set(p.id, (m.get(p.id) ?? 0) + 1); }
      if (leadP) { const last = lastPreceptor.get(s.id); lastPreceptor.set(s.id, last?.id === leadP.id ? { id: leadP.id, run: last.run + 1 } : { id: leadP.id, run: 1 }); }
    }
    // Instructor: a whole person only when the session needs at least one (fractional oversight is counted, not assigned).
    let instructor: Instructor | null = null;
    if (u.facultyNeeded >= 1) {
      instructor = input.instructors.filter((i) => !instBusyAt(P.date, P.block).has(i.id)).sort((a, b) => (instructorLoad.get(a.id) ?? 0) - (instructorLoad.get(b.id) ?? 0) || a.name.localeCompare(b.name))[0] ?? null;
      if (instructor) { instBusyAt(P.date, P.block).add(instructor.id); instructorLoad.set(instructor.id, (instructorLoad.get(instructor.id) ?? 0) + 1); }
    }
    const lead = parts[0].asset;
    assignments.push({
      unit: u, assetId: lead.id, asset: lead, parts, seatOffset, splitOf, employerId: P.employerId, siteName: P.siteName,
      date: P.date, block: P.block, seats, hours: shiftHours(lead, P.block) || u.hours,
      movedDays: best.movedDays, changedBlock: best.changedBlock,
      preceptorIds: picks.map((p) => p.id), preceptorNames: picks.map((p) => p.name), instructorId: instructor?.id ?? null, instructorName: instructor?.name ?? null,
      score: best.score, reason: splitOf > 1 ? `split ${seatOffset + 1}–${seatOffset + seats} of ${u.seats} seats · ${best.reason}` : best.reason,
    });
  };

  for (const u of order) {
    const { cands, partial, reason } = candidates(u, policy);
    if (cands.length) { placeAt(u, cands[0], u.seats, 0, 1); continue; }
    // No single site can take the whole section — split it across sites if the policy allows.
    if ((reason === "full" || reason === "too-big") && mayEverSplit(u) && partial.length) {
      let left = u.seats, offset = 0;
      const pieces: { cand: Cand; seats: number }[] = [];
      for (const c of partial) { if (left <= 0) break; const take = Math.min(left, c.pool.free); if (take > 0) { pieces.push({ cand: c, seats: take }); left -= take; } }
      for (const pc of pieces) { placeAt(u, pc.cand, pc.seats, offset, pieces.length + (left > 0 ? 1 : 0)); offset += pc.seats; }
      if (left > 0) unmet.push({ unit: { ...u, seats: left, id: `${u.id}|rest` }, reason: "full", fixes: fixesFor({ ...u, seats: left }, "full", candidates) });
      continue;
    }
    unmet.push({ unit: u, reason: reason ?? "full", fixes: fixesFor(u, reason ?? "full", candidates) });
  }
  assignments.sort((a, b) => a.date.localeCompare(b.date) || BLOCKS.indexOf(a.block) - BLOCKS.indexOf(b.block) || a.unit.cohort.localeCompare(b.unit.cohort) || a.unit.sectionIndex - b.unit.sectionIndex);
  unmet.sort((a, b) => a.unit.date.localeCompare(b.unit.date) || a.unit.cohort.localeCompare(b.unit.cohort));

  return analyze(input, live, assignments, unmet);
}

/** What would place this unit: try each relaxation of the policy in turn. */
function fixesFor(u: DemandUnit, reason: UnmetReason, candidates: (u: DemandUnit, pol: Policy) => { cands: unknown[]; reason: UnmetReason | null; biggest: { site: string; seats: number } | null }): string[] {
  const fixes: string[] = [];
  if (reason === "too-big") {
    const b = candidates(u, { ...DEFAULT_POLICY, agreements: "any", maxRing: "any" }).biggest;
    fixes.push(`a ${u.seats}-student section needs ${u.seats} ${u.settingCode} seats at one site on one shift; the largest site has ${b?.seats ?? 0}${b ? ` (${b.site})` : ""} — lower students per section on this session, raise learners per shift on the rooms, or let preceptor-led sections split across sites`);
  }
  if (reason === "holiday") return ["move this shift off the holiday (design & sequence — this offering)"];
  if (reason === "class-day") {
    for (const t of [{ label: "allow ± 1 day inside the week", pol: { flexibleDays: 1 as const } }, { label: "allow ± 2 days inside the week", pol: { flexibleDays: 2 as const } }, { label: "allow a different shift block", pol: { flexibleShift: true } }]) if (candidates(u, { ...DEFAULT_POLICY, ...t.pol }).cands.length > 0) fixes.push(t.label);
    fixes.push("move the class or lab off this shift's hours, or put the clinical on a day the cohort is not on campus (design & sequence — this offering)");
    return fixes;
  }
  if (reason === "unmapped-setting") return [`map rotation type "${u.rotationType}" to an asset setting (Insights → Clinical sites → Rotation → setting)`];
  if (reason === "no-asset-for-setting") return [`ask a partner to add an asset of setting ${u.settingCode} on the supply map`];
  if (reason === "drive") return ["raise the students' drive cap, or drop it", "secure a site of this setting nearer these students' homes"];
  const base: Policy = { ...DEFAULT_POLICY };
  const tries: { label: string; pol: Partial<Policy> }[] = [
    { label: "count sites that have been asked (not only secured)", pol: { agreements: "secured+asked" } },
    { label: "count any partner with the asset, agreement or not", pol: { agreements: "any" } },
    { label: "allow a different shift block", pol: { flexibleShift: true } },
    { label: "allow ± 1 day inside the week", pol: { flexibleDays: 1 } },
    { label: "allow ± 2 days inside the week", pol: { flexibleDays: 2 } },
    { label: "allow any drive ring", pol: { maxRing: "any" } },
    { label: "do not require a free preceptor", pol: { requirePreceptor: false } },
    { label: "any agreement + any shift + ± 2 days", pol: { agreements: "any", flexibleShift: true, flexibleDays: 2, maxRing: "any", requirePreceptor: false } },
  ];
  for (const t of tries) { if (candidates(u, { ...base, ...t.pol }).cands.length > 0) { fixes.push(t.label); if (fixes.length >= 3) break; } }
  if (!fixes.length) fixes.push(`add capacity: another ${u.settingCode ?? "matching"} asset open on ${weekdayOfIso(u.date)} ${u.block} shifts, or more learners per shift`);
  return fixes;
}

// ── 3. Analytics layers ──────────────────────────────────────────────────────
function analyze(input: SchedulerInput, live: AssetLite[], assignments: Assignment[], unmet: Unmet[]): Plan {
  const { policy } = input;
  const ov = overrideIndex(input.overrides);
  const famAgreement = new Map(input.familyAgreements.map((f) => [`${f.familyId}|${f.employerId}`, f.agreementStatus]));
  const dates = [...new Set(input.demand.map((u) => u.date))].sort();
  const from = dates[0], to = dates[dates.length - 1];
  const allowedAsset = (a: AssetLite, familyId: string | null) => agreementOk((familyId && famAgreement.get(`${familyId}|${a.employerId}`)) || a.agreementStatus || "none", policy.agreements) && ringOk(a.ring, policy.maxRing);
  const families = [...new Set(input.demand.map((u) => u.familyId))];

  // Supply over the demand window, by setting (physical and allowed).
  const supplyBySetting = new Map<string, { physShifts: number; allowedShifts: number; allowedHours: number; seatsAllowed: number; setting: string }>();
  if (from && to) for (const a of live) {
    const s = supplyBySetting.get(a.settingCode) ?? { physShifts: 0, allowedShifts: 0, allowedHours: 0, seatsAllowed: 0, setting: a.setting };
    const allowed = families.some((f) => allowedAsset(a, f));
    for (let d = from; d <= to; d = isoAdd(d, 1)) for (const b of blocksOn(a, d, ov.get(overrideKey(a.id, d)))) { s.physShifts++; if (allowed) { s.allowedShifts++; s.allowedHours += shiftHours(a, b); s.seatsAllowed += a.learnersPerShift; } }
    supplyBySetting.set(a.settingCode, s);
  }

  const codes = [...new Set([...input.demand.map((u) => u.settingCode ?? "(unmapped)"), ...supplyBySetting.keys()])].sort((a, b) => a.localeCompare(b));
  const balance: SettingBalance[] = codes.map((code) => {
    const ds = input.demand.filter((u) => (u.settingCode ?? "(unmapped)") === code);
    const as = assignments.filter((x) => (x.unit.settingCode ?? "(unmapped)") === code);
    const um = unmet.filter((x) => (x.unit.settingCode ?? "(unmapped)") === code);
    const sup = supplyBySetting.get(code);
    const demandSeats = ds.reduce((n, u) => n + u.seats, 0);
    const utilization = sup && sup.seatsAllowed > 0 ? as.reduce((n, x) => n + x.seats, 0) / sup.seatsAllowed : 0;
    const verdict: SettingBalance["verdict"] = ds.length === 0 ? "none" : um.length > 0 ? "short" : utilization > 0.85 ? "tight" : "fits";
    return {
      settingCode: code, setting: sup?.setting ?? live.find((a) => a.settingCode === code)?.setting ?? code, rotationTypes: [...new Set(ds.map((u) => u.rotationType))],
      demandShifts: ds.length, demandHours: ds.reduce((n, u) => n + u.hours * u.seats, 0), demandSeats,
      supplyShiftsPhysical: sup?.physShifts ?? 0, supplyShiftsAllowed: sup?.allowedShifts ?? 0, supplyHoursAllowed: sup?.allowedHours ?? 0, seatsAllowed: sup?.seatsAllowed ?? 0,
      placedShifts: as.length, placedSeats: as.reduce((n, x) => n + x.seats, 0), unmetShifts: um.length, utilization, verdict,
    };
  }).sort((a, b) => b.demandShifts - a.demandShifts);

  // Sites.
  const siteMap = new Map<string, SiteLoad>();
  for (const a of live) {
    const s = siteMap.get(a.employerId) ?? { employerId: a.employerId, siteName: a.facilityName, agreementStatus: a.agreementStatus ?? "none", ring: a.ring ?? null, county: a.county ?? null, assets: 0, slotSeats: 0, usedSeats: 0, utilization: 0, sections: 0, learnerShifts: 0, hours: 0, cohorts: [], settings: [], preceptorsOnHand: input.preceptors.filter((p) => p.employerId === a.employerId).length, preceptorsPeak: 0, preceptorShort: 0 };
    s.assets++;
    if (from && to) for (let d = from; d <= to; d = isoAdd(d, 1)) s.slotSeats += blocksOn(a, d, ov.get(overrideKey(a.id, d))).length * a.learnersPerShift;
    siteMap.set(a.employerId, s);
  }
  const perSiteShift = new Map<string, number>();
  for (const x of assignments) {
    const s = siteMap.get(x.employerId)!;
    s.usedSeats += x.seats; s.sections++; s.learnerShifts += x.seats; s.hours += x.hours * x.seats;
    if (!s.cohorts.includes(x.unit.cohort)) s.cohorts.push(x.unit.cohort);
    if (!s.settings.includes(x.unit.settingCode ?? "?")) s.settings.push(x.unit.settingCode ?? "?");
    const k = `${x.employerId}|${x.date}|${x.block}`; perSiteShift.set(k, (perSiteShift.get(k) ?? 0) + Math.ceil(x.unit.preceptorsNeeded));
  }
  for (const [k, need] of perSiteShift) { const s = siteMap.get(k.split("|")[0])!; s.preceptorsPeak = Math.max(s.preceptorsPeak, need); s.preceptorShort += Math.max(0, need - s.preceptorsOnHand); }
  const sites = [...siteMap.values()].map((s) => ({ ...s, utilization: s.slotSeats > 0 ? s.usedSeats / s.slotSeats : 0 })).sort((a, b) => b.learnerShifts - a.learnerShifts || a.siteName.localeCompare(b.siteName));

  // Week × setting cells.
  const weekMap = new Map<string, WeekCell>();
  const wk = (weekMonday: string, settingCode: string) => { const k = `${weekMonday}|${settingCode}`; let c = weekMap.get(k); if (!c) { c = { weekMonday, settingCode, demand: 0, placed: 0, unmet: 0, supply: 0 }; weekMap.set(k, c); } return c; };
  for (const u of input.demand) wk(u.weekMonday, u.settingCode ?? "(unmapped)").demand += u.seats;
  for (const x of assignments) wk(x.unit.weekMonday, x.unit.settingCode ?? "(unmapped)").placed += x.seats;
  for (const x of unmet) wk(x.unit.weekMonday, x.unit.settingCode ?? "(unmapped)").unmet += x.unit.seats;
  const weekMondays = [...new Set([...weekMap.values()].map((c) => c.weekMonday))].sort();
  for (const a of live) if (families.some((f) => allowedAsset(a, f))) for (const m of weekMondays) { let seats = 0; for (let i = 0; i < 7; i++) { const d = isoAdd(m, i); seats += blocksOn(a, d, ov.get(overrideKey(a.id, d))).length * a.learnersPerShift; } if (seats) wk(m, a.settingCode).supply += seats; }
  const weeks = [...weekMap.values()].sort((a, b) => a.weekMonday.localeCompare(b.weekMonday) || a.settingCode.localeCompare(b.settingCode));

  // Bottlenecks: unmet grouped by setting × week × reason, ranked by seats.
  const bMap = new Map<string, Bottleneck>();
  for (const x of unmet) {
    const k = `${x.unit.settingCode ?? "(unmapped)"}|${x.unit.weekMonday}|${x.reason}`;
    const b = bMap.get(k) ?? { key: k, settingCode: x.unit.settingCode ?? "(unmapped)", weekMonday: x.unit.weekMonday, block: x.unit.block, reason: x.reason, shifts: 0, seats: 0, cohorts: [], fixes: [] };
    b.shifts++; b.seats += x.unit.seats; if (b.block !== x.unit.block) b.block = "any";
    if (!b.cohorts.includes(x.unit.cohort)) b.cohorts.push(x.unit.cohort);
    for (const f of x.fixes) if (!b.fixes.includes(f)) b.fixes.push(f);
    bMap.set(k, b);
  }
  const bottlenecks = [...bMap.values()].sort((a, b) => b.seats - a.seats || a.weekMonday.localeCompare(b.weekMonday));

  // Student rosters: a student's seat number puts them in section ceil(seat ÷ seats-per-section)
  // of every clinical session, so they follow that section from site to site.
  const rosters: StudentRoster[] = [];
  const byCohort = new Map<string, Assignment[]>();
  for (const x of assignments) { const l = byCohort.get(x.unit.cohortId) ?? []; l.push(x); byCohort.set(x.unit.cohortId, l); }
  for (const st of input.students) {
    const xs = (byCohort.get(st.cohortId) ?? []).filter((x) => { if (sectionOfSeat(st.sectionIndex, x.unit.seatsPerSection) !== x.unit.sectionIndex) return false; const ord = st.sectionIndex - (x.unit.sectionIndex - 1) * x.unit.seatsPerSection; return ord > x.seatOffset && ord <= x.seatOffset + x.seats; }).slice().sort((a, b) => a.date.localeCompare(b.date));
    if (!xs.length) continue;
    const stops: StudentRoster["stops"] = [];
    for (const x of xs) {
      const last = stops[stops.length - 1];
      if (last && last.siteName === x.siteName) { last.to = x.date; last.shifts++; last.hours += x.hours; if (!last.settings.includes(x.unit.settingCode ?? "?")) last.settings.push(x.unit.settingCode ?? "?"); }
      else stops.push({ siteName: x.siteName, from: x.date, to: x.date, shifts: 1, hours: x.hours, settings: [x.unit.settingCode ?? "?"] });
    }
    rosters.push({ student: st, cohort: xs[0].unit.cohort, stops });
  }
  rosters.sort((a, b) => a.cohort.localeCompare(b.cohort) || a.student.sectionIndex - b.student.sectionIndex || a.student.name.localeCompare(b.student.name));

  // Per student: breadth (sites, facility types, systems, preceptors), preceptor continuity, and drive.
  const assetById = new Map(live.map((a) => [a.id, a]));
  const preceptorById = new Map(input.preceptors.map((p) => [p.id, p]));
  const studentStats: StudentStat[] = [];
  for (const st of input.students) {
    const xs = (byCohort.get(st.cohortId) ?? []).filter((x) => { if (sectionOfSeat(st.sectionIndex, x.unit.seatsPerSection) !== x.unit.sectionIndex) return false; const ord = st.sectionIndex - (x.unit.sectionIndex - 1) * x.unit.seatsPerSection; return ord > x.seatOffset && ord <= x.seatOffset + x.seats; }).slice().sort((a, b) => a.date.localeCompare(b.date));
    if (!xs.length) continue;
    const sites = new Set(xs.map((x) => x.employerId)); const types = new Set<string>(); const systems = new Set<string>(); const settings = new Set<string>(); const precs = new Set<string>();
    let run = 0, longest = 0, last: string | null = null;
    for (const x of xs) {
      const a = assetById.get(x.assetId); if (a?.facilityType) types.add(a.facilityType); if (a?.organization) systems.add(a.organization); settings.add(x.unit.settingCode ?? "?");
      for (const p of x.preceptorIds) precs.add(p);
      const lead = x.preceptorIds[0] ?? null; run = lead && lead === last ? run + 1 : lead ? 1 : 0; last = lead; longest = Math.max(longest, run);
    }
    const drives = xs.map((x) => st.driveTo?.[x.employerId]).filter((n): n is number => n != null);
    studentStats.push({
      student: st, cohort: xs[0].unit.cohort, shifts: xs.length, sites: sites.size, facilityTypes: [...types].sort(), systems: systems.size, settings: [...settings].sort(), preceptors: precs.size, longestPreceptorRun: longest,
      avgDriveMin: drives.length ? drives.reduce((n, m) => n + m, 0) / drives.length : null, maxDriveMin: drives.length ? Math.max(...drives) : null,
      shiftsOverCap: policy.maxStudentDriveMin != null ? drives.filter((m) => m > policy.maxStudentDriveMin!).length : 0,
    });
  }
  studentStats.sort((a, b) => a.cohort.localeCompare(b.cohort) || a.student.name.localeCompare(b.student.name));
  // Per preceptor: how much the plan asks of them, and that it never sends them anywhere but their own employer.
  const pMap = new Map<string, PreceptorStat & { weeks: Map<string, number>; studentIds: Set<string>; siteIds: Set<string> }>();
  for (const x of assignments) for (const pid of x.preceptorIds) {
    const p = preceptorById.get(pid);
    const s = pMap.get(pid) ?? { id: pid, name: p?.name ?? pid, employerId: p?.employerId ?? null, siteName: live.find((a) => a.employerId === p?.employerId)?.facilityName ?? null, shifts: 0, peakWeek: 0, students: 0, sites: 0, overCapWeeks: 0, weeks: new Map(), studentIds: new Set(), siteIds: new Set() };
    s.shifts++; s.weeks.set(x.unit.weekMonday, (s.weeks.get(x.unit.weekMonday) ?? 0) + 1); s.siteIds.add(x.employerId);
    for (const st of input.students) if (st.cohortId === x.unit.cohortId && sectionOfSeat(st.sectionIndex, x.unit.seatsPerSection) === x.unit.sectionIndex) s.studentIds.add(st.id);
    pMap.set(pid, s);
  }
  const preceptorStats: PreceptorStat[] = [...pMap.values()].map(({ weeks, studentIds, siteIds, ...s }) => ({ ...s, peakWeek: Math.max(0, ...weeks.values()), students: studentIds.size, sites: siteIds.size, overCapWeeks: policy.maxPreceptorShiftsPerWeek != null ? [...weeks.values()].filter((n) => n > policy.maxPreceptorShiftsPerWeek!).length : 0 })).sort((a, b) => b.shifts - a.shifts || a.name.localeCompare(b.name));

  const demandShifts = input.demand.length, demandSeats = input.demand.reduce((n, u) => n + u.seats, 0), demandHours = input.demand.reduce((n, u) => n + u.hours * u.seats, 0);
  const placedShifts = new Set(assignments.map((x) => x.unit.id)).size, placedSeats = assignments.reduce((n, x) => n + x.seats, 0), placedHours = assignments.reduce((n, x) => n + x.hours * x.seats, 0);
  const preceptorShifts = assignments.reduce((n, x) => n + Math.ceil(x.unit.preceptorsNeeded), 0);
  const preceptorsAssigned = assignments.reduce((n, x) => n + x.preceptorIds.length, 0);
  const instructorShifts = assignments.filter((x) => x.unit.facultyNeeded >= 1).length;
  const instructorsAssigned = assignments.filter((x) => x.instructorId).length;
  const supplySeatsAllowed = balance.reduce((n, b) => n + b.seatsAllowed, 0);
  const supplySeatsPhysical = [...supplyBySetting.values()].reduce((n, s) => n + s.physShifts, 0);
  const sitesUsed = new Set(assignments.map((x) => x.employerId)).size;
  const placedShare = demandSeats > 0 ? placedSeats / demandSeats : 0;
  const topReasons = (() => { const m = new Map<UnmetReason, number>(); for (const x of unmet) m.set(x.reason, (m.get(x.reason) ?? 0) + x.unit.seats); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3); })();
  const shortSettings = balance.filter((b) => b.verdict === "short").map((b) => b.settingCode);
  const statement = demandShifts === 0
    ? "No dated clinical shifts in this window — offerings need real term dates and clinical sessions before there is demand to place."
    : `${from === to ? `On ${from}` : `From ${from} to ${to}`}, ${num(demandShifts)} clinical sections (${num(demandSeats)} learner-shifts, ${num(demandHours)} learner-hours) need a home in ${balance.filter((b) => b.demandShifts > 0).length} settings. ` +
      `Under the current levers the plan places ${pct(placedShare)} of them — ${num(placedSeats)} learner-shifts across ${sitesUsed} site${sitesUsed === 1 ? "" : "s"}, ${num(preceptorsAssigned)} of ${num(preceptorShifts)} preceptor-shifts staffed by name` +
      (unmet.length ? `, and ${num(unmet.length)} sections (${num(demandSeats - placedSeats)} learner-shifts) unplaced: ${topReasons.map(([r, n]) => `${num(n)} because ${REASON_LABEL[r].split(" — ")[0]}`).join("; ")}.` : ", with nothing left over.") +
      (shortSettings.length ? ` Short settings: ${shortSettings.join(", ")}.` : "");

  return { policy, assignments, unmet, balance, sites, weeks, bottlenecks, rosters, studentStats, preceptorStats, summary: { demandShifts, demandSeats, demandHours, placedShifts, placedSeats, placedHours, unmetShifts: unmet.length, placedShare, supplySeatsAllowed, supplySeatsPhysical, preceptorShifts, preceptorsAssigned, instructorShifts, instructorsAssigned, sitesUsed, statement } };
}
