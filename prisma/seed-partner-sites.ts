// ─────────────────────────────────────────────────────────────────────────────
// CLINICAL PARTNERS for the three colleges that had none on record: Lenoir CC
// (Nurse Aide I; Lenoir, Greene and Jones counties), Carteret CC (Nurse Aide I;
// Carteret County) and Roanoke-Chowan CC (Medical Assisting; Hertford, Bertie,
// Gates and Northampton counties).
//
// The supply is shaped by how each program actually places students, not by
// copying the imaging model:
//   • Nurse Aide I clinical is an INSTRUCTOR-LED GROUP on a nursing hall — the
//     college's RN instructor supervises up to 10 students (NCBON / NATCEP
//     ratio); the site provides the hall, not a preceptor. Sites are skilled
//     nursing facilities (LTC setting), adult care homes (LTC setting, adult-care
//     beds) and, for the acute-care rotation, a hospital medical-surgical unit
//     (BEDS setting). Assets are halls / units; learnersPerShift is the group
//     size the hall can absorb; preceptorsPerShift is 0.
//   • Medical Assisting practicum is a PRECEPTED 1:1 EXTERNSHIP in an
//     ambulatory office — an FQHC, a physician practice, a hospital outpatient
//     clinic or a health department (AMB setting). Assets are externship slots
//     (exam rooms + front office); learnersPerShift 1, preceptorsPerShift 1
//     (a CMA or practice manager).
//
// Facility names, towns, addresses and bed counts were looked up in September
// 2026 from public listings (state SNF list, CMS, facility and health-system
// sites); `est: true` marks an address that could not be confirmed. Every
// agreement tier, hall count, group size and slot count is a PLANNING
// ESTIMATE the college confirms with the partner — asset rows carry
// dataSource ESTIMATE and say so.
// ─────────────────────────────────────────────────────────────────────────────

import type { PrismaClient } from "@prisma/client";

export type PartnerKind = "snf" | "ach" | "hospital" | "cah" | "fqhc" | "office" | "outpatient" | "health-dept";
export interface PartnerSite {
  /** Stable external id (employer.externalId), unique within the college. */
  id: string;
  institution: string;
  name: string; org?: string; type: string; kind: PartnerKind;
  county: string; city: string; address?: string; zip?: string; est?: boolean;
  licensedBeds?: number; nursingHomeBeds?: number; adultCareBeds?: number;
  agreement: "secured" | "asked" | "prospect" | "none";
  /** Nursing halls (snf/ach/hospital units) or externship slots (ambulatory) the site could host at once. */
  units?: number;
  contact?: string; note?: string; source: string;
}

const LENOIR = "Lenoir Community College", CARTERET = "Carteret Community College", RC = "Roanoke-Chowan Community College";

