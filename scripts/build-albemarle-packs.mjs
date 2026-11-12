// Build College of The Albemarle's Medical Office Administration AAS (hybrid) template pack from the college's filled
// Program Planning Template — prisma/templates/albemarle-moa-aas.json.
//
// What is the college's (the workbook its program coordinator filled in, received 2026-11-12; the file itself is not
// committed — 7 MB, "Term 1- Fa1" … "Term 4-Sp2" sheets, read by scripts/planning-template.mjs): every course block's
// title, weekly hours and totals, and every session row — kind, number, title, delivery mode, location, length, max
// students, faculty, the faculty policy (2.22 = 40 ÷ 18, "FT = 18/20 = 2.22"; 1 where an adjunct teaches), support,
// week, day and notes. What is corrected here, and said on the row: three course blocks whose week column repeats
// (MED 121's last six sessions all "10", MED 130's class rows all "1") are placed session n in week n of the course's
// run; MED 122's duplicate session number "3" is renumbered; "Owen 211" is the Owens Center's room 211; the Diagnostic
// Coding labs' support cells (1 staff at policy 0) are the class rows' 0 / 1 transposed. What is the standard's: the
// credits (the workbook carries none) are the NCCCS Combined Course Library's. What is left out and recorded: MED 121's
// 12-week and summer 8-week formats (the same course in another section length — on the course's description, not as
// extra courses), the course blocks the coordinator deleted ("not a core course" — the AAS's general-education courses
// are not in the workbook), and WBL 111, named in the notes with no rows.
//
//   node scripts/build-albemarle-packs.mjs <workbook.xlsx>
import { writeFileSync } from "node:fs";
import { readPlanningTemplate, isEmptyBlock } from "./planning-template.mjs";

