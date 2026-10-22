// ─────────────────────────────────────────────────────────────────────────────
// The other institutions in the workspace, each with the programs (delivery
// models) identified for it and a North-Star goal per job. Some are defined
// here but PAUSED (see PAUSED_INSTITUTIONS below) and not seeded for now. Curricula follow the
// NC Community College System common course library (NUR, ELC, OST, MED, NAS)
// and UNCW's upper-division BSN sequence; session tables are generated from
// the catalog hours the way the Sandhills templates are. Everything here is a
// planning STARTING POINT for each college's data steward to correct.
//
// Notes carried from the program inventory (shown on the home page):
//  · Cape Fear CC — LPN-to-ADN Transition: the site shows two application
//    windows; confirm one or two cohorts a year and which term(s) they start.
//  · James Sprunt CC — LPN Advanced Placement Option: confirm whether this is
//    a distinct offering or advanced placement into the ADN cohort.
//  · Southeastern CC — LPN-to-ADN Transition: Summer 2026 is the inaugural
//    cohort of a new grant-funded program, so history is limited.
//  · Davidson-Davie CC and Beaufort County CC were listed without a program;
//    Electrical Systems Technology is assumed from the surrounding list.
// ─────────────────────────────────────────────────────────────────────────────

import type { PrismaClient } from "@prisma/client";
import type { createProgram, createCnaProgram, createPackProgram, loadPack, genTerms, CnaTemplate, CourseSeed, TermSeed } from "./seed";

/** The Nurse Aide I template packs, one per college workbook (prisma/templates/cna*.json). */
export type CnaPacks = { carteret: CnaTemplate[]; lenoir: CnaTemplate[]; roanokeChowan: CnaTemplate[] };
type Helpers = { createProgram: typeof createProgram; createCnaProgram: typeof createCnaProgram; createPackProgram: typeof createPackProgram; loadPack: typeof loadPack; genTerms: typeof genTerms; cnaPacks: CnaPacks };

// ── Curricula ───────────────────────────────────────────────────────────────
const NURSING_ROTATIONS = ["Med-Surg", "ICU / Critical Care", "OB / Maternity", "Pediatrics", "Behavioral Health", "Long-Term Care", "Emergency", "Community / Public Health"];
const grp = { mode: "Instructor-led", maxStudents: 8, faculty: 1, preceptors: 0 };   // NC BON 1:10 clinical groups; 8 per instructor here
const precept = { mode: "Preceptor-led", maxStudents: 1, faculty: 0.1, preceptors: 1 }; // final-term preceptorship, 1:1
const cc = (code: string, name: string, classH: number, labH: number, clinH: number, credits: number, type = "CORE", extra: Partial<CourseSeed> = {}): CourseSeed =>
  ({ code, name, weeklyClassHours: classH, weeklyLabHours: labH, weeklyClinicalHours: clinH, credits, semester: "All", type, description: "", requisites: "", ...(clinH > 0 ? { rotations: NURSING_ROTATIONS, clinical: grp } : {}), ...extra });
const T = (index: number, name: string, weeks: number, courses: CourseSeed[], startWeek = 1): TermSeed => ({ index, name, startWeek, endWeek: startWeek + weeks - 1, courses });

