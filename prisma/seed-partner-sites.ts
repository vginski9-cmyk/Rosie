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
import { SETTING_KITS } from "./seed-kits";

export type PartnerKind = "snf" | "ach" | "hospital" | "cah" | "fqhc" | "office" | "outpatient" | "health-dept" | "hospice" | "home-health" | "dialysis" | "behavioral";
/** One setting a site supplies to an RN program: the setting code's kit (prisma/seed-kits.ts), how many of it, and
 *  the learners / preceptors a shift takes when the site's figure differs from the kit's planning estimate. */
export interface PartnerSiteKit { code: string; n?: number; learners?: number; preceptors?: number }
export interface PartnerSite {
  /** Stable external id (employer.externalId), unique within the college. */
  id: string;
  institution: string;
  name: string; org?: string; type: string; kind: PartnerKind;
  county: string; city: string; state?: "NC" | "SC"; address?: string; zip?: string; est?: boolean;
  licensedBeds?: number; nursingHomeBeds?: number; adultCareBeds?: number;
  agreement: "secured" | "asked" | "prospect" | "none";
  /** Nursing halls (snf/ach/hospital units) or externship slots (ambulatory) the site could host at once. */
  units?: number;
  /** The settings an RN program's site carries (a hospital: med-surg beds, ICU, OB …). Absent = the kind's one kit. */
  kits?: PartnerSiteKit[];
  /** When the listing was read (the sourceNote says so); "Sept 2026" when absent. */
  lookedUp?: string;
  contact?: string; note?: string; source: string;
}

