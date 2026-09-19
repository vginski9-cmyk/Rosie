"use client";

// The expansion studio (Phase 9, use case 1). Top: the question — a workforce target, a year, a
// design — and the answer as one sentence. Then the constraint that binds first with where it binds,
// the secondary ones, what the design would add, what it costs per worker, when the first workers
// arrive, the milestones with owners, the assumptions with their status, and the trace from the
// recommendation back to courses, shifts, settings and sites. Scenarios are saved by name and
// compared side by side; none of them touches the operating plan.

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { evaluateExpansion, saveScenario, deleteScenario, setScenarioStatus } from "@/lib/actions";
import { EXPANSION_KINDS, type ExpansionDesign, type ExpansionResult, type Constraint } from "@/lib/expansion";
import type { ScenarioRow, SitePick } from "@/lib/expansionquery";
import { ASSUMPTION_DEFS } from "@/lib/assumptions";
import { dec, fmt, numInput } from "@/lib/format";

const n = (v: number | null | undefined) => (v == null ? "—" : dec(v));
const money = (v: number | null | undefined) => (v == null ? "—" : `$${fmt.num(Math.round(v))}`);
const fmtD = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const SEV: Record<Constraint["severity"], { chip: string; label: string; row: string }> = {
  binding: { chip: "bg-rose-600 text-white", label: "binds first", row: "border-rose-200 bg-rose-50/50" },
  secondary: { chip: "bg-amber-500 text-white", label: "also binds", row: "border-amber-200 bg-amber-50/40" },
  unknown: { chip: "bg-slate-200 text-slate-700", label: "unknown", row: "border-slate-200 bg-white" },
  info: { chip: "bg-sky-100 text-sky-800", label: "note", row: "border-slate-200 bg-white" },
  ok: { chip: "bg-emerald-100 text-emerald-800", label: "covered", row: "border-slate-200 bg-white" },
};
const EVIDENCE: Record<Constraint["evidence"], string> = { verified: "text-emerald-700", estimate: "text-amber-700", unknown: "text-slate-500" };
const inp = "rounded border border-slate-300 px-2 py-1 text-sm";
const lbl = "block text-[10px] font-semibold uppercase tracking-wide text-slate-500";

