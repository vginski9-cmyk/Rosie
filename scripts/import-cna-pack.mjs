// Rebuild a Nurse Aide I template pack from a college's program-structure workbook: one template
// per delivery model, each an exact copy of the workbook's "Raw Data & Calculations" session
// table (every session row, column for column), plus the workbook's faculty and preceptor
// workload assumptions.
//
//   node scripts/import-cna-pack.mjs <workbook.xlsx> [prisma/templates/cna.json]
//
//   Carteret:  node scripts/import-cna-pack.mjs Carteret_Community_College_for_Claude.xlsx prisma/templates/cna.json
//   Lenoir:    node scripts/import-cna-pack.mjs Lenoir_Community_College_Demo_model_for_CNAs_for_Claude.xlsx prisma/templates/cna-lenoir.json
//
// Columns are found by their header text, so the two colleges' layouts (Lenoir adds Term Number
// and Semester before Enrollment) both read. The workbook's computed columns (space hours,
// sections, contact-hour totals) are not copied — the app derives them.
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
const KIND = { class: "CLASS", lab: "LAB", clinical: "CLINICAL" };

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
  semester: col(/^semester/, false),
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

// Group the session rows by course code (each code carries the offering in parentheses).
const groups = new Map();
for (const r of rows.slice(1)) {
  const code = str(r[C.code]); if (!code) continue;
  if (!groups.has(code)) groups.set(code, { code, title: str(r[C.title]) ?? "", enrollment: num(r[C.enrollment]), semester: C.semester >= 0 ? str(r[C.semester]) : null, rows: [] });
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

const templates = [];
for (const g of groups.values()) {
  const { label, bare } = split(g.code);
  const sessions = g.rows.map((r) => ({
    kind: KIND[String(r[C.kind]).trim().toLowerCase()] ?? String(r[C.kind]).toUpperCase(), number: num(r[C.number]), title: str(r[C.sessionTitle]),
    deliveryMode: str(r[C.mode]), location: str(r[C.location]),
    lengthHours: num(r[C.length]) ?? 0, maxStudents: num(r[C.max]) ?? 1,
    facultyNeeded: num(r[C.faculty]) ?? 0, facultyContactPolicy: num(r[C.facultyPolicy]),
    supportStaffNeeded: num(r[C.support]) ?? 0, supportContactPolicy: num(r[C.supportPolicy]),
    week: num(r[C.week]), dayOfWeek: dayOf(r[C.day]), notes: str(r[C.notes]),
    preceptorsNeeded: num(r[C.preceptors]) ?? 0, preceptorContactPolicy: num(r[C.preceptorPolicy]),
    rotationType: str(r[C.rotation]), clinicalMode: str(r[C.clinicalMode]),
  }));
  // The term is as long as the offering's name says ("18-week"), and at least as far as the
  // workbook's sessions reach, so every session row stays dated even where the sheet's week
  // numbers outrun the name (Carteret's 5-week rows reach week 6).
  const named = /(\d+)-week/i.exec(label);
  const lastWeek = Math.max(...sessions.map((s) => s.week ?? 1));
  const termWeeks = Math.max(lastWeek, named ? Number(named[1]) : 0);
  if (named && Number(named[1]) !== lastWeek) console.warn(`${label}: sessions run to week ${lastWeek} though the offering is named ${named[1]}-week — term kept at ${termWeeks} weeks`);
  const hours = (kind) => sessions.filter((s) => s.kind === kind).reduce((n, s) => n + s.lengthHours, 0);
  const weekly = (kind) => Math.round((hours(kind) / termWeeks) * 100) / 100;
  const title = g.title.replace(/\s*\([^()]*\)\s*$/, "").trim(); // "Nurse Aide Level I (5-week offering)" → "Nurse Aide Level I"
  const notes = sessions.map((s) => s.notes ?? "").join(" ");
  templates.push({
    name: `${title} — ${label}`, label, programType: programType(label, notes), credential: "Certificate",
    sourceWorkbook: basename(src).replace(/^[0-9a-f]{8}-/, ""), termWeeks, maxCohort: g.enrollment ?? 10, assumptions,
    course: { code: bare, title, weeklyClassHours: weekly("CLASS"), weeklyLabHours: weekly("LAB"), weeklyClinicalHours: weekly("CLINICAL") },
    sessions,
  });
}
writeFileSync(out, JSON.stringify(templates, null, 2) + "\n");
for (const t of templates) console.log(`${t.name} · ${t.programType} · ${t.termWeeks} wks · ${t.sessions.length} sessions · ${t.course.code} · class ${t.course.weeklyClassHours} / lab ${t.course.weeklyLabHours} / clinical ${t.course.weeklyClinicalHours} h/wk`);
console.log("assumptions:", JSON.stringify(assumptions));
console.log("wrote", out);
