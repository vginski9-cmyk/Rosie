// Build Southeastern Community College's two RN template packs — the Associate Degree Nursing program (A45110,
// fall entry) and the accelerated LPN-to-ADN Transition (summer entry, three semesters, HyFlex) — into
// prisma/templates/southeastern-adn.json and southeastern-lpn-adn.json.
//
// What is the college's (its site through search, 2026-10-28, and what the program's dean and director told the
// owner on 2026-10-28): the two pathways and their entry terms, the admission cycles, the general-education courses,
// NUR 117 as a pre-admission prerequisite, the HyFlex bridge, the R Building, the 2026–27 term lengths; the term
// placement ("114 belongs in summer, 113 in fall two, 211 in spring one"), the eight-week sessions for every NUR
// course but 111 and 213, clinicals on hospital medical-surgical units every time with rotate-out days to OB,
// pediatrics, critical care and the emergency department, clinical groups of ten, NUR 111's lab split (Tuesday the
// whole cohort in the classroom, Thursday two sections of thirty in the lab with two instructors each), one cohort
// and one instructor for every other course, the preceptorship as fifteen 12-hour shifts 1:1 with a hospital RN plus
// 60 hours of simulation with one faculty member per fifteen students, a class of 60 by physical resources, the
// 20–24-hour load. What is the state's: every course's title, class · lab · clinical hours and credits are the NCCCS
// Combined Course Library's. What is assumed and flagged: the order of the two spring eight-week courses (112 then
// 211), the rotate-out days as whole-group shifts mid-course, the simulation weeks of NUR 213, four assigned lab
// instructors on NUR 111's Tuesday at the 60 cap. Not on record: section times, the clinical calendar's dates and
// days beyond NUR 111's (Tuesday lab, Wednesday clinical), the transition course's code (NUR 221 on the Fall 2026
// schedule) and dates — all due with the Dec 4 data package.
//
//   node scripts/build-southeastern-packs.mjs
import { writeFileSync } from "node:fs";
import { carryCatalogHours, HOURS_RULE } from "./packhours.mjs";

const SOURCE = "Southeastern CC: what the nursing dean and director told the owner on 2026-10-28 (sequence, eight-week sessions, rotations, group sizes, the NUR 111 lab split, the preceptorship, class size, workload); the ADN and LPN-to-ADN admission pages, the Nursing program page, the campus facilities list, the 2026–27 academic calendar, the NC Board of Nursing 2024 approved-programs list (140 students at one time) and 2021–2023 pass rates; course hours and credits from the NCCCS A45110 standard — compiled 2026-10-28";
// The program's stated load (2026-10-28): nursing instructional staff carry 20–24 direct-contact hours of a 40-hour, 8-to-5 week; 20 is the planning figure.
const ASSUMPTIONS = { facContactHours: 20, facWorkWeekHours: 40, facTermWeeks: 16, preContactHours: 40, preWorkWeekHours: 40, preTermWeeks: 16 };
const R = (room) => `R Building – ${room}`;
const SITE = "Clinical site";
const UNCONFIRMED = "Hours and credits are the NCCCS standard's; the term placement is the program's own (stated 2026-10-28) — the course-sequence document due Dec 4 confirms it.";
const NO_SECTION = "The cohort meets as one class with one instructor (the program, 2026-10-28); the Fall 2026 schedule's days, times and rooms arrive with the Dec 4 data package, so the hours are carried with no day or time in the R Building.";
const ROTATION_NOTE = "Clinical setting as the program described it (2026-10-28): hospital medical-surgical units every time, with rotate-out days to OB, pediatrics, critical care and the emergency department and a group in the simulation lab when it is staffed — the course's clinical calendar (due Dec 4) names the days; not the college's own rotation plan in detail.";
const GENED = "General-enrollment course taught outside the nursing department, offered every term; placed here as the standard's program of study has it (the college lists it among the courses to finish before applying).";

