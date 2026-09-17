// Rebuild prisma/templates/cna.json from Carteret Community College's program-structure
// workbook: one template per Nurse Aide I delivery model, each an exact copy of the
// workbook's "Raw Data & Calculations" session table (every session row, column for column),
// plus the workbook's faculty and preceptor workload assumptions.
//
//   node scripts/import-cna-pack.mjs <path/to/Carteret_Community_College_for_Claude.xlsx>
//
// The workbook's computed columns (V–AC) are not copied — the app derives them.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import XLSX from "xlsx";

const src = process.argv[2];
if (!src) { console.error("usage: node scripts/import-cna-pack.mjs <workbook.xlsx>"); process.exit(1); }
const wb = XLSX.read(readFileSync(src), { type: "buffer" });
const ws = wb.Sheets[wb.SheetNames.find((n) => /raw data/i.test(n)) ?? wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

const str = (v) => (v === "" || v == null ? null : String(v).trim());
const num = (v) => (v === "" || v == null ? null : Number(v));
const DAY = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };
const dayOf = (v) => DAY[String(v).trim().toLowerCase()] ?? null; // "Online" → null: no fixed weekday
const KIND = { class: "CLASS", lab: "LAB", clinical: "CLINICAL" };

// The two workload-assumption blocks sit in AD–AL beside the first rows: a label row, then a value row.
const block = (label) => {
  const i = rows.findIndex((r) => new RegExp(label, "i").test(String(r[31])));
  if (i < 0) return null;
  const v = rows[i];
  return { contactHours: num(v[32]), workWeekHours: num(v[33]), conversion: num(v[34]), termWeeks: num(v[35]) };
};
const fac = block("Faculty Workload") ?? { contactHours: 16, workWeekHours: 40, termWeeks: 16 };
const pre = block("Preceptor Workload") ?? fac;
const assumptions = { facContactHours: fac.contactHours, facWorkWeekHours: fac.workWeekHours, facTermWeeks: fac.termWeeks, preContactHours: pre.contactHours, preWorkWeekHours: pre.workWeekHours, preTermWeeks: pre.termWeeks };

// Group the session rows by course code (each code carries the offering in parentheses).
const groups = new Map();
for (const r of rows.slice(1)) {
  const code = str(r[1]); if (!code) continue;
  if (!groups.has(code)) groups.set(code, { code, title: str(r[2]) ?? "", enrollment: num(r[0]), rows: [] });
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
  if (/night|evening|5:30p/.test(text)) return /summer/.test(text) ? "Summer evening" : "Evening";
  if (/\bfs\b|fri|sat/.test(text) && /daytime/.test(label)) return "Daytime (Fri/Sat)";
  return "Daytime";
};

const templates = [];
for (const g of groups.values()) {
  const { label, bare } = split(g.code);
  const sessions = g.rows.map((r) => ({
    kind: KIND[String(r[3]).trim().toLowerCase()] ?? String(r[3]).toUpperCase(), number: num(r[4]), title: str(r[5]),
    deliveryMode: str(r[6]), location: str(r[7]),
    lengthHours: num(r[8]) ?? 0, maxStudents: num(r[9]) ?? 1,
    facultyNeeded: num(r[10]) ?? 0, facultyContactPolicy: num(r[11]),
    supportStaffNeeded: num(r[12]) ?? 0, supportContactPolicy: num(r[13]),
    week: num(r[14]), dayOfWeek: dayOf(r[15]), notes: str(r[16]),
    preceptorsNeeded: num(r[17]) ?? 0, preceptorContactPolicy: num(r[18]),
    rotationType: str(r[19]), clinicalMode: str(r[20]),
  }));
  const termWeeks = Math.max(...sessions.map((s) => s.week ?? 1));
  const hours = (kind) => sessions.filter((s) => s.kind === kind).reduce((n, s) => n + s.lengthHours, 0);
  const weekly = (kind) => Math.round((hours(kind) / termWeeks) * 100) / 100;
  const title = g.title.replace(/\s*\([^()]*\)\s*$/, "").trim(); // "Nurse Aide Level I (5-week offering)" → "Nurse Aide Level I"
  const notes = sessions.map((s) => s.notes ?? "").join(" ");
  templates.push({
    name: `${title} — ${label}`, label, programType: programType(label, notes), credential: "Certificate",
    sourceWorkbook: basename(src), termWeeks, maxCohort: g.enrollment ?? 10, assumptions,
    course: { code: bare, title, weeklyClassHours: weekly("CLASS"), weeklyLabHours: weekly("LAB"), weeklyClinicalHours: weekly("CLINICAL") },
    sessions,
  });
}
writeFileSync("prisma/templates/cna.json", JSON.stringify(templates, null, 2) + "\n");
for (const t of templates) console.log(`${t.name} · ${t.programType} · ${t.termWeeks} wks · ${t.sessions.length} sessions · ${t.course.code} · class ${t.course.weeklyClassHours} / lab ${t.course.weeklyLabHours} / clinical ${t.course.weeklyClinicalHours} h/wk`);
console.log("assumptions:", JSON.stringify(assumptions));
