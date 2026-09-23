/**
 * Rosie seed.
 *
 * Loads a faithful slice of the real artifacts the user provided:
 *  - Sandhills Community College: Radiography (SOC 29-2034) and Surgical
 *    Technology (SOC 29-2055) programs, with talent-pipeline funnels (target vs
 *    actual) and North Star goals taken from the pilot deck.
 *  - The other institutions in the workspace (College of The Albemarle, Lenoir,
 *    Craven, Carteret — see seed-institutions.ts; several more are defined but paused).
 *  - 190 real academic calendar blocks (16/14/12/8/5-week sessions w/ holiday-
 *    adjusted teachable weekdays) imported from the Cape Fear workbook.
 *
 * Course/session structures are realistic archetypes (one student's required
 * experience) so the capacity engine produces meaningful section/FTE/WBL output.
 */
import { PrismaClient } from "@prisma/client";
import { isOnlineSession } from "../src/lib/capacitymodel";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeCohortTiming, seasonOfName, type TimingTerm } from "../src/lib/term";
import { autoSchedule, toMin, toHHMM, type PlaceReq, type Weekday } from "../src/lib/space";
import { seedRoster, seedOfferings, seedOfferingMeetings, seedWorkloadPolicies, seedShiftAssignments, seedLearnerRecords, seedRequirementLogs, seedInstructors } from "./seed-roster";
import { seedLenoirCohorts } from "./seed-lenoir";
import { seedAcademicCalendars } from "./seed-calendars";
import { seedGeography, seedRequirementSets } from "./seed-geo-requirements";
import { loadSandhillsSites } from "./seed-sandhills-sites";
import { loadPartnerSites } from "./seed-partner-sites";
import { applySurgicalCaseVolumes } from "./seed-surg-cases";
import { avgCasesPerDay } from "../src/lib/surgvolume";
import { seedInstitutions, goals, goalPlanJson, type CnaPacks } from "./seed-institutions";
import { NOT_ARCHIVED, cohortStatusOn } from "../src/lib/cohortscope";
import { outcomeMix, assignOutcomes } from "../src/lib/cohorthistory";
import { BENCHMARK_RATES } from "../src/lib/northstar";

const prisma = new PrismaClient();

export type SessionSeed = {
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

export type CourseSeed = {
  code: string;
  name: string;
  weeklyClassHours: number;
  weeklyLabHours: number;
  weeklyClinicalHours: number;
  sessions?: SessionSeed[]; // optional — auto-generated from hours when omitted
  /** Rotation types the generated clinical sessions cycle through (defaults to the radiography list). */
  rotations?: string[];
  /** Clinical delivery profile for generated sessions (defaults to CLINICAL_PROFILE by code). */
  clinical?: { mode: string; maxStudents: number; faculty: number; preceptors: number };
  // Catalog metadata
  credits?: number;
  semester?: string; // Fall | Spring | Summer | All
  type?: string; // CORE | GENED | SUPPORT
  description?: string;
  requisites?: string;
};

export type TermSeed = { index: number; name: string; startWeek: number; endWeek: number; startDate?: string; courses: CourseSeed[] };

// Real-world first day for each program term (Mondays), so the calendar lands on
// actual dates / months / years.
const TERM_START_DATES = ["2025-08-18", "2026-01-12", "2026-05-18", "2026-08-17", "2027-01-11", "2027-05-17", "2027-08-16", "2028-01-10"];
// Time-of-day slots by session kind (24h "HH:MM").
const START_TIME: Record<string, string> = { CLASS: "09:00", LAB: "13:00", CLINICAL: "07:00" };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const CLINICAL_ROTATIONS = ["General Radiography", "Fluoroscopy / GI", "Operating Room & Mobile", "Trauma / Emergency", "Computed Tomography", "Chest & Bone", "Pediatrics", "Outpatient Imaging", "Vascular / Special Procedures"];

// Curated, nuanced session topics so the schedule reads like a real syllabus.
const TOPICS: Record<string, { lecture?: string[]; lab?: string[] }> = {
  "RAD-110": {
    lecture: ["Orientation, Professional Ethics & Scope of Practice", "Medical & Radiographic Terminology", "Patient Assessment & Vital Signs", "Infection Control & Medical Asepsis", "Body Mechanics & Safe Patient Transfer", "Therapeutic Communication & Informed Consent", "Principles of Radiation Protection (ALARA)", "Technical Factors: kVp, mAs & Exposure", "Contrast Media, Allergic Reactions & Venipuncture", "Pharmacology & Drug Administration Basics", "Care of the Trauma & Critical Patient", "Pediatric & Geriatric Patient Care", "Aseptic Technique & Sterile Fields", "Medical-Legal Issues, HIPAA & Documentation", "Cultural Competence & Patient-Centered Care", "Patient Care Review & Comprehensive Final"],
    lab: ["Hand Hygiene, PPE & Isolation Practice", "Vital Signs & Patient Monitoring Stations", "Wheelchair & Stretcher Transfer Lab", "Oxygen Delivery & Suction Equipment", "Sterile Tray Setup & Gloving", "Venipuncture & Contrast Setup Simulation", "Immobilization Devices & Positioning Aids", "Radiation Protection: Shielding & Collimation", "Patient Care Scenarios I (Trauma)", "Patient Care Scenarios II (Pediatric)", "Vital Signs Competency Check", "Transfer & Body Mechanics Competency", "Aseptic Technique Competency", "Contrast & Venipuncture Competency", "Integrated Patient Care Simulation", "Patient Care Practical Examination"],
  },
  "RAD-111": {
    lecture: ["Image Receptors, Positioning Terminology & Body Planes", "Chest & Upper Airway Radiography", "Abdomen: Supine, Upright & Decubitus", "Fingers, Hand & Wrist", "Forearm, Elbow & Humerus", "Shoulder Girdle & Clavicle", "Toes, Foot & Calcaneus", "Ankle, Lower Leg & Knee", "Femur & Patella", "Pelvis & Hip", "Bony Thorax: Ribs & Sternum", "Trauma Adaptations of the Extremities", "Pediatric Extremity Imaging", "Image Critique: Positioning & Quality", "Comprehensive Procedures Review", "Procedures I Comprehensive Final"],
    lab: ["Energized Lab Orientation & Safety", "Chest & Abdomen Positioning Lab", "Hand, Wrist & Forearm Lab", "Elbow & Humerus Lab", "Shoulder & Clavicle Lab", "Foot, Ankle & Lower Leg Lab", "Knee & Femur Lab", "Pelvis & Hip Lab", "Bony Thorax Lab", "Trauma Positioning Lab", "Pediatric Positioning Lab", "Image Critique Workshop", "Upper Extremity Competency", "Lower Extremity Competency", "Chest/Abdomen Competency", "Procedures I Practical Exam"],
  },
  "RAD-112": {
    lecture: ["Skull Anatomy & Cranial Positioning", "Facial Bones, Sinuses & Orbits", "Cervical Spine & Trauma Cross-Table", "Thoracic & Lumbar Spine", "Sacrum, Coccyx & Scoliosis Series", "Upper GI: Esophagus & Stomach", "Small Bowel & Enteroclysis", "Lower GI: Barium Enema", "Biliary System & Cholangiography", "Urinary System: IVU & Cystography", "Contrast Media in GI/GU Imaging", "Surgical & Mobile C-arm Procedures", "Image Critique: Spine & Contrast Studies", "Pathology Recognition in GI/GU", "Comprehensive Procedures II Review", "Procedures II Comprehensive Final"],
    lab: ["Cranium & Skull Positioning Lab", "Facial Bones & Sinus Lab", "Cervical Spine & Trauma Lab", "Thoracic & Lumbar Spine Lab", "Sacrum/Coccyx & Scoliosis Lab", "Upper GI Fluoroscopy Simulation", "Lower GI / BE Simulation", "Urinary System Simulation", "C-arm & Surgical Positioning Lab", "Contrast Handling Lab", "Spine Competency", "Skull/Facial Competency", "GI/GU Simulation Competency", "Mobile/Surgical Competency", "Integrated Procedures Lab", "Procedures II Practical Exam"],
  },
  "RAD-121": {
    lecture: ["Nature of X-radiation & the X-ray Tube", "Prime Exposure Factors Revisited", "X-ray Production & Beam Quality", "Photon Interactions with Matter", "Image Receptors & Digital Detectors", "Receptor Exposure & the Exposure Index", "Spatial Resolution & Detail", "Contrast & Dynamic Range", "Distortion: Size & Shape", "Grids: Construction & Use", "Scatter Control & Beam Restriction", "Automatic Exposure Control (AEC)", "Technique Charts & Optimization", "Image Quality Troubleshooting", "Image Production I Review", "Image Production I Final"],
    lab: ["Tube & Generator Orientation", "Exposure Factor Experiments: kVp", "Exposure Factor Experiments: mAs", "Distance & Inverse Square Lab", "Receptor Exposure / EI Lab", "Resolution & Detail Phantoms", "Contrast Experiments", "Distortion Experiments", "Grid Comparison Lab", "Scatter & Collimation Lab", "AEC Lab", "Technique Chart Construction", "QC Image Evaluation", "Optimization Workshop", "Integrated Imaging Lab", "Image Production I Practical"],
  },
  "RAD-122": {
    lecture: ["Digital Imaging Systems Overview", "CR vs DR Acquisition", "Histogram Analysis & Processing", "Exposure Indicators & Dose Creep", "Image Post-Processing & Windowing", "PACS, DICOM & Image Networking", "Artifacts in Digital Imaging", "Image Production II Review & Final"],
    lab: ["Workstation & PACS Navigation", "CR Reader & Plate Handling", "DR Detector Calibration", "Histogram & Processing Lab", "Windowing & Annotation Lab", "Artifact Identification Lab", "QC & Repeat Analysis Lab", "Image Production II Practical"],
  },
  "RAD-141": {
    lecture: ["Radiation Units, Quantities & Measurement", "Interaction of Radiation with Tissue", "Cell Biology & Radiosensitivity", "Early & Late Tissue Reactions", "Stochastic vs Deterministic Effects", "Dose Limits & Regulatory Framework", "Personnel Monitoring & Dosimetry", "Protective Devices & Shielding Design", "Patient Dose Reduction Strategies", "Fluoroscopy & Fetal Dose Considerations", "Radiation Safety Program Management", "Radiation Safety Comprehensive Final"],
  },
  "RAD-211": {
    lecture: ["Mammography Principles & Positioning", "Bone Densitometry (DEXA)", "Computed Tomography Physics & Procedures", "MRI Principles & Safety", "Vascular & Interventional Procedures", "Cardiac Catheterization Imaging", "Sectional Anatomy: Head & Neck", "Sectional Anatomy: Thorax & Abdomen", "Radiographic Pathology: Skeletal", "Radiographic Pathology: Chest & Abdomen", "Image Analysis & Critique Methodology", "Specialty Modalities Review", "Advanced Procedures Case Studies", "Geriatric & Bariatric Adaptations", "Procedures III Comprehensive Review", "Procedures III Final"],
    lab: ["Sectional Anatomy Workshop I", "Sectional Anatomy Workshop II", "CT Console Simulation", "Mammography Phantom Lab", "DEXA Simulation", "Vascular Procedures Simulation", "Pathology Image Analysis I", "Pathology Image Analysis II", "Critique Methodology Lab", "Specialty Positioning Lab", "Case Study Workshop I", "Case Study Workshop II", "Advanced Competency I", "Advanced Competency II", "Integrated Specialty Lab", "Procedures III Practical"],
  },
  "RAD-231": {
    lecture: ["Advanced Digital Image Processing", "Quality Control Programs & Testing", "Quality Assurance & Accreditation", "Dose Monitoring & Optimization", "Equipment QC: Generators & Tubes", "Display & PACS QC", "Image Production III Review & Final"],
    lab: ["QC Test Tools Orientation", "Generator & Output QC Lab", "Beam Quality & HVL Lab", "Detector Uniformity Lab", "Display Monitor QC Lab", "Repeat/Reject Analysis Lab", "QA Program Audit Workshop", "Image Production III Practical"],
  },
  "RAD-271": {
    lecture: ["Registry Review: Patient Care & Safety", "Registry Review: Image Production", "Registry Review: Procedures", "Registry Review: Radiation Physics", "Mock Registry Examination I", "Mock Registry Examination II", "Professional Transition & Resume/Interview", "Capstone Comprehensive Final"],
    lab: ["Image Critique Capstone I", "Image Critique Capstone II", "Positioning Skills Refresher", "Trauma Adaptation Refresher", "Mobile/Surgical Refresher", "Comprehensive Skills Competency", "Capstone Portfolio Review", "Capstone Practical Examination"],
  },
};

// Clinical delivery profile per course: early clinicals are instructor-led
// (small groups), later clinicals are precepted (1:1 with a preceptor, fractional
// clinical-instructor oversight) — exactly the two modes the FTE model handles.
const CLINICAL_PROFILE: Record<string, { mode: string; maxStudents: number; faculty: number; preceptors: number }> = {
  // Clinical groups (one clinical instructor or lead preceptor per ~8 students).
  "RAD-151": { mode: "Instructor-led", maxStudents: 8, faculty: 1, preceptors: 0 },
  "RAD-161": { mode: "Instructor-led", maxStudents: 8, faculty: 1, preceptors: 0 },
  "RAD-171": { mode: "Preceptor-led", maxStudents: 8, faculty: 0, preceptors: 1 },
  "RAD-251": { mode: "Preceptor-led", maxStudents: 8, faculty: 0, preceptors: 1 },
  "RAD-261": { mode: "Preceptor-led", maxStudents: 8, faculty: 0, preceptors: 1 },
};

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
    location: null, // archetype is placeless — rooms/sites attach at instantiation
    rotationType: s.rotationType ?? null,
    clinicalMode: s.clinicalMode ?? null,
    // Contact-hour policy cells (capacity-model columns N / P / U).
    facultyContactPolicy: s.kind === "CLASS" ? 2.5 : 2,
    supportContactPolicy: 2,
    preceptorContactPolicy: s.kind === "CLINICAL" ? 1 : null,
  }));
}

