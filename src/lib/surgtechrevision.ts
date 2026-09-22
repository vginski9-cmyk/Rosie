// SURGICAL TECHNOLOGY — THE REVISED MEETING PATTERN, as the program stated it, applied to a copy
// of the Sandhills template. Pure: takes the template's terms as plain rows and returns the
// revised rows plus a note per change, so the seed writes exactly what the test checks.
//
// What the program said (2026-09-22), and how each line is represented:
//  · Term 1, SUR 111: besides the Monday meeting, Thursday 8:30–3:00 runs every week, part in a
//    classroom and part in the lab. The workbook carried that Thursday as a 6-hour lab tagged
//    "Online / Internet", which every calendar reads as no meeting at all — so it never appeared.
//    It becomes two in-person lab blocks: 8:30–11:30 in the classroom and 12:00–3:00 in the lab.
//    (The program also spoke of a Tuesday meeting; the workbook has none, and none is invented.)
//  · Term 2, SUR 122: every Thursday 8:30–11 and 12–3. The morning class is as the workbook has it;
//    the afternoon lab becomes the full 12:00–3:00 in person, and the workbook's duplicate "online"
//    lab rows (the same hours tagged online) go, so the catalog's 3 lab hours a week are that block.
//  · Term 2, SUR 123: clinicals Monday and Tuesday 6:30–3:00 and Friday 6:30–12:30 (the workbook had
//    Monday and Tuesday at 8:30). Per-site capacity varies (some sites take more than one learner a
//    rotation): that lives on each site's record, never on the template — the session stays 1:1.
//  · Term 3, same remarks: SUR 134 Thursday 8:30–11 and 12–3 in person (the online share of its
//    8 class hours shrinks to the remaining 2.5); SUR 135 clinicals Mon/Tue 6:30–3:00, Fri 6:30–12:30.
//  · Term 4, SUR 210: clinicals every Wednesday and Thursday 6:30–3:00. The workbook had SUR 210 in
//    Term 5 on alternating weeks; the program places it in Term 4, so the copy moves it there.

export interface RevSession {
  kind: string; number: number; title: string | null; lengthHours: number; deliveryMode: string | null; location: string | null;
  maxStudents: number; facultyNeeded: number; supportStaffNeeded: number; preceptorsNeeded: number;
  week: number | null; dayOfWeek: string | null; startTime: string | null; endTime: string | null; sectionTimes: string | null;
  rotationType: string | null; experiences: string | null; progression: string | null; clinicalMode: string | null; notes: string | null; homework: string | null;
  facultyContactPolicy: number | null; supportContactPolicy: number | null; preceptorContactPolicy: number | null;
}
export interface RevCourse { code: string | null; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number; sessions: RevSession[] }
export interface RevTerm { index: number; startWeek: number | null; endWeek: number | null; courses: RevCourse[] }

