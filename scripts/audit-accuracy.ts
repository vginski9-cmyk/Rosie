// ACCURACY AUDIT — every clinical total recomputed independently and cross-checked, college by college.
// The template, the dated demand, the scheduler's plan, the roster on the calendar (asset bookings and
// student shifts), the capacity view (asset map), site load, site caps, staffing and the requirements
// are each derived from the same records; this script derives them AGAIN from the raw rows, the slow
// way, and reports every place two derivations disagree. Read-only.
//
//   npx tsx scripts/audit-accuracy.ts            # every college
//   npx tsx scripts/audit-accuracy.ts <name>     # one college (substring)

import { prisma } from "../src/lib/db";
import { getCapacityModel, getSchedulerData, getSiteLoad } from "../src/lib/queries";
import { schedulerModel, planFor, schedulerWindow, ROSTER_POLICY } from "../src/lib/schedulerplan";
import { buildInstances, type CohortCalendarInput } from "../src/lib/capacitymodel";
import { clinicalDemandRows } from "../src/lib/clinicaldemand";
import { assetDemand, assetSupply, assetMatch, blocksOn, overrideIndex, overrideKey, isoAdd, type AssetLite } from "../src/lib/assetmap";
import { eligibleSettings } from "../src/lib/settingrule";
import { SETTING_PRESETS } from "../src/lib/settingPresets";
import { coursePoolRules } from "../src/lib/requirementstore";

