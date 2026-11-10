// Build Pitt Community College's Electrical Systems Technology template packs — the AAS (A35130), the diploma (D3513001),
// the Basic Electrical (C3513001), Introduction to Electrical (C3513008), Programmable Logic Controller (C3513002),
// Industrial Controls (C3513003) and Photovoltaic Systems (C3513004) certificates, the high-school Technical Academy
// sequence, the summer Careers Electric Academy pre-apprenticeship, and the Pitt-sponsored electrician apprenticeship —
// into prisma/templates/pitt-*.json.
//
// What is the college's (compiled 2026-11-10 from what its site gave through search; pittcc.edu, catalog.pittcc.edu and
// nccommunitycolleges.edu were unreachable from the build environment): the credentials and their codes (the 2025–26 CIP
// list and the program pages), the AAS's 68-credit total and five-semester length (the catalog page as indexed), the
// diploma's and the certificates' course lists (the program's diploma-and-certificates page), the Introduction to
// Electrical certificate's 14 credits as four courses of 5, 4, 2 and 3 (the names not read), the Technical Academy's
// high-school sections (Fall I ELC 113 + 118, Spring I ELC 114, Fall II ELC 112, Spring II ELC 115, Mon–Fri 9–11 AM; a page
// dated about 2019), the Careers Electric Academy (June 11 – August 4, ELC 113, ELC 118, ISC 121, OSHA 30), the Vernon E.
// White Building as the program's home, the 2026–27 calendar, the apprenticeship directory entry (#97754: Electrician,
// sponsor Pitt CC, employers Thomas Electrical Solutions and the City of Greenville, time-based, 8,000 hours, 1:1).
// What is the state's: every course's title, class · lab hours and credits are the NCCCS Combined Course Library's.
// What is laid out here: each sequence puts the college's published course lists into its terms to its published total;
// the catalog's program-of-study pages replace it when they can be read. The faculty load is the workspace default
// (16 contact hours of a 40-hour week, 2.5 work hours a contact hour) because the college publishes none, and 16 students
// a section is a stand-in (the college says only "small class sizes"). Nothing else is invented: no day sections or room
// numbers were published, and none is set.
//
//   node scripts/build-pitt-packs.mjs
import { writeFileSync } from "node:fs";
import { carryCatalogHours, HOURS_RULE } from "./packhours.mjs";

const SOURCE = "Pitt CC: the 2025–26 Program CIP Codes list (credential codes, CIP 46.0302), the catalog's AAS page as indexed (68 credits, five semesters), the Electrical Systems Technology diploma-and-certificates page (course lists), the high-school options page (Technical Academy sections, Mon–Fri 9–11 AM), the Careers Electric Academy page, the faculty page (Vernon E. White Building), the 2026–27 Curriculum Academic Calendar, the NCCCS apprenticeship directory entry #97754 and the Thomas Electrical Solutions apprenticeship page; course hours and credits from the NCCCS Combined Course Library; sequences laid out to the published totals — compiled 2026-11-10";
// Faculty load: the college publishes none — the workspace default (16 of 40, 2.5 work hours a contact hour) stands on every
// session until the college's figure arrives. Class size: a stand-in of 16 (the lab-room size used at Rowan-Cabarrus and
// Cape Fear; Pitt says only "small class sizes").
const FACULTY_POLICY = 2.5;
const SEATS = 16;
const SEATS_NOTE = "Class size 16 is a stand-in (the college publishes no section cap; its page says \"small class sizes\").";
const POLICY_NOTE = "Faculty load is the workspace default (16 contact hours of a 40-hour week) — the college publishes no load.";
const ASSUMPTIONS = { facContactHours: 16, facWorkWeekHours: 40, facTermWeeks: 16, preContactHours: 40, preWorkWeekHours: 40, preTermWeeks: 16 };
const GENED = "General-enrollment course taught outside the program, offered every term; placed here as the program of study has it.";
const UNCONFIRMED = "Laid out from the college's published course lists to its published total; not yet confirmed against the catalog's program of study (catalog.pittcc.edu was unreachable on 2026-11-10).";
const NO_SECTION = "No section for this course is on record (the college's class search was unreachable); the hours are carried with no day or time in the program's building until the college's sections are read.";
const VEW_CLASS = "Vernon E. White Building – Classroom";
const VEW_LAB = "Vernon E. White Building – Wiring lab";

