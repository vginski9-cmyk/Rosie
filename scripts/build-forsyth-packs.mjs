// Build Forsyth Technical Community College's electrical template packs — the Electrical Systems Technology diploma
// (D35130) and certificate (C35130), the Career & College Promise certificate pathway (C35130P1), the Careers Electric
// summer academy pre-apprenticeship, the Forsyth County Electrical Contractors Association (FCECA) electrician
// apprenticeship taught at the college, and the Electrical: Installation/Troubleshooting continuing-education course —
// into prisma/templates/forsyth-*.json.
//
// What is the college's (compiled 2026-11-18 from what its site and catalog gave through search; forsythtech.edu,
// catalog.forsythtech.edu and the press sites were unreachable from the build environment): the credentials and codes
// (the catalog's Programs Offered tables, CIP 46.0302, day; no AAS is listed), the diploma's 39-credit total and its
// 2025–26 term tables (fall 12 class · 14 lab · 17 credits; spring 10 · 14 · 15; ELC 115 and ELC 233 in the summer), the
// certificate's four courses and 15 credits, the 2023 CCP booklet's certificate pathway, the Careers Electric academy
// (seven weeks, paid, a $2,000 completion stipend, "one or two college electrical courses", a registered
// pre-apprenticeship, counts as one year of the four-year apprenticeship; with Winston-Salem/Forsyth County Schools),
// the apprenticeship's published sections (Level 1 Tue/Thu 7:00–9:30 PM Strickland Center 1250, Level 2 Mon/Wed
// 6:30–9:00 PM Strickland Center, Level 4 Tue/Thu 6:00–8:30 PM Strickland Center; fall 08/17–12/09 at 8.00 CEU, spring
// 01/11–05/12 at 8.75 CEU; $240 a semester), the Installation/Troubleshooting section (Mon/Wed 6:00–9:00 PM, West
// Campus 17, 01/20–05/12/2027, $210, 9.90 CEU), the 2026–27 calendar and the course schedule's eight-week summer
// electrical sections (05/18–07/13/2026).
// What is the state's: every credit course's title, class · lab hours and credits are the NCCCS Combined Course
// Library's (BPR 130 at 3-0-3, which the college's own fall line fixes).
// What is laid out here: the 2025–26 diploma table stands until the 2026–27 "REVISED" table can be read; the academy's
// hours are the one-year-of-apprenticeship equivalence the college states, carried at the US DOL / ApprenticeshipNC
// 144-hour minimum (the model's inference, flagged on the pack); Level 3's nights are not published and carry no day or
// time. The faculty load is the workspace default (16 contact hours of a 40-hour week, 2.5 work hours a contact hour)
// because the college publishes none, and 16 students a section is a stand-in (no section cap is published). Nothing
// else is invented: no curriculum day section or lab building is published, and none is set.
//
//   node scripts/build-forsyth-packs.mjs
import { writeFileSync } from "node:fs";
import { carryCatalogHours, HOURS_RULE } from "./packhours.mjs";