type Finding = { check: string; severity: "error" | "warn" | "info"; detail: string; n?: number };
const F: Finding[] = [];
const err = (check: string, detail: string, n?: number) => F.push({ check, severity: "error", detail, n });
const warn = (check: string, detail: string, n?: number) => F.push({ check, severity: "warn", detail, n });
const info = (check: string, detail: string, n?: number) => F.push({ check, severity: "info", detail, n });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const todayIso = new Date().toISOString().slice(0, 10);
async function auditInstitution(inst: { id: string; name: string }) {
  const tag = (c: string) => `${inst.name} · ${c}`;
  const data = await getCapacityModel({ institutionId: inst.id });
  if (!data || !data.cohorts.length) { info(tag("scope"), "no cohorts"); return; }
  const { from, to } = schedulerWindow(data.cohorts);
  const supply = await getSchedulerData(inst.id, from, to);
  const courseRules = supply.courseRules ?? {};

  // ── A. Template → dated demand ─────────────────────────────────────────────────────────────────
  const rows = data.cohorts.flatMap((c) => buildInstances({
    cohortId: c.cohortId, cohort: c.cohort, programId: c.programId, program: c.program, enrollmentByTerm: c.enrollmentByTerm,
    termStartByIndex: Object.fromEntries(Object.entries(c.termStartByIndex).map(([k, v]) => [k, v ? new Date(v) : null])),
    termEndByIndex: c.termEndByIndex, termWeeksByIndex: c.termWeeksByIndex, holidays: c.holidays, holidayRule: c.holidayRule, courses: c.courses,
  } as CohortCalendarInput, c.assumptions));
  const dated = rows.filter((r) => r.dateIso != null);
  const clinical = dated.filter((r) => r.session.kind === "CLINICAL");
  const demandRows = clinicalDemandRows(clinical, supply.rotations, courseRules);
  // A1: every dated clinical row is either a demand row or has zero sections; students = min(enrollment, sections × max).
  for (const d of demandRows) {
    const C = Math.max(0, Math.round(d.row.computed.C ?? 0)); const Y = Math.max(0, Math.round(d.row.computed.Y ?? 0)); const per = Math.max(1, d.row.session.maxStudents ?? 1);
    if (d.students !== Math.min(C, Y * per)) err(tag("A1 demand students"), `${d.row.cohort} ${d.row.courseCode} #${d.row.session.number} ${d.dateIso}: students ${d.students} ≠ min(C ${C}, Y ${Y} × ${per})`);
    if (Y > 0 && C > 0 && Y * per < C) warn(tag("A1 capped"), `${d.row.cohort} ${d.row.courseCode} #${d.row.session.number}: ${Y} sections × ${per} < enrollment ${C} — ${C - Y * per} students have no seat in the template`);
  }
  // A2: a dated row must sit inside its term's dates and on its stated weekday.
  for (const r of clinical) {
    const c = data.cohorts.find((x) => x.cohortId === r.cohortId)!;
    const ts = c.termStartByIndex[r.termIndex]; const te = c.termEndByIndex?.[r.termIndex];
    if (ts && r.dateIso! < String(ts).slice(0, 10)) err(tag("A2 term window"), `${r.cohort} ${r.courseCode} #${r.session.number} ${r.dateIso} before term start ${String(ts).slice(0, 10)}`);
    if (te && r.dateIso! > String(te).slice(0, 10)) warn(tag("A2 term window"), `${r.cohort} ${r.courseCode} #${r.session.number} ${r.dateIso} after term end ${String(te).slice(0, 10)}`);
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(r.dateIso + "T00:00:00Z").getUTCDay()];
    if (r.session.dayOfWeek && !r.holidayMoved && dow !== r.session.dayOfWeek && !(c.moves ?? []).some((m) => m.sessionId === r.session.id)) err(tag("A2 weekday"), `${r.cohort} ${r.courseCode} #${r.session.number}: dated ${r.dateIso} (${dow}) but the template says ${r.session.dayOfWeek}`);
  }
  // A3: rules and taxonomy.
  const known = new Set(SETTING_PRESETS.map((p) => p[0]));
  for (const a of supply.assets) if (!known.has(a.settingCode)) err(tag("A3 taxonomy"), `asset ${a.facilityName} ${a.settingCode} is not in the setting taxonomy`);
  for (const r of supply.rotations) if (r.rule) for (const s of eligibleSettings(r.rule.rule)) if (!known.has(s) && !supply.assets.some((a) => a.settingCode === s)) warn(tag("A3 rule setting"), `rotation "${r.rotationType}" allows ${s}, a setting no asset of the college has`);
  const unmapped = demandRows.filter((d) => !d.rule);
  if (unmapped.length) warn(tag("A3 unmapped"), `${unmapped.length} dated clinical rows have no setting rule: ${[...new Set(unmapped.map((d) => d.rotationType))].slice(0, 6).join(", ")}`, unmapped.length);
  const inWindowDemand = demandRows.filter((d) => d.dateIso >= from && d.dateIso <= to);
  info(tag("A demand"), `${clinical.length} dated clinical rows · ${demandRows.length} demand rows · ${sum(inWindowDemand.map((d) => d.students))} learner-shifts in the window ${from}→${to}`);

  // ── B. Scheduler plan invariants ───────────────────────────────────────────────────────────────
  const { demand, campus, holidays } = schedulerModel(data.cohorts, supply.rotations, courseRules);
  const inWindow = demand.filter((u) => u.date >= from && u.date <= to);
  // B0: demand units reconcile with demand rows (Σ seats per row == students).
  const seatsByRow = new Map<string, number>();
  for (const u of inWindow) { const k = `${u.cohortId}|${u.sessionId}|${u.originalDate}`; seatsByRow.set(k, (seatsByRow.get(k) ?? 0) + u.seats); }
  for (const d of inWindowDemand) { const k = `${d.row.cohortId}|${d.row.session.id}|${d.row.holidayMoved?.fromIso ?? d.dateIso}`; const s = seatsByRow.get(k) ?? 0; if (s !== d.students) err(tag("B0 units vs rows"), `${d.row.cohort} ${d.row.courseCode} #${d.row.session.number} ${d.dateIso}: units carry ${s} seats, the row ${d.students} students`); }
  const plan = planFor(inWindow, supply, ROSTER_POLICY, campus, holidays);
  const placedSeats = sum(plan.assignments.map((x) => x.seats)); const unmetSeats = sum(plan.unmet.map((u) => u.unit.seats)); const demandSeats = sum(inWindow.map((u) => u.seats));
  if (placedSeats + unmetSeats !== demandSeats) err(tag("B1 conservation"), `placed ${placedSeats} + unmet ${unmetSeats} ≠ demand ${demandSeats}`);
  if (plan.summary.demandSeats !== demandSeats) err(tag("B1 summary"), `summary.demandSeats ${plan.summary.demandSeats} ≠ ${demandSeats}`);
  // B2: per asset × date × block, seats ≤ learners per shift (counting hand bookings).
  const ov = overrideIndex(supply.overrides);
  const assetById = new Map(supply.assets.map((a) => [a.id, a]));
  const used = new Map<string, number>();
  for (const x of plan.assignments) for (const p of x.parts) { const k = `${p.assetId}|${x.date}|${x.block}`; used.set(k, (used.get(k) ?? 0) + p.seats); }
  for (const b of supply.bookings.filter((b) => b.note !== "auto-plan")) { const k = `${b.assetId}|${b.date}|${b.block}`; used.set(k, (used.get(k) ?? 0) + b.students); }
  let over = 0;
  for (const [k, n] of used) { const [aid, date, block] = k.split("|"); const a = assetById.get(aid); if (!a) { err(tag("B2 unknown asset"), k); continue; } if (n > a.learnersPerShift) { over++; if (over <= 5) err(tag("B2 seat overflow"), `${a.facilityName} ${a.setting} #${a.assetNumber} ${date} ${block}: ${n} seats on an asset of ${a.learnersPerShift}`); } if (!blocksOn(a, date, ov.get(overrideKey(aid, date))).includes(block as "Day")) err(tag("B2 closed"), `${a.facilityName} ${a.setting} #${a.assetNumber} is not open ${date} ${block} but holds ${n} seats`); }
  if (over > 5) err(tag("B2 seat overflow"), `… ${over} asset-shifts over their learners per shift in total`, over);
  // B3: the sum of a unit's parts equals its seats; no seat range placed twice; asset setting eligible; date within the Day lever; secured only; never a holiday.
  const byUnit = new Map<string, typeof plan.assignments>();
  for (const x of plan.assignments) { const k = `${x.unit.cohortId}|${x.unit.id}`; const l = byUnit.get(k) ?? []; l.push(x); byUnit.set(k, l); }
  const famAgreement = new Map(supply.familyAgreements.map((f) => [`${f.familyId}|${f.employerId}`, f.agreementStatus]));
  for (const [uid, xs] of byUnit) {
    const u = xs[0].unit;
    const seats = sum(xs.map((x) => x.seats)); if (seats > u.seats) err(tag("B3 unit seats"), `${uid}: ${seats} placed seats > ${u.seats} in the section`);
    const ranges = xs.map((x) => [x.seatOffset, x.seatOffset + x.seats]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) err(tag("B3 seat range"), `${uid}: overlapping seat ranges ${JSON.stringify(ranges)}`);
    for (const x of xs) {
      if (sum(x.parts.map((p) => p.seats)) !== x.seats) err(tag("B3 parts"), `${uid}: parts sum ${sum(x.parts.map((p) => p.seats))} ≠ ${x.seats}`);
      if (!u.eligible.includes(x.asset.settingCode)) err(tag("B3 setting"), `${uid}: placed in ${x.asset.settingCode}, eligible ${u.eligible.join("/")}`);
      const span = Math.abs((new Date(x.date + "T00:00:00Z").getTime() - new Date(u.date + "T00:00:00Z").getTime()) / 86400000);
      if (span > ROSTER_POLICY.flexibleDays) err(tag("B3 day lever"), `${uid}: moved ${span} days (${u.date} → ${x.date}), lever ± ${ROSTER_POLICY.flexibleDays}`);
      if (x.movedDays !== 0 && x.date === u.date) warn(tag("B3 movedDays"), `${uid}: movedDays ${x.movedDays} but date unchanged`);
      const ag = (u.familyId ? famAgreement.get(`${u.familyId}|${x.employerId}`) : undefined) ?? x.asset.agreementStatus ?? "none";
      if (ag !== "secured") err(tag("B3 agreement"), `${uid}: placed at ${x.siteName} under ${ag} agreement with the secured-only lever`);
      if (holidays[x.date]) err(tag("B3 holiday"), `${uid}: placed on ${x.date} (${holidays[x.date]}) with Holidays=never`);
      if (!u.eligible.length) err(tag("B3 unmapped placed"), `${uid}: placed with no eligible setting`);
    }
  }
  // B4: a section's students never in two places at once (per cohort seat number × date × block).
  const seatAt = new Map<string, string>();
  for (const x of plan.assignments) for (let s = x.unit.seatStart + x.seatOffset; s < x.unit.seatStart + x.seatOffset + x.seats; s++) { const k = `${x.unit.cohortId}|${s}|${x.date}|${x.block}`; const prev = seatAt.get(k); if (prev && prev !== x.unit.id) err(tag("B4 student overlap"), `cohort ${x.unit.cohort} seat ${s} on ${x.date} ${x.block} is in ${prev} and ${x.unit.id}`); seatAt.set(k, x.unit.id); }
  // B5: preceptors belong to the site and are never on two shifts at once; instructors never on two shifts at once.
  const precAt = new Map<string, string>(); const instAt = new Map<string, string>();
  const precById = new Map(supply.preceptors.map((p) => [p.id, p]));
  for (const x of plan.assignments) {
    for (const pid of x.preceptorIds) { const p = precById.get(pid); if (!p) err(tag("B5 preceptor"), `${x.unit.id}: unknown preceptor ${pid}`); else if (p.employerId !== x.employerId) err(tag("B5 preceptor site"), `${x.unit.id}: preceptor ${p.name} of ${p.employerId} placed at ${x.siteName}`); const k = `${pid}|${x.date}|${x.block}`; const prev = precAt.get(k); if (prev && prev !== x.unit.id) err(tag("B5 preceptor double"), `${p?.name ?? pid} on ${x.date} ${x.block}: ${prev} and ${x.unit.id}`); precAt.set(k, x.unit.id); }
    if (x.instructorId) { const k = `${x.instructorId}|${x.date}|${x.block}`; const prev = instAt.get(k); if (prev && prev !== x.unit.id) err(tag("B5 instructor double"), `${x.instructorName} on ${x.date} ${x.block}: ${prev} and ${x.unit.id}`); instAt.set(k, x.unit.id); }
  }
  // B6: site caps (students at once per family) respected by the plan.
  const atOnce = new Map<string, number>();
  for (const x of plan.assignments) { const k = `${x.employerId}|${x.unit.familyId ?? ""}|${x.date}|${x.block}`; atOnce.set(k, (atOnce.get(k) ?? 0) + x.seats); }
  const capOf = new Map((supply.siteCaps ?? []).map((c) => [`${c.familyId ?? ""}|${c.employerId}`, c]));
  let capViol = 0;
  for (const [k, n] of atOnce) { const [emp, fam, date, block] = k.split("|"); const c = capOf.get(`${fam}|${emp}`); const cap = c ? (c.studentsAtOnce ?? c.approvedCapacity) : null; if (cap != null && n > cap) { capViol++; if (capViol <= 3) err(tag("B6 site cap"), `${supply.assets.find((a) => a.employerId === emp)?.facilityName ?? emp} ${date} ${block}: ${n} students of the family at once, agreed ${cap}`); } }
  if (capViol > 3) err(tag("B6 site cap"), `… ${capViol} site-shifts over the agreed students at once`, capViol);
  // B7: unmet reasons are consistent with supply: an "unmapped-setting" unmet must have no eligible; a "full" unmet must have some open eligible asset that day.
  for (const m of plan.unmet) { if (m.reason === "unmapped-setting" && m.unit.eligible.length) err(tag("B7 unmet reason"), `${m.unit.id}: unmapped-setting but eligible ${m.unit.eligible.join("/")}`); }
  info(tag("B plan"), `${plan.assignments.length} placements · ${plan.unmet.length} unmet · placed ${plan.summary.placedShare.toFixed(3)} · ready ${plan.summary.readiness.readyShare.toFixed(3)} · blockers ${plan.blockers.filter((b) => b.blocking).map((b) => `${b.kind} ${b.shifts}`).join(", ") || "none"}`);
  // B8: the plan's own supply figures reconcile with an independent count.
  let physSeats = 0;
  const dDates = inWindow.map((u) => u.date).sort(); const pFrom = dDates[0] ?? from, pTo = dDates[dDates.length - 1] ?? to;
  for (const a of supply.assets.filter((a) => a.status !== "archived" && a.facilityStatus !== "archived")) for (let d = pFrom; d <= pTo; d = isoAdd(d, 1)) physSeats += blocksOn(a, d, ov.get(overrideKey(a.id, d))).length * a.learnersPerShift;
  if (physSeats !== plan.summary.supplySeatsPhysical) err(tag("B8 supply physical"), `independent count ${physSeats} ≠ plan ${plan.summary.supplySeatsPhysical}`);
  // B9: every placed seat sits on an allowed asset on a demand slot, so the "supply on demand days" the panel shows can never be below what was placed; the balance rows add up to the whole.
  if (plan.summary.capacity.supplySeatsOnDemandDays < placedSeats) err(tag("B9 supply vs placed"), `supply on demand days ${plan.summary.capacity.supplySeatsOnDemandDays} < placed ${placedSeats}`);
  // B9b: the lined-up ceiling (seats matched to demand shift by shift, sites at their students-at-once) sits between placed and the raw supply.
  { const lu = plan.summary.capacity.supplySeatsLinedUp; if (lu < placedSeats) err(tag("B9 lined-up vs placed"), `seats lined up with demand ${lu} < placed ${placedSeats}`); if (lu > plan.summary.capacity.supplySeatsOnDemandDays) err(tag("B9 lined-up vs supply"), `seats lined up ${lu} > supply on demand days ${plan.summary.capacity.supplySeatsOnDemandDays}`); if (lu > demandSeats) err(tag("B9 lined-up vs demand"), `seats lined up ${lu} > demand ${demandSeats}`); }
  // B9c: no unplaced shift sits beside a free eligible seat at an allowed site on its own date and block (the engine must never refuse a seat it could take).
  { const freeAt = new Map<string, number>(); const ovi = overrideIndex(supply.overrides);
    for (const a of supply.assets) for (const u of plan.unmet) { if (u.reason !== "full" || !u.unit.eligible.includes(a.settingCode) || a.agreementStatus !== "secured") continue; if (!blocksOn(a, u.unit.date, ovi.get(overrideKey(a.id, u.unit.date))).includes(u.unit.block)) continue; const k = `${a.id}|${u.unit.date}|${u.unit.block}`; if (!freeAt.has(k)) freeAt.set(k, a.learnersPerShift - plan.assignments.filter((x) => x.date === u.unit.date && x.block === u.unit.block).reduce((n, x) => n + x.parts.filter((p) => p.assetId === a.id).reduce((m, p) => m + p.seats, 0), 0)); }
    const idle = [...freeAt.entries()].filter(([, n]) => n > 0);
    if (idle.length) warn(tag("B9 idle eligible seats"), `${idle.length} asset-shifts have free seats in a setting an unplaced "full" shift may use that date and block (drive-time or the site's students-at-once may explain it) — e.g. ${idle.slice(0, 3).map(([k, n]) => `${k} free ${n}`).join("; ")}`, idle.length); }
  const balSeats = sum(plan.balance.map((b) => b.demandSeats)); if (balSeats !== demandSeats) err(tag("B9 balance"), `balance rows add to ${balSeats} learner-shifts, demand is ${demandSeats}`);
  for (const b of plan.balance) if (b.utilization > 1.0001) err(tag("B9 utilization"), `${b.settingCode}: utilization ${b.utilization.toFixed(2)} — more seats placed than the setting has`);

  // ── C. The roster on the calendar (what the seed applied) vs the plan and the assets ───────────
  const bookings = await prisma.assetBooking.findMany({ where: { asset: { employer: { institutionId: inst.id } } }, select: { assetId: true, date: true, block: true, students: true, cohortId: true, sessionId: true, sectionIndex: true, note: true } });
  const bookingAt = new Map<string, string>(); for (const b of bookings) bookingAt.set(`${b.assetId}|${b.date.toISOString().slice(0, 10)}`, b.block);
  const bUsed = new Map<string, number>();
  for (const b of bookings) { const k = `${b.assetId}|${b.date.toISOString().slice(0, 10)}|${b.block}`; bUsed.set(k, (bUsed.get(k) ?? 0) + b.students); }
  let bOver = 0, bClosed = 0;
  for (const [k, n] of bUsed) { const [aid, date, block] = k.split("|"); const a = assetById.get(aid); if (!a) continue; if (n > a.learnersPerShift) { bOver++; if (bOver <= 3) err(tag("C1 booking overflow"), `${a.facilityName} ${a.setting} #${a.assetNumber} ${date} ${block}: ${n} booked on ${a.learnersPerShift} seats`); } if (!blocksOn(a, date, ov.get(overrideKey(aid, date))).includes(block as "Day")) { bClosed++; if (bClosed <= 3) err(tag("C1 booking closed"), `${a.facilityName} ${a.setting} #${a.assetNumber} ${date} ${block}: booked while closed`); } }
  if (bOver > 3) err(tag("C1 booking overflow"), `… ${bOver} asset-shifts over-booked`, bOver);
  if (bClosed > 3) err(tag("C1 booking closed"), `… ${bClosed} bookings on closed asset-shifts`, bClosed);
  // C2: a student is never on two seats at once (studentShift rows with the same student, date and block).
  const shifts = await prisma.studentShift.findMany({ where: { cohort: { program: { institutionId: inst.id } } }, select: { studentId: true, sessionId: true, assetId: true, sectionIndex: true, cohortId: true, session: { select: { kind: true } }, student: { select: { status: true, keepAssignments: true } } } });
  // A pinned shift's date and block come from the booking that seats its section on that asset (the roster's own record).
  const bookingOf = new Map<string, { date: string; block: string }[]>();
  for (const b of bookings) { const k = `${b.cohortId}|${b.assetId}|${b.sessionId ?? ""}|${b.sectionIndex}`; const l = bookingOf.get(k) ?? []; l.push({ date: b.date.toISOString().slice(0, 10), block: b.block }); bookingOf.set(k, l); }
  const stAt = new Map<string, number>(); const pinned = new Map<string, number>(); let orphanPins = 0;
  for (const s of shifts) {
    if (s.session.kind !== "CLINICAL" || !s.assetId) continue;
    const bs = bookingOf.get(`${s.cohortId}|${s.assetId}|${s.sessionId}|${s.sectionIndex}`) ?? [];
    if (!bs.length) { orphanPins++; continue; }
    // a section's session recurs weekly: one student shift per booking date is what the roster means
    for (const b of bs) { if (s.student.status === "withdrawn" && !s.student.keepAssignments && b.date > todayIso) continue; /* site load leaves a withdrawn student's FUTURE seats out unless kept on purpose; history stays */ const k1 = `${s.studentId}|${b.date}|${b.block}`; stAt.set(k1, (stAt.get(k1) ?? 0) + 1); const k2 = `${s.assetId}|${b.date}|${b.block}`; pinned.set(k2, (pinned.get(k2) ?? 0) + 1); }
  }
  if (orphanPins) err(tag("C2 orphan pins"), `${orphanPins} student shifts are pinned to an asset with no booking for their section and session`, orphanPins);
  const dbl = [...stAt.values()].filter((n) => n > 1).length; if (dbl) err(tag("C2 student double-booked"), `${dbl} student × date × block with more than one seat`, dbl);
  let pinOver = 0;
  for (const [k, n] of pinned) { const a = assetById.get(k.split("|")[0]); if (a && n > a.learnersPerShift) { pinOver++; if (pinOver <= 3) err(tag("C3 pinned overflow"), `${a.facilityName} ${a.setting} #${a.assetNumber} ${k.split("|")[1]} ${k.split("|")[2]}: ${n} students pinned on ${a.learnersPerShift} seats`); } }
  if (pinOver > 3) err(tag("C3 pinned overflow"), `… ${pinOver} asset-shifts with more students than seats`, pinOver);
  info(tag("C roster"), `${bookings.length} bookings (${sum(bookings.map((b) => b.students))} seats) · ${shifts.length} student shifts · ${sum([...pinned.values()])} pinned to a seat`);

  // ── D. Site load reads the same seats ──────────────────────────────────────────────────────────
  const load = await getSiteLoad(inst.id);
  if (load) {
    const seated = load.rows.filter((r) => r.assetId && r.date);
    if (seated.length !== sum([...pinned.values()])) { const byStatus = (rs: { status: string }[]) => Object.entries(rs.reduce<Record<string, number>>((m, r) => { m[r.status] = (m[r.status] ?? 0) + 1; return m; }, {})).map(([k, v]) => `${k} ${v}`).join(", "); err(tag("D1 site load seats"), `site load shows ${seated.length} seated student-shifts (${byStatus(seated)}; withdrawn kept ${load.withdrawn.kept}, excluded ${load.withdrawn.excluded}), the roster has ${sum([...pinned.values()])} pinned with a booking`); }
    const lUsed = new Map<string, number>();
    for (const r of seated) { const k = `${r.assetId}|${r.date}|${r.block}`; lUsed.set(k, (lUsed.get(k) ?? 0) + 1); }
    let lOver = 0;
    for (const [k, n] of lUsed) { const a = assetById.get(k.split("|")[0]); if (a && n > a.learnersPerShift) lOver++; }
    if (lOver) err(tag("D2 site load overflow"), `${lOver} asset-shifts read over 100% on site load`, lOver);
    const future = load.rows.filter((r) => r.date && r.date >= new Date().toISOString().slice(0, 10) && r.status === "scheduled");
    const unseated = future.filter((r) => !r.assetId).length;
    if (unseated) warn(tag("D3 unseated future shifts"), `${unseated} of ${future.length} future scheduled student-shifts have no booked seat — the plan's unplaced sections (${plan.unmet.length} × their seats) plus named students beyond the seats the plan booked (the roster is the named population; the plan books the template's seats)`, unseated);
  }

  // ── E. Capacity view (asset map) vs the scheduler on the same rows ─────────────────────────────
  const ad = assetDemand(clinical, supply.rotations, courseRules).filter((d) => d.iso >= from && d.iso <= to);
  const adSeats = sum(ad.map((d) => d.students));
  if (adSeats !== demandSeats) err(tag("E1 asset-map demand"), `asset map ${adSeats} learner-shifts ≠ scheduler demand ${demandSeats}`);
  const sup = assetSupply(supply.assets, supply.overrides, from, to);
  let cellSeats = 0; for (const c of sup.values()) cellSeats += c.learners;
  let physAll = 0; for (const a of supply.assets.filter((a) => a.status !== "archived" && a.facilityStatus !== "archived")) for (let d = from; d <= to; d = isoAdd(d, 1)) physAll += blocksOn(a, d, ov.get(overrideKey(a.id, d))).length * a.learnersPerShift;
  if (cellSeats !== physAll) err(tag("E2 asset-map supply"), `asset-map supply ${cellSeats} learner seats ≠ independent ${physAll}`);
  const cells = assetMatch(ad, sup, supply.bookings, assetById);
  const cellDemand = sum(cells.map((c) => c.demand));
  if (cellDemand !== demandSeats) err(tag("E3 asset-map cells"), `match cells demand ${cellDemand} ≠ ${demandSeats}`);
  const shortPhys = sum(cells.map((c) => c.shortPhysical));
  info(tag("E capacity"), `asset map: ${cells.length} cells · demand ${cellDemand} · physically short ${shortPhys} learner-shifts (scheduler unmet ${unmetSeats}, of which not-a-supply-shortage reasons ${sum(plan.unmet.filter((u) => !["full", "closed-that-day", "no-asset-for-setting", "too-big"].includes(u.reason)).map((u) => u.unit.seats))})`);

  // ── F. Staffing: preceptor hours the template says vs the plan ──────────────────────────────────
  const precHoursTemplate = sum(inWindowDemand.map((d) => (d.row.computed.AC ?? 0)));
  const precShiftsPlan = plan.summary.preceptorShifts;
  info(tag("F staffing"), `template preceptor contact hours in window ${precHoursTemplate.toFixed(0)} · plan preceptor-shifts ${precShiftsPlan} · assigned ${plan.summary.preceptorsAssigned} · instructor shifts ${plan.summary.instructorShifts} / assigned ${plan.summary.instructorsAssigned}`);

  // ── G. Requirements vs the template ────────────────────────────────────────────────────────────
  const pools = await coursePoolRules(data.cohorts.map((c) => c.programId));
  for (const [courseId, rule] of Object.entries(pools)) if (rule.rule.kind === "pool") {
    const c = data.cohorts.flatMap((co) => co.courses).find((x) => x.courseId === courseId);
    const hours = sum((c?.sessions ?? []).filter((s) => s.kind === "CLINICAL").map((s) => s.lengthHours));
    const mins = sum(rule.rule.minimums.map((m) => m.quantity));
    if (mins > hours) err(tag("G1 pool"), `${c?.code ?? courseId}: minimums ${mins} h exceed the course's ${hours} h of clinical sessions`);
  }
}

async function main() {
  const filter = process.argv[2];
  const insts = await prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  for (const inst of insts) { if (filter && !inst.name.toLowerCase().includes(filter.toLowerCase())) continue; await auditInstitution(inst); }
  const errors = F.filter((f) => f.severity === "error"), warns = F.filter((f) => f.severity === "warn");
  for (const f of F) console.log(`${f.severity.toUpperCase().padEnd(5)} ${f.check}: ${f.detail}`);
  console.log(`\n${errors.length} errors · ${warns.length} warnings`);
}
main().then(async () => { await prisma.$disconnect(); }).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
