import { Fragment } from "react";
import { saveSiteProvisions, confirmInferredProvisions } from "@/lib/actions";
import type { getFamilySiteSetup } from "@/lib/queries";
import { SCRUB_ROLES, parseScrubRoles } from "@/lib/surgvolume";

// WHAT THIS SITE PROVIDES toward one program's completion requirements — item by item,
// at the grain the credentialing body counts. Each row starts from what the asset map
// implies (a fluoroscopy room ⇒ upper GIs, an OR ⇒ orthopedic cases) and is confirmed,
// limited, or ruled out by the coordinator, with the site's annual volume and — for
// case logs — the most a student may do here (first scrub, second scrub, observe).
// One form, one Save. Server component.

type Setup = NonNullable<Awaited<ReturnType<typeof getFamilySiteSetup>>>;
type Set = Setup["sets"][number];
const inp = "rounded border border-slate-300 px-1.5 py-0.5 text-xs";
const STATE: Record<string, { label: string; tone: string }> = {
  provides: { label: "provides", tone: "bg-emerald-100 text-emerald-700" },
  limited: { label: "limited", tone: "bg-amber-100 text-amber-700" },
  none: { label: "does not", tone: "bg-rose-100 text-rose-700" },
  unknown: { label: "no asset · unknown", tone: "bg-slate-100 text-slate-500" },
  "n/a": { label: "campus / lab", tone: "bg-slate-50 text-slate-400" },
};
const BASIS: Record<string, string> = { verified: "confirmed", estimate: "estimate", inferred: "inferred · unconfirmed" };

