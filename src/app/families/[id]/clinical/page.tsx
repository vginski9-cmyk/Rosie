import Link from "next/link";
import { notFound } from "next/navigation";
import { getFamilySupply } from "@/lib/queries";
import { SupplyMapBoard } from "@/components/SupplyMapBoard";

export const dynamic = "force-dynamic";

// One job's clinical SUPPLY map: the settings its clinicals happen in, the
// sites that serve it, and each site's physical assets with their shift
// structures — built one at a time, or imported from a partner workbook.
// Demand lives in program design; matching the two comes later.
export default async function FamilyClinicalPage({ params }: { params: { id: string } }) {
  const data = await getFamilySupply(params.id);
  if (!data) notFound();
  const year = new Date().getUTCFullYear() + 1;
  return (
    <div className="space-y-6">
      <div>
        <Link href={`/families/${data.family.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {data.family.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Clinical supply map — {data.family.name}</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          {data.family.occupation ?? data.family.name}{data.family.soc ? ` (SOC ${data.family.soc})` : ""} at {data.family.institution}. The sites and physical assets that host this job&apos;s clinicals, each with its own shift structure: which days it runs, which shifts, when each starts and how long it lasts, and how many learners it takes. This is supply only — what each course needs is set in program design.
        </p>
      </div>
      <SupplyMapBoard family={data.family} settings={data.settings} sites={data.sites} overrides={data.overrides} organizations={data.organizations} year={year} />
    </div>
  );
}
