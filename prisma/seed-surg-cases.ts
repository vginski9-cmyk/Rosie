import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeFacilityName, avgCasesPerDay } from "../src/lib/surgvolume";

// SURGICAL CASE VOLUME per facility, from the surgical technology facility capacity tracker
// (state-reported OR activity, Proposed 2027 SMFP). For every facility on the tracker: OR inventory,
// the inpatient / ambulatory / annual case split, and the modeled operating days a year the daily
// average is taken over. Facilities already on file are updated by name; hospitals on the tracker
// with reported cases that are not on file yet are created as prospects (located by town).
// Surgical technology takes ONE student and ONE preceptor per OR unit — the tracker's own rule —
// so every surgical functional unit and OR suite is set to 1 / 1.

interface Row { market: string; county: string | null; city: string | null; name: string; system: string | null; type: string | null; license: string | null; operatingRooms: number | null; inpatientCases: number | null; ambulatoryCases: number | null; annualCases: number | null; stateStatus: string | null; priority: string | null; clinicalValue: string | null; constraint: string | null; url: string | null; operatingDaysPerYear: number | null; dataConfidence: string | null }
interface Template { source: string; period: string; facilities: Row[] }

const ALIASES: Record<string, string> = {
  "firsthealth moore regional hospital hoke": "firsthealth moore regional hospital hoke",
};
const FACILITY_TYPE: Record<string, string> = { Hospital: "Acute care hospital", "Ambulatory surgical facility": "Ambulatory surgery center", "Qualified urban ambulatory surgical facility": "Ambulatory surgery center", "Federal military hospital": "Acute care hospital", "Federal veterans hospital": "Acute care hospital" };

export async function applySurgicalCaseVolumes(prisma: PrismaClient, institutionId: string) {
  const t = JSON.parse(readFileSync(join(__dirname, "templates", "surgtech-case-volume.json"), "utf8")) as Template;
  const employers = await prisma.employer.findMany({ where: { institutionId }, select: { id: true, name: true } });
  const byName = new Map(employers.map((e) => [normalizeFacilityName(e.name), e.id]));
  let updated = 0, created = 0; const unmatched: string[] = [];
  for (const f of t.facilities) {
    const key = ALIASES[normalizeFacilityName(f.name)] ?? normalizeFacilityName(f.name);
    let id = byName.get(key);
    const data = {
      operatingRooms: f.operatingRooms != null ? Math.round(f.operatingRooms) : undefined,
      annualSurgicalCases: f.annualCases != null ? Math.round(f.annualCases) : undefined,
      inpatientSurgicalCases: f.inpatientCases != null ? Math.round(f.inpatientCases) : null,
      ambulatorySurgicalCases: f.ambulatoryCases != null ? Math.round(f.ambulatoryCases) : null,
      operatingDaysPerYear: f.operatingDaysPerYear != null ? Math.round(f.operatingDaysPerYear) : null,
      surgicalCaseSource: f.annualCases != null ? `${t.source.split(" — ")[1] ?? t.source}${f.license ? ` · license ${f.license}` : ""}${f.dataConfidence ? ` · ${f.dataConfidence}` : ""}` : null,
    };
    if (id) { await prisma.employer.update({ where: { id }, data }); updated++; continue; }
    // Not on file: only the tracker's hospitals and surgery centers with reported cases are worth a record.
    if (!f.annualCases) { unmatched.push(f.name); continue; }
    const e = await prisma.employer.create({ data: { institutionId, name: f.name, organization: f.system, county: f.county, city: f.city, state: "NC", facilityType: FACILITY_TYPE[f.type ?? ""] ?? f.type, setting: FACILITY_TYPE[f.type ?? ""] ?? f.type, status: "prospect", agreementStatus: "none", sourceNote: `${f.clinicalValue ?? ""}${f.constraint ? ` ${f.constraint}` : ""}`.trim() || null, ...data } });
    byName.set(key, e.id); created++;
  }
  // One student, one preceptor per surgical unit.
  const units = await prisma.clinicalUnit.updateMany({ where: { employer: { institutionId }, unitCategory: "Surgical" }, data: { studentsPerShift: 1, preceptorsPerShift: 1, studentsPerPreceptor: 1 } });
  const suites = await prisma.clinicalAsset.updateMany({ where: { employer: { institutionId }, settingCode: "ORS" }, data: { learnersPerShift: 1, preceptorsPerShift: 1 } });
  // The OR suites' "serves" line carries the daily average, so the roster reads it at a glance.
  for (const e of await prisma.employer.findMany({ where: { institutionId, annualSurgicalCases: { not: null }, assets: { some: { settingCode: "ORS" } } }, select: { id: true, annualSurgicalCases: true, operatingDaysPerYear: true, operatingRooms: true } })) {
    const perDay = avgCasesPerDay(e);
    if (perDay == null) continue;
    await prisma.clinicalAsset.updateMany({ where: { employerId: e.id, settingCode: "ORS" }, data: { serves: `Surgical cases — ${e.annualSurgicalCases} a year, ≈ ${perDay.toFixed(1)} a day across ${e.operatingRooms ?? "?"} ORs` } });
  }
  return { updated, created, unitsSetToOne: units.count, suitesSetToOne: suites.count, notOnFile: unmatched };
}
