// Build Rowan-Cabarrus Community College's Electrical Systems Technology template packs — the eight
// credentials the college lists under program 35130 (CIP 46.0302) in its 2026–27 catalog, and the
// NCAEC electrician apprenticeship its Continuing Education division hosts — from what the college
// publishes (the owner's compilation of 2026-10-20):
//
//   · the catalog: each award's course sequence by term, each course's class · lab · work contact
//     hours a week (16-week basis) and credits, prerequisites and co-requisites;
//   · the Self-Service course schedule for Fall 2026 – Summer 2027: every ELC section's days, times,
//     room (CBTC = Cabarrus Business & Technology Center), dates and seat cap — the day sections are
//     the pattern here, the evening sections noted on the course;
//   · the NCAEC apprenticeship handbook: four yearly levels, one 3-hour class a week for 28 weeks,
//     84 classroom hours a year, full-time work for the sponsoring contractor between.
//
//   node scripts/build-rccc-packs.mjs → prisma/templates/rccc-*.json
//
// Same shape as Sandhills' and Brunswick's packs: a program, its terms, each course with its weekly
// hours and its sessions row for row. Every seated ELC section meets in one block a day — the class
// hour first, the lab block right after, in the same room. Online 14-week sections start in week 3
// of the 16-week term and carry no day or room. Summer terms are the college's 8-week summer, so a
// summer course's weekly hours are its 16-week hours doubled (the term total is the same). Courses
// the college has not scheduled (general-education electives, the apprenticeship's classes) carry
// their hours with no day or room. The college's own program-structure workbook replaces these
// sessions when it arrives.
import { writeFileSync } from "node:fs";

const SOURCE = "RCCC catalog 2026–27 (program 35130 and course pages), Self-Service course schedule Fall 2026 – Summer 2027, 2026–27 academic calendar, NCAEC apprenticeship handbook — compiled 2026-10-20";
const ASSUMPTIONS = { facContactHours: 16, facWorkWeekHours: 40, facTermWeeks: 16, preContactHours: 40, preWorkWeekHours: 40, preTermWeeks: 16 };
const GENED = "General-enrollment course taught outside the program, offered every term; placed here as the program of study has it.";
const TEMPLATE = "The college's own program-structure workbook replaces these sessions when it arrives.";

