import Link from "next/link";
import { buildClinicalRotations, pinStudentWeek } from "@/lib/actions";
import type { RotationBoardData } from "@/lib/queries";
import { dec } from "@/lib/format";

// The clinical rotation board for one course of one offering: who is in which
// service area at which site, week by week; every student's hours by area against
// the requirement grid; every site × setting's load against its capacity; and the
// weeks where an area's capacity made students wait. Build (or rebuild) the plan
// under a few levers, pin any student-week to an area, and the rest re-flows
// around the pin. Server component with forms.

const PALETTE = ["bg-emerald-100 text-emerald-800 ring-emerald-200", "bg-sky-100 text-sky-800 ring-sky-200", "bg-violet-100 text-violet-800 ring-violet-200", "bg-amber-100 text-amber-800 ring-amber-200", "bg-rose-100 text-rose-800 ring-rose-200", "bg-teal-100 text-teal-800 ring-teal-200", "bg-orange-100 text-orange-800 ring-orange-200", "bg-lime-100 text-lime-800 ring-lime-200"];
const short = (name: string) => name.replace(/ — .*$/, "").replace(/ (Hospital|Medical Center|Community College|Regional).*$/i, (m) => m.trim().split(" ").map((w) => w[0]).join("")).slice(0, 18);
const wk = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const inp = "rounded border border-slate-300 px-1.5 py-0.5 text-xs";

