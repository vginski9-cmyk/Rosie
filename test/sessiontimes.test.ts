import { describe, it, expect } from "vitest";
import { startOfRange, startTimeFromNotes, sectionSlotsFromNotes, dayInText, encodeSectionTimes, decodeSectionTimes, sectionSlot } from "../src/lib/sessiontimes";

describe("session times read from the sheet's notes", () => {
  it("reads a start time and infers am/pm from the end of the range", () => {
    expect(startOfRange("Th, 3 hrs/class, 8:30 to 11a")).toBe("08:30");
    expect(startOfRange("8:30-9:20a, (50 min. in-person)")).toBe("08:30");
    expect(startOfRange("Th, 8:30a-3p")).toBe("08:30");
    expect(startOfRange("M, 11am-12pm; 12:30pm to 1:30pm")).toBe("11:00");
    expect(startOfRange("12:30pm to 1:30pm")).toBe("12:30");
    expect(startOfRange("1:40 to 4:30p (12 students)")).toBe("13:40");
    expect(startOfRange("2:20 to 3:40pm & 3:50 to 5:10pm")).toBe("14:20");
    expect(startOfRange("10 to 1pm")).toBe("10:00");
    expect(startOfRange("Precepted 8am to 3:30pm + out rotations")).toBe("08:00");
    expect(startOfRange("12:30p - 4:10p + online")).toBe("12:30");
  });
  it("does not mistake durations or counts for times", () => {
    expect(startOfRange("T & Th, 7.5 hrs /day, precepted")).toBeNull();
    expect(startOfRange("Online 2hrs, 10min, SMTWThFS")).toBeNull();
    expect(startOfRange("3 hrs/class")).toBeNull();
  });
  it("picks the range that follows the session's weekday", () => {
    expect(startTimeFromNotes("M, 11am-12pm; W, 1-2pm", "Wed")).toBe("13:00");
    expect(startTimeFromNotes("M, 11am-12pm; W, 1-2pm", "Mon")).toBe("11:00");
    expect(startTimeFromNotes("Th, 3 hrs/class, 8:30 to 11a", "Thu")).toBe("08:30");
  });
  it("reads weekday tokens", () => {
    expect(dayInText("W, 8a-10:50a")).toBe("Wed"); expect(dayInText("T, 12:30p")).toBe("Tue"); expect(dayInText("Th, 8:30a")).toBe("Thu"); expect(dayInText("8-10:50a (13 students)")).toBeNull();
  });
  it("reads per-section slots", () => {
    expect(sectionSlotsFromNotes("Two Sctions- Section 1: 8-10:50a (13 students); Section 2: 1:40 to 4:30p (12 students)")).toEqual([{ dayOfWeek: null, startTime: "08:00" }, { dayOfWeek: null, startTime: "13:40" }]);
    expect(sectionSlotsFromNotes("Section 1: W, 8a-10:50a (13 students); Section 2: W, 1:40p to 4:30p (12 students)")).toEqual([{ dayOfWeek: "Wed", startTime: "08:00" }, { dayOfWeek: "Wed", startTime: "13:40" }]);
    expect(sectionSlotsFromNotes("Two Sections: Section 1, T, 8:30a - 10:50a (12 students) or Section 2, T, 2:00p - 4:20p (13 students)")).toEqual([{ dayOfWeek: "Tue", startTime: "08:30" }, { dayOfWeek: "Tue", startTime: "14:00" }]);
    // A shared range: "Section 1, T, or Section 2, Th, 12:30p - 4:10p" — both sections at 12:30, on their own days.
    expect(sectionSlotsFromNotes("Two Sections: Section 1, T, or Section 2, Th, 12:30p - 4:10p + online, SMTWThFS")).toEqual([{ dayOfWeek: "Tue", startTime: "12:30" }, { dayOfWeek: "Thu", startTime: "12:30" }]);
    expect(sectionSlotsFromNotes("One Section: T, 12:30p - 2:30p")).toEqual([]);
  });
  it("round-trips the column and resolves a section's slot", () => {
    const enc = encodeSectionTimes([{ dayOfWeek: "Wed", startTime: "08:00" }, { dayOfWeek: null, startTime: "13:40" }]);
    expect(enc).toBe("Wed@08:00,13:40");
    expect(decodeSectionTimes(enc)).toEqual([{ dayOfWeek: "Wed", startTime: "08:00" }, { dayOfWeek: null, startTime: "13:40" }]);
    const s = { dayOfWeek: "Mon", startTime: "08:00", sectionTimes: enc };
    expect(sectionSlot(s, 1)).toEqual({ dayOfWeek: "Wed", startTime: "08:00" });
    expect(sectionSlot(s, 2)).toEqual({ dayOfWeek: "Mon", startTime: "13:40" });
    expect(sectionSlot(s, 3)).toEqual({ dayOfWeek: "Mon", startTime: "08:00" });
    expect(sectionSlot({ dayOfWeek: "Mon", startTime: null }, 1)).toBeNull();
  });
});
