import { describe, expect, it } from "vitest";
import { resolveSessionDay, shiftBoard, distinctStudents, type DatedInstance } from "../src/lib/capacitymodel";
import { fmt, dec } from "../src/lib/format";

// Fixes from docs/metrics-audit.md (Phase 0).

describe("a session's weekday follows a moved weekly booking (audit §2.3)", () => {
  const tt = ["Tue", "Thu"];
  it("keeps the session's own day while a booking still sits on it", () => {
    expect(resolveSessionDay("Tue", false, [{ dayOfWeek: "Tue" }, { dayOfWeek: "Thu" }], tt)).toBe("Tue");
  });
  it("follows the booking the calendar moved to a day no session uses (Tue → Thu when the course had Tue only)", () => {
    expect(resolveSessionDay("Tue", false, [{ dayOfWeek: "Thu" }], ["Tue"])).toBe("Thu");
  });
  it("does not steal another session's day: with Tue and Thu sessions and only a Thu booking, Tue stays Tue", () => {
    expect(resolveSessionDay("Tue", false, [{ dayOfWeek: "Thu" }], tt)).toBe("Tue");
  });
  it("gives a day-less in-person session its first booking's day, and leaves an online session undated", () => {
    expect(resolveSessionDay(null, false, [{ dayOfWeek: "Wed" }], [])).toBe("Wed");
    expect(resolveSessionDay(null, true, [{ dayOfWeek: "Wed" }], [])).toBeNull();
    expect(resolveSessionDay("Mon", true, [{ dayOfWeek: "Wed" }], ["Mon"])).toBe("Mon");
  });
  it("with no bookings at all the session's day stands", () => {
    expect(resolveSessionDay("Fri", false, [], ["Fri"])).toBe("Fri");
  });
});

const inst = (cohortId: string, sessionId: string, kind: string, C: number, Y: number, maxStudents: number): DatedInstance => ({
  cohortId, cohort: cohortId, programId: "p", program: "P", courseId: "c", courseCode: "X", courseTitle: "X", termIndex: 1, termName: "Term 1", weekOfTerm: 1,
  mondayIso: "2026-08-17", dateIso: "2026-08-17", holiday: null,
  session: { id: sessionId, kind: kind as "CLASS", number: 1, title: null, lengthHours: 2, maxStudents, facultyNeeded: 1, preceptorsNeeded: 0, supportStaffNeeded: 0, week: 1, dayOfWeek: "Mon", startTime: null, location: null, rotationType: null, clinicalMode: null, deliveryMode: null, notes: null },
  computed: { C, Y, spaceHours: 0, facultyContactHours: 0, facultyFte: 0, preceptorContactHours: 0, preceptorFte: 0 },
} as unknown as DatedInstance);

describe("daily coverage counts students, not attendances (audit §1.6)", () => {
  // Aug 17, 2026: RAD-110 class (41 radiography students in 2 sections of 25), RAD-110 lab (the same 41 in 4 sections of 12), SUR 111 class (19).
  const day = [inst("rad", "s-class", "CLASS", 41, 2, 25), inst("rad", "s-lab", "LAB", 41, 4, 12), inst("surg", "s-sur", "CLASS", 19, 1, 20)];
  it("41 + 41 + 19 attendances are 60 distinct students", () => {
    expect(distinctStudents(day)).toBe(60);
    const [row] = shiftBoard(day);
    expect(row.studentsOnSite).toBe(60);
    expect(row.attendances).toBe(101);
  });
});

describe("the format module's rules (audit §2.1)", () => {
  it("counts are whole; required counts round up", () => {
    expect(fmt.num(82.2140822)).toBe("82");
    expect(fmt.atLeast(82.2140822)).toBe("83");
    expect(fmt.atLeast(83)).toBe("83");
  });
  it("percentages carry at most one decimal", () => {
    expect(fmt.pct(1.085365854)).toBe("108.5%");
    expect(fmt.pct(0.5)).toBe("50%");
  });
  it("FTE one to two decimals, hours at most one, age one, multipliers two", () => {
    expect(fmt.fte(5.6225411)).toBe("5.62");
    expect(fmt.fte(2)).toBe("2.0");
    expect(fmt.hours(5.833333333333333)).toBe("5.8");
    expect(fmt.hours(2091.6666667)).toBe("2,091.7");
    expect(fmt.age(30.1307692)).toBe("30.1");
    expect(fmt.mult(2.2222222)).toBe("2.22");
    expect(dec(199.9994664)).toBe("200");
  });
  it("missing reads as a dash, never NaN", () => {
    expect(fmt.num(null)).toBe("—");
    expect(fmt.pct(Number.NaN)).toBe("—");
  });
});

// ── Placed never exceeds what secured sites can host (audit §1.1 / §1.2) ─────────────────────
import { recommendPlan, demandUnits, DEFAULT_POLICY } from "../src/lib/scheduler";
import { assetSupply, assetDemand, assetMatch, settingVerdicts, type AssetLite } from "../src/lib/assetmap";
import { detectDatedConflicts, conflictGroups, type DatedBooking } from "../src/lib/space";

