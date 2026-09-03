"use client";

// ONE job's clinical picture: how its clinicals are administered, its service
// areas and requirement grid (hours per student per course per area), the sites
// that serve it with a family-level agreement and the shifts each has allocated
// to this program, and hours supply vs demand week by week, by setting and by
// region. The asset-level, date-level board sits below it on the page.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { weeklyDemand, weeklySupply, matchWeekly, settingSummaries, regionRollup, requirementTotals, type CourseWindow, type ServiceAreaLite, type AllocationLite } from "@/lib/clinicalmodel";
import type { AssetLite, AssetDayOverride, AssetBookingLite } from "@/lib/assetmap";
import { updateFamilyClinicalModel, upsertServiceArea, deleteServiceArea, saveCourseRequirements, upsertFamilySite, removeFamilySite, saveSettingAllocation } from "@/lib/actions";

const n0 = (v: number) => Math.round(v).toLocaleString();
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
const pct = (v: number) => `${Math.round(v * 100)}%`;
const fmtW = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const AGREEMENT: Record<string, string> = { none: "bg-slate-100 text-slate-500", prospect: "bg-sky-100 text-sky-700", asked: "bg-amber-100 text-amber-700", secured: "bg-emerald-100 text-emerald-700", declined: "bg-rose-100 text-rose-700" };
const AGREEMENTS = ["none", "prospect", "asked", "secured", "declined"];
const MODEL: Record<string, string> = { hours: "Hours-based — set hours per student in set settings", competency: "Competency / case-based — cases and check-offs, hours follow", mixed: "Mixed — hours floors plus competencies" };

export interface FcFamily { id: string; name: string; institutionId: string; institution: string; occupation: string | null; soc: string | null; clinicalModel: string; clinicalNotes: string | null }
export interface FcArea extends ServiceAreaLite { unitCategories: string[]; notes: string | null }
export interface FcCourse { id: string; code: string | null; name: string; termIndex: number; termName: string; weeks: number; weeklyClinicalHours: number; requirements: { serviceAreaId: string; hoursPerStudent: number; casesPerStudent: number | null }[] }
export interface FcProgram { id: string; name: string; cohorts: number; courses: FcCourse[] }
export interface FcSite {
  id: string; name: string; externalId: string | null; county: string | null; ring: string | null; facilityType: string | null; city: string | null; status: string;
  globalAgreement: string; agreementStatus: string; contactName: string | null; contactEmail: string | null; notes: string | null;
  bySetting: Record<string, { assets: number; setting: string; weeklyShifts: number }>;
  units: { category: string; type: string; studentsPerShift: number; capacity: number | null; uom: string | null }[];
  allocations: { id: string; settingCode: string; block: string; shiftsPerWeek: number; hoursPerShift: number; learnersPerShift: number; from: string | null; to: string | null }[];
}