// ---- The standard: hours are class · lab · work a week on a 16-week basis, then credits --------------------------
const CATALOG = {
  "ELC 112": { title: "DC/AC Electricity", hours: [3, 6, 0], credits: 5, requisites: "", description: "Direct- and alternating-current theory: units, circuit laws, series and parallel circuits, magnetism, transformers, measurement with meters. The AAS's \"Take One\" DC/AC option names this course (5 credits) or a 4-credit alternative the catalog page did not show." },
  "ELC 113": { title: "Residential Wiring", hours: [2, 6, 0], credits: 4, requisites: "", description: "Residential wiring methods, materials and the NEC: services, branch circuits, boxes, devices and lighting, installed in the wiring lab's residential bays." },
  "ELC 114": { title: "Commercial Wiring", hours: [2, 6, 0], credits: 4, requisites: "ELC 113", description: "Commercial wiring methods: raceways, conductors, services, feeders, panelboards, lighting and the NEC articles that govern them, installed in the wiring lab's commercial bays." },
  "ELC 115": { title: "Industrial Wiring", hours: [2, 6, 0], credits: 4, requisites: "ELC 113", description: "Industrial wiring methods: raceways, conductors, services, feeders, panelboards, transformers and the NEC articles that govern them, installed in the wiring lab's industrial bays." },
  "ELC 117": { title: "Motors and Controls", hours: [2, 6, 0], credits: 4, requisites: "ELC 112", description: "Motor theory, single- and three-phase motors, starters, relays and control circuits, wired and tested in the lab." },
  "ELC 118": { title: "National Electrical Code", hours: [1, 2, 0], credits: 2, requisites: "", description: "Reading and applying the National Electrical Code." },
  "ELC 119": { title: "NEC Calculations", hours: [1, 2, 0], credits: 2, requisites: "ELC 118", description: "Branch-circuit, feeder and service calculations under the National Electrical Code." },
  "ELC 125": { title: "Diagrams and Schematics", hours: [1, 2, 0], credits: 2, requisites: "", description: "Reading and drawing electrical diagrams, schematics, ladder diagrams and one-lines." },
  "ELC 128": { title: "Introduction to Programmable Logic Controllers", hours: [2, 3, 0], credits: 3, requisites: "ELC 117", description: "PLC hardware, ladder logic, timers, counters and simple control programs on the lab's trainers." },
  "ELC 228": { title: "PLC Applications", hours: [2, 6, 0], credits: 4, requisites: "ELC 128", description: "PLC applications: analog I/O, data handling, networking, HMI, program design and troubleshooting." },
  "ELC 220": { title: "Photovoltaic Systems Technology", hours: [2, 3, 0], credits: 3, requisites: "ELC 112", description: "Photovoltaic system design, installation and the NEC: modules, inverters, charge controllers, batteries, grounding and interconnection — the Photovoltaic Systems certificate's capstone." },
  "ELC 229": { title: "Applications Project", hours: [1, 6, 0], credits: 3, requisites: "Final semester", description: "A capstone project: planning, estimating, installing and documenting an electrical system." },
  "ELN 133": { title: "Digital Electronics", hours: [3, 3, 0], credits: 4, requisites: "", description: "Number systems, logic gates, Boolean algebra, combinational and sequential circuits, built and tested in the lab — a Programmable Logic Controller certificate course taught by Electronics Engineering Technology." },
  "ISC 112": { title: "Industrial Safety", hours: [2, 0, 0], credits: 2, requisites: "", description: "Industrial safety: OSHA regulations, hazard recognition, lockout/tagout, PPE and safe work practices — the AAS's safety elective as the diploma lists it." },
  "ISC 121": { title: "Environmental Health and Safety", hours: [2, 0, 0], credits: 2, requisites: "", description: "Environmental health and safety regulations and practices on the job — the Careers Electric Academy's safety course (OSHA 30 alongside it)." },
  "BPR 130": { title: "Print Reading – Construction", hours: [2, 0, 0], credits: 2, requisites: "", description: "Reading construction drawings: plans, elevations, sections, details, schedules and specifications." },
  "EGR 125": { title: "Application Software for Technicians", hours: [1, 2, 0], credits: 2, requisites: "", description: "Spreadsheets, documents and technical software for the technician's work." },
  "ACA 111": { title: "College Student Success", hours: [1, 0, 0], credits: 1, requisites: "", gened: true },
  "ENG 111": { title: "Writing and Inquiry", hours: [3, 0, 0], credits: 3, requisites: "", gened: true },
  "MAT 110": { title: "Mathematical Measurement and Literacy", hours: [2, 2, 0], credits: 3, requisites: "", gened: true },
  "COM 231": { title: "Public Speaking", hours: [3, 0, 0], credits: 3, requisites: "", gened: true, description: "The AAS's communication choice (COM 231 or ENG 112); placed here as the first of the catalog's options." },
  "Humanities/Fine Arts elective": { title: "Humanities / Fine Arts elective", hours: [3, 0, 0], credits: 3, requisites: "", gened: true, description: "Three credits from the humanities / fine arts list (ART 111, HUM 115, MUS 110, PHI 240 …)." },
  "Social/Behavioral Science elective": { title: "Social / Behavioral Science elective", hours: [3, 0, 0], credits: 3, requisites: "", gened: true, description: "Three credits from the social / behavioral science list (PSY 150, SOC 210, ECO 251 …)." },
  "Major elective (2 credits)": { title: "Major elective (2 credits, the catalog's Take One)", hours: [1, 2, 0], credits: 2, requisites: "", description: "Two credits from the AAS's \"Take One\" options that the catalog page did not show; carried at 1 class + 2 lab hours a week so the AAS holds its published 68 credits. Replaced when the catalog's program of study is read." },
  "Fourth course (3 credits)": { title: "Fourth course (3 credits, not identified)", hours: [2, 3, 0], credits: 3, requisites: "", description: "The Introduction to Electrical certificate's catalog page shows four courses of 5, 4, 2 and 3 credits without names; the 3-credit course was not read and is carried at 2 class + 3 lab hours a week. Replaced when the catalog page is read." },
  "Year 1": { title: "Electrician Apprenticeship — Year 1 related instruction", hours: [4, 0, 0], credits: 0, requisites: "Employed by a participating employer and registered with ApprenticeshipNC through the Pitt CC sponsor", description: "Year 1 of the Pitt CC-sponsored electrician apprenticeship (ApprenticeshipNC #97754, SOC 47-2111): about 2,000 hours of paid on-the-job training with the employer (Thomas Electrical Solutions, the City of Greenville) and related instruction — carried at 144 classroom hours a year, the US DOL / ApprenticeshipNC minimum, because the college publishes no hours." },
  "Year 2": { title: "Electrician Apprenticeship — Year 2 related instruction", hours: [4, 0, 0], credits: 0, requisites: "Year 1", description: "Year 2: wiring methods, the NEC, motors and controls on the job and in class; about 2,000 OJT hours and 144 related-instruction hours (the standard's minimum)." },
  "Year 3": { title: "Electrician Apprenticeship — Year 3 related instruction", hours: [4, 0, 0], credits: 0, requisites: "Year 2", description: "Year 3: commercial and industrial systems, code calculations, motor controls; about 2,000 OJT hours and 144 related-instruction hours (the standard's minimum)." },
  "Year 4": { title: "Electrician Apprenticeship — Year 4 related instruction", hours: [4, 0, 0], credits: 0, requisites: "Year 3", description: "Year 4: advanced code, estimating and review toward the journeyman examination; about 2,000 OJT hours and 144 related-instruction hours (the standard's minimum). Completion of the 8,000-hour term earns the journeyworker certificate (US DOL / ApprenticeshipNC)." },
};

