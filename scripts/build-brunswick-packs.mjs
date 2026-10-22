// Build Brunswick Community College's three RN template packs from what the college publishes:
//
//   · the course sequence, weekly class / lab / clinical hours, credits and requisites of each
//     pathway — the ADN, LPN-to-ADN and Paramedic-to-ADN information sheets (2024–2026) and
//     program pages;
//   · the sections the college runs — its Self-Service course schedule for Fall 2026, Spring 2027
//     and Summer 2027 (copied 2026-10-12): every NUR section's meeting days, times, room, dates
//     and seats;
//   · the catalog's course descriptions.
//
//   node scripts/build-brunswick-packs.mjs
//     → prisma/templates/brunswick-adn.json, brunswick-lpn-adn.json, brunswick-paramedic-adn.json
//
// The packs are in the same shape as Sandhills' (rad.json): one program, its terms, each course
// with its weekly hours and its sessions row for row (kind, week, day, start and end time, room,
// seats, staffing, contact-hour policies). Where the college's schedule shows a window in which
// groups alternate (NUR 111's lab is T/Th 8–2:30 and its clinical T/Th 6:30–12:30 for a 51-seat
// section whose students owe 6 lab and 6 clinical hours a week), the session is placed on one of
// the window's days at the course standard's hours, and the note says what the window is. The
// off-campus clinical rows the schedule lists as "M/T/W/Th/F/Sa/Su TBD" carry no time and are not
// sessions. Every NUR course runs once a year in a fixed term and the college lists it as one
// meeting with a section per cohort (NUR 211: C01A 41 seats, C02A 7, C03A 13), so each pathway's
// pack carries the course under its own seats.
import { writeFileSync } from "node:fs";
import { carryCatalogHours, HOURS_RULE } from "./packhours.mjs";

const SOURCE = "Brunswick CC information sheets (ADN 2025–26, LPN-to-ADN 2024–25, Paramedic-to-ADN 2024–25), program pages and Self-Service course schedule (Fall 2026 – Summer 2027), 2026-10-12";
const ASSUMPTIONS = { facContactHours: 16, facWorkWeekHours: 40, facTermWeeks: 16, preContactHours: 40, preWorkWeekHours: 40, preTermWeeks: 16 };
const ROOM = (n) => `J - Health Sciences ${n}`;
const SITE = "Clinical site";
const SHARED = "Runs once a year in this term; the college lists one meeting with a section per cohort (ADN second year, LPN-to-ADN, Paramedic-to-ADN), carried under each program here.";
const GENED = "General-enrollment course taught outside the nursing department, offered every term; placed here as the program of study has it.";

