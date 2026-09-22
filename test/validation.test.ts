import { describe, it, expect } from "vitest";
import { recommendPlan, DEFAULT_POLICY, type DemandUnit, type SchedulerInput, type Policy } from "../src/lib/scheduler";
import type { AssetLite } from "../src/lib/assetmap";
import { onlyRule } from "../src/lib/settingrule";
import { withdrawnRule, type LoadRow } from "../src/lib/siteload";

// Phase 5 (docs/metrics-audit.md §11): the validation fixtures. Each case is a small world with a
// known right answer; the engine must produce that answer, and the readiness funnel must say why.

const asset = (o: Partial<AssetLite> & { id: string; employerId: string; facilityName: string }): AssetLite => ({
  externalId: o.id, settingCode: "GEN", setting: "General", assetType: "Room", assetNumber: 1, operatingRule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", shiftBlocks: "Day", hoursPerShift: 8,
  serves: null, learnersPerShift: 2, preceptorsPerShift: 1, dataSource: "VERIFIED", status: "active", agreementStatus: "secured", facilityStatus: "active", ring: "Core", county: "Moore", ...o,
});
const unit = (o: Partial<DemandUnit> & { id: string }): DemandUnit => ({
  cohortId: "co1", cohort: "Class of 2028", programId: "p1", program: "Radiography", familyId: "fam1",
  courseId: "c1", courseCode: "RAD-151", courseTitle: "Clinical Ed I", termIndex: 1, termName: "First Fall", weekOfTerm: 1,
  sessionId: "s1", sessionTitle: null, sectionIndex: 1, sectionCount: 1,
  date: "2027-08-24", weekMonday: "2027-08-23", block: "Day", startTime: "07:00", hours: 8, originalDate: "2027-08-24",
  rotationType: "General Radiography", settingCode: "GEN", rule: onlyRule(o.settingCode ?? "GEN"), eligible: [o.settingCode ?? "GEN"], seats: 2, seatsPerSection: 2, seatStart: ((o.sectionIndex ?? 1) - 1) * (o.seats ?? 2) + 1, sectionSeats: o.seats ?? 2, preceptorsNeeded: 1, facultyNeeded: 0, clinicalMode: "Preceptor-led", holiday: null, moved: false, holidayMoved: null, ...o,
});
const base = (over: Partial<SchedulerInput> = {}, policy: Partial<Policy> = {}): SchedulerInput => ({
  demand: [], assets: [], overrides: [], existingBookings: [], preceptors: [], instructors: [], students: [], familyAgreements: [], siteCaps: [], confirmedSettings: [], policy: { ...DEFAULT_POLICY, ...policy }, ...over,
});
const preceptors = (employerId: string, n: number, prefix = "p") => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, name: `${prefix.toUpperCase()} ${i + 1}`, employerId, role: "preceptor" }));
const seats = (plan: ReturnType<typeof recommendPlan>) => plan.assignments.reduce((n, x) => n + x.seats, 0);