const SOURCE = "Forsyth Tech: the catalog's Programs Offered tables 2021–22 through 2026–27 (D35130, C35130, CIP 46.0302, day; the diploma marked REVISED for 2026–27), the 2025–26 Electrical Systems Technology diploma and certificate pages (term lines and the 39- and 15-credit totals), the program pages (one-year diploma, 1–2-semester certificate, 2100 Silas Creek Pkwy), the 2023 Career & College Promise booklet (C35130P1), the Technical Career Path page, the Careers Electric coverage (WFDD 2026-07-13, NCBCE and EdNC 2026-06), the FCECA apprenticeship page and its published sections, the Workforce Continuing Education catalog page (144 classroom hours a year, 2,000 OJT hours, the NCDOL Journeyman's card), the Installation/Troubleshooting course page, the 2026–27 academic calendar and the course schedule's summer 2026 electrical sections; course hours and credits from the NCCCS Combined Course Library; sequences as the 2025–26 tables give them — compiled 2026-11-18";
// Faculty load: the college publishes none — the workspace default (16 of 40, 2.5 work hours a contact hour) stands on every
// session until the college's figure arrives. Class size: a stand-in of 16 (the lab-room size used at Rowan-Cabarrus, Cape
// Fear and Pitt; Forsyth publishes no section cap).
const FACULTY_POLICY = 2.5;
const SEATS = 16;
const SEATS_NOTE = "Class size 16 is a stand-in (the college publishes no section cap).";
const POLICY_NOTE = "Faculty load is the workspace default (16 contact hours of a 40-hour week) — the college publishes no load.";
const ASSUMPTIONS = { facContactHours: 16, facWorkWeekHours: 40, facTermWeeks: 16, preContactHours: 40, preWorkWeekHours: 40, preTermWeeks: 16 };
const GENED = "General-enrollment course taught outside the program, offered every term; placed here as the program of study has it.";
const REVISED = "The 2025–26 catalog's table; the 2026–27 catalog marks the diploma REVISED and its table was not read (catalog.forsythtech.edu was unreachable on 2026-11-18).";
const NO_SECTION = "No section for this course is on record (the college's course schedule was unreachable); the hours are carried with no day or time at the Main Campus — the lab building is not published.";
const MC_CLASS = "Main Campus – Classroom";
const MC_LAB = "Main Campus – Electrical lab";
const STRICKLAND = "Robert L. Strickland Center";

