// Rebuild the Surgical Technology template pack from the program's "Raw Data & Calculations" table
// (the owner's sheet, saved as tab-separated text): every session row, column for column, in the
// pack shape prisma/seed.ts createPackProgram reads (prisma/templates/surgtech.json).
//
//   node scripts/import-surgtech-pack.mjs prisma/templates/source/surgtech-raw-data.tsv prisma/templates/surgtech.json
//
// Columns are found by their header text. The sheet's computed columns (space hours, sections,
// contact-hour totals) are not copied — the app derives them. Nothing in a row is reinterpreted:
// a row tagged online stays online, a 0 in a staffing cell stays 0. The only derived values are
// each row's start and end time, read from its notes for the row's own weekday ("M & T, 6:30a -
// 3:30p; F, 6:30a - 12:30p" gives a Friday row 06:30–12:30), the term windows (a term is as long
// as its highest session week; terms run back to back) and each course's weekly hours by kind.
import { readFileSync, writeFileSync } from "node:fs";
import XLSX from "xlsx";

const src = process.argv[2] ?? "prisma/templates/source/surgtech-raw-data.tsv";
const out = process.argv[3] ?? "prisma/templates/surgtech.json";
const wb = XLSX.read(readFileSync(src, "utf8"), { type: "string", raw: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: true });

const str = (v) => (v === "" || v == null ? null : String(v).trim());
const num = (v) => (v === "" || v == null ? null : Number(v));
const DAY = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };
const dayOf = (v) => DAY[String(v ?? "").trim().toLowerCase()] ?? null;
const kindOf = (v) => { const s = String(v ?? "").toLowerCase(); return /clinic|rotation|practicum|extern|precept/.test(s) ? "CLINICAL" : /lab|skills|sim/.test(s) ? "LAB" : "CLASS"; };
const modeOf = (v) => { const s = str(v); if (!s) return null; return /^online$/i.test(s) ? "Online" : /^in.?person$/i.test(s) ? "In-person" : s; };

