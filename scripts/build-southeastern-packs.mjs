// Build Southeastern Community College's two RN template packs — the Associate Degree Nursing program (A45110,
// fall entry) and the accelerated LPN-to-ADN Transition (summer entry, three semesters, HyFlex) — into
// prisma/templates/southeastern-adn.json and southeastern-lpn-adn.json.
//
// What is the college's (read 2026-10-28 from its site through search; sccnc.edu and its catalog were unreachable
// from the build environment): the two pathways and their entry terms, the admission cycles, the general-education
// courses it lists for the A45110 plan (ACA 122, ENG 111/112, BIO 168/169, PSY 150/241, PHI 240), NUR 117 as a
// pre-admission prerequisite, the three-semester HyFlex bridge, the R Building as the nursing building, the
// 2026–27 term lengths (16-week fall and spring, 10-week summer), and the NC Board of Nursing's 140-student cap.
// What is the state's: every course's title, class · lab · clinical hours and credits are the NCCCS Combined
// Course Library's, and the term placement is the A45110 concept-based sequence as the standard lays it out.
// What is derived: class sizes from the Board's cap (the owner's request). What is not on record and not set:
// section days, times and room numbers (no day or time on any session); the college's rotation plan (each
// clinical session carries the standard's usual setting, said in its note); its clinical affiliation list.
//
//   node scripts/build-southeastern-packs.mjs
import { writeFileSync } from "node:fs";
import { carryCatalogHours, HOURS_RULE } from "./packhours.mjs";

const SOURCE = "Southeastern CC: ADN and LPN-to-ADN admission pages, the Nursing program page, the campus facilities list, the 2026–27 academic calendar, the NC Board of Nursing 2024 approved-programs list (max enrollment 140) and 2021–2023 pass rates; course hours, credits and sequence from the NCCCS A45110 standard — compiled 2026-10-28";
// The college's FTE basis (New Employee Orientation guide, 2023): 16 contact hours a week × 16 weeks × 2 semesters = 512 a year.
const ASSUMPTIONS = { facContactHours: 16, facWorkWeekHours: 40, facTermWeeks: 16, preContactHours: 40, preWorkWeekHours: 40, preTermWeeks: 16 };
const R = (room) => `R Building – ${room}`;
const SITE = "Clinical site";
const UNCONFIRMED = "Hours and credits are the NCCCS standard's; the term placement is the standard's A45110 sequence — not yet confirmed against the college's catalog (unreachable 2026-10-28).";
const NO_SECTION = "The college publishes no section days, times or room numbers; the hours are carried with no day or time in the R Building (nursing and allied-health classrooms and labs).";
const ROTATION_NOTE = "Clinical setting: the NCCCS concept-based curriculum's usual placement for this course, not the college's own rotation plan — replace it on the Clinical tab when the plan is on record.";
const GENED = "General-enrollment course taught outside the nursing department, offered every term; placed here as the standard's program of study has it (the college lists it among the courses to finish before applying).";

