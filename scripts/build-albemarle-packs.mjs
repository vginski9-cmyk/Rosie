// Build College of The Albemarle's four Medical Office Administration credentials — the AAS (A25310MO), the Diploma
// (D25310MO), the Patient Representative Certificate (C25310PR) and the Career and College Promise pathway (C25310H) —
// into prisma/templates/albemarle-moa-*.json: the college's 2026–27 catalog (pp. 196–200, received 2026-11-12) gives each
// credential's semesters, courses, hours, credits and prerequisites; the program coordinator's filled Program Planning
// Template gives the twelve core courses' session rows, carried row for row into every credential that lists them.
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
const SOURCE = "College of The Albemarle: the 2026–27 Academic Catalog pages for Medical Office Administration (pp. 196–200 — the AAS, Diploma, Patient Representative Certificate and CCP pathway sequences, hours, credits and prerequisites; received 2026-11-12) and the program coordinator's filled Program Planning Template (the twelve core courses' session rows, received 2026-11-12); the college's 2026–27 academic calendar page and location pages — compiled 2026-11-12";
const POLICY_NOTE = "Faculty policy as the sheet gives it: 2.22 = 40 ÷ 18 (\"FT = 18/20 = 2.22\" — 18 contact hours of a 40-hour week) or 1 where the sheet says an adjunct teaches (1:1).";
const ASSUMPTIONS = { facContactHours: 18, facWorkWeekHours: 40, facTermWeeks: 16, preContactHours: 40, preWorkWeekHours: 40, preTermWeeks: 16 };
const TERM_WEEKS = 16;
/** Credits: the college's 2026–27 catalog (the workbook carries none). OST 164 prints "5" in the AAS and diploma tables against
 *  3 contact hours, the certificate's 3 and semester totals that only add up with 3 — carried at 3, the misprint noted. */
const CREDITS = { "MED 110": 1, "MED 121": 3, "MED 122": 3, "MED 118": 2, "MED 130": 2, "MED 131": 2, "OST 164": 3, "OST 247": 3, "OST 148": 3, "OST 136": 3, "OST 248": 3, "OST 249": 3 };
/** The catalog's class-lab hours a week for the core courses (where the workbook's rows differ, the rows stand and the note says so). */
const CATALOG_HOURS = { "MED 110": "1-0", "MED 121": "3-0", "MED 122": "3-0", "MED 118": "2-0", "MED 130": "1-2", "MED 131": "1-2", "OST 164": "3-0", "OST 247": "2-2", "OST 148": "3-0", "OST 136": "2-2", "OST 248": "2-2", "OST 249": "2-3" };
/** The catalog's prerequisites. */
const PREREQS = { "MED 110": "ENG 025", "MED 121": "ENG 025", "MED 122": "MED 121", "MED 118": "ENG 025", "MED 130": "Enrollment in the Medical Assisting or Medical Office Administration program", "MED 131": "MED 130", "OST 164": "None", "OST 247": "MED 121 or OST 141", "OST 148": "None", "OST 136": "CIS 110 or CIS 111", "OST 248": "MED 121 or OST 141", "OST 249": "OST 247 and OST 248" };
const PRINTED = { "OST 164": "The catalog's AAS and diploma tables print 5 credits for OST 164 against 3 contact hours; the certificate table, the state library and the semester totals say 3 — carried at 3.", "MED 118": "The catalog prints MED 118 three ways — 2-0-2 (AAS), 1-2-2 (diploma), 1-2-3 (certificate); carried at 2-0-2, which the workbook's 32 hours and the state library match.", "OST 148": "The catalog lists OST 148 at 3-0-3; the workbook's rows are 3 class and 3.4-hour lab sessions — the college's own rows stand." };
const CCL_HOURS_UNUSED = { "MED 110": "1-0", "MED 121": "3-0", "MED 122": "3-0", "MED 118": "2-0", "MED 130": "1-2", "MED 131": "1-2", "OST 164": "3-0", "OST 247": "1-2", "OST 148": "3-0", "OST 136": "2-2", "OST 248": "1-2", "OST 249": "2-2" };
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
/** The twelve core courses from the workbook, by code — the rows carried into every credential that lists the course. */
const CORE = {};
for (const t of tpl.terms.filter((t) => t.index <= 4)) {
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
    if (PRINTED[code]) notes.push(PRINTED[code]);
    else if (CATALOG_HOURS[code] && CATALOG_HOURS[code] !== sheetWeekly) notes.push(`The catalog lists ${code} at ${CATALOG_HOURS[code]} class-lab hours a week; the college's own rows stand.`);
    if (c.codeRemark && !/deleted/i.test(c.codeRemark)) notes.push(`Sheet remark: ${c.codeRemark}.`);
    if (!c.code) notes.push("The sheet's course-code cell is blank for this block; OST 248 is the NCCCS library's code for Diagnostic Coding (2026-11-12).");
    if (c.countRemarks.CLASS) notes.push(`Class sessions: ${c.countRemarks.CLASS}.`);
    CORE[code] = { code, title, weeklyClassHours: weekly("CLASS"), weeklyLabHours: weekly("LAB"), weeklyClinicalHours: weekly("CLINICAL"), weeklyWorkHours: 0, credits: CREDITS[code] ?? null, requisites: PREREQS[code] ?? "", courseType: "CORE", description: [DESCRIPTIONS[code], ...notes].filter(Boolean).join(" "), sessions };
  }
}

