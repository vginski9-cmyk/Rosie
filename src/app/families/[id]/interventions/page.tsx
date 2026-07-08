import Link from "next/link";
import { notFound } from "next/navigation";
import { getFamilyInterventions } from "@/lib/queries";
import { InterventionBoard } from "@/components/InterventionBoard";

export const dynamic = "force-dynamic";

export default async function FamilyInterventionsPage({ params }: { params: { id: string } }) {
  const data = await getFamilyInterventions(params.id);
  if (!data) notFound();
  const { family, interventions, funnel } = data;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/families/${family.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {family.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Pipeline interventions — {family.name}</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The full intervention plan on one canvas: partner lanes (middle school → high school → community college →
          employers → cross-cutting) × pipeline stages (awareness → readiness → application → WBL → supports → retention),
          each intervention sequenced within its lane with a named owner, priority populations, status, and cost band.
          Stage columns show the live funnel count they&apos;re trying to move.
        </p>
      </div>
      <InterventionBoard
        familyId={family.id}
        interventions={interventions.map((i) => ({
          id: i.id, lane: i.lane, stage: i.stage, title: i.title, description: i.description,
          populations: i.populations, owner: i.owner, status: i.status, sequence: i.sequence,
          estCostLow: i.estCostLow, estCostHigh: i.estCostHigh, targetStageKey: i.targetStageKey,
        }))}
        funnel={funnel}
      />
    </div>
  );
}