/** Associate Degree Nursing — the five-semester NCCCS concept-based curriculum. */
function adnTerms(): TermSeed[] {
  return [
    T(1, "First Fall", 16, [cc("NUR 111", "Introduction to Health Concepts", 4, 6, 6, 8), cc("BIO 168", "Anatomy and Physiology I", 3, 3, 0, 4, "GENED"), cc("PSY 150", "General Psychology", 3, 0, 0, 3, "GENED"), cc("ENG 111", "Writing and Inquiry", 3, 0, 0, 3, "GENED")]),
    T(2, "First Spring", 16, [cc("NUR 112", "Health-Illness Concepts", 3, 0, 6, 5), cc("NUR 114", "Holistic Health Concepts", 3, 0, 6, 5), cc("BIO 169", "Anatomy and Physiology II", 3, 3, 0, 4, "GENED"), cc("PSY 241", "Developmental Psychology", 3, 0, 0, 3, "GENED")], 17),
    T(3, "Summer", 10, [cc("NUR 113", "Family Health Concepts", 3, 0, 6, 5), cc("BIO 275", "Microbiology", 3, 3, 0, 4, "GENED")], 33),
    T(4, "Second Fall", 16, [cc("NUR 211", "Health Care Concepts", 3, 0, 6, 5), cc("NUR 212", "Health System Concepts", 3, 0, 6, 5), cc("ENG 112", "Writing/Research in the Disciplines", 3, 0, 0, 3, "GENED")], 43),
    T(5, "Second Spring", 16, [cc("NUR 213", "Complex Health Concepts", 4, 3, 15, 10, "CORE", { clinical: precept }), cc("HUM 115", "Critical Thinking", 3, 0, 0, 3, "GENED")], 59),
  ];
}
/** LPN-to-ADN / Paramedic-to-ADN: the transition course, then the second-year sequence. */
function transitionTerms(entryLabel: string, bridgeCode: string, bridgeName: string): TermSeed[] {
  return [
    T(1, `${entryLabel} — Transition`, 12, [cc(bridgeCode, bridgeName, 3, 3, 6, 6), cc("BIO 275", "Microbiology", 3, 3, 0, 4, "GENED")]),
    T(2, "Term 2", 16, [cc("NUR 211", "Health Care Concepts", 3, 0, 6, 5), cc("NUR 212", "Health System Concepts", 3, 0, 6, 5), cc("PSY 241", "Developmental Psychology", 3, 0, 0, 3, "GENED")], 13),
    T(3, "Term 3", 16, [cc("NUR 213", "Complex Health Concepts", 4, 3, 15, 10, "CORE", { clinical: precept }), cc("HUM 115", "Critical Thinking", 3, 0, 0, 3, "GENED")], 29),
  ];
}
/** UNCW prelicensure BSN — four upper-division semesters after prerequisites. */
function bsnTerms(accelerated = false): TermSeed[] {
  const w = accelerated ? 12 : 16;
  const t = [
    T(1, accelerated ? "Term 1" : "Junior Fall", w, [cc("NSG 311", "Foundations of Professional Nursing", 3, 0, 6, 6), cc("NSG 321", "Health Assessment", 2, 3, 0, 3), cc("NSG 331", "Pathophysiology and Pharmacology I", 3, 0, 0, 3)]),
    T(2, accelerated ? "Term 2" : "Junior Spring", w, [cc("NSG 341", "Adult Health Nursing I", 3, 0, 9, 6), cc("NSG 351", "Mental Health Nursing", 2, 0, 6, 4), cc("NSG 361", "Pathophysiology and Pharmacology II", 3, 0, 0, 3)], w + 1),
    T(3, accelerated ? "Term 3" : "Senior Fall", w, [cc("NSG 421", "Adult Health Nursing II", 3, 0, 9, 6), cc("NSG 431", "Maternal-Newborn Nursing", 2, 0, 6, 4), cc("NSG 441", "Nursing Care of Children", 2, 0, 6, 4)], 2 * w + 1),
    T(4, accelerated ? "Term 4" : "Senior Spring", w, [cc("NSG 451", "Community and Public Health Nursing", 2, 0, 6, 4), cc("NSG 461", "Leadership and Transition to Practice Practicum", 2, 0, 12, 6, "CORE", { clinical: precept })], 3 * w + 1),
  ];
  return t;
}
/** Electrical Systems Technology AAS — labs, no clinicals. */
function electricalTerms(): TermSeed[] {
  const e = (code: string, name: string, cl: number, lab: number, cr: number, type = "CORE") => cc(code, name, cl, lab, 0, cr, type);
  return [
    T(1, "First Fall", 16, [e("ELC 112", "DC/AC Electricity", 3, 6, 5), e("ELC 113", "Residential Wiring", 2, 6, 4), e("ELC 118", "National Electrical Code", 1, 2, 2), e("ENG 111", "Writing and Inquiry", 3, 0, 3, "GENED"), e("MAT 110", "Math Measurement and Literacy", 2, 2, 3, "GENED")]),
    T(2, "First Spring", 16, [e("ELC 115", "Industrial Wiring", 2, 6, 4), e("ELC 117", "Motors and Controls", 2, 6, 4), e("ELC 131", "Circuit Analysis I", 3, 3, 4), e("ELC 128", "Introduction to PLC", 2, 3, 3)], 17),
    T(3, "Summer", 10, [e("ELC 133", "Circuit Analysis II", 3, 3, 4), e("ELC 138", "DC/AC Machines", 2, 3, 3)], 33),
    T(4, "Second Fall", 16, [e("ELC 213", "Instrumentation", 3, 2, 4), e("ELC 218", "Advanced Motor Controls", 2, 3, 3), e("ELC 233", "Energy Management", 3, 0, 3), e("COM 231", "Public Speaking", 3, 0, 3, "GENED")], 43),
    T(5, "Second Spring", 16, [e("ELC 229", "Applications Project", 1, 6, 3), e("ELC 221", "Advanced PLC", 2, 3, 3), e("ELC 128A", "Industrial Networks", 2, 3, 3), e("HUM 115", "Critical Thinking", 3, 0, 3, "GENED")], 59),
  ];
}
/** Medical Office Administration — diploma with a work-based learning term in a practice. */
function medicalOfficeTerms(): TermSeed[] {
  const o = (code: string, name: string, cl: number, lab: number, cr: number, type = "CORE") => cc(code, name, cl, lab, 0, cr, type);
  return [
    T(1, "Fall", 16, [o("OST 131", "Keyboarding", 1, 2, 2), o("OST 136", "Word Processing", 2, 2, 3), o("MED 121", "Medical Terminology I", 3, 0, 3), o("OST 149", "Medical Legal Issues", 3, 0, 3), o("ENG 111", "Writing and Inquiry", 3, 0, 3, "GENED")]),
    T(2, "Spring", 16, [o("OST 148", "Medical Coding, Billing and Insurance", 3, 0, 3), o("OST 247", "Procedures for the Medical Office", 3, 0, 3), o("MED 122", "Medical Terminology II", 3, 0, 3), o("OST 236", "Advanced Word / Information Processing", 2, 2, 3), o("OST 286", "Professional Development", 3, 0, 3)], 17),
    T(3, "Summer", 10, [o("OST 248", "Diagnostic Coding", 3, 0, 3), cc("WBL 111", "Work-Based Learning I", 0, 0, 10, 1, "CORE", { rotations: ["Doctor's Office"], clinical: { mode: "Preceptor-led", maxStudents: 1, faculty: 0.05, preceptors: 1 } })], 33),
  ];
}

