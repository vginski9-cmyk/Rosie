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
      const rows: { sessionId: string; personId: string; role: string; contactHours: number; segment: string | null }[] = [];
      if (s.kind === "CLINICAL") {
        // Preceptor from the site group rotated by session number.
        const group = siteGroups[s.number % 3];
        const prec = (group.length ? group : preceptors)[s.number % Math.max(1, group.length || preceptors.length)];
        if (prec) rows.push({ sessionId: s.id, personId: prec.id, role: "preceptor", contactHours: s.lengthHours, segment: "Clinical supervision" });
      } else if (co && s.kind === "CLASS") {
        const primShare = Math.round(s.lengthHours * co.primaryShare * 10) / 10;
        const secShare = Math.round((s.lengthHours - primShare) * 10) / 10;
        rows.push({ sessionId: s.id, personId: primary.id, role: "instructor", contactHours: primShare, segment: co.segment[0] });
        if (secShare > 0) rows.push({ sessionId: s.id, personId: secondary.id, role: "instructor", contactHours: secShare, segment: co.segment[1] });
      } else {
        rows.push({ sessionId: s.id, personId: primary.id, role: "instructor", contactHours: s.lengthHours, segment: s.kind === "LAB" ? "Lab supervision" : "Lecture" });
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
  await prisma.wblSnapshotFactor.deleteMany();
  await prisma.wblSnapshot.deleteMany();
  await prisma.studentAbsence.deleteMany();
  await prisma.studentSkillAssessment.deleteMany();
  await prisma.studentCourseGrade.deleteMany();
  await prisma.student.deleteMany();
  await prisma.sessionInstructor.deleteMany();
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
  const radClassOf2029 = await createFunnel(rad.id, "Class of 2029", 2029, {
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
  const scotland = await prisma.employer.create({ data: { institutionId: sandhills.id, name: "Scotland Memorial Hospital", setting: "Acute-care Hospital / Health System", wblSlots: 10, notes: "Secondary acute-care imaging clinical site" } });
  const pinehurstOutpatient = await prisma.employer.create({ data: { institutionId: sandhills.id, name: "Pinehurst Outpatient Imaging Center", setting: "Outpatient Imaging Center", wblSlots: 6 } });
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
  await seedSessionStaff(rad.id, facultyPeople, preceptorPeople);

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
