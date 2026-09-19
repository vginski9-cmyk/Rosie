import { Fragment } from "react";
import { saveSiteProvisions } from "@/lib/actions";
import type { getFamilySiteSetup } from "@/lib/queries";
import { SCRUB_ROLES, parseScrubRoles } from "@/lib/surgvolume";
import { CoverageHeadline, UnverifiedStandard } from "@/components/Evidence";

// WHAT THIS SITE PROVIDES toward one program's completion requirements — item by item,
// at the grain the credentialing body counts. Each row starts from what the asset map
// implies (a fluoroscopy room ⇒ upper GIs, an OR ⇒ orthopedic cases) and is confirmed,
// limited, or ruled out by the coordinator, with the site's annual volume and — for
// case logs — the most a student may do here (first scrub, second scrub, observe).
// Inference is never success-styled; a service line a generic asset does not imply reads
// "possible" until the site confirms it. Confirming records who and when (Phase 3); there
// is no bulk "confirm everything" — each line is the site's own answer. One form, one Save.
// Server component.

type Setup = NonNullable<Awaited<ReturnType<typeof getFamilySiteSetup>>>;
type Set = Setup["sets"][number];
const inp = "rounded border border-slate-300 px-1.5 py-0.5 text-xs";
const STATE: Record<string, { label: string; tone: string }> = {
  provides: { label: "provides", tone: "bg-emerald-100 text-emerald-700" },
  limited: { label: "limited", tone: "bg-amber-100 text-amber-700" },
  possible: { label: "possible · needs service-line confirmation", tone: "bg-amber-100 text-amber-800" },
  inferred: { label: "possible · inferred, unconfirmed", tone: "bg-amber-100 text-amber-800" },
  none: { label: "does not", tone: "bg-rose-100 text-rose-700" },
  unknown: { label: "unknown · no asset, no answer", tone: "bg-slate-100 text-slate-500" },
  "n/a": { label: "campus / lab", tone: "bg-slate-50 text-slate-400" },
};
const BASIS: Record<string, string> = { verified: "confirmed with the site", estimate: "estimate — not the site's word", inferred: "inferred from assets" };

