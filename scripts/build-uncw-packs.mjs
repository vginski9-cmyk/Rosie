// Build UNC Wilmington's three prelicensure BSN template packs — the four-semester prelicensure BSN with its fall and
// spring entries and the Accelerated BSN (summer entry, four semesters) — into prisma/templates/uncw-*.json.
//
// What is the university's (read 2026-10-28 from uncw.edu through search; uncw.edu and its catalogue were unreachable
// from the build environment): the four-semester plan of study that began Fall 2023 — NSG 300, 302, 304, 306 (15
// semester hours, 135 clinical/lab hours) · NSG 311, 313, 314, 317, 319 (16, 180) · NSG 422, 424, a nursing elective,
// NSG 426 (15, 180) · NSG 430, 432, 434 and the elective NSG 454 (14, 180) — 60 nursing semester hours and 675
// clinical/lab hours in all; each course's lecture / lab / clinical credit split as the catalogue gives it ("3/2
// Clinical"); the ABSN's Summer → Fall → Spring → Summer sequence of the same courses; 120 students accepted a year
// into the prelicensure program across the fall and spring cycles; McNeill Hall (601 S College Rd) with its
// 10,000-square-foot Simulation Learning Center; CCNE accreditation and NC Board of Nursing approval; a three-year
// NCLEX-RN pass average of 91.55 % (2022–2024). What is derived: a lecture credit is 15 contact hours a semester and a
// lab or clinical credit 45 (the university's own totals: 3 lab/clinical credits in semester 1 = 135 hours, 4 in each
// later semester = 180), spread over the 15-week fall and spring semesters and the ABSN's 10-week summers. What is not
// published and not set: section days, times and room numbers (no day or time on any session); the school's clinical
// rotation calendar (each clinical course carries the usual settings for its content, said on every session); the
// ABSN class size (left blank — the first class graduated 11 in 2026 and the next more than doubled); the school's
// clinical affiliation list.
//
//   node scripts/build-uncw-packs.mjs
import { writeFileSync } from "node:fs";

const SOURCE = "UNC Wilmington School of Nursing: the prelicensure BSN and ABSN plans of study (four semesters from Fall 2023), course credit splits from the UNCW catalogue, the admission pages (120 a year, fall and spring cycles; ABSN once a year for summer), the 2026–27 registrar calendar, the NC Board of Nursing approved-programs list and the school's accreditation page — compiled 2026-10-28";
// Faculty load: UNCW's differentiated-workload guidance (Faculty Senate, April 2024) makes a 3-credit organized class 10 % of
// workload with teaching 50–80 % of a position; the workspace's 16 contact hours of 40 sits in that 15–24-hour range.
const ASSUMPTIONS = { facContactHours: 16, facWorkWeekHours: 40, facTermWeeks: 15, preContactHours: 40, preWorkWeekHours: 40, preTermWeeks: 15 };
const HALL = (room) => `McNeill Hall – ${room}`;
const SITE = "Clinical site";
const LEC = 15, CLIN = 45; // contact hours a semester per lecture credit and per lab / clinical credit
const BASIS = "Hours: a lecture credit is 15 contact hours a semester and a lab or clinical credit 45 — the university's own semester totals (135 clinical/lab hours in semester 1, 180 in each later one; 675 in all) read exactly so.";
const NO_SECTION = "The school publishes no section days, times or room numbers; the hours are carried with no day or time in McNeill Hall (the School of Nursing's classrooms and the Simulation Learning Center).";
const ROTATION_NOTE = "Clinical setting: the usual placement for this course's content, not the school's own rotation calendar — replace it on the Clinical tab when the calendar is on record; the shifts are spread evenly over the semester.";