// Stagger class/lab times by course so the weekly timetable doesn't pile every
// session at the same hour (a single student can't be in two places at once).
const CLASS_SLOTS = ["08:00", "09:30", "11:00", "12:30"];
const LAB_SLOTS = ["13:00", "14:30", "16:00"];
const CLASS_DAYS: [string, string][] = [["Mon", "Wed"], ["Tue", "Thu"], ["Wed", "Fri"], ["Mon", "Thu"]];
const LAB_DAYS = ["Tue", "Thu", "Fri", "Mon"];
const CLINICAL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];


// ── Dummy street addresses for seeded sites ─────────────────────────────────
// Every partner and clinical site needs an address. The license data gives a
// county (and sometimes a city); the street number and name are generated
// deterministically from the site name so reseeding is stable.
const COUNTY_SEATS: Record<string, { city: string; zip: string }> = {
  Cumberland: { city: "Fayetteville", zip: "28304" }, Moore: { city: "Pinehurst", zip: "28374" }, Randolph: { city: "Asheboro", zip: "27203" },
  Harnett: { city: "Lillington", zip: "27546" }, Chatham: { city: "Siler City", zip: "27344" }, Lee: { city: "Sanford", zip: "27330" },
  Hoke: { city: "Raeford", zip: "28376" }, Richmond: { city: "Rockingham", zip: "28379" }, Scotland: { city: "Laurinburg", zip: "28352" },
  Anson: { city: "Wadesboro", zip: "28170" }, Montgomery: { city: "Troy", zip: "27371" },
};
const STREETS = ["Memorial Dr", "Owen Dr", "Hospital Dr", "Page Rd", "Medical Center Blvd", "Carthage St", "Sunset Ave", "Fayetteville Rd", "Highway 24", "Main St", "Church St", "Wicker St", "Robeson St", "Raeford Rd", "Ramsey St", "Rockingham Rd", "Cypress Rd", "Morganton Rd", "Aberdeen Rd", "Dawson St"];
function dummyAddress(name: string, county: string | null, city: string | null) {
  const h = [...name].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const seat = (county && COUNTY_SEATS[county]) || { city: "Pinehurst", zip: "28374" };
  return { address: `${100 + (h % 4900)} ${STREETS[h % STREETS.length]}`, city: city ?? seat.city, state: "NC", zip: seat.zip };
}

/** Auto-generate richly detailed session-by-session rows from catalog hours. */
function genSessions(c: CourseSeed, weeks: number) {
  const rows: ReturnType<typeof buildSessions> = [];
  const bank = TOPICS[c.code] ?? {};
  const h = [...c.code].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const classStart = CLASS_SLOTS[h % CLASS_SLOTS.length];
  const labStart = LAB_SLOTS[h % LAB_SLOTS.length];
  const [classD1, classD2] = CLASS_DAYS[h % CLASS_DAYS.length];
  const labDay = LAB_DAYS[h % LAB_DAYS.length];
  if (c.weeklyClassHours > 0) {
    for (let i = 0; i < weeks; i++) {
      const title = bank.lecture?.[i] ?? `${c.name} — Unit ${i + 1}`;
      rows.push({ kind: "CLASS", number: i + 1, title, lengthHours: c.weeklyClassHours, maxStudents: 30, facultyNeeded: 1, supportStaffNeeded: 0, preceptorsNeeded: 0, week: i + 1, dayOfWeek: i % 2 === 0 ? classD1 : classD2, startTime: classStart, deliveryMode: i % 5 === 4 ? "Hybrid" : "In-person", location: "Classroom", rotationType: null, clinicalMode: null, facultyContactPolicy: 2.5, supportContactPolicy: 2, preceptorContactPolicy: null } as any);
    }
  }
  if (c.weeklyLabHours > 0) {
    for (let i = 0; i < weeks; i++) {
      const title = bank.lab?.[i] ?? `${c.name} Lab — Week ${i + 1}`;
      rows.push({ kind: "LAB", number: i + 1, title, lengthHours: c.weeklyLabHours, maxStudents: 12, facultyNeeded: 2, supportStaffNeeded: 0, preceptorsNeeded: 0, week: i + 1, dayOfWeek: labDay, startTime: labStart, deliveryMode: "In-person", location: i % 6 === 5 ? "Simulation lab" : "Skills lab", rotationType: null, clinicalMode: null, facultyContactPolicy: 2, supportContactPolicy: 2, preceptorContactPolicy: null } as any);
    }
  }
  if (c.weeklyClinicalHours > 0) {
    const p = c.clinical ?? CLINICAL_PROFILE[c.code] ?? { mode: "Preceptor-led", maxStudents: 1, faculty: 0.1 / 3, preceptors: 1 };
    const rotations = c.rotations ?? CLINICAL_ROTATIONS;
    const clinWeeks = Math.min(weeks, 15);
    const shiftLen = c.weeklyClinicalHours >= 18 ? 12 : 8; // heavier clinical terms run 12-hr shifts
    for (let i = 0; i < clinWeeks; i++) {
      const rotation = rotations[i % rotations.length];
      // Shift structure: mostly day shifts, an evening every fourth week, a night
      // shift on 12-hour terms every sixth week — so the shift analytics have shape.
      const clinDay = CLINICAL_DAYS[(h + i) % CLINICAL_DAYS.length];
      const clinStart = shiftLen === 12 ? (i % 6 === 5 ? "19:00" : "07:00") : (i % 4 === 3 ? "15:00" : "07:00");
      rows.push({ kind: "CLINICAL", number: i + 1, title: `${rotation} Rotation — Week ${i + 1}`, lengthHours: shiftLen, maxStudents: p.maxStudents, facultyNeeded: p.faculty, supportStaffNeeded: 0, preceptorsNeeded: p.preceptors, week: i + 1, dayOfWeek: clinDay, startTime: clinStart, deliveryMode: "In-person", location: "Clinical site", rotationType: rotation, clinicalMode: i % 5 === 4 && p.mode === "Preceptor-led" ? "Instructor-led" : p.mode, facultyContactPolicy: 2, supportContactPolicy: 2, preceptorContactPolicy: 1 } as any);
    }
  }
  return rows;
}

// --- Template packs (Sandhills program-data workbooks) -----------------------
// A pack is one program's complete session table plus term/course structure,
// converted from the partner's "Program Data_All Together" sheet and term
// sheets: every input column (delivery mode, location, length, capacity,
// staffing, contact-hour policies, week/day placement, notes, rotation type and
// clinical mode) row for row.
type PackSession = {
  kind: string; number: number; title: string | null; deliveryMode: string | null; location: string | null;
  lengthHours: number; maxStudents: number; facultyNeeded: number; facultyContactPolicy: number | null;
  supportStaffNeeded: number; supportContactPolicy: number | null; week: number | null; dayOfWeek: string | null; startTime?: string | null; endTime?: string | null; sectionTimes?: string | null;
  notes: string | null; preceptorsNeeded: number; preceptorContactPolicy: number | null;
  rotationType: string | null; clinicalMode: string | null;
};
type ProgramPack = {
  name: string; programType: string; credential: string; sourceWorkbook: string; maxCohort: number;
  assumptions: { facContactHours: number; facWorkWeekHours: number; facTermWeeks: number; preContactHours: number; preWorkWeekHours: number; preTermWeeks: number };
  terms: { index: number; name: string; semester?: string | null; startWeek: number; endWeek: number; courses: { code: string; title: string; alsoCoded?: string[]; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number; sessions: PackSession[] }[] }[];
};
const loadPack = (file: string) => JSON.parse(readFileSync(join(__dirname, "templates", file), "utf8")) as ProgramPack;

async function createPackProgram(pack: ProgramPack, opts: { institutionId: string; occupationId: string; familyId: string; launchCadence: string; launchTerms: string; monthsToFullProductivity: number }) {
  const program = await prisma.program.create({
    data: {
      institutionId: opts.institutionId, occupationId: opts.occupationId, familyId: opts.familyId,
      name: pack.name, programType: pack.programType, credential: pack.credential,
      monthsToFullProductivity: opts.monthsToFullProductivity, status: "active",
      launchCadence: opts.launchCadence, launchTerms: opts.launchTerms, termSlots: "FALL,SPRING,SUMMER",
      defaultCohortSeats: pack.maxCohort,
      facContactHours: pack.assumptions.facContactHours, facWorkWeekHours: pack.assumptions.facWorkWeekHours, facTermWeeks: pack.assumptions.facTermWeeks,
      preContactHours: pack.assumptions.preContactHours, preWorkWeekHours: pack.assumptions.preWorkWeekHours, preTermWeeks: pack.assumptions.preTermWeeks,
    },
  });
  for (const t of pack.terms) {
    const termRow = await prisma.term.create({ data: { programId: program.id, index: t.index, name: t.name, semester: t.semester ?? null, startWeek: t.startWeek, endWeek: t.endWeek } });
    let order = 0;
    for (const c of t.courses) {
      await prisma.course.create({
        data: {
          termId: termRow.id, code: c.code, name: c.title, sequenceOrder: order++,
          weeklyClassHours: c.weeklyClassHours, weeklyLabHours: c.weeklyLabHours, weeklyClinicalHours: c.weeklyClinicalHours,
          semesterOffered: t.semester ?? "All", courseType: "CORE",
          // No placeholder text: the workbook gives no course description, and the title already names the course.
          description: c.alsoCoded?.length ? `Some workbook rows are coded ${c.alsoCoded.join(", ")}.` : null,
          sessions: {
            create: c.sessions.map((x) => ({
              kind: x.kind, number: x.number, title: x.title,
              deliveryMode: x.deliveryMode, location: x.location,
              lengthHours: x.lengthHours, maxStudents: x.maxStudents,
              facultyNeeded: x.facultyNeeded, supportStaffNeeded: x.supportStaffNeeded, preceptorsNeeded: x.preceptorsNeeded,
              facultyContactPolicy: x.facultyContactPolicy, supportContactPolicy: x.supportContactPolicy, preceptorContactPolicy: x.preceptorContactPolicy,
              week: x.week, dayOfWeek: x.dayOfWeek, startTime: x.startTime ?? null, endTime: x.endTime ?? null, sectionTimes: x.sectionTimes ?? null, notes: x.notes,
              rotationType: x.rotationType, clinicalMode: x.clinicalMode,
            })),
          },
        },
      });
    }
  }
  return program;
}

