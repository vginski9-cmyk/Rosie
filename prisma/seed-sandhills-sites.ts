// ─────────────────────────────────────────────────────────────────────────────
// The SANDHILLS REGION clinical-site seed — everything a clinical coordinator at
// Sandhills Community College would put on the supply map, beyond the licensed
// hospitals, nursing homes and surgery centers the state license file gives us.
//
// Sources: FirstHealth, Cape Fear Valley, Scotland Health, Pinehurst Medical
// Clinic, Pinehurst Surgical Clinic, DaVita, Fresenius, county health
// departments and hospice/home-care directories (looked up Sept 2026). Where a
// street address could not be confirmed the entry says `est: true` and the
// asset rows carry dataSource ESTIMATE — treat those as placeholders to verify
// with the partner. Asset counts and learner rules are planning ESTIMATES for
// every site: partners confirm them on their supply map.
//
// Ring = drive time from the Pinehurst campus: Core (Moore), Ring 1 (Hoke,
// Richmond, Scotland, Lee, Montgomery), Ring 2 (Cumberland, Harnett, Anson,
// Chatham, Randolph).
// ─────────────────────────────────────────────────────────────────────────────

import type { PrismaClient } from "@prisma/client";

type Kit = { code: string; setting: string; assetType: string; n: number; learners: number; preceptors?: number; rule: "24x7" | "wd" | "wde" | "7d" | "mwf" | "wds"; hours?: number; serves?: string };
const K = (code: string, setting: string, assetType: string, n: number, learners: number, rule: Kit["rule"], extra: Partial<Kit> = {}): Kit => ({ code, setting, assetType, n, learners, rule, ...extra });