export const PARTNER_SITES: PartnerSite[] = [
  // ── Lenoir CC · Nurse Aide I ──────────────────────────────────────────────
  { id: "LCC-H01", institution: LENOIR, name: "UNC Health Lenoir", org: "UNC Health", type: "Hospital", kind: "hospital", county: "Lenoir", city: "Kinston", address: "100 Airport Rd", zip: "28501", licensedBeds: 199, agreement: "secured", units: 2, source: "unclenoir.org · licensed for 199 beds", note: "Acute medical-surgical rotation for the NA I acute-care day; students on the unit in one instructor-led group." },
  { id: "LCC-S01", institution: LENOIR, name: "Harmony Hall Nursing & Rehabilitation Center", type: "Skilled nursing facility", kind: "snf", county: "Lenoir", city: "Kinston", address: "312 Warren Ave", zip: "28501", nursingHomeBeds: 175, agreement: "secured", units: 3, source: "harmonyhallcare.com · CMS 345156, 175 beds" },
  { id: "LCC-S02", institution: LENOIR, name: "Signature Healthcare of Kinston", org: "Signature HealthCARE", type: "Skilled nursing facility", kind: "snf", county: "Lenoir", city: "Kinston", address: "907 Cunningham Rd", zip: "28501", nursingHomeBeds: 106, agreement: "secured", units: 2, source: "CMS 345365 · 106 beds" },
  { id: "LCC-S03", institution: LENOIR, name: "NC State Veterans Home – Kinston", org: "NC Department of Military & Veterans Affairs", type: "Skilled nursing facility", kind: "snf", county: "Lenoir", city: "Kinston", address: "2150 Hull Rd", zip: "28504", nursingHomeBeds: 100, agreement: "asked", units: 2, source: "state veterans home listing · bed count estimated", est: false },
  { id: "LCC-S04", institution: LENOIR, name: "Kinston Rehabilitation and Healthcare Center", type: "Skilled nursing facility", kind: "snf", county: "Lenoir", city: "Kinston", est: true, nursingHomeBeds: 90, agreement: "prospect", units: 1, source: "public listing · address and beds not confirmed" },
  { id: "LCC-S05", institution: LENOIR, name: "Greendale Forest Nursing & Rehabilitation Center", type: "Skilled nursing facility", kind: "snf", county: "Greene", city: "Snow Hill", address: "1304 SE 2nd St", zip: "28580", nursingHomeBeds: 115, agreement: "secured", units: 2, source: "CMS 345366 · 115–132 beds", note: "The Greene County Center cohorts' long-term-care site." },
  { id: "LCC-S06", institution: LENOIR, name: "Brook Stone Living Center", type: "Skilled nursing facility", kind: "snf", county: "Jones", city: "Pollocksville", address: "8990 US Hwy 17 S", zip: "28573", nursingHomeBeds: 80, agreement: "secured", units: 1, source: "brookstonelc.com · 80 units (formerly Trent Village Nursing Center)", note: "The Jones County Center cohorts' long-term-care site." },
  { id: "LCC-A01", institution: LENOIR, name: "Spring Arbor of Kinston", org: "Spring Arbor Senior Living", type: "Adult care home", kind: "ach", county: "Lenoir", city: "Kinston", est: true, zip: "28504", adultCareBeds: 86, agreement: "asked", units: 1, source: "DHSR adult care home license · capacity 86" },
  { id: "LCC-A02", institution: LENOIR, name: "The Village of Kinston", org: "Victorian Senior Care", type: "Adult care home", kind: "ach", county: "Lenoir", city: "Kinston", est: true, adultCareBeds: 63, agreement: "prospect", units: 1, source: "DHSR adult care home license · capacity 63" },
  { id: "LCC-A03", institution: LENOIR, name: "Snow Hill Assisted Living", type: "Adult care home", kind: "ach", county: "Greene", city: "Snow Hill", address: "1328 SE 2nd St", zip: "28580", agreement: "prospect", units: 1, source: "DHSR listing" },

  // ── Carteret CC · Nurse Aide I ────────────────────────────────────────────
  { id: "CCC-H01", institution: CARTERET, name: "Carteret Health Care", type: "Hospital", kind: "hospital", county: "Carteret", city: "Morehead City", address: "3500 Arendell St", zip: "28557", licensedBeds: 135, agreement: "secured", units: 2, source: "carterethealth.org · 135-bed non-profit hospital", note: "Acute medical-surgical rotation; one instructor-led group on the unit." },
  { id: "CCC-S01", institution: CARTERET, name: "Harborview Health Care Center", type: "Skilled nursing facility", kind: "snf", county: "Carteret", city: "Morehead City", address: "812 Shepard St", zip: "28557", nursingHomeBeds: 122, agreement: "secured", units: 2, source: "CMS listing · 122 beds" },
  { id: "CCC-S02", institution: CARTERET, name: "Crystal Bluffs Rehabilitation & Health Care Center", type: "Skilled nursing facility", kind: "snf", county: "Carteret", city: "Morehead City", address: "4010 Bridges St Ext", zip: "28557", nursingHomeBeds: 92, agreement: "secured", units: 2, source: "crystalbluffs.com · 92 beds" },
  { id: "CCC-S03", institution: CARTERET, name: "Croatan Ridge Nursing and Rehabilitation Center", type: "Skilled nursing facility", kind: "snf", county: "Carteret", city: "Newport", address: "210 Foxhall Rd", zip: "28570", nursingHomeBeds: 64, agreement: "asked", units: 1, source: "CMS listing · 64 beds" },
  { id: "CCC-S04", institution: CARTERET, name: "Embassy at Morehead City", org: "Embassy Healthcare", type: "Skilled nursing facility", kind: "snf", county: "Carteret", city: "Morehead City", address: "3822 Galantis Dr", zip: "28557", nursingHomeBeds: 92, agreement: "asked", units: 1, source: "embassyhealthcare.net · 92 beds (skilled nursing + assisted living)" },
  { id: "CCC-A01", institution: CARTERET, name: "Carteret Landing Assisted Living and Memory Care", org: "Ridge Care", type: "Adult care home", kind: "ach", county: "Carteret", city: "Morehead City", address: "221 Friendly Rd", zip: "28557", adultCareBeds: 110, agreement: "prospect", units: 1, source: "ridgecare.com · 110-bed community" },
  { id: "CCC-A02", institution: CARTERET, name: "Carteret House", type: "Adult care home", kind: "ach", county: "Carteret", city: "Newport", est: true, agreement: "prospect", units: 1, source: "carteretseniors.com" },

  // ── Roanoke-Chowan CC · Medical Assisting ─────────────────────────────────
  { id: "RCC-F01", institution: RC, name: "Roanoke Chowan Community Health Center — Ahoskie Comprehensive Care", org: "Roanoke Chowan Community Health Center (FQHC)", type: "Community health center", kind: "fqhc", county: "Hertford", city: "Ahoskie", address: "120 Health Center Dr", zip: "27910", agreement: "secured", units: 2, source: "rcchc.org", note: "Flagship FQHC clinic; two externship slots (family medicine, front office)." },
  { id: "RCC-F02", institution: RC, name: "Roanoke Chowan Community Health Center — Colerain Primary Care", org: "Roanoke Chowan Community Health Center (FQHC)", type: "Community health center", kind: "fqhc", county: "Bertie", city: "Colerain", address: "109 W River St", zip: "27924", agreement: "asked", units: 1, source: "rcchc.org" },
  { id: "RCC-F03", institution: RC, name: "Roanoke Chowan Community Health Center — Murfreesboro Primary Care", org: "Roanoke Chowan Community Health Center (FQHC)", type: "Community health center", kind: "fqhc", county: "Hertford", city: "Murfreesboro", address: "305 Beechwood Blvd", zip: "27855", agreement: "asked", units: 1, source: "rcchc.org" },
  { id: "RCC-H01", institution: RC, name: "ECU Health Roanoke-Chowan Hospital — Outpatient Specialty Clinic", org: "ECU Health", type: "Hospital outpatient clinic", kind: "outpatient", county: "Hertford", city: "Ahoskie", address: "500 S Academy St", zip: "27910", licensedBeds: 114, agreement: "secured", units: 2, source: "locations.ecuhealth.org · 114-bed hospital", note: "Externship in the hospital's outpatient specialty clinic (wound care, pain management, primary care)." },
  { id: "RCC-O01", institution: RC, name: "ECU Health Family Medicine — Windsor", org: "ECU Health", type: "Physician practice", kind: "office", county: "Bertie", city: "Windsor", address: "1403 S King St", zip: "27983", agreement: "asked", units: 1, source: "locations.ecuhealth.org (within ECU Health Bertie Hospital outpatient clinic)" },
  { id: "RCC-C01", institution: RC, name: "ECU Health Bertie Hospital", org: "ECU Health", type: "Critical access hospital", kind: "cah", county: "Bertie", city: "Windsor", address: "1403 S King St", zip: "27983", licensedBeds: 6, agreement: "prospect", units: 1, source: "locations.ecuhealth.org · critical-access, 6 private rooms" },
  { id: "RCC-F04", institution: RC, name: "Bertie County Rural Health Association", type: "Community health center", kind: "fqhc", county: "Bertie", city: "Windsor", est: true, agreement: "asked", units: 1, source: "FQHC listing · address not confirmed" },
  { id: "RCC-O02", institution: RC, name: "Gates County Medical Center", org: "Gateway Community Health Centers", type: "Physician practice", kind: "office", county: "Gates", city: "Gatesville", address: "501 Main St", zip: "27938", agreement: "prospect", units: 1, source: "healthgrades / carelistings" },
  { id: "RCC-O03", institution: RC, name: "Rural Health Group at Jackson", org: "Rural Health Group", type: "Physician practice", kind: "office", county: "Northampton", city: "Jackson", address: "9425 NC Hwy 305", zip: "27845", agreement: "prospect", units: 1, source: "Northampton County resource directory" },
  { id: "RCC-O04", institution: RC, name: "Rural Health Group at Rich Square", org: "Rural Health Group", type: "Physician practice", kind: "office", county: "Northampton", city: "Rich Square", est: true, zip: "27869", agreement: "prospect", units: 1, source: "Northampton County resource directory · street address not confirmed" },
  { id: "RCC-D01", institution: RC, name: "Northampton County Health Department", type: "Public health department", kind: "health-dept", county: "Northampton", city: "Jackson", est: true, agreement: "prospect", units: 1, source: "northamptonhd.com" },
  { id: "RCC-D02", institution: RC, name: "Hertford County Public Health Authority", type: "Public health department", kind: "health-dept", county: "Hertford", city: "Winton", est: true, agreement: "prospect", units: 1, source: "county listing · address not confirmed" },
];