// ---- The standard: hours are class · lab · work a week on a 16-week basis, then credits --------------------------
const OJT = "about 2,000 hours of paid on-the-job training a year with the apprentice's electrical contractor (the catalog's figure), recorded here, not scheduled";
const CATALOG = {
  "ELC 112": { title: "DC/AC Electricity", hours: [3, 6, 0], credits: 5, requisites: "", description: "Direct- and alternating-current theory: units, circuit laws, series and parallel circuits, magnetism, transformers, measurement with meters." },
  "ELC 113": { title: "Residential Wiring", hours: [2, 6, 0], credits: 4, requisites: "", description: "Residential wiring methods, materials and the NEC: services, branch circuits, boxes, devices and lighting." },
  "ELC 114": { title: "Commercial Wiring", hours: [2, 6, 0], credits: 4, requisites: "ELC 113", description: "Commercial wiring methods: raceways, conductors, services, feeders, panelboards, lighting and the NEC articles that govern them." },
  "ELC 115": { title: "Industrial Wiring", hours: [2, 6, 0], credits: 4, requisites: "ELC 114", description: "Layout, planning and installation of wiring systems in industrial facilities (the college's catalog entry; its 2015–16 catalog lists ELC 114 as the prerequisite, an earlier version none). The program page marks this course \"R\", unexplained." },
  "ELC 117": { title: "Motors and Controls", hours: [2, 6, 0], credits: 4, requisites: "ELC 112", description: "Motor theory, single- and three-phase motors, starters, relays and control circuits, wired and tested in the lab." },
  "ELC 118": { title: "National Electrical Code", hours: [1, 2, 0], credits: 2, requisites: "", description: "Reading and applying the National Electrical Code." },
  "ELC 233": { title: "Energy Management", hours: [2, 2, 0], credits: 3, requisites: "ELC 114", description: "Energy management: load control and peak-demand reduction (the college's catalog entry, prerequisite ELC 114) — the diploma's summer course with ELC 115." },
  "ISC 112": { title: "Industrial Safety", hours: [2, 0, 0], credits: 2, requisites: "", description: "Industrial safety: OSHA regulations, hazard recognition, lockout/tagout, PPE and safe work practices — the diploma's spring safety course." },
  "ISC 115": { title: "Construction Safety", hours: [2, 0, 0], credits: 2, requisites: "", description: "Construction-site safety: OSHA construction standards, hazard recognition, fall protection, electrical hazards, PPE — the diploma's fall safety course." },
  "BPR 130": { title: "Print Reading – Construction", hours: [3, 0, 0], credits: 3, requisites: "", description: "Reading construction drawings: plans, elevations, sections, details, schedules and specifications. 3-0-3 as the college's fall line (12 class hours, 17 credits) fixes it." },
  "ENG 111": { title: "Writing and Inquiry", hours: [3, 0, 0], credits: 3, requisites: "", gened: true },
  "MAT 110": { title: "Mathematical Measurement and Literacy", hours: [2, 2, 0], credits: 3, requisites: "", gened: true, description: "The diploma's mathematics choice (MAT 110 or MAT 143 Quantitative Literacy); placed here as the first of the catalog's two options." },
  "Level 1 Fall": { title: "FCECA Electrician Apprenticeship — Level 1, fall related instruction", hours: [5, 0, 0], credits: 0, requisites: "18 or older; employed by an electrical contractor (or paying the fees); fall start required", description: `Level 1 of the four-year Forsyth County Electrical Contractors Association apprenticeship taught at Forsyth Tech (Workforce Continuing Education; SOC 47-2111): two evenings a week of classroom instruction (80 hours, the published 8.00 CEU) alongside ${OJT}.` },
  "Level 1 Spring": { title: "FCECA Electrician Apprenticeship — Level 1, spring related instruction", hours: [5, 0, 0], credits: 0, requisites: "Level 1 Fall (the spring class is not open without the fall class)", description: "Level 1 continued: 35 evenings (87.5 hours, the published 8.75 CEU) — the published section is Tue/Thu 7:00–9:30 PM in Robert L. Strickland Center 1250, 01/12–05/11/2027, $240." },
  "Level 2 Fall": { title: "FCECA Electrician Apprenticeship — Level 2, fall related instruction", hours: [5, 0, 0], credits: 0, requisites: "Level 1", description: `Level 2: two evenings a week (80 hours) — the published section is Mon/Wed 6:30–9:00 PM at the Strickland Center, 08/17–12/09/2026, $240 (a second Level 2 section meets Tue/Thu at West Campus); alongside ${OJT}.` },
  "Level 2 Spring": { title: "FCECA Electrician Apprenticeship — Level 2, spring related instruction", hours: [5, 0, 0], credits: 0, requisites: "Level 2 Fall", description: "Level 2 continued: 35 evenings (87.5 hours, 8.75 CEU) — Mon/Wed 6:30–9:00 PM at the Strickland Center, 01/11–05/12/2027, $240." },
  "Level 3 Fall": { title: "FCECA Electrician Apprenticeship — Level 3, fall related instruction", hours: [5, 0, 0], credits: 0, requisites: "Level 2", description: `Level 3: two evenings a week (80 hours) at the Strickland Center; no Level 3 section was found published, so its nights and times are not set; alongside ${OJT}.` },
  "Level 3 Spring": { title: "FCECA Electrician Apprenticeship — Level 3, spring related instruction", hours: [5, 0, 0], credits: 0, requisites: "Level 3 Fall", description: "Level 3 continued: 35 evenings (87.5 hours); nights and times not published." },
  "Level 4 Fall": { title: "FCECA Electrician Apprenticeship — Level 4, fall related instruction", hours: [5, 0, 0], credits: 0, requisites: "Level 3", description: `Level 4: two evenings a week (80 hours) — the published section is Tue/Thu 6:00–8:30 PM at the Strickland Center, 08/18–12/08/2026, $240; alongside ${OJT}.` },
  "Level 4 Spring": { title: "FCECA Electrician Apprenticeship — Level 4, spring related instruction", hours: [5, 0, 0], credits: 0, requisites: "Level 4 Fall", description: "Level 4 continued: 35 evenings (87.5 hours) toward the journeyman examination — graduates receive a Journeyman's Card from the NC Department of Labor (the catalog)." },
  "Summer academy": { title: "Careers Electric summer academy (courses not published)", hours: [20.57, 0, 0], credits: 0, requisites: "A Winston-Salem/Forsyth County Schools high-school student", description: "Seven weeks of college electrical coursework (\"one or two college electrical courses for college credit\" — which ones is not published), industry-valued credentials, hands-on work with local employers and a registered pre-apprenticeship, paid, with a $2,000 completion stipend. The college says the academy counts for one year of the four-year electrical apprenticeship; carried here at 144 hours — the US DOL / ApprenticeshipNC minimum for a year's related instruction — because the academy's hours are not published (the model's inference)." },
  "Installation/Troubleshooting": { title: "Electrical: Installation/Troubleshooting", hours: [6, 0, 0], credits: 0, requisites: "", description: "Electrical safety and theory, NEC codes, electrical service and repair, troubleshooting, circuit and equipment installation, in a skills lab; a certificate of completion toward an entry-level role with an electrical contractor (the course page). 33 evenings of three hours — 99 hours, the published 9.90 CEU; $210 plus the $5 CAPS fee." },
};

