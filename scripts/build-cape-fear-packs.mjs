// Build Cape Fear Community College's Electrical Systems Technology template packs — the certificate (C35130), its
// Career & College Promise CTE pathway (C35130CP), the diploma (D35130), the AAS (A35130) and the college's
// non-credit Electrical Apprenticeship — into prisma/templates/cape-fear-*.json.
//
// What is the college's (compiled 2026-10-22 from what its site gave through search; cfcc.edu and catalog.cfcc.edu
// themselves were unreachable from the build environment): the credentials and their credit totals (the 2024–25
// Programs of Study list: AAS 71, diploma 40, certificate 15), the fall 2026 evening sections of ELC 112 and
// ELC 113 at the North Campus (June/July 2026 announcements), the apprenticeship's shape (Job Training: four levels
// over four years, Mike Holt curriculum, about 624 class hours in all, evenings from late August to spring).
// What is the state's: every course's title, class · lab hours and credits are the NCCCS Combined Course Library's.
// What is laid out here: each sequence puts the standard's courses into the college's terms to its published credit
// total; the catalog's program-of-study pages replace it when they can be read. The owner's figures (2026-10-22): a faculty contact-hour policy of 2.2222 and 16 students a section for every EST
// course. Nothing else is invented: no day sections or rooms were published, and none is set.
//
//   node scripts/build-cape-fear-packs.mjs
import { writeFileSync } from "node:fs";
import { carryCatalogHours, HOURS_RULE } from "./packhours.mjs";

const SOURCE = "Cape Fear CC: 2024–25 Programs of Study list (credentials, credit totals, CIP 46.0302), the June/July 2026 announcements of the North Campus evening sections (ELC 112 T/Th and ELC 113 M/W 5:30–8:10 PM), the Job Training Electrical Apprenticeship page, the 2026–27 term dates; course hours and credits from the NCCCS Combined Course Library; sequences laid out to the credit totals — compiled 2026-10-22";
// Faculty load: the owner's figures (2026-10-22) — a contact-hour policy of 2.2222 work hours a contact hour (a 40-hour week over an
// 18-contact-hour load) on every session, and 16 students per section for every EST course.
const FACULTY_POLICY = 2.2222;
const SEATS = 16;
const SEATS_NOTE = "16 students per section (the owner's figure, 2026-10-22).";
const ASSUMPTIONS = { facContactHours: 18, facWorkWeekHours: 40, facTermWeeks: 16, preContactHours: 40, preWorkWeekHours: 40, preTermWeeks: 16 };
const GENED = "General-enrollment course taught outside the program, offered every term; placed here as the standard's program of study has it.";
const UNCONFIRMED = "Sequence from the NCCCS standard laid out to the college's published credit total; not yet confirmed against the catalog's program of study (catalog.cfcc.edu was unreachable on 2026-10-22).";
const NO_SECTION = "No section for this course is on record (the Class Finder was unreachable); the hours are carried with no day, time or room until the college's sections are read.";