// ---- The catalog: hours are class · lab · work a week on a 16-week basis, then credits -----------
const CATALOG = {
  "ELC 112": { title: "DC/AC Electricity", hours: [3, 6, 0], credits: 5, requisites: "Co-requisite ELC 126", description: "Direct- and alternating-current theory: units, circuit laws, series and parallel circuits, magnetism, transformers, measurement with meters. Co-requisite with ELC 126 in the first fall." },
  "ELC 126": { title: "Electrical Computations", hours: [2, 2, 0], credits: 3, requisites: "Co-requisite ELC 112", description: "The mathematics of electrical work: units, formulas, Ohm's and Kirchhoff's laws applied to circuit and code calculations." },
  "ELC 113": { title: "Residential Wiring", hours: [2, 6, 0], credits: 4, requisites: "Co-requisite ELC 118", description: "Residential wiring methods, materials and the NEC: services, branch circuits, boxes, devices and lighting, installed in the lab." },
  "ELC 118": { title: "National Electrical Code", hours: [1, 2, 0], credits: 2, requisites: "Co-requisite ELC 113", description: "Reading and applying the National Electrical Code." },
  "ELC 117": { title: "Motors and Controls", hours: [2, 6, 0], credits: 4, requisites: "Co-requisite ELC 125", description: "Motor theory, starters, relays, pilot devices and control circuits, wired and troubleshot in the lab." },
  "ELC 125": { title: "Diagrams and Schematics", hours: [1, 2, 0], credits: 2, requisites: "Co-requisite ELC 117", description: "Reading and drawing electrical diagrams, schematics and ladder logic." },
  "ELC 115": { title: "Industrial Wiring", hours: [2, 6, 0], credits: 4, requisites: "ELC 113", description: "Industrial wiring methods: raceways, conductors, three-phase services, motor circuits and the NEC articles that govern them." },
  "ELC 119": { title: "NEC Calculations", hours: [1, 2, 0], credits: 2, requisites: "ELC 118", description: "Load, conductor, service and voltage-drop calculations from the NEC." },
  "ELC 128": { title: "Introduction to Programmable Logic Controller", hours: [2, 3, 0], credits: 3, requisites: "ELC 117", description: "PLC hardware, ladder programming, inputs and outputs, timers and counters, on the lab's trainers." },
  "ELC 215": { title: "Electrical Maintenance", hours: [2, 3, 0], credits: 3, requisites: "ELC 117", description: "Preventive maintenance and troubleshooting of electrical equipment and distribution systems." },
  "EGR 125": { title: "Applied Software for Technicians", hours: [1, 2, 0], credits: 2, requisites: "", description: "Spreadsheets, word processing and technical software for the technician." },
  "CST 131": { title: "OSHA / Safety / Certification", hours: [2, 2, 0], credits: 3, requisites: "", description: "Construction safety and the OSHA 10-hour certification." },
  "BPR 130": { title: "Print Reading — Construction", hours: [3, 0, 0], credits: 3, requisites: "", description: "Reading construction drawings: plans, elevations, sections, schedules and electrical plans." },
  "AHR 120": { title: "HVACR Maintenance", hours: [1, 3, 0], credits: 2, requisites: "", description: "Maintenance of heating, ventilation, air-conditioning and refrigeration equipment." },
  "WBL 110": { title: "World of Work", hours: [1, 0, 0], credits: 1, requisites: "", description: "The program of study lists WBL 110 World of Work (1-0-0) or WBL 111 Work-Based Learning I (0-0-10 work hours with an employer); the college schedules WBL 110 online, so it is carried here." },
  "ENG 111": { title: "Writing and Inquiry", hours: [3, 0, 0], credits: 3, requisites: "", gened: true },
  "COM 231": { title: "Public Speaking", hours: [3, 0, 0], credits: 3, requisites: "", gened: true },
  "MAT 121 or MAT 143 or PHY 110": { title: "Algebra/Trigonometry I, Quantitative Literacy or Conceptual Physics", hours: [2, 2, 0], credits: 3, requisites: "", gened: true, description: "Choose one: MAT 121 or MAT 143 (2-2-0-3) or PHY 110 (3-0-0-3); carried here at the mathematics courses' hours." },
  "Major elective": { title: "Major elective (3 credits)", hours: [3, 0, 0], credits: 3, requisites: "", gened: false, description: "Three credits from the program's major-electives list (AHR, BPR, DFT, ELC/ELN, ISC, PLU, WLD …); the course chosen sets the real hours and room." },
  "Communication elective": { title: "Communication elective", hours: [3, 0, 0], credits: 3, requisites: "", gened: true, description: "COM 110, COM 120, COM 231, ENG 112 or ENG 114." },
  "Humanities/Fine Arts elective": { title: "Humanities / Fine Arts elective", hours: [3, 0, 0], credits: 3, requisites: "", gened: true, description: "ART 111, HUM 115, MUS 110, PHI 240 or another course on the UGETC list." },
  "Social/Behavioral Science elective": { title: "Social / Behavioral Science elective", hours: [3, 0, 0], credits: 3, requisites: "", gened: true, description: "ECO 151, HIS 131, POL 120, PSY 150, SOC 210 or another course on the list." },
  "Gen-ed elective": { title: "General-education elective", hours: [3, 0, 0], credits: 3, requisites: "", gened: true, description: "Three credits from the college's general-education list (humanities, social science, communication, MAT 121/143 or PHY 110)." },
  "ELC-3014B": { title: "NCAEC Electrical I", hours: [3, 0, 0], credits: 0, requisites: "Registered with a sponsoring NCAEC contractor", description: "Year 1 of the NC Association of Electrical Contractors apprenticeship: OSHA construction safety, electrical theory and the basics of electrical systems, the digital multimeter, introduction to the NEC. 84 classroom hours (plus the 10-hour OSHA 10 online) in one 3-hour class a week for 28 weeks; 50 documented on-the-job competency hours and full-time work for the sponsoring contractor (about 2,000 hours a year)." },
  "ELC-3014C": { title: "NCAEC Electrical II", hours: [3, 0, 0], credits: 0, requisites: "ELC-3014B", description: "Year 2: more OSHA, NEC chapters 1–3, AC equipment, residential and commercial wiring methods. 84 classroom hours; 60 documented on-the-job competency hours and full-time work for the sponsoring contractor." },
  "ELC-3014D": { title: "NCAEC Electrical III", hours: [3, 0, 0], credits: 0, requisites: "ELC-3014C", description: "Year 3: more OSHA, NEC chapter 4, industrial applications, motors and motor controls, hazardous locations, solar PV and energy storage. 84 classroom hours; 60 on-the-job competency hours and full-time work." },
  "ELC-3014E": { title: "NCAEC Electrical IV", hours: [3, 0, 0], credits: 0, requisites: "ELC-3014D", description: "Year 4: more OSHA, advanced code calculations, electrical estimating, review of theory and motor controls. 84 classroom hours; 60 on-the-job competency hours and full-time work. Completion: the US DOL / NCCCS journeyworker certificate after 336 classroom hours and 8,000 hours on the job." },
};