// ---- The catalog: every course of the three pathways ----------------------------------------
const CATALOG = {
  "NUR 117": { title: "Pharmacology", hours: [1, 3, 0], credits: 2, requisites: "Admission to the ADN program (co-requisite of NUR 101 in the PN diploma)", description: "Introduces sources, effects, legalities and the safe use of medications as therapeutic agents: nursing responsibility, accountability, pharmacokinetics, routes of administration, contraindications and side effects. On completion students compute dosages and administer medication safely." },
  "NUR 111": { title: "Introduction to Health Concepts", hours: [4, 6, 6], credits: 8, requisites: "NUR 117", description: "Introduces the concepts within the three domains of the individual, healthcare and nursing: medication administration, assessment, nutrition, ethics, interdisciplinary teams, informatics, evidence-based practice, individual-centered care and quality improvement." },
  "NUR 112": { title: "Health-Illness Concepts", hours: [3, 0, 6], credits: 5, requisites: "NUR 111 · co-requisite NUR 114", description: "Acid-base, metabolism, cellular regulation, oxygenation, infection, stress/coping, health-wellness-illness, communication, caring interventions, managing care, safety, quality improvement and informatics. The college runs it in the first eight weeks of the spring." },
  "NUR 114": { title: "Holistic Health Concepts", hours: [3, 0, 6], credits: 5, requisites: "NUR 111 · co-requisite NUR 112", description: "Cellular regulation, perfusion, inflammation, sensory perception, stress/coping, mood/affect, cognition, self, violence, health-wellness-illness, professional behaviors, caring interventions and safety. The college runs it in the second eight weeks of the spring." },
  "NUR 113": { title: "Family Health Concepts", hours: [3, 0, 6], credits: 5, requisites: "NUR 111", description: `Oxygenation, sexuality, reproduction, grief/loss, mood/affect, behaviors, development, family, health-wellness-illness, communication, caring interventions, managing care, safety and advocacy. ${SHARED}` },
  "NUR 211": { title: "Health Care Concepts", hours: [3, 0, 6], credits: 5, requisites: "NUR 111 · co-requisite NUR 212", description: `Cellular regulation, perfusion, infection, immunity, mobility, comfort, behaviors, health-wellness-illness, clinical decision-making, caring interventions, managing care and safety. The college runs it in the first eight weeks of the fall. ${SHARED}` },
  "NUR 212": { title: "Health System Concepts", hours: [3, 0, 6], credits: 5, requisites: "NUR 111 · co-requisite NUR 211", description: `Grief/loss, violence, health-wellness-illness, collaboration, managing care, safety, advocacy, legal issues, policy, healthcare systems, ethics, accountability and evidence-based practice. The college runs it in the second eight weeks of the fall. ${SHARED}` },
  "NUR 213": { title: "Complex Health Concepts", hours: [4, 3, 15], credits: 10, requisites: "NUR 111; NUR 112, 113, 114, 211 and 212 prior or concurrent", description: `Capstone: fluid/electrolytes, metabolism, perfusion, mobility, stress/coping, violence, health-wellness-illness, professional behaviors, caring interventions, managing care, healthcare systems and quality improvement; NCLEX-RN eligibility on completion. ${SHARED}` },
  "NUR 215": { title: "Paramedic to RN Bridge Concepts", hours: [3, 3, 6], credits: 6, requisites: "Admission to the bridge (NC or National Registry Paramedic, TEAS ≥ 59, GPA ≥ 2.5)", description: "Introduces the three domains of the individual, healthcare and nursing as the paramedic transitions to the nursing role: evidence-based practice, quality improvement, communication, safety, the interdisciplinary team, clinical decision-making, professional behaviors, informatics, assessment, perfusion, oxygenation, elimination and cellular regulation. A B or better converts to credit for NUR 111, 112, 114 and 117 (20 credits)." },
  "BIO 168": { title: "Anatomy & Physiology I", hours: [3, 3, 0], credits: 4, requisites: "ENG 025", gened: true },
  "BIO 169": { title: "Anatomy & Physiology II", hours: [3, 3, 0], credits: 4, requisites: "BIO 168 (C)", gened: true },
  "BIO 275": { title: "Microbiology", hours: [3, 3, 0], credits: 4, requisites: "BIO 110, 111, 163 or 168 (C)", gened: true },
  "ENG 111": { title: "Writing & Inquiry", hours: [3, 0, 0], credits: 3, requisites: "ENG 025", gened: true },
  "ENG 112 or ENG 114": { title: "Writing/Research in the Disciplines or Professional Research & Reporting", hours: [3, 0, 0], credits: 3, requisites: "ENG 111", gened: true },
  "PSY 150": { title: "General Psychology", hours: [3, 0, 0], credits: 3, requisites: "ENG 025", gened: true },
  "PSY 241": { title: "Developmental Psychology", hours: [3, 0, 0], credits: 3, requisites: "PSY 150", gened: true },
  "HUM/Fine Arts elective": { title: "Humanities / Fine Arts elective", hours: [3, 0, 0], credits: 3, requisites: "", gened: true, description: "ART 111, ART 114, ART 115, HUM 115, MUS 110, MUS 112, PHI 215 or PHI 240." },
};