// ---- The standard: hours are class · lab · work a week on a 16-week basis, then credits --------------------------
const CATALOG = {
  "ELC 112": { title: "DC/AC Electricity", hours: [3, 6, 0], credits: 5, requisites: "", description: "Direct- and alternating-current theory: units, circuit laws, series and parallel circuits, magnetism, transformers, measurement with meters." },
  "ELC 113": { title: "Residential Wiring", hours: [2, 6, 0], credits: 4, requisites: "", description: "Residential wiring methods, materials and the NEC: services, branch circuits, boxes, devices and lighting, installed in the lab." },
  "ELC 118": { title: "National Electrical Code", hours: [1, 2, 0], credits: 2, requisites: "", description: "Reading and applying the National Electrical Code." },
  "ELC 117": { title: "Motors and Controls", hours: [2, 6, 0], credits: 4, requisites: "ELC 112", description: "Motor theory, single- and three-phase motors, starters, relays and control circuits, wired and tested in the lab." },
  "ELC 115": { title: "Industrial Wiring", hours: [2, 6, 0], credits: 4, requisites: "ELC 113", description: "Industrial wiring methods: raceways, conductors, services, feeders, panelboards, transformers and the NEC articles that govern them." },
  "ELC 131": { title: "Circuit Analysis I", hours: [3, 3, 0], credits: 4, requisites: "", description: "DC and AC circuit analysis: network theorems, capacitance, inductance, reactance, phasors and resonance, with measurement in the lab." },
  "ELC 128": { title: "Introduction to Programmable Logic Controllers", hours: [2, 3, 0], credits: 3, requisites: "ELC 117", description: "PLC hardware, ladder logic, timers, counters and simple control programs on the lab's trainers." },
  "ELC 138": { title: "DC/AC Machines", hours: [2, 3, 0], credits: 3, requisites: "ELC 112", description: "DC and AC machines: generators, motors, transformers — construction, operation, characteristics and testing." },
  "ELC 213": { title: "Instrumentation", hours: [3, 2, 0], credits: 4, requisites: "ELC 131", description: "Industrial instrumentation: sensors, transmitters, signal conditioning, process variables, calibration and control loops." },
  "ELC 133": { title: "Circuit Analysis II", hours: [3, 3, 0], credits: 4, requisites: "ELC 131", description: "AC circuit analysis continued: polyphase circuits, power, power factor, filters and transformers." },
  "ELC 218": { title: "Advanced Motor Controls", hours: [2, 3, 0], credits: 3, requisites: "ELC 117", description: "Advanced motor control: solid-state devices, variable-frequency drives, reduced-voltage starting and protective circuits." },
  "ELC 233": { title: "Energy Management", hours: [3, 0, 0], credits: 3, requisites: "", description: "Energy use in buildings and industry: auditing, lighting, motors, HVAC, rates and the economics of conservation measures." },
  "ELC 215": { title: "Electrical Maintenance", hours: [2, 3, 0], credits: 3, requisites: "ELC 117", description: "Preventive maintenance and troubleshooting of electrical equipment and systems." },
  "ELC 221": { title: "Advanced PLC", hours: [2, 3, 0], credits: 3, requisites: "ELC 128", description: "Advanced PLC programming: analog I/O, data handling, networking, HMI and troubleshooting." },
  "ELC 220": { title: "Photovoltaic Systems Technology", hours: [2, 3, 0], credits: 3, requisites: "ELC 112", description: "Photovoltaic system design, installation and the NEC: modules, inverters, batteries, grounding and interconnection — the college names alternative and sustainable energy among the program's topics." },
  "ELC 229": { title: "Applications Project", hours: [1, 6, 0], credits: 3, requisites: "Final semester", description: "A capstone project: planning, estimating, installing and documenting an electrical system." },
  "ACA 111": { title: "College Student Success", hours: [1, 0, 0], credits: 1, requisites: "", gened: true },
  "ENG 111": { title: "Writing and Inquiry", hours: [3, 0, 0], credits: 3, requisites: "", gened: true },
  "MAT 110": { title: "Mathematical Measurement and Literacy", hours: [2, 2, 0], credits: 3, requisites: "", gened: true },
  "COM 231": { title: "Public Speaking", hours: [3, 0, 0], credits: 3, requisites: "", gened: true },
  "Humanities/Fine Arts elective": { title: "Humanities / Fine Arts elective", hours: [3, 0, 0], credits: 3, requisites: "", gened: true, description: "Three credits from the humanities / fine arts list (ART 111, HUM 115, MUS 110, PHI 240 …)." },
  "Social/Behavioral Science elective": { title: "Social / Behavioral Science elective", hours: [3, 0, 0], credits: 3, requisites: "", gened: true, description: "Three credits from the social / behavioral science list (PSY 150, SOC 210, ECO 251 …)." },
  "Level I": { title: "Electrical Apprenticeship Level I", hours: [5.2, 0, 0], credits: 0, requisites: "Registered with ApprenticeshipNC through a sponsoring employer", description: "Year 1 (Mike Holt curriculum): safety, trade math and measurement, hand and power tools, blueprint reading, rigging, electrical theory. About 156 of the program's 624 classroom hours; full-time work for the sponsoring employer between classes." },
  "Level II": { title: "Electrical Apprenticeship Level II", hours: [5.2, 0, 0], credits: 0, requisites: "Level I", description: "Year 2: builds on Level I — wiring methods, the NEC, motors and controls. About 156 classroom hours." },
  "Level III": { title: "Electrical Apprenticeship Level III", hours: [5.2, 0, 0], credits: 0, requisites: "Level II", description: "Year 3: commercial and industrial systems, code calculations, motor controls. About 156 classroom hours." },
  "Level IV": { title: "Electrical Apprenticeship Level IV", hours: [5.2, 0, 0], credits: 0, requisites: "Level III", description: "Year 4: advanced code, estimating and review toward the journeyman examination. About 156 classroom hours; completion earns the ApprenticeshipNC journeyman card and certificate." },
};

