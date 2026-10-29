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
// The session table: the "Raw Data & Calculations" sheet, or — a workbook laid out one track per sheet (Craven's validated
// v2.3) — every sheet whose first row names "Session Type", read in order under the first one's header.
const isTable = (n) => (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "", range: "A1:Z1" })[0] ?? []).some((h) => /^session type/i.test(String(h)));
const rawName = wb.SheetNames.find((n) => /raw data/i.test(n));
const tableSheets = rawName ? [rawName] : wb.SheetNames.filter(isTable);
if (!tableSheets.length) { console.error("no session table found (no Raw Data sheet, no sheet with a Session Type column)"); process.exit(1); }
const rows = tableSheets.flatMap((n, i) => { const r = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" }); return i === 0 ? r : r.slice(1); });
if (tableSheets.length > 1) console.log(`reading ${tableSheets.length} track sheets: ${tableSheets.join(", ")}`);

const str = (v) => (v === "" || v == null ? null : String(v).trim());
/** A number cell; text that is not a number ("*10 CCP;16 & 22 seats") is null — missing, never NaN or zero — and the log names it. */
const num = (v) => { if (v === "" || v == null) return null; const n = Number(v); if (Number.isNaN(n)) { console.warn(`not a number, left blank: "${v}"`); return null; } return n; };
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
  // A workbook that carries two authors' readings of the same program side by side (Craven: "Alec & Katie's Version" and "Kim").
  version: col(/^version/, false),
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
const facBlock = block("Faculty Workload");
const fac = facBlock ?? { contactHours: 16, workWeekHours: 40, termWeeks: 16 };
const pre = block("Preceptor Workload") ?? fac;
const assumptions = { facContactHours: fac.contactHours, facWorkWeekHours: fac.workWeekHours, facTermWeeks: fac.termWeeks, preContactHours: pre.contactHours, preWorkWeekHours: pre.workWeekHours, preTermWeeks: pre.termWeeks };
/** With no assumptions block, a model's faculty load is what its own rows' policy column says: 40 ÷ the policy most rows carry
 *  (Craven's 1.379 = a 29-hour cap, 1.0 = a 40-hour week). */
const assumptionsFor = (sessions, label) => {
  if (facBlock) return assumptions;
  const tally = new Map(); for (const s of sessions) if (s.facultyContactPolicy) tally.set(s.facultyContactPolicy, (tally.get(s.facultyContactPolicy) ?? 0) + 1);
  if (!tally.size) return assumptions;
  const policy = [...tally].sort((a, b) => b[1] - a[1])[0][0]; const contact = Math.round(40 / policy);
  console.log(`${label}: no workload block — faculty load ${contact} of 40 from the rows' policy ${policy}`);
  return { ...assumptions, facContactHours: contact, facWorkWeekHours: 40 };
};

/** A campus room named as a clinical row's location: the college's clinical-hours bucket holds its final exam and post-clinical
 *  skills labs ("this is happening in the lab and not at a clinical site" — Craven, 2026-10-29). Such a row is a lab (or a
 *  class, in a classroom) on campus, never a seat at a site. */
const CAMPUS_ROOM = /^(classroom|lab|labs?\b.*|skills lab|simulation.*|sim lab|computer lab|lecture hall)$/i;
const ON_CAMPUS_NOTE = "In the college's clinical-hours bucket, held on campus (the program, 2026-10-29).";
const ASYNC = /asynchronous|self-paced/i;
const session = (r, log = []) => {
  let kind = kindOf(r[C.kind]); const location = str(r[C.location]); const mode = str(r[C.mode]);
  let rotationType = str(r[C.rotation]), clinicalMode = str(r[C.clinicalMode]), notes = str(r[C.notes]);
  let dayOfWeek = dayOf(r[C.day]), startTime = startTimeOf(notes);
  if (kind === "CLINICAL" && location && CAMPUS_ROOM.test(location)) {
    kind = /class/i.test(location) ? "CLASS" : "LAB"; rotationType = null; clinicalMode = null; notes = `${ON_CAMPUS_NOTE}${notes ? ` ${notes}` : ""}`;
    log.push(`${str(r[C.code])} clinical row "${str(r[C.sessionTitle])}" (week ${num(r[C.week])}) at "${location}" → ${kind} on campus`);
  }
  // An asynchronous online row has no weekday of its own: a day the sheet gives it is a placeholder, kept in the notes.
  if (mode && ASYNC.test(mode) && dayOfWeek) { notes = `${notes ?? ""}${notes ? " " : ""}(The sheet's day, ${str(r[C.day])}, is a placeholder — asynchronous.)`.trim(); dayOfWeek = null; startTime = null; }
  return {
    kind, number: num(r[C.number]), title: str(r[C.sessionTitle]),
    deliveryMode: mode, location,
    lengthHours: num(r[C.length]) ?? 0, maxStudents: num(r[C.max]) ?? 1,
    facultyNeeded: num(r[C.faculty]) ?? 0, facultyContactPolicy: num(r[C.facultyPolicy]),
    supportStaffNeeded: num(r[C.support]) ?? 0, supportContactPolicy: num(r[C.supportPolicy]),
    week: num(r[C.week]), dayOfWeek, startTime, notes,
    preceptorsNeeded: num(r[C.preceptors]) ?? 0, preceptorContactPolicy: num(r[C.preceptorPolicy]),
    rotationType, clinicalMode,
  };
};
/** A workbook's session numbers are copied as given — unless, within a course and kind, they are not
 *  unique or do not run with the weeks (Roanoke-Chowan's sheet numbers two week-10 classes 18 and 19):
 *  then that kind is renumbered in week order, and the log says which rows changed. */
const renumber = (course, sessions) => {
  for (const kind of ["CLASS", "LAB", "CLINICAL"]) {
    const rows = sessions.filter((s) => s.kind === kind);
    const nums = rows.map((s) => s.number);
    const unique = new Set(nums).size === nums.length;
    const ordered = rows.every((s, i) => i === 0 || (s.week ?? 0) >= (rows[i - 1].week ?? 0) && (s.number ?? 0) > (rows[i - 1].number ?? 0));
    if (unique && ordered) continue;
    const sorted = [...rows].sort((a, b) => (a.week ?? 0) - (b.week ?? 0) || (a.number ?? 0) - (b.number ?? 0));
    const changed = [];
    sorted.forEach((s, i) => { if (s.number !== i + 1) { changed.push(`${s.number}→${i + 1} (week ${s.week})`); s.number = i + 1; } });
    if (changed.length) console.warn(`${course} ${kind}: session numbers renumbered in week order — ${changed.join(", ")}`);
  }
  return sessions;
};
const hoursOf = (sessions, kind) => sessions.filter((s) => s.kind === kind).reduce((n, s) => n + s.lengthHours, 0);
const weeklyOf = (sessions, kind, weeks) => Math.round((hoursOf(sessions, kind) / weeks) * 100) / 100;
const lastWeekOf = (sessions) => Math.max(...sessions.map((s) => s.week ?? 1));

const WEEK_TAG = /\(([^()]*week[^()]*)\)\s*$/i;
const WEEK_TITLE = /\b\d+\s*-\s*week\b/i; // a title that IS the offering's name: "16-week day (CCP)"
// Group the session rows by course code (and by VERSION where the workbook has one), in the order the workbook lists them.
const groups = new Map();
for (const r of rows.slice(1)) {
  const code = str(r[C.code]); if (!code) continue;
  const version = C.version >= 0 ? str(r[C.version]) : null;
  const title = str(r[C.title]) ?? "";
  // A title that names the offering ("16-week (DAY)", "13-week Summer (DAY)") is part of the model's identity: one code can run two.
  const key = [version, code, WEEK_TITLE.test(title) ? title : null].filter(Boolean).join(" | ");
  if (!groups.has(key)) groups.set(key, { code, version, title, enrollment: num(r[C.enrollment]), term: C.term >= 0 ? num(r[C.term]) : null, semester: C.semester >= 0 ? str(r[C.semester]) : null, rows: [] });
  groups.get(key).rows.push(r);
}

/** "NAS 111 (curriculum) & NAS 3240 (continuing ed) (5-week offering)" → the offering label and the course code without it.
 *  When the "(N-week …)" sits on the course title instead ("NA I (CCP)" / "16-week day (CCP)"), the label is the title's
 *  parenthetical and the code keeps its own tag ("NA I (CCP)"). */
const split = (code, title = "") => {
  const m = WEEK_TAG.exec(code);
  if (m) return { label: m[1].trim(), bare: code.slice(0, m.index).trim().replace(/[;\s]+$/, "") };
  return { label: WEEK_TITLE.test(title) ? title.trim() : code, bare: code };
};
/** Time of day and audience from the workbook's own words (session notes and title). */
const programType = (label, notes) => {
  const text = `${label} ${notes}`.toLowerCase();
  // Who the offering is for comes from its name alone (a "non-CCP" day class whose notes mention the CCP window is not a CCP class).
  const name = label.toLowerCase().replace(/non[- ]?ccp/g, "");
  if (/\bccp\b/.test(name)) return "High school (CCP)";
  if (/high school|pre-apprentice/.test(name)) return "High school pre-apprenticeship";
  // Time of day from the name where it says so ("16-week (NIGHT)", "16-week day"); the notes decide only when the name is silent.
  if (/night|evening/.test(name)) return /summer/.test(name) ? "Summer evening" : "Evening";
  if (/\bday\b|daytime/.test(name)) return /summer/.test(name) ? "Summer daytime" : /\bfs\b|fri|sat/.test(text) && /daytime/.test(name) ? "Daytime (Fri/Sat)" : "Daytime";
  if (/night|evening|5:30p|6:00p/.test(text)) return /summer/.test(text) ? "Summer evening" : "Evening";
  if (/\bfs\b|fri|sat/.test(text) && /daytime/.test(label)) return "Daytime (Fri/Sat)";
  return "Daytime";
};
const stripParen = (s) => s.replace(/\s*\([^()]*\)\s*$/, "").trim(); // "Nurse Aide Level I (5-week offering)" → "Nurse Aide Level I"
const sourceWorkbook = basename(src).replace(/^[0-9a-f]{8}-/, "");

const templates = [];
const isModels = [...groups.values()].every((g) => WEEK_TAG.test(g.code) || WEEK_TITLE.test(g.title));
if (isModels) {
  // One single-term template per delivery model (per version, where the workbook carries two).
  for (const g of groups.values()) {
    const { label, bare } = split(g.code, g.title);
    const recoded = []; const sessions = renumber(g.code, g.rows.map((r) => session(r, recoded)));
    for (const line of recoded) console.log(`  ${line}`);
    // The term is as long as the offering's name says ("18-week"), and at least as far as the
    // workbook's sessions reach, so every session row stays dated even where the sheet's week
    // numbers outrun the name (Carteret's 5-week rows reach week 6).
    const named = /(\d+)-week/i.exec(label);
    const lastWeek = lastWeekOf(sessions);
    const termWeeks = Math.max(lastWeek, named ? Number(named[1]) : 0);
    if (named && Number(named[1]) !== lastWeek) console.warn(`${label}: sessions run to week ${lastWeek} though the offering is named ${named[1]}-week — term kept at ${termWeeks} weeks`);
    const title = WEEK_TAG.test(g.code) ? stripParen(g.title) : "Nurse Aide Level I"; // a title that names the offering is not the course title
    const notes = sessions.map((s) => s.notes ?? "").join(" ");
    // The version names the model only where the workbook carries more than one reading side by side.
    const versions = new Set([...groups.values()].map((x) => x.version).filter(Boolean));
    const versionTag = g.version && versions.size > 1 ? ` · ${/version/i.test(g.version) ? g.version.replace(/Version$/i, "version") : `${g.version}'s version`}` : "";
    // The class size: the workbook's enrollment, unless every class row seats more — then the class rows' cap is the
    // college's statement of the class size and the enrollment column is the template's planning figure (the log says so).
    const classCap = Math.min(...sessions.filter((s) => s.kind === "CLASS").map((s) => s.maxStudents ?? Infinity));
    const maxCohort = Number.isFinite(classCap) && g.enrollment != null && classCap > g.enrollment ? classCap : g.enrollment ?? 10;
    if (maxCohort !== (g.enrollment ?? 10)) console.warn(`${label}${versionTag}: class rows seat ${classCap}, the enrollment column says ${g.enrollment} — class size taken from the class rows`);
    templates.push({
      name: `${title} — ${label}${versionTag}`, label, ...(g.version ? { version: g.version } : {}), programType: programType(`${label} ${g.code}`, notes), credential: "Certificate",
      sourceWorkbook, termWeeks, maxCohort, assumptions: assumptionsFor(sessions, `${label}${versionTag}`),
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
    const courses = gs.map((g) => ({ code: g.code, title: g.title, sessions: renumber(g.code, g.rows.map(session)) }));
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
  else console.log(`${t.name} · ${t.programType} · ${t.termWeeks} wks · ${t.sessions.length} sessions (${["CLASS", "LAB", "CLINICAL"].map((k) => `${t.sessions.filter((s) => s.kind === k).length} ${k.toLowerCase()} ${Math.round(hoursOf(t.sessions, k) * 100) / 100} h`).join(", ")}) · ${t.course.code} · seats ${t.maxCohort} · class ${t.course.weeklyClassHours} / lab ${t.course.weeklyLabHours} / clinical ${t.course.weeklyClinicalHours} h/wk`);
}
console.log("assumptions:", JSON.stringify(assumptions));
console.log("wrote", out);
