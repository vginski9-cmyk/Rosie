import Link from "next/link";
import { updateRequirementSet, updateRequirementItem } from "@/lib/actions";
import type { getFamilyRequirements } from "@/lib/queries";
import { dec } from "@/lib/format";

// WHAT COMPLETION REQUIRES for a job family — the credentialing / accrediting body's
// rules and every item on its list — scored ITEM BY ITEM against the sites in the
// network: which secured site provides each experience (confirmed, estimated, or only
// inferred from its assets), which experiences only an asked site provides, and which
// nothing in the network provides. Starter content from the public standard until the
// program marks it verified. Server component.

type Req = NonNullable<Awaited<ReturnType<typeof getFamilyRequirements>>>;
const VERDICT: Record<string, { tone: string; label: string; short: string }> = {
  covered: { tone: "bg-emerald-100 text-emerald-700", label: "secured site provides it", short: "secured" },
  "asked-only": { tone: "bg-amber-100 text-amber-700", label: "asked site only", short: "asked only" },
  "prospect-only": { tone: "bg-rose-100 text-rose-700", label: "prospect only — no agreement", short: "prospect only" },
  none: { tone: "bg-rose-100 text-rose-700", label: "nobody provides it", short: "nobody" },
  "n/a": { tone: "bg-slate-100 text-slate-500", label: "campus / lab", short: "campus" },
};
const BASIS: Record<string, { mark: string; title: string; tone: string }> = {
  verified: { mark: "✓", title: "confirmed with the site", tone: "text-emerald-700" },
  estimate: { mark: "≈", title: "estimate — not confirmed with the site", tone: "text-amber-700" },
  inferred: { mark: "?", title: "inferred from the site's assets only — nobody has confirmed it", tone: "text-slate-400" },
};
const inp = "rounded border border-slate-300 px-1.5 py-0.5 text-xs";
const short = (n: string) => n.replace(/ — .*$/, "").slice(0, 28);