// ---- The published sections: the apprenticeship's evenings and the continuing-education course --------------------
// Each level is a fall term (16 weeks, two nights a week = 80 h, the published 8.00 CEU) and a spring term (35 nights =
// 87.5 h, the published 8.75 CEU: two nights a week for 17 weeks and one in the 18th), on the published nights.
const LEVEL_NIGHTS = {
  "Level 1": { days: ["Tue", "Thu"], start: "19:00", end: "21:30", room: `${STRICKLAND} 1250`, note: "The published Level 1 section: Tue/Thu 7:00–9:30 PM, Robert L. Strickland Center 1250 (01/12–05/11/2027, $240)." },
  "Level 2": { days: ["Mon", "Wed"], start: "18:30", end: "21:00", room: STRICKLAND, note: "The published Level 2 section: Mon/Wed 6:30–9:00 PM at the Robert L. Strickland Center (08/17–12/09/2026 and 01/11–05/12/2027, $240); a second Level 2 section meets Tue/Thu at West Campus. Room not published." },
  "Level 3": { days: [null, null], start: null, end: null, room: STRICKLAND, note: "No Level 3 section was found published; two evenings a week of 2.5 hours are carried with no day or time at the Strickland Center." },
  "Level 4": { days: ["Tue", "Thu"], start: "18:00", end: "20:30", room: STRICKLAND, note: "The published Level 4 section: Tue/Thu 6:00–8:30 PM at the Robert L. Strickland Center (08/18–12/08/2026, $240). Room not published." },
};
const CE_NOTE = "The published section: Mon/Wed 6:00–9:00 PM, West Campus 17, 01/20–05/12/2027 (a Wednesday start: one evening in the first week, then two a week — 33 evenings, 99 hours, 9.90 CEU), $210. Whether a fall section runs is not published.";
const ACADEMY_NOTE = "Careers Electric summer academy (seven weeks, paid; with Winston-Salem/Forsyth County Schools; launched 2026): 144 hours carried over seven weeks as one block a week with no day or time — the one-year-of-apprenticeship equivalence the college states, at the standard's 144-hour minimum; the academy's courses, dates, hours and room are not published.";

const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10000) / 10000;

/** The sessions of a course in a term of `weeks` weeks. `level` = an apprenticeship term on its published nights
 *  (`spring` = 35 nights); `academy` = the summer academy's weekly block; `ce` = the continuing-education course. */
