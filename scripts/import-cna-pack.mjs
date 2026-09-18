// Rebuild a template pack from a college's program-structure workbook: an exact copy of the
// workbook's "Raw Data & Calculations" session table (every session row, column for column), plus
// the workbook's faculty and preceptor workload assumptions.
//
//   node scripts/import-cna-pack.mjs <workbook.xlsx> [prisma/templates/<pack>.json]
//
//   Carteret:       … Carteret_Community_College_for_Claude.xlsx prisma/templates/cna.json
//   Lenoir:         … Lenoir_Community_College_Demo_model_for_CNAs_for_Claude.xlsx prisma/templates/cna-lenoir.json
//   Roanoke-Chowan: … Roanoke_Chowan_Community_College_Demo_model_for_CNAs_for_Claude.xlsx prisma/templates/ma-roanoke-chowan.json
//
// Two workbook shapes:
//  · Delivery models — every course code names an offering ("… (5-week offering)", "… (Monday &
//    Wednesday 20-week Offering)"): one single-term template per code (the Nurse Aide packs).
//  · One program in terms — the codes are the program's courses, each in its term (Term Number,
//    else the order the semesters appear: "MED 3300 (Part 1)" in Fall, "(Part 2)" in Spring):
//    one template with a term per semester (Roanoke-Chowan's Medical Assisting).
//
// Columns are found by their header text, so every layout reads. The workbook's computed columns
// (space hours, sections, contact-hour totals) are not copied — the app derives them.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import XLSX from "xlsx";

const src = process.argv[2];
const out = process.argv[3] ?? "prisma/templates/cna.json";
if (!src) { console.error("usage: node scripts/import-cna-pack.mjs <workbook.xlsx> [out.json]"); process.exit(1); }
const wb = XLSX.read(readFileSync(src), { type: "buffer" });
const ws = wb.Sheets[wb.SheetNames.find((n) => /raw data/i.test(n)) ?? wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

const str = (v) => (v === "" || v == null ? null : String(v).trim());
const num = (v) => (v === "" || v == null ? null : Number(v));
const DAY = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };
const dayOf = (v) => DAY[String(v).trim().toLowerCase()] ?? null; // "Online" → null: no fixed weekday
/** "Class" / "Lab" / "Clinical" (and the workbooks' spellings of them). */
const kindOf = (v) => { const s = String(v ?? "").toLowerCase(); return /clinic|rotation|practicum|extern|precept/.test(s) ? "CLINICAL" : /lab|skills|sim/.test(s) ? "LAB" : /class|lecture|didactic|online/.test(s) ? "CLASS" : String(v).toUpperCase(); };
/** The time of day a session starts, as the workbook's notes give it ("5:30p-9:30p", "8am - 2:30pm",
 *  "8a-2:30p or 8:30a-3p" → the first), as "HH:MM"; null when the notes name no time. */