const assetOf = (o: Partial<AssetLite> & { id: string; employerId: string; facilityName: string }): AssetLite => ({
  externalId: o.id, settingCode: "GEN", setting: "General", assetType: "Room", assetNumber: 1, operatingRule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", shiftBlocks: "Day", hoursPerShift: 8,
  serves: null, learnersPerShift: 2, preceptorsPerShift: 1, dataSource: "VERIFIED", status: "active", agreementStatus: "secured", facilityStatus: "active", ring: "Core", county: "Moore", ...o,
});
const clinicalRow = (id: string, C: number, Y: number, maxStudents: number, dateIso: string): DatedInstance => ({
  session: { id, kind: "CLINICAL", number: 1, title: null, lengthHours: 8, maxStudents, rotationType: "General Radiography", startTime: "07:00", preceptorsNeeded: 1, facultyNeeded: 0, clinicalMode: "Preceptor-led", dayOfWeek: "Mon", week: 1, location: null, deliveryMode: null, notes: null, supportStaffNeeded: 0 },
  computed: { C, Y }, cohortId: "co1", cohort: "Class of 2028", programId: "p1", program: "Rad", courseCode: "RAD-151", courseTitle: "Clin I", courseId: "c1",
  termIndex: 1, termName: "Term 1", semester: "Fall", weekOfTerm: 1, monday: null, mondayIso: dateIso, date: null, dateIso, month: dateIso.slice(0, 7), holiday: null,
} as unknown as DatedInstance);

describe("under secured-only levers, placed ≤ hostable by secured sites", () => {
  const rotations = [{ rotationType: "General Radiography", settingCode: "GEN" }];
  it("holds when the only secured room seats 2 and the asked site would seat 5 more", () => {
    // 5 learners in 5 one-seat sections on Monday 2027-08-23; one secured room (2 seats) and one asked room (5 seats).
    const rows = [clinicalRow("s1", 5, 5, 1, "2027-08-23")];
    const assets = [assetOf({ id: "sec", employerId: "e1", facilityName: "Moore", learnersPerShift: 2 }), assetOf({ id: "ask", employerId: "e2", facilityName: "Hoke", learnersPerShift: 5, agreementStatus: "asked" })];
    const demand = demandUnits(rows, rotations, []);
    const plan = recommendPlan({ demand, assets, overrides: [], existingBookings: [], preceptors: [], instructors: [], students: [], familyAgreements: [], policy: { ...DEFAULT_POLICY, agreements: "secured", skipHolidays: false } });
    const cells = assetMatch(assetDemand(rows, rotations), assetSupply(assets, [], "2027-08-23", "2027-08-23"), [], new Map(assets.map((a) => [a.id, a])));
    const hostedSecured = settingVerdicts(cells, assets).reduce((n, v) => n + v.hostedSecured, 0);
    expect(hostedSecured).toBe(2);
    expect(plan.summary.placedSeats).toBeLessThanOrEqual(hostedSecured);
    expect(plan.summary.placedSeats).toBe(2);
    // With any agreement allowed, the asked site's seats count and everyone is placed.
    const any = recommendPlan({ demand, assets, overrides: [], existingBookings: [], preceptors: [], instructors: [], students: [], familyAgreements: [], policy: { ...DEFAULT_POLICY, agreements: "any", skipHolidays: false } });
    expect(any.summary.placedSeats).toBe(5);
  });
});

// ── Dated conflicts count groups, follow moves (audit §1.5) ──────────────────────────────────
const booking = (o: Partial<DatedBooking> & { id: string }): DatedBooking => ({ cohortId: "co1", sectionIndex: 1, kind: "CLASS", seats: 20, lengthHours: 2, dayOfWeek: "Tue", startMin: 9 * 60, facilityId: "room-1", staffPersonId: null, dateIso: "2026-08-18", ...o });
describe("conflicts on the dates things happen", () => {
  it("counts three sections in one room at once as one conflict group (three pairs)", () => {
    const c = detectDatedConflicts([booking({ id: "a", cohortId: "c1" }), booking({ id: "b", cohortId: "c2" }), booking({ id: "c", cohortId: "c3" })]);
    expect(c).toHaveLength(3);
    const g = conflictGroups(c);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ kind: "room", key: "room-1", dateIso: "2026-08-18" });
    expect(g[0].ids.sort()).toEqual(["a", "b", "c"]);
  });
  it("a shift moved to another date no longer collides on the old one, and collides where it landed", () => {
    const stay = booking({ id: "a", cohortId: "c1" });
    const movedAway = booking({ id: "b", cohortId: "c2", dateIso: "2026-08-20", dayOfWeek: "Thu" });
    expect(detectDatedConflicts([stay, movedAway])).toHaveLength(0);
    const alreadyThere = booking({ id: "c", cohortId: "c3", dateIso: "2026-08-20", dayOfWeek: "Thu" });
    expect(conflictGroups(detectDatedConflicts([stay, movedAway, alreadyThere]))).toHaveLength(1);
  });
  it("separate rooms and non-overlapping times are not conflicts; the same cohort's students in two places are", () => {
    expect(detectDatedConflicts([booking({ id: "a", cohortId: "c1" }), booking({ id: "b", cohortId: "c2", facilityId: "room-2" })])).toHaveLength(0);
    expect(detectDatedConflicts([booking({ id: "a", cohortId: "c1" }), booking({ id: "b", cohortId: "c2", startMin: 11 * 60 })])).toHaveLength(0);
    expect(detectDatedConflicts([booking({ id: "a" }), booking({ id: "b", facilityId: "room-2" })]).map((c) => c.kind)).toEqual(["section"]);
  });
});