// ---- The published sections: the fall 2026 evening sections at the North Campus ---------------------------------
// The college posted one block per night (5:30–8:10 PM); it is carried here as the class hour leading into the lab,
// and the hours rule stretches the blocks to the catalog's load. Rooms were not published.
const SCHEDULE = {
  "ELC 112": { room: "North Campus", cap: SEATS, class: [["Tue", "17:30", "18:30"], ["Thu", "17:30", "18:30"]], lab: [["Tue", "18:30", "20:10"], ["Thu", "18:30", "20:10"]], note: `Fall 2026 evening section: Tue/Thu 5:30–8:10 PM at the North Campus (4500 Blue Clay Rd, Castle Hayne), announced June 2026; also offered at the Burgaw and Surf City centers. Room not published. ${SEATS_NOTE}` },
  "ELC 113": { room: "North Campus", cap: SEATS, class: [["Mon", "17:30", "18:30"], ["Wed", "17:30", "18:30"]], lab: [["Mon", "18:30", "20:10"], ["Wed", "18:30", "20:10"]], note: `Fall 2026 evening section: Mon/Wed 5:30–8:10 PM at the North Campus, announced June 2026; also offered at the Burgaw and Surf City centers. Room not published. ${SEATS_NOTE}` },
};

const hm = (t) => { const [h, m] = t.split(":").map(Number); return h + m / 60; };
const len = (a, b) => Math.round((hm(b) - hm(a)) * 100) / 100;

/** The sessions of a course in a term of `weeks` weeks. `hs` = the Career & College Promise high-school cohort (hours
 *  with no day or time); `apprentice` = two evening classes a week, nights not published. */
function sessionsFor(code, weeks, opts = {}) {
  const cat = CATALOG[code]; const sch = opts.hs || opts.apprentice ? null : SCHEDULE[code];
  const out = []; const n = { CLASS: 0, LAB: 0 };
  const push = (kind, week, day, start, end, hours, room, seats, extra = {}) => out.push({
    kind, number: ++n[kind], title: `${cat.title} — ${kind === "CLASS" ? "Class" : "Lab"}, week ${week}`, deliveryMode: "In-person", location: room,
    lengthHours: hours, maxStudents: seats, facultyNeeded: 1, facultyContactPolicy: FACULTY_POLICY, supportStaffNeeded: 0, supportContactPolicy: 1,
    week, dayOfWeek: day, startTime: start, endTime: end, sectionTimes: null, notes: sch?.note ?? null, preceptorsNeeded: 0, preceptorContactPolicy: null, rotationType: null, clinicalMode: null, ...extra,
  });
  const [c, l] = cat.hours;
  if (opts.apprentice) {
    for (let w = 1; w <= weeks; w++) for (let k = 0; k < 2; k++) push("CLASS", w, null, null, null, 2.6, "North Campus", SEATS, { notes: `Two evening classes a week over a 30-week year (late August – April): 156 classroom hours a year, 624 over four years, taught from the Mike Holt curriculum. The nights and room are not published. ${SEATS_NOTE}` });
    return out;
  }
  if (sch && !opts.summer) {
    for (let w = 1; w <= weeks; w++) {
      for (const [d, s, e] of sch.class) push("CLASS", w, d, s, e, len(s, e), sch.room, sch.cap);
      for (const [d, s, e] of sch.lab) push("LAB", w, d, s, e, len(s, e), sch.room, sch.cap);
    }
    return out;
  }
  // A course with no section on record, a summer course, the high-school cohort or a general-education course:
  // the standard's hours as one class (and one lab) row a week with no day or time.
  const scale = opts.summer ? 16 / weeks : 1;
  const room = opts.hs ? "High school (CCP)" : cat.gened ? "General classroom" : "North Campus";
  const seats = cat.gened ? 30 : SEATS;
  const notes = opts.hs ? `Career & College Promise high-school cohort (C35130CP); where and when it meets is not published. ${SEATS_NOTE}` : opts.summer ? `Summer 10-week session: the standard's 16-week hours carried over ${weeks} weeks (${r2(c * scale)} class / ${r2(l * scale)} lab a week); no summer section is on record. ${SEATS_NOTE}` : cat.gened ? GENED : `${NO_SECTION} ${SEATS_NOTE}`;
  for (let w = 1; w <= weeks; w++) {
    if (c) push("CLASS", w, null, null, null, r2(c * scale), room, seats, { notes });
    if (l) push("LAB", w, null, null, null, r2(l * scale), room, seats, { notes, location: opts.hs ? room : cat.gened ? "General lab" : "North Campus" });
  }
  return out;
}
const r2 = (x) => Math.round(x * 100) / 100;