// ---- The published sections: only the high-school Technical Academy block (Mon–Fri 9:00–11:00 AM) -----------------
// The college's high-school options page (dated about 2019) puts every Technical Academy class in one weekday block; the
// hours rule stretches the posted block to the catalog's load. No curriculum day section or room number is published.
const ACADEMY_BLOCK = [["Mon", "09:00", "11:00"], ["Tue", "09:00", "11:00"], ["Wed", "09:00", "11:00"], ["Thu", "09:00", "11:00"], ["Fri", "09:00", "11:00"]];
const ACADEMY_NOTE = "High School Technical Academy section: Mon–Fri 9:00–11:00 AM (the college's high-school options page, dated about 2019); the class hour and the lab share the posted block. Room not published.";

const hm = (t) => { const [h, m] = t.split(":").map(Number); return h + m / 60; };
const len = (a, b) => Math.round((hm(b) - hm(a)) * 100) / 100;
const r2 = (x) => Math.round(x * 100) / 100;

/** The sessions of a course in a term of `weeks` weeks. `academy` = the high-school Technical Academy (the posted weekday
 *  block); `careers` = the summer Careers Electric Academy (8 weeks, no day or time); `apprentice` = related instruction,
 *  one class a week, delivery not published. */
function sessionsFor(code, weeks, opts = {}) {
  const cat = CATALOG[code];
  const out = []; const n = { CLASS: 0, LAB: 0 };
  const push = (kind, week, day, start, end, hours, room, seats, notes) => out.push({
    kind, number: ++n[kind], title: `${cat.title} — ${kind === "CLASS" ? "Class" : "Lab"}, week ${week}`, deliveryMode: "In-person", location: room,
    lengthHours: hours, maxStudents: seats, facultyNeeded: 1, facultyContactPolicy: FACULTY_POLICY, supportStaffNeeded: 0, supportContactPolicy: 1,
    week, dayOfWeek: day, startTime: start, endTime: end, sectionTimes: null, notes, preceptorsNeeded: 0, preceptorContactPolicy: null, rotationType: null, clinicalMode: null,
  });
  const [c, l] = cat.hours;
  if (opts.apprentice) {
    for (let w = 1; w <= weeks; w++) push("CLASS", w, null, null, null, 4, null, SEATS, `Related instruction: one class a week over a 36-week year — 144 classroom hours a year, 576 over four years (the US DOL / ApprenticeshipNC minimum; the college publishes no hours). Thomas Electrical Solutions describes its track as online classroom instruction with paid field training; the sponsor's delivery, nights and room are not published. ${SEATS_NOTE} ${POLICY_NOTE}`);
    return out;
  }
  if (opts.academy) {
    // The class hour leads into the lab in the same block; the hours rule carries each to the catalog's load.
    for (let w = 1; w <= weeks; w++) for (const [d, s, e] of ACADEMY_BLOCK) {
      const split = s === "09:00" ? "10:00" : e;
      if (c) push("CLASS", w, d, s, split, len(s, split), "High school Technical Academy", SEATS, `${ACADEMY_NOTE} ${SEATS_NOTE} ${POLICY_NOTE}`);
      if (l) push("LAB", w, d, s, e, len(s, e), "High school Technical Academy", SEATS, `${ACADEMY_NOTE} ${SEATS_NOTE} ${POLICY_NOTE}`);
    }
    return out;
  }
  // A course with no section on record, a summer course or a general-education course: the standard's hours as one class
  // (and one lab) row a week with no day or time, in the program's building.
  const scale = opts.summer ? 16 / weeks : 1;
  const seats = cat.gened ? 30 : SEATS;
  const notes = opts.careers ? `Careers Electric Academy (summer pre-apprenticeship for high-school students with Pitt County Schools, ApprenticeshipNC-recognized): June 11 – August 4 in the program's wiring lab; the standard's 16-week hours carried over ${weeks} weeks (${r2(c * scale)} class / ${r2(l * scale)} lab a week); days and times not published. ${SEATS_NOTE} ${POLICY_NOTE}`
    : opts.summer ? `Summer 10-week session: the standard's 16-week hours carried over ${weeks} weeks (${r2(c * scale)} class / ${r2(l * scale)} lab a week); no summer section is on record. ${SEATS_NOTE} ${POLICY_NOTE}`
    : cat.gened ? GENED : `${NO_SECTION} ${SEATS_NOTE} ${POLICY_NOTE}`;
  for (let w = 1; w <= weeks; w++) {
    if (c) push("CLASS", w, null, null, null, r2(c * scale), cat.gened ? "General classroom" : VEW_CLASS, seats, notes);
    if (l) push("LAB", w, null, null, null, r2(l * scale), cat.gened ? "General lab" : VEW_LAB, seats, notes);
  }
  return out;
}