export function RequirementsPanel({ req, compact = false, siteHref }: { req: Req; compact?: boolean; siteHref?: (employerId: string) => string }) {
  if (!req.sets.length) return <p className="text-xs text-slate-400">No requirement set is loaded for {req.family.name} yet.</p>;
  const href = siteHref ?? ((id: string) => `/employers/${id}`);
  return (
    <div className="space-y-6">
      {req.sets.map((set) => {
        const sc = set.score;
        const pct = sc.required ? sc.requiredCovered / sc.required : 1;
        return (
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

            {/* Scorecard — the one line that says whether this network can graduate a student. */}
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-[14rem] flex-1">
                  <div className="flex items-baseline justify-between text-xs"><span className="font-semibold text-slate-800">Required experiences a secured site provides</span><span className="tabular-nums text-slate-600">{sc.requiredCovered} of {sc.required}</span></div>
                  <div className="mt-1 h-2 overflow-hidden rounded bg-slate-100"><div className={`h-full ${pct >= 1 ? "bg-emerald-500" : pct >= 0.8 ? "bg-amber-400" : "bg-rose-500"}`} style={{ width: `${Math.round(pct * 100)}%` }} /></div>
                  <div className="mt-1 text-[11px] text-slate-500">electives: {sc.electiveCovered} of {sc.elective} have a secured provider · {set.mandatory} required + {set.elective} elective items in {set.categories} categories</div>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {sc.gaps.length ? <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-700">⚠ no secured site provides: {sc.gaps.slice(0, 5).join(", ")}{sc.gaps.length > 5 ? ` +${sc.gaps.length - 5}` : ""}</span> : <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">✓ every required experience has a secured provider</span>}
                  {sc.unverified > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600" title="the only secured providers are inferred from assets — confirm on each site's setup page">{sc.unverified} rest on inference, unconfirmed</span>}
                  {set.learners > 0 && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">{set.learnersComplete} of {set.learners} enrolled students complete · {Object.keys(set.demand).length} experiences still open for someone</span>}
                  {set.askedOnly.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">asked sites only: {set.askedOnly.join(", ")}</span>}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr><th className="px-3 py-1.5 text-left">Category · items</th><th className="px-2 py-1.5 text-right whitespace-nowrap">Required</th><th className="px-2 py-1.5 text-left">Settings</th><th className="min-w-[16rem] px-2 py-1.5 text-left">Secured sites · seats/day</th><th className="px-2 py-1.5 text-left whitespace-nowrap">Asked</th><th className="px-2 py-1.5 text-right whitespace-nowrap">Nearest secured</th><th className="px-2 py-1.5 text-left whitespace-nowrap">Verdict</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {set.coverage.map((c) => {
                    const reqCovered = c.itemCoverage.filter((i) => i.item.mandatory && i.verdict === "covered").length, reqTotal = c.itemCoverage.filter((i) => i.item.mandatory && i.verdict !== "n/a").length;
                    return (
                      <tr key={c.category} className={c.verdict === "none" || c.verdict === "prospect-only" ? "bg-rose-50/40" : c.verdict === "asked-only" ? "bg-amber-50/30" : ""}>
                        <td className="px-3 py-1.5 align-top">
                          <div className="font-medium text-slate-800">{c.category}</div>
                          <details className="mt-0.5">
                            <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-rose-600">{c.items.length} item{c.items.length === 1 ? "" : "s"} — who provides each ▸</summary>
                            <table className="mt-1 w-full">
                              <tbody>
                                {c.itemCoverage.map((ic) => {
                                  const i = ic.item;
                                  const v = VERDICT[ic.verdict];
                                  const list = (arr: typeof ic.providers.secured) => arr.map((p) => <Link key={p.site.employerId} href={href(p.site.employerId)} className="mr-1.5 inline-flex items-center gap-0.5 whitespace-nowrap hover:underline" title={`${p.site.name} — ${BASIS[p.basis].title}${p.annualVolume != null ? ` · ≈ ${p.annualVolume}/yr` : ""}${p.studentRole ? ` · ${p.studentRole}` : ""}`}><span className={BASIS[p.basis].tone}>{BASIS[p.basis].mark}</span>{short(p.site.name)}{p.status === "limited" ? <span className="text-amber-600">·ltd</span> : null}</Link>);
                                  return (
                                    <tr key={i.id} className="border-t border-slate-100 align-top">
                                      <td className="w-[38%] py-1 pr-2">
                                        <span className={i.mandatory ? "text-slate-800" : "text-slate-500"}>{i.name}</span>
                                        <span className="ml-1 text-[10px] text-slate-400">{i.mandatory ? "required" : `elective${i.electiveGroup ? ` · ${i.electiveGroup}` : ""}`}{i.role ? ` · ${i.role}` : ""}{i.minCount != null && i.minCount > 0 ? ` · min ${i.minCount}` : ""}</span>
                                        {!compact && (
                                          <details className="mt-0.5"><summary className="cursor-pointer text-[9px] text-slate-300 hover:text-slate-500">edit</summary>
                                            <form action={updateRequirementItem.bind(null, i.id)} className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]"><label className="flex items-center gap-0.5 text-slate-500"><input name="mandatory" type="checkbox" defaultChecked={i.mandatory} />required</label><input name="settingCodes" defaultValue={i.settingCodes} className={inp + " w-28"} title="asset settings that supply it (csv)" />{set.kind === "cases" && <input name="minCount" type="number" min="0" step="1" defaultValue={i.minCount ?? ""} placeholder="min" className={inp + " w-14"} />}{set.kind === "cases" && <input name="role" defaultValue={i.role ?? ""} placeholder="role" className={inp + " w-24"} />}<input name="notes" defaultValue={i.notes ?? ""} placeholder="notes" className={inp + " w-32"} /><button className="rounded bg-slate-200 px-1 text-slate-700">save</button></form>
                                          </details>
                                        )}
                                      </td>
                                      <td className="py-1 pr-2 text-[11px]">
                                        {ic.verdict === "n/a" ? <span className="text-slate-400">campus / lab</span> : <>
                                          {ic.providers.secured.length ? list(ic.providers.secured) : <span className="text-slate-300">no secured site</span>}
                                          {ic.providers.asked.length > 0 && <span className="text-amber-700"> · asked: {list(ic.providers.asked)}</span>}
                                          {ic.declined > 0 && <span className="text-slate-400"> · {ic.declined} said no</span>}
                                          {ic.annualVolumeSecured != null && <span className="text-slate-500"> · ≈ {dec(ic.annualVolumeSecured)}/yr at secured sites</span>}
                                        </>}
                                      </td>
                                      <td className="w-[9rem] py-1 text-right whitespace-nowrap">{set.learners > 0 && (set.demand[i.id] ?? 0) > 0 && <span className="mr-1 text-[10px] tabular-nums text-sky-800" title="enrolled students who have not logged it yet">{set.demand[i.id]} need it</span>}<span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${v.tone}`}>{v.short}</span></td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </details>
                        </td>
                        <td className="px-2 py-1.5 text-right align-top tabular-nums">{reqTotal > 0 ? <span className={reqCovered === reqTotal ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>{reqCovered} / {reqTotal}</span> : <span className="text-slate-400">{c.elective} elec</span>}{c.mandatory > 0 && c.elective > 0 && <span className="block text-[10px] text-slate-400">+ {c.elective} elec</span>}</td>
                        <td className="px-2 py-1.5 align-top">{c.settings.length ? c.settings.map((s) => <span key={s} className="mr-1 rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-700">{s}</span>) : <span className="text-slate-300">—</span>}</td>
                        <td className="min-w-[16rem] px-2 py-1.5 align-top text-slate-700">{c.sites.secured.length ? <>{c.sites.secured.length} site{c.sites.secured.length === 1 ? "" : "s"} · <span className="tabular-nums">{c.seatsSecured}</span> seats<span className="block text-[10px] text-slate-400">{c.sites.secured.slice(0, 3).map((s) => short(s.name)).join(", ")}{c.sites.secured.length > 3 ? ` +${c.sites.secured.length - 3}` : ""}</span>{c.unverified > 0 && <span className="block text-[10px] text-slate-400">{c.unverified} item{c.unverified === 1 ? "" : "s"} inferred only</span>}</> : <span className="text-slate-300">—</span>}</td>
                        <td className="px-2 py-1.5 align-top whitespace-nowrap text-slate-600">{c.sites.asked.length ? `${c.sites.asked.length} · ${c.seatsAsked} seats` : <span className="text-slate-300">—</span>}</td>
                        <td className="px-2 py-1.5 text-right align-top whitespace-nowrap tabular-nums">{c.nearestSecuredMinutes != null ? `${dec(Math.round(c.nearestSecuredMinutes))} min` : "—"}</td>
                        <td className="px-2 py-1.5 align-top"><span className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium ${VERDICT[c.verdict].tone}`}>{VERDICT[c.verdict].label}</span>{c.mandatoryGaps.length > 0 && <span className="block text-[10px] text-rose-600">missing: {c.mandatoryGaps.map((g) => g.name).join(", ")}</span>}</td>
                      </tr>
                    );
                  })}
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
        );
      })}
      {!compact && <p className="text-[11px] text-slate-400"><span className="text-emerald-700">✓</span> confirmed with the site · <span className="text-amber-700">≈</span> estimate · <span className="text-slate-400">?</span> inferred from the site&apos;s assets only. Open a site to confirm what it actually does, item by item, and record annual volumes. Seats/day are the assets&apos; learners per shift in the category&apos;s settings, summed over sites with that agreement.</p>}
    </div>
  );
}