// ---- The schedule: each course's day section (class block, then lab block, same room) -----------
// slot = [days, start, end]; cap = the section's seats. `online` = asynchronous 14-week section (weeks 3–16).
const SCHEDULE = {
  "ELC 112": { room: "CBTC 259", cap: 16, class: [["Mon", "08:00", "09:00"], ["Wed", "08:00", "09:00"]], lab: [["Mon", "09:00", "11:50"], ["Wed", "09:00", "11:50"]], note: "Fall 2026 section 100B: M/W 8–9 AM class then 9–11:50 AM lab, CBTC 259, 16 seats. Also 102B (M/W 1–2 PM / 2–4:50 PM) and the evening 101B (M/W 6–7:20 PM / 7:20–9:50 PM), both CBTC 259, 16 seats." },
  "ELC 126": { room: "CBTC 218", cap: 16, class: [["Tue", "13:00", "14:55"]], lab: [["Tue", "14:55", "16:50"]], note: "Fall 2026 section 100B: T 1–2:55 PM class then 2:55–4:50 PM lab, CBTC 218, 16 seats. Also online asynchronous 14-week sections 800N (Fall, Aug 31 – Dec 18) and 801N (Spring, Jan 22 – May 11), 30 seats." },
  "ELC 113": { room: "CBTC 253", cap: 16, class: [["Tue", "08:00", "09:00"], ["Thu", "08:00", "09:00"]], lab: [["Tue", "09:00", "11:50"], ["Thu", "09:00", "11:50"]], note: "Fall 2026 section 100B: T/Th 8–9 AM class then 9–11:50 AM lab, CBTC 253, 16 seats. Evening 101B: T/Th 6–7 PM / 7–9:50 PM, CBTC 259, 16 seats." },
  "ELC 118": { room: "CBTC 206", cap: 20, class: [["Wed", "13:00", "14:00"]], lab: [["Wed", "14:00", "15:50"]], note: "Fall 2026 section 100B: W 1–2 PM class then 2–3:50 PM lab, CBTC 206, 20 seats. Evening 101B: M 6–7 PM / 7–8:50 PM, CBTC 206, 20 seats." },
  "ELC 117": { room: "CBTC 253", cap: 16, class: [["Mon", "08:00", "09:00"], ["Wed", "08:00", "09:00"]], lab: [["Mon", "09:00", "11:50"], ["Wed", "09:00", "11:50"]], note: "Fall 2026 section 100B: M/W 8–9 AM class then 9–11:50 AM lab, CBTC 253, 16 seats. Spring 2027 evening 101B: M/W 6–7 PM / 7–9:50 PM, CBTC 253, 16 seats." },
  "ELC 125": { room: "CBTC 231", cap: 16, class: [["Mon", "13:00", "14:00"]], lab: [["Mon", "14:00", "15:50"]], note: "Spring 2027 section 100B: M 1–2 PM class then 2–3:50 PM lab, CBTC 231, 16 seats. Hybrid 01H (Fall, T 1–2 PM / 2–3:50 PM, CBTC 259) and 02H (Spring, T 6–7 PM / 7–8:50 PM, CBTC 253, 17 seats)." },
  "ELC 115": { room: "CBTC 253", cap: 16, class: [["Mon", "13:00", "14:00"], ["Wed", "13:00", "14:00"]], lab: [["Mon", "14:00", "16:50"], ["Wed", "14:00", "16:50"]], note: "Fall 2026 section 100B: M/W 1–2 PM class then 2–4:50 PM lab, CBTC 253, 16 seats. Spring 2027 evening 101B: T/Th 6–7 PM / 7–9:50 PM, CBTC 259, 16 seats. The AAS lists it in Year 2 Spring; the college runs it both terms." },
  "ELC 119": { room: "CBTC 101", cap: 16, class: [["Mon", "13:00", "14:00"]], lab: [["Mon", "14:00", "15:50"]], note: "Fall 2026 section 100B: M 1–2 PM class then 2–3:50 PM lab, CBTC 101, 16 seats. Spring 2027 evening 101B: M 6–7 PM / 7–8:50 PM, CBTC 232, 20 seats." },
  "ELC 128": { room: "CBTC 253", cap: 12, class: [["Tue", "13:00", "14:00"]], lab: [["Tue", "14:00", "16:50"]], note: "Fall 2026 section 100B: T 1–2 PM class then 2–4:50 PM lab, CBTC 253, 12 seats (the PLC trainers). Evening 101B: Th 6–7 PM / 7–9:50 PM, CBTC 253, 12 seats." },
  "ELC 215": { room: "CBTC 253", cap: 18, class: [["Wed", "18:00", "19:00"]], lab: [["Wed", "19:00", "21:50"]], note: "Fall 2026 section 100B (the only section, evening): W 6–7 PM class then 7–9:50 PM lab, CBTC 253, 18 seats. The AAS lists it in Year 2 Spring; the college runs it in the fall." },
  "AHR 120": { room: "CBTC 252C", cap: 16, class: [["Tue", "08:00", "09:00"]], lab: [["Tue", "09:00", "11:50"]], note: "Fall 2026 section 100B: T 8–9 AM class then 9–11:50 AM lab, CBTC 252C, 16 seats. Evening 101B: Th 6–7 PM / 7–9:50 PM, CBTC 103, 16 seats. The AAS lists it in Year 2 Spring; the college runs it in the fall." },
  "BPR 130": { room: "CBTC 232", cap: 28, class: [["Mon", "11:30", "13:00"], ["Wed", "11:30", "13:00"]], lab: [], note: "Fall 2026 section 100B: M/W 11:30 AM – 1 PM, CBTC 232, 28 seats. Hybrid 01H: Th 6–8 PM, CBTC 218, 25 seats; online 800N in the spring. No summer section posted yet." },
  "CST 131": { room: "CBTC 232", cap: 28, class: [["Mon", "18:00", "19:30"]], lab: [["Mon", "19:30", "21:20"]], note: "Fall 2026 hybrid section 01H (the only seated section): M 6–7:30 PM class then 7:30–9:20 PM lab, CBTC 232, 28 seats. Online asynchronous 14-week sections 800N (Fall) and 801N (Spring), 30 seats; a 4-week CCPP section at A.L. Brown HS (Feb 26 – Mar 24, 2027)." },
  "EGR 125": { online: true, cap: 30, note: "Online asynchronous 14-week section 800N only (Aug 31 – Dec 18, 2026), 30 seats; here in weeks 3–16 with no day or room." },
  "WBL 110": { online: true, cap: 30, note: "Online asynchronous 14-week sections 800N / 801N (Aug 31 – Dec 18, 2026), 30 seats; here in weeks 3–16 with no day or room." },
};