// ---- The schedule: how the college meets each NUR course ------------------------------------
// slot = [day, start, end, room]; weeks = [first, last] within the term; clinical.mode/group as the
// pathway's clinical rule gives it (instructor-led groups; NUR 213's practicum precepted 1:1).
const hm = (t) => { const [h, m] = t.split(":").map(Number); return h + m / 60; };
const len = (a, b) => Math.round((hm(b) - hm(a)) * 100) / 100;
const SCHEDULE = {
  "NUR 117": { class: [["Mon", "12:00", "12:50", ROOM(152)]], lab: [["Wed", "12:00", "14:50", ROOM(152)]], note: "Times and room from the college's Fall 2026 NUR 117 section (the PN co-requisite); the ADN's summer section is not yet published." },
  "NUR 111": { class: [["Mon", "09:00", "10:50", ROOM(106)], ["Wed", "09:00", "10:50", ROOM(106)]], lab: [["Tue", "08:00", "14:00", ROOM(155)]], clinical: [["Thu", "06:30", "12:30", SITE]],
    note: "Fall 2026 section NUR-111-C01, 51 seats: class M/W 9:00–10:50 in Health Sciences 106; the lab window is T/Th 8:00–2:30 in Health Sciences 155 and the clinical window T/Th 6:30–12:30 at clinical sites — groups alternate, each owing 6 lab and 6 clinical hours a week, placed here as one lab day and one clinical day. Off-campus clinical days listed as TBD." },
  "NUR 112": { weeks: [1, 8], class: [["Tue", "09:00", "11:50", ROOM(106)], ["Thu", "09:00", "11:50", ROOM(106)]], clinical: [["Mon", "06:30", "12:30", ROOM(175)], ["Wed", "06:30", "12:30", ROOM(175)]], note: "Spring 2027 section NUR-112-C01A, 50 seats, Jan 6 – Mar 3 (first 8 weeks): class T/Th 9:00–11:50 in Health Sciences 106; clinical M/W 6:30–12:30 in Health Sciences 175 (the campus clinical/simulation room) plus off-campus days listed as TBD." },
  "NUR 114": { weeks: [9, 16], class: [["Tue", "09:00", "11:50", ROOM(106)], ["Thu", "09:00", "11:50", ROOM(106)]], clinical: [["Mon", "06:30", "12:30", ROOM(175)], ["Wed", "06:30", "12:30", ROOM(175)]], note: "Spring 2027 section NUR-114-C01Z, 50 seats, Mar 4 – May 5 (second 8 weeks): class T/Th 9:00–11:50 in Health Sciences 106; clinical M/W 6:30–12:30 in Health Sciences 175 plus off-campus days listed as TBD." },
  "NUR 113": { class: [["Wed", "09:00", "11:50", ROOM(106)], ["Thu", "09:00", "11:50", ROOM(106)]], clinical: [["Tue", "06:30", "12:30", ROOM(175)], ["Fri", "06:30", "12:30", ROOM(175)]], note: "Summer 2027 sections NUR-113-C01/C02/C03 (20 / 10 / 40 seats), May 24 – Jul 20: class W/Th 9:00–11:50 in Health Sciences 106; clinical T/F 6:30–12:30 in Health Sciences 175 plus off-campus days listed as TBD." },
  "NUR 211": { weeks: [1, 8], class: [["Tue", "09:00", "11:50", ROOM(106)], ["Thu", "09:00", "11:50", ROOM(106)]], clinical: [["Mon", "06:30", "16:00", SITE], ["Wed", "06:30", "16:00", SITE]], note: "Fall 2026 sections NUR-211-C01A/C02A/C03A (41 / 7 / 13 seats), Aug 17 – Oct 12 (first 8 weeks): class T/Th 9:00–11:50 in Health Sciences 106; clinical M/W 6:30–4:00 at clinical sites plus days listed as TBD." },
  "NUR 212": { weeks: [9, 16], class: [["Tue", "09:00", "11:50", ROOM(106)], ["Thu", "09:00", "11:50", ROOM(106)]], clinical: [["Mon", "06:30", "16:00", SITE], ["Wed", "06:30", "16:00", SITE]], note: "Fall 2026 sections NUR-212-C01Z/C02Z/C03Z (41 / 7 / 13 seats), Oct 13 – Dec 15 (second 8 weeks): class T/Th 9:00–11:50 in Health Sciences 106; clinical M/W 6:30–4:00 at clinical sites plus days listed as TBD." },
  "NUR 213": { class: [["Wed", "08:00", "11:50", ROOM(106)]], lab: [["Tue", "09:00", "11:50", ROOM(145)]], clinical: [["Mon", "07:00", "19:00", SITE], ["Thu", "07:00", "19:00", SITE, "odd"]], precepted: true,
    note: "Spring 2027 sections NUR-213-C01/C02/C03 (40 / 10 / 20 seats), Jan 6 – May 5: class W 8:00–11:50 in Health Sciences 106; lab T 9:00–11:50 in Health Sciences 145 (C02/C03 in 169); clinical M–Su 7:00 AM – 7:00 PM at clinical sites — the practicum's 15 hours a week placed as a 12-hour shift every week and a second one every other week." },
  "NUR 215": { class: [["Mon", "09:00", "11:50", ROOM(106)]], lab: [["Mon", "13:00", "15:50", ROOM(145)]], clinical: [["Tue", "06:30", "12:30", ROOM(173)]], note: "Spring 2027 section NUR-215-C01, 10 seats, Jan 6 – May 5: class M 9:00–11:50 in Health Sciences 106; lab M 1:00–3:50 in Health Sciences 145; clinical T 6:30–12:30 in Health Sciences 173 plus off-campus days listed as TBD." },
};

