// The clinical ROTATION planner — who is where, shift by shift, for one clinical
// course of one offering.
//
// Class and lab are easy: every section meets in one room at one time. Clinical
// is not: on any given day some students are in the primary setting (the OR, the
// general radiographic rooms) and others are out-rotated (ED, portables, C-arm,
// fluoro, CT); every setting at every site takes only so many learners per shift;
// a site never takes more students at once than its accreditor approved; there
// are only so many surgeries in a day. And the requirement grid says how many
// hours of each service area every student must finish by the end of the course.
//
// buildRotationPlan() walks the course's dated shifts in order and, on each
// date, gives every student the service area they are furthest behind on that
// still has a free seat that day — staying in an out-rotation until its hours
// are done (block rotations, not daily ping-pong), at their home site when it
// has the setting, elsewhere when it doesn't, never past a seat, a site cap or
// the day's case volume. Pinned cells are honoured first. The result carries
// per-student hours by area against the grid, per-date loads against capacity,
// and the bottlenecks (area × week where demand had to wait), so a coordinator
// sees at once what the sites can absorb and who is short.
//
// evaluatePlan() scores any set of placements (the saved one, or after a hand
// edit) the same way. Pure functions — no React, no Prisma, deterministic.

import { blocksOn, overrideIndex, overrideKey, type AssetLite, type AssetDayOverride, type AssetBookingLite } from "./assetmap";
import type { ShiftBlock } from "./clinicalsupply";

export interface RotationStudent { id: string; name: string; seat: number; sectionIndex: number; homeEmployerId: string | null }
export interface RotationShift { sessionId: string; date: string; weekMonday: string; block: ShiftBlock; hours: number; rotationType: string | null; settingCode: string | null; holiday: string | null }
/** One service area of the requirement grid: hours every student must finish, and the settings that credit it. */
export interface AreaNeed { code: string; name: string; settingCodes: string[]; hours: number }
export interface RotationSite {
  employerId: string; name: string;
  /** 0 secured · 1 asked · 2 prospect · 3 none. */
  agreementRank: number;
  /** Accreditor-approved students at any one time (JRCERT capacity), when recognized. */
  approvedCapacity: number | null;
  /** Annual surgical case volume, for the OR case constraint. */
  annualSurgicalCases: number | null;
}
export interface RotationOptions {
  /** Which agreements may host: 0 secured only, 1 secured + asked, 2 any. */
  maxAgreementRank: 0 | 1 | 2;
  /** Cases one student needs per OR day — with a site's annual volume this caps students in the OR per day (0 = ignore case volume). */
  casesPerStudentDay: number;
  /** Working days a year the case volume spreads over. */
  caseDaysPerYear: number;
  /** Keep a student at their home site whenever it has the setting (else the least-loaded allowed site). */
  keepHome: boolean;
  /** Leave holiday shifts unplaced. */
  skipHolidays: boolean;
  /** The setting that counts as the course's primary experience (everything else is an out-rotation); null = the most-required area's first setting. */
  primarySetting: string | null;
}
export const DEFAULT_ROTATION_OPTIONS: RotationOptions = { maxAgreementRank: 1, casesPerStudentDay: 2, caseDaysPerYear: 250, keepHome: true, skipHolidays: true, primarySetting: null };