// ---- The catalog (NCCCS course standard): hours are class · lab · clinical a week on a 16-week basis, then credits ----
const CATALOG = {
  "NUR 111": { title: "Introduction to Health Concepts", hours: [4, 6, 6], credits: 8, requisites: "Admission to the program; NUR 117 Pharmacology within five years", description: "Introduces the concepts within the three domains of the individual, healthcare and nursing: medication administration, assessment, nutrition, ethics, interdisciplinary teams, informatics, evidence-based practice, individual-centered care and quality improvement. Sixteen weeks (the program runs its other NUR courses as eight-week sessions). Clinical on hospital medical-surgical units on Wednesdays, with the early weeks on campus in the skills and simulation labs; one group a week rotates into the simulation lab when the coordinator is free to staff it. The six-hour lab is split: Tuesday the whole cohort in the classroom for the lab's instruction, Thursday two sections of thirty in the lab." },
  "NUR 112": { title: "Health-Illness Concepts", hours: [3, 0, 6], credits: 5, requisites: "NUR 111 · co-requisite NUR 114", description: "Acid-base, metabolism, cellular regulation, oxygenation, infection, stress/coping, health-wellness-illness, communication, caring interventions, managing care, safety, quality improvement and informatics. An eight-week session in the spring (placed first, before NUR 211 — an assumption until the sequence document arrives); clinical on hospital medical-surgical units." },
  "NUR 114": { title: "Holistic Health Concepts", hours: [3, 0, 6], credits: 5, requisites: "NUR 111 · co-requisite NUR 112", description: "Cellular regulation, perfusion, inflammation, sensory perception, stress/coping, mood/affect, cognition, self, violence, health-wellness-illness, professional behaviors, caring interventions and safety. The college's eight-week summer session; clinical on hospital medical-surgical units (the program no longer rotates to a psychiatric site), with the simulation lab when staffed." },
  "NUR 113": { title: "Family Health Concepts", hours: [3, 0, 6], credits: 5, requisites: "NUR 111", description: "Oxygenation, sexuality, reproduction, grief/loss, mood/affect, behaviors, development, family, health-wellness-illness, communication, caring interventions, managing care, safety and advocacy. The first eight weeks of the second fall (Aug 17 – Oct 8, 2026 on the Fall 2026 schedule); clinical on hospital medical-surgical units with each student's rotate-out days to OB and pediatrics." },
  "NUR 211": { title: "Health Care Concepts", hours: [3, 0, 6], credits: 5, requisites: "NUR 111 · co-requisite NUR 212", description: "Cellular regulation, perfusion, infection, immunity, mobility, comfort, behaviors, health-wellness-illness, clinical decision-making, caring interventions, managing care and safety. The second eight weeks of the first spring (after NUR 112 — an assumption until the sequence document arrives); clinical on hospital medical-surgical units. The LPN-to-ADN cohort joins the second-year class." },
  "NUR 212": { title: "Health System Concepts", hours: [3, 0, 6], credits: 5, requisites: "NUR 111 · co-requisite NUR 211", description: "Grief/loss, violence, health-wellness-illness, collaboration, managing care, safety, advocacy, legal issues, policy, healthcare systems, ethics, accountability and evidence-based practice. The second eight weeks of the second fall; clinical on hospital medical-surgical units with each student's rotate-out days to critical care and the emergency department. The LPN-to-ADN cohort joins the second-year class." },
  "NUR 213": { title: "Complex Health Concepts", hours: [4, 3, 15], credits: 10, requisites: "NUR 111; NUR 112, 113, 114, 211 and 212 prior or concurrent", description: "Capstone: fluid/electrolytes, metabolism, perfusion, mobility, stress/coping, violence, health-wellness-illness, professional behaviors, caring interventions, managing care, healthcare systems and quality improvement; NCLEX-RN eligibility on completion. Sixteen weeks. The focused-client-care preceptorship: 240 clinical hours as fifteen 12-hour shifts 1:1 with a hospital RN the program assigns (two years' experience required; the student works the nurse's schedule over the placement window) plus 60 hours in the simulation lab; one faculty member oversees up to fifteen preceptorship students. The LPN-to-ADN cohort joins the second-year class." },
  "NUR 214": { title: "Nursing Transition Concepts", hours: [3, 3, 6], credits: 6, requisites: "Admission to the LPN-to-ADN Transition (current unencumbered NC or compact LPN license, GPA ≥ 2.0, ATI Comprehensive Predictor)", description: "The bridge: concepts within the three domains of the individual, healthcare and nursing as the LPN moves to the RN role — evidence-based practice, quality improvement, communication, safety, the interdisciplinary team, informatics, assessment, clinical decision-making and professional behaviors. Completion carries the block credit for NUR 111, 112, 113 and 114 as the NCCCS transition design has it. Hours as the workspace's transition curriculum carries them (3-3-6); the program's Fall 2026 schedule lists the transition course as NUR 221, and its code, hours, term and dates come with the Dec 4 sequence document. Clinical on hospital medical-surgical units." },
  "ACA 122": { title: "College Transfer Success", hours: [0, 2, 0], credits: 1, requisites: "", gened: true },
  "ENG 111": { title: "Writing and Inquiry", hours: [3, 0, 0], credits: 3, requisites: "", gened: true },
  "ENG 112": { title: "Writing/Research in the Disciplines", hours: [3, 0, 0], credits: 3, requisites: "ENG 111", gened: true },
  "BIO 168": { title: "Anatomy and Physiology I", hours: [3, 3, 0], credits: 4, requisites: "", gened: true },
  "BIO 169": { title: "Anatomy and Physiology II", hours: [3, 3, 0], credits: 4, requisites: "BIO 168", gened: true },
  "PSY 150": { title: "General Psychology", hours: [3, 0, 0], credits: 3, requisites: "", gened: true },
  "PSY 241": { title: "Developmental Psychology", hours: [3, 0, 0], credits: 3, requisites: "PSY 150", gened: true },
  "PHI 240": { title: "Introduction to Ethics", hours: [3, 0, 0], credits: 3, requisites: "", gened: true },
};