const hm = (t) => { const [h, m] = t.split(":").map(Number); return h + m / 60; };
const len = (a, b) => Math.round((hm(b) - hm(a)) * 100) / 100;

/** The sessions of a course in a term of `weeks` weeks. `summer` doubles the hours (an 8-week term). `hs` = a
 *  high-school (CCPP) cohort at A.L. Brown HS: the hours with no day or time. `apprentice` = the 3-hour
 *  weekly class with nothing published. */
function sessionsFor(code, weeks, opts = {}) {
  const cat = CATALOG[code]; const sch = opts.hs || opts.apprentice ? null : SCHEDULE[code];
  const out = []; const n = { CLASS: 0, LAB: 0 };
  const push = (kind, week, day, start, end, hours, room, seats, extra = {}) => out.push({
    kind, number: ++n[kind], title: `${cat.title} — ${kind === "CLASS" ? "Class" : "Lab"}, week ${week}`, deliveryMode: "In-person", location: room,
    lengthHours: hours, maxStudents: seats, facultyNeeded: 1, facultyContactPolicy: kind === "CLASS" ? 2.5 : 2, supportStaffNeeded: 0, supportContactPolicy: 1,
    week, dayOfWeek: day, startTime: start, endTime: end, sectionTimes: null, notes: sch?.note ?? null, preceptorsNeeded: 0, preceptorContactPolicy: null, rotationType: null, clinicalMode: null, ...extra,
  });
  const scale = opts.summer ? 2 : 1;
  const [c, l] = cat.hours;
  if (opts.apprentice) {
    for (let w = 1; w <= weeks; w++) push("CLASS", w, null, null, null, 3, null, 17, { notes: "One 3-hour class a week for 28 weeks (September – April); the night, start date and room come from RCCC Corporate & Continuing Education / NCAEC. 17 apprentices a year (the owner's figure, 2026-10-20)." });
    return out;
  }
  if (sch && !sch.online && !opts.summer) {
    for (let w = 1; w <= weeks; w++) {
      for (const [d, s, e] of sch.class) push("CLASS", w, d, s, e, len(s, e), sch.room, sch.cap);
      for (const [d, s, e] of sch.lab) push("LAB", w, d, s, e, len(s, e), sch.room, sch.cap);
    }
    return out;
  }
  // Online 14-week (weeks 3–16), a summer course, a high-school cohort or a general-education course: the
  // catalog hours as one class (and one lab) row a week with no day or time.
  const first = sch?.online && !opts.summer ? 3 : 1;
  const room = opts.hs ? "A.L. Brown HS" : sch?.online ? "Virtual" : cat.gened ? "General classroom" : null;
  const seats = opts.hs ? 10 : sch?.cap ?? (cat.gened ? 30 : 16);
  const mode = sch?.online ? "Online" : "In-person";
  const notes = opts.hs ? "High-school (CCPP) cohort at A.L. Brown HS; the college publishes sections there only for ELC 111 and CST 131, so the days and times are not yet on record." : opts.summer ? `Summer 8-week term: the catalog's 16-week hours doubled (${c * scale} class / ${l * scale} lab a week); the college has posted no summer section yet.` : sch?.note ?? (cat.gened ? GENED : null);
  for (let w = first; w <= weeks; w++) {
    if (c) push("CLASS", w, null, null, null, c * scale, room, seats, { deliveryMode: mode, notes });
    if (l) push("LAB", w, null, null, null, l * scale, room, seats, { deliveryMode: mode, notes, location: opts.hs ? "A.L. Brown HS" : sch?.online ? "Virtual" : cat.gened ? "General lab" : null });
  }
  return out;
}

