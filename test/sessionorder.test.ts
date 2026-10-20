import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { compareSessions } from "../src/lib/sessionorder";

describe("sessions are listed in the order they run", () => {
  it("by week, then day, then start time, then kind, then number — a mis-numbered week-10 row never lands in week 6", () => {
    const rows = [
      { kind: "CLASS", number: 18, week: 10, dayOfWeek: "Tue", startTime: "09:00" },
      { kind: "CLASS", number: 17, week: 6, dayOfWeek: "Thu", startTime: "09:00" },
      { kind: "LAB", number: 1, week: 1, dayOfWeek: "Tue", startTime: "13:00" },
      { kind: "CLASS", number: 1, week: 1, dayOfWeek: "Tue", startTime: "09:00" },
      { kind: "CLASS", number: 2, week: 1, dayOfWeek: null, startTime: null },
      { kind: "CLINICAL", number: 3, week: 1, dayOfWeek: "Tue", startTime: "09:00" },
    ];
    expect([...rows].sort(compareSessions).map((r) => `${r.kind}#${r.number}/wk${r.week}`)).toEqual(["CLASS#1/wk1", "CLINICAL#3/wk1", "LAB#1/wk1", "CLASS#2/wk1", "CLASS#17/wk6", "CLASS#18/wk10"]);
  });
});

// Every template pack numbers each course's sessions uniquely per kind, in week order (the importer
// renumbers a workbook that does not; Roanoke-Chowan's sheet numbered two week-10 classes 18 and 19).
type S = { kind: string; number: number; week: number | null };
type Course = { code: string; sessions: S[] };
const packs = readdirSync("prisma/templates").filter((f) => f.endsWith(".json") && !/asset|volume/.test(f));
const coursesOf = (file: string): Course[] => {
  const j = JSON.parse(readFileSync(`prisma/templates/${file}`, "utf8")) as unknown;
  const items = (Array.isArray(j) ? j : [j]) as { terms?: { courses: Course[] }[]; course?: { code: string } | null; sessions?: S[] }[];
  return items.flatMap((t) => [...(t.terms ?? []).flatMap((x) => x.courses), ...(t.course && t.sessions ? [{ code: t.course.code, sessions: t.sessions }] : [])]);
};
describe("template packs number sessions in week order", () => {
  for (const file of packs) it(file, () => {
    for (const c of coursesOf(file)) for (const kind of ["CLASS", "LAB", "CLINICAL"]) {
      const rows = c.sessions.filter((s) => s.kind === kind);
      const nums = rows.map((s) => s.number);
      expect(new Set(nums).size, `${file} ${c.code} ${kind}: duplicate numbers`).toBe(nums.length);
      const byNumber = [...rows].sort((a, b) => a.number - b.number);
      for (let i = 1; i < byNumber.length; i++) expect((byNumber[i].week ?? 0) >= (byNumber[i - 1].week ?? 0), `${file} ${c.code} ${kind}: #${byNumber[i].number} (week ${byNumber[i].week}) numbered after #${byNumber[i - 1].number} (week ${byNumber[i - 1].week})`).toBe(true);
    }
  });
});