// ── Asset kits by kind of site ──────────────────────────────────────────────
const KITS: Record<string, Kit[]> = {
  // Inpatient hospital kits are ADDED to the radiography rooms the license map already gives each hospital.
  "hospital-large": [
    K("BEDS", "Medical-surgical / telemetry unit", "Med-surg nursing unit", 4, 4, "24x7", { hours: 12, serves: "Adult medical & surgical inpatients" }),
    K("ICU", "Intensive / critical care unit", "ICU nursing unit", 2, 2, "24x7", { hours: 12 }),
    K("OB", "Labor & delivery / mother-baby", "L&D and postpartum unit", 1, 2, "24x7", { hours: 12 }),
    K("PEDS", "Pediatric inpatient unit", "Pediatric nursing unit", 1, 2, "24x7", { hours: 12 }),
    K("BH", "Behavioral health unit", "Inpatient behavioral health unit", 1, 2, "24x7", { hours: 12 }),
    K("LAB", "Clinical laboratory", "Core lab bench", 1, 2, "24x7"),
    K("PHARM", "Pharmacy", "Inpatient pharmacy", 1, 1, "wde"),
    K("CT", "Computed tomography", "CT scanner", 2, 1, "24x7"),
    K("MRI", "Magnetic resonance imaging", "MRI scanner", 2, 1, "wde"),
    K("US", "Diagnostic ultrasound", "Ultrasound room", 2, 1, "wde"),
    K("MAMMO", "Mammography", "Mammography suite", 1, 1, "wd"),
    K("REHAB", "Rehabilitation (PT / OT)", "Rehab gym", 1, 2, "wd"),
  ],
  "hospital-mid": [
    K("BEDS", "Medical-surgical / telemetry unit", "Med-surg nursing unit", 2, 4, "24x7", { hours: 12 }),
    K("ICU", "Intensive / critical care unit", "ICU nursing unit", 1, 2, "24x7", { hours: 12 }),
    K("OB", "Labor & delivery / mother-baby", "L&D and postpartum unit", 1, 2, "24x7", { hours: 12 }),
    K("LAB", "Clinical laboratory", "Core lab bench", 1, 2, "24x7"),
    K("PHARM", "Pharmacy", "Inpatient pharmacy", 1, 1, "wd"),
    K("CT", "Computed tomography", "CT scanner", 1, 1, "24x7"),
    K("MRI", "Magnetic resonance imaging", "MRI scanner", 1, 1, "wde"),
    K("US", "Diagnostic ultrasound", "Ultrasound room", 1, 1, "wde"),
    K("MAMMO", "Mammography", "Mammography suite", 1, 1, "wd"),
  ],
  "hospital-small": [
    K("BEDS", "Medical-surgical / telemetry unit", "Med-surg nursing unit", 1, 3, "24x7", { hours: 12 }),
    K("LAB", "Clinical laboratory", "Core lab bench", 1, 1, "wde"),
    K("CT", "Computed tomography", "CT scanner", 1, 1, "24x7"),
    K("US", "Diagnostic ultrasound", "Ultrasound room", 1, 1, "wd"),
  ],
  imaging: [
    K("GEN", "General diagnostic radiography", "Fixed radiographic room", 1, 1, "wd"),
    K("CT", "Computed tomography", "CT scanner", 1, 1, "wde"),
    K("MRI", "Magnetic resonance imaging", "MRI scanner", 1, 1, "wde"),
    K("US", "Diagnostic ultrasound", "Ultrasound room", 1, 1, "wd"),
    K("MAMMO", "Mammography", "Mammography suite", 1, 1, "wd"),
  ],
  clinic: [K("AMB", "Ambulatory clinic / physician office", "Clinic exam rooms", 1, 2, "wd", { serves: "Primary and specialty outpatients" }), K("LAB", "Clinical laboratory", "Draw station / point-of-care lab", 1, 1, "wd")],
  "clinic-imaging": [K("AMB", "Ambulatory clinic / physician office", "Clinic exam rooms", 1, 2, "wd"), K("GEN", "General diagnostic radiography", "Fixed radiographic room", 1, 1, "wd"), K("US", "Diagnostic ultrasound", "Ultrasound room", 1, 1, "wd"), K("LAB", "Clinical laboratory", "Draw station / point-of-care lab", 1, 1, "wd")],
  "multispecialty": [K("AMB", "Ambulatory clinic / physician office", "Clinic exam rooms", 3, 2, "wd"), K("GEN", "General diagnostic radiography", "Fixed radiographic room", 1, 1, "wd"), K("CT", "Computed tomography", "CT scanner", 1, 1, "wd"), K("US", "Diagnostic ultrasound", "Ultrasound room", 1, 1, "wd"), K("LAB", "Clinical laboratory", "Draw station / point-of-care lab", 1, 2, "wd"), K("PHARM", "Pharmacy", "Outpatient pharmacy", 1, 1, "wd")],
  ortho: [K("AMB", "Ambulatory clinic / physician office", "Clinic exam rooms", 2, 2, "wd"), K("GEN", "General diagnostic radiography", "Fixed radiographic room", 1, 1, "wd"), K("MRI", "Magnetic resonance imaging", "MRI scanner", 1, 1, "wd"), K("REHAB", "Rehabilitation (PT / OT)", "Rehab gym", 1, 2, "wd")],
  urgent: [K("AMB", "Ambulatory clinic / physician office", "Urgent care exam rooms", 1, 2, "wds"), K("GEN", "General diagnostic radiography", "Fixed radiographic room", 1, 1, "wds"), K("LAB", "Clinical laboratory", "Point-of-care lab", 1, 1, "wds")],
  dialysis: [K("DIAL", "Outpatient dialysis", "Dialysis stations", 1, 2, "mwf", { hours: 10 })],
  homehealth: [K("HH", "Home health", "Home-visit team", 1, 2, "wd", { serves: "Homebound patients" })],
  hospice: [K("HOSP", "Hospice & palliative care", "Hospice care team", 1, 2, "wd"), K("HH", "Home health", "Home-visit team", 1, 1, "wd")],
  health: [K("PH", "Public health clinic", "Public health clinic rooms", 1, 2, "wd", { serves: "Immunizations, WIC, family planning, communicable disease" }), K("LAB", "Clinical laboratory", "Draw station / point-of-care lab", 1, 1, "wd")],
  ems: [K("EMS", "Emergency medical services", "ALS ambulance", 2, 1, "24x7", { hours: 12 })],
  alf: [K("ALF", "Assisted living / adult care", "Assisted living unit", 1, 3, "wde")],
  dental: [K("DENT", "Dental clinic", "Dental operatory", 2, 1, "wd")],
  pharmacy: [K("PHARM", "Pharmacy", "Retail pharmacy", 1, 1, "wde")],
  oncology: [K("AMB", "Ambulatory clinic / physician office", "Infusion suite", 1, 2, "wd"), K("PHARM", "Pharmacy", "Oncology pharmacy", 1, 1, "wd"), K("CT", "Computed tomography", "CT simulator", 1, 1, "wd")],
  rehab: [K("REHAB", "Rehabilitation (PT / OT)", "Rehab gym", 1, 2, "wde")],
  ltc: [K("LTC", "Long-term care nursing unit", "SNF nursing unit", 1, 3, "wde")],
};

