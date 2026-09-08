// ─────────────────────────────────────────────────────────────────────────────
// The other institutions in the workspace, each with the programs (delivery
// models) identified for it and a North-Star goal per job. Curricula follow the
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
import type { createProgram, createCnaProgram, genTerms, CnaTemplate, CourseSeed, TermSeed } from "./seed";

type Helpers = { createProgram: typeof createProgram; createCnaProgram: typeof createCnaProgram; genTerms: typeof genTerms; cnaPack: CnaTemplate[] };

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
interface ProgramDef { name: string; type: string; credential: string; terms: (h: Helpers) => TermSeed[]; launch: string; seats: number; months?: number; note?: string }
interface FamilyDef { name: string; soc: string; occupation: string; description: string; goals: Record<number, number>; programs: ProgramDef[]; cna?: boolean }
interface InstitutionDef { name: string; short: string; kind: string; city: string; serviceArea: string; families: FamilyDef[] }

const RN = { soc: "29-1141", occupation: "Registered Nurses" };
const ELECTRICIAN = { soc: "47-2111", occupation: "Electricians" };
const MA = { soc: "31-9092", occupation: "Medical Assistants" };
const MOA = { soc: "43-6013", occupation: "Medical Secretaries and Administrative Assistants" };
const NA = { soc: "31-1131", occupation: "Nursing Assistants" };
const THIS_YEAR = new Date().getUTCFullYear();
/** A flat-then-stairstep North-Star goal starting this year: base, base, +10%, +20%, +20%. */
export const goals = (base: number) => ({ [THIS_YEAR]: base, [THIS_YEAR + 1]: base, [THIS_YEAR + 2]: Math.round(base * 1.1), [THIS_YEAR + 3]: Math.round(base * 1.2), [THIS_YEAR + 4]: Math.round(base * 1.2) });
/** Serialize a goal set the way the goal planner stores it. `goal` is the
 *  family's default talent-pipeline health rates (the ladder every new
 *  launching cohort inherits at lock-in); omit it to use the benchmarks. */
export const goalPlanJson = (g: Record<number, number>, goal?: Record<string, number>) => { const years = Object.keys(g).map(Number).sort(); return JSON.stringify({ anchor: "northstar", years, goalsByYear: Object.fromEntries(Object.entries(g).map(([y, v]) => [String(y), v])), selectedYear: years[1] ?? years[0], ...(goal ? { goal } : {}) }); };

const nursingFamily = (description: string, base: number, programs: ProgramDef[]): FamilyDef => ({ name: "Nursing (prelicensure RN)", ...RN, description, goals: goals(base), programs });
const adn = (entry: "Fall" | "Spring", seats = 40): ProgramDef => ({ name: `ADN — ${entry} Entry`, type: "Traditional Full Time", credential: "AAS", terms: adnTerms, launch: entry.toUpperCase(), seats, months: 6 });
const lpnTransition = (entry: "Fall" | "Spring" | "Summer", note?: string, seats = 20): ProgramDef => ({ name: `LPN-to-ADN Transition — ${entry} Entry`, type: "Transition (LPN)", credential: "AAS", terms: () => transitionTerms(entry, "NUR 214", "Nursing Transition Concepts"), launch: entry.toUpperCase(), seats, months: 6, note });

