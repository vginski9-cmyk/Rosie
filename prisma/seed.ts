/**
 * Rosie seed.
 *
 * Loads a faithful slice of the real artifacts the user provided:
 *  - Sandhills Community College: Radiography (SOC 29-2034) and Surgical
 *    Technology (SOC 29-2055) programs, with talent-pipeline funnels (target vs
 *    actual) and North Star goals taken from the pilot deck.
 *  - Cape Fear Community College: Electrical Systems Technology, demonstrating
 *    multi-institution tenancy and labor-market demand.
 *  - 190 real academic calendar blocks (16/14/12/8/5-week sessions w/ holiday-
 *    adjusted teachable weekdays) imported from the Cape Fear workbook.
 *
 * Course/session structures are realistic archetypes (one student's required
 * experience) so the capacity engine produces meaningful section/FTE/WBL output.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();

type SessionSeed = {
  kind: "CLASS" | "LAB" | "CLINICAL";
  count: number;
  lengthHours: number;
  maxStudents: number;
  facultyNeeded: number;
  supportStaffNeeded?: number;
  preceptorsNeeded?: number;
  title: string;
  location?: string;
  rotationType?: string;
  clinicalMode?: string;
};

type CourseSeed = {
  code: string;
  name: string;
  weeklyClassHours: number;
  weeklyLabHours: number;
  weeklyClinicalHours: number;
  sessions?: SessionSeed[]; // optional — auto-generated from hours when omitted
  // Catalog metadata
  credits?: number;
  semester?: string; // Fall | Spring | Summer | All
  type?: string; // CORE | GENED | SUPPORT
  description?: string;
  requisites?: string;
};

type TermSeed = { index: number; name: string; startWeek: number; endWeek: number; courses: CourseSeed[] };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const CLINICAL_ROTATIONS = ["General Radiography", "Fluoroscopy", "Mobile / Surgery", "Trauma / ER", "Computed Tomography", "Pediatrics", "Outpatient Imaging"];

function buildSessions(s: SessionSeed) {
  return Array.from({ length: s.count }, (_, i) => ({
    kind: s.kind,
    number: i + 1,
    title: `${s.title} ${i + 1}`,
    lengthHours: s.lengthHours,
    maxStudents: s.maxStudents,
    facultyNeeded: s.facultyNeeded,
    supportStaffNeeded: s.supportStaffNeeded ?? 0,
    preceptorsNeeded: s.preceptorsNeeded ?? 0,
    week: i + 1,
    location: s.location ?? null,
    rotationType: s.rotationType ?? null,
    clinicalMode: s.clinicalMode ?? null,
  }));
}

/** Auto-generate realistic session-by-session rows from a course's catalog hours. */
function genSessions(c: CourseSeed, weeks: number) {
  const rows: ReturnType<typeof buildSessions> = [];
  const short = c.code.replace(/[^A-Z0-9]/gi, "");
  if (c.weeklyClassHours > 0) {
    for (let i = 0; i < weeks; i++) {
      rows.push({ kind: "CLASS", number: i + 1, title: `${short} Lecture — Week ${i + 1}`, lengthHours: c.weeklyClassHours, maxStudents: 24, facultyNeeded: 1, supportStaffNeeded: 0, preceptorsNeeded: 0, week: i + 1, dayOfWeek: "Mon", location: "Classroom", rotationType: null, clinicalMode: null } as any);
    }
  }
  if (c.weeklyLabHours > 0) {
    for (let i = 0; i < weeks; i++) {
      rows.push({ kind: "LAB", number: i + 1, title: `${short} Lab — Week ${i + 1}`, lengthHours: c.weeklyLabHours, maxStudents: 12, facultyNeeded: 2, supportStaffNeeded: 0, preceptorsNeeded: 0, week: i + 1, dayOfWeek: "Wed", location: "Energized Radiography Lab", rotationType: null, clinicalMode: null } as any);
    }
  }
  if (c.weeklyClinicalHours > 0) {
    const clinWeeks = Math.min(weeks, 15);
    for (let i = 0; i < clinWeeks; i++) {
      rows.push({ kind: "CLINICAL", number: i + 1, title: `Clinical Rotation — Week ${i + 1}`, lengthHours: 8, maxStudents: 8, facultyNeeded: 0, supportStaffNeeded: 0, preceptorsNeeded: 1, week: i + 1, dayOfWeek: DAYS[i % 5], location: "Affiliated Clinical Site", rotationType: CLINICAL_ROTATIONS[i % CLINICAL_ROTATIONS.length], clinicalMode: "Preceptor-led" } as any);
    }
  }
  return rows;
}

// --- Radiography (A.A.S. — A45110) full curriculum, real catalog data --------
const c = (
  code: string, name: string, classH: number, labH: number, clinH: number,
  credits: number, semester: string, type: string, description: string, requisites: string,
): CourseSeed => ({ code, name, weeklyClassHours: classH, weeklyLabHours: labH, weeklyClinicalHours: clinH, credits, semester, type, description, requisites });

