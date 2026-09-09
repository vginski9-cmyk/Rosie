// Asset settings a clinical site can carry — code, what it is, and the typical asset type —
// shared by every page that builds assets so the vocabulary is one.
export const SETTING_PRESETS: [string, string, string][] = [
  ["GEN", "General diagnostic radiography", "Fixed radiographic room"], ["ED", "Emergency / trauma radiography", "ED radiographic room"], ["PORT", "Portable / inpatient radiography", "Mobile radiography unit"],
  ["OR", "Operating room / C-arm", "Mobile C-arm"], ["FLUORO", "Diagnostic fluoroscopy", "R&F / fluoroscopy room"], ["CT", "Computed tomography", "CT scanner"], ["MRI", "Magnetic resonance", "MRI scanner"],
  ["ORS", "Operating room suite", "OR suite"], ["BEDS", "Medical-surgical / telemetry unit", "Med-surg nursing unit"], ["ICU", "Intensive / critical care unit", "ICU nursing unit"], ["OB", "Labor & delivery / mother-baby", "L&D and postpartum unit"],
  ["PEDS", "Pediatric inpatient unit", "Pediatric nursing unit"], ["BH", "Behavioral health unit", "Inpatient behavioral health unit"], ["LTC", "Long-term care nursing unit", "SNF nursing unit"], ["ALF", "Assisted living / adult care", "Assisted living unit"],
  ["AMB", "Ambulatory clinic / physician office", "Clinic exam rooms"], ["US", "Diagnostic ultrasound", "Ultrasound room"], ["MAMMO", "Mammography", "Mammography suite"], ["LAB", "Clinical laboratory", "Core lab bench"],
  ["PHARM", "Pharmacy", "Pharmacy"], ["DIAL", "Outpatient dialysis", "Dialysis stations"], ["HH", "Home health", "Home-visit team"], ["HOSP", "Hospice & palliative care", "Hospice care team"],
  ["PH", "Public health clinic", "Public health clinic rooms"], ["EMS", "Emergency medical services", "ALS ambulance"], ["REHAB", "Rehabilitation (PT / OT)", "Rehab gym"], ["DENT", "Dental clinic", "Dental operatory"],
];
export const settingName = (code: string) => SETTING_PRESETS.find((p) => p[0] === code)?.[1] ?? code;