export function SiteProvisionChecklist({ familyId, employerId, siteName, set, kind }: { familyId: string; employerId: string; siteName: string; set: Set; kind: string }) {
  const sc = set.score;
  const cases = kind === "cases" || set.kind === "cases";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <CoverageHeadline score={{ required: sc.required, requiredCovered: sc.requiredProvided, requiredConfirmed: sc.requiredConfirmed }} unverifiedStandard={!set.verified} />
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{sc.electiveProvided} of {sc.elective} electives reachable here</span>
        {sc.unverified > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800 ring-1 ring-amber-200">{sc.unverified} inferred from assets, not confirmed</span>}
        {sc.possible > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800 ring-1 ring-amber-200">{sc.possible} service line{sc.possible === 1 ? "" : "s"} need confirmation</span>}
        {sc.unknown > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{sc.unknown} unknown — no asset here and no answer</span>}
        {sc.declined > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{sc.declined} ruled out</span>}
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
                  <tr className="bg-slate-50/70"><td colSpan={cases ? 8 : 7} className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{cat.category} <span className="font-normal normal-case text-slate-400">— {cat.items.filter((x) => (x.state === "provides" || x.state === "limited") && x.basis === "verified").length} confirmed · {cat.items.filter((x) => (x.state === "provides" || x.state === "limited") && x.basis !== "verified").length + cat.items.filter((x) => x.state === "possible").length} possible · of {cat.items.filter((x) => x.state !== "n/a").length}</span>{set.serviceLines.some((s) => s.toLowerCase() === cat.category.toLowerCase()) && <span className="ml-2 rounded bg-amber-50 px-1 font-normal normal-case text-amber-800 ring-1 ring-amber-200">service line — a generic asset does not imply it</span>}</td></tr>
                  {cat.items.map((f) => {
                    const i = f.item;
                    const explicit = f.basis === "verified" || f.basis === "estimate";
                    const stKey = (f.state === "provides" || f.state === "limited") && f.basis === "inferred" ? "inferred" : f.state;
                    const st = STATE[stKey];
                    const current = f.state === "n/a" ? "" : explicit ? f.state : "assets";
                    return (
                      <tr key={i.id} className={`border-t border-slate-100 ${f.state === "none" ? "text-slate-400" : ""}`}>
                        <td className="min-w-[16rem] px-3 py-1 align-top"><span className={i.mandatory ? "font-medium text-slate-800" : "text-slate-600"}>{i.name}</span><span className="ml-1 text-[10px] text-slate-400">{i.mandatory ? "required" : `elective${i.electiveGroup ? ` · ${i.electiveGroup}` : ""}`}{i.role ? ` · ${i.role}` : ""}{i.minCount != null && i.minCount > 0 ? ` · min ${i.minCount}` : ""}</span>{i.notes && <span className="block text-[10px] text-slate-400">{i.notes}</span>}</td>
                        <td className="px-2 py-1 align-top whitespace-nowrap">{f.settings.map((s) => <span key={s} className="mr-1 rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-600">{s}</span>)}{f.settings.length ? <span className={`tabular-nums ${f.seats ? "text-slate-700" : "text-amber-600"}`}>{f.seats ? `${f.seats} seats` : "no asset"}</span> : <span className="text-slate-300">—</span>}</td>
                        <td className="px-2 py-1 align-top whitespace-nowrap"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${st.tone}`}>{st.label}</span>{f.basis && <span className="block text-[10px] text-slate-400">{BASIS[f.basis]}{f.evidence?.verifiedAt ? ` · ${f.evidence.owner ? `${f.evidence.owner}, ` : ""}${f.evidence.verifiedAt}` : ""}{f.evidence?.reviewBy ? ` · review by ${f.evidence.reviewBy}` : ""}</span>}</td>
                        {f.state === "n/a" ? <td colSpan={cases ? 5 : 4} className="px-2 py-1 text-[11px] text-slate-400">done on campus or in the lab — nothing to confirm at a site</td> : <>
                          <td className="px-2 py-1 align-top">
                            <select name={`st_${i.id}`} defaultValue={current} aria-label={`Provision status for ${i.name}`} className={inp}>
                              <option value="assets">as the assets say ({f.seats ? (stKey === "possible" ? "possible" : "inferred") : "unknown"})</option>
                              <option value="provides">provides — the site confirmed</option>
                              <option value="limited">limited (rare / by arrangement)</option>
                              <option value="none">does not provide</option>
                            </select>
                          </td>
                          <td className="px-2 py-1 align-top text-right"><input name={`vol_${i.id}`} type="number" min="0" step="1" aria-label={`Annual volume for ${i.name}`} defaultValue={f.annualVolume ?? ""} placeholder="—" className={inp + " w-20 text-right"} /></td>
                          {cases && <td className="px-2 py-1 align-top whitespace-nowrap">{(() => { const on = parseScrubRoles(f.studentRole); return SCRUB_ROLES.map((r) => <label key={r} className="mr-2 inline-flex items-center gap-0.5 text-[11px] text-slate-700"><input type="checkbox" name={`role_${i.id}_${r.replace(/ /g, "_")}`} defaultChecked={on.includes(r)} />{r}</label>); })()}</td>}
                          <td className="px-2 py-1 align-top"><select name={`src_${i.id}`} defaultValue={f.basis === "estimate" ? "ESTIMATE" : "VERIFIED"} aria-label={`Evidence source for ${i.name}`} className={inp}><option value="VERIFIED">confirmed with site</option><option value="ESTIMATE">estimate</option></select></td>
                          <td className="px-2 py-1 align-top"><input name={`note_${i.id}`} defaultValue={f.notes ?? ""} aria-label={`Note for ${i.name}`} placeholder={cases ? "e.g. Tue/Thu ortho block, students first-scrub after wk 6" : "e.g. 2 fluoro days a week; GI only"} className={inp + " w-52"} /></td>
                        </>}
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="block text-[11px] text-slate-600"><span className="block text-[9px] font-semibold uppercase text-slate-500">Confirmed by (who at the site said so)</span><input name="confirmedBy" placeholder="e.g. J. Rivera, clinical coordinator" className={inp + " w-56"} /></label>
          <label className="block text-[11px] text-slate-600"><span className="block text-[9px] font-semibold uppercase text-slate-500">Review by</span><input name="reviewBy" type="date" className={inp} /></label>
          <button className="rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-rose-700">Save what {siteName.length > 28 ? "this site" : siteName} provides</button>
          <span className="text-[11px] text-slate-400">Rows saved as &quot;confirmed with site&quot; record the name above and today&apos;s date; an estimate records neither. &quot;As the assets say&quot; keeps the row inferred (a room in the item&apos;s setting ⇒ possible). A row with no asset and no answer stays unknown until the site answers — unknown is never counted as available.</span>
        </div>
        <div className="mt-1"><UnverifiedStandard verified={set.verified} size="xs" /></div>
      </form>
    </div>
  );
}