// ---- How each NUR course meets: weeks within the term, clinical shifts a week and their length, and the settings as
// shift counts — the program's hospital med-surg base with each rotate-out as one whole-group shift mid-course (the
// program rotates students out one day each, which the model cannot express; the volume is right, the timing
// concentrated) ------------------------------------------------------------------------------------------------
const SCHEDULE = {
  "NUR 111": { rotations: [["Med-Surg", 16]], shifts: 1, shiftHours: 6, day: "Wed" },
  "NUR 112": { weeks: [1, 8], rotations: [["Med-Surg", 8]], shifts: 1, shiftHours: 12 },
  "NUR 211": { weeks: [9, 16], rotations: [["Med-Surg", 8]], shifts: 1, shiftHours: 12 },
  "NUR 114": { weeks: [3, 10], rotations: [["Med-Surg", 8]], shifts: 1, shiftHours: 12 },
  "NUR 113": { weeks: [1, 8], rotations: [["Med-Surg", 3], ["Obstetrics", 1], ["Med-Surg", 1], ["Pediatrics", 1], ["Med-Surg", 2]], shifts: 1, shiftHours: 12 },
  "NUR 212": { weeks: [9, 16], rotations: [["Med-Surg", 3], ["Critical Care", 1], ["Med-Surg", 1], ["Emergency", 1], ["Med-Surg", 2]], shifts: 1, shiftHours: 12 },
  "NUR 213": { precepted: true },
  "NUR 214": { rotations: [["Med-Surg", 10]], shifts: 1, shiftHours: 9.6 },
};
const ROTATE_OUT = new Set(["Obstetrics", "Pediatrics", "Critical Care", "Emergency"]);