const RULES: Record<Kit["rule"], { operatingRule: string; days: string; blocks: string }> = {
  "24x7": { operatingRule: "24x7", days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun", blocks: "Day,Evening,Night" },
  wd: { operatingRule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", blocks: "Day" },
  wde: { operatingRule: "Weekday Day+Evening", days: "Mon,Tue,Wed,Thu,Fri", blocks: "Day,Evening" },
  "7d": { operatingRule: "7-day Day", days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun", blocks: "Day" },
  mwf: { operatingRule: "Custom", days: "Mon,Tue,Wed,Thu,Fri,Sat", blocks: "Day,Evening" },
  wds: { operatingRule: "Custom", days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun", blocks: "Day,Evening" },
};

export interface SiteSeed {
  id: string; name: string; org: string; kind: keyof typeof KITS | "existing"; type: string;
  county: string; address: string; city: string; zip: string; est?: boolean; extraKits?: (keyof typeof KITS)[];
  agreement?: "secured" | "asked" | "prospect" | "none"; contact?: string;
}
const RING: Record<string, string> = { Moore: "Core", Hoke: "Ring 1", Richmond: "Ring 1", Scotland: "Ring 1", Lee: "Ring 1", Montgomery: "Ring 1", Cumberland: "Ring 2", Harnett: "Ring 2", Anson: "Ring 2", Chatham: "Ring 2", Randolph: "Ring 2" };

// ── Verified addresses for the licensed facilities already on the map ───────
export const HOSPITAL_ADDRESSES: Record<string, { address: string; city: string; zip: string; kit: keyof typeof KITS }> = {
  H001: { address: "155 Memorial Dr", city: "Pinehurst", zip: "28374", kit: "hospital-large" },
  H002: { address: "35 Memorial Dr", city: "Pinehurst", zip: "28374", kit: "ltc" }, // placeholder kit unused for ASCs (see below)
  H005: { address: "6000 Fayetteville Rd", city: "Raeford", zip: "28376", kit: "hospital-small" },
  H006: { address: "210 Medical Pavilion Dr", city: "Raeford", zip: "28376", kit: "hospital-small" },
  H007: { address: "925 Long Dr", city: "Rockingham", zip: "28379", kit: "hospital-mid" },
  H008: { address: "500 Lauchwood Dr", city: "Laurinburg", zip: "28352", kit: "hospital-mid" },
  H009: { address: "520 Allen St", city: "Troy", zip: "27371", kit: "hospital-small" },
  H010: { address: "1135 Carthage St", city: "Sanford", zip: "27330", kit: "hospital-mid" },
  H011: { address: "800 Tilghman Dr", city: "Dunn", zip: "28334", kit: "hospital-mid" },
  H012: { address: "1638 Owen Dr", city: "Fayetteville", zip: "28304", kit: "hospital-large" },
  H013: { address: "150 Robeson St", city: "Fayetteville", zip: "28301", kit: "hospital-small" },
  H016: { address: "2301 US Hwy 74 W", city: "Wadesboro", zip: "28170", kit: "hospital-small" },
  H017: { address: "364 White Oak St", city: "Asheboro", zip: "27203", kit: "hospital-mid" },
  H018: { address: "475 Progress Blvd", city: "Siler City", zip: "27344", kit: "hospital-small" },
};

// ── The new sites ───────────────────────────────────────────────────────────
const S = (id: string, name: string, org: string, kind: SiteSeed["kind"], type: string, county: string, address: string, city: string, zip: string, o: Partial<SiteSeed> = {}): SiteSeed => ({ id, name, org, kind, type, county, address, city, zip, ...o });
export const SANDHILLS_SITES: SiteSeed[] = [
  // ── Moore County (Core) ──
  S("S001", "FirstHealth Outpatient Imaging — Pinehurst", "FirstHealth of the Carolinas", "imaging", "Imaging center", "Moore", "100 Page Rd N", "Pinehurst", "28374", { agreement: "secured" }),
  S("S002", "FirstHealth Southern Pines Diagnostic Imaging", "FirstHealth of the Carolinas", "imaging", "Imaging center", "Moore", "355 S Bennett St", "Southern Pines", "28387", { agreement: "secured" }),
  S("S003", "FirstHealth Cancer Center", "FirstHealth of the Carolinas", "oncology", "Cancer center", "Moore", "135 Page Rd N", "Pinehurst", "28374", { agreement: "asked" }),
  S("S004", "FirstHealth Convenient Care — Southern Pines", "FirstHealth of the Carolinas", "urgent", "Urgent care", "Moore", "1690 US Hwy 1 S", "Southern Pines", "28387", { agreement: "secured" }),
  S("S005", "FirstHealth Convenient Care — Pinehurst", "FirstHealth of the Carolinas", "urgent", "Urgent care", "Moore", "215 Page Rd N", "Pinehurst", "28374", { est: true, agreement: "asked" }),
  S("S006", "FirstHealth Family Medicine — Pinehurst", "FirstHealth of the Carolinas", "clinic", "Physician office / clinic", "Moore", "150 Ivey Ln", "Pinehurst", "28374", { agreement: "secured" }),
  S("S007", "FirstHealth Primary Care — Southern Pines", "FirstHealth of the Carolinas", "clinic", "Physician office / clinic", "Moore", "155 Pinehurst Ave", "Southern Pines", "28387", { est: true, agreement: "asked" }),
  S("S008", "FirstHealth Family Medicine — Robbins", "FirstHealth of the Carolinas", "clinic", "Physician office / clinic", "Moore", "300 S Middleton St", "Robbins", "27325", { agreement: "prospect" }),
  S("S009", "FirstHealth Family Medicine — Vass", "FirstHealth of the Carolinas", "clinic", "Physician office / clinic", "Moore", "3349 US 1 Business Hwy", "Vass", "28394", { agreement: "prospect" }),
  S("S010", "FirstHealth Family Medicine — Carthage", "FirstHealth of the Carolinas", "clinic", "Physician office / clinic", "Moore", "405 Monroe St", "Carthage", "28327", { est: true, agreement: "asked" }),
  S("S011", "FirstHealth Family Medicine — Seven Lakes", "FirstHealth of the Carolinas", "clinic", "Physician office / clinic", "Moore", "1075 Seven Lakes Dr", "West End", "27376", { est: true }),
  S("S012", "FirstHealth Southern Pines Women's Health Center", "FirstHealth of the Carolinas", "clinic-imaging", "Physician office / clinic", "Moore", "145 Applecross Rd", "Southern Pines", "28388", { agreement: "secured" }),
  S("S013", "Pinehurst Medical Clinic — Pinehurst", "Pinehurst Medical Clinic", "multispecialty", "Physician office / clinic", "Moore", "205 Page Rd", "Pinehurst", "28374", { agreement: "secured" }),
  S("S014", "Pinehurst Medical Clinic — Southern Pines (Morganton Park)", "Pinehurst Medical Clinic", "multispecialty", "Physician office / clinic", "Moore", "200 Pavilion Way", "Southern Pines", "28387", { agreement: "secured" }),
  S("S015", "Pinehurst Surgical Clinic — Pinehurst", "Pinehurst Surgical Clinic", "ortho", "Physician office / clinic", "Moore", "5 FirstVillage Dr", "Pinehurst", "28374", { agreement: "secured", extraKits: ["imaging"] }),
  S("S016", "Sandhills Pediatrics — Southern Pines", "Sandhills Pediatrics", "clinic", "Physician office / clinic", "Moore", "105 Pavilion Way", "Southern Pines", "28387", { agreement: "asked" }),
  S("S017", "Carolina Eye Associates — Southern Pines", "Carolina Eye Associates", "clinic", "Physician office / clinic", "Moore", "2170 Midland Rd", "Southern Pines", "28387", { agreement: "prospect" }),
  S("S018", "Sandhills Orthopaedic & Spine Clinic", "Sandhills Orthopaedic & Spine Clinic", "ortho", "Physician office / clinic", "Moore", "4 Turnberry Wood", "Southern Pines", "28387", { agreement: "asked" }),
  S("S019", "Sandhills Urgent Care — Southern Pines", "Sandhills Urgent Care", "urgent", "Urgent care", "Moore", "10935 US Hwy 15-501", "Southern Pines", "28387", { agreement: "asked" }),
  S("S020", "FastMed Urgent Care — Aberdeen", "FastMed", "urgent", "Urgent care", "Moore", "1800 N Sandhills Blvd", "Aberdeen", "28315", { agreement: "prospect" }),
  S("S021", "DaVita Pinehurst Dialysis", "DaVita", "dialysis", "Dialysis center", "Moore", "16 Regional Dr", "Pinehurst", "28374", { agreement: "asked" }),
  S("S022", "DaVita Southern Pines Dialysis Center", "DaVita", "dialysis", "Dialysis center", "Moore", "209 Windstar Pl", "Southern Pines", "28387", { agreement: "prospect" }),
  S("S023", "FirstHealth Hospice & Palliative Care", "FirstHealth of the Carolinas", "hospice", "Home health / hospice", "Moore", "251 Campground Rd", "West End", "27376", { agreement: "secured" }),
  S("S024", "FirstHealth Home Care", "FirstHealth of the Carolinas", "homehealth", "Home health / hospice", "Moore", "181 Westgate Dr", "Pinehurst", "28374", { agreement: "secured" }),
  S("S025", "Liberty Home Care & Hospice — Southern Pines", "Liberty Healthcare", "hospice", "Home health / hospice", "Moore", "300 W Pennsylvania Ave", "Southern Pines", "28387", { agreement: "asked" }),
  S("S026", "Moore County Health Department", "Moore County", "health", "Public health / community", "Moore", "705 Pinehurst Ave", "Carthage", "28327", { agreement: "secured" }),
  S("S027", "Moore County Public Safety — EMS", "Moore County", "ems", "Public health / community", "Moore", "302 S McNeill St", "Carthage", "28327", { est: true, agreement: "asked" }),
  S("S028", "FirstHealth Regional EMS", "FirstHealth of the Carolinas", "ems", "Public health / community", "Moore", "155 Memorial Dr", "Pinehurst", "28374", { est: true, agreement: "prospect" }),
  S("S029", "Fox Hollow Senior Living", "Five Star Senior Living", "alf", "Adult care home", "Moore", "190 Fox Run Rd", "Pinehurst", "28374", { agreement: "asked" }),
  S("S030", "Belle Meade Senior Living", "St. Joseph of the Pines", "alf", "Adult care home", "Moore", "100 Waters Dr", "Southern Pines", "28387", { est: true, agreement: "prospect" }),
  S("S031", "The Inn at Quail Haven Village (assisted living)", "Quail Haven Village", "alf", "Adult care home", "Moore", "155 Blake Blvd", "Pinehurst", "28374", { agreement: "asked" }),
  S("S032", "FirstHealth Dental Care — Southern Pines", "FirstHealth of the Carolinas", "dental", "Physician office / clinic", "Moore", "245 W Vermont Ave", "Southern Pines", "28387", { est: true }),
  S("S033", "CVS Pharmacy — Southern Pines", "CVS Health", "pharmacy", "Pharmacy", "Moore", "1330 US Hwy 15-501", "Southern Pines", "28387", { est: true, agreement: "prospect" }),
  S("S034", "Walgreens — Pinehurst", "Walgreens", "pharmacy", "Pharmacy", "Moore", "1 Rattlesnake Trl", "Pinehurst", "28374", { est: true }),
  S("S035", "FirstHealth Outpatient Rehabilitation — Pinehurst", "FirstHealth of the Carolinas", "rehab", "Rehabilitation", "Moore", "170 Memorial Dr", "Pinehurst", "28374", { est: true, agreement: "asked" }),
  S("S036", "Pinehurst Radiology / Sandhills Imaging", "Pinehurst Radiology Associates", "imaging", "Imaging center", "Moore", "45 Aviemore Dr", "Pinehurst", "28374", { est: true, agreement: "prospect" }),
  S("S037", "Aberdeen Family Medicine", "Independent", "clinic", "Physician office / clinic", "Moore", "1103 N Sandhills Blvd", "Aberdeen", "28315", { est: true }),
  // ── Hoke County (Ring 1) ──
  S("S040", "Cape Fear Valley Health Pavilion Hoke — Imaging", "Cape Fear Valley Health", "imaging", "Imaging center", "Hoke", "300 Medical Pavilion Dr", "Raeford", "28376", { agreement: "secured" }),
  S("S041", "Cape Fear Valley Health Pavilion Hoke — Primary Care & ExpressCare", "Cape Fear Valley Health", "urgent", "Urgent care", "Hoke", "300 Medical Pavilion Dr", "Raeford", "28376", { agreement: "asked" }),
  S("S042", "Pinehurst Surgical Clinic — Raeford", "Pinehurst Surgical Clinic", "clinic", "Physician office / clinic", "Hoke", "6322 Fayetteville Rd", "Raeford", "28376", { agreement: "asked" }),
  S("S043", "FirstHealth Convenient Care — Raeford", "FirstHealth of the Carolinas", "urgent", "Urgent care", "Hoke", "6322 Fayetteville Rd", "Raeford", "28376", { est: true, agreement: "secured" }),
  S("S044", "Hoke County Health Department", "Hoke County", "health", "Public health / community", "Hoke", "683 E Palmer Rd", "Raeford", "28376", { agreement: "secured" }),
  S("S045", "DaVita Dialysis Care of Hoke County", "DaVita", "dialysis", "Dialysis center", "Hoke", "285 Paraclete Dr", "Raeford", "28376", { agreement: "asked" }),
  S("S046", "Liberty Home Care & Hospice — Raeford", "Liberty Healthcare", "hospice", "Home health / hospice", "Hoke", "336 S Main St", "Raeford", "28376", { agreement: "prospect" }),
  S("S047", "Southern Pines Women's Health Center — Raeford", "FirstHealth of the Carolinas", "clinic", "Physician office / clinic", "Hoke", "313 Teal Dr", "Raeford", "28376", { agreement: "prospect" }),
  S("S048", "Hoke Family Medical Center", "Independent", "clinic", "Physician office / clinic", "Hoke", "4050 Fayetteville Rd", "Raeford", "28376", { est: true }),
  S("S049", "Open Arms Retirement Center", "Open Arms", "alf", "Adult care home", "Hoke", "612 Health Dr", "Raeford", "28376", { est: true, agreement: "asked" }),
  S("S050", "Hoke County EMS", "Hoke County", "ems", "Public health / community", "Hoke", "423 E Central Ave", "Raeford", "28376", { est: true }),
  // ── Richmond County (Ring 1) ──
  S("S055", "Pinehurst Surgical Clinic — Rockingham", "Pinehurst Surgical Clinic", "clinic-imaging", "Physician office / clinic", "Richmond", "921 Long Dr, Ste 208", "Rockingham", "28379", { agreement: "asked" }),
  S("S056", "FirstHealth Convenient Care — Rockingham", "FirstHealth of the Carolinas", "urgent", "Urgent care", "Richmond", "921 Long Dr", "Rockingham", "28379", { est: true, agreement: "secured" }),
  S("S057", "Richmond County Health Department", "Richmond County", "health", "Public health / community", "Richmond", "127 Caroline St", "Rockingham", "28379", { agreement: "secured" }),
  S("S058", "Gentiva Hospice — Rockingham (Community Home Care & Hospice)", "Gentiva", "hospice", "Home health / hospice", "Richmond", "1015 Fayetteville Rd", "Rockingham", "28379", { agreement: "asked" }),
  S("S059", "Fresenius Kidney Care — Rockingham", "Fresenius Medical Care", "dialysis", "Dialysis center", "Richmond", "1100 Rockingham Rd", "Rockingham", "28379", { est: true, agreement: "prospect" }),
  S("S060", "Sandhills Family Medicine — Hamlet", "Independent", "clinic", "Physician office / clinic", "Richmond", "301 W Main St", "Hamlet", "28345", { est: true }),
  S("S061", "Richmond County EMS", "Richmond County", "ems", "Public health / community", "Richmond", "221 S Hancock St", "Rockingham", "28379", { est: true }),
  // ── Scotland County (Ring 1) ──
  S("S065", "Scotland Health — Edwin Morgan Center", "Scotland Health Care System", "ltc", "Nursing home", "Scotland", "500 Lauchwood Dr", "Laurinburg", "28352", { agreement: "secured" }),
  S("S066", "Fresenius Kidney Care — Laurinburg", "Fresenius Medical Care", "dialysis", "Dialysis center", "Scotland", "701 Lauchwood Dr", "Laurinburg", "28352", { agreement: "asked" }),
  S("S067", "Scotland County Health Department", "Scotland County", "health", "Public health / community", "Scotland", "1405 West Blvd", "Laurinburg", "28352", { agreement: "secured" }),
  S("S068", "Scotland Medical Center", "Scotland Health Care System", "clinic-imaging", "Physician office / clinic", "Scotland", "422 S King St", "Laurinburg", "28352", { agreement: "asked" }),
  S("S069", "Scotland Regional Hospice", "Scotland Health Care System", "hospice", "Home health / hospice", "Scotland", "610 Lauchwood Dr", "Laurinburg", "28352", { est: true, agreement: "prospect" }),
  S("S070", "Scotland Physicians Network — Family Medicine", "Scotland Health Care System", "clinic", "Physician office / clinic", "Scotland", "1000 S Main St", "Laurinburg", "28352", { est: true }),
  S("S071", "Scotland County EMS", "Scotland County", "ems", "Public health / community", "Scotland", "1403 West Blvd", "Laurinburg", "28352", { est: true }),
  // ── Lee County (Ring 1) ──
  S("S075", "Pinehurst Medical Clinic — Sanford", "Pinehurst Medical Clinic", "multispecialty", "Physician office / clinic", "Lee", "1413 Greenway Ct", "Sanford", "27330", { agreement: "asked" }),
  S("S076", "Pinehurst Surgical Clinic — Sanford", "Pinehurst Surgical Clinic", "clinic-imaging", "Physician office / clinic", "Lee", "1818 Doctors Dr", "Sanford", "27330", { agreement: "asked" }),
  S("S077", "FirstHealth Convenient Care — Sanford (Tramway)", "FirstHealth of the Carolinas", "urgent", "Urgent care", "Lee", "103 Marketplace Dr, Ste 101", "Sanford", "27332", { agreement: "secured" }),
  S("S078", "FirstHealth Imaging — Sanford", "FirstHealth of the Carolinas", "imaging", "Imaging center", "Lee", "1815 Doctors Dr", "Sanford", "27330", { est: true, agreement: "asked" }),
  S("S079", "Lee County Health Department", "Lee County", "health", "Public health / community", "Lee", "106 Hillcrest Dr", "Sanford", "27330", { agreement: "secured" }),
  S("S080", "Carolina Dialysis — Sanford", "Carolina Dialysis", "dialysis", "Dialysis center", "Lee", "1017 Carthage St", "Sanford", "27330", { agreement: "prospect" }),
  S("S081", "Central Carolina Hospital — Sanford Medical Group", "Central Carolina Hospital", "clinic", "Physician office / clinic", "Lee", "1139 Carthage St", "Sanford", "27330", { est: true, agreement: "asked" }),
  S("S082", "Lee County EMS", "Lee County", "ems", "Public health / community", "Lee", "1615 S Third St", "Sanford", "27330", { est: true }),
  // ── Montgomery County (Ring 1) ──
  S("S085", "Pinehurst Surgical Clinic — Troy", "Pinehurst Surgical Clinic", "clinic", "Physician office / clinic", "Montgomery", "522 Allen St", "Troy", "27371", { agreement: "asked" }),
  S("S086", "FirstHealth Family Medicine — Troy", "FirstHealth of the Carolinas", "clinic", "Physician office / clinic", "Montgomery", "522 Allen St", "Troy", "27371", { est: true, agreement: "secured" }),
  S("S087", "Montgomery County Health Department", "Montgomery County", "health", "Public health / community", "Montgomery", "217 S Main St", "Troy", "27371", { est: true, agreement: "asked" }),
  S("S088", "Montgomery County EMS", "Montgomery County", "ems", "Public health / community", "Montgomery", "102 E Main St", "Troy", "27371", { est: true }),
  // ── Cumberland County (Ring 2) ──
  S("S090", "Womack Army Medical Center", "U.S. Army (Fort Liberty)", "existing", "Acute care hospital", "Cumberland", "2817 Rock Merritt Ave", "Fort Liberty", "28310", { extraKits: ["hospital-large"], agreement: "prospect" }),
  S("S091", "Fayetteville VA Medical Center", "Veterans Health Administration", "existing", "Acute care hospital", "Cumberland", "2300 Ramsey St", "Fayetteville", "28301", { extraKits: ["hospital-mid"], agreement: "prospect" }),
  S("S092", "Cape Fear Valley Health Pavilion North — Imaging & ExpressCare", "Cape Fear Valley Health", "imaging", "Imaging center", "Cumberland", "6387 Ramsey St", "Fayetteville", "28311", { est: true, extraKits: ["urgent"], agreement: "asked" }),
  S("S093", "Cape Fear Valley ExpressCare — Fayetteville (Skibo)", "Cape Fear Valley Health", "urgent", "Urgent care", "Cumberland", "1919 Skibo Rd", "Fayetteville", "28314", { est: true, agreement: "asked" }),
  S("S094", "Cumberland County Department of Public Health", "Cumberland County", "health", "Public health / community", "Cumberland", "1235 Ramsey St", "Fayetteville", "28301", { agreement: "asked" }),
  S("S095", "Community Home Care & Hospice — Fayetteville", "Gentiva", "hospice", "Home health / hospice", "Cumberland", "2800 Breezewood Ave, Ste 100", "Fayetteville", "28303", { agreement: "prospect" }),
  S("S096", "DaVita Fayetteville Dialysis", "DaVita", "dialysis", "Dialysis center", "Cumberland", "2301 Robeson St", "Fayetteville", "28305", { est: true }),
  S("S097", "FastMed Urgent Care — Fayetteville", "FastMed", "urgent", "Urgent care", "Cumberland", "5407 Ramsey St", "Fayetteville", "28311", { est: true }),
  // ── Harnett / Anson / Chatham / Randolph (Ring 2) ──
  S("S100", "Harnett County Health Department", "Harnett County", "health", "Public health / community", "Harnett", "307 W Cornelius Harnett Blvd", "Lillington", "27546", { agreement: "prospect" }),
  S("S101", "Cape Fear Valley Harnett — Lillington Primary Care", "Cape Fear Valley Health", "clinic", "Physician office / clinic", "Harnett", "215 Brightwater Dr", "Lillington", "27546", { est: true }),
  S("S102", "Atrium Health Anson — Primary Care", "Atrium Health", "clinic", "Physician office / clinic", "Anson", "2301 US Hwy 74 W", "Wadesboro", "28170", { est: true, agreement: "prospect" }),
  S("S103", "Anson County Health Department", "Anson County", "health", "Public health / community", "Anson", "110 Ashe St", "Wadesboro", "28170", { est: true }),
  S("S104", "Chatham County Public Health", "Chatham County", "health", "Public health / community", "Chatham", "80 East St", "Pittsboro", "27312", { est: true }),
  S("S105", "Randolph Health — Outpatient Imaging", "Randolph Health", "imaging", "Imaging center", "Randolph", "364 White Oak St", "Asheboro", "27203", { est: true }),
];

// Rotation type → asset setting (adds to the radiography map's join).
export const EXTRA_ROTATIONS: [string, string | null, string][] = [
  ["Med-Surg", "BEDS", "Inpatient beds"], ["Medical-Surgical", "BEDS", "Inpatient beds"], ["ICU / Critical Care", "ICU", "Inpatient beds"], ["ICU", "ICU", "Inpatient beds"], ["Critical Care", "ICU", "Inpatient beds"],
  ["OB / Maternity", "OB", "Inpatient beds"], ["Obstetrics", "OB", "Inpatient beds"], ["Behavioral Health", "BH", "Behavioral health"], ["Mental Health", "BH", "Behavioral health"],
  ["Long-Term Care", "LTC", "Long-term care beds"], ["Skilled Nursing", "LTC", "Long-term care beds"], ["Adult Care", "ALF", "Adult care beds"],
  ["Doctor's Office", "AMB", "Ambulatory"], ["Ambulatory / Clinic", "AMB", "Ambulatory"], ["Ambulatory Surgery", "OR", "Surgical"],
  ["Community / Public Health", "PH", "Ambulatory"], ["Community Health", "PH", "Ambulatory"], ["Home Health", "HH", "Home & community"], ["Hospice", "HOSP", "Home & community"],
  ["Laboratory", "LAB", "Laboratory"], ["MRI", "MRI", "Imaging"], ["Rehabilitation", "REHAB", "Ambulatory"], ["Emergency", "ED", "Emergency"],
];

/** Which families each asset setting serves (for per-family site agreements). */
const FAMILY_SETTINGS: Record<string, string[]> = {
  Radiography: ["GEN", "ED", "PORT", "OR", "FLUORO", "CT", "MRI", "US", "MAMMO"],
  "Surgical Technology": ["OR"],
  "Nurse Aide": ["LTC", "ALF", "BEDS", "HH", "HOSP"],
  "Medical Assisting": ["AMB", "PH", "LAB", "PHARM", "DENT"],
  Nursing: ["BEDS", "ICU", "OB", "PEDS", "BH", "ED", "LTC", "HH", "PH"],
};

export async function loadSandhillsSites(prisma: PrismaClient, institutionId: string) {
  const hash = (s: string) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  let sites = 0, assets = 0, updated = 0;

  // 1. Verified addresses + inpatient kits for the licensed hospitals already on the map.
  for (const [ext, h] of Object.entries(HOSPITAL_ADDRESSES)) {
    const e = await prisma.employer.findFirst({ where: { institutionId, externalId: ext } });
    if (!e) continue;
    await prisma.employer.update({ where: { id: e.id }, data: { address: h.address, city: h.city, state: "NC", zip: h.zip } });
    updated++;
    if (ext === "H002") continue; // surgery center — its ORs are already on the map
    assets += await addKit(prisma, e.id, ext, KITS[h.kit], "ESTIMATE");
  }

  // 2. The new sites.
  const existingByName = new Map((await prisma.employer.findMany({ where: { institutionId }, select: { id: true, name: true } })).map((e) => [e.name.toLowerCase(), e.id]));
  for (const s of SANDHILLS_SITES) {
    let employerId = existingByName.get(s.name.toLowerCase());
    if (!employerId) {
      const e = await prisma.employer.create({ data: {
        institutionId, name: s.name, externalId: s.id, organization: s.org, facilityType: s.type, setting: s.type, county: s.county, ring: RING[s.county] ?? "Ring 2",
        address: s.address, city: s.city, state: "NC", zip: s.zip, status: "active", agreementStatus: s.agreement ?? "none",
        contactName: s.contact ?? null, sourceNote: s.est ? "Address estimated — verify with the partner" : "Address looked up Sept 2026",
        notes: s.est ? "Street address is an estimate; asset counts are planning estimates." : "Asset counts are planning estimates — confirm on the supply map.",
      } });
      employerId = e.id; sites++;
    }
    const kits = [...(s.kind === "existing" ? [] : KITS[s.kind] ?? []), ...(s.extraKits ?? []).flatMap((k) => KITS[k] ?? [])];
    assets += await addKit(prisma, employerId, s.id, kits, s.est ? "ESTIMATE" : "ESTIMATE");
  }

  // 3. Rotation type → setting joins for the new settings.
  for (const [rotationType, settingCode, unitCategory] of EXTRA_ROTATIONS) {
    await prisma.rotationSetting.upsert({ where: { institutionId_rotationType: { institutionId, rotationType } }, update: { settingCode }, create: { institutionId, rotationType, unitCategory, settingCode } });
  }

  // 4. Per-family agreements: every family gets its own relationship with the sites whose assets serve it.
  const families = await prisma.programFamily.findMany({ where: { institutionId }, select: { id: true, name: true } });
  const employers = await prisma.employer.findMany({ where: { institutionId }, select: { id: true, name: true, agreementStatus: true, assets: { select: { settingCode: true } } } });
  let agreements = 0;
  for (const f of families) {
    const codes = Object.entries(FAMILY_SETTINGS).find(([k]) => f.name.toLowerCase().includes(k.toLowerCase()))?.[1];
    if (!codes) continue;
    for (const e of employers) {
      if (!e.assets.some((a) => codes.includes(a.settingCode))) continue;
      const h = hash(`${f.id}|${e.id}`) % 100;
      const status = e.agreementStatus === "secured" ? (h < 80 ? "secured" : "asked") : e.agreementStatus === "asked" ? (h < 60 ? "asked" : h < 80 ? "secured" : "prospect") : h < 25 ? "asked" : h < 40 ? "secured" : "prospect";
      await prisma.familySite.upsert({ where: { familyId_employerId: { familyId: f.id, employerId: e.id } }, update: {}, create: { familyId: f.id, employerId: e.id, agreementStatus: status } });
      agreements++;
    }
  }
  return { sites, assets, hospitalsUpdated: updated, agreements };
}

async function addKit(prisma: PrismaClient, employerId: string, ext: string, kits: Kit[], dataSource: string) {
  let n = 0;
  const existing = await prisma.clinicalAsset.findMany({ where: { employerId }, select: { settingCode: true, assetNumber: true } });
  const next = (code: string) => existing.filter((a) => a.settingCode === code).length + 1;
  for (const k of kits) {
    const r = RULES[k.rule];
    for (let i = 0; i < k.n; i++) {
      const num = next(k.code);
      const hours = k.hours ?? 8;
      await prisma.clinicalAsset.create({ data: {
        employerId, externalId: `${ext}-${k.code}-${String(num).padStart(2, "0")}`, settingCode: k.code, setting: k.setting, assetType: k.assetType, assetNumber: num,
        // 12-hour units run two blocks (07–19 day, 19–07 night); everything else keeps the rule's blocks.
        operatingRule: r.operatingRule, days: r.days, shiftBlocks: hours >= 12 ? r.blocks.split(",").filter((b) => b !== "Evening").join(",") : r.blocks, hoursPerShift: hours,
        dayStart: "07:00", dayHours: hours, eveningStart: hours >= 12 ? "19:00" : "15:00", eveningHours: hours >= 12 ? 12 : 8, nightStart: hours >= 12 ? "19:00" : "23:00", nightHours: hours >= 12 ? 12 : 8,
        serves: k.serves ?? null, learnersPerShift: k.learners, preceptorsPerShift: k.preceptors ?? 1, dataSource,
      } });
      existing.push({ settingCode: k.code, assetNumber: num });
      n++;
    }
  }
  return n;
}