const radTerms: TermSeed[] = [
  {
    index: 1, name: "First Fall", startWeek: 1, endWeek: 16,
    courses: [
      c("BIO-163", "Basic Anatomy & Physiology", 4, 2, 0, 5, "All", "SUPPORT", "A basic study of the structure and function of the human body. Topics include the body systems, homeostasis, cells, tissues, nutrition, acid-base balance, and electrolytes.", "Take one: ENG-002, BSP-4002, ENG-025, or ENG-8025 (Required, Previous)."),
      c("ENG-111", "Writing and Inquiry", 3, 0, 0, 3, "All", "GENED", "Develops the ability to produce clear writing in a variety of genres and formats using a recursive process. Emphasis on inquiry, analysis, rhetorical strategies, thesis development, audience awareness, and revision.", "Take one: DRE-097, ENG-002, BSP-4002, ENG-025, or ENG-8025 (Required, Previous)."),
      c("RAD-110", "Radiography Introduction & Patient Care", 2, 3, 0, 3, "Fall", "CORE", "Overview of the radiography profession and student responsibilities. Emphasis on basic principles of patient care, radiation protection, technical factors, and medical terminology.", "Enrollment in the Radiography Program (Required, Previous). Take RAD-111, RAD-151 (Previous or Concurrent)."),
      c("RAD-111", "RAD Procedures I", 3, 3, 0, 4, "Fall", "CORE", "Knowledge and skills necessary to perform standard radiographic procedures. Emphasis on radiography of the chest, abdomen, extremities, bony thorax and pelvis.", "Enrollment in the Radiography Program (Required, Previous). Take RAD-110, RAD-151 (Previous or Concurrent)."),
      c("RAD-151", "RAD Clinical Ed I", 0, 0, 6, 2, "Fall", "CORE", "Introduces patient management and basic radiographic procedures in the clinical setting. Emphasis on mastering positioning of the chest and extremities, manipulating equipment, and applying the principles of ALARA.", "Enrollment in the Radiography Program (Required, Previous). Take RAD-110, RAD-111 (Previous or Concurrent)."),
    ],
  },
  {
    index: 2, name: "First Spring", startWeek: 1, endWeek: 16,
    courses: [
      c("COM-120", "Introduction to Interpersonal Communication", 3, 0, 0, 3, "All", "GENED", "Introduces the practices and principles of interpersonal communication in dyadic and group settings. Emphasis on the communication process, perception, listening, self-disclosure, nonverbal communication, conflict, and power.", ""),
      c("MAT-143", "Quantitative Literacy", 2, 2, 0, 3, "All", "GENED", "Engages students in complex, realistic situations involving quantity, change and relationship, and uncertainty through project- and activity-based assessment. Emphasis on numeracy, proportional reasoning, and consumer statistics.", "See catalog placement requirements (Required, Previous)."),
      c("RAD-112", "RAD Procedures II", 3, 3, 0, 4, "Spring", "CORE", "Knowledge and skills necessary to perform standard radiographic procedures. Emphasis on radiography of the skull, spine, and the gastrointestinal, biliary, and urinary systems.", "Take RAD-110, RAD-111, RAD-151 (Required, Previous). Take RAD-121, RAD-161 (Previous or Concurrent)."),
      c("RAD-121", "Image Production I", 2, 3, 0, 3, "Spring", "CORE", "Basic principles of radiographic image production. Emphasis on image production, x-ray equipment, receptor exposure, and basic imaging quality factors.", "Take RAD-110, RAD-111, RAD-151 (Required, Previous). Take RAD-112, RAD-161 (Previous or Concurrent)."),
      c("RAD-161", "RAD Clinical Ed II", 0, 0, 15, 5, "Spring", "CORE", "Additional experience in patient management and in more complex radiographic procedures. Emphasis on mastering positioning of the spine, pelvis, head and neck, and thorax and adapting to patient variations.", "Take RAD-110, RAD-111, RAD-151 (Required, Previous). Take RAD-112, RAD-121 (Previous or Concurrent)."),
    ],
  },
  {
    index: 3, name: "First Summer", startWeek: 1, endWeek: 10,
    courses: [
      c("RAD-122", "Image Production II", 1, 3, 0, 2, "Summer", "CORE", "Continues to develop the concepts and principles of radiologic technology. Emphasis on advanced digital principles and production.", "Take RAD-112, RAD-121, RAD-161 (Required, Previous). Take RAD-141, RAD-171 (Previous or Concurrent)."),
      c("RAD-141", "Radiation Safety", 2, 0, 0, 2, "Summer", "CORE", "Principles of radiation protection and radiobiology. Topics include the effects of ionizing radiation on body tissues, protective measures for limiting exposure, and radiation monitoring devices.", "Take RAD-112, RAD-121, RAD-161 (Required, Previous). Take RAD-122, RAD-171 (Previous or Concurrent)."),
      c("RAD-171", "RAD Clinical Ed III", 0, 0, 9, 3, "Summer", "CORE", "Experience in patient management specific to advanced radiographic procedures. Emphasis on applying appropriate technical factors and mastering positioning of advanced studies.", "Take RAD-112, RAD-121, RAD-161 (Required, Previous). Take RAD-122, RAD-141 (Previous or Concurrent)."),
    ],
  },
  {
    index: 4, name: "Second Fall", startWeek: 1, endWeek: 16,
    courses: [
      c("PSY-150", "General Psychology", 3, 0, 0, 3, "All", "GENED", "Overview of the scientific study of human behavior. Topics include history, methodology, biopsychology, sensation, perception, learning, motivation, cognition, abnormal behavior, and personality theory.", "Take one: ENG-002, BSP-4002, ENG-025, ENG-8025, or ENG-111 (Required, Previous)."),
      c("RAD-211", "RAD Procedures III", 2, 3, 0, 3, "Fall", "CORE", "Knowledge and skills necessary to perform standard and specialty radiographic procedures. Emphasis on specialty procedures, advanced imaging, radiographic pathology, and image analysis.", "Take RAD-122, RAD-141, RAD-171 (Required, Previous). Take RAD-231, RAD-251 (Previous or Concurrent)."),
      c("RAD-231", "Image Production III", 1, 3, 0, 2, "Fall", "CORE", "Continues to develop image-production concepts. Emphasis on complex imaging production and principles, quality control, and quality assurance in the imaging sciences.", "Take RAD-122, RAD-141, RAD-171 (Required, Previous). Take RAD-211, RAD-251 (Previous or Concurrent)."),
      c("RAD-251", "RAD Clinical Ed IV", 0, 0, 21, 7, "Fall", "CORE", "Continue mastering all basic radiographic procedures and attain experience in advanced areas. Emphasis on equipment operation, pathological recognition, pediatric and geriatric variations, and radiation protection.", "Take RAD-122, RAD-141, RAD-171 (Required, Previous). Take RAD-211, RAD-231 (Previous or Concurrent)."),
    ],
  },
  {
    index: 5, name: "Second Spring", startWeek: 1, endWeek: 16,
    courses: [
      c("HUM-115", "Critical Thinking", 3, 0, 0, 3, "All", "GENED", "Introduces the use of critical thinking skills in the context of human conflict. Emphasis on evaluating information, problem solving, cross-cultural perspectives, and resolving controversies and dilemmas.", "Take one: DRE-097, ENG-002, BSP-4002, ENG-025, ENG-8025, or ENG-111 (Required, Previous)."),
      c("RAD-261", "RAD Clinical Ed V", 0, 0, 21, 7, "Spring", "CORE", "Enhances expertise in all radiographic procedures, patient management, radiation protection, and image production and evaluation. Emphasis on an autonomous approach to diverse clinical situations.", "Take RAD-251 (Required, Previous). Take RAD-271 (Previous or Concurrent)."),
      c("RAD-271", "Radiography Capstone", 2, 3, 0, 3, "Spring", "CORE", "Opportunity to exhibit the problem-solving skills required for certification. Emphasis on critical thinking and integration of didactic and clinical components.", "Take RAD-211, RAD-231, RAD-251 (Required, Previous). Take RAD-261 (Previous or Concurrent)."),
    ],
  },
];