// ---- The catalogue: [lecture credits, lab credits, clinical credits] and the total credits -----------------------
const CATALOG = {
  "NSG 300": { title: "Health Assessment and Core Nursing Concepts", split: [3, 1, 0], credits: 4, requisites: "Admission to the nursing major", description: "Health assessment across the lifespan and the core concepts of nursing practice; skills in the Simulation Learning Center." },
  "NSG 302": { title: "Foundational Nursing Care of Adults", split: [3, 0, 2], credits: 5, requisites: "Co-requisite NSG 300", description: "Foundational care of adults: the nursing process, fundamental skills, medication administration. Clinical in long-term care, then on adult medical-surgical units.", rotations: ["Long-Term Care", "Med-Surg"] },
  "NSG 304": { title: "Introduction to Professional Nursing", split: [3, 0, 0], credits: 3, requisites: "", description: "The profession: history, ethics, roles, communication and writing in the discipline (writing-intensive)." },
  "NSG 306": { title: "Pathopharmacology I", split: [3, 0, 0], credits: 3, requisites: "", description: "Pathophysiology and pharmacology across body systems, first course." },
  "NSG 311": { title: "Focused Care for Adults Across the Lifespan", split: [2, 1, 0], credits: 3, requisites: "NSG 300, 302", description: "Focused assessment and care of adults; lab in the Simulation Learning Center." },
  "NSG 313": { title: "Nursing Care of Women's Health Across the Lifespan", split: [2, 0, 1], credits: 3, requisites: "NSG 300, 302", description: "Women's health, pregnancy, birth and the newborn. Clinical on labor and delivery and mother-baby units.", rotations: ["Obstetrics"] },
  "NSG 314": { title: "Nursing Care of Children", split: [2, 0, 2], credits: 4, requisites: "NSG 300, 302", description: "Care of children and families. Clinical on pediatric units and in pediatric ambulatory settings.", rotations: ["Pediatrics"] },
  "NSG 317": { title: "Introduction to Evidence-based Practice and Research", split: [3, 0, 0], credits: 3, requisites: "", description: "Evidence-based practice and nursing research (writing-intensive)." },
  "NSG 319": { title: "Pathopharmacology II", split: [3, 0, 0], credits: 3, requisites: "NSG 306", description: "Pathophysiology and pharmacology across body systems, second course." },
  "NSG 422": { title: "Mental Health Nursing Across the Lifespan", split: [2, 0, 1], credits: 3, requisites: "NSG 311, 314, 319", description: "Mental health and psychiatric nursing across the lifespan. Clinical in inpatient and community behavioral-health settings.", rotations: ["Behavioral Health"] },
  "NSG 424": { title: "Nursing Leadership and Management", split: [3, 0, 0], credits: 3, requisites: "", description: "Leadership, management and the healthcare system." },
  "NSG elective": { title: "Nursing elective", split: [3, 0, 0], credits: 3, requisites: "", description: "Three credits from the school's nursing electives (NSG 454 Genomics and Ethical Considerations among them)." },
  "NSG 426": { title: "Acute and Complex Nursing Care of Adults", split: [3, 0, 3], credits: 6, requisites: "NSG 311, 313, 317, 319 (C or better)", description: "Acute and complex adult care. Clinical on medical-surgical and critical-care units.", rotations: ["Med-Surg", "Critical Care"] },
  "NSG 430": { title: "Population and Public Health Nursing", split: [2, 0, 1], credits: 3, requisites: "NSG 422, 426", description: "Population and public health. Clinical with public-health, home-health and community agencies.", rotations: ["Community Health"] },
  "NSG 432": { title: "Advocacy and Policy in Nursing", split: [3, 0, 0], credits: 3, requisites: "", description: "Health policy and advocacy." },
  "NSG 434": { title: "Professional Nursing Capstone", split: [2, 0, 3], credits: 5, requisites: "NSG 422, 426", description: "The capstone: a precepted practicum with an RN in an adult acute setting (medical-surgical or critical care), 1:1, directed by faculty; NCLEX-RN preparation.", rotations: ["Med-Surg or Critical Care"], precepted: true },
  "NSG 454": { title: "Genomics and Ethical Considerations", split: [3, 0, 0], credits: 3, requisites: "", description: "Genomics and the ethical questions of nursing practice; the plan of study's fourth-semester elective." },
};

