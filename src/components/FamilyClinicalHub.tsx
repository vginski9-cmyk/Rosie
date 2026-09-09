import { notFound } from "next/navigation";
import { getFamilySupply, getAccreditorCapacity, getFamilyClinicalRules, getFamilyClinicalSetup } from "@/lib/queries";
import { RequirementsPanel } from "@/components/RequirementsPanel";
import { ClinicalRulesPanel } from "@/components/ClinicalRulesPanel";
import { FamilySitesTable } from "@/components/FamilySitesTable";
import { SupplyMapBoard } from "@/components/SupplyMapBoard";
import { AccreditorCapacity } from "@/components/AccreditorCapacity";
import { Collapse } from "@/components/Collapse";

// ONE PROGRAM'S CLINICAL NETWORK, on one page, in the order the work happens:
// what completion requires (scored against the sites), the sites themselves (each
// opening its own setup), and — folded away — the scheduling rules, the accreditor's
// capacity picture and the raw asset map. Server component; `base` is the URL the
// site pages hang off.

export async function FamilyClinicalHub({ familyId, base }: { familyId: string; base: string }) {
  const setup = await getFamilyClinicalSetup(familyId);
  if (!setup) notFound();
  const [data, rules, full] = await Promise.all([getFamilySupply(familyId), getFamilyClinicalRules(familyId), setup.family.accreditor ? getAccreditorCapacity(familyId) : Promise.resolve(null)]);
  const year = new Date().getUTCFullYear() + 1;
  const fam = setup.family;
  const req = setup.req;
  const score = req?.sets.reduce((a, s) => ({ requiredCovered: a.requiredCovered + s.score.requiredCovered, required: a.required + s.score.required, unverified: a.unverified + s.score.unverified }), { requiredCovered: 0, required: 0, unverified: 0 }) ?? null;
  const siteHref = (id: string) => `${base}/sites/${id}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 text-xs">
        <a href="#sites" className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 hover:bg-slate-200"><strong>{setup.totals.sites}</strong> sites · <strong className="text-emerald-700">{setup.totals.secured}</strong> secured · <strong className="text-amber-700">{setup.totals.asked}</strong> asked · {setup.totals.seatsSecured} secured seats per shift</a>
        {score && score.required > 0 && <a href="#requirements" className={`rounded-full px-2.5 py-1 font-medium ${score.requiredCovered === score.required ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{score.requiredCovered} of {score.required} required experiences have a secured provider{score.unverified ? ` · ${score.unverified} unconfirmed` : ""}</a>}
        {fam.accreditor && <a href="#accreditor" className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 hover:bg-slate-200">{fam.accreditor}: {setup.totals.recognized} recognized · {setup.totals.approvedTotal} students approved at once{fam.accreditedCapacity != null ? ` of ${fam.accreditedCapacity}` : ""}</a>}
        <a href="#rules" className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 hover:bg-slate-200">availability counted by {fam.capacityBasis}</a>
      </div>

      <section id="requirements" className="scroll-mt-16 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">1 · What completion requires <span className="text-sm font-normal text-slate-400">— {req?.sets.map((x) => x.authority.split(" · ")[0]).join(" · ") || "no requirement set yet"}, and which site provides each experience</span></h2>
        {req && req.sets.length > 0 ? <RequirementsPanel req={req} siteHref={siteHref} /> : <p className="text-sm text-amber-700">No requirement set is loaded for {fam.name}. Enter the credentialing body&apos;s list to score the network against it.</p>}
      </section>

      <section id="sites" className="scroll-mt-16 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">2 · Sites <span className="text-sm font-normal text-slate-400">— open one to set its agreement, assets and shifts, staff, availability and what it provides</span></h2>
        <FamilySitesTable setup={setup} siteHref={siteHref} />
      </section>

      {rules && (
        <div id="rules" className="scroll-mt-16">
          <Collapse title="3 · Scheduling rules" sub={`How ${fam.name} counts availability and places students — set once, read by every offering`} summary={<>{fam.capacityBasis} · {rules.family.rotationAgreements} sites</>}>
            <ClinicalRulesPanel rules={rules} />
          </Collapse>
        </div>
      )}

      {full && (
        <div id="accreditor" className="scroll-mt-16">
          <Collapse title={`4 · ${fam.accreditor} capacity`} sub="Form 1010R site by site: the lower of physical resources and qualified staff on shift, against what is approved" summary={<>{setup.totals.recognized} recognized · {setup.totals.approvedTotal} approved at once</>}>
            <AccreditorCapacity report={full} mode="family" />
          </Collapse>
        </div>
      )}

      {data && (
        <div id="assets" className="scroll-mt-16">
          <Collapse title={`${full ? 5 : 4} · Every asset in the network`} sub="The whole asset map for this program: totals by setting, county and ring, workbook import and export" summary={<>{data.sites.length} sites · {data.sites.reduce((n, s) => n + s.assets.length, 0)} assets</>}>
            <SupplyMapBoard family={data.family} settings={data.settings} sites={data.sites} overrides={data.overrides} organizations={data.organizations} year={year} />
          </Collapse>
        </div>
      )}
    </div>
  );
}