// ---- The awards ------------------------------------------------------------------------------------------------
// term = [name, season, weeks, courses]. Fall and spring are 16 weeks; the summer term is the college's 10-week session.
const F = 16, S = 16, U = 10;
const CERT_TERMS = [["Fall", "Fall", F, ["ELC 112", "ELC 113", "ELC 118"]], ["Spring", "Spring", S, ["ELC 117"]]];
const YEAR_ONE = [["Year 1 Fall", "Fall", F, ["ELC 112", "ELC 113", "ELC 118", "ACA 111", "ENG 111"]], ["Year 1 Spring", "Spring", S, ["ELC 117", "ELC 115", "ELC 131", "ELC 128", "MAT 110"]]];
const AWARDS = [
  { file: "cape-fear-est-cert.json", name: "Electrical Systems Technology Certificate (C35130)", programType: "Certificate", credential: "Certificate", maxCohort: SEATS, months: 3,
    terms: CERT_TERMS,
    note: `Two terms, 15 credits (the college's total): ELC 112, 113 and 118 in the fall — ELC 112 and 113 are the courses the college announced as the certificate's new evening sections — then ELC 117. ${UNCONFIRMED} Class size 16 (the owner's figure, 2026-10-22).` },
  { file: "cape-fear-est-cert-ctep.json", name: "Electrical Systems Technology CTE Pathway (C35130CP)", programType: "High school (CCP)", credential: "Certificate", maxCohort: SEATS, months: 3, hs: true,
    terms: CERT_TERMS,
    note: `The certificate's 15 credits for Career & College Promise high-school students (New Hanover and Pender county schools); the college publishes neither where it meets nor its size; class size 16 (the owner's figure, 2026-10-22). ${UNCONFIRMED}` },
  { file: "cape-fear-est-diploma.json", name: "Electrical Systems Technology Diploma (D35130)", programType: "Traditional Full Time", credential: "Diploma", maxCohort: SEATS, months: 3,
    terms: [...YEAR_ONE, ["Year 1 Summer", "Summer", U, ["ELC 138", "ELC 213"]]],
    note: `Three terms over twelve months, 40 credits (the college's total; an undated college list says 37): the first year of the AAS with ELC 138 and ELC 213 in the 10-week summer. ${UNCONFIRMED} Class size 16 (the owner's figure, 2026-10-22).` },
  { file: "cape-fear-est-aas.json", name: "Electrical Systems Technology AAS (A35130)", programType: "Traditional Full Time", credential: "AAS", maxCohort: SEATS, months: 3,
    terms: [...YEAR_ONE, ["Year 1 Summer", "Summer", U, ["ELC 138", "ELC 220"]], ["Year 2 Fall", "Fall", F, ["ELC 213", "ELC 133", "ELC 218", "ELC 233", "COM 231"]], ["Year 2 Spring", "Spring", S, ["ELC 221", "ELC 215", "ELC 229", "Humanities/Fine Arts elective", "Social/Behavioral Science elective"]]],
    note: `Five terms over two years, 71 credits (the college's 2024–25 total; an undated college list says 68): the state standard's electrical core — theory, wiring, the NEC, motors and controls, PLCs, circuit analysis, machines, instrumentation, energy management and photovoltaics (the college names energy management and alternative energy among its topics) — with ACA 111, ENG 111, MAT 110, COM 231 and two general-education electives. ${UNCONFIRMED} Class size 16 (the owner's figure, 2026-10-22).` },
];
const APPRENTICESHIP = {
  file: "cape-fear-electrical-apprenticeship.json", name: "Electrical Apprenticeship (ApprenticeshipNC, CFCC Job Training)", programType: "Registered apprenticeship", credential: "ApprenticeshipNC journeyman card and certificate", maxCohort: SEATS, months: 0, calendarMode: "continuous",
  terms: [["Year 1", null, 30, ["Level I"]], ["Year 2", null, 30, ["Level II"]], ["Year 3", null, 30, ["Level III"]], ["Year 4", null, 30, ["Level IV"]]],
  gap: 22, // weeks between one 30-week year and the next: late August to late August
  note: "The college's registered electrical apprenticeship (Job Training / Economic & Workforce Development, ApprenticeshipNC): four levels over four years from the Mike Holt curriculum, evening classes from late August to March/April, about 624 classroom hours in all (carried as 156 a year, two classes a week over 30 weeks), full-time work for a sponsoring employer between — a journeyman card and certificate at the end. The nights, room and start date are not published; class size 16 (the owner's figure, 2026-10-22).",
};