// ---- The catalog's other courses: hours, credits and prerequisites as printed; one class (and lab) row a week ---------
const GENED_NOTE = "General-enrollment course taught outside the program (the catalog's hours); where and when it meets is not published, so the row carries its hours with no day or time.";
const CATALOG = {
  "ENG 111": { title: "Writing and Inquiry", hours: [3, 0], credits: 3, prereq: "ENG 025", gened: true },
  "ENG 112": { title: "Writing/Research in the Disciplines", hours: [3, 0], credits: 3, prereq: "ENG 111", gened: true },
  "BIO 163": { title: "Basic Anatomy & Physiology", hours: [4, 2], credits: 5, prereq: "ENG 025 and either BIO 090 or one unit of HS Biology", gened: true },
  "CIS 111": { title: "Basic PC Literacy", hours: [1, 2], credits: 2, prereq: "ENG 025 or MAT 025", gened: true, printed: "The certificate table prints CIS 111 at 3-0 and 2 contact hours; the AAS and diploma tables' 1-2-2 is carried." },
  "MAT 143": { title: "Quantitative Literacy", hours: [2, 2], credits: 3, prereq: "ENG 025 and MAT 025", gened: true },
  "CTS 115": { title: "Info Sys Business Concepts", hours: [3, 0], credits: 3, prereq: "ENG 025", gened: true },
  "BUS 151": { title: "People Skills", hours: [3, 0], credits: 3, prereq: "None (the certificate table: CIS 110 or CIS 111)" },
  "BUS 137": { title: "Principles of Management", hours: [3, 0], credits: 3, prereq: "BUS 110 or MED 131 or CTS 115" },
  "Humanities/Fine Arts elective": { title: "Humanities / Fine Arts elective (PHI 240 or HUM 115 recommended)", hours: [3, 0], credits: 3, prereq: "Varies", gened: true },
  "WBL 110": { title: "World of Work", hours: [1, 0], credits: 1, prereq: "None" },
  "PSY 150": { title: "General Psychology", hours: [3, 0], credits: 3, prereq: "ENG 025", gened: true },
};
const ROW = { facultyNeeded: 1, facultyContactPolicy: 2.22, supportStaffNeeded: 0, supportContactPolicy: 1, sectionTimes: null, preceptorsNeeded: 0, preceptorContactPolicy: null, rotationType: null, clinicalMode: null, dayOfWeek: null, startTime: null, endTime: null };
function catalogCourse(code, weeks) {
  const c = CATALOG[code]; const [cl, lab] = c.hours; const scale = 16 / weeks;
  const sessions = []; const n = { CLASS: 0, LAB: 0 };
  for (let w = 1; w <= weeks; w++) {
    if (cl) sessions.push({ ...ROW, kind: "CLASS", number: ++n.CLASS, title: `${c.title} — Class, week ${w}`, deliveryMode: "In-person", location: "General classroom", lengthHours: r4(cl * scale), maxStudents: 30, week: w, notes: GENED_NOTE });
    if (lab) sessions.push({ ...ROW, kind: "LAB", number: ++n.LAB, title: `${c.title} — Lab, week ${w}`, deliveryMode: "In-person", location: "General lab", lengthHours: r4(lab * scale), maxStudents: 30, week: w, notes: GENED_NOTE });
  }
  const summer = weeks !== 16 ? ` In the ${weeks}-week summer term the catalog's weekly hours are carried over ${weeks} weeks (${r2(cl * scale)} class${lab ? ` / ${r2(lab * scale)} lab` : ""} a week), so the term holds the same hours.` : "";
  return { code, title: c.title, weeklyClassHours: r4(cl * scale), weeklyLabHours: r4(lab * scale), weeklyClinicalHours: 0, weeklyWorkHours: 0, credits: c.credits, requisites: c.prereq, courseType: c.gened ? "GENED" : "CORE", description: `${GENED_NOTE}${c.printed ? ` ${c.printed}` : ""}${summer}`, sessions };
}
/** WBL 111 as the AAS's work-based term (the owner's call over CTS 130 Spreadsheet, 2026-11-12): 10 hours a week with an approved
 *  employer over the 16-week term, one student per workplace supervisor, the college coordinating. */
