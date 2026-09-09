import { describe, it, expect } from "vitest";
import { buildRotationPlan, evaluatePlan, DEFAULT_ROTATION_OPTIONS, type RotationInput, type RotationShift } from "../src/lib/rotations";
import type { AssetLite } from "../src/lib/assetmap";

const asset = (id: string, employerId: string, settingCode: string, learnersPerShift = 1): AssetLite => ({
  id, externalId: id, employerId, facilityName: employerId, settingCode, setting: settingCode, assetType: settingCode, assetNumber: 1,
  operatingRule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", shiftBlocks: "Day", hoursPerShift: 8, dayStart: "07:00", dayHours: 8, eveningStart: "15:00", eveningHours: 8, nightStart: "23:00", nightHours: 8,
  serves: null, learnersPerShift, preceptorsPerShift: 1, dataSource: "VERIFIED", status: "active",
});
// Sixteen Tuesday shifts of 7.5 h, Sept–Dec 2026.
const shifts: RotationShift[] = Array.from({ length: 16 }, (_, w) => { const d = new Date(Date.UTC(2026, 8, 1) + w * 7 * 86400000); const iso = d.toISOString().slice(0, 10); const mon = new Date(d.getTime() - 86400000).toISOString().slice(0, 10); return { sessionId: `s${w + 1}`, date: iso, weekMonday: mon, block: "Day", hours: 7.5, rotationType: "General", settingCode: "GEN", holiday: null }; });
const students = Array.from({ length: 6 }, (_, i) => ({ id: `st${i + 1}`, name: `Student ${i + 1}`, seat: i + 1, sectionIndex: i + 1, homeEmployerId: "hosp" }));
const base = (): RotationInput => ({
  students, shifts,
  areas: [{ code: "GEN", name: "General", settingCodes: ["GEN"], hours: 75 }, { code: "ED", name: "Emergency", settingCodes: ["ED"], hours: 15 }, { code: "PORT", name: "Portables", settingCodes: ["PORT"], hours: 15 }],
  sites: [{ employerId: "hosp", name: "Hospital", agreementRank: 0, approvedCapacity: null, annualSurgicalCases: null }, { employerId: "clinic", name: "Clinic", agreementRank: 0, approvedCapacity: null, annualSurgicalCases: null }],
  assets: [asset("g1", "hosp", "GEN", 4), asset("g2", "hosp", "GEN", 2), asset("e1", "hosp", "ED", 1), asset("p1", "hosp", "PORT", 1), asset("g3", "clinic", "GEN", 2)],
  overrides: [], existingBookings: [], pins: {}, options: { ...DEFAULT_ROTATION_OPTIONS },
});

describe("clinical rotation planner", () => {
  it("places every student on every shift within capacity and finishes every area's hours", () => {
    const plan = buildRotationPlan(base());
    expect(plan.unplaced.length).toBe(0);
    expect(plan.placements.length).toBe(6 * 16);
    for (const s of plan.students) { expect(s.byArea.ED.planned).toBeGreaterThanOrEqual(15); expect(s.byArea.PORT.planned).toBeGreaterThanOrEqual(15); expect(s.shortHours).toBe(0); }
    // Never more than the seat count in a setting on a day.
    for (const l of plan.loads) expect(l.used).toBeLessThanOrEqual(l.capacity);
  });
  it("rotates students through the scarce settings in blocks, not everyone at once", () => {
    const plan = buildRotationPlan(base());
    const edByDate = new Map<string, number>();
    for (const p of plan.placements) if (p.settingCode === "ED") edByDate.set(p.date, (edByDate.get(p.date) ?? 0) + 1);
    expect(Math.max(...edByDate.values())).toBe(1); // one ED seat a day
    // A student stays in ED for consecutive shifts until the 15 h are done (two 7.5 h shifts).
    const st1 = plan.placements.filter((p) => p.studentId === "st1").map((p) => p.settingCode);
    const firstEd = st1.indexOf("ED");
    expect(st1[firstEd + 1]).toBe("ED");
  });
  it("uses another site only when the home site has no seat of the setting, and never past the accreditor cap", () => {
    const input = base();
    input.sites[0].approvedCapacity = 4; // JRCERT: 4 students at once at the hospital
    const plan = buildRotationPlan(input);
    for (const l of plan.loads.filter((l) => l.employerId === "hosp")) expect(l.used).toBeLessThanOrEqual(4);
    // With six students and a cap of four, two go to the clinic on general days.
    expect(plan.placements.some((p) => p.employerId === "clinic" && p.away)).toBe(true);
    for (const p of plan.placements.filter((p) => p.away)) expect(p.settingCode).toBe("GEN"); // ED and PORT exist only at the hospital
  });
  it("honours a pin and reports a bottleneck when a setting has no capacity", () => {
    const input = base();
    input.assets = input.assets.filter((a) => a.settingCode !== "PORT");
    input.pins = { "st3|2026-09-01": "ED" };
    const plan = buildRotationPlan(input);
    const st3first = plan.placements.find((p) => p.studentId === "st3" && p.date === "2026-09-01")!;
    expect(st3first.settingCode).toBe("ED"); expect(st3first.pinned).toBe(true);
    expect(plan.students.every((s) => s.byArea.PORT.short === 15)).toBe(true);
    expect(plan.summary.studentsShort).toBe(6);
  });
  it("caps OR days by case volume", () => {
    const input = base();
    input.areas = [{ code: "OR", name: "Operating room", settingCodes: ["OR"], hours: 120 }];
    input.assets = [asset("or1", "hosp", "OR", 10)];
    input.sites[0].annualSurgicalCases = 1000; // 4 cases a day → 2 students a day at 2 cases each
    const plan = buildRotationPlan(input);
    for (const l of plan.loads) expect(l.used).toBeLessThanOrEqual(2);
    expect(plan.unplaced.length).toBe(6 * 16 - 2 * 16);
  });
  it("evaluatePlan scores saved placements the same way", () => {
    const input = base();
    const plan = buildRotationPlan(input);
    const again = evaluatePlan(input, plan.placements);
    expect(again.summary.placed).toBe(plan.summary.placed);
    expect(again.students.map((s) => s.shortHours)).toEqual(plan.students.map((s) => s.shortHours));
  });
});

describe("when the primary rooms are full", () => {
  it("gives a student an extra day in a completed area instead of an idle day", () => {
    const input = base();
    input.assets = [asset("g1", "hosp", "GEN", 5), asset("e1", "hosp", "ED", 1), asset("p1", "hosp", "PORT", 1)]; // five GEN seats for six students
    const plan = buildRotationPlan(input);
    expect(plan.unplaced.length).toBe(0);
    expect(plan.placements.some((p) => p.reason.startsWith("extra"))).toBe(true);
  });
});