// ── The institutions ────────────────────────────────────────────────────────
/** A program is either coded here (`terms`) or a template pack under prisma/templates (`pack`: name, type, credential, class size, terms, courses and sessions all come from the file). */
type CodedProgramDef = { name: string; type: string; credential: string; terms: (h: Helpers) => TermSeed[]; launch: string; seats: number; months?: number; note?: string };
type PackProgramDef = { pack: string; launch: string; months?: number; note?: string };
type ProgramDef = CodedProgramDef | PackProgramDef;
const isPack = (p: ProgramDef): p is PackProgramDef => "pack" in p;
interface FamilyDef { name: string; soc: string; occupation: string; description: string; goals: Record<number, number>; programs: ProgramDef[]; cna?: boolean; /** Seed every delivery model in this college's own workbook pack. */ cnaAll?: keyof CnaPacks }
interface InstitutionDef { name: string; short: string; kind: string; city: string; serviceArea: string; families: FamilyDef[] }

const RN = { soc: "29-1141", occupation: "Registered Nurses" };
const ELECTRICIAN = { soc: "47-2111", occupation: "Electricians" };
const MA = { soc: "31-9092", occupation: "Medical Assistants" };
const MOA = { soc: "43-6013", occupation: "Medical Secretaries and Administrative Assistants" };
const NA = { soc: "31-1131", occupation: "Nursing Assistants" };
const THIS_YEAR = new Date().getUTCFullYear();
/** A flat-then-stairstep North-Star goal starting this year: base, base, +10%, +20%, +20%. */
export const goals = (base: number) => ({ [THIS_YEAR]: base, [THIS_YEAR + 1]: base, [THIS_YEAR + 2]: Math.round(base * 1.1), [THIS_YEAR + 3]: Math.round(base * 1.2), [THIS_YEAR + 4]: Math.round(base * 1.2) });
/** A stated annual goal held flat across the planning horizon (the partner's own number, not a stairstep). */
export const flatGoal = (base: number) => ({ [THIS_YEAR]: base, [THIS_YEAR + 1]: base, [THIS_YEAR + 2]: base, [THIS_YEAR + 3]: base, [THIS_YEAR + 4]: base });
/** Serialize a goal set the way the goal planner stores it. `goal` is the
 *  family's default talent-pipeline health rates (the ladder every new
 *  launching cohort inherits at lock-in); omit it to use the benchmarks. */