export interface RotationInput {
  students: RotationStudent[];
  shifts: RotationShift[];
  areas: AreaNeed[];
  sites: RotationSite[];
  assets: AssetLite[];
  overrides: AssetDayOverride[];
  /** Bookings by OTHER cohorts / courses — they consume seats. */
  existingBookings: AssetBookingLite[];
  /** studentId|date → area code the coordinator pinned. */
  pins: Record<string, string>;
  options: RotationOptions;
}
export interface Placement { studentId: string; sessionId: string; date: string; block: ShiftBlock; hours: number; areaCode: string; settingCode: string; employerId: string; assetId: string; away: boolean; pinned: boolean; reason: string }
export interface Unplaced { studentId: string; sessionId: string; date: string; reason: string }
/** short = hours still owed in an area beyond half a shift (a remainder smaller than that cannot be scheduled as a whole shift and is not counted). */
export interface StudentTally { studentId: string; name: string; seat: number; homeEmployerId: string | null; byArea: Record<string, { required: number; planned: number; short: number }>; plannedHours: number; requiredHours: number; shortHours: number; awayShifts: number; unplaced: number; sites: string[] }
export interface LoadCell { date: string; block: ShiftBlock; employerId: string; siteName: string; settingCode: string; used: number; capacity: number }
export interface RotationBottleneck { weekMonday: string; areaCode: string; deferred: number; capacity: number; note: string }
export interface RotationPlan {
  placements: Placement[]; unplaced: Unplaced[]; students: StudentTally[]; loads: LoadCell[]; bottlenecks: RotationBottleneck[];
  weeks: string[]; primarySetting: string | null;
  summary: { shifts: number; placed: number; unplaced: number; away: number; studentsShort: number; shortHours: number; requiredHours: number; plannedHours: number };
}

const key = (...parts: (string | number)[]) => parts.join("|");

/** Seat bookkeeping for the plan: free learner seats per asset × date × block, site caps, case caps. */
function supply(input: RotationInput) {
  const ov = overrideIndex(input.overrides);
  const live = input.assets.filter((a) => a.status !== "archived" && a.facilityStatus !== "archived");
  const siteById = new Map(input.sites.map((s) => [s.employerId, s]));
  const allowed = live.filter((a) => (siteById.get(a.employerId)?.agreementRank ?? 3) <= input.options.maxAgreementRank);
  const used = new Map<string, number>(); // asset|date|block
  for (const b of input.existingBookings) used.set(key(b.assetId, b.date, b.block), (used.get(key(b.assetId, b.date, b.block)) ?? 0) + b.students);
  const siteUsed = new Map<string, number>(); // employer|date|block
  const siteSettingUsed = new Map<string, number>(); // employer|date|block|setting
  const opensCache = new Map<string, boolean>();
  const opens = (a: AssetLite, date: string, block: ShiftBlock) => { const k = key(a.id, date, block); let v = opensCache.get(k); if (v == null) { v = blocksOn(a, date, ov.get(overrideKey(a.id, date))).includes(block); opensCache.set(k, v); } return v; };
  const freeOf = (a: AssetLite, date: string, block: ShiftBlock) => Math.max(0, a.learnersPerShift - (used.get(key(a.id, date, block)) ?? 0));
  const caseCap = (employerId: string) => { const s = siteById.get(employerId); if (!s?.annualSurgicalCases || input.options.casesPerStudentDay <= 0) return Infinity; return Math.max(0, Math.floor(s.annualSurgicalCases / Math.max(1, input.options.caseDaysPerYear) / input.options.casesPerStudentDay)); };
  /** Free seats of one setting at one site on a date × block, respecting the site cap and (for the OR) the case volume. */
  const siteFree = (employerId: string, settingCode: string, date: string, block: ShiftBlock) => {
    const assets = allowed.filter((a) => a.employerId === employerId && a.settingCode === settingCode && opens(a, date, block));
    const seats = assets.reduce((n, a) => n + freeOf(a, date, block), 0);
    const cap = siteById.get(employerId)?.approvedCapacity;
    const capLeft = cap == null ? Infinity : Math.max(0, cap - (siteUsed.get(key(employerId, date, block)) ?? 0));
    const caseLeft = settingCode === "OR" || settingCode === "ORS" ? Math.max(0, caseCap(employerId) - (siteSettingUsed.get(key(employerId, date, block, settingCode)) ?? 0)) : Infinity;
    return { assets, free: Math.min(seats, capLeft, caseLeft) };
  };
  const take = (employerId: string, settingCode: string, date: string, block: ShiftBlock): string | null => {
    const { assets, free } = siteFree(employerId, settingCode, date, block);
    if (free <= 0) return null;
    const a = assets.filter((x) => freeOf(x, date, block) > 0).sort((x, y) => freeOf(y, date, block) - freeOf(x, date, block) || x.assetNumber - y.assetNumber)[0];
    if (!a) return null;
    used.set(key(a.id, date, block), (used.get(key(a.id, date, block)) ?? 0) + 1);
    siteUsed.set(key(employerId, date, block), (siteUsed.get(key(employerId, date, block)) ?? 0) + 1);
    siteSettingUsed.set(key(employerId, date, block, settingCode), (siteSettingUsed.get(key(employerId, date, block, settingCode)) ?? 0) + 1);
    return a.id;
  };
  /** Total seats of a setting on a date × block across allowed sites (physical, before this plan). */
  const capacityOf = (settingCode: string, date: string, block: ShiftBlock) => {
    let n = 0;
    for (const s of input.sites) { if (s.agreementRank > input.options.maxAgreementRank) continue; const { free } = siteFree(s.employerId, settingCode, date, block); n += free; }
    return n;
  };
  const sitesWith = (settingCode: string) => [...new Set(allowed.filter((a) => a.settingCode === settingCode).map((a) => a.employerId))];
  const loadOf = (employerId: string, date: string, block: ShiftBlock) => siteUsed.get(key(employerId, date, block)) ?? 0;
  return { allowed, siteById, siteFree, take, capacityOf, sitesWith, loadOf, used, siteUsed, siteSettingUsed, opens };
}

