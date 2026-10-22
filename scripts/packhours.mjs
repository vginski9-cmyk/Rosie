// THE HOURS A TERM HOLDS. A credit course's contact load is its catalog weekly hours on a 16-week basis,
// so the hours a student spends in class, lab and clinical over a term are those weekly hours × 16 —
// whatever the term's length: an 8-week summer course meets twice as many hours a week, a 14-week
// online section a little more each week, and the term total is the same. The owner's rule (2026-10-22).
//
// A pack builder takes each course's sessions from the college's posted sections (their days, times and
// rooms place the course on the calendar) and then calls `carryCatalogHours`, which scales the sessions
// of each kind so they sum to the catalog's weekly hours × 16 — the posted shape kept (a 12-hour shift
// stays longer than a 3-hour lab) — lays the sessions of one day end to end from the first one's start,
// (a session posted later than the one before it keeps its own start), and sets the course's weekly-hours
// fields to catalog × 16 ÷ term weeks. A course with no credits (an
// apprenticeship level) is not a credit load and is left as built.

const DAY_ORDER = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const hm = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const mh = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;
const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10000) / 10000;

/** @param course the pack course (weekly fields and sessions) · @param catalog [class, lab, clinical] weekly hours on the 16-week basis · @param termWeeks the term's weeks */
export function carryCatalogHours(course, catalog, termWeeks, log = () => {}) {
  const [c, l, k] = catalog;
  if (!(course.credits > 0)) return course;
  for (const [kind, weekly] of [["CLASS", c], ["LAB", l], ["CLINICAL", k]]) {
    const rows = course.sessions.filter((s) => s.kind === kind);
    const target = weekly * 16;
    const current = rows.reduce((n, s) => n + s.lengthHours, 0);
    if (!rows.length) { if (target > 0) log(`${course.code}: the catalog has ${weekly} ${kind.toLowerCase()} hours a week but no session carries them`); continue; }
    if (Math.abs(current - target) < 0.01) continue;
    const f = target / current;
    for (const s of rows) {
      const was = s.lengthHours;
      s.lengthHours = r4(s.lengthHours * f);
      if (Math.abs(s.lengthHours - was) >= 0.1 && s.startTime && s.endTime) {
        const posted = `${s.startTime}–${s.endTime}`;
        s.notes = `${s.notes ? s.notes + " " : ""}Posted block ${posted}; carried at ${r2(s.lengthHours)} h so the term holds the catalog's ${weekly} ${kind.toLowerCase()} hours a week × 16.`;
      }
    }
  }
  // A day's sessions, end to end from the first one's start, so the class hour and the lab block it leads
  // into never overlap once they carry the catalog's hours.
  const byDay = new Map();
  for (const s of course.sessions) { if (s.dayOfWeek && s.startTime) { const key = `${s.week}|${s.dayOfWeek}`; byDay.set(key, [...(byDay.get(key) ?? []), s]); } }
  for (const rows of byDay.values()) {
    rows.sort((a, b) => hm(a.startTime) - hm(b.startTime));
    let cursor = hm(rows[0].startTime);
    for (const s of rows) { cursor = Math.max(cursor, hm(s.startTime)); s.startTime = mh(cursor); cursor += Math.round(s.lengthHours * 60); s.endTime = mh(cursor); }
  }
  course.weeklyClassHours = r2((c * 16) / termWeeks);
  course.weeklyLabHours = r2((l * 16) / termWeeks);
  course.weeklyClinicalHours = r2((k * 16) / termWeeks);
  return course;
}
export const HOURS_RULE = "Term hours per student are the catalog's weekly contact hours × 16 (the 16-week basis), whatever the term's length: the sessions carry them, the posted days, times and rooms place them.";