export function FamilyClinicalBoard({ family, areas, programs, sites, allocations, windows, assets, overrides, bookings, from, to }: {
  family: FcFamily; areas: FcArea[]; programs: FcProgram[]; sites: FcSite[]; allocations: AllocationLite[]; windows: CourseWindow[];
  assets: AssetLite[]; overrides: AssetDayOverride[]; bookings: AssetBookingLite[]; from: string; to: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"model" | "sites" | "weeks">("weeks");
  const reqs = useMemo(() => programs.flatMap((p) => p.courses.flatMap((c) => c.requirements.map((r) => ({ courseId: c.id, serviceAreaId: r.serviceAreaId, hoursPerStudent: r.hoursPerStudent, casesPerStudent: r.casesPerStudent })))), [programs]);
  const demand = useMemo(() => weeklyDemand(windows, reqs), [windows, reqs]);
  const supply = useMemo(() => weeklySupply(assets, overrides, allocations, bookings, from, to), [assets, overrides, allocations, bookings, from, to]);
  const rows = useMemo(() => matchWeekly(demand, areas, supply), [demand, areas, supply]);
  const summaries = useMemo(() => settingSummaries(rows), [rows]);
  const regions = useMemo(() => regionRollup(rows), [rows]);
  const settingName = (code: string) => assets.find((a) => a.settingCode === code)?.setting ?? areas.find((a) => a.settingCodes.includes(code))?.name ?? code;
  const refresh = () => router.refresh();
  const demandTotal = rows.reduce((n, r) => n + r.demandHours, 0);
  const offeredTotal = rows.reduce((n, r) => n + Math.min(r.demandHours, r.offeredHours), 0);
  const physicalTotal = rows.reduce((n, r) => n + Math.min(r.demandHours, r.physicalHours), 0);
  const bookedTotal = rows.reduce((n, r) => n + Math.min(r.demandHours, r.bookedHours), 0);
  const weeksWithDemand = new Set(rows.filter((r) => r.demandHours > 0).map((r) => r.weekIso)).size;
  const secured = sites.filter((s) => s.agreementStatus === "secured").length;

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{family.name} — clinical supply vs demand, this job&apos;s way</h2>
          <p className="text-sm text-slate-600"><span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">{MODEL[family.clinicalModel]?.split(" — ")[0] ?? family.clinicalModel}</span> {family.clinicalNotes}</p>
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm">
          {([["weeks", "Supply vs demand — hours by week"], ["sites", "Sites & allocated shifts"], ["model", "Model, service areas & requirements"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 ${tab === k ? "bg-rose-600 font-medium text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{l}</button>
          ))}
        </div>
      </div>

      {tab === "weeks" && (
        <div className="space-y-4">
          <p className="text-base text-slate-800">
            Across {weeksWithDemand} weeks with clinicals ({fmtW(from)} → {fmtW(to)}), {family.name} needs <strong>{n0(demandTotal)} clinical hours</strong>
            {demandTotal > 0 && <> — the physical ceiling of the {sites.length} sites can host <strong>{n0(physicalTotal)}</strong> ({pct(physicalTotal / demandTotal)}), the shifts actually allocated to this program cover <strong className="text-emerald-700">{n0(offeredTotal)}</strong> ({pct(offeredTotal / demandTotal)}), and <strong>{n0(bookedTotal)}</strong> are booked onto specific assets</>}.
            {" "}{secured} of {sites.length} sites are secured for this job.
            {demandTotal === 0 && <> No offering of this family has dated clinical courses yet — lock one in on the goal page.</>}
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 font-semibold">Setting</th><th className="px-2 py-2 text-right font-semibold">Demand hrs</th><th className="px-2 py-2 text-right font-semibold">Physical hrs</th><th className="px-2 py-2 text-right font-semibold">Allocated hrs</th><th className="px-2 py-2 text-right font-semibold">Booked hrs</th><th className="px-2 py-2 text-right font-semibold">Weeks short (allocated)</th><th className="px-2 py-2 text-right font-semibold">Weeks short (physical)</th><th className="px-2 py-2 font-semibold">Peak week</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {summaries.map((s) => (
                  <tr key={s.settingCode} className={s.shortOfferedWeeks > 0 ? "bg-rose-50/40" : ""}>
                    <td className="px-3 py-2"><span className="font-mono text-[10px] text-slate-400">{s.settingCode}</span> <span className="font-medium text-slate-800">{settingName(s.settingCode)}</span></td>
                    <td className="px-2 py-2 text-right tabular-nums">{n0(s.demandHours)}</td><td className="px-2 py-2 text-right tabular-nums">{n0(s.physicalHours)}</td><td className="px-2 py-2 text-right tabular-nums text-emerald-700">{n0(s.offeredHours)}</td><td className="px-2 py-2 text-right tabular-nums">{n0(s.bookedHours)}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${s.shortOfferedWeeks ? "font-semibold text-rose-700" : ""}`}>{s.shortOfferedWeeks} / {s.weeksWithDemand}</td><td className={`px-2 py-2 text-right tabular-nums ${s.shortPhysicalWeeks ? "font-semibold text-rose-700" : ""}`}>{s.shortPhysicalWeeks} / {s.weeksWithDemand}</td>
                    <td className="px-2 py-2 text-slate-600">{s.peak ? `${fmtW(s.peak.weekIso)}: ${n0(s.peak.demandHours)} h needed · ${n0(s.peak.offeredHours)} allocated (${pct(s.peakOfferedShare)}) · ${n0(s.peak.physicalHours)} physical` : "—"}</td>
                  </tr>
                ))}
                {summaries.length === 0 && <tr><td colSpan={8} className="px-3 py-3 text-slate-400">Nothing to match yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <WeekTable rows={rows} settingName={settingName} />
          <div className="grid gap-3 md:grid-cols-2">
            {(["county", "ring"] as const).map((kind) => (
              <div key={kind} className="rounded-xl border border-slate-200 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Where the hours can come from — by {kind}</div>
                <table className="mt-1 w-full text-xs"><thead className="text-left text-[10px] uppercase tracking-wide text-slate-400"><tr><th className="py-1">{kind}</th><th className="py-1 text-right">Physical hrs</th><th className="py-1 text-right">Allocated hrs</th><th className="py-1 text-right">Share of demand</th></tr></thead>
                  <tbody>{regions.filter((r) => r.key.startsWith(kind + ":")).map((r) => <tr key={r.key} className="border-t border-slate-100"><td className="py-1 font-medium text-slate-700">{r.key.split(":")[1]}</td><td className="py-1 text-right tabular-nums">{n0(r.physical)}</td><td className="py-1 text-right tabular-nums text-emerald-700">{n0(r.offered)}</td><td className="py-1 text-right tabular-nums">{demandTotal ? pct(r.offered / demandTotal) : "—"}</td></tr>)}</tbody></table>
                <p className="mt-1 text-[11px] text-slate-500">Demand is {family.institution}&apos;s: {n0(demandTotal)} hours in the window.</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "sites" && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">Every site that holds something this job uses. The agreement here is <strong>for {family.name}</strong> — the same hospital can be secured for one job and a prospect for another. Allocated shifts are what the site has agreed to make available to this program each week, by setting and shift block; that is the supply that counts.</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 font-semibold">Site</th><th className="px-2 py-2 font-semibold">Region</th><th className="px-2 py-2 font-semibold">Agreement for {family.name}</th><th className="px-2 py-2 font-semibold">What it holds for this job</th><th className="px-2 py-2 font-semibold">Shifts allocated to this program, per week</th><th className="px-2 py-2" /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {sites.map((s) => (
                  <tr key={s.id} className="align-top">
                    <td className="px-3 py-2"><a href={`/employers/${s.id}`} className="font-medium text-slate-800 hover:text-rose-700">{s.name}</a><div className="text-[10px] text-slate-400">{s.externalId ?? ""} · {s.facilityType ?? ""}{s.globalAgreement !== s.agreementStatus ? ` · overall: ${s.globalAgreement}` : ""}</div></td>
                    <td className="px-2 py-2 text-slate-600">{s.county ?? "—"}<br /><span className="text-[10px]">{s.ring ?? ""}</span></td>
                    <td className="px-2 py-2">
                      <form action={async (fd) => { await upsertFamilySite(family.id, s.id, fd); refresh(); }} className="flex items-center gap-1">
                        <select name="agreementStatus" defaultValue={s.agreementStatus} className={`rounded px-1.5 py-1 text-[11px] font-medium ${AGREEMENT[s.agreementStatus]}`}>{AGREEMENTS.map((a) => <option key={a} value={a}>{a}</option>)}</select>
                        <button className="rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white">Save</button>
                      </form>
                    </td>
                    <td className="px-2 py-2 text-slate-700">
                      {Object.entries(s.bySetting).map(([code, v]) => <div key={code}><span className="font-mono text-[10px] text-slate-400">{code}</span> {v.assets} × {v.setting} <span className="text-slate-400">· {v.weeklyShifts} physical shifts/wk</span></div>)}
                      {s.units.map((u, i) => <div key={i}><span className="font-mono text-[10px] text-slate-400">unit</span> {u.type} <span className="text-slate-400">· {u.capacity ?? "?"} {u.uom ?? ""} · {u.studentsPerShift} students/shift</span></div>)}
                      {Object.keys(s.bySetting).length === 0 && s.units.length === 0 && <span className="text-slate-400">nothing mapped yet</span>}
                    </td>
                    <td className="px-2 py-2">
                      {Object.keys(s.bySetting).map((code) => {
                        const al = (b: string) => s.allocations.find((a) => a.settingCode === code && a.block === b);
                        const any = s.allocations.find((a) => a.settingCode === code);
                        return (
                          <form key={code} action={async (fd) => { await saveSettingAllocation(family.id, s.id, fd); refresh(); }} className="mb-1 flex flex-wrap items-center gap-1">
                            <input type="hidden" name="settingCode" value={code} />
                            <span className="w-14 font-mono text-[10px] text-slate-500">{code}</span>
                            {["Day", "Evening", "Night"].map((b) => <label key={b} className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">{b[0]}<input name={`shifts_${b}`} type="number" min={0} step="any" defaultValue={al(b)?.shiftsPerWeek ?? 0} className="w-12 rounded border border-slate-300 px-1 py-0.5 text-right text-[11px] text-slate-800" /></label>)}
                            <label className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">hrs<input name="hoursPerShift" type="number" step="any" defaultValue={any?.hoursPerShift ?? 8} className="w-10 rounded border border-slate-300 px-1 py-0.5 text-right text-[11px]" /></label>
                            <label className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">learners<input name="learnersPerShift" type="number" min={0} defaultValue={any?.learnersPerShift ?? 1} className="w-10 rounded border border-slate-300 px-1 py-0.5 text-right text-[11px]" /></label>
                            <button className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white">Save</button>
                          </form>
                        );
                      })}
                      {Object.keys(s.bySetting).length === 0 && <span className="text-[11px] text-slate-400">add physical assets on the site page to allocate shifts</span>}
                    </td>
                    <td className="px-2 py-2"><button onClick={() => { if (confirm(`Remove ${s.name} from ${family.name}'s clinical sites?`)) removeFamilySite(family.id, s.id).then(refresh); }} className="text-slate-300 hover:text-rose-700" title="remove from this program">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "model" && (
        <div className="space-y-5">
          <form action={async (fd) => { await updateFamilyClinicalModel(family.id, fd); refresh(); }} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[14rem_1fr_auto]">
            <label className="block text-xs"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">How clinicals are administered</span><select name="clinicalModel" defaultValue={family.clinicalModel} className="w-full rounded border border-slate-300 px-2 py-1">{Object.entries(MODEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="block text-xs"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">The rule, in this job&apos;s own terms</span><input name="clinicalNotes" defaultValue={family.clinicalNotes ?? ""} className="w-full rounded border border-slate-300 px-2 py-1" /></label>
            <button className="self-end rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white">Save</button>
          </form>

          <div>
            <div className="mb-1 text-sm font-semibold text-slate-800">Service areas — and which physical settings / unit categories serve each</div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-2 font-semibold">Code</th><th className="px-2 py-2 font-semibold">Service area</th><th className="px-2 py-2 font-semibold">Asset setting codes (csv)</th><th className="px-2 py-2 font-semibold">Unit categories (csv)</th><th className="px-2 py-2 font-semibold">Notes</th><th className="px-2 py-2" /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {[...areas, null].map((a) => { const fid = a ? `area-${a.id}` : "area-new"; return (
                    <tr key={a?.id ?? "new"} className={a ? "" : "bg-rose-50/30"}>
                      <td className="px-2 py-1.5"><input form={fid} name="code" defaultValue={a?.code ?? ""} placeholder="GEN" readOnly={!!a} className="w-20 rounded border border-slate-300 px-1.5 py-1 font-mono uppercase" /></td>
                      <td className="px-2 py-1.5"><input form={fid} name="name" defaultValue={a?.name ?? ""} placeholder="General fixed-room radiography" className="w-72 rounded border border-slate-300 px-1.5 py-1" /></td>
                      <td className="px-2 py-1.5"><input form={fid} name="settingCodes" defaultValue={a?.settingCodes.join(",") ?? ""} placeholder="GEN" className="w-36 rounded border border-slate-300 px-1.5 py-1 font-mono" /></td>
                      <td className="px-2 py-1.5"><input form={fid} name="unitCategories" defaultValue={a?.unitCategories.join(",") ?? ""} placeholder="Imaging" className="w-40 rounded border border-slate-300 px-1.5 py-1" /></td>
                      <td className="px-2 py-1.5"><input form={fid} name="notes" defaultValue={a?.notes ?? ""} className="w-44 rounded border border-slate-300 px-1.5 py-1" /></td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <form id={fid} action={async (fd) => { await upsertServiceArea(family.id, fd); refresh(); }}><button className={`rounded px-2 py-1 font-medium text-white ${a ? "bg-slate-800" : "bg-rose-600"}`}>{a ? "Save" : "+ Add"}</button></form>
                        {a && <button onClick={() => { if (confirm(`Delete service area ${a.code}? Its requirements go with it.`)) deleteServiceArea(a.id, family.id).then(refresh); }} className="ml-1 text-slate-300 hover:text-rose-700">✕</button>}
                      </td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
          </div>

          {programs.map((p) => {
            const clinicalCourses = p.courses.filter((c) => c.weeklyClinicalHours > 0 || c.requirements.length > 0 || /clinic|practicum|extern/i.test(c.name));
            const totals = requirementTotals(clinicalCourses.flatMap((c) => c.requirements.map((r) => ({ courseId: c.id, serviceAreaId: r.serviceAreaId, hoursPerStudent: r.hoursPerStudent }))), clinicalCourses.map((c) => ({ id: c.id, weeks: c.weeks })));
            return (
              <div key={p.id}>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2"><div className="text-sm font-semibold text-slate-800">Requirement grid — {p.name} <span className="text-xs font-normal text-slate-500">· {family.clinicalModel === "competency" ? "cases (and hours) per student" : "hours per student"} by course × service area</span></div><div className="text-xs text-slate-600"><strong>{n0(totals.perStudent)} h</strong> per student across the program · <strong>{n1(totals.weeklyPerStudent)} h/wk</strong> per student while in clinicals</div></div>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-2 font-semibold">Course</th><th className="px-2 py-2 font-semibold">Term · weeks</th>{areas.map((a) => <th key={a.id} className="px-2 py-2 text-right font-semibold" title={a.name}>{a.code}</th>)}<th className="px-2 py-2 text-right font-semibold">Total / student</th><th className="px-2 py-2 text-right font-semibold">h / wk / student</th><th className="px-2 py-2" /></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {clinicalCourses.map((c) => { const fid = `req-${c.id}`; const tot = c.requirements.reduce((n, r) => n + r.hoursPerStudent, 0); return (
                        <tr key={c.id}>
                          <td className="px-2 py-1.5 whitespace-nowrap"><span className="font-mono text-slate-700">{c.code ?? ""}</span> <span className="text-slate-600">{c.name}</span></td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">{c.termName} · {c.weeks} wk</td>
                          {areas.map((a) => { const r = c.requirements.find((x) => x.serviceAreaId === a.id); return <td key={a.id} className="px-1 py-1.5 text-right"><input form={fid} name={`req_${a.id}`} type="number" min={0} step="any" defaultValue={r?.hoursPerStudent || ""} className={`w-14 rounded border px-1 py-0.5 text-right ${r?.hoursPerStudent ? "border-blue-200 bg-blue-50/70 text-blue-900" : "border-slate-200 text-slate-400"}`} />{family.clinicalModel !== "hours" && <input form={fid} name={`cases_${a.id}`} type="number" min={0} step="any" defaultValue={r?.casesPerStudent ?? ""} placeholder="cases" className="mt-0.5 w-14 rounded border border-violet-200 bg-violet-50/60 px-1 py-0.5 text-right text-violet-900" />}</td>; })}
                          <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{n0(tot)}</td><td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{n1(tot / Math.max(1, c.weeks))}</td>
                          <td className="px-2 py-1.5"><form id={fid} action={async (fd) => { await saveCourseRequirements(c.id, family.id, fd); refresh(); }}><button className="rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white">Save</button></form></td>
                        </tr>
                      ); })}
                      <tr className="bg-slate-50 font-semibold"><td className="px-2 py-1.5" colSpan={2}>Program total per student</td>{areas.map((a) => <td key={a.id} className="px-2 py-1.5 text-right tabular-nums">{n0(clinicalCourses.reduce((n, c) => n + (c.requirements.find((x) => x.serviceAreaId === a.id)?.hoursPerStudent ?? 0), 0))}</td>)}<td className="px-2 py-1.5 text-right tabular-nums">{n0(totals.perStudent)}</td><td className="px-2 py-1.5 text-right tabular-nums">{n1(totals.weeklyPerStudent)}</td><td /></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function WeekTable({ rows, settingName }: { rows: ReturnType<typeof matchWeekly>; settingName: (c: string) => string }) {
  const [setting, setSetting] = useState("all"); const [onlyDemand, setOnlyDemand] = useState(true);
  const settings = [...new Set(rows.map((r) => r.settingCode))].sort();
  const list = rows.filter((r) => (setting === "all" || r.settingCode === setting) && (!onlyDemand || r.demandHours > 0));
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-700">Week by week</span>
        <select value={setting} onChange={(e) => setSetting(e.target.value)} className="rounded border border-slate-300 px-2 py-1"><option value="all">every setting</option>{settings.map((s) => <option key={s} value={s}>{s} · {settingName(s)}</option>)}</select>
        <label className="inline-flex items-center gap-1"><input type="checkbox" checked={onlyDemand} onChange={(e) => setOnlyDemand(e.target.checked)} /> only weeks with demand</label>
        <span className="text-slate-400">{list.length} rows</span>
      </div>
      <div className="max-h-[28rem] overflow-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 font-semibold">Week of</th><th className="px-2 py-2 font-semibold">Setting</th><th className="px-2 py-2 text-right font-semibold">Demand hrs</th><th className="px-2 py-2 text-right font-semibold">Allocated hrs</th><th className="px-2 py-2 text-right font-semibold">Physical hrs</th><th className="px-2 py-2 text-right font-semibold">Booked hrs</th><th className="px-2 py-2 text-right font-semibold">Short vs allocated</th><th className="px-2 py-2 text-right font-semibold">Short vs physical</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {list.slice(0, 800).map((r) => (
              <tr key={`${r.weekIso}|${r.settingCode}`} className={r.shortOffered > 0 ? "bg-rose-50/40" : ""}>
                <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-700">{fmtW(r.weekIso)}</td><td className="px-2 py-1.5">{r.settingCode}</td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{n0(r.demandHours)}</td><td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{n0(r.offeredHours)}</td><td className="px-2 py-1.5 text-right tabular-nums">{n0(r.physicalHours)}</td><td className="px-2 py-1.5 text-right tabular-nums">{n0(r.bookedHours)}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${r.shortOffered > 0 ? "font-semibold text-rose-700" : ""}`}>{n0(r.shortOffered)}</td><td className={`px-2 py-1.5 text-right tabular-nums ${r.shortPhysical > 0 ? "font-semibold text-rose-700" : ""}`}>{n0(r.shortPhysical)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