// --- Surgical Technology archetype (minimal, 3 semesters) ------------------
const surgTerms: TermSeed[] = [
  {
    index: 1,
    name: "Term 1 — Fall",
    startWeek: 1,
    endWeek: 16,
    courses: [
      {
        code: "SUR-110",
        name: "Intro to Surgical Technology",
        weeklyClassHours: 4,
        weeklyLabHours: 4,
        weeklyClinicalHours: 0,
        sessions: [
          { kind: "CLASS", count: 16, lengthHours: 4, maxStudents: 24, facultyNeeded: 1, title: "Lecture", location: "Classroom" },
          { kind: "LAB", count: 16, lengthHours: 4, maxStudents: 12, facultyNeeded: 2, title: "Surgical Skills Lab", location: "Mock OR" },
        ],
      },
    ],
  },
  {
    index: 2,
    name: "Term 2 — Spring",
    startWeek: 1,
    endWeek: 16,
    courses: [
      {
        code: "SUR-137",
        name: "Surgical Clinical I",
        weeklyClassHours: 0,
        weeklyLabHours: 0,
        weeklyClinicalHours: 24,
        sessions: [{ kind: "CLINICAL", count: 15, lengthHours: 8, maxStudents: 2, facultyNeeded: 0, preceptorsNeeded: 1, title: "OR Rotation", location: "Hospital OR", rotationType: "Operating Room", clinicalMode: "Preceptor-led" }],
      },
    ],
  },
  {
    index: 3,
    name: "Term 3 — Summer",
    startWeek: 1,
    endWeek: 10,
    courses: [
      {
        code: "SUR-237",
        name: "Surgical Clinical II / Capstone",
        weeklyClassHours: 2,
        weeklyLabHours: 0,
        weeklyClinicalHours: 32,
        sessions: [
          { kind: "CLASS", count: 10, lengthHours: 2, maxStudents: 24, facultyNeeded: 1, title: "Registry Review", location: "Classroom" },
          { kind: "CLINICAL", count: 18, lengthHours: 8, maxStudents: 2, facultyNeeded: 0, preceptorsNeeded: 1, title: "OR Rotation", location: "Hospital OR", rotationType: "Operating Room", clinicalMode: "Preceptor-led" },
        ],
      },
    ],
  },
];