/** The course's primary setting: the coded one, else the first setting of the area with the most hours. */
export function primarySettingOf(input: Pick<RotationInput, "areas" | "shifts" | "options">): string | null {
  if (input.options.primarySetting) return input.options.primarySetting;
  const fromShifts = new Map<string, number>();
  for (const s of input.shifts) if (s.settingCode) fromShifts.set(s.settingCode, (fromShifts.get(s.settingCode) ?? 0) + 1);
  const top = [...input.areas].sort((a, b) => b.hours - a.hours)[0];
  return top?.settingCodes[0] ?? [...fromShifts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function buildRotationPlan(input: RotationInput): RotationPlan {
  const S = supply(input);
  const primary = primarySettingOf(input);
  const areas = input.areas.filter((a) => a.hours > 0 && a.settingCodes.length);
  // An area whose settings are all uncountable (no allowed site has them) is flagged, not chased.
  const areaOk = new Map(areas.map((a) => [a.code, a.settingCodes.some((c) => S.sitesWith(c).length > 0)]));
  const areaOf = (settingCode: string) => areas.find((a) => a.settingCodes.includes(settingCode))?.code ?? settingCode;
  const shifts = [...input.shifts].sort((a, b) => a.date.localeCompare(b.date) || a.block.localeCompare(b.block));
  const totalHours = shifts.reduce((n, s) => n + s.hours, 0);
  const requiredHours = areas.reduce((n, a) => n + a.hours, 0);
  // Per student: hours planned by area, the area they are in now, and their home.
  const planned = new Map<string, Map<string, number>>();
  const current = new Map<string, string | null>();
  const hoursLeftAfter = (i: number) => shifts.slice(i + 1).reduce((n, s) => n + s.hours, 0);
  const placements: Placement[] = [];
  const unplaced: Unplaced[] = [];
  const deferred = new Map<string, { deferred: number; capacity: number }>(); // week|area
  const get = (sid: string, area: string) => planned.get(sid)?.get(area) ?? 0;
  const add = (sid: string, area: string, h: number) => { const m = planned.get(sid) ?? new Map(); m.set(area, (m.get(area) ?? 0) + h); planned.set(sid, m); };

  shifts.forEach((shift, i) => {
    if (input.options.skipHolidays && shift.holiday) { for (const st of input.students) unplaced.push({ studentId: st.id, sessionId: shift.sessionId, date: shift.date, reason: `holiday — ${shift.holiday}` }); return; }
    const left = hoursLeftAfter(i);
    // Urgency: how far behind a student is on their most-behind area, relative to the hours still ahead.
    const urgency = (sid: string) => { let u = 0; for (const a of areas) { const need = a.hours - get(sid, a.code); if (need > 0) u = Math.max(u, need / Math.max(shift.hours, left + shift.hours)); } return u; };
    const order = [...input.students].sort((x, y) => {
      const px = input.pins[key(x.id, shift.date)], py = input.pins[key(y.id, shift.date)];
      if (!!px !== !!py) return px ? -1 : 1; // pinned first — they must get their seat
      return urgency(y.id) - urgency(x.id) || ((x.seat + i) % input.students.length) - ((y.seat + i) % input.students.length);
    });
    for (const st of order) {
      const pin = input.pins[key(st.id, shift.date)] ?? null;
      const cur = current.get(st.id) ?? null;
      // Candidate areas, best first: the pin; else the area they are in with hours still owed (block continuity);
      // else out-rotations by deficit; the primary setting last (it soaks up whatever is left).
      // An area is done once what is left is under half a shift: 25 h of portables in 7.5 h shifts is three
      // shifts (22.5 h), not four — the primary setting absorbs the remainder.
      const tol = shift.hours / 2;
      const isPrimary = (a: AreaNeed) => !!primary && a.settingCodes.includes(primary);
      const deficits = areas.map((a) => ({ a, need: a.hours - get(st.id, a.code) })).filter((x) => (x.need > tol || (isPrimary(x.a) && x.need > 1e-9)) && areaOk.get(x.a.code));
      const cands: { area: AreaNeed | null; settings: string[]; why: string }[] = [];
      if (pin) { const a = areas.find((x) => x.code === pin); cands.push({ area: a ?? null, settings: a?.settingCodes ?? [pin], why: "pinned" }); }
      else {
        // Stay in the out-rotation block they are in until its hours are done.
        if (cur) { const d = deficits.find((x) => x.a.code === cur); if (d && !isPrimary(d.a)) cands.push({ area: d.a, settings: d.a.settingCodes, why: `continuing ${cur}` }); }
        // Then every area — the primary one included — by how much of it is still owed, so out-rotations
        // spread across the term instead of everyone rushing them first and flooding the primary rooms at the end;
        // on a tie the scarcer setting goes first.
        const ranked = deficits.map((d) => ({ ...d, ratio: d.need / Math.max(1e-9, d.a.hours), seats: d.a.settingCodes.reduce((n, c) => n + S.capacityOf(c, shift.date, shift.block), 0) })).sort((x, y) => y.ratio - x.ratio || x.seats - y.seats);
        for (const d of ranked) if (!cands.some((c) => c.area?.code === d.a.code)) cands.push({ area: d.a, settings: isPrimary(d.a) ? [primary!, ...d.a.settingCodes.filter((c) => c !== primary)] : d.a.settingCodes, why: isPrimary(d.a) ? "primary experience" : `${d.a.code} short ${Math.round(d.need)} h` });
        const prim = areas.find(isPrimary);
        if (prim && !cands.some((c) => c.area?.code === prim.code)) cands.push({ area: prim, settings: [primary!, ...prim.settingCodes.filter((c) => c !== primary)], why: "primary experience" });
        else if (!prim && primary) cands.push({ area: null, settings: [primary], why: "primary experience" });
        // Anything the course's own shifts say, then — rather than an idle day — an extra shift in any
        // area already complete (an extra ED day beats no clinical day when every primary seat is taken).
        if (shift.settingCode && !cands.some((c) => c.settings.includes(shift.settingCode!))) cands.push({ area: null, settings: [shift.settingCode], why: "the session's rotation type" });
        for (const a of areas) if (!cands.some((c) => c.area?.code === a.code) && areaOk.get(a.code)) cands.push({ area: a, settings: a.settingCodes, why: `extra ${a.code} day — every seat in the areas still owed was taken` });
      }
      let done = false;
      for (const c of cands) {
        for (const setting of c.settings) {
          // Sites: home first when it has the setting, then allowed sites by agreement then least loaded.
          const withSetting = S.sitesWith(setting);
          const homeFirst = input.options.keepHome && st.homeEmployerId && withSetting.includes(st.homeEmployerId) ? [st.homeEmployerId] : [];
          const others = withSetting.filter((e) => e !== st.homeEmployerId).sort((a, b) => (S.siteById.get(a)?.agreementRank ?? 3) - (S.siteById.get(b)?.agreementRank ?? 3) || S.loadOf(a, shift.date, shift.block) - S.loadOf(b, shift.date, shift.block) || a.localeCompare(b));
          for (const employerId of [...homeFirst, ...others]) {
            const assetId = S.take(employerId, setting, shift.date, shift.block);
            if (!assetId) continue;
            const areaCode = c.area?.code ?? areaOf(setting);
            add(st.id, areaCode, shift.hours);
            current.set(st.id, areaCode);
            placements.push({ studentId: st.id, sessionId: shift.sessionId, date: shift.date, block: shift.block, hours: shift.hours, areaCode, settingCode: setting, employerId, assetId, away: employerId !== st.homeEmployerId, pinned: !!pin, reason: c.why + (employerId !== st.homeEmployerId ? ` · away at ${S.siteById.get(employerId)?.name ?? "another site"}` : "") });
            done = true; break;
          }
          if (done) break;
        }
        if (done) break;
        // This area had to wait today: note the pressure for the bottleneck report.
        if (c.area && !c.area.settingCodes.includes(primary ?? "")) { const k = key(shift.weekMonday, c.area.code); const d = deferred.get(k) ?? { deferred: 0, capacity: c.settings.reduce((n, s) => n + S.capacityOf(s, shift.date, shift.block), 0) }; d.deferred++; deferred.set(k, d); }
      }
      if (!done) { current.set(st.id, null); unplaced.push({ studentId: st.id, sessionId: shift.sessionId, date: shift.date, reason: pin ? `pinned ${pin} but no seat that day` : "every allowed seat of every setting is full that shift" }); }
    }
  });

  return finish(input, placements, unplaced, primary, deferred, totalHours, requiredHours, S);
}

/** Score a given set of placements (the saved plan, or after a hand edit) the same way buildRotationPlan does. */
export function evaluatePlan(input: RotationInput, placements: Placement[]): RotationPlan {
  const S = supply(input);
  const primary = primarySettingOf(input);
  // Replay the placements through the seat bookkeeping so loads and overbooking show.
  for (const p of placements) { S.used.set(key(p.assetId, p.date, p.block), (S.used.get(key(p.assetId, p.date, p.block)) ?? 0) + 1); S.siteUsed.set(key(p.employerId, p.date, p.block), (S.siteUsed.get(key(p.employerId, p.date, p.block)) ?? 0) + 1); S.siteSettingUsed.set(key(p.employerId, p.date, p.block, p.settingCode), (S.siteSettingUsed.get(key(p.employerId, p.date, p.block, p.settingCode)) ?? 0) + 1); }
  const have = new Set(placements.map((p) => key(p.studentId, p.sessionId)));
  const unplaced: Unplaced[] = [];
  for (const sh of input.shifts) for (const st of input.students) if (!have.has(key(st.id, sh.sessionId))) unplaced.push({ studentId: st.id, sessionId: sh.sessionId, date: sh.date, reason: sh.holiday && input.options.skipHolidays ? `holiday — ${sh.holiday}` : "no placement" });
  const totalHours = input.shifts.reduce((n, s) => n + s.hours, 0);
  const requiredHours = input.areas.filter((a) => a.hours > 0).reduce((n, a) => n + a.hours, 0);
  return finish(input, placements, unplaced, primary, new Map(), totalHours, requiredHours, S);
}

function finish(input: RotationInput, placements: Placement[], unplaced: Unplaced[], primary: string | null, deferred: Map<string, { deferred: number; capacity: number }>, totalHours: number, requiredHours: number, S: ReturnType<typeof supply>): RotationPlan {
  const areas = input.areas.filter((a) => a.hours > 0);
  const siteName = (id: string) => S.siteById.get(id)?.name ?? id;
  const students: StudentTally[] = input.students.map((st) => {
    const mine = placements.filter((p) => p.studentId === st.id);
    const byArea: StudentTally["byArea"] = {};
    const tol = (input.shifts[0]?.hours ?? 0) / 2;
    for (const a of areas) { const plannedH = mine.filter((p) => p.areaCode === a.code).reduce((n, p) => n + p.hours, 0); const gap = Math.max(0, a.hours - plannedH); byArea[a.code] = { required: a.hours, planned: plannedH, short: gap > tol ? gap : 0 }; }
    for (const p of mine) if (!byArea[p.areaCode]) byArea[p.areaCode] = { required: 0, planned: 0, short: 0 }, byArea[p.areaCode].planned += p.hours;
    const plannedHours = mine.reduce((n, p) => n + p.hours, 0);
    const shortHours = Object.values(byArea).reduce((n, v) => n + v.short, 0);
    return { studentId: st.id, name: st.name, seat: st.seat, homeEmployerId: st.homeEmployerId, byArea, plannedHours, requiredHours, shortHours, awayShifts: mine.filter((p) => p.away).length, unplaced: unplaced.filter((u) => u.studentId === st.id).length, sites: [...new Set(mine.map((p) => siteName(p.employerId)))] };
  });
  // Loads: every site × setting × date × block touched by the plan, used vs. what it could hold.
  const loadKeys = new Map<string, LoadCell>();
  for (const p of placements) {
    const k = key(p.employerId, p.settingCode, p.date, p.block);
    let cell = loadKeys.get(k);
    if (!cell) {
      const assets = S.allowed.filter((a) => a.employerId === p.employerId && a.settingCode === p.settingCode && S.opens(a, p.date, p.block));
      const seats = assets.reduce((n, a) => n + a.learnersPerShift, 0);
      const cap = S.siteById.get(p.employerId)?.approvedCapacity;
      cell = { date: p.date, block: p.block, employerId: p.employerId, siteName: siteName(p.employerId), settingCode: p.settingCode, used: 0, capacity: cap == null ? seats : Math.min(seats, cap) };
      loadKeys.set(k, cell);
    }
    cell.used++;
  }
  const loads = [...loadKeys.values()].sort((a, b) => a.date.localeCompare(b.date) || a.siteName.localeCompare(b.siteName) || a.settingCode.localeCompare(b.settingCode));
  const bottlenecks: RotationBottleneck[] = [...deferred.entries()].map(([k, v]) => { const [weekMonday, areaCode] = k.split("|"); return { weekMonday, areaCode, deferred: v.deferred, capacity: v.capacity, note: v.capacity === 0 ? "no allowed site has this setting open that week" : `${v.deferred} student-shift${v.deferred === 1 ? "" : "s"} waited for a seat (${v.capacity} seat${v.capacity === 1 ? "" : "s"} a day)` }; }).sort((a, b) => a.weekMonday.localeCompare(b.weekMonday) || b.deferred - a.deferred);
  const weeks = [...new Set(input.shifts.map((s) => s.weekMonday))].sort();
  const studentsShort = students.filter((s) => s.shortHours > 1e-9).length;
  return {
    placements, unplaced, students, loads, bottlenecks, weeks, primarySetting: primary,
    summary: { shifts: input.shifts.length * input.students.length, placed: placements.length, unplaced: unplaced.length, away: placements.filter((p) => p.away).length, studentsShort, shortHours: students.reduce((n, s) => n + s.shortHours, 0), requiredHours: requiredHours * input.students.length, plannedHours: placements.reduce((n, p) => n + p.hours, 0) },
  };
  void totalHours;
}