export const goalPlanJson = (g: Record<number, number>, goal?: Record<string, number>) => { const years = Object.keys(g).map(Number).sort(); return JSON.stringify({ anchor: "northstar", years, goalsByYear: Object.fromEntries(Object.entries(g).map(([y, v]) => [String(y), v])), selectedYear: years[1] ?? years[0], ...(goal ? { goal } : {}) }); };

const nursingFamily = (description: string, base: number, programs: ProgramDef[]): FamilyDef => ({ name: "Nursing (prelicensure RN)", ...RN, description, goals: goals(base), programs });
const adn = (entry: "Fall" | "Spring", seats = 40): ProgramDef => ({ name: `ADN — ${entry} Entry`, type: "Traditional Full Time", credential: "AAS", terms: adnTerms, launch: entry.toUpperCase(), seats, months: 6 });
const lpnTransition = (entry: "Fall" | "Spring" | "Summer", note?: string, seats = 20): ProgramDef => ({ name: `LPN-to-ADN Transition — ${entry} Entry`, type: "Transition (LPN)", credential: "AAS", terms: () => transitionTerms(entry, "NUR 214", "Nursing Transition Concepts"), launch: entry.toUpperCase(), seats, months: 6, note });

/** Brunswick Community College's three RN pathways — template packs built by scripts/build-brunswick-packs.mjs
 *  from the college's information sheets (sequence, hours, credits) and its published course sections
 *  (days, times, rooms, seats). Every NUR course runs once a year in a fixed term and the LPN and paramedic
 *  cohorts join the second-year ADN cohort for NUR 113, 211, 212 and 213: the college lists one meeting with a
 *  section per cohort, carried under each program here. */
const TEMPLATE_PENDING = "Sessions are the college's published Fall 2026 – Summer 2027 sections; the college's own program-structure workbook replaces them when it arrives.";
export const BRUNSWICK_PROGRAMS: PackProgramDef[] = [
  { pack: "brunswick-adn.json", launch: "SUMMER", months: 6, note: `${TEMPLATE_PENDING} Admitted in the Dec–Jan window (TEAS ≥ 59, GPA ≥ 2.5); NUR 117 in the summer, NUR 111 in the fall. Class size from the college's sections (NUR 111: 51 seats; NUR 112 and 114: 50).` },
  { pack: "brunswick-lpn-adn.json", launch: "SUMMER", months: 6, note: `${TEMPLATE_PENDING} Before applying: BIO 168, BIO 169, ENG 111, PSY 150, PSY 241 (17 credits); NUR 111, 112, 114 and 117 (20 credits) credited for the LPN license after NUR 212. Application Dec 1 – Jan 31, ATI PN predictor in April, classes begin with the summer term. Class size from the college's sections (20 seats).` },
  { pack: "brunswick-paramedic-adn.json", launch: "SPRING", months: 6, note: `${TEMPLATE_PENDING} Before applying: BIO 168, BIO 169, ENG 111, PSY 150 (14 credits); NUR 215 with a B or better converts to credit for NUR 111, 112, 114 and 117 (20 credits). Application Jul 1 – Aug 30 (TEAS ≥ 59, GPA ≥ 2.5), classes begin with the spring term. Class size from the college's sections (10 seats).` },
];

/** Rowan-Cabarrus Community College's Electrical Systems Technology — the eight credentials the college lists under
 *  program 35130 and the NCAEC electrician apprenticeship its Continuing Education hosts — template packs built by
 *  scripts/build-rccc-packs.mjs from the college's 2026–27 catalog (sequence, hours, credits, requisites), its
 *  published Fall 2026 – Summer 2027 sections (days, times, rooms at the Cabarrus Business & Technology Center,
 *  seat caps) and the NCAEC handbook. No clinical component. The college's workbook templates replace the
 *  sessions when they arrive. */
