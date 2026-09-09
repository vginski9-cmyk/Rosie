import { describe, it, expect } from "vitest";
import { startOfRange, startTimeFromNotes, endTimeFromNotes, sectionSlotsFromNotes, dayInText, encodeSectionTimes, decodeSectionTimes, sectionSlot } from "../src/lib/sessiontimes";

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
    expect(startOfRange("Friday 6:30-12:30")).toBe("06:30");
    expect(startOfRange("10-1")).toBe("10:00");
    expect(startOfRange("1-3")).toBe("13:00");
    expect(startTimeFromNotes("M, T, 8:30 am – 3:00 pm & Friday 6:30-12:30; 2.5 hrs online", "Fri")).toBe("06:30");
    expect(startTimeFromNotes("M, T, 8:30 am – 3:00 pm & Friday 6:30-12:30; 2.5 hrs online", "Tue")).toBe("08:30");
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
  it("reads per-section slots, with the stated end of each section's window", () => {
    expect(sectionSlotsFromNotes("Two Sctions- Section 1: 8-10:50a (13 students); Section 2: 1:40 to 4:30p (12 students)")).toEqual([{ dayOfWeek: null, startTime: "08:00", endTime: "10:50" }, { dayOfWeek: null, startTime: "13:40", endTime: "16:30" }]);
    expect(sectionSlotsFromNotes("Section 1: W, 8a-10:50a (13 students); Section 2: W, 1:40p to 4:30p (12 students)")).toEqual([{ dayOfWeek: "Wed", startTime: "08:00", endTime: "10:50" }, { dayOfWeek: "Wed", startTime: "13:40", endTime: "16:30" }]);
    expect(sectionSlotsFromNotes("Two Sections: Section 1, T, 8:30a - 10:50a (12 students) or Section 2, T, 2:00p - 4:20p (13 students)")).toEqual([{ dayOfWeek: "Tue", startTime: "08:30", endTime: "10:50" }, { dayOfWeek: "Tue", startTime: "14:00", endTime: "16:20" }]);
    // Two blocks with a break: the window runs from the first start to the last end.
    expect(sectionSlotsFromNotes("Section 1: 8 to 9:20am & 9:30am to 10:50am (13 students); Section 2: 2:20 to 3:40pm & 3:50 to 5:10pm (12 students)")).toEqual([{ dayOfWeek: null, startTime: "08:00", endTime: "10:50" }, { dayOfWeek: null, startTime: "14:20", endTime: "17:10" }]);
    // A shared range: "Section 1, T, or Section 2, Th, 12:30p - 4:10p" — both sections at 12:30, on their own days.
    expect(sectionSlotsFromNotes("Two Sections: Section 1, T, or Section 2, Th, 12:30p - 4:10p + online, SMTWThFS")).toEqual([{ dayOfWeek: "Tue", startTime: "12:30", endTime: "16:10" }, { dayOfWeek: "Thu", startTime: "12:30", endTime: "16:10" }]);
    expect(sectionSlotsFromNotes("One Section: T, 12:30p - 2:30p")).toEqual([]);
  });
  it("reads the stated end of a session's window on its day", () => {
    expect(endTimeFromNotes("M, 11:20a - 12:20m, and 1:00p -1:50p", "Mon")).toBe("13:50");
    expect(endTimeFromNotes("M, 11am-12pm; 12:30pm to 1:30pm", "Mon")).toBe("13:30");
    expect(endTimeFromNotes("M, T, 8:30 am – 3:00 pm & Friday 6:30-12:30 (times may vary per facility)", "Fri")).toBe("12:30");
    expect(endTimeFromNotes("M, T, 8:30 am – 3:00 pm & Friday 6:30-12:30 (times may vary per facility)", "Mon")).toBe("15:00");
    expect(endTimeFromNotes("M & T, 6:30a - 3:30p; F, 6:30a - 12:30p; (Days/hrs vary per census; 19.2 hrs/wk)", "Fri")).toBe("12:30");
    expect(endTimeFromNotes("Section 1, 8:30a-11:10a (13 students); Section 2, 2:00p - 4:50p (12 students)", "Mon")).toBe("16:50");
    expect(endTimeFromNotes("Th, 1 - 1:50p; 2 -3:50p", "Thu")).toBe("15:50");
    expect(endTimeFromNotes("TTh, 7.5 hrs /day, precepted", "Tue")).toBeNull();
    expect(endTimeFromNotes("W, 11:10a - 1:50p", "Wed")).toBe("13:50");
  });
  it("round-trips the column and resolves a section's slot", () => {
    const enc = encodeSectionTimes([{ dayOfWeek: "Wed", startTime: "08:00", endTime: "10:50" }, { dayOfWeek: null, startTime: "13:40" }]);
    expect(enc).toBe("Wed@08:00-10:50,13:40");
    expect(decodeSectionTimes(enc)).toEqual([{ dayOfWeek: "Wed", startTime: "08:00", endTime: "10:50" }, { dayOfWeek: null, startTime: "13:40", endTime: null }]);
    const s = { dayOfWeek: "Mon", startTime: "08:00", sectionTimes: enc };
    expect(sectionSlot(s, 1)).toEqual({ dayOfWeek: "Wed", startTime: "08:00", endTime: "10:50" });
    expect(sectionSlot(s, 2)).toEqual({ dayOfWeek: "Mon", startTime: "13:40", endTime: null });
    // A third section cycles back to the first stated slot (a "T or Th" lab's §3 meets Tuesday).
    expect(sectionSlot(s, 3)).toEqual({ dayOfWeek: "Wed", startTime: "08:00", endTime: "10:50" });
    expect(sectionSlot({ dayOfWeek: "Mon", startTime: "08:00", endTime: "10:00" }, 1)).toEqual({ dayOfWeek: "Mon", startTime: "08:00", endTime: "10:00" });
    expect(sectionSlot({ dayOfWeek: "Mon", startTime: null }, 1)).toBeNull();
  });
});

describe("end-only meridiem", () => {
  it("'1 - 1:50p' is 13:00, not 01:00", () => { expect(startOfRange("Th, 1 - 1:50p; 2 -3:50p")).toBe("13:00"); });
  it("'10 to 1pm' is still 10:00", () => { expect(startOfRange("10 to 1pm")).toBe("10:00"); });
});