// ---- The plan of study: [name, season, weeks, courses]; fall and spring 15 instructional weeks, the ABSN summers 10 -----
const SEMESTERS = [["NSG 300", "NSG 302", "NSG 304", "NSG 306"], ["NSG 311", "NSG 313", "NSG 314", "NSG 317", "NSG 319"], ["NSG 422", "NSG 424", "NSG elective", "NSG 426"], ["NSG 430", "NSG 432", "NSG 434", "NSG 454"]];
const term = (name, season, weeks, i) => [name, season, weeks, SEMESTERS[i]];
const PRELICENSURE_NOTE = "Class size 60: the school accepts 120 students a year into the prelicensure program across its fall and spring cycles (the admissions page also cites the top 70 of the Fall 2026 and Spring 2027 cohorts); the Board's approved maximum is on the NC BON list.";
const FALL = { file: "uncw-bsn-fall.json", name: "BSN Prelicensure — Fall Entry", programType: "Traditional Full Time", maxCohort: 60, seatsNote: PRELICENSURE_NOTE,
  terms: [term("Fall 1", "Fall", 15, 0), term("Spring 1", "Spring", 15, 1), term("Fall 2", "Fall", 15, 2), term("Spring 2", "Spring", 15, 3)] };
const SPRING = { file: "uncw-bsn-spring.json", name: "BSN Prelicensure — Spring Entry", programType: "Traditional Full Time", maxCohort: 60, seatsNote: PRELICENSURE_NOTE,
  terms: [term("Spring 1", "Spring", 15, 0), term("Fall 1", "Fall", 15, 1), term("Spring 2", "Spring", 15, 2), term("Fall 2", "Fall", 15, 3)] };
const ABSN = { file: "uncw-absn.json", name: "Accelerated BSN (second degree) — Summer Entry", programType: "Accelerated (second degree)", maxCohort: null, seatsNote: "Class size not published: the first ABSN class graduated 11 students in 2026 and the school says the next cohort more than doubled; admitted once a year for the summer (application Dec 1 – Jan 6). Not set until the school states it.",
  terms: [term("Summer 1", "Summer", 10, 0), term("Fall", "Fall", 15, 1), term("Spring", "Spring", 15, 2), term("Summer 2", "Summer", 10, 3)] };

