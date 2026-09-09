import { getInsightsFacts } from "@/lib/queries";
import { PivotExplorer } from "@/components/PivotExplorer";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const facts = await getInsightsFacts();
  const institutions = new Set(facts.map((f) => f.institution)).size;
  const programs = new Set(facts.map((f) => f.program)).size;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Explore</h1>
        <p className="text-sm text-slate-500">Pipeline and delivery metrics across {institutions} institution{institutions === 1 ? "" : "s"} and {programs} programs — pick two dimensions, switch the measure, click to drill.</p>
      </div>

      <PivotExplorer facts={facts} />
    </div>
  );
}