// ---- The pathways: [name, season, weeks, courses]; fall and spring 16 weeks, the summer the college's 10-week term ----
const ADN = {
  file: "southeastern-adn.json", name: "Associate Degree Nursing (A45110)", programType: "Traditional Full Time", maxCohort: 60, hyflex: false,
  seatsNote: "Class size 60 — the program's own figure (2026-10-28): physical resources (the testing lab, classroom seating) support about 60 traditional admissions, 60 to 70 is what it aspires to admit, and NUR 111 has 42 students in Fall 2026. The NC Board of Nursing's 140 is the ADN program's total enrollment at any one time across both years, not an admission number, so each fall's intake depends on second-year retention.",
  terms: [["Fall 1", "Fall", 16, ["NUR 111", "BIO 168", "ENG 111", "ACA 122"]], ["Spring 1", "Spring", 16, ["NUR 112", "NUR 211", "BIO 169", "PSY 150"]], ["Summer", "Summer", 10, ["NUR 114", "ENG 112"]], ["Fall 2", "Fall", 16, ["NUR 113", "NUR 212", "PSY 241"]], ["Spring 2", "Spring", 16, ["NUR 213", "PHI 240"]]],
};
const LPN = {
  file: "southeastern-lpn-adn.json", name: "LPN-to-ADN Transition (A45110, accelerated bridge)", programType: "Transition (LPN)", maxCohort: 20, hyflex: true,
  seatsNote: "Class size 20 — the program admitted 20 to the inaugural Summer 2026 cohort after planning 10 and doubling on the applicant pool (2026-10-28); the number moves with second-year retention and applications, within the Board's 140 students at one time. The Fall 2026 schedule lists the transition course as NUR 221; its code, term and dates come with the Dec 4 sequence document (the pack keeps NUR 214 as the workspace carries it, and places the second-year courses as the ADN's standard sequence did until then).",
  terms: [["Summer", "Summer", 10, ["NUR 214"]], ["Fall", "Fall", 16, ["NUR 211", "NUR 212", "PSY 241"]], ["Spring", "Spring", 16, ["NUR 213", "PHI 240"]]],
};

