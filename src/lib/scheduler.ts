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
import { sectionSpans } from "./sections";
import { clinicalDemandRows } from "./clinicaldemand";
import { judgeExposure, unresolvedQuantities, describeRule } from "./settingrule";
import { supervisionFromLegacy, roleFinding, requiredRoles, type SupervisionSpec, type SupervisionRole } from "./supervision";
import { checkRequirement, checkSetting, checkCapability, checkAccess, checkCapacity, checkAvailability, checkSupervision, checkReadiness, evaluatePlacement, summarize, recommend, REASON_TEXT, type EvaluationResult, type PlacementEvaluation, type Check, type Reason, type ReasonCode, type LimitMode, type AvailabilityMode } from "./evaluate";
import { blocksOn, overrideIndex, overrideKey, shiftHours, shiftSpan, isoAdd, type AssetLite, type AssetDayOverride, type AssetBookingLite, type RotationCode } from "./assetmap";
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
  /** Farthest drive-time band allowed. */
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
  id: string;              // `${cohortId}|${sessionId}|${sectionIndex}|${date}`
  cohortId: string; cohort: string; programId: string; program: string; familyId: string | null;
  courseId: string | null; courseCode: string | null; courseTitle: string; termIndex: number; termName: string; weekOfTerm: number;
  sessionId: string; sessionTitle: string | null; sectionIndex: number; sectionCount: number;
  date: string; weekMonday: string; block: ShiftBlock; startTime: string | null; hours: number;
  /** The date the weekly pattern puts this shift on — the key a per-occurrence move is filed under (date differs once a hand-made move applies). */
  originalDate: string;
  rotationType: string;
  /** The PRIMARY setting (first eligible) — a label; the pool is `eligible`, from `rule`. */
  settingCode: string | null;
  rule: import("./settingrule").SettingRuleSpec | null; eligible: string[];
  seats: number; preceptorsNeeded: number; facultyNeeded: number; clinicalMode: string | null;
  /** The session's students-per-section ceiling (the template's max), kept for display. */
  seatsPerSection: number;
  /** The section's seat span: seats are dealt evenly across the session's sections (lib/sections), so seat numbers seatStart … seatStart+sectionSeats−1 sit here. */
  seatStart: number; sectionSeats: number;
  holiday: string | null; moved: boolean;
  /** The holiday rule moved this shift off the named holiday (its pattern date is `originalDate`). */
  holidayMoved: string | null;
  /** The session's explicit supervision model when one is stored or resolved; absent = derived from the staffing columns (never coerced). */
  supervision?: SupervisionSpec | null;
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
export interface FamilyAgreement { familyId: string; employerId: string; agreementStatus: string; /** ISO date the agreement ends; a placement after it is not agreement-eligible (Phase 5). */ agreementEnds?: string | null }
/** What a site may hold at once for a family (null = unknown, never unlimited) and which settings it has CONFIRMED it provides (Phase 5). */
export interface SiteCapacityLite {
  employerId: string; familyId: string | null; studentsAtOnce: number | null; approvedCapacity: number | null;
  /** What a blank students-at-once means: a known figure, explicitly unrestricted, or not known (the default — never unlimited, never zero). */
  studentsAtOnceMode?: "known" | "unrestricted" | "unknown" | null;
  /** How the site's availability to this family is expressed: inherit the assets' schedules, specific dates, unavailable, or not known. */
  availabilityMode?: "inherit" | "specific" | "unavailable" | "unknown" | null;
}
export interface ConfirmedSetting { employerId: string; settingCode: string }
/** The readiness funnel (Phase 5): every rung must hold for a placed shift to be ready. */
export interface Readiness { locationAssigned: boolean; agreementEligible: boolean; staffedByName: boolean; experienceSupported: boolean; conflictFree: boolean; ready: boolean; issues: string[] }
export type BlockerKind = "unsecured-site" | "holiday" | "over-capacity" | "unprecepted" | "student-overlap" | "experience-unconfirmed" | "requirement-unreviewed" | "setting-rule-unmet";
export interface Blocker { kind: BlockerKind; label: string; shifts: number; seats: number; blocking: boolean; examples: string[] }
/** One campus class or lab occurrence: the cohort's students are on campus then, so no clinical can land on them. */
export interface CampusBlock { cohortId: string; date: string; startMin: number; endMin: number; label: string }