function sessionsFor(code, weeks, opts = {}) {
  const cat = CATALOG[code];
  const out = []; const n = { CLASS: 0, LAB: 0 };
  const push = (kind, week, day, start, end, hours, room, seats, notes) => out.push({
    kind, number: ++n[kind], title: `${cat.title} — ${kind === "CLASS" ? "Class" : "Lab"}, week ${week}`, deliveryMode: "In-person", location: room,
    lengthHours: hours, maxStudents: seats, facultyNeeded: 1, facultyContactPolicy: FACULTY_POLICY, supportStaffNeeded: 0, supportContactPolicy: 1,
    week, dayOfWeek: day, startTime: start, endTime: end, sectionTimes: null, notes, preceptorsNeeded: 0, preceptorContactPolicy: null, rotationType: null, clinicalMode: null,
  });
  const [c, l] = cat.hours;
  if (opts.level) {
    const s = LEVEL_NIGHTS[opts.level];
    const nights = opts.spring ? 35 : weeks * 2;
    for (let i = 0; i < nights; i++) {
      const week = Math.floor(i / 2) + 1; const d = s.days[i % 2];
      push("CLASS", week, d, s.start, s.end, 2.5, s.room, SEATS, `${s.note} ${OJT[0].toUpperCase()}${OJT.slice(1)}. ${SEATS_NOTE} ${POLICY_NOTE}`);
    }
    return out;
  }
  if (opts.academy) {
    for (let w = 1; w <= weeks; w++) push("CLASS", w, null, null, null, r4(144 / weeks), null, SEATS, `${ACADEMY_NOTE} ${SEATS_NOTE} ${POLICY_NOTE}`);
    return out;
  }
  if (opts.ce) {
    for (let w = 1; w <= weeks; w++) for (const d of w === 1 ? ["Wed"] : ["Mon", "Wed"]) push("CLASS", w, d, "18:00", "21:00", 3, "West Campus 17", SEATS, `${CE_NOTE} ${SEATS_NOTE} ${POLICY_NOTE}`);
    return out;
  }
  // A credit course with no section on record (or a general-education course): the standard's hours as one class (and one
  // lab) row a week with no day or time at the Main Campus; the summer term carries the 16-week hours over its weeks.
  const scale = opts.summer ? 16 / weeks : 1;
  const seats = cat.gened ? 30 : SEATS;
  const notes = opts.summer ? `Summer 8-week term (the course schedule's summer 2026 electrical sections ran 05/18–07/13): the standard's 16-week hours carried over ${weeks} weeks (${r2(c * scale)} class / ${r2(l * scale)} lab a week); no summer section is on record. ${SEATS_NOTE} ${POLICY_NOTE}`
    : cat.gened ? GENED : `${NO_SECTION} ${SEATS_NOTE} ${POLICY_NOTE}`;
  for (let w = 1; w <= weeks; w++) {
    if (c) push("CLASS", w, null, null, null, r2(c * scale), cat.gened ? "General classroom" : MC_CLASS, seats, notes);
    if (l) push("LAB", w, null, null, null, r2(l * scale), cat.gened ? "General lab" : MC_LAB, seats, notes);
  }
  return out;
}

