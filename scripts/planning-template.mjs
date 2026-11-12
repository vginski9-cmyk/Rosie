// READ A FILLED PROGRAM PLANNING TEMPLATE (the owner's workbook, as a college fills it in): one sheet per term
// ("Term 1- Fa1", "Term 2- Sp1" …) in the template's course-block layout — a "Course Code" row, a "Course Name" row,
// the weekly class / lab / clinical hours with the term totals, "how many … sessions" counts, the policy line
// ("FT = 18/20 = 2.22; Adjunct = 1 · support = 1:1 · Online = SMTWThFS"), then three session tables side by side
// (class at column A, lab at column O, clinical at column AC): session number, title, delivery mode, location,
// length (hours), max students, faculty, faculty policy, support staff, support policy, week, day, notes.
// The "Term N Data_RAW" and "Program Data_All Together" sheets mirror these by formula without the course codes,
// so this reads the term sheets themselves. The "Institution Name, Program Type" sheet gives the program and its notes.
//
// Nothing is interpreted here: every cell comes back as the college typed it (trimmed), with the block's flags
// ("DELETED- per …", "REVISE") so a builder can decide what to carry and say why.
import XLSX from "xlsx";

const S = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const N = (v) => { const n = Number(String(v ?? "").trim()); return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null; };
/** The three session tables' column offsets: class, lab, clinical. */
const BLOCKS = [["CLASS", 0], ["LAB", 14], ["CLINICAL", 28]];

function sessionRow(r, o) {
  const num = N(r[o]); const title = S(r[o + 1]);
  if (num == null && !title) return null;
  return { number: num, title, mode: S(r[o + 2]), location: S(r[o + 3]), length: N(r[o + 4]), max: N(r[o + 5]), faculty: N(r[o + 6]), facultyPolicy: N(r[o + 7]), support: N(r[o + 8]), supportPolicy: N(r[o + 9]), week: N(r[o + 10]), day: S(r[o + 11]), notes: S(r[o + 12]) };
}

/** @returns {{ institution: string, program: string, programType: string, notes: string[], terms: { sheet: string, index: number, beginWeek: number|null, endWeek: number|null, courses: Course[] }[] }} */
export function readPlanningTemplate(path) {
  const wb = XLSX.readFile(path);
  const rowsOf = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
  const head = { institution: "", program: "", programType: "", notes: [] };
  const info = wb.SheetNames.find((n) => /^institution name/i.test(n));
  if (info) {
    let inNotes = false;
    for (const r of rowsOf(info)) {
      const a = S(r[0]); const b = S(r[1]);
      if (/^institution name$/i.test(a)) head.institution = b; else if (/^program name$/i.test(a)) head.program = b; else if (/^program type$/i.test(a)) head.programType = b;
      else if (/^notes$/i.test(a)) inNotes = true; else if (inNotes && a) head.notes.push(a);
    }
  }
  const terms = [];
  for (const name of wb.SheetNames) {
    const m = /^Term\s*(\d+)/i.exec(name); if (!m || /data_raw/i.test(name)) continue;
    const rows = rowsOf(name);
    const term = { sheet: name, index: Number(m[1]), beginWeek: null, endWeek: null, courses: [] };
    let course = null; let inTable = false;
    for (const r of rows) {
      const a = S(r[0]);
      // Every course block opens with the term's begin / end week rows, then "Course Code" and "Course Name" — a block
      // whose code and name cells are blank (one of COA's) still opens at its week rows and names itself on its
      // "<title> Weekly class hours" row.
      const open = () => { course = { code: "", codeRemark: "", title: "", weekly: { CLASS: null, LAB: null, CLINICAL: null }, totals: { CLASS: null, LAB: null, CLINICAL: null }, counts: { CLASS: null, LAB: null, CLINICAL: null }, countRemarks: {}, policyLine: "", flags: [], sessions: { CLASS: [], LAB: [], CLINICAL: [] }, fresh: true }; term.courses.push(course); inTable = false; return course; };
      if (/^what week does term begin/i.test(a)) { if (term.beginWeek == null) term.beginWeek = N(r[1]); course = null; continue; }
      if (/^what week does term end/i.test(a)) { if (term.endWeek == null) term.endWeek = N(r[1]); continue; }
      if (/^course code$/i.test(a)) {
        // A "Course Code" row opens a block — unless the week rows just opened one that nothing has filled yet.
        if (!course || !course.fresh) open();
        course.fresh = false;
        course.code = S(r[1]); course.codeRemark = [S(r[2]), S(r[3])].filter(Boolean).join(" ");
        if (/deleted/i.test(course.codeRemark) || /deleted/i.test(course.code)) course.flags.push(course.codeRemark || course.code);
        inTable = false; continue;
      }
      let w = /^(.*?)\s*weekly (class|lab|clinical) hours$/i.exec(a);
      if (w && !course && w[1]) open();
      if (!course) continue;
      if (/^course name$/i.test(a)) { course.title = S(r[1]); course.fresh = false; continue; }
      if (w) { const k = w[2].toUpperCase(); if (!course.title && w[1]) course.title = w[1]; course.fresh = false; course.weekly[k] = N(r[1]); course.totals[k] = N(r[6]); continue; }
      if (/how many class sessions/i.test(a)) { course.counts.CLASS = N(r[1]); course.counts.LAB = N(r[15]); course.counts.CLINICAL = N(r[29]); course.countRemarks = { CLASS: S(r[2]), LAB: S(r[16]), CLINICAL: S(r[30]) }; continue; }
      const line = r.map(S).filter(Boolean).join(" · ");
      if (/FT\s*=|Adjunct|support\s*=/i.test(line) && !/^class session number/i.test(a)) { course.policyLine = line; if (/REVISE/i.test(line)) course.flags.push("REVISE"); continue; }
      if (/^class session number$/i.test(a)) { inTable = true; continue; }
      if (/sum of total/i.test(S(r[3])) || /sum of total/i.test(a)) { inTable = false; continue; }
      if (!inTable) { if (/^(STOP|ADDITIONAL)/i.test(a)) course = null; continue; }
      for (const [kind, o] of BLOCKS) { const s = sessionRow(r, o); if (s) course.sessions[kind].push(s); }
    }
    terms.push(term);
  }
  terms.sort((x, y) => x.index - y.index);
  return { ...head, terms };
}

/** A course block that carries nothing a program can run: no code and no name, a numeric placeholder, or one the
 *  college marked deleted. */
export function isEmptyBlock(c) {
  const code = c.code.replace(/\s+/g, ""); const title = c.title.replace(/\s+/g, "");
  if (c.flags.some((f) => /deleted/i.test(f))) return true;
  if ((!code || /^\d+$/.test(code)) && (!title || /^\d+$/.test(title))) return true;
  return !Object.values(c.sessions).some((rows) => rows.length);
}