// ── What each kind of site supplies, in the program's own terms ───────────────
interface Kit { code: string; setting: string; assetType: string; learners: number; preceptors: number; rule: string; days: string; blocks: string; hours: number; serves: string; unitType: string; unitCategory: string; uom: string }
const KITS: Record<PartnerKind, Kit> = {
  snf: { code: "LTC", setting: "Long-term care / skilled nursing", assetType: "Skilled nursing hall", learners: 10, preceptors: 0, rule: "7-day Day+Evening", days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun", blocks: "Day,Evening", hours: 6, serves: "Long-term care residents — one instructor-led Nurse Aide I group per hall (1 RN instructor : up to 10 students)", unitType: "SNF Nursing Unit", unitCategory: "Long-term care beds", uom: "beds" },
  ach: { code: "LTC", setting: "Long-term care / skilled nursing", assetType: "Adult care home hall", learners: 6, preceptors: 0, rule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", blocks: "Day", hours: 6, serves: "Adult care home residents — personal-care skills; one small instructor-led group", unitType: "Adult Care Unit", unitCategory: "Adult care beds", uom: "beds" },
  hospital: { code: "BEDS", setting: "Medical-surgical / telemetry unit", assetType: "Med-surg nursing unit", learners: 5, preceptors: 0, rule: "7-day Day+Evening", days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun", blocks: "Day,Evening", hours: 6, serves: "Adult medical & surgical inpatients — acute-care day for a Nurse Aide I group (hospital caps the group at 5)", unitType: "Med-Surg / Telemetry", unitCategory: "Inpatient beds", uom: "beds" },
  cah: { code: "AMB", setting: "Ambulatory clinic / physician office", assetType: "Externship slot — hospital primary-care clinic", learners: 1, preceptors: 1, rule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", blocks: "Day", hours: 8, serves: "Medical Assisting practicum: rooming, vitals, front office in a critical-access hospital's clinic", unitType: "Physician Office", unitCategory: "Ambulatory office", uom: "exam rooms" },
  fqhc: { code: "AMB", setting: "Ambulatory clinic / physician office", assetType: "Externship slot — exam rooms & front office", learners: 1, preceptors: 1, rule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", blocks: "Day", hours: 8, serves: "Medical Assisting practicum (160 h, CAAHEP): clinical and administrative competencies under a CMA preceptor", unitType: "Community Health Center", unitCategory: "Ambulatory office", uom: "exam rooms" },
  office: { code: "AMB", setting: "Ambulatory clinic / physician office", assetType: "Externship slot — exam rooms & front office", learners: 1, preceptors: 1, rule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", blocks: "Day", hours: 8, serves: "Medical Assisting practicum in a family-medicine practice", unitType: "Physician Office", unitCategory: "Ambulatory office", uom: "exam rooms" },
  outpatient: { code: "AMB", setting: "Ambulatory clinic / physician office", assetType: "Externship slot — hospital outpatient clinic", learners: 1, preceptors: 1, rule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", blocks: "Day", hours: 8, serves: "Medical Assisting practicum in a hospital outpatient specialty clinic", unitType: "Hospital Outpatient Clinic", unitCategory: "Ambulatory office", uom: "exam rooms" },
  "health-dept": { code: "AMB", setting: "Ambulatory clinic / physician office", assetType: "Externship slot — public health clinic", learners: 1, preceptors: 1, rule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", blocks: "Day", hours: 8, serves: "Medical Assisting practicum in a public health clinic (immunizations, screenings, front office)", unitType: "Community Health Center", unitCategory: "Ambulatory office", uom: "exam rooms" },
};
/** Which job families a kind of site serves, by the setting code its assets carry. */
const FAMILY_SETTINGS: Record<string, string[]> = { "nurse aide": ["LTC", "BEDS"], "cna": ["LTC", "BEDS"], "medical assist": ["AMB"] };

const PRECEPTOR_NAMES = ["Denise Whitaker", "Marcus Bell", "Tanya Pierce", "Rodney Askew", "Lakeisha Vaughan", "Carla Futrell", "Brian Overton", "Sheila Godwin", "Kevin Sutton", "Angela Bazemore", "Monica Rountree", "Terrence Hollowell", "Paula Willoughby", "Jamal Copeland", "Renee Garner", "Heather Mizelle"];
const emailOf = (name: string, domain: string) => `${name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@${domain}`;

/** Create (or refresh) the partner sites, their halls / slots, units, family agreements and site preceptors for the three colleges. Idempotent. */
export async function loadPartnerSites(prisma: PrismaClient) {
  const institutions = await prisma.institution.findMany({ select: { id: true, name: true, programFamilies: { select: { id: true, name: true } } } });
  let sites = 0, assets = 0, units = 0, agreements = 0, people = 0;
  let nameIx = 0;
  for (const s of PARTNER_SITES) {
    const inst = institutions.find((i) => i.name === s.institution);
    if (!inst) continue;
    const kit = KITS[s.kind];
    const base = {
      name: s.name, organization: s.org ?? null, facilityType: s.type, setting: s.type, county: s.county, city: s.city, state: "NC", zip: s.zip ?? null, address: s.address ?? null,
      licensedBeds: s.licensedBeds ?? null, nursingHomeBeds: s.nursingHomeBeds ?? null, adultCareBeds: s.adultCareBeds ?? null,
      status: "active", agreementStatus: s.agreement, contactName: s.contact ?? null,
      sourceNote: `${s.source}${s.est ? " · address estimated — verify with the partner" : " · looked up Sept 2026"}`,
      notes: [s.note, "Hall / slot counts, group sizes and the agreement tier are planning estimates — confirm on the supply map."].filter(Boolean).join(" "),
    };
    let e = await prisma.employer.findFirst({ where: { institutionId: inst.id, externalId: s.id }, select: { id: true } });
    if (!e) e = await prisma.employer.findFirst({ where: { institutionId: inst.id, name: s.name }, select: { id: true } });
    if (e) await prisma.employer.update({ where: { id: e.id }, data: { ...base, externalId: s.id } });
    else { e = await prisma.employer.create({ data: { institutionId: inst.id, externalId: s.id, ...base }, select: { id: true } }); sites++; }
    const n = Math.max(1, s.units ?? 1);
    // Assets: one row per hall or slot, keyed by external id so a re-run refreshes instead of duplicating.
    for (let i = 1; i <= n; i++) {
      const externalId = `${s.id}-${kit.code}-${String(i).padStart(2, "0")}`;
      const data = {
        employerId: e.id, externalId, settingCode: kit.code, setting: kit.setting, assetType: kit.assetType, assetNumber: i,
        operatingRule: kit.rule, days: kit.days, shiftBlocks: kit.blocks, hoursPerShift: kit.hours, dayStart: "07:00", dayHours: kit.hours, eveningStart: "17:00", eveningHours: 4, nightStart: "23:00", nightHours: 8,
        serves: kit.serves, learnersPerShift: kit.learners, preceptorsPerShift: kit.preceptors, dataSource: "ESTIMATE", status: "active",
        evidenceSource: "seeded planning estimate from the facility type and public listings — not confirmed with the site", notes: s.est ? "Site address is an estimate." : null,
      };
      const existing = await prisma.clinicalAsset.findFirst({ where: { employerId: e.id, externalId }, select: { id: true } });
      if (existing) await prisma.clinicalAsset.update({ where: { id: existing.id }, data });
      else { await prisma.clinicalAsset.create({ data }); assets++; }
    }
    // One unit row per site for the supply grid, in the workbook's terms.
    const unitExt = `${s.id}-U01`;
    const unitData = {
      employerId: e.id, externalId: unitExt, unitType: kit.unitType, unitCategory: kit.unitCategory, unitName: kit.unitCategory === "Ambulatory office" ? "Clinic" : kit.unitCategory === "Inpatient beds" ? "Medical-surgical unit" : "Nursing hall(s)",
      capacityCount: s.nursingHomeBeds ?? s.adultCareBeds ?? s.licensedBeds ?? null, uom: kit.uom, dataSource: "ESTIMATE",
      shiftsPerDay: kit.blocks.split(",").length, shiftLengthHrs: kit.hours, shiftBlocks: kit.blocks, days: kit.days,
      studentsPerShift: kit.learners * n, studentsPerPreceptor: kit.preceptors ? 1 : 10, preceptorsPerShift: kit.preceptors * n,
      notes: kit.preceptors ? "1:1 precepted externship slots." : "Instructor-led group: the college's RN instructor supervises; the site provides the hall.",
    };
    const eu = await prisma.clinicalUnit.findFirst({ where: { employerId: e.id, externalId: unitExt }, select: { id: true } });
    if (eu) await prisma.clinicalUnit.update({ where: { id: eu.id }, data: unitData });
    else { await prisma.clinicalUnit.create({ data: unitData }); units++; }
    // The family agreement — one status per site, the same as the employer's.
    for (const f of inst.programFamilies) {
      const codes = Object.entries(FAMILY_SETTINGS).find(([k]) => f.name.toLowerCase().includes(k))?.[1];
      if (!codes || !codes.includes(kit.code)) continue;
      const fsData = { agreementStatus: s.agreement, studentsAtOnce: kit.learners * n, staffCountSource: "ESTIMATE", evidenceSource: "seeded from public facility listings (Sept 2026) — agreement tier is a planning placeholder; confirm with the site", availabilityNotes: kit.preceptors ? "Weekday daytime externship." : "Daytime and early-evening clinical groups; weekends by arrangement." };
      await prisma.familySite.upsert({ where: { familyId_employerId: { familyId: f.id, employerId: e.id } }, update: fsData, create: { familyId: f.id, employerId: e.id, ...fsData } });
      agreements++;
    }
    // Site people: a CMA preceptor per externship slot; a staff-development RN liaison at each nursing site with an agreement in motion.
    const wanted = kit.preceptors ? n : s.agreement === "secured" || s.agreement === "asked" ? 1 : 0;
    const have = await prisma.person.count({ where: { employerId: e.id, role: "preceptor" } });
    for (let i = have; i < wanted; i++) {
      const name = PRECEPTOR_NAMES[nameIx++ % PRECEPTOR_NAMES.length];
      const title = kit.preceptors ? (i === 0 ? "CMA (AAMA), Office Preceptor" : "Practice Manager") : "Staff Development RN — Nurse Aide clinical liaison";
      await prisma.person.create({ data: { institutionId: inst.id, name, role: "preceptor", title: `${title} — ${s.name}`, email: emailOf(name, (s.org ?? s.name).toLowerCase().replace(/[^a-z]/g, "").slice(0, 14) + ".org"), employerId: e.id, employmentType: "partner staff" } });
      people++;
    }
  }
  return { sites, assets, units, agreements, people };
}
