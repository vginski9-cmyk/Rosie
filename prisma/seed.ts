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
      rows.push({ kind: "CLASS", number: i + 1, title, lengthHours: c.weeklyClassHours, maxStudents: 30, facultyNeeded: 1, supportStaffNeeded: 0, preceptorsNeeded: 0, week: i + 1, dayOfWeek: null, startTime: null, location: null, rotationType: null, clinicalMode: null, facultyContactPolicy: 2.5, supportContactPolicy: 2, preceptorContactPolicy: null } as any);
    }
  }
  if (c.weeklyLabHours > 0) {
    for (let i = 0; i < weeks; i++) {
      const title = bank.lab?.[i] ?? `${c.name} Lab — Week ${i + 1}`;
      rows.push({ kind: "LAB", number: i + 1, title, lengthHours: c.weeklyLabHours, maxStudents: 12, facultyNeeded: 2, supportStaffNeeded: 0, preceptorsNeeded: 0, week: i + 1, dayOfWeek: null, startTime: null, location: null, rotationType: null, clinicalMode: null, facultyContactPolicy: 2, supportContactPolicy: 2, preceptorContactPolicy: null } as any);
    }
  }
  if (c.weeklyClinicalHours > 0) {
    const p = CLINICAL_PROFILE[c.code] ?? { mode: "Preceptor-led", maxStudents: 1, faculty: 0.1 / 3, preceptors: 1 };
    const clinWeeks = Math.min(weeks, 15);
    const shiftLen = c.weeklyClinicalHours >= 18 ? 12 : 8; // heavier clinical terms run 12-hr shifts
    for (let i = 0; i < clinWeeks; i++) {
      const rotation = CLINICAL_ROTATIONS[i % CLINICAL_ROTATIONS.length];
      rows.push({ kind: "CLINICAL", number: i + 1, title: `${rotation} Rotation — Week ${i + 1}`, lengthHours: shiftLen, maxStudents: p.maxStudents, facultyNeeded: p.faculty, supportStaffNeeded: 0, preceptorsNeeded: p.preceptors, week: i + 1, dayOfWeek: null, startTime: null, location: null, rotationType: rotation, clinicalMode: p.mode, facultyContactPolicy: 2, supportContactPolicy: 2, preceptorContactPolicy: 1 } as any);
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
  console.log("Resetting to basics: templates only…");
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

  // ----- The workspace: one institution, three jobs, a template library ------
  // Back to basics. NO cohorts, students, people, employers, or facilities are
  // seeded — the workflow is: set a goal for a job → drag a prepopulated
  // template in with start/stop dates → lock it in as an instantiation → the
  // pipeline, calendar and clinical-capacity math populate from the template.
  const sandhills = await prisma.institution.create({
    data: { name: "Sandhills Community College", shortName: "Sandhills CC", serviceArea: "Moore & Hoke Counties, NC (Sandhills region)" },
  });

  const radOcc = await prisma.occupation.create({ data: { institutionId: sandhills.id, socCode: "29-2034", title: "Radiologic Technologists" } });
  const surgOcc = await prisma.occupation.create({ data: { institutionId: sandhills.id, socCode: "29-2055", title: "Surgical Technologists" } });
  const maOcc = await prisma.occupation.create({ data: { institutionId: sandhills.id, socCode: "31-9092", title: "Medical Assistants" } });

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
    await prisma.demandProjection.create({
      data: { institutionId: sandhills.id, occupationId: maOcc.id, regionId: regions["SERVICE_AREA"], year: y, jobs: 240, openings: 30, growthPct: 0.12, replacementPct: 0.88, turnoverPct: 0.2 },
    });
  }

  // ----- Families (one per job) ---------------------------------------------
  const radFamily = await prisma.programFamily.create({ data: { institutionId: sandhills.id, occupationId: radOcc.id, name: "Radiography", description: "Radiography program templates producing ARRT-eligible radiographers for the Sandhills region." } });
  const surgFamily = await prisma.programFamily.create({ data: { institutionId: sandhills.id, occupationId: surgOcc.id, name: "Surgical Technology", description: "Surgical Technology program templates." } });
  const maFamily = await prisma.programFamily.create({ data: { institutionId: sandhills.id, occupationId: maOcc.id, name: "Medical Assisting", description: "Medical Assisting program templates producing medical assistants for the Sandhills region." } });

  // ----- The prepopulated template library ----------------------------------
  // Each template is a complete, timeless curriculum: terms → courses → the
  // full session table (class / lab / clinical rows with the capacity-model
  // columns). defaultCohortSeats is the template's max cohort enrollment
  // capacity — the gating number when a goal is split across instantiations.
  const rad = await createProgram({ institutionId: sandhills.id, occupationId: radOcc.id, name: "Radiography", programType: "Traditional Full Time", credential: "AAS", terms: radTerms });
  await prisma.program.update({ where: { id: rad.id }, data: { familyId: radFamily.id, launchCadence: "MULTI_PER_YEAR", launchTerms: "FALL,SPRING", termSlots: "FALL,SPRING,SUMMER", defaultCohortSeats: 41 } });

  const radEvening = await createProgram({
    institutionId: sandhills.id, occupationId: radOcc.id, name: "Radiography — Evening Track", programType: "Evening Part Time", credential: "AAS",
    terms: genTerms("RDE", 96, 6, true),
  });
  await prisma.program.update({ where: { id: radEvening.id }, data: { familyId: radFamily.id, launchCadence: "BIENNIAL", launchTerms: "FALL", termSlots: "FALL,SPRING,SUMMER", defaultCohortSeats: 18 } });

  const surg = await createProgram({ institutionId: sandhills.id, occupationId: surgOcc.id, name: "Surgical Technology", programType: "Traditional Full Time", credential: "Diploma", terms: surgTerms });
  await prisma.program.update({ where: { id: surg.id }, data: { familyId: surgFamily.id, launchCadence: "ANNUAL", launchTerms: "FALL", termSlots: "FALL,SPRING,SUMMER", defaultCohortSeats: 19 } });

  const ma = await createProgram({ institutionId: sandhills.id, occupationId: maOcc.id, name: "Medical Assisting", programType: "Traditional Full Time", credential: "Diploma", terms: genTerms("MED", 52, 2, true) });
  await prisma.program.update({ where: { id: ma.id }, data: { familyId: maFamily.id, launchCadence: "ANNUAL", launchTerms: "FALL", termSlots: "FALL,SPRING,SUMMER", defaultCohortSeats: 28 } });

  // ----- CNA template pack — imported straight from the demo workbooks -------
  // Five Nurse Aide I delivery models (5-wk day intensive, 6-wk term, 8-wk
  // summer evening, 12-wk day, 12-wk evening), each an exact copy of its
  // workbook's Raw Data & Calculations session table: every session row with
  // delivery mode, location, length, capacity, staffing, contact-hour
  // policies, week/day placement, notes, and clinical rotation columns.
  type CnaSession = {
    kind: string; number: number; title: string | null; deliveryMode: string | null; location: string | null;
    lengthHours: number; maxStudents: number; facultyNeeded: number; facultyContactPolicy: number | null;
    supportStaffNeeded: number; supportContactPolicy: number | null; week: number | null; dayOfWeek: string | null;
    notes: string | null; preceptorsNeeded: number; preceptorContactPolicy: number | null;
    rotationType: string | null; clinicalMode: string | null;
  };
  type CnaTemplate = {
    name: string; label: string; programType: string; credential: string; sourceWorkbook: string;
    termWeeks: number; maxCohort: number;
    assumptions: { facContactHours: number; facWorkWeekHours: number; facTermWeeks: number; preContactHours: number; preWorkWeekHours: number; preTermWeeks: number };
    course: { code: string; title: string; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number };
    sessions: CnaSession[];
  };
  const cnaPack = JSON.parse(readFileSync(join(__dirname, "templates", "cna.json"), "utf8")) as CnaTemplate[];

  const cnaOcc = await prisma.occupation.create({ data: { institutionId: sandhills.id, socCode: "31-1131", title: "Nursing Assistants" } });
  for (const y of [2025, 2026, 2027, 2028, 2029, 2030]) {
    await prisma.demandProjection.create({
      data: { institutionId: sandhills.id, occupationId: cnaOcc.id, regionId: regions["SERVICE_AREA"], year: y, jobs: 520, openings: 68, growthPct: 0.05, replacementPct: 0.95, turnoverPct: 0.35 },
    });
  }
  const cnaFamily = await prisma.programFamily.create({
    data: { institutionId: sandhills.id, occupationId: cnaOcc.id, name: "Nurse Aide (CNA)", description: "Nurse Aide I templates producing state-exam-eligible CNAs — five delivery models imported from the CNA demo workbooks (day intensive, standard term, summer evening, and extended day/evening tracks)." },
  });
  for (const tpl of cnaPack) {
    const program = await prisma.program.create({
      data: {
        institutionId: sandhills.id, occupationId: cnaOcc.id, familyId: cnaFamily.id,
        name: tpl.name, programType: tpl.programType, credential: tpl.credential,
        monthsToFullProductivity: 1, status: "active",
        launchCadence: "MULTI_PER_YEAR", launchTerms: "FALL,SPRING,SUMMER", termSlots: "FALL,SPRING,SUMMER",
        defaultCohortSeats: tpl.maxCohort,
        facContactHours: tpl.assumptions.facContactHours, facWorkWeekHours: tpl.assumptions.facWorkWeekHours, facTermWeeks: tpl.assumptions.facTermWeeks,
        preContactHours: tpl.assumptions.preContactHours, preWorkWeekHours: tpl.assumptions.preWorkWeekHours, preTermWeeks: tpl.assumptions.preTermWeeks,
      },
    });
    const term = await prisma.term.create({
      data: { programId: program.id, index: 1, name: "Term 1", startWeek: 1, endWeek: tpl.termWeeks },
    });
    await prisma.course.create({
      data: {
        termId: term.id, code: tpl.course.code, name: tpl.course.title, sequenceOrder: 0,
        weeklyClassHours: tpl.course.weeklyClassHours, weeklyLabHours: tpl.course.weeklyLabHours, weeklyClinicalHours: tpl.course.weeklyClinicalHours,
        creditHours: 6, semesterOffered: "All", courseType: "CORE",
        description: `Nurse Aide I (${tpl.label}) — imported from ${tpl.sourceWorkbook}.`,
        sessions: {
          create: tpl.sessions.map((x) => ({
            kind: x.kind, number: x.number, title: x.title,
            deliveryMode: x.deliveryMode, location: x.location,
            lengthHours: x.lengthHours, maxStudents: x.maxStudents,
            facultyNeeded: Math.round(x.facultyNeeded), supportStaffNeeded: Math.round(x.supportStaffNeeded), preceptorsNeeded: Math.round(x.preceptorsNeeded),
            facultyContactPolicy: x.facultyContactPolicy, supportContactPolicy: x.supportContactPolicy, preceptorContactPolicy: x.preceptorContactPolicy,
            week: x.week, dayOfWeek: x.dayOfWeek, notes: x.notes,
            rotationType: x.rotationType, clinicalMode: x.clinicalMode,
          })),
        },
      },
    });
  }

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