export const INSTITUTIONS: InstitutionDef[] = [
  { name: "Brunswick Community College", short: "Brunswick CC", kind: "Community college", city: "Bolivia", serviceArea: "Brunswick County, NC", families: [
    nursingFamily("Brunswick's prelicensure RN pathways: the traditional ADN, the LPN-to-ADN transition and the paramedic-to-ADN bridge.", 40, [
      adn("Fall"), lpnTransition("Summer"),
      { name: "Paramedic-to-ADN Bridge — Spring Entry", type: "Bridge (Paramedic)", credential: "AAS", terms: () => transitionTerms("Spring", "NUR 214", "Nursing Transition Concepts (Paramedic)"), launch: "SPRING", seats: 16, months: 6 },
    ]),
  ] },
  { name: "Cape Fear Community College", short: "Cape Fear CC", kind: "Community college", city: "Wilmington", serviceArea: "New Hanover & Pender Counties, NC", families: [
    nursingFamily("Cape Fear's prelicensure RN pathways: two ADN intakes a year plus the LPN-to-ADN transition.", 90, [
      adn("Spring", 48), adn("Fall", 48),
      lpnTransition("Fall", "Confirm: the website currently shows two application windows — one cohort or two per year, and which term(s) it starts?"),
    ]),
    { name: "Electrical Systems Technology", ...ELECTRICIAN, description: "Electrical Systems Technology AAS.", goals: goals(24), programs: [{ name: "Electrical Systems Technology", type: "Traditional Full Time", credential: "AAS", terms: electricalTerms, launch: "FALL", seats: 24, months: 3 }] },
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
  ...[["Pitt Community College", "Pitt CC", "Winterville", "Pitt County, NC"], ["Forsyth Technical Community College", "Forsyth Tech", "Winston-Salem", "Forsyth & Stokes Counties, NC"], ["Rowan-Cabarrus Community College", "Rowan-Cabarrus CC", "Salisbury", "Rowan & Cabarrus Counties, NC"], ["Davidson-Davie Community College", "Davidson-Davie CC", "Thomasville", "Davidson & Davie Counties, NC"], ["Beaufort County Community College", "Beaufort County CC", "Washington", "Beaufort, Hyde, Tyrrell & Washington Counties, NC"]].map(([name, short, city, area]): InstitutionDef => ({
    name, short, kind: "Community college", city, serviceArea: area, families: [
      { name: "Electrical Systems Technology", ...ELECTRICIAN, description: "Electrical Systems Technology AAS." + (/Davidson|Beaufort/.test(name) ? " (Program assumed from the inventory list — confirm.)" : ""), goals: goals(20), programs: [{ name: "Electrical Systems Technology", type: "Traditional Full Time", credential: "AAS", terms: electricalTerms, launch: "FALL", seats: 24, months: 3 }] },
    ],
  })),
  { name: "College of The Albemarle", short: "COA", kind: "Community college", city: "Elizabeth City", serviceArea: "Camden, Chowan, Currituck, Dare, Gates, Pasquotank & Perquimans Counties, NC", families: [
    { name: "Nurse Aide (CNA)", ...NA, description: "Nurse Aide I.", goals: goals(60), programs: [], cna: true },
    { name: "Medical Assisting", ...MA, description: "Medical Assisting diploma / AAS.", goals: goals(20), programs: [{ name: "Medical Assisting", type: "Traditional Full Time", credential: "Diploma", terms: (h) => h.genTerms("MED", 52, 2, true), launch: "FALL", seats: 24, months: 3 }] },
    { name: "Medical Office Administration", ...MOA, description: "Medical Office Administration.", goals: goals(18), programs: [{ name: "Medical Office Administration", type: "Traditional Full Time", credential: "Diploma", terms: medicalOfficeTerms, launch: "FALL", seats: 24, months: 3 }] },
  ] },
  { name: "Roanoke-Chowan Community College", short: "Roanoke-Chowan CC", kind: "Community college", city: "Ahoskie", serviceArea: "Hertford, Bertie, Gates & Northampton Counties, NC", families: [
    { name: "Medical Assisting", ...MA, description: "Medical Assisting diploma / AAS.", goals: goals(16), programs: [{ name: "Medical Assisting", type: "Traditional Full Time", credential: "Diploma", terms: (h) => h.genTerms("MED", 52, 2, true), launch: "FALL", seats: 20, months: 3 }] },
  ] },
  ...[["Lenoir Community College", "Lenoir CC", "Kinston", "Lenoir, Greene & Jones Counties, NC"], ["Carteret Community College", "Carteret CC", "Morehead City", "Carteret County, NC"], ["Craven Community College", "Craven CC", "New Bern", "Craven County, NC"]].map(([name, short, city, area]): InstitutionDef => ({
    name, short, kind: "Community college", city, serviceArea: area, families: [{ name: "Nurse Aide (CNA)", ...NA, description: "Nurse Aide I.", goals: goals(50), programs: [], cna: true }],
  })),
];

export async function seedInstitutions(prisma: PrismaClient, h: Helpers) {
  let institutions = 0, families = 0, programs = 0;
  for (const def of INSTITUTIONS) {
    const inst = await prisma.institution.create({ data: { name: def.name, shortName: def.short, kind: def.kind, city: def.city, state: "NC", serviceArea: def.serviceArea } });
    institutions++;
    for (const f of def.families) {
      const occ = await prisma.occupation.upsert({ where: { institutionId_socCode: { institutionId: inst.id, socCode: f.soc } }, update: {}, create: { institutionId: inst.id, socCode: f.soc, title: f.occupation } });
      const goalPlan = goalPlanJson(f.goals);
      const fam = await prisma.programFamily.create({ data: { institutionId: inst.id, occupationId: occ.id, name: f.name, description: f.description, goalPlan, clinicalModel: /Nurs/.test(f.name) ? "hours" : "hours" } });
      families++;
      if (f.cna) {
        // The standard Nurse Aide I term (the 6-week day model from the CNA workbook pack).
        const tpl = h.cnaPack.find((t) => /6-Week/i.test(t.name)) ?? h.cnaPack[0];
        await h.createCnaProgram(inst.id, occ.id, fam.id, { ...tpl, name: "Nurse Aide I" });
        programs++;
      }
      for (const p of f.programs) {
        const prog = await h.createProgram({ institutionId: inst.id, occupationId: occ.id, name: p.name, programType: p.type, credential: p.credential, terms: p.terms(h) });
        await prisma.program.update({ where: { id: prog.id }, data: { familyId: fam.id, launchCadence: "ANNUAL", launchTerms: p.launch, termSlots: "FALL,SPRING,SUMMER", defaultCohortSeats: p.seats, monthsToFullProductivity: p.months ?? 6, inventoryNote: p.note ?? null } });
        programs++;
      }
    }
  }
  return { institutions, families, programs };
}