const SRC = process.argv[2];
if (!SRC) { console.error("usage: node scripts/build-albemarle-packs.mjs <COA Program Planning Template .xlsx>"); process.exit(1); }
const SOURCE = "College of The Albemarle: the program coordinator's filled Program Planning Template for the Medical Office Administration AAS (hybrid) — four term sheets of course blocks and session rows (received 2026-11-12); credits from the NCCCS Combined Course Library; the college's 2026–27 academic calendar page and location pages — compiled 2026-11-12";
const POLICY_NOTE = "Faculty policy as the sheet gives it: 2.22 = 40 ÷ 18 (\"FT = 18/20 = 2.22\" — 18 contact hours of a 40-hour week) or 1 where the sheet says an adjunct teaches (1:1).";
const ASSUMPTIONS = { facContactHours: 18, facWorkWeekHours: 40, facTermWeeks: 16, preContactHours: 40, preWorkWeekHours: 40, preTermWeeks: 16 };
const TERM_WEEKS = 16;
/** Credits: the NCCCS Combined Course Library's (the workbook carries none). */
const CREDITS = { "MED 110": 1, "MED 121": 3, "MED 122": 3, "MED 118": 2, "MED 130": 2, "MED 131": 2, "OST 164": 3, "OST 247": 2, "OST 148": 3, "OST 136": 3, "OST 248": 2, "OST 249": 3 };
const CCL_HOURS = { "MED 110": "1-0", "MED 121": "3-0", "MED 122": "3-0", "MED 118": "2-0", "MED 130": "1-2", "MED 131": "1-2", "OST 164": "3-0", "OST 247": "1-2", "OST 148": "3-0", "OST 136": "2-2", "OST 248": "1-2", "OST 249": "2-2" };
const TERM_NAMES = { 1: ["Year 1 Fall", "Fall"], 2: ["Year 1 Spring", "Spring"], 3: ["Year 2 Fall", "Fall"], 4: ["Year 2 Spring", "Spring"] };
const TITLE_FIX = { "Admin Ofifice Procedures I": "Admin Office Procedures I" };
/** A block whose code cell is blank, named by its title (OST 248 Diagnostic Coding in Term 3): the code is the NCCCS library's. */
const TITLE_CODES = { "Diagnostic Coding": "OST 248" };
const DESCRIPTIONS = {
  "MED 110": "Orientation to the medical-assisting profession and the healthcare team, communication, stress, legal principles, healthcare law and ethics, patient coaching — the first eight weeks, online.",
  "MED 121": "Medical terminology I: word structure, prefixes and suffixes, body systems through the cardiovascular system — online over the full 16 weeks. The college also runs this course as a 12-week format (12 sessions of 4 h, fall and spring) and a summer-only 8-week format (8 sessions of 6 h, taught by an adjunct at 1:1); the workbook gives all three, the 16-week one is carried here (\"Fa & Sp only\").",
  "MED 130": "Administrative office procedures I: the office setting, safety and emergencies, professionalism, scheduling and patient processing, written communication, health records and daily operations, office technology — online class with an in-person lab on Tuesdays in Owens 211, the first eight weeks. The sheet flags this block \"REVISE\".",
  "MED 131": "Administrative office procedures II: diagnostic and procedure coding, health insurance, financial practices and insurance payments, accounting, billing and collections, legal and ethical considerations — online class with an in-person lab on Tuesdays in Owens 211, the second eight weeks.",
  "MED 122": "Medical terminology II: respiratory, blood, immune, musculoskeletal, skin, sense organs, endocrine, oncology, radiology, pharmacology and psychiatry — online over ten weeks.",
  "MED 118": "Medical law and ethics: working in healthcare, law and the courts, professional liability and defenses, medical records, privacy, security and fraud, physicians' public duties, beginning and end of life, healthcare trends — online over ten weeks, up to 30 students.",
  "OST 164": "Office editing: sentences, parts of speech, agreement, punctuation, capitalization and numbers, with a final editing exercise — online over 16 weeks.",
  "OST 247": "Procedure coding: abstracting clinical documentation, CPT and HCPCS Level II modifiers, evaluation and management, anesthesia, the surgery sections by body system, radiology, pathology and lab, medicine and physician services — online class and lab over 16 weeks.",
  "OST 148": "Medical insurance and billing: health insurance and managed care, revenue cycle management, legal and regulatory issues, CMS reimbursement, coding compliance, the CMS-1500 claim, commercial, Blue Cross/Blue Shield, Medicare, Medicaid, TRICARE and workers' compensation claims — online class over 16 weeks with a 14-week online lab taught by an adjunct at 1:1; up to 20 students.",
  "OST 136": "Word processing: documents, comments, navigation and headings, section breaks, templates, mail merge, tracked changes — online class (taught by an adjunct at 1:1) and lab over 12 weeks.",
  "OST 248": "Diagnostic coding: ICD-10-CM by chapter — infectious diseases, neoplasms, blood, endocrine, mental and neurological, eye and ear, cardiovascular, respiratory, digestive, integumentary, musculoskeletal, genitourinary and obstetrics — with a coding capstone; online class and lab over 16 weeks, up to 20 students.",
  "OST 249": "Medical coding certification preparation: ICD-10-CM and CPT guidelines, evaluation and management, anesthesia, the surgery sections, radiology, pathology/laboratory, medicine and HCPCS Level II, practice exams — online class and lab over 16 weeks, up to 20 students.",
};

const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10000) / 10000;
const codeOf = (raw) => { const m = /^([A-Za-z]{3})\s*(\d{3})/.exec(raw); return m ? `${m[1].toUpperCase()} ${m[2]}` : raw.trim(); };
const DAY = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };
const modeOf = (m) => /online\s*&\s*in-?person/i.test(m) ? "Hybrid" : /online/i.test(m) ? "Online" : /in-?person/i.test(m) ? "In-person" : m || null;
/** "9a-12:50p" → "09:00" */
function startOf(notes) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*([ap])m?\b/i.exec(notes ?? ""); if (!m) return null;
  let h = Number(m[1]); const min = m[2] ?? "00"; const ap = m[3].toLowerCase();
  if (ap === "p" && h < 12) h += 12; if (ap === "a" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}
const addHours = (t, h) => { const [hh, mm] = t.split(":").map(Number); const total = hh * 60 + mm + Math.round(h * 60); return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; };