// ---- The catalog (NCCCS course standard): hours are class · lab · clinical a week on a 16-week basis, then credits ----
const CATALOG = {
  "NUR 111": { title: "Introduction to Health Concepts", hours: [4, 6, 6], credits: 8, requisites: "Admission to the program; NUR 117 Pharmacology within five years", description: "Introduces the concepts within the three domains of the individual, healthcare and nursing: medication administration, assessment, nutrition, ethics, interdisciplinary teams, informatics, evidence-based practice, individual-centered care and quality improvement. Clinical: long-term care in the first eight weeks, adult medical-surgical in the second (the standard's usual placement)." },
  "NUR 112": { title: "Health-Illness Concepts", hours: [3, 0, 6], credits: 5, requisites: "NUR 111 · co-requisite NUR 114", description: "Acid-base, metabolism, cellular regulation, oxygenation, infection, stress/coping, health-wellness-illness, communication, caring interventions, managing care, safety, quality improvement and informatics. The first eight weeks of the spring, as the standard sequences it; clinical on adult medical-surgical units." },
  "NUR 114": { title: "Holistic Health Concepts", hours: [3, 0, 6], credits: 5, requisites: "NUR 111 · co-requisite NUR 112", description: "Cellular regulation, perfusion, inflammation, sensory perception, stress/coping, mood/affect, cognition, self, violence, health-wellness-illness, professional behaviors, caring interventions and safety. The second eight weeks of the spring; clinical in behavioral-health settings." },
  "NUR 113": { title: "Family Health Concepts", hours: [3, 0, 6], credits: 5, requisites: "NUR 111", description: "Oxygenation, sexuality, reproduction, grief/loss, mood/affect, behaviors, development, family, health-wellness-illness, communication, caring interventions, managing care, safety and advocacy. Clinical: maternal-newborn, then pediatric (inpatient or ambulatory)." },
  "NUR 211": { title: "Health Care Concepts", hours: [3, 0, 6], credits: 5, requisites: "NUR 111 · co-requisite NUR 212", description: "Cellular regulation, perfusion, infection, immunity, mobility, comfort, behaviors, health-wellness-illness, clinical decision-making, caring interventions, managing care and safety. The first eight weeks of the fall; clinical on adult medical-surgical units. The LPN-to-ADN cohort joins the second-year class." },
  "NUR 212": { title: "Health System Concepts", hours: [3, 0, 6], credits: 5, requisites: "NUR 111 · co-requisite NUR 211", description: "Grief/loss, violence, health-wellness-illness, collaboration, managing care, safety, advocacy, legal issues, policy, healthcare systems, ethics, accountability and evidence-based practice. The second eight weeks of the fall; clinical in critical care, then community health. The LPN-to-ADN cohort joins the second-year class." },
  "NUR 213": { title: "Complex Health Concepts", hours: [4, 3, 15], credits: 10, requisites: "NUR 111; NUR 112, 113, 114, 211 and 212 prior or concurrent", description: "Capstone: fluid/electrolytes, metabolism, perfusion, mobility, stress/coping, violence, health-wellness-illness, professional behaviors, caring interventions, managing care, healthcare systems and quality improvement; NCLEX-RN eligibility on completion. The 15-hour precepted practicum, 1:1 with an RN in an adult acute setting (medical-surgical or critical care). The LPN-to-ADN cohort joins the second-year class." },
  "NUR 214": { title: "Nursing Transition Concepts", hours: [3, 3, 6], credits: 6, requisites: "Admission to the LPN-to-ADN Transition (current unencumbered NC or compact LPN license, GPA ≥ 2.0, ATI Comprehensive Predictor)", description: "The bridge: concepts within the three domains of the individual, healthcare and nursing as the LPN moves to the RN role — evidence-based practice, quality improvement, communication, safety, the interdisciplinary team, informatics, assessment, clinical decision-making and professional behaviors. Completion carries the block credit for NUR 111, 112, 113 and 114 as the NCCCS transition design has it. Hours as the workspace's transition curriculum carries them (3-3-6); the college's own figure replaces them. Clinical on adult medical-surgical units." },
  "ACA 122": { title: "College Transfer Success", hours: [0, 2, 0], credits: 1, requisites: "", gened: true },
  "ENG 111": { title: "Writing and Inquiry", hours: [3, 0, 0], credits: 3, requisites: "", gened: true },
  "ENG 112": { title: "Writing/Research in the Disciplines", hours: [3, 0, 0], credits: 3, requisites: "ENG 111", gened: true },
  "BIO 168": { title: "Anatomy and Physiology I", hours: [3, 3, 0], credits: 4, requisites: "", gened: true },
  "BIO 169": { title: "Anatomy and Physiology II", hours: [3, 3, 0], credits: 4, requisites: "BIO 168", gened: true },
  "PSY 150": { title: "General Psychology", hours: [3, 0, 0], credits: 3, requisites: "", gened: true },
  "PSY 241": { title: "Developmental Psychology", hours: [3, 0, 0], credits: 3, requisites: "PSY 150", gened: true },
  "PHI 240": { title: "Introduction to Ethics", hours: [3, 0, 0], credits: 3, requisites: "", gened: true },
};

// ---- How each NUR course meets: weeks within the term, how many clinical shifts a week, and the standard's usual
// clinical settings in consecutive blocks over the course's clinical weeks ------------------------------------
const SCHEDULE = {
  "NUR 111": { rotations: ["Long-Term Care", "Med-Surg"], shifts: 1 },
  "NUR 112": { weeks: [1, 8], rotations: ["Med-Surg"], shifts: 2 },
  "NUR 114": { weeks: [9, 16], rotations: ["Behavioral Health"], shifts: 2 },
  "NUR 113": { rotations: ["Obstetrics", "Pediatrics"], shifts: 1 },
  "NUR 211": { weeks: [1, 8], rotations: ["Med-Surg"], shifts: 2 },
  "NUR 212": { weeks: [9, 16], rotations: ["Critical Care", "Community Health"], shifts: 2 },
  "NUR 213": { rotations: ["Med-Surg or Critical Care"], shifts: 1, precepted: true },
  "NUR 214": { rotations: ["Med-Surg"], shifts: 1 },
};