export function ExpansionStudio({ program, scenarios, defaultDesign, sitePicks, assumptionRowCount }: { program: { id: string; name: string; institutionId: string; institution: string; familyId: string | null; family: string | null; terms: number }; scenarios: ScenarioRow[]; defaultDesign: ExpansionDesign; sitePicks: SitePick[]; assumptionRowCount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [scenarioId, setScenarioId] = useState<string | null>(scenarios[0]?.id ?? null);
  const current = scenarios.find((s) => s.id === scenarioId) ?? null;
  const [name, setName] = useState(current?.name ?? "Scenario A");
  const [design, setDesign] = useState<ExpansionDesign>(current?.design ?? defaultDesign);
  const [overrides, setOverrides] = useState<Record<string, number>>(current?.overrides ?? {});
  const [result, setResult] = useState<ExpansionResult | null>(current?.result ?? null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"constraints" | "outputs" | "costs" | "timeline" | "assumptions" | "trace" | "compare">("constraints");
  const [showOverrides, setShowOverrides] = useState(false);
  const set = (patch: Partial<ExpansionDesign>) => setDesign((d) => ({ ...d, ...patch }));
  const pick = (s: ScenarioRow | null) => { setScenarioId(s?.id ?? null); setName(s?.name ?? `Scenario ${String.fromCharCode(65 + scenarios.length)}`); setDesign(s?.design ?? defaultDesign); setOverrides(s?.overrides ?? {}); setResult(s?.result ?? null); setError(null); };
  const run = () => start(async () => {
    setError(null);
    try {
      let id = scenarioId;
      if (!id) { id = await saveScenario(program.id, { name, design, overrides }); setScenarioId(id); }
      else await saveScenario(program.id, { id, name, design, overrides });
      const r = await evaluateExpansion(program.id, design, overrides, id);
      setResult(r); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  });
  const remove = () => start(async () => { if (!scenarioId || !confirm(`Delete scenario "${name}"?`)) return; await deleteScenario(scenarioId, program.id); pick(null); router.refresh(); });
  const recommend = () => start(async () => { if (!scenarioId) return; await setScenarioStatus(scenarioId, program.id, current?.status === "recommended" ? "draft" : "recommended"); router.refresh(); });
  const kindDef = EXPANSION_KINDS.find((k) => k.kind === design.kind)!;
  const compared = useMemo(() => scenarios.filter((s) => s.result), [scenarios]);
  const r = result;

  return (
    <div className="space-y-4">
      {/* Scenarios */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-slate-500">Scenarios:</span>
        {scenarios.map((s) => <button key={s.id} onClick={() => pick(s)} className={`rounded-full px-2.5 py-1 font-medium ${s.id === scenarioId ? "bg-rose-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-rose-300"}`}>{s.name}{s.status === "recommended" ? " ★" : ""}{s.result ? (s.result.feasible ? " · feasible" : " · not feasible") : " · not evaluated"}</button>)}
        <button onClick={() => pick(null)} className={`rounded-full px-2.5 py-1 font-medium ${scenarioId == null ? "bg-rose-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-rose-300"}`}>+ new</button>
        {compared.length > 1 && <button onClick={() => setTab("compare")} className="ml-auto rounded-full bg-slate-800 px-2.5 py-1 font-medium text-white">Compare {compared.length} evaluated</button>}
      </div>

      {/* The question */}
      <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="block lg:col-span-1"><span className={lbl}>Scenario name</span><input value={name} onChange={(e) => setName(e.target.value)} className={inp + " w-full"} /></label>
          <label className="block"><span className={lbl}>Workforce target (productive workers a year)</span><input type="number" min={0} value={numInput(design.targetWorkers)} onChange={(e) => set({ targetWorkers: Number(e.target.value) || 0 })} className={inp + " w-full"} /></label>
          <label className="block"><span className={lbl}>By year</span><input type="number" min={2026} max={2040} value={design.targetYear} onChange={(e) => set({ targetYear: Number(e.target.value) || design.targetYear })} className={inp + " w-full"} /></label>
          <label className="block"><span className={lbl}>Design</span><select value={design.kind} onChange={(e) => set({ kind: e.target.value as ExpansionDesign["kind"], needsApproval: e.target.value === "additional-campus" ? true : design.needsApproval })} className={inp + " w-full"}>{EXPANSION_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select><span className="block text-[11px] text-slate-500">{kindDef.hint}</span></label>
          {design.kind !== "improve-retention" && <>
            <label className="block"><span className={lbl}>{design.kind === "larger-cohort" ? "Seats added" : "Seats per cohort"}</span><input type="number" min={1} max={200} value={design.seats} onChange={(e) => set({ seats: Number(e.target.value) || 0 })} className={inp + " w-full"} /></label>
            <label className="block"><span className={lbl}>First cohort starts</span><input type="date" value={design.startIso} onChange={(e) => set({ startIso: e.target.value || design.startIso })} className={inp + " w-full"} /></label>
            <label className="block"><span className={lbl}>Cohorts a year after that</span><select value={design.cohortsPerYear} onChange={(e) => set({ cohortsPerYear: Number(e.target.value) })} className={inp + " w-full"}><option value={0}>one cohort only</option><option value={1}>one a year</option><option value={2}>two a year</option><option value={3}>three a year</option></select></label>
          </>}
          {design.kind === "accelerated" && <label className="block"><span className={lbl}>Term length vs template</span><select value={design.paceFactor} onChange={(e) => set({ paceFactor: Number(e.target.value) })} className={inp + " w-full"}><option value={1}>same</option><option value={0.75}>25% shorter</option><option value={0.5}>half</option></select></label>}
          {design.kind === "hybrid" && <label className="block"><span className={lbl}>Class hours online</span><select value={design.onlineShare} onChange={(e) => set({ onlineShare: Number(e.target.value) })} className={inp + " w-full"}><option value={0.25}>a quarter</option><option value={0.5}>half</option><option value={0.75}>three quarters</option></select></label>}
          {design.kind === "improve-retention" && <label className="block"><span className={lbl}>Completion rate uplift</span><select value={design.retentionUplift} onChange={(e) => set({ retentionUplift: Number(e.target.value) })} className={inp + " w-full"}><option value={0.05}>+5 points</option><option value={0.1}>+10 points</option><option value={0.15}>+15 points</option></select></label>}
          {(design.kind === "expanded-geography" || design.kind === "shared-regional") && (
            <div className="block md:col-span-2"><span className={lbl}>Sites assumed secured for this scenario</span>
              <div className="mt-1 flex flex-wrap gap-1">{sitePicks.length === 0 && <span className="text-xs text-slate-500">every site with assets is already secured</span>}{sitePicks.map((s) => { const on = design.assumedSecuredSiteIds.includes(s.employerId); return <button key={s.employerId} type="button" aria-pressed={on} onClick={() => set({ assumedSecuredSiteIds: on ? design.assumedSecuredSiteIds.filter((x) => x !== s.employerId) : [...design.assumedSecuredSiteIds, s.employerId] })} className={`rounded-full px-2 py-0.5 text-[11px] ${on ? "bg-emerald-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>{s.name} <span className="opacity-70">({s.agreementStatus} · {s.assets} assets)</span></button>; })}</div>
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={design.needsApproval} onChange={(e) => set({ needsApproval: e.target.checked })} /> needs program, location or accreditor approval (adds that lead time)</label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={run} disabled={pending} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60">{pending ? "Evaluating…" : result ? "Re-evaluate and save" : "Evaluate and save"}</button>
          <button onClick={() => setShowOverrides((v) => !v)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700" aria-expanded={showOverrides}>Assumption overrides{Object.keys(overrides).length ? ` (${Object.keys(overrides).length})` : ""}</button>
          {scenarioId && <button onClick={recommend} disabled={pending} className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm text-emerald-800">{current?.status === "recommended" ? "★ Recommended — unmark" : "Mark as the recommended scenario"}</button>}
          {scenarioId && <button onClick={remove} disabled={pending} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">Delete</button>}
          <Link href={`/orgs/${program.institutionId}/assumptions?scope=${encodeURIComponent(`program:${program.id}`)}`} className="ml-auto text-sm text-rose-700 hover:underline">Assumption registry ({assumptionRowCount} set) →</Link>
        </div>
        {showOverrides && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs">
            <div className="mb-1 text-slate-600">Override any assumption for this scenario only — the registry and the operating plan are untouched. Blank = use the registry&apos;s value.</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {ASSUMPTION_DEFS.map((d) => <label key={d.key} className="block"><span className="block truncate text-[10px] text-slate-500" title={d.label}>{d.label} ({d.unit})</span><input type="number" step="any" value={overrides[d.key] ?? ""} placeholder={String(d.value)} onChange={(e) => setOverrides((o) => { const c = { ...o }; if (e.target.value === "") delete c[d.key]; else c[d.key] = Number(e.target.value); return c; })} aria-label={`Override ${d.label}`} className="w-full rounded border border-slate-300 px-1.5 py-0.5 text-xs" /></label>)}
            </div>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-rose-700">Could not evaluate: {error}</p>}
      </div>

      {/* The answer */}
      {!r && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Set the target and the design, then evaluate. The answer is one sentence, then what binds and why.</p>}
      {r && tab !== "compare" && (
        <div className="space-y-3">
          <div className={`rounded-2xl border p-5 shadow-sm ${r.feasible ? "border-emerald-200 bg-emerald-50/50" : "border-rose-200 bg-rose-50/50"}`}>
            <p className="text-base font-medium leading-relaxed text-slate-900">{r.headline}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Tile label="Additional productive workers a year" v={n(Math.round(r.outputs.additionalAnnualProductive))} sub={`${n(Math.round(r.outputs.additionalAnnualEnrollment))} enrolled → ${n(Math.round(r.outputs.additionalAnnualCompletions))} completing → ${n(Math.round(r.outputs.additionalAnnualLicensed))} licensed → ${n(Math.round(r.outputs.additionalAnnualPlaced))} placed`} strong />
              <Tile label="First workers enter" v={r.outputs.firstYearWorkersEnter ? String(r.outputs.firstYearWorkersEnter) : "—"} sub={r.cohorts[0] ? `cohort 1 ends ${fmtD(r.cohorts[0].endIso)}, productive ${fmtD(r.cohorts[0].productiveByIso)}` : "no new cohort"} />
              <Tile label="Faculty added" v={`${n(r.outputs.facultyFteAdded)} FTE`} sub={`${r.outputs.facultyPeopleAdded} people at the peak week`} />
              <Tile label="Preceptors added" v={`${r.outputs.preceptorPeopleAdded} people`} sub={`${n(r.outputs.preceptorFteAdded)} FTE at the peak week`} />
              <Tile label="Clinical learner-shifts a year" v={n(r.outputs.learnerShifts)} sub={r.outputs.settingsNeeded.join(", ") || "no clinical"} />
              <Tile label="Cost per additional placed worker" v={money(r.costs.perAdditionalPlaced)} sub={`${money(r.costs.recurring)} a year recurring · ${money(r.costs.oneTime)} one-time`} tone={r.confidence.unverified.length ? "amber" : undefined} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
              <span className={`rounded-full px-2 py-0.5 font-medium ${r.confidence.verified === r.confidence.used ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>confidence: {r.confidence.verified} of {r.confidence.used} assumptions verified</span>
              {r.outputs.currentMaxFeasibleSeats != null && <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200">largest cohort feasible today: <strong>{r.outputs.currentMaxFeasibleSeats}</strong> seats</span>}
              {!r.feasibleInTime && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-800">earliest feasible start {fmtD(r.earliestStartIso)}</span>}
              {r.confidence.risks.slice(0, 2).map((x) => <span key={x} className="rounded-full bg-white px-2 py-0.5 ring-1 ring-amber-200">{x}</span>)}
            </div>
          </div>

          <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-slate-300 text-sm">
            {([["constraints", `What binds (${r.constraints.filter((c) => c.severity === "binding" || c.severity === "secondary").length})`], ["outputs", "What it adds"], ["costs", "Costs"], ["timeline", "Timeline & owners"], ["assumptions", `Assumptions (${r.assumptionsUsed.length})`], ["trace", "Trace to courses & shifts"], ["compare", "Compare scenarios"]] as [typeof tab, string][]).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 ${tab === k ? "bg-rose-600 font-medium text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{l}</button>)}
          </div>

          {tab === "constraints" && (
            <ul className="space-y-1.5">
              {r.constraints.map((c, i) => (
                <li key={`${c.kind}-${i}`} className={`rounded-lg border px-3 py-2 ${SEV[c.severity].row}`}>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SEV[c.severity].chip}`}>{SEV[c.severity].label}</span>
                    <span className="font-medium text-slate-800">{c.label}</span>
                    {c.demand != null && <span className="tabular-nums text-slate-700">{n(c.demand)}{c.supply != null ? ` vs ${n(c.supply)}` : ""} {c.unit}</span>}
                    {c.where && <span className="text-slate-500">· {c.where}</span>}
                    <span className={`ml-auto text-[10px] ${EVIDENCE[c.evidence]}`}>inputs {c.evidence}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-700">{c.detail}</div>
                  {c.fix !== "none needed" && <div className="mt-0.5 text-xs text-slate-800"><span className="font-medium">Fix:</span> {c.fix}</div>}
                </li>
              ))}
            </ul>
          )}

          {tab === "outputs" && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
                <div className="mb-1 text-sm font-semibold text-slate-800">The pipeline the target needs, worked backward</div>
                {design.targetWorkers > 0 ? <table className="w-full"><tbody>{([["Fully productive workers", r.outputs.required.productive], ["Regional placements", r.outputs.required.placed], ["License passers", r.outputs.required.licensed], ["Completers", r.outputs.required.completing], ["Enrolled students (seats a year)", r.outputs.required.enrolled], ["Offers", r.outputs.required.offered], ["Qualified applicants", r.outputs.required.qualified], ["Interested candidates", r.outputs.required.interested]] as [string, number][]).map(([k, v]) => <tr key={k} className="border-t border-slate-100"><td className="py-1 text-slate-700">{k}</td><td className="py-1 text-right tabular-nums font-medium text-slate-900" title={fmt.calcTitle(v, fmt.atLeastPhrase(v))}>{fmt.atLeastPhrase(v)}</td></tr>)}</tbody></table> : <p className="text-slate-500">No workforce target set.</p>}
                <p className="mt-2 text-slate-600">Offerings already planned for {design.targetYear} cover {n(Math.round(r.outputs.baselineAnnualProductive))} productive workers; this design adds {n(Math.round(r.outputs.additionalAnnualProductive))} at steady state.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
                <div className="mb-1 text-sm font-semibold text-slate-800">What the design adds each year at steady state</div>
                <table className="w-full"><tbody>{([["Enrollment", r.outputs.additionalAnnualEnrollment, "seats"], ["Completions", r.outputs.additionalAnnualCompletions, ""], ["Licensure passers", r.outputs.additionalAnnualLicensed, ""], ["Regional placements", r.outputs.additionalAnnualPlaced, ""], ["Productive workers", r.outputs.additionalAnnualProductive, ""], ["Faculty", r.outputs.facultyFteAdded, `FTE · ${r.outputs.facultyPeopleAdded} people`], ["Preceptors", r.outputs.preceptorFteAdded, `FTE · ${r.outputs.preceptorPeopleAdded} people`], ["Clinical learner-shifts", r.outputs.learnerShifts, r.outputs.settingsNeeded.join(", ")], ["Room-hours in the peak week", r.outputs.roomHoursPerWeekPeak, "class and lab"], ["Student support seats", r.outputs.studentSupportSeats, ""]] as [string, number, string][]).map(([k, v, u]) => <tr key={k} className="border-t border-slate-100"><td className="py-1 text-slate-700">{k}</td><td className="py-1 text-right tabular-nums font-medium text-slate-900">{n(v)}</td><td className="py-1 pl-2 text-slate-500">{u}</td></tr>)}</tbody></table>
                {r.outputs.sitesNeeded.length > 0 && <p className="mt-2 text-amber-800">Sites whose agreement would be needed: {r.outputs.sitesNeeded.join(", ")}.</p>}
              </div>
            </div>
          )}

          {tab === "costs" && (
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
              <table className="w-full"><thead className="text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="py-1 text-left">Category</th><th className="py-1 text-right">One-time</th><th className="py-1 text-right">Recurring / yr</th><th className="py-1 text-left pl-3">Basis</th></tr></thead>
                <tbody>{r.costs.lines.map((l) => <tr key={l.category} className="border-t border-slate-100"><td className="py-1 text-slate-800">{l.category}</td><td className="py-1 text-right tabular-nums">{money(l.oneTime)}</td><td className="py-1 text-right tabular-nums">{money(l.recurring)}</td><td className="py-1 pl-3 text-slate-600">{l.basis} <span className="text-slate-400">({l.assumptionKeys.map((k) => r.assumptionsUsed.find((a) => a.key === k)?.status ?? "default").join(", ")})</span></td></tr>)}
                  <tr className="border-t border-slate-300 font-medium"><td className="py-1">Total</td><td className="py-1 text-right tabular-nums">{money(r.costs.oneTime)}</td><td className="py-1 text-right tabular-nums">{money(r.costs.recurring)}</td><td className="py-1 pl-3 text-slate-600">annualized incl. one-time over useful life: {money(r.costs.annualized)}</td></tr></tbody></table>
              <div className="mt-2 grid gap-2 sm:grid-cols-2"><Tile label="Cost per additional completer" v={money(r.costs.perAdditionalCompleter)} sub="annualized cost ÷ additional completions a year" /><Tile label="Cost per additional placed worker" v={money(r.costs.perAdditionalPlaced)} sub="annualized cost ÷ additional regional placements a year" /></div>
              {r.costs.lines.length === 0 && <p className="text-slate-500">Nothing binds, so no purchase is costed beyond what the design adds — set the college&apos;s own figures in the registry to cost the added seats.</p>}
            </div>
          )}

          {tab === "timeline" && (
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
              <div className="mb-1 text-sm font-semibold text-slate-800">Milestones and owners <span className="font-normal text-slate-500">— counted back from {fmtD(r.feasibleInTime ? r.proposedStartIso : r.earliestStartIso)}{!r.feasibleInTime ? " (the earliest feasible start, not the proposed one)" : ""}</span></div>
              <table className="w-full"><tbody>{r.milestones.map((m, i) => <tr key={i} className={`border-t border-slate-100 ${m.lateIfAfter ? "bg-rose-50/50" : ""}`}><td className="py-1 tabular-nums text-slate-700">{fmtD(m.iso)}</td><td className="py-1 pl-3 text-slate-800">{m.what}{m.lateIfAfter && <span className="ml-1 rounded bg-rose-100 px-1 text-[10px] text-rose-800">already past</span>}</td><td className="py-1 pl-3 text-slate-600">{m.owner}</td></tr>)}</tbody></table>
              <div className="mt-2 text-slate-600">Proposed cohorts: {r.cohorts.map((c) => `${c.label}: ${c.terms.map((t) => `${t.name} ${fmtD(t.startIso)}–${fmtD(t.endIso)}`).join(" · ")}`).join(" | ") || "none"}</div>
            </div>
          )}

          {tab === "assumptions" && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">Assumption the answer used</th><th className="px-2 py-1.5 text-right">Value</th><th className="px-2 py-1.5 text-left">Comes from</th><th className="px-2 py-1.5 text-left">Source</th><th className="px-2 py-1.5 text-left">Owner</th><th className="px-2 py-1.5 text-left">Status</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{r.assumptionsUsed.map((a) => <tr key={a.key} className={a.stale ? "bg-amber-50/30" : ""}><td className="px-3 py-1.5 text-slate-800">{a.label}</td><td className="px-2 py-1.5 text-right tabular-nums">{a.unit === "share" ? fmt.pct(a.value) : `${dec(a.value)} ${a.unit}`}</td><td className="px-2 py-1.5 text-slate-600">{a.origin}</td><td className="px-2 py-1.5 text-slate-600">{a.source}</td><td className="px-2 py-1.5 text-slate-600">{a.owner ?? "—"}</td><td className="px-2 py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${a.status === "verified" ? "bg-emerald-100 text-emerald-800" : a.status === "estimate" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{a.status}{a.stale ? " · past review" : ""}</span></td></tr>)}</tbody></table>
              <p className="px-3 py-2 text-[11px] text-slate-500">Set the college&apos;s own figures in the <Link href={`/orgs/${program.institutionId}/assumptions?scope=${encodeURIComponent(`program:${program.id}`)}`} className="text-rose-700 hover:underline">assumption registry</Link>; the confidence figure counts only verified ones.</p>
            </div>
          )}

          {tab === "trace" && (
            <div className="space-y-2">
              {r.trace.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500">No new cohort in this design.</p>}
              {r.trace.map((t) => { const c = r.cohorts.find((x) => x.id === t.cohortId)!; return (
                <div key={t.cohortId} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">{c.label} <span className="font-normal text-slate-500">— {c.seats} seats · {c.terms.map((x) => `${x.name} ${fmtD(x.startIso)}–${fmtD(x.endIso)} (${x.source})`).join(" · ")}</span></div>
                  <table className="w-full text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">Term · course</th><th className="px-2 py-1.5 text-right">Sessions</th><th className="px-2 py-1.5 text-right">Faculty hours</th><th className="px-2 py-1.5 text-right">Learner-shifts</th><th className="px-2 py-1.5 text-left">By setting</th><th className="px-2 py-1.5 text-right">Preceptor-shifts</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">{t.courses.map((x) => <tr key={`${x.termIndex}-${x.code}`}><td className="px-3 py-1"><span className="text-slate-500">T{x.termIndex}</span> <span className="font-mono text-slate-700">{x.code}</span> <span className="text-slate-600">{x.name}</span></td><td className="px-2 py-1 text-right tabular-nums">{x.sessions}</td><td className="px-2 py-1 text-right tabular-nums">{n(x.facultyHours)}</td><td className="px-2 py-1 text-right tabular-nums">{n(x.learnerShifts)}</td><td className="px-2 py-1 font-mono text-[10px] text-slate-600">{Object.entries(x.bySetting).map(([k, v]) => `${k} ${n(v)}`).join(" · ")}</td><td className="px-2 py-1 text-right tabular-nums">{n(x.preceptorShifts)}</td></tr>)}</tbody></table>
                  {c.warnings.length > 0 && <div className="px-3 py-1.5 text-[11px] text-amber-800">{c.warnings.join(" · ")}</div>}
                </div>
              ); })}
            </div>
          )}

          <details className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <summary className="cursor-pointer font-medium text-slate-700">Executive summary — copy into the proposal</summary>
            <p className="mt-2 whitespace-pre-wrap leading-relaxed text-slate-800">{r.summary}</p>
          </details>
        </div>
      )}

      {tab === "compare" && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-sm"><span className="font-semibold text-slate-800">Compare scenarios</span>{r && <button onClick={() => setTab("constraints")} className="text-xs text-rose-700 hover:underline">← back to {name}</button>}</div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">Scenario</th><th className="px-2 py-1.5 text-left">Design</th><th className="px-2 py-1.5 text-left">Feasible</th><th className="px-2 py-1.5 text-left">Binds first</th><th className="px-2 py-1.5 text-right">Workers / yr</th><th className="px-2 py-1.5 text-right">First year</th><th className="px-2 py-1.5 text-right">Faculty</th><th className="px-2 py-1.5 text-right">Preceptors</th><th className="px-2 py-1.5 text-right">Recurring / yr</th><th className="px-2 py-1.5 text-right">One-time</th><th className="px-2 py-1.5 text-right">$ / placed</th><th className="px-2 py-1.5 text-right">Confidence</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {compared.map((s) => { const x = s.result!; return (
                <tr key={s.id} className={s.status === "recommended" ? "bg-emerald-50/40" : ""}>
                  <td className="px-3 py-1.5 font-medium text-slate-800"><button onClick={() => { pick(s); setTab("constraints"); }} className="hover:text-rose-700 hover:underline">{s.name}</button>{s.status === "recommended" ? " ★" : ""}</td>
                  <td className="px-2 py-1.5 text-slate-600">{EXPANSION_KINDS.find((k) => k.kind === s.design.kind)?.label} · {s.design.seats} seats · {s.design.startIso}</td>
                  <td className="px-2 py-1.5">{x.feasible ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">yes</span> : <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-800">no</span>}</td>
                  <td className="px-2 py-1.5 text-slate-700">{x.binding ? `${x.binding.label}${x.binding.where ? ` · ${x.binding.where}` : ""}` : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n(Math.round(x.outputs.additionalAnnualProductive))}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{x.outputs.firstYearWorkersEnter ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n(x.outputs.facultyFteAdded)} FTE · {x.outputs.facultyPeopleAdded}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{x.outputs.preceptorPeopleAdded}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(x.costs.recurring)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(x.costs.oneTime)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(x.costs.perAdditionalPlaced)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{x.confidence.verified}/{x.confidence.used}</td>
                </tr>
              ); })}
            </tbody>
          </table>
          {compared.length < 2 && <p className="px-3 py-2 text-xs text-slate-500">Evaluate at least two scenarios to compare them.</p>}
        </div>
      )}
    </div>
  );
}

function Tile({ label, v, sub, strong, tone }: { label: string; v: string; sub?: string; strong?: boolean; tone?: "amber" }) {
  const bg = strong ? "bg-slate-800 text-white" : tone === "amber" ? "bg-amber-50 text-amber-900" : "bg-white text-slate-800 ring-1 ring-slate-200";
  return (
    <div className={`rounded-lg p-2.5 ${bg}`}>
      <div className={`text-[10px] uppercase tracking-wide ${strong ? "text-slate-300" : "text-slate-500"}`}>{label}</div>
      <div className="text-xl font-bold leading-tight tabular-nums">{v}</div>
      {sub && <div className={`truncate text-[10px] ${strong ? "text-slate-200" : "text-slate-600"}`} title={sub}>{sub}</div>}
    </div>
  );
}