export interface SchedulerInput {
  /** Site caps and confirmed settings (Phase 5); optional so exploratory runs and tests can omit them. */
  siteCaps?: SiteCapacityLite[];
  confirmedSettings?: ConfirmedSetting[];
  demand: DemandUnit[];
  /** Campus classes and labs, dated — a clinical never moves onto a day the cohort is in class, and never overlaps one on its own day. */
  campus?: CampusBlock[];
  /** Observed holidays (ISO date → label): a shift never moves onto one, and a shift that falls on one moves off it when the Day lever allows. */
  holidays?: Record<string, string>;
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

export type UnmetReason = "holiday" | "class-day" | "student-busy" | "unmapped-setting" | "no-asset-for-setting" | "no-agreement" | "ring" | "drive" | "closed-that-day" | "full" | "site-cap" | "too-big" | "no-preceptor" | "mixing-locked";
export const REASON_LABEL: Record<UnmetReason, string> = {
  "too-big": "no single site has enough seats of this setting on one shift for a section this size",
  holiday: "lands on an observed holiday — needs moving",
  "class-day": "overlaps a class or lab the cohort is in that day — students can't be in two places",
  "student-busy": "these students are already on another clinical shift then — students can't be in two places",
  drive: "every allowed site is farther than the students' drive cap from home",
  "unmapped-setting": "rotation type isn't mapped to an asset setting",
  "no-asset-for-setting": "no partner reports an asset of this setting",
  "no-agreement": "the only sites with this setting aren't under an allowed agreement",
  ring: "the only sites with this setting are beyond the allowed drive time",
  "closed-that-day": "no asset of this setting runs that shift on that date",
  full: "every open asset is already full that shift",
  "site-cap": "the site's approved students-at-once is reached that shift — rooms are free, the agreement is not",
  "no-preceptor": "no free preceptor at any open site that shift",
  "mixing-locked": "the rule keeps this rotation in one setting (hours may not be mixed, or that is not yet confirmed) and that setting has no seat",
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
  /** The instructor's hours on this shift: the whole shift (× whole people) when the session needs one present, the template's fraction of it when it gives oversight. */
  instructorHours: number;
  score: number; reason: string;
  /** Filled by analyze(): the readiness funnel for this placed shift. */
  readiness?: Readiness;
}
export interface Unmet { unit: DemandUnit; reason: UnmetReason; fixes: string[]; /** The specific sentence (Phase 5): "6 students unplaced Tue Aug 18 Day: remaining eligible sites (A, B) have no free preceptor 07:00–15:00". */ detail: string }

/** One setting's demand against its supply. Demand is attributed to the setting a section LANDED in (unplaced: its primary), so a rotation that may use several settings is never counted against one alone and the rows add up to the whole. */
export interface SettingBalance {
  settingCode: string; setting: string; rotationTypes: string[];
  demandShifts: number; demandHours: number; demandSeats: number;
  supplyShiftsPhysical: number; supplyShiftsAllowed: number; supplyHoursAllowed: number; seatsAllowed: number;
  /** Learner seats on every asset-shift in the window regardless of agreement or ring (the physical ceiling). */
  seatsPhysical: number;
  /** Of the allowed seats, those on a date and shift block this setting's demand actually uses (a shift block on a day no section needs cannot host anything); honours the Day and Shift levers. */
  seatsOnDemandDays: number;
  /** Allowed seats already taken by hand-made bookings in the window. */
  seatsBooked: number;
  /** seatsOnDemandDays − seatsBooked − demandSeats: the spare learner-shifts (negative = short before any placement is attempted). */
  headroom: number;
  placedShifts: number; placedSeats: number; unmetShifts: number; utilization: number; verdict: "fits" | "tight" | "short" | "none";
}
/** Supply against demand under the current levers, in learner-shifts (Phase 13). */
export interface CapacityHeadroom {
  demandSeats: number;
  /** Every asset-shift in the demand window at a site the Sites-that-count and Drive-ring levers allow, × learners per shift. */
  supplySeats: number;
  /** The same count at every live site, whatever its agreement or ring. */
  supplySeatsPhysical: number;
  /** Allowed seats on the dates and shift blocks demand uses (the honest ceiling: supply on a day nothing is scheduled cannot be used). */
  supplySeatsOnDemandDays: number;
  /** Allowed seats hand-made bookings already take. */
  supplySeatsBooked: number;
  /** Seats on the dates and shift blocks demand uses at EVERY live site, whatever its agreement or ring — what loosening the Sites-that-count and Drive-ring levers all the way would count. */
  supplySeatsPhysicalOnDemandDays: number;
  /** Of the allowed seats on demand days, those a preceptor on the site's roster could cover: per site and shift, preceptors on hand × students per preceptor (the Students-per-preceptor lever, else each asset's own ratio). An estimate of the staffed ceiling. */
  supplySeatsStaffableOnDemandDays: number;
  /** Of the allowed seats on demand days, those that LINE UP with the demand: per date and shift block (per week, and across blocks, when the Day and Shift
   *  levers let a shift move), the seats in the settings that day's sections may use — each site capped at its approved students-at-once — but never more
   *  than that day's demand. The tightest ceiling: placed can never exceed it, and the gap between the two is class-day and holiday clashes, sections too
   *  big for one site, and the order shifts were placed in. A seat on a day nothing needs it does not count here. */
  supplySeatsLinedUp: number;
  /** supplySeatsLinedUp with each site × date × block further capped by the preceptors on the site's roster × students per preceptor
   *  (the Students-per-preceptor lever, else the mean of the contributing rooms' own learners ÷ preceptors per shift). Never above supplySeatsLinedUp. */
  supplySeatsLinedUpStaffable: number;
  /** supplySeatsLinedUp counted at EVERY live site, whatever its agreement or drive band (each site still at its students-at-once where known)
   *  — what loosening the Sites-that-count and Drive-time levers all the way could unlock. Never below supplySeatsLinedUp. */
  supplySeatsLinedUpEverySite: number;
  /** supplySeats − demandSeats. */
  headroom: number;
  /** supplySeatsOnDemandDays − supplySeatsBooked − demandSeats. */
  headroomOnDemandDays: number;
  /** supplySeats ÷ demandSeats (null with no demand). */
  ratio: number | null;
  /** supplySeatsOnDemandDays ÷ demandSeats (null with no demand). */
  ratioOnDemandDays: number | null;
  /** Settings demanded that have no allowed supply at all. */
  settingsWithoutSupply: string[];
  window: { from: string; to: string } | null;
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
  summary: { demandShifts: number; demandSeats: number; demandHours: number; placedShifts: number; placedSeats: number; placedHours: number; unmetShifts: number; placedShare: number; supplySeatsAllowed: number; supplySeatsPhysical: number; capacity: CapacityHeadroom; preceptorShifts: number; preceptorsAssigned: number; instructorShifts: number; instructorsAssigned: number; sitesUsed: number; statement: string;
    /** The readiness funnel in learner-shifts (Phase 5): location assigned → agreement eligible → staffed by name → experience supported → conflict-free → ready. The headline is `ready`. */
    readiness: { locationAssigned: number; agreementEligible: number; staffedByName: number; experienceSupported: number; conflictFree: number; ready: number; readyShare: number } };
  /** What would block applying this plan (Phase 5): placements at unsecured sites, on holidays, over a site's cap, unprecepted. */
  blockers: Blocker[];
  /** The canonical evaluation (lib/evaluate): every placed and unplaced section judged on the same checks, with reason codes, counted by unique placement and by occurrence, plus the contract the numbers were produced under. */
  evaluation: PlanEvaluation;
}
export interface PlanEvaluation extends EvaluationResult {
  recommendations: ReturnType<typeof recommend>;
  /** Which supervision roles any section in the window requires — a lever or remedy about a role nobody needs is not shown. */
  rolesRequired: SupervisionRole[];
}

const BLOCKS: ShiftBlock[] = ["Day", "Evening", "Night"];
/** One rotation group = one cohort, section, course and rotation type — the scope a setting rule's minimums, mixing and continuity are judged over. */
const groupKey = (u: DemandUnit) => `${u.cohortId}|${u.sectionIndex}|${u.courseId ?? ""}|${u.rotationType.toLowerCase()}`;
/** Is this seat number in the unit's section? Seats are dealt evenly (lib/sections); the unit carries its span. */
const seatInUnit = (seat: number, u: { seatStart: number; sectionSeats: number }) => seat >= u.seatStart && seat < u.seatStart + u.sectionSeats;
const num = (v: number) => dec(v);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const mondayOf = (iso: string) => isoAdd(iso, -((new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7));

// ── 1. Demand units from the capacity model ──────────────────────────────────
export interface MoveLite { /** The offering the move belongs to — two offerings of one program share session ids, so a move is never applied across them. */ cohortId?: string; sessionId: string; sectionIndex: number; fromDate: string; toDate: string; startTime: string | null }

/** One unit per SECTION of every dated clinical shift; per-occurrence moves applied. */
export function demandUnits(rows: DatedInstance[], rotations: RotationCode[], moves: MoveLite[] = [], familyByCohort: Record<string, string | null> = {}, holidays: Record<string, string> = {}, courseRules: import("./clinicaldemand").CourseRules = {}): DemandUnit[] {
  const moveKey = (cid: string | undefined, sid: string, sec: number, d: string) => `${cid ?? ""}|${sid}|${sec}|${d}`;
  const mv = new Map(moves.map((m) => [moveKey(m.cohortId, m.sessionId, m.sectionIndex, m.fromDate), m]));
  const findMove = (cid: string, sid: string, sec: number, d: string) => mv.get(moveKey(cid, sid, sec, d)) ?? mv.get(moveKey(undefined, sid, sec, d));
  const out: DemandUnit[] = [];
  // One definition of dated clinical demand (lib/clinicaldemand) — site capacity starts from the same rows;
  // here each row is split into its sections, seats dealt in section order until the students are seated.
  for (const d of clinicalDemandRows(rows, rotations, courseRules)) {
    const r = d.row;
    const Y = d.sections, per = d.seatsPerSection;
    if (Y === 0 || d.students === 0) continue;
    const rt = d.rotationType;
    const spans = sectionSpans(d.students, Y);
    for (let sec = 1; sec <= Y; sec++) {
      const span = spans[sec - 1];
      if (!span || span.seats <= 0) continue;
      const seats = span.seats;
      // A hand-made move is filed under the pattern date; when the holiday rule already moved the shift, either key finds it.
      const patternIso = r.holidayMoved?.fromIso ?? d.dateIso;
      const m = findMove(r.cohortId, r.session.id, sec, d.dateIso) ?? (r.holidayMoved ? findMove(r.cohortId, r.session.id, sec, patternIso) : undefined);
      const date = m?.toDate ?? d.dateIso;
      const startTime = m?.startTime ?? r.session.startTime ?? null;
      out.push({
        // Two offerings of one program share session ids: the cohort is part of the identity.
        id: `${r.cohortId}|${r.session.id}|${sec}|${d.dateIso}`,
        cohortId: r.cohortId, cohort: r.cohort, programId: r.programId, program: r.program, familyId: familyByCohort[r.cohortId] ?? null,
        courseId: r.courseId, courseCode: r.courseCode, courseTitle: r.courseTitle, termIndex: r.termIndex, termName: r.termName, weekOfTerm: r.weekOfTerm,
        sessionId: r.session.id, sessionTitle: r.session.title ?? null, sectionIndex: sec, sectionCount: Y,
        date, weekMonday: mondayOf(date), block: shiftBlockOf(startTime), startTime, hours: r.session.lengthHours ?? 0, originalDate: patternIso,
        rotationType: rt, settingCode: d.settingCode, rule: d.rule, eligible: d.eligible,
        seats, preceptorsNeeded: Math.max(0, r.session.preceptorsNeeded ?? 0), facultyNeeded: Math.max(0, r.session.facultyNeeded ?? 0), clinicalMode: r.session.clinicalMode ?? null,
        seatsPerSection: per, seatStart: span.start, sectionSeats: span.seats,
        // A shift moved by hand or by the plan is checked against the calendar on its NEW date.
        holiday: m ? holidays[date] ?? null : r.holiday, moved: !!m, holidayMoved: r.holidayMoved?.holiday ?? null,
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
  const famEnds = new Map(input.familyAgreements.filter((f) => f.agreementEnds).map((f) => [`${f.familyId}|${f.employerId}`, f.agreementEnds as string]));
  /** The agreement that governs a site for a family on a date: the family's own wins over the institution's; one that has ended counts as none (Phase 5). */
  const agreementFor = (a: AssetLite, familyId: string | null, date?: string) => {
    const k = familyId ? `${familyId}|${a.employerId}` : null;
    const ends = k ? famEnds.get(k) : undefined;
    if (date && ends && date > ends) return "none";
    return (k && famAgreement.get(k)) || a.agreementStatus || "none";
  };

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

  // A site's students-at-once (what it may hold for a family, per shift) is a HARD limit while placing:
  // the seats a site still has for a family on a date × block are its assets' free seats, capped by
  // that limit less what this plan (and hand-made bookings on its assets) already put there.
  const capOf = new Map((input.siteCaps ?? []).map((c) => [`${c.familyId ?? ""}|${c.employerId}`, c]));
  const siteCapFor = (employerId: string, familyId: string | null): number | null => { const c = capOf.get(`${familyId ?? ""}|${employerId}`) ?? capOf.get(`|${employerId}`) ?? null; return c ? (c.studentsAtOnce ?? c.approvedCapacity) : null; };
  const atSite = new Map<string, number>(); // `${employerId}|${familyId}|${date}|${block}` → this family's learners placed there by this plan (the limit is the family's agreement)
  const assetOwner = new Map(assets.map((a) => [a.id, a.employerId]));
  const bookedAtSite = new Map<string, number>();
  for (const b of input.existingBookings) { const e = assetOwner.get(b.assetId); if (!e) continue; const k = `${e}|${b.date}|${b.block}`; bookedAtSite.set(k, (bookedAtSite.get(k) ?? 0) + b.students); }
  const siteRoom = (employerId: string, familyId: string | null, date: string, block: ShiftBlock): number | null => { const cap = siteCapFor(employerId, familyId); if (cap == null) return null; return Math.max(0, cap - (atSite.get(`${employerId}|${familyId ?? ""}|${date}|${block}`) ?? 0) - (bookedAtSite.get(`${employerId}|${date}|${block}`) ?? 0)); };

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
    // The shift's hours: its own start time on its own block, else the block's usual start (a shift with no
    // stated time is still a Day / Evening / Night shift, not "all day").
    const blockStart = block === "Day" ? 7 * 60 : block === "Evening" ? 15 * 60 : 23 * 60;
    const start = (block === u.block ? toMin(u.startTime) : null) ?? blockStart;
    const end = start + Math.max(1, u.hours) * 60;
    return blocks.some((c) => start < c.endMin && c.startMin < end);
  };

  // WHO IS ALREADY SOMEWHERE: the seat numbers of a cohort placed on each date × block by this plan. A student
  // is never placed twice at once — a second shift for the same seats on the same date and block is not a
  // candidate at all, whatever else it scores. (A hard rule, not a lever.)
  const seatsBusy = new Map<string, Set<number>>(); // `${cohortId}|${date}|${block}` → seat numbers placed
  const busySeatsAt = (cohortId: string, date: string, block: ShiftBlock) => { const k = `${cohortId}|${date}|${block}`; let s = seatsBusy.get(k); if (!s) { s = new Set(); seatsBusy.set(k, s); } return s; };
  const seatsOf = (u: DemandUnit, seatOffset = 0, seats = u.sectionSeats) => { const out: number[] = []; for (let i = 0; i < seats; i++) out.push(u.seatStart + seatOffset + i); return out; };
  const studentsBusy = (u: DemandUnit, date: string, block: ShiftBlock): boolean => { const b = seatsBusy.get(`${u.cohortId}|${date}|${block}`); return !!b && seatsOf(u).some((n) => b.has(n)); };
  // …and where the same students have a shift of their OWN on the calendar (placed yet or not), so a
  // moved shift never takes the date and block another of their shifts is meant to fill.
  const demandAt = new Map<string, DemandUnit[]>();
  for (const d of input.demand) { const k = `${d.cohortId}|${d.date}|${d.block}`; const l = demandAt.get(k) ?? []; l.push(d); demandAt.set(k, l); }
  const studentsDue = (u: DemandUnit, date: string, block: ShiftBlock): boolean => (demandAt.get(`${u.cohortId}|${date}|${block}`) ?? []).some((d) => d.id !== u.id && d.seatStart < u.seatStart + u.sectionSeats && u.seatStart < d.seatStart + d.sectionSeats);

  // Continuity memory: section (cohort|course|section) → employerId of its previous placements, and the weeks spent there.
  const home = new Map<string, Map<string, number>>();
  const homeWeeks = new Map<string, Map<string, Set<string>>>();
  const sectionKey = (u: DemandUnit) => `${u.cohortId}|${u.courseId ?? u.courseCode}|${u.sectionIndex}`;

  // The students in a section (seat numbers map to sections), and what each has seen so far in this plan:
  // sites, facility types, health systems and preceptors — the student-side levers score against these.
  const studentsCache = new Map<string, StudentLite[]>();
  const studentsOf = (u: DemandUnit): StudentLite[] => {
    const k = `${u.cohortId}|${u.seatStart}|${u.sectionSeats}`;
    let l = studentsCache.get(k);
    if (!l) { l = input.students.filter((s) => s.cohortId === u.cohortId && seatInUnit(s.sectionIndex, u)); studentsCache.set(k, l); }
    return l;
  };
  const seen = { sites: new Map<string, Set<string>>(), types: new Map<string, Set<string>>(), systems: new Map<string, Set<string>>(), preceptors: new Map<string, Map<string, number>>() };
  const seenSet = (m: Map<string, Set<string>>, id: string) => { let s = m.get(id); if (!s) { s = new Set(); m.set(id, s); } return s; };
  const lastPreceptor = new Map<string, { id: string; run: number }>(); // student → the preceptor they had last, and for how many shifts in a row
  const preceptorWeek = new Map<string, number>(); // `${preceptorId}|${weekMonday}` → shifts that week
  const driveOf = (stu: StudentLite[], employerId: string) => stu.map((s) => s.driveTo?.[employerId]).filter((n): n is number => n != null);

  /** A site's open assets of the unit's setting on one date × block, and the seats still free across them. */
  /** `free` is what the site may still take (rooms, then the site's students-at-once); `roomFree` the rooms alone, so a cap that binds is named as the reason. */
  interface Pool { employerId: string; siteName: string; date: string; block: ShiftBlock; movedDays: number; assets: { a: AssetLite; slot: Slot }[]; free: number; roomFree: number; used: number }
  interface Cand { pool: Pool; movedDays: number; changedBlock: boolean; score: number; reason: string }
  /** Candidates for a unit, plus the stage at which everything was eliminated (the unmet reason).
   *  A section is placed at ONE site on ONE shift, but may spread across that site's rooms. */
  type CandResult = { cands: Cand[]; partial: Cand[]; reason: UnmetReason | null; biggest: { site: string; seats: number } | null; /** Sites still eligible at the stage everything was eliminated (Phase 5). */ eligible: string[] };
  const sitesOf = (pool: AssetLite[]) => [...new Set(pool.map((a) => a.facilityName))].sort();
  // ── The setting rule while placing (groupKey: one cohort, section, course and rotation type). ──
  /** Groups whose hours may not be split across settings (forbidden, or not yet confirmed — treated as not permitted and said so). */
  const lockKey = (u: DemandUnit) => (u.rule && u.rule.mixing !== "allowed" && u.eligible.length > 1 ? groupKey(u) : null);
  const settingLock = new Map<string, string>();
  const hoursBySetting = new Map<string, Map<string, number>>();
  const minimumsShort = (u: DemandUnit): string[] => {
    if (!u.rule) return [];
    const placed = hoursBySetting.get(groupKey(u));
    const r = u.rule.rule;
    const mins: { setting: string; quantity: number }[] = r.kind === "all-of" ? r.components.map((c) => ({ setting: c.setting, quantity: c.quantity ?? 0 })) : r.kind === "pool" ? r.minimums : r.kind === "n-of" && r.minimumEach != null ? r.settings.map((x) => ({ setting: x, quantity: r.minimumEach ?? 0 })) : [];
    if (r.kind === "n-of") { const met = mins.filter((m) => (placed?.get(m.setting) ?? 0) >= m.quantity).length; if (met >= r.count) return []; return mins.filter((m) => (placed?.get(m.setting) ?? 0) < m.quantity).map((m) => m.setting); }
    return mins.filter((m) => m.quantity > 0 && (placed?.get(m.setting) ?? 0) < m.quantity).map((m) => m.setting);
  };
  const candidates = (u: DemandUnit, pol: Policy): CandResult => {
    const r = candidatesInner(u, pol);
    // A holiday shift that found nowhere else in its week is still "on a holiday, needs moving": that is the
    // fix the reader can make, and the seat shortage on the other days is the reason it could not move itself.
    if (pol.skipHolidays && u.holiday && !r.cands.length && r.reason && r.reason !== "holiday") return { ...r, reason: "holiday", partial: [] };
    // Locked into one setting by the mixing rule and out of seats there: the binding constraint is the rule, not the room count.
    const lk = lockKey(u);
    if (lk && settingLock.has(lk) && !r.cands.length && r.reason && ["closed-that-day", "full", "site-cap", "too-big", "no-asset-for-setting", "no-agreement", "ring"].includes(r.reason)) return { ...r, reason: "mixing-locked", partial: [] };
    return r;
  };
  const candidatesInner = (u: DemandUnit, pol: Policy): CandResult => {
    const none = (reason: UnmetReason, eligible: string[] = []): CandResult => ({ cands: [], partial: [], reason, biggest: null, eligible });
    // A shift on an observed holiday: left for moving with the Day lever at exact dates; with ± days it moves
    // off the holiday inside its week (never onto another holiday) like any other move.
    const onHoliday = !!(pol.skipHolidays && u.holiday);
    if (onHoliday && pol.flexibleDays === 0) return none("holiday");
    if (!u.rule || !u.eligible.length) return none("unmapped-setting");
    // Every setting the rule allows is eligible — an alternative is an alternative for the SAME demand.
    let pool = live.filter((a) => u.eligible.includes(a.settingCode));
    if (!pool.length) return none("no-asset-for-setting");
    // Hours that may not be mixed (or not yet confirmed as mixable) stay in the setting this rotation started in.
    const lk = lockKey(u); const lockedTo = lk ? settingLock.get(lk) : undefined;
    if (lockedTo) { pool = pool.filter((a) => a.settingCode === lockedTo); if (!pool.length) return none("mixing-locked"); }
    // A minimum still short in one setting: that setting first — while a FREE seat of it exists on this shift. Once its
    // seats are taken the other eligible settings take the section (the minimum can still be met on another day);
    // refusing them would leave empty eligible seats beside unplaced students.
    const short = minimumsShort(u);
    let before = sitesOf(pool);
    pool = pool.filter((a) => agreementOk(agreementFor(a, u.familyId, u.date), pol.agreements));
    if (!pool.length) return none("no-agreement", before);
    before = sitesOf(pool);
    pool = pool.filter((a) => ringOk(a.ring, pol.maxRing));
    if (!pool.length) return none("ring", before);
    const stu = studentsOf(u);
    if (pol.maxStudentDriveMin != null && stu.length) {
      const cap = pol.maxStudentDriveMin;
      before = sitesOf(pool);
      pool = pool.filter((a) => driveOf(stu, a.employerId).every((m) => m <= cap));
      if (!pool.length) return none("drive", before);
    }
    const eligibleSites = sitesOf(pool);
    const dates: { date: string; movedDays: number }[] = onHoliday ? [] : [{ date: u.date, movedDays: 0 }];
    for (let d = 1; d <= pol.flexibleDays; d++) for (const sign of [-1, 1]) { const date = isoAdd(u.date, sign * d); if (mondayOf(date) === u.weekMonday && !(pol.skipHolidays && input.holidays?.[date])) dates.push({ date, movedDays: sign * d }); }
    if (!dates.length) return none("holiday");
    const blocks = pol.flexibleShift ? [u.block, ...BLOCKS.filter((b) => b !== u.block)] : [u.block];
    // Every date × block the cohort is free for: never a moved date the cohort is on campus, never an overlap on its own day.
    const notInClass = dates.flatMap((d) => blocks.filter((b) => !campusClash(u, d.date, b, d.movedDays !== 0)).map((b) => ({ ...d, block: b })));
    if (!notInClass.length) return none("class-day", eligibleSites);
    // …and never one these students are already on another clinical shift for.
    const free = notInClass.filter((d) => !studentsBusy(u, d.date, d.block) && ((d.movedDays === 0 && d.block === u.block) || !studentsDue(u, d.date, d.block)));
    if (!free.length) return none("student-busy", eligibleSites);
    let pools = new Map<string, Pool>();
    for (const a of pool) for (const { date, movedDays, block: b } of free) {
      const d = { date, movedDays };
      if (!opens(a, d.date, b)) continue;
      // A pool is one site, one shift, ONE setting: a section's seats on a shift are credited to one setting (never a multi-tagged double credit).
      const k = `${a.employerId}|${d.date}|${b}|${a.settingCode}`;
      const P = pools.get(k) ?? { employerId: a.employerId, siteName: a.facilityName, date: d.date, block: b, movedDays: d.movedDays, assets: [], free: 0, roomFree: 0, used: 0 };
      const slot = slotFor(a, d.date, b);
      P.assets.push({ a, slot }); P.free += slot.free; P.roomFree += slot.free; P.used += slot.used;
      pools.set(k, P);
    }
    if (!pools.size) return none("closed-that-day", eligibleSites);
    // The site's students-at-once caps every pool at that site — never exceeded, whatever the rooms hold.
    for (const P of pools.values()) { const room = siteRoom(P.employerId, u.familyId, P.date, P.block); if (room != null && room < P.free) P.free = room; }
    // The short minimum's setting first, when a pool of it can still seat the whole section; otherwise every eligible setting competes.
    if (short.length) { const inShort = [...pools.entries()].filter(([, P]) => short.includes(P.assets[0].a.settingCode)); if (inShort.some(([, P]) => P.free >= u.seats)) pools = new Map(inShort); }
    // Structural ceiling: the most seats any one site has of this setting on one of these shifts, ignoring what is booked.
    const biggest = [...pools.values()].map((P) => ({ site: P.siteName, seats: P.assets.reduce((n, x) => n + x.a.learnersPerShift, 0) })).sort((a, b) => b.seats - a.seats)[0] ?? null;
    const staffedOk = (P: Pool) => !(pol.requirePreceptor && u.preceptorsNeeded > 0) || freePreceptors(P.employerId, P.date, P.block).length >= Math.ceil(u.preceptorsNeeded);
    const withRoom = [...pools.values()].filter((P) => P.free >= u.seats);
    const partialPools = [...pools.values()].filter((P) => P.free > 0 && P.free < u.seats && staffedOk(P));
    const prev = home.get(sectionKey(u));
    const prevWeeks = homeWeeks.get(sectionKey(u));
    const scoreOf = (P: Pool): Cand => {
      const lead = P.assets[0].a;
      const agreement = agreementFor(lead, u.familyId, P.date);
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
      if (short.includes(lead.settingCode)) { score += 20; why.push(`${lead.settingCode} minimum still to meet`); }
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
    // Rooms would have taken the section but the site's students-at-once would not: the cap is the reason, not the rooms.
    const cappedOut = !withRoom.length && [...pools.values()].some((P) => P.roomFree >= u.seats && P.free < u.seats);
    if (!withRoom.length) return { cands: [], partial, reason: biggest && biggest.seats < u.seats ? "too-big" : cappedOut ? "site-cap" : "full", biggest, eligible: [...new Set([...pools.values()].map((P) => P.siteName))].sort() };
    const staffed = withRoom.filter(staffedOk);
    if (!staffed.length) return { cands: [], partial, reason: "no-preceptor", biggest, eligible: [...new Set(withRoom.map((P) => P.siteName))].sort() };
    const cands: Cand[] = staffed.map(scoreOf);
    cands.sort((x, y) => y.score - x.score || x.pool.siteName.localeCompare(y.pool.siteName));
    return { cands, partial, reason: null, biggest, eligible: [...new Set(staffed.map((P) => P.siteName))].sort() };
  };

  // Constrained-first: fewest candidates first, then earliest date. A shift that is only moving because it
  // fell on a holiday goes last of all: it takes the seats left over, never a regular shift's own seat.
  const displaced = (u: DemandUnit) => (policy.skipHolidays && u.holiday ? 1 : 0);
  const order = input.demand.map((u) => ({ u, n: candidates(u, policy).cands.length })).sort((a, b) => displaced(a.u) - displaced(b.u) || (a.n === 0 ? 1e9 : a.n) - (b.n === 0 ? 1e9 : b.n) || a.u.date.localeCompare(b.u.date) || a.u.sectionIndex - b.u.sectionIndex).map((x) => x.u);

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
    { const k = `${P.employerId}|${u.familyId ?? ""}|${P.date}|${P.block}`; atSite.set(k, (atSite.get(k) ?? 0) + seats); }
    { const lk2 = lockKey(u); const code = parts[0].asset.settingCode; if (lk2 && !settingLock.has(lk2)) settingLock.set(lk2, code); const hb = hoursBySetting.get(groupKey(u)) ?? new Map<string, number>(); hb.set(code, (hb.get(code) ?? 0) + (shiftHours(parts[0].asset, P.block) || u.hours)); hoursBySetting.set(groupKey(u), hb); }
    for (const n of seatsOf(u, seatOffset, seats)) busySeatsAt(u.cohortId, P.date, P.block).add(n);
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
    const lead = parts[0].asset;
    // Instructor of record: whenever the template gives the shift faculty time. A whole person (facultyNeeded ≥ 1) is on the
    // shift and on nothing else then; a fraction (a precepted rotation's oversight) names the least-loaded instructor without
    // tying them up — one instructor oversees many precepted learners at once. Load is the hours each carries.
    let instructor: Instructor | null = null;
    const wholePerson = u.facultyNeeded >= 1;
    const instructorHours = wholePerson ? (shiftHours(lead0, P.block) || u.hours) * Math.ceil(u.facultyNeeded) : u.facultyNeeded > 0 ? (shiftHours(lead0, P.block) || u.hours) * u.facultyNeeded : 0;
    if (u.facultyNeeded > 0) {
      instructor = input.instructors.filter((i) => !wholePerson || !instBusyAt(P.date, P.block).has(i.id)).sort((a, b) => (instructorLoad.get(a.id) ?? 0) - (instructorLoad.get(b.id) ?? 0) || a.name.localeCompare(b.name))[0] ?? null;
      if (instructor) { if (wholePerson) instBusyAt(P.date, P.block).add(instructor.id); instructorLoad.set(instructor.id, (instructorLoad.get(instructor.id) ?? 0) + instructorHours); }
    }
    assignments.push({
      unit: u, assetId: lead.id, asset: lead, parts, seatOffset, splitOf, employerId: P.employerId, siteName: P.siteName,
      date: P.date, block: P.block, seats, hours: shiftHours(lead, P.block) || u.hours,
      movedDays: best.movedDays, changedBlock: best.changedBlock,
      preceptorIds: picks.map((p) => p.id), preceptorNames: picks.map((p) => p.name), instructorId: instructor?.id ?? null, instructorName: instructor?.name ?? null, instructorHours,
      score: best.score, reason: splitOf > 1 ? `split ${seatOffset + 1}–${seatOffset + seats} of ${u.seats} seats · ${best.reason}` : best.reason,
    });
  };

  for (const u of order) {
    const { cands, partial, reason, eligible } = candidates(u, policy);
    if (cands.length) { placeAt(u, cands[0], u.seats, 0, 1); continue; }
    // No single site can take the whole section — split it across sites if the policy allows.
    if ((reason === "full" || reason === "site-cap" || reason === "too-big") && mayEverSplit(u) && partial.length) {
      let left = u.seats, offset = 0;
      const pieces: { cand: Cand; seats: number }[] = [];
      for (const c of partial) { if (left <= 0) break; const take = Math.min(left, c.pool.free); if (take > 0) { pieces.push({ cand: c, seats: take }); left -= take; } }
      for (const pc of pieces) { placeAt(u, pc.cand, pc.seats, offset, pieces.length + (left > 0 ? 1 : 0)); offset += pc.seats; }
      if (left > 0) { const rest = { ...u, seats: left, id: `${u.id}|rest` }; unmet.push({ unit: rest, reason: "full", fixes: fixesFor(rest, "full", candidates), detail: unmetDetail(rest, "full", eligible, live) }); }
      continue;
    }
    unmet.push({ unit: u, reason: reason ?? "full", fixes: fixesFor(u, reason ?? "full", candidates), detail: unmetDetail(u, reason ?? "full", eligible, live) });
  }
  assignments.sort((a, b) => a.date.localeCompare(b.date) || BLOCKS.indexOf(a.block) - BLOCKS.indexOf(b.block) || a.unit.cohort.localeCompare(b.unit.cohort) || a.unit.sectionIndex - b.unit.sectionIndex);
  unmet.sort((a, b) => a.unit.date.localeCompare(b.unit.date) || a.unit.cohort.localeCompare(b.unit.cohort));

  return analyze(input, live, assignments, unmet);
}

/** The specific sentence for an unplaced shift (Phase 5): who, when, and what the remaining eligible sites lack. */
function unmetDetail(u: DemandUnit, reason: UnmetReason, eligible: string[], live: AssetLite[]): string {
  const when = `${weekdayOfIso(u.date)} ${u.date}${u.block ? ` ${u.block}` : ""}`;
  const span = (() => { const a = live.find((x) => x.settingCode === u.settingCode); return a ? shiftSpan(a, u.block) : null; })();
  const who = `${num(u.seats)} student${u.seats === 1 ? "" : "s"} of ${u.cohort} (${u.courseCode ?? u.courseTitle} §${u.sectionIndex}) unplaced ${when}`;
  const sites = eligible.length ? `${eligible.length === 1 ? "the remaining eligible site" : `the ${eligible.length} remaining eligible sites`} (${eligible.slice(0, 4).join(", ")}${eligible.length > 4 ? ", …" : ""})` : "no eligible site";
  switch (reason) {
    case "no-preceptor": return `${who}: ${sites} ${eligible.length === 1 ? "has" : "have"} no confirmed supervision free${span ? ` ${span}` : ""}.`;
    case "full": return `${who}: ${sites} ${eligible.length === 1 ? "is" : "are"} already full that shift${span ? ` (${span})` : ""}.`;
    case "site-cap": return `${who}: ${sites} ${eligible.length === 1 ? "has" : "have"} free rooms that shift but ${eligible.length === 1 ? "its" : "their"} approved students-at-once is already reached.`;
    case "too-big": return `${who}: ${sites} cannot seat a section of ${num(u.seats)} on one shift.`;
    case "closed-that-day": return `${who}: ${sites} run no ${u.settingCode} asset on that shift.`;
    case "no-agreement": return `${who}: the only sites with ${u.settingCode} (${eligible.slice(0, 3).join(", ")}) are not under an allowed agreement on that date.`;
    case "ring": return `${who}: the only sites with ${u.settingCode} (${eligible.slice(0, 3).join(", ")}) are beyond the allowed drive time.`;
    case "drive": return `${who}: every allowed site is farther than the students' drive cap from home.`;
    case "class-day": return `${who}: the cohort is in class or lab during that shift.`;
    case "student-busy": return `${who}: these students are already placed on another clinical shift then.`;
    case "holiday": return `${who}: ${u.holiday ?? "an observed holiday"} — the shift needs moving${eligible.length ? `, and no other day that week under the Day lever has a free seat at ${sites}` : ""}.`;
    case "unmapped-setting": return `${who}: rotation type "${u.rotationType}" is not mapped to an asset setting.`;
    case "no-asset-for-setting": return `${who}: no partner reports an asset of setting ${u.eligible.length ? u.eligible.join(" / ") : u.settingCode}.`;
    case "mixing-locked": return `${who}: this rotation's hours may not be split across settings (or that is not yet confirmed), so they stay in ${u.rule ? "the setting it started in" : "one setting"} — which has no free seat that shift.`;
  }
}

/** What would place this unit: try each relaxation of the policy in turn. */
function fixesFor(u: DemandUnit, reason: UnmetReason, candidates: (u: DemandUnit, pol: Policy) => { cands: unknown[]; reason: UnmetReason | null; biggest: { site: string; seats: number } | null }): string[] {
  const fixes: string[] = [];
  if (reason === "mixing-locked") fixes.push(u.rule?.mixing === "unknown" ? `confirm whether hours may be mixed across ${u.eligible.join(" / ")} (the rule for "${u.rotationType}")` : `the rule for "${u.rotationType}" forbids mixing settings — add seats in the setting this rotation started in`);
  if (reason === "site-cap") fixes.push("raise the site's approved students-at-once for this program (Clinical site capacity), or secure another site of this setting");
  if (reason === "too-big") {
    const b = candidates(u, { ...DEFAULT_POLICY, agreements: "any", maxRing: "any" }).biggest;
    fixes.push(`a ${u.seats}-student section needs ${u.seats} ${u.settingCode} seats at one site on one shift; the largest site has ${b?.seats ?? 0}${b ? ` (${b.site})` : ""} — lower students per section on this session, raise learners per shift on the rooms, or let preceptor-led sections split across sites`);
  }
  if (reason === "holiday") {
    const fixes: string[] = [];
    for (const t of [{ label: "allow ± 1 day inside the week", pol: { flexibleDays: 1 as const } }, { label: "allow ± 2 days inside the week", pol: { flexibleDays: 2 as const } }]) if (candidates(u, { ...DEFAULT_POLICY, ...t.pol }).cands.length > 0) { fixes.push(t.label); break; }
    fixes.push("move this shift off the holiday (design & sequence — this offering)");
    return fixes;
  }
  if (reason === "class-day" || reason === "student-busy") {
    for (const t of [{ label: "allow ± 1 day inside the week", pol: { flexibleDays: 1 as const } }, { label: "allow ± 2 days inside the week", pol: { flexibleDays: 2 as const } }, { label: "allow a different shift block", pol: { flexibleShift: true } }]) if (candidates(u, { ...DEFAULT_POLICY, ...t.pol }).cands.length > 0) fixes.push(t.label);
    fixes.push(reason === "student-busy" ? "two clinical sessions put the same students on the same shift — move one to another day or shift block (design & sequence — this offering)" : "move the class or lab off this shift's hours, or put the clinical on a day the cohort is not on campus (design & sequence — this offering)");
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
    { label: "allow any drive time", pol: { maxRing: "any" } },
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
  const famEnds = new Map(input.familyAgreements.filter((f) => f.agreementEnds).map((f) => [`${f.familyId}|${f.employerId}`, f.agreementEnds as string]));
  const agreementFor = (a: AssetLite, familyId: string | null, date?: string) => {
    const k = familyId ? `${familyId}|${a.employerId}` : null;
    const ends = k ? famEnds.get(k) : undefined;
    if (date && ends && date > ends) return "none";
    return (k && famAgreement.get(k)) || a.agreementStatus || "none";
  };
  const dates = [...new Set(input.demand.map((u) => u.date))].sort();
  const from = dates[0], to = dates[dates.length - 1];
  const allowedAsset = (a: AssetLite, familyId: string | null) => agreementOk((familyId && famAgreement.get(`${familyId}|${a.employerId}`)) || a.agreementStatus || "none", policy.agreements) && ringOk(a.ring, policy.maxRing);
  const families = [...new Set(input.demand.map((u) => u.familyId))];

  // Supply over the demand window, by setting (physical and allowed).
  const supplyBySetting = new Map<string, { physShifts: number; allowedShifts: number; allowedHours: number; seatsAllowed: number; seatsPhysical: number; seatsOnDemandDays: number; seatsPhysicalOnDemandDays: number; seatsBooked: number; setting: string }>();
  // Staffable seats: per site × date × block, the allowed seats on demand days capped by the preceptors the site has on its roster.
  const preceptorsAtSite = new Map<string, number>();
  for (const p of input.preceptors) if (p.employerId) preceptorsAtSite.set(p.employerId, (preceptorsAtSite.get(p.employerId) ?? 0) + 1);
  const siteShiftSeats = new Map<string, { seats: number; ratioSum: number; n: number; employerId: string }>();
  // The date × shift block pairs each setting's demand uses, widened by the Day (± days) and Shift (any block) levers.
  // A section's slots count for EVERY setting its rule allows — a pool over GEN / ED / PORT / OR / FLUORO / CT can use any of
  // them, so the supply "on demand days" is the seats in all of those settings, not the primary one alone.
  const demandSlots = new Map<string, Set<string>>();
  for (const u of input.demand) {
    for (const code of u.eligible.length ? u.eligible : [u.settingCode ?? "(unmapped)"]) {
      const set = demandSlots.get(code) ?? new Set<string>();
      for (let dd = -policy.flexibleDays; dd <= policy.flexibleDays; dd++) { const d = isoAdd(u.date, dd); for (const b of policy.flexibleShift ? BLOCKS : [u.block]) set.add(`${d}|${b}`); }
      demandSlots.set(code, set);
    }
  }
  if (from && to) for (const a of live) {
    const s = supplyBySetting.get(a.settingCode) ?? { physShifts: 0, allowedShifts: 0, allowedHours: 0, seatsAllowed: 0, seatsPhysical: 0, seatsOnDemandDays: 0, seatsPhysicalOnDemandDays: 0, seatsBooked: 0, setting: a.setting };
    const allowed = families.some((f) => allowedAsset(a, f));
    const slots = demandSlots.get(a.settingCode);
    for (let d = from; d <= to; d = isoAdd(d, 1)) for (const b of blocksOn(a, d, ov.get(overrideKey(a.id, d)))) {
      s.physShifts++; s.seatsPhysical += a.learnersPerShift;
      const onDemandDay = !!slots?.has(`${d}|${b}`);
      if (onDemandDay) s.seatsPhysicalOnDemandDays += a.learnersPerShift;
      if (allowed) {
        s.allowedShifts++; s.allowedHours += shiftHours(a, b); s.seatsAllowed += a.learnersPerShift;
        if (onDemandDay) {
          s.seatsOnDemandDays += a.learnersPerShift;
          const k = `${a.employerId}|${d}|${b}`; const ss = siteShiftSeats.get(k) ?? { seats: 0, ratioSum: 0, n: 0, employerId: a.employerId };
          ss.seats += a.learnersPerShift; ss.ratioSum += policy.studentsPerPreceptor ?? (a.learnersPerShift / Math.max(1, a.preceptorsPerShift || 1)); ss.n++; siteShiftSeats.set(k, ss);
        }
        s.seatsBooked += input.existingBookings.filter((k) => k.assetId === a.id && k.date === d && k.block === b).reduce((n, k) => n + k.students, 0);
      }
    }
    supplyBySetting.set(a.settingCode, s);
  }
  let supplySeatsStaffableOnDemandDays = 0;
  for (const ss of siteShiftSeats.values()) { const ratio = ss.n ? ss.ratioSum / ss.n : 1; supplySeatsStaffableOnDemandDays += Math.min(ss.seats, (preceptorsAtSite.get(ss.employerId) ?? 0) * ratio); }

  // Per setting, demand is attributed to the setting it LANDED in (a placed section to its seat's setting, an unplaced one to
  // its primary) — so a rotation that may use several settings is never counted against one of them alone, utilization never
  // exceeds the seats that were actually used, and the rows add up to the whole.
  const codes = [...new Set([...input.demand.map((u) => u.settingCode ?? "(unmapped)"), ...assignments.map((x) => x.asset.settingCode), ...supplyBySetting.keys()])].sort((a, b) => a.localeCompare(b));
  const balance: SettingBalance[] = codes.map((code) => {
    const as = assignments.filter((x) => x.asset.settingCode === code);
    const um = unmet.filter((x) => (x.unit.settingCode ?? "(unmapped)") === code);
    const ds = [...as.map((x) => x.unit), ...um.map((x) => x.unit)];
    const sup = supplyBySetting.get(code);
    const demandSeats = as.reduce((n, x) => n + x.seats, 0) + um.reduce((n, x) => n + x.unit.seats, 0);
    const utilization = sup && sup.seatsAllowed > 0 ? as.reduce((n, x) => n + x.seats, 0) / sup.seatsAllowed : 0;
    const verdict: SettingBalance["verdict"] = ds.length === 0 ? "none" : um.length > 0 ? "short" : utilization > 0.85 ? "tight" : "fits";
    return {
      settingCode: code, setting: sup?.setting ?? live.find((a) => a.settingCode === code)?.setting ?? code, rotationTypes: [...new Set(ds.map((u) => u.rotationType))],
      demandShifts: new Set(as.map((x) => x.unit.id)).size + um.length, demandHours: as.reduce((n, x) => n + x.hours * x.seats, 0) + um.reduce((n, x) => n + x.unit.hours * x.unit.seats, 0), demandSeats,
      supplyShiftsPhysical: sup?.physShifts ?? 0, supplyShiftsAllowed: sup?.allowedShifts ?? 0, supplyHoursAllowed: sup?.allowedHours ?? 0, seatsAllowed: sup?.seatsAllowed ?? 0,
      seatsPhysical: sup?.seatsPhysical ?? 0, seatsOnDemandDays: sup?.seatsOnDemandDays ?? 0, seatsBooked: sup?.seatsBooked ?? 0,
      headroom: (sup?.seatsOnDemandDays ?? 0) - (sup?.seatsBooked ?? 0) - demandSeats,
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
    if (!s.settings.includes(x.asset.settingCode)) s.settings.push(x.asset.settingCode);
    const k = `${x.employerId}|${x.date}|${x.block}`; perSiteShift.set(k, (perSiteShift.get(k) ?? 0) + Math.ceil(x.unit.preceptorsNeeded));
  }
  for (const [k, need] of perSiteShift) { const s = siteMap.get(k.split("|")[0])!; s.preceptorsPeak = Math.max(s.preceptorsPeak, need); s.preceptorShort += Math.max(0, need - s.preceptorsOnHand); }
  const sites = [...siteMap.values()].map((s) => ({ ...s, utilization: s.slotSeats > 0 ? s.usedSeats / s.slotSeats : 0 })).sort((a, b) => b.learnerShifts - a.learnerShifts || a.siteName.localeCompare(b.siteName));

  // Week × setting cells.
  const weekMap = new Map<string, WeekCell>();
  const wk = (weekMonday: string, settingCode: string) => { const k = `${weekMonday}|${settingCode}`; let c = weekMap.get(k); if (!c) { c = { weekMonday, settingCode, demand: 0, placed: 0, unmet: 0, supply: 0 }; weekMap.set(k, c); } return c; };
  // As with the balance: a placed section counts in the setting it landed in; an unplaced one in its primary.
  for (const x of assignments) { const c = wk(x.unit.weekMonday, x.asset.settingCode); c.placed += x.seats; c.demand += x.seats; }
  for (const x of unmet) { const c = wk(x.unit.weekMonday, x.unit.settingCode ?? "(unmapped)"); c.unmet += x.unit.seats; c.demand += x.unit.seats; }
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
    const xs = (byCohort.get(st.cohortId) ?? []).filter((x) => { if (!seatInUnit(st.sectionIndex, x.unit)) return false; const ord = st.sectionIndex - x.unit.seatStart + 1; return ord > x.seatOffset && ord <= x.seatOffset + x.seats; }).slice().sort((a, b) => a.date.localeCompare(b.date));
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
    const xs = (byCohort.get(st.cohortId) ?? []).filter((x) => { if (!seatInUnit(st.sectionIndex, x.unit)) return false; const ord = st.sectionIndex - x.unit.seatStart + 1; return ord > x.seatOffset && ord <= x.seatOffset + x.seats; }).slice().sort((a, b) => a.date.localeCompare(b.date));
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
    for (const st of input.students) if (st.cohortId === x.unit.cohortId && seatInUnit(st.sectionIndex, x.unit)) s.studentIds.add(st.id);
    pMap.set(pid, s);
  }
  const preceptorStats: PreceptorStat[] = [...pMap.values()].map(({ weeks, studentIds, siteIds, ...s }) => ({ ...s, peakWeek: Math.max(0, ...weeks.values()), students: studentIds.size, sites: siteIds.size, overCapWeeks: policy.maxPreceptorShiftsPerWeek != null ? [...weeks.values()].filter((n) => n > policy.maxPreceptorShiftsPerWeek!).length : 0 })).sort((a, b) => b.shifts - a.shifts || a.name.localeCompare(b.name));

  // ── Readiness funnel and blockers (Phase 5) — every rung must hold; the headline is "ready", not "placed". ──
  const capOf = new Map((input.siteCaps ?? []).map((c) => [`${c.familyId ?? ""}|${c.employerId}`, c]));
  const siteCapFor = (employerId: string, familyId: string | null) => capOf.get(`${familyId ?? ""}|${employerId}`) ?? capOf.get(`|${employerId}`) ?? null;

  // Seats that line up with the demand — three ceilings on ONE basis. Demand and seats are grouped the way the levers let a
  // shift move (by date and block at exact levers, by week when ± days is on, across blocks when any shift is on); in each
  // group the free seats in the settings its sections may use are summed per site × shift under a cap, and the group's
  // total is counted no further than the group's demand. The cap is the site's students-at-once (lined up), that AND the
  // preceptors on the site's roster × students per preceptor (staffable), and the sites are the allowed ones or every live
  // one (every site). One sweep over the assets feeds all three. Never above supplySeatsOnDemandDays; never below placed.
  const groupOf = (date: string, block: ShiftBlock) => `${policy.flexibleDays > 0 ? mondayOf(date) : date}|${policy.flexibleShift ? "*" : block}`;
  const demandByGroup = new Map<string, { seats: number; settings: Set<string> }>();
  for (const u of input.demand) { const g = groupOf(u.date, u.block); const d = demandByGroup.get(g) ?? { seats: 0, settings: new Set<string>() }; d.seats += u.seats; for (const code of u.eligible.length ? u.eligible : [u.settingCode ?? "(unmapped)"]) d.settings.add(code); demandByGroup.set(g, d); }
  const capSeatsOf = (employerId: string) => { const caps = families.map((f) => siteCapFor(employerId, f)).filter((c): c is NonNullable<typeof c> => !!c).map((c) => c.studentsAtOnce ?? c.approvedCapacity).filter((n): n is number => n != null); return caps.length ? Math.max(...caps) : null; };
  const bookedOn = new Map<string, number>();
  for (const k of input.existingBookings) bookedOn.set(`${k.assetId}|${k.date}|${k.block}`, (bookedOn.get(`${k.assetId}|${k.date}|${k.block}`) ?? 0) + k.students);
  type SiteShift = { free: number; ratioSum: number; n: number };
  type ByGroup = Map<string, Map<string, SiteShift>>; // group → employerId|date|block → free seats in the group's settings, and the students-per-preceptor ratio of the rooms behind them
  const allowedMap: ByGroup = new Map(), everyMap: ByGroup = new Map();
  const addTo = (map: ByGroup, g: string, k: string, a: AssetLite, free: number) => { const m = map.get(g) ?? new Map<string, SiteShift>(); const ss = m.get(k) ?? { free: 0, ratioSum: 0, n: 0 }; ss.free += free; ss.ratioSum += policy.studentsPerPreceptor ?? (a.learnersPerShift / Math.max(1, a.preceptorsPerShift || 1)); ss.n++; m.set(k, ss); map.set(g, m); };
  if (from && to) for (const a of live) {
    const allowed = families.some((f) => allowedAsset(a, f));
    for (let d = from; d <= to; d = isoAdd(d, 1)) for (const b of blocksOn(a, d, ov.get(overrideKey(a.id, d)))) {
      const g = groupOf(d, b); const dg = demandByGroup.get(g);
      if (!dg || !dg.settings.has(a.settingCode)) continue;
      const k = `${a.employerId}|${d}|${b}`; const free = Math.max(0, a.learnersPerShift - (bookedOn.get(`${a.id}|${d}|${b}`) ?? 0));
      addTo(everyMap, g, k, a, free); if (allowed) addTo(allowedMap, g, k, a, free);
    }
  }
  const underSiteCap = (employerId: string, ss: SiteShift) => { const cap = capSeatsOf(employerId); return cap == null ? ss.free : Math.min(ss.free, cap); };
  const underPreceptors = (employerId: string, ss: SiteShift) => Math.min(underSiteCap(employerId, ss), (preceptorsAtSite.get(employerId) ?? 0) * (ss.n ? ss.ratioSum / ss.n : 1));
  const linedUpTotal = (byGroup: ByGroup, capAt: (employerId: string, ss: SiteShift) => number) => {
    let total = 0;
    for (const [g, dg] of demandByGroup) { let seats = 0; for (const [k, ss] of byGroup.get(g) ?? []) seats += capAt(k.split("|")[0], ss); total += Math.min(seats, dg.seats); }
    return total;
  };
  const supplySeatsLinedUp = linedUpTotal(allowedMap, underSiteCap);
  const supplySeatsLinedUpStaffable = linedUpTotal(allowedMap, underPreceptors);
  const supplySeatsLinedUpEverySite = linedUpTotal(everyMap, underSiteCap);
  const confirmed = new Set((input.confirmedSettings ?? []).map((c) => `${c.employerId}|${c.settingCode}`));
  const confirmedKnown = input.confirmedSettings != null;
  const atOnce = new Map<string, number>(); // employerId|family|date|block → this family's seats placed (the limit is the family's agreement with the site)
  for (const x of assignments) { const k = `${x.employerId}|${x.unit.familyId ?? ""}|${x.date}|${x.block}`; atOnce.set(k, (atOnce.get(k) ?? 0) + x.seats); }
  // Safety net: the plan never places a seat twice at once (a hard rule while placing); this catches it if it ever did.
  const seatRange = (x: Assignment) => ({ lo: x.unit.seatStart + x.seatOffset, hi: x.unit.seatStart + x.seatOffset + x.seats - 1 });
  const byCohortAt = new Map<string, Assignment[]>();
  for (const x of assignments) { const k = `${x.unit.cohortId}|${x.date}|${x.block}`; const l = byCohortAt.get(k) ?? []; l.push(x); byCohortAt.set(k, l); }
  const overlapsAnother = (x: Assignment) => { const r = seatRange(x); return (byCohortAt.get(`${x.unit.cohortId}|${x.date}|${x.block}`) ?? []).some((y) => y !== x && y.unit.id !== x.unit.id && seatRange(y).lo <= r.hi && r.lo <= seatRange(y).hi); };
  // Each rotation group's exposure by the SEAT's setting, judged against its rule (minimums, mixing, one site).
  const groupJudgement = new Map<string, ReturnType<typeof judgeExposure>>();
  {
    const groups = new Map<string, { rule: NonNullable<DemandUnit["rule"]>; exposure: Record<string, number>; sites: Set<string>; total: number }>();
    for (const u of input.demand) { if (!u.rule) continue; const k = groupKey(u); const g = groups.get(k) ?? { rule: u.rule, exposure: {}, sites: new Set<string>(), total: 0 }; g.total += u.hours; groups.set(k, g); }
    for (const x of assignments) { const g = groups.get(groupKey(x.unit)); if (!g) continue; g.exposure[x.asset.settingCode] = (g.exposure[x.asset.settingCode] ?? 0) + x.hours; g.sites.add(x.employerId); }
    for (const [k, g] of groups) groupJudgement.set(k, judgeExposure(g.rule, g.total, g.exposure, g.sites.size));
  }
  const blk = new Map<BlockerKind, Blocker>();
  const addBlocker = (kind: BlockerKind, label: string, blocking: boolean, x: Assignment, example: string) => { const b = blk.get(kind) ?? { kind, label, shifts: 0, seats: 0, blocking, examples: [] }; b.shifts++; b.seats += x.seats; if (b.examples.length < 3 && !b.examples.includes(example)) b.examples.push(example); blk.set(kind, b); };
  for (const x of assignments) {
    const issues: string[] = [];
    const agreement = agreementFor(x.asset, x.unit.familyId, x.date);
    const agreementEligible = agreement === "secured";
    if (!agreementEligible) { issues.push(`site agreement is ${agreement}`); addBlocker("unsecured-site", "placed at a site without a secured agreement", true, x, `${x.siteName} (${agreement}) on ${x.date}`); }
    const needP = Math.ceil(x.unit.preceptorsNeeded), needI = x.unit.facultyNeeded >= 1 ? 1 : 0;
    const staffedByName = x.preceptorIds.length >= needP && (needI === 0 || !!x.instructorId);
    if (!staffedByName) { const missing = needP > x.preceptorIds.length ? "no preceptor by name" : "no instructor by name"; issues.push(missing); addBlocker("unprecepted", "placed with a required role unfilled — a college instructor or a site preceptor by name, whichever the session's supervision model requires", true, x, `${x.unit.cohort} ${x.unit.courseCode ?? ""} §${x.unit.sectionIndex} at ${x.siteName} on ${x.date} — ${missing}`); }
    const seatSetting = x.asset.settingCode;
    const experienceSupported = confirmedKnown && !!seatSetting && confirmed.has(`${x.employerId}|${seatSetting}`);
    if (!experienceSupported) { issues.push(confirmedKnown ? `${x.siteName} has not confirmed it provides ${seatSetting ?? "this"} experiences` : "experience support unknown"); addBlocker("experience-unconfirmed", "the site has not confirmed the experience (inferred only)", false, x, `${x.siteName} · ${seatSetting ?? "?"}`); }
    // The setting rule itself: an unreviewed interpretation is a conditional placement, never a ready one.
    let ruleReviewed = true;
    if (!x.unit.rule || x.unit.rule.status !== "reviewed" || unresolvedQuantities(x.unit.rule.rule).length) { ruleReviewed = false; issues.push(x.unit.rule ? `the setting rule for "${x.unit.rotationType}" (${describeRule(x.unit.rule.rule)}) is not reviewed` : "no setting rule"); addBlocker("requirement-unreviewed", "placed under a setting rule nobody has reviewed", true, x, `${x.unit.rotationType}: ${x.unit.rule ? describeRule(x.unit.rule.rule) : "unmapped"}`); }
    const gj = groupJudgement.get(groupKey(x.unit));
    // The rule is broken by the placements themselves (a minimum, forbidden mixing, one site, an ineligible seat) — not merely
    // short because other sections of the rotation are unplaced: those carry their own reason, and a seated shift is not made
    // un-ready by a sibling that has no seat yet.
    const ruleBroken = gj ? gj.reasons.filter((r) => r.code !== "SHORT" && r.code !== "REQUIREMENT_UNRESOLVED" && (r.code !== "MIXING_FORBIDDEN" || x.unit.rule?.mixing === "forbidden")) : [];
    if (ruleBroken.length) { issues.push(`setting rule not met for this rotation: ${ruleBroken.map((r) => r.detail).join("; ")}`); addBlocker("setting-rule-unmet", "a rotation whose placements do not satisfy its setting rule (a minimum, no mixing, or one site)", true, x, `${x.unit.cohort} §${x.unit.sectionIndex} ${x.unit.rotationType}: ${ruleBroken[0]?.detail ?? ""}`); }
    const cap = siteCapFor(x.employerId, x.unit.familyId);
    const capN = cap ? (cap.studentsAtOnce ?? cap.approvedCapacity) : null;
    const here = atOnce.get(`${x.employerId}|${x.unit.familyId ?? ""}|${x.date}|${x.block}`) ?? 0;
    let conflictFree = true;
    if (capN != null && here > capN) { conflictFree = false; issues.push(`${num(here)} students at ${x.siteName} at once vs ${num(capN)} approved`); addBlocker("over-capacity", "a site over its approved students-at-once", true, x, `${x.siteName}: ${num(here)} vs ${num(capN)} approved on ${x.date} ${x.block}`); }
    if (x.unit.holiday && !x.movedDays) { conflictFree = false; issues.push(`on ${x.unit.holiday}`); addBlocker("holiday", "a shift placed on an observed holiday", true, x, `${x.unit.holiday} ${x.date}`); }
    if (overlapsAnother(x)) { conflictFree = false; issues.push("the same students are placed in two places at once"); addBlocker("student-overlap", "students placed in two places at once", true, x, `${x.unit.cohort} §${x.unit.sectionIndex} ${x.date} ${x.block}`); }
    if (ruleBroken.length) conflictFree = false;
    x.readiness = { locationAssigned: true, agreementEligible, staffedByName, experienceSupported: experienceSupported && ruleReviewed, conflictFree, ready: agreementEligible && staffedByName && experienceSupported && ruleReviewed && conflictFree, issues };
  }
  const seatsWhere = (f: (r: Readiness) => boolean) => assignments.reduce((n, x) => n + (x.readiness && f(x.readiness) ? x.seats : 0), 0);
  const readiness = {
    locationAssigned: assignments.reduce((n, x) => n + x.seats, 0),
    agreementEligible: seatsWhere((r) => r.agreementEligible),
    staffedByName: seatsWhere((r) => r.agreementEligible && r.staffedByName),
    experienceSupported: seatsWhere((r) => r.agreementEligible && r.staffedByName && r.experienceSupported),
    conflictFree: seatsWhere((r) => r.agreementEligible && r.staffedByName && r.experienceSupported && r.conflictFree),
    ready: seatsWhere((r) => r.ready), readyShare: 0,
  };
  const blockers = [...blk.values()].sort((a, b) => Number(b.blocking) - Number(a.blocking) || b.seats - a.seats);

  const demandShifts = input.demand.length, demandSeats = input.demand.reduce((n, u) => n + u.seats, 0), demandHours = input.demand.reduce((n, u) => n + u.hours * u.seats, 0);
  const placedShifts = new Set(assignments.map((x) => x.unit.id)).size, placedSeats = assignments.reduce((n, x) => n + x.seats, 0), placedHours = assignments.reduce((n, x) => n + x.hours * x.seats, 0);
  const preceptorShifts = assignments.reduce((n, x) => n + Math.ceil(x.unit.preceptorsNeeded), 0);
  const preceptorsAssigned = assignments.reduce((n, x) => n + x.preceptorIds.length, 0);
  const instructorShifts = assignments.filter((x) => x.unit.facultyNeeded > 0).length;
  const instructorsAssigned = assignments.filter((x) => x.instructorId).length;
  const supplySeatsAllowed = balance.reduce((n, b) => n + b.seatsAllowed, 0);
  const supplySeatsPhysical = [...supplyBySetting.values()].reduce((n, s) => n + s.seatsPhysical, 0);
  const supplySeatsOnDemandDays = balance.reduce((n, b) => n + b.seatsOnDemandDays, 0);
  const supplySeatsBooked = balance.reduce((n, b) => n + b.seatsBooked, 0);
  const supplySeatsPhysicalOnDemandDays = [...supplyBySetting.values()].reduce((n, s) => n + s.seatsPhysicalOnDemandDays, 0);
  const capacity: CapacityHeadroom = {
    demandSeats, supplySeats: supplySeatsAllowed, supplySeatsPhysical, supplySeatsOnDemandDays, supplySeatsBooked, supplySeatsPhysicalOnDemandDays, supplySeatsStaffableOnDemandDays, supplySeatsLinedUp, supplySeatsLinedUpStaffable, supplySeatsLinedUpEverySite,
    headroom: supplySeatsAllowed - demandSeats, headroomOnDemandDays: supplySeatsOnDemandDays - supplySeatsBooked - demandSeats,
    ratio: demandSeats > 0 ? supplySeatsAllowed / demandSeats : null, ratioOnDemandDays: demandSeats > 0 ? supplySeatsOnDemandDays / demandSeats : null,
    settingsWithoutSupply: balance.filter((b) => b.demandShifts > 0 && b.seatsAllowed === 0).map((b) => b.settingCode),
    window: from && to ? { from, to } : null,
  };
  const sitesUsed = new Set(assignments.map((x) => x.employerId)).size;
  const placedShare = demandSeats > 0 ? placedSeats / demandSeats : 0;
  const topReasons = (() => { const m = new Map<UnmetReason, number>(); for (const x of unmet) m.set(x.reason, (m.get(x.reason) ?? 0) + x.unit.seats); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3); })();
  const shortSettings = balance.filter((b) => b.verdict === "short").map((b) => b.settingCode);
  const statement = demandShifts === 0
    ? "No dated clinical shifts in this window — offerings need real term dates and clinical sessions before there is demand to place."
    : `${from === to ? `On ${from}` : `From ${from} to ${to}`}, ${num(demandShifts)} clinical shifts — a section on a date — (${num(demandSeats)} learner-shifts, ${num(demandHours)} learner-hours) need a home in ${balance.filter((b) => b.demandShifts > 0).length} settings. ` +
      `Under the current levers the plan places ${pct(placedShare)} of them — ${num(placedSeats)} learner-shifts across ${sitesUsed} site${sitesUsed === 1 ? "" : "s"}, ${num(preceptorsAssigned)} of ${num(preceptorShifts)} preceptor-shifts staffed by name` +
      (unmet.length ? `, and ${num(unmet.length)} shifts (${num(demandSeats - placedSeats)} learner-shifts) unplaced: ${topReasons.map(([r, n]) => `${num(n)} — ${REASON_LABEL[r].split(" — ")[0]}`).join("; ")}.` : ", with nothing left over.") +
      (shortSettings.length ? ` Short settings: ${shortSettings.join(", ")}.` : "") +
      (placedSeats > 0 ? ` Ready to run: ${pct(demandSeats > 0 ? readiness.ready / demandSeats : 0)} — ${num(readiness.ready)} learner-shifts pass every check (secured agreement, named staff, confirmed experience, no conflicts).` : "");

  readiness.readyShare = demandSeats > 0 ? readiness.ready / demandSeats : 0;

  // ── The canonical evaluation (lib/evaluate): the same checks, codes and counting every view reads. ──
  const evaluation = evaluatePlanFacts({
    input, live, assignments, unmet, from, to,
    rawAgreement: (a, familyId) => (familyId ? famAgreement.get(`${familyId}|${a.employerId}`) : undefined) ?? a.agreementStatus ?? null,
    agreementEnds: (a, familyId) => (familyId ? famEnds.get(`${familyId}|${a.employerId}`) : undefined) ?? null,
    allowedAsset, siteCapFor, confirmed, confirmedKnown, atOnce, overlapsAnother, groupJudgement, preceptorsAtSite,
  });
  return { policy, assignments, unmet, balance, sites, weeks, bottlenecks, rosters, studentStats, preceptorStats, blockers, evaluation, summary: { capacity, demandShifts, demandSeats, demandHours, placedShifts, placedSeats, placedHours, unmetShifts: unmet.length, placedShare, supplySeatsAllowed, supplySeatsPhysical, preceptorShifts, preceptorsAssigned, instructorShifts, instructorsAssigned, sitesUsed, statement, readiness } };
}

// ── The evaluation pass ──────────────────────────────────────────────────────────────────────────────
// Every placed section is judged on the seven checks with the facts the placer used; every unplaced
// section carries the structured code its unmet reason means. Nothing here changes a placement —
// it is the explanation layer the capacity panel, site views, staffing, exceptions and exports share.
interface EvalFacts {
  input: SchedulerInput; live: AssetLite[]; assignments: Assignment[]; unmet: Unmet[]; from: string | undefined; to: string | undefined;
  rawAgreement: (a: AssetLite, familyId: string | null) => string | null;
  agreementEnds: (a: AssetLite, familyId: string | null) => string | null;
  allowedAsset: (a: AssetLite, familyId: string | null) => boolean;
  siteCapFor: (employerId: string, familyId: string | null) => SiteCapacityLite | null;
  confirmed: Set<string>; confirmedKnown: boolean;
  atOnce: Map<string, number>;
  overlapsAnother: (x: Assignment) => boolean;
  groupJudgement: Map<string, ReturnType<typeof judgeExposure>>;
  preceptorsAtSite: Map<string, number>;
}
/** The reason code an unmet reason means, and whether it is a demonstrated conflict or an evidence gap. */
const UNMET_CODE: Record<UnmetReason, { code: ReasonCode; check: Check["key"]; status: Reason["status"] }> = {
  holiday: { code: "HOLIDAY", check: "readiness", status: "fail" },
  "class-day": { code: "CLASS_OVERLAP", check: "readiness", status: "fail" },
  "student-busy": { code: "STUDENT_OVERLAP", check: "readiness", status: "fail" },
  "unmapped-setting": { code: "SETTING_UNMAPPED", check: "requirement", status: "unknown" },
  "no-asset-for-setting": { code: "NO_ELIGIBLE_SUPPLY", check: "capacity", status: "fail" },
  "no-agreement": { code: "ACCESS_UNSECURED", check: "access", status: "fail" },
  ring: { code: "DRIVE_LIMIT", check: "access", status: "fail" },
  drive: { code: "DRIVE_LIMIT", check: "access", status: "fail" },
  "closed-that-day": { code: "UNAVAILABLE", check: "availability", status: "fail" },
  full: { code: "CAPACITY_EXHAUSTED", check: "capacity", status: "fail" },
  "site-cap": { code: "CAPACITY_EXHAUSTED", check: "capacity", status: "fail" },
  "too-big": { code: "CAPACITY_EXHAUSTED", check: "capacity", status: "fail" },
  "no-preceptor": { code: "PRECEPTOR_UNAVAILABLE", check: "supervision", status: "fail" },
  "mixing-locked": { code: "MIXING_FORBIDDEN", check: "setting", status: "fail" },
};
const RULE_HREF = "/capacity#rotations";
/** The session's supervision model: the stored one when the caller resolved it, else the legacy columns read literally (an unknown mode stays unknown). */
function supervisionOf(u: DemandUnit, cache: Map<string, SupervisionSpec>): SupervisionSpec {
  let s = cache.get(u.sessionId);
  if (!s) { s = u.supervision ?? supervisionFromLegacy({ clinicalMode: u.clinicalMode, facultyNeeded: u.facultyNeeded, preceptorsNeeded: u.preceptorsNeeded, maxStudents: u.seatsPerSection }); cache.set(u.sessionId, s); }
  return s;
}
function evaluatePlanFacts(f: EvalFacts): PlanEvaluation {
  const { input, live, assignments, unmet } = f; const { policy } = input;
  const specs = new Map<string, SupervisionSpec>();
  const scenarioAllows = policy.agreements === "secured+asked" ? ["asked"] : policy.agreements === "any" ? ["asked", "prospect", "none"] : [];
  const label = (u: DemandUnit) => `${u.cohort} ${u.courseCode ?? u.courseTitle} §${u.sectionIndex} ${u.date} ${u.block}`;
  const evals: PlacementEvaluation[] = [];
  for (const x of assignments) {
    const u = x.unit; const id = `${u.id}|${x.seatOffset}`; const lab = `${label(u)} → ${x.siteName}`;
    const checks: Check[] = [];
    checks.push(checkRequirement(id, u.rule, { href: RULE_HREF }));
    const setting = checkSetting(id, u.rule, x.asset.settingCode);
    // Group-level findings (a minimum, mixing, one site) belong to the setting check of every placement in the group.
    const gj = f.groupJudgement.get(groupKey(u));
    if (gj) for (const r of gj.reasons) {
      if (r.code === "SHORT" || r.code === "REQUIREMENT_UNRESOLVED") continue; // short = other sections unplaced (they carry their own reason); unresolved is on the requirement check
      const status: Reason["status"] = r.code === "MIXING_FORBIDDEN" && u.rule?.mixing === "unknown" ? "unknown" : "fail";
      setting.reasons.push({ code: r.code, check: "setting", status, item: id, detail: r.detail, remediation: { label: r.code === "CONTINUITY_UNMET" ? "keep the rotation at one site" : r.code === "MIXING_FORBIDDEN" ? (status === "unknown" ? "confirm whether hours may be split across settings" : "keep the rotation in one setting") : "add seats in the required setting", href: RULE_HREF } });
      if (status === "fail") setting.status = "fail"; else if (setting.status === "pass") setting.status = "unknown";
    }
    checks.push(setting);
    const seatSetting = x.asset.settingCode;
    checks.push(checkCapability(id, f.confirmedKnown ? (f.confirmed.has(`${x.employerId}|${seatSetting}`) ? "confirmed" : "inferred") : "unknown", x.siteName, x.asset.setting || seatSetting, `/employers/${x.employerId}`));
    checks.push(checkAccess(id, f.rawAgreement(x.asset, u.familyId), f.agreementEnds(x.asset, u.familyId), x.date, x.siteName, { scenarioAllows, href: `/employers/${x.employerId}` }));
    const cap = f.siteCapFor(x.employerId, u.familyId);
    const capN = cap ? (cap.studentsAtOnce ?? cap.approvedCapacity) : null;
    const mode: LimitMode = (cap?.studentsAtOnceMode as LimitMode | null | undefined) ?? (capN != null ? "known" : "unknown");
    const here = f.atOnce.get(`${x.employerId}|${u.familyId ?? ""}|${x.date}|${x.block}`) ?? 0;
    checks.push(checkCapacity(id, { label: `${x.siteName} students at once`, limit: mode === "known" ? capN : null, mode, used: Math.max(0, here - x.seats), adding: x.seats }, `/employers/${x.employerId}`));
    const avMode: AvailabilityMode = (cap?.availabilityMode as AvailabilityMode | null | undefined) ?? "inherit";
    checks.push(checkAvailability(id, avMode, avMode === "inherit" || avMode === "specific" ? true : null, avMode === "inherit" ? "the asset's own schedule has this shift" : "the site's availability record", `/employers/${x.employerId}`));
    const spec = supervisionOf(u, specs);
    const findings = spec.roles.map((r) => r.role === "instructor"
      ? roleFinding(r, x.seats, x.instructorId ? 1 : 0, input.instructors.length, null, { placementDate: x.date })
      : roleFinding(r, x.seats, x.preceptorIds.length, f.preceptorsAtSite.get(x.employerId) ?? 0, x.siteName, { placementDate: x.date }));
    checks.push(checkSupervision(id, spec, findings, `/programs/${u.programId}/offerings/${u.cohortId}`));
    checks.push(checkReadiness(id, { studentOverlap: f.overlapsAnother(x), holiday: u.holiday && !x.movedDays ? u.holiday : null }));
    evals.push(evaluatePlacement(id, lab, checks));
  }
  for (const m of unmet) {
    const u = m.unit; const id = u.id; const c = UNMET_CODE[m.reason];
    const status: Reason["status"] = m.reason === "mixing-locked" && u.rule?.mixing === "unknown" ? "unknown" : c.status;
    const reason: Reason = { code: c.code, check: c.check, status, item: id, detail: m.detail, source: m.reason === "ring" || m.reason === "no-agreement" ? "a lever" : undefined, remediation: m.fixes[0] ? { label: m.fixes[0] } : undefined };
    const check: Check = { key: c.check, status: status === "fail" ? "fail" : "unknown", facts: [REASON_TEXT[c.code]], reasons: [reason] };
    // An unplaced section is still judged on its requirement, so an unreviewed rule is counted there too.
    evals.push(evaluatePlacement(id, `${label(u)} (unplaced)`, [checkRequirement(id, u.rule, { href: RULE_HREF }), check]));
  }
  const summary = summarize(evals);
  // Alternatives the rule allows that exist only at sites the levers exclude: worth evaluating before a new agreement is proposed.
  const untried = new Set<string>();
  for (const m of unmet) if (["full", "closed-that-day", "no-asset-for-setting", "too-big", "no-agreement"].includes(m.reason)) for (const alt of m.unit.eligible) if (live.some((a) => a.settingCode === alt && !f.allowedAsset(a, m.unit.familyId))) untried.add(alt);
  const rolesRequired: SupervisionRole[] = [];
  for (const u of [...assignments.map((x) => x.unit), ...unmet.map((m) => m.unit)]) for (const r of requiredRoles(supervisionOf(u, specs))) if (!rolesRequired.includes(r.role)) rolesRequired.push(r.role);
  const assumptions: string[] = [
    policy.agreements === "secured" ? "secured agreements only count as access" : policy.agreements === "secured+asked" ? "asked agreements count as access — an assumption; nothing asked is secured" : "any partner counts as access — an assumption; only secured agreements are real access",
    policy.maxRing === "any" ? "any drive time" : `sites within ${policy.maxRing}`,
    policy.flexibleDays ? `a shift may move ± ${policy.flexibleDays} day${policy.flexibleDays === 1 ? "" : "s"}` : "exact dates",
    policy.flexibleShift ? "any shift block" : "the session's own shift block",
    policy.requirePreceptor ? "a shift is placed only where a free preceptor exists (Preceptors lever)" : "seats only — a shift is placed without a free preceptor and supervision is judged afterwards",
    policy.skipHolidays ? "never on an observed holiday" : "holidays are flagged, not avoided",
  ];
  if (!f.confirmedKnown) assumptions.push("site experience confirmations were not loaded — capability is unknown everywhere");
  const rules = [...new Map(input.demand.filter((u) => u.rule).map((u) => [u.rotationType.toLowerCase(), `${u.rotationType}: ${describeRule(u.rule!.rule)} [${u.rule!.status}]`])).values()].sort();
  const contract: EvaluationResult["contract"] = {
    requirementVersions: rules,
    inputVersion: `demand ${input.demand.length} · assets ${input.assets.length} · bookings ${input.existingBookings.length} · agreements ${input.familyAgreements.length} · preceptors ${input.preceptors.length} · instructors ${input.instructors.length}`,
    scope: { institutionId: "", cohortIds: [...new Set(input.demand.map((u) => u.cohortId))], programIds: [...new Set(input.demand.map((u) => u.programId))] },
    window: f.from && f.to ? { from: f.from, to: f.to } : null,
    assumptions, population: "clinical sections on a date — placed and unplaced", unit: "placements (a section on a date and shift)",
    evaluatedAt: new Date().toISOString(), complete: true,
  };
  return { contract, placements: evals, summary, recommendations: recommend(summary, { untriedAlternatives: [...untried].sort(), rolesRequired }), rolesRequired };
}
