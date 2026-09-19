"use client";

// The assumption registry table (Phase 9): every planning assumption at one scope — its resolved
// value and where it came from, and a row editor to set this scope's own figure with source, owner,
// status and review date. A default is shown as a default; nothing here reads as verified until
// someone says it is.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveAssumption, deleteAssumption } from "@/lib/actions";
import type { AssumptionDef, ResolvedAssumption, AssumptionRow } from "@/lib/assumptions";
import { dec, fmt } from "@/lib/format";

const CATEGORY_LABEL: Record<string, string> = { rates: "Pipeline rates", timing: "Lags to a productive worker", "lead-time": "Lead times", cost: "Costs", workload: "Workload and supervision" };
const ORIGIN_LABEL: Record<string, string> = { default: "default", global: "workspace", institution: "college", family: "job family", program: "program", scenario: "scenario" };
const STATUS_TONE: Record<string, string> = { default: "bg-slate-100 text-slate-600", estimate: "bg-amber-100 text-amber-800", verified: "bg-emerald-100 text-emerald-800" };
const show = (v: number, unit: string) => unit === "share" ? fmt.pct(v) : unit.startsWith("$") ? `$${fmt.num(v)}${unit.slice(1) ? ` ${unit.slice(1)}` : ""}` : `${dec(v)} ${unit}`;

export function AssumptionRegistry({ defs, resolved, own, scope, scopes, back }: { defs: AssumptionDef[]; resolved: ResolvedAssumption[]; own: Record<string, AssumptionRow>; scope: string; scopes: { value: string; label: string }[]; back: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const byKey = new Map(resolved.map((r) => [r.key, r]));
  const categories = [...new Set(defs.map((d) => d.category))];
  const inp = "rounded border border-slate-300 px-1.5 py-1 text-xs";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2"><span className="text-slate-500">Scope</span>
          <select value={scope} onChange={(e) => router.push(`${back.split("?")[0]}?scope=${encodeURIComponent(e.target.value)}`)} aria-label="Assumption scope" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">{scopes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        </label>
        <span className="text-xs text-slate-500">{Object.keys(own).length} of {defs.length} set at this scope · the rest resolve from a wider scope or the default</span>
      </div>
      {categories.map((cat) => (
        <div key={cat} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">{CATEGORY_LABEL[cat] ?? cat}</div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">Assumption</th><th className="px-2 py-1.5 text-right">Value</th><th className="px-2 py-1.5 text-right">Range</th><th className="px-2 py-1.5 text-left">Comes from</th><th className="px-2 py-1.5 text-left">Source</th><th className="px-2 py-1.5 text-left">Owner</th><th className="px-2 py-1.5 text-left">Status</th><th className="px-2 py-1.5 text-left">Review by</th><th className="px-2 py-1.5"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {defs.filter((d) => d.category === cat).map((d) => {
                const r = byKey.get(d.key)!; const mine = own[d.key];
                if (editing === d.key) return (
                  <tr key={d.key} className="bg-sky-50/40"><td colSpan={9} className="px-3 py-2">
                    <form action={saveAssumption} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="scope" value={scope} /><input type="hidden" name="key" value={d.key} /><input type="hidden" name="back" value={back} />
                      <span className="basis-full text-sm font-medium text-slate-800">{d.label} <span className="text-slate-500">({d.unit})</span></span>
                      <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Value</span><input name="value" type="number" step="any" defaultValue={mine?.value ?? r.value} required aria-label={`Value of ${d.label}`} className={inp + " w-28 text-right"} /></label>
                      <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Low</span><input name="low" type="number" step="any" defaultValue={mine?.low ?? r.low} aria-label={`Low estimate of ${d.label}`} className={inp + " w-24 text-right"} /></label>
                      <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">High</span><input name="high" type="number" step="any" defaultValue={mine?.high ?? r.high} aria-label={`High estimate of ${d.label}`} className={inp + " w-24 text-right"} /></label>
                      <label className="block min-w-[14rem] flex-1"><span className="block text-[9px] font-semibold uppercase text-slate-500">Source</span><input name="source" defaultValue={mine?.source ?? ""} placeholder="where the figure comes from" aria-label={`Source of ${d.label}`} className={inp + " w-full"} /></label>
                      <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Owner</span><input name="owner" defaultValue={mine?.owner ?? ""} placeholder="who answers for it" aria-label={`Owner of ${d.label}`} className={inp + " w-36"} /></label>
                      <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Status</span><select name="status" defaultValue={mine?.status ?? "estimate"} aria-label={`Status of ${d.label}`} className={inp}><option value="estimate">estimate</option><option value="verified">verified</option></select></label>
                      <label className="block"><span className="block text-[9px] font-semibold uppercase text-slate-500">Review by</span><input name="reviewBy" type="date" defaultValue={mine?.reviewBy ?? ""} aria-label={`Review date for ${d.label}`} className={inp} /></label>
                      <button className="rounded bg-rose-600 px-3 py-1.5 text-xs font-medium text-white" aria-label={`Save ${d.label}`}>Save</button>
                      <button type="button" onClick={() => setEditing(null)} className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700">Cancel</button>
                      {mine && <button type="button" onClick={() => { if (confirm(`Remove this scope's own value for "${d.label}"? It will resolve from a wider scope or the default.`)) void deleteAssumption(scope, d.key, back); }} className="ml-auto text-xs text-slate-500 hover:text-rose-700" aria-label={`Remove this scope's value for ${d.label}`}>remove this scope&apos;s value</button>}
                    </form>
                  </td></tr>
                );
                return (
                  <tr key={d.key} className={r.stale ? "bg-amber-50/30" : ""}>
                    <td className="px-3 py-1.5"><span className="font-medium text-slate-800">{d.label}</span>{d.note && <span className="block text-[10px] text-slate-500">{d.note}</span>}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-900">{show(r.value, d.unit)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{show(r.low, d.unit)} – {show(r.high, d.unit)}</td>
                    <td className="px-2 py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${r.origin === "default" ? "bg-slate-100 text-slate-600" : "bg-sky-100 text-sky-800"}`}>{ORIGIN_LABEL[r.origin]}</span></td>
                    <td className="px-2 py-1.5 text-slate-600">{r.source}</td>
                    <td className="px-2 py-1.5 text-slate-600">{r.owner ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-2 py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_TONE[r.status]}`}>{r.status}{r.verifiedAt ? ` ${r.verifiedAt}` : ""}</span></td>
                    <td className="px-2 py-1.5 text-slate-600">{r.reviewBy ?? "—"}{r.stale && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">past due</span>}</td>
                    <td className="px-2 py-1.5 text-right"><button type="button" onClick={() => setEditing(d.key)} aria-label={`Set ${d.label} at this scope`} className="rounded border border-slate-300 px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50">{mine ? "edit" : "set here"}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
