// JRCERT clinical capacity (Form 1010R, Clinical Capacity Change — Radiography).
//
// The JRCERT sets a clinical setting's total capacity at the LOWER of two resources
// on the facility's campus:
//   physical — radiographic rooms + R&F rooms, plus mobile units + C-arms
//              (mammography, CT, MR, ultrasound, nuclear medicine, interventional,
//              cardiovascular, bone densitometry and therapy equipment do not count);
//   human    — qualified practitioners / radiographers scheduled on a typical day
//              during the hours students are on site.
// Capacity is the number of students the program may assign to the facility at
// any one time. This module counts the physical resources from the asset map,
// takes the human count from the site record, and reads what the calendar
// actually assigns — so a site is flagged before a request has to be filed.

export type AccreditorClass = "RAD_ROOM" | "RF_ROOM" | "MOBILE" | "C_ARM" | "EXCLUDED";
export const ACCREDITOR_CLASS_LABEL: Record<AccreditorClass, string> = {
  RAD_ROOM: "Radiographic room", RF_ROOM: "R&F room", MOBILE: "Mobile unit", C_ARM: "C-arm", EXCLUDED: "Not counted by JRCERT",
};
export const ACCREDITOR_CLASSES: AccreditorClass[] = ["RAD_ROOM", "RF_ROOM", "MOBILE", "C_ARM", "EXCLUDED"];

/** How the JRCERT counts an asset: the coded override, else derived from its setting and type. */
export function accreditorClassOf(a: { settingCode: string; assetType?: string | null; accreditorClass?: string | null }): AccreditorClass {
  if (a.accreditorClass && (ACCREDITOR_CLASSES as string[]).includes(a.accreditorClass)) return a.accreditorClass as AccreditorClass;
  const type = (a.assetType ?? "").toLowerCase();
  if (/c-?arm/.test(type)) return "C_ARM";
  if (/mobile|portable/.test(type)) return "MOBILE";
  if (/r&f|r\/f|fluoro/.test(type)) return "RF_ROOM";
  if (/radiographic room|x-?ray room|rad room|ed radiographic/.test(type)) return "RAD_ROOM";
  switch (a.settingCode) {
    case "GEN": case "ED": return "RAD_ROOM";
    case "FLUORO": return "RF_ROOM";
    case "PORT": return "MOBILE";
    case "OR": return "C_ARM";
    default: return "EXCLUDED";
  }
}

export interface CapacityAsset { id?: string; settingCode: string; assetType?: string | null; accreditorClass?: string | null; status?: string; preceptorsPerShift?: number; shiftBlocks?: string }
export interface CapacityInput {
  assets: CapacityAsset[];
  /** Qualified radiographers scheduled during student hours (the site record); null = not yet counted. */
  qualifiedStaffOnShift: number | null;
}
export interface CapacityResult {
  rooms: number;   // radiographic + R&F rooms
  units: number;   // mobile + C-arm
  physical: number; // rooms + units
  excluded: number; // assets JRCERT does not count
  human: number | null;
  /** Estimate of the human count from the assets' preceptors-per-shift on the day shift, when the site record has none. */
  humanEstimate: number;
  /** The lower of the two resources (uses the estimate when the site has no coded count). */
  capacity: number;
  limiting: "physical" | "human" | "tie";
  humanIsEstimate: boolean;
  byClass: Record<AccreditorClass, number>;
}

export function jrcertCapacity(input: CapacityInput): CapacityResult {
  const active = input.assets.filter((a) => (a.status ?? "active") !== "archived");
  const byClass: Record<AccreditorClass, number> = { RAD_ROOM: 0, RF_ROOM: 0, MOBILE: 0, C_ARM: 0, EXCLUDED: 0 };
  let humanEstimate = 0;
  for (const a of active) {
    const cls = accreditorClassOf(a);
    byClass[cls]++;
    if (cls !== "EXCLUDED" && (a.shiftBlocks ?? "Day").split(",").map((b) => b.trim()).includes("Day")) humanEstimate += Math.max(0, a.preceptorsPerShift ?? 1);
  }
  const rooms = byClass.RAD_ROOM + byClass.RF_ROOM;
  const units = byClass.MOBILE + byClass.C_ARM;
  const physical = rooms + units;
  const humanIsEstimate = input.qualifiedStaffOnShift == null;
  const human = humanIsEstimate ? humanEstimate : input.qualifiedStaffOnShift!;
  const capacity = Math.max(0, Math.min(physical, human));
  const limiting: CapacityResult["limiting"] = physical < human ? "physical" : human < physical ? "human" : "tie";
  return { rooms, units, physical, excluded: byClass.EXCLUDED, human: input.qualifiedStaffOnShift, humanEstimate, capacity, limiting, humanIsEstimate, byClass };
}

/** The most students the calendar puts on the site at any one time: the peak, over every
 *  weekday and moment, of the seats of the clinical bookings that overlap there (same
 *  weekday, overlapping time of day, overlapping calendar weeks). */
export function peakAssigned(meetings: { dayOfWeek: string; startMin: number; lengthHours: number; weekStartMs: number; weekEndMs: number; seats: number }[]): { peak: number; dayOfWeek: string | null; startMin: number | null } {
  let best = { peak: 0, dayOfWeek: null as string | null, startMin: null as number | null };
  for (const m of meetings) {
    const end = m.startMin + m.lengthHours * 60;
    let n = 0;
    for (const o of meetings) {
      if (o.dayOfWeek !== m.dayOfWeek) continue;
      const oEnd = o.startMin + o.lengthHours * 60;
      if (!(m.startMin < oEnd && o.startMin < end)) continue;
      if (!(m.weekStartMs <= o.weekEndMs && o.weekStartMs <= m.weekEndMs)) continue;
      n += o.seats;
    }
    if (n > best.peak) best = { peak: n, dayOfWeek: m.dayOfWeek, startMin: m.startMin };
  }
  return best;
}

/** Section III of Form 1010R: what the requested change does to the program's total capacity. */
export function programCapacityChange(currentTotal: number | null, approved: number | null, requested: number | null): { kind: "same" | "increase" | "decrease"; by: number; newTotal: number | null } {
  const delta = (requested ?? approved ?? 0) - (approved ?? 0);
  const kind = delta > 0 ? "increase" : delta < 0 ? "decrease" : "same";
  return { kind, by: Math.abs(delta), newTotal: currentTotal == null ? null : currentTotal + delta };
}