const RCCC_TEMPLATE = "Sessions are the college's published 2026–27 day sections; the college's own program-structure workbook replaces them when it arrives.";
export const RCCC_PROGRAMS: PackProgramDef[] = [
  { pack: "rccc-est-aas.json", launch: "FALL", months: 3, note: RCCC_TEMPLATE },
  { pack: "rccc-est-diploma.json", launch: "FALL", months: 3, note: RCCC_TEMPLATE },
  { pack: "rccc-est-diploma-ccpp.json", launch: "FALL", months: 3, note: "High-school (Career & College Promise) cohort at A.L. Brown HS; days and times not yet on record. The college's workbook replaces the sessions when it arrives." },
  { pack: "rccc-est-cert-basic.json", launch: "FALL", months: 3, note: RCCC_TEMPLATE },
  { pack: "rccc-est-cert-ccpp.json", launch: "FALL", months: 3, note: "High-school (Career & College Promise) cohort at A.L. Brown HS; days and times not yet on record. The college's workbook replaces the sessions when it arrives." },
  { pack: "rccc-est-cert-mtc1.json", launch: "FALL", months: 3, note: RCCC_TEMPLATE },
  { pack: "rccc-est-cert-motor-control.json", launch: "FALL", months: 3, note: RCCC_TEMPLATE },
  { pack: "rccc-est-cert-wiring-nec.json", launch: "FALL", months: 3, note: RCCC_TEMPLATE },
  { pack: "rccc-electrician-apprenticeship.json", launch: "FALL", months: 0, note: "NCAEC four-year registered apprenticeship (ApprenticeshipNC #29076) hosted by RCCC Corporate & Continuing Education: one 3-hour class a week for 28 weeks a year from September, full-time work for the sponsoring contractor between. 17 apprentices a year (the owner's figure, 2026-10-20); the night, start date and room for the current cohort are not published; on-the-job hours are recorded on each level, not scheduled." },
];

/** Cape Fear Community College's Electrical Systems Technology: the four credentials under program 35130 and the
 *  college's registered Electrical Apprenticeship, as template packs built by scripts/build-cape-fear-packs.mjs
 *  (2026-10-22). The college's credentials, credit totals, evening sections, calendar and workload handbook are its
 *  own; course hours are the NCCCS standard's; each sequence is the standard laid out to the college's credit total
 *  until the catalog's program of study can be read. No clinical component. */
const CAPE_FEAR_TEMPLATE = "Sequence from the NCCCS standard laid out to the college's published credit total; ELC 112 and ELC 113 sit on the college's announced fall 2026 evening sections at the North Campus, every other course carries its hours with no section on record. The catalog's program of study and the Class Finder's sections replace them when they can be read.";
export const CAPE_FEAR_PROGRAMS: PackProgramDef[] = [
  { pack: "cape-fear-est-cert.json", launch: "FALL", months: 3, note: CAPE_FEAR_TEMPLATE },
  { pack: "cape-fear-est-cert-ctep.json", launch: "FALL", months: 3, note: "Career & College Promise high-school cohort (C35130CP, New Hanover and Pender county schools); where and when it meets is not published. The catalog's program of study replaces the sequence when it can be read." },
  { pack: "cape-fear-est-diploma.json", launch: "FALL", months: 3, note: CAPE_FEAR_TEMPLATE },
  { pack: "cape-fear-est-aas.json", launch: "FALL", months: 3, note: CAPE_FEAR_TEMPLATE },
  { pack: "cape-fear-electrical-apprenticeship.json", launch: "FALL", months: 0, note: "The college's four-year registered Electrical Apprenticeship (ApprenticeshipNC, CFCC Job Training): evening classes from late August to spring from the Mike Holt curriculum, about 624 classroom hours over four levels, full-time work for a sponsoring employer between. Nights, room, start date and class size are not published." },
];