const LENOIR = "Lenoir Community College", CARTERET = "Carteret Community College", RC = "Roanoke-Chowan Community College", SCC = "Southeastern Community College";
const OCT = "Oct 2026";
const SCC_NOTE = "Within the owner's 45-minute radius of the Whiteville campus (drive estimated by the workspace from the town centroid); the college publishes no affiliation list — a prospect until it confirms.";

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

  // ── Southeastern CC · Nursing (prelicensure RN) — every plausible site within 45 minutes of Whiteville ─────
  // Looked up 2026-10-28 from the systems' own pages and public directories (the state license file, CMS and care
  // directories were unreachable from the build environment; bed counts are as the directories give them and some
  // disagree — the note says so). All prospects: the owner's call, 2026-10-28.
  // Hospitals
  { id: "SCC-H01", institution: SCC, name: "Columbus Regional Healthcare System", org: "Columbus Regional Healthcare System (Atrium Health affiliate)", type: "Hospital", kind: "hospital", county: "Columbus", city: "Whiteville", address: "500 Jefferson St", zip: "28472", licensedBeds: 154, agreement: "prospect", lookedUp: OCT, kits: [{ code: "BEDS", n: 2 }, { code: "ICU" }, { code: "OB" }], source: "crhealthcare.org · directories list 154 beds (144 routine + 10 special care; one lists 166) · ICU, Birthing Center, 12-bed ED, inpatient rehab, wound care", note: `The college's one published clinical partner: a clinical-instructor partnership (a CRHS nurse teaches SCC's first-year ADN and PN clinicals) that doubled the college's placements at the hospital. ${SCC_NOTE}` },
  { id: "SCC-H02", institution: SCC, name: "Cape Fear Valley – Bladen County Hospital", org: "Cape Fear Valley Health", type: "Critical access hospital", kind: "hospital", county: "Bladen", city: "Elizabethtown", address: "501 S Poplar St", zip: "28337", licensedBeds: 58, agreement: "prospect", lookedUp: OCT, kits: [{ code: "BEDS" }], source: "capefearvalley.com locations · directories list 58 beds (others 35 / 48) · critical access hospital", note: `23 road miles north on US 701 (about 30–35 minutes by road; the workspace's centroid estimate reads a little over 45). ${SCC_NOTE}` },
  { id: "SCC-H03", institution: SCC, name: "UNC Health Southeastern", org: "UNC Health", type: "Hospital", kind: "hospital", county: "Robeson", city: "Lumberton", address: "300 W 27th St", zip: "28358", licensedBeds: 452, agreement: "prospect", lookedUp: OCT, kits: [{ code: "BEDS", n: 2 }, { code: "ICU" }, { code: "OB" }, { code: "BH" }], source: "unchealthsoutheastern.org · 452 licensed beds (292 acute + 33 psychiatric per a 2026 posting; 271 staffed per AHD 2025) · ICU, NICU, behavioral health unit, OB hospitalists", note: `33 road miles west on US 74 (37–40 minutes by road). ${SCC_NOTE}` },
  { id: "SCC-H04", institution: SCC, name: "McLeod Health Loris", org: "McLeod Health", type: "Hospital", kind: "hospital", county: "Horry", city: "Loris", state: "SC", address: "3655 Mitchell St", zip: "29569", licensedBeds: 50, agreement: "prospect", lookedUp: OCT, kits: [{ code: "BEDS" }, { code: "ICU" }, { code: "OB" }], source: "mcleodhealth.org · directories list 50 beds (105 before the 2015 Seacoast transfer) · women's services and childbirth, 21-bed ED, critical care, general surgery · Forbes Top Hospitals 2026", note: `25 road miles south on US 701 in South Carolina (about 36 minutes by road); NC licensure and out-of-state affiliation terms apply. ${SCC_NOTE}` },
  // Skilled nursing facilities
  { id: "SCC-S01", institution: SCC, name: "Shoreland Health Care & Retirement Center", type: "Skilled nursing facility", kind: "snf", county: "Columbus", city: "Whiteville", address: "200 Flowers Pridgen Dr", zip: "28472", nursingHomeBeds: 89, agreement: "prospect", lookedUp: OCT, units: 2, source: "senior-living directories · 89 Medicare/Medicaid-certified beds · near Columbus Regional", note: SCC_NOTE },
  { id: "SCC-S02", institution: SCC, name: "Liberty Commons Nursing & Rehabilitation Center of Columbus County", org: "Liberty Healthcare", type: "Skilled nursing facility", kind: "snf", county: "Columbus", city: "Whiteville", address: "1402 Pinckney St", zip: "28472", agreement: "prospect", lookedUp: OCT, units: 2, source: "libertyhealthandrehab.com · short-term rehab, long-term living, assisted living, memory care · bed count not published", note: SCC_NOTE },
  { id: "SCC-S03", institution: SCC, name: "Premier Living & Rehab Center", type: "Skilled nursing facility", kind: "snf", county: "Columbus", city: "Lake Waccamaw", address: "106 Cameron St", zip: "28450", nursingHomeBeds: 127, agreement: "prospect", lookedUp: OCT, units: 2, source: "senior-living directories · 127-unit skilled nursing facility", note: SCC_NOTE },
  { id: "SCC-S04", institution: SCC, name: "Tabor Commons", type: "Skilled nursing facility", kind: "snf", county: "Columbus", city: "Tabor City", address: "703 Elizabeth St", zip: "28463", nursingHomeBeds: 80, agreement: "prospect", lookedUp: OCT, units: 1, source: "taborcommons.com · a directory lists 80 beds with short-term rehabilitation and long-term care; other listings call it assisted living — confirm the licensed level", note: SCC_NOTE },
  { id: "SCC-S05", institution: SCC, name: "Bladen East Health & Rehab", type: "Skilled nursing facility", kind: "snf", county: "Bladen", city: "Elizabethtown", address: "804 S Poplar St", zip: "28337", nursingHomeBeds: 90, agreement: "prospect", lookedUp: OCT, units: 1, source: "senior-living directories · 90 beds", note: `Elizabethtown: about 30–35 minutes by road. ${SCC_NOTE}` },
  { id: "SCC-S06", institution: SCC, name: "Elizabethtown Healthcare & Rehab Center", type: "Skilled nursing facility", kind: "snf", county: "Bladen", city: "Elizabethtown", address: "208 Mercer Rd", zip: "28337", nursingHomeBeds: 94, agreement: "prospect", lookedUp: OCT, units: 1, source: "CareListings · 94 licensed beds", note: `Elizabethtown: about 30–35 minutes by road. ${SCC_NOTE}` },
  { id: "SCC-S07", institution: SCC, name: "Loris Rehab & Nursing Center", type: "Skilled nursing facility", kind: "snf", county: "Horry", city: "Loris", state: "SC", address: "3620 Stevens St", zip: "29569", nursingHomeBeds: 88, agreement: "prospect", lookedUp: OCT, units: 1, source: "SC Office on Aging facility directory · 88 beds, Medicare/Medicaid certified · opened 2014", note: `South Carolina, about 36 minutes by road. ${SCC_NOTE}` },
  { id: "SCC-S08", institution: SCC, name: "WoodHaven Nursing, Alzheimer's and Rehabilitation Care Center", type: "Skilled nursing facility", kind: "snf", county: "Robeson", city: "Lumberton", address: "1150 Pine Run Dr", zip: "28358", nursingHomeBeds: 115, agreement: "prospect", lookedUp: OCT, units: 2, source: "CareListings · 115 licensed beds (another listing: 100 rooms)", note: `Lumberton: 37–40 minutes by road. ${SCC_NOTE}` },
  { id: "SCC-S09", institution: SCC, name: "Highland Acres Nursing and Rehabilitation Center (The Carrolton of Lumberton)", type: "Skilled nursing facility", kind: "snf", county: "Robeson", city: "Lumberton", address: "1170 Linkhaw Rd", zip: "28358", nursingHomeBeds: 90, agreement: "prospect", lookedUp: OCT, units: 1, source: "CareListings · 90 licensed beds · the two names share one address", note: `Lumberton: 37–40 minutes by road. ${SCC_NOTE}` },
  { id: "SCC-S10", institution: SCC, name: "Wesley Pines Retirement Community", org: "United Methodist Retirement Homes", type: "Skilled nursing facility", kind: "snf", county: "Robeson", city: "Lumberton", address: "1000 Wesley Pines Rd", zip: "28358", nursingHomeBeds: 62, agreement: "prospect", lookedUp: OCT, units: 1, source: "CMS 345180 per directories · 62 skilled beds in a continuing-care community", note: `Lumberton: 37–40 minutes by road. ${SCC_NOTE}` },
  { id: "SCC-S11", institution: SCC, name: "Lumberton Health and Rehabilitation Center (Harborview Lumberton)", type: "Skilled nursing facility", kind: "snf", county: "Robeson", city: "Lumberton", address: "1555 Willis Ave", zip: "28358", nursingHomeBeds: 122, agreement: "prospect", lookedUp: OCT, units: 2, source: "CMS 345234 per directories · 122 certified beds", note: `Lumberton: 37–40 minutes by road. ${SCC_NOTE}` },
  { id: "SCC-S12", institution: SCC, name: "Glenflora", type: "Skilled nursing facility", kind: "snf", county: "Robeson", city: "Lumberton", address: "5701 Fayetteville Rd", zip: "28360", nursingHomeBeds: 52, agreement: "prospect", lookedUp: OCT, units: 1, source: "CareListings · 52 licensed beds (another listing: 72 rooms)", note: `Lumberton: 37–40 minutes by road. ${SCC_NOTE}` },
  { id: "SCC-A01", institution: SCC, name: "Century Care Center", type: "Adult care home", kind: "ach", county: "Columbus", city: "Whiteville", address: "316 W Burkhead St", zip: "28472", agreement: "prospect", lookedUp: OCT, units: 1, source: "directory listing · licensed level and capacity not published", note: SCC_NOTE },
  // Hospice and home health
  { id: "SCC-P01", institution: SCC, name: "Lower Cape Fear LifeCare — Columbus County Hospice Care Center", org: "Lower Cape Fear LifeCare", type: "Hospice", kind: "hospice", county: "Columbus", city: "Whiteville", address: "206 Warrior Trail", zip: "28472", licensedBeds: 6, agreement: "prospect", lookedUp: OCT, source: "lifecare.org · six-bed hospice care center opened 2008, about a mile from Columbus Regional; serves Columbus and Bladen counties", note: SCC_NOTE },
  { id: "SCC-P02", institution: SCC, name: "Community Home Care & Hospice — Whiteville", org: "Community Home Care & Hospice", type: "Hospice", kind: "hospice", county: "Columbus", city: "Whiteville", address: "333 Jefferson St", zip: "28472", agreement: "prospect", lookedUp: OCT, source: "directory listing · hospice and home-care office", note: SCC_NOTE },
  { id: "SCC-HH1", institution: SCC, name: "Liberty Home Care — Whiteville", org: "Liberty Home Care", type: "Home health agency", kind: "home-health", county: "Columbus", city: "Whiteville", address: "46 McNeill Plaza", zip: "28472", agreement: "prospect", lookedUp: OCT, source: "National Alliance for Care at Home provider listing · Medicare-certified home health agency", note: SCC_NOTE },
  { id: "SCC-HH2", institution: SCC, name: "Avid Health at Home — Columbus", org: "Avid Health at Home", type: "Home health agency", kind: "home-health", county: "Columbus", city: "Whiteville", address: "1349 S Madison St", zip: "28472", agreement: "prospect", lookedUp: OCT, source: "avidhealthathome.com locations", note: SCC_NOTE },
  { id: "SCC-HH3", institution: SCC, name: "Interim HealthCare of Whiteville", org: "Interim HealthCare", type: "Home health agency", kind: "home-health", county: "Columbus", city: "Whiteville", address: "1424 S JK Powell Blvd, Suite G", zip: "28472", agreement: "prospect", lookedUp: OCT, source: "directory listing", note: SCC_NOTE },
  // Dialysis
  { id: "SCC-D01", institution: SCC, name: "DaVita Whiteville Dialysis Center", org: "DaVita", type: "Dialysis center", kind: "dialysis", county: "Columbus", city: "Whiteville", address: "608 Pecan Ln", zip: "28472", agreement: "prospect", lookedUp: OCT, source: "DaVita / dialysis provider listings · in-center hemodialysis, home and peritoneal dialysis", note: SCC_NOTE },
  { id: "SCC-D02", institution: SCC, name: "DaVita Chadbourn Dialysis Center", org: "DaVita", type: "Dialysis center", kind: "dialysis", county: "Columbus", city: "Chadbourn", address: "210 Strawberry Blvd", zip: "28431", agreement: "prospect", lookedUp: OCT, source: "dialysis provider listings", note: SCC_NOTE },
  // Public health
  { id: "SCC-PH1", institution: SCC, name: "Columbus County Health Department", org: "Columbus County", type: "Public health department", kind: "health-dept", county: "Columbus", city: "Whiteville", address: "304 Jefferson St", zip: "28472", agreement: "prospect", lookedUp: OCT, kits: [{ code: "PH" }], source: "columbusco.org · listings give 304 Jefferson St (WIC) and 810 Pinckney St — confirm the clinic site", note: SCC_NOTE },
  { id: "SCC-PH2", institution: SCC, name: "Bladen County Health Department", org: "Bladen County Health & Human Services Agency", type: "Public health department", kind: "health-dept", county: "Bladen", city: "Elizabethtown", address: "300 Mercer Mill Rd", zip: "28337", agreement: "prospect", lookedUp: OCT, kits: [{ code: "PH" }], source: "bladennc.govoffice3.com", note: `Elizabethtown: about 30–35 minutes by road. ${SCC_NOTE}` },
  { id: "SCC-PH3", institution: SCC, name: "Robeson County Health Department", org: "Robeson County", type: "Public health department", kind: "health-dept", county: "Robeson", city: "Lumberton", address: "460 Country Club Rd", zip: "28360", agreement: "prospect", lookedUp: OCT, kits: [{ code: "PH" }], source: "county directory listings", note: `Lumberton: 37–40 minutes by road. ${SCC_NOTE}` },
  // Clinics (pediatric and primary care — the pediatric and community experiences where no inpatient unit is near)
  { id: "SCC-F01", institution: SCC, name: "Columbus County Community Health Center", type: "Community health center", kind: "fqhc", county: "Columbus", city: "Whiteville", address: "15 Hill Plaza, Suite A", zip: "28472", agreement: "prospect", lookedUp: OCT, kits: [{ code: "AMB" }], source: "federally qualified health center listings (another lists 209 W Virgil St — confirm)", note: SCC_NOTE },
  { id: "SCC-F02", institution: SCC, name: "Goshen Medical Center — Columbus Pediatrics", org: "Goshen Medical Center (FQHC)", type: "Community health center", kind: "fqhc", county: "Columbus", city: "Whiteville", address: "800 Jefferson St, Suite 116", zip: "28472", agreement: "prospect", lookedUp: OCT, kits: [{ code: "AMB" }], source: "FQHC listings · pediatric practice", note: `A pediatric ambulatory experience for NUR 113 — no inpatient pediatric unit is within the radius. ${SCC_NOTE}` },
  { id: "SCC-O01", institution: SCC, name: "Columbus Regional — Advanced Pediatrics & Family Care", org: "Columbus Regional Healthcare System", type: "Physician practice", kind: "office", county: "Columbus", city: "Whiteville", address: "36 McNeill Plaza", zip: "28472", agreement: "prospect", lookedUp: OCT, kits: [{ code: "AMB" }], source: "crhealthcare.org locations · well-child visits and immunizations to chronic disease management", note: `A pediatric ambulatory experience for NUR 113. ${SCC_NOTE}` },
  { id: "SCC-O02", institution: SCC, name: "Columbus Regional — Advanced Primary Care, Whiteville", org: "Columbus Regional Healthcare System", type: "Physician practice", kind: "office", county: "Columbus", city: "Whiteville", address: "619 Jefferson St", zip: "28472", agreement: "prospect", lookedUp: OCT, kits: [{ code: "AMB" }], source: "crhealthcare.org locations (also listed as Whiteville Adult Medicine)", note: SCC_NOTE },
  // Behavioral health
  { id: "SCC-B01", institution: SCC, name: "Monarch — Columbus Industries (Whiteville)", org: "Monarch", type: "Behavioral health outpatient office", kind: "behavioral", county: "Columbus", city: "Whiteville", address: "1222 S Madison St", zip: "28472", agreement: "prospect", lookedUp: OCT, kits: [{ code: "BH", learners: 2, preceptors: 1 }], source: "monarchnc.org open-access locations", note: `Outpatient behavioral health (walk-in open access) — a community mental-health experience for NUR 114; the nearest inpatient units are UNC Health Southeastern's. ${SCC_NOTE}` },
  { id: "SCC-B02", institution: SCC, name: "Monarch — Lumberton Facility-Based Crisis Center", org: "Monarch", type: "Behavioral health crisis facility", kind: "behavioral", county: "Robeson", city: "Lumberton", address: "207 W 29th St", zip: "28358", agreement: "prospect", lookedUp: OCT, kits: [{ code: "BH", learners: 4, preceptors: 0 }], source: "monarchnc.org service locations", note: `Facility-based crisis care; Lumberton is 37–40 minutes by road. ${SCC_NOTE}` },
];