export function SiteProvisionChecklist({ familyId, employerId, siteName, set, kind }: { familyId: string; employerId: string; siteName: string; set: Set; kind: string }) {
  const sc = set.score;
  const cases = kind === "cases" || set.kind === "cases";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-medium ${sc.requiredProvided === sc.required && sc.required > 0 ? "bg-emerald-100 text-emerald-700" : sc.requiredProvided > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{sc.requiredProvided} of {sc.required} required experiences provided here</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{sc.electiveProvided} of {sc.elective} electives</span>
        {sc.unverified > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800 ring-1 ring-amber-200">{sc.unverified} inferred from assets, not confirmed</span>}
        {sc.unknown > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{sc.unknown} with no asset here and no answer</span>}
        {sc.declined > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{sc.declined} ruled out</span>}
        {sc.unverified > 0 && (
          <form action={confirmInferredProvisions.bind(null, familyId, employerId, set.id)} className="ml-auto"><button className="rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100" title="the site confirmed it does everything its assets imply">✓ Confirm all {sc.unverified} inferred as provided</button></form>
        )}
      </div>
      <form action={saveSiteProvisions.bind(null, familyId, employerId)}>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr><th className="min-w-[16rem] px-3 py-1.5 text-left">Experience</th><th className="px-2 py-1.5 text-left whitespace-nowrap">Settings · seats here</th><th className="px-2 py-1.5 text-left whitespace-nowrap">Now</th><th className="px-2 py-1.5 text-left">{siteName.length > 28 ? "This site" : siteName} …</th><th className="px-2 py-1.5 text-right">{cases ? "Cases / yr" : "Procedures / yr"}</th>{cases && <th className="px-2 py-1.5 text-left">Student may (any that apply)</th>}<th className="px-2 py-1.5 text-left">Basis</th><th className="px-2 py-1.5 text-left">Notes</th></tr>
            </thead>
            <tbody>
              {set.categories.map((cat) => (
                <Fragment key={cat.category}>
                  <tr className="bg-slate-50/70"><td colSpan={cases ? 8 : 7} className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{cat.category} <span className="font-normal normal-case text-slate-400">— {cat.items.filter((x) => x.state === "provides" || x.state === "limited").length} of {cat.items.filter((x) => x.state !== "n/a").length} provided here</span></td></tr>
                  {cat.items.map((f) => {
                    const i = f.item;
                    const st = STATE[f.state];
                    const explicit = f.basis === "verified" || f.basis === "estimate";
                    const current = f.state === "n/a" ? "" : explicit ? f.state : "assets";
                    return (
                      <tr key={i.id} className={`border-t border-slate-100 ${f.state === "none" ? "text-slate-400" : ""}`}>
                        <td className="min-w-[16rem] px-3 py-1 align-top"><span className={i.mandatory ? "font-medium text-slate-800" : "text-slate-600"}>{i.name}</span><span className="ml-1 text-[10px] text-slate-400">{i.mandatory ? "required" : `elective${i.electiveGroup ? ` · ${i.electiveGroup}` : ""}`}{i.role ? ` · ${i.role}` : ""}{i.minCount != null && i.minCount > 0 ? ` · min ${i.minCount}` : ""}</span>{i.notes && <span className="block text-[10px] text-slate-400">{i.notes}</span>}</td>
                        <td className="px-2 py-1 align-top whitespace-nowrap">{f.settings.map((s) => <span key={s} className="mr-1 rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-600">{s}</span>)}{f.settings.length ? <span className={`tabular-nums ${f.seats ? "text-slate-700" : "text-amber-600"}`}>{f.seats ? `${f.seats} seats` : "no asset"}</span> : <span className="text-slate-300">—</span>}</td>
                        <td className="px-2 py-1 align-top whitespace-nowrap"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${st.tone}`}>{st.label}</span>{f.basis && <span className="block text-[10px] text-slate-400">{BASIS[f.basis]}</span>}</td>
                        {f.state === "n/a" ? <td colSpan={cases ? 5 : 4} className="px-2 py-1 text-[11px] text-slate-400">done on campus or in the lab — nothing to confirm at a site</td> : <>
                          <td className="px-2 py-1 align-top">
                            <select name={`st_${i.id}`} defaultValue={current} className={inp}>
                              <option value="assets">as the assets say ({f.seats ? "provides" : "unknown"})</option>
                              <option value="provides">provides</option>
                              <option value="limited">limited (rare / by arrangement)</option>
                              <option value="none">does not provide</option>
                            </select>
                          </td>
                          <td className="px-2 py-1 align-top text-right"><input name={`vol_${i.id}`} type="number" min="0" step="1" defaultValue={f.annualVolume ?? ""} placeholder="—" className={inp + " w-20 text-right"} /></td>
                          {cases && <td className="px-2 py-1 align-top whitespace-nowrap">{(() => { const on = parseScrubRoles(f.studentRole); return SCRUB_ROLES.map((r) => <label key={r} className="mr-2 inline-flex items-center gap-0.5 text-[11px] text-slate-700"><input type="checkbox" name={`role_${i.id}_${r.replace(/ /g, "_")}`} defaultChecked={on.includes(r)} />{r}</label>); })()}</td>}
                          <td className="px-2 py-1 align-top"><select name={`src_${i.id}`} defaultValue={f.basis === "estimate" ? "ESTIMATE" : "VERIFIED"} className={inp}><option value="VERIFIED">confirmed with site</option><option value="ESTIMATE">estimate</option></select></td>
                          <td className="px-2 py-1 align-top"><input name={`note_${i.id}`} defaultValue={f.notes ?? ""} placeholder={cases ? "e.g. Tue/Thu ortho block, students first-scrub after wk 6" : "e.g. 2 fluoro days a week; GI only"} className={inp + " w-52"} /></td>
                        </>}
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button className="rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-rose-700">Save what {siteName.length > 28 ? "this site" : siteName} provides</button>
          <span className="text-[11px] text-slate-400">&quot;As the assets say&quot; keeps the row inferred from the asset map (a room in the item&apos;s setting ⇒ provides). Volumes: {cases ? "cases of that specialty the site does a year — what limits how many students it can log against it" : "procedures of that kind the site does a year — what limits how many students can reach competency here"}. A row with no asset and no answer stays unknown until the site answers.</span>
        </div>
      </form>
    </div>
  );
}