// ── Time windows from the notes, for the row's own weekday ────────────────────────────────────
const DAY_TOKEN = { Mon: /\b(m|mon|monday)\b/i, Tue: /\b(t|tu|tue|tues|tuesday)\b/i, Wed: /\b(w|wed|wednesday)\b/i, Thu: /\b(th|thu|thur|thurs|thursday)\b/i, Fri: /\b(f|fri|friday)\b/i, Sat: /\b(sa|sat|saturday)\b/i, Sun: /\b(su|sun|sunday)\b/i };
const RANGE = /(?<![\d:.])(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?(?![\d:])/i;
const hhmm = (h, m) => `${String(h).padStart(2, "0")}:${m ?? "00"}`;
/** One "start–end" window as HH:MM pair, with the sheet's am/pm read as written and inferred where it is left off. */
function windowOf(text) {
  const m = RANGE.exec(text ?? ""); if (!m) return null;
  let sh = Number(m[1]), sm = m[2], sp = m[3]?.toLowerCase() ?? null, eh = Number(m[4]), em = m[5], ep = m[6]?.toLowerCase() ?? null;
  if (sh > 12 || eh > 12) return null; // not a clock range ("19.2 hrs/wk")
  // The end's period when it is not written: past noon when it is smaller than the start ("8:30-2:30"), noon for 12, else the start's period.
  if (!ep) ep = eh === 12 ? "p" : sp ? (eh < sh ? (sp === "a" ? "p" : "a") : sp) : eh < sh ? "p" : null;
  // The start's period when it is not written: noon for 12; before noon when it is later than a post-noon end ("8:30-3p") or an early hour opening a long day ("6:30-12:30"); otherwise the end's period.
  if (!sp) sp = sh === 12 ? "p" : ep === "p" ? (sh > eh || sh >= 7 ? "a" : eh === 12 ? "a" : "p") : ep === "a" ? "a" : sh >= 7 || eh === 12 ? "a" : "p";
  if (!ep) ep = sp;
  const to24 = (h, p) => (h === 12 ? (p === "a" ? 0 : 12) : p === "p" ? h + 12 : h);
  return { start: hhmm(to24(sh, sp), sm), end: hhmm(to24(eh, ep), em) };
}
/** The row's window: the note segment that names its weekday and carries a range, else the first range in the note. */
function timesFor(notes, day) {
  if (!notes) return { startTime: null, endTime: null };
  const segments = notes.split(/[;&+]|\band\b/i).map((s) => s.trim()).filter(Boolean);
  const own = day ? segments.find((s) => DAY_TOKEN[day]?.test(s.replace(/\d[\d:.]*\s*[ap]?\.?m?/gi, " ")) && windowOf(s)) : null;
  const w = windowOf(own ?? notes);
  return w ? { startTime: w.start, endTime: w.end } : { startTime: null, endTime: null };
}

// ── Columns by header text ────────────────────────────────────────────────────────────────────
const header = rows[0].map((h) => String(h).toLowerCase());
const col = (re) => { const i = header.findIndex((h) => re.test(h)); if (i < 0) { console.error(`column not found: ${re}`); process.exit(1); } return i; };
const C = {
  term: col(/^term number/), semester: col(/^semester/), enrollment: col(/^enrollment/), code: col(/^course code/), title: col(/^course title/),
  kind: col(/^session type/), number: col(/^session number/), sessionTitle: col(/^session title/), mode: col(/^session delivery mode/), location: col(/^session location/), length: col(/^session length/),
  max: col(/^max number of students/), faculty: col(/^number of faculty required/), facultyPolicy: col(/policy for faculty/), support: col(/^number of support staff/), supportPolicy: col(/policy for support staff/),
  week: col(/during week/), day: col(/occurs on/), notes: col(/^notes/), preceptors: col(/^number of preceptors/), preceptorPolicy: col(/policy for preceptors/), rotation: col(/^clinical rotation type/), clinicalMode: col(/^clinical mode/),
};
const session = (r) => {
  const day = dayOf(r[C.day]); const notes = str(r[C.notes]); const online = /^online$/i.test(String(r[C.day] ?? "").trim());
  const t = day ? timesFor(notes, day) : { startTime: null, endTime: null };
  return {
    kind: kindOf(r[C.kind]), number: num(r[C.number]), title: str(r[C.sessionTitle]),
    deliveryMode: modeOf(r[C.mode]), location: str(r[C.location]),
    lengthHours: num(r[C.length]) ?? 0, maxStudents: num(r[C.max]) ?? 1,
    facultyNeeded: num(r[C.faculty]) ?? 0, facultyContactPolicy: num(r[C.facultyPolicy]),
    supportStaffNeeded: num(r[C.support]) ?? 0, supportContactPolicy: num(r[C.supportPolicy]),
    week: num(r[C.week]), dayOfWeek: day, startTime: t.startTime, endTime: t.endTime, sectionTimes: null,
    notes: notes ? (online ? `${notes} · Online (no fixed weekday)` : notes) : online ? "Online (no fixed weekday)" : null,
    preceptorsNeeded: num(r[C.preceptors]) ?? 0, preceptorContactPolicy: num(r[C.preceptorPolicy]),
    rotationType: str(r[C.rotation]), clinicalMode: str(r[C.clinicalMode]),
  };
};

// ── Terms (by Term Number) → courses (in sheet order) → sessions ──────────────────────────────
const terms = new Map();
for (const r of rows.slice(1)) {
  const code = str(r[C.code]); if (!code) continue;
  const tn = Number(String(r[C.term]).replace(/\D+/g, "")); if (!tn) { console.error(`row without a term number: ${code}`); process.exit(1); }
  const t = terms.get(tn) ?? { index: tn, semester: str(r[C.semester]), enrollment: num(r[C.enrollment]), courses: new Map() };
  const c = t.courses.get(code) ?? { code, title: str(r[C.title]) ?? code, sessions: [] };
  c.sessions.push(session(r)); t.courses.set(code, c); terms.set(tn, t);
}
const hoursOf = (ss, kind) => ss.filter((s) => s.kind === kind).reduce((n, s) => n + s.lengthHours, 0);
let startWeek = 1;
const packTerms = [...terms.values()].sort((a, b) => a.index - b.index).map((t) => {
  const courses = [...t.courses.values()];
  const weeks = Math.max(1, ...courses.flatMap((c) => c.sessions.map((s) => s.week ?? 1)));
  const term = { index: t.index, name: `Term ${t.index}`, semester: t.semester, startWeek, endWeek: startWeek + weeks - 1, weeks, courses: courses.map((c) => ({ code: c.code, title: c.title, weeklyClassHours: Math.round((hoursOf(c.sessions, "CLASS") / weeks) * 100) / 100, weeklyLabHours: Math.round((hoursOf(c.sessions, "LAB") / weeks) * 100) / 100, weeklyClinicalHours: Math.round((hoursOf(c.sessions, "CLINICAL") / weeks) * 100) / 100, sessions: c.sessions })) };
  startWeek += weeks; return term;
});
const maxCohort = Math.max(...packTerms.flatMap((t) => t.courses.flatMap((c) => c.sessions.filter((s) => s.kind !== "CLINICAL").map((s) => s.maxStudents))));
const pack = {
  name: "Surgical Technology", programType: "Traditional Full Time", credential: "AAS",
  sourceWorkbook: "Owner's corrected Raw Data & Calculations sheet (2026-09-23), saved as " + src, sourceSheet: "SURGICAL TECHNOLOGISTS",
  institution: "Sandhills Community College", modeledEnrollment: 19, maxCohort,
  weeklyHoursNote: "weekly course hours = the sheet's session hours per course and kind ÷ term weeks (term weeks = highest session week in the term)",
  assumptions: { facContactHours: 16, facWorkWeekHours: 40, facTermWeeks: 16, preContactHours: 40, preWorkWeekHours: 40, preTermWeeks: 16 },
  terms: packTerms,
};
writeFileSync(out, JSON.stringify(pack, null, 2) + "\n");
for (const t of packTerms) for (const c of t.courses) {
  const by = new Map();
  for (const s of c.sessions) { const k = `${s.kind} ${s.dayOfWeek ?? "—"} ${s.startTime ?? "—"}–${s.endTime ?? "—"} ${s.lengthHours}h max${s.maxStudents} fac${s.facultyNeeded} pre${s.preceptorsNeeded} ${s.deliveryMode ?? ""}/${s.location ?? ""}${s.rotationType ? ` · ${s.rotationType}` : ""}`; const e = by.get(k) ?? { n: 0, w: [] }; e.n++; e.w.push(s.week ?? 0); by.set(k, e); }
  console.log(`T${t.index} ${t.semester} wk${t.startWeek}–${t.endWeek} · ${c.code} ${c.title} · ${c.weeklyClassHours}/${c.weeklyLabHours}/${c.weeklyClinicalHours} h/wk · ${c.sessions.length} sessions`);
  for (const [k, e] of by) console.log(`    ${e.n}× ${k} · weeks ${Math.min(...e.w)}–${Math.max(...e.w)}`);
}
console.log("wrote", out, "· terms", packTerms.length, "· sessions", packTerms.reduce((n, t) => n + t.courses.reduce((m, c) => m + c.sessions.length, 0), 0), "· maxCohort", maxCohort);
