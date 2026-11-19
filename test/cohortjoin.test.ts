import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyJoins, sharedCodes, hostTermOf, joinerTermOf, joinerSeatOffsets, hostSeat, headcount, type JoinableCohort } from "../src/lib/cohortjoin";

// Shared sections (2026-11-19): a joiner's course whose code the mapped host term carries is the host's section;
// its other courses stay its own; its shared terms take the host's dates; the same meeting is never counted twice.
type Pack = { maxCohort: number; terms: { index: number; courses: { code: string }[] }[] };
const pack = (file: string) => JSON.parse(readFileSync(new URL(`../prisma/templates/${file}`, import.meta.url), "utf8")) as Pack;
const fromPack = (id: string, p: Pack, seats: number, join?: JoinableCohort["join"]): JoinableCohort => ({
  cohortId: id, cohort: id, join,
  enrollmentByTerm: Object.fromEntries(p.terms.map((t) => [t.index, seats])),
  termStartByIndex: Object.fromEntries(p.terms.map((t) => [t.index, `2027-0${Math.min(9, t.index)}-01`])),
  termEndByIndex: Object.fromEntries(p.terms.map((t) => [t.index, `2027-0${Math.min(9, t.index)}-28`])),
  courses: p.terms.flatMap((t) => t.courses.map((c) => ({ code: c.code, termIndex: t.index }))),
});
const codesOf = (m: Map<number, Set<string>>) => Object.fromEntries([...m.entries()].map(([k, v]) => [k, [...v].sort()]));
const termCodes = (c: JoinableCohort, k: number) => c.courses.filter((x) => x.termIndex === k).map((x) => x.code).sort();

describe("the term mapping", () => {
  it("maps joiner terms onto host terms from the join on", () => {
    const j = { hostCohortId: "h", atTermIndex: 2, hostTermIndex: 4 };
    expect([1, 2, 3, 4].map((k) => hostTermOf(j, k))).toEqual([null, 4, 5, 6]);
    expect([3, 4, 5, 6].map((h) => joinerTermOf(j, h))).toEqual([null, 2, 3, 4]);
  });
});

describe("which courses are shared (the real packs)", () => {
  const adn = pack("brunswick-adn.json");
  it("Brunswick's LPN-to-ADN joins the ADN's second year: NUR 113, then NUR 211, 212 and BIO 275, then NUR 213 — not its own ENG 112 or humanities elective", () => {
    const host = fromPack("adn", adn, 50);
    const lpn = fromPack("lpn", pack("brunswick-lpn-adn.json"), 20, { hostCohortId: "adn", atTermIndex: 1, hostTermIndex: 4 });
    expect(codesOf(sharedCodes(lpn, host, lpn.join!))).toEqual({ 1: ["NUR 113"], 2: ["BIO 275", "NUR 211", "NUR 212"], 3: ["NUR 213"] });
  });
  it("Brunswick's Paramedic-to-ADN joins at its second term: NUR 113, 211, 212, 213 only", () => {
    const host = fromPack("adn", adn, 50);
    const pm = fromPack("pm", pack("brunswick-paramedic-adn.json"), 10, { hostCohortId: "adn", atTermIndex: 2, hostTermIndex: 4 });
    expect(codesOf(sharedCodes(pm, host, pm.join!))).toEqual({ 2: ["NUR 113"], 3: ["NUR 211", "NUR 212"], 4: ["NUR 213"] });
  });
  it("Southeastern's LPN-to-ADN joins the second-year class: NUR 212 and PSY 241, then NUR 213 and PHI 240 — NUR 211 stays its own (the ADN teaches it in the first spring)", () => {
    const host = fromPack("adn", pack("southeastern-adn.json"), 60);
    const lpn = fromPack("lpn", pack("southeastern-lpn-adn.json"), 20, { hostCohortId: "adn", atTermIndex: 2, hostTermIndex: 4 });
    expect(codesOf(sharedCodes(lpn, host, lpn.join!))).toEqual({ 2: ["NUR 212", "PSY 241"], 3: ["NUR 213", "PHI 240"] });
  });
});

