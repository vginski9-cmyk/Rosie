// ─────────────────────────────────────────────────────────────────────────────
// The NURSING clinical vocabulary shared by every college's seed: which rotation a
// prelicensure RN course names, which asset setting serves it, and what a partner
// site of each setting supplies — one table, so Sandhills' site map and the partner
// colleges' site lists read the same way and the scheduler matches the same codes.
// No Prisma import: tests read these directly.
// ─────────────────────────────────────────────────────────────────────────────
import { SETTING_PRESETS } from "../src/lib/settingPresets";

/** rotationType → asset setting, unit category and the unit type a site lists it under. Slash-free
 *  wordings: the requirement backfill codes each as a reviewed "only" rule; the one "or" wording (the
 *  precepted capstone) is proposed as an any-of rule for review. */
export type RotationRow = [rotationType: string, settingCode: string, unitCategory: string, unitType: string | null];
export const NURSING_ROTATIONS: RotationRow[] = [
  ["Med-Surg", "BEDS", "Inpatient beds", "Med-Surg / Telemetry"], ["Medical-Surgical", "BEDS", "Inpatient beds", "Med-Surg / Telemetry"],
  ["Critical Care", "ICU", "Inpatient beds", "ICU / CCU"], ["ICU", "ICU", "Inpatient beds", "ICU / CCU"], ["ICU / Critical Care", "ICU", "Inpatient beds", "ICU / CCU"],
  ["Obstetrics", "OB", "Inpatient beds", "L&D / Mother-Baby"], ["OB / Maternity", "OB", "Inpatient beds", "L&D / Mother-Baby"],
  ["Pediatrics", "PEDS", "Inpatient beds", "Pediatric Unit"],
  ["Behavioral Health", "BH", "Behavioral health", "Inpatient Behavioral Health"], ["Mental Health", "BH", "Behavioral health", "Inpatient Behavioral Health"],
  ["Long-Term Care", "LTC", "Long-term care beds", "SNF Nursing Unit"], ["Skilled Nursing", "LTC", "Long-term care beds", "SNF Nursing Unit"],
  ["Community Health", "PH", "Ambulatory office", "Public Health Clinic"], ["Community / Public Health", "PH", "Ambulatory office", "Public Health Clinic"],
  ["Home Health", "HH", "Home & community", "Home Health Team"], ["Hospice", "HOSP", "Home & community", "Hospice Team"],
  // The emergency department: a rotate-out day with the unit's nurse (Southeastern, 2026-10-28), not a group placement.
  ["Emergency", "ED", "Emergency department", "Emergency Department"], ["Emergency Department", "ED", "Emergency department", "Emergency Department"], ["ED", "ED", "Emergency department", "Emergency Department"],
  // The precepted capstone: an adult acute setting — med-surg or critical care — one student per preceptor.
  ["Med-Surg or Critical Care", "BEDS", "Inpatient beds", "Med-Surg / Telemetry"],
];
/** The settings an RN family's sites can carry, primary first. */
export const NURSING_SETTINGS = ["BEDS", "ICU", "OB", "PEDS", "ED", "BH", "LTC", "PH", "HH", "HOSP", "DIAL", "AMB"];
const ROT_BY_KEY = new Map(NURSING_ROTATIONS.map(([r, s]) => [r.trim().toLowerCase(), s]));
/** The setting code a nursing rotation maps to, or null when the wording is not in the table (never a guess). */
export const nursingAreaOf = (rotationType: string | null | undefined): string | null => (rotationType ? ROT_BY_KEY.get(rotationType.trim().toLowerCase()) ?? null : null);

/** What a partner site of one setting supplies to an RN program, in the program's own terms. Learner counts are
 *  PLANNING ESTIMATES (the workspace's instructor-led group of eight on an inpatient or long-term-care unit; a
 *  precepted pair in a community setting) until the site confirms them on its page. */