function pack(def) {
  let startWeek = 1;
  const terms = def.terms.map(([name, semester, weeks, codes], i) => {
    const t = { index: i + 1, name, semester, startWeek, endWeek: startWeek + weeks - 1, weeks, courses: codes.map((code) => {
      const cat = CATALOG[code]; const summer = semester === "Summer"; const [c, l, w] = cat.hours;
      const course = { code, title: cat.title, weeklyClassHours: c, weeklyLabHours: l, weeklyClinicalHours: 0, weeklyWorkHours: w, credits: cat.credits, requisites: cat.requisites, courseType: cat.gened ? "GENED" : "CORE", description: cat.description ?? (cat.gened ? GENED : null), sessions: sessionsFor(code, weeks, { summer, hs: def.hs, apprentice: !!def.gap }) };
      return carryCatalogHours(course, [c, l, 0], weeks, (m) => console.warn(m));
    }) };
    startWeek += weeks + (def.gap ?? 0);
    return t;
  });
  return { name: def.name, programType: def.programType, credential: def.credential, sourceWorkbook: SOURCE, institution: "Cape Fear Community College", maxCohort: def.maxCohort, ...(def.calendarMode ? { calendarMode: def.calendarMode } : {}), monthsToFullProductivity: def.months, note: def.note,
    weeklyHoursNote: `${HOURS_RULE} Hours and credits are the NCCCS course standard's; ELC 112 and ELC 113 sit on the college's announced evening sections, every other course carries its hours with no section on record; clinical hours are zero in every course.`,
    assumptions: ASSUMPTIONS, terms };
}

for (const def of [...AWARDS, APPRENTICESHIP]) {
  const p = pack(def);
  writeFileSync(`prisma/templates/${def.file}`, JSON.stringify(p, null, 2) + "\n");
  const courses = p.terms.flatMap((t) => t.courses);
  console.log(def.file.padEnd(44), `${p.terms.length} terms · ${courses.length} courses · ${courses.reduce((n, c) => n + c.sessions.length, 0)} sessions · credits ${courses.reduce((n, c) => n + c.credits, 0)}`);
}