function workBasedCourse(weeks) {
  const note = "WBL 111: about 160 hours (10 a week) with an approved employer — a medical or health-related office — one student per workplace supervisor; the catalog's choice against CTS 130 Spreadsheet (the owner's call, 2026-11-12). The workbook's notes name this course with no session rows; placements and sites are not on record.";
  const sessions = Array.from({ length: weeks }, (_, i) => ({ ...ROW, kind: "CLINICAL", number: i + 1, title: `Work-Based Learning I — week ${i + 1}`, deliveryMode: "In-person", location: "Approved employer (work-based learning)", lengthHours: 10, maxStudents: 1, facultyNeeded: 0.05, facultyContactPolicy: 2.22, preceptorsNeeded: 1, preceptorContactPolicy: 1, rotationType: "Doctor's Office", clinicalMode: "Precepted Experience", week: i + 1, notes: note }));
  return { code: "WBL 111", title: "Work-Based Learning I", weeklyClassHours: 0, weeklyLabHours: 0, weeklyClinicalHours: 10, weeklyWorkHours: 0, credits: 1, requisites: "None", courseType: "CORE", description: `${note} The catalog lists it 0-0-10 for 1 credit; the alternative CTS 130 Spreadsheet is 2-2-3.`, sessions };
}
const core = (code) => { const c = CORE[code]; if (!c) throw new Error(`core course ${code} not in the workbook`); return JSON.parse(JSON.stringify(c)); };
const courseFor = (code, weeks) => (code === "WBL 111" ? workBasedCourse(weeks) : CORE[code] ? core(code) : catalogCourse(code, weeks));