// ---- The awards ------------------------------------------------------------------------------------------------
// term = [name, season, weeks, courses]. Fall and spring are 16 weeks; the summer term is the college's 10-week session.
const F = 16, S = 16, U = 10;
const YEAR_ONE = [
  ["Year 1 Fall", "Fall", F, ["ELC 112", "ELC 113", "ELC 118", "ISC 112", "ACA 111", "ENG 111"]],
  ["Year 1 Spring", "Spring", S, ["ELC 114", "ELC 117", "ELC 125", "BPR 130", "EGR 125", "MAT 110"]],
];
const CERT = (terms) => terms;
const AWARDS = [
  { file: "pitt-est-aas.json", name: "Electrical Systems Technology AAS (A35130)", programType: "Traditional Full Time", credential: "AAS", maxCohort: SEATS, months: 3,
    terms: [...YEAR_ONE, ["Year 1 Summer", "Summer", U, ["ELC 119", "ELC 128", "COM 231"]], ["Year 2 Fall", "Fall", F, ["ELC 115", "ELC 228", "ELN 133", "Humanities/Fine Arts elective"]], ["Year 2 Spring", "Spring", S, ["ELC 229", "ELC 220", "Major elective (2 credits)", "Social/Behavioral Science elective"]]],
    note: `Five semesters over two years, 68 credits (the catalog's total): the diploma's courses — DC/AC theory, residential, commercial and industrial wiring, the NEC and its calculations, motors and controls, diagrams, print reading, industrial safety, application software and the applications project — with the PLC, digital electronics and photovoltaic courses of the college's certificates, ENG 111, MAT 110, ACA 111, a communication choice (COM 231 or ENG 112), a humanities/fine-arts and a social/behavioral-science choice, and two credits of the catalog's "Take One" options not read. The catalog's DC/AC option (ELC 112 at 5 credits or a 4-credit alternative) and safety elective are carried as ELC 112 and ISC 112, as the diploma lists them. ${UNCONFIRMED} ${SEATS_NOTE} ${POLICY_NOTE}` },
  { file: "pitt-est-diploma.json", name: "Electrical Systems Technology Diploma (D3513001)", programType: "Traditional Full Time", credential: "Diploma", maxCohort: SEATS, months: 3,
    terms: [...YEAR_ONE, ["Year 1 Summer", "Summer", U, ["ELC 115", "ELC 119", "ELC 229"]]],
    note: `Three terms over twelve months, 43 credits (the sum of the college's published course list by the state standard; the college's own total was not read): ELC 112, 113, 114, 115, 117, 118, 119, 125 and 229, ISC 112, BPR 130, EGR 125, ACA 111, ENG 111 and MAT 110 — the AAS's first year with industrial wiring, NEC calculations and the applications project in the 10-week summer. ${UNCONFIRMED} ${SEATS_NOTE} ${POLICY_NOTE}` },
  { file: "pitt-est-cert-basic.json", name: "Basic Electrical Certificate (C3513001)", programType: "Certificate", credential: "Certificate", maxCohort: SEATS, months: 3,
    terms: CERT([["Fall", "Fall", F, ["ELC 112", "ELC 113", "ELC 118"]], ["Spring", "Spring", S, ["ELC 114"]]]),
    note: `Two terms, the college's four courses (ELC 112, 113, 114, 118 — the program page calls it the Basic Electrical Certificate, the CIP list the Basic Wiring Certificate): 15 credits by the state standard where the 2022–23 catalog page shows 14 with a 4-credit DC/AC option — the one-credit difference is the catalog's DC/AC alternative, not read. ${UNCONFIRMED} ${SEATS_NOTE} ${POLICY_NOTE}` },
  { file: "pitt-est-cert-intro.json", name: "Introduction to Electrical Certificate (C3513008)", programType: "Certificate", credential: "Certificate", maxCohort: SEATS, months: 3,
    terms: CERT([["Fall", "Fall", F, ["ELC 112", "ELC 113", "ELC 118"]], ["Spring", "Spring", S, ["Fourth course (3 credits)"]]]),
    note: `Two terms, 14 credits (the 2024–25 catalog's total): four courses of 5, 4, 2 and 3 credits whose names the indexed page did not show — carried as ELC 112, 113 and 118 (the program's entry courses at those credits) and an unidentified 3-credit course. ${UNCONFIRMED} ${SEATS_NOTE} ${POLICY_NOTE}` },
  { file: "pitt-est-cert-plc.json", name: "Programmable Logic Controller Certificate (C3513002)", programType: "Certificate", credential: "Certificate", maxCohort: SEATS, months: 3,
    terms: CERT([["Year 1 Fall", "Fall", F, ["ELC 112"]], ["Year 1 Spring", "Spring", S, ["ELC 128"]], ["Year 2 Fall", "Fall", F, ["ELC 228", "ELN 133"]]]),
    note: `Three terms, 16 credits (the college's four courses by the state standard; its own total was not read): ELC 112, then ELC 128, then ELC 228 and ELN 133 (digital electronics, taught by Electronics Engineering Technology). The college's own term placement was not read. ${UNCONFIRMED} ${SEATS_NOTE} ${POLICY_NOTE}` },
  { file: "pitt-est-cert-controls.json", name: "Industrial Controls Certificate (C3513003)", programType: "Certificate", credential: "Certificate", maxCohort: SEATS, months: 3,
    terms: CERT([["Fall", "Fall", F, ["ELC 112", "ELC 125"]], ["Spring", "Spring", S, ["ELC 117", "ELC 128"]]]),
    note: `Two terms, 14 credits (the college's four courses by the state standard; its own total was not read): ELC 112 and 125, then ELC 117 and 128. ${UNCONFIRMED} ${SEATS_NOTE} ${POLICY_NOTE}` },
  { file: "pitt-est-cert-pv.json", name: "Photovoltaic Systems Certificate (C3513004)", programType: "Certificate", credential: "Certificate", maxCohort: SEATS, months: 3,
    terms: CERT([["Fall", "Fall", F, ["ELC 112", "ELC 118"]], ["Spring", "Spring", S, ["ELC 114", "ELC 220"]]]),
    note: `Two terms, 14 credits (the college's four courses by the state standard; its own total was not read): ELC 112 and 118, then ELC 114 and ELC 220. ${UNCONFIRMED} ${SEATS_NOTE} ${POLICY_NOTE}` },
  { file: "pitt-est-hs-academy.json", name: "Electrical Systems Technology — High School Technical Academy (CCP)", programType: "High school (CCP)", credential: "Certificate", maxCohort: SEATS, months: 3, academy: true,
    terms: [["Fall I", "Fall", F, ["ELC 113", "ELC 118"]], ["Spring I", "Spring", S, ["ELC 114"]], ["Fall II", "Fall", F, ["ELC 112"]], ["Spring II", "Spring", S, ["ELC 115"]]],
    note: `The college's Career & College Promise Technical Academy sequence for Pitt County high-school students as its high-school options page gives it (dated about 2019): ELC 113 and 118 in the first fall, ELC 114 in the first spring, ELC 112 in the second fall, ELC 115 in the second spring — 19 credits, every class Mon–Fri 9:00–11:00 AM. The 2025–26 CIP list names a high-school Commercial Pathway certificate (C35130H5) whose course list was not read; this sequence stands for it until then. ${SEATS_NOTE} ${POLICY_NOTE}` },
  { file: "pitt-careers-electric-academy.json", name: "Careers Electric Academy (summer pre-apprenticeship)", programType: "High school pre-apprenticeship", credential: "Pre-apprenticeship certificate (ApprenticeshipNC) and OSHA 30", maxCohort: SEATS, months: 3, careers: true,
    terms: [["Summer", "Summer", 8, ["ELC 113", "ELC 118", "ISC 121"]]],
    note: `The college's summer pre-apprenticeship for high-school students with Pitt County Schools, recognized by ApprenticeshipNC and one of the NC Business Committee for Education's Careers Electric academies: June 11 – August 4, ELC 113 Residential Wiring, ELC 118 National Electrical Code and ISC 121 Environmental Health and Safety (8 credits) with OSHA 30; employer partners Greenville Utilities and Thomas Electric. Days, times and the cohort size are not published. ${SEATS_NOTE} ${POLICY_NOTE}` },
];
const APPRENTICESHIP = {
  file: "pitt-electrician-apprenticeship.json", name: "Electrician Apprenticeship (Pitt CC sponsor, ApprenticeshipNC #97754)", programType: "Registered apprenticeship", credential: "Journeyworker certificate (US DOL / ApprenticeshipNC)", maxCohort: SEATS, months: 0, calendarMode: "continuous",
  terms: [["Year 1", null, 36, ["Year 1"]], ["Year 2", null, 36, ["Year 2"]], ["Year 3", null, 36, ["Year 3"]], ["Year 4", null, 36, ["Year 4"]]],
  gap: 16, // weeks between one 36-week year and the next
  note: "The registered electrician apprenticeship the college sponsors (NCCCS apprenticeship directory #97754, SOC 47-2111): time-based, an 8,000-hour term — four years of about 2,000 hours of paid on-the-job training with the employer — at a 1:1 apprentice-to-journeyworker ratio, offered through Thomas Electrical Solutions and the City of Greenville (the college's other electrical employer partners: Coastline Electrical, Hemby Electrical, Pitt Electric, Sharpes Electrical LLC, Greenville Utilities). Related instruction is carried at 144 hours a year (576 in all), the US DOL / ApprenticeshipNC minimum — the college publishes no hours, nights, room or class size; Thomas describes its track as online classroom instruction with paid field training. A second directory entry lists Thomas under the NC Association of Electrical Contractors as a hybrid 4,000-hour term with a 3,000-hour minimum; which entry governs a given apprentice is not published. Class size 16 is a stand-in.",
};