const tpl = readPlanningTemplate(SRC);
console.log(`${tpl.institution} · ${tpl.program} · ${tpl.programType}`);
for (const n of tpl.notes) console.log(`  note: ${n}`);
const corrections = [];
const terms = [];
let startWeek = 1;
for (const t of tpl.terms.filter((t) => t.index <= 4)) {
  const [name, semester] = TERM_NAMES[t.index];
  const courses = [];
  for (const c of t.courses) {
    if (isEmptyBlock(c)) { if (c.sessions.LAB.length || c.sessions.CLASS.length) corrections.push(`${t.sheet}: a block with no code or name (${c.flags.join("; ") || "no flag"}) carries ${c.sessions.CLASS.length + c.sessions.LAB.length} session rows — left out`); continue; }
    const code = c.code ? codeOf(c.code) : TITLE_CODES[c.title] ?? null;
    if (!code) { corrections.push(`${t.sheet}: a block titled "${c.title}" with no course code and no known code — left out`); continue; }
    if (!c.code) corrections.push(`${t.sheet}: "${c.title}" has no code cell in the sheet; carried as ${code} (the NCCCS library's code)`);
    if (/\((12|8) wks\)/i.test(c.code)) { corrections.push(`${t.sheet}: ${c.code} — the same course in another section length; recorded on ${code}'s description, not carried as a course`); continue; }
    const title = TITLE_FIX[c.title] ?? c.title.replace(/\s*\(16 wks\)\s*$/i, "").trim();
    const sessions = [];
    for (const kind of ["CLASS", "LAB", "CLINICAL"]) {
      const rows = c.sessions[kind]; if (!rows.length) continue;
      // Weeks: the sheet's, unless the column repeats or runs backward — then session n sits in week n of the course's run.
      const weeks = rows.map((r) => r.week);
      const monotonic = weeks.every((w, i) => w != null && (i === 0 || w > weeks[i - 1]));
      const first = weeks[0] ?? 1;
      rows.forEach((r, i) => {
        const notes = [r.notes].filter(Boolean);
        let week = r.week;
        if (!monotonic) { week = first + i; if (r.week !== week) { notes.push(`The sheet's week column reads ${r.week} for this row; placed in week ${week} as session ${i + 1} of the course's run (2026-11-12).`); corrections.push(`${code} ${kind} session ${i + 1}: week ${r.week} → ${week}`); } }
        let location = r.location || null;
        if (location && /^owen 211$/i.test(location)) { location = "Owens 211"; notes.push("The sheet says \"Owen 211\": room 211 of the Owens Center (Dr. Zack D. Owens Health Sciences Center), Elizabeth City."); }
        const day = DAY[r.day.toLowerCase()] ?? null;
        const startTime = day ? startOf(r.notes) : null;
        const endTime = startTime ? addHours(startTime, r.length ?? 0) : null;
        if (startTime && /-\s*\d/.test(r.notes)) notes.push(`Posted ${r.notes.split(",").find((s) => /\d/.test(s))?.trim()}; carried at the sheet's ${r.length} h from ${startTime}.`);
        let support = r.support ?? 0, supportPolicy = r.supportPolicy ?? 1;
        if (support > 0 && supportPolicy === 0) { support = 0; supportPolicy = 1; notes.push("The sheet's support cells read 1 staff at a 0 policy on this row — the class rows' 0 / 1 transposed; carried as 0 / 1 (2026-11-12)."); corrections.push(`${code} ${kind} session ${i + 1}: support 1/0 → 0/1`); }
        sessions.push({ kind, number: 0, title: r.title || null, deliveryMode: modeOf(r.mode), location, lengthHours: r.length ?? 0, maxStudents: r.max ?? 0, facultyNeeded: r.faculty ?? 1, facultyContactPolicy: r.facultyPolicy ?? null, supportStaffNeeded: support, supportContactPolicy: supportPolicy, week, dayOfWeek: day, startTime, endTime, sectionTimes: null, notes: notes.length ? notes.join(" ") : null, preceptorsNeeded: 0, preceptorContactPolicy: null, rotationType: null, clinicalMode: null });
      });
    }
    // Numbers in week order per kind (MED 122 numbers its third session "3" twice).
    const dup = Object.values(c.sessions).some((rows) => new Set(rows.map((r) => r.number)).size !== rows.length);
    if (dup) corrections.push(`${code}: duplicate session numbers in the sheet — renumbered in week order`);
    for (const kind of ["CLASS", "LAB", "CLINICAL"]) { let n = 0; sessions.filter((s) => s.kind === kind).sort((a, b) => a.week - b.week).forEach((s) => { s.number = ++n; }); }
    const hours = (kind) => r2(sessions.filter((s) => s.kind === kind).reduce((n, s) => n + s.lengthHours, 0));
    const weekly = (kind) => r4(hours(kind) / TERM_WEEKS); // four decimals so weekly × 16 lands on the rows' own total (OST 148's lab: 2.975 × 16 = 47.6)
    const sheetWeekly = `${c.weekly.CLASS ?? 0}-${c.weekly.LAB ?? 0}`;
    const notes = [];
    if (`${r2(weekly("CLASS"))}-${r2(weekly("LAB"))}` !== sheetWeekly) notes.push(`The sheet states ${sheetWeekly} weekly hours; its session rows sum to ${hours("CLASS")} class and ${hours("LAB")} lab hours (${r2(weekly("CLASS"))}-${r2(weekly("LAB"))} a week over 16).`);
    if (CCL_HOURS[code] && CCL_HOURS[code] !== sheetWeekly) notes.push(`The NCCCS course library lists ${code} at ${CCL_HOURS[code]} class-lab hours a week; the college's figures stand.`);
    if (c.codeRemark && !/deleted/i.test(c.codeRemark)) notes.push(`Sheet remark: ${c.codeRemark}.`);
    if (!c.code) notes.push("The sheet's course-code cell is blank for this block; OST 248 is the NCCCS library's code for Diagnostic Coding (2026-11-12).");
    if (c.countRemarks.CLASS) notes.push(`Class sessions: ${c.countRemarks.CLASS}.`);
    courses.push({ code, title, weeklyClassHours: weekly("CLASS"), weeklyLabHours: weekly("LAB"), weeklyClinicalHours: weekly("CLINICAL"), weeklyWorkHours: 0, credits: CREDITS[code] ?? null, requisites: "", courseType: "CORE", description: [DESCRIPTIONS[code], ...notes].filter(Boolean).join(" "), sessions });
  }
  terms.push({ index: t.index, name, semester, startWeek, endWeek: startWeek + TERM_WEEKS - 1, weeks: TERM_WEEKS, courses });
  startWeek += TERM_WEEKS;
}
const pack = {
  name: "Medical Office Administration AAS (A25310, hybrid)", programType: "Hybrid", credential: "AAS", sourceWorkbook: SOURCE, institution: "College of The Albemarle",
  maxCohort: 20, calendarMode: "semester", monthsToFullProductivity: 3,
  note: "The college's hybrid Medical Office Administration AAS as its program coordinator filled the Program Planning Template: twelve core courses over four 16-week terms (fall, spring, fall, spring) — medical terminology, administrative office procedures, law and ethics, office editing, procedure and diagnostic coding, insurance and billing, word processing and coding-certification preparation — online except the Tuesday labs of MED 130 and MED 131 in Owens 211 at Elizabeth City. Class size 20 (the coding courses' cap; 25 on most courses, 30 on MED 118). Not in the workbook and not modeled: the general-education and other courses the coordinator marked \"not a core course\", the AAS's full credit total, and WBL 111 (named in the workbook's notes as about 160 work hours with an approved employer, with no session rows); the notes also call this a three-semester program where the sheets run four terms — to confirm. The Diploma and the Patient Representative Certificate (C25310PR) exist; their course lists were not read. " + POLICY_NOTE,
  weeklyHoursNote: "Hours per student are the college's own session rows, carried row for row; each course's weekly fields are its rows' totals ÷ 16. Credits are the NCCCS Combined Course Library's (the workbook carries none). Online rows have no day or time (\"Online = SMTWThFS\"); the in-person labs sit on their posted Tuesday block. No clinical hours.",
  assumptions: ASSUMPTIONS, terms,
};
writeFileSync("prisma/templates/albemarle-moa-aas.json", JSON.stringify(pack, null, 2) + "\n");
const courses = terms.flatMap((t) => t.courses);
console.log(`albemarle-moa-aas.json: ${terms.length} terms · ${courses.length} courses · ${courses.reduce((n, c) => n + c.sessions.length, 0)} sessions · credits ${courses.reduce((n, c) => n + (c.credits ?? 0), 0)} · ${r2(courses.reduce((n, c) => n + c.sessions.reduce((m, s) => m + s.lengthHours, 0), 0))} h per student`);
for (const t of terms) console.log(`  ${t.name}: ${t.courses.map((c) => `${c.code} (${c.sessions.filter((s) => s.kind === "CLASS").length}c/${c.sessions.filter((s) => s.kind === "LAB").length}l)`).join(", ")}`);
console.log("corrections:"); for (const c of corrections) console.log(`  ${c}`);
