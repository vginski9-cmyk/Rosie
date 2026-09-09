import Link from "next/link";
import { notFound } from "next/navigation";
import { getFamilySupply, getAccreditorCapacity, getFamilyClinicalRules } from "@/lib/queries";
import { ClinicalRulesPanel } from "@/components/ClinicalRulesPanel";
import { SupplyMapBoard } from "@/components/SupplyMapBoard";
import { AccreditorCapacity } from "@/components/AccreditorCapacity";

export const dynamic = "force-dynamic";

// One job's clinical SUPPLY map: the settings its clinicals happen in, the
// sites that serve it, and each site's physical assets with their shift
// structures — built one at a time, or imported from a partner workbook.
// Demand lives in program design; matching the two comes later.
export default async function FamilyClinicalPage({ params }: { params: { id: string } }) {
  const data = await getFamilySupply(params.id);
  if (!data) notFound();
  const year = new Date().getUTCFullYear() + 1;
  const rules = await getFamilyClinicalRules(params.id);
  const full = await getAccreditorCapacity(params.id);
  const report = full && (full.family.accreditor || /radiograph|imaging/i.test(full.family.name)) ? full : null;
  return (
    <div className="space-y-6">
      <div>
        <Link href={`/families/${data.family.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {data.family.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Clinical supply map — {data.family.name}</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          {data.family.occupation ?? data.family.name}{data.family.soc ? ` (SOC ${data.family.soc})` : ""} at {data.family.institution}. The sites and physical assets that host this job&apos;s clinicals, each with its own shift structure: which days it runs, which shifts, when each starts and how long it lasts, and how many learners it takes. This is supply only — what each course needs is set in program design.
        </p>
      </div>
      {rules && (
        <section className="space-y-2 rounded-xl border border-rose-200 bg-white p-4 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">How {rules.family.name} schedules clinicals <span className="text-sm font-normal text-slate-400">— availability basis, placement rules, and what each site makes available</span></h2>
            <p className="max-w-4xl text-sm text-slate-500">Each job counts clinical availability its own way: radiography by seats in rooms and on units, surgical technology by the cases a site does in a day, nurse aide by the staff on shift. Set that here, with the rules for placing students and every site&apos;s agreed limits — and every offering builds its clinical schedules from it.</p>
          </div>
          <ClinicalRulesPanel rules={rules} />
        </section>
      )}
      {report && (
        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">Clinical capacity as the accreditor counts it <span className="text-sm font-normal text-slate-400">— {report.family.accreditor ?? "JRCERT"} Form 1010R, site by site</span></h2>
            <p className="max-w-4xl text-sm text-slate-500">The JRCERT sets each recognized clinical setting&apos;s capacity at the lower of two resources on its campus: radiographic + R&amp;F rooms plus mobile + C-arm units, and the qualified radiographers scheduled while students are on site. Rooms and units are counted from the asset map below; the staff count lives on each site&apos;s record. Approved capacity caps how many sections auto-assign places at a site at once, and any site the calendar loads beyond its approval — or uses without recognition — is flagged here before a request has to be filed.</p>
          </div>
          <AccreditorCapacity report={report} mode="family" />
        </section>
      )}
      <SupplyMapBoard family={data.family} settings={data.settings} sites={data.sites} overrides={data.overrides} organizations={data.organizations} year={year} />
    </div>
  );
}
