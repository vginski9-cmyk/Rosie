import Link from "next/link";
import { updateRequirementSet, updateRequirementItem } from "@/lib/actions";
import type { getFamilyRequirements } from "@/lib/queries";
import { dec } from "@/lib/format";

// WHAT COMPLETION REQUIRES for a job family — the credentialing / accrediting body's
// rules and items — and, for every category, which settings supply it and which
// sites in the network can (secured, asked, none), with seats and the nearest
// secured drive. Starter content from the public standard until the program marks
// it verified; every item's settings are editable here. Server component.

type Req = NonNullable<Awaited<ReturnType<typeof getFamilyRequirements>>>;
const VERDICT: Record<string, { tone: string; label: string }> = {
  covered: { tone: "bg-emerald-100 text-emerald-700", label: "secured site can supply it" },
  "asked-only": { tone: "bg-amber-100 text-amber-700", label: "only a site still being asked" },
  "prospect-only": { tone: "bg-rose-100 text-rose-700", label: "only a prospect — no agreement" },
  none: { tone: "bg-rose-100 text-rose-700", label: "no site in the network has the setting" },
  "n/a": { tone: "bg-slate-100 text-slate-500", label: "not a clinical setting" },
};
const inp = "rounded border border-slate-300 px-1.5 py-0.5 text-xs";