// ---- The pathways ---------------------------------------------------------------------------
// Each term: [name, season, weeks, courses]. Summers follow the college's calendar (May 24 – Jul 20, 2027: nine weeks).
const ADN = {
  file: "brunswick-adn.json", name: "Associate Degree Nursing (A45110)", programType: "Traditional Full Time", maxCohort: 50,
  seatsNote: "Class size from the college's Fall 2026 – Spring 2027 ADN sections (NUR 111: 51 seats; NUR 112 and 114: 50).",
  terms: [["Summer 1", "Summer", 9, ["NUR 117"]], ["Fall 1", "Fall", 16, ["NUR 111", "BIO 168", "ENG 111"]], ["Spring 1", "Spring", 16, ["NUR 112", "NUR 114", "BIO 169", "PSY 150"]], ["Summer 2", "Summer", 9, ["NUR 113", "PSY 241"]], ["Fall 2", "Fall", 16, ["NUR 211", "NUR 212", "BIO 275", "HUM/Fine Arts elective"]], ["Spring 2", "Spring", 16, ["NUR 213", "ENG 112 or ENG 114"]]],
};
const LPN = {
  file: "brunswick-lpn-adn.json", name: "LPN-to-ADN Transition (A45110T)", programType: "Transition (LPN)", maxCohort: 20,
  seatsNote: "Class size from the college's LPN-to-ADN sections (NUR 213-C03 and NUR 113-C01: 20 seats; NUR 211/212-C03: 13 enrolled in Fall 2026).",
  terms: [["Summer", "Summer", 9, ["NUR 113", "ENG 112 or ENG 114"]], ["Fall", "Fall", 16, ["NUR 211", "NUR 212", "BIO 275"]], ["Spring", "Spring", 16, ["NUR 213", "HUM/Fine Arts elective"]]],
};
const PARAMEDIC = {
  file: "brunswick-paramedic-adn.json", name: "Paramedic-to-ADN Bridge (A45110M)", programType: "Bridge (Paramedic)", maxCohort: 10,
  seatsNote: "Class size from the college's Paramedic-to-ADN sections (NUR 215-C01, NUR 213-C02 and NUR 113-C02: 10 seats; NUR 211/212-C02: 7 enrolled in Fall 2026).",
  terms: [["Spring 1", "Spring", 16, ["NUR 215", "BIO 275"]], ["Summer 1", "Summer", 9, ["NUR 113", "ENG 112 or ENG 114"]], ["Fall 1", "Fall", 16, ["NUR 211", "NUR 212", "PSY 241"]], ["Spring 2", "Spring", 16, ["NUR 213", "HUM/Fine Arts elective"]]],
};