// ---- The awards ------------------------------------------------------------------------------------
// term = [name, season, weeks, courses]. Fall and spring are 16 weeks, the summer term the college's 8-week summer.
const F = 16, S = 16, U = 8;
const AWARDS = [
  { file: "rccc-est-aas.json", name: "Electrical Systems Technology AAS (A35130)", programType: "Traditional Full Time", credential: "AAS", maxCohort: 16, months: 3,
    terms: [["Year 1 Fall", "Fall", F, ["ELC 112", "ELC 126", "ELC 113", "ELC 118"]], ["Year 1 Spring", "Spring", S, ["ELC 117", "ELC 125", "EGR 125", "ENG 111", "MAT 121 or MAT 143 or PHY 110"]], ["Year 1 Summer", "Summer", U, ["BPR 130", "Major elective"]], ["Year 2 Fall", "Fall", F, ["CST 131", "ELC 119", "ELC 128", "WBL 110", "Major elective"]], ["Year 2 Spring", "Spring", S, ["ELC 115", "ELC 215", "AHR 120", "Communication elective"]], ["Year 2 Summer", "Summer", U, ["Humanities/Fine Arts elective", "Social/Behavioral Science elective"]]],
    note: `Six terms over two years, 64 credits (43 technical, 21 general education). The catalog lists ELC 115, ELC 215 and AHR 120 in Year 2 Spring; the college runs all three in the fall (ELC 115 in both terms). Co-requisite pairs: ELC 112 + 126 and ELC 113 + 118 in the first fall, ELC 117 + 125 in the spring. Class size 16 (the lab rooms' cap; 12 for the PLC lab). ${TEMPLATE}` },
  { file: "rccc-est-diploma.json", name: "Electrical Systems Technology Diploma (D35130)", programType: "Traditional Full Time", credential: "Diploma", maxCohort: 16, months: 3,
    terms: [["Year 1 Fall", "Fall", F, ["ELC 112", "ELC 126", "ELC 113", "ELC 118", "EGR 125"]], ["Year 1 Spring", "Spring", S, ["ELC 115", "ELC 117", "ELC 125", "ENG 111"]], ["Year 1 Summer", "Summer", U, ["CST 131", "Gen-ed elective"]], ["Year 2 Fall", "Fall", F, ["ELC 119", "ELC 128"]]],
    note: `Four terms over sixteen months, 40 credits: the ten core ELC courses plus EGR 125, CST 131, ENG 111 and one general-education elective; a strict subset of the AAS. Class size 16. ${TEMPLATE}` },
  { file: "rccc-est-diploma-ccpp.json", name: "CCPP Electrical Systems Technology Diploma (D35130PB)", programType: "High school (CCPP)", credential: "Diploma", maxCohort: 10, months: 3, hs: true,
    terms: [["Year 1 Fall", "Fall", F, ["ELC 112", "ELC 126", "ELC 113", "ELC 118"]], ["Year 1 Spring", "Spring", S, ["ELC 115", "ELC 117", "ELC 125"]], ["Year 1 Summer", "Summer", U, ["COM 231", "ENG 111"]], ["Year 2 Fall", "Fall", F, ["ELC 119", "ELC 128"]], ["Year 2 Spring", "Spring", S, ["CST 131", "EGR 125"]]],
    note: `The diploma's 40 credits spread over five terms for Career & College Promise high-school students (a lighter load): COM 231 fixed in place of the open elective, CST 131 and EGR 125 in a fifth term. Taught to the A.L. Brown HS cohort (10 seats); the college publishes sections there only for ELC 111 and CST 131, so days and times are not yet on record. ${TEMPLATE}` },
  { file: "rccc-est-cert-basic.json", name: "Basic Certificate (C35130BA)", programType: "Certificate", credential: "Certificate", maxCohort: 16, months: 3,
    terms: [["Fall", "Fall", F, ["ELC 112", "ELC 126", "ELC 113", "ELC 118"]], ["Spring", "Spring", S, ["CST 131"]]],
    note: `Two terms, 17 credits: the first-fall core plus CST 131. Class size 16. ${TEMPLATE}` },
  { file: "rccc-est-cert-ccpp.json", name: "CCPP Certificate (C35130PB)", programType: "High school (CCPP)", credential: "Certificate", maxCohort: 10, months: 3, hs: true,
    terms: [["Fall", "Fall", F, ["ELC 112", "ELC 126", "ELC 113", "ELC 118"]], ["Spring", "Spring", S, ["CST 131"]]],
    note: `The Basic Certificate's course list for Career & College Promise high-school students (A.L. Brown HS cohort, 10 seats); days and times not yet on record. ${TEMPLATE}` },
  { file: "rccc-est-cert-mtc1.json", name: "MTC 1 Certificate (C35130MB)", programType: "Certificate", credential: "Certificate", maxCohort: 16, months: 3,
    terms: [["Year 1 Fall", "Fall", F, ["ELC 112", "ELC 126"]], ["Year 1 Spring", "Spring", S, ["ELC 117", "ELC 125"]], ["Year 2 Fall", "Fall", F, ["ELC 215"]]],
    note: `Three terms (Fall – Spring – Fall), 17 credits: theory, motors and ELC 215 Electrical Maintenance. Class size 16. ${TEMPLATE}` },
  { file: "rccc-est-cert-motor-control.json", name: "Industrial Motor Control Certificate (C35130MO)", programType: "Certificate", credential: "Certificate", maxCohort: 12, months: 3,
    terms: [["Year 1 Fall", "Fall", F, ["ELC 112", "ELC 126"]], ["Year 1 Spring", "Spring", S, ["ELC 117", "ELC 125"]], ["Year 2 Fall", "Fall", F, ["ELC 128"]]],
    note: `Three terms (Fall – Spring – Fall), 17 credits: theory, motors and ELC 128 PLC. Class size 12 (the PLC lab's cap). ${TEMPLATE}` },
  { file: "rccc-est-cert-wiring-nec.json", name: "Wiring and the NEC Certificate (C35130NE)", programType: "Certificate", credential: "Certificate", maxCohort: 16, months: 3,
    terms: [["Fall", "Fall", F, ["ELC 113", "ELC 118"]], ["Spring", "Spring", S, ["ELC 115", "ELC 119"]]],
    note: `Two terms, 12 credits: residential and industrial wiring and both NEC courses. Class size 16. ${TEMPLATE}` },
];
const APPRENTICESHIP = {
  file: "rccc-electrician-apprenticeship.json", name: "Electrician Apprenticeship (NCAEC, ApprenticeshipNC #29076)", programType: "Registered apprenticeship", credential: "Journeyworker certificate (US DOL / NCCCS)", maxCohort: 17, months: 0, calendarMode: "continuous",
  terms: [["Year 1", null, 28, ["ELC-3014B"]], ["Year 2", null, 28, ["ELC-3014C"]], ["Year 3", null, 28, ["ELC-3014D"]], ["Year 4", null, 28, ["ELC-3014E"]]],
  gap: 24, // weeks between one 28-week year and the next: September to September
  note: "The NC Association of Electrical Contractors' four-year registered apprenticeship, hosted by RCCC Corporate & Continuing Education as four non-credit levels (CEUs, taught from the Mike Holt lesson plan): apprentices work full-time for a sponsoring contractor and attend one 3-hour class a week for 28 weeks a year (September – April). 336 classroom hours plus OSHA 10, 230 documented competency hours and 8,000 on-the-job hours over four years; the US DOL / NCCCS journeyworker certificate on completion. Cohorts enrol through NCAEC and RCCC Continuing Education, not open registration: 17 apprentices a year (the owner's figure, 2026-10-20); the night, start date and room for the current cohort are not published. On-the-job hours are recorded on each level, not scheduled. The levels map roughly onto the AAS core (I ≈ ELC 112/126/118, II ≈ 113/115, III ≈ 117/128, IV ≈ 119) but there is no published articulation.",
};