export const SURG_TECH_REVISED_NAME = "Surgical Technology (revised)";
const CLASSROOM = "Kennedy Hall 148", LAB = "Kennedy Hall Lab 129";
const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hoursBetween = (start: string, end: string) => { const [a, b] = [start, end].map((t) => { const [h, m] = t.split(":").map(Number); return h + m / 60; }); return Math.round((b - a) * 100) / 100; };
const at = (s: RevSession, start: string, end: string, extra: Partial<RevSession> = {}): RevSession => ({ ...s, startTime: start, endTime: end, lengthHours: hoursBetween(start, end), deliveryMode: "In-person", ...extra });
const isOnline = (s: RevSession) => /online|internet/i.test(s.deliveryMode ?? "") || /^internet$/i.test(s.location ?? "");
/** Sessions numbered per kind in week and weekday order, as the workbook numbers them. */
function renumber(sessions: RevSession[]): RevSession[] {
  const sorted = [...sessions].sort((a, b) => (a.week ?? 0) - (b.week ?? 0) || DAY_ORDER.indexOf(a.dayOfWeek ?? "") - DAY_ORDER.indexOf(b.dayOfWeek ?? "") || (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.number - b.number);
  const n = new Map<string, number>();
  return sorted.map((s) => { const k = (n.get(s.kind) ?? 0) + 1; n.set(s.kind, k); return { ...s, number: k }; });
}

export interface Revision { terms: RevTerm[]; moves: { code: string; fromTerm: number; toTerm: number }[]; notes: string[] }

export function reviseSurgTech(input: RevTerm[]): Revision {
  const terms: RevTerm[] = input.map((t) => ({ ...t, courses: t.courses.map((c) => ({ ...c, sessions: c.sessions.map((s) => ({ ...s })) })) }));
  const notes: string[] = []; const moves: Revision["moves"] = [];
  const find = (code: string) => { for (const t of terms) { const i = t.courses.findIndex((c) => c.code === code); if (i >= 0) return { term: t, course: t.courses[i], i }; } return null; };
  const weeksOf = (t: RevTerm) => Math.max(1, (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1);

  // Term 1 · SUR 111 — the Thursday block, in person, classroom then lab.
  const c111 = find("SUR 111");
  if (c111) {
    const out: RevSession[] = [];
    let split = 0;
    for (const s of c111.course.sessions) {
      if (s.kind === "LAB" && s.dayOfWeek === "Thu") {
        out.push(at(s, "08:30", "11:30", { location: CLASSROOM, notes: "Thursday, classroom portion" }), at(s, "12:00", "15:00", { location: LAB, notes: "Thursday, lab portion" }));
        split++;
      } else out.push(s);
    }
    c111.course.sessions = renumber(out);
    notes.push(`SUR 111: ${split} Thursday lab blocks now meet in person 8:30–11:30 (${CLASSROOM}) and 12:00–3:00 (${LAB}); the workbook had them tagged online`);
  }
  // Term 2 · SUR 122 — Thursday 8:30–11 class, 12–3 lab; the duplicate online lab rows go.
  const c122 = find("SUR 122");
  if (c122) {
    const before = c122.course.sessions.length;
    const out = c122.course.sessions.filter((s) => !(s.kind === "LAB" && isOnline(s))).map((s) => (s.kind === "LAB" && s.dayOfWeek === "Thu" ? at(s, "12:00", "15:00", { location: LAB }) : s.kind === "CLASS" && s.dayOfWeek === "Thu" ? at(s, "08:30", "11:00", { location: CLASSROOM }) : s));
    c122.course.sessions = renumber(out);
    notes.push(`SUR 122: Thursday class 8:30–11:00 and lab 12:00–3:00 in person; ${before - out.length} duplicate online lab rows removed`);
  }
  // Clinical practice I and II — Monday and Tuesday 6:30–3:00, Friday 6:30–12:30.
  for (const code of ["SUR 123", "SUR 135"]) {
    const c = find(code); if (!c) continue;
    c.course.sessions = renumber(c.course.sessions.map((s) => (s.kind !== "CLINICAL" ? s : s.dayOfWeek === "Fri" ? at(s, "06:30", "12:30") : s.dayOfWeek === "Mon" || s.dayOfWeek === "Tue" ? at(s, "06:30", "15:00") : s)));
    const weekly = c.course.sessions.filter((s) => s.kind === "CLINICAL" && s.week === 1).reduce((n, s) => n + s.lengthHours, 0);
    c.course.weeklyClinicalHours = weekly;
    notes.push(`${code}: clinicals Monday and Tuesday 6:30–3:00, Friday 6:30–12:30 — ${weekly} clinical hours a week`);
  }
  // Term 3 · SUR 134 — the same Thursday pattern as SUR 122, both blocks in the classroom (no lab in its catalog hours).
  const c134 = find("SUR 134");
  if (c134) {
    const out: RevSession[] = [];
    for (const s of c134.course.sessions) {
      if (s.kind === "CLASS" && s.dayOfWeek === "Thu") { out.push(at(s, "08:30", "11:00", { location: CLASSROOM }), at(s, "12:00", "15:00", { location: CLASSROOM, title: s.title ? `${s.title} (afternoon)` : null })); }
      else if (s.kind === "CLASS" && isOnline(s)) out.push({ ...s, lengthHours: Math.max(0, Math.round((c134.course.weeklyClassHours - 5.5) * 100) / 100) });
      else out.push(s);
    }
    c134.course.sessions = renumber(out);
    notes.push(`SUR 134: Thursday 8:30–11:00 and 12:00–3:00 in person; the online share is the remaining ${Math.round((c134.course.weeklyClassHours - 5.5) * 100) / 100} h of its ${c134.course.weeklyClassHours} class hours a week`);
  }
  // Term 4 · SUR 210 — every Wednesday and Thursday 6:30–3:00, in Term 4.
  const c210 = find("SUR 210");
  const t4 = terms.find((t) => t.index === 4);
  if (c210 && t4) {
    const model = c210.course.sessions.find((s) => s.kind === "CLINICAL" && s.dayOfWeek === "Wed") ?? c210.course.sessions.find((s) => s.kind === "CLINICAL");
    if (model) {
      const weeks = weeksOf(t4);
      const others = c210.course.sessions.filter((s) => s.kind !== "CLINICAL");
      const clin: RevSession[] = [];
      for (let w = 1; w <= weeks; w++) for (const day of ["Wed", "Thu"]) clin.push(at({ ...model, week: w, dayOfWeek: day, title: model.title }, "06:30", "15:00"));
      c210.course.sessions = renumber([...others, ...clin]);
      c210.course.weeklyClinicalHours = 2 * hoursBetween("06:30", "15:00");
      if (c210.term.index !== 4) {
        c210.term.courses.splice(c210.i, 1);
        t4.courses.push(c210.course);
        moves.push({ code: "SUR 210", fromTerm: c210.term.index, toTerm: 4 });
      }
      notes.push(`SUR 210: clinicals every Wednesday and Thursday 6:30–3:00 over Term 4's ${weeks} weeks (${clin.length} shifts, ${c210.course.weeklyClinicalHours} clinical hours a week)${moves.length ? `; moved from Term ${moves[0].fromTerm} to Term 4` : ""}`);
    }
  }
  return { terms, moves, notes };
}
