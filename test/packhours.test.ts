import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// The owner's rule (2026-10-22): a credit course's term hours per student are its catalog weekly contact hours
// × 16, whatever the term's length — the sessions carry them. Every Rowan-Cabarrus, Brunswick and Cape Fear pack obeys it.
type S = { kind: string; lengthHours: number; week: number; dayOfWeek: string | null; startTime: string | null; endTime: string | null };
type C = { code: string; credits: number; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number; sessions: S[] };
type P = { name: string; terms: { name: string; startWeek: number; endWeek: number; courses: C[] }[] };
const files = readdirSync("prisma/templates").filter((f) => /^(rccc-|brunswick-|cape-fear-)/.test(f) && f.endsWith(".json"));
const load = (f: string) => JSON.parse(readFileSync(`prisma/templates/${f}`, "utf8")) as P;
const sum = (c: C, kind: string) => Math.round(c.sessions.filter((s) => s.kind === kind).reduce((n, s) => n + s.lengthHours, 0) * 100) / 100;
const near = (a: number, b: number) => Math.abs(a - b) <= 0.06;

describe("term hours per student are the catalog's weekly hours × 16", () => {
  for (const f of files) it(f, () => {
    for (const t of load(f).terms) {
      const weeks = t.endWeek - t.startWeek + 1;
      for (const c of t.courses) {
        if (!(c.credits > 0)) continue;
        // weekly × term weeks = catalog × 16, and the sessions hold exactly that
        for (const [kind, weekly] of [["CLASS", c.weeklyClassHours], ["LAB", c.weeklyLabHours], ["CLINICAL", c.weeklyClinicalHours]] as const) {
          const termHours = Math.round(weekly * weeks * 100) / 100;
          expect(near(sum(c, kind), termHours), `${f} ${t.name} ${c.code} ${kind}: sessions ${sum(c, kind)} h vs ${termHours} h`).toBe(true);
        }
        // a day's sessions never overlap
        const byDay = new Map<string, S[]>();
        for (const s of c.sessions) if (s.dayOfWeek && s.startTime && s.endTime) byDay.set(`${s.week}|${s.dayOfWeek}`, [...(byDay.get(`${s.week}|${s.dayOfWeek}`) ?? []), s]);
        for (const rows of byDay.values()) { rows.sort((a, b) => a.startTime!.localeCompare(b.startTime!)); for (let i = 1; i < rows.length; i++) expect(rows[i].startTime! >= rows[i - 1].endTime!, `${c.code} ${rows[i].dayOfWeek} overlap`).toBe(true); }
      }
    }
  });
  it("spot values: ELC 112 144 h, BPR 130 48 h in the 8-week summer, EGR 125 online 16 + 32, NUR 111 256 h, NUR 213 352 h, NUR 113 in the 9-week summer 48 + 96; the apprenticeship stays at 84", () => {
    const aas = load("rccc-est-aas.json"); const course = (p: P, code: string) => p.terms.flatMap((t) => t.courses).find((c) => c.code === code)!;
    const elc112 = course(aas, "ELC 112"); expect([sum(elc112, "CLASS"), sum(elc112, "LAB")]).toEqual([48, 96]);
    expect(sum(course(aas, "BPR 130"), "CLASS")).toBe(48); expect(course(aas, "BPR 130").weeklyClassHours).toBe(6);
    const egr = course(aas, "EGR 125"); expect(near(sum(egr, "CLASS"), 16) && near(sum(egr, "LAB"), 32)).toBe(true); expect(Math.min(...egr.sessions.map((s) => s.week))).toBe(3);
    const adn = load("brunswick-adn.json");
    const n111 = course(adn, "NUR 111"); expect([sum(n111, "CLASS"), sum(n111, "LAB"), sum(n111, "CLINICAL")]).toEqual([64, 96, 96]);
    const n213 = course(adn, "NUR 213"); expect([sum(n213, "CLASS"), sum(n213, "LAB"), sum(n213, "CLINICAL")]).toEqual([64, 48, 240]);
    const n113 = course(adn, "NUR 113"); expect(near(sum(n113, "CLASS"), 48) && near(sum(n113, "CLINICAL"), 96)).toBe(true);
    const appr = load("rccc-electrician-apprenticeship.json"); expect(sum(course(appr, "ELC-3014B"), "CLASS")).toBe(84);
  });
});