function pack(def) {
  let startWeek = 1;
  const terms = def.terms.map(([name, semester, weeks, codes], i) => {
    const t = { index: i + 1, name, semester, startWeek, endWeek: startWeek + weeks - 1, weeks, courses: codes.map((code) => {
      const cat = CATALOG[code]; const summer = semester === "Summer"; const scale = summer ? 2 : 1; const [c, l, w] = cat.hours;
      return { code, title: cat.title, weeklyClassHours: c * scale, weeklyLabHours: l * scale, weeklyClinicalHours: 0, weeklyWorkHours: w, credits: cat.credits, requisites: cat.requisites, courseType: cat.gened ? "GENED" : "CORE", description: cat.description ?? (cat.gened ? GENED : null), sessions: sessionsFor(code, weeks, { summer, hs: def.hs, apprentice: !!def.gap }) };
    }) };
    startWeek += weeks + (def.gap ?? 0);
    return t;
  });
  return { name: def.name, programType: def.programType, credential: def.credential, sourceWorkbook: SOURCE, institution: "Rowan-Cabarrus Community College", maxCohort: def.maxCohort, ...(def.calendarMode ? { calendarMode: def.calendarMode } : {}), monthsToFullProductivity: def.months, note: def.note,
    weeklyHoursNote: "Weekly class / lab hours and credits are the catalog's (16-week basis; a summer 8-week term carries them doubled); sessions are the college's day sections; clinical hours are zero in every course.",
    assumptions: ASSUMPTIONS, terms };
}

for (const def of [...AWARDS, APPRENTICESHIP]) {
  const p = pack(def);
  writeFileSync(`prisma/templates/${def.file}`, JSON.stringify(p, null, 2) + "\n");
  const courses = p.terms.flatMap((t) => t.courses);
  console.log(def.file.padEnd(36), `${p.terms.length} terms · ${courses.length} courses · ${courses.reduce((n, c) => n + c.sessions.length, 0)} sessions · credits ${courses.reduce((n, c) => n + c.credits, 0)}`);
}