describe("validation fixtures", () => {
  it("1 · 11 students against 10 seats leaves exactly one student unplaced, and says why", () => {
    // Five 2-learner rooms at one site = 10 seats on the Day shift. Eleven students in one section (seatsPerSection 11).
    const rooms = [1, 2, 3, 4, 5].map((n) => asset({ id: `r${n}`, employerId: "e1", facilityName: "Moore Regional", assetNumber: n }));
    const plan = recommendPlan(base({ demand: [unit({ id: "u1", seats: 11, seatsPerSection: 11, preceptorsNeeded: 0 })], assets: rooms }));
    expect(seats(plan)).toBe(10);
    expect(plan.unmet).toHaveLength(1);
    expect(plan.unmet[0].unit.seats).toBe(1);
    expect(plan.unmet[0].reason).toBe("full");
    expect(plan.unmet[0].detail).toMatch(/^1 student of Class of 2028 \(RAD-151 §1\) unplaced Tue 2027-08-24 Day: the remaining eligible site \(Moore Regional\) is already full that shift/);
  });

  it("2 · supervision for 8 means 8 staffed by name, not 10 — the readiness funnel drops the other two", () => {
    // Ten seats, ten students, but only eight preceptors (1:1). Seats-only mode places all ten; readiness counts eight.
    const rooms = [1, 2, 3, 4, 5].map((n) => asset({ id: `r${n}`, employerId: "e1", facilityName: "Moore Regional", assetNumber: n, learnersPerShift: 1, preceptorsPerShift: 1 }));
    const demand = [1, 2, 3, 4, 5].map((n) => unit({ id: `u${n}`, sessionId: `s${n}`, seats: 2, seatsPerSection: 2, sectionIndex: n, sectionCount: 5, preceptorsNeeded: 2 }));
    const relaxed = recommendPlan(base({ demand, assets: rooms.map((r) => ({ ...r, learnersPerShift: 2 })), preceptors: preceptors("e1", 8), confirmedSettings: [{ employerId: "e1", settingCode: "GEN" }] }));
    expect(seats(relaxed)).toBe(10);
    expect(relaxed.summary.readiness.locationAssigned).toBe(10);
    expect(relaxed.summary.readiness.staffedByName).toBe(8);
    expect(relaxed.summary.readiness.ready).toBe(8);
    expect(relaxed.blockers.find((b) => b.kind === "unprecepted")).toMatchObject({ blocking: true, shifts: 1, seats: 2 });
    // Requiring supervision up front places only what can be supervised.
    const strict = recommendPlan(base({ demand, assets: rooms.map((r) => ({ ...r, learnersPerShift: 2 })), preceptors: preceptors("e1", 8) }, { requirePreceptor: true }));
    expect(seats(strict)).toBe(8);
    expect(strict.unmet[0].reason).toBe("no-preceptor");
    expect(strict.unmet[0].detail).toMatch(/no confirmed supervision free/);
  });

  it("3 · an agreement that expires mid-term stops being eligible on the day after it ends", () => {
    const A = asset({ id: "a1", employerId: "e1", facilityName: "Moore Regional", agreementStatus: "none" });
    const demand = [unit({ id: "u1", date: "2027-08-24", originalDate: "2027-08-24" }), unit({ id: "u2", sessionId: "s2", date: "2027-09-14", originalDate: "2027-09-14", weekMonday: "2027-09-13" })];
    const plan = recommendPlan(base({ demand, assets: [A], familyAgreements: [{ familyId: "fam1", employerId: "e1", agreementStatus: "secured", agreementEnds: "2027-08-31" }] }));
    expect(plan.assignments.map((x) => x.date)).toEqual(["2027-08-24"]);
    expect(plan.unmet).toHaveLength(1);
    expect(plan.unmet[0].unit.date).toBe("2027-09-14");
    expect(plan.unmet[0].reason).toBe("no-agreement");
    expect(plan.unmet[0].detail).toMatch(/not under an allowed agreement on that date/);
    // Under "any partner", the expired shift is placed but flagged as not agreement-eligible.
    const any = recommendPlan(base({ demand, assets: [A], familyAgreements: [{ familyId: "fam1", employerId: "e1", agreementStatus: "secured", agreementEnds: "2027-08-31" }] }, { agreements: "any" }));
    expect(any.assignments).toHaveLength(2);
    const late = any.assignments.find((x) => x.date === "2027-09-14")!;
    expect(late.readiness?.agreementEligible).toBe(false);
    expect(any.summary.readiness.agreementEligible).toBe(2);
    expect(any.blockers.find((b) => b.kind === "unsecured-site")).toMatchObject({ blocking: true, shifts: 1 });
  });

  it("4 · a site is never placed over its students-at-once — the extra student is left unplaced", () => {
    // Two sections of 2 on the same day at a site the family may use for 3 students at once.
    const rooms = [1, 2].map((n) => asset({ id: `r${n}`, employerId: "e1", facilityName: "Moore Regional", assetNumber: n }));
    const demand = [unit({ id: "u1" }), unit({ id: "u2", sessionId: "s2", sectionIndex: 2, sectionCount: 2 })];
    const plan = recommendPlan(base({ demand, assets: rooms, preceptors: preceptors("e1", 2), confirmedSettings: [{ employerId: "e1", settingCode: "GEN" }], siteCaps: [{ employerId: "e1", familyId: "fam1", studentsAtOnce: 3, approvedCapacity: null }] }));
    // The site's students-at-once is a hard limit while placing: 3 seats are placed, the 4th student is left
    // unplaced (the site is full for this family), and nothing is ever placed over the limit.
    expect(seats(plan)).toBe(3);
    expect(plan.blockers.find((b) => b.kind === "over-capacity")).toBeUndefined();
    expect(plan.unmet.length).toBe(1);
    expect(plan.unmet[0].unit.seats).toBe(1);
    expect(plan.unmet[0].reason).toBe("full");
    expect(plan.summary.readiness.conflictFree).toBe(3);
    // The same students in two places at once is never placed: the second shift is left unplaced and says why.
    const twice = recommendPlan(base({ demand: [unit({ id: "u1" }), unit({ id: "u1b", sessionId: "s2" })], assets: rooms, preceptors: preceptors("e1", 2), confirmedSettings: [{ employerId: "e1", settingCode: "GEN" }] }));
    expect(twice.blockers.find((b) => b.kind === "student-overlap")).toBeUndefined();
    expect(twice.assignments.length).toBe(1);
    expect(twice.unmet.map((u) => u.reason)).toEqual(["student-busy"]);
  });

  it("5 · a shift moved from Tuesday to Thursday shows Thursday everywhere the plan reports it", () => {
    const A = asset({ id: "a1", employerId: "e1", facilityName: "Moore Regional", days: "Thu" }); // only open Thursday
    const plan = recommendPlan(base({ demand: [unit({ id: "u1", date: "2027-08-24", originalDate: "2027-08-24" })], assets: [A], preceptors: preceptors("e1", 1), confirmedSettings: [{ employerId: "e1", settingCode: "GEN" }], students: [{ id: "st1", name: "Ada", cohortId: "co1", sectionIndex: 1 }] }, { flexibleDays: 2 }));
    expect(plan.assignments).toHaveLength(1);
    const x = plan.assignments[0];
    expect(x.date).toBe("2027-08-26");
    expect(x.movedDays).toBe(2);
    expect(x.unit.originalDate).toBe("2027-08-24");
    expect(plan.rosters[0].stops[0]).toMatchObject({ from: "2027-08-26", to: "2027-08-26" });
    expect(plan.weeks.find((w) => w.settingCode === "GEN")!.weekMonday).toBe("2027-08-23");
    expect(plan.sites.find((s) => s.employerId === "e1")!.sections).toBe(1);
    // A holiday shift that was NOT moved is a blocker; the same shift moved off the holiday is not.
    const hol = recommendPlan(base({ demand: [unit({ id: "u1", holiday: "Labor Day" })], assets: [asset({ id: "a2", employerId: "e1", facilityName: "Moore Regional" })], preceptors: preceptors("e1", 1), confirmedSettings: [{ employerId: "e1", settingCode: "GEN" }] }, { skipHolidays: false }));
    expect(hol.blockers.find((b) => b.kind === "holiday")).toMatchObject({ blocking: true, shifts: 1 });
    expect(hol.assignments[0].readiness?.conflictFree).toBe(false);
  });

  it("6 · a withdrawal removes the student's future shifts and flags what it removed", () => {
    const row = (o: Partial<LoadRow>): LoadRow => ({ studentId: "s1", student: "Ada", cohortId: "c1", cohort: "Class of 2028", programId: "p1", program: "Radiography", familyId: "f1", family: "Radiography", course: "RAD-151", term: "Term 1", date: "2026-08-18", year: 2026, semester: "Fall", dayOfWeek: "Tue", hours: 8, status: "scheduled", employerId: "e1", site: "Moore Regional", system: null, county: null, ring: null, facilityType: null, driveMinutes: null, setting: "GEN", preceptorId: null, preceptor: null, instructorId: null, instructor: null, supervision: "precepted" as const, instructorNeeded: false, preceptorNeeded: true, learnersOnShift: 1, instructorHours: 0, instructorShare: 0, instructorOversight: false, preceptorHours: 8, preceptorShare: 8, agreement: "secured", studentStatus: "enrolled", keepAssignments: false, assetId: null, asset: null, block: null, seatsPerShift: null, ...o });
    const r = withdrawnRule([
      row({ studentId: "w", studentStatus: "withdrawn", date: "2026-09-01" }),   // past — stays (it happened)
      row({ studentId: "w", studentStatus: "withdrawn", date: "2026-09-18" }),   // today — stays (the shift is under way)
      row({ studentId: "w", studentStatus: "withdrawn", date: "2026-09-19" }),   // tomorrow — goes
      row({ studentId: "w", studentStatus: "withdrawn", date: "2026-11-03" }),
      row({ studentId: "a", date: "2026-11-03" }),
    ], "2026-09-18");
    expect(r.rows.filter((x) => x.studentId === "w").map((x) => x.date)).toEqual(["2026-09-01", "2026-09-18"]);
    expect(r.excluded).toBe(2);
    expect(r.students).toBe(1);
    expect(r.rows.some((x) => x.studentId === "a")).toBe(true);
  });

  it("7 · a placement at a site that has not confirmed the experience reads unverified, never ready", () => {
    const A = asset({ id: "a1", employerId: "e1", facilityName: "Moore Regional" });
    const input = base({ demand: [unit({ id: "u1" })], assets: [A], preceptors: preceptors("e1", 1) });
    // Confirmed settings known, but this site has not confirmed GEN.
    const inferred = recommendPlan({ ...input, confirmedSettings: [{ employerId: "e9", settingCode: "GEN" }] });
    expect(inferred.assignments[0].readiness).toMatchObject({ agreementEligible: true, staffedByName: true, experienceSupported: false, ready: false });
    expect(inferred.assignments[0].readiness?.issues).toContain("Moore Regional has not confirmed it provides GEN experiences");
    expect(inferred.blockers.find((b) => b.kind === "experience-unconfirmed")).toMatchObject({ blocking: false, shifts: 1 });
    expect(inferred.summary.readiness.ready).toBe(0);
    // Nothing known about confirmations at all → "unknown", still not ready.
    const unknown = recommendPlan({ ...input, confirmedSettings: undefined });
    expect(unknown.assignments[0].readiness?.issues).toContain("experience support unknown");
    // Confirmed → ready.
    const confirmed = recommendPlan({ ...input, confirmedSettings: [{ employerId: "e1", settingCode: "GEN" }] });
    expect(confirmed.assignments[0].readiness?.ready).toBe(true);
    expect(confirmed.summary.readiness).toMatchObject({ ready: 2, readyShare: 1 });
  });

  it("8 · two programs sharing one asset are never double counted: seats and preceptors are used once", () => {
    // One 2-learner room with one preceptor; Radiography and Surgical Technology both want it on the same shift.
    const A = asset({ id: "a1", employerId: "e1", facilityName: "Moore Regional", learnersPerShift: 2 });
    const rad = unit({ id: "u1", seats: 2, seatsPerSection: 2 });
    const surg = unit({ id: "u2", sessionId: "s2", cohortId: "co2", cohort: "Surg Tech 2028", programId: "p2", program: "Surgical Technology", familyId: "fam2", courseId: "c2", courseCode: "SUR-111", seats: 2, seatsPerSection: 2 });
    const plan = recommendPlan(base({ demand: [rad, surg], assets: [A], preceptors: preceptors("e1", 1), confirmedSettings: [{ employerId: "e1", settingCode: "GEN" }] }));
    expect(seats(plan)).toBe(2);                 // the room's 2 seats, once
    expect(plan.unmet).toHaveLength(1);
    expect(plan.unmet[0].reason).toBe("full");
    expect(plan.sites[0].usedSeats).toBe(2);
    expect(plan.sites[0].slotSeats).toBe(2);
    expect(plan.summary.supplySeatsAllowed).toBe(2);
    expect(plan.preceptorStats).toHaveLength(1);
    expect(plan.preceptorStats[0].shifts).toBe(1);
    // A booking already on the books for the other program takes the seats before this plan sees them.
    const booked = recommendPlan(base({ demand: [rad], assets: [A], existingBookings: [{ id: "b1", assetId: "a1", cohortId: "co2", sessionId: "s2", sectionIndex: 1, date: "2027-08-24", block: "Day", students: 2 }], preceptors: preceptors("e1", 1) }));
    expect(booked.assignments).toHaveLength(0);
    expect(booked.unmet[0].reason).toBe("full");
  });
});
