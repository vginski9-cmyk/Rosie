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
}
/** Bookings and placements written by an applied plan carry this note, so they can be replaced without touching hand-made ones. */
export const AUTO_PLAN_NOTE = "auto-plan";
export const DEFAULT_POLICY: Policy = { agreements: "secured", flexibleShift: false, flexibleDays: 0, maxRing: "any", continuity: true, spread: false, requirePreceptor: false, skipHolidays: true, split: "preceptor-led" };

export interface DemandUnit {
  id: string;              // `${sessionId}|${sectionIndex}|${date}`
  cohortId: string; cohort: string; programId: string; program: string; familyId: string | null;
  courseId: string | null; courseCode: string | null; courseTitle: string; termIndex: number; termName: string; weekOfTerm: number;
  sessionId: string; sessionTitle: string | null; sectionIndex: number; sectionCount: number;
  date: string; weekMonday: string; block: ShiftBlock; startTime: string | null; hours: number;
  rotationType: string; settingCode: string | null;
  seats: number; preceptorsNeeded: number; facultyNeeded: number; clinicalMode: string | null;
  /** The session's students-per-section ceiling — seat numbers map to sections with it: section = ceil(seat ÷ seatsPerSection). */
  seatsPerSection: number;
  holiday: string | null; moved: boolean;
}

export interface Preceptor { id: string; name: string; employerId: string | null; role: string }
export interface Instructor { id: string; name: string; role: string }
export interface StudentLite { id: string; name: string; cohortId: string; sectionIndex: number }
export interface FamilyAgreement { familyId: string; employerId: string; agreementStatus: string }

export interface SchedulerInput {
  demand: DemandUnit[];
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

export type UnmetReason = "holiday" | "unmapped-setting" | "no-asset-for-setting" | "no-agreement" | "ring" | "closed-that-day" | "full" | "too-big" | "no-preceptor";
export const REASON_LABEL: Record<UnmetReason, string> = {
  "too-big": "no single site has enough seats of this setting on one shift for a section this size",
  holiday: "lands on an observed holiday — needs moving",
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

export interface Plan {
  policy: Policy;
  assignments: Assignment[];
  unmet: Unmet[];
  balance: SettingBalance[];
  sites: SiteLoad[];
  weeks: WeekCell[];
  bottlenecks: Bottleneck[];
  rosters: StudentRoster[];
  summary: { demandShifts: number; demandSeats: number; demandHours: number; placedShifts: number; placedSeats: number; placedHours: number; unmetShifts: number; placedShare: number; supplySeatsAllowed: number; supplySeatsPhysical: number; preceptorShifts: number; preceptorsAssigned: number; instructorShifts: number; instructorsAssigned: number; sitesUsed: number; statement: string };
}

const BLOCKS: ShiftBlock[] = ["Day", "Evening", "Night"];
/** Which section (1-based) a seat number falls in when sections hold `seatsPerSection` students each. */
export const sectionOfSeat = (seat: number, seatsPerSection: number) => Math.max(1, Math.ceil(Math.max(1, seat) / Math.max(1, seatsPerSection)));
const num = (v: number) => Math.round(v).toLocaleString();
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
        date, weekMonday: mondayOf(date), block: shiftBlockOf(startTime), startTime, hours: r.session.lengthHours ?? 0,
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

  // Continuity memory: section (cohort|course|section) → employerId of its previous placements.
  const home = new Map<string, Map<string, number>>();
  const sectionKey = (u: DemandUnit) => `${u.cohortId}|${u.courseId ?? u.courseCode}|${u.sectionIndex}`;

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
    const dates: { date: string; movedDays: number }[] = [{ date: u.date, movedDays: 0 }];
    for (let d = 1; d <= pol.flexibleDays; d++) for (const sign of [-1, 1]) { const date = isoAdd(u.date, sign * d); if (mondayOf(date) === u.weekMonday) dates.push({ date, movedDays: sign * d }); }
    const blocks = pol.flexibleShift ? [u.block, ...BLOCKS.filter((b) => b !== u.block)] : [u.block];
    const pools = new Map<string, Pool>();
    for (const a of pool) for (const d of dates) for (const b of blocks) {
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
    const scoreOf = (P: Pool): Cand => {
      const lead = P.assets[0].a;
      const agreement = agreementFor(lead, u.familyId);
      const why: string[] = [];
      let score = 0;
      const cont = prev?.get(P.employerId) ?? 0;
      if (pol.continuity && cont > 0) { score += 100; why.push("same site as this section's earlier shifts"); }
      score += AGREEMENT_SCORE[agreement] ?? 0; why.push(`${agreement} agreement`);
      const ringPts = [30, 15, 5, 0, 0][RING_ORDER[lead.ring ?? "Outside"] ?? 4]; score += ringPts; if (lead.ring) why.push(lead.ring);
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
    // Preceptors: least-loaded free people at the site, one per preceptor needed.
    const need = Math.ceil(u.preceptorsNeeded);
    const picks = freePreceptors(P.employerId, P.date, P.block).sort((a, b) => (preceptorLoad.get(a.id) ?? 0) - (preceptorLoad.get(b.id) ?? 0) || a.name.localeCompare(b.name)).slice(0, need);
    for (const p of picks) { busyAt(P.date, P.block).add(p.id); preceptorLoad.set(p.id, (preceptorLoad.get(p.id) ?? 0) + 1); }
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
  if (reason === "unmapped-setting") return [`map rotation type "${u.rotationType}" to an asset setting (Insights → Clinical sites → Rotation → setting)`];
  if (reason === "no-asset-for-setting") return [`ask a partner to add an asset of setting ${u.settingCode} on the supply map`];
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

  return { policy, assignments, unmet, balance, sites, weeks, bottlenecks, rosters, summary: { demandShifts, demandSeats, demandHours, placedShifts, placedSeats, placedHours, unmetShifts: unmet.length, placedShare, supplySeatsAllowed, supplySeatsPhysical, preceptorShifts, preceptorsAssigned, instructorShifts, instructorsAssigned, sitesUsed, statement } };
}
