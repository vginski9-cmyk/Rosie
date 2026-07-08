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
import { computeCohortTiming, type TimingTerm } from "../src/lib/term";
import { autoSchedule, toMin, toHHMM, type PlaceReq, type Weekday } from "../src/lib/space";

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

type TermSeed = { index: number; name: string; startWeek: number; endWeek: number; startDate?: string; courses: CourseSeed[] };

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
    location: s.location ?? null,
    rotationType: s.rotationType ?? null,
    clinicalMode: s.clinicalMode ?? null,
  }));
}

// Stagger class/lab times by course so the weekly timetable doesn't pile every
// session at the same hour (a single student can't be in two places at once).
const CLASS_SLOTS = ["08:00", "09:30", "11:00", "12:30"];
const LAB_SLOTS = ["13:00", "14:30", "16:00"];
const CLASS_DAYS: [string, string][] = [["Mon", "Wed"], ["Tue", "Thu"], ["Wed", "Fri"], ["Mon", "Thu"]];
const LAB_DAYS = ["Tue", "Thu", "Fri", "Mon"];

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
      rows.push({ kind: "CLASS", number: i + 1, title, lengthHours: c.weeklyClassHours, maxStudents: 30, facultyNeeded: 1, supportStaffNeeded: 0, preceptorsNeeded: 0, week: i + 1, dayOfWeek: i % 2 === 0 ? classD1 : classD2, startTime: classStart, location: "Health Sciences Classroom 204", rotationType: null, clinicalMode: null } as any);
    }
  }
  if (c.weeklyLabHours > 0) {
    for (let i = 0; i < weeks; i++) {
      const title = bank.lab?.[i] ?? `${c.name} Lab — Week ${i + 1}`;
      rows.push({ kind: "LAB", number: i + 1, title, lengthHours: c.weeklyLabHours, maxStudents: 12, facultyNeeded: 2, supportStaffNeeded: 0, preceptorsNeeded: 0, week: i + 1, dayOfWeek: labDay, startTime: labStart, location: "Energized Radiography Lab", rotationType: null, clinicalMode: null } as any);
    }
  }
  if (c.weeklyClinicalHours > 0) {
    const p = CLINICAL_PROFILE[c.code] ?? { mode: "Preceptor-led", maxStudents: 1, faculty: 0.1 / 3, preceptors: 1 };
    const clinWeeks = Math.min(weeks, 15);
    const shiftLen = c.weeklyClinicalHours >= 18 ? 12 : 8; // heavier clinical terms run 12-hr shifts
    for (let i = 0; i < clinWeeks; i++) {
      const rotation = CLINICAL_ROTATIONS[i % CLINICAL_ROTATIONS.length];
      rows.push({ kind: "CLINICAL", number: i + 1, title: `${rotation} Rotation — Week ${i + 1}`, lengthHours: shiftLen, maxStudents: p.maxStudents, facultyNeeded: p.faculty, supportStaffNeeded: 0, preceptorsNeeded: p.preceptors, week: i + 1, dayOfWeek: DAYS[i % 5], startTime: START_TIME.CLINICAL, location: i % 3 === 0 ? "FirstHealth Moore Regional — Imaging" : i % 3 === 1 ? "Scotland Memorial Hospital — Radiology" : "Pinehurst Outpatient Imaging Center", rotationType: rotation, clinicalMode: p.mode } as any);
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
    const startDate = t.startDate ?? TERM_START_DATES[t.index - 1] ?? null;
    const term = await prisma.term.create({
      data: { programId: program.id, index: t.index, name: t.name, startWeek: t.startWeek, endWeek: t.endWeek, startDate: startDate ? new Date(startDate) : null },
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
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  "Ava", "Liam", "Maya", "Noah", "Sofia", "Ethan", "Isabella", "Mason", "Olivia", "Lucas",
  "Emma", "Jayden", "Chloe", "Caleb", "Zoe", "Aiden", "Layla", "Diego", "Nia", "Owen",
  "Harper", "Elijah", "Camila", "Wyatt", "Aaliyah", "Carter", "Leah", "Julian", "Brianna", "Gabriel",
  "Destiny", "Xavier", "Jasmine", "Hunter", "Mia", "Andre", "Keisha", "Tyler", "Priya", "Marcus",
  "Valeria", "Devin", "Amara", "Cole", "Imani", "Brandon", "Selena", "Trevor", "Yasmin", "Quinn",
];
const LAST_NAMES = [
  "Johnson", "Martinez", "Nguyen", "Williams", "Garcia", "Brown", "Davis", "Rodriguez", "Wilson", "Patel",
  "Thompson", "Moore", "Jackson", "Lee", "Perez", "White", "Harris", "Sanchez", "Clark", "Lewis",
  "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Hill", "Green",
  "Adams", "Baker", "Gonzalez", "Nelson", "Carter", "Mitchell", "Roberts", "Turner", "Phillips", "Campbell",
];

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d;
}

async function seedStudents(
  programId: string,
  cohortId: string,
  _radCourses: { id: string; code: string | null }[],
  skills: { positioning: string; patientCare: string; radSafety: string; imageEval: string },
) {
  const rng = mulberry32(2029);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];

  // Courses with their term index, for dated grade/assessment placement.
  const courses = await prisma.course.findMany({
    where: { term: { programId } },
    include: { term: true },
    orderBy: [{ term: { index: "asc" } }, { sequenceOrder: "asc" }],
  });
  const byCode = (code: string) => courses.find((c) => c.code === code);
  const coursesInTerm = (idx: number) => courses.filter((c) => c.term.index === idx);
  const maxTerm = Math.max(1, ...courses.map((c) => c.term.index));
  const termStart = (idx: number) => TERM_START_DATES[idx - 1] ?? TERM_START_DATES[0];

  // Furthest-reached stage for each student, matching the cumulative funnel
  // actuals (interested 199 ⊃ qualified 39 ⊃ … ⊃ productive 12).
  const stops: { stage: string; status: string; n: number }[] = [
    { stage: "interested", status: "prospect", n: 160 },
    { stage: "qualified", status: "applicant", n: 13 },
    { stage: "offered", status: "admitted", n: 11 },
    { stage: "enrolled", status: "enrolled", n: 2 },
    { stage: "completing", status: "enrolled", n: 1 },
    { stage: "licensed", status: "completed", n: 0 },
    { stage: "placed", status: "placed", n: 0 },
    { stage: "productive", status: "placed", n: 12 },
  ];

  // How far through the curriculum a student at a given stage has progressed.
  const completedTermsFor = (stage: string): number => {
    switch (stage) {
      case "enrolled": return 0;        // Term 1 in progress
      case "completing": return maxTerm - 1; // on the final term
      case "licensed":
      case "placed":
      case "productive": return maxTerm; // graduated
      default: return 0;                 // pre-enrollment: no academic record
    }
  };

  // KSA assessment plan: skill → ladder of (term, level, courseCode, method).
  const ksaPlan: { skillId: string; rungs: { t: number; level: number; code: string; method: string }[] }[] = [
    { skillId: skills.positioning, rungs: [
      { t: 1, level: 2, code: "RAD-111", method: "lab check-off" },
      { t: 2, level: 3, code: "RAD-112", method: "lab check-off" },
      { t: 4, level: 4, code: "RAD-211", method: "clinical evaluation" },
    ] },
    { skillId: skills.patientCare, rungs: [
      { t: 1, level: 2, code: "RAD-110", method: "simulation" },
      { t: 2, level: 3, code: "RAD-161", method: "clinical evaluation" },
    ] },
    { skillId: skills.radSafety, rungs: [
      { t: 3, level: 2, code: "RAD-141", method: "written exam" },
      { t: 4, level: 3, code: "RAD-231", method: "written exam" },
    ] },
    { skillId: skills.imageEval, rungs: [
      { t: 4, level: 3, code: "RAD-231", method: "image critique" },
      { t: 5, level: 4, code: "RAD-271", method: "capstone portfolio" },
    ] },
  ];

  const gradeBank = [
    { grade: "A", points: 4.0, w: 3 },
    { grade: "A-", points: 3.7, w: 3 },
    { grade: "B+", points: 3.3, w: 4 },
    { grade: "B", points: 3.0, w: 4 },
    { grade: "B-", points: 2.7, w: 2 },
    { grade: "C+", points: 2.3, w: 2 },
    { grade: "C", points: 2.0, w: 1 },
  ];
  const weightedGrade = () => {
    const total = gradeBank.reduce((s, g) => s + g.w, 0);
    let r = rng() * total;
    for (const g of gradeBank) { r -= g.w; if (r <= 0) return g; }
    return gradeBank[0];
  };

  const usedNames = new Set<string>();
  const nextName = () => {
    for (let tries = 0; tries < 50; tries++) {
      const n = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      if (!usedNames.has(n)) { usedNames.add(n); return n; }
    }
    const n = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)} ${usedNames.size}`;
    usedNames.add(n);
    return n;
  };

  const CLINICAL_SITES = ["FirstHealth Moore Regional Hospital", "Scotland Memorial Hospital", "Pinehurst Outpatient Imaging Center"];
  let academicSeq = 0;
  let created = 0;
  for (const stop of stops) {
    const completedTerms = completedTermsFor(stop.stage);
    const isAcademic = ["enrolled", "completing", "licensed", "placed", "productive"].includes(stop.stage);
    for (let i = 0; i < stop.n; i++) {
      const name = nextName();
      const [first, last] = name.split(" ");
      const email = `${first[0].toLowerCase()}${last.toLowerCase()}@student.sandhills.edu`;

      // Build the academic record for enrolled-and-beyond students.
      const gradeRows: { courseId: string; termIndex: number; status: string; grade: string | null; gradePoints: number | null; completedDate: Date | null }[] = [];
      const assessmentRows: { skillId: string; level: number; assessedDate: Date; courseCode: string; method: string }[] = [];
      const absenceRows: { date: Date; courseCode: string | null; sessionTitle: string; excused: boolean }[] = [];
      let gpa: number | null = null;

      if (isAcademic) {
        // Completed terms → finished grades; current term (if any) → in progress.
        const currentTerm = completedTerms < maxTerm ? completedTerms + 1 : null;
        let pts = 0, n = 0;
        for (let t = 1; t <= completedTerms; t++) {
          for (const c of coursesInTerm(t)) {
            const g = weightedGrade();
            pts += g.points; n += 1;
            gradeRows.push({ courseId: c.id, termIndex: t, status: "completed", grade: g.grade, gradePoints: g.points, completedDate: addDaysISO(termStart(t), 110) });
          }
        }
        if (currentTerm) {
          for (const c of coursesInTerm(currentTerm)) {
            gradeRows.push({ courseId: c.id, termIndex: currentTerm, status: "in_progress", grade: null, gradePoints: null, completedDate: null });
          }
        }
        gpa = n > 0 ? Math.round((pts / n) * 100) / 100 : null;

        // Dated KSA assessments up through completed terms.
        const reach = currentTerm ?? completedTerms;
        for (const plan of ksaPlan) {
          for (const rung of plan.rungs) {
            if (rung.t <= reach) {
              assessmentRows.push({ skillId: plan.skillId, level: rung.level, assessedDate: addDaysISO(termStart(rung.t), 40 + Math.floor(rng() * 40)), courseCode: rung.code, method: rung.method });
            }
          }
        }

        // Attendance: a session count proportional to terms underway, with a
        // handful of dated absences.
        const termsUnderway = currentTerm ?? completedTerms;
        const totalSessions = termsUnderway * 62 + Math.floor(rng() * 10);
        const missed = Math.floor(rng() * 7);
        for (let m = 0; m < missed; m++) {
          const t = 1 + Math.floor(rng() * termsUnderway);
          const opts = coursesInTerm(t);
          const c = opts.length ? opts[Math.floor(rng() * opts.length)] : null;
          absenceRows.push({ date: addDaysISO(termStart(t), 10 + Math.floor(rng() * 90)), courseCode: c?.code ?? null, sessionTitle: c ? `${c.name} session` : "Session", excused: rng() < 0.45 });
        }

        const sectionIndex = (academicSeq % 3) + 1; // 3 lab/clinical groups
        const clinicalSite = CLINICAL_SITES[academicSeq % CLINICAL_SITES.length];
        academicSeq += 1;
        const student = await prisma.student.create({
          data: {
            programId, cohortId, name, email, status: stop.status, stageKey: stop.stage,
            entryYear: 2029, gpa, attendedCount: Math.max(0, totalSessions - missed), missedCount: missed,
            sectionIndex, clinicalSite,
            grades: { create: gradeRows },
            assessments: { create: assessmentRows },
            absences: { create: absenceRows },
          },
        });
        void student;
      } else {
        // Pre-enrollment: pipeline status only.
        await prisma.student.create({
          data: { programId, cohortId, name, email, status: stop.status, stageKey: stop.stage, entryYear: 2029 },
        });
      }
      created += 1;
    }
  }
  // Keep TS happy if byCode unused in some configs.
  void byCode;
  console.log(`Seeded ${created} students.`);
}

// Courses that are deliberately co-taught, with the split (in contact hours)
// between a primary and a secondary instructor for each CLASS session.
const COTEACH: Record<string, { primaryShare: number; segment: [string, string] }> = {
  "RAD-110": { primaryShare: 2 / 3, segment: ["Lecture", "Patient-care lab"] }, // 3h class → 2h + 1h
  "RAD-211": { primaryShare: 2 / 3, segment: ["Procedures lecture", "Image analysis"] },
  "RAD-271": { primaryShare: 0.5, segment: ["Registry review", "Capstone critique"] }, // even split
};

const HOMEWORK_BANK: Record<string, string[]> = {
  CLASS: [
    "Read assigned chapter; complete end-of-chapter review questions.",
    "Pre-lecture quiz due before class on the LMS.",
    "Worksheet: label anatomy on provided projections.",
    "Prepare 3 questions on the assigned positioning routine.",
  ],
  LAB: [
    "Bring completed positioning prep sheet; lab check-off today.",
    "Review the procedure video; practice setup before lab.",
    "Document peer-evaluation of last week's images.",
  ],
  CLINICAL: [
    "Log today's exams in Trajecsys; submit competency attempts.",
    "Reflective journal entry on a non-routine case.",
    "Have clinical instructor sign off on weekly objectives.",
  ],
};

async function seedSessionStaff(
  programId: string,
  cohortId: string,
  faculty: { id: string; name: string }[],
  preceptors: { id: string; name: string; siteIndex: number }[],
) {
  const rng = mulberry32(7);
  const courses = await prisma.course.findMany({
    where: { term: { programId } },
    orderBy: [{ term: { index: "asc" } }, { sequenceOrder: "asc" }],
    include: { sessions: true },
  });

  let courseIdx = 0;
  const siteGroups: Record<number, { id: string; name: string }[]> = { 0: [], 1: [], 2: [] };
  for (const p of preceptors) siteGroups[p.siteIndex].push({ id: p.id, name: p.name });

  for (const c of courses) {
    // A consistent primary + secondary instructor per course (round-robin).
    const primary = faculty[courseIdx % faculty.length];
    const secondary = faculty[(courseIdx + 1) % faculty.length];
    courseIdx += 1;
    const co = c.code ? COTEACH[c.code] : undefined;

    for (const s of c.sessions) {
      const rows: { sessionId: string; cohortId: string; personId: string; role: string; contactHours: number; segment: string | null }[] = [];
      if (s.kind === "CLINICAL") {
        // Preceptor from the site group rotated by session number.
        const group = siteGroups[s.number % 3];
        const prec = (group.length ? group : preceptors)[s.number % Math.max(1, group.length || preceptors.length)];
        if (prec) rows.push({ sessionId: s.id, cohortId, personId: prec.id, role: "preceptor", contactHours: s.lengthHours, segment: "Clinical supervision" });
      } else if (co && s.kind === "CLASS") {
        const primShare = Math.round(s.lengthHours * co.primaryShare * 10) / 10;
        const secShare = Math.round((s.lengthHours - primShare) * 10) / 10;
        rows.push({ sessionId: s.id, cohortId, personId: primary.id, role: "instructor", contactHours: primShare, segment: co.segment[0] });
        if (secShare > 0) rows.push({ sessionId: s.id, cohortId, personId: secondary.id, role: "instructor", contactHours: secShare, segment: co.segment[1] });
      } else {
        rows.push({ sessionId: s.id, cohortId, personId: primary.id, role: "instructor", contactHours: s.lengthHours, segment: s.kind === "LAB" ? "Lab supervision" : "Lecture" });
      }
      if (rows.length) await prisma.sessionInstructor.createMany({ data: rows });

      // Homework / what-to-prepare for most sessions.
      const bank = HOMEWORK_BANK[s.kind] ?? [];
      if (bank.length && rng() < 0.8) {
        await prisma.session.update({ where: { id: s.id }, data: { homework: bank[Math.floor(rng() * bank.length)] } });
      }
    }
  }
}

// ---- Generic allied-health program generator (for the data-expansion block) ----
// Builds a sensibly-structured multi-term program with explicit (small) session
// counts so session volume stays controlled while term spans stay realistic — the
// term week-spans drive the cohort-timing engine (current term / expected end / phase).
// Institution-wide general-education courses shared by EVERY health-sciences
// program (same catalog code → demand pools across programs). Codes match the
// Radiography template so RAD's demand aggregates with the rest.
const SHARED_GENEDS: CourseSeed[] = [
  { code: "ENG-111", name: "Writing and Inquiry", weeklyClassHours: 3, weeklyLabHours: 0, weeklyClinicalHours: 0, credits: 3, semester: "All", type: "GENED", description: "Develops clear writing across genres with emphasis on inquiry, analysis, and revision.", requisites: "", sessions: [{ kind: "CLASS", count: 10, lengthHours: 3, maxStudents: 30, facultyNeeded: 1, title: "Lecture", location: "General Classroom" }] },
  { code: "BIO-163", name: "Basic Anatomy & Physiology", weeklyClassHours: 4, weeklyLabHours: 2, weeklyClinicalHours: 0, credits: 5, semester: "All", type: "GENED", description: "Structure and function of the human body across the body systems.", requisites: "", sessions: [{ kind: "CLASS", count: 10, lengthHours: 4, maxStudents: 30, facultyNeeded: 1, title: "Lecture", location: "General Classroom" }] },
  { code: "PSY-150", name: "General Psychology", weeklyClassHours: 3, weeklyLabHours: 0, weeklyClinicalHours: 0, credits: 3, semester: "All", type: "GENED", description: "Scientific study of human behavior — methodology, cognition, development, personality.", requisites: "", sessions: [{ kind: "CLASS", count: 10, lengthHours: 3, maxStudents: 30, facultyNeeded: 1, title: "Lecture", location: "General Classroom" }] },
];

function genTerms(prefix: string, spanWeeks: number, nTerms: number, hasClinical: boolean): TermSeed[] {
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
async function seedCohortStaff(
  cohortId: string, programId: string,
  faculty: { id: string }[], preceptors: { id: string }[],
) {
  if (!faculty.length) return;
  const courses = await prisma.course.findMany({
    where: { term: { programId } },
    orderBy: [{ term: { index: "asc" } }, { sequenceOrder: "asc" }],
    include: { sessions: { select: { id: true, kind: true, lengthHours: true } } },
  });
  const rows: { sessionId: string; cohortId: string; personId: string; role: string; contactHours: number; segment: string | null }[] = [];
  let ci = 0;
  for (const co of courses) {
    const primary = faculty[ci % faculty.length];
    ci += 1;
    for (const s of co.sessions) {
      if (s.kind === "CLINICAL" && preceptors.length) {
        const prec = preceptors[s.id.charCodeAt(s.id.length - 1) % preceptors.length];
        rows.push({ sessionId: s.id, cohortId, personId: prec.id, role: "preceptor", contactHours: s.lengthHours, segment: "Clinical supervision" });
      } else {
        rows.push({ sessionId: s.id, cohortId, personId: primary.id, role: "instructor", contactHours: s.lengthHours, segment: s.kind === "LAB" ? "Lab supervision" : "Lecture" });
      }
    }
  }
  if (rows.length) await prisma.sessionInstructor.createMany({ data: rows });
}

// ---- WBL dated snapshots: per-employer capacity + per-student learner profiles
type Fac = { layer: string; label: string; detail?: string; weight?: number; binding?: boolean; disclosure?: string; matchKey: string };
const F = {
  day: (): Fac => ({ layer: "CAPACITY", label: "Offers daytime clinical shifts", matchKey: "daytime hours" }),
  evening: (): Fac => ({ layer: "CAPACITY", label: "Offers evening/overnight shifts", matchKey: "evening shift" }),
  local: (): Fac => ({ layer: "CAPACITY", label: "Local — within ~30 minutes", matchKey: "local site" }),
  transit: (): Fac => ({ layer: "CAPACITY", label: "On a public-transit line", matchKey: "transit access" }),
  wage: (): Fac => ({ layer: "CAPACITY", label: "Pays at/above living wage", matchKey: "living wage" }),
  ct: (): Fac => ({ layer: "CAPACITY", label: "Offers CT/MRI advanced rotations", matchKey: "ct modality" }),
  arrtReq: (): Fac => ({ layer: "CONSTRAINT", label: "Requires ARRT eligibility to host", binding: true, matchKey: "arrt eligible" }),
};

async function seedWblSnapshots(
  institutionId: string,
  employers: { id: string; name: string; kind: "firstHealth" | "scotland" | "pinehurst" | "night" }[],
  students: { id: string }[],
) {
  // Employer capacity snapshots (dated). Each site's factors determine which
  // student constraints it can satisfy.
  const EMP_FACTORS: Record<string, Fac[]> = {
    firstHealth: [F.day(), F.local(), F.transit(), F.wage(), F.ct(), F.arrtReq()],
    scotland: [F.day(), F.wage(), F.arrtReq()], // farther out, no CT, off transit
    pinehurst: [F.day(), F.local(), F.wage(), F.ct(), F.arrtReq()],
    night: [F.evening(), F.local(), F.wage(), F.arrtReq()], // evenings only — no daytime
  };
  for (const e of employers) {
    await prisma.wblSnapshot.create({
      data: {
        institutionId, subjectType: "EMPLOYER", employerId: e.id, asOfDate: new Date("2025-08-01"),
        summary: `Clinical-partner capacity snapshot for ${e.name}.`,
        factors: { create: EMP_FACTORS[e.kind] },
      },
    });
  }

  // Learner archetypes — varied so recommendations and needs differ per student.
  const common: Fac[] = [
    { layer: "MOTIVATION", label: "Earn a living wage in-region", weight: 1, matchKey: "living wage" },
    { layer: "CAPACITY", label: "ARRT-eligible at completion", weight: 1, matchKey: "arrt eligible" },
  ];
  const daytime = (): Fac => ({ layer: "CONSTRAINT", label: "Needs daytime clinical hours", binding: true, matchKey: "daytime hours" });
  const ARCHETYPES: { key: string; fields: { maxTravelMinutes: number; transport: string; availability: string; shiftPreference: string; targetWage: number; desiredModality: string }; summary: string; factors: Fac[] }[] = [
    { key: "A", summary: "Day-only, local, has a car.", fields: { maxTravelMinutes: 30, transport: "own-car", availability: "Mon,Tue,Wed,Thu,Fri", shiftPreference: "day", targetWage: 22, desiredModality: "general" },
      factors: [...common, daytime(), { layer: "CONSTRAINT", label: "Must stay within ~30 minutes", binding: true, matchKey: "local site" }] },
    { key: "B", summary: "Day shifts, relies on public transit.", fields: { maxTravelMinutes: 45, transport: "public-transit", availability: "Mon,Tue,Wed,Thu,Fri", shiftPreference: "day", targetWage: 21, desiredModality: "general" },
      factors: [...common, daytime(), { layer: "CONSTRAINT", label: "Relies on public transit", binding: true, disclosure: "INFERRED", matchKey: "transit access" }] },
    { key: "C", summary: "Career-focused — wants a CT rotation.", fields: { maxTravelMinutes: 40, transport: "own-car", availability: "Mon,Tue,Wed,Thu,Fri", shiftPreference: "day", targetWage: 23, desiredModality: "CT" },
      factors: [...common, daytime(), { layer: "CONSTRAINT", label: "Needs a CT rotation for career goal", binding: true, matchKey: "ct modality" }, { layer: "MOTIVATION", label: "Advancement into CT/MRI", weight: 0.8, matchKey: "ct modality" }] },
    { key: "D", summary: "Rural — can travel far, day shifts.", fields: { maxTravelMinutes: 75, transport: "own-car", availability: "Mon,Tue,Wed,Thu,Fri", shiftPreference: "day", targetWage: 22, desiredModality: "general" },
      factors: [...common, daytime()] },
    { key: "E", summary: "Works days — can only attend evenings.", fields: { maxTravelMinutes: 40, transport: "own-car", availability: "Mon,Tue,Wed,Thu", shiftPreference: "evening", targetWage: 24, desiredModality: "general" },
      factors: [...common, { layer: "CONSTRAINT", label: "Can only attend evenings", binding: true, matchKey: "evening shift" }] },
    { key: "F", summary: "Day shifts; needs childcare support.", fields: { maxTravelMinutes: 30, transport: "rides", availability: "Tue,Wed,Thu", shiftPreference: "day", targetWage: 20, desiredModality: "general" },
      factors: [...common, daytime(), { layer: "CONSTRAINT", label: "Needs onsite/near-site childcare", binding: true, disclosure: "STATED", matchKey: "childcare" }] },
  ];

  for (let i = 0; i < students.length; i++) {
    const a = ARCHETYPES[i % ARCHETYPES.length];
    await prisma.wblSnapshot.create({
      data: {
        institutionId, subjectType: "LEARNER_STUDENT", studentId: students[i].id,
        asOfDate: addDaysISO("2025-09-08", i), summary: a.summary,
        maxTravelMinutes: a.fields.maxTravelMinutes, transport: a.fields.transport, availability: a.fields.availability,
        shiftPreference: a.fields.shiftPreference, targetWage: a.fields.targetWage, desiredModality: a.fields.desiredModality,
        factors: { create: a.factors },
      },
    });
  }
  // ONE childcare-blocked student (index 5) gets a SECOND, later snapshot showing
  // the need resolved — so dated history is visible. The OTHER (index 11) keeps
  // the unmet need, so the placement board still demonstrates "needs support".
  for (const i of [5]) {
    const s = students[i];
    if (!s) continue;
    await prisma.wblSnapshot.create({
      data: {
        institutionId, subjectType: "LEARNER_STUDENT", studentId: s.id,
        asOfDate: new Date("2026-01-20"), summary: "Re-capture: childcare arranged; now placeable on day rotations.",
        maxTravelMinutes: 30, transport: "own-car", availability: "Mon,Tue,Wed,Thu,Fri", shiftPreference: "day", targetWage: 21, desiredModality: "general",
        factors: { create: [
          { layer: "MOTIVATION", label: "Earn a living wage in-region", weight: 1, matchKey: "living wage" },
          { layer: "CAPACITY", label: "ARRT-eligible at completion", weight: 1, matchKey: "arrt eligible" },
          { layer: "CONSTRAINT", label: "Needs daytime clinical hours", binding: true, matchKey: "daytime hours" },
        ] },
      },
    });
  }
}

async function main() {
  console.log("Resetting data…");
  // Order matters for FK cleanup on SQLite.
  await prisma.alignmentTag.deleteMany();
  await prisma.alignmentProfile.deleteMany();
  await prisma.intervention.deleteMany();
  await prisma.meetingPattern.deleteMany();
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

  // ----- Program families: group templates leading to the same occupation ----
  const radFamily = await prisma.programFamily.create({ data: { institutionId: sandhills.id, occupationId: radOcc.id, name: "Radiography", description: "All Radiography program templates producing ARRT-eligible radiographers for the Sandhills region." } });
  const surgFamily = await prisma.programFamily.create({ data: { institutionId: sandhills.id, occupationId: surgOcc.id, name: "Surgical Technology", description: "Surgical Technology program templates." } });
  await prisma.program.update({ where: { id: rad.id }, data: { familyId: radFamily.id } });
  await prisma.program.update({ where: { id: surg.id }, data: { familyId: surgFamily.id } });

  // A SECOND Radiography template under the same family — an evening/part-time
  // track that shares the workforce goal but runs on its own cadence.
  const radEvening = await createProgram({
    institutionId: sandhills.id, occupationId: radOcc.id, name: "Radiography — Evening Track", programType: "Evening Part Time", credential: "AAS",
    terms: [{ index: 1, name: "Evening Foundations", startWeek: 1, endWeek: 24, courses: [c("RAD-110E", "Radiography Introduction (Evening)", 2, 3, 0, 3, "Fall", "CORE", "Evening-cohort introduction to the radiography profession and patient care.", "Enrollment in the Evening Radiography Track.")] }],
  });
  await prisma.program.update({ where: { id: radEvening.id }, data: { familyId: radFamily.id, launchCadence: "BIENNIAL", launchTerms: "FALL", defaultCohortSeats: 20 } });

  // North Star year targets (29 rad-techs/yr; cohort capacity 41 to hit it).
  // Targets live on the traditional template and represent the FAMILY goal; both
  // templates' cohorts count toward producing them.
  for (const y of [2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032]) {
    await prisma.programYearTarget.create({ data: { programId: rad.id, year: y, credentialTarget: 29, cohortCapacity: 41 } });
  }
  for (const y of [2026, 2027, 2028, 2029, 2030]) {
    await prisma.programYearTarget.create({ data: { programId: surg.id, year: y, credentialTarget: 14, cohortCapacity: 19 } });
  }

  // Funnels (target vs ballpark actual from the deck). This detailed cohort enters
  // Aug 2025; Radiography is a ~2-year program, so it graduates 2027 (its name, its
  // term dates, and its expected-end all agree).
  const radClassOf2029 = await createFunnel(rad.id, "Class of 2027", 2027, {
    interested: { target: 83, actual: 199 }, // strong top-of-funnel (199 declared pre-Rad)
    qualified: { target: 62, actual: 39 }, // leak: only 39 qualified last cohort
    offered: { target: 52, actual: 26 },
    enrolled: { target: 41, actual: 15 }, // today 15 enroll; North Star needs 41
    completing: { target: 36, actual: 13 },
    licensed: { target: 32, actual: 12 },
    placed: { target: 29, actual: 12 },
    productive: { target: 29, actual: 12 },
  });
  const surgClassOf2029 = await createFunnel(surg.id, "Class of 2027", 2027, {
    interested: { target: 39, actual: 31 },
    qualified: { target: 29 },
    offered: { target: 24 },
    enrolled: { target: 19, actual: 8 }, // enrollment dropped from 18–19 to 8
    completing: { target: 16, actual: 6 },
    licensed: { target: 15, actual: 6 },
    placed: { target: 14, actual: 6 },
    productive: { target: 14, actual: 6 },
  });

  // ----- Offerings (instantiations): bind cohorts to a real calendar ---------
  // The Cohort IS the scheduled run of the timeless template. Anchor the rad
  // Class-of-2029 offering on real term start dates via CohortTerm rows.
  await prisma.cohort.update({ where: { id: radClassOf2029.id }, data: { startDate: new Date(TERM_START_DATES[0]), status: "active" } });
  const radTermRows = await prisma.term.findMany({ where: { programId: rad.id }, orderBy: { index: "asc" } });
  for (const t of radTermRows) {
    const d = TERM_START_DATES[t.index - 1];
    await prisma.cohortTerm.create({ data: { cohortId: radClassOf2029.id, termId: t.id, startDate: d ? new Date(d) : null } });
  }
  // Surg Tech is a ~3-semester program; this detailed cohort enters Aug 2025 and
  // is in-program now (graduates 2027). Anchor its terms to a real calendar too.
  await prisma.cohort.update({ where: { id: surgClassOf2029.id }, data: { startDate: new Date(TERM_START_DATES[0]), status: "active" } });
  const surgTermRows = await prisma.term.findMany({ where: { programId: surg.id }, orderBy: { index: "asc" } });
  for (const t of surgTermRows) {
    const d = TERM_START_DATES[t.index - 1];
    await prisma.cohortTerm.create({ data: { cohortId: surgClassOf2029.id, termId: t.id, startDate: d ? new Date(d) : null } });
  }

  // ----- A constellation of Radiography cohorts across years -----------------
  // Each class enters ~2 years before it graduates; production climbs over time
  // toward the 29/yr workforce goal. (The detailed 2027 cohort above is in-program.)
  const radClassYears: { grad: number; enrolled: number; produced: number }[] = [
    { grad: 2025, enrolled: 12, produced: 8 },
    { grad: 2026, enrolled: 14, produced: 9 },
    { grad: 2028, enrolled: 24, produced: 16 },
    { grad: 2030, enrolled: 33, produced: 22 },
    { grad: 2031, enrolled: 39, produced: 27 },
  ];
  const statusFor = (grad: number) => (grad <= 2026 ? "completed" : grad <= 2027 ? "active" : "planned");
  // Real academic-term offsets (ms from entry) derived from the detailed cohort's
  // term dates, so every RAD cohort places its 5 terms on a real ~2-year calendar.
  const radEntry0 = new Date(TERM_START_DATES[0]).getTime();
  const radTermOffsets = TERM_START_DATES.slice(0, radTermRows.length).map((d) => new Date(d).getTime() - radEntry0);
  for (const o of radClassYears) {
    const co = await createFunnel(rad.id, `Class of ${o.grad}`, o.grad, {
      interested: { target: 83, actual: Math.round(o.enrolled * 4.0) },
      qualified: { target: 62, actual: Math.round(o.enrolled * 1.7) },
      offered: { target: 52, actual: Math.round(o.enrolled * 1.25) },
      enrolled: { target: 41, actual: o.enrolled },
      completing: { target: 36, actual: o.produced },
      licensed: { target: 32, actual: Math.max(0, Math.round(o.produced * 0.92)) },
      placed: { target: 29, actual: Math.max(0, Math.round(o.produced * 0.85)) },
      productive: { target: 29, actual: Math.max(0, Math.round(o.produced * 0.8)) },
    });
    // Enter Aug two years before grad (2-yr program → name = grad year).
    const start = new Date(`${o.grad - 2}-08-18`);
    await prisma.cohort.update({ where: { id: co.id }, data: { startDate: start, status: statusFor(o.grad), plannedSeats: o.enrolled } });
    await prisma.cohortTerm.createMany({
      data: radTermRows.map((t, i) => ({ cohortId: co.id, termId: t.id, startDate: new Date(start.getTime() + (radTermOffsets[i] ?? 0)) })),
    });
  }
  // Two Evening-track cohorts (smaller; biennial) under the same family.
  for (const o of [{ grad: 2028, enrolled: 16, produced: 10 }, { grad: 2030, enrolled: 18, produced: 13 }]) {
    const co = await createFunnel(radEvening.id, `Evening Class of ${o.grad}`, o.grad, {
      interested: { target: 40, actual: Math.round(o.enrolled * 3.5) },
      qualified: { target: 30, actual: Math.round(o.enrolled * 1.6) },
      offered: { target: 24, actual: Math.round(o.enrolled * 1.2) },
      enrolled: { target: 20, actual: o.enrolled },
      completing: { target: 17, actual: o.produced },
      licensed: { target: 15, actual: Math.max(0, Math.round(o.produced * 0.9)) },
      placed: { target: 14, actual: Math.max(0, Math.round(o.produced * 0.85)) },
      productive: { target: 14, actual: Math.max(0, Math.round(o.produced * 0.8)) },
    });
    await prisma.cohort.update({ where: { id: co.id }, data: { startDate: new Date(`${o.grad - 2}-08-18`), status: statusFor(o.grad), plannedSeats: o.enrolled } });
  }

  // Surgical Tech constellation (biennial: one completed, one planned besides the
  // detailed in-program 2027 cohort) — each with real per-term dates.
  const surgEntry0 = new Date(TERM_START_DATES[0]).getTime();
  const surgTermOffsets = TERM_START_DATES.slice(0, surgTermRows.length).map((d) => new Date(d).getTime() - surgEntry0);
  for (const o of [{ grad: 2025, enrolled: 15, produced: 11 }, { grad: 2029, enrolled: 18, produced: 0 }]) {
    const co = await createFunnel(surg.id, `Class of ${o.grad}`, o.grad, {
      interested: { target: 39, actual: Math.round(o.enrolled * 2.5) },
      qualified: { target: 29, actual: Math.round(o.enrolled * 1.5) },
      offered: { target: 24, actual: Math.round(o.enrolled * 1.2) },
      enrolled: { target: 19, actual: o.enrolled },
      completing: { target: 16, actual: o.produced || undefined },
      licensed: { target: 15, actual: o.produced ? Math.round(o.produced * 0.9) : undefined },
      placed: { target: 14, actual: o.produced ? Math.round(o.produced * 0.85) : undefined },
      productive: { target: 14, actual: o.produced ? Math.round(o.produced * 0.8) : undefined },
    });
    const start = new Date(`${o.grad - 2}-08-18`);
    await prisma.cohort.update({ where: { id: co.id }, data: { startDate: start, status: statusFor(o.grad), plannedSeats: o.enrolled } });
    await prisma.cohortTerm.createMany({
      data: surgTermRows.map((t, i) => ({ cohortId: co.id, termId: t.id, startDate: new Date(start.getTime() + (surgTermOffsets[i] ?? 0)) })),
    });
  }

  // Employers & people (clinical partners + staff)
  const firstHealth = await prisma.employer.create({ data: { institutionId: sandhills.id, name: "FirstHealth Moore Regional Hospital", setting: "Acute-care Hospital / Health System", wblSlots: 12, notes: "Primary imaging & OR clinical site" } });
  await prisma.employer.create({ data: { institutionId: sandhills.id, name: "Pinehurst Surgical Clinic", setting: "Ambulatory Surgical Center", wblSlots: 4 } });
  const scotland = await prisma.employer.create({ data: { institutionId: sandhills.id, name: "Scotland Memorial Hospital", setting: "Acute-care Hospital / Health System", wblSlots: 10, notes: "Secondary acute-care imaging clinical site" } });
  const pinehurstOutpatient = await prisma.employer.create({ data: { institutionId: sandhills.id, name: "Pinehurst Outpatient Imaging Center", setting: "Outpatient Imaging Center", wblSlots: 6 } });
  // A night-only imaging center: real slots, but NOT alignment-feasible for a
  // cohort that needs daytime hours — so loop 2 excludes it from placement.
  const nightCenter = await prisma.employer.create({ data: { institutionId: sandhills.id, name: "Night Imaging Center", setting: "Outpatient Imaging Center", wblSlots: 6, notes: "Evening/overnight rotations only" } });
  await prisma.person.create({ data: { institutionId: sandhills.id, name: "Lindsey (Program Lead)", role: "coordinator", email: "lead@sandhills.edu" } });
  await prisma.person.create({ data: { institutionId: sandhills.id, name: "Radiography Faculty 1", role: "instructor" } });
  await prisma.person.create({ data: { institutionId: sandhills.id, name: "Clinical Preceptor — Imaging", role: "preceptor", employerId: firstHealth.id } });

  // ----- Session learning resources (course planning sample) --------------
  {
    const firstSession = await prisma.session.findFirst({ where: { course: { term: { programId: rad.id } } }, orderBy: { number: "asc" }, select: { id: true } });
    if (firstSession) {
      await prisma.sessionResource.createMany({
        data: [
          { sessionId: firstSession.id, kind: "READING", title: "Bontrager Ch. 4 — Upper Limb", estMinutes: 45, sortOrder: 0 },
          { sessionId: firstSession.id, kind: "VIDEO", title: "Positioning demo: PA hand", url: "https://example.edu/video", estMinutes: 12, sortOrder: 1 },
          { sessionId: firstSession.id, kind: "PRACTICE", title: "Lab: 5 hand positions on phantom", detail: "sign off with preceptor", sortOrder: 2 },
          { sessionId: firstSession.id, kind: "HOMEWORK", title: "Worksheet 4 — markers & ID", estMinutes: 30, sortOrder: 3 },
        ],
      });
    }
  }

  // ----- Facilities (supply of physical teaching space) -------------------
  await prisma.facility.createMany({
    data: [
      { institutionId: sandhills.id, name: "Health Sciences 104", kind: "CLASSROOM", building: "Health Sciences", capacity: 36, areaSqft: 900, hours: "Mon–Fri 8a–9p", availability: "open evenings", equipment: "projector, 36 desks, 2 viewboxes" },
      { institutionId: sandhills.id, name: "Health Sciences 106", kind: "CLASSROOM", building: "Health Sciences", capacity: 30, areaSqft: 820, hours: "Mon–Fri 8a–5p", equipment: "projector, 30 desks" },
      { institutionId: sandhills.id, name: "Radiography Energized Lab", kind: "LAB", building: "Health Sciences", capacity: 12, areaSqft: 1400, hours: "Mon–Fri 8a–6p", availability: "by section schedule", equipment: "DR room, CR reader, energized X-ray, positioning sponges, phantoms" },
      { institutionId: sandhills.id, name: "Imaging Sim Suite", kind: "SIM", building: "Health Sciences", capacity: 8, areaSqft: 700, hours: "Mon–Fri 9a–4p", equipment: "VR positioning sim, 2 workstations" },
      { institutionId: sandhills.id, name: "FirstHealth Imaging — Clinical", kind: "CLINICAL", building: "FirstHealth Moore Regional", capacity: 12, hours: "Mon–Sun (rotations)", availability: "day + evening rotations", equipment: "live DR/CT/MRI suites" },
    ],
  });

  // ----- Calendar blocks (190 real blocks) — Sandhills -------------
  let blocks: any[] = [];
  try {
    blocks = JSON.parse(readFileSync(join(__dirname, "seed-data", "calendar_blocks.json"), "utf-8"));
  } catch {
    console.warn("calendar_blocks.json not found — skipping calendar import");
  }
  for (const inst of [sandhills]) {
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

  // ----- Student / SIS layer ----------------------------------------------
  // Real named students populating the Class-of-2029 funnel so every stage can
  // be drilled into by name. The 15 who reached "enrolled" or beyond carry the
  // full academic record: dated course grades, dated KSA assessments, and
  // attendance. Earlier-stage prospects/applicants carry only pipeline status.
  await seedStudents(rad.id, radClassOf2029.id, radCourses, {
    positioning: positioning.id,
    patientCare: patientCare.id,
    radSafety: radSafety.id,
    imageEval: imageEval.id,
  });

  // ----- WBL alignment profiles -------------------------------------------
  const radCohort = await prisma.cohort.findFirst({ where: { programId: rad.id } });
  await prisma.wblProfile.create({
    data: {
      institutionId: sandhills.id,
      subjectType: "LEARNER",
      name: "Radiography Cohort — Class of 2027",
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
  const facultyNames = ["Dr. Angela Rivera", "Brian Chen, R.T.(R)", "Carmen Okafor, R.T.(R)(CT)", "David Whitfield, R.T.(R)", "Erin Salas, R.T.(R)(MR)", "Frank Delgado, R.T.(R)"];
  const facultyPeople: { id: string; name: string }[] = [];
  for (const n of facultyNames) {
    const person = await prisma.person.create({ data: { institutionId: sandhills.id, name: n, role: "instructor" } });
    await prisma.assignment.create({ data: { institutionId: sandhills.id, personId: person.id, programId: rad.id, role: "instructor", fteCommitment: 1.0 } });
    facultyPeople.push({ id: person.id, name: n });
  }
  const coord = await prisma.person.create({ data: { institutionId: sandhills.id, name: "Lindsey Bauer (Program Lead)", role: "coordinator" } });
  await prisma.assignment.create({ data: { institutionId: sandhills.id, personId: coord.id, programId: rad.id, role: "coordinator", fteCommitment: 0.5 } });
  // Clinical preceptors / instructors at the affiliated sites.
  const preceptorNames = ["Maria Santos, R.T.(R)", "James Holloway, R.T.(R)", "Priya Nair, R.T.(R)(CT)", "Tyrone Banks, R.T.(R)", "Hannah Kim, R.T.(R)(MR)", "Luis Moreno, R.T.(R)", "Aisha Bello, R.T.(R)", "Greg Tanaka, R.T.(R)", "Nicole Forbes, R.T.(R)", "Omar Haddad, R.T.(R)(CT)", "Rachel Stein, R.T.(R)", "Devon Pierce, R.T.(R)"];
  const sites = [firstHealth.id, scotland.id, pinehurstOutpatient.id];
  const preceptorPeople: { id: string; name: string; siteIndex: number }[] = [];
  for (let i = 0; i < preceptorNames.length; i++) {
    const prec = await prisma.person.create({ data: { institutionId: sandhills.id, name: preceptorNames[i], role: "preceptor", employerId: sites[i % sites.length] } });
    await prisma.assignment.create({ data: { institutionId: sandhills.id, personId: prec.id, programId: rad.id, role: "preceptor", fteCommitment: 1.0 } });
    preceptorPeople.push({ id: prec.id, name: preceptorNames[i], siteIndex: i % sites.length });
  }

  // ----- Default per-session staffing (incl. co-teaching split hours) ------
  // Give every class/lab a primary instructor (consistent per course) and split
  // a couple of long RAD classes across two instructors with partial contact
  // hours, so workload + the calendar show real, co-taught staffing out of the
  // box. Clinicals get a preceptor from the rotation's site group.
  await seedSessionStaff(rad.id, radClassOf2029.id, facultyPeople, preceptorPeople);

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

  // ----- WBL dated snapshots: per-employer capacity + per-student learner -----
  const radWblStudents = await prisma.student.findMany({
    where: { programId: rad.id, status: { in: ["enrolled", "completed", "placed"] } },
    orderBy: { name: "asc" }, select: { id: true },
  });
  await seedWblSnapshots(
    sandhills.id,
    [
      { id: firstHealth.id, name: firstHealth.name, kind: "firstHealth" },
      { id: scotland.id, name: scotland.name, kind: "scotland" },
      { id: pinehurstOutpatient.id, name: pinehurstOutpatient.name, kind: "pinehurst" },
      { id: nightCenter.id, name: nightCenter.name, kind: "night" },
    ],
    radWblStudents,
  );

  // ===== FOCUSED PORTFOLIO: Radiography · Surgical Technology · Medical Assisting
  // One real, small-scale example told at full depth. Medical Assisting is generated
  // (multi-year cohorts + shared gen-eds); the clinical-partner bench and staff
  // (faculty / preceptors / support) carry active-status, titles, employment type,
  // and affiliation windows. Rosters auto-populate from the roster seeder below.
  {
    const AS_OF = new Date("2026-06-26T00:00:00Z");
    const ex = mulberry32(0x52051e);
    const pick = <T,>(a: T[]): T => a[Math.floor(ex() * a.length)];
    const ri = (lo: number, hi: number) => lo + Math.floor(ex() * (hi - lo + 1));
    const STAFF_FIRST = ["Patricia", "Robert", "Linda", "James", "Barbara", "Michael", "Susan", "David", "Karen", "Richard", "Nancy", "Joseph", "Lisa", "Thomas", "Sandra", "Charles", "Donna", "Mark", "Carol", "Paul", "Michelle", "Steven", "Deborah", "Kenneth", "Angela", "Brian", "Melissa", "Anthony", "Rebecca", "Kevin"];
    const STAFF_LAST = LAST_NAMES;
    const statusFromStart = (start: Date, terms: TimingTerm[]): string => {
      const tm = computeCohortTiming(start, terms, AS_OF);
      return tm.phase === "graduated" ? "completed" : tm.phase === "recruiting" ? "planned" : "active";
    };

    // -- More clinical-partner employers across the Sandhills region ----------
    const EMP = [
      { name: "Sandhills Regional Medical Center", setting: "Acute-care Hospital / Health System", city: "Hamlet", status: "active" },
      { name: "Carolina Imaging Partners", setting: "Outpatient Imaging Center", city: "Southern Pines", status: "active" },
      { name: "Pinehurst Radiology Associates", setting: "Outpatient Imaging Center", city: "Pinehurst", status: "active" },
      { name: "Sandhills Surgery Center", setting: "Ambulatory Surgical Center", city: "Pinehurst", status: "active" },
      { name: "FirstHealth Outpatient Surgery", setting: "Ambulatory Surgical Center", city: "Raeford", status: "active" },
      { name: "Sandhills Family Practice", setting: "Physician Practice / Clinic", city: "Aberdeen", status: "active" },
      { name: "Pinehurst Medical Clinic", setting: "Multispecialty Clinic", city: "Pinehurst", status: "active" },
      { name: "Sandhills Pediatrics", setting: "Physician Practice / Clinic", city: "Southern Pines", status: "active" },
      { name: "AccessCare Urgent Care — Pinehurst", setting: "Urgent Care", city: "Pinehurst", status: "active" },
      { name: "Womack Army Medical Center", setting: "Acute-care Hospital / Health System", city: "Fort Liberty", status: "prospect" },
      { name: "Old North State Imaging (closed)", setting: "Outpatient Imaging Center", city: "Rockingham", status: "archived" },
    ];
    const expandedEmployers: { id: string; name: string; setting: string }[] = [];
    for (const e of EMP) {
      const rec = await prisma.employer.create({ data: { institutionId: sandhills.id, name: e.name, setting: e.setting, city: e.city, status: e.status } });
      expandedEmployers.push({ id: rec.id, name: rec.name, setting: e.setting });
    }
    // Preceptor-eligible sites (everything active that hosts learners on-site).
    const preceptorSites = [
      { id: firstHealth.id, name: firstHealth.name }, { id: scotland.id, name: scotland.name }, { id: pinehurstOutpatient.id, name: pinehurstOutpatient.name },
      ...expandedEmployers.filter((e) => !e.name.includes("closed")),
    ];

    // -- Preceptors at partner sites (1–3 each) ------------------------------
    const PRECEPTOR_TITLES = ["Lead Clinical Preceptor", "Clinical Preceptor", "Staff Preceptor", "Charge Nurse / Preceptor", "Lead Technologist"];
    const allPreceptors: { id: string }[] = [];
    for (const site of preceptorSites) {
      const n = ri(1, 3);
      for (let i = 0; i < n; i++) {
        const active = ex() > 0.12;
        const startYr = ri(2017, 2024);
        const p = await prisma.person.create({
          data: {
            institutionId: sandhills.id, name: `${pick(STAFF_FIRST)} ${pick(STAFF_LAST)}`,
            role: "preceptor", title: pick(PRECEPTOR_TITLES), employerId: site.id,
            employmentType: "preceptor", active,
            startDate: new Date(`${startYr}-01-15`), endDate: active ? null : new Date(`${ri(startYr + 1, 2025)}-06-30`),
            email: `precept.${pick(STAFF_LAST).toLowerCase()}.${i}.${site.id.slice(-4)}@example.org`,
          },
        });
        allPreceptors.push({ id: p.id });
      }
    }

    // -- Support staff (advising, admin, sim, clinical placement) ------------
    const SUPPORT = [
      { title: "Health Sciences Academic Advisor", type: "full-time" }, { title: "Admissions & Enrollment Specialist", type: "full-time" },
      { title: "Clinical Placement Coordinator", type: "full-time" }, { title: "Simulation Lab Technician", type: "full-time" },
      { title: "Administrative Assistant", type: "full-time" }, { title: "Retention & Success Coach", type: "part-time" },
      { title: "Skills Lab Aide", type: "part-time" }, { title: "Health Sciences Dean (Office)", type: "full-time" },
    ];
    for (const s of SUPPORT) {
      const active = ex() > 0.1;
      const startYr = ri(2015, 2024);
      await prisma.person.create({
        data: {
          institutionId: sandhills.id, name: `${pick(STAFF_FIRST)} ${pick(STAFF_LAST)}`,
          role: "support", title: s.title, employmentType: s.type, active,
          startDate: new Date(`${startYr}-08-01`), endDate: active ? null : new Date(`${ri(startYr + 1, 2025)}-12-15`),
        },
      });
    }

    // -- Allied-health families: occupation → family → template → cohorts -----
    type FamCfg = { soc: string; occ: string; fam: string; prog: string; ptype: string; cred: string; prefix: string; spanWeeks: number; nTerms: number; seats: number; goal: number; grads: number[] };
    const FAMILIES: FamCfg[] = [
      { soc: "31-9092", occ: "Medical Assistants", fam: "Medical Assisting", prog: "Medical Assisting", ptype: "Traditional Full Time", cred: "Diploma", prefix: "MED", spanWeeks: 52, nTerms: 2, seats: 28, goal: 30, grads: [2024, 2025, 2026, 2027, 2028] },
    ];
    const FAC_TITLES = ["Program Director", "Lead Instructor", "Clinical Coordinator", "Instructor"];
    const FAC_TYPES = ["full-time", "full-time", "full-time", "adjunct"];

    for (const fc of FAMILIES) {
      const occ = await prisma.occupation.create({ data: { institutionId: sandhills.id, socCode: fc.soc, title: fc.occ } });
      const prog = await createProgram({ institutionId: sandhills.id, occupationId: occ.id, name: fc.prog, programType: fc.ptype, credential: fc.cred, terms: genTerms(fc.prefix, fc.spanWeeks, fc.nTerms, true) });
      const progYears = Math.max(0, Math.round(fc.spanWeeks / 52));
      await prisma.program.update({ where: { id: prog.id }, data: { defaultCohortSeats: fc.seats, launchCadence: "ANNUAL", launchTerms: "FALL", termSlots: "FALL,SPRING,SUMMER" } });
      const fam = await prisma.programFamily.create({ data: { institutionId: sandhills.id, occupationId: occ.id, name: fc.fam, description: `${fc.fam} program templates producing ${fc.occ.toLowerCase()} for the Sandhills region.` } });
      await prisma.program.update({ where: { id: prog.id }, data: { familyId: fam.id } });
      // Service-area demand so the family has a workforce anchor + North-Star math.
      const saRegion = regions["SERVICE_AREA"];
      for (const y of [2025, 2026, 2027, 2028, 2029, 2030]) {
        await prisma.demandProjection.create({ data: { institutionId: sandhills.id, occupationId: occ.id, regionId: saRegion, year: y, jobs: fc.goal * 8, openings: fc.goal, growthPct: 0.12, replacementPct: 0.88, turnoverPct: 0.2 } });
        await prisma.programYearTarget.create({ data: { programId: prog.id, year: y, credentialTarget: fc.goal, cohortCapacity: Math.round(fc.seats * 1.2) } });
      }

      // This family's faculty (with active-status + employment window).
      const faculty: { id: string }[] = [];
      for (let i = 0; i < FAC_TITLES.length; i++) {
        const active = ex() > 0.12;
        const startYr = ri(2014, 2023);
        const p = await prisma.person.create({
          data: {
            institutionId: sandhills.id, name: `${pick(STAFF_FIRST)} ${pick(STAFF_LAST)}`,
            role: "instructor", title: `${fc.fam} ${FAC_TITLES[i]}`, employmentType: FAC_TYPES[i], active,
            startDate: new Date(`${startYr}-08-01`), endDate: active ? null : new Date(`${ri(startYr + 1, 2025)}-05-31`),
            email: `fac.${fc.prefix.toLowerCase()}.${i}@sandhills.edu`,
          },
        });
        faculty.push({ id: p.id });
      }
      const progTerms = await prisma.term.findMany({ where: { programId: prog.id }, orderBy: { index: "asc" }, select: { id: true, index: true, name: true, startWeek: true, endWeek: true } });
      const timingTerms: TimingTerm[] = progTerms.map((t) => ({ index: t.index, name: t.name, startWeek: t.startWeek, endWeek: t.endWeek }));
      const WK_MS = 7 * 24 * 3600 * 1000;

      // Cohorts across grad years, sized + staged with a funnel; rosters auto-seed.
      for (const gy of fc.grads) {
        const enrolled = Math.round(fc.seats * (0.55 + ex() * 0.45));
        const produced = Math.round(enrolled * (0.68 + ex() * 0.18));
        const co = await createFunnel(prog.id, `Class of ${gy}`, gy, {
          interested: { target: Math.round(fc.seats * 2.0), actual: Math.round(enrolled * 3.4) },
          qualified: { target: Math.round(fc.seats * 1.5), actual: Math.round(enrolled * 1.7) },
          offered: { target: Math.round(fc.seats * 1.25), actual: Math.round(enrolled * 1.2) },
          enrolled: { target: fc.seats, actual: enrolled },
          completing: { target: Math.round(fc.seats * 0.85), actual: produced },
          licensed: { target: Math.round(fc.goal * 1.05), actual: Math.round(produced * 0.92) },
          placed: { target: fc.goal, actual: Math.round(produced * 0.86) },
          productive: { target: fc.goal, actual: Math.round(produced * 0.8) },
        });
        const startDate = new Date(`${gy - progYears}-08-15`);
        await prisma.cohort.update({ where: { id: co.id }, data: { startDate, status: statusFromStart(startDate, timingTerms), plannedSeats: enrolled } });
        // Bind each template term to a real calendar date for this offering, so the
        // semester view can place it on a timeline (current term / expected end).
        await prisma.cohortTerm.createMany({
          data: progTerms.map((t) => ({ cohortId: co.id, termId: t.id, startDate: new Date(startDate.getTime() + ((t.startWeek ?? 1) - 1) * WK_MS) })),
        });
        await seedCohortStaff(co.id, prog.id, faculty, allPreceptors);
      }
    }

    // -- Backfill the original Sandhills people with the new descriptive fields.
    await prisma.person.updateMany({ where: { name: "Lindsey (Program Lead)" }, data: { title: "Radiography Program Director", employmentType: "full-time", startDate: new Date("2016-08-01") } });
    await prisma.person.updateMany({ where: { name: "Radiography Faculty 1" }, data: { title: "Radiography Lead Instructor", employmentType: "full-time", startDate: new Date("2019-08-01") } });
    await prisma.person.updateMany({ where: { name: "Clinical Preceptor — Imaging" }, data: { title: "Lead Clinical Preceptor", employmentType: "preceptor", startDate: new Date("2018-01-15") } });

    console.log(`Expansion: +${EMP.length} employers, +${FAMILIES.length} families/programs, +${allPreceptors.length} preceptors.`);
  }

  // ----- Real student rosters for every started / recruiting cohort ----------
  // Each past/present instantiation gets a roster sized + staged to where it is in
  // the pipeline: graduated → completed/licensed/placed/productive (from its funnel
  // actuals); in-program → enrolled (+ some completing in the final year); recruiting
  // (entry next year) → prospects/applicants/admitted. Not-yet-started cohorts get
  // goals only (no students). The detailed Class of 2027 already has its own roster.
  {
    const AS_OF = new Date("2026-06-26T00:00:00Z"); // deterministic "today" for the seed
    const STATUS_STAGE: Record<string, string | null> = { prospect: "interested", applicant: "qualified", admitted: "offered", enrolled: "enrolled", completed: "completing", licensed: "licensed", placed: "placed", productive: "productive" };
    const cohortsAll = await prisma.cohort.findMany({ include: { _count: { select: { students: true } }, stages: true, cohortTerms: { select: { termId: true, startDate: true } }, program: { select: { id: true, defaultCohortSeats: true, terms: { select: { id: true, index: true, name: true, startWeek: true, endWeek: true } } } } } });
    let made = 0;
    for (const co of cohortsAll) {
      if (co._count.students > 0) continue; // already seeded (e.g. rad Class of 2027)
      // Phase is derived from the program's ACTUAL structure + the cohort's REAL
      // per-term calendar dates (no fixed program-length assumption).
      const ordered = [...co.program.terms].sort((a, b) => a.index - b.index);
      const terms: TimingTerm[] = ordered.map((t) => ({ index: t.index, name: t.name, startWeek: t.startWeek, endWeek: t.endWeek }));
      const ctById = new Map(co.cohortTerms.map((ct) => [ct.termId, ct.startDate]));
      const realStarts = ordered.map((t) => ctById.get(t.id) ?? null);
      const tm = computeCohortTiming(co.startDate, terms, AS_OF, realStarts);
      if (tm.phase === "unscheduled") continue; // no start date → goals only
      const E = Math.round(co.plannedSeats ?? co.program.defaultCohortSeats ?? 40);
      const sa = (k: string): number | null => { const s = co.stages.find((x) => x.stageKey === k); return s?.actualNumber != null ? Math.round(s.actualNumber) : null; };
      const statuses: string[] = [];
      const pushN = (st: string, n: number) => { for (let i = 0; i < Math.max(0, n); i++) statuses.push(st); };
      if (tm.phase === "recruiting") {
        // Only the cohort entering NEXT (within ~1 year) is actively recruiting;
        // anything further out is goals-only.
        const monthsOut = tm.startDate ? (tm.startDate.getTime() - AS_OF.getTime()) / (30 * 24 * 3600 * 1000) : 99;
        if (monthsOut > 14) continue;
        const I = sa("interested") ?? Math.round(E * 1.5);
        const Q = sa("qualified") ?? Math.round(E * 1.25);
        const O = sa("offered") ?? Math.round(E * 1.1);
        pushN("prospect", I - Q); pushN("applicant", Q - O); pushN("admitted", O);
      } else if (tm.phase === "graduated") {
        const C = sa("completing") ?? Math.round(E * 0.7);
        const L = sa("licensed") ?? Math.round(C * 0.9);
        const P = sa("placed") ?? Math.round(L * 0.9);
        const Pr = sa("productive") ?? Math.round(P * 0.9);
        pushN("productive", Pr); pushN("placed", P - Pr); pushN("licensed", L - P); pushN("completed", C - L); pushN("enrolled", E - C);
      } else {
        // in-program — completion ramps with how far along the cohort is.
        const pct = tm.pctElapsed ?? 0.3;
        const C = pct > 0.75 ? Math.round(E * 0.5) : pct > 0.5 ? Math.round(E * 0.2) : 0;
        pushN("completed", C); pushN("enrolled", E - C);
      }
      if (statuses.length === 0) continue;
      const gradYear = co.startDate ? co.startDate.getUTCFullYear() + Math.round(tm.totalWeeks / 52) : (co.entryYear ?? 0);
      const rng = mulberry32(gradYear * 131 + E * 7 + statuses.length);
      const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
      const sections = Math.max(1, Math.ceil(E / 12));
      const entryYear = co.startDate ? co.startDate.getUTCFullYear() : (co.entryYear ?? gradYear - 2);
      const data = statuses.map((st, i) => ({
        programId: co.program.id, cohortId: co.id,
        name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
        email: `s${gradYear}.${i}.${co.id.slice(-4)}@example.edu`,
        status: st, stageKey: STATUS_STAGE[st] ?? null, entryYear,
        sectionIndex: (i % sections) + 1,
      }));
      await prisma.student.createMany({ data });
      made += data.length;
    }
    console.log(`Seeded ${made} students across started/recruiting cohorts.`);
  }

  // ----- WBL placements: the "secured" record behind asked-vs-secured ---------
  // Source each placement from real instantiation data: clinical-eligible students
  // in started cohorts get hosted at a partner site, dated into the cohort's clinical
  // window, with a status that reflects whether that rotation is past (completed),
  // current (active), or upcoming (planned — the "asked but not yet secured" gap).
  {
    const AS_OF = new Date("2026-06-26T00:00:00Z");
    const WEEK_MS = 7 * 24 * 3600 * 1000;
    const wr = mulberry32(0x91ace5);
    const wpick = <T,>(a: T[]): T => a[Math.floor(wr() * a.length)];
    const hostable = (await prisma.employer.findMany({
      where: { institutionId: sandhills.id, status: { in: ["active", "paused"] } },
      select: { id: true, setting: true },
    })).filter((e) => !/closed|retail pharmacy/i.test(e.setting ?? ""));
    const MODALITIES = ["General", "CT", "MRI", "Mammography", "OR / Surgical", "Med-Surg", "ICU", "Outpatient", "Emergency"];
    const cohorts = await prisma.cohort.findMany({
      where: { program: { institutionId: sandhills.id }, startDate: { not: null } },
      include: {
        program: { select: { terms: { select: { index: true, startWeek: true, endWeek: true }, orderBy: { index: "asc" } } } },
        students: { where: { status: { in: ["enrolled", "completed", "licensed", "placed", "productive"] } }, select: { id: true } },
      },
    });
    const rows: { studentId: string; employerId: string; cohortId: string; startDate: Date; endDate: Date; hoursPerWeek: number; modality: string; status: string }[] = [];
    for (const co of cohorts) {
      if (!co.startDate || !hostable.length) continue;
      // Clinical terms = term index >= 2 (first term is pre-clinical foundations).
      const clinTerms = co.program.terms.filter((t) => t.index >= 2);
      if (!clinTerms.length) continue;
      for (const st of co.students) {
        // 1–2 rotations per eligible student across the clinical terms.
        const nRot = 1 + (wr() < 0.5 ? 1 : 0);
        const chosen = [...clinTerms].sort(() => wr() - 0.5).slice(0, nRot);
        for (const t of chosen) {
          const start = new Date(co.startDate.getTime() + ((t.startWeek ?? 1) - 1) * WEEK_MS);
          const end = new Date(co.startDate.getTime() + ((t.endWeek ?? 16)) * WEEK_MS);
          const status = end < AS_OF ? "completed" : start > AS_OF ? "planned" : "active";
          rows.push({
            studentId: st.id, employerId: wpick(hostable).id, cohortId: co.id,
            startDate: start, endDate: end, hoursPerWeek: wpick([16, 20, 24, 24, 32]),
            modality: wpick(MODALITIES), status,
          });
        }
      }
    }
    if (rows.length) {
      for (let i = 0; i < rows.length; i += 500) await prisma.wblPlacement.createMany({ data: rows.slice(i, i + 500) });
    }
    const secured = rows.filter((r) => r.status !== "planned").length;
    console.log(`Seeded ${rows.length} WBL placements (${secured} secured, ${rows.length - secured} planned/asked).`);
  }

  // ----- Master schedule: real bookable meetings (rooms + staff), auto-placed --
  // Expand each active cohort's courses into sections (by enrollment vs room size),
  // attach the cohort's real instructor, then let the space engine place every
  // meeting on a conflict-free (weekday, time, room) across the whole institution.
  // This is the shared source of truth behind the offering calendars and the
  // institution-wide master space calendar.
  {
    const WK_MS = 7 * 24 * 3600 * 1000;
    const insts = await prisma.institution.findMany({ select: { id: true } });
    let totalMeetings = 0, totalUnroomed = 0;
    for (const inst of insts) {
      const rooms = await prisma.facility.findMany({ where: { institutionId: inst.id, status: "active" }, select: { id: true, name: true, kind: true, capacity: true } });
      const cohorts = await prisma.cohort.findMany({
        where: { status: "active", program: { institutionId: inst.id } },
        include: {
          cohortTerms: { select: { termId: true, startDate: true } },
          sessionStaff: { where: { cohortId: { not: null } }, select: { personId: true, contactHours: true, session: { select: { kind: true, courseId: true } } } },
          program: { select: { defaultCohortSeats: true, terms: { select: { id: true, index: true, startWeek: true, endWeek: true, courses: { select: { id: true, sessions: { select: { kind: true, maxStudents: true, lengthHours: true, dayOfWeek: true, startTime: true } } } } } } } },
        },
      });
      const reqs: PlaceReq[] = [];
      const meta = new Map<string, { cohortId: string; courseId: string; kind: string; sectionIndex: number; sectionCount: number; seats: number; lengthHours: number; termIndex: number; startWeek: number; endWeek: number; staffPersonId: string | null }>();
      for (const co of cohorts) {
        const E = Math.round(co.plannedSeats ?? co.program.defaultCohortSeats ?? 40);
        const ctStart = new Map(co.cohortTerms.map((ct) => [ct.termId, ct.startDate]));
        // Primary instructor per (course, kind): the person with the most contact hours.
        const staffByCK = new Map<string, Map<string, number>>();
        for (const si of co.sessionStaff) {
          if (!si.session) continue;
          const k = `${si.session.courseId}#${si.session.kind}`;
          const m = staffByCK.get(k) ?? new Map<string, number>();
          m.set(si.personId, (m.get(si.personId) ?? 0) + si.contactHours);
          staffByCK.set(k, m);
        }
        const pickStaff = (courseId: string, kind: string): string | null => {
          const m = staffByCK.get(`${courseId}#${kind}`);
          return m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
        };
        for (const t of co.program.terms) {
          const termStart = ctStart.get(t.id);
          if (!termStart) continue; // only schedule terms with a real date
          const tw = (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1;
          const weekStartMs = termStart.getTime();
          const weekEndMs = termStart.getTime() + tw * WK_MS;
          for (const c of t.courses) {
            const kindInfo = new Map<string, { maxStudents: number; lengthHours: number; day: string | null; time: string | null }>();
            for (const s of c.sessions) {
              if (!kindInfo.has(s.kind)) kindInfo.set(s.kind, { maxStudents: s.maxStudents, lengthHours: s.lengthHours, day: s.dayOfWeek ?? null, time: s.startTime ?? null });
            }
            for (const [kind, info] of kindInfo) {
              const cap = Math.max(1, info.maxStudents || (kind === "CLINICAL" ? 8 : 30));
              const sections = Math.max(1, Math.ceil(E / cap));
              const seatsPer = Math.ceil(E / sections);
              const staffPersonId = pickStaff(c.id, kind);
              const lengthHours = info.lengthHours || (kind === "CLINICAL" ? 8 : 2);
              for (let si = 1; si <= sections; si++) {
                const id = `${co.id}:${c.id}:${kind}:${si}`;
                reqs.push({
                  id, cohortId: co.id, sectionIndex: si, kind, seats: seatsPer, lengthHours,
                  weekStartMs, weekEndMs, staffPersonId,
                  preferDay: (info.day as Weekday) || undefined, preferStartMin: info.time ? toMin(info.time) : undefined,
                });
                meta.set(id, { cohortId: co.id, courseId: c.id, kind, sectionIndex: si, sectionCount: sections, seats: seatsPer, lengthHours, termIndex: t.index, startWeek: t.startWeek ?? 1, endWeek: t.endWeek ?? 16, staffPersonId });
              }
            }
          }
        }
      }
      if (!reqs.length) continue;
      const { placements, unroomed } = autoSchedule(reqs, rooms);
      // Clinical meetings are hosted at partner sites — attribute each to a real
      // clinical-capable employer (round-robin) so the master calendar carries
      // campus rooms AND partner rotations on the same timeline.
      const clinicalHosts = await prisma.employer.findMany({
        where: { institutionId: inst.id, status: "active", OR: [{ setting: { contains: "Hospital" } }, { setting: { contains: "Imaging" } }, { setting: { contains: "Surgical" } }, { setting: { contains: "Clinic" } }] },
        orderBy: { name: "asc" }, select: { id: true },
      });
      let clinIdx = 0;
      const rows = reqs.map((r) => {
        const m = meta.get(r.id)!;
        const p = placements.get(r.id)!;
        const employerId = m.kind === "CLINICAL" && clinicalHosts.length ? clinicalHosts[(clinIdx++) % clinicalHosts.length].id : null;
        return { cohortId: m.cohortId, courseId: m.courseId, kind: m.kind, sectionIndex: m.sectionIndex, sectionCount: m.sectionCount, seats: m.seats, dayOfWeek: p.dayOfWeek, startTime: toHHMM(p.startMin), lengthHours: m.lengthHours, termIndex: m.termIndex, startWeek: m.startWeek, endWeek: m.endWeek, facilityId: p.facilityId, employerId, staffPersonId: m.staffPersonId };
      });
      for (let i = 0; i < rows.length; i += 500) await prisma.meetingPattern.createMany({ data: rows.slice(i, i + 500) });
      totalMeetings += rows.length; totalUnroomed += unroomed.length;
    }
    console.log(`Scheduled ${totalMeetings} meetings (${totalUnroomed} unroomed — space pressure).`);
  }

  // ===== ALIGNMENT ENGINE — deep build-out for the Radiography family ========
  // Structured intakes (motivations/constraints/capacities, tiered + binding) on a
  // slice of RAD learners and the clinical partners, plus the full intervention
  // library from the North-Star plan (lanes × stages, sequenced, with owners,
  // priority populations, and cost bands).
  {
    const radFam = await prisma.programFamily.findFirst({ where: { name: "Radiography", institutionId: sandhills.id } });
    const focusFams = await prisma.programFamily.findMany({ where: { institutionId: sandhills.id, name: { in: ["Radiography", "Surgical Technology", "Medical Assisting"] } }, select: { id: true } });
    if (radFam) {
      // -- Learner alignment intakes: archetypes drawn from the framework's
      //    healthcare cohort (M: benefits-cliff single parent; T: internationally
      //    trained; plus an explorer, a career-changer, and a settled traditional).
      type TagSeed = { layer: string; code: string; tier?: number; binding?: boolean; conditionalOn?: string };
      const ARCHETYPES: { narrative: string; tags: TagSeed[] }[] = [
        { // "Learner M" — aligned but constrained
          narrative: "Second run at college; raising two kids on a retail schedule that changes weekly. The insurance is the real engine but she won't raise it herself. Wants to feel like a professional. Caregiving years read as clinical assets.",
          tags: [
            { layer: "MOTIVATION", code: "B.2.b", tier: 1 }, { layer: "MOTIVATION", code: "B.3.a", tier: 2 },
            { layer: "MOTIVATION", code: "A.3.a", tier: 2 }, { layer: "MOTIVATION", code: "C.2.a", tier: 2 },
            { layer: "MOTIVATION", code: "D.1.a", tier: 2, conditionalOn: "B.3.a" }, { layer: "MOTIVATION", code: "F.3.a", tier: 3 },
            { layer: "CONSTRAINT", code: "G.3.b", binding: true }, { layer: "CONSTRAINT", code: "J.4.b", binding: true },
            { layer: "CONSTRAINT", code: "H.1.c", binding: true }, { layer: "CONSTRAINT", code: "H.6.a", binding: true },
            { layer: "CONSTRAINT", code: "I.1.c", binding: true },
            { layer: "CAPACITY", code: "Q.7" }, { layer: "CAPACITY", code: "U.7" },
          ] },
        { // "Learner T" — internationally trained, credential non-transfer
          narrative: "Clinical officer trained abroad; credentials don't transfer cleanly, currently working as an aide. Sends money home monthly. Deeply settled on imaging; the question is recognition, not direction.",
          tags: [
            { layer: "MOTIVATION", code: "A.3.a", tier: 1 }, { layer: "MOTIVATION", code: "B.4.a", tier: 2 },
            { layer: "MOTIVATION", code: "D.1.a", tier: 2 }, { layer: "MOTIVATION", code: "C.2.a", tier: 3 },
            { layer: "CONSTRAINT", code: "L.1.a", binding: true }, { layer: "CONSTRAINT", code: "H.1.c", binding: true },
            { layer: "CONSTRAINT", code: "G.1.a", binding: false },
            { layer: "CAPACITY", code: "R.3" }, { layer: "CAPACITY", code: "Q.1" }, { layer: "CAPACITY", code: "T.1" },
          ] },
        { // Explorer — Q4 under pressure
          narrative: "Declared pre-Rad after a career fair but hasn't tested it. Working nights stocking; car is unreliable. Curious about CT but hasn't seen a real department.",
          tags: [
            { layer: "MOTIVATION", code: "A.1.b", tier: 2 }, { layer: "MOTIVATION", code: "C.1.a", tier: 3 },
            { layer: "CONSTRAINT", code: "H.1.c", binding: true }, { layer: "CONSTRAINT", code: "I.2.b", binding: true },
            { layer: "CONSTRAINT", code: "N.1.a", binding: true }, { layer: "CONSTRAINT", code: "O.2.a", binding: false },
          ] },
        { // Career changer — settled, equipped
          narrative: "Twelve years in manufacturing QA; plant downsized. Chose imaging deliberately after shadowing a friend. Savings runway for one year; spouse carries benefits.",
          tags: [
            { layer: "MOTIVATION", code: "A.4.a", tier: 1 }, { layer: "MOTIVATION", code: "B.4.a", tier: 2 },
            { layer: "MOTIVATION", code: "C.1.a", tier: 3 }, { layer: "MOTIVATION", code: "F.1.a", tier: 3 },
            { layer: "CONSTRAINT", code: "G.2.a", binding: false },
            { layer: "CAPACITY", code: "Q.1" }, { layer: "CAPACITY", code: "T.1" }, { layer: "CAPACITY", code: "W.1" },
          ] },
        { // Traditional settled student, first-gen
          narrative: "Straight from high school HOSA; wants to be the first medical professional in the family. Financially thin but flexible; grandmother helps with transport.",
          tags: [
            { layer: "MOTIVATION", code: "A.2.a", tier: 1 }, { layer: "MOTIVATION", code: "D.3.b", tier: 2 },
            { layer: "MOTIVATION", code: "D.2.b", tier: 3 }, { layer: "MOTIVATION", code: "F.3.a", tier: 3 },
            { layer: "CONSTRAINT", code: "H.4.d", binding: false }, { layer: "CONSTRAINT", code: "O.2.a", binding: true },
            { layer: "CAPACITY", code: "X.1" }, { layer: "CAPACITY", code: "U.7" },
          ] },
      ];
      const radStudents = await prisma.student.findMany({
        where: { status: "enrolled", program: { familyId: { in: focusFams.map((f) => f.id) } } },
        orderBy: { name: "asc" }, take: 15, select: { id: true },
      });
      let li = 0;
      for (const st of radStudents) {
        const a = ARCHETYPES[li % ARCHETYPES.length];
        li += 1;
        await prisma.alignmentProfile.create({
          data: {
            subjectType: "LEARNER", studentId: st.id, checkpoint: "P0", mvdTier: 2,
            narrative: a.narrative, conductedBy: "Lindsey (Program Lead)",
            tags: { create: a.tags.map((t) => ({ layer: t.layer, code: t.code, tier: t.tier ?? null, binding: t.binding ?? false, conditionalOn: t.conditionalOn ?? null })) },
          },
        });
      }

      // -- Employer alignment intakes: the health system, the imaging center, the
      //    night center, and a skilled-nursing partner — different quadrants.
      const empIntakes: { name: string; narrative: string; tags: TagSeed[] }[] = [
        { name: "FirstHealth Moore Regional Hospital",
          narrative: "Pipeline is Tier 1 — a retirement wave is visible in the imaging department. HR wants apprenticeship; the modality leads are stretched. Boss, HR and front-line supervisors mostly aligned.",
          tags: [
            { layer: "MOTIVATION", code: "EA.1.a", tier: 1 }, { layer: "MOTIVATION", code: "EA.1.d", tier: 2 },
            { layer: "MOTIVATION", code: "EB.2.a", tier: 3 }, { layer: "MOTIVATION", code: "EC.1.a", tier: 3 },
            { layer: "CONSTRAINT", code: "EC1.a", binding: true }, { layer: "CONSTRAINT", code: "EC4.a", binding: true },
            { layer: "CAPACITY", code: "EP1.a" }, { layer: "CAPACITY", code: "EP2.a" }, { layer: "CAPACITY", code: "EP2.b" },
            { layer: "CAPACITY", code: "EP3.a" }, { layer: "CAPACITY", code: "EP6.a" }, { layer: "CAPACITY", code: "EP6.b" }, { layer: "CAPACITY", code: "EP6.d" },
          ] },
        { name: "Pinehurst Outpatient Imaging Center",
          narrative: "Long relationship with the program; genuinely open, no sharp strategic agenda. Day-shift operation with steady volume; happy to host but can't pay.",
          tags: [
            { layer: "MOTIVATION", code: "EE.2.a", tier: 2 }, { layer: "MOTIVATION", code: "ED.1.a", tier: 3 },
            { layer: "CONSTRAINT", code: "EC3.a", binding: true }, { layer: "CONSTRAINT", code: "EC6.a", binding: true },
            { layer: "CAPACITY", code: "EP1.a" }, { layer: "CAPACITY", code: "EP2.b" },
          ] },
        { name: "Night Imaging Center",
          narrative: "Evening/overnight operation. Wants try-before-hire on the night shift where turnover hurts most. Small team, one preceptor, but real conversion intent.",
          tags: [
            { layer: "MOTIVATION", code: "EA.1.b", tier: 1 }, { layer: "MOTIVATION", code: "EA.1.a", tier: 2 },
            { layer: "CONSTRAINT", code: "EC1.a", binding: true }, { layer: "CONSTRAINT", code: "EC5.a", binding: false },
            { layer: "CAPACITY", code: "EP6.c" }, { layer: "CAPACITY", code: "EP6.a" }, { layer: "CAPACITY", code: "EP1.a" },
          ] },
        { name: "Scotland Memorial Hospital",
          narrative: "Hosts because the system expects it; leadership churn has left no internal champion. Real capacity on paper — supervision is the question each semester.",
          tags: [
            { layer: "MOTIVATION", code: "EE.1.a", tier: 2 }, { layer: "MOTIVATION", code: "ED.1.a", tier: 3 },
            { layer: "CONSTRAINT", code: "EC5.b", binding: true }, { layer: "CONSTRAINT", code: "EC7.a", binding: true },
            { layer: "CAPACITY", code: "EP2.a" }, { layer: "CAPACITY", code: "EP4.a" },
          ] },
      ];
      for (const e of empIntakes) {
        const emp = await prisma.employer.findFirst({ where: { institutionId: sandhills.id, name: e.name }, select: { id: true } });
        if (!emp) continue;
        await prisma.alignmentProfile.create({
          data: {
            subjectType: "EMPLOYER", employerId: emp.id, checkpoint: "P0", mvdTier: 2,
            narrative: e.narrative, conductedBy: "Lindsey (Program Lead)",
            tags: { create: e.tags.map((t) => ({ layer: t.layer, code: t.code, tier: t.tier ?? null, binding: t.binding ?? false, conditionalOn: t.conditionalOn ?? null })) },
          },
        });
      }

      // -- Intervention library: the North-Star plan's lanes × stages, sequenced.
      const IV = (lane: string, stage: string, seq: number, title: string, description: string, populations: string, lo?: number, hi?: number, owner?: string, targetStageKey?: string, status = "proposed") =>
        ({ familyId: radFam.id, lane, stage, sequence: seq, title, description, populations, estCostLow: lo ?? null, estCostHigh: hi ?? null, owner: owner ?? null, targetStageKey: targetStageKey ?? null, status });
      await prisma.intervention.createMany({
        data: [
          // Middle schools (~$5–10K)
          IV("MIDDLE_SCHOOL", "AWARENESS", 1, "Imaging careers in existing CTE/counseling", "Embed imaging careers (with job-quality context) in existing career exploration.", "K-12", 5000, 10000, "K-12 counselors", "interested"),
          IV("MIDDLE_SCHOOL", "READINESS", 2, "Math/science course-taking encouragement", "Encourage math & science course-taking through existing advising.", "K-12", undefined, undefined, "K-12 counselors"),
          IV("MIDDLE_SCHOOL", "SUPPORTS", 3, "Counselor awareness via shared materials", "Shared materials so counselors can speak to imaging pathways.", "K-12"),
          // High schools (~$25–40K)
          IV("HIGH_SCHOOL", "AWARENESS", 1, "Health science CTE pathway emphasis + HOSA", "Health science CTE emphasis; HOSA identity-building; Rad/MRI/CT modality exposure so students don't conflate imaging careers.", "K-12", 25000, 40000, "CTE coordinators", "interested"),
          IV("HIGH_SCHOOL", "READINESS", 2, "A&P / algebra / chemistry advising + dual enrollment", "Course-taking guidance for competitive admission; dual enrollment in prereqs before graduation.", "K-12", undefined, undefined, "HS counselors + Sandhills advising", "qualified"),
          IV("HIGH_SCHOOL", "APPLICATION", 3, "Counselor briefings + warm handoffs + FAFSA", "Briefings on competitive admission; warm handoffs to Sandhills advising; FAFSA support tied to health-career planning.", "K-12", undefined, undefined, "HS counselors", "qualified"),
          IV("HIGH_SCHOOL", "WBL", 4, "Job shadows / hospital visits through existing CTE", "Structured observation at partner sites through existing CTE.", "K-12", undefined, undefined, "CTE + clinical partners"),
          IV("HIGH_SCHOOL", "SUPPORTS", 5, "Counselor support via shared protocol", "Current information on admission requirements, application timing, observation-hour expectations.", "K-12"),
          // Community college (~$120–180K)
          IV("COMMUNITY_COLLEGE", "AWARENESS", 1, "Audit & segment the declared pre-Rad roster", "Segment the 199 declared pre-Rad: active vs dormant, prereq progress, K-12 vs adult learner.", "Declared pre-Rad, Adult learners", 120000, 180000, "Program lead", "interested", "active"),
          IV("COMMUNITY_COLLEGE", "AWARENESS", 2, "Direct outreach with pathway info", "Personalized status + next-step guidance to every declared pre-Rad student.", "Declared pre-Rad", undefined, undefined, "Advising", "qualified", "planned"),
          IV("COMMUNITY_COLLEGE", "READINESS", 3, "Prereq advising at milestones + gateway support", "Proactive advising tied to prereq milestones (not student-initiated); gateway-course support.", "Declared pre-Rad, First-generation", undefined, undefined, "Advising", "qualified"),
          IV("COMMUNITY_COLLEGE", "APPLICATION", 4, "Application readiness sessions", "Competitive-admission requirements demystified; close the 199 → 62 qualified → 52 offers → 41 enrolled gap.", "Declared pre-Rad, Adult learners", undefined, undefined, "Admissions", "enrolled"),
          IV("COMMUNITY_COLLEGE", "WBL", 5, "Coordinate clinical placements with regional employers", "Placement coordination against pooled cohort constraints (evening share, proximity).", "All learners", undefined, undefined, "Clinical coordinator"),
          IV("COMMUNITY_COLLEGE", "SUPPORTS", 6, "Barrier supports for declared pre-Rad", "Testing fees, transcript fees, application help — small barriers that shed real candidates.", "Declared pre-Rad, Single parents, First-generation", undefined, undefined, "Student services", "qualified"),
          IV("COMMUNITY_COLLEGE", "RETENTION", 7, "Maintain completion / licensure / placement rates", "Hold ~87% completion, ~90% licensure, ~91% regional placement as cohorts scale.", "All learners", undefined, undefined, "Program lead", "productive"),
          // Employers (~$80–130K)
          IV("EMPLOYER", "AWARENESS", 1, "Industry voice via one coordinated channel", "Single coordinated employer voice into K-12/CC awareness work.", "K-12, Adult learners", 80000, 130000, "TPS employer co-lead", "interested"),
          IV("EMPLOYER", "WBL", 2, "Clinical preceptor stipends scaled to 80 seats", "Preceptor stipends + apprenticeship structure scaled toward the 80-seat capacity target.", "All learners", undefined, undefined, "Employer partners"),
          IV("EMPLOYER", "SUPPORTS", 3, "Tuition assistance + childcare/scheduling flex", "Tuition assistance for committed students; childcare & scheduling flexibility for adult learners; earn-while-you-learn arrangements.", "Adult learners, Single parents", undefined, undefined, "Employer partners", "completing"),
          IV("EMPLOYER", "SUPPORTS", 4, "Employer-funded barrier supports", "Testing fees, transcript fees, uniforms for declared pre-Rad moving toward qualified application.", "Declared pre-Rad", undefined, undefined, "Employer partners", "qualified"),
          IV("EMPLOYER", "RETENTION", 5, "Hire-local + advancement pathways", "Hire all 29 regionally; sign-on/completion bonuses tied to milestones; MRI/CT advancement pathways; reduce employer-hopping turnover.", "Graduates", undefined, undefined, "Employer partners", "productive"),
          // Cross-cutting (~$15–30K)
          IV("CROSS_CUTTING", "SUPPORTS", 1, "Coordinator role + single engagement channel", "Coordinator contribution; streamlined employer engagement channel; data infrastructure; compliance/accreditation work.", "All", 15000, 30000, "TPS", undefined, "active"),
        ],
      });
      console.log(`Alignment: ${radStudents.length} learner intakes, ${empIntakes.length} partner intakes, 20 interventions seeded for ${radFam.name}.`);
    }
  }

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
    students: await prisma.student.count(),
    studentGrades: await prisma.studentCourseGrade.count(),
    studentAssessments: await prisma.studentSkillAssessment.count(),
    sessionInstructors: await prisma.sessionInstructor.count(),
    wblSnapshots: await prisma.wblSnapshot.count(),
    wblPlacements: await prisma.wblPlacement.count(),
    meetingPatterns: await prisma.meetingPattern.count(),
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