// ── What each kind of site supplies, in the program's own terms ───────────────
interface Kit { code: string; setting: string; assetType: string; learners: number; preceptors: number; rule: string; days: string; blocks: string; hours: number; serves: string; unitType: string; unitCategory: string; uom: string; dayStart?: string; unitName?: string; liaisonTitle?: string }
const KITS: Record<Exclude<PartnerKind, "hospice" | "home-health" | "dialysis" | "behavioral">, Kit> = {
  snf: { code: "LTC", setting: "Long-term care / skilled nursing", assetType: "Skilled nursing hall", learners: 10, preceptors: 0, rule: "7-day Day+Evening", days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun", blocks: "Day,Evening", hours: 6, serves: "Long-term care residents — one instructor-led Nurse Aide I group per hall (1 RN instructor : up to 10 students)", unitType: "SNF Nursing Unit", unitCategory: "Long-term care beds", uom: "beds" },
  ach: { code: "LTC", setting: "Long-term care / skilled nursing", assetType: "Adult care home hall", learners: 6, preceptors: 0, rule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", blocks: "Day", hours: 6, serves: "Adult care home residents — personal-care skills; one small instructor-led group", unitType: "Adult Care Unit", unitCategory: "Adult care beds", uom: "beds" },
  hospital: { code: "BEDS", setting: "Medical-surgical / telemetry unit", assetType: "Med-surg nursing unit", learners: 5, preceptors: 0, rule: "7-day Day+Evening", days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun", blocks: "Day,Evening", hours: 6, serves: "Adult medical & surgical inpatients — acute-care day for a Nurse Aide I group (hospital caps the group at 5)", unitType: "Med-Surg / Telemetry", unitCategory: "Inpatient beds", uom: "beds" },
  cah: { code: "AMB", setting: "Ambulatory clinic / physician office", assetType: "Externship slot — hospital primary-care clinic", learners: 1, preceptors: 1, rule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", blocks: "Day", hours: 8, serves: "Medical Assisting practicum: rooming, vitals, front office in a critical-access hospital's clinic", unitType: "Physician Office", unitCategory: "Ambulatory office", uom: "exam rooms" },
  fqhc: { code: "AMB", setting: "Ambulatory clinic / physician office", assetType: "Externship slot — exam rooms & front office", learners: 1, preceptors: 1, rule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", blocks: "Day", hours: 8, serves: "Medical Assisting practicum (160 h, CAAHEP): clinical and administrative competencies under a CMA preceptor", unitType: "Community Health Center", unitCategory: "Ambulatory office", uom: "exam rooms" },
  office: { code: "AMB", setting: "Ambulatory clinic / physician office", assetType: "Externship slot — exam rooms & front office", learners: 1, preceptors: 1, rule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", blocks: "Day", hours: 8, serves: "Medical Assisting practicum in a family-medicine practice", unitType: "Physician Office", unitCategory: "Ambulatory office", uom: "exam rooms" },
  outpatient: { code: "AMB", setting: "Ambulatory clinic / physician office", assetType: "Externship slot — hospital outpatient clinic", learners: 1, preceptors: 1, rule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", blocks: "Day", hours: 8, serves: "Medical Assisting practicum in a hospital outpatient specialty clinic", unitType: "Hospital Outpatient Clinic", unitCategory: "Ambulatory office", uom: "exam rooms" },
  "health-dept": { code: "AMB", setting: "Ambulatory clinic / physician office", assetType: "Externship slot — public health clinic", learners: 1, preceptors: 1, rule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", blocks: "Day", hours: 8, serves: "Medical Assisting practicum in a public health clinic (immunizations, screenings, front office)", unitType: "Community Health Center", unitCategory: "Ambulatory office", uom: "exam rooms" },
};
/** The one kit a kind of site carries when its row names none: the old kinds keep their own (above); the kinds
 *  added for RN programs take the setting kit (prisma/seed-kits.ts). */
const DEFAULT_KIT: Record<"hospice" | "home-health" | "dialysis" | "behavioral", string> = { hospice: "HOSP", "home-health": "HH", dialysis: "DIAL", behavioral: "BH" };
type SiteKit = Kit & { n: number };
function kitsFor(s: PartnerSite): SiteKit[] {
  if (s.kits) return s.kits.map((k) => { const base = SETTING_KITS[k.code]; if (!base) throw new Error(`${s.id}: no setting kit ${k.code}`); return { ...base, learners: k.learners ?? base.learners, preceptors: k.preceptors ?? base.preceptors, n: Math.max(1, k.n ?? 1) }; });
  const n = Math.max(1, s.units ?? 1);
  if (s.kind in DEFAULT_KIT) return [{ ...SETTING_KITS[DEFAULT_KIT[s.kind as keyof typeof DEFAULT_KIT]], n }];
  return [{ ...KITS[s.kind as keyof typeof KITS], n }];
}
/** Which job families a kind of site serves, by the setting code its assets carry. */
const FAMILY_SETTINGS: Record<string, string[]> = { "nurse aide": ["LTC", "BEDS"], "cna": ["LTC", "BEDS"], "medical assist": ["AMB"], "nursing": ["BEDS", "ICU", "OB", "PEDS", "BH", "LTC", "HH", "HOSP", "PH", "DIAL", "AMB"] };

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
    const kits = kitsFor(s);
    const base = {
      name: s.name, organization: s.org ?? null, facilityType: s.type, setting: s.type, county: s.county, city: s.city, state: s.state ?? "NC", zip: s.zip ?? null, address: s.address ?? null,
      licensedBeds: s.licensedBeds ?? null, nursingHomeBeds: s.nursingHomeBeds ?? null, adultCareBeds: s.adultCareBeds ?? null,
      status: "active", agreementStatus: s.agreement, contactName: s.contact ?? null,
      sourceNote: `${s.source}${s.est ? " · address estimated — verify with the partner" : ` · looked up ${s.lookedUp ?? "Sept 2026"}`}`,
      notes: [s.note, "Hall / slot counts, group sizes and the agreement tier are planning estimates — confirm on the supply map."].filter(Boolean).join(" "),
    };
    let e = await prisma.employer.findFirst({ where: { institutionId: inst.id, externalId: s.id }, select: { id: true } });
    if (!e) e = await prisma.employer.findFirst({ where: { institutionId: inst.id, name: s.name }, select: { id: true } });
    if (e) await prisma.employer.update({ where: { id: e.id }, data: { ...base, externalId: s.id } });
    else { e = await prisma.employer.create({ data: { institutionId: inst.id, externalId: s.id, ...base }, select: { id: true } }); sites++; }
    for (let k = 0; k < kits.length; k++) {
      const kit = kits[k]; const n = kit.n;
      // Assets: one row per hall, unit or slot, keyed by external id so a re-run refreshes instead of duplicating.
      for (let i = 1; i <= n; i++) {
        const externalId = `${s.id}-${kit.code}-${String(i).padStart(2, "0")}`;
        const data = {
          employerId: e.id, externalId, settingCode: kit.code, setting: kit.setting, assetType: kit.assetType, assetNumber: i,
          operatingRule: kit.rule, days: kit.days, shiftBlocks: kit.blocks, hoursPerShift: kit.hours, dayStart: kit.dayStart ?? "07:00", dayHours: kit.hours, eveningStart: "17:00", eveningHours: 4, nightStart: kit.hours >= 12 ? "19:00" : "23:00", nightHours: kit.hours >= 12 ? 12 : 8,
          serves: kit.serves, learnersPerShift: kit.learners, preceptorsPerShift: kit.preceptors, dataSource: "ESTIMATE", status: "active",
          evidenceSource: "seeded planning estimate from the facility type and public listings — not confirmed with the site", notes: s.est ? "Site address is an estimate." : null,
        };
        const existing = await prisma.clinicalAsset.findFirst({ where: { employerId: e.id, externalId }, select: { id: true } });
        if (existing) await prisma.clinicalAsset.update({ where: { id: existing.id }, data });
        else { await prisma.clinicalAsset.create({ data }); assets++; }
      }
      // One unit row per kit for the supply grid, in the workbook's terms (a single-kit site keeps its U01 row).
      const unitExt = `${s.id}-U${String(k + 1).padStart(2, "0")}`;
      const unitData = {
        employerId: e.id, externalId: unitExt, unitType: kit.unitType, unitCategory: kit.unitCategory, unitName: kit.unitName ?? (kit.unitCategory === "Ambulatory office" ? "Clinic" : kit.unitCategory === "Inpatient beds" ? "Medical-surgical unit" : "Nursing hall(s)"),
        capacityCount: k === 0 ? s.nursingHomeBeds ?? s.adultCareBeds ?? s.licensedBeds ?? null : null, uom: kit.uom, dataSource: "ESTIMATE",
        shiftsPerDay: kit.blocks.split(",").length, shiftLengthHrs: kit.hours, shiftBlocks: kit.blocks, days: kit.days,
        studentsPerShift: kit.learners * n, studentsPerPreceptor: kit.preceptors ? 1 : 10, preceptorsPerShift: kit.preceptors * n,
        notes: kit.preceptors ? "Precepted: one student (or a pair) per preceptor." : "Instructor-led group: the college's RN instructor supervises; the site provides the hall.",
      };
      const eu = await prisma.clinicalUnit.findFirst({ where: { employerId: e.id, externalId: unitExt }, select: { id: true } });
      if (eu) await prisma.clinicalUnit.update({ where: { id: eu.id }, data: unitData });
      else { await prisma.clinicalUnit.create({ data: unitData }); units++; }
    }
    // The family agreement — one status per site, the same as the employer's; students at once summed over the kits the family uses.
    for (const f of inst.programFamilies) {
      const codes = Object.entries(FAMILY_SETTINGS).find(([k]) => f.name.toLowerCase().includes(k))?.[1];
      const mine = codes ? kits.filter((kit) => codes.includes(kit.code)) : [];
      if (!mine.length) continue;
      const precepted = mine.every((kit) => kit.preceptors > 0);
      const fsData = { agreementStatus: s.agreement, studentsAtOnce: mine.reduce((t, kit) => t + kit.learners * kit.n, 0), staffCountSource: "ESTIMATE", evidenceSource: `seeded from public facility listings (${s.lookedUp ?? "Sept 2026"}) — agreement tier is a planning placeholder; confirm with the site`, availabilityNotes: precepted ? "Weekday daytime, precepted." : "Daytime and early-evening clinical groups; weekends by arrangement." };
      await prisma.familySite.upsert({ where: { familyId_employerId: { familyId: f.id, employerId: e.id } }, update: fsData, create: { familyId: f.id, employerId: e.id, ...fsData } });
      agreements++;
    }
    // Site people: a preceptor per precepted slot; a staff-development RN liaison at each nursing site with an agreement in motion.
    const titles: string[] = [];
    for (const kit of kits) {
      if (kit.preceptors) for (let i = 0; i < kit.n; i++) titles.push(kit.liaisonTitle ?? (i === 0 ? "CMA (AAMA), Office Preceptor" : "Practice Manager"));
    }
    if (kits.some((kit) => !kit.preceptors) && (s.agreement === "secured" || s.agreement === "asked")) titles.push(kits.find((kit) => !kit.preceptors)?.liaisonTitle ?? "Staff Development RN — Nurse Aide clinical liaison");
    const have = await prisma.person.count({ where: { employerId: e.id, role: "preceptor" } });
    for (let i = have; i < titles.length; i++) {
      const name = PRECEPTOR_NAMES[nameIx++ % PRECEPTOR_NAMES.length];
      await prisma.person.create({ data: { institutionId: inst.id, name, role: "preceptor", title: `${titles[i]} — ${s.name}`, email: emailOf(name, (s.org ?? s.name).toLowerCase().replace(/[^a-z]/g, "").slice(0, 14) + ".org"), employerId: e.id, employmentType: "partner staff" } });
      people++;
    }
  }
  return { sites, assets, units, agreements, people };
}