const GROUP = 10; // the program's clinical groups: one instructor to ten students, the NC Board of Nursing's ratio (Fall 2026: ten on Thursday, ten on Friday).
const LAB_SECTION = 30; // NUR 111's lab holds thirty comfortably; two instructors a section (1:15).
const PRECEPT_SHIFTS = 15, PRECEPT_HOURS = 12, SIM_HOURS = 60, FACULTY_PER_PRECEPTEE = 1 / 15;
function sessionsFor(code, seats, termWeeks, hyflex) {
  const cat = CATALOG[code]; const sch = SCHEDULE[code];
  const [first, last] = sch?.weeks ?? [1, termWeeks];
  const [c, l, k] = cat.hours;
  const out = []; const n = { CLASS: 0, LAB: 0, CLINICAL: 0 };
  const push = (kind, week, hours, room, extra = {}) => out.push({
    kind, number: ++n[kind], title: `${cat.title} — ${kind === "CLASS" ? "Class" : kind === "LAB" ? "Lab" : "Clinical"}, week ${week}`, deliveryMode: "In-person", location: room,
    lengthHours: hours, maxStudents: seats, facultyNeeded: 1, facultyContactPolicy: kind === "CLASS" ? 2.5 : 2, supportStaffNeeded: 0, supportContactPolicy: 1,
    week, dayOfWeek: null, startTime: null, endTime: null, sectionTimes: null, notes: null, preceptorsNeeded: 0, preceptorContactPolicy: null, rotationType: null, clinicalMode: null, ...extra,
  });
  if (cat.gened) {
    for (let w = first; w <= last; w++) { if (c) push("CLASS", w, c, "General classroom", { notes: GENED, maxStudents: 30 }); if (l) push("LAB", w, l, "General lab", { notes: GENED, maxStudents: 24 }); }
    return out;
  }
  for (let w = first; w <= last; w++) {
    if (c) push("CLASS", w, c, R("Nursing classroom"), { notes: NO_SECTION, deliveryMode: hyflex ? "HyFlex" : "In-person" });
    if (l && code === "NUR 111") {
      // The six-hour lab as the program runs it: Tuesday the whole cohort together in the classroom for the lab's instruction (every
      // lab instructor assigned under the Board's 1:15 — four at the 60 cap, though usually only the lead teaches), Thursday two
      // sections of thirty (morning and afternoon) in the skills lab with two instructors each.
      push("LAB", w, 3, R("Nursing classroom"), { dayOfWeek: "Tue", maxStudents: seats, facultyNeeded: Math.ceil(seats / 15), notes: "Tuesday: the whole cohort together in the classroom for the lab's instruction (how to change a dressing, the kinds of wounds) before Thursday's practice — a lab day held as a class. The Board's 1:15 puts four instructors on the roster at 60 students (the program: \"theoretically, yes\"; usually the lead instructor teaches while the others are assigned and available), so the count here is the assigned staff at the cap and overstates it by one at this fall's 42. Check-off days (medication, Foley) draw four to six people with no workload credit." });
      push("LAB", w, 3, R("Skills lab"), { dayOfWeek: "Thu", maxStudents: LAB_SECTION, facultyNeeded: 2, notes: "Thursday: two sections of up to thirty — the lab holds thirty comfortably — in the morning and the afternoon, two instructors a section (1:15); the only course the program sections, and only for the lab. Times from the Fall 2026 schedule (due Dec 4)." });
    } else if (l) push("LAB", w, l, R("Skills lab"), { notes: `${NO_SECTION} Labs are on campus (the skills lab and the simulation lab).` });
  }
  if (!k) return out;
  if (sch.precepted) {
    // The preceptorship as the program runs it: fifteen 12-hour shifts 1:1 with a hospital RN over the placement window (the second
    // half of the term — e.g. Mar 8 – May 1 in a spring — until the program's dates arrive), one faculty member per fifteen students;
    // the other 60 of the course's 240 clinical hours in the simulation lab, placed in the first half (an assumption).
    const simWeeks = Math.floor(termWeeks / 2), simLen = SIM_HOURS / simWeeks;
    for (let w = 1; w <= simWeeks; w++) push("CLINICAL", w, simLen, R("Simulation lab"), { maxStudents: GROUP, facultyNeeded: 1, facultyContactPolicy: 2.5, preceptorsNeeded: 0, clinicalMode: "Simulation", rotationType: null, notes: `Simulation on campus: ${SIM_HOURS} of the course's 240 clinical hours are simulation (the program, 2026-10-28), carried here over the first ${simWeeks} weeks in groups of ${GROUP} with an instructor — the weeks are an assumption until the clinical calendar arrives; no seat at a partner site.` });
    const windowWeeks = termWeeks - simWeeks;
    for (let i = 0; i < PRECEPT_SHIFTS; i++) {
      const w = simWeeks + 1 + Math.floor((i * windowWeeks) / PRECEPT_SHIFTS);
      push("CLINICAL", w, PRECEPT_HOURS, SITE, { maxStudents: 1, facultyNeeded: Math.round(FACULTY_PER_PRECEPTEE * 1000) / 1000, facultyContactPolicy: 2.5, preceptorsNeeded: 1, preceptorContactPolicy: 1, clinicalMode: "Preceptor-led", rotationType: "Med-Surg or Critical Care", notes: `${ROTATION_NOTE} The focused-client-care preceptorship: shift ${i + 1} of ${PRECEPT_SHIFTS} twelve-hour shifts (${PRECEPT_SHIFTS * PRECEPT_HOURS} hours) 1:1 with a hospital RN the program assigns (two years' experience required); the student works the nurse's schedule over the placement window, so the weeks here spread the shifts over the second half of the term until the program's dates arrive. One faculty member oversees up to fifteen preceptorship students (${FACULTY_PER_PRECEPTEE.toFixed(3)} a student).` });
    }
    return out;
  }
  // The clinical weeks as a sequence of shifts; each rotation block takes its stated number of shifts.
  const blocks = sch.rotations; const totalShifts = blocks.reduce((n, [, s]) => n + s, 0);
  const weeks = last - first + 1; const perWeek = sch.shifts;
  if (totalShifts !== weeks * perWeek) throw new Error(`${code}: ${totalShifts} rotation shifts for ${weeks} weeks × ${perWeek}`);
  let idx = 0;
  for (const [rotationType, count] of blocks) for (let s = 0; s < count; s++, idx++) {
    const w = first + Math.floor(idx / perWeek);
    const out1 = ROTATE_OUT.has(rotationType)
      ? `${ROTATION_NOTE} ${rotationType}: each student's one rotate-out day — carried as a whole-group shift this week because the model places groups, not individuals (the volume is the cohort's rotate-out days; the calendar spreads them over the course).`
      : `${ROTATION_NOTE} ${rotationType}: the group's hospital week.`;
    push("CLINICAL", w, sch.shiftHours, SITE, { maxStudents: GROUP, facultyNeeded: 1, facultyContactPolicy: 2.5, preceptorsNeeded: 0, clinicalMode: "Instructor-led", rotationType, dayOfWeek: sch.day ?? null, notes: `${out1} An instructor-led group of ${GROUP} (1:10, the Board's ratio and the program's practice)${sch.shiftHours === 12 ? "; one twelve-hour shift a week in an eight-week session" : ""}${sch.day ? `; the whole cohort is in clinical on ${sch.day === "Wed" ? "Wednesdays" : sch.day}` : ""}.` });
  }
  return out;
}