export function RequirementsPanel({ req, compact = false }: { req: Req; compact?: boolean }) {
  if (!req.sets.length) return <p className="text-xs text-slate-400">No requirement set is loaded for {req.family.name} yet.</p>;
  return (
    <div className="space-y-5">
      {req.sets.map((set) => (
        <div key={set.id} className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900">{set.name} <span className="font-normal text-slate-500">— {set.authority}</span></div>
              <div className="text-[11px] text-slate-500">{set.edition}{set.sourceUrl ? <> · <a href={set.sourceUrl} target="_blank" rel="noreferrer" className="text-rose-600 hover:underline">source</a></> : null}</div>
              {set.summary && <p className="mt-1 max-w-4xl text-xs text-slate-700">{set.summary}</p>}
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${set.verified ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{set.verified ? "verified against the current edition" : "starter content — verify against the current edition"}</span>
          </div>

          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {set.rules.map((r) => <span key={r.key} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700" title={r.notes ?? ""}>{r.label}{r.min != null ? <>: <strong className="tabular-nums">{r.min}</strong>{r.of != null ? ` of ${r.of}` : ""}</> : null}{r.notes ? <span className="text-slate-400"> · {r.notes.length > 60 ? r.notes.slice(0, 57) + "…" : r.notes}</span> : null}</span>)}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{set.mandatory} mandatory · {set.elective} elective items in {set.categories} categories</span>
            {set.uncovered.length > 0 ? <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-700">⚠ no secured or asked site for: {set.uncovered.join(", ")}</span> : <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">✓ every clinical category has a site in the network</span>}
            {set.askedOnly.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">only asked sites for: {set.askedOnly.join(", ")}</span>}
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-3 py-1.5 text-left">Category</th><th className="px-2 py-1.5 text-right">Items</th><th className="px-2 py-1.5 text-left">Settings that supply it</th><th className="px-2 py-1.5 text-left">Secured sites · seats/day</th><th className="px-2 py-1.5 text-left">Asked</th><th className="px-2 py-1.5 text-right">Nearest secured</th><th className="px-2 py-1.5 text-left">Verdict</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {set.coverage.map((c) => (
                  <tr key={c.category} className={c.verdict === "none" || c.verdict === "prospect-only" ? "bg-rose-50/40" : c.verdict === "asked-only" ? "bg-amber-50/30" : ""}>
                    <td className="px-3 py-1.5 font-medium text-slate-800">{c.category}{!compact && <details className="mt-0.5 font-normal"><summary className="cursor-pointer text-[10px] text-slate-400">{c.items.length} item{c.items.length === 1 ? "" : "s"}</summary><ul className="mt-1 space-y-1">{c.items.map((i) => <li key={i.id} className="text-[11px]"><form action={updateRequirementItem.bind(null, i.id)} className="flex flex-wrap items-center gap-1"><span className={i.mandatory ? "text-slate-800" : "text-slate-500"}>{i.name}</span>{i.role && <span className="text-slate-400">· {i.role}</span>}<label className="ml-1 flex items-center gap-0.5 text-[10px] text-slate-500"><input name="mandatory" type="checkbox" defaultChecked={i.mandatory} />mandatory</label><input name="settingCodes" defaultValue={i.settingCodes} className={inp + " w-28"} title="asset settings that supply it (csv)" />{set.kind === "cases" && <input name="minCount" type="number" min="0" step="1" defaultValue={i.minCount ?? ""} placeholder="min" className={inp + " w-14"} />}{set.kind === "cases" && <input name="role" defaultValue={i.role ?? ""} placeholder="role" className={inp + " w-24"} />}<input name="notes" defaultValue={i.notes ?? ""} placeholder="notes" className={inp + " w-32"} /><button className="rounded bg-slate-200 px-1 text-[10px] text-slate-700">save</button></form></li>)}</ul></details>}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{c.mandatory > 0 && <span className="font-semibold">{c.mandatory} req</span>}{c.mandatory > 0 && c.elective > 0 ? " · " : ""}{c.elective > 0 && <span className="text-slate-500">{c.elective} elec</span>}</td>
                    <td className="px-2 py-1.5">{c.settings.length ? c.settings.map((s) => <span key={s} className="mr-1 rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-700">{s}</span>) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-1.5 text-slate-700">{c.sites.secured.length ? <>{c.sites.secured.length} site{c.sites.secured.length === 1 ? "" : "s"} · <span className="tabular-nums">{c.seatsSecured}</span> seats<span className="block text-[10px] text-slate-400">{c.sites.secured.slice(0, 4).map((s) => s.name.replace(/ — .*$/, "").slice(0, 26)).join(", ")}{c.sites.secured.length > 4 ? ` +${c.sites.secured.length - 4}` : ""}</span></> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-1.5 text-slate-600">{c.sites.asked.length ? `${c.sites.asked.length} · ${c.seatsAsked} seats` : <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{c.nearestSecuredMinutes != null ? `${dec(Math.round(c.nearestSecuredMinutes))} min` : "—"}</td>
                    <td className="px-2 py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${VERDICT[c.verdict].tone}`}>{VERDICT[c.verdict].label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!compact && (
            <form action={updateRequirementSet.bind(null, set.id)} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2 text-xs">
              <label className="flex items-center gap-1"><input name="verified" type="checkbox" defaultChecked={set.verified} /> verified against the current edition</label>
              <label className="block min-w-[18rem] flex-1"><span className="block text-[9px] font-semibold uppercase text-slate-500">Edition / source note</span><input name="edition" defaultValue={set.edition ?? ""} className={inp + " w-full"} /></label>
              <label className="block min-w-[14rem]"><span className="block text-[9px] font-semibold uppercase text-slate-500">Source URL</span><input name="sourceUrl" defaultValue={set.sourceUrl ?? ""} className={inp + " w-full"} /></label>
              <label className="block min-w-[16rem] flex-1"><span className="block text-[9px] font-semibold uppercase text-slate-500">Program notes</span><input name="notes" defaultValue={set.notes ?? ""} placeholder="how this program logs and verifies (Trajecsys, paper logs, sign-off by …)" className={inp + " w-full"} /></label>
              <input type="hidden" name="summary" value={set.summary ?? ""} />
              <button className="rounded bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-white">Save</button>
            </form>
          )}
        </div>
      ))}
      {!compact && <p className="text-[11px] text-slate-400">Seats/day are the assets&apos; learners per shift in the category&apos;s settings, summed over sites with that agreement. A category with no secured site is a placement gap for every student; fix it in the supply map (add the asset or the site) or the agreements. <Link href="/employers" className="text-rose-600 hover:underline">Sites →</Link></p>}
    </div>
  );
}