export interface SettingKit { code: string; setting: string; assetType: string; learners: number; preceptors: number; rule: string; days: string; blocks: string; hours: number; dayStart: string; serves: string; unitType: string; unitCategory: string; uom: string; unitName: string; liaisonTitle: string }
const preset = (code: string) => { const p = SETTING_PRESETS.find((x) => x[0] === code); if (!p) throw new Error(`no setting preset ${code}`); return { code, setting: p[1], assetType: p[2] }; };
const UNIT_24x7 = { rule: "24x7", days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun", blocks: "Day,Night", hours: 12, dayStart: "07:00" };
const WEEKDAY = { rule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", blocks: "Day", hours: 8, dayStart: "08:00" };
const GROUP = "one instructor-led group (the college's RN instructor supervises; NC BON allows up to ten students per instructor, the workspace plans eight)";
export const SETTING_KITS: Record<string, SettingKit> = {
  BEDS: { ...preset("BEDS"), ...UNIT_24x7, learners: 8, preceptors: 0, serves: `Adult medical and surgical inpatients — ${GROUP}`, unitType: "Med-Surg / Telemetry", unitCategory: "Inpatient beds", uom: "beds", unitName: "Medical-surgical unit", liaisonTitle: "RN, Clinical Nurse Educator" },
  ICU: { ...preset("ICU"), ...UNIT_24x7, learners: 8, preceptors: 0, serves: `Critically ill adults — ${GROUP}; the unit may hold a group smaller than eight`, unitType: "ICU / CCU", unitCategory: "Inpatient beds", uom: "beds", unitName: "Intensive care unit", liaisonTitle: "RN, Critical Care Educator" },
  OB: { ...preset("OB"), ...UNIT_24x7, learners: 8, preceptors: 0, serves: `Labor, delivery, postpartum and newborn care — ${GROUP}; the unit may hold a group smaller than eight`, unitType: "L&D / Mother-Baby", unitCategory: "Inpatient beds", uom: "beds", unitName: "Labor & delivery / mother-baby unit", liaisonTitle: "RN, Women's Services Educator" },
  PEDS: { ...preset("PEDS"), ...UNIT_24x7, learners: 8, preceptors: 0, serves: `Hospitalized children — ${GROUP}`, unitType: "Pediatric Unit", unitCategory: "Inpatient beds", uom: "beds", unitName: "Pediatric unit", liaisonTitle: "RN, Pediatric Nurse Educator" },
  // The emergency department as a NURSING setting: the radiography preset "ED" names an imaging room, so this kit carries its own wording. A student's rotate-out day with the unit's nurse — not an instructor-led group.
  ED: { code: "ED", setting: "Emergency department", assetType: "ED treatment bays", ...UNIT_24x7, learners: 2, preceptors: 0, serves: "Emergency and trauma patients — a student's rotate-out day paired with the department's nurse (two at once is the planning estimate)", unitType: "Emergency Department", unitCategory: "Emergency department", uom: "bays", unitName: "Emergency department", liaisonTitle: "RN, Emergency Department Educator" },
  BH: { ...preset("BH"), ...UNIT_24x7, learners: 8, preceptors: 0, serves: `Adults in behavioral-health care — ${GROUP}`, unitType: "Inpatient Behavioral Health", unitCategory: "Behavioral health", uom: "beds", unitName: "Behavioral health unit", liaisonTitle: "RN, Behavioral Health Educator" },
  LTC: { ...preset("LTC"), rule: "7-day Day+Evening", days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun", blocks: "Day,Evening", hours: 6, dayStart: "07:00", learners: 8, preceptors: 0, serves: `Long-term care residents — ${GROUP} per hall`, unitType: "SNF Nursing Unit", unitCategory: "Long-term care beds", uom: "beds", unitName: "Nursing hall(s)", liaisonTitle: "Staff Development RN — nursing clinical liaison" },
  PH: { ...preset("PH"), ...WEEKDAY, learners: 2, preceptors: 1, serves: "Immunizations, screenings, maternal and child health, communicable disease — students paired with a public health nurse", unitType: "Public Health Clinic", unitCategory: "Ambulatory office", uom: "exam rooms", unitName: "Clinic", liaisonTitle: "Public Health Nurse, RN — Preceptor" },
  HH: { ...preset("HH"), ...WEEKDAY, learners: 2, preceptors: 1, serves: "Home visits with a home-health RN — community and chronic-illness care", unitType: "Home Health Team", unitCategory: "Home & community", uom: "teams", unitName: "Home-visit team", liaisonTitle: "Home Health RN — Preceptor" },
  HOSP: { ...preset("HOSP"), ...WEEKDAY, learners: 2, preceptors: 1, serves: "End-of-life and palliative care with a hospice RN", unitType: "Hospice Team", unitCategory: "Home & community", uom: "teams", unitName: "Hospice care team", liaisonTitle: "Hospice RN — Preceptor" },
  DIAL: { ...preset("DIAL"), rule: "Custom", days: "Mon,Tue,Wed,Thu,Fri,Sat", blocks: "Day,Evening", hours: 10, dayStart: "06:00", learners: 2, preceptors: 1, serves: "Outpatient hemodialysis — students paired with a dialysis RN", unitType: "Dialysis Center", unitCategory: "Ambulatory office", uom: "stations", unitName: "Dialysis stations", liaisonTitle: "Dialysis RN — Preceptor" },
  AMB: { ...preset("AMB"), ...WEEKDAY, learners: 2, preceptors: 1, serves: "Primary, pediatric and specialty outpatients — students paired with a clinic RN or provider", unitType: "Clinic", unitCategory: "Ambulatory office", uom: "exam rooms", unitName: "Clinic", liaisonTitle: "Clinic RN — Preceptor" },
};