export function startTimeOf(notes) {
  const text = notes ?? "";
  const hhmm = (h, m) => `${String(h).padStart(2, "0")}:${m ?? "00"}`;
  // A range whose start carries no am/pm ("12:00-2:30pm", "12p-2:30p" handled below): noon is
  // noon, 1–6 is afternoon, 7–11 is morning.
  const range = /(?<![\d:])(\d{1,2})(?::(\d{2}))?\s*[-–]\s*\d{1,2}(?::\d{2})?\s*[ap]\.?m?\b/i.exec(text);
  const m = /(?<![\d:])(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\b/i.exec(text);
  if (range && (!m || range.index <= m.index)) { const h = Number(range[1]); return hhmm(h === 12 ? 12 : h <= 6 ? h + 12 : h, range[2]); }
  if (!m) return null;
  let h = Number(m[1]) % 12; if (m[3].toLowerCase() === "p") h += 12;
  return hhmm(h, m[2]);
}

// The header row names every column; find each by a phrase from its header.
const header = rows[0].map((h) => String(h).toLowerCase());
const col = (re, required = true) => {
  const i = header.findIndex((h) => re.test(h));
  if (i < 0 && required) { console.error(`column not found: ${re}`); process.exit(1); }
  return i;
};
const C = {
  enrollment: col(/^enrollment/), code: col(/^course code/), title: col(/^course title/),
  kind: col(/^session type/), number: col(/^session number/), sessionTitle: col(/^session title/),
  mode: col(/^session delivery mode/), location: col(/^session location/), length: col(/^session length/),
  max: col(/^max number of students/), faculty: col(/^number of faculty required/), facultyPolicy: col(/policy for faculty/),
  support: col(/^number of support staff/), supportPolicy: col(/policy for support staff/),
  week: col(/during week/), day: col(/occurs on/), notes: col(/^notes/),
  preceptors: col(/^number of preceptors/), preceptorPolicy: col(/policy for preceptors/),
  rotation: col(/^clinical rotation type/), clinicalMode: col(/^clinical mode/),
  term: col(/^term number/, false), semester: col(/^semester/, false),
};

// The two workload-assumption blocks sit to the right of the session table beside the first
// rows: a label cell ("Faculty Workload Assumptions:") with the values in the next four columns.
const block = (label) => {
  const re = new RegExp(label, "i");
  for (const r of rows) {
    const j = r.findIndex((v) => re.test(String(v)));
    if (j >= 0) return { contactHours: num(r[j + 1]), workWeekHours: num(r[j + 2]), conversion: num(r[j + 3]), termWeeks: num(r[j + 4]) };
  }
  return null;
};
const fac = block("Faculty Workload") ?? { contactHours: 16, workWeekHours: 40, termWeeks: 16 };
const pre = block("Preceptor Workload") ?? fac;
const assumptions = { facContactHours: fac.contactHours, facWorkWeekHours: fac.workWeekHours, facTermWeeks: fac.termWeeks, preContactHours: pre.contactHours, preWorkWeekHours: pre.workWeekHours, preTermWeeks: pre.termWeeks };

const session = (r) => ({
  kind: kindOf(r[C.kind]), number: num(r[C.number]), title: str(r[C.sessionTitle]),
  deliveryMode: str(r[C.mode]), location: str(r[C.location]),
  lengthHours: num(r[C.length]) ?? 0, maxStudents: num(r[C.max]) ?? 1,
  facultyNeeded: num(r[C.faculty]) ?? 0, facultyContactPolicy: num(r[C.facultyPolicy]),
  supportStaffNeeded: num(r[C.support]) ?? 0, supportContactPolicy: num(r[C.supportPolicy]),
  week: num(r[C.week]), dayOfWeek: dayOf(r[C.day]), startTime: startTimeOf(str(r[C.notes])), notes: str(r[C.notes]),
  preceptorsNeeded: num(r[C.preceptors]) ?? 0, preceptorContactPolicy: num(r[C.preceptorPolicy]),
  rotationType: str(r[C.rotation]), clinicalMode: str(r[C.clinicalMode]),
});
const hoursOf = (sessions, kind) => sessions.filter((s) => s.kind === kind).reduce((n, s) => n + s.lengthHours, 0);
const weeklyOf = (sessions, kind, weeks) => Math.round((hoursOf(sessions, kind) / weeks) * 100) / 100;
const lastWeekOf = (sessions) => Math.max(...sessions.map((s) => s.week ?? 1));

// Group the session rows by course code (in the order the workbook lists them).
const groups = new Map();
for (const r of rows.slice(1)) {
  const code = str(r[C.code]); if (!code) continue;
  if (!groups.has(code)) groups.set(code, { code, title: str(r[C.title]) ?? "", enrollment: num(r[C.enrollment]), term: C.term >= 0 ? num(r[C.term]) : null, semester: C.semester >= 0 ? str(r[C.semester]) : null, rows: [] });
  groups.get(code).rows.push(r);
}

/** "NAS 111 (curriculum) & NAS 3240 (continuing ed) (5-week offering)" → the offering label and the course code without it. */
const split = (code) => {
  const m = /\(([^()]*week[^()]*)\)\s*$/i.exec(code);
  const label = m ? m[1].trim() : code;
  const bare = m ? code.slice(0, m.index).trim().replace(/[;\s]+$/, "") : code;
  return { label, bare };
};
/** Time of day and audience from the workbook's own words (session notes and title). */
const programType = (label, notes) => {
  const text = `${label} ${notes}`.toLowerCase();
  if (/high school|pre-apprentice/.test(text)) return "High school pre-apprenticeship";
  if (/night|evening|5:30p|6:00p/.test(text)) return /summer/.test(text) ? "Summer evening" : "Evening";
  if (/\bfs\b|fri|sat/.test(text) && /daytime/.test(label)) return "Daytime (Fri/Sat)";
  return "Daytime";
};
const stripParen = (s) => s.replace(/\s*\([^()]*\)\s*$/, "").trim(); // "Nurse Aide Level I (5-week offering)" → "Nurse Aide Level I"
const sourceWorkbook = basename(src).replace(/^[0-9a-f]{8}-/, "");

const templates = [];
const isModels = [...groups.values()].every((g) => /\([^()]*week[^()]*\)\s*$/i.test(g.code));
if (isModels) {
  // One single-term template per delivery model.
  for (const g of groups.values()) {
    const { label, bare } = split(g.code);
    const sessions = g.rows.map(session);
    // The term is as long as the offering's name says ("18-week"), and at least as far as the
    // workbook's sessions reach, so every session row stays dated even where the sheet's week
    // numbers outrun the name (Carteret's 5-week rows reach week 6).
    const named = /(\d+)-week/i.exec(label);
    const lastWeek = lastWeekOf(sessions);
    const termWeeks = Math.max(lastWeek, named ? Number(named[1]) : 0);
    if (named && Number(named[1]) !== lastWeek) console.warn(`${label}: sessions run to week ${lastWeek} though the offering is named ${named[1]}-week — term kept at ${termWeeks} weeks`);
    const title = stripParen(g.title);
    const notes = sessions.map((s) => s.notes ?? "").join(" ");
    templates.push({
      name: `${title} — ${label}`, label, programType: programType(label, notes), credential: "Certificate",
      sourceWorkbook, termWeeks, maxCohort: g.enrollment ?? 10, assumptions,
      course: { code: bare, title, weeklyClassHours: weeklyOf(sessions, "CLASS", termWeeks), weeklyLabHours: weeklyOf(sessions, "LAB", termWeeks), weeklyClinicalHours: weeklyOf(sessions, "CLINICAL", termWeeks) },
      sessions,
    });
  }
} else {
  // One program: its courses in their terms, a term per Term Number (else per semester, in the
  // order the workbook lists them).
  const termKeys = [];
  const keyOf = (g) => String(g.term ?? g.semester ?? 1);
  for (const g of groups.values()) if (!termKeys.includes(keyOf(g))) termKeys.push(keyOf(g));
  const terms = termKeys.map((k, i) => {
    const gs = [...groups.values()].filter((g) => keyOf(g) === k);
    const semester = gs.find((g) => g.semester)?.semester ?? null;
    const courses = gs.map((g) => ({ code: g.code, title: g.title, sessions: g.rows.map(session) }));
    const weeks = Math.max(...courses.map((c) => lastWeekOf(c.sessions)));
    return {
      index: i + 1, name: `Term ${i + 1}`, semester, weeks, enrollment: gs[0].enrollment ?? null,
      courses: courses.map((c) => ({ code: c.code, title: c.title, weeklyClassHours: weeklyOf(c.sessions, "CLASS", weeks), weeklyLabHours: weeklyOf(c.sessions, "LAB", weeks), weeklyClinicalHours: weeklyOf(c.sessions, "CLINICAL", weeks), sessions: c.sessions })),
    };
  });
  const title = stripParen([...groups.values()][0].title);
  const allSessions = terms.flatMap((t) => t.courses.flatMap((c) => c.sessions));
  const notes = allSessions.map((s) => s.notes ?? "").join(" ");
  const label = terms.map((t) => t.semester ?? t.name).join(" · ");
  const first = terms[0];
  templates.push({
    name: title, label, programType: programType(label, notes), credential: "Certificate",
    sourceWorkbook, termWeeks: first.weeks, maxCohort: first.enrollment ?? 10, assumptions,
    course: first.courses[0] ? { code: first.courses[0].code, title: first.courses[0].title, weeklyClassHours: first.courses[0].weeklyClassHours, weeklyLabHours: first.courses[0].weeklyLabHours, weeklyClinicalHours: first.courses[0].weeklyClinicalHours } : null,
    sessions: first.courses[0]?.sessions ?? [],
    terms,
  });
}
writeFileSync(out, JSON.stringify(templates, null, 2) + "\n");
for (const t of templates) {
  if (t.terms) for (const term of t.terms) console.log(`${t.name} · ${t.programType} · ${term.name} (${term.semester ?? "—"}) ${term.weeks} wks · ${term.courses.map((c) => `${c.code}: ${c.sessions.length} sessions, class ${c.weeklyClassHours} / lab ${c.weeklyLabHours} / clinical ${c.weeklyClinicalHours} h/wk`).join("; ")}`);
  else console.log(`${t.name} · ${t.programType} · ${t.termWeeks} wks · ${t.sessions.length} sessions · ${t.course.code} · class ${t.course.weeklyClassHours} / lab ${t.course.weeklyLabHours} / clinical ${t.course.weeklyClinicalHours} h/wk`);
}
console.log("assumptions:", JSON.stringify(assumptions));
console.log("wrote", out);
