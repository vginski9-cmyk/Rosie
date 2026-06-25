import { describe, it, expect } from "vitest";
import { expandSchedule, summarize, gridByWeekDay, staffLoads, staffLoadDetail, studentsForShift, shiftHoursFor, detectSectionConflicts, type ScheduleSession, type SectionStudent, type SectionSlot } from "../src/lib/schedule";

const base = (over: Partial<ScheduleSession>): ScheduleSession => ({
  id: "s", courseId: "c", courseCode: "RAD-111", courseName: "Procedures I", kind: "CLASS",
  title: "Lecture", lengthHours: 3, maxStudents: 30, facultyNeeded: 1, preceptorsNeeded: 0,
  week: 1, dayOfWeek: "Mon", location: "Room 1", rotationType: null, clinicalMode: null, ...over,
});

describe("expandSchedule", () => {
  it("creates one shift per section = ROUNDUP(enrollment / max)", () => {
    const shifts = expandSchedule([base({ id: "x", maxStudents: 30 })], 41); // ceil(41/30)=2
    expect(shifts).toHaveLength(2);
    expect(shifts.map((s) => s.sectionIndex)).toEqual([1, 2]);
    expect(shifts[0].staffType).toBe("instructor");
  });

  it("clinical with preceptors makes preceptor shifts", () => {
    const shifts = expandSchedule([base({ id: "cl", kind: "CLINICAL", maxStudents: 8, facultyNeeded: 0, preceptorsNeeded: 1 })], 41); // ceil(41/8)=6
    expect(shifts).toHaveLength(6);
    expect(shifts.every((s) => s.staffType === "preceptor")).toBe(true);
  });

  it("sorts by week then day", () => {
    const shifts = expandSchedule([
      base({ id: "a", week: 2, dayOfWeek: "Mon", maxStudents: 100 }),
      base({ id: "b", week: 1, dayOfWeek: "Wed", maxStudents: 100 }),
      base({ id: "c", week: 1, dayOfWeek: "Mon", maxStudents: 100 }),
    ], 20);
    expect(shifts.map((s) => `${s.week}-${s.day}`)).toEqual(["1-Mon", "1-Wed", "2-Mon"]);
  });
});

describe("summarize", () => {
  it("counts shifts and staff slots by type", () => {
    const shifts = expandSchedule([
      base({ id: "cls", kind: "CLASS", maxStudents: 30, facultyNeeded: 1 }), // 2 instr shifts
      base({ id: "lab", kind: "LAB", maxStudents: 12, facultyNeeded: 2 }),   // ceil(41/12)=4 shifts × 2 instr = 8 slots
      base({ id: "cln", kind: "CLINICAL", maxStudents: 8, facultyNeeded: 0, preceptorsNeeded: 1 }), // 6 preceptor shifts
    ], 41);
    const s = summarize(shifts);
    expect(s.classShifts).toBe(2);
    expect(s.labShifts).toBe(4);
    expect(s.clinicalShifts).toBe(6);
    expect(s.instructorSlots).toBe(2 + 4 * 2); // class 2 + lab 8
    expect(s.preceptorSlots).toBe(6);
  });
});

describe("co-teaching split contact hours", () => {
  const coTaught = base({
    id: "ct", maxStudents: 100, lengthHours: 3,
    staff: [
      { personId: "A", name: "Inst A", role: "instructor", contactHours: 2, segment: "Lecture" },
      { personId: "B", name: "Inst B", role: "instructor", contactHours: 1, segment: "Lab" },
    ],
  });

  it("attributes each instructor only their share of the session length", () => {
    const [shift] = expandSchedule([coTaught], 30);
    expect(shiftHoursFor(shift, "A")).toBe(2);
    expect(shiftHoursFor(shift, "B")).toBe(1);
    // unknown person (manual override) earns the full length
    expect(shiftHoursFor(shift, "Z")).toBe(3);
  });

  it("staffLoadDetail weights contact hours by the co-teaching split", () => {
    const shifts = expandSchedule([coTaught], 30);
    const loads = staffLoadDetail(shifts, { [shifts[0].id]: ["A", "B"] }, 1);
    const a = loads.find((l) => l.personId === "A")!;
    const b = loads.find((l) => l.personId === "B")!;
    expect(a.classHours).toBe(2);
    expect(b.classHours).toBe(1);
  });
});

describe("studentsForShift", () => {
  const students: SectionStudent[] = [
    { id: "s1", name: "One", sectionIndex: 1 },
    { id: "s2", name: "Two", sectionIndex: 2 },
    { id: "s3", name: "Three", sectionIndex: 3 },
  ];
  it("puts everyone in a single-section session", () => {
    const [shift] = expandSchedule([base({ id: "lec", maxStudents: 100 })], 30); // 1 section
    expect(studentsForShift(shift, students).map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });
  it("splits students across multiple sections round-robin", () => {
    const shifts = expandSchedule([base({ id: "lab", maxStudents: 1 })], 2); // 2 sections
    expect(studentsForShift(shifts[0], students).map((s) => s.id)).toEqual(["s1", "s3"]); // sections 1,3 -> shift 1
    expect(studentsForShift(shifts[1], students).map((s) => s.id)).toEqual(["s2"]); // section 2 -> shift 2
  });
});

describe("detectSectionConflicts", () => {
  const slot = (over: Partial<SectionSlot>): SectionSlot => ({ key: "s", day: "Mon", startTime: "13:00", lengthHours: 3, location: "Lab A", ...over });

  it("flags two sections sharing a room at overlapping times", () => {
    const r = detectSectionConflicts([
      slot({ key: "a" }),
      slot({ key: "b", startTime: "14:00" }), // overlaps 13:00–16:00 in Lab A
    ]);
    expect(r.clashing.has("a") && r.clashing.has("b")).toBe(true);
    expect(r.pairs).toHaveLength(1);
  });

  it("no clash when same time but different rooms", () => {
    const r = detectSectionConflicts([slot({ key: "a", location: "Lab A" }), slot({ key: "b", location: "Lab B" })]);
    expect(r.clashing.size).toBe(0);
  });

  it("no clash when same room but non-overlapping (back-to-back)", () => {
    const r = detectSectionConflicts([slot({ key: "a", startTime: "13:00" }), slot({ key: "b", startTime: "16:00" })]);
    expect(r.clashing.size).toBe(0);
  });

  it("reports peak concurrency per day (rooms/faculty needed at once)", () => {
    const r = detectSectionConflicts([
      slot({ key: "a", location: "L1" }), slot({ key: "b", location: "L2" }), slot({ key: "c", location: "L3" }),
    ]);
    expect(r.peakConcurrencyByDay.Mon).toBe(3); // three running at once, three rooms
    expect(r.clashing.size).toBe(0); // different rooms → no double-booking
  });
});

describe("gridByWeekDay + staffLoads", () => {
  it("buckets by week/day and tallies assigned load", () => {
    const shifts = expandSchedule([base({ id: "x", maxStudents: 20, lengthHours: 4 })], 30); // 2 shifts wk1 Mon
    const grid = gridByWeekDay(shifts);
    expect(grid.get(1)?.get("Mon")?.length).toBe(2);
    const loads = staffLoads(shifts, { [shifts[0].id]: ["p1"], [shifts[1].id]: ["p1"] });
    expect(loads[0]).toEqual({ personId: "p1", shifts: 2, hours: 8 });
  });
});