export const INSTITUTIONS: InstitutionDef[] = [
  { name: "Rowan-Cabarrus Community College", short: "Rowan-Cabarrus CC", kind: "Community college", city: "Salisbury", serviceArea: "Rowan & Cabarrus Counties, NC", families: [
    { name: "Electrical Systems Technology", ...ELECTRICIAN, goals: goals(20), programs: RCCC_PROGRAMS,
      description: "Rowan-Cabarrus lists eight stacked credentials under Electrical Systems Technology (program 35130): the 64-credit AAS, the 40-credit diploma and its Career & College Promise version, and five certificates (Basic, CCPP, MTC 1, Industrial Motor Control, Wiring and the NEC) — every one starting in the fall with ELC 112, taught at the Cabarrus Business & Technology Center — plus the NCAEC four-year electrician apprenticeship hosted by Continuing Education. Labs, no clinicals. The North-Star goal of 20 a year is a placeholder, not the college's figure." },
  ] },

  // Brunswick's three prelicensure RN pathways from the college's own publications (2026-10-12): the
  // template packs above. The North-Star goal is the owner's figure (190 a year).
  { name: "Brunswick Community College", short: "Brunswick CC", kind: "Community college", city: "Bolivia", serviceArea: "Brunswick County, NC", families: [
    { name: "Nursing (prelicensure RN)", ...RN, goals: flatGoal(190), programs: BRUNSWICK_PROGRAMS,
      description: "Brunswick's prelicensure RN pathways: the Associate Degree Nursing program (A45110, admitted for fall with NUR 117 in the summer before), the LPN-to-ADN Transition (A45110T, summer entry) and the Paramedic-to-ADN Bridge (A45110M, spring entry). Every NUR course runs once a year in a fixed term, so the LPN and paramedic cohorts join the second-year ADN cohort for NUR 113, 211, 212 and 213. Sequences and hours from the college's information sheets; sessions and class sizes from its published Fall 2026 – Summer 2027 sections." },
  ] },
  { name: "Cape Fear Community College", short: "Cape Fear CC", kind: "Community college", city: "Wilmington", serviceArea: "New Hanover & Pender Counties, NC", families: [
    nursingFamily("Cape Fear's prelicensure RN pathways: two ADN intakes a year plus the LPN-to-ADN transition.", 90, [
      adn("Spring", 48), adn("Fall", 48),
      lpnTransition("Fall", "Confirm: the website currently shows two application windows — one cohort or two per year, and which term(s) it starts?"),
    ]),
    { name: "Electrical Systems Technology", ...ELECTRICIAN, goals: goals(24), programs: CAPE_FEAR_PROGRAMS,
      description: "Cape Fear's Electrical Systems Technology (program 35130, taught at the North Campus in Castle Hayne): the 15-credit certificate (C35130) and its Career & College Promise CTE pathway (C35130CP), the 40-credit diploma (D35130) and the 71-credit AAS (A35130) — the college's credentials and credit totals (2024–25 list), with the course sequences laid out from the NCCCS standard until the catalog's program-of-study pages can be read — plus the college's four-year registered Electrical Apprenticeship (Job Training, Mike Holt curriculum, evenings). Fall 2026 brought evening sections of ELC 112 and ELC 113 at the North Campus under a $250,000 Careers Electric grant that funds a second instructor. No clinical component. The North-Star goal of 24 a year is the earlier placeholder, not the college's figure." },
  ] },
  { name: "James Sprunt Community College", short: "James Sprunt CC", kind: "Community college", city: "Kenansville", serviceArea: "Duplin County, NC", families: [
    nursingFamily("James Sprunt's prelicensure RN pathways.", 30, [
      adn("Fall", 30),
      { name: "LPN Advanced Placement Option — Fall Entry", type: "Advanced Placement (LPN)", credential: "AAS", terms: () => transitionTerms("Fall", "NUR 214", "Nursing Transition Concepts"), launch: "FALL", seats: 12, months: 6, note: "Confirm: a distinct program offering, or advanced placement into the ADN cohort?" },
    ]),
  ] },
  { name: "Southeastern Community College", short: "Southeastern CC", kind: "Community college", city: "Whiteville", serviceArea: "Columbus County, NC", families: [
    nursingFamily("Southeastern's prelicensure RN pathways, including the new grant-funded LPN-to-ADN transition.", 36, [
      adn("Fall", 36),
      lpnTransition("Summer", "Summer 2026 is the inaugural cohort of this new grant-funded program — history is limited."),
    ]),
  ] },
  { name: "University of North Carolina Wilmington", short: "UNC-W", kind: "University", city: "Wilmington", serviceArea: "Southeastern North Carolina", families: [
    { name: "Nursing (prelicensure BSN)", ...RN, description: "UNCW's prelicensure BSN pathways: two traditional intakes a year and the accelerated BSN.", goals: goals(150), programs: [
      { name: "Accelerated BSN — Summer Entry", type: "Accelerated (second degree)", credential: "BSN", terms: () => bsnTerms(true), launch: "SUMMER", seats: 48, months: 6 },
      { name: "BSN Prelicensure — Spring Entry", type: "Traditional Full Time", credential: "BSN", terms: () => bsnTerms(false), launch: "SPRING", seats: 64, months: 6 },
      { name: "BSN Prelicensure — Fall Entry", type: "Traditional Full Time", credential: "BSN", terms: () => bsnTerms(false), launch: "FALL", seats: 64, months: 6 },
    ] },
  ] },
  ...[["Pitt Community College", "Pitt CC", "Winterville", "Pitt County, NC"], ["Forsyth Technical Community College", "Forsyth Tech", "Winston-Salem", "Forsyth & Stokes Counties, NC"], ["Davidson-Davie Community College", "Davidson-Davie CC", "Thomasville", "Davidson & Davie Counties, NC"], ["Beaufort County Community College", "Beaufort County CC", "Washington", "Beaufort, Hyde, Tyrrell & Washington Counties, NC"]].map(([name, short, city, area]): InstitutionDef => ({
    name, short, kind: "Community college", city, serviceArea: area, families: [
      { name: "Electrical Systems Technology", ...ELECTRICIAN, description: "Electrical Systems Technology AAS." + (/Davidson|Beaufort/.test(name) ? " (Program assumed from the inventory list — confirm.)" : ""), goals: goals(20), programs: [{ name: "Electrical Systems Technology", type: "Traditional Full Time", credential: "AAS", terms: electricalTerms, launch: "FALL", seats: 24, months: 3 }] },
    ],
  })),
  { name: "College of The Albemarle", short: "COA", kind: "Community college", city: "Elizabeth City", serviceArea: "Camden, Chowan, Currituck, Dare, Gates, Pasquotank & Perquimans Counties, NC", families: [
    { name: "Nurse Aide (CNA)", ...NA, description: "Nurse Aide I.", goals: goals(60), programs: [], cna: true },
    { name: "Medical Assisting", ...MA, description: "Medical Assisting diploma / AAS.", goals: goals(20), programs: [{ name: "Medical Assisting", type: "Traditional Full Time", credential: "Diploma", terms: (h) => h.genTerms("MED", 52, 2, true), launch: "FALL", seats: 24, months: 3 }] },
    { name: "Medical Office Administration", ...MOA, description: "Medical Office Administration.", goals: goals(18), programs: [{ name: "Medical Office Administration", type: "Traditional Full Time", credential: "Diploma", terms: medicalOfficeTerms, launch: "FALL", seats: 24, months: 3 }] },
  ] },
  // Roanoke-Chowan's Medical Assisting is the continuing-education MED 3300 from the college's
  // program-structure workbook (prisma/templates/ma-roanoke-chowan.json): 720 hours in two terms —
  // Part 1 in the fall (class and lab, Tue/Thu 5:30–9p plus online, up to 10 students) and Part 2
  // in the spring (class plus a precepted community-health clinical, one student per preceptor).
  // Stated North-Star goal: 9 medical assistants a year fully productive.
  { name: "Roanoke-Chowan Community College", short: "Roanoke-Chowan CC", kind: "Community college", city: "Ahoskie", serviceArea: "Hertford, Bertie, Gates & Northampton Counties, NC", families: [
    { name: "Medical Assisting", ...MA, description: "Medical Assisting (MED 3300 continuing education) from the college's program-structure workbook: 720 hours as Part 1 in the fall (class and lab, Tue/Thu evenings plus online) and Part 2 in the spring (class plus a precepted community-health clinical).", goals: flatGoal(9), programs: [], cnaAll: "roanokeChowan" },
  ] },
  { name: "Craven Community College", short: "Craven CC", kind: "Community college", city: "New Bern", serviceArea: "Craven County, NC", families: [
    { name: "Nurse Aide (CNA)", ...NA, description: "Nurse Aide I.", goals: goals(50), programs: [], cna: true },
  ] },
  // Lenoir's stated North-Star goal: 80 nurse aides a year reaching full productivity. Its Nurse Aide
  // Level I (NAS 3240 continuing ed) runs in the six delivery models of the college's program-structure
  // workbook (prisma/templates/cna-lenoir.json): Monday & Wednesday or Tuesday & Thursday, as a 20-week
  // evening class (5:30–9:30p), an 18-week or a 16-week daytime class (8a–2:30p / 8:30a–3p), each
  // class and lab up to 14 students and clinical groups of ten with an instructor. The college's real
  // cohort schedule — dates, days, times and rooms on campus and at the county centers — is in
  // seed-lenoir.ts, each cohort on the model it matches.
  { name: "Lenoir Community College", short: "Lenoir CC", kind: "Community college", city: "Kinston", serviceArea: "Lenoir, Greene & Jones Counties, NC", families: [
    { name: "Nurse Aide (CNA)", ...NA, description: "Nurse Aide Level I (NAS 3240 continuing education) in six delivery models from the college's program-structure workbook: Monday & Wednesday and Tuesday & Thursday classes run as 20-week evening, 18-week daytime and 16-week daytime offerings — on the Kinston campus and at the La Grange, Jones County and Greene County centers.", goals: flatGoal(80), programs: [], cna: true, cnaAll: "lenoir" },
  ] },
  // Carteret's workbook pack: all six Nurse Aide Level I delivery models from the college's
  // program-structure workbook (NAS 111 curriculum / NAS 3240 continuing ed). Stated goal: 55 a year fully productive.
  { name: "Carteret Community College", short: "Carteret CC", kind: "Community college", city: "Morehead City", serviceArea: "Carteret County, NC", families: [
    { name: "Nurse Aide (CNA)", ...NA, description: "Nurse Aide Level I (NAS 111 curriculum / NAS 3240 continuing education) in six delivery models from the college's program-structure workbook: 5-week and 6-week daytime, 8-week summer evening, 11-week daytime (Fri/Sat) and nighttime, and the 14-week high-school pre-apprenticeship.", goals: flatGoal(55), programs: [], cna: true, cnaAll: "carteret" },
  ] },
];