const GROUP = 8; // NC BON allows ten students per clinical instructor; the workspace's nursing rule plans eight.
const r2 = (x) => Math.round(x * 100) / 100;
function sessionsFor(code, seats, weeks) {
  const cat = CATALOG[code]; const [lec, lab, clin] = cat.split;
  const classHours = lec * LEC, labHours = lab * CLIN, clinHours = clin * CLIN;
  const out = []; const n = { CLASS: 0, LAB: 0, CLINICAL: 0 };
  const push = (kind, week, hours, room, extra = {}) => out.push({
    kind, number: ++n[kind], title: `${cat.title} — ${kind === "CLASS" ? "Class" : kind === "LAB" ? "Lab" : "Clinical"}, week ${week}`, deliveryMode: "In-person", location: room,
    lengthHours: r2(hours), maxStudents: seats, facultyNeeded: 1, facultyContactPolicy: kind === "CLASS" ? 2.5 : 2, supportStaffNeeded: 0, supportContactPolicy: 1,
    week, dayOfWeek: null, startTime: null, endTime: null, sectionTimes: null, notes: null, preceptorsNeeded: 0, preceptorContactPolicy: null, rotationType: null, clinicalMode: null, ...extra,
  });
  for (let w = 1; w <= weeks; w++) {
    if (classHours) push("CLASS", w, classHours / weeks, HALL("Nursing classroom"), { notes: NO_SECTION });
    if (labHours) push("LAB", w, labHours / weeks, HALL("Simulation Learning Center"), { notes: `${NO_SECTION} Skills and simulation in the 10,000-square-foot Simulation Learning Center.` });
  }
  if (clinHours) {
    // Shifts of up to eight hours (the capstone's twelve), spread evenly over the semester's weeks; the rotation blocks are consecutive.
    // The shift count is the smallest at or above the hours ÷ the maximum whose shifts land on a quarter hour, so the shifts sum to the course's hours exactly.
    const shiftMax = cat.precepted ? 12 : 8;
    let shifts = Math.ceil(clinHours / shiftMax); while (((clinHours / shifts) * 4) % 1 !== 0) shifts++;
    const len = clinHours / shifts;
    const blocks = cat.rotations.length;
    for (let i = 0; i < shifts; i++) {
      const week = Math.min(weeks, Math.floor(((i + 0.5) * weeks) / shifts) + 1);
      const rotationType = cat.rotations[Math.min(blocks - 1, Math.floor((i * blocks) / shifts))];
      const note = `${ROTATION_NOTE} Block ${cat.rotations.indexOf(rotationType) + 1} of ${blocks}: ${rotationType}; ${shifts} shifts of ${r2(len)} h for the course's ${clinHours} clinical hours (${clin} clinical credit${clin === 1 ? "" : "s"} × 45).`;
      push("CLINICAL", week, len, SITE, cat.precepted
        ? { maxStudents: 1, facultyNeeded: 0.1, facultyContactPolicy: 2.5, preceptorsNeeded: 1, preceptorContactPolicy: 1, clinicalMode: "Preceptor-led", rotationType, notes: `${note} Precepted 1:1 with an RN, directed by faculty.` }
        : { maxStudents: GROUP, facultyNeeded: 1, facultyContactPolicy: 2.5, preceptorsNeeded: 0, clinicalMode: "Instructor-led", rotationType, notes: `${note} An instructor-led group of ${GROUP}.` });
    }
  }
  return out;
}

function pack(def) {
  let startWeek = 1;
  const terms = def.terms.map(([name, semester, weeks, codes], i) => {
    const t = { index: i + 1, name, semester, startWeek, endWeek: startWeek + weeks - 1, weeks, courses: codes.map((code) => {
      const cat = CATALOG[code]; const [lec, lab, clin] = cat.split;
      return { code, title: cat.title, weeklyClassHours: r2((lec * LEC) / weeks), weeklyLabHours: r2((lab * CLIN) / weeks), weeklyClinicalHours: r2((clin * CLIN) / weeks), credits: cat.credits, requisites: cat.requisites, courseType: "CORE", description: `${cat.description} ${BASIS}`, sessions: sessionsFor(code, def.maxCohort ?? 0, weeks) };
    }) };
    startWeek += weeks;
    return t;
  });
  return { name: def.name, programType: def.programType, credential: "BSN", sourceWorkbook: SOURCE, institution: "University of North Carolina Wilmington", maxCohort: def.maxCohort, maxCohortNote: def.seatsNote,
    weeklyHoursNote: `${BASIS} The weekly figures are the semester's hours over its instructional weeks (15 in fall and spring, 10 in the ABSN's summers); no section days, times or rooms are published, so every session carries its hours with no day or time.`,
    assumptions: ASSUMPTIONS, terms };
}

for (const def of [FALL, SPRING, ABSN]) {
  const p = pack(def);
  writeFileSync(`prisma/templates/${def.file}`, JSON.stringify(p, null, 2) + "\n");
  const courses = p.terms.flatMap((t) => t.courses);
  const sum = (k) => Math.round(courses.flatMap((c) => c.sessions).filter((s) => s.kind === k).reduce((n, s) => n + s.lengthHours, 0));
  console.log(def.file.padEnd(24), `${p.terms.length} terms · ${courses.length} courses · credits ${courses.reduce((n, c) => n + c.credits, 0)} · class ${sum("CLASS")} h · lab ${sum("LAB")} h · clinical ${sum("CLINICAL")} h`);
}
