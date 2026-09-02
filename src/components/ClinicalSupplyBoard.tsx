"use client";

// Clinical supply vs demand the way a clinical coordinator works it:
//   1. the verdict per unit category — physical room vs SECURED room
//   2. the Day grid — students each category can host, by weekday × shift block
//   3. the gap list — every date/block where demand exceeds secured supply
//   4. assignment — put each clinical section at a site + functional unit
//   5. the rotation-type → unit-category join, editable
// Supply = the asset map (functional units); demand = dated clinical sections.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildInstances, type DatedInstance, type CohortCalendarInput } from "@/lib/capacitymodel";
import {
  dayGrid, clinicalDemand, matchByDate, categoryVerdicts, SHIFT_BLOCKS, WEEKDAYS,
  type SupplySite, type RotationMap, type ShiftBlock,
} from "@/lib/clinicalsupply";
import { assignSectionSite, upsertRotationSetting, updateEmployerAgreement } from "@/lib/actions";
import type { CapacityCohort } from "@/components/CapacityBoard";

const n0 = (v: number) => Math.round(v).toLocaleString();
const fmtD = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const AGREEMENT: Record<string, string> = { none: "bg-slate-100 text-slate-500", prospect: "bg-sky-100 text-sky-700", asked: "bg-amber-100 text-amber-700", secured: "bg-emerald-100 text-emerald-700", declined: "bg-rose-100 text-rose-700" };
const AGREEMENTS = ["none", "prospect", "asked", "secured", "declined"];
const CATEGORIES = ["Inpatient beds", "Surgical", "Emergency", "Imaging", "Laboratory", "Long-term care beds", "Adult care beds", "Behavioral health", "Ambulatory office", "Community"];