/** Institutions kept out of the workspace for now (definitions stay above so they can be
 *  switched back on by removing them from this list). */
export const PAUSED_INSTITUTIONS = new Set([
  "Beaufort County Community College", "Davidson-Davie Community College",
  "Forsyth Technical Community College", "James Sprunt Community College", "Pitt Community College",
  "Southeastern Community College", "University of North Carolina Wilmington",
  // Paused while the workspace zeroes in on Sandhills' radiography and surgical technology programs.
  // Carteret and Lenoir (Nurse Aide I) and Roanoke-Chowan (Medical Assisting) are back in with their
  // workbook programs and offerings (see seed.ts).
  "College of The Albemarle", "Craven Community College",
]);

export async function seedInstitutions(prisma: PrismaClient, h: Helpers) {
  let institutions = 0, families = 0, programs = 0;
  for (const def of INSTITUTIONS.filter((d) => !PAUSED_INSTITUTIONS.has(d.name))) {
    const inst = await prisma.institution.create({ data: { name: def.name, shortName: def.short, kind: def.kind, city: def.city, state: "NC", serviceArea: def.serviceArea } });
    institutions++;
    for (const f of def.families) {
      const occ = await prisma.occupation.upsert({ where: { institutionId_socCode: { institutionId: inst.id, socCode: f.soc } }, update: {}, create: { institutionId: inst.id, socCode: f.soc, title: f.occupation } });
      const goalPlan = goalPlanJson(f.goals);
      const fam = await prisma.programFamily.create({ data: { institutionId: inst.id, occupationId: occ.id, name: f.name, description: f.description, goalPlan, clinicalModel: /Nurs/.test(f.name) ? "hours" : "hours" } });
      families++;
      if (f.cnaAll) {
        // Every delivery model in the college's own workbook pack, name for name.
        for (const tpl of h.cnaPacks[f.cnaAll]) { await h.createCnaProgram(inst.id, occ.id, fam.id, tpl); programs++; }
      } else if (f.cna) {
        // The standard Nurse Aide I term (the 6-week day model from Carteret's workbook pack).
        const tpl = h.cnaPacks.carteret.find((t) => /6-Week/i.test(t.name)) ?? h.cnaPacks.carteret[0];
        await h.createCnaProgram(inst.id, occ.id, fam.id, { ...tpl, name: "Nurse Aide I" });
        programs++;
      }
      for (const p of f.programs) {
        if (isPack(p)) {
          // A template pack: the program, its class size, terms, courses and sessions as the file gives them.
          const prog = await h.createPackProgram(h.loadPack(p.pack), { institutionId: inst.id, occupationId: occ.id, familyId: fam.id, launchCadence: "ANNUAL", launchTerms: p.launch, monthsToFullProductivity: p.months ?? 6 });
          await prisma.program.update({ where: { id: prog.id }, data: { inventoryNote: p.note ?? null } });
          programs++;
          continue;
        }
        const prog = await h.createProgram({ institutionId: inst.id, occupationId: occ.id, name: p.name, programType: p.type, credential: p.credential, terms: p.terms(h) });
        await prisma.program.update({ where: { id: prog.id }, data: { familyId: fam.id, launchCadence: "ANNUAL", launchTerms: p.launch, termSlots: "FALL,SPRING,SUMMER", defaultCohortSeats: p.seats, monthsToFullProductivity: p.months ?? 6, inventoryNote: p.note ?? null } });
        programs++;
      }
    }
  }
  return { institutions, families, programs };
}
