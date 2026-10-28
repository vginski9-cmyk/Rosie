// Which practitioners precept which job — by the title on the person's record. An RT(R)
// precepts radiography; a CST or OR RN precepts surgical technology; an LPN or CNA II
// precepts nurse aides. Shared by the seed and the directory so the same rule applies.

export const DISCIPLINES: { family: RegExp; title: RegExp; label: string; credential: string }[] = [
  { family: /Radiograph|Imaging/i, title: /Radiolog|RT\(R\)|Radiograph|MRI/i, label: "registered radiographer", credential: "ARRT RT(R) — JRCERT: a qualified radiographer for direct / indirect supervision; the clinical preceptor needs 2+ years post-certification experience" },
  { family: /Surgical/i, title: /Surg|OR |CST|CSFA|Operating/i, label: "CST / OR nurse", credential: "CST, CSFA or OR RN — ARC/STSA: a credentialed practitioner supervises every scrubbed case" },
  { family: /Nurse Aide|CNA/i, title: /Nurse Aide|CNA|LPN|SNF|RN,/i, label: "nurse (RN / LPN) or CNA II", credential: "RN-supervised per 42 CFR §483.152; an LPN or CNA II may assist" },
  { family: /Nursing|prelicensure (RN|BSN)/i, title: /\bRN\b|Nurse Educator|Clinical Nurse|BSN|MSN|Charge Nurse/i, label: "registered nurse", credential: "RN — NC BON 21 NCAC 36 .0321: every clinical experience, precepted ones included, is directed by nursing faculty; a preceptor is a licensed RN in the setting" },
  { family: /Medical Assist/i, title: /Medical Assist|CMA|RMA|Office Manager|Clinic/i, label: "CMA / practice supervisor", credential: "a credentialed MA or the practice's clinical supervisor" },
];
export function disciplineOf(familyName: string) {
  return DISCIPLINES.find((d) => d.family.test(familyName)) ?? { family: /./, title: /./, label: "practitioner", credential: "a practitioner in the discipline" };
}