function pack(def) {
  let startWeek = 1;
  const terms = def.terms.map(([name, semester, weeks, codes], i) => {
    const t = { index: i + 1, name, semester, startWeek, endWeek: startWeek + weeks - 1, weeks, courses: codes.map((code) => {
      const cat = CATALOG[code]; const summer = semester === "Summer"; const [c, l, w] = cat.hours;
      const course = { code, title: cat.title, weeklyClassHours: c, weeklyLabHours: l, weeklyClinicalHours: 0, weeklyWorkHours: w, credits: cat.credits, requisites: cat.requisites, courseType: cat.gened ? "GENED" : "CORE", description: cat.description ?? (cat.gened ? GENED : null), sessions: sessionsFor(code, weeks, { summer, academy: def.academy, careers: def.careers, apprentice: !!def.gap }) };
      return carryCatalogHours(course, [c, l, 0], weeks, (m) => console.warn(m));
    }) };
    startWeek += weeks + (def.gap ?? 0);
    return t;
  });
  return { name: def.name, programType: def.programType, credential: def.credential, sourceWorkbook: SOURCE, institution: "Pitt Community College", maxCohort: def.maxCohort, ...(def.calendarMode ? { calendarMode: def.calendarMode } : {}), monthsToFullProductivity: def.months, note: def.note,
    weeklyHoursNote: `${HOURS_RULE} Hours and credits are the NCCCS course standard's; the high-school Technical Academy sits on the college's published Mon–Fri 9–11 AM block, every other course carries its hours with no section on record in the Vernon E. White Building; clinical hours are zero in every course.`,
    assumptions: ASSUMPTIONS, terms };
}

for (const def of [...AWARDS, APPRENTICESHIP]) {
  const p = pack(def);
  writeFileSync(`prisma/templates/${def.file}`, JSON.stringify(p, null, 2) + "\n");
  const courses = p.terms.flatMap((t) => t.courses);
  console.log(def.file.padEnd(40), `${p.terms.length} terms · ${courses.length} courses · ${courses.reduce((n, c) => n + c.sessions.length, 0)} sessions · credits ${courses.reduce((n, c) => n + c.credits, 0)}`);
}