async function createProgram(opts: {
  institutionId: string;
  occupationId: string;
  name: string;
  programType: string;
  credential: string;
  terms: TermSeed[];
}) {
  const program = await prisma.program.create({
    data: {
      institutionId: opts.institutionId,
      occupationId: opts.occupationId,
      name: opts.name,
      programType: opts.programType,
      credential: opts.credential,
      monthsToFullProductivity: 6,
      status: "active",
    },
  });

  for (const t of opts.terms) {
    const term = await prisma.term.create({
      data: { programId: program.id, index: t.index, name: t.name, startWeek: t.startWeek, endWeek: t.endWeek },
    });
    const weeks = (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1;
    let order = 0;
    for (const c of t.courses) {
      const sessions = c.sessions ? c.sessions.flatMap(buildSessions) : genSessions(c, weeks);
      await prisma.course.create({
        data: {
          termId: term.id,
          code: c.code,
          name: c.name,
          sequenceOrder: order++,
          weeklyClassHours: c.weeklyClassHours,
          weeklyLabHours: c.weeklyLabHours,
          weeklyClinicalHours: c.weeklyClinicalHours,
          creditHours: c.credits ?? null,
          semesterOffered: c.semester ?? null,
          courseType: c.type ?? null,
          description: c.description ?? null,
          requisites: c.requisites ?? null,
          sessions: { create: sessions },
        },
      });
    }
  }
  return program;
}

async function createFunnel(programId: string, name: string, entryYear: number, data: Record<string, { target?: number; actual?: number }>) {
  const cohort = await prisma.cohort.create({ data: { programId, name, entryYear } });
  const stageMeta: { key: string; label: string }[] = [
    { key: "interested", label: "Interested candidates" },
    { key: "qualified", label: "Qualified applicants" },
    { key: "offered", label: "Offered admission" },
    { key: "enrolled", label: "Enrolled (Term 1)" },
    { key: "completing", label: "Completing on time" },
    { key: "licensed", label: "Passing licensure (1st)" },
    { key: "placed", label: "Retained & placed regionally" },
    { key: "productive", label: "Fully productive in region" },
  ];
  await prisma.funnelStage.createMany({
    data: stageMeta.map((s, i) => ({
      cohortId: cohort.id,
      stageKey: s.key,
      sortOrder: i,
      label: s.label,
      targetNumber: data[s.key]?.target ?? null,
      actualNumber: data[s.key]?.actual ?? null,
    })),
  });
  return cohort;
}

async function main() {
  console.log("Resetting data…");
  // Order matters for FK cleanup on SQLite.
  await prisma.funnelStage.deleteMany();
  await prisma.cohort.deleteMany();
  await prisma.session.deleteMany();
  await prisma.course.deleteMany();
  await prisma.term.deleteMany();
  await prisma.programYearTarget.deleteMany();
  await prisma.program.deleteMany();
  await prisma.demandProjection.deleteMany();
  await prisma.region.deleteMany();
  await prisma.occupation.deleteMany();
  await prisma.person.deleteMany();
  await prisma.employer.deleteMany();
  await prisma.calendarBlock.deleteMany();
  await prisma.institution.deleteMany();

  // ----- Sandhills Community College --------------------------------------
  const sandhills = await prisma.institution.create({
    data: { name: "Sandhills Community College", shortName: "Sandhills CC", serviceArea: "Moore & Hoke Counties, NC (Sandhills region)" },
  });

  const radOcc = await prisma.occupation.create({
    data: { institutionId: sandhills.id, socCode: "29-2034", title: "Radiologic Technologists" },
  });
  const surgOcc = await prisma.occupation.create({
    data: { institutionId: sandhills.id, socCode: "29-2055", title: "Surgical Technologists" },
  });

  // Regions (nested geographies from the demand briefing)
  const regionDefs = [
    { name: "United States", kind: "NATIONAL", sortOrder: 0 },
    { name: "North Carolina", kind: "STATE", sortOrder: 1 },
    { name: "60-min Radius", kind: "RADIUS_60", sortOrder: 2 },
    { name: "45-min Radius", kind: "RADIUS_45", sortOrder: 3 },
    { name: "Service Area", kind: "SERVICE_AREA", sortOrder: 4 },
    { name: "Pinehurst MSA", kind: "MSA", sortOrder: 5 },
  ];
  const regions: Record<string, string> = {};
  for (const r of regionDefs) {
    const rec = await prisma.region.create({ data: { institutionId: sandhills.id, ...r } });
    regions[r.kind] = rec.id;
  }

  // Demand — Radiologic Tech (from deck slide 3, annual openings 2025→2036)
  const radServiceAreaOpenings: Record<number, number> = { 2025: 14, 2026: 14, 2027: 13, 2028: 12, 2029: 11, 2030: 12, 2031: 12, 2032: 12, 2033: 11, 2034: 11 };
  const radServiceAreaJobs = 186;
  for (const [yearStr, openings] of Object.entries(radServiceAreaOpenings)) {
    await prisma.demandProjection.create({
      data: {
        institutionId: sandhills.id,
        occupationId: radOcc.id,
        regionId: regions["SERVICE_AREA"],
        year: Number(yearStr),
        jobs: radServiceAreaJobs,
        openings,
        growthPct: 0.17,
        replacementPct: 0.83,
        turnoverPct: 0.233,
      },
    });
  }
  // A national anchor row for context
  await prisma.demandProjection.create({
    data: { institutionId: sandhills.id, occupationId: radOcc.id, regionId: regions["NATIONAL"], year: 2026, jobs: 279521, openings: 18357, growthPct: 0.12, replacementPct: 0.88, turnoverPct: 0.294 },
  });
  // Surgical Tech service-area demand (deck: ~14 productive/yr needed)
  for (const y of [2025, 2026, 2027, 2028, 2029, 2030]) {
    await prisma.demandProjection.create({
      data: { institutionId: sandhills.id, occupationId: surgOcc.id, regionId: regions["SERVICE_AREA"], year: y, jobs: 95, openings: 14, growthPct: 0.1, replacementPct: 0.9, turnoverPct: 0.5 },
    });
  }

  // Programs
  const rad = await createProgram({ institutionId: sandhills.id, occupationId: radOcc.id, name: "Radiography", programType: "Traditional Full Time", credential: "AAS", terms: radTerms });
  const surg = await createProgram({ institutionId: sandhills.id, occupationId: surgOcc.id, name: "Surgical Technology", programType: "Traditional Full Time", credential: "Diploma", terms: surgTerms });

  // Launch cadences: Radiography launches Fall + Spring each year (many cohorts
  // in flight at once); Surgical Tech launches biennially.
  await prisma.program.update({ where: { id: rad.id }, data: { launchCadence: "MULTI_PER_YEAR", launchTerms: "FALL,SPRING", termSlots: "FALL,SPRING,SUMMER", defaultCohortSeats: 41 } });
  await prisma.program.update({ where: { id: surg.id }, data: { launchCadence: "BIENNIAL", launchTerms: "FALL", launchIntervalYears: 2, termSlots: "FALL,SPRING,SUMMER", defaultCohortSeats: 19 } });

  // North Star year targets (29 rad-techs/yr; cohort capacity 41 to hit it)
  for (const y of [2026, 2027, 2028, 2029, 2030]) {
    await prisma.programYearTarget.create({ data: { programId: rad.id, year: y, credentialTarget: 29, cohortCapacity: 41 } });
    await prisma.programYearTarget.create({ data: { programId: surg.id, year: y, credentialTarget: 14, cohortCapacity: 19 } });
  }

  // Funnels (target vs ballpark actual from the deck)
  await createFunnel(rad.id, "Class of 2029", 2029, {
    interested: { target: 83, actual: 199 }, // strong top-of-funnel (199 declared pre-Rad)
    qualified: { target: 62, actual: 39 }, // leak: only 39 qualified last cohort
    offered: { target: 52, actual: 26 },
    enrolled: { target: 41, actual: 15 }, // today 15 enroll; North Star needs 41
    completing: { target: 36, actual: 13 },
    licensed: { target: 32, actual: 12 },
    placed: { target: 29, actual: 12 },
    productive: { target: 29, actual: 12 },
  });
  await createFunnel(surg.id, "Class of 2029", 2029, {
    interested: { target: 39, actual: 31 },
    qualified: { target: 29 },
    offered: { target: 24 },
    enrolled: { target: 19, actual: 8 }, // enrollment dropped from 18–19 to 8
    completing: { target: 16, actual: 6 },
    licensed: { target: 15, actual: 6 },
    placed: { target: 14, actual: 6 },
    productive: { target: 14, actual: 6 },
  });

  // Employers & people (clinical partners + staff)
  const firstHealth = await prisma.employer.create({ data: { institutionId: sandhills.id, name: "FirstHealth Moore Regional Hospital", setting: "Acute-care Hospital / Health System", wblSlots: 12, notes: "Primary imaging & OR clinical site" } });
  await prisma.employer.create({ data: { institutionId: sandhills.id, name: "Pinehurst Surgical Clinic", setting: "Ambulatory Surgical Center", wblSlots: 4 } });
  // A night-only imaging center: real slots, but NOT alignment-feasible for a
  // cohort that needs daytime hours — so loop 2 excludes it from placement.
  const nightCenter = await prisma.employer.create({ data: { institutionId: sandhills.id, name: "Night Imaging Center", setting: "Outpatient Imaging Center", wblSlots: 6, notes: "Evening/overnight rotations only" } });
  await prisma.person.create({ data: { institutionId: sandhills.id, name: "Lindsey (Program Lead)", role: "coordinator", email: "lead@sandhills.edu" } });
  await prisma.person.create({ data: { institutionId: sandhills.id, name: "Radiography Faculty 1", role: "instructor" } });
  await prisma.person.create({ data: { institutionId: sandhills.id, name: "Clinical Preceptor — Imaging", role: "preceptor", employerId: firstHealth.id } });

  // ----- Cape Fear Community College (multi-tenant demo) -------------------
  const capeFear = await prisma.institution.create({
    data: { name: "Cape Fear Community College", shortName: "Cape Fear CC", serviceArea: "New Hanover County, NC" },
  });
  const elecOcc = await prisma.occupation.create({ data: { institutionId: capeFear.id, socCode: "47-2111", title: "Electricians" } });
  const cfServiceArea = await prisma.region.create({ data: { institutionId: capeFear.id, name: "Service Area", kind: "SERVICE_AREA", sortOrder: 0 } });
  const cfNational = await prisma.region.create({ data: { institutionId: capeFear.id, name: "United States", kind: "NATIONAL", sortOrder: 1 } });
  const elecOpenings: Record<number, number> = { 2025: 117, 2026: 115, 2027: 111, 2028: 111, 2029: 109, 2030: 113 };
  for (const [y, o] of Object.entries(elecOpenings)) {
    await prisma.demandProjection.create({ data: { institutionId: capeFear.id, occupationId: elecOcc.id, regionId: cfServiceArea.id, year: Number(y), jobs: 1200, openings: o } });
  }
  await prisma.demandProjection.create({ data: { institutionId: capeFear.id, occupationId: elecOcc.id, regionId: cfNational.id, year: 2026, jobs: 108427, openings: 84000 } });

  const elec = await createProgram({
    institutionId: capeFear.id,
    occupationId: elecOcc.id,
    name: "Electrical Systems Technology",
    programType: "Traditional Full Time",
    credential: "AAS",
    terms: [
      {
        index: 1,
        name: "Term 1",
        startWeek: 1,
        endWeek: 16,
        courses: [
          { code: "ELC-113", name: "Basic Wiring", weeklyClassHours: 3, weeklyLabHours: 6, weeklyClinicalHours: 0, sessions: [
            { kind: "CLASS", count: 16, lengthHours: 3, maxStudents: 24, facultyNeeded: 1, title: "Lecture", location: "Classroom" },
            { kind: "LAB", count: 16, lengthHours: 6, maxStudents: 16, facultyNeeded: 1, title: "Wiring Lab", location: "Electrical lab" },
          ] },
        ],
      },
    ],
  });
  // Cape Fear credential targets (25 → 90 ramp from the workbook)
  const elecTargets: Record<number, number> = { 2025: 25, 2026: 25, 2027: 40, 2028: 50, 2029: 70, 2030: 90 };
  for (const [y, t] of Object.entries(elecTargets)) {
    await prisma.programYearTarget.create({ data: { programId: elec.id, year: Number(y), credentialTarget: t, cohortCapacity: t * 1.2 } });
  }

  // ----- Calendar blocks (190 real blocks) shared across both -------------
  let blocks: any[] = [];
  try {
    blocks = JSON.parse(readFileSync(join(__dirname, "seed-data", "calendar_blocks.json"), "utf-8"));
  } catch {
    console.warn("calendar_blocks.json not found — skipping calendar import");
  }
  for (const inst of [sandhills, capeFear]) {
    if (!blocks.length) break;
    await prisma.calendarBlock.createMany({
      data: blocks.map((b) => ({
        institutionId: inst.id,
        blockKey: b.blockKey,
        termKey: b.termKey ?? null,
        academicYear: b.academicYear ?? null,
        termCode: b.termCode ?? null,
        name: b.blockName ?? b.blockKey,
        startDate: b.startDate ? new Date(b.startDate) : null,
        endDate: b.endDate ? new Date(b.endDate) : null,
        lengthWeeks: b.lengthWeeks ?? null,
        lengthDays: b.lengthDays ?? null,
        nonHolidayMon: b.mon ?? null,
        nonHolidayTue: b.tue ?? null,
        nonHolidayWed: b.wed ?? null,
        nonHolidayThu: b.thu ?? null,
        nonHolidayFri: b.fri ?? null,
      })),
    });
  }

  // ----- KSA / proficiency framework --------------------------------------
  // Shared 5-level scale (institution-wide), comparable across all skills.
  const scaleLevels = [
    { level: 1, label: "Awareness", summary: "Knows the concept exists; can describe it at a high level." },
    { level: 2, label: "Foundational", summary: "Can apply with guidance in routine, low-complexity situations." },
    { level: 3, label: "Proficient", summary: "Performs independently in typical situations to standard." },
    { level: 4, label: "Advanced", summary: "Handles complex/non-routine cases; adapts approach." },
    { level: 5, label: "Expert", summary: "Sets standards, optimizes, and mentors others." },
  ];
  const sandhillsScale = await prisma.proficiencyScale.create({
    data: {
      institutionId: sandhills.id,
      name: "Rosie Standard Proficiency Scale",
      isDefault: true,
      levels: { create: scaleLevels },
    },
  });
  await prisma.proficiencyScale.create({
    data: { institutionId: capeFear.id, name: "Rosie Standard Proficiency Scale", isDefault: true, levels: { create: scaleLevels } },
  });
  void sandhillsScale;

  async function makeSkill(opts: {
    name: string;
    type: string;
    category: string;
    definition: string;
    howUsed: string;
    descriptors: { level: number; descriptor: string }[];
  }) {
    return prisma.skill.create({
      data: {
        institutionId: sandhills.id,
        name: opts.name,
        type: opts.type,
        category: opts.category,
        definition: opts.definition,
        howUsed: opts.howUsed,
        descriptors: { create: opts.descriptors },
      },
    });
  }

  // The user's exact example skill.
  const agile = await makeSkill({
    name: "Agile Methodology",
    type: "SKILL",
    category: "Professional",
    definition:
      "Agile Methodology is a project management approach that emphasizes incremental development, flexibility, collaboration, and continual improvement. It involves breaking down projects into smaller units or iterations and adapting to changing requirements and feedback.",
    howUsed:
      "As a Product Manager, Agile Methodology is utilized to oversee the development of products in a dynamic environment. Product Managers work closely with cross-functional teams to prioritize tasks, gather feedback, and deliver value to customers incrementally.",
    descriptors: [
      { level: 1, descriptor: "Understands the basic principles of Agile Methodology, such as iterative development and collaboration. May have limited experience applying Agile practices in real-world projects." },
      { level: 2, descriptor: "Can effectively implement Agile practices in product development. Possesses a deeper understanding of frameworks such as Scrum or Kanban, and can adapt Agile processes to suit different project needs." },
      { level: 3, descriptor: "Expert in Agile Methodology. Extensive experience leading Agile teams, optimizing workflows, and driving continuous improvement; mentors others and leads organizational Agile transformations." },
    ],
  });

  const positioning = await makeSkill({
    name: "Radiographic Positioning",
    type: "SKILL",
    category: "Clinical",
    definition: "The accurate positioning of patients and equipment to produce diagnostic-quality radiographic images while minimizing repeat exposures.",
    howUsed: "Radiologic technologists position patients for routine and trauma exams across body regions, adapting standard projections to patient condition and clinical question.",
    descriptors: [
      { level: 2, descriptor: "Performs basic routine projections (chest, extremity) under supervision with correct alignment." },
      { level: 3, descriptor: "Independently positions for the full range of routine exams to diagnostic standard." },
      { level: 4, descriptor: "Adapts positioning for trauma, pediatric, and non-routine cases without repeat exposures." },
    ],
  });
  const patientCare = await makeSkill({
    name: "Patient Care & Safety",
    type: "ABILITY",
    category: "Clinical",
    definition: "Providing safe, ethical, patient-centered care including communication, transfer, monitoring, and emergency response in the imaging setting.",
    howUsed: "Technologists assess patient status, ensure safe transfers and immobilization, and respond to contrast reactions or emergencies during exams.",
    descriptors: [
      { level: 2, descriptor: "Demonstrates basic patient communication and safe transfer technique with guidance." },
      { level: 3, descriptor: "Independently manages routine patient care, monitoring, and safety throughout an exam." },
      { level: 4, descriptor: "Leads care in high-acuity/emergency situations and coordinates with the care team." },
    ],
  });
  const radSafety = await makeSkill({
    name: "Radiation Safety & Protection",
    type: "KNOWLEDGE",
    category: "Clinical",
    definition: "Applying ALARA principles and regulatory requirements to minimize radiation dose to patients, staff, and the public.",
    howUsed: "Technologists select exposure factors, apply shielding and collimation, and monitor dose to keep exposures as low as reasonably achievable.",
    descriptors: [
      { level: 2, descriptor: "States ALARA principles and applies basic shielding/collimation with guidance." },
      { level: 3, descriptor: "Independently optimizes technique and protection for routine exams within regulation." },
    ],
  });
  const imageEval = await makeSkill({
    name: "Image Evaluation & Critique",
    type: "SKILL",
    category: "Clinical",
    definition: "Evaluating radiographic images for diagnostic quality and determining whether repeat or additional imaging is required.",
    howUsed: "Technologists critique their own images for positioning, exposure, and artifacts before submitting for interpretation.",
    descriptors: [
      { level: 3, descriptor: "Reliably judges routine images for diagnostic quality and identifies common faults." },
      { level: 4, descriptor: "Critiques complex/non-routine images and prescribes corrective action." },
    ],
  });

  // Graduate proficiency BENCHMARKS for Radiography (a mix that yields MET /
  // BELOW / NOT_TAUGHT so coverage analytics are meaningful).
  const programSkillTargets: { skill: { id: string }; targetLevel: number; priority: string }[] = [
    { skill: positioning, targetLevel: 4, priority: "core" },
    { skill: patientCare, targetLevel: 4, priority: "core" }, // courses reach 3 -> BELOW
    { skill: radSafety, targetLevel: 3, priority: "core" },
    { skill: imageEval, targetLevel: 4, priority: "core" },
    { skill: agile, targetLevel: 2, priority: "supporting" }, // never taught -> NOT_TAUGHT
  ];
  for (const ps of programSkillTargets) {
    await prisma.programSkill.create({ data: { programId: rad.id, skillId: ps.skill.id, targetLevel: ps.targetLevel, priority: ps.priority } });
  }

  // Course-level curriculum mapping for Radiography.
  const radCourses = await prisma.course.findMany({ where: { term: { programId: rad.id } } });
  const byCode = (code: string) => radCourses.find((c) => c.code === code);
  const courseMaps: { code: string; skill: { id: string }; level: number; role: string }[] = [
    { code: "RAD-111", skill: positioning, level: 2, role: "INTRODUCED" },
    { code: "RAD-112", skill: positioning, level: 3, role: "REINFORCED" },
    { code: "RAD-211", skill: positioning, level: 4, role: "MASTERED" },
    { code: "RAD-110", skill: patientCare, level: 2, role: "INTRODUCED" },
    { code: "RAD-151", skill: patientCare, level: 3, role: "REINFORCED" },
    { code: "RAD-141", skill: radSafety, level: 2, role: "INTRODUCED" },
    { code: "RAD-231", skill: imageEval, level: 3, role: "REINFORCED" },
    { code: "RAD-271", skill: imageEval, level: 4, role: "MASTERED" },
  ];
  for (const m of courseMaps) {
    const c = byCode(m.code);
    if (c) await prisma.courseSkill.create({ data: { courseId: c.id, skillId: m.skill.id, targetLevel: m.level, role: m.role } });
  }

  // ----- WBL alignment profiles -------------------------------------------
  const radCohort = await prisma.cohort.findFirst({ where: { programId: rad.id } });
  await prisma.wblProfile.create({
    data: {
      institutionId: sandhills.id,
      subjectType: "LEARNER",
      name: "Radiography Cohort — Class of 2029",
      cohortId: radCohort?.id ?? null,
      tier: "Adult learners + recent HS grads",
      summary: "Typical entering rad-tech cohort in the Sandhills service area.",
      factors: {
        create: [
          { layer: "MOTIVATION", label: "Earn a living wage in-region", detail: "Wage must clear MIT living wage for a 1-adult household.", weight: 1, binding: false, disclosure: "STATED", matchKey: "living wage" },
          { layer: "MOTIVATION", label: "Advancement into CT/MRI", detail: "Path to advanced-modality credentials.", weight: 0.8, binding: false, disclosure: "STATED", matchKey: "advancement" },
          { layer: "CONSTRAINT", label: "Needs daytime clinical hours", detail: "Many have dependents / second jobs.", weight: 1, binding: true, disclosure: "STATED", matchKey: "daytime hours" },
          { layer: "CONSTRAINT", label: "Limited travel radius", detail: "Cannot commute beyond ~45 min.", weight: 0.7, binding: false, disclosure: "INFERRED", matchKey: "local site" },
          { layer: "CAPACITY", label: "ARRT-eligible at completion", detail: "Program is JRCERT-accredited.", weight: 1, binding: false, disclosure: "STATED", matchKey: "arrt eligible" },
        ],
      },
    },
  });
  await prisma.wblProfile.create({
    data: {
      institutionId: sandhills.id,
      subjectType: "EMPLOYER",
      name: "FirstHealth Moore Regional Hospital",
      employerId: firstHealth.id,
      tier: "Anchor clinical partner",
      summary: "Primary acute-care imaging clinical site and hiring employer.",
      factors: {
        create: [
          { layer: "CAPACITY", label: "Pays at/above living wage", detail: "Posted wages clear living wage for most household types.", weight: 1, binding: false, disclosure: "STATED", matchKey: "living wage" },
          { layer: "CAPACITY", label: "Offers daytime clinical shifts", detail: "Day rotations available for students.", weight: 1, binding: false, disclosure: "STATED", matchKey: "daytime hours" },
          { layer: "CAPACITY", label: "Local acute-care site", detail: "Within the 45-min radius.", weight: 0.8, binding: false, disclosure: "STATED", matchKey: "local site" },
          { layer: "MOTIVATION", label: "Wants advancement-minded hires", detail: "Builds a CT/MRI pipeline internally.", weight: 0.6, binding: false, disclosure: "INFERRED", matchKey: "advancement" },
          { layer: "CONSTRAINT", label: "Requires ARRT eligibility to hire", detail: "Non-negotiable credential requirement.", weight: 1, binding: true, disclosure: "STATED", matchKey: "arrt eligible" },
          { layer: "CAPACITY", label: "Hosts up to 12 clinical slots", detail: "Preceptor capacity caps cohort placement.", weight: 1, binding: false, disclosure: "STATED", matchKey: "wbl slots" },
        ],
      },
    },
  });
  await prisma.wblProfile.create({
    data: {
      institutionId: sandhills.id,
      subjectType: "EMPLOYER",
      name: "Night Imaging Center",
      employerId: nightCenter.id,
      tier: "Secondary site",
      summary: "Outpatient imaging with evening/overnight rotations only.",
      factors: {
        create: [
          { layer: "CAPACITY", label: "Pays at/above living wage", weight: 1, binding: false, disclosure: "STATED", matchKey: "living wage" },
          { layer: "CAPACITY", label: "Local site", weight: 0.7, binding: false, disclosure: "STATED", matchKey: "local site" },
          { layer: "CONSTRAINT", label: "Evening/overnight shifts only", detail: "No daytime rotations available.", weight: 1, binding: true, disclosure: "STATED", matchKey: "night shift" },
          // Note: NO "daytime hours" capacity — the learner's binding daytime
          // constraint has no counterpart here → placement infeasible.
        ],
      },
    },
  });

  // ----- Staff supply (assignments) ---------------------------------------
  // Deliberately under-supplied so the integrated plan surfaces a faculty
  // bottleneck once multiple cohorts overlap.
  const facultyNames = ["A. Rivera", "B. Chen", "C. Okafor"];
  for (const n of facultyNames) {
    const person = await prisma.person.create({ data: { institutionId: sandhills.id, name: n, role: "instructor" } });
    await prisma.assignment.create({ data: { institutionId: sandhills.id, personId: person.id, programId: rad.id, role: "instructor", fteCommitment: 1.0 } });
  }
  const coord = await prisma.person.create({ data: { institutionId: sandhills.id, name: "Lindsey (Program Lead)", role: "coordinator" } });
  await prisma.assignment.create({ data: { institutionId: sandhills.id, personId: coord.id, programId: rad.id, role: "coordinator", fteCommitment: 0.5 } });
  // Preceptors hosted by clinical partners.
  for (let i = 1; i <= 8; i++) {
    const prec = await prisma.person.create({ data: { institutionId: sandhills.id, name: `Preceptor ${i}`, role: "preceptor", employerId: firstHealth.id } });
    await prisma.assignment.create({ data: { institutionId: sandhills.id, personId: prec.id, programId: rad.id, role: "preceptor", fteCommitment: 1.0 } });
  }

  // ----- Skills at the delivery/assessment grain (SessionSkill) ------------
  // Closes the loop design → delivery → assessment. radSafety is intentionally
  // left unassessed to demonstrate an assessment gap.
  const linkSessions = async (code: string, kind: string, skillId: string, mode: string, level: number) => {
    const course = radCourses.find((c) => c.code === code);
    if (!course) return;
    const sess = await prisma.session.findMany({ where: { courseId: course.id, kind } });
    for (const s of sess) {
      await prisma.sessionSkill.upsert({
        where: { sessionId_skillId: { sessionId: s.id, skillId } },
        update: { mode, targetLevel: level },
        create: { sessionId: s.id, skillId, mode, targetLevel: level },
      });
    }
  };
  await linkSessions("RAD-111", "LAB", positioning.id, "DELIVER", 2);
  await linkSessions("RAD-211", "LAB", positioning.id, "BOTH", 4); // delivered + assessed
  await linkSessions("RAD-151", "CLINICAL", patientCare.id, "ASSESS", 3);
  await linkSessions("RAD-271", "CLASS", imageEval.id, "ASSESS", 4);

  const counts = {
    institutions: await prisma.institution.count(),
    skills: await prisma.skill.count(),
    programSkills: await prisma.programSkill.count(),
    assignments: await prisma.assignment.count(),
    sessionSkills: await prisma.sessionSkill.count(),
    wblProfiles: await prisma.wblProfile.count(),
    programs: await prisma.program.count(),
    courses: await prisma.course.count(),
    sessions: await prisma.session.count(),
    funnelStages: await prisma.funnelStage.count(),
    demand: await prisma.demandProjection.count(),
    calendarBlocks: await prisma.calendarBlock.count(),
  };
  console.log("Seed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