export function RotationBoard({ data, programId }: { data: RotationBoardData; programId: string }) {
  const { courses, course, input, plan } = data;
  const base = `/programs/${programId}/offerings/${data.cohort.id}`;
  if (!course) return <p className="text-xs text-slate-400">This program has no clinical sessions to rotate.</p>;
  const areas = input?.areas ?? [];
  const tone = new Map(areas.map((a, i) => [a.code, PALETTE[i % PALETTE.length]]));
  const toneOf = (code: string) => tone.get(code) ?? "bg-slate-100 text-slate-700 ring-slate-200";
  const weeks = plan?.weeks ?? [...new Set(input?.shifts.map((s) => s.weekMonday) ?? [])].sort();
  const shiftsByWeek = new Map<string, string[]>();
  for (const s of input?.shifts ?? []) { const l = shiftsByWeek.get(s.weekMonday) ?? []; l.push(s.sessionId); shiftsByWeek.set(s.weekMonday, l); }
  const byCell = new Map<string, NonNullable<typeof plan>["placements"]>();
  for (const p of plan?.placements ?? []) { const wm = input!.shifts.find((s) => s.sessionId === p.sessionId)?.weekMonday ?? ""; const k = `${p.studentId}|${wm}`; const l = byCell.get(k) ?? []; l.push(p); byCell.set(k, l); }
  const unplacedByCell = new Map<string, number>();
  for (const u of plan?.unplaced ?? []) { const wm = input!.shifts.find((s) => s.sessionId === u.sessionId)?.weekMonday ?? ""; const k = `${u.studentId}|${wm}`; unplacedByCell.set(k, (unplacedByCell.get(k) ?? 0) + 1); }
  const doneOf = (studentId: string, sessionId: string) => data.status[`${studentId}|${sessionId}`]?.status ?? "scheduled";
  const loadsByWeek = new Map<string, { site: string; setting: string; used: number; capacity: number; days: number }[]>();
  for (const l of plan?.loads ?? []) {
    const wm = input!.shifts.find((s) => s.date === l.date)?.weekMonday ?? l.date;
    const list = loadsByWeek.get(wm) ?? []; const k = list.find((x) => x.site === l.siteName && x.setting === l.settingCode);
    if (k) { k.used += l.used; k.capacity += l.capacity; k.days++; } else list.push({ site: l.siteName, setting: l.settingCode, used: l.used, capacity: l.capacity, days: 1 });
    loadsByWeek.set(wm, list);
  }
  const s = plan?.summary;
  const pinnedCount = Object.keys(input?.pins ?? {}).length;

  return (
    <div className="space-y-4">
      {/* Course tabs */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="ml-auto order-last flex gap-1.5">
          <a href={`/api/offerings/${data.cohort.id}/rotations?course=${course.id}`} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50" title="workbook: rotation log · week by week · site load">Export {course.code ?? course.name} ↓</a>
          <a href={`/api/offerings/${data.cohort.id}/rotations?course=${course.id}&format=csv`} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-600 hover:bg-slate-50" title="the rotation log as CSV">CSV</a>
          <a href={`/api/offerings/${data.cohort.id}/rotations`} className="rounded-lg bg-slate-800 px-2.5 py-1 font-medium text-white hover:bg-slate-700" title="every clinical course of this offering in one workbook">Export every course ↓</a>
        </span>
        {courses.map((c) => <Link key={c.id} href={`${base}?course=${c.id}#rotations`} className={`rounded-full px-2.5 py-1 font-medium ${c.id === course.id ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{c.code ?? c.name} <span className={c.id === course.id ? "text-rose-100" : "text-slate-400"}>· {c.term} · {c.shifts} shifts</span></Link>)}
      </div>

      {!input ? <p className="text-xs text-amber-700">This course&apos;s clinical sessions have no dates yet — set the offering&apos;s term dates first.</p> : (
        <>
          {/* What the course asks of every student */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">{input.shifts.length} shifts</span>
            <span>· {dec(input.shifts.reduce((n, x) => n + x.hours, 0))} h per student</span>
            <span>· requirement grid:</span>
            {areas.map((a) => <span key={a.code} className={`rounded px-1.5 py-0.5 ring-1 ${toneOf(a.code)}`} title={`${a.name} · settings ${a.settingCodes.join(", ")}`}>{a.code} {dec(a.hours)} h</span>)}
            {areas.length === 0 && <span className="text-amber-700">no hours coded for this course in the family&apos;s requirement grid — every shift goes to the course&apos;s own setting</span>}
            <span>· {input.students.length} students · {input.sites.filter((x) => x.agreementRank <= input.options.maxAgreementRank).length} allowed sites</span>
          </div>

          {/* Build — from the family's clinical set-up; nothing is configured here */}
          <form action={buildClinicalRotations.bind(null, data.cohort.id, course.id)} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs">
            <div className="min-w-0 flex-1 text-[11px] text-slate-600">
              <span className="font-semibold text-slate-800">Built from {data.family?.name ?? "the program family"}&apos;s clinical set-up:</span>{" "}
              availability counted by <span className="font-medium">{input.options.basis === "cases" ? `cases (${dec(input.options.casesPerStudentDay)} cases per student-day over ${input.options.caseDaysPerYear} case days a year)` : input.options.basis === "staff" ? `staff on shift (${dec(input.options.studentsPerStaff)} students per qualified staff member)` : "seats (learners per shift per room / unit)"}</span>
              {" "}· primary experience <span className="font-medium">{input.options.primarySetting ?? `${plan?.primarySetting ?? "auto"} (most-required area)`}</span>
              {" "}· sites: <span className="font-medium">{input.options.maxAgreementRank === 0 ? "secured agreements only" : input.options.maxAgreementRank === 1 ? "secured + asked" : "any site with the setting"}</span>
              {" "}· {input.options.keepHome ? "students stay at their home site when it has the setting" : "students go to the least-loaded allowed site"}
              {" "}· {input.options.skipHolidays ? "holidays left open" : "holidays scheduled"}
              {" "}· plus each site&apos;s agreed students-at-once, accreditor-approved capacity, daily cases, days and shift blocks.
              {data.family?.notes ? <span className="block text-slate-500">{data.family.notes}</span> : null}
              <Link href={`/programs/${programId}/clinical`} className="ml-1 text-rose-600 hover:underline">Change the rules or a site&apos;s availability →</Link>
            </div>
            <button className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700">{plan ? "Rebuild clinical schedule" : "Build clinical schedule"}</button>
            {pinnedCount > 0 && <span className="text-[11px] text-slate-500">{pinnedCount} pinned cell{pinnedCount === 1 ? "" : "s"} stay put.</span>}
          </form>

          {plan && s && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">{s.placed} of {s.shifts} student-shifts placed</span>
                {s.unplaced > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-700">⚠ {s.unplaced} unplaced</span>}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{s.away} shifts away from home</span>
                <span className={`rounded-full px-2 py-0.5 font-medium ${s.studentsShort > 0 ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{s.studentsShort > 0 ? `⚠ ${s.studentsShort} student${s.studentsShort === 1 ? "" : "s"} short ${dec(s.shortHours)} h in total` : "✓ every student reaches every area's hours"}</span>
                <span className="text-slate-500">{dec(s.plannedHours)} of {dec(s.requiredHours)} required h planned</span>
                {plan.bottlenecks.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">{plan.bottlenecks.length} capacity bottleneck{plan.bottlenecks.length === 1 ? "" : "s"}</span>}
              </div>
              {plan.bottlenecks.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2 text-[11px] text-amber-800">
                  <div className="font-semibold">Where capacity made students wait</div>
                  <ul className="mt-0.5 columns-2 gap-4">
                    {plan.bottlenecks.slice(0, 16).map((b) => <li key={`${b.weekMonday}|${b.areaCode}`}>week of {wk(b.weekMonday)} · <span className={`rounded px-1 ring-1 ${toneOf(b.areaCode)}`}>{b.areaCode}</span> — {b.note}</li>)}
                  </ul>
                  {plan.bottlenecks.length > 16 && <div className="text-amber-600">+{plan.bottlenecks.length - 16} more</div>}
                </div>
              )}

              {/* The grid */}
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full text-[11px]">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5 text-left">Student · home site</th>
                      {weeks.map((w) => <th key={w} className="px-1 py-1.5 text-center font-semibold" title={`week of ${w} · ${shiftsByWeek.get(w)?.length ?? 0} shift${(shiftsByWeek.get(w)?.length ?? 0) === 1 ? "" : "s"}`}>{wk(w)}</th>)}
                      <th className="min-w-[26rem] px-2 py-1.5 text-left">Hours by area (planned / required)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {plan.students.map((st) => (
                      <tr key={st.studentId} className={st.shortHours > 1e-9 ? "bg-rose-50/30" : ""}>
                        <td className="sticky left-0 z-10 bg-white px-2 py-0.5 align-top"><Link href={`/students/${st.studentId}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{st.name}</Link><span className="block text-[10px] text-slate-400">seat #{st.seat} · {st.homeEmployerId ? short(data.siteNames[st.homeEmployerId] ?? "") : "no home site"}</span></td>
                        {weeks.map((w) => {
                          const cell = byCell.get(`${st.studentId}|${w}`) ?? [];
                          const missing = unplacedByCell.get(`${st.studentId}|${w}`) ?? 0;
                          const pinned = cell.some((p) => p.pinned) || (shiftsByWeek.get(w) ?? []).some((sid) => input.pins[`${st.studentId}|${input.shifts.find((x) => x.sessionId === sid)?.date}`]);
                          const pinArea = pinned ? (cell.find((p) => p.pinned)?.areaCode ?? "") : "";
                          return (
                            <td key={w} className="px-0.5 py-0.5 align-top">
                              <div className="group flex items-center justify-center gap-0.5">
                                <div className="flex flex-wrap justify-center gap-0.5">
                                  {cell.sort((a, b) => a.date.localeCompare(b.date)).map((p) => <span key={p.sessionId} className={`rounded px-1 ring-1 ${toneOf(p.areaCode)} ${doneOf(st.studentId, p.sessionId) === "completed" ? "opacity-60" : ""}`} title={`${p.date} · ${p.settingCode} at ${data.siteNames[p.employerId] ?? p.employerId} · ${dec(p.hours)} h · ${p.reason}${doneOf(st.studentId, p.sessionId) !== "scheduled" ? ` · ${doneOf(st.studentId, p.sessionId)}` : ""}`}>{p.areaCode}{p.away ? "↗" : ""}{doneOf(st.studentId, p.sessionId) === "completed" ? "✓" : ""}</span>)}
                                  {missing > 0 && <span className="rounded bg-rose-100 px-1 text-rose-700 ring-1 ring-rose-200" title="no seat that day">✕{missing > 1 ? missing : ""}</span>}
                                </div>
                                <form action={pinStudentWeek.bind(null, data.cohort.id, course.id, st.studentId, w)} className={`flex items-center ${pinned ? "" : "opacity-30 group-hover:opacity-100"}`}>
                                  <select name="area" defaultValue={pinArea} className={`w-9 rounded border px-0 text-[9px] ${pinned ? "border-rose-400 bg-rose-50 text-rose-700" : "border-slate-200 text-slate-400"}`} title={pinned ? "pinned — choose 'auto' to release" : "pin this week to an area"}>
                                    <option value="">auto</option>
                                    {areas.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}
                                  </select>
                                  <button className="rounded px-0.5 text-[9px] text-slate-500 hover:bg-slate-200" title="pin and rebuild">📌</button>
                                </form>
                              </div>
                            </td>
                          );
                        })}
                        <td className="min-w-[26rem] px-2 py-0.5 align-top">
                          <div className="flex flex-wrap gap-1 whitespace-nowrap">
                            {Object.entries(st.byArea).map(([code, v]) => <span key={code} className={`rounded px-1 ring-1 ${toneOf(code)} ${v.short > 1e-9 ? "font-semibold" : ""}`} title={`${data.areaNames[code] ?? code}: ${dec(v.planned)} planned of ${dec(v.required)} required${v.short > 1e-9 ? ` — ${dec(v.short)} short` : v.planned < v.required ? ` — ${dec(v.required - v.planned)} h remainder, under half a shift` : ""}`}>{code} {dec(v.planned)}{v.required > 0 ? `/${dec(v.required)}` : ""}{v.short > 1e-9 ? " ⚠" : v.planned + 1e-9 < v.required ? " ≈" : ""}</span>)}
                          </div>
                          <div className="text-[10px] text-slate-400">{dec(st.plannedHours)} h planned{st.awayShifts > 0 ? ` · ${st.awayShifts} away` : ""}{st.unplaced > 0 ? ` · ${st.unplaced} unplaced` : ""}{st.sites.length > 1 ? ` · ${st.sites.map(short).join(", ")}` : ""}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-400">Each chip is one shift: the service area it counts toward (hover for the date, setting, site and why). ↗ = away from the home site · ✓ = already completed · ≈ = within half a shift of the requirement (a remainder too small to schedule as a whole shift). Pin a student-week to an area (hover a cell) and rebuild — everything else re-flows around the pins.</p>

              {/* Loads */}
              <details className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-slate-700">Site × setting loads by week — seats used of seats open ({plan.loads.length} site-setting-days)</summary>
                <div className="mt-2 grid gap-2 md:grid-cols-2 lg:grid-cols-4">
                  {weeks.map((w) => (
                    <div key={w} className="rounded border border-slate-100 p-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">week of {wk(w)}</div>
                      {(loadsByWeek.get(w) ?? []).sort((a, b) => b.used / Math.max(1, b.capacity) - a.used / Math.max(1, a.capacity)).map((l) => {
                        const ratio = l.capacity > 0 ? l.used / l.capacity : 1;
                        return <div key={`${l.site}|${l.setting}`} className="flex items-center justify-between gap-2 text-[11px]"><span className="truncate text-slate-600">{short(l.site)} · <span className={`rounded px-1 ring-1 ${toneOf(areas.find((a) => a.settingCodes.includes(l.setting))?.code ?? l.setting)}`}>{l.setting}</span></span><span className={`tabular-nums ${ratio >= 1 ? "font-semibold text-rose-600" : ratio >= 0.8 ? "text-amber-700" : "text-slate-500"}`}>{l.used}/{l.capacity}</span></div>;
                      })}
                      {(loadsByWeek.get(w) ?? []).length === 0 && <div className="text-[11px] text-slate-300">—</div>}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-slate-400">Seat-days: a site&apos;s learners per shift across that setting&apos;s open assets, capped by its accreditor-approved capacity; summed over the week&apos;s shift days.</p>
              </details>
            </>
          )}
          {!plan && <p className="text-xs text-slate-500">No clinical schedule yet for this course — build one above from the family&apos;s availability. Until then every student sits in the section&apos;s booked site for every shift.</p>}
        </>
      )}
    </div>
  );
}