const GROUP = 8; // NC BON allows ten students per clinical instructor; the workspace's nursing rule plans eight.
function sessionsFor(code, seats, termWeeks) {
  const cat = CATALOG[code]; const sch = SCHEDULE[code];
  const [first, last] = sch?.weeks ?? [1, termWeeks];
  const out = []; let n = { CLASS: 0, LAB: 0, CLINICAL: 0 };
  const push = (kind, week, day, start, end, room, extra = {}) => out.push({
    kind, number: ++n[kind], title: `${cat.title} — ${kind === "CLASS" ? "Class" : kind === "LAB" ? "Lab" : "Clinical"}, week ${week}`, deliveryMode: "In-person", location: room,
    lengthHours: len(start, end), maxStudents: seats, facultyNeeded: 1, facultyContactPolicy: kind === "CLASS" ? 2.5 : 2, supportStaffNeeded: 0, supportContactPolicy: 1,
    week, dayOfWeek: day, startTime: start, endTime: end, sectionTimes: null, notes: sch?.note ?? null, preceptorsNeeded: 0, preceptorContactPolicy: null, rotationType: null, clinicalMode: null, ...extra,
  });
  if (!sch) {
    // A general-enrollment course: its weekly hours as plain class (and lab) meetings, no room or day stated.
    const [c, l] = cat.hours;
    for (let w = first; w <= last; w++) { if (c) push("CLASS", w, null, "00:00", `${String(c).padStart(2, "0")}:00`, "General classroom", { startTime: null, endTime: null, notes: GENED, maxStudents: 30 }); if (l) push("LAB", w, null, "00:00", `${String(l).padStart(2, "0")}:00`, "General lab", { startTime: null, endTime: null, notes: GENED, maxStudents: 24 }); }
    return out;
  }
  for (let w = first; w <= last; w++) {
    for (const [d, s, e, room] of sch.class ?? []) push("CLASS", w, d, s, e, room);
    for (const [d, s, e, room] of sch.lab ?? []) push("LAB", w, d, s, e, room);
    for (const [d, s, e, room, every] of sch.clinical ?? []) {
      if (every === "odd" && w % 2 === 0) continue;
      const onCampus = room !== SITE;
      push("CLINICAL", w, d, s, e, room, sch.precepted
        ? { maxStudents: 1, facultyNeeded: 0.1, facultyContactPolicy: 2.5, preceptorsNeeded: 1, preceptorContactPolicy: 1, clinicalMode: "Preceptor-led", rotationType: null }
        : { maxStudents: GROUP, facultyNeeded: 1, facultyContactPolicy: 2.5, preceptorsNeeded: 0, clinicalMode: onCampus ? "Instructor-led (campus clinical/simulation room)" : "Instructor-led", rotationType: null });
    }
  }
  return out;
}

function pack(def) {
  let startWeek = 1;
  const terms = def.terms.map(([name, semester, weeks, codes], i) => {
    const t = { index: i + 1, name, semester, startWeek, endWeek: startWeek + weeks - 1, weeks, courses: codes.map((code) => {
      const cat = CATALOG[code]; const [c, l, k] = cat.hours;
      const course = { code, title: cat.title, weeklyClassHours: c, weeklyLabHours: l, weeklyClinicalHours: k, credits: cat.credits, requisites: cat.requisites, courseType: cat.gened ? "GENED" : "CORE", description: cat.description ?? (cat.gened ? GENED : null), sessions: sessionsFor(code, def.maxCohort, weeks) };
      return carryCatalogHours(course, [c, l, k], weeks, (m) => console.warn(m));
    }) };
    startWeek += weeks;
    return t;
  });
  return { name: def.name, programType: def.programType, credential: "AAS", sourceWorkbook: SOURCE, institution: "Brunswick Community College", maxCohort: def.maxCohort, maxCohortNote: def.seatsNote,
    weeklyHoursNote: `${HOURS_RULE} Hours and credits are the information sheets' (the NCCCS course standard); sessions are the college's published sections; a summer term is nine weeks (May 24 – Jul 20, 2027).`,
    assumptions: ASSUMPTIONS, terms };
}

for (const def of [ADN, LPN, PARAMEDIC]) {
  const p = pack(def);
  writeFileSync(`prisma/templates/${def.file}`, JSON.stringify(p, null, 2) + "\n");
  const sessions = p.terms.flatMap((t) => t.courses.flatMap((c) => c.sessions));
  console.log(def.file, `${p.terms.length} terms · ${p.terms.reduce((n, t) => n + t.courses.length, 0)} courses · ${sessions.length} sessions · credits ${p.terms.flatMap((t) => t.courses).reduce((n, c) => n + c.credits, 0)}`);
}