// ---- The awards ------------------------------------------------------------------------------------------------
// term = [name, season, weeks, courses, gapAfter?]. Fall and spring are 16 weeks; the summer term is the college's 8-week
// electrical session. A gap is the weeks between a term's end and the next term's start (the apprenticeship's year).
const F = 16, S = 16, U = 8;
const AWARDS = [
  { file: "forsyth-est-diploma.json", name: "Electrical Systems Technology Diploma (D35130)", programType: "Traditional Full Time", credential: "Diploma", maxCohort: SEATS, months: 3,
    terms: [["Fall", "Fall", F, ["BPR 130", "ELC 112", "ELC 113", "ISC 115", "MAT 110"]], ["Spring", "Spring", S, ["ELC 114", "ELC 117", "ELC 118", "ISC 112", "ENG 111"]], ["Summer", "Summer", U, ["ELC 115", "ELC 233"]]],
    note: `Three terms over one year, 39 credits (the catalog's total): the fall's print reading, DC/AC electricity, residential wiring, construction safety and a mathematics choice (MAT 110 or MAT 143; 12 class · 14 lab · 17 credits), the spring's commercial wiring, motors and controls, the NEC, industrial safety and ENG 111 (10 · 14 · 15), and the summer's industrial wiring and energy management (7). Day classes. The program page also names a work-based learning course the table does not show. ${REVISED} ${SEATS_NOTE} ${POLICY_NOTE}` },
  { file: "forsyth-est-cert.json", name: "Electrical Systems Technology Certificate (C35130)", programType: "Certificate", credential: "Certificate", maxCohort: SEATS, months: 3,
    terms: [["Fall", "Fall", F, ["ELC 112", "ELC 113"]], ["Spring", "Spring", S, ["ELC 114", "ELC 118"]]],
    note: `Two terms, 15 credits (the catalog's total): ELC 112 and 113 in the fall, ELC 114 and 118 in the spring — the diploma's wiring core. The program page gives 1–2 semesters, part-time, day classes. ${SEATS_NOTE} ${POLICY_NOTE}` },
  { file: "forsyth-est-ccp.json", name: "Electrical Systems Technology — Career & College Promise pathway (C35130P1)", programType: "High school (CCP)", credential: "Certificate", maxCohort: SEATS, months: 3,
    terms: [["Fall", "Fall", F, ["ELC 112", "ELC 113"]], ["Spring", "Spring", S, ["ELC 114", "ELC 118"]]],
    note: `The Career & College Promise certificate pathway for high-school juniors and seniors as the college's 2023 CCP booklet gives it: the certificate's four courses, 15 credits (the booklet's snippet also shows ELC 117 in the spring, which would make 19 — not resolved; the current certificate carries four). The Technical Career Path page also offers the full diploma (D35130P1) to high-school students. School, block, days and size are not published — no day or time is set. ${SEATS_NOTE} ${POLICY_NOTE}` },
  { file: "forsyth-careers-electric-academy.json", name: "Careers Electric Summer Academy (summer pre-apprenticeship)", programType: "High school pre-apprenticeship", credential: "Pre-apprenticeship certificate (ApprenticeshipNC) and industry credentials", maxCohort: SEATS, months: 3, academy: true,
    terms: [["Summer", "Summer", 7, ["Summer academy"]]],
    note: `The college's paid seven-week summer academy for high-school students with Winston-Salem/Forsyth County Schools, launched 2026 as one of the NC Business Committee for Education's twelve Careers Electric academies (Siemens Foundation-funded): one or two college electrical courses for credit (not named), industry-valued credentials, hands-on work with local employers, a registered pre-apprenticeship, a $2,000 completion stipend, employer matching afterward and a tuition waiver for those who continue into an apprenticeship; the college says it counts for one year of the four-year electrical apprenticeship. Carried at 144 hours — the standard's minimum for a year's related instruction — because the academy's hours, courses, dates, room and cohort size are not published (statewide, 220 students across twelve academies in 2026). ${SEATS_NOTE} ${POLICY_NOTE}` },
  { file: "forsyth-electrical-install-troubleshoot.json", name: "Electrical: Installation/Troubleshooting (continuing education)", programType: "Continuing education", credential: "Certificate of completion", maxCohort: SEATS, months: 0, calendarMode: "continuous", ce: true,
    terms: [["Course", null, 17, ["Installation/Troubleshooting"]]],
    note: `The college's non-credit evening course at West Campus (Workforce Continuing Education): electrical safety and theory, NEC codes, service and repair, troubleshooting, circuit and equipment installation in a skills lab, toward an entry-level role with an electrical contractor. The published section: Mon/Wed 6:00–9:00 PM, West Campus 17, 01/20–05/12/2027 — 33 evenings, 99 hours (9.90 CEU), $210. Whether it also runs in the fall, and the lab's seats, are not published. ${SEATS_NOTE} ${POLICY_NOTE}` },
];
const APPRENTICESHIP = {
  file: "forsyth-electrician-apprenticeship.json", name: "Electrician Apprenticeship (Forsyth County Electrical Contractors Association, at Forsyth Tech)", programType: "Registered apprenticeship", credential: "Journeyman's Card (NC Department of Labor)", maxCohort: SEATS, months: 0, calendarMode: "continuous", level: true,
  // Fall 16 weeks → 5 weeks off → spring 18 weeks (35 nights) → 13 weeks off → the next level a year on.
  terms: [
    ["Level 1 Fall", null, 16, ["Level 1 Fall"], 5], ["Level 1 Spring", null, 18, ["Level 1 Spring"], 13],
    ["Level 2 Fall", null, 16, ["Level 2 Fall"], 5], ["Level 2 Spring", null, 18, ["Level 2 Spring"], 13],
    ["Level 3 Fall", null, 16, ["Level 3 Fall"], 5], ["Level 3 Spring", null, 18, ["Level 3 Spring"], 13],
    ["Level 4 Fall", null, 16, ["Level 4 Fall"], 5], ["Level 4 Spring", null, 18, ["Level 4 Spring"], 0],
  ],
  note: "The four-year Forsyth County Electrical Contractors Association apprenticeship taught at Forsyth Tech (Workforce Continuing Education; SOC 47-2111): each level is one year, fall through spring, with at least 144 hours of classroom instruction a year and 2,000 hours of on-the-job training a year (the catalog); graduates receive a Journeyman's Card from the NC Department of Labor. Carried on the college's published sections: a fall term of 16 weeks at two 2.5-hour evenings (80 hours, the published 8.00 CEU) and a spring term of 35 evenings (87.5 hours, 8.75 CEU) — 167.5 hours a level, 670 in all — Level 1 Tue/Thu 7:00–9:30 PM in Robert L. Strickland Center 1250, Level 2 Mon/Wed 6:30–9:00 PM at the Strickland Center (a second section Tue/Thu at West Campus), Level 4 Tue/Thu 6:00–8:30 PM at the Strickland Center; no Level 3 section was found, so its evenings carry no day or time. $240 a semester; apprentices must be 18, register in the fall, and complete the fall class before the spring class; those not employed by an electrical contractor may enroll and pay the fees. On-the-job hours are recorded on each level, not scheduled. Which contractors employ the apprentices, the class size and the apprenticeship's ApprenticeshipNC registration number are not published. Contact: James Mitchell, 336.734.7771. Class size 16 is a stand-in.",
};