describe("applyJoins", () => {
  const host: JoinableCohort = { cohortId: "fall", cohort: "Class of 2028 · ADN Fall Entry", enrollmentByTerm: { 1: 80, 2: 56, 3: 56, 4: 56, 5: 56 }, termStartByIndex: { 1: "2026-08-17", 2: "2027-01-05", 3: "2027-05-17", 4: "2027-08-16", 5: "2028-01-10" }, termEndByIndex: { 1: "2026-12-11", 2: "2027-05-05", 3: "2027-07-27", 4: "2027-12-10", 5: "2028-05-05" },
    courses: [{ code: "NUR 111", termIndex: 1 }, { code: "BIO 168", termIndex: 1 }, { code: "NUR 112", termIndex: 2 }, { code: "NUR 114", termIndex: 2 }, { code: "BIO 169", termIndex: 2 }, { code: "NUR 113", termIndex: 3 }, { code: "NUR 211", termIndex: 4 }, { code: "NUR 212", termIndex: 4 }, { code: "NUR 213", termIndex: 5 }] };
  const transition: JoinableCohort = { cohortId: "nt", cohort: "Class of 2028 · Nursing Transition", join: { hostCohortId: "fall", atTermIndex: 1, hostTermIndex: 2 }, enrollmentByTerm: { 1: 10, 2: 7, 3: 7, 4: 7 }, termStartByIndex: { 1: "2027-01-11", 2: null, 3: null, 4: null },
    courses: [{ code: "NUR 112", termIndex: 1 }, { code: "NUR 114", termIndex: 1 }, { code: "BIO 169", termIndex: 1 }, { code: "NUR 113", termIndex: 2 }, { code: "NUR 211", termIndex: 3 }, { code: "NUR 212", termIndex: 3 }, { code: "NUR 213", termIndex: 4 }] };
  it("Cape Fear's Nursing Transition sits in the fall-entry class from its second semester: the host's seats rise, the joiner's courses are held in the host, its dates are the host's", () => {
    const [h, t] = applyJoins([host, transition]);
    expect(h.enrollmentByTerm).toEqual({ 1: 80, 2: 66, 3: 63, 4: 63, 5: 63 });
    expect(h.joinedSeats).toEqual({ 2: [{ cohortId: "nt", cohortName: "Class of 2028 · Nursing Transition", joinerTermIndex: 1, seats: 10 }], 3: [{ cohortId: "nt", cohortName: "Class of 2028 · Nursing Transition", joinerTermIndex: 2, seats: 7 }], 4: [{ cohortId: "nt", cohortName: "Class of 2028 · Nursing Transition", joinerTermIndex: 3, seats: 7 }], 5: [{ cohortId: "nt", cohortName: "Class of 2028 · Nursing Transition", joinerTermIndex: 4, seats: 7 }] });
    expect(t.courses).toEqual([]);
    expect(t.heldIn.map((x) => `${x.code}@${x.termIndex}→${x.hostTermIndex}`)).toEqual(["NUR 112@1→2", "NUR 114@1→2", "BIO 169@1→2", "NUR 113@2→3", "NUR 211@3→4", "NUR 212@3→4", "NUR 213@4→5"]);
    expect(t.termStartByIndex).toEqual({ 1: "2027-01-05", 2: "2027-05-17", 3: "2027-08-16", 4: "2028-01-10" });
    expect(t.termEndByIndex).toEqual({ 1: "2027-05-05", 2: "2027-07-27", 3: "2027-12-10", 4: "2028-05-05" });
    expect(t.joinUnresolved).toBeUndefined();
    // Inputs untouched.
    expect(host.enrollmentByTerm[2]).toBe(56); expect(transition.courses).toHaveLength(7); expect(transition.termStartByIndex[2]).toBeNull();
  });
  it("a joiner's own courses in a shared term stay its own, and no code is held twice in a host term", () => {
    const adn = fromPack("adn", pack("brunswick-adn.json"), 50);
    const lpn = fromPack("lpn", pack("brunswick-lpn-adn.json"), 20, { hostCohortId: "adn", atTermIndex: 1, hostTermIndex: 4 });
    const pm = fromPack("pm", pack("brunswick-paramedic-adn.json"), 10, { hostCohortId: "adn", atTermIndex: 2, hostTermIndex: 4 });
    const [h, l, p] = applyJoins([adn, lpn, pm]);
    expect(termCodes(l, 1)).toEqual(["ENG 112 or ENG 114"]); expect(termCodes(l, 2)).toEqual([]); expect(termCodes(l, 3)).toEqual(["HUM/Fine Arts elective"]);
    expect(termCodes(p, 1)).toEqual(["BIO 275", "NUR 215"]); expect(termCodes(p, 2)).toEqual(["ENG 112 or ENG 114"]); expect(termCodes(p, 3)).toEqual(["PSY 241"]);
    expect(h.enrollmentByTerm).toEqual({ 1: 50, 2: 50, 3: 50, 4: 80, 5: 80, 6: 80 });
    // Nothing a joiner keeps is also held by the host in that term (two joiners may each keep their own ENG section).
    for (const ht of [4, 5, 6]) for (const own of [termCodes(l, ht - 3), termCodes(p, ht - 2)]) expect(own.filter((c) => termCodes(h, ht).includes(c)), `host term ${ht}`).toEqual([]);
  });
  it("refuses a chained join and a join past the host's last term", () => {
    const a: JoinableCohort = { cohortId: "a", cohort: "A", enrollmentByTerm: { 1: 10, 2: 10 }, termStartByIndex: { 1: "2027-01-04", 2: "2027-05-17" }, courses: [{ code: "X 1", termIndex: 1 }, { code: "X 2", termIndex: 2 }] };
    const b: JoinableCohort = { ...a, cohortId: "b", cohort: "B", join: { hostCohortId: "a", atTermIndex: 1, hostTermIndex: 2 } };
    const c: JoinableCohort = { ...a, cohortId: "c", cohort: "C", join: { hostCohortId: "b", atTermIndex: 1, hostTermIndex: 1 } };
    const [ra, rb, rc] = applyJoins([a, b, c]);
    expect(rb.joinUnresolved).toMatch(/runs past the host's last term/);
    expect(rc.joinUnresolved).toMatch(/cannot chain/);
    expect(ra.enrollmentByTerm[2]).toBe(20); // the part of B's join that fits still counts
    expect(rb.enrollmentByTerm).toEqual(b.enrollmentByTerm);
  });
});

describe("seats and headcounts", () => {
  it("joiner seats follow the host's planned seats in start order, and the host's headcount says who sits in", () => {
    const offsets = joinerSeatOffsets({ cohortId: "adn", plannedSeats: 50, enrollmentByTerm: { 1: 50 } }, [{ cohortId: "lpn", plannedSeats: 20, startIso: "2027-05-24", name: "LPN" }, { cohortId: "pm", plannedSeats: 10, startIso: "2027-01-06", name: "PM" }]);
    expect([...offsets.entries()]).toEqual([["pm", 50], ["lpn", 60]]);
    expect(hostSeat(offsets.get("lpn")!, 3)).toBe(63);
    expect(headcount({ students: 80, joiners: [{ students: 10 }] })).toEqual({ own: 80, joined: 10, label: "80 + 10 joined" });
    expect(headcount({ students: 80 }).label).toBe("80");
  });
});
