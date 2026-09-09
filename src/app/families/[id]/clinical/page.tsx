import Link from "next/link";
import { notFound } from "next/navigation";
import { getFamilySupply, getAccreditorCapacity, getFamilyClinicalRules, getFamilyClinicalSetup } from "@/lib/queries";
import { RequirementsPanel } from "@/components/RequirementsPanel";
import { ClinicalRulesPanel } from "@/components/ClinicalRulesPanel";
import { FamilySitesTable } from "@/components/FamilySitesTable";
import { SupplyMapBoard } from "@/components/SupplyMapBoard";
import { AccreditorCapacity } from "@/components/AccreditorCapacity";
import { Collapse } from "@/components/Collapse";

export const dynamic = "force-dynamic";

// ONE PROGRAM'S CLINICAL SETUP — the single page where a job's clinicals are set up,
// in the order the work happens: what completion requires (scored against the
// network, item by item), how this job counts availability and places students, the
// sites that serve it (each opening its own setup inside this program), the
// accreditor's capacity picture, and the raw asset map. Nothing here is shared with
// another program; every site is set up for THIS job.
export default async function FamilyClinicalPage({ params }: { params: { id: string } }) {
  const setup = await getFamilyClinicalSetup(params.id);
  if (!setup) notFound();
  const data = await getFamilySupply(params.id);
  const rules = await getFamilyClinicalRules(params.id);
  const full = setup.family.accreditor ? await getAccreditorCapacity(params.id) : null;
  const year = new Date().getUTCFullYear() + 1;
  const fam = setup.family;
  const req = setup.req;
  const score = req?.sets.reduce((a, s) => ({ requiredCovered: a.requiredCovered + s.score.requiredCovered, required: a.required + s.score.required, unverified: a.unverified + s.score.unverified, gaps: [...a.gaps, ...s.score.gaps] }), { requiredCovered: 0, required: 0, unverified: 0, gaps: [] as string[] }) ?? null;
  const steps = [
    { n: 1, label: "What completion requires", href: "#requirements", state: req?.sets.length ? (score && score.requiredCovered === score.required ? "done" : "gap") : "todo" },
    { n: 2, label: "How this job schedules", href: "#rules", state: "done" },
    { n: 3, label: `Sites for ${fam.name}`, href: "#sites", state: setup.totals.secured > 0 ? "done" : "todo" },
    ...(fam.accreditor ? [{ n: 4, label: `${fam.accreditor} capacity`, href: "#accreditor", state: setup.totals.recognized > 0 ? "done" : "todo" }] : []),
    { n: fam.accreditor ? 5 : 4, label: "All assets & workbooks", href: "#assets", state: "done" },
  ];
  const tone = (s: string) => s === "done" ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : s === "gap" ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200" : "bg-white text-slate-600 ring-1 ring-slate-200";

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500"><Link href="/clinical" className="hover:text-slate-700">Clinical setup by program</Link><span>›</span><span className="text-slate-700">{fam.name}</span><span className="text-slate-300">·</span><Link href={`/families/${fam.id}`} className="hover:text-slate-700">program family page</Link></div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Clinical setup — {fam.name}</h1>
        <p className="max-w-4xl text-sm text-slate-500">{fam.occupation ?? fam.name}{fam.soc ? ` (SOC ${fam.soc})` : ""} at {fam.institution}. Everything this job needs from its clinical network, set up once here and read by every offering: the experiences each graduate must complete and which sites provide them, the way this job counts availability, and each site&apos;s agreement, recognition, assets, shift structures and qualified staff — all specific to {fam.name}.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">{steps.map((s) => <a key={s.href} href={s.href} className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${tone(s.state)}`}>{s.state === "done" ? "✓" : s.state === "gap" ? "⚠" : s.n} {s.label}</a>)}</div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700"><strong>{setup.totals.sites}</strong> sites in this program · <strong className="text-emerald-700">{setup.totals.secured}</strong> secured · <strong className="text-amber-700">{setup.totals.asked}</strong> asked · {setup.totals.seatsSecured} secured seats/shift</span>
          {score && score.required > 0 && <span className={`rounded-full px-2.5 py-1 font-medium ${score.requiredCovered === score.required ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{score.requiredCovered} of {score.required} required experiences have a secured provider{score.unverified ? ` · ${score.unverified} unconfirmed` : ""}</span>}
          {fam.accreditor && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">{fam.accreditor}: {setup.totals.recognized} recognized site{setup.totals.recognized === 1 ? "" : "s"} · {setup.totals.approvedTotal} approved at once{fam.accreditedCapacity != null ? ` of ${fam.accreditedCapacity} program capacity` : ""}</span>}
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">availability counted by {fam.capacityBasis}</span>
        </div>
      </div>

      <section id="requirements" className="scroll-mt-16 space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">1 · What completion requires <span className="text-sm font-normal text-slate-400">— {req?.sets.map((x) => x.authority).join(" · ") || "no requirement set yet"}, scored item by item against the sites in this program</span></h2>
          <p className="max-w-4xl text-sm text-slate-500">Every graduate must finish this list. Each item is checked against every site set up for {fam.name}: a secured site that provides it (confirmed on the site&apos;s page, or inferred from its assets until confirmed), a site still being asked, or nobody — the gaps to close with an agreement, an asset, or a confirmation before a cohort is scheduled. Open a category to see who provides each item.</p>
        </div>
        {req && req.sets.length > 0 ? <RequirementsPanel req={req} siteHref={(id) => `/families/${fam.id}/clinical/sites/${id}`} /> : <p className="text-sm text-amber-700">No requirement set is loaded for {fam.name}. Radiography, surgical technology and nurse aide sets ship as starter content; other jobs need the credentialing body&apos;s list entered.</p>}
      </section>

      {rules && (
        <section id="rules" className="scroll-mt-16 space-y-2 rounded-xl border border-rose-200 bg-white p-4 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">2 · How {fam.name} schedules clinicals <span className="text-sm font-normal text-slate-400">— availability basis and placement rules</span></h2>
            <p className="max-w-4xl text-sm text-slate-500">Each job counts clinical availability its own way: radiography by seats in rooms and on units under the JRCERT-approved capacity, surgical technology by the cases a site does in a day, nurse aide by the staff on shift. Set that here; each site&apos;s agreed limits are on its own setup page below.</p>
          </div>
          <ClinicalRulesPanel rules={rules} />
        </section>
      )}

      <section id="sites" className="scroll-mt-16 space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">3 · Sites for {fam.name} <span className="text-sm font-normal text-slate-400">— each set up for this program: agreement{fam.accreditor ? `, ${fam.accreditor} recognition` : ""}, assets, qualified staff, availability, and what it provides</span></h2>
          <p className="max-w-4xl text-sm text-slate-500">One row per site in this program&apos;s network. Open a site to set it up for {fam.name} — its drive, agreement, availability, assets and shift structures, the {setup.discipline.label}s who precept there, and item by item which required experiences it provides. Add a site at the bottom.</p>
        </div>
        <FamilySitesTable setup={setup} />
      </section>

      {full && (
        <section id="accreditor" className="scroll-mt-16 space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">4 · Clinical capacity as {fam.accreditor} counts it <span className="text-sm font-normal text-slate-400">— Form 1010R, site by site</span></h2>
            <p className="max-w-4xl text-sm text-slate-500">Each recognized setting&apos;s capacity is the lower of its physical resources (radiographic + R&amp;F rooms, mobile + C-arm units — counted from the asset map) and the qualified radiographers scheduled while students are on site. Approved capacity caps how many students the scheduler places at a site at once; any site loaded beyond its approval, or used without recognition, is flagged here before a request has to be filed.</p>
          </div>
          <AccreditorCapacity report={full} mode="family" />
        </section>
      )}

      {data && (
        <div id="assets" className="scroll-mt-16">
          <Collapse title={`${fam.accreditor ? 5 : 4} · All assets at every site, shift structures & partner workbooks`} sub="The whole asset map for this job in one place — totals by setting, county and ring, every site's assets, workbook import and export. Day-to-day, set assets up on each site's page above." summary={<>{data.sites.length} sites · {data.sites.reduce((n, s) => n + s.assets.length, 0)} assets</>}>
            <SupplyMapBoard family={data.family} settings={data.settings} sites={data.sites} overrides={data.overrides} organizations={data.organizations} year={year} />
          </Collapse>
        </div>
      )}
    </div>
  );
}