function pack(def) {
  let startWeek = 1;
  const terms = def.terms.map(([name, semester, weeks, codes, gapAfter = 0], i) => {
    const t = { index: i + 1, name, semester, startWeek, endWeek: startWeek + weeks - 1, weeks, courses: codes.map((code) => {
      const cat = CATALOG[code]; const summer = semester === "Summer"; const [c, l, w] = cat.hours;
      const level = def.level ? name.replace(/ (Fall|Spring)$/, "") : null;
      const course = { code, title: cat.title, weeklyClassHours: c, weeklyLabHours: l, weeklyClinicalHours: 0, weeklyWorkHours: w, credits: cat.credits, requisites: cat.requisites, courseType: cat.gened ? "GENED" : "CORE", description: cat.description ?? (cat.gened ? GENED : null), sessions: sessionsFor(code, weeks, { summer: summer && !def.academy, academy: def.academy, ce: def.ce, level, spring: /Spring$/.test(name) }) };
      return carryCatalogHours(course, [c, l, 0], weeks, (m) => console.warn(m));
    }) };
    startWeek += weeks + gapAfter;
    return t;
  });
  return { name: def.name, programType: def.programType, credential: def.credential, sourceWorkbook: SOURCE, institution: "Forsyth Technical Community College", maxCohort: def.maxCohort, ...(def.calendarMode ? { calendarMode: def.calendarMode } : {}), monthsToFullProductivity: def.months, note: def.note,
    weeklyHoursNote: `${HOURS_RULE} Hours and credits are the NCCCS course standard's; every credit course carries its hours with no section on record at the Main Campus (the lab building is not published); the apprenticeship sits on its published evenings at the Strickland Center and the Installation/Troubleshooting course on its published Mon/Wed evenings at West Campus; clinical hours are zero in every course.`,
    assumptions: ASSUMPTIONS, terms };
}

for (const def of [...AWARDS, APPRENTICESHIP]) {
  const p = pack(def);
  writeFileSync(`prisma/templates/${def.file}`, JSON.stringify(p, null, 2) + "\n");
  const courses = p.terms.flatMap((t) => t.courses);
  console.log(def.file.padEnd(46), `${p.terms.length} terms · ${courses.length} courses · ${courses.reduce((n, c) => n + c.sessions.length, 0)} sessions · credits ${courses.reduce((n, c) => n + c.credits, 0)} · hours ${r2(courses.reduce((n, c) => n + c.sessions.reduce((m, s) => m + s.lengthHours, 0), 0))}`);
}