// Talent-pipeline health rates from the partner's "future target cohort
// performance" funnels (interested → qualified → offered → enrolled →
// completing → licensed → placed → fully productive). Surplus rates are
// relative to capacity; the rest are pass-through rates. Radiography: 83 →
// 62 → 52 → 41 enrolled → 36 → 32 → 29 placed (capacity 41, 70% utilization).
// Surgical Technology: 39 → 29 → 24 → 19 enrolled → 16 → 15 → 14 placed
// (capacity 19, 72% utilization).
const RAD_PIPELINE_RATES = { interestedSurplus: 2.02, qualifiedSurplus: 1.51, offeredSurplus: 1.27, enrollmentRate: 1.0, completionRate: 0.87, licensureRate: 0.9, placementRate: 0.91, productivityRate: 1.0 };
const SURG_PIPELINE_RATES = { interestedSurplus: 2.05, qualifiedSurplus: 1.53, offeredSurplus: 1.26, enrollmentRate: 1.0, completionRate: 0.84, licensureRate: 0.95, placementRate: 0.93, productivityRate: 1.0 };

// ---------------------------------------------------------------------------
// CLINICAL ASSET MAP — the region's physical clinical supply (Sandhills /
// Pinehurst MSA: 61 facilities, 174 functional units) from the asset-map
// workbook. Facilities become Employer partners (agreement status "none"
// until someone secures them); functional units carry the capacity math.
// ---------------------------------------------------------------------------
interface AssetMap {
  facilities: { facilityId: string; name: string; organization: string | null; county: string | null; ring: string | null; city: string | null; facilityType: string | null; licensedAcuteBeds: number | null; nursingHomeBeds: number | null; adultCareBeds: number | null; totalOrs: number | null; annualSurgicalCases: number | null; status: string | null; sourceNote: string | null }[];
  units: { unitId: string; facilityId: string; unitType: string; unitCategory: string; unitName: string | null; capacityCount: number | null; uom: string | null; dataSource: string | null; shiftsPerDay: number | null; shiftLengthHrs: number | null; shiftBlocks: string[]; days: Record<string, number>; studentsPerShift: number | null; studentsPerPreceptor: number | null; preceptorsPerShift: number | null; notes: string | null }[];
  eligibility: { program: string; required_experience: string; eligible_unit_types: string }[];
}
async function loadAssetMap(institutionId: string) {
  const map = JSON.parse(readFileSync(join(__dirname, "templates", "asset-map.json"), "utf8")) as AssetMap;
  const byFacility = new Map<string, string>();
  for (const f of map.facilities) {
    const addr = dummyAddress(f.name, f.county, f.city);
    const e = await prisma.employer.create({
      data: {
        institutionId, name: f.name, externalId: f.facilityId, organization: f.organization, county: f.county, ring: f.ring,
        address: addr.address, city: addr.city, state: addr.state, zip: addr.zip,
        facilityType: f.facilityType, setting: f.facilityType,
        licensedBeds: f.licensedAcuteBeds != null ? Math.round(Number(f.licensedAcuteBeds)) : null,
        nursingHomeBeds: f.nursingHomeBeds != null ? Math.round(Number(f.nursingHomeBeds)) : null,
        adultCareBeds: f.adultCareBeds != null ? Math.round(Number(f.adultCareBeds)) : null,
        operatingRooms: f.totalOrs != null ? Math.round(Number(f.totalOrs)) : null,
        annualSurgicalCases: f.annualSurgicalCases != null ? Math.round(Number(f.annualSurgicalCases)) : null,
        status: f.status && /open/i.test(f.status) ? "active" : "prospect",
        agreementStatus: "none", sourceNote: f.sourceNote,
      },
    });
    byFacility.set(f.facilityId, e.id);
  }
  for (const u of map.units) {
    const employerId = byFacility.get(u.facilityId);
    if (!employerId) continue;
    await prisma.clinicalUnit.create({
      data: {
        employerId, externalId: u.unitId, unitType: u.unitType, unitCategory: u.unitCategory, unitName: u.unitName,
        capacityCount: u.capacityCount != null ? Number(u.capacityCount) : null, uom: u.uom, dataSource: u.dataSource ?? "ESTIMATE",
        shiftsPerDay: Math.max(1, Math.round(Number(u.shiftsPerDay ?? 1))), shiftLengthHrs: Number(u.shiftLengthHrs ?? 8),
        shiftBlocks: (u.shiftBlocks.length ? u.shiftBlocks : ["Day"]).join(","),
        days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].filter((d) => u.days[d]).join(","),
        studentsPerShift: Math.round(Number(u.studentsPerShift ?? 0)), studentsPerPreceptor: Math.max(1, Math.round(Number(u.studentsPerPreceptor ?? 1))),
        preceptorsPerShift: Math.round(Number(u.preceptorsPerShift ?? 0)), notes: u.notes,
      },
    });
  }
  // Rotation type → unit category defaults (the join the demand model needs).
  const ROT: [string, string, string | null][] = [
    ["Operating Room", "Surgical", "Operating Room Suite"],
    ["Ambulatory Surgery", "Surgical", "Ambulatory OR Suite"],
    ["Med-Surg", "Inpatient beds", "Med-Surg / Telemetry"], ["Medical-Surgical", "Inpatient beds", "Med-Surg / Telemetry"],
    ["ICU", "Inpatient beds", "ICU / CCU"], ["Critical Care", "Inpatient beds", "ICU / CCU"],
    ["Obstetrics", "Inpatient beds", "OB / Labor & Delivery"], ["Pediatrics", "Inpatient beds", "Pediatrics"],
    ["Emergency", "Emergency", "Emergency Department"], ["Behavioral Health", "Behavioral health", "Behavioral Health"], ["Mental Health", "Behavioral health", "Behavioral Health"],
    ["Long-Term Care", "Long-term care beds", "SNF Nursing Unit"], ["Skilled Nursing", "Long-term care beds", "SNF Nursing Unit"], ["Adult Care", "Adult care beds", "Adult Care Unit"],
    ["Imaging", "Imaging", null], ["Radiography", "Imaging", "Imaging - Radiography"], ["CT", "Imaging", "Imaging - CT"], ["MRI", "Imaging", "Imaging - MRI"],
    ["Laboratory", "Laboratory", "Clinical Laboratory"],
    ["Doctor's Office", "Ambulatory office", null], ["Community Health", "Community", null],
  ];
  for (const [rotationType, unitCategory, unitType] of ROT) {
    await prisma.rotationSetting.upsert({
      where: { institutionId_rotationType: { institutionId, rotationType } },
      update: {}, create: { institutionId, rotationType, unitCategory, unitType },
    });
  }
  return { facilities: map.facilities.length, units: map.units.length };
}

/** The radiography 365-day PHYSICAL asset map (partner workbook): one row per
 *  radiographic room / ED room / portable / C-arm / fluoro room with its
 *  operating rule, plus any per-date exceptions, plus the rotation-type →
 *  setting-code join the demand model needs. Learner rule defaults to 1
 *  learner per asset per shift. */