function pack(def) {
  let startWeek = 1;
  const terms = def.terms.map(([name, semester, weeks, codes], i) => {
    const t = { index: i + 1, name, semester, startWeek, endWeek: startWeek + weeks - 1, weeks, courses: codes.map((code) => {
      const cat = CATALOG[code]; const [c, l, k] = cat.hours;
      const course = { code, title: cat.title, weeklyClassHours: c, weeklyLabHours: l, weeklyClinicalHours: k, credits: cat.credits, requisites: cat.requisites, courseType: cat.gened ? "GENED" : "CORE", description: cat.description ? `${cat.description} ${UNCONFIRMED}` : GENED, sessions: sessionsFor(code, def.maxCohort, weeks, def.hyflex) };
      return carryCatalogHours(course, [c, l, k], weeks, (m) => console.warn(m));
    }) };
    startWeek += weeks;
    return t;
  });
  return { name: def.name, programType: def.programType, credential: "AAS", sourceWorkbook: SOURCE, institution: "Southeastern Community College", maxCohort: def.maxCohort, maxCohortNote: def.seatsNote,
    weeklyHoursNote: `${HOURS_RULE} Hours and credits are the NCCCS course standard's. The program runs every NUR course but 111 and 213 as an eight-week session (A-Term / B-Term in fall and spring; the eight-week summer session from Jun 1 inside the college's 10-week term, May 17 – Jul 27, 2027), so those courses' sessions sit in eight of the term's weeks at twice the catalog's weekly hours. Days and times beyond NUR 111's Tuesday lab, Thursday lab sections and Wednesday clinical come with the Fall 2026 schedule (due Dec 4).`,
    assumptions: ASSUMPTIONS, terms };
}

for (const def of [ADN, LPN]) {
  const p = pack(def);
  writeFileSync(`prisma/templates/${def.file}`, JSON.stringify(p, null, 2) + "\n");
  const sessions = p.terms.flatMap((t) => t.courses.flatMap((c) => c.sessions));
  console.log(def.file.padEnd(30), `${p.terms.length} terms · ${p.terms.reduce((n, t) => n + t.courses.length, 0)} courses · ${sessions.length} sessions · credits ${p.terms.flatMap((t) => t.courses).reduce((n, c) => n + c.credits, 0)}`);
}