// ---- The pathways: [name, season, weeks, courses]; fall and spring 16 weeks, the summer the college's 10-week term ----
const ADN = {
  file: "southeastern-adn.json", name: "Associate Degree Nursing (A45110)", programType: "Traditional Full Time", maxCohort: 70, hyflex: false,
  seatsNote: "Class size 70, derived at the owner's request (2026-10-28) from the NC Board of Nursing's approved maximum enrollment of 140 for the ADN program (2024 list): the cap covers both levels, so a fall class of 70 leaves 70 second-year seats for the continuing students and the LPN-to-ADN cohort; the Board allows up to ten over. The college publishes no class size.",
  terms: [["Fall 1", "Fall", 16, ["NUR 111", "BIO 168", "ENG 111", "ACA 122"]], ["Spring 1", "Spring", 16, ["NUR 112", "NUR 114", "BIO 169", "PSY 150"]], ["Summer", "Summer", 10, ["NUR 113", "ENG 112"]], ["Fall 2", "Fall", 16, ["NUR 211", "NUR 212", "PSY 241"]], ["Spring 2", "Spring", 16, ["NUR 213", "PHI 240"]]],
};
const LPN = {
  file: "southeastern-lpn-adn.json", name: "LPN-to-ADN Transition (A45110, accelerated bridge)", programType: "Transition (LPN)", maxCohort: 20, hyflex: true,
  seatsNote: "Class size 20 within the Board's 140-student cap on the ADN program (the cohort joins the second-year courses) — derived at the owner's request (2026-10-28); the college publishes no class size and the inaugural Summer 2026 cohort's history is a single year.",
  terms: [["Summer", "Summer", 10, ["NUR 214"]], ["Fall", "Fall", 16, ["NUR 211", "NUR 212", "PSY 241"]], ["Spring", "Spring", 16, ["NUR 213", "PHI 240"]]],
};

const GROUP = 8; // NC BON allows ten students per clinical instructor; the workspace's nursing rule plans eight.
const hm = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
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
  const clinicalWeeks = last - first + 1;
  const blocks = sch.rotations.length;
  const rotationAt = (w) => sch.rotations[Math.min(blocks - 1, Math.floor(((w - first) * blocks) / clinicalWeeks))];
  for (let w = first; w <= last; w++) {
    if (c) push("CLASS", w, c, R("Nursing classroom"), { notes: NO_SECTION, deliveryMode: hyflex ? "HyFlex" : "In-person" });
    if (l) push("LAB", w, l, R("Skills lab"), { notes: `${NO_SECTION} Labs are on campus (the skills lab and the simulation lab).` });
    if (!k) continue;
    const rotationType = rotationAt(w);
    const note = `${ROTATION_NOTE} Block ${sch.rotations.indexOf(rotationType) + 1} of ${blocks}: ${rotationType}.`;
    if (sch.precepted) {
      // The 15-hour practicum as a 12-hour precepted shift every week and a second one every other week, as the workspace carries it.
      push("CLINICAL", w, 12, SITE, { maxStudents: 1, facultyNeeded: 0.1, facultyContactPolicy: 2.5, preceptorsNeeded: 1, preceptorContactPolicy: 1, clinicalMode: "Preceptor-led", rotationType, notes: `${note} Precepted 1:1 with an RN; 12-hour shifts.` });
      if (w % 2 === 1) push("CLINICAL", w, 12, SITE, { maxStudents: 1, facultyNeeded: 0.1, facultyContactPolicy: 2.5, preceptorsNeeded: 1, preceptorContactPolicy: 1, clinicalMode: "Preceptor-led", rotationType, notes: `${note} Precepted 1:1 with an RN; the second shift of an alternate week.` });
      continue;
    }
    for (let s = 0; s < sch.shifts; s++) push("CLINICAL", w, 6, SITE, { maxStudents: GROUP, facultyNeeded: 1, facultyContactPolicy: 2.5, preceptorsNeeded: 0, clinicalMode: "Instructor-led", rotationType, notes: `${note} An instructor-led group of ${GROUP}${sch.shifts > 1 ? "; two clinical days a week in an eight-week course" : ""}.` });
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
    weeklyHoursNote: `${HOURS_RULE} Hours and credits are the NCCCS course standard's; no section days, times or rooms are published, so every session carries its hours with no day or time; the summer term is the college's 10-week session (May 17 – Jul 27, 2027).`,
    assumptions: ASSUMPTIONS, terms };
}

for (const def of [ADN, LPN]) {
  const p = pack(def);
  writeFileSync(`prisma/templates/${def.file}`, JSON.stringify(p, null, 2) + "\n");
  const sessions = p.terms.flatMap((t) => t.courses.flatMap((c) => c.sessions));
  console.log(def.file.padEnd(30), `${p.terms.length} terms · ${p.terms.reduce((n, t) => n + t.courses.length, 0)} courses · ${sessions.length} sessions · credits ${p.terms.flatMap((t) => t.courses).reduce((n, c) => n + c.credits, 0)}`);
}