async function loadRadAssetMap(institutionId: string) {
  type RadMap = { year: number; assets: { assetId: string; facilityId: string; facilityName: string; settingCode: string; setting: string; assetType: string; assetNumber: number; operatingRule: string; serves: string | null; days: string; shiftBlocks: string; hoursPerShift: number }[]; exceptions: { assetId: string; date: string; shiftBlocks: string }[] };
  const map = JSON.parse(readFileSync(join(__dirname, "templates", "rad-asset-map.json"), "utf8")) as RadMap;
  const employers = await prisma.employer.findMany({ where: { institutionId }, select: { id: true, externalId: true, name: true } });
  const byExt = new Map(employers.map((e) => [e.externalId, e.id]));
  const byName = new Map(employers.map((e) => [e.name.toLowerCase(), e.id]));
  const assetIds = new Map<string, string>();
  const facilities = new Set<string>();
  for (const a of map.assets) {
    const employerId = byExt.get(a.facilityId) ?? byName.get(a.facilityName.toLowerCase());
    if (!employerId) continue;
    facilities.add(employerId);
    const row = await prisma.clinicalAsset.create({
      data: {
        employerId, externalId: a.assetId, settingCode: a.settingCode, setting: a.setting, assetType: a.assetType, assetNumber: a.assetNumber,
        operatingRule: a.operatingRule, days: a.days, shiftBlocks: a.shiftBlocks, hoursPerShift: a.hoursPerShift, serves: a.serves,
        learnersPerShift: 1, preceptorsPerShift: 1, dataSource: "VERIFIED",
        // Provenance: the room list is the college's own master asset map; nobody at the site has verified it in Rosie.
        evidenceSource: "Sandhills master asset & shift map (workbook)", verifiedAt: null,
      },
    });
    assetIds.set(a.assetId, row.id);
  }
  for (const x of map.exceptions) {
    const assetId = assetIds.get(x.assetId); if (!assetId) continue;
    await prisma.assetDay.create({ data: { assetId, date: new Date(x.date + "T00:00:00Z"), shiftBlocks: x.shiftBlocks } });
  }
  // Rotation type → setting code (which physical assets serve each rotation).
  const ROT: [string, string | null, string][] = [
    ["General Radiography", "GEN", "Imaging"], ["Chest & Bone", "GEN", "Imaging"], ["Pediatrics", "GEN", "Imaging"], ["Outpatient Imaging", "GEN", "Imaging"],
    ["Trauma / Emergency", "ED", "Emergency"], ["Operating Room & Mobile", "OR", "Surgical"], ["Fluoroscopy / GI", "FLUORO", "Imaging"],
    ["Vascular / Special Procedures", "FLUORO", "Imaging"], ["Computed Tomography", "CT", "Imaging"], ["Portables / Inpatient", "PORT", "Imaging"],
    ["Operating Room", "ORS", "Surgical"], ["Radiography", "GEN", "Imaging"], ["Emergency", "ED", "Emergency"], ["Imaging", "GEN", "Imaging"],
    ["CT", "CT", "Imaging"], ["Long-Term Care", "LTC", "Long-term care beds"], ["Skilled Nursing", "LTC", "Long-term care beds"], ["Adult Care", "LTC", "Adult care beds"],
    // The Sandhills program-data workbooks' own rotation labels.
    ["General Rotations", "GEN", "Imaging"], ["Other (imaging rotations)", "GEN", "Imaging"], ["Capstone/Preceptorship", "GEN", "Imaging"],
    ["Other (surgical rotations)", "ORS", "Surgical"], ["Doctor's Office", "AMB", "Ambulatory office"], ["Operating Room or Doctor's Office", "ORS", "Surgical"],
  ];
  for (const [rotationType, settingCode, unitCategory] of ROT) {
    await prisma.rotationSetting.upsert({
      where: { institutionId_rotationType: { institutionId, rotationType } },
      update: { settingCode }, create: { institutionId, rotationType, unitCategory, settingCode },
    });
  }
  // Beyond the radiography workbook: CT scanners at the two big hospitals, and a
  // long-term-care nursing unit at every nursing home — so the nurse-aide and CT
  // demand has physical supply to be placed on (dummy, clearly marked ESTIMATE).
  let extra = 0;
  const hospitals = await prisma.employer.findMany({ where: { institutionId, externalId: { in: ["H001", "H012"] } }, select: { id: true, externalId: true } });
  for (const h of hospitals) for (let n = 1; n <= 2; n++) {
    await prisma.clinicalAsset.create({ data: { employerId: h.id, externalId: `${h.externalId}-CT-${String(n).padStart(2, "0")}`, settingCode: "CT", setting: "Computed tomography", assetType: "CT scanner", assetNumber: n, operatingRule: "24x7", days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun", shiftBlocks: "Day,Evening,Night", hoursPerShift: 8, serves: "Routine, trauma, contrast", learnersPerShift: 1, preceptorsPerShift: 1, dataSource: "ESTIMATE" } });
    extra++;
  }
  // Operating-room SUITES for surgical technology — one asset per licensed OR on the facility record
  // (the partner workbook's total ORs). A radiography C-arm (setting OR) is a radiographer's asset and
  // never counts as an operating room for surgical technology; that is what setting ORS is for. Shift
  // structure is the usual weekday OR day (07:00 first case, 8 h), marked ESTIMATE until the site confirms.
  // The facility capacity tracker's case volumes (OR inventory, inpatient / ambulatory / annual cases,
  // operating days) go on first, so the suites below follow the tracker's OR counts.
  console.log("surgical case volumes:", await applySurgicalCaseVolumes(prisma, institutionId));
  const surgical = await prisma.employer.findMany({ where: { institutionId, operatingRooms: { gt: 0 } }, select: { id: true, externalId: true, name: true, operatingRooms: true, annualSurgicalCases: true, operatingDaysPerYear: true, facilityType: true } });
  for (const h of surgical) for (let n = 1; n <= (h.operatingRooms ?? 0); n++) {
    const asc = /surgery center|ambulatory/i.test(h.facilityType ?? "");
    await prisma.clinicalAsset.create({ data: { employerId: h.id, externalId: `${h.externalId ?? "S"}-ORS-${String(n).padStart(2, "0")}`, settingCode: "ORS", setting: "Operating room suite", assetType: asc ? "Ambulatory OR suite" : "OR suite", assetNumber: n, operatingRule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", shiftBlocks: "Day", hoursPerShift: 8, dayStart: "07:00", dayHours: 8, serves: h.annualSurgicalCases != null ? `Surgical cases — ${h.annualSurgicalCases} a year, ≈ ${(avgCasesPerDay(h) ?? 0).toFixed(1)} a day across ${h.operatingRooms} ORs` : "Surgical cases", learnersPerShift: 1, preceptorsPerShift: 1, dataSource: "ESTIMATE", notes: "One suite per licensed OR on the facility record; confirm the OR day and which suites take students." } });
    extra++;
  }
  const homes = await prisma.employer.findMany({ where: { institutionId, nursingHomeBeds: { gt: 0 } }, select: { id: true, externalId: true, nursingHomeBeds: true } });
  for (const h of homes) {
    const learners = Math.max(2, Math.min(6, Math.round((h.nursingHomeBeds ?? 60) / 30)));
    await prisma.clinicalAsset.create({ data: { employerId: h.id, externalId: `${h.externalId ?? "NH"}-LTC-01`, settingCode: "LTC", setting: "Long-term care nursing unit", assetType: "SNF nursing unit", assetNumber: 1, operatingRule: "Weekday Day+Evening", days: "Mon,Tue,Wed,Thu,Fri", shiftBlocks: "Day,Evening", hoursPerShift: 8, serves: "Skilled nursing residents", learnersPerShift: learners, preceptorsPerShift: 1, dataSource: "ESTIMATE" } });
    extra++;
  }
  return { assets: assetIds.size + extra, facilities: facilities.size, exceptions: map.exceptions.length, rotations: ROT.length };
}

/** Enrolled students on every offering — one per planned seat, numbered by seat
 *  (sectionIndex = seat number), so the scheduler can hand each one a section
 *  and a site-by-site itinerary. Dummy names, deterministic. */
/** Every offering that is a record gets its roster — planned, running or graduated. A graduated class's
 *  learners end where its own talent-pipeline rates say (lib/cohorthistory): withdrawn, completed, licensed,
 *  placed or fully productive, with a completion date; the rest of its history (grades, attendance, shift logs,
 *  requirement entries) is written by the same steps that write a running class's. `pins` fix a named
 *  offering's withdrawal count instead of the rate — the partner's own number. */
async function seedOfferingStudents(pins: { program: string; cohort: string; withdrawn: number }[] = []) {
  const FIRST = ["Ava", "Liam", "Maya", "Noah", "Zoe", "Ethan", "Isla", "Mason", "Nora", "Lucas", "Aria", "Caleb", "Leah", "Owen", "Ruby", "Eli", "Jade", "Milo", "Iris", "Jonah", "Tessa", "Reid", "Cora", "Silas", "Wren", "Amir", "Lena", "Otis", "Sage", "Theo", "Vera", "Kai", "Elle", "Rowan", "Nia", "Beau", "Ada", "Cruz", "Faye", "Hugo", "Ines", "Jude", "Kira", "Luca", "Mira", "Nash", "Opal", "Pax", "Remy", "Skye"];
  const LAST = ["Abbott", "Baker", "Cole", "Dawson", "Ellis", "Foster", "Gibson", "Hale", "Ingram", "Jarvis", "Keller", "Lowe", "Mercer", "Nolan", "Osei", "Pratt", "Quinn", "Reyes", "Sutton", "Tate", "Underwood", "Vance", "Whitfield", "Xiong", "Yates", "Zimmer", "Bynum", "Clark", "Dunn", "Everett"];
  // Coded demographics (dummy, deterministic per seat) so the learner analytics
  // have something to aggregate and disaggregate on day one.
  // Home counties and towns by college — each college draws from its own service area.
  const HOME: Record<string, { counties: string[]; cities: Record<string, string> }> = {
    default: { counties: ["Moore", "Hoke", "Richmond", "Montgomery", "Lee", "Cumberland", "Scotland", "Harnett"], cities: { Moore: "Pinehurst", Hoke: "Raeford", Richmond: "Rockingham", Montgomery: "Troy", Lee: "Sanford", Cumberland: "Fayetteville", Scotland: "Laurinburg", Harnett: "Lillington" } },
    "Carteret Community College": { counties: ["Carteret", "Carteret", "Carteret", "Craven", "Onslow"], cities: { Carteret: "Morehead City", Craven: "Havelock", Onslow: "Jacksonville" } },
    "Lenoir Community College": { counties: ["Lenoir", "Lenoir", "Greene", "Jones", "Wayne"], cities: { Lenoir: "Kinston", Greene: "Snow Hill", Jones: "Trenton", Wayne: "Goldsboro" } },
    "Roanoke-Chowan Community College": { counties: ["Hertford", "Hertford", "Bertie", "Northampton", "Gates"], cities: { Hertford: "Ahoskie", Bertie: "Windsor", Northampton: "Jackson", Gates: "Gatesville" } },
  };
  const pickW = <T,>(arr: readonly T[], weights: number[], x: number): T => { const tot = weights.reduce((a, b) => a + b, 0); let r = (x % 1000) / 1000 * tot; for (let i = 0; i < arr.length; i++) { r -= weights[i]; if (r < 0) return arr[i]; } return arr[arr.length - 1]; };
  // One person, one name: a dummy name is never reused across offerings or funnel stages, so nothing that keys by name
  // (a CSV filter, a directory search) can merge two people. Deterministic: the first free combination in a fixed walk.
  const usedNames = new Set<string>();
  const uniqueName = (a: number, b: number) => { for (let k = 0; k < FIRST.length * LAST.length; k++) { const n = `${FIRST[(a + k) % FIRST.length]} ${LAST[(b + k * 7) % LAST.length]}`; if (!usedNames.has(n)) { usedNames.add(n); return n; } } const n = `${FIRST[a % FIRST.length]} ${LAST[b % LAST.length]} ${usedNames.size}`; usedNames.add(n); return n; };
  let made = 0, sections = 0, shifts = 0;
  const cohorts = await prisma.cohort.findMany({ where: NOT_ARCHIVED, include: { program: { select: { id: true, name: true, defaultCohortSeats: true, institution: { select: { name: true } }, terms: { select: { index: true, courses: { select: { id: true, sessions: { select: { id: true, kind: true, maxStudents: true, deliveryMode: true, location: true } } } } } } } }, cohortTerms: { select: { endDate: true } }, _count: { select: { students: true } } } });
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const pinned = new Set<number>();
  for (const co of cohorts) {
    if (co._count.students > 0) continue;
    const pinIdx = pins.findIndex((p) => p.cohort === co.name && p.program === co.program.name);
    const pin = pinIdx >= 0 ? pins[pinIdx] : null;
    if (pin) pinned.add(pinIdx);
    const lastEnd = co.cohortTerms.map((t) => t.endDate).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const graduated = cohortStatusOn(co.startDate?.toISOString().slice(0, 10), lastEnd?.toISOString().slice(0, 10), todayIso) === "completed";
    const completionDate = graduated ? lastEnd : null;
    // The class's own chain: the family's rates as locked in, with any per-offering override (lib/pipeline).
    let rates = { ...BENCHMARK_RATES };
    try { const saved = JSON.parse(co.pipelineRates ?? "{}") as { rates?: Partial<typeof BENCHMARK_RATES> }; if (saved.rates) rates = { ...rates, ...saved.rates }; } catch { /* benchmarks */ }
    const { counties: COUNTIES, cities: CITIES } = HOME[co.program.institution.name] ?? HOME.default;
    const seats = Math.max(4, Math.round(co.plannedSeats ?? co.program.defaultCohortSeats ?? 20));
    const h = [...co.id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const started = co.startDate ? co.startDate <= today : false;
    // Independent per-field mixes (not linear in the seat number) so no two
    // dummy attributes are accidentally correlated.
    const mix = (i: number, salt: number) => { let t = (h * 2654435761 + i * 40503 + salt * 97) >>> 0; t ^= t >>> 16; t = Math.imul(t, 0x45d9f3b) >>> 0; t ^= t >>> 16; return (t >>> 0) % 1000; };
    // A pinned roster withdraws exactly the stated number — the seats with the highest first mix, so it is deterministic and not simply the last seats.
    const pinnedOut = pin ? new Set(Array.from({ length: seats }, (_, i) => i).sort((a, b) => mix(b, 1) - mix(a, 1) || a - b).slice(0, pin.withdrawn)) : null;
    // A graduated class: every seat ends where the class's rates (or its pin) say — withdrawn, completed, licensed, placed, productive.
    const outcomes = graduated ? assignOutcomes(seats, outcomeMix(seats, rates, pin ? { withdrawn: pin.withdrawn } : undefined), (i) => mix(i, 1)) : null;
    const rows = Array.from({ length: seats }, (_, i) => {
      const x = mix(i, 1), y = mix(i, 2), z = mix(i, 3);
      const age = 18 + Math.floor(Math.pow(x / 1000, 1.6) * 30); // skews young, tail into the 40s
      // Born a full year before the entry year minus their age, so nobody is 17 on entry day whatever the entry month.
      const dob = new Date(Date.UTC((co.entryYear ?? today.getUTCFullYear()) - age - 1, (y % 12), 1 + (z % 28)));
      const county = COUNTIES[(h + i * 3) % COUNTIES.length];
      // Only offerings already under way have had time to lose anyone.
      const withdrawn = outcomes ? outcomes[i].status === "withdrawn" : pinnedOut ? pinnedOut.has(i) : started && (x % 100) < 12;
      return {
        programId: co.program.id, cohortId: co.id, name: uniqueName(h + i * 7, h * 3 + i * 11), email: null,
        status: outcomes ? outcomes[i].status : withdrawn ? "withdrawn" : "enrolled", stageKey: outcomes ? outcomes[i].stageKey : withdrawn ? "withdrawn" : "enrolled", entryYear: co.entryYear, sectionIndex: i + 1,
        completionDate: withdrawn ? null : completionDate,
        dob, sex: pickW(["Female", "Male", "Prefer not to say"], [72, 26, 2], y),
        raceEthnicity: pickW(["White", "Black or African American", "Hispanic or Latino", "American Indian or Alaska Native", "Asian", "Two or more races", "Unknown / prefer not to say"], [52, 24, 12, 4, 2, 4, 2], z),
        county, city: CITIES[county], state: "NC", residency: pickW(["in-district", "in-state", "out-of-state"], [78, 20, 2], x + y),
        priorEducation: pickW(["HS diploma", "GED", "Some college", "Certificate", "Associate", "Bachelor's"], [34, 8, 30, 10, 12, 6], z + x),
        employmentStatus: pickW(["unemployed", "part-time", "full-time", "incumbent worker (healthcare)", "student only"], [14, 34, 22, 18, 12], y + z),
        firstGeneration: (x + z) % 100 < 46, veteran: (y + z) % 100 < 6, pellEligible: (x + y + z) % 100 < 58, disability: (x * 3) % 100 < 7,
        dependents: (y % 100) < 40 ? 1 + (z % 3) : 0, primaryLanguage: (z % 100) < 9 ? "Spanish" : "English",
        withdrawalReason: withdrawn ? pickW(["academic", "financial", "personal / family", "health", "employment"], [30, 25, 25, 10, 10], x + i) : null,
        startDate: co.startDate ?? null,
      };
    });
    await prisma.student.createMany({ data: rows });
    made += seats;

    // The top of this offering's funnel: the people who showed interest, qualified and were
    // offered a seat but did not (or have not yet) enrolled — sized against the offering's own
    // stage targets with a little noise, so goal-vs-actual reads from records, not typed-in
    // numbers. Everyone enrolled above also applied to this offering.
    await prisma.student.updateMany({ where: { cohortId: co.id }, data: { applicationCohortId: co.id } });
    const stages = await prisma.funnelStage.findMany({ where: { cohortId: co.id }, select: { stageKey: true, targetNumber: true } });
    const tgt = (k: string) => stages.find((x) => x.stageKey === k)?.targetNumber ?? 0;
    const interested = Math.max(seats, Math.round(tgt("interested") * (1.02 + (h % 9) / 100)));
    const qualified = Math.min(interested, Math.max(seats, Math.round(tgt("qualified") * (0.95 + (h % 7) / 100))));
    const offered = Math.min(qualified, Math.max(seats, Math.round(tgt("offered") * (0.98 + (h % 5) / 100))));
    const upper = [
      ...Array.from({ length: interested - qualified }, (_, i) => ({ status: "prospect", stageKey: "interested", i })),
      ...Array.from({ length: qualified - offered }, (_, i) => ({ status: "applicant", stageKey: "qualified", i: 1000 + i })),
      ...Array.from({ length: offered - seats }, (_, i) => ({ status: "admitted", stageKey: "offered", i: 2000 + i })),
    ];
    if (upper.length) {
      await prisma.student.createMany({ data: upper.map(({ status, stageKey, i }) => {
        const x = mix(i + 500, 4), y = mix(i + 500, 5), z = mix(i + 500, 6);
        const age = 18 + Math.floor(Math.pow(x / 1000, 1.6) * 30);
        const county = COUNTIES[(h + i * 5) % COUNTIES.length];
        return {
          programId: co.program.id, cohortId: null, applicationCohortId: co.id, name: uniqueName(h + i * 13, h * 5 + i * 17), email: null,
          status, stageKey, entryYear: co.entryYear, sectionIndex: 1,
          dob: new Date(Date.UTC((co.entryYear ?? today.getUTCFullYear()) - age - 1, (y % 12), 1 + (z % 28))),
          sex: pickW(["Female", "Male", "Prefer not to say"], [72, 26, 2], y),
          raceEthnicity: pickW(["White", "Black or African American", "Hispanic or Latino", "American Indian or Alaska Native", "Asian", "Two or more races", "Unknown / prefer not to say"], [52, 24, 12, 4, 2, 4, 2], z),
          county, city: CITIES[county], state: "NC", residency: pickW(["in-district", "in-state", "out-of-state"], [78, 20, 2], x + y),
          priorEducation: pickW(["HS diploma", "GED", "Some college", "Certificate", "Associate", "Bachelor's"], [34, 8, 30, 10, 12, 6], z + x),
          employmentStatus: pickW(["unemployed", "part-time", "full-time", "incumbent worker (healthcare)", "student only"], [14, 34, 22, 18, 12], y + z),
          firstGeneration: (x + z) % 100 < 46, veteran: (y + z) % 100 < 6, pellEligible: (x + y + z) % 100 < 58, disability: (x * 3) % 100 < 7,
          dependents: (y % 100) < 40 ? 1 + (z % 3) : 0, primaryLanguage: (z % 100) < 9 ? "Spanish" : "English",
        };
      }) });
    }

    // Sections (per course kind) and every clinical shift, by seat order — the
    // same rule the scheduler uses, so profiles show a real itinerary.
    const students = await prisma.student.findMany({ where: { cohortId: co.id }, select: { id: true, sectionIndex: true, status: true }, orderBy: { sectionIndex: "asc" } });
    // A clinical session that never lands on a date (an orientation coded before the term opens) is not a shift anyone can sit.
    const { sessionDatesForCohort } = await import("../src/lib/queries");
    const dated = (await sessionDatesForCohort(co.id)).dates;
    const secRows: { studentId: string; cohortId: string; courseId: string; kind: string; sectionIndex: number }[] = [];
    const shiftRows: { studentId: string; cohortId: string; sessionId: string; sectionIndex: number }[] = [];
    for (const t of co.program.terms) for (const c of t.courses) {
      // An online session is nothing to attend on a date (lib/capacitymodel isOnlineSession): no shift for it, whatever kind the sheet gives it.
      const kinds = new Map<string, { max: number; sessions: string[]; online: Set<string> }>();
      for (const s of c.sessions) { const k = kinds.get(s.kind) ?? { max: 0, sessions: [], online: new Set<string>() }; k.max = Math.max(k.max, s.maxStudents ?? 0); k.sessions.push(s.id); if (isOnlineSession(s.deliveryMode, s.location)) k.online.add(s.id); kinds.set(s.kind, k); }
      for (const [kind, k] of kinds) {
        const nSec = Math.max(1, k.max > 0 ? Math.ceil(seats / k.max) : 1);
        for (const st of students) {
          if (st.status === "withdrawn") continue;
          const sec = Math.min(nSec, Math.floor(((st.sectionIndex ?? 1) - 1) * nSec / seats) + 1);
          secRows.push({ studentId: st.id, cohortId: co.id, courseId: c.id, kind, sectionIndex: sec });
          if (kind === "CLINICAL") for (const sid of k.sessions) if (dated.get(sid) && !k.online.has(sid)) shiftRows.push({ studentId: st.id, cohortId: co.id, sessionId: sid, sectionIndex: sec });
        }
      }
    }
    for (let i = 0; i < secRows.length; i += 500) await prisma.studentSection.createMany({ data: secRows.slice(i, i + 500) });
    for (let i = 0; i < shiftRows.length; i += 500) await prisma.studentShift.createMany({ data: shiftRows.slice(i, i + 500) });
    sections += secRows.length; shifts += shiftRows.length;
  }
  const missed = pins.filter((_, i) => !pinned.has(i));
  if (missed.length) throw new Error(`seedOfferingStudents: no offering matched ${missed.map((p) => `${p.program} · ${p.cohort}`).join(", ")} — the offering names have drifted`);
  console.log(`  learners: ${made} with demographics · ${sections} section seats · ${shifts} clinical shift seats`);
  return made;
}

/** Each job's CLINICAL MODEL: how its clinicals are administered (hours vs
 *  competencies), its service areas and which physical settings / unit
 *  categories serve them, the requirement grid (course × area, hours per
 *  student — the workbook's RAD PROGRAM COURSE ALLOCATION), the sites that
 *  matter to THIS family with a family-level agreement, and the shifts each
 *  secured site has allocated to the family. */
async function loadClinicalModels(institutionId: string) {
  type RadMap = { clinicalModel: { model: string; notes: string }; serviceAreas: { code: string; name: string; settingCodes: string }[]; courseAllocation: { courseCode: string; courseName: string; courseWeeks: number; students: number; area: string; hoursPerStudent: number }[] };
  const map = JSON.parse(readFileSync(join(__dirname, "templates", "rad-asset-map.json"), "utf8")) as RadMap;
  const families = await prisma.programFamily.findMany({ where: { institutionId }, include: { programs: { include: { terms: { orderBy: { index: "asc" }, include: { courses: { include: { sessions: { select: { kind: true, lengthHours: true, rotationType: true } } } } } } } } } });
  const employers = await prisma.employer.findMany({ where: { institutionId }, include: { assets: { select: { settingCode: true, shiftBlocks: true, operatingRule: true, assetType: true, preceptorsPerShift: true, accreditorClass: true, status: true } }, units: { select: { unitCategory: true } } } });
  let areas = 0, reqs = 0, sites = 0, allocations = 0;

  for (const fam of families) {
    const isRad = /radiograph/i.test(fam.name);
    const isSurg = /surgical/i.test(fam.name);
    const isCna = /nurse aide|cna/i.test(fam.name);
    const isMa = /medical assist/i.test(fam.name);
    const model = isRad ? map.clinicalModel : isSurg
      ? { model: "competency", notes: "Competency / case-based: CAAHEP requires a documented case log (120 cases across specialties, 30 first-scrub in general surgery) rather than a fixed hour count — supply is OR suites and ASC procedure rooms with a preceptor per learner." }
      : isCna ? { model: "hours", notes: "Hours-based: NC NATCEP requires a minimum of clinical hours in a skilled nursing setting under RN supervision (currently 16 h clinical in the 75-h minimum), delivered in short blocks at long-term care sites." }
      : { model: "hours", notes: "Hours-based practicum: 160-hour unpaid externship in an ambulatory office / clinic setting (CAAHEP), plus competency check-offs in administrative and clinical skills." };
    await prisma.programFamily.update({ where: { id: fam.id }, data: { clinicalModel: model.model, clinicalNotes: model.notes } });

    const areaDefs: { code: string; name: string; settingCodes: string; unitCategories: string }[] = isRad
      ? map.serviceAreas.map((a) => ({ ...a, unitCategories: "Imaging" }))
      : isSurg ? [{ code: "OR", name: "Operating room — scrub / first assist", settingCodes: "ORS", unitCategories: "Surgical" }, { code: "ASC", name: "Ambulatory surgery center procedures", settingCodes: "ORS", unitCategories: "Surgical" }, { code: "SPD", name: "Sterile processing", settingCodes: "", unitCategories: "Surgical" }, { code: "AMB", name: "Physician office / clinic observation", settingCodes: "AMB", unitCategories: "Ambulatory office" }]
      : isCna ? [{ code: "LTC", name: "Long-term care / skilled nursing", settingCodes: "LTC", unitCategories: "Long-term care beds" }, { code: "ACH", name: "Adult care home", settingCodes: "LTC", unitCategories: "Adult care beds" }, { code: "MS", name: "Hospital medical-surgical unit", settingCodes: "BEDS", unitCategories: "Inpatient beds" }]
      : [{ code: "AMB", name: "Ambulatory office / clinic externship", settingCodes: "AMB", unitCategories: "Ambulatory office" }, { code: "LAB", name: "Laboratory / phlebotomy", settingCodes: "", unitCategories: "Laboratory" }, { code: "IMG", name: "Imaging front office", settingCodes: "GEN", unitCategories: "Imaging" }];
    const areaByCode = new Map<string, string>();
    for (let i = 0; i < areaDefs.length; i++) {
      const a = areaDefs[i];
      const row = await prisma.serviceArea.create({ data: { familyId: fam.id, code: a.code, name: a.name, settingCodes: a.settingCodes, unitCategories: a.unitCategories, sortOrder: i } });
      areaByCode.set(a.code, row.id); areas++;
    }

    // Requirement grid — radiography from the workbook; other families from each clinical course's catalog hours.
    if (isRad) {
      for (const p of fam.programs) {
        if (!/^Radiography$/.test(p.name)) continue;
        // Only courses the program-data workbook lists; allocations for
        // courses it doesn't carry (the elective codes) are skipped.
        const byCode = new Map(p.terms.flatMap((t) => t.courses).map((c) => [c.code, c]));
        for (const r of map.courseAllocation) {
          const course = byCode.get(r.courseCode); const areaId = areaByCode.get(r.area);
          if (!course || !areaId) continue;
          await prisma.courseClinicalRequirement.create({ data: { courseId: course.id, serviceAreaId: areaId, hoursPerStudent: r.hoursPerStudent } });
          reqs++;
        }
      }
    } else {
      // Where the course's clinical sessions name their rotation (the Nurse Aide workbook packs:
      // Medical-Surgical, Long-Term Care), each rotation's hours go to its own setting; otherwise
      // the course's catalog clinical hours go to the family's primary setting.
      const AREA_OF: Record<string, string> = { "medical-surgical": "MS", "med-surg": "MS", "long-term care": "LTC", "skilled nursing": "LTC", "adult care": "ACH", "adult care home": "ACH", "community health": "AMB", "doctor's office": "AMB", "physician office": "AMB", "clinic": "AMB" };
      const primary = areaByCode.get(areaDefs[0].code)!;
      for (const p of fam.programs) for (const t of p.terms) for (const c of t.courses) {
        const byArea = new Map<string, number>();
        for (const s of c.sessions) {
          if (s.kind !== "CLINICAL" || !s.rotationType) continue;
          const areaId = areaByCode.get(AREA_OF[s.rotationType.trim().toLowerCase()] ?? "") ?? primary;
          byArea.set(areaId, (byArea.get(areaId) ?? 0) + s.lengthHours);
        }
        if (byArea.size) {
          for (const [serviceAreaId, hours] of byArea) { await prisma.courseClinicalRequirement.create({ data: { courseId: c.id, serviceAreaId, hoursPerStudent: Math.round(hours * 100) / 100 } }); reqs++; }
          continue;
        }
        if (c.weeklyClinicalHours <= 0) continue;
        const weeks = (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1;
        await prisma.courseClinicalRequirement.create({ data: { courseId: c.id, serviceAreaId: primary, hoursPerStudent: c.weeklyClinicalHours * weeks, casesPerStudent: isSurg ? 30 : null } });
        reqs++;
      }
    }
    // The rotation types this family's sessions name, joined to the settings and unit categories that serve them.
    if (isCna) {
      const CNA_ROT: [string, string, string | null, string][] = [
        ["Medical-Surgical", "Inpatient beds", "Med-Surg / Telemetry", "BEDS"], ["Med-Surg", "Inpatient beds", "Med-Surg / Telemetry", "BEDS"],
        ["Long-Term Care", "Long-term care beds", "SNF Nursing Unit", "LTC"], ["Skilled Nursing", "Long-term care beds", "SNF Nursing Unit", "LTC"], ["Adult Care", "Adult care beds", "Adult Care Unit", "LTC"],
        // Carteret names its rotations as an either/or; both read as acute beds first.
        ["Acute & LTC", "Inpatient beds", "Med-Surg / Telemetry", "BEDS"], ["Acute MedSurg or LTC", "Inpatient beds", "Med-Surg / Telemetry", "BEDS"],
      ];
      for (const [rotationType, unitCategory, unitType, settingCode] of CNA_ROT) {
        await prisma.rotationSetting.upsert({ where: { institutionId_rotationType: { institutionId, rotationType } }, update: {}, create: { institutionId, rotationType, unitCategory, unitType, settingCode } });
      }
    }
    if (isMa) {
      const MA_ROT: [string, string, string | null, string][] = [
        ["Community Health", "Ambulatory office", "Community Health Center", "AMB"], ["Doctor's Office", "Ambulatory office", "Physician Office", "AMB"], ["Physician Office", "Ambulatory office", "Physician Office", "AMB"], ["Clinic", "Ambulatory office", "Clinic", "AMB"],
      ];
      for (const [rotationType, unitCategory, unitType, settingCode] of MA_ROT) {
        await prisma.rotationSetting.upsert({ where: { institutionId_rotationType: { institutionId, rotationType } }, update: {}, create: { institutionId, rotationType, unitCategory, unitType, settingCode } });
      }
    }

    // Sites for this family: anything with assets in its settings or units in its categories.
    const settingSet = new Set(areaDefs.flatMap((a) => a.settingCodes.split(",").filter(Boolean)));
    const catSet = new Set(areaDefs.flatMap((a) => a.unitCategories.split(",").filter(Boolean)));
    for (const e of employers) {
      const hasAsset = e.assets.some((a) => settingSet.has(a.settingCode));
      const hasUnit = e.units.some((u) => catSet.has(u.unitCategory));
      if (!hasAsset && !hasUnit) continue;
      // Family-level agreement: the global one for the family that "owns" the site's primary use, a notch lower elsewhere.
      const primaryFamily = isRad ? hasAsset : (isCna && e.units.some((u) => /Long-term|Adult care/.test(u.unitCategory))) || (isSurg && e.units.some((u) => u.unitCategory === "Surgical")) || (isMa && e.units.some((u) => u.unitCategory === "Ambulatory office"));
      const status = primaryFamily ? e.agreementStatus : e.agreementStatus === "secured" ? "asked" : e.agreementStatus === "asked" ? "prospect" : "none";
      await prisma.familySite.upsert({ where: { familyId_employerId: { familyId: fam.id, employerId: e.id } }, update: { agreementStatus: status }, create: { familyId: fam.id, employerId: e.id, agreementStatus: status } });
      sites++;
      // JRCERT recognition for radiography sites (Form 1010R): the human-resource count is an
      // ESTIMATE from the imaging assets' day-shift preceptors until the site confirms it; a
      // secured site is treated as recognized at the capacity its resources support today, an
      // asked site as having a request in for the same number. Everything else is unrecognized.
      if (isRad) {
        const { jrcertCapacity } = await import("../src/lib/jrcert");
        const cap = jrcertCapacity({ assets: e.assets, qualifiedStaffOnShift: null });
        const staff = cap.humanEstimate;
        const capacity = Math.min(cap.physical, staff);
        await prisma.familySite.update({ where: { familyId_employerId: { familyId: fam.id, employerId: e.id } }, data: {
          qualifiedStaffOnShift: staff, staffCountSource: "ESTIMATE", studentHoursWindow: "07:00–15:30",
          evidenceSource: "seeded estimate from the asset map — not confirmed with the site", verifiedAt: null,
          accreditorStatus: status === "secured" && capacity > 0 ? "recognized" : status === "asked" && capacity > 0 ? "requested" : "none",
          approvedCapacity: status === "secured" && capacity > 0 ? capacity : null, requestedCapacity: status === "asked" && capacity > 0 ? capacity : null,
          accreditorNotes: status === "secured" ? "Seeded as recognized at today's resources — replace with the capacity on the JRCERT recognition letter." : null, capacityUpdatedAt: new Date(),
        } });
      }
      // Shifts the site has allocated to this family: secured radiography sites offer a slice of each setting's physical ceiling.
      if (isRad && status === "secured") {
        const perSetting = new Map<string, { n: number; blocks: Set<string> }>();
        for (const a of e.assets) { if (!settingSet.has(a.settingCode)) continue; const s = perSetting.get(a.settingCode) ?? { n: 0, blocks: new Set() }; s.n++; a.shiftBlocks.split(",").forEach((b) => s.blocks.add(b)); perSetting.set(a.settingCode, s); }
        for (const [code, s] of perSetting) {
          const dayShifts = s.n * (s.blocks.has("Night") ? 5 : 4); // ~ one learner slot per asset per weekday
          await prisma.settingAllocation.create({ data: { familyId: fam.id, employerId: e.id, settingCode: code, block: "Day", shiftsPerWeek: dayShifts, hoursPerShift: 8, learnersPerShift: 1 } });
          allocations++;
          if (s.blocks.has("Evening")) { await prisma.settingAllocation.create({ data: { familyId: fam.id, employerId: e.id, settingCode: code, block: "Evening", shiftsPerWeek: Math.max(1, Math.round(s.n * 1.5)), hoursPerShift: 8, learnersPerShift: 1 } }); allocations++; }
        }
      }
    }
  }
  return { families: families.length, areas, requirements: reqs, sites, allocations };
}

export async function createProgram(opts: {
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
    const startDate = t.startDate ?? TERM_START_DATES[t.index - 1] ?? null;
    // Semester: named in the term ("First Fall"), else what its courses say, else the launch-slot sequence.
    const courseSeasons = [...new Set(t.courses.map((c) => c.semester).filter((x): x is string => !!x && /^(Fall|Spring|Summer)$/.test(x)))];
    const semester = seasonOfName(t.name) ?? (courseSeasons.length === 1 ? courseSeasons[0] : null);
    const term = await prisma.term.create({
      data: { programId: program.id, index: t.index, name: t.name, semester, startWeek: t.startWeek, endWeek: t.endWeek, startDate: startDate ? new Date(startDate) : null },
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

// --- Student / SIS seeding -------------------------------------------------

// Small deterministic PRNG so re-seeds are stable.
const SHARED_GENEDS: CourseSeed[] = [
  { code: "ENG-111", name: "Writing and Inquiry", weeklyClassHours: 3, weeklyLabHours: 0, weeklyClinicalHours: 0, credits: 3, semester: "All", type: "GENED", description: "Develops clear writing across genres with emphasis on inquiry, analysis, and revision.", requisites: "", sessions: [{ kind: "CLASS", count: 10, lengthHours: 3, maxStudents: 30, facultyNeeded: 1, title: "Lecture", location: "General Classroom" }] },
  { code: "BIO-163", name: "Basic Anatomy & Physiology", weeklyClassHours: 4, weeklyLabHours: 2, weeklyClinicalHours: 0, credits: 5, semester: "All", type: "GENED", description: "Structure and function of the human body across the body systems.", requisites: "", sessions: [{ kind: "CLASS", count: 10, lengthHours: 4, maxStudents: 30, facultyNeeded: 1, title: "Lecture", location: "General Classroom" }] },
  { code: "PSY-150", name: "General Psychology", weeklyClassHours: 3, weeklyLabHours: 0, weeklyClinicalHours: 0, credits: 3, semester: "All", type: "GENED", description: "Scientific study of human behavior — methodology, cognition, development, personality.", requisites: "", sessions: [{ kind: "CLASS", count: 10, lengthHours: 3, maxStudents: 30, facultyNeeded: 1, title: "Lecture", location: "General Classroom" }] },
];

export function genTerms(prefix: string, spanWeeks: number, nTerms: number, hasClinical: boolean): TermSeed[] {
  const W = Math.max(8, Math.floor(spanWeeks / nTerms));
  const labels = ["Fall", "Spring", "Summer"];
  return Array.from({ length: nTerms }, (_, i) => {
    const lvl = i + 1;
    const courses: CourseSeed[] = [
      {
        code: `${prefix}-${110 + i * 10}`, name: `${prefix} Theory ${lvl}`,
        weeklyClassHours: 3, weeklyLabHours: 0, weeklyClinicalHours: 0, credits: 3, semester: "All", type: "CORE",
        description: `Core didactic instruction for level ${lvl} of the program.`, requisites: "",
        sessions: [{ kind: "CLASS", count: 10, lengthHours: 3, maxStudents: 32, facultyNeeded: 1, title: `Lecture`, location: "Health Sciences Classroom" }],
      },
      {
        code: `${prefix}-${111 + i * 10}`, name: `${prefix} Skills Lab ${lvl}`,
        weeklyClassHours: 1, weeklyLabHours: 4, weeklyClinicalHours: 0, credits: 2, semester: "All", type: "CORE",
        description: `Hands-on skills laboratory for level ${lvl}.`, requisites: "",
        sessions: [{ kind: "LAB", count: 8, lengthHours: 3, maxStudents: 14, facultyNeeded: 1, title: `Skills Lab`, location: "Skills Lab" }],
      },
    ];
    if (hasClinical && i >= 1) {
      courses.push({
        code: `${prefix}-${112 + i * 10}`, name: `${prefix} Clinical ${lvl}`,
        weeklyClassHours: 0, weeklyLabHours: 0, weeklyClinicalHours: 18, credits: 3, semester: "All", type: "CORE",
        description: `Supervised clinical practicum at a partner site, level ${lvl}.`, requisites: "",
        sessions: [{ kind: "CLINICAL", count: 6, lengthHours: 8, maxStudents: 8, facultyNeeded: 0, preceptorsNeeded: 1, title: `Clinical Rotation`, clinicalMode: "Preceptor-led", location: "Partner clinical site" }],
      });
    }
    // Shared general-education requirements — every health-sciences program needs
    // these SAME courses (by catalog code), so their demand aggregates across the
    // whole institution. Front-loaded into the first term.
    if (i === 0) {
      for (const ge of SHARED_GENEDS) courses.push({ ...ge });
    }
    return { index: lvl, name: `${labels[i % 3]} ${lvl}`, startWeek: i * W + 1, endWeek: i * W + W, courses };
  });
}

// Lean per-cohort staffing: assign each course's sessions to a rotating faculty
// member (clinical sessions to a preceptor), producing per-cohort SessionInstructor
// rows so workload accrues by cohort → term → year/semester.
export type CnaSession = {
  kind: string; number: number; title: string | null; deliveryMode: string | null; location: string | null;
  lengthHours: number; maxStudents: number; facultyNeeded: number; facultyContactPolicy: number | null;
  supportStaffNeeded: number; supportContactPolicy: number | null; week: number | null; dayOfWeek: string | null;
  /** "HH:MM", read from the workbook's own notes ("5:30p-9:30p") when they name a time. */
  startTime?: string | null;
  notes: string | null; preceptorsNeeded: number; preceptorContactPolicy: number | null;
  rotationType: string | null; clinicalMode: string | null;
};
export type CnaCourse = { code: string; title: string; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number };
export type CnaTerm = { index: number; name: string; semester: string | null; weeks: number; enrollment: number | null; courses: (CnaCourse & { sessions: CnaSession[] })[] };
export type CnaTemplate = {
  name: string; label: string; programType: string; credential: string; sourceWorkbook: string;
  termWeeks: number; maxCohort: number;
  assumptions: { facContactHours: number; facWorkWeekHours: number; facTermWeeks: number; preContactHours: number; preWorkWeekHours: number; preTermWeeks: number };
  course: CnaCourse | null;
  sessions: CnaSession[];
  /** A program in terms (Roanoke-Chowan's Medical Assisting: Fall Part 1, Spring Part 2); absent for a single-term delivery model. */
  terms?: CnaTerm[];
};
/** One program from a workbook pack: a delivery model (program → one term → one course → the exact
 *  session table) or a program in terms (each term's courses with their session tables). */
export async function createCnaProgram(institutionId: string, occupationId: string, familyId: string, tpl: CnaTemplate) {
  const sessionRows = (sessions: CnaSession[]) => sessions.map((x) => ({
    kind: x.kind, number: x.number, title: x.title,
    deliveryMode: x.deliveryMode, location: x.location,
    lengthHours: x.lengthHours, maxStudents: x.maxStudents,
    facultyNeeded: x.facultyNeeded, supportStaffNeeded: x.supportStaffNeeded, preceptorsNeeded: x.preceptorsNeeded,
    facultyContactPolicy: x.facultyContactPolicy, supportContactPolicy: x.supportContactPolicy, preceptorContactPolicy: x.preceptorContactPolicy,
    week: x.week, dayOfWeek: x.dayOfWeek, startTime: x.startTime ?? null, notes: x.notes,
    rotationType: x.rotationType, clinicalMode: x.clinicalMode,
  }));
  const terms: CnaTerm[] = tpl.terms ?? [{ index: 1, name: "Term 1", semester: null, weeks: tpl.termWeeks, enrollment: tpl.maxCohort, courses: tpl.course ? [{ ...tpl.course, sessions: tpl.sessions }] : [] }];
  const semesters = [...new Set(terms.map((t) => t.semester?.toUpperCase()).filter((s): s is string => !!s))];
  const program = await prisma.program.create({
    data: {
      institutionId, occupationId, familyId,
      name: tpl.name, programType: tpl.programType, credential: tpl.credential,
      monthsToFullProductivity: 1, status: "active",
      launchCadence: semesters.length ? "ANNUAL" : "MULTI_PER_YEAR", launchTerms: semesters[0] ?? "FALL,SPRING,SUMMER", termSlots: "FALL,SPRING,SUMMER",
      // A delivery model with no semester of its own is a continuing-education class: it runs its weeks
      // straight from the day it starts, across semester boundaries, on the college's holidays.
      calendarMode: semesters.length ? "semester" : "continuous",
      defaultCohortSeats: tpl.maxCohort,
      facContactHours: tpl.assumptions.facContactHours, facWorkWeekHours: tpl.assumptions.facWorkWeekHours, facTermWeeks: tpl.assumptions.facTermWeeks,
      preContactHours: tpl.assumptions.preContactHours, preWorkWeekHours: tpl.assumptions.preWorkWeekHours, preTermWeeks: tpl.assumptions.preTermWeeks,
    },
  });
  let startWeek = 1;
  for (const t of terms) {
    const term = await prisma.term.create({ data: { programId: program.id, index: t.index, name: t.name, semester: t.semester, startWeek, endWeek: startWeek + t.weeks - 1 } });
    startWeek += t.weeks;
    for (const [i, c] of t.courses.entries()) {
      await prisma.course.create({
        data: {
          termId: term.id, code: c.code, name: c.title, sequenceOrder: i,
          weeklyClassHours: c.weeklyClassHours, weeklyLabHours: c.weeklyLabHours, weeklyClinicalHours: c.weeklyClinicalHours,
          creditHours: 6, semesterOffered: t.semester ?? "All", courseType: "CORE",
          description: null, // the workbook gives no course description; no placeholder
          sessions: { create: sessionRows(c.sessions) },
        },
      });
    }
  }
  return program;
}

async function main() {
  const t0 = Date.now(); const lap = (label: string) => console.log(`⏱ ${label} · ${((Date.now() - t0) / 1000).toFixed(0)}s elapsed`);
  console.log("Resetting to basics: templates only…");
  // Order matters for FK cleanup on SQLite.
  await prisma.alignmentTag.deleteMany();
  await prisma.alignmentProfile.deleteMany();
  await prisma.intervention.deleteMany();
  await prisma.shiftMove.deleteMany();
  await prisma.meetingPattern.deleteMany();
  await prisma.facility.deleteMany();
  await prisma.wblPlacement.deleteMany();
  await prisma.wblSnapshotFactor.deleteMany();
  await prisma.wblSnapshot.deleteMany();
  await prisma.studentAbsence.deleteMany();
  await prisma.studentSkillAssessment.deleteMany();
  await prisma.studentCourseGrade.deleteMany();
  await prisma.student.deleteMany();
  await prisma.sessionInstructor.deleteMany();
  await prisma.cohortTerm.deleteMany();
  await prisma.funnelStage.deleteMany();
  await prisma.cohort.deleteMany();
  await prisma.session.deleteMany();
  await prisma.course.deleteMany();
  await prisma.term.deleteMany();
  await prisma.programYearTarget.deleteMany();
  await prisma.program.deleteMany();
  await prisma.programFamily.deleteMany();
  await prisma.demandProjection.deleteMany();
  await prisma.region.deleteMany();
  await prisma.occupation.deleteMany();
  await prisma.person.deleteMany();
  await prisma.settingAllocation.deleteMany();
  await prisma.familySite.deleteMany();
  await prisma.courseClinicalRequirement.deleteMany();
  await prisma.serviceArea.deleteMany();
  await prisma.assetBooking.deleteMany();
  await prisma.assetDay.deleteMany();
  await prisma.clinicalAsset.deleteMany();
  await prisma.employer.deleteMany();
  await prisma.calendarBlock.deleteMany();
  await prisma.academicEvent.deleteMany();
  await prisma.institution.deleteMany();

  // ----- The workspace: one institution, three jobs, a template library ------
  // Back to basics. NO cohorts, students, people, employers, or facilities are
  // seeded — the workflow is: set a goal for a job → drag a prepopulated
  // template in with start/stop dates → lock it in as an instantiation → the
  // pipeline, calendar and clinical-capacity math populate from the template.
  const sandhills = await prisma.institution.create({
    data: { name: "Sandhills Community College", shortName: "Sandhills CC", kind: "Community college", city: "Pinehurst", state: "NC", serviceArea: "Moore & Hoke Counties, NC (Sandhills region)" },
  });

  const radOcc = await prisma.occupation.create({ data: { institutionId: sandhills.id, socCode: "29-2034", title: "Radiologic Technologists" } });
  const surgOcc = await prisma.occupation.create({ data: { institutionId: sandhills.id, socCode: "29-2055", title: "Surgical Technologists" } });

  // Regions + labor-market demand (job data, not program data — the anchor a
  // goal is set against).
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
  const radServiceAreaOpenings: Record<number, number> = { 2025: 14, 2026: 14, 2027: 13, 2028: 12, 2029: 11, 2030: 12, 2031: 12, 2032: 12, 2033: 11, 2034: 11 };
  for (const [yearStr, openings] of Object.entries(radServiceAreaOpenings)) {
    await prisma.demandProjection.create({
      data: { institutionId: sandhills.id, occupationId: radOcc.id, regionId: regions["SERVICE_AREA"], year: Number(yearStr), jobs: 186, openings, growthPct: 0.17, replacementPct: 0.83, turnoverPct: 0.233 },
    });
  }
  for (const y of [2025, 2026, 2027, 2028, 2029, 2030]) {
    await prisma.demandProjection.create({
      data: { institutionId: sandhills.id, occupationId: surgOcc.id, regionId: regions["SERVICE_AREA"], year: y, jobs: 95, openings: 14, growthPct: 0.1, replacementPct: 0.9, turnoverPct: 0.5 },
    });
  }

  // ----- Families (one per job) ---------------------------------------------
  const radFamily = await prisma.programFamily.create({ data: { institutionId: sandhills.id, occupationId: radOcc.id, name: "Radiography", description: "Radiography program templates producing ARRT-eligible radiographers for the Sandhills region.", accreditor: "JRCERT", accreditationNotes: "Enter the JRCERT program number and the accredited program total clinical capacity from the most recent recognition letter.",
    capacityBasis: "seats", rotationPrimarySetting: "GEN", rotationAgreements: "secured+asked", rotationKeepHome: true, rotationNotes: "Hours per service area from the course allocation grid; one student per room / unit per shift; out-rotations (ED, portables, C-arm, fluoro, CT) in blocks at the home hospital when it has them, else at a partner that does." } });
  const surgFamily = await prisma.programFamily.create({ data: { institutionId: sandhills.id, occupationId: surgOcc.id, name: "Surgical Technology", description: "Surgical Technology program templates.",
    capacityBasis: "cases", casesPerStudentDay: 2, caseDaysPerYear: 250, rotationPrimarySetting: "ORS", rotationAgreements: "secured+asked", rotationKeepHome: true, rotationNotes: "Case-based: a student needs first- and second-scrub cases, so a site takes as many students a day as its case volume supports (daily cases ÷ cases per student-day); doctor's-office days fill the rest." } });
  const assets = await loadAssetMap(sandhills.id);
  console.log(`asset map: ${assets.facilities} clinical sites, ${assets.units} functional units`);
  const radMap = await loadRadAssetMap(sandhills.id);
  console.log("rad asset map:", radMap);
  console.log("sandhills sites:", await loadSandhillsSites(prisma, sandhills.id));
  console.log(`radiography 365-day asset map: ${radMap.assets} physical assets across ${radMap.facilities} sites, ${radMap.exceptions} date exceptions, ${radMap.rotations} rotation → setting codes`);

  // ----- The prepopulated template library ----------------------------------
  // Each template is a complete, timeless curriculum: terms → courses → the
  // full session table (class / lab / clinical rows with the capacity-model
  // columns). defaultCohortSeats is the template's max cohort enrollment
  // capacity — the gating number when a goal is split across instantiations.
  //
  // Radiography comes straight from the Sandhills cleaned program-data workbook (prisma/templates/rad.json):
  // every session row, term by term, with the workbook's workload assumptions.
  const rad = await createPackProgram(loadPack("rad.json"), { institutionId: sandhills.id, occupationId: radOcc.id, familyId: radFamily.id, launchCadence: "MULTI_PER_YEAR", launchTerms: "FALL,SPRING", monthsToFullProductivity: 6 });

  // Surgical Technology comes from the owner's corrected Raw Data & Calculations sheet (prisma/templates/source/
  // surgtech-raw-data.tsv → scripts/import-surgtech-pack.mjs → surgtech.json): the sheet is the program's source.
  const surg = await createPackProgram(loadPack("surgtech.json"), { institutionId: sandhills.id, occupationId: surgOcc.id, familyId: surgFamily.id, launchCadence: "ANNUAL", launchTerms: "FALL", monthsToFullProductivity: 6 });
  void surg;

  // ----- CNA template packs — the colleges' program-structure workbooks ------
  // Each an exact copy of a workbook's Raw Data & Calculations session table,
  // rebuilt with scripts/import-cna-pack.mjs:
  //  · cna.json (Carteret): 5-week, 6-week, 8-week summer evening, 11-week
  //    daytime and nighttime, 14-week high-school pre-apprenticeship.
  //  · cna-lenoir.json (Lenoir): Monday & Wednesday and Tuesday & Thursday
  //    classes as 20-week evening, 18-week daytime and 16-week daytime models.
  // Other Nurse Aide colleges get Carteret's 6-week model.
  const cnaPacks: CnaPacks = {
    carteret: JSON.parse(readFileSync(join(__dirname, "templates", "cna.json"), "utf8")) as CnaTemplate[],
    lenoir: JSON.parse(readFileSync(join(__dirname, "templates", "cna-lenoir.json"), "utf8")) as CnaTemplate[],
    //  · ma-roanoke-chowan.json (Roanoke-Chowan): Medical Assisting MED 3300, Part 1 (Fall) and Part 2 (Spring).
    roanokeChowan: JSON.parse(readFileSync(join(__dirname, "templates", "ma-roanoke-chowan.json"), "utf8")) as CnaTemplate[],
  };


  // North-Star goals for Sandhills' own jobs, each with the talent-pipeline health
  // rates from the partner's "future target cohort performance" funnel — the rates
  // every new launching cohort inherits at lock-in (interested → qualified → offered →
  // enrolled → completing → licensed → placed → fully productive). Sandhills carries
  // only these two jobs, and both ladders step up: the classes already in motion are
  // what they are; the partner's ask starts with the Class of 2028.
  // Radiography: 15 productive workers a year for the two classes already in motion, 30 a year
  // from the Class of 2028 on (the partner's revised ask, September 2026).
  const years = Object.keys(goals(29)).map(Number).sort();
  const ladder = (steps: number[]) => Object.fromEntries(years.map((y, i) => [y, steps[i] ?? steps[steps.length - 1]])) as Record<number, number>;
  await prisma.programFamily.update({ where: { id: radFamily.id }, data: { goalPlan: goalPlanJson(ladder([15, 15, 30, 30, 30]), RAD_PIPELINE_RATES) } });
  // Surgical Technology: 6 a year for the small Classes of 2026 and 2027 (8 enrolled, 6 completing), 14 a year from 2028 on.
  await prisma.programFamily.update({ where: { id: surgFamily.id }, data: { goalPlan: goalPlanJson(ladder([6, 6, 14, 14, 14]), SURG_PIPELINE_RATES) } });

  // ----- The other institutions in the workspace, with their programs and North-Star goals ----
  console.log("institutions:", await seedInstitutions(prisma, { createProgram, createCnaProgram, genTerms, cnaPacks }));
  // Clinical partners for the colleges the license file gives none: nursing halls and externship slots in their own program terms.
  console.log("partner sites:", await loadPartnerSites(prisma));

  // ----- Dummy roster: rooms, faculty, preceptors, site agreements, and a few
  //       locked-in offerings with sections waiting for assignments ----------
  // Where every site is and how far from the campus that delivers the programs — rings are coded from drive time, not typed.
  console.log("geography:", await seedGeography(prisma, sandhills.id, { address: "3395 Airport Rd", city: "Pinehurst", state: "NC", zip: "28374" }));
  for (const inst of await prisma.institution.findMany({ where: { id: { not: sandhills.id } }, select: { id: true } })) await seedGeography(prisma, inst.id);
  // Each college's published academic calendar — semester dates, later sessions, holidays — before
  // any offering is dated, so every term lands on the college's own calendar.
  console.log("academic calendars:", await seedAcademicCalendars(prisma, join(__dirname, "seed-data", "calendars")));
  console.log("requirement sets:", await seedRequirementSets(prisma));
  const roster = await seedRoster(prisma, sandhills.id);
  lap("roster");
  console.log("roster:", roster);
  // Carteret runs Nurse Aide Level I in six delivery models (prisma/templates/cna.json, imported from
  // the college's program-structure workbook): one planned offering per model, each capped at the
  // workbook's class size of ten. Rooms, people and sites for the college are theirs to enter. Each
  // offering carries its share of the college's 55-a-year North-Star goal. The high-school
  // pre-apprenticeship runs Spring 2027, as the workbook says.
  const carteret = await prisma.institution.findFirst({ where: { name: "Carteret Community College" }, select: { id: true } });
  if (carteret) console.log("Carteret offerings:", await seedOfferings(prisma, carteret.id, [
    { program: "Nurse Aide Level I — 6-week offering", start: "2026-08-17", goal: 9, seats: 10 },
    { program: "Nurse Aide Level I — 5-week offering", start: "2026-10-05", goal: 9, seats: 10 },
    { program: "Nurse Aide Level I — 11-week daytime offering", start: "2026-08-21", goal: 9, seats: 10 },
    { program: "Nurse Aide Level I — 11-week nighttime offering", start: "2027-01-11", goal: 9, seats: 10 },
    { program: "Nurse Aide Level I — 14-week high school offering", start: "2027-01-11", goal: 9, seats: 10 },
    { program: "Nurse Aide Level I — 8-week summer offering", start: "2027-06-01", goal: 9, seats: 10 },
  ]));
  // Roanoke-Chowan runs Medical Assisting once a year: Part 1 from the fall semester's first day,
  // Part 2 in the spring — this year's class and next year's, each carrying the 9-a-year goal.
  const roanoke = await prisma.institution.findFirst({ where: { name: "Roanoke-Chowan Community College" }, select: { id: true } });
  if (roanoke) console.log("Roanoke-Chowan offerings:", await seedOfferings(prisma, roanoke.id, [
    { program: "Medical Assisting", start: "2026-08-17", goal: 9, seats: 10 },
    { program: "Medical Assisting", start: "2027-08-16", goal: 9, seats: 10 },
  ]));
  // Lenoir's real Nurse Aide I cohort schedule (dates, days, times, rooms), each cohort on the
  // workbook delivery model its days and length match — see seed-lenoir.ts.
  const lenoir = await prisma.institution.findFirst({ where: { name: "Lenoir Community College" }, select: { id: true } });
  if (lenoir) console.log("Lenoir cohorts:", await seedLenoirCohorts(prisma, lenoir.id));
  const clinical = await loadClinicalModels(sandhills.id);
  console.log("clinical models by family:", clinical);
  // The other colleges' families too: their settings, each course's clinical hours by setting
  // (from the workbook sessions' own rotation types) and the rotation → setting join, so the
  // design page, the requirement roll-up and the scheduler read the same way everywhere. Sites
  // are theirs to enter.
  for (const inst of await prisma.institution.findMany({ where: { id: { not: sandhills.id } }, select: { id: true, name: true } })) console.log(`clinical models — ${inst.name}:`, await loadClinicalModels(inst.id));
  // Calendarize the offerings only now — against the families' final site agreements.
  console.log("offering meetings:", await seedOfferingMeetings(prisma, sandhills.id));
  // The workbook colleges' offerings too (Lenoir's keep the patterns its cohort sheet gives them).
  // A college with no rooms yet gets the rooms its workbook sessions name ("Freeland 127A"), so
  // campus sessions land somewhere on the calendar; generic places (Classroom, Lab, Internet,
  // Clinical site) are not rooms.
  for (const inst of await prisma.institution.findMany({ where: { name: { notIn: ["Sandhills Community College", "Lenoir Community College"] } }, select: { id: true, name: true } })) {
    if (!(await prisma.facility.count({ where: { institutionId: inst.id } }))) {
      const campus = await prisma.campus.findFirst({ where: { institutionId: inst.id }, orderBy: { createdAt: "asc" } });
      const locations = new Set((await prisma.session.findMany({ where: { course: { term: { program: { institutionId: inst.id } } }, kind: { not: "CLINICAL" } }, select: { location: true } })).map((s) => s.location?.trim() ?? "").filter((l) => /\d/.test(l)));
      const buildings = new Map<string, string>();
      for (const loc of locations) {
        const m = /^(.*?)\s*([A-Za-z]?\d+[A-Za-z]?)$/.exec(loc); const building = m?.[1]?.trim() || "Main Building"; const room = m?.[2] ?? null;
        if (!buildings.has(building)) buildings.set(building, (await prisma.building.create({ data: { institutionId: inst.id, campusId: campus?.id ?? (await prisma.campus.create({ data: { institutionId: inst.id, name: "Main Campus", state: "NC" } })).id, name: building } })).id);
        await prisma.facility.create({ data: { institutionId: inst.id, name: loc, kind: "CLASSROOM", buildingId: buildings.get(building)!, building, roomNumber: room, availability: "From the program workbook", status: "active" } });
      }
    }
    console.log(`offering meetings — ${inst.name}:`, await seedOfferingMeetings(prisma, inst.id));
  }
  console.log("workload policies:", await seedWorkloadPolicies(prisma));
  lap("shift assignments");
  console.log("shift assignments:", await seedShiftAssignments(prisma, sandhills.id));
  // Sandhills' small Surgical Technology classes read exactly as the partner stated them: 8 enrolled, 6 completing.
  console.log("offering students:", await seedOfferingStudents([
    { program: "Surgical Technology", cohort: "Class of 2026", withdrawn: 2 },
    { program: "Surgical Technology", cohort: "Class of 2027", withdrawn: 2 },
  ]));
  // Every partner site has confirmed the experiences it provides (nothing reads "inferred only").
  { const { confirmSiteExperiences } = await import("./seed-confirm"); console.log("site experiences confirmed:", await confirmSiteExperiences(prisma)); }
  // STRUCTURED REQUIREMENTS (R1–R5): the legacy rotation mappings, staffing columns, site limits and course hours become
  // typed setting rules, supervision rules, explicit limit modes and versioned requirements — repeat-safe, additive,
  // ambiguous wording left as needs-review for a person. The same script runs against a live database (--dry-run first).
  { const { backfillRequirements } = await import("../scripts/backfill-requirements"); const r = await backfillRequirements(prisma); console.log("requirements backfilled:", JSON.stringify({ rotations: { total: r.rotations.total, reviewedSingle: r.rotations.reviewedSingle, reviewNeeded: r.rotations.reviewNeeded }, supervision: r.supervision, sites: r.sites, requirements: { created: r.requirements.created, versions: r.requirements.versions, fulfillments: r.requirements.fulfillments, setStandards: r.requirements.setStandards, discrepancies: r.requirements.discrepancies.length } })); }
  // INSTRUCTORS FOR INSTRUCTOR-LED CLINICALS: a college whose clinical sessions need a whole instructor and has none on
  // the roster (the Nurse Aide colleges) gets a dummy bench, as Sandhills has, so the scheduler can name one per shift.
  for (const inst of await prisma.institution.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })) { const n = await seedInstructors(prisma, inst.id); if (n) console.log(`instructors seeded — ${inst.name}:`, n); }
  // THE ROSTER IS PLACED BY THE SCHEDULER: every college's clinical shifts go where the engine puts
  // them under the roster levers, written through the apply path — one set of placements for the
  // scheduler, the site capacity view and the site load page, never a site over its seats.
  lap("requirements backfilled");
  { const { seedRosterPlacements } = await import("./seed-plan"); for (const inst of await prisma.institution.findMany({ select: { id: true }, orderBy: { name: "asc" } })) { const r = await seedRosterPlacements(prisma, inst.id); if (r) console.log("roster placed by the scheduler:", r); } }
  // Every college's learner history — grades, attendance, shift logs, requirement entries — for every offering that has
  // started, graduated classes included (a college without requirement sets or sites simply logs less).
  for (const inst of await prisma.institution.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })) {
    console.log(`learner records — ${inst.name}:`, await seedLearnerRecords(prisma, inst.id));
    console.log(`requirement logs — ${inst.name}:`, await seedRequirementLogs(prisma, inst.id));
  }
  // Stage actuals read from the records above.
  { const { syncCohortActuals } = await import("../src/lib/pipelineactuals"); for (const co of await prisma.cohort.findMany({ select: { id: true } })) await syncCohortActuals(co.id); }
  // Every college's partner record points at the shared site registry (one record per site in the world).
  lap("learner records");
  { const { linkSiteRegistry } = await import("../src/lib/siteregistry"); console.log("site registry:", await linkSiteRegistry(prisma)); }

  const counts = {
    institutions: await prisma.institution.count(),
    occupations: await prisma.occupation.count(),
    families: await prisma.programFamily.count(),
    templates: await prisma.program.count(),
    courses: await prisma.course.count(),
    sessions: await prisma.session.count(),
    cohorts: await prisma.cohort.count(),
    students: await prisma.student.count(),
    people: await prisma.person.count(),
    employers: await prisma.employer.count(),
    facilities: await prisma.facility.count(),
  };
  console.log("Seeded (back to basics):", counts);
  lap("done")
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