// ---- The credentials, as the catalog sequences them --------------------------------------------------------------
const F = 16, S = 16, U = 10; // the college's summer is its 10-week session (May 17 – July 26, 2027)
const AWARDS = [
  { file: "albemarle-moa-aas.json", name: "Medical Office Administration AAS (A25310MO, hybrid)", programType: "Hybrid", credential: "AAS", maxCohort: 20, months: 3,
    terms: [["Year 1 Fall", "Fall", F, ["MED 110", "MED 121", "MED 130", "MED 131", "ENG 111", "BIO 163"]], ["Year 1 Spring", "Spring", S, ["ENG 112", "MED 122", "CIS 111", "MED 118", "OST 164", "OST 247"]], ["Year 2 Fall", "Fall", F, ["MAT 143", "OST 148", "CTS 115", "BUS 151", "OST 136", "OST 248"]], ["Year 2 Spring", "Spring", S, ["OST 249", "Humanities/Fine Arts elective", "BUS 137", "WBL 111", "WBL 110", "PSY 150"]]],
    note: "The college's hybrid Medical Office Administration AAS as the 2026–27 catalog sequences it (64 credits with WBL 111; 66 with CTS 130 in its place): the twelve core courses on the program coordinator's own session rows — online except the Tuesday labs of MED 130 and MED 131 in Owens 211 at Elizabeth City — with the catalog's general-education and business courses carried at their printed hours with no section on record, and WBL 111 as a 160-hour work-based term with an approved employer (the owner's call over CTS 130, 2026-11-12). Class size 20 (the coding courses' cap; 25 on most core rows, 30 on MED 118). " },
  { file: "albemarle-moa-diploma.json", name: "Medical Office Administration Diploma (D25310MO)", programType: "Hybrid", credential: "Diploma", maxCohort: 20, months: 3,
    terms: [["Fall", "Fall", F, ["MED 110", "MED 121", "MED 130", "MED 131", "ENG 111", "CIS 111", "OST 148"]], ["Spring", "Spring", S, ["BIO 163", "MED 122", "MED 118", "CTS 115", "OST 164"]], ["Summer", "Summer", U, ["PSY 150", "BUS 151"]]],
    note: "The college's Medical Office Administration Diploma as the 2026–27 catalog sequences it — fall, spring and the 10-week summer, 38 credits: the workbook's \"three semester (F, Sp, Su) program\". The core courses sit on the coordinator's own session rows; ENG 111, CIS 111, BIO 163, CTS 115, PSY 150 and BUS 151 carry the catalog's hours with no section on record. Class size 20 (OST 148's cap). " },
  { file: "albemarle-moa-cert-patient-rep.json", name: "Patient Representative Certificate (C25310PR)", programType: "Online", credential: "Certificate", maxCohort: 25, months: 3,
    terms: [["Semester 1", "Fall", F, ["CIS 111", "MED 121", "MED 130", "BUS 151"]], ["Semester 2", "Spring", S, ["MED 122", "MED 118", "OST 164"]]],
    note: "The Patient Representative Certificate as the 2026–27 catalog sequences it (the college lists it as fully online): CIS 111, MED 121, MED 130 and BUS 151, then MED 122, MED 118 and OST 164 — the core courses on the coordinator's own session rows (MED 130's Tuesday lab in Owens 211 included), the others at the catalog's hours. The catalog's total of 18 holds with MED 118 at 2 credits (its certificate table prints 3, its AAS table 2 — the workbook's hours and the state library say 2). Class size 25 (the rows' caps; MED 118's 30). " },
  { file: "albemarle-moa-ccp.json", name: "Medical Office Administration CCP pathway (C25310H)", programType: "High school (CCP)", credential: "Certificate", maxCohort: 25, months: 3,
    terms: [["Fall", "Fall", F, ["MED 121", "CIS 111", "BUS 151"]], ["Spring", "Spring", S, ["MED 122", "MED 118", "OST 164"]]],
    note: "The Career and College Promise pathway the catalog marks on the program's pages (C25310H — the highlighted courses MED 121, MED 122, CIS 111, MED 118, OST 164 and BUS 151; 16 credits at the AAS's figures), for high-school students. The catalog gives no sequence or class size: the courses are placed as the AAS places them and class size 25 is the rows' cap — both to confirm with the college. The core courses sit on the coordinator's own (online) session rows. " },
];
function pack(def) {
  let startWeek = 1;
  const terms = def.terms.map(([name, semester, weeks, codes], i) => { const t = { index: i + 1, name, semester, startWeek, endWeek: startWeek + weeks - 1, weeks, courses: codes.map((code) => courseFor(code, weeks)) }; startWeek += weeks; return t; });
  return { name: def.name, programType: def.programType, credential: def.credential, sourceWorkbook: SOURCE, institution: "College of The Albemarle", maxCohort: def.maxCohort, calendarMode: "semester", monthsToFullProductivity: def.months, note: def.note + POLICY_NOTE,
    weeklyHoursNote: "Hours per student: the twelve core courses are the college's own session rows, carried row for row (each course's weekly fields are its rows' totals ÷ 16; online rows have no day or time, the in-person labs sit on their posted Tuesday block); the catalog's other courses carry their printed hours as one row a week with no section on record; WBL 111 is 10 work-based hours a week. Credits are the 2026–27 catalog's.",
    assumptions: ASSUMPTIONS, terms };
}
for (const def of AWARDS) {
  const p = pack(def);
  writeFileSync(`prisma/templates/${def.file}`, JSON.stringify(p, null, 2) + "\n");
  const courses = p.terms.flatMap((t) => t.courses);
  console.log(`${def.file.padEnd(40)} ${p.terms.length} terms · ${courses.length} courses · ${courses.reduce((n, c) => n + c.sessions.length, 0)} sessions · credits ${courses.reduce((n, c) => n + (c.credits ?? 0), 0)} · ${r2(courses.reduce((n, c) => n + c.sessions.reduce((m, s) => m + s.lengthHours, 0), 0))} h per student`);
  for (const t of p.terms) console.log(`  ${t.name} (${t.weeks} wks): ${t.courses.map((c) => `${c.code} ${c.credits}cr`).join(", ")}`);
}
console.log("corrections:"); for (const c of corrections) console.log(`  ${c}`);