export function ClinicalSupplyBoard({ institutionId, sites, rotations, cohorts }: {
  institutionId: string; sites: SupplySite[]; rotations: RotationMap[]; cohorts: CapacityCohort[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"verdict" | "grid" | "gaps" | "assign" | "sites" | "map">("verdict");

  // Dated demand from every planned/active offering.
  const rows: DatedInstance[] = useMemo(() => cohorts.flatMap((c) => buildInstances({
    cohortId: c.cohortId, cohort: c.cohort, programId: c.programId, program: c.program,
    enrollmentByTerm: c.enrollmentByTerm,
    termStartByIndex: Object.fromEntries(Object.entries(c.termStartByIndex).map(([k, v]) => [k, v ? new Date(v) : null])),
    holidays: c.holidays,
    courses: c.courses,
  } as CohortCalendarInput, c.assumptions).filter((i) => i.mondayIso != null)), [cohorts]);

  const physical = useMemo(() => dayGrid(sites, false), [sites]);
  const secured = useMemo(() => dayGrid(sites, true), [sites]);
  const demand = useMemo(() => clinicalDemand(rows, rotations), [rows, rotations]);
  const gaps = useMemo(() => matchByDate(demand, physical, secured), [demand, physical, secured]);
  const verdicts = useMemo(() => categoryVerdicts(gaps, sites), [gaps, sites]);
  const unmapped = useMemo(() => [...new Set(demand.filter((d) => !d.category).map((d) => d.rotationType))], [demand]);

  // Clinical sections to place: every CLINICAL booking across the cohorts.
  const sections = useMemo(() => cohorts.flatMap((c) => (c.meetings ?? []).filter((m) => m.kind === "CLINICAL").map((m) => {
    const course = c.courses.find((x) => x.courseId === m.courseId);
    const rot = course?.sessions.find((s) => s.kind === "CLINICAL")?.rotationType ?? null;
    return { ...m, cohort: c.cohort, program: c.program, courseCode: course?.code ?? null, courseTitle: course?.title ?? "", rotationType: rot };
  })), [cohorts]);
  const unassigned = sections.filter((m) => !m.employerId).length;

  const securedSites = sites.filter((s) => s.agreementStatus === "secured").length;
  const askedSites = sites.filter((s) => s.agreementStatus === "asked").length;
  const totalShort = gaps.filter((g) => g.shortSecured > 0).length;

  const setAgreement = (employerId: string, status: string) => startTransition(async () => { await updateEmployerAgreement(employerId, status); router.refresh(); });
  const assign = (meetingId: string, employerId: string | null, unitId: string | null) => startTransition(async () => { await assignSectionSite(meetingId, employerId, unitId); router.refresh(); });

  return (
    <div className="space-y-4">
      {/* ── The verdict, in a sentence ── */}
      <section className="rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50/60 to-white p-4">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-500">For placement coordinators, deans &amp; health-system partners</div>
        <p className="mt-1 text-base text-slate-800">
          {demand.length === 0 ? (
            <>No dated clinical demand yet — lock in an instantiation and its clinical sections land here.</>
          ) : (
            <>
              <strong>{n0(sites.length)} sites</strong> in the asset map, <strong className="text-emerald-700">{n0(securedSites)} secured</strong>{askedSites > 0 && <>, {n0(askedSites)} asked</>}.
              {" "}Across the period, <strong className={totalShort > 0 ? "text-rose-700" : "text-emerald-700"}>{n0(totalShort)} date-blocks</strong> exceed what secured sites can host
              {unassigned > 0 && <>, and <strong className="text-amber-700">{n0(unassigned)} clinical sections</strong> have no site assigned</>}.
              {unmapped.length > 0 && <> <span className="text-rose-700">Unmapped rotation types: {unmapped.join(", ")} — map them below or their demand can&apos;t be matched.</span></>}
            </>
          )}
        </p>
        {pending && <span className="text-xs text-slate-400">saving…</span>}
      </section>

      <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-slate-300 text-sm">
        {([["verdict", "Verdict by setting"], ["grid", "Day grid (supply)"], ["gaps", "Gaps by date"], ["assign", `Assign sections${unassigned ? ` (${unassigned} open)` : ""}`], ["sites", "Sites & agreements"], ["map", "Rotation → unit map"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 ${tab === k ? "bg-rose-600 font-medium text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{l}</button>
        ))}
      </div>

      {/* 1 · Verdict per category */}
      {tab === "verdict" && (
        <section className="grid gap-3 lg:grid-cols-2">
          {verdicts.length === 0 && <p className="text-sm text-slate-400">No mapped clinical demand in the slice.</p>}
          {verdicts.map((v) => {
            const okPhysical = v.physicalAtPeak >= v.peakDemand;
            const okSecured = v.securedAtPeak >= v.peakDemand;
            return (
              <div key={v.category} className={`rounded-xl border p-4 ${okSecured ? "border-emerald-200 bg-emerald-50/30" : okPhysical ? "border-amber-200 bg-amber-50/30" : "border-rose-200 bg-rose-50/30"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-base font-semibold text-slate-900">{v.category}</div>
                    <div className="text-xs text-slate-500">rotations: {v.rotationTypes.join(" · ")}</div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${okSecured ? "bg-emerald-600 text-white" : okPhysical ? "bg-amber-500 text-white" : "bg-rose-600 text-white"}`}>
                    {okSecured ? "covered by secured sites" : okPhysical ? "room exists — not yet secured" : "not enough physical room"}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200"><div className="text-2xl font-bold tabular-nums text-slate-900">{n0(v.peakDemand)}</div><div className="text-[10px] uppercase tracking-wide text-slate-400">students at peak</div><div className="text-[10px] text-slate-500">{v.peakDateIso ? `${fmtD(v.peakDateIso)} · ${v.peakBlock}` : "—"}</div></div>
                  <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200"><div className={`text-2xl font-bold tabular-nums ${okSecured ? "text-emerald-700" : "text-rose-700"}`}>{n0(v.securedAtPeak)}</div><div className="text-[10px] uppercase tracking-wide text-slate-400">secured room that block</div><div className="text-[10px] text-slate-500">{v.sitesSecured} secured site{v.sitesSecured === 1 ? "" : "s"}</div></div>
                  <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200"><div className={`text-2xl font-bold tabular-nums ${okPhysical ? "text-slate-800" : "text-rose-700"}`}>{n0(v.physicalAtPeak)}</div><div className="text-[10px] uppercase tracking-wide text-slate-400">physical room that block</div><div className="text-[10px] text-slate-500">{v.sitesPhysical} site{v.sitesPhysical === 1 ? "" : "s"} with units</div></div>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  Over the period: <strong>{n0(v.hostedSecured)}</strong> of {n0(v.studentDays)} student-days fit in secured sites ({v.studentDays ? Math.round((v.hostedSecured / v.studentDays) * 100) : 0}%);
                  {" "}<strong>{n0(v.hostedPhysical)}</strong> fit physically ({v.studentDays ? Math.round((v.hostedPhysical / v.studentDays) * 100) : 0}%).
                  {v.shortDaysSecured > 0 && <> <strong className="text-rose-700">{n0(v.shortDaysSecured)} date-blocks short</strong> — secure more {v.category.toLowerCase()} sites, spread onto evening/night blocks, or move rotations off the pile-up days.</>}
                </p>
              </div>
            );
          })}
        </section>
      )}

      {/* 2 · Day grid */}
      {tab === "grid" && (
        <section className="space-y-3">
          <p className="text-xs text-slate-500">Students each unit category can host on each weekday × shift block — <strong>secured sites</strong> first, physical ceiling in parentheses. Driven by every unit&apos;s shift structure, days open and students per shift (edit those on the site pages).</p>
          {Object.keys(physical).sort().map((cat) => (
            <div key={cat} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-800">{cat}</div>
              <table className="min-w-full text-xs">
                <thead><tr className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><th className="px-3 py-1.5 font-semibold">Block</th>{WEEKDAYS.map((w) => <th key={w} className="px-3 py-1.5 text-right font-semibold">{w}</th>)}<th className="px-3 py-1.5 text-right font-semibold">Weekly</th></tr></thead>
                <tbody>
                  {SHIFT_BLOCKS.map((b) => {
                    const sec = WEEKDAYS.map((w) => secured[cat]?.[b]?.[w]?.students ?? 0);
                    const phy = WEEKDAYS.map((w) => physical[cat]?.[b]?.[w]?.students ?? 0);
                    return (
                      <tr key={b} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 font-medium text-slate-700">{b}</td>
                        {WEEKDAYS.map((w, i) => <td key={w} className={`px-3 py-1.5 text-right tabular-nums ${phy[i] === 0 ? "text-slate-300" : ""}`}><strong className={sec[i] > 0 ? "text-emerald-700" : "text-slate-400"}>{n0(sec[i])}</strong> <span className="text-slate-400">({n0(phy[i])})</span></td>)}
                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums"><span className="text-emerald-700">{n0(sec.reduce((a, c) => a + c, 0))}</span> <span className="font-normal text-slate-400">({n0(phy.reduce((a, c) => a + c, 0))})</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}

      {/* 3 · Gaps by date */}
      {tab === "gaps" && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">Every date × shift block × category with demand. Red = more students than secured sites can host that block; amber = fits physically but not in secured sites.</div>
          <div className="max-h-[32rem] overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-slate-50"><tr className="text-left text-[10px] uppercase tracking-wide text-slate-500"><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Block</th><th className="px-3 py-2 font-semibold">Category</th><th className="px-3 py-2 text-right font-semibold">Students</th><th className="px-3 py-2 text-right font-semibold">Secured</th><th className="px-3 py-2 text-right font-semibold">Physical</th><th className="px-3 py-2 font-semibold">Who</th></tr></thead>
              <tbody>
                {gaps.map((g) => (
                  <tr key={`${g.dateIso}|${g.block}|${g.category}`} className={`border-t border-slate-100 ${g.shortSecured > 0 ? (g.shortPhysical > 0 ? "bg-rose-50" : "bg-amber-50") : ""}`}>
                    <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-700">{fmtD(g.dateIso)}</td>
                    <td className="px-3 py-1.5">{g.block}</td>
                    <td className="px-3 py-1.5">{g.category} <span className="text-slate-400">({g.rotationTypes.join(", ")})</span></td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{n0(g.demand)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${g.shortSecured > 0 ? "font-semibold text-rose-700" : "text-emerald-700"}`}>{n0(g.secured)}{g.shortSecured > 0 ? ` (−${n0(g.shortSecured)})` : ""}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${g.shortPhysical > 0 ? "font-semibold text-rose-700" : "text-slate-600"}`}>{n0(g.physical)}</td>
                    <td className="px-3 py-1.5 text-slate-500">{g.cohorts.join(" · ")}</td>
                  </tr>
                ))}
                {gaps.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-slate-400">No mapped clinical demand.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 4 · Assign sections to sites + units */}
      {tab === "assign" && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">Each clinical section&apos;s weekly booking — pick the site and the functional unit that hosts it. Only sites with a matching unit category are offered first; secured sites are marked ✓.</div>
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50"><tr className="text-left text-[10px] uppercase tracking-wide text-slate-500"><th className="px-3 py-2 font-semibold">Section</th><th className="px-3 py-2 font-semibold">When</th><th className="px-3 py-2 font-semibold">Rotation</th><th className="px-3 py-2 text-right font-semibold">Seats</th><th className="px-3 py-2 font-semibold">Site</th><th className="px-3 py-2 font-semibold">Unit</th></tr></thead>
            <tbody>
              {sections.map((m) => {
                const cat = rotations.find((r) => r.rotationType.toLowerCase() === (m.rotationType ?? "").toLowerCase())?.unitCategory ?? null;
                const site = sites.find((s) => s.id === m.employerId) ?? null;
                const siteOptions = [...sites].sort((a, b) => Number(!!cat && b.units.some((u) => u.unitCategory === cat)) - Number(!!cat && a.units.some((u) => u.unitCategory === cat)) || Number(b.agreementStatus === "secured") - Number(a.agreementStatus === "secured") || a.name.localeCompare(b.name));
                return (
                  <tr key={m.id} className={`border-t border-slate-100 ${m.employerId ? "" : "bg-amber-50/50"}`}>
                    <td className="px-3 py-1.5"><span className="font-medium text-slate-800">{m.courseCode ?? m.courseTitle}</span> §{m.sectionIndex}/{m.sectionCount} <span className="block text-slate-400">{m.cohort} · {m.program}</span></td>
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{m.dayOfWeek} {m.startTime} · {m.lengthHours ?? "—"}h</td>
                    <td className="px-3 py-1.5">{m.rotationType ?? "—"}{cat ? <span className="block text-slate-400">→ {cat}</span> : <span className="block text-rose-600">unmapped</span>}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m.seats}</td>
                    <td className="px-3 py-1.5">
                      <select value={m.employerId ?? ""} onChange={(e) => assign(m.id, e.target.value || null, null)} className="max-w-[16rem] rounded border border-slate-300 px-1.5 py-1">
                        <option value="">— site TBD —</option>
                        {siteOptions.map((s) => <option key={s.id} value={s.id}>{s.agreementStatus === "secured" ? "✓ " : ""}{s.name}{cat && s.units.some((u) => u.unitCategory === cat) ? "" : " (no matching unit)"}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-1.5">
                      <select value={m.unitId ?? ""} onChange={(e) => assign(m.id, m.employerId ?? null, e.target.value || null)} disabled={!site} className="max-w-[14rem] rounded border border-slate-300 px-1.5 py-1 disabled:opacity-40">
                        <option value="">— unit —</option>
                        {(site?.units ?? []).map((u) => <option key={u.id} value={u.id}>{u.unitType}{u.capacityCount != null ? ` (${n0(u.capacityCount)} ${u.uom ?? ""})` : ""} · {u.studentsPerShift}/shift</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
              {sections.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-slate-400">No clinical sections booked yet — lock in an instantiation.</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      {/* 5 · Sites & agreements */}
      {tab === "sites" && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">Where each site stands with you. Set the agreement status here; open a site to configure its functional units.</div>
          <div className="max-h-[36rem] overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-slate-50"><tr className="text-left text-[10px] uppercase tracking-wide text-slate-500"><th className="px-3 py-2 font-semibold">Site</th><th className="px-3 py-2 font-semibold">Type · county · ring</th><th className="px-3 py-2 text-right font-semibold">Beds / ORs</th><th className="px-3 py-2 font-semibold">Units (students/shift by category)</th><th className="px-3 py-2 font-semibold">Agreement</th></tr></thead>
              <tbody>
                {sites.map((s) => {
                  const byCat = new Map<string, number>();
                  for (const u of s.units) byCat.set(u.unitCategory, (byCat.get(u.unitCategory) ?? 0) + u.studentsPerShift);
                  return (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="px-3 py-1.5"><a href={`/employers/${s.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{s.name}</a>{s.organization && <span className="block text-slate-400">{s.organization}</span>}</td>
                      <td className="px-3 py-1.5 text-slate-600">{[s.facilityType, s.county, s.ring].filter(Boolean).join(" · ")}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{s.licensedBeds ?? s.nursingHomeBeds ?? "—"}{s.operatingRooms ? ` / ${s.operatingRooms} OR` : ""}</td>
                      <td className="px-3 py-1.5 text-slate-600">{[...byCat.entries()].map(([c, n]) => `${c} ${n0(n)}`).join(" · ") || <span className="text-slate-300">no units</span>}</td>
                      <td className="px-3 py-1.5">
                        <select value={s.agreementStatus} onChange={(e) => setAgreement(s.id, e.target.value)} className={`rounded-full border-0 px-2 py-0.5 text-[11px] font-medium ${AGREEMENT[s.agreementStatus] ?? AGREEMENT.none}`}>
                          {AGREEMENTS.map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 6 · Rotation → unit map */}
      {tab === "map" && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-3 text-xs text-slate-500">The join between demand and supply: each clinical rotation type in your templates maps to the unit category (and optionally unit type) that can host it. Unmapped rotation types can&apos;t be matched.</p>
          <table className="min-w-full text-xs">
            <thead><tr className="text-left text-[10px] uppercase tracking-wide text-slate-500"><th className="py-1.5 pr-3 font-semibold">Rotation type</th><th className="py-1.5 pr-3 font-semibold">Unit category</th><th className="py-1.5 pr-3 font-semibold">Unit type (optional)</th><th className="py-1.5 pr-3 font-semibold">Patients / student</th><th /></tr></thead>
            <tbody>
              {[...rotations.map((r) => ({ ...r, isNew: false })), ...unmapped.map((rt) => ({ rotationType: rt, unitCategory: "", unitType: null as string | null, patientsPerStudent: null as number | null, isNew: true }))].map((r) => (
                <tr key={r.rotationType} className={`border-t border-slate-100 ${r.isNew ? "bg-rose-50/50" : ""}`}>
                  <td colSpan={5} className="py-1">
                    <form action={upsertRotationSetting.bind(null, institutionId)} className="flex flex-wrap items-center gap-2">
                      <input name="rotationType" defaultValue={r.rotationType} className="w-44 rounded border border-slate-300 px-1.5 py-1 font-medium" />
                      <select name="unitCategory" defaultValue={r.unitCategory} className="rounded border border-slate-300 px-1.5 py-1">
                        <option value="">— pick —</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input name="unitType" defaultValue={r.unitType ?? ""} placeholder="unit type (optional)" className="w-44 rounded border border-slate-300 px-1.5 py-1" />
                      <input name="patientsPerStudent" type="number" step="any" defaultValue={r.patientsPerStudent ?? ""} placeholder="pts/student" className="w-24 rounded border border-slate-300 px-1.5 py-1 text-right" />
                      <button className="rounded bg-rose-600 px-2.5 py-1 font-medium text-white hover:bg-rose-700">{r.isNew ? "Map it" : "Save"}</button>
                      {r.isNew && <span className="text-rose-700">unmapped — demand for this rotation isn&apos;t being matched</span>}
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

/** Convenience used by the sites tab. */
export function agreementBadge(status: string) { return AGREEMENT[status] ?? AGREEMENT.none; }
